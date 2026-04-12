// ── debugSpawnerWindow ─────────────────────────────────────────────────────────
// Active interaction: right-clicks a spawner block, waits for the DonutSMP
// plugin to open a window, then dumps every piece of observable data to the
// log for debugging:
//
//   • raw window metadata  (type, id, total slot count, raw title JSON)
//   • parsed title text    (the "N MOB spawners" string DonutSMP injects)
//   • every container slot  with slot index, item name, count, metadata, and
//     a short NBT summary when present
//   • every player-inventory slot in the same format
//   • totals-by-item-type table, sorted descending by count
//
// When probeConfirmSell is true (default), the skill also clicks the sell
// button (slot 48 — the gold ingot) so the CONFIRM SELL window opens, logs
// that window in the same format, then closes it.  The bot never clicks the
// green confirm button, so no items are actually sold.
//
// This lives in skills/ — NOT world.js — because it sends packets
// (bot.activateBlock → player_block_placement OUT, waits for open_window IN,
// bot.clickWindow → window_click OUT, waits for open_window IN).
//
// @param {Bot}    bot
// @param {Block}  block               spawner block from world.getNearestBlock()
// @param {object} [opts]
// @param {number}  [opts.timeoutMs=5000]        ms to wait for each windowOpen
// @param {boolean} [opts.probeConfirmSell=true]  click sell slot → log confirm window
// @param {number}  [opts.confirmSellSlot=48]     slot index of the sell button
//
// @returns {Promise<{
//   spawnerWindow:  WindowSnapshot | null,
//   confirmWindow:  WindowSnapshot | null,
// }>}

const { openSpawnerWindow, waitForWindowOpen } = require('./spawnerWindow')
const { snapshotWindow, logWindowSnapshot }    = require('./debugWindow')

// ── Main export ───────────────────────────────────────────────────────────────

async function debugSpawnerWindow(bot, block, opts = {}) {
    const {
        timeoutMs        = 5000,
        probeConfirmSell = true,
        confirmSellSlot  = 48,
    } = opts

    const pos = block.position

    // ── 1. Open spawner window ────────────────────────────────────────────────
    let spawnerWin
    try {
        spawnerWin = await openSpawnerWindow(bot, block, timeoutMs)
    } catch (err) {
        bot.log.warn(`[WIN-DEBUG] spawner windowOpen failed: ${err.message}`)
        return { spawnerWindow: null, confirmWindow: null }
    }

    const spawnerSnap = snapshotWindow(spawnerWin)
    logWindowSnapshot(bot, spawnerSnap, `SPAWNER WINDOW  @ (${pos.x}, ${pos.y}, ${pos.z})`)

    // ── 2. Probe confirm-sell window ──────────────────────────────────────────
    let confirmSnap = null

    if (probeConfirmSell) {
        const sellItem     = spawnerWin.slots[confirmSellSlot]
        const sellItemName = sellItem ? sellItem.name : '(empty)'
        bot.log.info(`[WIN-DEBUG] Clicking slot[${confirmSellSlot}] (${sellItemName}) to open CONFIRM SELL window…`)

        let confirmWin
        try {
            // Listener registered before clicking — avoids missing the event.
            const winPromise = waitForWindowOpen(bot, timeoutMs)
            await bot.clickWindow(confirmSellSlot, 0, 0)
            confirmWin = await winPromise
        } catch (err) {
            bot.log.warn(`[WIN-DEBUG] CONFIRM SELL windowOpen failed: ${err.message}`)
            try { bot.closeWindow(spawnerWin) } catch {}
            return { spawnerWindow: spawnerSnap, confirmWindow: null }
        }

        confirmSnap = snapshotWindow(confirmWin)
        logWindowSnapshot(bot, confirmSnap, 'CONFIRM SELL WINDOW')

        // Close the confirm window. Do NOT click the green button — nothing is sold.
        bot.closeWindow(confirmWin)
    } else {
        bot.closeWindow(spawnerWin)
    }

    return { spawnerWindow: spawnerSnap, confirmWindow: confirmSnap }
}

module.exports = { debugSpawnerWindow }
