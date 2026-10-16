import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { emptyTaskDraft, readTaskDraft, storeTaskDraft, clearSubmittedDraft, draftKey } from '../src/renderer/src/task-draft'
import { taskProgress } from '../src/renderer/src/task-progress'
import { WorkspaceTabs } from '../src/renderer/src/workspace-tabs'
import type { RunSummary } from '../src/shared/contracts'

function storage() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}

describe('task document workspace', () => {
  it('restores project-specific input, goal criteria and explicit budget choices without mixing projects', () => {
    const local = storage()
    const a = { ...emptyTaskDraft(), title: 'A', objective: '认证', mode: 'goal' as const, criteria: '刷新测试通过', budget: { ...emptyTaskDraft().budget, cost: 3 } }
    const b = { ...emptyTaskDraft(), objective: '文档' }
    storeTaskDraft(local, '/repo/a', a); storeTaskDraft(local, '/repo/b', b)
    expect(readTaskDraft(local, '/repo/a')).toEqual(a)
    expect(readTaskDraft(local, '/repo/b')).toEqual(b)
    expect(readTaskDraft(local, '/repo/c')).toEqual(emptyTaskDraft())
    local.setItem(draftKey('/repo/c'), '{corrupt')
    expect(readTaskDraft(local, '/repo/c').budget.unlimitedCost).toBe(false)
    local.setItem(draftKey('/repo/c'), JSON.stringify({ version: 1, objective: '保留输入', budget: { cost: 0 } }))
    expect(readTaskDraft(local, '/repo/c')).toMatchObject({ objective: '保留输入', budget: { cost: 5, unlimitedCost: false } })
  })

  it('clears only the submitted revision after success, preserving newer edits and other projects', () => {
    const local = storage()
    const submitted = { ...emptyTaskDraft(), objective: '第一次输入' }
    const newer = { ...submitted, objective: '等待期间的新输入' }
    storeTaskDraft(local, '/a', newer); storeTaskDraft(local, '/b', submitted)
    expect(clearSubmittedDraft(local, '/a', submitted, newer)).toBe(false)
    expect(readTaskDraft(local, '/a').objective).toBe(newer.objective)
    expect(clearSubmittedDraft(local, '/a', newer, newer)).toBe(true)
    expect(readTaskDraft(local, '/a')).toEqual(emptyTaskDraft())
    expect(readTaskDraft(local, '/b')).toEqual(submitted)
  })

  it('distinguishes skipped validation, pending approval and pending delivery from successful delivery', () => {
    const run = { status: 'completed', resolution: 'open', verification: { status: 'skipped', passed: true } } as RunSummary
    expect(taskProgress(run)[2]).toEqual({ label: '验证已跳过', state: 'skipped' })
    expect(taskProgress(run)[4]).toEqual({ label: '待交付', state: 'active' })
    expect(taskProgress({ ...run, resolution: 'merged' })[4]).toEqual({ label: '已交付', state: 'done' })
    expect(taskProgress({ ...run, status: 'awaiting_review_approval' })[3]).toEqual({ label: '审核待确认', state: 'active' })
    expect(taskProgress({ ...run, resolution: 'discarded' })[4]).toEqual({ label: '已放弃', state: 'stopped' })
    expect(taskProgress({ ...run, status: 'failed', checkpointPhase: 'verifying', verification: undefined })[2].state).toBe('failed')
  })

  it('renders a persistent named draft entry while inspecting a task and links each tab to its panel', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceTabs, { tabs: [{ id: 'run:1', kind: 'run', title: '已有任务' }, { id: 'draft:1', kind: 'draft', title: '新任务', hasDraft: true }], activeId: 'run:1', closedDrafts: [], onSelect: () => {}, onNew: () => {}, onClose: () => {}, onRestore: () => {} }))
    expect(html).toContain('新任务 · 草稿')
    expect(html).toContain('aria-controls="workspace-draft-panel"')
    expect(html).toContain('aria-controls="workspace-run-panel" aria-selected="true"')
    expect(html).toContain('class="new-task-button"')
  })
})
