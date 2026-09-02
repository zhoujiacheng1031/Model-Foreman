import { z } from 'zod'

const roleSchema = z.object({
  executor: z.enum(['codex', 'claude', 'custom']),
  model: z.string().trim().min(1, '模型 ID 不能为空'),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  prompt: z.string().trim().min(1, '角色提示词不能为空').max(30_000, '角色提示词过长'),
  skillMode: z.enum(['auto', 'explicit']),
  skills: z.array(z.string().trim().min(2).max(160)).max(24)
})
const modelDefinitionSchema = () => z.object({ id: z.string().trim().min(1).max(160), label: z.string().trim().min(1).max(160),
  efforts: z.array(z.enum(['low', 'medium', 'high', 'xhigh', 'max'])).min(1), source: z.enum(['builtin', 'custom']) })
export const customModelDefinitionSchema = modelDefinitionSchema().extend({
  protocol: z.enum(['openai-responses', 'anthropic-messages']),
  baseUrl: z.string().trim().url('请输入有效的 API URL'),
  apiKey: z.string().trim().min(1, 'API Key 不能为空').max(1000),
  remoteModel: z.string().trim().min(1, '模型名称不能为空').max(200)
})

export const appSettingsSchema = z.object({
  workspace: z.string().trim().min(1, '工作目录不能为空'),
  maxReviewLoops: z.number().int().min(0).max(8),
  roles: z.object({ planner: roleSchema, implementer: roleSchema, reviewer: roleSchema }),
  approvals: z.object({
    planner: z.object({ autoApprove: z.boolean(), minConfidence: z.number().min(0).max(1) }),
    reviewer: z.object({ autoApprove: z.boolean(), minConfidence: z.number().min(0).max(1) })
  }),
  models: z.object({ codex: z.array(modelDefinitionSchema()).max(40), claude: z.array(modelDefinitionSchema()).max(40), custom: z.array(customModelDefinitionSchema).max(24) }),
  memory: z.object({
    enabled: z.boolean(), provider: z.enum(['local', 'tencentdb']),
    maxItems: z.number().int().min(1).max(20), maxChars: z.number().int().min(500).max(30_000), requireApproval: z.boolean(),
    tencentdb: z.object({ endpoint: z.string().trim().url(), serviceId: z.string().trim().min(1), teamId: z.string(), agentId: z.string(), userId: z.string(),
      gatewayTokenEnv: z.string().trim().min(1), userKeyEnv: z.string().trim().min(1) })
  }),
  verification: z.object({ enabled: z.boolean(), commands: z.array(z.string().trim().min(1)).max(12),
    timeoutSeconds: z.number().int().min(10).max(3600), stopOnFailure: z.boolean() })
})

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, '任务标题不能为空').max(120, '任务标题过长'),
  objective: z.string().trim().min(3, '任务目标至少需要 3 个字符').max(30_000, '任务目标过长'),
  workspace: z.string().trim().min(1, '工作目录不能为空')
})

export const goalInputSchema = z.object({
  title: z.string().trim().min(1).max(160), objective: z.string().trim().min(1).max(20000), workspace: z.string().trim().min(1),
  successCriteria: z.array(z.string().trim().min(1).max(2000)).min(1).max(24), constraints: z.array(z.string().trim().min(1).max(2000)).max(24),
  priority: z.number().int().min(0).max(100), timeBudgetSeconds: z.number().int().min(60).max(2_592_000).optional(),
  tokenBudget: z.number().int().min(1000).max(100_000_000).optional(), costBudgetUsd: z.number().min(0.01).max(100_000).optional(),
  maxIterations: z.number().int().min(1).max(100), maxTaskAttempts: z.number().int().min(1).max(8)
})

export function validated<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new Error(result.error.issues[0]?.message ?? '输入无效')
}
