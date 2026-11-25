import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../src/main/storage/database'
import { WorkflowOverview, workflowOverview } from '../src/renderer/src/workflow-overview'
import type { AppSettings, ExecutorKind, RoleConfig } from '../src/shared/contracts'

function fixture() {
  const settings = defaultSettings('/repo')
  for (const role of ['planner', 'implementer', 'reviewer'] as const) settings.roles[role].executor = 'codex'
  return settings
}
function member(settings: AppSettings, executor: ExecutorKind, model = settings.roles.implementer.model): RoleConfig {
  return { ...settings.roles.implementer, executor, model }
}
const render = (settings: AppSettings) => renderToStaticMarkup(createElement(WorkflowOverview, { settings }))

describe('live role and execution overview', () => {
  it('shows the serial runtime role and excludes saved, inactive parallel overrides', () => {
    const settings = fixture()
    settings.execution = { maxParallelAgents: 1, agents: [member(settings, 'claude')] }
    const overview = workflowOverview(settings)
    expect(overview).toMatchObject({ parallel: false, concurrency: 1, inactiveMembers: 1, harnesses: ['codex'] })
    expect(overview.members).toEqual([settings.roles.implementer])
    const html = render(settings)
    expect(html).toContain('1 个执行 Agent · 串行')
    expect(html).toContain('1 套并行成员配置当前未启用')
    expect(html).not.toContain('Claude Code')
  })

  it('uses the main role for older settings without an execution policy', () => {
    const settings = fixture()
    delete settings.execution
    expect(workflowOverview(settings)).toMatchObject({ parallel: false, concurrency: 1, members: [settings.roles.implementer] })
  })

  it('distinguishes configuration reuse from the number of concurrent Agent tasks', () => {
    const settings = fixture()
    settings.execution = { maxParallelAgents: 4, agents: [] }
    expect(workflowOverview(settings)).toMatchObject({ parallel: true, concurrency: 4, members: [settings.roles.implementer], harnesses: ['codex'], reuseMain: true })
    const html = render(settings)
    expect(html).toContain('最多 4 个执行 Agent 并行')
    expect(html).toContain('1 套执行配置')
    expect(html).toContain('复用至各并行步骤')
  })

  it('updates members, harnesses and model labels when settings change, while keeping rework on the main role', () => {
    const settings = fixture()
    settings.execution = { maxParallelAgents: 3, agents: [member(settings, 'claude', 'member-a')] }
    settings.roles.implementer.model = 'main-rework-model'
    settings.models.claude.push({ id: 'member-a', label: '成员 A 模型', efforts: ['high'], source: 'custom' })
    expect(render(settings)).toContain('成员 A 模型')
    settings.execution.agents.push(member(settings, 'zcode', 'native-default'))
    const overview = workflowOverview(settings)
    expect(overview.harnesses).toEqual(['codex', 'claude', 'zcode'])
    expect(overview.members).toHaveLength(2)
    const html = render(settings)
    expect(html).toContain('2 套执行配置')
    expect(html).toContain('执行成员 2')
    expect(html).toContain('ZCode 当前模型')
    expect(html).toContain('返工使用 Codex CLI · main-rework-model')
    expect(html).toContain('实际并发受步骤依赖和文件冲突约束')
  })

  it('shows disabled verification and a zero rework limit without implying those stages run', () => {
    const settings = fixture()
    settings.verification.enabled = false
    settings.maxReviewLoops = 0
    const html = render(settings)
    expect(html).toContain('overview-verification disabled')
    expect(html).toContain('已关闭 · 跳过验证')
    expect(html).toContain('直接进入审核')
    expect(html).toContain('未启用返工循环；审核未通过时停止')
    expect(html).not.toContain('返工使用')
  })

  it('displays custom model names without exposing connector credentials', () => {
    const settings = fixture()
    settings.roles.implementer = member(settings, 'custom', 'team-api')
    settings.execution = { maxParallelAgents: 2, agents: [] }
    settings.models.custom.push({ id: 'team-api', label: '团队模型', efforts: ['medium'], source: 'custom', apiKey: 'private-api-key', baseUrl: 'https://internal.example' })
    const html = render(settings)
    expect(html).toContain('自定义 API')
    expect(html).toContain('团队模型')
    expect(html).not.toContain('private-api-key')
    expect(html).not.toContain('internal.example')
  })
})
