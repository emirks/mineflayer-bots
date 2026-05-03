'use strict'

// ── gui/server.js — Bot Dashboard HTTP + WebSocket server ────────────────────
//
// Entry point for the web dashboard. Runs the orchestrator in the same process.
//
// Usage:
//   node gui/server.js                     # dashboard only (start bots from UI)
//   node gui/server.js redstone_auction    # dashboard + auto-start bot(s)
//
// `node orchestrator.js redstone_auction` still works unchanged.
//
// Environment:
//   GUI_PORT=3030   — HTTP port (default 3030)

const path   = require('path')
const fs     = require('fs')
const http   = require('http')
const express = require('express')
const { Server: SocketServer } = require('socket.io')

// Import orchestrator API (does NOT auto-start; just registers functions).
const {
  spawnBot,
  stopBot,
  getBotStates,
} = require('../orchestrator')

const {
  getDb,
  getCumulativeGains,
  getBucketedGains,
  getGainEvents,
  getTotalGains,
  getTodayGains,
  getBalanceSnaps,
  getLatestBalance,
  getSessionEvents,
  getKnownProfiles,
} = require('./db')

const { setup: setupEventBridge } = require('./eventBridge')

// ── Config ────────────────────────────────────────────────────────────────────
const GUI_PORT = parseInt(process.env.GUI_PORT || '3030', 10)

// Path resolution priority:
//   GUI_LOGS_BASE env var (Docker) → pkg exe dir (Windows exe) → repo root (local dev)
const _exeDir    = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..')
const CLIENT_DIST  = path.join(__dirname, 'client', 'dist')   // embedded in snapshot / built locally
const PROFILES_DIR = path.join(_exeDir, 'profiles')
const LOGS_BASE    = process.env.GUI_LOGS_BASE ?? path.join(_exeDir, 'logs')

// ── Track managers locally so we can access _currentBot ──────────────────────
// BotManager instances returned by spawnBot() — needed for log tailing +
// query-orders endpoint. Orchestrator's internal Map is separate but in sync.
const managers = new Map()

// ── Express + Socket.io ───────────────────────────────────────────────────────
const app    = express()
const server = http.createServer(app)
// Allow the Vercel-hosted frontend (and localhost dev) to connect.
// Set GUI_ALLOWED_ORIGINS to a comma-separated list of origins, or '*' (default).
const _allowedOrigins = (process.env.GUI_ALLOWED_ORIGINS ?? '*')
  .split(',').map(s => s.trim()).filter(Boolean)
const _corsOrigin = _allowedOrigins.length === 1 && _allowedOrigins[0] === '*'
  ? '*'
  : _allowedOrigins

const io     = new SocketServer(server, {
  cors: { origin: _corsOrigin, methods: ['GET', 'POST'] },
  path: '/socket.io',
})

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (_corsOrigin === '*') {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else if (origin && _allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.json({ limit: '1mb' }))

// Serve built React SPA in production.
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST))
}

// ── REST API ──────────────────────────────────────────────────────────────────

// GET /api/bots — all profiles merged with their current runtime state.
// Profiles that are not running are included as state:'idle' so the UI can
// show a Connect button for every profile without needing a separate call.
app.get('/api/bots', async (_req, res) => {
  try {
    const activeStates = getBotStates()
    const activeSet    = new Set(activeStates.map(s => s.profile))

    let allProfileNames = []
    try {
      allProfileNames = fs.readdirSync(PROFILES_DIR)
        .filter(f => f.endsWith('.js') && !f.startsWith('_'))
        .map(f => path.basename(f, '.js'))
        .sort()
    } catch { /* profiles dir missing */ }

    const enrich = async (s) => {
      const today  = await getTodayGains(s.profile)
      const latest = await getLatestBalance(s.profile)
      return { ...s, todayEarned: today.total, todayCount: today.count, latestBalance: latest?.balance ?? null, latestBalanceTs: latest?.ts ?? null }
    }

    const enrichedActive = await Promise.all(activeStates.map(enrich))
    const idleProfiles   = await Promise.all(
      allProfileNames.filter(name => !activeSet.has(name)).map(name => enrich({ profile: name, state: 'idle' }))
    )

    res.json([...enrichedActive, ...idleProfiles])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/bots/:name/start — spawn a bot
app.post('/api/bots/:name/start', (req, res) => {
  const { name } = req.params
  try {
    const manager = _spawnAndTrack(name)
    res.json({ ok: true, state: manager.state })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/bots/:name/stop — stop a bot
app.post('/api/bots/:name/stop', (_req, res) => {
  try {
    stopBot(_req.params.name)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// GET /api/profiles — list all available profile files
app.get('/api/profiles', (_req, res) => {
  try {
    const files = fs.readdirSync(PROFILES_DIR)
      .filter(f => f.endsWith('.js') && !f.startsWith('_'))
      .sort()
    const profiles = files.map(f => {
      const name = path.basename(f, '.js')
      const src  = fs.readFileSync(path.join(PROFILES_DIR, f), 'utf8')
      return { name, desc: _extractProfileDesc(src) }
    })
    res.json(profiles)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/profiles/:name — read raw profile source
app.get('/api/profiles/:name', (req, res) => {
  const filePath = path.join(PROFILES_DIR, `${req.params.name}.js`)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' })
  res.type('text/plain').send(fs.readFileSync(filePath, 'utf8'))
})

// PUT /api/profiles/:name — write profile source (from config editor)
app.put('/api/profiles/:name', (req, res) => {
  const filePath = path.join(PROFILES_DIR, `${req.params.name}.js`)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' })
  const { source } = req.body
  if (typeof source !== 'string') return res.status(400).json({ error: 'source must be a string' })
  try {
    fs.writeFileSync(filePath, source, 'utf8')
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/bots/:name/gains — gains history for charts
app.get('/api/bots/:name/gains', async (req, res) => {
  const { name } = req.params
  const now    = Date.now()
  const from   = parseInt(req.query.from ?? now - 7 * 86_400_000, 10)
  const to     = parseInt(req.query.to   ?? now, 10)
  const bucket = req.query.bucket || 'raw'

  try {
    const cumulative = await getCumulativeGains(name, from, to)
    const bucketed   = bucket === 'raw'
      ? await getGainEvents(name, from, to)
      : await getBucketedGains(name, from, to, bucket)
    const totals    = await getTotalGains(name)
    const todayData = await getTodayGains(name)
    res.json({ cumulative, bucketed, totals, today: todayData })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/bots/:name/balance — balance history for charts
app.get('/api/bots/:name/balance', async (req, res) => {
  const { name } = req.params
  const now  = Date.now()
  const from = parseInt(req.query.from ?? now - 7 * 86_400_000, 10)
  const to   = parseInt(req.query.to   ?? now, 10)
  try {
    const snaps  = await getBalanceSnaps(name, from, to)
    const latest = await getLatestBalance(name)
    res.json({ snaps, latest })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/bots/:name/logs — tail of current session.log
app.get('/api/bots/:name/logs', (req, res) => {
  const { name } = req.params
  const lines = parseInt(req.query.lines || '300', 10)

  const logFile = _findLatestLogFile(name)
  if (!logFile) return res.json([])

  try {
    const content = fs.readFileSync(logFile, 'utf8')
    const allLines = content.split('\n').filter(Boolean)
    const recent = allLines.slice(-lines)
    res.json(recent.map(_parseLogLine))
  } catch {
    res.json([])
  }
})

// GET /api/bots/:name/session-events — state-change history
app.get('/api/bots/:name/session-events', async (req, res) => {
  const { name } = req.params
  const now  = Date.now()
  const from = parseInt(req.query.from ?? now - 7 * 86_400_000, 10)
  const to   = parseInt(req.query.to   ?? now, 10)
  try {
    res.json(await getSessionEvents(name, from, to))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/bots/:name/query-orders — open /order GUI and read remaining orders
app.post('/api/bots/:name/query-orders', async (req, res) => {
  const { name } = req.params
  const mgr = managers.get(name)
  if (!mgr?._currentBot) return res.status(400).json({ error: 'Bot not connected' })

  const bot = mgr._currentBot
  if (bot._quitting) return res.status(400).json({ error: 'Bot is disconnecting' })

  try {
    const { queryOrders } = require('../lib/skills/queryOrders')
    const orders = await queryOrders(bot, req.body || {})
    res.json(orders)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/profiles-known — list all profiles that have ever been run (from DB)
app.get('/api/profiles-known', async (_req, res) => {
  try { res.json(await getKnownProfiles()) } catch (err) { res.status(500).json({ error: err.message }) }
})

// SPA fallback — serve index.html for any unmatched path (Express 5 requires named wildcard)
app.get('/{*path}', (_req, res) => {
  const indexPath = path.join(CLIENT_DIST, 'index.html')
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath)
  } else {
    res.status(200).send(
      '<h1 style="font-family:sans-serif;padding:2rem">Bot Dashboard</h1>' +
      '<p>Frontend not built yet.</p>' +
      '<pre>cd gui/client && pnpm install && pnpm build</pre>'
    )
  }
})

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', async (socket) => {
  // Send full merged bot list (active + idle profiles) on connect.
  const activeStates = getBotStates()
  const activeSet    = new Set(activeStates.map(s => s.profile))
  let allNames = []
  try {
    allNames = fs.readdirSync(PROFILES_DIR)
      .filter(f => f.endsWith('.js') && !f.startsWith('_'))
      .map(f => path.basename(f, '.js')).sort()
  } catch { /* */ }

  const enrich = async s => {
    const today  = await getTodayGains(s.profile)
    const latest = await getLatestBalance(s.profile)
    return { ...s, todayEarned: today.total, todayCount: today.count, latestBalance: latest?.balance ?? null }
  }

  const list = await Promise.all([
    ...activeStates.map(enrich),
    ...allNames.filter(n => !activeSet.has(n)).map(n => enrich({ profile: n, state: 'idle' })),
  ])
  socket.emit('bot:init', list)
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function _spawnAndTrack(profileName) {
  const manager = spawnBot({
    profile    : profileName,
    reconnect  : true,
    maxRetries : Infinity,
    baseDelayMs: 5000,
  })
  managers.set(profileName, manager)
  return manager
}

function _extractProfileDesc(src) {
  const lines = src.split('\n')
  const out = []
  let inBlock = false
  for (const line of lines) {
    const t = line.trim()
    if (!inBlock && t.startsWith('// ─── Profile:')) { inBlock = true; continue }
    if (inBlock) {
      if (!t.startsWith('//')) break
      const text = t.replace(/^\/\/\s?/, '').trim()
      if (text) out.push(text)
    }
  }
  return out.slice(0, 2).join('  ') || '(no description)'
}

/**
 * Finds the most recent session.log for a profile.
 * Scans logs/<profile>/<latest-date>/run_<latest-N>/session.log
 */
function _findLatestLogFile(profile) {
  const profileDir = path.join(LOGS_BASE, profile)
  if (!fs.existsSync(profileDir)) return null

  const dates = fs.readdirSync(profileDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  if (!dates.length) return null

  const dateDir = path.join(profileDir, dates[dates.length - 1])
  const runs = fs.readdirSync(dateDir)
    .filter(d => /^run_\d+$/.test(d))
    .sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]))
  if (!runs.length) return null

  const logFile = path.join(dateDir, runs[runs.length - 1], 'session.log')
  return fs.existsSync(logFile) ? logFile : null
}

/**
 * Parse one session.log line.
 * Format: "2026-04-22 08:39:07.370 INFO  [profile] message"
 */
function _parseLogLine(line) {
  const m = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(INFO |WARN |ERROR|DEBUG|PERF )\s+\[([^\]]+)\]\s+(.*)$/)
  if (!m) return { ts: null, level: 'info', text: line, raw: line }
  return {
    ts   : new Date(m[1]).getTime(),
    level: m[2].trim().toLowerCase(),
    text : m[4],
    raw  : line,
  }
}

// ── Start server ──────────────────────────────────────────────────────────────
function startServer() {
  getDb() // initialize SQLite schema
  setupEventBridge(io, managers)

  server.listen(GUI_PORT, () => {
    console.log(`\n[GUI] ══════════════════════════════════════════`)
    console.log(`[GUI]  Dashboard → http://localhost:${GUI_PORT}`)
    console.log(`[GUI] ══════════════════════════════════════════\n`)
  })
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function runCLI() {
  startServer()

  const argvProfiles = process.argv.slice(2)
  if (argvProfiles.length > 0) {
    console.log(`[GUI] Auto-starting profiles: ${argvProfiles.join(', ')}`)
    for (const name of argvProfiles) {
      _spawnAndTrack(name)
    }
  }

  process.on('SIGINT', () => {
    console.log('\n[GUI] SIGINT — stopping all bots...')
    for (const manager of managers.values()) manager.stop()
    setTimeout(() => process.exit(0), 1500)
  })
}

if (require.main === module) runCLI()

module.exports = { app, io, server, managers, runCLI }
