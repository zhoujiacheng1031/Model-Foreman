import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForemanDatabase } from '../src/main/storage/database'
import { RunRecovery } from '../src/main/run-recovery'
import { ParallelRunner } from '../src/main/parallel/parallel-runner'
import { git } from '../src/main/parallel/agent-workspaces'
import { GoalRuntime } from '../src/main/goals/goal-runtime'
import { DeliveryService } from '../src/main/delivery'
import type { AgentExecutor, ExecuteRequest } from '../src/main/executors/types'
import { approved, recoveryFixture, report, step, waitFor } from './helpers/recovery'

const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })) })
async function fixture(steps?: Parameters<typeof recoveryFixture>[0]) { const f = await recoveryFixture(steps); roots.push(f.root); return f }

class FailureExecutor implements AgentExecutor {
  readonly kind = 'codex' as const
  calls: ExecuteRequest[] = []
  failImplementation = true
  failReview = false
  async probe() { return { installed: true, executable: 'fixture', version: 'test' } }
  cancel() {}
  async execute(request: ExecuteRequest) {
    this.calls.push(request)
    if (request.role === 'planner') throw new Error('恢复不得重新规划')
    if (request.role === 'reviewer') {
      if (this.failReview) throw new Error('reviewer connection lost')
      return { output: JSON.stringify(approved), exitCode: 0 }
    }
    const id = request.prompt.match(/只负责步骤 (\w+)/)?.[1] ?? 'a'
    writeFileSync(join(request.workspace, `${id}.txt`), id)
    if (id === 'c' && this.failImplementation) throw new Error('connection lost at c')
    return { output: JSON.stringify(report(id)), exitCode: 0, usage: { inputTokens: 10, outputTokens: 5, costUsd: .001 } }
  }
}

async function failedFixture() {
  const f = await fixture(); const executor = new FailureExecutor(); const orchestrator = f.createOrchestrator(executor)
  orchestrator.approve(f.id); await waitFor(() => f.read().status === 'failed')
  expect(f.read().failure?.checkpointError).toBeUndefined()
  return { ...f, executor, orchestrator }
}

describe('failure checkpoint recovery', () => {
  it('reopens SQLite, reuses two integrated steps, continues the failed worktree and verifies the aggregate', async () => {
    const f = await failedFixture(); const before = f.read(); const attempts = before.agentTasks!.map((task) => task.attempt)
    expect(before.agentTasks!.map((task) => task.status)).toEqual(['integrated', 'integrated', 'failed'])
    const reopened = new ForemanDatabase(f.databasePath, f.root)
    const executor = new FailureExecutor(); executor.failImplementation = false
    const restored = f.createOrchestrator(executor, reopened)
    const plan = await restored.getRecovery(f.id)
    expect(plan).toMatchObject({ available: true, phase: 'implementing' })
    expect(plan.steps.map((s) => s.action)).toEqual(['reuse', 'reuse', 'retry'])
    await restored.recover(f.id, plan.failureAt!)
    await waitFor(() => ['failed', 'completed'].includes(f.read().status))
    const done = f.read()
    expect(done.error).toBe(''); expect(done.status).toBe('completed')
    expect(done.id).toBe(before.id); expect(done.branch).toBe(before.branch)
    expect(done.agentTasks!.map((task) => task.workspace)).toEqual(before.agentTasks!.map((task) => task.workspace))
    expect(done.agentTasks!.map((task) => task.attempt)).toEqual([attempts[0], attempts[1], attempts[2] + 1])
    expect(executor.calls.map((call) => call.role)).toEqual(['implementer', 'reviewer'])
    expect(executor.calls[0].prompt).toContain('这是接续执行')
    expect(done.verification?.status).toBe('passed'); expect(done.reviewDecision?.verdict).toBe('approved')
    expect(done.usageTokens).toBeGreaterThan(before.usageTokens!)
    expect(done.stageMetrics?.filter((metric) => metric.agentStepId === 'c').map((metric) => metric.attempt)).toEqual([1, 2])
    expect(f.db.listRuns()).toHaveLength(1); expect(f.db.listMemories()).toEqual([])
    expect(f.db.getRun(f.id)!.events.some((event) => event.message.includes('从失败检查点继续'))).toBe(true)
    expect(f.git('ls-files')).toBe('.gitignore')
  }, 20_000)

  it('keeps a sealed sibling result and preserves the original failure when an earlier sibling is cancelled', async () => {
    const f = await fixture([step('a'), step('b')])
    let release: () => void = () => {}; const started = new Promise<void>((resolve) => { release = resolve })
    let rejectPeer: (error: Error) => void = () => {}
    await expect(new ParallelRunner(f.db).execute(f.read(), f.settings, () => {}, async (task) => {
      if (task.stepId === 'a') { const waiting = new Promise<never>((_, reject) => { rejectPeer = reject }); release(); return waiting }
      await started; throw new Error('b is the root cause')
    }, () => rejectPeer(new Error('a was cancelled')))).rejects.toThrow('b is the root cause')
    expect(f.read().agentTasks!.map((task) => task.status)).toEqual(['interrupted', 'failed'])

    // On the next attempt a finishes and is sealed before b fails.
    f.db.updateRun(f.id, { agentTasks: f.read().agentTasks!.map((task) => ({ ...task, status: 'interrupted' })) })
    await expect(new ParallelRunner(f.db).execute(f.read(), f.settings, () => {}, async (task) => {
      if (task.stepId === 'b') { await waitFor(() => f.read().agentTasks![0].status === 'ready'); throw new Error('b unavailable') }
      writeFileSync(join(task.workspace!, 'a.txt'), 'a'); return report('a')
    }, () => {})).rejects.toThrow('b unavailable')
    const failure = await new RunRecovery().capture({ ...f.read(), status: 'implementing' }, 'b unavailable')
    f.db.updateRun(f.id, { status: 'failed', failure })
    const executor = new FailureExecutor(); executor.failImplementation = false
    const orchestrator = f.createOrchestrator(executor)
    const plan = await orchestrator.getRecovery(f.id)
    expect(plan.steps.map((s) => s.action)).toEqual(['integrate', 'retry'])
    await orchestrator.recover(f.id, plan.failureAt!); await waitFor(() => ['completed', 'failed'].includes(f.read().status))
    expect(f.read().status).toBe('completed')
    expect(executor.calls.filter((c) => c.role === 'implementer')).toHaveLength(1)
    expect(executor.calls[0].prompt).toContain('只负责步骤 b')
  }, 20_000)

  it.each(['agent-edit', 'aggregate-edit', 'source-head', 'branch', 'missing-worktree', 'contract'] as const)('blocks recovery after %s without altering preserved results', async (change) => {
    const f = await failedFixture(); const before = f.read()
    const task = before.agentTasks!.find((task) => task.stepId === 'c')!
    if (change === 'agent-edit') writeFileSync(join(task.workspace!, 'c.txt'), 'external')
    if (change === 'aggregate-edit') writeFileSync(join(before.executionWorkspace!, 'a.txt'), 'external')
    if (change === 'source-head') f.git('commit', '--allow-empty', '-m', 'new baseline')
    if (change === 'branch') await git(task.workspace!, ['switch', '-c', 'foreman/external'])
    if (change === 'missing-worktree') rmSync(task.workspace!, { recursive: true, force: true })
    if (change === 'contract') f.db.updateRun(f.id, { contract: { ...before.contract!, summary: 'changed' } })
    const plan = await f.orchestrator.getRecovery(f.id)
    expect(plan.available).toBe(false); expect(plan.reason).not.toBe('')
    await expect(f.orchestrator.recover(f.id, before.failure!.at)).rejects.toThrow()
    expect(f.read().status).toBe('failed'); expect(f.read().agentTasks).toEqual(before.agentTasks)
    expect(f.db.listRuns()).toHaveLength(1)
  }, 20_000)

  it('rechecks file state after a preview and rejects stale or duplicate recovery requests', async () => {
    const f = await failedFixture(); const plan = await f.orchestrator.getRecovery(f.id)
    await expect(f.orchestrator.recover(f.id, 'old-failure')).rejects.toThrow('检查点已变化')
    writeFileSync(join(f.read().executionWorkspace!, 'a.txt'), 'changed after preview')
    await expect(f.orchestrator.recover(f.id, plan.failureAt!)).rejects.toThrow('失败后发生变化')
    writeFileSync(join(f.read().executionWorkspace!, 'a.txt'), 'a')
    f.executor.failImplementation = false
    const results = await Promise.allSettled([f.orchestrator.recover(f.id, plan.failureAt!), f.orchestrator.recover(f.id, plan.failureAt!)])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
    await waitFor(() => ['completed', 'failed'].includes(f.read().status))
    expect(f.read().status).toBe('completed')
  }, 20_000)

  it('reruns verification and review after reviewer failure without rerunning implementers', async () => {
    const f = await fixture([step('a')]); const executor = new FailureExecutor(); executor.failReview = true
    const orchestrator = f.createOrchestrator(executor)
    orchestrator.approve(f.id); await waitFor(() => f.read().status === 'failed')
    expect(f.read().failure?.phase).toBe('reviewing')
    expect((await orchestrator.getRecovery(f.id)).phase).toBe('verifying')
    executor.failReview = false
    await orchestrator.recover(f.id, f.read().failure!.at)
    await waitFor(() => ['completed', 'failed'].includes(f.read().status))
    expect(f.read().status).toBe('completed')
    expect(executor.calls.filter((c) => c.role === 'implementer')).toHaveLength(1)
    expect(f.read().stageMetrics!.filter((metric) => metric.stage === 'verifier')).toHaveLength(2)
    expect(f.read().verification?.status).toBe('passed')
  }, 20_000)

  it('never approves a recovered run while independent verification still fails', async () => {
    const f = await fixture([step('a')]); f.settings.verification.commands = ['node -e "process.exit(1)"']; f.db.saveSettings(f.settings)
    const executor = new FailureExecutor(); const orchestrator = f.createOrchestrator(executor)
    orchestrator.approve(f.id); await waitFor(() => f.read().status === 'failed')
    const firstFailure = f.read().failure!.at
    await orchestrator.recover(f.id, firstFailure); await waitFor(() => f.read().status === 'failed' && f.read().failure!.at !== firstFailure)
    expect(f.read().verification?.status).toBe('failed'); expect(f.read().reviewDecision?.verdict).toBe('approved')
    expect(executor.calls.filter((c) => c.role === 'implementer')).toHaveLength(1)
  }, 20_000)

  it('rejects legacy failures without a checkpoint and retains queued recovery phase on restart', async () => {
    const f = await fixture(); f.db.updateRun(f.id, { status: 'failed' })
    const orchestrator = f.createOrchestrator(new FailureExecutor())
    expect(await orchestrator.getRecovery(f.id)).toMatchObject({ available: false, reason: expect.stringContaining('失败检查点') })
    f.db.updateRun(f.id, { status: 'queued', checkpointPhase: 'verifying' })
    new ForemanDatabase(f.databasePath, f.root).recoverInterruptedRuns()
    expect(f.read()).toMatchObject({ status: 'paused', checkpointPhase: 'verifying' })
  })

  it('atomically claims a failed checkpoint across database connections without erasing artifacts on stale requests', async () => {
    const f = await fixture([step('a')]); const executor = new FailureExecutor(); executor.failReview = true
    const orchestrator = f.createOrchestrator(executor)
    orchestrator.approve(f.id); await waitFor(() => f.read().status === 'failed')
    const before = f.read(); const second = new ForemanDatabase(f.databasePath, f.root)
    expect(() => second.beginRecovery(f.id, 'stale', 'implementing', [])).toThrow('检查点已变化')
    expect(f.read()).toEqual(before)
    f.db.beginRecovery(f.id, before.failure!.at, 'verifying', before.agentTasks)
    expect(() => second.beginRecovery(f.id, before.failure!.at, 'implementing', [])).toThrow('检查点已变化')
    expect(f.read()).toMatchObject({ status: 'queued', checkpointPhase: 'verifying', implementationReport: before.implementationReport, agentTasks: before.agentTasks })
    expect(f.read().verification).toBeUndefined(); expect(f.read().reviewDecision).toBeUndefined()
  }, 20_000)

  it('continues the default serial implementation in its original workspace with partial files intact', async () => {
    const f = await fixture([step('a')]); let attempts = 0; let workspace = ''
    f.db.updateRun(f.id, { executionPolicy: { maxParallelAgents: 1, agents: [] } })
    const executor: AgentExecutor = {
      kind: 'codex', async probe() { return { installed: true, executable: 'fixture', version: 'test' } }, cancel() {},
      async execute(request) {
        if (request.role === 'reviewer') return { output: JSON.stringify(approved), exitCode: 0 }
        if (++attempts === 1) { workspace = request.workspace; writeFileSync(join(workspace, 'a.txt'), 'partial'); throw new Error('serial connection lost') }
        expect(request.workspace).toBe(workspace); expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('partial')
        expect(request.prompt).toContain('失败后的接续执行')
        writeFileSync(join(workspace, 'a.txt'), 'a'); return { output: JSON.stringify(report('a')), exitCode: 0 }
      }
    }
    const orchestrator = f.createOrchestrator(executor)
    orchestrator.approve(f.id); await waitFor(() => f.read().status === 'failed')
    const plan = await orchestrator.getRecovery(f.id)
    expect(plan).toMatchObject({ available: true, steps: [], reason: expect.stringContaining('执行阶段接续') })
    await orchestrator.recover(f.id, plan.failureAt!); await waitFor(() => ['completed', 'failed'].includes(f.read().status))
    expect(f.read().status).toBe('completed'); expect(f.read().verification?.status).toBe('passed'); expect(attempts).toBe(2)
  }, 20_000)

  it('retains review instructions and never reuses old verification after a failed rework', async () => {
    const f = await fixture([step('a')]); let implementations = 0; let reviews = 0
    f.settings.maxReviewLoops = 1; f.db.saveSettings(f.settings)
    const executor: AgentExecutor = {
      kind: 'codex', async probe() { return { installed: true, executable: 'fixture', version: 'test' } }, cancel() {},
      async execute(request) {
        if (request.role === 'reviewer') return { output: JSON.stringify(++reviews === 1 ? { ...approved, verdict: 'changes_requested', summary: '请补全日志处理' } : approved), exitCode: 0 }
        implementations++
        if (implementations === 3) {
          expect(readFileSync(join(request.workspace, 'a.txt'), 'utf8')).toBe('partial rework')
          expect(request.prompt).toContain('请补全日志处理')
        }
        writeFileSync(join(request.workspace, 'a.txt'), implementations === 2 ? 'partial rework' : 'a')
        if (implementations === 2) throw new Error('rework disconnected')
        return { output: JSON.stringify(report('a')), exitCode: 0 }
      }
    }
    const orchestrator = f.createOrchestrator(executor)
    orchestrator.approve(f.id); await waitFor(() => f.read().status === 'failed')
    expect(f.read().implementationReport).toBeUndefined(); expect(f.read().verification).toBeUndefined(); expect(f.read().reviewDecision).toBeUndefined()
    const plan = await orchestrator.getRecovery(f.id)
    expect(plan).toMatchObject({ available: true, phase: 'implementing', steps: [] })
    await orchestrator.recover(f.id, plan.failureAt!); await waitFor(() => ['completed', 'failed'].includes(f.read().status))
    expect(f.read().status).toBe('completed'); expect(f.read().verification?.status).toBe('passed')
    expect(implementations).toBe(3); expect(reviews).toBe(2)
  }, 20_000)

  it('explains an unresolved integration conflict instead of offering a retry of the same merge', async () => {
    const f = await fixture([step('a')])
    await expect(new ParallelRunner(f.db).execute(f.read(), f.settings, () => {}, async (task) => {
      writeFileSync(join(task.workspace!, 'a.txt'), 'a')
      writeFileSync(join(f.read().executionWorkspace!, 'a.txt'), 'conflicting integration edit')
      await git(f.read().executionWorkspace!, ['add', '.']); await git(f.read().executionWorkspace!, ['commit', '-m', 'conflict fixture'])
      return report('a')
    }, () => {})).rejects.toThrow('汇总冲突')
    const failure = await new RunRecovery().capture({ ...f.read(), status: 'implementing' }, 'integration failed')
    f.db.updateRun(f.id, { status: 'failed', failure })
    const plan = await f.createOrchestrator(new FailureExecutor()).getRecovery(f.id)
    expect(plan).toMatchObject({ available: false, reason: expect.stringContaining('汇总存在冲突') })
    expect(f.read().agentTasks![0].status).toBe('ready')
    expect(await git(f.read().executionWorkspace!, ['status', '--porcelain'])).toBe('')
  }, 20_000)

  it('reuses failed Goal runs within attempt limits and rejects direct recovery that bypasses Goal budgets', async () => {
    const f = await failedFixture(); f.executor.failImplementation = false
    const goal = f.db.createGoal({ title: 'Goal', objective: 'Goal recovery', workspace: f.root, successCriteria: ['files exist'], constraints: [], priority: 1, maxIterations: 5, maxTaskAttempts: 2 }, 'stable')
    f.db.updateGoalTask(goal.tasks[0].id, { runId: f.id, attempt: 1, status: 'running' })
    f.db.updateGoal(goal.goal.id, { currentTaskId: goal.tasks[0].id })
    expect((await f.orchestrator.getRecovery(f.id)).available).toBe(false)
    await expect(f.orchestrator.recover(f.id, f.read().failure!.at)).rejects.toThrow('长期目标')
    const runtime = new GoalRuntime(f.db, f.orchestrator, new DeliveryService(f.db, f.manager, () => {}), async () => 'stable')
    await runtime.tick(goal.goal.id)
    expect(runtime.get(goal.goal.id)?.tasks[0]).toMatchObject({ runId: f.id, attempt: 2, status: 'running' })
    expect(runtime.get(goal.goal.id)?.goal.iteration).toBe(1)
    await waitFor(() => ['completed', 'failed'].includes(f.read().status))
    expect(f.read().status).toBe('completed'); expect(f.db.listRuns()).toHaveLength(1)
    expect(runtime.get(goal.goal.id)?.goal.tokensUsed).toBe(f.read().usageTokens)
  }, 20_000)

  it.each(['attempts', 'tokens', 'iterations'] as const)('does not recover a Goal after its %s limit is exhausted', async (limit) => {
    const f = await failedFixture()
    const goal = f.db.createGoal({ title: 'Goal', objective: 'budget boundary', workspace: f.root, successCriteria: ['files exist'], constraints: [], priority: 1, maxIterations: 5, maxTaskAttempts: 2, ...(limit === 'tokens' ? { tokenBudget: 1 } : {}) }, 'stable')
    f.db.updateGoalTask(goal.tasks[0].id, { runId: f.id, attempt: limit === 'attempts' ? 2 : 1, status: 'running' })
    f.db.updateGoal(goal.goal.id, { currentTaskId: goal.tasks[0].id, iteration: limit === 'iterations' ? 5 : 0 })
    const runtime = new GoalRuntime(f.db, f.orchestrator, new DeliveryService(f.db, f.manager, () => {}), async () => 'stable')
    const calls = f.executor.calls.length
    await runtime.tick(goal.goal.id)
    expect(runtime.get(goal.goal.id)?.goal.status).toBe(limit === 'attempts' ? 'blocked' : 'failed')
    expect(f.read().status).toBe('failed'); expect(f.executor.calls).toHaveLength(calls); expect(f.db.listRuns()).toHaveLength(1)
  }, 20_000)
})
