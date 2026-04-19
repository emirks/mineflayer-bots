// ── debugWindow — general-purpose window snapshot and logger ──────────────────
//
// Works with ANY mineflayer window object, regardless of how it was opened
// (block interaction, chat command, GUI navigation, etc.).
//
// This is the shared foundation used by:
//   debugSpawnerWindow.js  — spawner-specific debug (block interaction)
//   actions/debugTraderWindows.js — /shop and /order window dumps
//
// Exports:
//   parseTitle(win)                              → string          human-readable title text
//   snapshotWindow(win)                          → WindowSnapshot  all slot data as a plain object
//   logWindowSnapshot(bot, snap, header)         → void            dumps snapshot to bot.log
//   dumpWindowToFile(bot, win, label)            → void            writes full JSON to run dir
//   openChatCommandWindow(bot, cmd, timeoutMs)   → Promise<Window> sends a command, waits for GUI open
//
// WindowSnapshot: {
//   windowType, windowId, rawTitle, parsedTitle,
//   totalSlots, containerSlotCount,
//   containerItems, playerItems, totalsByType
// }
// SlotEntry: { slot, name, count, metadata, nbt }

const fs   = require('fs')
const path = require('path')
const { waitForWindowOpen }                   = require('./spawnerWindow')
const { getDisplayName, getLore, normalizeText } = require('./nbtParse')

const SEP  = '[WIN-DEBUG] ═══════════════════════════════════════════════════════'
const DASH = '[WIN-DEBUG] ───────────────────────────────────────────────────────'

// ── parseTitle ────────────────────────────────────────────────────────────────
// Extracts a plain string from a mineflayer window title.
//
// Handles all three formats the server can send:
//   { type:'string', value:'ѕʜᴏᴘ' }               prismarine-nbt plain string
//   { type:'compound', value:{ text:{...} } }       prismarine-nbt compound
//   '{"text":"Shop"}'                               vanilla MC JSON chat component string
function parseTitle(win) {
    const t = win.title
    if (!t) return ''

    if (typeof t === 'object') {
        // prismarine-nbt plain string: { type: 'string', value: '...' }
        if (t.type === 'string') return typeof t.value === 'string' ? t.value : ''

        // prismarine-nbt compound: { type: 'compound', value: { text: { type:'string', value:'...' } } }
        if (t.value) return t.value?.text?.value ?? ''
    }

    // vanilla JSON chat string: '{"text":"...", "extra":[...]}'
    if (typeof t === 'string') {
        try { return JSON.parse(t).text ?? t } catch { return t }
    }

    return ''
}

// ── snapshotWindow ────────────────────────────────────────────────────────────
// Reads all slot data from an open window into a plain serialisable object.
//
// Container boundary: win.inventoryStart (set by mineflayer's extendWindow for
// every custom window — e.g. 27 for generic_9x3, 54 for generic_9x6).
// Falls back to totalSlots - 36 for windows that don't have it yet.
//
// Safe to call immediately after windowOpen — no additional packets needed.
function snapshotWindow(win) {
    const allSlots           = win.slots || []
    const totalSlots         = allSlots.length
    // win.inventoryStart is the correct split point between container and player inventory.
    // Do NOT use win.containerItems().length — that returns only occupied slots, not the boundary.
    const containerSlotCount = win.inventoryStart ?? Math.max(0, totalSlots - 36)

    const containerItems = []
    const playerItems    = []
    const totalsByType   = {}

    allSlots.forEach((slot, idx) => {
        if (!slot || !slot.name) return

        // Build a human-readable label for the log: prefer resolved display name,
        // fall back to raw nbt excerpt for legacy pre-1.20.5 items that use old NBT.
        const displayName = getDisplayName(slot)
        const lorePeek    = getLore(slot).slice(0, 2).join(' | ')
        const nbtSummary  = displayName !== slot.name
            ? `"${displayName}"${lorePeek ? `  lore:${lorePeek}` : ''}`
            : (slot.nbt ? JSON.stringify(slot.nbt).slice(0, 80) : null)

        const entry = {
            slot:     idx,
            name:     slot.name,
            count:    slot.count,
            metadata: slot.metadata ?? 0,
            nbt:      nbtSummary,
        }
        totalsByType[slot.name] = (totalsByType[slot.name] ?? 0) + slot.count

        if (idx < containerSlotCount) containerItems.push(entry)
        else                          playerItems.push(entry)
    })

    return {
        windowType:         win.type ?? '(unknown)',
        windowId:           win.id   ?? '?',
        rawTitle:           JSON.stringify(win.title),
        parsedTitle:        parseTitle(win),
        totalSlots,
        containerSlotCount,
        containerItems,
        playerItems,
        totalsByType,
    }
}

// ── dumpWindowToFile ──────────────────────────────────────────────────────────
// Writes a full JSON file to the logger's run directory with:
//   • window metadata (type, id, title, slot boundary)
//   • every slot as a plain object with full raw NBT (the parsed prismarine-nbt tree)
//
// File is named  window_<label>.json  (spaces replaced with underscores).
// Requires bot.log.runDir to be set (done by createBotSession → createLogger).
function dumpWindowToFile(bot, win, label) {
    const runDir = bot.log?.runDir
    if (!runDir) {
        bot.log.warn('[WIN-DEBUG] bot.log.runDir not available — skipping file dump')
        return
    }

    const allSlots           = win.slots || []
    const containerSlotCount = win.inventoryStart ?? Math.max(0, allSlots.length - 36)

    const slots = allSlots.map((slot, idx) => {
        if (!slot || !slot.name) return null
        // Resolve display name + lore to plain strings.
        // In 1.20.5+ items carry no NBT (slot.nbt === null); names/lore are in
        // data components exposed via slot.customName / slot.customLore as
        // prismarine-nbt compound objects.  Writing those raw inflates files by
        // ~35×, so we resolve them through getDisplayName/getLore here.
        const resolvedName = getDisplayName(slot)
        const resolvedLore = getLore(slot)
        return {
            slot:       idx,
            name:       slot.name,
            count:      slot.count,
            metadata:   slot.metadata ?? 0,
            nbt:        slot.nbt ?? null,
            customName: resolvedName !== slot.name ? resolvedName : null,
            customLore: resolvedLore.length        ? resolvedLore : null,
        }
    })

    const payload = {
        label,
        windowType:         win.type ?? '(unknown)',
        windowId:           win.id   ?? '?',
        rawTitle:           win.title,
        parsedTitle:        parseTitle(win),
        totalSlots:         allSlots.length,
        containerSlotCount,
        slots,
    }

    const filename = `window_${label.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')}.json`
    const filepath = path.join(runDir, filename)

    try {
        fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf8')
        bot.log.info(`[WIN-DEBUG] Full window dump → ${filepath}`)
    } catch (err) {
        bot.log.warn(`[WIN-DEBUG] Failed to write window dump: ${err.message}`)
    }
}

// ── logWindowSnapshot ─────────────────────────────────────────────────────────
// Dumps a WindowSnapshot to bot.log.info in a structured, human-readable format:
//   • header line with window metadata
//   • every container slot (slot index, item name, count, metadata, NBT excerpt)
//   • every player-inventory slot in the same format
//   • totals-by-item-type table sorted descending by count
function logWindowSnapshot(bot, snap, header) {
    const { windowType, windowId, rawTitle, parsedTitle,
            totalSlots, containerSlotCount,
            containerItems, playerItems, totalsByType } = snap

    const typeEntries = Object.entries(totalsByType).sort((a, b) => b[1] - a[1])

    bot.log.info(SEP)
    bot.log.info(`[WIN-DEBUG] ${header}`)
    bot.log.info(`[WIN-DEBUG] type:"${windowType}"  id:${windowId}  total-slots:${totalSlots}  container-slots:${containerSlotCount}`)
    bot.log.info(`[WIN-DEBUG] Raw title  : ${rawTitle}`)
    bot.log.info(`[WIN-DEBUG] Title text : "${parsedTitle}"`)
    bot.log.info(DASH)

    bot.log.info(`[WIN-DEBUG] CONTAINER SLOTS  (${containerSlotCount} total, ${containerItems.length} occupied)`)
    if (containerItems.length === 0) {
        bot.log.info('[WIN-DEBUG]   (empty)')
    } else {
        for (const item of containerItems) {
            const nbtPart = item.nbt ? `  nbt:${item.nbt}` : ''
            bot.log.info(
                `[WIN-DEBUG]   slot[${String(item.slot).padStart(3)}]  ` +
                `${item.name.padEnd(36)}  x${String(item.count).padStart(3)}  ` +
                `meta:${item.metadata}${nbtPart}`
            )
        }
    }

    bot.log.info(DASH)
    bot.log.info(`[WIN-DEBUG] PLAYER INVENTORY (${totalSlots - containerSlotCount} total, ${playerItems.length} occupied)`)
    if (playerItems.length === 0) {
        bot.log.info('[WIN-DEBUG]   (empty)')
    } else {
        for (const item of playerItems) {
            const nbtPart = item.nbt ? `  nbt:${item.nbt}` : ''
            bot.log.info(
                `[WIN-DEBUG]   slot[${String(item.slot).padStart(3)}]  ` +
                `${item.name.padEnd(36)}  x${String(item.count).padStart(3)}  ` +
                `meta:${item.metadata}${nbtPart}`
            )
        }
    }

    bot.log.info(DASH)
    bot.log.info(`[WIN-DEBUG] TOTALS BY TYPE  (${typeEntries.length} distinct type${typeEntries.length !== 1 ? 's' : ''})`)
    for (const [name, count] of typeEntries) {
        bot.log.info(`[WIN-DEBUG]   ${name.padEnd(36)}  total:${count}`)
    }
    bot.log.info(SEP)
}

// ── openChatCommandWindow ─────────────────────────────────────────────────────
// Sends a chat command (e.g. '/shop', '/order blaze rod') and waits for the
// server to open a GUI window in response.
//
// The listener is registered BEFORE the command is sent so the windowOpen
// event is never missed even on very low-latency connections.
//
// @param {Bot}    bot
// @param {string} command    full command string including '/'
// @param {number} [timeoutMs=5000]
// @returns {Promise<Window>}  rejects on timeout
async function openChatCommandWindow(bot, command, timeoutMs = 5000) {
    const winPromise = waitForWindowOpen(bot, timeoutMs)
    bot.chat(command)
    return winPromise
}

module.exports = {
    parseTitle,
    snapshotWindow,
    logWindowSnapshot,
    dumpWindowToFile,
    openChatCommandWindow,
}
