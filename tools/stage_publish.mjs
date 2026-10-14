// Copies everything the published guide needs into one folder with the published layout:
//   index.html (the guide), img/, audio/, viewer.js, model.js, the cut-template PDF, gym/, core/
// usage: node tools/stage_publish.mjs <out dir>   -> prints the files map for publishing
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(process.argv[2]);
fs.rmSync(out, { recursive: true, force: true });
const files = {};
function put(pub, src) {
  const dst = path.join(out, pub);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(ROOT, src), dst);
  if (pub !== 'index.html') files[pub] = pub;
}
put('index.html', 'guide/dist/index.html');
for (const f of fs.readdirSync(path.join(ROOT, 'guide/img'))) if (/\.(png|svg)$/.test(f)) put(`img/${f}`, `guide/img/${f}`);
for (const f of fs.readdirSync(path.join(ROOT, 'guide/audio'))) if (f.endsWith('.mp3')) put(`audio/${f}`, `guide/audio/${f}`);
for (const f of ['viewer.js', 'model.js', 'fulcrum-cut-templates.pdf']) if (fs.existsSync(path.join(ROOT, 'guide', f))) put(f, `guide/${f}`);
for (const f of ['index.html', 'gym.css', 'app.js', 'worker.js', 'draw.js', 'serial.js', 'virtual.js', 'starter_brain.js', 'firmware_hex.js']) put(`gym/${f}`, `gym/${f}`);
for (const f of fs.readdirSync(path.join(ROOT, 'core'))) if (f.endsWith('.js')) put(`core/${f}`, `core/${f}`);
let bytes = 0; for (const p of [...Object.keys(files), 'index.html']) bytes += fs.statSync(path.join(out, p)).size;
fs.writeFileSync(path.join(out, '..', 'files.json'), JSON.stringify(files));
console.log(`${Object.keys(files).length + 1} files, ${(bytes / 1048576).toFixed(1)} MB staged in ${out}`);
