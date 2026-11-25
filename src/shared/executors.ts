import type { ExecutorKind, ModelDefinition } from './contracts'

export const zcodeDefaultModel: ModelDefinition = {
  id: 'native-default', label: 'ZCode 当前模型（原生配置）', efforts: ['default'], source: 'builtin'
}

export function executorLabel(kind: ExecutorKind): string {
  return { codex: 'Codex CLI', claude: 'Claude Code', zcode: 'ZCode', custom: '自定义 API' }[kind]
}

export function effortLabel(effort: string): string { return effort === 'default' ? '原生默认' : effort }
export function modelLabel(model: string): string { return model === zcodeDefaultModel.id ? 'ZCode 当前模型' : model }
