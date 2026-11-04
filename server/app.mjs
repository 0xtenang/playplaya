// HTTP layer: sessions, rate limits, security headers, static files and the JSON API.
// It uses only Node built-ins, so there is no third-party code to keep patched.
import http from 'node:http';
import zlib from 'node:zlib';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { openStore } from './store.mjs';
import { createGame, GameError } from './game.mjs';

const scrypt = promisify(scryptCb);
const COOKIE = 'tf_sid';
const SESSION_MS = 90 * 86400e3;
const MAX_BODY = 16 * 1024;
const NAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const PUBLIC_DIR = new URL('../public/', import.meta.url);
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/engine.js': ['engine.js', 'text/javascript; charset=utf-8'],
  '/sprites.js': ['sprites.js', 'text/javascript; charset=utf-8'],
  '/art.js': ['art.js', 'text/javascript; charset=utf-8'],
  '/wallet.js': ['wallet.js', 'text/javascript; charset=utf-8'],
  '/ui.js': ['ui.js', 'text/javascript; charset=utf-8'],
};
const CSP = ["default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com', "img-src 'self' data:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; ');

// A token bucket per key. Empty buckets answer 429 until they refill.
function limiter(capacity, perSecond, now) {
  const buckets = new Map();
  return {
    take(key) {
      const t = now();
      let b = buckets.get(key);
      if (!b) { b = { n: capacity, at: t }; buckets.set(key, b); }
      b.n = Math.min(capacity, b.n + (t - b.at) / 1000 * perSecond);
      b.at = t;
      if (b.n < 1) return false;
      b.n -= 1;
      return true;
    },
    prune() {
      const t = now();
      for (const [k, b] of buckets) if (b.n + (t - b.at) / 1000 * perSecond >= capacity) buckets.delete(k);
    },
  };
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function checkPassword(password, stored) {
  const [, salt, key] = stored.split('$');
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length);
  return timingSafeEqual(want, got);
}
// Checked against when a name does not exist, so timing does not reveal which names are taken.
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

export function createApp(options = {}) {
  const now = options.now || Date.now;
  const store = openStore(options.dbPath || ':memory:');
  const trustProxy = options.trustProxy || false; // false, 'fly' or 'xff'
  const cookieSecure = !!options.cookieSecure;
  const rates = { auth: [10, 1 / 6], guest: [20, 1 / 180], action: [40, 12], sync: [6, 1], read: [20, 2], ...options.rates };
  const limits = Object.fromEntries(Object.entries(rates).map(([k, [c, r]]) => [k, limiter(c, r, now)]));
  const sha = s => createHash('sha256').update(s).digest('hex');

  const staticFiles = {};
  const buildFile = new URL('build.json', PUBLIC_DIR);
  const build = existsSync(buildFile) ? JSON.parse(readFileSync(buildFile)).build : 'dev';
  for (const [route, [file, type]] of Object.entries(STATIC)) {
    const url = new URL(file, PUBLIC_DIR);
    if (existsSync(url)) {
      const body = readFileSync(url);
      staticFiles[route] = { body, gz: zlib.gzipSync(body), type, etag: `"${sha(body).slice(0, 20)}"` };
    }
  }
  // Sprite sheets never change under the same name, so browsers can keep them for good.
  const atlasDir = new URL('atlas/', PUBLIC_DIR);
  if (existsSync(atlasDir)) {
    for (const file of readdirSync(atlasDir)) {
      const png = file.endsWith('.png');
      if (!png && file !== 'manifest.json' && file !== 'ui.css') continue;
      const body = readFileSync(new URL(file, atlasDir));
      const type = png ? 'image/png' : file === 'ui.css' ? 'text/css; charset=utf-8' : 'application/json; charset=utf-8';
      staticFiles[`/atlas/${file}`] = { body, gz: png ? null : zlib.gzipSync(body), type, etag: `"${sha(body).slice(0, 20)}"`, immutable: png };
    }
  }
  const game = createGame({ store, now, config: options.config, build });

  function ipOf(req) {
    // Clients can send these headers themselves. Fly overwrites its own header, and a
    // proxy appends to X-Forwarded-For, so only the last entry there can be trusted.
    if (trustProxy === 'fly' && req.headers['fly-client-ip']) return String(req.headers['fly-client-ip']);
    if (trustProxy === 'xff' && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',').pop().trim();
    return req.socket.remoteAddress || 'unknown';
  }
  function setHeaders(res) {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  function sendJson(req, res, status, data) {
    const raw = Buffer.from(JSON.stringify(data));
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (raw.length > 1400 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.setHeader('Content-Encoding', 'gzip');
      res.end(zlib.gzipSync(raw, { level: 1 }));
    } else res.end(raw);
  }
  function cookieHeader(value, maxAgeMs) {
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${cookieSecure ? '; Secure' : ''}`;
  }
  function tokenOf(req) {
    const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,100})`));
    return m ? m[1] : null;
  }
  function startSession(res, accountId) {
    const token = randomBytes(32).toString('base64url');
    const t = now();
    store.createSession(sha(token), accountId, t, t + SESSION_MS);
    res.setHeader('Set-Cookie', cookieHeader(token, SESSION_MS));
  }
  function accountOf(req) {
    const token = tokenOf(req);
    if (!token) return null;
    const hash = sha(token);
    const s = store.getSession(hash);
    if (!s) return null;
    if (s.expires_at < now()) { store.deleteSession(hash); return null; }
    return store.getAccount(s.account_id) || null;
  }
  function requireAccount(req) {
    const acct = accountOf(req);
    if (!acct) throw new GameError('Please log in.', 401, 'no_session');
    if (acct.banned_at) throw new GameError(`This account is banned. ${acct.ban_reason || ''}`.trim(), 403, 'banned');
    return acct;
  }
  function take(kind, key) {
    if (!limits[kind].take(key)) throw new GameError('Too many requests. Slow down a little.', 429, 'rate_limited');
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', c => {
        size += c.length;
        if (size > MAX_BODY) { reject(new GameError('That request is too large.', 413, 'too_large')); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  // Blocks cross-site form posts and other sites' scripts from acting with a player's cookie.
  function guardPost(req) {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new GameError('Send JSON.', 415, 'bad_type');
    const origin = req.headers.origin;
    if (origin) {
      let host = null;
      try { host = new URL(origin).host; } catch { /* treated as a mismatch below */ }
      if (host !== req.headers.host) throw new GameError('Cross-site request refused.', 403, 'bad_origin');
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new GameError('Cross-site request refused.', 403, 'bad_origin');
  }
  async function jsonBody(req) {
    guardPost(req);
    const raw = await readBody(req);
    if (!raw.length) return {};
    let body;
    try { body = JSON.parse(raw); } catch { throw new GameError('That request is not valid.', 400, 'bad_request'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GameError('That request is not valid.', 400, 'bad_request');
    return body;
  }
  function credentials(body) {
    const { name, password } = body;
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new GameError('Names are 3 to 20 letters, numbers, dashes or underscores.', 400, 'bad_name');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw new GameError('Passwords are 8 to 200 characters.', 400, 'bad_password');
    return { name, password };
  }

  const routes = {
    // Lets a first-time visitor find out they have no session without an error in the console.
    'GET /api/session': async (req, res) => {
      const acct = accountOf(req);
      sendJson(req, res, 200, { active: !!acct, banned: acct?.banned_at ? `This account is banned. ${acct.ban_reason || ''}`.trim() : null });
    },
    'POST /api/sync': async (req, res) => {
      await jsonBody(req);
      const acct = requireAccount(req);
      take('sync', acct.id);
      sendJson(req, res, 200, game.sync(acct));
    },
    'POST /api/action': async (req, res) => {
      const body = await jsonBody(req);
      const acct = requireAccount(req);
      take('action', acct.id);
      sendJson(req, res, 200, game.action(acct, body.type, body.args ?? {}));
    },
    'GET /api/market': async (req, res) => {
      const acct = requireAccount(req);
      take('read', acct.id);
      sendJson(req, res, 200, game.market(acct));
    },
    'GET /api/board': async (req, res) => {
      const acct = requireAccount(req);
      take('read', acct.id);
      sendJson(req, res, 200, { board: game.board(acct) });
    },
    'POST /api/guest': async (req, res) => {
      await jsonBody(req);
      take('guest', ipOf(req));
      const id = game.createAccount({ guest: true });
      startSession(res, id);
      sendJson(req, res, 200, game.sync(store.getAccount(id)));
    },
    'POST /api/register': async (req, res) => {
      const { name, password } = credentials(await jsonBody(req));
      take('auth', ipOf(req));
      const current = accountOf(req);
      if (current && !current.guest) throw new GameError('You are already logged in.', 409, 'already_claimed');
      if (store.getAccountByName(name)) throw new GameError('That name is taken.', 409, 'name_taken');
      const pass = await hashPassword(password);
      // The scrypt above yields to other requests, so the name is checked again before writing.
      if (store.getAccountByName(name)) throw new GameError('That name is taken.', 409, 'name_taken');
      let id;
      if (current) { game.claimAccount(current.id, name, pass); id = current.id; }
      else id = game.createAccount({ name, pass, guest: false });
      startSession(res, id);
      sendJson(req, res, 200, game.sync(store.getAccount(id)));
    },
    'POST /api/login': async (req, res) => {
      const body = await jsonBody(req);
      take('auth', ipOf(req));
      const name = typeof body.name === 'string' ? body.name : '';
      const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
      const acct = NAME_RE.test(name) ? store.getAccountByName(name) : null;
      const ok = await checkPassword(password, acct?.pass || DUMMY_HASH);
      if (!acct?.pass || !ok) throw new GameError('That name and password do not match.', 401, 'bad_login');
      if (acct.banned_at) throw new GameError(`This account is banned. ${acct.ban_reason || ''}`.trim(), 403, 'banned');
      const old = tokenOf(req);
      if (old) store.deleteSession(sha(old));
      startSession(res, acct.id);
      sendJson(req, res, 200, game.sync(acct));
    },
    // Public token details: everything a wallet needs, and no secrets.
    'GET /api/chain': async (req, res) => {
      take('read', ipOf(req));
      sendJson(req, res, 200, game.desk.publicConfig());
    },
    'GET /api/wallet': async (req, res) => {
      const acct = requireAccount(req);
      take('read', acct.id);
      sendJson(req, res, 200, game.desk.stateFor(acct));
    },
    'POST /api/wallet/challenge': async (req, res) => {
      const body = await jsonBody(req);
      take('auth', ipOf(req));
      const origin = options.publicOrigin || `http${cookieSecure ? 's' : ''}://${req.headers.host}`;
      sendJson(req, res, 200, game.wallets.challenge({ kind: body.kind, address: body.address, purpose: body.purpose, origin, domain: new URL(origin).host }));
    },
    // Proves wallet ownership, then signs in, links to this crew, or starts a new one.
    'POST /api/wallet/verify': async (req, res) => {
      const body = await jsonBody(req);
      take('auth', ipOf(req));
      const proof = game.wallets.prove(body.nonce, body.signature, 'signin');
      const current = accountOf(req), id = game.wallets.signIn(proof, current);
      if (!current || current.id !== id) {
        const old = tokenOf(req);
        if (old) store.deleteSession(sha(old));
        startSession(res, id);
      }
      sendJson(req, res, 200, game.sync(store.getAccount(id)));
    },
    'POST /api/wallet/unlink': async (req, res) => {
      const body = await jsonBody(req);
      const acct = requireAccount(req);
      take('auth', ipOf(req));
      game.wallets.unlink(acct, game.wallets.prove(body.nonce, body.signature, 'unlink'), game.desk.openVouchers);
      sendJson(req, res, 200, game.sync(store.getAccount(acct.id)));
    },
    'POST /api/logout': async (req, res) => {
      await jsonBody(req);
      const token = tokenOf(req);
      if (token) store.deleteSession(sha(token));
      res.setHeader('Set-Cookie', cookieHeader('', 0));
      sendJson(req, res, 200, { ok: true });
    },
    'GET /healthz': async (req, res) => {
      store.q('SELECT 1').get();
      sendJson(req, res, 200, { ok: true });
    },
  };

  async function handle(req, res) {
    setHeaders(res);
    const path = req.url.split('?')[0];
    const route = routes[`${req.method} ${path}`];
    if (route) return route(req, res);
    const file = staticFiles[path];
    if (file && (req.method === 'GET' || req.method === 'HEAD')) {
      res.setHeader('Content-Type', file.type);
      res.setHeader('Cache-Control', file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.setHeader('ETag', file.etag);
      res.setHeader('Vary', 'Accept-Encoding');
      if (req.headers['if-none-match'] === file.etag) { res.statusCode = 304; return res.end(); }
      const gz = file.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      if (gz) res.setHeader('Content-Encoding', 'gzip');
      return res.end(req.method === 'HEAD' ? undefined : gz ? file.gz : file.body);
    }
    sendJson(req, res, 404, { error: 'Not found.', code: 'not_found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(err => {
      if (res.headersSent) { res.destroy(); return; }
      if (err instanceof GameError) {
        // Answer an oversized upload, then hang up so the sender cannot keep streaming.
        if (err.status === 413) { res.setHeader('Connection', 'close'); res.once('finish', () => req.destroy()); }
        return sendJson(req, res, err.status, { error: err.message, code: err.code });
      }
      console.error(`500 ${req.method} ${req.url}:`, err);
      sendJson(req, res, 500, { error: 'Something went wrong on the server.', code: 'server_error' });
    });
  });
  server.requestTimeout = 15e3;
  server.headersTimeout = 10e3;

  // Watches the vault while the server runs. A slow or failed scan just tries again next time.
  const watcher = game.desk.enabled && options.watchChain !== false ? setInterval(() => game.desk.poll(), game.cfg.CHAIN.pollMs) : null;
  if (watcher) { watcher.unref(); game.desk.poll(); }
  const housekeeping = setInterval(() => {
    store.pruneSessions(now());
    for (const l of Object.values(limits)) l.prune();
  }, 3600e3);
  housekeeping.unref();

  return {
    server, store, game,
    listen: (port, host) => new Promise(resolve => server.listen(port, host, () => resolve(server.address().port))),
    close: () => new Promise(resolve => {
      clearInterval(housekeeping);
      if (watcher) clearInterval(watcher);
      server.close(() => { store.close(); resolve(); });
      server.closeAllConnections();
    }),
  };
}
