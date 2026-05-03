// ── auctionOrderLoop — collect-from-order + auction-sell, indefinitely ─────────
//
// Infinite loop that alternates between collecting one stack from the /order
// GUI and selling all of it via /ah, stopping only when bot._quitting is set
// or the scheduled restart fires.
//
// Full flow per cycle:
//   0a. Scheduled restart: if uptime >= scheduledRestartMs
//         idle restartIdleMs (bot stays connected, no GUI), then bot.quit()
//         BotManager sees unexpected end → reconnects automatically
//   0b. Periodic /pay: if payPlayerName set + payIntervalMs elapsed
//         /pay <payPlayerName> <floor(earnedSinceLastPay)>
//   1.  Check inventory for itemName
//         found  → auctionSellAll()  (retries immediately on priceFloor/limit/noPrice)
//         empty  → collectFromMyOrder()  (one stack + flatten into 1× per slot)
//                   if no stock → wait retryCollectMs, retry
//   2.  sleep loopDelayMs → back to 0
//
// Options (all optional — defaults shown):
//   itemName           {string}   'redstone'       Minecraft item ID
//   searchTerm         {string}   'redstone dust'  /ah search argument
//   orderCommand       {string}   '/order'         command that opens the order GUI
//   decrementAmount    {number}   10               $ to undercut lowest listing by
//   minPriceFloor      {number}   0                stop listing if price < floor (0 = off)
//   winTimeoutMs       {number}   8000             ms to wait for each GUI window
//   clickDelayMs       {number}   600              settle delay after GUI clicks
//   fillDelayMs        {number}   200              delay between hotbar-fill swap clicks
//   settleAfterFillMs  {number}   1500             settle after hotbar fill
//   sellIntervalMs     {number}   800              delay between successive /ah sell cmds
//   saleWaitTimeoutMs  {number}   300_000          max wait for a sale when limit hit (5 min)
//   flattenDelayMs     {number}   10               delay between flatten clicks
//   loopDelayMs        {number}   2000             pause after each collect before selling
//   retryCollectMs     {number}   30_000           wait if order has no stock (30 s)
//   scheduledRestartMs {number}   3_600_000        restart session after this uptime (1 h)
//   restartIdleMs      {number}   300_000          idle before disconnect during restart (5 min)
//   payPlayerName      {string}   null             /pay target username (null = feature off)
//   payThreshold       {number}   30_000_000       keep this many $ locally; send the rest
//   payIntervalMs      {number}   600_000          interval between balance checks + /pay (10 min)
//   debug              {boolean}  false            log window dumps + write JSON files

const { auctionSellAll, formatMoney } = require('../lib/skills/auctionSell')
const { collectFromMyOrder }          = require('../lib/skills/collectMyOrder')
const { checkBalance }                = require('../lib/skills/checkBalance')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const LOG = '[AUCTION-ORDER-LOOP]'

// Rolling window size for the "last N minutes" $/min metric.
const ROLLING_WINDOW_MS = 3 * 60 * 1000   // 3 minutes

module.exports = async function auctionOrderLoop(bot, opts = {}) {
    const {
        itemName            = 'redstone',
        searchTerm          = 'redstone dust',
        orderCommand        = '/order',
        decrementAmount     = 10,
        minPriceFloor       = 0,
        winTimeoutMs        = 8000,
        clickDelayMs        = 600,
        fillDelayMs         = 200,
        settleAfterFillMs   = 1500,
        sellIntervalMs      = 800,
        saleWaitTimeoutMs   = 300_000,
        flattenDelayMs      = 10,
        loopDelayMs         = 2000,
        retryCollectMs      = 30_000,
        scheduledRestartMs  = 3_600_000,   // 1 h
        restartIdleMs       = 300_000,     // 5 min idle before disconnect
        payPlayerName       = null,        // null = /pay feature disabled
        payThreshold        = 30_000_000, // keep this many $ locally; send the surplus
        payIntervalMs       = 600_000,    // 10 min
        debug               = false,
    } = opts

    let cycle = 0

    // Persistent stats — accumulate across all collect→sell cycles this session.
    // startTime stays fixed at session start; never reset between phases.
    const runStats = {
        totalEarned:     0,
        buyCount:        0,
        lastTargetPrice: null,  // anti self-undercut: survives across sell phases
        startTime:       Date.now(),
    }

    // ── Rolling 3-min earnings window ─────────────────────────────────────────
    // Populated by '_ahSale' events emitted by auctionSell.js per confirmed sale.
    // We listen here in parallel with the internal auctionSell.js chat watcher.
    const recentSales = []   // [{ t: Date.now(), amount: number }]
    function onSale(earned) {
        recentSales.push({ t: Date.now(), amount: earned })
    }
    bot.on('_ahSale', onSale)

    // ── /pay tracking ─────────────────────────────────────────────────────────
    let lastPayTime = Date.now()

    // ── Scheduled restart ─────────────────────────────────────────────────────
    const restartAt = Date.now() + scheduledRestartMs

    bot.log.info(
        `${LOG} ═══ Starting` +
        `  item:"${itemName}"` +
        `  floor:${minPriceFloor > 0 ? '$' + minPriceFloor : 'off'}` +
        `  decrement:$${decrementAmount}` +
        `  restart:${(scheduledRestartMs / 60_000).toFixed(0)}m ═══`
    )

    while (!bot._quitting) {
        cycle++

        // ── 0a. Scheduled restart ──────────────────────────────────────────────
        // When uptime reaches scheduledRestartMs the bot idles for restartIdleMs
        // (stays connected, no GUI), then disconnects without setting bot._quitting.
        // BotManager sees an unexpected end → RECONNECTING → new session starts.
        if (Date.now() >= restartAt) {
            const idleMin = (restartIdleMs / 60_000).toFixed(0)
            bot.log.info(
                `${LOG} ═══ Scheduled restart (${(scheduledRestartMs / 60_000).toFixed(0)}m uptime)` +
                ` — idling ${idleMin}m then disconnecting ═══`
            )
            await sleep(restartIdleMs)
            if (bot._quitting) break   // panic fired during idle — let it handle exit
            bot.log.info(`${LOG} Disconnect — BotManager will reconnect automatically`)
            try { bot.pathfinder?.stop?.() } catch {}
            bot.quit()   // intentional: false → BotManager RECONNECTING
            break
        }

        // ── 0b. Periodic /pay ──────────────────────────────────────────────────
        // Fires at the top of a cycle (no open windows) so /bal and /pay land
        // cleanly without competing with GUI interactions.
        // Reads the real wallet balance via /bal, then sends whatever exceeds
        // payThreshold so the bot always keeps at least that amount locally.
        if (payPlayerName && Date.now() - lastPayTime >= payIntervalMs) {
            lastPayTime = Date.now()
            const balance = await checkBalance(bot, { timeoutMs: 8000 })
            if (balance === null) {
                bot.log.warn(`${LOG} /pay skipped — /bal timed out, will retry next interval`)
            } else if (balance > payThreshold) {
                const toSend = Math.floor(balance - payThreshold)
                bot.log.info(
                    `${LOG} /pay ${payPlayerName} ${toSend}` +
                    `  (balance: ${formatMoney(balance)}` +
                    `  keep: ${formatMoney(payThreshold)}` +
                    `  sending: ${formatMoney(toSend)})`
                )
                bot.chat(`/pay ${payPlayerName} ${toSend}`)
                await sleep(1500)   // let the server process the payment
            } else {
                bot.log.info(
                    `${LOG} /pay skipped — balance ${formatMoney(balance)}` +
                    ` ≤ threshold ${formatMoney(payThreshold)}`
                )
            }
        }

        // ── 1. Decide: sell or collect ─────────────────────────────────────────
        const inventoryCount = bot.inventory.items()
            .filter(i => i.name === itemName)
            .reduce((s, i) => s + i.count, 0)

        if (inventoryCount > 0) {
            // ── Sell phase ─────────────────────────────────────────────────────
            bot.log.info(
                `${LOG} ─── Cycle ${cycle}: inventory has ${inventoryCount}x ${itemName}` +
                ` — starting auction sell ───`
            )

            try {
                const result = await auctionSellAll(bot, {
                    itemName,
                    searchTerm,
                    decrementAmount,
                    minPriceFloor,
                    winTimeoutMs,
                    clickDelayMs,
                    fillDelayMs,
                    settleAfterFillMs,
                    sellIntervalMs,
                    saleWaitTimeoutMs,
                    debug,
                    persistedState: runStats,   // accumulates across all sell phases
                })

                // ── Stats log: session rate + rolling 3-min rate ──────────────
                const now        = Date.now()
                const elapsedMin = (now - runStats.startTime) / 60_000
                const sessionRate = elapsedMin > 0 ? runStats.totalEarned / elapsedMin : 0

                // Prune stale entries then sum the rolling window
                const cutoff = now - ROLLING_WINDOW_MS
                while (recentSales.length > 0 && recentSales[0].t < cutoff) recentSales.shift()
                const recentEarned = recentSales.reduce((s, e) => s + e.amount, 0)
                // Window is capped at 3 min, but use actual elapsed if <3 min into session
                const windowMins = Math.min(3, elapsedMin)
                const recentRate = windowMins > 0 ? recentEarned / windowMins : 0

                bot.log.info(
                    `${LOG} Sell phase done (${result.exitReason})` +
                    `  |  ${result.totalSold} listed this phase` +
                    `  |  ${runStats.buyCount} total sales` +
                    `  |  ${formatMoney(runStats.totalEarned)} earned` +
                    `  |  session: ${formatMoney(sessionRate)}/min` +
                    `  |  last 3m: ${formatMoney(recentRate)}/min` +
                    `  |  ${elapsedMin.toFixed(1)} min elapsed`
                )

                // ── Non-normal exits: log and retry immediately ────────────────
                // priceFloor, limitTimeout, and noPrice all retry the sell phase
                // on the next cycle without any extra sleep.
                // Auto-auction-withdraw (planned) will handle persistent floor/limit cases.
                if (result.exitReason === 'priceFloor') {
                    bot.log.warn(
                        `${LOG} Market below floor ${formatMoney(minPriceFloor)} — retrying immediately`
                    )
                    continue
                }
                if (result.exitReason === 'limitTimeout') {
                    bot.log.warn(
                        `${LOG} Auction limit: no sale in ${(saleWaitTimeoutMs / 1000).toFixed(0)}s` +
                        ` — retrying immediately`
                    )
                    continue
                }
                if (result.exitReason === 'noPrice') {
                    bot.log.warn(`${LOG} AH unavailable after retries — retrying immediately`)
                    continue
                }

            } catch (err) {
                bot.log.warn(`${LOG} auctionSellAll error — ${err.message}`)
                await sleep(3000)
            }

        } else {
            // ── Collect phase ──────────────────────────────────────────────────
            bot.log.info(`${LOG} ─── Cycle ${cycle}: inventory empty — collecting from order page ───`)

            let result = null
            try {
                result = await collectFromMyOrder(bot, {
                    itemName,
                    orderCommand,
                    winTimeoutMs,
                    clickDelayMs,
                    flattenDelayMs,
                    settleAfterFillMs,   // close_window(0) after inventory clicks before /ah
                    debug,
                })
            } catch (err) {
                bot.log.warn(`${LOG} collectFromMyOrder error — ${err.message}`)
            }

            if (!result || result.received === 0) {
                bot.log.warn(
                    `${LOG} No ${itemName} stock in order — waiting` +
                    ` ${retryCollectMs / 1000}s before retrying`
                )
                await sleep(retryCollectMs)
                continue   // skip loopDelayMs, go straight back to top
            }

            bot.log.info(
                `${LOG} Collected ${result.received}x ${itemName}` +
                ` (inventory total: ${result.totalInInventory})` +
                ` — pausing ${loopDelayMs}ms before sell`
            )
            await sleep(loopDelayMs)
        }
    }

    bot.removeListener('_ahSale', onSale)
    bot.log.info(`${LOG} ═══ Loop exiting ═══`)
}
