// Assembles the guide: guide.html + guide.css + guide.js + narration timings ->
//   guide/dist/index.html  (the artifact page: no doctype or html/head/body, those are added at publish)
//   guide/index.html       (a full document for opening from this folder, via the Gym's local server)
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
const dur = JSON.parse(read('audio/durations.json'));
// stamp every image with its real size so the page doesn't shift as pictures load
function sizeOf(rel) {
  const f = path.join(dir, rel);
  if (!fs.existsSync(f)) return null;
  if (f.endsWith('.png')) { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; }
  if (f.endsWith('.svg')) { const m = fs.readFileSync(f, 'utf8').match(/viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"/); return m ? [Math.round(+m[1]), Math.round(+m[2])] : null; }
  return null;
}
const sized = html => html.replace(/<img src="(img\/[^"]+)"/g, (all, src) => { const wh = sizeOf(src); return wh ? `<img src="${src}" width="${wh[0]}" height="${wh[1]}"` : all; });
const page = sized(read('guide.html'))
  .replace('/*GUIDE_CSS*/', () => read('guide.css'))
  .replace('/*GUIDE_JS*/', () => `window.FULCRUM_DURATIONS = ${JSON.stringify(dur)};\n` + read('guide.js'));
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dir, 'dist/index.html'), page);
const cut = page.indexOf('<div class="page">');
const local = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${page.slice(0, cut)}\n</head>\n<body>\n${page.slice(cut).replaceAll('href="gym/index.html"', 'href="../gym/index.html"')}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(dir, 'index.html'), local);
console.log(`guide: ${(page.length / 1024).toFixed(0)} KB page, ${Object.keys(dur).length} narrated steps, ${(Object.values(dur).reduce((a, b) => a + b, 0) / 60).toFixed(1)} min`);
