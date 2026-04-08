// ─── skills/ — home for NEW skill modules ─────────────────────────────────────
//
// WHY THIS FOLDER EXISTS
//   lib/skills.js is 2100-line mindcraft-origin code. It works and is stable,
//   but it's too large to extend cleanly. Any skill you write yourself goes
//   here instead of in that file.
//
// HOW TO ADD A NEW SKILL
//   1. Create lib/skills/mySkill.js
//      module.exports = async function mySkill(bot, options) { ... }
//   2. Add it to the exports below.
//   3. Use it in actions/ via:
//      const { mySkill } = require('../lib/skills')   ← picks up this index
//      ...but NOTE: Node resolves lib/skills.js before lib/skills/index.js,
//      so import your new skills directly until the migration below is done:
//      const { mySkill } = require('../lib/skills/mySkill')
//
// MIGRATION PATH (when skills.js becomes painful to maintain)
//   1. Rename lib/skills.js → lib/skills/_legacy.js
//   2. Re-export everything from _legacy.js here:
//        module.exports = { ...require('./_legacy'), mySkill }
//   3. All existing require('../lib/skills') calls continue to work unchanged
//      because Node will now resolve to this index.js.
//   4. Gradually move functions out of _legacy.js into focused files here.
//
// ─────────────────────────────────────────────────────────────────────────────

// No custom skills yet. Add your first one above and export it here.
module.exports = {}
