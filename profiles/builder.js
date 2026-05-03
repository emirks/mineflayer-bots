// ─── Profile: builder ─────────────────────────────────────────────────────────
// Reads a .litematic schematic file and builds it in the world.
//
// Flow:
//   1. Bot spawns and waits 5 s for chunks to load.
//   2. Scans for nearby chests (containing building materials).
//   3. Spiral-searches for the nearest clear, non-chest build area.
//   4. Places all blocks from the schematic bottom-up, refilling from chests
//      as needed and breaking obstructions (equipping pickaxe first).
//
// Setup:
//   1. Set bot.username to your Microsoft account email.
//   2. Set SCHEMATIC_FILE to the path of your .litematic file (relative to
//      the project root or absolute).
//   3. Place all required building materials in chests nearby where the bot
//      will spawn — the bot finds and withdraws from them automatically.
//   4. Run:  node orchestrator.js builder
//
// Safety:
//   • panicRadius=6  — quit immediately if a player walks within 6 blocks.
//   • Chests are NEVER broken (the bot will navigate around / skip them).
//   • Delays are randomised ±120 ms per block to avoid mechanical patterns.

const base = require('./_base')

const SCHEMATIC_FILE = './schematics/zenntic_beginner_kelp_farm.litematic'

const BUILD_OPTIONS = {
  schematicFile: SCHEMATIC_FILE,
  placeDelayMs: 280,    // base ms between block placements (humanised ± jitter)
  chestSearchRadius: 48,     // how far to look for material chests
  originSearchRadius: 40,     // how far to look for a valid build spot
  refillThreshold: 8,      // refill inventory when below this many of an item
  refillTarget: 64,     // items to pull from chest per refill cycle
}

module.exports = {
  ...base,
  bot: {
    ...base.bot,
    username: 'babapro334233outlook.com',         // ← set your Microsoft account
    profilesFolder: './auth-cache/builder',
  },
  viewer: { ...base.viewer, port: 3005 },

  // Slightly slower health-check cadence — builder runs are long
  healthCheck: {
    ...base.healthCheck,
    intervalMs: 600_000,   // 10 min
    jitterMs: 60_000,
  },

  triggers: [
    {
      // Start building 5 s after spawn so chunks are fully loaded.
      type: 'onSpawn',
      options: { delayMs: 5_000 },
      actions: [
        { type: 'buildSchematic', options: BUILD_OPTIONS },
      ],
    },
    // {
    //   // Panic: quit immediately if any player walks within 6 blocks.
    //   type: 'playerRadius',
    //   options: {
    //     panicRadius: 6,
    //     panicIntervalMs: 500,
    //     checkIntervalMs: 2_000,
    //     whitelist: [],    // trusted players — never trigger panic
    //     blacklist: [],    // panic at alertRadius even before panicRadius
    //   },
    // },
  ],
}
