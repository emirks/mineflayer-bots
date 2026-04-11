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
//
// Whitelist / Blacklist (optional arrays of usernames, case-insensitive):
//   whitelist — safe allies; only ever logged with [WL] tag, never trigger alert or panic
//   blacklist — hostile targets; panic immediately at alertRadius (skip action queue)

function register(bot, options, fire) {
  const {
    printRadius = 50,
    alertRadius = 20,
    panicRadius = 5,
    checkIntervalMs = 500,
    panicIntervalMs = 100,
    whitelist = [],
    blacklist = [],
    baseZone = null,   // forwarded from triggerConfig.baseZone by registerTrigger
  } = options

  // Normalise lists to lower-case sets for O(1) lookup
  const wlSet = new Set(whitelist.map(n => n.toLowerCase()))
  const blSet = new Set(blacklist.map(n => n.toLowerCase()))

  const isWhitelisted = name => wlSet.size > 0 && wlSet.has(name.toLowerCase())
  const isBlacklisted = name => blSet.size > 0 && blSet.has(name.toLowerCase())

  let alerted = false
  let panicked = false
  // Hoisted so cancel() can clear it even if startPanicWatch() was called.
  let fastInterval = null

  // Tracks the last logged position (rounded to 2 dp) per username as a string key.
  // Position-based comparison handles circular movement where distance stays constant.
  const prevPos = new Map()   // username → "x,y,z" string at 2 dp

  function distTag(username) {
    return isWhitelisted(username) ? '[WL]' : isBlacklisted(username) ? '[BL]' : '    '
  }

  // Returns false when the bot is outside its declared base zone.
  // If baseZone is not configured (or bot._base is not yet set), always returns true.
  function isInBaseZone() {
    if (!baseZone || !bot._base || !bot.entity?.position) return true
    return bot.entity.position.distanceTo(bot._base) <= baseZone.radius
  }

  // ── Shared emergency disconnect (used by both blacklist and panic watch) ────
  function triggerPanic(username, distance, source) {
    if (panicked) return
    panicked = true
    clearInterval(fastInterval)

    const elapsed = bot._alertTime
      ? ((Date.now() - bot._alertTime) / 1000).toFixed(2)
      : '?'

    bot.log.error(
      `[TRIGGER] PANIC — ${username} within ${source} range ` +
      `(${distance.toFixed(2)} m) — emergency disconnect!` +
      (bot._alertTime ? ` (+${elapsed}s since alert)` : ''),
    )

    bot._quitting = true
    if (bot.pathfinder) bot.pathfinder.stop()
    bot.quit()
  }

  // ── Slow interval: distance logging + alert check ──────────────────────────
  const slowInterval = setInterval(() => {
    if (!bot.entity) return

    // ── Print-radius distance log (change-only) ───────────────────────────────
    const visible = world.getNearbyPlayers(bot, printRadius)
    const currentNames = new Set()

    for (const entity of visible) {
      const p = entity.position
      const posKey = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`
      currentNames.add(entity.username)

      if (prevPos.get(entity.username) !== posKey) {
        prevPos.set(entity.username, posKey)
        const dist = bot.entity.position.distanceTo(p)
        bot.log.info(
          `[DIST]${distTag(entity.username)} ${entity.username.padEnd(16)}` +
          ` → ${dist.toFixed(2)} blocks  (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`,
        )
      }
    }

    // Players who left the detection area since last tick
    for (const [username] of prevPos) {
      if (!currentNames.has(username)) {
        prevPos.delete(username)
        bot.log.info(`[DIST]${distTag(username)} ${username.padEnd(16)} → out of detection area`)
      }
    }

    if (alerted || panicked) return

    // ── Alert-radius check ────────────────────────────────────────────────────
    const closestInAlert = world.getNearestEntityWhere(
      bot,
      e => e.type === 'player' && e.username !== bot.username && !isWhitelisted(e.username),
      alertRadius,
    )

    if (!closestInAlert) return

    const distance = bot.entity.position.distanceTo(closestInAlert.position)

    if (isBlacklisted(closestInAlert.username)) {
      // Blacklisted player — skip action queue, panic immediately
      bot._alertTime = Date.now()
      bot.log.warn(
        `[TRIGGER] BLACKLIST ALERT — ${closestInAlert.username} within ${alertRadius} blocks ` +
        `(${distance.toFixed(2)} m) — panicking immediately`,
      )
      clearInterval(slowInterval)
      triggerPanic(closestInAlert.username, distance, `alertRadius (${alertRadius} blocks, blacklisted)`)
      return
    }

    // Outside base zone — suppress the entire alert response so the bot never
    // arms the panic watch while it's been teleported away by server maintenance
    // or similar events. The slow interval keeps running so detection resumes
    // automatically once the bot returns to base.
    if (!isInBaseZone()) {
      const baseDist = bot._base
        ? bot.entity.position.distanceTo(bot._base).toFixed(1)
        : '?'
      bot.log.info(
        `[TRIGGER] "${closestInAlert.username}" at alertRadius but bot is outside base zone ` +
        `(${baseDist} m from base, limit ${baseZone.radius}) — alert suppressed`,
      )
      return
    }

    // Normal (unlisted) player — fire action stack + arm panic watch
    bot._alertTime = Date.now()
    alerted = true
    clearInterval(slowInterval)

    // Signal any running background action (survey etc.) to abort at its next
    // checkpoint so the sweep can dequeue and start as soon as possible.
    bot._sweepPending = true

    bot.log.warn(
      `[TRIGGER] ALERT — ${closestInAlert.username} within ${alertRadius} blocks ` +
      `(${distance.toFixed(2)} m) — running action stack + arming panic watch`,
    )

    fire({ username: closestInAlert.username, distance }).then(() => {
      const elapsed = ((Date.now() - bot._alertTime) / 1000).toFixed(2)
      bot.log.info(`[TRIGGER] Action chain finished — ${elapsed}s since alert.`)
    })

    startPanicWatch()
  }, checkIntervalMs)

  // ── Fast interval: emergency disconnect if player gets too close ───────────
  function startPanicWatch() {
    // panicRadius <= 0 means "panic watch disabled" — skip silently.
    if (panicRadius <= 0) {
      bot.log.info('[TRIGGER] panicRadius ≤ 0 — panic watch disabled')
      return
    }

    fastInterval = setInterval(() => {
      if (panicked || !bot.entity) return

      const closest = world.getNearestEntityWhere(
        bot,
        // Whitelisted players never trigger panic
        e => e.type === 'player' && e.username !== bot.username && !isWhitelisted(e.username),
        panicRadius,
      )

      if (closest) {
        const distance = bot.entity.position.distanceTo(closest.position)
        triggerPanic(closest.username, distance, `panicRadius (${panicRadius} blocks)`)
      }
    }, panicIntervalMs)
  }

  // Return cancel handles so createTriggerRegistry can stop all polling on
  // session end (required for clean teardown in multi-bot / reconnect mode).
  return {
    cancel() {
      clearInterval(slowInterval)
      if (fastInterval) clearInterval(fastInterval)
    },
  }
}

module.exports = register
