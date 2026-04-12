// ─── Profile: debug ───────────────────────────────────────────────────────────
// Pure observation / diagnostic profile — nothing is automated here.
// Toggle the trigger blocks below to focus on what you want to inspect.
//
// Run: node orchestrator.js debug

const base = require('./_base')

module.exports = {
  ...base,
  bot: {
    ...base.bot,
    username: 'babapro334233outlook.com',
    profilesFolder: './auth-cache/debug',
  },
  viewer: { ...base.viewer, port: 3002 },

  triggers: [

    // ── Order delivery (one-shot test) ────────────────────────────────────────
    // Runs one full delivery cycle for blaze_rod:
    //   /bal → /order blaze rod → pick highest-paying order → deposit items
    //   → close → confirm → await chat verification → /bal → log metrics
    {
      type: 'onSpawn',
      options: { delayMs: 2000 },
      actions: [
        {
          type: 'deliverOrder',
          options: {
            itemName:      'blaze_rod',
            maxItems:      64,          // deposit at most 1 stack per test
            winTimeoutMs:  8000,
            clickDelayMs:  600,
            chatTimeoutMs: 12000,
            timeoutMs:     60000,       // hard cap for the whole action
          },
        },
      ],
    },

    // ── Full shop traversal ───────────────────────────────────────────────────
    // {
    //   type: 'onSpawn',
    //   options: { delayMs: 2000 },
    //   actions: [
    //     {
    //       type: 'traverseShop',
    //       options: {
    //         shopCommand:      '/shop',
    //         winTimeoutMs:     8000,
    //         clickDelayMs:     600,
    //         probeItemWindows: true,
    //         timeoutMs:        600000,
    //       },
    //     },
    //   ],
    // },

    // ── Window debugger (raw dump of /shop and /order windows) ────────────────
    // {
    //   type: 'onSpawn',
    //   options: { delayMs: 2000 },
    //   actions: [
    //     {
    //       type: 'debugTraderWindows',
    //       options: {
    //         shopCommand:    '/shop',
    //         orderCommand:   '/order blaze rod',
    //         winTimeoutMs:   5000,
    //         delayBetweenMs: 1500,
    //       },
    //     },
    //   ],
    // },

    // ── Spawner window debugger ───────────────────────────────────────────────
    // Uncomment to probe the nearest spawner GUI + CONFIRM SELL window.
    // {
    //   type: 'onSpawn',
    //   options: { delayMs: 1000 },
    //   actions: [
    //     { type: 'debugSpawnerWindow', options: { radius: 32, timeoutMs: 5000 } },
    //     { type: 'boneSweep', options: { radius: 32, winTimeoutMs: 5000, prices: { arrow: 2.5 } } },
    //   ],
    // },

  ],
}
