import { describe, expect, it } from 'vitest'
import { RoleProtocol } from '../src/main/protocols/role-protocol'

describe('RoleProtocol', () => {
  const protocol = new RoleProtocol()

  it('从模型包装文本中提取并校验执行合同', () => {
    const output = `说明\n\`\`\`json\n${JSON.stringify({ version: 1, summary: '交付登录', assumptions: [], risks: ['迁移'], steps: [
      { id: 's1', title: '实现', description: '实现登录', acceptanceCriteria: ['测试通过'], files: ['src/auth.ts'], verificationCommands: ['npm test'], status: 'pending' }
    ] })}\n\`\`\``
    expect(protocol.decode('planner', output).steps[0]?.id).toBe('s1')
  })

  it('拒绝缺少证据字段的审核结果', () => {
    expect(() => protocol.decode('reviewer', '{"verdict":"approved"}')).toThrow()
    expect(protocol.repairPrompt('reviewer', '{}', new Error('invalid'))).toContain('只修复格式')
  })
})
