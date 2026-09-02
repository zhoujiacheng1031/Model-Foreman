import type { MemoryProviderHealth, MemorySettings } from '../../shared/contracts'

export class TencentDbMemoryAdapter {
  async probe(settings: MemorySettings['tencentdb']): Promise<MemoryProviderHealth> {
    const endpoint = settings.endpoint.replace(/\/$/, '')
    if (!/^https?:\/\//.test(endpoint)) return { provider: 'tencentdb', ok: false, message: 'Endpoint 必须使用 http 或 https' }
    const requiredFields: Array<[string, string]> = [
      ['Service ID', settings.serviceId],
      ['Team ID', settings.teamId],
      ['Agent ID', settings.agentId],
      ['User ID', settings.userId]
    ]
    const missingFields = requiredFields.filter(([, value]) => !value.trim()).map(([label]) => label)
    if (missingFields.length) {
      return { provider: 'tencentdb', ok: false, message: `请先填写 ${missingFields.join('、')}` }
    }
    const gatewayTokenEnv = settings.gatewayTokenEnv.trim()
    if (!gatewayTokenEnv) return { provider: 'tencentdb', ok: false, message: '请填写 Gateway Token 环境变量名' }
    if (!process.env[gatewayTokenEnv]) {
      return { provider: 'tencentdb', ok: false, message: `缺少环境变量 ${gatewayTokenEnv}；设置后请重启 Model Foreman` }
    }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 3000)
    try {
      const gatewayToken = process.env[gatewayTokenEnv]
      const userKey = process.env[settings.userKeyEnv]
      const headers: Record<string, string> = { 'x-tdai-service-id': settings.serviceId }
      if (gatewayToken) headers.authorization = `Bearer ${gatewayToken}`
      if (userKey) headers['x-tdai-user-key'] = userKey
      const response = await fetch(`${endpoint}/health`, { headers, signal: controller.signal })
      return response.ok
        ? { provider: 'tencentdb', ok: true, message: `TencentDB Memory Core 已连接（${response.status}）` }
        : { provider: 'tencentdb', ok: false, message: `Core 返回 HTTP ${response.status}` }
    } catch (error) {
      return { provider: 'tencentdb', ok: false, message: error instanceof Error ? error.message : String(error) }
    } finally { clearTimeout(timer) }
  }

  async search(settings: MemorySettings['tencentdb'], query: string, limit: number): Promise<Array<{ id: string; type: string; content: string; score: number; updatedAt: string }>> {
    if (!settings.teamId || !settings.agentId || !settings.userId) return []
    const data = await this.post(settings, '/v3/atomic/search', {
      team_id: settings.teamId, agent_id: settings.agentId, user_id: settings.userId, query, limit
    }) as { items?: Array<{ id: string; type: string; content: string; score?: number; updated_at?: string }> }
    return (data.items ?? []).map((item) => ({ id: item.id, type: item.type, content: item.content,
      score: item.score ?? 0, updatedAt: item.updated_at ?? new Date().toISOString() }))
  }

  private async post(settings: MemorySettings['tencentdb'], path: string, body: unknown): Promise<unknown> {
    const gatewayToken = process.env[settings.gatewayTokenEnv]
    if (!gatewayToken) throw new Error(`缺少环境变量 ${settings.gatewayTokenEnv}`)
    const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${gatewayToken}`, 'x-tdai-service-id': settings.serviceId }
    const userKey = process.env[settings.userKeyEnv]; if (userKey) headers['x-tdai-user-key'] = userKey
    const response = await fetch(`${settings.endpoint.replace(/\/$/, '')}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
    const payload = await response.json() as { code?: number; message?: string; data?: unknown }
    if (!response.ok || (payload.code ?? 0) !== 0) throw new Error(payload.message ?? `TencentDB Core HTTP ${response.status}`)
    return payload.data ?? payload
  }
}
