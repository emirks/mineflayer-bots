// ─── Profile: sentinel ────────────────────────────────────────────────────────
// Watches for nearby players.
// On alert  → breaks all crafting tables in range, then disconnects.
// On panic  → immediate bot.quit() regardless of running actions.

const base = require('./_base')

module.exports = {
  ...base,
  bot: {
    ...base.bot,
    username: 'serhat487-@hotmail.com',
    profilesFolder: './auth-cache/sentinel',
  },
  viewer: { ...base.viewer, port: 3001 },

  triggers: [
    {
      // Periodic environment scan — logs nearby spawner positions + change diff.
      // Low priority so any defensive trigger always runs before this.
      type: 'onInterval',
      priority: -1,
      options: { intervalMs: 300_000 },   // every 5 min
      actions: [
        {
          type: 'logSurroundings',
          options: {
            blocks: ['spawner'],
            radius: 64,
          },
        },
      ],
    },
    {
      type: 'playerRadius',
      // Only act when within 50 blocks of spawn (larger than alertRadius:30 so
      // the trigger can actually fire; guards against acting after being warped).
      baseZone: { radius: 50 },
      options: {
        printRadius: 500000,   // log [DIST] for every player within this range
        alertRadius: 35,    // fire action stack + arm panic watch
        panicRadius: 10,    // emergency bot.quit() — ignores running actions
        checkIntervalMs: 500,  // slow scan rate (print + alert)
        panicIntervalMs: 100,  // fast scan rate after alert fires

        // Allies — only ever logged with [WL], never trigger alert or panic
        whitelist: ["Jynx_33", "Abundiho", "Raikuuru"],

        // Hostiles — panic immediately at alertRadius, no action queue delay
        blacklist: [],
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
