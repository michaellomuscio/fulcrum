// Bakes a trained brain into the firmware as the "starter" brain (copied to EEPROM on first boot)
// and into the Gym. usage: node tools/make_factory_brain.mjs tools/out/actor_xxx.json [name]
import fs from 'node:fs';
import { packBrain, brainToCHeader, unpackBrain, brainPolicy } from '../core/brain.js';
import { evaluate, fmtEval } from '../core/evaluate.js';

const src = process.argv[2];
const name = process.argv[3] || 'starter';
const actor = JSON.parse(fs.readFileSync(src, 'utf8'));
const exam = evaluate(brainPolicy(unpackBrain(packBrain(actor, { name }))), { episodes: 32, seed: 2026 });
const u8 = packBrain(actor, { name, score: exam.rewardPerStep });
fs.writeFileSync(new URL('../firmware/Fulcrum/factory_brain.h', import.meta.url), brainToCHeader(u8, name));
fs.writeFileSync(new URL('../gym/starter_brain.js', import.meta.url),
  `// The starter brain that ships inside the firmware (trained by Claude with the same Gym code).\n` +
  `export const STARTER_ACTOR = ${JSON.stringify(actor)};\n` +
  `export const STARTER_EXAM = ${JSON.stringify({ settledErr: exam.settledErr, meanErr: exam.meanErr, hitsPerMin: exam.hitsPerMin, rewardPerStep: exam.rewardPerStep, passRate: exam.passRate })};\n`);
console.log(`${name}: ${u8.length} bytes |`, fmtEval(exam));
