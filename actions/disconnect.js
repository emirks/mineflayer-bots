// Disconnects the bot from the server.
// bot.quit() sends a clean disconnect packet — the 'end' event in bot.js will
// fire afterward and handle process exit.
async function disconnect(bot) {
  console.log('[ACTION] Disconnecting...')
  bot.quit()
}

module.exports = disconnect
