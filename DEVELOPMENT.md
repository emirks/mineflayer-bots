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

- [x] Health check every interval (5mins now) so user knows bot is healthy.


- [x] Multi-bot system
  - [x] Add dynamic profile selection for orchestrator, instead of taking as an argument, make it ask when it opens up.
  - [ ] Inter-bot communication or orchestration (e.g. complementary spawner sets; intruder warns other bot)

### Sentinel: 
  - [x] Define base first; normal behavior near base, freeze actions away from base (maintenance / player gathers)
      - [x] Start with a very basic implementation, like accepting the spawn position as the base and +- 30 blocks each direction
      - [x] ** Make it log once when out and once when went in!
      - [ ] Future: make this base position editable.
      - [x] Fix: Panic is not disabled bcs its not an action, no fire wrapper, do a check for it!
  - [x] Add a whitelist, no alert or panic for those users!
  - [x] Future: Add blacklist, direct alert=panic for those users
  - [x] Log the number of spawners we have in front periodically. Add position of spawners? 
  - [x] A stable spawner-breaking mechanism
  - [x] Can we access block stack sizes? Log stack counts during the 5‑minute health check too. (Possible — see debug profile and `logSpawnerData` action.) Follow `skills.js` / `world.js` patterns and best practice.
  - [x] Place a lower limit on inventory spawner count. Don't quit without gathering N number of Spawners
    - [x] Configurable manually
    - [x] When the count can be resolved, use the value from the latest check
  
### Spawner Bone Dropper
  - [x] Log everything, debugSpawnerWindow! 
  - [x] Implement Bone Dropping & Selling Mechanism
  - [ ] Implement throttling mechanism. N_bones/min

- [ ] Advanced: structure snapshot and auto-build
  - [ ] Research building sketches & schemas

- [ ] AFK avoidance - random movements etc

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
