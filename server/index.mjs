// Starts the game server. Settings come from the environment; see README.md.
import { createApp } from './app.mjs';
import { readChainEnv, readHeroBurnEnv } from './chain.mjs';
import { T } from './game.mjs';

const prod = process.env.NODE_ENV === 'production';
const hours = process.env.PEER_MIN_AGE_HOURS;
const chain = readChainEnv(process.env);
const app = createApp({
  dbPath: process.env.DB_PATH || 'trayfarers.db',
  trustProxy: process.env.FLY_APP_NAME ? 'fly' : process.env.TRUST_PROXY === '1' ? 'xff' : false,
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : prod,
  publicOrigin: process.env.PUBLIC_ORIGIN,
  requireWallet: process.env.REQUIRE_WALLET !== '0',
  config: { ...(hours === undefined ? {} : { PEER_MIN_AGE_MS: Number(hours) * 3600e3 }), CHAIN: chain, HERO_BURN: chain ? null : readHeroBurnEnv(process.env, T.TOKEN.address) },
});
const port = await app.listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0');
console.log(`DungeonDragons is listening on port ${port}`);

let closing = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await app.close();
    process.exit(0);
  });
}
