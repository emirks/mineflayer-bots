// ─── Action registry ──────────────────────────────────────────────────────────
// Add new action types here by mapping a name to its handler module.
const registry = {
  breakBlock: require('./breakBlock'),
  breakAllBlocks: require('./breakAllBlocks'),
  disconnect: require('./disconnect'),
  dropItems: require('./dropItems'),
  goToBlock: require('./goToBlock'),
  takeFromChest: require('./takeFromChest'),
  pickupItems: require('./pickupItems'),
  sendChat: require('./sendChat'),
  startDebugScan: require('./startDebugScan'),
}

// Runs an ordered list of action configs sequentially.
//
// context  — data from the trigger that fired this chain (e.g. { block } from
//            blockNearby, { username, distance } from playerRadius).  Passed as
//            the third argument to every handler; existing actions ignore it,
//            new actions can use it to avoid redundant world re-queries.
//
// Each action is fully awaited before the next one starts.
// Per-action opt-in timeout: add timeoutMs to an action's options object and
// the step is aborted (with a warning) if it exceeds that duration, allowing
// the chain to continue rather than hanging forever on a stuck pathfinder.
//
// The loop checks bot._quitting at every step so a panic disconnect (or the
// disconnect action itself) stops the chain immediately instead of issuing
// further commands to a closing socket.
async function executeActions(bot, actionConfigs, context = {}) {
  for (const actionConfig of actionConfigs) {
    if (bot._quitting) {
      console.log('[ACTION] Bot is disconnecting — aborting action chain.')
      break
    }

    const handler = registry[actionConfig.type]

    if (!handler) {
      console.warn(`[ACTION] Unknown action type "${actionConfig.type}" — skipping.`)
      continue
    }

    const opts = actionConfig.options || {}
    console.log(`[ACTION] → ${actionConfig.type}`)

    try {
      const run = handler(bot, opts, context)

      if (opts.timeoutMs) {
        const timeout = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`timed out after ${opts.timeoutMs}ms`)),
            opts.timeoutMs
          )
        )
        await Promise.race([run, timeout])
      } else {
        await run
      }
    } catch (err) {
      console.warn(`[ACTION] "${actionConfig.type}" failed — ${err.message} — continuing.`)
    }
  }
}

module.exports = { executeActions }
