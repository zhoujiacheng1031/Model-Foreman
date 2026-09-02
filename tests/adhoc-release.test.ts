import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }
const entitlements = readFileSync(new URL('../build/entitlements.adhoc.mac.plist', import.meta.url), 'utf8')
const verifier = readFileSync(new URL('../scripts/verify-adhoc-macos-release.mjs', import.meta.url), 'utf8')
const afterPack = readFileSync(new URL('../scripts/after-pack.mjs', import.meta.url), 'utf8')
const builder = readFileSync(new URL('../scripts/build-adhoc-macos-release.mjs', import.meta.url), 'utf8')

describe('ad-hoc macOS distribution', () => {
  it('explicitly signs and verifies sealed app resources inside the DMG', () => {
    expect(packageJson.scripts['dist:mac:adhoc']).toContain('build-adhoc-macos-release.mjs')
    expect(builder).toContain('--config.mac.identity=-')
    expect(builder).toContain('--config.mac.notarize=false')
    expect(builder).toContain('verify-adhoc-macos-release.mjs')
    expect(builder).toContain("mkdtempSync(join(tmpdir(), 'model-foreman-adhoc-release-'))")
    expect(builder).toContain("copyFileSync(join(temporaryRelease, artifact)")
    expect(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).build.afterPack).toBe('scripts/after-pack.mjs')
    expect(entitlements).toContain('com.apple.security.cs.disable-library-validation')
    expect(afterPack).toContain("spawnSync('xattr', ['-cr', app]")
    expect(verifier).toContain("'--verify', '--deep', '--strict'")
    expect(verifier).toContain("resolve(process.argv[2] ?? 'release')")
    expect(verifier).toContain('Sealed Resources version=2')
    expect(verifier).toContain("'attach', dmg")
  })
})
