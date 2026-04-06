// ─── Profile: sentinel ────────────────────────────────────────────────────────
// Watches for nearby players.
// On alert  → breaks all crafting tables in range, then disconnects.
// On panic  → immediate bot.quit() regardless of running actions.

const base = require('./_base')

module.exports = {
  ...base,
  viewer: { ...base.viewer, port: 3000 },

  triggers: [
    {
      type: 'playerRadius',
      options: {
        printRadius: 50,   // log [DIST] for every player within this range
        alertRadius: 7,    // fire action stack + arm panic watch
        panicRadius: 3,    // emergency bot.quit() — ignores running actions
        checkIntervalMs: 500,  // slow scan rate (print + alert)
        panicIntervalMs: 100,  // fast scan rate after alert fires
      },
      actions: [
        { type: 'breakAllBlocks', options: { blockName: 'crafting_table', searchRadius: 64 } },
        { type: 'disconnect' },
      ],
    },
  ],
}
