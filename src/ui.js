// DungeonDragons client. The server owns the game: this file sends intents, draws the
// snapshots it gets back, and replays the fight locally between syncs so it stays smooth.
(function () {
'use strict';
const T = window.TF, A = window.Art, S_ = window.Sprites;
const { GRADES, SLOTS, SLOT_LABEL, MATS, HEROES, HERO_KEYS, CFG, HOUR } = T;
const SYNC_MS = 10e3, MARKET_MS = 10e3, BOARD_MS = 30e3;
const BUILD = (document.querySelector('meta[name="tf-build"]') || {}).content;

let G = null, B = null;
const ui = { left: 'pack', right: 'portal', wide: null, focus: 'hero', hero: null, heroView: 'gear', skill: null, rune: null, sel: null, gradeF: -1, slotF: '', equipFor: null, listing: null, dirty: true, pressing: false, mkGrade: -1, mkSlot: '', mkQuery: '', mkSort: 'asc', fuseG: 0, fuseSlot: '', lastFuse: null, peerKeys: {} };
const Net = { account: null, offset: 0, offline: false, peers: new Map(), board: [], lastSync: 0, lastMarket: 0, lastBoard: 0, syncing: false, queue: Promise.resolve() };
const serverNow = () => Date.now() + Net.offset;

// ---------------------------------------------------------------- small helpers
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('en-US');
const shortNum = n => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : fmt(n);
function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return Math.floor(s / 3600) + 'h ' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + 'm';
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function ago(t) {
  const m = Math.floor((serverNow() - t) / T.MIN);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  if (m < 1440) return Math.floor(m / 60) + ' h ago';
  return Math.floor(m / 1440) + ' d ago';
}
const gem = (g) => `<span class="gemdot" style="background:${GRADES[g].c}" aria-hidden="true"></span>`;
const itemIcon = (s, g, band, scale) => A.ic(`item/${s}/${band || 0}`, scale || 2);
const matIcon = (key, scale) => A.ic(key === 'seal' ? 'seal' : 'gem/' + (+key.slice(3) - 1), scale || 1);
function statLines(st) {
  const out = [];
  if (st.atk) out.push(['Attack', '+' + fmt(st.atk)]);
  if (st.hp) out.push(['Health', '+' + fmt(st.hp)]);
  if (st.armor) out.push(['Armor', '+' + fmt(st.armor)]);
  for (const a of T.AFFIXES) if (st[a.k]) out.push([a.n, '+' + st[a.k].toFixed(1) + '%']);
  return out;
}
function touch() { ui.dirty = true; }
function say(text, kind, color) {
  const f = $('feed');
  const el = document.createElement('div');
  el.className = 'find ' + (kind || '');
  el.textContent = text;
  if (color) el.style.setProperty('--c', color);
  f.prepend(el);
  while (f.children.length > 4) f.lastChild.remove();
  setTimeout(() => el.remove(), kind === 'big' ? 9000 : 5500);
}

// ---------------------------------------------------------------- server link
async function api(path, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    Net.offline = true;
    throw { network: true, message: 'Cannot reach the server. Check your connection.' };
  }
  Net.offline = false;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, code: data.code, message: data.error || 'Something went wrong.' };
  return data;
}
function apiError(e) {
  if (e && e.code === 'no_session') return showGate(Net.walletRequired ? 'Your session has ended. Connect your wallet to play.' : 'Your session has ended. Log in again, or start a new crew.');
  if (e && e.code === 'banned') return showGate(e.message);
  say((e && e.message) || 'Something went wrong.', 'warn');
}
// Takes a server snapshot as the truth, then replays up to the present moment.
function adopt(s, sentAt) {
  if (s.build && BUILD && s.build !== BUILD) {
    let tried = null;
    try { tried = sessionStorage.getItem('tf.reload'); sessionStorage.setItem('tf.reload', s.build); } catch (e) { /* storage is optional */ }
    if (tried !== s.build) { location.reload(); return; }
  }
  if (sentAt) Net.offset = s.now - (sentAt + Date.now()) / 2;
  const fx = B ? B.fx : [];
  G = s.G; B = s.B;
  B.preview = true; B.fx = fx;
  Net.account = s.account;
  Net.heroPrice = s.heroPrice;
  let behind = Math.min(5, Math.max(0, (serverNow() - s.simAt) / 1000));
  acc = 0; stopT = 0; stopDebt = 0;
  while (behind >= .1) { T.step(G, B, .1, s.simAt); behind -= .1; }
  acc = behind;
  lastT = performance.now();
  for (const e of s.events || []) serverEvent(e);
  // A crew with no wallet can't continue until it connects one. Connecting keeps the crew.
  if (Net.walletRequired && !Object.keys(s.account.wallets || {}).length) showGate('Connect a wallet to keep this crew and keep playing.');
  else $('gate').hidden = true;
  touch();
  updateHud();
}
function send(type, args, onOk) {
  Net.queue = Net.queue.then(async () => {
    const sentAt = Date.now();
    try {
      const s = await api('/api/action', { type, args: args || {} });
      Net.lastSync = Date.now();
      adopt(s, sentAt);
      const msg = onOk && onOk(s.result);
      if (msg) say(msg);
      maybeRender();
    } catch (e) { apiError(e); }
  });
  return Net.queue;
}
function syncNow() {
  if (Net.syncing) return;
  Net.syncing = true;
  Net.lastSync = Date.now();
  Net.queue = Net.queue.then(async () => {
    const sentAt = Date.now();
    try { adopt(await api('/api/sync', {}), sentAt); }
    catch (e) { if (!e.network && e.code !== 'rate_limited') apiError(e); }
    Net.syncing = false;
  });
}
async function pollMarket() {
  Net.lastMarket = Date.now();
  try {
    const m = await api('/api/market');
    Net.peers = new Map(m.listings.map(l => [l.id, l]));
    ui.peerKeys = m.counts;
    if (isOpen('exchange')) touch();
  } catch (e) { /* the next poll tries again */ }
}
async function pollBoard() {
  Net.lastBoard = Date.now();
  try { Net.board = (await api('/api/board')).board; if (isOpen('ledger')) touch(); } catch (e) { /* the next poll tries again */ }
}
function tickNet() {
  if (!G) return;
  const t = Date.now();
  if (t - Net.lastSync >= SYNC_MS) syncNow();
  if (t - Net.lastMarket >= (isOpen('exchange') ? MARKET_MS : 3 * MARKET_MS)) pollMarket();
  if (isOpen('ledger') && t - Net.lastBoard >= BOARD_MS) pollBoard();
  if (isOpen('wallet') && ui.w && !ui.w.busy && t - ui.w.lastRead >= 10e3) refreshWallet();
}
function showGate(message) {
  $('gateMsg').textContent = message;
  $('gate').hidden = false;
  $('gateNewBtn').hidden = !!Net.walletRequired;
  renderGateWallets();
}
// Wallets announce themselves a moment after the page loads, so this redraws as they appear.
function renderGateWallets() {
  const list = $('gateWallets'), on = !!Net.walletRequired;
  list.hidden = !on; $('gateNote').hidden = !on;
  if (!on) return;
  const found = Wallet.list();
  const missing = Wallet.INSTALL.filter(i => !found.some(w => w.id === i.id || (w.kind === 'evm' && w.name === i.name)));
  list.innerHTML = `<span class="minihead wide">Connect a wallet</span>${found.map(w => `<button class="walletrow" data-act="gateConnect" data-id="${esc(w.id)}">${w.icon ? `<img src="${esc(w.icon)}" alt="" width="28" height="28">` : `<span class="noicon">${esc(w.name[0])}</span>`}<b>${esc(w.name)}</b><span class="sub">Connect</span></button>`).join('')}${missing.map(i => `<a class="walletrow get" href="${i.url}" target="_blank" rel="noopener noreferrer"><span class="noicon">${esc(i.name[0])}</span><b>${esc(i.name)}</b><span class="sub">Not found. Get it</span></a>`).join('')}`;
}
async function auth(path, body) {
  const sentAt = Date.now();
  const s = await api(path, body);
  Net.lastSync = Date.now();
  adopt(s, sentAt);
  try { localStorage.removeItem('tf.loggedOut'); } catch (e) { /* storage is optional */ }
  pollMarket(); pollBoard();
  return s;
}

// ---------------------------------------------------------------- arena renderer
// The rules run ten times a second in units half a screen pixel wide. Everything drawn here
// runs on the display's own clock instead, so motion stays smooth between rule steps.
const cv = () => $('strip');
const STRIP_W = 640, STRIP_H = 200, GY = 170, SX = 2;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
let ctx, beams = [], frameNo = 0, clockT = 0, shakeA = 0, stopT = 0, stopDebt = 0;
const vis = new Map();
const SHADOW = { goblin: 38, slime: 46, bat: 26, ratman: 40, scorpion: 76, skeleton: 38, zombie: 40, wolf: 66, golem: 62, orc: 64, imp: 24, boss: 130 };
const AURA = { warden: ['#8a3cff', '#c84aff'], fletcher: ['#3cc8a0', '#a0e8c0'], hexer: ['#ff4ad8', '#ff9a4a'], mender: ['#ffd877', '#fff0b0'] };
const REGION_FX = [
  { col: ['#8cff9a', '#3cc878'], up: -7, drift: 4, add: 1, rate: 3, fog: '#4a8a70', dust: '#5e7a50' },
  { col: ['#e8a860', '#c87838'], up: -2, drift: 26, add: 0, rate: 9, fog: '#c07838', dust: '#a0683a' },
  { col: ['#c89aff', '#7a4ac8'], up: -5, drift: 5, add: 1, rate: 4, fog: '#6a4a8a', dust: '#54405c' },
  { col: ['#e4fbff', '#a0e0f0'], up: 9, drift: 9, add: 0, rate: 10, fog: '#a0d0e4', dust: '#a8d0dc' },
  { col: ['#ffb04a', '#ff5a1c'], up: -22, drift: 7, add: 1, rate: 12, fog: '#a03a1c', dust: '#54342a' },
];
function sizeStrip() {
  const c = cv();
  if (c.width !== STRIP_W) { c.width = STRIP_W; c.height = STRIP_H; }
  ctx = c.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
}
const lerp = (o, k) => o.px === undefined ? o.x : o.px + (o.x - o.px) * k;
const ease = p => 1 - (1 - p) * (1 - p) * (1 - p);
const seedOf = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };

// -------- particles: small squares that carry most of the sense of impact
const parts = [];
function spawn(x, y, vx, vy, life, col, o) {
  if (parts.length >= 260) parts.shift();
  parts.push({ x, y, vx, vy, life, age: 0, col, size: (o && o.size) || 1, g: (o && o.g) || 0, add: !!(o && o.add), drag: (o && o.drag) || 0 });
}
function burstOf(n, x, y, speed, life, cols, o) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, v = speed * (.35 + Math.random() * .65);
    spawn(x, y, Math.cos(a) * v, Math.sin(a) * v * .75, life * (.6 + Math.random() * .6), cols[i % cols.length], o);
  }
}
function stepParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age += dt;
    if (p.age >= p.life) { parts.splice(i, 1); continue; }
    p.vy += p.g * dt;
    if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
}
function drawParts(add) {
  for (const p of parts) {
    if (p.add !== add) continue;
    const k = 1 - p.age / p.life;
    ctx.globalAlpha = Math.min(1, k * 2);
    ctx.fillStyle = p.col;
    const s = Math.max(1, Math.round(p.size * (.5 + k * .5)));
    ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
  }
  ctx.globalAlpha = 1;
}
function kick(a) { if (!REDUCED.matches) shakeA = Math.max(shakeA, a); }
function hitStop(t) { if (!REDUCED.matches) stopT = Math.max(stopT, t); }
// The first time an effect appears, it also throws sparks, shakes the view or holds the frame.
const FX_SOUND = { spark: f => (f.big ? 'crit' : 'hit'), slash: f => (f.big ? 'crit' : 'slash'), claw: () => 'claw', arrow: () => 'arrow', bolt: () => 'bolt', orb: () => 'orb', beam: () => 'bolt', burst: f => (f.big ? 'boom' : 'orb'), shock: () => 'boom', meteor: () => 'boom', column: () => 'boom', heal: () => 'heal', corpse: f => (f.boss ? 'fall' : null), warn: f => (f.fire ? 'roar' : null), breath: () => 'breath' };
function onFx(f) {
  const x = f.x * SX, none = REDUCED.matches;
  const sound = FX_SOUND[f.t] && FX_SOUND[f.t](f);
  if (sound) Sound.fx(sound, x / STRIP_W * 1.4 - .7);
  if (f.t === 'spark') {
    if (!none) burstOf(f.big ? 16 : 7, x, GY - 46, f.big ? 170 : 110, .32, f.big ? ['#fff', '#ffe27a', '#ffb04a'] : ['#fff', '#ffe9b0'], { add: true, g: 240, drag: 3, size: f.big ? 3 : 2 });
    if (f.big) { hitStop(.05); kick(2); }
  } else if (f.t === 'slash') { if (f.big) { hitStop(.07); kick(3); } }
  else if (f.t === 'corpse') {
    if (!none) {
      for (let i = 0; i < (f.boss ? 44 : 10); i++) spawn(x + (Math.random() - .5) * (f.boss ? 120 : 30), GY - Math.random() * (f.boss ? 90 : 40), (Math.random() - .5) * 14, -24 - Math.random() * 42, .8 + Math.random() * .8, i % 2 ? '#c8a4ff' : '#7ae8ff', { add: true, size: 2, drag: .4 });
      burstOf(f.boss ? 30 : 8, x, GY - 3, 90, .4, [REGION_FX[B.info.r].dust], { g: 120, drag: 4, size: 3 });
    }
    if (f.boss) { hitStop(.22); kick(7); } else hitStop(.025);
  } else if (f.t === 'breath') {
    if (!none) for (let i = 0; i < 46; i++) spawn(x + f.dir * (40 + Math.random() * 230), GY - Math.random() * 30, f.dir * (10 + Math.random() * 60), -30 - Math.random() * 110, .5 + Math.random() * .5, i % 3 ? '#ff7a2c' : '#ffd46a', { add: true, size: 2, g: 40 });
    hitStop(.06); kick(7);
  } else if (f.t === 'shock') {
    if (!none) for (let i = 0; i < 40; i++) spawn(x + (Math.random() - .5) * 60, GY, (Math.random() - .5) * 300, -60 - Math.random() * 170, .6, i % 3 ? REGION_FX[B.info.r].dust : '#ffe0a0', { g: 420, size: 3 });
    hitStop(.08); kick(7);
  } else if (f.t === 'burst') {
    if (!none) burstOf(f.big ? 34 : 12, x, GY - 24, f.big ? 210 : 120, .46, f.holy ? ['#fff0a8', '#fff'] : ['#d09aff', '#ff6ad8', '#fff'], { add: true, drag: 2.4, size: 2 });
    if (f.big) { hitStop(.06); kick(4); }
  } else if (f.t === 'column' || f.t === 'beam') { kick(2);
  } else if (f.t === 'heal') {
    if (!none) for (let i = 0; i < 9; i++) spawn(x + (Math.random() - .5) * 34, GY - Math.random() * 16, 0, -32 - Math.random() * 34, .7, i % 2 ? '#8df08a' : '#e4ffd8', { add: true, size: 2 });
  } else if (f.t === 'claw') {
    if (!none) burstOf(6, x, GY - 48, 90, .24, ['#ff6a5a', '#ffd0c0'], { add: true, g: 200, size: 2 });
    kick(1.2);
  }
}

// -------- ground fog: two strips of soft noise sliding past each other
const fogCache = {};
function fogStrip(r) {
  if (fogCache[r]) return fogCache[r];
  const W = STRIP_W, H = 56, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d'), im = g.createImageData(W, H), col = REGION_FX[r].fog, v = parseInt(col.slice(1), 16), n = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const wrap = (a, m) => ((a % m) + m) % m;
  const val = (x, y, s, per) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, w = y - yi, q = (a, b) => seedOf(wrap(a, per) + s, b + s * 3);
    const sm = t => t * t * (3 - 2 * t), su = sm(u), sw = sm(w);
    return (q(xi, yi) * (1 - su) + q(xi + 1, yi) * su) * (1 - sw) + (q(xi, yi + 1) * (1 - su) + q(xi + 1, yi + 1) * su) * sw;
  };
  const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = val(x / 40, y / 11, 3, 16) * .65 + val(x / 16, y / 6, 8, 40) * .35, edge = Math.sin(y / H * Math.PI);
    const level = a * edge * 1.5 + (BAY[(y & 3) * 4 + (x & 3)] / 16 - .5) * .14, i = (y * W + x) * 4;
    const step = Math.max(0, Math.min(3, Math.floor(level * 4 - .4)));
    im.data[i] = n[0]; im.data[i + 1] = n[1]; im.data[i + 2] = n[2]; im.data[i + 3] = step * 15;
  }
  g.putImageData(im, 0, 0);
  return (fogCache[r] = c);
}
function drawFog(r, y, speed, alpha) {
  const f = fogStrip(r), off = ((clockT * speed) % STRIP_W + STRIP_W) % STRIP_W;
  ctx.globalAlpha = alpha;
  ctx.drawImage(f, Math.round(off) - STRIP_W, y);
  ctx.drawImage(f, Math.round(off), y);
  ctx.globalAlpha = 1;
}

// -------- health bars
function bar(x, y, w, frac, ghost, color) {
  const h = 4;
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = '#0b0710'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#2b1f2e'; ctx.fillRect(x, y, w, h);
  if (ghost > frac) { ctx.fillStyle = '#ffe9c0'; ctx.fillRect(x, y, Math.round(w * Math.min(1, ghost)), h); }
  const fw = Math.max(0, Math.round(w * Math.min(1, frac)));
  ctx.fillStyle = color; ctx.fillRect(x, y, fw, h);
  ctx.fillStyle = 'rgba(255,255,255,.34)'; ctx.fillRect(x, y, fw, 1);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x, y + h - 1, fw, 1);
}
function shadow(x, y, w, alpha) {
  const px = Math.round(x), hw = Math.round(w / 2), a = alpha === undefined ? .5 : alpha;
  ctx.fillStyle = `rgba(4,2,10,${a})`;
  ctx.fillRect(px - hw + 4, y - 2, hw * 2 - 8, 1);
  ctx.fillRect(px - hw + 1, y - 1, hw * 2 - 2, 1);
  ctx.fillRect(px - hw, y, hw * 2, 2);
  ctx.fillRect(px - hw + 1, y + 2, hw * 2 - 2, 1);
  ctx.fillRect(px - hw + 4, y + 3, hw * 2 - 8, 1);
}
function drawCoin(x, y) {
  const m = ['.GGG.', 'GYYYG', 'GYWYG', 'GYYYG', '.GGG.'], map = { G: '#a8791f', Y: '#f4c94e', W: '#fff6c8' };
  m.forEach((row, j) => { for (let i = 0; i < 5; i++) if (map[row[i]]) { ctx.fillStyle = map[row[i]]; ctx.fillRect(x + i * 2, y + j * 2, 2, 2); } });
}
function drawSlash(f, p) {
  const big = f.big ? 1.5 : 1, r = 34 * big, cx = f.x * SX - f.dir * 6, cy = GY - 44;
  const head = Math.min(1, p * 2.8), tail = Math.max(0, p * 1.9 - .6);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = p < .5 ? '#ffffff' : '#d8e4ff';
  for (let i = 0; i <= 70; i++) {
    const t = i / 70;
    if (t > head || t < tail) continue;
    const a = -1.75 + t * 2.9, w = (1 - Math.abs(t - .55) * 1.8) * 11 * big;
    for (let q = 0; q < w; q += 1.4) ctx.fillRect(Math.round(cx + f.dir * Math.cos(a) * (r - q)), Math.round(cy + Math.sin(a) * (r - q) * 1.08), 2, 2);
  }
  ctx.globalCompositeOperation = 'source-over';
}
function orbAt(x, y, c, core, r) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = c; ctx.globalAlpha = .4; ctx.fillRect(x - r - 2, y - r + 1, r * 2 + 5, r * 2 - 1); ctx.fillRect(x - r + 1, y - r - 2, r * 2 - 1, r * 2 + 5);
  ctx.globalAlpha = 1; ctx.fillRect(x - r + 1, y - r + 1, r * 2 - 1, r * 2 - 1);
  ctx.fillStyle = core; ctx.fillRect(x - 1, y - 1, 3, 3);
  ctx.globalCompositeOperation = 'source-over';
}
function drawFx(f, region) {
  const p = Math.min(1, (f.age + acc) / f.life);
  if (f.t === 'num') {
    const jitter = (seedOf(f.v, f.x) - .5) * 26, rise = ease(p) * 26, x0 = f.x * SX + jitter;
    const y = Math.round(GY - 78 - rise + (f.hurt ? 16 : 0));
    const col = f.hurt ? '#ff8a7a' : f.crit ? '#ffd84a' : '#ffffff', txt = A.compactNum(f.v);
    const pop = p < .14 ? 1 : 0, s = (f.crit ? 4 : 3) + pop;
    ctx.globalAlpha = p > .72 ? (1 - p) / .28 : 1;
    A.drawNumBig(ctx, txt, Math.round(x0 - txt.length * 2 * s + s / 2), y, col, s);
    ctx.globalAlpha = 1;
  } else if (f.t === 'coin') {
    const y = Math.round(GY - 34 - ease(p) * 20);
    ctx.globalAlpha = p > .7 ? (1 - p) / .3 : 1;
    drawCoin(Math.round(f.x * SX) - 16, y);
    A.drawNumBig(ctx, A.compactNum(f.v), Math.round(f.x * SX) - 2, y - 2, '#ffe07a', 2);
    ctx.globalAlpha = 1;
  } else if (f.t === 'spark') {
    const n = Math.round((f.big ? 22 : 13) * (1 - p)), cx = Math.round(f.x * SX), cy = GY - 46;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - n, cy, n * 2 + 1, 2); ctx.fillRect(cx, cy - n, 2, n * 2 + 1);
    const q = Math.round(4 * (1 - p)) + 1; ctx.fillRect(cx - q, cy - q, q * 2 + 2, q * 2 + 2);
    ctx.globalCompositeOperation = 'source-over';
  } else if (f.t === 'slash') {
    drawSlash(f, p);
  } else if (f.t === 'arrow') {
    const x = (f.from + (f.x - f.from) * p) * SX, dir = f.x >= f.from ? 1 : -1, y = GY - 41, X = Math.round(x);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(159,232,128,.55)'; ctx.fillRect(dir > 0 ? X - 40 : X, y, 40, 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#e8dfc8'; ctx.fillRect(dir > 0 ? X - 20 : X, y, 20, 1);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(X - 1, y - 1, 3, 3);
    ctx.fillStyle = '#a0e8c0'; ctx.fillRect(X - dir * 20 - 1, y - 1, 3, 3);
  } else if (f.t === 'bolt' || f.t === 'orb') {
    const bolt = f.t === 'bolt', x = Math.round((f.from + (f.x - f.from) * p) * SX), y = GY - (bolt ? 64 - p * 22 : 46 - p * 8);
    orbAt(x, Math.round(y), bolt ? '#c040ff' : '#ff6a1c', bolt ? '#fff' : '#ffe9a0', f.big ? 7 : 5);
    if (!REDUCED.matches) spawn(x, y + (Math.random() - .5) * 8, (Math.random() - .5) * 20, (Math.random() - .5) * 20, .28, bolt ? '#ff6ad8' : '#ffb04a', { add: true, size: 2 });
  } else if (f.t === 'burst') {
    const r = f.r * SX * (.3 + ease(p) * .8), cx = Math.round(f.x * SX), cy = GY - 12, col = f.holy ? '#fff0a8' : f.fire ? '#ff8a3c' : '#bb82ec';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (1 - p) * .28; ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(cx, cy, r, r * .42, 0, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1 - p * .7;
    for (let a = 0; a < 60; a++) { const q = a / 60 * 6.283; ctx.fillRect(cx + Math.round(Math.cos(q) * r), cy + Math.round(Math.sin(q) * r * .42), 3, 2); }
    ctx.fillStyle = '#ffffff';
    for (let a = 0; a < 20; a++) { const q = a / 20 * 6.283 + p * 3; ctx.fillRect(cx + Math.round(Math.cos(q) * r * .55), cy + Math.round(Math.sin(q) * r * .24), 2, 2); }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  } else if (f.t === 'beam') {
    const x0 = Math.round(f.from * SX), x1 = Math.round(f.x * SX), y = GY - 62, w = Math.max(1, Math.round(7 * (1 - p)));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffc860'; ctx.fillRect(Math.min(x0, x1), y - w, Math.abs(x1 - x0), w * 2 + 1);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.min(x0, x1), y, Math.abs(x1 - x0), 1);
    ctx.globalCompositeOperation = 'source-over';
  } else if (f.t === 'rain') {
    ctx.fillStyle = '#f0e4c0';
    for (let i = 0; i < 16; i++) {
      const sx = (seedOf(i, 3) - .5) * 150, q = (p * 1.5 + seedOf(i, 7)) % 1, y = Math.round(-8 + q * (GY + 4));
      ctx.fillRect(Math.round(f.x * SX + sx + (1 - q) * 18), y, 1, 9); ctx.fillRect(Math.round(f.x * SX + sx + (1 - q) * 18) - 1, y + 8, 3, 2);
    }
  } else if (f.t === 'meteor') {
    const x = Math.round(f.x * SX + (1 - p) * 110), y = Math.round(-14 + p * (GY - 6));
    orbAt(x, y, '#ff5a1c', '#fff0b8', 8);
    if (!REDUCED.matches) for (let i = 0; i < 3; i++) spawn(x + (Math.random() - .5) * 10, y + (Math.random() - .5) * 10, 18 + Math.random() * 20, -24 - Math.random() * 20, .4, i ? '#ff8a3c' : '#ffe080', { add: true, size: 3 });
  } else if (f.t === 'column') {
    const x = Math.round(f.x * SX), w = Math.max(1, Math.round(15 * (1 - p)));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffe08a'; ctx.fillRect(x - w, 0, w * 2, GY + 2);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, 0, 3, GY + 2);
    ctx.globalCompositeOperation = 'source-over';
  } else if (f.t === 'heal') {
    const y = Math.round(GY - 96 - ease(p) * 22), x = Math.round(f.x * SX);
    ctx.globalAlpha = 1 - p * .7;
    ctx.fillStyle = '#1b3a1c'; ctx.fillRect(x - 8, y - 1, 16, 6); ctx.fillRect(x - 3, y - 6, 6, 16);
    ctx.fillStyle = '#8df08a'; ctx.fillRect(x - 7, y, 14, 4); ctx.fillRect(x - 2, y - 5, 4, 14);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, y + 1, 2, 2);
    ctx.globalAlpha = 1;
  } else if (f.t === 'claw') {
    const x = Math.round(f.x * SX), y = GY - 62, n = Math.round(24 * (1 - p * .5));
    ctx.fillStyle = '#ff6a5a';
    for (let l = 0; l < 3; l++) for (let i = 0; i < n; i += 1) ctx.fillRect(x - 13 + l * 9 + i * .7, y + i, 2, 2);
  } else if (f.t === 'warn') {
    const x = Math.round(f.x * SX), pulse = .35 + Math.abs(Math.sin((f.age + acc) * 9)) * .4;
    ctx.fillStyle = `rgba(232,50,40,${pulse * .55})`;
    for (let i = 0; i < 4; i++) ctx.fillRect(x - 156 + i * 8, GY - 2 + i * 2, 312 - i * 16, 2);
    if (Math.floor((f.age + acc) * 8) % 2 === 0) {
      ctx.fillStyle = '#1b0a0c'; ctx.fillRect(x - 5, GY - 148, 11, 26); ctx.fillRect(x - 5, GY - 118, 11, 11);
      ctx.fillStyle = '#ff5a4a'; ctx.fillRect(x - 3, GY - 146, 7, 22); ctx.fillRect(x - 3, GY - 116, 7, 7);
    }
  } else if (f.t === 'breath') {
    // Fire pours from the dragon's jaws to the ground, then sheets out across everyone in front of it.
    const d = f.dir, mouthX = f.x * SX + d * 122, mouthY = GY - 50, grow = Math.min(1, p / .14), t = f.age + acc;
    const fadeOut = (from, to) => (p <= from ? 1 : p >= to ? 0 : (to - p) / (to - from));
    const flame = (x, y, w, h, power) => {
      const X = Math.round(x - w / 2);
      ctx.globalAlpha = .42 * power; ctx.fillStyle = '#b81e08'; ctx.fillRect(X, Math.round(y - h), w, Math.round(h * 2));
      ctx.globalAlpha = .62 * power; ctx.fillStyle = '#ff6a12'; ctx.fillRect(X + (w > 4 ? 1 : 0), Math.round(y - h * .66), Math.max(2, w - (w > 4 ? 2 : 0)), Math.round(h * 1.32));
      ctx.globalAlpha = .85 * power; ctx.fillStyle = '#ffdf74'; ctx.fillRect(X + (w > 4 ? 2 : 1), Math.round(y - h * .28), Math.max(1, w - (w > 4 ? 4 : 2)), Math.max(1, Math.round(h * .56)));
    };
    ctx.globalCompositeOperation = 'lighter';
    // The jet lasts only while the jaws are open.
    const jet = fadeOut(.32, .5);
    if (jet > 0) for (let i = 0; i < 18; i++) {
      const u = (i + 1) / 18 * grow, wob = Math.sin(t * 43 + i * 1.9);
      flame(mouthX + d * u * 66 + wob, mouthY + u * u * 46 + Math.sin(t * 37 + i * 2.7) * (1 + u * 3), 4 + Math.round(u * 5), 2.5 + u * 12 + wob * 1.5, jet);
    }
    // Where it lands, uneven tongues of fire spread over the ground and then die back.
    const landX = mouthX + d * 62, reach = 150 * Math.min(1, p / .3), ground = fadeOut(.5, 1);
    for (let n = 0, dx = -reach * .75; dx <= reach && n < 90; n++) {
      const seed = seedOf(n, 37), w = 3 + Math.floor(seed * 6);
      const edge = 1 - Math.abs(dx - reach * .12) / (reach * .9 + 1);
      if (edge > 0) {
        const leap = .55 + .45 * Math.sin(t * (17 + seed * 19) + seed * 40), tall = (3 + edge * (12 + seed * 26) * leap) * (.45 + ground * .55);
        flame(landX + d * dx, GY - tall * .78 - 1, w, tall * .78, ground * (.55 + edge * .45));
      }
      dx += w + (seed > .8 ? 2 : 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (!REDUCED.matches && ground > .2 && frameNo % 2 === 0) spawn(landX + d * (Math.random() - .3) * reach * 1.4, GY - 4, (Math.random() - .5) * 30, -50 - Math.random() * 90, .5, Math.random() < .5 ? '#ff9a2c' : '#ffe27a', { add: true, size: 2, g: 30 });
  } else if (f.t === 'shock') {
    const r = 24 + ease(p) * 150, x = Math.round(f.x * SX);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1 - p;
    ctx.fillStyle = '#ffd898'; ctx.fillRect(x - r, GY - 1, r * 2, 3);
    ctx.fillStyle = '#ffffff';
    for (let i = -7; i <= 7; i++) ctx.fillRect(x + i * r / 7, GY - 5 - (i % 2 ? 7 : 15) * (1 - p), 3, 5);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  } else if (f.t === 'corpse') {
    const fade = p < .55 ? 1 : (1 - p) / .45;
    S_.drawCorpse(ctx, f, region, f.x * SX, GY, p, { alpha: fade, flash: p < .12 ? 1 - p / .12 : 0 });
  }
}
function visOf(key, o) {
  let v = vis.get(key);
  if (!v) {
    v = { x: o.x * SX, hp: o.hp / (o.mhp || 1), born: clockT, stepT: 0, auraT: Math.random(), hurt: 0, flashOn: false };
    vis.set(key, v);
  }
  v.f = frameNo;
  return v;
}
function follow(v, target, dt) {
  // A short catch-up hides the coarse rule steps and any correction from the server.
  const d = target - v.x;
  v.x = Math.abs(d) > 90 ? target : v.x + d * (1 - Math.exp(-dt * 32));
  return v.x;
}
function drawStrip(dt) {
  if (!ctx) return;
  clockT += dt; frameNo++;
  const W = STRIP_W, H = STRIP_H;
  if (!B || !S_.ready) {
    ctx.fillStyle = '#0c0912'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#8e84a0'; ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Loading the world…', W / 2, H / 2);
    return;
  }
  const info = B.info, r = info.r, k = Math.max(0, Math.min(1, acc / .1)), reduced = REDUCED.matches, RF = REGION_FX[r];
  S_.need('r' + r); S_.need('r' + ((r + 1) % 5));
  for (const f of B.fx) if (!f.seen) { f.seen = 1; onFx(f); }
  if (B.shake > 0) kick(4);
  stepParts(dt);
  ctx.save();
  if (shakeA > .2) {
    ctx.translate(Math.round(Math.sin(clockT * 73) * shakeA), Math.round(Math.cos(clockT * 91) * shakeA * .6));
    shakeA *= Math.exp(-dt * 14);
  } else shakeA = 0;
  const bg = S_.scene(r);
  ctx.fillStyle = '#0c0912'; ctx.fillRect(-8, -8, W + 16, H + 16);
  if (bg) ctx.drawImage(bg.img, bg.r[0], bg.r[1], W, H, 0, 0, W, H);
  if (info.d === 1) { ctx.fillStyle = 'rgba(120,60,10,.14)'; ctx.fillRect(0, 0, W, H); }
  else if (info.d === 2) { ctx.fillStyle = 'rgba(120,10,16,.2)'; ctx.fillRect(0, 0, W, H); }
  if (!reduced) drawFog(r, 104, 5, .9);

  // Ambient motes drifting through the scene.
  if (!reduced && Math.random() < RF.rate * dt) spawn(Math.random() * W, RF.up > 0 ? -2 : 60 + Math.random() * 110, (Math.random() - .5) * 8 + RF.drift * (r === 1 ? 1 : .4), RF.up + (Math.random() - .5) * 5, 3 + Math.random() * 3, RF.col[Math.random() < .5 ? 0 : 1], { add: !!RF.add, size: Math.random() < .3 ? 2 : 1 });

  // The gate monsters come from, and the cart where chests pile up.
  S_.drawProp(ctx, 'gate/' + (info.boss ? 1 : 0), reduced ? 0 : Math.floor(clockT * 12), 60, GY - 4);
  S_.drawProp(ctx, 'cart', Math.min(4, G.chests.length), 584, GY + 4);
  const full = G.chests.length >= T.chestCap(G), pct = full ? 1 : Math.max(0, 1 - G.chestT / CFG.CHEST_BASE);
  bar(540, GY + 13, 88, pct, 0, full ? '#ffd84a' : '#bb82ec');

  // Everything that stands on the ground, back to front.
  const actors = [];
  for (const h of B.hs) {
    const v = visOf('h' + h.key, h);
    actors.push({ h, v, x: follow(v, lerp(h, k) * SX, dt), g: GY + [0, 5, -4][h.idx] });
  }
  for (const m of B.mons) {
    const v = visOf('m' + m.id, m);
    actors.push({ m, v, x: follow(v, lerp(m, k) * SX, dt), g: GY + [0, 5, -5][m.id % 3] });
  }
  actors.sort((a, b) => a.g - b.g || a.x - b.x);
  for (const a of actors) {
    if (a.h) shadow(a.x, a.g, 46);
    else shadow(a.x, a.g, SHADOW[a.m.shape] || 40, a.m.fly ? .26 : .5);
  }
  const front = [];
  for (const f of B.fx) if (f.t === 'corpse' || f.t === 'warn') drawFx(f, r); else front.push(f);
  for (const a of actors) {
    const v = a.v;
    if (a.h) {
      const h = a.h, gear = G.heroes[h.key].gear, weapon = T.findItem(G, gear.weapon);
      const on = h.flash > 0;
      if (on && !v.flashOn && h.hp > 0) v.hurt = 1;
      v.flashOn = on;
      v.hurt = Math.max(0, v.hurt - dt / .26);
      const moving = h.a === 'run';
      if (moving && !reduced) {
        v.stepT -= dt;
        if (v.stepT <= 0) { v.stepT = .17; spawn(a.x - h.dir * 8, a.g, -h.dir * 16 + (Math.random() - .5) * 12, -8 - Math.random() * 12, .34, RF.dust, { size: 3, g: 20 }); }
      }
      // Each hero leaves a trail of their own colour curling up around their feet.
      if (!reduced && h.hp > 0) {
        v.auraT -= dt;
        if (v.auraT <= 0) { v.auraT = .16 + Math.random() * .2; const c = AURA[h.key]; spawn(a.x + (Math.random() - .5) * 30, a.g - Math.random() * 5, (Math.random() - .5) * 8, -12 - Math.random() * 18, .9 + Math.random() * .6, c[Math.random() < .5 ? 0 : 1], { add: true, size: Math.random() < .3 ? 3 : 2, drag: .3 }); }
      }
      const hopY = h.a === 'hop' ? -Math.sin(Math.min(1, (h.at + acc) / .24) * Math.PI) * 15 : 0;
      S_.drawHero(ctx, h.key, a.x, a.g + hopY, { anim: h.a, at: h.at + acc, ad: h.ad, ai: h.ai, combo: h.combo, dir: h.dir, hurt: v.hurt, speed: HEROES[h.key].move * SX, flash: on ? .55 : 0, tint: weapon ? GRADES[weapon.g].c : S_.defaultTint(h.key) });
    } else {
      const m = a.m, age = clockT - v.born;
      const spawning = age < .3 && !m.boss;
      const jit = m.flash > 0 && !reduced ? (frameNo % 2 ? 1 : -1) : 0;
      S_.drawMonster(ctx, m, r, a.x + jit, a.g, reduced ? 0 : m.at + acc, { flash: spawning ? 1 - age / .3 : m.flash > 0 ? (m.boss ? .28 : .85) : 0, alpha: spawning ? Math.max(.2, age / .3) : 1 });
    }
  }
  drawParts(false);
  ctx.globalCompositeOperation = 'lighter';
  drawParts(true);
  ctx.globalCompositeOperation = 'source-over';
  if (!reduced) drawFog(r, 138, -11, .55);
  if (B.state === 'regroup') {
    ctx.fillStyle = '#3a2416'; ctx.fillRect(254, GY - 2, 20, 3);
    if (!reduced && frameNo % 3 === 0) spawn(264 + (Math.random() - .5) * 10, GY - 4, (Math.random() - .5) * 10, -36 - Math.random() * 30, .6, Math.random() < .5 ? '#ffb040' : '#ff6a2c', { add: true, size: 3 });
  }
  // Bars: a pale ghost hangs behind the real value, so each hit reads at a glance.
  for (const a of actors) {
    const o = a.h || a.m, v = a.v, frac = o.hp / (o.mhp || 1);
    v.hp = v.hp > frac ? Math.max(frac, v.hp - dt * .55) : frac;
    if (a.h) { if (o.hp > 0) bar(a.x - 22, a.g - S_.heroTop(o.key) - 4, 44, frac, v.hp, '#6fdc5c'); }
    else if (!o.boss && frac < 1) bar(a.x - 20, a.g - S_.monTop(o, r) - 6, 40, frac, v.hp, '#ef4a3a');
  }
  for (const f of front) drawFx(f, r);
  const boss = actors.find(a => a.m && a.m.boss);
  if (boss) {
    const o = boss.m;
    bar(150, 8, 340, o.hp / o.mhp, boss.v.hp, '#ef3a2c');
    bar(150, 9, 340, o.hp / o.mhp, boss.v.hp, '#ef3a2c');
  }
  beams = beams.filter(b => (b.age += dt) < 1.3);
  for (const b of beams) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0, 1 - b.age / 1.3) * .8;
    ctx.fillStyle = b.color; ctx.fillRect(b.x - 9, 0, 18, GY);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(b.x - 2, 0, 4, GY);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  if (B.trans > 0) { ctx.globalAlpha = Math.min(1, (B.trans - acc * 0) / .5); ctx.fillStyle = '#07050c'; ctx.fillRect(-8, -8, W + 16, H + 16); ctx.globalAlpha = 1; }
  ctx.restore();
  if (frameNo % 120 === 0) for (const [key, v] of vis) if (frameNo - v.f > 120) vis.delete(key);
}

// ---------------------------------------------------------------- local replay
let lastT = performance.now(), acc = 0, secTick = 0;
let lastFrameDt = 1 / 60;
// The music follows the fight, and the dragon announces itself the moment it comes through the gate.
function soundTick() {
  const boss = B.mons.find(m => m.boss);
  if (boss && !ui.bossHere && boss.bossFire) {
    // It lands hard: the ground shakes and the dust flies.
    Sound.fx('roar'); Sound.fx('boom');
    kick(8); hitStop(.08);
    if (!REDUCED.matches) burstOf(46, boss.x * SX, GY - 3, 150, .6, [REGION_FX[B.info.r].dust, '#a89070', '#ffb060'], { g: 90, drag: 3, size: 3 });
  }
  ui.bossHere = !!boss;
  Sound.scene(B.info.r, !!boss);
}
function advance() {
  const t = performance.now();
  let dt = Math.min(60, (t - lastT) / 1000); lastT = t;
  lastFrameDt = Math.min(.1, dt);
  // Hit-stop: the fight holds for a beat on a big blow, then quietly runs a little fast until
  // it has caught up, so the local replay never drifts away from the server.
  if (stopT > 0) { const held = Math.min(stopT, dt); stopT -= held; stopDebt += held; dt -= held; }
  else if (stopDebt > 0) { const pay = Math.min(stopDebt, dt * .3); stopDebt -= pay; dt += pay; }
  acc += dt;
  const now = serverNow();
  while (acc >= .1) {
    acc -= .1;
    for (const e of T.step(G, B, .1, now)) previewEvent(e);
  }
  secTick += dt;
  if (secTick >= 1) { secTick = 0; updateHud(now); soundTick(); if (Date.now() - lastRender > 3000) touch(); }
}
// Events the replay can show by itself. Loot and sales come from the server instead.
function previewEvent(e) {
  if (e.t === 'chest' || e.t === 'clear') touch();
  else if (e.t === 'level') { Sound.fx('level'); say(`${HEROES[e.hero].n} reached level ${e.lvl}.`); touch(); }
  else if (e.t === 'bossDown') { Sound.fx('bossDown'); say(`${e.name} is down. A boss chest is in the cart.`, 'big', '#f4b942'); touch(); }
  else if (e.t === 'wipe') { Sound.fx('wipe'); say(`Your crew fell at ${e.info.name}. Falling back to regroup.`, 'warn'); touch(); }
}
function serverEvent(e) {
  if (e.t === 'opened') announceLoot(e.r);
  else if (e.t === 'loot') say(`${GRADES[e.item.g].n} ${T.itemName(e.item)}`, '', GRADES[e.item.g].c);
  else if (e.t === 'forge') say(`Forge reached level ${e.lvl}.`, 'good');
  else if (e.t === 'sale') { Sound.fx('coin'); say(`${e.buyer} paid ${fmt(e.price)} DND. You kept ${fmt(e.net)}.`, 'good'); }
  else if (e.t === 'deposit') say(`${fmt(e.whole)} DND arrived from your wallet.`, 'good');
  else if (e.t === 'withdrawn') say(`${fmt(e.whole)} DND reached your wallet.`, 'good');
  else if (e.t === 'refund') say(`A withdrawal expired, so ${fmt(e.whole)} DND came back to you.`, 'good');
  else if (e.t === 'away') say(`Welcome back. ${shortNum(e.coin)} coin and ${shortNum(e.xp)} XP came in while you were away.`, 'big', '#f4b942');
}
function announceLoot(r) {
  if (!r) return;
  Sound.fx('chest');
  Sound.fx('loot', 0, Math.max(0, ...r.loot.map(l => (l.item ? l.item.g : 0))));
  for (const l of r.loot) {
    if (l.mat) say(`${l.qty} × ${MATS[l.mat].n}`, '', MATS[l.mat].c);
    else {
      const g = l.item.g, col = GRADES[g].c;
      say(`${GRADES[g].n} ${T.itemName(l.item)}`, g >= 4 ? 'big' : '', col);
      if (g >= 3) beams.push({ x: 576, color: col, age: 0 });
    }
  }
  touch();
}
let lastRender = 0;
function maybeRender() {
  if (!ui.dirty || ui.pressing || !G) return;
  const a = document.activeElement;
  if (a && ($('desk').contains(a) || $('icard').contains(a)) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return;
  // Never wipe half-typed account details.
  for (const inp of document.querySelectorAll('#desk .authform input')) if (inp.value) return;
  ui.dirty = false; lastRender = Date.now();
  renderDesk();
}
function frame() {
  if (G) { advance(); drawStrip(lastFrameDt); drawHeroModel(); maybeRender(); }
  else drawStrip(1 / 60);
  requestAnimationFrame(frame);
}
function updateHud(now) {
  if (!G) return;
  now = now || serverNow();
  $('hudCoin').textContent = shortNum(G.coin);
  $('hudMarks').textContent = fmt(G.marks);
  const info = B.info;
  $('lblStage').textContent = `${info.r + 1}-${info.n}`;
  $('lblStage').dataset.d = info.d;
  $('stageName').textContent = `${info.diff} · ${info.name}`;
  const boss = B.mons.find(m => m.boss);
  $('lblBoss').hidden = !boss;
  if (boss) $('lblBoss').textContent = boss.name;
  $('lblWave').textContent = B.state === 'regroup' ? 'Regrouping at camp' : info.boss ? `Boss gate · wave ${Math.min(B.wave, B.waves)} of ${B.waves}` : `Wave ${Math.min(B.wave, B.waves)} of ${B.waves}`;
  const cap = T.chestCap(G);
  $('chestCount').textContent = `${G.chests.length}/${cap}`;
  const btn = $('chestBtn'); btn.disabled = !G.chests.length; btn.classList.toggle('ready', G.chests.length > 0);
  const full = G.chests.length >= cap;
  const pct = full ? 100 : Math.round((1 - G.chestT / CFG.CHEST_BASE) * 100);
  $('chestFill').style.width = Math.max(0, Math.min(100, pct)) + '%';
  const rate = B.bonus ? B.bonus.chest : 1;
  $('chestNext').textContent = full ? 'Cart is full' : `Next chest ${clock(G.chestT / rate * 1000)}`;
  $('holdBtn').setAttribute('aria-pressed', G.hold ? 'true' : 'false');
  $('holdBtn').textContent = G.hold ? 'Holding' : 'Hold here';
  const d = new Date(now);
  $('clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  $('hint').textContent = nextHint();
  $('hint').hidden = !$('hint').textContent;
  const wb = $('walletBtn'), wl = Net.account && Net.account.wallets;
  const shown = wl && (wl.evm || wl.sol);
  wb.hidden = false;
  wb.textContent = shown ? short(shown.address) : 'Connect wallet';
  wb.classList.toggle('gold', !shown);
  const ab = $('acctBtn'), acct = Net.account;
  if (acct) {
    ab.hidden = false;
    ab.textContent = acct.guest ? 'Save your crew' : acct.name || 'Account';
    ab.classList.toggle('guest', acct.guest);
  }
}
function nextHint() {
  if (Net.offline) return 'Connection lost. Your crew keeps walking on screen, but nothing counts until the server is back.';
  const listed = G.market.mine.length || G.ledger.sold;
  if (G.stats.chests === 0 && G.chests.length) return 'Your first chest is in the cart. Open it from the tray below.';
  if (G.forge.lvl < CFG.LIST_GATE) return `Salvage spare gear in the Pack to reach Forge level ${CFG.LIST_GATE}. That opens selling on the Exchange.`;
  if (!listed && G.items.some(i => i.g >= 3 && !T.equippedBy(G, i.id))) return 'You can sell now. Pick your Prized item in the Pack and list it on the Exchange.';
  if (G.party.length < T.partySize(G)) return 'You have a hero waiting. Deploy them on the Crew tab.';
  const nxt = G.stage + 1;
  if (nxt < T.STAGE_COUNT && T.stageInfo(nxt).boss && G.mats.seal < 1) return 'The next boss gate needs a Warden Seal. Chests drop them, and the Exchange sells them.';
  if (Net.account && Net.account.guest && G.stats.boss >= 1) return 'Save your crew in the Ledger so you can log in anywhere and trade with other crews.';
  return '';
}

// ---------------------------------------------------------------- panels
// ---------------------------------------------------------------- windows
// The screen works like a desk: a side window on the left, the hero in the middle, a side
// window on the right, and three wide ones that take over the whole desk when opened.
const BLURB = {
  warden: 'A very small knight with a very large sword. Holds the front line anyway.',
  fletcher: 'The little outlaw of Sherwood. Picks enemies off long before they arrive.',
  hexer: 'A black cat of ember and storm, whose blasts catch whole groups.',
  mender: 'A gentle white cat in a golden halo, who keeps the crew standing.',
};
const WIN = {
  hero: { title: 'Hero', icon: 'em/fist/red/round', side: 'c' },
  pack: { title: 'Pack', icon: 'em/chest/gold/round', side: 'l' },
  skills: { title: 'Status', icon: 'em/cross/red/round', side: 'l' },
  forge: { title: 'Forge', icon: 'em/anvil/steel/round', side: 'r' },
  portal: { title: 'Portal', icon: 'em/burst/blue/round', side: 'r' },
  almanac: { title: 'Almanac', icon: 'em/star/violet/round', wide: true },
  exchange: { title: 'Exchange', icon: 'em/coin/gold/round', wide: true },
  wallet: { title: 'Wallet', icon: 'em/bag/teal/round', side: 'r' },
  ledger: { title: 'Ledger', icon: 'em/book/teal/round', wide: true },
};
const GRADE_TILE = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'];
const columns = () => (innerWidth >= 1250 ? 3 : innerWidth > 860 ? 2 : 1);
function visibleWins() {
  if (ui.wide) return [ui.wide];
  const c = columns();
  if (c === 3) return [ui.left, 'hero', ui.right].filter(Boolean);
  if (c === 2) { const s = ui.focus !== 'hero' ? ui.focus : ui.left || ui.right; return [s, 'hero'].filter(Boolean); }
  return [ui.focus || 'hero'];
}
const isOpen = name => visibleWins().includes(name);
function openWin(name) {
  const W = WIN[name];
  ui.closeCard && ui.closeCard();
  if (W.wide) { ui.wide = ui.wide === name ? null : name; if (ui.wide) ui.focus = name; else ui.focus = 'hero'; }
  else {
    ui.wide = null; ui.focus = name;
    if (W.side === 'l') ui.left = name; else if (W.side === 'r') ui.right = name;
  }
  if (name === 'exchange') { pollMarket(); refreshWallet(); }
  if (name === 'wallet') refreshWallet();
  if (name === 'ledger') pollBoard();
  ui.pressing = false; renderDesk(); ui.dirty = false;
}
function closeWin(name) {
  if (WIN[name].wide) { ui.wide = null; ui.focus = 'hero'; }
  else if (WIN[name].side === 'l') { ui.left = null; if (ui.focus === name) ui.focus = 'hero'; }
  else if (WIN[name].side === 'r') { ui.right = null; if (ui.focus === name) ui.focus = 'hero'; }
  else if (columns() === 1) ui.focus = ui.left || ui.right || 'hero';
  ui.pressing = false; renderDesk(); ui.dirty = false;
}
function windowHtml(name) {
  const W = WIN[name];
  const canClose = W.side !== 'c' || columns() === 1;
  const body = { hero: winHero, pack: winPack, skills: winSkills, forge: winForge, portal: winPortal, wallet: winWallet, almanac: winAlmanac, exchange: panelExchange, ledger: panelLedger }[name]();
  return `<header class="win-head"><span class="crest">${A.ic(W.icon, 1)}</span><h2 class="ribbon">${W.title}</h2>${canClose ? `<button class="x" data-act="closeWin" data-w="${name}" aria-label="Close ${W.title}"></button>` : ''}</header><div class="win-body">${body}</div>`;
}
function renderDesk() {
  const desk = $('desk'), want = visibleWins();
  for (const el of [...desk.children]) if (!want.includes(el.dataset.win)) el.remove();
  want.forEach((name, i) => {
    let el = [...desk.children].find(c => c.dataset.win === name);
    if (!el) { el = document.createElement('section'); el.className = 'win' + (WIN[name].wide ? ' wide' : ''); el.dataset.win = name; }
    if (desk.children[i] !== el) desk.insertBefore(el, desk.children[i] || null);
    const html = windowHtml(name);
    // Rebuilding a window costs a frame or two, so leave it alone when nothing changed.
    if (el._html !== html) {
      const old = el.querySelector('.win-body'), top = old ? old.scrollTop : 0;
      el.innerHTML = html; el._html = html;
      const body = el.querySelector('.win-body'); if (body) body.scrollTop = top;
    }
  });
  document.querySelectorAll('#rail [data-win]').forEach(b => b.setAttribute('aria-pressed', isOpen(b.dataset.win) ? 'true' : 'false'));
  const pts = selectedHeroes().some(k => T.skillPoints(G, k).left > 0);
  const dot = document.querySelector('#rail [data-win="skills"]'); if (dot) dot.classList.toggle('alert', pts);
  if (isOpen('exchange')) updateMatQuote();
  renderItemCard();
}
const renderPanel = renderDesk;
const selectedHeroes = () => HERO_KEYS.filter(k => G.party.includes(k));
const heroSel = () => (HERO_KEYS.includes(ui.hero) ? ui.hero : (ui.hero = G.party[0]));

// ---------------------------------------------------------------- shared pieces
function tile(it, o = {}) {
  const by = T.equippedBy(G, it.id), socks = GRADES[it.g].sock, used = (it.e || []).length;
  const pips = socks ? `<span class="pips">${Array.from({ length: socks }, (_, i) => `<i class="${i < used ? 'on' : ''}"></i>`).join('')}</span>` : '';
  const tag = by ? `<span class="tag eq">E</span>` : it.k ? `<span class="tag lk"></span>` : '';
  return `<button class="tile ${GRADE_TILE[it.g]} ${ui.sel === it.id ? 'sel' : ''}" data-act="${o.act || 'sel'}" data-id="${esc(it.id)}" data-tip="item:${esc(it.id)}" ${o.attrs || ''} aria-label="${GRADES[it.g].n} ${esc(T.itemName(it))}, level ${it.l}">${itemIcon(it.s, it.g, T.bandOf(it.l))}${pips}${tag}<span class="lvl">${it.l}</span></button>`;
}
function statBadge(icon, label, value) { return `<div class="sbadge"><span class="sico sico-${icon}"></span><span>${label}</span><b>${value}</b></div>`; }
function heroStatsBlock(k) {
  const st = T.heroStats(G, k);
  return `<div class="inset statgrid">${statBadge('atk', 'Attack', fmt(st.atk))}${statBadge('hp', 'Health', fmt(st.hp))}${statBadge('armor', 'Armor', fmt(st.armor))}${statBadge('speed', 'Speed', st.aspd.toFixed(2))}${statBadge('crit', 'Crit', (st.crit * 100).toFixed(1) + '%')}</div>`;
}
function rosterRow(act) {
  const cur = heroSel();
  return `<div class="roster">${HERO_KEYS.map(k => `<button class="hcard ${k === cur ? 'cur' : ''} ${G.party.includes(k) ? 'on' : ''} ${T.owns(G, k) ? '' : 'locked'}" data-act="${act}" data-hero="${k}" aria-label="${HEROES[k].n}${T.owns(G, k) ? '' : ', locked'}" title="${HEROES[k].n}, ${T.owns(G, k) ? `level ${G.heroes[k].lvl}` : `${fmt(Net.heroPrice)} ${T.TOKEN.symbol}`}">${T.owns(G, k) ? '' : '<span class="lockmark"></span>'}${A.ic('bust/' + k, 1)}${G.party.includes(k) ? '<span class="onroad"></span>' : ''}${T.owns(G, k) ? `<span class="hlvl">${G.heroes[k].lvl}</span>` : ''}</button>`).join('')}</div>`;
}
function skillStrip(k) {
  const me = T.skillsOf(G, k), pts = T.skillPoints(G, k).left;
  const hexes = me.eq.map(id => { const d = T.skillDef(k, id); return `<button class="hexb" data-act="openSkill" data-hero="${k}" data-k="${id}" data-tip="skill:${k}:${id}" aria-label="${esc(d.n)}">${A.ic(`em/${d.icon}/${d.col}/hex`, 2)}<span class="cnt">${me.sk[id]}/${d.max}</span></button>`; }).join('');
  return `<div class="inset skillstrip"><span class="minihead">Active skills</span><div class="hexrow">${hexes}</div><button class="btn small ${pts ? 'gold' : ''}" data-act="openSkill" data-hero="${k}">${pts ? `${pts} point${pts === 1 ? '' : 's'}!` : 'All skills'}</button></div>`;
}
function xpBar(k) {
  const me = G.heroes[k], need = T.xpNeed(me.lvl), pct = me.lvl >= T.LEVEL_CAP ? 100 : Math.min(100, me.xp / need * 100);
  return `<div class="xp" title="${fmt(me.xp)} of ${fmt(need)} XP"><span style="width:${pct}%"></span></div>`;
}

// ---------------------------------------------------------------- hero
function winHero() {
  const k = heroSel(), H = HEROES[k], me = T.skillsOf(G, k), on = G.party.includes(k);
  const tabs = `<div class="tabs2"><button class="ftab ${ui.heroView !== 'crew' ? 'on' : ''}" data-act="heroView" data-v="gear">Equipment</button><button class="ftab ${ui.heroView === 'crew' ? 'on' : ''}" data-act="heroView" data-v="crew">Crew</button></div>`;
  const slot = s => {
    const it = T.findItem(G, me.gear[s]);
    return it ? `<div class="gslot">${tile(it, { act: 'gearSlot', attrs: `data-hero="${k}" data-slot="${s}"` })}</div>`
      : `<button class="tile empty" data-act="gearSlot" data-hero="${k}" data-slot="${s}" aria-label="${SLOT_LABEL[s]}: empty" title="${SLOT_LABEL[s]}: empty"><span class="ghost">${itemIcon(s, 0, 0)}</span></button>`;
  };
  const nav = `<div class="plate"><button class="arrow" data-act="heroStep" data-d="-1" aria-label="Previous hero">&lsaquo;</button><b>${H.n}</b><button class="arrow" data-act="heroStep" data-d="1" aria-label="Next hero">&rsaquo;</button></div>`;
  const deploy = `<button class="btn ${on ? '' : 'gold'}" data-act="toggleHero" data-hero="${k}">${on ? 'Stand down' : 'Deploy'}</button>`;
  const best = `<button class="btn" data-act="equipBest" data-hero="${k}">Equip best</button>`;
  if (!T.owns(G, k)) {
    return `${tabs}<div class="parch herolocked">${nav}<canvas id="heroModel" width="176" height="132" aria-hidden="true"></canvas><p class="role">${H.role}</p><p class="blurb">${BLURB[k]}</p></div>
      ${rosterRow('heroPick')}
      ${buyHeroBlock(k)}`;
  }
  if (ui.heroView === 'crew') {
    const sz = T.partySize(G), b = T.partyBonus(G);
    return `${tabs}<div class="parch heroinfo"><div class="bustbox">${A.ic('bust/' + k, 2)}</div>
      <div class="infoside">${nav}<p class="role">${H.role} · Lv.${me.lvl}</p>${xpBar(k)}<p class="blurb">${BLURB[k]}</p></div></div>
      ${skillStrip(k)}
      ${heroStatsBlock(k)}
      <div class="inset formation"><div class="fhead"><span class="redtag">Road crew</span><span class="sub">${G.party.length} of ${sz} slots · power ${fmt(T.partyPower(G))}</span></div>
        ${rosterRow('heroPick')}
        <p class="sub">Bonus: coin +${Math.round(b.coin)}%, XP +${Math.round(b.xp)}%, chests +${Math.round(b.chest)}%.</p></div>
      <div class="row center">${deploy}${best}</div>`;
  }
  return `${tabs}<div class="parch herogear">
      <div class="gcol">${slot('weapon')}${slot('helm')}${slot('boots')}</div>
      <div class="gmid">${nav}<canvas id="heroModel" width="176" height="132" aria-hidden="true"></canvas><div class="lvrow"><b>Lv.${me.lvl}</b>${xpBar(k)}</div></div>
      <div class="gcol">${slot('ward')}${slot('coat')}${slot('charm')}</div>
    </div>
    ${rosterRow('heroPick')}
    ${skillStrip(k)}
    ${heroStatsBlock(k)}
    <div class="row center">${deploy}${best}</div>`;
}
// Buying burns a lot of DND at once, so it takes a second, clearly worded press.
function buyHeroBlock(k) {
  const price = Net.heroPrice, sym = T.TOKEN.symbol, H = HEROES[k], can = G.marks >= price, live = Net.account && Net.account.live;
  const note = can ? `The ${sym} is burned for good, and ${H.n} is yours to keep.`
    : live ? `You have ${fmt(G.marks)} ${sym}. Deposit more in the Wallet.`
    : `The ${sym} token launches soon, and ${H.n} can be bought once it does. Test ${sym} can't reach this price.`;
  const buttons = !can ? `<button class="btn" data-act="openWallet">${live ? `Get ${sym}` : 'Wallet'}</button>`
    : ui.buyHero === k ? `<button class="btn red" data-act="buyHeroGo" data-hero="${k}">Burn ${fmt(price)} ${sym}</button><button class="btn" data-act="buyHeroCancel">Cancel</button>`
    : `<button class="btn gold" data-act="buyHeroAsk" data-hero="${k}">Buy ${H.n}</button>`;
  return `<div class="inset buyhero"><div class="wbal"><span class="ic-slot">${A.ic('mark', 1)}</span><span>Price</span><b>${fmt(price)} ${sym}</b></div><p class="sub">${note}</p><div class="row center">${buttons}</div></div>`;
}
const MODEL = { el: null };
function drawHeroModel() {
  const c = $('heroModel');
  if (!c) return;
  const g = c.getContext('2d'), k = heroSel();
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, c.width, c.height);
  const gear = G.heroes[k].gear, weapon = T.findItem(G, gear.weapon);
  g.fillStyle = 'rgba(60,36,14,.35)'; g.fillRect(58, 122, 60, 3); g.fillRect(52, 123, 72, 2);
  S_.drawHero(g, k, 84, 124, { anim: 'idle', at: REDUCED.matches ? 0 : clockT, dir: 1, tint: weapon ? GRADES[weapon.g].c : S_.defaultTint(k) });
}

// ---------------------------------------------------------------- pack
function winPack() {
  const counts = new Array(GRADES.length).fill(0);
  G.items.forEach(i => counts[i.g]++);
  const list = G.items.filter(i => (ui.gradeF < 0 || i.g === ui.gradeF) && (!ui.slotF || i.s === ui.slotF)).sort((a, b) => b.g - a.g || b.l - a.l);
  const cap = T.packCap(G);
  const tabs = `<div class="tabs2 slots"><button class="ftab ${!ui.slotF ? 'on' : ''}" data-act="slotF" data-s="">All</button>${SLOTS.map(s => `<button class="ftab icon ${ui.slotF === s ? 'on' : ''}" data-act="slotF" data-s="${s}" aria-label="${SLOT_LABEL[s]}" title="${SLOT_LABEL[s]}">${itemIcon(s, 0, 1, 1)}</button>`).join('')}</div>`;
  const grades = `<div class="gradefilter"><button class="gf ${ui.gradeF < 0 ? 'on' : ''}" data-act="gradeF" data-g="-1">Any</button>${GRADES.map((g, i) => counts[i] ? `<button class="gf ${GRADE_TILE[i]} ${ui.gradeF === i ? 'on' : ''}" data-act="gradeF" data-g="${i}" title="${g.n}">${counts[i]}</button>` : '').join('')}</div>`;
  const filtered = ui.gradeF >= 0 || ui.slotF;
  const empties = filtered ? 0 : Math.max(0, Math.min(cap, Math.ceil((G.items.length + 7) / 7) * 7) - G.items.length);
  const cells = list.map(it => tile(it)).join('') + '<span class="tile hole"></span>'.repeat(empties);
  const mats = Object.keys(MATS).map(k => `<div class="mat" title="${esc(MATS[k].n)}: ${esc(MATS[k].desc)}">${matIcon(k)}<b>${G.mats[k]}</b></div>`).join('');
  const banner = ui.equipFor ? `<p class="banner">Choosing ${SLOT_LABEL[ui.slotF] || 'gear'} for <b>${HEROES[ui.equipFor].n}</b>. <button class="linkb" data-act="endChoose">Cancel</button></p>` : '';
  return `${tabs}${banner}<div class="packtop"><div class="mats">${mats}</div><span class="count">${G.items.length}/${cap}</span></div>${grades}
    <div class="inset gridwrap"><div class="grid7">${cells || '<p class="empty">Nothing matches this filter.</p>'}</div></div>
    <div class="row center"><button class="btn" data-act="bulkSalvage" data-g="0">Salvage Scrap</button><button class="btn" data-act="bulkSalvage" data-g="1">Salvage up to Sturdy</button></div>`;
}
// The item card, used both as a hover tooltip and, with buttons, when an item is picked.
function itemCardHtml(it, withActions) {
  const now = serverNow(), gr = GRADES[it.g], st = T.itemStats(it), by = T.equippedBy(G, it.id), id = esc(it.id);
  const main = [['Attack', st.atk], ['Health', st.hp], ['Armor', st.armor]].filter(a => a[1]).map(([a, b]) => `<div class="mainstat"><span>${a}</span><b>${fmt(b)}</b></div>`).join('');
  const affixes = T.AFFIXES.filter(a => st[a.k]).map(a => `<div class="aff"><i>&ndash;</i>${a.n} +${st[a.k].toFixed(1)}%</div>`).join('');
  const etched = it.e || [], statNames = ['Attack', 'Health', 'Armor'];
  const sockets = gr.sock ? `<div class="sec"><h5><span class="spark4"></span>Etching sockets</h5>${Array.from({ length: gr.sock }, (_, i) => etched[i] ? `<div class="aff set"><i>+</i>${MATS['gem' + (etched[i][0] + 1)].n}: ${statNames[etched[i][1]]}</div>` : `<div class="aff none"><i>&ndash;</i>Empty socket</div>`).join('')}</div>` : '';
  const ref = T.refPrice(T.marketKey(it), now, ui.peerKeys[T.marketKey(it)] || 0);
  const salv = Math.round(gr.salv * (1 + .1 * T.talent(G, 'salvage')) * (1 + it.l * .02));
  const trade = it.nd ? '<span class="warn">Bought goods: no drifters</span>' : it.t > now ? `<span class="warn">Locked ${clock(it.t - now)}</span>` : 'Tradable';
  let actions = '';
  if (withActions) {
    const heroes = (ui.equipFor ? [ui.equipFor] : G.party).filter(h => by !== h);
    const equipBtns = heroes.map(h => `<button class="btn gold" data-act="equip" data-hero="${h}" data-id="${id}">Equip on ${HEROES[h].n}</button>`).join('');
    let etchUI = '';
    if (gr.sock > 0) {
      const free = gr.sock - etched.length;
      etchUI = G.forge.lvl < CFG.ETCH_GATE ? `<p class="sub">Etching opens at Forge level ${CFG.ETCH_GATE}.</p>` :
        (free > 0 ? `<div class="etchrow">${[0, 1, 2].filter(t => G.mats['gem' + (t + 1)] > 0).map(t => statNames.map((n, s) => `<button class="btn tiny" data-act="etch" data-id="${id}" data-t="${t}" data-s="${s}">${MATS['gem' + (t + 1)].n.split(' ')[0]} ${n}</button>`).join('')).join('')}</div>` : '') +
        (etched.length ? `<button class="btn tiny" data-act="strip" data-id="${id}">Strip all for ${fmt(T.stripCost(it))} coin</button>` : '');
    }
    const why = T.canList(G, it, now);
    const form = ui.listing === it.id && !why ? `<div class="listform"><label for="listPrice">Your price in DND</label>
      <div class="row"><input id="listPrice" type="number" min="${CFG.FLOOR}" step="1" value="${ref}" inputmode="numeric"><button class="btn gold" data-act="confirmList" data-id="${id}">List</button><button class="btn" data-act="closeList">Cancel</button></div><p class="quote" id="listQuote"></p></div>` : '';
    const listBtn = why ? `<p class="sub why">${esc(why)}</p>` : (ui.listing === it.id ? '' : `<button class="btn teal" data-act="openList" data-id="${id}">Sell on Exchange</button>`);
    actions = `<div class="cardacts"><div class="row wrap">${equipBtns}${by ? `<button class="btn" data-act="unequip" data-hero="${by}" data-slot="${it.s}">Take off</button>` : ''}</div>
      <div class="row wrap">${listBtn}<button class="btn" data-act="lock" data-id="${id}">${it.k ? 'Unlock' : 'Lock'}</button><button class="btn red" data-act="salvage" data-id="${id}" ${by || it.k ? 'disabled' : ''}>Salvage</button></div>
      ${etchUI}${form}</div>`;
  }
  return `<div class="card ${GRADE_TILE[it.g]}">
    <div class="ctitle">${esc(T.itemName(it))}</div>
    <div class="ctop"><span class="tile bare ${GRADE_TILE[it.g]}">${itemIcon(it.s, it.g, T.bandOf(it.l))}</span><div class="cmain"><div class="gname">${gr.n} grade</div>${main}</div></div>
    ${affixes ? `<div class="sec"><h5>Inherent stats</h5>${affixes}</div>` : ''}${sockets}
    <div class="cfoot"><span>${trade}</span><span>${SLOT_LABEL[it.s]}</span><span class="coinline">${A.ic('coin', 1)} ${fmt(salv)} salvage</span><span>Item Lv.${it.l}</span><span class="coinline">${A.ic('mark', 1)} about ${fmt(ref)}</span><span>${by ? 'Worn by ' + HEROES[by].n : it.k ? 'Locked' : ''}</span></div>
    ${actions}
  </div>`;
}
function renderItemCard() {
  const el = $('icard'), it = ui.sel && T.findItem(G, ui.sel);
  if (!it) { el.hidden = true; el._html = ''; return; }
  const html = `<button class="x cardx" data-act="closeCard" aria-label="Close"></button>${itemCardHtml(it, true)}`;
  if (el._html !== html) { el.innerHTML = html; el._html = html; if (ui.listing) updateQuote(); }
  el.hidden = false;
  placeCard(el);
}
function placeCard(el) {
  const a = document.querySelector(`[data-act="sel"][data-id="${CSS.escape(ui.sel)}"], [data-act="gearSlot"][data-id="${CSS.escape(ui.sel)}"]`);
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!a || innerWidth < 640) { el.style.left = Math.max(8, (innerWidth - w) / 2) + 'px'; el.style.top = Math.max(8, (innerHeight - h) / 2) + 'px'; return; }
  const r = a.getBoundingClientRect();
  let x = r.right + 10; if (x + w > innerWidth - 8) x = r.left - w - 10; if (x < 8) x = 8;
  let y = r.top - 10; if (y + h > innerHeight - 8) y = innerHeight - h - 8; if (y < 8) y = 8;
  el.style.left = x + 'px'; el.style.top = y + 'px';
}
function updateQuote() {
  const el = $('listQuote'), inp = $('listPrice'), it = T.findItem(G, ui.listing);
  if (!el || !inp || !it) return;
  const price = Math.round(+inp.value);
  const ref = T.refPrice(T.marketKey(it), serverNow(), ui.peerKeys[T.marketKey(it)] || 0);
  if (!(price >= CFG.FLOOR)) { el.textContent = `The lowest legal price is ${CFG.FLOOR} DND.`; return; }
  const f = T.feesFor(price), sp = T.saleSpeed(price, ref, it.g, false, it.nd);
  el.textContent = `You keep ${fmt(f.net)}, and ${fmt(f.burn)} DND is burned. Reference is ${fmt(ref)}. Sale speed: ${sp.label}, ${sp.detail}.`;
}

// ---------------------------------------------------------------- status: skills
function skillText(k, d, rank) {
  if (!d.act) return d.d;
  const m = T.skillMult(d, Math.max(1, rank));
  return d.d.replace('{m}', Math.round(m * 100)).replace('{r}', Math.round(15 * m)) + ` Used every ${d.every} attacks.`;
}
function winSkills() {
  const k = heroSel(), me = T.skillsOf(G, k), pts = T.skillPoints(G, k);
  const defs = T.SKILLS[k], sel = T.skillDef(k, ui.skill) || T.skillDef(k, T.SIGNATURE[k]);
  ui.skill = sel.k;
  const rank = me.sk[sel.k] || 0, locked = me.lvl < T.SKILL_TIERS[sel.tier], maxed = rank >= sel.max;
  const eq = me.eq.includes(sel.k);
  const shape = d => (d.act ? 'hex' : 'round');
  const canUp = !locked && !maxed && pts.left > 0;
  const upWhy = locked ? `Opens at level ${T.SKILL_TIERS[sel.tier]}` : maxed ? 'Top rank' : pts.left < 1 ? 'No points left' : '';
  const detail = `<div class="skdetail inset">
      <div class="skleft">${A.ic(`em/${sel.icon}/${sel.col}/${shape(sel)}`, 2)}<span class="cnt2">${rank}/${sel.max}</span><b class="skname">${esc(sel.n)}</b></div>
      <div class="skright"><p>${esc(skillText(k, sel, rank))}</p>${sel.act && rank > 0 && rank < sel.max ? `<p class="next">Next rank: ${Math.round(T.skillMult(sel, rank + 1) * 100)}%</p>` : ''}${upWhy ? `<p class="next">${upWhy}</p>` : ''}</div>
      <div class="skbtns">${sel.act ? `<button class="btn teal" data-act="skillEquip" data-hero="${k}" data-k="${sel.k}" ${rank > 0 ? '' : 'disabled'}>${eq ? 'Unequip' : 'Equip'}</button>` : ''}<button class="btn ${canUp ? 'gold' : ''}" data-act="skillUp" data-hero="${k}" data-k="${sel.k}" ${canUp ? '' : 'disabled'}>Level up</button></div>
    </div>`;
  const pointsBar = `<div class="ptsbar"><span class="sico sico-points"></span>Skill points: <b>${pts.left}</b><span class="eqnote">${me.eq.length}/${T.skillSlots(me.lvl)} active equipped</span></div>`;
  const tiers = T.SKILL_TIERS.map((lv, tier) => {
    const open = me.lvl >= lv;
    const nodes = defs.filter(d => d.tier === tier).map(d => {
      const r = me.sk[d.k] || 0, on = me.eq.includes(d.k);
      return `<button class="sknode ${d.k === sel.k ? 'cur' : ''} ${r ? '' : 'unl'} ${d.act ? 'act' : ''}" data-act="pickSkill" data-k="${d.k}" data-tip="skill:${k}:${d.k}" aria-label="${esc(d.n)}, rank ${r} of ${d.max}">${A.ic(`em/${d.icon}/${d.col}/${shape(d)}`, 2)}${on ? '<span class="chk"></span>' : ''}<span class="cnt">${r}/${d.max}</span></button>`;
    }).join('');
    return `<div class="tier ${open ? '' : 'closed'}"><div class="tlabel"><b>${lv}</b>${open ? '' : '<span class="lockic"></span>'}</div><div class="tbox">${nodes}</div></div>`;
  }).join('');
  return `${rosterRow('heroPick')}${detail}${pointsBar}<div class="tree">${tiers}</div>
    <div class="row center"><button class="btn gold" data-act="skillAuto" data-hero="${k}" ${pts.left > 0 ? '' : 'disabled'}>Spend all points</button><button class="btn red" data-act="skillReset" data-hero="${k}" ${pts.spent > 0 ? '' : 'disabled'}>Refund (${fmt(T.skillResetCost(G, k))} coin)</button></div>`;
}

// ---------------------------------------------------------------- forge
function winForge() {
  const f = G.forge, need = T.forgeNeed(f.lvl);
  const cnt = g => T.fuseCandidates(G, g).length;
  const g = ui.fuseG, table = T.FUSE[g], cands = T.fuseCandidates(G, g), have = cands.length, gate = T.FUSE_GATE[g];
  const grades = `<div class="gradefilter">${T.FUSE.map((_, i) => `<button class="gf ${GRADE_TILE[i]} ${g === i ? 'on' : ''}" data-act="fuseG" data-g="${i}" title="${GRADES[i].n}">${cnt(i)}</button>`).join('')}</div>`;
  const cells = Array.from({ length: 9 }, (_, i) => cands[i] ? `<span class="tile ${GRADE_TILE[g]} bare" data-tip="item:${esc(cands[i].id)}">${itemIcon(cands[i].s, cands[i].g, T.bandOf(cands[i].l))}</span>` : '<span class="tile hole"></span>').join('');
  const odds = table.to.map(([to, p]) => `<div class="odd"><span class="oname ${GRADE_TILE[to]}">${GRADES[to].n}${to === g ? ' (no gain)' : to > g + 1 ? ' (great!)' : ''}</span><span class="otrack"><span class="${GRADE_TILE[to]}" style="width:${Math.max(.8, p * 100)}%"></span></span><b>${(p * 100).toFixed(p < .01 ? 2 : 1)}%</b></div>`).join('');
  const slotOpts = `<option value="">Random slot</option>` + SLOTS.map(s => `<option value="${s}" ${ui.fuseSlot === s ? 'selected' : ''}>${SLOT_LABEL[s]}</option>`).join('');
  const can = have >= 9 && f.lvl >= gate && G.coin >= table.cost;
  const res = ui.lastFuse;
  const unlocks = [[CFG.LIST_GATE, 'Selling on the Exchange'], [CFG.ETCH_GATE, 'Etching and stripping gems'], [2, 'Fuse Fine items'], [4, 'Fuse Prized items, choose the result slot'], [6, 'Fuse Relic items'], [8, 'Fuse Mythic items'], [10, 'Fuse Astral items']].sort((a, b) => a[0] - b[0]);
  return `<div class="forgebar"><b>Lv.${f.lvl}</b><div class="xp big" title="${fmt(f.xp)} of ${fmt(need)} XP"><span style="width:${Math.min(100, f.xp / need * 100)}%"></span></div></div>
    ${grades}
    <div class="inset cube"><div class="grid3">${cells}</div></div>
    <div class="row center wrap"><select id="fuseSlot" aria-label="Result slot" ${f.lvl < 4 ? 'disabled title="Choosing a slot opens at Forge level 4"' : ''}>${slotOpts}</select>
      <button class="btn ${can ? 'gold' : ''}" data-act="fuse" ${can ? '' : 'disabled'}>Fuse ${Math.min(have, 9)}/9 · ${fmt(table.cost)} coin</button></div>
    ${f.lvl < gate ? `<p class="sub why center">Fusing ${GRADES[g].n} opens at Forge level ${gate}.</p>` : have < 9 ? `<p class="sub center">Needs 9 unlocked, unworn, unetched ${GRADES[g].n} items.</p>` : ''}
    ${res ? `<p class="result ${GRADE_TILE[res.g]}">${res.text}</p>` : ''}
    <div class="parch forgenote"><p>Fuse 9 items of one grade into 1. Salvaging feeds the Forge. This is how most surplus leaves the game.</p></div>
    <div class="inset odds">${odds}</div>
    <details class="unlockwrap"><summary>Forge unlocks</summary><ul class="unlocks">${unlocks.map(([l, t]) => `<li class="${f.lvl >= l ? 'got' : ''}"><b>${l}</b>${t}</li>`).join('')}</ul></details>`;
}

// ---------------------------------------------------------------- portal: the stage map
function winPortal() {
  const cur = T.stageInfo(G.stage);
  if (ui.portalD === undefined) { ui.portalD = cur.d; ui.portalR = cur.r; }
  const d = ui.portalD, r = ui.portalR, U = S_.ui();
  const diffs = T.DIFFS.map((n, i) => { const open = i * 30 <= G.maxStage; return `<button class="chev ${d === i ? 'on' : ''}" data-act="portalD" data-d="${i}" ${open ? '' : 'disabled'}>${n}</button>`; }).join('');
  const acts = T.REGIONS.map((R, i) => { const open = d * 30 + i * 6 <= G.maxStage; return `<button class="ftab ${r === i ? 'on' : ''}" data-act="portalR" data-r="${i}" ${open ? '' : 'disabled'} title="${esc(R.n)}">Act ${i + 1}</button>`; }).join('');
  const NODES = U ? U.mapNodes : [];
  const nodes = NODES.map(([x, y], n) => {
    const i = d * 30 + r * 6 + n, info = T.stageInfo(i), open = i <= G.maxStage, here = i === G.stage;
    return `<button class="mnode ${here ? 'here' : ''} ${open ? '' : 'lock'} ${info.boss ? 'boss' : ''}" style="left:${x * 2}px;top:${y * 2}px" data-act="goStage" data-i="${i}" ${open ? '' : 'disabled'} title="${esc(info.name)}${info.boss ? ', boss gate' : ''}"><span>${n + 1}</span></button><span class="mlabel" style="left:${x * 2}px;top:${y * 2 + 15}px">${r + 1}-${n + 1}</span>`;
  }).join('');
  return `<div class="chevs">${diffs}</div><div class="tabs2">${acts}</div>
    <div class="mapbox">${A.ic('map/' + r, 2)}<div class="maptitle">${esc(T.REGIONS[r].n)}</div>${nodes}</div>
    <div class="row center"><span class="sub">Now at ${esc(cur.name)}</span><button class="btn ${G.hold ? 'teal' : ''}" data-act="hold" aria-pressed="${G.hold}">${G.hold ? 'Holding here' : 'Hold here'}</button></div>
    <div class="parch regioninfo"><p><b>Roaming here:</b> ${T.REGIONS[r].mons.map(esc).join(', ')}</p><p><b>Boss gate:</b> ${esc(T.REGIONS[r].boss)} (costs a Warden Seal, you have ${G.mats.seal})</p></div>`;
}

// ---------------------------------------------------------------- almanac: the rune board
function winAlmanac() {
  const U = S_.ui();
  if (!U) return '';
  const groups = [...new Set(T.TALENTS.map(t => t.group))];
  const sel = T.talentDef(ui.rune) || T.TALENTS[0];
  ui.rune = sel.k;
  const W = 1040, colW = W / groups.length, nodes = [], lines = [];
  groups.forEach((gr, gi) => {
    const list = T.TALENTS.filter(t => t.group === gr), cx = colW * gi + colW / 2, hub = [cx, 34], cnt = list.length, col = U.runeCol[gr];
    nodes.push(`<div class="rhub" style="left:${cx}px;top:34px">${gr}</div>`);
    list.forEach((t, i) => {
      const row = Math.floor(i / 2), side = i % 2 ? 1 : -1, x = cnt === 1 ? cx : cx + side * 72, y = 112 + row * 96;
      const r = T.talent(G, t.k), cost = r < t.max ? Math.round(t.cost(r)) : 0, can = r < t.max && G.coin >= cost;
      lines.push(`<path d="M${hub[0]} ${hub[1] + 14} L${hub[0]} ${y - 34} L${x} ${y - 34} L${x} ${y - 24}" class="${r ? 'lit' : ''}"/>`);
      nodes.push(`<button class="rnode ${t.k === sel.k ? 'cur' : ''} ${r ? 'got' : ''} ${r >= t.max ? 'max' : ''} ${can ? 'can' : ''}" style="left:${x}px;top:${y}px" data-act="pickRune" data-k="${t.k}" aria-label="${esc(t.n)}, rank ${r} of ${t.max}">${A.ic(`em/${U.runeIcon[t.k]}/${col}/square`, 2)}<span class="cnt">${r}/${t.max}</span></button>`);
    });
  });
  const r = T.talent(G, sel.k), cost = r < sel.max ? Math.round(sel.cost(r)) : 0;
  const can = r < sel.max && G.coin >= cost;
  const card = `<div class="runecard"><div class="rc-top">${A.ic(`em/${U.runeIcon[sel.k]}/${U.runeCol[sel.group]}/square`, 2)}<div><b>${esc(sel.n)}</b><p class="rank">Level ${r} / ${sel.max}</p></div></div><p class="rc-text">${esc(sel.d)}</p>
    ${r >= sel.max ? '<button class="btn white" disabled>Max</button>' : `<button class="btn ${can ? 'gold' : ''}" data-act="talent" data-k="${sel.k}" ${can ? '' : 'disabled'}>${A.ic('coin', 1)} ${shortNum(cost)} coin</button>`}</div>`;
  return `<div class="runehead"><span class="coinchip">${A.ic('coin', 1)} ${shortNum(G.coin)}</span><span class="sub">Permanent upgrades for the whole crew, paid in coin.</span></div>
    <div class="runeboard"><div class="boardwrap" style="width:${W}px"><svg class="rlines" width="${W}" height="400" aria-hidden="true">${lines.join('')}</svg>${nodes.join('')}</div></div>${card}`;
}
function renderTip(spec) {
  const [kind, a, b] = spec.split(':');
  if (kind === 'item') { const it = T.findItem(G, a); return it ? itemCardHtml(it, false) : ''; }
  if (kind === 'skill') {
    const d = T.skillDef(a, b), me = T.skillsOf(G, a), r = me.sk[b] || 0;
    return `<div class="card mini"><div class="ctitle">${esc(d.n)}</div><div class="sec"><p>${esc(skillText(a, d, r))}</p><p class="next">Rank ${r} of ${d.max}${me.lvl < T.SKILL_TIERS[d.tier] ? ` · opens at level ${T.SKILL_TIERS[d.tier]}` : ''}</p></div></div>`;
  }
  return '';
}
// ---------------------------------------------------------------- wallet
const short = addr => (addr ? (addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr) : '');
const walletApi = (path, body) => api(path, body);
function walletPanelState() { return ui.w || (ui.w = { cfg: null, st: null, busy: '', err: '', note: '', dep: '', wd: '', chainOk: null, bal: null, holder: null, lastRead: 0, sent: [] }); }
async function refreshWallet() {
  const W = walletPanelState();
  try {
    W.cfg = await api('/api/chain');
    W.st = await api('/api/wallet');
    const evm = Net.account && Net.account.wallets && Net.account.wallets.evm;
    W.holder = evm ? await Wallet.evmHolding(evm.address) : null;
    if (W.holder && W.cfg.live) {
      W.chainOk = await Wallet.currentChain(W.holder) === W.cfg.chainId;
      W.bal = W.chainOk ? await Wallet.balances(W.holder, evm.address, W.cfg) : null;
    } else { W.chainOk = null; W.bal = null; }
  } catch (e) { /* the next refresh tries again */ }
  W.lastRead = Date.now();
  touch();
}
function txLink(hash, label) {
  const W = ui.w;
  if (!W || !W.cfg || !W.cfg.explorer || !/^0x[0-9a-f]{64}$/i.test(hash || '')) return esc(label || 'Sent');
  return `<a href="${esc(W.cfg.explorer)}/tx/${hash}" target="_blank" rel="noopener noreferrer">${esc(label || short(hash))}</a>`;
}
function winWallet() {
  const W = walletPanelState(), cfg = W.cfg, st = W.st, a = Net.account || {}, wallets = a.wallets || {}, evm = wallets.evm, sol = wallets.sol, sym = T.TOKEN.symbol;
  if (!cfg) { if (Date.now() - W.lastRead > 2000) { W.lastRead = Date.now(); refreshWallet(); } return '<p class="sub center">Checking your wallet…</p>'; }
  const detected = Wallet.list();
  const row = w => `<button class="walletrow" data-act="walletConnect" data-id="${esc(w.id)}" ${W.busy ? 'disabled' : ''}>${w.icon ? `<img src="${esc(w.icon)}" alt="" width="28" height="28">` : `<span class="noicon">${esc(w.name[0])}</span>`}<b>${esc(w.name)}</b><span class="sub">${w.kind === 'evm' ? 'Connect' : 'Sign in only'}</span></button>`;
  const usable = detected.filter(w => !wallets[w.kind]);
  // Only someone with no wallet at all needs to be told where to get one.
  const missing = evm || sol ? [] : Wallet.INSTALL.filter(i => !detected.some(w => w.id === i.id || (w.kind === 'evm' && w.name === i.name)));
  const connect = (!evm || !sol) && (usable.length || missing.length) ? `<div class="inset walletlist"><span class="minihead wide">${evm ? 'Add a wallet' : 'Connect a wallet'}</span>${usable.map(row).join('')}
      ${missing.map(i => `<a class="walletrow get" href="${i.url}" target="_blank" rel="noopener noreferrer"><span class="noicon">${esc(i.name[0])}</span><b>${esc(i.name)}</b><span class="sub">Not found. Get it</span></a>`).join('')}
      <p class="sub">Signing in is free. Your wallet shows a message to sign, which proves it is yours and cannot move funds.</p></div>` : '';
  const linked = kind => {
    const w = wallets[kind]; if (!w) return '';
    return `<div class="linked"><b>${kind === 'evm' ? 'Payout wallet' : 'Solana sign-in'}</b><span>${esc(short(w.address))}</span><button class="btn tiny" data-act="walletUnlink" data-kind="${kind}" ${W.busy ? 'disabled' : ''}>Unlink</button></div>`;
  };
  const status = W.busy ? `<p class="wbusy">${esc(W.busy)}</p>` : W.err ? `<p class="werr">${esc(W.err)}</p>` : W.note ? `<p class="wnote">${W.note}</p>` : '';
  const head = `${status}${evm || sol ? `<div class="inset walletlinks">${linked('evm')}${linked('sol')}</div>` : ''}${connect}`;
  if (!cfg.live) {
    return `${head}${waysBlock(cfg, sym)}<div class="parch regioninfo"><p><b>${sym} is in test mode.</b> The token is not on ${esc(cfg.chainName)} yet, so this balance has no value and will not carry over when it launches. Your linked wallet will.</p></div>
      <div class="inset walletbal"><div class="wbal"><span class="ic-slot">${A.ic('mark', 1)}</span><span>In game</span><b>${fmt(G.marks)} ${sym}</b></div></div>${burnBlock(cfg, sym, false)}`;
  }
  const opensAt = st && st.payoutOpensAt, wait = opensAt && opensAt > serverNow() ? clock(opensAt - serverNow()) : '';
  const open = st ? st.vouchers.filter(v => v.status === 'open') : [];
  const holderNote = evm && !W.holder ? `<p class="sub why">Open your wallet and select ${esc(short(evm.address))} to deposit or claim here.</p>` : '';
  const network = evm && W.holder && W.chainOk === false ? `<div class="row center"><button class="btn gold" data-act="walletSwitch" ${W.busy ? 'disabled' : ''}>Switch to ${esc(cfg.chainName)}</button></div>` : '';
  const closed = cfg.frozen ? 'Withdrawals are stopped while the team checks something. Your balance is safe.' : cfg.paused ? 'Withdrawals are paused on the vault right now.' : !cfg.ready ? 'The chain connection is not ready yet.' : '';
  const canAct = evm && W.holder && W.chainOk && !W.busy;
  const money = evm ? `<div class="inset walletbal">
      <div class="wbal"><span class="ic-slot">${A.ic('mark', 1)}</span><span>In game</span><b>${fmt(G.marks)} ${sym}</b></div>
      <div class="wbal"><span class="ic-slot">${A.ic('mark', 1)}</span><span>In wallet</span><b>${W.bal ? fmt(Number(W.bal.token)) + ' ' + sym : '…'}</b></div>
      <div class="wbal"><span class="ic-slot gas"></span><span>For network fees</span><b>${W.bal ? W.bal.gas.toFixed(5) + ' ' + esc(cfg.currency) : '…'}</b></div>
    </div>${holderNote}${network}
    <div class="inset cashform"><label for="depAmount">Deposit ${sym} into the game</label><div class="row"><input id="depAmount" type="number" min="1" step="1" inputmode="numeric" placeholder="Whole ${sym}" value="${esc(W.dep)}"><button class="btn gold" data-act="depositGo" ${canAct ? '' : 'disabled'}>Deposit</button></div>
      <p class="sub">Arrives once the network confirms it, usually about 15 minutes. Always use this button: ${sym} sent straight to the vault is not credited.</p></div>
    <div class="inset cashform"><label for="wdAmount">Withdraw ${sym} to your wallet</label><div class="row"><input id="wdAmount" type="number" min="${cfg.limits.min}" step="1" inputmode="numeric" placeholder="At least ${cfg.limits.min}" value="${esc(W.wd)}"><button class="btn teal" data-act="withdrawGo" ${!closed && !wait && !W.busy && !open.length ? '' : 'disabled'}>Withdraw</button></div>
      <p class="sub">${closed ? `<span class="why">${esc(closed)}</span>` : wait ? `<span class="why">Opens in ${wait}. New wallets and crews wait, in case someone gets into your account.</span>` : `${fmt(st ? st.leftToday : 0)} ${sym} left today. You pay a small network fee in ${esc(cfg.currency)}.`}</p></div>
    ${st && st.vouchers.length ? `<div class="inset vouchers"><span class="minihead wide">Withdrawals</span>${st.vouchers.map(v => `<div class="voucher ${v.status}"><b>${fmt(v.whole)} ${sym}</b>${v.status === 'open'
      ? `<span class="sub">Claim within ${clock(v.expiry * 1000 - serverNow())}</span><button class="btn tiny gold" data-act="claimGo" data-id="${esc(v.id)}" ${canAct ? '' : 'disabled'}>Claim</button>`
      : `<span class="sub">${v.status === 'claimed' ? txLink(v.tx, 'Paid') : 'Expired and returned'}</span>`}</div>`).join('')}</div>` : ''}
    ${st && st.deposits.length ? `<div class="inset vouchers"><span class="minihead wide">Deposits</span>${st.deposits.map(d => `<div class="voucher"><b>${fmt(d.whole)} ${sym}</b><span class="sub">${txLink(d.tx, 'Credited')}</span></div>`).join('')}</div>` : ''}
    ${burnBlock(cfg, sym, canAct)}
    <p class="sub center">Transactions on ${esc(cfg.chainName)} are final and cannot be reversed.</p>` : `${burnBlock(cfg, sym, false)}<div class="parch regioninfo"><p><b>${sym} lives on ${esc(cfg.chainName)}.</b> Connect an Ethereum-type wallet such as MetaMask or Phantom to deposit and withdraw. Solana wallets can sign in, but cannot receive ${sym}.</p></div>`;
  return head + waysBlock(cfg, sym) + money;
}
function waysBlock(cfg, sym) {
  const has = cfg.rewards > 0;
  return `<div class="inset ways"><span class="minihead wide">Two ways to get ${sym}</span>
    <div class="way"><b>Buy it</b><span class="sub">On the market, then deposit it below.</span>${cfg.market ? `<a class="btn small teal" href="${esc(cfg.market)}" target="_blank" rel="noopener noreferrer">Market</a>` : '<span class="sub">Link coming</span>'}</div>
    <div class="way"><b>Earn it</b><span class="sub">${!cfg.live ? `Drifters pay test ${sym} for your loot here. Real ${sym} starts once the rewards vault is filled.` : has ? `Drifters pay for your loot from the rewards vault. ${fmt(cfg.rewards)} ${sym} left.` : 'Opens once the rewards vault is filled.'}</span><button class="btn small" data-act="openExchange">Exchange</button></div></div>`;
}
function burnBlock(cfg, sym, canAct) {
  const b = cfg.burn, open = cfg.live && b.open;
  return `<div class="inset burnbox"><div class="wbal"><span class="burnflame"></span><span>Burned forever</span><b>${fmt(b.burned)} ${sym}</b></div>
    <div class="wbal"><span></span><span>Spent, waiting to burn</span><b>${fmt(b.waiting)} ${sym}</b></div>
    <p class="sub">Every ${sym} spent in the game is destroyed, for good.${open ? ' Anyone can send the next batch and pay the network fee.' : ''}</p>
    ${open ? `<div class="row center"><button class="btn red" data-act="burnGo" ${canAct ? '' : 'disabled'}>Burn ${fmt(open.whole)} ${sym}</button></div>` : ''}</div>`;
}
async function walletDo(busy, fn) {
  const W = walletPanelState();
  W.busy = busy; W.err = ''; W.note = ''; touch();
  try { await fn(W); } catch (e) { W.err = e && e.message && !e.code ? e.message : Wallet.explain(e); }
  W.busy = ''; touch();
  refreshWallet();
}
function spark(key, now, color) {
  const pts = [];
  for (let i = 24; i >= 0; i--) pts.push(T.refPrice(key, now - i * HOUR));
  const lo = Math.min(...pts), hi = Math.max(...pts), w = 84, h = 22;
  const xy = pts.map((p, i) => [i / 24 * (w - 4) + 2, hi === lo ? h / 2 : h - 3 - (p - lo) / (hi - lo) * (h - 6)]);
  const d = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const last = xy[xy.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="24 hour price, from ${pts[0]} to ${pts[24]} DND" data-pts="${pts.join(',')}"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2" fill="${color}"/></svg>`;
}
function panelExchange() {
  const now = serverNow(), m = G.market, acct = Net.account;
  const ev = T.eventFor(now);
  const eligible = acct && acct.peerEligible;
  const status = Net.offline ? ['Offline', 'Reconnecting to the server.']
    : eligible ? ['Live market', `${Net.peers.size} open listing${Net.peers.size === 1 ? '' : 's'} from other crews.`]
    : acct && acct.guest ? ['Drifters only', 'Save your crew in the Ledger to trade with other crews.']
    : ['Drifters only', `Trading with other crews opens in ${clock(acct.peerOpensAt - now)}.`];
  const pillClass = Net.offline ? 'solo' : eligible ? 'shared' : 'readonly';
  const forgeLock = G.forge.lvl < CFG.LIST_GATE;
  const slotCards = m.slots.map((readyAt, i) => {
    const rec = m.mine.find(r => r.slot === i);
    if (rec) {
      const name = rec.mat ? `${rec.qty} × ${MATS[rec.mat].n}` : T.keyName(rec.key);
      const icon = rec.mat ? matIcon(rec.mat) : itemIcon(rec.item.s, rec.item.g, T.bandOf(rec.item.l), 1);
      const ref = T.refPrice(rec.key, now);
      const sp = rec.mat ? null : T.saleSpeed(rec.price, ref, rec.item.g, false, rec.item.nd);
      return `<div class="lslot busy"><div class="dhead">${icon}<div><b>${esc(name)}</b><p class="sub">${rec.item ? GRADES[rec.item.g].n + ' · ' : ''}<span class="num">${fmt(rec.price)} DND</span>${sp ? ' · ' + sp.label : ''}</p></div></div><button class="btn tiny" data-act="cancelList" data-id="${esc(rec.id)}">Cancel</button></div>`;
    }
    if (readyAt > now) return `<div class="lslot cool"><b>Cooling down</b><p class="sub num">${clock(readyAt - now)}</p></div>`;
    return `<div class="lslot free"><b>Free slot</b><p class="sub">${forgeLock ? `Opens at Forge ${CFG.LIST_GATE}` : 'List from the Pack'}</p></div>`;
  }).join('');
  const ladder = T.gradeLadder(now);
  const gradeChips = `<button class="chip" aria-pressed="${ui.mkGrade < 0}" data-act="mkGrade" data-g="-1">All</button>` + ladder.map(r => `<button class="chip" aria-pressed="${ui.mkGrade === r.g}" data-act="mkGrade" data-g="${r.g}">${gem(r.g)}${r.name}<span class="num dim"> ${shortNum(r.median)}</span></button>`).join('') + `<button class="chip" aria-pressed="${ui.mkGrade === 99}" data-act="mkGrade" data-g="99">Materials</button>`;
  const q = ui.mkQuery.toLowerCase();
  let keys = [];
  if (ui.mkGrade === 99) keys = Object.keys(MATS).map(k => 'mat.' + k);
  else {
    const grades = ui.mkGrade < 0 ? [7, 6, 5, 4, 3] : [ui.mkGrade];
    for (const g of grades) keys.push(...T.allKeysForGrade(g));
    if (ui.mkGrade < 0) keys.push(...Object.keys(MATS).map(k => 'mat.' + k));
  }
  if (ui.mkSlot) keys = keys.filter(k => k.startsWith(ui.mkSlot + '.'));
  if (q) keys = keys.filter(k => T.keyName(k).toLowerCase().includes(q));
  const rows = keys.map(k => ({ k, ask: T.driftAsk(k, now, ui.peerKeys[k] || 0) }));
  rows.sort((a, b) => ui.mkSort === 'asc' ? a.ask - b.ask : b.ask - a.ask);
  const total = rows.length;
  const shown = rows.slice(0, 36);
  const hourB = Math.floor(now / HOUR);
  const tr = shown.map(({ k, ask }) => {
    const p = T.parseKey(k), col = p.mat ? MATS[p.mat].c : GRADES[p.g].c;
    const out = m.drift[k] === hourB, poor = G.marks < ask;
    const atFloor = ask <= CFG.FLOOR;
    return `<tr><td class="nm">${p.mat ? matIcon(p.mat) : `<span class="tile mini ${GRADE_TILE[p.g]}">${itemIcon(p.s, p.g, p.b, 1)}</span>`}<span class="tx"><b>${esc(T.keyName(k))}</b><small>${p.mat ? 'Material' : GRADES[p.g].n + ' · ' + SLOT_LABEL[p.s]}</small></span></td>
      <td class="num hide-s">${shortNum(T.supplyCount(k, now))}</td>
      <td class="hide-s">${spark(k, now, col)}</td>
      <td class="num">${fmt(ask)}${atFloor ? '<small class="floor">floor</small>' : ''}</td>
      <td><button class="btn tiny" data-act="buyDrift" data-key="${k}" data-ask="${ask}" ${out || poor ? 'disabled' : ''} title="${out ? 'Sold out for this hour' : poor ? 'Not enough DND' : ''}">${out ? 'Sold out' : 'Buy'}</button></td></tr>`;
  }).join('');
  const peers = [...Net.peers.values()].sort((a, b) => a.price - b.price).slice(0, 30);
  const peerRows = peers.map(l => {
    const p = T.parseKey(l.key);
    return `<tr><td class="nm">${l.mat ? matIcon(l.mat) : `<span class="tile mini ${GRADE_TILE[p.g]}">${itemIcon(p.s, p.g, p.b, 1)}</span>`}<span class="tx"><b>${esc(l.mat ? l.qty + ' × ' + MATS[l.mat].n : T.keyName(l.key))}</b><small>${l.mat ? 'Material' : GRADES[p.g].n + ' · Level ' + l.item.l} · sold by ${esc(l.crew)}</small></span></td><td class="num">${fmt(l.price)}</td><td><button class="btn tiny lamp" data-act="buyPeer" data-id="${esc(l.id)}" data-price="${l.price}" ${G.marks < l.price || !eligible ? 'disabled' : ''}>Buy</button></td></tr>`;
  }).join('');
  const matOpts = Object.keys(MATS).filter(k => G.mats[k] > 0).map(k => `<option value="${k}">${MATS[k].n} (${G.mats[k]})</option>`).join('');
  return `<div class="headrow"><h2>Exchange</h2><p class="sub"><span class="pill ${pillClass}">${status[0]}</span> ${esc(status[1])} ${acct && acct.live ? 'DND moves in and out through the Wallet.' : 'This is test DND. It has no value and will not carry over when the token launches.'}</p></div>
  ${ui.w && ui.w.cfg && ui.w.cfg.live ? `<p class="bulletin ${ui.w.cfg.rewards > 0 ? 'shortage' : ''}"><b>Rewards vault</b> ${ui.w.cfg.rewards > 0 ? `Drifters are paying for loot: ${fmt(ui.w.cfg.rewards)} DND left, for crews with a linked wallet.` : 'Empty for now, so drifters are not paying. Other crews still can.'}</p>` : ''}
  <p class="bulletin ${ev.kind}"><b>Bulletin</b> ${esc(ev.text)} <span class="dim">Next report in ${clock((ev.b + 1) * 12 * HOUR - now)}.</span></p>
  <h3>Your listings</h3>
  <div class="lslots">${slotCards}</div>
  <p class="sub">${CFG.LIST_SLOTS} slots. Each one cools for ${CFG.LIST_COOLDOWN / HOUR} hours after you use it, so list what is worth listing. ${CFG.FEE_BURN * 100}% of every sale is burned, at least 2 DND.</p>
  ${matOpts && !forgeLock ? `<form class="matform" id="matForm"><label for="matSel">Sell materials</label><select id="matSel">${matOpts}</select><label for="matQty">Qty</label><input id="matQty" type="number" min="1" value="1" inputmode="numeric"><label for="matPrice">Bundle price</label><input id="matPrice" type="number" min="${CFG.FLOOR}" value="${CFG.FLOOR}" inputmode="numeric"><button class="btn" type="submit">List bundle</button><span class="sub" id="matQuote"></span></form>` : ''}
  <h3>Other crews</h3>
  ${peerRows ? `<div class="tablewrap"><table class="mk"><thead><tr><th>Item</th><th class="num">DND</th><th></th></tr></thead><tbody>${peerRows}</tbody></table></div>` : '<p class="empty">No other crews are selling right now. When you list something, they see it here.</p>'}
  <h3>Drifter board</h3>
  <div class="chips">${gradeChips}</div>
  <div class="row wrap filters"><input id="mkQuery" type="search" placeholder="Search item names" value="${esc(ui.mkQuery)}" aria-label="Search item names"><select id="mkSlot" aria-label="Filter by slot"><option value="">Any slot</option>${SLOTS.map(s => `<option value="${s}" ${ui.mkSlot === s ? 'selected' : ''}>${SLOT_LABEL[s]}</option>`).join('')}</select><select id="mkSort" aria-label="Sort by price"><option value="asc" ${ui.mkSort === 'asc' ? 'selected' : ''}>Cheapest first</option><option value="desc" ${ui.mkSort === 'desc' ? 'selected' : ''}>Priciest first</option></select><span class="sub">${total > shown.length ? `Showing ${shown.length} of ${total}.` : `${total} item types.`} Anything here carries a ${CFG.RESALE_LOCK / HOUR}-hour resale lock.</span></div>
  <div class="tablewrap"><table class="mk"><thead><tr><th>Item</th><th class="num hide-s">Listed</th><th class="hide-s">24 h price</th><th class="num">Ask</th><th></th></tr></thead><tbody>${tr || '<tr><td colspan="5" class="empty">No items match. Clear the search to see the board.</td></tr>'}</tbody></table></div>`;
}
function updateMatQuote() {
  const el = $('matQuote'), p = $('matPrice'); if (!el || !p) return;
  const price = Math.round(+p.value);
  el.textContent = price >= CFG.FLOOR ? `You keep ${fmt(T.feesFor(price).net)}.` : `Lowest price is ${CFG.FLOOR}.`;
}
function accountPanel() {
  const a = Net.account;
  if (!a) return '';
  if (!a.guest) {
    return `<h3>Account</h3><div class="row wrap"><span>Logged in as <b>${esc(a.name || short((a.wallets.evm || a.wallets.sol || {}).address))}</b>.</span><button class="btn" data-act="logout">Log out</button></div>${a.peerEligible ? '' : `<p class="sub">Trading with other crews opens in ${clock(a.peerOpensAt - serverNow())}.</p>`}`;
  }
  return `<h3 id="accountHead">Save your crew</h3>
  <p class="sub">You are playing as a guest. This crew lives in this browser's cookie until you save it, and guests can only trade with drifters. There is no email reset yet, so keep your password safe.</p>
  <div class="authwrap">
    <form class="authform" id="claimForm"><h4>Save this crew</h4>
      <label for="claimName">Account name</label><input id="claimName" autocomplete="username" required minlength="3" maxlength="20">
      <label for="claimPass">Password, 8 characters or more</label><input id="claimPass" type="password" autocomplete="new-password" required minlength="8" maxlength="200">
      <button class="btn gold" type="submit">Save crew</button></form>
    <form class="authform" id="loginForm"><h4>I already have an account</h4>
      <label for="loginName">Account name</label><input id="loginName" autocomplete="username" required>
      <label for="loginPass">Password</label><input id="loginPass" type="password" autocomplete="current-password" required>
      <button class="btn" type="submit">Log in</button></form>
  </div>`;
}
function panelLedger() {
  const now = serverNow(), L = G.ledger;
  const coinIn = L.coinKills + L.coinSalvage + L.coinAway, coinOut = L.coinTalents + L.coinForge;
  const rows = T.gradeLadder(now).map(r => `<tr><td class="nm2">${gem(r.g)}${r.name}</td><td class="num">${shortNum(r.median)}</td><td class="num hide-s">${shortNum(r.low)} to ${shortNum(r.high)}</td><td class="floorcell"><span class="ftrack"><span style="width:${r.atFloor * 100}%"></span></span><b class="num">${Math.round(r.atFloor * 100)}%</b></td><td class="num hide-s">${shortNum(r.supply)}</td><td class="num">${r.change >= 0 ? '+' : ''}${(r.change * 100).toFixed(0)}%</td></tr>`).join('');
  const flow = (label, val, max) => `<div class="flow"><span>${label}</span><span class="ftrack"><span style="width:${max ? Math.max(val ? 1 : 0, val / max * 100) : 0}%"></span></span><b class="num">${shortNum(val)}</b></div>`;
  const cmax = Math.max(L.coinKills, L.coinSalvage, L.coinAway, L.coinTalents, L.coinForge, 1);
  const board = Net.board.length ? `<ol class="board">${Net.board.map(b => `<li class="${b.me ? 'me' : ''}"><span>${esc(b.crew)}${b.me ? ' (you)' : ''}</span><span class="num">stage ${fmt(b.stage)}</span><b class="num">${shortNum(b.worth)} M</b></li>`).join('')}</ol>` : `<p class="empty">No saved crews on the board yet. Yours appears a minute or so after you save it.</p>`;
  const mail = G.mail.slice(0, 14).map(m => `<li><span class="dim num">${ago(m.at)}</span> ${esc(m.text)}</li>`).join('');
  return `<div class="headrow"><h2>Ledger</h2><p class="sub">Every economy comes down to what enters and what leaves. Here is yours.</p></div>
  ${accountPanel()}
  <div class="split even"><section>
    <h3>Coin in and out</h3>
    ${flow('Kills and clears', L.coinKills, cmax)}${flow('Salvage', L.coinSalvage, cmax)}${flow('Away income', L.coinAway, cmax)}${flow('Almanac', L.coinTalents, cmax)}${flow('Forge', L.coinForge, cmax)}
    <p class="sub">Earned <b class="num">${shortNum(coinIn)}</b>, spent <b class="num">${shortNum(coinOut)}</b>.</p>
    <h3>Items</h3>
    <dl class="stats col"><div><dt>Found or made</dt><dd>${fmt(L.itemsMade)}</dd></div><div><dt>Salvaged or fused away</dt><dd>${fmt(L.itemsBurned)}</dd></div><div><dt>Best find</dt><dd>${GRADES[G.stats.best].n}</dd></div></dl>
  </section><section>
    <h3>DND</h3>
    <dl class="stats col"><div><dt>Balance</dt><dd>${fmt(G.marks)}</dd></div><div><dt>Net worth</dt><dd>${fmt(T.netWorth(G, now))}</dd></div><div><dt>Kept from ${fmt(L.sold)} sale${L.sold === 1 ? '' : 's'}</dt><dd>${fmt(L.marksIn)}</dd></div><div><dt>Spent on ${fmt(L.bought)} purchase${L.bought === 1 ? '' : 's'}</dt><dd>${fmt(L.marksOut)}</dd></div><div class="hl"><dt>Burned by you</dt><dd>${fmt(L.burned || 0)}</dd></div>${L.deposited ? `<div><dt>Deposited</dt><dd>${fmt(L.deposited)}</dd></div>` : ''}${L.withdrawn ? `<div><dt>Withdrawn</dt><dd>${fmt(L.withdrawn)}</dd></div>` : ''}</dl>
    <h3>Crew name</h3>
    <div class="row"><input id="crewName" maxlength="20" value="${esc(G.crew)}" aria-label="Crew name"><button class="btn" data-act="saveName">Save name</button></div>
  </section></div>
  <h3>Price ladder</h3>
  <p class="sub">A large share at the floor means that grade earns its seller almost nothing. The burn alone takes 2 of the 3 DND at the floor.</p>
  <div class="tablewrap"><table class="mk ladder"><thead><tr><th>Grade</th><th class="num">Median</th><th class="num hide-s">Range</th><th>At the floor</th><th class="num hide-s">Listed</th><th class="num">24 h</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="sub credit">RobinCat comes from the RobinCat community (robincat.club). This game is not affiliated with or endorsed by the RobinCat community or Robinhood Markets.</p>
  <div class="split even"><section><h3>Crews by net worth</h3>${board}</section>
  <section><h3>Mailbox</h3><ul class="maillist">${mail || '<li class="empty">Nothing yet.</li>'}</ul></section></div>`;
}

// ---------------------------------------------------------------- actions
const actions = {
  toggleHero: d => send('toggleHero', { hero: d.hero }),
  buyHeroAsk: d => { ui.buyHero = d.hero; touch(); },
  buyHeroCancel: () => { ui.buyHero = null; touch(); },
  buyHeroGo: d => { ui.buyHero = null; send('buyHero', { hero: d.hero, price: Net.heroPrice }, () => { Sound.fx('burn'); return `${HEROES[d.hero].n} joined your crew.`; }); touch(); },
  soundToggle: () => { Sound.setMuted(!Sound.prefs.muted); syncSound(); },
  soundPanel: () => { const p = $('soundPanel'); p.hidden = !p.hidden; $('soundMore').setAttribute('aria-expanded', String(!p.hidden)); },
  equipBest: d => send('equipBest', { hero: d.hero }, () => `${HEROES[d.hero].n} is wearing the best available gear.`),
  gearSlot: d => {
    ui.equipFor = d.hero; ui.slotF = d.slot; ui.gradeF = -1;
    ui.sel = G.heroes[d.hero].gear[d.slot] || null; ui.listing = null;
    if (!isOpen('pack') || columns() < 3) { const keep = ui.sel; openWin('pack'); ui.sel = keep; }
    touch();
  },
  closeWin: d => closeWin(d.w),
  openWallet: () => openWin('wallet'),
  walletConnect: d => walletDo('Confirm in your wallet…', async () => {
    const proof = await Wallet.signIn(d.id, walletApi, 'signin');
    const sentAt = Date.now();
    adopt(await api('/api/wallet/verify', { nonce: proof.nonce, signature: proof.signature }), sentAt);
    Wallet.remember(d.id);
    pollMarket();
    say('Wallet connected.', 'good');
  }),
  walletUnlink: d => walletDo('Confirm in your wallet…', async () => {
    const w = Net.account.wallets[d.kind];
    const holder = d.kind === 'evm' ? await Wallet.evmHolding(w.address) : Wallet.list().find(x => x.kind === 'sol');
    if (!holder) throw new Error(`Open the wallet holding ${short(w.address)} first.`);
    const proof = await Wallet.signIn(holder.id, walletApi, 'unlink');
    const sentAt = Date.now();
    adopt(await api('/api/wallet/unlink', { nonce: proof.nonce, signature: proof.signature }), sentAt);
    say('Wallet unlinked. A newly linked wallet waits 3 days before withdrawals.');
  }),
  walletSwitch: () => walletDo('Confirm in your wallet…', async W => { await Wallet.ensureChain(W.holder, W.cfg); }),
  depositGo: () => walletDo('Getting your wallet ready…', async W => {
    const whole = Number(W.dep), from = Net.account.wallets.evm.address;
    if (!Number.isInteger(whole) || whole < 1) throw new Error('Enter a whole number of DND.');
    await Wallet.ensureChain(W.holder, W.cfg);
    const hash = await Wallet.deposit(W.holder, from, W.cfg, whole, step => { W.busy = step; touch(); });
    W.dep = '';
    W.note = `Sent. ${fmt(whole)} DND arrives once the network confirms it, usually about 15 minutes. ${txLink(hash, 'View it')}`;
  }),
  withdrawGo: () => walletDo('Preparing your withdrawal…', async W => {
    const whole = Number(W.wd);
    if (!Number.isInteger(whole) || whole < 1) throw new Error('Enter a whole number of DND.');
    const sentAt = Date.now();
    const s = await api('/api/action', { type: 'withdraw', args: { whole } });
    adopt(s, sentAt);
    W.wd = '';
    W.note = `Ready. Press Claim to receive ${fmt(whole)} DND in your wallet.`;
  }),
  openExchange: () => openWin('exchange'),
  burnGo: () => walletDo('Confirm in your wallet…', async W => {
    const open = W.cfg.burn && W.cfg.burn.open;
    if (!open || !open.data) throw new Error('That burn is not open any more.');
    await Wallet.ensureChain(W.holder, W.cfg);
    const hash = await Wallet.claim(W.holder, Net.account.wallets.evm.address, W.cfg, open.data);
    W.note = `Burned ${fmt(open.whole)} DND. Thank you. ${txLink(hash, 'View it')}`;
  }),
  claimGo: d => walletDo('Confirm in your wallet…', async W => {
    const v = W.st.vouchers.find(x => x.id === d.id);
    if (!v || !v.data) throw new Error('That withdrawal is not open any more.');
    await Wallet.ensureChain(W.holder, W.cfg);
    const hash = await Wallet.claim(W.holder, Net.account.wallets.evm.address, W.cfg, v.data);
    W.note = `Paid. It is in your wallet now, and the game records it within about 15 minutes. ${txLink(hash, 'View it')}`;
  }),
  closeCard: () => { ui.closeCard(); touch(); },
  endChoose: () => { ui.equipFor = null; ui.slotF = ''; touch(); },
  heroPick: d => { ui.hero = d.hero; touch(); },
  heroStep: d => { const i = HERO_KEYS.indexOf(heroSel()); ui.hero = HERO_KEYS[(i + +d.d + HERO_KEYS.length) % HERO_KEYS.length]; touch(); },
  heroView: d => { ui.heroView = d.v; touch(); },
  openSkill: d => { ui.hero = d.hero; if (d.k) ui.skill = d.k; openWin('skills'); },
  pickSkill: d => { ui.skill = d.k; touch(); },
  pickRune: d => { ui.rune = d.k; touch(); },
  skillUp: d => send('skillUp', { hero: d.hero, k: d.k }),
  skillEquip: d => send('skillEquip', { hero: d.hero, k: d.k }),
  skillAuto: d => send('skillAuto', { hero: d.hero }, r => (r.n ? `Spent ${r.n} skill point${r.n === 1 ? '' : 's'}.` : '')),
  skillReset: d => send('skillReset', { hero: d.hero }, r => `Refunded all points for ${fmt(r.cost)} coin.`),
  portalD: d => { ui.portalD = +d.d; ui.portalR = 0; touch(); },
  portalR: d => { ui.portalR = +d.r; touch(); },
  goStage: d => send('jumpStage', { i: +d.i, hold: true }),
  gradeF: d => { ui.gradeF = +d.g; touch(); },
  slotF: d => { ui.slotF = d.s; touch(); },
  sel: d => { ui.sel = d.id; ui.listing = null; touch(); },
  equip: d => { ui.equipFor = null; ui.sel = null; ui.slotF = ''; return send('equip', { hero: d.hero, id: d.id }, () => `Equipped on ${HEROES[d.hero].n}.`); },
  unequip: d => send('unequip', { hero: d.hero, slot: d.slot }),
  lock: d => send('lock', { id: d.id }, r => r.locked ? 'Locked. Bulk actions will skip it.' : 'Unlocked.'),
  salvage: d => send('salvage', { id: d.id }, r => { ui.sel = null; ui.listing = null; return `Salvaged for ${fmt(r.coin)} coin.`; }),
  bulkSalvage: d => send('salvageUpTo', { g: +d.g }, r => { ui.sel = null; return r.n ? `Salvaged ${r.n} items for ${fmt(r.coin)} coin.` : 'Nothing to salvage.'; }),
  etch: d => send('etch', { id: d.id, t: +d.t, s: +d.s }, () => 'Etched.'),
  strip: d => send('strip', { id: d.id }, r => `Stripped for ${fmt(r.cost)} coin. The gems are gone.`),
  openList: d => { ui.listing = d.id; touch(); },
  closeList: () => { ui.listing = null; touch(); },
  confirmList: d => {
    const it = T.findItem(G, d.id), price = Math.round(+$('listPrice').value);
    const name = it ? T.itemName(it) : 'item';
    if (document.activeElement) document.activeElement.blur();
    return send('list', { itemId: d.id, price }, () => { ui.listing = null; ui.sel = null; pollMarket(); return `Listed your ${name} for ${fmt(price)} DND.`; });
  },
  cancelList: d => send('cancelList', { id: d.id }, () => { pollMarket(); return 'Listing cancelled. The slot stays on cooldown.'; }),
  fuseG: d => { ui.fuseG = +d.g; ui.lastFuse = null; touch(); },
  fuse: () => {
    const sel = $('fuseSlot');
    ui.fuseSlot = sel && G.forge.lvl >= 4 ? sel.value : '';
    const args = { g: ui.fuseG };
    if (ui.fuseSlot) args.slot = ui.fuseSlot;
    return send('fuse', args, r => {
      const g = r.item.g, name = `${GRADES[g].n} ${T.itemName(r.item)}`;
      ui.lastFuse = { g, text: r.stayed ? `No upgrade. You got a ${esc(name)}.` : r.jumped ? `Great success! You got a ${esc(name)}.` : `You got a ${esc(name)}.` };
      say(name, g >= 4 ? 'big' : '', GRADES[g].c);
      touch();
    });
  },
  buyDrift: d => send('buyDrifter', { key: d.key, maxPrice: +d.ask }, r => `Bought for ${fmt(r.price)} DND. It is in your Pack.`),
  buyPeer: d => send('buyPeer', { id: d.id, price: +d.price }, () => { pollMarket(); return 'Bought. It is in your Pack.'; }),
  mkGrade: d => { ui.mkGrade = +d.g; touch(); },
  talent: d => send('talent', { k: d.k }, () => `${T.talentDef(d.k).n} upgraded.`),
  saveName: () => { const name = $('crewName').value.trim(); return send('setCrew', { name }, () => 'Crew name saved.'); },
  openChest: () => send('openChest', {}, r => { announceLoot(r.r); }),
  stagePrev: () => send('jumpStage', { i: G.stage - 1, hold: true }),
  stageNext: () => send('jumpStage', { i: G.stage + 1 }),
  hold: () => send('hold', { on: !G.hold }),
  goAccount: () => { ui.wide = null; openWin('ledger'); },
  logout: async () => {
    try { await api('/api/logout', {}); localStorage.setItem('tf.loggedOut', '1'); } catch (e) { /* the reload shows the real state */ }
    location.reload();
  },
  gateConnect: async d => {
    $('gateMsg').textContent = 'Confirm in your wallet…';
    try {
      const proof = await Wallet.signIn(d.id, walletApi, 'signin');
      await auth('/api/wallet/verify', { nonce: proof.nonce, signature: proof.signature });
      Wallet.remember(d.id);
      say('Wallet connected. The Kitten Knight is ready.', 'good');
    } catch (e) { $('gateMsg').textContent = e && e.message && !e.code ? e.message : Wallet.explain(e); }
  },
  gateNew: async () => {
    try { await auth('/api/guest', {}); } catch (e) { $('gateMsg').textContent = e.message; }
  },
};
ui.closeCard = () => { ui.sel = null; ui.listing = null; };
const clearForm = id => { const f = $(id); if (f) f.querySelectorAll('input').forEach(i => { i.value = ''; }); };

function syncSound() {
  const s = Sound.prefs, label = s.muted ? 'Turn sound on' : 'Mute sound', b = $('soundBtn');
  b.setAttribute('aria-pressed', String(s.muted)); b.setAttribute('aria-label', label); b.title = label;
  $('musicLevel').value = Math.round(s.music * 100); $('sfxLevel').value = Math.round(s.sfx * 100);
}
function wireSound() {
  syncSound();
  $('musicLevel').addEventListener('input', e => Sound.setMusic(e.target.value / 100));
  $('sfxLevel').addEventListener('input', e => Sound.setSfx(e.target.value / 100));
  document.addEventListener('click', e => { if (!e.target.closest('.soundctl')) { $('soundPanel').hidden = true; $('soundMore').setAttribute('aria-expanded', 'false'); } });
}
function wire() {
  wireSound();
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled && actions[b.dataset.act]) { actions[b.dataset.act](b.dataset); ui.pressing = false; maybeRender(); return; }
    const r = e.target.closest('#rail [data-win]');
    if (r && G) { openWin(r.dataset.win); return; }
    // A click on empty space closes the open item card.
    if (ui.sel && !e.target.closest('#icard') && !e.target.closest('.tile')) { ui.closeCard(); touch(); maybeRender(); }
  });
  cv().addEventListener('click', e => {
    const r = cv().getBoundingClientRect();
    if (G && G.chests.length && (e.clientX - r.left) / r.width > .82) actions.openChest();
  });
  document.addEventListener('pointerdown', () => { ui.pressing = true; });
  document.addEventListener('pointerup', () => { ui.pressing = false; });
  document.addEventListener('pointercancel', () => { ui.pressing = false; });
  document.addEventListener('input', e => {
    const id = e.target.id;
    if (id === 'listPrice') updateQuote();
    if (id === 'matPrice') updateMatQuote();
    if (id === 'depAmount') walletPanelState().dep = e.target.value;
    if (id === 'wdAmount') walletPanelState().wd = e.target.value;
    if (id === 'mkQuery') { ui.mkQuery = e.target.value; const pos = e.target.selectionStart; renderDesk(); const n = $('mkQuery'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'mkSlot') { ui.mkSlot = e.target.value; e.target.blur(); touch(); }
    if (e.target.id === 'mkSort') { ui.mkSort = e.target.value; e.target.blur(); touch(); }
    if (e.target.id === 'fuseSlot') { ui.fuseSlot = e.target.value; }
  });
  document.addEventListener('submit', async e => {
    const id = e.target.id;
    e.preventDefault();
    if (id === 'matForm') {
      const mat = $('matSel').value, qty = Math.floor(+$('matQty').value), price = Math.round(+$('matPrice').value);
      if (document.activeElement) document.activeElement.blur();
      send('list', { mat, qty, price }, () => { pollMarket(); return `Listed ${qty} × ${MATS[mat].n} for ${fmt(price)} DND.`; });
    } else if (id === 'claimForm' || id === 'loginForm') {
      const name = $(id === 'claimForm' ? 'claimName' : 'loginName').value.trim();
      const password = $(id === 'claimForm' ? 'claimPass' : 'loginPass').value;
      try {
        await auth(id === 'claimForm' ? '/api/register' : '/api/login', { name, password });
        clearForm(id);
        if (document.activeElement) document.activeElement.blur();
        say(id === 'claimForm' ? 'Your crew is saved.' : `Welcome back, ${name}.`, 'good');
        touch();
      } catch (err) { say(err.message, 'warn'); }
    } else if (id === 'gateForm') {
      try {
        await auth('/api/login', { name: $('gateName').value.trim(), password: $('gatePass').value });
        clearForm(id);
      } catch (err) { $('gateMsg').textContent = err.message; }
    }
  });
  document.addEventListener('mousemove', e => {
    const tip = $('tip');
    const s = e.target.closest ? e.target.closest('.spark') : null;
    if (!s) { tip.hidden = true; return; }
    const r = s.getBoundingClientRect(), pts = s.dataset.pts.split(',');
    const i = Math.max(0, Math.min(24, Math.round((e.clientX - r.left) / r.width * 24)));
    tip.textContent = `${24 - i === 0 ? 'Now' : (24 - i) + ' h ago'}: ${fmt(+pts[i])} DND`;
    tip.hidden = false;
    tip.style.left = Math.min(innerWidth - 150, e.clientX + 12) + 'px';
    tip.style.top = (e.clientY - 30) + 'px';
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && G) { Net.lastSync = 0; tickNet(); } });
  new ResizeObserver(sizeStrip).observe(cv());
  // Timers keep the game counted as open while the tab is in the background.
  setInterval(() => {
    tickNet();
    if (document.hidden && G) { advance(); maybeRender(); }
  }, 1000);
}

async function start() {
  wire(); sizeStrip();
  requestAnimationFrame(frame);
  $('rail').innerHTML = Object.entries(WIN).filter(([k]) => k !== 'wallet').map(([k, w]) => `<button class="railb" data-win="${k}" aria-pressed="false"><span class="ringb" data-ic="${w.icon}"></span>${w.title}</button>`).join('');
  addEventListener('resize', () => { if (G) touch(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.sel) { ui.closeCard(); touch(); } });
  document.addEventListener('mouseover', e => {
    const t = e.target.closest ? e.target.closest('[data-tip]') : null, tip = $('itip');
    if (!t || !G || ui.sel) { tip.hidden = true; return; }
    const html = renderTip(t.dataset.tip);
    if (!html) { tip.hidden = true; return; }
    tip.innerHTML = html; tip.hidden = false;
    const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let x = r.right + 8; if (x + w > innerWidth - 6) x = r.left - w - 8; if (x < 6) x = 6;
    let y = r.top; if (y + h > innerHeight - 6) y = innerHeight - h - 6; if (y < 6) y = 6;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
  Wallet.onChange(() => { if (!$('gate').hidden) renderGateWallets(); if (G && isOpen('wallet')) touch(); });
  Wallet.scan();
  S_.init().then(() => {
    document.querySelectorAll('[data-ic]').forEach(el => { el.innerHTML = A.ic(el.dataset.ic, 2); });
    $('gateHero').innerHTML = A.ic('bust/warden', 1);
    $('hudCoinIc').innerHTML = A.ic('coin', 2); $('hudMarkIc').innerHTML = A.ic('mark', 1); $('chestIc').innerHTML = A.ic('chest', 1);
    document.querySelectorAll('#desk .win').forEach(el => { el._html = ''; });
    touch();
  }).catch(() => say('The art failed to load. Reload the page to try again.', 'warn'));
  try {
    const session = await api('/api/session');
    Net.walletRequired = !!session.walletRequired;
    if (session.banned) return showGate(session.banned);
    if (session.active) {
      const sentAt = Date.now();
      adopt(await api('/api/sync', {}), sentAt);
      Net.lastSync = Date.now();
      pollMarket();
    } else {
      let loggedOut = false;
      try { loggedOut = !!localStorage.getItem('tf.loggedOut'); } catch (err) { /* storage is optional */ }
      if (Net.walletRequired) showGate(loggedOut ? 'Welcome back. Connect your wallet to play.' : 'Connect a wallet to start. Your first hero, the Kitten Knight, is free.');
      else if (loggedOut) showGate('Welcome back. Log in, or start a new crew.');
      else await auth('/api/guest', {});
    }
  } catch (e) {
    return showGate(e.message);
  }
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') window.__tf = { get G() { return G; }, get B() { return B; }, ui, Net, T };
}
start();
})();
