'use strict'

/**
 * Velocity packet normaliser — fixes NaN bot/entity position.
 *
 * Root cause (confirmed for 1.20.4–1.21.x; applies to every version where
 * entityVelocityIsLpVec3 is false — verified false for 1.20.4, 1.21.1,
 * 1.21.4, 1.21.11 via minecraft-data@3.109.0):
 *
 *   minecraft-data defines packet_entity_velocity as:
 *     [ "container", [{ name:"entityId", type:"varint" },
 *                     { name:"velocity", type:"vec3i16" }] ]
 *   Decoded packet → { entityId, velocity: { x, y, z } }   ← nested object
 *
 *   mineflayer/lib/plugins/entities.js else-branch reads:
 *     new Vec3(packet.velocityX, packet.velocityY, packet.velocityZ)
 *   Those fields don't exist → Vec3(undefined, undefined, undefined) → NaN.
 *
 *   Once any entity (including the bot's own) has NaN velocity, the physics
 *   engine propagates NaN into position on the next tick.
 *
 * Fix:
 *   Use prependListener on entity_velocity and spawn_entity so that our
 *   handler runs BEFORE mineflayer's entities plugin handler.
 *   We copy velocity.{x,y,z} onto packet.velocityX/Y/Z in-place; the
 *   existing handler then reads the right fields and passes them through
 *   fromNotchVelocity (÷8000) as intended.
 *
 *   The patch is defensive: it checks for the nested shape before copying,
 *   so if a future mineflayer version fixes the schema mismatch upstream,
 *   this patch becomes a harmless no-op.
 *
 *   vec3i16 scale: raw integer ÷ 8000 = blocks/tick
 *     -626 ÷ 8000 ≈ -0.078  (gravity)
 *     3360 ÷ 8000 =  0.42   (spawn bounce)
 *
 * Affected packets:
 *   entity_velocity — standalone velocity update
 *   spawn_entity    — includes initial velocity at spawn
 */
function applyVelocityPatch (bot) {
  function normalise (packet) {
    if (packet.velocity && typeof packet.velocity === 'object' &&
        !('velocityX' in packet)) {
      packet.velocityX = packet.velocity.x
      packet.velocityY = packet.velocity.y
      packet.velocityZ = packet.velocity.z
    }
  }

  bot._client.prependListener('entity_velocity', normalise)
  bot._client.prependListener('spawn_entity', normalise)

  bot.log.info('[PATCH] velocityPatch applied (entity_velocity + spawn_entity)')
}

module.exports = { applyVelocityPatch }
