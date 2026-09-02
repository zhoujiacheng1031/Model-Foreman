import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const app = fs.readFileSync(path.resolve('src/renderer/src/App.tsx'), 'utf8')
const styles = fs.readFileSync(path.resolve('src/renderer/src/styles.css'), 'utf8')

const slice = (start: string, end: string) => app.slice(app.indexOf(start), app.indexOf(end))

describe('0.4.6 interface hierarchy and density', () => {
  it('removes redundant hero headers from the five operational pages and settings', () => {
    expect(slice('function RunHistoryView', 'function GoalView')).not.toContain('className="settings-head"')
    expect(slice('function GoalView', 'function Workbench')).not.toContain('className="settings-head"')
    expect(slice('function WorkflowView', 'function AppSettingsView')).not.toContain('className="settings-head"')
    expect(slice('function MemoryView', 'function MemoryConfiguration')).not.toContain('className="settings-head"')
    expect(slice('function AppSettingsView', 'function ApprovalPanel')).not.toContain('className="settings-head"')
    expect(slice('function AppSettingsView', 'function ApprovalPanel')).toContain('className="settings-card-actions"')
  })

  it('keeps workflow model availability beside each role title', () => {
    const workflow = slice('function WorkflowView', 'function AppSettingsView')
    expect(workflow).toContain('className="role-title-line"')
    expect(workflow.indexOf('role-title-line')).toBeLessThan(workflow.indexOf('<label><span>执行器</span>'))
  })

  it('uses a dedicated rounded objective field and one operational card rhythm', () => {
    expect(app).toContain('className="composer-objective"')
    expect(styles).toContain('.composer-card .title-input,.composer-card .composer-objective')
    expect(styles).toContain('border-radius:14px')
    expect(styles).toContain('--operational-page-edge: 12px')
    expect(styles).toContain('--operational-card-gap: 12px')
    expect(styles).toContain('.workbench,.run-history-page,.workflow-page,.goal-page,.memory-page,.app-settings-page')
    expect(styles).toContain('.workbench-layout { gap:var(--operational-card-gap); }')
    expect(styles).toContain('.workbench-canvas { gap:var(--operational-card-gap); }')
  })

  it('keeps the goal action in its command bar and workflow actions in settings', () => {
    expect(slice('function GoalView', 'function Workbench')).toContain('className="page-command-bar"')
    expect(slice('function WorkflowView', 'function AppSettingsView')).toContain('className="memory-settings-head settings-workflow-head"')
    expect(slice('function AppSettingsView', 'function ApprovalPanel')).toContain('<WorkflowView settings={settings}')
    expect(styles).toContain('.page-command-bar')
  })

  it('uses equal-width semantic memory governance actions', () => {
    const memory = slice('function MemoryView', 'function MemoryConfiguration')
    expect(memory).toContain('className="memory-approve-button"')
    expect(memory).toContain('className="memory-reject-button"')
    expect(memory).toContain('<X size={13} />拒绝')
    expect(memory).toContain('className="danger-button memory-delete-button"')
    expect(styles).toMatch(/\.memory-actions > button\s*\{[^}]*width:\s*86px/)
    expect(styles).toMatch(/\.memory-approve-button\s*\{[^}]*background:#f0faf3[^}]*color:#24863e/)
    expect(styles).toMatch(/\.memory-reject-button\s*\{[^}]*background:#fff9e9[^}]*color:#8a6413/)
  })
})
