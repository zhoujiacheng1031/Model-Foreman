import { describe, expect, it } from 'vitest'
import { DeliveryService } from '../src/main/delivery'
import { ForemanDatabase } from '../src/main/storage/database'
import type { RunSummary } from '../src/shared/contracts'
import type { PreparedWorkspace, WorkspaceManager } from '../src/main/workspace/types'

class FakeWorkspaceManager implements WorkspaceManager {
  merged = false
  discarded = false
  async prepare(): Promise<PreparedWorkspace> {
    return { path: '/tmp/test', branch: 'foreman/test', baseCommit: 'base', isolated: true, sourceDirty: false, initializedRepository: false }
  }
  async inspect() { return { diff: '--- /dev/null\n+++ b/new.txt\n--- a/removed.txt\n+++ /dev/null', stat: '2 files changed', filesChanged: 2, additions: 2, deletions: 1 } }
  async merge() { this.merged = true; return { commit: '1234567890abcdef' } }
  async discard() { this.discarded = true; return {} }
}

class GuidedWorkspace extends FakeWorkspaceManager {
  sourceChanges = { staged: 0, unstaged: 1, untracked: 1 }
  taskChanges = { staged: 0, unstaged: 1, untracked: 0 }
  protectedRef: string | undefined
  mergedCommit = false
  cleaned = false
  async inspectDelivery() { return { sourceChanges: this.sourceChanges, taskChanges: this.taskChanges, sourceFiles: ['README.md', 'notes.txt'], taskFiles: ['feature.txt'], protectedRef: this.protectedRef, merged: this.mergedCommit, commit: '1234567890abcdef' } }
  async protectSource() { this.protectedRef = 'stash@{0}'; this.sourceChanges = { staged: 0, unstaged: 0, untracked: 0 } }
  async commitTask() { this.taskChanges = { staged: 0, unstaged: 0, untracked: 0 }; return '1234567890abcdef' }
  async mergeCommitted() { this.mergedCommit = true; return '1234567890abcdef' }
  async restoreSource() { this.protectedRef = undefined; this.sourceChanges = { staged: 0, unstaged: 1, untracked: 1 } }
  async cleanupMerged() { this.cleaned = true }
}

describe('DeliveryService', () => {
  it('合并后记录交付状态和事件', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd())
    const manager = new FakeWorkspaceManager()
    const delivered: string[] = []
    const service = new DeliveryService(database, manager, (event) => delivered.push(event.message))
    const run = preparedRun(database, 'completed')

    const result = await service.merge(run.id)

    expect(manager.merged).toBe(true)
    expect(result.resolution).toBe('merged')
    expect(result.deliveryEvidence).toEqual({ commit: '1234567890abcdef', changedFiles: ['new.txt', 'removed.txt'], stat: '2 files changed' })
    expect(database.getRun(run.id)?.run.deliveryEvidence).toEqual(result.deliveryEvidence)
    expect(delivered[0]).toContain('fast-forward')
  })

  it('放弃等待批准的任务时同时取消并清理', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd())
    const manager = new FakeWorkspaceManager()
    const service = new DeliveryService(database, manager, () => {})
    const run = preparedRun(database, 'awaiting_approval')

    const result = await service.discard(run.id)

    expect(manager.discarded).toBe(true)
    expect(result.resolution).toBe('discarded')
    expect(result.status).toBe('cancelled')
  })

  it('启动恢复会把中断任务转为可恢复检查点，但保留等待批准状态', () => {
    const database = new ForemanDatabase(':memory:', process.cwd())
    const running = database.createRun({ title: '运行中', objective: '测试', workspace: process.cwd() })
    const waiting = database.createRun({ title: '待批准', objective: '测试', workspace: process.cwd() })
    database.updateRun(running.id, { status: 'implementing' })
    database.updateRun(waiting.id, { status: 'awaiting_approval' })

    expect(database.recoverInterruptedRuns()).toBe(1)
    expect(database.getRun(running.id)?.run.status).toBe('paused')
    expect(database.getRun(running.id)?.run.checkpointPhase).toBe('implementing')
    expect(database.getRun(running.id)?.run.error).toContain('检查点')
    expect(database.getRun(waiting.id)?.run.status).toBe('awaiting_approval')
  })

  it('交付向导只解锁当前步骤并在恢复用户改动后才清理', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd())
    const manager = new GuidedWorkspace()
    const service = new DeliveryService(database, manager, () => {})
    const run = preparedRun(database, 'completed')

    expect((await service.guide(run.id)).steps.find((step) => step.key === 'protect_source')?.status).toBe('ready')
    await service.executeStep(run.id, 'protect_source')
    expect((await service.guide(run.id)).steps.find((step) => step.key === 'commit_task')?.status).toBe('ready')
    await service.executeStep(run.id, 'commit_task')
    await service.executeStep(run.id, 'merge_branch')
    expect((await service.guide(run.id)).steps.find((step) => step.key === 'restore_source')?.status).toBe('ready')
    await service.executeStep(run.id, 'restore_source')
    const result = await service.executeStep(run.id, 'cleanup')

    expect(manager.cleaned).toBe(true)
    expect('resolution' in result && result.resolution).toBe('merged')
    expect(database.getRun(run.id)?.run.deliveryEvidence?.changedFiles).toEqual(['new.txt', 'removed.txt'])
  })
})

function preparedRun(database: ForemanDatabase, status: RunSummary['status']): RunSummary {
  const run = database.createRun({ title: '交付测试', objective: '测试', workspace: process.cwd() })
  database.updateRun(run.id, {
    status, executionWorkspace: '/tmp/test', branch: 'foreman/test', baseCommit: 'base', isolated: true
  })
  return database.getRun(run.id)!.run
}
