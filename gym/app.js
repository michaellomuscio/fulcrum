// Fulcrum Gym: watch a brain learn in simulated worlds, examine it, and send it to the robot.
import * as S from '../core/spec.js';
import { BeamEnv, BALLS, pidAction } from '../core/world.js';
import { Rng } from '../core/rng.js';
import { packBrain, unpackBrain, brainPolicy, runPacked } from '../core/brain.js';
import { STARTER_ACTOR } from './starter_brain.js';
import { FIRMWARE_HEX } from './firmware_hex.js';
import { colors, drawRobot, drawThumb, hitTrack, LineChart, PolicyMap, drawNet, drawEeprom, fitCanvas, rgba } from './draw.js';
import { Fulcrum, serialSupported, parseTelemetry, IR_LABELS } from './serial.js';
import { VirtualPort } from './virtual.js';

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

function toast(msg, ms = 3200) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms);
}

// a fast float copy of the network, for the live views (the exam uses the exact 8-bit copy)
function netFrom(actor) {
  const [L1, L2, L3] = actor.layers;
  const h1 = new Float64Array(L1.outSize), h2 = new Float64Array(L2.outSize);
  const layer = (L, x, out, squash) => {
    for (let j = 0; j < L.outSize; j++) {
      let s = L.b[j];
      for (let k = 0; k < L.inSize; k++) s += L.W[j * L.inSize + k] * x[k];
      out[j] = squash ? Math.tanh(s) : s;
    }
  };
  const o = new Float64Array(1);
  const run = obs => { layer(L1, obs, h1, true); layer(L2, h1, h2, true); layer(L3, h2, o, false); return clamp(o[0], -1, 1); };
  return { run, h1, h2, out: o, actor };
}

// ============================================================================ state
const state = {
  view: 'dream', ctrl: 'brain', training: false, dr: true, ball: 'pingpong',
  actor: null, net: null, best: null, std: 0.6, pidErr: null, curve: [], seed: 0,
  youTilt: 0, keys: new Set(), dragging: false, mapDirty: true,
};

// ============================================================================ tabs
function show(view) {
  state.view = view;
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.view === view));
  for (const v of ['dream', 'exam', 'robot']) $(`view-${v}`).hidden = v !== view;
  if (view === 'exam') drawEepromFor(examPick());
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
}
for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => show(b.dataset.view));

// ============================================================================ training worker
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
worker.onmessage = e => {
  const m = e.data;
  if (m.type === 'ready') {
    state.actor = m.actor; state.net = netFrom(m.actor); state.pidErr = m.pidErr; state.seed = m.seed;
    state.curve = []; state.best = null; state.std = Math.exp(m.actor.logStd);
    $('n-envs').textContent = m.nEnvs;
    state.mapDirty = true; updateStats(null); drawCurve();
  } else if (m.type === 'progress') {
    const s = m.stats;
    state.actor = m.actor; state.net = netFrom(m.actor); state.std = s.std;
    if (isFinite(s.epErr)) state.curve.push({ x: s.hours, err: s.epErr * 100 });
    if (m.best) state.best = m.best;
    state.mapDirty = true;
    updateStats(s, m.wallMs);
    drawCurve();
  }
};
worker.postMessage({ cmd: 'new', opts: { dr: 1, ball: state.ball } });

function fmtDuration(sec) {
  if (sec < 90) return `${sec.toFixed(0)} s`;
  if (sec < 3600) return `${(sec / 60).toFixed(0)} min`;
  const h = Math.floor(sec / 3600), mnt = Math.round((sec % 3600) / 60);
  return `${h} h ${mnt} min`;
}
function updateStats(s, wallMs = 0) {
  $('st-practice').textContent = s ? fmtDuration(s.hours * 3600) : '0 min';
  $('st-wall').textContent = `in ${fmtDuration(wallMs / 1000)} of real time`;
  $('st-episodes').textContent = s ? s.episodes.toLocaleString() : '0';
  $('st-iter').textContent = `${s ? s.iteration : 0} learning steps`;
  $('st-err').textContent = s && isFinite(s.epErr) ? `${(s.epErr * 100).toFixed(1)} cm` : '–';
  $('st-std').textContent = `${Math.round(clamp(state.std / 0.6, 0, 1) * 100)}%`;
  $('curve-meta').textContent = state.best ? `best so far: learning step ${state.best.iteration}` : '';
}

$('btn-train').addEventListener('click', () => {
  state.training = !state.training;
  worker.postMessage({ cmd: state.training ? 'start' : 'pause' });
  $('btn-train').textContent = state.training ? 'Pause training' : 'Resume training';
});
$('btn-reset').addEventListener('click', () => {
  state.training = false;
  worker.postMessage({ cmd: 'new', opts: { dr: state.dr ? 1 : 0, ball: state.ball } });
  $('btn-train').textContent = 'Start training';
  toast('A fresh brain with random connections. Press Start to watch it learn from scratch.');
});
$('dr-toggle').addEventListener('change', e => {
  state.dr = e.target.checked;
  worker.postMessage({ cmd: 'set', dr: state.dr ? 1 : 0 });
  toast(state.dr ? 'Practice worlds now vary like the real world does.' : 'Every practice world is now identical and perfect. Brains trained this way tend to fail on real cardboard.');
});
$('ball-select').addEventListener('change', e => {
  state.ball = e.target.value;
  worker.postMessage({ cmd: 'set', ball: state.ball });
  newLiveWorld();
});

// ============================================================================ learning curve
const curveChart = new LineChart($('curve'), $('curve-tip'), {
  x: { min: 0, fmt: v => (v < 1 ? `${Math.round(v * 60)}m` : `${v.toFixed(v < 10 ? 1 : 0)}h`), tipFmt: v => `after ${fmtDuration(v * 3600)} of practice` },
  y: { min: 0, fmt: v => `${v.toFixed(0)} cm`, tipFmt: v => `${v.toFixed(2)} cm` },
  series: [{ key: 'err', label: 'average miss', color: 's1', area: true, endDot: true }],
  empty: 'Press Start training',
});
function drawCurve() {
  const pts = state.curve;
  const smooth = pts.map((p, i) => { const a = pts.slice(Math.max(0, i - 4), i + 1); return { x: p.x, err: a.reduce((s, q) => s + q.err, 0) / a.length }; });
  const refs = state.pidErr ? [{ y: state.pidErr * 100, label: `classic PID ${(state.pidErr * 100).toFixed(1)} cm` }] : [];
  curveChart.set(smooth, { refs, y: { ...curveChart.cfg.y, max: smooth.length ? Math.min(20, Math.max(...smooth.map(p => p.err), state.pidErr * 100 || 0) * 1.15) : undefined } });
}

// ============================================================================ the live dream
const stage = $('stage');
let live = null;
function describe(w) {
  const chips = [BALLS[w.ballKey].label];
  if (!state.dr) chips.push('perfect world');
  else {
    chips.push(w.fric > 0.06 ? 'sticky track' : w.fric < 0.015 ? 'slick track' : 'normal track');
    chips.push(w.deadTime > 0.035 || w.rateMax < 1.1 ? 'slow servo' : w.deadTime < 0.017 ? 'snappy servo' : 'normal servo');
    if (w.backlash > 0.4 * DEG) chips.push('sloppy gears');
    if (w.sNoise > 0.0028 || w.pDrop > 0.06) chips.push('noisy sonar');
    if (Math.abs(w.level) > 0.8 * DEG) chips.push(`level off by ${(Math.abs(w.level) / DEG).toFixed(1)}°`);
    if (w.bump > 0.06) chips.push('bumpy cardboard');
  }
  return chips;
}
function newLiveWorld() {
  const env = new BeamEnv(Math.floor(Math.random() * 1e9), { dr: state.dr ? 1 : 0, ball: state.ball, episodeSteps: 1e12 });
  env.targetJumpEvery = 8; env.pokeEvery = 25;
  live = { env, acc: 0, px: env.x, pth: env.th, spin: 0, calm: 0, settled: false, pingAge: 0, hitT: -9, worldNo: Math.floor(Math.random() * 9000) + 1000 };
  const box = $('world-chips'); box.replaceChildren();
  for (const c of describe(env.world)) { const s = document.createElement('span'); s.className = 'chip'; s.textContent = c; box.append(s); }
}
newLiveWorld();
$('btn-new-world').addEventListener('click', newLiveWorld);

for (const b of document.querySelectorAll('[data-ctrl]')) b.addEventListener('click', () => {
  state.ctrl = b.dataset.ctrl;
  for (const x of document.querySelectorAll('[data-ctrl]')) x.setAttribute('aria-checked', String(x === b));
  $('you-hint').hidden = state.ctrl !== 'you';
  state.youTilt = 0;
});

function liveAction(env) {
  if (state.ctrl === 'pid') return pidAction(env.obs);
  if (state.ctrl === 'you') return state.youTilt;
  return state.net ? state.net.run(env.obs) : 0;
}

function stepLive(L) {
  const env = L.env;
  L.px = env.x; L.pth = env.th;
  const hitsBefore = env.hits;
  env.step(liveAction(env));
  L.spin += (env.x - L.px) / 0.02;
  if (env.hits > hitsBefore) L.hitT = performance.now();
  L.pingAge = 0;
  const e = env.tracker.x - env.target;
  if (Math.abs(e) < 0.015 && Math.abs(env.tracker.v) < 0.03) L.calm++; else L.calm = 0;
  L.settled = L.calm >= 12;
  map.pushLive(env.tracker.x - env.target, env.tracker.v);
  map.target = env.target;
}

function faceFor(env, L) {
  if (state.ctrl === 'brain' && !state.net) return { look: 0, mouth: 'question' };
  const look = env.tracker.x < S.X_CENTER - 0.06 ? -1 : env.tracker.x > S.X_CENTER + 0.06 ? 1 : 0;
  const far = Math.abs(env.tracker.x - env.target) > 0.08 || performance.now() - L.hitT < 1000;
  return { look, mouth: L.settled ? 'smile' : far ? 'o' : 'flat' };
}

let stageGeo = null;
function drawDreamStage() {
  const L = live, env = L.env, a = clamp(L.acc / S.DT, 0, 1);
  stageGeo = drawRobot(stage, {
    x: L.px + (env.x - L.px) * a, th: L.pth + (env.th - L.pth) * a, target: env.target, spin: L.spin,
    pingAge: L.pingAge, reading: env.lastReading, blind: env.tracker.blind, ballKey: state.ball,
    face: faceFor(env, L), tag: `DREAM ${L.worldNo}`, dragTarget: state.dragging,
  });
}

// interaction: click the track for a new target, click the ball to flick it, or drive it yourself
stage.addEventListener('pointerdown', e => {
  if (!stageGeo) return;
  const r = stage.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const env = live.env, hit = hitTrack(stageGeo, env.th, px, py);
  if (!hit) return;
  if (Math.abs(hit.s - env.x) < 0.035 && hit.n > 0.02) { env.poke(hit.s < env.x ? 0.3 : -0.3); return; }
  env.setTarget(hit.s); state.dragging = true; stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', e => {
  const r = stage.getBoundingClientRect(), py = e.clientY - r.top, px = e.clientX - r.left;
  if (state.ctrl === 'you') state.youTilt = clamp((py - r.height / 2) / (r.height / 3), -1, 1);
  if (state.dragging && stageGeo) { const hit = hitTrack(stageGeo, live.env.th, px, py); if (hit) live.env.setTarget(hit.s); }
});
stage.addEventListener('pointerup', () => { state.dragging = false; });
window.addEventListener('keydown', e => { if (state.ctrl === 'you' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { state.keys.add(e.key); e.preventDefault(); } });
window.addEventListener('keyup', e => state.keys.delete(e.key));

// ============================================================================ practice thumbnails
const thumbs = [];
const thumbRng = new Rng(Date.now() & 0xffff);
for (let i = 0; i < 12; i++) {
  const c = document.createElement('canvas'); c.setAttribute('aria-hidden', 'true'); $('thumbs').append(c);
  const env = new BeamEnv(Math.floor(Math.random() * 1e9), { dr: 1, ball: state.ball, episodeSteps: 250 + Math.floor(Math.random() * 250) });
  thumbs.push({ c, env, px: env.x, pth: env.th, hitT: -9 });
}
function stepThumbs() {
  for (const T of thumbs) {
    const env = T.env;
    T.px = env.x; T.pth = env.th;
    const u = (state.net ? state.net.run(env.obs) : 0) + state.std * thumbRng.gauss();
    const h0 = env.hits;
    env.step(u);
    if (env.hits > h0) T.hitT = performance.now();
    if (env.done) { env.dr = state.dr ? 1 : 0; env.ball = state.ball; env.reset(); T.px = env.x; T.pth = env.th; }
  }
}
function drawThumbs(C, a) {
  for (const T of thumbs) drawThumb(T.c, { x: T.px + (T.env.x - T.px) * a, th: T.pth + (T.env.th - T.pth) * a, target: T.env.target, hit: performance.now() - T.hitT < 250 }, C);
}

// ============================================================================ brain views
const map = new PolicyMap($('policy'), $('policy-tip'));
let lastMap = 0, lastNet = 0;

// ============================================================================ animation loop
let lastT = performance.now(), frameNo = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now; frameNo++;
  if (state.ctrl === 'you') {
    if (state.keys.has('ArrowUp')) state.youTilt = clamp(state.youTilt - 2.5 * dt, -1, 1);
    if (state.keys.has('ArrowDown')) state.youTilt = clamp(state.youTilt + 2.5 * dt, -1, 1);
  }
  if (state.view === 'dream') {
    live.acc += dt; live.pingAge += dt;
    while (live.acc >= S.DT) { live.acc -= S.DT; stepLive(live); stepThumbs(); }
    drawDreamStage();
    const C = colors();
    if (frameNo % 2 === 0) drawThumbs(C, clamp(live.acc / S.DT, 0, 1));
    if (state.mapDirty && state.net && now - lastMap > 350) { const net = state.net; map.setPolicy(o => net.run(o), live.env.target); state.mapDirty = false; lastMap = now; }
    else if (frameNo % 3 === 0) map.draw();
    if (now - lastNet > 90 && state.net) {
      lastNet = now;
      const net = state.net; net.run(live.env.obs);
      drawNet($('net'), net.actor, [Array.from(net.h1), Array.from(net.h2), net.out[0]], live.env.obs, C);
    }
  } else if (state.view === 'robot') drawReality();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ============================================================================ exam
function examPick() { const b = document.querySelector('[data-brain][aria-checked="true"]'); return b ? b.dataset.brain : 'best'; }
for (const b of document.querySelectorAll('[data-brain]')) b.addEventListener('click', () => {
  for (const x of document.querySelectorAll('[data-brain]')) x.setAttribute('aria-checked', String(x === b));
  drawEepromFor(b.dataset.brain);
});
function actorFor(which) {
  if (which === 'starter') return { actor: STARTER_ACTOR, name: 'starter' };
  if (which === 'current') return state.actor ? { actor: state.actor, name: `gym-${state.seed % 1000}-now` } : null;
  if (state.best) return { actor: state.best.actor, name: `gym-${state.seed % 1000}-${state.best.iteration}` };
  return state.actor ? { actor: state.actor, name: `gym-${state.seed % 1000}-now` } : null;
}
function drawEepromFor(which) {
  const a = actorFor(which);
  const u8 = a ? packBrain(a.actor, { name: a.name }) : null;
  drawEeprom($('eeprom'), u8);
  $('ex-size').textContent = u8 ? `${u8.length} B` : '–';
}

// one exam world, scored exactly like core/evaluate.js
function examWorld(env, policy) {
  env.reset();
  let lastTarget = env.target, since = 0, settledSum = 0, settledN = 0, hits0 = env.hits;
  const trace = [];
  while (!env.done) {
    env.step(policy(env.obs));
    const e = Math.abs(env.x - env.target);
    if (env.target !== lastTarget) { lastTarget = env.target; since = 0; } else since++;
    if (since * S.DT >= 3) { settledSum += e; settledN++; }
    if (env.t % 3 === 0) trace.push([env.t * S.DT, env.x, env.target]);
  }
  const hits = env.hits - hits0, settled = settledN ? settledSum / settledN : NaN;
  return { settled, hits, pass: settledN > 0 && settled < 0.02 && hits <= 2, trace, world: env.world };
}

function drawWorldCard(canvas, r, C) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.fillStyle = C.panel2; ctx.fillRect(0, 0, w, h);
  const T = r.trace[r.trace.length - 1][0];
  const X = t => 4 + t / T * (w - 8), Y = x => 6 + (1 - (x - S.X_MIN) / (S.X_MAX - S.X_MIN)) * (h - 12);
  ctx.strokeStyle = C.ink3; ctx.lineWidth = 1; ctx.beginPath();
  r.trace.forEach(([t, , tg], i) => (i ? ctx.lineTo(X(t), Y(tg)) : ctx.moveTo(X(t), Y(tg)))); ctx.stroke();
  ctx.strokeStyle = r.pass ? C.s1 : C.bad; ctx.lineWidth = 1.5; ctx.beginPath();
  r.trace.forEach(([t, x], i) => (i ? ctx.lineTo(X(t), Y(x)) : ctx.moveTo(X(t), Y(x)))); ctx.stroke();
}

$('btn-exam').addEventListener('click', async () => {
  const pick = actorFor(examPick());
  if (!pick) { toast('Train for a moment first, or pick the starter brain.'); return; }
  const btn = $('btn-exam'); btn.disabled = true;
  const brain = unpackBrain(packBrain(pick.actor, { name: pick.name }));
  const policy = brainPolicy(brain);
  const env = new BeamEnv(4242, { dr: 1, ball: state.ball, episodeSteps: 750 });
  const pidEnv = new BeamEnv(4242, { dr: 1, ball: state.ball, episodeSteps: 750 });
  const grid = $('exam-worlds'); grid.replaceChildren();
  const C = colors();
  let passed = 0, sum = 0, n = 0, hits = 0, pidPassed = 0, pidSum = 0, pidN = 0;
  for (let i = 0; i < 32; i++) {
    const r = examWorld(env, policy);
    const p = examWorld(pidEnv, obs => pidAction(obs));
    if (r.pass) passed++; if (isFinite(r.settled)) { sum += r.settled; n++; } hits += r.hits;
    if (p.pass) pidPassed++; if (isFinite(p.settled)) { pidSum += p.settled; pidN++; }
    const card = document.createElement('div'); card.className = 'world';
    card.title = `${describe(r.world).join(', ')}. Settled within ${(r.settled * 100).toFixed(1)} cm, ${r.hits} wall hits.`;
    const c = document.createElement('canvas'); card.append(c);
    const badge = document.createElement('span'); badge.className = `badge ${r.pass ? 'pass' : 'fail'}`; badge.textContent = r.pass ? '✓ pass' : '✕ miss';
    card.append(badge); grid.append(card);
    drawWorldCard(c, r, C);
    $('ex-pass').textContent = `${passed}/${i + 1}`;
    $('ex-err').textContent = n ? `${(sum / n * 100).toFixed(1)} cm` : '–';
    $('ex-hits').textContent = `${hits}`;
    await nextFrame();
  }
  $('ex-pass-sub').textContent = `classic PID passes ${pidPassed}/32`;
  $('ex-err-sub').textContent = `average after settling; PID ${(pidSum / pidN * 100).toFixed(1)} cm`;
  $('ex-hits-sub').textContent = `in 16 minutes of exam time`;
  btn.disabled = false;
  drawEepromFor(examPick());
});
$('btn-to-robot').addEventListener('click', () => show('robot'));

// ============================================================================ robot
const robot = new Fulcrum();
const R = { connected: false, tele: null, hist: [], brainName: '-', calPts: [], step: null, lastT: 0, mode: 0 };

if (!serialSupported()) {
  $('no-serial').hidden = false;
  for (const id of ['btn-connect', 'btn-flash']) $(id).disabled = true;
}

function setConn(stateName, text) { $('conn-chip').dataset.state = stateName; $('conn-text').textContent = text; }
function logLine(l) { const el = $('log'); el.textContent += l + '\n'; if (el.textContent.length > 20000) el.textContent = el.textContent.slice(-15000); el.scrollTop = el.scrollHeight; }

robot.on(line => {
  if (line.startsWith('T ')) { const t = parseTelemetry(line); if (t) onTelemetry(t); return; }
  logLine(line);
  if (line.startsWith('HI ')) onHello(line);
  else if (line.startsWith('IR ')) { const c = parseInt(line.slice(3), 16); $('ck-ir').textContent = IR_LABELS[c] ? `${IR_LABELS[c]} ✓` : `code ${line.slice(3)}`; }
  else if (/^(CS|CA|CE|CPD|CPU|CB|CL|CD|CR)/.test(line)) onCal(line);
  else if (line.startsWith('BOK ')) { R.brainName = line.slice(4) || '-'; $('robot-brain').textContent = R.brainName; }
  else if (line.startsWith('EV mode ')) setModeButtons(+line.slice(8));
});

function onHello(line) {
  const kv = Object.fromEntries(line.split(' ').slice(3).map(p => p.split('=')));
  R.brainName = kv.brain || '-';
  $('robot-brain').textContent = R.brainName === '-' ? 'no brain yet' : R.brainName;
  const gyro = kv.gyro === '2' ? 'QMI8658 found' : kv.gyro === '1' ? 'MPU-6050 found' : 'not found';
  $('ck-gyro').textContent = gyro;
  $('hello-line').textContent = `${R.virtual ? 'Virtual Fulcrum' : 'Fulcrum'} firmware ${line.split(' ')[2]} · ${kv.cal === '1' ? 'calibrated' : 'not calibrated yet'} · brain: ${R.brainName}`;
  setConn('on', R.virtual ? 'Virtual Fulcrum connected' : 'Fulcrum connected');
  setModeButtons(+kv.mode || 0);
}

function setModeButtons(m) {
  R.mode = m;
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-checked', String(+b.dataset.mode === m));
}

function onTelemetry(t) {
  R.tele = t; R.lastT = performance.now();
  R.hist.push({ x: t.ms / 1000, ball: t.x * 100, target: t.target * 100 });
  while (R.hist.length && R.hist[R.hist.length - 1].x - R.hist[0].x > 20) R.hist.shift();
  if (R.step && R.step.recording) R.step.real.push({ t: (t.ms - R.step.t0) / 1000, x: t.x, target: t.target });
  $('ck-sonar').textContent = t.blind ? 'ball hidden at sensor' : t.raw < 0 ? 'no echo' : `${(t.raw * 100).toFixed(1)} cm`;
  $('ck-knob').textContent = `${Math.round(t.knob / 10.23)}%`;
  if (t.gyro && t.calibrated) $('ck-gyro').textContent = `${t.ang.toFixed(1)}°`;
  $('think-line').textContent = `each 40 ms tick takes ${(t.tickUs / 1000).toFixed(1)} ms`;
  if (t.knobMode) { $('target-slider').value = Math.round(t.target * 1000); $('target-out').textContent = `${(t.target * 100).toFixed(0)} cm`; }
  if (performance.now() - (onTelemetry.lastChart || 0) > 120) { onTelemetry.lastChart = performance.now(); drawTele(); }
}

const teleChart = new LineChart($('tele-chart'), $('tele-tip'), {
  x: { fmt: v => `${v.toFixed(0)}s`, tipFmt: v => `t = ${v.toFixed(1)} s` },
  y: { min: 0, max: 42, fmt: v => `${v.toFixed(0)} cm`, tipFmt: v => `${v.toFixed(1)} cm` },
  series: [{ key: 'target', label: 'target', color: 'ink3', width: 1.5, step: true }, { key: 'ball', label: 'ball', color: 's1', endDot: true }],
  empty: 'Connect the robot to see live readings',
});
addLegend($('tele-chart'), [['s1', 'ball (from the sonar)'], ['ink3', 'target']]);
function drawTele() { teleChart.set(R.hist.slice()); $('tele-meta').textContent = R.tele ? `ball ${(R.tele.x * 100).toFixed(1)} cm · target ${(R.tele.target * 100).toFixed(0)} cm` : ''; }

function addLegend(canvas, items) {
  const row = document.createElement('div'); row.className = 'key'; row.style.marginTop = '8px';
  const C = colors();
  for (const [col, label] of items) {
    const s = document.createElement('span'); const k = document.createElement('i'); k.className = 'k';
    k.style.background = C[col] || col; k.style.height = '3px'; k.style.width = '14px';
    s.append(k, document.createTextNode(label)); row.append(s);
  }
  canvas.parentElement.after(row);
}

const realStage = $('real-stage');
function drawReality() {
  const t = R.tele;
  if (!t || performance.now() - R.lastT > 1500) {
    drawRobot(realStage, { x: S.X_CENTER, th: 0, target: S.X_CENTER, tag: R.connected ? 'REALITY · waiting for data' : 'REALITY · not connected', face: { look: 0, mouth: 'sleep' } });
    return;
  }
  const th = (t.gyro && t.calibrated ? t.ang : t.u * S.THETA_MAX_DEG) * DEG;
  const e = Math.abs(t.x - t.target);
  drawRobot(realStage, {
    x: t.x, th, target: t.target, reading: t.raw, blind: t.blind, pingAge: (performance.now() - R.lastT) / 1000,
    ghostX: R.step && R.step.ghostNow !== undefined ? R.step.ghostNow : null,
    face: t.mode === 0 ? { look: 0, mouth: 'sleep' } : { look: t.x < 0.15 ? -1 : t.x > 0.27 ? 1 : 0, mouth: t.settled ? 'smile' : e > 0.08 ? 'o' : 'flat' },
    tag: `REALITY · ${['resting', 'brain', 'PID', 'knob tilts', 'holding', 'calibrating'][t.mode] || ''}`,
  });
}

async function connect(virtual = false) {
  if (R.connected) return true;
  if (virtual) { robot.port = new VirtualPort(); R.virtual = true; }
  else {
    try { await robot.pick(); } catch (e) { return false; }
    R.virtual = false;
  }
  try {
    setConn('busy', 'Connecting…');
    await robot.open();
    R.connected = true;
    $('btn-connect').hidden = true; $('btn-virtual').hidden = true; $('btn-disconnect').hidden = false;
    $('hello-line').textContent = 'Port open. Waiting for Fulcrum to say hello…';
    await new Promise(r => setTimeout(r, virtual ? 300 : 1800));      // a real Uno restarts when the port opens
    try { await robot.ask('?', 'HI ', 2500); }
    catch (e) {
      setConn('busy', 'No answer');
      $('hello-line').textContent = 'The port is open but nothing answered. If this is the first time, install the firmware (step 2).';
    }
    if (virtual) setConn('on', 'Virtual Fulcrum connected');
    return true;
  } catch (e) {
    setConn('off', 'Robot not connected');
    toast(`Could not open the port: ${e.message}`);
    return false;
  }
}
$('btn-connect').addEventListener('click', () => connect(false));
$('btn-virtual').addEventListener('click', () => connect(true));
$('btn-disconnect').addEventListener('click', async () => {
  await robot.close(); R.connected = false; R.tele = null; R.virtual = false;
  $('btn-connect').hidden = false; $('btn-virtual').hidden = false; $('btn-disconnect').hidden = true; setConn('off', 'Robot not connected');
});

$('btn-flash').addEventListener('click', async () => {
  if (!R.connected && !(await connect())) return;
  const bar = $('flash-bar'), st = $('flash-status');
  bar.hidden = false; bar.value = 0; setConn('busy', 'Installing firmware…');
  try {
    await robot.flash(FIRMWARE_HEX, p => { bar.value = p; }, msg => { st.textContent = msg; logLine(`[install] ${msg}`); });
    st.textContent = 'Installed. Fulcrum is restarting…';
    await new Promise(r => setTimeout(r, 2000));
    await robot.ask('?', 'HI ', 3000).catch(() => { });
    st.textContent = 'Firmware installed and running.';
  } catch (e) {
    st.textContent = `Install failed: ${e.message}`;
    setConn('busy', 'Install failed');
  } finally { bar.hidden = true; }
});

const sendSafe = async line => { if (!R.connected) { toast('Connect the robot first (step 1).'); return false; } try { await robot.send(line); return true; } catch (e) { toast(e.message); return false; } };
$('ck-tilt-n').addEventListener('click', async () => { await sendSafe('M 4'); await sendSafe('U -700'); });
$('ck-level').addEventListener('click', async () => { await sendSafe('M 4'); await sendSafe('U 0'); });
$('ck-tilt-p').addEventListener('click', async () => { await sendSafe('M 4'); await sendSafe('U 700'); });
$('ck-beep').addEventListener('click', () => sendSafe('Y 150'));
$('ck-leds').addEventListener('click', () => sendSafe('X'));
let faceRot = 0;
$('ck-rotate').addEventListener('click', () => { faceRot = (faceRot + 1) % 8; sendSafe(`D 0 ${faceRot}`); toast(faceRot < 4 ? `Face turned ${faceRot * 90}°` : `Face mirrored, turned ${(faceRot - 4) * 90}°`); });
$('cmd-form').addEventListener('submit', async e => { e.preventDefault(); const v = $('cmd-input').value.trim(); if (!v) return; logLine(`> ${v}`); await sendSafe(v); $('cmd-input').value = ''; });
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => sendSafe(`M ${b.dataset.mode}`));
$('target-slider').addEventListener('input', e => { $('target-out').textContent = `${(e.target.value / 10).toFixed(0)} cm`; });
$('target-slider').addEventListener('change', e => sendSafe(`G ${e.target.value}`));
$('btn-knob').addEventListener('click', () => sendSafe('G -1'));

// ---------- calibration
const calChart = new LineChart($('cal-chart'), document.createElement('div'), {
  x: { min: 800, max: 2200, fmt: v => `${v}`, label: 'servo µs' },
  y: { min: -15, max: 15, fmt: v => `${v}°` },
  series: [{ key: 'down', label: 'sweep down', color: 's2' }, { key: 'up', label: 'sweep up', color: 's1' }],
  empty: 'Press Calibrate',
});
function calStep(name, st) { const li = document.querySelector(`[data-step="${name}"]`); if (li) li.dataset.state = st; }
function onCal(line) {
  const p = line.split(' '), tag = p[0], a = +p[1], b = +p[2];
  const st = $('cal-status');
  if (tag === 'CS') { R.calPts = {}; calChart.set([]); for (const s of ['sweep', 'ball', 'level']) calStep(s, ''); calStep(p[1] === 'gyro' ? 'sweep' : 'ball', 'active'); if (p[1] !== 'gyro') calStep('sweep', 'fail'); st.textContent = p[1] === 'gyro' ? 'Reading the gyro at the middle and both ends…' : 'No gyro found, so skipping the sweep.'; }
  else if (tag === 'CA') st.textContent = `The beam swings ${(a / 10).toFixed(1)}° end to end. Sweeping…`;
  else if (tag === 'CE') { calStep('sweep', 'fail'); calStep('ball', 'active'); st.textContent = 'The gyro did not see the beam move, so calibrating without it.'; }
  else if (tag === 'CPD' || tag === 'CPU') {
    const k = tag === 'CPD' ? 'down' : 'up';
    (R.calPts[a] ||= { x: a })[k] = b / 100;
    calChart.set(Object.values(R.calPts).sort((q, r) => q.x - r.x));
    if (tag === 'CPU' && a === 2200) { calStep('sweep', 'done'); calStep('ball', 'active'); st.textContent = 'Ball test: rolling the ball one way, back, and again…'; }
  }
  else if (tag === 'CB') {
    if (b === 0) { calStep('ball', 'fail'); st.textContent = 'The ball did not roll. Is it on the track? If the beam sits far from level at rest, adjust the push-rod and try again.'; }
    else { calStep('ball', 'done'); calStep('level', 'active'); st.textContent = 'Auto-level: holding the ball in the middle to find true level (20 s)…'; }
  }
  else if (tag === 'CL') { calStep('level', b > 40 ? 'done' : 'fail'); st.textContent = b > 40 ? `True level is ${(a / 100).toFixed(2)}° from the servo's middle. Saved.` : 'Auto-level could not settle the ball; level left as it was.'; }
  else if (tag === 'CR' && (a || b)) st.textContent += ` The beam can tilt from ${(a / 100).toFixed(1)}° to ${(b / 100).toFixed(1)}°.${Math.min(-a, b) < 900 ? ' That is a little short of the ±9° Fulcrum likes; a horn hole farther out would help.' : ''}`;
  else if (tag === 'CD') { if (a === 1) toast('Calibration saved on the robot.'); setTimeout(() => robot.send('?').catch(() => { }), 400); }
}
$('btn-cal').addEventListener('click', () => sendSafe('C'));

// ---------- brain upload
$('btn-upload').addEventListener('click', async () => {
  if (!R.connected) { toast('Connect the robot first (step 1).'); return; }
  if (!state.best) { toast('Train a brain first (Dream tab, a minute or two), or use Restore starter brain.'); return; }
  const pick = actorFor('best');
  const u8 = packBrain(pick.actor, { name: pick.name });
  const bar = $('up-bar'), st = $('up-status'); bar.hidden = false; bar.value = 0;
  st.textContent = `Sending ${u8.length} bytes…`;
  try {
    const name = await robot.uploadBrain(u8, p => { bar.value = p; });
    R.brainName = name; R.brainActor = pick.actor;
    $('robot-brain').textContent = name;
    robot.send('?').catch(() => { });
    st.textContent = `Fulcrum checked the brain and stored it. Switch to Brain mode to try it.`;
  } catch (e) { st.textContent = `Upload failed: ${e.message}`; }
  finally { bar.hidden = true; }
});
$('btn-starter').addEventListener('click', async () => { if (await sendSafe('BF')) { R.brainActor = STARTER_ACTOR; $('up-status').textContent = 'Starter brain restored.'; } });

// ---------- dream vs reality
const stepChart = new LineChart($('step-chart'), $('step-tip'), {
  x: { min: 0, max: 20, fmt: v => `${v}s`, tipFmt: v => `t = ${v.toFixed(1)} s` },
  y: { min: 0, max: 42, fmt: v => `${v} cm`, tipFmt: v => `${v.toFixed(1)} cm` },
  series: [{ key: 'target', label: 'target', color: 'ink3', width: 1.5, step: true }, { key: 'dream', label: 'dream', color: 's2' }, { key: 'real', label: 'reality', color: 's1' }],
  empty: 'Run the test with the robot in Brain mode',
});
addLegend($('step-chart'), [['s1', 'reality'], ['s2', 'dream'], ['ink3', 'target']]);
const STEP_PLAN = [[0, 120], [6, 280], [13, 180]];
$('btn-step').addEventListener('click', async () => {
  if (!R.connected || !R.tele) { toast('Connect the robot and wait for live data first.'); return; }
  const st = $('step-status');
  await sendSafe('M 1');
  R.step = { recording: false, real: [], t0: 0 };
  await sendSafe(`G ${STEP_PLAN[0][1]}`);
  st.textContent = 'Parking the ball at 12 cm…';
  await new Promise(r => setTimeout(r, 3000));
  R.step.t0 = R.tele.ms; R.step.recording = true; R.step.x0 = R.tele.x;
  st.textContent = 'Recording reality…';
  for (const [t, mm] of STEP_PLAN.slice(1)) setTimeout(() => sendSafe(`G ${mm}`), t * 1000);
  await new Promise(r => setTimeout(r, 20000));
  R.step.recording = false;
  st.textContent = 'Dreaming the same test…';
  // the same brain, in a nominal dream starting where the real ball started
  const actor = R.brainActor || (R.brainName === 'starter' ? STARTER_ACTOR : (actorFor('best') || {}).actor || STARTER_ACTOR);
  const policy = brainPolicy(unpackBrain(packBrain(actor, { name: 'dream' })));
  const env = new BeamEnv(7, { dr: 0, ball: state.ball, episodeSteps: 1e9 }); env.events = false;
  env.reset(); env.x = R.step.x0; env.v = 0; env.tracker.reset(); env.setTarget(STEP_PLAN[0][1] / 1000); env.sense();
  const dream = [];
  for (let k = 0; k <= 500; k++) {
    const t = k * S.DT;
    const plan = STEP_PLAN.filter(p => p[0] <= t).pop(); env.setTarget(plan[1] / 1000);
    dream.push({ t, x: env.x });
    env.step(policy(env.obs));
  }
  const pts = [];
  for (const d of dream) {
    const real = R.step.real.find(r => Math.abs(r.t - d.t) < 0.03);
    pts.push({ x: d.t, dream: d.x * 100, real: real ? real.x * 100 : undefined, target: STEP_PLAN.filter(p => p[0] <= d.t).pop()[1] / 10 });
  }
  stepChart.set(pts);
  const settle = (key) => { // seconds after the 6 s jump until within 2 cm for good
    const after = pts.filter(p => p.x >= 6 && p.x < 13 && p[key] !== undefined);
    let tSet = null; for (const p of after) { if (Math.abs(p[key] - 28) < 2) { if (tSet === null) tSet = p.x; } else tSet = null; }
    return tSet === null ? null : tSet - 6;
  };
  const sd = settle('dream'), sr = settle('real');
  st.textContent = `After the jump to 28 cm, the dream settled in ${sd === null ? 'more than 7 s' : sd.toFixed(1) + ' s'} and reality in ${sr === null ? 'more than 7 s' : sr.toFixed(1) + ' s'}.`;
});

// ============================================================================ start
window.addEventListener('resize', () => { drawCurve(); map.draw(); drawTele(); });
const start = (location.hash || '').slice(1);
show(['dream', 'exam', 'robot'].includes(start) ? start : 'dream');
drawTele();
calChart.set([]);
stepChart.set([]);
