const path = require('path')
const { BotManager, BotState } = require('./lib/BotManager')
const EventBus = require('./lib/EventBus')

// ─── Orchestrator ─────────────────────────────────────────────────────────────
// Central registry and control plane for all bot profiles.
//
// Responsibilities:
//   - Manage a fleet of BotManagers (one per profile)
//   - Forward bot events onto the shared EventBus for GUI / coordination
//   - Expose a stable programmatic API so a GUI layer never imports bot internals
//
// Usage:
//   CLI (interactive):  node orchestrator.js            ← prompts profile picker
//   CLI (direct):       node orchestrator.js sentinel trader
//   Module: const { spawnBot, stopBot, getBotStates, EventBus } = require('./orchestrator')
//
// EventBus events published here:
//   'bot:stateChange'  { profile, state, attempt, uptime }
//   'bot:error'        { profile, error, attempt }
//   'bot:reconnecting' { profile, attempt, delay }
//
// GUI integration (future):
//   const { spawnBot, stopBot, getBotStates, EventBus } = require('./orchestrator')
//   EventBus.on('bot:stateChange', snapshot => updateUI(snapshot))
//   getBotStates()  → array of current snapshots for initial render

const managers = new Map()  // profileName → BotManager

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Starts managing a bot profile. Reconnects automatically on disconnect.
 * @param {{ profile: string, reconnect?: boolean, maxRetries?: number, baseDelayMs?: number }} config
 * @returns {BotManager}
 */
function spawnBot(config) {
  const { profile } = config

  if (managers.has(profile)) {
    const existing = managers.get(profile)
    if (existing.state !== BotState.STOPPED && existing.state !== BotState.FAILED) {
      console.warn(`[ORCH] "${profile}" is already running (state: ${existing.state})`)
      return existing
    }
    // Allow re-spawning a stopped/failed manager by replacing it
    managers.delete(profile)
  }

  const manager = new BotManager(config)
  managers.set(profile, manager)

  manager.on('stateChange', (snapshot) => {
    console.log(`[ORCH] [${snapshot.profile}] → ${snapshot.state}`)
    EventBus.emit('bot:stateChange', snapshot)
  })

  manager.on('reconnecting', (data) => {
    const secs = (data.delay / 1000).toFixed(1)
    console.log(`[ORCH] [${data.profile}] Reconnecting in ${secs}s (attempt ${data.attempt})`)
    EventBus.emit('bot:reconnecting', data)
  })

  manager.on('error', (data) => {
    console.error(`[ORCH] [${data.profile}] Error — ${data.error.message}`)
    EventBus.emit('bot:error', data)
  })

  manager.start()
  return manager
}

/**
 * Stops a running bot and prevents reconnection.
 * @param {string} profileName
 */
function stopBot(profileName) {
  const manager = managers.get(profileName)
  if (!manager) {
    console.warn(`[ORCH] No manager found for "${profileName}"`)
    return
  }
  manager.stop()
}

/**
 * Returns a snapshot of every managed bot's current state.
 * Useful as the initial data fetch for a GUI.
 * @returns {Array<{ profile: string, state: string, attempt: number, uptime: number|null }>}
 */
function getBotStates() {
  return Array.from(managers.values()).map(m => m.getSnapshot())
}

/**
 * Starts a bot using a GUI instance config.
 * Merges per-instance overrides (username, host, viewerPort, auth cache path)
 * on top of the named profile template, then calls spawnBot with the merged config.
 *
 * @param {{ id:string, profile:string, label?:string, username?:string,
 *           host?:string, port?:number, auth?:string,
 *           viewerEnabled?:boolean, viewerPort?:number,
 *           reconnect?:boolean, maxRetries?:number, baseDelayMs?:number }} instance
 * @returns {BotManager}
 */
function spawnInstance(instance) {
  let base
  try {
    base = require(`./profiles/${instance.profile}`)
  } catch {
    throw new Error(`Unknown profile template "${instance.profile}". Check profiles/ directory.`)
  }

  // Sanitise username so it's safe as a folder name for auth-cache isolation
  const safeUser = (instance.username || base.bot.username)
    .replace(/[^a-zA-Z0-9._-]/g, '_')

  const profileConfig = {
    ...base,
    bot: {
      ...base.bot,
      username: instance.username || base.bot.username,
      host: instance.host || base.bot.host,
      port: Number(instance.port) || base.bot.port,
      auth: instance.auth || base.bot.auth,
      // Each account gets its own auth-cache subfolder to avoid token collisions
      profilesFolder: path.join('./auth-cache', safeUser),
    },
    viewer: {
      ...base.viewer,
      enabled: instance.viewerEnabled ?? base.viewer?.enabled ?? true,
      port: Number(instance.viewerPort) || base.viewer?.port || 3000,
      firstPerson: instance.viewerFirstPerson ?? base.viewer?.firstPerson ?? false,
    },
    // Meta — used by createBotSession for log labels
    _instanceId: instance.id,
    _profileTemplate: instance.profile,
  }

  return spawnBot({
    profile: instance.id,   // use instance ID as the manager-map key
    profileConfig,
    reconnect: instance.reconnect ?? true,
    maxRetries: instance.maxRetries ?? Infinity,
    baseDelayMs: instance.baseDelayMs ?? 5000,
  })
}

module.exports = { spawnBot, spawnInstance, stopBot, getBotStates, EventBus, BotState }

// ── CLI helpers ───────────────────────────────────────────────────────────────
{
  const fs = require('fs')
  const readline = require('readline')

  /** Extract the description lines from a profile file's leading comment block. */
  function readProfileMeta(filePath) {
    let src
    try { src = fs.readFileSync(filePath, 'utf8') } catch { return null }

    const lines = src.split('\n')
    const descLines = []
    let inBlock = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (!inBlock && trimmed.startsWith('// ─── Profile:')) {
        inBlock = true
        continue  // skip the title line itself
      }
      if (inBlock) {
        if (!trimmed.startsWith('//')) break   // end of leading comment
        const text = trimmed.replace(/^\/\/\s?/, '').trim()
        if (text) descLines.push(text)
      }
    }

    return descLines.length ? descLines.join('  ') : '(no description)'
  }

  /** Scan profiles/ and return [{ name, desc }] sorted alphabetically.
   *  When running as a pkg exe, reads from the directory next to the exe
   *  so the friend can add/edit profile files without rebuilding. */
  function listProfiles() {
    const dir = process.pkg
      ? path.join(path.dirname(process.execPath), 'profiles')
      : path.join(__dirname, 'profiles')
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.js') && !f.startsWith('_'))
      .sort()
      .map(f => {
        const name = path.basename(f, '.js')
        const desc = readProfileMeta(path.join(dir, f))
        return { name, desc }
      })
  }

  function registerSIGINT() {
    process.on('SIGINT', () => {
      console.log('\n[ORCH] SIGINT received — stopping all bots...')
      for (const manager of managers.values()) manager.stop()
      setTimeout(() => process.exit(0), 1500)
    })
  }

  function startProfiles(chosen) {
    for (const name of chosen) {
      spawnBot({ profile: name, reconnect: true, maxRetries: Infinity, baseDelayMs: 5000 })
    }
    registerSIGINT()
  }

  function runCLI() {
  // If profiles are passed directly as argv, skip the interactive prompt
  const argvProfiles = process.argv.slice(2)
  if (argvProfiles.length > 0) {
    startProfiles(argvProfiles)
    return
  }

  // ── Interactive profile picker ─────────────────────────────────────────────
  const available = listProfiles()

  if (available.length === 0) {
    console.error('[ORCH] No profiles found in profiles/  (expected .js files that are not _base.js)')
    process.exit(1)
  }

  const BOLD = '\x1b[1m'
  const CYAN = '\x1b[36m'
  const DIM = '\x1b[2m'
  const RESET = '\x1b[0m'

  console.log(`\n${BOLD}Available profiles:${RESET}\n`)
  available.forEach(({ name, desc }, i) => {
    const num = `${CYAN}[${i + 1}]${RESET}`
    const label = `${BOLD}${name}${RESET}`
    console.log(`  ${num} ${label}${DIM}  —  ${desc}${RESET}`)
  })
  console.log()
  console.log(`  ${DIM}Enter numbers (e.g. 1 2  or  1,2,3), or "all"${RESET}`)
  console.log()

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  rl.question(`${BOLD}Profiles to start:${RESET} `, (answer) => {
    rl.close()

    const raw = answer.trim().toLowerCase()

    let chosen
    if (raw === 'all') {
      chosen = available.map(p => p.name)
    } else {
      const indices = raw
        .split(/[\s,]+/)
        .map(s => parseInt(s, 10))
        .filter(n => !isNaN(n))

      const invalid = indices.filter(n => n < 1 || n > available.length)
      if (invalid.length > 0) {
        console.error(`[ORCH] Invalid selection: ${invalid.join(', ')} (valid: 1–${available.length})`)
        process.exit(1)
      }

      if (indices.length === 0) {
        console.error('[ORCH] No profiles selected — exiting.')
        process.exit(1)
      }

      // Deduplicate while preserving order
      chosen = [...new Set(indices.map(n => available[n - 1].name))]
    }

    console.log(`\n[ORCH] Starting: ${chosen.join(', ')}\n`)
    startProfiles(chosen)
  })
  } // end runCLI

  module.exports.runCLI = runCLI

  if (require.main === module) runCLI()
}

