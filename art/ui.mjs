// The window kit: stone frames, crimson title ribbons, parchment, buttons and stage maps.
// Pieces are small and shown at double size. They go into one stylesheet as embedded images,
// so the whole interface arrives with a single request and never flickers in.
import { encodePNG } from './raster.mjs';
import { rnd, lerp, TAU } from './rig.mjs';

const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
class P {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  set(x, y, c) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const r = typeof c === 'string' ? hex(c) : c, i = (Math.floor(y) * this.w + Math.floor(x)) * 4; this.d[i] = r[0]; this.d[i + 1] = r[1]; this.d[i + 2] = r[2]; this.d[i + 3] = 255; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  box(x, y, w, h, c) { this.rect(x, y, w, 1, c); this.rect(x, y + h - 1, w, 1, c); this.rect(x, y, 1, h, c); this.rect(x + w - 1, y, 1, h, c); }
  uri() { return 'data:image/png;base64,' + encodePNG(this.d, this.w, this.h).toString('base64'); }
}
const speck = (p, x0, y0, w, h, cols, seed) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.set(x0 + x, y0 + y, cols[Math.floor(Math.pow(rnd(seed + x * 13, y * 7 + seed), 1.8) * cols.length)]); };

// A squared meander in the corner of a frame, the small detail that makes it feel carved.
function meander(p, x, y, sx, sy, c, d) {
  const dots = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [2, 2], [3, 2], [4, 2], [2, 3], [2, 4], [4, 3]];
  for (const [i, j] of dots) { p.set(x + sx * i, y + sy * j, c); p.set(x + sx * (i + 1), y + sy * (j + 1), d); }
}
function stoneFrame(size = 36, corner = 14) {
  const p = new P(size, size);
  p.rect(0, 0, size, size, '#141318');
  p.box(0, 0, size, size, '#050406');
  p.box(1, 1, size - 2, size - 2, '#5c5a64');
  p.rect(1, size - 2, size - 2, 1, '#2c2a32'); p.rect(size - 2, 1, 1, size - 2, '#2c2a32');
  p.box(2, 2, size - 4, size - 4, '#35333c');
  p.box(3, 3, size - 6, size - 6, '#0a090d');
  const c = '#8a8892', d = '#26242c';
  meander(p, 5, 5, 1, 1, c, d); meander(p, size - 6, 5, -1, 1, c, d); meander(p, 5, size - 6, 1, -1, c, d); meander(p, size - 6, size - 6, -1, -1, c, d);
  void corner;
  return p;
}
function inset(size = 32) {
  const p = new P(size, size);
  p.rect(0, 0, size, size, '#100f13');
  p.box(0, 0, size, size, '#3e3c46');
  p.rect(0, size - 1, size, 1, '#54525c'); p.rect(size - 1, 0, 1, size, '#54525c');
  p.box(1, 1, size - 2, size - 2, '#08070a');
  const c = '#4e4c56', d = '#1c1a22';
  meander(p, 3, 3, 1, 1, c, d); meander(p, size - 4, 3, -1, 1, c, d); meander(p, 3, size - 4, 1, -1, c, d); meander(p, size - 4, size - 4, -1, -1, c, d);
  return p;
}
function parchment(size = 32) {
  const p = new P(size, size);
  speck(p, 0, 0, size, size, ['#b39868', '#ad9262', '#b89e70', '#a68b5a', '#c2a97c'], 9);
  p.box(0, 0, size, size, '#2c1f10');
  p.box(1, 1, size - 2, size - 2, '#7a6238');
  const c = '#5e4a28', d = '#d0ba8c';
  meander(p, 3, 3, 1, 1, c, d); meander(p, size - 4, 3, -1, 1, c, d); meander(p, 3, size - 4, 1, -1, c, d); meander(p, size - 4, size - 4, -1, -1, c, d);
  return p;
}
// Dark red with twisting thorns: the strip behind every window title.
function thorns() {
  const w = 48, h = 22, p = new P(w, h);
  speck(p, 0, 0, w, h, ['#160608', '#1a0709', '#12050a', '#1f080a'], 3);
  const vine = (x0, y0, sl, c) => { for (let i = 0; i < 60; i++) { const x = (x0 + i) % w, y = y0 + Math.round(Math.sin((i + x0) / 48 * TAU * 2) * 4) + (i * sl) % h; p.set(x, ((y % h) + h) % h, c); } };
  vine(0, 4, 0, '#52121a'); vine(12, 15, 0, '#3e0e14');
  for (let i = 0; i < 26; i++) { const x = Math.floor(rnd(i, 1) * w), y = Math.floor(rnd(i, 2) * h); p.set(x, y, '#5c161e'); p.set(x + 1, y - 1, '#2a0a0e'); }
  p.rect(0, 0, w, 1, '#44161a'); p.rect(0, h - 1, w, 1, '#08030a');
  return p;
}
function ribbon() {
  const w = 40, h = 22, cap = 12, p = new P(w, h);
  const mid = ['#7c1820', '#961e24', '#a8242a', '#b42a2c', '#b42a2c', '#a8242a', '#961e24', '#7c1820'];
  const fill = (x0, x1) => { for (let y = 1; y < h - 1; y++) { const c = mid[Math.floor((y - 1) / (h - 2) * mid.length)]; p.rect(x0, y, x1 - x0, 1, c); } };
  fill(0, w);
  p.rect(0, 0, w, 1, '#d09a38'); p.rect(0, 1, w, 1, '#6e3a12'); p.rect(0, h - 1, w, 1, '#3c1c08'); p.rect(0, h - 2, w, 1, '#c08428');
  // Chevrons at both ends, the left and right caps of the ribbon.
  const clear = (x, y) => { const i = (y * w + x) * 4; p.d[i + 3] = 0; };
  for (let y = 0; y < h; y++) {
    const d = Math.abs(y - (h - 1) / 2), edge = Math.round(d * .9);
    for (let x = 0; x < edge; x++) { clear(x, y); clear(w - 1 - x, y); }
    p.set(edge, y, '#e8b850'); p.set(w - 1 - edge, y, '#e8b850');
    for (const off of [3, 6]) { const o = edge + off; if (o < cap) { p.set(o, y, off === 3 ? '#f4c860' : '#7a4a12'); p.set(w - 1 - o, y, off === 3 ? '#f4c860' : '#7a4a12'); } }
  }
  return p;
}
function button(top, mid, bot, hi, lo) {
  const s = 12, p = new P(s, s);
  for (let y = 0; y < s; y++) p.rect(0, y, s, 1, y < 4 ? top : y < 8 ? mid : bot);
  p.box(0, 0, s, s, '#060508');
  p.rect(1, 1, s - 2, 1, hi); p.rect(1, 1, 1, s - 2, hi);
  p.rect(1, s - 2, s - 2, 1, lo); p.rect(s - 2, 1, 1, s - 2, lo);
  return p;
}
function folder(top, mid, line, hi) {
  const s = 12, p = new P(s, s);
  p.rect(0, 0, s, s, mid); p.rect(0, 0, s, 5, top);
  p.box(0, 0, s, s, line); p.rect(1, 1, s - 2, 1, hi); p.rect(1, 1, 1, s - 2, hi);
  return p;
}
function ring(c1, c2, c3, dk) {
  const s = 30, p = new P(s, s), m = (s - 1) / 2;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - m, y - m), o = Math.max(Math.abs(x - m), Math.abs(y - m)) * .8 + d * .35;
    if (o > 15) continue;
    p.set(x, y, o > 14 ? '#060508' : o > 12.8 ? (x + y < s ? c1 : c3) : o > 12 ? c2 : dk);
  }
  return p;
}
function closeX() {
  const s = 13, p = new P(s, s);
  p.rect(0, 0, s, s, '#7a2c10'); p.box(0, 0, s, s, '#060508'); p.box(1, 1, s - 2, s - 2, '#e0a040'); p.rect(1, s - 2, s - 2, 1, '#7a4a12'); p.rect(s - 2, 1, 1, s - 2, '#7a4a12');
  for (let i = 3; i < s - 3; i++) { p.set(i, i, '#f8e0b0'); p.set(s - 1 - i, i, '#f8e0b0'); p.set(i + 1, i, '#3a1408'); }
  return p;
}
function crest(c, d) {
  // The little mount that sits on top of a window, holding its emblem.
  const w = 40, h = 20, p = new P(w, h);
  for (let x = 0; x < w; x++) { const k = Math.abs(x - w / 2) / (w / 2), top = Math.round(4 + k * k * 12); for (let y = top; y < h; y++) p.set(x, y, y === top ? c : d); }
  for (let i = 0; i < 4; i++) { p.set(2 + i * 3, 14 - i, '#6e6c76'); p.set(w - 3 - i * 3, 14 - i, '#6e6c76'); }
  return p;
}
function pip(on) { const s = 4, p = new P(s, s); p.rect(0, 0, s, s, '#060508'); p.rect(1, 1, 2, 2, on ? '#ffd24a' : '#2a2830'); if (on) p.set(1, 1, '#fff4c0'); return p; }
function check() { const p = new P(11, 9), c = '#7cf25c', d = '#0c2a0c'; for (const [x, y] of [[0, 4], [1, 5], [2, 6], [3, 7], [4, 6], [5, 5], [6, 4], [7, 3], [8, 2], [9, 1], [10, 0]]) { p.rect(x, y, 1, 2, c); p.set(x, y + 2, d); } return p; }
function lock() { const p = new P(9, 11), c = '#a8a4b4', d = '#2a2830'; p.box(2, 0, 5, 5, c); p.rect(0, 4, 9, 7, d); p.box(0, 4, 9, 7, c); p.rect(4, 6, 1, 3, '#ffd24a'); return p; }
function stone() { const s = 32, p = new P(s, s); speck(p, 0, 0, s, s, ['#1b1a1f', '#1d1c21', '#191820', '#1f1e24', '#17161c'], 21); for (let i = 0; i < 40; i++) { const x = Math.floor(rnd(i, 5) * s), y = Math.floor(rnd(i, 6) * s); p.set(x, y, '#26252c'); } return p; }
function desktop() { const s = 64, p = new P(s, s); speck(p, 0, 0, s, s, ['#0b0a0f', '#0c0b10', '#0a090d', '#0d0c12'], 33); for (let i = 0; i < 90; i++) { const x = Math.floor(rnd(i, 7) * s), y = Math.floor(rnd(i, 8) * s); p.set(x, y, '#121118'); } return p; }

// One image per piece, turned into CSS custom properties.
export function uiStyles() {
  const v = {
    frame: stoneFrame(), inset: inset(), parch: parchment(), thorns: thorns(), ribbon: ribbon(), stone: stone(), desk: desktop(),
    'btn': button('#4a4852', '#3e3c46', '#34323b', '#7a7884', '#1e1c24'),
    'btn-red': button('#7e2a1a', '#6c2214', '#5a1a10', '#b85a3a', '#2c0a06'),
    'btn-teal': button('#1e5c6c', '#184e5e', '#123e4c', '#4c9cac', '#06202a'),
    'btn-gold': button('#f0b844', '#dc9c2c', '#c0801c', '#fff0b0', '#6e3e0a'),
    'btn-off': button('#2c2b32', '#27262c', '#222126', '#3e3c46', '#121116'),
    'tab-on': folder('#e09838', '#c47a24', '#3a1c08', '#ffd080'),
    'tab-off': folder('#5a2a14', '#44200e', '#160a06', '#8a4a24'),
    ring: ring('#f4c860', '#8a5a1c', '#7a4a12', '#2a0c0c'),
    'ring-on': ring('#fff0a8', '#e8a030', '#c08428', '#7a1c14'),
    close: closeX(), 'crest': crest('#6e6c76', '#26242c'),
    'pip-on': pip(true), 'pip-off': pip(false), check: check(), lock: lock(),
  };
  const lines = Object.entries(v).map(([k, p]) => `--ui-${k}:url("${p.uri()}");`);
  return `:root{${lines.join('')}}\n`;
}

// ---------------------------------------------------------------- the parchment stage maps
export const MAP = { w: 176, h: 148 };
// Six stops wandering up the sheet. The last one is the boss.
export const MAP_NODES = [[28, 128], [70, 116], [44, 88], [100, 78], [72, 48], [132, 26]];
const INK = '#4a361a', INK2 = '#7a6238', WASH = '#a48a58';
function line(p, x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 1; for (let i = 0; i <= n; i++) p.set(Math.round(lerp(x0, x1, i / n)), Math.round(lerp(y0, y1, i / n)), c); }
const STAMP = {
  reed(p, x, y) { for (const d of [-2, 0, 2]) { line(p, x + d, y, x + d + 1, y - 5, INK2); p.set(x + d + 1, y - 6, INK); } },
  wave(p, x, y) { for (let i = 0; i < 9; i++) p.set(x + i, y + (i % 4 < 2 ? 0 : 1), INK2); },
  mast(p, x, y) { line(p, x, y, x + 2, y - 11, INK); line(p, x - 3, y - 7, x + 5, y - 8, INK); },
  mesa(p, x, y) { for (let i = 0; i < 14; i++) { const t = i < 3 ? 3 - i : i > 10 ? i - 10 : 0; p.set(x + i, y - 7 + t, INK); } line(p, x, y - 4, x - 2, y, INK); line(p, x + 13, y - 4, x + 15, y, INK); for (let i = 1; i < 13; i += 3) line(p, x + i, y - 5, x + i, y - 2, INK2); },
  rig(p, x, y) { line(p, x - 3, y, x, y - 11, INK); line(p, x + 3, y, x, y - 11, INK); line(p, x - 2, y - 4, x + 2, y - 4, INK2); line(p, x - 1, y - 8, x + 1, y - 8, INK2); },
  tree(p, x, y) { line(p, x, y, x, y - 5, INK); line(p, x, y - 5, x - 4, y - 9, INK); line(p, x, y - 5, x + 4, y - 9, INK); line(p, x - 2, y - 7, x - 2, y - 10, INK2); line(p, x + 2, y - 7, x + 2, y - 10, INK2); line(p, x, y - 4, x + 2, y - 7, INK2); },
  grave(p, x, y) { line(p, x, y, x, y - 6, INK); line(p, x - 2, y - 4, x + 2, y - 4, INK); },
  dune(p, x, y) { for (let i = 0; i < 18; i++) { const h = Math.round(Math.sin(i / 18 * Math.PI) * 4); p.set(x + i, y - h, INK2); if (i % 3 === 0) p.set(x + i, y - h + 2, WASH); } },
  shard(p, x, y) { line(p, x - 2, y, x, y - 9, INK); line(p, x + 2, y, x, y - 9, INK); line(p, x, y - 9, x, y - 2, INK2); },
  spire(p, x, y) { line(p, x - 3, y, x, y - 13, INK); line(p, x + 3, y, x, y - 13, INK); for (let i = 2; i < 12; i += 3) p.set(x + 1, y - i, INK2); },
  crater(p, x, y) { for (let a = 0; a < 26; a++) { const q = a / 26 * TAU; p.set(Math.round(x + Math.cos(q) * 6), Math.round(y + Math.sin(q) * 2.4), INK); } p.set(x, y, '#a03c1c'); p.set(x + 1, y, '#a03c1c'); },
  hill(p, x, y) { for (let i = 0; i < 12; i++) p.set(x + i, y - Math.round(Math.sin(i / 12 * Math.PI) * 3), INK2); },
};
const THEME = [['reed', 'wave', 'wave', 'mast', 'hill'], ['mesa', 'rig', 'hill', 'mesa', 'hill'], ['tree', 'tree', 'grave', 'grave', 'hill'], ['dune', 'dune', 'shard', 'shard', 'hill'], ['spire', 'crater', 'spire', 'hill', 'crater']];
export function renderMap(r) {
  const { w, h } = MAP, p = new P(w, h);
  speck(p, 0, 0, w, h, ['#c9b083', '#c4aa7c', '#ceb68a', '#bea474', '#d4bd94'], 40 + r);
  // Soft stains and darker edges, the look of an old sheet.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const e = Math.min(x, y, w - 1 - x, h - 1 - y), n = rnd(x >> 3, (y >> 3) + r * 9);
    if (e < 6 - n * 4 || (n > .93 && (x + y) % 2)) { const i = (y * w + x) * 4; p.d[i] *= .82; p.d[i + 1] *= .78; p.d[i + 2] *= .7; }
  }
  // Sketched scenery, kept clear of the road.
  const clear = (x, y) => MAP_NODES.every(([a, b]) => Math.hypot(a - x, b - y) > 16);
  const T = THEME[r];
  for (let i = 0; i < 70; i++) {
    const x = 10 + Math.floor(rnd(i, r + 50) * (w - 24)), y = 14 + Math.floor(rnd(i, r + 60) * (h - 22));
    if (!clear(x, y)) continue;
    STAMP[T[i % T.length]](p, x, y);
  }
  // The compass in the corner.
  const cx = w - 22, cy = h - 22;
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, l = i % 2 ? 6 : 12; line(p, cx, cy, Math.round(cx + Math.cos(a) * l), Math.round(cy + Math.sin(a) * l), INK); }
  for (let a = 0; a < 36; a++) { const q = a / 36 * TAU; p.set(Math.round(cx + Math.cos(q) * 8), Math.round(cy + Math.sin(q) * 8), INK2); }
  // The dotted road joining every stop.
  for (let i = 1; i < MAP_NODES.length; i++) {
    const [a, b] = [MAP_NODES[i - 1], MAP_NODES[i]], n = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = 0; d < n; d += 4) { const x = lerp(a[0], b[0], d / n) + Math.sin(d * .2) * 2, y = lerp(a[1], b[1], d / n) + Math.cos(d * .17) * 2; p.rect(x, y, 2, 2, '#6e3a1c'); }
  }
  p.box(0, 0, w, h, '#2c1f10');
  return p.d;
}
