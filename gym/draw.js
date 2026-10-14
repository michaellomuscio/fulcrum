// Everything the Gym draws: the robot (dream and reality), practice thumbnails, charts,
// the policy map, the network, and the EEPROM map.
import * as S from '../core/spec.js';

export function colors() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  return {
    bg: v('--bg'), panel: v('--panel'), panel2: v('--panel-2'), ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'),
    line: v('--line'), line2: v('--line-2'), pcb: v('--pcb'), ball: v('--ball'), kraft: v('--kraft'), kraft2: v('--kraft-2'),
    kraft3: v('--kraft-3'), good: v('--good'), bad: v('--bad'), s1: v('--series-1'), s2: v('--series-2'),
    neg: v('--div-neg'), mid: v('--div-mid'), pos: v('--div-pos'), grid: v('--grid'), axis: v('--axis'),
    stageTop: v('--stage-top'), stageBot: v('--stage-bot'), mono: v('--font-mono') || 'monospace',
  };
}

export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 150;
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// ---------------------------------------------------------------------------------------------
// color helpers
function hexRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }
export function diverge(C, t) {        // t in [-1, 1]: neg -> mid -> pos
  const a = hexRgb(t < 0 ? C.neg : C.pos), m = hexRgb(C.mid), k = Math.min(1, Math.abs(t));
  return [0, 1, 2].map(i => Math.round(m[i] + (a[i] - m[i]) * k));
}

// ---------------------------------------------------------------------------------------------
// the robot, in meters, as built in the guide
export const G = {
  PIVOT_H: 0.125, APEX: 0.013, WALL: 0.025, BALL_UP: 0.032,
  TRACK0: -0.004, TRACK1: S.TRACK_LEN + 0.004, ROD_X: 0.28, SERVO_H: 0.05, HORN: 0.014,
  TOWER_W: 0.07, BASE0: -0.06, BASE1: 0.49,
};

export function faceBits(look, mouth) {
  if (mouth === 'sleep') return [0, 0, 0x66, 0, 0, 0x18, 0, 0];
  if (mouth === 'question') return [0x3C, 0x42, 0x02, 0x0C, 0x10, 0x00, 0x10, 0x00];
  const m = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const r of [1, 2]) for (const c of [1, 2, 5, 6]) { const cc = c + look; if (cc >= 0 && cc < 8) m[r] |= 0x80 >> cc; }
  if (mouth === 'smile') { m[4] |= 0x81; m[5] |= 0x42; m[6] |= 0x3C; }
  else if (mouth === 'flat') m[5] |= 0x3C;
  else { m[4] |= 0x18; m[5] |= 0x24; m[6] |= 0x18; }
  return m;
}

// st: { x, th, target, spin, pingAge, reading, blind, face:{look,mouth}, ballKey, tag, ghostX, dragTarget }
export function drawRobot(canvas, st, C = colors()) {
  const { ctx, w, h } = fitCanvas(canvas);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, C.stageTop); g.addColorStop(1, C.stageBot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  const sceneW = G.BASE1 - G.BASE0 + 0.04, sceneH = 0.26;
  const pad = 14;
  const sc = Math.min((w - 2 * pad) / sceneW, (h - 2 * pad) / sceneH);
  const ox = w / 2 - ((G.BASE0 + G.BASE1) / 2) * sc, oy = Math.min(h - pad - 0.012 * sc, h / 2 + 0.12 * sc);
  const X = x => ox + x * sc, Y = y => oy - y * sc;
  const geo = { sc, ox, oy };

  // floor shadow and base board
  ctx.fillStyle = rgba(C.ink, 0.08);
  ctx.beginPath(); ctx.ellipse(X((G.BASE0 + G.BASE1) / 2), Y(-0.004), (G.BASE1 - G.BASE0) / 2 * sc, 0.008 * sc, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.kraft2; ctx.fillRect(X(G.BASE0), Y(0.008), (G.BASE1 - G.BASE0) * sc, 0.008 * sc);
  ctx.fillStyle = C.kraft; ctx.fillRect(X(G.BASE0), Y(0.008), (G.BASE1 - G.BASE0) * sc, 0.003 * sc);

  // back tower
  const tx0 = S.PIVOT_X - G.TOWER_W / 2;
  ctx.fillStyle = C.kraft2;
  ctx.fillRect(X(tx0 + 0.006), Y(G.PIVOT_H + 0.015), (G.TOWER_W - 0.012) * sc, (G.PIVOT_H + 0.015 - 0.008) * sc);

  // servo post, servo and horn
  const th = st.th;
  const lift = -(G.ROD_X - S.PIVOT_X) * Math.sin(th);
  const phi = Math.asin(Math.max(-1, Math.min(1, lift / G.HORN)));
  ctx.fillStyle = C.kraft2; ctx.fillRect(X(G.ROD_X - 0.018), Y(G.SERVO_H - 0.012), 0.036 * sc, (G.SERVO_H - 0.02) * sc);
  ctx.fillStyle = '#2f6fd0';
  roundRect(ctx, X(G.ROD_X - 0.016), Y(G.SERVO_H + 0.012), 0.032 * sc, 0.026 * sc, 2); ctx.fill();
  ctx.fillStyle = '#1f4f9a'; ctx.fillRect(X(G.ROD_X - 0.022), Y(G.SERVO_H - 0.002), 0.044 * sc, 0.004 * sc);
  const sx = G.ROD_X, sz = G.SERVO_H + 0.004;
  const hx = sx + G.HORN * Math.cos(phi + Math.PI), hz = sz + G.HORN * Math.sin(phi) ;
  // the push-rod hangs from the horn tip (horn points back toward the pivot) to the beam
  const tipX = sx - G.HORN * Math.cos(phi), tipZ = sz - G.HORN * Math.sin(-phi);
  const beamPt = (s, n) => [S.PIVOT_X + (s - S.PIVOT_X) * Math.cos(th) + n * Math.sin(th), G.PIVOT_H - (s - S.PIVOT_X) * Math.sin(th) + n * Math.cos(th)];
  const [rodX, rodZ] = beamPt(G.ROD_X - G.HORN, -0.008);
  ctx.strokeStyle = C.ink3; ctx.lineWidth = Math.max(1.5, 0.0012 * sc); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(X(tipX), Y(tipZ)); ctx.lineTo(X(rodX), Y(rodZ)); ctx.stroke();
  ctx.strokeStyle = '#f4f4f2'; ctx.lineWidth = 0.006 * sc;
  ctx.beginPath(); ctx.moveTo(X(sx), Y(sz)); ctx.lineTo(X(tipX), Y(tipZ)); ctx.stroke();
  ctx.fillStyle = '#d8d8d4'; ctx.beginPath(); ctx.arc(X(sx), Y(sz), 0.004 * sc, 0, Math.PI * 2); ctx.fill();
  void hx; void hz;

  // the beam, drawn in its own rotating frame (s along the track, n up from the skewer)
  ctx.save();
  ctx.translate(X(S.PIVOT_X), Y(G.PIVOT_H));
  ctx.rotate(th);
  const bx = s => (s - S.PIVOT_X) * sc, by = n => -n * sc;
  // saddles
  ctx.fillStyle = C.kraft2;
  for (const s of [0.06, S.PIVOT_X, G.ROD_X, 0.38]) {
    ctx.beginPath();
    ctx.moveTo(bx(s - 0.004), by(-0.01)); ctx.lineTo(bx(s + 0.004), by(-0.01));
    ctx.lineTo(bx(s + 0.004), by(G.APEX + 0.004)); ctx.lineTo(bx(s - 0.004), by(G.APEX + 0.004)); ctx.closePath(); ctx.fill();
  }
  // back wall of the V
  ctx.fillStyle = C.kraft2;
  ctx.fillRect(bx(G.TRACK0), by(G.APEX + G.WALL), (G.TRACK1 - G.TRACK0) * sc, G.WALL * sc);

  // sonar pings, travelling from the sensor along the track
  const ballR = st.ballKey === 'golf' ? 0.0213 : 0.02;
  const ballN = G.APEX + G.BALL_UP;
  if (st.pingAge !== undefined && st.pingAge >= 0) {
    const reach = st.blind || st.reading < 0 ? G.TRACK1 : Math.max(0.02, st.x - ballR);
    for (let k = 0; k < 3; k++) {
      const age = st.pingAge + k * 0.16;
      const rr = Math.min(reach, age * 1.6);
      const alpha = Math.max(0, 0.45 - age * 0.9);
      if (alpha <= 0 || rr <= 0.005) continue;
      const spread = Math.min(0.3, 0.018 / Math.max(rr, 0.03));   // the beam stays about as wide as the ball
      ctx.strokeStyle = rgba(C.s1, alpha); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(bx(0), by(ballN), rr * sc, -spread, spread); ctx.stroke();
    }
  }

  // ghost ball (the dream, overlaid on reality)
  if (st.ghostX !== undefined && st.ghostX !== null) {
    ctx.fillStyle = rgba(C.s2, 0.28); ctx.strokeStyle = rgba(C.s2, 0.8); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(bx(st.ghostX), by(ballN), ballR * sc, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // the ball, rolling (a printed band shows the spin)
  drawBall(ctx, bx(st.x), by(ballN), ballR * sc, st.spin || 0, st.ballKey, C);

  // front wall, end plate with the sonar, far wall, gyro board
  ctx.fillStyle = C.kraft;
  ctx.fillRect(bx(G.TRACK0), by(G.APEX + G.WALL * 0.78), (G.TRACK1 - G.TRACK0) * sc, G.WALL * 0.78 * sc);
  ctx.fillStyle = C.kraft3;
  ctx.fillRect(bx(G.TRACK0), by(G.APEX + G.WALL * 0.78), (G.TRACK1 - G.TRACK0) * sc, Math.max(1, 0.0012 * sc));
  ctx.fillStyle = C.kraft2;
  ctx.fillRect(bx(G.TRACK0 - 0.005), by(0.072), 0.005 * sc, 0.084 * sc);
  ctx.fillRect(bx(G.TRACK1), by(G.APEX + 0.045), 0.005 * sc, 0.055 * sc);
  ctx.fillStyle = '#2d6fd6';
  roundRect(ctx, bx(G.TRACK0 - 0.02), by(ballN + 0.0105), 0.015 * sc, 0.021 * sc, 1.5); ctx.fill();
  ctx.fillStyle = '#c9cfd6';
  ctx.fillRect(bx(G.TRACK0 - 0.0005), by(ballN + 0.008), 0.004 * sc, 0.016 * sc);
  ctx.fillStyle = '#2d6fd6';
  roundRect(ctx, bx(0.15), by(G.APEX + 0.018), 0.02 * sc, 0.015 * sc, 1.5); ctx.fill();
  ctx.fillStyle = '#111'; ctx.fillRect(bx(0.157), by(G.APEX + 0.0125), 0.006 * sc, 0.004 * sc);

  // target marker
  if (st.target !== undefined) {
    const tx = bx(st.target), ty = by(G.APEX + G.WALL + 0.03);
    ctx.fillStyle = C.ball;
    ctx.beginPath(); ctx.moveTo(tx, ty + 0.012 * sc); ctx.lineTo(tx - 0.008 * sc, ty); ctx.lineTo(tx + 0.008 * sc, ty); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(C.ball, 0.55); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(tx, ty + 0.014 * sc); ctx.lineTo(tx, by(G.APEX + G.WALL * 0.78)); ctx.stroke();
  }
  ctx.restore();

  // front tower with the LED face, and the skewer
  ctx.fillStyle = C.kraft;
  ctx.fillRect(X(tx0), Y(G.PIVOT_H + 0.012), G.TOWER_W * sc, (G.PIVOT_H + 0.012 - 0.008) * sc);
  ctx.fillStyle = C.kraft3; ctx.fillRect(X(tx0), Y(G.PIVOT_H + 0.012), G.TOWER_W * sc, Math.max(1, 0.0015 * sc));
  ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.arc(X(S.PIVOT_X), Y(G.PIVOT_H), 0.0035 * sc, 0, Math.PI * 2); ctx.fill();
  if (st.face) drawMatrix(ctx, X(S.PIVOT_X), Y(G.PIVOT_H - 0.05), 0.034 * sc, faceBits(st.face.look, st.face.mouth));

  // labels
  ctx.font = `500 ${Math.max(10, Math.round(sc * 0.011))}px ${C.mono}`;
  ctx.fillStyle = C.ink3; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  if (st.tag) ctx.fillText(st.tag, w - 12, 12);
  if (st.reading !== undefined) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    const txt = st.blind ? 'sonar: ball hiding at the sensor' : st.reading < 0 ? 'sonar: no echo' : `sonar: ${(st.reading * 100).toFixed(1)} cm`;
    ctx.fillText(txt, 12, h - 10);
  }
  if (st.dragTarget) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = C.ink2;
    const p = beamPt(st.target, G.APEX + G.WALL + 0.05);
    ctx.fillText(`target ${(st.target * 100).toFixed(0)} cm`, X(p[0]), Y(p[1]));
  }
  return geo;
}

function drawBall(ctx, cx, cy, r, spin, key, C) {
  const base = key === 'rubber' ? C.ball : '#f7f7f4';
  const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.55, base); grad.addColorStop(1, key === 'rubber' ? '#a8431d' : '#c9c7bf');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = key === 'rubber' ? 'rgba(255,255,255,0.55)' : rgba(C.ball, 0.75); ctx.lineWidth = Math.max(1.2, r * 0.16);
  ctx.beginPath(); ctx.ellipse(cx, cy, r * Math.abs(Math.cos(spin)) + 0.5, r * 1.05, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawMatrix(ctx, cx, cy, size, bits) {
  ctx.fillStyle = '#121212';
  roundRect(ctx, cx - size / 2 - size * 0.08, cy - size / 2 - size * 0.08, size * 1.16, size * 1.16, 2); ctx.fill();
  const cell = size / 8;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const on = bits[r] & (0x80 >> c);
    ctx.fillStyle = on ? '#ff3b2f' : '#3a1512';
    ctx.beginPath(); ctx.arc(cx - size / 2 + (c + 0.5) * cell, cy - size / 2 + (r + 0.5) * cell, cell * 0.36, 0, Math.PI * 2); ctx.fill();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// screen point -> track position (meters from the sensor), or null if not near the track
export function hitTrack(geo, th, px, py) {
  const { sc, ox, oy } = geo;
  const wx = (px - ox) / sc, wy = (oy - py) / sc;
  const dx = wx - S.PIVOT_X, dy = wy - G.PIVOT_H;
  const s = S.PIVOT_X + dx * Math.cos(th) - dy * Math.sin(th);
  const n = dx * Math.sin(th) + dy * Math.cos(th);
  if (s < -0.03 || s > G.TRACK1 + 0.03 || n < -0.04 || n > 0.12) return null;
  return { s, n };
}

// ---------------------------------------------------------------------------------------------
export function drawThumb(canvas, st, C) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.fillStyle = C.panel2; ctx.fillRect(0, 0, w, h);
  const sc = (w - 16) / 0.46, cx = w / 2, cy = h * 0.58;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(st.th);
  const bx = s => (s - S.PIVOT_X) * sc;
  ctx.fillStyle = C.kraft; ctx.fillRect(bx(-0.004), 0, (S.TRACK_LEN + 0.008) * sc, Math.max(3, 0.012 * sc));
  ctx.fillStyle = C.ball; ctx.fillRect(bx(st.target) - 1, Math.max(3, 0.012 * sc) + 1, 2, 4);
  ctx.fillStyle = '#f2f2ee'; ctx.strokeStyle = C.ink3; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(bx(st.x), -0.02 * sc + 1, 0.02 * sc, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = C.kraft2; ctx.beginPath(); ctx.moveTo(cx - 5, h - 4); ctx.lineTo(cx + 5, h - 4); ctx.lineTo(cx, cy + 4); ctx.closePath(); ctx.fill();
  if (st.hit) { ctx.fillStyle = rgba(C.bad, 0.2); ctx.fillRect(0, 0, w, h); }
}

// ---------------------------------------------------------------------------------------------
// line chart with crosshair tooltip. cfg: { x: {min,max,fmt,label}, y: {min,max,fmt,label}, series: [{key,label,color,area}], refs: [{y,label}] }
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => span / s <= n) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export class LineChart {
  constructor(canvas, tip, cfg) {
    this.c = canvas; this.tip = tip; this.cfg = cfg; this.data = []; this.hover = null;
    canvas.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); this.hover = { px: e.clientX - r.left, py: e.clientY - r.top }; this.draw(); });
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.tip.hidden = true; this.draw(); });
  }
  set(data, cfgPatch) { this.data = data; if (cfgPatch) Object.assign(this.cfg, cfgPatch); this.draw(); }
  draw() {
    const { ctx, w, h } = fitCanvas(this.c), C = colors(), cfg = this.cfg, d = this.data;
    ctx.clearRect(0, 0, w, h);
    const m = { l: 46, r: 18, t: 10, b: 30 };
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    let xmin = cfg.x.min, xmax = cfg.x.max, ymin = cfg.y.min, ymax = cfg.y.max;
    if (d.length) {
      if (xmin === undefined) xmin = d[0].x;
      if (xmax === undefined) xmax = Math.max(d[d.length - 1].x, xmin + 1e-6);
      if (ymax === undefined) { ymax = 0; for (const p of d) for (const s of cfg.series) if (p[s.key] !== undefined && isFinite(p[s.key])) ymax = Math.max(ymax, p[s.key]); for (const r of cfg.refs || []) ymax = Math.max(ymax, r.y); ymax *= 1.1; }
    }
    if (xmin === undefined) { xmin = 0; xmax = 1; } if (ymin === undefined) ymin = 0; if (!ymax || ymax <= ymin) ymax = ymin + 1;
    const X = v => m.l + (v - xmin) / (xmax - xmin) * pw, Y = v => m.t + ph - (v - ymin) / (ymax - ymin) * ph;
    ctx.font = `11px ${C.mono}`; ctx.lineWidth = 1;
    if (!d.length) {
      ctx.strokeStyle = C.axis; ctx.beginPath(); ctx.moveTo(m.l, Math.round(m.t + ph) + 0.5); ctx.lineTo(w - m.r, Math.round(m.t + ph) + 0.5); ctx.stroke();
      ctx.fillStyle = C.ink3; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(cfg.empty || 'No data yet', m.l + pw / 2, m.t + ph / 2);
      return;
    }
    for (const t of niceTicks(ymin, ymax)) {
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(m.l, Math.round(Y(t)) + 0.5); ctx.lineTo(w - m.r, Math.round(Y(t)) + 0.5); ctx.stroke();
      ctx.fillStyle = C.ink3; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(cfg.y.fmt(t), m.l - 8, Y(t));
    }
    ctx.strokeStyle = C.axis; ctx.beginPath(); ctx.moveTo(m.l, Math.round(Y(ymin)) + 0.5); ctx.lineTo(w - m.r, Math.round(Y(ymin)) + 0.5); ctx.stroke();
    for (const t of niceTicks(xmin, xmax, Math.max(2, Math.floor(pw / 90)))) {
      ctx.fillStyle = C.ink3; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(cfg.x.fmt(t), X(t), h - m.b + 8);
    }
    if (cfg.x.label) { ctx.textAlign = 'right'; ctx.fillStyle = C.ink3; ctx.fillText(cfg.x.label, w - m.r, h - 12); }
    for (const r of cfg.refs || []) {
      if (r.y > ymax) continue;
      ctx.strokeStyle = C.ink3; ctx.beginPath(); ctx.moveTo(m.l, Math.round(Y(r.y)) + 0.5); ctx.lineTo(w - m.r, Math.round(Y(r.y)) + 0.5); ctx.stroke();
      ctx.fillStyle = C.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(r.label, w - m.r, Y(r.y) - 3);
    }
    ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t - 4, pw, ph + 8); ctx.clip();
    for (const s of cfg.series) {
      const col = C[s.color] || s.color;
      const pts = d.filter(p => p[s.key] !== undefined && p[s.key] !== null && isFinite(p[s.key]));
      if (!pts.length) continue;
      if (s.area) {
        ctx.fillStyle = rgba(col, 0.1); ctx.beginPath(); ctx.moveTo(X(pts[0].x), Y(ymin));
        for (const p of pts) ctx.lineTo(X(p.x), Y(Math.min(ymax, p[s.key])));
        ctx.lineTo(X(pts[pts.length - 1].x), Y(ymin)); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = col; ctx.lineWidth = s.width || 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => { const yy = Y(Math.max(ymin, Math.min(ymax, p[s.key]))); if (i === 0 || (s.step && false)) ctx.moveTo(X(p.x), yy); else if (s.step) { ctx.lineTo(X(p.x), Y(Math.max(ymin, Math.min(ymax, pts[i - 1][s.key])))); ctx.lineTo(X(p.x), yy); } else ctx.lineTo(X(p.x), yy); });
      ctx.stroke();
      if (s.endDot) {
        const p = pts[pts.length - 1];
        ctx.fillStyle = C.panel; ctx.beginPath(); ctx.arc(X(p.x), Y(Math.min(ymax, p[s.key])), 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(p.x), Y(Math.min(ymax, p[s.key])), 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    if (this.hover && this.hover.px >= m.l && this.hover.px <= w - m.r) {
      const xv = xmin + (this.hover.px - m.l) / pw * (xmax - xmin);
      let best = d[0];
      for (const p of d) if (Math.abs(p.x - xv) < Math.abs(best.x - xv)) best = p;
      ctx.strokeStyle = C.ink3; ctx.beginPath(); ctx.moveTo(Math.round(X(best.x)) + 0.5, m.t); ctx.lineTo(Math.round(X(best.x)) + 0.5, m.t + ph); ctx.stroke();
      const tip = this.tip;
      tip.replaceChildren();
      const head = document.createElement('div'); head.textContent = cfg.x.tipFmt ? cfg.x.tipFmt(best.x) : cfg.x.fmt(best.x); tip.append(head);
      for (const s of cfg.series) {
        if (best[s.key] === undefined || best[s.key] === null) continue;
        const row = document.createElement('div');
        const val = document.createElement('strong'); val.textContent = (cfg.y.tipFmt || cfg.y.fmt)(best[s.key]);
        const key = document.createElement('span'); key.className = 'k-line'; key.style.background = C[s.color] || s.color;
        const lab = document.createElement('span'); lab.textContent = s.label;
        row.append(val, key, lab); tip.append(row);
      }
      tip.hidden = false;
      const tx = Math.min(w - tip.offsetWidth - 4, X(best.x) + 12);
      tip.style.left = `${Math.max(4, tx)}px`; tip.style.top = `${m.t + 4}px`;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// the policy map: tilt chosen for each (position error, velocity)
export const MAP = { E: 0.15, V: 0.4, NX: 72, NY: 48 };
export class PolicyMap {
  constructor(canvas, tip) {
    this.c = canvas; this.tip = tip; this.fn = null; this.img = null; this.trail = []; this.hover = null; this.target = S.X_CENTER;
    this.off = document.createElement('canvas'); this.off.width = MAP.NX; this.off.height = MAP.NY;
    canvas.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); this.hover = { px: e.clientX - r.left, py: e.clientY - r.top }; this.draw(); });
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.tip.hidden = true; this.draw(); });
  }
  // fn(obs) -> u ; evaluated with the other inputs at rest (no recent tilt, no integral)
  setPolicy(fn, target) {
    this.fn = fn; this.target = target ?? this.target;
    const C = colors(), octx = this.off.getContext('2d'), img = octx.createImageData(MAP.NX, MAP.NY);
    const obs = new Float64Array(S.NET_IN);
    for (let j = 0; j < MAP.NY; j++) for (let i = 0; i < MAP.NX; i++) {
      const e = (-1 + 2 * (i + 0.5) / MAP.NX) * MAP.E, v = (1 - 2 * (j + 0.5) / MAP.NY) * MAP.V;
      obs[0] = e / S.E_SCALE; obs[1] = v / S.V_SCALE; obs[2] = 0; obs[3] = 0; obs[4] = 0; obs[5] = (this.target + e - S.X_CENTER) / S.X_SCALE;
      const u = fn(obs), [r, g, b] = diverge(C, 0.85 * u), k = (j * MAP.NX + i) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    this.draw();
  }
  pushLive(e, v) { this.trail.push([e, v]); if (this.trail.length > 60) this.trail.shift(); }
  draw() {
    const { ctx, w, h } = fitCanvas(this.c), C = colors();
    ctx.clearRect(0, 0, w, h);
    const m = { l: 44, r: 10, t: 8, b: 36 }, pw = w - m.l - m.r, ph = h - m.t - m.b;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(this.off, m.l, m.t, pw, ph);
    const X = e => m.l + (e / MAP.E + 1) / 2 * pw, Y = v => m.t + (1 - v / MAP.V) / 2 * ph;
    ctx.strokeStyle = rgba(C.ink, 0.25); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(X(0)) + 0.5, m.t); ctx.lineTo(Math.round(X(0)) + 0.5, m.t + ph); ctx.moveTo(m.l, Math.round(Y(0)) + 0.5); ctx.lineTo(m.l + pw, Math.round(Y(0)) + 0.5); ctx.stroke();
    ctx.font = `11px ${C.mono}`; ctx.fillStyle = C.ink3;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const t of [-10, -5, 0, 5, 10]) ctx.fillText(t === 0 ? '0' : `${t > 0 ? '+' : ''}${t}`, X(t / 100), m.t + ph + 6);
    ctx.textAlign = 'center'; ctx.fillText('ball past target (cm)', m.l + pw / 2, m.t + ph + 20);
    ctx.textBaseline = 'middle';
    for (const t of [-40, -20, 0, 20, 40]) ctx.fillText(`${t}`, m.l - 6, Y(t / 100));
    ctx.save(); ctx.translate(12, m.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('speed (cm/s)', 0, 0); ctx.restore();
    // live trail
    if (this.trail.length) {
      ctx.strokeStyle = rgba(C.ink, 0.55); ctx.lineWidth = 1.5; ctx.beginPath();
      this.trail.forEach(([e, v], i) => { const x = X(Math.max(-MAP.E, Math.min(MAP.E, e))), y = Y(Math.max(-MAP.V, Math.min(MAP.V, v))); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
      const [e, v] = this.trail[this.trail.length - 1];
      const x = X(Math.max(-MAP.E, Math.min(MAP.E, e))), y = Y(Math.max(-MAP.V, Math.min(MAP.V, v)));
      ctx.fillStyle = C.panel; ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    }
    if (this.hover && this.fn && this.hover.px >= m.l && this.hover.px <= m.l + pw && this.hover.py >= m.t && this.hover.py <= m.t + ph) {
      const e = ((this.hover.px - m.l) / pw * 2 - 1) * MAP.E, v = (1 - (this.hover.py - m.t) / ph * 2) * MAP.V;
      const obs = new Float64Array(S.NET_IN);
      obs[0] = e / S.E_SCALE; obs[1] = v / S.V_SCALE; obs[5] = (this.target + e - S.X_CENTER) / S.X_SCALE;
      const u = this.fn(obs), deg = u * S.THETA_MAX_DEG;
      const where = Math.abs(e) < 0.005 ? 'Ball on the target' : `Ball ${(Math.abs(e) * 100).toFixed(1)} cm ${e > 0 ? 'past' : 'short of'} the target`;
      const how = Math.abs(v) < 0.01 ? 'sitting still' : `rolling ${(Math.abs(v) * 100).toFixed(0)} cm/s ${v > 0 ? 'away from' : 'toward'} the sensor`;
      const tip = this.tip; tip.replaceChildren();
      const val = document.createElement('strong'); val.textContent = Math.abs(deg) < 0.2 ? 'Keep level' : `Tilt ${Math.abs(deg).toFixed(1)}° ${deg > 0 ? 'away' : 'toward the sensor'}`;
      const a = document.createElement('div'); a.textContent = `${where}, ${how}.`;
      tip.append(val, a); tip.hidden = false;
      tip.style.left = `${Math.min(w - tip.offsetWidth - 4, this.hover.px + 14)}px`; tip.style.top = `${Math.max(4, this.hover.py - tip.offsetHeight - 10)}px`;
    }
  }
}

// ---------------------------------------------------------------------------------------------
export const INPUT_NAMES = ['miss', 'speed', 'last tilt', 'tilt before', 'patience', 'position'];
export function drawNet(canvas, actor, acts, inputs, C = colors()) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!actor) return;
  const L = actor.layers, sizes = [L[0].inSize, ...L.map(l => l.outSize)];
  const xs = [w * 0.22, w * 0.47, w * 0.7, w * 0.88];
  const pos = sizes.map((n, li) => Array.from({ length: n }, (_, i) => [xs[li], h * (n === 1 ? 0.5 : 0.07 + 0.86 * i / (n - 1))]));
  const vals = [inputs ? Array.from(inputs).map(v => Math.max(-1, Math.min(1, v))) : null, acts ? acts[0] : null, acts ? acts[1] : null, acts ? [acts[2]] : null];
  for (let l = 0; l < L.length; l++) {
    let maxW = 0; for (const x of L[l].W) maxW = Math.max(maxW, Math.abs(x));
    for (let j = 0; j < L[l].outSize; j++) for (let k = 0; k < L[l].inSize; k++) {
      const wt = L[l].W[j * L[l].inSize + k], a = Math.abs(wt) / (maxW || 1);
      if (a < 0.08) continue;
      ctx.strokeStyle = rgba(wt < 0 ? C.neg : C.pos, 0.08 + 0.42 * a); ctx.lineWidth = 0.5 + 1.8 * a;
      ctx.beginPath(); ctx.moveTo(...pos[l][k]); ctx.lineTo(...pos[l + 1][j]); ctx.stroke();
    }
  }
  const r = Math.max(4, Math.min(9, h / 40));
  ctx.font = `11px ${C.mono}`;
  sizes.forEach((n, li) => pos[li].forEach(([x, y], i) => {
    const v = vals[li] ? vals[li][i] : 0, [cr, cg, cb] = diverge(C, v);
    ctx.fillStyle = C.panel; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgb(${cr},${cg},${cb})`; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.line2; ctx.lineWidth = 1; ctx.stroke();
    if (li === 0) { ctx.fillStyle = C.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(INPUT_NAMES[i], x - r - 6, y); }
    if (li === 3) { ctx.fillStyle = C.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('tilt', x + r + 6, y); }
  }));
}

// ---------------------------------------------------------------------------------------------
export function drawEeprom(canvas, brainBytes, C = colors()) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const n = 32, gap = 1.5, cell = (Math.min(w, h) - gap * (n - 1)) / n;
  const [pr, pg, pb] = hexRgb(C.pcb);
  for (let i = 0; i < 1024; i++) {
    const r = Math.floor(i / n), c = i % n;
    if (i < S.EE_BRAIN) ctx.fillStyle = C.kraft;
    else if (brainBytes && i - S.EE_BRAIN < brainBytes.length) {
      const b = brainBytes[i - S.EE_BRAIN], k = 0.55 + 0.45 * (b / 255);
      ctx.fillStyle = `rgb(${Math.round(pr * k)},${Math.round(pg * k)},${Math.round(pb * k)})`;
    } else ctx.fillStyle = C.line;
    ctx.fillRect(c * (cell + gap), r * (cell + gap), cell, cell);
  }
}
