const skills = require('../lib/skills')

// Navigate to the nearest block of the given type using mineflayer-pathfinder.
async function goToBlock(bot, options) {
  const { blockName = 'chest', minDistance = 2, searchRadius = 64 } = options
  bot.log.info(`[ACTION] Navigating to nearest "${blockName}"...`)
  const reached = await skills.goToNearestBlock(bot, blockName, minDistance, searchRadius)
  if (!reached) bot.log.warn(`[ACTION] Could not reach "${blockName}".`)
}

module.exports = goToBlock
