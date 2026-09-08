import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const app = fs.readFileSync(path.resolve('src/renderer/src/App.tsx'), 'utf8')
const styles = fs.readFileSync(path.resolve('src/renderer/src/styles.css'), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as { version: string }

describe('0.5.0 settings alignment and visible policy status', () => {
  it('uses the operational page rhythm for settings without a hero title', () => {
    const settings = app.slice(app.indexOf('function AppSettingsView'), app.indexOf('function ApprovalPanel'))
    expect(settings).not.toContain('className="settings-head"')
    expect(settings).not.toContain('<h1>设置</h1>')
    expect(styles).toContain('.workbench,.run-history-page,.workflow-page,.goal-page,.memory-page,.app-settings-page')
    expect(styles).toMatch(/\.app-settings-page > section\s*\{[^}]*margin-bottom:var\(--operational-card-gap\)[^}]*border-radius:18px/)
  })

  it('shows gate, approval, and memory policies between the workspace and toolbar', () => {
    const topbar = app.slice(app.indexOf('<header className="topbar">'), app.indexOf('</header>', app.indexOf('<header className="topbar">')))
    expect(topbar).toContain('className="topbar-setting-statuses"')
    expect(topbar).toContain('门禁 ·')
    expect(topbar).toContain('批准 ·')
    expect(topbar).toContain('记忆 ·')
    expect(topbar.indexOf('topbar-setting-statuses')).toBeGreaterThan(topbar.indexOf('workspace-pill'))
    expect(topbar.indexOf('topbar-setting-statuses')).toBeLessThan(topbar.indexOf('topbar-actions'))
  })

  it('ships the latest 0.5.x interface revision', () => {
    expect(packageJson.version).toBe('0.5.7')
  })
})
