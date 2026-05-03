// ── checkBalance — read the bot's in-game wallet via /bal ─────────────────────
//
// Sends the /bal command and listens for the server's plain-chat response.
// DonutSMP formats the reply as:  "You have $286.76K."
// That line is parsed with the shared parseMoneyString helper from nbtParse.js.
//
// Usage (in an action or loop, no GUI window involved):
//   const { checkBalance } = require('../lib/skills/checkBalance')
//   const balance = await checkBalance(bot)
//   // balance → number of dollars, or null if the response never arrived
//
// Options:
//   command    {string}   '/bal'    chat command to send
//   timeoutMs  {number}   6000      ms to wait for the server reply

const { parseMoneyString, formatMoney } = require('./nbtParse')
const EventBus = require('../EventBus')

const LOG = '[CHECK-BALANCE]'

/**
 * Sends /bal and waits for DonutSMP's "You have $X." reply.
 *
 * @param {object} bot
 * @param {{ command?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<number|null>}  balance in dollars, or null on timeout
 */
async function checkBalance(bot, opts = {}) {
    const { command = '/bal', timeoutMs = 6000 } = opts

    return new Promise((resolve) => {
        let settled = false

        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            bot.removeListener('message', onMessage)
            bot.log?.warn(`${LOG} Timed out waiting for /bal response after ${timeoutMs}ms`)
            resolve(null)
        }, timeoutMs)

        function onMessage(jsonMsg) {
            if (settled) return
            const text = jsonMsg.toString()

            // Match: "You have $286.76K." — $ required, optional trailing period/whitespace
            const m = text.match(/You have (\$[\d.,]+[KkMm]?)/)
            if (!m) return

            settled = true
            clearTimeout(timer)
            bot.removeListener('message', onMessage)

            const balance = parseMoneyString(m[1])
            bot.log?.info(`${LOG} Balance: ${formatMoney(balance)}  (server: "${text.trim()}")`)

            // Forward to process-wide EventBus so the dashboard can persist + display.
            EventBus.emit('bot:balance', { profile: bot._profileName, ts: Date.now(), balance })

            resolve(balance)
        }

        bot.on('message', onMessage)
        bot.chat(command)
    })
}

module.exports = { checkBalance }
