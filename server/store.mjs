// SQLite storage. Node runs one request at a time and these calls are synchronous,
// so a transaction here can never interleave with another request.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

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
  house INTEGER NOT NULL,
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

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(SCHEMA);
  const cache = new Map();
  const q = sql => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
  let depth = 0;

  function tx(fn) {
    if (depth > 0) return fn();
    db.exec('BEGIN IMMEDIATE');
    depth++;
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      depth--;
    }
  }

  // Generated once and kept in the database, so restarts keep the same market rolls.
  function secret() {
    const row = q('SELECT value FROM meta WHERE key = ?').get('secret');
    if (row) return row.value;
    const value = randomBytes(32).toString('hex');
    q('INSERT INTO meta (key, value) VALUES (?, ?)').run('secret', value);
    return value;
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

    insertTrade: (t) => q('INSERT INTO trades (listing_id, seller_id, buyer_id, key, price, house, founder, net, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(t.listing, t.seller, t.buyer, t.key, t.price, t.house, t.founder, t.net, t.at),
    logItem: (itemId, at, event, account, detail) => q('INSERT INTO item_log (item_id, at, event, account, detail) VALUES (?, ?, ?, ?, ?)').run(itemId, at, event, account, detail ?? null),
    itemHasMint: itemId => !!q(`SELECT 1 FROM item_log WHERE item_id = ? AND event IN ('mint', 'starter') LIMIT 1`).get(itemId),
  };
}
