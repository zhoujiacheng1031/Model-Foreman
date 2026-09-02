import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readdir, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  GitHubCheckStatus, GitHubDeliveryStatus, GitHubPullRequestStatus, GitHubWorkflowRunStatus,
  GitOperationKind, GitOperationPlan, GitOperationResult, RepositoryBranch, RepositoryInspection
} from '../shared/contracts'

const execFileAsync = promisify(execFile)

export class RepositoryService {
  private readonly operationPlans = new Map<string, InternalGitPlan>()

  async inspect(workspace: string): Promise<RepositoryInspection> {
    const empty = disconnected(workspace, '请选择一个本地 Git 仓库，或从 GitHub 克隆。')
    if (!workspace.trim()) return empty
    try {
      const root = (await git(workspace, ['rev-parse', '--show-toplevel'])).trim()
      const branchValue = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim()
      const head = (await git(root, ['rev-parse', '--short=10', 'HEAD']).catch(() => '')).trim() || undefined
      const hasCommits = Boolean(head)
      const detached = hasCommits && !branchValue
      const branch = branchValue || (head ? `detached@${head}` : '未命名分支')
      const upstream = (await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '')).trim() || undefined
      const [ahead, behind] = upstream ? await divergence(root, upstream) : [0, 0]
      const status = parseStatus(await git(root, ['status', '--porcelain=v1', '-z']))
      const remoteName = (await git(root, ['remote']).catch(() => '')).trim().split('\n').filter(Boolean).find((name) => name === 'origin')
        ?? (await git(root, ['remote']).catch(() => '')).trim().split('\n').filter(Boolean)[0]
      const remoteUrl = remoteName ? (await git(root, ['remote', 'get-url', remoteName]).catch(() => '')).trim() || undefined : undefined
      const remoteWebUrl = remoteUrl ? toWebUrl(remoteUrl) : undefined
      const branches = parseBranches(await git(root, ['for-each-ref', '--format=%(refname:short)%00%(upstream:short)%00%(HEAD)', 'refs/heads']))
      const bootstrapEligible = !hasCommits && status.staged + status.unstaged + status.untracked + status.conflicts === 0
      return {
        connected: true, hasCommits, bootstrapEligible, bootstrapKind: bootstrapEligible ? 'empty-repository' : undefined,
        workspace, root, name: basename(root), branch, detached, head, upstream, ahead, behind,
        ...status, clean: status.staged + status.unstaged + status.untracked + status.conflicts === 0,
        remoteName, remoteUrl, remoteWebUrl, provider: remoteWebUrl?.startsWith('https://github.com/') ? 'github' : remoteUrl ? 'other' : undefined,
        branches, message: bootstrapEligible ? '空仓库已连接 · 首个任务将自动建立本地 Git 基线' : !hasCommits ? '仓库尚无基线且包含文件 · 请先人工创建首个 commit' : remoteUrl ? `${remoteName} 已连接` : '本地仓库 · 尚未配置远端'
      }
    } catch (error) {
      const folder = resolve(workspace)
      try {
        const info = await stat(folder)
        const entries = info.isDirectory() ? await readdir(folder) : ['not-a-directory']
        if (info.isDirectory() && entries.length === 0) {
          return { ...disconnected(workspace, '空文件夹已连接 · 首个任务将自动初始化 Git 并建立本地基线'), root: folder, name: basename(folder), bootstrapEligible: true, bootstrapKind: 'empty-directory' }
        }
        if (info.isDirectory()) return disconnected(workspace, '这个文件夹包含文件，但还不是可读取的 Git 仓库。为保护现有内容，请先检查文件并手动建立首个 Git commit。')
      } catch {
        return disconnected(workspace, '工作文件夹已不存在，请重新选择项目或从 GitHub 克隆。')
      }
      return disconnected(workspace, error instanceof Error ? error.message : '这不是有效的 Git 仓库')
    }
  }

  async cloneGitHub(url: string, parent: string): Promise<RepositoryInspection> {
    const normalized = validateGitHubUrl(url)
    const repositoryName = repositoryNameFromUrl(normalized)
    const destination = join(parent, repositoryName)
    const parentInfo = await stat(parent).catch(() => undefined)
    if (!parentInfo?.isDirectory()) throw new Error('所选存放位置已不存在，请重新选择文件夹。')
    if (await stat(destination).then(() => true).catch(() => false)) {
      throw new Error(`目标文件夹“${repositoryName}”已经存在，请选择其他位置或先打开现有项目。`)
    }
    try {
      await execFileAsync('git', ['clone', normalized, destination], { timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 })
    } catch (error) {
      await rm(destination, { recursive: true, force: true }).catch(() => undefined)
      throw new Error(toCloneUserMessage(error))
    }
    return this.inspect(destination)
  }

  async inspectGitHubDelivery(workspace: string): Promise<GitHubDeliveryStatus> {
    const polledAt = new Date().toISOString()
    const repository = await this.inspect(workspace)
    if (!repository.connected || repository.provider !== 'github' || !repository.remoteWebUrl) {
      return { available: false, authenticated: false, workflowRuns: [], polledAt, message: '连接 GitHub remote 后可监控 PR 与 CI/CD。' }
    }
    const slug = repository.remoteWebUrl.replace('https://github.com/', '')
    const cliVersion = await ghVersion()
    if (!cliVersion) return { available: false, authenticated: false, repository: slug, workflowRuns: [], polledAt, message: '未检测到 GitHub CLI（gh）；按下方引导安装后即可监控 PR 与 CI/CD。' }
    if (!(await ghAuthenticated())) return { available: true, authenticated: false, cliVersion, repository: slug, workflowRuns: [], polledAt, message: 'GitHub CLI 已安装但尚未登录；按下方引导完成 gh auth login。' }

    const pullRequest = repository.branch && !repository.detached
      ? await readPullRequest(slug, repository.branch)
      : undefined
    const workflowRuns = await readWorkflowRuns(slug, repository.branch)
    return {
      available: true, authenticated: true, cliVersion, repository: slug, pullRequest, workflowRuns, polledAt,
      message: pullRequest ? `正在监控 PR #${pullRequest.number} 与 GitHub Actions` : '当前分支尚无 PR；正在监控最近的 GitHub Actions。'
    }
  }

  async planOperation(workspace: string, kind: GitOperationKind, message?: string): Promise<GitOperationPlan> {
    this.prunePlans()
    const repository = await this.inspect(workspace)
    if (!repository.connected || !repository.root) throw new Error('请先连接有效的 Git 仓库')
    const blockers: string[] = []
    let commands: string[][] = []
    let rollbackArgs: string[] | undefined
    let command = ''
    let summary = ''
    let impact: string[] = []
    let confirmationPhrase = ''

    if (kind === 'commit') {
      const commitMessage = message?.trim() ?? ''
      if (!commitMessage) blockers.push('提交说明不能为空')
      if (commitMessage.length > 200) blockers.push('提交说明不能超过 200 个字符')
      if (repository.staged === 0) blockers.push('没有已暂存的文件；Foreman 不会自动执行 git add')
      if (repository.conflicts > 0) blockers.push('仓库仍有冲突，不能提交')
      commands = [['commit', '-m', commitMessage]]
      command = `git commit -m ${quoteForDisplay(commitMessage)}`
      summary = `提交当前已暂存的 ${repository.staged} 个文件`
      impact = ['只包含 Git index 中已暂存的变化', '不会自动暂存未暂存或未跟踪文件', `提交将创建在 ${repository.branch ?? '当前 HEAD'}`]
      confirmationPhrase = `COMMIT ${repository.head ?? 'INITIAL'}`
    } else if (kind === 'push') {
      const upstreamParts = repository.upstream?.split('/') ?? []
      const upstreamRemote = upstreamParts.shift()
      const remoteBranch = upstreamParts.join('/')
      if (!repository.hasCommits) blockers.push('仓库尚无 commit')
      if (repository.detached) blockers.push('当前为 detached HEAD')
      if (!upstreamRemote || !repository.upstream || !remoteBranch) blockers.push('当前分支没有既有 upstream；Foreman 不会自动创建远端分支')
      if (repository.ahead === 0) blockers.push('当前分支没有待推送 commit')
      if (repository.conflicts > 0) blockers.push('仓库仍有冲突，不能推送')
      commands = [['push', '--porcelain', upstreamRemote ?? 'origin', `HEAD:${remoteBranch || repository.branch || ''}`]]
      command = `git push --porcelain ${upstreamRemote ?? 'origin'} HEAD:${remoteBranch || '<upstream>'}`
      summary = `推送当前分支的 ${repository.ahead} 个 commit`
      impact = [`目标：${repository.upstream ?? '未配置 upstream'}`, '仅推送当前 HEAD，不执行 force', '不会创建 upstream、合并分支或打开 PR']
      confirmationPhrase = `PUSH ${repository.branch ?? 'HEAD'}`
    } else {
      const branch = repository.branch ?? ''
      const remoteName = repository.remoteName ?? 'origin'
      let remoteUrl = repository.remoteUrl
      if (!remoteUrl) {
        try { remoteUrl = validateGitHubUrl(message?.trim() ?? '') }
        catch (error) { blockers.push(error instanceof Error ? error.message : String(error)) }
      }
      if (!repository.hasCommits) blockers.push('仓库尚无 commit，不能首次发布')
      if (repository.detached || !branch) blockers.push('当前为 detached HEAD，不能首次发布')
      if (repository.upstream) blockers.push('当前分支已有 upstream，请使用普通安全推送')
      if (repository.remoteUrl && repository.provider !== 'github') blockers.push('现有 remote 不是受支持的 GitHub 地址')
      if (repository.conflicts > 0) blockers.push('仓库仍有冲突，不能首次发布')
      if (repository.behind > 0) blockers.push('本地分支落后于远端，不能首次发布')
      const target = `${remoteName}/${branch || '<branch>'}`
      if (repository.remoteUrl) {
        commands = [['push', '--porcelain', '--set-upstream', remoteName, `HEAD:${branch}`]]
        command = `git push --porcelain --set-upstream ${remoteName} HEAD:${branch || '<branch>'}`
      } else {
        commands = [['remote', 'add', 'origin', remoteUrl ?? ''], ['push', '--porcelain', '--set-upstream', 'origin', `HEAD:${branch}`]]
        rollbackArgs = ['remote', 'remove', 'origin']
        command = `git remote add origin ${quoteForDisplay(remoteUrl ?? '<GitHub URL>')}\ngit push --porcelain --set-upstream origin HEAD:${branch || '<branch>'}`
      }
      summary = repository.remoteUrl ? `首次发布 ${branch || '当前分支'} 并建立 upstream` : `绑定 GitHub remote 并首次发布 ${branch || '当前分支'}`
      impact = [`目标：${remoteUrl ?? '无效 GitHub 地址'} · ${target}`, repository.remoteUrl ? '将在 GitHub 创建远端分支并设置 upstream' : '将新增 origin、创建远端分支并设置 upstream', '仅推送当前 HEAD，不执行 force；推送失败时会撤销本次新增的 origin', '不会自动创建或合并 PR']
      confirmationPhrase = `PUBLISH ${branch || 'HEAD'}`
    }

    const id = randomUUID(); const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
    const plan: GitOperationPlan = { id, kind, workspace: repository.root, command, summary, impact, blockers, confirmationPhrase, expiresAt }
    this.operationPlans.set(id, { plan, commands, rollbackArgs, fingerprint: await repositoryFingerprint(repository.root) })
    return plan
  }

  async executeOperation(planId: string, confirmation: string): Promise<GitOperationResult> {
    const stored = this.operationPlans.get(planId)
    this.operationPlans.delete(planId)
    if (!stored) throw new Error('操作计划不存在或已经使用，请重新预览')
    const { plan, commands, rollbackArgs, fingerprint } = stored
    if (Date.now() > Date.parse(plan.expiresAt)) throw new Error('操作计划已过期，请重新预览')
    if (plan.blockers.length) throw new Error(`操作被阻止：${plan.blockers.join('；')}`)
    if (confirmation !== plan.confirmationPhrase) throw new Error('确认短语不匹配，未执行任何 Git 写操作')
    if (await repositoryFingerprint(plan.workspace) !== fingerprint) throw new Error('仓库在预览后发生变化，请重新检查并生成操作计划')
    const output: string[] = []
    let completed = 0
    try {
      for (const args of commands) { output.push(await git(plan.workspace, args)); completed += 1 }
    } catch (error) {
      if (rollbackArgs && completed > 0) await git(plan.workspace, rollbackArgs).catch(() => '')
      throw error
    }
    return { kind: plan.kind, output: output.join('\n').trim() || `${plan.kind} 已完成`, repository: await this.inspect(plan.workspace) }
  }

  private prunePlans() {
    const now = Date.now()
    for (const [id, value] of this.operationPlans) if (Date.parse(value.plan.expiresAt) <= now) this.operationPlans.delete(id)
  }
}

interface InternalGitPlan { plan: GitOperationPlan; commands: string[][]; rollbackArgs?: string[]; fingerprint: string }

async function ghVersion(): Promise<string | undefined> {
  return execFileAsync('gh', ['--version'], { timeout: 5_000 }).then(({ stdout }) => stdout.trim().split('\n')[0]?.replace(/^gh version\s+/i, '')).catch(() => undefined)
}

async function ghAuthenticated(): Promise<boolean> {
  return execFileAsync('gh', ['auth', 'status', '--hostname', 'github.com'], { timeout: 10_000 }).then(() => true).catch(() => false)
}

async function readPullRequest(repository: string, branch: string): Promise<GitHubPullRequestStatus | undefined> {
  try {
    const value = await ghJson<Record<string, unknown>>(['pr', 'view', branch, '--repo', repository, '--json', 'number,title,url,state,isDraft,mergeStateStatus,reviewDecision,headRefName,baseRefName,statusCheckRollup'])
    const checks = Array.isArray(value.statusCheckRollup) ? value.statusCheckRollup.map(parseCheck).filter((item): item is GitHubCheckStatus => Boolean(item)) : []
    return {
      number: Number(value.number), title: String(value.title), url: String(value.url), state: String(value.state), isDraft: Boolean(value.isDraft),
      mergeStateStatus: optionalString(value.mergeStateStatus), reviewDecision: optionalString(value.reviewDecision),
      headRefName: String(value.headRefName), baseRefName: String(value.baseRefName), checks
    }
  } catch { return undefined }
}

async function readWorkflowRuns(repository: string, branch?: string): Promise<GitHubWorkflowRunStatus[]> {
  try {
    const args = ['run', 'list', '--repo', repository, '--limit', '6', '--json', 'databaseId,workflowName,displayTitle,status,conclusion,event,headBranch,url,updatedAt']
    if (branch && !branch.startsWith('detached@')) args.splice(4, 0, '--branch', branch)
    const rows = await ghJson<Array<Record<string, unknown>>>(args)
    return rows.map((row) => ({
      id: Number(row.databaseId), workflowName: String(row.workflowName || 'GitHub Actions'), title: String(row.displayTitle || ''),
      status: String(row.status), conclusion: optionalString(row.conclusion), event: String(row.event || ''), branch: String(row.headBranch || ''),
      url: String(row.url), updatedAt: String(row.updatedAt)
    }))
  } catch { return [] }
}

function parseCheck(row: unknown): GitHubCheckStatus | undefined {
  if (!row || typeof row !== 'object') return undefined
  const value = row as Record<string, unknown>
  const name = optionalString(value.name) ?? optionalString(value.context)
  if (!name) return undefined
  return { name, status: String(value.status ?? value.state ?? 'UNKNOWN'), conclusion: optionalString(value.conclusion), url: optionalString(value.detailsUrl) ?? optionalString(value.targetUrl) }
}

function optionalString(value: unknown): string | undefined { return typeof value === 'string' && value ? value : undefined }

async function ghJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync('gh', args, { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
  return JSON.parse(stdout) as T
}

async function repositoryFingerprint(root: string): Promise<string> {
  const [head, status, upstream, remotes] = await Promise.all([
    git(root, ['rev-parse', '--verify', 'HEAD']).catch(() => 'NO_HEAD'),
    git(root, ['status', '--porcelain=v1', '-z']),
    git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => 'NO_UPSTREAM'),
    git(root, ['remote', '-v']).catch(() => 'NO_REMOTES')
  ])
  return createHash('sha256').update(head).update('\0').update(status).update('\0').update(upstream).update('\0').update(remotes).digest('hex')
}

function quoteForDisplay(value: string): string { return JSON.stringify(value) }

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch (error) {
    const detail = error as Error & { stderr?: string }
    throw new Error(detail.stderr?.trim() || detail.message || '无法读取 Git 仓库')
  }
}

async function divergence(root: string, upstream: string): Promise<[number, number]> {
  const value = (await git(root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`])).trim().split(/\s+/).map(Number)
  return [value[0] || 0, value[1] || 0]
}

function parseStatus(value: string): Pick<RepositoryInspection, 'staged' | 'unstaged' | 'untracked' | 'conflicts'> {
  let staged = 0; let unstaged = 0; let untracked = 0; let conflicts = 0
  for (const entry of value.split('\0').filter(Boolean)) {
    const code = entry.slice(0, 2)
    if (code === '??') { untracked += 1; continue }
    if (code.includes('U') || ['AA', 'DD'].includes(code)) { conflicts += 1; continue }
    if (code[0] !== ' ') staged += 1
    if (code[1] !== ' ') unstaged += 1
  }
  return { staged, unstaged, untracked, conflicts }
}

function parseBranches(value: string): RepositoryBranch[] {
  return value.trim().split('\n').filter(Boolean).map((line) => {
    const [name, upstream, marker] = line.split('\0')
    return { name, current: marker === '*', upstream: upstream || undefined }
  }).sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name)).slice(0, 30)
}

function disconnected(workspace: string, message: string): RepositoryInspection {
  return { connected: false, hasCommits: false, bootstrapEligible: false, workspace, detached: false, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, clean: false, branches: [], message }
}

export function validateGitHubUrl(value: string): string {
  const url = value.trim()
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url)) return url.replace(/\/$/, '')
  if (/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url)) return url
  throw new Error('请输入有效的 GitHub HTTPS 或 SSH 仓库地址')
}

function repositoryNameFromUrl(url: string): string {
  return url.split(/[/:]/).at(-1)!.replace(/\.git$/, '')
}

export function toCloneUserMessage(error: unknown): string {
  const detail = error as Error & { stderr?: string; stdout?: string }
  const raw = [detail?.stderr, detail?.message, detail?.stdout].filter(Boolean).join('\n')
  if (/repository not found|not found.*repository/i.test(raw)) {
    return '找不到该 GitHub 仓库，或当前账号无权访问。请检查仓库地址；若是私有仓库，请先在本机完成 GitHub 登录或配置 SSH 凭据。'
  }
  if (/authentication failed|could not read username|permission denied|publickey|access denied/i.test(raw)) {
    return 'GitHub 身份验证失败。HTTPS 仓库请先登录 GitHub CLI，SSH 仓库请检查本机密钥与仓库访问权限。'
  }
  if (/could not resolve host|failed to connect|network is unreachable|connection timed out/i.test(raw)) {
    return '无法连接 GitHub。请检查网络、代理或 DNS 后重试。'
  }
  if (/already exists and is not an empty directory/i.test(raw)) {
    return '同名目标文件夹已经存在。请选择其他存放位置，或直接打开现有项目。'
  }
  const firstUsefulLine = raw.split('\n').map((line) => line.trim()).find((line) => line && !/^error invoking remote method/i.test(line) && !/^fatal:/i.test(line))
  return firstUsefulLine ? `GitHub 仓库克隆失败：${firstUsefulLine}` : 'GitHub 仓库克隆失败，请检查地址、访问权限与网络后重试。'
}

export function toWebUrl(remote: string): string | undefined {
  const https = remote.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (https) return `https://github.com/${https[1]}/${https[2]}`
  const ssh = remote.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/)
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`
  return undefined
}
