// Inventory art: every item slot redrawn for each material tier, plus gems, skills, runes and
// the hero portraits. Items are 24 by 24 pixels and shown at double size, so every pixel counts.
import { Frame, mat, spline, ellipse, capsule, ribbon, rotate, shift } from './raster.mjs';
import { rnd, TAU, lerp, cloth } from './rig.mjs';

export const ICON = 24;
const m = (cols, o = {}) => mat(cols, { exposure: .82, ambient: .34, round: 2.4, ...o });
// One metal for each of the eight item bands, from a rough start to a gilded end.
const METAL = [
  m(['#2c1a0e', '#4e3018', '#7a4e28', '#a67a40', '#d0a868', '#ecd49a'], { gloss: .1 }),
  m(['#2e1408', '#5c2a12', '#94481e', '#c8702e', '#eea050', '#ffd090'], { gloss: .9 }),
  m(['#0e1a10', '#1e3a1e', '#3a6030', '#5e8a40', '#94b860', '#c8e090'], { gloss: .3 }),
  m(['#100808', '#2a1414', '#4a2018', '#7a3018', '#c85a1c', '#ffa040'], { gloss: .9 }),
  m(['#18304c', '#2e5c80', '#5a98b8', '#94cce0', '#d4f2f8', '#ffffff'], { gloss: 1.1 }),
  m(['#0c0618', '#20103a', '#3e2266', '#64409a', '#9a70cc', '#d0b0f0'], { gloss: .7 }),
  m(['#1c2038', '#3a4470', '#6c7cb0', '#a4b4dc', '#dce4f8', '#ffffff'], { gloss: 1.2 }),
  m(['#3a1c06', '#7a4a10', '#b8801c', '#e4b83a', '#fae27a', '#fffbd0'], { gloss: 1.2 }),
];
const TRIM = [METAL[0], METAL[0], METAL[0], METAL[7], METAL[6], METAL[3], METAL[7], METAL[6]];
const CLOTH = [
  m(['#2a2a14', '#4a4a20', '#6e6e30', '#94944a', '#baba6e']), m(['#3a1c10', '#5e3018', '#844a24', '#a86a38', '#cc9458']),
  m(['#142414', '#26401e', '#3c5e28', '#587e38', '#7ca050']), m(['#1a0a0a', '#301212', '#4c1c18', '#6e2a1e', '#964028']),
  m(['#142a3e', '#22485e', '#387082', '#5c9ca8', '#8cc8cc']), m(['#0c0614', '#1a0e28', '#2c1840', '#442660', '#623a84']),
  m(['#141a30', '#242e50', '#3a4a78', '#5a6ea4', '#8a9ccc']), m(['#3e1414', '#6a2020', '#963020', '#c44c28', '#ec7c3c']),
];
const GEMC = [null, null, ['#0e4018', '#2a9c40', '#8cf080', '#eaffd0'], ['#6c1a04', '#e8541c', '#ffb050', '#fff0b8'], ['#0c4c74', '#2ca8dc', '#94ecfc', '#f0ffff'], ['#2c0a54', '#8a30d8', '#d48cff', '#f8e4ff'], ['#0a3c78', '#3a94f0', '#a0dcff', '#ffffff'], ['#6c0c24', '#e03050', '#ff90a0', '#fff0f0']];
const gem = (f, x, y, band, r = 1.8) => {
  const g = GEMC[band]; if (!g) return;
  f.paint(ellipse(x, y, r, r), mat(g, { gloss: 1.3, ambient: .5, round: r * 1.2, exposure: .95 }), { shadow: 1 });
  f.dot(x - .6, y - .6, '#ffffff');
};
function frame() { return new Frame(ICON, ICON, 0, 0); }
const done = f => { f.finish({}); return f; };

// ---------------------------------------------------------------- weapons, on the diagonal
function weapon(band) {
  const f = frame(), M = METAL[band], T = TRIM[band], a = -Math.PI / 4;
  const R = pts => rotate(pts, a, 5.4, 18.6); // drawn pointing right from the grip, then tipped up
  const grip = M === METAL[0] ? CLOTH[1] : m(['#120a08', '#2a1810', '#4a2c18', '#6e4426']);
  f.paint(R([[-2.6, -1], [4.6, -1], [4.6, 1], [-2.6, 1]]), grip, { round: 1, shadow: 1 });
  f.paint(R(ellipse(-3, 0, 1.6, 1.6)), T, { shadow: 1 });
  const blades = {
    0: [[4, -2.4], [17, -2.8], [21, 0], [17, 2.8], [4, 2.4]], // a heavy wooden club-blade
    1: [[4, -2], [19, -2], [23, 0], [19, 2], [4, 2]], // a plain copper shortsword
    2: [[4, -2], [8, -3.4], [10, -2], [13, -3.6], [15, -2], [18, -3.2], [24, 0], [18, 2.4], [4, 2]], // saw-toothed thorn
    3: [[4, -1.8], [15, -2.2], [20, -4.6], [25, -1.4], [20, 2.6], [4, 2]], // a broad falchion
    4: [[4, -1.3], [22, -1.5], [26.5, 0], [22, 1.5], [4, 1.3]], // a long needle of ice
    5: [[4, -1.6], [14, -3], [21, -6], [26, -6], [22, -2.4], [14, 1.4], [4, 2]], // a curved reaper's edge
    6: [[4, -2.6], [21, -2.6], [26, 0], [21, 2.6], [4, 2.6]], // a knightly longsword
    7: [[4, -3], [20, -3.4], [27, 0], [20, 3.4], [4, 3]], // a great gilded blade
  };
  f.paint(R(blades[band]), M, { round: 1.8, grad: .5, shadow: 1 });
  const edge = R([[5, -.4], [band === 4 ? 24 : 21, -.4]]);
  f.line(edge[0][0], edge[0][1], edge[1][0], edge[1][1], M.tones[M.tones.length - 1], true);
  const fuller = R([[5, .6], [18, .6]]);
  f.line(fuller[0][0], fuller[0][1], fuller[1][0], fuller[1][1], M.tones[1], true);
  // The guard grows more elaborate with each band.
  const g = band < 2 ? 3.4 : band < 5 ? 4.6 : 6;
  f.paint(R([[3, -g], [5.2, -g], [5.2, g], [3, g]]), T, { round: 1.2, shadow: 1 });
  if (band >= 6) for (const s of [-1, 1]) f.paint(R([[3, s * g], [.4, s * (g + 2.4)], [4.6, s * g]]), T, { round: 1, shadow: 1 });
  const c = R([[4.2, 0]])[0]; gem(f, c[0], c[1], band, 1.5);
  if (band === 3) for (const [dx, dy] of [[16, -4], [20, -6], [13, -6]]) { const q = R([[dx, dy]])[0]; f.dot(q[0], q[1], '#ffb050'); }
  return done(f);
}
// ---------------------------------------------------------------- shields
function ward(band) {
  const f = frame(), M = METAL[band], T = TRIM[band], c = [12, 12];
  const shapes = [
    ellipse(12, 12, 9, 9),
    [[4, 4], [20, 4], [20, 12], [17, 18], [12, 22], [7, 18], [4, 12]],
    [[3, 5], [8, 3], [12, 5], [16, 3], [21, 5], [20, 13], [16, 19], [12, 22], [8, 19], [4, 13]],
    [[5, 2], [19, 2], [21, 5], [20, 18], [12, 22], [4, 18], [3, 5]],
    [[12, 2], [20, 7], [20, 16], [12, 22], [4, 16], [4, 7]],
    [[5, 3], [12, 5], [19, 3], [21, 11], [17, 19], [12, 22], [7, 19], [3, 11]],
    [[12, 2], [20, 5], [20, 13], [12, 22], [4, 13], [4, 5]],
    [[12, 3], [18, 5], [20, 11], [17, 18], [12, 22], [7, 18], [4, 11], [6, 5]],
  ];
  // Wings sit behind the top shield.
  if (band === 7) for (const s of [-1, 1]) for (let i = 0; i < 3; i++) f.paint(ribbon([[12 + s * 6, 8 + i * 3], [12 + s * 11, 4 + i * 4.4]], [2, .3], 2), METAL[6], { shadow: 0 });
  f.paint(shapes[band], band === 0 ? CLOTH[1] : M, { round: 3.4, grad: .35, shadow: 1, fn: band === 0 ? (x) => (x % 4 < 1 ? -.2 : 0) : null });
  // A rim of a second metal and a central emblem that shows the band.
  const inner = shapes[band].map(([x, y]) => [lerp(x, c[0], .24), lerp(y, c[1], .24)]);
  f.path([...shapes[band], shapes[band][0]], T.tones[T.tones.length - 2], true);
  if (band === 0) { f.paint(ellipse(12, 12, 3.2, 3.2), METAL[1], { shadow: 1 }); }
  else if (band === 1) { f.path([[12, 6], [12, 18]], M.tones[1], true); f.path([[6, 11], [18, 11]], M.tones[1], true); }
  else if (band === 2) { for (const [x, y] of [[8, 9], [16, 9], [12, 15]]) f.paint(ribbon([[x, y + 2], [x, y - 2]], [1.2, .2], 2), METAL[0], { shadow: 0 }); }
  else if (band === 3) { f.paint(ribbon([[12, 18], [9, 12], [13, 9], [12, 5]], [3, 2.6, 1.6, .3], 3), mat(['#7a1a08', '#e8541c', '#ffb050', '#fff0b8'], { ambient: .8, round: 2 }), { shadow: 1 }); }
  else if (band === 4) { f.paint(inner, METAL[6], { round: 2.4, shadow: 1 }); gem(f, 12, 12, band, 2.2); }
  else if (band === 5) { f.paint(spline([[8, 9], [12, 7], [16, 9], [16, 13], [14, 15], [10, 15], [8, 13]]), m(['#3e3628', '#7a705a', '#b4a88c', '#e4dcc4']), { shadow: 1 }); for (const x of [10, 14]) { f.dot(x, 11, '#100818'); f.dot(x, 10, '#100818'); } f.dot(10, 11, '#c84cff'); f.dot(14, 11, '#c84cff'); }
  else if (band === 6) { for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, r = i % 2 ? 2.4 : 5; f.line(12, 12, 12 + Math.cos(a) * r, 12 + Math.sin(a) * r, '#ffffff', true); } gem(f, 12, 12, band, 1.6); }
  else { for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; f.line(12 + Math.cos(a) * 3, 12 + Math.sin(a) * 3, 12 + Math.cos(a) * 6, 12 + Math.sin(a) * 6, '#fffbd0', true); } gem(f, 12, 12, band, 2.4); }
  return done(f);
}
// ---------------------------------------------------------------- helms
function helm(band) {
  const f = frame(), M = METAL[band], T = TRIM[band], C = CLOTH[band];
  if (band === 0 || band === 2 || band === 5) {
    // Hoods: a soft peak falling over a dark face opening.
    f.paint(spline([[4, 21], [4, 12], [7, 5], [12, 3], [17, 5], [20, 12], [20, 21], [12, 22]]), C, { round: 4, grad: .4, shadow: 1 });
    f.paint(spline([[8, 19], [8, 12], [12, 9], [16, 12], [16, 19], [12, 20]]), m(['#04030a', '#0a0814', '#14101e']), { shadow: 1, ambient: .9 });
    if (band === 5) { for (const x of [10, 14]) { f.dot(x, 14, '#e49cff'); f.dot(x, 13, '#c84cff'); f.glow(x, 14, '#c84cff', .4); } }
    if (band === 2) { f.paint(ribbon([[7, 7], [3, 3]], [1.6, .3], 2), METAL[2], { shadow: 1 }); f.paint(ribbon([[16, 6], [20, 2]], [1.6, .3], 2), METAL[2], { shadow: 1 }); f.dot(10, 15, '#b0f070'); f.dot(14, 15, '#b0f070'); }
    if (band === 0) { f.line(5, 18, 19, 18, CLOTH[1].tones[1], true); }
    return done(f);
  }
  const hasFace = band === 1;
  f.paint(spline([[4, 18], [4, 10], [7, 4], [12, 2], [17, 4], [20, 10], [20, 18], [17, 21], [7, 21]]), M, { round: 4, gloss: 1.1, grad: .42, shadow: 1 });
  f.path([[12, 3], [12, band === 3 ? 21 : 10]], M.tones[M.tones.length - 1], true);
  if (hasFace) { f.paint([[6, 13], [18, 13], [18, 21], [6, 21]], m(['#100808', '#201410']), { shadow: 1 }); f.path([[4, 12], [20, 12]], T.tones[T.tones.length - 2], true); f.path([[12, 12], [12, 19]], M.tones[3], true); }
  else {
    // A visor slit, with breathing holes on the heavier helms.
    f.line(5, 11, 19, 11, '#050308'); f.line(5, 12, 19, 12, '#050308');
    if (band === 3) { f.dot(8, 11, '#ffb050'); f.dot(16, 11, '#ffb050'); f.glow(8, 11, '#ff6a1c', .4); f.glow(16, 11, '#ff6a1c', .4); for (let i = 0; i < 3; i++) f.line(14 + i * 1.6, 15, 14 + i * 1.6, 18, '#100808'); }
    else if (band === 4) { f.dot(8, 11, '#c8ffff'); f.dot(16, 11, '#c8ffff'); }
    else { f.dot(8, 11, '#a0dcff'); f.dot(16, 11, '#a0dcff'); }
    f.path([[5, 16], [19, 16]], T.tones[T.tones.length - 2], true);
  }
  if (band === 4) for (const s of [-1, 1]) f.paint(ribbon([[12 + s * 6, 7], [12 + s * 10, 4], [12 + s * 9, -1]], [2, 1.4, .3], 3), METAL[6], { shadow: 1 });
  if (band === 6) { f.paint([[6, 5], [8, -1], [10, 3], [12, -2], [14, 3], [16, -1], [18, 5]], METAL[7], { round: 1.4, shadow: 1 }); gem(f, 12, 4, band, 1.4); }
  if (band === 7) for (const s of [-1, 1]) for (let i = 0; i < 3; i++) f.paint(ribbon([[12 + s * 7, 8 + i * 2], [12 + s * 11, 2 + i * 3]], [1.6, .3], 2), METAL[6], { shadow: 1 });
  if (band === 7) gem(f, 12, 7, band, 1.6);
  return done(f);
}
// ---------------------------------------------------------------- body armour
function coat(band) {
  const f = frame(), M = METAL[band], T = TRIM[band], C = CLOTH[band], soft = band === 0 || band === 2 || band === 5;
  const body = soft ? C : M;
  // Sleeves, then a chest that narrows to the waist, then the skirt.
  for (const s of [-1, 1]) f.paint(ribbon([[12 + s * 6, 6], [12 + s * 10, 11], [12 + s * 10, 17]], [2.8, 2.4, 2], 3), body, { round: 2, shadow: 0 });
  f.paint([[6, 18], [18, 18], [20, 23], [4, 23]], soft ? C : CLOTH[band], { round: 2, shadow: 1, grad: .3 });
  f.paint(spline([[6, 5], [9, 3], [15, 3], [18, 5], [18, 12], [16, 19], [8, 19], [6, 12]]), body, { round: 3.4, gloss: soft ? .1 : 1, grad: .4, shadow: 1 });
  // Neck opening, a belt, and detail that shows what it is made of.
  f.paint(spline([[9, 3], [15, 3], [14, 6], [12, 7], [10, 6]]), m(['#04030a', '#100c14']), { shadow: 1 });
  f.paint([[7, 16], [17, 16], [17, 18], [7, 18]], band >= 3 ? T : METAL[1], { round: 1, shadow: 1 });
  if (band === 0) { for (let y = 8; y < 15; y += 2) { f.dot(11, y, '#2a1408'); f.dot(13, y, '#2a1408'); } }
  else if (band === 1) { for (let y = 7; y < 16; y += 2) for (let x = 7 + (y % 4 ? 1 : 0); x < 17; x += 2) f.dot(x, y, M.tones[2]); }
  else if (band === 2) { for (const [x, y] of [[9, 8], [15, 8], [12, 12]]) f.paint(ribbon([[x - 2, y], [x + 2, y - 2]], [1.2, .3], 2), METAL[2], { shadow: 1 }); }
  else if (band === 3) { f.paint(ellipse(12, 10, 3, 3), mat(['#7a1a08', '#e8541c', '#ffb050', '#fff0b8'], { ambient: .9, round: 2.4 }), { shadow: 1 }); f.glow(12, 10, '#ff6a1c', .5); f.path([[7, 13], [12, 15], [17, 13]], M.tones[1], true); }
  else if (band === 4) { f.path([[12, 6], [8, 11], [12, 15], [16, 11], [12, 6]], '#ffffff', true); gem(f, 12, 11, band, 1.6); }
  else if (band === 5) { f.path([[9, 5], [12, 13], [15, 5]], '#c9963c', true); gem(f, 12, 14, band, 1.3); }
  else if (band === 6) { for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; f.line(12, 10, 12 + Math.cos(a) * 4, 10 + Math.sin(a) * 4, '#ffffff', true); } gem(f, 12, 10, band, 1.3); }
  else { f.path([[8, 6], [12, 9], [16, 6]], '#fffbd0', true); gem(f, 12, 11, band, 2); for (const s of [-1, 1]) f.paint(ribbon([[12 + s * 7, 5], [12 + s * 11, 1]], [1.8, .3], 2), METAL[6], { shadow: 1 }); }
  return done(f);
}
// ---------------------------------------------------------------- boots, one behind the other
function boots(band) {
  const f = frame(), M = METAL[band], T = TRIM[band], C = band === 0 || band === 2 || band === 5 ? CLOTH[band] : M;
  const boot = (x, y, k) => {
    f.paint([[x, y], [x + 7, y], [x + 7.6, y + 8], [x + 13, y + 11], [x + 13, y + 14], [x - .4, y + 14]], C, { round: 2.6, grad: .3, shadow: k });
    f.path([[x - .4, y + 13], [x + 13, y + 13]], '#08060a', true);
    f.path([[x, y + 1.6], [x + 7, y + 1.6]], T.tones[T.tones.length - 2], true);
    if (band >= 3) { f.paint(ellipse(x + 3.6, y + 7, 2.2, 2), T, { shadow: 1 }); }
    if (band === 1 || band === 4 || band === 6) f.path([[x + 8, y + 9], [x + 12, y + 11]], M.tones[M.tones.length - 1], true);
  };
  boot(9, 3, 0); boot(2, 7, 2);
  if (band === 7 || band === 6) for (let i = 0; i < 3; i++) f.paint(ribbon([[2, 9 + i * 2], [-3 + i, 4 + i * 2.6]], [1.4, .3], 2), METAL[band === 7 ? 6 : 4], { shadow: 1 });
  if (band === 2) f.paint(ribbon([[6, 14], [1, 12]], [1, .2], 2), METAL[2], { shadow: 1 });
  gem(f, 5.6, 14, band, 1.3);
  return done(f);
}
// ---------------------------------------------------------------- charms on a chain
function charm(band) {
  const f = frame(), M = METAL[band], T = TRIM[band];
  const chain = M === METAL[0] ? METAL[0] : T;
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI * (1 + i / 12), x = 12 + Math.cos(a) * 7.6, y = 9 + Math.sin(a) * 7;
    if (i % 2 === 0) f.paint(ellipse(x, y, 1.1, 1.1), chain, { shadow: 0 });
  }
  for (const s of [-1, 1]) f.line(12 + s * 7.6, 9, 12 + s * 2, 13, chain.tones[3]);
  const y = 16;
  if (band === 0) { f.paint(ellipse(12, y, 3.4, 4), METAL[0], { shadow: 1 }); f.paint(ellipse(12, y - 5, 1.6, 1.6), CLOTH[0], { shadow: 1 }); }
  else if (band === 1) { f.paint(ellipse(12, y, 5, 5), M, { round: 2.4, gloss: 1.1, shadow: 1 }); f.paint(ellipse(12, y, 2.4, 2.4), m(['#14080a', '#241414']), { shadow: 1 }); }
  else if (band === 2) { for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; f.paint(ribbon([[12 + Math.cos(a) * 2, y + Math.sin(a) * 2], [12 + Math.cos(a) * 6, y + Math.sin(a) * 6]], [1.3, .2], 2), M, { shadow: 0 }); } gem(f, 12, y, band, 2.2); }
  else if (band === 3) { f.paint(ribbon([[12, y + 6], [12, y + 1], [12, y - 5]], [3.8, 3.2, .4], 3), mat(['#6c1a04', '#e8541c', '#ffb050', '#fff0b8'], { ambient: .9, round: 2.4 }), { shadow: 1 }); f.glow(12, y, '#ff6a1c', .6); }
  else if (band === 4) { for (let i = 0; i < 6; i++) { const a = i / 6 * TAU - Math.PI / 2, tip = [12 + Math.cos(a) * 6, y + Math.sin(a) * 6]; f.line(12, y, tip[0], tip[1], '#e4fbff'); f.dot(tip[0], tip[1], '#ffffff'); } gem(f, 12, y, band, 1.8); }
  else if (band === 5) { f.paint(spline([[6, y], [12, y - 4], [18, y], [12, y + 4]]), m(['#201030', '#6a4a8a', '#d0b8e8', '#ffffff']), { round: 2.2, shadow: 1 }); f.paint(ellipse(12, y, 2.4, 2.4), mat(['#2c0a54', '#8a30d8', '#d48cff'], { round: 2, gloss: 1 }), { shadow: 1 }); f.dot(12, y, '#08040e'); }
  else if (band === 6) { for (let i = 0; i < 8; i++) { const a = i / 8 * TAU - Math.PI / 2, r = i % 2 ? 2.6 : 6.4; f.line(12, y, 12 + Math.cos(a) * r, y + Math.sin(a) * r, '#ffffff'); } f.paint(ellipse(12, y, 2.8, 2.8), M, { gloss: 1.2, shadow: 1 }); gem(f, 12, y, band, 1.5); }
  else { for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; f.line(12 + Math.cos(a) * 3, y + Math.sin(a) * 3, 12 + Math.cos(a) * (i % 2 ? 5 : 7), y + Math.sin(a) * (i % 2 ? 5 : 7), '#fae27a'); } f.paint(ellipse(12, y, 3.8, 3.8), M, { gloss: 1.3, shadow: 1 }); gem(f, 12, y, band, 2); }
  return done(f);
}
export const ITEM_ART = { weapon, ward, helm, coat, boots, charm };

// ---------------------------------------------------------------- materials, chest and money
export function renderGem(tier) {
  const f = frame(), g = [['#0e4c5c', '#1c94a8', '#60dce4', '#d0fcfc'], ['#3a0c6c', '#7a2cd0', '#c080ff', '#f4e0ff'], ['#6c0c24', '#e03050', '#ff90a0', '#fff0f0']][tier];
  const M = mat(g, { gloss: 1.4, ambient: .5, round: 3, exposure: .95 });
  const pts = tier === 0 ? [[12, 4], [19, 10], [12, 20], [5, 10]] : tier === 1 ? [[8, 4], [16, 4], [20, 10], [12, 21], [4, 10]] : [[12, 3], [18, 6], [20, 13], [12, 22], [4, 13], [6, 6]];
  f.paint(pts, M, { grad: .5, shadow: 1 });
  f.path([[pts[pts.length - 1][0], pts[pts.length - 1][1]], [12, 10], [pts[1][0], pts[1][1]]], g[3], true);
  f.line(12, 10, 12, 20, g[1], true);
  f.dot(9, 7, '#ffffff'); f.dot(10, 6, '#ffffff');
  return done(f);
}
export function renderSeal() {
  const f = frame();
  f.paint(ellipse(12, 12, 9, 9), METAL[7], { round: 3, gloss: 1.1, shadow: 1 });
  f.paint(ellipse(12, 12, 6.4, 6.4), m(['#5c1408', '#a02c14', '#d85020', '#f08a40']), { round: 3, shadow: 1 });
  f.paint([[8, 11], [10, 7], [12, 10], [14, 7], [16, 11], [16, 16], [8, 16]], METAL[7], { round: 1.4, shadow: 1 });
  f.line(10, 13, 11, 13, '#3a1c06'); f.line(13, 13, 14, 13, '#3a1c06');
  return done(f);
}
export function renderChest(open) {
  const f = frame(), W = m(['#160a06', '#2e180c', '#4a2812', '#6c3e1c', '#8e5a2c', '#b07c40']), I = METAL[6];
  f.paint([[3, 11], [21, 11], [21, 21], [3, 21]], W, { round: 2, shadow: 1, grad: .3, fn: (_, y) => (y % 4 < 1 ? -.15 : 0) });
  f.paint(spline([[3, 11], [4, 5], [12, 3], [20, 5], [21, 11]]), W, { round: 2.6, shadow: 1, grad: .5 });
  for (const x of [6, 18]) f.paint([[x - 1, 4], [x + 1, 4], [x + 1, 21], [x - 1, 21]], I, { round: 1, shadow: 1 });
  f.paint([[3, 10], [21, 10], [21, 12], [3, 12]], I, { round: 1, shadow: 1 });
  f.paint(ellipse(12, 12, 2.4, 2.8), METAL[7], { shadow: 1 });
  void open;
  return done(f);
}
export function renderCoin() {
  const f = new Frame(12, 12, 0, 0);
  f.paint(ellipse(6, 6, 4.6, 4.6), METAL[7], { round: 2, gloss: 1.2, shadow: 0 });
  f.line(6, 3, 6, 9, '#7a4a10', true); f.dot(5, 3, '#fffbd0');
  return done(f);
}
export function renderMark() {
  const f = new Frame(12, 12, 0, 0);
  f.paint([[6, 1], [10.6, 5], [6, 11], [1.4, 5]], m(['#0e4c5c', '#1c94a8', '#60dce4', '#d0fcfc'], { gloss: 1.2 }), { round: 2, shadow: 0, grad: .4 });
  f.line(3.4, 5, 8.6, 5, '#d0fcfc', true);
  return done(f);
}

// ---------------------------------------------------------------- skill and rune emblems
const COL = {
  red: ['#3a0810', '#7a1418', '#c02c20', '#ec6a3a', '#ffc08a'], violet: ['#180838', '#3c1880', '#7838c8', '#b478f0', '#ecd0ff'],
  gold: ['#3a2006', '#7a5010', '#c08c1c', '#f0c844', '#fff0a8'], green: ['#082814', '#14562a', '#2a9040', '#78cc58', '#d8f8a0'],
  steel: ['#141a2c', '#2e3a54', '#5a6c88', '#94a8c0', '#e4eef8'], blue: ['#08204c', '#14468c', '#2c7ccc', '#6cc0f0', '#d0f4ff'],
  teal: ['#06282c', '#0e5c60', '#1c9c94', '#58d8c0', '#d0fff0'],
};
const MOTIF = {
  sword(f, c) { f.paint(rotate([[-8, -1.4], [6, -1.4], [9, 0], [6, 1.4], [-8, 1.4]], -.78, 12, 12), c, { round: 1.4, shadow: 1, grad: .5 }); f.paint(rotate([[-5, -4], [-3.4, -4], [-3.4, 4], [-5, 4]], -.78, 12, 12), c, { shadow: 1, round: 1 }); },
  slash(f, c) { for (const k of [0, 3.6]) f.paint(ribbon([[5, 18 - k], [12, 13 - k], [15, 7 - k], [19 - k * .3, 3]], [.4, 2, 1.8, .3], 3), c, { shadow: 1 }); },
  shield(f, c) { f.paint([[6, 5], [18, 5], [18, 12], [12, 20], [6, 12]], c, { round: 2.4, grad: .5, shadow: 1 }); f.line(12, 7, 12, 17, c.tones[1], true); },
  heart(f, c) { f.paint(spline([[12, 19], [5, 12], [6, 6.6], [10, 6], [12, 9], [14, 6], [18, 6.6], [19, 12]]), c, { round: 2.6, shadow: 1, gloss: .8, grad: .4 }); },
  fist(f, c) { f.paint(spline([[7, 11], [8, 7], [16, 6], [18, 10], [17, 15], [14, 18], [9, 18], [7, 15]]), c, { round: 2.4, shadow: 1 }); for (const x of [10, 13, 16]) f.line(x, 7, x, 11, c.tones[1], true); },
  wing(f, c) { for (let i = 0; i < 4; i++) f.paint(ribbon([[6 + i * 2, 18 - i], [13 + i * 1.6, 11 - i * 2], [18 + i, 6 - i * .4]], [.5, 1.7, .3], 3), c, { shadow: 1 }); },
  star(f, c) { const p = []; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU - Math.PI / 2, r = i % 2 ? 3 : 8.6; p.push([12 + Math.cos(a) * r, 12 + Math.sin(a) * r]); } f.paint(p, c, { round: 2, shadow: 1, grad: .4 }); },
  burst(f, c) { for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, r = i % 2 ? 6 : 9; f.paint(ribbon([[12 + Math.cos(a) * 2.6, 12 + Math.sin(a) * 2.6], [12 + Math.cos(a) * r, 12 + Math.sin(a) * r]], [1.8, .3], 2), c, { shadow: 1 }); } f.paint(ellipse(12, 12, 3, 3), c, { shadow: 1 }); },
  eye(f, c) { f.paint(spline([[4, 12], [12, 6.6], [20, 12], [12, 17.4]]), c, { round: 2.4, shadow: 1 }); f.paint(ellipse(12, 12, 3, 3), mat([c.tones[0], '#08040e'], { round: 2 }), { shadow: 0 }); f.dot(11, 11, '#ffffff'); },
  arrow(f, c) { f.paint(rotate([[-8, -.9], [5, -.9], [5, -3], [10, 0], [5, 3], [5, .9], [-8, .9]], -.78, 12, 12), c, { round: 1, shadow: 1 }); },
  arrows(f, c) { for (const dx of [-4, 0, 4]) f.paint(rotate([[-7, -.7], [3, -.7], [3, -2.4], [7, 0], [3, 2.4], [3, .7], [-7, .7]], -.78, 12 + dx, 12 + dx * .9), c, { round: 1, shadow: 1 }); },
  rain(f, c) { for (const [x, y] of [[6, 5], [12, 3], [18, 5], [9, 11], [15, 11], [12, 16]]) f.paint(ribbon([[x + 1.4, y - 2], [x - 1, y + 3.6]], [.8, 1], 2), c, { shadow: 1 }); },
  flame(f, c) { f.paint(ribbon([[12, 20], [9, 14], [13, 10], [11, 4]], [5, 4.4, 2.6, .3], 4), c, { shadow: 1, grad: .5 }); },
  bolt(f, c) { f.paint([[14, 3], [7, 13], [11, 13], [9, 21], [17, 10], [13, 10]], c, { round: 1.2, shadow: 1, grad: .4 }); },
  comet(f, c) { f.paint(ribbon([[19, 3], [13, 10], [9, 14]], [.5, 2.4, 3.8], 3), c, { shadow: 1, grad: .4 }); f.paint(ellipse(8, 16, 4, 4), c, { gloss: 1, shadow: 1 }); },
  cross(f, c) { f.paint([[10, 4], [14, 4], [14, 10], [20, 10], [20, 14], [14, 14], [14, 20], [10, 20], [10, 14], [4, 14], [4, 10], [10, 10]], c, { round: 1.6, shadow: 1, grad: .4 }); },
  sun(f, c) { for (let i = 0; i < 12; i++) { const a = i / 12 * TAU, r = i % 2 ? 7 : 9.4; f.line(12 + Math.cos(a) * 4, 12 + Math.sin(a) * 4, 12 + Math.cos(a) * r, 12 + Math.sin(a) * r, c.tones[4]); } f.paint(ellipse(12, 12, 4, 4), c, { gloss: 1.1, shadow: 1 }); },
  drop(f, c) { f.paint(spline([[12, 3], [17, 12], [16, 18], [12, 20], [8, 18], [7, 12]]), c, { round: 2.6, gloss: 1, shadow: 1, grad: .5 }); },
  coin(f, c) { f.paint(ellipse(12, 12, 7, 7), c, { gloss: 1.2, shadow: 1 }); f.line(12, 7, 12, 17, c.tones[1], true); },
  book(f, c) { f.paint([[5, 6], [12, 8], [19, 6], [19, 18], [12, 20], [5, 18]], c, { round: 1.6, shadow: 1, grad: .3 }); f.line(12, 8, 12, 20, c.tones[0], true); },
  bag(f, c) { f.paint(spline([[12, 5], [15, 8], [19, 14], [17, 20], [7, 20], [5, 14], [9, 8]]), c, { round: 2.6, shadow: 1 }); f.line(9, 8, 15, 8, c.tones[0], true); },
  anvil(f, c) { f.paint([[4, 7], [20, 7], [17, 11], [15, 11], [15, 15], [18, 19], [6, 19], [9, 15], [9, 11], [7, 11]], c, { round: 1.4, shadow: 1, gloss: 1 }); },
  clock(f, c) { f.paint(ellipse(12, 12, 8, 8), c, { shadow: 1 }); f.line(12, 12, 12, 7, c.tones[0], true); f.line(12, 12, 16, 13, c.tones[0], true); },
  chest(f, c) { f.paint([[5, 11], [19, 11], [19, 19], [5, 19]], c, { round: 1.4, shadow: 1 }); f.paint(spline([[5, 11], [6, 6], [12, 5], [18, 6], [19, 11]]), c, { round: 2, shadow: 1 }); f.line(5, 11, 19, 11, c.tones[0], true); },
  horse(f, c) { f.paint(spline([[7, 19], [8, 12], [11, 7], [15, 5], [19, 8], [17, 11], [14, 11], [15, 19]]), c, { round: 2, shadow: 1 }); },
};
export const MOTIFS = Object.keys(MOTIF);
// Actives sit in a hexagon, passives in a circle, runes in a square, so the shape says what it is.
export function renderEmblem(motif, col, shape) {
  const f = frame(), C = COL[col], body = mat(C, { gloss: .7, ambient: .4, round: 3, exposure: .9 });
  const light = mat([C[1], C[2], C[3], C[4], '#ffffff'], { ambient: .55, round: 2, exposure: .95, gloss: .8 });
  const hex = []; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU - Math.PI / 2; hex.push([11.5 + Math.cos(a) * 11.4, 11.5 + Math.sin(a) * 11.4]); }
  const outline = shape === 'hex' ? hex : shape === 'round' ? ellipse(11.5, 11.5, 11, 11) : [[.5, .5], [22.5, .5], [22.5, 22.5], [.5, 22.5]];
  f.paint(outline, body, { round: 5, grad: .55, shadow: 0, fn: (x, y) => ((x + y) % 3 < 1 ? -.05 : 0) });
  MOTIF[motif](f, light);
  f.finish({});
  return f;
}

// ---------------------------------------------------------------- hero portraits
export const BUST = { w: 64, h: 64 };
const SK = mat(['#3e1c1c', '#6e3428', '#a4604a', '#cf8f6e', '#ecba96', '#fbd9bc'], { ambient: .42, round: 7, exposure: .84 });
const SKP = mat(['#4a2c30', '#7e5048', '#b48a78', '#dcb8a2', '#f4d8c6', '#fff0e2'], { ambient: .46, round: 7, exposure: .86 });
function backdrop(f, cols) {
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const d = Math.hypot(x - 34, y - 26) / 46, i = Math.max(0, Math.min(cols.length - 1, Math.floor(d * cols.length + (((x ^ y) & 1) ? .22 : -.22))));
    f.dot(x, y, cols[i]);
  }
}
// A large three-quarter face. (x, y) is the middle of the head.
function bigFace(f, x, y, S, o = {}) {
  f.paint(spline([[x - 11, y - 1], [x - 11, y - 9], [x - 3, y - 15], [x + 6, y - 14], [x + 12, y - 8], [x + 13, y - 1], [x + 13, y + 4], [x + 10, y + 10], [x + 5, y + 15], [x + 1, y + 15], [x - 5, y + 11], [x - 9, y + 7]]), S, { shadow: 2 });
  const brow = o.brow || '#2a1810', iris = o.iris || '#4a7ab4', dk = o.irisDark || '#14203c', hi = '#ffffff';
  // Near eye: lash, white, iris with a darker top, pupil, catch-light.
  f.line(x - 3, y - 7, x + 3, y - 6, brow); f.line(x - 3, y - 6.2, x + 3, y - 5.2, brow);
  f.line(x + 7.4, y - 6, x + 11, y - 7, brow);
  f.line(x - 3, y - 3.4, x + 3.4, y - 3.4, '#180c0c'); f.line(x - 3, y - 2.6, x + 3.4, y - 2.6, '#180c0c');
  for (let i = -2.4; i <= 3; i += 1) for (let j = -1.8; j <= 1.4; j += 1) f.dot(x + i, y + j, '#f8f2ea');
  for (let i = -.4; i <= 2.6; i += 1) for (let j = -1.8; j <= 1.4; j += 1) f.dot(x + i, y + j, j < 0 ? dk : iris);
  f.dot(x + 1, y - .6, '#07050c'); f.dot(x + 2, y - .6, '#07050c'); f.dot(x + 1, y - 1.6, hi); f.dot(x + .2, y + .8, o.glow || '#c8d8f0');
  // Far eye: narrower, turned away.
  f.line(x + 7.4, y - 3.4, x + 11, y - 3.6, '#180c0c'); f.line(x + 7.4, y - 2.6, x + 11, y - 2.8, '#180c0c');
  for (let i = 7.6; i <= 10.6; i += 1) for (let j = -1.8; j <= 1.4; j += 1) f.dot(x + i, y + j, i > 9.5 ? '#f0e8de' : j < 0 ? dk : iris);
  f.dot(x + 8.6, y - .6, '#07050c'); f.dot(x + 8, y - 1.6, hi);
  if (o.glowCol) { f.glow(x + 1, y, o.glowCol, .9); f.glow(x + 9, y, o.glowCol, .7); }
  // Nose, lips and the soft shadow under the jaw.
  f.line(x + 6.2, y + 1, x + 7.6, y + 4.6, S.tones[2], true); f.dot(x + 7.6, y + 5, S.tones[1]); f.dot(x + 8.6, y + 4, S.tones[5]);
  f.line(x + 3, y + 9.4, x + 9, y + 9, o.lip || '#9a4640'); f.line(x + 4, y + 10.4, x + 8, y + 10, o.lipL || '#c0706a');
  f.dot(x - 6, y + 4, S.tones[3]); f.dot(x - 5, y + 5, S.tones[3]);
}
const BUSTS = {
  warden(f) {
    backdrop(f, ['#7a1c28', '#561420', '#3a0e18', '#260a12', '#180610']);
    const S = mat(['#07060c', '#0f0e17', '#1a1a26', '#272836', '#383a4c', '#515468', '#7b7f98', '#b6bace', '#eceef8'], { gloss: 1, ambient: .2, round: 7, exposure: .58 });
    const R = mat(['#10020a', '#220511', '#3c0918', '#5e0f22', '#86182e', '#b02a3e', '#d24a52'], { ambient: .24, round: 7, exposure: .7 });
    // Shoulders in plate with a crimson hood, then the horned helm filling the frame.
    f.paint(spline([[-2, 66], [0, 50], [10, 42], [22, 40], [46, 40], [56, 44], [66, 54], [66, 66]]), S, { round: 8, grad: .3 });
    for (const [x, y, sc] of [[8, 48, 1.2], [56, 50, 1]]) { f.paint(ellipse(x, y, 13 * sc, 10 * sc, .1), S, { gloss: 1.1, shadow: 2 }); f.path(spline([[x - 11 * sc, y + 4], [x, y + 8 * sc], [x + 11 * sc, y + 4]], false, 3), '#0a0910', true); f.path(spline([[x - 10 * sc, y + 1], [x, y + 5 * sc], [x + 10 * sc, y + 1]], false, 3), '#8c90a8', true); }
    f.paint(spline([[18, 58], [14, 44], [20, 36], [46, 36], [52, 44], [48, 58], [34, 62]]), R, { shadow: 2, fn: (x, y) => Math.sin(y * .7 + x * .25) * .14 });
    const H = mat(['#07060c', '#141320', '#262636', '#3e3f54', '#62657e', '#9a9eb6'], { gloss: 1, round: 4, exposure: .72 });
    for (const [bx, d, sc] of [[20, -1, 1.1], [46, 1, 1]]) f.paint(ribbon([[bx, 18], [bx + d * 10 * sc, 13], [bx + d * 14 * sc, 3], [bx + d * 9 * sc, -6]], [5 * sc, 4.4 * sc, 2.6 * sc, .3], 6), H, { shadow: 1 });
    f.paint([[18, 42], [15, 22], [21, 11], [33, 6], [45, 11], [51, 22], [50, 34], [44, 44], [36, 50], [28, 46]], S, { gloss: 1.15, grad: .42, shadow: 2 });
    f.path([[35, 7], [39, 24], [39, 48]], '#b6bace', true); f.path([[36, 7], [40, 24], [40, 48]], '#0b0a12', true);
    for (let i = 0; i < 3; i++) f.line(19, 25 + i, 50, 30 + i, '#040307', true);
    for (const x of [28, 29, 30, 31, 44, 45, 46]) { const y = 27 + (x - 19) * .16; f.dot(x, y, '#ffe2f4'); f.dot(x, y + 1, '#ff4fd0'); f.glow(x, y, '#ff2ec0', 1.2); }
    for (let i = 0; i < 4; i++) f.line(42 + i * 2.4, 36, 41 + i * 2.4, 44, '#050408', true);
    f.path([[20, 36], [30, 42]], '#0b0a12', true);
  },
  fletcher(f) {
    backdrop(f, ['#3e6a58', '#2c5048', '#1e3a36', '#142824', '#0c1a18']);
    const M = mat(['#060c0c', '#0c1718', '#142526', '#1e3635', '#2c4c49', '#42686a', '#6a948e'], { ambient: .24, round: 8, exposure: .72, dither: .05 });
    const B = mat(['#160d07', '#2c1b0d', '#4a2f16', '#6e4820', '#976b30', '#c49850', '#efd088'], { gloss: 1, round: 4, exposure: .7 });
    f.paint(spline([[-2, 66], [0, 52], [12, 44], [26, 42], [44, 42], [56, 46], [66, 56], [66, 66]]), mat(['#08060a', '#120e12', '#1e1818', '#2e2420', '#44342a', '#5e4838'], { round: 6, exposure: .72 }), { grad: .3 });
    for (const [x, y] of [[9, 50], [55, 52]]) {
      for (let i = 0; i < 6; i++) { const a = 1.2 + i * .28, l = 15; f.paint(ribbon([[x, y], [x + Math.cos(a) * l, y + Math.sin(a) * l]], [3, .4], 2), mat(['#14141c', '#2a2a36', '#50505e', '#8c8c98', '#d0d0d8'], { round: 2, exposure: .8 }), { shadow: 1 }); }
      f.paint(ellipse(x, y, 9, 7, .1), B, { shadow: 2 });
    }
    f.line(14, 62, 46, 42, '#6e4820', true);
    // Hood drawn around the face, a scarf tucked under the chin, silver hair at the brow.
    f.paint(spline([[12, 56], [11, 30], [16, 14], [28, 5], [42, 6], [52, 16], [54, 30], [52, 44], [48, 56], [30, 60]]), M, { shadow: 2, grad: .42 });
    f.paint(spline([[20, 44], [19, 26], [26, 13], [38, 11], [48, 19], [49, 32], [46, 44], [34, 50]]), mat(['#02030a', '#050710', '#0a0e16'], { ambient: .6, round: 4, exposure: .5 }), { shadow: 0 });
    bigFace(f, 34, 30, SK, { iris: '#e8b03c', irisDark: '#6c3c08', brow: '#6e7184', glowCol: '#ffae2c', glow: '#ffe0a0', lip: '#7a3a30', lipL: '#a8604e' });
    const HS = mat(['#6e7184', '#a4a7ba', '#d8dae6', '#f6f7fb'], { round: 2, exposure: .86 });
    for (const [x, y, l] of [[24, 15, 14], [29, 13, 11], [34, 13, 8], [39, 14, 6]]) f.paint(ribbon([[x, y], [x + 2, y + l * .5], [x + .6, y + l]], [2.6, 2, .4], 3), HS, { shadow: 1 });
    f.paint(spline([[20, 44], [28, 40], [36, 44], [44, 42], [50, 40], [50, 50], [40, 56], [24, 56]]), M, { shadow: 2, fn: (x, y) => Math.sin(y * .9 + x * .2) * .12 });
  },
  hexer(f) {
    backdrop(f, ['#a03cb0', '#72287c', '#4c1a5c', '#2e1040', '#1c0a2a']);
    const R = mat(['#07040e', '#110a1e', '#1c1130', '#2c1a48', '#3e2662', '#553680', '#7a4ea8'], { ambient: .26, round: 8, exposure: .74 });
    const H = mat(['#2c1208', '#5c2410', '#94381a', '#cc5426', '#ee7c3c', '#ffb066'], { ambient: .3, round: 4, exposure: .78 });
    const G = mat(['#241206', '#4a2a0c', '#7c4c14', '#b37a22', '#dcaa3a', '#f6d868', '#fff4b8'], { gloss: 1, round: 2.4, exposure: .8 });
    // Hair behind, shoulders and neckline, then the face, then hair falling in front of it.
    for (const [x0, x1, x2, l, w] of [[24, 15, 11, 62, 5], [26, 19, 17, 64, 5], [28, 23, 22, 58, 4.5], [46, 51, 50, 56, 4.5]]) f.paint(ribbon([[x0, 12], [x1, 34], [x2, l]], [w, w * 1.1, 1.2], 4), H, { shadow: 1 });
    f.paint(spline([[-2, 66], [2, 52], [16, 46], [26, 46], [44, 46], [54, 48], [66, 58], [66, 66]]), R, { grad: .3, shadow: 2 });
    f.paint(capsule(30, 56, 32, 42, 6, 6), SKP, { shadow: 1 });
    f.path([[16, 49], [30, 62], [46, 49]], '#d8a848', true); f.path([[17, 48], [30, 60], [45, 48]], '#6e4c18', true);
    for (const [bx, d, sc] of [[23, -1, 1.1], [45, 1, 1]]) f.paint(ribbon([[bx, 14], [bx + d * 7 * sc, 7], [bx + d * 5 * sc, -5]], [3.4 * sc, 2.6 * sc, .3], 5), mat(['#07060c', '#141320', '#262636', '#3e3f54', '#62657e'], { gloss: 1, round: 2, exposure: .7 }), { shadow: 1 });
    bigFace(f, 33, 28, SKP, { iris: '#ff4ad8', irisDark: '#7a1468', brow: '#7a2c14', glowCol: '#ff2ec8', glow: '#ffd0f4', lip: '#b43c50', lipL: '#e07c88' });
    f.paint(spline([[20, 32], [19, 20], [24, 10], [34, 8], [44, 11], [48, 18], [44, 17], [36, 15], [28, 18], [25, 26], [23, 36]]), H, { shadow: 2 });
    for (const [x, y, l, c] of [[26, 11, 12, .8], [31, 10, 8, 1], [36, 11, 7, 1.2], [41, 12, 6, 1]]) f.paint(ribbon([[x, y], [x + c, y + l * .5], [x + c * .3, y + l]], [2.6, 1.8, .3], 3), H, { shadow: 1 });
    f.paint(ribbon([[22, 13], [34, 8], [46, 13]], [1.5, 1.8, 1.5], 3), G, { shadow: 1 });
    f.paint(ellipse(34, 8, 2.6, 2.6), mat(['#4c0c30', '#a8205c', '#ff5ca0', '#ffd0e4'], { gloss: 1.3, round: 2.4 }), { shadow: 1 });
    f.glow(34, 8, '#ff3c9c', .8);
  },
  mender(f) {
    backdrop(f, ['#f4dc90', '#d8b460', '#a8843c', '#745a24', '#4a3814']);
    for (let i = 0; i < 56; i++) { const a = i / 56 * TAU, r = 25 + (i % 2); f.glow(31 + Math.cos(a) * r, 26 + Math.sin(a) * r, '#fff0b0', .9); if (i % 7 === 0) f.glowLine(31 + Math.cos(a) * (r + 1), 26 + Math.sin(a) * (r + 1), 31 + Math.cos(a) * (r + 6), 26 + Math.sin(a) * (r + 6), '#fff4c8', .7); }
    const W = mat(['#2a2a38', '#4c4c5e', '#747488', '#9c9cb0', '#c4c4d4', '#e4e4ee', '#ffffff'], { gloss: 1, ambient: .3, round: 6, exposure: .74 });
    const I = mat(['#2e2a2a', '#524a44', '#7c7262', '#a89c84', '#d0c6a8', '#ece4c8', '#fff8e4'], { ambient: .28, round: 9, exposure: .78, dither: .03 });
    const G = mat(['#241206', '#4a2a0c', '#7c4c14', '#b37a22', '#dcaa3a', '#f6d868', '#fff4b8'], { gloss: 1, round: 2.4, exposure: .8 });
    f.paint(spline([[-2, 66], [0, 52], [12, 44], [24, 42], [44, 42], [56, 46], [66, 56], [66, 66]]), W, { grad: .3, shadow: 2 });
    for (const [x, y] of [[9, 50], [55, 52]]) { f.paint(ellipse(x, y, 10, 8, .1), W, { gloss: 1.1, shadow: 2 }); f.path(spline([[x - 9, y + 3], [x, y + 7], [x + 9, y + 3]], false, 3), '#b5862c', true); }
    f.paint(spline([[12, 58], [10, 30], [15, 14], [27, 6], [41, 7], [51, 16], [53, 30], [50, 46], [46, 58], [30, 62]]), I, { shadow: 2, grad: .4 });
    bigFace(f, 33, 29, SK, { iris: '#4aa8e0', irisDark: '#144070', brow: '#a8a0a0', lip: '#b05a50', lipL: '#dc8c80' });
    f.paint(spline([[20, 26], [22, 15], [32, 11], [44, 13], [47, 21], [42, 17], [32, 17], [25, 21]]), mat(['#8088a0', '#b8bed0', '#e8ecf4', '#ffffff'], { round: 3, exposure: .9 }), { shadow: 2 });
    f.paint(ribbon([[17, 16], [33, 9], [48, 15]], [1.7, 2.1, 1.7], 3), G, { shadow: 1 });
    f.paint(ellipse(33, 9, 2.4, 2.4), mat(['#0a3c78', '#3a94f0', '#a0dcff', '#ffffff'], { gloss: 1.3, round: 2.2 }), { shadow: 1 });
    f.paint(spline([[19, 46], [28, 44], [38, 46], [47, 44], [48, 54], [34, 58], [20, 56]]), I, { shadow: 2 });
    const c = [34, 56]; rowsDot(f, ['..G..', '..G..', 'GGWGG', '..G..', '..G..'], c[0] - 2, c[1] - 2, { G: '#b8801c', W: '#fff4b8' });
  },
};
function rowsDot(f, list, x, y, map) { list.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (map[row[i]]) f.dot(x + i, y + j, map[row[i]]); }); }
export function renderBust(key) {
  const f = new Frame(BUST.w, BUST.h, 0, 0);
  BUSTS[key](f);
  f.finish({});
  return f;
}
void shift; void capsule; void cloth; void rnd;
