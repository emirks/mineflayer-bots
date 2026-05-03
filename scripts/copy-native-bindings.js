'use strict'

// Copies the compiled better_sqlite3.node native binding to dist/ so that
// bot-dashboard.exe (pkg) can load it from the real filesystem at runtime.
// Native .node files cannot execute from inside pkg's virtual snapshot.

const fs   = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const dist = path.join(root, 'dist')

// Resolve the binding by asking Node where better-sqlite3 lives, then walk up
// to find the compiled .node file (works regardless of pnpm version).
const bs3Root = path.join(
  path.dirname(require.resolve('better-sqlite3')),
  '..' // up from lib/ to package root
)

function findNode (dir, depth = 0) {
  if (depth > 5) return null
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      const found = findNode(full, depth + 1)
      if (found) return found
    } else if (f === 'better_sqlite3.node') {
      return full
    }
  }
  return null
}

const src = findNode(bs3Root)
if (!src) {
  console.error('[copy-native-bindings] Could not find better_sqlite3.node under', bs3Root)
  process.exit(1)
}

fs.mkdirSync(dist, { recursive: true })
const dest = path.join(dist, 'better_sqlite3.node')
fs.copyFileSync(src, dest)
console.log(`[copy-native-bindings] ${src}\n  → dist/better_sqlite3.node`)
