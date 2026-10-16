import { useMemo, useRef, useState } from 'react'
import { defaultGoalBudget, goalBudgetError, type GoalBudget } from './goal-budget'

export interface TaskDraft {
  title: string
  objective: string
  mode: 'run' | 'goal'
  criteria: string
  budget: GoalBudget
}
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const browserStorage: DraftStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key)
}
export const draftKey = (workspace: string) => `foreman:task-draft:v1:${encodeURIComponent(workspace)}`
export const emptyTaskDraft = (): TaskDraft => ({ title: '', objective: '', mode: 'run', criteria: '', budget: { ...defaultGoalBudget } })

export function readTaskDraft(storage: Pick<DraftStorage, 'getItem'>, workspace: string): TaskDraft {
  try {
    const value = JSON.parse(storage.getItem(draftKey(workspace)) ?? 'null')
    if (!value || value.version !== 1) return emptyTaskDraft()
    const budget = value.budget
    return { title: typeof value.title === 'string' ? value.title : '', objective: typeof value.objective === 'string' ? value.objective : '',
      mode: value.mode === 'goal' ? 'goal' : 'run', criteria: typeof value.criteria === 'string' ? value.criteria : '',
      budget: budget && typeof budget.unlimitedCost === 'boolean' && typeof budget.cost === 'number' && !goalBudgetError(budget) ? budget : { ...defaultGoalBudget } }
  } catch { return emptyTaskDraft() }
}

export function storeTaskDraft(storage: DraftStorage, workspace: string, draft: TaskDraft): void {
  storage.setItem(draftKey(workspace), JSON.stringify({ version: 1, ...draft }))
}

// Clearing a submitted task must not erase text entered while its request was pending.
export function clearSubmittedDraft(storage: DraftStorage, workspace: string, submitted: TaskDraft, current: TaskDraft): boolean {
  if (JSON.stringify(submitted) !== JSON.stringify(current)) return false
  storage.removeItem(draftKey(workspace))
  return true
}

export function useTaskDraft(workspace: string) {
  const [drafts, setDrafts] = useState<Record<string, TaskDraft>>({})
  const latest = useRef(drafts)
  const [saveErrors, setSaveErrors] = useState<Record<string, boolean>>({})
  const draft = useMemo(() => drafts[workspace] ?? (workspace ? readTaskDraft(browserStorage, workspace) : emptyTaskDraft()), [workspace, drafts])
  const update = (patch: Partial<TaskDraft>) => {
    if (!workspace) return
    const next = { ...(latest.current[workspace] ?? draft), ...patch }
    latest.current = { ...latest.current, [workspace]: next }; setDrafts(latest.current)
    try { storeTaskDraft(browserStorage, workspace, next); setSaveErrors((errors) => ({ ...errors, [workspace]: false })) }
    catch { setSaveErrors((errors) => ({ ...errors, [workspace]: true })) }
  }
  const clearSubmitted = (submitted: TaskDraft) => {
    const current = latest.current[workspace] ?? draft
    if (JSON.stringify(current) !== JSON.stringify(submitted)) return
    latest.current = { ...latest.current, [workspace]: emptyTaskDraft() }; setDrafts(latest.current)
    try { clearSubmittedDraft(browserStorage, workspace, submitted, current); setSaveErrors((errors) => ({ ...errors, [workspace]: false })) }
    catch { setSaveErrors((errors) => ({ ...errors, [workspace]: true })) }
  }
  return { draft, update, clearSubmitted, saveError: Boolean(saveErrors[workspace]) }
}
