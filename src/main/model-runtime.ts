import type { Effort, ExecutorKind, ModelCapabilityResult, ModelCapabilityScan, ModelCapabilityTarget, ModelRuntimeStatus, RoleConfig } from '../shared/contracts'
import type { ExecutorRegistry } from './executors/registry'

type ModelConfig = Pick<RoleConfig, 'executor' | 'model' | 'effort'>
type FailureCategory = Exclude<ModelRuntimeStatus['category'], 'ready'>
const allEfforts: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export class ModelPreflightError extends Error {
  constructor(readonly category: FailureCategory, message: string) { super(message); this.name = 'ModelPreflightError' }
}

export class ModelRuntimeGate {
  private readonly cache = new Map<string, { expires: number; status: ModelRuntimeStatus }>()
  constructor(private readonly registry: ExecutorRegistry, private readonly cacheMs = 10 * 60_000) {}

  async ensure(config: ModelConfig, workspace: string): Promise<ModelRuntimeStatus> {
    const status = await this.check(config, workspace)
    if (!status.available) throw new ModelPreflightError(status.category as FailureCategory, status.message)
    return status
  }

  async check(config: ModelConfig, workspace: string): Promise<ModelRuntimeStatus> {
    const key = `${config.executor}\0${config.model}\0${config.effort}`
    const cached = this.cache.get(key)
    if (cached && cached.expires > Date.now()) return { ...cached.status, cached: true }
    const executor = this.registry.get(config.executor)
    const capability = await executor.probe()
    if (!capability.installed) return failure(config, 'cli', `${providerName(config.executor)} CLI 未安装或不可执行。请安装 CLI 后重新检测。`)
    if (capability.authenticated === false) return failure(config, 'authentication', `${providerName(config.executor)} CLI 尚未授权：${capability.authenticationMessage || '请先登录'}`)
    try {
      await executor.preflight?.({ model: config.model, effort: config.effort, workspace })
      const status: ModelRuntimeStatus = { kind: config.executor, model: config.model, effort: config.effort, available: true,
        category: 'ready', message: `${config.model} · ${config.effort} 已通过远端 API 预检`, checkedAt: new Date().toISOString(), cached: false }
      this.cache.set(key, { expires: Date.now() + this.cacheMs, status })
      return status
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      const category = classifyFailure(raw)
      return failure(config, category, `${failureLabel(category)}：${compact(raw)}`)
    }
  }

  async scan(targets: ModelCapabilityTarget[], workspace: string): Promise<ModelCapabilityScan> {
    const unique = new Map<string, { kind: ExecutorKind; model: string; roles: RoleConfigRole[] }>()
    for (const target of targets) {
      const key = `${target.executor}\0${target.model}`
      const existing = unique.get(key)
      if (existing) {
        if (target.role && !existing.roles.includes(target.role)) existing.roles.push(target.role)
      } else unique.set(key, { kind: target.executor, model: target.model, roles: target.role ? [target.role] : [] })
    }
    const models = await mapWithConcurrency([...unique.values()], 2, async (target): Promise<ModelCapabilityResult> => {
      const candidateEfforts = target.kind === 'custom' ? ['medium'] as Effort[] : allEfforts
      const checks = await mapWithConcurrency(candidateEfforts, 2, (effort) => this.check({ executor: target.kind, model: target.model, effort }, workspace))
      const supportedEfforts = checks.filter((check) => check.available).map((check) => check.effort)
      const availability = supportedEfforts.length === candidateEfforts.length ? 'available' : supportedEfforts.length ? 'partial' : 'unavailable'
      const failures = [...new Set(checks.filter((check) => !check.available).map((check) => check.message))]
      const message = availability === 'available'
        ? '远程 API 可用，五档推理强度全部通过'
        : availability === 'partial'
          ? `远程 API 可用，${supportedEfforts.length} / ${candidateEfforts.length} 档推理强度通过`
          : failures[0] || '没有可用的模型与推理强度组合'
      return { kind: target.kind, model: target.model, roles: target.roles, availability, supportedEfforts, checks, message }
    })
    return { checkedAt: new Date().toISOString(), models }
  }

  invalidate(kind?: ExecutorKind): void {
    for (const key of this.cache.keys()) if (!kind || key.startsWith(`${kind}\0`)) this.cache.delete(key)
  }
}

type RoleConfigRole = NonNullable<ModelCapabilityTarget['role']>

function failure(config: ModelConfig, category: FailureCategory, message: string): ModelRuntimeStatus {
  return { kind: config.executor, model: config.model, effort: config.effort, available: false, category, message, checkedAt: new Date().toISOString(), cached: false }
}
function classifyFailure(message: string): FailureCategory {
  if (/model.+(?:not found|does not exist|unknown|unavailable)|unsupported model|invalid model/i.test(message)) return 'model'
  if (/effort|reasoning.+(?:unsupported|invalid|not supported)/i.test(message)) return 'effort'
  if (/rate.?limit|quota|credit|billing|insufficient/i.test(message)) return 'quota'
  if (/unauthori[sz]ed|authentication|not logged in|login required|invalid.+(?:token|key)/i.test(message)) return 'authentication'
  if (/timed? ?out|econn|enotfound|network|fetch failed|service unavailable|502|503|504|api/i.test(message)) return 'api'
  return 'unknown'
}
function failureLabel(category: FailureCategory): string {
  return ({ cli: '执行器不可用', authentication: '授权不可用', model: '模型不可用', effort: '推理强度不兼容', api: '远端 API 不可用', quota: 'API 额度或限流', unknown: '模型预检失败' })[category]
}
function providerName(kind: ExecutorKind): string { return kind === 'codex' ? 'Codex' : kind === 'claude' ? 'Claude Code' : '自定义 API' }
function compact(value: string): string { return value.replace(/\s+/g, ' ').trim().slice(0, 1200) }

export function supportsEffort(efforts: Effort[], effort: Effort): boolean { return efforts.includes(effort) }

async function mapWithConcurrency<T, R>(values: T[], limit: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++
      results[index] = await work(values[index])
    }
  }))
  return results
}
