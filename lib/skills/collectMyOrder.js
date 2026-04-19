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
//   itemName          {string}   'redstone'    Minecraft item ID of the order to collect
//   orderCommand      {string}   '/order'      command that opens the main ORDERS window
//   winTimeoutMs      {number}   8000          ms to wait for each GUI window to open
//   clickDelayMs      {number}   500           post-click settle delay between nav clicks
//   flattenDelayMs    {number}   150           delay between each inventory spread click
//   settleAfterFillMs {number}   1500          ms to wait after inventory clicks before returning
//                                              Paper requires close_window(0) + a settle gap
//                                              before any /ah command will succeed
//   debug             {boolean}  false         when true: log every container slot in EDIT ORDER and COLLECT ITEMS windows
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

// ── Phase 1: GUI navigation — collect items from My Orders ────────────────────

async function collectFromMyOrder(bot, opts = {}) {
    const {
        itemName          = 'redstone',
        orderCommand      = '/order',
        winTimeoutMs      = 8000,
        clickDelayMs      = 10,
        flattenDelayMs    = 10,
        settleAfterFillMs = 1500,
        debug             = false,
    } = opts

    // ── 1. Open main ORDERS window ────────────────────────────────────────────
    let ordersWin
    try {
        ordersWin = await openChatCommandWindow(bot, orderCommand, winTimeoutMs)
    } catch (err) {
        bot.log.warn(`${LOG} Failed to open "${orderCommand}": ${err.message}`)
        return null
    }
    bot.log.info(`${LOG} ORDERS window open  title:"${ordersWin.title?.value ?? ''}"`)

    // ── 2. Find and click "YOUR ORDERS" nav slot ──────────────────────────────
    const yourOrdersSlot = findContainerSlotByKeyword(ordersWin, 'your orders')
    if (yourOrdersSlot < 0) {
        bot.log.warn(`${LOG} "YOUR ORDERS" slot not found in ORDERS window`)
        // Log all container slots to aid debugging
        for (const { idx, slot } of allContainerEntries(ordersWin)) {
            bot.log.info(`${LOG}   slot[${idx}]  ${slot.name}  "${getDisplayName(slot)}"`)
        }
        try { bot.closeWindow(ordersWin) } catch { }
        return null
    }
    bot.log.info(`${LOG} "YOUR ORDERS" slot: ${yourOrdersSlot}`)

    let yourOrdersWin
    try {
        const p = waitForWindowOpen(bot, winTimeoutMs)
        await bot.clickWindow(yourOrdersSlot, 0, 0)
        yourOrdersWin = await p
        await sleep(clickDelayMs)
    } catch (err) {
        bot.log.warn(`${LOG} "ORDERS → Your Orders" window failed: ${err.message}`)
        try { bot.closeWindow(bot.currentWindow) } catch { }
        return null
    }
    bot.log.info(`${LOG} YOUR ORDERS window open  title:"${yourOrdersWin.title?.value ?? ''}"`)

    // ── 3. Find the order slot for itemName ───────────────────────────────────
    // Try exact Minecraft ID match first, then display-name fuzzy match.
    const entries = allContainerEntries(yourOrdersWin)
    let itemEntry = entries.find(e => e.slot.name === itemName)

    if (!itemEntry) {
        const norm = normalizeText(itemName.replace(/_/g, ' '))
        itemEntry = entries.find(e =>
            normalizeText(getDisplayName(e.slot)).includes(norm) ||
            normalizeText(e.slot.name.replace(/_/g, ' ')).includes(norm)
        )
    }

    if (!itemEntry) {
        bot.log.warn(`${LOG} "${itemName}" not found in YOUR ORDERS. Visible slots:`)
        for (const { idx, slot } of entries) {
            bot.log.info(`${LOG}   slot[${idx}]  ${slot.name}  "${getDisplayName(slot)}"`)
        }
        try { bot.closeWindow(yourOrdersWin) } catch { }
        return null
    }
    bot.log.info(`${LOG} Order slot: [${itemEntry.idx}]  "${getDisplayName(itemEntry.slot)}"`)

    // ── 4. Click order slot → ORDERS → Edit Order window ─────────────────────
    let editWin
    try {
        const p = waitForWindowOpen(bot, winTimeoutMs)
        await bot.clickWindow(itemEntry.idx, 0, 0)
        editWin = await p
        await sleep(clickDelayMs)
    } catch (err) {
        bot.log.warn(`${LOG} "ORDERS → Edit Order" window failed: ${err.message}`)
        try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow) } catch { }
        return null
    }
    bot.log.info(`${LOG} EDIT ORDER window open  title:"${editWin.title?.value ?? ''}"`)

    if (debug) {
        const snap = snapshotWindow(editWin)
        logWindowSnapshot(bot, snap, 'EDIT ORDER')
        dumpWindowToFile(bot, editWin, 'edit_order')
    }

    // ── 5. Find COLLECT slot ──────────────────────────────────────────────────
    // findSlotByKeyword uses unicode-normalised search across name + lore.
    const collectSlot = findSlotByKeyword(editWin, 'collect')
    if (collectSlot < 0) {
        bot.log.warn(`${LOG} COLLECT slot not found in Edit Order window`)
        try { bot.closeWindow(editWin) } catch { }
        await closeAllWindows(bot)
        return null
    }
    bot.log.info(`${LOG} COLLECT slot: ${collectSlot}  "${getDisplayName(editWin.slots[collectSlot])}"`)

    // ── 6. Click COLLECT → wait for "ORDERS → Collect Items" window ─────────
    // DonutSMP opens a new inventory window containing the stockpiled item stacks.
    // We must waitForWindowOpen BEFORE clicking so the event is never missed.
    const beforeCount = bot.inventory.items()
        .filter(i => i.name === itemName)
        .reduce((s, i) => s + i.count, 0)

    bot.log.info(`${LOG} Inventory ${itemName} before collect: ${beforeCount}`)

    let collectItemsWin
    try {
        const p = waitForWindowOpen(bot, winTimeoutMs)
        await bot.clickWindow(collectSlot, 0, 0)
        bot.log.info(`${LOG} COLLECT clicked — waiting for Collect Items window...`)
        collectItemsWin = await p
        await sleep(clickDelayMs)
    } catch (err) {
        bot.log.warn(`${LOG} "ORDERS → Collect Items" window failed: ${err.message}`)
        await closeAllWindows(bot)
        return null
    }
    bot.log.info(`${LOG} COLLECT ITEMS window open  title:"${collectItemsWin.title?.value ?? ''}"`)

    if (debug) {
        const snap = snapshotWindow(collectItemsWin)
        logWindowSnapshot(bot, snap, 'COLLECT ITEMS')
        dumpWindowToFile(bot, collectItemsWin, 'collect_items')
    }

    // ── 7. Find one stack of itemName in the Collect Items container ──────────
    // Exact Minecraft ID match — the container is full of item stacks, not GUI buttons.
    const collectEntry = allContainerEntries(collectItemsWin)
        .find(e => e.slot.name === itemName)

    if (!collectEntry) {
        bot.log.warn(`${LOG} "${itemName}" not found in Collect Items window — nothing to take`)
        try { bot.closeWindow(collectItemsWin) } catch { }
        await closeAllWindows(bot)
        return { received: 0, totalInInventory: beforeCount }
    }
    bot.log.info(`${LOG} Taking slot[${collectEntry.idx}]  x${collectEntry.slot.count}  "${getDisplayName(collectEntry.slot)}"`)

    // ── 8. Shift-click the stack → moves it directly to player inventory ──────
    // mode=1 (shift-click) transfers the whole stack in one packet.
    try {
        await bot.clickWindow(collectEntry.idx, 0, 1)
        await sleep(800) // let set_slot packets arrive before counting
    } catch (err) {
        bot.log.warn(`${LOG} Shift-click to collect failed: ${err.message}`)
    }

    // ── 9. Close cascade windows (server may re-open orders list after take) ──
    await closeAllWindows(bot, 4, 700)

    // ── 10. Count received items ──────────────────────────────────────────────
    const afterCount = bot.inventory.items()
        .filter(i => i.name === itemName)
        .reduce((s, i) => s + i.count, 0)
    const received = afterCount - beforeCount

    bot.log.info(`${LOG} Received: ${received}x ${itemName}  (inventory total: ${afterCount})`)

    if (received <= 0) {
        bot.log.warn(`${LOG} No ${itemName} arrived in inventory after shift-click`)
        return { received: 0, totalInInventory: afterCount }
    }

    // ── 11. Move stack to the first free slot (slot 9 = top-left main inventory)
    // Shift-click from a container places items wherever the server decides
    // (typically last hotbar slot first). We explicitly relocate to the smallest
    // available slot so the flatten remainder lands there predictably.
    await sleep(300)
    await moveToFirstFreeSlot(bot, itemName, clickDelayMs)

    // ── 12. Flatten the received stack across empty inventory slots ───────────
    await sleep(200)
    await flattenInventoryStack(bot, itemName, { clickDelayMs: flattenDelayMs })

    // ── 13. Signal "inventory closed" to Paper ────────────────────────────────
    // moveToFirstFreeSlot and flattenInventoryStack both issue window-0 clicks.
    // Paper treats burst window-0 clicks as "inventory open" and will block any
    // subsequent /ah browse or /ah sell command until it receives close_window(0).
    // bot.closeWindow(bot.inventory) sends that packet; the settle delay lets the
    // server process it before the caller issues the next command.
    bot.closeWindow(bot.inventory)
    await sleep(settleAfterFillMs)

    return { received, totalInInventory: afterCount }
}

// ── Phase 2: Move a stack to the smallest free inventory slot ─────────────────
//
// Player inventory slot layout (mineflayer window slot indices):
//   Main inventory : 9 – 35  (3 rows × 9)
//   Hotbar         : 36 – 44 (1 row × 9)
//
// Scans 9 → 44 and places the item at the first unoccupied slot via two
// left-clicks (pick up from current → place at target). No-ops if the item
// is already at the lowest possible slot or there is nothing to move.

async function moveToFirstFreeSlot(bot, itemName, clickDelayMs = 150) {
    const allItems = bot.inventory.items()
    const stack = allItems.find(i => i.name === itemName)
    if (!stack) return

    const occupied = new Set(allItems.map(i => i.slot))

    // Find the first unoccupied slot in 9..44
    let targetSlot = -1
    for (let s = 9; s <= 44; s++) {
        if (!occupied.has(s)) { targetSlot = s; break }
    }

    if (targetSlot < 0 || targetSlot === stack.slot) return // already there or no space

    bot.log.info(`${LOG} Moving ${itemName} slot ${stack.slot} → slot ${targetSlot} (first free)`)
    await bot.clickWindow(stack.slot, 0, 0)  // pick up whole stack
    await sleep(clickDelayMs)
    await bot.clickWindow(targetSlot, 0, 0)  // place at target
    await sleep(clickDelayMs)
}

// ── Phase 3: Spread one stack across empty inventory slots ────────────────────
//
// Algorithm:
//   • Find the target item stack in bot.inventory.items()
//   • Left-click to pick up whole stack onto cursor
//   • Right-click each empty main-inventory / hotbar slot → places exactly 1
//   • Left-click original slot to put remainder back (slot is empty since we lifted it)
//
// Player inventory slot layout (mineflayer / MC protocol):
//   Main inventory : 9 – 35  (27 slots, rows 1–3)
//   Hotbar         : 36 – 44 (9 slots,  row 4)
//   Total          : 36 writable slots
//
// Caution: bot.clickWindow uses bot.currentWindow when set, otherwise falls back
//   to bot.inventory.window (windowId 0). Always call this AFTER all custom
//   windows have been closed so the fallback is used.

async function flattenInventoryStack(bot, itemName, opts = {}) {
    const { clickDelayMs = 150, stackSlot = null } = opts

    // Re-read inventory state at the moment of flattening
    const allItems = bot.inventory.items()
    const stack = stackSlot !== null
        ? allItems.find(i => i.name === itemName && i.slot === stackSlot)
        : allItems.find(i => i.name === itemName)

    if (!stack) {
        bot.log.warn(`${LOG} [FLATTEN] No "${itemName}" in inventory`)
        return
    }
    if (stack.count <= 1) {
        bot.log.info(`${LOG} [FLATTEN] Stack is already 1 — nothing to spread`)
        return
    }

    // Build set of slots occupied by OTHER items (never right-click into these)
    const occupiedSlots = new Set(
        allItems.filter(i => i !== stack).map(i => i.slot)
    )

    // Collect all empty main+hotbar slots (excluding the stack's own slot)
    const emptySlots = []
    for (let s = 9; s <= 44; s++) {
        if (s !== stack.slot && !occupiedSlots.has(s)) emptySlots.push(s)
    }

    // Spread at most (stack.count - 1) items so cursor always has ≥1 to put back.
    const spreadCount = Math.min(emptySlots.length, stack.count - 1)

    bot.log.info(
        `${LOG} [FLATTEN] ${stack.count}x ${itemName}  slot:${stack.slot}` +
        `  empty:${emptySlots.length}  spreading:${spreadCount}`
    )

    if (spreadCount === 0) {
        bot.log.info(`${LOG} [FLATTEN] No empty slots or nothing to spread`)
        return
    }

    // Left-click to pick up the whole stack (cursor now holds it all)
    await bot.clickWindow(stack.slot, 0, 0)
    await sleep(clickDelayMs)

    // Right-click each target empty slot → server places exactly 1 item
    for (let i = 0; i < spreadCount; i++) {
        await bot.clickWindow(emptySlots[i], 1, 0)
        await sleep(clickDelayMs)
    }

    // Left-click original slot (now empty) to drop the remainder back
    await bot.clickWindow(stack.slot, 0, 0)
    await sleep(clickDelayMs)

    // Log final state
    const finalItems = bot.inventory.items()
    const finalCount = finalItems.filter(i => i.name === itemName).reduce((s, i) => s + i.count, 0)
    const stacks = finalItems.filter(i => i.name === itemName).length
    bot.log.info(
        `${LOG} [FLATTEN] Done: spread ${spreadCount}x into ${spreadCount} slots` +
        `  remainder back at slot ${stack.slot}` +
        `  inventory now has ${finalCount}x across ${stacks} stacks`
    )
}

module.exports = { collectFromMyOrder, flattenInventoryStack }
