// ─── Profile: blaze_trader ────────────────────────────────────────────────────
// Automated buy-low / sell-high cycle for blaze rods on DonutSMP.
//
// Flow per cycle (repeats indefinitely until quit):
//   1. /bal                         → record opening balance
//   2. /shop → Nether → Blaze Rod   → buy window (stays open after each purchase)
//        click "Set to 64" + "Confirm" until inventory full
//   3. /order blaze rod             → orders page (sorted "Most Paid")
//        find order where:  priceEach > shopBuyPrice + minPriceMargin
//                        AND remaining ≥ minRemainingItems (skip near-done orders)
//        if none on page 1 → refresh (up to maxRefreshAttempts) and re-scan
//   4. Click order → Deliver Items  → shift-click all blaze rod stacks to container
//   5. Close → Confirm Delivery     → click Confirm → await "You delivered…" chat
//   6. /bal                         → log profit + $/min metrics
//   7. Wait loopDelayMs             → back to step 1
//
// Safety:
//   • playerRadius — immediate disconnect if any non-whitelisted player comes within
//     5 blocks; panicIntervalMs=100 makes the check near-instant.
//
// Tuning:
//   • minPriceMargin    — how many $/ea above shop price you demand before selling.
//                         At $150 shop price and margin=1 the bot sells at ≥ $151.
//   • minRemainingItems — skip orders with fewer items outstanding to avoid
//                         wasting a cycle on an order that fills in seconds.
//   • maxBuyRounds      — upper limit on "Set to 64 → Confirm" iterations per cycle
//                         (safety cap; the inventory-full check stops the loop first).
//
// Run:
//   node orchestrator.js blaze_trader

const base = require('./_base')

const TRADE_OPTIONS = {
    itemName: 'blaze_rod',
    shopCategoryKw: 'nether',       // keyword to locate the Nether shop category
    minPriceMargin: 0.01,              // must earn at least $1/ea above buy price
    minRemainingItems: 5000,           // skip orders with < 5 000 items still needed
    maxRefreshAttempts: 10000,              // refresh attempts if no suitable order on page 1
    refreshWaitMs: 100,           // ms to wait after each refresh before re-scanning
    maxBuyRounds: 30,             // max "Set to 64 → Confirm" iterations per buy phase
    loopDelayMs: 200,           // ms to rest between complete cycles
    winTimeoutMs: 8000,           // ms to wait for any window to open
    clickDelayMs: 500,            // ms between navigation clicks (shop/order)
    depositDelayMs: 10,            // ms between shift-clicks when depositing items
    chatTimeoutMs: 12000,          // ms to wait for delivery confirmation in chat
}

module.exports = {
    ...base,
    bot: {
        ...base.bot,
        username: 'babapro334233outlook.com',  // ← set your Microsoft account email
        profilesFolder: './auth-cache/blaze_trader',
    },
    viewer: { ...base.viewer, port: 3004 },

    triggers: [
        {
            // Start the trade loop 3 s after spawn so chunk data is loaded.
            // blazeTradeLoop loops internally (while !bot._quitting), so we only
            // need onSpawn — no onInterval required.
            type: 'onSpawn',
            options: { delayMs: 3_000 },
            actions: [
                { type: 'blazeTradeLoop', options: TRADE_OPTIONS },
            ],
        },
        {
            // Panic: immediate disconnect if a player walks within 5 blocks.
            type: 'playerRadius',
            options: {
                printRadius: 30,
                alertRadius: 10,
                panicRadius: 5,
                checkIntervalMs: 500,
                panicIntervalMs: 100,
                whitelist: ['Jynx_33', 'Raikuuru', 'Abundiho'],
                blacklist: [],
            },
            actions: [
                { type: 'disconnect' },
            ],
        },
    ],
}
