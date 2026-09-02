import type { Effort, ExecutorKind, RoleKey, RunEvent } from '../../shared/contracts'

export interface ExecuteRequest {
  runId: string
  role: RoleKey
  model: string
  effort: string
  prompt: string
  workspace: string
  emit: (event: Omit<RunEvent, 'at'>) => void
}

export interface ExecuteResult {
  output: string
  exitCode: number
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
}

export interface ModelPreflightRequest { model: string; effort: Effort; workspace: string }

export interface AgentExecutor {
  readonly kind: ExecutorKind
  probe(): Promise<{ installed: boolean; executable: string; version: string; authenticated?: boolean; authenticationMessage?: string }>
  preflight?(request: ModelPreflightRequest): Promise<void>
  execute(request: ExecuteRequest): Promise<ExecuteResult>
  cancel(runId: string): void
}
