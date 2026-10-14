// A virtual Fulcrum: a simulated robot that speaks the real firmware's USB protocol (and the Uno
// bootloader's), so the Robot tab can be tried, and tested, before the cardboard one exists.
// It mirrors firmware/Fulcrum/Fulcrum.ino using the same core modules the simulator trains with.
import * as S from '../core/spec.js';
import { BeamEnv, Tracker, stepIntegral, makeObs } from '../core/world.js';
import { Rng } from '../core/rng.js';
import { Calibrator, ServoBuild, CAL_POINTS } from '../core/calibrate.js';
import { packBrain, unpackBrain, runPacked } from '../core/brain.js';
import { STARTER_ACTOR } from './starter_brain.js';

const enc = new TextEncoder();
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const jsRound = Math.round;

export class VirtualPort {
  constructor({ seed = Math.floor(Math.random() * 1e6), imu = true } = {}) {
    this.seed = seed; this.imu = imu; this.opened = false; this.inBoot = false;
    this.flash = null; this.knob = 512;
    const rng = new Rng(seed);
    this.env = new BeamEnv(seed * 3 + 1, { dr: 1 });
    this.env.events = false;
    this.env.reset(); this.env.x = 0.3; this.env.v = 0;
    this.build = new ServoBuild(this.env, rng, { hasImu: imu });
    this.eeBrain = packBrain(STARTER_ACTOR, { name: 'starter' });
    this.boot();
  }
  getInfo() { return { usbVendorId: 0x2341, usbProductId: 0x0043 }; }

  // ---------------------------------------------------------------- Web Serial surface
  async open() {
    this.opened = true;
    this.readable = new ReadableStream({ start: c => { this.rc = c; } });
    this.writable = new WritableStream({ write: chunk => this.receive(chunk) });
    this.boot();                                     // opening the port resets an Uno
    this.timer = setInterval(() => this.tick(), S.DT * 1000);
  }
  async close() { clearInterval(this.timer); this.opened = false; try { this.rc.close(); } catch (e) { } }
  async setSignals(sig) {
    if (sig.dataTerminalReady === false) { this.dtrLow = true; return; }
    if (sig.dataTerminalReady === true && this.dtrLow) { this.dtrLow = false; this.inBoot = true; this.bootUntil = performance.now() + 1000; this.flashImage = new Uint8Array(32768).fill(0xff); }
  }
  out(s) { if (this.opened && this.rc) try { this.rc.enqueue(enc.encode(s)); } catch (e) { } }
  line(s) { this.out(s + '\n'); }

  // ---------------------------------------------------------------- firmware state
  boot() {
    this.mode = S.MODE.IDLE; this.target = S.X_CENTER; this.knobMode = true;
    this.trk = new Tracker(); this.integ = 0; this.a1 = 0; this.a2 = 0; this.lastU = 0;
    this.calm = 0; this.settled = false; this.uploading = null; this.buf = '';
    this.cfg ||= { calDone: false, table: null, trim: 0, usLevel: S.SERVO_CENTER_US, usPerDeg: S.DEFAULT_US_PER_DEG, kp: S.PID_KP, ki: S.PID_KI, kd: S.PID_KD, sign: 1, ref: null, axis: null };
    this.loadBrain();
    this.servoUs = this.beamToUs(0);
    this.ms0 = performance.now();
    setTimeout(() => this.hello(), 30);
  }
  loadBrain() {
    try { const b = unpackBrain(this.eeBrain); this.brain = b.crcOk && b.sizes[0] === S.NET_IN ? b : null; } catch (e) { this.brain = null; }
  }
  hello() { this.line(`HI Fulcrum ${S.FIRMWARE_VERSION} spec=${S.SPEC_VERSION} brain=${this.brain ? this.brain.name : '-'} cal=${this.cfg.calDone ? 1 : 0} gyro=${this.imu ? 1 : 0} mode=${this.mode} think=7400`); }

  beamToUs(deg) {
    deg += this.cfg.trim;
    if (this.cfg.table) {
      const pos = deg - S.CAL_TABLE_MIN_DEG, i = clamp(Math.floor(pos), 0, S.CAL_TABLE_N - 2), f = pos - i, t = this.cfg.table;
      return clamp(jsRound(t[i] + f * (t[i + 1] - t[i])), S.SERVO_MIN_US, S.SERVO_MAX_US);
    }
    return clamp(jsRound(this.cfg.usLevel + deg * this.cfg.usPerDeg), S.SERVO_MIN_US, S.SERVO_MAX_US);
  }

  setMode(m) {
    if (m < 0 || m > S.MODE.CAL) return;
    this.mode = m; this.integ = 0; this.a1 = 0; this.a2 = 0; this.calm = 0; this.settled = false; this.holdRaw = false; this.holdU = 0;
    if (m === S.MODE.CAL) {
      this.cal = new Calibrator({ hasImu: this.imu, usLevel: this.cfg.usLevel, usPerDeg: this.cfg.usPerDeg });
      this.calLogged = 0;
      this.line(this.imu ? 'CS gyro' : 'CS nogyro');
    }
    this.line(`EV mode ${m}`);
  }

  tick() {
    if (!this.opened || this.inBoot || this.uploading) return;
    const env = this.env;
    const reading = env.lastReading;
    const kind = this.trk.update(reading);
    const g = this.build.accel();
    if (this.knobMode && this.mode !== S.MODE.CAL) this.target = S.TARGET_MIN + (S.TARGET_MAX - S.TARGET_MIN) * this.knob / 1023;
    this.integ = stepIntegral(this.integ, this.trk.x - this.target);
    const e = this.trk.x - this.target;
    if (Math.abs(e) < 0.015 && Math.abs(this.trk.v) < 0.03) this.calm++; else this.calm = 0;
    const now = this.calm >= 12;
    if (now && !this.settled && (this.mode === 1 || this.mode === 2)) this.line('EV settled');
    this.settled = now;
    let u = 0, us;
    if (this.mode === S.MODE.BRAIN && this.brain) {
      const o = new Float32Array(S.NET_IN);
      makeObs(o, this.trk.x, this.trk.v, this.target, this.a1, this.a2, this.integ);
      u = runPacked(this.brain, o);
    } else if (this.mode === S.MODE.PID) u = clamp(-(this.cfg.kp * e + this.cfg.ki * this.integ + this.cfg.kd * this.trk.v), -1, 1);
    else if (this.mode === S.MODE.MANUAL) u = clamp(this.knob / 511.5 - 1, -1, 1);
    else if (this.mode === S.MODE.HOLD) u = this.holdU;
    if (this.mode === S.MODE.CAL) {
      us = this.cal.tick({ x: this.trk.x, v: this.trk.v, g: this.imu ? g : null });
      u = this.cal.lastU;
      for (; this.calLogged < this.cal.log.length; this.calLogged++) this.line(this.cal.log[this.calLogged]);
    } else if (this.mode === S.MODE.HOLD && this.holdRaw) us = this.holdUs;
    else us = this.beamToUs(u * S.THETA_MAX_DEG);
    this.servoUs = clamp(us, S.SERVO_MIN_US, S.SERVO_MAX_US);
    this.a2 = this.a1; this.a1 = u; this.lastU = u;
    this.build.stepUs(this.servoUs, u);
    // the beam angle the gyro reports (true angle from level, as calibrated)
    const ang = this.cfg.calDone && this.imu ? env.th * 180 / Math.PI : u * S.THETA_MAX_DEG;
    const flags = (kind === 1 ? 1 : 0) | (kind === 2 ? 2 : 0) | (this.imu ? 4 : 0) | (this.brain ? 8 : 0) | (this.knobMode ? 16 : 0) | (this.settled ? 32 : 0) | (this.cfg.calDone ? 64 : 0) | (kind === 3 ? 128 : 0);
    const ms = Math.round(performance.now() - this.ms0);
    this.line(`T ${ms} ${this.mode} ${reading < 0 ? -1 : jsRound(reading * 1000)} ${jsRound(this.trk.x * 1000)} ${jsRound(this.trk.v * 1000)} ${jsRound(this.target * 1000)} ${jsRound(u * 1000)} ${jsRound(this.integ * 1e5)} ${jsRound(ang * 100)} ${this.servoUs} ${this.knob} 9800 ${flags}`);
    if (this.mode === S.MODE.CAL && this.cal.done) this.applyCal();
  }

  applyCal() {
    const c = this.cal;
    if (c.ok) {
      if (c.hasImu && c.table) { this.cfg.table = c.table.slice(); this.cfg.sign = c.sign; }
      else { this.cfg.usPerDeg = c.usPerDeg; this.cfg.table = null; }
      this.cfg.trim = c.levelSure ? c.trimDeg : 0;
      this.cfg.calDone = true;
    }
    this.setMode(S.MODE.IDLE);
  }

  // ---------------------------------------------------------------- bytes from the Gym
  receive(chunk) {
    if (this.inBoot) return this.bootloader(chunk);
    for (const b of chunk) {
      const ch = String.fromCharCode(b);
      if (ch === '\n' || ch === '\r') { if (this.buf) { this.command(this.buf); this.buf = ''; } }
      else this.buf += ch;
    }
  }

  command(line) {
    const [cmd, a, b, c] = line.trim().split(/\s+/);
    const ok = () => this.line(`OK ${cmd}`);
    switch (cmd) {
      case '?': this.hello(); break;
      case 'M': this.setMode(+a); break;
      case 'C': this.setMode(S.MODE.CAL); break;
      case 'G': if (+a < 0) this.knobMode = true; else { this.target = clamp(+a / 1000, S.TARGET_MIN, S.TARGET_MAX); this.knobMode = false; } ok(); break;
      case 'U': this.holdU = clamp(+a / 1000, -1, 1); this.holdRaw = false; ok(); break;
      case 'W': this.holdUs = +a; this.holdRaw = true; ok(); break;
      case 'T': ok(); break;
      case 'BB':
        if (+a < 32 || +a > S.EE_BRAIN_MAX) { this.line('BERR size'); break; }
        if (this.mode === 1 || this.mode === 5) this.setMode(0);
        this.uploading = new Uint8Array(+a); this.brain = null; this.line('BR'); break;
      case 'BD': {
        if (!this.uploading) { this.line('BERR state'); break; }
        const off = +a, hex = b || '';
        if (off + hex.length / 2 > this.uploading.length) { this.line('BERR range'); break; }
        for (let i = 0; i < hex.length / 2; i++) this.uploading[off + i] = parseInt(hex.substr(2 * i, 2), 16);
        setTimeout(() => this.line(`BA ${off}`), 12 * hex.length / 2 * 0.25);   // EEPROM writes take a moment
        break;
      }
      case 'BE': {
        const data = this.uploading; this.uploading = null;
        this.eeBrain = data; this.loadBrain();
        this.line(this.brain && this.brain.bytes === data.length ? `BOK ${this.brain.name}` : 'BERR crc');
        break;
      }
      case 'BF': this.eeBrain = packBrain(STARTER_ACTOR, { name: 'starter' }); this.loadBrain(); this.line('BOK starter'); break;
      case 'P': this.cfg.kp = +a / 1000; this.cfg.ki = +b / 1000; this.cfg.kd = +c / 1000; ok(); break;
      case 'L': this.cfg.trim = +a / 100; ok(); break;
      case 'S': this.line(`CFG cal=${this.cfg.calDone ? 1 : 0} table=${this.cfg.table ? 1 : 0} trim=${jsRound(this.cfg.trim * 100)} (virtual robot)`); break;
      case 'Y': case 'X': case 'A': case 'Q': case 'D': case 'K': case 'R': ok(); break;
      default: this.line(`ERR ${cmd}`);
    }
  }

  // a minimal Optiboot: enough STK500 for the Gym's installer to write and verify
  bootloader(chunk) {
    this.bl = this.bl ? Uint8Array.from([...this.bl, ...chunk]) : Uint8Array.from(chunk);
    const reply = bytes => this.out(String.fromCharCode(...bytes));
    for (;;) {
      const q = this.bl;
      if (!q.length) return;
      const op = q[0];
      const need = { 0x30: 2, 0x75: 2, 0x50: 2, 0x51: 2, 0x55: 4, 0x74: 5 }[op] ?? (op === 0x64 ? (q.length >= 3 ? 5 + ((q[1] << 8) | q[2]) : Infinity) : 1);
      if (q.length < need) return;
      const msg = q.slice(0, need); this.bl = q.slice(need);
      if (op === 0x30) this.rawReply([0x14, 0x10]);
      else if (op === 0x75) this.rawReply([0x14, 0x1e, 0x95, 0x0f, 0x10]);
      else if (op === 0x50) this.rawReply([0x14, 0x10]);
      else if (op === 0x55) { this.addr = ((msg[2] << 8) | msg[1]) * 2; this.rawReply([0x14, 0x10]); }
      else if (op === 0x64) { const n = (msg[1] << 8) | msg[2]; this.flashImage.set(msg.slice(4, 4 + n), this.addr); this.rawReply([0x14, 0x10]); }
      else if (op === 0x74) { const n = (msg[1] << 8) | msg[2]; this.rawReply([0x14, ...this.flashImage.slice(this.addr, this.addr + n), 0x10]); }
      else if (op === 0x51) { this.rawReply([0x14, 0x10]); this.inBoot = false; this.bl = null; setTimeout(() => this.boot(), 300); return; }
      else this.rawReply([0x14, 0x10]);
      void reply;
    }
  }
  rawReply(bytes) { if (this.opened && this.rc) try { this.rc.enqueue(Uint8Array.from(bytes)); } catch (e) { } }
}
void CAL_POINTS;
