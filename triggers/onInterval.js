// Trigger: onInterval
//
// Fires the action stack on a recurring schedule, indefinitely.
// Unlike onSpawn (fires once), this keeps firing until the session ends.
//
// Options:
//   intervalMs  — milliseconds between each fire (default: 300 000 = 5 min)
//
// Typical use: periodic scans, environment logging, status reports.
// Set a low priority (e.g. -1) so defensive triggers always run first.

function register(bot, options, fire) {
  const { intervalMs = 300_000 } = options

  bot.log.info(`[TRIGGER] onInterval armed — every ${intervalMs / 1000}s`)

  const interval = setInterval(() => {
    if (bot._quitting) return
    fire({})
  }, intervalMs)

  return { cancel: () => clearInterval(interval) }
}

module.exports = register
