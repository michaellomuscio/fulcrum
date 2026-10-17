// Fulcrum, the robot, as a three.js scene built to BUILD_SPEC.md in its original metric
// sizes (centimeters, within 1/8 in of the inch sizes the guide gives; z up, x along the
// track from the sonar end, y across with the viewer on the -y side). Pass in the THREE global
// (r128): buildScene(THREE, opts) returns { scene, parts, beam, ... }; applyStep(S, id) sets up one
// build step (which parts show, which are new, how the beam is posed).

export const T = 0.4;                        // cardboard thickness
export const PIVOT_X = 22;
export const BASE_TOP = 0.4;
export const TOWER_H = 14;
export const PZ = BASE_TOP + TOWER_H - 1.5;  // skewer height: hole 1.5 below the top of a tower on the base
export const STRAW_R = 0.3;
export const SADDLE = { w: 7, h: 4.5, notch: 3.5, xs: [5, 22, 29, 39] };
export const FOLD = STRAW_R + (SADDLE.h - SADDLE.notch);      // track fold above the skewer (1.3)
export const INNER_APEX = FOLD + T * Math.SQRT2;
export const BALL_R = 2;
export const BALL_Z = INNER_APEX + BALL_R * Math.SQRT2;       // ball center above the skewer
export const WALL = 3.5;                                      // each face of the V
export const TOWER_INNER = 5.35;
export const ROD_HOLE_Z = STRAW_R + 0.7;                      // push-rod hole above the skewer
export const SHAFT = { x: 27.6, z: 5 };
export const HORN_HOLE = 1.4;

export const STEPS = [
  { id: 'fold', file: 'build-1-fold.png', show: ['track'], fresh: ['track'], pose: 'loose' },
  { id: 'saddles', file: 'build-2-saddles.png', show: ['track', 'saddles', 'straw'], fresh: ['saddles', 'straw'], pose: 'flipped' },
  { id: 'ends', file: 'build-3-ends.png', show: ['track', 'saddles', 'straw', 'sonarPlate', 'farWall'], fresh: ['sonarPlate', 'farWall'], pose: 'loose' },
  { id: 'towers', file: 'build-4-towers.png', show: ['base', 'towers', 'braces'], fresh: ['towers', 'braces'], pose: 'hung' },
  { id: 'hang', file: 'build-5-hang.png', show: ['base', 'towers', 'braces', 'track', 'saddles', 'straw', 'sonarPlate', 'farWall', 'skewer'], fresh: ['skewer'], pose: 'hung' },
  { id: 'servo', file: 'build-6-servo.png', show: ['base', 'towers', 'braces', 'track', 'saddles', 'straw', 'sonarPlate', 'farWall', 'skewer', 'servoPost', 'postBrace', 'servo', 'horn', 'pushRod'], fresh: ['servoPost', 'postBrace', 'servo', 'horn', 'pushRod'], pose: 'hung' },
  { id: 'sensors', file: 'build-7-sensors.png', show: ['base', 'towers', 'braces', 'track', 'saddles', 'straw', 'sonarPlate', 'farWall', 'skewer', 'servoPost', 'postBrace', 'servo', 'horn', 'pushRod', 'sonarBoard', 'gyro', 'matrix', 'ball'], fresh: ['sonarBoard', 'gyro', 'matrix'], pose: 'hung' },
  { id: 'hero', file: 'hero.png', show: 'all', fresh: [], pose: 'hung' },
];

const SMILE = [0x00, 0x66, 0x66, 0x00, 0x81, 0x42, 0x3C, 0x00];

export function buildScene(THREE, opts = {}) {
  const braces = opts.braces || 'inner';     // see BUILD_SPEC note: outer braces overhang the base
  const scene = new THREE.Scene();
  const parts = {};
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const std = (hex, o = {}) => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: 0.88, metalness: 0, ...o });
  const M = {
    base: std(0xa8814f), kraft: std(0xbf9259), track: std(0xc4995c), tower: std(0xb98c55), plate: std(0xb68a52),
    pcb: std(0x1f5fbf, { roughness: 0.55 }), servo: std(0x2e6ed6, { roughness: 0.4 }), silver: std(0xc7ccd3, { metalness: 0.75, roughness: 0.28 }),
    canFace: std(0x5b6168, { roughness: 0.9 }), white: std(0xf2f1ec, { roughness: 0.45 }), ball: std(0xece8de, { roughness: 0.38 }),
    black: std(0x1b1b1d, { roughness: 0.55 }), gold: std(0xd9ab45, { metalness: 0.8, roughness: 0.3 }), chip: std(0x222428, { roughness: 0.5 }),
    ledOn: new THREE.MeshStandardMaterial({ color: lin(0xff4a36), emissive: lin(0xff2a14), emissiveIntensity: 1.6, roughness: 0.4 }),
    ledOff: std(0x461915, { roughness: 0.5 }), straw: std(0xe4ecf4, { roughness: 0.35, side: THREE.DoubleSide }), bamboo: std(0xdfbf8a),
    brown: std(0x6e3d1f), red: std(0xd5322b), orange: std(0xf28c1d), trackEnd: std(0x8f6a3c),
  };
  const EDGE = new THREE.LineBasicMaterial({ color: 0x5c4226 });
  const EDGE_DARK = new THREE.LineBasicMaterial({ color: 0x0f1724 });

  function mesh(geo, mat, edges = EDGE, angle = 25) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    if (edges) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, angle), edges); e.userData.edge = true; m.add(e); }
    return m;
  }
  const box = (sx, sy, sz, mat, edges) => mesh(new THREE.BoxGeometry(sx, sy, sz), mat, edges);
  // a flat shape drawn in (y, z) and given thickness along +x
  const YZ = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  function plateYZ(shape, thick, mat, edges) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 24 });
    g.applyMatrix4(YZ);
    return mesh(g, mat, edges);
  }
  // a flat shape drawn in (x, z) and given thickness toward -y
  const XZ = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  function plateXZ(shape, thick, mat, edges) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 24 });
    g.applyMatrix4(XZ);
    return mesh(g, mat, edges);
  }
  const poly = pts => { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]); s.closePath(); return s; };
  const circle = (cx, cy, r) => { const p = new THREE.Path(); p.absarc(cx, cy, r, 0, Math.PI * 2, true); return p; };
  function tube(points, r, mat, bend = 0.25) {
    // a wire through the points with rounded corners
    const V = p => new THREE.Vector3(...p);
    const path = new THREE.CurvePath();
    let prev = V(points[0]);
    for (let i = 1; i < points.length; i++) {
      const cur = V(points[i]);
      if (i < points.length - 1) {
        const next = V(points[i + 1]);
        const a = cur.clone().add(prev.clone().sub(cur).setLength(Math.min(bend, prev.distanceTo(cur) / 2)));
        const b = cur.clone().add(next.clone().sub(cur).setLength(Math.min(bend, next.distanceTo(cur) / 2)));
        path.add(new THREE.LineCurve3(prev, a));
        path.add(new THREE.QuadraticBezierCurve3(a, cur, b));
        prev = b;
      } else path.add(new THREE.LineCurve3(prev, cur));
    }
    const m = new THREE.Mesh(new THREE.TubeGeometry(path, 160, r, 10, false), mat);
    m.castShadow = true;
    return m;
  }
  const group = (name, ...kids) => { const g = new THREE.Group(); g.name = name; kids.forEach(k => g.add(k)); return g; };
  const part = (name, obj) => { obj.name = name; obj.userData.part = name; parts[name] = obj; return obj; };

  // ---------------------------------------------------------------- the fixed frame
  const base = box(52, 16, T, M.base);
  base.position.set(22, 0, T / 2);
  scene.add(part('base', base));

  const towers = group('towers'), bracesG = group('braces');
  for (const side of [-1, 1]) {
    const yc = side * (TOWER_INNER + T / 2);
    const t = box(7, T, TOWER_H, M.tower);
    t.position.set(PIVOT_X, yc, BASE_TOP + TOWER_H / 2);
    // the skewer hole, marked on both faces
    for (const f of [-1, 1]) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), M.black);
      hole.position.set(0, f * (T / 2 + 0.01), PZ - (BASE_TOP + TOWER_H / 2));
      hole.rotation.x = -f * Math.PI / 2;
      t.add(hole);
    }
    towers.add(t);
    // brace: right triangle, 9 up the tower and 5 across the base
    const legOut = 5, legUp = 9;
    const tri = braces === 'inner'
      ? poly([[0, 0], [-side * legOut, 0], [0, legUp]])
      : poly([[0, 0], [side * legOut, 0], [0, legUp]]);
    const b = plateYZ(tri, T, M.tower);
    const face = braces === 'inner' ? side * TOWER_INNER : side * (TOWER_INNER + T);
    b.position.set(PIVOT_X - 3.5, face, BASE_TOP);
    bracesG.add(b);
  }
  scene.add(part('towers', towers));
  scene.add(part('braces', bracesG));

  const skewer = new THREE.Group();
  const stick = mesh(new THREE.CylinderGeometry(0.15, 0.15, 12.4, 16), M.bamboo, EDGE, 40);
  skewer.add(stick);
  const tip = mesh(new THREE.ConeGeometry(0.15, 0.6, 16), M.bamboo, EDGE, 40);
  tip.position.y = 6.5;
  skewer.add(tip);
  skewer.position.set(PIVOT_X, -0.3, PZ);
  scene.add(part('skewer', skewer));

  // servo post and its brace
  const post = box(6, T, 8, M.tower);
  post.position.set(28.8, 3.4 + T / 2, BASE_TOP + 4);
  scene.add(part('servoPost', post));
  const pb = plateYZ(poly([[0, 0], [4, 0], [0, 6]]), T, M.tower);
  pb.position.set(31.2, 3.4 + T, BASE_TOP);
  scene.add(part('postBrace', pb));

  // SG90 servo: bottom face on the post's front face, shaft toward the viewer (-y)
  const servo = new THREE.Group();
  const yb = 3.4;                                   // post front face
  const body = box(2.22, 2.27, 1.18, M.servo, EDGE_DARK);
  body.position.set(SHAFT.x + 0.52, yb - 2.27 / 2, SHAFT.z);
  servo.add(body);
  const tabs = box(3.22, 0.25, 1.18, M.servo, EDGE_DARK);
  tabs.position.set(SHAFT.x + 0.52, yb - 1.715, SHAFT.z);
  servo.add(tabs);
  const tower = mesh(new THREE.CylinderGeometry(0.59, 0.59, 0.42, 32), M.servo, EDGE_DARK, 40);
  tower.position.set(SHAFT.x, yb - 2.27 - 0.21, SHAFT.z);
  servo.add(tower);
  const bump = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.42, 24), M.servo, EDGE_DARK, 40);
  bump.position.set(SHAFT.x + 0.85, yb - 2.27 - 0.21, SHAFT.z);
  servo.add(bump);
  const shaft = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.35, 20), M.white, EDGE_DARK, 40);
  shaft.position.set(SHAFT.x, yb - 2.69 - 0.17, SHAFT.z);
  servo.add(shaft);
  // the cable: brown, red, orange, leaving the far end and dropping to the base
  const cy = yb - 0.4, cx0 = SHAFT.x + 0.52 + 1.11;
  [[M.brown, -0.12], [M.red, 0], [M.orange, 0.12]].forEach(([mat, dz]) => {
    servo.add(tube([[cx0 - 0.1, cy, SHAFT.z + dz - 0.3], [cx0 + 0.8, cy, SHAFT.z + dz - 0.3], [cx0 + 1.4, cy - 1.0 + dz, 2.2], [cx0 + 1.6, cy - 3.5 + dz * 2, 0.55]], 0.045, mat, 0.6));
  });
  const plug = box(0.8, 0.25, 0.25, M.black, null);
  plug.position.set(cx0 + 1.6, cy - 3.5 - 0.35, 0.55);
  servo.add(plug);
  scene.add(part('servo', servo));

  // the single-arm horn, a pivoting group so the viewer can swing it
  const hornPivot = new THREE.Group();
  hornPivot.position.set(SHAFT.x, yb - 2.69 - 0.3, SHAFT.z);
  const hs = new THREE.Shape();
  hs.absarc(0, 0, 0.38, Math.PI * 0.5, Math.PI * 1.5, false);
  hs.lineTo(1.75, -0.16); hs.absarc(1.75, 0, 0.16, -Math.PI / 2, Math.PI / 2, false); hs.lineTo(0, 0.38);
  [0.75, 1.05, 1.4].forEach(r => hs.holes.push(circle(r, 0, 0.055)));
  const horn = plateXZ(hs, 0.15, M.white, EDGE_DARK);
  horn.position.y = 0.075;
  hornPivot.add(horn);
  scene.add(part('horn', hornPivot));

  // ---------------------------------------------------------------- the beam (pivots on the skewer)
  const beam = new THREE.Group();
  beam.name = 'beam';
  beam.position.set(PIVOT_X, 0, PZ);
  scene.add(beam);
  const bx = x => x - PIVOT_X;                       // track x -> beam-local x

  // the V track: one folded strip
  const W = WALL / Math.SQRT2, ti = T * Math.SQRT2 / 2;
  const vShape = poly([[0, 0], [W, W], [W - T / Math.SQRT2, W + T / Math.SQRT2], [0, T * Math.SQRT2], [-(W - T / Math.SQRT2), W + T / Math.SQRT2], [-W, W]]);
  void ti;
  const track = plateYZ(vShape, 44, [M.trackEnd, M.track]);
  track.position.set(bx(0), 0, FOLD);
  beam.add(part('track', track));

  const saddles = new THREE.Group();
  for (const xs of SADDLE.xs) {
    const sh = poly([[-SADDLE.w / 2, 0], [SADDLE.w / 2, 0], [SADDLE.w / 2, SADDLE.h], [0, SADDLE.h - SADDLE.notch], [-SADDLE.w / 2, SADDLE.h]]);
    if (xs === 29) sh.holes.push(circle(0, 0.7, 0.13));
    const s = plateYZ(sh, T, M.kraft);
    s.position.set(bx(xs) - T / 2, 0, STRAW_R);
    s.userData.x = xs;
    saddles.add(s);
  }
  beam.add(part('saddles', saddles));

  const straw = mesh(new THREE.CylinderGeometry(STRAW_R, STRAW_R, 10.5, 28, 1, true), M.straw, EDGE, 40);
  straw.position.set(0, 0, 0);
  beam.add(part('straw', straw));

  // sonar plate with its two holes, and the far wall
  const hz = (FOLD - (FOLD - 1.0)) + (BALL_Z - FOLD);         // hole height above the plate's bottom edge
  const plateBottom = FOLD - 1.0;
  const ps = poly([[-3.5, 0], [3.5, 0], [3.5, 9], [-3.5, 9]]);
  ps.holes.push(circle(-1.3, hz, 0.8)); ps.holes.push(circle(1.3, hz, 0.8));
  const plate = plateYZ(ps, T, M.plate);
  plate.position.set(bx(0) - T, 0, plateBottom);
  beam.add(part('sonarPlate', plate));
  const far = box(T, 7, 6, M.plate);
  far.position.set(bx(44) + T / 2, 0, plateBottom + 3);
  beam.add(part('farWall', far));

  // HC-SR04: board outside the plate, cans through the holes, pins pointing down
  const sonar = new THREE.Group();
  const sz0 = plateBottom + hz;
  const pcb = box(0.16, 4.5, 2.0, M.pcb, EDGE_DARK);
  pcb.position.set(bx(0) - T - 0.08, 0, sz0);
  sonar.add(pcb);
  for (const y of [-1.3, 1.3]) {
    const can = mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 36), M.silver, EDGE_DARK, 40);
    can.rotation.z = Math.PI / 2;
    can.position.set(bx(0) - T + 0.6, y, sz0);
    sonar.add(can);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.62, 32), M.canFace);
    face.rotation.y = Math.PI / 2;
    face.position.set(bx(0) - T + 1.205, y, sz0);
    sonar.add(face);
  }
  const xtal = box(0.18, 0.7, 0.32, M.silver, EDGE_DARK);
  xtal.position.set(bx(0) - T - 0.25, 0, sz0 + 0.55);
  sonar.add(xtal);
  const hdr = box(0.25, 1.05, 0.25, M.black, null);
  hdr.position.set(bx(0) - T - 0.08, 0, sz0 - 1.0 - 0.12);
  sonar.add(hdr);
  for (let i = 0; i < 4; i++) {
    const pin = box(0.06, 0.06, 0.8, M.gold, null);
    pin.position.set(bx(0) - T - 0.08, -0.381 + i * 0.254, sz0 - 1.0 - 0.4);
    sonar.add(pin);
  }
  beam.add(part('sonarBoard', sonar));

  // GY-521 on the outside of the front wall near x = 15
  const gyro = new THREE.Group();
  const gb = box(2.1, 1.6, 0.16, M.pcb, EDGE_DARK);
  gyro.add(gb);
  const chip = box(0.4, 0.4, 0.1, M.chip, null); chip.position.set(0, 0.1, 0.13); gyro.add(chip);
  const gh = box(2.0, 0.25, 0.25, M.black, null); gh.position.set(0, -0.6, 0.2); gyro.add(gh);
  for (let i = 0; i < 8; i++) { const p = box(0.06, 0.06, 0.6, M.gold, null); p.position.set(-0.889 + i * 0.254, -0.6, 0.55); gyro.add(p); }
  const tw = 1.75;                                  // halfway up the wall
  gyro.position.set(bx(15), -tw / Math.SQRT2 - 0.13 / Math.SQRT2, FOLD + tw / Math.SQRT2 - 0.13 / Math.SQRT2);
  gyro.rotation.x = Math.PI * 3 / 4;
  beam.add(part('gyro', gyro));

  // the ball
  const ball = mesh(new THREE.SphereGeometry(BALL_R, 48, 32), M.ball, null);
  ball.position.set(bx(15), 0, BALL_Z);
  beam.add(part('ball', ball));

  // MAX7219 module on the front tower's outer face, below the skewer, showing a smile
  const matrix = new THREE.Group();
  const mpcb = box(3.3, 0.16, 3.3, M.pcb, EDGE_DARK);
  matrix.add(mpcb);
  const mblk = box(3.2, 0.6, 3.2, M.black, EDGE_DARK);
  mblk.position.y = -0.38;
  matrix.add(mblk);
  const dot = new THREE.CircleGeometry(0.15, 16);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const on = SMILE[r] & (0x80 >> c);
    const d = new THREE.Mesh(dot, on ? M.ledOn : M.ledOff);
    d.rotation.x = Math.PI / 2;
    d.position.set(-1.4 + c * 0.4, -0.69, 1.4 - r * 0.4);
    matrix.add(d);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
    const p = box(0.55, 0.06, 0.06, M.gold, null);
    p.position.set(s * (1.65 + 0.27), 0, -0.508 + i * 0.254);
    matrix.add(p);
  }
  matrix.position.set(PIVOT_X, -(TOWER_INNER + T) - 0.1, PZ - 2.8);
  scene.add(part('matrix', matrix));

  // the push-rod: rebuilt whenever the beam or horn moves
  const rodMat = M.silver;
  const S = { THREE, scene, parts, beam, hornPivot, braces, M, rodMat, tube, rod: null };
  S.beamToWorld = (x, y, z) => beam.localToWorld(new THREE.Vector3(bx(x), y, z));
  S.setTilt = deg => setTilt(S, deg);
  setTilt(S, 0);
  return S;
}

// Tilt the beam (degrees, + rolls the ball away from the sonar) and swing the horn to match.
export function setTilt(S, deg) {
  const { THREE, beam, hornPivot } = S;
  const th = deg * Math.PI / 180;
  beam.rotation.y = th;
  beam.updateMatrixWorld(true);
  // rod top: the hook through the x = 29 saddle; the horn turns so its hole sits right under it
  const topLocal = new THREE.Vector3(29 - PIVOT_X, 0, ROD_HOLE_Z);
  const top = beam.localToWorld(topLocal.clone());
  const rest = new THREE.Vector3(29, 0, PZ + ROD_HOLE_Z);
  const dz = top.z - rest.z;
  const phi = Math.asin(Math.max(-1, Math.min(1, dz / HORN_HOLE)));
  hornPivot.rotation.y = -phi;
  hornPivot.updateMatrixWorld(true);
  const hole = new THREE.Vector3(HORN_HOLE, 0, 0).applyMatrix4(hornPivot.matrixWorld);
  if (S.rod) { S.scene.remove(S.rod); S.rod.traverse(o => o.geometry && o.geometry.dispose()); }
  const hookIn = top.clone().add(new THREE.Vector3(-0.5, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), th));
  const hookOut = top.clone().add(new THREE.Vector3(0.6, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), th));
  const hookEnd = hookOut.clone().add(new THREE.Vector3(0, 0, -0.35));
  const pts = [
    [hole.x, hole.y + 0.3, hole.z - 0.3], [hole.x, hole.y + 0.3, hole.z], [hole.x, hole.y - 0.3, hole.z], [hole.x - 0.05, hole.y - 0.35, hole.z + 0.4],
    [hookIn.x, hookIn.y - 0.05, hookIn.z - 0.45], [hookIn.x, hookIn.y, hookIn.z], [hookOut.x, hookOut.y, hookOut.z], [hookEnd.x, hookEnd.y, hookEnd.z],
  ];
  S.rod = S.tube(pts, 0.065, S.rodMat, 0.18);
  S.rod.name = 'pushRod'; S.rod.userData.part = 'pushRod';
  S.parts.pushRod = S.rod;
  S.scene.add(S.rod);
  return S.rod;
}

// One build step: which parts show, which are new, and the beam's pose.
export function applyStep(S, id) {
  const step = STEPS.find(s => s.id === id) || STEPS[STEPS.length - 1];
  const { THREE, beam, parts } = S;
  const show = step.show === 'all' ? Object.keys(parts) : step.show;
  for (const [name, obj] of Object.entries(parts)) obj.visible = show.includes(name) || (step.show === 'all');
  if (step.id !== 'hero') parts.ball.visible = show.includes('ball');
  setTilt(S, 0);
  parts.pushRod.visible = show.includes('pushRod') || step.show === 'all';
  beam.rotation.set(0, 0, 0);
  beam.position.set(PIVOT_X, 0, PZ);
  if (step.pose === 'flipped') beam.rotation.x = Math.PI;
  beam.updateMatrixWorld(true);
  void THREE;
  return step;
}
