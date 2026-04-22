const path = require('path')
const mineflayer = require('mineflayer')
const { createTriggerRegistry } = require('../triggers')
const mc = require('./mcdata')
const { attachProtocolDebug, formatKickReason } = require('./protocolDebug')
const { applyVelocityPatch } = require('./velocityPatch')
const { createLogger, createSnapshotWriter } = require('./logger')
const { buildSnapshot } = require('./snapshot')

// ─── Bot session factory ──────────────────────────────────────────────────────
// Creates one fully isolated Minecraft bot session.
//
// Returns { bot, promise } immediately so the caller can attach extra event
// listeners before awaiting.
//
//   promise resolves → { profileName, reason, intentional: true/false }
//     - intentional: true  means our code called bot.quit() (disconnect action
//                          or panic).  BotManager treats this as "do not reconnect".
//     - intentional: false means the server closed the connection unexpectedly.
//
//   promise rejects → Error with err.type = 'kicked' | 'error'
//     BotManager treats both as candidates for reconnect with backoff.
//
// Isolation guarantees:
//   - bot._config = profile   →  skills reads per-bot config, no global singleton
//   - createTriggerRegistry() →  own priority queue and cleanup handles
//   - Does NOT call process.exit() — caller owns the process lifecycle.

function createBotSession(profileNameOrConfig) {
  let profile, profileName

  if (typeof profileNameOrConfig === 'string') {
    profileName = profileNameOrConfig
    try {
      if (process.pkg) {
        // Running as packaged exe — load profile from profiles/ next to the exe
        // so the user can edit files without rebuilding.
        const profilePath = path.join(path.dirname(process.execPath), 'profiles', `${profileName}.js`)
        profile = require(profilePath)
      } else {
        profile = require(`../profiles/${profileName}`)
      }
    } catch {
      if (process.pkg) {
        throw new Error(`Profile "profiles/${profileName}.js" not found next to the exe.`)
      }
      throw new Error(`Unknown profile "${profileName}". Check profiles/ directory.`)
    }
  } else {
    // Pre-built config object passed by spawnInstance (GUI path)
    profile = profileNameOrConfig
    profileName = profile._instanceId || profile._profileTemplate || 'custom'
  }

  // ── Logger — shared with BotManager (same name → same registry instance) ───
  // Create before the bot so early messages (before spawn) are captured.
  const log = createLogger(profileName)
  log.info('[SESSION] Starting')

  const bot = mineflayer.createBot(profile.bot)

  // ── Per-bot config ──────────────────────────────────────────────────────────
  // Store the full profile on the bot so lib/skills.js and other helpers can
  // read per-bot configuration (e.g. blockPlaceDelay) without a global singleton.
  bot._config = profile
  bot._profileName = profileName
  bot._quitting = false
  bot.log = log   // ← available everywhere bot is passed

  // ── Mindcraft compat stubs ──────────────────────────────────────────────────
  bot.output = ''
  bot.modes = { isOn: () => false, pause: () => { }, unpause: () => { } }

  // ── Protocol debug ──────────────────────────────────────────────────────────
  const protocolDebugConfig = {
    ...(profile.protocolDebug || {}),
    ...(process.env.MC_PROTOCOL_DEBUG === '1' || process.env.MC_PROTOCOL_DEBUG === 'true'
      ? { enabled: true }
      : {}),
  }
  attachProtocolDebug(bot, protocolDebugConfig)

  // ── Patches and plugins ─────────────────────────────────────────────────────
  applyVelocityPatch(bot)
  mc.init(bot)  // loads pathfinder + collectblock, inits minecraft-data on login

  // ── Trigger registry ────────────────────────────────────────────────────────
  // Each session gets its own registry: isolated priority queue + cleanup handles.
  // Two concurrent bot sessions never share a queue or interval.
  const { registerTrigger, stopAll } = createTriggerRegistry()

  // ── Snapshot writer (optional; profile.stateSnapshots.enabled) ───────────────
  // Opened once per process (runDir is stable across reconnects).
  // Writes snapshots.jsonl alongside session.log in the same run directory.
  const stateSnapshotsEnabled = profile.stateSnapshots?.enabled !== false
  const snapshots = stateSnapshotsEnabled ? createSnapshotWriter(log.runDir) : null
  let snapshotInterval = null
  let healthTimer = null   // setTimeout handle (jittered; not setInterval)

  bot.once('spawn', () => {
    const spawnTime = Date.now()
    // ── Spawn state snapshot ─────────────────────────────────────────────────
    const pos = bot.entity?.position
    const posStr = pos
      ? `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`
      : '(unknown)'
    const health = bot.health != null ? `${bot.health.toFixed(1)}/20` : '?'
    const food = bot.food != null ? String(bot.food) : '?'
    log.info(`[SESSION] Spawned — pos: ${posStr} | health: ${health} | food: ${food}`)

    // ── Base position ────────────────────────────────────────────────────────
    // Recorded once at first spawn so baseZone trigger guards can reference it.
    // Preserved across reconnects (bot.once ensures it's only set on first spawn).
    if (pos) {
      bot._base = pos.clone()
      log.info(`[SESSION] Base recorded at ${posStr}`)
    }

    if (profile.viewer?.enabled) {
      const { mineflayer: mineflayerViewer } = require('prismarine-viewer')
      mineflayerViewer(bot, {
        port: profile.viewer.port,
        firstPerson: profile.viewer.firstPerson,
      })
      log.info(`[SESSION] Viewer → http://localhost:${profile.viewer.port}`)
    }

    log.info(`[SESSION] Registering ${profile.triggers.length} trigger(s)...`)
    for (const cfg of profile.triggers) {
      registerTrigger(bot, cfg)
    }

    // ── Periodic state snapshot (1 s) ────────────────────────────────────────
    if (stateSnapshotsEnabled) {
      snapshotInterval = setInterval(() => {
        try { snapshots.write(buildSnapshot(bot)) } catch { /* never crash the bot */ }
      }, 1000)
    }

    // ── Health heartbeat ─────────────────────────────────────────────────────
    // Logs a [HEALTH] line every ~N minutes with jitter so the cadence is not
    // perfectly mechanical.  Also sends /ping so the server reply appears as
    // [CHAT] — confirms the connection is actually processing commands.
    //
    // Failure detection: if bot.health drops to 0 the bot died (fall, mob, etc.)
    // and can no longer act.  We force-quit WITHOUT setting bot._quitting so
    // BotManager sees intentional:false and reconnects with normal backoff.
    // (The protocol-level keep_alive already handles silent TCP drops.)
    const hc = profile.healthCheck ?? {}
    if (hc.enabled !== false) {
      const intervalMs = hc.intervalMs ?? 300_000   // base 5 min
      const jitterMs = hc.jitterMs ?? 30_000    // ±30 s
      const pingCommand = hc.pingCommand ?? '/ping'  // null to disable ping

      const scheduleNext = () => {
        const jitter = (Math.random() - 0.5) * 2 * jitterMs   // -jitter … +jitter
        healthTimer = setTimeout(tick, intervalMs + jitter)
      }

      const tick = () => {
        if (bot._quitting) return
        try {
          // ── Failure: bot died ──────────────────────────────────────────────
          // health === 0 means the bot is dead and can't act.
          // Quit without setting _quitting → BotManager reconnects.
          if (bot.health !== null && bot.health <= 0) {
            log.warn('[HEALTH] Bot health is 0 — forcing reconnect')
            bot.quit()
            return   // don't schedule next; session is ending
          }

          const uptimeMins = Math.round((Date.now() - spawnTime) / 60_000)
          const pos = bot.entity?.position
          const posStr = pos
            ? `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`
            : '(unknown)'
          const hp = bot.health != null ? `${bot.health.toFixed(1)}/20` : '?'
          const food = bot.food != null ? String(bot.food) : '?'
          const tabCount = Object.keys(bot.players ?? {})
            .filter(n => n !== bot.username).length

          log.info(
            `[HEALTH] up ${uptimeMins}m | hp:${hp} food:${food}` +
            ` | pos:${posStr} | tab: ${tabCount}`
          )

          if (pingCommand) bot.chat(pingCommand)
        } catch { /* never crash the bot */ }

        scheduleNext()   // schedule next tick after current completes
      }

      scheduleNext()   // arm the first tick
    }
  })

  // ── Session promise ─────────────────────────────────────────────────────────
  const promise = new Promise((resolve, reject) => {
    bot.on('login', () => {
      log.info(`[SESSION] Logged in as "${bot.username}" | version: ${bot.version}`)
    })

    bot.on('message', (jsonMsg) => {
      log.info(`[CHAT] ${jsonMsg.toString()}`)
    })

    bot.on('error', (err) => {
      // Errors are logged but don't reject — mineflayer may recover from some.
      // The 'end' or 'kicked' event is what terminates the session.
      log.error(`[SESSION] Error — ${err.message}`)
    })

    bot.on('kicked', (reason) => {
      const msg = formatKickReason(reason)
      log.warn(`[SESSION] Kicked — ${msg}`)
      clearInterval(snapshotInterval)
      clearTimeout(healthTimer)
      stopAll()
      const err = new Error(`kicked: ${msg}`)
      err.type = 'kicked'
      reject(err)
    })

    bot.on('end', (reason) => {
      log.info(`[SESSION] Ended — ${reason}`)
      clearInterval(snapshotInterval)
      clearTimeout(healthTimer)
      stopAll()
      resolve({ profileName, reason, intentional: bot._quitting })
    })
  })

  return { bot, promise }
}

module.exports = { createBotSession }
