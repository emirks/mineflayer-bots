// ─── Runtime config singleton ─────────────────────────────────────────────────
// Set once at startup (before any other requires) so that lib/skills.js and any
// other module can read the active profile without a hard dependency on config.js.
let _active = {}

module.exports = {
  set: (profile) => { _active = profile },
  get: () => _active,
}
