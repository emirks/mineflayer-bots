const { blazeTradeLoop } = require('../lib/skills/blazeTrade')

// ── blazeTradeLoop action ─────────────────────────────────────────────────────
// Runs an infinite buy-low / sell-high cycle for blaze rods (or any item).
// Never returns unless bot._quitting is set (panic disconnect etc.).
//
// Options (all optional — see blazeTrade.js for full docs):
//   itemName          {string}  'blaze_rod'
//   shopCategoryKw    {string}  'nether'
//   minPriceMargin    {number}  1          $/ea profit needed over buy price
//   minRemainingItems {number}  5000       skip near-done orders
//   maxRefreshAttempts{number}  5
//   maxBuyRounds      {number}  20
//   loopDelayMs       {number}  3000

module.exports = async function blazeTradeLoopAction(bot, options = {}) {
    await blazeTradeLoop(bot, {
        itemName:           options.itemName           ?? 'blaze_rod',
        shopCategoryKw:     options.shopCategoryKw     ?? 'nether',
        minPriceMargin:     options.minPriceMargin     ?? 1,
        minRemainingItems:  options.minRemainingItems  ?? 5000,
        maxRefreshAttempts: options.maxRefreshAttempts ?? 5,
        refreshWaitMs:      options.refreshWaitMs      ?? 2000,
        maxBuyRounds:       options.maxBuyRounds       ?? 20,
        loopDelayMs:        options.loopDelayMs        ?? 3000,
        winTimeoutMs:       options.winTimeoutMs       ?? 8000,
        clickDelayMs:       options.clickDelayMs       ?? 500,
        depositDelayMs:     options.depositDelayMs     ?? 120,
        chatTimeoutMs:      options.chatTimeoutMs      ?? 12000,
    })
}
