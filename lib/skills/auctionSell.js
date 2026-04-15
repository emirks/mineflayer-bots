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
//   in mineflayer 1.20.4 (waitForWindowUpdate returns immediately for non-crafting
//   slots).  DonutSMP Paper treats burst window-0 clicks as "inventory open" and
//   blocks /ah <browse> until the player sends close_window(0).  Since the price
//   check sends /ah BEFORE any window-0 clicks happen, it always succeeds.
//
// Exports:
//   auctionSellAll(bot, opts)   — full sell loop
//
// Options:
//   itemName           {string}   'redstone'        Minecraft item ID
//   searchTerm         {string}   'redstone dust'   /ah search argument
//   decrementAmount    {number}   10                $ to undercut lowest by
//   winTimeoutMs       {number}   8000              ms per GUI window open
//   clickDelayMs       {number}   600               settle delay after GUI clicks
//   fillDelayMs        {number}   200               delay between inventory swap clicks
//   settleAfterFillMs  {number}   1500              settle after filling hotbar (close_window sent too)
//   sellIntervalMs     {number}   800               delay between successive /ah sell commands
//   saleWaitTimeoutMs  {number}   300_000           max ms to wait for a sale when auction limit is hit
//   debug              {boolean}  false             when true: log all window slots + dump JSON files

const { waitForWindowOpen }                                                          = require('./spawnerWindow')
const { openChatCommandWindow, snapshotWindow, logWindowSnapshot, dumpWindowToFile } = require('./debugWindow')
const { getDisplayName, getLore, normalizeText }                                     = require('./nbtParse')
const { flattenInventoryStack }                                                      = require('./collectMyOrder')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const LOG = '[AUCTION-SELL]'

// ── Money helpers (same conventions as orderTraverse.js) ──────────────────────

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

function formatMoney(n) {
    if (n === null || n === undefined) return '?'
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
    return `$${n.toFixed(2)}`
}

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
// These materials are always GUI decoration / navigation buttons, never real
// listings.  Same list as orderTraverse.js.
const NAV_MATERIALS = new Set([
    'red_stained_glass_pane', 'lime_stained_glass_pane',
    'gray_stained_glass_pane', 'black_stained_glass_pane',
    'white_stained_glass_pane', 'green_stained_glass_pane',
    'arrow', 'barrier', 'oak_sign', 'birch_sign',
    'oak_button', 'stone_button', 'clock', 'hopper', 'cauldron', 'anvil',
])

function isNavSlot(slot) {
    if (!slot || !slot.name) return true
    if (NAV_MATERIALS.has(slot.name)) return true
    const text = normalizeText(getDisplayName(slot) + ' ' + getLore(slot).join(' '))
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
    const loreList = sortSlot?.nbt?.value?.display?.value?.Lore?.value?.value
    if (!Array.isArray(loreList)) return null

    for (const rawLine of loreList) {
        try {
            const json = JSON.parse(rawLine)

            // Flat format (DonutSMP AH): {"color":"#00fc88","text":"• Lowest Price","italic":false}
            // The color and text fields sit directly on the root object.
            if (json.color && json.color !== 'white' && json.color !== 'gray' && json.color !== 'dark_gray') {
                return (json.text ?? '').replace(/^[•\s]+/, '').trim()
            }

            // Nested format (DonutSMP orders): {"text":"","extra":[{"color":"...","text":"..."}]}
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

        const allItems  = bot.inventory.items()
        const bigStacks = allItems
            .filter(i => i.name === itemName && i.count > 1)
            .sort((a, b) => b.count - a.count)

        if (bigStacks.length === 0) break

        // Count empty main+hotbar slots (9–44)
        const occupied  = new Set(allItems.map(i => i.slot))
        let emptyCount  = 0
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
            stackSlot:    biggest.slot,
        })

        // Signal "inventory closed" to Paper before any /ah command
        bot.closeWindow(bot.inventory)
        await sleep(settleAfterFillMs)

        didFlatten = true
    }

    return didFlatten
}
