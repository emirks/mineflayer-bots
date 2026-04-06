const world = require('../lib/world')

// Trigger: playerRadius
//
// Scans all loaded player entities on a fixed interval using world.getNearbyPlayers.
// Two independent radii:
//   printRadius — log every player closer than this on every tick (informational)
//   alertRadius — fire the action stack the first time any player crosses this
//
// Fires at most once; cancels its own interval the moment it trips.

function register(bot, options, fire) {
  const {
    printRadius = 50,
    alertRadius = 26,
    checkIntervalMs = 500,
  } = options

  let triggered = false

  const interval = setInterval(() => {
    if (!bot.entity) return

    // ── Distance logging ─────────────────────────────────────────────────────
    // getNearbyPlayers returns entities sorted nearest-first, self excluded.
    const visible = world.getNearbyPlayers(bot, printRadius)
    for (const entity of visible) {
      const distance = bot.entity.position.distanceTo(entity.position)
      console.log(`[DIST]    ${entity.username.padEnd(16)} → ${distance.toFixed(2)} blocks`)
    }

    // ── Alert check ──────────────────────────────────────────────────────────
    if (!triggered) {
      const closest = world.getNearestEntityWhere(
        bot,
        e => e.type === 'player' && e.username !== bot.username,
        alertRadius,
      )

      if (closest) {
        triggered = true
        clearInterval(interval)

        const distance = bot.entity.position.distanceTo(closest.position)
        console.log(
          `\n[⚠ ALERT] ${closest.username} crossed the ${alertRadius}-block alert radius! ` +
          `Distance: ${distance.toFixed(2)} blocks`
        )

        fire({ username: closest.username, distance })
      }
    }
  }, checkIntervalMs)
}

module.exports = register
