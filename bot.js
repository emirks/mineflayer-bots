const mineflayer = require('mineflayer')
const { bot: botConfig, viewer: viewerConfig, triggers } = require('./config')
const { registerTrigger } = require('./triggers')
const mc = require('./lib/mcdata')

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
