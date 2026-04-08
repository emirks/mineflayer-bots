// Entry point for the packaged exe.
// Calls spawnBot directly — cannot rely on require.main === module
// inside orchestrator.js because pkg sets require.main to this file, not orchestrator.
const { spawnBot } = require('./orchestrator')

spawnBot({
  profile: 'sentinel',
  reconnect: true,
  maxRetries: Infinity,
  baseDelayMs: 5000,
})

process.on('SIGINT', () => {
  console.log('\n[ORCH] Stopped.')
  setTimeout(() => process.exit(0), 1500)
})
