import { describe, expect, it } from 'vitest'
import { filterRuns, initialRunTab, runCategory, runFilters, runStatusClass, runStatusLabel } from '../src/renderer/src/run-presentation'
import type { RunSummary } from '../src/shared/contracts'

function run(id: string, patch: Partial<RunSummary> = {}): RunSummary {
  return { id, title: '修复登录', objective: '改善错误提示', workspace: '/projects/Demo', status: 'completed', createdAt: '', updatedAt: '', ...patch }
}

describe('task status and retrieval', () => {
  it('distinguishes pending delivery, successful delivery and discarded execution, including legacy resolutions', () => {
    for (const resolution of [undefined, 'open'] as const) {
      expect(runStatusLabel(run('pending', { resolution }))).toBe('待交付')
      expect(runCategory(run('pending', { resolution }))).toBe('delivery')
    }
    for (const status of ['completed', 'cancelled'] as const) {
      const merged = run('merged', { status, resolution: 'merged' })
      expect([runStatusLabel(merged), runCategory(merged), runStatusClass(merged)]).toEqual(['已交付', 'delivered', 'delivered'])
      const discarded = run('discarded', { status, resolution: 'discarded' })
      expect([runStatusLabel(discarded), runCategory(discarded), runStatusClass(discarded)]).toEqual(['已放弃', 'discarded', 'discarded'])
    }
  })

  it('keeps both approval phases separate from active work', () => {
    const planning = run('plan', { status: 'awaiting_approval' })
    const reviewing = run('review', { status: 'awaiting_review_approval' })
    expect(runStatusLabel(planning)).toBe('等待规划批准')
    expect(runStatusLabel(reviewing)).toBe('等待审核批准')
    expect(filterRuns([planning, reviewing, run('active', { status: 'implementing' })], { project: 'all', status: 'approval', query: '' }).map(r => r.id)).toEqual(['plan', 'review'])
  })

  it('combines project, state and case-insensitive keyword terms across task fields without changing order', () => {
    const runs = [
      run('match', { branch: 'foreman/TOKEN', title: '安全令牌轮换' }),
      run('delivered', { branch: 'foreman/token', title: '安全令牌轮换', resolution: 'merged' }),
      run('other-project', { workspace: '/projects/Other', branch: 'foreman/token', title: '安全令牌轮换' }),
      run('other-title', { branch: 'foreman/token' })
    ]
    expect(filterRuns(runs, { project: '/projects/Demo', status: 'delivery', query: '  TOKEN   令牌  DEMO ' }).map(r => r.id)).toEqual(['match'])
    expect(filterRuns(runs, { project: 'all', status: 'all', query: '改善错误' })).toEqual(runs)
    expect(filterRuns(runs, { project: 'all', status: 'all', query: '不存在' })).toEqual([])
    expect(filterRuns(runs, { project: 'all', status: 'all', query: ' \n ' })).toEqual(runs)
  })

  it('assigns every execution state to exactly one available filter', () => {
    const statuses: RunSummary['status'][] = ['queued', 'planning', 'awaiting_approval', 'implementing', 'verifying', 'reviewing', 'awaiting_review_approval', 'paused', 'completed', 'failed', 'cancelled']
    const runs = statuses.map(status => run(status, { status }))
    const groups = runFilters.filter(([key]) => key !== 'all').flatMap(([status]) => filterRuns(runs, { project: 'all', status, query: '' }))
    expect(groups).toHaveLength(runs.length)
    expect(new Set(groups.map(r => r.id)).size).toBe(runs.length)
    expect(filterRuns(runs, { project: 'all', status: 'running', query: '' }).map(r => r.id)).toEqual(['queued', 'planning', 'implementing', 'verifying', 'reviewing'])
  })

  it('opens failure evidence first while respecting a valid previously chosen tab', () => {
    const failed = run('failed', { status: 'failed' })
    expect(initialRunTab(failed)).toBe('logs')
    expect(initialRunTab(failed, 'invalid')).toBe('logs')
    expect(initialRunTab(failed, 'evidence')).toBe('evidence')
    expect(initialRunTab(run('waiting', { status: 'awaiting_approval' }), 'overview')).toBe('plan')
    expect(initialRunTab(run('done'))).toBe('overview')
  })
})
