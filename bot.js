// ─── Profile selection ────────────────────────────────────────────────────────
// Usage:  node bot.js <profile>
// Example: node bot.js sentinel | node bot.js trader | node bot.js debug
//
// IMPORTANT: runtimeConfig must be set before any other require so that
// lib/skills.js reads the correct blockPlaceDelay when it is first loaded.
const runtimeConfig = require('./lib/runtimeConfig')

const profileName = process.argv[2] || 'sentinel'
let profile
try {
  profile = require(`./profiles/${profileName}`)
} catch {
  console.error(`[ERROR] Unknown profile "${profileName}". Available: sentinel, trader, debug`)
  process.exit(1)
}

runtimeConfig.set(profile)
console.log(`[BOOT] Loading profile "${profileName}"`)

// ─── Remaining requires (skills.js is loaded transitively here) ───────────────
const mineflayer = require('mineflayer')
const { registerTrigger } = require('./triggers')
const mc = require('./lib/mcdata')

const { bot: botConfig, viewer: viewerConfig, triggers } = profile

// ─── Bot ──────────────────────────────────────────────────────────────────────
const bot = mineflayer.createBot(botConfig)

// Stubs for mindcraft-specific bot properties used inside lib/skills.js
bot.output = ''
bot.modes = { isOn: () => false, pause: () => {}, unpause: () => {} }

// Load pathfinder + collectblock plugins and initialise minecraft-data lookups
mc.init(bot)

// ─── Connection events ────────────────────────────────────────────────────────
bot.on('login', () => {
  console.log(`[LOGIN] Connected to ${botConfig.host}:${botConfig.port} as "${bot.username}"`)
})

bot.on('error', (err) => {
  console.error('[ERROR]', err.message)
})

bot.on('kicked', (reason) => {
  console.warn('[KICKED]', reason)
  process.exit(1)
})

bot.on('end', (reason) => {
  console.log('[END] Connection closed —', reason)
  process.exit(0)
})

// ─── Spawn ────────────────────────────────────────────────────────────────────
bot.on('spawn', () => {
  console.log('[SPAWN] Bot is in the world\n')

  // ── Optional viewer ────────────────────────────────────────────────────────
  if (viewerConfig.enabled) {
    const { mineflayer: mineflayerViewer } = require('prismarine-viewer')
    mineflayerViewer(bot, {
      port: viewerConfig.port,
      firstPerson: viewerConfig.firstPerson,
    })
    console.log(`[VIEWER] Open http://localhost:${viewerConfig.port} in your browser\n`)
  }

  // ── Triggers ───────────────────────────────────────────────────────────────
  console.log('[BOOT] Registering triggers...')
  for (const triggerConfig of triggers) {
    registerTrigger(bot, triggerConfig)
  }
})
