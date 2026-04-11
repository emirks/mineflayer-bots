const { sweepSpawnerPages } = require('../lib/skills/sweepSpawnerPages')

// Sweeps all spawner pages within radius: drops bones-only pages, sells
// arrow-containing pages, then logs a grand-total summary.
// Optionally computes money earned if a `prices` map is supplied.
//
// Options:
//   radius           (default 64)        — spawner search radius (blocks)
//   winTimeoutMs     (default 5000)      — per-window / windowOpen timeout (ms)
//   dropSettleMs     (default 400)       — settle delay after each dropper click
//   confirmSettleMs  (default 600)       — settle delay after each confirm click
//   approachDistance (default 3)         — pathfinder stop-distance (blocks)
//   sellTriggerItems (default ['arrow']) — item names that trigger the sell path
//   prices           (default {})        — { itemName: pricePerUnit } for money calc
//                                          e.g. { arrow: 2.5 } → arrow×384 = $960.00
//
// NOTE: do NOT put `timeoutMs` here — the action executor treats opts.timeoutMs
// as an action-level kill timer. Use winTimeoutMs for per-window timeouts.
async function boneSweep(bot, options = {}) {
    const { prices = {} } = options

    const results = await sweepSpawnerPages(bot, options)

    if (!results || results.length === 0) return

    // ── Accumulate grand totals ───────────────────────────────────────────────
    const grandDropped = {}
    const grandSold    = {}
    let   totalErrors  = 0

    for (const r of results) {
        for (const [name, count] of Object.entries(r.droppedCounts ?? {})) {
            grandDropped[name] = (grandDropped[name] ?? 0) + count
        }
        for (const [name, count] of Object.entries(r.soldCounts ?? {})) {
            grandSold[name] = (grandSold[name] ?? 0) + count
        }
        if (r.error) totalErrors++
    }

    // ── Log grand totals ──────────────────────────────────────────────────────
    const SEP  = '[BONE-SWEEP] ═══════════════════════════════════════════════'
    const DASH = '[BONE-SWEEP] ───────────────────────────────────────────────'

    bot.log.info(SEP)
    bot.log.info(`[BONE-SWEEP] GRAND TOTAL  (${results.length} spawner(s)${totalErrors ? `, ${totalErrors} error(s)` : ''})`)
    bot.log.info(DASH)

    const droppedEntries = Object.entries(grandDropped)
    if (droppedEntries.length === 0) {
        bot.log.info('[BONE-SWEEP]   Dropped : (nothing)')
    } else {
        for (const [name, count] of droppedEntries) {
            bot.log.info(`[BONE-SWEEP]   Dropped : ${name.padEnd(28)} ×${count}`)
        }
    }

    bot.log.info(DASH)

    const soldEntries = Object.entries(grandSold)
    if (soldEntries.length === 0) {
        bot.log.info('[BONE-SWEEP]   Sold    : (nothing)')
    } else {
        let grandTotal = 0
        for (const [name, count] of soldEntries) {
            const price = prices[name]
            if (price != null) {
                const money = count * price
                grandTotal += money
                bot.log.info(
                    `[BONE-SWEEP]   Sold    : ${name.padEnd(28)} ×${String(count).padStart(6)}` +
                    `  @${price}/ea = $${money.toFixed(2)}`
                )
            } else {
                bot.log.info(`[BONE-SWEEP]   Sold    : ${name.padEnd(28)} ×${count}`)
            }
        }
        if (grandTotal > 0) {
            bot.log.info(DASH)
            bot.log.info(`[BONE-SWEEP]   TOTAL MONEY : $${grandTotal.toFixed(2)}`)
        }
    }

    bot.log.info(SEP)
}

module.exports = boneSweep
