import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AgentTask, RunSummary } from '../../shared/contracts'
import { owns } from './dependencies'

const exec = promisify(execFile)
export async function git(path: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', path, ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
  return stdout.trim()
}
const identity = ['-c', 'user.name=Model Foreman', '-c', 'user.email=local@model-foreman.invalid', '-c', 'commit.gpgSign=false']

export class AgentWorkspaces {
  async prepare(run: RunSummary, task: AgentTask): Promise<Pick<AgentTask, 'workspace' | 'branch' | 'baseCommit'>> {
    if (!run.isolated || !run.executionWorkspace) throw new Error('并行执行需要 Foreman 隔离工作区')
    const root = join(run.workspace, '.foreman', 'worktrees')
    const workspace = join(root, task.id)
    const branch = `foreman/agent-${task.id}`
    await mkdir(root, { recursive: true })
    const baseCommit = await git(run.executionWorkspace, ['rev-parse', 'HEAD'])
    // A crash may occur after worktree creation but before metadata persistence.
    const worktrees = await git(run.workspace, ['worktree', 'list', '--porcelain'])
    if (worktrees.split('\n').includes(`worktree ${workspace}`)) {
      if (await git(workspace, ['symbolic-ref', '--short', 'HEAD']) !== branch) throw new Error('Agent 工作区分支不匹配')
      return { workspace, branch, baseCommit: await git(workspace, ['merge-base', 'HEAD', baseCommit]) }
    }
    await git(run.workspace, ['worktree', 'add', '-b', branch, workspace, baseCommit])
    return { workspace, branch, baseCommit }
  }

  async seal(task: AgentTask): Promise<string> {
    if (!task.workspace || !task.baseCommit || !task.branch) throw new Error('缺少 Agent 工作区证据')
    if (await git(task.workspace, ['symbolic-ref', '--short', 'HEAD']) !== task.branch) throw new Error('Agent 改变了受管理分支')
    const tracked = await git(task.workspace, ['diff', '--no-renames', '--name-only', '-z', task.baseCommit])
    const untracked = await git(task.workspace, ['ls-files', '--others', '--exclude-standard', '-z'])
    const files = [...new Set(`${tracked}\0${untracked}`.split('\0').filter(Boolean))]
    const outside = files.filter((file) => !owns(task.files, file))
    if (outside.length) throw new Error(`Agent 修改超出已批准范围：${outside.join(', ')}`)
    await git(task.workspace, ['add', '-A'])
    if (await git(task.workspace, ['diff', '--cached', '--name-only'])) {
      await git(task.workspace, [...identity, 'commit', '-m', `Foreman agent ${task.id}: ${task.title.replace(/[\r\n]/g, ' ').slice(0, 100)}`])
    }
    return git(task.workspace, ['rev-parse', 'HEAD'])
  }

  async integrate(run: RunSummary, task: AgentTask): Promise<void> {
    if (!run.executionWorkspace || !task.commit) throw new Error('缺少汇总提交')
    const path = run.executionWorkspace
    if (await git(path, ['status', '--porcelain'])) throw new Error('汇总工作区存在未提交改动，请检查后恢复')
    // Preserve ancestry so retry after a crash never applies a result twice.
    try { await git(path, ['merge-base', '--is-ancestor', task.commit, 'HEAD']); return } catch { /* not integrated */ }
    try { await git(path, [...identity, 'merge', '--no-ff', '--no-edit', task.commit]) }
    catch (error) {
      await git(path, ['merge', '--abort']).catch(() => {})
      throw new Error(`Agent ${task.stepId} 汇总冲突，工作区已保留：${String(error)}`)
    }
  }

  async cleanup(run: RunSummary, force: boolean): Promise<void> {
    for (const task of run.agentTasks ?? []) {
      const expected = resolve(run.workspace, '.foreman', 'worktrees', task.id)
      if (!task.workspace) continue
      if (resolve(task.workspace) !== expected || task.branch !== `foreman/agent-${task.id}`) throw new Error('拒绝清理未知 Agent 工作区')
      const worktrees = await git(run.workspace, ['worktree', 'list', '--porcelain'])
      if (worktrees.split('\n').includes(`worktree ${expected}`)) await git(run.workspace, ['worktree', 'remove', ...(force ? ['--force'] : []), expected])
      // Branches are retained as recovery evidence. No force-delete of unmerged work.
    }
  }
}
