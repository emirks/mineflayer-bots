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
    version: false,         // false = auto-detect; or pin e.g. '1.21.1'
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
}
