'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Low-level Minecraft protocol tracing for any profile (not tied to debug profile).
 *
 * Also useful with env:
 *   set DEBUG=minecraft-protocol
 * (node's `debug` package — logs read/write inside minecraft-protocol)
 *
 * DonutSMP / large proxies often sit behind ViaVersion: they may send player_info
 * (and similar) with extra fields vs vanilla. Protodef then logs
 * "Chunk size is N but only M was read" — trailing bytes were ignored. That
 * warning is from protodef/src/serializer.js FullPacketParser, not from chunks.
 * It can coincide with anticheat kicks ("Invalid sequence") if state diverges.
 *
 * Mitigations (operational, not guarantees):
 * - Pin profile.bot.version to the native version the server advertises (e.g. '1.21.1' for DonutSMP).
 *   minecraft-data ^3.109.0 + mineflayer ^4.37.0 already support 1.21.x natively.
 * - Try hideErrors: true on the bot connection options to silence protodef size
 *   mismatch console spam (does not fix protocol skew; hides other parser logs too).
 * - Avoid behaviors that look like bots; kicks may be proxy policy, not parse bugs.
 */

function trunc (s, max) {
  if (s == null) return ''
  const str = typeof s === 'string' ? s : String(s)
  return str.length > max ? str.slice(0, max) + '…' : str
}

function safeJson (obj, maxLen) {
  try {
    return trunc(JSON.stringify(obj), maxLen)
  } catch {
    return '[unserializable]'
  }
}

function formatKickReason (reason) {
  if (reason == null) return String(reason)
  if (typeof reason === 'string') return reason
  try {
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

function resolveLogFilePath (opts) {
  const envPath = process.env.MC_PROTOCOL_LOG_FILE
  if (envPath && String(envPath).trim()) return String(envPath).trim()

  const f = opts.logFile
  if (f === true) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    return path.join('logs', `protocol-${stamp}.log`)
  }
  if (typeof f === 'string' && f.trim()) return f.trim()
  return null
}

/**
 * @param {object} bot  mineflayer bot (must have _client)
 * @param {object} opts
 * @param {boolean} [opts.enabled]
 * @param {boolean} [opts.logIncomingParsed=true]
 * @param {boolean} [opts.logIncomingRaw=false]
 * @param {boolean} [opts.logOutgoing=true]
 * @param {number} [opts.maxJsonLength=6000]
 * @param {number} [opts.maxHexChars=256]  hex char count (2 per byte)
 * @param {string[]|null} [opts.onlyPacketNames]  if set, only these packet names
 * @param {string[]|null} [opts.onlyStates]      e.g. ['play'] to skip handshake/login noise
 * @param {boolean} [opts.logErrors=true]       extra detail on client 'error'
 * @param {boolean} [opts.wrapConsoleForPartialReads=false] intercept "Chunk size is" protodef lines
 * @param {string|boolean} [opts.logFile]  path, or true for logs/protocol-<timestamp>.log; or MC_PROTOCOL_LOG_FILE env
 * @param {boolean} [opts.logToConsole=true] mirror protocol lines to console
 */
function attachProtocolDebug (bot, opts = {}) {
  if (!opts.enabled) return

  const client = bot._client
  if (!client) {
    console.warn('[PROTO-DEBUG] No bot._client — skipping attach')
    return
  }

  const logIncomingParsed = opts.logIncomingParsed !== false
  const logIncomingRaw = opts.logIncomingRaw === true
  const logOutgoing = opts.logOutgoing !== false
  const maxJson = opts.maxJsonLength ?? 6000
  const maxHex = opts.maxHexChars ?? 256
  const onlyNames = opts.onlyPacketNames
  const onlyStates = opts.onlyStates
  const logErrors = opts.logErrors !== false
  const wrapConsole = opts.wrapConsoleForPartialReads === true
  const logToConsole = opts.logToConsole !== false

  const filePath = resolveLogFilePath(opts)
  let stream = null
  if (filePath) {
    const abs = path.resolve(process.cwd(), filePath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    stream = fs.createWriteStream(abs, { flags: 'a' })
    stream.on('error', (e) => console.warn('[PROTO-DEBUG] log file write error:', e.message))
    console.log('[PROTO-DEBUG] Logging to file:', abs)
  }

  const ts = () => new Date().toISOString()

  function out (line) {
    if (logToConsole) console.log(line)
    if (stream) stream.write(line + '\n')
  }

  function errLine (line) {
    if (logToConsole) console.error(line)
    if (stream) stream.write(line + '\n')
  }

  function allow (name, state) {
    if (onlyNames && onlyNames.length && !onlyNames.includes(name)) return false
    if (onlyStates && onlyStates.length && !onlyStates.includes(state)) return false
    return true
  }

  function closeStream () {
    if (stream && !stream.destroyed) {
      stream.end()
      stream = null
    }
  }

  if (logIncomingParsed) {
    client.on('packet', (data, meta) => {
      const state = meta.state
      const name = meta.name
      if (!allow(name, state)) return
      out(`[PROTO] ${ts()} << ${state}.${name} ${safeJson(data, maxJson)}`)
    })
  }

  if (logIncomingRaw) {
    client.on('raw', (buffer, meta) => {
      const state = meta.state
      const name = meta.name
      if (!allow(name, state)) return
      const hex = buffer.toString('hex')
      out(`[PROTO] ${ts()} << RAW ${state}.${name} len=${buffer.length} hex=${trunc(hex, maxHex)}`)
    })
  }

  if (logOutgoing) {
    const origWrite = client.write.bind(client)
    client.write = function protocolDebugWrite (name, params) {
      try {
        const state = client.state
        if (allow(name, state)) {
          out(`[PROTO] ${ts()} >> ${state}.${name} ${safeJson(params, maxJson)}`)
        }
      } catch (e) {
        console.warn('[PROTO-DEBUG] write log error', e.message)
      }
      return origWrite(name, params)
    }
  }

  if (logErrors) {
    client.on('error', (err) => {
      errLine(`[PROTO] ${ts()} ERROR ${err.message}`)
      if (err.field) errLine(`[PROTO]   field: ${err.field}`)
      if (err.stack) errLine(`[PROTO]   stack: ${err.stack}`)
      if (err.buffer) {
        errLine(`[PROTO]   buffer len= ${err.buffer.length} hex= ${trunc(err.buffer.toString('hex'), maxHex)}`)
      }
    })
  }

  if (wrapConsole) {
    const origLog = console.log
    console.log = (...args) => {
      const line = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ')
      if (line.includes('Chunk size is') && line.includes('was read')) {
        const prefixed = `[PROTO] ${ts()} PROTODEF-WARN ${line}`
        if (logToConsole) origLog.call(console, prefixed)
        if (stream) stream.write(prefixed + '\n')
        return
      }
      origLog.apply(console, args)
    }
    client.once('end', () => {
      console.log = origLog
    })
  }

  client.once('end', closeStream)

  console.log('[PROTO-DEBUG] Attached (parsed in=%s raw in=%s out=%s file=%s)', logIncomingParsed, logIncomingRaw, logOutgoing, filePath || '(none)')
}

module.exports = { attachProtocolDebug, formatKickReason }
