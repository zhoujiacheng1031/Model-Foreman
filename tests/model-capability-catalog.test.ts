import { describe, expect, it } from 'vitest'
import { buildModelCapabilityTargets, selectableModelCatalog } from '../src/renderer/src/model-capabilities'
import { defaultSettings } from '../src/main/storage/database'
import type { ModelCapabilityScan } from '../src/shared/contracts'

describe('model capability catalog', () => {
  it('detects every configured model instead of only the three currently selected role models', () => {
    const settings = defaultSettings('/repo')
    settings.models.codex.push({ id: 'custom-codex', label: 'Custom Codex', efforts: ['high'], source: 'custom' })
    settings.models.claude.push({ id: 'custom-claude', label: 'Custom Claude', efforts: ['medium'], source: 'custom' })

    const targets = buildModelCapabilityTargets(settings)

    expect(targets.map(({ executor, model }) => `${executor}:${model}`)).toEqual(expect.arrayContaining([
      'codex:gpt-5.6-sol', 'codex:gpt-5.6-terra', 'codex:gpt-5.6-luna', 'codex:custom-codex',
      'claude:sonnet', 'claude:opus', 'claude:glm-5.2', 'claude:custom-claude'
    ]))
  })

  it('never removes configured models after a partial scan or executor switch', () => {
    const settings = defaultSettings('/repo')
    const scan: ModelCapabilityScan = {
      checkedAt: new Date().toISOString(),
      models: [{
        kind: 'codex', model: 'gpt-5.6-sol', roles: ['planner'], availability: 'available', supportedEfforts: ['high'],
        checks: [], message: 'available'
      }]
    }

    expect(selectableModelCatalog(settings, scan, 'codex').map((model) => model.id)).toEqual([
      'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'
    ])
    expect(selectableModelCatalog(settings, scan, 'claude').map((model) => model.id)).toEqual([
      'sonnet', 'opus', 'glm-5.2'
    ])
  })
})
