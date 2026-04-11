const { getSpawnerInfo } = require('../lib/skills/spawnerSurvey')
const world = require('../lib/world')
const skills = require('../lib/skills')

// Surveys all spawners within radius, caches the result on bot._spawnerSurvey.
//
// Used by sentinelSweep at alert time — survey data is already on the bot so
// the sweep can run without any GUI interactions under pressure.
//
// Runs twice in the sentinel profiles:
//   1. onSpawn (10 s delay)  — populates the cache before any threat arrives;
//                              the bot navigates to each spawner during the survey,
//                              leaving it already close to the spawner cluster.
//   2. onInterval (5 min)    — keeps the cache fresh as stacks change over time.
//
// ABORT BEHAVIOUR:
//   playerRadius sets bot._sweepPending = true the moment an alert fires.
//   This action checks that flag after every navigation step and breaks out
//   immediately, saving whatever partial data was collected so far.
//   sentinelSweep clears bot._sweepPending when it starts.
async function surveySpawnersAction(bot, options = {}) {
    const {
        radius = 64,
        timeoutMs = 5000,
    } = options

    const shouldAbort = () => bot._sweepPending || bot._quitting

    const blocks = world.getNearestBlocks(bot, ['spawner'], radius)

    if (blocks.length === 0) {
        bot.log.info('[ACTION] No spawners found — survey skipped.')
        return
    }

    bot.log.info(`[ACTION] Surveying ${blocks.length} spawner(s) within ${radius} blocks...`)

    const results = []

    for (const block of blocks) {
        // Check before navigating — skip remaining blocks if alert is active
        if (shouldAbort()) {
            bot.log.warn(
                `[ACTION] Survey aborted — alert pending ` +
                `(${results.length}/${blocks.length} position(s) surveyed).`
            )
            break
        }

        const { x, y, z } = block.position
        const distAtScan = Math.round(bot.entity.position.distanceTo(block.position) * 10) / 10

        await skills.goToPosition(bot, x, y, z, 3)

        // Check again after navigation — could have taken several seconds
        if (shouldAbort()) {
            bot.log.warn(
                `[ACTION] Survey aborted after navigating to (${x},${y},${z}) — ` +
                `alert pending (${results.length}/${blocks.length} surveyed).`
            )
            break
        }

        const info = await getSpawnerInfo(bot, block, undefined, timeoutMs)

        results.push({
            block,
            pos: block.position,
            distAtScan,
            stackCount: info?.stackCount ?? null,
            ammo: info?.ammo ?? null,
        })

        const stackStr = info?.stackCount != null ? `stacks:${info.stackCount}` : 'stacks:?'
        bot.log.info(`[ACTION]   (${x},${y},${z}) dist:${distAtScan}m ${stackStr}`)
    }

    // Cache whatever we collected — even partial data gives sentinelSweep a
    // totalExpected estimate to verify against.
    const totalExpected = results.reduce((sum, r) => sum + (r.stackCount ?? 0), 0)

    bot._spawnerSurvey = {
        timestamp: Date.now(),
        results,
        totalExpected,
    }

    bot.log.info(
        `[ACTION] Survey cached — ${results.length}/${blocks.length} position(s), ` +
        `${totalExpected} total stacks.`
    )
}

module.exports = surveySpawnersAction
