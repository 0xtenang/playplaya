// End-to-end tests over real HTTP against a real SQLite file, with a controllable clock.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { runAudit } from '../server/audit.mjs';
import { T } from '../server/game.mjs';

const OPEN_RATES = { auth: [1e6, 1e6], guest: [1e6, 1e6], action: [1e6, 1e6], sync: [1e6, 1e6], read: [1e6, 1e6] };
const dir = mkdtempSync(join(tmpdir(), 'trayfarers-test-'));
let dbCount = 0;

function harness(options = {}) {
  const clock = { t: Date.UTC(2026, 10, 4, 12) };
  const app = createApp({ dbPath: join(dir, `t${dbCount++}.db`), now: () => clock.t, rates: OPEN_RATES, config: { PEER_MIN_AGE_MS: 0 }, ...options });
  let base;
  const client = () => {
    let cookie = '';
    const call = async (method, path, body, headers = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, data, headers: res.headers, text };
    };
    return {
      call,
      post: (p, b = {}) => call('POST', p, b),
      get: p => call('GET', p),
      guest: () => call('POST', '/api/guest', {}),
      register: (name, password = 'correct horse') => call('POST', '/api/register', { name, password }),
      sync: () => call('POST', '/api/sync', {}),
      act: (type, args = {}) => call('POST', '/api/action', { type, args }),
      get cookie() { return cookie; },
      set cookie(v) { cookie = v; },
    };
  };
  return {
    app, clock, client,
    start: async () => { base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`; return base; },
    stop: () => app.close(),
    audit: () => runAudit(app.store, clock.t),
    get base() { return base; },
  };
}
// A registered player who has salvaged the starter crate, so selling is open.
async function seller(h, name) {
  const c = h.client();
  assert.equal((await c.guest()).status, 200);
  assert.equal((await c.register(name)).status, 200);
  const r = await c.act('salvageUpTo', { g: 1 });
  assert.equal(r.status, 200);
  assert.ok(r.data.G.forge.lvl >= 3);
  return c;
}
const charmOf = G => G.items.find(i => i.g === 3);
const assertAuditClean = h => { const a = h.audit(); assert.deepEqual(a.violations, [], JSON.stringify(a.violations)); return a; };

describe('a trade between two real players', () => {
  const h = harness();
  before(() => h.start());
  after(() => h.stop());

  test('moves the item and Marks exactly, and pays the fees', async () => {
    const a = await seller(h, 'alice'), b = await seller(h, 'bobby');
    const stateA = (await a.sync()).data, charm = charmOf(stateA.G);
    const listed = await a.act('list', { itemId: charm.id, price: 40 });
    assert.equal(listed.status, 200);
    assert.equal(charmOf(listed.data.G), undefined, 'the item leaves the pack while it is listed');

    const market = (await b.get('/api/market')).data;
    const row = market.listings.find(l => l.id === listed.data.result.id);
    assert.equal(row.price, 40);
    assert.equal(row.crew, 'alice');
    assert.equal(row.item.s, 'charm');
    assert.equal(JSON.stringify(row).includes('seller'), false, 'the market does not expose account ids');

    const bBefore = (await b.sync()).data.G.marks;
    const bought = await b.act('buyPeer', { id: row.id, price: 40 });
    assert.equal(bought.status, 200, bought.text);
    assert.equal(bought.data.G.marks, bBefore - 40);
    const got = bought.data.G.items.find(i => i.id === charm.id);
    assert.ok(got, 'the buyer holds the same item id');
    assert.equal(got.r, charm.r, 'with the same stats roll');
    assert.ok(got.t > h.clock.t, 'under a resale lock');
    assert.equal(got.nd, 1, 'and marked as traded');

    const after = (await a.sync()).data;
    assert.equal(after.G.marks, 100 + 34, 'seller keeps 40 minus the 6 DND burned');
    assert.ok(after.events.some(e => e.t === 'sale' && e.net === 34));
    assert.equal(after.G.market.mine.length, 0);

    const audit = assertAuditClean(h);
    assert.equal(audit.stats.burnWaiting, 6, 'the whole fee is burned, and nobody collects any of it');
  });

  test('a traded item cannot be flipped during its resale lock', async () => {
    const c = await seller(h, 'carol'), d = await seller(h, 'dave1');
    const it = charmOf((await c.sync()).data.G);
    const { result } = (await c.act('list', { itemId: it.id, price: 10 })).data;
    assert.equal((await d.act('buyPeer', { id: result.id, price: 10 })).status, 200);
    const relist = await d.act('list', { itemId: it.id, price: 10 });
    assert.equal(relist.status, 409);
    assert.match(relist.data.error, /resale lock/);
  });

  test('a listing cannot be sold twice, even when requests race', async () => {
    const s = await seller(h, 'racer');
    const buyers = await Promise.all([1, 2, 3, 4, 5, 6].map(i => seller(h, `buyer${i}`)));
    const it = charmOf((await s.sync()).data.G);
    const { result } = (await s.act('list', { itemId: it.id, price: 10 })).data;
    const results = await Promise.all(buyers.map(b => b.act('buyPeer', { id: result.id, price: 10 })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409, 409, 409, 409, 409]);
    const holders = (await Promise.all(buyers.map(b => b.sync()))).filter(r => r.data.G.items.some(i => i.id === it.id));
    assert.equal(holders.length, 1);
    assertAuditClean(h);
  });

  test('a seller cannot cancel a sold listing or buy their own', async () => {
    const s = await seller(h, 'selfy'), b = await seller(h, 'other');
    const it = charmOf((await s.sync()).data.G);
    const { result } = (await s.act('list', { itemId: it.id, price: 10 })).data;
    assert.equal((await s.act('buyPeer', { id: result.id, price: 10 })).status, 409);
    assert.equal((await b.act('cancelList', { id: result.id })).status, 403, 'nor can anyone else cancel it');
    assert.equal((await b.act('buyPeer', { id: result.id, price: 10 })).status, 200);
    assert.equal((await s.act('cancelList', { id: result.id })).status, 409);
    assertAuditClean(h);
  });

  test('cancelling returns the same item and keeps the slot cooling', async () => {
    const s = await seller(h, 'canceler');
    const it = charmOf((await s.sync()).data.G);
    const { result, G } = (await s.act('list', { itemId: it.id, price: 10 })).data;
    assert.ok(G.market.slots.some(x => x > h.clock.t));
    const back = (await s.act('cancelList', { id: result.id })).data;
    assert.ok(back.G.items.some(i => i.id === it.id && i.r === it.r));
    assert.ok(back.G.market.slots.some(x => x > h.clock.t));
    assertAuditClean(h);
  });
});

describe('hero skills', () => {
  const h = harness();
  before(() => h.start());
  after(() => h.stop());
  const skillsOf = r => r.data.G.heroes.warden;

  test('a new hero starts with one free move and one point to spend', async () => {
    const c = h.client(); await c.guest();
    const { G } = (await c.sync()).data;
    assert.equal(T.skillPoints(G, 'warden').left, 1);
    assert.deepEqual(T.skillsOf(G, 'warden').eq, ['charge']);
  });
  test('points cannot be overspent, and the server is the one counting', async () => {
    const c = h.client(); await c.guest();
    const ok = await c.act('skillUp', { hero: 'warden', k: 'heavyArm' });
    assert.equal(ok.status, 200);
    assert.equal(skillsOf(ok).sk.heavyArm, 1);
    const atk = T.heroStats(ok.data.G, 'warden').atk;
    assert.ok(atk > 0);
    const over = await c.act('skillUp', { hero: 'warden', k: 'heavyArm' });
    assert.ok(over.status >= 400 && over.status < 500);
    assert.equal(skillsOf(await c.sync()).sk.heavyArm, 1);
  });
  test('locked tiers stay locked, and made-up skills are refused', async () => {
    const c = h.client(); await c.guest();
    const locked = await c.act('skillUp', { hero: 'warden', k: 'cleave' });
    assert.ok(locked.status >= 400 && locked.status < 500);
    for (const args of [{ hero: 'warden', k: 'nope' }, { hero: 'warden', k: 'volley' }, { hero: 'nobody', k: 'charge' }, { hero: 'warden', k: '__proto__' }]) {
      assert.equal((await c.act('skillUp', args)).status, 400, JSON.stringify(args));
    }
  });
  test('a hero always keeps an active skill, and can only equip what is learned', async () => {
    const c = h.client(); await c.guest();
    assert.ok((await c.act('skillEquip', { hero: 'warden', k: 'charge' })).status >= 400);
    assert.ok((await c.act('skillEquip', { hero: 'warden', k: 'cleave' })).status >= 400);
    assert.ok((await c.act('skillEquip', { hero: 'warden', k: 'heavyArm' })).status >= 400);
    assert.deepEqual(skillsOf(await c.sync()).eq, ['charge']);
  });
  test('a refund returns the points for free', async () => {
    const c = h.client(); await c.guest();
    await c.act('skillUp', { hero: 'warden', k: 'ironHide' });
    const r = await c.act('skillReset', { hero: 'warden' });
    assert.equal(r.status, 200);
    const G = r.data.G;
    assert.equal(T.skillPoints(G, 'warden').left, 1);
    assert.deepEqual(G.heroes.warden.sk, { charge: 1 });
    assertAuditClean(h);
  });
  test('spending all points stops exactly at the limit', async () => {
    const c = h.client(); await c.guest();
    const r = await c.act('skillAuto', { hero: 'warden' });
    assert.equal(r.status, 200);
    assert.equal(T.skillPoints(r.data.G, 'warden').left, 0);
  });
});

describe('market rules', () => {
  const h = harness();
  before(() => h.start());
  after(() => h.stop());

  test('guests and young accounts cannot trade with other crews', async () => {
    const strict = harness({ config: { PEER_MIN_AGE_MS: 3600e3 } });
    await strict.start();
    const s = await seller(strict, 'seller1'), young = await seller(strict, 'young1');
    const guest = strict.client(); await guest.guest();
    const it = charmOf((await s.sync()).data.G);
    strict.clock.t += 2 * 3600e3;
    const { result } = (await s.act('list', { itemId: it.id, price: 10 })).data;
    assert.equal((await s.get('/api/market')).status, 200);
    assert.equal((await guest.act('buyPeer', { id: result.id, price: 10 })).status, 403);
    const fresh = await seller(strict, 'fresh1');
    assert.equal((await fresh.act('buyPeer', { id: result.id, price: 10 })).status, 403);
    assert.equal((await young.act('buyPeer', { id: result.id, price: 10 })).status, 200, 'old enough now');
    await strict.stop();
  });

  test('a guest listing is hidden from other crews but can still sell to drifters', async () => {
    const g = h.client(); await g.guest();
    await g.act('salvageUpTo', { g: 1 });
    const it = charmOf((await g.sync()).data.G);
    const { result } = (await g.act('list', { itemId: it.id, price: 3 })).data;
    const other = await seller(h, 'watcher');
    assert.equal((await other.get('/api/market')).data.listings.some(l => l.id === result.id), false);
    assert.equal((await other.act('buyPeer', { id: result.id, price: 3 })).status, 409);
  });

  test('materials can only be listed up to what a player holds', async () => {
    const s = await seller(h, 'lister');
    assert.equal((await s.act('list', { mat: 'gem1', qty: 3, price: 3 })).status, 409);
    assert.equal((await s.act('list', { mat: 'gem1', qty: 2, price: 3 })).status, 200);
    assert.equal((await s.act('list', { mat: 'gem1', qty: 1, price: 3 })).status, 409);
    assertAuditClean(h);
  });

  test('the fifth listing is refused and slots reopen after the cooldown', async () => {
    const s = await seller(h, 'lister2');
    assert.equal((await s.act('buyDrifter', { key: 'mat.gem2', maxPrice: 1000 })).status, 200);
    const ids = [];
    for (const mat of ['seal', 'seal', 'gem1', 'gem1']) {
      const r = await s.act('list', { mat, qty: 1, price: 3 });
      assert.equal(r.status, 200, r.text);
      ids.push(r.data.result.id);
    }
    const fifth = await s.act('list', { mat: 'gem2', qty: 1, price: 3 });
    assert.equal(fifth.status, 409);
    assert.match(fifth.data.error, /slots/);
    h.clock.t += T.CFG.LIST_COOLDOWN;
    // A drifter may have bought this one during the wait. Either way its slot is free now.
    await s.act('cancelList', { id: ids[0] });
    assert.equal((await s.act('list', { mat: 'gem2', qty: 1, price: 3 })).status, 200);
    assertAuditClean(h);
  });

  test('drifter purchases charge the server price, and refuse a stale quote', async () => {
    const s = await seller(h, 'shopper');
    const key = 'helm.0.3', ask = T.driftAsk(key, h.clock.t, 0);
    const before = (await s.sync()).data.G.marks;
    assert.equal((await s.act('buyDrifter', { key, maxPrice: ask - 1 })).status, 409);
    const r = await s.act('buyDrifter', { key, maxPrice: ask });
    assert.equal(r.status, 200);
    assert.equal(r.data.G.marks, before - ask);
    assert.equal(r.data.result.item.nd, 1);
    assert.equal((await s.act('buyDrifter', { key, maxPrice: ask })).status, 409, 'one per hour');
    assertAuditClean(h);
  });

  test('drifters pay for found goods while the player is away, and never buy traded goods', async () => {
    const s = await seller(h, 'awayseller');
    const it = charmOf((await s.sync()).data.G);
    const ref = T.refPrice(T.marketKey(it), h.clock.t, 0);
    const { result } = (await s.act('list', { itemId: it.id, price: Math.floor(ref * .4) + 3 })).data;
    h.clock.t += 2 * 86400e3;
    const back = (await s.sync()).data;
    assert.equal(back.G.market.mine.some(r => r.id === result.id), false, 'it sold while they were away');
    assert.equal(back.G.ledger.sold, 1);
    assertAuditClean(h);

    const t = await seller(h, 'tradedgoods');
    const bought = (await t.act('buyDrifter', { key: 'boots.0.3', maxPrice: 1000 })).data.result.item;
    h.clock.t += T.CFG.RESALE_LOCK + 1;
    await t.sync();
    const l = await t.act('list', { itemId: bought.id, price: 3 });
    assert.equal(l.status, 200, l.text);
    h.clock.t += 40 * 86400e3;
    const later = (await t.sync()).data;
    assert.equal(later.G.market.mine.length, 1, 'still unsold after 40 days of drifter rolls');
    assertAuditClean(h);
  });
});

describe('time cannot be faked', () => {
  const h = harness();
  before(() => h.start());
  after(() => h.stop());

  test('spamming heartbeats gives no extra game time', async () => {
    const c = h.client(); await c.guest();
    const start = (await c.sync()).data;
    for (let i = 0; i < 300; i++) await c.sync();
    const later = (await c.sync()).data;
    assert.equal(later.simAt, start.simAt, 'no clock time passed, so nothing was simulated');
    assert.equal(later.G.stats.kills, start.G.stats.kills);
    assert.equal(later.G.chests.length, start.G.chests.length);
  });

  test('chests come at the timed rate no matter how often a client syncs', async () => {
    const c = h.client(); await c.guest();
    for (let i = 0; i < 180; i++) { h.clock.t += 10e3; await c.sync(); }
    const G = (await c.sync()).data.G;
    // 30 minutes online: the first chest at 20s, then one every 90s or so.
    const n = G.chests.length + G.stats.chests;
    assert.ok(n >= 6, `chests arrive: got ${n}`);
    assert.ok(n <= 6 + G.stats.boss, `the cart holds 6 and only bosses add more: got ${n}`);
  });

  test('being away pays capped XP, and no chests', async () => {
    const c = h.client(); await c.guest();
    const before = (await c.sync()).data;
    h.clock.t += 24 * 3600e3;
    const after = (await c.sync()).data;
    const ev = after.events.find(e => e.t === 'away');
    assert.ok(ev && ev.xp > 0);
    const chests = after.G.chests.length + after.G.stats.chests - before.G.chests.length - before.G.stats.chests;
    assert.ok(chests <= 1, `only the 90 second grace window can produce a chest: got ${chests}`);
    h.clock.t += 48 * 3600e3;
    const twice = (await c.sync()).data.events.find(e => e.t === 'away');
    assert.ok(twice.xp <= ev.xp * 1.5, 'the away cap holds however long they are gone');
  });
});

describe('the browser is told nothing it could exploit', () => {
  const h = harness();
  before(() => h.start());
  after(() => h.stop());

  test('snapshots carry no loot randomness', async () => {
    const c = h.client();
    const s = (await c.guest()).data;
    assert.equal('rng' in s.G, false);
    assert.equal('seed' in s.G, false);
    assert.equal('pendingEv' in s.G, false);
    assert.equal(c.cookie.includes('tf_sid='), true);
  });

  test('the same chest cannot be predicted from earlier rolls', () => {
    const g1 = T.newGame(1, 5), g2 = T.newGame(1, 5);
    const same = g1.items.every((it, i) => it.r === g2.items[i].r);
    assert.equal(same, false, 'one seed gives different rolls, so loot does not depend on a seed');
  });

  test('the client replays the server fight exactly between syncs', async () => {
    const c = h.client(); await c.guest();
    for (let i = 0; i < 12; i++) { h.clock.t += 10e3; await c.sync(); }
    let snap = (await c.sync()).data;
    for (let round = 0; round < 6; round++) {
      const G = snap.G, B = { ...snap.B, preview: true };
      for (let i = 0; i < 100; i++) T.step(G, B, .1, snap.simAt + (i + 1) * 100);
      // The server applies a level-up at the end of its window. A browser does it one tick later.
      if (G.statsDirty) T.syncParty(G, B);
      h.clock.t += 10e3;
      const next = (await c.sync()).data;
      const strip = b => JSON.stringify({ ...b, fx: 0, preview: 0 });
      assert.equal(strip(B), strip(next.B), `battle matches after round ${round}`);
      assert.equal(G.chestT, next.G.chestT);
      snap = next;
    }
  });
});

describe('hostile requests', () => {
  const h = harness();
  before(() => h.start());
  after(() => h.stop());

  test('a client cannot set its own wealth', async () => {
    const c = await seller(h, 'forger');
    const before = (await c.sync()).data.G;
    for (const type of ['setMarks', 'setCoin', 'addItem', '__proto__', 'constructor', 'hasOwnProperty', 'toString', '']) {
      assert.equal((await c.act(type, { marks: 1e9, coin: 1e9 })).status, 400, type);
    }
    const r = await c.call('POST', '/api/sync', { G: { marks: 1e9, coin: 1e9 } });
    assert.equal(r.data.G.marks, before.marks);
    assert.equal(r.data.G.items.length, before.items.length);
  });

  test('bad arguments are refused and change nothing', async () => {
    const c = await seller(h, 'fuzzer');
    const { G } = (await c.sync()).data;
    const it = G.items[0].id;
    const BAD = [
      ['list', { itemId: it, price: 2 }], ['list', { itemId: it, price: -5 }], ['list', { itemId: it, price: 3.5 }], ['list', { itemId: it, price: '100' }],
      ['list', { itemId: it, price: NaN }], ['list', { itemId: it, price: 1e30 }], ['list', { itemId: it }], ['list', { price: 5 }],
      ['list', { itemId: it, mat: 'seal', qty: 1, price: 5 }], ['list', { mat: 'seal', qty: 0, price: 5 }], ['list', { mat: 'seal', qty: -1, price: 5 }],
      ['list', { mat: 'seal', qty: 1.5, price: 5 }], ['list', { mat: '__proto__', qty: 1, price: 5 }], ['list', { mat: 'constructor', qty: 1, price: 5 }],
      ['list', { itemId: { $ne: 1 }, price: 5 }], ['list', { itemId: '../../etc', price: 5 }], ['list', { itemId: "' OR 1=1 --", price: 5 }],
      ['equip', { hero: '__proto__', id: it }], ['equip', { hero: 'warden', id: null }], ['unequip', { hero: 'warden', slot: '__proto__' }],
      ['toggleHero', { hero: 'constructor' }], ['talent', { k: '__proto__' }], ['talent', { k: 'none' }],
      ['fuse', { g: -1 }], ['fuse', { g: 99 }], ['fuse', { g: 0.5 }], ['fuse', { g: '0' }], ['fuse', { g: 0, slot: 'ring' }],
      ['etch', { id: it, t: 9, s: 0 }], ['etch', { id: it, t: 0, s: -1 }], ['salvageUpTo', { g: 100 }], ['jumpStage', { i: 1.5 }], ['jumpStage', { i: 1000 }], ['jumpStage', { i: '0' }],
      ['hold', { on: 'yes' }], ['setCrew', { name: '<img src=x onerror=alert(1)>' }], ['setCrew', { name: '' }], ['setCrew', { name: 'x'.repeat(50) }], ['setCrew', { name: 42 }],
      ['buyDrifter', { key: 'nope', maxPrice: 5 }], ['buyDrifter', { key: 'mat.__proto__', maxPrice: 5 }], ['buyDrifter', { key: 'charm.99.1', maxPrice: 5 }], ['buyDrifter', { key: 'charm.1.1', maxPrice: -5 }],
      ['buyPeer', { id: 'missing', price: 0 }], ['cancelList', { id: 5 }], ['salvage', { id: [] }],
    ];
    for (const [type, args] of BAD) {
      const r = await c.act(type, args);
      assert.equal(r.status, 400, `${type} ${JSON.stringify(args)} gave ${r.status}: ${r.text}`);
    }
    for (const args of [null, [], 'x', 5]) {
      const r = await c.call('POST', '/api/action', { type: 'openChest', args });
      assert.ok(args === null ? r.status !== 500 : r.status === 400, `args ${JSON.stringify(args)} gave ${r.status}`);
    }
    const after = (await c.sync()).data.G;
    assert.equal(after.marks, G.marks);
    assert.equal(after.market.mine.length, 0);
    assertAuditClean(h);
  });

  test('another player\'s items are out of reach', async () => {
    const a = await seller(h, 'victim1'), b = await seller(h, 'thief1');
    const it = (await a.sync()).data.G.items[0].id;
    for (const [type, args, status] of [['salvage', { id: it }, 409], ['equip', { hero: 'warden', id: it }, 409], ['list', { itemId: it, price: 3 }, 409], ['lock', { id: it }, 409], ['etch', { id: it, t: 0, s: 0 }, 409], ['strip', { id: it }, 409]]) {
      assert.equal((await b.act(type, args)).status, status, type);
    }
    assert.ok((await a.sync()).data.G.items.some(i => i.id === it));
  });

  test('gear in use and locked gear stay safe, and stages must be earned', async () => {
    const c = await seller(h, 'careful');
    const { G } = (await c.sync()).data;
    const worn = G.heroes.warden.gear.weapon;
    assert.equal((await c.act('salvage', { id: worn })).status, 409);
    assert.equal((await c.act('list', { itemId: worn, price: 5 })).status, 409);
    const it = charmOf(G);
    await c.act('lock', { id: it.id });
    assert.equal((await c.act('salvage', { id: it.id })).status, 409);
    assert.equal((await c.act('list', { itemId: it.id, price: 5 })).status, 409);
    assert.equal((await c.act('jumpStage', { i: 80 })).status, 409, 'cannot skip ahead');
    assert.equal((await c.act('fuse', { g: 0, slot: 'charm' })).status, 409, 'slot choice is gated by forge level');
  });

  test('no session, a forged cookie and cross-site requests are refused', async () => {
    const anon = h.client();
    assert.equal((await anon.sync()).status, 401);
    assert.equal((await anon.act('openChest')).status, 401);
    assert.equal((await anon.get('/api/market')).status, 401);
    anon.cookie = 'tf_sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    assert.equal((await anon.sync()).status, 401);

    const c = h.client(); await c.guest();
    assert.equal((await c.call('POST', '/api/action', { type: 'openChest', args: {} }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await c.call('POST', '/api/action', { type: 'openChest', args: {} }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await c.call('POST', '/api/action', '{"type":"openChest"}', { 'Content-Type': 'text/plain' })).status, 415, 'plain form posts are blocked');
    assert.equal((await c.call('POST', '/api/action', 'not json')).status, 400);
    assert.equal((await c.call('POST', '/api/action', 'x'.repeat(40000))).status, 413);
  });

  test('session cookies are locked down and passwords are hashed', async () => {
    const c = h.client();
    const r = await c.guest();
    assert.match(r.headers.get('set-cookie'), /HttpOnly/);
    assert.match(r.headers.get('set-cookie'), /SameSite=Lax/);
    await c.register('hashcheck', 'correct horse battery');
    const row = h.app.store.getAccountByName('hashcheck');
    assert.match(row.pass, /^s1\$/);
    assert.equal(row.pass.includes('correct'), false);
    const token = c.cookie.split('=')[1];
    assert.equal(h.app.store.q('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(token).n, 0, 'tokens are stored hashed');
  });

  test('a page visit can check for a session without an error', async () => {
    const anon = h.client();
    assert.deepEqual((await anon.get('/api/session')).data, { active: false, banned: null, walletRequired: false });
    await anon.guest();
    assert.equal((await anon.get('/api/session')).data.active, true);
  });

  test('responses carry security headers and unknown paths give nothing away', async () => {
    const r = await h.client().get('/healthz');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    for (const p of ['/../server/app.mjs', '/.env', '/trayfarers.db', '/%2e%2e/package.json', '/public/index.html', '/server/game.mjs']) {
      assert.equal((await h.client().get(p)).status, 404, p);
    }
  });

  test('sprite sheets are served as long-lived files, and only the ones that were built', async (ctx) => {
    const c = h.client(), m = await c.get('/atlas/manifest.json');
    if (m.status === 404) return ctx.skip('run the build first');
    assert.equal(m.status, 200);
    assert.ok(m.data.groups.heroes && m.data.groups.r4);
    const png = await c.get('/atlas/' + m.data.groups.heroes.files.main.file);
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.match(png.headers.get('cache-control'), /immutable/);
    for (const p of ['/atlas/.hash', '/atlas/../server/app.mjs', '/atlas/%2e%2e/%2e%2e/package.json', '/atlas/nope.png']) assert.equal((await c.get(p)).status, 404, p);
  });

  test('random garbage never produces a server error', async () => {
    const c = await seller(h, 'chaos');
    const values = [null, true, false, 0, -1, 1.5, 1e308, '', 'x', '__proto__', 'constructor', [], {}, [1], { a: 1 }];
    const keys = ['id', 'itemId', 'g', 't', 's', 'k', 'hero', 'slot', 'mat', 'qty', 'price', 'key', 'maxPrice', 'i', 'on', 'hold', 'name'];
    let seed = 42;
    const pick = a => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return a[seed % a.length]; };
    const types = h.app.game.intents;
    for (let i = 0; i < 1500; i++) {
      const args = {};
      for (let k = 0; k < 4; k++) args[pick(keys)] = pick(values);
      const r = await c.act(pick(types), args);
      assert.notEqual(r.status, 500, `${r.text} for ${JSON.stringify(args)}`);
      assert.ok(r.status >= 200 && r.status < 500);
      if (i % 200 === 0) h.clock.t += 20e3;
    }
    assertAuditClean(h);
  });
});

describe('accounts', () => {
  const h = harness();
  before(() => h.start());
  after(() => h.stop());

  test('claiming keeps a guest\'s crew, and logging in works anywhere', async () => {
    const c = h.client(); await c.guest();
    const before = (await c.act('salvageUpTo', { g: 0 })).data;
    assert.equal(before.account.guest, true);
    const claimed = await c.register('keeper', 'correct horse');
    assert.equal(claimed.status, 200);
    assert.equal(claimed.data.account.guest, false);
    assert.equal(claimed.data.G.forge.xp, before.G.forge.xp);
    assert.equal(claimed.data.G.crew, 'keeper');

    const other = h.client();
    assert.equal((await other.post('/api/login', { name: 'keeper', password: 'wrong password' })).status, 401);
    const login = await other.post('/api/login', { name: 'KEEPER', password: 'correct horse' });
    assert.equal(login.status, 200, 'names are case-insensitive');
    assert.equal(login.data.G.forge.xp, before.G.forge.xp);
  });

  test('names are unique and rules are enforced', async () => {
    const a = h.client(); await a.register('uniquename', 'correct horse');
    const b = h.client();
    assert.equal((await b.register('UNIQUENAME', 'correct horse')).status, 409);
    assert.equal((await b.register('ab', 'correct horse')).status, 400);
    assert.equal((await b.register('has space', 'correct horse')).status, 400);
    assert.equal((await b.register('<script>', 'correct horse')).status, 400);
    assert.equal((await b.register('okname', 'short')).status, 400);
    assert.equal((await a.register('secondname', 'correct horse')).status, 409, 'a claimed account cannot claim again');
  });

  test('two simultaneous claims of one name leave one winner', async () => {
    const clients = [h.client(), h.client(), h.client(), h.client()];
    const out = await Promise.all(clients.map(c => c.register('contested', 'correct horse')));
    assert.equal(out.filter(r => r.status === 200).length, 1);
    assert.equal(out.filter(r => r.status === 500).length, 0, out.map(r => r.text).join());
  });

  test('logging out ends the session', async () => {
    const c = h.client(); await c.register('leaver', 'correct horse');
    const token = c.cookie;
    assert.equal((await c.post('/api/logout')).status, 200);
    const replay = h.client(); replay.cookie = token;
    assert.equal((await replay.sync()).status, 401, 'the old cookie no longer works');
  });

  test('banning closes sessions, returns listings and hides the player', async () => {
    const s = await seller(h, 'cheater'), b = await seller(h, 'honest');
    const it = charmOf((await s.sync()).data.G);
    const { result } = (await s.act('list', { itemId: it.id, price: 5 })).data;
    h.app.game.ban(h.app.store.getAccountByName('cheater').id, 'Testing.');
    assert.equal((await s.sync()).status, 401, 'session removed');
    assert.equal((await s.post('/api/login', { name: 'cheater', password: 'correct horse' })).status, 403);
    assert.equal((await b.act('buyPeer', { id: result.id, price: 5 })).status, 409);
    assert.equal((await b.get('/api/board')).data.board.some(r => r.crew === 'cheater'), false);
    assertAuditClean(h);
  });
});

describe('rate limits', () => {
  test('auth, guests and actions are throttled', async () => {
    const h = harness({ rates: { auth: [3, .001], guest: [2, .001], action: [3, .001], sync: [2, .001], read: [2, .001] } });
    await h.start();
    const c = h.client();
    assert.equal((await c.guest()).status, 200);
    assert.equal((await h.client().guest()).status, 200);
    assert.equal((await h.client().guest()).status, 429, 'guest creation per address');
    for (let i = 0; i < 3; i++) assert.equal((await h.client().post('/api/login', { name: 'nobody', password: 'password1' })).status, 401);
    assert.equal((await h.client().post('/api/login', { name: 'nobody', password: 'password1' })).status, 429, 'login guessing');
    for (let i = 0; i < 3; i++) await c.act('hold', { on: true });
    assert.equal((await c.act('hold', { on: true })).status, 429, 'actions per account');
    await h.stop();
  });
});

describe('proxy headers', () => {
  test('a client cannot dodge the login limit by faking its address', async () => {
    const h = harness({ trustProxy: 'xff', rates: { ...OPEN_RATES, auth: [2, .001] } });
    await h.start();
    const tryLogin = fake => h.client().call('POST', '/api/login', { name: 'nobody', password: 'password1' }, { 'X-Forwarded-For': `${fake}, 203.0.113.9` });
    assert.equal((await tryLogin('1.1.1.1')).status, 401);
    assert.equal((await tryLogin('2.2.2.2')).status, 401);
    assert.equal((await tryLogin('3.3.3.3')).status, 429, 'the address the proxy added is what counts');
    await h.stop();
  });
  test('proxy headers are ignored unless the server is told to trust them', async () => {
    const h = harness({ rates: { ...OPEN_RATES, auth: [1, .001] } });
    await h.start();
    const tryLogin = fake => h.client().call('POST', '/api/login', { name: 'nobody', password: 'password1' }, { 'X-Forwarded-For': fake, 'Fly-Client-IP': fake });
    assert.equal((await tryLogin('1.1.1.1')).status, 401);
    assert.equal((await tryLogin('2.2.2.2')).status, 429);
    await h.stop();
  });
});

describe('the audit catches what it should', () => {
  const h = harness();
  before(() => h.start());
  after(() => h.stop());
  const edit = (name, fn) => {
    const id = h.app.store.getAccountByName(name).id;
    const row = h.app.store.getPlayer(id), G = JSON.parse(row.g);
    fn(G);
    h.app.store.q('UPDATE players SET g = ? WHERE account_id = ?').run(JSON.stringify(G), id);
    return id;
  };
  const kinds = () => h.audit().violations.map(v => v.kind);

  test('clean after normal play', async () => {
    const a = await seller(h, 'auditone'), b = await seller(h, 'audittwo');
    const it = charmOf((await a.sync()).data.G);
    const { result } = (await a.act('list', { itemId: it.id, price: 10 })).data;
    await b.act('buyPeer', { id: result.id, price: 10 });
    assertAuditClean(h);
  });
  test('Marks edited directly in the database', () => {
    edit('auditone', G => { G.marks += 1000; });
    assert.ok(kinds().includes('marks_mismatch'));
    edit('auditone', G => { G.marks -= 1000; });
  });
  test('a duplicated item', () => {
    let copy;
    edit('audittwo', G => { copy = G.items.find(i => i.g >= 3); });
    edit('auditone', G => { G.items.push(copy); });
    assert.ok(kinds().includes('duplicate_item'));
    edit('auditone', G => { G.items = G.items.filter(i => i.id !== copy.id); });
  });
  test('a valuable item with no recorded origin', () => {
    edit('auditone', G => { G.items.push({ id: 'forged-item', s: 'charm', l: 90, g: 7, r: 1, e: [], k: 0, t: 0 }); });
    assert.ok(kinds().includes('item_without_origin'));
    edit('auditone', G => { G.items = G.items.filter(i => i.id !== 'forged-item'); });
  });
  test('an unbalanced ledger row', () => {
    const r = h.app.store.ledgerRow(h.clock.t, 'system:mint', 5, 'tamper', null);
    assert.ok(kinds().includes('ledger_unbalanced'));
    h.app.store.q('DELETE FROM ledger WHERE id = ?').run(r.lastInsertRowid);
  });
  test('wash trading is flagged for review', async () => {
    const a = await seller(h, 'washerone'), b = await seller(h, 'washertwo');
    for (let i = 0; i < 5; i++) {
      const buy = await a.act('buyDrifter', { key: 'mat.gem1', maxPrice: 1000 });
      assert.equal(buy.status, 200, buy.text);
      const { result } = (await a.act('list', { mat: 'gem1', qty: 1, price: 3 })).data;
      assert.equal((await b.act('buyPeer', { id: result.id, price: 3 })).status, 200);
      h.clock.t += T.CFG.LIST_COOLDOWN + T.HOUR;
    }
    assert.ok(h.audit().flags.some(f => f.kind === 'repeat_pair'));
    assertAuditClean(h);
  });
  test('the economy stays balanced through a long session of mixed play', async () => {
    const players = await Promise.all(['mixone', 'mixtwo', 'mixthree'].map(n => seller(h, n)));
    for (let i = 0; i < 400; i++) {
      h.clock.t += 15e3;
      const p = players[i % 3];
      const { G } = (await p.sync()).data;
      if (G.chests.length) await p.act('openChest');
      if (i % 7 === 0) await p.act('equipBest', { hero: G.party[0] });
      if (i % 11 === 0) await p.act('salvageUpTo', { g: 0 });
      if (i % 13 === 0) await p.act('fuse', { g: 0 });
      if (i % 17 === 0) await p.act('talent', { k: 'slot' });
      if (i % 19 === 0) {
        const it = G.items.find(x => x.g >= 2 && !T.equippedBy(G, x.id));
        if (it) await p.act('list', { itemId: it.id, price: 5 + i % 40 });
      }
      if (i % 23 === 0) {
        const m = (await p.get('/api/market')).data.listings[0];
        if (m) await p.act('buyPeer', { id: m.id, price: m.price });
      }
    }
    const a = assertAuditClean(h);
    assert.ok(a.stats.items > 0);
  });
});

describe('heroes', () => {
  const h = harness();
  before(() => h.start());
  after(() => h.stop());
  // Adds test DND the way the game would, through both sides of the ledger, so the audit stays true.
  const fund = (id, whole) => {
    const row = h.app.store.getPlayer(id), G = JSON.parse(row.g);
    G.marks += whole;
    h.app.store.savePlayer(id, JSON.stringify(G), row.b, row.sim_at, row.seen_at, row.stage, row.crew);
    h.app.store.ledgerRow(h.clock.t, 'system:mint', -whole, 'signup', null);
    h.app.store.ledgerRow(h.clock.t, id, whole, 'signup', null);
  };
  const newest = () => h.app.store.q('SELECT id FROM accounts ORDER BY rowid DESC LIMIT 1').get().id;

  test('a new crew has only the Kitten Knight', async () => {
    const c = h.client();
    const { G } = (await c.guest()).data;
    assert.deepEqual(G.owned, ['warden']);
    assert.deepEqual(G.party, ['warden']);
  });
  test('locked heroes cannot be deployed, geared or trained', async () => {
    const c = h.client(), { G } = (await c.guest()).data, it = G.items.find(i => !Object.values(G.heroes.warden.gear).includes(i.id));
    for (const [type, args] of [['toggleHero', { hero: 'fletcher' }], ['equip', { hero: 'hexer', id: it.id }], ['equipBest', { hero: 'mender' }], ['skillAuto', { hero: 'fletcher' }]]) {
      const r = await c.act(type, args);
      assert.equal(r.status, 409, type);
      assert.match(r.data.error, /Buy /);
    }
    assert.deepEqual((await c.sync()).data.G.party, ['warden']);
  });
  test('buying a hero burns the exact price, and nobody can buy short or twice', async () => {
    const c = h.client(), T = (await import('../server/game.mjs')).T, price = T.CFG.HERO_PRICE;
    assert.equal(price, 500000);
    const start = (await c.guest()).data.G.marks, id = newest();
    const short = await c.act('buyHero', { hero: 'fletcher', price });
    assert.equal(short.status, 409);
    assert.match(short.data.error, /500,000 DND/);
    fund(id, price - start - 1);
    assert.equal((await c.act('buyHero', { hero: 'fletcher', price })).status, 409);
    assert.equal((await c.sync()).data.G.marks, price - 1);
    fund(id, 1);
    const burning = h.app.store.ledgerBalance('system:burn');
    const r = await c.act('buyHero', { hero: 'fletcher', price });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.data.G.marks, 0);
    assert.deepEqual(r.data.G.owned, ['warden', 'fletcher']);
    assert.deepEqual(r.data.G.party, ['warden', 'fletcher']);
    assert.equal(h.app.store.ledgerBalance('system:burn'), burning + price);
    assert.equal(h.app.store.ledgerBalance(id), 0);
    fund(id, price);
    assert.equal((await c.act('buyHero', { hero: 'fletcher', price })).status, 409);
    assert.equal((await c.sync()).data.G.marks, price);
    assert.equal((await c.act('buyHero', { hero: 'warden', price })).status, 409);
    assert.equal((await c.act('buyHero', { hero: 'nobody', price })).status, 400);
    assert.equal((await c.act('buyHero', { hero: 'hexer' })).status, 400, 'a purchase must state the price the player saw');
    assert.equal((await c.act('equipBest', { hero: 'fletcher' })).status, 200, 'a bought hero can be geared');
    assertAuditClean(h);
  });
  test('an operator can change the price at once, and nobody pays a price they did not see', async () => {
    const c = h.client(), start = (await c.guest()).data.G.marks, id = newest();
    assert.equal((await c.sync()).data.heroPrice, 500000);
    fund(id, 600000 - start);
    h.app.store.setMeta('hero_price', '250000');
    const stale = await c.act('buyHero', { hero: 'mender', price: 500000 });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, 'price_moved');
    assert.match(stale.data.error, /250,000 DND/);
    assert.equal((await c.sync()).data.G.marks, 600000, 'a refused purchase costs nothing');
    h.clock.t += 31e3;
    assert.equal((await c.sync()).data.heroPrice, 250000, 'screens catch up within 30 seconds');
    const burning = h.app.store.ledgerBalance('system:burn');
    const r = await c.act('buyHero', { hero: 'mender', price: 250000 });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.data.G.marks, 350000);
    assert.equal(h.app.store.ledgerBalance('system:burn'), burning + 250000);
    h.app.store.deleteMeta('hero_price');
    h.clock.t += 31e3;
    assert.equal((await c.sync()).data.heroPrice, 500000, 'clearing the setting returns to the default');
    assertAuditClean(h);
  });
  test('a crew saved before heroes were sold moves over when it next loads', async () => {
    const c = h.client(), id = (await c.guest(), newest()), row = h.app.store.getPlayer(id), G = JSON.parse(row.g);
    delete G.owned; G.party = ['warden', 'hexer']; G.talents.slot = 1;
    h.app.store.savePlayer(id, JSON.stringify(G), row.b, row.sim_at, row.seen_at, row.stage, row.crew);
    const after = (await c.sync()).data.G;
    assert.deepEqual(after.owned, ['warden']);
    assert.deepEqual(after.party, ['warden']);
    assert.equal(after.talents.slot, undefined);
    assertAuditClean(h);
  });
  test('a crew saved with coin loses it and the runes that only touched it, and keeps its other runes', async () => {
    const c = h.client(), id = (await c.guest(), newest()), row = h.app.store.getPlayer(id), G = JSON.parse(row.g);
    Object.assign(G, { coin: 5000 });
    Object.assign(G.talents, { might: 4, coin: 3, salvage: 2 });
    Object.assign(G.ledger, { coinKills: 90, coinSalvage: 9, coinAway: 9, coinTalents: 9, coinForge: 9 });
    const marks = G.marks;
    h.app.store.savePlayer(id, JSON.stringify(G), row.b, row.sim_at, row.seen_at, row.stage, row.crew);
    const after = (await c.sync()).data.G;
    assert.equal('coin' in after, false);
    assert.deepEqual(after.talents, { might: 4 });
    assert.equal(Object.keys(after.ledger).some(k => k.startsWith('coin')), false);
    assert.equal(after.marks, marks);
    assertAuditClean(h);
  });
  test('a rune is paid for in DND, which burns, and its price can be lowered', async () => {
    const c = h.client(); await c.guest();
    assert.equal((await c.act('talent', { k: 'might' })).status, 409, 'a new crew cannot afford one');
    h.app.store.setMeta('rune_scale', '0.1');
    const before = (await c.sync()).data.G, r = await c.act('talent', { k: 'might' });
    h.app.store.deleteMeta('rune_scale');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.G.talents.might, 1);
    assert.equal(r.data.G.marks, before.marks - r.data.result.price);
    assert.equal(r.data.G.ledger.burned, r.data.result.price);
    assertAuditClean(h);
  });
});

describe('starting with a wallet', () => {
  const h = harness({ requireWallet: true });
  before(() => h.start());
  after(() => h.stop());
  test('the first visit is told a wallet is needed', async () => {
    assert.equal((await h.client().get('/api/session')).data.walletRequired, true);
  });
  test('no crew can start without one', async () => {
    const c = h.client();
    for (const r of [await c.guest(), await c.register('no_wallet_crew')]) {
      assert.equal(r.status, 403);
      assert.equal(r.data.code, 'wallet_required');
    }
    assert.equal(h.app.store.q('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
  });
});

after(() => rmSync(dir, { recursive: true, force: true }));
