import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')

describe('Windows release contract', () => {
  it('builds an x64 NSIS installer with an explicit artifact name', () => {
    expect(packageJson.scripts['dist:win']).toContain('electron-builder --win nsis --x64')
    expect(packageJson.build.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
    expect(packageJson.build.win.artifactName).toBe('Model-Foreman-Setup-${version}-${arch}.${ext}')
    expect(packageJson.build.nsis.oneClick).toBe(false)
  })

  it('opens a native command prompt in the selected workspace on Windows', () => {
    expect(main).toContain("process.platform === 'win32'")
    expect(main).toContain("spawn('cmd.exe', ['/K']")
    expect(main).toContain('cwd: workspace')
  })
})
