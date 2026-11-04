// Operator tools. Run on the server itself: there is deliberately no admin web route.
//   node server/admin.mjs audit
//   node server/admin.mjs ban <account name> [reason]
//   node server/admin.mjs unban <account name>
//   node server/admin.mjs prune-guests [days]
//   node server/admin.mjs backup <file>
//   node server/admin.mjs chain-check
//   node server/admin.mjs unlink-wallet <address>
//   node server/admin.mjs cash-unfreeze
//   node server/admin.mjs hero-price [whole DND]
//   node server/admin.mjs rune-scale [number]
import { openStore } from './store.mjs';
import { createGame } from './game.mjs';
import { runAudit } from './audit.mjs';
import { readChainEnv } from './chain.mjs';

const [command, ...args] = process.argv.slice(2);
const hosted = process.env.TURSO_DATABASE_URL ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN } : null;
const store = openStore(process.env.DB_PATH || 'trayfarers.db', hosted);
const game = createGame({ store, now: Date.now, build: 'admin', config: { CHAIN: readChainEnv(process.env) } });
const findAccount = name => {
  const acct = name && store.getAccountByName(name);
  if (!acct) { console.error(`No account named "${name}".`); process.exit(1); }
  return acct;
};

switch (command) {
  case 'audit': {
    const report = runAudit(store, Date.now());
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 2);
    break;
  }
  case 'chain-check': {
    if (!game.desk.enabled) { console.log('Test mode: no DND_* settings are set.'); break; }
    await game.desk.poll();
    const { ready, setupError, vaultPaused, lastError } = game.desk.state;
    console.log(JSON.stringify({ ready, setupError, vaultPaused, lastError, signer: game.desk.signerAddress, frozen: store.getMeta('cash_frozen'), burn: game.desk.burnInfo(), rewards: store.ledgerBalance('system:drifters'), ...(ready ? await game.desk.reconcile(false) : {}) }, null, 2));
    break;
  }
  case 'unlink-wallet': {
    const address = String(args[0] || '');
    const row = store.getWallet(address.startsWith('0x') ? address.toLowerCase() : address);
    if (!row) { console.error('No crew has that wallet linked.'); process.exit(1); }
    store.deleteWallet(row.address);
    console.log(`Unlinked ${row.address} from account ${row.account_id}. Any new wallet starts with the full waiting period.`);
    break;
  }
  case 'hero-price': {
    if (args[0] !== undefined) {
      const price = Number(args[0]);
      if (!Number.isInteger(price) || price < 1 || price > 1e9) { console.error('The price must be a whole number from 1 to 1,000,000,000.'); process.exit(1); }
      store.setMeta('hero_price', String(price));
    }
    console.log(`A hero costs ${Number(store.getMeta('hero_price') || game.heroPriceDefault).toLocaleString('en-US')} DND.`);
    break;
  }
  case 'rune-scale': {
    if (args[0] !== undefined) {
      const scale = Number(args[0]);
      if (!(scale > 0) || scale > 1e6) { console.error('The scale must be a number above 0 and up to 1,000,000.'); process.exit(1); }
      store.setMeta('rune_scale', String(scale));
    }
    console.log(`A rune rank costs its base cost times ${store.getMeta('rune_scale') || game.runeScaleDefault} in DND.`);
    break;
  }
  case 'cash-unfreeze': {
    const reason = store.getMeta('cash_frozen');
    store.deleteMeta('cash_frozen');
    console.log(reason ? `Withdrawals were stopped because: ${reason}\nThey are open again.` : 'Withdrawals were not stopped.');
    break;
  }
  case 'ban': {
    const acct = findAccount(args[0]);
    game.ban(acct.id, args.slice(1).join(' ') || 'Breaking the game rules.');
    console.log(`Banned ${acct.name}. Their sessions are closed and their listings returned.`);
    break;
  }
  case 'unban': {
    const acct = findAccount(args[0]);
    store.setBan(acct.id, null, null);
    console.log(`Unbanned ${acct.name}.`);
    break;
  }
  case 'prune-guests': {
    const days = Number(args[0] ?? 30);
    if (!(days >= 1)) { console.error('Days must be 1 or more.'); process.exit(1); }
    const cutoff = Date.now() - days * 86400e3;
    const stale = store.q(`SELECT a.id FROM accounts a JOIN players p ON p.account_id = a.id
                           WHERE a.guest = 1 AND p.seen_at < ?
                           AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.seller_id = a.id AND l.status = 'open')`).all(cutoff);
    store.tx(() => { for (const { id } of stale) store.q('DELETE FROM accounts WHERE id = ?').run(id); });
    console.log(`Removed ${stale.length} guest accounts idle for ${days}+ days. Their ledger rows stay for the audit.`);
    break;
  }
  case 'backup': {
    if (!args[0]) { console.error('Give a file to write the backup to.'); process.exit(1); }
    store.q('VACUUM INTO ?').run(args[0]);
    console.log(`Backed up to ${args[0]}.`);
    break;
  }
  default:
    console.error('Commands: audit, ban <name> [reason], unban <name>, prune-guests [days], backup <file>');
    process.exit(1);
}
store.close();
