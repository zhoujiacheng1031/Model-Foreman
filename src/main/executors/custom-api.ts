import type { ModelDefinition } from '../../shared/contracts'
import type { AgentExecutor, ExecuteRequest, ModelPreflightRequest } from './types'
import { ProcessExecutor } from './process-executor'
import { resolveExecutable } from './executable-locator'

const customKeyEnvironment = 'MODEL_FOREMAN_CUSTOM_API_KEY'
type CustomSandbox = 'read-only' | 'workspace-write'

export interface CustomModelInvocation {
  command: string
  args: string[]
  environment: Record<string, string>
}

export class CustomApiExecutor extends ProcessExecutor implements AgentExecutor {
  readonly kind = 'custom' as const

  constructor(private readonly resolveModel: (id: string) => ModelDefinition | undefined) { super() }

  async probe() {
    return { installed: true, executable: 'Model Foreman API adapter', version: 'Responses / Messages', authenticated: true,
      authenticationMessage: '由每个自定义模型的 API Key 授权' }
  }

  execute(request: ExecuteRequest) {
    const model = this.requiredModel(request.model)
    const invocation = buildCustomModelInvocation(model, request.effort, request.workspace, request.role === 'implementer' ? 'workspace-write' : 'read-only', true)
    return this.runProcess(invocation.command, invocation.args, { ...request, model: model.remoteModel! }, invocation.environment)
  }

  preflight(request: ModelPreflightRequest) {
    const model = this.requiredModel(request.model)
    const invocation = buildCustomModelInvocation(model, request.effort, request.workspace, 'read-only', false)
    return this.runPreflightProcess(invocation.command, invocation.args, request.workspace,
      'Reply exactly OK. Do not inspect files and do not use tools.', invocation.environment)
  }

  protected extractOutput(raw: string): string {
    let result = ''
    for (const line of raw.trim().split('\n')) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>
        const item = event.item as Record<string, unknown> | undefined
        if (item?.type === 'agent_message' && typeof item.text === 'string') result = item.text
        if (event.type === 'message' && typeof event.message === 'string') result = event.message
        if (event.type === 'result' && typeof event.result === 'string') result = event.result
      } catch { /* keep the final raw output as a compatibility fallback */ }
    }
    return result || raw.trim()
  }

  private requiredModel(id: string): ModelDefinition {
    const model = this.resolveModel(id)
    if (!model) throw new Error(`自定义模型配置不存在：${id}`)
    if (!model.protocol || !model.baseUrl || !model.apiKey || !model.remoteModel) throw new Error(`自定义模型“${model.label}”配置不完整`)
    return model
  }

}

export function buildCustomModelInvocation(model: ModelDefinition, effort: string, workspace: string, sandbox: CustomSandbox,
  stream: boolean, executable: (kind: 'codex' | 'claude') => string = resolveExecutable): CustomModelInvocation {
  if (model.protocol === 'anthropic-messages') {
    const args = ['-p', '--output-format', stream ? 'stream-json' : 'json', '--model', model.remoteModel!, '--effort', effort,
      '--permission-mode', sandbox === 'workspace-write' ? 'acceptEdits' : 'plan', ...(stream ? ['--verbose'] : ['--tools', '', '--no-session-persistence'])]
    return { command: executable('claude'), args, environment: {
      ANTHROPIC_BASE_URL: messagesBaseUrl(model.baseUrl!), ANTHROPIC_AUTH_TOKEN: model.apiKey!, ANTHROPIC_API_KEY: model.apiKey!,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
    } }
  }
  const provider = 'model_foreman_custom'
  const args = ['exec', '-', '--json', '--skip-git-repo-check', '-C', workspace, '-m', model.remoteModel!, '-s', sandbox,
    '-c', `model_provider=${JSON.stringify(provider)}`,
    '-c', `model_providers.${provider}.name=${JSON.stringify(model.label)}`,
    '-c', `model_providers.${provider}.base_url=${JSON.stringify(responsesBaseUrl(model.baseUrl!))}`,
    '-c', `model_providers.${provider}.env_key=${JSON.stringify(customKeyEnvironment)}`,
    '-c', `model_providers.${provider}.wire_api="responses"`,
    '-c', `model_providers.${provider}.requires_openai_auth=false`,
    '-c', `model_reasoning_effort=${JSON.stringify(effort)}`]
  return { command: executable('codex'), args, environment: { [customKeyEnvironment]: model.apiKey! } }
}

export function responsesBaseUrl(value: string): string { return value.trim().replace(/\/$/, '').replace(/\/responses$/i, '') }
export function messagesBaseUrl(value: string): string { return value.trim().replace(/\/$/, '').replace(/\/v1\/messages$/i, '').replace(/\/messages$/i, '') }
