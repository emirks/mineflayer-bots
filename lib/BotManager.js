const EventEmitter = require('events')
const { createBotSession } = require('./createBotSession')

// ─── Bot state machine ────────────────────────────────────────────────────────
const BotState = {
  IDLE: 'idle',             // created, start() not called yet
  CONNECTING: 'connecting', // createBotSession called, waiting for login
  CONNECTED: 'connected',   // bot logged in and spawned, triggers active
  DISCONNECTED: 'disconnected', // session ended unexpectedly
  RECONNECTING: 'reconnecting', // waiting for reconnect delay to expire
  STOPPED: 'stopped',       // intentional stop (our code called quit, or stop())
  FAILED: 'failed',         // maxRetries exceeded, giving up
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
    this.profileName = config.profile
    this.reconnect = config.reconnect ?? true
    this.maxRetries = config.maxRetries ?? Infinity
    this.baseDelayMs = config.baseDelayMs ?? 5000

    this.state = BotState.IDLE
    this._attempt = 0
    this._stopped = false
    this._currentBot = null
    this._sessionStartedAt = null
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  start() {
    if (this.state !== BotState.IDLE) {
      console.warn(`[MANAGER:${this.profileName}] Already started (state: ${this.state})`)
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
      state: this.state,
      attempt: this._attempt,
      uptime: this._sessionStartedAt ? Date.now() - this._sessionStartedAt : null,
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _setState(state) {
    if (this.state === state) return
    this.state = state
    this.emit('stateChange', this.getSnapshot())
  }

  async _run() {
    while (!this._stopped) {
      // ── Start session ────────────────────────────────────────────────────
      this._setState(BotState.CONNECTING)

      let sessionResult = null
      let sessionError = null

      try {
        const { bot, promise } = createBotSession(this.profileName)
        this._currentBot = bot
        this._sessionStartedAt = Date.now()
        this._setState(BotState.CONNECTED)

        sessionResult = await promise
      } catch (err) {
        sessionError = err
        this.emit('error', { profile: this.profileName, error: err, attempt: this._attempt })
      } finally {
        this._currentBot = null
        this._sessionStartedAt = null
      }

      if (this._stopped) break

      // ── Decide whether to reconnect ─────────────────────────────────────
      // Intentional quit (our code called bot.quit()) → stop gracefully.
      if (sessionResult?.intentional) {
        console.log(`[MANAGER:${this.profileName}] Intentional disconnect — not reconnecting`)
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
        console.error(
          `[MANAGER:${this.profileName}] Reached maxRetries (${this.maxRetries}) — giving up`
        )
        this._setState(BotState.FAILED)
        return
      }

      // ── Reconnect delay (exponential backoff, capped at 60 s) ────────────
      const delay = Math.min(this.baseDelayMs * Math.pow(2, this._attempt - 1), 60_000)
      console.log(
        `[MANAGER:${this.profileName}] Reconnecting in ${(delay / 1000).toFixed(1)}s ` +
        `(attempt ${this._attempt})`
      )
      this._setState(BotState.RECONNECTING)
      this.emit('reconnecting', { profile: this.profileName, attempt: this._attempt, delay })

      await sleep(delay)
      if (this._stopped) break
    }

    this._setState(BotState.STOPPED)
  }
}

module.exports = { BotManager, BotState }
