// The exam: run a controller through many fresh worlds and grade it.
import * as S from './spec.js';
import { BeamEnv } from './world.js';

export function evaluate(policy, opts = {}) {
  const { episodes = 24, seed = 4242, dr = 1, ball = 'pingpong', steps = 750, events = true, onStep = null } = opts;
  const env = new BeamEnv(seed, { dr, ball, episodeSteps: steps, events });
  let sumErr = 0, nErr = 0, sumSettled = 0, nSettled = 0, hits = 0, rew = 0, n = 0, worldsPassed = 0;
  const perWorld = [];
  for (let ep = 0; ep < episodes; ep++) {
    env.reset();
    let lastTarget = env.target, since = 0, wSettled = 0, wN = 0, wHits0 = env.hits, wErr = 0;
    while (!env.done) {
      const u = policy(env.obs, env);
      rew += env.step(u);
      n++;
      if (onStep) onStep(env, u);
      const e = Math.abs(env.x - env.target);
      sumErr += e; nErr++; wErr += e;
      if (env.target !== lastTarget) { lastTarget = env.target; since = 0; } else since++;
      if (since * S.DT >= 3) { sumSettled += e; nSettled++; wSettled += e; wN++; }
    }
    const wh = env.hits - wHits0;
    hits += wh;
    const settled = wN ? wSettled / wN : NaN;
    const pass = wN > 0 && settled < 0.02 && wh <= 2;
    if (pass) worldsPassed++;
    perWorld.push({ settled, hits: wh, err: wErr / steps, pass, k: env.world.k, level: env.world.level });
  }
  const minutes = n * S.DT / 60;
  return {
    meanErr: sumErr / nErr,
    settledErr: nSettled ? sumSettled / nSettled : NaN,
    hitsPerMin: hits / minutes,
    rewardPerStep: rew / n,
    passRate: worldsPassed / episodes,
    perWorld,
  };
}

export function fmtEval(r) {
  return `settled ${(r.settledErr * 100).toFixed(2)} cm | mean ${(r.meanErr * 100).toFixed(2)} cm | hits/min ${r.hitsPerMin.toFixed(2)} | r/step ${r.rewardPerStep.toFixed(3)} | pass ${(r.passRate * 100).toFixed(0)}%`;
}
