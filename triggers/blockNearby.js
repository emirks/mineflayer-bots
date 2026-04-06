const world = require('../lib/world')

// Trigger: blockNearby
//
// Scans on a fixed interval for the nearest block of a given type.
// Fires the action stack the first time one is found within `radius` blocks.
// Like playerRadius, it fires at most once and cancels its own interval.

function register(bot, options, fire) {
  const {
    blockName = 'chest',
    radius = 20,
    checkIntervalMs = 1000,
  } = options

  let triggered = false

  const interval = setInterval(() => {
    if (!bot.entity) return

    const block = world.getNearestBlock(bot, blockName, radius)
    if (!triggered && block) {
      triggered = true
      clearInterval(interval)

      const { x, y, z } = block.position
      console.log(`\n[⚠ ALERT] "${blockName}" found within ${radius} blocks at (${x}, ${y}, ${z})`)

      fire({ block })
    }
  }, checkIntervalMs)
}

module.exports = register
