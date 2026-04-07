// Disconnects the bot from the server.
// bot.quit() sends a clean disconnect packet — the 'end' event in createBotSession
// will fire afterward and settle the session promise.
async function disconnect(bot) {
  bot.log.info('[ACTION] Disconnecting...')
  // Set the quitting flag so any queued action chains abort cleanly instead of
  // issuing bot commands to a closing socket.
  bot._quitting = true
  // Stop pathfinder so any in-flight goto() rejects immediately rather than
  // waiting for the socket-close error to propagate through mineflayer.
  if (bot.pathfinder) bot.pathfinder.stop()
  bot.quit()
}

module.exports = disconnect
