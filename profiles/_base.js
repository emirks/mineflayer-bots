// ─── Shared base profile ──────────────────────────────────────────────────────
// All profiles spread this so credentials and defaults live in one place.
// Override any key in your profile by redeclaring it after the spread.

module.exports = {
  // ── Bot connection ──────────────────────────────────────────────────────────
  bot: {
    host: 'donutsmp.net',
    port: 25565,
    username: 'babapro334233outlook.com',
    auth: 'microsoft',   // 'offline' | 'microsoft'
    profilesFolder: './auth-cache',
    version: '1.20.4',         // false = auto-detect; or pin e.g. '1.21.1'
  },

  // ── Skills fine-tuning ──────────────────────────────────────────────────────
  skills: {
    blockPlaceDelay: 0,           // ms between block placements (0 = instant)
  },

  // ── Viewer ──────────────────────────────────────────────────────────────────
  // Override `port` in each profile so multiple bots can run side-by-side.
  viewer: {
    enabled: true,
    port: 3000,
    firstPerson: false,
  },

  // ── Protocol debug (all profiles) ───────────────────────────────────────────
  // Set enabled: true or run with MC_PROTOCOL_DEBUG=1 for low-level packet logs.
  // Optional: DEBUG=minecraft-protocol (minecraft-protocol's own verbose trace).
  // For noisy ViaVersion "Chunk size… was read" lines, try bot.hideErrors: true
  // (silences many parser warnings; use only if you accept hidden parse errors).
  protocolDebug: {
    enabled: true,
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
