// Talking to Fulcrum over USB with Web Serial (Chrome, from localhost or a file on this Mac).
// Two jobs: the text protocol the firmware speaks (see PROTOCOL.md), and installing the firmware
// itself through the Uno's bootloader (STK500v1, the same protocol the Arduino IDE uses).
import * as S from '../core/spec.js';

export const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Fulcrum {
  constructor() {
    this.port = null; this.reader = null; this.writer = null; this.buf = ''; this.raw = null;
    this.handlers = new Set(); this.waiters = []; this.reading = false; this.readLoopDone = null;
  }
  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  emit(line) {
    for (const w of [...this.waiters]) if (w.match(line)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(line); }
    for (const fn of this.handlers) fn(line);
  }

  async pick() {
    this.port = await navigator.serial.requestPort();
    return this.port;
  }

  async open() {
    await this.port.open({ baudRate: S.SERIAL_BAUD, bufferSize: 4096 });
    this.writer = this.port.writable.getWriter();
    this.startReading();
  }

  startReading() {
    this.reader = this.port.readable.getReader();
    this.reading = true;
    const dec = new TextDecoder();
    this.readLoopDone = (async () => {
      try {
        while (this.reading) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (this.raw) { this.raw.push(value); continue; }
          this.buf += dec.decode(value, { stream: true });
          let i;
          while ((i = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, i).replace(/\r$/, '');
            this.buf = this.buf.slice(i + 1);
            if (line) this.emit(line);
          }
        }
      } catch (e) { this.emit(`!error ${e.message}`); }
      finally { try { this.reader.releaseLock(); } catch (e) { } }
    })();
  }

  async close() {
    this.reading = false;
    try { await this.reader?.cancel(); } catch (e) { }
    try { await this.readLoopDone; } catch (e) { }
    try { this.writer?.releaseLock(); } catch (e) { }
    try { await this.port?.close(); } catch (e) { }
    this.reader = null; this.writer = null;
  }

  async send(line) {
    if (!this.writer) throw new Error('not connected');
    await this.writer.write(new TextEncoder().encode(line + '\n'));
  }

  waitFor(match, ms = 2000) {
    return new Promise((resolve, reject) => {
      const w = { match: typeof match === 'string' ? l => l.startsWith(match) : match, resolve };
      this.waiters.push(w);
      setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); reject(new Error(`no reply (${typeof match === 'string' ? match : 'line'})`)); } }, ms);
    });
  }

  async ask(line, expect, ms = 2000) { const p = this.waitFor(expect, ms); await this.send(line); return p; }

  // brain upload: BB <len>, then BD <offset> <hex> chunks (each acknowledged), then BE
  async uploadBrain(u8, onProgress = () => { }) {
    await this.ask(`BB ${u8.length}`, l => l === 'BR' || l.startsWith('BERR'), 3000).then(l => { if (l !== 'BR') throw new Error(l); });
    const CH = 24;
    for (let off = 0; off < u8.length; off += CH) {
      const hex = Array.from(u8.subarray(off, off + CH), b => b.toString(16).padStart(2, '0')).join('');
      const r = await this.ask(`BD ${off} ${hex}`, l => l.startsWith('BA') || l.startsWith('BERR'), 3000);
      if (!r.startsWith(`BA ${off}`)) throw new Error(r);
      onProgress(Math.min(1, (off + CH) / u8.length));
    }
    const r = await this.ask('BE', l => l.startsWith('BOK') || l.startsWith('BERR'), 4000);
    if (!r.startsWith('BOK')) throw new Error(r === 'BERR crc' ? 'the robot rejected the brain (checksum mismatch)' : r);
    return r.slice(4);
  }

  // ------------------------------------------------------------------------- firmware install
  // Resets the Uno into its bootloader (Optiboot) and writes the program with STK500v1.
  async flash(hexText, onProgress = () => { }, log = () => { }) {
    const image = parseIntelHex(hexText);
    const PAGE = 128;
    this.raw = [];
    const rx = { take: () => { const out = []; for (const c of this.raw) out.push(...c); this.raw.length = 0; return out; } };
    let pending = [];
    const read = async (n, ms = 400) => {
      const t0 = performance.now();
      while (pending.length < n) {
        pending.push(...rx.take());
        if (pending.length >= n) break;
        if (performance.now() - t0 > ms) throw new Error('bootloader did not answer');
        await sleep(2);
      }
      const out = pending.slice(0, n); pending = pending.slice(n); return out;
    };
    const write = bytes => this.writer.write(new Uint8Array(bytes));
    const cmd = async (bytes, nData = 0, ms = 400) => {
      await write(bytes);
      const r = await read(2 + nData, ms);
      if (r[0] !== 0x14 || r[r.length - 1] !== 0x10) throw new Error(`bootloader said ${r.map(b => b.toString(16)).join(' ')}`);
      return r.slice(1, 1 + nData);
    };
    try {
      log('resetting the Arduino into its bootloader');
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
      await sleep(250);
      await this.port.setSignals({ dataTerminalReady: true, requestToSend: true });
      await sleep(50);
      rx.take(); pending = [];
      let synced = false;
      for (let i = 0; i < 12 && !synced; i++) {
        try { await cmd([0x30, 0x20], 0, 150); synced = true; } catch (e) { rx.take(); pending = []; }
      }
      if (!synced) throw new Error('could not reach the bootloader (is this an Arduino Uno?)');
      const sig = await cmd([0x75, 0x20], 3);
      log(`chip signature ${sig.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
      if (!(sig[0] === 0x1e && sig[1] === 0x95 && sig[2] === 0x0f)) throw new Error('this is not an ATmega328P (Arduino Uno)');
      await cmd([0x50, 0x20]);
      const pages = Math.ceil(image.length / PAGE);
      for (let p = 0; p < pages; p++) {
        const addr = (p * PAGE) >> 1;
        await cmd([0x55, addr & 0xff, addr >> 8, 0x20]);
        const page = Array.from(image.subarray(p * PAGE, p * PAGE + PAGE));
        while (page.length < PAGE) page.push(0xff);
        await cmd([0x64, 0x00, PAGE, 0x46, ...page, 0x20], 0, 800);
        onProgress((p + 1) / (pages * 2));
      }
      for (let p = 0; p < pages; p++) {
        const addr = (p * PAGE) >> 1;
        await cmd([0x55, addr & 0xff, addr >> 8, 0x20]);
        const got = await cmd([0x74, 0x00, PAGE, 0x46, 0x20], PAGE, 800);
        for (let i = 0; i < PAGE && p * PAGE + i < image.length; i++) if (got[i] !== image[p * PAGE + i]) throw new Error(`verify failed at byte ${p * PAGE + i}`);
        onProgress(0.5 + (p + 1) / (pages * 2));
      }
      await cmd([0x51, 0x20]);
      log(`wrote and verified ${image.length} bytes`);
    } finally {
      this.raw = null;
    }
  }
}

export function parseIntelHex(text) {
  const bytes = new Uint8Array(32768).fill(0xff);
  let base = 0, top = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(':')) continue;
    const b = line.slice(1).match(/../g).map(h => parseInt(h, 16));
    const n = b[0], addr = (b[1] << 8) | b[2], type = b[3];
    const sum = b.reduce((s, v) => s + v, 0) & 0xff;
    if (sum !== 0) throw new Error('firmware file is damaged (checksum)');
    if (type === 0) { for (let i = 0; i < n; i++) bytes[base + addr + i] = b[4 + i]; top = Math.max(top, base + addr + n); }
    else if (type === 1) break;
    else if (type === 2) base = ((b[4] << 8) | b[5]) << 4;
    else if (type === 4) base = ((b[4] << 8) | b[5]) << 16;
  }
  return bytes.subarray(0, top);
}

// "T ms mode raw x v tgt u I ang us knob tickUs flags" -> object (meters, seconds, degrees)
export function parseTelemetry(line) {
  const p = line.split(' ');
  if (p[0] !== 'T' || p.length < 14) return null;
  const n = p.slice(1).map(Number);
  const flags = n[12];
  return {
    ms: n[0], mode: n[1], raw: n[2] < 0 ? -1 : n[2] / 1000, x: n[3] / 1000, v: n[4] / 1000, target: n[5] / 1000,
    u: n[6] / 1000, integ: n[7] / 1e5, ang: n[8] / 100, us: n[9], knob: n[10], tickUs: n[11],
    used: !!(flags & 1), relock: !!(flags & 2), gyro: !!(flags & 4), brain: !!(flags & 8), knobMode: !!(flags & 16),
    settled: !!(flags & 32), calibrated: !!(flags & 64), blind: !!(flags & 128),
  };
}

export const IR_LABELS = {
  0x45: 'POWER', 0x46: 'VOL+', 0x47: 'FUNC/STOP', 0x44: '|◀◀', 0x40: '▶||', 0x43: '▶▶|', 0x07: '▼', 0x15: 'VOL−', 0x09: '▲',
  0x19: 'EQ', 0x0D: 'ST/REPT', 0x16: '0', 0x0C: '1', 0x18: '2', 0x5E: '3', 0x08: '4', 0x1C: '5', 0x5A: '6', 0x42: '7', 0x52: '8', 0x4A: '9',
};
