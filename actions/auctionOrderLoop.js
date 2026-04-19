// ── auctionOrderLoop — collect-from-order + auction-sell, indefinitely ─────────
//
// Infinite loop that alternates between collecting one stack from the /order
// GUI and selling all of it via /ah, stopping only when bot._quitting is set.
//
// Full flow per cycle:
//   1. Check inventory for itemName
//        if found  → auctionSellAll() (runs until inventory empty or price floor hit)
//        if empty  → collectFromMyOrder() (shift-clicks one stack from order page)
//                     if nothing to collect → wait retryCollectMs, retry
//   2. sleep loopDelayMs → back to 1
//
// The sell phase handles auction-limit blocking and per-sale retries internally.
// This action never returns while the bot is alive.
//
// Options (all optional — defaults shown):
//   itemName          {string}  'redstone'      Minecraft item ID
//   searchTerm        {string}  'redstone dust' /ah search argument
//   orderCommand      {string}  '/order'        command that opens the order GUI
//   decrementAmount   {number}  10              $ to undercut lowest listing by
//   minPriceFloor     {number}  0               stop listing if price < floor (0 = off)
//   winTimeoutMs      {number}  8000            ms to wait for each GUI window
//   clickDelayMs      {number}  600             settle delay after GUI clicks
//   fillDelayMs       {number}  200             delay between hotbar-fill swap clicks
//   settleAfterFillMs {number}  1500            settle after hotbar fill
//   sellIntervalMs    {number}  800             delay between successive /ah sell cmds
//   saleWaitTimeoutMs {number}  300_000         max wait for a sale when limit hit
//   flattenDelayMs    {number}  10              delay between flatten clicks
//   loopDelayMs       {number}  2000            pause after each collect before selling
//   retryCollectMs    {number}  30_000          wait if order has no stock (30 s)
//   debug             {boolean} false           log window dumps + write JSON files

const { auctionSellAll, formatMoney } = require('../lib/skills/auctionSell')
const { collectFromMyOrder }          = require('../lib/skills/collectMyOrder')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const LOG = '[AUCTION-ORDER-LOOP]'

module.exports = async function auctionOrderLoop(bot, opts = {}) {
    const {
        itemName          = 'redstone',
        searchTerm        = 'redstone dust',
        orderCommand      = '/order',
        decrementAmount   = 10,
        minPriceFloor     = 0,
        winTimeoutMs      = 8000,
        clickDelayMs      = 600,
        fillDelayMs       = 200,
        settleAfterFillMs = 1500,
        sellIntervalMs    = 800,
        saleWaitTimeoutMs = 300_000,
        flattenDelayMs    = 10,
        loopDelayMs       = 2000,
        retryCollectMs    = 30_000,
        debug             = false,
    } = opts

    let cycle = 0

    // Persistent stats shared with every auctionSellAll call this session.
    // All fields accumulate across collect→sell cycles so the totals are never
    // zeroed between phases.  startTime stays fixed at session start.
    const runStats = {
        totalEarned:    0,
        buyCount:       0,
        lastTargetPrice: null,  // anti self-undercut: survives across sell phases
        startTime:      Date.now(),
    }

    bot.log.info(
        `${LOG} ═══ Starting (item:"${itemName}"  floor:${minPriceFloor > 0 ? '$' + minPriceFloor : 'off'}` +
        `  decrement:${decrementAmount}) ═══`
    )

    while (!bot._quitting) {
        cycle++

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
                const elapsedMin   = (Date.now() - runStats.startTime) / 60_000
                const profitPerMin = elapsedMin > 0 ? runStats.totalEarned / elapsedMin : 0
                bot.log.info(
                    `${LOG} Sell phase done — ${result.totalSold} listed this phase` +
                    `  |  run total: ${runStats.buyCount} sales` +
                    `  |  ${formatMoney(runStats.totalEarned)} earned` +
                    `  |  ${formatMoney(profitPerMin)}/min` +
                    `  |  ${elapsedMin.toFixed(1)} min elapsed`
                )
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

    bot.log.info(`${LOG} ═══ Loop exiting (bot._quitting) ═══`)
}
