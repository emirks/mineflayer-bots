const world = require('../lib/world')
const { debugSpawnerWindow } = require('../lib/skills/debugSpawnerWindow')

// One-shot diagnostic: opens the nearest spawner GUI and dumps everything
// observable in the window to the log — raw title, type/id/slot counts, every
// container slot, every player-inventory slot, and totals-by-item-type.
//
// If probeConfirmSell is true (default), it also clicks the sell button
// (slot 48 — the gold ingot in the DonutSMP action bar) so the CONFIRM SELL
// window opens, logs that window in the same format, then closes it.
// The bot never clicks the green confirm button — nothing is actually sold.
//
// Options:
//   radius           (default 32)    — block search radius for the spawner
//   timeoutMs        (default 5000)  — ms to wait for each windowOpen event
//   probeConfirmSell (default true)  — whether to click sell slot + log confirm
//   confirmSellSlot  (default 48)    — slot index of the sell button (gold ingot)
async function debugSpawnerWindowAction(bot, options) {
    const {
        radius           = 32,
        timeoutMs        = 5000,
        probeConfirmSell = true,
        confirmSellSlot  = 48,
    } = options

    const block = world.getNearestBlock(bot, 'spawner', radius)

    if (!block) {
        bot.log.warn(`[WIN-DEBUG] No spawner found within ${radius} blocks`)
        return
    }

    await debugSpawnerWindow(bot, block, { timeoutMs, probeConfirmSell, confirmSellSlot })
}

module.exports = debugSpawnerWindowAction
