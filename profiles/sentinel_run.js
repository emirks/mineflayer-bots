// ─── Profile: sentinel ────────────────────────────────────────────────────────
// Watches for nearby players.
// On alert  → breaks all crafting tables in range, then disconnects.
// On panic  → immediate bot.quit() regardless of running actions.

const base = require('./_base')

module.exports = {
  ...base,
  bot: {
    ...base.bot,
    username: 'babapro334233@outlook.com',
    profilesFolder: './auth-cache/sentinel',
  },
  viewer: { ...base.viewer, port: 3001 },

  triggers: [
    {
      // Heartbeat: chat "ping" every 10 s (low priority).
      type: 'onInterval',
      priority: -1,
      options: { intervalMs: 10_000 },
      actions: [
        { type: 'sendChat', options: { message: '/ping', delayAfterMs: 100 } },
      ],
    },
    {
      // Initial survey 10 s after spawn — populates bot._spawnerSurvey before
      // any threat can arrive.  The bot navigates to each spawner during the
      // survey, leaving it already close to the spawner cluster.
      type: 'onSpawn',
      priority: -1,
      options: { delayMs: 2_000 },
      actions: [
        { type: 'surveySpawners', options: { radius: 64 } },
      ],
    },
    // {
    //   // Periodic re-survey every 5 min — keeps bot._spawnerSurvey fresh as
    //   // stacks change over time.  Low priority so playerRadius always wins.
    //   type: 'onInterval',
    //   priority: -1,
    //   options: { intervalMs: 300_000 },
    //   actions: [
    //     { type: 'surveySpawners', options: { radius: 64 } },
    //   ],
    // },
    {
      type: 'playerRadius',
      // Only act when within 30 blocks of spawn. Outside base the trigger keeps
      // sensing (logging [DIST]) but the action chain is silently skipped.
      baseZone: { radius: 30 },
      options: {
        printRadius: 500000,   // log [DIST] for every player within this range
        alertRadius: 100,    // fire action stack + arm panic watch
        panicRadius: 4,    // emergency bot.quit() — ignores running actions
        checkIntervalMs: 500,  // slow scan rate (print + alert)
        panicIntervalMs: 100,  // fast scan rate after alert fires

        // Allies — only ever logged with [WL], never trigger alert or panic
        whitelist: ["Jynx_33", "Abundiho", "Raikuuru"],

        // Hostiles — panic immediately at alertRadius, no action queue delay
        blacklist: [],
      },
      actions: [
        {
          type: 'sentinelSweep',
          options: {
            blockName: 'spawner',
            searchRadius: 64,
            maxRounds: 100,   // safety cap on total re-scan passes
            interBlockMinMs: 200,   // min pause between blocks (inv packet + pacing)
            interBlockMaxMs: 400,   // max pause between blocks
            betweenSweepsMinMs: 300,   // min pause between rounds (ghost window)
            betweenSweepsMaxMs: 400,   // max pause between rounds
            verifyInventory: true,  // inventory-driven done check per position
            pickupFloorDrops: true,  // floor scan if any position ends up short
            timeoutMs: 300000, // 5 min wall-clock cap applied by executeActions
          },
        },
        { type: 'disconnect' },
      ],
    },
  ],
}
