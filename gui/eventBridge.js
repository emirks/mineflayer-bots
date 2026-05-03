'use strict'

// ── gui/eventBridge.js — EventBus → SQLite + socket.io bridge ─────────────────
//
// Called once from gui/server.js after the socket.io server is ready.
// Subscribes to all bot EventBus events, persists them to SQLite, and
// re-emits them to connected browser clients via socket.io.
//
// Also manages live log-tail streams: when a bot connects, start reading new
// lines from its session.log every 500 ms; stop when it disconnects.

const path = require('path')
const fs   = require('fs')

const EventBus = require('../lib/EventBus')
const {
  insertGain,
  insertBalance,
  insertSession,
} = require('./db')

// intervalId | null per profile
const _logWatchers = new Map()

/**
 * @param {import('socket.io').Server} io
 * @param {Map<string, import('../lib/BotManager').BotManager>} managers
 */
function setup(io, managers) {

  // ── bot:sale — new auction sale confirmed ────────────────────────────────
  EventBus.on('bot:sale', (data) => {
    insertGain(data).catch(e => console.error('[bridge] insertGain:', e.message))
    io.emit('bot:sale', data)
  })

  // ── bot:balance — /bal result ────────────────────────────────────────────
  EventBus.on('bot:balance', (data) => {
    insertBalance(data).catch(e => console.error('[bridge] insertBalance:', e.message))
    io.emit('bot:balance', data)
  })

  // ── bot:stateChange — lifecycle transitions ──────────────────────────────
  EventBus.on('bot:stateChange', (data) => {
    insertSession({ profile: data.profile, ts: Date.now(), event_type: data.state, detail: data })
      .catch(e => console.error('[bridge] insertSession:', e.message))

    io.emit('bot:stateChange', data)

    // Start/stop log tailing based on connection state.
    if (data.state === 'connected') {
      // Give the BotManager a tick to set _currentBot before we read runDir.
      setImmediate(() => {
        const mgr = managers.get(data.profile)
        const runDir = mgr?._currentBot?.log?.runDir
        if (runDir) startLogTail(io, data.profile, runDir)
      })
    } else if (data.state === 'disconnected' || data.state === 'stopped' || data.state === 'failed') {
      stopLogTail(data.profile)
    }
  })

  // ── bot:reconnecting ─────────────────────────────────────────────────────
  EventBus.on('bot:reconnecting', (data) => {
    io.emit('bot:reconnecting', data)
  })

  // ── bot:error ────────────────────────────────────────────────────────────
  EventBus.on('bot:error', (data) => {
    io.emit('bot:error', data)
  })
}

// ── Log-tail helpers ──────────────────────────────────────────────────────────

function startLogTail(io, profile, runDir) {
  stopLogTail(profile) // cancel any existing watcher

  const logFile = path.join(runDir, 'session.log')

  // Start at current file end — don't replay historical lines.
  let position = 0
  try { position = fs.statSync(logFile).size } catch { /* file may not exist yet */ }

  const intervalId = setInterval(() => {
    try {
      const stat = fs.statSync(logFile)
      if (stat.size <= position) return

      const chunkSize = stat.size - position
      const buf = Buffer.alloc(chunkSize)
      const fd = fs.openSync(logFile, 'r')
      fs.readSync(fd, buf, 0, chunkSize, position)
      fs.closeSync(fd)
      position = stat.size

      const lines = buf.toString('utf8').split('\n').filter(Boolean)
      for (const line of lines) {
        io.emit('bot:log', { profile, ...parseLogLine(line) })
      }
    } catch { /* file not yet created or transient error — ignore */ }
  }, 500)

  _logWatchers.set(profile, intervalId)
}

function stopLogTail(profile) {
  if (_logWatchers.has(profile)) {
    clearInterval(_logWatchers.get(profile))
    _logWatchers.delete(profile)
  }
}

/**
 * Parse a session.log line into { ts, level, text }.
 * Format: "YYYY-MM-DD HH:MM:SS.mmm INFO  [profile] message"
 */
function parseLogLine(line) {
  const m = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(INFO |WARN |ERROR|DEBUG|PERF )\s+\[([^\]]+)\]\s+(.*)$/)
  if (!m) return { ts: Date.now(), level: 'info', text: line }
  return {
    ts   : new Date(m[1]).getTime(),
    level: m[2].trim().toLowerCase(),
    text : m[4],
  }
}

module.exports = { setup, startLogTail, stopLogTail }
