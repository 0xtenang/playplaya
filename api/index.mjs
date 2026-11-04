// The game on Vercel. Static files come straight from public/, and this one function answers the
// API. Vercel keeps no disk between requests, so the database is a hosted one. This setup runs on
// test DND only: live token mode needs a chain watcher, which a function cannot keep running.
import { createApp } from '../server/app.mjs';

for (const key of ['DND_TOKEN', 'DND_VAULT', 'DND_VOUCHER_KEY']) {
  if (process.env[key]) throw new Error(`${key} is set, but the Vercel setup only runs test DND. Run server/index.mjs on a real server for live token mode.`);
}
if (!process.env.TURSO_DATABASE_URL) throw new Error('TURSO_DATABASE_URL is not set, so there is nowhere to keep the game.');

const { handler } = createApp({
  hosted: { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN },
  trustProxy: 'xff',
  cookieSecure: true,
  publicOrigin: process.env.PUBLIC_ORIGIN,
  requireWallet: process.env.REQUIRE_WALLET !== '0',
  // Test DND has no value, so testers can try the market between crews straight away.
  config: { PEER_MIN_AGE_MS: Number(process.env.PEER_MIN_AGE_HOURS || 0) * 3600e3 },
});
export default handler;
