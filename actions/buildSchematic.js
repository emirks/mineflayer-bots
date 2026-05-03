// ─── Action: buildSchematic ───────────────────────────────────────────────────
// Reads a .litematic file, finds the best build origin near the bot (avoiding
// chests), then places every block bottom-up with chest refills and safe
// block-clearing.
//
// Options (all optional except schematicFile):
//   schematicFile       (required) path to the .litematic file
//   placeDelayMs        base ms between placements         (default 250)
//   chestSearchRadius   radius to scan for chests/storage  (default 48)
//   originSearchRadius  radius to search for build origin  (default 32)
//   refillThreshold     refill inventory below this count  (default 8)
//   refillTarget        withdraw this many items per refill (default 64)

'use strict'
const path = require('path')
const { parseLitematic, getBounds, materialList } = require('../lib/skills/liteParser')
const { buildSchematic, findBuildOrigin, scanNearbyChests } = require('../lib/skills/builderCore')

async function buildSchematicAction(bot, opts = {}) {
  const { schematicFile } = opts
  if (!schematicFile) throw new Error('buildSchematic: opts.schematicFile is required')

  const filePath = path.isAbsolute(schematicFile)
    ? schematicFile
    : path.resolve(process.cwd(), schematicFile)

  bot.log.info(`[BUILD] Loading schematic: ${filePath}`)
  const blocks = await parseLitematic(filePath)
  bot.log.info(`[BUILD] Parsed ${blocks.length} non-air blocks`)

  // Log material requirements
  const mats = materialList(blocks)
  const SEP  = '[BUILD] ════════════════════════════════════════════'
  bot.log.info(SEP)
  bot.log.info('[BUILD] Materials needed:')
  for (const [name, count] of Object.entries(mats).sort((a, b) => b[1] - a[1])) {
    bot.log.info(`[BUILD]   ${name.padEnd(36)} ×${count}`)
  }
  bot.log.info(SEP)

  // Find build origin (avoiding chests)
  const bounds    = getBounds(blocks)
  const chestKeys = await scanNearbyChests(bot, opts.chestSearchRadius ?? 48)

  bot.log.info(`[BUILD] Schematic bounds: ${bounds.width}×${bounds.height}×${bounds.depth}`)
  bot.log.info(`[BUILD] Scanning for build origin (radius ${opts.originSearchRadius ?? 32})…`)

  const origin = await findBuildOrigin(bot, bounds, chestKeys, {
    searchRadius: opts.originSearchRadius ?? 32,
  })

  bot.log.info(`[BUILD] Origin: (${origin.x}, ${origin.y}, ${origin.z})`)
  bot.log.info(`[BUILD] Starting construction…`)

  await buildSchematic(bot, blocks, {
    origin,
    placeDelayMs:       opts.placeDelayMs       ?? 250,
    chestSearchRadius:  opts.chestSearchRadius   ?? 48,
    refillThreshold:    opts.refillThreshold     ?? 8,
    refillTarget:       opts.refillTarget        ?? 64,
  })

  bot.log.info('[BUILD] All done.')
}

module.exports = buildSchematicAction
