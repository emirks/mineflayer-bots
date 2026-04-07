const skills = require('../lib/skills')

// Drop all (or a fixed count) of the given item(s) from the bot's inventory.
// options.items  — array of item names, e.g. ['spawner', 'chest']
// options.item   — single item name shorthand (ignored when items is provided)
// options.count  — number to drop per item; -1 (default) = drop entire stack
async function dropItems(bot, options) {
  const { item, items, count = -1 } = options

  const targets = items ?? (item ? [item] : [])

  if (targets.length === 0) {
    bot.log.warn('[ACTION] dropItems: no item(s) specified — skipping.')
    return
  }

  for (const itemName of targets) {
    const inv = bot.inventory.items().filter(i => i.name === itemName)

    if (inv.length === 0) {
      bot.log.info(`[ACTION] dropItems: no "${itemName}" in inventory — skipping.`)
      continue
    }

    const total    = inv.reduce((sum, i) => sum + i.count, 0)
    const dropping = count === -1 ? total : Math.min(count, total)
    bot.log.info(`[ACTION] dropItems: ${total} × "${itemName}" in inventory — dropping ${dropping}...`)

    await skills.discard(bot, itemName, count)
  }
}

module.exports = dropItems
