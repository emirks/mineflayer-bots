// ── sweepSpawnerPages ──────────────────────────────────────────────────────────
// Orchestrates the spawnerWindow atomic skills across all pages of one spawner,
// and then across all spawners within a given radius.
//
// Exported:
//   sweepOneSpawner(bot, block, opts)   — all pages of a single spawner block
//   sweepSpawnerPages(bot, opts)        — finds all spawners + runs sweepOneSpawner
//
// Per-page logic:
//   • slots 0–44 have arrows  → sellSpawnerPage() — done with this spawner
//   • slots 0–44 bones / empty, next-page arrow present
//                              → dropSpawnerPage() → navigateToNextPage() → repeat
//   • no items and no next arrow → done
//
// Returns structured data (droppedCounts, soldCounts per spawner) so the
// calling action can log grand totals and optionally compute money.

const world  = require('../world')
const skills = require('../skills')
const {
    classifySpawnerPage,
    openSpawnerWindow,
    dropSpawnerPage,
    navigateToNextPage,
    sellSpawnerPage,
} = require('./spawnerWindow')

const ACTIVATE_RANGE = 3

// Merges item count maps: addCounts({ bone: 10 }, { bone: 5, arrow: 3 })
// → { bone: 15, arrow: 3 }
function addCounts(target, source) {
    for (const [name, count] of Object.entries(source)) {
        target[name] = (target[name] ?? 0) + count
    }
}

// ── sweepOneSpawner ───────────────────────────────────────────────────────────
// Opens a single spawner block and pages through every page, applying the
// drop-or-sell rule. Returns accumulated item counts for both outcomes.
//
// @param {Bot}    bot
// @param {Block}  block
// @param {object} [opts]
// @param {number}   [opts.winTimeoutMs=5000]     windowOpen timeout per window
// @param {number}   [opts.itemSlotStart=0]
// @param {number}   [opts.itemSlotEnd=44]
// @param {number}   [opts.slotDrop=50]
// @param {number}   [opts.slotNextPage=53]
// @param {number}   [opts.slotSell=48]
// @param {number}   [opts.confirmFallback=15]
// @param {number}   [opts.dropSettleMs=400]
// @param {number}   [opts.confirmSettleMs=600]
// @param {string[]} [opts.sellTriggerItems=['arrow']]
//
// @returns {Promise<{
//   pagesDropped:  number,
//   pagesSold:     number,
//   droppedCounts: Object<string,number>,
//   soldCounts:    Object<string,number>,
//   error:         string|null,
// }>}
async function sweepOneSpawner(bot, block, opts = {}) {
    const {
        winTimeoutMs     = 5000,
        itemSlotStart    = 0,
        itemSlotEnd      = 44,
        slotDrop         = 50,
        slotNextPage     = 53,
        slotSell         = 48,
        confirmFallback  = 15,
        dropSettleMs     = 400,
        confirmSettleMs  = 600,
        sellTriggerItems = ['arrow'],
    } = opts

    const result = {
        pagesDropped:  0,
        pagesSold:     0,
        droppedCounts: {},
        soldCounts:    {},
        error:         null,
    }

    let win
    try {
        win = await openSpawnerWindow(bot, block, winTimeoutMs)
    } catch (err) {
        result.error = err.message
        return result
    }

    let page = 0
    while (true) {
        if (bot._quitting) break
        page++

        const { hasSellTrigger, totalItems, counts, hasNextPage } =
            classifySpawnerPage(win, itemSlotStart, itemSlotEnd, sellTriggerItems)

        const countsStr = Object.entries(counts).map(([n, c]) => `${n}:${c}`).join(' ')
        bot.log.info(
            `[SWEEP]   page ${page}: ` +
            (countsStr || 'empty') +
            `  hasArrows:${hasSellTrigger}  hasNext:${hasNextPage}`
        )

        // ── SELL ─────────────────────────────────────────────────────────────
        if (hasSellTrigger) {
            bot.log.info(`[SWEEP]   Arrows found — selling…`)
            try {
                await sellSpawnerPage(bot, slotSell, confirmFallback, confirmSettleMs, winTimeoutMs)
                addCounts(result.soldCounts, counts)
                result.pagesSold++
                bot.log.info(`[SWEEP]   Sold page ${page}.`)
            } catch (err) {
                bot.log.warn(`[SWEEP]   Sell failed: ${err.message}`)
                result.error = err.message
            }
            break  // selling always clears remaining pages
        }

        // ── DROP ──────────────────────────────────────────────────────────────
        if (totalItems > 0) {
            bot.log.info(`[SWEEP]   Bones only — dropping…`)
            try {
                await dropSpawnerPage(bot, slotDrop, dropSettleMs)
                addCounts(result.droppedCounts, counts)
                result.pagesDropped++
            } catch (err) {
                bot.log.warn(`[SWEEP]   Drop failed: ${err.message}`)
            }
        }

        // ── NAVIGATE OR STOP ──────────────────────────────────────────────────
        if (!hasNextPage) {
            bot.log.info(`[SWEEP]   No next page — done.`)
            break
        }

        bot.log.info(`[SWEEP]   Navigating to next page…`)
        try {
            win = await navigateToNextPage(bot, slotNextPage, winTimeoutMs)
        } catch (err) {
            bot.log.warn(`[SWEEP]   Page navigation failed: ${err.message}`)
            result.error = err.message
            break
        }
    }

    if (bot.currentWindow && bot.currentWindow.id === win?.id) {
        bot.closeWindow(win)
    }

    return result
}

// ── sweepSpawnerPages ─────────────────────────────────────────────────────────
// Finds all spawner blocks within `radius`, navigates to each, and runs
// sweepOneSpawner. Returns one result entry per spawner block.
//
// @param {Bot}    bot
// @param {object} [opts]
// @param {number}   [opts.radius=64]
// @param {number}   [opts.approachDistance=3]
// @param {number}   [opts.winTimeoutMs=5000]
// @param {number}   [opts.dropSettleMs=400]
// @param {number}   [opts.confirmSettleMs=600]
// @param {string[]} [opts.sellTriggerItems=['arrow']]
//
// @returns {Promise<Array<{
//   pos, pagesDropped, pagesSold, droppedCounts, soldCounts, error
// }>>}
async function sweepSpawnerPages(bot, opts = {}) {
    const { radius = 64, approachDistance = ACTIVATE_RANGE } = opts

    const blocks = world.getNearestBlocks(bot, ['spawner'], radius)

    if (blocks.length === 0) {
        bot.log.info(`[SWEEP] No spawners found within ${radius} blocks.`)
        return []
    }

    bot.log.info(`[SWEEP] Found ${blocks.length} spawner(s) — starting sweep…`)

    const results = []

    for (const block of blocks) {
        if (bot._quitting) break

        const { x, y, z } = block.position
        await skills.goToPosition(bot, x, y, z, approachDistance)
        if (bot._quitting) break

        bot.log.info(`[SWEEP] ── Spawner @ (${x}, ${y}, ${z})`)

        const result = await sweepOneSpawner(bot, block, opts)
        results.push({ pos: block.position, ...result })

        const droppedStr = Object.entries(result.droppedCounts).map(([n, c]) => `${n}×${c}`).join(' ') || '—'
        const soldStr    = Object.entries(result.soldCounts).map(([n, c]) => `${n}×${c}`).join(' ')    || '—'
        bot.log.info(
            `[SWEEP]   done — ` +
            `pages_dropped:${result.pagesDropped} dropped:(${droppedStr})  ` +
            `pages_sold:${result.pagesSold} sold:(${soldStr})` +
            (result.error ? `  error:"${result.error}"` : '')
        )
    }

    return results
}

module.exports = { sweepOneSpawner, sweepSpawnerPages }
