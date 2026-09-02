import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { RunSummary } from '../../shared/contracts'
import type { PreparedWorkspace, WorkspaceDeliveryState, WorkspaceManager } from './types'
import { ensureWorkspaceBaseline } from './bootstrap'

const execFileAsync = promisify(execFile)

export class GitWorktreeManager implements WorkspaceManager {
  constructor(private readonly worktreeRoot: string) {}

  async prepare(run: RunSummary): Promise<PreparedWorkspace> {
    const baseline = await ensureWorkspaceBaseline(run.workspace)
    const { repository } = baseline
    const baseCommit = baseline.head
    const sourceDirty = Boolean((await this.git(repository, ['status', '--porcelain'])).trim())
    const branch = `foreman/${slug(run.title)}-${run.id.slice(0, 8)}`
    const projectWorktreeRoot = join(repository, '.foreman', 'worktrees')
    const path = join(projectWorktreeRoot, run.id)
    await this.ensureLocalExclude(repository)
    await mkdir(projectWorktreeRoot, { recursive: true })
    await this.git(repository, ['worktree', 'add', '-b', branch, path, 'HEAD'])
    return { path, branch, baseCommit, isolated: true, sourceDirty, initializedRepository: baseline.initializedRepository }
  }

  async inspect(run: RunSummary) {
    const { path, baseCommit } = await this.managed(run)
    await this.git(path, ['add', '-N', '--', '.'])
    const [diff, stat, numstat] = await Promise.all([
      this.git(path, ['diff', '--no-ext-diff', '--unified=3', baseCommit]),
      this.git(path, ['diff', '--stat', baseCommit]),
      this.git(path, ['diff', '--numstat', baseCommit])
    ])
    let additions = 0
    let deletions = 0
    let filesChanged = 0
    for (const line of numstat.trim().split('\n').filter(Boolean)) {
      const [added, deleted] = line.split('\t')
      additions += Number.isFinite(Number(added)) ? Number(added) : 0
      deletions += Number.isFinite(Number(deleted)) ? Number(deleted) : 0
      filesChanged += 1
    }
    return { diff: limitDiff(diff), stat, filesChanged, additions, deletions }
  }

  async merge(run: RunSummary) {
    const { path, branch } = await this.managed(run)
    const repository = (await this.git(run.workspace, ['rev-parse', '--show-toplevel'])).trim()
    const sourceStatus = await this.git(repository, ['status', '--porcelain'])
    if (sourceStatus.trim()) {
      const counts = statusCounts(sourceStatus)
      throw new Error(`源项目有已暂存 ${counts.staged} 个、未暂存 ${counts.unstaged} 个、未跟踪 ${counts.untracked} 个文件。请在交付向导中逐步保护这些改动后再合并。`)
    }
    if ((await this.git(path, ['status', '--porcelain'])).trim()) {
      await this.git(path, ['add', '-A'])
      await this.git(path, ['-c', 'user.name=Model Foreman', '-c', 'user.email=local@model-foreman.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', `Model Foreman: ${commitTitle(run.title)}`])
    }
    const commit = (await this.git(path, ['rev-parse', 'HEAD'])).trim()
    await this.git(repository, ['merge', '--ff-only', branch])
    let cleanupWarning: string | undefined
    try { await this.cleanup(repository, path, branch, false) }
    catch (error) { cleanupWarning = cleanupMessage(error) }
    return { commit, cleanupWarning }
  }

  async inspectDelivery(run: RunSummary): Promise<WorkspaceDeliveryState> {
    const { path, branch } = await this.managed(run)
    const repository = (await this.git(run.workspace, ['rev-parse', '--show-toplevel'])).trim()
    const [sourceStatus, taskStatus, sourceHead, branchHead, stashList] = await Promise.all([
      this.git(repository, ['status', '--porcelain']), this.git(path, ['status', '--porcelain']),
      this.git(repository, ['rev-parse', 'HEAD']), this.git(repository, ['rev-parse', branch]),
      this.git(repository, ['stash', 'list', '--format=%gd%x09%s'])
    ])
    const marker = stashMarker(run.id)
    const protectedRef = stashList.split('\n').find((line) => line.endsWith(`\tOn ${(line.match(/On ([^:]+):/)?.[1] ?? '')}: ${marker}`) || line.includes(marker))?.split('\t')[0]
    return {
      sourceChanges: statusCounts(sourceStatus), taskChanges: statusCounts(taskStatus),
      sourceFiles: statusFiles(sourceStatus), taskFiles: statusFiles(taskStatus),
      protectedRef, merged: sourceHead.trim() === branchHead.trim(), commit: branchHead.trim()
    }
  }

  async protectSource(run: RunSummary): Promise<void> {
    const repository = (await this.git(run.workspace, ['rev-parse', '--show-toplevel'])).trim()
    if (!(await this.git(repository, ['status', '--porcelain'])).trim()) return
    await this.git(repository, ['stash', 'push', '--include-untracked', '-m', stashMarker(run.id)])
  }

  async commitTask(run: RunSummary): Promise<string> {
    const { path } = await this.managed(run)
    if ((await this.git(path, ['status', '--porcelain'])).trim()) {
      await this.git(path, ['add', '-A'])
      await this.git(path, ['-c', 'user.name=Model Foreman', '-c', 'user.email=local@model-foreman.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', `Model Foreman: ${commitTitle(run.title)}`])
    }
    return (await this.git(path, ['rev-parse', 'HEAD'])).trim()
  }

  async mergeCommitted(run: RunSummary): Promise<string> {
    const { path, branch } = await this.managed(run)
    const repository = (await this.git(run.workspace, ['rev-parse', '--show-toplevel'])).trim()
    const sourceStatus = await this.git(repository, ['status', '--porcelain'])
    if (sourceStatus.trim()) {
      const counts = statusCounts(sourceStatus)
      throw new Error(`源项目仍有已暂存 ${counts.staged} 个、未暂存 ${counts.unstaged} 个、未跟踪 ${counts.untracked} 个文件，请先完成交付向导的“保护已有改动”。`)
    }
    if ((await this.git(path, ['status', '--porcelain'])).trim()) throw new Error('任务改动尚未创建提交，请先完成交付向导的“创建任务提交”。')
    await this.git(repository, ['merge', '--ff-only', branch])
    return (await this.git(repository, ['rev-parse', 'HEAD'])).trim()
  }

  async restoreSource(run: RunSummary): Promise<void> {
    const state = await this.inspectDelivery(run)
    if (!state.protectedRef) return
    const repository = (await this.git(run.workspace, ['rev-parse', '--show-toplevel'])).trim()
    await this.git(repository, ['stash', 'pop', '--index', state.protectedRef])
  }

  async cleanupMerged(run: RunSummary): Promise<void> {
    const { path, branch } = await this.managed(run)
    const repository = (await this.git(run.workspace, ['rev-parse', '--show-toplevel'])).trim()
    await this.cleanup(repository, path, branch, false)
  }

  async discard(run: RunSummary) {
    const { path, branch } = await this.managed(run)
    const repository = (await this.git(run.workspace, ['rev-parse', '--show-toplevel'])).trim()
    await this.cleanup(repository, path, branch, true)
    return {}
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
      return stdout
    } catch (error) {
      const detail = error as Error & { stderr?: string }
      throw new Error(detail.stderr?.trim() || detail.message || 'Git worktree 操作失败')
    }
  }

  private async managed(run: RunSummary): Promise<{ path: string; branch: string; baseCommit: string }> {
    if (!run.executionWorkspace || !run.branch || !run.baseCommit) throw new Error('任务缺少 worktree 元数据')
    const path = resolve(run.executionWorkspace)
    const repository = (await this.git(run.workspace, ['rev-parse', '--show-toplevel'])).trim()
    const roots = [resolve(repository, '.foreman', 'worktrees') + sep, resolve(this.worktreeRoot) + sep]
    if (!roots.some((root) => path.startsWith(root)) || !run.branch.startsWith('foreman/')) throw new Error('拒绝操作非 Model Foreman 管理的 worktree')
    return { path, branch: run.branch, baseCommit: run.baseCommit }
  }

  private async ensureLocalExclude(repository: string): Promise<void> {
    const gitPath = (await this.git(repository, ['rev-parse', '--git-path', 'info/exclude'])).trim()
    const excludePath = resolve(repository, gitPath)
    await mkdir(resolve(excludePath, '..'), { recursive: true })
    let current = ''
    try { current = await readFile(excludePath, 'utf8') } catch { /* Git may not have created info/exclude yet. */ }
    if (!current.split(/\r?\n/).includes('.foreman/')) {
      await appendFile(excludePath, `${current && !current.endsWith('\n') ? '\n' : ''}.foreman/\n`, 'utf8')
    }
  }

  private async cleanup(repository: string, path: string, branch: string, force: boolean): Promise<void> {
    await this.git(repository, ['worktree', 'remove', ...(force ? ['--force'] : []), path])
    await this.git(repository, ['branch', force ? '-D' : '-d', branch])
  }
}

function statusCounts(status: string): { staged: number; unstaged: number; untracked: number } {
  return status.split('\n').filter(Boolean).reduce((counts, line) => {
    if (line.startsWith('??')) counts.untracked += 1
    else {
      if (line[0] && line[0] !== ' ') counts.staged += 1
      if (line[1] && line[1] !== ' ') counts.unstaged += 1
    }
    return counts
  }, { staged: 0, unstaged: 0, untracked: 0 })
}

function stashMarker(runId: string): string { return `model-foreman:${runId}` }
function statusFiles(status: string): string[] {
  return status.split('\n').filter(Boolean).map((line) => line.slice(3).replace(/^.* -> /, '')).filter(Boolean)
}

function slug(value: string): string {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
  return (normalized || 'task').slice(0, 28)
}

function commitTitle(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, 72) || 'task changes'
}

function limitDiff(diff: string): string {
  const limit = 2_000_000
  return diff.length > limit ? `${diff.slice(0, limit)}\n\n[Diff 过大，已截断]` : diff
}

function cleanupMessage(error: unknown): string {
  return error instanceof Error ? `变更已合并，但自动清理未完成：${error.message}` : '变更已合并，但自动清理未完成'
}
