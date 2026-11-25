import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, readFile, readlink, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { RecoveryWorkspaceEvidence, RunFailure, RunRecoveryPlan, RunSummary } from '../shared/contracts'
import { dependencies, fileScope } from './parallel/dependencies'
import { executionContractSchema } from './protocols/role-protocol'

const exec = promisify(execFile)
async function git(workspace: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', workspace, ...args], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })
  return stdout
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

// These snapshots describe Git/file state, never private CLI conversation state.
export class RunRecovery {
  async capture(run: RunSummary, message: string): Promise<RunFailure> {
    const failure: RunFailure = { at: new Date().toISOString(), phase: run.status, message }
    try {
      this.assertContract(run)
      const workspace = await this.workspace(run, run.executionWorkspace!, run.branch!, run.baseCommit!)
      const agents = []
      for (const task of run.agentTasks ?? []) {
        if (task.workspace && task.status !== 'integrated') agents.push({ taskId: task.id,
          workspace: await this.workspace(run, task.workspace, task.branch!, task.baseCommit!) })
      }
      failure.checkpoint = { sourceHead: (await git(run.workspace, ['rev-parse', 'HEAD'])).trim(),
        contractHash: hash(JSON.stringify(run.contract)), workspace, agents }
    } catch (error) { failure.checkpointError = detail(error) }
    return failure
  }

  async inspect(run: RunSummary): Promise<RunRecoveryPlan> {
    const phase = ['verifying', 'reviewing'].includes(run.failure?.phase ?? '') && run.implementationReport ? 'verifying' : 'implementing'
    const plan: RunRecoveryPlan = { runId: run.id, failureAt: run.failure?.at, available: false, reason: '', phase,
      steps: ((run.reviewAttempt ?? 0) > 0 ? [] : run.agentTasks ?? []).map((task) => ({ stepId: task.stepId, title: task.title,
        action: task.status === 'integrated' ? 'reuse' : task.status === 'ready' ? 'integrate' : task.attempt ? 'retry' : 'pending' })) }
    try {
      if (run.status !== 'failed') throw new Error('只有失败任务可以从失败处继续')
      if ((run.resolution ?? 'open') !== 'open') throw new Error('任务已经交付或放弃，请重新创建任务')
      this.assertContract(run)
      const checkpoint = run.failure?.checkpoint
      if (!checkpoint) throw new Error(run.failure?.checkpointError || '此任务没有完整的失败检查点，请重新创建任务')
      if (checkpoint.contractHash !== hash(JSON.stringify(run.contract))) throw new Error('执行合同已变化，请重新创建任务并批准新计划')
      if (checkpoint.sourceHead !== run.baseCommit) throw new Error('源项目已偏离原任务基线，请重新创建任务')
      if ((await git(run.workspace, ['rev-parse', 'HEAD'])).trim() !== checkpoint.sourceHead) throw new Error('源项目提交已变化，请重新创建任务以使用新基线')
      const current = await this.workspace(run, run.executionWorkspace!, run.branch!, run.baseCommit!)
      if (!same(current, checkpoint.workspace)) throw new Error('任务工作区在失败后发生变化，请检查改动并重新创建任务')
      const tasks = run.agentTasks ?? []
      const ids = new Set(tasks.map((task) => task.stepId))
      if (tasks.length && (ids.size !== tasks.length || tasks.length !== run.contract!.steps.length)) throw new Error('步骤执行记录与合同不一致')
      for (const task of tasks) {
        const index = run.contract!.steps.findIndex((step) => step.id === task.stepId)
        const step = run.contract!.steps[index]
        if (!step || JSON.stringify(task.dependencies) !== JSON.stringify(dependencies(run.contract!.steps, index)) ||
          JSON.stringify(task.files) !== JSON.stringify(step.files.map(fileScope))) throw new Error(`步骤 ${task.stepId} 的依赖或修改范围已变化`)
        if (task.status === 'integrated' || task.status === 'ready') {
          if (!task.commit || !task.report || task.report.unresolved.length) throw new Error(`步骤 ${task.stepId} 缺少完整产出证据`)
          if (!task.dependencies.every((id) => tasks.some((dep) => dep.stepId === id && dep.status === 'integrated'))) throw new Error(`步骤 ${task.stepId} 的依赖尚未汇总`)
          if (task.status === 'integrated') {
            try { await git(run.executionWorkspace!, ['merge-base', '--is-ancestor', task.commit, 'HEAD']) }
            catch { throw new Error(`步骤 ${task.stepId} 的产出提交已不在任务分支历史中`) }
            continue
          }
          if (task.error?.includes('汇总冲突')) throw new Error(`步骤 ${task.stepId} 汇总存在冲突，产出已保留；请检查已有产出并重新创建任务`)
        }
        if (!task.workspace) {
          if (task.attempt || task.status !== 'pending') throw new Error(`步骤 ${task.stepId} 缺少工作区，无法接续`)
          continue
        }
        const saved = checkpoint.agents.find((entry) => entry.taskId === task.id)
        const evidence = await this.workspace(run, task.workspace, task.branch!, task.baseCommit!)
        if (!saved || !same(evidence, saved.workspace)) throw new Error(`步骤 ${task.stepId} 的工作区在失败后发生变化`)
        if (task.status === 'ready' && (evidence.headCommit !== task.commit || (await git(task.workspace, ['status', '--porcelain'])).trim())) throw new Error(`步骤 ${task.stepId} 的待汇总产出已变化`)
      }
      plan.available = true
      plan.reason = phase === 'verifying' ? '复用实现产出，重新执行完整验证与独立审查。' : tasks.length && !(run.reviewAttempt ?? 0) ? '复用已汇总和待汇总产出，接续未完成步骤，最后重新验证与审查。' : '沿用原工作区，从执行阶段接续，最后重新验证与审查。'
    } catch (error) { plan.reason = detail(error) }
    return plan
  }

  private assertContract(run: RunSummary): void {
    if (!run.isolated || !run.executionWorkspace || !run.branch || !run.baseCommit) throw new Error('缺少隔离工作区证据，请重新创建任务')
    const parsed = executionContractSchema.safeParse(run.contract)
    if (!parsed.success) throw new Error('缺少有效执行合同，请重新创建任务')
    const contract = parsed.data
    if (contract.steps.some((step) => !['approved', 'completed'].includes(step.status))) throw new Error('尚无已批准的完整执行合同，请重新创建任务')
  }

  private async workspace(run: RunSummary, path: string, branch: string, base: string): Promise<RecoveryWorkspaceEvidence> {
    if (!branch?.startsWith('foreman/') || !base) throw new Error('工作区缺少受管理分支或基准提交')
    const [sourceCommon, workCommon, sourcePath, workPath] = await Promise.all([
      git(run.workspace, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']), realpath(run.workspace), realpath(path)
    ])
    if (await realpath(sourceCommon.trim()) !== await realpath(workCommon.trim()) || sourcePath === workPath) throw new Error('工作区不属于原项目的隔离 worktree')
    const registered = (await git(run.workspace, ['worktree', 'list', '--porcelain', '-z'])).split('\0')
    const registeredPaths = await Promise.all(registered.filter((entry) => entry.startsWith('worktree ')).map((entry) => realpath(entry.slice(9)).catch(() => '')))
    const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value
    if (!registeredPaths.some((registeredPath) => normalize(registeredPath) === normalize(workPath)) || (await git(path, ['symbolic-ref', '--short', 'HEAD'])).trim() !== branch) throw new Error('工作区登记或分支已变化')
    try { await git(path, ['merge-base', '--is-ancestor', base, 'HEAD']) }
    catch { throw new Error('工作区的基准提交已不在当前分支历史中') }
    if ((await git(path, ['diff', '--name-only', '--diff-filter=U'])).trim()) throw new Error('工作区仍有未解决的合并冲突')
    const fingerprint = createHash('sha256')
    fingerprint.update(await git(path, ['diff', '--binary', '--no-ext-diff', 'HEAD']))
    fingerprint.update(await git(path, ['diff', '--cached', '--binary', '--no-ext-diff', 'HEAD']))
    const untracked = (await git(path, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).sort()
    for (const file of untracked) {
      const target = resolve(path, file)
      const stat = await lstat(target)
      const content = stat.isSymbolicLink() ? await readlink(target) : await readFile(join(path, file))
      fingerprint.update(JSON.stringify([file, stat.mode, createHash('sha256').update(content).digest('hex')]))
    }
    return { headCommit: (await git(path, ['rev-parse', 'HEAD'])).trim(), fingerprint: fingerprint.digest('hex') }
  }
}

function same(a: RecoveryWorkspaceEvidence, b: RecoveryWorkspaceEvidence): boolean {
  return a.headCommit === b.headCommit && a.fingerprint === b.fingerprint
}
function detail(error: unknown): string {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '保留的工作区或文件已缺失，请检查现场或重新创建任务'
  return error instanceof Error ? error.message.split('\n')[0] : String(error)
}
