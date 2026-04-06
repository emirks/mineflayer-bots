const skills = require('../lib/skills')

// Collect all nearby item entities on the ground within 8 blocks.
async function pickupItems(bot) {
  console.log('[ACTION] Picking up nearby items...')
  await skills.pickupNearbyItems(bot)
}

module.exports = pickupItems
