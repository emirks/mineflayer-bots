# mineflayer-bots

A configurable Minecraft bot system built on [mineflayer](https://github.com/PrismarineJS/mineflayer). Define **triggers** (conditions to watch) and **actions** (what to do when triggered) entirely through `config.js` — no code changes needed to change behavior.

The skill layer (`lib/`) is adapted from [mindcraft](https://github.com/kolbytn/mindcraft)'s battle-tested implementation, stripped of all LLM/agent machinery to run as pure, standalone Mineflayer functions.

---

## Quick start

```bash
pnpm install      # requires pnpm — install once with: npm i -g pnpm
# edit config.js
pnpm start
```

---

## Project structure

```
mineflayer-bots/
├── bot.js              # Entry point: create bot, load plugins, register triggers
├── config.js           # All configuration lives here
├── lib/                # Skill layer (adapted from mindcraft, see below)
│   ├── mcdata.js       # minecraft-data lookups + plugin loader (init)
│   ├── world.js        # Block/entity/inventory query helpers
│   └── skills.js       # High-level async skills (movement, containers, combat…)
├── triggers/
│   ├── index.js        # Registry + fire() bridge
│   ├── playerRadius.js # Fires when a player enters a radius
│   └── blockNearby.js  # Fires when a block type enters a radius
└── actions/
    ├── index.js        # Sequential executor (awaits each step)
    ├── breakBlock.js   # Dig nearest matching block
    ├── disconnect.js   # Clean disconnect
    ├── goToBlock.js    # Pathfind to nearest block of a type
    ├── takeFromChest.js# Walk to chest, open it, withdraw item
    └── pickupItems.js  # Collect nearby dropped items
```

---

## Configuration (`config.js`)

### `bot` — connection

| Key | Description |
|---|---|
| `host` / `port` | Server address |
| `username` | In-game name (use account email for Microsoft auth) |
| `auth` | `'offline'` (LAN/cracked) or `'microsoft'` (online-mode) |
| `profilesFolder` | Where Microsoft tokens are cached after first login |
| `version` | `false` = auto-detect, or pin e.g. `'1.21.1'` |

### `viewer` — in-browser 3D render

| Key | Description |
|---|---|
| `enabled` | `true` to start the viewer |
| `port` | Web server port (default `3000`) |
| `firstPerson` | `true` = FPS camera through the bot's eyes |

### `triggers` — behavior

Each trigger fires its **action stack** once when its condition is first met. Actions run in order, fully awaited.

```js
{
  type: 'blockNearby',
  options: { blockName: 'chest', radius: 20, checkIntervalMs: 1000 },
  actions: [
    { type: 'takeFromChest', options: { itemName: 'bone', num: -1 } },
  ],
}
```

---

## Available triggers

| Type | What it watches | Key options |
|---|---|---|
| `playerRadius` | Distance to all loaded players | `printRadius`, `alertRadius`, `checkIntervalMs` |
| `blockNearby` | Nearest block of a given type | `blockName`, `radius`, `checkIntervalMs` |

All triggers fire **at most once** and cancel their own interval the moment they trip.

## Available actions

| Type | What it does | Key options |
|---|---|---|
| `breakBlock` | Dig nearest matching block | `blockName`, `searchRadius` |
| `disconnect` | Clean disconnect | — |
| `goToBlock` | Pathfind to nearest block | `blockName`, `minDistance`, `searchRadius` |
| `takeFromChest` | Walk to chest, open, withdraw item | `itemName`, `num` (`-1` = all) |
| `pickupItems` | Collect dropped items nearby | — |

---

## The skill layer — adapted from mindcraft

`lib/skills.js`, `lib/world.js`, and `lib/mcdata.js` are adapted from the [mindcraft](https://github.com/kolbytn/mindcraft) project's `src/agent/library/` and `src/utils/` directories.

**What was changed (minimal):**

| File | Change |
|---|---|
| All three | ESM `import/export` → CJS `require/module.exports` |
| `mcdata.js` | Removed `initBot` (bot is created in `bot.js`); replaced with `init(bot)` which loads plugins and initialises `minecraft-data` |
| `skills.js` | `settings.block_place_delay` → read from `config.js` (`skills.blockPlaceDelay`); `log()` now also prints to console |
| `bot.js` | Added `bot.output = ''` and `bot.modes = { isOn: () => false, … }` stubs so skills work without the mindcraft agent |

**What was not changed:** all skill logic — pathfinding, container interaction, item collection, combat, crafting — is untouched from mindcraft.

To use any skill directly in a new action:

```js
const skills = require('../lib/skills')

async function myAction(bot, options) {
  await skills.goToNearestBlock(bot, 'furnace')
  await skills.takeFromChest(bot, 'iron_ingot')
}
module.exports = myAction
```

---

## Adding things

**New action:** create `actions/foo.js` exporting `async function(bot, options)`, register in `actions/index.js`, use in `config.js`. Reach for `lib/skills`, `lib/world`, and `lib/mcdata` for anything Minecraft-related — movement, containers, inventory, block lookups — before writing logic from scratch.

```js
const skills = require('../lib/skills')
const world  = require('../lib/world')
const mc     = require('../lib/mcdata')

async function myAction(bot, options) {
  const chest = world.getNearestBlock(bot, 'chest', 32)   // world query
  if (!chest) return
  await skills.goToPosition(bot, chest.position.x, chest.position.y, chest.position.z)
  await skills.takeFromChest(bot, options.itemName ?? 'bone')
}
module.exports = myAction
```

**New trigger:** create `triggers/foo.js` exporting `function(bot, options, fire)` (call `fire()` when condition met), register in `triggers/index.js`, use in `config.js`. Use `lib/world` to query the game state (e.g. `world.getNearestBlock`, `world.getInventoryCounts`) and `lib/mcdata` for ID/name lookups inside the condition check.

```js
const world = require('../lib/world')

function register(bot, options, fire) {
  const { itemName = 'bone', minCount = 10, checkIntervalMs = 1000 } = options
  let triggered = false
  const interval = setInterval(() => {
    if (triggered || !bot.entity) return
    const counts = world.getInventoryCounts(bot)    // world query
    if ((counts[itemName] ?? 0) >= minCount) {
      triggered = true
      clearInterval(interval)
      fire({ itemName, count: counts[itemName] })
    }
  }, checkIntervalMs)
}
module.exports = register
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `mineflayer` | Core bot API |
| `mineflayer-pathfinder` | Pathfinding (required by movement skills) |
| `mineflayer-collectblock` | Block collection plugin |
| `minecraft-data` | Block/item ID lookups |
| `prismarine-item` / `vec3` | Item types and 3D vectors |
| `prismarine-viewer` | In-browser world renderer |
| `canvas` | Native addon required by prismarine-viewer |

---

## Install notes

Use **pnpm** only — do not mix with `npm install`.

| To reset | Delete |
|---|---|
| Full reinstall | `node_modules/` + `pnpm-lock.yaml` + `package-lock.json`, then `pnpm install` |

`pnpm.onlyBuiltDependencies: ["canvas"]` is set in `package.json` so pnpm allows the native canvas build. On Windows, if canvas fails to build, install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**. Or set `viewer.enabled: false` to skip the viewer entirely.
