// Headless training run: proves the learner converges and reports exam scores as it goes.
// usage: node tools/train_node.mjs [iterations] [seed] [key=value ...]
import { PPO } from '../core/ppo.js';
import { evaluate, fmtEval } from '../core/evaluate.js';
import { pidAction } from '../core/world.js';
import fs from 'node:fs';

const iters = +(process.argv[2] || 120);
const tag = process.env.TAG || '';
const seed = +(process.argv[3] || 1);
const extra = Object.fromEntries(process.argv.slice(4).map(kv => { const [k, v] = kv.split('='); return [k, isNaN(+v) ? v : +v]; }));

console.log('PID baseline (default gains):', fmtEval(evaluate(obs => pidAction(obs), { episodes: 16 })));
console.log('Do-nothing baseline:        ', fmtEval(evaluate(() => 0, { episodes: 16 })));

const ppo = new PPO({ seed, ...extra });
console.log('options', JSON.stringify(ppo.o));
const t0 = Date.now();
let best = null;
for (let i = 1; i <= iters; i++) {
  const s = ppo.iterate();
  if (i % 5 === 0 || i === 1) {
    console.log(`it ${String(i).padStart(4)} | steps ${(s.steps / 1e6).toFixed(2)}M | ret ${s.epReturn.toFixed(1)} | err ${(s.epErr * 100).toFixed(2)} cm | hits ${s.epHits.toFixed(2)} | std ${s.std.toFixed(3)} | kl ${s.kl.toFixed(4)} | clip ${s.clipFrac.toFixed(3)} | vloss ${s.vLoss.toFixed(4)} | ${s.msCollect.toFixed(0)}+${s.msUpdate.toFixed(0)} ms | ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  if (i % 20 === 0 || i === iters) {
    const ev = evaluate(ppo.policyFn(), { episodes: 16 });
    console.log('   EXAM', fmtEval(ev));
    if (!best || ev.rewardPerStep > best.ev.rewardPerStep) best = { i, ev, actor: ppo.exportActor() };
  }
}
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`./out/actor_seed${seed}${tag ? '_' + tag : ''}.json`, import.meta.url), JSON.stringify(ppo.exportActor()));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s; best exam at it ${best.i}:`, fmtEval(best.ev));
