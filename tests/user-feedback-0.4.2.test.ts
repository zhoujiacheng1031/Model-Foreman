import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('0.4.2 product feedback regressions', () => {
  it('keeps the task context menu local instead of masking the whole app', async () => {
    const [app, styles] = await Promise.all([
      readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8'),
      readFile(join(root, 'src', 'renderer', 'src', 'styles.css'), 'utf8')
    ])

    expect(app).not.toContain('run-context-backdrop')
    expect(styles).not.toContain('.run-context-backdrop')
    expect(app).toContain('role="menu"')
  })

  it('offers run-history actions without nesting them inside the row opener', async () => {
    const app = await readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8')
    const source = app.slice(app.indexOf('function RunHistoryView'), app.indexOf('function GoalView'))

    expect(source).toContain('onDelete: (run: RunSummary) => void')
    expect(source).toContain('className="run-history-actions"')
    expect(source).toContain('删除任务')
    expect(source).toContain('重试任务')
  })

  it('uses compact model diagnostics and equal-height orchestration cards', async () => {
    const [app, styles] = await Promise.all([
      readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8'),
      readFile(join(root, 'src', 'renderer', 'src', 'styles.css'), 'utf8')
    ])

    expect(app).toContain('compactCapabilityMessage')
    expect(styles).toMatch(/\.role-card-wrap\s*\{[^}]*align-items:\s*stretch/)
    expect(styles).toMatch(/\.role-card\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/)
    expect(styles).toMatch(/\.model-capability-card\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/)
    expect(styles).toMatch(/\.model-preflight span\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/)
  })

  it('keeps the terminal control icon-only and removes the Local First badge', async () => {
    const app = await readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8')
    const topbar = app.slice(app.indexOf('<header className="topbar">'), app.indexOf('</header>'))

    expect(topbar).toContain('aria-label="打开命令行"')
    expect(topbar).not.toContain('<span>打开命令行</span>')
    expect(topbar).not.toContain('LOCAL FIRST')
  })

  it('organizes governed memory by its source task', async () => {
    const app = await readFile(join(root, 'src', 'renderer', 'src', 'App.tsx'), 'utf8')
    const source = app.slice(app.indexOf('function MemoryView'), app.indexOf('function MemoryConfiguration'))

    expect(source).toContain('memory-task-filter')
    expect(source).toContain('memory-status-filter')
    expect(source).toContain('memory-task-group')
    expect(source).toContain('sourceRunId')
    expect(source).toContain('来源任务已删除')
  })
})
