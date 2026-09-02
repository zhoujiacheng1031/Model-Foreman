import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentExecutor, ExecuteRequest } from '../src/main/executors/types'
import { ExecutorRegistry } from '../src/main/executors/registry'
import { Orchestrator } from '../src/main/orchestrator'
import { ForemanDatabase } from '../src/main/storage/database'
import type { WorkspaceManager } from '../src/main/workspace/types'
import { DeliveryService } from '../src/main/delivery'
import { DurableScheduler, GoalRuntime } from '../src/main/goals'

class GoalExecutor implements AgentExecutor {
  readonly kind = 'codex' as const
  async probe() { return { installed:true, executable:'fake', version:'test' } }
  cancel() {}
  async execute(request: ExecuteRequest) {
    const output = request.role === 'planner' ? { version:1, summary:'执行目标任务', assumptions:[], risks:[], steps:[{ id:'s1', title:'实现', description:'完成', acceptanceCriteria:['通过'], files:[], verificationCommands:[], status:'pending' }] }
      : request.role === 'reviewer' ? { verdict:'approved', summary:'通过', findings:[], confidence:.98 }
      : { summary:'完成', filesChanged:[], commandsRun:[], unresolved:[] }
    return { output: JSON.stringify(output), exitCode:0 }
  }
}
class GoalWorkspace implements WorkspaceManager {
  merges = 0
  async prepare() { return { path:'/tmp/goal-runtime', branch:`foreman/goal-${this.merges}`, baseCommit:'base', isolated:true, sourceDirty:false, initializedRepository:false } }
  async inspect() { return { diff:'', stat:'', filesChanged:0, additions:0, deletions:0 } }
  async merge() { this.merges += 1; return { commit:`commit-${this.merges}` } }
  async discard() { return {} }
}

function harness(fingerprint = async () => 'stable') {
  const db = new ForemanDatabase(':memory:', process.cwd()); const workspace = new GoalWorkspace()
  const orchestrator = new Orchestrator(db, new ExecutorRegistry([new GoalExecutor()]), workspace, () => {})
  const delivery = new DeliveryService(db, workspace, () => {})
  return { db, workspace, orchestrator, runtime:new GoalRuntime(db, orchestrator, delivery, fingerprint) }
}
const input = { title:'长期目标', objective:'完成两个可验证结果', workspace:process.cwd(), successCriteria:['能力 A 完成','能力 B 完成'], constraints:['保持兼容'], priority:50, maxIterations:10, maxTaskAttempts:2 }

describe('GoalRuntime', () => {
  it('从普通空文件夹创建长期目标时先建立稳定 Git 基线', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'foreman-empty-goal-'))
    try {
      const db = new ForemanDatabase(':memory:', folder); const workspace = new GoalWorkspace()
      const orchestrator = new Orchestrator(db, new ExecutorRegistry([new GoalExecutor()]), workspace, () => {})
      const runtime = new GoalRuntime(db, orchestrator, new DeliveryService(db, workspace, () => {}))

      const created = await runtime.create({ ...input, workspace:folder, successCriteria:['建立项目骨架'] })

      expect(created.goal.workspaceFingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(execFileSync('git', ['-C', folder, 'log', '-1', '--pretty=%s'], { encoding:'utf8' }).trim()).toBe('chore: initialize Model Foreman workspace')
    } finally { rmSync(folder, { recursive:true, force:true }) }
  })

  it('从成功标准生成有序任务图并以持久化 tick 推进到确定性完成', async () => {
    const h = harness(); const created = await h.runtime.create(input)
    expect(created.tasks).toHaveLength(2); expect(created.tasks[1].dependencies).toEqual([created.tasks[0].id])
    for (let index=0; index<2; index += 1) {
      await waitFor(async () => { await h.runtime.tick(created.goal.id); return h.runtime.get(created.goal.id)?.goal.status === 'waiting_approval' })
      const detail = h.runtime.get(created.goal.id)!; const task = detail.tasks.find((item) => item.id === detail.goal.currentTaskId)!
      const run = h.db.getRun(task.runId!)!.run
      h.orchestrator.updateContract(run.id, { ...run.contract!, steps:run.contract!.steps.map((step) => ({...step,status:'approved'})) })
      h.orchestrator.approve(run.id); await waitFor(() => h.db.getRun(run.id)?.run.status === 'completed')
      await h.runtime.tick(created.goal.id)
    }
    await h.runtime.tick(created.goal.id)
    const finished = h.runtime.get(created.goal.id)!
    expect(finished.goal).toMatchObject({ status:'completed', iteration:2 })
    expect(finished.tasks.every((task) => task.evidence?.merged && task.evidence.reviewerVerdict === 'approved')).toBe(true)
    expect(h.workspace.merges).toBe(2)
  })

  it('外部工作区变化会暂停目标并使已有证据失效', async () => {
    let fingerprint = 'before'; const h = harness(async () => fingerprint)
    const detail = h.db.createGoal(input, fingerprint); const first = detail.tasks[0]
    h.db.updateGoalTask(first.id, { status:'completed', evidence:{ runId:'r1', merged:true, reviewerVerdict:'approved',verificationStatus:'passed' } })
    fingerprint = 'external-change'; await h.runtime.tick(detail.goal.id)
    const changed = h.runtime.get(detail.goal.id)!
    expect(changed.goal.status).toBe('paused'); expect(changed.goal.terminalReason).toContain('工作区变化')
    expect(changed.tasks[0].status).toBe('invalidated')
  })

  it('预算耗尽具有明确终止原因，Scheduler 不使用常驻权威状态', async () => {
    const h = harness(); const detail = h.db.createGoal({ ...input, maxIterations:1 }, 'stable')
    h.db.updateGoal(detail.goal.id, { iteration:1 }); await h.runtime.tick(detail.goal.id)
    expect(h.runtime.get(detail.goal.id)?.goal).toMatchObject({ status:'failed', terminalReason:'最大 Goal 循环次数已耗尽' })
    const scheduler = new DurableScheduler(h.runtime, 5); await scheduler.tick(); scheduler.start(); scheduler.stop()
  })

  it('累计的模型 token 用量会阻止下一次 Goal 调度', async () => {
    const h=harness(); const detail=h.db.createGoal({ ...input,tokenBudget:1000 },'stable'); const first=detail.tasks[0]
    const run=h.db.createRun({title:'usage',objective:'usage',workspace:process.cwd()}); h.db.updateRun(run.id,{usageTokens:1000})
    h.db.updateGoalTask(first.id,{status:'running',runId:run.id,attempt:1}); h.db.updateGoal(detail.goal.id,{currentTaskId:first.id})
    await h.runtime.tick(detail.goal.id)
    expect(h.runtime.get(detail.goal.id)?.goal).toMatchObject({status:'failed',terminalReason:'Token 预算已耗尽',tokensUsed:1000})
  })

  it('阻塞后的重新规划保留旧 run 用量并启动新的 Planner 循环', async () => {
    const h=harness(); const detail=h.db.createGoal(input,'stable'); const first=detail.tasks[0]
    const old=h.db.createRun({title:'old',objective:'old',workspace:process.cwd()}); h.db.updateRun(old.id,{status:'failed',usageTokens:321})
    h.db.updateGoalTask(first.id,{status:'blocked',runId:old.id,attempt:2}); h.db.updateGoal(detail.goal.id,{status:'blocked',currentTaskId:first.id})
    const replanned=await h.runtime.command(detail.goal.id,'replan'); const task=replanned.tasks[0]
    expect(replanned.goal.iteration).toBe(1); expect(task.runHistoryIds).toContain(old.id); expect(replanned.goal.tokensUsed).toBe(321)
    expect(task.status).toBe('running'); expect(task.runId).not.toBe(old.id)
  })
})

async function waitFor(predicate:()=>boolean|Promise<boolean>, timeout=1500) { const start=Date.now(); while(!await predicate()){ if(Date.now()-start>timeout) throw new Error('timeout'); await new Promise((resolve)=>setTimeout(resolve,5)) } }
