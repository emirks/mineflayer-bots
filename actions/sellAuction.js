// ── sellAuction — action wrapper for auctionSellAll ───────────────────────────
//
// Thin action wrapper: reads options from the profile, delegates entirely to
// the auctionSell skill.  The skill owns all GUI logic and logging.
//
// Options (all optional — auctionSellAll supplies defaults):
//   itemName        {string}  'redstone'        Minecraft item ID
//   searchTerm      {string}  'redstone dust'   /ah <searchTerm> argument
//   decrementAmount {number}  10                $ to undercut the lowest price by
//   winTimeoutMs    {number}  8000              ms to wait for each GUI window
//   clickDelayMs    {number}  600               settle delay after GUI clicks
//   fillDelayMs     {number}  200               delay between inventory-move clicks
//   sellIntervalMs  {number}  800               delay between successive /ah sell cmds
//   timeoutMs       {number}  (action-level cap via executeActions race)

const { auctionSellAll } = require('../lib/skills/auctionSell')

module.exports = async function sellAuction(bot, opts) {
    const result = await auctionSellAll(bot, opts)
    bot.log.info(`[SELL-AUCTION] Finished: ${result.totalSold} listed in ${result.batches} batch${result.batches !== 1 ? 'es' : ''}`)
}
