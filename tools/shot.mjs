// Screenshots a page of this project in headless Chrome and reports script errors.
// usage: node tools/shot.mjs <path, e.g. gym/#dream> <out.png> [--width 1400] [--height 900] [--dark]
//        [--wait 1500] [--eval "js to run after load"] [--after 3000] [--full]
// Chrome is shut down through DevTools (Browser.close), which also cleans up its temporary app copy.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.env.SHOT_ROOT ? path.resolve(process.env.SHOT_ROOT) : path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = k => args.includes(`--${k}`);
const target = args[0], out = path.resolve(args[1]);
const width = +opt('width', 1400), height = +opt('height', 900);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const port = 9700 + Math.floor(Math.random() * 200), prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fulcrum-shot-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
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
  else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
};
const send = (method, params) => new Promise(r => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: flag('dark') ? 'dark' : 'light' }] });
await send('Page.navigate', { url: base + target });
await sleep(+opt('wait', 1500));
await ev('document.fonts.ready.then(() => true)');
const code = opt('eval', null);
if (code) { const v = await ev(code); if (v !== undefined) console.log('eval ->', JSON.stringify(v)); }
await sleep(+opt('after', 300));
let clip;
if (flag('full')) {
  const h = await ev('Math.ceil(document.documentElement.scrollHeight)');
  await send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 1, mobile: width < 600 });
  await sleep(400);
  clip = { x: 0, y: 0, width, height: h, scale: 1 };
}
const overflow = await ev('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1');
const r = await send('Page.captureScreenshot', clip ? { format: 'png', clip, captureBeyondViewport: true } : { format: 'png' });
fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
console.log(`saved ${out}${overflow ? '  (WARNING: page scrolls sideways)' : ''}`);
if (errs.length) console.log('ERRORS:\n  ' + errs.join('\n  '));
await quit(0);
