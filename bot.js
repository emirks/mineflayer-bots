// ─── Single-bot entry point ───────────────────────────────────────────────────
// Convenience wrapper for running one bot profile directly.
//
// Usage:  node bot.js <profile>
// Example: node bot.js sentinel | debug | trader
//
// For multi-bot orchestration (run multiple profiles with auto-reconnect):
//   node orchestrator.js sentinel trader
//
// This file is intentionally minimal — all session logic lives in
// lib/createBotSession.js so it can be reused by the orchestrator.

const { createBotSession } = require('./lib/createBotSession')

const profileName = process.argv[2] || 'sentinel'

let sessionResult

try {
  sessionResult = createBotSession(profileName)
} catch (err) {
  console.error(`[ERROR] ${err.message}`)
  process.exit(1)
}

const { promise } = sessionResult

promise
  .then(({ reason }) => {
    console.log(`[BOT] Session ended — ${reason}`)
    process.exit(0)
  })
  .catch((err) => {
    console.error(`[BOT] Session failed — ${err.message}`)
    process.exit(1)
  })
