const world  = require('../lib/world')
const skills = require('../lib/skills')

// Find the nearest matching block via world, then dig it via skills.
// skills.breakBlockAt handles the dig call and awaits the full break animation.
async function breakBlock(bot, options) {
  const { blockName = 'crafting_table', searchRadius = 64 } = options

  const block = world.getNearestBlock(bot, blockName, searchRadius)

  if (!block) {
    bot.log.info(`[ACTION] No "${blockName}" found within ${searchRadius} blocks — skipping.`)
    return
  }

  const { x, y, z } = block.position
  bot.log.info(`[ACTION] Breaking "${blockName}" at (${x}, ${y}, ${z})...`)
  await skills.breakBlockAt(bot, x, y, z)
}

module.exports = breakBlock
