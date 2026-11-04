# DungeonDragons

An idle RPG on a strip at the bottom of the window, with timed loot chests, a fusing forge and a player market. The market runs on DND, a token that is test money until a real token and the vault contract are connected. See "The DND token and wallets".

## Run it

Needs Node 24 or newer. There is nothing to install: the server only uses Node's built-in modules.

```bash
npm run build
```

```bash
npm start
```

Then open http://localhost:8080. Run the tests with `npm test`, the money tests with `npm run test:chain`, and the load test with `node test/load.mjs 4000 25`.

## How it stays honest

The server owns the game. The browser sends requests such as "open this chest" and draws what comes back.

| Attack | What stops it |
|---|---|
| Editing coin, DND or items in the browser | The browser holds a copy. Nothing it sends can set a balance. |
| Predicting or rerolling loot | Loot rolls use a cryptographic source on the server and are never seeded. |
| Speeding up time | The server simulates from its own clock. Extra requests add no game time. |
| Duplicating an item or selling it twice | Each trade is one database transaction, and listed items are held in escrow. |
| Hand-crafted bad requests | Every argument is checked against a strict allowlist before any game code runs. |
| Flipping goods against the simulated buyers | Drifters only buy freshly found goods. Traded goods keep that mark, even through fusing. |
| Moving wealth between throwaway accounts | Guests and new accounts cannot trade with other crews. The audit flags repeat pairs and odd prices. |
| Guessing passwords | Passwords are hashed with scrypt, and login attempts are rate limited per address. |

Combat runs from a public seed, so the browser can replay the server's fight exactly between syncs and the action stays smooth. Knowing that seed reveals nothing about loot.

A bot can still play one account at the normal rate, and someone can run many accounts. Stopping that takes identity checks, such as phone verification or Steam login, which this does not have.

## Operating it

Commands run on the server. There is no admin web page.

```bash
node server/admin.mjs audit
```

Checks that every Mark balances against the double-entry ledger, that no item exists twice, and that every valuable item has a recorded origin. It exits with code 2 on a violation. Repeat trading pairs and unusual prices are listed as flags for review.

```bash
node server/admin.mjs ban <account name> [reason]
```

```bash
node server/admin.mjs unban <account name>
```

```bash
node server/admin.mjs prune-guests 30
```

```bash
node server/admin.mjs backup /data/backup.db
```

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to listen on |
| `DB_PATH` | `trayfarers.db` | SQLite file. Keep it on a persistent disk. |
| `NODE_ENV` | | `production` turns on secure cookies |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so rate limits see real addresses. Fly.io is detected automatically. |
| `COOKIE_SECURE` | follows `NODE_ENV` | Set to `0` only for plain HTTP testing |
| `PEER_MIN_AGE_HOURS` | `1` | How old an account must be to trade with other crews |

## Deploy to Fly.io

`Dockerfile` and `fly.toml` are ready, but the Docker image has not been test-built yet. Change `app` in `fly.toml` first.

```bash
fly launch --no-deploy --copy-config
```

```bash
fly volumes create trayfarers_data --size 3
```

```bash
fly deploy
```

SQLite means one machine and one disk. That is simple and cheap, and it is the first thing to replace if the game outgrows a single server.

## Deploy to Vercel

Vercel has no always-on server and no disk, so here the static files come from its CDN, one function in `api/index.mjs` answers the API, and the game's data lives in a hosted [Turso](https://vercel.com/marketplace/tursocloud) database. The game logic and SQL are the same. This setup only runs test DND, and it refuses to start if the `DND_*` settings are present, because a function cannot keep watching the chain.

1. Link the project and add the database. This also sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.

   ```bash
   vercel link
   ```

   ```bash
   vercel integration add tursocloud --billing-plan starter --meta region=iad1
   ```

2. Set the site's address, which wallets show when signing.

   ```bash
   vercel env add PUBLIC_ORIGIN production
   ```

3. Deploy.

   ```bash
   vercel deploy --prod
   ```

`.vercelignore` is an allowlist, so local databases and notes are never uploaded. To run admin tools such as `audit` against the hosted database, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in your shell.

Every save takes a short write lock on the database, so one database handles a limited number of players at once. In a load test it held about 17 saves a second, the same traffic as about 165 players online, with no errors. For more than that, or for live token mode, run `server/index.mjs` on a real server.

## Before a public launch

- Schedule backups and copy them off the machine.
- Run the audit on a schedule and alert when it fails.
- Publish terms of service and a privacy policy.
- Add email or another way to reset a password. Today a lost password means a lost account.
- Host the fonts yourself if you need to avoid sending visitors' addresses to Google.

## How the art works

Nothing is drawn by hand or loaded from outside. `art/` paints each character as a stack of layers (far limb, cape, body, armour plates, head, near limb, weapon) with lighting, contact shadows and a rim light. It renders every animation frame once, and `node build.mjs` packs them into PNG sheets in `public/atlas/`, one for the heroes and one per region. A sheet is only re-rendered when the source art changes, and the whole bake takes a few seconds.

To change a character, edit `art/heroes.mjs` or `art/monsters.mjs`, rebuild, and restart the server. To change scenery, the gate or the cart, edit `art/scenes.mjs`. Item icons, skill emblems and hero portraits are in `art/items.mjs`. Window frames, buttons and the stage maps are in `art/ui.mjs`.

The screen works like a desk: a Pack or Status window on the left, the Hero in the middle, a Forge or Portal window on the right, and wide Almanac, Exchange and Ledger windows that take over the whole desk.

Hero skills are real rules in `src/engine.js`, checked by the server. Each hero has three tiers opening at levels 1, 10 and 20, earns a point every 2 levels, and carries one active skill, or two from level 10.

During play, the rules still run ten times a second. The renderer in `src/ui.js` runs on the display's clock, smooths positions between rule steps, and adds what the rules don't know about: hit-stop, screen shake, particles and health-bar ghosts. It also respects the reduced-motion setting.

## The DND token and wallets

Players sign in or link a wallet by signing a free message. MetaMask, Phantom, Rabby and other Ethereum-type wallets are found automatically through EIP-6963. Phantom's Solana side, Solflare and Backpack can sign in, but only an Ethereum-type wallet can receive DND. Mobile wallets work inside their own in-app browsers. WalletConnect is not included.

**Without the `DND_*` settings the game runs on test DND.** New crews get 100 for free, drifters pay from nothing, and nothing can leave the game. Linking a wallet still works.

**With them set, it is a closed economy.** Every DND in the game entered through the vault contract, and the audit proves it against the ledger:

- New crews start with 0 DND. A database that ever held test DND refuses to go live.
- Deposits are credited to whoever owns the sending wallet, once the block is `safe`. On Robinhood Chain that is about 15 minutes.
- Withdrawals debit the balance and return a signed voucher. The player submits it to the vault and pays their own gas. An unclaimed voucher is refunded after it expires.
- The server holds a key that signs vouchers. It holds no tokens and sends no transactions.
- If the vault pays a voucher the server never issued, withdrawals stop at once until `cash-unfreeze` is run.

**Heroes.** New crews start by connecting a wallet, and every crew gets the Kitten Knight for free. Each other hero costs 500,000 DND (`HERO_PRICE` in `src/engine.js`), all of it burned, and joins the crew at once. Set `REQUIRE_WALLET=0` to let people start without a wallet.

**Players get DND in two ways.** They can buy it on the market and deposit it. Or they can earn it: drifters pay for fresh loot out of the rewards vault, which is the DND you deposit from the `DND_TREASURY` wallet. Drifters pay only linked crews, up to a daily cap, and stop when the vault is empty. Nothing is minted, so a filled vault is real tokens you bought.

**Every DND spent in the game is burned.** That covers drifter purchases and the 15% fee on every sale, with nothing kept by the operator. The seller keeps the rest of a sale between crews. Spent DND waits in a queue on the ledger. Once at least `BURN_MIN` is waiting, the server signs a burn voucher, and anyone can send it from the Wallet window or to the vault's `burn` function, paying the gas. The vault calls the token's `burn`, so total supply falls. A token without `burn` is sent to the dead address instead, which removes it from circulation but leaves total supply unchanged. Because the server sends no transactions, someone has to send each batch. Until then, the tokens stay in the vault.

### Going live

Try this on the testnet first (chain ID 46630), using `contracts/test/TestToken.sol:TestToken` as the token, and get the vault audited before real value goes in. It has not been audited. Also get legal advice: a tradable token with real cash-out, loot chests and a market can fall under securities, gambling and money-transmission rules, depending on where your players are.

1. Launch the token on [Pons](https://docs.ponsfamily.com/docs/v2). The whole supply starts on its bonding curve, so filling the rewards vault means buying on the market like anyone else. Check the current state of Pons's own audits before you rely on it. `node build.mjs` writes the token logo to `public/dnd-logo.png` at 512 by 512 pixels.
2. Check the real token against the vault. This runs on a private copy of the live chain on your machine, sends nothing real and spends nothing, and it needs [Foundry](https://getfoundry.sh). All lines must pass, including `total supply really fell`.

   ```bash
   npm run check:token -- <TOKEN> <RPC_URL>
   ```

3. Choose an owner wallet, ideally a hardware wallet or a multisig. It can pause the vault, replace the signer, change the daily limits and, while paused, move funds out. Tell players about these powers.
4. Generate the voucher key on the server, where nothing else can read it, and keep it out of the owner wallet. Note its address.

   ```bash
   cast wallet new
   ```

5. Deploy the vault from the owner wallet. `--ledger` signs on a hardware wallet, and `--interactive` asks for a key without saving it. The last two arguments are the most whole DND the vault will pay out per day, and the most it will burn per day. Set the burn limit well above the hero price, or a single purchase will take several days to burn.

   ```bash
   forge create --broadcast --ledger --rpc-url https://rpc.mainnet.chain.robinhood.com contracts/src/DNDVault.sol:DNDVault --constructor-args <TOKEN> <OWNER> <VOUCHER_KEY_ADDRESS> <DAILY_LIMIT> <DAILY_BURN_LIMIT>
   ```

6. Set these on the server, using a fresh database. On Fly.io, keep `DND_VOUCHER_KEY` in `fly secrets`.

   | Setting | Meaning |
   | --- | --- |
   | `DND_TOKEN` | The token's address from Pons |
   | `DND_VAULT` | The vault's address from step 5 |
   | `DND_VOUCHER_KEY` | The key from step 4 |
   | `DND_START_BLOCK` | The block the vault was deployed in |
   | `DND_TREASURY` | The wallet whose deposits fill the rewards vault |
   | `DND_MARKET_URL` | The `https` page where players can buy DND. The Wallet window links to it. |
   | `DND_RPC` | Your own node provider. The public one is rate limited. |
   | `DND_FINALITY` | `safe` (default), `finalized`, or a number of blocks |
   | `PUBLIC_ORIGIN` | The game's address, such as `https://example.com`. Wallets show it when signing. |

7. Check everything. This must report `ready: true`.

   ```bash
   node server/admin.mjs chain-check
   ```

8. Fill the rewards vault to open earning. From the `DND_TREASURY` wallet, approve the vault, then deposit. The approval is in base units with 18 decimals, and the deposit is in whole DND.

   ```bash
   cast send --ledger --rpc-url <RPC_URL> <TOKEN> "approve(address,uint256)" <VAULT> <WHOLE_DND>000000000000000000
   ```

   ```bash
   cast send --ledger --rpc-url <RPC_URL> <VAULT> "deposit(uint256)" <WHOLE_DND>
   ```

Limits such as the daily caps, the waiting periods and `BURN_MIN` are `DESK_DEFAULTS` in `server/desk.mjs`. Keep the game's daily limit below the vault's.

More operator commands:

```bash
node server/admin.mjs unlink-wallet <address>
```

```bash
node server/admin.mjs cash-unfreeze
```

**If the voucher key might be stolen:** pause the vault from the owner wallet, call `setSigner` with a new key, update `DND_VOUCHER_KEY`, then unpause. A thief can take at most the vault's daily limit per day until then. Open vouchers stop working, and they are refunded when they expire.

Run the money tests with `npm run test:chain`. They need [Foundry](https://getfoundry.sh), and run the real contracts on a private local chain.

## Credits

RobinCat comes from the RobinCat community at [robincat.club](https://robincat.club/). The RobinCat sprite here is an original drawing made in code, and it uses no files from that project. This game is not affiliated with or endorsed by the RobinCat community or Robinhood Markets.

## Layout

- `src/engine.js`: the game rules, shared by the server and the browser
- `art/`: the character, monster and scenery painter, and the sprite sheet baker
- `contracts/`: the vault, with its tests and the stand-in tokens they use
- `src/ui.js`, `src/sprites.js`, `src/art.js`, `src/wallet.js`, `src/template.html`: the browser client
- `server/`: HTTP, accounts, the authoritative game, wallets, the cash desk, storage, audit and admin tools
- `test/`: end-to-end server tests, a simulated playthrough and a load test
- `artifact/trayfarers.html`: the earlier play-money version, kept as published
