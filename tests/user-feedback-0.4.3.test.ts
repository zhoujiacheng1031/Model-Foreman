import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('0.4.3 project hierarchy and workflow polish', () => {
  it('organizes sidebar tasks under collapsible projects named from workspace paths', async () => {
    const app = await readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8')

    expect(app).toContain('sidebarProjects')
    expect(app).toContain('project-run-group')
    expect(app).toContain('<ProjectHeading workspace={project.workspace}')
    expect(app).toContain('workspaceName(project.workspace)')
    expect(app).toContain('project.tasks.map')
  })

  it('lets run history filter tasks by project', async () => {
    const app = await readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8')
    const history = app.slice(app.indexOf('function RunHistoryView'), app.indexOf('function GoalView'))

    expect(history).toContain('run-project-filter')
    expect(history).toContain('visibleRuns')
    expect(history).toContain('workspaceName(run.workspace)')
  })

  it('organizes memory by project and uses collapsible task archives', async () => {
    const app = await readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8')
    const memory = app.slice(app.indexOf('function MemoryView'), app.indexOf('function MemoryConfiguration'))

    expect(memory).toContain('memory-project-filter')
    expect(memory).toContain('memory-project-group')
    expect(memory).toContain('<details className="memory-task-group"')
    expect(memory).toContain('<summary>')
  })

  it('uses colored role outlines without top strips or repeated API diagnostics', async () => {
    const [app, styles] = await Promise.all([
      readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8'),
      readFile(join(root, 'src', 'renderer', 'src', 'styles.css'), 'utf8')
    ])
    const workflow = app.slice(app.indexOf('function WorkflowView'), app.indexOf('function AppSettingsView'))

    expect(workflow).toContain('role-model-status')
    expect(workflow).not.toContain('model-preflight')
    expect(workflow).not.toContain('scannedModel.message')
    expect(styles).not.toContain('.role-card::before')
    expect(styles).toMatch(/\.role-planner\s*\{[^}]*border-color:/)
    expect(styles).toMatch(/\.role-implementer\s*\{[^}]*border-color:/)
    expect(styles).toMatch(/\.role-reviewer\s*\{[^}]*border-color:/)
  })
})
