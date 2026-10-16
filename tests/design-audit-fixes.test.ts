import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultSettings, ForemanDatabase } from '../src/main/storage/database'
import { defaultGoalBudget, goalBudgetError, goalBudgetInput, GoalBudgetFields } from '../src/renderer/src/goal-budget'
import { executorReadiness, modelReadiness } from '../src/renderer/src/runtime-readiness'
import { RunOverview, ContractSummary } from '../src/renderer/src/run-artifacts'
import { memoryCurationSchema } from '../src/main/validation'
import type { ModelCapabilityScan } from '../src/shared/contracts'

describe('audited user decisions', () => {
  it('sends a finite default budget and requires an explicit choice to omit the cost cap', () => {
    expect(goalBudgetInput(defaultGoalBudget)).toMatchObject({ costBudgetUsd: 5, timeBudgetSeconds: 86400, maxIterations: 24 })
    expect(() => goalBudgetInput({ ...defaultGoalBudget, cost: 0 })).toThrow('费用上限')
    expect(goalBudgetInput({ ...defaultGoalBudget, unlimitedCost: true }).costBudgetUsd).toBeUndefined()
    for (const budget of [{ ...defaultGoalBudget, hours: NaN }, { ...defaultGoalBudget, tokens: -1 }, { ...defaultGoalBudget, attempts: 1.5 }]) expect(goalBudgetError(budget)).not.toBe('')
    const html = renderToStaticMarkup(createElement(GoalBudgetFields, { value: defaultGoalBudget, onChange: () => {} }))
    expect(html.indexOf('费用上限（USD）')).toBeLessThan(html.indexOf('<details'))
    expect(html).toContain('费用上限 $5.00')
    expect(html).not.toContain('checked=""')
  })

  it('gives current authentication precedence over successful cached model scans', () => {
    const settings = defaultSettings('/repo')
    const scan: ModelCapabilityScan = { checkedAt: '2026-09-01T00:00:00Z', models: [{ kind: 'claude', model: 'sonnet', roles: ['implementer'], availability: 'available', supportedEfforts: ['low'], checks: [], message: '远程 API 可用' }] }
    const capability = { kind: 'claude' as const, installed: true, authenticated: false, version: '1', executable: 'claude', authenticationMessage: '{"loggedIn":false}' }
    expect(modelReadiness(settings, [capability], scan, 'claude', 'sonnet').label).toBe('未登录')
    expect(modelReadiness(settings, [{ ...capability, authenticated: true }], scan, 'claude', 'sonnet')).toMatchObject({ state: 'pending', label: '上次检测通过' })
    expect(executorReadiness('claude', [{ ...capability, installed: false }]).label).toBe('未安装')
    expect(executorReadiness('claude', []).label).toBe('状态待检查')
  })

  it('renders results and skipped verification before the expandable raw protocols', () => {
    const db = new ForemanDatabase(':memory:', '/repo')
    const run = db.createRun({ title: '文档', objective: '写介绍', workspace: '/repo' })
    run.status = 'completed'; run.resolution = 'merged'
    run.result = '{"summary":"介绍已写入 README","filesChanged":["README.md"]}'
    run.reviewDecision = { verdict: 'approved', summary: '内容符合目标', findings: [], confidence: .9 }
    run.verification = { origin: 'foreman-local-verifier', status: 'skipped', passed: true, checks: [], commit: 'abc', workspaceFingerprint: 'hash', startedAt: '', completedAt: '' }
    const html = renderToStaticMarkup(createElement(RunOverview, { run, onOpenProject: () => {}, onEvidence: () => {} }))
    expect(html).toContain('介绍已写入 README')
    expect(html).toContain('独立验证已跳过')
    expect(html).not.toContain('独立验证通过')
    expect(html).toContain('打开成果目录')
    expect(html.indexOf('介绍已写入 README')).toBeLessThan(html.indexOf('执行报告（原始数据）'))
    const contract = { version: 1 as const, summary: '增加登录', assumptions: [], risks: [], steps: [{ id: '1', title: '补充校验', description: '检查邮箱格式', acceptanceCriteria: ['无效邮箱被拒绝'], files: ['auth.ts'], verificationCommands: [], status: 'pending' as const }] }
    const plan = renderToStaticMarkup(createElement(ContractSummary, { contract, raw: JSON.stringify(contract) }))
    expect(plan.indexOf('无效邮箱被拒绝')).toBeLessThan(plan.indexOf('执行合同（原始数据）'))
  })

  it('rejects incomplete memory curation and persists delivery evidence independently of a worktree', () => {
    expect(memoryCurationSchema.safeParse({ sources: [{ id: 'x', version: 1 }], title: 't', content: 'c', applicability: ' ' }).success).toBe(false)
    const db = new ForemanDatabase(':memory:', '/repo')
    const run = db.createRun({ title: '成果', objective: '交付成果', workspace: '/repo' })
    const deliveryEvidence = { commit: 'abc123', changedFiles: ['README.md'], stat: '1 file changed' }
    db.updateRun(run.id, { resolution: 'merged', deliveryEvidence })
    expect(db.getRun(run.id)?.run.deliveryEvidence).toEqual(deliveryEvidence)
  })
})
