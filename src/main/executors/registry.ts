import type { ExecutorKind } from '../../shared/contracts'
import type { AgentExecutor } from './types'
import { ClaudeExecutor } from './claude'
import { CodexExecutor } from './codex'

export class ExecutorRegistry {
  private readonly executors: Map<ExecutorKind, AgentExecutor>

  constructor(executors: AgentExecutor[] = [new CodexExecutor(), new ClaudeExecutor()]) {
    this.executors = new Map(executors.map((executor) => [executor.kind, executor]))
  }

  get(kind: ExecutorKind): AgentExecutor {
    const executor = this.executors.get(kind)
    if (!executor) throw new Error(`未知执行器：${kind}`)
    return executor
  }

  all(): AgentExecutor[] { return [...this.executors.values()] }

  cancel(runId: string): void {
    for (const executor of this.executors.values()) executor.cancel(runId)
  }
}
