'use strict'

const fs   = require('fs')
const path = require('path')

const root       = path.join(__dirname, '..')
const profilesDir = path.join(root, 'profiles')
const destDir    = path.join(root, 'dist', 'profiles')

fs.mkdirSync(destDir, { recursive: true })

// Copy every .js file from profiles/ — including _base.js (required by profile files).
const files = fs.readdirSync(profilesDir).filter(f => f.endsWith('.js'))

for (const name of files) {
  fs.copyFileSync(path.join(profilesDir, name), path.join(destDir, name))
  console.log(`[copy-dist-profiles] ${name} → dist/profiles/${name}`)
}
