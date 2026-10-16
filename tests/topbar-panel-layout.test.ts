import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('topbar panel controls', () => {
  it('keeps settings and terminal next to a labeled new-task entry', async () => {
    const app = await readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8')
    const topbar = app.slice(app.indexOf('<div className="topbar-actions">'), app.indexOf('</header>'))
    expect(topbar.indexOf('topbar-settings')).toBeLessThan(topbar.indexOf('topbar-terminal'))
    expect(topbar.indexOf('topbar-terminal')).toBeLessThan(topbar.indexOf('topbar-new-task'))
    expect(topbar).toContain('onClick={newTask}')
    expect(app).toContain("changeDocument({ type: 'new' })")
    expect(app).not.toContain('toggleDeliveryInspector')
  })

  it('uses document tabs instead of the floating page locator', async () => {
    const app = await readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8')
    expect(app).toContain('<WorkspaceTabs')
    expect(app).not.toContain('<nav className="workbench-jumpbar"')
    expect(app).not.toContain('className="workbench-inspector"')
  })

  it('removes the task-tree indent line while retaining global run history', async () => {
    const [styles, database] = await Promise.all([
      readFile(join(root, 'src', 'renderer', 'src', 'styles.css'), 'utf8'),
      readFile(join(root, 'src', 'main', 'storage', 'database.ts'), 'utf8')
    ])
    expect(styles).toMatch(/\.project-run-group \.run-list\s*\{[^}]*padding-left:\s*0[^}]*border-left:\s*0/)
    expect(database).toContain('SELECT * FROM runs ORDER BY created_at DESC')
  })

  it('keeps runtime health as the final and bottom-anchored sidebar section', async () => {
    const [app, styles] = await Promise.all([
      readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8'),
      readFile(join(root, 'src', 'renderer', 'src', 'styles.css'), 'utf8')
    ])
    const sidebar = app.slice(app.indexOf('<aside className="sidebar">'), app.indexOf('</aside>'))

    expect(sidebar).not.toContain('secondary-nav')
    expect(sidebar.lastIndexOf('runtime-health')).toBeGreaterThan(sidebar.lastIndexOf('sidebar-section'))
    expect(styles).toMatch(/\.runtime-health\s*\{[^}]*margin-top:\s*auto/)
  })
})
