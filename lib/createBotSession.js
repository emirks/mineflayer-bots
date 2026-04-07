const mineflayer = require('mineflayer')
const { createTriggerRegistry } = require('../triggers')
const mc = require('./mcdata')
const { attachProtocolDebug, formatKickReason } = require('./protocolDebug')
const { applyVelocityPatch } = require('./velocityPatch')

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

function createBotSession(profileName) {
  let profile
  try {
    profile = require(`../profiles/${profileName}`)
  } catch {
    throw new Error(`Unknown profile "${profileName}". Check profiles/ directory.`)
  }

  console.log(`[SESSION:${profileName}] Starting`)

  const bot = mineflayer.createBot(profile.bot)

  // ── Per-bot config ──────────────────────────────────────────────────────────
  // Store the full profile on the bot so lib/skills.js and other helpers can
  // read per-bot configuration (e.g. blockPlaceDelay) without a global singleton.
  bot._config = profile
  bot._profileName = profileName
  bot._quitting = false

  // ── Mindcraft compat stubs ──────────────────────────────────────────────────
  bot.output = ''
  bot.modes = { isOn: () => false, pause: () => {}, unpause: () => {} }

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

  bot.once('spawn', () => {
    console.log(`[SESSION:${profileName}] Spawned in world`)

    if (profile.viewer?.enabled) {
      const { mineflayer: mineflayerViewer } = require('prismarine-viewer')
      mineflayerViewer(bot, {
        port: profile.viewer.port,
        firstPerson: profile.viewer.firstPerson,
      })
      console.log(`[SESSION:${profileName}] Viewer → http://localhost:${profile.viewer.port}`)
    }

    console.log(`[SESSION:${profileName}] Registering triggers...`)
    for (const cfg of profile.triggers) {
      registerTrigger(bot, cfg)
    }
  })

  // ── Session promise ─────────────────────────────────────────────────────────
  const promise = new Promise((resolve, reject) => {
    bot.on('login', () => {
      console.log(`[SESSION:${profileName}] Connected as "${bot.username}"`)
    })

    bot.on('error', (err) => {
      // Errors are logged but don't reject — mineflayer may recover from some.
      // The 'end' or 'kicked' event is what terminates the session.
      console.error(`[SESSION:${profileName}] Error — ${err.message}`)
    })

    bot.on('kicked', (reason) => {
      const msg = formatKickReason(reason)
      console.warn(`[SESSION:${profileName}] Kicked — ${msg}`)
      stopAll()
      const err = new Error(`kicked: ${msg}`)
      err.type = 'kicked'
      reject(err)
    })

    bot.on('end', (reason) => {
      console.log(`[SESSION:${profileName}] Ended — ${reason}`)
      stopAll()
      resolve({ profileName, reason, intentional: bot._quitting })
    })
  })

  return { bot, promise }
}

module.exports = { createBotSession }
