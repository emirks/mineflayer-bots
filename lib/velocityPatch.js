'use strict'

/**
 * Velocity packet normaliser — fixes NaN bot/entity position.
 *
 * Root cause (confirmed for 1.20.4, applies to any version where
 * entityVelocityIsLpVec3 is false):
 *
 *   minecraft-data defines entity_velocity as:
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

  console.log('[PATCH] velocityPatch applied (entity_velocity + spawn_entity)')
}

module.exports = { applyVelocityPatch }
