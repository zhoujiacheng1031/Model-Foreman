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
  it('合并同模型的并发预检，避免多个 Agent 同时消耗相同 API 探测额度', async () => {
    let release: () => void = () => {}
    const barrier = new Promise<void>((resolve) => { release = resolve })
    class ConcurrentExecutor extends PreflightExecutor {
      override async preflight(_request: ModelPreflightRequest) { this.calls++; await barrier }
    }
    const executor = new ConcurrentExecutor(); const gate = new ModelRuntimeGate(new ExecutorRegistry([executor]))
    const config = { executor: 'codex' as const, model: 'gpt-test', effort: 'low' as const }
    const checks = [gate.check(config, '/tmp/agent-a'), gate.check(config, '/tmp/agent-b')]
    await Promise.resolve(); await Promise.resolve()
    expect(executor.calls).toBe(1)
    release(); expect((await Promise.all(checks)).every((status) => status.available)).toBe(true)
    expect((await gate.check(config, '/tmp/agent-c')).cached).toBe(true)
  })

  it('失效操作后的旧预检完成不能重新写入可用缓存', async () => {
    let release: () => void = () => {}
    const barrier = new Promise<void>((resolve) => { release = resolve })
    class DelayedExecutor extends PreflightExecutor {
      override async preflight(_request: ModelPreflightRequest) { this.calls++; if (this.calls === 1) await barrier }
    }
    const executor = new DelayedExecutor(); const gate = new ModelRuntimeGate(new ExecutorRegistry([executor]))
    const config = { executor: 'codex' as const, model: 'gpt-test', effort: 'low' as const }
    const first = gate.check(config, '/tmp')
    await Promise.resolve(); await Promise.resolve(); gate.invalidate('codex'); release(); await first
    expect((await gate.check(config, '/tmp')).cached).toBe(false); expect(executor.calls).toBe(2)
  })

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

  it.each(['429 Too Many Requests', '远端返回 HTTP 429（请求限流）；预检在 45 秒后结束', 'Too many requests'])('将 %s 保留为限流分类而非普通网络错误', async (reason) => {
    const gate = new ModelRuntimeGate(new ExecutorRegistry([new PreflightExecutor(reason)]))
    await expect(gate.ensure({ executor: 'codex', model: 'gpt-test', effort: 'low' }, '/tmp')).rejects.toMatchObject({ category: 'quota' } satisfies Partial<ModelPreflightError>)
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
