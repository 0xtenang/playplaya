# Trayfarers

An idle RPG on a strip at the bottom of the window, with timed loot chests, a fusing forge and a player market. The market runs on DND, a token that is test money until the contracts are deployed and the server is pointed at them. See "The DND token and wallets".

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
- Drifters pay only from a purse you fund, by depositing from the `DND_TREASURY` wallet. They pay only linked crews, up to a daily cap, and stop when the purse is empty.
- If the vault pays a voucher the server never issued, withdrawals stop at once until `cash-unfreeze` is run.

### Going live

Do these on the testnet first (chain ID 46630), and get the contracts audited before real value goes in. They have not been audited. Also get legal advice: a tradable token with real cash-out, loot chests and a market can fall under securities, gambling and money-transmission rules, depending on where your players are.

The contract name and symbol are fixed forever at deployment. To use a different name, change them in `contracts/src/DNDToken.sol` first.

1. Choose an owner wallet, ideally a hardware wallet or a multisig. It can pause the vault, replace the signer, change the daily limit and, while paused, move funds out. Tell players about these powers.
2. Generate the voucher key on the server, where nothing else can read it, and keep it out of the owner wallet. Note its address.

   ```bash
   cast wallet new
   ```

3. Deploy from the owner wallet. `--ledger` signs on a hardware wallet, and `--interactive` asks for a key without saving it. The supply is in whole tokens, and the last vault argument is the most vouchers can pay per day, in whole tokens.

   ```bash
   forge create --broadcast --ledger --rpc-url https://rpc.mainnet.chain.robinhood.com contracts/src/DNDToken.sol:DNDToken --constructor-args <WHOLE_SUPPLY> <OWNER>
   ```

   ```bash
   forge create --broadcast --ledger --rpc-url https://rpc.mainnet.chain.robinhood.com contracts/src/DNDVault.sol:DNDVault --constructor-args <TOKEN> <OWNER> <VOUCHER_KEY_ADDRESS> <DAILY_LIMIT>
   ```

4. Set these on the server, using a fresh database. On Fly.io, keep `DND_VOUCHER_KEY` in `fly secrets`.

   | Setting | Meaning |
   | --- | --- |
   | `DND_TOKEN`, `DND_VAULT` | The two addresses from step 3 |
   | `DND_VOUCHER_KEY` | The key from step 2 |
   | `DND_START_BLOCK` | The block the vault was deployed in |
   | `DND_TREASURY` | The wallet whose deposits fund the drifters' purse |
   | `DND_RPC` | Your own node provider. The public one is rate limited. |
   | `DND_FINALITY` | `safe` (default), `finalized`, or a number of blocks |
   | `PUBLIC_ORIGIN` | The game's address, such as `https://example.com`. Wallets show it when signing. |

5. Check everything. This must report `ready: true`.

   ```bash
   node server/admin.mjs chain-check
   ```

Limits such as the daily caps and waiting periods are `DESK_DEFAULTS` in `server/desk.mjs`. Keep the game's daily limit below the vault's.

More operator commands:

```bash
node server/admin.mjs pay-out system:founder <address> <whole DND>
```

```bash
node server/admin.mjs unlink-wallet <address>
```

```bash
node server/admin.mjs cash-unfreeze
```

**If the voucher key might be stolen:** pause the vault from the owner wallet, call `setSigner` with a new key, update `DND_VOUCHER_KEY`, then unpause. A thief can take at most the vault's daily limit per day until then. Open vouchers stop working, and they are refunded when they expire.

Run the money tests with `npm run test:chain`. They need [Foundry](https://getfoundry.sh), and run the real contracts on a private local chain.

## Layout

- `src/engine.js`: the game rules, shared by the server and the browser
- `art/`: the character, monster and scenery painter, and the sprite sheet baker
- `contracts/`: the DND token and vault, with their tests
- `src/ui.js`, `src/sprites.js`, `src/art.js`, `src/wallet.js`, `src/template.html`: the browser client
- `server/`: HTTP, accounts, the authoritative game, wallets, the cash desk, storage, audit and admin tools
- `test/`: end-to-end server tests, a simulated playthrough and a load test
- `artifact/trayfarers.html`: the earlier play-money version, kept as published
