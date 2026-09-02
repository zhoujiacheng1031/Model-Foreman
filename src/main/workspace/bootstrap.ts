import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const FOREMAN_NAME = 'Model Foreman'
const FOREMAN_EMAIL = 'local@model-foreman.invalid'

export interface WorkspaceBaseline {
  repository: string
  head: string
  initializedRepository: boolean
}

/**
 * Establishes the smallest safe Git baseline needed by the worktree runtime.
 * Existing files are never staged implicitly: only a truly empty directory or
 * a repository whose porcelain status is empty may be bootstrapped.
 */
export async function ensureWorkspaceBaseline(workspace: string): Promise<WorkspaceBaseline> {
  const folder = resolve(workspace)
  let info
  try { info = await stat(folder) }
  catch { throw new Error('所选工作文件夹不存在，请重新选择。') }
  if (!info.isDirectory()) throw new Error('所选工作区不是文件夹，请重新选择。')

  let repository = (await tryGit(folder, ['rev-parse', '--show-toplevel']))?.trim()
  let initializedRepository = false
  if (!repository) {
    const entries = await readdir(folder)
    if (entries.length) {
      throw new Error('所选文件夹不是 Git 仓库且非空。为避免静默提交现有文件，请先检查文件并手动建立 Git 基线。')
    }
    await git(folder, ['init', '-b', 'main'])
    repository = (await git(folder, ['rev-parse', '--show-toplevel'])).trim()
    initializedRepository = true
  }

  let head = (await tryGit(repository, ['rev-parse', '--verify', 'HEAD']))?.trim()
  if (!head) {
    const status = (await git(repository, ['status', '--porcelain=v1', '-z'])).trim()
    if (status) {
      throw new Error('仓库尚无 Git 基线且包含未纳管文件。为避免意外提交敏感内容，请先人工确认并创建首个 commit。')
    }
    await git(repository, [
      '-c', `user.name=${FOREMAN_NAME}`,
      '-c', `user.email=${FOREMAN_EMAIL}`,
      '-c', 'commit.gpgSign=false',
      'commit', '--allow-empty', '--no-verify', '-m', 'chore: initialize Model Foreman workspace'
    ])
    head = (await git(repository, ['rev-parse', '--verify', 'HEAD'])).trim()
    initializedRepository = true
  }

  return { repository, head, initializedRepository }
}

async function tryGit(cwd: string, args: string[]): Promise<string | undefined> {
  try { return await git(cwd, args) } catch { return undefined }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch (error) {
    const detail = error as Error & { stderr?: string }
    throw new Error(detail.stderr?.trim() || detail.message || 'Git 初始化失败')
  }
}
