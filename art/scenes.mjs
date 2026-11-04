// Backdrops, the monster gate and the chest cart. A scene is a full 640 by 200 painting:
// sky, far ranges, layered props with their own lighting, then the ground the fight stands on.
import { Frame, mat, spline, ellipse, capsule, ribbon, rgb, mix } from './raster.mjs';
import { rnd, TAU, lerp, cloth } from './rig.mjs';

export const SCENE = { w: 640, h: 200, ground: 170 };
const W = SCENE.w, H = SCENE.h;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16 - .5);
const smooth = t => t * t * (3 - 2 * t);
function noise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), u = smooth(x - xi), v = smooth(y - yi);
  const q = (a, b) => rnd(a * 73 + s * 991, b * 37 + s * 13);
  return lerp(lerp(q(xi, yi), q(xi + 1, yi), u), lerp(q(xi, yi + 1), q(xi + 1, yi + 1), u), v);
}
const fbm = (x, y, s) => noise(x, y, s) * .6 + noise(x * 2.1, y * 2.1, s + 1) * .28 + noise(x * 4.3, y * 4.3, s + 2) * .12;

function setPx(buf, x, y, c) { const i = (y * W + x) * 4; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255; }
// A banded gradient with ordered dithering between bands, the pixel painter's sky.
function sky(buf, stops, bandBottom) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = Math.min(1, y / bandBottom) * (stops.length - 1) + BAYER[(y & 3) * 4 + (x & 3)] * .5;
    const i = Math.max(0, Math.min(stops.length - 1, Math.round(t)));
    setPx(buf, x, y, rgb(stops[i]));
  }
}
function range(buf, base, amp, freq, seed, col, fade, fadeTo) {
  for (let x = 0; x < W; x++) {
    const top = Math.round(base - fbm(x * freq, 0, seed) * amp);
    for (let y = top; y < H; y++) {
      const k = Math.min(1, (y - top) / fade) + BAYER[(y & 3) * 4 + (x & 3)] * .12;
      setPx(buf, x, y, mix(rgb(col), rgb(fadeTo), Math.max(0, Math.min(1, k))).map(Math.round));
    }
  }
}
function stars(buf, n, seed, maxY) {
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rnd(i, seed) * W), y = Math.floor(rnd(i, seed + 1) * maxY), v = rnd(i, seed + 2);
    const c = v > .9 ? [230, 230, 255] : v > .6 ? [140, 140, 180] : [84, 84, 120];
    setPx(buf, x, y, c);
  }
}
function moon(buf, cx, cy, r, lit, dark, glowCol) {
  for (let y = cy - r * 3; y < cy + r * 3; y++) for (let x = cx - r * 3; x < cx + r * 3; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const d = Math.hypot(x - cx, y - cy), i = (y * W + x) * 4;
    if (d <= r) {
      const n = fbm(x * .09, y * .09, 77), c = n < .42 ? dark : lit, k = 1 - Math.max(0, (x - cx + (y - cy) * .4) / r) * .28;
      setPx(buf, x, y, rgb(c).map(v => Math.round(v * k)));
    } else {
      const a = Math.max(0, 1 - (d - r) / (r * 2)), st = a * a * .55 + BAYER[(y & 3) * 4 + (x & 3)] * .05;
      if (st > .02) { const m = rgb(glowCol); buf[i] = Math.min(255, buf[i] + m[0] * st); buf[i + 1] = Math.min(255, buf[i + 1] + m[1] * st); buf[i + 2] = Math.min(255, buf[i + 2] + m[2] * st); }
    }
  }
}
// Paints a prop layer on its own, so it gets an outline and rim light, then lays it over the scene.
function over(buf, draw, rim) {
  const f = new Frame(W, H, 0, 0);
  draw(f);
  f.finish(rim ? { rim, rimK: .35 } : {});
  for (let i = 0; i < W * H; i++) {
    const a = f.c[i * 4 + 3];
    if (a) { buf[i * 4] = f.c[i * 4]; buf[i * 4 + 1] = f.c[i * 4 + 1]; buf[i * 4 + 2] = f.c[i * 4 + 2]; buf[i * 4 + 3] = 255; }
    for (let k = 0; k < 3; k++) if (f.e[i * 3 + k]) buf[i * 4 + k] = Math.min(255, buf[i * 4 + k] + f.e[i * 3 + k]);
  }
}
// Mist that thickens toward the ground and softens whatever stands far away.
function mist(buf, y0, y1, col, power, seed) {
  const c = rgb(col);
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
    const k = (y - y0) / (y1 - y0), v = fbm(x * .018, y * .05, seed) * 1.3 * k * power + BAYER[(y & 3) * 4 + (x & 3)] * .08;
    if (v <= .06) continue;
    const a = Math.min(.7, v), i = (y * W + x) * 4;
    for (let q = 0; q < 3; q++) buf[i + q] = buf[i + q] + (c[q] - buf[i + q]) * a;
  }
}
function ground(buf, G) {
  const { tones, rim, rock, seed, top = 148, pool } = G;
  const dark = rock.map(rgb);
  for (let x = 0; x < W; x++) {
    const t0 = Math.round(top + (fbm(x * .02, 2, seed) - .5) * 9);
    for (let y = t0; y < H; y++) {
      const d = y - t0, i = (y * W + x) * 4;
      if (d === 0) { setPx(buf, x, y, rgb(rim)); continue; }
      const cliff = 186 + (fbm(x * .05, 7, seed + 3) - .5) * 10;
      if (y >= cliff) {
        const n = fbm(x * .09, y * .16, seed + 5), v = n + (cliff - y) * .012;
        setPx(buf, x, y, dark[Math.max(0, Math.min(dark.length - 1, Math.floor(v * dark.length)))]);
        continue;
      }
      // Flatten the noise horizontally: that alone makes a surface read as lying down.
      let v = fbm(x * .03, y * .16, seed) * .9 + fbm(x * .11, y * .5, seed + 4) * .28 - d / 120;
      v += BAYER[(y & 3) * 4 + (x & 3)] * .09;
      let col = rgb(tones[Math.max(0, Math.min(tones.length - 1, Math.floor(v * tones.length)))]);
      if (pool && fbm(x * .014, y * .1, seed + 8) > pool.at && y > t0 + 4) {
        const glint = Math.sin(x * .3 + y) > .94;
        col = glint ? rgb(pool.light) : rgb(pool.col);
      }
      setPx(buf, x, y, col); void i;
    }
  }
}

// ---------------------------------------------------------------- props
const ROCKM = (c) => mat(c, { exposure: .68, round: 5, ambient: .26, dither: .08 });
function tree(f, x, y, s, seed, m) {
  const branch = (x0, y0, a, len, w, depth) => {
    const bend = (rnd(seed, depth * 7 + x0 | 0) - .5) * .9, mx = x0 + Math.cos(a) * len * .5, my = y0 + Math.sin(a) * len * .5;
    const x1 = mx + Math.cos(a + bend) * len * .5, y1 = my + Math.sin(a + bend) * len * .5;
    f.paint(ribbon([[x0, y0], [mx, my], [x1, y1]], [w, w * .78, w * .55], 3), m, { shadow: 0 });
    if (depth <= 0) return;
    const n = depth > 2 ? 2 : 2 + (rnd(seed, x1 | 0) > .5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const sp = (i - (n - 1) / 2) * (.75 + rnd(seed + i, depth) * .35);
      branch(x1, y1, a + bend + sp, len * (.62 + rnd(seed, i + depth) * .18), w * .62, depth - 1);
    }
  };
  // Flared roots, then the crooked trunk.
  for (const d of [-1, 1]) f.paint(ribbon([[x + d * 3 * s, y - 8 * s], [x + d * 10 * s, y - 1], [x + d * 17 * s, y + 1]], [4 * s, 2.5 * s, .4], 3), m, { shadow: 0 });
  branch(x, y, -Math.PI / 2 + (rnd(seed, 1) - .5) * .25, 44 * s, 6.6 * s, 4);
}
function lump(f, x, y, rx, ry, m, seed, o = {}) {
  const pts = [];
  for (let i = 0; i < 11; i++) { const a = i / 11 * TAU, q = .8 + rnd(seed, i) * .34; pts.push([x + Math.cos(a) * rx * q, y + Math.sin(a) * ry * q]); }
  f.paint(pts, m, { round: Math.min(rx, ry) * .7, grad: .3, ...o });
}
function reeds(f, x, y, n, seed, m, tip) {
  for (let i = 0; i < n; i++) {
    const dx = (i - n / 2) * 2.4 + (rnd(seed, i) - .5) * 2, h = 16 + rnd(seed + 1, i) * 18, lean = (rnd(seed + 2, i) - .5) * 10;
    f.paint(ribbon([[x + dx, y], [x + dx + lean * .4, y - h * .6], [x + dx + lean, y - h]], [1.3, 1, .3], 3), m, { shadow: 0 });
    if (tip && i % 2) f.paint(capsule(x + dx + lean, y - h, x + dx + lean * 1.04, y - h - 6, 1.5, 1.2), tip, { shadow: 0 });
  }
}
function grave(f, x, y, s, seed, m) {
  const tilt = (rnd(seed, 1) - .5) * .25;
  if (rnd(seed, 2) > .5) {
    f.paint(capsule(x, y, x + tilt * 24 * s, y - 28 * s, 3 * s, 2.6 * s), m, { shadow: 0, round: 2.4 });
    f.paint(capsule(x - 9 * s + tilt * 16 * s, y - 18 * s, x + 9 * s + tilt * 16 * s, y - 19 * s, 2.5 * s, 2.5 * s), m, { shadow: 0, round: 2.4 });
  } else {
    f.paint(spline([[x - 8 * s, y], [x - 8 * s + tilt * 14, y - 16 * s], [x + tilt * 18, y - 24 * s], [x + 8 * s + tilt * 14, y - 16 * s], [x + 8 * s, y]]), m, { round: 3, grad: .3, shadow: 0 });
    f.line(x - 3 * s, y - 15 * s, x + 3 * s, y - 15 * s, m.tones[0], true); f.line(x - 3 * s, y - 11 * s, x + 3 * s, y - 11 * s, m.tones[0], true);
  }
}
function lantern(f, x, y, h, m, col) {
  f.paint(capsule(x, y, x, y - h, 1.5, 1.2), m, { shadow: 0 });
  f.paint(ribbon([[x, y - h], [x + 7, y - h - 3], [x + 10, y - h + 1]], [1.2, 1, .8], 3), m, { shadow: 0 });
  f.paint(ellipse(x + 10, y - h + 5, 3, 4), mat(['#7a3a10', '#e88a20', '#ffd070', '#fff4c0'], { ambient: .7, round: 3 }), { shadow: 0 });
  for (let i = 0; i < 26; i++) { const a = i / 26 * TAU, r = 3 + (i % 3) * 3; f.glow(x + 10 + Math.cos(a) * r, y - h + 5 + Math.sin(a) * r, col, .28); }
}
function crystal(f, x, y, h, w, lean, m) {
  f.paint([[x - w, y], [x - w * .8 + lean * .5, y - h * .68], [x + lean, y - h], [x + w * .7 + lean * .5, y - h * .7], [x + w, y]], m, { round: w * .7, gloss: 1.2, grad: .5, shadow: 0 });
  f.line(x + lean * .9, y - h * .94, x - w * .1, y - 2, '#f4ffff', true);
  for (let i = 0; i < 8; i++) f.glow(x + (i - 4) * w * .22 + lean * (i / 8), y - i * h * .1, '#6ad8ff', .22);
}
function mast(f, x, y, m) {
  const tilt = 14;
  f.paint(capsule(x, y, x + tilt, y - 92, 3, 2), m, { shadow: 0 });
  f.paint(capsule(x + tilt * .72 - 24, y - 66, x + tilt * .72 + 26, y - 70, 1.6, 1.4), m, { shadow: 0 });
  const rag = cloth(x + tilt * .72 - 16, y - 66, 34, 5, { sway: 3, trail: .2, phase: .2 }), rag2 = cloth(x + tilt * .72 + 18, y - 68, 24, 5, { sway: 3, trail: -.2, phase: .4 });
  const RG = mat(['#141018', '#28222c', '#3e3a42', '#5a5258'], { exposure: .7, round: 5 });
  f.paint([...rag, ...rag2.slice().reverse()], RG, { shadow: 0, fn: (px) => Math.sin(px * .9) * .1 });
}
function mesa(f, x, y, w, h, m, seed) {
  const pts = [[x - w, y]];
  for (let i = 0; i <= 8; i++) { const q = i / 8; pts.push([x - w * .72 + q * w * 1.44, y - h + (rnd(seed, i) * h * .12) * (i % 8 ? 1 : 0) + (i === 0 || i === 8 ? h * .14 : 0)]); }
  pts.push([x + w, y]);
  f.paint(pts, m, { round: 8, grad: .5, shadow: 0, fn: (_, py) => (Math.floor(py / 7) % 2 ? -.09 : .05) });
}
function derrick(f, x, y, m, hot) {
  for (const [a, b] of [[-16, -5], [16, 5]]) f.paint(capsule(x + a, y, x + b, y - 74, 1.5, 1.2), m, { shadow: 0 });
  for (let i = 1; i < 5; i++) { const q = i / 5, sp = lerp(16, 5, q), yy = y - q * 74; f.line(x - sp, yy, x + sp, yy, m.tones[3], false); f.line(x - sp, yy, x + lerp(16, 5, q + .2), yy - 14.8, m.tones[2], false); }
  f.paint(capsule(x - 15, y - 76, x + 15, y - 76, 2.2, 2.2), m, { shadow: 0 });
  for (let i = 0; i < 20; i++) f.glow(x + 12, y - 80 + (i % 5), hot, .26);
}
function spire(f, x, y, h, w, m, seed) {
  const pts = [[x - w, y]], n = 7;
  for (let i = 1; i < n; i++) { const q = i / n; pts.push([x - w * (1 - q) + (rnd(seed, i) - .5) * 3, y - h * q]); }
  pts.push([x + (rnd(seed, 9) - .5) * 5, y - h]);
  for (let i = n - 1; i > 0; i--) { const q = i / n; pts.push([x + w * (1 - q) + (rnd(seed + 1, i) - .5) * 3, y - h * q]); }
  pts.push([x + w, y]);
  f.paint(pts, m, { round: w * .6, shadow: 0, grad: .4 });
}
function crater(f, x, y, r) {
  f.paint(ellipse(x, y, r, r * .24), mat(['#32100a', '#7a2410', '#e45c14', '#ffa02c', '#ffe080'], { ambient: .8, round: r * .2, exposure: .7, dither: .1 }), { shadow: 0 });
  for (let i = 0; i < 26; i++) { const a = i / 26 * TAU; f.glow(x + Math.cos(a) * r * .8, y - 4 + Math.sin(a) * 5, '#ff6a1c', .4); }
}

const DEF = [
  { // Saltmarsh: a wrecked shore under a green moon.
    sky: ['#0a141c', '#0e1c24', '#12262c', '#183232', '#1e4038', '#28503e', '#3a6444'],
    stars: 70,
    moon: [468, 40, 19, '#c8e0b0', '#8eb088', '#3a6a58'],
    far: [[120, 34, .009, 11, '#142a2c', 34, '#284a3e'], [136, 22, .017, 21, '#0e2024', 22, '#1e3a34']],
    mist: ['#3e6a58', .85],
    props(f) {
      const WOOD = ROCKM(['#080c0c', '#141c1a', '#20302a', '#2e4238', '#40584a']), RD = mat(['#0c1a10', '#1c3418', '#34541e', '#587a28', '#88a83a'], { exposure: .8, round: 1 });
      mast(f, 190, 150, WOOD); mast(f, 402, 148, WOOD);
      tree(f, 116, 152, .86, 3, WOOD); tree(f, 524, 150, .94, 5, WOOD);
      for (const [x, s] of [[150, 7], [250, 5], [320, 9], [372, 4], [452, 8], [560, 6]]) reeds(f, x, 152, s, x, RD, mat(['#2a1a0a', '#5c3e14', '#8a6a24'], { round: 1 }));
      for (const [x, r, s] of [[284, 18, 1], [470, 14, 2], [98, 12, 3]]) lump(f, x, 150, r, r * .55, ROCKM(['#0c1414', '#1a2626', '#2c3c38', '#44564c', '#667a68']), s);
      lantern(f, 342, 152, 34, WOOD, '#7aff9a');
    },
    ground: { tones: ['#12221c', '#183024', '#203c2a', '#2a4a30', '#385c38', '#4a7040'], rim: '#6e9a54', rock: ['#080c0e', '#0e1616', '#16201e', '#1e2c28'], seed: 11, pool: { at: .62, col: '#0e2a30', light: '#6ac0b0' } },
  },
  { // Copper Flats: a mine at sundown, the sky the colour of old metal.
    sky: ['#160c14', '#2a1216', '#4a1c18', '#6e2c18', '#94421a', '#b8601e', '#d88a2c'],
    stars: 18,
    moon: [132, 64, 23, '#ffd08a', '#f0a860', '#ff8a30'],
    far: [[126, 44, .007, 31, '#4a1e18', 36, '#a0501e'], [142, 22, .018, 37, '#2a1212', 18, '#6a2e1a']],
    mist: ['#c8702a', .55],
    props(f) {
      const M = ROCKM(['#100806', '#2a120c', '#4a2214', '#70381e', '#964e28', '#b86a38']), IR = mat(['#06060a', '#14141c', '#26262e', '#3e3a3e', '#5e5048'], { exposure: .75, round: 2, gloss: .6 });
      mesa(f, 90, 152, 62, 58, M, 3); mesa(f, 548, 152, 76, 66, M, 7);
      derrick(f, 232, 152, IR, '#ff8a30'); derrick(f, 410, 150, IR, '#ff8a30');
      f.paint(capsule(258, 150, 384, 146, 3.4, 3.4), mat(['#28120a', '#603014', '#a05a24', '#d89640', '#ffd27a'], { gloss: 1, exposure: .72, round: 3 }), { shadow: 0 });
      for (const x of [282, 318, 352]) f.paint(capsule(x, 152, x, 146, 2, 2), IR, { shadow: 0 });
      for (const [x, r, s] of [[150, 16, 2], [316, 10, 4], [466, 19, 6]]) lump(f, x, 151, r, r * .6, M, s);
    },
    ground: { tones: ['#32140c', '#481e10', '#602a14', '#7c3a1a', '#984e22', '#b0642c'], rim: '#e09a48', rock: ['#0c0606', '#1a0c08', '#2a140c', '#3a1c10'], seed: 21 },
  },
  { // Hollow Orchard: graves among dead apple trees under a huge bone-white moon.
    sky: ['#0a0612', '#120a20', '#1c1030', '#2a1640', '#3a2050', '#4e2c5e', '#6a3e6e'],
    stars: 120,
    moon: [322, 62, 44, '#e6e0cc', '#b4aaa0', '#8a6aa8'],
    far: [[130, 26, .012, 41, '#22123a', 30, '#4a2c5c'], [146, 16, .03, 47, '#150b26', 18, '#301c44']],
    mist: ['#6a4a8a', .95],
    props(f) {
      const BK = ROCKM(['#040208', '#0c0814', '#181020', '#241a2e', '#32263c', '#463652']), ST = ROCKM(['#0e0c16', '#22202c', '#3a3844', '#585462', '#7c7884']);
      tree(f, 96, 152, 1.3, 12, BK); tree(f, 222, 150, 1.02, 17, BK); tree(f, 432, 150, 1.14, 23, BK); tree(f, 552, 152, 1.36, 29, BK);
      for (const [x, s] of [[148, 1], [176, .8], [268, 1.1], [300, .78], [360, .92], [392, 1.1], [486, .88], [510, 1]]) grave(f, x, 153, s, x, ST);
      lantern(f, 330, 153, 40, BK, '#ffb060');
      for (const [x, y] of [[140, 92], [570, 86], [250, 102], [420, 98]]) f.paint(ellipse(x, y, 1.6, 2.2), mat(['#5a1010', '#a82020', '#e04a3a'], { round: 2 }), { shadow: 0 });
    },
    ground: { tones: ['#150c20', '#1e142a', '#2a1c34', '#38263e', '#483248', '#5a4052'], rim: '#8c6a8a', rock: ['#04020a', '#0c0814', '#140e1e', '#1c1428'], seed: 31 },
  },
  { // Glass Dunes: wind-cut drifts and crystal teeth under a cold aurora.
    sky: ['#040a1c', '#081430', '#0e2044', '#163056', '#1e4468', '#2c5c7c', '#4a7c94'],
    stars: 110,
    aurora: true,
    far: [[134, 30, .006, 51, '#1a3c60', 40, '#4a7a9c'], [148, 15, .012, 57, '#1e4a6e', 24, '#5a94b0']],
    mist: ['#8cc4dc', .6],
    props(f) {
      const CR = mat(['#0c2a4a', '#1a4c78', '#2e78a8', '#5cb0d4', '#a0e0f0', '#e4fbff'], { gloss: 1.3, exposure: .78, round: 6, ambient: .3 });
      for (const [x, h, w, l] of [[86, 66, 13, 5], [114, 40, 9, -7], [182, 30, 7, 4], [246, 52, 10, -5], [272, 28, 6, 4], [394, 44, 9, 6], [486, 72, 14, -6], [520, 44, 9, 7], [566, 58, 12, 3]]) crystal(f, x, 153, h, w, l, CR);
    },
    ground: { tones: ['#1e4060', '#2a5474', '#3a6c8a', '#4e86a0', '#68a0b4', '#8cbcc8'], rim: '#d4f0f4', rock: ['#081426', '#0e2038', '#162c48', '#20405e'], seed: 41 },
  },
  { // Starfall Reach: scorched spires, burning craters, a sky coming apart.
    sky: ['#060206', '#10040a', '#200810', '#340c14', '#501416', '#742016', '#a43818'],
    stars: 90,
    comets: true,
    far: [[126, 36, .012, 61, '#1c0a0e', 28, '#5a1a14'], [144, 20, .024, 67, '#0e060a', 18, '#34100e']],
    mist: ['#a03a1c', .75],
    props(f) {
      const CH = ROCKM(['#040204', '#0c0808', '#1a1212', '#2a1c1a', '#3e2a24', '#54382c']);
      for (const [x, h, w, s] of [[80, 92, 21, 1], [128, 54, 12, 2], [204, 70, 15, 3], [416, 62, 14, 4], [506, 104, 23, 5], [566, 66, 15, 6]]) spire(f, x, 153, h, w, CH, s);
      for (const [x, r] of [[168, 24], [346, 32], [464, 20]]) crater(f, x, 158, r);
    },
    ground: { tones: ['#160808', '#221010', '#301612', '#401e14', '#522818', '#68341c'], rim: '#d0602c', rock: ['#040204', '#0c0608', '#160a0a', '#20100c'], seed: 51 },
  },
];

export function renderScene(r) {
  const D = DEF[r], buf = new Uint8ClampedArray(W * H * 4);
  sky(buf, D.sky, 150);
  if (D.stars) stars(buf, D.stars, r * 3 + 9, 110);
  if (D.moon) moon(buf, ...D.moon);
  if (D.aurora) {
    // Thin hanging curtains, brightest along a wandering lower edge and fading up into the dark.
    for (let x = 0; x < W; x++) {
      const low = 62 + Math.sin(x * .013 + 1) * 15 + Math.sin(x * .041) * 6, power = fbm(x * .035, 0, 88) * fbm(x * .22, 3, 89) * 2.6;
      for (let y = 4; y < low; y++) {
        const k = power * Math.pow(1 - (low - y) / 62, 2.2) + BAYER[(y & 3) * 4 + (x & 3)] * .06, i = (y * W + x) * 4;
        if (k <= .08) continue;
        const a = Math.min(.8, k);
        buf[i] = Math.min(255, buf[i] + 30 * a); buf[i + 1] = Math.min(255, buf[i + 1] + 170 * a); buf[i + 2] = Math.min(255, buf[i + 2] + 120 * a);
      }
    }
  }
  if (D.comets) {
    for (const [cx, cy, l] of [[470, 28, 120], [200, 48, 70], [326, 16, 46]]) for (let i = 0; i < l; i++) {
      const q = i / l, x = Math.round(cx - i * .96), y = Math.round(cy - i * .28);
      for (let t = -2; t <= 2; t++) if (y + t >= 0 && x >= 0 && Math.abs(t) <= (1 - q) * 2.4 + .4) setPx(buf, x, y + t, mix([255, 230, 170], [120, 30, 12], q).map(Math.round));
    }
  }
  for (const a of D.far) range(buf, ...a);
  mist(buf, 96, 152, D.mist[0], D.mist[1], r * 5 + 3);
  over(buf, D.props, null);
  mist(buf, 126, 156, D.mist[0], D.mist[1] * .5, r * 5 + 7);
  ground(buf, D.ground);
  // A dark vignette keeps the eye in the middle of the fight.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = Math.max(Math.abs(x - W / 2) / (W / 2), Math.abs(y - H / 2) / (H / 2) * .7), k = 1 - Math.max(0, v - .72) * 1.15, i = (y * W + x) * 4;
    if (k < 1) { buf[i] *= k; buf[i + 1] *= k; buf[i + 2] *= k; }
  }
  return buf;
}

// ---------------------------------------------------------------- gate and cart
export const GATE_FRAME = { w: 128, h: 148, ox: 60, oy: 138 };
export const GATE_FRAMES = 8;
export function renderGate(i, boss) {
  const f = new Frame(GATE_FRAME.w, GATE_FRAME.h, GATE_FRAME.ox, GATE_FRAME.oy), t = i / GATE_FRAMES;
  const ST = ROCKM(['#06060c', '#12121c', '#20202e', '#32324a', '#4a4a64', '#6a6a84']);
  const hot = boss ? ['#ff5a2c', '#ffc66a'] : ['#b05aff', '#e8c0ff'], core = boss ? ['#2a0604', '#6e1408', '#c82c10', '#ff6a2c', '#ffc66a'] : ['#120626', '#2c0e56', '#5a22a0', '#9a56e4', '#dcb0ff'];
  // Inside of the arch: a swirling hole, turning as the frames go by.
  const VM = mat(core, { ambient: 1, round: 1 });
  f.paint(ellipse(0, -44, 26, 44), mat(['#020108', '#060310'], { round: 2 }), { shadow: 0 });
  for (let y = -88; y <= 0; y++) for (let x = -26; x <= 26; x++) {
    const nx = x / 26, ny = (y + 44) / 44, d = Math.hypot(nx, ny);
    if (d > 1) continue;
    const a = Math.atan2(ny, nx), arm = Math.sin(a * 3 + d * 9 - t * TAU) * .5 + .5, v = arm * (1 - d * .35) + (1 - d) * .45;
    const q = Math.max(0, Math.min(4, Math.floor(v * 5 + ((x + y) & 1 ? .22 : -.22))));
    if (d > .96 || q > 0) f.dot(x, y, VM.tones[d > .96 ? 2 : q]);
    if (q >= 3 && (x + y) % 2 === 0) f.glow(x, y, hot[0], .28);
  }
  // Stacked stone blocks, each lit on its own, and a keystone that burns.
  const n = 13;
  for (let k = 0; k <= n; k++) {
    const a = Math.PI + k / n * Math.PI, cx = Math.cos(a) * 36, cy = -46 + Math.sin(a) * 58;
    const size = k === Math.round(n / 2) ? 11 : 8.4;
    const b = [[-size, -6.4], [size, -6.4], [size * .9, 6.4], [-size * .9, 6.4]].map(([px, py]) => { const ca = a + Math.PI / 2; return [cx + px * Math.cos(ca) - py * Math.sin(ca), cy + px * Math.sin(ca) + py * Math.cos(ca)]; });
    f.paint(b, ST, { round: 3.4, shadow: 2, gloss: .2 });
  }
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) f.paint([[s * 36 - 11 + (k % 2), -46 + k * 12], [s * 36 + 11, -46 + k * 12], [s * 36 + 11, -34 + k * 12], [s * 36 - 11 + (k % 2), -34 + k * 12]], ST, { round: 3.4, shadow: 2 });
    f.paint(ribbon([[s * 26, -92], [s * 40, -104], [s * 39, -122]], [5, 3.2, .3], 3), mat(['#2a2622', '#4a4238', '#786c5a', '#a89a80', '#d2c6a8'], { exposure: .7, round: 2.6 }), { shadow: 1 });
    // Braziers flicker on both pillars.
    for (let k = 0; k < 7; k++) { const p = (t * 3 + k * .37) % 1, x = s * 36 + Math.sin(k * 2.1 + t * TAU) * 3 * (1 - p), y = -52 - p * 10; f.dot(x, y, p < .4 ? hot[1] : hot[0]); f.glow(x, y, hot[0], .5); }
  }
  // Runes along the arch pulse in order.
  for (let k = 0; k <= n; k++) {
    const a = Math.PI + k / n * Math.PI, x = Math.cos(a) * 36, y = -46 + Math.sin(a) * 58, on = (k / n + t) % 1 < .3;
    f.dot(x, y, on ? hot[1] : hot[0]); f.dot(x + 1, y, on ? hot[1] : hot[0]);
    f.glow(x, y, hot[0], on ? 1.1 : .25);
  }
  f.finish({ rim: hot[0], rimK: .25 });
  return f;
}
export const CART_FRAME = { w: 124, h: 96, ox: 62, oy: 88 };
export const CART_LEVELS = 5;
const WOOD_M = mat(['#120806', '#28140c', '#422210', '#5e3418', '#7c4a22', '#9c6830'], { exposure: .72, round: 3, dither: .1 });
const IRON_M = mat(['#08080e', '#16161e', '#26262e', '#3c3c44', '#5c5c64', '#8a8a94'], { gloss: 1, exposure: .66, round: 2 });
const GOLD_M = mat(['#3a1e08', '#7c4c14', '#b37a22', '#dcaa3a', '#f6d868', '#fff4b8'], { gloss: 1, exposure: .78, round: 2 });
function chest(f, x, y, s) {
  f.paint([[x - 13 * s, y - 13 * s], [x + 13 * s, y - 13 * s], [x + 13 * s, y], [x - 13 * s, y]], WOOD_M, { round: 3, shadow: 2 });
  f.paint(spline([[x - 13 * s, y - 13 * s], [x - 12 * s, y - 20 * s], [x, y - 23 * s], [x + 12 * s, y - 20 * s], [x + 13 * s, y - 13 * s]]), WOOD_M, { round: 4, shadow: 1, grad: .4 });
  for (const d of [-8, 8]) f.paint([[x + (d - 1.6) * s, y - 21 * s], [x + (d + 1.6) * s, y - 21 * s], [x + (d + 1.6) * s, y], [x + (d - 1.6) * s, y]], IRON_M, { round: 1.4, shadow: 1 });
  f.paint([[x - 13 * s, y - 14.5 * s], [x + 13 * s, y - 14.5 * s], [x + 13 * s, y - 12 * s], [x - 13 * s, y - 12 * s]], IRON_M, { round: 1, shadow: 1 });
  f.paint(ellipse(x, y - 12 * s, 2.8 * s, 3.2 * s), GOLD_M, { shadow: 1 });
  f.glow(x, y - 12 * s, '#ffc040', .5);
}
export function renderCart(level) {
  const f = new Frame(CART_FRAME.w, CART_FRAME.h, CART_FRAME.ox, CART_FRAME.oy);
  // Rear wheel, bed, the chests riding in it, then the near wheel and a hanging lantern.
  const wheel = (x, y, r, m) => {
    f.paint(ellipse(x, y, r, r), IRON_M, { round: 2, shadow: 1 });
    f.paint(ellipse(x, y, r - 2.2, r - 2.2), m, { round: 3, shadow: 1 });
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + .3; f.line(x, y, x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2), m.tones[0], true); }
    f.paint(ellipse(x, y, 2.6, 2.6), IRON_M, { shadow: 1 });
  };
  wheel(-30, -12, 11, WOOD_M);
  f.paint(ribbon([[-40, -24], [-58, -8], [-60, -2]], [2.2, 2, 1.6], 3), WOOD_M, { shadow: 0 });
  f.paint([[-44, -34], [46, -34], [42, -14], [-40, -14]], WOOD_M, { round: 4, shadow: 2, grad: .3, fn: (_, py) => (Math.floor(py / 5) % 2 ? -.1 : .05) });
  const spots = [[-22, -33, 1], [10, -33, 1], [-5, -56, .94], [26, -55, .86]];
  for (let k = 0; k < Math.min(level, 4); k++) chest(f, spots[k][0], spots[k][1], spots[k][2]);
  f.paint([[-46, -38], [48, -38], [47, -33], [-45, -33]], WOOD_M, { round: 2, shadow: 2 });
  for (const x of [-38, 38]) f.paint([[x - 1.6, -38], [x + 1.6, -38], [x + 1.6, -14], [x - 1.6, -14]], IRON_M, { round: 1, shadow: 1 });
  wheel(26, -13, 13, WOOD_M);
  f.paint(capsule(46, -36, 46, -64, 1.4, 1.2), WOOD_M, { shadow: 0 });
  f.paint(ribbon([[46, -64], [52, -66], [55, -62]], [1, 1, .8], 3), IRON_M, { shadow: 0 });
  f.paint(ellipse(55, -56, 3.2, 4.4), mat(['#7a3a10', '#e88a20', '#ffd070', '#fff4c0'], { ambient: .8, round: 3 }), { shadow: 0 });
  for (let k = 0; k < 24; k++) { const a = k / 24 * TAU, r = 3 + (k % 3) * 2.6; f.glow(55 + Math.cos(a) * r, -56 + Math.sin(a) * r, '#ff9a40', .3); }
  f.finish({ rim: '#ffb060', rimK: .22 });
  return f;
}
