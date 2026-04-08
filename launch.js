// Entry point for the packaged exe.
// Delegates entirely to orchestrator's CLI path — interactive profile picker
// or argv profiles — same as running `node orchestrator.js` directly.
// Cannot use require.main === module inside orchestrator when packaged (pkg sets
// require.main to this file), so we call runCLI() which is exported for this.
const { runCLI } = require('./orchestrator')
runCLI()
