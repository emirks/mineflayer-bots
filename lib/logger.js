'use strict'

// ─── Bot logger ───────────────────────────────────────────────────────────────
//
// Usage:
//   const { createLogger, createSnapshotWriter } = require('./logger')
//
//   const log = createLogger('sentinel')
//   log.info('[SESSION] Starting')          → console + session.log
//   log.warn('[TRIGGER] player close')
//   log.error('[ACTION] failed')
//   log.sessionMark('Attempt 2')           → visual separator between reconnects
//   log.runDir                             → absolute path to the run directory
//
//   const snap = createSnapshotWriter(log.runDir)
//   snap.write({ t: Date.now(), health: 20, ... })   → appends to snapshots.jsonl
//
// Directory layout (created automatically):
//
//   logs/
//     <profile>/
//       <YYYY-MM-DD>/
//         run_<N>/
//           session.log     ← text log (all levels)
//           snapshots.jsonl ← NDJSON: one snapshot object per line (1/s)
//
// Run number increments per process start (not per reconnect).
// Reconnects within the same process share the same run_<N> directory.
//
// Registry: createLogger('sentinel') always returns the same instance within
// a process — BotManager and createBotSession share one stream.
//
// Multi-bot: each profile name gets its own run directory and log files.

const fs   = require('fs')
const path = require('path')

// ─── ANSI palette (no external deps) ─────────────────────────────────────────
const A = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  // level colours
  debug: '\x1b[90m',   // dark grey
  info: '\x1b[37m',   // white
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',   // red
  // name-tag colour pool — cycles for multi-bot
  names: [
    '\x1b[36m',   // cyan
    '\x1b[35m',   // magenta
    '\x1b[32m',   // green
    '\x1b[34m',   // blue
    '\x1b[95m',   // bright magenta
    '\x1b[96m',   // bright cyan
    '\x1b[93m',   // bright yellow
    '\x1b[92m',   // bright green
  ],
}

const LEVEL_LABEL  = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' }
const LEVEL_COLOUR = { debug: A.debug, info: A.info, warn: A.warn, error: A.error }

// ─── Module-level registry ────────────────────────────────────────────────────
// One logger per name across the entire process.
// BotManager(constructor) and createBotSession both call createLogger('sentinel')
// and get the same stream — no duplicate file handles.
const REGISTRY = new Map()
// When running as a packaged exe (process.pkg is truthy), __dirname points to
// the read-only virtual snapshot — we cannot mkdir there.  Write logs next to
// the exe instead.  When running normally, use the project root as before.
const LOGS_BASE = process.pkg
  ? path.join(path.dirname(process.execPath), 'logs')
  : path.join(__dirname, '..', 'logs')
let   _nameIdx  = 0

// ─── Run directory resolver ───────────────────────────────────────────────────
// Determines logs/<name>/<date>/run_<N>/ and creates it.
// Called once per (name, process) pair — reused for the full process lifetime
// so reconnects all land in the same run directory.
function resolveRunDir(name) {
  const date    = new Date().toISOString().slice(0, 10)   // 'YYYY-MM-DD'
  const dateDir = path.join(LOGS_BASE, name, date)
  fs.mkdirSync(dateDir, { recursive: true })

  let runN = 1
  try {
    const existing = fs.readdirSync(dateDir)
      .map(e => { const m = e.match(/^run_(\d+)$/); return m ? parseInt(m[1], 10) : 0 })
      .filter(n => n > 0)
    if (existing.length > 0) runN = Math.max(...existing) + 1
  } catch { /* dateDir empty or unreadable — start at 1 */ }

  const runDir = path.join(dateDir, `run_${runN}`)
  fs.mkdirSync(runDir, { recursive: true })
  return runDir
}

// ─── Logger factory ───────────────────────────────────────────────────────────
function createLogger(name) {
  if (REGISTRY.has(name)) return REGISTRY.get(name)

  const runDir      = resolveRunDir(name)
  const sessionFile = path.join(runDir, 'session.log')
  const stream      = fs.createWriteStream(sessionFile, { flags: 'a' })
  stream.on('error', err => process.stderr.write(`[logger] stream error (${name}): ${err.message}\n`))

  const nameColour = A.names[_nameIdx % A.names.length]
  _nameIdx++

  function ts() {
    return new Date().toISOString().replace('T', ' ').slice(0, 23)
  }

  function write(level, msg) {
    const timestamp = ts()
    const label     = LEVEL_LABEL[level]

    stream.write(`${timestamp} ${label} [${name}] ${msg}\n`)

    const levelC = LEVEL_COLOUR[level]
    const line =
      `${A.dim}${timestamp}${A.reset} ` +
      `${levelC}${label}${A.reset} ` +
      `${nameColour}[${name}]${A.reset} ` +
      `${levelC}${msg}${A.reset}`

    const dest = level === 'error' ? process.stderr : process.stdout
    dest.write(line + '\n')
  }

  function sessionMark(label = 'New session') {
    const timestamp = ts()
    const bar = '─'.repeat(60)
    stream.write(`\n${bar}\n  ${timestamp}  ${label}\n${bar}\n\n`)
    process.stdout.write(
      `\n${nameColour}${bar}${A.reset}\n` +
      `${nameColour}  [${name}] ${label}${A.reset}\n` +
      `${nameColour}${bar}${A.reset}\n\n`,
    )
  }

  const logger = {
    debug       : msg => write('debug', msg),
    info        : msg => write('info',  msg),
    warn        : msg => write('warn',  msg),
    error       : msg => write('error', msg),
    sessionMark,
    name,
    runDir,     // ← createBotSession passes this to createSnapshotWriter
  }

  REGISTRY.set(name, logger)
  return logger
}

// ─── Snapshot writer ──────────────────────────────────────────────────────────
// Creates / opens logs/<name>/<date>/run_<N>/snapshots.jsonl for appending.
// Each call to write(obj) serialises obj as a single JSON line.
//
// File format: NDJSON (.jsonl) — one JSON object per line, no trailing comma,
// no wrapping array.  Chosen because:
//   - Naturally handles nested data (inventory objects, player arrays, entity maps)
//   - Append-only: zero memory overhead, no rewrite on shutdown
//   - Human-readable: open in any editor, pipe through `jq`
//   - Ecosystem support: Python/pandas, DuckDB, jq all parse .jsonl natively
//
// At 1 snapshot/second: ~300 bytes/line → ~1 MB/hour → ~24 MB/day
function createSnapshotWriter(runDir) {
  const snapshotFile = path.join(runDir, 'snapshots.jsonl')
  const stream = fs.createWriteStream(snapshotFile, { flags: 'a' })
  stream.on('error', err => process.stderr.write(`[snapshot] stream error: ${err.message}\n`))

  return {
    write(obj) {
      try {
        stream.write(JSON.stringify(obj) + '\n')
      } catch (err) {
        process.stderr.write(`[snapshot] serialise error: ${err.message}\n`)
      }
    },
    close() {
      stream.end()
    },
  }
}

module.exports = { createLogger, createSnapshotWriter }
