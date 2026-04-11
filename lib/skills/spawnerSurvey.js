const world = require('../world')
const skills = require('../skills')   // resolves to lib/skills.js (Node prefers .js over directory)
const { openSpawnerWindow } = require('./spawnerWindow')

// DonutSMP stacked-spawner default ammo types.
// Skeleton spawners consume bones; some variants use arrows.
// Pass `ammoItems` in options to override for other mob types.
const DEFAULT_AMMO_ITEMS = ['bone', 'arrow']

// bot.activateBlock() requires the bot to be within this many blocks.
const ACTIVATE_RANGE = 3

// ── getSpawnerInfo ─────────────────────────────────────────────────────────────
// Active interaction: right-clicks the spawner block, waits for the DonutSMP
// plugin to open a window, then reads the stack count from the NBT title and
// the ammo item counts from the container slots.  Closes the window before
// returning.
//
// This lives in skills/ — NOT world.js — because it sends packets to the server
// (bot.activateBlock → player_block_placement OUT, waits for open_window IN).
// world.js only does passive, already-loaded-chunk reads.
//
// The bot must already be within ~4.5 blocks of the block (activateBlock range).
// Call skills.goToPosition() first if needed — see surveySpawners() below.
//
// @param  {Bot}      bot
// @param  {Block}    block        spawner block from world.getNearestBlock() etc.
// @param  {string[]} ammoItems    item names to tally in container slots
//                                 default: DEFAULT_AMMO_ITEMS ['bone','arrow']
// @param  {number}   timeoutMs    ms to wait for windowOpen (default 5000)
// @returns {Promise<{ stackCount:number|null, ammo:Object<string,number> } | null>}
//           null if the windowOpen event never fired within timeoutMs
async function getSpawnerInfo(bot, block, ammoItems = DEFAULT_AMMO_ITEMS, timeoutMs = 5000) {
    let win
    try {
        win = await openSpawnerWindow(bot, block, timeoutMs)
    } catch {
        return null
    }

    // Stack count from DonutSMP window title.
    // Title shape (prismarine-nbt compound):
    //   { type:'compound', value:{ text:{ type:'string', value:'N MOB spawners' }, ... } }
    let text = ''
    const t = win.title
    if (t && typeof t === 'object' && t.value) {
        text = t.value?.text?.value ?? ''
    } else if (typeof t === 'string') {
        try { text = JSON.parse(t).text ?? t } catch { text = t }
    }
    const stackMatch = text.match(/^(\d+)/)
    const stackCount = stackMatch ? parseInt(stackMatch[1], 10) : null

    // Ammo counts — use containerItems() so player-inventory slots are excluded,
    // falling back to win.slots if the method is absent on this window type.
    const ammo = {}
    for (const name of ammoItems) ammo[name] = 0
    const containerSlots = typeof win.containerItems === 'function'
        ? win.containerItems()
        : (win.slots || [])
    for (const slot of containerSlots) {
        if (!slot || !slot.name) continue
        if (Object.prototype.hasOwnProperty.call(ammo, slot.name)) {
            ammo[slot.name] += slot.count
        }
    }

    bot.closeWindow(win)
    return { stackCount, ammo }
}

// ── surveySpawners ─────────────────────────────────────────────────────────────
// Surveys every spawner within `radius` blocks:
//   1. Finds all spawner blocks with world.getNearestBlocks.
//   2. Navigates to each one with skills.goToPosition.
//   3. Opens its GUI with getSpawnerInfo to read stack count + ammo.
//   4. Logs a per-spawner line and a totals summary.
//
// Returns a structured result array so the calling action can react to the
// data (e.g. decide whether to sweep based on total stack count).
//
// @param {Bot}    bot
// @param {object} [options]
// @param {number}   [options.radius=64]             search radius in blocks
// @param {string[]} [options.ammoItems]             item names to count per spawner
// @param {number}   [options.timeoutMs=5000]        windowOpen timeout per spawner (ms)
// @param {number}   [options.approachDistance=3]    stop-distance when navigating (blocks)
//
// @returns {Promise<Array<{
//   block:      Block,
//   pos:        Vec3,
//   distAtScan: number,
//   stackCount: number|null,
//   ammo:       Object<string,number>|null
// }>>}
async function surveySpawners(bot, options = {}) {
    const {
        radius = 64,
        ammoItems = DEFAULT_AMMO_ITEMS,
        timeoutMs = 5000,
        approachDistance = ACTIVATE_RANGE,
    } = options

    const blocks = world.getNearestBlocks(bot, ['spawner'], radius)

    if (blocks.length === 0) {
        bot.log.info(`[SURVEY] No spawners found within ${radius} blocks.`)
        return []
    }

    bot.log.info(`[SURVEY] Found ${blocks.length} spawner position(s) within ${radius} blocks — surveying...`)

    const results = []

    for (const block of blocks) {
        const pos = block.position
        // Capture distance before we move so the log reflects the original layout.
        const distAtScan = Math.round(bot.entity.position.distanceTo(pos) * 10) / 10

        await skills.goToPosition(bot, pos.x, pos.y, pos.z, approachDistance)

        const info = await getSpawnerInfo(bot, block, ammoItems, timeoutMs)

        const entry = {
            block,
            pos,
            distAtScan,
            stackCount: info ? info.stackCount : null,
            ammo: info ? info.ammo : null,
        }
        results.push(entry)

        const stackStr = entry.stackCount != null
            ? `stacks:${entry.stackCount}`
            : 'stacks:?'
        const ammoStr = entry.ammo
            ? ammoItems.map(n => `${n}:${entry.ammo[n] ?? 0}`).join(' ')
            : 'ammo:?'
        bot.log.info(`[SURVEY]   (${pos.x},${pos.y},${pos.z}) dist:${distAtScan}m ${stackStr} ${ammoStr}`)
    }

    // ── Totals ────────────────────────────────────────────────────────────────
    const totalStacks = results.reduce((s, r) => s + (r.stackCount ?? 0), 0)
    const totalAmmo = {}
    for (const name of ammoItems) {
        totalAmmo[name] = results.reduce((s, r) => s + (r.ammo?.[name] ?? 0), 0)
    }
    const ammoSummary = ammoItems.map(n => `total_${n}:${totalAmmo[n]}`).join(' | ')

    bot.log.info(
        `[SURVEY] ─── Summary: ${results.length} position(s) | ` +
        `total_stacks:${totalStacks} | ${ammoSummary}`
    )

    return results
}

module.exports = { getSpawnerInfo, surveySpawners, DEFAULT_AMMO_ITEMS }
