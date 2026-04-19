# Minecraft Version Migration Notes

Reference for future version bumps. Documents everything learned during the
1.20.4 → 1.21.1 migration (2026-04-19).

---

## Version pin

```js
// profiles/_base.js
version: '1.21.1',   // DonutSMP native version
```

- Set to the version the **server actually runs natively** (check the login log:
  `[SESSION] version: X`).
- `false` → minecraft-protocol picks its own default (currently `1.21.11`).
  ViaVersion on the server will translate, but you get less predictable packet
  shapes — prefer an explicit pin.
- DonutSMP runs 1.21.1 natively with ViaVersion on top for player clients.
  Connecting at `1.21.1` gives native protocol with no translation overhead.

---

## The NBT → Data Components break (1.20.5+)

**This is the single biggest source of silent breakage when upgrading.**

| | ≤ 1.20.4 | ≥ 1.20.5 (incl. 1.21.x) |
|---|---|---|
| `slot.nbt` | prismarine-nbt compound with display info | **`null`** |
| Custom name | `slot.nbt.value.display.value.Name.value` | `slot.customName` |
| Lore lines | `slot.nbt.value.display.value.Lore.value.value` | `slot.customLore` |

### What `slot.customName` / `slot.customLore` look like

They are **prismarine-nbt compound objects**, not plain JSON strings:

```js
// slot.customName — a single compound
{
  type: 'compound',
  value: {
    text:  { type: 'string', value: '' },
    color: { type: 'string', value: '#00FC88' },   // optional
    extra: { type: 'list', value: { type: 'compound', value: [
      { text: { type:'string', value:'ѕᴏʀᴛ' }, color: { type:'string', value:'#00FC88' }, ... }
    ]}}
  }
}

// slot.customLore — array of compounds, one per lore line
[
  { type:'compound', value:{ text:{...}, extra:{...} } },
  ...
]
```

You **cannot** do `JSON.parse(slot.customName)` or read `slot.customName.text`
directly — both silently return nothing. Use `resolveComponent()`.

### resolveComponent() — the normaliser

`lib/skills/nbtParse.js` exports `resolveComponent(raw)` which accepts any of
the three formats (JSON string, plain object, or prismarine-nbt compound) and
returns a plain `{ text, color?, extra: [{text, color?}] }` object:

```js
const { resolveComponent } = require('./nbtParse')

const comp = resolveComponent(slot.customName)
// → { text: '', color: null, extra: [{ text: 'ѕᴏʀᴛ', color: '#00FC88' }] }
```

### getDisplayName / getLore — already fixed

`getDisplayName(slot)` and `getLore(slot)` in `nbtParse.js` check
`slot.customName` / `slot.customLore` first (1.20.5+), then fall back to the
old NBT path. **Use these everywhere** instead of reading `slot.nbt` directly.

### getActiveSortMode — use resolveComponent, not JSON.parse

Sort-button lore detection (in `auctionSell.js` and `orderTraverse.js`) iterates
lore lines and checks highlight colours. Old code:

```js
const json = JSON.parse(rawLine)   // ← breaks in 1.21.x (rawLine is a compound)
```

Fixed code:

```js
const comp = resolveComponent(rawLine)
if (!comp) continue
// check comp.color (flat format) or comp.extra[i].color (nested format)
```

DonutSMP uses **both** formats depending on the GUI:
- AH sort buttons: colour on the root → `comp.color`
- Order sort buttons: colour on an extra child → `comp.extra[i].color`

---

## velocityPatch.js — still required

`entity_velocity` packet schema (`vec3i16` → nested `velocity:{x,y,z}`) is
**unchanged** from 1.20.4 through 1.21.x. The `entityVelocityIsLpVec3` feature
flag is `false` for every version in that range (verified via
`minecraft-data@3.109.0`). The patch remains necessary and active.

---

## Window dump files — size warning

`dumpWindowToFile` writes `customName` and `customLore` as **resolved plain
strings**, not raw compound objects. Writing raw compounds inflates a 54-slot
window from ~500 lines to ~16,000 lines.

Window dumps are gated by `debug: true` in skill options (same pattern in both
`auctionSell.js` and `orderTraverse.js`). Production profiles leave `debug:
false` and never write dump files.

---

## Checklist for a future version bump

1. Update `version:` in `profiles/_base.js`.
2. Run the debug profile; confirm `[SESSION] version: X` in the log.
3. Check `slot.nbt` on a GUI button slot in a window dump — expect `null` for
   any version ≥ 1.20.5.
4. Confirm `getDisplayName` / `getLore` return real text (not empty strings).
5. Confirm `getActiveSortMode` returns the correct active sort option.
6. Confirm `velocityPatch` fires (`[PATCH] velocityPatch applied` in log) and
   no `NaN` positions appear.
7. If any new packet shape changes appear, check `minecraft-data` for the new
   version and update `velocityPatch.js` comment accordingly.
