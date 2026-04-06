// Finds the nearest block matching `blockName` within `searchRadius` and digs it.
// bot.dig awaits the full break animation, so the action truly completes before
// the next action in the stack starts.
async function breakBlock(bot, options) {
  const { blockName = 'crafting_table', searchRadius = 64 } = options

  const block = bot.findBlock({
    matching: (b) => b.name === blockName,
    maxDistance: searchRadius,
  })

  if (!block) {
    console.log(`[ACTION] No "${blockName}" found within ${searchRadius} blocks — skipping.`)
    return
  }

  const { x, y, z } = block.position
  console.log(`[ACTION] Breaking "${blockName}" at (${x}, ${y}, ${z})...`)

  try {
    await bot.dig(block)
    console.log(`[ACTION] "${blockName}" broken.`)
  } catch (err) {
    console.warn(`[ACTION] Could not break "${blockName}" — ${err.message}`)
  }
}

module.exports = breakBlock
