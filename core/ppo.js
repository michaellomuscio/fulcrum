// Proximal Policy Optimization for the beam. Many simulated robots practice in parallel;
// the actor (the brain that ships to the Arduino) learns which tilt to choose, and a larger
// critic, which also gets to peek at the hidden physics, learns how promising each moment is.

import * as S from './spec.js';
import { Rng } from './rng.js';
import { MLP, Adam, clipGradNorm } from './mlp.js';
import { BeamEnv, PRIV_N } from './world.js';

const LOG2PI = Math.log(2 * Math.PI);

export const PPO_DEFAULTS = {
  nEnvs: 64, horizon: 128, epochs: 6, minibatch: 1024,
  gamma: 0.98, lam: 0.95, clip: 0.2,
  lrActor: 1e-3, lrCritic: 1e-3, maxGradNorm: 0.5, vfCoef: 0.5, entCoef: 0.0,
  logStd0: -0.5, minLogStd: -2.5, targetKL: 0.03,
  criticHidden: 32, seed: 1, dr: 1, ball: 'pingpong', episodeSteps: 500,
  targetJumpEvery: 6, pokeEvery: 15,
};

export class PPO {
  constructor(opts = {}) {
    this.o = { ...PPO_DEFAULTS, ...opts };
    const o = this.o;
    this.rng = new Rng(o.seed * 7919 + 13);
    this.envs = [];
    for (let i = 0; i < o.nEnvs; i++) {
      this.envs.push(new BeamEnv(o.seed * 100003 + i * 9973 + 1, { dr: o.dr, ball: o.ball, episodeSteps: o.episodeSteps, targetJumpEvery: o.targetJumpEvery, pokeEvery: o.pokeEvery }));
      // stagger episode clocks so resets don't all land on the same iteration
      this.envs[i].t = Math.floor(this.rng.next() * o.episodeSteps * 0.9);
    }
    this.nIn = S.NET_IN;
    this.cIn = S.NET_IN + PRIV_N;
    this.actor = new MLP([this.nIn, S.NET_H1, S.NET_H2, 1], this.rng, { outGain: 0.01 });
    this.critic = new MLP([this.cIn, o.criticHidden, o.criticHidden, 1], this.rng, { outGain: 1 });
    this.logStd = o.logStd0;
    this.optA = new Adam(this.actor.n + 1, o.lrActor);
    this.optC = new Adam(this.critic.n, o.lrCritic);
    const N = o.nEnvs, T = o.horizon, B = N * T;
    this.buf = {
      obs: new Float64Array(B * this.nIn), cin: new Float64Array(B * this.cIn),
      act: new Float64Array(B), logp: new Float64Array(B), rew: new Float64Array(B),
      val: new Float64Array(B), adv: new Float64Array(B), ret: new Float64Array(B),
      trunc: new Float64Array(B), done: new Uint8Array(B),
    };
    this.stepX = new Float64Array(N * this.nIn);
    this.stepC = new Float64Array(N * this.cIn);
    this.aActs = this.actor.makeActs(Math.max(N, o.minibatch));
    this.cActs = this.critic.makeActs(Math.max(N, o.minibatch));
    this.mbX = new Float64Array(o.minibatch * this.nIn);
    this.mbC = new Float64Array(o.minibatch * this.cIn);
    this.dMu = new Float64Array(o.minibatch);
    this.dV = new Float64Array(o.minibatch);
    this.gA = new Float64Array(this.actor.n + 1);
    this.gC = new Float64Array(this.critic.n);
    this.scrA = this.actor.makeScratch(o.minibatch);
    this.scrC = this.critic.makeScratch(o.minibatch);
    this.perm = new Uint32Array(B);
    for (let i = 0; i < B; i++) this.perm[i] = i;
    this.vScale = 1 - o.gamma;            // critic predicts returns * (1 - gamma), keeping targets near 1
    this.epReturn = new Float64Array(N);
    this.epErr = new Float64Array(N);
    this.epLen = new Float64Array(N);
    this.recent = [];                     // finished episodes: { ret, err, hits }
    this.iteration = 0;
    this.totalSteps = 0;
    this.totalEpisodes = 0;
  }

  fillInputs(env, xo, co) {
    const X = this.stepX, C = this.stepC;
    for (let k = 0; k < this.nIn; k++) { X[xo + k] = env.obs[k]; C[co + k] = env.obs[k]; }
    for (let k = 0; k < PRIV_N; k++) C[co + this.nIn + k] = env.priv[k];
  }

  collect() {
    const o = this.o, N = o.nEnvs, T = o.horizon, b = this.buf;
    const std = Math.exp(this.logStd);
    for (let t = 0; t < T; t++) {
      for (let i = 0; i < N; i++) this.fillInputs(this.envs[i], i * this.nIn, i * this.cIn);
      const mu = this.actor.forward(this.stepX, N, this.aActs);
      const v = this.critic.forward(this.stepC, N, this.cActs);
      for (let i = 0; i < N; i++) {
        const idx = t * N + i;
        b.obs.set(this.stepX.subarray(i * this.nIn, (i + 1) * this.nIn), idx * this.nIn);
        b.cin.set(this.stepC.subarray(i * this.cIn, (i + 1) * this.cIn), idx * this.cIn);
        const eps = this.rng.gauss();
        const a = mu[i] + std * eps;
        b.act[idx] = a;
        b.logp[idx] = -0.5 * eps * eps - this.logStd - 0.5 * LOG2PI;
        b.val[idx] = v[i] / this.vScale;
        const env = this.envs[i];
        const r = env.step(a);
        b.rew[idx] = r;
        this.epReturn[i] += r; this.epErr[i] += Math.abs(env.x - env.target); this.epLen[i]++;
        b.done[idx] = 0; b.trunc[idx] = 0;
        if (env.done) {
          // time limit, not failure: bootstrap from the value of the state we stopped in
          b.done[idx] = 1;
          b.trunc[idx] = this.valueOf(env);
          this.recent.push({ ret: this.epReturn[i], err: this.epErr[i] / this.epLen[i], hits: env.hits, len: this.epLen[i] });
          if (this.recent.length > 200) this.recent.shift();
          this.totalEpisodes++;
          this.epReturn[i] = 0; this.epErr[i] = 0; this.epLen[i] = 0;
          env.reset();
        }
      }
    }
    this.totalSteps += N * T;
    // bootstrap values for the state after the last step
    for (let i = 0; i < N; i++) this.fillInputs(this.envs[i], i * this.nIn, i * this.cIn);
    const vLast = this.critic.forward(this.stepC, N, this.cActs);
    const { gamma, lam } = o;
    for (let i = 0; i < N; i++) {
      let nextV = vLast[i] / this.vScale, gae = 0;
      for (let t = T - 1; t >= 0; t--) {
        const idx = t * N + i;
        let delta;
        if (b.done[idx]) { delta = b.rew[idx] + gamma * b.trunc[idx] - b.val[idx]; gae = delta; }
        else { delta = b.rew[idx] + gamma * nextV - b.val[idx]; gae = delta + gamma * lam * gae; }
        b.adv[idx] = gae;
        b.ret[idx] = gae + b.val[idx];
        nextV = b.val[idx];
      }
    }
  }

  valueOf(env) {
    const C = new Float64Array(this.cIn);
    for (let k = 0; k < this.nIn; k++) C[k] = env.obs[k];
    for (let k = 0; k < PRIV_N; k++) C[this.nIn + k] = env.priv[k];
    return this.critic.run(C)[0] / this.vScale;
  }

  update() {
    const o = this.o, b = this.buf, B = o.nEnvs * o.horizon, M = o.minibatch;
    // normalize advantages
    let mean = 0, sq = 0;
    for (let i = 0; i < B; i++) mean += b.adv[i];
    mean /= B;
    for (let i = 0; i < B; i++) sq += (b.adv[i] - mean) ** 2;
    const sd = Math.sqrt(sq / B) + 1e-8;
    const advN = new Float64Array(B);
    for (let i = 0; i < B; i++) advN[i] = (b.adv[i] - mean) / sd;

    let kl = 0, clipFrac = 0, vLoss = 0, nMb = 0, stopped = false;
    for (let ep = 0; ep < o.epochs && !stopped; ep++) {
      // shuffle
      for (let i = B - 1; i > 0; i--) { const j = Math.floor(this.rng.next() * (i + 1)); const t = this.perm[i]; this.perm[i] = this.perm[j]; this.perm[j] = t; }
      let epKL = 0, epN = 0;
      for (let start = 0; start + M <= B; start += M) {
        for (let m = 0; m < M; m++) {
          const idx = this.perm[start + m];
          this.mbX.set(b.obs.subarray(idx * this.nIn, (idx + 1) * this.nIn), m * this.nIn);
          this.mbC.set(b.cin.subarray(idx * this.cIn, (idx + 1) * this.cIn), m * this.cIn);
        }
        // ---- actor ----
        const mu = this.actor.forward(this.mbX, M, this.aActs);
        const ls = this.logStd, std = Math.exp(ls), inv2 = 1 / (std * std);
        let dLogStd = 0;
        for (let m = 0; m < M; m++) {
          const idx = this.perm[start + m];
          const a = b.act[idx], d = a - mu[m];
          const logp = -0.5 * d * d * inv2 - ls - 0.5 * LOG2PI;
          const ratio = Math.exp(logp - b.logp[idx]);
          const A = advN[idx];
          epKL += b.logp[idx] - logp; epN++;
          const clipped = (A > 0 && ratio > 1 + o.clip) || (A < 0 && ratio < 1 - o.clip);
          if (clipped) { clipFrac++; this.dMu[m] = 0; continue; }
          const g = -ratio * A / M;          // dLoss/dlogp
          this.dMu[m] = g * d * inv2;        // dlogp/dmu = (a-mu)/std^2
          dLogStd += g * (d * d * inv2 - 1); // dlogp/dlogstd
        }
        dLogStd -= o.entCoef;                // entropy bonus pushes log std up
        this.gA.fill(0);
        this.actor.backward(this.mbX, M, this.aActs, this.dMu, this.gA, this.scrA);
        this.gA[this.actor.n] = dLogStd;
        clipGradNorm(this.gA, o.maxGradNorm);
        const pa = new Float64Array(this.actor.n + 1);
        pa.set(this.actor.p); pa[this.actor.n] = this.logStd;
        this.optA.step(pa, this.gA);
        this.actor.p.set(pa.subarray(0, this.actor.n));
        this.logStd = Math.max(o.minLogStd, pa[this.actor.n]);
        // ---- critic ----
        const v = this.critic.forward(this.mbC, M, this.cActs);
        for (let m = 0; m < M; m++) {
          const idx = this.perm[start + m];
          const target = b.ret[idx] * this.vScale;
          const err = v[m] - target;
          vLoss += err * err;
          this.dV[m] = o.vfCoef * err / M;
        }
        this.gC.fill(0);
        this.critic.backward(this.mbC, M, this.cActs, this.dV, this.gC, this.scrC);
        clipGradNorm(this.gC, o.maxGradNorm);
        this.optC.step(this.critic.p, this.gC);
        nMb++;
      }
      kl = epKL / Math.max(1, epN);
      if (o.targetKL && kl > o.targetKL) stopped = true;
    }
    this.iteration++;
    return { kl, clipFrac: clipFrac / Math.max(1, nMb * M), vLoss: vLoss / Math.max(1, nMb * M) };
  }

  iterate() {
    const t0 = now();
    this.collect();
    const t1 = now();
    const u = this.update();
    const t2 = now();
    return { ...u, ...this.summary(), msCollect: t1 - t0, msUpdate: t2 - t1 };
  }

  summary(last = 50) {
    const r = this.recent.slice(-last);
    const avg = f => r.length ? r.reduce((s, e) => s + f(e), 0) / r.length : NaN;
    return {
      iteration: this.iteration, steps: this.totalSteps, episodes: this.totalEpisodes,
      epReturn: avg(e => e.ret), epErr: avg(e => e.err), epHits: avg(e => e.hits),
      std: Math.exp(this.logStd),
    };
  }

  policyFn() {
    const net = this.actor;
    return obs => Math.max(-1, Math.min(1, net.run(obs)[0]));
  }

  exportActor() {
    return { sizes: this.actor.sizes, layers: this.actor.layers(), logStd: this.logStd };
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
