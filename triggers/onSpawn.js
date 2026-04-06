// Trigger: onSpawn
//
// Fires the action stack exactly once, `delayMs` milliseconds after the bot spawns.
// Because triggers are registered inside the 'spawn' event in bot.js, the delay
// is relative to the moment the bot is in the world.

function register(bot, options, fire) {
  const { delayMs = 10000 } = options

  console.log(`[TRIGGER] onSpawn armed — firing in ${delayMs}ms`)

  setTimeout(() => {
    console.log(`[TRIGGER] onSpawn fired`)
    fire({})
  }, delayMs)
}

module.exports = register
