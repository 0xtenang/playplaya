// The whole money path against the real contracts, on a private throwaway chain. Needs Foundry.
// Run it with npm run test:chain. Nothing here can touch a public network: the node is a local
// anvil process, and these are its well-known test keys, which hold nothing anywhere real.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { runAudit } from '../server/audit.mjs';
import { encodeClaim, keccak, makeSigner, rpcClient, selector } from '../server/chain.mjs';

const PORT = 18545, RPC = `http://127.0.0.1:${PORT}`, UNIT = 10n ** 18n;
const env = { ...process.env, PATH: `${homedir()}/.foundry/bin:${process.env.PATH}` };
const ANVIL = {
  owner: ['0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'],
  alice: ['0x70997970c51812dc3a010c7d01b50e0d17dc79c8'],
  bob: ['0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc'],
  carol: ['0x90f79bf6eb2c4f870365e785982e1f101e93b906'],
  dave: ['0x15d34aaf54267db7d7c367839aaf71a00a2c6a65'],
  erin: ['0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc'],
  frank: ['0x976ea74026e726554db657fa54763abd0c3a0aa9'],
};
const rpc = rpcClient(RPC);
const words = (...xs) => xs.map(x => (typeof x === 'string' ? x.replace(/^0x/, '') : x.toString(16)).padStart(64, '0')).join('');
// The node accepts a transaction a moment before it is mined, so wait for the receipt.
const receiptOf = async hash => {
  for (let i = 0; i < 200; i++) {
    const r = await rpc.call('eth_getTransactionReceipt', [hash]);
    if (r) return r;
    await new Promise(res => setTimeout(res, 10));
  }
  throw new Error(`no receipt for ${hash}`);
};
const send = async (from, to, data) => receiptOf(await rpc.call('eth_sendTransaction', [{ from, to, data }]));
const deployed = (contract, args) => {
  const out = execFileSync('forge', ['create', '--offline', '--broadcast', '--rpc-url', RPC, '--private-key', ANVIL.owner[1], `contracts/src/${contract}.sol:${contract}`, '--constructor-args', ...args], { env, encoding: 'utf8' });
  return out.match(/Deployed to: (0x[0-9a-fA-F]{40})/)[1].toLowerCase();
};
const mine = async (n = 1) => { for (let i = 0; i < n; i++) await rpc.call('evm_mine'); };
const chainTime = async () => Number((await rpc.call('eth_getBlockByNumber', ['latest', false])).timestamp);

describe('DND on a private chain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dnd-'));
  const signerKey = '0x' + randomBytes(32).toString('hex'), signer = makeSigner(signerKey);
  let anvil, token, vault, app, base;
  const clock = { offset: 0, now: () => Date.now() + clock.offset };
  const clients = {};

  const client = () => {
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, data: await res.json().catch(() => null) };
    };
    return { call, post: (p, b = {}) => call('POST', p, b), get: p => call('GET', p), sync: () => call('POST', '/api/sync', {}), act: (type, args = {}) => call('POST', '/api/action', { type, args }) };
  };
  const signIn = async (who, address) => {
    const c = client(), ch = (await c.post('/api/wallet/challenge', { kind: 'evm', address })).data;
    const signature = await rpc.call('personal_sign', ['0x' + Buffer.from(ch.message).toString('hex'), address]);
    const r = await c.post('/api/wallet/verify', { nonce: ch.nonce, signature });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    clients[who] = c;
    return c;
  };
  const balanceOf = async a => BigInt(await rpc.call('eth_call', [{ to: token, data: selector('balanceOf(address)') + words(a) }, 'latest'])) / UNIT;
  const approveAndDeposit = async (from, whole) => {
    await send(from, token, selector('approve(address,uint256)') + words(vault, BigInt(whole) * UNIT));
    return send(from, vault, selector('deposit(uint256)') + words(BigInt(whole)));
  };
  const give = (to, whole) => send(ANVIL.owner[0], token, selector('transfer(address,uint256)') + words(to, BigInt(whole) * UNIT));
  const marks = async c => (await c.sync()).data.G.marks;
  const clean = () => assert.deepEqual(runAudit(app.store, clock.now()).violations, []);
  const claim = (from, data) => send(from, vault, data).catch(e => ({ status: '0x0', error: e.message }));

  before(async () => {
    anvil = spawn('anvil', ['--port', String(PORT), '--chain-id', '4663', '--silent'], { env, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      try { await rpc.call('eth_chainId'); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    execFileSync('forge', ['build', '--offline'], { env, stdio: 'ignore' });
    token = deployed('DNDToken', ['1000000', ANVIL.owner[0]]);
    vault = deployed('DNDVault', [token, ANVIL.owner[0], signer.address, '5000']);
    app = createApp({
      dbPath: join(dir, 'd.db'), now: clock.now, watchChain: false,
      rates: { auth: [1e6, 1e6], guest: [1e6, 1e6], action: [1e6, 1e6], sync: [1e6, 1e6], read: [1e6, 1e6] },
      config: {
        PEER_MIN_AGE_MS: 0, WITHDRAW_MIN_AGE_MS: 0, WALLET_COOLDOWN_MS: 0, DRIFTER_MIN_AGE_MS: 0, WITHDRAW_ACCOUNT_DAILY: 300, WITHDRAW_GLOBAL_DAILY: 2000,
        CHAIN: { chainId: 4663, name: 'Local', currency: 'ETH', rpc: RPC, publicRpc: RPC, explorer: '', token, vault, signerKey, treasury: ANVIL.owner[0], startBlock: 0, finality: 0, pollMs: 1e6 },
      },
    });
    base = `http://127.0.0.1:${await app.listen(0, '127.0.0.1')}`;
    await app.game.desk.poll();
  });
  after(async () => {
    if (app) await app.close();
    if (anvil) anvil.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  test('the server confirms the chain, the vault and its signing key before opening', () => {
    assert.equal(app.game.desk.state.setupError, null);
    assert.equal(app.game.desk.state.ready, true);
  });
  test('the public settings hold addresses, never a key', async () => {
    const pub = (await client().get('/api/chain')).data;
    assert.equal(pub.live, true);
    assert.equal(pub.vault, vault);
    assert.ok(!JSON.stringify(pub).includes(signerKey.slice(2)));
  });
  test('the voucher digest here matches the one the contract computes', async () => {
    const f = { to: ANVIL.alice[0], whole: 12, nonce: '0x' + '11'.repeat(32), expiry: 1999999999 };
    const onChain = await rpc.call('eth_call', [{ to: vault, data: selector('claimDigest(address,uint256,bytes32,uint256)') + words(f.to, 12n, f.nonce, 1999999999n) }, 'latest']);
    const { claimPreimage } = await import('../server/chain.mjs');
    assert.equal(onChain, '0x' + keccak(claimPreimage({ chainId: 4663, vault, ...f })).toString('hex'));
  });
  test('a new crew starts with no DND at all', async () => {
    const c = client();
    const r = await c.post('/api/guest');
    assert.equal(r.data.G.marks, 0);
    assert.equal(r.data.account.live, true);
    clean();
  });
  test('the treasury funds the drifters purse, not any player', async () => {
    await approveAndDeposit(ANVIL.owner[0], 1000);
    await app.game.desk.poll();
    assert.equal(app.store.ledgerBalance('system:drifters'), 1000);
    clean();
  });
  test('a deposit is credited exactly once, however many times the chain is scanned', async () => {
    await give(ANVIL.alice[0], 2000);
    const a = await signIn('alice', ANVIL.alice[0]);
    assert.equal(await marks(a), 0);
    await approveAndDeposit(ANVIL.alice[0], 500);
    await app.game.desk.poll();
    assert.equal(await marks(a), 500);
    assert.equal(await balanceOf(ANVIL.alice[0]), 1500n);
    app.store.setChainCursor(-1);
    await app.game.desk.poll();
    await app.game.desk.poll();
    assert.equal(await marks(a), 500, 'a rescan must not credit twice');
    clean();
  });
  test('a deposit from an unlinked wallet waits, then lands when the wallet is linked', async () => {
    await give(ANVIL.bob[0], 100);
    await approveAndDeposit(ANVIL.bob[0], 40);
    await app.game.desk.poll();
    assert.equal(app.store.heldTotal(), 40);
    const b = await signIn('bob', ANVIL.bob[0]);
    assert.equal(await marks(b), 40);
    assert.equal(app.store.heldTotal(), 0);
    clean();
  });
  test('tokens sent straight to the vault credit nobody, and the books stay right', async () => {
    const before = app.store.creditedTotal();
    await send(ANVIL.alice[0], token, selector('transfer(address,uint256)') + words(vault, 3n * UNIT));
    await app.game.desk.poll();
    assert.equal(app.store.creditedTotal(), before);
    clean();
  });
  test('a withdrawal debits at once, pays on claim, settles, and cannot be claimed twice', async () => {
    const a = clients.alice;
    const r = await a.act('withdraw', { whole: 100 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.G.marks, 400);
    clean();
    const v = r.data.result.voucher, before = await balanceOf(ANVIL.alice[0]);
    const receipt = await claim(ANVIL.alice[0], v.data);
    assert.equal(receipt.status, '0x1');
    assert.equal(await balanceOf(ANVIL.alice[0]), before + 100n);
    await app.game.desk.poll();
    assert.equal(app.store.getWithdrawal(v.id).status, 'claimed');
    assert.equal(await marks(a), 400);
    const again = await claim(ANVIL.alice[0], v.data);
    assert.notEqual(again.status, '0x1');
    assert.equal(await balanceOf(ANVIL.alice[0]), before + 100n);
    clean();
  });
  test('anyone may submit a voucher, but it only ever pays the linked wallet', async () => {
    const a = clients.alice;
    const v = (await a.act('withdraw', { whole: 20 })).data.result.voucher;
    const before = await balanceOf(ANVIL.alice[0]), strangerBefore = await balanceOf(ANVIL.carol[0]);
    assert.equal((await claim(ANVIL.carol[0], v.data)).status, '0x1');
    assert.equal(await balanceOf(ANVIL.alice[0]), before + 20n);
    assert.equal(await balanceOf(ANVIL.carol[0]), strangerBefore);
    await app.game.desk.poll();
    clean();
  });
  test('every withdrawal rule holds', async () => {
    const a = clients.alice, code = async whole => (await a.act('withdraw', { whole })).data.code;
    assert.equal(await code(5), 'too_small');
    assert.equal(await code(1e6), 'not_enough');
    assert.equal(await code(-5), 'bad_request');
    assert.equal(await code(1.5), 'bad_request');
    assert.equal((await a.act('withdraw', { whole: '50' })).data.code, 'bad_request');
    const open = (await a.act('withdraw', { whole: 10 })).data.result.voucher;
    assert.equal(await code(10), 'voucher_open');
    await claim(ANVIL.alice[0], open.data);
    await app.game.desk.poll();
    assert.equal(await code(290), 'account_limit');
    assert.equal((await client().post('/api/action', { type: 'withdraw', args: { whole: 10 } })).status, 401);
    clean();
  });
  test('a sign-in with no Ethereum wallet has nowhere to be paid', async () => {
    const c = client();
    await c.post('/api/guest');
    assert.equal((await c.act('withdraw', { whole: 10 })).data.code, 'no_wallet');
  });
  test('waiting periods block a stolen session from cashing out', async () => {
    const cfg = app.game.cfg, saved = [cfg.WITHDRAW_MIN_AGE_MS, cfg.WALLET_COOLDOWN_MS];
    await give(ANVIL.dave[0], 100);
    const d = await signIn('dave', ANVIL.dave[0]);
    await approveAndDeposit(ANVIL.dave[0], 50);
    await app.game.desk.poll();
    cfg.WITHDRAW_MIN_AGE_MS = 24 * 3600e3;
    assert.equal((await d.act('withdraw', { whole: 10 })).data.code, 'too_new');
    cfg.WITHDRAW_MIN_AGE_MS = 0; cfg.WALLET_COOLDOWN_MS = 72 * 3600e3;
    assert.equal((await d.act('withdraw', { whole: 10 })).data.code, 'wallet_cooldown');
    [cfg.WITHDRAW_MIN_AGE_MS, cfg.WALLET_COOLDOWN_MS] = saved;
  });
  test('an unclaimed voucher is refunded only after the chain has passed its expiry', async () => {
    const d = clients.dave;
    const v = (await d.act('withdraw', { whole: 15 })).data.result.voucher;
    assert.equal(await marks(d), 35);
    await app.game.desk.poll();
    assert.equal(app.store.getWithdrawal(v.id).status, 'open', 'not expired yet');
    const late = v.expiry - (await chainTime()) + 10;
    await rpc.call('evm_increaseTime', [late]);
    await mine();
    await app.game.desk.poll();
    assert.equal(app.store.getWithdrawal(v.id).status, 'open', 'expired, but the safety margin has not passed');
    assert.notEqual((await claim(ANVIL.dave[0], v.data)).status, '0x1', 'the vault refuses it now');
    await rpc.call('evm_increaseTime', [app.game.cfg.REFUND_MARGIN_S + 10]);
    await mine();
    await app.game.desk.poll();
    assert.equal(app.store.getWithdrawal(v.id).status, 'refunded');
    assert.equal(await marks(d), 50);
    clean();
    // The chain's clock jumped ahead, so the game's clock follows it for the tests after this.
    clock.offset = (await chainTime()) * 1000 - Date.now();
  });
  test('a chain reorganisation cannot create money: unconfirmed deposits wait, and vanish if undone', async () => {
    const C = app.game.cfg.CHAIN;
    C.finality = 3;
    await mine(4);
    await app.game.desk.poll();
    await give(ANVIL.erin[0], 100);
    const e = await signIn('erin', ANVIL.erin[0]);
    const snap = await rpc.call('evm_snapshot');
    await approveAndDeposit(ANVIL.erin[0], 30);
    await app.game.desk.poll();
    assert.equal(await marks(e), 0, 'too few confirmations');
    await rpc.call('evm_revert', [snap]);
    await mine(6);
    await app.game.desk.poll();
    assert.equal(await marks(e), 0, 'that deposit never really happened');
    await approveAndDeposit(ANVIL.erin[0], 30);
    await mine(5);
    await app.game.desk.poll();
    assert.equal(await marks(e), 30);
    C.finality = 0;
    clean();
  });
  test('drifters only pay from their purse, within the daily cap, and only linked crews', async () => {
    const desk = app.game.desk, t = clock.now();
    const purse = app.store.ledgerBalance('system:drifters');
    const alice = app.store.getWallet(ANVIL.alice[0]).account_id;
    assert.equal(desk.drifterAllowance(alice, t), Math.min(purse, app.game.cfg.DRIFTER_DAILY_CAP));
    const g = client(), acct = (await g.post('/api/guest')).data;
    assert.equal(acct.account.guest, true);
    const guestId = app.store.q('SELECT id FROM accounts WHERE guest = 1 ORDER BY created_at DESC LIMIT 1').get().id;
    assert.equal(desk.drifterAllowance(guestId, t), 0);
    const cap = app.game.cfg.DRIFTER_DAILY_CAP;
    app.game.cfg.DRIFTER_DAILY_CAP = 0;
    assert.equal(desk.drifterAllowance(alice, t), 0);
    app.game.cfg.DRIFTER_DAILY_CAP = cap;
    const held = purse;
    assert.ok(desk.drifterAllowance(alice, t) <= held);
  });
  test('the founder share pays out through the same limits', async () => {
    assert.throws(() => app.game.desk.payOutSystem('system:drifters', ANVIL.frank[0], 1));
    assert.throws(() => app.game.desk.payOutSystem('system:founder', 'nope', 1));
    assert.throws(() => app.game.desk.payOutSystem('system:founder', ANVIL.frank[0], 1e9));
  });
  test('the vault can always pay what the game owes', async () => {
    const r = await app.game.desk.reconcile(false);
    assert.ok(BigInt(r.surplus) >= 0n, JSON.stringify(r));
    assert.equal(BigInt(r.surplus), 3n, 'exactly the tokens sent straight to the vault');
    clean();
  });
  test('the vault\'s own daily limit stops a voucher the server would allow', async () => {
    const cfg = app.game.cfg;
    const saved = [cfg.WITHDRAW_ACCOUNT_DAILY, cfg.WITHDRAW_GLOBAL_DAILY];
    await send(ANVIL.owner[0], vault, selector('setDailyLimit(uint256)') + words(1n));
    cfg.WITHDRAW_ACCOUNT_DAILY = 1e6; cfg.WITHDRAW_GLOBAL_DAILY = 1e6;
    const a = clients.alice;
    const v = (await a.act('withdraw', { whole: 10 })).data.result.voucher;
    const before = await balanceOf(ANVIL.alice[0]);
    assert.notEqual((await claim(ANVIL.alice[0], v.data)).status, '0x1');
    assert.equal(await balanceOf(ANVIL.alice[0]), before);
    await send(ANVIL.owner[0], vault, selector('setDailyLimit(uint256)') + words(5000n));
    assert.equal((await claim(ANVIL.alice[0], v.data)).status, '0x1');
    await app.game.desk.poll();
    [cfg.WITHDRAW_ACCOUNT_DAILY, cfg.WITHDRAW_GLOBAL_DAILY] = saved;
    clean();
  });
  test('a paused vault closes the desk', async () => {
    await send(ANVIL.owner[0], vault, selector('setPaused(bool)') + words(1n));
    await app.game.desk.poll();
    assert.equal((await clients.alice.act('withdraw', { whole: 10 })).data.code, 'desk_closed');
    await send(ANVIL.owner[0], vault, selector('setPaused(bool)') + words(0n));
    await app.game.desk.poll();
    clean();
  });
  test('the server refuses to open against the wrong signer or chain', async () => {
    await send(ANVIL.owner[0], vault, selector('setSigner(address)') + words(ANVIL.frank[0]));
    await app.game.desk.poll();
    assert.match(app.game.desk.state.lastError || '', /trusts signer/);
    await send(ANVIL.owner[0], vault, selector('setSigner(address)') + words(signer.address));
    await app.game.desk.poll();
    assert.equal(app.game.desk.state.lastError, null);
  });
  test('if the signing key leaks, the first forged payout stops all withdrawals', async () => {
    const forged = { to: ANVIL.frank[0], whole: 77, nonce: '0x' + randomBytes(32).toString('hex'), expiry: (await chainTime()) + 3600 };
    const sig = signer.signClaim({ chainId: 4663, vault, ...forged });
    assert.equal((await claim(ANVIL.frank[0], encodeClaim({ ...forged, ...sig }))).status, '0x1');
    await app.game.desk.poll();
    assert.equal((await clients.alice.act('withdraw', { whole: 10 })).data.code, 'desk_closed');
    const audit = runAudit(app.store, clock.now());
    assert.ok(audit.violations.some(v => v.kind === 'chain_alert' && /unknown_voucher/.test(v.detail)), JSON.stringify(audit.violations));
  });
  test('a database holding test money refuses to go live', () => {
    const scratch = join(dir, 'test-money.db');
    const test = createApp({ dbPath: scratch, watchChain: false });
    test.game.createAccount({ guest: true });
    test.store.close();
    assert.throws(() => createApp({ dbPath: scratch, watchChain: false, config: { CHAIN: { chainId: 4663, rpc: RPC, token, vault, signerKey, pollMs: 1e6, startBlock: 0, finality: 0 } } }), /holds test DND/);
  });
});
