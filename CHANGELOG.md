# Changelog

## 2026-04-08
- **fix** `lib/logger.js` — `LOGS_BASE` now uses `path.dirname(process.execPath)` when `process.pkg` is truthy; fixes "Cannot mkdir in a snapshot" crash when running the packaged exe
- **feat** `lib/createBotSession.js` — when `process.pkg` is true, loads the profile from the real filesystem next to the exe (`<exeDir>/<profileName>.js`) instead of the read-only snapshot; allows the friend to edit the profile in Notepad without rebuilding
- **chore** `package.json` — added `postbuild` script that copies `profiles/sentinel.js` + `profiles/_base.js` to `dist/` after every `pnpm build`; `dist/` is the complete folder to ship
- **chore** `package.json` + `launch-sentinel.js` (new) — added `@yao-pkg/pkg` dev dependency; `pkg` config bundles all profiles/triggers/actions/lib + minecraft-data assets; `pnpm build` produces `dist/sentinel-bot.exe` (Node 18 embedded, ~76 MB); `launch-sentinel.js` calls `spawnBot` directly (not via argv) because `require.main === module` is false inside a pkg exe; `pnpm.overrides.into-stream: 6` fixes ESM crash on Node 20
- **feat** `lib/createBotSession.js` — records `bot._base = bot.entity.position.clone()` on first spawn so triggers can reference the bot's home position
- **feat** `triggers/index.js` — `fire()` now checks `triggerConfig.baseZone` before queuing an action chain; if the bot is farther than `baseZone.radius` blocks from `bot._base` the chain is silently skipped (sensing keeps running); distance is logged at info level for visibility
- **feat** `profiles/sentinel.js` — added `baseZone: { radius: 30 }` to the `playerRadius` trigger; sentinel actions only execute when within 30 blocks of spawn; logs `[TRIGGER] skipped — Xm from base` when outside
- **feat** `lib/logger.js` — changed log directory layout to `logs/<profile>/<YYYY-MM-DD>/run_<N>/session.log`; run number auto-increments per process start (reconnects share the same run dir); exposed `log.runDir` on the logger object; added `createSnapshotWriter(runDir)` export that opens `snapshots.jsonl` (NDJSON, append-only) in the same run directory
- **feat** `lib/snapshot.js` (new) — extracted `buildSnapshot(bot)` into its own module; extends snapshot with: look direction (yaw/pitch), velocity, gameMode, biome, heldItem, armor slots (helmet/chest/leggings/boots), surroundings (below/legs/head block names), nearby blocks with exact positions within 8 blocks (nearest 20 non-air via `bot.findBlocks`); all floats rounded (health 1dp, look 2dp, vel 3dp); all risky calls wrapped in try/catch
- **refactor** `lib/createBotSession.js` — removed inline `buildSnapshot`; now imports from `lib/snapshot.js`; starts a 1-second `setInterval` after `spawn` writing to `snapshots.jsonl`; interval cleared on `end` and `kicked`
- **feat** `lib/createBotSession.js` — added `bot.on('message')` listener; logs every incoming in-game chat/system message as `[CHAT] <text>` via the session logger (console + `session.log`)

## 2026-04-07 (per-profile account isolation)
- **refactor** `profiles/_base.js` — removed `username` and `profilesFolder` from `bot`; these have no sensible shared default and must be per-profile so concurrent bots never share an account (server blocks duplicate logins); updated comment to document the required pattern
- **refactor** `profiles/sentinel.js` — added explicit `bot: { ...base.bot, username, profilesFolder: './auth-cache/sentinel' }`
- **refactor** `profiles/trader.js` — same; `username` left blank (different account required for concurrent run with sentinel)
- **refactor** `profiles/debug.js` — same; `username` left blank with note that it can share sentinel's account if not running concurrently

## 2026-04-07 (logging system)
- **feat** `lib/logger.js` (new) — `createLogger(name)` factory; module-level registry so BotManager and createBotSession share one file stream per profile; per-bot output to `logs/<name>.log` (plain text, append); coloured console output with ANSI (no deps); bot name tag colour-coded from a pool for multi-bot terminal readability; `sessionMark(label)` writes a visual separator in file and console at every connect attempt; no external dependencies
- **feat** `lib/createBotSession.js` — creates `bot.log = createLogger(profileName)` before any log output; spawn event now logs a state snapshot (position, health, food); all bare `console.*` calls replaced with `bot.log.*`
- **feat** `lib/BotManager.js` — creates `this.log = createLogger(profileName)` in constructor (same registry instance as session); calls `this.log.sessionMark(...)` at start of each connect attempt so reconnect cycles are clearly delimited in the log file; `_setState` logs enriched state transition line (prev→next, uptime, attempt); all bare `console.*` replaced with `this.log.*`; added `_fmtUptime` helper
- **refactor** `triggers/index.js`, `triggers/playerRadius.js`, `triggers/blockNearby.js`, `triggers/onSpawn.js` — all `console.*` replaced with `bot.log.*` at appropriate levels (info/warn/error)
- **refactor** `actions/index.js`, `actions/breakAllBlocks.js`, `actions/breakBlock.js`, `actions/disconnect.js`, `actions/dropItems.js`, `actions/goToBlock.js`, `actions/pickupItems.js`, `actions/sendChat.js`, `actions/takeFromChest.js`, `actions/startDebugScan.js` — all `console.*` replaced with `bot.log.*`
- **docs** `DEVELOPMENT.md` — logging todo items marked complete; added remaining items (in-game chat log, periodic snapshots)

## 2026-04-07 (GUI dashboard)
- **feat** `gui/server.js` (new) — Express + Socket.io server; serves dashboard; REST API for instance CRUD (create/update/delete/start/stop) and profile code read/write; forwards all EventBus events to connected browser sockets; ring-buffer log of last 200 entries sent to new connections; SIGINT stops all bots gracefully
- **feat** `gui/public/index.html` + `style.css` + `app.js` (new) — browser dashboard: bot grid with per-instance state badges (idle/connecting/connected/disconnected/reconnecting/stopped/failed), live uptime counter, Connect/Stop/Edit buttons; Add Bot modal with settings form + Profile Code editor tab (reads/writes .js profile files, clears require cache on save); event log panel; fully dark-themed (GitHub-dark palette)
- **feat** `instances.json` (new) — persisted bot instance configs (label, profile template, username, host, port, auth, viewerPort, reconnect); each instance gets its own auth-cache subfolder for account isolation
- **feat** `orchestrator.js` — added `spawnInstance(instance)`: merges per-instance overrides (username, host, viewerPort) onto the named profile template; sets `profilesFolder: ./auth-cache/<safeUser>` per account; uses instance.id as the BotManager map key; exported in module.exports
- **fix**  `lib/BotManager.js` — added `profileConfig` field; `createBotSession` now called with `profileConfig || profileName`; `CONNECTED` state now fires on `bot.once('login')` (previously fired immediately after TCP connect, before the server confirmed login); `_attempt` counter reset on successful login
- **fix**  `lib/createBotSession.js` — parameter renamed to `profileNameOrConfig`; accepts a string (loads profile file as before) or a pre-built config object (used by `spawnInstance` for GUI instances); `profileName` derived from `_instanceId` / `_profileTemplate` for log labels
- **chore** `package.json` — added `express ^5.2.1`, `socket.io ^4.8.3`; added `"gui": "node gui/server.js"` script

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
