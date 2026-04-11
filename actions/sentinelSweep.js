const world = require('../lib/world')
const skills = require('../lib/skills')

// Sentinel's core asset-denial sweep.
//
// ── HOW THE KEY PRIMITIVES WORK ──────────────────────────────────────────────
//
//  world.getNearestBlocks()
//    Fully local, synchronous.  Reads mineflayer's in-memory chunk store.
//    That store is updated by block_change packets — the exact packet that
//    bot.dig() awaits before resolving.  So by the time breakBlockAt returns,
//    the chunk cache already reflects the break.  This makes it a perfect
//    real-time truth source.
//
//  bot.setControlState('sneak', true)
//    Local memory write only.  No packet is sent immediately.  mineflayer's
//    physics loop fires every ~50 ms (one Minecraft tick) and piggybacks the
//    sneak flag onto the next player_position_and_look packet.  Code after
//    setControlState continues executing at once.  To guarantee the sneak
//    packet reaches the server before the dig START packet, we await one
//    physics tick (≥60 ms) after setting sneak.
//
//  skills.breakBlockAt()
//    True server round-trip: sends player_digging START → waits for the
//    server block_change ACK → resolves.  bot.tool.equipForBlock() inside it
//    is also a round-trip (held_item_change confirmed by set_slot).  Only
//    resolves when the block is confirmed gone on the server.
//
//  skills.goToPosition()
//    Pathfinder-driven async.  Resolves when the bot's local position
//    satisfies GoalNear — no explicit server ACK.  breakBlockAt has its own
//    internal GoalNear fallback if the bot drifts >4.5 blocks after we
//    navigate, so stopping at 4 blocks is a safe approach distance.
//
//  world.getInventoryCounts()
//    Fully local.  Iterates bot.inventory.slots which is kept in sync by
//    server-pushed set_slot / window_items packets.  Spawners go directly to
//    inventory on break (no item entity), so the set_slot packet arrives in
//    the same server-processing batch as block_change — reliable once the
//    between-sweeps sleep has elapsed.
//
// ── TERMINATION MODEL ────────────────────────────────────────────────────────
//
//  Primary   — world scan returns 0 spawners (chunk cache = ground truth)
//              Ghost-block guard: wait betweenSweepsMs then rescan once more.
//              Only exit if the rescan is also 0.
//  Secondary — maxRounds safety cap
//  Panic     — bot._quitting checked at every await
//
//  Final     — inventory verification after the world-clear exit:
//              if collected < totalExpected, keep waiting + rescanning until
//              satisfied or verifyTimeoutMs expires.  Getting every spawner is
//              critical, so we never disconnect on a world-clear alone.
//
// ── TIMING ───────────────────────────────────────────────────────────────────
//
//  sneakSyncMs      — one physics tick waited after setControlState('sneak')
//                     so the sneak packet is sent before dig START reaches the
//                     server (physics loop fires every ~50 ms; 60 ms is safe).
//  interBlockMs     — pacing between consecutive breaks in a round.
//  betweenSweepsMs  — applied only when blocks.length <= 2 (few blocks left).
//                     When many blocks are visible, traveling to the next one
//                     already covers the ghost-block re-place window.
//
async function sentinelSweep(bot, options = {}) {
    const {
        blockName = 'spawner',
        searchRadius = 64,
        maxRounds = 100,
        sneakSyncMs = 60,    // one physics tick — ensures sneak packet precedes dig
        interBlockMinMs = 100,
        interBlockMaxMs = 200,
        betweenSweepsMinMs = 400,   // ghost-window sleep, only when ≤2 blocks remain
        betweenSweepsMaxMs = 600,
        verifyTimeoutMs = 15000, // max time to wait for inventory gate after world clear
        verifyPollMs = 800,   // how often to rescan during inventory verification
    } = options

    const jitter = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
    const sleep = ms => new Promise(r => setTimeout(r, ms))

    // world.getInventoryCounts iterates bot.inventory.slots — fully local.
    const countInv = () => world.getInventoryCounts(bot)[blockName] ?? 0

    // ── Clear the abort flag (set by playerRadius on alert) ───────────────────
    bot._sweepPending = false

    // ── Load survey total ─────────────────────────────────────────────────────
    let totalExpected = 0
    const survey = bot._spawnerSurvey
    if (survey?.totalExpected > 0) {
        totalExpected = survey.totalExpected
        const ageS = ((Date.now() - survey.timestamp) / 1000).toFixed(0)
        bot.log.info(
            `[SENTINEL] Survey loaded — ${totalExpected} ${blockName}(s) expected ` +
            `across ${survey.results.length} position(s) (${ageS}s old).`
        )
    } else {
        bot.log.warn(
            '[SENTINEL] No survey data — sweeping until world is clear; ' +
            'no inventory gate applied.'
        )
    }

    const invStart = countInv()
    bot.log.info(`[SENTINEL] Starting sweep — inv baseline: ${invStart} ${blockName}(s).`)

    // ── Sweep loop ────────────────────────────────────────────────────────────
    for (let round = 1; round <= maxRounds; round++) {
        if (bot._quitting) break

        // Scan chunk cache — fully local, reflects all previously confirmed breaks.
        const blocks = world.getNearestBlocks(bot, [blockName], searchRadius)

        const collectedNow = countInv() - invStart
        bot.log.info(
            `[SENTINEL] Round ${round} — ${blocks.length} block(s) in world | ` +
            `${collectedNow}/${totalExpected || '?'} in inventory.`
        )

        // ── World-clear path ──────────────────────────────────────────────────
        // Primary termination: chunk cache shows no blocks.  We wait one
        // betweenSweepsMs interval and rescan to rule out a ghost-block window
        // (server re-places the block client-side before the real break arrives).
        if (blocks.length === 0) {
            const ghostWait = jitter(betweenSweepsMinMs, betweenSweepsMaxMs)
            bot.log.info(
                `[SENTINEL] World clear — waiting ${ghostWait}ms for ghost-block confirmation.`
            )
            await sleep(ghostWait)
            if (bot._quitting) break

            const recheck = world.getNearestBlocks(bot, [blockName], searchRadius)
            if (recheck.length === 0) {
                bot.log.info('[SENTINEL] Ghost-check passed — world confirmed clear.')
                break // exit to inventory verification below
            }
            bot.log.info(
                `[SENTINEL] Ghost block detected (${recheck.length} reappeared) — continuing sweep.`
            )
            continue
        }

        // ── Break every visible block in this round ───────────────────────────
        for (let i = 0; i < blocks.length; i++) {
            if (bot._quitting) break

            const { x, y, z } = blocks[i].position

            await skills.goToPosition(bot, x, y, z, 4)
            if (bot._quitting) break

            // setControlState is a local write; the physics loop batches it into
            // the next player_position_and_look (~50 ms).  Sleeping sneakSyncMs
            // (≥60 ms) guarantees the sneak packet reaches the server before the
            // dig START packet that breakBlockAt sends immediately on entry.
            bot.setControlState('sneak', true)
            await sleep(sneakSyncMs)

            try {
                await skills.breakBlockAt(bot, x, y, z)
                bot.log.info(`[SENTINEL]   broke (${x},${y},${z})`)
            } catch (err) {
                bot.log.warn(`[SENTINEL]   ✗ (${x},${y},${z}) — ${err.message}`)
            } finally {
                bot.setControlState('sneak', false)
            }

            // Inter-block pacing: give the server a beat and keep break cadence
            // human-like.  Only sleep between blocks, not after the last one.
            if (i < blocks.length - 1) {
                await sleep(jitter(interBlockMinMs, interBlockMaxMs))
            }
        }

        if (bot._quitting) break

        // ── Between-sweeps sleep ──────────────────────────────────────────────
        // Only applied when few blocks remain (≤2).  When many blocks are
        // visible, travelling to the next one already fills the ghost window
        // and an extra sleep is wasted time.  With ≤2 blocks there is no next
        // destination to travel to, so we must wait explicitly.
        if (blocks.length <= 2) {
            const delay = jitter(betweenSweepsMinMs, betweenSweepsMaxMs)
            bot.log.info(`[SENTINEL] ≤2 blocks — waiting ${delay}ms (ghost window + inv settle).`)
            await sleep(delay)
        }
    }

    if (bot._quitting) return

    // ── Inventory verification (runs after world-clear exit) ──────────────────
    // The world scan is clear.  Now verify that inventory matches totalExpected.
    // Spawners go directly to inventory on break so the set_slot packet should
    // have arrived well within the between-sweeps waits.  If we are still short,
    // something unexpected happened (ghost re-place was missed, block fell into
    // a different survey count, etc.).  We keep rescanning both the world AND
    // the inventory until satisfied or verifyTimeoutMs expires.
    if (totalExpected > 0) {
        const verifyStart = Date.now()
        let verified = false

        while (Date.now() - verifyStart < verifyTimeoutMs) {
            if (bot._quitting) break

            const collected = countInv() - invStart
            const worldBlocks = world.getNearestBlocks(bot, [blockName], searchRadius)

            if (collected >= totalExpected) {
                bot.log.info(
                    `[SENTINEL] ✓ VERIFIED — ${collected}/${totalExpected} ${blockName}(s) in inventory.`
                )
                verified = true
                break
            }

            if (worldBlocks.length > 0) {
                // A block reappeared (ghost or missed block) — re-enter sweep.
                bot.log.warn(
                    `[SENTINEL] Verification found ${worldBlocks.length} block(s) still in world — ` +
                    `re-queueing sweep round.`
                )
                // Re-break the block(s) before retrying inventory check.
                for (const block of worldBlocks) {
                    if (bot._quitting) break
                    const { x, y, z } = block.position
                    await skills.goToPosition(bot, x, y, z, 4)
                    if (bot._quitting) break
                    bot.setControlState('sneak', true)
                    await sleep(sneakSyncMs)
                    try {
                        await skills.breakBlockAt(bot, x, y, z)
                        bot.log.info(`[SENTINEL]   re-broke (${x},${y},${z})`)
                    } catch (err) {
                        bot.log.warn(`[SENTINEL]   ✗ re-break (${x},${y},${z}) — ${err.message}`)
                    } finally {
                        bot.setControlState('sneak', false)
                    }
                }
                await sleep(jitter(betweenSweepsMinMs, betweenSweepsMaxMs))
                continue
            }

            // World clear but inventory short — wait for in-flight set_slot packets.
            const elapsed = ((Date.now() - verifyStart) / 1000).toFixed(1)
            bot.log.warn(
                `[SENTINEL] Inventory short (${collected}/${totalExpected}) — ` +
                `world clear, waiting for in-flight packets… (${elapsed}s / ${verifyTimeoutMs / 1000}s)`
            )
            await sleep(verifyPollMs)
        }

        if (!verified && !bot._quitting) {
            const finalCollected = countInv() - invStart
            bot.log.warn(
                `[SENTINEL] ✗ SHORT after verify timeout — ` +
                `${finalCollected}/${totalExpected} ${blockName}(s) collected.`
            )
        }
    } else {
        // No survey — just report how many were collected.
        const totalCollected = countInv() - invStart
        bot.log.info(
            `[SENTINEL] Sweep done — ${totalCollected} ${blockName}(s) collected (no survey baseline).`
        )
    }
}

module.exports = sentinelSweep
