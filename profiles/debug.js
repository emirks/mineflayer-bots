// ─── Profile: debug ───────────────────────────────────────────────────────────
// Connects, sends /skyblock, then prints all blocks + entities within 8 blocks
// every 5 seconds.  Nothing else runs — pure observation mode.

const base = require('./_base')

module.exports = {
  ...base,
  viewer: { ...base.viewer, port: 3002 },

  triggers: [
    {
      type: 'onSpawn',
      options: { delayMs: 10000 },
      actions: [
        { type: 'sendChat',      options: { message: '/skyblock', delayAfterMs: 1000 } },
        { type: 'startDebugScan', options: { radius: 8, intervalMs: 5000 } },
      ],
    },
  ],
}
