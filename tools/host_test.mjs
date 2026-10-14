// Checks that the firmware's C++ (compiled for the desktop) computes what the JavaScript the Gym
// trains with computes: brain outputs, tracker states, and whole calibration runs.
// usage: node tools/host_test.mjs   (build tests/host/host_test first; see tests/host/README)
import { execFileSync } from 'node:child_process';
import { packBrain, unpackBrain, runPacked } from '../core/brain.js';
import { BeamEnv, Tracker, stepIntegral } from '../core/world.js';
import { Calibrator, ServoBuild } from '../core/calibrate.js';
import { Rng } from '../core/rng.js';
import { STARTER_ACTOR } from '../gym/starter_brain.js';

const f = Math.fround;
const bin = new URL('../tests/host/host_test', import.meta.url).pathname;
const u8 = packBrain(STARTER_ACTOR, { name: 'hosttest' });
const brain = unpackBrain(u8);
const rng = new Rng(99);
const obsList = [];
for (let i = 0; i < 400; i++) obsList.push(Array.from({ length: 6 }, (_, k) => f(k < 2 || k === 5 ? rng.gauss() * 1.2 : rng.uniform(-1, 1))));

// tracker input: simulated sensor readings, with stretches pinned against the sensor (blind spot)
const env = new BeamEnv(5, { dr: 1 });
const readings = [];
for (let i = 0; i < 1500; i++) {
  env.step(i % 400 < 150 ? -1 : Math.sin(i / 17) * 0.6);
  readings.push([f(env.lastReading), f(env.target)]);
}

// calibration runs on simulated builds; record exactly what the calibrator was fed
const calRuns = [];
for (let b = 0; b < 8; b++) {
  const hasImu = b % 4 !== 3;
  const brng = new Rng(9100 + b), benv = new BeamEnv(800 + b, { dr: 1 });
  benv.events = false;
  const build = new ServoBuild(benv, brng, { hasImu });
  const cal = new Calibrator({ hasImu });
  const ticks = [], outs = [];
  while (!cal.done && ticks.length < 3000) {
    const g = build.accel();
    const inp = { x: f(benv.tracker.x), v: f(benv.tracker.v), g: g ? g.map(f) : null };
    const us = cal.tick(inp);
    ticks.push(inp); outs.push(us);
    build.stepUs(us, cal.lastU);
  }
  calRuns.push({ hasImu, ticks, outs, cal });
}

let input = `${u8.length}\n${Array.from(u8, b => b.toString(16).padStart(2, '0')).join('')}\n${obsList.length}\n`;
input += obsList.map(o => o.map(v => v.toPrecision(9)).join(' ')).join('\n') + '\n';
input += `${readings.length}\n` + readings.map(([r, t]) => `${r.toPrecision(9)} ${t.toPrecision(9)}`).join('\n') + '\n';
input += `${calRuns.length}\n`;
for (const run of calRuns) {
  input += `${run.hasImu ? 1 : 0} 1500 -45 ${run.ticks.length}\n`;
  input += run.ticks.map(t => `${t.x.toPrecision(9)} ${t.v.toPrecision(9)} ${t.g ? 1 : 0} ${(t.g || [0, 0, 0]).map(v => v.toPrecision(9)).join(' ')}`).join('\n') + '\n';
}
const out = execFileSync(bin, { input, maxBuffer: 64 << 20 }).toString().trim().split('\n');

let pass = true;
const head = out.shift();
console.log('C++ says:', head);
if (!head.startsWith('valid 1')) pass = false;

let maxDu = 0;
for (let i = 0; i < obsList.length; i++) maxDu = Math.max(maxDu, Math.abs(+out.shift().split(' ')[1] - runPacked(brain, obsList[i])));
console.log(`brain: ${obsList.length} inputs, largest difference ${maxDu.toExponential(2)}`);
if (maxDu > 1e-4) pass = false;

const tr = new Tracker();
let I = 0, maxDx = 0, maxDv = 0, kindMismatch = 0, blindTicks = 0;
for (const [r, t] of readings) {
  const k = tr.update(r);
  if (k === 3) blindTicks++;
  I = stepIntegral(I, tr.x - t);
  const [, ck, cx, cv] = out.shift().split(' ');
  if (+ck !== k) kindMismatch++;
  maxDx = Math.max(maxDx, Math.abs(+cx - tr.x));
  maxDv = Math.max(maxDv, Math.abs(+cv - tr.v));
}
console.log(`tracker: ${readings.length} readings (${blindTicks} in the blind spot), decisions differ ${kindMismatch}x, max |dx| ${maxDx.toExponential(2)} m, |dv| ${maxDv.toExponential(2)} m/s`);
if (kindMismatch || maxDx > 1e-4 || maxDv > 1e-3) pass = false;

for (const [q, run] of calRuns.entries()) {
  out.shift();                                   // "R q"
  const cLogs = [];
  let usDiff = 0, maxUs = 0;
  for (let i = 0; i < run.ticks.length; i++) {
    while (out[0].startsWith('L ')) cLogs.push(out.shift().slice(2));
    const [, us] = out.shift().split(' ');
    const d = Math.abs(+us - run.outs[i]);
    if (d > 0) usDiff++;
    maxUs = Math.max(maxUs, d);
  }
  while (out[0].startsWith('L ')) cLogs.push(out.shift().slice(2));
  const end = out.shift().split(' ').slice(1).map(Number);
  const [ok, sign, sure, trimC, ...table] = end;
  const c = run.cal;
  const jsTable = c.table || new Array(21).fill(0);
  const tableDiff = Math.max(...table.map((v, i) => Math.abs(v - jsTable[i])));
  const tagsSame = cLogs.map(l => l.split(' ')[0]).join() === c.log.map(l => l.split(' ')[0]).join();
  const logDiff = Math.max(0, ...cLogs.map((l, i) => { const a = l.split(' ').slice(1).map(Number), b = (c.log[i] || '').split(' ').slice(1).map(Number); return Math.max(0, ...a.map((v, j) => Math.abs(v - (b[j] ?? NaN)))); }));
  const same = ok === (c.ok ? 1 : 0) && (!c.ok || sign === c.sign) && sure === (c.levelSure ? 1 : 0) && Math.abs(trimC - Math.round(c.trimDeg * 100)) <= 2 && tableDiff <= 1 && tagsSame && maxUs <= 1;
  console.log(`calibration ${q} (${run.hasImu ? 'gyro' : 'no gyro'}, ${run.ticks.length} ticks): ${same ? 'same' : 'DIFFERENT'} | ok ${ok} sign ${sign} trim ${trimC} | servo commands off by 1 us on ${usDiff} ticks | table diff ${tableDiff} us | log values diff ${logDiff}`);
  if (!same) pass = false;
}
console.log(pass ? 'PASS: firmware matches the simulator (brain, tracker, calibration)' : 'FAIL');
process.exit(pass ? 0 : 1);
