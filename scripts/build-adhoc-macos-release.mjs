import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') fail('macOS DMG 只能在 Mac 上构建。')

const project = process.cwd()
const destination = join(project, 'release')
const temporaryRelease = mkdtempSync(join(tmpdir(), 'model-foreman-adhoc-release-'))
const builder = join(project, 'node_modules', '.bin', 'electron-builder')
// This script intentionally produces an ad-hoc package, regardless of CI signing variables.
const buildEnvironment = { ...process.env }
for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'CSC_KEYCHAIN']) delete buildEnvironment[key]

try {
  run(builder, [
    '--mac',
    'dmg',
    '--publish', 'never',
    `--config.directories.output=${temporaryRelease}`,
    '--config.mac.identity=-',
    '--config.mac.notarize=false',
    '--config.mac.entitlements=build/entitlements.adhoc.mac.plist',
    '--config.mac.entitlementsInherit=build/entitlements.adhoc.mac.plist'
  ])

  run(process.execPath, [join(project, 'scripts', 'verify-adhoc-macos-release.mjs'), temporaryRelease])

  const artifacts = readdirSync(temporaryRelease)
    .filter((name) => name.endsWith('.dmg') || name.endsWith('.dmg.blockmap'))
  if (!artifacts.some((name) => name.endsWith('.dmg'))) fail('构建完成后没有找到 DMG。')

  mkdirSync(destination, { recursive: true })
  for (const artifact of artifacts) {
    copyFileSync(join(temporaryRelease, artifact), join(destination, artifact))
  }

  const dmg = artifacts.find((name) => name.endsWith('.dmg'))
  run('hdiutil', ['verify', join(destination, dmg)])
  console.log(`可分发 DMG 已生成：${resolve(destination, basename(dmg))}`)
} finally {
  if (temporaryRelease.startsWith(`${tmpdir()}/model-foreman-adhoc-release-`)) {
    rmSync(temporaryRelease, { recursive: true, force: true })
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: project, stdio: 'inherit', env: buildEnvironment })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function fail(message) {
  console.error(`Ad-hoc release build failed: ${message}`)
  process.exit(1)
}
