// ── blazeTrade.js — DonutSMP buy-low / sell-high loop for blaze rods ──────────
//
// Full cycle:
//   /bal                        → record opening balance
//   /shop → nether → blaze_rod  → buy window (stays open after each purchase)
//     click "Set to 64" + "Confirm" until inventory full
//   close shop cascade
//   /order blaze rod             → orders (Page 1)
//     verify sort = "Most Paid"
//     scan for order where:  priceEach > buyPrice + minPriceMargin
//                         AND remaining >= minRemainingItems
//     if none found → click "Refresh" → re-scan (up to maxRefreshAttempts)
//     click order → Deliver Items window
//       shift-click every blaze_rod stack from inventory to container
//       (shift-click = mode 1 = 1 packet/stack, faster than window.deposit's 2)
//     close → Confirm Delivery → click Confirm → await chat
//   close cascade
//   /bal                        → log balance, profit, $/min
//   wait loopDelayMs            → repeat
//
// Options (all optional):
//   itemName          {string}  'blaze_rod'
//   shopCategoryKw    {string}  'nether'      keyword to find category in main shop
//   minPriceMargin    {number}  1             min $/ea above buy price
//   minRemainingItems {number}  5000          skip near-done orders (items)
//   maxRefreshAttempts{number}  5
//   refreshWaitMs     {number}  2000
//   maxBuyRounds      {number}  20            safety cap on buy loop iterations
//   loopDelayMs       {number}  3000          pause between cycles
//   winTimeoutMs      {number}  8000
//   clickDelayMs      {number}  500
//   depositDelayMs    {number}  120           delay between shift-clicks when depositing
//   chatTimeoutMs     {number}  12000

const { waitForWindowOpen } = require('./spawnerWindow')
const { openChatCommandWindow } = require('./debugWindow')
const { getDisplayName, getLore, findSlotByKeyword, normalizeText } = require('./nbtParse')
const { parseMoneyString, formatMoney } = require('./orderTraverse')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const LOG = '[BLAZE-TRADE]'

// ── Inventory helpers ─────────────────────────────────────────────────────────

function countItemInInventory(bot, itemName) {
    return bot.inventory.items()
        .filter(i => i.name === itemName)
        .reduce((s, i) => s + i.count, 0)
}

// 36 total player inventory slots (27 main + 9 hotbar); each occupied item takes one slot.
function freeInventorySlotCount(bot) {
    return 36 - bot.inventory.items().length
}

// ── Window helpers ────────────────────────────────────────────────────────────

function containerEntries(win) {
    const slots = win.slots || []
    const end = win.inventoryStart ?? Math.max(0, slots.length - 36)
    const out = []
    for (let i = 0; i < end; i++) {
        if (slots[i] && slots[i].name) out.push({ idx: i, slot: slots[i] })
    }
    return out
}

function winInventoryEntries(win) {
    const slots = win.slots || []
    const start = win.inventoryStart ?? Math.max(0, slots.length - 36)
    const out = []
    for (let i = start; i < slots.length; i++) {
        if (slots[i] && slots[i].name) out.push({ idx: i, slot: slots[i] })
    }
    return out
}

// Closes the current window and any parent windows that server re-opens.
async function closeAllWindows(bot, maxAttempts = 4, delayMs = 700) {
    for (let i = 0; i < maxAttempts; i++) {
        if (!bot.currentWindow) break
        try { bot.closeWindow(bot.currentWindow) } catch { }
        await sleep(delayMs)
    }
}

// ── Order lore parsing ────────────────────────────────────────────────────────

function parseOrderEntry(slot) {
    const lore = getLore(slot)
    let priceEach = 0
    let priceStr = ''
    let deliveredAmt = 0
    let totalAmt = 0
    let playerName = ''

    for (const line of lore) {
        // "$141.13 each"  or  "$50.5K each"
        const pm = line.match(/(\$[\d,.]+[KkMm]?)\s+each/i)
        if (pm) { priceStr = pm[1]; priceEach = parseMoneyString(pm[1]) }

        // "887.63K/3M Delivered"
        const dm = line.match(/([\d.]+[KkMm]?)\s*\/\s*([\d.]+[KkMm]?)\s+Delivered/i)
        if (dm) { deliveredAmt = parseMoneyString(dm[1]); totalAmt = parseMoneyString(dm[2]) }

        // "Click to deliver .PlayerName ..."
        const cm = line.match(/Click to deliver \.?(\S+)/i)
        if (cm) playerName = cm[1]
    }

    return { priceEach, priceStr, deliveredAmt, totalAmt, remaining: totalAmt - deliveredAmt, playerName, lore }
}

function isRealOrder(slot) {
    if (!slot || !slot.name) return false
    const lore = getLore(slot).join(' ')
    return lore.includes('each') && lore.includes('deliver')
}

// ── Sort detection ────────────────────────────────────────────────────────────

// Reads the active sort option from raw NBT lore: active = non-white color (#00fc88 on DonutSMP).
function getActiveSortMode(sortSlot) {
    const loreList = sortSlot?.nbt?.value?.display?.value?.Lore?.value?.value
    if (!Array.isArray(loreList)) return null
    for (const rawLine of loreList) {
        try {
            const json = JSON.parse(rawLine)
            const extras = Array.isArray(json.extra) ? json.extra : []
            for (const e of extras) {
                const c = e.color ?? ''
                if (c && c !== 'white' && c !== 'gray' && c !== 'dark_gray') {
                    return (e.text ?? '').replace(/^[•\s]+/, '').trim()
                }
            }
        } catch { }
    }
    return null
}

async function ensureSortMostPaid(bot, win, clickDelayMs) {
    const slots = win.slots || []
    const end = win.inventoryStart ?? Math.max(0, slots.length - 36)
    let sortIdx = -1
    for (let i = 0; i < end; i++) {
        if (!slots[i]) continue
        const text = normalizeText(getDisplayName(slots[i]) + ' ' + getLore(slots[i]).join(' '))
        if (text.includes('sort') || text.includes('most paid')) { sortIdx = i; break }
    }
    if (sortIdx < 0) { bot.log.warn(`${LOG} Sort button not found`); return }

    for (let attempt = 0; attempt < 5; attempt++) {
        const cur = bot.currentWindow?.slots?.[sortIdx]
        if (!cur) break
        const mode = getActiveSortMode(cur)
        bot.log.info(`${LOG} Sort: slot[${sortIdx}]  active:"${mode ?? 'unknown'}"`)
        if (normalizeText(mode ?? '') === 'most paid') {
            bot.log.info(`${LOG} Sort ✓ "Most Paid"`)
            return
        }
        bot.log.info(`${LOG} Cycling sort...`)
        await bot.clickWindow(sortIdx, 0, 0)
        await sleep(clickDelayMs)
    }
}

// ── Chat helpers ──────────────────────────────────────────────────────────────

function waitForDeliveryChat(bot, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            bot.removeListener('message', h)
            reject(new Error('Delivery chat timeout'))
        }, timeoutMs)
        function h(msg) {
            const text = msg.toString()
            const m = text.match(/You delivered ([\d,.]+[KkMm]?) .+ and received \$([\d,.]+[KkMm]?)/i)
            if (m) {
                clearTimeout(timer); bot.removeListener('message', h)
                resolve({ qty: parseMoneyString(m[1]), amount: parseMoneyString(m[2]), amountStr: `$${m[2]}`, raw: text.trim() })
            }
        }
        bot.on('message', h)
    })
}

function getBalance(bot, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            bot.removeListener('message', h)
            reject(new Error('Balance timeout'))
        }, timeoutMs)
        function h(msg) {
            const text = msg.toString()
            const low = text.toLowerCase()
            const m = text.match(/\$([\d,.]+[KkMm]?)/)
            if (m && (low.includes('you have') || low.includes('balance'))) {
                clearTimeout(timer); bot.removeListener('message', h)
                resolve(parseMoneyString(m[1]))
            }
        }
        bot.on('message', h)
        bot.chat('/bal')
    })
}

// ── Phase 1: Buy blaze rods from shop ────────────────────────────────────────

async function buyFromShop(bot, opts = {}) {
    const {
        itemName = 'blaze_rod',
        shopCategoryKw = 'nether',
        maxBuyRounds = 20,
        winTimeoutMs = 8000,
        clickDelayMs = 500,
    } = opts

    let buyPrice = 0
    let boughtThisRun = 0
    const T = { phase: Date.now() }
    const ms = from => `${Date.now() - from}ms`

    // ── Open main shop ────────────────────────────────────────────────────────
    let mainWin
    try {
        mainWin = await openChatCommandWindow(bot, '/shop', winTimeoutMs)
    } catch (err) {
        bot.log.warn(`${LOG} Failed to open /shop: ${err.message}`)
        return { boughtThisRun, buyPrice }
    }
    bot.log.perf(`${LOG} ⏱ /shop open: ${ms(T.phase)}`)
    bot.log.info(`${LOG} ── MAIN SHOP  title:"${mainWin.title?.value ?? ''}"`)

    // Find category slot by keyword (e.g., "nether")
    const mainSlots = mainWin.slots || []
    const mainEnd = mainWin.inventoryStart ?? Math.max(0, mainSlots.length - 36)
    let catSlot = -1
    for (let i = 0; i < mainEnd; i++) {
        if (!mainSlots[i]) continue
        if (normalizeText(getDisplayName(mainSlots[i]) + ' ' + getLore(mainSlots[i]).join(' ')).includes(shopCategoryKw)) {
            catSlot = i; break
        }
    }
    if (catSlot < 0) {
        bot.log.warn(`${LOG} Category "${shopCategoryKw}" not found in main shop`)
        try { bot.closeWindow(mainWin) } catch { }
        return { boughtThisRun, buyPrice }
    }
    bot.log.info(`${LOG} Category slot: ${catSlot}  "${getDisplayName(mainSlots[catSlot])}"`)

    // ── Click category ────────────────────────────────────────────────────────
    T.t = Date.now()
    let catWin
    try {
        const p = waitForWindowOpen(bot, winTimeoutMs)
        await bot.clickWindow(catSlot, 0, 0)
        catWin = await p
    } catch (err) {
        bot.log.warn(`${LOG} Category window failed: ${err.message}`)
        await closeAllWindows(bot)
        return { boughtThisRun, buyPrice }
    }
    bot.log.perf(`${LOG} ⏱ category open: ${ms(T.t)}`)
    bot.log.info(`${LOG} ── CATEGORY  title:"${catWin.title?.value ?? ''}"`)

    // Find item slot by itemName (exact Minecraft ID match)
    const catSlots = catWin.slots || []
    const catEnd = catWin.inventoryStart ?? Math.max(0, catSlots.length - 36)
    let itemSlot = -1
    for (let i = 0; i < catEnd; i++) {
        if (catSlots[i] && catSlots[i].name === itemName) { itemSlot = i; break }
    }
    if (itemSlot < 0) {
        bot.log.warn(`${LOG} ${itemName} not found in category`)
        await closeAllWindows(bot)
        return { boughtThisRun, buyPrice }
    }
    bot.log.info(`${LOG} Item slot: ${itemSlot}  "${getDisplayName(catSlots[itemSlot])}"`)

    // ── Click item → buy window ───────────────────────────────────────────────
    T.t = Date.now()
    let buyWin
    try {
        const p = waitForWindowOpen(bot, winTimeoutMs)
        await bot.clickWindow(itemSlot, 0, 0)
        buyWin = await p
    } catch (err) {
        bot.log.warn(`${LOG} Buy window failed: ${err.message}`)
        await closeAllWindows(bot)
        return { boughtThisRun, buyPrice }
    }
    bot.log.perf(`${LOG} ⏱ buy window open: ${ms(T.t)}`)
    bot.log.info(`${LOG} ── BUY WINDOW  title:"${buyWin.title?.value ?? ''}"  type:${buyWin.type}`)

    // Parse buy price from the item slot in buy window
    const buySlots = buyWin.slots || []
    const buyEnd = buyWin.inventoryStart ?? Math.max(0, buySlots.length - 36)
    for (let i = 0; i < buyEnd; i++) {
        if (buySlots[i] && buySlots[i].name === itemName) {
            for (const l of getLore(buySlots[i])) {
                const m = l.match(/\$([\d,.]+[KkMm]?)/)
                if (m) { buyPrice = parseMoneyString(m[1]); break }
            }
            break
        }
    }
    bot.log.info(`${LOG} Shop buy price: ${formatMoney(buyPrice)}/ea`)

    // Find action buttons in buy window
    // Priority: "Set to 64" → "Add 64" → hardcoded slot 17 (from traversal data)
    let set64Slot = findSlotByKeyword(buyWin, 'set to 64')
    if (set64Slot < 0) set64Slot = findSlotByKeyword(buyWin, 'add 64')
    if (set64Slot < 0) set64Slot = 17 // fallback from ender_chest traversal layout

    const confirmSlot = findSlotByKeyword(buyWin, 'confirm')
    const cancelSlot = findSlotByKeyword(buyWin, 'cancel')

    bot.log.info(`${LOG} Buy action slots: set64=${set64Slot}  confirm=${confirmSlot}  cancel=${cancelSlot}`)

    if (confirmSlot < 0) {
        bot.log.warn(`${LOG} Confirm slot not found in buy window — dumped above. Closing.`)
        await closeAllWindows(bot)
        return { boughtThisRun, buyPrice }
    }

    // ── Buy loop: Set to 64 → Confirm → repeat until inventory full ───────────
    T.t = Date.now()
    for (let round = 0; round < maxBuyRounds && !bot._quitting; round++) {
        const free = freeInventorySlotCount(bot)
        if (free < 1) {
            bot.log.info(`${LOG} Inventory full after ${round} buy rounds`)
            break
        }

        // Set quantity to 64 before each confirm
        if (set64Slot >= 0) {
            await bot.clickWindow(set64Slot, 0, 0)
        }

        await bot.clickWindow(confirmSlot, 0, 0)
        boughtThisRun += 64
        await sleep(80) // let server add items to inventory

        const total = countItemInInventory(bot, itemName)
        bot.log.info(`${LOG} Buy round ${round + 1}: inv ${itemName}=${total}  free slots=${freeInventorySlotCount(bot)}`)
    }
    if (boughtThisRun > 0) bot.log.perf(`${LOG} ⏱ buy loop (${boughtThisRun} items): ${ms(T.t)}`)

    // ── Close buy window → category → main shop ───────────────────────────────
    T.t = Date.now()
    if (cancelSlot >= 0) {
        await bot.clickWindow(cancelSlot, 0, 0)
        await sleep(700)
    }
    if (bot.currentWindow) {
        const backSlot = findSlotByKeyword(bot.currentWindow, 'back')
        if (backSlot >= 0) {
            await bot.clickWindow(backSlot, 0, 0)
            await sleep(700)
        }
    }
    await closeAllWindows(bot, 3, 700)
    bot.log.perf(`${LOG} ⏱ shop close cascade: ${ms(T.t)}`)

    const finalCount = countItemInInventory(bot, itemName)
    bot.log.info(`${LOG} Buy complete: ${finalCount}x ${itemName} in inventory  (${boughtThisRun} purchased this cycle)`)
    bot.log.perf(`${LOG} ⏱ buyFromShop total: ${ms(T.phase)}`)
    return { boughtThisRun, buyPrice, totalInInventory: finalCount }
}

// ── Phase 2: Deliver all inventory items to best profitable order ─────────────

async function deliverToOrder(bot, opts = {}) {
    const {
        itemName = 'blaze_rod',
        buyPrice = 0,
        minPriceMargin = 1,       // must earn at least $1/ea over buy price
        minRemainingItems = 5000,    // skip orders with fewer items left
        maxRefreshAttempts = 5,
        refreshWaitMs = 2000,
        winTimeoutMs = 8000,
        clickDelayMs = 500,
        depositDelayMs = 120,     // delay between shift-clicks for deposit
        chatTimeoutMs = 12000,
    } = opts

    const invCount = countItemInInventory(bot, itemName)
    if (invCount === 0) {
        bot.log.warn(`${LOG} No ${itemName} in inventory — skipping delivery`)
        return null
    }
    bot.log.info(`${LOG} Delivering ${invCount}x ${itemName}  (buyPrice:${formatMoney(buyPrice)}/ea  minMargin:${formatMoney(minPriceMargin)}/ea  minRemaining:${minRemainingItems})`)

    const T = { phase: Date.now() }
    const ms = from => `${Date.now() - from}ms`

    // ── Open orders window ────────────────────────────────────────────────────
    const cmd = `/order ${itemName.replace(/_/g, ' ')}`
    let ordersWin
    try {
        ordersWin = await openChatCommandWindow(bot, cmd, winTimeoutMs)
    } catch (err) {
        bot.log.warn(`${LOG} Failed to open orders: ${err.message}`)
        return null
    }
    bot.log.perf(`${LOG} ⏱ /order open: ${ms(T.phase)}`)
    bot.log.info(`${LOG} ── ORDERS  title:"${ordersWin.title?.value ?? ''}"`)

    // Ensure sort = "Most Paid" so the most valuable orders are visible on page 1
    await ensureSortMostPaid(bot, ordersWin, clickDelayMs)

    // Find the Refresh slot ("Click to refresh" lore)
    const oSlots = ordersWin.slots || []
    const oEnd = ordersWin.inventoryStart ?? Math.max(0, oSlots.length - 36)
    let refreshSlot = -1
    for (let i = 0; i < oEnd; i++) {
        if (!oSlots[i]) continue
        if (normalizeText(getLore(oSlots[i]).join(' ')).includes('refresh')) { refreshSlot = i; break }
    }
    bot.log.info(`${LOG} Refresh slot: ${refreshSlot}`)

    // ── Scan for best order (with refresh retries if none found) ──────────────
    const minPrice = buyPrice + minPriceMargin
    let bestEntry = null
    T.t = Date.now()

    for (let attempt = 0; attempt <= maxRefreshAttempts && !bot._quitting; attempt++) {
        const win = bot.currentWindow ?? ordersWin

        const candidates = containerEntries(win)
            .filter(e => isRealOrder(e.slot))
            .map(e => ({ ...e, info: parseOrderEntry(e.slot) }))
            .filter(e => e.info.priceEach >= minPrice && e.info.remaining >= minRemainingItems)
            .sort((a, b) => b.info.priceEach - a.info.priceEach)

        const total = containerEntries(win).filter(e => isRealOrder(e.slot)).length
        bot.log.info(`${LOG} Attempt ${attempt}: ${total} orders visible,  ${candidates.length} suitable  (price>=${formatMoney(minPrice)}, rem>=${minRemainingItems})`)

        if (candidates.length > 0) {
            bestEntry = candidates[0]
            T.tOrderFound = Date.now()
            const i = bestEntry.info
            bot.log.info(`${LOG} Best: slot[${bestEntry.idx}]  "${getDisplayName(bestEntry.slot)}"  ${i.priceStr}/ea  remaining:${formatMoney(i.remaining)}  player:${i.playerName}`)
            bot.log.perf(`${LOG} ⏱ order found (${attempt} refresh${attempt !== 1 ? 'es' : ''}): ${ms(T.t)}`)
            break
        }

        if (attempt < maxRefreshAttempts && refreshSlot >= 0) {
            bot.log.info(`${LOG} No suitable order — clicking refresh (${attempt + 1}/${maxRefreshAttempts})...`)
            await bot.clickWindow(refreshSlot, 0, 0)
            await sleep(refreshWaitMs)
        }
    }

    if (!bestEntry) {
        bot.log.warn(`${LOG} No suitable order found after ${maxRefreshAttempts} refreshes`)
        try { bot.closeWindow(bot.currentWindow ?? ordersWin) } catch { }
        await sleep(800)
        await closeAllWindows(bot)
        return { noOrder: true }
    }

    // ── Click order → Deliver Items window ────────────────────────────────────
    let deliverWin
    try {
        const p = waitForWindowOpen(bot, winTimeoutMs)
        await bot.clickWindow(bestEntry.idx, 0, 0)
        deliverWin = await p
    } catch (err) {
        bot.log.warn(`${LOG} Deliver Items window failed: ${err.message}`)
        await closeAllWindows(bot)
        return null
    }
    bot.log.perf(`${LOG} ⏱ deliver window open: ${ms(T.tOrderClick)}`)
    bot.log.info(`${LOG} ── DELIVER ITEMS  title:"${deliverWin.title?.value ?? ''}"  slots:${deliverWin.inventoryStart ?? '?'}`)

    // ── Deposit: shift-click every blaze_rod stack from inventory ─────────────
    // shift-click (mode=1) is 1 packet/stack — fastest possible bulk deposit.
    const rodStacks = winInventoryEntries(deliverWin).filter(e => e.slot.name === itemName)
    bot.log.info(`${LOG} Depositing ${rodStacks.length} stacks (${rodStacks.reduce((s, e) => s + e.slot.count, 0)} items)...`)

    T.t = Date.now()
    let deposited = 0
    for (const e of rodStacks) {
        await bot.clickWindow(e.idx, 0, 1) // shift-click
        deposited += e.slot.count
        await sleep(depositDelayMs)
    }
    bot.log.perf(`${LOG} ⏱ deposit ${rodStacks.length} stacks: ${ms(T.t)}`)
    bot.log.info(`${LOG} Deposited ~${deposited}x ${itemName}`)
    await sleep(clickDelayMs)

    // ── Close Deliver Items → Confirm Delivery ────────────────────────────────
    T.t = Date.now()
    let confirmWin
    try {
        const p = waitForWindowOpen(bot, winTimeoutMs)
        bot.closeWindow(deliverWin)
        confirmWin = await p
    } catch (err) {
        bot.log.warn(`${LOG} Confirm Delivery window failed: ${err.message}`)
        await closeAllWindows(bot)
        return null
    }
    bot.log.perf(`${LOG} ⏱ confirm window open: ${ms(T.t)}`)
    bot.log.info(`${LOG} ── CONFIRM DELIVERY  title:"${confirmWin.title?.value ?? ''}"  slots:${confirmWin.inventoryStart ?? '?'}`)

    // Log confirm window contents
    for (const e of containerEntries(confirmWin)) {
        const name = getDisplayName(e.slot)
        const lore = getLore(e.slot)
        bot.log.info(`${LOG}   slot[${String(e.idx).padStart(2)}]  ${e.slot.name.padEnd(26)}  "${name}"`)
        for (const l of lore) bot.log.info(`${LOG}     lore: ${l}`)
    }

    // ── Click Confirm ─────────────────────────────────────────────────────────
    const confirmSlot = findSlotByKeyword(confirmWin, 'confirm')
    if (confirmSlot < 0) {
        bot.log.warn(`${LOG} Confirm slot not found in Confirm Delivery window`)
        try { bot.closeWindow(confirmWin) } catch { }
        await closeAllWindows(bot)
        return null
    }
    bot.log.info(`${LOG} Confirm slot: ${confirmSlot}  "${getDisplayName(confirmWin.slots[confirmSlot])}"`)

    // Register chat listener BEFORE clicking to avoid race condition
    const chatP = waitForDeliveryChat(bot, chatTimeoutMs)
    await bot.clickWindow(confirmSlot, 0, 0)
    const tConfirmClicked = Date.now()
    bot.log.perf(`${LOG} ⏱ order-found → confirm-click (TOTAL EXPOSURE): ${tConfirmClicked - T.tOrderFound}ms`)
    bot.log.info(`${LOG} Confirm clicked — awaiting delivery chat...`)

    let deliveryResult = null
    try {
        deliveryResult = await chatP
        bot.log.perf(`${LOG} ⏱ confirm-click → chat ack (server latency): ${Date.now() - tConfirmClicked}ms`)
        bot.log.info(`${LOG} ✓ ${deliveryResult.raw}`)
    } catch (err) {
        bot.log.warn(`${LOG} Chat verification failed: ${err.message}`)
        const remaining = countItemInInventory(bot, itemName)
        const gone = invCount - remaining
        bot.log.warn(`${LOG} Fallback: had ${invCount}, now have ${remaining}  (${gone} left inventory)`)
    }

    // Close cascade
    T.t = Date.now()
    await sleep(1000)
    await closeAllWindows(bot, 4, 800)
    bot.log.perf(`${LOG} ⏱ delivery close cascade: ${ms(T.t)}`)
    bot.log.perf(`${LOG} ⏱ deliverToOrder total: ${ms(T.phase)}`)

    return { bestEntry, deposited, deliveryResult }
}

// ── Main trade loop ───────────────────────────────────────────────────────────

async function blazeTradeLoop(bot, opts = {}) {
    const {
        itemName = 'blaze_rod',
        minPriceMargin = 1,
        minRemainingItems = 5000,
        maxRefreshAttempts = 5,
        refreshWaitMs = 2000,
        maxBuyRounds = 20,
        loopDelayMs = 3000,
        winTimeoutMs = 8000,
        clickDelayMs = 500,
        depositDelayMs = 120,
        chatTimeoutMs = 12000,
    } = opts

    let cycleCount = 0
    let totalEarned = 0
    let totalCost = 0
    const t0 = Date.now()

    bot.log.info(`${LOG} ════════ Blaze Trade Loop starting ════════`)
    bot.log.info(`${LOG} item:${itemName}  minMargin:${formatMoney(minPriceMargin)}/ea  minRemaining:${minRemainingItems} items`)

    while (!bot._quitting) {
        cycleCount++
        const cycleStart = Date.now()
        bot.log.info(`${LOG}`)
        bot.log.info(`${LOG} ── Cycle ${cycleCount} ──────────────────────────────────────────`)

        // Opening balance
        let balance = null
        try {
            balance = await getBalance(bot)
            bot.log.info(`${LOG} Balance: ${formatMoney(balance)}`)
        } catch { bot.log.warn(`${LOG} Balance read failed`) }
        await sleep(400)

        if (bot._quitting) break

        // ── Phase 1: Buy ──────────────────────────────────────────────────────
        let buyResult = { boughtThisRun: 0, buyPrice: 0, totalInInventory: 0 }
        try {
            buyResult = await buyFromShop(bot, { itemName, maxBuyRounds, winTimeoutMs, clickDelayMs, ...opts })
        } catch (err) {
            bot.log.warn(`${LOG} Buy phase error: ${err.message}`)
            buyResult.totalInInventory = countItemInInventory(bot, itemName)
            buyResult.buyPrice = 0
        }

        const { buyPrice = 0 } = buyResult
        const totalInInventory = countItemInInventory(bot, itemName) // re-read after buy

        bot.log.info(`${LOG} After buy: ${totalInInventory}x ${itemName}  buyPrice:${formatMoney(buyPrice)}/ea`)

        if (totalInInventory === 0) {
            bot.log.warn(`${LOG} No ${itemName} available — waiting ${loopDelayMs}ms`)
            await sleep(loopDelayMs)
            continue
        }

        if (bot._quitting) break
        await sleep(800)

        // ── Phase 2: Sell (deliver) ───────────────────────────────────────────
        let sellResult = null
        try {
            sellResult = await deliverToOrder(bot, {
                itemName, buyPrice, minPriceMargin, minRemainingItems,
                maxRefreshAttempts, refreshWaitMs,
                winTimeoutMs, clickDelayMs, depositDelayMs, chatTimeoutMs, ...opts,
            })
        } catch (err) {
            bot.log.warn(`${LOG} Sell phase error: ${err.message}`)
        }

        // ── Cycle metrics ─────────────────────────────────────────────────────
        const cycleMs = Date.now() - cycleStart
        const totalMs = Date.now() - t0

        if (sellResult?.deliveryResult) {
            const d = sellResult.deliveryResult
            const cost = deposited(sellResult) * buyPrice
            const profit = d.amount - cost
            totalEarned += d.amount
            totalCost += cost
            const orderPrice = sellResult.bestEntry?.info?.priceEach ?? 0

            bot.log.info(`${LOG}`)
            bot.log.info(`${LOG} ── Cycle ${cycleCount} result ──────────────────────────────`)
            bot.log.info(`${LOG} Order    : ${formatMoney(orderPrice)}/ea  player:${sellResult.bestEntry?.info?.playerName ?? '?'}`)
            bot.log.info(`${LOG} Sold     : ${d.qty}x ${itemName}`)
            bot.log.info(`${LOG} Revenue  : ${d.amountStr}`)
            bot.log.info(`${LOG} Cost     : ${formatMoney(cost)}  (${d.qty}x @ ${formatMoney(buyPrice)}/ea)`)
            bot.log.info(`${LOG} Profit   : ${formatMoney(profit)}  (${formatMoney(profit / Math.max(d.qty, 1))}/ea)`)
            bot.log.info(`${LOG} Cycle    : ${(cycleMs / 1000).toFixed(1)}s`)
            bot.log.info(`${LOG} Running  : earned ${formatMoney(totalEarned)}  cost ${formatMoney(totalCost)}  net ${formatMoney(totalEarned - totalCost)}`)
            if (totalMs > 0) {
                const rateMin = (totalEarned - totalCost) / (totalMs / 60000)
                bot.log.info(`${LOG} Rate     : ${formatMoney(rateMin)}/min  over ${cycleCount} cycles`)
            }
        } else if (sellResult?.noOrder) {
            bot.log.info(`${LOG} No suitable order found — will retry next cycle`)
        }

        bot.log.info(`${LOG} Waiting ${loopDelayMs}ms before next cycle...`)
        await sleep(loopDelayMs)
    }

    bot.log.info(`${LOG}`)
    bot.log.info(`${LOG} ════════ Blaze Trade Loop ended ════════`)
    bot.log.info(`${LOG} Cycles: ${cycleCount}  Earned: ${formatMoney(totalEarned)}  Cost: ${formatMoney(totalCost)}  Net: ${formatMoney(totalEarned - totalCost)}`)
}

// Helper: get deposited count from sell result (might be slightly off due to partial stacks)
function deposited(sellResult) {
    return sellResult?.deliveryResult?.qty ?? sellResult?.deposited ?? 0
}

module.exports = { blazeTradeLoop, buyFromShop, deliverToOrder }
