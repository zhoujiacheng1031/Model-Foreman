import type { RunSummary, TaskInput } from '../shared/contracts'
import { ForemanDatabase } from './storage/database'

interface RunStarter {
  start(input: TaskInput): RunSummary
}

interface RunDiscarder {
  discard(runId: string): Promise<RunSummary>
}

export class RunLifecycleService {
  constructor(
    private readonly database: ForemanDatabase,
    private readonly starter: RunStarter,
    private readonly discarder: RunDiscarder
  ) {}

  retry(runId: string): RunSummary {
    const run = this.failedRun(runId)
    this.assertStandalone(runId)
    return this.starter.start({ title: run.title, objective: run.objective, workspace: run.workspace })
  }

  async delete(runId: string): Promise<void> {
    const run = this.deletableRun(runId)
    this.assertStandalone(runId)
    if ((run.resolution ?? 'open') === 'open' && run.executionWorkspace && run.branch && run.baseCommit) {
      try { await this.discarder.discard(runId) }
      catch (error) {
        if (!workspaceWasRemoved(error)) throw error
      }
    }
    if (!this.database.deleteRun(runId)) throw new Error('任务不存在或已经删除')
  }

  private deletableRun(runId: string): RunSummary {
    const run = this.database.getRun(runId)?.run
    if (!run) throw new Error('任务不存在')
    if (['queued', 'planning', 'implementing', 'verifying', 'reviewing'].includes(run.status)) throw new Error('请先中止正在执行的任务，再删除')
    return run
  }

  private failedRun(runId: string): RunSummary {
    const run = this.database.getRun(runId)?.run
    if (!run) throw new Error('任务不存在')
    if (run.status !== 'failed') throw new Error('只有失败任务可以重试或删除')
    return run
  }

  private assertStandalone(runId: string): void {
    if (this.database.isRunReferencedByGoal(runId)) {
      throw new Error('该任务属于长期 Goal，请在 Goal 页面重试或重新规划，不能单独删除。')
    }
  }
}

function workspaceWasRemoved(error: unknown): boolean {
  const message = error instanceof Error ? messageWithCause(error) : String(error)
  return /\bENOENT\b|no such file or directory|cannot change to .+?:/i.test(message)
}

function messageWithCause(error: Error): string {
  const cause = (error as Error & { cause?: unknown }).cause
  return `${error.message} ${cause instanceof Error ? cause.message : cause ? String(cause) : ''}`
}
