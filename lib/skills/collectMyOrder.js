// ── collectMyOrder — retrieve items from a placed order + spread into inventory ─
//
// Full flow:
//   /order                          → ORDERS (Page 1)
//   click "YOUR ORDERS" nav slot    → ORDERS → Your Orders
//   click <itemName> slot           → ORDERS → Edit Order
//   click COLLECT slot              → ORDERS → Collect Items  (new window with item stacks)
//   shift-click one <itemName> stack → item arrives in inventory (wherever server puts it)
//   close cascade windows
//   moveToFirstFreeSlot() → relocate stack to slot 9 (first main-inventory slot)
//
//   flattenInventoryStack():
//     find stack at slot 9
//     left-click to pick up whole stack (cursor holds it)
//     right-click each empty slot starting at 10 → places 1 item each
//     left-click slot 9 → puts remainder back at slot 9
//
// Exports:
//   collectFromMyOrder(bot, opts)   — full flow (GUI nav + flatten)
//   flattenInventoryStack(bot, itemName, opts)  — standalone flatten step
//
// Options for collectFromMyOrder:
//   itemName       {string}   'redstone'    Minecraft item ID of the order to collect
//   orderCommand   {string}   '/order'      command that opens the main ORDERS window
//   winTimeoutMs   {number}   8000          ms to wait for each GUI window to open
//   clickDelayMs   {number}   500           post-click settle delay between nav clicks
//   flattenDelayMs {number}   150           delay between each inventory spread click
//   debug          {boolean}  false         when true: log every container slot in EDIT ORDER and COLLECT ITEMS windows
//
// Options for flattenInventoryStack:
//   clickDelayMs   {number}   150           delay between each spread click
//   stackSlot      {number}   null          if set, targets that specific inventory slot instead of the first match

const { openChatCommandWindow, snapshotWindow, logWindowSnapshot, dumpWindowToFile } = require('./debugWindow')
const { waitForWindowOpen } = require('./spawnerWindow')
const { getDisplayName, getLore, normalizeText, findSlotByKeyword } = require('./nbtParse')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const LOG = '[COLLECT-ORDER]'

// ── Internal helpers ──────────────────────────────────────────────────────────

// Returns all occupied container slots (not player inventory).
function allContainerEntries(win) {
    const slots = win.slots || []
    const end = win.inventoryStart ?? Math.max(0, slots.length - 36)
    const out = []
    for (let i = 0; i < end; i++) {
        if (slots[i] && slots[i].name) out.push({ idx: i, slot: slots[i] })
    }
    return out
}

// Finds the first container slot whose display name + lore (unicode-normalised)
// contains every word in `keyword`.
function findContainerSlotByKeyword(win, keyword) {
    const kw = normalizeText(keyword)
    for (const { idx, slot } of allContainerEntries(win)) {
        const text = normalizeText(getDisplayName(slot) + ' ' + getLore(slot).join(' '))
        if (text.includes(kw)) return idx
    }
    return -1
}

// Closes all currently open windows (server may re-open after delivery confirm).
async function closeAllWindows(bot, maxAttempts = 4, delayMs = 700) {
    for (let i = 0; i < maxAttempts; i++) {
        if (!bot.currentWindow) break
        try { bot.closeWindow(bot.currentWindow) } catch { }
        await sleep(delayMs)
    }
}
