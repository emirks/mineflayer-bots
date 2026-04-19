// ── collectOrder action ───────────────────────────────────────────────────────
// Navigates the /order GUI to collect items from a placed "My Order",
// then spreads the collected stack evenly across empty inventory slots (1 per slot).
//
// Flow:
//   /order → click "YOUR ORDERS" → click <itemName> order → click COLLECT
//   → close cascade → flattenInventoryStack (1 per empty slot)
//
// Options (all optional — defaults shown):
//   itemName          {string}  'redstone'   Minecraft item ID of the order to collect
//   orderCommand      {string}  '/order'     command that opens the main ORDERS window
//   winTimeoutMs      {number}  8000         ms to wait for each GUI window to open
//   clickDelayMs      {number}  500          settle delay after each navigation click
//   flattenDelayMs    {number}  150          delay between each inventory spread click
//   settleAfterFillMs {number}  1500         settle after inventory clicks; sends close_window(0)
//                                            so Paper unblocks /ah commands from the caller
//   debug             {boolean} false        log all window slots

const { collectFromMyOrder } = require('../lib/skills/collectMyOrder')

module.exports = async function collectOrderAction(bot, options = {}) {
    await collectFromMyOrder(bot, {
        itemName:          options.itemName          ?? 'redstone',
        orderCommand:      options.orderCommand      ?? '/order',
        winTimeoutMs:      options.winTimeoutMs      ?? 8000,
        clickDelayMs:      options.clickDelayMs      ?? 500,
        flattenDelayMs:    options.flattenDelayMs    ?? 150,
        settleAfterFillMs: options.settleAfterFillMs ?? 1500,
        debug:             options.debug             ?? false,
    })
}
