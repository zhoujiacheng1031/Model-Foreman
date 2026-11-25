import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContractStep, ImplementationReport } from '../../src/shared/contracts'
import type { AgentExecutor } from '../../src/main/executors/types'
import { ForemanDatabase } from '../../src/main/storage/database'
import { GitWorktreeManager } from '../../src/main/workspace/git-worktree'
import { ExecutorRegistry } from '../../src/main/executors/registry'
import { Orchestrator } from '../../src/main/orchestrator'

export const step = (id: string, dependsOn: string[] = []): ContractStep => ({ id, title: id, description: `创建 ${id}.txt，UTF-8 内容严格等于 ${JSON.stringify(id)}，不得添加换行、空白或 BOM`,
  dependsOn, files: [`${id}.txt`], acceptanceCriteria: [`${id}.txt 的原始 UTF-8 内容严格等于 ${JSON.stringify(id)}，不得有尾随换行`], verificationCommands: [], status: 'approved' })
export const report = (id: string): ImplementationReport => ({ summary: id, filesChanged: [`${id}.txt`], commandsRun: [], unresolved: [] })
export const approved = { verdict: 'approved', summary: '已检查实际文件，满足合同', findings: [], confidence: 1 }

export async function recoveryFixture(steps = [step('a'), step('b'), step('c', ['a', 'b'])]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'foreman-recovery-')))
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid')
  writeFileSync(join(root, '.gitignore'), '.foreman/\n'); git('add', '.'); git('commit', '-m', 'baseline')
  const databasePath = join(root, '.foreman', 'runtime.sqlite')
  // GitWorktreeManager creates .foreman; keep SQLite out of the source change set.
  const manager = new GitWorktreeManager(join(root, 'unused'))
  mkdirSync(join(root, '.foreman'))
  const db = new ForemanDatabase(databasePath, root)
  const settings = db.getSettings()
  settings.execution = { maxParallelAgents: 2, agents: [] }
  settings.memory.enabled = false
  settings.maxReviewLoops = 0
  settings.verification = { enabled: true, commands: [`node -e "const fs=require('node:fs'); for(const id of ${JSON.stringify(steps.map((s) => s.id)).replaceAll('"', "'")}) if(fs.readFileSync(id+'.txt','utf8')!==id) process.exit(1)"`], timeoutSeconds: 10, stopOnFailure: true }
  db.saveSettings(settings)
  const initial = db.createRun({ title: '恢复验收', objective: '创建合同指定的文本文件，UTF-8 内容严格等于对应步骤 ID，不得添加换行、空白或 BOM', workspace: root })
  const prepared = await manager.prepare(initial)
  db.updateRun(initial.id, { executionWorkspace: prepared.path, branch: prepared.branch, baseCommit: prepared.baseCommit, isolated: true,
    contract: { version: 1, summary: '恢复验收', assumptions: [], risks: [], steps }, executionPolicy: settings.execution, status: 'awaiting_approval' })
  const createOrchestrator = (executor: AgentExecutor, database = db) => new Orchestrator(database, new ExecutorRegistry([executor]), manager, () => {})
  return { root, db, databasePath, settings, manager, git, id: initial.id, read: () => db.getRun(initial.id)!.run, createOrchestrator }
}

export function reopenRecoveryFixture(root: string, id: string) {
  const databasePath = join(root, '.foreman', 'runtime.sqlite')
  const db = new ForemanDatabase(databasePath, root)
  db.recoverInterruptedRuns()
  const settings = db.getSettings()
  const manager = new GitWorktreeManager(join(root, 'unused'))
  const createOrchestrator = (executor: AgentExecutor, database = db) => new Orchestrator(database, new ExecutorRegistry([executor]), manager, () => {})
  return { root, id, databasePath, db, settings, manager, read: () => db.getRun(id)!.run, createOrchestrator }
}

export async function waitFor(predicate: () => boolean, timeout = 15_000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('等待运行状态超时')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
