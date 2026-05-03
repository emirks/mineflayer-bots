'use strict'

// ── queryOrders — read remaining order counts from /order GUI ─────────────────
//
// Opens the /order command, navigates to "YOUR ORDERS", reads each item slot's
// NBT lore to extract: price per unit, delivered count, total count.
// Does NOT click any items (read-only). Closes the window when done.
//
// Returns an array of order objects:
//   [{ slot, item, displayName, price, delivered, total, remaining, lore }]
//
// Options:
//   orderCommand  {string}  '/order'  chat command that opens the orders GUI
//   winTimeoutMs  {number}  8000      ms to wait for each window
//   clickDelayMs  {number}  400       settle delay after clicking

const { getLore, getDisplayName, findSlotByKeyword, parseMoneyString } = require('./nbtParse')
const { waitForWindowOpen } = require('./spawnerWindow')
const { openChatCommandWindow } = require('./debugWindow')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const LOG = '[QUERY-ORDERS]'

// Materials used by DonutSMP as GUI navigation decorations (not real items).
const NAV_MATS = new Set([
  'red_stained_glass_pane', 'lime_stained_glass_pane',
  'gray_stained_glass_pane', 'black_stained_glass_pane',
  'white_stained_glass_pane', 'green_stained_glass_pane',
  'cyan_stained_glass_pane', 'blue_stained_glass_pane',
  'yellow_stained_glass_pane', 'orange_stained_glass_pane',
  'arrow', 'barrier', 'oak_sign', 'birch_sign',
  'oak_button', 'stone_button', 'clock', 'cauldron', 'anvil',
  'book', 'paper',
])

/**
 * Opens /order, navigates to YOUR ORDERS, reads all item slots.
 *
 * @param {object} bot
 * @param {{ orderCommand?: string, winTimeoutMs?: number, clickDelayMs?: number }} [opts]
 * @returns {Promise<Array<{ slot, item, displayName, price, delivered, total, remaining, lore }>>}
 */
async function queryOrders(bot, opts = {}) {
  const {
    orderCommand = '/order',
    winTimeoutMs = 8000,
    clickDelayMs = 400,
  } = opts

  bot.log?.info(`${LOG} Opening ${orderCommand}...`)

  // ── Step 1: open /order ──────────────────────────────────────────────────
  const win1 = await openChatCommandWindow(bot, orderCommand, winTimeoutMs)
  if (!win1) throw new Error('Timed out waiting for /order window')

  // ── Step 2: look for "YOUR ORDERS" nav slot ──────────────────────────────
  // Some versions of the plugin open the YOUR ORDERS page directly; others
  // show a main page with a navigation slot.
  let ordersWin = win1

  const yourOrdersSlot = findSlotByKeyword(win1, 'your orders')

  if (yourOrdersSlot >= 0) {
    // Main page — click YOUR ORDERS to get to per-user orders.
    bot.log?.info(`${LOG} Clicking "YOUR ORDERS" at slot ${yourOrdersSlot}`)
    await sleep(clickDelayMs)
    bot.clickWindow(yourOrdersSlot, 0, 0)

    try {
      ordersWin = await waitForWindowOpen(bot, winTimeoutMs)
    } catch {
      // If click didn't open a new window, maybe we're already on the right page.
      bot.log?.warn(`${LOG} No new window after clicking YOUR ORDERS — reading current window`)
      ordersWin = win1
    }
  }

  // ── Step 3: read all item slots ──────────────────────────────────────────
  bot.log?.info(`${LOG} Reading order slots from window "${ordersWin.title}"`)
  const orders = _readOrderSlots(ordersWin)
  bot.log?.info(`${LOG} Found ${orders.length} order(s)`)

  // ── Step 4: close window ─────────────────────────────────────────────────
  try {
    bot.closeWindow(ordersWin)
    await sleep(clickDelayMs)
  } catch { /* ignore — window may have already closed */ }

  return orders
}

/**
 * Parse all non-nav slots in a window as order items.
 */
function _readOrderSlots(win) {
  const orders = []
  const slots = win.slots || []
  const containerEnd = win.inventoryStart ?? Math.max(0, slots.length - 36)

  for (let i = 0; i < containerEnd; i++) {
    const slot = slots[i]
    if (!slot || !slot.name) continue
    if (NAV_MATS.has(slot.name)) continue

    const displayName = getDisplayName(slot) || slot.name
    const loreLines   = getLore(slot)

    // Parse price: "$151.11 each" or "$1.23K each"
    const priceLine = loreLines.find(l => /\$[\d.,]+[KkMm]?\s+each/i.test(l))
    let price = null
    if (priceLine) {
      const m = priceLine.match(/\$([\d.,]+[KkMm]?)/)
      if (m) price = parseMoneyString(m[1])
    }

    // Parse delivery progress: "30.04K / 50K Delivered"
    const delivLine = loreLines.find(l => /([\d.,]+[KkMm]?)\s*\/\s*([\d.,]+[KkMm]?)\s+delivered/i.test(l))
    let delivered = null, total = null, remaining = null
    if (delivLine) {
      const dm = delivLine.match(/([\d.,]+[KkMm]?)\s*\/\s*([\d.,]+[KkMm]?)\s+delivered/i)
      if (dm) {
        delivered = parseMoneyString(dm[1])
        total     = parseMoneyString(dm[2])
        remaining = Math.max(0, total - delivered)
      }
    }

    // Skip slots that have no recognisable order data (likely unlisted nav items).
    if (price === null && delivered === null) continue

    orders.push({
      slot,
      item: slot.name,
      displayName,
      price,
      delivered,
      total,
      remaining,
      lore: loreLines,
    })
  }

  return orders
}

module.exports = { queryOrders }
