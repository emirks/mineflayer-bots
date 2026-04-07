// Disconnects the bot from the server.
// bot.quit() sends a clean disconnect packet — the 'end' event in bot.js will
// fire afterward and handle process exit.
async function disconnect(bot) {
  const elapsed = bot._alertTime
    ? ((Date.now() - bot._alertTime) / 1000).toFixed(2)
    : null

  if (elapsed !== null) {
    console.log(`[ACTION] Disconnecting — ${elapsed}s elapsed since alert.`)
  } else {
    console.log('[ACTION] Disconnecting...')
  }

  bot.quit()
}

module.exports = disconnect
