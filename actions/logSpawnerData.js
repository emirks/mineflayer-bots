const world = require('../lib/world')

// One-shot diagnostic: finds the nearest spawner and logs its stack count via
// world.getSpawnerStackCount() (opens the GUI, reads the window title).
//
// Options:
//   radius      (default 32)  — block search radius for the spawner
async function logSpawnerData(bot, options) {
  const { radius = 32 } = options

  const block = world.getNearestBlock(bot, 'spawner', radius)

  if (!block) {
    bot.log.warn(`[SPAWNER-PROBE] No spawner found within ${radius} blocks`)
    return
  }

  const pos = block.position
  bot.log.info(`[SPAWNER-PROBE] spawner @ (${pos.x}, ${pos.y}, ${pos.z})`)

  const count = await world.getSpawnerStackCount(bot, block)

  if (count !== null) {
    bot.log.info(`[SPAWNER-PROBE] ✓ Stack count = ${count}`)
  } else {
    bot.log.warn('[SPAWNER-PROBE] Could not read stack count (window did not open or title unparseable)')
  }
}

module.exports = logSpawnerData
