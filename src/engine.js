// DungeonDragons game engine. Pure game rules with no DOM access, so the same file
// runs in the browser and in test/sim.mjs. Every time-dependent call takes `now`.
(function (root) {
'use strict';

const MIN = 60e3, HOUR = 3600e3;

const CFG = {
  CHEST_BASE: 90,            // seconds between timed chests
  CHEST_CAP: 6,
  PACK_CAP: 120,
  OFFLINE_RATE: 0.5,         // share of online income paid while away (coin and XP only)
  OFFLINE_BASE_H: 1,
  LIST_GATE: 3,              // forge level needed to list on the Exchange
  LIST_SLOTS: 4,
  LIST_COOLDOWN: 4 * HOUR,
  HERO_PRICE: 500000,        // DND for each hero after the free one, until an operator sets another. All of it burns.
  RESALE_LOCK: 24 * HOUR,
  FEE_BURN: 0.15,            // the share of every sale that is destroyed
  FLOOR: 3,                  // lowest legal price: 2 burned + 1 to the seller
  DRIFT_SPREAD: 1.12,        // drifters ask this much above reference
  START_MARKS: 100,
  STRIP_GATE: 4, ETCH_GATE: 4,
};

// ---------------------------------------------------------------- tables
const GRADES = [
  { n: 'Scrap',    c: '#a8a39a', salv: 10,    fx: 2,    sock: 0, mult: 1,    price: .6,  hazard: 0.08, affix: 0 },
  { n: 'Sturdy',   c: '#86c46b', salv: 30,    fx: 6,    sock: 1, mult: 1.25, price: .8,  hazard: 0.08, affix: 0 },
  { n: 'Fine',     c: '#57b3d9', salv: 95,    fx: 18,   sock: 1, mult: 1.55, price: 1.2, hazard: 0.10, affix: 1 },
  { n: 'Prized',   c: '#e8b03f', salv: 300,   fx: 55,   sock: 2, mult: 1.95, price: 3,   hazard: 0.20, affix: 1 },
  { n: 'Relic',    c: '#e8674f', salv: 950,   fx: 170,  sock: 2, mult: 2.45, price: 16,  hazard: 0.20, affix: 2 },
  { n: 'Mythic',   c: '#bb82ec', salv: 3000,  fx: 550,  sock: 3, mult: 3.1,  price: 100, hazard: 0.12, affix: 3 },
  { n: 'Astral',   c: '#57e0c4', salv: 9500,  fx: 1700, sock: 3, mult: 3.9,  price: 650, hazard: 0.06, affix: 3 },
  { n: 'Primeval', c: '#fff1a8', salv: 30000, fx: 5500, sock: 3, mult: 5,    price: 6000, hazard: 0.03, affix: 4 },
];
const CHEST_WEIGHTS = [620, 270, 85, 20, 4, 0.8, 0.12, 0.012];

const SLOTS = ['weapon', 'ward', 'helm', 'coat', 'boots', 'charm'];
const SLOT_NAME = { weapon: 'Blade', ward: 'Bulwark', helm: 'Cowl', coat: 'Coat', boots: 'Boots', charm: 'Charm' };
const SLOT_LABEL = { weapon: 'Weapon', ward: 'Ward', helm: 'Head', coat: 'Body', boots: 'Feet', charm: 'Charm' };
const SLOT_BASE = {
  weapon: { atk: .55 },
  ward:   { armor: .7, hp: 1.2 },
  helm:   { hp: 2.4, armor: .2 },
  coat:   { hp: 3.4, armor: .3 },
  boots:  { hp: 1.4, armor: .2 },
  charm:  { atk: .25, hp: .8 },
};
const SLOT_PRICE = { weapon: 1.5, ward: 1, helm: .8, coat: 1, boots: .8, charm: 3 };
const BANDS = ['Reed', 'Copper', 'Thorn', 'Ember', 'Frost', 'Gloom', 'Star', 'Dawn'];

const AFFIXES = [
  { k: 'crit',  n: 'Crit chance',  per: 1.5 },
  { k: 'haste', n: 'Attack speed', per: 1.5 },
  { k: 'coin',  n: 'Coin find',    per: 3 },
  { k: 'xp',    n: 'XP gain',      per: 3 },
  { k: 'chest', n: 'Chest cadence', per: 1 },
];

const MATS = {
  seal: { n: 'Warden Seal',  c: '#d9a441', price: 2,  desc: 'Opens a boss gate. Spent only when the boss falls.' },
  gem1: { n: 'Chipped Gem',  c: '#86c46b', price: 2,  desc: 'Etches a small bonus onto gear.' },
  gem2: { n: 'Cut Gem',      c: '#57b3d9', price: 8,  desc: 'Etches a solid bonus. Prized gear or better.' },
  gem3: { n: 'Flawless Gem', c: '#bb82ec', price: 40, desc: 'Etches a large bonus. Mythic gear or better.' },
};

const HEROES = {
  warden:   { n: 'Kitten Knight', role: 'Frontline', hp: 130, atk: 5,  aspd: .9,  crit: .03, armor: 10, range: 34,  move: 38, every: 5, skill: 'Shield Charge', hood: '#5f8f58', cloak: '#3d5e3f', w: { hp: 1.3, armor: 2, atk: 1 } },
  fletcher: { n: 'RobinCat', role: 'Ranged',    hp: 62,  atk: 6,  aspd: 1.1, crit: .07, armor: 2,  range: 118, move: 34, every: 6, skill: 'Volley',        hood: '#c78a3b', cloak: '#7f5629', w: { atk: 4, hp: .4, armor: .5 } },
  hexer:    { n: 'Hexer',    role: 'Area',      hp: 52,  atk: 9,  aspd: .55, crit: .05, armor: 1,  range: 96,  move: 30, every: 4, aoe: 24, skill: 'Hex Burst', hood: '#8d62c9', cloak: '#54397d', w: { atk: 4, hp: .4, armor: .5 } },
  mender:   { n: 'Mender',   role: 'Healer',    hp: 92,  atk: 3,  aspd: .8,  crit: .02, armor: 5,  range: 36,  move: 32, every: 5, heal: 2.6, skill: 'Sanctuary', hood: '#d7cfae', cloak: '#8e8669', w: { atk: 2.5, hp: 1, armor: 1 } },
};
const HERO_KEYS = Object.keys(HEROES);

const REGIONS = [
  { n: 'Saltmarsh',      mons: ['Goblin', 'Brine Slime', 'Marsh Bat'],       boss: 'The Tidewarden',   shapes: ['goblin', 'slime', 'bat'],        pal: ['#7fae4a', '#4fa8d8', '#5b4a6e'] },
  { n: 'Copper Flats',   mons: ['Ratfolk', 'Red Scorpion', 'Sand Slime'],    boss: 'The Assayer',      shapes: ['ratman', 'scorpion', 'slime'],   pal: ['#8a7a6a', '#b83a2a', '#d9a441'] },
  { n: 'Hollow Orchard', mons: ['Skeleton', 'Zombie', 'Grave Bat'],          boss: 'The Grafted King', shapes: ['skeleton', 'zombie', 'bat'],     pal: ['#e6e0cc', '#6f8f5f', '#4a3a5a'] },
  { n: 'Glass Dunes',    mons: ['Frost Wolf', 'Ice Slime', 'Shard Golem'],   boss: 'The Lensmaker',    shapes: ['wolf', 'slime', 'golem'],        pal: ['#a8c8e0', '#8fe0f0', '#7fa8d0'] },
  { n: 'Starfall Reach', mons: ['Orc Raider', 'Cinder Imp', 'Ash Golem'],    boss: 'The Last Comet',   shapes: ['orc', 'imp', 'golem'],           pal: ['#6f8f4a', '#e8652c', '#5e566f'] },
];
// How each kind of monster fights. Toughness and damage scale with stage level on top of this.
const MON_KINDS = {
  goblin:   { spd: 24, hp: 1,    dmg: 1,   reach: 26, w: 18 },
  slime:    { spd: 14, hp: 1.25, dmg: .8,  reach: 24, w: 20 },
  bat:      { spd: 36, hp: .6,   dmg: .8,  reach: 22, w: 16, fly: 1 },
  ratman:   { spd: 28, hp: .9,   dmg: 1,   reach: 28, w: 20 },
  scorpion: { spd: 20, hp: 1.1,  dmg: 1.1, reach: 36, w: 30 },
  skeleton: { spd: 22, hp: 1,    dmg: 1.1, reach: 32, w: 20 },
  zombie:   { spd: 11, hp: 1.6,  dmg: 1.1, reach: 26, w: 20 },
  wolf:     { spd: 40, hp: .75,  dmg: 1,   reach: 32, w: 30 },
  golem:    { spd: 10, hp: 2,    dmg: 1.4, reach: 34, w: 28 },
  orc:      { spd: 18, hp: 1.5,  dmg: 1.3, reach: 40, w: 30 },
  imp:      { spd: 22, hp: .8,   dmg: .9,  reach: 80, w: 16, shot: 1 },
};
const DIFFS = ['Daybreak', 'Dusk', 'Deep Night'];
const STAGE_COUNT = 90;

const TALENTS = [
  { k: 'might',   n: 'Sharpened Edge',   d: '+6% attack per rank.',                                max: 10, cost: r => 400 * 2.1 ** r, group: 'Crew' },
  { k: 'grit',    n: 'Road Hardened',    d: '+6% health and armor per rank.',                      max: 10, cost: r => 400 * 2.1 ** r, group: 'Crew' },
  { k: 'coin',    n: 'Deep Pockets',     d: '+10% coin per rank.',                                 max: 8, cost: r => 300 * 2.3 ** r, group: 'Income' },
  { k: 'xp',      n: 'Campfire Stories', d: '+10% XP per rank.',                                   max: 8, cost: r => 300 * 2.3 ** r, group: 'Income' },
  { k: 'salvage', n: 'Thrifty Hands',    d: '+10% salvage coin per rank.',                         max: 5, cost: r => 800 * 2.5 ** r, group: 'Income' },
  { k: 'offline', n: 'Night Watch',      d: '+1 hour of away income per rank. 8 hours at most.',   max: 7, cost: r => 1200 * 2.2 ** r, group: 'Income' },
  { k: 'cadence', n: 'Keen Eyes',        d: 'Chests come 8% faster per rank.',                     max: 5, cost: r => 2500 * 3 ** r, group: 'Chests' },
  { k: 'cap',     n: 'Bigger Cart',      d: 'Hold 2 more unopened chests per rank.',               max: 5, cost: r => 1000 * 2.4 ** r, group: 'Chests' },
  { k: 'auto',    n: 'Clockwork Latch',  d: 'Chests open themselves as they arrive.',              max: 1, cost: () => 6000, group: 'Chests' },
  { k: 'pack',    n: 'Saddlebags',       d: '+20 pack space per rank.',                            max: 5, cost: r => 1500 * 2.5 ** r, group: 'Chests' },
];
const talentDef = k => TALENTS.find(t => t.k === k);
// The game's token. Inside the game state its balance is still called marks.
const TOKEN = { name: 'DND', symbol: 'DND' };

// Each hero has three tiers of skills, opening at levels 1, 10 and 20. Passives raise a stat for
// good. Actives are special moves: a hero carries one, or two from level 10, and uses them in turn.
const SKILL_TIERS = [1, 10, 20];
const SKILLS = {
  warden: [
    { k: 'ironHide', n: 'Iron Hide', tier: 0, max: 3, stat: { armor: .04 }, d: '+4% armor per rank.', icon: 'shield', col: 'steel' },
    { k: 'heavyArm', n: 'Heavy Arm', tier: 0, max: 5, stat: { atk: .03 }, d: '+3% attack per rank.', icon: 'fist', col: 'red' },
    { k: 'charge', n: 'Shield Charge', tier: 0, max: 5, act: 'charge', anim: 'atk', every: 5, mult: 2.2, d: 'Drives into the front line and hits everything ahead for {m}% attack.', icon: 'sword', col: 'violet' },
    { k: 'secondWind', n: 'Second Wind', tier: 1, max: 5, stat: { hp: .03 }, d: '+3% health per rank.', icon: 'heart', col: 'red' },
    { k: 'rhythm', n: 'Battle Rhythm', tier: 1, max: 3, stat: { aspd: .02 }, d: '+2% attack speed per rank.', icon: 'wing', col: 'gold' },
    { k: 'cleave', n: 'Great Cleave', tier: 1, max: 5, act: 'cleave', anim: 'atk', every: 4, mult: 1.7, d: 'A huge sweep. Hits every enemy in reach for {m}% attack without moving.', icon: 'slash', col: 'blue' },
    { k: 'executioner', n: 'Executioner', tier: 2, max: 3, stat: { crit: .015 }, d: '+1.5% crit chance per rank.', icon: 'star', col: 'gold' },
    { k: 'unbroken', n: 'Unbroken', tier: 2, max: 3, stat: { hp: .03, armor: .03 }, d: '+3% health and armor per rank.', icon: 'shield', col: 'gold' },
    { k: 'warCry', n: 'War Cry', tier: 2, max: 5, act: 'warCry', anim: 'cast', every: 6, mult: 1.3, d: 'A shout that hits all nearby enemies for {m}% attack and restores 8% of the Warden\'s health.', icon: 'burst', col: 'red' },
  ],
  fletcher: [
    { k: 'steadyAim', n: 'Steady Aim', tier: 0, max: 5, stat: { atk: .03 }, d: '+3% attack per rank.', icon: 'eye', col: 'green' },
    { k: 'quickDraw', n: 'Quick Draw', tier: 0, max: 5, stat: { aspd: .02 }, d: '+2% attack speed per rank.', icon: 'wing', col: 'green' },
    { k: 'volley', n: 'Volley', tier: 0, max: 5, act: 'volley', anim: 'cast', every: 6, mult: 1, d: 'Looses three arrows in quick succession, each for {m}% attack.', icon: 'arrows', col: 'gold' },
    { k: 'eagleEye', n: 'Eagle Eye', tier: 1, max: 3, stat: { crit: .015 }, d: '+1.5% crit chance per rank.', icon: 'star', col: 'green' },
    { k: 'fieldDressing', n: 'Field Dressing', tier: 1, max: 3, stat: { hp: .04 }, d: '+4% health per rank.', icon: 'heart', col: 'green' },
    { k: 'pierce', n: 'Piercing Shot', tier: 1, max: 5, act: 'pierce', anim: 'atk', every: 5, mult: 1.4, d: 'One heavy arrow that passes through every enemy in line for {m}% attack.', icon: 'arrow', col: 'gold' },
    { k: 'huntersMark', n: "Hunter's Mark", tier: 2, max: 3, stat: { atk: .04 }, d: '+4% attack per rank.', icon: 'eye', col: 'red' },
    { k: 'fleet', n: 'Fleet of Foot', tier: 2, max: 3, stat: { aspd: .03 }, d: '+3% attack speed per rank.', icon: 'wing', col: 'gold' },
    { k: 'arrowRain', n: 'Arrow Rain', tier: 2, max: 5, act: 'rain', anim: 'cast', every: 7, mult: 1.6, d: 'Fills the air over the enemy. Hits a wide area for {m}% attack.', icon: 'rain', col: 'gold' },
  ],
  hexer: [
    { k: 'emberHeart', n: 'Ember Heart', tier: 0, max: 5, stat: { atk: .03 }, d: '+3% attack per rank.', icon: 'flame', col: 'red' },
    { k: 'thinVeil', n: 'Thin Veil', tier: 0, max: 3, stat: { hp: .04 }, d: '+4% health per rank.', icon: 'heart', col: 'violet' },
    { k: 'hexBurst', n: 'Hex Burst', tier: 0, max: 5, act: 'burst', anim: 'cast', every: 4, mult: 1.7, d: 'A violent blast at the target. Hits a wide area for {m}% attack.', icon: 'burst', col: 'violet' },
    { k: 'kindle', n: 'Kindle', tier: 1, max: 3, stat: { crit: .015 }, d: '+1.5% crit chance per rank.', icon: 'star', col: 'violet' },
    { k: 'quickHex', n: 'Quick Hex', tier: 1, max: 5, stat: { aspd: .02 }, d: '+2% attack speed per rank.', icon: 'wing', col: 'violet' },
    { k: 'chainBolt', n: 'Chain Bolt', tier: 1, max: 5, act: 'chain', anim: 'atk', every: 5, mult: 1.2, d: 'Bolts leap to the three nearest enemies, each for {m}% attack.', icon: 'bolt', col: 'blue' },
    { k: 'pyre', n: 'Pyre', tier: 2, max: 3, stat: { atk: .04 }, d: '+4% attack per rank.', icon: 'flame', col: 'gold' },
    { k: 'wardSkin', n: 'Warded Skin', tier: 2, max: 3, stat: { armor: .06 }, d: '+6% armor per rank.', icon: 'shield', col: 'violet' },
    { k: 'emberFall', n: 'Ember Fall', tier: 2, max: 5, act: 'comet', anim: 'cast', every: 7, mult: 2.8, d: 'Calls a burning stone down on the target for {m}% attack.', icon: 'comet', col: 'red' },
  ],
  mender: [
    { k: 'gentleHands', n: 'Gentle Hands', tier: 0, max: 5, stat: { heal: .06 }, d: '+6% healing per rank.', icon: 'cross', col: 'green' },
    { k: 'ironFaith', n: 'Iron Faith', tier: 0, max: 3, stat: { armor: .04 }, d: '+4% armor per rank.', icon: 'shield', col: 'gold' },
    { k: 'sanctuary', n: 'Sanctuary', tier: 0, max: 5, act: 'sanctuary', anim: 'cast', every: 5, mult: 1.3, d: 'Heals the whole crew and hits nearby enemies for {m}% attack.', icon: 'sun', col: 'gold' },
    { k: 'vitality', n: 'Vitality', tier: 1, max: 3, stat: { hp: .04 }, d: '+4% health per rank.', icon: 'heart', col: 'gold' },
    { k: 'lightStep', n: 'Light Step', tier: 1, max: 3, stat: { aspd: .02 }, d: '+2% attack speed per rank.', icon: 'wing', col: 'gold' },
    { k: 'smite', n: 'Smite', tier: 1, max: 5, act: 'smite', anim: 'atk', every: 4, mult: 2.4, d: 'Strikes one enemy for {m}% attack and heals the most wounded ally.', icon: 'sword', col: 'gold' },
    { k: 'grace', n: 'Grace', tier: 2, max: 3, stat: { heal: .08 }, d: '+8% healing per rank.', icon: 'cross', col: 'gold' },
    { k: 'holyEdge', n: 'Holy Edge', tier: 2, max: 5, stat: { atk: .03 }, d: '+3% attack per rank.', icon: 'fist', col: 'gold' },
    { k: 'renewal', n: 'Renewal', tier: 2, max: 5, act: 'renew', anim: 'cast', every: 7, mult: 1, d: 'Restores {r}% of health to every traveller in the crew.', icon: 'drop', col: 'green' },
  ],
};
// The move each hero starts with, free of charge.
const SIGNATURE = { warden: 'charge', fletcher: 'volley', hexer: 'hexBurst', mender: 'sanctuary' };
const skillDef = (key, k) => SKILLS[key].find(s => s.k === k);
const skillMult = (def, rank) => def.mult * (1 + .1 * (rank - 1));
// Old saves have no skills yet, so they start with the signature move.
function skillsOf(G, key) {
  const me = G.heroes[key];
  if (!me.sk) { me.sk = { [SIGNATURE[key]]: 1 }; me.eq = [SIGNATURE[key]]; }
  return me;
}
const skillCap = lvl => 1 + Math.floor(lvl / 2);
const skillSlots = lvl => (lvl >= 10 ? 2 : 1);
function skillPoints(G, key) {
  const me = skillsOf(G, key);
  let spent = -1; // the signature move's first rank is free
  for (const k in me.sk) spent += me.sk[k];
  return { total: skillCap(me.lvl), spent, left: skillCap(me.lvl) - spent };
}
function skillUp(G, key, k) {
  const def = skillDef(key, k), me = skillsOf(G, key);
  if (!def) return { err: 'Unknown skill.' };
  if (me.lvl < SKILL_TIERS[def.tier]) return { err: `Opens at level ${SKILL_TIERS[def.tier]}.` };
  const r = me.sk[k] || 0;
  if (r >= def.max) return { err: 'Already at the top rank.' };
  if (skillPoints(G, key).left < 1) return { err: 'No skill points left. Heroes earn one every 2 levels.' };
  me.sk[k] = r + 1;
  // A hero with a free slot starts using a new move straight away.
  if (def.act && !me.eq.includes(k) && me.eq.length < skillSlots(me.lvl)) me.eq.push(k);
  G.statsDirty = true;
  return { ok: true, rank: r + 1 };
}
function skillEquip(G, key, k) {
  const def = skillDef(key, k), me = skillsOf(G, key);
  if (!def || !def.act) return { err: 'Only active skills can be equipped.' };
  if (!(me.sk[k] > 0)) return { err: 'Learn that skill first.' };
  const i = me.eq.indexOf(k);
  if (i >= 0) {
    if (me.eq.length === 1) return { err: 'A hero needs at least one active skill.' };
    me.eq.splice(i, 1);
    return { ok: true, on: false };
  }
  if (me.eq.length >= skillSlots(me.lvl)) me.eq.shift();
  me.eq.push(k);
  return { ok: true, on: true };
}
const skillResetCost = (G, key) => 40 * skillsOf(G, key).lvl;
function skillReset(G, key) {
  const me = skillsOf(G, key), sig = SIGNATURE[key];
  if (skillPoints(G, key).spent < 1) return { err: 'No skill points to refund.' };
  const cost = skillResetCost(G, key);
  if (G.coin < cost) return { err: `Needs ${cost} coin.` };
  G.coin -= cost; G.ledger.coinTalents += cost;
  me.sk = { [sig]: 1 }; me.eq = [sig]; G.statsDirty = true;
  return { ok: true, cost };
}
// Spends every free point: the move in use first, then tier by tier, one rank around at a time.
function skillAuto(G, key) {
  const me = skillsOf(G, key);
  let n = 0;
  for (let guard = 0; guard < 80 && skillPoints(G, key).left > 0; guard++) {
    const open = SKILLS[key].filter(s => me.lvl >= SKILL_TIERS[s.tier] && (me.sk[s.k] || 0) < s.max);
    if (!open.length) break;
    open.sort((a, b) => (me.sk[a.k] || 0) - (me.sk[b.k] || 0) || (b.act ? 1 : 0) - (a.act ? 1 : 0) || a.tier - b.tier);
    if (!skillUp(G, key, open[0].k).ok) break;
    n++;
  }
  return { ok: true, n };
}

const FUSE = [
  { to: [[1, .96], [2, .04]],              cost: 20 },
  { to: [[2, .96], [3, .04]],              cost: 60 },
  { to: [[3, .975], [4, .025]],            cost: 200 },
  { to: [[4, .99], [5, .01]],              cost: 700 },
  { to: [[4, .55], [5, .447], [6, .003]],  cost: 2400 },
  { to: [[5, .70], [6, .298], [7, .002]],  cost: 8000 },
  { to: [[6, .80], [7, .20]],              cost: 26000 },
];
const FUSE_GATE = [1, 1, 2, 4, 6, 8, 10];

// ---------------------------------------------------------------- helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function h32(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= 0xff; h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}
const u01 = (...p) => h32(...p) / 4294967296;
function mulberry(o) {
  let t = (o.rng = (o.rng + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
// Two random streams. Loot rolls can use an injected crypto source, so a server's
// players cannot predict them. Combat rolls are seeded in the battle state, so the
// browser can replay the server's fight exactly from a snapshot.
let randomSource = null, idSource = null;
function setRandom(fn) { randomSource = fn; }
function setIdSource(fn) { idSource = fn; }
const rand = G => randomSource ? randomSource() : mulberry(G);
const combat = B => mulberry(B);
function pick(table, r) {
  let acc = 0;
  for (const [v, w] of table) { acc += w; if (r < acc) return v; }
  return table[table.length - 1][0];
}
function noise1(seed, x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return (u01(seed, i) * (1 - u) + u01(seed, i + 1) * u) * 2 - 1;
}

// ---------------------------------------------------------------- stages
function stageInfo(i) {
  const d = Math.floor(i / 30), r = Math.floor((i % 30) / 6), n = i % 6 + 1;
  return { i, d, r, n, boss: n === 6, lvl: i + 1, name: `${REGIONS[r].n} ${n}`, diff: DIFFS[d] };
}
const monHp = L => 9 * 1.125 ** (L - 1) + (L - 1) * 3;
const monDmg = L => 1.5 * 1.098 ** (L - 1);
const monCoin = L => 2 * 1.075 ** (L - 1);
const monXp = L => 3 * 1.085 ** (L - 1);
const xpNeed = l => Math.round(20 * 1.2 ** l);
const LEVEL_CAP = 80;
const forgeNeed = l => Math.round(8 * l ** 1.4);

// ---------------------------------------------------------------- items
const bandOf = l => clamp(Math.floor((l - 1) / 12), 0, 7);
const budget = (l, g) => (4 + l * 1.7) * GRADES[g].mult;
const itemName = it => `${BANDS[bandOf(it.l)]} ${SLOT_NAME[it.s]}`;
const marketKey = it => `${it.s}.${bandOf(it.l)}.${it.g}`;

function itemStats(it) {
  const out = { atk: 0, hp: 0, armor: 0, crit: 0, haste: 0, coin: 0, xp: 0, chest: 0 };
  const b = budget(it.l, it.g);
  const base = SLOT_BASE[it.s];
  for (const k in base) out[k] += base[k] * b;
  for (let i = 0; i < GRADES[it.g].affix; i++) {
    const a = AFFIXES[h32(it.r, 'affix', i) % AFFIXES.length];
    out[a.k] += a.per * (it.g + 1) * (0.7 + 0.6 * u01(it.r, 'roll', i));
  }
  for (const [tier, stat] of it.e || []) {
    const v = b * [.10, .20, .40][tier];
    if (stat === 0) out.atk += v * .55;
    else if (stat === 1) out.hp += v * 3;
    else out.armor += v * .7;
  }
  for (const k of ['atk', 'hp', 'armor']) out[k] = Math.round(out[k]);
  return out;
}
function makeItem(G, s, l, g, extra) {
  return Object.assign({ id: idSource ? idSource() : 'i' + (G.nextId++).toString(36), s, l: clamp(Math.round(l), 1, STAGE_COUNT), g, r: Math.floor(rand(G) * 4294967296), e: [], k: 0, t: 0 }, extra || {});
}
function randomSlot(G) { return SLOTS[Math.floor(rand(G) * SLOTS.length)]; }

// ---------------------------------------------------------------- game state
function newGame(now, seed) {
  seed = seed === undefined ? (now ^ Math.floor(Math.random() * 1e9)) >>> 0 : seed;
  const G = {
    v: 1, seed, rng: seed | 0, nextId: 1, crew: 'Crew ' + (seed % 9000 + 1000),
    createdAt: now, lastSeen: now,
    coin: 150, marks: CFG.START_MARKS,
    stage: 0, maxStage: 0, hold: false,
    party: ['warden'],
    owned: ['warden'],
    heroes: {},
    items: [],
    mats: { seal: 2, gem1: 2, gem2: 0, gem3: 0 },
    chests: [], chestT: 20,
    forge: { lvl: 1, xp: 0 },
    talents: {},
    market: { mine: [], slots: new Array(CFG.LIST_SLOTS).fill(0), drift: {} },
    ledger: { coinKills: 0, coinSalvage: 0, coinAway: 0, coinTalents: 0, coinForge: 0, itemsMade: 0, itemsBurned: 0, marksIn: 0, marksOut: 0, burned: 0, sold: 0, bought: 0 },
    mail: [], stats: { kills: 0, chests: 0, best: 0, wipes: 0, boss: 0 },
    hints: {},
  };
  for (const k of HERO_KEYS) G.heroes[k] = { lvl: 1, xp: 0, gear: {} };
  // Starter crate, so the forge and Exchange can be tried in the first minutes.
  for (let i = 0; i < 9; i++) addItem(G, makeItem(G, randomSlot(G), 1, 0), now, true);
  for (let i = 0; i < 2; i++) addItem(G, makeItem(G, randomSlot(G), 1, 1), now, true);
  const blade = makeItem(G, 'weapon', 1, 1); addItem(G, blade, now, true); equip(G, 'warden', blade.id);
  const coat = makeItem(G, 'coat', 1, 1); addItem(G, coat, now, true); equip(G, 'warden', coat.id);
  addItem(G, makeItem(G, 'charm', 4, 3), now, true);
  G.stats.best = 3;
  mail(G, now, 'A drifter left you a starter crate: scrap for the forge, two seals, and a Prized charm worth selling.', 'gift');
  return G;
}
function mail(G, now, text, kind) {
  G.mail.unshift({ at: now, text, kind: kind || 'note' });
  if (G.mail.length > 40) G.mail.length = 40;
}
const talent = (G, k) => G.talents[k] || 0;
// Every crew starts with the Kitten Knight, and every other hero you buy can walk the road with it.
const FREE_HERO = 'warden';
const owns = (G, key) => G.owned.includes(key);
const partySize = G => G.owned.length;
// Crews from before heroes were sold keep the free hero. Gear worn by the others returns to the
// Pack, and coin spent on the old Crew Roster rune comes back, since heroes now bring their own slot.
function migrateOwned(G) {
  if (G.owned) return;
  G.owned = [FREE_HERO];
  G.party = [FREE_HERO];
  for (const k of HERO_KEYS) if (k !== FREE_HERO) G.heroes[k].gear = {};
  const refund = [0, 1500, 10500][G.talents.slot || 0];
  G.coin += refund;
  G.ledger.coinTalents = Math.max(0, (G.ledger.coinTalents || 0) - refund);
  delete G.talents.slot;
  G.statsDirty = true;
}
function buyHero(G, key, price = CFG.HERO_PRICE) {
  if (!Object.hasOwn(HEROES, key)) return { err: 'Unknown traveller.' };
  if (owns(G, key)) return { err: `${HEROES[key].n} is already in your crew.` };
  if (G.marks < price) return { err: `${HEROES[key].n} costs ${price.toLocaleString('en-US')} ${TOKEN.symbol}.` };
  G.marks -= price;
  G.ledger.marksOut += price;
  G.ledger.burned = (G.ledger.burned || 0) + price;
  G.owned.push(key);
  G.party.push(key);
  G.statsDirty = true;
  return { price };
}
const packCap = G => CFG.PACK_CAP + talent(G, 'pack') * 20;
const chestCap = G => CFG.CHEST_CAP + talent(G, 'cap') * 2;

function addItem(G, it, now, silent) {
  if (G.items.length >= packCap(G)) { salvageValue(G, it); G.ledger.itemsMade++; G.ledger.itemsBurned++; return null; }
  G.items.push(it);
  if (G.mintLog && it.g >= 3) G.mintLog.push(it.id);
  if (!silent) G.ledger.itemsMade++;
  if (it.g > G.stats.best) G.stats.best = it.g;
  return it;
}
function salvageValue(G, it) {
  const coin = Math.round(GRADES[it.g].salv * (1 + .1 * talent(G, 'salvage')) * (1 + it.l * .02));
  G.coin += coin; G.ledger.coinSalvage += coin;
  forgeXp(G, GRADES[it.g].fx);
  return coin;
}
function forgeXp(G, xp) {
  G.forge.xp += xp;
  while (G.forge.xp >= forgeNeed(G.forge.lvl)) { G.forge.xp -= forgeNeed(G.forge.lvl); G.forge.lvl++; G.justForged = G.forge.lvl; }
}
const findItem = (G, id) => G.items.find(i => i.id === id);
function equippedBy(G, id) {
  for (const h of HERO_KEYS) for (const s of SLOTS) if (G.heroes[h].gear[s] === id) return h;
  return null;
}
function equip(G, hero, id) {
  const it = findItem(G, id); if (!it) return false;
  for (const h of HERO_KEYS) for (const s of SLOTS) if (G.heroes[h].gear[s] === id) delete G.heroes[h].gear[s];
  G.heroes[hero].gear[it.s] = id; G.statsDirty = true; return true;
}
function unequip(G, hero, slot) { delete G.heroes[hero].gear[slot]; G.statsDirty = true; }
function heroScore(hero, st) {
  const w = HEROES[hero].w;
  return st.atk * w.atk + st.hp * w.hp + st.armor * w.armor + st.crit * 2 + st.haste * 2 + st.coin + st.xp + st.chest * 2;
}
function equipBest(G, hero) {
  for (const s of SLOTS) {
    let best = null, bestScore = -1;
    for (const it of G.items) {
      if (it.s !== s) continue;
      const by = equippedBy(G, it.id);
      if (by && by !== hero) continue;
      const sc = heroScore(hero, itemStats(it));
      if (sc > bestScore) { best = it; bestScore = sc; }
    }
    if (best) G.heroes[hero].gear[s] = best.id;
  }
  G.statsDirty = true;
}
function heroStats(G, key) {
  const H = HEROES[key], me = G.heroes[key], l = me.lvl;
  const s = { hp: H.hp * (1 + .12 * (l - 1)), atk: H.atk * (1 + .10 * (l - 1)), armor: H.armor * (1 + .05 * (l - 1)), crit: H.crit, aspd: H.aspd, range: H.range };
  let haste = 0;
  for (const slot of SLOTS) {
    const it = findItem(G, me.gear[slot]); if (!it) continue;
    const st = itemStats(it);
    s.hp += st.hp; s.atk += st.atk; s.armor += st.armor; s.crit += st.crit / 100; haste += st.haste / 100;
  }
  const sk = { atk: 0, hp: 0, armor: 0, aspd: 0, crit: 0, heal: 0 }, ranks = skillsOf(G, key).sk;
  for (const d of SKILLS[key]) if (d.stat && ranks[d.k]) for (const st in d.stat) sk[st] += d.stat[st] * ranks[d.k];
  s.atk *= (1 + .06 * talent(G, 'might')) * (1 + sk.atk);
  s.hp *= (1 + .06 * talent(G, 'grit')) * (1 + sk.hp);
  s.armor *= (1 + .06 * talent(G, 'grit')) * (1 + sk.armor);
  s.aspd *= 1 + haste + sk.aspd;
  s.crit += sk.crit;
  s.heal = 1 + sk.heal;
  s.hp = Math.round(s.hp); s.atk = Math.round(s.atk * 10) / 10; s.armor = Math.round(s.armor);
  return s;
}
function partyBonus(G) {
  const b = { coin: 0, xp: 0, chest: 0 };
  for (const key of G.party) {
    const me = G.heroes[key];
    for (const slot of SLOTS) {
      const it = findItem(G, me.gear[slot]); if (!it) continue;
      const st = itemStats(it);
      b.coin += st.coin; b.xp += st.xp; b.chest += st.chest;
    }
  }
  return b;
}
function partyPower(G) {
  let p = 0;
  for (const k of G.party) { const s = heroStats(G, k); p += s.atk * s.aspd * (1 + s.crit * .6) * 6 + s.hp * .4 + s.armor * .6; }
  return Math.round(p);
}

// ---------------------------------------------------------------- chests and loot
function rollGrade(G, stage, boss) {
  const shift = 1 + (stage / (STAGE_COUNT - 1)) * 1.0 + (boss ? .5 : 0);
  let total = 0;
  const w = CHEST_WEIGHTS.map((x, g) => { const v = (boss && g === 0) ? 0 : x * shift ** g; total += v; return v; });
  let r = rand(G) * total;
  for (let g = 0; g < w.length; g++) { r -= w[g]; if (r < 0) return g; }
  return 0;
}
function openChest(G, now) {
  const ch = G.chests.shift(); if (!ch) return null;
  G.stats.chests++;
  const L = ch.stage + 1;
  const out = [];
  const r = rand(G);
  if (r < (ch.boss ? .15 : .35)) {
    const m = rand(G);
    const key = m < .4 ? 'seal' : m < .78 ? 'gem1' : m < .96 ? 'gem2' : 'gem3';
    const qty = key === 'seal' ? 1 + Math.floor(rand(G) * 2) : 1;
    G.mats[key] += qty;
    out.push({ mat: key, qty });
  } else {
    const it = makeItem(G, randomSlot(G), L - Math.floor(rand(G) * 2), rollGrade(G, ch.stage, ch.boss));
    addItem(G, it, now);
    out.push({ item: it });
  }
  return { chest: ch, loot: out };
}
function salvage(G, id) {
  const it = findItem(G, id); if (!it || it.k || equippedBy(G, id)) return 0;
  G.items = G.items.filter(i => i !== it);
  G.ledger.itemsBurned++;
  return salvageValue(G, it);
}
function salvageUpTo(G, maxGrade) {
  let coin = 0, n = 0;
  for (const it of G.items.slice()) {
    if (it.g <= maxGrade && !it.k && !equippedBy(G, it.id)) { coin += salvage(G, it.id); n++; }
  }
  return { coin, n };
}
function fuseCandidates(G, g) {
  return G.items.filter(i => i.g === g && !i.k && !equippedBy(G, i.id) && !(i.e && i.e.length)).sort((a, b) => a.l - b.l);
}
function fuse(G, g, slotChoice) {
  if (g >= FUSE.length) return { err: 'That grade cannot be fused further.' };
  if (G.forge.lvl < FUSE_GATE[g]) return { err: `Needs Forge level ${FUSE_GATE[g]}.` };
  const pool = fuseCandidates(G, g);
  if (pool.length < 9) return { err: `Needs 9 unlocked ${GRADES[g].n} items. You have ${pool.length}.` };
  if (G.coin < FUSE[g].cost) return { err: `Needs ${FUSE[g].cost} coin.` };
  const used = pool.slice(0, 9);
  G.coin -= FUSE[g].cost; G.ledger.coinForge += FUSE[g].cost;
  G.items = G.items.filter(i => !used.includes(i));
  G.ledger.itemsBurned += 9;
  const to = pick(FUSE[g].to, rand(G));
  const l = used.reduce((a, b) => a + b.l, 0) / 9;
  const it = makeItem(G, slotChoice || randomSlot(G), l, to, used.some(u => u.nd) ? { nd: 1 } : null);
  addItem(G, it);
  forgeXp(G, GRADES[g].fx * 3);
  return { item: it, stayed: to === g, jumped: to > g + 1 };
}
function etch(G, id, tier, stat) {
  const it = findItem(G, id);
  if (!it) return { err: 'Item not found.' };
  if (G.forge.lvl < CFG.ETCH_GATE) return { err: `Etching opens at Forge level ${CFG.ETCH_GATE}.` };
  if ((it.e || []).length >= GRADES[it.g].sock) return { err: 'No free sockets on this item.' };
  if (tier === 1 && it.g < 3) return { err: 'Cut Gems need Prized gear or better.' };
  if (tier === 2 && it.g < 5) return { err: 'Flawless Gems need Mythic gear or better.' };
  const key = 'gem' + (tier + 1);
  if (G.mats[key] < 1) return { err: `You have no ${MATS[key].n}.` };
  G.mats[key]--;
  it.e = (it.e || []).concat([[tier, stat]]);
  G.statsDirty = true;
  return { ok: true };
}
const stripCost = it => (it.e || []).reduce((a, [t]) => a + Math.round(100 * 3 ** t), 0);
function strip(G, id) {
  const it = findItem(G, id);
  if (!it || !(it.e || []).length) return { err: 'Nothing to strip.' };
  if (G.forge.lvl < CFG.STRIP_GATE) return { err: `Stripping opens at Forge level ${CFG.STRIP_GATE}.` };
  const c = stripCost(it);
  if (G.coin < c) return { err: `Stripping costs ${c} coin.` };
  G.coin -= c; G.ledger.coinForge += c; it.e = []; G.statsDirty = true;
  return { ok: true, cost: c };
}
function buyTalent(G, k) {
  const t = talentDef(k), r = talent(G, k);
  if (r >= t.max) return { err: 'Already at the top rank.' };
  const cost = Math.round(t.cost(r));
  if (G.coin < cost) return { err: `Needs ${cost} coin.` };
  G.coin -= cost; G.ledger.coinTalents += cost; G.talents[k] = r + 1; G.statsDirty = true;
  return { ok: true };
}
function toggleParty(G, key) {
  if (!Object.hasOwn(HEROES, key)) return { err: 'Unknown traveller.' };
  if (!owns(G, key)) return { err: `Buy ${HEROES[key].n} first.` };
  const i = G.party.indexOf(key);
  if (i >= 0) { if (G.party.length === 1) return { err: 'Someone has to walk the road.' }; G.party.splice(i, 1); }
  else G.party.push(key);
  G.statsDirty = true;
  return { ok: true };
}

// ---------------------------------------------------------------- battle
// One fixed arena, no scrolling. Monsters pour from the gate on the left, the crew runs
// out to meet them and falls back between waves. Positions are arena pixels.
const ARENA = { W: 320, gate: 30, left: 38, right: 252 };
const BATTLE_V = 4; // bump when the shape of a saved fight changes
const homeX = idx => 170 + idx * 38;
const LEASH = 142; // the crew holds here and lets monsters march out to them

function newBattle(G) {
  const B = { v: BATTLE_V, t: 0, mons: [], hs: [], fx: [], wave: 0, waves: 0, delay: 1, state: 'fight', retry: 0, nextMon: 1, spawnQ: [], spawnT: 0, trans: 0, shake: 0, rng: (G.rng ^ 0x5bd1e995) | 0, preview: false };
  syncParty(G, B);
  enterStage(G, B);
  return B;
}
function syncParty(G, B) {
  const prev = {}; for (const h of B.hs) prev[h.key] = h;
  B.hs = G.party.map((key, idx) => {
    const st = heroStats(G, key), old = prev[key];
    const hp = old ? Math.min(st.hp, old.hp + Math.max(0, st.hp - old.mhp)) : st.hp;
    return {
      key, idx, st, mhp: st.hp, hp: old && old.down ? 0 : hp, x: old ? old.x : homeX(idx), px: old ? old.px : homeX(idx), dir: old ? old.dir : -1,
      a: old ? old.a : 'idle', at: old ? old.at : 0, cd: old ? old.cd : .3 + idx * .2, busy: old ? old.busy : 0, q: old ? old.q : [], down: old ? old.down : 0, flash: old ? old.flash : 0, charge: old ? old.charge : 0, dash: old ? old.dash : 0, combo: old ? old.combo : 0, ad: old ? old.ad : 0, ai: old ? old.ai : 0, hop: old ? old.hop : 0, hopCd: old ? old.hopCd : 0, skI: old ? old.skI || 0 : 0,
    };
  });
  const b = partyBonus(G);
  B.bonus = { coin: 1 + .10 * talent(G, 'coin') + b.coin / 100, xp: 1 + .10 * talent(G, 'xp') + b.xp / 100, chest: 1 / (0.92 ** talent(G, 'cadence')) * (1 + b.chest / 100) };
  G.statsDirty = false;
}
function enterStage(G, B) {
  const info = stageInfo(G.stage);
  B.info = info; B.wave = 0; B.delay = 1; B.state = 'fight'; B.mons = []; B.spawnQ = []; B.spawnT = 0; B.trans = .5;
  B.waves = info.boss ? 3 : 3 + Math.floor(info.n / 2);
}
function canEnter(G, i) { return i < STAGE_COUNT && (!stageInfo(i).boss || G.mats.seal > 0); }
function spawnWave(G, B) {
  const info = B.info;
  const last = B.wave === B.waves - 1;
  const count = (info.boss && last) ? 2 : 2 + Math.floor(combat(B) * 2) + (info.n > 3 ? 1 : 0);
  for (let i = 0; i < count; i++) B.spawnQ.push({ t: Math.floor(combat(B) * 3) });
  if (info.boss && last) B.spawnQ.push({ boss: 1 });
  B.spawnT = 0;
  B.wave++;
}
function spawnOne(G, B) {
  const info = B.info, L = info.lvl, R = REGIONS[info.r], mult = 1 + info.d * .6;
  const sp = B.spawnQ.shift();
  const base = { id: B.nextMon++, x: ARENA.gate, px: ARENA.gate, dir: 1, a: 'walk', at: 0, flash: 0, kb: 0, busy: 0, hitAt: -1, L };
  if (sp.boss) {
    const hp = monHp(L) * mult * 12;
    B.mons.push({ ...base, hp, mhp: hp, dmg: monDmg(L) * mult * 2.2, cd: 1, aspd: .55, spd: 11, reach: 46, w: 46, shape: 'boss', color: R.pal[2], boss: true, name: R.boss, slam: 5 });
    return;
  }
  const shape = R.shapes[sp.t], K = MON_KINDS[shape];
  const hp = monHp(L) * mult * K.hp;
  B.mons.push({ ...base, hp, mhp: hp, dmg: monDmg(L) * mult * K.dmg, cd: .4 + combat(B) * .5, aspd: .8, spd: K.spd * (.92 + combat(B) * .16), reach: K.reach, w: K.w, shape, color: R.pal[sp.t], fly: K.fly ? 1 : 0, shot: K.shot ? 1 : 0, boss: false });
}
const addFx = (B, f) => { if (B.fx.length < 80) { f.age = 0; B.fx.push(f); } };
const setAnim = (o, a) => { if (o.a !== a) { o.a = a; o.at = 0; } };
function nearestMon(B, x) {
  let best = null, bd = Infinity;
  for (const m of B.mons) { const d = Math.abs(m.x - x); if (m.hp > 0 && d < bd) { bd = d; best = m; } }
  return best;
}
function nearestHero(B, x) {
  let best = null, bd = Infinity;
  for (const h of B.hs) { const d = Math.abs(h.x - x); if (h.hp > 0 && d < bd) { bd = d; best = h; } }
  return best;
}
const anyAlive = B => B.hs.some(h => h.hp > 0);

function hitMon(G, B, m, dmg, crit, dir, push, now, ev) {
  if (m.hp <= 0) return;
  m.hp -= dmg;
  // A boss only flashes now and then, so a fast crew doesn't turn it into a white shape.
  if (!m.boss || B.t - (m.lastFlash || 0) > .5) { m.flash = .12; m.lastFlash = B.t; }
  if (!m.boss) m.kb += dir * push;
  addFx(B, { t: 'num', x: m.x, v: Math.round(dmg), crit, life: .75 });
  addFx(B, { t: 'spark', x: m.x, big: crit, life: .2 });
  if (m.hp <= 0) killMon(G, B, m, now, ev);
}
function killMon(G, B, m, now, ev) {
  const L = m.L, mult = m.boss ? 15 : 1;
  const coin = Math.round(monCoin(L) * mult * B.bonus.coin);
  const xp = Math.round(monXp(L) * mult * B.bonus.xp);
  G.coin += coin; G.ledger.coinKills += coin; G.stats.kills++;
  grantXp(G, xp, ev);
  addFx(B, { t: 'coin', x: m.x, v: coin, life: .95 });
  addFx(B, { t: 'corpse', x: m.x, shape: m.shape, color: m.color, dir: m.dir, boss: m.boss ? 1 : 0, fly: m.fly || 0, life: m.boss ? 1.5 : .7 });
  if (!B.preview && rand(G) < .025) {
    const it = makeItem(G, randomSlot(G), L, rand(G) < .8 ? 0 : 1);
    if (addItem(G, it, now)) ev.push({ t: 'loot', item: it });
  }
}
function grantXp(G, xp, ev) {
  for (const k of G.party) {
    const me = G.heroes[k];
    if (me.lvl >= LEVEL_CAP) continue;
    me.xp += xp;
    while (me.lvl < LEVEL_CAP && me.xp >= xpNeed(me.lvl)) { me.xp -= xpNeed(me.lvl); me.lvl++; G.statsDirty = true; if (ev) ev.push({ t: 'level', hero: k, lvl: me.lvl }); }
  }
}
// A preview only knows the chest was taken. The server rolls what was inside.
function openAuto(G, B, now, ev) {
  if (B.preview) { G.chests.pop(); return; }
  const r = openChest(G, now);
  if (r) ev.push({ t: 'opened', r });
}
function roll(B, h, mul) {
  const crit = combat(B) < h.st.crit;
  return { crit, dmg: h.st.atk * (crit ? 1.6 : 1) * (.9 + combat(B) * .2) * mul };
}
// Every attack has a wind-up, a strike and a recovery. ad is its whole length and ai the
// moment it lands. The art is timed from these two, so the blow always lands on the frame.
function startAttack(G, B, h, tgt) {
  const me = skillsOf(G, h.key), eq = me.eq, def = skillDef(h.key, eq[h.skI % eq.length]);
  h.charge++;
  const skill = h.charge >= def.every;
  h.cd = 1 / h.st.aspd;
  const big = skill && def.anim === 'cast';
  h.ad = Math.min(big ? .72 : .56, h.cd);
  h.ai = h.ad * (big ? .6 : .46);
  h.busy = h.ad;
  h.at = 0; h.a = big ? 'cast' : 'atk';
  // Plain attacks alternate between two moves. The Warden's lunge is saved for the charge.
  h.combo = skill && def.act === 'charge' ? 2 : (h.combo + 1) % 2;
  const id = tgt.id, t = h.ai;
  if (skill) {
    h.charge = 0; h.skI = (h.skI + 1) % eq.length;
    const m = skillMult(def, me.sk[def.k] || 1);
    if (def.act === 'volley') h.q.push({ t: t * .8, k: 'shot', m }, { t, k: 'shot', m }, { t: t * 1.2, k: 'shot', m });
    else h.q.push({ t, k: def.act, id, m });
  } else if (h.key === 'fletcher') h.q.push({ t, k: 'shot', m: 1 });
  else if (h.key === 'hexer') h.q.push({ t, k: 'bolt', id, m: 1 });
  else h.q.push({ t, k: 'melee', id, m: 1 });
}
const queueHit = (h, e) => { h.q.push(e); h.q.sort((a, b) => a.t - b.t); };
function fireHit(G, B, h, e, now, ev) {
  const H = HEROES[h.key];
  const tgt = (e.id && B.mons.find(m => m.id === e.id && m.hp > 0)) || nearestMon(B, h.x);
  if (e.k === 'melee') {
    addFx(B, { t: 'slash', x: h.x + h.dir * 28, dir: h.dir, life: .24 });
    if (tgt && Math.abs(tgt.x - h.x) <= h.st.range + (tgt.boss ? 26 : 12)) {
      const r = roll(B, h, e.m);
      hitMon(G, B, tgt, r.dmg, r.crit, h.dir, 16, now, ev);
    }
  } else if (e.k === 'charge') {
    h.dash = .16;
    addFx(B, { t: 'slash', x: h.x + h.dir * 30, dir: h.dir, big: 1, life: .3 });
    for (const m of B.mons.slice()) {
      if (Math.abs(m.x - (h.x + h.dir * 28)) <= 38) { const r = roll(B, h, e.m); hitMon(G, B, m, r.dmg, r.crit, h.dir, 34, now, ev); }
    }
  } else if (e.k === 'shot') {
    // The arrow is really in the air: the damage lands when it arrives, not when it leaves.
    if (tgt) {
      const fly = Math.max(.05, Math.abs(tgt.x - h.x) / 460);
      addFx(B, { t: 'arrow', from: h.x + h.dir * 22, x: tgt.x, life: fly });
      queueHit(h, { t: fly, k: 'arrowHit', id: tgt.id, m: e.m });
    }
  } else if (e.k === 'arrowHit') {
    if (tgt) {
      const r = roll(B, h, e.m);
      hitMon(G, B, tgt, r.dmg, r.crit, h.dir, 8, now, ev);
    }
  } else if (e.k === 'bolt' || e.k === 'burst') {
    if (tgt) {
      const fly = Math.max(.05, Math.abs(tgt.x - h.x) / 300);
      addFx(B, { t: 'bolt', from: h.x + h.dir * 22, x: tgt.x, big: e.k === 'burst' ? 1 : 0, life: fly });
      queueHit(h, { t: fly, k: e.k + 'Hit', id: tgt.id, cx: tgt.x, m: e.m });
    }
  } else if (e.k === 'boltHit' || e.k === 'burstHit') {
    {
      const big = e.k === 'burstHit', rad = big ? 42 : H.aoe, cx = tgt ? tgt.x : e.cx;
      addFx(B, { t: 'burst', x: cx, r: rad, life: big ? .4 : .28, big: big ? 1 : 0 });
      for (const m of B.mons.slice()) {
        if (Math.abs(m.x - cx) <= rad) { const r = roll(B, h, e.m); hitMon(G, B, m, r.dmg, r.crit, m.x < cx ? -1 : 1, big ? 22 : 8, now, ev); }
      }
    }
  } else if (e.k === 'heal' || e.k === 'sanctuary') {
    if (e.k === 'sanctuary') {
      addFx(B, { t: 'burst', x: h.x, r: 34, holy: 1, life: .4, big: 1 });
      for (const a of B.hs) if (a.hp > 0) { a.hp = Math.min(a.mhp, a.hp + h.st.atk * H.heal * h.st.heal + a.mhp * .05); addFx(B, { t: 'heal', x: a.x, life: .6 }); }
      for (const m of B.mons.slice()) if (Math.abs(m.x - h.x) <= 34) { const r = roll(B, h, e.m); hitMon(G, B, m, r.dmg, r.crit, m.x < h.x ? -1 : 1, 18, now, ev); }
    } else {
      const a = B.hs.find(o => o.idx === e.idx);
      if (a && a.hp > 0) { a.hp = Math.min(a.mhp, a.hp + h.st.atk * H.heal * h.st.heal + a.mhp * .015); addFx(B, { t: 'heal', x: a.x, life: .6 }); }
    }
  } else if (e.k === 'cleave') {
    addFx(B, { t: 'slash', x: h.x + h.dir * 30, dir: h.dir, big: 1, life: .3 });
    for (const m of B.mons.slice()) if (Math.abs(m.x - (h.x + h.dir * 26)) <= 44) { const r = roll(B, h, e.m); hitMon(G, B, m, r.dmg, r.crit, h.dir, 24, now, ev); }
  } else if (e.k === 'warCry') {
    addFx(B, { t: 'burst', x: h.x, r: 56, life: .4, big: 1, fire: 1 });
    h.hp = Math.min(h.mhp, h.hp + h.mhp * .08);
    addFx(B, { t: 'heal', x: h.x, life: .6 });
    for (const m of B.mons.slice()) if (Math.abs(m.x - h.x) <= 60) { const r = roll(B, h, e.m); hitMon(G, B, m, r.dmg, r.crit, m.x < h.x ? -1 : 1, 26, now, ev); }
  } else if (e.k === 'pierce') {
    addFx(B, { t: 'beam', from: h.x + h.dir * 22, x: h.x + h.dir * 150, life: .22 });
    for (const m of B.mons.slice()) if ((m.x - h.x) * h.dir > 0 && Math.abs(m.x - h.x) <= 150) { const r = roll(B, h, e.m); hitMon(G, B, m, r.dmg, r.crit, h.dir, 10, now, ev); }
  } else if (e.k === 'rain') {
    if (tgt) {
      addFx(B, { t: 'rain', x: tgt.x, life: .34 });
      queueHit(h, { t: .24, k: 'areaHit', cx: tgt.x, rad: 46, m: e.m, id: tgt.id, push: 6 });
    }
  } else if (e.k === 'comet') {
    if (tgt) {
      addFx(B, { t: 'meteor', x: tgt.x, life: .34 });
      queueHit(h, { t: .32, k: 'areaHit', cx: tgt.x, rad: 34, m: e.m, id: tgt.id, push: 30, boom: 1 });
    }
  } else if (e.k === 'areaHit') {
    const cx = tgt ? tgt.x : e.cx;
    addFx(B, { t: 'burst', x: cx, r: e.rad, life: .34, big: e.boom || 0, fire: 1 });
    for (const m of B.mons.slice()) if (Math.abs(m.x - cx) <= e.rad) { const r = roll(B, h, e.m); hitMon(G, B, m, r.dmg, r.crit, m.x < cx ? -1 : 1, e.push, now, ev); }
  } else if (e.k === 'chain') {
    const near = B.mons.filter(m => m.hp > 0).sort((a, b) => Math.abs(a.x - h.x) - Math.abs(b.x - h.x)).slice(0, 3);
    for (const m of near) {
      const fly = Math.max(.05, Math.abs(m.x - h.x) / 340);
      addFx(B, { t: 'bolt', from: h.x + h.dir * 22, x: m.x, life: fly });
      queueHit(h, { t: fly, k: 'zap', id: m.id, m: e.m });
    }
  } else if (e.k === 'zap') {
    if (tgt) { const r = roll(B, h, e.m); hitMon(G, B, tgt, r.dmg, r.crit, h.dir, 6, now, ev); }
  } else if (e.k === 'smite') {
    if (tgt) {
      addFx(B, { t: 'column', x: tgt.x, life: .34 });
      const r = roll(B, h, e.m);
      hitMon(G, B, tgt, r.dmg, r.crit, h.dir, 18, now, ev);
    }
    const low = B.hs.filter(a => a.hp > 0).sort((a, b) => a.hp / a.mhp - b.hp / b.mhp)[0];
    if (low) { low.hp = Math.min(low.mhp, low.hp + h.st.atk * H.heal * h.st.heal); addFx(B, { t: 'heal', x: low.x, life: .6 }); }
  } else if (e.k === 'renew') {
    addFx(B, { t: 'burst', x: h.x, r: 44, holy: 1, life: .45, big: 1 });
    for (const a of B.hs) if (a.hp > 0) { a.hp = Math.min(a.mhp, a.hp + a.mhp * .15 * e.m * h.st.heal); addFx(B, { t: 'heal', x: a.x, life: .6 }); }
  }
}
function stepHero(G, B, h, dt, now, ev) {
  h.px = h.x; h.at += dt; h.flash = Math.max(0, h.flash - dt); h.cd -= dt; h.hopCd = Math.max(0, h.hopCd - dt);
  if (h.hp <= 0) {
    h.down -= dt;
    if (h.down <= 0 && anyAlive(B)) { h.hp = h.mhp * .5; h.down = 0; setAnim(h, 'idle'); addFx(B, { t: 'heal', x: h.x, life: .6 }); }
    return;
  }
  // A charge drives into the enemy and stops against it. It never carries through to the far side.
  if (h.dash > 0) {
    h.dash -= dt;
    const t = nearestMon(B, h.x), stop = t ? t.w * .6 + 6 : 0, nx = h.x + h.dir * 170 * dt;
    // It also never carries the hero past the line, or each charge would creep them toward the gate.
    if ((h.dir > 0 || nx > LEASH - 18) && (!t || Math.sign(t.x - h.x) !== h.dir || Math.abs(t.x - nx) > stop)) h.x = nx;
  }
  if (h.q.length) {
    for (const e of h.q) e.t -= dt;
    while (h.q.length && h.q[0].t <= 0) fireHit(G, B, h, h.q.shift(), now, ev);
  }
  if (h.busy > 0) { h.busy -= dt; return; }
  // A back-step: shooters hop away from anything that gets right on top of them.
  if (h.hop > 0) { h.hop -= dt; h.x -= h.dir * 118 * dt; if (h.hop <= 0) setAnim(h, 'idle'); return; }
  const H = HEROES[h.key];
  if (H.heal && h.cd <= 0) {
    const hurt = B.hs.filter(o => o.hp > 0 && o.hp < o.mhp * .8).sort((a, b) => a.hp / a.mhp - b.hp / b.mhp)[0];
    if (hurt) {
      h.cd = 1 / h.st.aspd; h.ad = Math.min(.56, h.cd); h.ai = h.ad * .6; h.busy = h.ad; h.at = 0; h.a = 'cast';
      h.q.push({ t: h.ai, k: 'heal', idx: hurt.idx });
      return;
    }
  }
  const tgt = nearestMon(B, h.x);
  if (!tgt) {
    const home = homeX(h.idx), d = home - h.x;
    if (Math.abs(d) > 2) { h.dir = d > 0 ? 1 : -1; h.x += h.dir * Math.min(Math.abs(d), H.move * 1.1 * dt); setAnim(h, 'run'); }
    else { h.dir = -1; setAnim(h, 'idle'); }
    return;
  }
  const d = tgt.x - h.x;
  h.dir = d >= 0 ? 1 : -1;
  if (h.st.range > 60 && !tgt.shot && h.hopCd <= 0 && Math.abs(d) < 26 && h.x < ARENA.right - 20) {
    h.hop = .24; h.hopCd = 3; setAnim(h, 'hop');
    return;
  }
  // A boss is wide, so fighters stop short of its middle instead of standing inside it.
  if (Math.abs(d) > h.st.range + (tgt.boss ? 14 : 0)) {
    const nx = h.x + h.dir * H.move * dt;
    // Hold the line while monsters are still marching in. Shooters stay back, and anything
    // already able to hit this hero is always engaged, so a fight can never become a standoff.
    if (h.dir < 0 && nx < LEASH && !tgt.shot && Math.abs(d) > tgt.reach + 6) { setAnim(h, 'idle'); return; }
    h.x = nx; setAnim(h, 'run');
    return;
  }
  if (h.cd <= 0) startAttack(G, B, h, tgt);
  else setAnim(h, 'idle');
}
function hurtHero(B, h, amount) {
  const reduce = h.st.armor / (h.st.armor + 20 + 8 * B.info.lvl);
  const dmg = Math.max(1, amount * (1 - reduce) * (.9 + combat(B) * .2));
  h.hp -= dmg; h.flash = .14;
  addFx(B, { t: 'num', x: h.x, v: Math.round(dmg), hurt: 1, life: .7 });
  if (h.hp <= 0) { h.hp = 0; h.down = 12; h.q = []; h.busy = 0; h.dash = 0; h.hop = 0; setAnim(h, 'down'); }
}
function stepMon(G, B, m, dt) {
  m.px = m.x; m.at += dt; m.flash = Math.max(0, m.flash - dt);
  if (m.kb) { m.x += m.kb * dt; m.kb *= .55; if (Math.abs(m.kb) < 1) m.kb = 0; }
  const tgt = nearestHero(B, m.x);
  if (!tgt) return;
  // A thrown orb lands when it gets there.
  if (m.shotT > 0) { m.shotT -= dt; if (m.shotT <= 0) hurtHero(B, tgt, m.dmg); }
  const d = tgt.x - m.x;
  if (m.busy > 0) {
    m.busy -= dt;
    if (m.hitAt >= 0 && m.busy <= m.hitAt) {
      m.hitAt = -1;
      if (m.slamming) {
        m.slamming = 0;
        addFx(B, { t: 'shock', x: m.x + m.dir * 20, life: .45 });
        B.shake = .25;
        for (const h of B.hs) if (h.hp > 0 && Math.abs(h.x - m.x) <= 78) hurtHero(B, h, m.dmg * 1.5);
      } else if (m.shot) {
        m.shotT = Math.max(.05, Math.abs(d) / 260);
        addFx(B, { t: 'orb', from: m.x + m.dir * 14, x: tgt.x, life: m.shotT });
      } else if (Math.abs(d) <= m.reach + 6) {
        addFx(B, { t: 'claw', x: tgt.x, life: .18 });
        hurtHero(B, tgt, m.dmg);
      }
    }
    return;
  }
  m.dir = d >= 0 ? 1 : -1;
  if (m.boss) {
    m.slam -= dt;
    if (m.slam <= 0 && Math.abs(d) <= 90) {
      m.slam = 6; m.slamming = 1; m.busy = 1; m.hitAt = .2; m.ad = 1; m.ai = .8; m.at = 0; m.a = 'atk';
      addFx(B, { t: 'warn', x: m.x + m.dir * 20, life: .8 });
      return;
    }
  }
  if (Math.abs(d) > m.reach) { m.x += m.dir * m.spd * dt; setAnim(m, 'walk'); return; }
  m.cd -= dt;
  if (m.cd <= 0) { m.cd = 1 / m.aspd - .14; m.busy = .5; m.hitAt = .24; m.ad = .5; m.ai = .26; m.at = 0; m.a = 'atk'; }
  else if (m.a !== 'walk') { setAnim(m, 'walk'); }
}
// Keeps a marching column from stacking on one spot.
function separate(B) {
  const ground = B.mons.filter(m => !m.fly).sort((a, b) => b.x - a.x || a.id - b.id);
  for (let i = 1; i < ground.length; i++) {
    const a = ground[i - 1], b = ground[i], gap = (a.w + b.w) / 2;
    if (a.x - b.x < gap) b.x = a.x - gap;
  }
  const crew = B.hs.filter(h => h.hp > 0).sort((a, b) => a.x - b.x || a.idx - b.idx);
  for (let i = 1; i < crew.length; i++) {
    const a = crew[i - 1], b = crew[i];
    if (b.x - a.x < 33) { const push = (33 - (b.x - a.x)) / 2; a.x -= push; b.x += push; }
  }
  for (const h of B.hs) h.x = clamp(h.x, ARENA.left, ARENA.right);
  // Nothing may be shoved out of the crew's reach, or a fight could never end.
  for (const m of B.mons) m.x = clamp(m.x, ARENA.gate - 2, ARENA.right + 10);
}

// Advance the battle by dt seconds. Returns events for the UI.
function step(G, B, dt, now) {
  const ev = [];
  if (G.statsDirty) syncParty(G, B);
  B.t += dt;
  B.shake = Math.max(0, B.shake - dt);
  B.trans = Math.max(0, B.trans - dt);
  // Chest timer runs only while the game is open.
  if (G.chests.length < chestCap(G)) {
    G.chestT -= dt * B.bonus.chest;
    if (G.chestT <= 0) {
      G.chestT = CFG.CHEST_BASE;
      G.chests.push({ stage: G.stage, boss: false, at: now });
      ev.push({ t: 'chest' });
      if (talent(G, 'auto')) openAuto(G, B, now, ev);
    }
  }
  if (B.state === 'regroup') {
    B.retry -= dt;
    for (const h of B.hs) {
      h.px = h.x; h.at += dt;
      h.hp = Math.min(h.mhp, Math.max(h.hp, 0) + h.mhp * dt / 5);
      const home = homeX(h.idx), d = home - h.x;
      if (Math.abs(d) > 2) { h.dir = d > 0 ? 1 : -1; h.x += h.dir * Math.min(Math.abs(d), 60 * dt); setAnim(h, 'run'); } else { h.dir = -1; setAnim(h, 'idle'); }
    }
    if (B.retry <= 0) enterStage(G, B);
    decayFx(B, dt);
    return ev;
  }
  if (B.spawnQ.length) {
    B.spawnT -= dt;
    const blocked = B.mons.some(m => !m.fly && m.x < ARENA.gate + 12);
    if (B.spawnT <= 0 && !blocked) { spawnOne(G, B); B.spawnT = .5; }
  } else if (!B.mons.length) {
    for (const h of B.hs) if (h.hp > 0) h.hp = Math.min(h.mhp, h.hp + h.mhp * dt * .05);
    B.delay -= dt;
    if (B.delay <= 0) {
      if (B.wave >= B.waves) stageClear(G, B, now, ev);
      else { spawnWave(G, B); B.delay = .9; }
    }
  }
  for (const h of B.hs) stepHero(G, B, h, dt, now, ev);
  B.mons = B.mons.filter(m => m.hp > 0);
  for (const m of B.mons) stepMon(G, B, m, dt);
  separate(B);
  if (!anyAlive(B)) wipe(G, B, now, ev);
  decayFx(B, dt);
  return ev;
}
function decayFx(B, dt) {
  for (const f of B.fx) f.age += dt;
  B.fx = B.fx.filter(f => f.age < f.life);
}
function stageClear(G, B, now, ev) {
  const info = B.info;
  const coin = Math.round(monCoin(info.lvl) * 6 * B.bonus.coin);
  G.coin += coin; G.ledger.coinKills += coin;
  if (info.boss) {
    G.mats.seal--;
    G.stats.boss++;
    G.chests.push({ stage: G.stage, boss: true, at: now });
    ev.push({ t: 'bossDown', name: REGIONS[info.r].boss });
    if (talent(G, 'auto')) openAuto(G, B, now, ev);
  }
  ev.push({ t: 'clear', info });
  if (!G.hold) {
    const nxt = G.stage + 1;
    if (canEnter(G, nxt)) { G.stage = nxt; G.maxStage = Math.max(G.maxStage, nxt); }
  }
  if (stageInfo(G.stage).boss && G.mats.seal < 1) G.stage = Math.max(0, G.stage - 1);
  enterStage(G, B);
}
function wipe(G, B, now, ev) {
  G.stats.wipes++;
  const was = B.info;
  G.stage = Math.max(0, G.stage - 1);
  if (stageInfo(G.stage).boss && G.mats.seal < 1) G.stage = Math.max(0, G.stage - 1);
  G.hold = false;
  B.state = 'regroup'; B.retry = 4; B.mons = []; B.spawnQ = [];
  for (const h of B.hs) { h.hp = 1; h.down = 0; h.q = []; h.busy = 0; h.dash = 0; setAnim(h, 'idle'); }
  ev.push({ t: 'wipe', info: was });
}
function jumpStage(G, B, i) {
  if (i < 0 || i > G.maxStage) return { err: 'You have not reached that stage yet.' };
  if (stageInfo(i).boss && G.mats.seal < 1) return { err: 'That gate needs a Warden Seal.' };
  G.stage = i; enterStage(G, B);
  return { ok: true };
}

// ---------------------------------------------------------------- away income
function applyAway(G, now) {
  const away = now - G.lastSeen;
  G.lastSeen = now;
  if (away < 2 * MIN) return null;
  const hours = Math.min(8, CFG.OFFLINE_BASE_H + talent(G, 'offline'));
  const secs = Math.min(away, hours * HOUR) / 1000;
  const L = stageInfo(G.stage).lvl;
  const killsPerSec = .55;
  const b = partyBonus(G);
  const coin = Math.round(secs * killsPerSec * monCoin(L) * CFG.OFFLINE_RATE * (1 + .1 * talent(G, 'coin') + b.coin / 100));
  const xp = Math.round(secs * killsPerSec * monXp(L) * CFG.OFFLINE_RATE * (1 + .1 * talent(G, 'xp') + b.xp / 100));
  G.coin += coin; G.ledger.coinAway += coin;
  grantXp(G, xp, []);
  G.statsDirty = true;
  const res = { away, secs, coin, xp };
  mail(G, now, `While you were away your crew earned ${coin.toLocaleString('en-US')} coin and ${xp.toLocaleString('en-US')} XP. Chests only drop while the game is open.`, 'away');
  return res;
}

// ---------------------------------------------------------------- exchange
function parseKey(key) {
  if (key.startsWith('mat.')) return { mat: key.slice(4) };
  const [s, b, g] = key.split('.');
  return { s, b: +b, g: +g };
}
function isValidKey(key) {
  if (typeof key !== 'string') return false;
  if (key.startsWith('mat.')) return Object.hasOwn(MATS, key.slice(4));
  const parts = key.split('.');
  if (parts.length !== 3 || !SLOTS.includes(parts[0])) return false;
  const b = Number(parts[1]), g = Number(parts[2]);
  return String(b) === parts[1] && String(g) === parts[2] && Number.isInteger(b) && Number.isInteger(g) && b >= 0 && b < BANDS.length && g >= 0 && g < GRADES.length;
}
function keyName(key) {
  const p = parseKey(key);
  return p.mat ? MATS[p.mat].n : `${BANDS[p.b]} ${SLOT_NAME[p.s]}`;
}
function basePrice(key) {
  const p = parseKey(key);
  if (p.mat) return MATS[p.mat].price;
  return GRADES[p.g].price * SLOT_PRICE[p.s] * (1 + p.b * .25);
}
const EVENT_MS = 12 * HOUR;
function eventFor(t) {
  const b = Math.floor(t / EVENT_MS);
  const g = 3 + (h32('evg', b) % 5);
  const kind = h32('evk', b) % 3;
  const n = 120 + (h32('evn', b) % 880);
  if (kind === 0) return { b, g, mult: .65, supply: 1.6, kind: 'glut', text: `Glut: a caravan dumped ${n} ${GRADES[g].n} pieces. Prices are down.` };
  if (kind === 1) return { b, g, mult: 1.45, supply: .6, kind: 'shortage', text: `Shortage: road closures cut ${GRADES[g].n} supply. Prices are up.` };
  return { b, g, mult: 1.2, supply: .8, kind: 'audit', text: `Audit: the guild purged ${n} forged ${GRADES[g].n} listings. Prices are firming.` };
}
function refPrice(key, t, peerCount) {
  const p = parseKey(key);
  let v = basePrice(key);
  const seed = h32('ref', key);
  v *= 1 + .18 * noise1(seed, t / (6 * HOUR)) + .08 * noise1(seed + 1, t / HOUR);
  const ev = eventFor(t);
  if (p.g === ev.g) v *= ev.mult;
  if (peerCount) v /= 1 + .04 * peerCount;
  return Math.max(CFG.FLOOR, Math.round(v));
}
function supplyCount(key, t) {
  const p = parseKey(key);
  const seed = h32('sup', key);
  const SUP = [40000, 26000, 15000, 5000, 1100, 180, 22, 3];
  let v;
  if (p.mat) v = { seal: 120000, gem1: 60000, gem2: 9000, gem3: 700 }[p.mat];
  else {
    v = SUP[p.g] * (.5 + u01(seed));
    const ev = eventFor(t);
    if (p.g === ev.g) v *= ev.supply;
  }
  v *= 1 + .12 * noise1(seed, t / (4 * HOUR));
  return Math.max(1, Math.round(v));
}
const driftAsk = (key, t, peerCount) => Math.max(CFG.FLOOR, Math.ceil(refPrice(key, t, peerCount) * CFG.DRIFT_SPREAD));
// A cut of every sale is destroyed. Nobody collects it: not the house, not the team.
function feesFor(price) {
  const burn = Math.max(2, Math.round(price * CFG.FEE_BURN));
  return { burn, net: price - burn };
}
function saleHazard(price, ref, grade, isMat) {
  const base = isMat ? .08 : GRADES[grade].hazard;
  return clamp(base * Math.exp(-3 * (price / ref - 1)), 0, .7);
}
function saleSpeed(price, ref, grade, isMat, traded) {
  if (traded) return { label: 'Players only', detail: 'drifters only buy freshly found goods', h: 0 };
  const h = saleHazard(price, ref, grade, isMat);
  const minutes = 5 / Math.max(h, 1e-6);
  if (minutes < 25) return { label: 'Fast', detail: 'about ' + Math.round(minutes) + ' min', h };
  if (minutes < 120) return { label: 'Steady', detail: 'about ' + Math.round(minutes / 5) * 5 + ' min', h };
  if (minutes < 720) return { label: 'Slow', detail: 'about ' + Math.round(minutes / 60) + ' h', h };
  return { label: 'Unlikely', detail: 'overpriced', h };
}
function canList(G, it, now) {
  if (G.forge.lvl < CFG.LIST_GATE) return `Listing opens at Forge level ${CFG.LIST_GATE}. Salvage items to level up.`;
  if (it) {
    if (equippedBy(G, it.id)) return 'Take this off your traveller first.';
    if (it.k) return 'This item is locked. Unlock it first.';
    if ((it.e || []).length) return 'Strip all etchings before listing.';
    if (it.t > now) return 'This item is still under its resale lock.';
  }
  if (freeSlot(G, now) < 0) return 'All 4 listing slots are busy or cooling down.';
  return null;
}
function freeSlot(G, now) {
  const m = G.market;
  for (let i = 0; i < m.slots.length; i++) {
    if (m.slots[i] <= now && !m.mine.some(l => l.slot === i)) return i;
  }
  return -1;
}
// Moves the item out of the pack into a listing record. The UI mirrors it to the shared store.
function createListing(G, spec, price, now) {
  const slot = freeSlot(G, now);
  if (slot < 0) return { err: 'All 4 listing slots are busy or cooling down.' };
  if (typeof price !== 'number' || !Number.isFinite(price) || price < CFG.FLOOR) return { err: `The lowest legal price is ${CFG.FLOOR} DND.` };
  price = Math.round(price);
  let rec;
  if (spec.itemId) {
    const it = findItem(G, spec.itemId);
    const why = canList(G, it, now);
    if (!it || why) return { err: why || 'Item not found.' };
    G.items = G.items.filter(i => i !== it);
    rec = { key: marketKey(it), item: { id: it.id, s: it.s, l: it.l, g: it.g, r: it.r } };
    if (it.nd) rec.item.nd = 1;
  } else {
    const why = canList(G, null, now);
    if (why) return { err: why };
    const qty = Math.floor(spec.qty);
    if (!Object.hasOwn(MATS, spec.mat) || !Number.isInteger(qty) || qty < 1 || G.mats[spec.mat] < qty) return { err: 'You do not have that many.' };
    G.mats[spec.mat] -= qty;
    rec = { key: 'mat.' + spec.mat, mat: spec.mat, qty };
  }
  const id = idSource ? 'L' + idSource() : 'L' + now.toString(36) + (h32(G.seed, G.nextId++) % 46656).toString(36);
  Object.assign(rec, { id, price, at: now, slot, checked: Math.floor(now / (5 * MIN)) });
  G.market.mine.push(rec);
  G.market.slots[slot] = now + CFG.LIST_COOLDOWN;
  return { rec };
}
function cancelListing(G, id) {
  const m = G.market, rec = m.mine.find(l => l.id === id);
  if (!rec) return null;
  m.mine = m.mine.filter(l => l !== rec);
  if (rec.item) G.items.push(Object.assign({ e: [], k: 0, t: 0 }, rec.item));
  else G.mats[rec.mat] += rec.qty;
  return rec;
}
// Pays the seller and records the fee split. Safe to call once per listing.
function settleSale(G, rec, buyerLabel, now) {
  const f = feesFor(rec.price);
  G.market.mine = G.market.mine.filter(l => l.id !== rec.id);
  G.marks += f.net;
  const L = G.ledger;
  L.marksIn += f.net; L.burned = (L.burned || 0) + f.burn; L.sold++;
  const name = rec.mat ? `${rec.qty} × ${MATS[rec.mat].n}` : `${GRADES[rec.item.g].n} ${keyName(rec.key)}`;
  mail(G, now, `${buyerLabel} bought your ${name} for ${rec.price} DND. You kept ${f.net}, and ${f.burn} DND was burned.`, 'sale');
  return f;
}
// Rolls simulated buyers over each 5-minute bucket since the last check.
// The roll is hashed from the listing id, so a sale decided while away stays decided.
function dueDrifterSales(G, now, peerCountOf, roll) {
  const out = [];
  const nowB = Math.floor(now / (5 * MIN));
  for (const rec of G.market.mine) {
    if (rec.item && rec.item.nd) { rec.checked = nowB; continue; }
    let sold = false;
    for (let b = rec.checked + 1; b <= nowB; b++) {
      const t = b * 5 * MIN;
      const ref = refPrice(rec.key, t, peerCountOf ? peerCountOf(rec.key) : 0);
      const grade = rec.item ? rec.item.g : 0;
      const hz = saleHazard(rec.mat ? rec.price / rec.qty : rec.price, rec.mat ? Math.max(1, MATS[rec.mat].price) : ref, grade, !!rec.mat);
      if ((roll ? roll(rec.id, b) : u01(rec.id, b)) < hz) { sold = true; break; }
    }
    rec.checked = nowB;
    if (sold) out.push(rec);
  }
  return out;
}
function buyFromDrifter(G, key, now, peerCount) {
  const hourB = Math.floor(now / HOUR);
  if (!isValidKey(key)) return { err: 'Unknown item.' };
  if (!key.startsWith('mat.') && G.items.length >= packCap(G)) return { err: 'Your Pack is full.' };
  if (G.market.drift[key] === hourB) return { err: 'This drifter has sold out for the hour. Try again later.' };
  const price = driftAsk(key, now, peerCount);
  if (G.marks < price) return { err: `Needs ${price} DND.` };
  const p = parseKey(key);
  G.marks -= price; G.ledger.marksOut += price; G.ledger.bought++;
  G.ledger.burned = (G.ledger.burned || 0) + price;
  G.market.drift[key] = hourB;
  if (p.mat) { G.mats[p.mat]++; return { price, mat: p.mat, qty: 1 }; }
  const it = makeItem(G, p.s, 1 + p.b * 12 + Math.floor(u01(key, hourB) * 12), p.g, { t: now + CFG.RESALE_LOCK, nd: 1 });
  addItem(G, it, now);
  return { price, item: it };
}
function netWorth(G, now) {
  let v = G.marks;
  for (const it of G.items) v += refPrice(marketKey(it), now);
  for (const m in G.mats) v += G.mats[m] * MATS[m].price;
  for (const rec of G.market.mine) v += rec.price;
  return Math.round(v);
}
function allKeysForGrade(g) {
  const out = [];
  for (const s of SLOTS) for (let b = 0; b < BANDS.length; b++) out.push(`${s}.${b}.${g}`);
  return out;
}
function gradeLadder(now) {
  return GRADES.map((gr, g) => {
    const keys = allKeysForGrade(g);
    const prices = keys.map(k => refPrice(k, now)).sort((a, b) => a - b);
    const y = keys.map(k => refPrice(k, now - 24 * HOUR));
    const sum = a => a.reduce((x, z) => x + z, 0);
    return {
      g, name: gr.n, color: gr.c,
      median: prices[Math.floor(prices.length / 2)],
      low: prices[0], high: prices[prices.length - 1],
      atFloor: prices.filter(p => p <= CFG.FLOOR).length / prices.length,
      supply: keys.reduce((a, k) => a + supplyCount(k, now), 0),
      change: sum(prices) / sum(y) - 1,
    };
  });
}

root.TF = {
  MIN, HOUR, CFG, GRADES, SLOTS, SLOT_NAME, SLOT_LABEL, BANDS, AFFIXES, MATS, HEROES, HERO_KEYS, REGIONS, DIFFS, STAGE_COUNT, TALENTS, FUSE, FUSE_GATE, LEVEL_CAP,
  h32, u01, clamp, stageInfo, xpNeed, forgeNeed, bandOf, budget, itemName, marketKey, itemStats, makeItem,
  newGame, mail, talent, partySize, FREE_HERO, owns, migrateOwned, buyHero, packCap, chestCap, addItem, findItem, equippedBy, equip, unequip, equipBest, heroStats, partyBonus, partyPower,
  openChest, salvage, salvageUpTo, fuseCandidates, fuse, etch, stripCost, strip, buyTalent, talentDef, toggleParty, canEnter, TOKEN, SKILLS, SKILL_TIERS, SIGNATURE, skillDef, skillMult, skillsOf, skillCap, skillSlots, skillPoints, skillUp, skillEquip, skillReset, skillResetCost, skillAuto,
  ARENA, BATTLE_V, MON_KINDS, newBattle, syncParty, enterStage, step, jumpStage, applyAway,
  parseKey, keyName, eventFor, refPrice, supplyCount, driftAsk, feesFor, saleHazard, saleSpeed, canList, freeSlot, createListing, cancelListing, settleSale, dueDrifterSales, buyFromDrifter, netWorth, allKeysForGrade, gradeLadder, monHp, monDmg, isValidKey, setRandom, setIdSource,
};
})(typeof window !== 'undefined' ? window : globalThis);
