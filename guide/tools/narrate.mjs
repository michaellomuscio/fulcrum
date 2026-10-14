// Voices every step of the guide with Kokoro (af_heart, offline) and records the durations.
// usage: node guide/tools/narrate.mjs [id ...]   (no ids = all)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const items = JSON.parse(fs.readFileSync(path.join(dir, 'narration.json'), 'utf8'));
const only = new Set(process.argv.slice(2));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fulcrum-voice-'));
const durFile = path.join(dir, 'audio', 'durations.json');
const durations = fs.existsSync(durFile) ? JSON.parse(fs.readFileSync(durFile, 'utf8')) : {};
for (const it of items) {
  if (only.size && !only.has(it.id)) continue;
  const txt = path.join(tmp, `${it.id}.txt`), out = path.join(dir, 'audio', `${it.id}.mp3`);
  fs.writeFileSync(txt, it.text);
  const t0 = Date.now();
  execFileSync(path.join(os.homedir(), '.local/bin/kokoro'), ['-f', txt, '-o', out], { stdio: 'pipe' });
  const d = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim();
  durations[it.id] = Math.round(d * 10) / 10;
  console.log(`${it.id.padEnd(12)} ${d.toFixed(1)} s audio in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
fs.writeFileSync(durFile, JSON.stringify(durations, null, 1));
const total = Object.values(durations).reduce((s, x) => s + x, 0);
console.log(`total ${(total / 60).toFixed(1)} minutes`);
fs.rmSync(tmp, { recursive: true, force: true });
