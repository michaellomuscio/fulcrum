// Fulcrum's breadboard wiring, drawn from one netlist: a picture per build step (new work at full
// strength, earlier steps faded) plus the whole thing. Follows BUILD_SPEC.md; the Arduino pins are
// checked against core/spec.js so the pictures can't drift from the firmware.
// usage: node guide/tools/wiring.mjs   -> guide/img/wire-1.svg ... wire-8.svg, wire-all.svg
import fs from 'node:fs';
import * as S from '../../core/spec.js';

const OUT = new URL('../img/', import.meta.url);
const FONT = `'IBM Plex Mono', ui-monospace, Menlo, monospace`;
const P = 12;                 // one breadboard pitch (0.1 in) in drawing units
const IN = 10 * P;            // one inch
const W = 1060, H = 1040;     // canvas
const FADE = 0.32;

// ---------------------------------------------------------------- colors
const C = {
  bench: '#e9ecef', benchLine: '#dde1e6', ink: '#1d232b', ink2: '#4b5563', ink3: '#7a8491',
  board: '#f7f7f2', boardEdge: '#d4d3ca', groove: '#e7e6de', hole: '#3d4249',
  red: '#d6312b', blue: '#2a63c9', pcb: '#1b5fb4', pcbDark: '#134a8e', pcbInk: '#e9f1ff',
  pill: '#ffffff', pillEdge: '#c9ced6',
};
const WIRE = {
  red: '#d9342b', black: '#24272b', brown: '#7a4a24', orange: '#f08a12', green: '#2f9e44', blue: '#1f6fd1',
  yellow: '#e9b400', white: '#f7f7f4', purple: '#8346c9', gray: '#8d939b',
};
const darker = (hex, k = 0.38) => {
  const n = parseInt(hex.slice(1), 16), f = v => Math.round(v * (1 - k));
  return '#' + [n >> 16 & 255, n >> 8 & 255, n & 255].map(f).map(v => v.toString(16).padStart(2, '0')).join('');
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f1 = v => +v.toFixed(1);

// ---------------------------------------------------------------- breadboard geometry
const BX = 210, BY = 392;                  // breadboard top-left
const BM = 22;                             // margin from the board edge to column 1
const BW = 2 * BM + 62 * P, BH = 236;
const ROW = { TN: 16, TP: 28, j: 52, i: 64, h: 76, g: 88, f: 100, e: 136, d: 148, c: 160, b: 172, a: 184, BP: 208, BN: 220 };
const RAILS = ['TN', 'TP', 'BP', 'BN'];
const colX = c => BX + BM + (c - 1) * P;
// rail holes come in 10 groups of 5 (50 per rail, like a real 830-point board): columns 5-9, 11-15 ... 59-63
const railHole = c => c >= 5 && c <= 63 && c % 6 !== 4;
function hole(row, c) {
  if (!(row in ROW)) throw new Error(`no row ${row}`);
  if (!Number.isInteger(c) || c < 1 || c > 63) throw new Error(`no column ${c}`);
  if (RAILS.includes(row) && !railHole(c)) throw new Error(`no rail hole at ${row} ${c}`);
  return [colX(c), BY + ROW[row]];
}

// ---------------------------------------------------------------- Arduino UNO R3 geometry
// USB and barrel jack on the left, digital header along the top edge (positions in inches from the
// board's left edge, as on the real board, including the odd 0.16 in gap between pins 8 and 7)
const UX = 300, UY = 712;
const UNO_W = 2.7 * IN, UNO_H = 2.1 * IN;
const UNO_PINS = {
  SCL: [0.84, 'top', 'SCL'], SDA: [0.94, 'top', 'SDA'], AREF: [1.04, 'top', 'AREF'], GNDT: [1.14, 'top', 'GND'],
  D13: [1.24, 'top', '13'], D12: [1.34, 'top', '12'], D11: [1.44, 'top', '~11'], D10: [1.54, 'top', '~10'],
  D9: [1.64, 'top', '~9'], D8: [1.74, 'top', '8'], D7: [1.9, 'top', '7'], D6: [2.0, 'top', '~6'], D5: [2.1, 'top', '~5'],
  D4: [2.2, 'top', '4'], D3: [2.3, 'top', '~3'], D2: [2.4, 'top', '2'], D1: [2.5, 'top', 'TX→1'], D0: [2.6, 'top', 'RX←0'],
  NC: [1.0, 'bot', ''], IOREF: [1.1, 'bot', 'IOREF'], RESET: [1.2, 'bot', 'RESET'], V33: [1.3, 'bot', '3.3V'],
  V5: [1.4, 'bot', '5V'], GND1: [1.5, 'bot', 'GND'], GND2: [1.6, 'bot', 'GND'], VIN: [1.7, 'bot', 'Vin'],
  A0: [2.0, 'bot', 'A0'], A1: [2.1, 'bot', 'A1'], A2: [2.2, 'bot', 'A2'], A3: [2.3, 'bot', 'A3'], A4: [2.4, 'bot', 'A4'], A5: [2.5, 'bot', 'A5'],
};
function unoPin(name) {
  const p = UNO_PINS[name];
  if (!p) throw new Error(`no UNO pin ${name}`);
  return [UX + p[0] * IN, UY + (p[1] === 'top' ? 0.1 : 2.0) * IN];
}

// ---------------------------------------------------------------- floating parts (on the robot)
const SERVO = { x: 214, y: 120 };          // top-left of the servo drawing
const SERVO_PLUG = { x: colX(11), y: BY - 56 };    // its 3-pin connector, hanging above the breadboard
const SONAR = { x: 396, y: 128 };          // board 45 x 20 mm
const GYRO = { x: 640, y: 150 };           // board 20 x 16 mm
const FACE = { x: 836, y: 66 };            // MAX7219 module standing upright, input header along its bottom edge
const MM = P / 2.54;                       // drawing units per millimeter

const sonarPin = i => [SONAR.x + 108 + (i - 1.5) * P, SONAR.y + 96 + 10];   // VCC Trig Echo Gnd
const gyroPin = i => [GYRO.x + 48 + (i - 3.5) * P, GYRO.y + 74 + 10];        // VCC GND SCL SDA XDA XCL AD0 INT
const facePin = i => [FACE.x + 76 + (i - 2) * P, FACE.y + 236 + 10];             // VCC GND DIN CS CLK (pointing down)
const plugPin = i => [SERVO_PLUG.x + (i - 1) * P, SERVO_PLUG.y + 8];          // brown red orange

// ---------------------------------------------------------------- the netlist (BUILD_SPEC.md)
// Two deliberate, physical adjustments to the spec's tidy layout (see the report in README):
//   the 100 uF capacitor sits on column 14 (a 6 mm capacitor on column 9 covers the column-8
//   ground-bridge hole), and the 12 mm buzzer's legs go in row e so its jumpers have free holes in row a.
const STEPS = [
  { n: 1, key: 'power', title: 'W1 · Power' },
  { n: 2, key: 'servo', title: 'W2 · Servo and capacitor' },
  { n: 3, key: 'sonar', title: 'W3 · Sonar' },
  { n: 4, key: 'gyro', title: 'W4 · Gyro' },
  { n: 5, key: 'knob', title: 'W5 · Knob' },
  { n: 6, key: 'face', title: 'W6 · LED face' },
  { n: 7, key: 'remote', title: 'W7 · IR receiver' },
  { n: 8, key: 'buzzer', title: 'W8 · Buzzer' },
];

// wires: from/to are hole('row', col), unoPin('X'), or module pins; route: 'curve' | 'leftAround' | 'rightAround' | points
const WIRES = [
  // W1 power
  { step: 1, from: ['uno', 'V5'], to: ['bb', 'BP', 7], color: 'red', kind: 'jumper', route: 'leftAround', lane: 0 },
  { step: 1, from: ['uno', 'GND1'], to: ['bb', 'BN', 7], color: 'black', kind: 'jumper', route: 'leftAround', lane: 1 },
  { step: 1, from: ['bb', 'TN', 8], to: ['bb', 'BN', 8], color: 'black', kind: 'jumper', route: 'bridge' },
  // W2 servo
  { step: 2, from: ['plug', 0], to: ['bb', 'TN', 11], color: 'brown', kind: 'jumper', route: 'curve' },
  { step: 2, from: ['plug', 1], to: ['bb', 'TP', 11], color: 'red', kind: 'jumper', route: 'curveRight' },
  { step: 2, from: ['plug', 2], to: ['uno', 'D9'], color: 'orange', kind: 'jumper', route: 'curve', pin: 'servo signal' },
  // W3 sonar
  { step: 3, from: ['sonar', 0], to: ['bb', 'BP', 13], color: 'red', kind: 'dupont', route: 'curve' },
  { step: 3, from: ['sonar', 1], to: ['uno', 'D7'], color: 'green', kind: 'dupont', route: 'curve' },
  { step: 3, from: ['sonar', 2], to: ['uno', 'D8'], color: 'blue', kind: 'dupont', route: 'curve' },
  { step: 3, from: ['sonar', 3], to: ['bb', 'BN', 13], color: 'black', kind: 'dupont', route: 'curve' },
  // W4 gyro
  { step: 4, from: ['gyro', 0], to: ['bb', 'BP', 15], color: 'red', kind: 'dupont', route: 'curve' },
  { step: 4, from: ['gyro', 1], to: ['bb', 'BN', 15], color: 'black', kind: 'dupont', route: 'curve' },
  { step: 4, from: ['gyro', 2], to: ['uno', 'A5'], color: 'yellow', kind: 'dupont', route: 'rightAround', lane: 1 },
  { step: 4, from: ['gyro', 3], to: ['uno', 'A4'], color: 'white', kind: 'dupont', route: 'rightAround', lane: 0 },
  // W5 knob: legs in row c, columns 19 20 21
  { step: 5, from: ['bb', 'a', 19], to: ['bb', 'BN', 19], color: 'black', kind: 'jumper', route: 'short' },
  { step: 5, from: ['bb', 'a', 21], to: ['bb', 'BP', 21], color: 'red', kind: 'jumper', route: 'short' },
  { step: 5, from: ['bb', 'e', 20], to: ['uno', 'A0'], color: 'yellow', kind: 'jumper', route: 'rightAround', lane: 2 },
  // W6 face
  { step: 6, from: ['face', 0], to: ['bb', 'BP', 17], color: 'red', kind: 'dupont', route: 'curve' },
  { step: 6, from: ['face', 1], to: ['bb', 'BN', 17], color: 'black', kind: 'dupont', route: 'curve' },
  { step: 6, from: ['face', 2], to: ['uno', 'D11'], color: 'purple', kind: 'dupont', route: 'curve' },
  { step: 6, from: ['face', 3], to: ['uno', 'D10'], color: 'gray', kind: 'dupont', route: 'curve' },
  { step: 6, from: ['face', 4], to: ['uno', 'D13'], color: 'brown', kind: 'dupont', route: 'curve' },
  // W7 remote: G R Y in row c, columns 23 24 25
  { step: 7, from: ['bb', 'a', 23], to: ['bb', 'BN', 23], color: 'black', kind: 'jumper', route: 'short' },
  { step: 7, from: ['bb', 'a', 24], to: ['bb', 'BP', 24], color: 'red', kind: 'jumper', route: 'short' },
  { step: 7, from: ['bb', 'e', 25], to: ['uno', 'D2'], color: 'yellow', kind: 'jumper', route: 'curve' },
  // W8 buzzer: legs in row e, columns 27 (+) and 30
  { step: 8, from: ['bb', 'a', 27], to: ['uno', 'D3'], color: 'white', kind: 'jumper', route: 'curve' },
  { step: 8, from: ['bb', 'a', 30], to: ['bb', 'BN', 30], color: 'black', kind: 'jumper', route: 'short' },
];

// parts plugged into the breadboard (legs) — for checks and drawing
const LEGS = [
  { step: 1, part: 'power module', holes: [['TN', 5], ['TP', 5], ['BP', 5], ['BN', 5]] },
  { step: 2, part: '100 uF capacitor', holes: [['TP', 14], ['TN', 14]] },
  { step: 5, part: 'knob', holes: [['c', 19], ['c', 20], ['c', 21]] },
  { step: 7, part: 'IR receiver', holes: [['c', 23], ['c', 24], ['c', 25]] },
  { step: 8, part: 'buzzer', holes: [['e', 27], ['e', 30]] },
];

// ---------------------------------------------------------------- checks against the firmware
{
  const want = {
    D2: S.PIN.IR, D3: S.PIN.BUZZER, D7: S.PIN.TRIG, D8: S.PIN.ECHO, D9: S.PIN.SERVO,
    D10: S.PIN.MAX_CS, D11: S.PIN.MAX_DIN, D13: S.PIN.MAX_CLK, A0: S.PIN.KNOB, A4: S.PIN.SDA, A5: S.PIN.SCL,
  };
  const role = { 'sonar,1': 'TRIG', 'sonar,2': 'ECHO', 'plug,2': 'SERVO', 'face,2': 'MAX_DIN', 'face,3': 'MAX_CS', 'face,4': 'MAX_CLK', 'gyro,2': 'SCL', 'gyro,3': 'SDA', 'bb,e,20': 'KNOB', 'bb,e,25': 'IR', 'bb,a,27': 'BUZZER' };
  const used = new Set();
  for (const w of WIRES) {
    if (w.to[0] !== 'uno' || /^(V5|GND)/.test(w.to[1])) continue;
    const pin = w.to[1], r = role[w.from.join(',')];
    if (!r) throw new Error(`wire to ${pin} has no firmware role`);
    const fw = S.PIN[r], got = pin.startsWith('D') ? +pin.slice(1) : pin;
    if (fw !== got) throw new Error(`${r}: firmware says ${fw}, diagram says ${pin}`);
    if (want[pin] !== fw) throw new Error(`pin table mismatch at ${pin}`);
    used.add(pin);
  }
  for (const pin of Object.keys(want)) if (!used.has(pin)) throw new Error(`firmware pin ${pin} is never wired`);
  // every hole used once, all within columns 1-30
  const seen = new Map();
  const take = (row, c, who) => {
    hole(row, c);
    if (c > 30) throw new Error(`${who} uses column ${c}; everything must sit in columns 1-30`);
    const k = `${row}${c}`;
    if (seen.has(k)) throw new Error(`hole ${k} used twice (${seen.get(k)} and ${who})`);
    seen.set(k, who);
  };
  for (const l of LEGS) for (const [r, c] of l.holes) take(r, c, l.part);
  for (const w of WIRES) for (const end of [w.from, w.to]) if (end[0] === 'bb') take(end[1], end[2], `${w.color} wire`);
  // jumpers that feed a part's leg must share its column, on the same side of the trench
  const half = r => (['a', 'b', 'c', 'd', 'e'].includes(r) ? 'low' : ['f', 'g', 'h', 'i', 'j'].includes(r) ? 'high' : r);
  for (const w of WIRES) {
    const e = w.from[0] === 'bb' && !RAILS.includes(w.from[1]) ? w.from : null;
    if (!e) continue;
    const leg = LEGS.flatMap(l => l.holes).find(([r, c]) => c === e[2] && half(r) === half(e[1]));
    if (!leg) throw new Error(`wire at ${e[1]}${e[2]} touches no part leg`);
  }
}

// ---------------------------------------------------------------- svg helpers
const rect = (x, y, w, h, a = '') => `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" ${a}/>`;
const circ = (x, y, r, a = '') => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" ${a}/>`;
const line = (x1, y1, x2, y2, a = '') => `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" ${a}/>`;
const text = (x, y, s, a = '') => `<text x="${f1(x)}" y="${f1(y)}" ${a}>${esc(s)}</text>`;
const vtext = (x, y, s, a = '') => `<text transform="translate(${f1(x)} ${f1(y)}) rotate(-90)" ${a}>${esc(s)}</text>`;

function pill(x, y, label, { anchor = 'middle', size = 13, fill = C.pill, color = C.ink, edge = C.pillEdge, bold = true } = {}) {
  const w = label.length * size * 0.62 + 12, h = size + 9;
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return `<g>${rect(x0, y - h / 2, w, h, `rx="${h / 2}" fill="${fill}" stroke="${edge}" stroke-width="1"`)}` +
    text(x0 + w / 2, y + size * 0.35, label, `text-anchor="middle" font-size="${size}" font-weight="${bold ? 600 : 400}" fill="${color}"`) + '</g>';
}

// ---------------------------------------------------------------- drawing: bench, breadboard, UNO
function bench() {
  let s = rect(0, 0, W, H, `fill="${C.bench}"`);
  for (let y = 40; y < H; y += 40) s += line(0, y, W, y, `stroke="${C.benchLine}" stroke-width="1"`);
  return s;
}

function breadboard() {
  let s = `<g>`;
  s += rect(BX + 2, BY + 4, BW, BH, `rx="9" fill="#c9cbc2" opacity="0.6"`);
  s += rect(BX, BY, BW, BH, `rx="9" fill="${C.board}" stroke="${C.boardEdge}" stroke-width="1.5"`);
  s += rect(BX + 6, BY + 110, BW - 12, 16, `rx="4" fill="${C.groove}"`);
  // rail stripes and + / - marks
  const x0 = colX(5) - 8, x1 = colX(63) + 8;
  s += line(x0, BY + 6, x1, BY + 6, `stroke="${C.blue}" stroke-width="2"`);
  s += line(x0, BY + 38, x1, BY + 38, `stroke="${C.red}" stroke-width="2"`);
  s += line(x0, BY + 198, x1, BY + 198, `stroke="${C.red}" stroke-width="2"`);
  s += line(x0, BY + 230, x1, BY + 230, `stroke="${C.blue}" stroke-width="2"`);
  const sign = (x, row, plus) => text(x, BY + ROW[row] + 4.5, plus ? '+' : '−', `text-anchor="middle" font-size="13" font-weight="700" fill="${plus ? C.red : C.blue}"`);
  for (const x of [BX + 12, BX + BW - 12]) { s += sign(x, 'TN', false) + sign(x, 'TP', true) + sign(x, 'BP', true) + sign(x, 'BN', false); }
  // holes
  for (const r of RAILS) for (let c = 1; c <= 63; c++) if (railHole(c)) s += `<use href="#h${ID}" x="${colX(c)}" y="${BY + ROW[r]}"/>`;
  for (const r of ['j', 'i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']) for (let c = 1; c <= 63; c++) s += `<use href="#h${ID}" x="${colX(c)}" y="${BY + ROW[r]}"/>`;
  // numbers and letters
  for (const c of [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]) {
    s += text(colX(c), BY + 45.5, String(c), `text-anchor="middle" font-size="9" fill="${C.ink3}"`);
    s += text(colX(c), BY + 196 - 3, String(c), `text-anchor="middle" font-size="9" fill="${C.ink3}"`);
  }
  for (const r of ['j', 'i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']) {
    s += text(BX + 9, BY + ROW[r] + 3, r, `text-anchor="middle" font-size="9" fill="${C.ink3}"`);
    s += text(BX + BW - 9, BY + ROW[r] + 3, r, `text-anchor="middle" font-size="9" fill="${C.ink3}"`);
  }
  return s + '</g>';
}

function uno() {
  const x = UX, y = UY, w = UNO_W, h = UNO_H, k = IN;
  let s = '<g>';
  // outline with the UNO's angled right corners
  const pts = [[x, y + 4], [x + w - 0.3 * k, y], [x + w - 0.1 * k, y + 0.12 * k], [x + w, y + 0.62 * k], [x + w, y + 1.98 * k], [x + w - 0.1 * k, y + h], [x, y + h]];
  s += `<polygon points="${pts.map(([a, b]) => `${f1(a + 3)},${f1(b + 4)}`).join(' ')}" fill="#000" opacity="0.12"/>`;
  s += `<polygon points="${pts.map(([a, b]) => `${f1(a)},${f1(b)}`).join(' ')}" fill="${C.pcb}" stroke="${C.pcbDark}" stroke-width="2" stroke-linejoin="round"/>`;
  // mounting holes
  for (const [hx, hy] of [[0.55, 2.0], [0.6, 0.1 + 0.0], [2.6, 0.3], [2.6, 1.4]]) s += circ(x + hx * k, y + hy * k, 6.5, `fill="${C.bench}" stroke="#d8dde4" stroke-width="2"`);
  // USB-B and barrel jack (on the left), regulator, big capacitors
  s += rect(x - 0.24 * k, y + 0.36 * k, 0.62 * k, 0.48 * k, `rx="3" fill="#c7ccd2" stroke="#8d939b" stroke-width="1.5"`);
  s += rect(x - 0.2 * k, y + 0.46 * k, 0.24 * k, 0.28 * k, `fill="#9aa1a9"`);
  s += rect(x - 0.08 * k, y + 1.52 * k, 0.56 * k, 0.44 * k, `rx="3" fill="#1d1f22"`);
  s += circ(x + 0.66 * k, y + 1.66 * k, 0.12 * k, `fill="#22262b" stroke="#8d939b" stroke-width="2"`);
  s += circ(x + 0.94 * k, y + 1.66 * k, 0.12 * k, `fill="#22262b" stroke="#8d939b" stroke-width="2"`);
  s += rect(x + 0.6 * k, y + 1.2 * k, 0.3 * k, 0.2 * k, `fill="#26292d"`);
  // reset button, small chips, crystal, ICSP
  s += rect(x + 0.1 * k, y + 0.06 * k, 0.26 * k, 0.26 * k, `rx="3" fill="#d8dde4"`) + circ(x + 0.23 * k, y + 0.19 * k, 0.08 * k, `fill="#d03b3b"`);
  s += rect(x + 0.55 * k, y + 0.5 * k, 0.3 * k, 0.3 * k, `fill="#1f2226"`);
  s += rect(x + 1.0 * k, y + 1.02 * k, 0.4 * k, 0.12 * k, `rx="3" fill="#cfd4da"`);
  s += rect(x + 2.43 * k, y + 0.88 * k, 0.24 * k, 0.34 * k, `fill="#1f2226"`);
  // ATmega328P
  s += rect(x + 1.22 * k, y + 1.42 * k, 1.42 * k, 0.34 * k, `rx="2" fill="#1c1e21"`);
  for (let i = 0; i < 14; i++) { s += rect(x + (1.27 + i * 0.1) * k, y + 1.37 * k, 0.04 * k, 0.05 * k, `fill="#a9afb6"`); s += rect(x + (1.27 + i * 0.1) * k, y + 1.76 * k, 0.04 * k, 0.05 * k, `fill="#a9afb6"`); }
  s += text(x + 1.93 * k, y + 1.63 * k, 'ATMEGA328P', `text-anchor="middle" font-size="9" fill="#6c737c"`);
  // logo
  s += text(x + 1.2 * k, y + 0.98 * k, 'ELEGOO', `font-size="22" font-weight="700" fill="${C.pcbInk}" letter-spacing="1"`);
  s += text(x + 1.2 * k, y + 1.2 * k, 'UNO R3', `font-size="15" font-weight="600" fill="${C.pcbInk}" opacity="0.85"`);
  // headers
  const header = (x0, n, yy) => {
    let t = rect(x0 - 0.05 * k, yy - 0.05 * k, n * 0.1 * k, 0.1 * k, `fill="#16181b"`);
    for (let i = 0; i < n; i++) t += rect(x0 + i * 0.1 * k - 2.2, yy - 2.2, 4.4, 4.4, `fill="#5d636b"`);
    return t;
  };
  s += header(x + 0.84 * k, 10, y + 0.1 * k) + header(x + 1.9 * k, 8, y + 0.1 * k);
  s += header(x + 1.0 * k, 8, y + 2.0 * k) + header(x + 2.0 * k, 6, y + 2.0 * k);
  // silkscreen pin names (rotated, as printed on the board)
  for (const [, [px, side, label]] of Object.entries(UNO_PINS)) {
    if (!label) continue;
    if (side === 'top') s += vtext(x + px * k + 3.2, y + 0.19 * k, label, `text-anchor="end" font-size="8.5" fill="${C.pcbInk}"`);
    else s += vtext(x + px * k + 3.2, y + 1.91 * k, label, `text-anchor="start" font-size="8.5" fill="${C.pcbInk}"`);
  }
  s += text(x + 1.96 * k, y + 0.62 * k, 'DIGITAL (PWM ~)', `text-anchor="middle" font-size="9" fill="${C.pcbInk}" opacity="0.8"`);
  s += text(x + 1.35 * k, y + 1.4 * k - 0.1 * k + 0.05 * k, 'POWER', `text-anchor="middle" font-size="9" fill="${C.pcbInk}" opacity="0.8"`);
  s += text(x + 2.25 * k, y + 1.4 * k - 0.05 * k, 'ANALOG IN', `text-anchor="middle" font-size="9" fill="${C.pcbInk}" opacity="0.8"`);
  return s + '</g>';
}

// ---------------------------------------------------------------- parts
// callouts go in their own layer, drawn on top of everything
let NOTES = [];
const note = svg => { NOTES.push(svg); return ''; };

function powerModule(mode) {
  const px = colX(5);
  const x1 = px + 10, x0 = x1 - 176, y0 = BY - 10, y1 = BY + BH + 10;
  let s = '<g>';
  s += rect(x0 + 3, y0 + 4, x1 - x0, y1 - y0, `rx="6" fill="#000" opacity="0.18"`);
  s += rect(x0, y0, x1 - x0, y1 - y0, `rx="6" fill="#1b1d20" stroke="#000" stroke-width="1.5"`);
  // pins on the rails
  for (const r of RAILS) s += rect(px - 4, BY + ROW[r] - 4, 8, 8, `rx="1.5" fill="#c9a227"`);
  s += text(px - 12, BY + ROW.TN + 4, '−', `text-anchor="middle" font-size="13" font-weight="700" fill="#9ec0ff"`);
  s += text(px - 12, BY + ROW.TP + 4, '+', `text-anchor="middle" font-size="13" font-weight="700" fill="#ff9c96"`);
  s += text(px - 12, BY + ROW.BP + 4, '+', `text-anchor="middle" font-size="13" font-weight="700" fill="#ff9c96"`);
  s += text(px - 12, BY + ROW.BN + 4, '−', `text-anchor="middle" font-size="13" font-weight="700" fill="#9ec0ff"`);
  // the two output jumpers: 5V | OFF | 3.3
  const jumper = (yy, pos, label) => {
    let t = '';
    const xs = [x1 - 104, x1 - 74, x1 - 44];
    t += rect(xs[0] - 13, yy - 13, 88, 26, `rx="3" fill="#2a2d31"`);
    xs.forEach((xx, i) => { t += circ(xx, yy + 1, 4, `fill="#c9a227"`); t += text(xx, yy - 16, ['5V', 'OFF', '3.3'][i], `text-anchor="middle" font-size="10" font-weight="600" fill="#e8ecf2"`); });
    const xx = xs[pos];
    t += rect(xx - 10, yy - 8, 20, 18, `rx="3" fill="#2f6fd0" stroke="#bcd3ff" stroke-width="1.5"`);
    if (mode !== 'faded') note(pill(x0 + 40, yy + (yy < BY + 100 ? -38 : 38), label, { size: 11.5, fill: '#fff8d6', edge: '#e2c35c' }));
    return t;
  };
  s += jumper(BY + 40, 0, 'top jumper: 5V');
  s += jumper(BY + 196, 1, 'bottom jumper: OFF');
  // jack, USB, switch, LED, regulators
  s += rect(x0 - 8, BY + 128, 46, 40, `rx="4" fill="#0e0f11" stroke="#3a3e44" stroke-width="1.5"`);
  s += circ(x0 + 10, BY + 148, 9, `fill="#3a3e44"`) + circ(x0 + 10, BY + 148, 3, `fill="#c9a227"`);
  s += rect(x0 - 6, BY + 70, 40, 34, `rx="2" fill="#c7ccd2" stroke="#8d939b" stroke-width="1.5"`);
  s += rect(x0 + 52, BY + 84, 22, 22, `rx="3" fill="#ddd"`) + circ(x0 + 63, BY + 95, 6, `fill="#9aa"`);
  s += circ(x0 + 92, BY + 95, 5, `fill="#38d16a"`);
  s += rect(x0 + 60, BY + 132, 30, 22, `fill="#2f3237"`) + rect(x0 + 102, BY + 132, 30, 22, `fill="#2f3237"`);
  s += text(x0 + 88, BY + 120, 'POWER MODULE', `text-anchor="middle" font-size="9.5" font-weight="600" fill="#cfd5dc"`);
  // the 9 V adapter cable, entering the jack from the left
  s += `<path d="M ${x0 - 8} ${BY + 148} C ${x0 - 40} ${BY + 148} ${x0 - 50} ${BY + 210} ${x0 - 60} ${BY + 300}" fill="none" stroke="#2c2f33" stroke-width="7" stroke-linecap="round"/>`;
  s += rect(x0 - 30, BY + 140, 22, 16, `rx="3" fill="#2c2f33"`);
  if (mode !== 'faded') note(pill(8, BY + 322, '9 V 1 A adapter (to the wall)', { anchor: 'start', size: 11.5 }));
  return s + '</g>';
}

function capacitor(mode) {
  const x = colX(14), yT = BY + ROW.TN, yP = BY + ROW.TP, cy = (yT + yP) / 2;
  let s = '<g>';
  s += line(x, yT, x, yP, `stroke="#a9afb6" stroke-width="2"`);
  s += circ(x + 1.5, cy + 2, 15, `fill="#000" opacity="0.18"`);
  s += circ(x, cy, 15, `fill="#1f3f86" stroke="#0f2554" stroke-width="1.5"`);
  // the stripe marks the minus leg, which sits on the top (blue, minus) rail
  s += `<path d="M ${x - 14.2} ${cy - 5} A 15 15 0 0 1 ${x + 14.2} ${cy - 5} L ${x + 9} ${cy - 3} A 10 10 0 0 0 ${x - 9} ${cy - 3} Z" fill="#cfd8ea"/>`;
  s += text(x, cy - 8, '−', `text-anchor="middle" font-size="11" font-weight="700" fill="#1f3f86"`);
  s += circ(x, cy + 4, 6, `fill="#2a4f9e" stroke="#7d93c4" stroke-width="1"`);
  if (mode === 'own') {
    note(`<path d="M ${x + 62} ${BY - 64} C ${x + 40} ${BY - 40} ${x + 22} ${BY - 20} ${x + 12} ${cy - 10}" fill="none" stroke="${C.ink}" stroke-width="1.2"/>`);
    note(pill(x + 60, BY - 74, '100 µF: stripe (−) on the blue rail', { anchor: 'start', size: 11.5, fill: '#fff8d6', edge: '#e2c35c' }));
  }
  return s + '</g>';
}

function servo() {
  const { x, y } = SERVO;
  let s = '<g>';
  // body (top view): tabs, case, output shaft with the single-arm horn
  s += rect(x + 2, y + 4, 154, 58, `rx="6" fill="#000" opacity="0.15"`);
  s += rect(x, y + 12, 154, 34, `rx="5" fill="#2a63c4"`);
  s += circ(x + 10, y + 29, 4.5, `fill="${C.bench}"`) + circ(x + 144, y + 29, 4.5, `fill="${C.bench}"`);
  s += rect(x + 24, y, 106, 58, `rx="6" fill="#3172d6" stroke="#1d4f9e" stroke-width="1.5"`);
  s += circ(x + 102, y + 29, 17, `fill="#2a63c4" stroke="#1d4f9e" stroke-width="1.2"`);
  s += `<path d="M ${x + 102 - 8} ${y + 29} L ${x + 102 - 6} ${y - 30} Q ${x + 102} ${y - 38} ${x + 102 + 6} ${y - 30} L ${x + 102 + 8} ${y + 29} Z" fill="#f4f4f1" stroke="#c9c9c3" stroke-width="1"/>`;
  s += circ(x + 102, y + 29, 9, `fill="#f4f4f1" stroke="#c9c9c3" stroke-width="1"`) + circ(x + 102, y + 29, 3, `fill="#888"`);
  for (let i = 0; i < 5; i++) s += circ(x + 102, y + 14 - i * 9, 1.8, `fill="#bbb"`);
  s += text(x + 50, y + 34, 'SG90', `text-anchor="middle" font-size="13" font-weight="700" fill="#dbe7ff"`);
  // its cable: brown, red, orange, running to the 3-pin plug
  const cx = x + 26, cy = y + 50;
  const ends = [0, 1, 2].map(plugPin);
  ['brown', 'red', 'orange'].forEach((col, i) => {
    const sx = cx + (i - 1) * 4.5, [ex] = ends[i];
    s += `<path d="M ${sx} ${cy} C ${sx} ${cy + 70} ${ex} ${SERVO_PLUG.y - 70} ${ex} ${SERVO_PLUG.y - 10}" fill="none" stroke="${darker(WIRE[col], 0.3)}" stroke-width="5" stroke-linecap="round"/>`;
    s += `<path d="M ${sx} ${cy} C ${sx} ${cy + 70} ${ex} ${SERVO_PLUG.y - 70} ${ex} ${SERVO_PLUG.y - 10}" fill="none" stroke="${WIRE[col]}" stroke-width="3.2" stroke-linecap="round"/>`;
  });
  s += rect(SERVO_PLUG.x - P - 7, SERVO_PLUG.y - 12, 2 * P + 14, 22, `rx="2" fill="#17191c"`);
  for (let i = 0; i < 3; i++) s += rect(plugPin(i)[0] - 2.5, SERVO_PLUG.y + 4, 5, 5, `fill="#555b63"`);
  s += text(x, y - 46, 'SERVO', `font-size="13" font-weight="700" fill="${C.ink}"`);
  s += text(x, y - 31, '(on its post)', `font-size="11" fill="${C.ink2}"`);
  return s + '</g>';
}

function sonar() {
  const { x, y } = SONAR, w = 216, h = 96;
  let s = '<g>';
  s += rect(x + 3, y + 4, w, h, `rx="5" fill="#000" opacity="0.15"`);
  s += rect(x, y, w, h, `rx="5" fill="#2b66c4" stroke="#1b4c97" stroke-width="1.5"`);
  for (const dx of [-61, 61]) {
    s += circ(x + w / 2 + dx, y + 40, 37, `fill="#cfd4da" stroke="#8d939b" stroke-width="2"`);
    s += circ(x + w / 2 + dx, y + 40, 28, `fill="#9aa1a9"`);
    for (let r = 24; r > 4; r -= 5) s += circ(x + w / 2 + dx, y + 40, r, `fill="none" stroke="#7d848d" stroke-width="1"`);
  }
  s += rect(x + w / 2 - 12, y + 16, 24, 10, `rx="3" fill="#c9cfd6"`);
  s += text(x + w / 2, y + 12, 'HC-SR04', `text-anchor="middle" font-size="10" font-weight="700" fill="#e7efff"`);
  ['VCC', 'Trig', 'Echo', 'Gnd'].forEach((lb, i) => {
    const [px] = sonarPin(i);
    s += vtext(px + 3.5, y + h - 4, lb, `font-size="9.5" font-weight="600" fill="#e7efff"`);
    s += rect(px - 1.5, y + h, 3, 10, `fill="#c9a227"`);
  });
  s += text(x, y - 30, 'SONAR', `font-size="13" font-weight="700" fill="${C.ink}"`);
  s += text(x, y - 15, '(on the beam)', `font-size="11" fill="${C.ink2}"`);
  return s + '</g>';
}

function gyro() {
  const { x, y } = GYRO, w = 96, h = 74;
  let s = '<g>';
  s += rect(x + 3, y + 4, w, h, `rx="4" fill="#000" opacity="0.15"`);
  s += rect(x, y, w, h, `rx="4" fill="#2b66c4" stroke="#1b4c97" stroke-width="1.5"`);
  s += circ(x + 9, y + 9, 5, `fill="${C.bench}"`) + circ(x + w - 9, y + 9, 5, `fill="${C.bench}"`);
  s += rect(x + w / 2 - 12, y + 14, 24, 24, `rx="2" fill="#16181b"`);
  s += text(x + w / 2, y + 12, 'GY-521', `text-anchor="middle" font-size="8.5" font-weight="700" fill="#e7efff"`);
  ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'].forEach((lb, i) => {
    const [px] = gyroPin(i);
    s += vtext(px + 3.2, y + h - 3, lb, `font-size="8.5" font-weight="600" fill="#e7efff" opacity="${i < 4 ? 1 : 0.6}"`);
    s += rect(px - 1.5, y + h, 3, 10, `fill="#c9a227"`);
  });
  s += text(x, y - 30, 'GYRO', `font-size="13" font-weight="700" fill="${C.ink}"`);
  s += text(x, y - 15, '(on the beam)', `font-size="11" fill="${C.ink2}"`);
  return s + '</g>';
}

function face() {
  const { x, y } = FACE, w = 151, h = 236;
  let s = '<g>';
  s += rect(x + 3, y + 4, w, h, `rx="5" fill="#000" opacity="0.15"`);
  s += rect(x, y, w, h, `rx="5" fill="#2b66c4" stroke="#1b4c97" stroke-width="1.5"`);
  const mx = x, my = y + 42, ms = 151;
  s += rect(mx, my, ms, ms, `fill="#141516" stroke="#000" stroke-width="1"`);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) s += circ(mx + 9.5 + c * 18.8, my + 9.5 + r * 18.8, 6.4, `fill="#3b1714"`);
  ['VCC', 'GND', 'DIN', 'CS', 'CLK'].forEach((lb, i) => {
    const [px] = facePin(i);
    s += vtext(px + 3.2, y + h - 4, lb, `font-size="9" font-weight="600" fill="#e7efff"`);
    s += rect(px - 1.5, y + h, 3, 10, `fill="#c9a227"`);
  });
  ['VCC', 'GND', 'DOUT', 'CS', 'CLK'].forEach((lb, i) => {
    const px = x + 76 + (i - 2) * P;
    s += rect(px - 1.5, y - 10, 3, 10, `fill="#c9a227" opacity="0.6"`);
    s += vtext(px + 3.2, y + 36, lb, `font-size="7.5" fill="#e7efff" opacity="0.55"`);
  });
  s += text(x + w / 2, y + 212, 'MAX7219', `text-anchor="middle" font-size="9" font-weight="700" fill="#e7efff"`);
  s += text(x - 8, y + 18, 'LED FACE', `text-anchor="end" font-size="13" font-weight="700" fill="${C.ink}"`);
  s += text(x - 8, y + 34, '(on the front', `text-anchor="end" font-size="11" fill="${C.ink2}"`);
  s += text(x - 8, y + 48, 'tower)', `text-anchor="end" font-size="11" fill="${C.ink2}"`);
  s += text(x - 8, y + 70, 'top pins:', `text-anchor="end" font-size="10" fill="${C.ink3}"`);
  s += text(x - 8, y + 83, 'leave empty', `text-anchor="end" font-size="10" fill="${C.ink3}"`);
  return s + '</g>';
}

function knob(mode) {
  const [x0] = hole('c', 19), [x2] = hole('c', 21), y = BY + ROW.c, cx = (x0 + x2) / 2;
  let s = '<g>';
  s += rect(cx - 21 + 2, y - 20 + 3, 42, 40, `rx="4" fill="#000" opacity="0.18"`);
  s += rect(cx - 21, y - 20, 42, 40, `rx="4" fill="#26292d" stroke="#0f1012" stroke-width="1.5"`);
  s += circ(cx, y, 13, `fill="#3d4147" stroke="#5b616a" stroke-width="2"`);
  s += line(cx, y, cx, y - 11, `stroke="#e8ecf2" stroke-width="2.5" stroke-linecap="round"`);
  for (const c of [19, 20, 21]) s += circ(colX(c), y, 2.6, `fill="#c9a227" stroke="#ffffff" stroke-width="0.8"`);   // legs in row c (shown through the body)
  if (mode === 'own') note(pill(cx, y - 36, 'knob (10K): one leg per column', { size: 11.5, fill: '#fff8d6', edge: '#e2c35c' }));
  return s + '</g>';
}

function irReceiver(mode) {
  const y = BY + ROW.c, x0 = colX(23), x2 = colX(25);
  let s = '<g>';
  s += rect(x0 - 8 + 2, y - 7 + 3, x2 - x0 + 16, 12, `rx="2" fill="#000" opacity="0.2"`);
  s += rect(x0 - 8, y - 7, x2 - x0 + 16, 12, `rx="2" fill="#1d1f22"`);
  s += `<path d="M ${colX(24) - 10} ${y + 5} Q ${colX(24)} ${y + 24} ${colX(24) + 10} ${y + 5} Z" fill="#2c2f34" stroke="#5a5f66" stroke-width="1"/>`;
  ['G', 'R', 'Y'].forEach((lb, i) => { s += text(colX(23 + i), y - 11, lb, `text-anchor="middle" font-size="11" font-weight="700" fill="${C.ink}"`); });
  if (mode === 'own') {
    note(line(colX(24) + 6, y + 18, colX(31), BY + ROW.b + 2, `stroke="${C.ink}" stroke-width="1.2"`));
    note(pill(colX(31), BY + ROW.b + 2, 'IR receiver: G R Y, dome toward you', { anchor: 'start', size: 11.5, fill: '#fff8d6', edge: '#e2c35c' }));
  }
  return s + '</g>';
}

function buzzer(mode) {
  const y = BY + ROW.e, cx = (colX(27) + colX(30)) / 2;
  let s = '<g>';
  s += circ(cx + 2, y + 3, 28, `fill="#000" opacity="0.2"`);
  s += circ(cx, y, 28, `fill="#1a1b1d" stroke="#000" stroke-width="1.5"`);
  s += circ(cx, y, 20, `fill="#f2f2ee"`);
  s += circ(cx, y, 4, `fill="#1a1b1d"`);
  s += text(colX(27) + 1, y - 7, '+', `text-anchor="middle" font-size="13" font-weight="700" fill="#d6312b"`);
  if (mode === 'own') {
    note(line(cx + 42, BY + ROW.e - 42, cx + 18, y - 18, `stroke="${C.ink}" stroke-width="1.2"`));
    note(pill(cx + 40, BY + ROW.e - 52, 'active buzzer: + leg (longer) in column 27', { anchor: 'start', size: 11.5, fill: '#fff8d6', edge: '#e2c35c' }));
  }
  return s + '</g>';
}

// ---------------------------------------------------------------- wires
function endPoint(e) {
  if (e[0] === 'bb') return hole(e[1], e[2]);
  if (e[0] === 'uno') return unoPin(e[1]);
  if (e[0] === 'sonar') return sonarPin(e[1]);
  if (e[0] === 'gyro') return gyroPin(e[1]);
  if (e[0] === 'face') return facePin(e[1]);
  if (e[0] === 'plug') return plugPin(e[1]);
  throw new Error(`unknown end ${e}`);
}

// smooth path through waypoints (rounded corners)
function rounded(pts, r = 16) {
  let d = `M ${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1), rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = x1 - (x1 - x0) / l1 * rr, ay = y1 - (y1 - y0) / l1 * rr, bx = x1 + (x2 - x1) / l2 * rr, by = y1 + (y2 - y1) / l2 * rr;
    d += ` L ${f1(ax)} ${f1(ay)} Q ${f1(x1)} ${f1(y1)} ${f1(bx)} ${f1(by)}`;
  }
  const [xl, yl] = pts[pts.length - 1];
  return d + ` L ${f1(xl)} ${f1(yl)}`;
}

function wirePathFor(w) {
  const [x1, y1] = endPoint(w.from), [x2, y2] = endPoint(w.to);
  const start = w.kind === 'dupont' ? [x1, y1 + 22] : [x1, y1];
  if (w.route === 'curve') {
    const [sx, sy] = start;
    const k = Math.max(40, Math.abs(y2 - sy) * 0.5);
    const dir = y2 >= sy ? 1 : -1;
    return `M ${f1(sx)} ${f1(sy)} C ${f1(sx)} ${f1(sy + dir * k)} ${f1(x2)} ${f1(y2 - dir * k)} ${f1(x2)} ${f1(y2)}`;
  }
  if (w.route === 'curveRight') {           // arrives from the right, so it doesn't cover the hole above it
    return `M ${f1(x1)} ${f1(y1)} C ${f1(x1 + 6)} ${f1(y1 + 34)} ${f1(x2 + 26)} ${f1(y2 - 22)} ${f1(x2)} ${f1(y2)}`;
  }
  if (w.route === 'bridge') {
    return `M ${f1(x1)} ${f1(y1)} C ${f1(x1 + 30)} ${f1(y1 + 70)} ${f1(x2 + 30)} ${f1(y2 - 70)} ${f1(x2)} ${f1(y2)}`;
  }
  if (w.route === 'short') {
    return `M ${f1(x1)} ${f1(y1)} C ${f1(x1 + 7)} ${f1(y1 + 9)} ${f1(x2 + 7)} ${f1(y2 - 9)} ${f1(x2)} ${f1(y2)}`;
  }
  if (w.route === 'leftAround') {          // from the UNO's power header, around its left side, up to the rails
    const lane = w.lane * 11;
    const yBelow = UY + UNO_H + 30 + lane, xLeft = UX - 64 - lane, yUp = BY + BH + 24 + lane;
    return rounded([[x1, y1], [x1, yBelow], [xLeft, yBelow], [xLeft, yUp], [x2 - 14, yUp], [x2, y2]], 14);
  }
  if (w.route === 'rightAround') {         // down the UNO's right side and in from below
    const lane = w.lane * 11;
    const xRight = UX + UNO_W + 26 + lane, yBelow = UY + UNO_H + 30 + 22 + lane;
    const [sx, sy] = start;
    const yMid = BY + BH + 30 + lane;
    const pts = w.from[0] === 'bb'
      ? [[sx, sy], [sx, yMid], [xRight, yMid], [xRight, yBelow], [x2, yBelow], [x2, y2]]
      : [[sx, sy], [sx, BY - 30 + lane], [xRight, BY - 30 + lane], [xRight, yBelow], [x2, yBelow], [x2, y2]];
    return rounded(pts, 16);
  }
  throw new Error(`unknown route ${w.route}`);
}

function wireSvg(w) {
  const col = WIRE[w.color], edge = w.color === 'white' ? '#9aa0a8' : darker(col);
  const d = wirePathFor(w);
  let s = `<path d="${d}" fill="none" stroke="${edge}" stroke-width="6.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  // ends: a pin dot where a male end goes into a hole or header
  const [x2, y2] = endPoint(w.to);
  s += circ(x2, y2, 3.6, `fill="${edge}" stroke="#ffffff" stroke-width="1.2"`);
  if (w.from[0] === 'bb' || w.from[0] === 'plug') { const [x1, y1] = endPoint(w.from); s += circ(x1, y1, 3.6, `fill="${edge}" stroke="#ffffff" stroke-width="1.2"`); }
  if (w.kind === 'dupont') {               // the female housing slips over the module's pin
    const [x1, y1] = endPoint(w.from);
    s += rect(x1 - 5, y1 + 2, 10, 22, `rx="1.5" fill="#141517" stroke="${col}" stroke-width="1"`);
  }
  return s;
}

// pin name tags at the Arduino end of a step's wires, stacked in tiers so they never overlap
function unoTags(steps) {
  const items = [];
  for (const w of WIRES) {
    if (!steps.includes(w.step)) continue;
    const end = w.to[0] === 'uno' ? w.to : w.from[0] === 'uno' ? w.from : null;
    if (!end) continue;
    const name = end[1], [x, y] = unoPin(name);
    const label = { V5: '5V', GND1: 'GND' }[name] || (name.startsWith('D') ? `pin ${name.slice(1)}` : name);
    items.push({ x, y, label, side: UNO_PINS[name][1] });
  }
  // two rows just above each header; tags alternate rows, then slide sideways until none overlap,
  // with a leader line from each tag to its pin
  let s = '';
  for (const side of ['top', 'bot']) {
    const list = items.filter(i => i.side === side).sort((a, b) => a.x - b.x);
    const rows = [[], []];
    list.forEach((it, i) => rows[list.length > 2 ? i % 2 : 0].push(it));
    rows.forEach((row, r) => {
      const w = it => it.label.length * 11.5 * 0.62 + 12;
      let right = -Infinity;
      for (const it of row) { it.tx = Math.max(it.x, right + 6 + w(it) / 2); right = it.tx + w(it) / 2; }
      // pull the row back toward its pins: shift left by the average push, as far as the first tag allows
      const push = row.reduce((a, it) => a + (it.tx - it.x), 0) / Math.max(1, row.length);
      for (const it of row) it.tx -= push;
      for (let k = 1; k < row.length; k++) {               // re-separate after the shift
        const a = row[k - 1], b = row[k], gap = (w(a) + w(b)) / 2 + 6;
        if (b.tx - a.tx < gap) b.tx = a.tx + gap;
      }
      for (const it of row) {
        const ty = it.y - (side === 'top' ? 26 : 24) - r * 24;
        s += line(it.tx, ty + 9, it.x, it.y - 4, `stroke="${C.ink}" stroke-width="1.2"`);
        s += pill(it.tx, ty, it.label, { size: 11.5 });
      }
    });
  }
  return s;
}

const PARTS = [
  { step: 1, draw: powerModule, onBoard: true }, { step: 2, draw: capacitor, onBoard: true }, { step: 2, draw: servo },
  { step: 3, draw: sonar }, { step: 4, draw: gyro }, { step: 5, draw: knob, onBoard: true }, { step: 6, draw: face },
  { step: 7, draw: irReceiver, onBoard: true }, { step: 8, draw: buzzer, onBoard: true },
];

// earlier steps are "ghosted": desaturated and pushed toward the bench color, but still opaque,
// so a ghosted part still hides what is under it
const GHOST = (() => {
  const k = 0.38, sat = 0.55, L = 0.94, lum = [0.2126, 0.7152, 0.0722];
  const rows = [0, 1, 2].map(i => [0, 1, 2].map(j => k * ((i === j ? sat : 0) + (1 - sat) * lum[j])).concat([0, (1 - k) * L]));
  return rows.map(r => r.map(v => +v.toFixed(4)).join(' ')).join('  ') + '  0 0 0 1 0';
})();

let ID = '';                      // per-file suffix for ids, so several of these can share one page
function render(step) {           // step = 1..8, or 0 for everything
  ID = `-w${step || 'all'}`;
  const vis = n => (step === 0 || n <= step);
  const modeOf = n => (step === 0 ? 'all' : n === step ? 'own' : 'faded');
  const layer = (n, body) => (!vis(n) ? '' : modeOf(n) === 'faded' ? `<g filter="url(#ghost${ID})">${body}</g>` : body);
  const top = step === 1 ? 352 : 0;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${top} ${W} ${H - top}" font-family="${FONT}" role="img" aria-label="Fulcrum wiring${step ? `, step ${step}` : ', all steps'}">`;
  s += `<defs><rect id="h${ID}" x="-2.3" y="-2.3" width="4.6" height="4.6" rx="0.8" fill="${C.hole}"/>`;
  s += `<filter id="ghost${ID}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${GHOST}"/></filter></defs>`;
  NOTES = [];
  s += bench() + breadboard() + uno();
  // parts on the breadboard, then wires (ghosted first), then the parts on the robot, then the tags
  for (const p of PARTS) if (p.onBoard) s += layer(p.step, p.draw(modeOf(p.step)));
  const order = [...WIRES].sort((a, b) => ((modeOf(a.step) === 'faded' ? 0 : 1) - (modeOf(b.step) === 'faded' ? 0 : 1)) || (a.step - b.step));
  for (const w of order) s += layer(w.step, wireSvg(w));
  for (const p of PARTS) if (!p.onBoard) s += layer(p.step, p.draw(modeOf(p.step)));
  s += unoTags(step ? [step] : STEPS.map(t => t.n));
  s += NOTES.join('');
  return s + '</svg>\n';
}

fs.mkdirSync(OUT, { recursive: true });
for (const st of STEPS) fs.writeFileSync(new URL(`wire-${st.n}.svg`, OUT), render(st.n));
fs.writeFileSync(new URL('wire-all.svg', OUT), render(0));
const sizes = [...STEPS.map(s => `wire-${s.n}.svg`), 'wire-all.svg'].map(f => `${f} ${(fs.statSync(new URL(f, OUT)).size / 1024).toFixed(0)} KB`);
console.log('wrote', sizes.join(', '));
export { STEPS, WIRES, LEGS };
