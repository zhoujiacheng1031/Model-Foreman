import { Children, isValidElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceTabs } from '../src/renderer/src/workspace-tabs'
import { changeDocuments, initialDocuments, readDocuments, documentsKey, MAX_WORKSPACE_TABS } from '../src/renderer/src/workspace-documents'
import { emptyTaskDraft, storeTaskDraft } from '../src/renderer/src/task-draft'

afterEach(() => vi.unstubAllGlobals())

function newButton(node: ReactNode): { onClick?: () => void } | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; className?: string; onClick?: () => void }>(child)) continue
    if (child.props.className === 'new-task-button') return child.props
    const found = newButton(child.props.children)
    if (found) return found
  }
}

describe('workspace document actions', () => {
  it('creates a new task instead of selecting the existing draft', () => {
    vi.stubGlobal('window', { requestAnimationFrame: vi.fn() })
    const onSelect = vi.fn(); const onNew = vi.fn()
    const props = { tabs: [{ id: 'draft:1', kind: 'draft' as const, title: '新任务', hasDraft: true }], activeId: 'draft:1', closedDrafts: [], onSelect, onNew, onClose: vi.fn(), onRestore: vi.fn() }
    newButton(WorkspaceTabs(props))?.onClick?.()
    expect(onNew).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('creates independent drafts and preserves each input through repeated switches', () => {
    let state = initialDocuments()
    state = changeDocuments(state, { type: 'update', id: state.activeId, patch: { objective: 'A 的描述' } })
    state = changeDocuments(state, { type: 'new' })
    state = changeDocuments(state, { type: 'update', id: state.activeId, patch: { objective: 'B 的描述', mode: 'goal', criteria: '验收 B' } })
    state = changeDocuments(state, { type: 'select', id: 'draft:1' })
    expect(state.tabs).toHaveLength(2)
    expect(state.tabs[0]).toMatchObject({ draft: { objective: 'A 的描述', mode: 'run' } })
    expect(state.tabs[1]).toMatchObject({ draft: { objective: 'B 的描述', mode: 'goal', criteria: '验收 B' } })
    expect(state.activeId).toBe('draft:1')
  })

  it('bounds open documents without evicting any draft and reuses an already-open run', () => {
    let state = changeDocuments(initialDocuments(), { type: 'open-run', runId: 'existing' })
    while (state.tabs.length < MAX_WORKSPACE_TABS) state = changeDocuments(state, { type: 'new' })
    const before = structuredClone(state)
    expect(() => changeDocuments(state, { type: 'new' })).toThrow('最多打开 8 个页签')
    expect(() => changeDocuments(state, { type: 'open-run', runId: 'new-run' })).toThrow('最多打开 8 个页签')
    expect(state).toEqual(before)
    expect(changeDocuments(state, { type: 'open-run', runId: 'existing' }).activeId).toBe('run:existing')
  })

  it('closes tabs independently, restores a populated draft, and supports closing the last tab', () => {
    let state = changeDocuments(initialDocuments(), { type: 'update', id: 'draft:1', patch: { title: '不能丢失的草稿' } })
    state = changeDocuments(state, { type: 'open-run', runId: 'running-task' })
    state = changeDocuments(state, { type: 'close', id: 'run:running-task' })
    expect(state.activeId).toBe('draft:1')
    state = changeDocuments(state, { type: 'close', id: 'draft:1' })
    expect(state.tabs).toEqual([])
    expect(state.closedDrafts[0].draft.title).toBe('不能丢失的草稿')
    state = changeDocuments(state, { type: 'restore', id: 'draft:1' })
    expect(state.activeId).toBe('draft:1')
    expect(state.closedDrafts).toEqual([])
    expect(state.tabs[0]).toMatchObject({ draft: { title: '不能丢失的草稿' } })
  })

  it('replaces the submitted draft with its task even when all eight slots are used', () => {
    let state = initialDocuments()
    while (state.tabs.length < MAX_WORKSPACE_TABS) state = changeDocuments(state, { type: 'new' })
    const id = state.activeId
    const completed = changeDocuments(state, { type: 'submitted', id, draft: emptyTaskDraft(), runId: 'created' })
    expect(completed.activeId).toBe('run:created')
    expect(completed.tabs).toHaveLength(MAX_WORKSPACE_TABS)
    expect(completed.tabs.some((tab) => tab.id === id)).toBe(false)
  })

  it('does not overwrite edits or switch away from another draft after an asynchronous submission', () => {
    const submitted = { ...emptyTaskDraft(), objective: '已提交版本' }
    let state = initialDocuments(submitted)
    state = changeDocuments(state, { type: 'update', id: 'draft:1', patch: { objective: '请求期间的新输入' } })
    state = changeDocuments(state, { type: 'new' })
    const active = state.activeId
    state = changeDocuments(state, { type: 'submitted', id: 'draft:1', draft: submitted, runId: 'created' })
    expect(state.tabs[0]).toMatchObject({ draft: { objective: '请求期间的新输入' } })
    expect(state.activeId).toBe(active)
    expect(state.tabs.at(-1)).toMatchObject({ kind: 'run', runId: 'created' })
  })

  it('keeps newer input at the limit and keeps a closed draft safe if restoration cannot fit', () => {
    let state = initialDocuments({ ...emptyTaskDraft(), objective: '关闭后可恢复' })
    state = changeDocuments(state, { type: 'close', id: 'draft:1' })
    while (state.tabs.length < MAX_WORKSPACE_TABS) state = changeDocuments(state, { type: 'new' })
    expect(() => changeDocuments(state, { type: 'restore', id: 'draft:1' })).toThrow('最多打开 8 个页签')
    expect(state.closedDrafts[0].draft.objective).toBe('关闭后可恢复')
    const activeId = state.activeId
    state = changeDocuments(state, { type: 'update', id: activeId, patch: { objective: '请求期间的新输入' } })
    const result = changeDocuments(state, { type: 'submitted', id: activeId, draft: emptyTaskDraft(), runId: 'background-task' })
    expect(result).toBe(state)
    expect(result.tabs.at(-1)).toMatchObject({ draft: { objective: '请求期间的新输入' } })
  })

  it('migrates the single draft and restores each project’s own tabs, focus and closed drafts', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
    const legacy = { ...emptyTaskDraft(), objective: '旧版本输入', criteria: '验收', mode: 'goal' as const }
    storeTaskDraft(storage, '/a', legacy)
    let a = readDocuments(storage, '/a')
    expect(a.tabs[0]).toMatchObject({ draft: legacy })
    a = changeDocuments(a, { type: 'close', id: 'draft:1' })
    a = changeDocuments(a, { type: 'open-run', runId: 'task-a' })
    storage.setItem(documentsKey('/a'), JSON.stringify(a))
    expect(readDocuments(storage, '/a')).toEqual(a)
    expect(readDocuments(storage, '/b').tabs[0]).toMatchObject({ draft: { objective: '' } })
    storage.setItem(documentsKey('/a'), '{damaged')
    expect(readDocuments(storage, '/a').tabs[0]).toMatchObject({ draft: legacy })
  })
})
