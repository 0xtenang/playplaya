// SQLite storage. Node runs one request at a time and these calls are synchronous,
// so a transaction here can never interleave with another request. On a hosted database
// several copies of the server can run at once, and BEGIN IMMEDIATE keeps them apart.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE COLLATE NOCASE,
  pass TEXT,
  guest INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  banned_at INTEGER,
  ban_reason TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
CREATE TABLE IF NOT EXISTS players (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  g TEXT NOT NULL,
  b TEXT NOT NULL,
  sim_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  worth INTEGER NOT NULL DEFAULT 0,
  stage INTEGER NOT NULL DEFAULT 1,
  crew TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS players_worth ON players(worth DESC);
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  crew TEXT NOT NULL,
  key TEXT NOT NULL,
  price INTEGER NOT NULL,
  item TEXT,
  mat TEXT,
  qty INTEGER,
  status TEXT NOT NULL,
  visible INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  buyer_id TEXT,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS listings_open ON listings(status, visible, price);
CREATE INDEX IF NOT EXISTS listings_seller ON listings(seller_id, status);
CREATE TABLE IF NOT EXISTS hero_burns (
  tx_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  wallet TEXT NOT NULL,
  hero TEXT NOT NULL,
  whole INTEGER NOT NULL,
  block INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  linked_at INTEGER NOT NULL,
  UNIQUE (account_id, kind)
);
CREATE TABLE IF NOT EXISTS wallet_challenges (
  nonce TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  address TEXT NOT NULL,
  purpose TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deposits (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  from_addr TEXT NOT NULL,
  whole INTEGER NOT NULL,
  block INTEGER NOT NULL,
  account_id TEXT,
  seen_at INTEGER NOT NULL,
  credited_at INTEGER,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS deposits_from ON deposits(from_addr);
CREATE INDEX IF NOT EXISTS deposits_account ON deposits(account_id);
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  whole INTEGER NOT NULL,
  expiry INTEGER NOT NULL,
  v INTEGER NOT NULL,
  r TEXT NOT NULL,
  s TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  tx_hash TEXT
);
CREATE INDEX IF NOT EXISTS withdrawals_account ON withdrawals(account_id, status);
CREATE INDEX IF NOT EXISTS withdrawals_time ON withdrawals(created_at);
CREATE TABLE IF NOT EXISTS chain_alerts (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  account TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT
);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger(account);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  key TEXT NOT NULL,
  price INTEGER NOT NULL,
  house INTEGER NOT NULL, -- the fee, which now burns
  founder INTEGER NOT NULL,
  net INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trades_pair ON trades(seller_id, buyer_id);
CREATE TABLE IF NOT EXISTS item_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  event TEXT NOT NULL,
  account TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS item_log_item ON item_log(item_id);
`;

// A hosted libSQL database, for hosts with no disk of their own. It answers like node:sqlite once
// each row is tidied: the driver adds timing metadata, and the database upper-cases column names
// that are SQL keywords, such as key. It loads only here, so other setups need no packages.
function openHosted({ url, authToken }) {
  const Database = createRequire(import.meta.url)('libsql');
  const raw = new Database(url, { authToken });
  const row = r => {
    if (!r) return r;
    const out = {};
    for (const k of Object.keys(r)) if (k !== '_metadata') out[k.toLowerCase()] = r[k];
    return out;
  };
  return {
    exec: sql => raw.exec(sql),
    prepare: sql => { const s = raw.prepare(sql); return { get: (...a) => row(s.get(...a)), all: (...a) => s.all(...a).map(row), run: (...a) => s.run(...a) }; },
    close: () => raw.close(),
  };
}
const pause = new Int32Array(new SharedArrayBuffer(4));

export function openStore(path, hosted = null) {
  const db = hosted ? openHosted(hosted) : new DatabaseSync(path);
  if (!hosted) db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(SCHEMA);
  const cache = new Map();
  const q = sql => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
  let depth = 0;

  // Another copy of the server may hold the write lock for a moment, so a hosted database waits its turn.
  function begin() {
    for (let wait = 40; ; wait *= 2) {
      try { return db.exec('BEGIN IMMEDIATE'); } catch (e) {
        if (!hosted || wait > 1300 || !/busy|locked/i.test(`${e.code} ${e.message}`)) throw e;
        Atomics.wait(pause, 0, 0, wait + Math.random() * wait);
      }
    }
  }

  function tx(fn) {
    if (depth > 0) return fn();
    begin();
    depth++;
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      // A hosted database may already have ended the transaction, and the first error is the useful one.
      try { db.exec('ROLLBACK'); } catch (rollbackError) { if (!hosted) throw rollbackError; }
      throw e;
    } finally {
      depth--;
    }
  }

  // Generated once and kept in the database, so restarts keep the same market rolls.
  function secret() {
    const row = q('SELECT value FROM meta WHERE key = ?').get('secret');
    if (row) return row.value;
    // Two copies of the server can start at once, so the first write wins and everyone reads it.
    q('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('secret', randomBytes(32).toString('hex'));
    return q('SELECT value FROM meta WHERE key = ?').get('secret').value;
  }

  return {
    db, q, tx, secret,
    close: () => db.close(),

    createAccount: (id, name, pass, guest, at) => q('INSERT INTO accounts (id, name, pass, guest, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, pass, guest ? 1 : 0, at),
    claimAccount: (id, name, pass) => q('UPDATE accounts SET name = ?, pass = ?, guest = 0 WHERE id = ?').run(name, pass, id),
    getAccount: id => q('SELECT * FROM accounts WHERE id = ?').get(id),
    getAccountByName: name => q('SELECT * FROM accounts WHERE name = ?').get(name),
    setBan: (id, at, reason) => q('UPDATE accounts SET banned_at = ?, ban_reason = ? WHERE id = ?').run(at, reason, id),

    createSession: (hash, accountId, at, expires) => q('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hash, accountId, at, expires),
    getSession: hash => q('SELECT * FROM sessions WHERE token_hash = ?').get(hash),
    deleteSession: hash => q('DELETE FROM sessions WHERE token_hash = ?').run(hash),
    deleteSessionsFor: id => q('DELETE FROM sessions WHERE account_id = ?').run(id),
    pruneSessions: at => q('DELETE FROM sessions WHERE expires_at < ?').run(at),

    getPlayer: id => q('SELECT * FROM players WHERE account_id = ?').get(id),
    insertPlayer: (id, g, b, simAt, seenAt, crew) => q('INSERT INTO players (account_id, g, b, sim_at, seen_at, crew) VALUES (?, ?, ?, ?, ?, ?)').run(id, g, b, simAt, seenAt, crew),
    savePlayer: (id, g, b, simAt, seenAt, stage, crew) => q('UPDATE players SET g = ?, b = ?, sim_at = ?, seen_at = ?, stage = ?, crew = ? WHERE account_id = ?').run(g, b, simAt, seenAt, stage, crew, id),
    setWorth: (id, worth) => q('UPDATE players SET worth = ? WHERE account_id = ?').run(worth, id),
    allPlayers: () => q('SELECT * FROM players').all(),
    board: limit => q(`SELECT p.account_id, p.crew, p.worth, p.stage FROM players p JOIN accounts a ON a.id = p.account_id
                       WHERE a.banned_at IS NULL AND a.guest = 0 ORDER BY p.worth DESC LIMIT ?`).all(limit),

    insertListing: l => q(`INSERT INTO listings (id, seller_id, crew, key, price, item, mat, qty, status, visible, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`).run(l.id, l.seller, l.crew, l.key, l.price, l.item, l.mat, l.qty, l.visible, l.at),
    getListing: id => q('SELECT * FROM listings WHERE id = ?').get(id),
    closeListing: (id, status, buyer, at) => q('UPDATE listings SET status = ?, buyer_id = ?, closed_at = ? WHERE id = ?').run(status, buyer, at, id),
    openListings: limit => q(`SELECT id, seller_id, crew, key, price, item, mat, qty FROM listings
                              WHERE status = 'open' AND visible = 1 ORDER BY price ASC LIMIT ?`).all(limit),
    openCounts: () => q(`SELECT key, COUNT(*) AS n FROM listings WHERE status = 'open' AND visible = 1 GROUP BY key`).all(),
    allOpenListings: () => q(`SELECT * FROM listings WHERE status = 'open'`).all(),

    ledgerRow: (at, account, delta, reason, ref) => q('INSERT INTO ledger (at, account, delta, reason, ref) VALUES (?, ?, ?, ?, ?)').run(at, account, delta, reason, ref),
    ledgerTotals: () => q('SELECT account, SUM(delta) AS total FROM ledger GROUP BY account').all(),
    ledgerSum: () => q('SELECT COALESCE(SUM(delta), 0) AS total FROM ledger').get().total,

    ledgerBalance: account => q('SELECT COALESCE(SUM(delta), 0) AS total FROM ledger WHERE account = ?').get(account).total,
    getMeta: key => q('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null,
    setMeta: (key, value) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value),
    deleteMeta: key => q('DELETE FROM meta WHERE key = ?').run(key),

    getWallet: address => q('SELECT * FROM wallets WHERE address = ?').get(address),
    getHeroBurn: hash => q('SELECT * FROM hero_burns WHERE tx_hash = ?').get(hash),
    insertHeroBurn: b => q('INSERT INTO hero_burns (tx_hash, account_id, wallet, hero, whole, block, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(b.hash, b.account, b.wallet, b.hero, b.whole, b.block, b.at),
    heroBurnStats: () => q('SELECT COUNT(*) AS purchases, COALESCE(SUM(whole), 0) AS whole FROM hero_burns').get(),
    walletOfKind: (id, kind) => q('SELECT * FROM wallets WHERE account_id = ? AND kind = ?').get(id, kind),
    walletsOf: id => q('SELECT * FROM wallets WHERE account_id = ?').all(id),
    insertWallet: (address, kind, id, at) => q('INSERT INTO wallets (address, kind, account_id, linked_at) VALUES (?, ?, ?, ?)').run(address, kind, id, at),
    deleteWallet: address => q('DELETE FROM wallets WHERE address = ?').run(address),
    setNotGuest: id => q('UPDATE accounts SET guest = 0 WHERE id = ?').run(id),
    insertChallenge: (nonce, kind, address, purpose, message, expires) => q('INSERT INTO wallet_challenges (nonce, kind, address, purpose, message, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(nonce, kind, address, purpose, message, expires),
    takeChallenge: nonce => { const row = q('SELECT * FROM wallet_challenges WHERE nonce = ?').get(nonce); if (row) q('DELETE FROM wallet_challenges WHERE nonce = ?').run(nonce); return row; },
    pruneChallenges: at => q('DELETE FROM wallet_challenges WHERE expires_at < ?').run(at),

    insertDeposit: (d, at) => q('INSERT OR IGNORE INTO deposits (tx_hash, log_index, from_addr, whole, block, seen_at) VALUES (?, ?, ?, ?, ?, ?)').run(d.tx_hash, d.log_index, d.from_addr, d.whole, d.block, at).changes > 0,
    markDepositCredited: (tx, i, id, at) => q('UPDATE deposits SET account_id = ?, credited_at = ? WHERE tx_hash = ? AND log_index = ?').run(id, at, tx, i),
    heldDeposits: address => q('SELECT * FROM deposits WHERE from_addr = ? AND credited_at IS NULL').all(address),
    heldTotal: () => q('SELECT COALESCE(SUM(whole), 0) AS total FROM deposits WHERE credited_at IS NULL').get().total,
    recentDeposits: (id, limit) => q('SELECT * FROM deposits WHERE account_id = ? ORDER BY credited_at DESC LIMIT ?').all(id, limit),
    creditedTotal: () => q('SELECT COALESCE(SUM(whole), 0) AS total FROM deposits WHERE credited_at IS NOT NULL').get().total,

    insertWithdrawal: w => q(`INSERT INTO withdrawals (id, account_id, to_addr, whole, expiry, v, r, s, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`).run(w.id, w.account, w.to, w.whole, w.expiry, w.v, w.r, w.s, w.at),
    getWithdrawal: id => q('SELECT * FROM withdrawals WHERE id = ?').get(id),
    settleWithdrawal: (id, status, at, tx) => q('UPDATE withdrawals SET status = ?, settled_at = ?, tx_hash = ? WHERE id = ?').run(status, at, tx, id),
    openWithdrawals: id => q(`SELECT * FROM withdrawals WHERE account_id = ? AND status = 'open'`).all(id),
    recentWithdrawals: (id, limit) => q('SELECT * FROM withdrawals WHERE account_id = ? ORDER BY created_at DESC LIMIT ?').all(id, limit),
    expiredOpen: time => q(`SELECT * FROM withdrawals WHERE status = 'open' AND expiry < ?`).all(time),
    // Refunded vouchers paid nothing, and burns pay nobody, so neither counts against a daily limit.
    withdrawnSince: (id, at) => (id
      ? q(`SELECT COALESCE(SUM(whole), 0) AS total FROM withdrawals WHERE account_id = ? AND created_at >= ? AND status != 'refunded'`).get(id, at)
      : q(`SELECT COALESCE(SUM(whole), 0) AS total FROM withdrawals WHERE created_at >= ? AND status != 'refunded' AND account_id != 'system:burn'`).get(at)).total,
    openWithdrawalTotal: () => q(`SELECT COALESCE(SUM(whole), 0) AS total FROM withdrawals WHERE status = 'open' AND account_id != 'system:burn'`).get().total,
    openBurnTotal: () => q(`SELECT COALESCE(SUM(whole), 0) AS total FROM withdrawals WHERE status = 'open' AND account_id = 'system:burn'`).get().total,
    burnedTotal: () => q(`SELECT COALESCE(SUM(whole), 0) AS total FROM withdrawals WHERE status = 'claimed' AND account_id = 'system:burn'`).get().total,
    claimedTotal: () => q(`SELECT COALESCE(SUM(whole), 0) AS total FROM withdrawals WHERE status = 'claimed'`).get().total,
    chainCursor: () => Number(q(`SELECT value FROM meta WHERE key = 'chain_cursor'`).get()?.value ?? -1),
    setChainCursor: block => q(`INSERT INTO meta (key, value) VALUES ('chain_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(block)),
    insertAlert: (at, kind, detail) => q('INSERT INTO chain_alerts (at, kind, detail) VALUES (?, ?, ?)').run(at, kind, detail),
    allAlerts: () => q('SELECT * FROM chain_alerts ORDER BY at').all(),
    drifterPaidSince: (id, at) => q(`SELECT COALESCE(SUM(price), 0) AS total FROM trades WHERE seller_id = ? AND buyer_id = 'drifter' AND at >= ?`).get(id, at).total,

    insertTrade: (t) => q('INSERT INTO trades (listing_id, seller_id, buyer_id, key, price, house, founder, net, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(t.listing, t.seller, t.buyer, t.key, t.price, t.house, t.founder, t.net, t.at),
    logItem: (itemId, at, event, account, detail) => q('INSERT INTO item_log (item_id, at, event, account, detail) VALUES (?, ?, ?, ?, ?)').run(itemId, at, event, account, detail ?? null),
    itemHasMint: itemId => !!q(`SELECT 1 FROM item_log WHERE item_id = ? AND event IN ('mint', 'starter') LIMIT 1`).get(itemId),
  };
}
