# Changelog

## 2026-04-07
- **arch** Added `ARCHITECTURE.md` — full system map (server→proxy→mc-protocol→mineflayer→your code), TCP pipeline, mineflayer plugin list, world-interaction table, velocity bug analysis
- **arch** Added compact system map + `ARCHITECTURE.md` reference to `.cursor/rules/mineflayer-bots.mdc`
- **fix**  `lib/velocityPatch.js` — `prependListener` on `entity_velocity` + `spawn_entity`; copies `packet.velocity.{x,y,z}` → flat `velocityX/Y/Z` before mineflayer `entities.js` runs; fixes NaN position corruption on DonutSMP (1.20.4 via ViaVersion)
- **feat** `profiles/sentinel.js` — `playerRadius` trigger: alert@3 blocks, panic@0; action stack: `breakAllBlocks(spawner, r=64)` → `dropItems(spawner)` → `disconnect`
- **feat** `profiles/trader.js` — `onSpawn` → `/warp market`; `blockNearby(chest)` → loot → `/sell all` → `pickupItems`; `playerRadius` panic@5 → `disconnect`
- **feat** `actions/breakAllBlocks.js` — multi-round rescan loop, random 400–1600 ms human delay between blocks, sneak during dig, `maxRounds` safety cap
- **feat** `lib/protocolDebug.js` — opt-in packet tracer; hooks `bot._client` for parsed/raw IN and OUT; streams to `logs/`; `MC_PROTOCOL_DEBUG=1` env override
