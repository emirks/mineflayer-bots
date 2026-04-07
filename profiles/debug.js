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
      options: { delayMs: 1000 },
      actions: [
        // delayAfterMs: 1000 → timeout gives 3s of extra buffer
        { type: 'sendChat', options: { message: '/skyblock', delayAfterMs: 1000, timeoutMs: 4000 } },
        // startDebugScan returns immediately (background interval) — no timeout needed
        { type: 'startDebugScan', options: { radius: 8, intervalMs: 5000 } },
      ],
    },
  ],
}
