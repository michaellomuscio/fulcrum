// Scripts a whole Gym session in headless Chrome (training, exam, and the virtual robot) and saves
// panel screenshots for the guide into guide/img/gym-*.png. usage: node tools/capture_gym.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'guide/img');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const port = 9500 + Math.floor(Math.random() * 150), prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fulcrum-cap-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function closeChrome() {
  if (chrome.exitCode !== null) return;
  const exited = new Promise(r => chrome.once('exit', r));
  const force = setTimeout(() => { try { chrome.kill('SIGKILL'); } catch (e) { } }, 5000);
  try { const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); const w = new WebSocket(webSocketDebuggerUrl); await new Promise((a, b) => { w.onopen = a; w.onerror = b; }); w.send(JSON.stringify({ id: 1, method: 'Browser.close' })); } catch (e) { }
  await exited; clearTimeout(force);
}
let list; for (let i = 0; i < 80 && !list; i++) { await sleep(150); try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch (e) { } }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => { ws.onopen = r; });
let n = 0; const pend = new Map(); const errs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
const send = (method, params) => new Promise(r => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

// capture the union of some elements' boxes (page coordinates), with a margin
async function shoot(name, selectors, pad = 10) {
  const box = await ev(`(() => { const rs = ${JSON.stringify(selectors)}.map(s => document.querySelector(s).getBoundingClientRect());
    const x0 = Math.min(...rs.map(r => r.left)), y0 = Math.min(...rs.map(r => r.top)), x1 = Math.max(...rs.map(r => r.right)), y1 = Math.max(...rs.map(r => r.bottom));
    return { x: x0 + scrollX, y: y0 + scrollY, w: x1 - x0, h: y1 - y0 }; })()`);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.w + 2 * pad, height: box.h + 2 * pad, scale: 1 } });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'));
  console.log('saved', name, `${Math.round(box.w)}x${Math.round(box.h)}`);
}
const click = sel => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const text = sel => ev(`document.querySelector(${JSON.stringify(sel)}).textContent`);

await send('Page.navigate', { url: base + 'gym/#dream' });
await sleep(2500); await ev('document.fonts.ready.then(() => true)');
await click('#btn-train');
await sleep(22000);
await shoot('gym-dream', ['.top', '.dream-grid .col-main .stage-card', '.dream-grid .col-side .train-card'], 0);
await shoot('gym-train', ['#curve', '#policy'], 26);
await click('#btn-train');
console.log('trained:', await text('#st-practice'), await text('#st-err'));

await click('[data-view=exam]'); await click('#pick-best'); await click('#btn-exam');
await sleep(12000);
await shoot('gym-exam', ['.exam-body'], 4);
console.log('exam:', await text('#ex-pass'), await text('#ex-err'));

await click('[data-view=robot]');
await click('#btn-virtual'); await sleep(1500);
await click('#btn-flash'); await sleep(9000);
await ev('scrollTo(0, 0)');
await shoot('gym-firmware', ['.top', '#robot-grid .col-side article:nth-child(1)', '#robot-grid .col-side article:nth-child(2)', '#robot-grid .col-main .stage-card'], 0);
await sleep(2500);
await shoot('gym-checks', ['#robot-grid .col-side article:nth-child(3)'], 6);
await click('#btn-cal'); await sleep(52000);
await shoot('gym-calibrate', ['#robot-grid .col-side article:nth-child(4)'], 6);
console.log('cal:', await text('#cal-status'));
await click('#btn-upload'); await sleep(4000);
await click('[data-mode="1"]'); await sleep(7000);
await shoot('gym-send', ['#robot-grid .col-side article:nth-child(5)', '#robot-grid .col-main .stage-card'], 6);
await click('#btn-step'); await sleep(26500);
await shoot('gym-dreamreal', ['#robot-grid .col-main article:nth-child(3)'], 6);
console.log('step:', await text('#step-status'));
if (errs.length) console.log('ERRORS:', errs);
await closeChrome(); fs.rmSync(prof, { recursive: true, force: true }); server.close();
