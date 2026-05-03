// ─── liteParser.js ────────────────────────────────────────────────────────────
// Pure-CJS litematic parser built on prismarine-nbt + zlib.
// Avoids the ESM-only @kleppe/litematic-reader package entirely.
//
// Public API
//   parseLitematic(filePath)  → Promise<BlockEntry[]>   sorted bottom-up by Y
//   getBounds(blocks)         → { minX, minY, minZ, maxX, maxY, maxZ,
//                                 width, height, depth }
//
// BlockEntry: { pos: {x,y,z}, blockName: string, blockState: string }
//   pos       – relative to schematic origin (0,0,0)
//   blockName – item name usable for inventory lookup (e.g. "oak_log")
//   blockState – full MC id with properties (e.g. "minecraft:oak_log[axis=y]")

'use strict'
const fs   = require('fs/promises')
const zlib = require('zlib')
const { promisify } = require('util')
const nbt  = require('prismarine-nbt')

const gunzip   = promisify(zlib.gunzip)
const parseNbt = promisify(nbt.parse)

// ── Block names that are not physical items (skip them during build) ──────────
const SKIP_BLOCKS = new Set([
  'minecraft:air',
  'minecraft:cave_air',
  'minecraft:void_air',
  'minecraft:piston_head',
  'minecraft:moving_piston',
  'minecraft:nether_portal',
  'minecraft:end_portal',
  'minecraft:end_gateway',
  'minecraft:fire',
  'minecraft:soul_fire',
  'minecraft:bubble_column',
])

// ── Block-name → item-name overrides (block placed != item in inventory) ──────
const BLOCK_TO_ITEM = {
  redstone_wire:              'redstone',
  wall_torch:                 'torch',
  soul_wall_torch:            'soul_torch',
  water:                      'water_bucket',
  lava:                       'lava_bucket',
  farmland:                   'dirt',
  dirt_path:                  'dirt',
  grass_path:                 'dirt',
  kelp_plant:                 'kelp',
  bamboo_sapling:             'bamboo',
  beetroots:                  'beetroot_seeds',
  carrots:                    'carrot',
  potatoes:                   'potato',
  cocoa:                      'cocoa_beans',
  melon_stem:                 'melon_seeds',
  attached_melon_stem:        'melon_seeds',
  pumpkin_stem:               'pumpkin_seeds',
  attached_pumpkin_stem:      'pumpkin_seeds',
  sweet_berry_bush:           'sweet_berries',
  wheat:                      'wheat_seeds',
  cave_vines:                 'glow_berries',
  cave_vines_plant:           'glow_berries',
  twisting_vines_plant:       'twisting_vines',
  weeping_vines_plant:        'weeping_vines',
  // Wall signs map to matching hanging sign items
  oak_wall_sign:              'oak_sign',
  spruce_wall_sign:           'spruce_sign',
  birch_wall_sign:            'birch_sign',
  jungle_wall_sign:           'jungle_sign',
  acacia_wall_sign:           'acacia_sign',
  dark_oak_wall_sign:         'dark_oak_sign',
  mangrove_wall_sign:         'mangrove_sign',
  cherry_wall_sign:           'cherry_sign',
  bamboo_wall_sign:           'bamboo_sign',
  crimson_wall_sign:          'crimson_sign',
  warped_wall_sign:           'warped_sign',
  // Hanging wall signs
  oak_wall_hanging_sign:      'oak_hanging_sign',
  spruce_wall_hanging_sign:   'spruce_hanging_sign',
  birch_wall_hanging_sign:    'birch_hanging_sign',
  jungle_wall_hanging_sign:   'jungle_hanging_sign',
  acacia_wall_hanging_sign:   'acacia_hanging_sign',
  dark_oak_wall_hanging_sign: 'dark_oak_hanging_sign',
  mangrove_wall_hanging_sign: 'mangrove_hanging_sign',
  cherry_wall_hanging_sign:   'cherry_hanging_sign',
  bamboo_wall_hanging_sign:   'bamboo_hanging_sign',
  crimson_wall_hanging_sign:  'crimson_hanging_sign',
  warped_wall_hanging_sign:   'warped_hanging_sign',
}

// ── Bit extraction from litematic's tightly-packed long array ─────────────────
// prismarine-nbt returns each long as an object whose .valueOf() is a BigInt.
// Litematic uses tightly-packed encoding: items CAN straddle consecutive longs.
function getPaletteIndex(blockStates, bitsPerItem, blockIdx) {
  const bitIdx  = blockIdx * bitsPerItem
  const longIdx = Math.floor(bitIdx / 64)
  const bitOff  = bitIdx % 64
  const mask    = (1n << BigInt(bitsPerItem)) - 1n

  const long0   = BigInt(blockStates[longIdx].valueOf())

  if (bitOff + bitsPerItem <= 64) {
    return Number((long0 >> BigInt(bitOff)) & mask)
  }

  // Straddles into the next long
  const long1   = longIdx + 1 < blockStates.length
    ? BigInt(blockStates[longIdx + 1].valueOf())
    : 0n
  const combined = (long1 << 64n) | long0
  return Number((combined >> BigInt(bitOff)) & mask)
}

// ── Internal region parser ─────────────────────────────────────────────────────
function parseRegion(region, allBlocks) {
  const palRaw = region.BlockStatePalette.value.value    // array of NBT compounds
  const bs     = region.BlockStates.value                // array of long-like objects
  const sz     = region.Size.value
  const pos    = region.Position.value

  const sX = sz.x.value
  const sY = sz.y.value
  const sZ = sz.z.value

  // Size may be negative (the region can be defined in either direction).
  // rx/ry/rz is the "low corner" in each axis.
  const rx = pos.x.value + (sX < 0 ? sX + 1 : 0)
  const ry = pos.y.value + (sY < 0 ? sY + 1 : 0)
  const rz = pos.z.value + (sZ < 0 ? sZ + 1 : 0)
  const absX = Math.abs(sX)
  const absY = Math.abs(sY)
  const absZ = Math.abs(sZ)

  // Build a palette array of { blockState, blockName } objects
  const palette = palRaw.map(entry => {
    const name  = entry.Name.value                    // "minecraft:stone"
    const props = entry.Properties?.value || {}

    // Build sorted property string so it's deterministic
    const propStr = Object.keys(props).sort()
      .map(k => `${k}=${props[k].value}`)
      .join(',')
    const blockState = propStr ? `${name}[${propStr}]` : name

    // Derive placeable item name
    const stripped = name.replace(/^minecraft:/, '')    // "stone"
    const blockName = BLOCK_TO_ITEM.hasOwnProperty(stripped)
      ? BLOCK_TO_ITEM[stripped]
      : stripped

    return { blockState, blockName, skip: SKIP_BLOCKS.has(name) || blockName === null }
  })

  const bitsPerItem = Math.max(2, Math.ceil(Math.log2(palette.length || 1)))
  let blockIdx = 0

  for (let y = 0; y < absY; y++) {
    for (let z = 0; z < absZ; z++) {
      for (let x = 0; x < absX; x++, blockIdx++) {
        const pi    = getPaletteIndex(bs, bitsPerItem, blockIdx)
        const entry = palette[pi]
        if (!entry || entry.skip) continue

        allBlocks.push({
          pos:        { x: rx + x, y: ry + y, z: rz + z },
          blockName:  entry.blockName,
          blockState: entry.blockState,
        })
      }
    }
  }
}

// ── Public: parse a .litematic file ───────────────────────────────────────────
/**
 * Parse a .litematic file and return all non-air blocks sorted bottom-up.
 *
 * @param {string} filePath  Absolute or cwd-relative path to the .litematic file.
 * @returns {Promise<{pos:{x,y,z}, blockName:string, blockState:string}[]>}
 */
async function parseLitematic(filePath) {
  const compressed = await fs.readFile(filePath)
  const raw        = await gunzip(compressed)
  const parsed     = await parseNbt(raw)

  const regionsMap = parsed.value.Regions?.value
  if (!regionsMap) throw new Error('parseLitematic: no Regions tag found')

  const allBlocks = []
  for (const regionName of Object.keys(regionsMap)) {
    parseRegion(regionsMap[regionName].value, allBlocks)
  }

  // Sort bottom-up: place floors before walls, walls before ceilings.
  allBlocks.sort((a, b) => a.pos.y - b.pos.y)
  return allBlocks
}

// ── Public: bounding box ───────────────────────────────────────────────────────
/**
 * Return the axis-aligned bounding box of the block set.
 * @param {{pos:{x,y,z}}[]} blocks
 */
function getBounds(blocks) {
  let minX = Infinity,  minY = Infinity,  minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const { pos } of blocks) {
    if (pos.x < minX) minX = pos.x
    if (pos.y < minY) minY = pos.y
    if (pos.z < minZ) minZ = pos.z
    if (pos.x > maxX) maxX = pos.x
    if (pos.y > maxY) maxY = pos.y
    if (pos.z > maxZ) maxZ = pos.z
  }
  return {
    minX, minY, minZ,
    maxX, maxY, maxZ,
    width:  maxX - minX + 1,
    height: maxY - minY + 1,
    depth:  maxZ - minZ + 1,
  }
}

/**
 * Return a { blockName → count } tally of all non-air schematic blocks.
 * Useful for logging a materials list before building.
 * @param {{blockName:string}[]} blocks
 * @returns {Record<string,number>}
 */
function materialList(blocks) {
  const tally = {}
  for (const { blockName } of blocks) {
    tally[blockName] = (tally[blockName] ?? 0) + 1
  }
  return tally
}

module.exports = { parseLitematic, getBounds, materialList }
