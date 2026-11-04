// The Vercel setup: the same game on the hosted database driver, here against a local file, plus
// checks on the settings that keep the site's headers right and local data out of the upload.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, CSP } from '../server/app.mjs';
import { runAudit } from '../server/audit.mjs';
import { T } from '../server/game.mjs';
import { openStore } from '../server/store.mjs';

const OPEN = { auth: [1e6, 1e6], guest: [1e6, 1e6], action: [1e6, 1e6], sync: [1e6, 1e6], read: [1e6, 1e6] };

describe('the hosted database driver', () => {
  let app, base, dir;
  const clock = { t: Date.now() };
  const client = () => {
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, data: await res.json() };
    };
    return { post: (p, b = {}) => call('POST', p, b), get: p => call('GET', p), sync: () => call('POST', '/api/sync', {}), act: (type, args = {}) => call('POST', '/api/action', { type, args }) };
  };
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tf-hosted-'));
    app = createApp({ hosted: { url: join(dir, 'h.db') }, now: () => clock.t, rates: OPEN, config: { PEER_MIN_AGE_MS: 0 } });
    base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;
  });
  after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  test('a sale between two crews works and the books balance', async () => {
    const a = client(), b = client();
    assert.equal((await a.post('/api/register', { name: 'seller_one', password: 'correct horse' })).status, 200);
    assert.equal((await b.post('/api/register', { name: 'buyer_one', password: 'correct horse' })).status, 200);
    const it = (await a.sync()).data.G.items.find(i => i.g >= 3);
    await a.act('salvageUpTo', { g: 1 });
    const listed = await a.act('list', { itemId: it.id, price: 40 });
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    const row = (await b.get('/api/market')).data.listings.find(l => l.id === listed.data.result.id);
    assert.equal(row._metadata, undefined, 'driver metadata must not reach players');
    const before = (await b.sync()).data.G.marks, sold = (await a.sync()).data.G.marks;
    assert.equal((await b.act('buyPeer', { id: row.id, price: 40 })).status, 200);
    assert.equal((await b.sync()).data.G.marks, before - 40);
    assert.equal((await a.sync()).data.G.marks, sold + T.feesFor(40).net);
    assert.deepEqual(runAudit(app.store, clock.t).violations, []);
  });
  test('column names read as written, even when the database upper-cases a keyword', () => {
    app.store.db.exec('CREATE TABLE IF NOT EXISTS shouting (KEY TEXT PRIMARY KEY, VALUE TEXT)');
    app.store.q('INSERT OR REPLACE INTO shouting (key, value) VALUES (?, ?)').run('a', 'b');
    assert.deepEqual({ ...app.store.q('SELECT * FROM shouting').get() }, { key: 'a', value: 'b' });
    assert.deepEqual({ ...app.store.q('SELECT * FROM shouting').all()[0] }, { key: 'a', value: 'b' });
    app.store.db.exec('DROP TABLE shouting');
  });
  test('two servers starting together agree on one secret', () => {
    const first = app.store.secret(), other = openStore(':memory:', { url: join(dir, 'h.db') });
    app.store.q('DELETE FROM meta WHERE key = ?').run('secret');
    const a = other.secret(), b = app.store.secret();
    assert.equal(a, b);
    assert.notEqual(a, first);
    other.close();
  });
  test('a failed transaction changes nothing', () => {
    const count = () => app.store.q('SELECT COUNT(*) AS n FROM meta').get().n, was = count();
    assert.throws(() => app.store.tx(() => { app.store.q('INSERT INTO meta (key, value) VALUES (?, ?)').run('oops', '1'); throw new Error('stop'); }), /stop/);
    assert.equal(count(), was);
    assert.equal(app.store.q('SELECT value FROM meta WHERE key = ?').get('oops'), undefined);
  });
  test('a crew survives a restart, because nothing is kept in the server', async () => {
    const a = client();
    await a.post('/api/guest');
    const before = (await a.sync()).data.G;
    const again = createApp({ hosted: { url: join(dir, 'h.db') }, now: () => clock.t, rates: OPEN, config: { PEER_MIN_AGE_MS: 0 } });
    assert.equal(again.game.sync(again.store.getAccount(app.store.q('SELECT account_id FROM players ORDER BY rowid DESC LIMIT 1').get().account_id)).G.crew, before.crew);
    again.store.close();
  });
});

describe('the Vercel settings', () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  test('static pages get the same security policy as the server', () => {
    const headers = Object.fromEntries(vercel.headers[0].headers.map(h => [h.key, h.value]));
    assert.equal(headers['Content-Security-Policy'], CSP);
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  });
  test('only named folders are uploaded, so local databases stay on this machine', () => {
    const lines = readFileSync(new URL('../.vercelignore', import.meta.url), 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
    assert.equal(lines[0], '/*');
    for (const l of lines.slice(1)) assert.match(l, /^!\/(api|art|server|src|build\.mjs|package\.json|package-lock\.json|vercel\.json)$/);
  });
  test('the function entry point exists and refuses live token settings', () => {
    assert.ok(existsSync(new URL('../api/index.mjs', import.meta.url)));
    assert.match(readFileSync(new URL('../api/index.mjs', import.meta.url), 'utf8'), /DND_TOKEN/);
  });
});
