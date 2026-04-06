const world = require('../lib/world')

// Starts a repeating scan and resolves immediately (non-blocking — the interval
// keeps running in the background while the rest of the action stack continues).
// Every `intervalMs` milliseconds, prints:
//   - Bot position
//   - All unique block types within `radius` blocks
//   - All entities within `radius` blocks with their distance and label
async function startDebugScan(bot, options) {
  const { radius = 8, intervalMs = 5000 } = options

  console.log(`[DEBUG] Scan started — every ${intervalMs}ms within ${radius} blocks`)

  setInterval(() => {
    if (!bot.entity) return

    const pos = world.getPosition(bot)
    console.log(
      `\n[DEBUG] ── (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}) ────────────`
    )

    // ── Blocks ────────────────────────────────────────────────────────────────
    const blockTypes = world.getNearbyBlockTypes(bot, radius)
    console.log(`[DEBUG] Blocks  : ${blockTypes.join(', ') || 'none'}`)

    // ── Entities ──────────────────────────────────────────────────────────────
    const entities = world.getNearbyEntities(bot, radius)
    if (entities.length === 0) {
      console.log(`[DEBUG] Entities: none`)
    } else {
      for (const e of entities) {
        if (e.username === bot.username) continue
        const label = e.username || e.name || e.type || 'unknown'
        const dist = bot.entity.position.distanceTo(e.position).toFixed(1)
        console.log(`[DEBUG]   ${label.padEnd(24)} ${dist}m`)
      }
    }
  }, intervalMs)
}

module.exports = startDebugScan
