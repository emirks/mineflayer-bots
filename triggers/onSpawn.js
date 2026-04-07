// Trigger: onSpawn
//
// Fires the action stack exactly once, `delayMs` milliseconds after the bot spawns.
// Because triggers are registered inside the 'spawn' event in bot.js, the delay
// is relative to the moment the bot is in the world.

function register(bot, options, fire) {
  const { delayMs = 10000 } = options

  bot.log.info(`[TRIGGER] onSpawn armed — firing in ${delayMs}ms`)

  const timer = setTimeout(() => {
    bot.log.info('[TRIGGER] onSpawn fired')
    fire({})
  }, delayMs)

  return { cancel: () => clearTimeout(timer) }
}

module.exports = register
