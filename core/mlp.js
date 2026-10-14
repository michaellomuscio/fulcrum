// A tiny multilayer perceptron with tanh hidden layers and a linear output, plus Adam.
// Hand-written forward and backward passes keep training fast enough to watch live.

export class MLP {
  constructor(sizes, rng, { hiddenGain = Math.SQRT2, outGain = 1 } = {}) {
    this.sizes = sizes.slice();
    this.L = sizes.length - 1;
    this.wOff = []; this.bOff = [];
    let n = 0;
    for (let l = 0; l < this.L; l++) {
      this.wOff.push(n); n += sizes[l + 1] * sizes[l];
      this.bOff.push(n); n += sizes[l + 1];
    }
    this.n = n;
    this.p = new Float64Array(n);
    for (let l = 0; l < this.L; l++) {
      const fanIn = sizes[l], fanOut = sizes[l + 1];
      const gain = l === this.L - 1 ? outGain : hiddenGain;
      orthogonalInit(this.p, this.wOff[l], fanOut, fanIn, gain, rng);
    }
  }

  // acts[l] receives layer l's output for a batch of N rows (each Float64Array(N*size))
  makeActs(N) { return this.sizes.slice(1).map(s => new Float64Array(N * s)); }

  forward(X, N, acts) {
    const { p, sizes, L } = this;
    let inp = X, inSize = sizes[0];
    for (let l = 0; l < L; l++) {
      const out = acts[l], outSize = sizes[l + 1], W = this.wOff[l], B = this.bOff[l], last = l === L - 1;
      for (let i = 0; i < N; i++) {
        const io = i * inSize, oo = i * outSize;
        for (let j = 0; j < outSize; j++) {
          let s = p[B + j];
          const wr = W + j * inSize;
          for (let k = 0; k < inSize; k++) s += p[wr + k] * inp[io + k];
          out[oo + j] = last ? s : Math.tanh(s);
        }
      }
      inp = out; inSize = outSize;
    }
    return acts[L - 1];
  }

  // dOut: dLoss/dOutput (N*outSize). Gradients accumulate into grad (Float64Array(n)).
  backward(X, N, acts, dOut, grad, scratch) {
    const { p, sizes, L } = this;
    if (!scratch || scratch.N < N) scratch = this.makeScratch(N);
    let delta = dOut;
    for (let l = L - 1; l >= 0; l--) {
      const inSize = sizes[l], outSize = sizes[l + 1];
      const inp = l === 0 ? X : acts[l - 1];
      const W = this.wOff[l], B = this.bOff[l];
      const dPrev = l > 0 ? scratch.d[l - 1] : null;
      if (dPrev) dPrev.fill(0, 0, N * inSize);
      for (let i = 0; i < N; i++) {
        const io = i * inSize, oo = i * outSize;
        for (let j = 0; j < outSize; j++) {
          const g = delta[oo + j];
          if (g === 0) continue;
          grad[B + j] += g;
          const wr = W + j * inSize;
          if (dPrev) {
            for (let k = 0; k < inSize; k++) { grad[wr + k] += g * inp[io + k]; dPrev[io + k] += g * p[wr + k]; }
          } else {
            for (let k = 0; k < inSize; k++) grad[wr + k] += g * inp[io + k];
          }
        }
      }
      if (dPrev) {
        const a = acts[l - 1];
        for (let t = 0; t < N * inSize; t++) dPrev[t] *= 1 - a[t] * a[t];
        delta = dPrev;
      }
    }
    return scratch;
  }

  makeScratch(N) { return { N, d: this.sizes.slice(1, -1).map(s => new Float64Array(N * s)) }; }

  // single-sample forward that also reports hidden activations (for drawing neurons)
  run(x, hidden = null) {
    const { p, sizes, L } = this;
    let inp = x;
    for (let l = 0; l < L; l++) {
      const inSize = sizes[l], outSize = sizes[l + 1], W = this.wOff[l], B = this.bOff[l];
      const out = hidden && l < L - 1 ? hidden[l] : new Float64Array(outSize);
      for (let j = 0; j < outSize; j++) {
        let s = p[B + j];
        for (let k = 0; k < inSize; k++) s += p[W + j * inSize + k] * inp[k];
        out[j] = l === L - 1 ? s : Math.tanh(s);
      }
      inp = out;
    }
    return inp;
  }

  layers() {
    const out = [];
    for (let l = 0; l < this.L; l++) {
      const inSize = this.sizes[l], outSize = this.sizes[l + 1];
      out.push({
        inSize, outSize,
        W: Array.from(this.p.subarray(this.wOff[l], this.wOff[l] + inSize * outSize)),
        b: Array.from(this.p.subarray(this.bOff[l], this.bOff[l] + outSize)),
      });
    }
    return out;
  }
}

function orthogonalInit(p, off, rows, cols, gain, rng) {
  // Gram-Schmidt on a random Gaussian matrix (rows x cols), scaled by gain
  const n = Math.max(rows, cols), m = Math.min(rows, cols);
  const A = [];
  for (let i = 0; i < m; i++) {
    let v = new Float64Array(n);
    for (let k = 0; k < n; k++) v[k] = rng.gauss();
    for (const u of A) { let d = 0; for (let k = 0; k < n; k++) d += v[k] * u[k]; for (let k = 0; k < n; k++) v[k] -= d * u[k]; }
    let norm = 0; for (let k = 0; k < n; k++) norm += v[k] * v[k];
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < n; k++) v[k] /= norm;
    A.push(v);
  }
  // A holds m orthonormal vectors of length n
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = rows <= cols ? A[r][c] : A[c][r];
      p[off + r * cols + c] = gain * val;
    }
  }
}

export class Adam {
  constructor(n, lr = 1e-3, b1 = 0.9, b2 = 0.999, eps = 1e-8) {
    this.m = new Float64Array(n); this.v = new Float64Array(n);
    this.lr = lr; this.b1 = b1; this.b2 = b2; this.eps = eps; this.t = 0;
  }
  step(p, g) {
    this.t++;
    const { m, v, b1, b2, eps } = this;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    const lr = this.lr * Math.sqrt(c2) / c1;
    for (let i = 0; i < p.length; i++) {
      const gi = g[i];
      m[i] = b1 * m[i] + (1 - b1) * gi;
      v[i] = b2 * v[i] + (1 - b2) * gi * gi;
      p[i] -= lr * m[i] / (Math.sqrt(v[i]) + eps);
    }
  }
}

export function clipGradNorm(g, maxNorm) {
  let s = 0;
  for (let i = 0; i < g.length; i++) s += g[i] * g[i];
  const norm = Math.sqrt(s);
  if (norm > maxNorm) { const k = maxNorm / norm; for (let i = 0; i < g.length; i++) g[i] *= k; }
  return norm;
}
