import { z } from 'zod'
import { validateDependencies } from '../parallel/dependencies'
import type { ExecutionContract, ImplementationReport, ReviewDecision, RoleKey } from '../../shared/contracts'

const stepSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), description: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1), files: z.array(z.string()),
  dependsOn: z.array(z.string().min(1)).optional(),
  verificationCommands: z.array(z.string()), status: z.enum(['pending', 'approved', 'completed', 'blocked']).default('pending')
})
export const executionContractSchema = z.object({ version: z.literal(1), summary: z.string().min(1),
  assumptions: z.array(z.string()), risks: z.array(z.string()), steps: z.array(stepSchema).min(1).max(30),
  confidence: z.number().min(0).max(1).default(0.8) }).superRefine((contract, ctx) => {
  try { validateDependencies(contract.steps) } catch (error) { ctx.addIssue({ code: 'custom', message: String(error) }) }
})
export const implementationReportSchema = z.object({ summary: z.string().min(1), filesChanged: z.array(z.string()),
  commandsRun: z.array(z.string()), unresolved: z.array(z.string()) })
export const reviewDecisionSchema = z.object({ verdict: z.enum(['approved', 'changes_requested', 'blocked']),
  summary: z.string().min(1), findings: z.array(z.object({ severity: z.enum(['critical', 'major', 'minor']),
    title: z.string().min(1), evidence: z.string().min(1), requiredChange: z.string() })), confidence: z.number().min(0).max(1) })

type RoleResult = { planner: ExecutionContract; implementer: ImplementationReport; reviewer: ReviewDecision }

export class RoleProtocol {
  instructions(role: RoleKey): string {
    const shape = role === 'planner'
      ? '{"version":1,"summary":"...","assumptions":[],"risks":[],"steps":[{"id":"step-1","title":"...","description":"...","acceptanceCriteria":["..."],"files":["src/example.ts"],"dependsOn":[],"verificationCommands":[],"status":"pending"}],"confidence":0.0}'
      : role === 'implementer'
        ? '{"summary":"...","filesChanged":[],"commandsRun":[],"unresolved":[]}'
        : '{"verdict":"approved|changes_requested|blocked","summary":"...","findings":[{"severity":"critical|major|minor","title":"...","evidence":"...","requiredChange":"..."}],"confidence":0.0}'
    return `\n\n<output_contract>只输出一个 JSON 对象，不要使用 Markdown 代码块或额外说明。必须符合：${shape}</output_contract>`
  }

  decode<R extends RoleKey>(role: R, output: string): RoleResult[R] {
    const parsed = JSON.parse(extractJsonObject(output)) as unknown
    const schema = role === 'planner' ? executionContractSchema : role === 'implementer' ? implementationReportSchema : reviewDecisionSchema
    return schema.parse(parsed) as RoleResult[R]
  }

  repairPrompt(role: RoleKey, output: string, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return `上一次输出不符合结构化协议。错误：${message}\n请只修复格式和缺失字段，不改变原意。\n原始输出：\n${output.slice(0, 12000)}${this.instructions(role)}`
  }
}

function extractJsonObject(output: string): string {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{'); if (start < 0) throw new Error('模型输出中没有 JSON 对象')
  let depth = 0; let quoted = false; let escaped = false
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (escaped) { escaped = false; continue }
    if (char === '\\' && quoted) { escaped = true; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (quoted) continue
    if (char === '{') depth += 1
    if (char === '}' && --depth === 0) return trimmed.slice(start, index + 1)
  }
  throw new Error('模型输出中的 JSON 对象不完整')
}
