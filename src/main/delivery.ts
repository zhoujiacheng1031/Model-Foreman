import type { DeliveryGuide, DeliveryGuideAction, DeliveryGuideStep, RunEvent, RunSummary, WorkspaceInspection } from '../shared/contracts'
import { ForemanDatabase } from './storage/database'
import type { WorkspaceManager } from './workspace/types'
import type { MemoryModule } from './memory/types'
import { ForemanMemoryModule } from './memory/memory-module'

type EventSink = (event: RunEvent) => void

export class DeliveryService {
  constructor(
    private readonly database: ForemanDatabase,
    private readonly workspaces: WorkspaceManager,
    private readonly sink: EventSink,
    private readonly memory: MemoryModule = new ForemanMemoryModule(database)
  ) {}

  inspect(runId: string): Promise<WorkspaceInspection> {
    return this.workspaces.inspect(this.run(runId))
  }

  async merge(runId: string): Promise<RunSummary> {
    const run = this.run(runId)
    if (run.status !== 'completed') throw new Error('只有通过审核的任务才能自动合并')
    if ((run.resolution ?? 'open') !== 'open') throw new Error('任务已经处理，不能重复合并')
    const inspection = await this.workspaces.inspect(run)
    const result = await this.workspaces.merge(run)
    return this.finalizeMerged(runId, inspection, result.commit, result.cleanupWarning)
  }

  async guide(runId: string): Promise<DeliveryGuide> {
    const run = this.run(runId)
    if (run.status !== 'completed') throw new Error('只有通过审核的任务才能进入交付向导')
    if ((run.resolution ?? 'open') !== 'open') throw new Error('任务已经处理，不能重复合并')
    if (!this.workspaces.inspectDelivery) throw new Error('当前工作区不支持分步交付')
    const state = await this.workspaces.inspectDelivery(run)
    const sourceDirty = changeTotal(state.sourceChanges) > 0
    const taskDirty = changeTotal(state.taskChanges) > 0
    const sourceReady = !sourceDirty || state.merged
    const steps: DeliveryGuideStep[] = [
      {
        key: 'protect_source', title: '保护源项目已有改动',
        description: state.merged ? '任务分支已合并。' : sourceDirty
          ? `发现已暂存 ${state.sourceChanges.staged} 个、未暂存 ${state.sourceChanges.unstaged} 个、未跟踪 ${state.sourceChanges.untracked} 个文件：${fileSummary(state.sourceFiles)}。Foreman 会临时保护，合并后原样恢复。`
          : state.protectedRef ? '已将源项目的原有改动临时保护。' : '源项目干净，不需要额外处理。',
        status: state.merged || !sourceDirty ? 'done' : 'ready', actionLabel: sourceDirty && !state.merged ? '临时保护已有改动' : undefined
      },
      {
        key: 'commit_task', title: '创建任务提交',
        description: taskDirty ? `隔离工作区有 ${changeTotal(state.taskChanges)} 个待提交文件：${fileSummary(state.taskFiles)}；提交只包含本任务改动。` : '任务改动已有独立提交，或本次没有文件变化。',
        status: taskDirty ? (sourceReady ? 'ready' : 'pending') : 'done', actionLabel: taskDirty && sourceReady ? '创建任务提交' : undefined
      },
      {
        key: 'merge_branch', title: '快进合并任务分支',
        description: state.merged ? `提交 ${state.commit.slice(0, 10)} 已合并到源项目。` : '仅在源项目状态安全且任务提交完成后执行 fast-forward。',
        status: state.merged ? 'done' : sourceReady && !taskDirty ? 'ready' : 'pending', actionLabel: !state.merged && sourceReady && !taskDirty ? '合并任务分支' : undefined
      },
      {
        key: 'restore_source', title: '恢复源项目原有改动',
        description: !state.merged ? '合并完成后才会恢复。' : state.protectedRef ? '将临时保护的已暂存、未暂存和未跟踪文件恢复到源项目。' : '源项目原有改动已恢复，或不需要恢复。',
        status: !state.merged ? 'pending' : state.protectedRef ? 'ready' : 'done', actionLabel: state.merged && state.protectedRef ? '恢复已有改动' : undefined
      },
      {
        key: 'cleanup', title: '清理隔离工作区', description: '确认交付完成后，删除 Foreman worktree 和已合并的任务分支。',
        status: state.merged && !state.protectedRef ? 'ready' : 'pending', actionLabel: state.merged && !state.protectedRef ? '完成交付并清理' : undefined
      }
    ]
    return { runId, sourceChanges: state.sourceChanges, taskChanges: state.taskChanges, sourceFiles: state.sourceFiles, taskFiles: state.taskFiles, protectedRef: state.protectedRef, merged: state.merged, steps }
  }

  async executeStep(runId: string, action: DeliveryGuideAction): Promise<DeliveryGuide | RunSummary> {
    const run = this.run(runId)
    const guide = await this.guide(runId)
    if (guide.steps.find((step) => step.key === action)?.status !== 'ready') throw new Error('该交付步骤尚未就绪，请按顺序完成前置步骤')
    if (action === 'protect_source') await required(this.workspaces.protectSource, '保护源项目改动').call(this.workspaces, run)
    if (action === 'commit_task') await required(this.workspaces.commitTask, '创建任务提交').call(this.workspaces, run)
    if (action === 'merge_branch') await required(this.workspaces.mergeCommitted, '合并任务分支').call(this.workspaces, run)
    if (action === 'restore_source') await required(this.workspaces.restoreSource, '恢复源项目改动').call(this.workspaces, run)
    this.emit(runId, 'status', deliveryActionMessage(action))
    if (action !== 'cleanup') return this.guide(runId)
    const inspection = await this.workspaces.inspect(run)
    const state = await required(this.workspaces.inspectDelivery, '检查交付状态').call(this.workspaces, run)
    await required(this.workspaces.cleanupMerged, '清理隔离工作区').call(this.workspaces, run)
    return this.finalizeMerged(runId, inspection, state.commit)
  }

  async discard(runId: string): Promise<RunSummary> {
    const run = this.run(runId)
    const allowed = ['awaiting_approval', 'completed', 'failed', 'cancelled']
    if (!allowed.includes(run.status)) throw new Error('任务仍在运行，请先停止任务')
    if ((run.resolution ?? 'open') !== 'open') throw new Error('任务已经处理，不能重复放弃')
    await this.workspaces.discard(run)
    this.database.updateRun(runId, {
      resolution: 'discarded',
      ...(run.status === 'awaiting_approval' ? { status: 'cancelled' as const } : {})
    })
    this.emit(runId, 'status', '已放弃任务并清理 worktree 与任务分支')
    return this.run(runId)
  }

  private run(runId: string): RunSummary {
    const detail = this.database.getRun(runId)
    if (!detail) throw new Error('任务不存在')
    return detail.run
  }

  private emit(runId: string, kind: RunEvent['kind'], message: string): void {
    const run = this.run(runId)
    this.sink(this.database.addEvent({ runId, phase: run.status, kind, message, at: new Date().toISOString() }))
  }

  private async finalizeMerged(runId: string, inspection: WorkspaceInspection, commit: string, cleanupWarning?: string): Promise<RunSummary> {
    this.database.updateRun(runId, { resolution: 'merged', deliveryEvidence: { commit, changedFiles: changedFiles(inspection.diff), stat: inspection.stat } })
    this.emit(runId, 'result', `已 fast-forward 合并到源仓库，提交 ${commit.slice(0, 10)}`)
    const merged = this.run(runId)
    try {
      const candidates = await this.memory.captureVerifiedOutcome(merged, { commit, changedFiles: changedFiles(inspection.diff) }, this.database.getSettings())
      if (candidates.length) this.emit(runId, 'status', `已生成 ${candidates.length} 条长期记忆候选，等待治理确认`)
    } catch (error) {
      this.emit(runId, 'stderr', `任务已合并，但记忆候选生成失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (cleanupWarning) this.emit(runId, 'stderr', cleanupWarning)
    return merged
  }
}

function changeTotal(counts: { staged: number; unstaged: number; untracked: number }): number { return counts.staged + counts.unstaged + counts.untracked }
function fileSummary(files: string[]): string { return files.length > 4 ? `${files.slice(0, 4).join('、')} 等 ${files.length} 个` : files.join('、') || '无可列出文件' }
function required<T extends (...args: never[]) => unknown>(method: T | undefined, label: string): T {
  if (!method) throw new Error(`当前工作区不支持：${label}`)
  return method
}
function deliveryActionMessage(action: DeliveryGuideAction): string {
  return ({ protect_source: '已临时保护源项目原有改动', commit_task: '已创建独立的任务提交', merge_branch: '已快进合并任务分支', restore_source: '已恢复源项目原有改动', cleanup: '已完成交付清理' })[action]
}

function changedFiles(diff: string): string[] {
  return [...new Set([...diff.matchAll(/^(?:--- a\/|\+\+\+ b\/)(.+)$/gm)].map((match) => match[1]))]
}
