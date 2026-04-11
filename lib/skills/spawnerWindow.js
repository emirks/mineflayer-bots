// ── spawnerWindow — atomic DonutSMP spawner GUI skills ────────────────────────
//
// Each function here does exactly ONE server-meaningful thing.
// Nothing in this file navigates the bot (pathfinding) or loops over spawners.
// All packet interactions rely on mineflayer's guaranteed sequencing:
//   open_window → window_items → windowOpen event (prepareWindow contract)
//
// Exported:
//   classifySpawnerPage(win, itemSlotStart, itemSlotEnd, sellTriggerItems)
//   openSpawnerWindow(bot, block, timeoutMs)
//   dropSpawnerPage(bot, slotDrop, settleMs)
//   navigateToNextPage(bot, slotNextPage, timeoutMs)
//   sellSpawnerPage(bot, slotSell, confirmFallback, settleMs, timeoutMs)
//
// DonutSMP spawner window layout (empirically confirmed):
//   slots  0–44  generated loot (bones or arrows)
//   slot   45    left-page arrow  (prev page; absent on page 1)
//   slots 46–47  empty decorators
//   slot   48    gold_ingot       ALWAYS present → opens CONFIRM SELL
//   slot   49    skeleton_skull   ALWAYS present → page indicator
//   slot   50    dropper          ALWAYS present → drops current page
//   slot   53    arrow            next-page arrow (absent on last page)
//
// CONFIRM SELL window layout (server slotCount=3):
//   slot   11    red_stained_glass_pane  (cancel)
//   slot   13    skeleton_skull          (item preview)
//   slot   15    lime_stained_glass_pane (confirm) — right-clicked twice

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── waitForWindowOpen ─────────────────────────────────────────────────────────
// Internal helper used by openSpawnerWindow, navigateToNextPage, and
// sellSpawnerPage. Waits for the next 'windowOpen' event (which mineflayer
// only emits AFTER the new window's items are populated) and cleans up the
// listener on both resolution and timeout.
function waitForWindowOpen(bot, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false

        const onOpen = (win) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(win)
        }
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            bot.removeListener('windowOpen', onOpen)
            reject(new Error(`windowOpen timeout (${timeoutMs}ms)`))
        }, timeoutMs)

        bot.once('windowOpen', onOpen)
    })
}

// ── classifySpawnerPage ───────────────────────────────────────────────────────
// Pure function — reads slots itemSlotStart..itemSlotEnd of an open window
// and returns a description of what items are on this page.
//
// @param {Window}   win
// @param {number}   [itemSlotStart=0]
// @param {number}   [itemSlotEnd=44]
// @param {string[]} [sellTriggerItems=['arrow']]
// @returns {{ hasSellTrigger, totalItems, counts, hasNextPage }}
function classifySpawnerPage(win, itemSlotStart = 0, itemSlotEnd = 44, sellTriggerItems = ['arrow']) {
    let hasSellTrigger = false
    let totalItems     = 0
    const counts       = {}

    for (let i = itemSlotStart; i <= itemSlotEnd; i++) {
        const slot = win.slots[i]
        if (!slot || !slot.name) continue
        totalItems++
        counts[slot.name] = (counts[slot.name] ?? 0) + slot.count
        if (sellTriggerItems.includes(slot.name)) hasSellTrigger = true
    }

    const nextSlot   = win.slots[53]
    const hasNextPage = !!(nextSlot && nextSlot.name)

    return { hasSellTrigger, totalItems, counts, hasNextPage }
}

// ── openSpawnerWindow ─────────────────────────────────────────────────────────
// Right-clicks the spawner block and waits for the GUI window to open.
// The returned window already has all slot data populated (mineflayer guarantee).
//
// @param {Bot}    bot
// @param {Block}  block
// @param {number} [timeoutMs=5000]
// @returns {Promise<Window>}  rejects on timeout
async function openSpawnerWindow(bot, block, timeoutMs = 5000) {
    const winPromise = waitForWindowOpen(bot, timeoutMs)
    bot.activateBlock(block)
    return winPromise
}

// ── dropSpawnerPage ───────────────────────────────────────────────────────────
// Clicks the dropper button on the currently-open spawner window.
// This drops the items on the current page on the server side.
// A short settle delay ensures the server processes the drop before
// any subsequent clicks are sent.
//
// @param {Bot}    bot
// @param {number} [slotDrop=50]    dropper slot index
// @param {number} [settleMs=400]   ms to wait after the click
// @returns {Promise<void>}
async function dropSpawnerPage(bot, slotDrop = 50, settleMs = 400) {
    await bot.clickWindow(slotDrop, 0, 0)
    await sleep(settleMs)
}

// ── navigateToNextPage ────────────────────────────────────────────────────────
// Clicks the next-page arrow in the currently-open spawner window.
// The server closes the current window and opens a new one with the next page's
// items already loaded; this function waits for that new windowOpen event.
//
// @param {Bot}    bot
// @param {number} [slotNextPage=53]  next-page arrow slot index
// @param {number} [timeoutMs=5000]   ms to wait for the new windowOpen
// @returns {Promise<Window>}  the new page window; rejects on timeout
async function navigateToNextPage(bot, slotNextPage = 53, timeoutMs = 5000) {
    // Register the listener BEFORE clicking so the event is never missed.
    const winPromise = waitForWindowOpen(bot, timeoutMs)
    await bot.clickWindow(slotNextPage, 0, 0)
    return winPromise
}

// ── sellSpawnerPage ───────────────────────────────────────────────────────────
// Clicks the sell button (gold ingot) in the currently-open spawner window,
// waits for the CONFIRM SELL window to open, right-clicks the lime stained
// glass pane twice to confirm, then waits for the settle delay.
//
// The lime glass slot is located dynamically by scanning all slots for
// 'lime_stained_glass_pane'; `confirmFallback` is used if not found.
//
// DonutSMP requires two right-clicks (mouseButton=1) on the confirm button.
//
// @param {Bot}    bot
// @param {number} [slotSell=48]          gold ingot slot (sell button)
// @param {number} [confirmFallback=15]   lime glass slot fallback in confirm win
// @param {number} [settleMs=600]         ms to wait after confirm clicks
// @param {number} [timeoutMs=5000]       ms to wait for CONFIRM SELL windowOpen
// @returns {Promise<void>}  rejects if the confirm window does not open in time
async function sellSpawnerPage(bot, slotSell = 48, confirmFallback = 15, settleMs = 600, timeoutMs = 5000) {
    const confirmWinPromise = waitForWindowOpen(bot, timeoutMs)
    await bot.clickWindow(slotSell, 0, 0)
    const confirmWin = await confirmWinPromise

    // Locate lime_stained_glass_pane dynamically; fall back to known slot.
    let limeSlot = confirmFallback
    for (let i = 0; i < confirmWin.slots.length; i++) {
        const s = confirmWin.slots[i]
        if (s && s.name === 'lime_stained_glass_pane') { limeSlot = i; break }
    }

    // Two right-clicks required by DonutSMP to confirm the sale.
    await bot.clickWindow(limeSlot, 1, 0)
    await sleep(150)
    await bot.clickWindow(limeSlot, 1, 0)
    await sleep(settleMs)
}

module.exports = {
    waitForWindowOpen,
    classifySpawnerPage,
    openSpawnerWindow,
    dropSpawnerPage,
    navigateToNextPage,
    sellSpawnerPage,
}
