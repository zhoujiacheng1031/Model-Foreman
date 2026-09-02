import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const app = fs.readFileSync(path.resolve('src/renderer/src/App.tsx'), 'utf8')
const styles = fs.readFileSync(path.resolve('src/renderer/src/styles.css'), 'utf8')

describe('latest visual alignment feedback', () => {
  it('uses the shared command-bar treatment for the run-history project filter', () => {
    const history = app.slice(app.indexOf('function RunHistoryView'), app.indexOf('function GoalView'))
    expect(history).toContain('className="page-command-bar history-project-bar"')
    expect(history).toContain('className="page-command-icon"')
  })

  it('keeps the sidebar brand English-only', () => {
    const brand = app.slice(app.indexOf('<div className="brand">'), app.indexOf('<button className="sidebar-toggle"'))
    expect(brand).toContain('Model Foreman')
    expect(brand).not.toContain('多模型开发编排')
  })

  it('reserves flexible project-tree height above runtime health', () => {
    expect(styles).toMatch(/\.sidebar-section\s*\{[^}]*height:clamp\(240px,36vh,320px\)[^}]*flex:none/)
    expect(styles).toMatch(/\.runtime-health\s*\{[^}]*flex:none/)
  })

  it('uses one major-card radius across the workbench', () => {
    expect(styles).toContain('.workbench-canvas > .section-anchor > .delivery-control,')
    expect(styles).toMatch(/\.workbench-canvas > \.section-anchor > \.delivery-control,[^}]*border-radius:18px/)
  })

  it('aligns memory labels and controls in explicit field surfaces', () => {
    const memory = app.slice(app.indexOf('function MemoryConfiguration'), app.indexOf('function RoleChip'))
    expect(memory).toContain('className="memory-fields"')
    expect(memory).toContain('className="memory-field provider-field"')
    expect(memory).toContain('<span>Core Endpoint</span>')
    expect(memory).not.toContain('className="provider-field wide"')
    expect(styles).toContain('.memory-body .memory-field,.provider-details .provider-field')
    expect(styles).toContain('.memory-settings input:not([type="checkbox"]),.memory-settings select')
    expect(styles).toMatch(/\.memory-settings input:not\(\[type="checkbox"\]\),\.memory-settings select\s*\{[^}]*border:1\.25px solid[^}]*background:linear-gradient/)
  })
})
