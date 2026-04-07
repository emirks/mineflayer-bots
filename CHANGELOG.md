# Changelog

## 2026-04-07 (documentation sync)
- **docs** `ARCHITECTURE.md` — full snapshot update: corrected bot.js box (now thin wrapper), updated triggers/index.js box (createTriggerRegistry factory + priority queue), updated playerRadius/blockNearby/onSpawn with `returns { cancel }` and panic-path detail, updated lib/skills.js to show `blockDelay(bot)` replacing runtimeConfig, updated lib/runtimeConfig.js box to LEGACY status, added lib/createBotSession.js / lib/BotManager.js / lib/EventBus.js / orchestrator.js boxes to §1 YOUR CODE, rewrote §2 Boot Sequence with dual paths (bot.js + orchestrator.js), rewrote §3 Trigger→Action Data Flow to show priority queue and emergency path, updated §6 package table loader column, updated §7 run commands, rewrote §8 Extending with cancel pattern + EventBus example, added §9 Orchestration Layer (isolation table, BotManager state diagram, EventBus event catalogue, future GUI integration pattern)
- **docs** `.cursor/rules/mineflayer-bots.mdc` — added ARCHITECTURE.md maintenance contract: add/update/remove in sync with code; never strip accurate detail; changelog vs snapshot discipline explained

## 2026-04-07 (multi-bot orchestration)
- **arch** `lib/createBotSession.js` (new) — isolated bot session factory; stores profile on `bot._config`; calls `createTriggerRegistry()` per session; returns `{ bot, promise }` without calling `process.exit()`; used by both `bot.js` and `BotManager`
- **arch** `lib/BotManager.js` (new) — per-profile lifecycle manager; state machine (IDLE→CONNECTING→CONNECTED→DISCONNECTED→RECONNECTING→STOPPED→FAILED); exponential-backoff reconnect loop; exposes `start()`/`stop()`/`getSnapshot()`; emits `stateChange`, `reconnecting`, `error`
- **arch** `orchestrator.js` (new) — multi-bot entry point; manages a `Map<profileName, BotManager>`; exposes `spawnBot()`, `stopBot()`, `getBotStates()`; forwards all manager events to EventBus; handles `SIGINT` gracefully; dual-use (CLI + importable module for future GUI)
- **arch** `lib/EventBus.js` (new) — singleton `EventEmitter` for cross-bot coordination; bots publish game events; orchestrator and future GUI subscribe; decouples bot sessions from each other
- **fix**  `lib/skills.js` — removed `runtimeConfig` singleton import and module-level `blockPlaceDelay` constant; replaced with `blockDelay(bot)` helper that reads `bot._config` per-call; fixes multi-bot collision where second bot's config overwrote first's
- **arch** `triggers/index.js` — rewritten as `createTriggerRegistry()` factory; each bot session gets its own isolated priority queue and cleanup handles; priority queue sorts by `triggerConfig.priority` (default 0, higher runs first among queued chains, re-sorted before each dequeue); trigger handlers now return `{ cancel() }` for clean session teardown
- **fix**  `triggers/playerRadius.js`, `triggers/blockNearby.js`, `triggers/onSpawn.js` — all return `{ cancel() }` so `stopAll()` can clear their intervals/timers on session end; playerRadius hoists `fastInterval` to outer scope for reliable cleanup
- **refactor** `bot.js` — reduced to a thin wrapper over `createBotSession`; all session logic moved to `lib/createBotSession.js`; single-bot usage unchanged (`node bot.js <profile>`)

## 2026-04-07 (remaining stability fixes)
- **docs** `DEVELOPMENT.md` — feature todos use nested `- [ ]` task lists; completed truncated priority-fix checklist (runtimeConfig, panic race, panicRadius:0, trigger cleanup API)
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
