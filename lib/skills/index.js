// ─── skills/ — home for new skill modules ─────────────────────────────────────
//
// lib/skills.js is 2100-line mindcraft-origin code — stable, kept as-is.
// All project-specific skills live here as focused single-responsibility files.
//
// IMPORT NOTE
//   require('../lib/skills') from actions/ resolves to lib/skills.js, not here.
//   Import custom skills directly from their files:
//     const { openSpawnerWindow } = require('../lib/skills/spawnerWindow')
//   This index exists as a catalogue and for any future migration.
//
// ── Skill catalogue ───────────────────────────────────────────────────────────
//
// spawnerWindow.js   — atomic DonutSMP GUI interactions (one packet op each)
//   waitForWindowOpen(bot, timeoutMs)
//   classifySpawnerPage(win, itemSlotStart, itemSlotEnd, sellTriggerItems)
//   openSpawnerWindow(bot, block, timeoutMs)
//   dropSpawnerPage(bot, slotDrop, settleMs)
//   navigateToNextPage(bot, slotNextPage, timeoutMs)
//   sellSpawnerPage(bot, slotSell, confirmFallback, settleMs, timeoutMs)
//
// spawnerSurvey.js   — survey (read stack count + ammo, used by sentinels)
//   getSpawnerInfo(bot, block, ammoItems, timeoutMs)
//   surveySpawners(bot, options)
//   DEFAULT_AMMO_ITEMS
//
// sweepSpawnerPages.js — page-sweep orchestration (drop bones, sell arrows)
//   sweepOneSpawner(bot, block, opts)
//   sweepSpawnerPages(bot, opts)
//
// debugSpawnerWindow.js — full GUI dump for debugging
//   debugSpawnerWindow(bot, block, opts)

const { waitForWindowOpen, classifySpawnerPage, openSpawnerWindow,
        dropSpawnerPage, navigateToNextPage, sellSpawnerPage } = require('./spawnerWindow')

const { getSpawnerInfo, surveySpawners, DEFAULT_AMMO_ITEMS } = require('./spawnerSurvey')

const { sweepOneSpawner, sweepSpawnerPages } = require('./sweepSpawnerPages')

const { debugSpawnerWindow } = require('./debugSpawnerWindow')

module.exports = {
    // spawnerWindow — atomic GUI primitives
    waitForWindowOpen,
    classifySpawnerPage,
    openSpawnerWindow,
    dropSpawnerPage,
    navigateToNextPage,
    sellSpawnerPage,
    // spawnerSurvey — read-only survey
    getSpawnerInfo,
    surveySpawners,
    DEFAULT_AMMO_ITEMS,
    // sweepSpawnerPages — page sweep
    sweepOneSpawner,
    sweepSpawnerPages,
    // debugSpawnerWindow — full GUI dump
    debugSpawnerWindow,
}
