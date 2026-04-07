const EventEmitter = require('events')
const { createBotSession } = require('./createBotSession')
const { createLogger } = require('./logger')

// ─── Bot state machine ────────────────────────────────────────────────────────
const BotState = {
  IDLE        : 'idle',
  CONNECTING  : 'connecting',
  CONNECTED   : 'connected',
  DISCONNECTED: 'disconnected',
  RECONNECTING: 'reconnecting',
  STOPPED     : 'stopped',
  FAILED      : 'failed',
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── BotManager ───────────────────────────────────────────────────────────────
// Manages the full lifecycle of one bot profile:
//   - Starts a bot session and tracks its state
//   - Reconnects on unexpected disconnect with exponential backoff
//   - Exposes start() / stop() for the orchestrator
//   - Emits events the orchestrator and future GUI can subscribe to
//
// Events emitted:
//   'stateChange'   { profile, state, attempt, uptime }  — on every state transition
//   'reconnecting'  { profile, attempt, delay }          — before each reconnect delay
//   'error'         { profile, error, attempt }          — on session error / kick
//
// Configuration:
//   profile       string    profile name (matches profiles/<name>.js)
//   reconnect     boolean   true = auto-reconnect on unexpected disconnect (default true)
//   maxRetries    number    max reconnect attempts before FAILED (default Infinity)
//   baseDelayMs   number    first reconnect delay; doubles each attempt, capped at 60s (default 5000)

class BotManager extends EventEmitter {
  constructor(config) {
    super()
    this.profileName  = config.profile
    // Optional pre-built profile config object (passed by GUI's spawnInstance).
    // When present, createBotSession receives it directly instead of loading by name.
    this.profileConfig = config.profileConfig || null
    this.reconnect    = config.reconnect  ?? true
    this.maxRetries   = config.maxRetries ?? Infinity
    this.baseDelayMs  = config.baseDelayMs ?? 5000

    this.state             = BotState.IDLE
    this._attempt          = 0
    this._stopped          = false
    this._currentBot       = null
    this._sessionStartedAt = null

    // Logger — same instance as the one createBotSession will use (registry dedup).
    // Manager-level logs (state transitions, reconnect decisions) go to the same
    // logs/<profile>.log file as session-level logs.
    this.log = createLogger(this.profileName)
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  start() {
    if (this.state !== BotState.IDLE) {
      this.log.warn(`[MANAGER] Already started (state: ${this.state})`)
      return
    }
    this._run()
  }

  // Intentionally stops the bot and prevents any further reconnects.
  stop() {
    this._stopped = true
    if (this._currentBot) {
      this._currentBot._quitting = true
      if (this._currentBot.pathfinder) this._currentBot.pathfinder.stop()
      try { this._currentBot.quit() } catch { /* already disconnected */ }
    }
    this._setState(BotState.STOPPED)
  }

  // Snapshot for the GUI / orchestrator
  getSnapshot() {
    return {
      profile: this.profileName,
      state  : this.state,
      attempt: this._attempt,
      uptime : this._sessionStartedAt ? Date.now() - this._sessionStartedAt : null,
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _setState(state) {
    if (this.state === state) return
    const prev = this.state
    this.state = state

    const snap = this.getSnapshot()

    // Enrich the log line with whatever is available at this transition
    const uptimeStr = snap.uptime != null ? ` | uptime: ${_fmtUptime(snap.uptime)}` : ''
    const attemptStr = snap.attempt > 0 ? ` | attempt: ${snap.attempt}` : ''
    const levelFn = state === BotState.FAILED      ? 'error'
                  : state === BotState.RECONNECTING ? 'warn'
                  : state === BotState.DISCONNECTED ? 'warn'
                  : 'info'
    this.log[levelFn](
      `[STATE] ${prev.toUpperCase()} → ${state.toUpperCase()}${uptimeStr}${attemptStr}`
    )

    this.emit('stateChange', snap)
  }

  async _run() {
    while (!this._stopped) {
      // ── Start session ────────────────────────────────────────────────────
      this.log.sessionMark(`Connect attempt ${this._attempt + 1}`)
      this._setState(BotState.CONNECTING)

      let sessionResult = null
      let sessionError  = null

      try {
        const { bot, promise } = createBotSession(this.profileConfig || this.profileName)
        this._currentBot = bot

        // Transition to CONNECTED only after the server confirms successful login,
        // not immediately after TCP connect (which is when createBotSession returns).
        bot.once('login', () => {
          this._sessionStartedAt = Date.now()
          this._attempt = 0  // reset backoff counter on confirmed successful login
          this._setState(BotState.CONNECTED)
        })

        sessionResult = await promise
      } catch (err) {
        sessionError = err
        this.log.error(`[MANAGER] Session error — ${err.message}`)
        this.emit('error', { profile: this.profileName, error: err, attempt: this._attempt })
      } finally {
        this._currentBot       = null
        this._sessionStartedAt = null
      }

      if (this._stopped) break

      // ── Decide whether to reconnect ─────────────────────────────────────
      // Intentional quit (our code called bot.quit()) → stop gracefully.
      if (sessionResult?.intentional) {
        this.log.info('[MANAGER] Intentional disconnect — not reconnecting')
        this._setState(BotState.STOPPED)
        return
      }

      this._setState(BotState.DISCONNECTED)

      if (!this.reconnect) {
        this._setState(BotState.STOPPED)
        return
      }

      this._attempt++
      if (this._attempt > this.maxRetries) {
        this.log.error(
          `[MANAGER] Reached maxRetries (${this.maxRetries}) — giving up`
        )
        this._setState(BotState.FAILED)
        return
      }

      // ── Reconnect delay (exponential backoff, capped at 60 s) ────────────
      const delay = Math.min(this.baseDelayMs * Math.pow(2, this._attempt - 1), 60_000)
      this.log.warn(
        `[MANAGER] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this._attempt})`
      )
      this._setState(BotState.RECONNECTING)
      this.emit('reconnecting', { profile: this.profileName, attempt: this._attempt, delay })

      await sleep(delay)
      if (this._stopped) break
    }

    this._setState(BotState.STOPPED)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _fmtUptime(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60)  return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

module.exports = { BotManager, BotState }
