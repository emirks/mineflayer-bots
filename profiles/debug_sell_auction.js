// ─── Profile: debug_sell_auction ──────────────────────────────────────────────
// Debug / test profile for the auctionSellAll skill.
//
// Starting state assumed: inventory already contains 1× redstone stacks from
// a prior collectOrder + flattenInventoryStack run.
//
// Flow (per batch):
//   onSpawn (+4 s)
//     → sellAuction
//         /ah redstone dust    ← FIRST: open auction, sort by Lowest Price, read price
//         targetPrice = lowestPrice − DECREMENT_AMOUNT  (unless we are already lowest)
//         fillHotbarWith1x()   ← SECOND: move 1× stacks slots 9–35 → hotbar 36–44
//                                uses mode=2 (number-key swap) — 1 packet per item
//                                sends close_window(0) after moves + settleAfterFillMs
//         for each 1× redstone in hotbar:
//           /ah sell <targetPrice>  → CONFIRM LISTING → click lime glass → confirm
//         repeat until inventory cleared of 1× redstones
//
// Run: node orchestrator.js debug_sell_auction

const base = require('./_base')

// ── Tunable constants ─────────────────────────────────────────────────────────

const SELL_OPTIONS = {
    itemName:          'redstone',
    searchTerm:        'redstone dust',   // argument for /ah
    decrementAmount:   10,                // $ to undercut lowest listing by
    winTimeoutMs:      8000,              // ms to wait for each GUI window to open
    clickDelayMs:      600,               // settle delay between GUI clicks
    fillDelayMs:       200,               // delay between mode=2 swap clicks when filling hotbar
    settleAfterFillMs: 1500,              // settle after hotbar fill (close_window(0) sent first)
    sellIntervalMs:    800,               // delay between successive /ah sell commands
    timeoutMs:         300_000,           // 5-min action-level cap (full batch loop)

    // Set to true to log every window slot and write JSON dump files to logs/run_N/.
    // Keep false in normal operation to avoid noise in the session log.
    debug:             false,
}

module.exports = {
    ...base,
    bot: {
        ...base.bot,
        username:      'babapro334233outlook.com',
        profilesFolder: './auth-cache/debug_sell_auction',
    },
    viewer: { ...base.viewer, port: 3006 },

    triggers: [
        {
            type: 'onSpawn',
            options: { delayMs: 4000 },
            actions: [
                { type: 'sellAuction', options: SELL_OPTIONS },
            ],
        },
    ],
}
