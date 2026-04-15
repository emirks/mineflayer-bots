// ─── Profile: debug_collectorder ───────────────────────────────────────────────
// One-shot test for collectMyOrder: /order → YOUR ORDERS → pick order item →
// COLLECT → close windows → flatten stack (1 item per empty slot in main+hotbar).
//
// Set bot.username + profilesFolder before running. Override itemName if your
// order uses a different Minecraft ID (e.g. blaze_rod).
//
// Run: node orchestrator.js debug_collectorder

const base = require('./_base')

const COLLECT_OPTIONS = {
    itemName:      'redstone',
    orderCommand:  '/order',
    winTimeoutMs:  8000,
    clickDelayMs:  10,
    flattenDelayMs: 0,
    timeoutMs:     120000,  // action-level cap (full GUI + flatten can be slow)

    // Set to true to log every slot in the EDIT ORDER and COLLECT ITEMS windows.
    debug:         false,
}

module.exports = {
    ...base,
    bot: {
        ...base.bot,
        username: 'babapro334233outlook.com',
        profilesFolder: './auth-cache/debug_collectorder',
    },
    viewer: { ...base.viewer, port: 3005 },

    triggers: [
        {
            type: 'onSpawn',
            options: { delayMs: 3000 },
            actions: [
                { type: 'collectOrder', options: COLLECT_OPTIONS },
            ],
        },
    ],
}
