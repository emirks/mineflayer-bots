const { executeActions } = require('../actions')

// ─── Trigger registry ─────────────────────────────────────────────────────────
// Add new trigger types here by mapping a name to its handler module.
const registry = {
  playerRadius: require('./playerRadius'),
  blockNearby: require('./blockNearby'),
  onSpawn: require('./onSpawn'),
  onInterval: require('./onInterval'),
}

// ─── createTriggerRegistry ────────────────────────────────────────────────────
// Factory: creates one isolated trigger registry for a single bot session.
// Call this once per session; do NOT share registries across sessions.
//
// Returns { registerTrigger, stopAll }
//   registerTrigger(bot, triggerConfig) — sets up one trigger's polling + fire()
//   stopAll()                           — cancels all polling intervals/timeouts
//
// ── Concurrency model ─────────────────────────────────────────────────────────
//   Trigger polling  → fully parallel  (independent setIntervals — unchanged)
//   Action execution → serialised through a priority queue
//
// ── Priority queue ────────────────────────────────────────────────────────────
//   Add `priority: <number>` to a trigger config (default 0).
//   Higher values run before lower values among *queued* (not yet started) chains.
//   A CURRENTLY-RUNNING chain is NEVER preempted.
//   For genuine emergency interruption, use the panic path (direct bot.quit()).
//
//   Example: safety trigger runs before routine farming trigger
//     { type: 'playerRadius', priority: 10, options: {...}, actions: [...] }
//     { type: 'blockNearby',  priority: 0,  options: {...}, actions: [...] }
//
//   Array.sort is stable in Node.js 12+ (V8 TimSort) so equal-priority items
//   remain in FIFO insertion order.
//
// ── Cleanup handles ───────────────────────────────────────────────────────────
//   Each trigger handler may return { cancel() } to clean up its interval/timer.
//   stopAll() calls every registered cancel() — required for clean session teardown
//   in multi-bot mode where sessions end without process.exit().

function createTriggerRegistry() {
  let running = false
  const queue = []   // { priority, label, fn }
  const cleanups = []   // cancel() functions returned by trigger handlers

  // Drains the queue, highest-priority first, one chain at a time.
  async function flush() {
    if (running) return
    running = true

    while (queue.length > 0) {
      // Re-sort before each dequeue so a high-priority item enqueued WHILE the
      // previous chain was running still runs before lower-priority waiting items.
      queue.sort((a, b) => b.priority - a.priority)
      const task = queue.shift()
      await task.fn()
    }

    running = false
  }

  function registerTrigger(bot, triggerConfig) {
    const handler = registry[triggerConfig.type]

    if (!handler) {
      bot.log.warn(`[TRIGGER] Unknown trigger type "${triggerConfig.type}" — skipping.`)
      return
    }

    const label = triggerConfig.type
    const priority = triggerConfig.priority ?? 0

    // fire() is the bridge between a trigger and its action stack.
    // The trigger calls fire(context) — it knows nothing about what runs.
    // context carries trigger-specific data so actions can use it directly.
    const baseZone = triggerConfig.baseZone   // optional: { radius: <blocks> }

    // Edge-triggered: track whether we're already known to be out of base so
    // we log once on the transition out, once on the transition back, and stay
    // silent in between — no matter how often the trigger fires.
    let outOfBase = false

    const fire = (context = {}) => {
      if (bot._quitting) return Promise.resolve()

      // ── Base zone guard ───────────────────────────────────────────────────
      // If the trigger declares a baseZone, skip action chain when the bot is
      // outside that radius from its recorded spawn position (bot._base).
      // Sensing (the trigger's polling interval) keeps running — this only
      // blocks the action chain, not the detection.
      if (baseZone && bot._base) {
        const dist = bot.entity?.position?.distanceTo(bot._base) ?? Infinity
        if (dist > baseZone.radius) {
          if (!outOfBase) {
            outOfBase = true
            bot.log.warn(
              `[TRIGGER] "${label}" — left base region (${dist.toFixed(1)} blocks from base, limit ${baseZone.radius}). Actions paused until return.`
            )
          }
          return Promise.resolve()
        }
        // Transitioned back inside base
        if (outOfBase) {
          outOfBase = false
          const dist2 = bot.entity?.position?.distanceTo(bot._base) ?? 0
          bot.log.info(
            `[TRIGGER] "${label}" — returned to base region (${dist2.toFixed(1)} blocks from base). Actions resumed.`
          )
        }
      }

      bot.log.info(`[TRIGGER] "${label}" queuing action chain (priority ${priority})`)

      // Each fire() returns a Promise that resolves when THIS chain finishes
      // (after waiting its turn in the queue).
      return new Promise((resolve) => {
        queue.push({
          priority,
          label,
          fn: async () => {
            if (bot._quitting) { resolve(); return }
            await executeActions(bot, triggerConfig.actions, context).catch((err) =>
              bot.log.error(`[TRIGGER] "${label}" action chain error — ${err.message}`)
            )
            resolve()
          },
        })
        flush().catch((err) =>
          bot.log.error(`[TRIGGER] Queue flush error — ${err.message}`)
        )
      })
    }

    // handler() may return { cancel() } to clean up its interval/timer on session end
    // Forward trigger-level baseZone into handlerOptions so handlers with internal
    // state machines (e.g. playerRadius panic watch) can respect it independently
    // of the fire() guard — without having to duplicate the check in profiles.
    const handlerOptions = triggerConfig.baseZone != null
      ? { ...(triggerConfig.options || {}), baseZone: triggerConfig.baseZone }
      : (triggerConfig.options || {})
    const cleanup = handler(bot, handlerOptions, fire)
    if (cleanup?.cancel) cleanups.push(cleanup.cancel)

    bot.log.info(`[TRIGGER] Registered "${label}" (priority ${priority})`)
  }

  function stopAll() {
    for (const fn of cleanups) {
      try { fn() } catch { /* interval already cleared */ }
    }
  }

  return { registerTrigger, stopAll }
}

module.exports = { createTriggerRegistry }
