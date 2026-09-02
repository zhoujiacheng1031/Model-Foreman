import { describe, expect, it, vi } from 'vitest'
import { RunLifecycleService } from '../src/main/run-lifecycle'
import { ForemanDatabase } from '../src/main/storage/database'
import type { RunSummary, TaskInput } from '../src/shared/contracts'

function failedRun(database: ForemanDatabase, prepared = false): RunSummary {
  const run = database.createRun({ title: '失败任务', objective: '修复登录', workspace: '/repo' })
  database.updateRun(run.id, {
    status: 'failed',
    error: '执行失败',
    ...(prepared ? { executionWorkspace: '/tmp/worktree', branch: 'foreman/failure', baseCommit: 'base', isolated: true } : {})
  })
  return database.getRun(run.id)!.run
}

describe('RunLifecycleService', () => {
  it('重试会创建全新运行并保留旧失败记录', () => {
    const database = new ForemanDatabase(':memory:', '/repo')
    const failed = failedRun(database)
    const starter = { start: vi.fn((input: TaskInput) => database.createRun(input)) }
    const service = new RunLifecycleService(database, starter, { discard: vi.fn() })

    const retried = service.retry(failed.id)

    expect(starter.start).toHaveBeenCalledWith({ title: failed.title, objective: failed.objective, workspace: failed.workspace })
    expect(retried.id).not.toBe(failed.id)
    expect(retried.status).toBe('queued')
    expect(database.getRun(failed.id)?.run.status).toBe('failed')
  })

  it('删除已建立工作区的失败任务时先清理 worktree 和分支', async () => {
    const database = new ForemanDatabase(':memory:', '/repo')
    const failed = failedRun(database, true)
    const discard = vi.fn(async (runId: string) => {
      database.updateRun(runId, { resolution: 'discarded' })
      return database.getRun(runId)!.run
    })
    const service = new RunLifecycleService(database, { start: vi.fn() }, { discard })

    await service.delete(failed.id)

    expect(discard).toHaveBeenCalledWith(failed.id)
    expect(database.getRun(failed.id)).toBeNull()
  })

  it('早期失败尚未创建工作区时可直接删除记录和日志', async () => {
    const database = new ForemanDatabase(':memory:', '/repo')
    const failed = failedRun(database)
    database.addEvent({ runId: failed.id, at: new Date().toISOString(), phase: 'failed', kind: 'error', message: '失败' })
    const discard = vi.fn()
    const service = new RunLifecycleService(database, { start: vi.fn() }, { discard })

    await service.delete(failed.id)

    expect(discard).not.toHaveBeenCalled()
    expect(database.getRun(failed.id)).toBeNull()
  })

  it('清理工作区失败时保留任务记录便于诊断', async () => {
    const database = new ForemanDatabase(':memory:', '/repo')
    const failed = failedRun(database, true)
    const service = new RunLifecycleService(database, { start: vi.fn() }, { discard: vi.fn(async () => { throw new Error('清理失败') }) })

    await expect(service.delete(failed.id)).rejects.toThrow('清理失败')
    expect(database.getRun(failed.id)?.run.status).toBe('failed')
  })

  it('源工作文件夹已被用户删除时仍可删除任务记录', async () => {
    const database = new ForemanDatabase(':memory:', '/repo')
    const failed = failedRun(database, true)
    database.addEvent({ runId: failed.id, at: new Date().toISOString(), phase: 'failed', kind: 'error', message: '目录已删除' })
    const discard = vi.fn(async () => { throw new Error("fatal: cannot change to '/repo': No such file or directory") })
    const service = new RunLifecycleService(database, { start: vi.fn() }, { discard })

    await service.delete(failed.id)

    expect(discard).toHaveBeenCalledWith(failed.id)
    expect(database.getRun(failed.id)).toBeNull()
  })

  it('Goal 引用的运行不允许单独重试或删除', async () => {
    const database = new ForemanDatabase(':memory:', '/repo')
    const failed = failedRun(database)
    const goal = database.createGoal({
      title: '长期目标', objective: '交付产品', workspace: '/repo', successCriteria: ['测试通过'], constraints: [],
      priority: 50, maxIterations: 3, maxTaskAttempts: 2
    }, 'fingerprint')
    database.updateGoalTask(goal.tasks[0].id, { runId: failed.id, runHistoryIds: [failed.id] })
    const service = new RunLifecycleService(database, { start: vi.fn() }, { discard: vi.fn() })

    expect(() => service.retry(failed.id)).toThrow('长期 Goal')
    await expect(service.delete(failed.id)).rejects.toThrow('长期 Goal')
    expect(database.getRun(failed.id)).not.toBeNull()
  })
})
