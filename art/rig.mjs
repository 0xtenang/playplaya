// Motion helpers: joints solved with inverse kinematics, and timelines with easing.
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const easeOut = t => 1 - (1 - t) * (1 - t) * (1 - t);
export const easeIn = t => t * t * t;
export const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const TAU = Math.PI * 2;

// Finds the elbow or knee between two joints. bend picks which way it folds.
export function ik(ax, ay, bx, by, l1, l2, bend = 1) {
  const dx = bx - ax, dy = by - ay;
  let d = Math.hypot(dx, dy) || .001;
  const mx = l1 + l2 - .01;
  if (d > mx) { bx = ax + dx / d * mx; by = ay + dy / d * mx; d = mx; }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = (bx - ax) / d, uy = (by - ay) / d;
  return { mid: [ax + ux * a - uy * h * bend, ay + uy * a + ux * h * bend], end: [bx, by] };
}
// Plays a list of [time, {values}, easing] keys. Values blend smoothly between neighbours.
export function timeline(t, keys) {
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1][0]) i++;
  const [t0, a] = keys[i], [t1, b, ease] = keys[i + 1];
  const u = clamp((t - t0) / Math.max(.0001, t1 - t0), 0, 1), e = (ease || easeInOut)(u), out = {};
  for (const k of Object.keys(a)) {
    const va = a[k], vb = b[k] === undefined ? va : b[k];
    out[k] = Array.isArray(va) ? va.map((v, n) => lerp(v, vb[n], e)) : lerp(va, vb, e);
  }
  return out;
}
const hash = (a, b) => { let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 7, 0xc2b2ae35); x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995); return ((x ^ (x >>> 15)) >>> 0) / 4294967296; };
export const rnd = hash;

// A running or walking leg cycle. Each foot plants heel first, rolls forward while it pushes
// back along the ground, leaves from the toe, then swings through with the heel lifted.
// A foot is [x, y, roll]: roll below zero means toes up, above zero means heel up.
export function gait(phase, stride, lift, sprint = 1) {
  const stance = .38;
  const foot = p => {
    const u = ((phase + p) % 1 + 1) % 1;
    if (u < stance) {
      const s = u / stance;
      return [lerp(stride, -stride, s), 0, s < .18 ? lerp(-.38, 0, s / .18) : s > .62 ? lerp(0, .72, (s - .62) / .38) : 0];
    }
    const s = (u - stance) / (1 - stance), e = s * s * (3 - 2 * s);
    return [lerp(-stride, stride, e), -lift * Math.pow(Math.sin(Math.PI * Math.pow(s, .78)), .85), lerp(.72, -.38, s)];
  };
  // The body is lowest with a foot flat under it and highest as it leaves the ground.
  const bob = Math.cos((phase - stance / 2) * TAU * 2) * 1.5 * sprint;
  return { near: foot(0), far: foot(.5), bob, swing: Math.cos(phase * TAU), sway: Math.sin(phase * TAU * 2) };
}
// Cloth that follows the body with a delay: a chain of points driven by waves and speed.
export function cloth(ax, ay, len, n, { sway = 3, trail = 0, phase = 0, drop = 1, wave = 2.1 } = {}) {
  const pts = [[ax, ay]];
  let x = ax, y = ay;
  const seg = len / n;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const ang = Math.PI / 2 * drop + trail * t + Math.sin(phase * TAU - t * wave * 2) * sway * .09 * (t + .25);
    x += Math.cos(ang) * seg; y += Math.sin(ang) * seg;
    pts.push([x, y]);
  }
  return pts;
}
