'use strict'

// ─── GUI Server ────────────────────────────────────────────────────────────────
// Express + Socket.io dashboard for managing multiple bot instances.
//
// Usage:
//   node gui/server.js
//   GUI_PORT=3333 node gui/server.js
//
// The server imports the orchestrator (not the other way around), so all bot
// lifecycle logic stays in orchestrator.js / BotManager.js unchanged.

const path = require('path')
const fs   = require('fs')
const http = require('http')

const express  = require('express')
const { Server: SocketIO } = require('socket.io')

const {
  spawnInstance,
  stopBot,
  getBotStates,
  EventBus,
  BotState,
} = require('../orchestrator')

const INSTANCES_FILE = path.join(__dirname, '..', 'instances.json')
const PROFILES_DIR   = path.join(__dirname, '..', 'profiles')
const PUBLIC_DIR     = path.join(__dirname, 'public')
const GUI_PORT       = Number(process.env.GUI_PORT) || 3333

// ── Persistence ───────────────────────────────────────────────────────────────

function loadInstances() {
  try { return JSON.parse(fs.readFileSync(INSTANCES_FILE, 'utf8')) }
  catch { return [] }
}

function saveInstances(instances) {
  fs.writeFileSync(INSTANCES_FILE, JSON.stringify(instances, null, 2))
}

// ── Express + Socket.io ───────────────────────────────────────────────────────

const app    = express()
const server = http.createServer(app)
const io     = new SocketIO(server)

app.use(express.json())
app.use(express.static(PUBLIC_DIR))

// ── In-memory log ring buffer (last 200 entries forwarded to new connections) ─

const LOG_MAX = 200
const logs    = []

function addLog(entry) {
  const full = { ...entry, ts: Date.now() }
  logs.push(full)
  if (logs.length > LOG_MAX) logs.shift()
  io.emit('log', full)
}

function fmtUptime(ms) {
  if (ms == null) return ''
  const s = Math.floor(ms / 1000)
  if (s < 60) return ` (up ${s}s)`
  const m = Math.floor(s / 60)
  if (m < 60) return ` (up ${m}m ${s % 60}s)`
  return ` (up ${Math.floor(m / 60)}h ${m % 60}m)`
}

// ── REST — profiles ───────────────────────────────────────────────────────────

app.get('/api/profiles', (_req, res) => {
  const names = fs.readdirSync(PROFILES_DIR)
    .filter(f => f.endsWith('.js') && !f.startsWith('_'))
    .map(f => f.replace('.js', ''))
  res.json(names)
})

app.get('/api/profiles/:name/code', (req, res) => {
  const { name } = req.params
  if (/[^a-zA-Z0-9_-]/.test(name)) return res.status(400).json({ error: 'Invalid profile name' })
  const file = path.join(PROFILES_DIR, `${name}.js`)
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' })
  res.json({ code: fs.readFileSync(file, 'utf8') })
})

app.put('/api/profiles/:name/code', (req, res) => {
  const { name } = req.params
  if (/[^a-zA-Z0-9_-]/.test(name)) return res.status(400).json({ error: 'Invalid profile name' })
  const file = path.join(PROFILES_DIR, `${name}.js`)
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Profile not found' })
  if (typeof req.body.code !== 'string') return res.status(400).json({ error: 'Missing code' })
  try {
    fs.writeFileSync(file, req.body.code)
    // Clear require cache so next spawnInstance picks up the fresh profile
    try { delete require.cache[require.resolve(`../profiles/${name}`)] } catch {}
    addLog({ level: 'info', msg: `[PROFILE:${name}] Code saved — takes effect on next Connect` })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── REST — instances ──────────────────────────────────────────────────────────

app.get('/api/instances', (_req, res) => {
  const instances = loadInstances()
  const stateMap  = Object.fromEntries(getBotStates().map(s => [s.profile, s]))
  res.json(instances.map(inst => ({
    ...inst,
    ...(stateMap[inst.id] || { state: BotState.IDLE, attempt: 0, uptime: null }),
  })))
})

app.post('/api/instances', (req, res) => {
  const instances = loadInstances()
  const inst = {
    id:             `bot-${Date.now()}`,
    label:          req.body.label          || 'New Bot',
    profile:        req.body.profile        || 'sentinel',
    username:       req.body.username       || '',
    host:           req.body.host           || 'donutsmp.net',
    port:           Number(req.body.port)   || 25565,
    auth:           req.body.auth           || 'microsoft',
    viewerEnabled:  req.body.viewerEnabled  ?? true,
    viewerPort:     Number(req.body.viewerPort) || 3000,
    reconnect:      req.body.reconnect      ?? false,
  }
  instances.push(inst)
  saveInstances(instances)
  io.emit('instanceCreated', inst)
  res.json(inst)
})

app.put('/api/instances/:id', (req, res) => {
  const instances = loadInstances()
  const idx = instances.findIndex(i => i.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  const updated = {
    ...instances[idx],
    label:         req.body.label         ?? instances[idx].label,
    profile:       req.body.profile       ?? instances[idx].profile,
    username:      req.body.username      ?? instances[idx].username,
    host:          req.body.host          ?? instances[idx].host,
    port:          req.body.port != null  ? Number(req.body.port)  : instances[idx].port,
    auth:          req.body.auth          ?? instances[idx].auth,
    viewerEnabled: req.body.viewerEnabled ?? instances[idx].viewerEnabled,
    viewerPort:    req.body.viewerPort != null ? Number(req.body.viewerPort) : instances[idx].viewerPort,
    reconnect:     req.body.reconnect     ?? instances[idx].reconnect,
    id:            req.params.id,
  }
  instances[idx] = updated
  saveInstances(instances)
  io.emit('instanceUpdated', updated)
  res.json(updated)
})

app.delete('/api/instances/:id', (req, res) => {
  let instances = loadInstances()
  const inst = instances.find(i => i.id === req.params.id)
  if (!inst) return res.status(404).json({ error: 'Not found' })
  try { stopBot(req.params.id) } catch {}
  instances = instances.filter(i => i.id !== req.params.id)
  saveInstances(instances)
  io.emit('instanceRemoved', req.params.id)
  res.json({ ok: true })
})

app.post('/api/instances/:id/start', (req, res) => {
  const instances = loadInstances()
  const inst = instances.find(i => i.id === req.params.id)
  if (!inst) return res.status(404).json({ error: 'Not found' })
  try {
    spawnInstance(inst)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/instances/:id/stop', (req, res) => {
  try {
    stopBot(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Socket.io ─────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  const instances = loadInstances()
  const states    = getBotStates()
  socket.emit('init', { instances, states, logs: logs.slice(-50) })
})

// Forward all EventBus events to connected sockets + log buffer
EventBus.on('bot:stateChange', (snap) => {
  io.emit('stateChange', snap)
  addLog({
    level: snap.state === 'failed' ? 'error' : snap.state === 'reconnecting' ? 'warn' : 'info',
    msg: `[${snap.profile}] → ${snap.state.toUpperCase()}${fmtUptime(snap.uptime)}`,
  })
})

EventBus.on('bot:error', ({ profile, error }) => {
  io.emit('botError', { id: profile, error: error?.message })
  addLog({ level: 'error', msg: `[${profile}] Error: ${error?.message}` })
})

EventBus.on('bot:reconnecting', ({ profile, attempt, delay }) => {
  io.emit('reconnecting', { id: profile, attempt, delay })
  addLog({ level: 'warn', msg: `[${profile}] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${attempt})` })
})

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(GUI_PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`)
  console.log(`║  Bot Manager GUI                     ║`)
  console.log(`║  http://localhost:${GUI_PORT}              ║`)
  console.log(`╚══════════════════════════════════════╝\n`)
})

process.on('SIGINT', () => {
  console.log('\n[GUI] Stopping all bots...')
  for (const inst of loadInstances()) {
    try { stopBot(inst.id) } catch {}
  }
  setTimeout(() => process.exit(0), 1500)
})
