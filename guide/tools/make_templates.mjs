// Writes guide/templates.html (printable cut templates at true 1:1 scale on US Letter) and prints it
// to "guide/fulcrum-cut-templates.pdf" with headless Chrome. Every drawing is an SVG whose user unit
// is one millimeter, sized in mm, so the printed parts measure exactly what they say.
// usage: node guide/tools/make_templates.mjs [--no-pdf]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GUIDE = path.resolve(HERE, '..');
const INK = '#11161c', SOFT = '#47515d', BLUE = '#1f5fbf', KRAFT = '#f3e7d4';
const f = v => +v.toFixed(2);

// ------------------------------------------------------------------ drawing helpers (units: mm)
function arrow(x, y, ang) {
  const s = 1.8, a = 0.42;
  return `<polygon points="${f(x)},${f(y)} ${f(x - s * Math.cos(ang - a))},${f(y - s * Math.sin(ang - a))} ${f(x - s * Math.cos(ang + a))},${f(y - s * Math.sin(ang + a))}" fill="${SOFT}"/>`;
}
function dimH(x1, x2, y, label, side = 1) {           // horizontal dimension; side -1 puts the text above
  const ty = y + (side > 0 ? 4.2 : -1.6);
  return `<g><line x1="${f(x1)}" y1="${f(y)}" x2="${f(x2)}" y2="${f(y)}" stroke="${SOFT}" stroke-width="0.25"/>${arrow(x1, y, Math.PI)}${arrow(x2, y, 0)}
<text x="${f((x1 + x2) / 2)}" y="${f(ty)}" text-anchor="middle" class="dim">${label}</text></g>`;
}
function dimV(y1, y2, x, label, side = -1) {          // vertical dimension; side -1 puts the text on the left
  const cx = x + (side < 0 ? -1.8 : 4.4), cy = (y1 + y2) / 2;
  return `<g><line x1="${f(x)}" y1="${f(y1)}" x2="${f(x)}" y2="${f(y2)}" stroke="${SOFT}" stroke-width="0.25"/>${arrow(x, y1, -Math.PI / 2)}${arrow(x, y2, Math.PI / 2)}
<text x="${f(cx)}" y="${f(cy)}" text-anchor="middle" class="dim" transform="rotate(-90 ${f(cx)} ${f(cy)})">${label}</text></g>`;
}
const ext = (x1, y1, x2, y2) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${SOFT}" stroke-width="0.18" stroke-dasharray="1 0.8"/>`;
const outline = pts => `<polygon points="${pts.map(p => p.map(f).join(',')).join(' ')}" fill="${KRAFT}" stroke="${INK}" stroke-width="0.45" stroke-linejoin="round"/>`;
function cross(x, y, r = 1.5, color = INK) {
  return `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="none" stroke="${color}" stroke-width="0.35"/><line x1="${f(x - r - 1.5)}" y1="${f(y)}" x2="${f(x + r + 1.5)}" y2="${f(y)}" stroke="${color}" stroke-width="0.25"/><line x1="${f(x)}" y1="${f(y - r - 1.5)}" x2="${f(x)}" y2="${f(y + r + 1.5)}" stroke="${color}" stroke-width="0.25"/>`;
}
function flutes(x, y, len, vertical, label) {
  const x2 = vertical ? x : x + len, y2 = vertical ? y + len : y;
  const ang = Math.atan2(y2 - y, x2 - x);
  const tx = vertical ? x + 2.2 : (x + x2) / 2, ty = vertical ? (y + y2) / 2 : y - 1.8;
  return `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${BLUE}" stroke-width="0.4"/>
<polygon points="${f(x2)},${f(y2)} ${f(x2 - 2.2 * Math.cos(ang - 0.4))},${f(y2 - 2.2 * Math.sin(ang - 0.4))} ${f(x2 - 2.2 * Math.cos(ang + 0.4))},${f(y2 - 2.2 * Math.sin(ang + 0.4))}" fill="${BLUE}"/>
<polygon points="${f(x)},${f(y)} ${f(x + 2.2 * Math.cos(ang - 0.4))},${f(y + 2.2 * Math.sin(ang - 0.4))} ${f(x + 2.2 * Math.cos(ang + 0.4))},${f(y + 2.2 * Math.sin(ang + 0.4))}" fill="${BLUE}"/>
<text x="${f(tx)}" y="${f(ty)}" class="note blue"${vertical ? ` transform="rotate(-90 ${f(tx)} ${f(ty)})" text-anchor="middle"` : ' text-anchor="middle"'}>${label}</text>`;
}
const text = (x, y, s, cls = 'note', anchor = 'start') => `<text x="${f(x)}" y="${f(y)}" class="${cls}" text-anchor="${anchor}">${s}</text>`;

// a part drawing: content drawn in part coordinates (0..w, 0..h) with padding around for labels
function part({ w, h, padL = 12, padR = 12, padT = 12, padB = 12, body }) {
  const W = w + padL + padR, H = h + padT + padB;
  return `<svg class="part" width="${f(W)}mm" height="${f(H)}mm" viewBox="${f(-padL)} ${f(-padT)} ${f(W)} ${f(H)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

// ------------------------------------------------------------------ the parts
// sizes are whole eighths of an inch, converted to the drawing's millimeters
const IN = 25.4;
const inch = v => v * IN;

function saddle({ hole = false, straw = false, dims = false } = {}) {
  const w = inch(2.75), h = inch(1.75), c = w / 2;     // a 90° notch is half as deep as the saddle is wide
  let b = outline([[0, 0], [c, c], [w, 0], [w, h], [0, h]]);
  if (!hole) b += text(c, h - 3.8, 'bottom edge', 'note soft', 'middle');
  if (hole) { b += cross(c, h - inch(0.25), 1.2, BLUE) + text(c + 5.5, h - 7.6, 'push-rod hole, ¼ in up', 'note blue') + text(c + 5.5, h - 4.2, '(saddle at 11⅜ in)', 'note blue'); }
  if (straw) { const sl = w * 0.72; b += `<rect x="${f(c - sl / 2)}" y="${f(h + 0.3)}" width="${f(sl)}" height="5.2" rx="2.6" fill="none" stroke="${BLUE}" stroke-width="0.35" stroke-dasharray="1.6 1"/>` + text(c, h + 9.5, 'straw glued along here (saddle at 8⅝ in)', 'note blue', 'middle'); }
  if (dims) { b += dimH(0, w, -5, '2¾ in', -1) + dimV(0, h, -5, '1¾ in') + ext(c, c, w + 6, c) + dimV(0, c, w + 6, '1⅜ in', 1); }
  return part({ w, h, padL: dims ? 11 : 4, padR: dims ? 12 : 4, padT: dims ? 10 : 4, padB: straw ? 12 : 4, body: b });
}

function tower({ dims = false } = {}) {
  const w = inch(2.75), h = inch(5.5), hy = inch(0.625);
  let b = outline([[0, 0], [w, 0], [w, h], [0, h]]);
  b += cross(w / 2, hy, 1.5) + text(w / 2, hy + 7.6, 'skewer hole', 'note', 'middle');
  b += flutes(12, 40, h - 70, true, 'ridges run up and down');
  b += text(w / 2, h - 7, 'bottom (glued to the base)', 'note soft', 'middle');
  if (dims) b += dimH(0, w, -5, '2¾ in', -1) + dimV(0, h, -5, '5½ in') + ext(w / 2, hy, w + 6, hy) + dimV(0, hy, w + 6, '⅝ in', 1);
  return part({ w, h, padL: dims ? 11 : 4, padR: dims ? 12 : 4, padT: dims ? 10 : 4, padB: 4, body: b });
}

// both tower braces come from one 2 x 3 1/2 inch rectangle cut corner to corner
function braces() {
  const w = inch(2), h = inch(3.5);
  let b = outline([[0, 0], [w, 0], [w, h], [0, h]]);
  b += `<line x1="0" y1="0" x2="${f(w)}" y2="${f(h)}" stroke="${INK}" stroke-width="0.45"/>`;
  b += `<text x="3.4" y="${f(h * 0.69)}" class="note soft" text-anchor="middle" transform="rotate(-90 3.4 ${f(h * 0.69)})">A: glue this edge to a tower</text>`;
  b += text(w * 0.34, h - 2.8, 'A: on the base', 'note soft', 'middle');
  b += `<text x="${f(w - 3.4)}" y="${f(h / 3)}" class="note soft" text-anchor="middle" transform="rotate(90 ${f(w - 3.4)} ${f(h / 3)})">B: glue this edge to the other tower</text>`;
  b += text(w * 0.68, 4.6, 'B: on the base', 'note soft', 'middle');
  const ang = Math.atan2(h, w) * 180 / Math.PI;
  b += `<text x="${f(w / 2)}" y="${f(h / 2)}" class="note blue" text-anchor="middle" transform="rotate(${f(ang)} ${f(w / 2)} ${f(h / 2)}) translate(0 -2.2)">cut along this diagonal</text>`;
  b += dimH(0, w, -5, '2 in', -1) + dimV(0, h, w + 5, '3½ in', 1);
  return part({ w, h, padL: 4, padR: 12, padT: 10, padB: 4, body: b });
}

function sonarPlate() {
  const w = inch(2.75), h = inch(3.5);
  const hz = h - 44;    // hole centers about 1¾ in above the bottom edge (nominal; the ball sets the real height)
  const dx = inch(0.5), r = inch(0.625) / 2;
  let b = outline([[0, 0], [w, 0], [w, h], [0, h]]);
  for (const x of [w / 2 - dx, w / 2 + dx]) b += `<circle cx="${f(x)}" cy="${f(hz)}" r="${f(r)}" fill="none" stroke="${BLUE}" stroke-width="0.4" stroke-dasharray="1.6 1"/>`;
  b += cross(w / 2, hz, 0.6, BLUE);
  b += text(w / 2, hz + 18, 'mark the ball’s center here,', 'note blue', 'middle') + text(w / 2, hz + 22, 'then cut two ⅝ in holes', 'note blue', 'middle') + text(w / 2, hz + 26, '½ in left and right of it', 'note blue', 'middle');
  b += text(w / 2, h - 4, 'bottom edge (⅜ in below the fold)', 'note soft', 'middle');
  b += dimH(0, w, -5, '2¾ in', -1) + dimV(0, h, -5, '3½ in') + dimH(w / 2 - dx, w / 2 + dx, hz - 12, '1 in', -1);
  return part({ w, h, padL: 11, padR: 4, padT: 10, padB: 4, body: b });
}

function farWall() {
  const w = inch(2.75), h = inch(2.375);
  let b = outline([[0, 0], [w, 0], [w, h], [0, h]]);
  b += text(w / 2, h / 2 + 2, 'far wall', 'note soft', 'middle');
  b += dimH(0, w, -5, '2¾ in', -1) + dimV(0, h, w + 5, '2⅜ in', 1);
  return part({ w, h, padL: 4, padR: 12, padT: 10, padB: 4, body: b });
}

function servoPost() {
  // servo body footprint: 22 x 12 mm, shaft 18 mm from the left edge and 46 mm above the bottom
  const w = inch(2.375), h = inch(3.125);
  let b = outline([[0, 0], [w, 0], [w, h], [0, h]]);
  const sx = 18, sy = h - 46;
  b += `<rect x="${12}" y="${f(sy - 6)}" width="22" height="12" fill="none" stroke="${BLUE}" stroke-width="0.35" stroke-dasharray="1.6 1"/>`;
  b += cross(sx, sy, 0.6, BLUE) + text(23, sy - 8, 'servo goes here, shaft at the +', 'note blue', 'middle');
  b += text(w / 2, h - 5, 'bottom (glued to the base)', 'note soft', 'middle');
  b += dimH(0, w, -5, '2⅜ in', -1) + dimV(0, h, -5, '3⅛ in');
  return part({ w, h, padL: 11, padR: 4, padT: 10, padB: 4, body: b });
}

function postBrace() {
  const w = inch(1.625), h = inch(2.375);
  let b = outline([[0, 0], [0, h], [w, h]]);
  b += `<text x="3.4" y="${f(h * 0.53)}" class="note soft" text-anchor="middle" transform="rotate(-90 3.4 ${f(h * 0.53)})">glue to the post</text>`;
  b += text(w / 2, h - 2.8, 'on the base', 'note soft', 'middle');
  b += dimH(0, w, h + 5, '1⅝ in', 1) + dimV(0, h, -5, '2⅜ in');
  return part({ w, h, padL: 11, padR: 4, padT: 4, padB: 11, body: b });
}

// a 2 inch bar with eighth-inch ticks, longer at each half inch and inch
const scaleBar = `<div class="scalebox"><svg class="scale" width="${f(inch(2) + 4)}mm" height="12mm" viewBox="-2 -5 ${f(inch(2) + 4)} 12" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="0" width="${f(inch(2))}" height="3.2" fill="${INK}"/>${Array.from({ length: 17 }, (_, k) => { const x = f(k * IN / 8), long = k % 4 === 0 ? (k % 8 === 0 ? 4.4 : 3.2) : 1.4; return `<line x1="${x}" y1="${k % 8 === 0 ? -1.2 : 3.2}" x2="${x}" y2="${f(3.2 + long)}" stroke="${INK}" stroke-width="0.3"/>`; }).join('')}
${[0, 1, 2].map(k => `<text x="${f(k * IN)}" y="-2" text-anchor="middle" font-size="2.4" fill="${INK}">${k}</text>`).join('')}</svg>
<p>This bar is 2 inches. Measure it; if it isn’t, reprint at 100%.</p></div>`;

function page(title, sub, inner) {
  return `<section class="page"><header><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${scaleBar}</header>${inner}</section>`;
}
const fig = (label, svg, cls = '') => `<figure class="${cls}"><figcaption>${label}</figcaption>${svg}</figure>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fulcrum Cut Templates</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<style>
  @page { size: letter; margin: 0.5in; }
  :root { --ink: ${INK}; --soft: ${SOFT}; --blue: ${BLUE}; --paper: #ffffff; --desk: #d9dee4; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--desk); color: var(--ink); font-family: "Atkinson Hyperlegible", system-ui, sans-serif; }
  body { padding: 24px 16px; }
  .page { width: 190.5mm; height: 254mm; margin: 0 auto 24px; background: var(--paper); position: relative; overflow: hidden;
    box-shadow: 0 0 0 8mm var(--paper), 0 2px 18px 8mm rgba(0,0,0,0.12); display: flex; flex-direction: column; gap: 5mm; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; border-bottom: 0.3mm solid #c3cbd5; padding-bottom: 3mm; }
  h1 { margin: 0; font: 800 7mm/1.1 "Archivo", system-ui, sans-serif; font-stretch: 112%; letter-spacing: 0.02em; }
  header p { margin: 1.5mm 0 0; font-size: 3.4mm; line-height: 1.4; color: var(--soft); max-width: 112mm; }
  .grid { display: flex; flex-wrap: wrap; gap: 4mm 6mm; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { font: 700 3.6mm/1.2 "Atkinson Hyperlegible", sans-serif; margin: 0 0 1mm 1mm; }
  figcaption span { font-weight: 400; color: var(--soft); }
  svg text { font-family: "Atkinson Hyperlegible", sans-serif; }
  svg .dim { font-size: 3.2px; font-weight: 700; fill: ${INK}; }
  svg .note { font-size: 2.6px; fill: ${INK}; }
  svg .note.soft { fill: ${SOFT}; }
  svg .note.blue { fill: ${BLUE}; }
  .big { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; font-size: 3.4mm; line-height: 1.45; }
  .big .card { border: 0.3mm solid #c3cbd5; border-radius: 2mm; padding: 3mm 4mm; }
  .big b { display: block; font-size: 4mm; margin-bottom: 1mm; }
  .sketch { display: block; margin-top: 2mm; }
  .scalebox { flex: none; width: 56mm; }
  .scalebox p { margin: 1mm 0 0; font-size: 2.9mm; line-height: 1.3; color: var(--soft); }
  .tips { font-size: 3.3mm; line-height: 1.5; color: var(--soft); margin: 0; padding-left: 5mm; }
  @media print {
    html, body { background: #fff; padding: 0; }
    .page { margin: 0; box-shadow: none; page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: auto; break-after: auto; }
  }
</style>
</head>
<body>
${page('Fulcrum cut templates', 'Print at 100% (“Actual size”, not “Fit to page”). Trace each piece onto corrugated cardboard, or glue the paper on, and cut with a sharp blade against a ruler: a few light passes, not one hard one.',
`<div class="big">
  <div class="card"><b>Base · 20½ × 6¼ in · cut 1</b>Too big for paper: measure and cut it directly. Any corrugation direction.
  <svg class="sketch" width="78mm" height="26mm" viewBox="0 0 78 26"><rect x="2" y="2" width="74" height="22.8" fill="${KRAFT}" stroke="${INK}" stroke-width="0.45"/><text x="39" y="15" class="note" text-anchor="middle" font-size="3.2">20½ × 6¼ in (not to scale)</text></svg></div>
  <div class="card"><b>Track · 17¼ × 2¾ in · cut 1</b>Measure and cut directly. The ridges inside the cardboard must run along the 17¼ in length.
  <svg class="sketch" width="78mm" height="26mm" viewBox="0 0 78 26"><rect x="2" y="8" width="74" height="11.8" fill="${KRAFT}" stroke="${INK}" stroke-width="0.45"/><line x1="2" y1="13.9" x2="76" y2="13.9" stroke="${BLUE}" stroke-width="0.35" stroke-dasharray="1.6 1"/><text x="39" y="6" class="note" text-anchor="middle" font-size="2.8">ridges run this way →, score down the middle (dashed)</text><text x="39" y="24.4" class="note" text-anchor="middle" font-size="2.8">17¼ × 2¾ in (not to scale)</text></svg></div>
</div>
<div class="grid">
  ${fig('Saddle <span>· cut 4 · each notch hugs the V</span>', saddle({ dims: true }))}
  ${fig('&nbsp;', saddle({ straw: true }))}
  ${fig('&nbsp;', saddle({ hole: true }))}
  ${fig('&nbsp;', saddle())}
</div>
<ul class="tips"><li>Saddles go under the track at 2, 8⅝, 11⅜ and 15⅜ in from the sonar end.</li><li>The one at 8⅝ in carries the straw; the one at 11⅜ in gets the push-rod hole.</li></ul>`)}
${page('Towers and braces', 'Ridges run up and down in the towers. Poke the skewer holes with the skewer itself so they fit snugly.',
`<div class="grid">
  ${fig('Tower <span>· trace it twice, cut 2</span>', tower({ dims: true }))}
  ${fig('Tower braces <span>· cut this 2 × 3½ in<br>rectangle corner to corner</span>', braces())}
</div>`)}
${page('End plates and servo post', 'The sonar plate closes the sonar end of the track; the far wall closes the other end.',
`<div class="grid">
  ${fig('Sonar plate <span>· cut 1</span>', sonarPlate())}
  ${fig('Far wall <span>· cut 1</span>', farWall())}
  ${fig('Servo post <span>· cut 1</span>', servoPost())}
  ${fig('Post brace <span>· cut 1 · right triangle, 1⅝ × 2⅜ in</span>', postBrace())}
</div>`)}
</body>
</html>
`;
fs.writeFileSync(path.join(GUIDE, 'templates.html'), html);
console.log('wrote guide/templates.html');
if (process.argv.includes('--no-pdf')) process.exit(0);

// ------------------------------------------------------------------ print to PDF with headless Chrome
const server = http.createServer((req, res) => {
  const p = path.join(GUIDE, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(GUIDE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const port = 9300 + Math.floor(Math.random() * 200), prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fulcrum-pdf-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let list;
for (let i = 0; i < 80 && !list; i++) { await sleep(150); try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch (e) { } }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let n = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } };
const send = (method, params) => new Promise(r => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/templates.html` });
await sleep(1500);
await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
const pdf = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
fs.writeFileSync(path.join(GUIDE, 'fulcrum-cut-templates.pdf'), Buffer.from(pdf.data, 'base64'));
console.log('wrote guide/fulcrum-cut-templates.pdf');
const exited = new Promise(r => chrome.once('exit', r));
const force = setTimeout(() => { try { chrome.kill('SIGKILL'); } catch (e) { } }, 5000);
try {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const w = new WebSocket(webSocketDebuggerUrl);
  await new Promise((res, rej) => { w.onopen = res; w.onerror = rej; });
  w.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
} catch (e) { }
await exited; clearTimeout(force);
fs.rmSync(prof, { recursive: true, force: true });
server.close();
