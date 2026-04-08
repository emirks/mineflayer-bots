// ─── Profile: debug ───────────────────────────────────────────────────────────
// Connects, then prints all blocks + entities within 8 blocks every 5 seconds.
// Also probes the nearest spawner's NBT + hologram entities once at spawn.
// Nothing else runs — pure observation mode.

const base = require('./_base')

module.exports = {
  ...base,
  bot: {
    ...base.bot,
    username: 'serhat487-@hotmail.com',   // ← set your account; can share sentinel's if not running concurrently
    profilesFolder: './auth-cache/debug',
  },
  viewer: { ...base.viewer, port: 3002 },

  triggers: [
    {
      type: 'onSpawn',
      options: { delayMs: 1000 },
      actions: [
        // Open the nearest spawner GUI and capture the window title ("N SKELETON SPAWNERS").
        { type: 'logSpawnerData', options: { radius: 32 } },
        // startDebugScan returns immediately (background interval) — no timeout needed
        // { type: 'startDebugScan', options: { radius: 8, intervalMs: 5000 } },
      ],
    },
  ],
}
