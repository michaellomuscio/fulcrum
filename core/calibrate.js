// Calibration, exactly as the firmware runs it (Fulcrum.ino's calibrationTick is a line-by-line
// port of Calibrator.tick). Written here first so it can be proven on simulated builds.
//
// With a gyro board:
//   0-2  read "up" at the servo's middle and both extremes; the two extremes give the pivot axis,
//        so the board can be stuck on in any orientation
//   3-4  sweep down and up, recording beam angle against servo microseconds (both ways cancels slop)
//   5    ball test: roll the ball one way, then the other, to learn which way is "away from the sensor"
//   6    auto-level: hold the ball mid-track; the average tilt that keeps it still is true level
// Without one, it starts at 5 with the default microseconds-per-degree guess.

import * as S from './spec.js';

export const CAL_POINTS = 2 * S.SERVO_SWEEP_US / S.CAL_STEP_US + 1;
export const sweepUs = i => S.SERVO_CENTER_US - S.SERVO_SWEEP_US + i * S.CAL_STEP_US;
const RAD = 180 / Math.PI;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function unit(v) { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; }

// beam rotation in degrees about the pivot axis, relative to the reference pose
export function imuAngle(g, ref, axis) {
  const u = unit(g);
  return Math.atan2(dot(axis, cross(ref, u)), dot(ref, u)) * RAD;
}

export class Calibrator {
  constructor({ hasImu, usLevel = S.SERVO_CENTER_US, usPerDeg = S.DEFAULT_US_PER_DEG } = {}) {
    this.hasImu = hasImu;
    this.usLevel = usLevel; this.usPerDeg = usPerDeg;
    this.phase = hasImu ? 0 : 5;
    this.t = 0; this.idx = 0; this.n = 0;
    this.acc = [0, 0, 0]; this.aAcc = 0;
    this.ref = null; this.axis = null; this.gA = null;
    this.up = new Array(CAL_POINTS).fill(0);
    this.dn = new Array(CAL_POINTS).fill(0);
    this.sign = 1; this.usN = 0; this.usP = 0; this.x0 = 0;
    this.trimDeg = 0; this.lvTrim = 0; this.lvSum = 0; this.lvN = 0;
    this.table = null; this.done = false; this.ok = false; this.levelSure = false;
    this.log = [];
    this.lastU = 0;          // the tilt we meant, for the brain's action history
  }

  sweepAng(i, sign) { return sign * (this.up[i] + this.dn[i]) * 0.005; }   // up/dn hold hundredths of a degree

  // servo microseconds that give this beam angle on the swept curve. Past the measured range it
  // stops at the end (beyond the sweep a crank linkage can fold back, so never extrapolate).
  usForAngle(deg, sign) {
    let best = -1, loI = 0, hiI = 0;
    const mid = (CAL_POINTS - 1) / 2;
    for (let i = 0; i < CAL_POINTS; i++) {
      if (this.sweepAng(i, sign) < this.sweepAng(loI, sign)) loI = i;
      if (this.sweepAng(i, sign) > this.sweepAng(hiI, sign)) hiI = i;
      if (i + 1 >= CAL_POINTS) break;
      const a = this.sweepAng(i, sign), b = this.sweepAng(i + 1, sign);
      if (a === b) continue;
      if ((a - deg) * (b - deg) <= 0 && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    }
    if (best < 0) return deg < this.sweepAng(loI, sign) ? sweepUs(loI) : sweepUs(hiI);
    const a = this.sweepAng(best, sign), b = this.sweepAng(best + 1, sign);
    return sweepUs(best) + (deg - a) / (b - a) * S.CAL_STEP_US;
  }

  // how far the beam can tilt each way from the servo's middle, per the sweep (degrees, sign +1)
  reach() {
    let lo = 0, hi = 0;
    for (let i = 0; i < CAL_POINTS; i++) { const a = this.sweepAng(i, 1); lo = Math.min(lo, a); hi = Math.max(hi, a); }
    return [lo, hi];
  }

  // the commanded-degrees -> microseconds map the robot will use from now on (trim not included)
  beamToUs(deg) {
    if (this.table) {
      const pos = deg - S.CAL_TABLE_MIN_DEG;
      const i = clamp(Math.floor(pos), 0, S.CAL_TABLE_N - 2), f = pos - i;
      return clamp(Math.round(this.table[i] + f * (this.table[i + 1] - this.table[i])), S.SERVO_MIN_US, S.SERVO_MAX_US);
    }
    return clamp(Math.round(this.usLevel + deg * this.usPerDeg), S.SERVO_MIN_US, S.SERVO_MAX_US);
  }

  // one 40 ms tick. sense = { x, v } from the tracker, g = accelerometer vector (or null).
  // Returns the servo command in microseconds.
  tick({ x, v, g }) {
    this.t++;
    const T = this.t;
    if (this.phase <= 2) {
      const us = this.phase === 0 ? S.SERVO_CENTER_US : this.phase === 1 ? sweepUs(0) : sweepUs(CAL_POINTS - 1);
      const settle = this.phase === 2 ? S.CAL_SETTLE_TICKS + 10 : S.CAL_SETTLE_TICKS;
      if (T > settle && g) { for (let k = 0; k < 3; k++) this.acc[k] += g[k]; this.n++; }
      if (T >= settle + 8) {
        const u = unit(this.acc);
        if (this.phase === 0) this.ref = u;
        else if (this.phase === 1) this.gA = u;
        else {
          const c = cross(this.gA, u);
          const s = Math.hypot(c[0], c[1], c[2]);
          if (s < 0.035) {                   // under 2 degrees of motion: the gyro isn't on the beam
            this.log.push('CE gyro');
            this.hasImu = false; this.phase = 5; this.t = 0; return this.usLevel;
          }
          this.axis = unit(c);
          this.log.push(`CA ${Math.round(Math.atan2(s, Math.sqrt(1 - Math.min(1, s * s))) * RAD * 10)}`);
        }
        this.acc = [0, 0, 0]; this.n = 0; this.t = 0; this.idx = 0; this.aAcc = 0;
        this.phase++;
      }
      return us;
    }
    if (this.phase === 3 || this.phase === 4) {      // 3 sweeps down, 4 sweeps back up
      const i = this.phase === 3 ? CAL_POINTS - 1 - this.idx : this.idx;
      const us = sweepUs(i);
      if (T > S.CAL_POINT_TICKS - 3 && g) { this.aAcc += imuAngle(g, this.ref, this.axis); this.n++; }
      if (T >= S.CAL_POINT_TICKS) {
        const a = Math.round(this.aAcc / Math.max(1, this.n) * 100);
        if (this.phase === 3) this.dn[i] = a; else this.up[i] = a;
        this.log.push(`${this.phase === 3 ? 'CPD' : 'CPU'} ${us} ${a}`);
        this.t = 0; this.aAcc = 0; this.n = 0;
        if (++this.idx >= CAL_POINTS) { this.idx = 0; this.phase++; }
      }
      return us;
    }
    if (this.phase === 5) {                          // ball test: tilt P, then N, then P again
      if (T === 1) {
        if (this.hasImu) {
          // as hard as the linkage allows, up to BALLTEST_DEG each way
          const [lo, hi] = this.reach();
          const tilt = Math.min(S.BALLTEST_DEG, 0.9 * Math.min(-lo, hi));
          this.usN = Math.round(this.usForAngle(-tilt, 1)); this.usP = Math.round(this.usForAngle(tilt, 1));
        }
        else { this.usN = this.usLevel - S.BALLTEST_US; this.usP = this.usLevel + S.BALLTEST_US; }
      }
      this.lastU = 0;
      const B = S.BALLTEST_TICKS;
      if (T === B) this.x0 = x;                      // ball parked at the P end (or stuck)
      if (T === 2 * B) this.x1 = x;                  // ...rolled to the N end
      const us = T <= B || T > 2 * B ? this.usP : this.usN;
      if (T >= 3 * B) {
        // P moves the ball away from the sensor if it rolled back out after N rolled it in
        const d = (x - this.x1) - (this.x1 - this.x0);
        const sign = d > S.BALLTEST_MIN_DX ? 1 : d < -S.BALLTEST_MIN_DX ? -1 : 0;
        this.log.push(`CB ${Math.round(d * 1000)} ${sign}`);
        if (!sign) { this.finish(false, 'the ball did not roll: is it on the track?'); return us; }
        if (this.hasImu) {
          this.sign = sign;
          this.table = [];
          for (let k = 0; k < S.CAL_TABLE_N; k++) this.table.push(clamp(Math.round(this.usForAngle(S.CAL_TABLE_MIN_DEG + k, sign)), S.SERVO_MIN_US, S.SERVO_MAX_US));
        } else {
          this.usPerDeg = sign * Math.abs(this.usPerDeg);
        }
        this.phase = 6; this.t = 0;
        this.lvTrim = 0; this.lvSum = 0; this.lvN = 0;
      }
      return us;
    }
    if (this.phase === 6) {                          // auto-level
      const e = x - S.X_CENTER;
      const uFb = clamp(-(S.LEVEL_KP * e + S.LEVEL_KD * v), -1, 1);
      this.lvTrim = clamp(this.lvTrim - S.LEVEL_KT * clamp(e, -S.LEVEL_E_CLAMP, S.LEVEL_E_CLAMP) * S.DT, -S.LEVEL_MAX_DEG, S.LEVEL_MAX_DEG);
      const deg = uFb * S.THETA_MAX_DEG + this.lvTrim;
      this.lastU = deg / S.THETA_MAX_DEG;
      if (T > S.LEVEL_AVG_FROM && Math.abs(e) < S.LEVEL_BAND) { this.lvSum += deg; this.lvN++; }
      if (T >= S.LEVEL_TICKS) {
        this.levelSure = this.lvN > S.LEVEL_MIN_N;
        this.trimDeg = this.levelSure ? this.lvSum / this.lvN : 0;
        this.log.push(`CL ${Math.round(this.trimDeg * 100)} ${this.lvN}`);
        this.finish(true, this.levelSure ? '' : 'auto-level could not settle the ball; level left as it was');
      }
      return this.beamToUs(deg);
    }
    return this.beamToUs(this.trimDeg);
  }

  finish(ok, why) {
    this.done = true; this.ok = ok; this.why = why; this.phase = 7;
    let lo = 0, hi = 0;
    if (this.hasImu && this.table) {
      lo = 99; hi = -99;
      for (let i = 0; i < CAL_POINTS; i++) { const a = this.sweepAng(i, this.sign); lo = Math.min(lo, a); hi = Math.max(hi, a); }
    }
    this.range = [lo, hi];
    this.log.push(`CD ${ok ? 1 : 0}`);
    this.log.push(`CR ${Math.round(lo * 100)} ${Math.round(hi * 100)}`);
  }
}

// ---------------------------------------------------------------------------------------
// A simulated build in servo space, for testing calibration end to end: microseconds turn a
// horn, a push-rod lifts the beam (a real crank, so the response is curved), and a gyro board
// stuck on at a random angle reports "up" with bias and noise.
const DEG = Math.PI / 180;

function randomRotation(rng) {
  // random rotation matrix from a random unit quaternion
  let q = [rng.gauss(), rng.gauss(), rng.gauss(), rng.gauss()];
  const n = Math.hypot(...q); q = q.map(x => x / n);
  const [w, x, y, z] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

export class ServoBuild {
  constructor(env, rng, { hasImu = true } = {}) {
    this.env = env; this.rng = rng; this.hasImu = hasImu;
    this.dir = rng.sign();                         // which way the horn turns for more microseconds
    this.usPerServoDeg = rng.uniform(9.5, 11.5);   // SG90: about 10.6 us per degree
    this.horn = rng.uniform(0.010, 0.016);         // horn hole radius
    this.arm = rng.uniform(0.06, 0.08);            // push-rod hole distance from the pivot
    this.hornPhase = rng.uniform(-15, 15) * DEG;   // horn not quite horizontal at 1500 us
    this.levelErr = rng.uniform(-5, 5) * DEG;      // beam not quite level at 1500 us
    this.R = randomRotation(rng);
    this.bias = [0, 1, 2].map(() => rng.gauss() * 0.03);
    this.noise = 0.004;
  }
  thetaForUs(us) {
    const phi = this.dir * (us - S.SERVO_CENTER_US) / this.usPerServoDeg * DEG + this.hornPhase;
    const lift = this.horn * (Math.sin(phi) - Math.sin(this.hornPhase));
    return Math.asin(clamp(lift / this.arm, -1, 1)) + this.levelErr;
  }
  stepUs(us, u = 0) { return this.env.stepAngle(this.thetaForUs(us), u); }
  accel() {
    if (!this.hasImu) return null;
    const th = this.env.th;
    const upBeam = [-Math.sin(th), 0, Math.cos(th)];   // world "up" seen from the beam
    const R = this.R;
    return [0, 1, 2].map(r => R[r][0] * upBeam[0] + R[r][1] * upBeam[1] + R[r][2] * upBeam[2] + this.bias[r] + this.rng.gauss() * this.noise);
  }
}
