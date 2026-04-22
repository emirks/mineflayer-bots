// ── nbtParse — display name + lore extraction from prismarine-item slot data ───
//
// All functions are pure: no bot reference, no side effects, no I/O.
//
// Version compat (prismarine-item@1.18.0):
//   1.20.4 and earlier — custom names/lore in NBT:
//     slot.nbt.value.display.value.Name.value   → JSON chat-component string
//     slot.nbt.value.display.value.Lore.value.value → string[]  (JSON chat per line)
//
//   1.20.5+ (data components, incl. 1.21.x) — slot.nbt is null; prismarine-item
//   exposes components through getters:
//     slot.customName  → JSON chat-component string (from componentMap 'custom_name')
//     slot.customLore  → string[] of JSON chat-component lines (from componentMap 'lore')
//
// getDisplayName / getLore check the component getter first, falling back to the
// old NBT path, so one codebase handles both protocol generations.
//
// Chat component format (standard MC):
//   { "text": "", "extra": [{ "color": "#00fc88", "text": "ᴇɴᴅ" }, ...] }
//   or just { "text": "..." } with no extra array
//
// Exports:
//   resolveComponent(raw)               → plain component object or null
//   chatComponentToText(json)           → string
//   getDisplayName(slot)                → string
//   getLore(slot)                       → string[]
//   findSlotByKeyword(win, keyword)     → number   slot index or -1
//   summariseSlot(idx, slot)            → object   { slot, item, displayName, lore }
//   parseMoneyString(str)               → number   "$9.28K" → 9280, "$2.9M" → 2900000
//   formatMoney(n)                      → string   9280 → "$9.28K", 2900000 → "$2.90M"

// ── resolveComponent ──────────────────────────────────────────────────────────
// Normalises any Minecraft chat-component representation to a plain
// { text, color?, extra: [{text, color?}] } object.
//
// Handles three input formats:
//
//   1. JSON string  (pre-1.20.5 NBT)
//        '{"text":"","extra":[{"color":"white","text":"• Most Paid"}]}'
//
//   2. Plain object  (already parsed by caller)
//        { text: '', extra: [{ color: 'white', text: '...' }] }
//
//   3. Prismarine-nbt compound  (1.20.5+ data components — slot.customName / customLore)
//        { type:'compound', value:{
//            text:  { type:'string', value:'' },
//            color: { type:'string', value:'#00FC88' },  // optional
//            extra: { type:'list', value:{ type:'compound', value:[
//              { text:{type:'string',value:'• Sort'}, color:{type:'string',value:'#00FC88'}, ... }
//            ]}}
//        }}
//
// Returns null on unrecognised / empty input.
function resolveComponent(raw) {
    if (!raw) return null
    try {
        if (raw.type === 'compound' && raw.value) {
            const v      = raw.value
            const extras = v.extra?.value?.value
            return {
                text:  v.text?.value  ?? '',
                color: v.color?.value ?? null,
                extra: Array.isArray(extras)
                    ? extras.map(e => ({
                        text:  e.text?.value  ?? '',
                        color: e.color?.value ?? null,
                    }))
                    : [],
            }
        }
        if (typeof raw === 'string') return JSON.parse(raw)
        return raw
    } catch {
        return null
    }
}

// ── chatComponentToText ───────────────────────────────────────────────────────
// Converts any chat component representation (JSON string, plain object, or
// prismarine-nbt compound) to a plain UTF-8 string.
//
// Delegates normalisation to resolveComponent so it handles both pre-1.20.5
// NBT strings and 1.20.5+ data-component compound objects transparently.
//
// Input (examples):
//   '{"extra":[{"color":"white","text":"Click to view the end shop"}],"text":""}'
//   { type:'compound', value:{ text:{type:'string',value:''}, extra:{...} } }
// Output: 'Click to view the end shop'
function chatComponentToText(json) {
    if (!json || json === '""') return ''
    try {
        const obj = resolveComponent(json)
        if (!obj) return typeof json === 'string' ? json : ''
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
// Checks 1.20.5+ data components (slot.customName) first, then old NBT.
// Falls back to slot.name if neither source has a custom name.
function getDisplayName(slot) {
    if (!slot) return ''
    try {
        // 1.20.5+ (1.21.x): prismarine-item exposes via slot.customName getter
        const nameJson = slot.customName ?? slot.nbt?.value?.display?.value?.Name?.value
        if (nameJson) return chatComponentToText(nameJson)
    } catch {}
    return slot.name || ''
}

// ── getLore ───────────────────────────────────────────────────────────────────
// Returns lore lines as plain text strings.
// Checks 1.20.5+ data components (slot.customLore) first, then old NBT.
// Empty lines (after stripping) are excluded.
function getLore(slot) {
    if (!slot) return []
    try {
        // 1.20.5+ (1.21.x): prismarine-item exposes via slot.customLore getter
        const loreArr = slot.customLore ?? slot.nbt?.value?.display?.value?.Lore?.value?.value
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

// ── parseMoneyString / formatMoney ────────────────────────────────────────────
// Shared by auctionSell.js and orderTraverse.js; single source of truth here.
//
// parseMoneyString: handles optional leading $, commas, and K/M suffixes.
//   "$431"   →   431
//   "$9.28K" →  9280
//   "$2.9M"  →  2900000
//   "8.93M"  →  8930000  (bare, e.g. from lore delivery counters)
//
// formatMoney: compact representation for logging.
//   431     → "$431.00"
//   9280    → "$9.28K"
//   2900000 → "$2.90M"

function parseMoneyString(str) {
    if (!str) return 0
    const clean = String(str).replace(/[$,\s]/g, '')
    const m = clean.match(/^([\d.]+)([KkMm]?)$/)
    if (!m) return 0
    const n = parseFloat(m[1])
    const s = m[2].toUpperCase()
    if (s === 'K') return n * 1e3
    if (s === 'M') return n * 1e6
    return n
}

function formatMoney(n) {
    if (n === null || n === undefined) return '?'
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
    return `$${n.toFixed(2)}`
}

module.exports = {
    resolveComponent,
    chatComponentToText,
    normalizeText,
    getDisplayName,
    getLore,
    findSlotByKeyword,
    summariseSlot,
    parseMoneyString,
    formatMoney,
}
