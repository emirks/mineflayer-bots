'use strict'
// Builds gui/client (Vite) before the pkg packaging step.
// Called automatically by "pnpm run build-gui" / "pnpm run build-gui-linux".

const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')

const clientDir = path.join(__dirname, '..', 'gui', 'client')
const distDir   = path.join(clientDir, 'dist')

console.log('[build-gui-client] Building React frontend…')
execSync('pnpm build', { cwd: clientDir, stdio: 'inherit' })

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('[build-gui-client] ✖ dist/index.html missing after build!')
  process.exit(1)
}
console.log('[build-gui-client] ✔ Frontend built →', distDir)
