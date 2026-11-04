// Monsters and bosses, all facing right. Each one is a stack of animated layers like the
// heroes, tinted per region through a colour ramp built from one base colour.
import { Frame, mat, spline, ellipse, capsule, ribbon, rotate, shift, rgb, mix } from './raster.mjs';
import { ik, timeline, gait, cloth, lerp, TAU, rnd, easeOut, easeIn } from './rig.mjs';
import { leg, armSeg, tatteredCloth, rows } from './heroes.mjs';

export const MON_FRAME = { w: 208, h: 132, ox: 104, oy: 124 };
export const BOSS_FRAME = { w: 320, h: 176, ox: 160, oy: 168 };

const toHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
// A ramp built from one colour: shadows drift to deep purple, lights drift warm.
function tone(base, o = {}) {
  const c = rgb(base);
  const list = [[.22, [18, 10, 34], .55], [.4, [24, 14, 40], .4], [.6, [30, 18, 44], .22], [.8, [40, 24, 50], .08], [1, c, 0], [1.2, [255, 238, 190], .12], [1.42, [255, 240, 200], .3]];
  return mat(list.map(([k, t, a]) => toHex(mix(c.map(v => v * k), t, a))), { exposure: .64, ambient: .2, round: 4, ...o });
}
const BONE = mat(['#26201c', '#4a4238', '#786c5a', '#a89a80', '#d2c6a8', '#efe6cc', '#fffbea'], { exposure: .72, ambient: .22, round: 2.6 });
const IRON = mat(['#08070c', '#13121a', '#20202a', '#30303e', '#464858', '#646878', '#9094a8', '#d0d4e0'], { gloss: .9, exposure: .55, ambient: .18, round: 3 });
const RUST = mat(['#120806', '#26120a', '#422010', '#643218', '#864a24', '#a86a38'], { gloss: .3, exposure: .62, ambient: .22, round: 2.6, dither: .1 });
const HIDE = mat(['#0e0808', '#1e1210', '#301e18', '#463026', '#5e4432', '#7c5c44'], { exposure: .64, ambient: .22, round: 3, dither: .06 });
const RAGS = mat(['#07060a', '#100e14', '#1a1820', '#28242e', '#3a3540'], { exposure: .62, ambient: .24, round: 4, dither: .05 });
const FUR = mat(['#0c0a0c', '#1c1618', '#2e2424', '#443634', '#5e4c46'], { exposure: .66, ambient: .22, round: 3, dither: .1 });
const eyeDot = (f, x, y, core, glow, p = 1.3) => { f.dot(x, y, core); f.glow(x, y, glow, p); };

function clipPose(clip, t) {
  if (clip === 'walk') { const g = gait(t, 11, 7, .8); return { hip: [0, g.bob], lean: .12, near: g.near, far: g.far, swing: g.swing, k: 0, reach: 0 }; }
  if (clip === 'atk') {
    const a = timeline(t, [
      [0, { x: 0, y: 0, lean: .08, reach: 0 }],
      [.38, { x: -6, y: 1.5, lean: -.26, reach: -.7 }, easeOut],
      [.52, { x: 10, y: 1, lean: .42, reach: 1 }, easeIn],
      [.72, { x: 9, y: 1, lean: .38, reach: .85 }],
      [1, { x: 0, y: 0, lean: .08, reach: 0 }],
    ]);
    return { hip: [a.x, a.y], lean: a.lean, near: [10 + a.x * .8, 0], far: [-10 + a.x * .2, 0], swing: 0, k: 0, reach: a.reach };
  }
  const k = easeIn(Math.min(1, t * 1.1));
  return { hip: [lerp(0, -5, k), lerp(0, 1, k)], lean: lerp(.05, -1.3, k), near: [lerp(9, 24, k), 0], far: [lerp(-9, 18, k), 0], swing: 0, k, reach: 0 };
}
// Shared joints for two-legged creatures. h is hip height, s the torso length.
function body(p, h, s) {
  const hip = [p.hip[0], -h + p.hip[1] + (p.k || 0) * (h - 7)], lx = Math.sin(p.lean), ly = -Math.cos(p.lean);
  const T = (a, b) => [hip[0] + lx * a - ly * b, hip[1] + ly * a + lx * b];
  return { hip, T, neck: T(s, 0) };
}

const MON = {
  goblin(f, clip, t, c) {
    const p = clipPose(clip, t), M = tone(c), m2 = tone(c, { exposure: .46 });
    const { hip, T, neck } = body({ ...p, lean: p.lean + .32 }, 25, 19);
    leg(f, [hip[0] - 2, hip[1]], [p.far[0] * .85, p.far[1]], m2, HIDE, { thigh: 14, shin: 14, hipR: 4.2 });
    armSeg(f, T(16, -6), T(3 + p.reach * 8, -14), m2, m2, { upper: 11, fore: 11, r0: 2.8 });
    leg(f, [hip[0] + 2, hip[1]], [p.near[0] * .85, p.near[1]], M, HIDE, { thigh: 14, shin: 14, hipR: 4.6 });
    // Ragged cloth, then a hunched bare torso crossed by a strap.
    f.paint(tatteredCloth(spline([T(1, -7), [hip[0] - 8, hip[1] + 10]], false, 2), spline([T(1, 7), [hip[0] + 8, hip[1] + 11]], false, 2), 13, 5, 4), RAGS, { round: 3 });
    f.paint(spline([T(-1, -6), T(8, -8), T(18, -8.5), T(21, 0), T(18, 8), T(8, 8), T(-1, 6.5)]), M, { round: 5, grad: .3, shadow: 2 });
    { const a = T(19, -7), b = T(2, 6); f.line(a[0], a[1], b[0], b[1], '#3a2416', true); f.line(a[0] + 1, a[1], b[0] + 1, b[1], '#5e3a20', true); }
    for (let i = 0; i < 3; i++) { const a = T(9 + i * 3, -2), b = T(9 + i * 3, 4); f.line(a[0], a[1], b[0], b[1], M.tones[1], true); }
    const hx = neck[0] + 2, hy = neck[1] - 6;
    // Long ears, a heavy brow, a nasty grin and a dented iron helm.
    f.paint(ribbon([[hx - 6, hy - 1], [hx - 14, hy - 6], [hx - 22, hy - 5]], [3.8, 2.6, .3], 3), m2, { shadow: 1 });
    f.paint(spline([[hx - 8, hy + 2], [hx - 7, hy - 7], [hx + 2, hy - 9], [hx + 9, hy - 5], [hx + 13, hy + 1], [hx + 12, hy + 5], [hx + 4, hy + 9], [hx - 4, hy + 8]]), M, { round: 5, shadow: 2 });
    f.paint(ribbon([[hx + 5, hy - 1], [hx + 13, hy - 7], [hx + 21, hy - 7]], [3.8, 2.6, .3], 3), M, { shadow: 1 });
    f.line(hx - 1, hy - 3, hx + 9, hy - 1, M.tones[0], true);
    eyeDot(f, hx + 1, hy - 1, '#fff0a0', '#ffc030'); eyeDot(f, hx + 2, hy - 1, '#ffd84a', '#ffc030', .8); eyeDot(f, hx + 8, hy, '#fff0a0', '#ffc030'); eyeDot(f, hx + 9, hy, '#ffd84a', '#ffc030', .8);
    f.line(hx, hy + 4, hx + 10, hy + 4, '#16080a', true);
    for (const x of [hx + 1, hx + 4, hx + 7, hx + 9]) f.dot(x, hy + 3, '#efe6cc');
    f.paint(spline([[hx - 8, hy - 3], [hx - 6, hy - 10], [hx + 1, hy - 13], [hx + 8, hy - 10], [hx + 11, hy - 3]]), IRON, { round: 3, gloss: 1, shadow: 2 });
    f.line(hx - 8, hy - 3, hx + 11, hy - 3, '#050408', true);
    f.paint(ribbon([[hx + 1, hy - 12], [hx + 2, hy - 20]], [2.2, .2], 2), IRON, { shadow: 1 });
    // A serrated cleaver.
    const hand = p.reach > .2 ? [T(18, 10)[0] + 12 * p.reach, T(18, 10)[1] + 6] : p.reach < -.2 ? [T(26, 4)[0] - 2, T(26, 4)[1] - 8] : [T(10, 10)[0] + 8, T(10, 10)[1] + 2];
    const ang = p.reach > .2 ? .35 : p.reach < -.2 ? -2.4 : -.7 + p.swing * .1;
    const R = pts => rotate(pts, ang, hand[0], hand[1]);
    f.paint(R([[-5, -1.2], [5, -1.2], [5, 1.2], [-5, 1.2]]), HIDE, { round: 1, shadow: 1 });
    f.paint(R([[4, -2], [24, -5], [27, -1], [24, 2], [21, 1], [19, 4], [16, 2], [13, 5], [10, 2], [4, 3.6]]), IRON, { round: 2.6, gloss: 1, exposure: .7, shadow: 1 });
    armSeg(f, T(15, 7), hand, M, M, { upper: 11, fore: 11, r0: 3 });
  },
  ratman(f, clip, t, c) {
    const p = clipPose(clip, t), M = tone(c), CL = mat(['#07040c', '#120a1c', '#1e122e', '#2e1c44', '#42295e', '#5c3a7c'], { exposure: .62, ambient: .2, round: 5, dither: .05 });
    const { hip, T, neck } = body({ ...p, lean: p.lean + .42 }, 26, 20);
    const wag = Math.sin(t * TAU * (clip === 'walk' ? 2 : 1));
    f.paint(ribbon([[hip[0] - 4, hip[1]], [hip[0] - 16, hip[1] + 8 + wag * 2], [hip[0] - 30, hip[1] + 4 - wag * 3], [hip[0] - 42, hip[1] + 11 + wag * 3]], [2.2, 1.8, 1.1, .3], 4), mat(['#4a2c30', '#8c5a58', '#c08a7a', '#e0b4a0'], { round: 1.6, exposure: .7 }), { shadow: 1 });
    const c1 = cloth(neck[0] - 4, neck[1] + 1, 34, 6, { trail: .55, sway: 3, phase: t });
    const c2 = cloth(neck[0] - 14, neck[1] + 2, 34, 6, { trail: .95, sway: 3.6, phase: t + .2 });
    f.paint(tatteredCloth(c1, c2, 7, 9, 6), CL, { round: 7, shadow: 0 });
    leg(f, [hip[0] - 2, hip[1]], p.far, tone(c, { exposure: .44 }), mat(['#2e1a1c', '#5c3838', '#8c5a58', '#b88c80'], { round: 2, exposure: .66 }), { thigh: 14, shin: 15, hipR: 4.6 });
    leg(f, [hip[0] + 2, hip[1]], p.near, M, mat(['#2e1a1c', '#5c3838', '#8c5a58', '#b88c80'], { round: 2, exposure: .7 }), { thigh: 14, shin: 15, hipR: 5 });
    f.paint(spline([T(-2, -7), T(8, -9), T(20, -8), T(23, 0), T(20, 8), T(8, 9), T(-2, 7)]), CL, { round: 5, shadow: 2 });
    { const a = T(1, -8), b = T(1, 8); f.paint([[a[0], a[1] - 1], [b[0], b[1] - 1], [b[0], b[1] + 2], [a[0], a[1] + 2]], HIDE, { round: 1.4, shadow: 1 }); }
    const hx = neck[0] + 3, hy = neck[1] - 4;
    f.paint(ellipse(hx - 7, hy - 8, 4.4, 5.4, -.3), mat(['#4a2c30', '#8c5a58', '#c88a84', '#eab4a8'], { round: 3, exposure: .68 }), { shadow: 1 });
    f.paint(spline([[hx - 9, hy + 3], [hx - 7, hy - 6], [hx + 2, hy - 8], [hx + 8, hy - 4], [hx + 20, hy + 1], [hx + 21, hy + 3], [hx + 9, hy + 8], [hx - 3, hy + 8]]), M, { round: 4, shadow: 2 });
    f.paint(spline([[hx - 11, hy + 8], [hx - 12, hy - 4], [hx - 7, hy - 10], [hx + 3, hy - 10], [hx + 7, hy - 6], [hx + 1, hy - 2], [hx - 3, hy + 7]]), CL, { round: 4, shadow: 2 });
    eyeDot(f, hx + 5, hy - 2, '#ffd0c0', '#ff2a2a', 1.4); eyeDot(f, hx + 6, hy - 2, '#ff5a4a', '#ff2a2a', .8);
    f.dot(hx + 20, hy + 1, '#e88a9a'); f.dot(hx + 21, hy + 2, '#e88a9a');
    f.line(hx + 7, hy + 5, hx + 19, hy + 3, '#10080a', true);
    for (const x of [hx + 15, hx + 17]) f.dot(x, hy + 5, '#efe6cc');
    for (const y of [hy + 1, hy + 3]) f.line(hx + 15, y, hx + 23, y + (y - hy - 2) * 2, '#b0a8a0');
    const hand = p.reach > .2 ? [T(20, 10)[0] + 14 * p.reach, T(20, 10)[1]] : p.reach < -.2 ? [T(24, 6)[0], T(24, 6)[1] - 8] : [T(8, 11)[0] + 8, T(8, 11)[1]];
    const ang = p.reach > .2 ? .1 : p.reach < -.2 ? -2.2 : -.35;
    const R = pts => rotate(pts, ang, hand[0], hand[1]);
    f.paint(R([[-4, -1], [3, -1], [3, 1], [-4, 1]]), HIDE, { round: 1, shadow: 1 });
    f.paint(R([[3, -2.4], [17, -1.4], [22, 0], [14, 2.4], [3, 2.4]]), RUST, { round: 2, shadow: 1, exposure: .8 });
    armSeg(f, T(17, 7), hand, CL, M, { upper: 10, fore: 11, r0: 3 });
  },
  skeleton(f, clip, t, c) {
    const p = clipPose(clip, t);
    const { hip, T, neck } = body(p, 34, 27);
    const bn = (a, b, r0, r1 = r0) => f.paint(capsule(a[0], a[1], b[0], b[1], r0, r1), BONE, { round: 1.8, shadow: 1 });
    const cA = cloth(neck[0] - 4, neck[1] + 3, 44, 6, { trail: .55, sway: 3, phase: t }), cB = cloth(neck[0] - 12, neck[1] + 4, 42, 6, { trail: .85, sway: 3.6, phase: t + .2 });
    f.paint(tatteredCloth(cA, cB, 3, 14, 6), mat(['#080408', '#1c0a12', '#34101c', '#4e1a26', '#6a2830'], { exposure: .6, round: 6 }), { shadow: 0 });
    // Far leg and a rotted shield behind the body.
    const fk = ik(hip[0] - 2, hip[1], p.far[0], p.far[1] - 2, 17, 17, -1);
    bn([hip[0] - 2, hip[1]], fk.mid, 1.8); bn(fk.mid, fk.end, 1.6);
    f.paint(ellipse(p.far[0] + 2, p.far[1] - 1.5, 4.2, 2), BONE, { shadow: 1 });
    const sh = T(19, -13);
    f.paint(ellipse(sh[0], sh[1], 8.6, 11, -.05), RUST, { round: 3.4, shadow: 1 });
    f.paint(ellipse(sh[0], sh[1], 6.4, 8.8, -.05), mat(['#100a0a', '#201414', '#301c18', '#40261e'], { round: 4 }), { shadow: 1 });
    f.paint(ellipse(sh[0], sh[1], 2.2, 2.2), IRON, { shadow: 1 });
    const nk = ik(hip[0] + 2, hip[1], p.near[0], p.near[1] - 2, 17, 17, -1);
    bn([hip[0] + 2, hip[1]], nk.mid, 2); bn(nk.mid, nk.end, 1.8);
    f.paint(ellipse(nk.mid[0], nk.mid[1], 2.6, 2.6), BONE, { shadow: 1 });
    f.paint(ellipse(p.near[0] + 2, p.near[1] - 1.5, 4.6, 2.2), BONE, { shadow: 1 });
    // Pelvis, spine and a rib cage you can see through.
    f.paint(spline([[hip[0] - 6, hip[1] - 2], [hip[0] + 6, hip[1] - 2], [hip[0] + 5, hip[1] + 3], [hip[0], hip[1] + 5], [hip[0] - 5, hip[1] + 3]]), BONE, { round: 2.4, shadow: 1 });
    bn(T(2, 0), T(14, 0), 1.3);
    for (let i = 0; i < 5; i++) {
      const y = 12 + i * 3, w = 7.5 - Math.abs(i - 1.5) * .8;
      f.paint(ribbon([T(y, -w), T(y + 1.5, 0), T(y, w)], [.9, 1, .9], 3), BONE, { round: 1, shadow: 1 });
    }
    f.paint(ribbon([T(27, -9), T(28, 0), T(27, 9)], [1.6, 1.8, 1.6], 3), BONE, { round: 1.4, shadow: 1 });
    // Rusted shoulder plate, skull, broken iron helm.
    const hx = neck[0] + 2, hy = neck[1] - 8;
    f.paint(spline([[hx - 7, hy - 1], [hx - 3, hy - 8], [hx + 5, hy - 8], [hx + 9, hy - 2], [hx + 8, hy + 3], [hx + 5, hy + 5], [hx + 5, hy + 10], [hx - 1, hy + 10], [hx - 2, hy + 5], [hx - 6, hy + 3]]), BONE, { round: 3.4, shadow: 2 });
    rows(f, ['.KKK..KKK', 'KKKK..KKK', 'KKRK..KRK', '.KK....K.'], hx - 3, hy - 3, { K: '#0c0a10', R: '#ff5a44' });
    f.glow(hx - 1, hy - 1, '#ff3a2a', 1.3); f.glow(hx + 4, hy - 1, '#ff3a2a', 1.3);
    f.dot(hx + 2, hy + 2, '#0c0a10'); f.dot(hx + 3, hy + 3, '#0c0a10');
    for (let i = 0; i < 4; i++) f.line(hx + i * 1.7, hy + 6, hx + i * 1.7, hy + 9, '#1e1a18', true);
    f.paint(spline([[hx - 8, hy - 3], [hx - 5, hy - 10], [hx + 3, hy - 12], [hx + 9, hy - 8], [hx + 10, hy - 3]]), RUST, { round: 2.6, gloss: .4, shadow: 2 });
    f.line(hx - 8, hy - 3, hx + 10, hy - 3, '#1a0e08', true);
    f.paint(ribbon([[hx + 7, hy - 9], [hx + 12, hy - 15], [hx + 11, hy - 23]], [2.6, 1.6, .2], 3), BONE, { shadow: 1 });
    f.paint(ribbon([[hx - 5, hy - 10], [hx - 10, hy - 13], [hx - 11, hy - 16]], [2.4, 1.4, .3], 3), BONE, { shadow: 1 });
    const pa = T(26, 9);
    f.paint(ellipse(pa[0], pa[1], 7.6, 5.8, -.2), RUST, { round: 3, shadow: 2 });
    f.line(pa[0] - 6, pa[1] + 2, pa[0] + 6, pa[1] + 1, '#1a0e08', true);
    // Sword arm.
    const hand = p.reach > .2 ? [T(22, 12)[0] + 18 * p.reach, T(22, 12)[1] - 2] : p.reach < -.2 ? [T(32, 4)[0], T(32, 4)[1] - 8] : [T(13, 12)[0] + 8, T(13, 12)[1] + p.swing];
    const ang = p.reach > .2 ? .1 : p.reach < -.2 ? -2.3 : -.32;
    const R = pts => rotate(pts, ang, hand[0], hand[1]);
    f.paint(R([[-5, -1.2], [3, -1.2], [3, 1.2], [-5, 1.2]]), HIDE, { round: 1, shadow: 1 });
    f.paint(R([[3, -5], [5, -5], [5, 5], [3, 5]]), RUST, { round: 1.4, shadow: 1 });
    f.paint(R([[5, -2.6], [32, -2], [38, 0], [32, 2], [24, 1.2], [21, 3], [17, 1.6], [5, 2.6]]), mat(['#22201e', '#403a34', '#625a4e', '#88806e', '#ada490', '#d4cbb6'], { gloss: .5, exposure: .72, round: 2.4 }), { shadow: 1 });
    const el = ik(pa[0], pa[1], hand[0], hand[1], 13, 13, 1);
    bn(pa, el.mid, 1.7); bn(el.mid, hand, 1.5);
    f.paint(ellipse(hand[0], hand[1], 2.6, 2.4), BONE, { shadow: 1 });
    void c;
  },
  zombie(f, clip, t, c) {
    const p = clipPose(clip, t), M = tone(c, { dither: .1 }), m2 = tone(c, { exposure: .44 });
    const { hip, T, neck } = body({ ...p, lean: p.lean + .36 }, 30, 25);
    const reach = Math.max(0, p.reach) * 12;
    armSeg(f, T(22, -7), T(38 + reach, -3 + p.swing), m2, m2, { upper: 15, fore: 17, r0: 3.2, bend: -1 });
    leg(f, [hip[0] - 2, hip[1]], p.far, m2, RAGS, { thigh: 16, shin: 16, hipR: 4.6 });
    leg(f, [hip[0] + 2, hip[1]], p.near, tone('#3a3644', { exposure: .6 }), M, { thigh: 16, shin: 16, hipR: 5 });
    f.paint(tatteredCloth(spline([T(1, -8), [hip[0] - 9, hip[1] + 14]], false, 2), spline([T(1, 8), [hip[0] + 9, hip[1] + 15]], false, 2), 21, 7, 5), RAGS, { round: 4 });
    f.paint(spline([T(-1, -7), T(9, -9), T(22, -10), T(26, 0), T(22, 9), T(9, 8), T(-1, 6)]), M, { round: 5, shadow: 2, grad: .3 });
    for (let i = 0; i < 4; i++) { const a = T(11 + i * 3, -6), b = T(11 + i * 3, 2); f.line(a[0], a[1], b[0], b[1], M.tones[1], true); f.line(a[0] + 1, a[1], b[0] + 1, b[1], M.tones[5], true); }
    { const a = T(9, 4), b = T(20, 7); f.line(a[0], a[1], b[0], b[1], '#6a1c20', true); f.line(a[0], a[1] + 1, b[0], b[1] + 1, '#a02c2c', true); }
    f.paint(tatteredCloth(spline([T(24, -11), T(10, -11)], false, 2), spline([T(25, 2), T(9, 3)], false, 2), 9, 5, 4), RAGS, { round: 3, shadow: 2 });
    const hx = neck[0] + 3, hy = neck[1] - 3;
    f.paint(spline([[hx - 8, hy], [hx - 6, hy - 8], [hx + 3, hy - 10], [hx + 10, hy - 6], [hx + 12, hy + 2], [hx + 10, hy + 9], [hx + 3, hy + 11], [hx - 4, hy + 8]]), M, { round: 5, shadow: 2 });
    rows(f, ['KKKK.KKK', 'KCCK.KCC', '.KK...K.'], hx - 1, hy - 3, { K: '#090b0a', C: '#b8ff7a' });
    f.glow(hx + 1, hy - 2, '#8cff50', 1.2); f.glow(hx + 6, hy - 2, '#8cff50', 1.2);
    f.line(hx + 1, hy + 5, hx + 11, hy + 5, '#0c0808', true); f.line(hx + 2, hy + 7, hx + 10, hy + 7, '#0c0808', true);
    for (const x of [hx + 2, hx + 5, hx + 8]) { f.dot(x, hy + 6, '#e4dcc0'); }
    for (const q of [[hx - 6, hy - 8], [hx - 2, hy - 10], [hx + 3, hy - 10], [hx + 7, hy - 8]]) f.paint(ribbon([q, [q[0] - 1.5, q[1] - 2], [q[0] - 4, q[1] + 3]], [1.6, 1, .2], 2), FUR, { shadow: 0 });
    armSeg(f, T(21, 8), T(39 + reach, 5 + p.swing), M, M, { upper: 15, fore: 17, r0: 3.4, bend: -1 });
    const h = T(39 + reach, 5 + p.swing);
    for (const d of [-2, 0, 2]) f.line(h[0], h[1] + d, h[0] + 6, h[1] + d * 1.6 + 2, '#d8d0b8');
  },
  orc(f, clip, t, c) {
    const p = clipPose(clip, t), M = tone(c), m2 = tone(c, { exposure: .46 });
    const { hip, T, neck } = body(p, 37, 34);
    const cA = cloth(neck[0] - 10, neck[1] + 4, 52, 6, { trail: .5, sway: 3, phase: t }), cB = cloth(neck[0] - 24, neck[1] + 6, 50, 6, { trail: .9, sway: 3.6, phase: t + .2 });
    f.paint(tatteredCloth(cA, cB, 37, 12, 7), FUR, { round: 8, shadow: 0, fn: (x, y) => ((x + y * 2) % 5 < 1 ? -.1 : 0) });
    armSeg(f, T(30, -15), T(10, -24 + p.swing * 3), m2, IRON, { upper: 18, fore: 18, r0: 6, bend: -1 });
    leg(f, [hip[0] - 4, hip[1]], p.far, m2, IRON, { thigh: 19, shin: 19, hipR: 7 });
    leg(f, [hip[0] + 4, hip[1]], p.near, M, IRON, { thigh: 19, shin: 19, hipR: 7.5 });
    f.paint(tatteredCloth(spline([T(2, -13), [hip[0] - 14, hip[1] + 18]], false, 2), spline([T(2, 13), [hip[0] + 14, hip[1] + 19]], false, 2), 29, 8, 6), FUR, { round: 5, shadow: 2 });
    // A barrel chest crossed with leather and studded iron.
    f.paint(spline([T(0, -12), T(14, -16), T(30, -19), T(36, -10), T(37, 2), T(35, 15), T(28, 19), T(14, 16), T(0, 12)]), M, { round: 8, shadow: 2, grad: .34 });
    { const a = T(34, -14), b = T(3, 12), c2 = T(34, 14), d = T(3, -12); for (const [u, v] of [[a, b], [c2, d]]) for (let o = -1; o <= 1; o++) f.line(u[0], u[1] + o, v[0], v[1] + o, o === 0 ? '#5e4432' : '#26180e', true); }
    const stud = T(19, 0); f.paint(ellipse(stud[0], stud[1], 5, 5), IRON, { round: 3, gloss: 1.2, shadow: 2 });
    f.paint([T(-2, -14), T(5, -15), T(5, 15), T(-2, 14)], HIDE, { round: 2, shadow: 1 });
    f.paint(ellipse(T(1.5, 0)[0], T(1.5, 0)[1], 6, 4.4), IRON, { round: 2.6, gloss: 1, shadow: 1 });
    // Spiked far pauldron.
    const paul = (cx, cy, sc) => {
      for (const [dx, a, l] of [[-7, -2.2, 16], [0, -1.6, 20], [7, -1, 15]]) f.paint(ribbon([[cx + dx * sc, cy - 6 * sc], [cx + dx * sc + Math.cos(a) * l * sc, cy - 6 * sc + Math.sin(a) * l * sc]], [3.4 * sc, .3], 3), BONE, { shadow: 1 });
      f.paint(ellipse(cx, cy, 13 * sc, 10 * sc, -.15), IRON, { round: 5, gloss: 1, shadow: 2 });
      f.path(spline([[cx - 11 * sc, cy + 4 * sc], [cx, cy + 7 * sc], [cx + 11 * sc, cy + 3 * sc]], false, 3), '#050408', true);
    };
    paul(T(31, -16)[0], T(31, -16)[1], .84);
    // A low brutal head with tusks, in a horned skull helm.
    const hx = neck[0] + 3, hy = neck[1] - 4;
    f.paint(spline([[hx - 10, hy + 2], [hx - 8, hy - 7], [hx + 3, hy - 9], [hx + 11, hy - 5], [hx + 14, hy + 3], [hx + 13, hy + 10], [hx + 5, hy + 14], [hx - 5, hy + 12]]), M, { round: 6, shadow: 2 });
    f.line(hx - 2, hy - 2, hx + 12, hy, M.tones[0], true);
    rows(f, ['RR....RR', 'WR....WR'], hx, hy - 1, { R: '#ff4a2c', W: '#ffd0a0' });
    f.glow(hx + 1, hy, '#ff3a1c', 1.4); f.glow(hx + 7, hy, '#ff3a1c', 1.4);
    f.line(hx + 1, hy + 7, hx + 12, hy + 7, '#120808', true);
    for (const x of [hx + 1, hx + 11]) f.paint(ribbon([[x, hy + 8], [x + .4, hy + 1]], [2, .3], 2), BONE, { shadow: 1 });
    f.paint(spline([[hx - 11, hy - 1], [hx - 9, hy - 10], [hx + 2, hy - 14], [hx + 12, hy - 10], [hx + 14, hy - 1], [hx + 7, hy - 3], [hx - 3, hy - 3]]), IRON, { round: 4, gloss: 1, shadow: 2 });
    f.paint(ribbon([[hx - 9, hy - 8], [hx - 19, hy - 12], [hx - 24, hy - 23]], [3.8, 2.8, .3], 4), BONE, { shadow: 1 });
    f.paint(ribbon([[hx + 11, hy - 8], [hx + 20, hy - 13], [hx + 24, hy - 24]], [3.8, 2.8, .3], 4), BONE, { shadow: 1 });
    // Near pauldron and a huge double-bladed axe.
    paul(T(30, 17)[0], T(30, 17)[1], 1);
    const hand = p.reach > .2 ? [T(26, 22)[0] + 18 * p.reach, T(26, 22)[1] + 2] : p.reach < -.2 ? [T(34, 12)[0], T(34, 12)[1] - 18] : [T(12, 20)[0] + 6, T(12, 20)[1] + p.swing * 2];
    const ang = p.reach > .2 ? .3 : p.reach < -.2 ? -2.3 : -1.15 + p.swing * .1;
    const R = pts => rotate(pts, ang, hand[0], hand[1]);
    f.paint(R([[-12, -1.8], [44, -1.8], [44, 1.8], [-12, 1.8]]), HIDE, { round: 1.6, shadow: 1 });
    for (const s of [-1, 1]) f.paint(R([[32, s * 1.6], [28, s * 8], [24, s * 20], [34, s * 24], [46, s * 22], [50, s * 12], [44, s * 1.6]]), IRON, { round: 3.6, gloss: 1.1, exposure: .72, shadow: 1 });
    { const a = R([[24, 20], [50, 12]]); f.line(a[0][0], a[0][1], a[1][0], a[1][1], '#e4e8f4', true); const b = R([[24, -20], [50, -12]]); f.line(b[0][0], b[0][1], b[1][0], b[1][1], '#e4e8f4', true); }
    armSeg(f, T(30, 17), hand, M, IRON, { upper: 17, fore: 18, r0: 6.2 });
  },
  golem(f, clip, t, c) {
    const p = clipPose(clip, t), M = tone(c, { round: 5, dither: .08 }), m2 = tone(c, { exposure: .44, round: 5 });
    const { hip, T, neck } = body(p, 34, 36);
    const crack = (pts) => { for (let i = 1; i < pts.length; i++) { f.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], '#bff4ff', true); f.glowLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], '#3ccfff', .55); } };
    const rock = (pts, m = M, o = {}) => f.paint(pts, m, { round: 5, shadow: 2, ...o });
    const lump = (cx, cy, r, m = M) => rock(Array.from({ length: 9 }, (_, i) => { const a = i / 9 * TAU, q = r * (.82 + rnd(cx * 7 | 0, i) * .3); return [cx + Math.cos(a) * q, cy + Math.sin(a) * q]; }), m);
    // Far fist.
    const fa = T(32, -20), fh = T(8, -29);
    lump((fa[0] + fh[0]) / 2, (fa[1] + fh[1]) / 2, 8, m2); lump(fh[0], fh[1], 9.5, m2);
    lump(hip[0] - 5 + p.far[0] * .4, -17 + p.far[1], 9, m2); lump(p.far[0], -6 + p.far[1], 8, m2);
    lump(hip[0] + 5 + p.near[0] * .4, -17 + p.near[1], 10); lump(p.near[0] + 1, -6 + p.near[1], 8.6);
    // Torso of stacked, cracked slabs held together by light.
    rock([T(-3, -14), T(14, -19), T(32, -22), T(39, -10), T(40, 8), T(33, 22), T(14, 19), T(-3, 13)], M, { grad: .36 });
    crack([T(32, -8), T(24, -2), T(27, 6), T(16, 10), T(8, 4), T(1, 8)]);
    crack([T(24, -2), T(14, -9), T(6, -7)]);
    const core = T(20, 2);
    f.paint(ellipse(core[0], core[1], 6, 6), mat(['#0c3a54', '#1c7ca8', '#54ccf0', '#c8f6ff'], { round: 4, gloss: 1, exposure: .9 }), { shadow: 2 });
    f.glow(core[0], core[1], '#3ccfff', 2.2); f.dot(core[0] - 1, core[1] - 1, '#ffffff');
    lump(T(35, -19)[0], T(35, -19)[1], 10, M);
    const hx = neck[0] + 2, hy = neck[1] - 6;
    rock([[hx - 10, hy - 4], [hx - 4, hy - 11], [hx + 8, hy - 11], [hx + 13, hy - 3], [hx + 11, hy + 8], [hx + 2, hy + 11], [hx - 8, hy + 8]], M, { grad: .38 });
    f.line(hx - 6, hy - 3, hx + 11, hy - 1, '#07080c', true); f.line(hx - 6, hy - 2, hx + 11, hy, '#07080c', true);
    for (let x = hx - 3; x < hx + 9; x++) { const y = hy - 2.2 + (x - hx) * .11; eyeDot(f, x, y, x % 4 === 0 ? '#ffffff' : '#9eeeff', '#3ccfff', .5); }
    crack([[hx + 2, hy - 11], [hx + 4, hy - 5]]); crack([[hx + 3, hy + 2], [hx + 5, hy + 9]]);
    const shoulder = T(35, 21);
    lump(shoulder[0], shoulder[1], 11.5);
    const slam = p.reach > .2 ? 16 : p.reach < -.2 ? -22 : p.swing * 3;
    const hand = [shoulder[0] + 10 + Math.max(0, p.reach) * 14, shoulder[1] + 26 + slam * .6];
    lump((shoulder[0] + hand[0]) / 2, (shoulder[1] + hand[1]) / 2, 8.6);
    lump(hand[0], hand[1], 11.5);
    crack([[hand[0] - 5, hand[1] - 3], [hand[0] + 1, hand[1] + 1], [hand[0] + 6, hand[1] - 2]]);
  },
  imp(f, clip, t, c) {
    const beat = Math.sin(t * TAU * (clip === 'walk' ? 2 : 1)), M = tone(c), W = mat(['#0e0408', '#22080e', '#3c0e16', '#581820', '#742630'], { round: 3, exposure: .68 });
    const by = -24 + beat * 2, atk = clip === 'atk' ? Math.max(0, Math.sin(t * Math.PI)) : 0, k = clip === 'die' ? easeIn(t) : 0;
    const y = by + k * 22, rot0 = k * -1;
    const wing = (side, scale) => {
      const a = -1.2 + beat * .5;
      const tips = [[0, 0], [Math.cos(a) * 28, Math.sin(a) * 28], [Math.cos(a + .55) * 26, Math.sin(a + .55) * 26], [Math.cos(a + 1) * 22, Math.sin(a + 1) * 22], [Math.cos(a + 1.5) * 13, Math.sin(a + 1.5) * 13]];
      f.paint(tips.map(([x, q]) => [-4 + x * -side * scale, y - 12 + q * scale]), W, { round: 4, shadow: 1 });
      f.line(-4, y - 12, -4 + tips[1][0] * -side * scale, y - 12 + tips[1][1] * scale, '#0a0204', true);
    };
    wing(1, 1); wing(1, .82);
    f.paint(ribbon([[-3, y], [-13, y + 7], [-22, y + 1 + beat * 2], [-27, y + 6]], [1.8, 1.4, .9, .3], 3), M, { shadow: 1 });
    f.paint(capsule(-2, y, -3 + beat, y + 13, 2.8, 2), M, { shadow: 1 });
    f.paint(capsule(3, y, 5 - beat, y + 12, 3, 2), M, { shadow: 1 });
    f.paint(rotate([[-7, -14], [7, -14], [8, -6], [5, 2], [-5, 2], [-7, -6]], rot0, 0, y), M, { round: 4, shadow: 2 });
    const hx = 2 + k * -6, hy = y - 21 + k * 8;
    for (const [bx, d] of [[hx - 5, -1], [hx + 6, 1]]) f.paint(ribbon([[bx, hy - 4], [bx + d * 4, hy - 9], [bx + d * 3, hy - 16]], [2.4, 1.6, .2], 3), BONE, { shadow: 1 });
    f.paint(spline([[hx - 7, hy - 1], [hx - 3, hy - 7], [hx + 4, hy - 7], [hx + 8, hy - 1], [hx + 7, hy + 4], [hx + 2, hy + 8], [hx - 3, hy + 7], [hx - 7, hy + 3]]), M, { round: 4, shadow: 2 });
    f.line(hx - 4, hy - 3, hx + 7, hy - 1, M.tones[0], true);
    rows(f, ['YY...YY', 'WY...WY'], hx - 3, hy - 1, { Y: '#ffe84a', W: '#ffffff' });
    f.glow(hx - 2, hy, '#ffc81c', 1.1); f.glow(hx + 4, hy, '#ffc81c', 1.1);
    f.line(hx - 2, hy + 4, hx + 6, hy + 4, '#180806', true);
    for (const x of [hx - 1, hx + 2, hx + 5]) f.dot(x, hy + 3, '#efe6cc');
    // Fireball gathering in the raised hand.
    const hand = [10 + atk * 8, y - 10 - atk * 4];
    f.paint(capsule(4, y - 11, hand[0], hand[1], 2.4, 1.9), M, { shadow: 1 });
    const r = 3 + atk * 4;
    for (let i = 0; i < 18; i++) { const q = i / 18, a = q * TAU * 2 + t * 18, d = r * (1 - q); const x = hand[0] + 3 + Math.cos(a) * d, yy = hand[1] - 3 + Math.sin(a) * d - q * 4; f.dot(x, yy, q < .4 ? '#ffb14a' : '#fff0b8'); f.glow(x, yy, '#ff7a2c', .8); }
  },
  slime(f, clip, t, c) {
    const k = clip === 'die' ? easeIn(t) : 0;
    const sq = clip === 'atk' ? [1, .72, 1.32, 1.22, 1][Math.min(4, Math.floor(t * 5))] : 1 + Math.sin(t * TAU) * .09;
    const w = 24 / Math.sqrt(sq) * (1 + k * .5), h = 36 * sq * (1 - k * .8);
    const M = tone(c, { round: 9, exposure: .7, gloss: .9, ambient: .3 });
    const lean = clip === 'atk' ? Math.sin(t * Math.PI) * 8 : 0;
    const wob = Math.sin(t * TAU * 2) * 2;
    const shape = [[-w, -1], [-w * .92, -h * .36], [-w * .55 + lean * .5, -h * .78], [lean, -h], [w * .55 + lean, -h * .82 + wob], [w * .95 + lean * .4, -h * .36], [w, -1], [w * .5, 2], [w * .15, 0], [-w * .3, 2.5], [-w * .7, 0]];
    f.paint(spline(shape), M, { round: 10, shadow: 0, grad: .3 });
    // Things caught inside: bones and a half-dissolved skull.
    const sx = lean * .7 - 4, sy = -h * .42;
    if (h > 12) {
      f.paint(spline([[sx - 7, sy], [sx - 5, sy - 7], [sx + 3, sy - 8], [sx + 7, sy - 2], [sx + 5, sy + 4], [sx + 3, sy + 9], [sx - 3, sy + 9], [sx - 4, sy + 4]]), mat(['#332e28', '#5c5648', '#8e8670', '#b8b098'], { round: 3, exposure: .6 }), { shadow: 0 });
      rows(f, ['KKK.KK', 'KKK.KK'], sx - 3, sy - 3, { K: '#141014' });
      f.line(sx - 12, sy + 13, sx - 3, sy + 17, '#8e8670', true); f.line(sx + 9, sy + 14, sx + 14, sy + 9, '#8e8670', true);
      rows(f, ['KK..KK', 'WK..WK'], lean + 6, -h * .72, { K: '#0e0a12', W: '#ffffff' });
      f.glow(lean + 7, -h * .72, '#ffffff', .25);
    }
    // Glossy highlights and slow drips.
    f.paint(ellipse(-w * .42 + lean * .5, -h * .68, 4.6, 2.8, -.5), mat(['#ffffff'], {}), { shadow: 0, edge: 0 });
    f.dot(-w * .1 + lean * .6, -h * .86, '#ffffff'); f.dot(-w * .1 + lean * .6 + 1, -h * .86, '#ffffff');
    for (const [dx, ph] of [[-w * .62, 0], [w * .1, .4], [w * .6, .7]]) { const q = (t + ph) % 1; f.dot(dx, -2 + q * 3, M.tones[2]); f.dot(dx, -1 + q * 3, M.tones[2]); }
  },
  bat(f, clip, t, c) {
    const flap = Math.sin(t * TAU * (clip === 'walk' ? 2 : 1)), M = tone(c), Mem = tone(c, { exposure: .46, round: 4 });
    const k = clip === 'die' ? easeIn(t) : 0, dive = clip === 'atk' ? Math.sin(t * Math.PI) : 0;
    const by = -34 + flap * 3 + k * 28 + dive * 8, bx = dive * 10, up = flap;
    const wing = side => {
      const sh = [bx + side * 5, by - 7];
      const elbow = [sh[0] + side * 13, sh[1] - 11 * up - 4], wrist = [elbow[0] + side * 11, elbow[1] - 6 * up + 3];
      const tips = [[wrist[0] + side * 12, wrist[1] + 6], [wrist[0] + side * 6, wrist[1] + 17], [elbow[0] + side * 3, elbow[1] + 21], [sh[0] + side * 3, sh[1] + 15]];
      f.paint([sh, elbow, wrist, tips[0], [(tips[0][0] + tips[1][0]) / 2 - side * 2, (tips[0][1] + tips[1][1]) / 2 - 3], tips[1], [(tips[1][0] + tips[2][0]) / 2, (tips[1][1] + tips[2][1]) / 2 - 3], tips[2], [(tips[2][0] + tips[3][0]) / 2, (tips[2][1] + tips[3][1]) / 2 - 3], tips[3]], Mem, { round: 6, shadow: 1, fn: (x) => Math.sin(x * .55) * .07 });
      f.line(sh[0], sh[1], elbow[0], elbow[1], M.tones[3], true); f.line(elbow[0], elbow[1], wrist[0], wrist[1], M.tones[3], true);
      for (const q of tips.slice(0, 3)) f.line(wrist[0], wrist[1], q[0], q[1], M.tones[2], true);
      f.paint(ribbon([wrist, [wrist[0] - side * 2, wrist[1] - 4]], [1.2, .2], 2), BONE, { shadow: 0 });
    };
    wing(-1); wing(1);
    f.paint(ellipse(bx, by + 2, 7.5, 10.5), M, { round: 6, shadow: 2 });
    f.paint(ellipse(bx + 1, by + 5, 4.6, 6), mat(['#2a1c2a', '#4a3440', '#6e5058', '#8e6e70'], { round: 3.6, exposure: .6, dither: .1 }), { shadow: 0 });
    const hx = bx + 1, hy = by - 10;
    for (const d of [-1, 1]) f.paint([[hx + d * 2, hy - 3], [hx + d * 8, hy - 15], [hx + d * 8, hy - 2]], M, { round: 2, shadow: 1 });
    f.paint(ellipse(hx, hy, 7.5, 6.5), M, { round: 4.5, shadow: 2 });
    rows(f, ['RR..RR', 'WR..WR'], hx - 3, hy - 2, { R: '#ff3a2c', W: '#ffd0c0' });
    f.glow(hx - 2, hy - 1, '#ff2a1c', 1.3); f.glow(hx + 2, hy - 1, '#ff2a1c', 1.3);
    f.line(hx - 3, hy + 3, hx + 4, hy + 3, '#0c0608', true);
    f.dot(hx - 2, hy + 4, '#efe6cc'); f.dot(hx + 3, hy + 4, '#efe6cc');
    for (const d of [-3, 3]) f.line(bx + d, by + 12, bx + d * 1.5, by + 17, BONE.tones[3]);
  },
  scorpion(f, clip, t, c) {
    const M = tone(c, { gloss: .8, round: 4 }), m2 = tone(c, { exposure: .44, gloss: .5 });
    const walk = clip === 'walk', a = t * TAU * 2, k = clip === 'die' ? easeIn(t) : 0;
    const sting = clip === 'atk' ? Math.sin(Math.min(1, t * 1.4) * Math.PI) : 0, drop = k * 12;
    const by = -15 + (walk ? Math.sin(a * 2) * .7 : 0) + drop;
    for (let i = 0; i < 4; i++) {
      const x = -18 + i * 10, s = Math.sin(a + i * 1.6) * (walk ? 4 : 0);
      const kn = [x - 5 + s, by + 2 - 5], ft = [x - 10 + s * 1.5, -1 + (walk ? -Math.max(0, Math.cos(a + i * 1.6)) * 2 : 0)];
      f.paint(capsule(x, by + 1, kn[0], kn[1], 1.8, 1.5), m2, { shadow: 1 });
      f.paint(capsule(kn[0], kn[1], ft[0], ft[1], 1.5, .7), m2, { shadow: 1 });
    }
    // Tail: armoured segments curling up and over, striking on attack.
    const pts = [[-24, by - 3], [-35, by - 15], [-37, by - 30], [-26 + sting * 16, by - 42 + sting * 7], [-12 + sting * 28, by - 42 + sting * 14], [-2 + sting * 34, by - 34 + sting * 17]];
    for (let i = 1; i < pts.length; i++) f.paint(capsule(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], 6 - i * .7, 5.4 - i * .7), M, { round: 3, gloss: 1, shadow: 2 });
    const tip = pts[5], back = pts[4], ang = Math.atan2(tip[1] - back[1], tip[0] - back[0]);
    f.paint(rotate([[-3, -4], [3, -4.6], [15, 2], [3, 4], [-3, 3.6]], ang + .5, tip[0], tip[1]), mat(['#08060e', '#1e142c', '#3e2850', '#6a4478'], { gloss: 1, round: 2 }), { shadow: 1 });
    const st = rotate([[14, 2]], ang + .5, tip[0], tip[1])[0];
    f.glow(st[0], st[1], '#a4ff4a', 1.6); f.dot(st[0], st[1], '#e8ffb0');
    // Plated body, each segment lit on its own.
    for (let i = 0; i < 5; i++) {
      const x = -22 + i * 9.5, r = 7 + Math.sin(i / 4 * Math.PI) * 3.6;
      f.paint(ellipse(x, by - 2, 7.2, r, -.08), M, { round: 4, gloss: 1, shadow: 2 });
    }
    // Pincers and head.
    const reach = clip === 'atk' ? Math.sin(t * Math.PI) * 5 : Math.sin(a) * 1.2;
    for (const [sc, off, m] of [[.84, -5, m2], [1, 3, M]]) {
      const bx = 20, s0 = [bx, by + off * .5], el = [bx + 11 * sc + reach, by - 6 * sc + off], w0 = [bx + 19 * sc + reach, by - 11 * sc + off];
      f.paint(capsule(s0[0], s0[1], el[0], el[1], 3, 2.8), m, { shadow: 1 }); f.paint(capsule(el[0], el[1], w0[0], w0[1], 2.8, 3.4), m, { shadow: 1 });
      f.paint(spline([[w0[0] - 2, w0[1] + 3], [w0[0] + 3, w0[1] - 5], [w0[0] + 13 * sc, w0[1] - 6 * sc], [w0[0] + 17 * sc, w0[1] - 1], [w0[0] + 9 * sc, w0[1] - 1], [w0[0] + 14 * sc, w0[1] + 4 * sc], [w0[0] + 6 * sc, w0[1] + 6 * sc]]), m, { round: 3.4, gloss: 1, shadow: 1 });
    }
    f.paint(spline([[14, by - 10], [22, by - 11], [28, by - 6], [28, by], [20, by + 4], [13, by + 3]]), M, { round: 4, gloss: 1, shadow: 2 });
    for (const [x, y] of [[23, by - 7], [26, by - 6]]) { f.dot(x, y, '#fff0a0'); f.glow(x, y, '#ffc81c', 1.1); }
    for (const x of [24, 27]) f.line(x, by + 1, x + 1, by + 4, '#efe6cc');
  },
  wolf(f, clip, t, c) {
    const M = tone(c, { dither: .1, round: 5 }), m2 = tone(c, { exposure: .44, round: 4 }), a = t * TAU;
    const k = clip === 'die' ? easeIn(t) : 0, walk = clip === 'walk', lunge = clip === 'atk' ? timeline(t, [[0, { v: 0 }], [.36, { v: -6 }, easeOut], [.52, { v: 13 }, easeIn], [.74, { v: 12 }], [1, { v: 0 }]]).v : 0;
    const bob = walk ? Math.sin(a * 2) * 1.6 : 0, by = -30 + bob + k * 20, sh = walk ? 8 : 0;
    const legA = (x, ph, m) => {
      const fx = x + Math.cos(a + ph) * (sh + 1), fy = walk ? -Math.max(0, Math.sin(a + ph)) * 6 : 0;
      const j = ik(x, by + 6 - k * 4, fx, fy - 1 - k * -1, 14, 14, ph > 3 ? 1 : -1);
      f.paint(capsule(x, by + 6 - k * 4, j.mid[0], j.mid[1], 4, 2.6), m, { shadow: 1 });
      f.paint(capsule(j.mid[0], j.mid[1], fx, fy - 1, 2.6, 1.8), m, { shadow: 1 });
      f.paint(ellipse(fx + 1.5, fy - 1, 3.2, 1.8), m, { shadow: 1 });
    };
    // A bushy tail streaming behind.
    const tail = cloth(-24, by - 4, 30, 5, { drop: 0, trail: 3.5, sway: 4, phase: t * 2 });
    f.paint(ribbon(tail, [3, 5, 5, 3.4, .4], 3), m2, { shadow: 1 });
    legA(-16, Math.PI, m2); legA(15 + lunge, 0, m2);
    f.paint(spline([[-27, by - 2], [-18, by - 10], [-2, by - 13], [14 + lunge, by - 16], [24 + lunge, by - 10], [22 + lunge, by + 4], [8, by + 8], [-12, by + 9], [-25, by + 7]]), M, { round: 8, shadow: 2, grad: .3 });
    legA(-20, 0, M); legA(11 + lunge, Math.PI, M);
    // A mane of shaggy tufts over the shoulders, the darkest fur on top.
    for (let i = 0; i < 9; i++) {
      const x = -6 + i * 3.4 + lunge * .8, y = by - 11 - Math.sin(i / 8 * Math.PI) * 6, l = 10 + rnd(i, 3) * 6;
      f.paint(ribbon([[x, y], [x - 4, y + l * .5], [x - 8, y + l]], [2.6, 2, .3], 2), m2, { shadow: 1 });
    }
    const hx = 26 + lunge, hy = by - 13;
    f.paint(ribbon([[hx - 7, hy - 5], [hx - 9, hy - 16]], [3.6, .3], 2), m2, { shadow: 1 });
    f.paint(ribbon([[hx - 2, hy - 6], [hx - 2, hy - 18]], [3.6, .3], 2), M, { shadow: 1 });
    const jaw = clip === 'atk' ? Math.sin(t * Math.PI) * 5 : 1;
    f.paint(spline([[hx - 8, hy + 4], [hx + 8, hy + 5 + jaw], [hx + 19, hy + 4 + jaw], [hx + 17, hy + 8 + jaw], [hx + 4, hy + 10 + jaw], [hx - 7, hy + 9]]), m2, { round: 3, shadow: 1 });
    f.paint(spline([[hx - 10, hy + 3], [hx - 9, hy - 5], [hx - 1, hy - 8], [hx + 8, hy - 3], [hx + 21, hy + 1], [hx + 22, hy + 4], [hx + 8, hy + 5], [hx - 3, hy + 8]]), M, { round: 5, shadow: 2 });
    rows(f, ['BB', 'WB'], hx + 2, hy - 3, { B: '#7ae8ff', W: '#ffffff' });
    f.glow(hx + 3, hy - 2, '#3cc8ff', 1.5);
    f.dot(hx + 22, hy + 2, '#0a0810'); f.dot(hx + 21, hy + 2, '#0a0810');
    for (const x of [hx + 8, hx + 12, hx + 16, hx + 19]) { f.line(x, hy + 5, x, hy + 7 + (x % 2), '#efe6cc'); }
  },
};

// ---------------------------------------------------------------- bosses
const BOSS = {
  tidewarden(f, clip, t) {
    const c = '#b84a34', M = tone(c, { gloss: .8, round: 6 }), m2 = tone(c, { exposure: .44, round: 5, gloss: .5 });
    const a = t * TAU * 2, walk = clip === 'walk', k = clip === 'die' ? easeIn(t) : 0;
    const raise = clip === 'atk' ? timeline(t, [[0, { v: 0 }], [.42, { v: -30 }, easeOut], [.56, { v: 26 }, easeIn], [.78, { v: 24 }], [1, { v: 0 }]]).v : Math.sin(a) * 2;
    const by = -46 + (walk ? Math.sin(a * 2) * 1.4 : 0) + k * 32;
    for (let i = 0; i < 5; i++) {
      const x = -48 + i * 22, s = Math.sin(a + i * 1.4) * (walk ? 6 : 0), kn = [x - 8 + s, by + 2], ft = [x - 16 + s * 1.5, -1 - (walk ? Math.max(0, Math.cos(a + i * 1.4)) * 4 : 0)];
      f.paint(capsule(x, by + 22, kn[0], kn[1], 5, 4), m2, { shadow: 1 });
      f.paint(capsule(kn[0], kn[1], ft[0], ft[1], 4, 1.4), m2, { shadow: 1 });
    }
    // Far claw, raised and heavy.
    f.paint(capsule(-44, by + 6, -66, by - 22, 6.6, 6), m2, { shadow: 2 });
    f.paint(spline([[-60, by - 44], [-80, by - 56], [-96, by - 42], [-82, by - 38], [-94, by - 24], [-74, by - 12], [-58, by - 22]]), m2, { round: 7, shadow: 2 });
    // Shell: a broad armoured dome studded with barnacles and old iron.
    f.paint(spline([[-62, by + 10], [-54, by - 22], [-26, by - 42], [12, by - 44], [46, by - 28], [62, by + 6], [46, by + 24], [-40, by + 26]]), M, { round: 14, shadow: 2, grad: .4 });
    for (let i = 0; i < 16; i++) {
      const x = -48 + rnd(i, 3) * 88, y = by - 30 + rnd(i, 5) * 40;
      f.paint(ellipse(x, y, 2.4 + rnd(i, 7) * 2, 2 + rnd(i, 8) * 1.6), BONE, { round: 2, shadow: 1 });
      f.dot(x, y, '#3a3028');
    }
    for (const [x0, x1] of [[-30, -24], [-4, 2], [22, 28]]) f.path(spline([[x0, by - 36], [(x0 + x1) / 2 - 6, by - 8], [x1, by + 22]], false, 4), M.tones[0], true);
    // Kelp hanging from the shell.
    for (let i = 0; i < 7; i++) { const x = -46 + i * 15; f.paint(ribbon(cloth(x, by + 18, 18 + rnd(i, 1) * 10, 3, { sway: 5, phase: t + i * .1 }), [2, 1.4, .3], 3), mat(['#0c2a24', '#1a4a3a', '#2e7052', '#4a9a70'], { round: 2, exposure: .7 }), { shadow: 1 }); }
    // Iron face plate with a burning visor.
    f.paint([[6, by - 14], [52, by - 14], [56, by + 2], [50, by + 14], [10, by + 14], [4, by + 2]], IRON, { round: 5, gloss: 1.1, grad: .4, shadow: 3 });
    for (let i = 0; i < 2; i++) f.line(12, by - 5 + i, 50, by - 3 + i, '#040306', true);
    for (const x of [18, 19, 20, 21, 40, 41, 42, 43]) { const y = by - 5 + (x - 12) * .05; f.dot(x, y, '#fff0a0'); f.glow(x, y, '#ffb01c', 1.3); }
    for (let i = 0; i < 6; i++) f.line(17 + i * 5, by + 6, 16 + i * 5, by + 12, '#050408', true);
    for (const [ex, dir] of [[14, -1], [44, 1]]) f.paint(ribbon([[ex, by - 14], [ex + dir * 3, by - 24], [ex + dir * 8, by - 32]], [3, 2.4, .4], 3), BONE, { shadow: 1 });
    // The near claw, which does the crushing.
    const c0 = [48, by + 6], c1 = [76, by - 18 + raise];
    f.paint(capsule(c0[0], c0[1], c1[0], c1[1], 8, 7), M, { gloss: 1, shadow: 3 });
    f.paint(spline([[c1[0] - 6, c1[1] + 4], [c1[0] + 2, c1[1] - 18], [c1[0] + 28, c1[1] - 24], [c1[0] + 44, c1[1] - 8], [c1[0] + 26, c1[1] - 7], [c1[0] + 40, c1[1] + 6], [c1[0] + 22, c1[1] + 16], [c1[0], c1[1] + 14]]), M, { round: 9, gloss: 1, shadow: 3, grad: .36 });
    for (let i = 0; i < 4; i++) f.dot(c1[0] + 12 + i * 5, c1[1] - 8 + i, '#efe6cc');
  },
  assayer(f, clip, t) {
    const c = '#a87a30', M = tone(c, { gloss: 1, round: 5, exposure: .62 }), m2 = tone(c, { exposure: .42, gloss: .6, round: 4 }), Dk = IRON;
    const p = clipPose(clip, t);
    const { hip, T, neck } = body(p, 50, 50);
    const armN = T(47, 26), armF = T(48, -26);
    // Far arm holds a merchant's scale, chains swinging.
    const fh = T(30, -52);
    f.paint(capsule(armF[0], armF[1], fh[0], fh[1], 7.6, 6.4), m2, { shadow: 2 });
    const pole = [[fh[0], fh[1] - 2], [fh[0] - 2, fh[1] - 34]];
    f.paint(capsule(pole[0][0], pole[0][1], pole[1][0], pole[1][1], 2, 2), GOLDISH(), { shadow: 1 });
    const beamL = [pole[1][0] - 24, pole[1][1] + 3], beamR = [pole[1][0] + 24, pole[1][1] - 3];
    f.paint(capsule(beamL[0], beamL[1], beamR[0], beamR[1], 1.8, 1.8), GOLDISH(), { shadow: 1 });
    const swingS = Math.sin(t * TAU) * 3;
    for (const [b, ph] of [[beamL, 1], [beamR, -1]]) {
      const pan = [b[0] + swingS * ph, b[1] + 26];
      f.line(b[0], b[1], pan[0] - 8, pan[1], '#c8b070'); f.line(b[0], b[1], pan[0] + 8, pan[1], '#c8b070');
      f.paint(spline([[pan[0] - 10, pan[1]], [pan[0] + 10, pan[1]], [pan[0] + 7, pan[1] + 5], [pan[0] - 7, pan[1] + 5]]), GOLDISH(), { round: 2, shadow: 1 });
      if (ph > 0) for (let i = 0; i < 4; i++) { f.dot(pan[0] - 4 + i * 3, pan[1] - 1, '#fff0a0'); f.dot(pan[0] - 3 + i * 2, pan[1] - 2, '#ffd84a'); }
    }
    leg(f, [hip[0] - 7, hip[1]], [p.far[0] * 1.5, p.far[1]], m2, Dk, { thigh: 27, shin: 27, hipR: 10 });
    const nl = leg(f, [hip[0] + 7, hip[1]], [p.near[0] * 1.5, p.near[1]], M, Dk, { thigh: 27, shin: 27, hipR: 11 });
    f.paint(ellipse(nl.knee[0] + 1, nl.knee[1], 8, 7.4), M, { gloss: 1.1, shadow: 2 });
    for (const a of [0, 1.2, 2.4, 3.6, 4.8]) f.dot(nl.knee[0] + 1 + Math.cos(a) * 5, nl.knee[1] + Math.sin(a) * 5, '#fff0a0');
    // A riveted boiler of a body with a furnace burning inside.
    f.paint(spline([T(-6, -20), T(14, -26), T(36, -32), T(50, -22), T(52, 0), T(50, 22), T(36, 32), T(14, 26), T(-6, 20)]), M, { round: 12, gloss: 1.1, grad: .42, shadow: 3 });
    for (const b of [-22, -10, 10, 22]) for (const q of [6, 16, 26, 36, 45]) { const r = T(q, b * (1 - Math.abs(q - 26) * .007)); f.dot(r[0], r[1], M.tones[6]); f.dot(r[0] + 1, r[1] + 1, M.tones[0]); }
    const core = T(25, 0), fl = Math.sin(t * TAU * 3);
    f.paint(ellipse(core[0], core[1], 15, 15), IRON, { round: 4, gloss: 1, shadow: 2 });
    f.paint(ellipse(core[0], core[1], 11.5, 11.5), mat(['#3a0c04', '#8c2408', '#e45c14', '#ffa02c', '#ffe080', '#ffffff'], { round: 9, ambient: .5, exposure: .9 }), { shadow: 0 });
    for (let i = -2; i <= 2; i++) f.line(core[0] + i * 5, core[1] - 11, core[0] + i * 5, core[1] + 11, '#0c0a10', true);
    for (let i = 0; i < 12; i++) f.glow(core[0] + (rnd(i, 3) - .5) * 18, core[1] + (rnd(i, 4) - .5) * 18, '#ff7a1c', 1 + fl * .2);
    // Massive shoulders, a square helm, and a glowing slit.
    f.paint(ellipse(armF[0] - 1, armF[1], 15, 12), m2, { round: 7, gloss: 1, shadow: 3 });
    const hx = neck[0] + 2, hy = neck[1] - 8;
    f.paint([[hx - 16, hy - 8], [hx - 10, hy - 16], [hx + 12, hy - 16], [hx + 18, hy - 8], [hx + 18, hy + 9], [hx + 10, hy + 14], [hx - 10, hy + 14], [hx - 16, hy + 9]], M, { round: 6, gloss: 1.2, grad: .42, shadow: 3 });
    f.paint([[hx - 11, hy - 4], [hx + 15, hy - 3], [hx + 15, hy + 3], [hx - 11, hy + 2]], mat(['#050307', '#0e0a10'], { round: 2 }), { shadow: 0 });
    for (let x = hx - 8; x < hx + 13; x++) { if ((x - hx + 30) % 8 < 5) { f.dot(x, hy, '#c8fff4'); f.glow(x, hy, '#3cd8c8', .9); } }
    for (const d of [-1, 1]) f.paint(ribbon([[hx + d * 12, hy - 14], [hx + d * 21, hy - 22], [hx + d * 20, hy - 34]], [4.4, 3, .3], 3), M, { gloss: 1, shadow: 2 });
    // Near arm: a wrecking fist.
    const slam = p.reach > .2 ? 28 : p.reach < -.2 ? -36 : p.swing * 3;
    const hand = [armN[0] + 18 + Math.max(0, p.reach) * 22, armN[1] + 34 + slam * .7];
    f.paint(ellipse(armN[0] + 1, armN[1], 17, 13.5), M, { round: 8, gloss: 1.2, shadow: 3 });
    const e = ik(armN[0], armN[1], hand[0], hand[1], 25, 25, 1);
    f.paint(capsule(armN[0], armN[1], e.mid[0], e.mid[1], 8.5, 7.5), M, { gloss: 1, shadow: 2 });
    f.paint(capsule(e.mid[0], e.mid[1], hand[0], hand[1], 7.5, 8), M, { gloss: 1, shadow: 2 });
    f.paint(spline([[hand[0] - 13, hand[1] - 8], [hand[0] + 4, hand[1] - 13], [hand[0] + 16, hand[1] - 6], [hand[0] + 17, hand[1] + 9], [hand[0] + 4, hand[1] + 14], [hand[0] - 12, hand[1] + 10]]), IRON, { round: 6, gloss: 1.2, shadow: 3, exposure: .68 });
    for (let i = 0; i < 3; i++) f.line(hand[0] + 4 + i * 4, hand[1] - 9, hand[0] + 4 + i * 4, hand[1] + 11, '#050408', true);
  },
  king(f, clip, t) {
    const p = clipPose(clip, t);
    const { hip, T, neck } = body(p, 50, 44);
    const Robe = mat(['#080410', '#160a22', '#261236', '#3a1c4e', '#52286a', '#6e3a88'], { exposure: .62, ambient: .2, round: 8, dither: .05 });
    const bn = (a, b, r0, r1 = r0) => f.paint(capsule(a[0], a[1], b[0], b[1], r0, r1), BONE, { round: 2.6, shadow: 2 });
    // A dead tree grows out through his back, branches clawing upward.
    const trunk = T(26, -14);
    const Bark = mat(['#0a0606', '#1a1210', '#2c1e18', '#423026', '#5a4436'], { exposure: .62, round: 3, dither: .1 });
    f.paint(ribbon([trunk, [trunk[0] - 14, trunk[1] - 24], [trunk[0] - 8, trunk[1] - 48], [trunk[0] - 22, trunk[1] - 72]], [6, 4.6, 3, .6], 5), Bark, { shadow: 1 });
    f.paint(ribbon([[trunk[0] - 11, trunk[1] - 30], [trunk[0] - 32, trunk[1] - 42], [trunk[0] - 42, trunk[1] - 64]], [3, 2, .4], 4), Bark, { shadow: 1 });
    f.paint(ribbon([[trunk[0] - 8, trunk[1] - 44], [trunk[0] + 12, trunk[1] - 58], [trunk[0] + 10, trunk[1] - 76]], [2.6, 1.8, .4], 4), Bark, { shadow: 1 });
    for (let i = 0; i < 12; i++) {
      const x = trunk[0] - 42 + rnd(i, 3) * 56, y = trunk[1] - 80 + rnd(i, 5) * 22;
      f.paint(ellipse(x, y, 3 + rnd(i, 7) * 3, 2.4 + rnd(i, 8) * 2), mat(['#14240a', '#2a4410', '#4a7018', '#74a02c', '#a8d04a'], { round: 3, exposure: .7, dither: .1 }), { shadow: 1 });
    }
    // Royal mantle, torn and heavy.
    const cA = cloth(neck[0] - 6, neck[1] + 6, 74, 7, { trail: .3, sway: 3, phase: t }), cB = cloth(neck[0] - 30, neck[1] + 8, 72, 7, { trail: .72, sway: 4, phase: t + .2 });
    f.paint(tatteredCloth(cA, cB, 41, 16, 8), Robe, { round: 12, shadow: 0, grad: .4 });
    const fk = ik(hip[0] - 4, hip[1], p.far[0] * 1.2, p.far[1] - 3, 25, 25, -1), nk = ik(hip[0] + 4, hip[1], p.near[0] * 1.2, p.near[1] - 3, 25, 25, -1);
    bn([hip[0] - 4, hip[1]], fk.mid, 2.8); bn(fk.mid, fk.end, 2.4); f.paint(ellipse(fk.end[0] + 3, fk.end[1] + 1, 6, 2.6), BONE, { shadow: 1 });
    bn([hip[0] + 4, hip[1]], nk.mid, 3); bn(nk.mid, nk.end, 2.6); f.paint(ellipse(nk.mid[0], nk.mid[1], 3.6, 3.6), BONE, { shadow: 1 }); f.paint(ellipse(nk.end[0] + 3, nk.end[1] + 1, 6.4, 2.8), BONE, { shadow: 1 });
    f.paint(tatteredCloth(spline([T(2, -14), [hip[0] - 15, hip[1] + 26]], false, 2), spline([T(2, 14), [hip[0] + 15, hip[1] + 28]], false, 2), 19, 9, 6), Robe, { round: 7, shadow: 2 });
    f.path(spline([T(2, 0), [hip[0], hip[1] + 26]], false, 2), '#e4b24e', true);
    // Open ribs with a sickly light inside.
    f.paint(spline([T(4, -12), T(16, -16), T(36, -19), T(44, -12), T(44, 12), T(36, 19), T(16, 16), T(4, 12)]), mat(['#06040a', '#0e0814', '#180e20'], { round: 6 }), { shadow: 2 });
    const heart = T(26, 0);
    for (let i = 0; i < 12; i++) f.glow(heart[0] + (rnd(i, 1) - .5) * 14, heart[1] + (rnd(i, 2) - .5) * 14, '#a4ff4a', .8);
    f.paint(ellipse(heart[0], heart[1], 3.6, 4.4), mat(['#28500c', '#58a018', '#a4ff4a', '#f0ffc0'], { round: 3, ambient: .6, exposure: .9 }), { shadow: 0 });
    bn(T(4, 0), T(42, 0), 1.8);
    for (let i = 0; i < 6; i++) { const y = 15 + i * 4.4, w = 15 - Math.abs(i - 1.6) * 1.2; f.paint(ribbon([T(y, -w), T(y + 2, 0), T(y, w)], [1.3, 1.4, 1.3], 3), BONE, { round: 1.3, shadow: 1 }); }
    f.paint(spline([T(42, -19), T(46, -9), T(47, 9), T(42, 19), T(38, 12), T(39, 0), T(38, -12)]), Robe, { round: 4, shadow: 2 });
    f.path([T(44, -13), T(40, 0), T(44, 13)], '#e4b24e', true);
    // Skull and a tall crown.
    const hx = neck[0] + 3, hy = neck[1] - 11;
    f.paint(spline([[hx - 13, hy - 1], [hx - 7, hy - 12], [hx + 5, hy - 13], [hx + 14, hy - 5], [hx + 14, hy + 4], [hx + 8, hy + 7], [hx + 7, hy + 14], [hx - 4, hy + 14], [hx - 5, hy + 7], [hx - 12, hy + 4]]), BONE, { round: 5, shadow: 2 });
    rows(f, ['.KKKK...KKKK', 'KKKKK...KKKK', 'KKKRK...KRKK', 'KKKKK...KKKK', '.KKK.....KK.'], hx - 6, hy - 5, { K: '#0a0810', R: '#c8ff6a' });
    f.glow(hx - 3, hy - 3, '#8cff30', 1.8); f.glow(hx + 4, hy - 3, '#8cff30', 1.8);
    f.dot(hx + 1, hy + 2, '#0a0810'); f.dot(hx + 2, hy + 3, '#0a0810'); f.dot(hx, hy + 3, '#0a0810');
    for (let i = 0; i < 6; i++) f.line(hx - 3 + i * 2, hy + 8, hx - 3 + i * 2, hy + 13, '#141016', true);
    const G = GOLDISH();
    f.paint([[hx - 13, hy - 6], [hx - 15, hy - 24], [hx - 7, hy - 15], [hx - 2, hy - 30], [hx + 4, hy - 15], [hx + 10, hy - 30], [hx + 12, hy - 15], [hx + 17, hy - 24], [hx + 15, hy - 6], [hx + 1, hy - 9]], G, { round: 3.4, gloss: 1.1, shadow: 2 });
    for (const [x, y, col] of [[hx - 2, hy - 15, '#ff4a6a'], [hx + 7, hy - 14, '#4ac8ff'], [hx - 9, hy - 12, '#a4ff4a']]) { f.paint(ellipse(x, y, 2.2, 2.2), mat([toHex(rgb(col).map(v => v * .4)), col, '#ffffff'], { gloss: 1, round: 2 }), { shadow: 1 }); f.glow(x, y, col, .6); }
    // A greatsword in a bone arm.
    const shN = T(38, 18);
    f.paint(ellipse(shN[0], shN[1], 11, 8.6, -.2), G, { round: 5, gloss: 1, shadow: 2 });
    for (const [dx, a, l] of [[-6, -2.1, 11], [1, -1.6, 14], [7, -1.1, 10]]) f.paint(ribbon([[shN[0] + dx, shN[1] - 6], [shN[0] + dx + Math.cos(a) * l, shN[1] - 6 + Math.sin(a) * l]], [2.6, .2], 2), G, { shadow: 1 });
    const hand = p.reach > .2 ? [T(34, 24)[0] + 24 * p.reach, T(34, 24)[1] + 6] : p.reach < -.2 ? [T(50, 14)[0], T(50, 14)[1] - 24] : [T(16, 24)[0] + 10, T(16, 24)[1] + p.swing * 2];
    const ang = p.reach > .2 ? .2 : p.reach < -.2 ? -2.3 : -.28 + p.swing * .05;
    const R = pts => rotate(pts, ang, hand[0], hand[1]);
    f.paint(R([[-11, -2], [8, -2], [8, 2], [-11, 2]]), HIDE, { round: 1.6, shadow: 1 });
    f.paint(R([[8, -11], [12, -11], [12, 11], [8, 11]]), G, { round: 2, shadow: 1 });
    f.paint(R([[12, -5], [66, -5], [80, 0], [66, 5], [12, 5]]), mat(['#1e2838', '#34465a', '#54708a', '#82a4bc', '#b8d0e0', '#e8f4fa'], { gloss: .9, exposure: .72, round: 3 }), { shadow: 1, grad: .4 });
    { const a = R([[14, 0], [64, 0]]); f.line(a[0][0], a[0][1], a[1][0], a[1][1], '#12202c'); for (let i = 0; i < 40; i += 3) { const q = R([[16 + i, 0]])[0]; f.glow(q[0], q[1], '#8cff30', .25); } }
    const el = ik(shN[0], shN[1], hand[0], hand[1], 22, 22, 1);
    bn(shN, el.mid, 2.6); bn(el.mid, hand, 2.2);
    f.paint(ellipse(hand[0], hand[1], 3.8, 3.4), BONE, { shadow: 1 });
  },
  lensmaker(f, clip, t) {
    const p = clipPose(clip, t), Robe = mat(['#04060e', '#0a1020', '#121c34', '#1e2c4c', '#2c4068', '#3e5a88', '#5e80ac'], { exposure: .62, ambient: .2, round: 9, dither: .04 });
    const sway = Math.sin(t * TAU) * 3, cast = clip === 'atk' ? Math.sin(t * Math.PI) : 0, k = clip === 'die' ? easeIn(t) : 0;
    const by = k * 34, lean = p.lean * .5 + k * -.3;
    // A floor-length robe, tattered hem, with gold trim up the centre.
    const hem = [[-30 + sway, 0 + by * .1], [30 + sway, 0 + by * .1]];
    f.paint(tatteredCloth(spline([[-14 + lean * 20, -94 + by], [-24, -50 + by * .6], hem[0]], false, 4), spline([[14 + lean * 20, -94 + by], [24, -50 + by * .6], hem[1]], false, 4), 67, 10, 10), Robe, { round: 14, grad: .4, shadow: 0, fn: (x) => Math.sin(x * .55) * .09 });
    f.path(spline([[lean * 20, -92 + by], [sway * .3, -50 + by * .6], [sway, -2]], false, 4), '#d8a848', true);
    f.path(spline([[3 + lean * 20, -92 + by], [3 + sway * .3, -50 + by * .6], [3 + sway, -2]], false, 4), '#6e4c18', true);
    for (let i = 0; i < 7; i++) { const y = -82 + i * 11 + by * (1 - i / 7), x = lean * 20 * (1 - i / 7) + sway * (i / 7) + 1; f.line(x - 3, y, x + 3, y, '#d8a848', true); f.dot(x, y - 2, '#ffd877'); f.glow(x, y - 2, '#7ae8ff', .4); }
    // Layered shoulders and a deep, empty hood with two cold eyes.
    f.paint(spline([[-24 + lean * 20, -80 + by], [-18 + lean * 20, -96 + by], [18 + lean * 20, -96 + by], [24 + lean * 20, -80 + by], [12 + lean * 20, -68 + by], [-12 + lean * 20, -68 + by]]), Robe, { round: 7, shadow: 3, grad: .4 });
    const hx = 3 + lean * 24, hy = -108 + by;
    f.paint(spline([[hx - 19, hy + 16], [hx - 18, hy - 2], [hx - 8, hy - 14], [hx + 6, hy - 17], [hx + 16, hy - 8], [hx + 19, hy + 8], [hx + 15, hy + 18], [hx - 8, hy + 22]]), Robe, { round: 8, shadow: 3, grad: .46 });
    f.paint(spline([[hx - 5, hy - 7], [hx + 8, hy - 9], [hx + 15, hy - 2], [hx + 15, hy + 9], [hx + 7, hy + 16], [hx - 4, hy + 13], [hx - 8, hy + 3]]), mat(['#020208', '#04040c'], { round: 3 }), { shadow: 0 });
    rows(f, ['CCC...CCC', 'CWC...CWC'], hx - 1, hy + 1, { C: '#7ae8ff', W: '#ffffff' });
    f.glow(hx + 1, hy + 2, '#3cc8ff', 1.6); f.glow(hx + 7, hy + 2, '#3cc8ff', 1.6);
    // Sleeve reaching to a huge brass-ringed lens that hangs in the air and pulses.
    const lx = 62 + cast * 14 + sway * .5, ly = -74 + cast * -6 + Math.sin(t * TAU * 2) * 2 + by * .6;
    const sh = [14 + lean * 20, -84 + by], e = ik(sh[0], sh[1], lx - 24, ly + 6, 22, 22, 1);
    f.paint(capsule(sh[0], sh[1], e.mid[0], e.mid[1], 7, 7.4), Robe, { round: 5, shadow: 2 });
    f.paint([[e.mid[0] - 6, e.mid[1] - 6], [lx - 22, ly], [lx - 22, ly + 12], [e.mid[0] - 2, e.mid[1] + 15], [e.mid[0] - 9, e.mid[1] + 8]], Robe, { round: 5, shadow: 2 });
    f.paint(ellipse(lx - 22, ly + 6, 3.4, 3.4), PALEISH(), { shadow: 1 });
    f.paint(ellipse(lx, ly, 25, 25), GOLDISH(), { round: 5, gloss: 1.1, shadow: 3 });
    f.paint(ellipse(lx, ly, 20, 20), mat(['#28607c', '#4a90ac', '#7ac4dc', '#b0e8f4', '#e4fbff', '#ffffff'], { round: 16, ambient: .4, exposure: .72, gloss: .8 }), { shadow: 2 });
    f.path(spline([[lx - 11, ly - 3], [lx - 6, ly - 11], [lx + 2, ly - 14]], false, 3), '#ffffff', true);
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; f.glow(lx + Math.cos(a) * 16, ly + Math.sin(a) * 16, '#7ae8ff', .35 + cast * .4); }
    if (cast > .3) { for (let i = 0; i < 50; i++) { const x = lx + 20 + i * 1.6; f.glow(x, ly + Math.sin(i * .6) * 2, '#c8fbff', cast * .9); } }
    f.paint(capsule(lx - 22, ly + 22, lx - 8, ly + 40, 1, 1), GOLDISH(), { shadow: 1 });
  },
  // The last boss: a great crimson dragon, built back to front so wings, neck and jaw all move.
  dragon(f, clip, t) {
    const a = t * TAU, walk = clip === 'walk', die = clip === 'die' ? easeIn(t) : 0;
    const act = clip === 'atk' ? timeline(t, [
      [0, { rear: 0, lunge: 0, open: .12, flap: 0 }],
      [.42, { rear: 1, lunge: 0, open: .4, flap: 1 }, easeOut],
      [.56, { rear: 0, lunge: 1, open: 1, flap: -.8 }, easeIn],
      [.82, { rear: 0, lunge: .86, open: 1, flap: -.5 }],
      [1, { rear: 0, lunge: 0, open: .12, flap: 0 }],
    ]) : { rear: 0, lunge: 0, open: walk ? .1 + Math.max(0, Math.sin(a)) * .08 : .3 * (1 - die), flap: 0 };
    const { rear, lunge, open, flap } = act, bob = walk ? Math.sin(a * 2) * 1.6 : 0;
    const add = (p, q) => [p[0] + q[0], p[1] + q[1]], mixP = (p, q, k) => [lerp(p[0], q[0], k), lerp(p[1], q[1], k)];
    const hip = [-46, -66 + bob + die * 42], chest = [22 - rear * 8 + lunge * 8, -76 - rear * 7 + lunge * 7 + bob * .7 + die * 50];
    // Rows of overlapping scales: each one catches the light along its lower edge.
    const scaly = (x, y) => { const row = Math.floor((y + 400) / 5), u = ((x + 600 + (row % 2) * 3) % 6) - 3, v = ((y + 400) % 5) / 5; return v * .1 - .055 - Math.abs(u) * .012; };
    const SCALE = mat(['#0a0306', '#180609', '#2a0a0e', '#420e12', '#621616', '#88221a', '#b83c22'], { ambient: .2, gloss: .45, round: 6, exposure: .62 });
    const SCALE_FAR = mat(['#050204', '#0e0508', '#1c080c', '#2c0c10', '#401014', '#581814'], { ambient: .2, round: 5, exposure: .62 });
    const SKIN = mat(['#10030a', '#22070f', '#380c14', '#581418', '#80201c', '#aa3820'], { ambient: .3, round: 9, exposure: .62, dither: .05 });
    const SKIN_FAR = mat(['#080206', '#10050a', '#1c080e', '#2c0c12', '#401216'], { ambient: .3, round: 9, exposure: .6 });
    const PLATE = mat(['#3a2008', '#6e4210', '#a86c1c', '#d89a30', '#f4c860', '#ffe79a'], { ambient: .32, round: 4, gloss: .4, exposure: .72 });
    const HORN = mat(['#1a1410', '#3a2e22', '#6a5a44', '#a08c6c', '#d8c8a4', '#fff4d8'], { gloss: .7, ambient: .24, round: 2.5, exposure: .72 });

    // A wing: an arm to the wrist, then long fingers with scalloped skin stretched between them.
    const wing = (root, lift, sx, sy, skin, bone, seed) => {
      const P = pts => rotate(pts.map(([x, y]) => [x * sx * .88, y * sy * .88]), lift * Math.sign(-sx) * -1, root[0], root[1]);
      const [elbow, wrist, f1, f2, f3, f4, base] = P([[-30, -28], [-52, -58], [-124, -60], [-146, -20], [-126, 20], [-84, 34], [-20, 20]]);
      const sag = (p, q, k) => { const m = mixP(p, q, .5); return mixP(m, wrist, k); };
      f.paint([wrist, f1, sag(f1, f2, .18), f2, sag(f2, f3, .2), f3, sag(f3, f4, .22), f4, sag(f4, base, .16), base, root, elbow], skin, { round: 9, shadow: 0, grad: .34, fn: (x, y) => Math.sin(x * .3 + y * .12 + seed) * .07 });
      for (const tip of [f1, f2, f3, f4]) f.paint(ribbon([wrist, mixP(wrist, tip, .55), tip], [2.2, 1.5, .3], 4), bone, { shadow: 1, round: 1.6 });
      f.paint(ribbon([root, elbow, wrist], [6.5, 4.6, 3.2], 4), bone, { shadow: 1, round: 3 });
      const thumb = add(wrist, [sx < 0 ? 1 : -1, -9 * sy]);
      f.paint(ribbon([wrist, thumb], [2.2, .3], 2), HORN, { shadow: 1, round: 1.2 });
    };
    const wave = walk ? Math.sin(a) * .055 : 0, fold = die * .62;
    // The far wing rises behind the neck, on the other side of the body.
    wing(add(chest, [10, -14]), .08 + wave + flap * .12 - fold, -.78 * (1 - die * .3), .98 * (1 - die * .3), SKIN_FAR, SCALE_FAR, 1);

    // Tail: thick at the hip, waving, and ending in a barbed spade.
    const tail = [];
    for (let i = 0; i <= 6; i++) { const u = i / 6; tail.push([hip[0] - 8 - u * 100, Math.min(-3, hip[1] + 8 + u * 52 - u * u * 18 + Math.sin(a - u * 3) * (2 + u * 7) * (1 - die))]); }
    const tip = tail[6];
    f.paint([add(tip, [6, -3]), add(tip, [-12, -9]), add(tip, [-8, 0]), add(tip, [-14, 8]), add(tip, [6, 3])], SCALE, { round: 2, shadow: 1 });
    f.paint(ribbon(tail, [17, 15, 12, 9, 6, 3.8, 1.6], 4), SCALE, { shadow: 1, round: 6, fn: scaly });
    for (let i = 1; i < 6; i++) { const p = tail[i], w = 11 - i * 1.4; f.paint([add(p, [-w * .6, -w * .5]), add(p, [-w * .9, -w * 1.6]), add(p, [w * .5, -w * .55])], SCALE, { shadow: 0, round: 1 }); }

    // Far legs in shadow, stepping opposite the near pair.
    const g = walk ? gait(t, 18, 9, 1) : { near: [lunge * 8 - rear * 4, 0, 0], far: [lunge * 4 - rear * 2, 0, 0] };
    const limb = (shoulder, foot, up, low, bend, r0, m, claws) => {
      const ankle = [foot[0] - 7, foot[1] - 13 * (1 - die * .5)], j = ik(shoulder[0], shoulder[1], ankle[0], ankle[1], up, low, bend);
      const dx = j.mid[0] - shoulder[0], dy = j.mid[1] - shoulder[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
      f.paint(spline([[foot[0] - 8, foot[1] - 6], [foot[0] + 4, foot[1] - 9], [foot[0] + 16, foot[1] - 3], [foot[0] + 15, foot[1]], [foot[0] - 8, foot[1]]]), m, { round: 3 });
      f.paint(ribbon([j.mid, mixP(j.mid, j.end, .55), j.end, [foot[0] + 1, foot[1] - 5]], [r0 * .5, r0 * .4, r0 * .32, r0 * .36], 3), m, { round: 4, fn: scaly });
      // One tapered muscle from the body down to the joint, wide at the top and narrow at the knee.
      const w = r0 * 1.05;
      f.paint(spline([[shoulder[0] + nx * w - dx / len * w * .5, shoulder[1] + ny * w - dy / len * w * .5], [shoulder[0] + nx * w * .95 + dx * .45, shoulder[1] + ny * w * .95 + dy * .45], [j.mid[0] + nx * r0 * .42, j.mid[1] + ny * r0 * .42], [j.mid[0] + dx / len * r0 * .34, j.mid[1] + dy / len * r0 * .34], [j.mid[0] - nx * r0 * .42, j.mid[1] - ny * r0 * .42], [shoulder[0] - nx * w * .9 + dx * .45, shoulder[1] - ny * w * .9 + dy * .45], [shoulder[0] - nx * w - dx / len * w * .5, shoulder[1] - ny * w - dy / len * w * .5]], true, 4), m, { round: 5, grad: .3, shadow: 1, fn: scaly });
      if (claws) for (const dx of [4, 10, 16]) f.paint([[foot[0] + dx - 2, foot[1] - 2], [foot[0] + dx + 5, foot[1]], [foot[0] + dx - 2, foot[1]]], HORN, { shadow: 0, round: 1 });
      return j;
    };
    limb(add(hip, [16, 6]), [-14 + g.far[0], g.far[1]], 30, 26, -1, 11, SCALE_FAR, false);
    limb(add(chest, [14, 12]), [56 + g.far[0], g.far[1]], 30, 28, 1, 9, SCALE_FAR, false);

    // Neck first, so the body overlaps its base, then the long scaled body and its gold belly.
    const mid = mixP(hip, chest, .5), root = add(chest, [8, -8]);
    const rest = [86 + Math.sin(a) * 2, -122 + Math.sin(a + 1) * 2.4 + bob], reared = [40, -134], struck = [96, -68], fallen = [112, -14];
    let head = mixP(rest, reared, rear); head = mixP(head, struck, lunge); head = mixP(head, fallen, die);
    const up = (1 - lunge) * (1 - die), n1 = add(mixP(root, head, .36), [-14 * up, -22 * up - 2]), n2 = add(mixP(root, head, .74), [-10 * up, -8 * up - 3]);
    const neck = [root, n1, n2, add(head, [-12, 2])], tilt = lerp(lerp(lerp(.2, -.42, rear), .1, lunge), .32, die);
    const spines = (pts, count, size, m) => { const path = spline(pts, false, 6); for (let i = 1; i <= count; i++) { const k = i / (count + 1), n = path.length - 1, q = path[Math.floor(k * n)], r = path[Math.min(n, Math.floor(k * n) + 2)], ang = Math.atan2(r[1] - q[1], r[0] - q[0]), nx = Math.sin(ang), ny = -Math.cos(ang), s = size * (1 - Math.abs(k - .5) * .7); f.paint([[q[0] - Math.cos(ang) * s * .7, q[1] - Math.sin(ang) * s * .7], [q[0] + nx * s * 1.5, q[1] + ny * s * 1.5], [q[0] + Math.cos(ang) * s * .7, q[1] + Math.sin(ang) * s * .7]], m, { shadow: 0, round: 1 }); } };
    spines(neck.map(p => add(p, [-3, -6])), 7, 5.4, SCALE_FAR);
    f.paint(ribbon(neck, [18, 14.5, 11.5, 10], 5), SCALE, { round: 7, grad: .3, fn: scaly });
    // Gold plates run from the chest up the front of the throat and taper away under the jaw.
    const throat = [add(chest, [15, 8]), add(n1, [9, 10]), add(n2, [5, 9]), add(head, [-8, 9])];
    f.paint(ribbon(throat, [5, 6.4, 4.6, .6], 5), PLATE, { shadow: 1, round: 3 });
    const thr = spline(throat, false, 3);
    for (let i = 1; i < thr.length - 1; i += 1) { const q = thr[i]; f.line(q[0] - 7, q[1] - 1, q[0] + 7, q[1] + 1, '#5a3408', true); }
    spines([add(hip, [-8, -22]), add(mid, [0, -28]), add(chest, [-4, -27])], 7, 7, SCALE_FAR);
    // One continuous body, deep at the chest, drawn in a single piece so it has no seams.
    f.paint(spline([add(hip, [-30, -6]), add(hip, [-14, -22]), add(mid, [0, -25]), add(chest, [-6, -28]), add(chest, [16, -22]), add(chest, [26, -4]), add(chest, [20, 16]), add(chest, [0, 26]), add(mid, [0, 24]), add(hip, [8, 22]), add(hip, [-18, 22]), add(hip, [-32, 8])], true, 5), SCALE, { round: 11, grad: .36, shadow: 1, fn: scaly });
    const belly = [add(chest, [15, 10]), add(chest, [-4, 22]), add(mid, [0, 23]), add(hip, [6, 20]), add(hip, [-18, 22])];
    f.paint(ribbon(belly, [5, 8, 9, 7, .6], 4), PLATE, { shadow: 1, round: 4 });
    const bp = spline(belly, false, 3);
    for (let i = 1; i < bp.length; i += 1) f.line(bp[i][0], bp[i][1] - 8, bp[i][0] - 1, bp[i][1] + 8, '#5a3408', true);

    // Near legs: a heavy haunch behind, a shoulder in front.
    limb(add(hip, [-4, 2]), [-40 + g.near[0], g.near[1]], 36, 30, -1, 17, SCALE, true);
    limb(add(chest, [-2, 6]), [28 + g.near[0], g.near[1]], 36, 30, 1, 12, SCALE, true);

    // The head: horns behind, lower jaw on its hinge, teeth and throat fire, then skull over it.
    const H = pts => rotate(pts, tilt, head[0], head[1]);
    f.paint(H(ribbon([[-6, -11], [-20, -22], [-36, -26], [-50, -20]], [3.8, 3, 1.8, .3], 4)), SCALE_FAR, { shadow: 1, round: 2 });
    const hinge = [-10, 6], jawA = open * .52, J = pts => rotate(rotate(pts.map(([x, y]) => [x - hinge[0], y - hinge[1]]), jawA, hinge[0], hinge[1]), tilt, head[0], head[1]);
    if (open > .15) {
      f.paint(H([[-8, 4], [30, 2], [36, 9 + open * 12], [6, 13 + open * 8]]), mat(['#140206', '#2c0408', '#4e0a0c', '#7a1410'], { ambient: .35, round: 5, exposure: .8 }), { shadow: 0, edge: 0 });
      f.paint(H(ribbon([[0, 9], [14, 8 + open * 7], [28, 7 + open * 10]], [3, 2.4, .6], 3)), mat(['#3a0810', '#7a1a20', '#b83a3a'], { ambient: .4, round: 2 }), { shadow: 0, edge: 0 });
      if (open > .5) { const q = H([[10, 7]])[0]; f.glow(q[0], q[1], '#ff7a1c', 2.6 * open); f.glow(q[0] + 6, q[1] + 2, '#ffd468', 1.8 * open); }
    }
    f.paint(J([[-12, 6], [6, 8], [24, 8], [38, 7], [43, 10], [34, 15], [12, 16], [-6, 15]]), SCALE, { shadow: 1, round: 3, fn: scaly });
    for (const x of [14, 22, 30, 37]) f.paint(J([[x - 2, 8], [x, 2.5], [x + 2, 8]]), HORN, { shadow: 0, round: 1 });
    f.paint(H(spline([[-21, 2], [-17, -9], [-5, -14], [8, -13], [15, -10], [27, -7], [37, -9], [44, -6], [46, 0], [42, 5], [27, 5.4], [10, 6.4], [-5, 9.4], [-17, 9]], true, 3)), SCALE, { round: 6, grad: .36, shadow: 2, fn: scaly });
    for (const x of [12, 19, 26, 33, 40]) f.paint(H([[x - 2, 5], [x, x % 2 ? 11 : 9.4], [x + 2, 5]]), HORN, { shadow: 0, round: 1 });
    f.paint(H(spline([[0, -14], [12, -16.5], [21, -9.4], [9, -9]], true, 3)), SCALE_FAR, { shadow: 1, round: 2 });
    f.paint(H(spline([[36, -9], [41, -11], [45, -7], [41, -6]], true, 3)), SCALE_FAR, { shadow: 1, round: 1.4 });
    for (const [p, q, w] of [[[-14, 4], [-30, 8], 3.4], [[-12, 8], [-25, 18], 3], [[-2, 10], [-9, 22], 2.4]]) f.paint(H(ribbon([p, q], [w, .3], 3)), SCALE_FAR, { shadow: 1, round: 1.4 });
    f.paint(H(ribbon([[-11, -9], [-28, -18], [-48, -19], [-66, -8]], [5.2, 4.2, 2.4, .4], 4)), HORN, { shadow: 1, round: 2.4 });
    f.paint(H(ribbon([[-2, -13], [-10, -26], [-24, -33]], [3, 2, .3], 4)), HORN, { shadow: 1, round: 1.6 });
    for (const [x, y] of [[-30, -13.6], [-44, -13]]) { const [q] = H([[x, y]]); f.dot(q[0], q[1], '#5a4c38'); }
    // A burning eye that goes out when it dies, and embers at the nostril.
    if (die < .75) {
      f.paint(H([[5.4, -10], [14.4, -7.4], [7.4, -5.4]]), mat(['#ff7a14', '#ffd24a', '#fff8c0'], { ambient: 1, round: 1 }), { shadow: 0, edge: 0 });
      const [q] = H([[9.6, -7.8]]);
      f.dot(q[0], q[1], '#1a0404'); f.dot(q[0], q[1] + 1, '#1a0404');
      f.glow(q[0], q[1], '#ff8a1c', 1.8 * (1 - die));
    }
    const [nos] = H([[42, -3.6]]);
    f.dot(nos[0], nos[1], '#ff9a2c'); f.glow(nos[0], nos[1], '#ff6a1c', .9 + open);
    // Heat building in the chest as it draws breath.
    if (rear > .1 || lunge > .1) for (const [x, y] of [[16, 8], [8, 14], [24, 2]]) { const q = add(chest, [x, y]); f.glow(q[0], q[1], '#ff6a1c', 1.6 * Math.max(rear, lunge)); }

    // The near wing folds down over the body when it falls.
    wing(add(chest, [-10, -20]), .1 + wave * 1.3 + flap * .14 - fold, 1 - die * .34, 1 - die * .34, SKIN, SCALE, 3);
    // Embers rising off it, as it walks and as it burns.
    for (let i = 0; i < 10; i++) { const q = (t * 2 + rnd(i, 4)) % 1, x = -60 + rnd(i, 5) * 150, y = -30 - q * 110 - rnd(i, 6) * 24; f.dot(x, y, q < .5 ? '#ffd46a' : '#ff7a2c'); f.glow(x, y, '#ff5a14', .3); }
  },
};
function GOLDISH() { return mat(['#241206', '#4a2a0c', '#7c4c14', '#b37a22', '#dcaa3a', '#f6d868', '#fff4b8'], { gloss: .8, ambient: .24, round: 2, exposure: .68 }); }
function PALEISH() { return mat(['#3e3a4c', '#68637a', '#9a94aa', '#c9c4d4', '#ece8f0'], { ambient: .36, round: 3, exposure: .7 }); }
void shift; void lerp;

export const MON_CLIPS = { walk: 10, atk: 9, die: 7 };
export const BOSS_CLIPS = { walk: 10, atk: 11, die: 9 };
export const BOSS_KEYS = ['tidewarden', 'assayer', 'king', 'lensmaker', 'dragon'];
export const SHAPES = Object.keys(MON);
export function renderMonsterFrame(shape, color, clip, i) {
  const f = new Frame(MON_FRAME.w, MON_FRAME.h, MON_FRAME.ox, MON_FRAME.oy), n = MON_CLIPS[clip];
  MON[shape](f, clip, clip === 'walk' ? i / n : i / (n - 1), color);
  f.finish({ rim: '#9a7cc8', rimK: .28 });
  return f;
}
export function renderBossFrame(key, clip, i) {
  const f = new Frame(BOSS_FRAME.w, BOSS_FRAME.h, BOSS_FRAME.ox, BOSS_FRAME.oy), n = BOSS_CLIPS[clip];
  BOSS[key](f, clip, clip === 'walk' ? i / n : i / (n - 1));
  f.finish({ rim: '#c89cff', rimK: .3 });
  return f;
}
