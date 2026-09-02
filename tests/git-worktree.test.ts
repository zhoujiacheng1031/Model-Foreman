import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RunSummary } from '../src/shared/contracts'
import { GitWorktreeManager } from '../src/main/workspace/git-worktree'

const temporaryDirectories: string[] = []

describe('GitWorktreeManager', () => {
  afterEach(() => {
    for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
  })

  it('从 HEAD 创建独立分支和工作目录', async () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-worktree-test-'))
    temporaryDirectories.push(root)
    const repository = join(root, 'repository')
    execFileSync('git', ['init', repository])
    writeFileSync(join(repository, 'README.md'), '# fixture\n')
    execFileSync('git', ['-C', repository, 'config', 'user.name', 'Foreman Test'])
    execFileSync('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    execFileSync('git', ['-C', repository, 'add', 'README.md'])
    execFileSync('git', ['-C', repository, 'commit', '-m', 'initial'])

    const run: RunSummary = {
      id: '12345678-aaaa-bbbb-cccc-123456789012', title: '隔离测试', objective: '验证 worktree',
      workspace: repository, status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
    const manager = new GitWorktreeManager(join(root, 'worktrees'))
    const prepared = await manager.prepare(run)

    expect(prepared.isolated).toBe(true)
    expect(prepared.path).toBe(join(realpathSync(repository), '.foreman', 'worktrees', run.id))
    expect(execFileSync('git', ['-C', repository, 'status', '--porcelain'], { encoding: 'utf8' })).not.toContain('.foreman')
    expect(prepared.baseCommit).toMatch(/^[a-f0-9]{40}$/)
    expect(prepared.branch).toBe('foreman/隔离测试-12345678')
    expect(existsSync(join(prepared.path, 'README.md'))).toBe(true)
    expect(execFileSync('git', ['-C', prepared.path, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe(prepared.branch)

    writeFileSync(join(prepared.path, 'README.md'), '# changed\n')
    writeFileSync(join(prepared.path, 'feature.txt'), 'new file\n')
    const inspection = await new GitWorktreeManager(join(root, 'worktrees')).inspect({
      ...run, executionWorkspace: prepared.path, branch: prepared.branch, baseCommit: prepared.baseCommit, isolated: true
    })
    expect(inspection.filesChanged).toBe(2)
    expect(inspection.additions).toBeGreaterThan(0)
    expect(inspection.diff).toContain('feature.txt')

    await new GitWorktreeManager(join(root, 'worktrees')).merge({
      ...run, executionWorkspace: prepared.path, branch: prepared.branch, baseCommit: prepared.baseCommit, isolated: true
    })
    expect(readFileSync(join(repository, 'README.md'), 'utf8')).toBe('# changed\n')
    expect(existsSync(join(repository, 'feature.txt'))).toBe(true)
    expect(existsSync(prepared.path)).toBe(false)
  })

  it('从普通空文件夹初始化 Git 基线并创建隔离工作目录', async () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-empty-folder-test-'))
    temporaryDirectories.push(root)
    const repository = join(root, 'new-project')
    execFileSync('mkdir', [repository])
    const run: RunSummary = {
      id: '11111111-aaaa-bbbb-cccc-123456789012', title: '从零创建应用', objective: '建立新项目',
      workspace: repository, status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }

    const manager = new GitWorktreeManager(join(root, 'worktrees'))
    const prepared = await manager.prepare(run)

    expect(prepared.initializedRepository).toBe(true)
    expect(prepared.baseCommit).toMatch(/^[a-f0-9]{40}$/)
    expect(execFileSync('git', ['-C', repository, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }).trim()).toBe('chore: initialize Model Foreman workspace')
    expect(execFileSync('git', ['-C', prepared.path, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe(prepared.branch)
    writeFileSync(join(prepared.path, 'README.md'), '# new project\n')
    await manager.merge({ ...run, executionWorkspace: prepared.path, branch: prepared.branch, baseCommit: prepared.baseCommit, isolated: true })
    expect(readFileSync(join(repository, 'README.md'), 'utf8')).toBe('# new project\n')
  })

  it('为没有 commit 的空 Git 仓库创建初始基线', async () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-empty-repository-test-'))
    temporaryDirectories.push(root)
    const repository = join(root, 'repository')
    execFileSync('git', ['init', '-b', 'main', repository])
    const run: RunSummary = {
      id: '22222222-aaaa-bbbb-cccc-123456789012', title: '初始化仓库', objective: '建立项目骨架',
      workspace: repository, status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }

    const prepared = await new GitWorktreeManager(join(root, 'worktrees')).prepare(run)

    expect(prepared.initializedRepository).toBe(true)
    expect(execFileSync('git', ['-C', repository, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('1')
  })

  it('拒绝静默初始化包含未纳管文件的目录', async () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-untracked-folder-test-'))
    temporaryDirectories.push(root)
    writeFileSync(join(root, 'secret.env'), 'TOKEN=do-not-commit\n')
    const run: RunSummary = {
      id: '33333333-aaaa-bbbb-cccc-123456789012', title: '不安全初始化', objective: '不应导入文件',
      workspace: root, status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }

    await expect(new GitWorktreeManager(join(root, 'worktrees')).prepare(run)).rejects.toThrow(/非空|基线/)
  })

  it('放弃时清理 worktree 和分支', async () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-discard-test-'))
    temporaryDirectories.push(root)
    const repository = join(root, 'repository')
    execFileSync('git', ['init', repository])
    execFileSync('git', ['-C', repository, 'config', 'user.name', 'Foreman Test'])
    execFileSync('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    writeFileSync(join(repository, 'README.md'), '# fixture\n')
    execFileSync('git', ['-C', repository, 'add', 'README.md'])
    execFileSync('git', ['-C', repository, 'commit', '-m', 'initial'])
    const run: RunSummary = {
      id: '87654321-aaaa-bbbb-cccc-123456789012', title: '放弃测试', objective: '验证清理',
      workspace: repository, status: 'cancelled', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
    const manager = new GitWorktreeManager(join(root, 'worktrees'))
    const prepared = await manager.prepare(run)
    writeFileSync(join(prepared.path, 'throw-away.txt'), 'discard me\n')
    await manager.discard({ ...run, executionWorkspace: prepared.path, branch: prepared.branch, baseCommit: prepared.baseCommit })
    expect(existsSync(prepared.path)).toBe(false)
    expect(execFileSync('git', ['-C', repository, 'branch', '--list', prepared.branch], { encoding: 'utf8' }).trim()).toBe('')
  })

  it('合并被源目录改动阻塞时返回可执行的分类引导', async () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-merge-guide-test-'))
    temporaryDirectories.push(root)
    const repository = join(root, 'repository')
    execFileSync('git', ['init', repository])
    execFileSync('git', ['-C', repository, 'config', 'user.name', 'Foreman Test'])
    execFileSync('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    writeFileSync(join(repository, 'README.md'), '# fixture\n')
    execFileSync('git', ['-C', repository, 'add', 'README.md'])
    execFileSync('git', ['-C', repository, 'commit', '-m', 'initial'])
    const run: RunSummary = {
      id: '99999999-aaaa-bbbb-cccc-123456789012', title: '交付引导', objective: '验证阻塞说明',
      workspace: repository, status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
    const manager = new GitWorktreeManager(join(root, 'legacy-worktrees'))
    const prepared = await manager.prepare(run)
    writeFileSync(join(prepared.path, 'feature.txt'), 'task change\n')
    writeFileSync(join(repository, 'README.md'), '# local edit\n')
    writeFileSync(join(repository, 'notes.txt'), 'untracked\n')

    await expect(manager.merge({ ...run, executionWorkspace: prepared.path, branch: prepared.branch, baseCommit: prepared.baseCommit }))
      .rejects.toThrow(/未暂存 1 个、未跟踪 1 个.*交付向导/)
  })

  it('分步交付会保护源改动、合并任务并原样恢复', async () => {
    const root = mkdtempSync(join(tmpdir(), 'foreman-step-delivery-test-'))
    temporaryDirectories.push(root)
    const repository = join(root, 'repository')
    execFileSync('git', ['init', repository])
    execFileSync('git', ['-C', repository, 'config', 'user.name', 'Foreman Test'])
    execFileSync('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    writeFileSync(join(repository, 'README.md'), '# original\n')
    execFileSync('git', ['-C', repository, 'add', 'README.md'])
    execFileSync('git', ['-C', repository, 'commit', '-m', 'initial'])
    const run: RunSummary = {
      id: 'aaaaaaaa-bbbb-cccc-dddd-123456789012', title: '分步交付', objective: '保护用户改动', workspace: repository,
      status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
    const manager = new GitWorktreeManager(join(root, 'legacy-worktrees'))
    const prepared = await manager.prepare(run)
    const managedRun = { ...run, executionWorkspace: prepared.path, branch: prepared.branch, baseCommit: prepared.baseCommit, isolated: true }
    writeFileSync(join(prepared.path, 'feature.txt'), 'delivered\n')
    writeFileSync(join(repository, 'README.md'), '# user edit\n')
    writeFileSync(join(repository, 'notes.txt'), 'keep me\n')

    const initialDelivery = await manager.inspectDelivery(managedRun)
    expect(initialDelivery.sourceChanges).toEqual({ staged: 0, unstaged: 1, untracked: 1 })
    expect(initialDelivery.sourceFiles).toEqual(['README.md', 'notes.txt'])
    expect(initialDelivery.taskFiles).toEqual(['feature.txt'])
    await manager.protectSource(managedRun)
    expect((await manager.inspectDelivery(managedRun)).protectedRef).toBe('stash@{0}')
    await manager.commitTask(managedRun)
    expect((await manager.inspectDelivery(managedRun)).taskChanges).toEqual({ staged: 0, unstaged: 0, untracked: 0 })
    await manager.mergeCommitted(managedRun)
    expect((await manager.inspectDelivery(managedRun)).merged).toBe(true)
    await manager.restoreSource(managedRun)
    expect(readFileSync(join(repository, 'README.md'), 'utf8')).toBe('# user edit\n')
    expect(readFileSync(join(repository, 'notes.txt'), 'utf8')).toBe('keep me\n')
    expect((await manager.inspectDelivery(managedRun)).protectedRef).toBeUndefined()
    await manager.cleanupMerged(managedRun)
    expect(existsSync(prepared.path)).toBe(false)
  })
})
