To-Do's and features to add:

- [ ] A good logging system
  - [ ] Log in-game messages
  - [ ] Log everything that our bot sees (relative): blocks nearby, people nearby, coordinates, other bots' coordinates, inventory, health, …
  - [ ] Save to a logfile

- [ ] Multi-bot system
  - [ ] Inter-bot communication or orchestration (e.g. complementary spawner sets; intruder warns other bot)

- [ ] Sentinel: define base first; normal behavior near base, freeze actions away from base (maintenance / player gathers)

- [ ] Advanced: structure snapshot and auto-build
  - [ ] Research building sketches & schemas


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

