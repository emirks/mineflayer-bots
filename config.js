// ─── Bot connection ───────────────────────────────────────────────────────────
const bot = {
  host: 'localhost',
  port: 25565,

  // For offline-mode servers use any name and set auth to 'offline'.
  // For online-mode (Microsoft) set auth to 'microsoft' — a device-code
  // login prompt will appear in the console on first run, then the token
  // is cached in profilesFolder so subsequent runs are silent.
  username: 'hi',
  auth: 'offline',           // 'offline' | 'microsoft'
  profilesFolder: './auth-cache', // where Microsoft tokens are cached

  version: false, // false = auto-detect; or pin e.g. '1.21.1'
}

// ─── Skills ───────────────────────────────────────────────────────────────────
// Fine-tuning for lib/skills.js behaviour.
const skills = {
  blockPlaceDelay: 0, // milliseconds to wait between block placements (0 = instant)
}

// ─── Viewer ───────────────────────────────────────────────────────────────────
// Starts a local web server that renders the bot's world in a browser.
// Open http://localhost:<port> after the bot spawns.
const viewer = {
  enabled: true,
  port: 3000,
  firstPerson: false, // true = see through the bot's eyes
}

// ─── Triggers ─────────────────────────────────────────────────────────────────
// Each entry watches for a condition and fires its action stack (in order)
// the moment that condition is first met.
//
// Available trigger types:
//   playerRadius — polls distance to all loaded players
//   blockNearby  — fires when a block of a given type enters range
//
// Available action types:
//   breakBlock    — digs the nearest block of a given type
//   breakAllBlocks — digs every occurrence of a block type within range
//   disconnect    — disconnects the bot from the server
//   goToBlock     — pathfinds to the nearest block of a given type
//   takeFromChest — walks to the nearest chest and withdraws an item
//   pickupItems   — collects nearby item entities on the ground
//
const triggers = [
  // ── Example 1: player proximity escape ─────────────────────────────────────
  {
    type: 'playerRadius',
    options: { printRadius: 50, alertRadius: 2, checkIntervalMs: 5000 },
    actions: [
      { type: 'breakAllBlocks', options: { blockName: 'crafting_table', searchRadius: 64 } },
      { type: 'disconnect' },
    ],
  },

  // ── Example 2: open nearest chest and collect bones ─────────────────────────
  {
    type: 'blockNearby',
    options: {
      blockName: 'chest',
      radius: 20,
      checkIntervalMs: 1000,
    },
    actions: [
      {
        type: 'takeFromChest',
        options: {
          itemName: 'bone',
          num: -1,          // -1 = take all
        },
      },
    ],
  },
]

module.exports = { bot, skills, viewer, triggers }
