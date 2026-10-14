// Packing a trained brain for the robot: 8-bit weights (one scale per layer), float biases,
// a small header and a CRC-32, about 544 bytes in all, written into the Uno's EEPROM.
// runPacked() repeats the Arduino's arithmetic in 32-bit floats so the Gym can grade the
// exact brain the robot will run before it is sent.

import * as S from './spec.js';

const f32 = Math.fround;

export const BRAIN_FORMAT = 1;
export const HEADER_BYTES = 28;

export function quantizeActor(actor) {
  // actor: { layers: [{ inSize, outSize, W, b }] }
  return actor.layers.map(L => {
    let max = 0;
    for (const w of L.W) max = Math.max(max, Math.abs(w));
    const scale = f32(max > 0 ? max / 127 : 1);
    const Wq = new Int8Array(L.W.length);
    for (let i = 0; i < L.W.length; i++) Wq[i] = Math.max(-127, Math.min(127, Math.round(L.W[i] / scale)));
    return { inSize: L.inSize, outSize: L.outSize, scale, Wq, b: Float32Array.from(L.b) };
  });
}

export function packBrain(actor, { name = 'brain', created = Math.floor(Date.now() / 1000), score = 0 } = {}) {
  const layers = quantizeActor(actor);
  const sizes = [layers[0].inSize, ...layers.map(l => l.outSize)];
  if (sizes.length !== 4) throw new Error('Fulcrum brains have exactly two hidden layers');
  let n = HEADER_BYTES;
  for (const L of layers) n += 4 + L.Wq.length + 4 * L.outSize;
  n += 4;
  if (n > S.EE_BRAIN_MAX) throw new Error(`brain is ${n} bytes; EEPROM space is ${S.EE_BRAIN_MAX}`);
  const buf = new ArrayBuffer(n), dv = new DataView(buf), u8 = new Uint8Array(buf);
  u8[0] = S.BRAIN_MAGIC0; u8[1] = S.BRAIN_MAGIC1; u8[2] = BRAIN_FORMAT; u8[3] = S.SPEC_VERSION;
  u8[4] = sizes[0]; u8[5] = sizes[1]; u8[6] = sizes[2]; u8[7] = sizes[3];
  const nm = String(name).replace(/[^\x20-\x7e]/g, '').slice(0, S.BRAIN_NAME_LEN);
  for (let i = 0; i < S.BRAIN_NAME_LEN; i++) u8[8 + i] = i < nm.length ? nm.charCodeAt(i) : 0;
  dv.setUint32(20, created >>> 0, true);
  dv.setFloat32(24, score, true);
  let o = HEADER_BYTES;
  for (const L of layers) {
    dv.setFloat32(o, L.scale, true); o += 4;
    for (let i = 0; i < L.Wq.length; i++) dv.setInt8(o++, L.Wq[i]);
    for (let j = 0; j < L.outSize; j++) { dv.setFloat32(o, L.b[j], true); o += 4; }
  }
  dv.setUint32(o, crc32(u8.subarray(0, o)), true);
  return u8;
}

export function unpackBrain(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8[0] !== S.BRAIN_MAGIC0 || u8[1] !== S.BRAIN_MAGIC1) throw new Error('not a Fulcrum brain');
  const sizes = [u8[4], u8[5], u8[6], u8[7]];
  let name = '';
  for (let i = 0; i < S.BRAIN_NAME_LEN && u8[8 + i]; i++) name += String.fromCharCode(u8[8 + i]);
  const created = dv.getUint32(20, true), score = dv.getFloat32(24, true);
  let o = HEADER_BYTES;
  const layers = [];
  for (let l = 0; l < 3; l++) {
    const inSize = sizes[l], outSize = sizes[l + 1];
    const scale = dv.getFloat32(o, true); o += 4;
    const Wq = new Int8Array(inSize * outSize);
    for (let i = 0; i < Wq.length; i++) Wq[i] = dv.getInt8(o++);
    const b = new Float32Array(outSize);
    for (let j = 0; j < outSize; j++) { b[j] = dv.getFloat32(o, true); o += 4; }
    layers.push({ inSize, outSize, scale, Wq, b });
  }
  const crcStored = dv.getUint32(o, true), crcCalc = crc32(u8.subarray(0, o));
  return { format: u8[2], spec: u8[3], sizes, name, created, score, layers, bytes: o + 4, crcOk: crcStored === crcCalc, crc: crcStored };
}

// The Arduino's forward pass, float32 step by step: h = tanh(b + scale * sum(q * x))
export function runPacked(brain, obs, hidden = null) {
  let x = Array.from(obs, f32);
  for (let l = 0; l < 3; l++) {
    const L = brain.layers[l];
    const out = new Array(L.outSize);
    for (let j = 0; j < L.outSize; j++) {
      let acc = 0;
      for (let k = 0; k < L.inSize; k++) acc = f32(acc + f32(L.Wq[j * L.inSize + k] * x[k]));
      const s = f32(L.b[j] + f32(L.scale * acc));
      out[j] = l < 2 ? f32(Math.tanh(s)) : s;
    }
    if (hidden && l < 2) hidden[l] = out.slice();
    x = out;
  }
  return Math.max(-1, Math.min(1, x[0]));
}

export function brainPolicy(brain) {
  const o = new Float32Array(S.NET_IN);
  return obs => { for (let i = 0; i < S.NET_IN; i++) o[i] = obs[i]; return runPacked(brain, o); };
}

let CRC_TABLE = null;
export function crc32(u8) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const toHex = u8 => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
export function fromHex(s) { const u8 = new Uint8Array(s.length / 2); for (let i = 0; i < u8.length; i++) u8[i] = parseInt(s.substr(i * 2, 2), 16); return u8; }

// For the fallback path: a C header with the brain baked into flash.
export function brainToCHeader(u8, name) {
  const rows = [];
  for (let i = 0; i < u8.length; i += 16) rows.push('  ' + Array.from(u8.subarray(i, i + 16), b => '0x' + b.toString(16).padStart(2, '0')).join(', '));
  return `// Fulcrum brain "${name}" (${u8.length} bytes), exported from the Gym.\n// Replace firmware/Fulcrum/factory_brain.h with this file to bake the brain into the firmware.\n#pragma once\n#include <avr/pgmspace.h>\nconst uint16_t FACTORY_BRAIN_LEN = ${u8.length};\nconst uint8_t FACTORY_BRAIN[] PROGMEM = {\n${rows.join(',\n')}\n};\n`;
}
