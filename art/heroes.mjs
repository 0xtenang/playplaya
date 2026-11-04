// The four heroes, seen from a three-quarter front view and facing right. That means the near
// shoulder sits toward the back of the chest and the far shoulder toward the front, so arms
// reach naturally across the body. Each frame is built back to front from animated layers.
import { Frame, mat, spline, ellipse, capsule, ribbon, rotate, shift } from './raster.mjs';
import { ik, timeline, gait, cloth, lerp, TAU, rnd, easeOut, easeIn } from './rig.mjs';

export const FRAME = { w: 208, h: 150, ox: 96, oy: 136 };

const STEEL = mat(['#07060c', '#0f0e17', '#1a1a26', '#272836', '#383a4c', '#515468', '#7b7f98', '#b6bace', '#eceef8'], { gloss: .95, ambient: .17, round: 3.5, exposure: .52 });
const STEEL_LT = mat(['#0f1019', '#1d1f2c', '#2f3142', '#464a5e', '#646880', '#8c91a8', '#bcc0d2', '#eef0f8'], { gloss: .95, ambient: .2, round: 3, exposure: .6 });
const STEEL_FAR = mat(['#050408', '#0d0c14', '#191825', '#29293a', '#3f4156', '#5a5c74'], { gloss: .6, round: 3 });
const BLADE = mat(['#20212e', '#3a3c4e', '#585b70', '#7e8298', '#a8acc0', '#cfd2e0', '#f2f4fb'], { gloss: .8, ambient: .3, round: 3, exposure: .72 });
const GOLD = mat(['#241206', '#4a2a0c', '#7c4c14', '#b37a22', '#dcaa3a', '#f6d868', '#fff4b8'], { gloss: .8, ambient: .24, round: 2 });
const CRIMSON = mat(['#10020a', '#220511', '#3c0918', '#5e0f22', '#86182e', '#b02a3e', '#d24a52'], { ambient: .2, round: 6, dither: .05, exposure: .62 });
const CRIMSON_IN = mat(['#080106', '#14030a', '#240610', '#3a0a18'], { ambient: .3, round: 6, exposure: .6 });
const LEATHER = mat(['#120a08', '#26160e', '#402616', '#5e3a20', '#80522e', '#a67044'], { ambient: .26, round: 3 });
// Skin in warm tones, shadows drifting to red and highlights to peach, the way it reads in life.
const SKIN = mat(['#3e1c1c', '#6e3428', '#a4604a', '#cf8f6e', '#ecba96', '#fbd9bc'], { ambient: .42, round: 4, exposure: .82 });
const SKIN_PALE = mat(['#4a2c30', '#7e5048', '#b48a78', '#dcb8a2', '#f4d8c6', '#fff0e2'], { ambient: .46, round: 4, exposure: .84 });
const SKIN_FAR = mat(['#2a1416', '#4e2820', '#7c4a3a', '#a4705a'], { ambient: .4, round: 3, exposure: .74 });

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
// The bones of a pose: a pelvis, a spine that bends, shoulders, and a neck.
function joints(p) {
  // Poses are written a little low, so standing legs keep only a slight, natural bend.
  const hip = [p.hip[0], p.hip[1] - 3], lean = p.lean, tilt = lean * .55;
  const up = a => [Math.sin(a), -Math.cos(a)];
  const uP = up(tilt), uC = up(lean), waist = [hip[0] + uP[0] * 9, hip[1] + uP[1] * 9];
  // T walks up the spine, then out across the body: b above zero is toward the front.
  const T = (a, b) => {
    const u = a <= 9 ? uP : uC;
    const base = a <= 9 ? [hip[0] + uP[0] * a, hip[1] + uP[1] * a] : [waist[0] + uC[0] * (a - 9), waist[1] + uC[1] * (a - 9)];
    return [base[0] - u[1] * b, base[1] + u[0] * b];
  };
  const b = p.breath || 0, neck = T(32 + b * .35, .6);
  return { hip, waist, lean, T, neck, shN: T(27 + b * .5, -6.8), shF: T(27.5 + b * .5, 6.6) };
}
function headAt(neck, lean, p) {
  // The head stays level while the body leans, which is much of what makes a figure feel alive.
  const a = lean * .35 + (p.nod || 0);
  return { hx: neck[0] + Math.sin(a) * 9.5 + 1.2, hy: neck[1] - Math.cos(a) * 9.5, a };
}
// A face turned three quarters toward us: full skull at the back, narrowing to a chin at the front.
function skull(f, hx, hy, skin) {
  f.paint(spline([[hx - 5.4, hy - .6], [hx - 4.8, hy - 5.2], [hx - .4, hy - 7.2], [hx + 4.2, hy - 6.2], [hx + 5.8, hy - 2.6], [hx + 6, hy + .8], [hx + 5, hy + 3.8], [hx + 2.8, hy + 6.4], [hx + .4, hy + 6.6], [hx - 2.4, hy + 4.8], [hx - 4.4, hy + 2.8]]), skin, { round: 4, shadow: 1 });
}
function features(f, hx, hy, o = {}) {
  const brow = o.brow || '#2a1810', iris = o.iris || '#4a7ab4', lip = o.lip || '#9a4640', shade = o.shade || '#b4745a';
  // Brows, then the near eye (wider) and the far eye (narrower and turned away).
  f.line(hx - .4, hy - 3.4, hx + 2, hy - 3, brow); f.line(hx + 3.8, hy - 3, hx + 5, hy - 3.2, brow);
  f.line(hx - .2, hy - 2, hx + 2, hy - 2, '#1a0e0c'); f.line(hx + 4, hy - 2, hx + 5, hy - 2, '#1a0e0c');
  f.dot(hx - .2, hy - 1, '#f6f0e6'); f.dot(hx + .8, hy - 1, iris); f.dot(hx + 1.8, hy - 1, '#120c14');
  f.dot(hx + 4, hy - 1, iris); f.dot(hx + 5, hy - 1, '#f0e8de');
  // Shadow beside the nose, a highlight on it, and a small mouth set toward the front.
  f.dot(hx + 3, hy + .4, shade); f.dot(hx + 3, hy + 1.4, shade); f.dot(hx + 4.2, hy + 1.4, o.nose || '#ffe0c8');
  f.line(hx + 1.8, hy + 3.6, hx + 4, hy + 3.4, lip);
}
function hairLock(f, q, m, len, w, curl = 1.2) {
  f.paint(ribbon([q, [q[0] + curl, q[1] + len * .5], [q[0] + curl * .3, q[1] + len]], [w, w * .72, .3], 2), m, { shadow: 1 });
}
function capeLayers(f, J, p, frameNo, m, lining, o = {}) {
  const neck = J.neck, run = p.speed > 0, phase = p.phase * (run ? 2 : 1);
  const trail = (run ? 1.02 + Math.sin(p.phase * TAU * 2) * .09 : p.windBack || .1) + (run ? 0 : .08), len = (o.len || 66) + (neck[1] + 76) * .9;
  const wide = o.wide || 19;
  const a = cloth(J.shF[0] - 7, J.shF[1] - 1, len, 8, { sway: run ? 3 : 2, trail: trail * .5, phase });
  const b = cloth(J.shN[0] - wide + 7, J.shN[1] + 2, len + 2, 8, { sway: run ? 4.5 : 2.8, trail: trail + .32, phase: phase + .2 });
  const c = cloth(lerp(J.shF[0] - 7, J.shN[0] - wide + 7, .58), J.shN[1], len + 1, 8, { sway: run ? 3.6 : 2.4, trail: trail * .8 + .16, phase: phase + .1 });
  if (lining) f.paint(tatteredCloth(shift(a, 4, 0), shift(c, 4, 0), 23, 8, 6), lining, { round: 7, shadow: 0 });
  f.paint(tatteredCloth(a, b, o.seed || 11, o.tear || 12, o.teeth || 9), m, { round: 10, grad: .42, shadow: 0, fn: (x, y) => Math.sin(x * .62 + y * .05) * .1 });
  for (const k of [.28, .52, .76]) {
    const fold = a.map((q, i) => [lerp(q[0], b[i][0], k), lerp(q[1], b[i][1], k)]).slice(1, -1);
    f.path(spline(fold, false, 3), o.foldDark || '#07060c', true);
    f.path(shift(spline(fold, false, 3), 1, 0), o.foldLight || '#3d384e', true);
  }
}
// Shared timing for everything that isn't an attack.
function basePose(anim, t) {
  if (anim === 'run') {
    const g = gait(t, 13, 12, 1);
    return { hip: [g.sway * .5, -43 + g.bob], lean: .22 + g.sway * .015, near: g.near, far: g.far, swing: g.swing, phase: t, speed: 1, roll: 0, nod: -.06 };
  }
  if (anim === 'idle') {
    // Weight drifts slowly from foot to foot while the chest rises and falls.
    const b = Math.sin(t * TAU * 2), w = Math.sin(t * TAU + .4);
    return { hip: [w * .9, -43 + b * .55 + Math.abs(w) * .3], lean: .07 + b * .008 - w * .008, near: [-9, 0], far: [10, 0], swing: 0, phase: t, speed: 0, breath: b, nod: b * .015, weight: w };
  }
  return { hip: [0, -43], lean: .05, near: [-9, 0], far: [10, 0], swing: 0, phase: t, speed: 0 };
}
function downPose(t) {
  const k = easeIn(Math.min(1, t * 1.15));
  return { k, hip: [lerp(0, -4, k), lerp(-42, -6, k)], lean: lerp(.05, -1.42, k), near: [lerp(-9, 26, k), 0], far: [lerp(10, 20, k), 0], nod: k * -.3 };
}
const hurtKey = k => ({ hip: [-5 * k, -43 + k], lean: -.26 * k + .05, nod: -.2 * k, windBack: -.1 });
function freeArm(sh, swing, reach = 10) { return [sh[0] + 3 - swing * reach, sh[1] + 19 - Math.abs(swing) * 3.4]; }

// ---------------------------------------------------------------- Warden: a horned dread knight
function sword(f, hx, hy, ang, o = {}) {
  const len = 60, wid = 5;
  const R = pts => rotate(pts, ang, hx, hy);
  f.paint(R([[-13, -1.7], [6, -1.7], [6, 1.7], [-13, 1.7]]), LEATHER, { round: 1.5, shadow: 1 });
  f.paint(R(ellipse(-14, 0, 2.8, 2.8)), GOLD, { shadow: 1 });
  f.paint(R([[len, 0], [len - 9, -wid], [9, -wid * 1.05], [9, wid * 1.05], [len - 9, wid]]), BLADE, { round: 3.4, gloss: .9, grad: .46, shadow: 1 });
  const [fa, fb] = [R([[10, 0]])[0], R([[len - 12, 0]])[0]];
  f.line(fa[0], fa[1], fb[0], fb[1], '#23242f');
  const off = R([[10, -1], [len - 13, -1]]);
  f.line(off[0][0], off[0][1], off[1][0], off[1][1], '#3a3b4e');
  f.paint(R([[3, -8.5], [6, -10], [9, -7.5], [9, 7.5], [6, 10], [3, 8.5], [5, 0]]), GOLD, { round: 2, shadow: 1 });
  f.paint(R(ellipse(6, 0, 2.3, 2.3)), mat(['#3a0a4c', '#7a1c9c', '#bb50e8', '#efb0ff'], { gloss: 1, round: 2 }), { shadow: 0 });
  // Runes along the blade take the colour of the item's grade in the game.
  for (let i = 0; i < 6; i++) {
    const u = 15 + i * 7, [a, b] = R([[u, -1.6], [u + 2.6, 1.6]]);
    f.energyLine(a[0], a[1], b[0], b[1], .42);
    f.dot(a[0], a[1], '#1c1a2a'); f.dot(b[0], b[1], '#1c1a2a');
  }
  if (o.lightning) {
    for (let k = 0; k < 2; k++) {
      let u = 10 + rnd(o.lightning, k) * 26, v = (rnd(o.lightning, k + 9) - .5) * 8;
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
const WARDEN_REST = { hip: [0, -43], lean: .1, hN: [15, -47], ang: .66, near: [-10, 0], far: [11, 0] };
const WARDEN_KEYS = {
  atk1: [ // a rising cut: the hips drive first, the shoulders follow, the blade comes last
    [0, WARDEN_REST],
    [.3, { hip: [-7, -39], lean: -.14, hN: [-8, -38], ang: 2.62, near: [-15, 0], far: [8, 0] }, easeOut],
    [.46, { hip: [8, -41], lean: .34, hN: [24, -70], ang: -1.05, near: [-11, 0], far: [23, 0] }, easeIn],
    [.68, { hip: [9, -42], lean: .24, hN: [19, -78], ang: -1.8, near: [-9, 0], far: [23, 0] }, easeOut],
    [1, WARDEN_REST],
  ],
  atk2: [ // an overhead chop with the whole body falling into it
    [0, WARDEN_REST],
    [.34, { hip: [-5, -43], lean: -.24, hN: [-3, -84], ang: -2.55, near: [-14, 0], far: [8, 0] }, easeOut],
    [.46, { hip: [10, -36], lean: .5, hN: [29, -47], ang: .14, near: [-13, 0], far: [25, 0] }, easeIn],
    [.72, { hip: [11, -34], lean: .46, hN: [27, -33], ang: .58, near: [-12, 0], far: [26, 0] }, easeOut],
    [1, WARDEN_REST],
  ],
  atk3: [ // a lunge: back foot drives, front knee bends deep
    [0, WARDEN_REST],
    [.36, { hip: [-10, -39], lean: -.14, hN: [-16, -48], ang: -.05, near: [-20, 0], far: [5, 0] }, easeOut],
    [.48, { hip: [14, -35], lean: .46, hN: [41, -51], ang: -.07, near: [-12, 0], far: [33, 0] }, easeIn],
    [.74, { hip: [13, -35], lean: .4, hN: [37, -49], ang: -.05, near: [-11, 0], far: [32, 0] }, easeOut],
    [1, WARDEN_REST],
  ],
  cast: [
    [0, WARDEN_REST],
    [.4, { hip: [-1, -44], lean: -.14, hN: [9, -88], ang: -1.62, near: [-9, 0], far: [9, 0] }, easeOut],
    [.72, { hip: [-1, -45], lean: -.16, hN: [9, -90], ang: -1.56, near: [-9, 0], far: [9, 0] }],
    [1, WARDEN_REST],
  ],
};
function drawWarden(f, anim, t, frameNo) {
  const p = basePose(anim, t), b = p.breath || 0;
  let hN, ang = .66, smearArc = null, twoHand = true, hFree = null;
  if (anim === 'idle') { hN = [15 + (p.weight || 0) * .6, -47 + b * .6]; ang = .66 + b * .012; }
  else if (anim === 'run') {
    // One hand carries the blade low behind, the other arm pumps against the near leg.
    const S = p.hip[0] - 7, Y = p.hip[1] - 27;
    hN = [S - 3 - p.swing * 3, Y + 24]; ang = 2.78 + p.swing * .05; twoHand = false;
  } else if (anim === 'down') {
    const d = downPose(t); Object.assign(p, d, { windBack: .1 });
    hN = [d.hip[0] + 15, d.hip[1] + 8 + d.k * 2]; ang = lerp(.66, .02, d.k); twoHand = false;
  } else if (anim === 'hurt') {
    const k = Math.sin(t * Math.PI); Object.assign(p, hurtKey(k));
    hN = [10 - 3 * k, -42]; ang = .75 + k * .3;
  } else {
    const a = timeline(t, WARDEN_KEYS[anim]);
    p.hip = a.hip; p.lean = a.lean; hN = a.hN; ang = a.ang; p.near = a.near; p.far = a.far;
    if (anim !== 'cast' && t > .32 && t < .62) {
      const k = (t - .32) / .3, base = anim === 'atk1' ? [2.6, -1.5] : anim === 'atk2' ? [-2.5, .45] : null;
      if (base) smearArc = { a0: lerp(base[0], base[1], Math.max(0, k - .5)), a1: lerp(base[0], base[1], Math.min(1, k * 1.5)) };
    }
    p.windBack = lerp(.12, anim === 'cast' ? .1 : -.05, Math.sin(t * Math.PI));
  }
  const J = joints(p), { hip, T, neck, shN, shF } = J;
  const dir = [Math.cos(ang), Math.sin(ang)];
  // Two hands on a long grip: the far hand sits below the near one, wherever the blade goes.
  const hF = twoHand ? [hN[0] - dir[0] * 8.5, hN[1] - dir[1] * 8.5] : (hFree || freeArm(shF, -p.swing, 9));

  capeLayers(f, J, p, frameNo, CRIMSON, CRIMSON_IN, { seed: 11, len: 66, wide: 22, tear: 12, teeth: 9, foldDark: '#1a0410', foldLight: '#8c1c30' });
  const behind = anim === 'run' || anim === 'down' || (anim.startsWith('atk') && t < .3);

  // Far leg and far arm sit behind everything else.
  leg(f, [hip[0] + 3.4, hip[1] + 1], p.far, STEEL_FAR, null, { hipR: 5.6 });
  armSeg(f, shF, hF, STEEL_FAR, STEEL_FAR, { upper: 15.5, fore: 15.5, r0: 3.8 });
  if (behind) sword(f, hN[0], hN[1], ang, { lightning: frameNo * 7 + 3 });

  // Near leg, with a knee cop and a greave down the shin.
  const nl = leg(f, [hip[0] - 3.2, hip[1] + 1], p.near, STEEL, null, { hipR: 6.2 });
  f.paint(ellipse(nl.knee[0] + 1.2, nl.knee[1], 4.2, 3.8), STEEL_LT, { round: 3, shadow: 2 });
  f.dot(nl.knee[0] + 2, nl.knee[1] - 2, '#e6e8f4');
  f.line(lerp(nl.knee[0], nl.ank[0], .25) + 1.6, lerp(nl.knee[1], nl.ank[1], .25), lerp(nl.knee[0], nl.ank[0], .85) + 1.2, lerp(nl.knee[1], nl.ank[1], .85), '#5e6078', true);

  // Mail skirt, a hanging tabard between the legs, and plates over the hips.
  const sway = (anim === 'run' ? p.swing : b * .3) * 2.2;
  f.paint(ribbon([T(0, 1.5), [hip[0] + 2 + sway * .3, hip[1] + 10], [hip[0] + 3 + sway, hip[1] + 21 - Math.abs(sway)]], [6, 6.2, 4], 3), CRIMSON, { round: 4, shadow: 2 });
  f.paint([T(5, -7.6), T(5, 8.4), [hip[0] + 9.6, hip[1] + 5], [hip[0] + 4.5, hip[1] + 8.5], [hip[0] + .5, hip[1] + 5], [hip[0] - 4.5, hip[1] + 8.5], [hip[0] - 9.4, hip[1] + 4]], STEEL, { round: 3, shadow: 2 });
  f.line(hip[0] - 6.5, hip[1] + 2, hip[0] + 7.5, hip[1] + 2, '#0c0b13', true);

  // Cuirass: a chest wider than the waist, with a ridge down the centre set toward the front.
  const torso = [T(1, -7.4), T(9, -7), T(17, -8.4), T(26, -8.8), T(31, -6), T(32.5, 1), T(31, 8), T(26, 9.4), T(17, 8.8), T(9, 7), T(1, 8)];
  f.paint(spline(torso), STEEL, { round: 5, gloss: .85, grad: .3, shadow: 2 });
  f.path([T(30, 3), T(10, 2.4)], '#0a0910', true); f.path([T(30, 4), T(10, 3.4)], '#5a5d74', true);
  // The curve under the chest plate, and overlapping plates over the belly.
  f.path(spline([T(21, -7.6), T(16, -2), T(16, 3)], false, 3), '#0a0910', true); f.path(spline([T(21, 8.2), T(16, 7), T(16, 3)], false, 3), '#0a0910', true);
  f.path(spline([T(20, -7.6), T(15, -2), T(15, 3)], false, 3), '#6a6d85', true);
  for (const q of [11.5, 7.5]) { f.path([T(q, -6.4), T(q, 7.4)], '#0a0910', true); f.path([T(q - 1, -6.4), T(q - 1, 7.4)], '#454860', true); }
  f.paint([T(1.6, -7.8), T(5.6, -7.8), T(5.6, 8.6), T(1.6, 8.4)], LEATHER, { round: 2, shadow: 1 });
  const buckle = T(3.6, 3); f.paint(ellipse(buckle[0], buckle[1], 3, 2.6), GOLD, { round: 2, shadow: 1 });

  // Far shoulder guard, then a crimson hood wrapped around the throat.
  const pauldron = (cx, cy, sc, m) => {
    f.paint(ellipse(cx, cy, 8.4 * sc, 6.8 * sc, .2), m, { round: 4, gloss: .9, grad: .34 });
    f.path(spline([[cx - 7 * sc, cy + 2.6 * sc], [cx, cy + 5.6 * sc], [cx + 7.4 * sc, cy + 3 * sc]], false, 3), '#0c0b13', true);
    f.path(spline([[cx - 6.6 * sc, cy + .6 * sc], [cx, cy + 3.6 * sc], [cx + 7 * sc, cy + 1 * sc]], false, 3), '#6a6d85', true);
    for (const [dx, a, l] of [[-3.6, -2, 7], [2, -1.5, 8.5]]) {
      const bx = cx + dx * sc, by = cy - 4.6 * sc, tip = [bx + Math.cos(a) * l * sc, by + Math.sin(a) * l * sc];
      f.paint(ribbon([[bx, by], tip], [2 * sc, .3], 3), STEEL_LT, { round: 1.6, gloss: .9, shadow: 1 });
    }
  };
  pauldron(shF[0], shF[1] - .5, .78, STEEL);
  f.paint(spline([[neck[0] - 9, neck[1] + 3], [neck[0] - 6.4, neck[1] - 5], [neck[0] + 6.4, neck[1] - 5], [neck[0] + 9, neck[1] + 3], [neck[0] + 5, neck[1] + 9], [neck[0] - 4, neck[1] + 9]]), CRIMSON, { round: 5, shadow: 2, fn: (x, y) => Math.sin(y * .9 + x * .28) * .13 });

  // Horned great-helm with a narrow, burning visor.
  const { hx, hy } = headAt(neck, p.lean, p);
  const horn = (bx, by, d, sc) => {
    f.paint(ribbon([[bx, by], [bx + d * 5.4 * sc, by - 2.4 * sc], [bx + d * 8.4 * sc, by - 9 * sc], [bx + d * 6 * sc, by - 17 * sc]], [2.9 * sc, 2.5 * sc, 1.6 * sc, .3], 5), mat(['#07060c', '#141320', '#262636', '#3e3f54', '#62657e', '#9a9eb6'], { gloss: .9, round: 2.5 }), { shadow: 1 });
  };
  horn(hx - 5.6, hy - 4.6, -1, 1.04); horn(hx + 5.8, hy - 5, 1, .92);
  f.paint([[hx - 6.4, hy + 5.4], [hx - 7.2, hy - 2.4], [hx - 5, hy - 7.6], [hx + .6, hy - 9.6], [hx + 5.4, hy - 7.6], [hx + 7.8, hy - 2.6], [hx + 8.2, hy + 1.6], [hx + 6.4, hy + 6.2], [hx + 3, hy + 9.2], [hx - .8, hy + 7.4], [hx - 4.4, hy + 7]], STEEL, { round: 4, gloss: 1.1, grad: .4, shadow: 2 });
  f.path([[hx + 2, hy - 9.4], [hx + 4.4, hy - 2.4], [hx + 4.4, hy + 8.4]], '#8c90a8', true);
  f.path([[hx + 3, hy - 9.4], [hx + 5.4, hy - 2.4], [hx + 5.4, hy + 8.4]], '#0b0a12', true);
  f.line(hx - 3.6, hy - 3.4, hx + 8, hy - 1.2, '#040307', true); f.line(hx - 3.6, hy - 2.4, hx + 8, hy - .2, '#040307', true);
  for (const [ex, ey] of [[hx + .6, hy - 2.4], [hx + 1.6, hy - 2.2], [hx + 6.2, hy - 1.2], [hx + 7, hy - 1]]) { f.dot(ex, ey, '#ffe2f4'); f.glow(ex, ey, '#ff2ec0', 1.3); }
  for (let i = 0; i < 3; i++) f.line(hx + 5 + i * 1.3, hy + 2.5, hx + 4.5 + i * 1.3, hy + 5.6, '#050408', true);

  // Blade and near arm in front when it swings forward.
  if (!behind) {
    if (smearArc) smear(f, hN[0] - 6, hN[1] + 8, smearArc.a0, smearArc.a1, 26, 60, .9);
    sword(f, hN[0], hN[1], ang, { lightning: frameNo * 7 + 3 });
  }
  const j = armSeg(f, shN, hN, STEEL, STEEL_LT, { upper: 15.5, fore: 15.5, r0: 4.2 });
  f.paint(ellipse(j.mid[0], j.mid[1], 3.4, 3.2), STEEL_LT, { round: 2.6, shadow: 2 });
  pauldron(shN[0] - .6, shN[1] - 1, 1, STEEL);
  if (anim === 'cast') {
    const k = Math.sin(t * Math.PI), tip = rotate([[60, 0]], ang, hN[0], hN[1])[0];
    for (let a = 0; a < 16; a++) { const q = a / 16 * TAU + t * 5, r = 10 * k + 4; f.energy(tip[0] + Math.cos(q) * r, tip[1] + Math.sin(q) * r, .9 * k); }
    f.energy(tip[0], tip[1], 2.2 * k);
  }
}

// ---------------------------------------------------------------- Fletcher: a hooded ranger
const MOSS = mat(['#060c0c', '#0c1718', '#142526', '#1e3635', '#2c4c49', '#42686a', '#6a948e'], { ambient: .2, round: 6, dither: .05, exposure: .62 });
const MOSS_IN = mat(['#030606', '#070e0e', '#0d1818', '#142322'], { ambient: .3, round: 6, exposure: .6 });
const BRONZE = mat(['#160d07', '#2c1b0d', '#4a2f16', '#6e4820', '#976b30', '#c49850', '#efd088'], { gloss: .9, ambient: .2, round: 2.6, exposure: .6 });
const DARKLEATHER = mat(['#08060a', '#120e12', '#1e1818', '#2e2420', '#44342a', '#5e4838'], { ambient: .22, round: 3, exposure: .62, gloss: .3 });
const BOW = mat(['#0a0712', '#171126', '#271d3c', '#3a2c54', '#524070', '#725c90'], { gloss: .5, ambient: .22, round: 2, exposure: .66 });
const BOOTM = mat(['#050508', '#0c0c12', '#16161f', '#24242f', '#383846', '#54546a'], { gloss: .5, round: 3, exposure: .6 });
function bow(f, hx, hy, ang, pull, tint) {
  const R = pts => rotate(pts, ang, hx, hy);
  const limb = s => [[0, 0], [s * 7, 3.4], [s * 15, 2.6], [s * 22, -2.4], [s * 25, -7]].map(([y, x]) => [x, y]);
  const uA = R(limb(-1)), lA = R(limb(1));
  const string0 = R([[-7, -25]])[0], string1 = R([[-7, 25]])[0], nock = R([[-7 - pull, 0]])[0];
  f.line(string0[0], string0[1], nock[0], nock[1], '#d8dcea');
  f.line(nock[0], nock[1], string1[0], string1[1], '#d8dcea');
  f.paint(ribbon(uA, [3, 2.4, 1.6, 1, .5], 4), BOW, { shadow: 1 });
  f.paint(ribbon(lA, [3, 2.4, 1.6, 1, .5], 4), BOW, { shadow: 1 });
  for (const q of [uA[2], lA[2]]) f.paint(ellipse(q[0], q[1], 2.4, 2.4), BRONZE, { shadow: 1 });
  f.paint(R([[-3, -3.6], [4.6, -3.6], [4.6, 3.6], [-3, 3.6]]), DARKLEATHER, { round: 1.6, shadow: 1 });
  if (pull > 1.5) {
    const tip = R([[34 - pull, 0]])[0];
    f.line(nock[0], nock[1], tip[0], tip[1], '#c9b78a');
    f.paint(R([[34 - pull, 0], [28 - pull, -2.8], [28 - pull, 2.8]]), BLADE, { shadow: 0, round: 1 });
    for (let i = 0; i < 6; i++) { const q = R([[28 - pull - i * 3.4, 0]])[0]; f.energy(q[0], q[1], tint * (1 - i / 7)); }
    const fl = R([[-5 - pull, -2], [-2 - pull, 0], [-5 - pull, 2]]);
    f.line(fl[0][0], fl[0][1], fl[1][0], fl[1][1], '#e8e2d0'); f.line(fl[2][0], fl[2][1], fl[1][0], fl[1][1], '#e8e2d0');
  }
  return nock;
}
const FLETCHER_REST = { hip: [0, -43], lean: .07, hF: [21, -45], hN: [-4, -40], bowA: .52, pl: 0, near: [-9, 0], far: [10, 0] };
const FLETCHER_KEYS = {
  // A real archer's draw: the bow arm rises and locks, the string hand comes back to the cheek.
  atk1: [
    [0, FLETCHER_REST],
    [.22, { hip: [-2, -42], lean: -.06, hF: [27, -62], hN: [16, -61], bowA: .02, pl: 2, near: [-13, 0], far: [11, 0] }, easeOut],
    [.5, { hip: [-4, -41], lean: -.12, hF: [28, -63], hN: [5, -68], bowA: 0, pl: 14, near: [-14, 0], far: [11, 0] }],
    [.58, { hip: [-6, -41], lean: -.18, hF: [26, -64], hN: [-5, -71], bowA: -.03, pl: 0, near: [-15, 0], far: [10, 0] }, easeIn],
    [1, FLETCHER_REST],
  ],
  // A low shot from a wide crouch, knees deeply bent.
  atk2: [
    [0, FLETCHER_REST],
    [.22, { hip: [-3, -35], lean: .12, hF: [28, -49], hN: [17, -48], bowA: .1, pl: 2, near: [-20, 0], far: [16, 0] }, easeOut],
    [.5, { hip: [-5, -33], lean: .08, hF: [30, -48], hN: [7, -52], bowA: .08, pl: 14, near: [-21, 0], far: [18, 0] }],
    [.58, { hip: [-8, -33], lean: -.02, hF: [28, -49], hN: [-2, -55], bowA: .05, pl: 0, near: [-22, 0], far: [18, 0] }, easeIn],
    [1, FLETCHER_REST],
  ],
  cast: [
    [0, FLETCHER_REST],
    [.25, { hip: [-4, -41], lean: -.3, hF: [20, -78], hN: [12, -72], bowA: -.65, pl: 3, near: [-14, 0], far: [11, 0] }, easeOut],
    [.55, { hip: [-5, -40], lean: -.34, hF: [20, -79], hN: [3, -68], bowA: -.68, pl: 14, near: [-15, 0], far: [11, 0] }],
    [.64, { hip: [-6, -40], lean: -.36, hF: [18, -80], hN: [-5, -64], bowA: -.7, pl: 0, near: [-16, 0], far: [10, 0] }, easeIn],
    [1, FLETCHER_REST],
  ],
};
function drawFletcher(f, anim, t, frameNo) {
  const p = basePose(anim, t), b = p.breath || 0;
  let hN, hF, bowAng = .52, pull = 0, elbowUp = false;
  if (anim === 'idle') { hF = [21 + (p.weight || 0) * .5, -45 + b * .5]; hN = [-4 + (p.weight || 0) * .5, -40 + b * .4]; bowAng = .52 + b * .012; }
  else if (anim === 'run') { const s = p.swing, up = p.hip[1] + 43; hF = [20 - s * 4, -50 + up + Math.abs(s) * 2]; hN = [-7 + s * 9, -44 + up - Math.abs(s) * 2]; bowAng = .5 - s * .08; }
  else if (anim === 'down') {
    const d = downPose(t); Object.assign(p, d, { windBack: .1 });
    hF = [d.hip[0] + 18, d.hip[1] + 6 + d.k * 3]; hN = [d.hip[0] + 6, d.hip[1] + 4]; bowAng = lerp(.5, 1.45, d.k);
  } else if (anim === 'hurt') {
    const k = Math.sin(t * Math.PI); Object.assign(p, hurtKey(k));
    hF = [17, -48 - k * 2]; hN = [-4, -40]; bowAng = .5;
  } else {
    const a = timeline(t, FLETCHER_KEYS[anim] || FLETCHER_KEYS.atk1);
    p.hip = a.hip; p.lean = a.lean; hF = a.hF; hN = a.hN; bowAng = a.bowA; pull = a.pl; p.near = a.near; p.far = a.far; p.windBack = .06;
    elbowUp = true;
  }
  const J = joints(p), { hip, T, neck, shN, shF } = J;
  capeLayers(f, J, p, frameNo, MOSS, MOSS_IN, { seed: 31, len: 60, wide: 19, tear: 15, teeth: 10, foldLight: '#37585a' });
  // Quiver slung across the back, arrows over the near shoulder.
  const qa = T(30, -9), qb = T(8, -13.5);
  f.paint(capsule(qa[0], qa[1], qb[0], qb[1], 3.2, 2.8), DARKLEATHER, { round: 2.5, shadow: 1 });
  for (let i = 0; i < 4; i++) {
    const x = qa[0] - 2.6 + i * 1.8, y = qa[1] - 2;
    f.line(x, y, x - 2, y - 7, '#a89a78');
    f.line(x - 3.4, y - 8, x - 1.4, y - 6, '#e0dac8'); f.line(x - 1.4, y - 8, x - 3.4, y - 6, '#c8c0a8');
  }
  // Far leg and the bow arm, reaching forward past the chest.
  const FARM = mat(['#040708', '#091112', '#101c1d', '#182a2a', '#223a39'], { ambient: .22, round: 3, exposure: .6 });
  leg(f, [hip[0] + 3.2, hip[1] + 1], p.far, FARM, mat(['#030305', '#08080c', '#101016', '#1c1c24'], { round: 3, ambient: .2 }), { hipR: 5 });
  armSeg(f, shF, hF, FARM, SKIN_FAR, { upper: 15.5, fore: 15.5, r0: 3.5 });
  bow(f, hF[0], hF[1], bowAng, pull, .5);
  // Near leg: tall boot, knee guard, straps over dark leggings.
  const nl = leg(f, [hip[0] - 3, hip[1] + 1], p.near, DARKLEATHER, BOOTM, { hipR: 5.4 });
  f.paint(ellipse(nl.knee[0] + 1.2, nl.knee[1] - .5, 3.5, 3.5), BRONZE, { shadow: 2 });
  const tm = [(hip[0] - 3 + nl.knee[0]) / 2, (hip[1] + nl.knee[1]) / 2];
  f.line(tm[0] - 4, tm[1] - 2, tm[0] + 5, tm[1] - 1, '#6e4820', true); f.line(tm[0] - 4, tm[1] + 2, tm[0] + 5, tm[1] + 3, '#6e4820', true);
  // Tunic panels swinging with the stride, then a laced leather jerkin.
  const sway = (anim === 'run' ? p.swing : b * .3) * 2;
  f.paint(ribbon([T(1, 4), [hip[0] + 5 + sway * .4, hip[1] + 8], [hip[0] + 7 + sway, hip[1] + 20]], [5, 4.8, 2.4], 3), MOSS, { round: 4, shadow: 2 });
  f.paint(ribbon([T(1, -4), [hip[0] - 5 + sway * .4, hip[1] + 8], [hip[0] - 7 + sway, hip[1] + 18]], [4.6, 4.2, 2], 3), MOSS, { round: 4, shadow: 2 });
  f.paint(spline([T(1, -6.8), T(9, -6.2), T(18, -7.4), T(27, -7.8), T(32, -4), T(32.5, 2), T(31, 7), T(26, 8.2), T(18, 7.6), T(9, 6.4), T(1, 7)]), DARKLEATHER, { round: 5, grad: .3, shadow: 2 });
  for (let i = 0; i < 4; i++) { const u = T(26 - i * 5, 2), v = T(23.5 - i * 5, 5); f.line(u[0], u[1], v[0], v[1], '#6e4820', true); const u2 = T(26 - i * 5, 5), v2 = T(23.5 - i * 5, 2); f.line(u2[0], u2[1], v2[0], v2[1], '#6e4820', true); }
  const strapA = T(31, -6), strapB = T(6, 7); f.line(strapA[0], strapA[1], strapB[0], strapB[1], '#3a2614', true); f.line(strapA[0] + 1, strapA[1], strapB[0] + 1, strapB[1], '#5e4020', true);
  f.paint([T(1.8, -7), T(5.4, -7.2), T(5.4, 7.2), T(1.8, 7)], BRONZE, { round: 2, shadow: 1 });
  const pouch = T(1, -7); f.paint(ellipse(pouch[0], pouch[1] + 3, 3.2, 3.8), DARKLEATHER, { shadow: 1 });
  // Far shoulder: a neat bronze cap with a fringe of feathers.
  const mantle = (cx, cy, sc) => {
    for (let i = 0; i < 5; i++) {
      const a = 2.3 - i * .36, l = (10 - Math.abs(i - 2) * 1) * sc, tip = [cx + Math.cos(a) * l, cy + Math.sin(a) * l + 4 * sc];
      f.paint(ribbon([[cx + Math.cos(a) * 2.5, cy + 2.5], tip], [1.9 * sc, .3], 2), mat(['#14141c', '#2a2a36', '#50505e', '#8c8c98', '#d0d0d8'], { round: 1.5, exposure: .7 }), { shadow: 1 });
    }
    f.paint(ellipse(cx, cy, 5.2 * sc, 3.8 * sc, .15), BRONZE, { round: 2.6, gloss: 1, shadow: 2 });
    f.path(spline([[cx - 4.4 * sc, cy + 1.2], [cx, cy + 2.8 * sc], [cx + 4.4 * sc, cy + 1]], false, 3), '#2c1b0d', true);
  };
  mantle(shF[0], shF[1], .8);
  // A hood that frames a real face: warm skin in shadow, a scarf drawn over the chin, silver hair.
  const { hx, hy } = headAt(neck, p.lean, p);
  const HOODIN = mat(['#02030a', '#050710', '#0a0e16'], { ambient: .5, round: 3, exposure: .4 });
  f.paint(spline([[neck[0] - 9.6, neck[1] + 6], [hx - 10, hy + 3], [hx - 9.6, hy - 5], [hx - 5, hy - 11], [hx + 2.4, hy - 12.4], [hx + 7.8, hy - 8.6], [hx + 9.6, hy - 1.6], [hx + 8.6, hy + 4], [hx + 6.6, hy + 9], [neck[0] + 7, neck[1] + 6], [neck[0] - 2, neck[1] + 9]]), MOSS, { round: 6, grad: .36, shadow: 2 });
  f.paint(spline([[hx - 3, hy - 7.6], [hx + 3.6, hy - 8.8], [hx + 8, hy - 4.4], [hx + 8, hy + 2], [hx + 5.4, hy + 7], [hx - .6, hy + 6], [hx - 3.8, hy]]), HOODIN, { shadow: 0 });
  skull(f, hx + .8, hy - .4, SKIN);
  features(f, hx + .8, hy - .6, { iris: '#d8a838', brow: '#6e7184', lip: '#8a4238', shade: '#8c5240' });
  f.dot(hx + 1.6, hy - 1.6, '#fff0b8'); f.glow(hx + 1.6, hy - 1.6, '#ffae2c', .7); f.glow(hx + 4.8, hy - 1.6, '#ffae2c', .5);
  // Scarf over the mouth and a few silver locks across the brow.
  f.paint(spline([[hx - 3.4, hy + 3], [hx + 2, hy + 2], [hx + 7.4, hy + 2.8], [hx + 7, hy + 7.8], [hx + 2, hy + 9.8], [hx - 3.6, hy + 8.4]]), MOSS, { round: 3.4, shadow: 2 });
  const HAIR_S = mat(['#6e7184', '#a4a7ba', '#d8dae6', '#f6f7fb'], { round: 1.5, exposure: .8 });
  for (const q of [[hx - 2.4, hy - 6.6], [hx, hy - 7.4]]) hairLock(f, q, HAIR_S, 4.6, 1.2, .8);
  // Near arm: when drawing, the elbow lifts behind the shoulder as it would on a real bow.
  const NEARM = mat(['#080c0c', '#101b1b', '#1a2c2b', '#284140', '#385857'], { round: 3, exposure: .66 });
  const j = armSeg(f, shN, hN, NEARM, SKIN, { upper: 15, fore: 15, r0: 3.8, elbow: [shN[0] - 12, shN[1] + 1], elbowK: elbowUp ? Math.min(1, pull / 9) : 0 });
  const fa = along(j.mid, j.end, .55);
  f.paint(capsule(j.mid[0], j.mid[1], fa[0], fa[1], 3.2, 2.9), BRONZE, { round: 2, shadow: 1 });
  mantle(shN[0] - .8, shN[1] - .4, 1);
  if (anim === 'cast' && t > .25 && t < .68) {
    const k = Math.sin((t - .25) / .43 * Math.PI), tip = rotate([[34 - pull, 0]], bowAng, hF[0], hF[1])[0];
    f.energy(tip[0], tip[1], 2.4 * k);
    for (let a = 0; a < 14; a++) { const q = a / 14 * TAU + t * 8; f.energy(tip[0] + Math.cos(q) * 7 * k, tip[1] + Math.sin(q) * 7 * k, .7 * k); }
  }
}

// ---------------------------------------------------------------- Hexer: an ember witch
const ROBE = mat(['#07040e', '#110a1e', '#1c1130', '#2c1a48', '#3e2662', '#553680', '#7a4ea8'], { ambient: .2, round: 6, exposure: .62, dither: .04 });
const ROBE_IN = mat(['#040208', '#0a0512', '#10081c', '#180c26'], { ambient: .3, round: 6, exposure: .6 });
const INK = mat(['#04030a', '#0a0813', '#13101e', '#1e1a2c', '#2c283e'], { ambient: .22, round: 4, exposure: .62 });
const HAIRW = mat(['#2c1208', '#5c2410', '#94381a', '#cc5426', '#ee7c3c', '#ffb066'], { ambient: .25, round: 3, exposure: .72 });
const WOOD = mat(['#0c0810', '#1e1420', '#352430', '#523a40', '#7a5a54'], { round: 2, exposure: .7 });
function witchStaff(f, x, y, ang, frameNo, up = 34, down = 44) {
  const R = pts => rotate(pts, ang, x, y);
  const [top] = R([[up, 0]]), [butt] = R([[-down, 0]]);
  f.paint(capsule(butt[0], butt[1], top[0], top[1], 1.3, 1.7), WOOD, { shadow: 1 });
  const ring = R([[up + 2, -3], [up + 8, -6], [up + 15, -3], [up + 16, 4], [up + 9, 7], [up + 3, 3]]);
  f.paint(ribbon(spline(ring, false, 3), [1.8, 1.2, .5], 1), GOLD, { shadow: 1, exposure: .7, round: 1.4 });
  const [o] = R([[up + 9, 0]]);
  f.paint(ellipse(o[0], o[1], 3.8, 3.8), mat(['#2a2030', '#6a5a78', '#b8a8c8', '#ffffff'], { gloss: 1, round: 3, exposure: .8 }), { shadow: 1 });
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + frameNo * .4; f.energy(o[0] + Math.cos(a) * 3.8, o[1] + Math.sin(a) * 3.8, .45); }
  f.energy(o[0], o[1], 2); f.energy(o[0] + 1, o[1], 1); f.energy(o[0], o[1] + 1, 1); f.energy(o[0] - 1, o[1], 1); f.energy(o[0], o[1] - 1, 1);
  return o;
}
function flame(f, x, y, frameNo, sc = 1) {
  const fl = frameNo * .9;
  for (let i = 0; i < 16; i++) {
    const q = i / 16, r = (1 - q) * 3.8 * sc, px = x + Math.sin(fl + i * 1.3) * r, py = y - 3 - q * 10 * sc - Math.abs(Math.sin(fl * 1.4 + i)) * 2;
    f.glow(px, py, '#ff6a2c', .85 * (1 - q * .5));
    f.dot(px, py, q < .4 ? '#fff0b8' : q < .75 ? '#ffb14a' : '#ee5a24');
  }
}
const HEXER_REST = { hip: [0, -43], lean: .05, hF: [22, -47], hN: [9, -50], ang: -1.53, near: [-8, 0], far: [9, 0] };
const HEXER_KEYS = {
  atk1: [ // gathers the flame back at the shoulder, then throws it forward from the hips
    [0, HEXER_REST],
    [.34, { hip: [-3, -42], lean: -.18, hF: [18, -48], hN: [-8, -66], ang: -1.68, near: [-12, 0], far: [8, 0] }, easeOut],
    [.5, { hip: [7, -42], lean: .26, hF: [24, -47], hN: [34, -60], ang: -1.42, near: [-10, 0], far: [18, 0] }, easeIn],
    [.72, { hip: [6, -42], lean: .2, hF: [24, -47], hN: [31, -57], ang: -1.46, near: [-10, 0], far: [17, 0] }],
    [1, HEXER_REST],
  ],
  atk2: [ // brings the staff up in both hands and sweeps it down
    [0, HEXER_REST],
    [.34, { hip: [-3, -43], lean: -.24, hF: [10, -76], hN: [1, -70], ang: -2.2, near: [-12, 0], far: [7, 0] }, easeOut],
    [.5, { hip: [8, -39], lean: .34, hF: [36, -50], hN: [26, -48], ang: -.5, near: [-11, 0], far: [21, 0] }, easeIn],
    [.72, { hip: [7, -39], lean: .3, hF: [34, -46], hN: [24, -45], ang: -.42, near: [-11, 0], far: [20, 0] }],
    [1, HEXER_REST],
  ],
  cast: [
    [0, HEXER_REST],
    [.38, { hip: [0, -46], lean: -.14, hF: [20, -80], hN: [-6, -82], ang: -1.5, near: [-7, -2], far: [7, -2] }, easeOut],
    [.74, { hip: [0, -47], lean: -.14, hF: [20, -82], hN: [-6, -84], ang: -1.5, near: [-7, -3], far: [7, -3] }],
    [1, HEXER_REST],
  ],
};
function drawHexer(f, anim, t, frameNo) {
  const p = basePose(anim, t), b = p.breath || 0;
  let hN, hF, ang = -1.53;
  if (anim === 'idle') { hF = [22 + (p.weight || 0) * .3, -47 + b * .3]; hN = [9 + (p.weight || 0) * .5, -50 + b * .7]; }
  else if (anim === 'run') { const s = p.swing, up = p.hip[1] + 43; hF = [20 - s * 2, -48 + up]; hN = [-5 + s * 8, -46 + up - Math.abs(s) * 2]; ang = -1.08; }
  else if (anim === 'down') {
    const d = downPose(t); Object.assign(p, d, { windBack: .1 });
    hF = [d.hip[0] + 18, d.hip[1] + 6 + d.k * 3]; hN = [d.hip[0] + 4, d.hip[1] + 4]; ang = lerp(-1.53, -.1, d.k);
  } else if (anim === 'hurt') {
    const k = Math.sin(t * Math.PI); Object.assign(p, hurtKey(k));
    hF = [18, -48]; hN = [4, -44]; ang = -1.7;
  } else {
    const a = timeline(t, HEXER_KEYS[anim] || HEXER_KEYS.atk1);
    p.hip = a.hip; p.lean = a.lean; hF = a.hF; hN = a.hN; ang = a.ang; p.near = a.near; p.far = a.far; p.windBack = .05;
  }
  const J = joints(p), { hip, T, neck, shN, shF } = J;
  capeLayers(f, J, p, frameNo, ROBE, ROBE_IN, { seed: 47, len: 58, wide: 16, tear: 9, teeth: 9, foldLight: '#4a3070' });
  const { hx, hy } = headAt(neck, p.lean, p);
  // Long copper hair streaming behind her, moving a beat later than her body.
  const hairT = (anim === 'run' ? 1.1 : .28) + Math.sin(p.phase * TAU * 2) * .1;
  for (const [ox, len, w] of [[-6, 34, 3.6], [-3, 29, 3.1], [-7.6, 25, 2.8]]) {
    const c = cloth(hx + ox, hy - 2, len, 5, { sway: 2.4, trail: hairT, phase: p.phase + ox * .03 });
    f.paint(ribbon(c, [w, w * .95, w * .7, w * .4, .4], 3), HAIRW, { shadow: 1 });
  }
  // Staff arm behind her, staff planted out in front.
  armSeg(f, shF, hF, ROBE, SKIN_FAR, { upper: 15, fore: 15, r0: 3.2 });
  witchStaff(f, hF[0], hF[1], ang, frameNo);
  // Legs barely show under layered skirts: an inner black, an outer violet split at the front.
  leg(f, [hip[0] + 2.6, hip[1] + 1], p.far, INK, INK, { hipR: 4.6 });
  leg(f, [hip[0] - 2.4, hip[1] + 1], p.near, INK, mat(['#050408', '#0d0a14', '#1a1426', '#2a2038', '#4a3a5a'], { gloss: .6, round: 2.5, exposure: .62 }), { hipR: 4.8 });
  const sw = (anim === 'run' ? p.swing : b * .4) * 3;
  const skirt = (x0, x1, spread, m, seed, tear) => {
    const A = [T(4, x0), [hip[0] + x0 - spread * .4 + sw * .3, hip[1] + 18], [hip[0] + x0 - spread + sw, hip[1] + 37]];
    const B = [T(4, x1), [hip[0] + x1 + spread * .4 + sw * .3, hip[1] + 18], [hip[0] + x1 + spread + sw, hip[1] + 37]];
    f.paint(tatteredCloth(spline(A, false, 3), spline(B, false, 3), seed, tear, 6), m, { round: 6, shadow: 2, fn: (x) => Math.sin(x * .9) * .09 });
  };
  skirt(-1, 8, 4, INK, 3, 3);
  skirt(-8, 2, 5, ROBE, 8, 5);
  f.path(spline([T(4, 2), [hip[0] + 2 + sw * .4, hip[1] + 18], [hip[0] + 3 + sw, hip[1] + 35]], false, 3), '#c9963c', true);
  // A fitted bodice, narrow at the waist, with a gold-edged neckline and hanging talismans.
  f.paint(spline([T(1, -6), T(9, -5.2), T(17, -6.6), T(26, -7.6), T(31, -5), T(31.6, 2), T(30, 7), T(26, 8), T(18, 7.4), T(9, 5.6), T(1, 6)]), ROBE, { round: 5, shadow: 2, grad: .32 });
  f.path([T(29, -1), T(19, 4), T(29, 8)], '#d8a848', true);
  f.path([T(28.4, 0), T(20, 4), T(28.4, 7)], '#ecba96', true);
  f.paint([T(1.6, -6.4), T(5, -6.4), T(5, 6.4), T(1.6, 6.4)], GOLD, { round: 1.6, shadow: 1, exposure: .62 });
  for (const q0 of [-3.6, 3.4]) { const q = T(1, q0); f.line(q[0], q[1], q[0], q[1] + 5, '#c9963c'); f.paint(ellipse(q[0], q[1] + 7, 1.6, 2), mat(['#3a0c4c', '#8c1c9c', '#e050e8'], { gloss: 1, round: 2 }), { shadow: 1 }); f.glow(q[0], q[1] + 7, '#e050e8', .5); }
  // Neck, a warm face, then hair framing it and a slim gold circlet with two swept horns.
  f.paint(capsule(neck[0], neck[1] + 2, hx - 1, hy + 5, 2.4, 2.4), SKIN_PALE, { shadow: 1 });
  for (const [bx, d, sc] of [[hx - 4.6, -1, 1], [hx + 4, 1, .86]]) f.paint(ribbon([[bx, hy - 5], [bx + d * 3.4 * sc, hy - 11 * sc], [bx + d * 2.4 * sc, hy - 19 * sc]], [1.8 * sc, 1.4 * sc, .3], 4), STEEL, { shadow: 1 });
  f.paint(spline([[hx - 7, hy + 3], [hx - 7.6, hy - 4], [hx - 4, hy - 8.6], [hx + 2, hy - 9.2], [hx + 6.6, hy - 6], [hx + 5, hy - 3], [hx - 1, hy - 2], [hx - 3, hy + 6]]), HAIRW, { round: 4, shadow: 1 });
  skull(f, hx + .2, hy, SKIN_PALE);
  features(f, hx + .2, hy, { iris: '#e03cc0', brow: '#7a2c14', lip: '#b43c50', shade: '#c49078', nose: '#fff0e2' });
  f.glow(hx + 1, hy - 1, '#ff2ec8', .8); f.glow(hx + 4.2, hy - 1, '#ff2ec8', .6);
  for (const q of [[hx - 2.6, hy - 7.6], [hx, hy - 8.2], [hx + 2.6, hy - 8], [hx + 4.6, hy - 7]]) hairLock(f, q, HAIRW, 3.8, 1.6, .9);
  hairLock(f, [hx - 3, hy - 3], HAIRW, 11, 1.9, -1);
  f.paint(ribbon([[hx - 6, hy - 6.4], [hx + .6, hy - 8.6], [hx + 6.4, hy - 6]], [.9, 1.1, .9], 3), GOLD, { shadow: 1, exposure: .75 });
  f.paint(ellipse(hx + .6, hy - 8.6, 1.5, 1.5), mat(['#4c0c30', '#a8205c', '#ff5ca0', '#ffd0e4'], { gloss: 1, round: 2 }), { shadow: 1 });
  f.glow(hx + .6, hy - 8.6, '#ff3c9c', .5);
  // Near arm in a long open sleeve, with the fire held in her bare hand.
  const j = armSeg(f, shN, hN, ROBE, SKIN_PALE, { upper: 15, fore: 15, r0: 3.8, sleeve: ROBE });
  const sa = Math.atan2(hN[1] - j.mid[1], hN[0] - j.mid[0]), cuff = along(j.mid, hN, .72);
  const hang = 8 + Math.abs(sw) * .6;
  f.paint([[j.mid[0] - 2, j.mid[1] - 3], [cuff[0] + Math.sin(sa) * 3, cuff[1] - Math.cos(sa) * 3], [cuff[0] - Math.sin(sa) * 3, cuff[1] + hang], [cuff[0] - 5, cuff[1] + hang + 2], [j.mid[0] - 3, j.mid[1] + 5]], ROBE, { round: 3.4, shadow: 2 });
  f.line(cuff[0] - Math.sin(sa) * 3, cuff[1] + hang, cuff[0] - 5, cuff[1] + hang + 2, '#d8a848', true);
  flame(f, hN[0] + Math.cos(sa) * 2, hN[1] + Math.sin(sa) * 2, frameNo, anim === 'cast' ? 1.4 : 1);
  f.paint(ellipse(shN[0] - .4, shN[1], 5.2, 4.2, .1), INK, { round: 3, shadow: 2 });
  f.path(spline([[shN[0] - 4, shN[1] + 1.6], [shN[0], shN[1] + 3.8], [shN[0] + 4.4, shN[1] + 1]], false, 3), '#d8a848', true);
  if (anim === 'cast' && t > .2) {
    // A rune circle opening at her feet while she gathers power.
    const k = Math.sin(Math.min(1, (t - .2) / .7) * Math.PI);
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * TAU + t * 3, rx = 30 * k + 6, ry = 7 * k + 1;
      f.glow(Math.cos(a) * rx, -2 + Math.sin(a) * ry, '#ff4ad8', .8 * k);
      if (i % 5 === 0) f.glow(Math.cos(a) * rx * .7, -2 + Math.sin(a) * ry * .7, '#ffb14a', .9 * k);
    }
  }
}

// ---------------------------------------------------------------- Mender: a saint in white plate
const WHITEPLATE = mat(['#2a2a38', '#4c4c5e', '#747488', '#9c9cb0', '#c4c4d4', '#e4e4ee', '#ffffff'], { gloss: .9, ambient: .26, round: 3.4, exposure: .66 });
const WP_DARK = mat(['#141420', '#26263a', '#3e3e54', '#5a5a70', '#7c7c92'], { gloss: .6, round: 3, ambient: .2, exposure: .62 });
const IVORY = mat(['#2e2a2a', '#524a44', '#7c7262', '#a89c84', '#d0c6a8', '#ece4c8'], { ambient: .24, round: 8, exposure: .68, dither: .04 });
const IVORY_IN = mat(['#171414', '#262220', '#37302c', '#4a423a'], { ambient: .3, round: 6, exposure: .6 });
const TEAL = mat(['#04100e', '#0a221e', '#123a32', '#1c584a', '#2a7e68', '#44aa8c'], { ambient: .22, round: 4, exposure: .66 });
const MENDER_REST = { hip: [0, -43], lean: .05, hF: [22, -48], hN: [6, -48], ang: -1.55, near: [-8, 0], far: [9, 0] };
const MENDER_KEYS = {
  atk1: [ // a two-handed overhead swing of the sun staff
    [0, MENDER_REST],
    [.32, { hip: [-5, -42], lean: -.22, hF: [2, -76], hN: [-7, -70], ang: -2.5, near: [-14, 0], far: [8, 0] }, easeOut],
    [.46, { hip: [8, -38], lean: .42, hF: [31, -49], hN: [22, -51], ang: -.35, near: [-13, 0], far: [22, 0] }, easeIn],
    [.7, { hip: [9, -37], lean: .36, hF: [29, -39], hN: [20, -43], ang: .35, near: [-12, 0], far: [22, 0] }, easeOut],
    [1, MENDER_REST],
  ],
  atk2: [ // a straight thrust, with no wide swing
    [0, MENDER_REST],
    [.32, { hip: [-6, -42], lean: -.14, hF: [-1, -48], hN: [-9, -46], ang: -.12, near: [-15, 0], far: [7, 0] }, easeOut],
    [.46, { hip: [11, -40], lean: .38, hF: [37, -56], hN: [27, -55], ang: -.14, near: [-13, 0], far: [25, 0] }, easeIn],
    [.7, { hip: [10, -40], lean: .32, hF: [34, -54], hN: [24, -54], ang: -.14, near: [-13, 0], far: [24, 0] }, easeOut],
    [1, MENDER_REST],
  ],
  cast: [ // staff lifted high, other palm open to the sky
    [0, MENDER_REST],
    [.38, { hip: [0, -45], lean: -.12, hF: [14, -82], hN: [-10, -74], ang: -1.56, near: [-8, -1], far: [7, -1] }, easeOut],
    [.74, { hip: [0, -46], lean: -.12, hF: [14, -84], hN: [-11, -76], ang: -1.56, near: [-8, -2], far: [7, -2] }],
    [1, MENDER_REST],
  ],
};
function drawMender(f, anim, t, frameNo) {
  const p = basePose(anim, t), b = p.breath || 0;
  let hN, hF, ang = -1.55, smearArc = null;
  if (anim === 'idle') { hF = [22 + (p.weight || 0) * .3, -48 + b * .3]; hN = [6 + (p.weight || 0) * .4, -48 + b * .7]; }
  else if (anim === 'run') { const s = p.swing, up = p.hip[1] + 43; hF = [21 - s * 2, -50 + up]; hN = [-6 + s * 8, -46 + up - Math.abs(s) * 2]; ang = -1; }
  else if (anim === 'down') {
    const d = downPose(t); Object.assign(p, d, { windBack: .1 });
    hF = [d.hip[0] + 18, d.hip[1] + 6 + d.k * 3]; hN = [d.hip[0] + 4, d.hip[1] + 4]; ang = lerp(-1.55, -.1, d.k);
  } else if (anim === 'hurt') {
    const k = Math.sin(t * Math.PI); Object.assign(p, hurtKey(k));
    hF = [18, -48]; hN = [2, -44];
  } else {
    const a = timeline(t, MENDER_KEYS[anim] || MENDER_KEYS.atk1);
    p.hip = a.hip; p.lean = a.lean; hF = a.hF; hN = a.hN; ang = a.ang; p.near = a.near; p.far = a.far; p.windBack = .06;
    if (anim === 'atk1' && t > .32 && t < .6) { const k = (t - .32) / .28; smearArc = { a0: lerp(-2.5, .35, Math.max(0, k - .55)), a1: lerp(-2.5, .35, Math.min(1, k * 1.5)) }; }
  }
  const J = joints(p), { hip, T, neck, shN, shF } = J;
  const { hx, hy } = headAt(neck, p.lean, p);
  // The halo floats behind her head, light only, so it glows against the dark.
  for (let i = 0; i < 44; i++) {
    const a = i / 44 * TAU, r = 12.5 + (i % 2) * .5;
    f.glow(hx - 1 + Math.cos(a) * r, hy - 1 + Math.sin(a) * r, '#ffd877', .6);
    if (i % 6 === 0) f.glowLine(hx - 1 + Math.cos(a) * (r + 1), hy - 1 + Math.sin(a) * (r + 1), hx - 1 + Math.cos(a) * (r + 3.4), hy - 1 + Math.sin(a) * (r + 3.4), '#ffe9a8', .5);
  }
  capeLayers(f, J, p, frameNo, IVORY, IVORY_IN, { seed: 61, len: 62, wide: 18, tear: 8, teeth: 7, foldDark: '#2e2a2a', foldLight: '#efe7cc' });
  // Far arm and the staff in it, far leg.
  leg(f, [hip[0] + 3.2, hip[1] + 1], p.far, WP_DARK, WP_DARK, { hipR: 5 });
  armSeg(f, shF, hF, WP_DARK, WP_DARK, { upper: 15, fore: 15, r0: 3.4 });
  const R = pts => rotate(pts, ang, hF[0], hF[1]);
  const end = R([[34, 0]])[0], butt = R([[-46, 0]])[0];
  if (smearArc) smear(f, hF[0], hF[1], smearArc.a0, smearArc.a1, 14, 42, .8);
  f.paint(capsule(butt[0], butt[1], end[0], end[1], 1.4, 1.4), GOLD, { round: 1.4, shadow: 1, exposure: .72 });
  const sun = end;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU + frameNo * .08, r1 = i % 2 ? 6 : 8.6;
    f.paint(ribbon([[sun[0] + Math.cos(a) * 2, sun[1] + Math.sin(a) * 2], [sun[0] + Math.cos(a) * r1, sun[1] + Math.sin(a) * r1]], [1.5, .3], 2), GOLD, { shadow: 1, exposure: .78 });
  }
  f.paint(ellipse(sun[0], sun[1], 3.2, 3.2), mat(['#c98a24', '#f4c75a', '#fff0a8', '#ffffff'], { gloss: 1, round: 3, exposure: .9 }), { shadow: 1 });
  f.energy(sun[0], sun[1], 1.8);
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + frameNo * .3; f.energy(sun[0] + Math.cos(a) * 4, sun[1] + Math.sin(a) * 4, .4); }
  // Near leg with a gold knee guard.
  const nl = leg(f, [hip[0] - 3, hip[1] + 1], p.near, WHITEPLATE, WHITEPLATE, { hipR: 5.4 });
  f.paint(ellipse(nl.knee[0] + 1.2, nl.knee[1], 3.6, 3.4), GOLD, { shadow: 2, exposure: .7 });
  const sw = (anim === 'run' ? p.swing : b * .3) * 2;
  // Long surplice panels down the front, trimmed in teal, and a skirt over the thighs.
  f.paint(ribbon([T(3, 3), [hip[0] + 4 + sw * .4, hip[1] + 14], [hip[0] + 6 + sw, hip[1] + 31]], [5.8, 5.6, 4.2], 3), IVORY, { round: 4, shadow: 2 });
  f.path(spline([T(3, 3), [hip[0] + 4 + sw * .4, hip[1] + 14], [hip[0] + 6 + sw, hip[1] + 30]], false, 3), '#2a7e68', true);
  f.line(hip[0] + 2 + sw, hip[1] + 31, hip[0] + 10 + sw, hip[1] + 31, '#e4b24e', true);
  // Fitted cuirass, belt, and a small holy sign over the heart.
  f.paint(spline([T(1, -6.2), T(9, -5.4), T(17, -6.8), T(26, -8), T(31, -5.4), T(32, 1.6), T(30.6, 7.4), T(26, 8.4), T(18, 7.6), T(9, 5.8), T(1, 6.4)]), WHITEPLATE, { round: 5, gloss: 1, grad: .32, shadow: 2 });
  f.path([T(23, -6.6), T(15, -3), T(9, -4.6)], '#70708a', true); f.path([T(23, 7.6), T(15, 5), T(9, 5.4)], '#70708a', true);
  const heart = T(20, 2.4);
  rows(f, ['..G..', '.GGG.', 'GGWGG', '.GGG.', '..G..'], heart[0] - 2, heart[1] - 2, { G: '#e4b24e', W: '#fff4b8' });
  f.glow(heart[0], heart[1], '#ffd877', .6);
  f.paint([T(1.6, -6.6), T(5, -6.8), T(5, 6.8), T(1.6, 6.8)], TEAL, { round: 2, shadow: 1 });
  const bk = T(3.4, 2); f.paint(ellipse(bk[0], bk[1], 2.2, 2.2), GOLD, { shadow: 1 });
  // Layered plate shoulders with a modest edge of gold-tipped feathers.
  const wing = (cx, cy, sc) => {
    for (let i = 0; i < 3; i++) {
      const a = -2.55 + i * .36, l = (9 - i * 1) * sc;
      f.paint(ribbon([[cx, cy], [cx + Math.cos(a) * l, cy + Math.sin(a) * l]], [2.2 * sc, .4], 3), i % 2 ? WHITEPLATE : GOLD, { round: 2, shadow: 1, exposure: .72 });
    }
    f.paint(ellipse(cx, cy, 6.6 * sc, 5.2 * sc, .15), WHITEPLATE, { round: 3.2, gloss: 1, shadow: 2 });
    f.path(spline([[cx - 5.6 * sc, cy + 1.6], [cx, cy + 3.8 * sc], [cx + 5.6 * sc, cy + 1.2]], false, 3), '#b5862c', true);
  };
  wing(shF[0], shF[1], .8);
  // A soft veil around a real face, silver hair showing at the brow.
  f.paint(spline([[neck[0] - 8, neck[1] + 7], [hx - 9, hy + 5], [hx - 9, hy - 3], [hx - 5, hy - 9], [hx + 1.6, hy - 10.6], [hx + 7, hy - 7.6], [hx + 7.6, hy - 2], [hx + 6, hy + 3], [hx + 5, hy + 9], [neck[0] + 5, neck[1] + 7], [neck[0] - 2, neck[1] + 10]]), IVORY, { round: 5, shadow: 2 });
  skull(f, hx + .6, hy + .2, SKIN);
  features(f, hx + .6, hy, { iris: '#4aa8e0', brow: '#a8a0a0', lip: '#b05a50' });
  const SILVER = mat(['#8088a0', '#b8bed0', '#e8ecf4', '#ffffff'], { round: 1.5, exposure: .85 });
  f.paint(ribbon([[hx - 3.4, hy - 3.6], [hx + 1.4, hy - 7], [hx + 6.6, hy - 4.6]], [1.4, 1.8, 1], 3), SILVER, { shadow: 1 });
  f.paint(ribbon([[hx - 6, hy - 6.4], [hx + 1, hy - 9.4], [hx + 7.4, hy - 6.2]], [1, 1.3, 1], 3), GOLD, { shadow: 1, exposure: .75 });
  // Near arm: in plate, with a bare hand held open before her.
  const j = armSeg(f, shN, hN, WHITEPLATE, SKIN, { upper: 15, fore: 15, r0: 3.8, sleeve: WHITEPLATE });
  f.paint(ellipse(j.mid[0], j.mid[1], 3, 2.8), GOLD, { round: 2.4, shadow: 1, exposure: .72 });
  wing(shN[0] - .8, shN[1] - .4, 1);
  if (anim === 'cast') {
    const k = Math.sin(t * Math.PI);
    for (let a = 0; a < 18; a++) { const q = a / 18 * TAU + t * 4; f.energy(sun[0] + Math.cos(q) * 13 * k, sun[1] + Math.sin(q) * 13 * k, .7 * k); }
  }
}

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
void easeOut; void capsule;
