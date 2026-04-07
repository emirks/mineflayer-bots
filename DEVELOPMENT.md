To-Do's and features to add:
- [ ] A good logging system
    [] Log in-game messages
    [] Log everything that our bot sees (relative ones) like the blocks nearby, people nearby, its coordinates, other bots coordinates, inventory state health state, 

[] Multi-bot system
    [] Inter-bot communication or orchestration?: Needed for, for example if we put 2 bots in a single base, they should be responsible from breaking a different complementary set of spawners. Or one bot detecting an intruder should immediately warn the other?

[] In sentinel mode make it first define the base, and then make the bot functioning normally if near base, if not just freeze the actions etc. Because every day they make maintenance and gather players to a place!

[] As an advanced feature, I want structure snapshot and auto build functionalities. Like it will snapshot some place, and auto build it after that! 
    [] Reserach the building sketches & schemas for this


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
- [ ] **Medium** — Replace or
