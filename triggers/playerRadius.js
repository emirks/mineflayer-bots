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

        bot._alertTime = Date.now()
        const distance = bot.entity.position.distanceTo(closest.position)
        console.log(
          `\n[TRIGGER] ALERT — ${closest.username} within ${alertRadius} blocks ` +
          `(${distance.toFixed(2)} m) — running action stack + arming panic watch`
        )

        // Kick off action stack (async, non-blocking).
        // Chain .then() here — not in any action — because this trigger owns the timer.
        fire({ username: closest.username, distance }).then(() => {
          const elapsed = ((Date.now() - bot._alertTime) / 1000).toFixed(2)
          console.log(`[TRIGGER] Action chain finished — ${elapsed}s since alert.`)
        })

        // Immediately arm the fast panic watch
        startPanicWatch()
      }
    }
  }, checkIntervalMs)

  // ── Fast interval: emergency disconnect if player gets too close ───────────
  function startPanicWatch() {
    // panicRadius <= 0 means "panic watch disabled" — skip silently.
    // Without this guard, the condition `distanceTo < 0` would never be true
    // and the interval would run forever doing nothing useful.
    if (panicRadius <= 0) {
      console.log('[TRIGGER] panicRadius ≤ 0 — panic watch disabled')
      return
    }

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
        const elapsed = bot._alertTime ? ((Date.now() - bot._alertTime) / 1000).toFixed(2) : '?'
        console.log(
          `\n[TRIGGER] PANIC — ${closest.username} within ${panicRadius} blocks ` +
          `(${distance.toFixed(2)} m) — emergency disconnect! (+${elapsed}s since alert)`
        )

        // Signal the action executor to abort any in-flight chain before we
        // kill the connection.  The executor checks this flag at each step so
        // it stops issuing bot commands to a closing socket.
        bot._quitting = true
        // Stop pathfinder immediately so any awaiting goto() rejects right now
        // instead of waiting for the socket-close error to propagate.
        if (bot.pathfinder) bot.pathfinder.stop()
        bot.quit()
      }
    }, panicIntervalMs)
  }
}

module.exports = register
