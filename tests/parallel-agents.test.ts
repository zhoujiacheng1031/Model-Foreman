import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ForemanDatabase } from '../src/main/storage/database'
import { GitWorktreeManager } from '../src/main/workspace/git-worktree'
import { ParallelRunner } from '../src/main/parallel/parallel-runner'
import { AgentWorkspaces, git } from '../src/main/parallel/agent-workspaces'
import { executionContractSchema } from '../src/main/protocols/role-protocol'
import { Orchestrator } from '../src/main/orchestrator'
import { ExecutorRegistry } from '../src/main/executors/registry'
import { ProcessExecutor } from '../src/main/executors/process-executor'
import { ForemanMemoryModule } from '../src/main/memory/memory-module'
import { LocalVerificationModule } from '../src/main/verification/local-verification'
import type { AgentExecutor, ExecuteRequest } from '../src/main/executors/types'
import type { ContractStep, ImplementationReport } from '../src/shared/contracts'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
const step = (id: string, dependsOn: string[] = [], files = [`${id}.txt`]): ContractStep => ({ id, title: id, description: `实现 ${id}`, dependsOn, files, acceptanceCriteria: ['完成'], verificationCommands: [], status: 'approved' })
const contract = (steps: ContractStep[]) => ({ version: 1 as const, summary: '协作', assumptions: [], risks: [], steps })
const report = (summary: string): ImplementationReport => ({ summary, filesChanged: [`${summary}.txt`], commandsRun: [], unresolved: [] })
async function fixture(steps: ContractStep[]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'foreman-parallel-'))); roots.push(root)
  const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  g('init'); g('config', 'user.name', 'Test'); g('config', 'user.email', 'test@example.invalid')
  writeFileSync(join(root, 'baseline.txt'), 'baseline'); g('add', '.'); g('commit', '-m', 'baseline')
  const db = new ForemanDatabase(join(root, 'runtime.sqlite'), root)
  const settings = db.getSettings(); settings.execution = { maxParallelAgents: 2, agents: [] }; settings.verification.enabled = false; db.saveSettings(settings)
  const run = db.createRun({ title: 'parallel', objective: '并行实现功能', workspace: root })
  const wm = new GitWorktreeManager(join(root, 'unused'))
  const ws = await wm.prepare(run)
  db.updateRun(run.id, { executionWorkspace: ws.path, branch: ws.branch, baseCommit: ws.baseCommit, isolated: true, contract: contract(steps), status: 'implementing' })
  return { db, root, settings, wm, run: db.getRun(run.id)!.run }
}
const waitFor = async (predicate: () => boolean) => {
  const start = Date.now()
  while (!predicate()) { if (Date.now() - start > 10000) throw new Error('timeout'); await new Promise((resolve) => setTimeout(resolve, 10)) }
}

describe('parallel agent governance', () => {
  it('only injects approved memory whose source commit exists in the agent history', async () => {
    const f = await fixture([step('a')])
    const accepted = f.db.createMemory({ workspace: f.root, kind: 'procedure', title: 'baseline', content: 'baseline procedure', status: 'approved', confidence: .9, sourceCommit: f.run.baseCommit })
    const siblingCommit = await git(f.root, ['commit-tree', `${f.run.baseCommit}^{tree}`, '-p', f.run.baseCommit!, '-m', 'unmerged sibling'])
    f.db.createMemory({ workspace: f.root, kind: 'procedure', title: 'sibling', content: 'unmerged procedure', status: 'approved', confidence: .9, sourceCommit: siblingCommit })
    const packet = await new ForemanMemoryModule(f.db).prepare({ workspace: f.root, objective: 'procedure', role: 'implementer', executionWorkspace: f.run.executionWorkspace, headCommit: f.run.baseCommit }, f.settings)
    expect(packet.entries.map((entry) => entry.id)).toEqual([accepted.id])
  })

  it('rejects duplicate, missing and cyclic dependencies', () => {
    expect(() => executionContractSchema.parse(contract([step('a', ['b']), step('b', ['a'])]))).toThrow()
    expect(() => executionContractSchema.parse(contract([step('a'), step('a')]))).toThrow()
    expect(() => executionContractSchema.parse(contract([step('a', ['unknown'])]))).toThrow()
  })

  it('runs independent steps together, then integrates dependencies without modifying the source checkout', async () => {
    const f = await fixture([step('a'), step('b'), step('c', ['a', 'b'])])
    let active = 0; let peak = 0; let firstWave = 0
    await new ParallelRunner(f.db).execute(f.run, f.settings, () => {}, async (task) => {
      active++; peak = Math.max(peak, active)
      if (task.stepId !== 'c') { firstWave++; await waitFor(() => firstWave === 2) }
      else expect(readFileSync(join(task.workspace!, 'a.txt'), 'utf8') + readFileSync(join(task.workspace!, 'b.txt'), 'utf8')).toBe('ab')
      writeFileSync(join(task.workspace!, `${task.stepId}.txt`), task.stepId)
      active--; return report(task.stepId)
    }, () => {})
    expect(peak).toBe(2)
    expect(f.db.getRun(f.run.id)!.run.agentTasks?.map((task) => task.status)).toEqual(['integrated', 'integrated', 'integrated'])
    expect(await git(f.root, ['ls-files'])).toBe('baseline.txt')
    expect(readFileSync(join(f.run.executionWorkspace!, 'c.txt'), 'utf8')).toBe('c')
    const tasks = f.db.getRun(f.run.id)!.run.agentTasks!
    for (const task of tasks) await expect(git(f.run.executionWorkspace!, ['merge-base', '--is-ancestor', task.commit!, 'HEAD'])).resolves.toBe('')
    // Replaying an integrated run is a no-op, including its Git history.
    const head = await git(f.run.executionWorkspace!, ['rev-parse', 'HEAD'])
    await new ParallelRunner(f.db).execute(f.run, f.settings, () => {}, async () => { throw new Error('must not rerun') }, () => {})
    expect(await git(f.run.executionWorkspace!, ['rev-parse', 'HEAD'])).toBe(head)
  }, 20000)

  it('serializes overlapping scopes and preserves old ordered contracts', async () => {
    const a = step('a', [], ['shared.txt']); const b = step('b', [], ['shared.txt'])
    const f = await fixture([a, b]); let active = 0; let peak = 0
    await new ParallelRunner(f.db).execute(f.run, f.settings, () => {}, async (task) => {
      active++; peak = Math.max(peak, active)
      writeFileSync(join(task.workspace!, 'shared.txt'), task.stepId)
      await new Promise((resolve) => setTimeout(resolve, 20)); active--; return report(task.stepId)
    }, () => {})
    expect(peak).toBe(1)
    expect(readFileSync(join(f.run.executionWorkspace!, 'shared.txt'), 'utf8')).toBe('b')
    const legacy = [step('a'), step('b')].map(({ dependsOn, ...value }) => value)
    expect(executionContractSchema.parse(contract(legacy)).steps[1].dependsOn).toBeUndefined()
  }, 20000)

  it('keeps failed work and refuses to integrate changes outside the approved scope', async () => {
    const f = await fixture([step('a')]); let cancelled = false
    await expect(new ParallelRunner(f.db).execute(f.run, f.settings, () => {}, async (task) => {
      writeFileSync(join(task.workspace!, 'outside.txt'), 'unsafe'); return report('a')
    }, () => { cancelled = true })).rejects.toThrow('超出已批准范围')
    expect(cancelled).toBe(true)
    const task = f.db.getRun(f.run.id)!.run.agentTasks![0]
    expect(task.status).toBe('failed'); expect(task.report?.summary).toBe('a')
    expect(readFileSync(join(task.workspace!, 'outside.txt'), 'utf8')).toBe('unsafe')
    expect(await git(f.run.executionWorkspace!, ['rev-parse', 'HEAD'])).toBe(f.run.baseCommit)
    expect(f.db.listMemories()).toEqual([])
  })

  it('recovers a persisted interrupted agent in the same worktree', async () => {
    const f = await fixture([step('a')])
    await expect(new ParallelRunner(f.db).execute(f.run, f.settings, () => {}, async (task) => {
      writeFileSync(join(task.workspace!, 'a.txt'), 'checkpoint'); throw new Error('interrupted')
    }, () => {})).rejects.toThrow('interrupted')
    const before = f.db.getRun(f.run.id)!.run.agentTasks![0]
    f.db.updateRun(f.run.id, { agentTasks: [{ ...before, status: 'running' }] })
    const reopened = new ForemanDatabase(join(f.root, 'runtime.sqlite'), f.root)
    await new ParallelRunner(reopened).execute(reopened.getRun(f.run.id)!.run, f.settings, () => {}, async (task) => {
      expect(task.workspace).toBe(before.workspace)
      expect(readFileSync(join(task.workspace!, 'a.txt'), 'utf8')).toBe('checkpoint')
      return report('a')
    }, () => {})
    expect(reopened.getRun(f.run.id)!.run.agentTasks![0].attempt).toBe(2)
  })

  it('preserves the integration checkout when a merge conflicts', async () => {
    const f = await fixture([step('a', [], ['baseline.txt'])])
    const task = { id: 'conflict-test', stepId: 'a', title: 'a', config: f.settings.roles.implementer, files: ['baseline.txt'], dependencies: [], attempt: 1, status: 'running' as const, updatedAt: new Date().toISOString() }
    const manager = new AgentWorkspaces(); const prepared = await manager.prepare(f.run, task)
    writeFileSync(join(prepared.workspace!, 'baseline.txt'), 'agent')
    const commit = await manager.seal({ ...task, ...prepared })
    writeFileSync(join(f.run.executionWorkspace!, 'baseline.txt'), 'integration')
    await git(f.run.executionWorkspace!, ['add', '.']); await git(f.run.executionWorkspace!, ['commit', '-m', 'other'])
    await expect(manager.integrate(f.run, { ...task, ...prepared, commit })).rejects.toThrow('汇总冲突')
    expect(readFileSync(join(f.run.executionWorkspace!, 'baseline.txt'), 'utf8')).toBe('integration')
    expect(await git(f.run.executionWorkspace!, ['status', '--porcelain'])).toBe('')
  })

  it('orchestrates mixed executors with scoped memory snapshots and one final reviewer', async () => {
    const f = await fixture([step('a'), step('b'), step('c', ['a', 'b'])])
    const calls: ExecuteRequest[] = []
    class Fake implements AgentExecutor {
      constructor(readonly kind: 'codex' | 'claude') {}
      async probe() { return { installed: true, executable: 'fake', version: 'test' } }
      cancel() {}
      async execute(request: ExecuteRequest) {
        calls.push(request)
        if (request.role === 'reviewer') return { output: JSON.stringify({ verdict: 'approved', summary: 'reviewed', findings: [], confidence: 1 }), exitCode: 0 }
        const id = request.prompt.match(/只负责步骤 (\w+)/)?.[1]!
        writeFileSync(join(request.workspace, `${id}.txt`), id)
        return { output: JSON.stringify(report(id)), exitCode: 0 }
      }
    }
    f.settings.execution!.agents = [f.settings.roles.implementer, { ...f.settings.roles.implementer, executor: 'claude', model: 'sonnet' }]
    f.db.saveSettings(f.settings)
    f.db.updateRun(f.run.id, { status: 'awaiting_approval', executionPolicy: f.settings.execution })
    const orchestrator = new Orchestrator(f.db, new ExecutorRegistry([new Fake('codex'), new Fake('claude')]), f.wm, () => {})
    orchestrator.approve(f.run.id)
    await waitFor(() => ['completed', 'failed'].includes(f.db.getRun(f.run.id)!.run.status))
    const done = f.db.getRun(f.run.id)!.run
    expect(done.error).toBe(''); expect(done.status).toBe('completed')
    expect(calls.filter((call) => call.role === 'reviewer')).toHaveLength(1)
    expect(new Set(done.agentTasks!.map((task) => task.config.executor)).size).toBe(2)
    const a = done.agentTasks!.find((task) => task.stepId === 'a')!
    const c = done.agentTasks!.find((task) => task.stepId === 'c')!
    expect(a.memorySnapshot?.text).not.toContain('"stepId":"b"')
    expect(c.memorySnapshot?.text).toContain('"stepId":"a"')
    expect(c.memorySnapshot?.text).toContain('"stepId":"b"')
    expect(f.db.listMemories()).toHaveLength(0)
  }, 20000)

  it('pauses every active agent and resumes their worktrees without restarting the planner', async () => {
    const f = await fixture([step('a'), step('b')]); let started = 0; let resumed = false
    const pending: Array<() => void> = []; const firstPaths = new Map<string, string>()
    const fake: AgentExecutor = {
      kind: 'codex', async probe() { return { installed: true, executable: 'fake', version: 'test' } },
      cancel() { pending.splice(0).forEach((reject) => reject()) },
      async execute(request) {
        if (request.role === 'reviewer') return { output: JSON.stringify({ verdict: 'approved', summary: 'ok', findings: [], confidence: 1 }), exitCode: 0 }
        expect(request.role).toBe('implementer')
        const id = request.prompt.match(/只负责步骤 (\w+)/)?.[1]!
        if (!resumed) {
          firstPaths.set(id, request.workspace); writeFileSync(join(request.workspace, `${id}.txt`), 'checkpoint'); started++
          await new Promise<void>((_, reject) => pending.push(() => reject(new Error('cancelled'))))
        }
        expect(request.workspace).toBe(firstPaths.get(id))
        expect(readFileSync(join(request.workspace, `${id}.txt`), 'utf8')).toBe('checkpoint')
        return { output: JSON.stringify(report(id)), exitCode: 0 }
      }
    }
    f.db.updateRun(f.run.id, { status: 'awaiting_approval', executionPolicy: f.settings.execution })
    const orchestrator = new Orchestrator(f.db, new ExecutorRegistry([fake]), f.wm, () => {})
    orchestrator.approve(f.run.id); await waitFor(() => started === 2)
    await orchestrator.pause(f.run.id)
    expect(f.db.getRun(f.run.id)!.run.status).toBe('paused')
    expect(f.db.getRun(f.run.id)!.run.agentTasks!.every((task) => task.status === 'interrupted')).toBe(true)
    expect(f.db.listMemories()).toHaveLength(0)
    resumed = true; orchestrator.resume(f.run.id)
    await waitFor(() => ['completed', 'failed'].includes(f.db.getRun(f.run.id)!.run.status))
    expect(f.db.getRun(f.run.id)!.run.status).toBe('completed')
    expect(f.db.getRun(f.run.id)!.run.agentTasks!.every((task) => task.attempt === 2)).toBe(true)
  }, 20000)
})

class ProcessHarness extends ProcessExecutor {
  execute(request: ExecuteRequest) { return this.runProcess(process.execPath, ['-e', 'console.log("ready"); setTimeout(() => console.log("done"), 600)'], request) }
  protected extractOutput(raw: string) { return raw }
}
it('cancels all processes belonging to one run without cancelling another run', async () => {
  const harness = new ProcessHarness(); let ready = 0
  const request = (runId: string): ExecuteRequest => ({ runId, role: 'implementer', model: 'test', effort: 'low', prompt: '', workspace: tmpdir(), emit: (event) => { if (event.message.includes('ready')) ready++ } })
  const results = Promise.allSettled([harness.execute(request('same')), harness.execute(request('same')), harness.execute(request('other'))])
  await waitFor(() => ready === 3); harness.cancel('same')
  const outcomes = await results
  expect(outcomes.map((item) => item.status)).toEqual(['rejected', 'rejected', 'fulfilled'])
})

it('cancels only the selected verification session and does not launch its next command', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'foreman-verifier-'))); roots.push(root)
  const verifier = new LocalVerificationModule()
  const settings = { enabled: true, commands: ['sleep 1', 'touch should-not-run'], timeoutSeconds: 5, stopOnFailure: false }
  const first = verifier.verify(root, settings, [], 'first')
  const second = verifier.verify(root, { ...settings, commands: ['sleep 0.2'] }, [], 'second')
  const outcomes = Promise.allSettled([first, second])
  await new Promise((resolve) => setTimeout(resolve, 50)); verifier.cancel('first')
  expect((await outcomes).map((outcome) => outcome.status)).toEqual(['rejected', 'fulfilled'])
  expect(() => readFileSync(join(root, 'should-not-run'))).toThrow()
})
