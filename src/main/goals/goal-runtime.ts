import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { GoalCommand, GoalDetail, GoalInput, GoalTask } from '../../shared/contracts'
import { ForemanDatabase } from '../storage/database'
import { Orchestrator } from '../orchestrator'
import { DeliveryService } from '../delivery'
import { ensureWorkspaceBaseline } from '../workspace/bootstrap'

export type WorkspaceFingerprint = (workspace: string) => Promise<string>

export class GoalRuntime {
  private readonly ticking = new Set<string>()
  constructor(private readonly db: ForemanDatabase, private readonly orchestrator: Orchestrator, private readonly delivery: DeliveryService, private readonly fingerprint: WorkspaceFingerprint = gitFingerprint) {}

  async create(input: GoalInput): Promise<GoalDetail> {
    const detail = this.db.createGoal(input, await this.fingerprint(input.workspace))
    await this.tick(detail.goal.id)
    return this.get(detail.goal.id)!
  }
  list() { return this.db.listGoals() }
  get(id: string) { return this.db.getGoal(id) }

  async command(id: string, command: GoalCommand): Promise<GoalDetail> {
    const detail = this.required(id); const current = detail.tasks.find((task) => task.id === detail.goal.currentTaskId)
    if (command === 'pause') {
      if (current?.runId) { const run = this.db.getRun(current.runId)?.run; if (run && ['queued','planning','implementing','verifying','reviewing'].includes(run.status)) await this.orchestrator.pause(run.id) }
      this.db.updateGoal(id, { status: 'paused', terminalReason: '用户暂停' })
    } else if (command === 'cancel') {
      if (current?.runId) this.orchestrator.cancel(current.runId)
      this.db.updateGoal(id, { status: 'cancelled', terminalReason: '用户取消' })
    } else if (command === 'revalidate') {
      for (const task of detail.tasks) if (task.status === 'completed' || task.status === 'invalidated') this.db.updateGoalTask(task.id, { status: task.order === 0 ? 'ready' : 'pending', runHistoryIds:[...new Set([...task.runHistoryIds,...(task.runId?[task.runId]:[])])], runId: undefined, evidence: undefined })
      this.db.updateGoal(id, { status: 'active', currentTaskId: undefined, terminalReason: '', workspaceFingerprint: await this.fingerprint(detail.goal.workspace) })
      await this.tick(id)
    } else if (command === 'replan') {
      if (!current || !['blocked','failed'].includes(current.status)) throw new Error('只有阻塞任务可以重新规划')
      this.db.updateGoalTask(current.id,{status:'ready',attempt:0,runHistoryIds:[...new Set([...current.runHistoryIds,...(current.runId?[current.runId]:[])])],runId:undefined,evidence:undefined})
      this.db.updateGoal(id,{status:'active',currentTaskId:undefined,iteration:detail.goal.iteration+1,terminalReason:'用户启动新的 Goal 规划循环'})
      await this.tick(id)
    } else {
      this.db.updateGoal(id, { status: 'active', terminalReason: '' })
      if (current?.runId && this.db.getRun(current.runId)?.run.status === 'paused') this.orchestrator.resume(current.runId)
      await this.tick(id)
    }
    return this.required(id)
  }

  async tick(id: string): Promise<void> {
    if (this.ticking.has(id)) return
    this.ticking.add(id)
    try { await this.advance(id) } finally { this.ticking.delete(id) }
  }

  private async advance(id: string): Promise<void> {
    let detail = this.required(id); const goal = detail.goal
    if (['paused','blocked','completed','failed','cancelled'].includes(goal.status)) return
    if (goal.timeBudgetSeconds && Date.now() - new Date(goal.createdAt).getTime() > goal.timeBudgetSeconds * 1000) return this.failGoal(id, '时间预算已耗尽')
    if (goal.tokenBudget && goal.tokensUsed >= goal.tokenBudget) return this.failGoal(id, 'Token 预算已耗尽')
    if (goal.costBudgetUsd && goal.costUsedUsd >= goal.costBudgetUsd) return this.failGoal(id, '费用预算已耗尽')
    if (goal.iteration >= goal.maxIterations) return this.failGoal(id, '最大 Goal 循环次数已耗尽')

    const current = detail.tasks.find((task) => task.id === goal.currentTaskId)
    if (current?.runId) {
      const run = this.db.getRun(current.runId)?.run
      if (!run) return this.block(id, current, '关联任务记录丢失')
      if (run.status === 'paused') { this.orchestrator.resume(run.id); return }
      if (run.status === 'awaiting_approval') { this.db.updateGoalTask(current.id, { status: 'waiting_approval' }); this.db.updateGoal(id, { status: 'waiting_approval' }); return }
      if (['queued','planning','implementing','verifying','reviewing'].includes(run.status)) return
      if (run.status === 'completed') {
        try {
          const merged = (run.resolution ?? 'open') === 'open' ? await this.delivery.merge(run.id) : run
          const evidence = { runId: run.id, commit: merged.verification?.commit, workspaceFingerprint: merged.verification?.workspaceFingerprint, verificationStatus: merged.verification?.status, reviewerVerdict: merged.reviewDecision?.verdict, merged: (this.db.getRun(run.id)?.run.resolution === 'merged') }
          if (!evidence.merged || evidence.verificationStatus === 'failed' || evidence.reviewerVerdict !== 'approved') return this.block(id, current, '完成证据不满足 Goal 裁决规则')
          this.db.updateGoalTask(current.id, { status: 'completed', evidence })
          this.db.updateGoal(id, { iteration: goal.iteration + 1, currentTaskId: undefined, status: 'active', workspaceFingerprint: await this.fingerprint(goal.workspace), terminalReason: '' })
          detail = this.required(id)
        } catch (error) { return this.block(id, current, `自动交付失败：${message(error)}`) }
      } else if (['failed','cancelled'].includes(run.status)) {
        if (current.attempt < current.maxAttempts) {
          this.db.updateGoalTask(current.id, { status: 'ready', runHistoryIds:[...new Set([...current.runHistoryIds,run.id])], runId: undefined })
          this.db.updateGoal(id, { currentTaskId: undefined, status: 'active', iteration: goal.iteration + 1, terminalReason: `任务失败，准备第 ${current.attempt + 1} 次重试` })
          detail = this.required(id)
        } else return this.block(id, current, `任务已达到最大尝试次数：${run.error ?? run.status}`)
      }
    }

    const completed = new Set(detail.tasks.filter((task) => task.status === 'completed').map((task) => task.id))
    if (detail.tasks.every((task) => task.status === 'completed')) {
      const valid = detail.tasks.every((task) => task.evidence?.merged && task.evidence.reviewerVerdict === 'approved' && task.evidence.verificationStatus !== 'failed')
      return valid ? void this.db.updateGoal(id, { status: 'completed', currentTaskId: undefined, terminalReason: '全部成功标准均有已合并的审核与验证证据' }) : this.failGoal(id, '最终证据审计失败')
    }

    const observed = await this.fingerprint(detail.goal.workspace)
    if (detail.goal.workspaceFingerprint && observed !== detail.goal.workspaceFingerprint) {
      for (const task of detail.tasks.filter((item) => item.status === 'completed')) this.db.updateGoalTask(task.id, { status: 'invalidated' })
      this.db.updateGoal(id, { status: 'paused', terminalReason: '检测到 Foreman 之外的工作区变化；已完成证据需要重新验证' }); return
    }

    for (const task of detail.tasks.filter((item) => item.status === 'pending' && item.dependencies.every((dependency) => completed.has(dependency)))) this.db.updateGoalTask(task.id, { status: 'ready' })
    detail = this.required(id)
    const next = detail.tasks.filter((task) => task.status === 'ready').sort((a,b) => a.order - b.order)[0]
    if (!next) return this.db.updateGoal(id, { status: 'blocked', terminalReason: '任务图没有可运行节点，可能存在未满足依赖' })
    const run = this.orchestrator.start({ title: `${goal.title} · ${next.title}`, objective: next.objective, workspace: goal.workspace })
    this.db.updateGoalTask(next.id, { status: 'running', runId: run.id, attempt: next.attempt + 1 })
    this.db.updateGoal(id, { status: 'active', currentTaskId: next.id, terminalReason: '' })
  }

  private required(id: string) { const detail = this.db.getGoal(id); if (!detail) throw new Error('Goal 不存在'); return detail }
  private failGoal(id: string, reason: string) { this.db.updateGoal(id, { status: 'failed', terminalReason: reason }) }
  private block(id: string, task: GoalTask, reason: string) { this.db.updateGoalTask(task.id, { status: 'blocked' }); this.db.updateGoal(id, { status: 'blocked', terminalReason: reason }) }
}

export class DurableScheduler {
  private timer?: ReturnType<typeof setInterval>
  constructor(private readonly runtime: GoalRuntime, private readonly intervalMs = 1500) {}
  start(): void { if (this.timer) return; void this.tick(); this.timer = setInterval(() => void this.tick(), this.intervalMs) }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined }
  async tick(): Promise<void> { for (const goal of this.runtime.list().filter((item) => ['active','waiting_approval'].includes(item.status))) await this.runtime.tick(goal.id) }
}

async function gitFingerprint(workspace: string): Promise<string> {
  const baseline = await ensureWorkspaceBaseline(workspace)
  return createHash('sha256').update(await capture(baseline.repository, ['rev-parse','HEAD'])).update(await capture(baseline.repository, ['status','--porcelain=v1','-z'])).digest('hex')
}
function capture(cwd: string, args: string[]): Promise<Buffer> { return new Promise((resolve,reject) => { const child=spawn('git',args,{cwd}); const chunks:Buffer[]=[]; child.stdout.on('data',(chunk:Buffer)=>chunks.push(chunk)); child.on('error',reject); child.on('close',(code)=>code===0?resolve(Buffer.concat(chunks)):reject(new Error(`git ${args[0]} exited ${code}`))) }) }
function message(error: unknown) { return error instanceof Error ? error.message : String(error) }
