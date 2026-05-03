// Entry point for the packaged bot-dashboard.exe.
// Starts the Express + Socket.io GUI server (gui/server.js), same as
// running `node gui/server.js [profile1 profile2 ...]` directly.
//
// pkg sets require.main to this file, so gui/server.js exports runCLI()
// for us to call explicitly — identical pattern to launch.js / orchestrator.js.

const fs   = require('fs')
const path = require('path')

// Write crash details next to the exe so they survive after the window closes.
const CRASH_LOG = path.join(
  process.pkg ? path.dirname(process.execPath) : __dirname,
  'crash.log'
)

function writeCrash (label, err) {
  const msg = `[${new Date().toISOString()}] ${label}\n${err?.stack ?? err}\n\n`
  try { fs.appendFileSync(CRASH_LOG, msg) } catch (_) {}
  process.stderr.write(msg)
}

process.on('uncaughtException',   err => { writeCrash('uncaughtException',   err); process.exit(1) })
process.on('unhandledRejection',  err => { writeCrash('unhandledRejection',  err); process.exit(1) })

try {
  const { runCLI } = require('./gui/server')
  runCLI()
} catch (err) {
  writeCrash('startup crash', err)
  process.exit(1)
}
