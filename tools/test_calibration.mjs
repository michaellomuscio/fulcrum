// End to end on simulated builds: random linkage, random servo direction, crooked level, gyro stuck
// on at a random angle with bias and noise. Calibrate exactly as the firmware does, check the map,
// then let the brain balance through it. usage: node tools/test_calibration.mjs [builds] [actor.json]
import fs from 'node:fs';
import * as S from '../core/spec.js';
import { BeamEnv } from '../core/world.js';
import { Rng } from '../core/rng.js';
import { Calibrator, ServoBuild } from '../core/calibrate.js';
import { packBrain, unpackBrain, runPacked } from '../core/brain.js';
import { STARTER_ACTOR } from '../gym/starter_brain.js';

const N = +(process.argv[2] || 60);
const actor = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : STARTER_ACTOR;
const brain = unpackBrain(packBrain(actor, { name: 'test' }));
const DEG = Math.PI / 180;

function runBuild(i, hasImu) {
  const rng = new Rng(9000 + i);
  const env = new BeamEnv(700 + i, { dr: 1 });
  env.events = false;
  const build = new ServoBuild(env, rng, { hasImu });
  const cal = new Calibrator({ hasImu });
  let ticks = 0;
  while (!cal.done && ticks < 3000) {
    const us = cal.tick({ x: env.tracker.x, v: env.tracker.v, g: build.accel() });
    build.stepUs(us, cal.lastU);
    ticks++;
  }
  const res = { ok: cal.ok, why: cal.why, sure: cal.levelSure, seconds: ticks * S.DT, dir: build.dir };
  if (!cal.ok) return res;
  // how well does "command c degrees" match the true beam angle now?
  let worst = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let c = -7; c <= 7; c += 0.5) {
    const th = build.thetaForUs(cal.beamToUs(c + cal.trimDeg)) / DEG;
    sx += c; sy += th; sxx += c * c; sxy += c * th; n++;
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), offset = (sy - slope * sx) / n;
  for (let c = -7; c <= 7; c += 0.5) worst = Math.max(worst, Math.abs(build.thetaForUs(cal.beamToUs(c + cal.trimDeg)) / DEG - (slope * c + offset)));
  Object.assign(res, { slope, offset, bend: worst });
  // now balance: 40 s with the knob turning now and then
  env.events = true; env.pokeEvery = 1e9;
  const o = new Float32Array(6);
  let since = 0, last = env.target, sum = 0, cnt = 0, hits0 = env.hits;
  for (let t = 0; t < 1000; t++) {
    for (let k = 0; k < 6; k++) o[k] = env.obs[k];
    const u = runPacked(brain, o);
    build.stepUs(cal.beamToUs(u * S.THETA_MAX_DEG + cal.trimDeg), u);
    if (env.target !== last) { last = env.target; since = 0; } else since++;
    if (since * S.DT >= 3) { sum += Math.abs(env.x - env.target); cnt++; }
  }
  res.settled = cnt ? sum / cnt : NaN;
  res.hits = env.hits - hits0;
  return res;
}

for (const hasImu of [true, false]) {
  const rows = [];
  for (let i = 0; i < N; i++) rows.push(runBuild(i, hasImu));
  const ok = rows.filter(r => r.ok);
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  const p90 = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)]; };
  console.log(`\n${hasImu ? 'WITH gyro board' : 'WITHOUT gyro board'}: ${N} random builds, calibration took ~${med(rows.map(r => r.seconds)).toFixed(0)} s`);
  console.log(`  calibrated: ${ok.length}/${N}, auto-level sure: ${ok.filter(r => r.sure).length}/${ok.length}`);
  if (rows.some(r => !r.ok)) console.log('  failures:', [...new Set(rows.filter(r => !r.ok).map(r => r.why))].join(' | '));
  console.log(`  map gain (1 = perfect): median ${med(ok.map(r => r.slope)).toFixed(3)}, range ${Math.min(...ok.map(r => r.slope)).toFixed(2)}..${Math.max(...ok.map(r => r.slope)).toFixed(2)}`);
  console.log(`  level after calibration: median |offset| ${med(ok.map(r => Math.abs(r.offset))).toFixed(2)} deg, 90th pct ${p90(ok.map(r => Math.abs(r.offset))).toFixed(2)} deg`);
  console.log(`  curve left in the map: median ${med(ok.map(r => r.bend)).toFixed(2)} deg`);
  console.log(`  brain balancing afterwards: settled error median ${(med(ok.map(r => r.settled)) * 100).toFixed(2)} cm, 90th pct ${(p90(ok.map(r => r.settled)) * 100).toFixed(2)} cm, wall hits ${ok.reduce((s, r) => s + r.hits, 0)} in ${ok.length * 40} s`);
}
