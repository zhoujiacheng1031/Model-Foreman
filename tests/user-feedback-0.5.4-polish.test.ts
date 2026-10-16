import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')

describe('0.5.4 workbench and settings polish', () => {
  it('places auto-save state with custom model controls', () => {
    const workflow = app.slice(app.indexOf('function WorkflowView'), app.indexOf('function AppSettingsView'))
    const environment = app.slice(app.indexOf('function AppSettingsView'), app.indexOf('function ApprovalPanel'))
    expect(workflow).toContain('custom-model-heading-actions')
    expect(workflow).toContain("notice || '修改后自动保存'")
    expect(environment).toContain('settings-content-heading')
    expect(environment).toContain('role="status"')
  })

  it('gives workbench roles distinct borders and aligns the two composer actions', () => {
    expect(app).toContain('role-chip-${role}')
    expect(css).toContain('.role-chip-planner')
    expect(css).toContain('.role-chip-implementer')
    expect(css).toContain('.role-chip-reviewer')
    expect(app).toContain('className="composer-submit-actions"')
    expect(css).toContain('.composer-submit-actions > button { width:152px')
  })

  it('emphasizes task inputs and animates a shared card container for all run tabs', () => {
    expect(app).toContain('className="composer-input-stack"')
    expect(css).toContain('.composer-input-stack:focus-within')
    expect(app).toContain('key={runTab} role="tabpanel"')
    expect(css).toContain('@keyframes run-tab-enter')
    expect(css).toContain('.run-tab-panel { padding:12px; border:1px')
  })
})
