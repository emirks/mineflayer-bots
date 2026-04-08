'use strict'

// Creates dist/sentinel-v<version>.zip containing everything the friend needs:
//   sentinel.exe  +  profiles/
// Excludes auth-cache/ and logs/ (runtime-generated, user-specific).

const fs      = require('fs')
const path    = require('path')
const archiver = require('archiver')

const root    = path.join(__dirname, '..')
const dist    = path.join(root, 'dist')
const version = require(path.join(root, 'package.json')).version
const outName = `sentinel-v${version}.zip`
const outPath = path.join(dist, outName)

// Remove previous zip of the same version before writing a new one
if (fs.existsSync(outPath)) fs.rmSync(outPath)

const output  = fs.createWriteStream(outPath)
const archive = archiver('zip', { zlib: { level: 9 } })

output.on('close', () => {
  const mb = (archive.pointer() / 1024 / 1024).toFixed(1)
  console.log(`[zip-dist] ${outName}  (${mb} MB)`)
})

archive.on('warning', err => { if (err.code !== 'ENOENT') throw err })
archive.on('error',   err => { throw err })

archive.pipe(output)

// sentinel.exe at root of zip
archive.file(path.join(dist, 'sentinel.exe'), { name: 'sentinel.exe' })

// profiles/ folder
archive.directory(path.join(dist, 'profiles'), 'profiles')

archive.finalize()
