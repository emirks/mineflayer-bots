# mineflayer-bots

A configurable Minecraft bot system built on [mineflayer](https://github.com/PrismarineJS/mineflayer). Define **triggers** (conditions to watch) and **actions** (what to do when triggered) entirely through `config.js` — no code changes needed to change behavior.

---

## Quick start

This project is set up for **[pnpm](https://pnpm.io/)** (recommended). Install pnpm once if you need it: `npm install -g pnpm`.

```bash
pnpm install
# edit config.js to match your server
pnpm start
```

---

## Install, clean reinstall, and switching from npm

**What to delete** (from the `mineflayer-bots` folder) to fully reset dependencies:

| Remove | Why |
|--------|-----|
| `node_modules/` | All installed packages |
| `pnpm-lock.yaml` | pnpm lockfile (regenerates on `pnpm install`) |
| `package-lock.json` | Left over if you ever ran `npm install` — do not mix with pnpm |

Then run:

```bash
pnpm install
```

**Do not** run `npm install` in this folder if you use pnpm — it creates `package-lock.json` and can confuse which tool owns the tree. This repo’s `.gitignore` ignores `package-lock.json` on purpose.

**pnpm 10+ and `canvas`:** pnpm blocks dependency install scripts by default. `package.json` includes `pnpm.onlyBuiltDependencies: ["canvas"]` so the native `canvas` addon (required by prismarine-viewer) can compile. If you still see `Cannot find module '../build/Release/canvas.node'`, do a **clean reinstall** (delete the three items above, then `pnpm install`). On Windows, if the build fails, install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**, then reinstall. Easiest workaround: set `viewer.enabled` to `false` in `config.js` if you do not need the browser viewer.

---

## Configuration (`config.js`)

Everything lives in one file. Three top-level sections:

### `bot` — connection

| Key | Default | Description |
|---|---|---|
| `host` | `'localhost'` | Server IP or hostname |
| `port` | `25565` | Server port |
| `username` | `'ProximityBot'` | In-game name |
| `auth` | `'offline'` | `'offline'` for cracked/LAN servers, `'microsoft'` for online-mode |
| `profilesFolder` | `'./auth-cache'` | Where Microsoft OAuth tokens are cached after first login |
| `version` | `false` | Minecraft version to use (`false` = auto-detect) |

**Microsoft auth:** set `auth: 'microsoft'`, run the bot, follow the device-code URL that appears in the console. After the first login the token is cached — subsequent runs connect silently.

### `viewer` — in-browser world render

| Key | Default | Description |
|---|---|---|
| `enabled` | `false` | Set to `true` to start the viewer |
| `port` | `3000` | Web server port |
| `firstPerson` | `false` | `true` = see through the bot's eyes |

When enabled, open `http://localhost:3000` in any browser after the bot spawns.

**Why `canvas` is installed:** [prismarine-viewer](https://www.npmjs.com/package/prismarine-viewer) loads the native [`canvas`](https://www.npmjs.com/package/canvas) package server-side. It is not always installed transitively, so this repo lists **`canvas`** explicitly. See **Install, clean reinstall** above for pnpm + Windows build issues.

### `triggers` — behavior

An array of trigger objects. Each trigger watches for a condition and runs its **action stack** (in order, awaiting each step) the first time the condition is met.

```js
{
  type: 'playerRadius',         // which trigger
  options: { ... },             // trigger-specific settings
  actions: [                    // stack — runs top to bottom
    { type: 'breakBlock', options: { blockName: 'crafting_table', searchRadius: 64 } },
    { type: 'disconnect' },
  ],
}
```

---

## Available triggers

### `playerRadius`

Polls all loaded player entities on a fixed interval.

| Option | Default | Description |
|---|---|---|
| `printRadius` | `50` | Log `[DIST]` lines for players closer than this |
| `alertRadius` | `26` | Fire the action stack when any player crosses this |
| `checkIntervalMs` | `500` | Scan frequency in milliseconds |

The trigger fires **at most once** — it cancels its own interval the moment it trips so no further scans happen while actions are running.

---

## Available actions

### `breakBlock`

Finds the nearest block of a given type and digs it. Fully awaited before the next action starts.

| Option | Default | Description |
|---|---|---|
| `blockName` | `'crafting_table'` | Minecraft block name (e.g. `'chest'`, `'furnace'`) |
| `searchRadius` | `64` | How far to search in loaded chunks |

### `disconnect`

Sends a clean disconnect packet and exits. Always put this last in a stack.

---

## Project structure

```
mineflayer-bots/
├── bot.js              # Entry point — creates the bot, wires events, loads triggers
├── config.js           # All configuration lives here
├── triggers/
│   ├── index.js        # Registry: maps type names → handlers, builds fire() bridge
│   └── playerRadius.js # Implementation of the playerRadius trigger
└── actions/
    ├── index.js        # Sequential executor — awaits each action in the stack
    ├── breakBlock.js   # Break nearest matching block
    └── disconnect.js   # Disconnect from server
```

---

## Adding a new action

1. Create `actions/yourAction.js`:

```js
async function yourAction(bot, options) {
  const { someOption = 'default' } = options
  // do something with bot...
}
module.exports = yourAction
```

2. Register it in `actions/index.js`:

```js
const registry = {
  breakBlock: require('./breakBlock'),
  disconnect: require('./disconnect'),
  yourAction: require('./yourAction'), // ← add this
}
```

3. Use it in `config.js`:

```js
actions: [
  { type: 'yourAction', options: { someOption: 'value' } },
]
```

---

## Adding a new trigger

1. Create `triggers/yourTrigger.js`:

```js
// A trigger receives the bot, its options, and fire() — a function that
// executes the action stack. Call fire() when your condition is met.
function register(bot, options, fire) {
  const { threshold = 10 } = options
  // set up whatever monitoring you need (event listener, interval, etc.)
  bot.on('health', () => {
    if (bot.health < threshold) {
      fire({ health: bot.health })
    }
  })
}
module.exports = register
```

2. Register it in `triggers/index.js`:

```js
const registry = {
  playerRadius: require('./playerRadius'),
  yourTrigger:  require('./yourTrigger'), // ← add this
}
```

3. Use it in `config.js`:

```js
triggers: [
  {
    type: 'yourTrigger',
    options: { threshold: 5 },
    actions: [{ type: 'disconnect' }],
  },
]
```

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `mineflayer` | `^4.37.0` | Core bot API |
| `prismarine-viewer` | `^1.33.0` | In-browser world renderer |
| `canvas` | `^3.x` | Required by prismarine-viewer at runtime (native addon; not auto-installed by the viewer package) |
