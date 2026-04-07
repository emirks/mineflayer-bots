const { executeActions } = require('../actions')

// ─── Trigger registry ─────────────────────────────────────────────────────────
// Add new trigger types here by mapping a name to its handler module.
const registry = {
  playerRadius: require('./playerRadius'),
  blockNearby: require('./blockNearby'),
  onSpawn: require('./onSpawn'),
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
  const queue = []    // { priority, label, fn }
  const cleanups = [] // cancel() functions returned by trigger handlers

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
      console.warn(`[TRIGGER] Unknown trigger type "${triggerConfig.type}" — skipping.`)
      return
    }

    const label = triggerConfig.type
    const priority = triggerConfig.priority ?? 0

    // fire() is the bridge between a trigger and its action stack.
    // The trigger calls fire(context) — it knows nothing about what runs.
    // context carries trigger-specific data so actions can use it directly.
    const fire = (context = {}) => {
      if (bot._quitting) return Promise.resolve()

      console.log(`[TRIGGER] "${label}" queuing action chain (priority ${priority})`)

      // Each fire() returns a Promise that resolves when THIS chain finishes
      // (after waiting its turn in the queue).
      return new Promise((resolve) => {
        queue.push({
          priority,
          label,
          fn: async () => {
            if (bot._quitting) { resolve(); return }
            await executeActions(bot, triggerConfig.actions, context).catch((err) =>
              console.error(`[TRIGGER] "${label}" action chain error — ${err.message}`)
            )
            resolve()
          },
        })
        flush().catch((err) =>
          console.error('[TRIGGER] Queue flush error —', err.message)
        )
      })
    }

    // handler() may return { cancel() } to clean up its interval/timer on session end
    const cleanup = handler(bot, triggerConfig.options || {}, fire)
    if (cleanup?.cancel) cleanups.push(cleanup.cancel)

    console.log(`[TRIGGER] Registered "${label}" (priority ${priority})`)
  }

  function stopAll() {
    for (const fn of cleanups) {
      try { fn() } catch { /* interval already cleared */ }
    }
  }

  return { registerTrigger, stopAll }
}

module.exports = { createTriggerRegistry }
