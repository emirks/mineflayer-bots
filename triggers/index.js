const { executeActions } = require('../actions')

// ─── Trigger registry ─────────────────────────────────────────────────────────
// Add new trigger types here by mapping a name to its handler module.
const registry = {
  playerRadius: require('./playerRadius'),
  blockNearby:  require('./blockNearby'),
}

// Resolves a trigger config, builds the fire() callback that runs its action
// stack, and hands both to the trigger handler.
function registerTrigger(bot, triggerConfig) {
  const handler = registry[triggerConfig.type]

  if (!handler) {
    console.warn(`[TRIGGER] Unknown trigger type "${triggerConfig.type}" — skipping.`)
    return
  }

  // fire() is the bridge between a trigger and its action stack.
  // The trigger calls fire() and knows nothing about what actions will run.
  const fire = (context) =>
    executeActions(bot, triggerConfig.actions).catch((err) =>
      console.error(`[TRIGGER] Action chain error — ${err.message}`)
    )

  handler(bot, triggerConfig.options || {}, fire)
  console.log(`[TRIGGER] Registered "${triggerConfig.type}"`)
}

module.exports = { registerTrigger }
