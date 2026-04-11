'use strict'

// Creates release zips under dist/:
//   sentinel-v<version>.zip              — Windows: sentinel.exe + profiles/
//   sentinel-v<version>-linux-x64.zip   — Linux x64: sentinel + profiles/ (if dist/sentinel exists)
// Excludes auth-cache/ and logs/ (runtime-generated, user-specific).

const fs = require('fs')
const path = require('path')
const archiver = require('archiver')

const root = path.join(__dirname, '..')
const dist = path.join(root, 'dist')
const version = require(path.join(root, 'package.json')).version

function makeReleaseZip ({ outName, binarySrc, nameInZip }) {
  const outPath = path.join(dist, outName)
  if (fs.existsSync(outPath)) fs.rmSync(outPath)

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => {
      const mb = (archive.pointer() / 1024 / 1024).toFixed(1)
      console.log(`[zip-dist] ${outName}  (${mb} MB)`)
      resolve()
    })

    archive.on('warning', err => { if (err.code !== 'ENOENT') reject(err) })
    archive.on('error', reject)

    archive.pipe(output)
    archive.file(binarySrc, { name: nameInZip })
    archive.directory(path.join(dist, 'profiles'), 'profiles')
    archive.finalize()
  })
}

;(async () => {
  const winExe = path.join(dist, 'sentinel.exe')
  if (!fs.existsSync(winExe)) {
    console.error('[zip-dist] missing dist/sentinel.exe — run pnpm build first')
    process.exit(1)
  }

  await makeReleaseZip({
    outName: `sentinel-v${version}.zip`,
    binarySrc: winExe,
    nameInZip: 'sentinel.exe'
  })

  const linuxBin = path.join(dist, 'sentinel')
  if (fs.existsSync(linuxBin)) {
    try {
      fs.chmodSync(linuxBin, 0o755)
    } catch (_) { /* Windows may ignore mode */ }
    await makeReleaseZip({
      outName: `sentinel-v${version}-linux-x64.zip`,
      binarySrc: linuxBin,
      nameInZip: 'sentinel'
    })
  } else {
    console.warn('[zip-dist] skip linux zip: dist/sentinel not found (linux pkg step missing or failed)')
  }
})().catch(err => {
  console.error(err)
  process.exit(1)
})
