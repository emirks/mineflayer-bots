// ── shopTraverse — DonutSMP /shop GUI traversal ────────────────────────────────
//
// Navigates the full /shop tree and logs everything:
//
//   /shop (main shop window)
//     ↳ click category (e.g. end_stone → "ᴇɴᴅ" shop)
//       ↳ category window (title "SHOP - X", multiple real items)
//           each item has its price in its lore
//         ↳ click item → buy window ("BUYING itemname")
//             slot 13: item display
//             slot 15/16/17: Add 1 / Add 10 / Set to N  (lime glass — cycle to next item)
//             slot 21: Cancel  (red glass  → returns to category window)
//             slot 23: Confirm (lime glass → buys and returns to category window)
//           ↳ click cancel (slot 21) → returns to category window
//         ↳ after all items: click back button → returns to main shop
//     ↳ next category …
//
// Known server quirk: clicking a category sometimes opens the last buy window that
// was active in that category rather than the category listing window (server-side
// state persists between sessions).  The traversal detects this and clicks cancel
// to recover the real category window before processing items.
//
// Navigation glass panes (Add 1, Add 10, Set to N, Cancel, Confirm) are filtered
// out of the item list so they are never treated as purchasable items.
//
// Outputs per-run:
//   session.log                   — structured log lines for every window/slot
//   traverse_main_shop.json       — raw main shop dump
//   traverse_cat_<n>_<name>.json  — raw dump for each category window (n=1-based index)
//   traverse_buy_<item>.json      — raw dump for each buy window
//   shop_catalog.json             — clean catalog: category → items → prices

const fs   = require('fs')
const path = require('path')

const { waitForWindowOpen }                                                          = require('./spawnerWindow')
const { openChatCommandWindow, snapshotWindow, logWindowSnapshot, dumpWindowToFile } = require('./debugWindow')
const { getDisplayName, getLore, findSlotByKeyword, summariseSlot }                  = require('./nbtParse')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const LOG   = '[SHOP-TRAVERSE]'

// ── Window-type helpers ───────────────────────────────────────────────────────

// Returns true when a window is a buy window (BUYING X).
// Buy windows always have:
//   slot 21 — red_stained_glass_pane  (ᴄᴀɴᴄᴇʟ)
//   slot 23 — lime_stained_glass_pane (ᴄᴏɴꜰɪʀᴍ)
function isBuyWindow(win) {
    const slots = win?.slots || []
    const s21   = slots[21]
    const s23   = slots[23]
    return (
        s21 && s21.name === 'red_stained_glass_pane' &&
        s23 && s23.name === 'lime_stained_glass_pane'
    )
}

// Returns true for glass-pane navigation elements that must never be clicked
// as purchasable items.  These appear in both category windows and buy windows.
//
//   red_stained_glass_pane   → Cancel
//   lime_stained_glass_pane  → Add 1 / Add 10 / Set to N / Confirm
function isNavSlot(slot) {
    if (!slot || !slot.name) return true
    return slot.name === 'red_stained_glass_pane' ||
           slot.name === 'lime_stained_glass_pane'
}

// ── Internal navigation helpers ───────────────────────────────────────────────

// Returns all occupied container slots as { idx, slot } pairs,
// excluding navigation glass panes.
function itemEntries(win) {
    const slots = win.slots || []
    const end   = win.inventoryStart ?? Math.max(0, slots.length - 36)
    const result = []
    for (let i = 0; i < end; i++) {
        const s = slots[i]
        if (s && s.name && !isNavSlot(s)) result.push({ idx: i, slot: s })
    }
    return result
}

// Returns ALL occupied container slots (including nav), for logging only.
function allContainerEntries(win) {
    const slots = win.slots || []
    const end   = win.inventoryStart ?? Math.max(0, slots.length - 36)
    const result = []
    for (let i = 0; i < end; i++) {
        if (slots[i] && slots[i].name) result.push({ idx: i, slot: slots[i] })
    }
    return result
}

// Logs a one-line summary of each occupied container slot (including nav).
function logContainerSlots(bot, win, prefix) {
    const entries = allContainerEntries(win)
    bot.log.info(`${LOG} ${prefix}  (${entries.length} occupied container slots)`)
    for (const e of entries) {
        const name = getDisplayName(e.slot)
        const lore = getLore(e.slot)
        const nav  = isNavSlot(e.slot) ? ' [NAV]' : ''
        bot.log.info(`${LOG}   [${String(e.idx).padStart(2)}]${nav} ${e.slot.name.padEnd(32)}  "${name}"  ${lore.length ? '→ ' + lore.join(' | ') : ''}`)
    }
}

// Registers a windowOpen listener then clicks a slot in the current window.
async function clickAndWait(bot, slotIdx, timeoutMs) {
    const p = waitForWindowOpen(bot, timeoutMs)
    await bot.clickWindow(slotIdx, 0, 0)
    return p
}

function closeCurrentWindow(bot) {
    try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow) } catch {}
}

async function reopenMainShop(bot, shopCommand, winTimeoutMs) {
    closeCurrentWindow(bot)
    await sleep(500)
    try { return await openChatCommandWindow(bot, shopCommand, winTimeoutMs) } catch { return null }
}

// If we received a buy window instead of the category window, click cancel to
// recover the actual category listing window.  Retries once via /shop → category.
async function ensureCategoryWin(bot, win, catSlotIdx, shopCommand, winTimeoutMs, clickDelayMs) {
    if (!isBuyWindow(win)) return win   // already correct

    bot.log.info(`${LOG} │ Received buy window instead of category — clicking cancel to recover`)

    // Cancel slot is always slot 21 in a buy window
    try {
        const catWin = await clickAndWait(bot, 21, winTimeoutMs)
        await sleep(clickDelayMs)
        if (!isBuyWindow(catWin)) {
            bot.log.info(`${LOG} │ Recovered category window via cancel`)
            return catWin
        }
        // Still in a buy window — one more cancel
        bot.log.info(`${LOG} │ Still in buy window — cancelling again`)
        const catWin2 = await clickAndWait(bot, 21, winTimeoutMs)
        await sleep(clickDelayMs)
        if (!isBuyWindow(catWin2)) return catWin2
    } catch (err) {
        bot.log.warn(`${LOG} │ Cancel click failed: ${err.message}`)
    }

    // Full recovery: /shop → click category
    bot.log.info(`${LOG} │ Full recovery: reopening /shop → clicking category slot ${catSlotIdx}`)
    closeCurrentWindow(bot)
    const mainWin = await reopenMainShop(bot, shopCommand, winTimeoutMs)
    if (!mainWin) return null
    await sleep(clickDelayMs)
    try {
        const recovered = await clickAndWait(bot, catSlotIdx, winTimeoutMs)
        await sleep(clickDelayMs)
        return isBuyWindow(recovered) ? null : recovered
    } catch { return null }
}

async function recoverCategoryWin(bot, shopCommand, catSlotIdx, winTimeoutMs, clickDelayMs) {
    closeCurrentWindow(bot)
    const mainWin = await reopenMainShop(bot, shopCommand, winTimeoutMs)
    if (!mainWin) return null
    await sleep(clickDelayMs)
    try {
        const catWin = await clickAndWait(bot, catSlotIdx, winTimeoutMs)
        await sleep(clickDelayMs)
        return await ensureCategoryWin(bot, catWin, catSlotIdx, shopCommand, winTimeoutMs, clickDelayMs)
    } catch { return null }
}

function sanitise(str) {
    return str.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 30).replace(/^_|_$/g, '')
}

// ── Main traversal ────────────────────────────────────────────────────────────

async function traverseShop(bot, opts = {}) {
    const {
        shopCommand  = '/shop',
        winTimeoutMs = 8000,
        clickDelayMs = 600,
        // All buy windows share the same slot layout — only the title and slot-13
        // item change.  Probe at most this many buy windows across the whole run to
        // capture the layout once, then skip for all remaining items.
        maxBuyProbes = 1,
    } = opts

    const runDir  = bot.log?.runDir
    const catalog = { timestamp: new Date().toISOString(), categories: [] }
    let   buyProbesCount = 0   // global counter across all categories

    bot.log.info(`${LOG} ════════ Shop traversal start ════════`)
    bot.log.info(`${LOG} shopCommand:${shopCommand}  winTimeout:${winTimeoutMs}ms  clickDelay:${clickDelayMs}ms  maxBuyProbes:${maxBuyProbes}`)

    // ── 1. Open main shop ─────────────────────────────────────────────────────
    let mainWin
    try {
        mainWin = await openChatCommandWindow(bot, shopCommand, winTimeoutMs)
    } catch (err) {
        bot.log.warn(`${LOG} Failed to open ${shopCommand}: ${err.message}`)
        return catalog
    }

    bot.log.info(`${LOG} ── MAIN SHOP  title:"${mainWin.title?.value ?? mainWin.title}"  type:${mainWin.type}`)
    logContainerSlots(bot, mainWin, 'Main shop categories:')
    logWindowSnapshot(bot, snapshotWindow(mainWin), 'MAIN SHOP')
    if (runDir) dumpWindowToFile(bot, mainWin, 'traverse_main_shop')

    // Capture category entries now (slot indices are stable across reconnects)
    const categoryEntries = allContainerEntries(mainWin)
    bot.log.info(`${LOG} Will visit ${categoryEntries.length} categories`)

    // ── 2. Visit each category ────────────────────────────────────────────────
    for (let ci = 0; ci < categoryEntries.length; ci++) {
        const catEntry = categoryEntries[ci]
        const catName  = getDisplayName(catEntry.slot)
        const catLore  = getLore(catEntry.slot)

        bot.log.info(`${LOG}`)
        bot.log.info(`${LOG} ┌─── Category ${ci + 1}/${categoryEntries.length}: "${catName}"  item:${catEntry.slot.name}  slot:${catEntry.idx}`)
        bot.log.info(`${LOG} │    lore: ${catLore.join(' | ')}`)

        const catRecord = { category: catName, slot: catEntry.idx, item: catEntry.slot.name, lore: catLore, items: [] }

        // Click category slot → expect category listing window
        let catWin
        try {
            const raw = await clickAndWait(bot, catEntry.idx, winTimeoutMs)
            await sleep(clickDelayMs)
            // If server restored a buy window from a previous session, recover category window
            catWin = await ensureCategoryWin(bot, raw, catEntry.idx, shopCommand, winTimeoutMs, clickDelayMs)
        } catch (err) {
            bot.log.warn(`${LOG} │ FAILED to open category "${catName}": ${err.message}`)
            catalog.categories.push(catRecord)
            mainWin = await reopenMainShop(bot, shopCommand, winTimeoutMs)
            continue
        }

        if (!catWin) {
            bot.log.warn(`${LOG} │ Could not recover category window for "${catName}" — skipping`)
            catalog.categories.push(catRecord)
            mainWin = await reopenMainShop(bot, shopCommand, winTimeoutMs)
            continue
        }

        const catTitle = catWin.title?.value ?? catWin.title ?? '?'
        bot.log.info(`${LOG} │ Category window: "${catTitle}"  type:${catWin.type}`)
        logContainerSlots(bot, catWin, `Category "${catName}" slots:`)
        logWindowSnapshot(bot, snapshotWindow(catWin), `CATEGORY: ${catName}`)
        if (runDir) dumpWindowToFile(bot, catWin, `traverse_cat_${ci + 1}_${sanitise(catName) || 'cat'}`)

        // Identify back button (in the real category window)
        const backSlotIdx = findSlotByKeyword(catWin, 'back')
        if (backSlotIdx >= 0) {
            bot.log.info(`${LOG} │ Back button: slot[${backSlotIdx}]  "${getDisplayName(catWin.slots[backSlotIdx])}"`)
        } else {
            bot.log.warn(`${LOG} │ No back button found (will reopen /shop after category)`)
        }

        // Real items only — glass panes filtered out
        let items = itemEntries(catWin)
        if (backSlotIdx >= 0) items = items.filter(e => e.idx !== backSlotIdx)
        bot.log.info(`${LOG} │ Real items: ${items.length}`)

        // ── 3. Click each item → buy window → cancel ──────────────────────────
        for (let ii = 0; ii < items.length; ii++) {
            const itemEntry = items[ii]
            const itemName  = getDisplayName(itemEntry.slot)
            const itemLore  = getLore(itemEntry.slot)

            bot.log.info(`${LOG} │  ┌─ Item ${ii + 1}/${items.length}: slot[${itemEntry.idx}]  "${itemName}"  (${itemEntry.slot.name})`)
            if (itemLore.length) bot.log.info(`${LOG} │  │  lore: ${itemLore.join(' | ')}`)

            const itemRecord = { ...summariseSlot(itemEntry.idx, itemEntry.slot), buyWindow: null }

            // All buy windows share the same fixed layout — probe at most maxBuyProbes
            // times across the whole run to capture slot positions, then skip the rest.
            if (buyProbesCount >= maxBuyProbes) {
                bot.log.info(`${LOG} │  │  (buy window already captured — skipping probe)`)
                catRecord.items.push(itemRecord)
                continue
            }

            // Click item → buy window
            let buyWin
            try {
                buyWin = await clickAndWait(bot, itemEntry.idx, winTimeoutMs)
                await sleep(clickDelayMs)
            } catch (err) {
                bot.log.warn(`${LOG} │  │  Buy window failed for "${itemName}": ${err.message}`)
                catRecord.items.push(itemRecord)
                catWin = await recoverCategoryWin(bot, shopCommand, catEntry.idx, winTimeoutMs, clickDelayMs)
                if (!catWin) { bot.log.warn(`${LOG} │  Recovery failed — skipping rest of category`); break }
                continue
            }

            buyProbesCount++
            const buyTitle = buyWin.title?.value ?? buyWin.title ?? '?'
            bot.log.info(`${LOG} │  │  Buy window [probe ${buyProbesCount}/${maxBuyProbes}]: "${buyTitle}"`)

            // Log every slot in the buy window with its display name and full lore.
            // This is the permanent layout reference — all buy windows share these slots:
            //   slot 13 → the item being bought (changes per item)
            //   slot 15 → Add 1   (lime glass)
            //   slot 16 → Add 10  (lime glass)
            //   slot 17 → Set to N (lime glass)
            //   slot 21 → Cancel  (red glass)
            //   slot 23 → Confirm (lime glass)
            const buySlots = buyWin.slots || []
            const buyEnd   = buyWin.inventoryStart ?? Math.max(0, buySlots.length - 36)
            bot.log.info(`${LOG} │  │  Buy window slot map (${buyEnd} container slots):`)
            for (let si = 0; si < buyEnd; si++) {
                const s = buySlots[si]
                if (!s || !s.name) continue
                const dname = getDisplayName(s)
                const lore  = getLore(s)
                bot.log.info(`${LOG} │  │    slot[${String(si).padStart(2)}]  ${s.name.padEnd(28)}  "${dname}"`)
                for (const line of lore) bot.log.info(`${LOG} │  │      lore: ${line}`)
            }

            const buySnap = snapshotWindow(buyWin)
            logWindowSnapshot(bot, buySnap, `BUY: ${itemName}`)
            if (runDir) dumpWindowToFile(bot, buyWin, `traverse_buy_layout`)
            itemRecord.buyWindow = buySnap

            // Click cancel (always slot 21 in buy windows)
            const cancelIdx = findSlotByKeyword(buyWin, 'cancel')
            bot.log.info(`${LOG} │  │  Cancel slot: ${cancelIdx >= 0 ? cancelIdx : '(not found — using slot 21)'}`)
            const effectiveCancelIdx = cancelIdx >= 0 ? cancelIdx : 21

            try {
                catWin = await clickAndWait(bot, effectiveCancelIdx, winTimeoutMs)
                await sleep(clickDelayMs)
                // If cancel somehow returned another buy window, recover
                if (isBuyWindow(catWin)) {
                    bot.log.warn(`${LOG} │  └─ Cancel returned another buy window — recovering`)
                    catWin = await clickAndWait(bot, 21, winTimeoutMs)
                    await sleep(clickDelayMs)
                }
                bot.log.info(`${LOG} │  └─ Cancelled → back in category window`)
            } catch (err) {
                bot.log.warn(`${LOG} │  └─ Cancel click failed: ${err.message} — recovering`)
                catWin = await recoverCategoryWin(bot, shopCommand, catEntry.idx, winTimeoutMs, clickDelayMs)
                if (!catWin) { catRecord.items.push(itemRecord); break }
            }

            catRecord.items.push(itemRecord)
        }

        // ── 4. Click back → main shop ─────────────────────────────────────────
        const currentCatWin  = bot.currentWindow
        const currentBackIdx = currentCatWin
            ? findSlotByKeyword(currentCatWin, 'back')
            : backSlotIdx

        if (currentBackIdx >= 0 && currentCatWin) {
            try {
                mainWin = await clickAndWait(bot, currentBackIdx, winTimeoutMs)
                await sleep(clickDelayMs)
                bot.log.info(`${LOG} └─── Returned to main shop from "${catName}"`)
            } catch (err) {
                bot.log.warn(`${LOG} └─── Back button failed: ${err.message} — reopening /shop`)
                mainWin = await reopenMainShop(bot, shopCommand, winTimeoutMs)
            }
        } else {
            bot.log.warn(`${LOG} └─── No back button for "${catName}" — reopening /shop`)
            mainWin = await reopenMainShop(bot, shopCommand, winTimeoutMs)
        }

        catalog.categories.push(catRecord)
    }

    closeCurrentWindow(bot)

    // ── 5. Write catalog ──────────────────────────────────────────────────────
    if (runDir) {
        const filepath = path.join(runDir, 'shop_catalog.json')
        try {
            fs.writeFileSync(filepath, JSON.stringify(catalog, null, 2), 'utf8')
            bot.log.info(`${LOG} Catalog → ${filepath}`)
        } catch (err) {
            bot.log.warn(`${LOG} Catalog write failed: ${err.message}`)
        }
    }

    // ── 6. Summary ────────────────────────────────────────────────────────────
    bot.log.info(`${LOG}`)
    bot.log.info(`${LOG} ════════ Traversal complete ════════`)
    bot.log.info(`${LOG} ${catalog.categories.length} categories:`)
    for (const cat of catalog.categories) {
        bot.log.info(`${LOG}   "${cat.category}"  (${cat.items.length} items)`)
        for (const item of cat.items) {
            const price = item.lore.find(l => l.includes('$')) ?? item.lore[0] ?? ''
            bot.log.info(`${LOG}     [${item.slot}] "${item.displayName}"  ${price}`)
        }
    }

    return catalog
}

module.exports = { traverseShop }
