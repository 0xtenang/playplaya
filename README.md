# Trayfarers

An idle RPG on a strip at the bottom of the window, with timed loot chests, a fusing forge and a player market. Marks, the market currency, are play money and cannot be withdrawn.

## Run it

Needs Node 24 or newer. There is nothing to install: the server only uses Node's built-in modules.

```bash
npm run build
```

```bash
npm start
```

Then open http://localhost:8080. Run the tests with `npm test`, and the load test with `node test/load.mjs 4000 25`.

## How it stays honest

The server owns the game. The browser sends requests such as "open this chest" and draws what comes back.

| Attack | What stops it |
|---|---|
| Editing coin, Marks or items in the browser | The browser holds a copy. Nothing it sends can set a balance. |
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

## Real money

This server is necessary for real money, but not enough for it. Paying out cash also needs legal review, identity checks, fraud handling and a payment provider. The simulated drifters mint Marks from nothing, so they would have to be removed or funded first. Trading on the Steam Market would instead need a Steam release and Steam's item system.

## Layout

- `src/engine.js`: the game rules, shared by the server and the browser
- `art/`: the character, monster and scenery painter, and the sprite sheet baker
- `src/ui.js`, `src/sprites.js`, `src/art.js`, `src/template.html`: the browser client
- `server/`: HTTP, accounts, the authoritative game, storage, audit and admin tools
- `test/`: end-to-end server tests, a simulated playthrough and a load test
- `artifact/trayfarers.html`: the earlier play-money version, kept as published
