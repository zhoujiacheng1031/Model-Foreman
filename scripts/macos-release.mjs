import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') fail('macOS release 必须在安装了 Xcode Command Line Tools 的 Mac 上执行。')
const identity = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
const hasLocalIdentity = identity.stdout.includes('Developer ID Application:')
const hasImportedIdentity = Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD)
if (!hasLocalIdentity && !hasImportedIdentity) fail('未找到 Developer ID Application 私钥。请安装证书到钥匙串，或设置 CSC_LINK 与 CSC_KEY_PASSWORD。')

const appleId = Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)
const apiKey = Boolean(process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER)
const keychain = Boolean(process.env.APPLE_KEYCHAIN_PROFILE)
if (![appleId, apiKey, keychain].some(Boolean)) fail('未配置公证凭据。请设置 App Store Connect API Key、Apple ID 三变量，或 APPLE_KEYCHAIN_PROFILE。')

run('npm', ['run', 'typecheck']); run('npm', ['test']); run('npm', ['run', 'build'])
run('npx', ['electron-builder', '--mac', 'dmg', 'zip', '--publish', 'never'])
run('node', ['scripts/verify-macos-release.mjs'])

function run(command, args) { const result=spawnSync(command,args,{stdio:'inherit',env:process.env}); if(result.status!==0) process.exit(result.status??1) }
function fail(message) { console.error(`Release preflight failed: ${message}`); process.exit(1) }
