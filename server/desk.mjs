// Wallets and the cash desk. Wallets prove who someone is. The desk moves DND between the game's
// ledger and the vault contract. Every whole DND in a live game entered through the vault, so
// the ledger can always be checked against the chain.
import { randomBytes } from 'node:crypto';
import { BURNED, CLAIMED, DEPOSITED, ROBINHOOD, encodeBurn, encodeClaim, isEvmAddress, isHash32, isSolanaAddress, makeSigner, rpcClient, selector, toChecksum, topicAddress, verifyEvm, verifySolana } from './chain.mjs';

export const DESK_DEFAULTS = {
  CHALLENGE_LIFE_MS: 5 * 60e3,
  WITHDRAW_MIN: 10,                     // smallest withdrawal, in whole DND
  WITHDRAW_ACCOUNT_DAILY: 1000,         // per account, per UTC day
  WITHDRAW_GLOBAL_DAILY: 20000,         // all accounts, per UTC day. Keep it below the vault's own limit.
  WITHDRAW_MIN_AGE_MS: 24 * 3600e3,     // a new account waits this long before its first withdrawal
  WALLET_COOLDOWN_MS: 72 * 3600e3,      // a stolen session cannot link a wallet and cash out at once
  VOUCHER_LIFE_S: 24 * 3600,
  REFUND_MARGIN_S: 300,                 // extra wait past expiry, before an unused voucher is refunded
  BURN_MIN: 50,                         // smallest batch worth a burn voucher, in whole DND
  DRIFTER_DAILY_CAP: 200,               // the most drifters pay one crew per UTC day, in whole DND
  DRIFTER_MIN_AGE_MS: 24 * 3600e3,
  LOG_RANGE: 2000,
};
const MAX_WHOLE = Number.MAX_SAFE_INTEGER;
const dayStart = t => t - (t % 86400e3);
const hex = n => '0x' + n.toString(16);
// Every DND spent in the game lands in BURN. A voucher moves a batch to BURNING until the chain
// confirms it is destroyed. BURN_TO only fills the voucher table's address column.
const BURN = 'system:burn', BURNING = 'system:burning', BURN_TO = '0x000000000000000000000000000000000000dead';

// ---------------------------------------------------------------- wallets
export function createWallets({ store, cfg, now, GameError, createAccount, afterLink }) {
  const fail = (msg, status = 400, code = 'bad_wallet') => new GameError(msg, status, code);
  function challenge({ kind, address, purpose = 'signin', domain, origin }) {
    if (kind !== 'evm' && kind !== 'sol') throw fail('Unknown wallet type.');
    if (purpose !== 'signin' && purpose !== 'unlink') throw fail('That request is not valid.');
    if (kind === 'evm' ? !isEvmAddress(address) : !isSolanaAddress(address)) throw fail('That is not a valid wallet address.');
    const t = now(), nonce = randomBytes(16).toString('hex'), shown = kind === 'evm' ? toChecksum(address) : address;
    const statement = purpose === 'unlink' ? 'Unlink this wallet from your Trayfarers crew.' : 'Sign in to Trayfarers. This is free and cannot move your funds.';
    const message = `${domain} wants you to sign in with your ${kind === 'evm' ? 'Ethereum' : 'Solana'} account:\n${shown}\n\n${statement}\n\nURI: ${origin}\nVersion: 1\n` +
      (kind === 'evm' ? `Chain ID: ${(cfg.CHAIN || ROBINHOOD).chainId}\n` : '') + `Nonce: ${nonce}\nIssued At: ${new Date(t).toISOString()}`;
    store.pruneChallenges(t);
    store.insertChallenge(nonce, kind, kind === 'evm' ? address.toLowerCase() : address, purpose, message, t + cfg.CHALLENGE_LIFE_MS);
    return { nonce, message };
  }
  // A challenge works once, whatever the outcome, so a signature can never be replayed.
  function prove(nonce, signature, purpose) {
    if (typeof nonce !== 'string' || !/^[0-9a-f]{32}$/.test(nonce)) throw fail('That sign-in request is not valid.');
    const row = store.takeChallenge(nonce);
    if (!row || row.expires_at < now()) throw fail('That sign-in request has expired. Please try again.', 401, 'challenge_expired');
    if (row.purpose !== purpose) throw fail('That sign-in request is not valid.');
    const ok = row.kind === 'evm' ? verifyEvm(row.message, signature, row.address) : verifySolana(row.message, signature, row.address);
    if (!ok) throw fail('That signature does not match the wallet.', 401, 'bad_signature');
    return { kind: row.kind, address: row.address };
  }
  function link(accountId, kind, address, t) {
    if (store.walletOfKind(accountId, kind)) throw fail('This crew already has a wallet of that type. Unlink it first.', 409, 'wallet_taken');
    store.insertWallet(address, kind, accountId, t);
    store.setNotGuest(accountId);
    afterLink(accountId, address, t);
  }
  // Signs in or links, and returns the account the session should now belong to.
  function signIn(proof, current) {
    return store.tx(() => {
      const t = now(), row = store.getWallet(proof.address);
      if (current?.banned_at) throw fail('This account is banned.', 403, 'banned');
      if (row) {
        const owner = store.getAccount(row.account_id);
        if (owner.banned_at) throw fail(`This account is banned. ${owner.ban_reason || ''}`.trim(), 403, 'banned');
        // A guest's unsaved crew gives way to the wallet's real one. A saved crew is never swapped silently.
        if (current && current.id !== owner.id && !current.guest) throw fail('This wallet belongs to another crew. Log out first to switch to it.', 409, 'wallet_elsewhere');
        return owner.id;
      }
      if (current) { link(current.id, proof.kind, proof.address, t); return current.id; }
      const id = createAccount({ guest: false });
      link(id, proof.kind, proof.address, t);
      return id;
    });
  }
  function unlink(acct, proof, openVouchers) {
    store.tx(() => {
      const row = store.getWallet(proof.address);
      if (!row || row.account_id !== acct.id) throw fail('That wallet is not linked to this crew.', 403, 'not_yours');
      if (row.kind === 'evm' && openVouchers(acct.id)) throw fail('Finish or wait out your open withdrawal first.', 409, 'voucher_open');
      if (!acct.pass && store.walletsOf(acct.id).length < 2) throw fail('This wallet is your only way to log in. Set up another one first.', 409, 'only_login');
      store.deleteWallet(proof.address);
    });
  }
  return { challenge, prove, signIn, unlink };
}

// ---------------------------------------------------------------- cash desk
export function createDesk({ store, cfg, now, GameError, transfer, load, save, pushEvent, T }) {
  const C = cfg.CHAIN;
  const signer = C ? makeSigner(C.signerKey) : null;
  const rpc = C ? (C.client || rpcClient(C.rpc)) : null;
  const state = { ready: false, setupError: C ? 'Not checked yet.' : null, vaultPaused: false, burnLimit: 0, polling: false, lastError: null, polled: 0 };
  const selectors = { approve: selector('approve(address,uint256)'), allowance: selector('allowance(address,address)'), balanceOf: selector('balanceOf(address)'), deposit: selector('deposit(uint256)') };
  const refuse = (msg, status = 409, code = 'desk_closed') => new GameError(msg, status, code);

  if (C) {
    // Test balances must never turn into claims on real tokens.
    if (store.ledgerBalance('system:mint') !== 0) throw new Error('This database holds test DND. Live token mode needs a fresh database.');
    store.setMeta('live_economy', '1');
  }
  const frozen = () => store.getMeta('cash_frozen');
  function alert(kind, detail, t) {
    store.insertAlert(t, kind, detail);
    if (!frozen()) store.setMeta('cash_frozen', `${kind}: ${detail}`);
    console.error(`[cash desk] ${kind}: ${detail}`);
  }

  // ------------------------------------------------------------ the rules for drifters
  // Drifters pay in real DND once the token is live, so they spend a funded purse with limits,
  // and new or unlinked crews wait. Without this, free accounts could farm real money.
  function drifterAllowance(accountId, t) {
    if (!C) return Infinity;
    const acct = store.getAccount(accountId);
    if (!acct || acct.guest || !store.walletOfKind(accountId, 'evm')) return 0;
    if (t - acct.created_at < cfg.DRIFTER_MIN_AGE_MS) return 0;
    const paid = store.drifterPaidSince(accountId, dayStart(t));
    return Math.max(0, Math.min(store.ledgerBalance('system:drifters'), cfg.DRIFTER_DAILY_CAP - paid));
  }

  // ------------------------------------------------------------ deposits
  function creditDeposit(row, t) {
    if (C?.treasury && row.from_addr === C.treasury) {
      transfer('system:chain', 'system:drifters', row.whole, 'treasury_fund', `${row.tx_hash}:${row.log_index}`, t);
      store.markDepositCredited(row.tx_hash, row.log_index, 'system:drifters', t);
      return;
    }
    const wallet = store.getWallet(row.from_addr);
    if (!wallet) return; // held until this wallet is linked to a crew
    const P = load(wallet.account_id);
    P.G.marks += row.whole;
    P.G.ledger.deposited = (P.G.ledger.deposited || 0) + row.whole;
    transfer('system:chain', wallet.account_id, row.whole, 'deposit', `${row.tx_hash}:${row.log_index}`, t);
    store.markDepositCredited(row.tx_hash, row.log_index, wallet.account_id, t);
    pushEvent(P.G, { t: 'deposit', whole: row.whole });
    save(P, t);
  }
  // Called when a wallet is linked: anything it already sent to the vault lands now.
  function claimHeld(accountId, address, t) {
    for (const row of store.heldDeposits(address)) creditDeposit(row, t);
  }

  // ------------------------------------------------------------ withdrawals
  function openVouchers(accountId) { return store.openWithdrawals(accountId).length; }
  function payoutOpensAt(acct, wallet) { return Math.max(acct.created_at + cfg.WITHDRAW_MIN_AGE_MS, wallet.linked_at + cfg.WALLET_COOLDOWN_MS); }
  function signVoucher(accountId, to, whole, t) {
    const nonce = '0x' + randomBytes(32).toString('hex'), expiry = Math.floor(t / 1000) + cfg.VOUCHER_LIFE_S;
    const sig = signer.signClaim({ chainId: C.chainId, vault: C.vault, to, whole, nonce, expiry });
    store.insertWithdrawal({ id: nonce, account: accountId, to, whole, expiry, ...sig, at: t });
    return voucherView(store.getWithdrawal(nonce));
  }
  function voucherView(w) {
    const fields = { to: w.to_addr, whole: w.whole, nonce: w.id, expiry: w.expiry, v: w.v, r: w.r, s: w.s };
    return { id: w.id, to: w.to_addr, whole: w.whole, expiry: w.expiry, status: w.status, tx: w.tx_hash,
      data: w.status === 'open' ? (w.account_id === BURN ? encodeBurn(fields) : encodeClaim(fields)) : undefined };
  }
  function checkOpen() {
    if (!C) throw refuse('Withdrawals open when DND launches on the chain.');
    if (frozen()) throw refuse('Withdrawals are stopped while the team checks something. Your balance is safe in the ledger.');
    if (!state.ready) throw refuse('The chain connection is not ready. Try again shortly.');
    if (state.vaultPaused) throw refuse('Withdrawals are paused on the vault right now.');
  }
  // Runs inside the action's database transaction, so the debit and the voucher stand or fall together.
  function request(P, whole, t, acct) {
    checkOpen();
    const wallet = store.walletOfKind(acct.id, 'evm');
    if (!wallet) throw refuse('Link an Ethereum-type wallet first. That is where DND is paid.', 409, 'no_wallet');
    if (t < acct.created_at + cfg.WITHDRAW_MIN_AGE_MS) throw refuse('New crews wait a day before their first withdrawal.', 409, 'too_new');
    if (t < wallet.linked_at + cfg.WALLET_COOLDOWN_MS) throw refuse('A newly linked wallet waits 3 days before withdrawals, to protect you if someone gets into your account.', 409, 'wallet_cooldown');
    if (whole < cfg.WITHDRAW_MIN) throw refuse(`The smallest withdrawal is ${cfg.WITHDRAW_MIN} DND.`, 409, 'too_small');
    if (openVouchers(acct.id)) throw refuse('Claim or wait out your open withdrawal first.', 409, 'voucher_open');
    if (P.G.marks < whole) throw refuse(`You have ${P.G.marks} DND.`, 409, 'not_enough');
    const since = dayStart(t);
    if (store.withdrawnSince(acct.id, since) + whole > cfg.WITHDRAW_ACCOUNT_DAILY) throw refuse(`A crew can withdraw ${cfg.WITHDRAW_ACCOUNT_DAILY} DND per day.`, 409, 'account_limit');
    if (store.withdrawnSince(null, since) + whole > cfg.WITHDRAW_GLOBAL_DAILY) throw refuse('The daily withdrawal limit for the game has been reached. Try again tomorrow.', 409, 'global_limit');
    const voucher = signVoucher(acct.id, wallet.address, whole, t);
    P.G.marks -= whole;
    P.G.ledger.withdrawn = (P.G.ledger.withdrawn || 0) + whole;
    transfer(acct.id, 'system:withdrawing', whole, 'withdraw', voucher.id, t);
    return { voucher };
  }
  // ------------------------------------------------------------ burning
  // Bundles what was spent into a voucher that anyone can submit to the vault. The server never
  // sends transactions, so this waits for a player or the team to press the button.
  function issueBurn(t) {
    if (!C || frozen() || !state.ready || state.vaultPaused || store.openWithdrawals(BURN).length) return;
    const pending = store.ledgerBalance(BURN), whole = Math.min(pending, state.burnLimit);
    if (whole < cfg.BURN_MIN) return;
    const nonce = '0x' + randomBytes(32).toString('hex'), expiry = Math.floor(t / 1000) + cfg.VOUCHER_LIFE_S;
    const sig = signer.signBurn({ chainId: C.chainId, vault: C.vault, whole, nonce, expiry });
    store.insertWithdrawal({ id: nonce, account: BURN, to: BURN_TO, whole, expiry, ...sig, at: t });
    transfer(BURN, BURNING, whole, 'burn_voucher', nonce, t);
  }
  function settleBurn(log, nonce, whole, t) {
    const w = store.getWithdrawal(nonce);
    if (!w || w.account_id !== BURN) return alert('unknown_burn', `vault burned ${whole} DND on an unknown voucher ${nonce}, tx ${log.transactionHash}`, t);
    if (w.whole !== whole) return alert('burn_mismatch', `voucher ${nonce} burned ${whole}, issued for ${w.whole}`, t);
    if (w.status === 'claimed') return undefined;
    if (w.status === 'refunded') return alert('refunded_voucher_paid', `burn voucher ${nonce} was returned, then used on the chain, tx ${log.transactionHash}`, t);
    transfer(BURNING, 'system:chain', whole, 'burned', nonce, t);
    store.settleWithdrawal(nonce, 'claimed', t, log.transactionHash);
    return undefined;
  }
  function burnInfo() {
    const open = store.openWithdrawals(BURN)[0];
    return { burned: store.burnedTotal(), waiting: store.ledgerBalance(BURN) + (open ? open.whole : 0), open: open ? voucherView(open) : null };
  }
  function settleClaim(log, nonce, to, whole, t) {
    const w = store.getWithdrawal(nonce);
    // The vault paid a voucher this server never issued, or one with other terms. Either means
    // the signing key is in someone else's hands, so all withdrawals stop until a person looks.
    if (!w) return alert('unknown_voucher', `vault paid ${whole} DND to ${to} on an unknown voucher ${nonce}, tx ${log.transactionHash}`, t);
    if (w.to_addr !== to || w.whole !== whole) return alert('voucher_mismatch', `voucher ${nonce} paid ${whole} to ${to}, issued ${w.whole} to ${w.to_addr}`, t);
    if (w.status === 'claimed') return undefined;
    if (w.status === 'refunded') return alert('refunded_voucher_paid', `voucher ${nonce} was refunded, then paid on the chain, tx ${log.transactionHash}`, t);
    transfer('system:withdrawing', 'system:chain', whole, 'withdraw_claimed', nonce, t);
    store.settleWithdrawal(nonce, 'claimed', t, log.transactionHash);
    const P = load(w.account_id);
    pushEvent(P.G, { t: 'withdrawn', whole });
    save(P, t);
    return undefined;
  }
  // Only ever runs after the logs up to the safe block are processed. A voucher that expired
  // before a safe block, with no claim seen by then, can never be paid. So a refund is safe.
  function refundExpired(safeTime, t) {
    for (const w of store.expiredOpen(safeTime - cfg.REFUND_MARGIN_S)) {
      store.settleWithdrawal(w.id, 'refunded', t, null);
      // An unused burn voucher just goes back in the queue, to be issued again.
      if (w.account_id === BURN) { transfer(BURNING, BURN, w.whole, 'burn_voucher_returned', w.id, t); continue; }
      transfer('system:withdrawing', w.account_id, w.whole, 'withdraw_refund', w.id, t);
      const P = load(w.account_id);
      P.G.marks += w.whole;
      P.G.ledger.withdrawn = (P.G.ledger.withdrawn || 0) - w.whole;
      pushEvent(P.G, { t: 'refund', whole: w.whole });
      save(P, t);
    }
  }

  // ------------------------------------------------------------ watching the chain
  const callView = (to, data) => rpc.call('eth_call', [{ to, data }, 'latest']);
  async function checkSetup() {
    const chainId = Number(await rpc.call('eth_chainId'));
    if (chainId !== C.chainId) throw new Error(`The node is on chain ${chainId}, expected ${C.chainId}.`);
    const token = topicAddress(await callView(C.vault, selector('token()')));
    if (token !== C.token) throw new Error(`The vault's token is ${token}, expected ${C.token}.`);
    const onChain = topicAddress(await callView(C.vault, selector('signer()')));
    if (onChain !== signer.address) throw new Error(`The vault trusts signer ${onChain}, but this server signs as ${signer.address}.`);
  }
  async function safeHead() {
    if (typeof C.finality === 'number') {
      const latest = Number(await rpc.call('eth_blockNumber'));
      const b = await rpc.call('eth_getBlockByNumber', [hex(Math.max(0, latest - C.finality)), false]);
      return { number: Number(b.number), time: Number(b.timestamp) };
    }
    const b = await rpc.call('eth_getBlockByNumber', [C.finality, false]);
    if (!b) return null;
    return { number: Number(b.number), time: Number(b.timestamp) };
  }
  function handleLog(log, t) {
    if (log.removed || String(log.address).toLowerCase() !== C.vault) return;
    const amount = log.topics[0] === BURNED ? 0n : BigInt(log.data);
    if (log.topics[0] === DEPOSITED) {
      const from = topicAddress(log.topics[1]);
      if (amount > BigInt(MAX_WHOLE)) return alert('huge_deposit', `${amount} DND from ${from} in ${log.transactionHash}`, t);
      const row = { tx_hash: log.transactionHash, log_index: Number(log.logIndex), from_addr: from, whole: Number(amount), block: Number(log.blockNumber) };
      // The primary key on (tx, log) means a repeat scan can never credit twice.
      if (store.insertDeposit(row, t)) creditDeposit(row, t);
    } else if (log.topics[0] === BURNED && isHash32(log.topics[1])) {
      const whole = BigInt('0x' + String(log.data).slice(2, 66));
      if (whole > BigInt(MAX_WHOLE)) return alert('huge_burn', `${whole} DND in ${log.transactionHash}`, t);
      return settleBurn(log, log.topics[1], Number(whole), t);
    } else if (log.topics[0] === CLAIMED && isHash32(log.topics[1])) {
      if (amount > BigInt(MAX_WHOLE)) return alert('huge_claim', `${amount} DND in ${log.transactionHash}`, t);
      return settleClaim(log, log.topics[1], topicAddress(log.topics[2]), Number(amount), t);
    }
    return undefined;
  }
  async function poll() {
    if (!C || state.polling) return;
    state.polling = true;
    try {
      await checkSetup();
      state.ready = true; state.setupError = null;
      state.vaultPaused = BigInt(await callView(C.vault, selector('paused()'))) !== 0n;
      state.burnLimit = Number(BigInt(await callView(C.vault, selector('dailyBurnLimit()'))));
      const head = await safeHead();
      if (!head) return;
      let from = Math.max(store.chainCursor() + 1, C.startBlock);
      while (from <= head.number) {
        const to = Math.min(from + cfg.LOG_RANGE - 1, head.number);
        const logs = await rpc.call('eth_getLogs', [{ address: C.vault, fromBlock: hex(from), toBlock: hex(to), topics: [[DEPOSITED, CLAIMED, BURNED]] }]);
        logs.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.logIndex) - Number(b.logIndex));
        const t = now();
        // A block range and its results commit together, so a crash just rescans it.
        store.tx(() => { for (const log of logs) handleLog(log, t); store.setChainCursor(to); });
        from = to + 1;
      }
      const t = now();
      store.tx(() => { refundExpired(head.time, t); issueBurn(t); });
      state.lastError = null;
      if (++state.polled % 20 === 1) await reconcile(true);
    } catch (e) {
      state.lastError = e.message;
      if (!state.ready) state.setupError = e.message;
      console.error(`[cash desk] ${e.message}`);
    } finally {
      state.polling = false;
    }
  }
  // Compares the ledger with the chain. The vault must always hold at least what the game owes.
  async function reconcile(raiseAlert) {
    const raw = await callView(C.token, selectors.balanceOf + C.vault.slice(2).padStart(64, '0'));
    const vault = BigInt(raw) / 10n ** 18n, owed = BigInt(-store.ledgerBalance('system:chain') + store.heldTotal());
    if (raiseAlert && vault < owed) store.tx(() => alert('vault_short', `the vault holds ${vault} DND but the game owes ${owed}`, now()));
    return { vault: vault.toString(), owed: owed.toString(), surplus: (vault - owed).toString() };
  }

  // ------------------------------------------------------------ what the browser sees
  function publicConfig() {
    const net = C || ROBINHOOD;
    return {
      live: !!C, symbol: T.TOKEN.symbol, chainId: net.chainId, chainName: net.name, currency: net.currency, rpc: C ? C.publicRpc : ROBINHOOD.rpc, explorer: net.explorer,
      token: C?.token, vault: C?.vault, selectors, ready: state.ready, paused: state.vaultPaused, frozen: !!frozen(),
      market: C?.market ?? null, rewards: C ? store.ledgerBalance('system:drifters') : null, burn: burnInfo(),
      limits: { min: cfg.WITHDRAW_MIN, accountDaily: cfg.WITHDRAW_ACCOUNT_DAILY, voucherHours: cfg.VOUCHER_LIFE_S / 3600 },
    };
  }
  function stateFor(acct) {
    const t = now(), wallet = store.walletOfKind(acct.id, 'evm');
    return {
      vouchers: store.recentWithdrawals(acct.id, 8).map(voucherView),
      deposits: store.recentDeposits(acct.id, 8).map(d => ({ tx: d.tx_hash, whole: d.whole, at: d.credited_at })),
      leftToday: Math.max(0, cfg.WITHDRAW_ACCOUNT_DAILY - store.withdrawnSince(acct.id, dayStart(t))),
      payoutOpensAt: wallet ? payoutOpensAt(acct, wallet) : null,
      drifterToday: C ? drifterAllowance(acct.id, t) : null,
    };
  }
  return { poll, reconcile, request, burnInfo, drifterAllowance, claimHeld, openVouchers, publicConfig, stateFor, state, enabled: !!C, signerAddress: signer?.address };
}
