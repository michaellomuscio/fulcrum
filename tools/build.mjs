// Regenerates spec.h, compiles the firmware for an Arduino Uno, and embeds the result in the Gym
// so its "Install firmware" button needs nothing else. usage: node tools/build.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url).pathname;
execFileSync('node', [`${root}tools/gen_spec.mjs`], { stdio: 'inherit' });
const out = execFileSync('arduino-cli', ['compile', '--fqbn', 'arduino:avr:uno', '--output-dir', `${root}firmware/build`, `${root}firmware/Fulcrum`]).toString();
console.log(out.trim().split('\n').slice(-2).join('\n'));
const hex = fs.readFileSync(`${root}firmware/build/Fulcrum.ino.hex`, 'utf8');
fs.writeFileSync(`${root}gym/firmware_hex.js`,
  `// Fulcrum firmware for the Arduino Uno, compiled by tools/build.mjs (Intel HEX).\nexport const FIRMWARE_HEX = ${JSON.stringify(hex)};\n`);
console.log(`embedded ${hex.length} characters of firmware in gym/firmware_hex.js`);
