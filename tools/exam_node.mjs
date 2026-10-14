// Grade saved brains across many randomized worlds, in full precision and as packed for the robot.
// usage: node tools/exam_node.mjs tools/out/actor_seed1.json [more.json ...]
import fs from 'node:fs';
import { evaluate, fmtEval } from '../core/evaluate.js';
import { pidAction } from '../core/world.js';
import { packBrain, unpackBrain, brainPolicy } from '../core/brain.js';

export function floatPolicy(actor) {
  return obs => {
    let x = Array.from(obs);
    actor.layers.forEach((L, l) => {
      const out = new Array(L.outSize);
      for (let j = 0; j < L.outSize; j++) {
        let s = L.b[j];
        for (let k = 0; k < L.inSize; k++) s += L.W[j * L.inSize + k] * x[k];
        out[j] = l < actor.layers.length - 1 ? Math.tanh(s) : s;
      }
      x = out;
    });
    return Math.max(-1, Math.min(1, x[0]));
  };
}

const opts = { episodes: 32, seed: 777 };
console.log('PID           ', fmtEval(evaluate(obs => pidAction(obs), opts)));
for (const f of process.argv.slice(2)) {
  const actor = JSON.parse(fs.readFileSync(f, 'utf8'));
  const packed = packBrain(actor, { name: 'exam' });
  const brain = unpackBrain(packed);
  console.log(f, `(${packed.length} bytes, crc ok ${brain.crcOk})`);
  console.log('  float       ', fmtEval(evaluate(floatPolicy(actor), opts)));
  const q = evaluate(brainPolicy(brain), opts);
  console.log('  int8 packed ', fmtEval(q));
  const worst = q.perWorld.slice().sort((a, b) => b.settled - a.settled).slice(0, 4);
  console.log('  hardest worlds:', worst.map(w => `${(w.settled * 100).toFixed(1)}cm k=${w.k.toFixed(2)} lvl=${(w.level * 180 / Math.PI).toFixed(1)}°`).join(' | '));
}
