// Small, fast, seedable random numbers (sfc32). Every simulated world gets its own stream,
// so a training run can be replayed exactly from its seed.

export class Rng {
  constructor(seed = 1) {
    this.a = 0x9e3779b9 ^ seed;
    this.b = 0x243f6a88 ^ Math.imul(seed, 0x85ebca6b);
    this.c = 0xb7e15162 ^ Math.imul(seed, 0xc2b2ae35);
    this.d = 1 ^ seed;
    this.spare = null;
    for (let i = 0; i < 15; i++) this.next();
  }
  next() {
    let { a, b, c, d } = this;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = c << 21 | c >>> 11;
    c = c + t | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return (t >>> 0) / 4294967296;
  }
  uniform(lo, hi) { return lo + (hi - lo) * this.next(); }
  logUniform(lo, hi) { return Math.exp(this.uniform(Math.log(lo), Math.log(hi))); }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  gauss() {
    if (this.spare !== null) { const s = this.spare; this.spare = null; return s; }
    let u, v, s;
    do { u = 2 * this.next() - 1; v = 2 * this.next() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this.spare = v * m;
    return u * m;
  }
}
