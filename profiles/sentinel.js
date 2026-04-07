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
        printRadius: 500000,   // log [DIST] for every player within this range
        alertRadius: 3,    // fire action stack + arm panic watch
        panicRadius: 0,    // emergency bot.quit() — ignores running actions
        checkIntervalMs: 500,  // slow scan rate (print + alert)
        panicIntervalMs: 100,  // fast scan rate after alert fires
      },
      actions: [
        {
          type: 'breakAllBlocks',
          options: {
            blockName: 'spawner',
            searchRadius: 64,
            maxRounds: 500,      // safety cap — stops after this many re-scan passes
            rescanDelayMs: 300,  // wait between re-scan rounds (ms)
            blockDelayMinMs: 400,   // min random pause between different block positions (ms)
            blockDelayMaxMs: 800,   // max random pause between different block positions (ms)
            timeoutMs: 300000,   // 5 min wall-clock cap (maxRounds guards loops; this guards stuck navigation)
          },
        },
        { type: 'dropItems', options: { item: 'spawner', timeoutMs: 15000 } },
        { type: 'disconnect' },
      ],
    },
  ],
}
