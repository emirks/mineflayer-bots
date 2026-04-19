// ─── Profile: redstone_auction_2 ─────────────────────────────────────────────
//
// Production bot: collect hoppers from /order, auction-sell all of it, repeat.
// (Same machinery as redstone_auction.js — different LOOP_OPTIONS.)
//
// Full flow (loops indefinitely):
//   onSpawn (+5 s)
//     └─ auctionOrderLoop:
//          ┌─ inventory has hopper?
//          │    YES → auctionSellAll
//          │           ① /ah hopper → sort Lowest Price → read floor price
//          │           ② if computed price < minPriceFloor → stop sell, go collect
//          │           ③ fillHotbarWith1x …  ④ /ah sell … confirm
//          │    NO  → collectFromMyOrder
//          │           /order → YOUR ORDERS → hopper → COLLECT → …
//          └─ sleep loopDelayMs → repeat
//
// Price floor:
//   minPriceFloor is dollars per hopper. Tune to your margin (screenshot showed ~$1.5K each).
//
// Run:
//   node orchestrator.js redstone_auction_2

const base = require('./_base')

// ── All tunable parameters live here ─────────────────────────────────────────

const LOOP_OPTIONS = {
    // ── Item ─────────────────────────────────────────────────────────────────
    itemName: 'hopper',
    searchTerm: 'hoppers',           // /ah <searchTerm> — match DonutSMP AH browse if needed
    orderCommand: '/order',

    // ── Price ─────────────────────────────────────────────────────────────────
    decrementAmount: 10,                // $ to undercut the lowest listing by
    minPriceFloor: 3000,             // never list below this $ per hopper

    // ── GUI timings ───────────────────────────────────────────────────────────
    winTimeoutMs: 8000,              // ms to wait for each GUI window to open
    clickDelayMs: 600,              // settle delay between GUI clicks
    fillDelayMs: 200,              // delay between hotbar-fill mode=2 swap clicks
    settleAfterFillMs: 1500,             // settle after hotbar fill (close_window sent first)
    sellIntervalMs: 800,              // delay between successive /ah sell commands

    // ── Auction-limit handling ────────────────────────────────────────────────
    saleWaitTimeoutMs: 300_000,          // max ms to wait for a sale when limit hit (5 min)

    // ── Collect / loop ────────────────────────────────────────────────────────
    flattenDelayMs: 10,               // delay between flatten (spread) clicks
    loopDelayMs: 2000,             // pause after collecting before starting sell
    retryCollectMs: 30_000,           // wait if order has no stock yet (30 s)

    // ── Debug ─────────────────────────────────────────────────────────────────
    // Set to true to log all window slots and write JSON dump files to logs/run_N/.
    // Leave false in normal operation — it generates a lot of output.
    debug: false,
}

module.exports = {
    ...base,
    bot: {
        ...base.bot,
        username: 'your.second.account@example.com',
        profilesFolder: './auth-cache/redstone_auction_2',
    },
    viewer: { ...base.viewer, port: 3007 },

    triggers: [
        {
            // Start the collect→sell loop 5 s after spawn (chunk data + login packets settle).
            // auctionOrderLoop runs forever internally; one onSpawn is enough.
            type: 'onSpawn',
            options: { delayMs: 5000 },
            actions: [
                { type: 'auctionOrderLoop', options: LOOP_OPTIONS },
            ],
        },
        {
            // Safety: disconnect immediately if any non-whitelisted player comes close.
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
