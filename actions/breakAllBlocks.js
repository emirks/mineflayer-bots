const world  = require('../lib/world')
const skills = require('../lib/skills')

// Find every occurrence of a block type within searchRadius and dig them all,
// one by one (each fully awaited before moving to the next).
async function breakAllBlocks(bot, options) {
  const { blockName = 'crafting_table', searchRadius = 64 } = options

  const blocks = world.getNearestBlocks(bot, [blockName], searchRadius)

  if (blocks.length === 0) {
    console.log(`[ACTION] No "${blockName}" found within ${searchRadius} blocks — skipping.`)
    return
  }

  console.log(`[ACTION] Breaking ${blocks.length} "${blockName}" block(s)...`)

  let broken = 0

  for (let i = 0; i < blocks.length; i++) {
    const { x, y, z } = blocks[i].position
    console.log(`[ACTION] Breaking "${blockName}" at (${x}, ${y}, ${z})...`)

    try {
      await skills.breakBlockAt(bot, x, y, z)
      broken++
    } catch (err) {
      console.warn(`[ACTION] Could not break "${blockName}" at (${x}, ${y}, ${z}) — ${err.message} — skipping.`)
    }

    if (i < blocks.length - 1) {
      const delay = Math.floor(Math.random() * 1200) + 400  // 400–1600 ms
      console.log(`[ACTION] Waiting ${delay}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  console.log(`[ACTION] Done — broke ${broken}/${blocks.length} "${blockName}" block(s).`)
}

module.exports = breakAllBlocks
