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
// debugWindow.js     — general-purpose window snapshot + logger (any window)
//   parseTitle(win)
//   snapshotWindow(win)
//   logWindowSnapshot(bot, snap, header)
//   dumpWindowToFile(bot, win, label)
//   openChatCommandWindow(bot, command, timeoutMs)
//
// spawnerWindow.js   — atomic DonutSMP spawner GUI interactions (one packet op each)
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
// debugSpawnerWindow.js — full GUI dump for spawner windows (uses debugWindow helpers)
//   debugSpawnerWindow(bot, block, opts)
//
// nbtParse.js        — pure NBT display/lore extraction helpers
//   chatComponentToText(json)
//   normalizeText(str)              — folds unicode small-caps to ASCII lowercase
//   getDisplayName(slot)
//   getLore(slot)
//   findSlotByKeyword(win, keyword) — unicode-aware keyword search
//   summariseSlot(idx, slot)
//
// shopTraverse.js    — full /shop GUI traversal (main → category → buy → cancel → back)
//   traverseShop(bot, opts)
//
// orderTraverse.js   — DonutSMP /order delivery (one end-to-end cycle)
//   deliverOneOrder(bot, opts)
//   parseMoneyString(str)   — "$431K" → 431000, "$2.9M" → 2900000
//   formatMoney(n)          — 9280 → "$9.28K"
//
// blazeTrade.js      — buy-low / sell-high loop (shop → fill inv → best order)
//   blazeTradeLoop(bot, opts)   — infinite cycle; stops on bot._quitting
//   buyFromShop(bot, opts)      — navigate /shop, fill inventory with item
//   deliverToOrder(bot, opts)   — find best order, deposit all, confirm
//
// collectMyOrder.js  — collect items from "My Orders" + flatten stack into inventory
//   collectFromMyOrder(bot, opts)          — full flow: GUI nav → collect → flatten
//   flattenInventoryStack(bot, itemName, opts) — standalone: spread 1 per empty slot
//
// auctionSell.js     — list 1×-stack items on /ah at (lowest price − N)
//   auctionSellAll(bot, opts)   — fill hotbar → get AH lowest price → sell each slot
//   parseMoneyString(str)       — "$9.28K" → 9280
//   formatMoney(n)              — 9280 → "$9.28K"
//
// checkBalance.js    — read the bot's wallet via /bal chat command
//   checkBalance(bot, opts)     — sends /bal, parses "You have $X." → number|null

const { parseTitle, snapshotWindow, logWindowSnapshot,
    dumpWindowToFile, openChatCommandWindow } = require('./debugWindow')

const { waitForWindowOpen, classifySpawnerPage, openSpawnerWindow,
    dropSpawnerPage, navigateToNextPage, sellSpawnerPage } = require('./spawnerWindow')

const { getSpawnerInfo, surveySpawners, DEFAULT_AMMO_ITEMS } = require('./spawnerSurvey')

const { sweepOneSpawner, sweepSpawnerPages } = require('./sweepSpawnerPages')

const { debugSpawnerWindow } = require('./debugSpawnerWindow')

const { resolveComponent, chatComponentToText, normalizeText, getDisplayName, getLore,
    findSlotByKeyword, summariseSlot, parseMoneyString, formatMoney } = require('./nbtParse')

const { traverseShop } = require('./shopTraverse')

const { deliverOneOrder, parseMoneyString, formatMoney } = require('./orderTraverse')

const { blazeTradeLoop, buyFromShop, deliverToOrder } = require('./blazeTrade')

const { collectFromMyOrder, flattenInventoryStack } = require('./collectMyOrder')

const { auctionSellAll } = require('./auctionSell')

const { checkBalance } = require('./checkBalance')

const { parseLitematic, getBounds, materialList } = require('./liteParser')
const { buildSchematic, findBuildOrigin, scanNearbyChests,
    equipBestPickaxe, withdrawFromChests, inventoryCount } = require('./builderCore')

module.exports = {
    // debugWindow — general window helpers
    parseTitle,
    snapshotWindow,
    logWindowSnapshot,
    dumpWindowToFile,
    openChatCommandWindow,
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
    // nbtParse — pure NBT + money helpers
    resolveComponent,
    chatComponentToText,
    normalizeText,
    getDisplayName,
    getLore,
    findSlotByKeyword,
    summariseSlot,
    parseMoneyString,
    formatMoney,
    // shopTraverse — full /shop traversal
    traverseShop,
    // orderTraverse — /order delivery
    deliverOneOrder,
    parseMoneyString,
    formatMoney,
    // blazeTrade — buy/sell loop
    blazeTradeLoop,
    buyFromShop,
    deliverToOrder,
    // collectMyOrder — collect from My Orders + flatten stack into inventory
    collectFromMyOrder,
    flattenInventoryStack,
    // auctionSell — list 1× stacks on /ah at lowest-price − N
    auctionSellAll,
    // checkBalance — read wallet via /bal
    checkBalance,
    // Note: parseMoneyString and formatMoney above come from nbtParse (single source).
    // liteParser — .litematic file parser
    parseLitematic,
    getBounds,
    materialList,
    // builderCore — schematic builder
    buildSchematic,
    findBuildOrigin,
    scanNearbyChests,
    equipBestPickaxe,
    withdrawFromChests,
    inventoryCount,
}
