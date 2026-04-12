// ── orderTraverse — DonutSMP /order delivery skill ────────────────────────────
//
// Handles one end-to-end delivery cycle for a given item:
//
//   /bal                           → record opening balance
//   /order <item>                  → open ORDERS (Page 1)
//     log: sort mode, all orders (price/delivery/player)
//     find best order (assumes "Most Paid" sort = first item)
//     click order slot
//       → ORDERS → Deliver Items   (deposit items via shift-click)
//       close window
//       → ORDERS → Confirm Delivery
//         click Confirm (lime glass)
//         wait for chat: "You delivered N X and received $Y"
//         fallback: check whether inventory items are gone
//       [window cascade closes automatically]
//   /bal                           → record closing balance, log metrics
//
// Money amounts are handled with K/M suffix support throughout:
//   "$431"    →    431
//   "$9.28K"  →  9,280
//   "$2.9M"   → 2,900,000
//   "8.93M"   (bare, used in lore delivery counters) → 8,930,000
//
// @param {Bot}    bot
// @param {object} [opts]
// @param {string}  [opts.itemName='blaze_rod']  Minecraft item ID to deliver
// @param {string}  [opts.orderCommand]          defaults to '/order <item name>'
// @param {number}  [opts.maxItems=64]           max items to deposit per delivery
// @param {number}  [opts.winTimeoutMs=8000]     per-window open timeout
// @param {number}  [opts.clickDelayMs=600]      settle delay after each GUI click
// @param {number}  [opts.chatTimeoutMs=12000]   wait for delivery chat confirmation

const { waitForWindowOpen }                                                          = require('./spawnerWindow')
const { openChatCommandWindow, snapshotWindow, logWindowSnapshot, dumpWindowToFile } = require('./debugWindow')
const { getDisplayName, getLore, findSlotByKeyword, normalizeText }                  = require('./nbtParse')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const LOG   = '[ORDER-TRAVERSE]'

// ── Money parsing ─────────────────────────────────────────────────────────────

// Converts any money string to a plain number.
// Handles optional leading $, comma-separators, and K/M suffixes.
// Examples: "$431" → 431   "$9.28K" → 9280   "$2.9M" → 2900000   "8.93M" → 8930000
function parseMoneyString(str) {
    if (!str) return 0
    const clean = String(str).replace(/[$,\s]/g, '')
    const m = clean.match(/^([\d.]+)([KkMm]?)$/)
    if (!m) return 0
    const n = parseFloat(m[1])
    const s = m[2].toUpperCase()
    if (s === 'K') return n * 1e3
    if (s === 'M') return n * 1e6
    return n
}

// Formats a number back to a compact string for logging.
function formatMoney(n) {
    if (n === null || n === undefined) return '?'
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
    return `$${n.toFixed(2)}`
}

// ── Window title helpers ──────────────────────────────────────────────────────

function winTitleNorm(win) {
    return normalizeText(win?.title?.value ?? win?.title ?? '')
}

// "ᴏʀᴅᴇʀѕ (Page 1)"  → normalises to "orders (page 1)"
function isOrdersListWin(win) {
    const t = winTitleNorm(win)
    return t.includes('orders') && t.includes('page')
}

// "ᴏʀᴅᴇʀѕ → ᴅᴇʟɪᴠᴇʀ ɪᴛᴇᴍѕ"  →  "orders -> deliver items"
function isDeliverItemsWin(win) {
    const t = winTitleNorm(win)
    return t.includes('orders') && t.includes('deliver') && t.includes('items')
}

// "ᴏʀᴅᴇʀѕ → ᴄᴏɴꜰɪʀᴍ ᴅᴇʟɪᴠᴇʀʏ"  →  "orders -> confirm delivery"
function isConfirmDeliveryWin(win) {
    const t = winTitleNorm(win)
    return t.includes('orders') && t.includes('confirm')
}

// ── Balance via /bal ──────────────────────────────────────────────────────────

// Sends /bal, listens to the next chat message containing a $ amount, returns
// the parsed number.  Rejects after timeoutMs.
function getBalance(bot, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            bot.removeListener('message', handler)
            reject(new Error('Balance timeout'))
        }, timeoutMs)

        function handler(jsonMsg) {
            const text = jsonMsg.toString()
            const low  = text.toLowerCase()
            // "You have $2.9M." or "Balance: $431"
            const m = text.match(/\$([\d,.]+[KkMm]?)/)
            if (m && (low.includes('you have') || low.includes('balance'))) {
                clearTimeout(timer)
                bot.removeListener('message', handler)
                resolve(parseMoneyString(m[1]))
            }
        }

        bot.on('message', handler)
        bot.chat('/bal')
    })
}

// ── Order lore parsing ────────────────────────────────────────────────────────

// Extracts structured data from one order slot's lore.
// Lore format (from live dump):
//   ""
//   "$141.13 each"
//   "8.93M/10M Delivered"
//   ""
//   "Click to deliver .DordeMaximus Blaze Rods"
function parseOrderLore(slot) {
    const lines = getLore(slot)
    let priceEach   = 0
    let priceStr    = ''
    let deliveredAmt = 0
    let totalAmt    = 0
    let deliveredStr = ''
    let playerName  = ''

    for (const line of lines) {
        // Price: "$141.13 each"  or  "$50.5K each"
        const pm = line.match(/(\$[\d,.]+[KkMm]?)\s+each/i)
        if (pm) {
            priceStr  = pm[1]
            priceEach = parseMoneyString(pm[1])
        }

        // Delivery: "8.93M/10M Delivered"  or  "13.92M/17.28M Delivered"
        const dm = line.match(/([\d.]+[KkMm]?)\s*\/\s*([\d.]+[KkMm]?)\s+Delivered/i)
        if (dm) {
            deliveredStr = line.trim()
            deliveredAmt = parseMoneyString(dm[1])
            totalAmt     = parseMoneyString(dm[2])
        }

        // Player name: "Click to deliver .PlayerName ..."
        const cm = line.match(/Click to deliver \.?(\S+)/i)
        if (cm) playerName = cm[1]
    }

    return { priceEach, priceStr, deliveredAmt, totalAmt, deliveredStr, playerName, lore: lines }
}

// ── Slot classification ───────────────────────────────────────────────────────

// Navigation / decoration materials that are never real orders.
const NAV_MATERIALS = new Set([
    'red_stained_glass_pane', 'lime_stained_glass_pane',
    'gray_stained_glass_pane', 'black_stained_glass_pane',
    'white_stained_glass_pane', 'green_stained_glass_pane',
    'arrow', 'barrier', 'oak_sign', 'birch_sign',
    'oak_button', 'stone_button',
])

function isNavSlot(slot) {
    if (!slot || !slot.name) return true
    if (NAV_MATERIALS.has(slot.name)) return true
    const text = normalizeText(getDisplayName(slot) + ' ' + getLore(slot).join(' '))
    return text.includes('next page') || text.includes('previous page')
}

// A slot is a real order if it has a price-per-item in its lore.
function isOrderSlot(slot) {
    if (!slot || !slot.name) return false
    if (isNavSlot(slot)) return false
    const lore = getLore(slot).join(' ')
    return lore.includes('each') || lore.includes('deliver')
}

// ── Sort button ───────────────────────────────────────────────────────────────

function findSortSlot(win) {
    const slots = win.slots || []
    const end   = win.inventoryStart ?? Math.max(0, slots.length - 36)
    for (let i = 0; i < end; i++) {
        const s = win.slots[i]
        if (!s) continue
        const text = normalizeText(getDisplayName(s) + ' ' + getLore(s).join(' '))
        if (text.includes('sort') || text.includes('most paid') || text.includes('recently listed')) return i
    }
    return -1
}

// Reads the active sort mode from the sort slot's raw NBT lore.
// The active option has a non-white color (#00fc88 green/teal on DonutSMP);
// inactive options are plain white.  Returns e.g. "Most Paid" or null.
function getActiveSortMode(sortSlot) {
    const loreList = sortSlot?.nbt?.value?.display?.value?.Lore?.value?.value
    if (!Array.isArray(loreList)) return null

    for (const rawLine of loreList) {
        try {
            const json   = JSON.parse(rawLine)
            const extras = Array.isArray(json.extra) ? json.extra : []
            for (const e of extras) {
                const c = e.color ?? ''
                // Active option has a highlight color (not white, gray, or empty)
                if (c && c !== 'white' && c !== 'gray' && c !== 'dark_gray') {
                    return (e.text ?? '').replace(/^[•\s]+/, '').trim()
                }
            }
        } catch {}
    }
    return null
}

// Clicks the sort button until "Most Paid" becomes the active mode.
// Reads the CURRENT window slot each iteration so slot-update packets are respected.
// Returns true if successfully set, false if exhausted attempts.
async function ensureMostPaidSort(bot, sortIdx, clickDelayMs = 700) {
    const CYCLE_MAX = 5 // 4 options in the cycle + 1 safety margin

    for (let attempt = 0; attempt < CYCLE_MAX; attempt++) {
        const win  = bot.currentWindow
        const slot = win?.slots?.[sortIdx]
        if (!win || !slot) {
            bot.log.warn(`${LOG} Sort slot gone during cycling — aborting`)
            return false
        }

        const current = getActiveSortMode(slot)
        bot.log.info(`${LOG} Sort cycle ${attempt}: active="${current ?? 'unknown'}"`)

        if (normalizeText(current ?? '') === 'most paid') {
            bot.log.info(`${LOG} Sort ✓ "Most Paid" confirmed active`)
            return true
        }

        bot.log.info(`${LOG} Clicking sort to cycle to next option...`)
        await bot.clickWindow(sortIdx, 0, 0)
        await sleep(clickDelayMs) // wait for server slot-update packets
    }

    const finalSlot = bot.currentWindow?.slots?.[sortIdx]
    const finalMode = finalSlot ? getActiveSortMode(finalSlot) : null
    bot.log.warn(`${LOG} Could not activate "Most Paid" (final active: "${finalMode ?? 'unknown'}")`)
    return false
}

// ── Container helpers ─────────────────────────────────────────────────────────

function allContainerEntries(win) {
    const slots = win.slots || []
    const end   = win.inventoryStart ?? Math.max(0, slots.length - 36)
    const result = []
    for (let i = 0; i < end; i++) {
        if (slots[i] && slots[i].name) result.push({ idx: i, slot: slots[i] })
    }
    return result
}

function inventoryEntries(win) {
    const slots = win.slots || []
    const start = win.inventoryStart ?? Math.max(0, slots.length - 36)
    const result = []
    for (let i = start; i < slots.length; i++) {
        if (slots[i] && slots[i].name) result.push({ idx: i, slot: slots[i] })
    }
    return result
}

// Logs every container slot with display name and full lore.
// Use only for SMALL windows (confirm, deliver items) — for large order lists
// use logNavBarItems + the compact order-entry loop instead.
function logContainerSlots(bot, win, prefix) {
    const entries = allContainerEntries(win)
    bot.log.info(`${LOG} ${prefix}  (${entries.length} container slots occupied)`)
    for (const e of entries) {
        const name = getDisplayName(e.slot)
        const lore = getLore(e.slot)
        const nav  = isNavSlot(e.slot) ? ' [NAV]' : ''
        bot.log.info(`${LOG}   slot[${String(e.idx).padStart(2)}]${nav}  ${e.slot.name.padEnd(26)}  "${name}"`)
        for (const l of lore) bot.log.info(`${LOG}     lore: ${l}`)
    }
}

// Logs ONLY the navigation/UI items in the orders window (filter, sort, search,
// your orders, refresh, next/prev arrows).  Separate from the order entries loop
// so neither gets garbled by rapid interleaved output.
function logNavBarItems(bot, win) {
    const navEntries = allContainerEntries(win).filter(e => !isOrderSlot(e.slot))
    bot.log.info(`${LOG} ── Nav bar (${navEntries.length} items):`)
    for (const e of navEntries) {
        const name = getDisplayName(e.slot)
        const lore = getLore(e.slot)
        bot.log.info(`${LOG}   slot[${String(e.idx).padStart(2)}]  ${e.slot.name.padEnd(26)}  "${name}"`)
        for (const l of lore) bot.log.info(`${LOG}     lore: ${l}`)
    }
}

// ── Deposit items into delivery container ─────────────────────────────────────

// Shift-clicks all matching items from the player inventory into the container.
// Returns total item count deposited.
async function depositInventoryItems(bot, win, itemName, maxItems, clickDelayMs) {
    const entries = inventoryEntries(win)
    let deposited = 0

    for (const e of entries) {
        if (deposited >= maxItems) break
        if (e.slot.name !== itemName) continue

        const qty = Math.min(e.slot.count, maxItems - deposited)
        // Shift-click moves the whole stack to the container
        await bot.clickWindow(e.idx, 0, 1)
        deposited += qty
        await sleep(clickDelayMs)
    }

    return deposited
}

// ── Chat verification ─────────────────────────────────────────────────────────

// Listens for the server's "You delivered N X and received $Y" chat line.
function waitForDeliveryChat(bot, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            bot.removeListener('message', handler)
            reject(new Error(`No delivery confirmation chat within ${timeoutMs}ms`))
        }, timeoutMs)

        function handler(jsonMsg) {
            const text = jsonMsg.toString()
            // "You delivered 64 Blaze Rods and received $9.28K"
            const m = text.match(/You delivered (\d+) .+ and received \$([\d,.]+[KkMm]?)/i)
            if (m) {
                clearTimeout(timer)
                bot.removeListener('message', handler)
                resolve({
                    quantity:   parseInt(m[1]),
                    amount:     parseMoneyString(m[2]),
                    amountStr:  `$${m[2]}`,
                    raw:        text.trim(),
                })
            }
        }

        bot.on('message', handler)
    })
}

// ── Window cascade closer ─────────────────────────────────────────────────────

// After delivery confirm the server reopens Deliver Items → Orders Page 1.
// Close each in turn; give up after maxAttempts.
async function closeCascadeWindows(bot, maxAttempts = 3, delayMs = 800) {
    for (let i = 0; i < maxAttempts; i++) {
        const win = bot.currentWindow
        if (!win) break
        const title = win.title?.value ?? winTitleNorm(win)
        bot.log.info(`${LOG} Closing cascade window: "${title}"`)
        try { bot.closeWindow(win) } catch {}
        await sleep(delayMs)
    }
}

// ── Main: deliver one order ───────────────────────────────────────────────────

async function deliverOneOrder(bot, opts = {}) {
    const {
        itemName      = 'blaze_rod',
        orderCommand  = null,
        maxItems      = 64,
        winTimeoutMs  = 8000,
        clickDelayMs  = 600,
        chatTimeoutMs = 12000,
    } = opts

    const cmd    = orderCommand ?? `/order ${itemName.replace(/_/g, ' ')}`
    const runDir = bot.log?.runDir
    const t0     = Date.now()

    bot.log.info(`${LOG} ════════ Order delivery start ════════`)
    bot.log.info(`${LOG} item:${itemName}  cmd:"${cmd}"  maxItems:${maxItems}`)

    // ── 1. Opening balance ────────────────────────────────────────────────────
    let balBefore = null
    try {
        balBefore = await getBalance(bot)
        bot.log.info(`${LOG} Balance before: ${formatMoney(balBefore)}`)
    } catch (err) {
        bot.log.warn(`${LOG} Could not read balance: ${err.message}`)
    }
    await sleep(400)

    // ── 2. Open orders list window ────────────────────────────────────────────
    let ordersWin
    try {
        ordersWin = await openChatCommandWindow(bot, cmd, winTimeoutMs)
    } catch (err) {
        bot.log.warn(`${LOG} Failed to open orders window: ${err.message}`)
        return null
    }

    bot.log.info(`${LOG} ── ORDERS  title:"${ordersWin.title?.value ?? ''}"  type:${ordersWin.type}`)

    // ── Log nav bar items (filter, sort, search, your orders, arrows, etc.) ───
    // Done BEFORE the order loop so the two don't interleave in the terminal.
    logNavBarItems(bot, ordersWin)

    // ── Detect + enforce "Most Paid" sort ─────────────────────────────────────
    const sortIdx = findSortSlot(ordersWin)
    if (sortIdx >= 0) {
        const sortSlot   = ordersWin.slots[sortIdx]
        const activeMode = getActiveSortMode(sortSlot)
        bot.log.info(`${LOG} Sort: slot[${sortIdx}]  display:"${getDisplayName(sortSlot)}"  active:"${activeMode ?? 'unknown'}"`)
        for (const l of getLore(sortSlot)) bot.log.info(`${LOG}   sort option: ${l}`)

        if (normalizeText(activeMode ?? '') !== 'most paid') {
            bot.log.info(`${LOG} Sort is not "Most Paid" — cycling...`)
            await ensureMostPaidSort(bot, sortIdx, clickDelayMs)
            await sleep(600) // let server finish sending slot-update packets
        } else {
            bot.log.info(`${LOG} Sort ✓ "Most Paid" already active`)
        }
    } else {
        bot.log.warn(`${LOG} Sort button not found`)
    }

    logWindowSnapshot(bot, snapshotWindow(ordersWin), 'ORDERS')
    if (runDir) dumpWindowToFile(bot, ordersWin, 'orders_page1')

    // ── 3. Parse orders ───────────────────────────────────────────────────────
    const orderEntries = allContainerEntries(ordersWin).filter(e => isOrderSlot(e.slot))
    bot.log.info(`${LOG} Real orders: ${orderEntries.length}`)

    for (const e of orderEntries) {
        const p = parseOrderLore(e.slot)
        const remaining = p.totalAmt - p.deliveredAmt
        bot.log.info(`${LOG}   [${e.idx}] "${getDisplayName(e.slot)}"  ${p.priceStr}/ea  remaining:${formatMoney(remaining)}  player:${p.playerName}`)
    }

    if (orderEntries.length === 0) {
        bot.log.warn(`${LOG} No orders found — closing`)
        try { bot.closeWindow(ordersWin) } catch {}
        return null
    }

    // Best order = first (sort "Most Paid" assumed active)
    const target     = orderEntries[0]
    const targetInfo = parseOrderLore(target.slot)
    bot.log.info(`${LOG} Selected: slot[${target.idx}]  "${getDisplayName(target.slot)}"  ${targetInfo.priceStr}/ea  player:${targetInfo.playerName}`)

    // ── 4. Click order → Deliver Items window ─────────────────────────────────
    let deliverWin
    try {
        const p = waitForWindowOpen(bot, winTimeoutMs)
        await bot.clickWindow(target.idx, 0, 0)
        deliverWin = await p
        await sleep(clickDelayMs)
    } catch (err) {
        bot.log.warn(`${LOG} Deliver Items window did not open: ${err.message}`)
        try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow) } catch {}
        return null
    }

    bot.log.info(`${LOG} ── DELIVER ITEMS  title:"${deliverWin.title?.value ?? ''}"  type:${deliverWin.type}`)
    logWindowSnapshot(bot, snapshotWindow(deliverWin), 'DELIVER ITEMS')
    if (runDir) dumpWindowToFile(bot, deliverWin, 'orders_deliver_items')

    // ── 5. Deposit items from inventory ───────────────────────────────────────
    // Log what we have in inventory first
    const invItems = inventoryEntries(deliverWin).filter(e => e.slot.name === itemName)
    const invTotal  = invItems.reduce((s, e) => s + e.slot.count, 0)
    bot.log.info(`${LOG} Inventory ${itemName}: ${invTotal} (${invItems.length} stacks)`)

    if (invTotal === 0) {
        bot.log.warn(`${LOG} No ${itemName} in inventory — cancelling`)
        try { bot.closeWindow(deliverWin) } catch {}
        await sleep(1000)
        await closeCascadeWindows(bot)
        return null
    }

    const deposited = await depositInventoryItems(bot, deliverWin, itemName, maxItems, clickDelayMs)
    bot.log.info(`${LOG} Deposited ${deposited}x ${itemName}`)
    await sleep(clickDelayMs)

    // ── 6. Close Deliver Items → Confirm Delivery window ─────────────────────
    let confirmWin
    try {
        const p = waitForWindowOpen(bot, winTimeoutMs)
        bot.closeWindow(deliverWin)
        confirmWin = await p
        await sleep(clickDelayMs)
    } catch (err) {
        bot.log.warn(`${LOG} Confirm Delivery window did not open: ${err.message}`)
        try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow) } catch {}
        await sleep(800)
        await closeCascadeWindows(bot)
        return null
    }

    bot.log.info(`${LOG} ── CONFIRM DELIVERY  title:"${confirmWin.title?.value ?? ''}"  type:${confirmWin.type}`)
    logContainerSlots(bot, confirmWin, 'Confirm Delivery window')
    logWindowSnapshot(bot, snapshotWindow(confirmWin), 'CONFIRM DELIVERY')
    if (runDir) dumpWindowToFile(bot, confirmWin, 'orders_confirm_delivery')

    // ── 7. Click Confirm ──────────────────────────────────────────────────────
    const confirmSlot = findSlotByKeyword(confirmWin, 'confirm')
    if (confirmSlot < 0) {
        bot.log.warn(`${LOG} Confirm button not found — dumping confirm window slots`)
        logContainerSlots(bot, confirmWin, 'Confirm window (no confirm found)')
        try { bot.closeWindow(confirmWin) } catch {}
        await sleep(800)
        await closeCascadeWindows(bot)
        return null
    }

    bot.log.info(`${LOG} Confirm slot: ${confirmSlot}  "${getDisplayName(confirmWin.slots[confirmSlot])}"`)

    // Register chat listener BEFORE clicking so we don't miss the message
    const chatPromise = waitForDeliveryChat(bot, chatTimeoutMs)
    await bot.clickWindow(confirmSlot, 0, 0)
    bot.log.info(`${LOG} Confirm clicked — awaiting delivery chat (${chatTimeoutMs}ms)...`)

    // ── 8. Chat verification ──────────────────────────────────────────────────
    let deliveryResult = null
    try {
        deliveryResult = await chatPromise
        bot.log.info(`${LOG} ✓ Chat confirmed: ${deliveryResult.raw}`)
        bot.log.info(`${LOG}   qty:${deliveryResult.quantity}  earned:${deliveryResult.amountStr}  (${formatMoney(deliveryResult.amount)})`)
    } catch (err) {
        bot.log.warn(`${LOG} Chat verification failed: ${err.message}`)
        // Fallback inventory check
        const remainingItems = (bot.inventory?.items() ?? [])
            .filter(i => i.name === itemName)
            .reduce((s, i) => s + i.count, 0)
        const gone = invTotal - remainingItems
        bot.log.warn(`${LOG} Fallback: had ${invTotal}, now have ${remainingItems}  (${gone} gone from inventory)`)
        if (gone > 0) {
            bot.log.info(`${LOG} Items left inventory — treating as delivered (unverified)`)
        }
    }

    // ── 9. Close cascade windows ──────────────────────────────────────────────
    await sleep(1000)
    await closeCascadeWindows(bot, 3, 800)

    // ── 10. Closing balance + metrics ─────────────────────────────────────────
    await sleep(500)
    let balAfter = null
    try {
        balAfter = await getBalance(bot)
        bot.log.info(`${LOG} Balance after: ${formatMoney(balAfter)}`)
    } catch (err) {
        bot.log.warn(`${LOG} Could not read final balance: ${err.message}`)
    }

    const elapsedMs  = Date.now() - t0
    const elapsedSec = elapsedMs / 1000
    const elapsedMin = elapsedMs / 60000

    bot.log.info(`${LOG}`)
    bot.log.info(`${LOG} ════════ Delivery summary ════════`)
    bot.log.info(`${LOG} Item         : ${itemName}`)
    bot.log.info(`${LOG} Order price  : ${targetInfo.priceStr}/ea  player:${targetInfo.playerName}`)

    if (deliveryResult) {
        bot.log.info(`${LOG} Delivered    : ${deliveryResult.quantity}x`)
        bot.log.info(`${LOG} Earned       : ${deliveryResult.amountStr}  (${formatMoney(deliveryResult.amount)})`)
    }

    if (balBefore !== null && balAfter !== null) {
        const delta = balAfter - balBefore
        bot.log.info(`${LOG} Balance      : ${formatMoney(balBefore)} → ${formatMoney(balAfter)}  (${delta >= 0 ? '+' : ''}${formatMoney(delta)})`)
    }

    bot.log.info(`${LOG} Time         : ${elapsedSec.toFixed(1)}s`)

    if (deliveryResult && elapsedMin > 0) {
        const ratePerMin = deliveryResult.amount / elapsedMin
        bot.log.info(`${LOG} Rate         : ${formatMoney(ratePerMin)}/min  (full-cycle including /bal)`)
    }

    return {
        itemName,
        deposited,
        deliveryResult,
        balanceBefore: balBefore,
        balanceAfter:  balAfter,
        elapsedMs,
    }
}

module.exports = { deliverOneOrder, parseMoneyString, formatMoney }
