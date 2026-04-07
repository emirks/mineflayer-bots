const world  = require('../lib/world')
const skills = require('../lib/skills')

// Break every occurrence of a block type within searchRadius.
// Stacked blocks (server-side stacking where one position holds many copies)
// are handled by re-scanning after every full pass and repeating until the
// search comes back empty.  A round cap (default 500) prevents infinite loops.
async function breakAllBlocks(bot, options) {
  const {
    blockName       = 'crafting_table',
    searchRadius    = 64,
    maxRounds       = 500,
    rescanDelayMs   = 300,   // wait between re-scan rounds (ms)
    blockDelayMinMs = 400,   // min random pause between different block positions (ms)
    blockDelayMaxMs = 1600,  // max random pause between different block positions (ms)
  } = options

  let totalBroken = 0
  let round       = 0

  while (round < maxRounds) {
    round++

    const blocks = world.getNearestBlocks(bot, [blockName], searchRadius)

    if (blocks.length === 0) {
      if (round === 1) {
        bot.log.info(`[ACTION] No "${blockName}" found within ${searchRadius} blocks — skipping.`)
      } else {
        bot.log.info(`[ACTION] No more "${blockName}" found — all stacks cleared after ${round - 1} round(s).`)
      }
      break
    }

    bot.log.info(`[ACTION] Round ${round}: found ${blocks.length} "${blockName}" position(s), breaking...`)

    let brokenThisRound = 0

    for (let i = 0; i < blocks.length; i++) {
      const { x, y, z } = blocks[i].position
      bot.log.info(`[ACTION] Breaking "${blockName}" at (${x}, ${y}, ${z})...`)

      // Navigate upright (no sneak) so we move at full speed between blocks.
      // Stop within 4 blocks so breakBlockAt won't re-navigate and we can be
      // sneaking before the dig starts.
      await skills.goToPosition(bot, x, y, z, 4)

      bot.setControlState('sneak', true)
      try {
        await skills.breakBlockAt(bot, x, y, z)
        brokenThisRound++
        totalBroken++
      } catch (err) {
        bot.log.warn(`[ACTION] Could not break "${blockName}" at (${x}, ${y}, ${z}) — ${err.message} — skipping.`)
      } finally {
        bot.setControlState('sneak', false)
      }

      if (i < blocks.length - 1) {
        const delay = Math.floor(Math.random() * (blockDelayMaxMs - blockDelayMinMs)) + blockDelayMinMs
        bot.log.info(`[ACTION] Waiting ${delay}ms before next block...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    bot.log.info(
      `[ACTION] Round ${round} done — broke ${brokenThisRound}/${blocks.length} this round ` +
      `(${totalBroken} total). Re-scanning in ${rescanDelayMs}ms...`
    )
    await new Promise(resolve => setTimeout(resolve, rescanDelayMs))
  }

  if (round >= maxRounds) {
    bot.log.warn(`[ACTION] Reached maxRounds (${maxRounds}) — stopping to avoid infinite loop. Total broken: ${totalBroken}.`)
  }

  bot.log.info(`[ACTION] Finished — ${totalBroken} "${blockName}" break(s) total.`)
}

module.exports = breakAllBlocks
