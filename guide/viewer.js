// The finished Fulcrum in 3D for the guide page: drag to turn it, scroll or pinch to zoom.
// It slowly turns on its own until you touch it, and the beam makes small corrective tilts
// while the ball settles toward the middle. Without WebGL (or if three.js can't load) it shows
// the still picture instead. mountViewer(container, { heroSrc }) -> { dispose } | null
import { buildScene, setTilt, PIVOT_X } from './model.js';

const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const ORBIT_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(s);
  });
}

function webglWorks() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch (e) { return false; }
}

export async function mountViewer(container, { heroSrc = 'img/hero.png', alt = 'The finished Fulcrum robot' } = {}) {
  const still = () => {
    const img = document.createElement('img');
    img.src = heroSrc; img.alt = alt; img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'contain';
    container.replaceChildren(img);
    return null;
  };
  if (!webglWorks()) return still();
  try {
    if (!window.THREE) await loadScript(THREE_URL);
    if (!window.THREE.OrbitControls) await loadScript(ORBIT_URL);
  } catch (e) { return still(); }
  const THREE = window.THREE;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const S = buildScene(THREE, {});
  const { scene, parts } = S;
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd2bf9f, 0.58);
  hemi.position.set(0, 0, 1);
  const key = new THREE.DirectionalLight(0xffffff, 0.86);
  key.position.set(12, -20, 75); key.target.position.set(22, 0, 6);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
  key.shadow.bias = -0.0004;
  const fill = new THREE.DirectionalLight(0xffffff, 0.32); fill.position.set(70, -30, 30);
  const rim = new THREE.DirectionalLight(0xffffff, 0.18); rim.position.set(10, 60, 40);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.12 }));
  ground.receiveShadow = true; ground.position.set(22, 0, 0);
  scene.add(hemi, key, key.target, fill, rim, ground);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) { return still(); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.display = 'block'; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.touchAction = 'none';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${alt}. Drag to turn it.`);
  container.replaceChildren(canvas);

  const camera = new THREE.PerspectiveCamera(28, 1, 1, 1000);
  camera.up.set(0, 0, 1);
  const target = new THREE.Vector3(22, 0, 8.5);
  const VIEW = new THREE.Vector3(-0.42, -1.0, 0.42).normalize();
  camera.position.copy(target).addScaledVector(VIEW, 84);
  let touched = false;
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 55; controls.maxDistance = 220;
  controls.maxPolarAngle = Math.PI / 2 - 0.06;      // stay above the table
  controls.autoRotate = !reduced; controls.autoRotateSpeed = 0.55;
  controls.addEventListener('start', () => { controls.autoRotate = false; touched = true; });

  function resize() {
    const w = container.clientWidth || 600, h = container.clientHeight || 375;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!touched) {   // back off on tall or narrow screens so the whole robot stays in view
      const dist = 84 * Math.pow(Math.max(1, 1.6 / camera.aspect), 0.85);
      const dir = camera.position.clone().sub(controls.target).normalize();
      camera.position.copy(controls.target).addScaledVector(dir, dist);
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // a little balancing act: the ball is nudged, then the beam tilts against it until it settles
  const ball = parts.ball;
  let lastTilt = NaN, lastX = ball.position.x, visible = true, raf = 0, t0 = performance.now();
  function pose(t) {
    if (reduced) return { tilt: 2, x: 16 };
    const tc = t % 8, A = 9 * Math.exp(-0.45 * tc), w = 2.2;
    const x = 22 + A * Math.sin(w * tc), v = A * (w * Math.cos(w * tc) - 0.45 * Math.sin(w * tc));
    const tilt = Math.max(-7, Math.min(7, -(0.6 * (x - 22) + 0.35 * v)));
    return { tilt, x };
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    const { tilt, x } = pose((now - t0) / 1000);
    if (Math.abs(tilt - lastTilt) > 0.03 || Number.isNaN(lastTilt)) { setTilt(S, tilt); lastTilt = tilt; }
    ball.position.x = x - PIVOT_X;
    ball.rotation.y += (ball.position.x - lastX) / 2;
    lastX = ball.position.x;
    controls.update();
    renderer.render(scene, camera);
  }
  const io = new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); });
  io.observe(container);
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); controls.dispose(); renderer.dispose();
    },
  };
}
