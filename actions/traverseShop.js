// ── traverseShop action ────────────────────────────────────────────────────────
// One-shot action that runs a full shop traversal:
//   /shop → each category → list all items → probe one buy window → back → next category
//
// Options:
//   shopCommand   (default '/shop')   command to open the main shop
//   winTimeoutMs  (default 8000)      ms to wait for each windowOpen event
//   clickDelayMs  (default 600)       ms to wait after each click before next step
//   maxBuyProbes  (default 1)         how many buy windows to click into globally
//                                     (all share the same layout — 1 is enough)
//
// Outputs to bot.log and to the logger run directory:
//   traverse_main_shop.json
//   traverse_cat_<name>.json   (one per category)
//   traverse_buy_layout.json   (one buy window layout sample)
//   shop_catalog.json          (clean catalog: category → items → lore/prices)

const { traverseShop } = require('../lib/skills/shopTraverse')

async function traverseShopAction(bot, options = {}) {
    await traverseShop(bot, {
        shopCommand:  options.shopCommand  ?? '/shop',
        winTimeoutMs: options.winTimeoutMs ?? 8000,
        clickDelayMs: options.clickDelayMs ?? 600,
        maxBuyProbes: options.maxBuyProbes ?? 1,
    })
}

module.exports = traverseShopAction
