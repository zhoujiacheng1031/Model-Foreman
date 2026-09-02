import { describe, expect, it } from 'vitest'
import { buildCustomModelInvocation, messagesBaseUrl, responsesBaseUrl } from '../src/main/executors/custom-api'
import { defaultSettings } from '../src/main/storage/database'
import { appSettingsSchema } from '../src/main/validation'
import { buildModelCapabilityTargets } from '../src/renderer/src/model-capabilities'
import type { ModelDefinition } from '../src/shared/contracts'

const openAiModel: ModelDefinition = {
  id: 'company-gpt', label: '公司 GPT', efforts: ['medium', 'high'], source: 'custom',
  protocol: 'openai-responses', baseUrl: 'https://gateway.example.com/v1/responses', apiKey: 'secret-openai', remoteModel: 'company-gpt-1'
}

const anthropicModel: ModelDefinition = {
  id: 'company-claude', label: '公司 Claude', efforts: ['medium'], source: 'custom',
  protocol: 'anthropic-messages', baseUrl: 'https://gateway.example.com/v1/messages', apiKey: 'secret-anthropic', remoteModel: 'company-claude-1'
}

describe('custom model configuration', () => {
  it('validates complete custom providers and rejects incomplete credentials', () => {
    const settings = defaultSettings('/repo')
    settings.models.custom = [openAiModel, anthropicModel]
    expect(appSettingsSchema.safeParse(settings).success).toBe(true)

    settings.models.custom[0] = { ...openAiModel, apiKey: '' }
    expect(appSettingsSchema.safeParse(settings).success).toBe(false)
    settings.models.custom[0] = { ...openAiModel, baseUrl: 'not-a-url', apiKey: 'secret' }
    expect(appSettingsSchema.safeParse(settings).success).toBe(false)
  })

  it('builds an OpenAI Responses invocation without exposing its key in arguments', () => {
    const invocation = buildCustomModelInvocation(openAiModel, 'high', '/repo', 'workspace-write', true, (kind) => `/bin/${kind}`)
    expect(invocation.command).toBe('/bin/codex')
    expect(invocation.args).toContain('company-gpt-1')
    expect(invocation.args).toContain('workspace-write')
    expect(invocation.args.join(' ')).toContain('wire_api="responses"')
    expect(invocation.args.join(' ')).toContain('https://gateway.example.com/v1')
    expect(invocation.args.join(' ')).not.toContain('secret-openai')
    expect(invocation.environment.MODEL_FOREMAN_CUSTOM_API_KEY).toBe('secret-openai')
  })

  it('builds an Anthropic Messages invocation with compatibility environment variables', () => {
    const invocation = buildCustomModelInvocation(anthropicModel, 'medium', '/repo', 'read-only', false, (kind) => `/bin/${kind}`)
    expect(invocation.command).toBe('/bin/claude')
    expect(invocation.args).toEqual(expect.arrayContaining(['company-claude-1', 'plan']))
    expect(invocation.args.join(' ')).not.toContain('secret-anthropic')
    expect(invocation.environment).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://gateway.example.com',
      ANTHROPIC_AUTH_TOKEN: 'secret-anthropic',
      ANTHROPIC_API_KEY: 'secret-anthropic'
    })
  })

  it('normalizes endpoint URLs and includes custom models in capability scans', () => {
    expect(responsesBaseUrl('https://api.example.com/v1/responses/')).toBe('https://api.example.com/v1')
    expect(messagesBaseUrl('https://api.example.com/v1/messages/')).toBe('https://api.example.com')
    const settings = defaultSettings('/repo')
    settings.models.custom = [openAiModel]
    settings.roles.planner = { ...settings.roles.planner, executor: 'custom', model: openAiModel.id }
    expect(buildModelCapabilityTargets(settings)).toContainEqual({ role: 'planner', executor: 'custom', model: openAiModel.id })
  })
})
