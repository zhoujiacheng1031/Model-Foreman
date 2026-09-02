import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentExecutor, ExecuteRequest, ExecuteResult } from '../src/main/executors/types'
import { ExecutorRegistry } from '../src/main/executors/registry'
import { Orchestrator } from '../src/main/orchestrator'
import { ForemanDatabase } from '../src/main/storage/database'
import type { WorkspaceManager } from '../src/main/workspace/types'

class FakeExecutor implements AgentExecutor {
  readonly kind = 'codex' as const
  readonly calls: ExecuteRequest[] = []

  async probe() { return { installed: true, executable: 'fake', version: 'test' } }
  cancel() {}
  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    this.calls.push(request)
    const output = request.role === 'planner' ? JSON.stringify({ version: 1, summary: '实现功能', assumptions: [], risks: [], steps: [
      { id: 'step-1', title: '实现功能', description: '完成目标', acceptanceCriteria: ['测试通过'], files: [], verificationCommands: [], status: 'pending' }
    ] }) : request.role === 'reviewer' ? JSON.stringify({ verdict: 'approved', summary: '符合目标', findings: [], confidence: .95 })
      : JSON.stringify({ summary: '实现完成，测试通过', filesChanged: [], commandsRun: [], unresolved: [] })
    return { output, exitCode: 0, usage: { inputTokens: 120, outputTokens: 35, costUsd: .01 } }
  }
}

class FakeWorkspace implements WorkspaceManager {
  async prepare() {
    return { path: '/tmp/foreman-isolated', branch: 'foreman/test-12345678', baseCommit: 'abc123', isolated: true, sourceDirty: false, initializedRepository: false }
  }
  async inspect() { return { diff: '', stat: '', filesChanged: 0, additions: 0, deletions: 0 } }
  async merge() { return { commit: 'abc123' } }
  async discard() { return {} }
}

class BlockingExecutor implements AgentExecutor {
  readonly kind = 'codex' as const
  calls: ExecuteRequest[] = []
  cancelled = false
  async probe() { return { installed: true, executable: 'fake', version: 'test' } }
  execute(request: ExecuteRequest): Promise<{ output: string; exitCode: number }> {
    this.calls.push(request)
    return new Promise(() => {})
  }
  cancel() { this.cancelled = true }
}

class CancelRaceExecutor implements AgentExecutor {
  readonly kind = 'codex' as const
  calls = 0
  private release?: () => void
  async probe() { return { installed:true, executable:'fake', version:'test' } }
  execute(): Promise<{ output:string; exitCode:number }> {
    this.calls += 1
    return new Promise((resolve) => { this.release = () => resolve({ output:'invalid protocol output', exitCode:0 }) })
  }
  cancel() { this.release?.() }
}

class RecoverableExecutor extends FakeExecutor {
  private reject?: (error: Error) => void
  private block = true
  override execute(request: ExecuteRequest): Promise<{ output: string; exitCode: number }> {
    this.calls.push(request)
    if (this.block) {
      this.block = false
      return new Promise((_resolve, reject) => { this.reject = reject })
    }
    const output = JSON.stringify({ version: 1, summary: '恢复后的合同', assumptions: [], risks: [], steps: [
      { id: 's1', title: '恢复', description: '继续执行', acceptanceCriteria: ['完成'], files: [], verificationCommands: [], status: 'pending' }
    ] })
    return Promise.resolve({ output, exitCode: 0 })
  }
  override cancel() { this.reject?.(new Error('cancelled')); this.reject = undefined }
}

class RepairingExecutor extends FakeExecutor {
  private plannerAttempts = 0
  override async execute(request: ExecuteRequest) {
    if (request.role === 'planner' && this.plannerAttempts++ === 0) { this.calls.push(request); return { output: 'not-json', exitCode: 0 } }
    return super.execute(request)
  }
}

class UnauthorizedExecutor extends FakeExecutor {
  override async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    this.calls.push(request)
    throw new Error('Authentication required: not logged in')
  }
}

describe('Orchestrator', () => {
  afterEach(() => vi.restoreAllMocks())

  it('按规划、执行、审核的顺序完成任务', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd())
    const executor = new FakeExecutor()
    const events: string[] = []
    const orchestrator = new Orchestrator(database, new ExecutorRegistry([executor]), new FakeWorkspace(), (event) => events.push(event.message))

    const run = orchestrator.start({ title: '测试任务', objective: '实现一个功能', workspace: process.cwd() })
    await waitFor(() => database.getRun(run.id)?.run.status === 'awaiting_approval')

    expect(executor.calls.map((call) => call.role)).toEqual(['planner'])
    expect(database.getRun(run.id)?.run.branch).toBe('foreman/test-12345678')
    expect(database.getRun(run.id)?.run.baseCommit).toBe('abc123')
    const waiting = database.getRun(run.id)!.run
    orchestrator.updateContract(run.id, { ...waiting.contract!, steps: waiting.contract!.steps.map((step) => ({ ...step, status: 'approved' })) })
    orchestrator.approve(run.id)
    await waitFor(() => database.getRun(run.id)?.run.status === 'completed')

    const detail = database.getRun(run.id)
    expect(executor.calls.map((call) => call.role)).toEqual(['planner', 'implementer', 'reviewer'])
    expect(executor.calls.every((call) => call.workspace === '/tmp/foreman-isolated')).toBe(true)
    expect(detail?.run.contract?.summary).toContain('实现功能')
    expect(detail?.run.reviewDecision?.verdict).toBe('approved')
    expect(detail?.run.stageMetrics?.map((metric) => metric.stage)).toEqual(['planner', 'implementer', 'verifier', 'reviewer'])
    expect(detail?.run.stageMetrics?.filter((metric) => metric.stage !== 'verifier').every((metric) => metric.inputTokens === 120 && metric.outputTokens === 35)).toBe(true)
    expect(detail?.run.stageMetrics?.find((metric) => metric.stage === 'verifier')?.resourceDetail).toContain('本地命令')
    expect(detail?.run.usageTokens).toBe(465)
    expect(events).toContain('任务已通过审核')
  })

  it('应用退出时终止活动执行器并保留可恢复检查点', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd())
    const executor = new BlockingExecutor()
    const orchestrator = new Orchestrator(database, new ExecutorRegistry([executor]), new FakeWorkspace(), () => {})
    const run = orchestrator.start({ title: '长任务', objective: '持续执行', workspace: process.cwd() })
    await waitFor(() => executor.calls.length === 1)

    orchestrator.shutdown()

    expect(executor.cancelled).toBe(true)
    expect(database.getRun(run.id)?.run.status).toBe('paused')
    expect(database.getRun(run.id)?.run.checkpointPhase).toBe('planning')
    expect(database.getRun(run.id)?.run.error).toContain('可从检查点恢复')
  })

  it('从持久化合同检查点恢复并携带补充指令', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd())
    const executor = new FakeExecutor()
    const orchestrator = new Orchestrator(database, new ExecutorRegistry([executor]), new FakeWorkspace(), () => {})
    const run = database.createRun({ title: '恢复任务', objective: '继续实现', workspace: process.cwd() })
    database.updateRun(run.id, { status: 'paused', checkpointPhase: 'implementing', executionWorkspace: '/tmp/foreman-isolated',
      contract: { version: 1, summary: '恢复', assumptions: [], risks: [], steps: [
        { id: 's1', title: '继续', description: '继续工作', acceptanceCriteria: ['通过'], files: [], verificationCommands: [], status: 'approved' }
      ] } })

    orchestrator.resume(run.id, '不要修改公开接口')
    await waitFor(() => database.getRun(run.id)?.run.status === 'completed')

    expect(executor.calls.map((call) => call.role)).toEqual(['implementer', 'reviewer'])
    expect(executor.calls[0]?.prompt).toContain('不要修改公开接口')
  })

  it('从验证检查点恢复时复用实现证据而不重复执行 Implementer', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd()); const executor = new FakeExecutor()
    const orchestrator = new Orchestrator(database, new ExecutorRegistry([executor]), new FakeWorkspace(), () => {})
    const run = database.createRun({ title:'精确恢复',objective:'继续验证',workspace:process.cwd() })
    database.updateRun(run.id, { status:'paused',checkpointPhase:'verifying',executionWorkspace:'/tmp/foreman-isolated',reviewAttempt:1,
      contract:{version:1,summary:'恢复',assumptions:[],risks:[],steps:[{id:'s',title:'完成',description:'完成',acceptanceCriteria:['通过'],files:[],verificationCommands:[],status:'approved'}]},
      implementationReport:{summary:'已有实现',filesChanged:['src/a.ts'],commandsRun:[],unresolved:[]} })
    orchestrator.resume(run.id); await waitFor(()=>database.getRun(run.id)?.run.status==='completed')
    expect(database.getRun(run.id)?.run.error).toBeFalsy()
    expect(executor.calls.map((call)=>call.role)).toEqual(['reviewer'])
    expect(database.getRun(run.id)?.run.reviewAttempt).toBe(1)
  })

  it('模型协议格式错误时执行一次受限修复', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd()); const executor = new RepairingExecutor(); const events: string[] = []
    const orchestrator = new Orchestrator(database, new ExecutorRegistry([executor]), new FakeWorkspace(), (event) => events.push(event.message))
    const run = orchestrator.start({ title: '修复协议', objective: '生成合同', workspace: process.cwd() })
    await waitFor(() => database.getRun(run.id)?.run.status === 'awaiting_approval')
    expect(executor.calls.filter((call) => call.role === 'planner')).toHaveLength(2)
    expect(events).toContain('模型输出协议无效，正在请求一次格式修复')
  })

  it('取消发生在协议解码边界时不再启动格式修复调用', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd()); const executor = new CancelRaceExecutor()
    const orchestrator = new Orchestrator(database, new ExecutorRegistry([executor]), new FakeWorkspace(), () => {})
    const run = orchestrator.start({ title:'取消竞态', objective:'不要继续调用模型', workspace:process.cwd() })
    await waitFor(() => executor.calls === 1)

    orchestrator.cancel(run.id)
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(database.getRun(run.id)?.run.status).toBe('cancelled')
    expect(executor.calls).toBe(1)
  })

  it('把角色显式选择的原生 Skill 注入执行上下文', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd()); const executor = new FakeExecutor(); const settings = database.getSettings()
    database.saveSettings({ ...settings, roles: { ...settings.roles, planner: { ...settings.roles.planner, skillMode: 'explicit', skills: ['$research', '$code-review'] } } })
    const orchestrator = new Orchestrator(database, new ExecutorRegistry([executor]), new FakeWorkspace(), () => {})
    const run = orchestrator.start({ title: 'Skill 任务', objective: '使用指定流程规划', workspace: process.cwd() })
    await waitFor(() => database.getRun(run.id)?.run.status === 'awaiting_approval')
    expect(executor.calls[0]?.prompt).toContain('$research、$code-review')
    expect(executor.calls[0]?.prompt).toContain('先读取并遵循它们的完整说明')
  })

  it('暂停会终止当前执行并可从规划检查点恢复', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd()); const executor = new RecoverableExecutor()
    const orchestrator = new Orchestrator(database, new ExecutorRegistry([executor]), new FakeWorkspace(), () => {})
    const run = orchestrator.start({ title: '暂停任务', objective: '测试暂停恢复', workspace: process.cwd() })
    await waitFor(() => executor.calls.length === 1)
    await orchestrator.pause(run.id)
    expect(database.getRun(run.id)?.run).toMatchObject({ status: 'paused', checkpointPhase: 'planning' })

    orchestrator.resume(run.id, '恢复后先检查状态')
    await waitFor(() => database.getRun(run.id)?.run.status === 'awaiting_approval')
    expect(database.getRun(run.id)?.run.contract?.summary).toBe('恢复后的合同')
  })

  it('未授权执行器会安全暂停并保留可恢复检查点', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd()); const executor = new UnauthorizedExecutor()
    const orchestrator = new Orchestrator(database, new ExecutorRegistry([executor]), new FakeWorkspace(), () => {})
    const run = orchestrator.start({ title: '授权任务', objective: '等待用户登录', workspace: process.cwd() })
    await waitFor(() => database.getRun(run.id)?.run.status === 'paused')
    expect(database.getRun(run.id)?.run).toMatchObject({ status: 'paused', checkpointPhase: 'planning', pauseReason: 'authorization' })
  })

  it('恢复时把新补充内容追加到已有任务上下文而不是覆盖', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd()); const executor = new FakeExecutor()
    const orchestrator = new Orchestrator(database, new ExecutorRegistry([executor]), new FakeWorkspace(), () => {})
    const run = database.createRun({ title: '追加恢复', objective: '原始目标', workspace: process.cwd() })
    database.updateRun(run.id, { status: 'paused', checkpointPhase: 'planning', additionalInstructions: '第一次补充' })
    orchestrator.resume(run.id, '第二次补充')
    await waitFor(() => database.getRun(run.id)?.run.status === 'awaiting_approval')
    expect(database.getRun(run.id)?.run.additionalInstructions).toContain('第一次补充')
    expect(database.getRun(run.id)?.run.additionalInstructions).toContain('第二次补充')
    expect(executor.calls[0]?.prompt).toContain('第一次补充')
    expect(executor.calls[0]?.prompt).toContain('第二次补充')
  })

  it('人工审核门禁持久等待且批准命令只完成一次', async () => {
    const database = new ForemanDatabase(':memory:', process.cwd()); const executor = new FakeExecutor(); const settings = database.getSettings()
    database.saveSettings({ ...settings, approvals: { ...settings.approvals, reviewer: { autoApprove: false, minConfidence: .9 } } })
    const orchestrator = new Orchestrator(database, new ExecutorRegistry([executor]), new FakeWorkspace(), () => {})
    const run = orchestrator.start({ title: '人工审核', objective: '需要明确批准', workspace: process.cwd() })
    await waitFor(() => database.getRun(run.id)?.run.status === 'awaiting_approval')
    const contract = database.getRun(run.id)!.run.contract!
    orchestrator.command(run.id, { type: 'approve_plan', contract })
    await waitFor(() => database.getRun(run.id)?.run.status === 'awaiting_review_approval')
    const reviewerCalls = executor.calls.filter((call) => call.role === 'reviewer').length
    await orchestrator.command(run.id, { type: 'approve_review' })
    expect(database.getRun(run.id)?.run.status).toBe('completed')
    expect(executor.calls.filter((call) => call.role === 'reviewer')).toHaveLength(reviewerCalls)
  })
})

async function waitFor(predicate: () => boolean, timeout = 1000) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeout) throw new Error('等待编排完成超时')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
