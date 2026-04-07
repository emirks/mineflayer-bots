// ─── Profile: trader ──────────────────────────────────────────────────────────
// Automated chest-loot + sell cycle.
//
// Flow:
//   1. 3s after spawn  → warp to the market area (/warp market)
//   2. chest detected  → take all target items from it
//   3.                 → send the server sell command
//   4.                 → pick up any dropped items on the ground
//
// Panic safety: if a player walks within 5 blocks the bot disconnects immediately.

const base = require('./_base')

module.exports = {
  ...base,
  bot: {
    ...base.bot,
    username      : '',   // ← must be a different account from sentinel for concurrent use
    profilesFolder: './auth-cache/trader',
  },
  viewer: { ...base.viewer, port: 3001 },   // own port — runs alongside sentinel

  triggers: [
    // ── Step 1: warp to market on spawn ──────────────────────────────────────
    {
      type: 'onSpawn',
      options: { delayMs: 3000 },
      actions: [
        // delayAfterMs: 2000 → timeout gives 3s of extra buffer
        { type: 'sendChat', options: { message: '/warp market', delayAfterMs: 2000, timeoutMs: 5000 } },
      ],
    },

    // ── Step 2–4: loot nearest chest → sell → pick up drops ──────────────────
    {
      type: 'blockNearby',
      options: {
        blockName: 'chest',
        radius: 20,
        checkIntervalMs: 1000,
      },
      actions: [
        { type: 'takeFromChest', options: { itemName: 'bone', num: -1, timeoutMs: 60000 } },
        { type: 'sendChat', options: { message: '/sell all', delayAfterMs: 1000, timeoutMs: 4000 } },
        { type: 'pickupItems', options: { timeoutMs: 30000 } },
      ],
    },

    // ── Panic safety ─────────────────────────────────────────────────────────
    {
      type: 'playerRadius',
      options: {
        printRadius: 30,
        alertRadius: 10,
        panicRadius: 5,
        checkIntervalMs: 500,
        panicIntervalMs: 100,
      },
      actions: [
        { type: 'disconnect' },
      ],
    },
  ],
}
