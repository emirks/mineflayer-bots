// ─── Action: deliverOrder ─────────────────────────────────────────────────────
// Performs one end-to-end delivery cycle for a given item type:
//   /bal → /order <item> → select highest-value order → deposit items
//   → close → confirm → await chat verification → /bal → log metrics.
//
// Options (all optional — defaults shown):
//   itemName      {string}  'blaze_rod'   Minecraft item ID to deliver
//   orderCommand  {string}  null          Override '/order blaze rod' if needed
//   maxItems      {number}  64            Max items to deposit per cycle
//   winTimeoutMs  {number}  8000          Per-window open timeout (ms)
//   clickDelayMs  {number}  600           Post-click settle delay (ms)
//   chatTimeoutMs {number}  12000         Chat verification timeout (ms)

const { deliverOneOrder } = require('../lib/skills/orderTraverse')

module.exports = async function deliverOrderAction(bot, options = {}) {
    await deliverOneOrder(bot, {
        itemName:      options.itemName      ?? 'blaze_rod',
        orderCommand:  options.orderCommand  ?? null,
        maxItems:      options.maxItems      ?? 64,
        winTimeoutMs:  options.winTimeoutMs  ?? 8000,
        clickDelayMs:  options.clickDelayMs  ?? 600,
        chatTimeoutMs: options.chatTimeoutMs ?? 12000,
    })
}
