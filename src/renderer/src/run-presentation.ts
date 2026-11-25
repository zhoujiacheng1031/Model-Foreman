import type { RunStatus, RunSummary } from '../../shared/contracts'

const phaseLabels: Record<RunStatus, string> = {
  queued: '准备隔离环境', planning: '规划中', awaiting_approval: '等待规划批准',
  implementing: '执行中', verifying: '验证中', reviewing: '审核中',
  awaiting_review_approval: '等待审核批准', paused: '已暂停',
  completed: '待交付', failed: '失败', cancelled: '已取消'
}

export const runFilters = [
  ['all', '全部状态'], ['running', '进行中'], ['approval', '等待批准'],
  ['delivery', '待交付'], ['delivered', '已交付'], ['failed', '失败'],
  ['paused', '已暂停'], ['discarded', '已放弃'], ['cancelled', '已取消']
] as const
export type RunFilter = typeof runFilters[number][0]
type RunState = Pick<RunSummary, 'status' | 'resolution'>

export function runCategory(run: RunState): Exclude<RunFilter, 'all'> {
  if (run.resolution === 'merged') return 'delivered'
  if (run.resolution === 'discarded') return 'discarded'
  if (run.status === 'completed') return 'delivery'
  if (run.status === 'awaiting_approval' || run.status === 'awaiting_review_approval') return 'approval'
  if (run.status === 'failed' || run.status === 'paused' || run.status === 'cancelled') return run.status
  return 'running'
}

/** Delivery resolution takes precedence over the final execution phase, including older records. */
export function runStatusLabel(run: RunState): string {
  if (run.resolution === 'merged') return '已交付'
  if (run.resolution === 'discarded') return '已放弃'
  return phaseLabels[run.status]
}

export function runStatusClass(run: RunState): string {
  return run.resolution === 'merged' ? 'delivered' : run.resolution === 'discarded' ? 'discarded' : run.status
}

export function filterRuns(runs: RunSummary[], filters: { project: string; status: RunFilter; query: string }) {
  const terms = filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return runs.filter(run => {
    if (filters.project !== 'all' && run.workspace !== filters.project) return false
    if (filters.status !== 'all' && runCategory(run) !== filters.status) return false
    const text = [run.title, run.objective, run.workspace, run.branch ?? ''].join('\n').toLocaleLowerCase()
    return terms.every(term => text.includes(term))
  })
}

export type RunDetailTab = 'overview' | 'plan' | 'evidence' | 'resources' | 'logs' | 'delivery'
export function initialRunTab(run?: RunState, savedTab?: string | null): RunDetailTab {
  if (run?.status === 'awaiting_approval') return 'plan'
  if (savedTab && ['overview', 'plan', 'evidence', 'resources', 'logs', 'delivery'].includes(savedTab)) return savedTab as RunDetailTab
  return run?.status === 'failed' ? 'logs' : 'overview'
}
