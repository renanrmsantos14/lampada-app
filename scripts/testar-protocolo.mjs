// Teste offline do protocolo: simula a lâmpada (respostas e avisos de status) sem rede.
// Uso: node scripts/testar-protocolo.mjs
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import aesjs from 'aes-js';
import { Bulb, decodeFrame } from '../src/tuya.ts';

const dev = { id: 'abc', ip: '10.0.0.1', key: '0123456789abcdef' };
const enc = (obj) =>
  new aesjs.ModeOfOperation.ecb(aesjs.utils.utf8.toBytes(dev.key)).encrypt(
    aesjs.padding.pkcs7.pad(aesjs.utils.utf8.toBytes(JSON.stringify(obj))),
  );

// Frame como a lâmpada manda: com código de retorno (respostas) ou com cabeçalho 3.3 (avisos).
function frame(cmd, obj, { retcode = true, header33 = false } = {}) {
  let body = [...enc(obj)];
  if (header33) body = [...'3.3'].map((c) => c.charCodeAt(0)).concat(new Array(12).fill(0), body);
  if (retcode) body = [0, 0, 0, 0, ...body];
  const f = new Uint8Array(16 + body.length + 8);
  const v = new DataView(f.buffer);
  v.setUint32(0, 0x55aa);
  v.setUint32(8, cmd);
  v.setUint32(12, body.length + 8);
  f.set(body, 16);
  v.setUint32(20 + body.length, 0xaa55);
  return f;
}

// 1) decodeFrame nos dois formatos
assert.deepEqual(decodeFrame(dev, frame(10, { dps: { 20: true } })).data, { dps: { 20: true } });
assert.deepEqual(decodeFrame(dev, frame(8, { dps: { 22: 500 } }, { retcode: false, header33: true })).data, { dps: { 22: 500 } });
assert.deepEqual(decodeFrame(dev, frame(8, { dps: { 22: 500 } }, { retcode: true, header33: true })).data, { dps: { 22: 500 } });

// 2) Bulb: consulta, depois aviso parcial de status mesclado ao estado conhecido
const sock = new EventEmitter();
sock.write = () => {};
sock.destroy = () => {};
const bulb = new Bulb((_h, _p, cb) => (setImmediate(cb), sock), dev);
const seen = [];
bulb.onStatus = (s) => seen.push(s);
const got = bulb.getState();
setTimeout(() => sock.emit('data', frame(10, { dps: { 20: true, 21: 'white', 22: 1000, 23: 0 } })), 5);
const s1 = await got;
assert.equal(s1.brightness, 100);
sock.emit('data', frame(8, { dps: { 22: 500 } }, { retcode: false, header33: true }));
assert.equal(seen.length, 1);
assert.equal(seen[0].brightness, 50);
assert.equal(seen[0].on, true); // manteve o que não veio no aviso
bulb.close();
console.log('OK: protocolo (respostas, avisos de status e mescla)');
process.exit(0);
