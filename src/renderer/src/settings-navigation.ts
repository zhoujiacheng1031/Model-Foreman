export const settingsGroups = [
  { id: 'settings-connectors', label: '连接器', description: 'CLI、Desktop、API 与模型连接' },
  { id: 'role-workflow-settings', label: '角色与流程', description: '规划、执行、审核与并行策略' },
  { id: 'settings-verification', label: '验证门禁', description: '验证命令、超时与失败处理' },
  { id: 'settings-approvals', label: '人工批准', description: '规划与审核的批准策略' },
  { id: 'settings-memory', label: '长期记忆', description: '召回、写入批准与存储配置' }
] as const
export type SettingsSection = typeof settingsGroups[number]['id']

export function readRecentWorkspaces(storage: Pick<Storage, 'getItem'>): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem('foreman:recent-workspaces') ?? '[]')
    return Array.isArray(value) ? [...new Set(value.filter((path): path is string => typeof path === 'string' && path.length > 0))].slice(0, 20) : []
  } catch { return [] }
}
