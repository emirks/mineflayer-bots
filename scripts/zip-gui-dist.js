'use strict'

// Creates dist/bot-dashboard-v<version>.zip containing:
//   bot-dashboard.exe          — the packaged server + frontend
//   profiles/                  — all .js profile configs (copied by copy-dist-profiles.js)
//   auth-cache/                — stored Microsoft auth tokens (no re-auth needed)
//
// Excluded intentionally:
//   bot-dashboard.db / .db-shm / .db-wal  — created fresh on first run
//   logs/                                  — runtime, user-specific

const fs       = require('fs')
const path     = require('path')
const archiver = require('archiver')

const root    = path.join(__dirname, '..')
const dist    = path.join(root, 'dist')
const version = require(path.join(root, 'package.json')).version
const outName = `bot-dashboard-v${version}.zip`
const outPath = path.join(dist, outName)

const exePath      = path.join(dist, 'bot-dashboard.exe')
const bindingPath  = path.join(dist, 'better_sqlite3.node')
const profilesDir  = path.join(dist, 'profiles')
const authCacheDir = path.join(root, 'auth-cache')  // always from live source, not dist copy

if (!fs.existsSync(exePath)) {
  console.error('[zip-gui-dist] Missing dist/bot-dashboard.exe — run "pnpm run build-gui" first')
  process.exit(1)
}
if (!fs.existsSync(bindingPath)) {
  console.error('[zip-gui-dist] Missing dist/better_sqlite3.node — run "node scripts/copy-native-bindings.js" first')
  process.exit(1)
}
if (!fs.existsSync(profilesDir)) {
  console.error('[zip-gui-dist] Missing dist/profiles/ — run "node scripts/copy-dist-profiles.js" first')
  process.exit(1)
}

if (fs.existsSync(outPath)) fs.rmSync(outPath)

const output  = fs.createWriteStream(outPath)
const archive = archiver('zip', { zlib: { level: 6 } })

output.on('close', () => {
  const mb = (archive.pointer() / 1024 / 1024).toFixed(1)
  console.log(`[zip-gui-dist] ✔  ${outName}  (${mb} MB)  →  dist/${outName}`)
  console.log('\nContents:')
  console.log('  bot-dashboard.exe')
  console.log('  better_sqlite3.node')
  console.log('  profiles/')
  if (fs.existsSync(authCacheDir)) console.log('  auth-cache/')
  console.log('\nDrop this folder anywhere and run bot-dashboard.exe')
})
archive.on('warning', err => { if (err.code !== 'ENOENT') throw err })
archive.on('error',   err => { throw err })

archive.pipe(output)

// Exe
archive.file(exePath, { name: 'bot-dashboard.exe' })

// Native SQLite binding (must sit next to the exe — cannot run from inside pkg snapshot)
archive.file(bindingPath, { name: 'better_sqlite3.node' })

// Profiles (all .js)
archive.directory(profilesDir, 'profiles')

// Auth-cache — skip if it doesn't exist (fresh machine)
if (fs.existsSync(authCacheDir)) {
  archive.directory(authCacheDir, 'auth-cache')
} else {
  console.warn('[zip-gui-dist] auth-cache/ not found — zip will not include it (bots will need to sign in on first run)')
}

archive.finalize()
