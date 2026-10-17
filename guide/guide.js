// Fulcrum guide: narration (one step or the whole walkthrough), progress, contents, drawings.
const DUR = window.FULCRUM_DURATIONS || {};
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
};
const fmt = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ steps and contents
const steps = [...document.querySelectorAll('section.step[data-audio]')];
const order = steps.map(s => s.dataset.audio);
const titleOf = id => document.querySelector(`#${id} h3`).textContent;
const partOf = sec => { let p = sec.previousElementSibling; while (p && !p.classList.contains('part-head')) p = p.previousElementSibling; return p; };

function buildToc() {
  const box = $('toc-lists');
  const groups = [{ title: 'Start here', items: [] }];
  for (const sec of steps) {
    const ph = partOf(sec);
    const name = ph ? `${ph.querySelector('.pk').textContent} · ${ph.querySelector('h2').textContent}` : 'Start here';
    if (groups[groups.length - 1].title !== name) groups.push({ title: name, items: [] });
    groups[groups.length - 1].items.push(sec);
  }
  for (const g of groups) {
    const h = document.createElement('h4'); h.textContent = g.title; box.append(h);
    const ol = document.createElement('ol');
    for (const sec of g.items) {
      const li = document.createElement('li'), a = document.createElement('a');
      a.href = `#${sec.id}`; a.dataset.id = sec.id;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = sec.dataset.n;
      const t = document.createElement('span'); t.textContent = titleOf(sec.id);
      const ok = document.createElement('span'); ok.className = 'ok'; ok.textContent = '✓';
      a.append(n, t, ok); li.append(a); ol.append(li);
    }
    box.append(ol);
  }
  const extra = document.createElement('h4'); extra.textContent = 'Reference'; box.append(extra);
  const ol = document.createElement('ol');
  for (const [id, label] of [['trouble', 'Troubleshooting'], ['curious', 'How it works'], ['files', "What's in the folder"]]) {
    const li = document.createElement('li'), a = document.createElement('a'); a.href = `#${id}`;
    const n = document.createElement('span'); n.className = 'n'; n.textContent = '';
    const t = document.createElement('span'); t.textContent = label;
    a.append(n, t, document.createElement('span')); li.append(a); ol.append(li);
  }
  box.append(ol);
}
buildToc();
$('toc-toggle').addEventListener('click', () => {
  const open = $('toc').classList.toggle('open');
  $('toc-toggle').setAttribute('aria-expanded', String(open));
});
$('toc-lists').addEventListener('click', e => { if (e.target.closest('a')) $('toc').classList.remove('open'); });

// the step in view gets marked in the contents
const io = new IntersectionObserver(entries => {
  for (const en of entries) if (en.isIntersecting) {
    for (const a of document.querySelectorAll('.toc a')) a.classList.toggle('here', a.dataset.id === en.target.id);
  }
}, { rootMargin: '-30% 0px -60% 0px' });
steps.forEach(s => io.observe(s));

// ------------------------------------------------------------------ done marks and checklist
const done = store.get('fulcrum-done', {});
function refreshProgress() {
  const n = order.filter(id => done[id]).length;
  $('prog-bar').style.width = `${n / order.length * 100}%`;
  $('prog-label').textContent = `${n} of ${order.length} steps done`;
  for (const a of document.querySelectorAll('.toc a[data-id]')) a.classList.toggle('done', !!done[a.dataset.id]);
}
for (const cb of document.querySelectorAll('input[data-done]')) {
  cb.checked = !!done[cb.dataset.done];
  cb.addEventListener('change', () => { done[cb.dataset.done] = cb.checked; store.set('fulcrum-done', done); refreshProgress(); });
}
refreshProgress();
const kit = store.get('fulcrum-kit', {});
for (const cb of document.querySelectorAll('input[data-kit]')) {
  cb.checked = !!kit[cb.dataset.kit];
  cb.addEventListener('change', () => { kit[cb.dataset.kit] = cb.checked; store.set('fulcrum-kit', kit); });
}

// ------------------------------------------------------------------ narration
const audio = $('audio');
let current = null, sequence = false;
for (const b of document.querySelectorAll('button.listen')) {
  const id = b.dataset.audio;
  b.innerHTML = '';
  const ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = '▶';
  const lab = document.createElement('span'); lab.textContent = 'Listen';
  const dur = document.createElement('span'); dur.className = 'dur'; dur.textContent = DUR[id] ? fmt(DUR[id]) : '';
  b.append(ico, lab, dur);
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => {
    if (current === id && !audio.paused) { audio.pause(); return; }
    if (current === id && audio.paused) { audio.play(); return; }
    sequence = false; play(id);
  });
}
const total = order.reduce((s, id) => s + (DUR[id] || 0), 0);
if (total) $('play-all').lastChild.textContent = ` Play the narrated walkthrough (${Math.round(total / 60)} min)`;

function play(id) {
  current = id;
  audio.src = `audio/${id}.mp3`;
  audio.play().catch(() => { });
  const sec = document.getElementById(id);
  for (const s of steps) s.classList.toggle('playing', s === sec);
  if (sequence) sec.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  $('player').hidden = false;
  $('pl-title').textContent = `${sec.dataset.n} · ${titleOf(id)}`;
  $('pl-sub').textContent = sequence ? `walkthrough · step ${order.indexOf(id) + 1} of ${order.length}` : 'this step';
  syncButtons();
}
function syncButtons() {
  const playing = !audio.paused;
  for (const b of document.querySelectorAll('button.listen')) {
    const on = b.dataset.audio === current && playing;
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.ico').textContent = on ? '❚❚' : '▶';
  }
  $('pl-pp').textContent = playing ? '❚❚' : '▶';
  $('pl-pp').setAttribute('aria-label', playing ? 'Pause' : 'Play');
}
audio.addEventListener('play', syncButtons);
audio.addEventListener('pause', syncButtons);
audio.addEventListener('timeupdate', () => { if (audio.duration) $('pl-bar').style.width = `${audio.currentTime / audio.duration * 100}%`; });
audio.addEventListener('ended', () => {
  const i = order.indexOf(current);
  if (sequence && i >= 0 && i + 1 < order.length) play(order[i + 1]);
  else { syncButtons(); for (const s of steps) s.classList.remove('playing'); }
});
$('play-all').addEventListener('click', () => { sequence = true; play(order[0]); });
$('pl-pp').addEventListener('click', () => { if (audio.paused) audio.play(); else audio.pause(); });
$('pl-next').addEventListener('click', () => { const i = order.indexOf(current); if (i + 1 < order.length) play(order[i + 1]); });
$('pl-prev').addEventListener('click', () => { const i = order.indexOf(current); if (i > 0) play(order[i - 1]); });
$('pl-close').addEventListener('click', () => { audio.pause(); $('player').hidden = true; sequence = false; for (const s of steps) s.classList.remove('playing'); });

// ------------------------------------------------------------------ the remote
(function drawRemote() {
  const svg = $('remote-svg'), NS = 'http://www.w3.org/2000/svg';
  const el = (t, a, txt) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (txt) e.textContent = txt; svg.append(e); return e; };
  el('rect', { x: 20, y: 6, width: 160, height: 388, rx: 26, fill: '#1d1f22', stroke: '#3a3d42' });
  el('rect', { x: 92, y: 14, width: 16, height: 6, rx: 3, fill: '#55595f' });
  const rows = [['POWER', 'VOL+', 'FUNC/STOP'], ['|◀◀', '▶❚❚', '▶▶|'], ['▼', 'VOL−', '▲'], ['0', 'EQ', 'ST/REPT'], ['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']];
  const used = new Set(['POWER', 'FUNC/STOP', '|◀◀', '▶❚❚', '▶▶|', '▼', 'VOL−', '▲', 'VOL+', '0', 'EQ', 'ST/REPT', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  rows.forEach((r, ri) => r.forEach((lab, ci) => {
    const cx = 56 + ci * 44, cy = 52 + ri * 48;
    el('circle', { cx, cy, r: 17, fill: lab === 'POWER' ? '#c62f2f' : '#33363b', stroke: used.has(lab) ? '#e8622d' : '#4a4e54', 'stroke-width': used.has(lab) ? 1.5 : 1 });
    el('text', { x: cx, y: cy + (lab.length > 4 ? 3 : 4), 'text-anchor': 'middle', fill: '#f2f2f2', 'font-size': lab.length > 5 ? 6.5 : lab.length > 3 ? 8 : 11, 'font-family': 'IBM Plex Mono, monospace' }, lab);
  }));
  el('text', { x: 100, y: 384, 'text-anchor': 'middle', fill: '#8a8f96', 'font-size': 9, 'font-family': 'IBM Plex Mono, monospace', 'letter-spacing': 1.5 }, 'ELEGOO');
})();

// ------------------------------------------------------------------ the LED faces (same bitmaps as the firmware)
(function drawFaces() {
  const face = (look, mouth) => {
    if (mouth === 'sleep') return [0, 0, 0x66, 0, 0, 0x18, 0, 0];
    if (mouth === 'question') return [0x3C, 0x42, 0x02, 0x0C, 0x10, 0x00, 0x10, 0x00];
    const m = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const r of [1, 2]) for (const c of [1, 2, 5, 6]) { const cc = c + look; if (cc >= 0 && cc < 8) m[r] |= 0x80 >> cc; }
    if (mouth === 'smile') { m[4] |= 0x81; m[5] |= 0x42; m[6] |= 0x3C; } else if (mouth === 'flat') m[5] |= 0x3C; else { m[4] |= 0x18; m[5] |= 0x24; m[6] |= 0x18; }
    return m;
  };
  const items = [[face(0, 'sleep'), 'Resting'], [face(-1, 'flat'), 'Working (eyes follow the ball)'], [face(0, 'smile'), 'Holding steady'], [face(1, 'o'), 'Whoa: ball far off'], [face(0, 'question'), 'No brain loaded']];
  const NS = 'http://www.w3.org/2000/svg';
  for (const [bits, label] of items) {
    const fig = document.createElement('figure');
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 88 88'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label);
    const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('width', 88); bg.setAttribute('height', 88); bg.setAttribute('rx', 6); bg.setAttribute('fill', '#141414'); svg.append(bg);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const d = document.createElementNS(NS, 'circle');
      d.setAttribute('cx', 9 + c * 10); d.setAttribute('cy', 9 + r * 10); d.setAttribute('r', 3.6);
      d.setAttribute('fill', bits[r] & (0x80 >> c) ? '#ff3b2f' : '#3a1512'); svg.append(d);
    }
    const cap = document.createElement('figcaption'); cap.textContent = label;
    fig.append(svg, cap); $('faces').append(fig);
  }
})();

// ------------------------------------------------------------------ equations (native MathML via KaTeX)
for (const el of document.querySelectorAll('.math[data-tex]')) {
  if (window.katex) { try { window.katex.render(el.dataset.tex, el, { output: 'mathml', displayMode: true, throwOnError: false }); continue; } catch (e) { } }
  el.textContent = el.dataset.tex;
  el.style.fontFamily = 'var(--font-mono)'; el.style.fontSize = '13px';
}

// ------------------------------------------------------------------ the cut templates
// Inside claude.ai a page can't open files from links; it asks the viewer to save one instead.
// Opened from the fulcrum folder (local server), a plain file link works.
$('save-templates').addEventListener('click', async () => {
  const note = $('save-note');
  if (!window.claude || !window.claude.use) { window.open('fulcrum-cut-templates.pdf', '_blank', 'noopener'); return; }
  const dl = await window.claude.use('downloads');
  if (!dl) { note.textContent = "Saving files isn't available in this view. Use Open them on GitHub, or the copy in the fulcrum folder (guide/fulcrum-cut-templates.pdf)."; return; }
  try {
    const blob = await (await fetch('fulcrum-cut-templates.pdf')).blob();
    await dl.save({ filename: 'fulcrum-cut-templates.pdf', data: blob });
    note.textContent = 'Saved. Print it at 100% (actual size) and check the 2 inch bar.';
  } catch (e) {
    if (e && e.code === 'declined') return;
    note.textContent = "That didn't save. Use Open them on GitHub, or the copy in the fulcrum folder (guide/fulcrum-cut-templates.pdf).";
  }
});

// ------------------------------------------------------------------ the 3D robot (falls back to the picture)
if (!reduced) import('./viewer.js').then(async m => {
  const box = $('viewer');
  const r = await m.mountViewer(box, { heroSrc: 'img/hero-wide.png' });
  if (r) { const h = document.createElement('span'); h.className = 'vhint'; h.textContent = 'drag to turn it'; box.append(h); }
}).catch(() => { });
