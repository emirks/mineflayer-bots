// ── nbtParse — display name + lore extraction from prismarine-nbt slot data ───
//
// All functions are pure: no bot reference, no side effects, no I/O.
// They handle the exact NBT structure DonutSMP items carry after ViaVersion
// translation (verified against live window dumps).
//
// NBT shape (for display info):
//   slot.nbt.value.display.value.Name.value   → JSON chat-component string
//   slot.nbt.value.display.value.Lore.value.value → string[]  (JSON chat per line)
//
// Chat component format (standard MC):
//   { "text": "", "extra": [{ "color": "#00fc88", "text": "ᴇɴᴅ" }, ...] }
//   or just { "text": "..." } with no extra array
//
// Exports:
//   chatComponentToText(json)           → string
//   getDisplayName(slot)                → string
//   getLore(slot)                       → string[]
//   findSlotByKeyword(win, keyword)     → number   slot index or -1
//   summariseSlot(idx, slot)            → object   { slot, item, displayName, lore }

// ── chatComponentToText ───────────────────────────────────────────────────────
// Converts a Minecraft JSON chat component (string or already-parsed object)
// to a plain UTF-8 string by concatenating all "text" fields recursively.
//
// Input:  '{"extra":[{"color":"white","text":"Click to view the end shop"}],"text":""}'
// Output: 'Click to view the end shop'
function chatComponentToText(json) {
    if (!json || json === '""') return ''
    try {
        const obj = typeof json === 'string' ? JSON.parse(json) : json
        let out = obj.text || ''
        if (Array.isArray(obj.extra)) {
            out += obj.extra.map(part => chatComponentToText(part)).join('')
        }
        return out
    } catch {
        return typeof json === 'string' ? json : ''
    }
}

// ── getDisplayName ────────────────────────────────────────────────────────────
// Returns the display name of a slot as plain text.
// Falls back to slot.name if no display.Name NBT is present.
function getDisplayName(slot) {
    if (!slot) return ''
    try {
        const nameJson = slot.nbt?.value?.display?.value?.Name?.value
        if (nameJson) return chatComponentToText(nameJson)
    } catch {}
    return slot.name || ''
}

// ── getLore ───────────────────────────────────────────────────────────────────
// Returns lore lines as plain text strings.
// Empty lines (after stripping) are excluded.
function getLore(slot) {
    if (!slot) return []
    try {
        const loreArr = slot.nbt?.value?.display?.value?.Lore?.value?.value
        if (!Array.isArray(loreArr)) return []
        return loreArr
            .map(line => chatComponentToText(line))
            .filter(line => line.trim() !== '')
    } catch {
        return []
    }
}

// ── normalizeText ─────────────────────────────────────────────────────────────
// DonutSMP uses Unicode small-caps / styled letters for button labels
// (e.g. "ʙᴀᴄᴋ" instead of "back", "ᴄᴀɴᴄᴇʟ" instead of "cancel").
// Standard toLowerCase() / includes() cannot match them against ASCII keywords.
// This function folds known styled codepoints to their ASCII equivalents so
// keyword searches work reliably regardless of the font used server-side.
const UNICODE_FOLD = {
    // Small-caps letters (U+1D00 block and related)
    'ᴀ':'a','ʙ':'b','ᴄ':'c','ᴅ':'d','ᴇ':'e','ꜰ':'f','ɢ':'g','ʜ':'h',
    'ɪ':'i','ᴊ':'j','ᴋ':'k','ʟ':'l','ᴍ':'m','ɴ':'n','ᴏ':'o','ᴘ':'p',
    'ǫ':'q','ʀ':'r','ѕ':'s','ᴛ':'t','ᴜ':'u','ᴠ':'v','ᴡ':'w','ʏ':'y',
    'ᴢ':'z',
    // Fullwidth Latin (U+FF00 block)
    'ａ':'a','ｂ':'b','ｃ':'c','ｄ':'d','ｅ':'e','ｆ':'f','ｇ':'g','ｈ':'h',
    'ｉ':'i','ｊ':'j','ｋ':'k','ｌ':'l','ｍ':'m','ｎ':'n','ｏ':'o','ｐ':'p',
    'ｑ':'q','ｒ':'r','ｓ':'s','ｔ':'t','ｕ':'u','ｖ':'v','ｗ':'w','ｘ':'x',
    'ｙ':'y','ｚ':'z',
}

function normalizeText(str) {
    return str
        .split('')
        .map(c => UNICODE_FOLD[c] ?? c)
        .join('')
        .toLowerCase()
}

// ── findSlotByKeyword ─────────────────────────────────────────────────────────
// Scans container slots (0..win.inventoryStart) for one whose display name
// or lore contains `keyword` (case-insensitive, unicode-normalized).
// Returns the slot index, or -1 if not found.
function findSlotByKeyword(win, keyword) {
    const kw    = normalizeText(keyword)
    const slots = win.slots || []
    const end   = win.inventoryStart ?? Math.max(0, slots.length - 36)

    for (let i = 0; i < end; i++) {
        const s = slots[i]
        if (!s || !s.name) continue
        const text = normalizeText(getDisplayName(s) + ' ' + getLore(s).join(' '))
        if (text.includes(kw)) return i
    }
    return -1
}

// ── summariseSlot ─────────────────────────────────────────────────────────────
// Returns a compact plain object for logging and catalog output.
function summariseSlot(idx, slot) {
    return {
        slot:        idx,
        item:        slot.name,
        displayName: getDisplayName(slot),
        lore:        getLore(slot),
    }
}

module.exports = {
    chatComponentToText,
    normalizeText,
    getDisplayName,
    getLore,
    findSlotByKeyword,
    summariseSlot,
}
