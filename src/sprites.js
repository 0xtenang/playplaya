// Draws characters from sprite sheets made ahead of time by art/bake.mjs. A frame is up to
// three layers: its colour, its own light (added on top), and weapon energy tinted by grade.
(function (root) {
'use strict';
let M = null;
const groups = {}, loading = {};
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function loadImage(file) {
  const im = new Image();
  im.src = '/atlas/' + file;
  return (im.decode ? im.decode() : new Promise((res, rej) => { im.onload = res; im.onerror = rej; })).then(() => im);
}
function need(name) {
  if (!M || !M.groups[name]) return Promise.resolve(null);
  if (loading[name]) return loading[name];
  const G = M.groups[name];
  return (loading[name] = Promise.all([loadImage(G.files.main.file), G.files['-t'] ? loadImage(G.files['-t'].file) : null]).then(([main, tint]) => {
    groups[name] = { main, tint, clips: G.clips, white: null, tints: new Map() };
    // Hand the sheet to the graphics card now, so its first real use doesn't stall a frame.
    mk(1, 1).getContext('2d').drawImage(main, 0, 0, 1, 1);
    return groups[name];
  }).catch(() => { delete loading[name]; return null; }));
}
async function init() {
  const res = await fetch('/atlas/manifest.json');
  M = await res.json();
  const U = M.groups.ui;
  document.documentElement.style.setProperty('--ui-sheet', `url("/atlas/${U.files.main.file}")`);
  await need('heroes');
  api.ready = true;
}
function whiteOf(g) {
  if (g.white) return g.white;
  const c = mk(g.main.width, g.main.height), x = c.getContext('2d');
  x.drawImage(g.main, 0, 0);
  x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  return (g.white = c);
}
function tintOf(g, col) {
  if (!g.tint) return null;
  let c = g.tints.get(col);
  if (c) return c;
  c = mk(g.tint.width, g.tint.height);
  const x = c.getContext('2d');
  x.drawImage(g.tint, 0, 0);
  x.globalCompositeOperation = 'multiply'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in'; x.drawImage(g.tint, 0, 0);
  g.tints.set(col, c);
  return c;
}
function blit(ctx, img, r, x, y, dir) {
  if (dir < 0) {
    ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1);
    ctx.drawImage(img, r[0], r[1], r[2], r[3], -r[4], -r[5], r[2], r[3]);
    ctx.restore();
  } else ctx.drawImage(img, r[0], r[1], r[2], r[3], x - r[4], y - r[5], r[2], r[3]);
}
// Draws one frame with whichever layers it has. flash is 0 to 1, for the white hit blink.
function drawFrame(ctx, g, fr, x, y, dir, o) {
  o = o || {};
  x = Math.round(x); y = Math.round(y);
  const base = o.alpha === undefined ? 1 : o.alpha;
  ctx.globalAlpha = base;
  if (fr[0]) blit(ctx, g.main, fr[0], x, y, dir);
  if (o.flash && fr[0]) { ctx.globalAlpha = base * Math.min(1, o.flash); blit(ctx, whiteOf(g), fr[0], x, y, dir); ctx.globalAlpha = base; }
  if (fr[1] || (fr[2] && o.tint)) {
    ctx.globalCompositeOperation = 'lighter';
    if (fr[1]) blit(ctx, g.main, fr[1], x, y, dir);
    if (fr[2] && o.tint) { const t = tintOf(g, o.tint); if (t) blit(ctx, t, fr[2], x, y, dir); }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
}
const clipOf = (group, name) => { const g = groups[group]; return g && g.clips[name] ? g : null; };

// Attacks wind up, land, then recover. This keeps the art's strike on the moment the rules deal
// the damage, however fast the attack currently is.
function progress(at, ad, ai, impact) {
  if (!ad) return 0;
  if (at <= ai) return Math.max(0, at / Math.max(.001, ai)) * impact;
  return Math.min(1, impact + (at - ai) / Math.max(.001, ad - ai) * (1 - impact));
}
const IMPACT = { warden: { atk1: .46, atk2: .46, atk3: .48, cast: .6 }, fletcher: { atk1: .58, atk2: .58, cast: .64 }, hexer: { atk1: .5, atk2: .5, cast: .6 }, mender: { atk1: .46, atk2: .46, cast: .6 } };
const FOOT_CYCLE = 68; // pixels the ground slides past during one full run cycle

function heroFrame(key, o) {
  const a = o.anim, at = o.at;
  let clip = 'idle', i = 0;
  const G = groups.heroes;
  if (!G) return null;
  const len = n => G.clips[`${key}/${n}`].length;
  if (a === 'atk' || a === 'cast') {
    clip = a === 'cast' ? 'cast' : 'atk' + ((o.combo || 0) + 1);
    const n = len(clip), p = progress(at, o.ad || .5, o.ai || .24, IMPACT[key][clip]);
    i = Math.min(n - 1, Math.floor(p * n));
  } else if (a === 'run' || a === 'hop') {
    clip = 'run';
    const n = len(clip);
    i = a === 'hop' ? 3 : Math.floor(at * (o.speed || 76) / FOOT_CYCLE * n) % n;
  } else if (a === 'down') {
    clip = 'down';
    i = Math.min(len(clip) - 1, Math.floor(at * 14));
  } else if (o.hurt > 0) {
    clip = 'hurt';
    const n = len(clip);
    i = Math.min(n - 1, Math.floor((1 - o.hurt) * n));
  } else {
    clip = 'idle';
    i = Math.floor(at * 9) % len(clip);
  }
  return G.clips[`${key}/${clip}`][i];
}
function drawHero(ctx, key, x, y, o) {
  const fr = heroFrame(key, o);
  if (fr) drawFrame(ctx, groups.heroes, fr, x, y, o.dir, o);
}
const monClip = m => (m.boss ? 'boss' : `${m.shape}|${m.color}`);
const FLY_RATE = 1.3;
function monsterFrame(group, m, at) {
  const g = groups[group], name = monClip(m);
  if (!g || !g.clips[`${name}/walk`]) return null;
  if (m.a === 'atk') {
    const c = g.clips[`${name}/atk`], p = progress(at, m.ad || .5, m.ai || .26, m.boss ? .56 : .52);
    return c[Math.min(c.length - 1, Math.floor(p * c.length))];
  }
  const c = g.clips[`${name}/walk`];
  const rate = m.fly ? FLY_RATE : Math.max(.5, (m.spd || 20) * 2 / 44);
  return c[Math.floor(at * rate * c.length) % c.length];
}
function drawMonster(ctx, m, region, x, y, at, o) {
  const group = 'r' + region, fr = monsterFrame(group, m, at);
  if (fr) drawFrame(ctx, groups[group], fr, x, y, m.dir, o);
}
function drawCorpse(ctx, f, region, x, y, p, o) {
  const group = 'r' + region, g = groups[group];
  if (!g) return;
  const c = g.clips[`${f.boss ? 'boss' : f.shape + '|' + f.color}/die`];
  if (c) drawFrame(ctx, g, c[Math.min(c.length - 1, Math.floor(p * 1.4 * c.length))], x, y, f.dir, o);
}
function drawProp(ctx, name, i, x, y, dir) {
  const g = groups.heroes;
  const c = g && g.clips[name];
  if (c) drawFrame(ctx, g, c[i % c.length], x, y, dir || 1);
}
function scene(region) {
  const g = groups['r' + region];
  if (!g) return null;
  const r = g.clips.scene[0][0];
  return { img: g.main, r };
}
// How tall a creature stands, read from its art, so bars and numbers sit just above it.
function topOf(group, name) {
  const g = groups[group], c = g && g.clips[name];
  return c && c[0][0] ? c[0][0][5] : 60;
}
// The knight's sword stands far above its head, so bars stay at head height whatever a hero holds.
const heroTop = key => Math.min(94, topOf('heroes', `${key}/idle`));
const monTop = (m, region) => topOf('r' + region, `${monClip(m)}/walk`);
const defaultTint = key => { const t = M && M.tint[key]; return t ? `rgb(${t[0]},${t[1]},${t[2]})` : null; };

const api = { ready: false, init, need, has: name => !!groups[name], drawHero, drawMonster, drawCorpse, drawProp, scene, heroTop, monTop, defaultTint, clipOf, ui: () => { if (!M) return null; const U = M.groups.ui; return { clips: U.clips, w: U.files.main.w, h: U.files.main.h, mapNodes: U.mapNodes, runeIcon: U.runeIcon, runeCol: U.runeCol }; } };
root.Sprites = api;
})(window);
