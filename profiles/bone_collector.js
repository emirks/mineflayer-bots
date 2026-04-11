// ─── Profile: bone_collector ──────────────────────────────────────────────────
// Automated bone-farm harvester.
//
// Flow per run:
//   1. Finds all spawner blocks within 64 blocks.
//   2. Navigates to each spawner and opens its GUI.
//   3. Pages through every page:
//        • bones only  → drop (click dropper), advance to next page
//        • arrows      → sell (click gold ingot), confirm (lime glass ×2)
//   4. Logs per-spawner results and a grand total with money earned.
//
// Schedule:
//   • onSpawn  — first run 5 s after spawn (gives the server time to load chunks)
//   • onInterval — re-runs every 10 minutes so loot never sits uncollected
//
// Safety:
//   • playerRadius panicRadius=6 — immediate bot.quit() if a player walks within
//     6 blocks; keeps the account safe on shared servers.
//
// Setup:
//   1. Set bot.username to a Microsoft account email.
//   2. Set prices.arrow to the server's sell price per arrow.
//   3. Adjust radius if spawners are further than 64 blocks away.
//   4. Run: node orchestrator.js bone_collector

const base = require('./_base')

const SWEEP_OPTIONS = {
    radius: 64,
    winTimeoutMs: 5000,   // per-window timeout (ms) — NOT an action-level kill
    dropSettleMs: 400,    // settle after dropper click
    confirmSettleMs: 600,    // settle after lime-glass confirm
    prices: {
        arrow: 2.5,          // ← set actual sell price per arrow
    },
}

module.exports = {
    ...base,
    bot: {
        ...base.bot,
        username: 'babapro334233outlook.com',   // ← set your Microsoft account
        profilesFolder: './auth-cache/bone_collector',
    },
    viewer: { ...base.viewer, port: 3003 },

    triggers: [
        {
            // First sweep 5 s after spawn — lets chunk data load before querying.
            type: 'onSpawn',
            options: { delayMs: 5_000 },
            actions: [
                { type: 'boneSweep', options: SWEEP_OPTIONS },
            ],
        },
        {
            // Periodic re-sweep every 10 minutes.
            type: 'onInterval',
            options: { intervalMs: 600_000 },
            actions: [
                { type: 'boneSweep', options: SWEEP_OPTIONS },
            ],
        },
        {
            // Panic: quit immediately if any player walks within 6 blocks.
            type: 'playerRadius',
            options: {
                panicRadius: 6,
                panicIntervalMs: 500,
                checkIntervalMs: 2_000,
                // Allies — only ever logged with [WL], never trigger alert or panic
                whitelist: ["Jynx_33", "Raikuuru", "Abundiho"],

                // Hostiles — panic immediately at alertRadius, no action queue delay
                blacklist: [],
            },

        },
    ],
}
