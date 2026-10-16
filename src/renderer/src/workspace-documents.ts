import { useMemo, useRef, useState } from 'react'
import { emptyTaskDraft, readTaskDraft, type TaskDraft } from './task-draft'

export const MAX_WORKSPACE_TABS = 8
export const tabLimitMessage = `最多打开 ${MAX_WORKSPACE_TABS} 个页签，请先关闭不需要的页签；关闭任务页签不会停止任务。`
export type DraftDocument = { id: string; kind: 'draft'; number: number; draft: TaskDraft }
export type RunDocument = { id: string; kind: 'run'; runId: string }
export type WorkspaceDocument = DraftDocument | RunDocument
export interface WorkspaceDocuments {
  version: 1; tabs: WorkspaceDocument[]; activeId: string; nextDraft: number; closedDrafts: DraftDocument[]
}
type DocumentStorage = Pick<Storage, 'getItem' | 'setItem'>
export const documentsKey = (workspace: string) => `foreman:workspace-documents:v1:${encodeURIComponent(workspace)}`
export const hasDraftContent = (draft: TaskDraft) => JSON.stringify(draft) !== JSON.stringify(emptyTaskDraft())
const runDocument = (runId: string): RunDocument => ({ id: `run:${runId}`, kind: 'run', runId })

export function initialDocuments(draft = emptyTaskDraft()): WorkspaceDocuments {
  return { version: 1, tabs: [{ id: 'draft:1', kind: 'draft', number: 1, draft }], activeId: 'draft:1', nextDraft: 2, closedDrafts: [] }
}

function parseDocument(value: unknown): WorkspaceDocument | undefined {
  if (!value || typeof value !== 'object') return
  const item = value as Record<string, unknown>
  if (item.kind === 'run' && typeof item.runId === 'string' && item.runId) return runDocument(item.runId)
  if (item.kind !== 'draft' || !Number.isSafeInteger(item.number) || Number(item.number) < 1 || !item.draft || typeof item.draft !== 'object') return
  const draft = readTaskDraft({ getItem: () => JSON.stringify({ ...item.draft as object, version: 1 }) }, '')
  return { id: `draft:${item.number}`, kind: 'draft', number: Number(item.number), draft }
}

export function readDocuments(storage: DocumentStorage, workspace: string): WorkspaceDocuments {
  try {
    const value = JSON.parse(storage.getItem(documentsKey(workspace)) ?? 'null')
    if (value?.version === 1 && Array.isArray(value.tabs)) {
      const seen = new Set<string>()
      const unique = (items: unknown[]): WorkspaceDocument[] => items.map(parseDocument).filter((item): item is WorkspaceDocument => {
        if (!item || seen.has(item.id)) return false
        seen.add(item.id); return true
      })
      const all = unique(value.tabs)
      const closedDrafts = [...all.slice(MAX_WORKSPACE_TABS), ...unique(Array.isArray(value.closedDrafts) ? value.closedDrafts : [])].filter((item): item is DraftDocument => item.kind === 'draft')
      const tabs = all.slice(0, MAX_WORKSPACE_TABS)
      const largest = Math.max(0, ...[...tabs, ...closedDrafts].map((tab) => tab.kind === 'draft' ? tab.number : 0))
      const nextDraft = Math.max(largest + 1, Number.isSafeInteger(value.nextDraft) ? value.nextDraft : 1)
      if (!tabs.length) tabs.push({ id: `draft:${nextDraft}`, kind: 'draft', number: nextDraft, draft: emptyTaskDraft() })
      return { version: 1, tabs, closedDrafts, activeId: tabs.some((tab) => tab.id === value.activeId) ? value.activeId : tabs[0].id, nextDraft: Math.max(nextDraft, ...tabs.map((tab) => tab.kind === 'draft' ? tab.number + 1 : 1)) }
    }
  } catch { /* Recover the previous single draft if the document store is damaged. */ }
  return initialDocuments(readTaskDraft(storage, workspace))
}

export type DocumentAction =
  | { type: 'new' }
  | { type: 'select'; id: string }
  | { type: 'update'; id: string; patch: Partial<TaskDraft> }
  | { type: 'open-run'; runId: string }
  | { type: 'close'; id: string }
  | { type: 'restore'; id: string }
  | { type: 'submitted'; id: string; draft: TaskDraft; runId?: string }

export function changeDocuments(state: WorkspaceDocuments, action: DocumentAction): WorkspaceDocuments {
  if (action.type === 'select') return state.tabs.some((tab) => tab.id === action.id) ? { ...state, activeId: action.id } : state
  if (action.type === 'update') return { ...state, tabs: state.tabs.map((tab) => tab.id === action.id && tab.kind === 'draft' ? { ...tab, draft: { ...tab.draft, ...action.patch } } : tab) }
  if (action.type === 'close') {
    const closing = state.tabs.find((tab) => tab.id === action.id)
    if (!closing) return state
    const index = state.tabs.indexOf(closing)
    const tabs = state.tabs.filter((tab) => tab.id !== action.id)
    const closedDrafts = closing.kind === 'draft' && hasDraftContent(closing.draft) ? [closing, ...state.closedDrafts] : state.closedDrafts
    // The last tab can close too; the empty workspace offers a clear new-task action.
    return { ...state, tabs, closedDrafts, activeId: state.activeId === closing.id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? '') : state.activeId }
  }
  if (action.type === 'submitted') {
    const source = state.tabs.find((tab) => tab.id === action.id)
    const unchanged = source?.kind === 'draft' && JSON.stringify(source.draft) === JSON.stringify(action.draft)
    if (unchanged) {
      const replacement = action.runId ? runDocument(action.runId) : { ...source, draft: emptyTaskDraft() }
      return { ...state, tabs: state.tabs.map((tab) => tab.id === source.id ? replacement : tab), activeId: state.activeId === source.id ? replacement.id : state.activeId }
    }
    // A submitted revision must not overwrite edits or steal focus from another tab.
    if (!action.runId || state.tabs.some((tab) => tab.id === `run:${action.runId}`) || state.tabs.length >= MAX_WORKSPACE_TABS) return state
    return { ...state, tabs: [...state.tabs, runDocument(action.runId)] }
  }
  if (action.type === 'open-run') {
    const tab = runDocument(action.runId)
    if (state.tabs.some((item) => item.id === tab.id)) return { ...state, activeId: tab.id }
    if (state.tabs.length >= MAX_WORKSPACE_TABS) throw new Error(tabLimitMessage)
    return { ...state, tabs: [...state.tabs, tab], activeId: tab.id }
  }
  if (state.tabs.length >= MAX_WORKSPACE_TABS) throw new Error(tabLimitMessage)
  if (action.type === 'restore') {
    const tab = state.closedDrafts.find((tab) => tab.id === action.id)
    return tab ? { ...state, tabs: [...state.tabs, tab], activeId: tab.id, closedDrafts: state.closedDrafts.filter((item) => item.id !== tab.id) } : state
  }
  const tab: DraftDocument = { id: `draft:${state.nextDraft}`, kind: 'draft', number: state.nextDraft, draft: emptyTaskDraft() }
  return { ...state, tabs: [...state.tabs, tab], activeId: tab.id, nextDraft: state.nextDraft + 1 }
}

export function useWorkspaceDocuments(workspace: string) {
  const [states, setStates] = useState<Record<string, WorkspaceDocuments>>({})
  const latest = useRef(states)
  const [saveErrors, setSaveErrors] = useState<Record<string, boolean>>({})
  const get = (path: string): WorkspaceDocuments => {
    if (!latest.current[path]) latest.current[path] = path ? readDocuments(window.localStorage, path) : initialDocuments()
    return latest.current[path]
  }
  const state = useMemo(() => get(workspace), [workspace, states])
  const active = state.tabs.find((tab) => tab.id === state.activeId)
  const change = (path: string, action: DocumentAction) => {
    if (!path) return
    const next = changeDocuments(get(path), action)
    latest.current = { ...latest.current, [path]: next }; setStates(latest.current)
    try { window.localStorage.setItem(documentsKey(path), JSON.stringify(next)); setSaveErrors((errors) => ({ ...errors, [path]: false })) }
    catch { setSaveErrors((errors) => ({ ...errors, [path]: true })) }
  }
  return { state, active, change, get, saveError: Boolean(saveErrors[workspace]), draft: active?.kind === 'draft' ? active.draft : emptyTaskDraft(),
    update: (patch: Partial<TaskDraft>) => { if (active?.kind === 'draft') change(workspace, { type: 'update', id: active.id, patch }) } }
}
