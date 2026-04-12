// ── debugTraderWindows ────────────────────────────────────────────────────────
// One-shot diagnostic action: sends the shop command and the order command,
// waits for each server-opened GUI window, and dumps every observable detail
// to the log — raw title, type/id/slot counts, every container slot with
// item name/count/metadata/NBT, every player-inventory slot, and
// totals-by-item-type.
//
// Use this before implementing real trader logic to understand:
//   • what slot indices mean what (buy button, item display, page navigation…)
//   • what item names DonutSMP uses for GUI elements
//   • what the raw window title JSON looks like
//   • how many container slots vs player-inventory slots each window has
//
// Options:
//   shopCommand     (default '/shop')              command that opens the shop window
//   orderCommand    (default '/order blaze rod')   command that opens the order window
//   winTimeoutMs    (default 5000)                 ms to wait for each windowOpen event
//   delayBetweenMs  (default 1500)                 ms to wait between the two commands
//                                                  (gives the server time to process close)

const { openChatCommandWindow, snapshotWindow, logWindowSnapshot, dumpWindowToFile } = require('../lib/skills/debugWindow')

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function debugTraderWindows(bot, options = {}) {
    const {
        shopCommand    = '/shop',
        orderCommand   = '/order blaze rod',
        winTimeoutMs   = 5000,
        delayBetweenMs = 1500,
    } = options

    // ── 1. Shop window ─────────────────────────────────────────────────────────
    bot.log.info(`[WIN-DEBUG] Sending "${shopCommand}"…`)
    let shopWin
    try {
        shopWin = await openChatCommandWindow(bot, shopCommand, winTimeoutMs)
        const snap = snapshotWindow(shopWin)
        logWindowSnapshot(bot, snap, `SHOP WINDOW  (${shopCommand})`)
        dumpWindowToFile(bot, shopWin, 'shop')
        bot.closeWindow(shopWin)
    } catch (err) {
        bot.log.warn(`[WIN-DEBUG] "${shopCommand}" window failed: ${err.message}`)
    }

    await sleep(delayBetweenMs)

    // ── 2. Order window ────────────────────────────────────────────────────────
    bot.log.info(`[WIN-DEBUG] Sending "${orderCommand}"…`)
    let orderWin
    try {
        orderWin = await openChatCommandWindow(bot, orderCommand, winTimeoutMs)
        const snap = snapshotWindow(orderWin)
        logWindowSnapshot(bot, snap, `ORDER WINDOW  (${orderCommand})`)
        dumpWindowToFile(bot, orderWin, 'order')
        bot.closeWindow(orderWin)
    } catch (err) {
        bot.log.warn(`[WIN-DEBUG] "${orderCommand}" window failed: ${err.message}`)
    }
}

module.exports = debugTraderWindows
