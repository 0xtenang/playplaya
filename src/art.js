// Small drawing helpers shared by the game: pixel numbers, and icons from the interface sprite sheet.
(function (root) {
'use strict';
const DIGITS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  k: '101110100110101', m: '101111101101101', '+': '000010111010000', '.': '000000000000010', '!': '010010010000010',
};

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = i => Math.max(0, Math.min(255, Math.round(((n >> i) & 255) * f)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
function drawRows(ctx, rows, x, y, map, flip) {
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.') continue;
      const col = map[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x + (flip ? row.length - 1 - i : i), y + j, 1, 1);
    }
  }
}
function drawNum(ctx, text, x, y, color) {
  let cx = x;
  ctx.fillStyle = color;
  for (const ch of String(text)) {
    const bits = DIGITS[ch];
    if (!bits) { cx += 2; continue; }
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (bits[j * 3 + i] === '1') ctx.fillRect(cx + i, y + j, 1, 1);
    cx += 4;
  }
}
const compactNum = v => v >= 1e6 ? (v / 1e6).toFixed(1).replace('.0', '') + 'm' : v >= 1e4 ? Math.round(v / 1e3) + 'k' : String(v);

// Chunky numbers with a dark edge, readable at a glance over a busy fight.
function drawNumBig(ctx, text, x, y, color, scale) {
  const s = scale || 2, str = String(text);
  const paint = (ox, oy, col) => {
    let cx = x;
    ctx.fillStyle = col;
    for (const ch of str) {
      const bits = DIGITS[ch];
      if (!bits) { cx += 2 * s; continue; }
      for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (bits[j * 3 + i] === '1') ctx.fillRect(cx + i * s + ox, y + j * s + oy, s, s);
      cx += 4 * s;
    }
  };
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) paint(ox, oy, '#1b1420');
  paint(0, 0, color);
}

// An icon from the interface sheet, as a span at a whole-number scale so pixels stay square.
function ic(name, scale = 2, cls = '') {
  const U = root.Sprites.ui(), f = U && U.clips[name];
  if (!f) return `<span class="ic ${cls}" style="width:${24 * scale}px;height:${24 * scale}px"></span>`;
  const [x, y, w, h] = f[0][0];
  return `<span class="ic ${cls}" style="width:${w * scale}px;height:${h * scale}px;background-position:${-x * scale}px ${-y * scale}px;background-size:${U.w * scale}px ${U.h * scale}px"></span>`;
}
root.Art = { drawNum, drawNumBig, compactNum, ic };
})(typeof window !== 'undefined' ? window : globalThis);
