import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const app = fs.readFileSync(path.resolve('src/renderer/src/App.tsx'), 'utf8')
const styles = fs.readFileSync(path.resolve('src/renderer/src/styles.css'), 'utf8')

describe('workflow settings placement and readable runtime output', () => {
  it('uses an opaque dark console for expanded logs', () => {
    expect(styles).toMatch(/\.event-panel \.terminal-log\s*\{[^}]*background:#111319[^}]*color:#d8dce7/)
    expect(styles).toMatch(/\.event-panel \.model-output-card pre\s*\{[^}]*background:#111319[^}]*color:#edf0f6/)
  })

  it('moves role and workflow configuration into settings', () => {
    const sidebar = app.slice(app.indexOf('<nav className="primary-nav">'), app.indexOf('</nav>', app.indexOf('<nav className="primary-nav">')))
    const settings = app.slice(app.indexOf('function AppSettingsView'), app.indexOf('function ApprovalPanel'))
    expect(sidebar).not.toContain('角色与流程')
    expect(settings).toContain('<WorkflowView settings={settings}')
    expect(app).toContain('id="role-workflow-settings"')
    expect(app).not.toContain("view === 'workflow'")
  })

  it('links the workbench shortcut to workflow settings', () => {
    const workbench = app.slice(app.indexOf('function Workbench'), app.indexOf('function DeliveryGuidePanel'))
    expect(workbench).toContain('className="workflow-settings-shortcut"')
    expect(workbench.indexOf('workflow-settings-shortcut')).toBeLessThan(workbench.indexOf("taskMode === 'goal' ? <Target"))
    expect(workbench).toContain('onClick={props.onConfigureWorkflow}')
    expect(app).toContain("document.getElementById('role-workflow-settings')?.scrollIntoView")
  })
})
