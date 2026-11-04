// Inventory art: every item slot redrawn for each material tier, plus gems, skills, runes and
// the hero portraits. Items are 24 by 24 pixels and shown at double size, so every pixel counts.
import { Frame, mat, spline, ellipse, capsule, ribbon, rotate, shift, encodePNG } from './raster.mjs';
import { rnd, TAU, lerp, cloth } from './rig.mjs';
import { renderCatHead } from './heroes.mjs';

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
// The DND token: a gold coin struck with a dragon's head. One drawing makes the in-game icon, the
// tab icon and the launch logo, so they can never drift apart. Fine lines only appear where they fit.
const COIN_RIM = mat(['#4a2a06', '#8a5a0e', '#c48a18', '#eab42c', '#ffd94e', '#fff09a', '#fffde0'], { gloss: 1.1, ambient: .34, round: 5, exposure: .84 });
const COIN_FIELD = mat(['#8a5a0e', '#b47c14', '#d89c1e', '#f0bc30', '#fcd650', '#ffe884'], { ambient: .5, round: 3, exposure: .7 });
const DRAGON_INK = mat(['#16040a', '#2c0810', '#4c0e12', '#741a14', '#9c2c18'], { ambient: .4, gloss: .35, round: 2.5, exposure: .7 });
const FLAT = cols => mat(cols, { ambient: 1, round: 1 });
const DRAGON_SKULL = [[20, 31], [24, 24], [30, 21], [36, 21], [40, 25], [47, 27], [50, 24.6], [54, 25.4], [56, 29], [54.6, 32.6], [46, 33.6], [38, 34.6], [33, 36], [40, 39.6], [47, 39.8], [51, 41], [49.6, 44], [41, 46.6], [32, 47], [26, 45]];
export function renderTokenLogo(size = 64) {
  const f = new Frame(size, size, 0, 0), k = size / 64, fine = size >= 48;
  const P = pts => pts.map(([x, y]) => [x * k, y * k]);
  const R = (pts, widths) => ribbon(P(pts), widths.map(w => w * k), 4);
  const at = (a, r) => [(32 + Math.cos(a) * r) * k, (32 + Math.sin(a) * r) * k];
  f.paint(P(ellipse(32, 32, 31.6, 31.6, 0, 56)), FLAT(['#1c0e02', '#34200a']), { shadow: 0, edge: 0 });
  f.paint(P(ellipse(32, 32, 30, 30, 0, 56)), COIN_RIM, { round: 6 * k, gloss: 1.1, grad: .34, shadow: 0 });
  if (fine) for (let i = 0; i < 60; i++) { const a = i / 60 * TAU, u = at(a, 26.4), v = at(a, 28.8); f.line(u[0], u[1], v[0], v[1], i % 2 ? '#a06c12' : '#fff0a0', true); }
  f.paint(P(ellipse(32, 32, 25.6, 25.6, 0, 48)), FLAT(['#3a2006', '#5a3a0a']), { shadow: 0, edge: 0 });
  f.paint(P(ellipse(32.2, 32.4, 24.4, 24.4, 0, 48)), COIN_FIELD, { round: 4 * k, grad: .42, shadow: 0, edge: 0 });
  // The head, built from curved parts: far horn, near horn, spined neck, back fins, then the skull.
  const parts = [
    R([[32, 24], [29, 15], [22, 9.4], [15.6, 10.6]], [2.6, 2.1, 1.3, .2]),
    R([[27, 26], [21, 18], [13.4, 15.4], [8, 19.6]], [3.2, 2.5, 1.5, .2]),
    R([[31, 56], [23.6, 48], [22, 38], [25, 30]], [.4, 4.8, 6, 6.4]),
    P([[20, 48.4], [12.6, 49], [18.4, 44]]), P([[17.8, 42.6], [10, 41], [17, 37.6]]), P([[18, 36], [10.6, 32.6], [19.4, 31]]),
    P([[25, 37], [14.4, 25.4], [22, 28]]),
    spline(P(DRAGON_SKULL), true, 3),
  ];
  for (const p of parts) f.paint(shift(p, k, 1.4 * k), FLAT(['#7a4c0a', '#8a5a10']), { shadow: 0, edge: 0 });
  for (const p of parts) f.paint(p, DRAGON_INK, { round: 3 * k, grad: .3, shadow: 0, edge: 0 });
  f.paint(P([[32.4, 26.2], [39.4, 28.6], [34, 30]]), FLAT(['#ffb02c', '#ffe25a']), { shadow: 0, edge: 0 });
  for (const q of [[47.6, 33.4, 48.6, 37.6, 45.4, 33.8], [41.6, 34, 42.4, 37.4, 39.6, 34.4], [45.6, 40, 46, 36.6, 43.4, 39.8]]) f.paint(P([[q[0], q[1]], [q[2], q[3]], [q[4], q[5]]]), FLAT(['#fff4d0', '#ffffff']), { shadow: 0, edge: 0 });
  // At larger sizes: the nostril, the jaw and brow lines, and scales down the neck.
  if (fine) {
    const x = (p, q, col) => { const [a, b] = P([p, q]); f.line(a[0], a[1], b[0], b[1], col, true); };
    x([50.6, 28], [53, 28.6], '#e8862c');
    for (const [p, q] of [[[31, 25], [40, 26.4]], [[32, 36.4], [28, 41]], [[23, 33], [20.6, 40]], [[25, 38], [24.4, 46]], [[20, 41], [21.4, 48]], [[34.6, 44.6], [45, 43.4]]]) x(p, q, '#a8341c');
    x([24, 21.4], [17.4, 17], '#a8341c'); x([31, 18], [27, 12.6], '#a8341c');
  }
  // A glint on the rim.
  const g = at(-.72, 27.2), r = fine ? 2.4 : 1;
  f.line(g[0] - r, g[1], g[0] + r, g[1], '#ffffff'); f.line(g[0], g[1] - r, g[0], g[1] + r, '#ffffff');
  f.finish({});
  return f;
}
export const renderMark = () => renderTokenLogo(24);
// The logo as a PNG with a transparent background, enlarged in whole steps so its pixels stay crisp.
export function tokenLogoPNG(scale = 1) {
  const f = renderTokenLogo(64), size = 64 * scale, out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const from = (Math.floor(y / scale) * 64 + Math.floor(x / scale)) * 4, to = (y * size + x) * 4;
    for (let i = 0; i < 4; i++) out[to + i] = f.c[from + i];
  }
  return encodePNG(out, size, size);
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
function backdrop(f, cols) {
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const d = Math.hypot(x - 34, y - 26) / 46, i = Math.max(0, Math.min(cols.length - 1, Math.floor(d * cols.length + (((x ^ y) & 1) ? .22 : -.22))));
    f.dot(x, y, cols[i]);
  }
}
// Portraits use the same cat heads as the sprites, larger, over a coloured glow and a pair of shoulders.
const BUSTS = {
  warden(f) {
    backdrop(f, ['#7a1c28', '#561420', '#3a0e18', '#260a12', '#180610']);
    const S = mat(['#161824', '#2c3040', '#4a4f62', '#6e7488', '#9499ae', '#bcc2d4', '#e0e5f0', '#ffffff'], { gloss: 1, ambient: .26, round: 6, exposure: .7 });
    const R = mat(['#10020a', '#220511', '#3c0918', '#5e0f22', '#86182e', '#b02a3e', '#d24a52'], { ambient: .24, round: 7, exposure: .7 });
    f.paint(spline([[-2, 66], [0, 54], [10, 50], [52, 50], [64, 54], [66, 66]]), R, { fn: (x, y) => Math.sin(y * .7 + x * .25) * .14 });
    f.paint(spline([[10, 66], [12, 54], [22, 50], [42, 50], [52, 54], [54, 66]]), S, { grad: .3, shadow: 2 });
    for (const [x, y, sc] of [[9, 56, 1], [54, 57, .86]]) {
      f.paint(ellipse(x, y, 10 * sc, 7.6 * sc, .1), S, { gloss: 1.1, shadow: 2 });
      f.path(spline([[x - 9 * sc, y + 3], [x, y + 6.4 * sc], [x + 9 * sc, y + 3]], false, 3), '#e8b84a', true);
    }
    renderCatHead(f, 'warden', 31, 39, 1.2);
  },
  fletcher(f) {
    backdrop(f, ['#3e6a58', '#2c5048', '#1e3a36', '#142824', '#0c1a18']);
    const G = mat(['#071a0d', '#0e3018', '#164a24', '#206632', '#2e8442', '#46a456', '#7ccb7e'], { ambient: .3, round: 6, exposure: .76 });
    f.paint(spline([[-2, 66], [2, 56], [14, 52], [50, 52], [62, 56], [66, 66]]), G, { grad: .3 });
    f.paint(spline([[12, 66], [14, 54], [24, 52], [40, 52], [50, 54], [52, 66]]), mat(['#1c0e06', '#38200e', '#5a3618', '#7e4f24', '#a56c34', '#cc9250'], { ambient: .3, round: 4, exposure: .76 }), { shadow: 2 });
    f.line(31, 53, 31, 64, '#f6d868', true);
    renderCatHead(f, 'fletcher', 31, 42, 1.14);
  },
  hexer(f) {
    backdrop(f, ['#a03cb0', '#72287c', '#4c1a5c', '#2e1040', '#1c0a2a']);
    const R = mat(['#0c0618', '#1a0e2e', '#2a1848', '#3e2466', '#553488', '#7048ac', '#9a70d4'], { ambient: .26, round: 7, exposure: .74 });
    f.paint(spline([[-2, 66], [2, 56], [14, 53], [50, 53], [62, 56], [66, 66]]), R, { grad: .3 });
    f.path([[18, 55], [31, 64], [46, 55]], '#d8a848', true);
    renderCatHead(f, 'hexer', 31, 46, 1.08);
  },
  mender(f) {
    backdrop(f, ['#f4dc90', '#d8b460', '#a8843c', '#745a24', '#4a3814']);
    const W = mat(['#2a2a38', '#4c4c5e', '#747488', '#9c9cb0', '#c4c4d4', '#e4e4ee', '#ffffff'], { gloss: 1, ambient: .3, round: 6, exposure: .74 });
    f.paint(spline([[-2, 66], [2, 56], [14, 52], [50, 52], [62, 56], [66, 66]]), W, { grad: .3, shadow: 2 });
    for (const [x, y] of [[9, 57], [54, 58]]) { f.paint(ellipse(x, y, 9, 7, .1), W, { gloss: 1.1, shadow: 2 }); f.path(spline([[x - 8, y + 2.6], [x, y + 6], [x + 8, y + 2.6]], false, 3), '#b5862c', true); }
    renderCatHead(f, 'mender', 31, 41, 1.16);
  },
};
export function renderBust(key) {
  const f = new Frame(BUST.w, BUST.h, 0, 0);
  BUSTS[key](f);
  f.finish({});
  return f;
}
void shift; void capsule; void cloth; void rnd;
