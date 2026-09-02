import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('topbar panel controls', () => {
  it('places settings, terminal and the workbench inspector toggle in topbar order', async () => {
    const app = await readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8')
    const topbar = app.slice(app.indexOf('<div className="topbar-actions">'), app.indexOf('</header>'))

    expect(topbar.indexOf('topbar-settings')).toBeLessThan(topbar.indexOf('topbar-terminal'))
    expect(topbar.indexOf('topbar-terminal')).toBeLessThan(topbar.indexOf('topbar-panel-toggle'))
    expect(topbar).not.toContain("{view === 'workbench' && <>")
    expect(topbar).toContain('onClick={toggleDeliveryInspector}')
    expect(topbar).toContain('展开运行与交付侧栏')
    expect(topbar).toContain('收起运行与交付侧栏')
  })

  it('keeps the panel control available outside workbench and returns directly to the panel', async () => {
    const app = await readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8')
    expect(app).toContain("if (view !== 'workbench')")
    expect(app).toContain("setView('workbench')")
    expect(app).toContain('setDeliveryInspectorCollapsed(false)')
  })

  it('uses the topbar as the only inspector toggle and fully hides the collapsed rail', async () => {
    const [app, styles] = await Promise.all([
      readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8'),
      readFile(join(root, 'src', 'renderer', 'src', 'styles.css'), 'utf8')
    ])
    const workbench = app.slice(app.indexOf('function Workbench'), app.indexOf('function RepositoryControl'))

    expect(workbench).not.toContain('className="delivery-rail-toggle"')
    expect(workbench).toContain('!props.deliveryInspectorCollapsed && <aside')
    expect(styles).toMatch(/\.workbench\.delivery-rail-collapsed\s+\.workbench-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/)
  })

  it('uses an icon-only floating locator at the bottom center', async () => {
    const [app, styles] = await Promise.all([
      readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8'),
      readFile(join(root, 'src', 'renderer', 'src', 'styles.css'), 'utf8')
    ])
    const jumpbar = app.slice(app.indexOf('<nav className="workbench-jumpbar"'), app.indexOf('</nav>', app.indexOf('<nav className="workbench-jumpbar"')))
    expect(jumpbar).not.toContain('jumpbar-heading')
    expect(jumpbar).not.toContain('<b>')
    expect(jumpbar).toContain('aria-label="定位项目"')
    expect(jumpbar).toContain('aria-label="回到顶部"')
    expect(styles).toMatch(/\.workbench-jumpbar\s*\{[^}]*position:\s*fixed[^}]*bottom:/)
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
