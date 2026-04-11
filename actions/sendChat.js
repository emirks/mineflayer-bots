// Send a chat message or command.
// A short delay is awaited after sending so the server can process the command
// before the next action in the stack starts.
async function sendChat(bot, options) {
  const { message = '', delayAfterMs = 500 } = options
  if (!message) return
  bot.log.info(`[ACTION] Sending chat: "${message}"`)
  bot.chat(String(message))
  await new Promise(resolve => setTimeout(resolve, delayAfterMs))
}

module.exports = sendChat
