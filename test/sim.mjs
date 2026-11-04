// Headless playthrough: a simple agent plays for N hours so pacing and the
// economy can be checked without a browser. Usage: node test/sim.mjs [hours] [seed] [extra heroes]
// With no extra heroes it plays a free crew, the Kitten Knight alone. Extra heroes are ones it has bought.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { console, Math, Date };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../src/engine.js', import.meta.url), 'utf8'), ctx);
const TF = ctx.TF;

const hours = +(process.argv[2] || 24);
const seed = +(process.argv[3] || 12345);
let now = Date.UTC(2026, 10, 4);
const start = now;
const G = TF.newGame(now, seed);
for (const k of (process.argv[4] || '').split(',').filter(Boolean)) G.owned.push(k);
const B = TF.newBattle(G);
const dt = 0.1;
const milestones = [];
const seen = new Set();
const mark = (label) => { if (!seen.has(label)) { seen.add(label); milestones.push([((now - start) / 60e3).toFixed(1) + ' min', label]); } };
const gradeCount = new Array(8).fill(0);
let sales = 0, marksGross = 0;

const roster = ['warden', 'mender', 'fletcher', 'hexer'];
function agent() {
  while (G.chests.length) {
    const r = TF.openChest(G, now);
    if (r) for (const l of r.loot) if (l.item) gradeCount[l.item.g]++;
  }
  for (const k of roster) if (G.party.length < TF.partySize(G) && !G.party.includes(k)) TF.toggleParty(G, k);
  for (const k of G.party) { TF.equipBest(G, k); TF.skillAuto(G, k); }
  // Keep the best 3 of each rare grade to sell, salvage or fuse the rest.
  for (let g = 0; g < 3; g++) {
    const fg = TF.fuseCandidates(G, g);
    if (fg.length >= 9 && G.forge.lvl >= TF.FUSE_GATE[g] && G.coin > TF.FUSE[g].cost * 4) TF.fuse(G, g);
  }
  TF.salvageUpTo(G, 1);
  if (G.items.length > 80) TF.salvageUpTo(G, 2);
  // Spend coin on the cheapest useful talent.
  const opts = TF.TALENTS.filter(t => (G.talents[t.k] || 0) < t.max).sort((a, b) => a.cost(G.talents[a.k] || 0) - b.cost(G.talents[b.k] || 0));
  for (const t of opts) { if (G.coin > t.cost(G.talents[t.k] || 0)) TF.buyTalent(G, t.k); }
  // List the most valuable unequipped item whenever a slot is free.
  if (G.forge.lvl >= TF.CFG.LIST_GATE && TF.freeSlot(G, now) >= 0) {
    const cands = G.items.filter(i => !TF.equippedBy(G, i.id) && !i.k && !(i.e || []).length && i.t <= now && i.g >= 3)
      .sort((a, b) => TF.refPrice(TF.marketKey(b), now) - TF.refPrice(TF.marketKey(a), now));
    if (cands[0]) TF.createListing(G, { itemId: cands[0].id }, TF.refPrice(TF.marketKey(cands[0]), now), now);
  }
  for (const rec of TF.dueDrifterSales(G, now)) { TF.settleSale(G, rec, 'A drifter', now); sales++; marksGross += rec.price; }
}

const totalSteps = Math.round(hours * 3600 / dt);
const report = [1, 2, 4, 8, 12, 24, 48, 72, 168].filter(h => h <= hours);
for (let i = 0; i < totalSteps; i++) {
  now += dt * 1000;
  const ev = TF.step(G, B, dt, now);
  for (const e of ev) {
    if (e.t === 'bossDown') mark('First kill: ' + e.name);
    if (e.t === 'wipe' && !seen.has('wipe')) mark('First wipe at ' + e.info.name);
  }
  if (i % 100 === 0) {
    agent();
    mark('Reached ' + TF.DIFFS[TF.stageInfo(G.maxStage).d]);
    mark('Region: ' + TF.REGIONS[TF.stageInfo(G.maxStage).r].n);
    if (G.forge.lvl >= 3) mark('Exchange listing unlocked (Forge 3)');
    if (G.party.length >= 2) mark('Second traveller');
    if (G.party.length >= 3) mark('Third traveller');
  }
  const h = (i + 1) * dt / 3600;
  if (report.length && h >= report[0]) {
    const s = TF.stageInfo(G.stage);
    console.log(`t=${String(report[0]).padStart(3)}h stage ${s.i + 1}/${TF.STAGE_COUNT} (${s.diff} ${s.name}) max ${G.maxStage + 1} | lvl ${G.party.map(k => G.heroes[k].lvl).join('/')} | power ${TF.partyPower(G)} | coin ${Math.round(G.coin)} | marks ${G.marks} | forge ${G.forge.lvl} | seals ${G.mats.seal} | wipes ${G.stats.wipes} | chests ${G.stats.chests} | best ${TF.GRADES[G.stats.best].n}`);
    report.shift();
  }
}
console.log('\nMilestones:'); for (const [t, l] of milestones) console.log(' ', t.padStart(10), l);
console.log('\nChest gear by grade:', TF.GRADES.map((g, i) => `${g.n} ${gradeCount[i]}`).join(', '));
const L = G.ledger;
console.log(`Sales ${sales}, gross ${marksGross} DND | seller kept ${L.marksIn} | burned ${L.burned || 0}`);
console.log(`Items made ${L.itemsMade}, burned ${L.itemsBurned}, in pack ${G.items.length} | coin kills ${L.coinKills} salvage ${L.coinSalvage} spent talents ${L.coinTalents} forge ${L.coinForge}`);
console.log('\nPrice ladder now:');
for (const r of TF.gradeLadder(now)) console.log(`  ${r.name.padEnd(9)} median ${String(r.median).padStart(6)}  range ${r.low}-${r.high}  at floor ${(r.atFloor * 100).toFixed(0).padStart(3)}%  supply ${r.supply}`);

// Rule checks. These throw on failure, so a passing run means the rules hold.
const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); };
const f3 = TF.feesFor(3); assert(f3.net === 1 && f3.burn === 2, 'floor price burns 2 and pays 1');
const f100 = TF.feesFor(100); assert(f100.net === 85, '15% total fee at 100');
const T = TF.newGame(start, 7);
assert(T.items.length === 14 && T.mats.seal === 2, 'starter crate contents');
const F = TF.newGame(start, 8); TF.salvageUpTo(F, 1); assert(F.forge.lvl >= TF.CFG.LIST_GATE, 'salvaging the starter crate opens selling');
const sellable = T.items.find(i => i.g === 3);
assert(TF.canList(T, sellable, start).includes('Forge'), 'listing gated by forge level');
T.forge.lvl = 3;
assert(TF.canList(T, sellable, start) === null, 'listing allowed at forge 3');
sellable.e = [[0, 0]]; assert(TF.canList(T, sellable, start).includes('Strip'), 'etched items cannot list'); sellable.e = [];
const bad = TF.createListing(T, { itemId: sellable.id }, 2, start); assert(bad.err, 'prices under the floor are rejected');
assert(T.items.includes(sellable), 'rejected listing keeps the item');
const ok = TF.createListing(T, { itemId: sellable.id }, 20, start); assert(ok.rec && !T.items.includes(sellable), 'listing removes item from pack');
assert(T.market.slots[ok.rec.slot] > start, 'slot starts cooling');
TF.cancelListing(T, ok.rec.id); assert(T.items.some(i => i.r === sellable.r), 'cancel returns the item with its roll');
assert(TF.freeSlot(T, start) !== ok.rec.slot, 'cancel does not refund the slot cooldown');
for (let i = 0; i < 3; i++) { const it = TF.makeItem(T, 'boots', 5, 3); TF.addItem(T, it, start); assert(TF.createListing(T, { itemId: it.id }, 10, start).rec, 'slot ' + i); }
const extra = TF.makeItem(T, 'boots', 5, 3); TF.addItem(T, extra, start);
assert(TF.createListing(T, { itemId: extra.id }, 10, start).err, 'fifth listing inside the cooldown is refused');
// Heroes: one is free, the rest cost DND that burns, and old crews move over fairly.
const P1 = TF.newGame(start, 21), PRICE = TF.CFG.HERO_PRICE;
assert(JSON.stringify(P1.owned) === '["warden"]' && JSON.stringify(P1.party) === '["warden"]', 'a new crew has only the Kitten Knight');
assert(TF.toggleParty(P1, 'fletcher').err, 'a hero you do not own cannot be deployed');
P1.marks = PRICE - 1;
assert(TF.buyHero(P1, 'fletcher').err && P1.marks === PRICE - 1 && !TF.owns(P1, 'fletcher'), 'one DND short buys nothing and costs nothing');
P1.marks = PRICE + 7;
assert(TF.buyHero(P1, 'fletcher').price === PRICE && P1.marks === 7, 'a hero costs exactly the price');
assert(TF.owns(P1, 'fletcher') && P1.party.includes('fletcher') && TF.partySize(P1) === 2, 'a bought hero joins the road at once');
assert(P1.ledger.burned === PRICE, 'the price counts as burned');
P1.marks = PRICE;
assert(TF.buyHero(P1, 'fletcher').err && P1.marks === PRICE, 'a hero cannot be bought twice');
assert(TF.buyHero(P1, 'warden').err, 'the free hero is never for sale');
assert(!TF.toggleParty(P1, 'fletcher').err && !P1.party.includes('fletcher') && !TF.toggleParty(P1, 'fletcher').err, 'a bought hero can stand down and come back');
const P2 = TF.newGame(start, 22); delete P2.owned; P2.party = ['warden', 'hexer']; P2.talents.slot = 1; P2.coin = 10;
const hexItem = TF.makeItem(P2, 'weapon', 1, 1); TF.addItem(P2, hexItem, start, true); TF.equip(P2, 'hexer', hexItem.id);
TF.migrateOwned(P2);
assert(JSON.stringify(P2.party) === '["warden"]' && JSON.stringify(P2.owned) === '["warden"]', 'an old crew keeps only the free hero');
assert(P2.coin === 1510 && P2.talents.slot === undefined, 'an old crew gets its Crew Roster coin back');
assert(!TF.equippedBy(P2, hexItem.id) && TF.findItem(P2, hexItem.id), 'gear on a locked hero returns to the Pack');
const P2before = JSON.stringify(P2); TF.migrateOwned(P2); assert(JSON.stringify(P2) === P2before, 'moving a crew over twice changes nothing');

const d = TF.newGame(start, 9); d.marks = 100000;
const bought = TF.buyFromDrifter(d, 'charm.2.4', start); assert(bought.item && bought.item.t > start, 'drifter items carry a resale lock');
d.forge.lvl = 3; assert(TF.canList(d, bought.item, start).includes('resale'), 'locked items cannot be flipped');
assert(TF.buyFromDrifter(d, 'charm.2.4', start).err, 'drifter stock is one per hour');
const away = TF.newGame(start, 11); const chestsBefore = away.chests.length; const c0 = away.coin; away.lastSeen = start - 3 * 3600e3;
const res = TF.applyAway(away, start); assert(res.coin > 0 && away.coin > c0 && away.chests.length === chestsBefore && res.secs === 3600, 'away pays capped coin, no chests');
const fz = TF.newGame(start, 13); fz.coin = 1e9; fz.forge.lvl = 20;
for (let i = 0; i < 9; i++) TF.addItem(fz, TF.makeItem(fz, 'ring' === 0 ? 'x' : 'helm', 20, 4), start);
const nBefore = fz.items.length; const out = TF.fuse(fz, 4); assert(out.item && fz.items.length === nBefore - 8, 'fuse burns 9 and makes 1');
// Rules the market depends on.
const M = TF.newGame(start, 21); M.forge.lvl = 3;
assert(TF.createListing(M, { mat: 'seal', qty: NaN }, 5, start).err, 'NaN quantity rejected');
assert(TF.createListing(M, { mat: '__proto__', qty: 1 }, 5, start).err, 'prototype key rejected');
assert(TF.createListing(M, { mat: 'seal', qty: 1 }, '5', start).err, 'string price rejected');
assert(M.mats.seal === 2, 'rejected listings leave materials alone');
assert(!TF.isValidKey('charm.2') && !TF.isValidKey('charm.2.99') && !TF.isValidKey('mat.__proto__') && !TF.isValidKey('charm.1e0.1') && TF.isValidKey('charm.2.4') && TF.isValidKey('mat.seal'), 'market keys are strict');
const N = TF.newGame(start, 22); N.marks = 1e6; N.forge.lvl = 3;
const traded = TF.buyFromDrifter(N, 'helm.0.3', start).item; assert(traded.nd === 1, 'drifter goods carry the traded mark');
traded.t = 0; const tl = TF.createListing(N, { itemId: traded.id }, 3, start + 1);
assert(tl.rec.item.id === traded.id, 'listing keeps item identity');
assert(TF.dueDrifterSales(N, start + 40 * 86400e3).length === 0, 'drifters never buy traded goods');
TF.cancelListing(N, tl.rec.id); assert(TF.findItem(N, traded.id).nd === 1, 'cancel keeps item identity and the traded mark');
const P = TF.newGame(start, 23); P.coin = 1e9; P.forge.lvl = 20;
for (let i = 0; i < 9; i++) TF.addItem(P, TF.makeItem(P, 'helm', 20, 2, i === 0 ? { nd: 1 } : null), start);
assert(TF.fuse(P, 2).item.nd === 1, 'fusing traded goods keeps the mark');
// Replaying a battle from a snapshot in preview mode must match the original exactly.
const R = TF.newGame(start, 24); const RB = TF.newBattle(R);
for (let i = 0; i < 1500; i++) TF.step(R, RB, .1, start);
const copyG = JSON.parse(JSON.stringify(R)), copyB = JSON.parse(JSON.stringify(RB)); copyB.preview = true; delete copyG.rng; delete copyG.seed;
for (let i = 0; i < 1500; i++) { TF.step(R, RB, .1, start); TF.step(copyG, copyB, .1, start); }
const strip = b => JSON.stringify({ ...b, fx: 0, preview: 0 });
assert(strip(RB) === strip(copyB), 'preview replays the battle exactly');
// A fight must always finish: every party size, stage band and monster mix keeps killing.
for (const [stage, size] of [[0, 1], [9, 2], [14, 1], [20, 3], [24, 1], [27, 1], [28, 1], [45, 3], [60, 4], [75, 3], [85, 1], [85, 4]]) {
  const F2 = TF.newGame(start, 100 + stage); F2.coin = 1e9; F2.party = ['warden', 'mender', 'fletcher', 'hexer'].slice(0, size); F2.owned = [...F2.party];
  for (const k of F2.party) { F2.heroes[k].lvl = 70; TF.equipBest(F2, k); }
  F2.stage = stage; F2.maxStage = stage; F2.hold = true; F2.mats.seal = 99;
  const FB = TF.newBattle(F2); let last = 0, gap = 0, worst = 0;
  // Enough damage to kill fast at any stage, so this measures stalls and not raw power.
  for (const h of FB.hs) { h.st.atk = TF.monHp(stage + 1) * 4; h.hp = h.mhp = 1e12; h.st.hp = 1e12; }
  F2.statsDirty = false;
  for (let i = 0; i < 6000; i++) {
    TF.step(F2, FB, .1, start + i * 100);
    gap = F2.stats.kills > last ? 0 : gap + .1; last = F2.stats.kills; worst = Math.max(worst, gap);
  }
  assert(F2.stats.kills > 60, `stage ${stage} with ${size} heroes keeps killing: ${F2.stats.kills}`);
  assert(worst < 30, `stage ${stage} with ${size} heroes never stalls: longest gap ${worst.toFixed(1)}s`);
}
// Every active skill must work: it fires, deals or heals, and never poisons the fight with bad numbers.
for (const key of TF.HERO_KEYS) {
  for (const def of TF.SKILLS[key].filter(d => d.act)) {
    const G3 = TF.newGame(1e12, 4242);
    G3.party = [key]; G3.owned = [key]; G3.heroes[key].lvl = 40;
    TF.skillsOf(G3, key); G3.heroes[key].sk = { [def.k]: 3 }; G3.heroes[key].eq = [def.k];
    G3.statsDirty = true; G3.stage = 8; G3.maxStage = 8; G3.hold = true;
    const B3 = TF.newBattle(G3); B3.preview = true;
    let saw = 0;
    for (let i = 0; i < 1500; i++) {
      TF.step(G3, B3, .1, 1e12 + i * 100);
      for (const h of B3.hs) if (!Number.isFinite(h.hp) || !Number.isFinite(h.x)) throw new Error(`${def.k} broke a hero`);
      for (const m of B3.mons) if (!Number.isFinite(m.hp) || !Number.isFinite(m.x)) throw new Error(`${def.k} broke a monster`);
      if (B3.hs[0].skI !== undefined && B3.hs[0].charge === 0 && B3.hs[0].q.length) saw++;
    }
    if (!saw) throw new Error(`${def.k} never fired`);
  }
}
console.log('\nRule checks passed.');
