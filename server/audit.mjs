// Checks the whole economy against its own records. Violations mean a bug or database
// tampering and should stop a launch. Flags are patterns worth a human look.
import { T } from './game.mjs';

export function runAudit(store, now) {
  const violations = [], flags = [];
  const v = (kind, detail) => violations.push({ kind, detail });
  const totals = new Map(store.ledgerTotals().map(r => [r.account, r.total]));

  const ledgerSum = store.ledgerSum();
  if (ledgerSum !== 0) v('ledger_unbalanced', `all ledger rows sum to ${ledgerSum}, expected 0`);

  const seen = new Map();
  const track = (id, where) => {
    if (seen.has(id)) v('duplicate_item', `${id} exists in ${seen.get(id)} and ${where}`);
    else seen.set(id, where);
  };

  const players = store.allPlayers();
  const listings = store.allOpenListings();
  const openByOwner = new Map();
  for (const l of listings) {
    if (!openByOwner.has(l.seller_id)) openByOwner.set(l.seller_id, new Set());
    openByOwner.get(l.seller_id).add(l.id);
  }

  let marksHeld = 0, itemCount = 0;
  const gradeTotals = new Array(T.GRADES.length).fill(0);
  for (const row of players) {
    const G = JSON.parse(row.g), who = row.account_id;
    const held = totals.get(who) ?? 0;
    if (G.marks !== held) v('marks_mismatch', `${who} holds ${G.marks} DND but the ledger says ${held}`);
    marksHeld += G.marks;
    if (!Number.isInteger(G.marks) || G.marks < 0) v('bad_marks', `${who}: ${G.marks}`);
    if (!Number.isFinite(G.coin) || G.coin < 0) v('bad_coin', `${who}: ${G.coin}`);
    for (const [m, n] of Object.entries(G.mats)) {
      if (!Object.hasOwn(T.MATS, m) || !Number.isInteger(n) || n < 0) v('bad_material', `${who}: ${m}=${n}`);
    }
    const ids = new Set();
    for (const it of G.items) {
      track(it.id, `${who} pack`);
      ids.add(it.id);
      itemCount++;
      if (it.g >= 0 && it.g < gradeTotals.length) gradeTotals[it.g]++;
      else v('bad_item', `${who}: ${JSON.stringify(it)}`);
      if (it.g >= 3 && !store.itemHasMint(it.id)) v('item_without_origin', `${it.id} (${T.GRADES[it.g].n}) held by ${who} has no mint record`);
    }
    for (const hero of T.HERO_KEYS) {
      for (const [slot, id] of Object.entries(G.heroes[hero].gear)) {
        if (!ids.has(id)) v('equip_missing', `${who} ${hero} ${slot} points at ${id}`);
      }
    }
    const mine = new Set(G.market.mine.map(r => r.id));
    const open = openByOwner.get(who) || new Set();
    for (const id of mine) if (!open.has(id)) v('listing_missing', `${who} thinks ${id} is open, the market does not`);
    for (const id of open) if (!mine.has(id)) v('listing_orphan', `market has ${id} open for ${who}, who does not know about it`);

    // A generous ceiling on chests: all talents, strong gear, and every boss killed.
    const ageSec = Math.max(0, (now - JSON.parse(row.g).createdAt) / 1000);
    const chests = G.stats.chests + G.chests.length;
    if (chests > ageSec / 20 + G.stats.boss + 5) flags.push({ kind: 'chest_rate', detail: `${who} has ${chests} chests in ${Math.round(ageSec)}s` });
  }
  for (const l of listings) {
    if (l.item) {
      const it = JSON.parse(l.item);
      track(it.id, `listing ${l.id}`);
      if (it.g >= 3 && !store.itemHasMint(it.id)) v('item_without_origin', `${it.id} in listing ${l.id} has no mint record`);
    }
  }

  const pairs = store.q(`SELECT seller_id, buyer_id, COUNT(*) AS n, SUM(price) AS total FROM trades WHERE buyer_id != 'drifter' GROUP BY seller_id, buyer_id HAVING n >= 5`).all();
  for (const p of pairs) flags.push({ kind: 'repeat_pair', detail: `${p.buyer_id} bought ${p.n} times from ${p.seller_id} for ${p.total} DND in total` });
  for (const t of store.q(`SELECT * FROM trades WHERE buyer_id != 'drifter'`).all()) {
    const ref = T.refPrice(t.key, t.at);
    if (t.price >= ref * 5 && t.price >= 50) flags.push({ kind: 'price_outlier', detail: `listing ${t.listing_id}: ${t.price} DND against a reference of ${ref}` });
  }

  // The token. Everything in the game entered through the vault, and the ledger must prove it.
  const withdrawing = totals.get('system:withdrawing') ?? 0, onChain = totals.get('system:chain') ?? 0;
  const burning = totals.get('system:burning') ?? 0;
  if (burning !== store.openBurnTotal()) v('burn_mismatch', `ledger holds ${burning} DND for burning, the burn vouchers add up to ${store.openBurnTotal()}`);
  if (withdrawing !== store.openWithdrawalTotal()) v('voucher_mismatch', `ledger holds ${withdrawing} DND for open withdrawals, the vouchers add up to ${store.openWithdrawalTotal()}`);
  if (onChain !== store.claimedTotal() - store.creditedTotal()) v('chain_mismatch', `ledger shows ${-onChain} DND came in from the chain, deposits less claims say ${store.creditedTotal() - store.claimedTotal()}`);
  if (store.getMeta('live_economy')) {
    if ((totals.get('system:mint') ?? 0) !== 0) v('test_money_in_live_economy', `${-(totals.get('system:mint'))} test DND is in a live game`);
    if ((totals.get('system:drifters') ?? 0) < 0) v('drifters_overspent', `drifters paid out ${-(totals.get('system:drifters'))} DND more than their purse held`);
  }
  for (const a of store.allAlerts()) v('chain_alert', `${a.kind}: ${a.detail}`);

  return {
    ok: violations.length === 0,
    violations,
    flags,
    stats: {
      players: players.length,
      items: itemCount,
      itemsByGrade: Object.fromEntries(T.GRADES.map((g, i) => [g.n, gradeTotals[i]])),
      openListings: listings.length,
      marksHeld,
      minted: -(totals.get('system:mint') ?? 0),
      rewardsVault: totals.get('system:drifters') ?? 0,
      burned: store.burnedTotal(),
      burnWaiting: (totals.get('system:burn') ?? 0) + burning,
    },
  };
}
