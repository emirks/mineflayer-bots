// ─── Profile: redstone_auction_3 ─────────────────────────────────────────────
//
// Production bot: collect redstone torches from /order, auction-sell all of it, repeat.
// (Same machinery as redstone_auction.js — different LOOP_OPTIONS.)
//
// Full flow (loops indefinitely):
//   0a. Every scheduledRestartMs (1 h): idle restartIdleMs (5 min) → bot.quit()
//         BotManager reconnects automatically; new session starts fresh.
//   0b. Every payIntervalMs (10 min): /pay Raikuuru <earnedSinceLastPay>
//   onSpawn (+5 s)
//     └─ auctionOrderLoop:
//          ┌─ inventory has redstone torch?
//          │    YES → auctionSellAll
//          │           ① /ah redstone torch → sort Lowest Price → read floor price
//          │               (retried up to 3× / 5s if AH window fails)
//          │           ② if computed price < minPriceFloor → exitReason='priceFloor'
//          │                → retry sell immediately (auto-withdraw planned for future)
//          │           ③ fillHotbarWith1x …  ④ /ah sell … confirm
//          │                on limit timeout (5 min) → retry sell immediately
//          │    NO  → collectFromMyOrder
//          │           /order → YOUR ORDERS → redstone torch → COLLECT → …
//          └─ sleep loopDelayMs → repeat
//
// Price floor:
//   minPriceFloor is dollars per torch (per listing unit the AH uses). Tune to your margin.
//   On floor hit the sell phase retries immediately — auto-withdraw planned for future.
//
// Run:
//   node orchestrator.js redstone_auction_3

const base = require('./_base')

// ── All tunable parameters live here ─────────────────────────────────────────

const LOOP_OPTIONS = {
    // ── Item ─────────────────────────────────────────────────────────────────
    itemName: 'crafter',
    searchTerm: 'crafter',    // /ah <searchTerm> — match DonutSMP AH browse if needed
    orderCommand: '/order',

    // ── Price ─────────────────────────────────────────────────────────────────
    decrementAmount: 10,                // $ to undercut the lowest listing by
    minPriceFloor: 3000,              // never list below this $ per torch (tune to market)

    // ── GUI timings ───────────────────────────────────────────────────────────
    winTimeoutMs: 8000,              // ms to wait for each GUI window to open
    clickDelayMs: 600,              // settle delay between GUI clicks
    fillDelayMs: 200,              // delay between hotbar-fill mode=2 swap clicks
    settleAfterFillMs: 1500,             // settle after hotbar fill (close_window sent first)
    sellIntervalMs: 800,              // delay between successive /ah sell commands

    // ── Auction-limit handling ────────────────────────────────────────────────
    saleWaitTimeoutMs: 300_000,          // max ms to wait for a sale when limit hit (5 min)
    // on timeout: sell phase retries immediately

    // ── Collect / loop ────────────────────────────────────────────────────────
    flattenDelayMs: 10,               // delay between flatten (spread) clicks
    loopDelayMs: 2000,             // pause after collecting before starting sell
    retryCollectMs: 30_000,           // wait if order has no stock yet (30 s)

    // ── Scheduled restart ─────────────────────────────────────────────────────
    scheduledRestartMs: 3_600_000,       // restart session after 1 h of uptime
    restartIdleMs: 300_000,              // idle 5 min before disconnecting (bot stays connected)

    // ── Periodic /pay ─────────────────────────────────────────────────────────
    payPlayerName: null,           // null to disable; sends /pay every payIntervalMs
    payIntervalMs: 600_000,              // 10 min between /pay commands

    // ── Debug ─────────────────────────────────────────────────────────────────
    // Set to true to log all window slots and write JSON dump files to logs/run_N/.
    // Leave false in normal operation — it generates a lot of output.
    debug: false,
}

module.exports = {
    ...base,
    bot: {
        ...base.bot,
        username: 'qhhokrrl@sabesmail.com',
        profilesFolder: './auth-cache/redstone_auction',
    },
    viewer: { ...base.viewer, port: 3009 },

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
    ],
}
