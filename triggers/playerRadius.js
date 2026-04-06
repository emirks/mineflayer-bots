// Trigger: playerRadius
//
// Scans all loaded player entities on a fixed interval.
// Two independent radii:
//   printRadius — log the player's distance on every tick (informational)
//   alertRadius — fire the action stack the first time any player crosses this
//
// The trigger fires at most once per registration (guarded by `triggered`).
// It cancels its own interval as soon as the action stack is kicked off so
// no further scans run while actions are executing.

function register(bot, options, fire) {
  const {
    printRadius = 50,
    alertRadius = 26,
    checkIntervalMs = 500,
  } = options

  let triggered = false

  const interval = setInterval(() => {
    if (!bot.entity) return

    for (const entity of Object.values(bot.entities)) {
      if (entity.type !== 'player') continue
      if (!entity.username || entity.username === bot.username) continue

      const distance = bot.entity.position.distanceTo(entity.position)

      // ── Distance logging ────────────────────────────────────────────────
      if (distance <= printRadius) {
        console.log(`[DIST]    ${entity.username.padEnd(16)} → ${distance.toFixed(2)} blocks`)
      }

      // ── Alert check ─────────────────────────────────────────────────────
      if (!triggered && distance <= alertRadius) {
        triggered = true
        clearInterval(interval)

        console.log(
          `\n[⚠ ALERT] ${entity.username} crossed the ${alertRadius}-block alert radius! ` +
          `Distance: ${distance.toFixed(2)} blocks`
        )

        fire({ username: entity.username, distance })
      }
    }
  }, checkIntervalMs)
}

module.exports = register
