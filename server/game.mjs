// The authoritative game. Players send intents and receive snapshots. Coin, Marks,
// items and loot rolls only ever change here, inside a database transaction.
import { createRequire } from 'node:module';
import { DESK_DEFAULTS, createDesk, createWallets } from './desk.mjs';
import { rpcClient, topic, topicAddress } from './chain.mjs';
import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
require('../src/engine.js');
export const T = globalThis.TF;

export const DEFAULTS = {
  ...DESK_DEFAULTS,
  CHAIN: null,                 // null runs on test DND. Live mode is set by the DND_* settings.
  HERO_BURN: null,             // set, heroes are bought by burning real DND straight from the player's wallet
  ONLINE_GRACE_MS: 90e3,      // the game counts as open this long after the last heartbeat
  MAX_TICKS_PER_CALL: 1200,   // one call never simulates more than 2 minutes
  PEER_MIN_AGE_MS: 3600e3,    // a claimed account must be this old to trade with other crews
  EVENT_CAP: 40,
  MARKET_ROWS: 200,
  BOARD_ROWS: 20,
  WORTH_INTERVAL_MS: 60e3,
};

export class GameError extends Error {
  constructor(message, status = 409, code = 'rejected') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = () => new GameError('That request is not valid.', 400, 'bad_request');

// Loot and ids become unpredictable once this module loads. Rolls are never seeded here.
T.setRandom(() => randomInt(0, 2 ** 32) / 2 ** 32);
T.setIdSource(() => randomBytes(9).toString('base64url'));

// Argument checks. Everything arriving from a browser goes through these first.
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isId = v => typeof v === 'string' && /^[\w-]{1,40}$/.test(v);
const isHero = v => T.HERO_KEYS.includes(v);
const isSlot = v => T.SLOTS.includes(v);
const CREW_RE = /^[\p{L}\p{N}][\p{L}\p{N} _'.-]{0,19}$/u;
const MAX_PRICE = 1e9;

export function createGame({ store, now, config, build }) {
  const cfg = { ...DEFAULTS, ...config };
  // A test economy starts crews with free DND and lets drifters pay from nothing. A live one
  // does neither: every DND in it came through the vault.
  const live = !!cfg.CHAIN;
  const secret = store.secret();
  const roll = (id, bucket) => createHmac('sha256', secret).update(`${id}:${bucket}`).digest().readUInt32LE(0) / 2 ** 32;
  const worthAt = new Map();

  let counts = new Map(), countsAt = -Infinity;
  function peerCounts(t) {
    if (t - countsAt > 5000) {
      counts = new Map(store.openCounts().map(r => [r.key, r.n]));
      countsAt = t;
    }
    return counts;
  }
  const dropCounts = () => { countsAt = -Infinity; };

  // The hero price lives in the database, so `admin.mjs hero-price` changes it with no redeploy.
  // Screens may show a price up to 30 seconds old, but a purchase always checks the current one.
  let priceAt = -Infinity, priceSeen = 0;
  function heroPrice(t, fresh = false) {
    if (fresh || t - priceAt > 30e3) { priceSeen = Number(store.getMeta('hero_price')) || T.CFG.HERO_PRICE; priceAt = t; }
    return priceSeen;
  }

  // ------------------------------------------------------------ double-entry Marks
  // Every movement writes two rows that sum to zero, so a missing or invented Mark
  // shows up in the audit. The rewards vault, the burn queue and the chain hold accounts too.
  function transfer(from, to, amount, reason, ref, t) {
    if (!Number.isInteger(amount) || amount < 0) throw new Error('bad transfer amount');
    if (amount === 0) return;
    store.ledgerRow(t, from, -amount, reason, ref);
    store.ledgerRow(t, to, amount, reason, ref);
  }

  // ------------------------------------------------------------ player state
  function createPlayer(accountId, t) {
    const G = T.newGame(t, randomInt(0, 2 ** 31));
    const B = T.newBattle(G);
    B.rng = randomInt(0, 2 ** 31);
    for (const it of G.items) if (it.g >= 3) store.logItem(it.id, t, 'starter', accountId);
    if (live) G.marks = 0;
    else transfer('system:mint', accountId, G.marks, 'signup', null, t);
    store.insertPlayer(accountId, JSON.stringify(G), JSON.stringify(B), t, t, G.crew);
  }
  function load(accountId) {
    const row = store.getPlayer(accountId);
    if (!row) throw new GameError('Your crew could not be found.', 404, 'no_player');
    const G = JSON.parse(row.g);
    T.migrateOwned(G);
    G.mintLog = [];
    let B = JSON.parse(row.b);
    if (B.v !== T.BATTLE_V) { B = T.newBattle(G); B.rng = randomInt(0, 2 ** 31); }
    return { id: accountId, G, B, simAt: row.sim_at, seenAt: row.seen_at };
  }
  function save(P, t) {
    for (const id of P.G.mintLog || []) store.logItem(id, t, 'mint', P.id);
    delete P.G.mintLog;
    P.B.fx = [];
    store.savePlayer(P.id, JSON.stringify(P.G), JSON.stringify(P.B), P.simAt, P.seenAt, P.G.maxStage + 1, P.G.crew);
    const last = worthAt.get(P.id) ?? -Infinity;
    if (t - last >= cfg.WORTH_INTERVAL_MS) {
      worthAt.set(P.id, t);
      store.setWorth(P.id, T.netWorth(P.G, t));
    }
  }
  function pushEvent(G, e) {
    (G.pendingEv ||= []).push(e);
    if (G.pendingEv.length > cfg.EVENT_CAP) G.pendingEv.shift();
  }

  // Brings a player up to date. Time inside the online window plays the real game.
  // Anything beyond it is away time, which pays coin and XP only.
  function catchUp(P, t) {
    const { G, B } = P;
    const windowEnd = Math.min(t, P.seenAt + cfg.ONLINE_GRACE_MS);
    const ticks = Math.min(cfg.MAX_TICKS_PER_CALL, Math.floor((windowEnd - P.simAt) / 100));
    for (let i = 0; i < ticks; i++) {
      P.simAt += 100;
      for (const e of T.step(G, B, .1, P.simAt)) {
        if (e.t === 'loot') pushEvent(G, e);
        if (e.t === 'opened') { noteFinds(G, e.r, P.simAt); pushEvent(G, e); }
      }
    }
    if (t > P.seenAt + cfg.ONLINE_GRACE_MS) {
      G.lastSeen = P.simAt;
      const away = T.applyAway(G, t);
      if (away) pushEvent(G, { t: 'away', coin: away.coin, xp: away.xp });
      P.simAt = t;
    }
    G.lastSeen = t;
    settleDrifters(P, t);
    if (G.statsDirty) T.syncParty(G, B);
  }
  function settleDrifters(P, t) {
    const pc = peerCounts(t);
    const due = T.dueDrifterSales(P.G, t, k => pc.get(k) || 0, roll);
    let budget = due.length ? desk.drifterAllowance(P.id, t) : 0;
    for (const rec of due) {
      const row = store.getListing(rec.id);
      if (!row || row.status !== 'open') continue;
      if (rec.price > budget) continue; // stays listed until the purse or the day allows it
      budget -= rec.price;
      const f = T.settleSale(P.G, rec, 'A drifter', t);
      transfer('system:drifters', P.id, f.net, 'drifter_sale', rec.id, t);
      transfer('system:drifters', 'system:burn', f.burn, 'sale_burn', rec.id, t);
      store.closeListing(rec.id, 'sold', 'drifter', t);
      store.insertTrade({ listing: rec.id, seller: P.id, buyer: 'drifter', key: rec.key, price: rec.price, house: f.burn, founder: 0, net: f.net, at: t });
      if (rec.item) store.logItem(rec.item.id, t, 'sold_to_drifter', P.id, String(rec.price));
      pushEvent(P.G, { t: 'sale', price: rec.price, net: f.net, buyer: 'A drifter' });
      dropCounts();
    }
  }

  function noteFinds(G, r, t) {
    for (const l of r.loot) {
      if (l.item && l.item.g >= 4) T.mail(G, t, `Found a ${T.GRADES[l.item.g].n} ${T.itemName(l.item)} in a chest.`, 'find');
    }
  }
  function accountView(acct, t) {
    const opensAt = acct.created_at + cfg.PEER_MIN_AGE_MS;
    const wallets = Object.fromEntries(store.walletsOf(acct.id).map(w => [w.kind, { address: w.address, linkedAt: w.linked_at }]));
    return { name: acct.name, guest: !!acct.guest, peerEligible: peerEligible(acct, t), peerOpensAt: opensAt, wallets, live };
  }
  const peerEligible = (acct, t) => !acct.guest && t - acct.created_at >= cfg.PEER_MIN_AGE_MS;

  // What the browser receives. The loot stream and queued events stay out of the state copy.
  function view(P, acct, t) {
    const { rng, seed, pendingEv, mintLog, justForged, ...G } = P.G;
    const events = pendingEv || [];
    if (justForged) events.push({ t: 'forge', lvl: justForged });
    delete P.G.justForged;
    P.G.pendingEv = [];
    return { now: t, simAt: P.simAt, build, G, B: { ...P.B, fx: [] }, events, account: accountView(acct, t), heroPrice: heroPrice(t), heroBurn: cfg.HERO_BURN ? { chainId: cfg.HERO_BURN.chainId } : null };
  }

  // ------------------------------------------------------------ intents
  const need = r => { if (r && r.err) throw new GameError(r.err); return r; };
  const INTENTS = {
    openChest: {
      check: () => true,
      run(P, a, t) {
        const r = T.openChest(P.G, t);
        if (!r) throw new GameError('There is no chest to open.');
        noteFinds(P.G, r, t);
        return { r };
      },
    },
    salvage: {
      check: a => isId(a.id),
      run(P, a) {
        const coin = T.salvage(P.G, a.id);
        if (!coin) throw new GameError('That item cannot be salvaged.');
        return { coin };
      },
    },
    salvageUpTo: { check: a => isInt(a.g, 0, T.GRADES.length - 1), run: (P, a) => T.salvageUpTo(P.G, a.g) },
    fuse: {
      check: a => isInt(a.g, 0, T.FUSE.length - 1) && (a.slot === undefined || isSlot(a.slot)),
      run(P, a) {
        if (a.slot && P.G.forge.lvl < 4) throw new GameError('Choosing a result slot opens at Forge level 4.');
        return need(T.fuse(P.G, a.g, a.slot));
      },
    },
    etch: { check: a => isId(a.id) && isInt(a.t, 0, 2) && isInt(a.s, 0, 2), run: (P, a) => need(T.etch(P.G, a.id, a.t, a.s)) },
    strip: { check: a => isId(a.id), run: (P, a) => need(T.strip(P.G, a.id)) },
    talent: { check: a => T.TALENTS.some(x => x.k === a.k), run: (P, a) => need(T.buyTalent(P.G, a.k)) },
    withdraw: { check: a => isInt(a.whole, 1, MAX_PRICE), run: (P, a, t, acct) => desk.request(P, a.whole, t, acct) },
    toggleHero: { check: a => isHero(a.hero), run: (P, a) => need(T.toggleParty(P.G, a.hero)) },
    // The whole price burns, like every other DND spent in the game.
    buyHero: {
      check: a => isHero(a.hero) && isInt(a.price, 1, MAX_PRICE),
      run: (P, a, t) => {
        if (cfg.HERO_BURN) throw new GameError('Heroes are bought by burning DND from your wallet.', 409, 'burn_only');
        const price = heroPrice(t, true);
        if (a.price !== price) throw new GameError(`The price is now ${price.toLocaleString('en-US')} DND. Check it and try again.`, 409, 'price_moved');
        const r = need(T.buyHero(P.G, a.hero, price));
        transfer(P.id, 'system:burn', r.price, 'hero_purchase', a.hero, t);
        return r;
      },
    },
    skillUp: { check: a => isHero(a.hero) && T.SKILLS[a.hero].some(s => s.k === a.k), run: (P, a) => need(T.skillUp(P.G, a.hero, a.k)) },
    skillEquip: { check: a => isHero(a.hero) && T.SKILLS[a.hero].some(s => s.k === a.k), run: (P, a) => need(T.skillEquip(P.G, a.hero, a.k)) },
    skillReset: { check: a => isHero(a.hero), run: (P, a) => need(T.skillReset(P.G, a.hero)) },
    skillAuto: { check: a => isHero(a.hero), run: (P, a) => need(T.skillAuto(P.G, a.hero)) },
    equip: {
      check: a => isHero(a.hero) && isId(a.id),
      run(P, a) {
        if (!T.equip(P.G, a.hero, a.id)) throw new GameError('That item is not in your Pack.');
        return {};
      },
    },
    unequip: { check: a => isHero(a.hero) && isSlot(a.slot), run: (P, a) => { T.unequip(P.G, a.hero, a.slot); return {}; } },
    equipBest: { check: a => isHero(a.hero), run: (P, a) => { T.equipBest(P.G, a.hero); return {}; } },
    lock: {
      check: a => isId(a.id),
      run(P, a) {
        const it = T.findItem(P.G, a.id);
        if (!it) throw new GameError('That item is not in your Pack.');
        it.k = it.k ? 0 : 1;
        return { locked: !!it.k };
      },
    },
    hold: { check: a => typeof a.on === 'boolean', run: (P, a) => { P.G.hold = a.on; return {}; } },
    jumpStage: {
      check: a => isInt(a.i, 0, T.STAGE_COUNT - 1) && (a.hold === undefined || typeof a.hold === 'boolean'),
      run(P, a) {
        need(T.jumpStage(P.G, P.B, a.i));
        if (a.hold) P.G.hold = true;
        return {};
      },
    },
    setCrew: {
      check: a => typeof a.name === 'string' && CREW_RE.test(a.name.trim()),
      run: (P, a) => { P.G.crew = a.name.trim(); return {}; },
    },
    list: {
      check: a => isInt(a.price, T.CFG.FLOOR, MAX_PRICE) && (a.itemId !== undefined
        ? isId(a.itemId) && a.mat === undefined && a.qty === undefined
        : Object.hasOwn(T.MATS, String(a.mat)) && isInt(a.qty, 1, 9999)),
      run(P, a, t, acct) {
        const spec = a.itemId !== undefined ? { itemId: a.itemId } : { mat: a.mat, qty: a.qty };
        const { rec } = need(T.createListing(P.G, spec, a.price, t));
        store.insertListing({
          id: rec.id, seller: P.id, crew: P.G.crew, key: rec.key, price: rec.price,
          item: rec.item ? JSON.stringify(rec.item) : null, mat: rec.mat ?? null, qty: rec.qty ?? null,
          visible: peerEligible(acct, t) ? 1 : 0, at: t,
        });
        if (rec.item) store.logItem(rec.item.id, t, 'listed', P.id, rec.id);
        dropCounts();
        return { id: rec.id, price: rec.price };
      },
    },
    cancelList: {
      check: a => isId(a.id),
      run(P, a, t) {
        const row = store.getListing(a.id);
        if (!row || row.seller_id !== P.id) throw new GameError('That listing is not yours.', 403, 'forbidden');
        if (row.status !== 'open') throw new GameError('Too late. That listing has closed.');
        const rec = T.cancelListing(P.G, a.id);
        if (!rec) throw new Error(`listing ${a.id} is open but missing from its seller's state`);
        store.closeListing(a.id, 'cancelled', null, t);
        if (rec.item) store.logItem(rec.item.id, t, 'unlisted', P.id, rec.id);
        dropCounts();
        return {};
      },
    },
    buyDrifter: {
      check: a => T.isValidKey(a.key) && isInt(a.maxPrice, T.CFG.FLOOR, MAX_PRICE),
      run(P, a, t) {
        const pc = peerCounts(t).get(a.key) || 0;
        if (T.driftAsk(a.key, t, pc) > a.maxPrice) throw new GameError('The price just moved. Check it and try again.', 409, 'price_moved');
        const r = need(T.buyFromDrifter(P.G, a.key, t, pc));
        // Spent DND is burned, so purchases never refill the rewards vault.
        transfer(P.id, 'system:burn', r.price, 'purchase_burn', a.key, t);
        return r;
      },
    },
    buyPeer: {
      check: a => isId(a.id) && isInt(a.price, T.CFG.FLOOR, MAX_PRICE),
      run: buyPeer,
    },
  };

  function buyPeer(P, a, t, acct) {
    const G = P.G;
    const row = store.getListing(a.id);
    if (!row || row.status !== 'open' || !row.visible) throw new GameError('That listing is gone.', 409, 'gone');
    if (row.seller_id === P.id) throw new GameError('You cannot buy your own listing.');
    if (!peerEligible(acct, t)) {
      throw new GameError(acct.guest ? 'Claim your crew first to trade with other crews.' : 'Your account is too new to trade with other crews.', 403, 'not_eligible');
    }
    if (row.price !== a.price) throw new GameError('That listing just changed. Check it again.', 409, 'price_moved');
    if (G.marks < row.price) throw new GameError(`Needs ${row.price} DND.`);
    if (row.item && G.items.length >= T.packCap(G)) throw new GameError('Your Pack is full.');

    const S = load(row.seller_id);
    const rec = S.G.market.mine.find(r => r.id === row.id);
    if (!rec) throw new Error(`listing ${row.id} is open but missing from its seller's state`);
    const f = T.settleSale(S.G, rec, G.crew, t);
    G.marks -= row.price;
    G.ledger.marksOut += row.price;
    G.ledger.bought++;
    transfer(P.id, S.id, f.net, 'peer_sale', row.id, t);
    transfer(P.id, 'system:burn', f.burn, 'sale_burn', row.id, t);

    let name;
    if (row.item) {
      const item = { e: [], k: 0, ...JSON.parse(row.item), t: t + T.CFG.RESALE_LOCK, nd: 1 };
      G.items.push(item);
      G.ledger.itemsMade++;
      if (item.g > G.stats.best) G.stats.best = item.g;
      store.logItem(item.id, t, 'traded', P.id, `from ${S.id} for ${row.price}`);
      name = T.keyName(row.key);
    } else {
      G.mats[row.mat] += row.qty;
      name = `${row.qty} × ${T.MATS[row.mat].n}`;
    }
    store.closeListing(row.id, 'sold', P.id, t);
    store.insertTrade({ listing: row.id, seller: S.id, buyer: P.id, key: row.key, price: row.price, house: f.burn, founder: 0, net: f.net, at: t });
    T.mail(G, t, `You bought ${name} from ${row.crew} for ${row.price} DND.`, 'buy');
    pushEvent(S.G, { t: 'sale', price: row.price, net: f.net, buyer: G.crew });
    save(S, t);
    dropCounts();
    return { price: row.price };
  }

  // ------------------------------------------------------------ requests
  function sync(acct) {
    const t = now();
    return store.tx(() => {
      const P = load(acct.id);
      catchUp(P, t);
      P.seenAt = t;
      const out = view(P, acct, t);
      save(P, t);
      return out;
    });
  }
  // ------------------------------------------------------------ buying a hero with a direct burn
  // The player's own wallet burns the DND, so the game never holds tokens and needs no vault. The
  // chain is the proof: a successful transaction must show DND leaving this crew's linked wallet for
  // the zero address, on the real token. Each transaction can only ever buy one hero.
  const TRANSFER = topic('Transfer(address,address,uint256)'), ZERO = '0x' + '0'.repeat(40), UNIT = 10n ** 18n;
  const burnNodes = cfg.HERO_BURN ? cfg.HERO_BURN.rpcs.map(url => rpcClient(url, { timeoutMs: 5000 })) : [];
  async function askChain(method, params = []) {
    for (const node of burnNodes) { try { return await node.call(method, params); } catch { /* the next node may answer */ } }
    throw new GameError('The chain could not be reached. Your burn is safe, so try again in a moment.', 503, 'chain_busy');
  }
  let chainChecked = false, burnedSeen = null, burnedAt = -Infinity;
  async function claimHero(acct, hero, txHash) {
    if (!cfg.HERO_BURN) throw new GameError('Heroes are not sold this way here.', 409, 'no_burn');
    if (!isHero(hero) || typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw bad();
    const hash = txHash.toLowerCase(), wallet = store.walletOfKind(acct.id, 'evm');
    if (!wallet) throw new GameError('Link an Ethereum-type wallet first.', 409, 'no_wallet');
    const used = () => new GameError('That burn has already bought a hero.', 409, 'burn_used');
    // A retry after a dropped connection simply gets the crew back.
    const seen = store.getHeroBurn(hash);
    if (seen) { if (seen.account_id === acct.id && seen.hero === hero) return sync(acct); throw used(); }
    if (!chainChecked) {
      if (Number(await askChain('eth_chainId')) !== cfg.HERO_BURN.chainId) throw new GameError('The chain could not be reached. Your burn is safe, so try again in a moment.', 503, 'chain_busy');
      chainChecked = true;
    }
    const receipt = await askChain('eth_getTransactionReceipt', [hash]);
    if (!receipt) throw new GameError('The chain has not confirmed that burn yet.', 409, 'burn_pending');
    if (Number(receipt.status) !== 1) throw new GameError('That transaction failed on the chain, so nothing was burned.', 409, 'burn_failed');
    const from = wallet.address.toLowerCase();
    let units = 0n;
    for (const log of receipt.logs || []) {
      if (log.address.toLowerCase() !== cfg.HERO_BURN.token || log.topics[0] !== TRANSFER || log.topics.length !== 3) continue;
      if (topicAddress(log.topics[1]) === from && topicAddress(log.topics[2]) === ZERO) units += BigInt(log.data);
    }
    if (units === 0n) throw new GameError('That transaction did not burn DND from your linked wallet.', 409, 'not_a_burn');
    const whole = Number(units / UNIT), t = now();
    return store.tx(() => {
      // Checked again here, because this request has been waiting on the network.
      if (store.getHeroBurn(hash)) throw used();
      const price = heroPrice(t, true);
      if (whole < price) throw new GameError(`That burn was ${whole.toLocaleString('en-US')} DND, and ${T.HEROES[hero].n} costs ${price.toLocaleString('en-US')} DND.`, 409, 'burn_short');
      const P = load(acct.id);
      catchUp(P, t);
      P.seenAt = t;
      need(T.grantHero(P.G, hero, whole));
      store.insertHeroBurn({ hash, account: acct.id, wallet: from, hero, whole, block: Number(receipt.blockNumber), at: t });
      burnedAt = -Infinity;
      if (P.G.statsDirty) T.syncParty(P.G, P.B);
      const out = view(P, acct, t);
      save(P, t);
      return out;
    });
  }
  // How much DND has ever been destroyed, read from the token itself. Cached, since it's only a figure on a screen.
  async function burnedOnChain() {
    if (!cfg.HERO_BURN) return null;
    const t = now();
    if (t - burnedAt < 60e3) return burnedSeen;
    burnedAt = t;
    try {
      const supply = await askChain('eth_call', [{ to: cfg.HERO_BURN.token, data: '0x18160ddd' }, 'latest']);
      burnedSeen = Math.max(0, T.TOKEN.supply - Number(BigInt(supply) / UNIT));
    } catch { /* the last figure stands until the next try */ }
    return burnedSeen;
  }

  function action(acct, type, args) {
    if (typeof type !== 'string' || !Object.hasOwn(INTENTS, type)) throw bad();
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw bad();
    const intent = INTENTS[type];
    if (!intent.check(args)) throw bad();
    const t = now();
    return store.tx(() => {
      const P = load(acct.id);
      catchUp(P, t);
      P.seenAt = t;
      if (isHero(args.hero) && type !== 'buyHero' && !T.owns(P.G, args.hero)) throw new GameError(`Buy ${T.HEROES[args.hero].n} first.`);
      const result = intent.run(P, args, t, acct) || {};
      if (P.G.statsDirty) T.syncParty(P.G, P.B);
      const out = view(P, acct, t);
      save(P, t);
      return { result, ...out };
    });
  }
  function market(acct) {
    const t = now();
    const rows = store.openListings(cfg.MARKET_ROWS);
    return {
      listings: rows.filter(r => r.seller_id !== acct.id).map(r => ({
        id: r.id, crew: r.crew, key: r.key, price: r.price,
        item: r.item ? (({ s, l, g, r: roll, nd }) => ({ s, l, g, r: roll, nd }))(JSON.parse(r.item)) : undefined,
        mat: r.mat ?? undefined, qty: r.qty ?? undefined,
      })),
      counts: Object.fromEntries(peerCounts(t)),
    };
  }
  function board(acct) {
    return store.board(cfg.BOARD_ROWS).map(r => ({ crew: r.crew, worth: r.worth, stage: r.stage, me: r.account_id === acct.id }));
  }

  // ------------------------------------------------------------ accounts
  function createAccount({ name = null, pass = null, guest }) {
    const t = now();
    const id = randomUUID();
    store.tx(() => {
      store.createAccount(id, name, pass, guest, t);
      createPlayer(id, t);
      if (name) renameDefault(id, name, t);
    });
    return id;
  }
  function renameDefault(id, name, t) {
    const P = load(id);
    if (/^Crew \d+$/.test(P.G.crew) && CREW_RE.test(name)) P.G.crew = name;
    save(P, t);
  }
  function claimAccount(id, name, pass) {
    const t = now();
    store.tx(() => {
      store.claimAccount(id, name, pass);
      renameDefault(id, name, t);
    });
  }
  // Closes every open listing and hands the goods back. Marks already earned stay in the ledger for review.
  function ban(id, reason) {
    const t = now();
    store.tx(() => {
      store.setBan(id, t, reason);
      store.deleteSessionsFor(id);
      const P = load(id);
      for (const rec of P.G.market.mine.slice()) {
        T.cancelListing(P.G, rec.id);
        store.closeListing(rec.id, 'cancelled', null, t);
      }
      save(P, t);
    });
    dropCounts();
  }
  const desk = createDesk({ store, cfg, now, GameError, transfer, load, save, pushEvent, T });
  const wallets = createWallets({ store, cfg, now, GameError, createAccount, afterLink: (id, address, t) => desk.claimHeld(id, address, t) });
  return { sync, action, claimHero, burnedOnChain, market, board, createAccount, claimAccount, ban, catchUp, load, save, cfg, desk, wallets, intents: Object.keys(INTENTS), heroPriceDefault: T.CFG.HERO_PRICE };
}
