# Changelog

All notable changes to **mineflayer-bots** are documented here. This file captures the evolution of the project in one place.

---

## [Unreleased] — session summary

### Architecture

- **Trigger → action stack:** Triggers (`playerRadius`, `blockNearby`, `onSpawn`) watch conditions; when they fire, an ordered list of actions runs sequentially, each fully awaited before the next.
- **Registries:** New triggers go in `triggers/` + `triggers/index.js`; new actions in `actions/` + `actions/index.js`. Behavior is driven by `config.js`.

### Skill layer (`lib/`)

- Adapted from **mindcraft** (`skills.js`, `world.js`, `mcdata.js`) with minimal edits:
  - ESM → CommonJS (`require` / `module.exports`).
  - `initBot` replaced with `init(bot)` on an existing mineflayer instance.
  - `blockPlaceDelay` read from `config.js` → `skills.blockPlaceDelay`.
  - `log()` also prints to the console.
  - `bot.output` and `bot.modes` stubbed in `bot.js` so skills run without the mindcraft agent.
- Plugins: `mineflayer-pathfinder`, `mineflayer-collectblock`.
- Explicit deps where pnpm needs them: `minecraft-data`, `prismarine-item`, `vec3`, `canvas` (viewer).

### Triggers

| Type            | Behavior |
|-----------------|----------|
| `playerRadius`  | `printRadius` logs distances; `alertRadius` fires the action stack and arms panic watch; `panicRadius` calls `bot.quit()` immediately (fast interval). |
| `blockNearby`   | Fires once when a block type enters range. |
| `onSpawn`       | Fires once after `delayMs` from spawn. |

### Actions

| Action           | Behavior |
|------------------|----------|
| `breakBlock`     | Nearest matching block via `world` + `skills.breakBlockAt`. |
| `breakAllBlocks` | All matches in range; random delay between breaks; per-block try/catch; summary `broke X/Y`. |
| `disconnect`     | `bot.quit()`. |
| `goToBlock`      | `skills.goToNearestBlock`. |
| `takeFromChest`  | `skills.takeFromChest`. |
| `pickupItems`    | `skills.pickupNearbyItems`. |
| `sendChat`       | `bot.chat` + optional post-delay. |
| `startDebugScan` | Non-blocking interval: nearby block types + entities within radius. |

### Resilience

- **`actions/index.js`:** try/catch around each action so one failure does not abort the stack.
- **`breakAllBlocks.js`:** try/catch per block so pathfinding/dig errors skip one target and continue.

### Configuration (`config.js`)

- **`bot`:** host, port, username, `auth` (`offline` \| `microsoft`), `profilesFolder`, `version`.
- **`skills`:** `blockPlaceDelay`.
- **`viewer`:** prismarine-viewer (`enabled`, `port`, `firstPerson`).
- **`triggers`:** array of `{ type, options, actions }`.
- **Debug mode (optional):** commented `debugTrigger` — delayed `/skyblock` + `startDebugScan` (uncomment + add to `triggers` to enable).

### Tooling & docs

- **pnpm** as package manager; `pnpm.onlyBuiltDependencies: ["canvas"]` for native build on pnpm 10+.
- **README.md:** quick start, structure, mindcraft adaptation notes, extension guide.

### Entry point

- **`bot.js`:** `mineflayer.createBot`, stubs, `mc.init(bot)`, connection events, optional viewer, register all triggers from config.

---

*For day-to-day usage, see `README.md`.*
