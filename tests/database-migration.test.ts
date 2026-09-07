import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ForemanDatabase, defaultSettings } from '../src/main/storage/database'

describe('ForemanDatabase migration', () => {
  const directories: string[] = []
  afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

  it('无损升级旧设置、运行表和记忆来源字段', () => {
    const directory = mkdtempSync(join(tmpdir(), 'foreman-migration-')); directories.push(directory)
    const path = join(directory, 'foreman.db'); const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE runs (id TEXT PRIMARY KEY,title TEXT NOT NULL,objective TEXT NOT NULL,workspace TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,plan TEXT,result TEXT,review TEXT,error TEXT);
      CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,at TEXT NOT NULL,phase TEXT NOT NULL,kind TEXT NOT NULL,message TEXT NOT NULL);
      CREATE TABLE memories (id TEXT PRIMARY KEY,workspace TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL,confidence REAL NOT NULL,source_run_id TEXT,source_commit TEXT,source_ref TEXT,supersedes_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,valid_until TEXT,usage_count INTEGER NOT NULL DEFAULT 0);
    `)
    const old = defaultSettings('/repo') as Partial<ReturnType<typeof defaultSettings>> & { verification?: unknown }; delete old.verification; delete old.execution
    for (const role of Object.values(old.roles!)) { delete (role as Partial<typeof role>).skillMode; delete (role as Partial<typeof role>).skills }
    legacy.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('app', JSON.stringify(old)); legacy.close()

    const migrated = new ForemanDatabase(path, '/repo')

    expect(migrated.getSettings().verification.enabled).toBe(true)
    expect(migrated.getSettings().execution?.maxParallelAgents).toBe(1)
    expect(migrated.getSettings().roles.planner).toMatchObject({ skillMode: 'auto', skills: [] })
    const memory = migrated.createMemory({ workspace: '/repo', kind: 'fact', title: '事实', content: '迁移后仍可写入', status: 'approved', confidence: .8, sourceFiles: ['src/a.ts'] })
    expect(memory.sourceFiles).toEqual(['src/a.ts'])
    expect(memory.version).toBe(1)
    const run = migrated.createRun({ title: '旧任务', objective: '保留串行', workspace: '/repo' })
    expect(migrated.getRun(run.id)?.run.agentTasks).toEqual([])
    expect(migrated.getRun(run.id)?.run.executionPolicy).toBeUndefined()
    const goal = migrated.createGoal({ title:'升级', objective:'完成升级', workspace:'/repo', successCriteria:['测试通过'], constraints:[], priority:1, maxIterations:4, maxTaskAttempts:2 }, 'fingerprint')
    expect(goal.tasks).toHaveLength(1)
    expect(goal.goal.workspaceFingerprint).toBe('fingerprint')
  })

  it('升级模型目录时补入新内置模型且保留用户自定义模型', () => {
    const directory = mkdtempSync(join(tmpdir(), 'foreman-model-migration-')); directories.push(directory)
    const path = join(directory, 'foreman.db')
    const initial = new ForemanDatabase(path, '/repo')
    const settings = initial.getSettings()
    settings.models.codex = [
      { id: 'gpt-5.6-sol', label: '用户重命名 Sol', efforts: ['high'], source: 'custom' },
      { id: 'my-codex', label: 'My Codex', efforts: ['medium'], source: 'custom' }
    ]
    settings.models.claude = [{ id: 'my-claude', label: 'My Claude', efforts: ['xhigh'], source: 'custom' }]
    initial.saveSettings(settings)

    const migrated = new ForemanDatabase(path, '/repo').getSettings()

    expect(migrated.models.codex.map((model) => model.id)).toEqual(expect.arrayContaining(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'my-codex']))
    expect(migrated.models.claude.map((model) => model.id)).toEqual(expect.arrayContaining(['sonnet', 'opus', 'glm-5.2', 'my-claude']))
    expect(migrated.models.codex.find((model) => model.id === 'gpt-5.6-sol')?.label).toBe('用户重命名 Sol')
  })
})
