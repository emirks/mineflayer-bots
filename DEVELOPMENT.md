To-Do's and features to add:

- [x] A good logging system
  - [x] Per-bot file output → `logs/<profileName>.log` (timestamped, plain text)
  - [x] Coloured console output — bot name tag colour-coded per bot (multi-bot readable)
  - [x] Session separators in log file on each connect/reconnect attempt
  - [x] Spawn state snapshot: position, health, food
  - [x] State transition logs: IDLE → CONNECTING → CONNECTED → DISCONNECTED → RECONNECTING…
  - [x] All triggers, actions, and session events use `bot.log.*` (no bare console.* left)
  - [x] Log in-game chat messages received from the server
  - [x] Log snapshots periodically while connected

- [x] Multi-bot system
  - [ ] Inter-bot communication or orchestration (e.g. complementary spawner sets; intruder warns other bot)

- [x] Sentinel: define base first; normal behavior near base, freeze actions away from base (maintenance / player gathers)
    - [x] Start with a very basic implementation, like accepting the spawn position as the base and +- 30 blocks each direction
    - [ ] In the future make this base editable.

- [ ] Advanced: structure snapshot and auto-build
  - [ ] Research building sketches & schemas

- [ ] AFK avoidance - random movements etc

- [ ] Don't quit without gatherint N number of Spawners

- [ ] Handle non-intentional disconnection logic like closing viewer
### The following error crashesthe orchestrator as a whole!
 health: ? | food: ?
2026-04-07 22:37:28.422 INFO  [sentinel] [SESSION] Base recorded at (-202388.8, -50.0, 10610.7)
2026-04-07 22:37:28.430 INFO  [sentinel] [SESSION] Viewer → http://localhost:3000
2026-04-07 22:37:28.431 INFO  [sentinel] [SESSION] Registering 1 trigger(s)...
2026-04-07 22:37:28.432 INFO  [sentinel] [TRIGGER] Registered "playerRadius" (priority 0)      
node:events:496
      throw er; // Unhandled 'error' event
      ^

Error: listen EADDRINUSE: address already in use :::3000
    at Server.setupListenHandle [as _listen2] (node:net:1908:16)
    at listenInCluster (node:net:1965:12)
    at Server.listen (node:net:2067:7)
    at module.exports (C:\Users\EmirKISA\Desktop\workspace\personal_projects\mine-automation\mineflayer-bots\node_modules\.pnpm\prismarine-viewer@1.33.0\node_modules\prismarine-viewer\lib\mineflayer.js:81:8)
    at EventEmitter.<anonymous> (C:\Users\EmirKISA\Desktop\workspace\personal_projects\mine-automation\mineflayer-bots\lib\createBotSession.js:107:7)
    at Object.onceWrapper (node:events:632:28)
    at EventEmitter.emit (node:events:530:35)
    at Client.<anonymous> (C:\Users\EmirKISA\Desktop\workspace\personal_projects\mine-automation\mineflayer-bots\node_modules\.pnpm\mineflayer@4.37.0\node_modules\mineflayer\lib\plugins\health.js:13:11)
    at Object.onceWrapper (node:events:633:26)
    at Client.emit (node:events:530:35)
Emitted 'error' event on Server instance at:
    at emitErrorNT (node:net:1944:8)
    at process.processTicksAndRejections (node:internal/process/task_queues:82:21) {
  code: 'EADDRINUSE',
  errno: -4091,
  syscall: 'listen',
  address: '::',
  port: 3000
}

Node.js v20.18.3

Fixes:
## Summary

| Issue | Severity | Affects |
|-------|----------|---------|
| `bot.on('spawn')` re-registers triggers on dimension change | Critical | All profiles with `/warp` or `/skyblock` commands |
| No cross-trigger action mutex | Critical | trader (concurrent onSpawn + blockNearby), any multi-trigger profile |
| `startDebugScan` leaks forever, no cleanup handle | High | debug profile, any profile using it mid-stack |
| Context from `fire()` is silently dropped | High | All triggers — forces redundant re-scans |
| No per-action timeout — pathfinder can block forever | High | Any action using `goToPosition`, `takeFromChest` |
| `runtimeConfig` singleton breaks multi-bot-per-process | Medium | Future extensibility |
| Panic quit races an in-flight action chain | Medium | sentinel + trader under panic |
| `panicRadius: 0` silently never fires | Minor | sentinel profile |
| No trigger cancel/cleanup API | Minor | Future reconnect scenarios |

## Priority fixes (in order)

- [ ] **Critical** — Fix `bot.on('spawn')` re-registering triggers on dimension change (affects `/warp`, `/skyblock`).
- [ ] **Critical** — Add cross-trigger action mutex (trader onSpawn + blockNearby; any multi-trigger profile).
- [ ] **High** — Add cleanup for `startDebugScan` (no forever leak; debug / mid-stack use).
- [ ] **High** — Preserve or thread context from `fire()` (stop silent drop / redundant re-scans).
- [ ] **High** — Per-action timeout for pathfinder-heavy actions (`goToPosition`, `takeFromChest`).
- [ ] **Medium** — Replace or scope `runtimeConfig` singleton for multi-bot-per-process.
- [ ] **Medium** — Serialize or cancel in-flight action chain on panic quit (sentinel + trader).
- [ ] **Minor** — Treat `panicRadius: 0` explicitly (document, warn, or fire — not silent never-fire).
- [ ] **Minor** — Trigger cancel/cleanup API for reconnect and teardown scenarios.

