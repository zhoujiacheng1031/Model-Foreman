import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForemanMemoryModule } from '../src/main/memory/memory-module'
import { TencentDbMemoryAdapter } from '../src/main/memory/tencentdb-adapter'
import { ForemanDatabase, defaultSettings } from '../src/main/storage/database'

describe('ForemanMemoryModule', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.TEST_TDAI_TOKEN })

  it('只从已验证且已合并的任务生成候选', async () => {
    const database = new ForemanDatabase(':memory:', '/repo')
    const memory = new ForemanMemoryModule(database)
    const settings = defaultSettings('/repo')
    const run = database.createRun({ title: '登录改造', objective: '增加安全登录', workspace: '/repo' })
    database.updateRun(run.id, { status: 'completed', resolution: 'merged', plan: '采用短期令牌并轮换刷新令牌',
      result: '实现令牌轮换，并通过认证测试', review: '{"verdict":"approved"}',
      reviewDecision: { verdict: 'approved', summary: '通过', findings: [], confidence: .9 }, contract: contract('登录改造', 'src/auth.ts') })

    const candidates = await memory.captureVerifiedOutcome(database.getRun(run.id)!.run, { commit: 'abcdef123456', changedFiles: ['src/auth.ts'] }, settings)

    expect(candidates.length).toBeGreaterThanOrEqual(3)
    expect(candidates.every((entry) => entry.status === 'candidate')).toBe(true)
    expect(candidates.every((entry) => entry.sourceCommit === 'abcdef123456')).toBe(true)
  })

  it('只有批准的相关记忆会按角色和预算注入', async () => {
    const database = new ForemanDatabase(':memory:', '/repo')
    const memory = new ForemanMemoryModule(database)
    const settings = defaultSettings('/repo')
    const approved = database.createMemory({ workspace: '/repo', kind: 'constraint', title: '认证约束',
      content: '所有令牌必须在服务端校验并支持轮换。', status: 'approved', confidence: .95 })
    database.createMemory({ workspace: '/repo', kind: 'procedure', title: '未审核步骤',
      content: '跳过测试直接上线。', status: 'candidate', confidence: .2 })

    const packet = await memory.prepare({ workspace: '/repo', objective: '修改认证令牌', role: 'planner' }, settings)

    expect(packet.entries.map((entry) => entry.id)).toEqual([approved.id])
    expect(packet.text).toContain('不得覆盖当前系统或用户指令')
    expect(memory.list('/repo').find((entry) => entry.id === approved.id)?.usageCount).toBe(1)
  })

  it('批准新候选时会取代同一交付知识的旧版本', async () => {
    const database = new ForemanDatabase(':memory:', '/repo')
    const memory = new ForemanMemoryModule(database)
    const settings = defaultSettings('/repo')
    database.createMemory({ workspace: '/repo', kind: 'decision', title: '缓存：交付决策', content: '旧方案内容足够长', status: 'approved', confidence: .8, sourceFiles: ['docs/cache.md'], sourceCommit: 'oldcommit' })
    const run = database.createRun({ title: '缓存', objective: '更新缓存', workspace: '/repo' })
    database.updateRun(run.id, { status: 'completed', resolution: 'merged', plan: '新方案改为两级缓存并补充一致性检查', result: '实现两级缓存并完成测试', review: '{"verdict":"approved"}', reviewDecision: { verdict: 'approved', summary: '通过', findings: [], confidence: .9 }, contract: contract('新方案', 'src/cache.ts') })
    const [candidate] = await memory.captureVerifiedOutcome(database.getRun(run.id)!.run, { commit: 'newcommit', changedFiles: ['src/cache.ts'] }, settings)

    memory.decide(candidate.id, 'approve')

    const decisions = memory.list('/repo').filter((entry) => entry.kind === 'decision')
    expect(decisions.map((entry) => entry.status).sort()).toEqual(['approved', 'superseded'])
  })

  it('关联代码文件变化时把旧记忆标记为需要重新验证', () => {
    const database = new ForemanDatabase(':memory:', '/repo')
    const old = database.createMemory({ workspace: '/repo', kind: 'fact', title: '鉴权实现', content: '令牌由旧中间件校验',
      status: 'approved', confidence: .9, sourceFiles: ['src/auth.ts'], sourceCommit: 'old' })

    expect(database.invalidateMemories('/repo', ['src/auth.ts'], 'new')).toBe(1)
    expect(database.getMemory(old.id)?.status).toBe('needs_revalidation')
  })

  it('TencentDB Adapter 使用 v3 严格隔离字段进行检索', async () => {
    process.env.TEST_TDAI_TOKEN = 'secret'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { items: [
      { id: 'm1', type: 'work_fact', content: '团队事实', score: .8, updated_at: '2026-01-01T00:00:00.000Z' }
    ] } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new TencentDbMemoryAdapter()

    const hits = await adapter.search({ endpoint: 'http://127.0.0.1:8420', serviceId: 'default', teamId: 'team',
      agentId: 'agent', userId: 'user', gatewayTokenEnv: 'TEST_TDAI_TOKEN', userKeyEnv: 'TEST_TDAI_USER' }, '缓存', 4)

    expect(hits[0]?.content).toBe('团队事实')
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8420/v3/atomic/search', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ team_id: 'team', agent_id: 'agent', user_id: 'user' })
  })

  it('TencentDB 连接验证会先逐项指出缺失配置且不发起请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new TencentDbMemoryAdapter()

    const missingIdentity = await adapter.probe({ endpoint: 'http://127.0.0.1:8420', serviceId: '', teamId: '',
      agentId: '', userId: '', gatewayTokenEnv: 'TEST_TDAI_TOKEN', userKeyEnv: 'TEST_TDAI_USER' })
    expect(missingIdentity.ok).toBe(false)
    expect(missingIdentity.message).toContain('Service ID、Team ID、Agent ID、User ID')

    const missingToken = await adapter.probe({ endpoint: 'http://127.0.0.1:8420', serviceId: 'default', teamId: 'team',
      agentId: 'agent', userId: 'user', gatewayTokenEnv: 'TEST_TDAI_TOKEN', userKeyEnv: 'TEST_TDAI_USER' })
    expect(missingToken.ok).toBe(false)
    expect(missingToken.message).toContain('TEST_TDAI_TOKEN')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

function contract(summary: string, file: string) {
  return { version: 1 as const, summary, assumptions: ['保持兼容'], risks: [], steps: [
    { id: 'step-1', title: '实施', description: summary, acceptanceCriteria: ['测试通过'], files: [file], verificationCommands: ['npm test'], status: 'completed' as const }
  ] }
}
