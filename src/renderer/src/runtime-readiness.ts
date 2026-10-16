import type { AppSettings, ExecutorCapability, ExecutorKind, ModelCapabilityScan } from '../../shared/contracts'

export function executorReadiness(kind: ExecutorKind, capabilities: ExecutorCapability[]): { state: string; label: string; detail: string } {
  if (kind === 'custom') return { state: 'pending', label: '按模型检测', detail: '自定义 API 的认证与连通性以模型检测为准' }
  const capability = capabilities.find((item) => item.kind === kind)
  if (!capability) return { state: 'pending', label: '状态待检查', detail: '刷新环境以检查安装和登录状态' }
  if (!capability.installed) return { state: 'unavailable', label: '未安装', detail: '安装对应 CLI 后重新扫描' }
  if (!capability.authenticated) return { state: 'unavailable', label: '未登录', detail: `在终端运行 ${kind === 'codex' ? 'codex login' : 'claude auth login'}，完成后重新扫描` }
  return { state: 'available', label: '已登录', detail: '安装与认证已通过；模型调用能力需单独检测' }
}

export function modelReadiness(settings: AppSettings, capabilities: ExecutorCapability[], scan: ModelCapabilityScan | null, kind: ExecutorKind, model: string) {
  const current = executorReadiness(kind, capabilities)
  if (kind !== 'custom' && current.state !== 'available') return current
  if (kind === 'custom') {
    const config = settings.models.custom.find((item) => item.id === model)
    if (!config?.apiKey || !config.baseUrl || !config.remoteModel) return { state: 'unavailable', label: '配置未完成', detail: '请补全模型、接口地址和 API Key' }
  }
  const result = scan?.models.find((item) => item.kind === kind && item.model === model)
  if (!result) return { state: 'pending', label: '模型待检测', detail: '尚无该模型的检测记录' }
  return { state: 'pending', label: result.availability === 'available' ? '上次检测通过' : result.availability === 'partial' ? '上次部分通过' : '上次检测失败', detail: `检测时间：${new Date(scan!.checkedAt).toLocaleString('zh-CN')}；历史结果不代表当前可调用` }
}
