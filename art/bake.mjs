// Renders every sprite ahead of time and packs them into PNG sheets, one for the heroes and
// props and one per region, so the browser only draws finished pictures during a fight.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { bakeGlow, encodePNG, trim } from './raster.mjs';
import { renderHeroFrame, CLIPS, FRAME, HEROES } from './heroes.mjs';
import { renderMonsterFrame, renderBossFrame, MON_CLIPS, MON_FRAME, BOSS_CLIPS, BOSS_FRAME, BOSS_KEYS } from './monsters.mjs';
import { renderScene, renderGate, renderCart, GATE_FRAME, GATE_FRAMES, CART_FRAME, CART_LEVELS, SCENE } from './scenes.mjs';
import { ITEM_ART, ICON, MOTIFS, renderEmblem, renderBust, renderGem, renderSeal, renderChest, renderCoin, renderMark, BUST } from './items.mjs';
import { uiStyles, renderMap, MAP, MAP_NODES } from './ui.mjs';

const SHEET_W = 2048;
const here = u => new URL(u, import.meta.url);

function regionTable() {
  const require = createRequire(import.meta.url);
  require('../src/engine.js');
  return globalThis.TF.REGIONS;
}
// One packed sheet. Frames are placed tallest first in rows, which wastes very little.
function pack(items) {
  const order = items.map((it, i) => i).sort((a, b) => items[b].h - items[a].h || items[b].w - items[a].w);
  let x = 0, y = 0, row = 0;
  for (const i of order) {
    const it = items[i];
    if (x + it.w > SHEET_W) { x = 0; y += row; row = 0; }
    it.x = x; it.y = y; x += it.w; row = Math.max(row, it.h);
  }
  const H = y + row, W = H ? SHEET_W : 1, buf = new Uint8ClampedArray(W * Math.max(1, H) * 4);
  for (const it of items) for (let j = 0; j < it.h; j++) buf.set(it.rgba.subarray(j * it.w * 4, (j + 1) * it.w * 4), ((it.y + j) * W + it.x) * 4);
  return { png: encodePNG(buf, W, Math.max(1, H)), w: W, h: Math.max(1, H) };
}
class Sheet {
  constructor() { this.main = []; this.tint = []; this.clips = {}; }
  add(clip, f, spec) {
    bakeGlow(f);
    const ref = (rgba, list) => {
      if (!rgba) return 0;
      const t = trim(rgba, spec.w, spec.h, spec.ox, spec.oy);
      if (!t) return 0;
      list.push(t);
      return t;
    };
    (this.clips[clip] = this.clips[clip] || []).push({ c: ref(f.c, this.main), g: ref(f.glowRGBA, this.main), t: ref(f.tintRGBA, this.tint) });
  }
  addRaw(clip, rgba, w, h) {
    const t = { w, h, ax: 0, ay: 0, rgba };
    this.main.push(t);
    (this.clips[clip] = this.clips[clip] || []).push({ c: t, g: 0, t: 0 });
  }
  write(name, dir) {
    const out = { clips: {}, files: {} };
    const save = (items, suffix) => {
      if (!items.length) return;
      const p = pack(items), id = createHash('sha256').update(p.png).digest('hex').slice(0, 10), file = `${name}${suffix}.${id}.png`;
      writeFileSync(new URL(file, dir), p.png);
      out.files[suffix || 'main'] = { file, w: p.w, h: p.h, bytes: p.png.length };
    };
    save(this.main, ''); save(this.tint, '-t');
    const q = r => (r ? [r.x, r.y, r.w, r.h, r.ax, r.ay] : 0);
    for (const [k, frames] of Object.entries(this.clips)) out.clips[k] = frames.map(f => [q(f.c), q(f.g), q(f.t)]);
    return out;
  }
}
// Interface art needs no anchors or extra light layers, so glow is folded into the colour.
function flat(f) {
  bakeGlow(f);
  const out = new Uint8ClampedArray(f.c);
  if (f.glowRGBA) for (let i = 0; i < out.length; i += 4) {
    const g = f.glowRGBA, a = g[i] | g[i + 1] | g[i + 2];
    if (!a) continue;
    if (!out[i + 3]) { out[i] = g[i]; out[i + 1] = g[i + 1]; out[i + 2] = g[i + 2]; out[i + 3] = Math.min(255, Math.max(g[i], g[i + 1], g[i + 2]) * 1.4); }
    else for (let k = 0; k < 3; k++) out[i + k] = Math.min(255, out[i + k] + g[i + k] * .7);
  }
  return out;
}
const NAV_ICONS = [['fist', 'red'], ['chest', 'gold'], ['cross', 'red'], ['star', 'violet'], ['anvil', 'steel'], ['burst', 'blue'], ['coin', 'gold'], ['book', 'teal']];
const RUNE_COL = { Crew: 'red', Income: 'gold', Chests: 'blue' };
const RUNE_ICON = { slot: 'fist', might: 'sword', grit: 'shield', coin: 'coin', xp: 'book', salvage: 'anvil', offline: 'clock', cadence: 'eye', cap: 'chest', auto: 'bolt', pack: 'bag' };
function bakeUi(dir) {
  const S = new Sheet(), T = (regionTable(), globalThis.TF);
  const add = (name, f) => S.addRaw(name, flat(f), f.w, f.h);
  for (const [slot, draw] of Object.entries(ITEM_ART)) for (let band = 0; band < 8; band++) add(`item/${slot}/${band}`, draw(band));
  for (let t = 0; t < 3; t++) add(`gem/${t}`, renderGem(t));
  add('seal', renderSeal()); add('chest', renderChest(false)); add('coin', renderCoin()); add('mark', renderMark());
  for (const k of Object.keys(HEROES)) add(`bust/${k}`, renderBust(k));
  const seen = new Set();
  const emblem = (icon, col, shape) => { const key = `em/${icon}/${col}/${shape}`; if (!seen.has(key)) { seen.add(key); add(key, renderEmblem(icon, col, shape)); } return key; };
  for (const list of Object.values(T.SKILLS)) for (const s of list) emblem(s.icon, s.col, s.act ? 'hex' : 'round');
  for (const t of T.TALENTS) emblem(RUNE_ICON[t.k], RUNE_COL[t.group], 'square');
  for (const [icon, col] of NAV_ICONS) emblem(icon, col, 'round');
  for (let r = 0; r < 5; r++) S.addRaw(`map/${r}`, renderMap(r), MAP.w, MAP.h);
  const out = S.write('ui', dir);
  writeFileSync(new URL('ui.css', dir), uiStyles());
  out.runeIcon = RUNE_ICON; out.runeCol = RUNE_COL; out.mapNodes = MAP_NODES; out.mapSize = MAP; out.icon = ICON; out.bust = BUST;
  void MOTIFS;
  return out;
}
function bakeGroup(group, dir) {
  if (group === 'ui') return bakeUi(dir);
  const S = new Sheet(), R = regionTable();
  if (group === 'heroes') {
    for (const key of Object.keys(HEROES)) for (const [clip, n] of Object.entries(CLIPS)) {
      // Everyone has two attacks to alternate. Only the Warden has a third, for the charge.
      if (key !== 'warden' && clip === 'atk3') continue;
      for (let i = 0; i < n; i++) S.add(`${key}/${clip}`, renderHeroFrame(key, clip, i), FRAME);
    }
    for (const boss of [0, 1]) for (let i = 0; i < GATE_FRAMES; i++) S.add(`gate/${boss}`, renderGate(i, !!boss), GATE_FRAME);
    for (let i = 0; i < CART_LEVELS; i++) S.add('cart', renderCart(i), CART_FRAME);
  } else {
    const r = +group.slice(1), reg = R[r];
    S.addRaw('scene', renderScene(r), SCENE.w, SCENE.h);
    reg.shapes.forEach((shape, t) => {
      for (const [clip, n] of Object.entries(MON_CLIPS)) for (let i = 0; i < n; i++) S.add(`${shape}|${reg.pal[t]}/${clip}`, renderMonsterFrame(shape, reg.pal[t], clip, i), MON_FRAME);
    });
    for (const [clip, n] of Object.entries(BOSS_CLIPS)) for (let i = 0; i < n; i++) S.add(`boss/${clip}`, renderBossFrame(BOSS_KEYS[r], clip, i), BOSS_FRAME);
  }
  return S.write(group, dir);
}
if (!isMainThread) {
  parentPort.postMessage(bakeGroup(workerData.group, new URL(workerData.dir)));
}
export async function bakeAll(outDir) {
  const sources = readdirSync(here('./')).filter(f => f.endsWith('.mjs')).sort().map(f => readFileSync(here(f)));
  const engine = readFileSync(here('../src/engine.js'), 'utf8');
  const palette = engine.slice(engine.indexOf('const REGIONS'), engine.indexOf('const MON_KINDS')) + engine.slice(engine.indexOf('const TALENTS'), engine.indexOf('const SIGNATURE'));
  const hash = createHash('sha256').update(Buffer.concat(sources)).update(palette).digest('hex').slice(0, 16);
  const mf = new URL('manifest.json', outDir), stamp = new URL('.hash', outDir);
  if (existsSync(mf) && existsSync(stamp) && readFileSync(stamp, 'utf8') === hash) return { hash, cached: true };
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const groups = ['ui', 'heroes', 'r0', 'r1', 'r2', 'r3', 'r4'];
  const results = await Promise.all(groups.map(group => new Promise((res, rej) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { group, dir: outDir.href } });
    w.once('message', res); w.once('error', rej);
  })));
  const manifest = { hash, groups: {} };
  groups.forEach((g, i) => { manifest.groups[g] = results[i]; });
  manifest.frames = { hero: FRAME, mon: MON_FRAME, boss: BOSS_FRAME };
  manifest.tint = Object.fromEntries(Object.entries(HEROES).map(([k, h]) => [k, h.tint]));
  writeFileSync(mf, JSON.stringify(manifest));
  writeFileSync(stamp, hash);
  return { hash, cached: false };
}
