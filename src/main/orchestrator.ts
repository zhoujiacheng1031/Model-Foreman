import { randomUUID } from 'node:crypto'
import type { AgentTask } from '../shared/contracts'
import { ParallelRunner } from './parallel/parallel-runner'
import type { AppSettings, ExecutionContract, ImplementationReport, ReviewDecision, RoleKey, RunCommand, RunEvent, RunStageMetric, RunStatus, RunSummary, TaskInput, VerificationReport } from '../shared/contracts'
import { ExecutorRegistry } from './executors/registry'
import { ForemanDatabase } from './storage/database'
import type { WorkspaceManager } from './workspace/types'
import type { MemoryModule } from './memory/types'
import { ForemanMemoryModule } from './memory/memory-module'
import { RoleProtocol, executionContractSchema } from './protocols/role-protocol'
import type { VerificationModule } from './verification/types'
import { LocalVerificationModule } from './verification/local-verification'
import { ModelPreflightError, ModelRuntimeGate } from './model-runtime'

type EventSink = (event: RunEvent) => void

export class Orchestrator {
  private readonly cancelled = new Set<string>()
  private readonly paused = new Set<string>()
  private readonly active = new Set<string>()

  constructor(
    private readonly database: ForemanDatabase,
    private readonly executors: ExecutorRegistry,
    private readonly workspaces: WorkspaceManager,
    private readonly sink: EventSink,
    private readonly memory: MemoryModule = new ForemanMemoryModule(database),
    private readonly protocol = new RoleProtocol(),
    private readonly verification: VerificationModule = new LocalVerificationModule(),
    private readonly modelRuntime = new ModelRuntimeGate(executors)
  ) {}

  start(input: TaskInput): RunSummary {
    const created = this.database.createRun(input)
    const settings = this.database.getSettings()
    const policy = settings.execution ?? { maxParallelAgents: 1, agents: [] }
    this.database.updateRun(created.id, { executionPolicy: { ...policy, agents: policy.agents.length ? policy.agents : [settings.roles.implementer] } })
    const run = this.requireRun(created.id)
    this.launch(run.id, () => this.plan(run))
    return run
  }

  approve(runId: string): RunSummary {
    const detail = this.database.getRun(runId)
    if (!detail) throw new Error('任务不存在')
    const run = detail.run
    if (run.status !== 'awaiting_approval' || !run.contract) throw new Error('当前任务不在等待合同批准状态')
    if (run.contract.steps.some((step) => step.status !== 'approved')) throw new Error('请先逐步批准执行合同中的全部步骤')
    if (this.active.has(runId)) throw new Error('任务已经在运行')
    const contract = run.contract
    this.database.updateRun(runId, { contract, plan: JSON.stringify(contract, null, 2), status: 'queued', checkpointPhase: 'implementing', error: '', pauseReason: null })
    const updated = this.database.getRun(runId)!.run
    this.launch(runId, () => this.implement(updated))
    return updated
  }

  async command(runId: string, command: RunCommand): Promise<RunSummary> {
    if (command.type === 'pause') {
      await this.pause(runId)
      return this.requireRun(runId)
    }
    if (command.type === 'resume') return this.resume(runId, command.instructions)
    if (command.type === 'cancel') {
      this.cancel(runId)
      return this.requireRun(runId)
    }
    if (command.type === 'approve_plan') {
      const run = this.requireRun(runId)
      if (run.status !== 'awaiting_approval') throw new Error('当前任务不在等待规划批准状态')
      const contract = executionContractSchema.parse(command.contract)
      const approved = { ...contract, steps: contract.steps.map((step) => ({ ...step, status: 'approved' as const })) }
      this.database.updateRun(runId, { contract: approved, plan: JSON.stringify(approved, null, 2), additionalInstructions: command.feedback?.trim() || run.additionalInstructions,
        status: 'queued', checkpointPhase: 'implementing', error: '' })
      const updated = this.requireRun(runId)
      this.emit(runId, 'queued', 'status', '规划已保存并批准，准备进入执行阶段')
      this.launch(runId, () => this.implement(updated))
      return updated
    }
    if (command.type === 'replan') {
      const run = this.requireRun(runId)
      if (run.status !== 'awaiting_approval') throw new Error('当前任务不在等待规划批准状态')
      if (!command.feedback.trim()) throw new Error('重做规划前请填写补充意见')
      this.database.updateRun(runId, { status: 'queued', checkpointPhase: 'planning', additionalInstructions: command.feedback.trim(), error: '' })
      const updated = this.requireRun(runId)
      this.emit(runId, 'queued', 'status', '已记录补充意见，正在重做规划')
      this.launch(runId, () => this.plan(updated))
      return updated
    }
    const run = this.requireRun(runId)
    if (run.status !== 'awaiting_review_approval' || !run.reviewDecision) throw new Error('当前任务不在等待审核批准状态')
    if (command.type === 'approve_review' && run.reviewDecision.verdict === 'approved' && run.verification?.status !== 'failed') {
      return this.complete(run)
    }
    const feedback = command.feedback?.trim() || run.reviewDecision.summary
    return this.startRework(run, feedback)
  }

  updateContract(runId: string, contract: ExecutionContract): RunSummary {
    const run = this.database.getRun(runId)?.run
    if (!run || run.status !== 'awaiting_approval') throw new Error('只有等待批准的执行合同可以编辑')
    const validated = executionContractSchema.parse(contract)
    this.database.updateRun(runId, { contract: validated, plan: JSON.stringify(validated, null, 2) })
    return this.database.getRun(runId)!.run
  }

  async pause(runId: string): Promise<void> {
    const run = this.database.getRun(runId)?.run
    if (!run || !this.active.has(runId)) throw new Error('任务当前不可暂停')
    this.paused.add(runId); this.executors.cancel(runId); this.verification.cancel(runId)
    this.database.updateRun(runId, { checkpointPhase: run.status, status: 'paused', pauseReason: 'user', error: '任务已由用户中止；当前 worktree 和检查点已保留。' })
    this.emit(runId, 'paused', 'status', `任务已暂停，检查点位于 ${run.status}`)
    const started = Date.now()
    while (this.active.has(runId) && Date.now() - started < 2000) await new Promise((resolve) => setTimeout(resolve, 10))
  }

  resume(runId: string, instructions = ''): RunSummary {
    const run = this.database.getRun(runId)?.run
    if (!run || run.status !== 'paused') throw new Error('任务当前不可恢复')
    if (this.active.has(runId)) throw new Error('任务已经在运行')
    this.paused.delete(runId)
    const supplement = instructions?.trim()
    const additionalInstructions = supplement ? [run.additionalInstructions, `[${new Date().toLocaleString('zh-CN')}] ${supplement}`].filter(Boolean).join('\n\n') : run.additionalInstructions
    this.database.updateRun(runId, { status: 'queued', additionalInstructions, error: '', pauseReason: null })
    const updated = this.database.getRun(runId)!.run
    const checkpoint = updated.checkpointPhase
    if (!updated.contract || checkpoint === 'planning' || checkpoint === 'queued') this.launch(runId, () => this.plan(updated))
    else this.launch(runId, () => this.implement(updated))
    return updated
  }

  cancel(runId: string): void {
    if (this.active.has(runId)) this.cancelled.add(runId)
    this.paused.delete(runId)
    this.executors.cancel(runId)
    this.verification.cancel(runId)
    this.database.updateRun(runId, { status: 'cancelled' })
    this.emit(runId, 'cancelled', 'status', '任务已取消')
  }

  shutdown(): void {
    for (const runId of this.active) {
      this.paused.add(runId)
      this.executors.cancel(runId)
      this.verification.cancel(runId)
      this.database.updateRun(runId, {
        checkpointPhase: this.database.getRun(runId)?.run.status, status: 'paused', pauseReason: 'interrupted', error: '应用退出，活动执行器已终止；可从检查点恢复。'
      })
    }
  }

  private async plan(run: RunSummary): Promise<void> {
    const settings = this.database.getSettings()
    await this.ensureConfiguredModels(run.id, settings, run.executionWorkspace ?? run.workspace)
    let isolatedRun = run
    if (!run.executionWorkspace) {
        this.emit(run.id, 'queued', 'status', '正在创建隔离 Git worktree')
        const prepared = await this.workspaces.prepare(run)
        isolatedRun = { ...run, executionWorkspace: prepared.path, branch: prepared.branch, baseCommit: prepared.baseCommit, isolated: prepared.isolated }
        this.database.updateRun(run.id, { executionWorkspace: prepared.path, branch: prepared.branch, baseCommit: prepared.baseCommit, isolated: prepared.isolated })
        if (prepared.initializedRepository) this.emit(run.id, 'queued', 'status', '已为新项目建立本地 Git 基线；未导入任何已有文件。')
        this.emit(run.id, 'queued', 'status', `已创建隔离分支 ${prepared.branch}`)
        if (prepared.sourceDirty) this.emit(run.id, 'queued', 'stderr', '源工作目录存在未提交改动；隔离分支基于 HEAD，不包含这些改动。')
    }
    const contract = await this.runStructuredRole('planner', isolatedRun, settings, this.plannerPrompt(isolatedRun))
    this.assertActive(run.id)
    const confidence = contract.confidence ?? 0.8
    if (settings.approvals.planner.autoApprove && confidence >= settings.approvals.planner.minConfidence) {
      const approved = { ...contract, steps: contract.steps.map((step) => ({ ...step, status: 'approved' as const })) }
      this.database.updateRun(run.id, { contract: approved, plan: JSON.stringify(approved, null, 2), status: 'queued', checkpointPhase: 'implementing' })
      this.emit(run.id, 'queued', 'status', `规划置信度 ${formatConfidence(confidence)}，已按设置替你批准`)
      await this.implement(this.requireRun(run.id))
      return
    }
    this.database.updateRun(run.id, { contract, plan: JSON.stringify(contract, null, 2), status: 'awaiting_approval', checkpointPhase: 'planning' })
    this.emit(run.id, 'awaiting_approval', 'status', `结构化执行合同已生成，置信度 ${formatConfidence(confidence)}，等待批准`)
  }

  private async implement(run: RunSummary): Promise<void> {
    const settings = this.database.getSettings()
    const contract = run.contract!
    const resumePhase = run.checkpointPhase
    const canResumeEvidence = ['verifying', 'reviewing'].includes(resumePhase ?? '') && run.implementationReport
    let implementationReport = canResumeEvidence ? run.implementationReport! : await this.runImplementation(run, settings)
    if (canResumeEvidence) this.database.updateRun(run.id, { status: resumePhase === 'reviewing' ? 'reviewing' : 'verifying' })
      this.assertActive(run.id)
      this.database.updateRun(run.id, { implementationReport, result: JSON.stringify(implementationReport, null, 2) })

    let reviewDecision: ReviewDecision | undefined
    for (let attempt = run.reviewAttempt ?? 0; attempt <= settings.maxReviewLoops; attempt += 1) {
        this.database.updateRun(run.id, { reviewAttempt: attempt })
        let verification: VerificationReport
        if (resumePhase === 'reviewing' && attempt === (run.reviewAttempt ?? 0) && run.verification) {
          verification = run.verification
          this.emit(run.id, 'reviewing', 'status', '已从审核检查点恢复，复用此前独立验证证据')
        } else {
          this.database.updateRun(run.id, { status: 'verifying', checkpointPhase: 'verifying' })
          this.emit(run.id, 'verifying', 'status', 'Foreman 正在独立执行验证门禁')
          const suggested = contract.steps.flatMap((step) => step.verificationCommands)
          const verificationStartedAt = new Date().toISOString(); const verificationStarted = Date.now()
          try {
          verification = await this.verification.verify(run.executionWorkspace ?? run.workspace, settings.verification, suggested, run.id)
          this.recordStageMetric(run.id, {
            stage: 'verifier', label: `独立验证 · 第 ${attempt + 1} 轮`, attempt: attempt + 1, status: verification.status === 'failed' ? 'failed' : 'completed',
            executor: 'foreman-local', startedAt: verificationStartedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - verificationStarted,
            inputTokens: 0, outputTokens: 0, costUsd: 0, resourceDetail: `${verification.checks.length} 条本地命令 · ${verification.checks.filter((check) => check.passed).length} 通过`
          })
          } catch (error) {
          const problem = error instanceof Error ? error.message : String(error)
          this.recordStageMetric(run.id, {
            stage: 'verifier', label: `独立验证 · 第 ${attempt + 1} 轮`, attempt: attempt + 1, status: 'failed', executor: 'foreman-local',
            startedAt: verificationStartedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - verificationStarted,
            inputTokens: 0, outputTokens: 0, costUsd: 0, resourceDetail: '本地验证异常终止', problem
          })
          throw error
          }
          this.database.updateRun(run.id, { verification })
          for (const check of verification.checks) this.emit(run.id, 'verifying', check.passed ? 'result' : 'stderr', `${check.passed ? 'PASS' : 'FAIL'} ${check.command} (${check.durationMs}ms)`)
        }
        this.assertActive(run.id)
        const inspection = await this.workspaces.inspect(run)
        reviewDecision = await this.runStructuredRole('reviewer', run, settings, this.reviewerPrompt(run, contract, implementationReport, verification, attempt, inspection))
        this.assertActive(run.id)
        this.database.updateRun(run.id, { reviewDecision, review: JSON.stringify(reviewDecision, null, 2) })
        const autoReview = settings.approvals.reviewer.autoApprove && reviewDecision.confidence >= settings.approvals.reviewer.minConfidence
        if (!autoReview) {
          this.database.updateRun(run.id, { status: 'awaiting_review_approval', checkpointPhase: 'reviewing' })
          this.emit(run.id, 'awaiting_review_approval', 'status', `审核置信度 ${formatConfidence(reviewDecision.confidence)}，等待人工确认`)
          return
        }
        this.emit(run.id, 'reviewing', 'status', `审核置信度 ${formatConfidence(reviewDecision.confidence)}，已按设置替你批准`)
        if (reviewDecision.verdict === 'approved' && verification.status !== 'failed') {
          this.complete(this.requireRun(run.id))
          return
        }
        if (attempt === settings.maxReviewLoops) throw new Error(`审核在 ${attempt + 1} 轮后仍未通过`)
        implementationReport = await this.runStructuredRole('implementer', run, settings, this.reworkPrompt(run, reviewDecision, verification))
        this.database.updateRun(run.id, { implementationReport, result: JSON.stringify(implementationReport, null, 2), reviewAttempt: attempt + 1 })
    }
  }

  private async runImplementation(run: RunSummary, settings: AppSettings): Promise<ImplementationReport> {
    const parallel = run.executionPolicy?.maxParallelAgents ?? 1
    if (parallel <= 1 || (run.reviewAttempt ?? 0) > 0) return this.runStructuredRole('implementer', run, settings, this.implementerPrompt(run, run.contract!))
    this.assertActive(run.id)
    this.database.updateRun(run.id, { status: 'implementing', checkpointPhase: 'implementing' })
    return new ParallelRunner(this.database).execute(run, settings, () => this.assertActive(run.id), async (task, current) => {
      const step = current.contract!.steps.find((item) => item.id === task.stepId)!
      const prompt = `任务目标：${run.objective}\n你只负责步骤 ${task.stepId}：${JSON.stringify(step)}\n允许修改范围：${task.files.join('、') || '本隔离工作区'}\n其他 agent 正在独立工作，不要修改其他工作区、切换分支或操作共享服务。只使用本工作区的测试资源；需要共享数据库或端口时先报告阻塞。\n补充要求：${run.additionalInstructions || '无'}\n完成后返回真实改动、命令及未解决事项，Foreman 会汇总后独立验证。`
      return this.runStructuredRole('implementer', current, settings, prompt, task)
    }, () => this.executors.cancel(run.id))
  }

  private async runRole(role: RoleKey, run: RunSummary, settings: AppSettings, taskPrompt: string, agent?: AgentTask): Promise<string> {
    this.assertActive(run.id)
    const config = agent?.config ?? settings.roles[role]
    const workspace = agent?.workspace ?? run.executionWorkspace ?? run.workspace
    await this.modelRuntime.ensure(config, workspace)
    this.assertActive(run.id)
    if (agent && this.requireRun(run.id).agentTasks?.some((task) => task.status === 'failed')) throw new Error('同任务 Agent 已失败，停止启动新进程')
    const phase: RunStatus = role === 'planner' ? 'planning' : role === 'reviewer' ? 'reviewing' : 'implementing'
    this.database.updateRun(run.id, { status: phase })
    this.emit(run.id, phase, 'status', `${roleLabel(role)} · ${config.executor} / ${config.model} / ${config.effort}`)
    const packet = await this.memory.prepare({ workspace: run.workspace, objective: run.objective, role, headCommit: agent?.baseCommit, executionWorkspace: workspace }, settings)
    for (const warning of packet.warnings ?? []) this.emit(run.id, phase, 'status', warning)
    if (packet.entries.length) this.emit(run.id, phase, 'status', `已为${roleLabel(role)}召回 ${packet.entries.length} 条已批准记忆`)
    const working = agent ? (this.requireRun(run.id).agentTasks ?? []).filter((task) => task.id === agent.id || (agent.dependencies.includes(task.stepId) && task.status === 'integrated'))
      .map((task) => ({ agentId: task.id, stepId: task.stepId, status: task.status, commit: task.commit, report: task.report, error: task.error })) : []
    const contextText = packet.text + (working.length ? `\n<task_working_memory>以下仅是本任务的过程记录，不是项目已验证事实：${JSON.stringify(working).slice(0, 12000)}</task_working_memory>` : '')
    if (agent) this.database.updateRun(run.id, { agentTasks: this.requireRun(run.id).agentTasks!.map((task) => task.id === agent.id ? { ...task,
      memorySnapshot: { id: randomUUID(), at: new Date().toISOString(), headCommit: agent.baseCommit, entries: packet.entries.map((entry) => ({ id: entry.id, version: entry.version, updatedAt: entry.updatedAt, sourceCommit: entry.sourceCommit })), text: contextText } } : task) })
    this.assertActive(run.id)
    if (agent && this.requireRun(run.id).agentTasks?.some((task) => task.status === 'failed')) throw new Error('同任务 Agent 已失败，停止启动新进程')
    const executor = this.executors.get(config.executor)
    const skillPrompt = config.skillMode === 'explicit' && config.skills.length
      ? `\n\n本角色必须使用以下已配置 Skill：${config.skills.join('、')}。先读取并遵循它们的完整说明；若某项不可用，请明确报告，不要静默替代。`
      : ''
    if (config.skillMode === 'explicit' && config.skills.length) this.emit(run.id, phase, 'status', `已为${roleLabel(role)}指定 ${config.skills.length} 个 Skill`)
    const startedAt = new Date().toISOString(); const started = Date.now()
    try {
      const result = await executor.execute({
        executionId: agent ? `${agent.id}:${randomUUID()}` : undefined, runId: run.id, role, model: config.model, effort: config.effort,
        workspace, prompt: `${config.prompt}${skillPrompt}${contextText}\n\n${taskPrompt}`,
        emit: (event) => this.persistAndSink({ ...event, message: agent ? `[agent:${agent.stepId}:${agent.id}] ${event.message}` : event.message, at: new Date().toISOString() })
      })
      const usage = result.usage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 }
      if (result.usage) {
        const current=this.database.getRun(run.id)?.run
        this.database.updateRun(run.id,{ usageTokens:(current?.usageTokens??0)+usage.inputTokens+usage.outputTokens,costUsd:(current?.costUsd??0)+(usage.costUsd??0) })
      }
      this.recordStageMetric(run.id, {
        stage: role, label: `${agent ? `Agent ${agent.stepId}` : roleLabel(role)} · 第 ${(this.database.getRun(run.id)?.run.reviewAttempt ?? 0) + 1} 轮`,
        attempt: (this.database.getRun(run.id)?.run.reviewAttempt ?? 0) + 1, status: 'completed', executor: config.executor, model: config.model,
        startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - started, inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens, costUsd: usage.costUsd ?? 0, resourceDetail: `${config.effort} · ${packet.entries.length} 条记忆 · ${config.skills.length} 个指定 Skill`
      })
      return result.output
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error)
      this.recordStageMetric(run.id, {
        stage: role, label: `${agent ? `Agent ${agent.stepId}` : roleLabel(role)} · 第 ${(this.database.getRun(run.id)?.run.reviewAttempt ?? 0) + 1} 轮`,
        attempt: (this.database.getRun(run.id)?.run.reviewAttempt ?? 0) + 1, status: 'failed', executor: config.executor, model: config.model,
        startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - started, inputTokens: 0, outputTokens: 0, costUsd: 0, resourceDetail: `${config.effort} · 执行异常终止`, problem
      })
      throw error
    }
  }

  private recordStageMetric(runId: string, metric: Omit<RunStageMetric, 'id'>): void {
    this.database.addStageMetric(runId, { id: randomUUID(), ...metric })
  }

  private async runStructuredRole<R extends RoleKey>(role: R, run: RunSummary, settings: AppSettings, taskPrompt: string, agent?: AgentTask): Promise<R extends 'planner' ? ExecutionContract : R extends 'implementer' ? ImplementationReport : ReviewDecision> {
    const first = await this.runRole(role, run, settings, `${taskPrompt}${this.protocol.instructions(role)}`, agent)
    this.assertActive(run.id)
    try { return this.protocol.decode(role, first) as never }
    catch (error) {
      this.assertActive(run.id)
      this.emit(run.id, role === 'planner' ? 'planning' : role === 'reviewer' ? 'reviewing' : 'implementing', 'stderr', '模型输出协议无效，正在请求一次格式修复')
      const repaired = await this.runRole(role, run, settings, this.protocol.repairPrompt(role, first, error), agent)
      this.assertActive(run.id)
      return this.protocol.decode(role, repaired) as never
    }
  }

  private emit(runId: string, phase: RunStatus, kind: RunEvent['kind'], message: string): void {
    this.persistAndSink({ runId, phase, kind, message, at: new Date().toISOString() })
  }

  private persistAndSink(event: RunEvent): void {
    this.sink(this.database.addEvent(event))
  }

  private assertActive(runId: string): void {
    const status = this.database.getRun(runId)?.run.status
    if (this.paused.has(runId) || status === 'paused') throw new Error('任务已暂停')
    if (this.cancelled.has(runId) || status === 'cancelled') throw new Error('任务已取消')
  }

  private launch(runId: string, task: () => Promise<void>): void {
    if (this.active.has(runId)) throw new Error('任务已经在运行，请勿重复启动')
    this.active.add(runId)
    void task()
      .catch((error) => this.fail(runId, error))
      .finally(() => {
        this.active.delete(runId)
        this.cancelled.delete(runId)
      })
  }

  private requireRun(runId: string): RunSummary {
    const run = this.database.getRun(runId)?.run
    if (!run) throw new Error('任务不存在')
    return run
  }

  private complete(run: RunSummary): RunSummary {
    if (!run.contract) throw new Error('任务缺少执行合同')
    const completedContract = { ...run.contract, steps: run.contract.steps.map((step) => ({ ...step, status: 'completed' as const })) }
    this.database.updateRun(run.id, { status: 'completed', contract: completedContract, checkpointPhase: 'reviewing', error: '' })
    this.emit(run.id, 'completed', 'result', '任务已通过审核')
    return this.requireRun(run.id)
  }

  private startRework(run: RunSummary, feedback: string): RunSummary {
    const settings = this.database.getSettings()
    const nextAttempt = (run.reviewAttempt ?? 0) + 1
    if (nextAttempt > settings.maxReviewLoops) throw new Error(`已达到最大返工轮次 ${settings.maxReviewLoops}`)
    const instructions = [run.additionalInstructions, `人工审核补充意见：${feedback}`].filter(Boolean).join('\n\n')
    this.database.updateRun(run.id, { status: 'queued', checkpointPhase: 'implementing', reviewAttempt: nextAttempt,
      additionalInstructions: instructions, error: '' })
    const updated = this.requireRun(run.id)
    this.emit(run.id, 'queued', 'status', `审核意见已确认，准备进行第 ${nextAttempt + 1} 轮实现`)
    this.launch(run.id, () => this.implement(updated))
    return updated
  }

  private fail(runId: string, error: unknown): void {
    const status = this.database.getRun(runId)?.run.status
    if (this.cancelled.has(runId) || this.paused.has(runId) || status === 'paused' || status === 'cancelled') return
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof ModelPreflightError) {
      this.database.updateRun(runId, { status: 'paused', checkpointPhase: status, pauseReason: 'preflight', error: message })
      this.emit(runId, 'paused', 'error', `${message}。任务尚未进入正式模型调用；修改模型、推理强度或 API 配置后可恢复。`)
      return
    }
    if (isAuthorizationError(message)) {
      this.database.updateRun(runId, { status: 'paused', checkpointPhase: status, pauseReason: 'authorization',
        error: `执行器尚未授权或登录已失效：${message}` })
      this.emit(runId, 'paused', 'error', '任务已安全暂停。完成对应 CLI 登录后，可从当前检查点恢复。')
      return
    }
    this.database.updateRun(runId, { status: 'failed', error: message })
    this.emit(runId, 'failed', 'error', message)
  }

  private plannerPrompt(run: RunSummary) {
    return `任务标题：${run.title}\n任务目标：${run.objective}\n隔离工作目录：${run.executionWorkspace ?? run.workspace}\n分支：${run.branch ?? '未创建'}\n补充意见：${run.additionalInstructions || '无'}\n请先检查仓库现状，再制定计划。每步声明明确的仓库内文件或目录 files，以及依赖步骤 ID dependsOn；独立步骤用 []，有前后依赖必须列出，不能为追求并行省略逻辑或共享资源依赖。`
  }

  private async ensureConfiguredModels(runId: string, settings: AppSettings, workspace: string): Promise<void> {
    const unique = [...new Map((Object.keys(settings.roles) as RoleKey[]).map((role) => {
      const config = settings.roles[role]
      return [`${config.executor}\0${config.model}\0${config.effort}`, { role, config }] as const
    })).values()]
    this.emit(runId, 'queued', 'status', `正在预检 ${unique.length} 组执行器、模型、推理强度与远端 API`)
    for (const item of unique) {
      const status = await this.modelRuntime.ensure(item.config, workspace)
      this.emit(runId, 'queued', 'status', `${roleLabel(item.role)}预检通过 · ${status.kind} / ${status.model} / ${status.effort}${status.cached ? '（缓存）' : ''}`)
    }
  }

  private implementerPrompt(run: RunSummary, contract: ExecutionContract) {
    return `任务目标：${run.objective}\n\n已批准的执行合同：\n${JSON.stringify(contract, null, 2)}\n\n补充指令：${run.additionalInstructions || '无'}\n现在执行合同。不要把自述当作验证证据，Foreman 会独立运行门禁。`
  }

  private reviewerPrompt(run: RunSummary, contract: ExecutionContract, result: ImplementationReport, verification: import('../shared/contracts').VerificationReport, attempt: number, inspection: { stat: string; filesChanged: number; additions: number; deletions: number }) {
    return `任务目标：${run.objective}\n\n执行合同：\n${JSON.stringify(contract)}\n\n执行器报告：\n${JSON.stringify(result)}\n\nForeman 独立验证报告：\n${JSON.stringify(verification)}\n\n变更概况：${inspection.filesChanged} 个文件，+${inspection.additions} / -${inspection.deletions}\n${inspection.stat}\n\n这是第 ${attempt + 1} 轮审核。独立检查仓库与 git diff。验证 status=failed 时不得批准；status=skipped 时必须明确评估缺少自动门禁的风险。`
  }

  private reworkPrompt(run: RunSummary, review: ReviewDecision, verification: import('../shared/contracts').VerificationReport) {
    return `任务目标：${run.objective}\n\n结构化审核意见：\n${JSON.stringify(review, null, 2)}\n\n失败门禁：\n${JSON.stringify(verification.checks.filter((check) => !check.passed), null, 2)}\n\n只处理审核或门禁指出的问题。`
  }
}

function roleLabel(role: RoleKey): string {
  return role === 'planner' ? '规划' : role === 'reviewer' ? '审核' : '执行'
}

function formatConfidence(value: number): string { return `${Math.round(value * 100)}%` }

function isAuthorizationError(message: string): boolean {
  return /unauthori[sz]ed|not logged in|login required|authentication (?:failed|required)|invalid (?:api[_ -]?key|token)|oauth|请.*登录|未登录|授权.*失效|authentication_error/i.test(message)
}
