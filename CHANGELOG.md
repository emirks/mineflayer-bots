# Changelog

## 2026-04-07 (remaining stability fixes)
- **feat** `profiles/sentinel.js`, `profiles/trader.js`, `profiles/debug.js` — added `timeoutMs` to every action that can block (breakAllBlocks: 300s, takeFromChest: 60s, pickupItems: 30s, dropItems: 15s, sendChat: 4–5s); startDebugScan and disconnect have no timeout since they return/exit immediately
- **fix**  `triggers/playerRadius.js` — added `panicRadius <= 0` early-return guard in `startPanicWatch()`; previously the interval ran forever doing nothing when panicRadius was 0 (condition `distanceTo < 0` is never true)
- **fix**  `triggers/playerRadius.js`, `actions/disconnect.js` — call `bot.pathfinder.stop()` (with guard) before `bot.quit()` so any in-flight `pathfinder.goto()` rejects immediately rather than waiting for the socket-close error to propagate; makes the action-chain abort faster and cleaner

## 2026-04-07 (stability fixes)
- **fix**  `bot.js` — `bot.on('spawn')` → `bot.once('spawn')`; prevents triggers being re-registered on every dimension change (mineflayer re-emits `spawn` on `respawn` packets from `/warp`, `/skyblock`, etc.), which caused duplicate polling intervals and double action stack executions
- **fix**  `triggers/index.js` — added module-level `actionChain` promise queue; all `fire()` calls append to the tail via `.then()` so action stacks from different triggers are serialised through a single queue; trigger polling intervals remain fully parallel; panic `bot.quit()` in `playerRadius` bypasses the queue intentionally
- **fix**  `triggers/playerRadius.js`, `actions/disconnect.js` — set `bot._quitting = true` before `bot.quit()` so the action executor can detect a closing connection and abort the chain cleanly instead of issuing commands to a dead socket
- **fix**  `actions/index.js` — `executeActions` now checks `bot._quitting` at each step and breaks early; accepts `context` as a third arg (trigger data forwarded from `fire()`); supports optional `opts.timeoutMs` per action via `Promise.race` to prevent a stuck pathfinder from hanging the entire chain indefinitely
- **arch** `ARCHITECTURE.md` — updated triggers/actions sections, boot sequence, data-flow diagram, and Extending guide to reflect all five stability fixes above

## 2026-04-07
- **arch** Added `ARCHITECTURE.md` — full system map (server→proxy→mc-protocol→mineflayer→your code), TCP pipeline, mineflayer plugin list, world-interaction table, velocity bug analysis
- **arch** Added compact system map + `ARCHITECTURE.md` reference to `.cursor/rules/mineflayer-bots.mdc`
- **fix**  `lib/velocityPatch.js` — `prependListener` on `entity_velocity` + `spawn_entity`; copies `packet.velocity.{x,y,z}` → flat `velocityX/Y/Z` before mineflayer `entities.js` runs; fixes NaN position corruption on DonutSMP (1.20.4 via ViaVersion)
- **feat** `profiles/sentinel.js` — `playerRadius` trigger: alert@3 blocks, panic@0; action stack: `breakAllBlocks(spawner, r=64)` → `dropItems(spawner)` → `disconnect`
- **feat** `profiles/trader.js` — `onSpawn` → `/warp market`; `blockNearby(chest)` → loot → `/sell all` → `pickupItems`; `playerRadius` panic@5 → `disconnect`
- **feat** `actions/breakAllBlocks.js` — multi-round rescan loop, random 400–1600 ms human delay between blocks, sneak during dig, `maxRounds` safety cap
- **feat** `lib/protocolDebug.js` — opt-in packet tracer; hooks `bot._client` for parsed/raw IN and OUT; streams to `logs/`; `MC_PROTOCOL_DEBUG=1` env override
