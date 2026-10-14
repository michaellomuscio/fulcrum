// Software in the loop: the real firmware (tests/sil/sil, built from Fulcrum.ino) drives a simulated
// robot. Checks calibration, balancing, brain upload (good and corrupted), PID, the remote, and a
// build without the gyro board. usage: node tools/sil_test.mjs
import { spawn } from 'node:child_process';
import * as S from '../core/spec.js';
import { BeamEnv } from '../core/world.js';
import { Rng } from '../core/rng.js';
import { ServoBuild, Calibrator } from '../core/calibrate.js';
import { packBrain, unpackBrain, runPacked } from '../core/brain.js';
import { STARTER_ACTOR } from '../gym/starter_brain.js';
import { faceBits } from '../gym/draw.js';
import { parseTelemetry } from '../gym/serial.js';

const BIN = new URL('../tests/sil/sil', import.meta.url).pathname;
let failures = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

class Rig {
  constructor({ imu = true, seed = 1 } = {}) {
    this.p = spawn(BIN, imu ? [] : ['noimu']);
    this.lines = []; this.out = []; this.wait = null; let buf = '';
    this.p.stdout.on('data', d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i); buf = buf.slice(i + 1);
        if (l.startsWith('O ')) this.out.push(l.slice(2));
        if (this.wait && this.wait.test(l)) { const w = this.wait; this.wait = null; w.resolve(l); }
      }
    });
    const rng = new Rng(seed);
    this.env = new BeamEnv(seed * 7 + 1, { dr: 1 });
    this.env.events = false;
    this.build = new ServoBuild(this.env, rng, { hasImu: imu });
    this.servo = S.SERVO_CENTER_US;
    this.knob = 512;
  }
  write(l) { this.p.stdin.write(l + '\n'); }
  next(re) { return new Promise(resolve => { this.wait = { test: l => re.test(l), resolve }; }); }
  async tick() {
    const r = this.env.lastReading;
    const echo = r >= 0 ? Math.round(r / S.US_TO_M) : 0;
    const g = this.build.accel() || [0, 0, 1];
    this.write(`S ${echo} ${g.map(v => Math.round(v * 16384)).join(' ')} ${this.knob}`);
    const done = this.next(/^V /);
    this.write('A 40');
    const v = await done;
    this.servo = +v.split(' ')[1];
    this.build.stepUs(this.servo, 0);
  }
  async run(seconds, each) { for (let i = 0; i < Math.round(seconds / S.DT); i++) { await this.tick(); if (each) each(i); } }
  take() { const o = this.out; this.out = []; return o; }
  async say(cmd, re, maxTicks = 50) {
    this.write(`W ${cmd}`);
    for (let i = 0; i < maxTicks; i++) { await this.tick(); const hit = this.out.find(l => re.test(l)); if (hit) return hit; }
    return null;
  }
  async matrix() { const done = this.next(/^M /); this.write('M'); return (await done).split(' ').slice(1).map(h => parseInt(h, 16)); }
  quit() { this.p.stdin.end(); }
}

async function uploadBrain(rig, u8, corruptAt = -1) {
  if (!(await rig.say(`BB ${u8.length}`, /^BR$/, 5))) return 'no BR';
  for (let off = 0; off < u8.length; off += 24) {
    const chunk = Array.from(u8.subarray(off, off + 24));
    if (corruptAt >= off && corruptAt < off + 24) chunk[corruptAt - off] ^= 0x5A;
    const hex = chunk.map(b => b.toString(16).padStart(2, '0')).join('');
    rig.write(`W BD ${off} ${hex}`);
    rig.write('A 5');                     // uploads pause the control loop; just let the line through
    await rig.next(/^V /);
    if (!rig.take().some(l => l === `BA ${off}`)) return `no BA ${off}`;
  }
  rig.write('W BE'); rig.write('A 5'); await rig.next(/^V /);
  return rig.take().find(l => l.startsWith('BOK') || l.startsWith('BERR')) || 'no reply';
}

// ------------------------------------------------------------------------------------------------
console.log('\n[1] boot with a gyro board');
let rig = new Rig({ imu: true, seed: 3 });
await rig.run(0.2);
let hi = await rig.say('?', /^HI /, 5);
check(/brain=starter/.test(hi) && /gyro=1/.test(hi) && /cal=0/.test(hi), `says hello: ${hi}`);
const tel = rig.out.map(parseTelemetry).filter(Boolean);
check(tel.length > 0 && tel.every(t => isFinite(t.x) && isFinite(t.target) && t.us >= S.SERVO_MIN_US), `telemetry parses (${tel.length} lines)`);

console.log('\n[2] calibration (gyro sweep, ball test, auto-level)');
rig.take();
rig.write('W C');
let cd = null;
const calLines = [];
for (let i = 0; i < 2000 && !cd; i++) { await rig.tick(); for (const l of rig.take()) { if (/^C[A-Z]/.test(l)) calLines.push(l); if (l.startsWith('CD')) cd = l; } }
check(cd === 'CD 1', `finished: ${cd} after ${calLines.filter(l => l.startsWith('CP')).length} sweep points`);
const cb = calLines.find(l => l.startsWith('CB')), cl = calLines.find(l => l.startsWith('CL')), cr = calLines.find(l => l.startsWith('CR'));
check(cb && +cb.split(' ')[2] !== 0, `ball test decided a direction: ${cb}`);
check(cl && +cl.split(' ')[2] > 40, `auto-level settled: ${cl}`);
const cfg = await rig.say('S', /^CFG /, 5);
check(/cal=1/.test(cfg) && /table=1/.test(cfg), `settings saved: ${cfg}`);
console.log(`  (${cr})`);
// does "level" really mean level now?
const DEG = Math.PI / 180;
await rig.say('M 4', /mode 4/, 5); await rig.say('U 0', /OK U/, 5); await rig.run(0.8);
check(Math.abs(rig.env.th) / DEG < 1.0, `commanding level gives a true beam angle of ${(rig.env.th / DEG).toFixed(2)} deg (build was ${(rig.build.levelErr / DEG).toFixed(1)} deg off)`);

console.log('\n[3] the starter brain balances through the real firmware, same as in the simulator');
const plan = [[0, 120], [8, 280], [16, 180], [24, 250]];
// the same calibrated build and target plan in pure JavaScript, for comparison
function jsTwin() {
  const env = new BeamEnv(3 * 7 + 1, { dr: 1 }); env.events = false;
  const build = new ServoBuild(env, new Rng(3), { hasImu: true });
  const cal = new Calibrator({ hasImu: true });
  while (!cal.done) build.stepUs(cal.tick({ x: env.tracker.x, v: env.tracker.v, g: build.accel() }), cal.lastU);
  const brain = unpackBrain(packBrain(STARTER_ACTOR, { name: 'twin' }));
  env.x = 0.35; env.v = 0;
  const h0 = env.hits, o = new Float32Array(6);
  let sum = 0, n = 0, since = 0, tgt = 0;
  for (let i = 0; i < 32 / S.DT; i++) {
    const p = plan.find(q => Math.abs(q[0] - i * S.DT) < 1e-6);
    if (p) { env.setTarget(p[1] / 1000); tgt = p[1] / 1000; since = 0; }
    for (let k = 0; k < 6; k++) o[k] = env.obs[k];
    const u = runPacked(brain, o);
    build.stepUs(cal.beamToUs(u * S.THETA_MAX_DEG + cal.trimDeg), u); since++;
    if (since * S.DT > 3) { sum += Math.abs(env.x - tgt); n++; }
  }
  return { err: sum / n, hits: env.hits - h0 };
}
await rig.say('M 1', /mode 1/, 5);
rig.env.x = 0.35; rig.env.v = 0;
const hits0 = rig.env.hits;
let sum = 0, n = 0, since = 0, lastT = 0;
for (let i = 0; i < 32 / S.DT; i++) {
  const t = i * S.DT;
  const p = plan.find(q => Math.abs(q[0] - t) < 1e-6);
  if (p) { rig.write(`W G ${p[1]}`); since = 0; lastT = p[1] / 1000; }
  await rig.tick(); since++;
  if (since * S.DT > 3) { sum += Math.abs(rig.env.x - lastT); n++; }
}
const tel2 = rig.take().map(parseTelemetry).filter(Boolean);
const fwErr = sum / n, twin = jsTwin(), fwHits = rig.env.hits - hits0;
console.log(`  firmware: settled error ${(fwErr * 100).toFixed(2)} cm, ${fwHits} wall hits | simulator twin: ${(twin.err * 100).toFixed(2)} cm, ${twin.hits} wall hits`);
check(Math.abs(fwErr - twin.err) < Math.max(0.004, 0.3 * twin.err), 'firmware balances as well as the simulator predicts');
check(fwHits <= twin.hits + 1, 'no extra wall hits on the firmware');
check(tel2.length > 700 && tel2.every(t => t.brain), `${tel2.length} telemetry lines, brain flag set`);

console.log('\n[4] sending a new brain over the cable');
const u8 = packBrain(STARTER_ACTOR, { name: 'sil-test' });
const r1 = await uploadBrain(rig, u8);
check(r1 === 'BOK sil-test', `upload answered: ${r1}`);
hi = await rig.say('?', /^HI /, 5);
check(/brain=sil-test/.test(hi), `robot now runs it: ${hi}`);

console.log('\n[5] a corrupted upload is refused');
const r2 = await uploadBrain(rig, u8, 200);
check(r2 === 'BERR crc', `upload with one damaged byte answered: ${r2}`);
hi = await rig.say('?', /^HI /, 5);
check(/brain=-/.test(hi), `robot has no brain rather than a damaged one: ${hi}`);
await rig.say('M 1', /mode 1/, 5); await rig.run(0.2);
const face = await rig.matrix();
check(face.join() === faceBits(0, 'question').join(), 'LED matrix shows the question mark');
const bf = await rig.say('BF', /^BOK|^BERR/, 5);
check(bf === 'BOK starter', `starter brain restored: ${bf}`);

console.log('\n[6] PID mode and the remote');
await rig.say('M 2', /mode 2/, 5);
await rig.run(6);
check(Math.abs(rig.env.x - rig.out.map(parseTelemetry).filter(Boolean).pop().target) < 0.05, `PID holds the ball near the target (${(rig.env.x * 100).toFixed(1)} cm)`);
rig.take();
rig.write('I 45'); await rig.run(0.1);
check(rig.take().some(l => l === 'EV mode 0'), 'POWER button stops balancing');
rig.write('I 0C'); await rig.run(0.1);
const t1 = rig.take().map(parseTelemetry).filter(Boolean).pop();
check(Math.abs(t1.target - S.TARGET_MIN) < 0.002 && !t1.knobMode, `button 1 sets the target to ${(t1.target * 100).toFixed(0)} cm`);
rig.write('I 16'); await rig.run(0.1);
check(rig.take().map(parseTelemetry).filter(Boolean).pop().knobMode, 'button 0 hands the target back to the knob');
rig.quit();

console.log('\n[7] a build without the gyro board');
rig = new Rig({ imu: false, seed: 5 });
await rig.run(0.2);
hi = await rig.say('?', /^HI /, 5);
check(/gyro=0/.test(hi), `says hello: ${hi}`);
rig.take(); rig.write('W C');
cd = null; const cl2 = [];
for (let i = 0; i < 1200 && !cd; i++) { await rig.tick(); for (const l of rig.take()) { if (/^C[A-Z]/.test(l)) cl2.push(l); if (l.startsWith('CD')) cd = l; } }
check(cd === 'CD 1', `calibrated without the gyro: ${cl2.filter(l => /^C[SBL]/.test(l)).join(' | ')}`);
await rig.say('M 1', /mode 1/, 5);
rig.write('W G 160'); await rig.run(8);
const xs = []; await rig.run(4, () => xs.push(rig.env.x));
const errNoImu = xs.reduce((s, x) => s + Math.abs(x - 0.16), 0) / xs.length;
check(errNoImu < 0.02, `balances at 16 cm, average error ${(errNoImu * 100).toFixed(2)} cm`);
rig.quit();

console.log(failures ? `\n${failures} check(s) FAILED` : '\nPASS: the real firmware calibrates, balances, takes brains, refuses damaged ones, and obeys the remote');
process.exit(failures ? 1 : 0);
