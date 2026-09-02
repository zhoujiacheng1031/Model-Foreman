import { describe, expect, it } from 'vitest'
import type { AgentExecutor, ExecuteRequest, ExecuteResult, ModelPreflightRequest } from '../src/main/executors/types'
import { ExecutorRegistry } from '../src/main/executors/registry'
import { ModelRuntimeGate, ModelPreflightError } from '../src/main/model-runtime'

class PreflightExecutor implements AgentExecutor {
  readonly kind = 'codex' as const
  calls = 0
  constructor(private readonly failure = '') {}
  async probe() { return { installed: true, executable: '/bin/codex', version: 'test', authenticated: true, authenticationMessage: '已登录' } }
  async preflight(_request: ModelPreflightRequest) { this.calls += 1; if (this.failure) throw new Error(this.failure) }
  async execute(_request: ExecuteRequest): Promise<ExecuteResult> { return { output: '', exitCode: 0 } }
  cancel() {}
}

class EffortAwareExecutor extends PreflightExecutor {
  override async preflight(request: ModelPreflightRequest) {
    this.calls += 1
    if (request.effort === 'xhigh' || request.effort === 'max') throw new Error(`reasoning effort ${request.effort} is not supported`)
  }
}

describe('ModelRuntimeGate', () => {
  it('在正式执行前验证并缓存同一模型与推理强度', async () => {
    const executor = new PreflightExecutor(); const gate = new ModelRuntimeGate(new ExecutorRegistry([executor]), 60_000)
    const first = await gate.check({ executor: 'codex', model: 'gpt-test', effort: 'high' }, '/tmp')
    const second = await gate.check({ executor: 'codex', model: 'gpt-test', effort: 'high' }, '/tmp')
    expect(first.available).toBe(true); expect(second.cached).toBe(true); expect(executor.calls).toBe(1)
  })

  it('把模型不存在与 API 网络错误分类成具体原因', async () => {
    const modelGate = new ModelRuntimeGate(new ExecutorRegistry([new PreflightExecutor('model gpt-missing not found')]))
    await expect(modelGate.ensure({ executor: 'codex', model: 'gpt-missing', effort: 'high' }, '/tmp')).rejects.toMatchObject({ category: 'model' } satisfies Partial<ModelPreflightError>)
    const apiGate = new ModelRuntimeGate(new ExecutorRegistry([new PreflightExecutor('connect ETIMEDOUT api.openai.com')]))
    await expect(apiGate.ensure({ executor: 'codex', model: 'gpt-test', effort: 'high' }, '/tmp')).rejects.toMatchObject({ category: 'api' } satisfies Partial<ModelPreflightError>)
  })

  it('一次扫描三个角色并去重验证模型支持的全部推理强度', async () => {
    const executor = new EffortAwareExecutor()
    const gate = new ModelRuntimeGate(new ExecutorRegistry([executor]), 60_000)
    const scan = await gate.scan([
      { role: 'planner', executor: 'codex', model: 'gpt-test' },
      { role: 'implementer', executor: 'codex', model: 'gpt-test' },
      { role: 'reviewer', executor: 'codex', model: 'gpt-review' }
    ], '/tmp')
    expect(scan.models).toHaveLength(2)
    expect(scan.models[0]).toMatchObject({ roles: ['planner', 'implementer'], availability: 'partial', supportedEfforts: ['low', 'medium', 'high'] })
    expect(scan.models[1]).toMatchObject({ roles: ['reviewer'], availability: 'partial', supportedEfforts: ['low', 'medium', 'high'] })
    expect(executor.calls).toBe(10)
  })
})
