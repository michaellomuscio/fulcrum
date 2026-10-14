// Renders the guide's build-step illustrations (guide/img/*.png) in headless Chrome.
// usage: node guide/tools/render_steps.mjs [stepId ...] [--braces outer]
// Chrome is closed through DevTools (Browser.close), which also removes its temporary app copy.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(HERE, '../img');
const args = process.argv.slice(2);
const bracesArg = args.includes('--braces') ? args[args.indexOf('--braces') + 1] : 'inner';
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--braces');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const port = 9500 + Math.floor(Math.random() * 200), prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fulcrum-render-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1700,1100', 'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function closeChrome() {
  if (chrome.exitCode !== null) return;
  const exited = new Promise(r => chrome.once('exit', r));
  const force = setTimeout(() => { try { chrome.kill('SIGKILL'); } catch (e) { } }, 5000);
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const w = new WebSocket(webSocketDebuggerUrl);
    await new Promise((res, rej) => { w.onopen = res; w.onerror = rej; });
    w.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  } catch (e) { }
  await exited; clearTimeout(force);
}
const quit = async code => { await closeChrome(); fs.rmSync(prof, { recursive: true, force: true }); server.close(); process.exit(code); };
process.on('uncaughtException', e => { console.error(e); quit(1); });

let list;
for (let i = 0; i < 80 && !list; i++) { await sleep(150); try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch (e) { } }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let n = 0; const pend = new Map(); const errs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errs.push(`console.${m.params.type}: ${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
};
const send = (method, params) => new Promise(r => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `${base}guide/tools/render.html?braces=${bracesArg}` });
for (let i = 0; i < 100; i++) { await sleep(200); try { if (await ev('window.rendererReady === true')) break; } catch (e) { } }
if (errs.length) { console.log('page errors:\n  ' + errs.join('\n  ')); }
if (!(await ev('window.rendererReady === true'))) { console.error('renderer did not start'); await quit(1); }

fs.mkdirSync(OUT, { recursive: true });
const jobs = [
  ...(await ev('window.STEP_LIST')).filter(s => s.id !== 'hero').map(s => ({ id: s.id, file: s.file, opts: {} })),
  { id: 'hero', file: 'hero.png', opts: { w: 1600, h: 1000, fov: 26, dir: [-0.42, -1.0, 0.42], fill: 0.9 } },
  { id: 'hero', file: 'hero-wide.png', opts: { w: 2000, h: 900, fov: 22, dir: [-0.36, -1.0, 0.32], fill: 0.86 } },
];
for (const j of jobs) {
  if (only.length && !only.includes(j.id) && !only.includes(j.file)) continue;
  const t0 = Date.now();
  const url = await ev(`window.renderStep(${JSON.stringify(j.id)}, ${JSON.stringify(j.opts)})`);
  fs.writeFileSync(path.join(OUT, j.file), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`${j.file}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
if (errs.length) console.log('ERRORS:\n  ' + errs.join('\n  '));
await quit(0);
