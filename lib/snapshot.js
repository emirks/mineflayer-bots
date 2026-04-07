'use strict'

// ─── Snapshot builder ─────────────────────────────────────────────────────────
//
// buildSnapshot(bot) → plain object, safe to JSON.stringify immediately.
//
// All fields degrade gracefully (null / false / {}) if mineflayer hasn't
// received the relevant packets yet (e.g. chunk not loaded, mcdata not init).
// Never throws — all risky calls are wrapped in try/catch.
//
// Called once per second from createBotSession; no I/O inside.
//
// Output shape:
//   t            Unix ms timestamp
//   pos          {x,y,z}  1 dp
//   look         {yaw,pitch}  2 dp  (radians)
//   vel          {x,y,z}  3 dp  (blocks/tick)
//   health       0–20  1 dp
//   food         0–20
//   sat          0–20  1 dp
//   xp           {lvl, prog}
//   time         {ticks, phase}   phase: dawn|morning|afternoon|dusk|night
//   rain         boolean
//   gameMode     'survival'|'creative'|…
//   biome        string  (from minecraft-data; null until login)
//   heldItem     item name string | null
//   armor        {helmet, chestplate, leggings, boots}  name | null per slot
//   inv          {itemName: count}  non-zero slots only
//   surroundings {below, legs, head}  block names
//   players      [{name, dist}]  sorted asc; only players with loaded entities
//   entities     {typeName: count}  within 32 blocks, excluding self & players
//   nearbyBlocks [{name, pos:{x,y,z}, dist}]  nearest 20 non-air within 8 blocks

const world = require('./world')

// ── Rounding helpers ──────────────────────────────────────────────────────────
const r1 = n => Math.round(n * 10)    / 10     // 1 decimal place
const r2 = n => Math.round(n * 100)   / 100    // 2 decimal places
const r3 = n => Math.round(n * 1000)  / 1000   // 3 decimal places

// ── Time-of-day → human phase ─────────────────────────────────────────────────
// Minecraft day cycle: 0=sunrise, 6000=noon, 12000=sunset, 13000=night
function todPhase(ticks) {
  if (ticks <  1000) return 'dawn'
  if (ticks <  6000) return 'morning'
  if (ticks < 12000) return 'afternoon'
  if (ticks < 13000) return 'dusk'
  return 'night'
}

// ─── Main builder ─────────────────────────────────────────────────────────────
function buildSnapshot(bot) {
  const pos = bot.entity?.position

  // ── Time ──────────────────────────────────────────────────────────────────
  const tod = bot.time?.timeOfDay ?? 0

  // ── Inventory — non-zero counts grouped by item name ──────────────────────
  const inv = {}
  for (const slot of bot.inventory.slots) {
    if (slot?.name) inv[slot.name] = (inv[slot.name] || 0) + slot.count
  }

  // ── Armor — player inventory window slots 5–8 ────────────────────────────
  // Window 0 layout: 0=crafting out, 1-4=crafting, 5=helmet, 6=chest,
  //                  7=leggings, 8=boots, 9-35=main inv, 36-44=hotbar
  const armor = {
    helmet     : bot.inventory.slots[5]?.name ?? null,
    chestplate : bot.inventory.slots[6]?.name ?? null,
    leggings   : bot.inventory.slots[7]?.name ?? null,
    boots      : bot.inventory.slots[8]?.name ?? null,
  }

  // ── Nearby players — only those with a loaded entity (in render dist) ─────
  const players = []
  if (pos) {
    for (const [name, player] of Object.entries(bot.players)) {
      if (name === bot.username || !player.entity?.position) continue
      players.push({ name, dist: r1(player.entity.position.distanceTo(pos)) })
    }
    players.sort((a, b) => a.dist - b.dist)
  }

  // ── Nearby entities — type counts within 32 blocks (excl. self & players) ─
  const entities = {}
  if (pos) {
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity || !entity.position) continue
      if (entity.type === 'player') continue               // players tracked separately
      if (entity.position.distanceTo(pos) > 32) continue
      const key = entity.name || entity.type || 'unknown'
      entities[key] = (entities[key] || 0) + 1
    }
  }

  // ── Nearby blocks with positions — nearest 20 non-air within 8 blocks ─────
  // bot.findBlocks scans ~5 000 voxels (17³) — acceptable at 1/s
  const nearbyBlocks = []
  if (pos) {
    try {
      const positions = bot.findBlocks({ matching: id => id !== 0, maxDistance: 8, count: 20 })
      for (const bpos of positions) {
        const block = bot.blockAt(bpos)
        if (!block || block.name === 'air' || block.name === 'cave_air') continue
        nearbyBlocks.push({
          name : block.name,
          pos  : { x: bpos.x, y: bpos.y, z: bpos.z },
          dist : r1(bpos.distanceTo(pos)),
        })
      }
    } catch { /* chunk not yet loaded */ }
  }

  // ── Surrounding blocks (below / legs / head) ──────────────────────────────
  let surroundings = null
  if (pos) {
    try {
      surroundings = {
        below : world.getBlockAtPosition(bot, 0, -1, 0).name,
        legs  : world.getBlockAtPosition(bot, 0,  0, 0).name,
        head  : world.getBlockAtPosition(bot, 0,  1, 0).name,
      }
    } catch { /* chunk not loaded */ }
  }

  // ── Biome ─────────────────────────────────────────────────────────────────
  let biome = null
  try { biome = world.getBiomeName(bot) } catch { /* mcdata not ready or pos null */ }

  // ── Assemble ──────────────────────────────────────────────────────────────
  return {
    t     : Date.now(),
    pos   : pos ? { x: r1(pos.x), y: r1(pos.y), z: r1(pos.z) } : null,
    look  : {
      yaw   : r2(bot.entity?.yaw   ?? 0),
      pitch : r2(bot.entity?.pitch ?? 0),
    },
    vel   : bot.entity?.velocity ? {
      x : r3(bot.entity.velocity.x),
      y : r3(bot.entity.velocity.y),
      z : r3(bot.entity.velocity.z),
    } : null,
    health   : bot.health         != null ? r1(bot.health)            : null,
    food     : bot.food           ?? null,
    sat      : bot.foodSaturation != null ? r1(bot.foodSaturation)    : null,
    xp       : { lvl: bot.experience?.level ?? 0, prog: r2(bot.experience?.progress ?? 0) },
    time     : { ticks: tod, phase: todPhase(tod) },
    rain     : bot.isRaining      ?? false,
    gameMode : bot.game?.gameMode ?? null,
    biome,
    heldItem : bot.heldItem?.name ?? null,
    armor,
    inv,
    surroundings,
    players,
    entities,
    nearbyBlocks,
  }
}

module.exports = { buildSnapshot }
