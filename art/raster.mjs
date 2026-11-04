// The sprite renderer, used at build time. Every body part is a layer: a shape rasterized
// to a crisp mask, lit like a real 3D surface using its distance from its own edge, and
// painted over the layers behind it with a contact shadow. No canvas or browser needed.
import zlib from 'node:zlib';
import { writeFileSync } from 'node:fs';

const hexCache = new Map();
export function rgb(h) {
  if (Array.isArray(h)) return h;
  let v = hexCache.get(h);
  if (!v) { const n = parseInt(h.slice(1), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; hexCache.set(h, v); }
  return v;
}
export const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// A material is a light-to-dark colour ramp plus how the surface responds to light.
export function mat(colors, o = {}) {
  return { tones: colors.map(rgb), round: 4, gloss: 0, ambient: .28, dither: 0, ...o };
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16 - .5);
const LIGHT = (() => { const l = [-.52, -.74, .62], n = Math.hypot(...l); return l.map(v => v / n); })();
const HALF = (() => { const h = [LIGHT[0], LIGHT[1], LIGHT[2] + 1], n = Math.hypot(...h); return h.map(v => v / n); })();

// ---------------------------------------------------------------- shapes
export function spline(pts, closed = true, steps = 6) {
  const out = [], n = pts.length, q = i => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const end = closed ? n : n - 1;
  for (let i = 0; i < end; i++) {
    const a = q(i - 1), b = q(i), c = q(i + 1), d = q(i + 2);
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([
        .5 * (2 * b[0] + (c[0] - a[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2 + (3 * b[0] - a[0] - 3 * c[0] + d[0]) * t3),
        .5 * (2 * b[1] + (c[1] - a[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (3 * b[1] - a[1] - 3 * c[1] + d[1]) * t3),
      ]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
export function ellipse(cx, cy, rx, ry, rot = 0, steps = 28) {
  const out = [], c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < steps; i++) {
    const a = i / steps * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}
export function capsule(x0, y0, x1, y1, r0, r1 = r0) {
  const a = Math.atan2(y1 - y0, x1 - x0), out = [];
  for (let i = 0; i <= 8; i++) { const t = a - Math.PI / 2 + i / 8 * Math.PI; out.push([x1 + Math.cos(t) * r1, y1 + Math.sin(t) * r1]); }
  for (let i = 0; i <= 8; i++) { const t = a + Math.PI / 2 + i / 8 * Math.PI; out.push([x0 + Math.cos(t) * r0, y0 + Math.sin(t) * r0]); }
  return out;
}
// A tapered ribbon through a path: horns, tails, hair locks, cloth folds.
export function ribbon(pts, widths, steps = 6) {
  const path = spline(pts, false, steps), left = [], right = [], n = path.length;
  for (let i = 0; i < n; i++) {
    const p = path[i], q = path[Math.min(n - 1, i + 1)], r = path[Math.max(0, i - 1)];
    const dx = q[0] - r[0], dy = q[1] - r[1], l = Math.hypot(dx, dy) || 1;
    const t = i / (n - 1), f = t * (widths.length - 1), k = Math.min(widths.length - 2, Math.floor(f));
    const w = widths[k] + (widths[k + 1] - widths[k]) * (f - k);
    left.push([p[0] - dy / l * w, p[1] + dx / l * w]);
    right.push([p[0] + dy / l * w, p[1] - dx / l * w]);
  }
  return left.concat(right.reverse());
}
export const rotate = (pts, a, ox = 0, oy = 0) => {
  const c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [ox + x * c - y * s, oy + x * s + y * c]);
};
export const shift = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
export const flipX = (pts, cx = 0) => pts.map(([x, y]) => [2 * cx - x, y]);

// ---------------------------------------------------------------- one frame being drawn
export class Frame {
  constructor(w, h, ox, oy) {
    this.w = w; this.h = h; this.ox = ox; this.oy = oy;
    this.c = new Uint8ClampedArray(w * h * 4);   // the lit sprite
    this.e = new Float32Array(w * h * 3);        // light it gives off, added on top in the game
    this.t = new Float32Array(w * h);            // weapon energy, tinted by item grade in the game
  }
  // Scanline fill at pixel centres. No soft edges, so every pixel stays crisp.
  mask(polys) {
    const list = Array.isArray(polys[0][0]) ? polys : [polys];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const pts of list) for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const mx0 = Math.max(0, Math.floor(this.ox + x0) - 1), my0 = Math.max(0, Math.floor(this.oy + y0) - 1);
    const mx1 = Math.min(this.w - 1, Math.ceil(this.ox + x1) + 1), my1 = Math.min(this.h - 1, Math.ceil(this.oy + y1) + 1);
    const w = mx1 - mx0 + 1, h = my1 - my0 + 1;
    if (w <= 0 || h <= 0) return null;
    const d = new Uint8Array(w * h);
    for (const pts of list) {
      for (let py = 0; py < h; py++) {
        const sy = my0 + py + .5 - this.oy, xs = [];
        for (let i = 0, n = pts.length; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % n];
          if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) xs.push(a[0] + (sy - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const from = Math.max(0, Math.ceil(xs[k] + this.ox - mx0 - .5)), to = Math.min(w - 1, Math.floor(xs[k + 1] + this.ox - mx0 - .5));
          for (let x = from; x <= to; x++) d[py * w + x] = 1;
        }
      }
    }
    return { x0: mx0, y0: my0, w, h, d };
  }
  // Paints one layer: contact shadow on what is behind, then the lit surface.
  paint(polys, m, o = {}) {
    const k = this.mask(polys);
    if (!k) return null;
    const { x0, y0, w, h, d } = k, W = this.w, c = this.c;
    if (o.shadow !== 0) {
      const sx = 1, sy = o.shadow === undefined ? 2 : o.shadow, dark = o.shadowDark === undefined ? .58 : o.shadowDark;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!d[y * w + x]) continue;
        for (const [ax, ay] of [[sx, sy], [sx, sy - 1], [0, sy]]) {
          const tx = x + ax, ty = y + ay;
          if (tx >= 0 && ty >= 0 && tx < w && ty < h && d[ty * w + tx]) continue;
          const px = x0 + tx, py = y0 + ty;
          if (px < 0 || py < 0 || px >= W || py >= this.h) continue;
          const i = (py * W + px) * 4;
          if (c[i + 3]) { c[i] *= dark; c[i + 1] *= dark * .98; c[i + 2] *= dark * 1.04; c[i + 3] = 254; }
        }
      }
      for (let i = 3; i < c.length; i += 4) if (c[i] === 254) c[i] = 255;
    }
    // Distance from the edge of this part, which becomes a rounded height field.
    const D = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) D[i] = d[i] ? 1e6 : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!D[i]) continue;
      const a = y ? D[i - w] + 1 : 1, b = x ? D[i - 1] + 1 : 1, e = (y && x) ? D[i - w - 1] + 1.41 : 1.41, f = (y && x < w - 1) ? D[i - w + 1] + 1.41 : 1.41;
      D[i] = Math.min(D[i], a, b, e, f);
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; if (!D[i]) continue;
      const a = y < h - 1 ? D[i + w] + 1 : 1, b = x < w - 1 ? D[i + 1] + 1 : 1, e = (y < h - 1 && x < w - 1) ? D[i + w + 1] + 1.41 : 1.41, f = (y < h - 1 && x) ? D[i + w - 1] + 1.41 : 1.41;
      D[i] = Math.min(D[i], a, b, e, f);
    }
    const R = o.round || m.round, H = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { const t = Math.min(D[i] / R, 1); H[i] = D[i] ? Math.sqrt(1 - (1 - t) * (1 - t)) * R : 0; }
    const tones = m.tones, N = tones.length - 1, gloss = o.gloss === undefined ? m.gloss : o.gloss, amb = o.ambient === undefined ? m.ambient : o.ambient;
    const dith = o.dither === undefined ? m.dither : o.dither, bias = o.bias || 0, expo = o.exposure || m.exposure || .85;
    let cx = 0, cy = 0, count = 0, ext = 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[y * w + x]) { cx += x; cy += y; count++; }
    cx /= count || 1; cy /= count || 1; ext = Math.sqrt(count) || 1;
    const grad = o.grad === undefined ? .22 : o.grad;
    const fn = o.fn;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      const hl = x ? H[i - 1] : 0, hr = x < w - 1 ? H[i + 1] : 0, hu = y ? H[i - w] : 0, hd = y < h - 1 ? H[i + w] : 0;
      let nx = (hl - hr) * .5, ny = (hu - hd) * .5, nz = 1;
      const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      let v = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      v = amb + (1 - amb) * v * expo;
      v += ((cx - x) * .52 + (cy - y) * .74) / ext * grad;
      if (gloss) {
        const sp = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]);
        v += Math.pow(sp, 14) * gloss;
        // Polished metal shows a dark band under its bright one.
        v -= Math.max(0, .9 - Math.abs(ny + .08) * 6) * gloss * .09;
      }
      v += bias;
      if (fn) v += fn(x0 + x - this.ox, y0 + y - this.oy, v) || 0;
      if (D[i] < 1.6 && o.edge !== 0) v -= .14;
      if (dith) v += BAYER[((y0 + y) & 3) * 4 + ((x0 + x) & 3)] * dith;
      const t = Math.max(0, Math.min(1, v)) * N, a = Math.round(t);
      const col = tones[a];
      const p = ((y0 + y) * W + x0 + x) * 4;
      c[p] = col[0]; c[p + 1] = col[1]; c[p + 2] = col[2]; c[p + 3] = 255;
    }
    return k;
  }
  dot(x, y, col) {
    const px = Math.round(this.ox + x), py = Math.round(this.oy + y);
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) return;
    const i = (py * this.w + px) * 4, v = rgb(col);
    this.c[i] = v[0]; this.c[i + 1] = v[1]; this.c[i + 2] = v[2]; this.c[i + 3] = 255;
  }
  // Fine line work. With onlyOpaque it only marks what is already painted, for engraving and folds.
  line(x0, y0, x1, y1, col, onlyOpaque = false) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      if (onlyOpaque && !this.opaqueAt(x, y)) continue;
      this.dot(x, y, col);
    }
  }
  path(pts, col, onlyOpaque = false) { for (let i = 1; i < pts.length; i++) this.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], col, onlyOpaque); }
  opaqueAt(x, y) {
    const px = Math.round(this.ox + x), py = Math.round(this.oy + y);
    return px >= 0 && py >= 0 && px < this.w && py < this.h && this.c[(py * this.w + px) * 4 + 3] > 0;
  }
  // Adds light: a bright core painted on the sprite, plus energy for the glow pass.
  glow(x, y, col, power = 1) {
    const px = Math.round(this.ox + x), py = Math.round(this.oy + y);
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) return;
    const i = py * this.w + px, v = rgb(col);
    this.e[i * 3] += v[0] * power; this.e[i * 3 + 1] += v[1] * power; this.e[i * 3 + 2] += v[2] * power;
  }
  glowLine(x0, y0, x1, y1, col, power = 1, core = null) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      this.glow(x, y, col, power);
      if (core) this.dot(x, y, core);
    }
  }
  glowPath(pts, col, power = 1, core = null) { for (let i = 1; i < pts.length; i++) this.glowLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], col, power, core); }
  // Weapon energy: stored as one strength channel, so the game can tint it by item grade.
  energy(x, y, power = 1) {
    const px = Math.round(this.ox + x), py = Math.round(this.oy + y);
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) return;
    this.t[py * this.w + px] += power;
  }
  energyLine(x0, y0, x1, y1, power = 1) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i++) this.energy(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, power);
  }
  // Ends the frame: a dark outline, then a coloured rim light on the side away from the key light.
  finish(o = {}) {
    const { w, h, c } = this, out = new Uint8ClampedArray(c);
    const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && c[(y * w + x) * 4 + 3] > 0;
    const rim = o.rim ? rgb(o.rim) : null, rimK = o.rimK === undefined ? .42 : o.rimK;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!c[i + 3]) {
        if (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1)) { out[i] = 11; out[i + 1] = 7; out[i + 2] = 16; out[i + 3] = 255; }
      } else if (rim && (!on(x + 1, y) || !on(x + 1, y + 1)) && on(x - 1, y)) {
        out[i] = c[i] + (rim[0] - c[i]) * rimK; out[i + 1] = c[i + 1] + (rim[1] - c[i + 1]) * rimK; out[i + 2] = c[i + 2] + (rim[2] - c[i + 2]) * rimK;
      }
    }
    this.c = out;
    return this;
  }
}

// ---------------------------------------------------------------- glow, trimming, sheets
// Spreads emitted light into a soft halo, stepped so it still reads as pixel art.
function halo(src, w, h, chan, radius) {
  let cur = src, tmp = new Float32Array(src.length);
  const r = radius;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let k = 0; k < chan; k++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += cur[(y * w + Math.max(0, Math.min(w - 1, x))) * chan + k];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * chan + k] = sum / (2 * r + 1);
        sum += cur[(y * w + Math.min(w - 1, x + r + 1)) * chan + k] - cur[(y * w + Math.max(0, x - r)) * chan + k];
      }
    }
    const next = new Float32Array(src.length);
    for (let x = 0; x < w; x++) for (let k = 0; k < chan; k++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[(Math.max(0, Math.min(h - 1, y)) * w + x) * chan + k];
      for (let y = 0; y < h; y++) {
        next[(y * w + x) * chan + k] = sum / (2 * r + 1);
        sum += tmp[(Math.min(h - 1, y + r + 1) * w + x) * chan + k] - tmp[(Math.max(0, y - r) * w + x) * chan + k];
      }
    }
    cur = next;
  }
  return cur;
}
const quant = v => Math.round(Math.min(255, v) / 24) * 24;
export function bakeGlow(f, radius = 3) {
  const { w, h, e, t } = f;
  let hasE = false, hasT = false;
  for (let i = 0; i < e.length; i++) if (e[i] > 0) { hasE = true; break; }
  for (let i = 0; i < t.length; i++) if (t[i] > 0) { hasT = true; break; }
  const toRgba = (core, soft, chan) => {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      for (let k = 0; k < 3; k++) {
        const a = chan === 3 ? core[i * 3 + k] : core[i], b = chan === 3 ? soft[i * 3 + k] : soft[i];
        out[i * 4 + k] = quant(Math.min(255, (chan === 3 ? a : a * 255) * .8 + (chan === 3 ? b : b * 255) * 1.25));
      }
      out[i * 4 + 3] = (out[i * 4] | out[i * 4 + 1] | out[i * 4 + 2]) ? 255 : 0;
    }
    return out;
  };
  f.glowRGBA = hasE ? toRgba(e, halo(e, w, h, 3, radius), 3) : null;
  f.tintRGBA = hasT ? toRgba(t, halo(t, w, h, 1, radius), 1) : null;
  return f;
}
export function trim(rgba, w, h, ox, oy) {
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  if (x1 < 0) return null;
  const tw = x1 - x0 + 1, th = y1 - y0 + 1, out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const s = ((y + y0) * w + x0) * 4;
    out.set(rgba.subarray(s, s + tw * 4), y * tw * 4);
  }
  return { w: tw, h: th, ax: ox - x0, ay: oy - y0, rgba: out };
}

const crcTable = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePNG(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 4 + 1);
    raw[o] = 1; // Sub filter
    for (let x = 0; x < w * 4; x++) raw[o + 1 + x] = (rgba[y * w * 4 + x] - (x >= 4 ? rgba[y * w * 4 + x - 4] : 0)) & 255;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// A contact sheet for checking art by eye, with light from the glow pass added in.
export function previewSheet(frames, path, { cols = 8, scale = 3, bg = [38, 42, 50], cell = null } = {}) {
  const cw = cell ? cell[0] : Math.max(...frames.map(f => f.w)), ch = cell ? cell[1] : Math.max(...frames.map(f => f.h));
  const rows = Math.ceil(frames.length / cols), W = cols * cw * scale, H = rows * ch * scale, out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = 255; }
  frames.forEach((f, n) => {
    const gx = (n % cols) * cw, gy = Math.floor(n / cols) * ch;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const i = (y * f.w + x) * 4, a = f.c[i + 3];
      let r = a ? f.c[i] : -1, g = a ? f.c[i + 1] : 0, b = a ? f.c[i + 2] : 0;
      const eR = f.glowRGBA ? f.glowRGBA[i] : 0, eG = f.glowRGBA ? f.glowRGBA[i + 1] : 0, eB = f.glowRGBA ? f.glowRGBA[i + 2] : 0;
      const tv = f.tintRGBA ? f.tintRGBA[i] / 255 : 0;
      const tint = f.tint || [190, 120, 255];
      if (r < 0 && !eR && !eG && !eB && !tv) continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const p = ((gy * scale + (y * scale) + sy) * W + gx * scale + x * scale + sx) * 4;
        if (p < 0 || p >= out.length) continue;
        const br = r < 0 ? out[p] : r, bgv = r < 0 ? out[p + 1] : g, bb = r < 0 ? out[p + 2] : b;
        out[p] = Math.min(255, br + eR + tint[0] * tv);
        out[p + 1] = Math.min(255, bgv + eG + tint[1] * tv);
        out[p + 2] = Math.min(255, bb + eB + tint[2] * tv);
      }
    }
  });
  writeFileSync(path, encodePNG(out, W, H));
}
