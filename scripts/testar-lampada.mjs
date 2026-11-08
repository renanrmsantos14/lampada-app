// Teste do protocolo contra a lâmpada real, pelo Node (sem celular).
// Uso: node scripts/testar-lampada.mjs caminho/devices.json
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { Bulb, commands } from '../src/tuya.ts';

const [d] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const bulb = new Bulb((host, port, cb) => net.createConnection({ host, port }, cb), { id: d.id, ip: d.ip, key: d.key });

const timed = async (label, fn) => {
  const t0 = performance.now();
  const r = await fn();
  console.log(`${label}: ${Math.round(performance.now() - t0)} ms`);
  return r;
};

const inicial = await timed('estado inicial (abre conexão)', () => bulb.getState());
const resultados = [];
for (let i = 0; i < 3; i++) {
  await timed('desligar', () => bulb.set(commands.power(false)));
  resultados.push((await bulb.getState()).on === false);
  await timed('ligar', () => bulb.set(commands.power(true)));
  resultados.push((await bulb.getState()).on === true);
}
if (!inicial.on) await bulb.set(commands.power(false)); // restaura
bulb.close();
const ok = resultados.every(Boolean);
console.log(ok ? 'OK: liga/desliga confirmado 3x' : `FALHA: ${resultados}`);
process.exit(ok ? 0 : 1);
