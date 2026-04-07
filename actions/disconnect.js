// Disconnects the bot from the server.
// bot.quit() sends a clean disconnect packet — the 'end' event in bot.js will
// fire afterward and handle process exit.
async function disconnect(bot) {
  console.log('[ACTION] Disconnecting...')
  // Set the quitting flag so any queued action chains abort cleanly instead of
  // issuing bot commands to a closing socket.
  bot._quitting = true
  // Stop pathfinder so any in-flight goto() rejects immediately rather than
  // waiting for the socket-close error to propagate through mineflayer.
  if (bot.pathfinder) bot.pathfinder.stop()
  bot.quit()
}

module.exports = disconnect
