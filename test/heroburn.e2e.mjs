// Buying heroes and runes by burning real tokens from the player's wallet, on a private chain. Most of
// this tries to get them without paying. Needs anvil from Foundry.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { T } from '../server/game.mjs';
import { runAudit } from '../server/audit.mjs';
import { rpcClient, selector } from '../server/chain.mjs';

const PORT = 18549, RPC = `http://127.0.0.1:${PORT}`, UNIT = 10n ** 18n, PRICE = 500000;
const env = { ...process.env, PATH: `${homedir()}/.foundry/bin:${process.env.PATH}` };
const OPEN = { auth: [1e6, 1e6], guest: [1e6, 1e6], action: [1e6, 1e6], sync: [1e6, 1e6], read: [1e6, 1e6] };
// Anvil's well-known test accounts, which hold nothing anywhere real.
const OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const A = { owner: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', alice: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', bob: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc', carol: '0x90f79bf6eb2c4f870365e785982e1f101e93b906', dave: '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65', erin: '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc' };
const rpc = rpcClient(RPC), word = v => (typeof v === 'string' ? v.replace(/^0x/, '') : v.toString(16)).padStart(64, '0');

describe('buying a hero with a direct burn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heroburn-'));
  let anvil, token, fake, app, base;
  const deployed = args => execFileSync('forge', ['create', '--offline', '--broadcast', '--rpc-url', RPC, '--private-key', OWNER_KEY, 'contracts/test/TestToken.sol:TestToken', '--constructor-args', ...args], { env, encoding: 'utf8' }).match(/Deployed to: (0x[0-9a-fA-F]{40})/)[1].toLowerCase();
  const send = async (from, to, data) => { const hash = await rpc.call('eth_sendTransaction', [{ from, to, data }]); for (let i = 0; i < 200; i++) { const r = await rpc.call('eth_getTransactionReceipt', [hash]); if (r) return { hash, status: r.status }; await new Promise(res => setTimeout(res, 25)); } throw new Error('no receipt'); };
  const give = (to, whole, t = token) => send(A.owner, t, selector('transfer(address,uint256)') + word(to) + word(BigInt(whole) * UNIT));
  const burn = (from, whole, t = token) => send(from, t, selector('burn(uint256)') + word(BigInt(whole) * UNIT));
  const supply = async () => BigInt(await rpc.call('eth_call', [{ to: token, data: selector('totalSupply()') }, 'latest'])) / UNIT;
  const balance = async a => BigInt(await rpc.call('eth_call', [{ to: token, data: selector('balanceOf(address)') + word(a) }, 'latest'])) / UNIT;
  const client = () => {
    let cookie = '';
    const call = async (path, body) => {
      const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
      const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return { status: res.status, data: await res.json() };
    };
    const dnd = async () => { const res = await fetch(`${base}/api/dnd`, { headers: { Cookie: cookie } }); return { status: res.status, data: await res.json() }; };
    return { call, dnd, rune: (rune, txHash) => call('/api/rune/claim', { rune, txHash }), claim: (hero, txHash) => call('/api/hero/claim', { hero, txHash }), sync: () => call('/api/sync', {}), act: (type, args = {}) => call('/api/action', { type, args }) };
  };
  const signIn = async address => {
    const c = client(), ch = (await c.call('/api/wallet/challenge', { kind: 'evm', address })).data;
    const signature = await rpc.call('personal_sign', ['0x' + Buffer.from(ch.message).toString('hex'), address]);
    assert.equal((await c.call('/api/wallet/verify', { nonce: ch.nonce, signature })).status, 200);
    return c;
  };
  const clean = () => assert.deepEqual(runAudit(app.store, Date.now()).violations, []);
  let alice, bob;

  before(async () => {
    anvil = spawn('anvil', ['--port', String(PORT), '--chain-id', '4663', '--silent'], { env, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { try { await rpc.call('eth_chainId'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    execFileSync('forge', ['build', '--offline'], { env, stdio: 'ignore' });
    token = deployed(['10000000', A.owner]);
    fake = deployed(['10000000', A.owner]);
    // The first node is down, so every check here also proves the game falls back to the next one.
    app = createApp({ dbPath: join(dir, 'b.db'), rates: OPEN, requireWallet: true, config: { PEER_MIN_AGE_MS: 0, HERO_BURN: { token, chainId: 4663, rpcs: ['http://127.0.0.1:9', RPC] } } });
    base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;
    for (const who of [A.alice, A.bob, A.carol]) await give(who, 3000000);
    alice = await signIn(A.alice);
    bob = await signIn(A.bob);
  });
  after(async () => { await app.close(); anvil.kill(); rmSync(dir, { recursive: true, force: true }); });

  test('a real burn from the linked wallet unlocks the hero, and the tokens are gone for good', async () => {
    const before = await supply(), held = await balance(A.alice);
    const { hash, status } = await burn(A.alice, PRICE);
    assert.equal(status, '0x1');
    const r = await alice.claim('fletcher', hash);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.G.owned, ['warden', 'fletcher']);
    assert.deepEqual(r.data.G.party, ['warden', 'fletcher']);
    assert.equal(await supply(), before - BigInt(PRICE));
    assert.equal(await balance(A.alice), held - BigInt(PRICE));
    assert.equal(r.data.heroBurn.chainId, 4663);
    clean();
  });
  test('the same burn cannot buy a second hero, or a hero for anyone else', async () => {
    const { hash } = await burn(A.alice, PRICE);
    assert.equal((await alice.claim('hexer', hash)).status, 200);
    const twice = await alice.claim('mender', hash);
    assert.equal(twice.status, 409);
    assert.equal(twice.data.code, 'burn_used');
    assert.equal((await bob.claim('hexer', hash)).status, 409);
    assert.deepEqual((await bob.sync()).data.G.owned, ['warden']);
    assert.equal((await alice.claim('hexer', hash)).status, 200, 'retrying the same claim after a dropped connection is harmless');
    assert.equal((await alice.sync()).data.G.owned.filter(h => h === 'hexer').length, 1);
  });
  test('someone else\'s burn proves nothing', async () => {
    const { hash } = await burn(A.carol, PRICE);
    const r = await bob.claim('fletcher', hash);
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'not_a_burn');
  });
  test('sending tokens anywhere but the zero address is not a burn', async () => {
    const { hash } = await send(A.bob, token, selector('transfer(address,uint256)') + word(A.dave) + word(BigInt(PRICE) * UNIT));
    assert.equal((await bob.claim('fletcher', hash)).data.code, 'not_a_burn');
  });
  test('burning a different token with the same name proves nothing', async () => {
    await give(A.bob, PRICE, fake);
    const { hash } = await burn(A.bob, PRICE, fake);
    assert.equal((await bob.claim('fletcher', hash)).data.code, 'not_a_burn');
  });
  test('a burn one token short is refused, and says what the price is', async () => {
    const { hash } = await burn(A.bob, PRICE - 1);
    const r = await bob.claim('fletcher', hash);
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'burn_short');
    assert.match(r.data.error, /500,000 DND/);
    assert.deepEqual((await bob.sync()).data.G.owned, ['warden']);
  });
  test('a transaction that failed on the chain, or never happened, buys nothing', async () => {
    const failed = await burn(A.erin, PRICE).catch(() => null);
    // Erin holds nothing, so the burn reverts. Anvil may refuse to include it at all.
    if (failed) { assert.equal(failed.status, '0x0'); assert.equal((await bob.claim('fletcher', failed.hash)).data.code, 'burn_failed'); }
    const r = await bob.claim('fletcher', '0x' + 'ab'.repeat(32));
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'burn_pending', 'an unknown transaction may simply not be mined yet');
  });
  test('nonsense is refused before anything touches the chain', async () => {
    for (const [hero, hash] of [['nobody', '0x' + 'ab'.repeat(32)], ['__proto__', '0x' + 'ab'.repeat(32)], ['fletcher', 'nope'], ['fletcher', 12], ['fletcher', null], ['fletcher', '0x' + 'zz'.repeat(32)]]) assert.equal((await bob.claim(hero, hash)).status, 400);
  });
  test('a hero you already own cannot be claimed again', async () => {
    const { hash } = await burn(A.alice, PRICE);
    const r = await alice.claim('fletcher', hash);
    assert.equal(r.status, 409);
    assert.match(r.data.error, /already in your crew/);
    assert.equal(app.store.getHeroBurn(hash.toLowerCase()), undefined, 'a refused claim is not recorded as spent');
  });
  test('a lower price applies at once, and test DND can never buy a hero', async () => {
    app.store.setMeta('hero_price', '100');
    const paid = await bob.act('buyHero', { hero: 'mender', price: 100 });
    assert.equal(paid.status, 409, 'test balances must not be able to pay');
    assert.equal(paid.data.code, 'burn_only');
    const { hash } = await burn(A.bob, 100);
    const r = await bob.claim('mender', hash);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.G.owned, ['warden', 'mender']);
    app.store.deleteMeta('hero_price');
  });
  test('a burn buys the next level of a rune, once, at that level\'s price', async () => {
    const def = T.talentDef('might'), first = T.runePrice(def, 0), second = T.runePrice(def, 1);
    const before = await supply(), { hash } = await burn(A.alice, first);
    const r = await alice.rune('might', hash);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.G.talents.might, 1);
    assert.equal(await supply(), before - BigInt(first));
    assert.equal(app.store.getHeroBurn(hash.toLowerCase()).hero, 'rune:might');
    const again = await alice.rune('might', hash);
    assert.equal(again.status, 200, 'a retry of the same claim gets the crew back');
    assert.equal(again.data.G.talents.might, 1, 'and adds nothing');
    for (const other of [await alice.rune('grit', hash), await alice.claim('hexer', hash), await bob.rune('might', hash)]) {
      assert.equal(other.status, 409);
      assert.equal(other.data.code, 'burn_used');
    }
    const old = await burn(A.alice, first), short = await alice.rune('might', old.hash);
    assert.equal(short.status, 409, 'the first price does not buy the second level');
    assert.equal(short.data.code, 'burn_short');
    assert.equal(app.store.getHeroBurn(old.hash.toLowerCase()), undefined);
    const next = await burn(A.alice, second), up = await alice.rune('might', next.hash);
    assert.equal(up.status, 200, JSON.stringify(up.data));
    assert.equal(up.data.G.talents.might, 2);
    clean();
  });
  test('a rune cannot be bought with test DND, with a fake token, or past its top level', async () => {
    const paid = await alice.act('talent', { k: 'grit' });
    assert.equal(paid.status, 409);
    assert.equal(paid.data.code, 'burn_only');
    const price = T.runePrice(T.talentDef('grit'), 0);
    await give(A.alice, price, fake);
    const f = await burn(A.alice, price, fake), bad = await alice.rune('grit', f.hash);
    assert.equal(bad.status, 409);
    assert.equal(bad.data.code, 'not_a_burn');
    for (const [rune, hash] of [['none', f.hash], ['__proto__', f.hash], ['grit', 'nope'], [7, f.hash]]) assert.equal((await alice.rune(rune, hash)).status, 400);
    const def = T.talentDef('auto'), one = T.runePrice(def, 0);
    for (let i = 0; i < def.max; i++) assert.equal((await bob.rune('auto', (await burn(A.bob, T.runePrice(def, i))).hash)).status, 200);
    const over = await burn(A.bob, one), top = await bob.rune('auto', over.hash);
    assert.equal(top.status, 409);
    assert.equal(top.data.code, 'rejected');
    assert.equal(app.store.getHeroBurn(over.hash.toLowerCase()), undefined);
    clean();
  });
  test('a lower rune scale applies at once', async () => {
    app.store.setMeta('rune_scale', '1');
    const price = T.runePrice(T.talentDef('xp'), 0, 1), { hash } = await burn(A.bob, price), r = await bob.rune('xp', hash);
    app.store.deleteMeta('rune_scale');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.G.talents.xp, 1);
    assert.equal(r.data.runeScale, 1, 'players are told the price in force');
  });
  test('the top bar reads the real balance of the linked wallet and nobody else\'s', async () => {
    const carol = await signIn(A.carol), held = Number(await balance(A.carol));
    assert.deepEqual((await carol.dnd()).data, { wallet: held });
    await burn(A.carol, 1000);
    assert.equal((await carol.dnd()).data.wallet, held, 'a brief cache is fine, since this only shows a figure');
    const price = T.runePrice(T.talentDef('pack'), 0), { hash } = await burn(A.carol, price);
    assert.equal((await carol.rune('pack', hash)).status, 200);
    assert.equal((await carol.dnd()).data.wallet, held - 1000 - price, 'but a purchase refreshes it at once');
    assert.equal((await client().dnd()).status, 401);
  });
  test('the burned total comes from the token itself', async () => {
    const res = await fetch(`${base}/api/chain`, { headers: { Cookie: '' } }), cfg = await res.json();
    assert.equal(typeof cfg.burnedOnChain, 'number');
    assert.ok(!JSON.stringify(cfg).match(/rpcs|signerKey|secret/i));
    const stats = runAudit(app.store, Date.now()).stats.heroBurns;
    assert.ok(stats.purchases >= 3);
    clean();
  });
});
