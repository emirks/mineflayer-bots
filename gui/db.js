'use strict'

// ── gui/db.js ─────────────────────────────────────────────────────────────────
//
// Dual-mode database layer:
//   DATABASE_URL set  → PostgreSQL via postgres.js  (Supabase on Fly.io)
//   DATABASE_URL unset → SQLite via better-sqlite3  (local dev + .exe)
//
// All exported functions are async in both modes for a unified interface.

const IS_PG = !!process.env.DATABASE_URL

// ══════════════════════════════════════════════════════════════════════════════
// PostgreSQL (Supabase) mode
// ══════════════════════════════════════════════════════════════════════════════
let _sql = null

async function _pg() {
  if (_sql) return _sql
  const postgres = require('postgres')
  _sql = postgres(process.env.DATABASE_URL, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    ssl: { rejectUnauthorized: false }, // Supabase requires SSL
  })
  // Create tables + indexes idempotently on first connect
  await _sql`
    CREATE TABLE IF NOT EXISTS gain_events (
      id      BIGSERIAL        PRIMARY KEY,
      profile TEXT             NOT NULL,
      ts      BIGINT           NOT NULL,
      amount  DOUBLE PRECISION NOT NULL,
      buyer   TEXT,
      item    TEXT
    )`
  await _sql`
    CREATE TABLE IF NOT EXISTS balance_snaps (
      id      BIGSERIAL        PRIMARY KEY,
      profile TEXT             NOT NULL,
      ts      BIGINT           NOT NULL,
      balance DOUBLE PRECISION NOT NULL
    )`
  await _sql`
    CREATE TABLE IF NOT EXISTS session_events (
      id         BIGSERIAL PRIMARY KEY,
      profile    TEXT      NOT NULL,
      ts         BIGINT    NOT NULL,
      event_type TEXT      NOT NULL,
      detail     TEXT
    )`
  await _sql`CREATE INDEX IF NOT EXISTS idx_gain_profile_ts    ON gain_events(profile, ts)`
  await _sql`CREATE INDEX IF NOT EXISTS idx_balance_profile_ts ON balance_snaps(profile, ts)`
  await _sql`CREATE INDEX IF NOT EXISTS idx_session_profile_ts ON session_events(profile, ts)`
  console.log('[db] connected to Supabase (PostgreSQL)')
  return _sql
}

// ══════════════════════════════════════════════════════════════════════════════
// SQLite (local dev + .exe) mode
// ══════════════════════════════════════════════════════════════════════════════
const path = require('path')

// pkg native-binding workaround — only active when running as .exe
if (process.pkg) {
  const Module = require('module')
  const realBinding = path.join(path.dirname(process.execPath), 'better_sqlite3.node')
  const _orig = Module._resolveFilename.bind(Module)
  Module._resolveFilename = function (request, ...args) {
    if (typeof request === 'string' && request.endsWith('better_sqlite3.node')) return realBinding
    return _orig(request, ...args)
  }
}

let _sqlite = null

function _lite() {
  if (_sqlite) return _sqlite
  const Database = require('better-sqlite3')
  const DB_PATH = process.env.GUI_DB_PATH
    ?? (process.pkg
      ? path.join(path.dirname(process.execPath), 'bot-dashboard.db')
      : path.join(__dirname, 'bot-dashboard.db'))
  _sqlite = new Database(DB_PATH)
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('synchronous = NORMAL')
  _sqlite.pragma('foreign_keys = ON')
  _sqlite.exec(`
    CREATE TABLE IF NOT EXISTS gain_events (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      profile TEXT    NOT NULL,
      ts      INTEGER NOT NULL,
      amount  REAL    NOT NULL,
      buyer   TEXT,
      item    TEXT
    );
    CREATE TABLE IF NOT EXISTS balance_snaps (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      profile TEXT    NOT NULL,
      ts      INTEGER NOT NULL,
      balance REAL    NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      profile    TEXT    NOT NULL,
      ts         INTEGER NOT NULL,
      event_type TEXT    NOT NULL,
      detail     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_gain_profile_ts    ON gain_events(profile, ts);
    CREATE INDEX IF NOT EXISTS idx_balance_profile_ts ON balance_snaps(profile, ts);
    CREATE INDEX IF NOT EXISTS idx_session_profile_ts ON session_events(profile, ts);
  `)
  console.log('[db] opened SQLite at', DB_PATH)
  return _sqlite
}

// ══════════════════════════════════════════════════════════════════════════════
// Unified async API
// ══════════════════════════════════════════════════════════════════════════════

async function getDb() {
  return IS_PG ? _pg() : _lite()
}

// ── Inserts ───────────────────────────────────────────────────────────────────

async function insertGain({ profile, ts, amount, buyer = null, item = null }) {
  if (IS_PG) {
    const sql = await _pg()
    await sql`INSERT INTO gain_events (profile, ts, amount, buyer, item) VALUES (${profile}, ${ts}, ${amount}, ${buyer}, ${item})`
  } else {
    _lite().prepare('INSERT INTO gain_events (profile, ts, amount, buyer, item) VALUES (?,?,?,?,?)').run(profile, ts, amount, buyer, item)
  }
}

async function insertBalance({ profile, ts, balance }) {
  if (IS_PG) {
    const sql = await _pg()
    await sql`INSERT INTO balance_snaps (profile, ts, balance) VALUES (${profile}, ${ts}, ${balance})`
  } else {
    _lite().prepare('INSERT INTO balance_snaps (profile, ts, balance) VALUES (?,?,?)').run(profile, ts, balance)
  }
}

async function insertSession({ profile, ts, event_type, detail = null }) {
  const detailStr = detail ? JSON.stringify(detail) : null
  if (IS_PG) {
    const sql = await _pg()
    await sql`INSERT INTO session_events (profile, ts, event_type, detail) VALUES (${profile}, ${ts}, ${event_type}, ${detailStr})`
  } else {
    _lite().prepare('INSERT INTO session_events (profile, ts, event_type, detail) VALUES (?,?,?,?)').run(profile, ts, event_type, detailStr)
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

async function getGainEvents(profile, fromTs, toTs) {
  if (IS_PG) {
    const sql = await _pg()
    return sql`SELECT id, ts, amount, buyer, item FROM gain_events WHERE profile = ${profile} AND ts >= ${fromTs} AND ts <= ${toTs} ORDER BY ts ASC`
  }
  return _lite().prepare('SELECT id, ts, amount, buyer, item FROM gain_events WHERE profile = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC').all(profile, fromTs, toTs)
}

async function getCumulativeGains(profile, fromTs, toTs) {
  const rows = await getGainEvents(profile, fromTs, toTs)
  let cumulative = 0
  return rows.map(r => { cumulative += r.amount; return { ts: r.ts, amount: r.amount, cumulative } })
}

async function getBucketedGains(profile, fromTs, toTs, bucket = 'hour') {
  const rows = await getGainEvents(profile, fromTs, toTs)
  const intervalMs = bucket === 'hour' ? 3_600_000 : 86_400_000
  const buckets = new Map()
  for (const row of rows) {
    const key = Math.floor(row.ts / intervalMs) * intervalMs
    const existing = buckets.get(key) || { ts: key, amount: 0, count: 0 }
    existing.amount += row.amount
    existing.count  += 1
    buckets.set(key, existing)
  }
  return Array.from(buckets.values()).sort((a, b) => a.ts - b.ts)
}

async function getTotalGains(profile) {
  if (IS_PG) {
    const sql = await _pg()
    const rows = await sql`SELECT SUM(amount) AS total, COUNT(*) AS count FROM gain_events WHERE profile = ${profile}`
    return { total: Number(rows[0]?.total ?? 0), count: Number(rows[0]?.count ?? 0) }
  }
  const r = _lite().prepare('SELECT SUM(amount) AS total, COUNT(*) AS count FROM gain_events WHERE profile = ?').get(profile)
  return { total: r?.total ?? 0, count: r?.count ?? 0 }
}

async function getTodayGains(profile) {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
  if (IS_PG) {
    const sql = await _pg()
    const rows = await sql`SELECT SUM(amount) AS total, COUNT(*) AS count FROM gain_events WHERE profile = ${profile} AND ts >= ${startOfDay.getTime()}`
    return { total: Number(rows[0]?.total ?? 0), count: Number(rows[0]?.count ?? 0) }
  }
  const r = _lite().prepare('SELECT SUM(amount) AS total, COUNT(*) AS count FROM gain_events WHERE profile = ? AND ts >= ?').get(profile, startOfDay.getTime())
  return { total: r?.total ?? 0, count: r?.count ?? 0 }
}

async function getBalanceSnaps(profile, fromTs, toTs) {
  if (IS_PG) {
    const sql = await _pg()
    return sql`SELECT ts, balance FROM balance_snaps WHERE profile = ${profile} AND ts >= ${fromTs} AND ts <= ${toTs} ORDER BY ts ASC`
  }
  return _lite().prepare('SELECT ts, balance FROM balance_snaps WHERE profile = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC').all(profile, fromTs, toTs)
}

async function getLatestBalance(profile) {
  if (IS_PG) {
    const sql = await _pg()
    const rows = await sql`SELECT balance, ts FROM balance_snaps WHERE profile = ${profile} ORDER BY ts DESC LIMIT 1`
    return rows[0] ?? null
  }
  return _lite().prepare('SELECT balance, ts FROM balance_snaps WHERE profile = ? ORDER BY ts DESC LIMIT 1').get(profile) ?? null
}

async function getSessionEvents(profile, fromTs, toTs) {
  if (IS_PG) {
    const sql = await _pg()
    return sql`SELECT ts, event_type, detail FROM session_events WHERE profile = ${profile} AND ts >= ${fromTs} AND ts <= ${toTs} ORDER BY ts ASC`
  }
  return _lite().prepare('SELECT ts, event_type, detail FROM session_events WHERE profile = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC').all(profile, fromTs, toTs)
}

async function getKnownProfiles() {
  if (IS_PG) {
    const sql = await _pg()
    const rows = await sql`SELECT DISTINCT profile FROM gain_events ORDER BY profile ASC`
    return rows.map(r => r.profile)
  }
  return _lite().prepare('SELECT DISTINCT profile FROM gain_events ORDER BY profile ASC').all().map(r => r.profile)
}

module.exports = {
  getDb,
  insertGain,
  insertBalance,
  insertSession,
  getGainEvents,
  getCumulativeGains,
  getBucketedGains,
  getTotalGains,
  getTodayGains,
  getBalanceSnaps,
  getLatestBalance,
  getSessionEvents,
  getKnownProfiles,
}
