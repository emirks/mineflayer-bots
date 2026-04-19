// ─── Profile: redstone_auction ────────────────────────────────────────────────
//
// Production bot: collect redstone from /order, auction-sell all of it, repeat.
//
// Full flow (loops indefinitely):
//   onSpawn (+5 s)
//     └─ auctionOrderLoop:
//          ┌─ inventory has redstone?
//          │    YES → auctionSellAll
//          │           ① /ah redstone dust → sort Lowest Price → read floor price
//          │           ② if computed price < minPriceFloor → stop sell, go collect
//          │           ③ fillHotbarWith1x (mode=2 swaps, close_window after)
//          │           ④ for each hotbar slot: equip → /ah sell → confirm lime glass
//          │                on limit chat → block until sale frees a slot, retry same slot
//          │           repeat ①–④ until inventory empty
//          │    NO  → collectFromMyOrder
//          │           /order → YOUR ORDERS → redstone → COLLECT → shift-click 1 stack
//          │           flattenInventoryStack (spread into empty slots)
//          │           if no stock in order → wait retryCollectMs, retry
//          └─ sleep loopDelayMs → back to top
//
// Price floor:
//   minPriceFloor: 2500  →  if the market's lowest price − decrementAmount < $2 500,
//   the bot stops listing for this batch and goes to the collect phase instead.
//   This prevents the bot from listing at a loss during a dump.
//
// Safety:
//   playerRadius — immediate disconnect if a non-whitelisted player comes within
//   panicRadius blocks.  panicIntervalMs=100 makes the scan near-instant.
//
// Debug:
//   Flip LOOP_OPTIONS.debug = true to log every window slot and write JSON dump
//   files to logs/run_N/.  Keep false in normal operation to reduce log noise.
//
// Run:
//   node orchestrator.js redstone_auction

const base = require('./_base')

// ── All tunable parameters live here ─────────────────────────────────────────

const LOOP_OPTIONS = {
    // ── Item ─────────────────────────────────────────────────────────────────
    itemName: 'redstone_block',
    searchTerm: 'block of redstone',   // argument passed to /ah <searchTerm>
    orderCommand: '/order',          // command that opens the order GUI

    // ── Price ─────────────────────────────────────────────────────────────────
    decrementAmount: 10,                // $ to undercut the lowest listing by
    minPriceFloor: 4000,             // never list below $2 500 per redstone dust

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
        username: 'babapro334233outlook.com',
        profilesFolder: './auth-cache/redstone_auction',
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
