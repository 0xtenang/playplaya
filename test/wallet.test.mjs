// Wallet sign-in over real HTTP, using real signatures. Needs no chain and no outside tools.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createECDH, generateKeyPairSync, randomBytes, sign as cryptoSign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { runAudit } from '../server/audit.mjs';
import { base58Decode, readChainEnv, isEvmAddress, isSolanaAddress, keccak, makeSigner, personalDigest, recoverAddress, toChecksum, verifyEvm, verifySolana } from '../server/chain.mjs';

const OPEN_RATES = { auth: [1e6, 1e6], guest: [1e6, 1e6], action: [1e6, 1e6], sync: [1e6, 1e6], read: [1e6, 1e6] };

// A pretend EVM wallet. It signs the same bytes a real wallet's personal_sign does.
function evmWallet(hex = randomBytes(32).toString('hex')) {
  const raw = Buffer.from(hex.replace(/^0x/, ''), 'hex'), ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(raw);
  const pub = ecdh.getPublicKey(), b = x => x.toString('base64url');
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'secp256k1', d: b(raw), x: b(pub.subarray(1, 33)), y: b(pub.subarray(33)) }, format: 'jwk' });
  const address = '0x' + keccak(pub.subarray(1)).subarray(12).toString('hex');
  return {
    kind: 'evm', address,
    sign(message) {
      const body = Buffer.from(message), pre = Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${body.length}`), body]);
      const sig = cryptoSign('keccak-256', pre, { key, dsaEncoding: 'ieee-p1363' });
      const r = BigInt('0x' + sig.subarray(0, 32).toString('hex')), s = BigInt('0x' + sig.subarray(32).toString('hex'));
      for (const v of [27, 28]) if (recoverAddress(personalDigest(message), v, r, s) === address) return '0x' + sig.toString('hex') + v.toString(16);
      throw new Error('could not sign');
    },
  };
}
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58 = buf => { let n = BigInt('0x' + buf.toString('hex')), s = ''; while (n) { s = B58[Number(n % 58n)] + s; n /= 58n; } return s; };
function solWallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const address = base58(publicKey.export({ format: 'der', type: 'spki' }).subarray(12));
  return { kind: 'sol', address, sign: message => cryptoSign(null, Buffer.from(message), privateKey).toString('base64') };
}

describe('wallet maths', () => {
  test('Keccak matches the published test values', () => {
    assert.equal(keccak('').toString('hex'), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    assert.equal(keccak('abc').toString('hex'), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  });
  test('addresses come out right, including the known one for private key 1', () => {
    assert.equal(makeSigner('0x0000000000000000000000000000000000000000000000000000000000000001').address, '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
    assert.equal(toChecksum('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'), '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
  });
  test('accepts a signature made by a real wallet tool (Foundry cast), and only for its own message', () => {
    const sig = '0x0798856290b3d753c7d01631f5e616aa93b1939fe6b7c88733a58e96e5b9c66c4774106f3cc77c39a29637e639a0c8b5e30e95d6b55c90fc56948a8d3b7b8d411c', addr = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
    assert.equal(verifyEvm('Trayfarers test vector', sig, addr), true);
    assert.equal(verifyEvm('Trayfarers test vector', sig, addr.toUpperCase().replace('0X', '0x')), true);
    assert.equal(verifyEvm('Trayfarers test vector!', sig, addr), false);
    assert.equal(verifyEvm('Trayfarers test vector', sig, '0x0000000000000000000000000000000000000001'), false);
  });
  test('garbage signatures are refused, never thrown', () => {
    const addr = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
    for (const bad of [null, 5, '', '0x', '0x12', 'zz', '0x' + '00'.repeat(65), '0x' + 'ff'.repeat(65), {}]) assert.equal(verifyEvm('hello', bad, addr), false);
    for (const bad of [null, 5, '', 'not base64', 'A'.repeat(90), {}]) assert.equal(verifySolana('hello', bad, '11111111111111111111111111111111'), false);
  });
  test('address checks', () => {
    assert.equal(isEvmAddress('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'), true);
    for (const bad of [null, '', '0x12', '7e5f4552091a69125d5dfcb7b8c2659029395bdf', '0x7e5f4552091a69125d5dfcb7b8c2659029395bdg']) assert.equal(isEvmAddress(bad), false);
    assert.equal(base58Decode('11111111111111111111111111111111').length, 32);
    assert.equal(isSolanaAddress('11111111111111111111111111111111'), true);
    for (const bad of [null, '', 'O0Il', '111']) assert.equal(isSolanaAddress(bad), false);
  });
  test('Solana signatures verify, and only for the right wallet and message', () => {
    const a = solWallet(), b = solWallet(), sig = a.sign('hello');
    assert.equal(verifySolana('hello', sig, a.address), true);
    assert.equal(verifySolana('hello!', sig, a.address), false);
    assert.equal(verifySolana('hello', sig, b.address), false);
  });
});

describe('live token settings', () => {
  const good = { DND_TOKEN: '0x' + '1'.repeat(40), DND_VAULT: '0x' + '2'.repeat(40), DND_VOUCHER_KEY: '0x' + '3'.repeat(64), DND_START_BLOCK: '100' };
  test('no settings means test mode', () => assert.equal(readChainEnv({}), null));
  test('half-finished settings stop the server instead of running wrongly', () => {
    for (const k of Object.keys(good)) { const env = { ...good }; delete env[k]; assert.throws(() => readChainEnv(env), new RegExp(k)); }
    assert.throws(() => readChainEnv({ ...good, DND_TOKEN: 'nope' }));
    assert.throws(() => readChainEnv({ ...good, DND_START_BLOCK: 'latest' }));
    assert.throws(() => readChainEnv({ ...good, DND_FINALITY: 'soon' }));
    assert.throws(() => readChainEnv({ ...good, DND_TREASURY: 'nope' }));
  });
  test('full settings point at Robinhood Chain and wait for the safe block', () => {
    const c = readChainEnv(good);
    assert.equal(c.chainId, 4663);
    assert.equal(c.finality, 'safe');
    assert.equal(c.startBlock, 100);
  });
});

describe('signing in with a wallet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wallet-'));
  const clock = { t: 1.9e12 };
  let app, base;
  before(async () => {
    app = createApp({ dbPath: join(dir, 'w.db'), now: () => clock.t, rates: OPEN_RATES, config: { PEER_MIN_AGE_MS: 0 }, publicOrigin: 'https://game.example' });
    base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;
  });
  after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const client = () => {
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, data };
    };
    return {
      call, post: (p, b = {}) => call('POST', p, b), get: p => call('GET', p),
      sync: () => call('POST', '/api/sync', {}),
      guest: () => call('POST', '/api/guest', {}),
      async start(w, purpose) { return (await call('POST', '/api/wallet/challenge', { kind: w.kind, address: w.address, purpose })).data; },
      async signIn(w) { const c = await this.start(w); return call('POST', '/api/wallet/verify', { nonce: c.nonce, signature: w.sign(c.message) }); },
      async unlink(w) { const c = await this.start(w, 'unlink'); return call('POST', '/api/wallet/unlink', { nonce: c.nonce, signature: w.sign(c.message) }); },
    };
  };
  const clean = () => assert.deepEqual(runAudit(app.store, clock.t).violations, []);

  test('a new wallet starts a saved crew, and comes back to the same one anywhere', async () => {
    const w = evmWallet();
    const first = await client().signIn(w);
    assert.equal(first.status, 200);
    assert.equal(first.data.account.guest, false);
    assert.equal(first.data.account.wallets.evm.address, w.address);
    const again = await client().signIn(w);
    assert.equal(again.status, 200);
    assert.equal(again.data.G.seed, first.data.G.seed);
    clean();
  });
  test('the message tells the wallet exactly who is asking, in the standard form', async () => {
    const w = evmWallet(), { message } = await client().start(w);
    const lines = message.split('\n');
    assert.equal(lines[0], 'game.example wants you to sign in with your Ethereum account:');
    assert.equal(lines[1], toChecksum(w.address));
    assert.match(message, /cannot move your funds/);
    assert.match(message, /URI: https:\/\/game\.example/);
    assert.match(message, /Version: 1/);
    assert.match(message, /Chain ID: 4663/);
    assert.match(message, /Nonce: [0-9a-f]{32}/);
    assert.match(message, /Issued At: \d{4}-/);
  });
  test('a guest who connects keeps their crew and becomes a saved player', async () => {
    const c = client(), w = evmWallet();
    const seed = (await c.guest()).data.G.seed;
    const r = await c.signIn(w);
    assert.equal(r.data.G.seed, seed);
    assert.equal(r.data.account.guest, false);
    clean();
  });
  test('Phantom-style Solana wallets sign in too, and one crew can hold both kinds', async () => {
    const c = client(), sol = solWallet(), evm = evmWallet();
    const a = await c.signIn(sol);
    assert.equal(a.status, 200);
    assert.equal(a.data.account.wallets.sol.address, sol.address);
    const b = await c.signIn(evm);
    assert.equal(b.status, 200);
    assert.equal(b.data.G.seed, a.data.G.seed);
    assert.deepEqual(Object.keys(b.data.account.wallets).sort(), ['evm', 'sol']);
    assert.equal((await client().signIn(sol)).data.G.seed, a.data.G.seed);
  });
  test('a signature works once', async () => {
    const c = client(), w = evmWallet(), ch = await c.start(w), signature = w.sign(ch.message);
    assert.equal((await c.post('/api/wallet/verify', { nonce: ch.nonce, signature })).status, 200);
    assert.equal((await client().post('/api/wallet/verify', { nonce: ch.nonce, signature })).status, 401);
  });
  test('someone else cannot claim your wallet, and a failed try burns the challenge', async () => {
    const victim = evmWallet(), thief = evmWallet(), c = client(), ch = await c.start(victim);
    const stolen = await c.post('/api/wallet/verify', { nonce: ch.nonce, signature: thief.sign(ch.message) });
    assert.equal(stolen.status, 401);
    assert.equal(stolen.data.code, 'bad_signature');
    assert.equal((await c.post('/api/wallet/verify', { nonce: ch.nonce, signature: victim.sign(ch.message) })).status, 401);
    assert.equal(app.store.getWallet(victim.address), undefined);
  });
  test('a signature for a different message is refused', async () => {
    const w = evmWallet(), c = client(), ch = await c.start(w);
    assert.equal((await c.post('/api/wallet/verify', { nonce: ch.nonce, signature: w.sign(ch.message + ' ') })).status, 401);
  });
  test('challenges expire', async () => {
    const w = evmWallet(), c = client(), ch = await c.start(w), signature = w.sign(ch.message);
    clock.t += 6 * 60e3;
    const r = await c.post('/api/wallet/verify', { nonce: ch.nonce, signature });
    assert.equal(r.status, 401);
    assert.equal(r.data.code, 'challenge_expired');
  });
  test('a saved crew cannot take over a wallet that belongs to another crew', async () => {
    const w = evmWallet(), other = evmWallet(), owner = client(), c = client();
    await owner.signIn(w);
    const ownerId = app.store.getWallet(w.address).account_id;
    await c.signIn(other);
    const r = await c.signIn(w);
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'wallet_elsewhere');
    assert.equal(app.store.getWallet(w.address).account_id, ownerId);
  });
  test('a guest connecting a known wallet moves to that wallet\'s crew', async () => {
    const w = evmWallet(), seed = (await client().signIn(w)).data.G.seed, c = client();
    await c.guest();
    assert.equal((await c.signIn(w)).data.G.seed, seed);
    assert.equal((await c.sync()).data.G.seed, seed);
  });
  test('one crew cannot quietly swap in a second payout wallet', async () => {
    const c = client();
    await c.signIn(evmWallet());
    const r = await c.signIn(evmWallet());
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'wallet_taken');
  });
  test('unlinking needs a signature from that wallet, and never locks you out', async () => {
    const c = client(), w = evmWallet(), sol = solWallet();
    await c.signIn(w);
    const only = await c.unlink(w);
    assert.equal(only.status, 409);
    assert.equal(only.data.code, 'only_login');
    await c.signIn(sol);
    const stranger = evmWallet();
    assert.equal((await c.unlink(stranger)).status, 403);
    const signin = await c.start(w);
    assert.equal((await c.post('/api/wallet/unlink', { nonce: signin.nonce, signature: w.sign(signin.message) })).status, 400, 'a sign-in signature cannot unlink');
    const ok = await c.unlink(w);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.account.wallets.evm, undefined);
  });
  test('unlinking needs a session', async () => {
    const w = evmWallet(), a = client();
    await a.signIn(w);
    const r = await client().unlink(w);
    assert.equal(r.status, 401);
  });
  test('banned wallets stay out', async () => {
    const w = evmWallet(), r = await client().signIn(w);
    assert.equal(r.status, 200);
    app.game.ban(app.store.getWallet(w.address).account_id, 'test');
    const again = await client().signIn(w);
    assert.equal(again.status, 403);
    assert.equal(again.data.code, 'banned');
  });
  test('hostile input gets a clean refusal, never a crash', async () => {
    const c = client();
    for (const body of [{}, { kind: 'evm' }, { kind: 'btc', address: 'x' }, { kind: 'evm', address: 'nope' }, { kind: 'evm', address: { a: 1 } }, { kind: 'sol', address: '0x12' }, { kind: 'evm', address: '0x' + '1'.repeat(40), purpose: 'steal' }]) {
      assert.equal((await c.post('/api/wallet/challenge', body)).status, 400, JSON.stringify(body));
    }
    for (const body of [{}, { nonce: 5 }, { nonce: '../etc', signature: 'x' }, { nonce: 'a'.repeat(32), signature: { x: 1 } }, { nonce: "' OR 1=1 --", signature: 'x' }]) {
      const r = await c.post('/api/wallet/verify', body);
      assert.ok(r.status === 400 || r.status === 401, JSON.stringify(body));
    }
  });
  test('in test mode withdrawals stay closed and nothing leaks', async () => {
    const c = client();
    await c.signIn(evmWallet());
    const r = await c.post('/api/action', { type: 'withdraw', args: { whole: 10 } });
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'desk_closed');
    const pub = await c.get('/api/chain');
    assert.equal(pub.data.live, false);
    assert.equal(pub.data.chainId, 4663);
    assert.ok(!JSON.stringify(pub.data).match(/key|secret/i));
    clean();
  });
});
