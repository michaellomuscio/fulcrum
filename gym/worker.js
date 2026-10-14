// Training runs here, off the page's main thread, as fast as the computer allows.
// Every learning step it reports progress and the current brain; every 10 it quietly examines
// the 8-bit copy of the brain and keeps the best one so far.
import { PPO } from '../core/ppo.js';
import { evaluate } from '../core/evaluate.js';
import { packBrain, unpackBrain, brainPolicy } from '../core/brain.js';
import { pidAction } from '../core/world.js';
import * as S from '../core/spec.js';

let ppo = null, running = false, best = null, wallMs = 0, dr = 1, ball = 'pingpong', seed = 1;

function post(type, data = {}) { self.postMessage({ type, ...data }); }

function quickExam(actor) {
  const brain = unpackBrain(packBrain(actor, { name: 'quick' }));
  return evaluate(brainPolicy(brain), { episodes: 8, seed: 31337, steps: 500, dr, ball });
}

function fresh(o = {}) {
  dr = o.dr ?? dr; ball = o.ball ?? ball; seed = o.seed ?? Math.floor(Math.random() * 1e9);
  ppo = new PPO({ seed, dr, ball });
  best = null; wallMs = 0;
  const pid = evaluate(obs => pidAction(obs), { episodes: 12, seed: 999, steps: 500, dr, ball });
  post('ready', { actor: ppo.exportActor(), nEnvs: ppo.o.nEnvs, pidErr: pid.meanErr, seed });
}

async function loop() {
  while (running) {
    const t = performance.now();
    const s = ppo.iterate();
    wallMs += performance.now() - t;
    const actor = ppo.exportActor();
    let bestMsg = null;
    if (s.iteration % 10 === 0) {
      const ex = quickExam(actor);
      if (!best || ex.rewardPerStep > best.score) {
        best = { actor, score: ex.rewardPerStep, settledErr: ex.settledErr, passRate: ex.passRate, iteration: s.iteration };
        bestMsg = best;
      }
    }
    post('progress', {
      stats: { ...s, hours: s.steps * S.DT / 3600 },
      actor, wallMs, best: bestMsg,
    });
    await new Promise(r => setTimeout(r, 0));   // let pause and settings messages in
  }
}

self.onmessage = e => {
  const m = e.data;
  if (m.cmd === 'new') { running = false; fresh(m.opts); }
  else if (m.cmd === 'start') { if (!ppo) fresh(); if (!running) { running = true; loop(); } }
  else if (m.cmd === 'pause') running = false;
  else if (m.cmd === 'set') {
    if (m.dr !== undefined) dr = m.dr;
    if (m.ball !== undefined) ball = m.ball;
    if (ppo) for (const env of ppo.envs) { env.dr = dr; env.ball = ball; }   // takes effect as each practice run restarts
  }
};
