// ─── builderCore.js ───────────────────────────────────────────────────────────
// High-level builder bot logic.  Consumes the parsed block list from liteParser
// and places every block in the world, bottom-up, with:
//   • Human-like delays + small random jitter between placements
//   • Chest refills: if the inventory runs low mid-build, the bot walks to
//     the nearest chest that has the required item and withdraws it.
//   • Safe clearing: blocks already at a target position are broken FIRST,
//     always equipping the best available pickaxe beforehand.  Chests are
//     NEVER broken.
//   • Automatic build-origin selection: scan from the bot outward in a
//     spiral; pick the nearest flat ground-level position whose XZ footprint
//     does not overlap any chest in the area.
//
// Public API
//   buildSchematic(bot, schematicBlocks, opts) → Promise<void>
//   findBuildOrigin(bot, bounds, opts)         → Promise<Vec3>
//   scanNearbyChests(bot, radius)              → Promise<Set<string>>

'use strict'
const Vec3 = require('vec3')
const pf   = require('mineflayer-pathfinder')

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function jitter(baseMs, rangeMs = 80) {
  return baseMs + Math.floor(Math.random() * rangeMs)
}

function posKey(pos) { return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}` }

function log(bot, msg) {
  bot.log?.info(`[BUILDER] ${msg}`) ?? console.log('[BUILDER]', msg)
}

// Passive blocks we never consider "in the way" when deciding whether to clear.
const PASSABLE = new Set([
  'air', 'cave_air', 'void_air', 'water', 'lava',
  'grass', 'short_grass', 'tall_grass', 'large_fern', 'fern',
  'snow', 'dead_bush', 'seagrass', 'tall_seagrass',
])

const CHEST_BLOCKS = new Set(['chest', 'trapped_chest', 'barrel', 'shulker_box',
  'white_shulker_box', 'orange_shulker_box', 'magenta_shulker_box',
  'light_blue_shulker_box', 'yellow_shulker_box', 'lime_shulker_box',
  'pink_shulker_box', 'gray_shulker_box', 'light_gray_shulker_box',
  'cyan_shulker_box', 'purple_shulker_box', 'blue_shulker_box',
  'brown_shulker_box', 'green_shulker_box', 'red_shulker_box', 'black_shulker_box',
])

// ── Navigation helpers ────────────────────────────────────────────────────────

async function goNear(bot, pos, distance = 3) {
  const movements = new pf.Movements(bot)
  bot.pathfinder.setMovements(movements)
  await bot.pathfinder.goto(new pf.goals.GoalNear(pos.x, pos.y, pos.z, distance))
}

// ── Tool selection ────────────────────────────────────────────────────────────

const PICKAXE_TIERS = [
  'netherite_pickaxe',
  'diamond_pickaxe',
  'iron_pickaxe',
  'stone_pickaxe',
  'wooden_pickaxe',
  'golden_pickaxe',
]

/**
 * Equip the best available pickaxe from inventory.
 * Returns true if one was found and equipped.
 */
async function equipBestPickaxe(bot) {
  for (const name of PICKAXE_TIERS) {
    const item = bot.inventory.findInventoryItem(name)
    if (item) {
      await bot.equip(item, 'hand')
      return true
    }
  }
  // Fall back to any pickaxe in inventory
  const any = bot.inventory.items().find(i => i.name.includes('pickaxe'))
  if (any) {
    await bot.equip(any, 'hand')
    return true
  }
  return false
}

// ── Chest scanning ────────────────────────────────────────────────────────────

/**
 * Find all chest-like blocks in a radius and return their position keys.
 * @returns {Promise<Set<string>>}
 */
async function scanNearbyChests(bot, radius = 48) {
  const positions = bot.findBlocks({
    matching: block => CHEST_BLOCKS.has(block.name),
    maxDistance: radius,
    count: 256,
  })
  const keys = new Set()
  for (const p of positions) keys.add(posKey(p))
  return keys
}

// ── Chest inventory helpers ───────────────────────────────────────────────────

/**
 * Count how many of `itemName` the bot currently has in its inventory.
 */
function inventoryCount(bot, itemName) {
  return bot.inventory.items()
    .filter(i => i.name === itemName)
    .reduce((sum, i) => sum + i.count, 0)
}

/**
 * Walk to the nearest chest that contains `itemName`, withdraw up to `needed`.
 * Iterates all nearby chests until `needed` is fulfilled or all chests exhausted.
 * @returns {Promise<number>} items actually withdrawn
 */
async function withdrawFromChests(bot, itemName, needed, radius = 48) {
  if (needed <= 0) return 0

  const positions = bot.findBlocks({
    matching: block => CHEST_BLOCKS.has(block.name),
    maxDistance: radius,
    count: 256,
  })

  let withdrawn = 0

  for (const chestPos of positions) {
    if (withdrawn >= needed) break

    const chestBlock = bot.blockAt(chestPos)
    if (!chestBlock) continue

    try {
      await goNear(bot, chestPos, 3)
      const container = await bot.openContainer(chestBlock)

      const matching = container.containerItems().filter(i => i.name === itemName)
      for (const slot of matching) {
        if (withdrawn >= needed) break
        const take = Math.min(slot.count, needed - withdrawn)
        await container.withdraw(slot.type, null, take)
        withdrawn += take
        await sleep(120)
      }

      await container.close()
      await sleep(200)
    } catch (err) {
      log(bot, `  chest at ${posKey(chestPos)}: ${err.message}`)
    }
  }

  return withdrawn
}

// ── Build-origin selection ────────────────────────────────────────────────────

/**
 * Spiral-search outward from the bot's position and return the nearest Vec3
 * ground-level origin where the schematic's XZ footprint does not overlap
 * any known chest block.
 *
 * @param {object}   bounds    result of liteParser.getBounds()
 * @param {Set}      chestKeys set of posKey strings from scanNearbyChests()
 * @param {object}   opts
 * @param {number}   opts.searchRadius  how far to look (default 32)
 * @returns {Promise<Vec3>}
 */
async function findBuildOrigin(bot, bounds, chestKeys, opts = {}) {
  const searchRadius = opts.searchRadius ?? 32
  const botPos       = bot.entity.position
  const bx           = Math.floor(botPos.x)
  const bz           = Math.floor(botPos.z)

  const W = bounds.width    // schematic X footprint
  const D = bounds.depth    // schematic Z footprint

  // Spiral outward from bot's XZ
  for (let ring = 0; ring <= searchRadius; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dz = -ring; dz <= ring; dz++) {
        if (Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue  // only ring perimeter

        const ox = bx + dx
        const oz = bz + dz

        // Find ground Y at this XZ (walk down from bot Y + 10 looking for solid)
        let gy = null
        for (let dy = 10; dy >= -10; dy--) {
          const testY  = Math.floor(botPos.y) + dy
          const below  = bot.blockAt(new Vec3(ox, testY - 1, oz))
          const at     = bot.blockAt(new Vec3(ox, testY, oz))
          if (below && !PASSABLE.has(below.name) && at && PASSABLE.has(at.name)) {
            gy = testY
            break
          }
        }
        if (gy === null) continue

        // Check that no chest overlaps this candidate footprint
        let hasChest = false
        outer: for (let fx = 0; fx < W; fx++) {
          for (let fz = 0; fz < D; fz++) {
            // Check several Y levels (schematic could be tall)
            for (let fy = 0; fy < bounds.height + 4; fy++) {
              if (chestKeys.has(posKey({ x: ox + fx, y: gy + fy, z: oz + fz }))) {
                hasChest = true
                break outer
              }
            }
          }
        }
        if (!hasChest) {
          log(bot, `Build origin selected: (${ox}, ${gy}, ${oz})  [ring=${ring}]`)
          return new Vec3(ox, gy, oz)
        }
      }
    }
  }

  // Fallback: just use bot position
  log(bot, 'No clear build origin found — falling back to bot position.')
  return new Vec3(bx, Math.floor(botPos.y), bz)
}

// ── Block clearing ────────────────────────────────────────────────────────────

/**
 * Clear whatever is at worldPos so a new block can be placed there.
 * - Skips air / passable blocks (nothing to do).
 * - Skips chests — never breaks storage.
 * - Equips the best pickaxe before digging.
 */
async function clearBuildBlock(bot, worldPos, chestKeys) {
  const block = bot.blockAt(worldPos)
  if (!block || PASSABLE.has(block.name)) return true   // nothing to clear

  if (CHEST_BLOCKS.has(block.name) || chestKeys.has(posKey(worldPos))) {
    log(bot, `  skipping clear at ${posKey(worldPos)} — chest/storage block`)
    return false
  }

  // Equip pickaxe before digging (like Mindcraft)
  const hadPickaxe = await equipBestPickaxe(bot)
  if (!hadPickaxe) {
    // Try with whatever is in hand
    log(bot, `  no pickaxe found, attempting to dig ${block.name} bare-handed`)
  }

  // Navigate within reach
  const dist = bot.entity.position.distanceTo(worldPos)
  if (dist > 4.5) await goNear(bot, worldPos, 4)

  try {
    await bot.dig(block, true)
    await sleep(150)
    return true
  } catch (err) {
    log(bot, `  failed to dig ${block.name} at ${posKey(worldPos)}: ${err.message}`)
    return false
  }
}

// ── Block placement ───────────────────────────────────────────────────────────

// Side face vectors for finding a support block to build off of
const FACE_VECS = [
  new Vec3(0, -1, 0),   // bottom — preferred for most blocks
  new Vec3(0,  1, 0),   // top
  new Vec3(-1, 0, 0),   // west
  new Vec3( 1, 0, 0),   // east
  new Vec3( 0, 0, -1),  // north
  new Vec3( 0, 0,  1),  // south
]

/**
 * Place `blockName` at `worldPos`.
 * Navigates into range, finds an adjacent support block, equips the item, places.
 * Returns true on success.
 */
async function placeOneBlock(bot, blockName, worldPos) {
  // Make sure target is clear first (handled by caller, but double-check)
  const existing = bot.blockAt(worldPos)
  if (existing && existing.name === blockName.split('[')[0]) return true  // already placed

  // Find a non-air adjacent block to build off of
  let buildOffBlock = null
  let buildFaceVec  = null

  for (const fv of FACE_VECS) {
    const adj = bot.blockAt(worldPos.plus(fv))
    if (adj && !PASSABLE.has(adj.name)) {
      buildOffBlock = adj
      buildFaceVec  = new Vec3(-fv.x, -fv.y, -fv.z)  // invert: face pointing back
      break
    }
  }

  if (!buildOffBlock) {
    log(bot, `  no support found adjacent to ${posKey(worldPos)} for ${blockName}`)
    return false
  }

  // Navigate: must be 1–4.5 blocks away
  const targetPos = worldPos
  const botPos    = bot.entity.position
  if (botPos.distanceTo(targetPos) < 1.2) {
    // Too close — move away slightly
    const invGoal = new pf.goals.GoalInvert(new pf.goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2))
    await bot.pathfinder.goto(invGoal)
  }
  if (bot.entity.position.distanceTo(targetPos) > 4.5) {
    await goNear(bot, targetPos, 4)
  }

  // Equip item
  const item = bot.inventory.findInventoryItem(blockName)
  if (!item) {
    log(bot, `  no ${blockName} in inventory when trying to place`)
    return false
  }
  await bot.equip(item, 'hand')

  // Look at the support block face and place
  try {
    await bot.lookAt(buildOffBlock.position.offset(0.5, 0.5, 0.5))
    await bot.placeBlock(buildOffBlock, buildFaceVec)
    return true
  } catch (err) {
    log(bot, `  placeBlock ${blockName} at ${posKey(worldPos)}: ${err.message}`)
    return false
  }
}

// ── Main build loop ───────────────────────────────────────────────────────────

/**
 * Build a schematic from a parsed block list.
 *
 * @param {object} bot             Mineflayer bot
 * @param {{pos:{x,y,z}, blockName:string}[]} schematicBlocks  from parseLitematic()
 * @param {object} opts
 * @param {Vec3}   opts.origin     world-space Vec3 to offset schematic (0,0,0) to
 * @param {number} opts.placeDelayMs       base delay between placements (default 250)
 * @param {number} opts.chestSearchRadius  how far to look for chests (default 48)
 * @param {number} opts.refillThreshold    refill when below this count (default 8)
 * @param {number} opts.refillTarget       how many to withdraw per refill (default 64)
 */
async function buildSchematic(bot, schematicBlocks, opts = {}) {
  const origin          = opts.origin           ?? bot.entity.position.clone()
  const placeDelayMs    = opts.placeDelayMs     ?? 250
  const chestRadius     = opts.chestSearchRadius ?? 48
  const refillThreshold = opts.refillThreshold  ?? 8
  const refillTarget    = opts.refillTarget     ?? 64

  const chestKeys = await scanNearbyChests(bot, chestRadius)
  log(bot, `Found ${chestKeys.size} chest(s) within ${chestRadius} blocks.`)

  const total   = schematicBlocks.length
  let   placed  = 0
  let   skipped = 0
  let   cleared = 0

  log(bot, `Starting build: ${total} blocks, origin ${posKey(origin)}`)

  for (let i = 0; i < schematicBlocks.length; i++) {
    if (bot._quitting) {
      log(bot, 'Bot disconnecting — aborting build.')
      break
    }

    const { pos, blockName } = schematicBlocks[i]
    const worldPos = new Vec3(
      origin.x + pos.x,
      origin.y + pos.y,
      origin.z + pos.z,
    )

    // ── 1. Skip if block is already correct ───────────────────────────────
    const existing = bot.blockAt(worldPos)
    const baseName = existing?.name ?? 'air'
    if (baseName === blockName) {
      skipped++
      continue
    }

    // ── 2. Inventory check + chest refill ─────────────────────────────────
    const inInv = inventoryCount(bot, blockName)
    if (inInv < refillThreshold) {
      const needed = refillTarget - inInv
      log(bot, `Low on ${blockName} (${inInv}), withdrawing ${needed} from chests…`)
      const got = await withdrawFromChests(bot, blockName, needed, chestRadius)
      if (got === 0 && inInv === 0) {
        log(bot, `  no ${blockName} available — skipping block at ${posKey(worldPos)}`)
        skipped++
        continue
      }
    }

    // ── 3. Clear existing block if needed ─────────────────────────────────
    if (!PASSABLE.has(baseName)) {
      log(bot, `  clearing ${baseName} at ${posKey(worldPos)}`)
      const ok = await clearBuildBlock(bot, worldPos, chestKeys)
      if (!ok) { skipped++; continue }
      cleared++
    }

    // ── 4. Place the block ────────────────────────────────────────────────
    const ok = await placeOneBlock(bot, blockName, worldPos)
    if (ok) {
      placed++
      if (placed % 25 === 0) {
        log(bot, `Progress: ${placed}/${total} placed, ${skipped} skipped, ${cleared} cleared`)
      }
    } else {
      skipped++
    }

    // ── 5. Human-like delay ───────────────────────────────────────────────
    await sleep(jitter(placeDelayMs, 120))
  }

  log(bot, `Build complete: ${placed} placed, ${cleared} cleared, ${skipped} skipped out of ${total} total.`)
}

module.exports = {
  buildSchematic,
  findBuildOrigin,
  scanNearbyChests,
  equipBestPickaxe,
  withdrawFromChests,
  inventoryCount,
}
