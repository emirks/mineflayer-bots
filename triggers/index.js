const { executeActions } = require('../actions')

// ─── Trigger registry ─────────────────────────────────────────────────────────
// Add new trigger types here by mapping a name to its handler module.
const registry = {
  playerRadius: require('./playerRadius'),
  blockNearby: require('./blockNearby'),
  onSpawn: require('./onSpawn'),
}

// ─── Global action chain queue ────────────────────────────────────────────────
// All action stacks are serialized through this single promise chain.
//
// WHY: triggers (sensing) run in parallel — that is correct and intentional.
// But mineflayer's pathfinder, dig, and openChest are single-instance; if two
// triggers fire close together and both start executeActions concurrently, one
// chain will silently cancel the other's pathfinder goal and corrupt shared bot
// state.  Serializing *execution* (not sensing) prevents that while keeping all
// polling intervals fully concurrent.
//
// HOW: each fire() call appends its chain as a .then() on the current tail.
// The queue is self-managing — no locks or mutexes needed.
//
// PANIC EXCEPTION: playerRadius calls bot.quit() directly, bypassing this queue.
// That is intentional — emergency disconnect must be instant.
let actionChain = Promise.resolve()

// Resolves a trigger config, builds the fire() callback that runs its action
// stack, and hands both to the trigger handler.
function registerTrigger(bot, triggerConfig) {
  const handler = registry[triggerConfig.type]

  if (!handler) {
    console.warn(`[TRIGGER] Unknown trigger type "${triggerConfig.type}" — skipping.`)
    return
  }

  const label = triggerConfig.type

  // fire() is the bridge between a trigger and its action stack.
  // The trigger calls fire(context) and knows nothing about what actions run.
  // context carries trigger-specific data (e.g. { username, distance } from
  // playerRadius, { block } from blockNearby) so actions can use it directly
  // instead of re-querying the world.
  const fire = (context = {}) => {
    if (bot._quitting) return Promise.resolve()

    console.log(`[TRIGGER] "${label}" queuing action chain`)

    actionChain = actionChain.then(() => {
      if (bot._quitting) return
      return executeActions(bot, triggerConfig.actions, context).catch((err) =>
        console.error(`[TRIGGER] "${label}" action chain error — ${err.message}`)
      )
    })

    return actionChain
  }

  handler(bot, triggerConfig.options || {}, fire)
  console.log(`[TRIGGER] Registered "${triggerConfig.type}"`)
}

module.exports = { registerTrigger }
