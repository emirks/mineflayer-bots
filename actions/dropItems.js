const skills = require('../lib/skills')
const world  = require('../lib/world')

// Drop all (or a fixed count) of the given item(s) from the bot's inventory.
//
// ── WHY settleMs EXISTS ───────────────────────────────────────────────────────
//
//  bot.toss() → bot.transfer() → series of clickWindow() calls.
//
//  Each clickWindow() in mineflayer 1.17+ embeds the current stateId (updated
//  by incoming set_slot / window_items packets) in the window_click packet it
//  sends.  waitForWindowUpdate returns IMMEDIATELY for normal inventory slots
//  and for slot -999 (drop), so successive clicks all leave with the same
//  stateId even though the server increments it after each accepted click.
//
//  When the server receives a click whose stateId is stale, it sends back a
//  corrective set_slot resync.  On DonutSMP (Paper 1.21.x) this resync may
//  revert the cursor item for that click, meaning the drop never happens.
//  Because this is timing-dependent (depends on ping jitter and how many stacks
//  are being dropped), failures are intermittent.
//
//  settleMs gives the server enough time to finish processing every window_click
//  and for corrective set_slot packets to arrive and be applied BEFORE the
//  next action (usually disconnect → bot.quit()) closes the socket.  500 ms
//  comfortably covers 2–3 RTTs at even 150 ms ping.
//
// options.items    — array of item names, e.g. ['spawner', 'chest']
// options.item     — single item name shorthand (ignored when items is provided)
// options.count    — number to drop per item; -1 (default) = drop entire stack
// options.settleMs — post-drop wait before returning (default 500 ms)
//
async function dropItems(bot, options) {
  const { item, items, count = -1, settleMs = 500 } = options

  const targets = items ?? (item ? [item] : [])
  const sleep   = ms => new Promise(r => setTimeout(r, ms))

  if (targets.length === 0) {
    bot.log.warn('[ACTION] dropItems: no item(s) specified — skipping.')
    return
  }

  for (const itemName of targets) {
    const inv = bot.inventory.items().filter(i => i.name === itemName)

    if (inv.length === 0) {
      bot.log.info(`[ACTION] dropItems: no "${itemName}" in inventory — skipping.`)
      continue
    }

    const total    = inv.reduce((sum, i) => sum + i.count, 0)
    const dropping = count === -1 ? total : Math.min(count, total)
    bot.log.info(`[ACTION] dropItems: ${total} × "${itemName}" in inventory — dropping ${dropping}...`)

    await skills.discard(bot, itemName, count)

    // Wait for the server to process all window_click packets and send back any
    // stateId corrective set_slot packets before we proceed to disconnect.
    // Without this, rapid multi-stack drops sometimes go unexecuted on the
    // server side (stale stateId race — see comment at the top of this file).
    await sleep(settleMs)

    // Verify the drop actually landed.  If items remain, log a warning so we
    // can tune settleMs or investigate further.
    const remaining = (world.getInventoryCounts(bot)[itemName] ?? 0)
    if (remaining > 0) {
      bot.log.warn(
        `[ACTION] dropItems: ${remaining} × "${itemName}" still in inventory after settle — ` +
        `drop may have been rejected by server (stateId race).`
      )
    } else {
      bot.log.info(`[ACTION] dropItems: "${itemName}" fully dropped.`)
    }
  }
}

module.exports = dropItems
