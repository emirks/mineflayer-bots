// ── auctionSell — list 1x-stack items on DonutSMP /ah at lowest price − N ─────
//
// Starting state: inventory already contains 1×<itemName> stacks (and possibly
// one or more larger remainder stacks) — produced by collectMyOrder + flattenInventoryStack.
// If any >1 stacks are present they are flattened into 1× items on demand as space opens up.
//
// Full flow per batch:
//
//   ① if no 1× stacks exist → flattenBigStacks()
//     find all >1 stacks of itemName, sort by count descending
//     while empty inventory slots exist AND >1 stacks exist:
//       flattenInventoryStack() on the biggest (pick-up, right-click empty slots, put back)
//       bot.closeWindow(bot.inventory) + settle   ← "inventory closed" signal to Paper
//     repeat outer loop from ①
//
//   ② getAuctionLowestPrice() — ALWAYS before any inventory manipulation
//     /ah <searchTerm>           → AUCTION (Page 1) window
//     findSortSlot()             → locate the sort/filter button
//     ensureLowestPriceSort()    → cycle sort until "Lowest Price" is active
//     read first non-nav listing slot price from lore
//     close window + return price
//
//   ③ computeTargetPrice()
//     lowestPrice === lastTargetPrice → keep (we ARE the lowest; don't undercut ourselves)
//     otherwise                       → lowestPrice − decrementAmount
//
//   ④ fillHotbarWith1x()
//     scan main-inventory slots 9–35 for 1× stacks
//     mode=2 (number-key swap) click per item: ONE packet each, not pick-up+place
//     after moves: bot.closeWindow(bot.inventory) + settle
//     ← mode=2 is the same as pressing 1–9 in the inventory: less suspicious
//     ← close_window(0) signals "inventory closed" to Paper before /ah sell
//
//   ⑤ for each hotbar slot 36–44 with 1× itemName:
//     bot.setQuickBarSlot(slot − 36)              — held_item_change only, no window_click
//     waitForWindowOpen() + bot.chat('/ah sell')  — open CONFIRM LISTING
//     find lime_stained_glass_pane → left-click   — confirm listing
//     verify hand empty after confirm
//
//   repeat from ① until no itemName remains in inventory at all
//
// WHY price check comes before fill:
//   bot.clickWindow for window-0 (inventory) does NOT wait for server confirmation
//   (mineflayer's waitForWindowUpdate returns immediately for all non-crafting/merchant
//   window types — this is mineflayer behaviour, unchanged across all MC versions).
//   DonutSMP Paper treats burst window-0 clicks as "inventory open" and blocks
//   /ah <browse> until the player sends close_window(0).  Since the price check
//   sends /ah BEFORE any window-0 clicks happen, it always succeeds.
//
// Exports:
//   auctionSellAll(bot, opts)   — full sell loop
//
// Options:
//   itemName           {string}   'redstone'        Minecraft item ID
//   searchTerm         {string}   'redstone dust'   /ah search argument
//   decrementAmount    {number}   10                $ to undercut lowest by
//   minPriceFloor      {number}   0                 stop listing if price would go below this (0 = disabled)
//   winTimeoutMs       {number}   8000              ms per GUI window open
//   clickDelayMs       {number}   600               settle delay after GUI clicks
//   fillDelayMs        {number}   200               delay between inventory swap clicks
//   settleAfterFillMs  {number}   1500              settle after filling hotbar (close_window sent too)
//   sellIntervalMs     {number}   800               delay between successive /ah sell commands
//   saleWaitTimeoutMs  {number}   300_000           max ms to wait for a sale when auction limit is hit
//   debug              {boolean}  false             when true: log all window slots + dump JSON files
//   persistedState     {object}   null              when provided by a calling loop, totalEarned /
//                                                   buyCount / lastTargetPrice / startTime are read
//                                                   from and written back to this object so stats
//                                                   accumulate across repeated calls instead of
//                                                   resetting to zero each time

const { waitForWindowOpen } = require('./spawnerWindow')
const { openChatCommandWindow, snapshotWindow, logWindowSnapshot, dumpWindowToFile } = require('./debugWindow')
const { resolveComponent, getDisplayName, getLore, normalizeText, parseMoneyString, formatMoney } = require('./nbtParse')
const { flattenInventoryStack } = require('./collectMyOrder')
const EventBus = require('../EventBus')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const LOG = '[AUCTION-SELL]'

// ── Money helpers ─────────────────────────────────────────────────────────────
// parseMoneyString and formatMoney are imported from nbtParse.js (single source).
// Re-exported below for callers that previously imported them from this file.

// ── Price extraction from an AH listing slot ──────────────────────────────────
// DonutSMP auction lore typically contains lines like "$12.50 each" or a bare
// "$43.00" price.  We take the first match from lore, falling back to display name.
function parsePriceFromSlot(slot) {
    const lore = getLore(slot)
    for (const line of lore) {
        const m = line.match(/\$([\d,.]+[KkMm]?)/)
        if (m) return parseMoneyString(m[1])
    }
    const name = getDisplayName(slot)
    const m = name.match(/\$([\d,.]+[KkMm]?)/)
    if (m) return parseMoneyString(m[1])
    return null
}

// ── Nav slot detection ────────────────────────────────────────────────────────
// Materials that are always GUI decoration / navigation, never AH listings.
//
// Do NOT list sellable item ids here (e.g. hopper). DonutSMP uses a hopper icon
// for the "Filter" row — those are detected in isNavSlot() via the word "filter"
// in display name / lore (unicode-normalised), same as the ꜰɪʟᴛᴇʀ small-caps label.
const NAV_MATERIALS = new Set([
    'red_stained_glass_pane', 'lime_stained_glass_pane',
    'gray_stained_glass_pane', 'black_stained_glass_pane',
    'white_stained_glass_pane', 'green_stained_glass_pane',
    'arrow', 'barrier', 'oak_sign', 'birch_sign',
    'oak_button', 'stone_button', 'clock', 'cauldron', 'anvil',
])

function isNavSlot(slot) {
    if (!slot || !slot.name) return true
    if (NAV_MATERIALS.has(slot.name)) return true
    const text = normalizeText(getDisplayName(slot) + ' ' + getLore(slot).join(' '))
    // Filter row reuses the hopper item as its icon — skip only that UI slot.
    if (slot.name === 'hopper' && text.includes('filter')) return true
    return text.includes('next page') || text.includes('previous page') || text.includes('click to sort')
}

// ── Sort slot helpers — adapted from orderTraverse.js §findSortSlot ───────────

// Scans container slots for the filter/sort button.
// DonutSMP AH sort buttons mention "sort", "lowest price", "highest price",
// "most recent" or similar in their display name or lore.
function findSortSlot(win) {
    const slots = win.slots || []
    const end = win.inventoryStart ?? Math.max(0, slots.length - 36)
    for (let i = 0; i < end; i++) {
        const s = slots[i]
        if (!s) continue
        const text = normalizeText(getDisplayName(s) + ' ' + getLore(s).join(' '))
        if (
            text.includes('sort') ||
            text.includes('lowest price') ||
            text.includes('highest price') ||
            text.includes('most paid') ||
            text.includes('recently listed') ||
            text.includes('newest') ||
            text.includes('most recent')
        ) return i
    }
    return -1
}

// Reads the currently-highlighted option from the sort slot's raw NBT lore.
// The active option has a non-white highlight colour (e.g. #00fc88 teal on DonutSMP).
// Inactive options are plain white.  Returns the option text or null.
function getActiveSortMode(sortSlot) {
    // 1.20.5+ (1.21.x): lore in data components via slot.customLore; pre-1.20.5: old NBT
    const loreList = sortSlot?.customLore ?? sortSlot?.nbt?.value?.display?.value?.Lore?.value?.value
    if (!Array.isArray(loreList)) return null

    for (const rawLine of loreList) {
        try {
            const comp = resolveComponent(rawLine)
            if (!comp) continue

            // Flat format (DonutSMP AH): color on root → {"color":"#00fc88","text":"• Lowest Price"}
            if (comp.color && comp.color !== 'white' && comp.color !== 'gray' && comp.color !== 'dark_gray') {
                return (comp.text ?? '').replace(/^[•\s]+/, '').trim()
            }

            // Nested format (DonutSMP orders): color on extra child → {"text":"","extra":[{"color":"...","text":"..."}]}
            for (const e of (comp.extra ?? [])) {
                const c = e.color ?? ''
                if (c && c !== 'white' && c !== 'gray' && c !== 'dark_gray') {
                    return (e.text ?? '').replace(/^[•\s]+/, '').trim()
                }
            }
        } catch { }
    }
    return null
}

// Clicks the sort button until the active mode text (normalised) is 'lowest price'.
// Re-reads bot.currentWindow.slots each attempt so slot-update packets are seen.
// Returns true on success, false if CYCLE_MAX attempts are exhausted.
async function ensureLowestPriceSort(bot, sortIdx, clickDelayMs = 700) {
    const CYCLE_MAX = 6  // 4–5 options + 1 safety margin

    for (let attempt = 0; attempt < CYCLE_MAX; attempt++) {
        const win = bot.currentWindow
        const slot = win?.slots?.[sortIdx]
        if (!win || !slot) {
            bot.log.warn(`${LOG} Sort slot ${sortIdx} gone during cycling — aborting`)
            return false
        }

        const current = getActiveSortMode(slot)
        bot.log.info(`${LOG} Sort cycle ${attempt}: active="${current ?? 'unknown'}"`)

        if (normalizeText(current ?? '') === 'lowest price') {
            bot.log.info(`${LOG} Sort ✓ "Lowest Price" confirmed active`)
            return true
        }

        bot.log.info(`${LOG} Clicking sort [slot ${sortIdx}] to advance cycle…`)
        await bot.clickWindow(sortIdx, 0, 0)
        await sleep(clickDelayMs)
    }

    const finalSlot = bot.currentWindow?.slots?.[sortIdx]
    const finalMode = finalSlot ? getActiveSortMode(finalSlot) : null
    bot.log.warn(`${LOG} Could not activate "Lowest Price" after ${CYCLE_MAX} attempts (final: "${finalMode ?? 'unknown'}")`)
    return false
}

// ── Phase A: Open /ah, ensure "Lowest Price" sort, return lowest price ─────────
//
// Called BEFORE any window-0 (inventory) interaction each batch so DonutSMP's
// AH plugin sees a clean window state when processing the /ah browse command.

async function getAuctionLowestPrice(bot, searchTerm, opts = {}) {
    const { winTimeoutMs = 8000, clickDelayMs = 700, debug = false } = opts
    const cmd = `/ah ${searchTerm}`

    bot.log.info(`${LOG} Opening auction window: "${cmd}"`)

    let win
    try {
        win = await openChatCommandWindow(bot, cmd, winTimeoutMs)
    } catch (err) {
        bot.log.warn(`${LOG} Failed to open auction window: ${err.message}`)
        return null
    }

    if (debug) {
        const snap = snapshotWindow(win)
        logWindowSnapshot(bot, snap, `AUCTION ─ ${searchTerm}`)
        dumpWindowToFile(bot, win, `auction_${searchTerm.replace(/\s+/g, '_')}`)
    }

    // ── Ensure "Lowest Price" sort ────────────────────────────────────────────
    const sortIdx = findSortSlot(win)
    if (sortIdx >= 0) {
        bot.log.info(`${LOG} Sort button at slot[${sortIdx}]`)
        await ensureLowestPriceSort(bot, sortIdx, clickDelayMs)
        // Let the sort packet settle before reading the re-ordered slots
        await sleep(clickDelayMs)
    } else {
        bot.log.warn(`${LOG} Sort button not found — reading price without sorting`)
    }

    // ── Read lowest listing price ─────────────────────────────────────────────
    // After sort the window slots may have been updated in-place.
    const currentWin = bot.currentWindow ?? win
    const slots = currentWin.slots || []
    const end = currentWin.inventoryStart ?? Math.max(0, slots.length - 36)

    let lowestPrice = null
    for (let i = 0; i < end; i++) {
        const s = slots[i]
        if (!s || !s.name) continue
        if (isNavSlot(s)) continue

        const price = parsePriceFromSlot(s)
        if (price !== null && price > 0) {
            lowestPrice = price
            bot.log.info(
                `${LOG} Lowest listed price: ${formatMoney(price)}` +
                `  slot[${i}]  ${s.name}  "${getDisplayName(s)}"`
            )
            if (debug) {
                for (const l of getLore(s)) bot.log.info(`${LOG}   lore: ${l}`)
            }
            break
        }
    }

    if (lowestPrice === null) {
        bot.log.warn(`${LOG} No price found in any listing slot — auction may be empty`)
    }

    // Close the auction window
    try { bot.closeWindow(currentWin) } catch { }
    await sleep(500)

    return lowestPrice
}

// ── Phase B: Fill hotbar with 1× stacks of itemName ───────────────────────────
//
// Uses window_click mode=2 (number-key swap) to move each main-inventory 1×
// stack to an empty hotbar slot.  Mode=2 sends ONE packet per move (vs the
// pick-up + place approach which sends TWO with the same stateId, causing Paper
// to reject the second click due to stale stateId).
//
// After all moves, sends a raw close_window(windowId=0) packet.  This is the
// signal a real Minecraft client sends when the player presses Escape to close
// the inventory, and DonutSMP Paper requires it before accepting /ah sell.
//
// MUST be called AFTER getAuctionLowestPrice (which itself must be called before
// any window-0 interaction to avoid Paper's /ah browse block).
async function fillHotbarWith1x(bot, itemName, clickDelayMs = 200, settleAfterFillMs = 1500) {
    const allItems = bot.inventory.items()
    const hotbarOccupied = new Set(
        allItems.filter(i => i.slot >= 36 && i.slot <= 44).map(i => i.slot)
    )
    const mainStacks = allItems.filter(i => i.name === itemName && i.count === 1 && i.slot >= 9 && i.slot <= 35)
    const hotbarAlready = allItems.filter(i => i.name === itemName && i.count === 1 && i.slot >= 36 && i.slot <= 44)

    bot.log.info(
        `${LOG} [FILL-HOTBAR] ${itemName}:` +
        ` ${hotbarAlready.length} already in hotbar` +
        ` | ${mainStacks.length} in main-inventory to move` +
        ` | ${hotbarOccupied.size}/9 hotbar slots occupied`
    )

    let moved = 0
    for (const stack of mainStacks) {
        // Find the first empty hotbar slot
        let target = -1
        for (let s = 36; s <= 44; s++) {
            if (!hotbarOccupied.has(s)) { target = s; break }
        }
        if (target < 0) {
            bot.log.info(`${LOG} [FILL-HOTBAR] Hotbar full — stopping`)
            break
        }

        const hotbarIdx = target - 36   // 0–8  (the number key that would swap these)
        bot.log.info(`${LOG} [FILL-HOTBAR] swap slot ${stack.slot} ↔ hotbar ${hotbarIdx} (→ window slot ${target})`)

        // mode=2 with mouseButton=hotbarIdx swaps mainSlot with hotbar[hotbarIdx].
        // ONE packet instead of pick-up(windowId=0) + place(windowId=0).
        // Equivalent to hovering over a main-inventory slot and pressing key 1–9.
        await bot.clickWindow(stack.slot, hotbarIdx, 2)
        await sleep(clickDelayMs)

        hotbarOccupied.add(target)
        moved++
    }

    const finalHotbar = bot.inventory.items().filter(i => i.name === itemName && i.count === 1 && i.slot >= 36 && i.slot <= 44)
    bot.log.info(`${LOG} [FILL-HOTBAR] Moved ${moved} — hotbar now has ${finalHotbar.length} 1×${itemName}`)

    // Signal "inventory closed" to Paper before /ah sell commands.
    // A real client sends close_window(0) when the player presses Escape.
    // Without it, Paper may block subsequent /ah browse or /ah sell commands.
    if (moved > 0) {
        bot.closeWindow(bot.inventory)
        await sleep(settleAfterFillMs)
    }

    return moved
}

// ── Phase C: Confirm a single /ah sell listing ────────────────────────────────
//
// Called with the already-opened CONFIRM LISTING window.
// Finds lime_stained_glass_pane (confirm button) and left-clicks it once.
// Returns true if successfully clicked, false on error.
async function clickConfirmInListingWindow(bot, confirmWin, clickDelayMs = 500, debug = false) {
    if (debug) {
        const snap = snapshotWindow(confirmWin)
        logWindowSnapshot(bot, snap, 'CONFIRM LISTING')
        dumpWindowToFile(bot, confirmWin, 'confirm_listing')
    }

    // Prefer lime glass with 'confirm' or 'sell' in text; fall back to any lime glass
    let limeSlot = -1
    for (let i = 0; i < confirmWin.slots.length; i++) {
        const s = confirmWin.slots[i]
        if (!s || s.name !== 'lime_stained_glass_pane') continue
        const text = normalizeText(getDisplayName(s) + ' ' + getLore(s).join(' '))
        if (text.includes('confirm') || text.includes('sell')) { limeSlot = i; break }
    }
    // Fallback
    if (limeSlot < 0) {
        for (let i = 0; i < confirmWin.slots.length; i++) {
            const s = confirmWin.slots[i]
            if (s && s.name === 'lime_stained_glass_pane') { limeSlot = i; break }
        }
    }

    if (limeSlot < 0) {
        bot.log.warn(`${LOG} Confirm button (lime_stained_glass_pane) not found in CONFIRM LISTING`)
        try { bot.closeWindow(confirmWin) } catch { }
        return false
    }

    bot.log.info(`${LOG} Clicking confirm at slot[${limeSlot}]  "${getDisplayName(confirmWin.slots[limeSlot])}"`)
    await bot.clickWindow(limeSlot, 0, 0)
    await sleep(clickDelayMs)

    if (bot.currentWindow) {
        try { bot.closeWindow(bot.currentWindow) } catch { }
        await sleep(300)
    }

    return true
}

// ── Phase D: Flatten large stacks to create more 1× items ────────────────────
//
// Called when the inventory has no 1× stacks left but still holds stacks > 1.
// Repeatedly flattens the BIGGEST remaining stack (using flattenInventoryStack
// from collectMyOrder.js) until either no empty inventory slots remain or all
// stacks are gone.  After each flatten, signals "inventory closed" to Paper.
//
// Returns true if at least one flatten was performed (new 1× items now exist),
// false if there was nothing to flatten.
async function flattenBigStacks(bot, itemName, fillDelayMs, settleAfterFillMs) {
    let didFlatten = false

    while (true) {
        if (bot._quitting) break

        const allItems = bot.inventory.items()
        const bigStacks = allItems
            .filter(i => i.name === itemName && i.count > 1)
            .sort((a, b) => b.count - a.count)

        if (bigStacks.length === 0) break

        // Count empty main+hotbar slots (9–44)
        const occupied = new Set(allItems.map(i => i.slot))
        let emptyCount = 0
        for (let s = 9; s <= 44; s++) {
            if (!occupied.has(s)) emptyCount++
        }
        if (emptyCount === 0) break   // inventory full — nothing to spread into

        const biggest = bigStacks[0]
        bot.log.info(
            `${LOG} [REFILL] Flattening ${biggest.count}× ${itemName}` +
            ` @ slot ${biggest.slot} into ${emptyCount} empty slot${emptyCount !== 1 ? 's' : ''}`
        )

        await flattenInventoryStack(bot, itemName, {
            clickDelayMs: fillDelayMs,
            stackSlot: biggest.slot,
        })

        // Signal "inventory closed" to Paper before any /ah command
        bot.closeWindow(bot.inventory)
        await sleep(settleAfterFillMs)

        didFlatten = true
    }

    return didFlatten
}

// ── Chat watchers — auction limit + sale notifications ────────────────────────
//
// Listens to chat for two classes of message emitted by DonutSMP:
//
//   Limit:  "You have too many listed items."
//     → sets state.limitHit = true, emits '_ahLimit' on bot
//
//   Sale:   "You earned $X from auction …"
//           "PlayerName bought your Redstone Dust for $X"
//     → accumulates state.totalEarned, logs profit/min,
//       emits '_ahSale' on bot (clears limitHit flag)
//
// Returns a cleanup function that removes the listener.
function setupAuctionChatWatchers(bot, state, startTime) {
    function onMessage(msg) {
        const text = msg.toString()

        // ── Auction limit ─────────────────────────────────────────────────────
        if (/you have too many listed items/i.test(text)) {
            if (!state.limitHit) {
                bot.log.warn(`${LOG} ⚠ Auction limit reached — pausing until next sale`)
                state.limitHit = true
                bot.emit('_ahLimit')
            }
            return
        }

        // ── Sale notifications ────────────────────────────────────────────────
        // "You earned $11.67K from auction …"
        const earnM = text.match(/You earned \$([\d,.]+[KkMm]?) from auction/i)
        // "PlayerName bought your Redstone Dust for $3.88K"
        const buyM = text.match(/\w.* bought your .+ for \$([\d,.]+[KkMm]?)/i)
        const saleM = earnM || buyM
        if (!saleM) return

        const earned = parseMoneyString(saleM[1])
        state.totalEarned += earned
        state.buyCount += 1
        state.limitHit = false   // a slot just freed up

        const elapsedMin = (Date.now() - startTime) / 60_000
        const profitPerMin = elapsedMin > 0 ? state.totalEarned / elapsedMin : 0
        bot.log.info(
            `${LOG} 💰 ${text.trim()}` +
            `  →  total: ${formatMoney(state.totalEarned)}` +
            `  ${formatMoney(profitPerMin)}/min` +
            `  (${state.buyCount} sale${state.buyCount !== 1 ? 's' : ''}` +
            ` in ${elapsedMin.toFixed(1)} min)`
        )

        bot.emit('_ahSale', earned)

        // Forward to process-wide EventBus so the dashboard can persist + display.
        const buyerMatch = buyM ? text.match(/^(\S+)\s+bought your/) : null
        EventBus.emit('bot:sale', {
            profile: bot._profileName,
            ts     : Date.now(),
            amount : earned,
            buyer  : buyerMatch ? buyerMatch[1] : null,
            item   : state.itemName ?? null,
        })
    }

    bot.on('message', onMessage)
    return () => bot.removeListener('message', onMessage)
}

// Resolves with the earned amount the next time a sale chat fires ('_ahSale').
// Rejects after timeoutMs if no sale arrives.
function waitForNextSale(bot, timeoutMs = 300_000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            bot.removeListener('_ahSale', h)
            reject(new Error(`No sale arrived within ${Math.round(timeoutMs / 1000)}s`))
        }, timeoutMs)
        function h(earned) {
            clearTimeout(timer)
            resolve(earned)
        }
        bot.once('_ahSale', h)
    })
}

// Sends "/ah sell <price>" and races between:
//   • windowOpen  → { type: 'window', win }
//   • '_ahLimit'  → { type: 'limit'  }          (server refused, too many listings)
//   • timeout     → { type: 'timeout' }
// The window-open listener and the limit listener are always cleaned up before returning.
function sendSellAndWait(bot, priceStr, winTimeoutMs) {
    return new Promise(resolve => {
        let settled = false

        function finish(result) {
            if (settled) return
            settled = true
            clearTimeout(timer)
            bot.removeListener('windowOpen', onOpen)
            bot.removeListener('_ahLimit', onLimit)
            resolve(result)
        }

        const onOpen = win => finish({ type: 'window', win })
        const onLimit = () => finish({ type: 'limit' })
        const timer = setTimeout(() => finish({ type: 'timeout' }), winTimeoutMs)

        bot.once('windowOpen', onOpen)
        bot.once('_ahLimit', onLimit)

        bot.chat(`/ah sell ${priceStr}`)
    })
}

// ── Main: sell all 1× item stacks from inventory via /ah ──────────────────────

async function auctionSellAll(bot, opts = {}) {
    const {
        itemName          = 'redstone',
        searchTerm        = 'redstone dust',
        decrementAmount   = 10,
        minPriceFloor     = 0,
        winTimeoutMs      = 8000,
        clickDelayMs      = 600,
        fillDelayMs       = 200,
        settleAfterFillMs = 1500,
        sellIntervalMs    = 800,
        saleWaitTimeoutMs = 300_000,
        debug             = false,
        persistedState    = null,   // caller-owned object; stats accumulate across calls
    } = opts

    // If the caller supplied a persistedState, seed from it so totals carry over
    // across multiple auctionSellAll invocations (e.g. from auctionOrderLoop).
    const startTime = persistedState?.startTime ?? Date.now()

    const state = {
        limitHit:    false,
        totalEarned: persistedState?.totalEarned ?? 0,
        buyCount:    persistedState?.buyCount    ?? 0,
        itemName,   // forwarded to EventBus emit in setupAuctionChatWatchers
    }
    const stopWatcher = setupAuctionChatWatchers(bot, state, startTime)

    // lastTargetPrice persists so the anti self-undercut check works across
    // sell phases: if our listing from the previous cycle is still the cheapest
    // at the start of the next cycle, we don't drive the price down again.
    let lastTargetPrice = persistedState?.lastTargetPrice ?? null
    // exitReason documents WHY the sell loop stopped — used by auctionOrderLoop
    // to decide whether to wait, retry, or move on to collect.
    //   'done'         → inventory is empty; normal completion
    //   'priceFloor'   → market below minPriceFloor; wait before retrying
    //   'noPrice'      → AH window failed after 3 attempts; wait before retrying
    //   'limitTimeout' → no sale arrived within saleWaitTimeoutMs; wait + retry
    let exitReason  = 'done'
    let totalSold   = 0
    let batchNum    = 0

    bot.log.info(`${LOG} ═══ auctionSellAll start  item:"${itemName}"  search:"${searchTerm}"  decrement:${decrementAmount} ═══`)

    while (true) {
        if (bot._quitting) break

        // ── 0. Ensure 1× stacks exist; flatten larger stacks if not ──────────
        let available = bot.inventory.items().filter(i => i.name === itemName && i.count === 1)

        if (available.length === 0) {
            const hasStacked = bot.inventory.items().some(i => i.name === itemName && i.count > 1)
            if (!hasStacked) {
                bot.log.info(`${LOG} No ${itemName} remaining in inventory — done`)
                break
            }
            bot.log.info(`${LOG} No 1× stacks left — refilling from larger stacks…`)
            const filled = await flattenBigStacks(bot, itemName, fillDelayMs, settleAfterFillMs)
            if (!filled) break

            available = bot.inventory.items().filter(i => i.name === itemName && i.count === 1)
            if (available.length === 0) {
                bot.log.warn(`${LOG} Flatten produced no 1× items — inventory may be completely full`)
                break
            }
        }

        batchNum++
        bot.log.info(`${LOG} ─── Batch ${batchNum} (${available.length} 1× items available) ────────────────────`)

        // ── A. Get lowest auction price FIRST ─────────────────────────────────
        // Must happen before fillHotbarWith1x because window-0 clicks (inventory
        // manipulation) cause Paper to block /ah browse commands until close_window(0)
        // is received.  The price check itself sends no window-0 clicks.
        // Retried up to 3× (5s apart) to handle transient AH lag or empty pages.
        let lowestPrice = null
        for (let priceAttempt = 1; priceAttempt <= 3; priceAttempt++) {
            lowestPrice = await getAuctionLowestPrice(bot, searchTerm, { winTimeoutMs, clickDelayMs, debug })
            if (lowestPrice !== null) break
            if (priceAttempt < 3) {
                bot.log.warn(`${LOG} AH price unavailable (attempt ${priceAttempt}/3) — retrying in 5s`)
                if (bot._quitting) break
                await sleep(5000)
            }
        }

        if (lowestPrice === null) {
            bot.log.warn(`${LOG} AH price unavailable after 3 attempts — pausing sell phase`)
            exitReason = 'noPrice'
            break
        }

        // ── B. Compute target price ───────────────────────────────────────────
        let targetPrice
        if (lastTargetPrice !== null && lowestPrice === lastTargetPrice) {
            // The current lowest listing IS our own listing — don't go lower
            targetPrice = lastTargetPrice
            bot.log.info(
                `${LOG} Lowest ${formatMoney(lowestPrice)} = our last target` +
                ` — keeping ${formatMoney(targetPrice)} (not undercutting ourselves)`
            )
        } else {
            targetPrice = lowestPrice - decrementAmount
            if (targetPrice < 1) {
                bot.log.warn(`${LOG} Computed target ${targetPrice} ≤ 0 — clamping to 1`)
                targetPrice = 1
            }
            bot.log.info(
                `${LOG} Lowest: ${formatMoney(lowestPrice)}` +
                `  →  target: ${formatMoney(targetPrice)} (−${decrementAmount})`
            )
        }
        // ── Price floor guard ─────────────────────────────────────────────────
        // NOTE: lastTargetPrice is NOT set here. It is only updated inside the
        // sell loop after a listing is actually confirmed (section D below).
        // Setting it here would let a floor-blocked or limit-blocked price act
        // as the anti-undercut anchor even though nothing was ever listed at it.
        if (minPriceFloor > 0 && targetPrice < minPriceFloor) {
            bot.log.warn(
                `${LOG} Target ${formatMoney(targetPrice)} is below floor ${formatMoney(minPriceFloor)}` +
                ` — market too cheap, stopping sell loop`
            )
            exitReason = 'priceFloor'
            break
        }

        const priceStr = Math.round(targetPrice).toString()

        // ── C. Fill hotbar (window-0 clicks happen here, AFTER price check) ──
        await fillHotbarWith1x(bot, itemName, fillDelayMs, settleAfterFillMs)

        // Read which hotbar slots have 1× itemName after the fill
        const hotbarSlotNums = []
        for (let s = 36; s <= 44; s++) {
            const item = bot.inventory.slots[s]
            if (item && item.name === itemName && item.count === 1) hotbarSlotNums.push(s)
        }

        if (hotbarSlotNums.length === 0) {
            bot.log.info(`${LOG} No 1×${itemName} in hotbar after fill — done`)
            break
        }
        bot.log.info(`${LOG} Hotbar slots with 1×${itemName}: [${hotbarSlotNums.join(', ')}]`)

        // ── D. Sell each hotbar slot (with auction-limit retry) ──────────────
        // needsPriceRecheck: set when a sale arrives after a limit wait.
        //   Market prices may have moved; restart from step A before listing again.
        // limitTimeout: set when no sale arrives within saleWaitTimeoutMs.
        //   We stop the sell phase without setting bot._quitting — the bot is still
        //   connected; auctionOrderLoop will wait then retry.
        let needsPriceRecheck = false
        let limitTimeout      = false

        for (const winSlot of hotbarSlotNums) {
            if (bot._quitting || needsPriceRecheck || limitTimeout) break

            const hbIdx = winSlot - 36   // 0–8

            // ── Per-slot retry loop ───────────────────────────────────────────
            // Stays on this slot until: item is listed, item is gone,
            // or an unrecoverable error occurs.
            while (true) {
                if (bot._quitting) break

                // If auction cap is active, block until a buyer frees a slot
                if (state.limitHit) {
                    bot.log.info(`${LOG} ⏳ Auction limit active on slot ${winSlot} — waiting for a sale…`)
                    try {
                        await waitForNextSale(bot, saleWaitTimeoutMs)
                        await sleep(500)   // brief settle after notification
                        // Market may have moved while we were waiting — re-check AH
                        // price before listing remaining hotbar slots.
                        bot.log.info(`${LOG} Sale received — re-fetching AH price before next listing`)
                        needsPriceRecheck = true
                        break   // exit inner while; outer for checks needsPriceRecheck
                    } catch (err) {
                        // No sale arrived within saleWaitTimeoutMs.  Items remain in
                        // inventory; stop the sell phase so auctionOrderLoop can wait
                        // and retry.  Do NOT set bot._quitting — the bot is still alive.
                        bot.log.warn(`${LOG} ${err.message} — stopping sell phase for now`)
                        limitTimeout = true
                        break   // exit inner while
                    }
                }

                // Re-read slot — item may be gone if it was listed on a previous attempt
                const item = bot.inventory.slots[winSlot]
                if (!item || item.name !== itemName || item.count !== 1) {
                    bot.log.info(`${LOG} Hotbar slot ${winSlot} no longer has 1×${itemName} — moving on`)
                    break   // advance to next hotbar slot
                }

                // Equip: held_item_change only, NO window_click
                bot.log.info(`${LOG} Equipping hotbar ${hbIdx} (slot ${winSlot})`)
                bot.setQuickBarSlot(hbIdx)
                await sleep(300)

                const heldBefore = bot.inventory.slots[bot.quickBarSlot + 36]
                if (!heldBefore || heldBefore.name !== itemName) {
                    bot.log.warn(
                        `${LOG} Expected ${itemName} in hand, got` +
                        ` ${heldBefore?.name ?? 'nothing'} — skipping slot ${winSlot}`
                    )
                    break
                }

                // Close any stale plugin window before /ah sell.
                // On a previous timeout, the CONFIRM LISTING window may have arrived
                // late (after the timeout promise resolved), leaving bot.currentWindow
                // set.  Sending /ah sell while a window is open server-side can cause
                // the server to reject or ignore the command.
                if (bot.currentWindow) {
                    bot.log.warn(`${LOG} Stale window open before /ah sell [slot ${winSlot}] — closing`)
                    try { bot.closeWindow(bot.currentWindow) } catch { }
                    await sleep(400)
                }

                // Race: CONFIRM LISTING window open  vs  limit chat  vs  timeout
                bot.log.info(`${LOG} Sending: /ah sell ${priceStr}`)
                const result = await sendSellAndWait(bot, priceStr, winTimeoutMs)

                if (result.type === 'limit') {
                    // state.limitHit already true; top of inner while will wait for sale
                    bot.log.info(`${LOG} Limit hit listing slot ${winSlot} — will retry after next sale`)
                    continue
                }

                if (result.type === 'timeout') {
                    const stillThere = (() => {
                        const s = bot.inventory.slots[winSlot]
                        return s && s.name === itemName && s.count === 1
                    })()
                    if (stillThere) {
                        bot.log.warn(`${LOG} /ah sell window timed out — item still in slot, retrying`)
                        await sleep(clickDelayMs)
                        continue
                    }
                    bot.log.warn(`${LOG} /ah sell window timed out and item is gone — moving on`)
                    break
                }

                // Got CONFIRM LISTING window — click lime glass
                const confirmed = await clickConfirmInListingWindow(bot, result.win, clickDelayMs, debug)

                // Verify item left hand = listed successfully
                await sleep(400)
                const heldAfter = bot.inventory.slots[bot.quickBarSlot + 36]
                if (!heldAfter) {
                    if (confirmed) {
                        totalSold++
                        // Lock in the anchor price only after a real confirmed listing.
                        // This ensures the anti-undercut check on the next batch
                        // reflects an actual listing rather than a computed-but-blocked
                        // price (floor stop or limit block).
                        lastTargetPrice = targetPrice
                    }
                    bot.log.info(
                        `${LOG} ✓ Listed 1×${itemName} @ ${formatMoney(targetPrice)}` +
                        `  (total listed: ${totalSold})`
                    )
                    await sleep(sellIntervalMs)
                    break   // advance to next hotbar slot
                }

                // Item still in hand after confirm — limit may have fired after window opened
                bot.log.warn(
                    `${LOG} Slot ${winSlot} still has ${heldAfter.name}×${heldAfter.count}` +
                    ` after confirm — retrying`
                )
                await sleep(clickDelayMs)
                // loop back to top of while — state.limitHit check will block if needed
            }
        }

        // ── E. Batch summary / limit-timeout / price-recheck restart ─────────
        if (limitTimeout) {
            // No sale arrived within saleWaitTimeoutMs while at the auction limit.
            // Return 'limitTimeout' so auctionOrderLoop can wait before retrying.
            exitReason = 'limitTimeout'
            break   // exit outer while
        }

        if (needsPriceRecheck) {
            // A sale arrived during a limit wait — skip the summary and restart
            // immediately from step A so we list remaining hotbar items at the
            // current market price rather than the stale batch price.
            bot.log.info(
                `${LOG} Restarting price check (${totalSold} listed so far)` +
                ` — items still in hotbar will be re-read by fillHotbarWith1x`
            )
            continue
        }

        const allRemaining = bot.inventory.items().filter(i => i.name === itemName)
        const oneXRemaining = allRemaining.filter(i => i.count === 1).length
        const bigRemaining = allRemaining.filter(i => i.count > 1).length
        bot.log.info(
            `${LOG} Batch ${batchNum} complete — ${totalSold} listed so far` +
            `  |  ${oneXRemaining} ×1 + ${bigRemaining} stacked ${itemName} remaining`
        )
        // Loop continues: step 0 at the top handles flatten → sell → stop logic
    }

    stopWatcher()

    // Write cumulative stats back so the next call picks them up
    if (persistedState) {
        persistedState.totalEarned    = state.totalEarned
        persistedState.buyCount       = state.buyCount
        persistedState.lastTargetPrice = lastTargetPrice
        // persistedState.startTime is intentionally left unchanged — it marks
        // the start of the whole run, not just this sell phase
    }

    const elapsedMin   = (Date.now() - startTime) / 60_000
    const profitPerMin = elapsedMin > 0 ? state.totalEarned / elapsedMin : 0
    bot.log.info(
        `${LOG} ═══ Done: ${totalSold} listed this phase` +
        `  |  ${state.buyCount} total sales` +
        `  |  ${formatMoney(state.totalEarned)} total earned` +
        `  |  ${formatMoney(profitPerMin)}/min` +
        `  |  ${elapsedMin.toFixed(1)} min elapsed ═══`
    )
    return { totalSold, batches: batchNum, exitReason, totalEarned: state.totalEarned, buyCount: state.buyCount }
}

module.exports = { auctionSellAll, parseMoneyString, formatMoney }
