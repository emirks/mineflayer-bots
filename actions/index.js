// ─── Action registry ──────────────────────────────────────────────────────────
// Add new action types here by mapping a name to its handler module.
const registry = {
  breakBlock:    require('./breakBlock'),
  disconnect:    require('./disconnect'),
  goToBlock:     require('./goToBlock'),
  takeFromChest: require('./takeFromChest'),
  pickupItems:   require('./pickupItems'),
}

// Runs an ordered list of action configs sequentially.
// Each action is fully awaited before the next one starts, which is what makes
// stacking work correctly (e.g. dig finishes → THEN disconnect fires).
async function executeActions(bot, actionConfigs) {
  for (const actionConfig of actionConfigs) {
    const handler = registry[actionConfig.type]

    if (!handler) {
      console.warn(`[ACTION] Unknown action type "${actionConfig.type}" — skipping.`)
      continue
    }

    console.log(`[ACTION] → ${actionConfig.type}`)
    await handler(bot, actionConfig.options || {})
  }
}

module.exports = { executeActions }
