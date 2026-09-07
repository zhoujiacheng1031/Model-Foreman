import { randomUUID } from 'node:crypto'
import type { AgentTask, AppSettings, ImplementationReport, RunSummary } from '../../shared/contracts'
import { ForemanDatabase } from '../storage/database'
import { AgentWorkspaces } from './agent-workspaces'
import { dependencies, fileScope, overlaps, validateDependencies } from './dependencies'

export class ParallelRunner {
  constructor(private readonly database: ForemanDatabase, private readonly workspaces = new AgentWorkspaces()) {}

  async execute(run: RunSummary, settings: AppSettings, assertActive: () => void,
    execute: (task: AgentTask, run: RunSummary) => Promise<ImplementationReport>, cancel: () => void): Promise<ImplementationReport> {
    const steps = run.contract!.steps
    validateDependencies(steps)
    const policy = run.executionPolicy ?? settings.execution ?? { maxParallelAgents: 1, agents: [] }
    const max = Math.min(4, Math.max(1, Math.trunc(policy.maxParallelAgents)))
    let tasks = this.database.getRun(run.id)!.run.agentTasks ?? []
    if (!tasks.length) {
      tasks = steps.map((step, i) => ({ id: randomUUID(), stepId: step.id, title: step.title,
        config: structuredClone(policy.agents[i % policy.agents.length] ?? settings.roles.implementer),
        dependencies: dependencies(steps, i), files: step.files.map(fileScope), status: 'pending', attempt: 0, updatedAt: new Date().toISOString() }))
      this.database.updateRun(run.id, { agentTasks: tasks, executionPolicy: policy })
    }
    const read = () => this.database.getRun(run.id)!.run.agentTasks!
    const update = (id: string, changes: Partial<AgentTask>) => {
      this.database.updateRun(run.id, { agentTasks: read().map((task) => task.id === id ? { ...task, ...changes, updatedAt: new Date().toISOString() } : task) })
    }
    // Recover interrupted subprocesses without losing their worktrees or checkpoints.
    for (const task of read()) if (task.status === 'running') update(task.id, { status: 'interrupted' })
    while (read().some((task) => task.status !== 'integrated')) {
      assertActive()
      for (const task of read().filter((item) => item.status === 'ready')) {
        assertActive()
        try { await this.workspaces.integrate(run, task) }
        catch (error) { update(task.id, { error: String(error) }); throw error }
        assertActive()
        update(task.id, { status: 'integrated', error: undefined })
      }
      const current = read()
      if (current.every((task) => task.status === 'integrated')) break
      const ready = current.filter((task) => task.status !== 'integrated' && task.status !== 'ready' && task.dependencies.every((id) => current.some((dep) => dep.stepId === id && dep.status === 'integrated')))
      const batch: AgentTask[] = []
      for (const task of ready) if (batch.length < max && !batch.some((other) => overlaps(other.files, task.files))) batch.push(task)
      if (!batch.length) throw new Error('没有可执行步骤，请检查依赖状态')
      // Worktree creation touches shared Git administration; serialize it before agent execution.
      for (const task of batch) {
        assertActive()
        if (!task.workspace) update(task.id, await this.workspaces.prepare(run, task))
      }
      for (const task of batch) update(task.id, { status: 'pending' })
      let batchFailed = false
      const outcomes = await Promise.allSettled(batch.map(async (selected) => {
        let task = read().find((item) => item.id === selected.id)!
        try {
          assertActive()
          if (batchFailed) throw new Error('同批 Agent 已失败，尚未开始本步骤')
          update(task.id, { status: 'running', attempt: task.attempt + 1 })
          task = read().find((item) => item.id === task.id)!
          const report = await execute(task, this.database.getRun(run.id)!.run)
          assertActive()
          update(task.id, { report })
          if (report.unresolved.length) throw new Error(`Agent 尚有未解决事项：${report.unresolved.join('；')}`)
          const commit = await this.workspaces.seal(task)
          assertActive()
          update(task.id, { commit, status: 'ready', error: undefined })
        } catch (error) {
          batchFailed = true; cancel()
          const status = this.database.getRun(run.id)?.run.status
          update(task.id, { status: status === 'paused' || status === 'cancelled' ? 'interrupted' : 'failed', error: String(error) })
          throw error
        }
      }))
      const failure = outcomes.find((item): item is PromiseRejectedResult => item.status === 'rejected')
      if (failure) throw failure.reason
    }
    const reports = read().map((task) => task.report!)
    return { summary: reports.map((report) => report.summary).join('\n'), filesChanged: [...new Set(reports.flatMap((report) => report.filesChanged))],
      commandsRun: reports.flatMap((report) => report.commandsRun), unresolved: reports.flatMap((report) => report.unresolved) }
  }
}
