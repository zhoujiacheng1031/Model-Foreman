import { mkdtempSync, readdirSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') fail('macOS 临时签名验证只能在 Mac 上执行。')

const release = resolve(process.argv[2] ?? 'release')
const appCandidates = ['mac-arm64', 'mac', 'mac-universal', 'mac-x64'].map((dir) => join(release, dir, 'Model Foreman.app'))
const app = appCandidates.find((path) => succeeds('test', ['-d', path]))
if (!app) fail('找不到 Model Foreman.app。')

verifyApp(app)

const dmgs = readdirSync(release)
  .filter((name) => name.endsWith('.dmg'))
  .map((name) => join(release, name))
  .sort((left, right) => modifiedAt(right) - modifiedAt(left))
if (!dmgs[0]) fail('找不到 DMG。')

const dmg = dmgs[0]
run('hdiutil', ['verify', dmg])
const mountpoint = mkdtempSync(join(tmpdir(), 'model-foreman-adhoc-'))
try {
  run('hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mountpoint])
  verifyApp(join(mountpoint, 'Model Foreman.app'))
} finally {
  run('hdiutil', ['detach', mountpoint])
  rmdirSync(mountpoint)
}

console.log(`Ad-hoc DMG verified: ${basename(dmg)}`)
console.log('注意：签名结构有效，但没有 Developer ID，首次打开仍需用户在“隐私与安全性”中手动允许。')

function verifyApp(path) {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', path])
  const details = capture('codesign', ['-dv', '--verbose=2', path])
  if (!details.includes('Signature=adhoc')) fail(`${path} 不是完整的临时签名。`)
  if (!details.includes('Identifier=com.modelforeman.app')) fail(`${path} 的 Bundle Identifier 不正确。`)
  if (!details.includes('Sealed Resources version=2')) fail(`${path} 没有密封资源，接收方会看到“应用已损坏”。`)
}

function modifiedAt(path) { return Number(capture('stat', ['-f', '%m', path]).trim()) }
function succeeds(command, args) { return spawnSync(command, args).status === 0 }
function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) fail(`${command} ${args.join(' ')} 失败：${result.stderr || result.stdout}`)
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
function fail(message) { console.error(`Ad-hoc release verification failed: ${message}`); process.exit(1) }
