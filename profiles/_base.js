// ─── Shared base profile ──────────────────────────────────────────────────────
// Shared SERVER config and feature defaults.
// Each profile MUST declare its own bot.username and bot.profilesFolder so that
// concurrent bots always use different accounts (same account = server blocks
// the second connection).
//
//   bot: { ...base.bot, username: 'account@example.com', profilesFolder: './auth-cache/mybot' }

module.exports = {
  // ── Shared server / protocol config ────────────────────────────────────────
  // username and profilesFolder are intentionally absent — set them per-profile.
  bot: {
    host: 'donutsmp.net',
    port: 25565,
    auth: 'microsoft',   // 'offline' | 'microsoft'
    version: '1.20.4',      // false = auto-detect; or pin e.g. '1.21.1'
  },

  // ── Skills fine-tuning ──────────────────────────────────────────────────────
  skills: {
    blockPlaceDelay: 0,           // ms between block placements (0 = instant)
  },

  // ── Viewer ──────────────────────────────────────────────────────────────────
  // Override `port` in each profile so multiple bots can run side-by-side.
  viewer: {
    enabled: false,
    port: 3000,
    firstPerson: false,
  },

  // ── Health heartbeat ────────────────────────────────────────────────────────
  // Every intervalMs a [HEALTH] line is written to session.log with uptime,
  // hp, food, position, and online-player count.  pingCommand is also sent
  // as a chat command — the server's reply appears as [CHAT] confirming the
  // TCP connection is alive.  Set pingCommand: null to skip the command.
  healthCheck: {
    enabled: true,
    intervalMs: 300_000,   // base interval: 5 minutes
    jitterMs: 30_000,   // ±30 s random offset — avoids perfectly mechanical cadence
    pingCommand: '/ping',  // null = log-only (no command sent)
  },

  // ── Protocol debug (all profiles) ───────────────────────────────────────────
  // Set enabled: true or run with MC_PROTOCOL_DEBUG=1 for low-level packet logs.
  // Optional: DEBUG=minecraft-protocol (minecraft-protocol's own verbose trace).
  // For noisy ViaVersion "Chunk size… was read" lines, try bot.hideErrors: true
  // (silences many parser warnings; use only if you accept hidden parse errors).
  protocolDebug: {
    enabled: false,
    logToConsole: true,
    // Relative to cwd. Use true for logs/protocol-<timestamp>.log per run.
    // Override with env: MC_PROTOCOL_LOG_FILE=./logs/my-run.log
    logFile: './logs/protocol1.log',
    logIncomingParsed: true,
    logIncomingRaw: false, // true = hex per packet (huge)
    logOutgoing: true,
    maxJsonLength: 8000,
    maxHexChars: 512,
    onlyPacketNames: ['player_info', 'keep_alive', 'sync_entity_position'],
    // onlyStates: ['play'],
    logErrors: true,
    wrapConsoleForPartialReads: false, // prefix protodef "Chunk size" lines with [PROTO]
  },
}
