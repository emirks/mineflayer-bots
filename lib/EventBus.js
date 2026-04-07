const EventEmitter = require('events')

// ─── Cross-bot event bus ──────────────────────────────────────────────────────
// Singleton shared across all bot sessions in the same process.
//
// Bots PUBLISH named events to signal things that happened in the game world.
// The orchestrator and future coordination logic SUBSCRIBE and react.
//
// Today:
//   orchestrator subscribes to 'bot:stateChange' and 'bot:error' for logging
//   and future GUI integration.
//
// Future patterns (don't implement, just emit and subscribe when needed):
//   bot.emit event → 'world:spawnerFound'   { profile, position }
//   bot.emit event → 'world:playerSeen'     { profile, username, distance }
//   bot.emit event → 'trade:cycleComplete'  { profile, items, gold }
//   orchestrator subscribes and triggers other bots' actions accordingly
//
// Keeping bots decoupled through this bus means one bot's crash never
// directly affects another, and coordination logic can be added without
// touching individual bot code.

module.exports = new EventEmitter()
