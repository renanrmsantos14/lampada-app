// Protocolo local Tuya 3.3 (lâmpada tipo B: DPs 20–24), sem dependência de plataforma.
// O transporte TCP é injetado: `net` no Node, `react-native-tcp-socket` no app.
import aesjs from 'aes-js';

export type Device = { id: string; ip: string; key: string };

export type Socket = {
  write(data: Uint8Array): unknown;
  on(event: 'data', cb: (data: Uint8Array) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: 'close', cb: () => void): unknown;
  destroy(): unknown;
};
// timeoutMs: limite do connect nativo (a sonda da busca usa um curto).
export type Connect = (host: string, port: number, onConnect: () => void, timeoutMs?: number) => Socket;

export type BulbState = {
  on: boolean;
  mode: 'white' | 'colour' | string;
  brightness: number; // 1–100 (%)
  temp: number; // 0–100 (%), 0 = quente
  hue: number; // 0–360
  saturation: number; // 0–100 (%)
};

const PORT = 6668;
const TIMEOUT_MS = 3000;
const CONNECT_TIMEOUT_MS = 4000;
const HEARTBEAT_MS = 10000;
const CMD_CONTROL = 7;
const CMD_STATUS = 8; // a lâmpada avisa sozinha quando muda (interruptor, outro app)
const CMD_HEARTBEAT = 9;
const CMD_QUERY = 10;
const PREFIX = 0x000055aa;
const SUFFIX = 0x0000aa55;
const VERSION_HEADER = [...'3.3'].map((c) => c.charCodeAt(0)).concat(new Array(12).fill(0));

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function aes(key: string) {
  return new aesjs.ModeOfOperation.ecb(aesjs.utils.utf8.toBytes(key));
}

let seq = 0;

export function encodeFrame(device: Device, cmd: number, body: object): Uint8Array {
  const plain = aesjs.padding.pkcs7.pad(aesjs.utils.utf8.toBytes(JSON.stringify(body)));
  const encrypted = aes(device.key).encrypt(plain);
  const payload = cmd === CMD_CONTROL ? [...VERSION_HEADER, ...encrypted] : [...encrypted];

  const frame = new Uint8Array(16 + payload.length + 8);
  const view = new DataView(frame.buffer);
  view.setUint32(0, PREFIX);
  view.setUint32(4, ++seq);
  view.setUint32(8, cmd);
  view.setUint32(12, payload.length + 8);
  frame.set(payload, 16);
  view.setUint32(16 + payload.length, crc32(frame.subarray(0, 16 + payload.length)));
  view.setUint32(20 + payload.length, SUFFIX);
  return frame;
}

type Frame = { cmd: number; data: object | null; size: number };

// Lê um frame completo do início do buffer; null se ainda faltam bytes.
export function decodeFrame(device: Device, buf: Uint8Array): Frame | null {
  if (buf.length < 24) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0) !== PREFIX) throw new Error('Resposta inválida da lâmpada');
  const size = 16 + view.getUint32(12);
  if (buf.length < size) return null;

  // Respostas trazem um código de retorno (4 bytes, quase todo zero); avisos de status não.
  const hasRetcode = (view.getUint32(16) & 0xffffff00) === 0;
  let payload = buf.subarray(hasRetcode ? 20 : 16, size - 8);
  if (payload[0] === 0x33 && payload[1] === 0x2e && payload[2] === 0x33) payload = payload.subarray(15);
  if (payload.length === 0 || payload.length % 16 !== 0) return { cmd: view.getUint32(8), data: null, size };

  const text = aesjs.utils.utf8.fromBytes(aesjs.padding.pkcs7.strip(aes(device.key).decrypt(payload)));
  let data: object | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Lâmpada respondeu: ${text}`);
  }
  return { cmd: view.getUint32(8), data, size };
}

type Pending = { cmd: number; resolve: (d: object | null) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

// Conexão persistente: abrir TCP custa até ~700 ms (Wi-Fi da lâmpada em economia);
// com a conexão aberta, um comando leva ~40 ms.
export class Bulb {
  private socket: Socket | null = null;
  private ready: Promise<Socket> | null = null;
  private buf = new Uint8Array(0);
  private pending: Pending[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private dps: Record<string, unknown> = {}; // último estado conhecido (avisos trazem só o que mudou)
  /** Chamado quando a lâmpada muda por fora do app. */
  onStatus: ((state: BulbState) => void) | null = null;
  /** Chamado quando uma conexão aberta morre sozinha (IP mudou, lâmpada reiniciou, Wi-Fi caiu). */
  onLost: (() => void) | null = null;

  private connect: Connect;
  private device: Device;

  constructor(connect: Connect, device: Device) {
    this.connect = connect;
    this.device = device;
  }

  private open(): Promise<Socket> {
    if (this.ready) return this.ready;
    const ready: Promise<Socket> = new Promise((resolve, reject) => {
      // Eventos de um socket antigo (já substituído) são ignorados.
      const current = () => this.ready === ready;
      // Sem resposta do TCP (Wi-Fi caiu, IP errado), desiste em vez de esperar para sempre.
      const timer = setTimeout(() => {
        const err = new Error('Lâmpada não encontrada na rede (confira o Wi-Fi e o IP)');
        reject(err);
        socket.destroy();
        if (current()) this.close(err);
      }, CONNECT_TIMEOUT_MS);
      const socket = this.connect(this.device.ip, PORT, () => {
        clearTimeout(timer);
        if (!current()) {
          socket.destroy();
          return reject(new Error('Conexão fechada'));
        }
        this.socket = socket;
        // Heartbeat sem resposta derruba a conexão (onLost) em vez de esperar o próximo toque.
        this.heartbeat = setInterval(() => this.sendOnce(CMD_HEARTBEAT, {}).catch(() => {}), HEARTBEAT_MS);
        resolve(socket);
      });
      socket.on('data', (chunk) => current() && this.onData(chunk));
      socket.on('error', (e) => {
        clearTimeout(timer);
        const msg = e?.message || String(e ?? 'erro de rede');
        reject(new Error(`Sem conexão com a lâmpada: ${msg}`));
        if (current()) this.drop(socket, new Error(`Conexão perdida: ${msg}`));
      });
      socket.on('close', () => {
        clearTimeout(timer);
        reject(new Error('Conexão encerrada pela lâmpada'));
        if (current()) this.drop(socket, new Error('Conexão encerrada pela lâmpada'));
      });
    });
    this.ready = ready;
    return ready;
  }

  private onData(chunk: Uint8Array) {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    try {
      for (let frame = decodeFrame(this.device, this.buf); frame; frame = decodeFrame(this.device, this.buf)) {
        this.buf = this.buf.subarray(frame.size);
        const dps = (frame.data as { dps?: Record<string, unknown> } | null)?.dps;
        if (frame.cmd === CMD_STATUS && dps) {
          this.dps = { ...this.dps, ...dps };
          this.onStatus?.(parseState(this.dps));
        }
        const i = this.pending.findIndex((p) => p.cmd === frame!.cmd);
        if (i >= 0) {
          const [p] = this.pending.splice(i, 1);
          clearTimeout(p.timer);
          p.resolve(frame.data);
        }
      }
    } catch (e) {
      this.close(e as Error);
    }
  }

  // Todos os comandos são idempotentes (valores absolutos): se a conexão caiu
  // (Wi-Fi trocou, lâmpada reiniciou), reabre e tenta mais uma vez.
  async send(cmd: number, body: object): Promise<object | null> {
    try {
      return await this.sendOnce(cmd, body);
    } catch {
      this.close(new Error('Reconectando'));
      return this.sendOnce(cmd, body);
    }
  }

  private async sendOnce(cmd: number, body: object): Promise<object | null> {
    const socket = await this.open();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = this.pending.filter((p) => p.timer !== timer);
        reject(new Error('Lâmpada não respondeu (confira o Wi-Fi e o IP)'));
        this.drop(socket, new Error('Tempo esgotado'));
      }, TIMEOUT_MS);
      this.pending.push({ cmd, resolve, reject, timer });
      socket.write(encodeFrame(this.device, cmd, body));
    });
  }

  // Fecha por erro de rede; se a conexão já estava aberta, avisa quem usa a lâmpada.
  // O aviso vai depois da nova tentativa do send(): avisar na hora abriria duas conexões
  // que se fecham uma à outra e o comando do usuário se perderia.
  private drop(socket: Socket, reason: Error) {
    const wasOpen = this.socket === socket;
    this.close(reason);
    if (wasOpen) setTimeout(() => this.onLost?.(), 0);
  }

  close(reason = new Error('Conexão fechada')) {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.socket?.destroy();
    this.socket = null;
    this.ready = null;
    this.buf = new Uint8Array(0);
    for (const p of this.pending.splice(0)) {
      clearTimeout(p.timer);
      p.reject(reason);
    }
  }

  async getState(): Promise<BulbState> {
    const id = this.device.id;
    const res = (await this.send(CMD_QUERY, { gwId: id, devId: id, uid: id, t: now() })) as {
      dps?: Record<string, unknown>;
    } | null;
    if (!res?.dps) throw new Error('Resposta sem estado da lâmpada');
    this.dps = { ...this.dps, ...res.dps };
    return parseState(this.dps);
  }

  async set(dps: Record<string, unknown>): Promise<void> {
    const id = this.device.id;
    await this.send(CMD_CONTROL, { devId: id, uid: id, t: now(), dps });
    this.dps = { ...this.dps, ...dps };
  }
}

const now = () => String(Math.floor(Date.now() / 1000));
const pct = (v: number, max: number) => Math.round((v / max) * 100);
const hex4 = (n: number) => Math.round(n).toString(16).padStart(4, '0');

function parseState(dps: Record<string, unknown>): BulbState {
  const colour = String(dps['24'] ?? '000003e803e8');
  const isColour = dps['21'] === 'colour';
  return {
    on: dps['20'] === true,
    mode: String(dps['21'] ?? 'white'),
    brightness: pct(isColour ? parseInt(colour.slice(8, 12), 16) : Number(dps['22'] ?? 1000), 1000),
    temp: pct(Number(dps['23'] ?? 0), 1000),
    hue: parseInt(colour.slice(0, 4), 16),
    saturation: pct(parseInt(colour.slice(4, 8), 16), 1000),
  };
}

// Comandos de alto nível (valores em %; brilho mínimo 1% = 10 na lâmpada).
export const commands = {
  power: (on: boolean) => ({ '20': on }),
  white: (brightness: number, temp: number) => ({
    '20': true,
    '21': 'white',
    '22': Math.round(Math.max(10, brightness * 10)),
    '23': Math.round(temp * 10),
  }),
  colour: (hue: number, saturation: number, brightness: number) => ({
    '20': true,
    '21': 'colour',
    '24': hex4(hue) + hex4(saturation * 10) + hex4(Math.max(10, brightness * 10)),
  }),
};

// Anúncio UDP (porta 6667) que a lâmpada manda a cada ~5 s com gwId e IP atual. Na 3.3 vem
// cifrado com a chave pública do protocolo, md5("yGAdlopoPVldABfn").
const ANNOUNCE_PORT = 6667;
const ANNOUNCE_KEY = aesjs.utils.hex.toBytes('6c1ec8e2bb9bb59ab50b0daf649b410a');
const ANNOUNCE_MS = 12000; // cobre dois anúncios, mesmo perdendo um

function decodeAnnounce(msg: Uint8Array): { gwId: string; ip: string } | null {
  try {
    const payload = msg.subarray(20, msg.length - 8);
    if (payload.length === 0 || payload.length % 16 !== 0) return null;
    const plain = aesjs.padding.pkcs7.strip(new aesjs.ModeOfOperation.ecb(ANNOUNCE_KEY).decrypt(payload));
    const data = JSON.parse(aesjs.utils.utf8.fromBytes(plain)) as { gwId?: string; ip?: string };
    return data.gwId && data.ip ? { gwId: data.gwId, ip: data.ip } : null;
  } catch {
    return null;
  }
}

// Escuta datagramas UDP numa porta; devolve a função que para de escutar.
export type Listen = (port: number, onMessage: (msg: Uint8Array) => void) => () => void;

// No Android o react-native-tcp-socket faz cada connect numa fila de só 2 threads e o
// connect bloqueia até o timeout nativo. Por isso: timeout nativo curto, lotes pequenos e
// o timer do JS só como rede de segurança (com folga para a fila).
const PROBE_MS = 400;
const PROBE_BATCH = 4;

// Porta 6668 aberta neste IP? (só abre e fecha o TCP)
function probe(connect: Connect, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), PROBE_MS * PROBE_BATCH);
    const socket = connect(host, PORT, () => finish(true), PROBE_MS);
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
  });
}

// O roteador dá outro IP à lâmpada com frequência (ela ou o Wi-Fi reiniciam).
// Dois caminhos ao mesmo tempo, o primeiro que achar vence:
// 1. o anúncio UDP da própria lâmpada (chega em até ~5 s, qualquer IP);
// 2. a varredura TCP da /24 do IP salvo, começando pelos vizinhos (se o UDP for filtrado).
// Em ambos, só vale o IP onde a nossa chave abre a conversa.
export async function findBulb(connect: Connect, device: Device, listen?: Listen): Promise<Device | null> {
  const checks = new Map<string, Promise<boolean>>();
  const verify = (ip: string) => {
    let p = checks.get(ip);
    if (!p) {
      const bulb = new Bulb(connect, { ...device, ip });
      p = bulb.getState().then(
        () => true,
        () => false,
      );
      // Falha pode ser passageira (a lâmpada acabou de religar): o próximo anúncio tenta de novo.
      p.then((ok) => {
        bulb.close();
        if (!ok) checks.delete(ip);
      });
      checks.set(ip, p);
    }
    return p;
  };
  let found: string | null = null;
  const stop = () => found !== null;
  const announced = listen ? listenAnnounce(listen, device.id, verify, stop) : Promise.resolve(null);
  const scanned = scan(connect, device, verify, stop);
  found = await Promise.race([
    announced.then((ip) => ip ?? scanned),
    scanned.then((ip) => ip ?? announced),
  ]);
  return found ? { ...device, ip: found } : null;
}

function listenAnnounce(
  listen: Listen,
  id: string,
  verify: (ip: string) => Promise<boolean>,
  stop: () => boolean,
): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    let expired = false;
    let checking = 0; // anúncios recebidos ainda em confirmação
    let unlisten: () => void = () => {};
    const quiet = () => {
      unlisten();
      unlisten = () => {};
    };
    const finish = (ip: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      quiet();
      resolve(ip);
    };
    // No prazo para de ouvir, mas espera a confirmação de um anúncio já recebido.
    const timer = setTimeout(() => {
      expired = true;
      quiet();
      if (!checking) finish(null);
    }, ANNOUNCE_MS);
    try {
      unlisten = listen(ANNOUNCE_PORT, (msg) => {
        if (done || expired) return;
        if (stop()) return finish(null); // a varredura já achou: libera a porta
        const a = decodeAnnounce(msg);
        if (a?.gwId !== id) return;
        checking++;
        verify(a.ip).then((ok) => {
          checking--;
          if (ok) finish(a.ip);
          else if (expired && !checking) finish(null);
        });
      });
    } catch {
      finish(null);
    }
  });
}

async function scan(
  connect: Connect,
  device: Device,
  verify: (ip: string) => Promise<boolean>,
  stop: () => boolean,
): Promise<string | null> {
  const prefix = device.ip.split('.').slice(0, 3).join('.');
  const last = Number(device.ip.split('.')[3]);
  const hosts = Array.from({ length: 254 }, (_, i) => i + 1)
    .filter((n) => n !== last)
    .sort((a, b) => Math.abs(a - last) - Math.abs(b - last))
    .map((n) => `${prefix}.${n}`);
  for (let i = 0; i < hosts.length && !stop(); i += PROBE_BATCH) {
    const batch = hosts.slice(i, i + PROBE_BATCH);
    const open = await Promise.all(batch.map((h) => probe(connect, h)));
    // Porta aberta mas chave recusada = outro aparelho Tuya.
    for (const ip of batch.filter((_, j) => open[j])) if (!stop() && (await verify(ip))) return ip;
  }
  return null;
}
