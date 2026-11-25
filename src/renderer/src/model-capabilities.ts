import type { AppSettings, ExecutorKind, ModelCapabilityScan, ModelCapabilityTarget, ModelDefinition, RoleKey } from '../../shared/contracts'

const roles: RoleKey[] = ['planner', 'implementer', 'reviewer']

/** A connector check must not replace another connector's evidence or its timestamp. */
export function mergeConnectorScan(previous: ModelCapabilityScan | null, scan: ModelCapabilityScan, kind: ExecutorKind): ModelCapabilityScan {
  return { ...scan, models: [
    ...(previous?.models.filter((item) => item.kind !== kind).map((item) => ({ ...item, checkedAt: item.checkedAt ?? previous.checkedAt })) ?? []),
    ...scan.models.filter((item) => item.kind === kind).map((item) => ({ ...item, checkedAt: item.checkedAt ?? scan.checkedAt }))
  ] }
}

/**
 * Capability scans are catalog-wide. Role selections are only annotations and
 * must never decide which models survive in the selector.
 */
export function buildModelCapabilityTargets(settings: AppSettings): ModelCapabilityTarget[] {
  return (['codex', 'claude', 'zcode', 'custom'] as ExecutorKind[]).flatMap((executor) => settings.models[executor].flatMap((model) => {
    const selectedBy = roles.filter((role) => settings.roles[role].executor === executor && settings.roles[role].model === model.id)
    return selectedBy.length
      ? selectedBy.map((role) => ({ role, executor, model: model.id }))
      : [{ executor, model: model.id }]
  }))
}

/** Keep the complete configured catalog after a scan; results only annotate and reorder it. */
export function selectableModelCatalog(settings: AppSettings, scan: ModelCapabilityScan | null, kind: ExecutorKind): ModelDefinition[] {
  const configured = settings.models[kind]
  if (!scan) return configured
  const discovered = scan.models
    .filter((result) => result.kind === kind && !configured.some((model) => model.id === result.model))
    .map((result): ModelDefinition => ({
      id: result.model,
      label: `${result.model}（检测发现）`,
      efforts: result.supportedEfforts.length ? result.supportedEfforts : ['low', 'medium', 'high', 'xhigh', 'max'],
      source: 'custom'
    }))
  const models = [...configured, ...discovered]
  const rank = (model: ModelDefinition) => {
    const result = scan.models.find((item) => item.kind === kind && item.model === model.id)
    if (!result) return 2
    if (result.availability === 'available' || result.availability === 'partial') return 0
    return 1
  }
  return models.map((model, index) => ({ model, index })).sort((left, right) => rank(left.model) - rank(right.model) || left.index - right.index).map(({ model }) => model)
}

/** A draft API entry is not yet a selectable executor model. */
export function customModelIsComplete(model: ModelDefinition): boolean {
  if (!model.protocol || !model.baseUrl?.trim() || !model.apiKey?.trim() || !model.remoteModel?.trim()) return false
  try { new URL(model.baseUrl); return true } catch { return false }
}
