const skills = require('../lib/skills')

// Walk to the nearest chest and withdraw the specified item.
// num: how many to take (-1 = all).
async function takeFromChest(bot, options) {
  const { itemName = 'bone', num = -1 } = options
  console.log(`[ACTION] Taking "${itemName}" from nearest chest (num=${num === -1 ? 'all' : num})...`)
  await skills.takeFromChest(bot, itemName, num)
}

module.exports = takeFromChest
