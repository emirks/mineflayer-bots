const world = require('../lib/world')

// Trigger: playerRadius
//
// Three independent radii, each with its own behaviour:
//
//   printRadius  — log every player closer than this on every slow tick
//   alertRadius  — fire the configured action stack once (e.g. break tables)
//                  and immediately switch to a fast panic watch
//   panicRadius  — if any player closes in to this distance at any point after
//                  the alert, call bot.quit() instantly regardless of what
//                  actions are still running
//
// Timing:
//   checkIntervalMs — slow scan rate (print + alert check)
//   panicIntervalMs — fast scan rate used only after alert fires

function register(bot, options, fire) {
  const {
    printRadius = 50,
    alertRadius = 20,
    panicRadius = 5,
    checkIntervalMs = 500,
    panicIntervalMs = 100,
  } = options

  let alerted = false
  let panicked = false

  // ── Slow interval: distance logging + alert check ──────────────────────────
  const slowInterval = setInterval(() => {
    if (!bot.entity) return

    const visible = world.getNearbyPlayers(bot, printRadius)
    for (const entity of visible) {
      const distance = bot.entity.position.distanceTo(entity.position)
      console.log(`[DIST]    ${entity.username.padEnd(16)} → ${distance.toFixed(2)} blocks`)
    }

    if (!alerted) {
      const closest = world.getNearestEntityWhere(
        bot,
        e => e.type === 'player' && e.username !== bot.username,
        alertRadius,
      )

      if (closest) {
        alerted = true
        clearInterval(slowInterval)

        const distance = bot.entity.position.distanceTo(closest.position)
        console.log(
          `\n[⚠ ALERT] ${closest.username} entered ${alertRadius}-block radius! ` +
          `Distance: ${distance.toFixed(2)} blocks — starting actions + panic watch`
        )

        // Kick off action stack (async, non-blocking)
        fire({ username: closest.username, distance })

        // Immediately arm the fast panic watch
        startPanicWatch()
      }
    }
  }, checkIntervalMs)

  // ── Fast interval: emergency disconnect if player gets too close ───────────
  function startPanicWatch() {
    const fastInterval = setInterval(() => {
      if (panicked || !bot.entity) return

      const closest = world.getNearestEntityWhere(
        bot,
        e => e.type === 'player' && e.username !== bot.username,
        panicRadius,
      )

      if (closest) {
        panicked = true
        clearInterval(fastInterval)

        const distance = bot.entity.position.distanceTo(closest.position)
        console.log(
          `\n[🚨 PANIC] ${closest.username} within ${panicRadius} blocks ` +
          `(${distance.toFixed(2)}) — emergency disconnect!`
        )

        bot.quit()
      }
    }, panicIntervalMs)
  }
}

module.exports = register
