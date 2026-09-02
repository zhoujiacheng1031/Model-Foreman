import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RepositoryService, toCloneUserMessage, toWebUrl, validateGitHubUrl } from '../src/main/repository'

describe('RepositoryService', () => {
  it('normalizes supported GitHub remotes and rejects unrelated hosts', () => {
    expect(validateGitHubUrl('https://github.com/openai/codex.git')).toBe('https://github.com/openai/codex.git')
    expect(validateGitHubUrl('git@github.com:openai/codex.git')).toBe('git@github.com:openai/codex.git')
    expect(() => validateGitHubUrl('https://example.com/openai/codex')).toThrow(/GitHub/)
    expect(toWebUrl('git@github.com:openai/codex.git')).toBe('https://github.com/openai/codex')
    expect(toWebUrl('https://github.com/openai/codex.git')).toBe('https://github.com/openai/codex')
  })

  it('reports branch, remote and dirty working tree state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-repository-'))
    git(root, ['init', '-b', 'main'])
    git(root, ['config', 'user.email', 'foreman@example.com'])
    git(root, ['config', 'user.name', 'Model Foreman'])
    writeFileSync(join(root, 'tracked.txt'), 'first\n')
    git(root, ['add', 'tracked.txt']); git(root, ['commit', '-m', 'initial'])
    git(root, ['remote', 'add', 'origin', 'git@github.com:example/project.git'])
    writeFileSync(join(root, 'tracked.txt'), 'changed\n')
    writeFileSync(join(root, 'new.txt'), 'new\n')

    const result = await new RepositoryService().inspect(root)
    expect(result).toMatchObject({ connected: true, hasCommits: true, branch: 'main', provider: 'github', unstaged: 1, untracked: 1, clean: false })
    expect(result.remoteWebUrl).toBe('https://github.com/example/project')
    expect(result.branches[0]).toMatchObject({ name: 'main', current: true })
  })

  it('identifies empty folders and empty Git repositories as bootstrap-ready', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'foreman-empty-folder-inspect-'))
    const emptyFolder = await new RepositoryService().inspect(folder)
    expect(emptyFolder).toMatchObject({ connected: false, hasCommits: false, bootstrapEligible: true, bootstrapKind: 'empty-directory' })

    const repository = mkdtempSync(join(tmpdir(), 'foreman-empty-repo-inspect-'))
    git(repository, ['init', '-b', 'main'])
    const emptyRepository = await new RepositoryService().inspect(repository)
    expect(emptyRepository).toMatchObject({ connected: true, hasCommits: false, bootstrapEligible: true, bootstrapKind: 'empty-repository' })

    const unmanaged = mkdtempSync(join(tmpdir(), 'foreman-unmanaged-folder-inspect-'))
    writeFileSync(join(unmanaged, 'private.env'), 'SECRET=never-stage-me\n')
    const unmanagedFolder = await new RepositoryService().inspect(unmanaged)
    expect(unmanagedFolder).toMatchObject({ connected:false, bootstrapEligible:false })
    expect(unmanagedFolder.message).toMatch(/保护现有内容|手动建立/)
  })

  it('explains when the selected workspace was removed instead of exposing a Git fatal error', async () => {
    const missing = join(tmpdir(), `foreman-missing-${Date.now()}`)
    const result = await new RepositoryService().inspect(missing)

    expect(result.connected).toBe(false)
    expect(result.message).toBe('工作文件夹已不存在，请重新选择项目或从 GitHub 克隆。')
    expect(result.message).not.toMatch(/fatal:|cannot change/i)
  })

  it('turns GitHub clone failures into actionable guidance without leaking transport wrappers', () => {
    const error = Object.assign(new Error("Error invoking remote method 'repository:clone-github'"), {
      stderr: "remote: Repository not found.\nfatal: repository 'https://github.com/example/private-repo/' not found"
    })

    const message = toCloneUserMessage(error)
    expect(message).toMatch(/找不到.*仓库|无权访问/)
    expect(message).toMatch(/地址|私有|登录/)
    expect(message).not.toMatch(/Error invoking|fatal:/)
  })

  it('requires a bound preview and exact confirmation before committing staged files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-git-plan-'))
    git(root, ['init', '-b', 'main']); git(root, ['config', 'user.email', 'foreman@example.com']); git(root, ['config', 'user.name', 'Model Foreman'])
    writeFileSync(join(root, 'tracked.txt'), 'first\n'); git(root, ['add', 'tracked.txt']); git(root, ['commit', '-m', 'initial'])
    writeFileSync(join(root, 'tracked.txt'), 'second\n')
    const service = new RepositoryService()

    const blocked = await service.planOperation(root, 'commit', 'update tracked')
    expect(blocked.blockers).toContain('没有已暂存的文件；Foreman 不会自动执行 git add')
    git(root, ['add', 'tracked.txt'])
    const plan = await service.planOperation(root, 'commit', 'update tracked')
    expect(plan.command).toContain('git commit -m')
    await expect(service.executeOperation(plan.id, 'wrong')).rejects.toThrow(/确认短语/)
    const confirmed = await service.planOperation(root, 'commit', 'update tracked')
    const result = await service.executeOperation(confirmed.id, confirmed.confirmationPhrase)
    expect(result.repository.clean).toBe(true)
    expect(git(root, ['log', '-1', '--pretty=%s']).trim()).toBe('update tracked')
  })

  it('blocks push previews without an existing upstream', async () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-push-plan-'))
    git(root, ['init', '-b', 'main']); git(root, ['config', 'user.email', 'foreman@example.com']); git(root, ['config', 'user.name', 'Model Foreman'])
    writeFileSync(join(root, 'tracked.txt'), 'first\n'); git(root, ['add', 'tracked.txt']); git(root, ['commit', '-m', 'initial'])
    const service = new RepositoryService()
    const plan = await service.planOperation(root, 'push')
    expect(plan.blockers).toContain('当前分支没有既有 upstream；Foreman 不会自动创建远端分支')
    await expect(service.executeOperation(plan.id, plan.confirmationPhrase)).rejects.toThrow(/操作被阻止/)
  })

  it('previews a guarded first publish for repositories without a remote or upstream', async () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-publish-plan-'))
    git(root, ['init', '-b', 'main']); git(root, ['config', 'user.email', 'foreman@example.com']); git(root, ['config', 'user.name', 'Model Foreman'])
    writeFileSync(join(root, 'tracked.txt'), 'first\n'); git(root, ['add', 'tracked.txt']); git(root, ['commit', '-m', 'initial'])
    const service = new RepositoryService()
    const plan = await service.planOperation(root, 'publish', 'https://github.com/example/project.git')
    expect(plan.blockers).toEqual([])
    expect(plan.command).toContain('git remote add origin')
    expect(plan.command).toContain('git push --porcelain --set-upstream origin HEAD:main')
    expect(plan.confirmationPhrase).toBe('PUBLISH main')
    expect(plan.impact.join(' ')).toMatch(/不执行 force/)
  })

  it('invalidates a write preview when repository state changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-stale-plan-'))
    git(root, ['init', '-b', 'main']); git(root, ['config', 'user.email', 'foreman@example.com']); git(root, ['config', 'user.name', 'Model Foreman'])
    writeFileSync(join(root, 'tracked.txt'), 'first\n'); git(root, ['add', 'tracked.txt']); git(root, ['commit', '-m', 'initial'])
    writeFileSync(join(root, 'tracked.txt'), 'second\n'); git(root, ['add', 'tracked.txt'])
    const service = new RepositoryService()
    const plan = await service.planOperation(root, 'commit', 'stale preview')

    writeFileSync(join(root, 'other.txt'), 'changed after preview\n')
    git(root, ['add', 'other.txt'])

    await expect(service.executeOperation(plan.id, plan.confirmationPhrase)).rejects.toThrow(/仓库在预览后发生变化/)
    expect(git(root, ['log', '-1', '--pretty=%s']).trim()).toBe('initial')
  })
})

function git(cwd: string, args: string[]) {
  return execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe', encoding: 'utf8' })
}
