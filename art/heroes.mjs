// The four heroes are cats, seen from a three-quarter front view and facing right. That means the
// near shoulder sits toward the back of the chest and the far shoulder toward the front, so arms
// reach naturally across the body. Each frame is built back to front from animated layers.
import { Frame, mat, spline, ellipse, capsule, ribbon, rotate, shift } from './raster.mjs';
import { ik, timeline, gait, cloth, lerp, TAU, rnd, easeOut, easeIn } from './rig.mjs';

export const FRAME = { w: 208, h: 150, ox: 96, oy: 136 };

const SILVER = mat(['#161824', '#2c3040', '#4a4f62', '#6e7488', '#9499ae', '#bcc2d4', '#e0e5f0', '#ffffff'], { gloss: 1, ambient: .26, round: 3.4, exposure: .7 });
const SILVER_DK = mat(['#0c0d16', '#1b1d2a', '#2f3242', '#474b5e', '#676b80', '#8c90a6'], { gloss: .7, ambient: .22, round: 3, exposure: .64 });
const BLADE = mat(['#20212e', '#3a3c4e', '#585b70', '#7e8298', '#a8acc0', '#cfd2e0', '#f2f4fb'], { gloss: .8, ambient: .3, round: 3, exposure: .72 });
const GOLD = mat(['#241206', '#4a2a0c', '#7c4c14', '#b37a22', '#dcaa3a', '#f6d868', '#fff4b8'], { gloss: .8, ambient: .24, round: 2 });
const CRIMSON = mat(['#10020a', '#220511', '#3c0918', '#5e0f22', '#86182e', '#b02a3e', '#d24a52'], { ambient: .2, round: 6, dither: .05, exposure: .62 });
const CRIMSON_IN = mat(['#080106', '#14030a', '#240610', '#3a0a18'], { ambient: .3, round: 6, exposure: .6 });
const PLUME = mat(['#2a0410', '#560a1c', '#8e1428', '#c4223a', '#e84c54', '#ff8a80'], { ambient: .3, round: 3, exposure: .75 });
const LEATHER = mat(['#120a08', '#26160e', '#402616', '#5e3a20', '#80522e', '#a67044'], { ambient: .26, round: 3 });
// Fur. Shadows drift warm or cool to suit the coat, and every coat keeps a soft top light.
const FUR = {
  ginger: mat(['#4a1e08', '#7c3610', '#b05818', '#d87e28', '#f0a040', '#fcc468', '#ffe09a'], { ambient: .42, round: 5, exposure: .8 }),
  gingerDk: mat(['#3a1606', '#622a0c', '#8e4412', '#b05818'], { ambient: .5, round: 2, exposure: .7 }),
  grey: mat(['#23252e', '#3c3f4a', '#585c68', '#787c88', '#9a9ea8', '#bfc2c9', '#e4e6ea'], { ambient: .42, round: 5, exposure: .82 }),
  greyDk: mat(['#14151c', '#23252e', '#343742', '#484b58'], { ambient: .5, round: 2, exposure: .7 }),
  black: mat(['#040308', '#0a0810', '#13101c', '#1e1a2a', '#2c2740', '#423a5c', '#6b608c'], { ambient: .3, round: 5, exposure: .72, gloss: .3 }),
  blackLt: mat(['#120f1c', '#1e1a2c', '#2c2740', '#3e3756', '#57506e'], { ambient: .4, round: 3, exposure: .74 }),
  white: mat(['#6e6a7c', '#9c98aa', '#c6c3d0', '#e6e4ec', '#f8f7fa', '#ffffff'], { ambient: .5, round: 5, exposure: .85 }),
  whiteDk: mat(['#8a8698', '#a8a4b4', '#c4c1cc'], { ambient: .6, round: 2, exposure: .7 }),
  cream: mat(['#a08a78', '#c8b4a0', '#e6d8c8', '#f8f0e4', '#ffffff'], { ambient: .55, round: 4, exposure: .85 }),
};
const EAR_PINK = mat(['#7a3a48', '#a85868', '#d08490', '#f0b0b4'], { ambient: .5, round: 2, exposure: .8 });
const EAR_ORANGE = mat(['#6a2c08', '#a24c10', '#d8761e', '#f4a040'], { ambient: .5, round: 2, exposure: .8 });
const EYE = mat(['#04030a', '#0a0812', '#141022'], { ambient: .6, round: 2, exposure: .4 });
const SHINE = mat(['#e8ecf8', '#ffffff'], { ambient: 1, round: 1 });
const NOSE = mat(['#7a2c3a', '#b44e5e', '#e08088', '#f8b4b4'], { ambient: .5, round: 1.5, exposure: .8 });
const IRIS = {
  amber: mat(['#6a3408', '#b0640e', '#e89a20', '#ffd060'], { ambient: .6, round: 2, exposure: .7 }),
  yellow: mat(['#7a5a06', '#c49a10', '#f4d020', '#fff4a0'], { ambient: .7, round: 2, exposure: .7 }),
  blue: mat(['#123c78', '#2a70b8', '#58aee8', '#b4e4ff'], { ambient: .6, round: 2, exposure: .7 }),
};

// ---------------------------------------------------------------- body parts everyone shares
const along = (a, b, k, off = [0, 0]) => [lerp(a[0], b[0], k) + off[0], lerp(a[1], b[1], k) + off[1]];
// A leg with real shape: a thick thigh, a kneecap, a calf that bulges behind the bone, a narrow
// ankle, and a foot that rolls from heel to toe. The third value of foot is how far it has rolled.
export function leg(f, hip, foot, m, boot, o = {}) {
  const roll = o.roll === undefined ? foot[2] || 0 : o.roll;
  const pivot = roll > 0 ? [foot[0] + 8, foot[1] - 1] : [foot[0] - 4, foot[1] - 1];
  const ankleAt = rotate([[foot[0], foot[1] - 5.5]], roll, pivot[0], pivot[1])[0];
  const th = o.thigh || 21, sh = o.shin || 21, r0 = o.hipR || 6.2, rK = r0 * .62, rA = rK * .64;
  const j = ik(hip[0], hip[1], ankleAt[0], ankleAt[1], th, sh, -1), knee = j.mid, ank = j.end;
  // Thigh muscle sits toward the front of the leg, the calf toward the back.
  f.paint(ribbon([hip, along(hip, knee, .42, [.9, 0]), knee], [r0, r0 * .9, rK], 4), m, { round: 4 });
  f.paint(ribbon([knee, along(knee, ank, .34, [-1.1, 0]), ank], [rK, rK * 1.1, rA], 4), boot || m, { round: 3.5 });
  const sole = rotate([[-4.6, -5.2], [-5.2, -1.6], [-4.4, .9], [9.6, .9], [11.6, -.6], [9.4, -3], [4.6, -4.6], [2.4, -6.4]], roll, pivot[0] - foot[0], pivot[1] - foot[1]);
  f.paint(shift(sole, foot[0], foot[1]), boot || m, { round: 2.5 });
  return { knee, ank };
}
// An arm that tapers from shoulder to wrist and ends in a closed hand with a thumb.
export function armSeg(f, sh, hand, m, glove, o = {}) {
  const up = o.upper || 15, fo = o.fore || 15, r0 = o.r0 || 4.2, rE = r0 * .72;
  const j = ik(sh[0], sh[1], hand[0], hand[1], up, fo, o.bend === undefined ? 1 : o.bend), wr = j.end;
  const el = o.elbow ? [lerp(j.mid[0], o.elbow[0], o.elbowK), lerp(j.mid[1], o.elbow[1], o.elbowK)] : j.mid;
  j.mid = el;
  f.paint(ribbon([sh, along(sh, el, .45), el], [r0, r0 * .92, rE], 3), m, { round: 3.5 });
  f.paint(ribbon([el, along(el, wr, .35), wr], [rE, rE * 1.04, rE * .68], 3), o.sleeve || m, { round: 3 });
  if (o.noHand) return j;
  const a = Math.atan2(wr[1] - el[1], wr[0] - el[0]);
  const fist = rotate([[-1.6, -2.2], [2.2, -2.8], [4.2, -1.4], [4.2, 1.4], [2.2, 2.6], [-1.6, 2]], a, wr[0], wr[1]);
  f.paint(fist, glove || m, { round: 2, shadow: 1 });
  const k1 = rotate([[3, -.8], [3, 1.2]], a, wr[0], wr[1]);
  const tones = (glove || m).tones;
  f.line(k1[0][0], k1[0][1], k1[1][0], k1[1][1], tones[Math.max(0, tones.length - 5)], true);
  return j;
}
// A tattered cloak or cape, cut along the bottom with torn notches.
export function tatteredCloth(chainA, chainB, seed, depth = 9, teeth = 7) {
  const out = chainA.slice(), a = chainA[chainA.length - 1], b = chainB[chainB.length - 1];
  for (let i = 1; i < teeth * 2; i++) {
    const t = i / (teeth * 2), x = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t);
    const tear = i % 2 ? -rnd(seed, i) * depth - 2 : rnd(seed, i + 40) * depth * .4;
    out.push([x, y + tear]);
  }
  return out.concat(chainB.slice().reverse());
}
export function rows(f, list, x, y, map) {
  list.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (map[row[i]]) f.dot(x + i, y + j, map[row[i]]); });
}
// ---------------------------------------------------------------- the cat rig
// A big head on a short body, stubby limbs and a tail. T walks up the spine from the hip, then
// across the body: s above zero is toward the front.
const HIP = -24, ARM = 11.5;
function bones(p) {
  const hip = p.hip, b = p.breath || 0, ux = Math.sin(p.lean), uy = -Math.cos(p.lean);
  const T = (a, s) => [hip[0] + ux * a - uy * s, hip[1] + uy * a + ux * s];
  const neck = T(19 + b * .3, 1), a = p.lean * .36 + (p.nod || 0);
  // The head stays nearly level while the body leans, which is much of what makes a figure feel alive.
  return { hip, T, neck, shN: T(15 + b * .3, -5), shF: T(15.4 + b * .3, 5.8), hx: neck[0] + Math.sin(a) * 13 + 1.4, hy: neck[1] - Math.cos(a) * 13, tilt: p.headTilt === undefined ? a * .7 : p.headTilt };
}
const reach = (sh, h, L = ARM * 2) => { const d = Math.hypot(h[0] - sh[0], h[1] - sh[1]); return d <= L ? h : [sh[0] + (h[0] - sh[0]) / d * L, sh[1] + (h[1] - sh[1]) / d * L]; };
function strand(x, y, len, n, ang, curl, wave = 0, phase = 0) {
  const pts = [[x, y]], seg = len / n;
  for (let i = 1; i <= n; i++) {
    ang += curl + Math.sin(phase * TAU - i * .9) * wave;
    x += Math.cos(ang) * seg; y += Math.sin(ang) * seg;
    pts.push([x, y]);
  }
  return pts;
}
// A short leg ending in a soft round paw that rolls from heel to toe.
function pawLeg(f, hip, foot, m, boot, o = {}) {
  const roll = foot[2] || 0, r0 = o.r0 || 5, px = roll > 0 ? 5 : -3, py = -1, at = [foot[0] + px, foot[1] + py];
  const ankle = rotate([[-px, -4 - py]], roll, at[0], at[1])[0];
  const j = ik(hip[0], hip[1], ankle[0], ankle[1], o.thigh || 12, o.shin || 11, -1), knee = j.mid, ank = j.end;
  f.paint(ribbon([hip, along(hip, knee, .45, [.6, 0]), knee], [r0, r0 * .92, r0 * .74], 3), m, { round: 3.5 });
  f.paint(ribbon([knee, along(knee, ank, .4, [-.6, 0]), ank], [r0 * .74, r0 * .78, r0 * .62], 3), boot || m, { round: 3 });
  const sole = spline([[-3.6, -4.6], [-4.2, -1.4], [-3.2, .9], [7, .9], [8.8, -.9], [7.4, -3.2], [3.6, -4.8], [1.4, -5.6]].map(([x, y]) => [x - px, y - py]), true, 3);
  f.paint(rotate(sole, roll, at[0], at[1]), boot || m, { round: 2.5 });
  return { knee, ank };
}
function catArm(f, sh, hand, m, paw, o = {}) {
  const r0 = o.r0 || 3.6, rE = r0 * .8;
  const j = ik(sh[0], sh[1], hand[0], hand[1], ARM, ARM, o.bend === undefined ? 1 : o.bend), wr = j.end;
  f.paint(ribbon([sh, along(sh, j.mid, .5), j.mid], [r0, r0 * .96, rE], 2), m, { round: 3 });
  f.paint(ribbon([j.mid, along(j.mid, wr, .5), wr], [rE, rE * 1.02, rE * .9], 2), o.sleeve || m, { round: 2.6 });
  const a = Math.atan2(wr[1] - j.mid[1], wr[0] - j.mid[0]), cx = wr[0] + Math.cos(a) * 1.4, cy = wr[1] + Math.sin(a) * 1.4;
  f.paint(ellipse(cx, cy, 3.8, 3.3, a, 14), paw, { round: 2.4, shadow: 1 });
  const tones = paw.tones, toe = tones[Math.max(0, tones.length - 5)];
  for (const q of [-1.1, 1.1]) { const [u, v] = rotate([[1.2, q], [3.4, q]], a, cx, cy); f.line(u[0], u[1], v[0], v[1], toe, true); }
  return j;
}
function catTail(f, J, p, m, o = {}) {
  const run = p.speed > 0, base = J.T(1.5, -5), len = o.len || 32;
  const pts = p.limp ? strand(base[0], base[1], len * .8, 6, 2.9, -.05)
    : run ? strand(base[0], base[1], len, 6, Math.PI - .2, .1, .16, p.phase * 2)
    : strand(base[0], base[1], len, 6, Math.PI - .34, .24, .1, p.phase);
  f.paint(ribbon(pts, [3.2, 3.4, 3.4, 3.2, 3, 2.6, 1.4], 3), m, { shadow: 1, round: 3 });
  if (o.band) for (const i of [2, 4]) {
    const a = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]) + Math.PI / 2, r = 3.4, x = pts[i][0], y = pts[i][1];
    f.line(x - Math.cos(a) * r, y - Math.sin(a) * r, x + Math.cos(a) * r, y + Math.sin(a) * r, o.band, true);
  }
  if (o.tip) f.paint(ribbon(pts.slice(-2), [2.3, 1], 3), o.tip, { shadow: 0, round: 2 });
}
function capeLayers(f, J, p, m, lining, o = {}) {
  const run = p.speed > 0, phase = p.phase * (run ? 2 : 1);
  const trail = run ? 1 + Math.sin(p.phase * TAU * 2) * .09 : (p.windBack === undefined ? .1 : p.windBack) + .08;
  const len = Math.max(8, (o.len || 31) + (HIP - 19 - J.neck[1]) * .6), wide = o.wide || 12, ax = J.shF[0] - 3, bx = J.shN[0] - wide;
  const a = cloth(ax, J.shF[1] - 1, len, 6, { sway: run ? 2 : 1.4, trail: trail * .5, phase });
  const b = cloth(bx, J.shN[1] + 1.5, len + 1, 6, { sway: run ? 3 : 1.8, trail: trail + .32, phase: phase + .2 });
  const c = cloth(lerp(ax, bx, .58), J.shN[1], len + .5, 6, { sway: run ? 2.4 : 1.6, trail: trail * .8 + .16, phase: phase + .1 });
  if (lining) f.paint(tatteredCloth(shift(a, 3, 0), shift(c, 3, 0), 23, 4, 5), lining, { round: 5, shadow: 0 });
  f.paint(tatteredCloth(a, b, o.seed || 11, o.tear === undefined ? 5 : o.tear, o.teeth || 6), m, { round: 7, grad: .42, shadow: 0, fn: (x, y) => Math.sin(x * .8 + y * .05) * .1 });
  for (const k of [.34, .68]) {
    const fold = a.map((q, i) => [lerp(q[0], b[i][0], k), lerp(q[1], b[i][1], k)]).slice(1, -1);
    f.path(spline(fold, false, 3), o.foldDark || '#07060c', true);
    f.path(shift(spline(fold, false, 3), 1, 0), o.foldLight || '#3d384e', true);
  }
}
// Shared timing for everything that isn't an attack.
function basePose(anim, t) {
  if (anim === 'run') {
    const g = gait(t, 9, 7, 1);
    return { hip: [g.sway * .4, HIP + g.bob * .7], lean: .15 + g.sway * .012, near: g.near, far: g.far, swing: g.swing, phase: t, speed: 1, nod: -.03 + Math.cos(t * TAU * 2) * .025 };
  }
  if (anim === 'idle') {
    // Weight drifts slowly from foot to foot while the chest rises and falls.
    const b = Math.sin(t * TAU * 2), w = Math.sin(t * TAU + .4);
    return { hip: [w * .6, HIP + b * .4 + Math.abs(w) * .2], lean: .05 + b * .008 - w * .006, near: [-6.5, 0], far: [7.5, 0], swing: 0, phase: t, speed: 0, breath: b, nod: b * .012 + w * .025, weight: w };
  }
  return { hip: [0, HIP], lean: .04, near: [-6.5, 0], far: [7.5, 0], swing: 0, phase: t, speed: 0 };
}
function downPose(t) {
  const k = easeIn(Math.min(1, t * 1.15));
  return { k, hip: [lerp(0, -3, k), lerp(HIP, -9.5, k)], lean: lerp(.04, -1.45, k), near: [lerp(-6.5, 15, k), 0], far: [lerp(7.5, 12, k), 0], nod: k * -.3, headTilt: k * -1.1, limp: k > .6, windBack: .1 };
}
const hurtKey = k => ({ hip: [-3.5 * k, HIP + .6 * k], lean: -.22 * k + .04, nod: -.16 * k, windBack: -.06 });
// Stubby arms can't clear a big head. A paw raised across the face passes behind it instead.
const overFace = (h, J) => h[1] < J.hy + 14 && h[0] > J.hx - 17 && h[0] < J.hx + 19;
const freeArm = (sh, swing, far = 7) => [sh[0] + 3 - swing * far, sh[1] + 15 - Math.abs(swing) * 2.4];
const moodOf = (anim, t, n) => (anim === 'hurt' ? 'hurt' : anim === 'down' ? (t > .4 ? 'out' : 'hurt') : anim === 'idle' ? (n === 9 || n === 10 ? 'blink' : 'calm') : anim === 'run' || t < .12 || t > .86 ? 'calm' : 'fierce');

// ---------------------------------------------------------------- faces
const HEAD_ROUND = [[-16, 1], [-15.5, -7], [-10, -13], [0, -15], [10, -14], [16, -8], [17.5, 0], [15.5, 7], [9, 12.5], [0, 13.5], [-9, 12], [-14.5, 7]];
const HEAD_SQUARE = [[-17.5, 0], [-17, -9.5], [-12, -14.5], [1, -15.4], [12.5, -14.5], [17.5, -9.5], [18.5, 0], [17.5, 7.5], [12.5, 12.6], [1, 13.6], [-11, 12.6], [-16.5, 7.5]];
const EARS = {
  near: [[-16, -6], [-17, -18], [-15.5, -27], [-11.5, -24], [-3, -15]], nearIn: [[-14.4, -9], [-15, -22.5], [-6, -14]],
  far: [[3, -15], [12, -24.5], [15, -26], [16.5, -17], [16, -6]], farIn: [[7, -14], [13.5, -22.5], [14.8, -9]],
};
const STRIPES = {
  tabby: [[[-3.4, -14.4], [-2.4, -8.4]], [[2.6, -15], [2.8, -9]], [[8.6, -14.4], [7.8, -8.6]], [[-16.4, -1], [-9.6, .6]], [[-15.8, 3.6], [-9.8, 4.2]], [[17.4, -2], [15.2, -1.2]]],
  cheek: [[[-16, 1], [-10.4, 2]], [[-15.2, 5], [-10, 5.4]], [[-10.4, -8], [-7.4, -5]], [[15.8, 1], [14, 1.4]]],
};
function catEar(f, H, shape, inside, fur, innerM, twitch = 0, pivot = [0, 0]) {
  const bend = pts => (twitch ? rotate(pts.map(([x, y]) => [x - pivot[0], y - pivot[1]]), twitch, pivot[0], pivot[1]) : pts);
  f.paint(H(spline(bend(shape), true, 4)), fur, { round: 3, shadow: 1 });
  f.paint(H(spline(bend(inside), true, 3)), innerM, { round: 2, shadow: 0, edge: 0 });
}
function catEars(f, H, o, which = 'both') {
  if (which !== 'near') catEar(f, H, EARS.far, EARS.farIn, o.fur, o.inner || EAR_PINK);
  if (which !== 'far') catEar(f, H, EARS.near, EARS.nearIn, o.fur, o.inner || EAR_PINK, o.twitch, [-10, -12]);
}
// A soft, oversized face: the far eye is narrower because it turns away from us.
function catHead(f, hx, hy, tilt, s, o) {
  const H = pts => rotate(pts.map(([x, y]) => [x * s, y * s]), tilt, hx, hy);
  const P = (x, y) => H([[x, y]])[0], mood = o.mood || 'calm', fur = o.fur, ink = o.ink || '#17101a';
  const L = (x0, y0, x1, y1, col, opaque = true) => { const a = P(x0, y0), b = P(x1, y1); f.line(a[0], a[1], b[0], b[1], col, opaque); };
  if (o.ears !== false) catEars(f, H, o);
  f.paint(H(spline(o.square ? HEAD_SQUARE : HEAD_ROUND)), fur, { round: 6 * s, shadow: 2, grad: .26 });
  f.paint(H([[-15.5, 3.5], [-19.2, 7], [-15.8, 7.6], [-17.2, 11], [-11.5, 10]]), fur, { shadow: 0, round: 2, edge: 0 });
  if (o.mark) for (const seg of o.stripes || STRIPES.tabby) f.paint(H(ribbon(seg, [1.25, .35], 2)), o.mark, { shadow: 0, edge: 0, round: 1 });
  // White muzzle set toward the front, then the nose and a small split mouth.
  f.paint(H(ellipse(7.6, 6, 8.5, 5.8, 0, 18)), o.muzzle || FUR.cream, { shadow: 1, round: 4 * s, edge: 0, grad: .14 });
  if (o.bib) f.paint(H(ellipse(5, 12, 7.4, 2, 0, 12)), o.muzzle || FUR.cream, { shadow: 0, round: 2, edge: 0 });
  f.paint(H([[5.5, 1.7], [9.3, 1.7], [7.4, 4.1]]), NOSE, { shadow: 0, round: 1.2, edge: 0 });
  const mouth = o.mouth || '#6a4a4e';
  L(7.4, 4.2, 7.4, 5.6, mouth);
  if (mood === 'fierce' || mood === 'hurt') {
    f.paint(H(ellipse(7.4, 7.4, 2.5, 2, 0, 10)), mat(['#3a0a14', '#6a1420'], { ambient: .7, round: 1 }), { shadow: 0, edge: 0 });
    const a = P(5.8, 6.2), b = P(9.2, 6.2); f.dot(a[0], a[1], '#ffffff'); f.dot(b[0], b[1], '#ffffff');
  } else { L(7.4, 5.6, 5, 6.8, mouth); L(7.4, 5.6, 10, 6.6, mouth); }
  const wh = o.whisker || '#f4eee4';
  L(-1.4, 4.8, -7, 3.6, wh, false); L(-1.4, 6.6, -7, 7.2, wh, false);
  L(15, 4.4, 21, 2.6, wh, false); L(15, 6.2, 21, 6.8, wh, false);
  if (o.blush) { const c = P(-3.6, 5.6); for (const [dx, dy] of [[0, 0], [2, 0], [1, 1], [3, 1], [-1, 1]]) f.dot(c[0] + dx, c[1] + dy, o.blush); }
  const spot = (x, y, r) => f.paint(H(ellipse(x, y, r, r, 0, 10)), SHINE, { shadow: 0, edge: 0, round: 1 });
  const eye = (cx, cy, rx, ry, front, side) => {
    if (mood === 'blink' || mood === 'out') {
      const dip = mood === 'blink' ? 1.6 : -1.3;
      f.path(spline([P(cx - rx, cy + .6), P(cx, cy + .6 + dip), P(cx + rx, cy + .6)], false, 3), ink);
      return;
    }
    if (mood === 'hurt') {
      const d = side > 0 ? 1 : -1;
      L(cx - d * rx, cy - 2.8, cx + d * rx * .7, cy, ink, false); L(cx + d * rx * .7, cy, cx - d * rx, cy + 2.8, ink, false);
      return;
    }
    f.paint(H(ellipse(cx, cy, rx, ry, 0, 16)), EYE, { shadow: 0, edge: 0, round: 1.5 });
    if (o.iris) {
      f.paint(H(ellipse(cx + front * .3, cy + ry * .2, rx * .8, ry * .7, 0, 14)), o.iris, { shadow: 0, edge: 0, grad: .5 });
      const slit = o.slit ? .22 : .5;
      f.paint(H(ellipse(cx + front * .5, cy + ry * .08, rx * slit, ry * .58, 0, 12)), EYE, { shadow: 0, edge: 0 });
    }
    spot(cx - rx * .3, cy - ry * .44, o.square ? 1.5 : 1.3);
    spot(cx + rx * .34, cy + ry * .42, .7);
    if (o.glow) { const q = P(cx, cy); f.glow(q[0], q[1], o.glow, .75); }
    if (mood === 'fierce') {
      const top = cy - ry, a = side > 0 ? [[cx - rx - 1.4, top - 3.4], [cx + rx + 1.2, top - 2], [cx + rx + 1.2, top + 2.6], [cx - rx - 1.4, top + .2]] : [[cx + rx + 1.2, top - 3.4], [cx - rx - 1.2, top - 2], [cx - rx - 1.2, top + 2.6], [cx + rx + 1.2, top + .2]];
      f.paint(H(a), o.brow || fur, { shadow: 0, edge: 0, round: 1 });
      f.path([P(a[3][0], a[3][1]), P(a[2][0], a[2][1])], ink);
    }
  };
  eye(1.2, -.6, 3.8, 4.7, 1, 1);
  eye(12.4, -.6, 2.8, 4.4, 1, -1);
  return { H, P };
}
const HEADS = {
  // The kitten knight: a soft ginger face looking out of a bright open helm, ears through the top.
  warden(f, hx, hy, tilt, s, o) {
    const out = (x, y) => rotate([[x * s, y * s]], tilt, hx, hy)[0], top = out(.5, -16.5), run = o.run;
    for (const [da, len, w] of [[.32, 22, 2.6], [-.1, 29, 3.4], [.1, 25, 3]]) {
      const c = strand(top[0], top[1], len * s, 5, (run ? 3.42 : 3.98) + da, run ? -.05 : -.3, .06, (o.phase || 0) + da);
      f.paint(ribbon(c, [w * .7 * s, w * s, w * .9 * s, w * .55 * s, .4], 3), PLUME, { shadow: 1 });
    }
    const { H, P } = catHead(f, hx, hy, tilt, s, { ...o, fur: FUR.ginger, ears: false, mark: FUR.gingerDk, stripes: STRIPES.cheek, iris: IRIS.amber, brow: FUR.ginger, blush: '#ee8a70', bib: true, whisker: '#fff4e4' });
    const shell = [[-17.8, 3], [-18, -7], [-12.4, -15.2], [0, -17.6], [11.4, -16], [18, -9.4], [18.8, -3.6], [12, -6.4], [2, -7], [-6, -5.4], [-10, -.8], [-11, 5], [-14, 8]];
    f.paint(H(spline(shell, true, 4)), SILVER, { round: 5 * s, gloss: 1.05, grad: .36, shadow: 2 });
    f.paint(H(ribbon([[18.6, -3.4], [12, -6], [2, -6.6], [-6, -5], [-10, -.4], [-11, 5]], [1.2, 1.3, 1.3, 1.2, 1.1, .8], 3)), GOLD, { shadow: 1, round: 1.4 });
    f.path(H(spline([[2.2, -17], [3.4, -12], [3.6, -8]], false, 3)), '#ffffff', true);
    f.path(H(spline([[3.2, -17], [4.4, -12], [4.6, -8]], false, 3)), '#2c3040', true);
    for (const [x, y] of [[-14.6, -4], [-14.2, .6], [-13.4, -9]]) { const q = P(x, y); f.dot(q[0], q[1], '#eef2fa'); }
    const near = [[-14.8, -12.6], [-16.8, -26], [-11.8, -23.4], [-5, -15.6]], far = [[4.8, -15.4], [12.4, -24.6], [15.6, -25.6], [16, -12.8]];
    catEar(f, H, far, [[8, -14.8], [13.6, -22], [14.6, -13]], FUR.ginger, EAR_PINK);
    f.paint(H(ribbon([[4.6, -15.2], [10.4, -13.8], [16.4, -12.2]], [.9, 1, .9], 2)), GOLD, { shadow: 1, round: 1 });
    catEar(f, H, near, [[-13.6, -14], [-15.2, -22.6], [-7.8, -15.4]], FUR.ginger, EAR_PINK, o.twitch, [-10, -13]);
    f.paint(H(ribbon([[-15.4, -12], [-10, -14.4], [-4.6, -15.8]], [1, 1.1, 1], 2)), GOLD, { shadow: 1, round: 1 });
    f.paint(H(ellipse(.5, -17, 2.4, 1.9, 0, 10)), GOLD, { shadow: 1, round: 1.6 });
  },
  // The little outlaw of Sherwood: a square grey tabby under a pointed green hat with a red feather.
  fletcher(f, hx, hy, tilt, s, o) {
    const H = pts => rotate(pts.map(([x, y]) => [x * s, y * s]), tilt, hx, hy);
    catEars(f, H, { ...o, fur: FUR.grey, inner: EAR_ORANGE }, 'far');
    catHead(f, hx, hy, tilt, s, { ...o, fur: FUR.grey, ears: false, square: true, mark: FUR.greyDk, muzzle: FUR.cream, brow: FUR.grey, whisker: '#f6f4ee' });
    const crown = [[15.4, -12], [8.6, -21], [-1.6, -27.6], [-17.4, -35.4], [-13.4, -24], [-15.6, -12.4]];
    const quill = H(strand(-11, -18, 22, 5, 3.86, -.13));
    f.paint(ribbon(quill, [.5 * s, 2.2 * s, 2.6 * s, 2 * s, .4], 3), mat(['#4a0808', '#8a1414', '#c82420', '#f05a40', '#ff9a70'], { ambient: .34, round: 1.6, exposure: .8 }), { shadow: 1 });
    f.path(spline(quill, false, 3), '#ffd8b8', true);
    f.paint(H(spline(crown, true, 4)), GREEN, { round: 5 * s, grad: .36, shadow: 2 });
    f.path(H(spline([[8.6, -20], [-1, -26.4], [-14, -33]], false, 3)), '#7ccb82', true);
    f.paint(H(spline([[-19.4, -7.8], [-17.6, -13.2], [-6, -16.8], [7, -17.2], [16, -14.4], [22.4, -9.8], [15.4, -10.2], [4, -10.8], [-8, -9.8]], true, 4)), GREEN, { round: 3 * s, grad: .24, shadow: 2 });
    f.paint(H(ribbon([[-17.4, -11.4], [-6, -14.2], [7, -14.6], [17.6, -12.2]], [1.3, 1.4, 1.4, 1.1], 3)), BROWN, { shadow: 1, round: 1.2 });
    catEars(f, H, { ...o, fur: FUR.grey, inner: EAR_ORANGE }, 'near');
  },
  // A black cat of ember and storm, in a tall crooked witch's hat.
  hexer(f, hx, hy, tilt, s, o) {
    const H = pts => rotate(pts.map(([x, y]) => [x * s, y * s]), tilt, hx, hy);
    catHead(f, hx, hy, tilt, s, { ...o, fur: FUR.black, ears: false, muzzle: FUR.blackLt, iris: IRIS.yellow, slit: true, glow: '#ffd020', brow: FUR.black, mouth: '#8a7c9c', whisker: '#a89cc4', ink: '#ffd060' });
    f.paint(H(ellipse(0, -11.8, 26, 5, -.04, 26)), ROBE, { round: 3 * s, grad: .3, shadow: 2 });
    f.path(H(spline([[-25, -10.6], [-8, -7.6], [10, -7.6], [25.4, -11.8]], false, 3)), '#a884d8', true);
    catEars(f, H, { ...o, fur: FUR.black, inner: mat(['#3a1848', '#6a2c78', '#a04cac'], { ambient: .5, round: 2 }) });
    const tip = (o.phase === undefined ? 0 : Math.sin(o.phase * TAU) * 1.2);
    f.paint(H(ribbon([[1, -12.6], [0, -24], [-4, -34], [-13 + tip, -38], [-19 + tip, -33]], [10.4, 7.4, 4.8, 2.6, .5], 4)), ROBE, { round: 4 * s, grad: .34, shadow: 2 });
    f.paint(H(ribbon([[-9.4, -16], [1, -14.8], [11, -16]], [1.8, 1.9, 1.8], 2)), GOLD, { shadow: 1, round: 1.3 });
    f.paint(H([[-1.4, -17.8], [3.4, -17.8], [3.4, -13], [-1.4, -13]]), GOLD, { shadow: 1, round: 1.2 });
    f.paint(H(ellipse(1, -15.4, 1.2, 1.2, 0, 8)), mat(['#3a0c4c', '#8c1c9c', '#e050e8'], { gloss: 1, round: 1 }), { shadow: 0, edge: 0 });
  },
  // A gentle white cat in a cream hood, trimmed in teal, under a golden halo.
  mender(f, hx, hy, tilt, s, o) {
    for (let i = 0; i < 44; i++) {
      const a = i / 44 * TAU, r = (21 + (i % 2) * .5) * s, cx = hx - 1, cy = hy - 6 * s;
      f.glow(cx + Math.cos(a) * r, cy + Math.sin(a) * r, '#ffd877', .6);
      if (i % 6 === 0) f.glowLine(cx + Math.cos(a) * (r + 1), cy + Math.sin(a) * (r + 1), cx + Math.cos(a) * (r + 3.4), cy + Math.sin(a) * (r + 3.4), '#ffe9a8', .5);
    }
    const H = pts => rotate(pts.map(([x, y]) => [x * s, y * s]), tilt, hx, hy);
    catEars(f, H, { ...o, fur: FUR.white }, 'far');
    f.paint(H(spline([[-19.4, 12], [-20, -2], [-16, -13], [-6, -18.6], [6, -18.6], [15, -14.4], [19.2, -7], [19.6, 2], [15, 13.6], [0, 15.6], [-13, 15]], true, 4)), IVORY, { round: 6 * s, grad: .34, shadow: 2 });
    catHead(f, hx, hy, tilt, s, { ...o, fur: FUR.white, ears: false, mark: FUR.whiteDk, stripes: [], iris: IRIS.blue, muzzle: FUR.cream, brow: FUR.white, mouth: '#8a7a84', whisker: '#c4c0cc', blush: '#f4b4b8' });
    f.paint(H(spline([[-17, 4], [-17.6, -6], [-12, -14], [0, -16.4], [11, -15], [17.6, -8.8], [18.4, -4], [11, -7], [2, -7.6], [-6, -6], [-10.4, -1.2], [-11.6, 5]], true, 4)), IVORY, { round: 4 * s, grad: .3, shadow: 2 });
    f.paint(H(ribbon([[18.2, -3.8], [11, -6.6], [2, -7.2], [-6, -5.6], [-10.4, -.8], [-11.6, 5]], [1.3, 1.4, 1.4, 1.3, 1.2, .9], 3)), TEAL, { shadow: 1, round: 1.3 });
    f.paint(H(ellipse(4.2, -8.6, 1.9, 1.9, 0, 10)), GOLD, { shadow: 1, round: 1.4 });
    catEars(f, H, { ...o, fur: FUR.white }, 'near');
  },
};

// ---------------------------------------------------------------- Kitten Knight
// A very small knight with a very large sword: the blade alone is taller than its owner.
const BLADE_LEN = 74;
function sword(f, hx, hy, ang, o = {}) {
  const len = BLADE_LEN, wid = 5.6, R = pts => rotate(pts, ang, hx, hy);
  f.paint(R([[-15, -1.8], [6, -1.8], [6, 1.8], [-15, 1.8]]), LEATHER, { round: 1.5, shadow: 1 });
  f.paint(R(ellipse(-16, 0, 3, 3)), GOLD, { shadow: 1 });
  f.paint(R([[len, 0], [len - 10, -wid], [9, -wid * 1.05], [9, wid * 1.05], [len - 10, wid]]), BLADE, { round: 3.4, gloss: .9, grad: .46, shadow: 1 });
  const [fa, fb] = [R([[10, 0]])[0], R([[len - 12, 0]])[0]];
  f.line(fa[0], fa[1], fb[0], fb[1], '#23242f');
  const off = R([[10, -1], [len - 13, -1]]);
  f.line(off[0][0], off[0][1], off[1][0], off[1][1], '#3a3b4e');
  f.paint(R([[3, -9.5], [6, -11], [9, -8.5], [9, 8.5], [6, 11], [3, 9.5], [5, 0]]), GOLD, { round: 2, shadow: 1 });
  f.paint(R(ellipse(6, 0, 2.4, 2.4)), mat(['#3a0a4c', '#7a1c9c', '#bb50e8', '#efb0ff'], { gloss: 1, round: 2 }), { shadow: 0 });
  // Runes along the blade take the colour of the item's grade in the game.
  for (let i = 0; i < 7; i++) {
    const u = 15 + i * 7.6, [a, b] = R([[u, -1.6], [u + 2.6, 1.6]]);
    f.energyLine(a[0], a[1], b[0], b[1], .42);
    f.dot(a[0], a[1], '#1c1a2a'); f.dot(b[0], b[1], '#1c1a2a');
  }
  if (o.lightning) {
    for (let k = 0; k < 2; k++) {
      let u = 10 + rnd(o.lightning, k) * 30, v = (rnd(o.lightning, k + 9) - .5) * 8;
      for (let s = 0; s < 6; s++) {
        const nu = u + 4 + rnd(o.lightning, k * 10 + s) * 4, nv = (rnd(o.lightning, k * 20 + s) - .5) * 13;
        const [a, b] = R([[u, v], [nu, nv]]);
        f.energyLine(a[0], a[1], b[0], b[1], .3);
        u = nu; v = nv;
      }
    }
  }
}
// The arc a heavy blade leaves behind it. Only ever visible for a frame or two.
function smear(f, hx, hy, a0, a1, r0, r1, power = 1) {
  const steps = Math.ceil(Math.abs(a1 - a0) * r1 * 1.6);
  const seen = new Set();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, a = lerp(a0, a1, t), w = Math.sin(t * Math.PI);
    for (let r = lerp(r1, r0, w); r <= r1; r += .5) {
      const x = Math.round(hx + Math.cos(a) * r), y = Math.round(hy + Math.sin(a) * r), key = x * 4096 + y;
      if (seen.has(key)) continue;
      seen.add(key);
      f.energy(x, y, power * (.12 + t * .4) * (.55 + (r - r0) / (r1 - r0) * .45));
    }
  }
}
const WARDEN_REST = { hip: [0, HIP], lean: .06, hN: [15, -31], ang: -1.25, near: [-7, 0], far: [8, 0] };
const WARDEN_KEYS = {
  atk1: [ // a rising cut: the hips drive first, the shoulders follow, the blade comes last
    [0, WARDEN_REST],
    [.3, { hip: [-5, -22], lean: -.14, hN: [-7, -24], ang: 2.62, near: [-11, 0], far: [6, 0] }, easeOut],
    [.46, { hip: [6, -23], lean: .3, hN: [15, -46], ang: -1.05, near: [-8, 0], far: [16, 0] }, easeIn],
    [.68, { hip: [6, -23], lean: .22, hN: [20, -44], ang: -1.42, near: [-7, 0], far: [16, 0] }, easeOut],
    [1, WARDEN_REST],
  ],
  atk2: [ // an overhead chop with the whole body falling into it
    [0, WARDEN_REST],
    [.34, { hip: [-4, -24], lean: -.22, hN: [-14, -49], ang: -2.55, near: [-10, 0], far: [6, 0] }, easeOut],
    [.46, { hip: [8, -20], lean: .46, hN: [24, -32], ang: .14, near: [-9, 0], far: [18, 0] }, easeIn],
    [.72, { hip: [8, -19], lean: .42, hN: [23, -25], ang: .46, near: [-8, 0], far: [18, 0] }, easeOut],
    [1, WARDEN_REST],
  ],
  atk3: [ // a lunge: back foot drives, front knee bends deep
    [0, WARDEN_REST],
    [.36, { hip: [-7, -22], lean: -.12, hN: [-10, -29], ang: -.05, near: [-14, 0], far: [4, 0] }, easeOut],
    [.48, { hip: [11, -20], lean: .42, hN: [31, -31], ang: -.07, near: [-8, 0], far: [24, 0] }, easeIn],
    [.74, { hip: [10, -20], lean: .36, hN: [28, -30], ang: -.05, near: [-8, 0], far: [23, 0] }, easeOut],
    [1, WARDEN_REST],
  ],
  cast: [
    [0, WARDEN_REST],
    [.4, { hip: [-1, -25], lean: -.12, hN: [15, -46], ang: -1.5, near: [-6, 0], far: [7, 0] }, easeOut],
    [.72, { hip: [-1, -26], lean: -.14, hN: [15, -47], ang: -1.46, near: [-6, 0], far: [7, 0] }],
    [1, WARDEN_REST],
  ],
};
function drawWarden(f, anim, t, frameNo) {
  const p = basePose(anim, t), b = p.breath || 0;
  let hN, ang = WARDEN_REST.ang, smearArc = null, twoHand = true;
  if (anim === 'idle') { hN = [15 + (p.weight || 0) * .4, -31 + b * .5]; ang = WARDEN_REST.ang + b * .012; }
  else if (anim === 'run') {
    // One paw shoulders the great blade so it rides behind the head, the other arm pumps.
    hN = [p.hip[0] + 7 - p.swing * .8, p.hip[1] - 12 + Math.abs(p.swing)]; ang = -2.42 + p.swing * .025; twoHand = false;
  } else if (anim === 'down') {
    const d = downPose(t); Object.assign(p, d);
    hN = [d.hip[0] + 11, d.hip[1] + 4 + d.k * 2]; ang = lerp(WARDEN_REST.ang, .02, d.k); twoHand = false;
  } else if (anim === 'hurt') {
    const k = Math.sin(t * Math.PI); Object.assign(p, hurtKey(k));
    hN = [13 - 3 * k, -30]; ang = WARDEN_REST.ang + k * .26;
  } else {
    const a = timeline(t, WARDEN_KEYS[anim]);
    p.hip = a.hip; p.lean = a.lean; hN = a.hN; ang = a.ang; p.near = a.near; p.far = a.far;
    if (anim !== 'cast' && t > .32 && t < .62) {
      const k = (t - .32) / .3, base = anim === 'atk1' ? [2.6, -1.5] : anim === 'atk2' ? [-2.5, .45] : null;
      if (base) smearArc = { a0: lerp(base[0], base[1], Math.max(0, k - .5)), a1: lerp(base[0], base[1], Math.min(1, k * 1.5)) };
    }
    p.windBack = lerp(.12, anim === 'cast' ? .1 : -.05, Math.sin(t * Math.PI));
  }
  const J = bones(p), { hip, T, neck, shN, shF } = J;
  hN = reach(shN, hN);
  const dir = [Math.cos(ang), Math.sin(ang)];
  // Two paws on a long grip: the far paw sits below the near one, wherever the blade goes.
  const hF = reach(shF, twoHand ? [hN[0] - dir[0] * 8.5, hN[1] - dir[1] * 8.5] : freeArm(shF, -p.swing));

  capeLayers(f, J, p, CRIMSON, CRIMSON_IN, { seed: 11, len: 31, wide: 13, foldDark: '#1a0410', foldLight: '#8c1c30' });
  catTail(f, J, p, FUR.ginger, { band: '#b05818', tip: FUR.cream });
  const behind = anim === 'run' || anim === 'down' || (anim.startsWith('atk') && t < .3);

  // Far leg and far arm sit behind everything else.
  pawLeg(f, [hip[0] + 2.6, hip[1] + 1], p.far, SILVER_DK, null, { r0: 4.6 });
  catArm(f, shF, hF, SILVER_DK, SILVER_DK, { r0: 3.2 });
  if (behind) sword(f, hN[0], hN[1], ang, { lightning: frameNo * 7 + 3 });

  // Near leg, with a knee cop and a line down the greave.
  const nl = pawLeg(f, [hip[0] - 2.6, hip[1] + 1], p.near, SILVER, null, { r0: 5 });
  f.paint(ellipse(nl.knee[0] + 1, nl.knee[1], 3.4, 3.1), GOLD, { round: 2.4, shadow: 2 });

  // Overlapping plates over the hips, a tabard between the legs, then the breastplate.
  const sway = (anim === 'run' ? p.swing : b * .3) * 1.6;
  f.paint(ribbon([T(0, 1.5), [hip[0] + 2 + sway * .3, hip[1] + 6], [hip[0] + 3 + sway, hip[1] + 13 - Math.abs(sway)]], [4.2, 4.4, 3], 3), CRIMSON, { round: 3.4, shadow: 2 });
  f.paint([T(4, -7), T(4, 7.8), [hip[0] + 8.8, hip[1] + 4.4], [hip[0] + 4.2, hip[1] + 6.8], [hip[0] + .4, hip[1] + 4.2], [hip[0] - 3.8, hip[1] + 6.8], [hip[0] - 8.4, hip[1] + 4]], SILVER_DK, { round: 2.6, shadow: 2 });
  f.line(hip[0] - 7, hip[1] + 3, hip[0] + 7.6, hip[1] + 3, '#e8b84a', true);
  f.paint(spline([T(1, -6.8), T(6, -6.6), T(12, -7.8), T(17, -6.4), T(20, -1), T(20, 3), T(17, 7.2), T(12, 8.6), T(6, 7.2), T(1, 7.4)]), SILVER, { round: 4.6, gloss: .95, grad: .3, shadow: 2 });
  f.path([T(17, 2.4), T(6.6, 2)], '#ffffff', true); f.path([T(17, 3.4), T(6.6, 3)], '#2c3040', true);
  f.path(spline([T(11.4, -7), T(8.6, -2), T(8.6, 2.4)], false, 3), '#2c3040', true); f.path(spline([T(11.4, 8), T(8.8, 6), T(8.6, 2.4)], false, 3), '#2c3040', true);
  // A little gold paw print over the heart.
  const em = T(13, 3.4);
  rows(f, ['G.G', '...', 'GGG', '.G.'], em[0] - 1, em[1] - 2, { G: '#f6d868' });
  f.paint([T(1.4, -7.2), T(4.4, -7.2), T(4.4, 7.8), T(1.4, 7.6)], LEATHER, { round: 1.6, shadow: 1 });
  const buckle = T(2.9, 2.6); f.paint(ellipse(buckle[0], buckle[1], 2.4, 2.2), GOLD, { round: 1.6, shadow: 1 });

  const raised = overFace(hN, J);
  const nearArm = () => {
    const j = catArm(f, shN, hN, SILVER, SILVER, { r0: 3.6 });
    f.paint(ellipse(j.mid[0], j.mid[1], 2.8, 2.6), GOLD, { round: 2, shadow: 2 });
    pauldron(shN[0] - .5, shN[1] - .8, 1, SILVER);
  };
  const pauldron = (cx, cy, sc, m) => {
    f.paint(ellipse(cx, cy, 6.8 * sc, 5.6 * sc, .2), m, { round: 3.4, gloss: 1, grad: .34 });
    f.path(spline([[cx - 5.8 * sc, cy + 2.4 * sc], [cx, cy + 4.8 * sc], [cx + 6 * sc, cy + 2.6 * sc]], false, 3), '#e8b84a', true);
    f.path(spline([[cx - 5 * sc, cy + .2], [cx, cy + 2.6 * sc], [cx + 5.2 * sc, cy + .4]], false, 3), '#ffffff', true);
  };
  pauldron(shF[0], shF[1] - .5, .78, SILVER_DK);
  if (!behind) {
    if (smearArc) smear(f, hN[0] - 6, hN[1] + 8, smearArc.a0, smearArc.a1, 48, 78, .8);
    sword(f, hN[0], hN[1], ang, { lightning: frameNo * 7 + 3 });
  }
  if (raised) nearArm();
  // A gorget under the chin, then the head on top of it all.
  f.paint(ellipse(neck[0], neck[1] + 1.6, 8.4, 3.4, p.lean), SILVER, { round: 2.4, gloss: 1, shadow: 2 });
  f.line(neck[0] - 7.6, neck[1] + 3.4, neck[0] + 7.6, neck[1] + 3.4, '#e8b84a', true);
  HEADS.warden(f, J.hx, J.hy, J.tilt, 1, { mood: moodOf(anim, t, frameNo), run: anim === 'run', phase: p.phase, twitch: anim === 'idle' && (frameNo === 17 || frameNo === 18) ? -.2 : 0 });
  if (!raised) nearArm();
  if (anim === 'cast') {
    const k = Math.sin(t * Math.PI), tip = rotate([[BLADE_LEN, 0]], ang, hN[0], hN[1])[0];
    for (let a = 0; a < 16; a++) { const q = a / 16 * TAU + t * 5, r = 10 * k + 4; f.energy(tip[0] + Math.cos(q) * r, tip[1] + Math.sin(q) * r, .9 * k); }
    f.energy(tip[0], tip[1], 2.2 * k);
  }
}

// ---------------------------------------------------------------- RobinCat
const GREEN = mat(['#071a0d', '#0e3018', '#164a24', '#206632', '#2e8442', '#46a456', '#7ccb7e'], { ambient: .28, round: 5, exposure: .72, dither: .03 });
const GREEN_DK = mat(['#040e08', '#082010', '#0e3018', '#164522', '#205a2e'], { ambient: .26, round: 3, exposure: .66 });
const BROWN = mat(['#1c0e06', '#38200e', '#5a3618', '#7e4f24', '#a56c34', '#cc9250'], { ambient: .3, round: 3, exposure: .74 });
const BOWWOOD = mat(['#2a0f04', '#55220a', '#86400f', '#b5631c', '#d9892f', '#f2b152', '#ffd98a'], { gloss: .5, ambient: .3, round: 2, exposure: .8 });
function longbow(f, hx, hy, ang, pull, tint) {
  const R = pts => rotate(pts, ang, hx, hy);
  const limb = s => [[0, 0], [s * 9, 3], [s * 20, 2.2], [s * 29, -3], [s * 33, -8]].map(([y, x]) => [x, y]);
  const uA = R(limb(-1)), lA = R(limb(1));
  const string0 = R([[-8, -33]])[0], string1 = R([[-8, 33]])[0], nock = R([[-8 - pull, 0]])[0];
  f.line(string0[0], string0[1], nock[0], nock[1], '#f0e8d0');
  f.line(nock[0], nock[1], string1[0], string1[1], '#f0e8d0');
  f.paint(ribbon(uA, [3, 2.7, 2.1, 1.4, .6], 4), BOWWOOD, { shadow: 1 });
  f.paint(ribbon(lA, [3, 2.7, 2.1, 1.4, .6], 4), BOWWOOD, { shadow: 1 });
  for (const q of [uA[2], lA[2]]) f.paint(ellipse(q[0], q[1], 2.2, 2.2), GOLD, { shadow: 1 });
  f.paint(R([[-3, -3.8], [4.6, -3.8], [4.6, 3.8], [-3, 3.8]]), BROWN, { round: 1.6, shadow: 1 });
  if (pull > 1.5) {
    const tip = R([[30 - pull, 0]])[0];
    f.line(nock[0], nock[1], tip[0], tip[1], '#c9b78a');
    f.paint(R([[30 - pull, 0], [24 - pull, -2.8], [24 - pull, 2.8]]), BLADE, { shadow: 0, round: 1 });
    for (let i = 0; i < 6; i++) { const q = R([[24 - pull - i * 3.4, 0]])[0]; f.energy(q[0], q[1], tint * (1 - i / 7)); }
    const fl = R([[-6 - pull, -2.4], [-2 - pull, 0], [-6 - pull, 2.4]]);
    f.line(fl[0][0], fl[0][1], fl[1][0], fl[1][1], '#e03828'); f.line(fl[2][0], fl[2][1], fl[1][0], fl[1][1], '#e03828');
  }
  return nock;
}
const FLETCHER_REST = { hip: [0, HIP], lean: .05, hF: [17, -29], hN: [-4, -24], bowA: .34, pl: 0, near: [-6.5, 0], far: [7.5, 0] };
const FLETCHER_KEYS = {
  // A real archer's draw: the bow arm rises and locks, the string paw comes back to the cheek.
  atk1: [
    [0, FLETCHER_REST],
    [.22, { hip: [-1, -24], lean: -.05, hF: [25, -40], hN: [14, -38], bowA: .02, pl: 2, near: [-9, 0], far: [8, 0] }, easeOut],
    [.5, { hip: [-3, -23], lean: -.1, hF: [25, -41], hN: [8, -42], bowA: 0, pl: 13, near: [-10, 0], far: [8, 0] }],
    [.58, { hip: [-4, -23], lean: -.15, hF: [24, -42], hN: [-8, -46], bowA: -.03, pl: 0, near: [-11, 0], far: [7, 0] }, easeIn],
    [1, FLETCHER_REST],
  ],
  // A low shot from a wide crouch, knees deeply bent.
  atk2: [
    [0, FLETCHER_REST],
    [.22, { hip: [-2, -20], lean: .1, hF: [25, -32], hN: [14, -31], bowA: .1, pl: 2, near: [-13, 0], far: [11, 0] }, easeOut],
    [.5, { hip: [-4, -19], lean: .06, hF: [26, -31], hN: [8, -34], bowA: .08, pl: 13, near: [-14, 0], far: [12, 0] }],
    [.58, { hip: [-5, -19], lean: -.02, hF: [25, -32], hN: [-8, -36], bowA: .05, pl: 0, near: [-15, 0], far: [12, 0] }, easeIn],
    [1, FLETCHER_REST],
  ],
  cast: [
    [0, FLETCHER_REST],
    [.25, { hip: [-3, -24], lean: -.26, hF: [16, -50], hN: [8, -46], bowA: -.65, pl: 3, near: [-10, 0], far: [8, 0] }, easeOut],
    [.55, { hip: [-4, -23], lean: -.3, hF: [16, -51], hN: [2, -44], bowA: -.68, pl: 13, near: [-11, 0], far: [8, 0] }],
    [.64, { hip: [-5, -23], lean: -.32, hF: [15, -52], hN: [-7, -42], bowA: -.7, pl: 0, near: [-12, 0], far: [7, 0] }, easeIn],
    [1, FLETCHER_REST],
  ],
};
function drawFletcher(f, anim, t, frameNo) {
  const p = basePose(anim, t), b = p.breath || 0;
  let hN, hF, bowAng = FLETCHER_REST.bowA, pull = 0;
  if (anim === 'idle') { hF = [17 + (p.weight || 0) * .4, -29 + b * .4]; hN = [-4 + (p.weight || 0) * .4, -24 + b * .3]; bowAng += b * .012; }
  else if (anim === 'run') { const s = p.swing, up = p.hip[1] - HIP; hF = [16 - s * 3, -31 + up + Math.abs(s) * 1.4]; hN = [-6 + s * 7, -26 + up - Math.abs(s) * 1.4]; bowAng = .4 - s * .08; }
  else if (anim === 'down') {
    const d = downPose(t); Object.assign(p, d);
    hF = [d.hip[0] + 12, d.hip[1] + 4 + d.k * 2]; hN = [d.hip[0] + 4, d.hip[1] + 3]; bowAng = lerp(.4, 1.5, d.k);
  } else if (anim === 'hurt') {
    const k = Math.sin(t * Math.PI); Object.assign(p, hurtKey(k));
    hF = [14, -31 - k * 1.5]; hN = [-4, -26]; bowAng = .4;
  } else {
    const a = timeline(t, FLETCHER_KEYS[anim] || FLETCHER_KEYS.atk1);
    p.hip = a.hip; p.lean = a.lean; hF = a.hF; hN = a.hN; bowAng = a.bowA; pull = a.pl; p.near = a.near; p.far = a.far; p.windBack = .06;
  }
  const J = bones(p), { hip, T, neck, shN, shF } = J;
  hF = reach(shF, hF);
  // While drawing, the string paw sits exactly on the nock, so the string always leads somewhere.
  const nock = rotate([[-8 - pull, 0]], bowAng, hF[0], hF[1])[0], onString = Math.min(1, pull / 2);
  hN = reach(shN, [lerp(hN[0], nock[0], onString), lerp(hN[1], nock[1], onString)]);
  capeLayers(f, J, p, GREEN_DK, null, { seed: 31, len: 19, wide: 10, tear: 4, teeth: 6, foldLight: '#2e8442' });
  // Quiver slung across the back, red-fletched arrows over the near shoulder.
  const qa = T(18, -8.6), qb = T(1, -11);
  f.paint(capsule(qa[0], qa[1], qb[0], qb[1], 2.9, 2.5), BROWN, { round: 2.2, shadow: 1 });
  for (let i = 0; i < 3; i++) {
    const x = qa[0] - 2.2 + i * 2, y = qa[1] - 1.6;
    f.line(x, y, x - 1.6, y - 7, '#c8b48a');
    f.line(x - 3.2, y - 8.4, x - 1.6, y - 6.4, '#e03828'); f.line(x - .4, y - 8.4, x - 1.6, y - 6.4, '#ff5a40');
  }
  catTail(f, J, p, FUR.grey, { band: '#484b58', tip: FUR.greyDk });
  // Far leg and the bow arm, reaching forward past the chest.
  pawLeg(f, [hip[0] + 2.4, hip[1] + 1], p.far, GREEN_DK, mat(['#100806', '#20120a', '#34200f', '#4a2e16'], { round: 2.6, ambient: .26, exposure: .7 }), { r0: 4.4 });
  catArm(f, shF, hF, GREEN_DK, FUR.grey, { r0: 3.1 });
  longbow(f, hF[0], hF[1], bowAng, pull, .5);
  // Near leg: tall boot with a turned-down cuff.
  const nl = pawLeg(f, [hip[0] - 2.4, hip[1] + 1], p.near, GREEN, BROWN, { r0: 4.8 });
  f.paint(ellipse(nl.knee[0] + .3, nl.knee[1] + 1, 4, 2.4, .1), BROWN, { round: 1.8, shadow: 1 });
  // A green tunic with a scalloped hem, then a brown vest and a broad belt.
  const sw = (anim === 'run' ? p.swing : b * .3) * 1.6;
  f.paint([T(4, -7), T(4, 7.6), [hip[0] + 8.8 + sw, hip[1] + 6.6], [hip[0] + 4 + sw, hip[1] + 8.8], [hip[0] + .4 + sw, hip[1] + 6.2], [hip[0] - 3.4 + sw, hip[1] + 8.8], [hip[0] - 8.4 + sw, hip[1] + 6.4]], GREEN, { round: 3, shadow: 2 });
  f.paint(spline([T(1, -6.6), T(6, -6.4), T(12, -7.4), T(17, -6.2), T(20, -1), T(20, 3), T(17, 6.8), T(12, 8.2), T(6, 6.8), T(1, 7.2)]), GREEN, { round: 4.6, grad: .3, shadow: 2 });
  f.paint([T(18, -6.4), T(18.4, 1.2), T(12, 2.2), T(4, 1.8), T(4, -6.8), T(12, -7.6)], BROWN, { round: 2.8, shadow: 1 });
  f.paint([T(18, 7), T(18.4, 4.8), T(12, 5), T(4, 4.8), T(4, 7.2), T(12, 8.2)], BROWN, { round: 2, shadow: 1 });
  f.path([T(18, 1.4), T(12, 2.4), T(4, 2)], '#f6d868', true); f.path([T(18, 4.6), T(12, 4.8), T(4, 4.6)], '#f6d868', true);
  f.paint([T(1.2, -7.2), T(4.6, -7.2), T(4.6, 7.8), T(1.2, 7.6)], mat(['#120806', '#241208', '#3c2210', '#573418'], { ambient: .3, round: 2 }), { round: 1.6, shadow: 1 });
  const bk = T(2.9, 3.2);
  f.paint(ellipse(bk[0], bk[1], 2.8, 2.4), GOLD, { round: 1.6, shadow: 1 });
  f.line(bk[0] - 1, bk[1], bk[0] + 1, bk[1], '#5a3618', true);
  // A strap across the chest, and a high green collar the head settles into.
  f.line(T(17, -6)[0], T(17, -6)[1], T(5, 7)[0], T(5, 7)[1], '#2c180a', true);
  f.paint(spline([[neck[0] - 9, neck[1] + 3], [neck[0] - 9.6, neck[1] - 3.4], [neck[0] - 3, neck[1] - .4], [neck[0] + 4, neck[1] - .4], [neck[0] + 10, neck[1] - 3.4], [neck[0] + 9.4, neck[1] + 3], [neck[0], neck[1] + 5.4]]), GREEN, { round: 3, shadow: 2 });
  f.paint(ellipse(shF[0], shF[1], 4.6, 3.8, .15), GREEN_DK, { round: 2.4, shadow: 1 });
  HEADS.fletcher(f, J.hx, J.hy, J.tilt, 1, { mood: moodOf(anim, t, frameNo), twitch: anim === 'idle' && (frameNo === 3 || frameNo === 4) ? -.2 : 0 });
  // Near arm: green sleeve, a grey bracer laced at the wrist, and a soft grey paw.
  const j = catArm(f, shN, hN, GREEN, FUR.grey, { r0: 3.5 });
  const fa = along(j.mid, j.end, .72);
  f.paint(capsule(j.mid[0] * .35 + fa[0] * .65, j.mid[1] * .35 + fa[1] * .65, fa[0], fa[1], 3.1, 2.9), mat(['#1a1c24', '#2e3038', '#484b56', '#686c78', '#90949e'], { round: 2, ambient: .3, gloss: .4 }), { shadow: 1 });
  f.paint(ellipse(shN[0] - .4, shN[1] - .2, 5.2, 4.2, .15), GREEN, { round: 2.6, shadow: 2 });
  if (anim === 'cast' && t > .25 && t < .68) {
    const k = Math.sin((t - .25) / .43 * Math.PI), tip = rotate([[30 - pull, 0]], bowAng, hF[0], hF[1])[0];
    f.energy(tip[0], tip[1], 2.4 * k);
    for (let a = 0; a < 14; a++) { const q = a / 14 * TAU + t * 8; f.energy(tip[0] + Math.cos(q) * 7 * k, tip[1] + Math.sin(q) * 7 * k, .7 * k); }
  }
}

// A long skirt that swings with the stride: hexer and mender both wear them.
function longSkirt(f, T, hip, x0, x1, spread, m, seed, tear, sw, o = {}) {
  const drop = o.drop || 20;
  const A = [T(4, x0), [hip[0] + x0 - spread * .4 + sw * .3, hip[1] + drop * .5], [hip[0] + x0 - spread + sw, hip[1] + drop]];
  const B = [T(4, x1), [hip[0] + x1 + spread * .4 + sw * .3, hip[1] + drop * .5], [hip[0] + x1 + spread + sw, hip[1] + drop]];
  f.paint(tatteredCloth(spline(A, false, 3), spline(B, false, 3), seed, tear, 5), m, { round: 4.5, shadow: 2, fn: x => Math.sin(x * .9) * .09 });
}

// ---------------------------------------------------------------- Hexer: a black witch cat
const ROBE = mat(['#0c0618', '#1a0e2e', '#2a1848', '#3e2466', '#553488', '#7048ac', '#9a70d4'], { ambient: .24, round: 5, exposure: .68, dither: .04 });
const ROBE_IN = mat(['#040208', '#0a0512', '#10081c', '#180c26'], { ambient: .3, round: 5, exposure: .6 });
const INK = mat(['#04030a', '#0a0813', '#13101e', '#1e1a2c', '#2c283e'], { ambient: .22, round: 3.4, exposure: .62 });
const WOOD = mat(['#0c0810', '#1e1420', '#352430', '#523a40', '#7a5a54'], { round: 2, exposure: .7 });
function witchStaff(f, x, y, ang, frameNo, up = 28, down = 27) {
  const R = pts => rotate(pts, ang, x, y);
  const [top] = R([[up, 0]]), [butt] = R([[-down, 0]]);
  f.paint(capsule(butt[0], butt[1], top[0], top[1], 1.3, 1.7), WOOD, { shadow: 1 });
  const ring = R([[up + 1, -3], [up + 6, -6], [up + 12, -3], [up + 13, 4], [up + 7, 7], [up + 2, 3]]);
  f.paint(ribbon(spline(ring, false, 3), [1.7, 1.1, .5], 1), GOLD, { shadow: 1, exposure: .7, round: 1.4 });
  const [o] = R([[up + 7, 0]]);
  f.paint(ellipse(o[0], o[1], 3.6, 3.6), mat(['#2a2030', '#6a5a78', '#b8a8c8', '#ffffff'], { gloss: 1, round: 3, exposure: .8 }), { shadow: 1 });
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + frameNo * .4; f.energy(o[0] + Math.cos(a) * 3.8, o[1] + Math.sin(a) * 3.8, .45); }
  f.energy(o[0], o[1], 2); f.energy(o[0] + 1, o[1], 1); f.energy(o[0], o[1] + 1, 1); f.energy(o[0] - 1, o[1], 1); f.energy(o[0], o[1] - 1, 1);
  return o;
}
function flame(f, x, y, frameNo, sc = 1) {
  const fl = frameNo * .9;
  for (let i = 0; i < 16; i++) {
    const q = i / 16, r = (1 - q) * 3.6 * sc, px = x + Math.sin(fl + i * 1.3) * r, py = y - 3 - q * 10 * sc - Math.abs(Math.sin(fl * 1.4 + i)) * 2;
    f.glow(px, py, '#ff6a2c', .85 * (1 - q * .5));
    f.dot(px, py, q < .4 ? '#fff0b8' : q < .75 ? '#ffb14a' : '#ee5a24');
  }
}
const HEXER_REST = { hip: [0, HIP], lean: .05, hF: [20, -35], hN: [12, -28], ang: -1.53, near: [-5.5, 0], far: [6, 0] };
const HEXER_KEYS = {
  atk1: [ // gathers the flame back at the shoulder, then throws it forward from the hips
    [0, HEXER_REST],
    [.34, { hip: [-2, -24], lean: -.16, hF: [15, -36], hN: [-10, -44], ang: -1.68, near: [-9, 0], far: [6, 0] }, easeOut],
    [.5, { hip: [5, -24], lean: .24, hF: [21, -34], hN: [24, -44], ang: -1.42, near: [-7, 0], far: [13, 0] }, easeIn],
    [.72, { hip: [4, -24], lean: .18, hF: [21, -34], hN: [22, -41], ang: -1.46, near: [-7, 0], far: [12, 0] }],
    [1, HEXER_REST],
  ],
  atk2: [ // brings the staff up in both paws and sweeps it down
    [0, HEXER_REST],
    [.34, { hip: [-2, -24], lean: -.22, hF: [10, -50], hN: [2, -47], ang: -2.2, near: [-9, 0], far: [5, 0] }, easeOut],
    [.5, { hip: [6, -22], lean: .3, hF: [27, -34], hN: [17, -33], ang: -.5, near: [-8, 0], far: [15, 0] }, easeIn],
    [.72, { hip: [5, -22], lean: .26, hF: [25, -31], hN: [16, -30], ang: -.42, near: [-8, 0], far: [14, 0] }],
    [1, HEXER_REST],
  ],
  cast: [
    [0, HEXER_REST],
    [.38, { hip: [0, -26], lean: -.12, hF: [17, -50], hN: [-22, -50], ang: -1.5, near: [-5, -1.4], far: [5, -1.4] }, easeOut],
    [.74, { hip: [0, -27], lean: -.12, hF: [17, -51], hN: [-22, -51], ang: -1.5, near: [-5, -2], far: [5, -2] }],
    [1, HEXER_REST],
  ],
};
function drawHexer(f, anim, t, frameNo) {
  const p = basePose(anim, t), b = p.breath || 0;
  let hN, hF, ang = HEXER_REST.ang;
  if (anim === 'idle') { hF = [20 + (p.weight || 0) * .3, -35 + b * .3]; hN = [12 + (p.weight || 0) * .4, -28 + b * .6]; }
  else if (anim === 'run') { const s = p.swing, up = p.hip[1] - HIP; hF = [17 - s * 2, -33 + up]; hN = [-4 + s * 6, -28 + up - Math.abs(s) * 1.4]; ang = -1.1; }
  else if (anim === 'down') {
    const d = downPose(t); Object.assign(p, d);
    hF = [d.hip[0] + 12, d.hip[1] + 4 + d.k * 2]; hN = [d.hip[0] + 3, d.hip[1] + 3]; ang = lerp(-1.53, -.1, d.k);
  } else if (anim === 'hurt') {
    const k = Math.sin(t * Math.PI); Object.assign(p, hurtKey(k));
    hF = [16, -33]; hN = [5, -27]; ang = -1.7;
  } else {
    const a = timeline(t, HEXER_KEYS[anim] || HEXER_KEYS.atk1);
    p.hip = a.hip; p.lean = a.lean; hF = a.hF; hN = a.hN; ang = a.ang; p.near = a.near; p.far = a.far; p.windBack = .05;
  }
  const J = bones(p), { hip, T, shN, shF } = J;
  hF = reach(shF, hF); hN = reach(shN, hN);
  capeLayers(f, J, p, ROBE, ROBE_IN, { seed: 47, len: 30, wide: 11, tear: 4, teeth: 6, foldLight: '#6a44a0' });
  catTail(f, J, p, FUR.black, { len: 34 });
  // Staff arm behind her, staff planted out in front.
  catArm(f, shF, hF, ROBE, FUR.black, { r0: 3 });
  witchStaff(f, hF[0], hF[1], ang, frameNo);
  // Paws barely show under layered skirts: an inner black, an outer violet split at the front.
  pawLeg(f, [hip[0] + 2, hip[1] + 1], p.far, INK, FUR.black, { r0: 4 });
  pawLeg(f, [hip[0] - 2, hip[1] + 1], p.near, INK, FUR.black, { r0: 4.2 });
  const sw = (anim === 'run' ? p.swing : b * .4) * 2.2;
  longSkirt(f, T, hip, -1, 7, 3, INK, 3, 2, sw, { drop: 17 });
  longSkirt(f, T, hip, -7.6, 2, 3.6, ROBE, 8, 3, sw, { drop: 20 });
  f.path(spline([T(4, 2), [hip[0] + 2 + sw * .4, hip[1] + 10], [hip[0] + 3 + sw, hip[1] + 19]], false, 3), '#c9963c', true);
  // A fitted bodice with a gold-edged neckline and hanging talismans.
  f.paint(spline([T(1, -6), T(6, -5.6), T(12, -6.8), T(17, -6), T(20, -1), T(20, 3), T(17, 6.6), T(12, 7.4), T(6, 6), T(1, 6.2)]), ROBE, { round: 4, shadow: 2, grad: .32 });
  f.path([T(18.4, -1), T(12, 2.6), T(18.4, 6.4)], '#d8a848', true);
  f.paint([T(1.2, -6.2), T(4, -6.2), T(4, 6.6), T(1.2, 6.6)], GOLD, { round: 1.4, shadow: 1, exposure: .62 });
  for (const q0 of [-3, 3.4]) { const q = T(1, q0); f.line(q[0], q[1], q[0], q[1] + 3.4, '#c9963c'); f.paint(ellipse(q[0], q[1] + 5, 1.5, 1.9), mat(['#3a0c4c', '#8c1c9c', '#e050e8'], { gloss: 1, round: 2 }), { shadow: 1 }); f.glow(q[0], q[1] + 5, '#e050e8', .5); }
  const raised = overFace(hN, J), drawHead = () => HEADS.hexer(f, J.hx, J.hy, J.tilt, 1, { mood: moodOf(anim, t, frameNo), phase: p.phase, twitch: anim === 'idle' && (frameNo === 13 || frameNo === 14) ? -.2 : 0 });
  if (!raised) drawHead();
  // Near arm in a long open sleeve, with the fire held in a bare black paw.
  const j = catArm(f, shN, hN, ROBE, FUR.black, { r0: 3.3 });
  const sa = Math.atan2(hN[1] - j.mid[1], hN[0] - j.mid[0]), cuff = along(j.mid, hN, .7), hang = 5.4 + Math.abs(sw) * .5;
  f.paint([[j.mid[0] - 1.6, j.mid[1] - 2.4], [cuff[0] + Math.sin(sa) * 2.6, cuff[1] - Math.cos(sa) * 2.6], [cuff[0] - Math.sin(sa) * 2.6, cuff[1] + hang], [cuff[0] - 4, cuff[1] + hang + 1.4], [j.mid[0] - 2.4, j.mid[1] + 4]], ROBE, { round: 2.8, shadow: 2 });
  f.line(cuff[0] - Math.sin(sa) * 2.6, cuff[1] + hang, cuff[0] - 4, cuff[1] + hang + 1.4, '#d8a848', true);
  flame(f, hN[0] + Math.cos(sa) * 2, hN[1] + Math.sin(sa) * 2, frameNo, anim === 'cast' ? 1.4 : 1);
  f.paint(ellipse(shN[0] - .3, shN[1], 4.8, 3.8, .1), INK, { round: 2.6, shadow: 2 });
  f.path(spline([[shN[0] - 3.6, shN[1] + 1.4], [shN[0], shN[1] + 3.2], [shN[0] + 3.8, shN[1] + 1]], false, 3), '#d8a848', true);
  if (raised) drawHead();
  if (anim === 'cast' && t > .2) {
    // A rune circle opening at her paws while she gathers power.
    const k = Math.sin(Math.min(1, (t - .2) / .7) * Math.PI);
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * TAU + t * 3, rx = 30 * k + 6, ry = 7 * k + 1;
      f.glow(Math.cos(a) * rx, -2 + Math.sin(a) * ry, '#ff4ad8', .8 * k);
      if (i % 5 === 0) f.glow(Math.cos(a) * rx * .7, -2 + Math.sin(a) * ry * .7, '#ffb14a', .9 * k);
    }
  }
}

// ---------------------------------------------------------------- Mender: a white cleric cat
const WHITEPLATE = mat(['#2a2a38', '#4c4c5e', '#747488', '#9c9cb0', '#c4c4d4', '#e4e4ee', '#ffffff'], { gloss: .9, ambient: .26, round: 3.4, exposure: .66 });
const WP_DARK = mat(['#141420', '#26263a', '#3e3e54', '#5a5a70', '#7c7c92'], { gloss: .6, round: 3, ambient: .2, exposure: .62 });
const IVORY = mat(['#2e2a2a', '#524a44', '#7c7262', '#a89c84', '#d0c6a8', '#ece4c8', '#fff8e4'], { ambient: .3, round: 6, exposure: .72, dither: .03 });
const IVORY_IN = mat(['#171414', '#262220', '#37302c', '#4a423a'], { ambient: .3, round: 5, exposure: .6 });
const TEAL = mat(['#04100e', '#0a221e', '#123a32', '#1c584a', '#2a7e68', '#44aa8c'], { ambient: .28, round: 3, exposure: .72 });
const MENDER_REST = { hip: [0, HIP], lean: .05, hF: [20, -34], hN: [9, -30], ang: -1.55, near: [-5.5, 0], far: [6, 0] };
const MENDER_KEYS = {
  atk1: [ // a two-handed overhead swing of the sun staff
    [0, MENDER_REST],
    [.32, { hip: [-3, -24], lean: -.2, hF: [4, -52], hN: [-5, -48], ang: -2.5, near: [-10, 0], far: [6, 0] }, easeOut],
    [.46, { hip: [6, -21], lean: .38, hF: [26, -36], hN: [17, -36], ang: -.35, near: [-9, 0], far: [16, 0] }, easeIn],
    [.7, { hip: [6, -20], lean: .32, hF: [25, -28], hN: [16, -30], ang: .35, near: [-8, 0], far: [16, 0] }, easeOut],
    [1, MENDER_REST],
  ],
  atk2: [ // a straight thrust, with no wide swing
    [0, MENDER_REST],
    [.32, { hip: [-4, -24], lean: -.12, hF: [1, -33], hN: [-7, -31], ang: -.12, near: [-11, 0], far: [5, 0] }, easeOut],
    [.46, { hip: [8, -22], lean: .34, hF: [31, -38], hN: [22, -37], ang: -.14, near: [-9, 0], far: [18, 0] }, easeIn],
    [.7, { hip: [7, -22], lean: .28, hF: [28, -37], hN: [19, -37], ang: -.14, near: [-9, 0], far: [17, 0] }, easeOut],
    [1, MENDER_REST],
  ],
  cast: [ // staff lifted high, other paw open to the sky
    [0, MENDER_REST],
    [.38, { hip: [0, -25], lean: -.1, hF: [18, -50], hN: [-22, -50], ang: -1.56, near: [-5.5, -1], far: [5, -1] }, easeOut],
    [.74, { hip: [0, -26], lean: -.1, hF: [18, -51], hN: [-22, -51], ang: -1.56, near: [-5.5, -1.4], far: [5, -1.4] }],
    [1, MENDER_REST],
  ],
};
function drawMender(f, anim, t, frameNo) {
  const p = basePose(anim, t), b = p.breath || 0;
  let hN, hF, ang = MENDER_REST.ang, smearArc = null;
  if (anim === 'idle') { hF = [20 + (p.weight || 0) * .3, -34 + b * .3]; hN = [9 + (p.weight || 0) * .4, -30 + b * .6]; }
  else if (anim === 'run') { const s = p.swing, up = p.hip[1] - HIP; hF = [18 - s * 2, -33 + up]; hN = [-4 + s * 6, -28 + up - Math.abs(s) * 1.4]; ang = -1.05; }
  else if (anim === 'down') {
    const d = downPose(t); Object.assign(p, d);
    hF = [d.hip[0] + 12, d.hip[1] + 4 + d.k * 2]; hN = [d.hip[0] + 3, d.hip[1] + 3]; ang = lerp(-1.55, -.1, d.k);
  } else if (anim === 'hurt') {
    const k = Math.sin(t * Math.PI); Object.assign(p, hurtKey(k));
    hF = [16, -33]; hN = [3, -28];
  } else {
    const a = timeline(t, MENDER_KEYS[anim] || MENDER_KEYS.atk1);
    p.hip = a.hip; p.lean = a.lean; hF = a.hF; hN = a.hN; ang = a.ang; p.near = a.near; p.far = a.far; p.windBack = .06;
    if (anim === 'atk1' && t > .32 && t < .6) { const k = (t - .32) / .28; smearArc = { a0: lerp(-2.5, .35, Math.max(0, k - .55)), a1: lerp(-2.5, .35, Math.min(1, k * 1.5)) }; }
  }
  const J = bones(p), { hip, T, shN, shF } = J;
  hF = reach(shF, hF); hN = reach(shN, hN);
  capeLayers(f, J, p, IVORY, IVORY_IN, { seed: 61, len: 30, wide: 11, tear: 3, teeth: 5, foldDark: '#2e2a2a', foldLight: '#efe7cc' });
  catTail(f, J, p, FUR.white, { tip: FUR.cream });
  // Far arm and the staff in it, far paw.
  pawLeg(f, [hip[0] + 2.2, hip[1] + 1], p.far, WP_DARK, FUR.white, { r0: 4.2 });
  catArm(f, shF, hF, WP_DARK, FUR.white, { r0: 3.1 });
  const R = pts => rotate(pts, ang, hF[0], hF[1]);
  const end = R([[32, 0]])[0], butt = R([[-30, 0]])[0];
  if (smearArc) smear(f, hF[0], hF[1], smearArc.a0, smearArc.a1, 14, 40, .8);
  f.paint(capsule(butt[0], butt[1], end[0], end[1], 1.4, 1.4), GOLD, { round: 1.4, shadow: 1, exposure: .72 });
  const sun = end;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU + frameNo * .08, r1 = i % 2 ? 6 : 8.6;
    f.paint(ribbon([[sun[0] + Math.cos(a) * 2, sun[1] + Math.sin(a) * 2], [sun[0] + Math.cos(a) * r1, sun[1] + Math.sin(a) * r1]], [1.5, .3], 2), GOLD, { shadow: 1, exposure: .78 });
  }
  f.paint(ellipse(sun[0], sun[1], 3.2, 3.2), mat(['#c98a24', '#f4c75a', '#fff0a8', '#ffffff'], { gloss: 1, round: 3, exposure: .9 }), { shadow: 1 });
  f.energy(sun[0], sun[1], 1.8);
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + frameNo * .3; f.energy(sun[0] + Math.cos(a) * 4, sun[1] + Math.sin(a) * 4, .4); }
  pawLeg(f, [hip[0] - 2.2, hip[1] + 1], p.near, WHITEPLATE, FUR.white, { r0: 4.4 });
  const sw = (anim === 'run' ? p.swing : b * .3) * 1.8;
  // A long cream robe trimmed in teal, a small plate over the chest, and a holy sign over the heart.
  longSkirt(f, T, hip, -7.4, 7.6, 2.8, IVORY, 13, 2, sw, { drop: 19 });
  f.path(spline([T(4, 3), [hip[0] + 3.4 + sw * .4, hip[1] + 10], [hip[0] + 4.4 + sw, hip[1] + 18]], false, 3), '#2a7e68', true);
  f.paint(spline([T(1, -6), T(6, -5.6), T(12, -6.8), T(17, -6.2), T(20, -1), T(20, 3), T(17, 6.8), T(12, 7.6), T(6, 6), T(1, 6.4)]), WHITEPLATE, { round: 4.2, gloss: 1, grad: .32, shadow: 2 });
  const heart = T(11.6, 2.6);
  rows(f, ['..G..', '.GGG.', 'GGWGG', '.GGG.', '..G..'], heart[0] - 2, heart[1] - 2, { G: '#e4b24e', W: '#fff4b8' });
  f.glow(heart[0], heart[1], '#ffd877', .6);
  f.paint([T(1.2, -6.2), T(4.2, -6.4), T(4.2, 6.6), T(1.2, 6.6)], TEAL, { round: 1.6, shadow: 1 });
  const bk = T(2.7, 1.8); f.paint(ellipse(bk[0], bk[1], 2, 2), GOLD, { shadow: 1 });
  const wing = (cx, cy, sc) => {
    for (let i = 0; i < 3; i++) {
      const a = -2.55 + i * .36, l = (7 - i * .8) * sc;
      f.paint(ribbon([[cx, cy], [cx + Math.cos(a) * l, cy + Math.sin(a) * l]], [1.8 * sc, .4], 3), i % 2 ? WHITEPLATE : GOLD, { round: 2, shadow: 1, exposure: .72 });
    }
    f.paint(ellipse(cx, cy, 5 * sc, 4 * sc, .15), WHITEPLATE, { round: 2.6, gloss: 1, shadow: 2 });
    f.path(spline([[cx - 4.2 * sc, cy + 1.2], [cx, cy + 3 * sc], [cx + 4.2 * sc, cy + 1]], false, 3), '#b5862c', true);
  };
  wing(shF[0], shF[1], .8);
  const raised = overFace(hN, J), nearArm = () => {
    const j = catArm(f, shN, hN, WHITEPLATE, FUR.white, { r0: 3.3 });
    f.paint(ellipse(j.mid[0], j.mid[1], 2.4, 2.2), GOLD, { round: 1.8, shadow: 1, exposure: .72 });
    wing(shN[0] - .6, shN[1] - .3, 1);
  };
  if (raised) nearArm();
  HEADS.mender(f, J.hx, J.hy, J.tilt, 1, { mood: moodOf(anim, t, frameNo), twitch: anim === 'idle' && (frameNo === 20 || frameNo === 21) ? -.2 : 0 });
  if (!raised) nearArm();
  if (anim === 'cast') {
    const k = Math.sin(t * Math.PI);
    for (let a = 0; a < 18; a++) { const q = a / 18 * TAU + t * 4; f.energy(sun[0] + Math.cos(q) * 13 * k, sun[1] + Math.sin(q) * 13 * k, .7 * k); }
  }
}

// A portrait uses the same head as the sprite, only larger, so the two can never drift apart.
export function renderCatHead(f, key, hx, hy, s, o = {}) { HEADS[key](f, hx, hy, 0, s, o); }
export const HEROES = {
  warden: { draw: drawWarden, rim: '#8a66c8', tint: [190, 120, 255] },
  fletcher: { draw: drawFletcher, rim: '#6cb4a8', tint: [255, 190, 90] },
  hexer: { draw: drawHexer, rim: '#c866b8', tint: [255, 120, 80] },
  mender: { draw: drawMender, rim: '#e4c070', tint: [255, 226, 150] },
};
export const CLIPS = { idle: 24, run: 14, atk1: 12, atk2: 12, atk3: 12, cast: 14, hurt: 5, down: 10 };
export function renderHeroFrame(key, anim, i) {
  const H = HEROES[key], n = CLIPS[anim], f = new Frame(FRAME.w, FRAME.h, FRAME.ox, FRAME.oy);
  const loop = anim === 'idle' || anim === 'run';
  H.draw(f, anim, loop ? i / n : i / (n - 1), i);
  // A faint rim of colour along the far edge, not a neon outline.
  f.finish({ rim: H.rim, rimK: .16 });
  f.tint = H.tint;
  return f;
}
void easeOut;
