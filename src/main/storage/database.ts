import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { AppSettings, ExecutionContract, ExecutorKind, GoalDetail, GoalEvidence, GoalInput, GoalStatus, GoalSummary, GoalTask, GoalTaskStatus, ImplementationReport, MemoryEntry, MemoryKind, MemoryStatus, ReviewDecision, RunEvent, RunStageMetric, RunSummary, RunStatus, TaskInput, VerificationReport } from '../../shared/contracts'

export const defaultSettings = (workspace: string): AppSettings => ({
  workspace,
  maxReviewLoops: 2,
  execution: { maxParallelAgents: 1, agents: [] },
  memory: {
    enabled: true, provider: 'local', maxItems: 6, maxChars: 6000, requireApproval: true,
    tencentdb: { endpoint: 'http://127.0.0.1:8420', serviceId: 'default', teamId: '', agentId: '', userId: '', gatewayTokenEnv: 'TDAI_GATEWAY_TOKEN', userKeyEnv: 'TDAI_USER_KEY' }
  },
  verification: { enabled: true, commands: [], timeoutSeconds: 600, stopOnFailure: true },
  approvals: {
    planner: { autoApprove: false, minConfidence: 0.9 },
    reviewer: { autoApprove: true, minConfidence: 0.9 }
  },
  models: {
    codex: [
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], source: 'builtin' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], source: 'builtin' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], source: 'builtin' }
    ],
    claude: [
      { id: 'sonnet', label: 'Claude Sonnet（别名）', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], source: 'builtin' },
      { id: 'opus', label: 'Claude Opus（别名）', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], source: 'builtin' },
      { id: 'glm-5.2', label: 'GLM-5.2（Claude Code 兼容）', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], source: 'builtin' }
    ],
    custom: []
  },
  roles: {
    planner: {
      executor: 'codex', model: 'gpt-5.6-sol', effort: 'high',
      skillMode: 'auto', skills: [],
      prompt: '你是技术负责人。分析目标与仓库，只输出清晰、可验证、按顺序执行的实施计划。不要修改文件。'
    },
    implementer: {
      executor: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh',
      skillMode: 'auto', skills: [],
      prompt: '你是实现工程师。严格按计划修改代码，运行相关验证，保留用户已有改动，并在结束时总结文件与测试。'
    },
    reviewer: {
      executor: 'codex', model: 'gpt-5.6-sol', effort: 'high',
      skillMode: 'auto', skills: [],
      prompt: '你是独立审核者。检查当前 git diff、需求符合度、正确性和测试。若可以交付，第一行写 APPROVED；否则第一行写 CHANGES_REQUESTED 并给出具体修改清单。不要修改文件。'
    }
  }
})

export class ForemanDatabase {
  private readonly db: DatabaseSync

  constructor(path: string, workspace: string) {
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, objective TEXT NOT NULL, workspace TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        plan TEXT, result TEXT, review TEXT, error TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, at TEXT NOT NULL,
        phase TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, workspace TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
        content TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL,
        source_run_id TEXT, source_commit TEXT, source_ref TEXT, supersedes_id TEXT,
        source_files TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, valid_until TEXT, usage_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, objective TEXT NOT NULL, workspace TEXT NOT NULL,
        success_criteria TEXT NOT NULL, constraints_json TEXT NOT NULL, status TEXT NOT NULL, priority INTEGER NOT NULL,
        time_budget_seconds INTEGER, token_budget INTEGER, cost_budget_usd REAL, max_iterations INTEGER NOT NULL, iteration INTEGER NOT NULL DEFAULT 0,
        current_task_id TEXT, workspace_fingerprint TEXT, terminal_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS goal_tasks (
        id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, title TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL,
        dependencies TEXT NOT NULL, order_index INTEGER NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL,
        run_id TEXT, run_history TEXT NOT NULL DEFAULT '[]', evidence TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, title, content, tokenize='unicode61');
      CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memory_fts(id,title,content) VALUES (new.id,new.title,new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE OF title,content ON memories BEGIN
        DELETE FROM memory_fts WHERE id=old.id;
        INSERT INTO memory_fts(id,title,content) VALUES (new.id,new.title,new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memories BEGIN
        DELETE FROM memory_fts WHERE id=old.id;
      END;
    `)
    this.ensureColumn('execution_workspace', 'TEXT')
    this.ensureColumn('branch', 'TEXT')
    this.ensureColumn('base_commit', 'TEXT')
    this.ensureColumn('isolated', 'INTEGER')
    this.ensureColumn('resolution', 'TEXT')
    this.ensureColumn('contract', 'TEXT')
    this.ensureColumn('implementation_report', 'TEXT')
    this.ensureColumn('review_decision', 'TEXT')
    this.ensureColumn('verification', 'TEXT')
    this.ensureColumn('checkpoint_phase', 'TEXT')
    this.ensureColumn('additional_instructions', 'TEXT')
    this.ensureColumn('review_attempt', 'INTEGER')
    this.ensureColumn('usage_tokens', 'INTEGER')
    this.ensureColumn('cost_usd', 'REAL')
    this.ensureColumn('stage_metrics', "TEXT NOT NULL DEFAULT '[]'")
    this.ensureColumn('pause_reason', 'TEXT')
    this.ensureColumn('agent_tasks', "TEXT NOT NULL DEFAULT '[]'")
    this.ensureColumn('execution_policy', 'TEXT')
    this.ensureGoalColumn('token_budget', 'INTEGER')
    this.ensureGoalColumn('cost_budget_usd', 'REAL')
    this.ensureGoalTaskColumn('run_history', "TEXT NOT NULL DEFAULT '[]'")
    this.ensureMemoryColumn('source_files', "TEXT NOT NULL DEFAULT '[]'")
    this.ensureMemoryColumn('version', 'INTEGER NOT NULL DEFAULT 1')
    this.db.exec('CREATE TABLE IF NOT EXISTS memory_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL, version INTEGER NOT NULL, at TEXT NOT NULL)')
    this.db.exec(`UPDATE runs SET resolution = 'open' WHERE resolution IS NULL`)
    if (!this.db.prepare('SELECT 1 FROM settings WHERE key = ?').get('app')) {
      this.saveSettings(defaultSettings(workspace))
    }
  }

  getSettings(): AppSettings {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('app') as { value: string }
    const saved = JSON.parse(row.value) as Partial<AppSettings>
    const defaults = defaultSettings(saved.workspace ?? process.cwd())
    return { ...defaults, ...saved, roles: {
      planner: { ...defaults.roles.planner, ...saved.roles?.planner },
      implementer: { ...defaults.roles.implementer, ...saved.roles?.implementer },
      reviewer: { ...defaults.roles.reviewer, ...saved.roles?.reviewer }
    }, memory: { ...defaults.memory, ...saved.memory, tencentdb: { ...defaults.memory.tencentdb, ...saved.memory?.tencentdb } },
      verification: { ...defaults.verification, ...saved.verification },
      approvals: {
        planner: { ...defaults.approvals.planner, ...saved.approvals?.planner },
        reviewer: { ...defaults.approvals.reviewer, ...saved.approvals?.reviewer }
      },
      models: {
        codex: mergeModelCatalog(defaults.models.codex, saved.models?.codex),
        claude: mergeModelCatalog(defaults.models.claude, saved.models?.claude),
        custom: mergeModelCatalog(defaults.models.custom, saved.models?.custom)
      } } as AppSettings
  }

  saveSettings(settings: AppSettings): AppSettings {
    this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('app', JSON.stringify(settings))
    return settings
  }

  createRun(input: TaskInput): RunSummary {
    const now = new Date().toISOString()
    const run: RunSummary = { id: randomUUID(), ...input, status: 'queued', createdAt: now, updatedAt: now }
    this.db.prepare(`INSERT INTO runs(id,title,objective,workspace,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run(run.id, run.title, run.objective, run.workspace, run.status, now, now)
    return run
  }

  updateRun(id: string, fields: Partial<Pick<RunSummary, 'status' | 'plan' | 'result' | 'review' | 'error' | 'executionWorkspace' | 'branch' | 'baseCommit' | 'isolated' | 'resolution' | 'contract' | 'implementationReport' | 'reviewDecision' | 'verification' | 'checkpointPhase' | 'pauseReason' | 'additionalInstructions' | 'reviewAttempt' | 'usageTokens' | 'costUsd' | 'stageMetrics' | 'agentTasks' | 'executionPolicy'>>): void {
    const entries = Object.entries(fields).filter(([, value]) => value !== undefined)
    if (!entries.length) return
    const columns: Record<string, string> = {
      agentTasks: 'agent_tasks', executionPolicy: 'execution_policy', status: 'status', plan: 'plan', result: 'result', review: 'review', error: 'error',
      executionWorkspace: 'execution_workspace', branch: 'branch', baseCommit: 'base_commit',
      isolated: 'isolated', resolution: 'resolution', contract: 'contract', implementationReport: 'implementation_report',
      reviewDecision: 'review_decision', verification: 'verification', checkpointPhase: 'checkpoint_phase', pauseReason: 'pause_reason', additionalInstructions: 'additional_instructions', reviewAttempt: 'review_attempt', usageTokens:'usage_tokens',costUsd:'cost_usd',stageMetrics:'stage_metrics'
    }
    const set = entries.map(([key]) => `${columns[key]} = ?`).join(', ')
    this.db.prepare(`UPDATE runs SET ${set}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([, value]) => typeof value === 'boolean' ? Number(value) : typeof value === 'object' ? JSON.stringify(value) : value), new Date().toISOString(), id)
  }

  addStageMetric(runId: string, metric: RunStageMetric): void {
    const current = this.getRun(runId)?.run.stageMetrics ?? []
    this.updateRun(runId, { stageMetrics: [...current, metric] })
  }

  addEvent(event: RunEvent): RunEvent {
    const result = this.db.prepare('INSERT INTO events(run_id,at,phase,kind,message) VALUES (?,?,?,?,?)')
      .run(event.runId, event.at, event.phase, event.kind, event.message)
    return { ...event, id: Number(result.lastInsertRowid) }
  }

  listRuns(): RunSummary[] {
    const rows = this.db.prepare('SELECT * FROM runs ORDER BY created_at DESC').all() as unknown as RunRow[]
    return rows.map(mapRun)
  }

  getRun(id: string): { run: RunSummary; events: RunEvent[] } | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined
    if (!row) return null
    const events = this.db.prepare('SELECT id, run_id, at, phase, kind, message FROM events WHERE run_id = ? ORDER BY id')
      .all(id) as unknown as EventRow[]
    return { run: mapRun(row), events: events.map((event) => ({
      id: event.id, runId: event.run_id, at: event.at, phase: event.phase,
      kind: event.kind, message: event.message
    })) }
  }

  isRunReferencedByGoal(id: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM goal_tasks
      WHERE run_id = ? OR EXISTS (SELECT 1 FROM json_each(goal_tasks.run_history) WHERE value = ?)
      LIMIT 1`).get(id, id))
  }

  deleteRun(id: string): boolean {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM events WHERE run_id = ?').run(id)
      const result = this.db.prepare('DELETE FROM runs WHERE id = ?').run(id)
      this.db.exec('COMMIT')
      return Number(result.changes) > 0
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  recoverInterruptedRuns(): number {
    const result = this.db.prepare(`
      UPDATE runs SET checkpoint_phase = status, status = 'paused', pause_reason = 'interrupted', error = ?, updated_at = ?
      WHERE status IN ('queued', 'planning', 'implementing', 'verifying', 'reviewing')
    `).run('应用在任务运行期间退出。worktree 与检查点已保留，可恢复任务。', new Date().toISOString())
    return Number(result.changes)
  }

  createGoal(input: GoalInput, workspaceFingerprint: string): GoalDetail {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO goals(id,title,objective,workspace,success_criteria,constraints_json,status,priority,time_budget_seconds,token_budget,cost_budget_usd,max_iterations,workspace_fingerprint,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.title, input.objective, input.workspace, JSON.stringify(input.successCriteria), JSON.stringify(input.constraints), 'active', input.priority, input.timeBudgetSeconds ?? null, input.tokenBudget ?? null, input.costBudgetUsd ?? null, input.maxIterations, workspaceFingerprint, now, now)
    let previous: string | undefined
    input.successCriteria.forEach((criterion, index) => {
      const taskId = randomUUID(); const dependencies = previous ? [previous] : []
      this.db.prepare(`INSERT INTO goal_tasks(id,goal_id,title,objective,status,dependencies,order_index,max_attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(taskId, id, `验收 ${index + 1}`, `${input.objective}\n\n本任务成功标准：${criterion}\n约束：${input.constraints.join('；') || '无'}`, index === 0 ? 'ready' : 'pending', JSON.stringify(dependencies), index, input.maxTaskAttempts, now, now)
      previous = taskId
    })
    return this.getGoal(id)!
  }

  listGoals(): GoalSummary[] { return (this.db.prepare('SELECT id FROM goals ORDER BY priority DESC, created_at ASC').all() as unknown as Array<{id:string}>).map((row)=>this.getGoal(row.id)!.goal) }
  getGoal(id: string): GoalDetail | null {
    const row = this.db.prepare('SELECT * FROM goals WHERE id=?').get(id) as GoalRow | undefined
    if (!row) return null
    const tasks = this.db.prepare('SELECT * FROM goal_tasks WHERE goal_id=? ORDER BY order_index').all(id) as unknown as GoalTaskRow[]
    const mappedTasks=tasks.map(mapGoalTask); const runIds=[...new Set(mappedTasks.flatMap((task)=>[...task.runHistoryIds,...(task.runId?[task.runId]:[])]))]; const runs=runIds.map((runId)=>this.getRun(runId)?.run)
    return { goal: { ...mapGoal(row), tokensUsed:runs.reduce((sum,run)=>sum+(run?.usageTokens??0),0), costUsedUsd:runs.reduce((sum,run)=>sum+(run?.costUsd??0),0) }, tasks: mappedTasks }
  }
  updateGoal(id: string, fields: Partial<Pick<GoalSummary, 'status' | 'iteration' | 'currentTaskId' | 'workspaceFingerprint' | 'terminalReason'>>): void {
    const columns: Record<string, string> = { status: 'status', iteration: 'iteration', currentTaskId: 'current_task_id', workspaceFingerprint: 'workspace_fingerprint', terminalReason: 'terminal_reason' }
    const entries = Object.entries(fields); if (!entries.length) return
    this.db.prepare(`UPDATE goals SET ${entries.map(([key]) => `${columns[key]}=?`).join(',')}, updated_at=? WHERE id=?`)
      .run(...entries.map(([, value]) => value ?? null), new Date().toISOString(), id)
  }
  updateGoalTask(id: string, fields: Partial<Pick<GoalTask, 'status' | 'attempt' | 'runId' | 'runHistoryIds' | 'evidence'>>): void {
    const columns: Record<string, string> = { status: 'status', attempt: 'attempt', runId: 'run_id', runHistoryIds:'run_history', evidence: 'evidence' }
    const entries = Object.entries(fields); if (!entries.length) return
    this.db.prepare(`UPDATE goal_tasks SET ${entries.map(([key]) => `${columns[key]}=?`).join(',')}, updated_at=? WHERE id=?`)
      .run(...entries.map(([, value]) => typeof value === 'object' ? JSON.stringify(value) : value ?? null), new Date().toISOString(), id)
  }

  createMemory(input: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'sourceFiles'> & { sourceFiles?: string[] }): MemoryEntry {
    const id = randomUUID(); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO memories(id,workspace,kind,title,content,status,confidence,source_run_id,source_commit,source_ref,supersedes_id,source_files,created_at,updated_at,valid_until)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.workspace, input.kind, input.title, input.content, input.status, input.confidence,
        input.sourceRunId ?? null, input.sourceCommit ?? null, input.sourceRef ?? null, input.supersedesId ?? null, JSON.stringify(input.sourceFiles ?? []), now, now, input.validUntil ?? null)
    return this.getMemory(id)!
  }

  getMemory(id: string): MemoryEntry | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined
    return row ? mapMemory(row) : null
  }

  listMemories(workspace?: string): MemoryEntry[] {
    const rows = (workspace
      ? this.db.prepare('SELECT * FROM memories WHERE workspace = ? ORDER BY updated_at DESC').all(workspace)
      : this.db.prepare('SELECT * FROM memories ORDER BY updated_at DESC').all()) as unknown as MemoryRow[]
    return rows.map(mapMemory)
  }

  searchMemories(workspace: string, kinds: MemoryKind[], query: string, limit: number): MemoryEntry[] {
    const expired = this.db.prepare("SELECT id FROM memories WHERE status='approved' AND valid_until IS NOT NULL AND valid_until <= ?").all(new Date().toISOString()) as Array<{ id: string }>
    for (const row of expired) this.updateMemoryStatus(row.id, 'expired')
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])].slice(0, 12)
    let rows: MemoryRow[]
    if (terms.length) {
      const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ')
      rows = this.db.prepare(`SELECT m.* FROM memory_fts f JOIN memories m ON m.id=f.id
        WHERE memory_fts MATCH ? AND m.workspace=? AND m.status='approved'
        ORDER BY bm25(memory_fts), m.updated_at DESC LIMIT ?`).all(match, workspace, limit * 3) as unknown as MemoryRow[]
    } else {
      rows = this.db.prepare(`SELECT * FROM memories WHERE workspace=? AND status='approved' ORDER BY updated_at DESC LIMIT ?`)
        .all(workspace, limit * 3) as unknown as MemoryRow[]
    }
    let matching = rows.filter((row) => kinds.includes(row.kind))
    if (!matching.length) matching = (this.db.prepare(`SELECT * FROM memories WHERE workspace=? AND status='approved' ORDER BY updated_at DESC LIMIT ?`)
      .all(workspace, limit * 3) as unknown as MemoryRow[]).filter((row) => kinds.includes(row.kind))
    return matching.slice(0, limit).map(mapMemory)
  }

  latestApprovedMemory(workspace: string, kind: MemoryKind, title: string): MemoryEntry | null {
    const row = this.db.prepare(`SELECT * FROM memories WHERE workspace=? AND kind=? AND title=? AND status IN ('approved','needs_revalidation') ORDER BY updated_at DESC LIMIT 1`)
      .get(workspace, kind, title) as MemoryRow | undefined
    return row ? mapMemory(row) : null
  }

  updateMemoryStatus(id: string, status: MemoryStatus, expectedVersion?: number): MemoryEntry {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const memory = this.getMemory(id)
      if (!memory) throw new Error('记忆不存在')
      if (expectedVersion !== undefined && memory.version !== expectedVersion) throw new Error('记忆已被更新，请刷新后再决定')
      if (status === 'approved' && !['candidate', 'needs_revalidation', 'approved'].includes(memory.status)) throw new Error('当前记忆状态不能直接批准')
      if (memory.status !== status) {
        const change = (entry: MemoryEntry, next: MemoryStatus) => {
          const now = new Date().toISOString()
          this.db.prepare('UPDATE memories SET status=?, version=version+1, updated_at=? WHERE id=?').run(next, now, entry.id)
          this.db.prepare('INSERT INTO memory_audit(memory_id,from_status,to_status,version,at) VALUES (?,?,?,?,?)').run(entry.id, entry.status, next, (entry.version ?? 1) + 1, now)
        }
        if (status === 'approved' && memory.supersedesId) {
          const previous = this.getMemory(memory.supersedesId)
          if (!previous || previous.workspace !== memory.workspace || previous.id === id || !['approved', 'needs_revalidation'].includes(previous.status)) throw new Error('被替代的记忆已变更，请重新评估候选')
          change(previous, 'superseded')
        }
        change(memory, status)
      }
      const updated = this.getMemory(id)!
      this.db.exec('COMMIT')
      return updated
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  incrementMemoryUsage(ids: string[]): void {
    const statement = this.db.prepare('UPDATE memories SET usage_count=usage_count+1 WHERE id=?')
    for (const id of ids) statement.run(id)
  }

  invalidateMemories(workspace: string, changedFiles: string[], newCommit: string): number {
    if (!changedFiles.length) return 0
    const rows = this.listMemories(workspace).filter((entry) => entry.status === 'approved' && entry.sourceCommit !== newCommit && entry.sourceFiles.some((file) => changedFiles.some((changed) => file === changed || changed.startsWith(`${file.replace(/\/$/, '')}/`) || file.startsWith(`${changed}/`))))
    for (const row of rows) this.updateMemoryStatus(row.id, 'needs_revalidation')
    return rows.length
  }

  deleteMemory(id: string): void { this.db.prepare('DELETE FROM memories WHERE id=?').run(id) }

  private ensureColumn(name: string, type: string): void {
    const columns = this.db.prepare('PRAGMA table_info(runs)').all() as Array<Record<string, unknown>>
    if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE runs ADD COLUMN ${name} ${type}`)
  }

  private ensureMemoryColumn(name: string, type: string): void {
    const columns = this.db.prepare('PRAGMA table_info(memories)').all() as Array<Record<string, unknown>>
    if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${type}`)
  }
  private ensureGoalColumn(name: string, type: string): void {
    const columns = this.db.prepare('PRAGMA table_info(goals)').all() as Array<Record<string, unknown>>
    if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE goals ADD COLUMN ${name} ${type}`)
  }
  private ensureGoalTaskColumn(name: string, type: string): void {
    const columns = this.db.prepare('PRAGMA table_info(goal_tasks)').all() as Array<Record<string, unknown>>
    if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE goal_tasks ADD COLUMN ${name} ${type}`)
  }
}

function mergeModelCatalog(defaults: AppSettings['models'][ExecutorKind], saved?: AppSettings['models'][ExecutorKind]): AppSettings['models'][ExecutorKind] {
  if (!saved) return defaults
  const savedById = new Map(saved.map((model) => [model.id, model]))
  return [
    ...defaults.map((model) => savedById.get(model.id) ?? model),
    ...saved.filter((model) => !defaults.some((candidate) => candidate.id === model.id))
  ]
}

interface RunRow {
  id: string; title: string; objective: string; workspace: string; status: RunStatus
  created_at: string; updated_at: string; plan?: string; result?: string; review?: string; error?: string
  agent_tasks?: string; execution_policy?: string
  execution_workspace?: string; branch?: string; isolated?: number
  base_commit?: string; resolution?: RunSummary['resolution']
  contract?: string; implementation_report?: string; review_decision?: string; verification?: string
  checkpoint_phase?: RunStatus; pause_reason?: RunSummary['pauseReason']; additional_instructions?: string; review_attempt?: number; usage_tokens?:number; cost_usd?:number; stage_metrics?:string
}
interface GoalRow { id:string; title:string; objective:string; workspace:string; success_criteria:string; constraints_json:string; status:GoalStatus; priority:number; time_budget_seconds?:number; token_budget?:number; cost_budget_usd?:number; max_iterations:number; iteration:number; current_task_id?:string; workspace_fingerprint?:string; terminal_reason?:string; created_at:string; updated_at:string }
interface GoalTaskRow { id:string; goal_id:string; title:string; objective:string; status:GoalTaskStatus; dependencies:string; order_index:number; attempt:number; max_attempts:number; run_id?:string; run_history:string; evidence?:string; created_at:string; updated_at:string }
interface EventRow { id: number; run_id: string; at: string; phase: RunStatus; kind: RunEvent['kind']; message: string }
interface MemoryRow {
  version?: number
  id: string; workspace: string; kind: MemoryKind; title: string; content: string; status: MemoryStatus; confidence: number
  source_run_id?: string; source_commit?: string; source_ref?: string; supersedes_id?: string
  created_at: string; updated_at: string; valid_until?: string; usage_count: number
  source_files: string
}

function mapRun(row: RunRow): RunSummary {
  return {
    agentTasks: parseJson<RunSummary['agentTasks']>(row.agent_tasks) ?? [], executionPolicy: parseJson<RunSummary['executionPolicy']>(row.execution_policy),
    id: row.id, title: row.title, objective: row.objective, workspace: row.workspace,
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
    executionWorkspace: row.execution_workspace ?? undefined,
    branch: row.branch ?? undefined, baseCommit: row.base_commit ?? undefined,
    isolated: Boolean(row.isolated), resolution: row.resolution ?? 'open',
    plan: row.plan ?? undefined, result: row.result ?? undefined,
    review: row.review ?? undefined, error: row.error ?? undefined
    , contract: parseJson<ExecutionContract>(row.contract), implementationReport: parseJson<ImplementationReport>(row.implementation_report),
    reviewDecision: parseJson<ReviewDecision>(row.review_decision), verification: parseJson<VerificationReport>(row.verification),
    checkpointPhase: row.checkpoint_phase ?? undefined, pauseReason: row.pause_reason ?? undefined, additionalInstructions: row.additional_instructions ?? undefined, reviewAttempt: row.review_attempt ?? 0, usageTokens:row.usage_tokens??0,costUsd:row.cost_usd??0,stageMetrics:parseJson<RunStageMetric[]>(row.stage_metrics) ?? []
  }
}

function mapGoal(row: GoalRow): GoalSummary { return { id:row.id,title:row.title,objective:row.objective,workspace:row.workspace,successCriteria:parseJson<string[]>(row.success_criteria) ?? [],constraints:parseJson<string[]>(row.constraints_json) ?? [],status:row.status,priority:row.priority,timeBudgetSeconds:row.time_budget_seconds ?? undefined,tokenBudget:row.token_budget??undefined,costBudgetUsd:row.cost_budget_usd??undefined,tokensUsed:0,costUsedUsd:0,maxIterations:row.max_iterations,iteration:row.iteration,currentTaskId:row.current_task_id ?? undefined,workspaceFingerprint:row.workspace_fingerprint ?? undefined,terminalReason:row.terminal_reason ?? undefined,createdAt:row.created_at,updatedAt:row.updated_at } }
function mapGoalTask(row: GoalTaskRow): GoalTask { return { id:row.id,goalId:row.goal_id,title:row.title,objective:row.objective,status:row.status,dependencies:parseJson<string[]>(row.dependencies) ?? [],order:row.order_index,attempt:row.attempt,maxAttempts:row.max_attempts,runId:row.run_id ?? undefined,runHistoryIds:parseJson<string[]>(row.run_history)??[],evidence:parseJson<GoalEvidence>(row.evidence),createdAt:row.created_at,updatedAt:row.updated_at } }

function parseJson<T>(value?: string): T | undefined { if (!value) return undefined; try { return JSON.parse(value) as T } catch { return undefined } }

function mapMemory(row: MemoryRow): MemoryEntry {
  return { version: row.version ?? 1, id: row.id, workspace: row.workspace, kind: row.kind, title: row.title, content: row.content,
    status: row.status, confidence: row.confidence, sourceRunId: row.source_run_id ?? undefined,
    sourceCommit: row.source_commit ?? undefined, sourceRef: row.source_ref ?? undefined,
    supersedesId: row.supersedes_id ?? undefined, sourceFiles: parseJson<string[]>(row.source_files) ?? [], createdAt: row.created_at, updatedAt: row.updated_at,
    validUntil: row.valid_until ?? undefined, usageCount: row.usage_count }
}
