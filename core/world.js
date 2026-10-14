// The dream world: a ball rolling in a tilting V-track, driven by a hobby servo and watched by
// an ultrasonic sensor. Every quirk that makes the real robot hard (servo lag and slop, sticky
// rolling friction, bumpy cardboard, sensor glitches, a crooked "level") is modeled and, with
// domain randomization on, re-rolled for every practice episode.

import * as S from './spec.js';
import { Rng } from './rng.js';

const G = 9.81;
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Ball presets: k is the fraction of g*sin(tilt) that turns into acceleration (rolling eats the
// rest); hRoll is the extra lever arm from spin when the beam swings (J / (m * r_contact)).
export const BALLS = {
  pingpong: { label: 'Ping-pong ball', r: 0.020, kLo: 0.34, kHi: 0.52, kNom: 0.43, hRoll: 0.019 },
  golf:     { label: 'Golf ball',      r: 0.0213, kLo: 0.48, kHi: 0.62, kNom: 0.556, hRoll: 0.012 },
  rubber:   { label: 'Small rubber ball', r: 0.020, kLo: 0.45, kHi: 0.62, kNom: 0.55, hRoll: 0.011 },
};

// Nominal value and randomization range for every physical quirk.
// [nominal, lo, hi]; with randomization strength dr in 0..1 the sampled range shrinks toward nominal.
export const QUIRKS = {
  deadTime:   [0.025, 0.010, 0.045],   // s, servo command to motion
  wn:         [28, 18, 45],            // rad/s, servo stiffness
  zeta:       [0.8, 0.6, 1.0],         // servo damping
  accMax:     [50, 25, 100],           // rad/s^2, how hard the servo can swing the beam
  rateMax:    [1.5, 0.8, 2.5],         // rad/s, top beam speed
  deadband:   [0.15 * DEG, 0.02 * DEG, 0.35 * DEG],
  backlash:   [0.25 * DEG, 0.0, 0.6 * DEG],
  gainErr:    [0, -0.2, 0.2],          // calibration says 5 degrees, beam really does 4..6
  level:      [0, -2.5 * DEG, 2.5 * DEG], // where "level" really is
  hPivot:     [0.045, 0.03, 0.06],     // ball center height above the pivot axis
  fric:       [0.03, 0.005, 0.10],     // m/s^2 rolling resistance
  stick:      [1.4, 1.0, 2.0],         // static friction multiplier
  drag:       [0.08, 0.0, 0.25],       // 1/s
  bump:       [0.03, 0.0, 0.10],       // m/s^2 amplitude of track bumps
  rest:       [0.3, 0.1, 0.5],         // bounce off the end walls
  sNoise:     [0.0015, 0.0005, 0.004], // m, sensor noise
  sScale:     [1.0, 0.98, 1.02],
  sOffset:    [0, -0.005, 0.005],
  pDrop:      [0.02, 0.0, 0.10],       // reading lost
  pOut:       [0.01, 0.0, 0.04],       // reading is garbage
  blindD:     [0.022, 0.015, 0.035],   // m, the sonar can't see the ball closer than this
};

export function sampleWorld(rng, dr = 1, ballKey = 'pingpong') {
  const w = {};
  for (const [name, [nom, lo, hi]] of Object.entries(QUIRKS)) {
    const a = nom + (lo - nom) * dr, b = nom + (hi - nom) * dr;
    w[name] = a + (b - a) * rng.next();
  }
  const ball = BALLS[ballKey] || BALLS.pingpong;
  const ka = ball.kNom + (ball.kLo - ball.kNom) * dr, kb = ball.kNom + (ball.kHi - ball.kNom) * dr;
  w.k = ka + (kb - ka) * rng.next();
  w.ballR = ball.r;
  w.hEff = w.hPivot + ball.hRoll;
  w.fricS = w.fric * w.stick;
  // three gentle bumps along the track (cardboard is never flat)
  w.bumps = [];
  for (let i = 0; i < 3; i++) {
    w.bumps.push({ a: w.bump * rng.uniform(0.3, 1) / 1.6, k: 2 * Math.PI / rng.uniform(0.02, 0.12), ph: rng.uniform(0, 2 * Math.PI) });
  }
  w.delaySub = Math.max(0, Math.round(w.deadTime / (S.DT / S.SUBSTEPS)));
  w.ballKey = ballKey;
  return w;
}

// The alpha-beta position tracker. The firmware runs this exact arithmetic on every reading.
export class Tracker {
  constructor() { this.reset(); }
  reset() { this.x = S.X_CENTER; this.v = 0; this.rej = 0; this.locked = false; this.blind = false; this.nv = 0; }
  // reading: distance to the ball's near surface in meters, or a negative number for "no reading".
  // Returns 0 = coasting, 1 = reading used, 2 = (re)locked, 3 = ball hiding in the sonar's blind spot.
  update(reading, dt = S.DT) {
    const valid = reading >= S.READ_MIN && reading <= S.READ_MAX;
    const z = reading + S.BALL_R;
    const wall = valid && z > S.WALL_Z;
    if (!valid || (wall && this.x < S.BLIND_ZONE)) {
      this.nv++;
      if (this.blind || (this.x < S.BLIND_ZONE && ((wall && this.nv >= 2) || this.nv >= S.NOVIS_TICKS))) {
        this.blind = true; this.x = S.BLIND_X; this.v = 0; this.rej = 0; return 3;
      }
      this.coast(dt);
      return 0;
    }
    this.nv = 0;
    if (!this.locked || this.blind) {
      this.x = Math.min(z, S.F_X_HI); this.v = 0; this.locked = true; this.blind = false; this.rej = 0; return 2;
    }
    const r = z - (this.x + this.v * dt);
    if (Math.abs(r) > S.F_GATE) {
      if (this.rej < S.F_MAX_REJECT) { this.rej++; this.coast(dt); return 0; }
      this.x = Math.min(z, S.F_X_HI); this.v = 0; this.rej = 0; return 2;
    }
    this.rej = 0;
    this.x = clamp(this.x + this.v * dt + S.F_ALPHA * r, S.F_X_LO, S.F_X_HI);
    this.v = clamp(this.v + (S.F_BETA / dt) * r, -S.F_V_MAX, S.F_V_MAX);
    return 1;
  }
  coast(dt) {
    this.x = clamp(this.x + this.v * dt, S.F_X_LO, S.F_X_HI);
    this.v = clamp(this.v * S.F_V_DECAY, -S.F_V_MAX, S.F_V_MAX);
  }
}

// What the brain sees. Shared by the simulator, the Gym's live view and the firmware.
export function makeObs(out, xHat, vHat, target, a1, a2, integ) {
  const c = S.OBS_CLIP;
  out[0] = clamp((xHat - target) / S.E_SCALE, -c, c);
  out[1] = clamp(vHat / S.V_SCALE, -c, c);
  out[2] = a1;
  out[3] = a2;
  out[4] = integ / S.I_LIM;
  out[5] = clamp((xHat - S.X_CENTER) / S.X_SCALE, -c, c);
  return out;
}

export function stepIntegral(integ, err, dt = S.DT) {
  if (Math.abs(err) < S.I_BAND) integ = clamp(integ + err * dt, -S.I_LIM, S.I_LIM);
  return integ;
}

export const PRIV_N = 9;

export class BeamEnv {
  constructor(seed = 1, opts = {}) {
    this.rng = new Rng(seed);
    this.dr = opts.dr ?? 1;
    this.ball = opts.ball ?? 'pingpong';
    this.episodeSteps = opts.episodeSteps ?? 500;
    this.events = opts.events ?? true;           // random target moves and pokes
    this.targetJumpEvery = opts.targetJumpEvery ?? 6;  // seconds, on average
    this.pokeEvery = opts.pokeEvery ?? 15;
    this.obs = new Float64Array(S.NET_IN);
    this.priv = new Float64Array(PRIV_N);
    this.delay = new Float64Array(64);
    this.tracker = new Tracker();
    this.world = null;
    this.reset();
  }

  reset(world = null) {
    const rng = this.rng;
    this.world = world || sampleWorld(rng, this.dr, this.ball);
    const w = this.world;
    this.t = 0;
    this.done = false;
    this.x = rng.next() < 0.08 ? rng.uniform(S.X_MIN, 0.04) : rng.uniform(0.06, 0.36);   // sometimes start hidden in the blind spot
    this.v = rng.next() < 0.5 ? rng.uniform(-0.2, 0.2) : 0;
    const th0 = rng.uniform(-0.5, 0.5) * S.THETA_MAX + w.level;
    this.th = th0; this.thd = 0; this.ths = th0; this.thsd = 0; this.goal = th0;
    this.delay.fill(th0); this.di = 0;
    this.target = rng.uniform(S.TARGET_MIN, S.TARGET_MAX);
    this.ramp = null;
    this.a1 = 0; this.a2 = 0; this.integ = 0;
    this.hits = 0; this.lastHit = 0; this.lastReading = -1; this.readingKind = 0;
    this.tracker.reset();
    this.sense();
    return this.obs;
  }

  bumpAccel(x) {
    let a = 0;
    for (const b of this.world.bumps) a += b.a * Math.sin(b.k * x + b.ph);
    return a;
  }

  // One 40 ms decision: apply action u in [-1, 1], run the physics, then take a sensor reading.
  step(u, clampAction = true) {
    const w = this.world;
    u = clampAction ? clamp(u, -1, 1) : clamp(u, -1.6, 1.6);
    return this.advance((1 + w.gainErr) * u * S.THETA_MAX + w.level, u);
  }

  // Same, but the servo is told a true beam angle directly (used when a linkage model sits in
  // front of the world); u is what the controller "meant", kept for the brain's action history.
  stepAngle(theta, u) { return this.advance(theta, u); }

  advance(tgt, u) {
    const w = this.world;
    const dts = S.DT / S.SUBSTEPS;
    const half = w.backlash / 2;
    let hit = 0;
    for (let s = 0; s < S.SUBSTEPS; s++) {
      // the command reaches the servo after the dead time
      this.delay[this.di] = tgt;
      const late = this.delay[(this.di - w.delaySub + 64) & 63];
      this.di = (this.di + 1) & 63;
      if (Math.abs(late - this.goal) > w.deadband) this.goal = late;
      // servo: a stiff, damped, speed- and torque-limited spring toward its goal
      let acc = w.wn * w.wn * (this.goal - this.ths) - 2 * w.zeta * w.wn * this.thsd;
      acc = clamp(acc, -w.accMax, w.accMax);
      this.thsd = clamp(this.thsd + acc * dts, -w.rateMax, w.rateMax);
      this.ths += this.thsd * dts;
      // gear and linkage slop between the servo and the beam
      let thNew = this.th;
      if (this.ths - thNew > half) thNew = this.ths - half;
      else if (thNew - this.ths > half) thNew = this.ths + half;
      thNew = clamp(thNew, -0.26, 0.26);
      const thdNew = (thNew - this.th) / dts;
      const thdd = clamp((thdNew - this.thd) / dts, -300, 300);
      this.th = thNew; this.thd = thdNew;
      // ball: gravity along the track, centrifugal push, the kick from beam swings, bumps, drag
      const sArm = this.x - S.PIVOT_X;
      const a = w.k * (G * Math.sin(this.th) + sArm * this.thd * this.thd - w.hEff * thdd)
        + this.bumpAccel(this.x) - w.drag * this.v;
      let vNew = this.v + a * dts;
      const fdt = w.fric * dts;
      if (vNew > fdt) vNew -= fdt;
      else if (vNew < -fdt) vNew += fdt;
      else vNew = Math.abs(a) > w.fricS ? Math.sign(a) * (Math.abs(a) - w.fric) * dts : 0;
      this.v = vNew;
      this.x += this.v * dts;
      if (this.x < S.X_MIN) {
        this.x = S.X_MIN;
        if (this.v < 0) { if (this.v < -0.06) hit++; this.v = -this.v * w.rest; }
      } else if (this.x > S.X_MAX) {
        this.x = S.X_MAX;
        if (this.v > 0) { if (this.v > 0.06) hit++; this.v = -this.v * w.rest; }
      }
    }
    this.t++;
    if (hit) { this.hits += hit; this.lastHit = this.t; }

    // the world keeps changing: someone turns the knob, or flicks the ball
    if (this.events) this.randomEvents();
    if (this.ramp) {
      this.target += this.ramp.rate * S.DT;
      if ((this.ramp.rate > 0 && this.target >= this.ramp.to) || (this.ramp.rate < 0 && this.target <= this.ramp.to)) {
        this.target = this.ramp.to; this.ramp = null;
      }
    }

    // reward uses the true state; the brain only ever sees the sensor
    const e = this.x - this.target;
    const r = Math.exp(-(e * e) / 0.0004) - Math.abs(e) / 0.15 - 0.05 * (this.v / 0.2) ** 2
      - 0.25 * Math.abs(u - this.a1) - 0.02 * u * u - 2 * hit;

    this.a2 = this.a1; this.a1 = u;
    this.sense();
    this.done = this.t >= this.episodeSteps;
    return r;
  }

  randomEvents() {
    const rng = this.rng;
    if (rng.next() < S.DT / this.targetJumpEvery) {
      const to = rng.uniform(S.TARGET_MIN, S.TARGET_MAX);
      if (rng.next() < 0.7) { this.target = to; this.ramp = null; }
      else { const dur = rng.uniform(1, 3); this.ramp = { to, rate: (to - this.target) / dur }; }
    }
    if (rng.next() < S.DT / this.pokeEvery) this.v += rng.sign() * rng.uniform(0.08, 0.3);
  }

  // HC-SR04 reading followed by the tracker, integral and observation
  sense() {
    const w = this.world, rng = this.rng;
    const d = this.x - w.ballR;
    let reading;
    const roll = rng.next();
    if (d < w.blindD) {
      // too close to see: most HC-SR04s then report the far wall, some report nothing or a few cm
      reading = roll < 0.6 ? S.TRACK_LEN * w.sScale + w.sOffset : roll < 0.9 ? -1 : 0.02 + 0.01 * rng.next();
    }
    else if (roll < w.pDrop) reading = -1;
    else if (roll < w.pDrop + w.pOut) reading = rng.next() < 0.5 ? rng.uniform(0.02, 0.5) : S.TRACK_LEN * w.sScale;
    else {
      reading = d * w.sScale + w.sOffset + rng.gauss() * w.sNoise * (1 + d / 0.4);
      reading = Math.round(reading / (4 * S.US_TO_M)) * 4 * S.US_TO_M; // micros() ticks in 4 us steps
    }
    this.lastReading = reading;
    this.readingKind = this.tracker.update(reading);
    this.integ = stepIntegral(this.integ, this.tracker.x - this.target);
    makeObs(this.obs, this.tracker.x, this.tracker.v, this.target, this.a1, this.a2, this.integ);
    const p = this.priv;
    p[0] = (this.x - this.target) / S.E_SCALE;
    p[1] = this.v / S.V_SCALE;
    p[2] = this.th / S.THETA_MAX;
    p[3] = this.thd / 2;
    p[4] = (this.x - S.X_CENTER) / S.X_SCALE;
    p[5] = w.level / (2.5 * DEG);
    p[6] = w.gainErr / 0.2;
    p[7] = (w.k - 0.45) / 0.1;
    p[8] = (this.tracker.x - this.x) / 0.02;
  }

  // handles for the Gym's playground
  setTarget(x) { this.target = clamp(x, S.TARGET_MIN, S.TARGET_MAX); this.ramp = null; }
  poke(dv) { this.v += dv; }
}

// Classic PID on the same tracker outputs, for comparison with the learned brain.
export function pidAction(obs, kp = S.PID_KP, ki = S.PID_KI, kd = S.PID_KD) {
  const e = obs[0] * S.E_SCALE, v = obs[1] * S.V_SCALE, I = obs[4] * S.I_LIM;
  return clamp(-(kp * e + ki * I + kd * v), -1, 1);
}
