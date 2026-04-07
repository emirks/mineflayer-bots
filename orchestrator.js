const { BotManager, BotState } = require('./lib/BotManager')
const EventBus = require('./lib/EventBus')

// ─── Orchestrator ─────────────────────────────────────────────────────────────
// Central registry and control plane for all bot profiles.
//
// Responsibilities:
//   - Manage a fleet of BotManagers (one per profile)
//   - Forward bot events onto the shared EventBus for GUI / coordination
//   - Expose a stable programmatic API so a GUI layer never imports bot internals
//
// Usage:
//   CLI:    node orchestrator.js sentinel trader
//   Module: const { spawnBot, stopBot, getBotStates, EventBus } = require('./orchestrator')
//
// EventBus events published here:
//   'bot:stateChange'  { profile, state, attempt, uptime }
//   'bot:error'        { profile, error, attempt }
//   'bot:reconnecting' { profile, attempt, delay }
//
// GUI integration (future):
//   const { spawnBot, stopBot, getBotStates, EventBus } = require('./orchestrator')
//   EventBus.on('bot:stateChange', snapshot => updateUI(snapshot))
//   getBotStates()  → array of current snapshots for initial render

const managers = new Map()  // profileName → BotManager

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Starts managing a bot profile. Reconnects automatically on disconnect.
 * @param {{ profile: string, reconnect?: boolean, maxRetries?: number, baseDelayMs?: number }} config
 * @returns {BotManager}
 */
function spawnBot(config) {
  const { profile } = config

  if (managers.has(profile)) {
    const existing = managers.get(profile)
    if (existing.state !== BotState.STOPPED && existing.state !== BotState.FAILED) {
      console.warn(`[ORCH] "${profile}" is already running (state: ${existing.state})`)
      return existing
    }
    // Allow re-spawning a stopped/failed manager by replacing it
    managers.delete(profile)
  }

  const manager = new BotManager(config)
  managers.set(profile, manager)

  manager.on('stateChange', (snapshot) => {
    console.log(`[ORCH] [${snapshot.profile}] → ${snapshot.state}`)
    EventBus.emit('bot:stateChange', snapshot)
  })

  manager.on('reconnecting', (data) => {
    const secs = (data.delay / 1000).toFixed(1)
    console.log(`[ORCH] [${data.profile}] Reconnecting in ${secs}s (attempt ${data.attempt})`)
    EventBus.emit('bot:reconnecting', data)
  })

  manager.on('error', (data) => {
    console.error(`[ORCH] [${data.profile}] Error — ${data.error.message}`)
    EventBus.emit('bot:error', data)
  })

  manager.start()
  return manager
}

/**
 * Stops a running bot and prevents reconnection.
 * @param {string} profileName
 */
function stopBot(profileName) {
  const manager = managers.get(profileName)
  if (!manager) {
    console.warn(`[ORCH] No manager found for "${profileName}"`)
    return
  }
  manager.stop()
}

/**
 * Returns a snapshot of every managed bot's current state.
 * Useful as the initial data fetch for a GUI.
 * @returns {Array<{ profile: string, state: string, attempt: number, uptime: number|null }>}
 */
function getBotStates() {
  return Array.from(managers.values()).map(m => m.getSnapshot())
}

// ── CLI entry point ───────────────────────────────────────────────────────────
if (require.main === module) {
  const profiles = process.argv.slice(2)

  if (profiles.length === 0) {
    console.error('Usage:   node orchestrator.js <profile1> [profile2] ...')
    console.error('Example: node orchestrator.js sentinel')
    console.error('         node orchestrator.js sentinel trader')
    process.exit(1)
  }

  for (const profile of profiles) {
    spawnBot({
      profile,
      reconnect: true,
      maxRetries: Infinity,
      baseDelayMs: 5000,
    })
  }

  // Graceful shutdown on Ctrl+C — stop all bots before exiting
  process.on('SIGINT', () => {
    console.log('\n[ORCH] SIGINT received — stopping all bots...')
    for (const manager of managers.values()) manager.stop()
    // Give bots a moment to send clean disconnect packets
    setTimeout(() => process.exit(0), 1500)
  })
}

module.exports = { spawnBot, stopBot, getBotStates, EventBus, BotState }
