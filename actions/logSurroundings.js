// Action: logSurroundings
//
// Scans for specific block types nearby and logs their positions and distances.
// On every call after the first it diffs against the previous scan and reports
// what appeared or disappeared — useful for tracking spawner counts over time.
//
// Options:
//   blocks  — array of block names to scan for (default: ['spawner'])
//   radius  — search radius in blocks       (default: 64)
//
// State: stored on bot._surroundingsState keyed by scan config, so multiple
// logSurroundings actions with different configs coexist without collision.
// State resets on reconnect (bot object is recreated) — that's intentional;
// after reconnect you want a fresh baseline.

const world = require('../lib/world')

// Stable key for this scan config — used to isolate state per action instance.
function stateKey(blocks, radius) {
  return `${[...blocks].sort().join('+')}@${radius}`
}

// Compact position string for logging.
function fmtPos(pos) {
  return `(${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`
}

// Plain-object snapshot of a block (no Vec3 reference, safe to store).
function snapshot(block, dist) {
  return { name: block.name, x: Math.round(block.position.x), y: Math.round(block.position.y), z: Math.round(block.position.z), dist: +dist.toFixed(1) }
}

function posId(entry) {
  return `${entry.x},${entry.y},${entry.z}`
}

async function logSurroundings(bot, options) {
  const blocks = options.blocks ?? ['spawner']
  const radius = options.radius ?? 64
  const key    = stateKey(blocks, radius)

  // ── Scan ────────────────────────────────────────────────────────────────────
  const botPos  = bot.entity?.position
  const rawBlocks = world.getNearestBlocks(bot, blocks, radius, 10000)

  const found = rawBlocks
    .map(b => snapshot(b, botPos ? botPos.distanceTo(b.position) : 0))
    .sort((a, b) => a.dist - b.dist)

  // ── Log current state ────────────────────────────────────────────────────────
  const label = blocks.join('+')
  bot.log.info(`[SURROUNDINGS] ${label} scan — ${found.length} found within ${radius} blocks`)
  for (const b of found) {
    bot.log.info(`[SURROUNDINGS]   ${b.name} @ ${fmtPos(b)} | dist: ${b.dist}`)
  }

  // ── Diff against last scan ──────────────────────────────────────────────────
  const prev = bot._surroundingsState?.[key]

  if (!prev) {
    bot.log.info('[SURROUNDINGS] First scan — baseline recorded')
  } else {
    const prevIds    = new Set(prev.map(posId))
    const currentIds = new Set(found.map(posId))

    const added   = found.filter(b => !prevIds.has(posId(b)))
    const removed = prev.filter(b => !currentIds.has(posId(b)))

    if (added.length === 0 && removed.length === 0) {
      bot.log.info('[SURROUNDINGS] Changes since last scan: none')
    } else {
      bot.log.info(`[SURROUNDINGS] Changes since last scan: +${added.length} appeared, -${removed.length} removed`)
      for (const b of added)   bot.log.info(`[SURROUNDINGS]   + appeared: ${b.name} @ ${fmtPos(b)}`)
      for (const b of removed) bot.log.info(`[SURROUNDINGS]   - removed:  ${b.name} @ ${fmtPos(b)}`)
    }
  }

  // ── Persist state ───────────────────────────────────────────────────────────
  if (!bot._surroundingsState) bot._surroundingsState = {}
  bot._surroundingsState[key] = found
}

module.exports = logSurroundings
