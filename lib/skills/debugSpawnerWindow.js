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
//
// WindowSnapshot: {
//   windowType, windowId, rawTitle, parsedTitle,
//   totalSlots, containerSlotCount,
//   containerItems, playerItems, totalsByType
// }
// SlotEntry: { slot, name, count, metadata, nbt }

const { openSpawnerWindow, waitForWindowOpen } = require('./spawnerWindow')

const SEP  = '[WIN-DEBUG] ═══════════════════════════════════════════════════════'
const DASH = '[WIN-DEBUG] ───────────────────────────────────────────────────────'

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTitle(win) {
    const t = win.title
    if (t && typeof t === 'object' && t.value) {
        return t.value?.text?.value ?? ''
    }
    if (typeof t === 'string') {
        try { return JSON.parse(t).text ?? t } catch { return t }
    }
    return ''
}

function snapshotWindow(win) {
    const allSlots          = win.slots || []
    const totalSlots        = allSlots.length
    const containerSlotCount = typeof win.containerItems === 'function'
        ? win.containerItems().length
        : Math.max(0, totalSlots - 36)

    const containerItems = []
    const playerItems    = []
    const totalsByType   = {}

    allSlots.forEach((slot, idx) => {
        if (!slot || !slot.name) return

        const raw = JSON.stringify(slot.nbt)
        const nbtSummary = slot.nbt
            ? raw.slice(0, 80) + (raw.length > 80 ? '…' : '')
            : null

        const entry = { slot: idx, name: slot.name, count: slot.count, metadata: slot.metadata ?? 0, nbt: nbtSummary }
        totalsByType[slot.name] = (totalsByType[slot.name] ?? 0) + slot.count

        if (idx < containerSlotCount) containerItems.push(entry)
        else                          playerItems.push(entry)
    })

    return {
        windowType:         win.type ?? '(unknown)',
        windowId:           win.id   ?? '?',
        rawTitle:           JSON.stringify(win.title),
        parsedTitle:        parseTitle(win),
        totalSlots,
        containerSlotCount,
        containerItems,
        playerItems,
        totalsByType,
    }
}

function logSnapshot(bot, snap, header) {
    const { windowType, windowId, rawTitle, parsedTitle,
            totalSlots, containerSlotCount,
            containerItems, playerItems, totalsByType } = snap

    const typeEntries = Object.entries(totalsByType).sort((a, b) => b[1] - a[1])

    bot.log.info(SEP)
    bot.log.info(`[WIN-DEBUG] ${header}`)
    bot.log.info(`[WIN-DEBUG] type:"${windowType}"  id:${windowId}  total-slots:${totalSlots}  container-slots:${containerSlotCount}`)
    bot.log.info(`[WIN-DEBUG] Raw title  : ${rawTitle}`)
    bot.log.info(`[WIN-DEBUG] Title text : "${parsedTitle}"`)
    bot.log.info(DASH)

    bot.log.info(`[WIN-DEBUG] CONTAINER SLOTS  (${containerSlotCount} total, ${containerItems.length} occupied)`)
    if (containerItems.length === 0) {
        bot.log.info('[WIN-DEBUG]   (empty)')
    } else {
        for (const item of containerItems) {
            const nbtPart = item.nbt ? `  nbt:${item.nbt}` : ''
            bot.log.info(
                `[WIN-DEBUG]   slot[${String(item.slot).padStart(3)}]  ` +
                `${item.name.padEnd(36)}  x${String(item.count).padStart(3)}  ` +
                `meta:${item.metadata}${nbtPart}`
            )
        }
    }

    bot.log.info(DASH)
    bot.log.info(`[WIN-DEBUG] PLAYER INVENTORY (${totalSlots - containerSlotCount} total, ${playerItems.length} occupied)`)
    if (playerItems.length === 0) {
        bot.log.info('[WIN-DEBUG]   (empty)')
    } else {
        for (const item of playerItems) {
            const nbtPart = item.nbt ? `  nbt:${item.nbt}` : ''
            bot.log.info(
                `[WIN-DEBUG]   slot[${String(item.slot).padStart(3)}]  ` +
                `${item.name.padEnd(36)}  x${String(item.count).padStart(3)}  ` +
                `meta:${item.metadata}${nbtPart}`
            )
        }
    }

    bot.log.info(DASH)
    bot.log.info(`[WIN-DEBUG] TOTALS BY TYPE  (${typeEntries.length} distinct type${typeEntries.length !== 1 ? 's' : ''})`)
    for (const [name, count] of typeEntries) {
        bot.log.info(`[WIN-DEBUG]   ${name.padEnd(36)}  total:${count}`)
    }
    bot.log.info(SEP)
}

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
    logSnapshot(bot, spawnerSnap, `SPAWNER WINDOW  @ (${pos.x}, ${pos.y}, ${pos.z})`)

    // ── 2. Probe confirm-sell window ──────────────────────────────────────────
    let confirmSnap = null

    if (probeConfirmSell) {
        const sellItem = spawnerWin.slots[confirmSellSlot]
        const sellItemName = sellItem ? sellItem.name : '(empty)'
        bot.log.info(`[WIN-DEBUG] Clicking slot[${confirmSellSlot}] (${sellItemName}) to open CONFIRM SELL window…`)

        let confirmWin
        try {
            // Register the listener BEFORE clicking so the event is never missed.
            const winPromise = waitForWindowOpen(bot, timeoutMs)
            await bot.clickWindow(confirmSellSlot, 0, 0)
            confirmWin = await winPromise
        } catch (err) {
            bot.log.warn(`[WIN-DEBUG] CONFIRM SELL windowOpen failed: ${err.message}`)
            try { bot.closeWindow(spawnerWin) } catch {}
            return { spawnerWindow: spawnerSnap, confirmWindow: null }
        }

        confirmSnap = snapshotWindow(confirmWin)
        logSnapshot(bot, confirmSnap, 'CONFIRM SELL WINDOW')

        // Close confirm window only — do NOT click the green button.
        bot.closeWindow(confirmWin)
    } else {
        bot.closeWindow(spawnerWin)
    }

    return { spawnerWindow: spawnerSnap, confirmWindow: confirmSnap }
}

module.exports = { debugSpawnerWindow }
