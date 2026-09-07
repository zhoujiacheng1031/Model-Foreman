import { terminateProcessTree } from './process-tree'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ExecuteRequest, ExecuteResult } from './types'
import { buildCliEnvironment } from './cli-environment'
import { commandInvocation } from './command-launch'

export abstract class ProcessExecutor {
  protected readonly children = new Map<string, { runId: string; child: ChildProcessWithoutNullStreams }>()

  protected runProcess(command: string, args: string[], request: ExecuteRequest, environment: NodeJS.ProcessEnv = {}): Promise<ExecuteResult> {
    return new Promise((resolve, reject) => {
      const env = { ...buildCliEnvironment(process.env, [command]), ...environment }
      const invocation = commandInvocation(command, args, env)
      const child = spawn(invocation.command, invocation.args, {
        cwd: request.workspace,
        env,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      })
      const executionId = request.executionId ?? `${request.runId}:${randomUUID()}`
      this.children.set(executionId, { runId: request.runId, child })
      let stdout = ''
      let stderr = ''
      let stderrPending = ''

      child.stdout.on('data', (chunk: Buffer) => {
        const message = chunk.toString()
        stdout += message
        request.emit({ runId: request.runId, phase: this.phaseFor(request.role), kind: 'stdout', message })
      })
      child.stderr.on('data', (chunk: Buffer) => {
        const message = chunk.toString()
        stderr += message
        stderrPending += message
        const lines = stderrPending.split(/\r?\n/)
        stderrPending = lines.pop() ?? ''
        for (const line of lines) if (line) this.emitStderr(request, line)
      })
      child.on('error', (error) => { this.children.delete(executionId); reject(error) })
      child.on('close', (code) => {
        this.children.delete(executionId)
        if (stderrPending) this.emitStderr(request, stderrPending)
        const exitCode = code ?? 1
        if (exitCode !== 0) reject(new Error(stderr.trim() || `执行器退出，状态码 ${exitCode}`))
        else resolve({ output: this.extractOutput(stdout), exitCode, usage: extractUsage(stdout) })
      })
      writePrompt(child, request.prompt, reject)
    })
  }

  protected runPreflightProcess(command: string, args: string[], workspace: string, prompt: string, environment: NodeJS.ProcessEnv = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = { ...buildCliEnvironment(process.env, [command]), ...environment }
      const invocation = commandInvocation(command, args, env)
      const child = spawn(invocation.command, invocation.args, { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'] })
      let output = ''; let timedOut = false
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, 45_000)
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.on('error', (error) => { clearTimeout(timer); reject(error) })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (timedOut) reject(new Error('API 预检超时（45 秒），请检查网络、代理或服务状态'))
        else if ((code ?? 1) !== 0) reject(new Error(output.trim() || `模型预检失败，执行器状态码 ${code ?? 1}`))
        else resolve()
      })
      writePrompt(child, prompt, reject)
    })
  }

  cancel(runId: string): void {
    for (const { runId: parent, child } of this.children.values()) {
      if (parent !== runId || !child.pid) continue
      terminateProcessTree(child)
    }
  }

  protected abstract extractOutput(raw: string): string

  private emitStderr(request: ExecuteRequest, message: string): void {
    const modelRefreshTimeout = /codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit/.test(message)
    request.emit({
      runId: request.runId,
      phase: this.phaseFor(request.role),
      kind: modelRefreshTimeout ? 'status' : 'stderr',
      message: modelRefreshTimeout ? 'Codex 后台模型列表刷新超时；当前任务仍在继续。' : message
    })
  }

  private phaseFor(role: ExecuteRequest['role']) {
    return role === 'planner' ? 'planning' as const : role === 'reviewer' ? 'reviewing' as const : 'implementing' as const
  }
}

function writePrompt(child: ChildProcessWithoutNullStreams, prompt: string, reject: (reason?: unknown) => void): void {
  child.stdin.on('error', (error: NodeJS.ErrnoException) => {
    // A CLI may exit successfully before consuming stdin. Its close event remains
    // authoritative; EPIPE here must not escape as an unhandled process error.
    if (error.code !== 'EPIPE') reject(error)
  })
  if (!child.stdin.destroyed) child.stdin.end(prompt)
}

function extractUsage(raw: string): ExecuteResult['usage'] {
  let inputTokens=0, outputTokens=0, costUsd=0, found=false
  for (const line of raw.trim().split('\n')) try {
    const event=JSON.parse(line) as Record<string,unknown>; const usage=event.usage as Record<string,unknown>|undefined
    if (usage) { found=true; inputTokens += number(usage.input_tokens) + number(usage.cached_input_tokens) + number(usage.cache_creation_input_tokens) + number(usage.cache_read_input_tokens); outputTokens += number(usage.output_tokens) }
    costUsd += number(event.total_cost_usd)
  } catch { /* non-JSON CLI chatter */ }
  return found || costUsd ? { inputTokens, outputTokens, ...(costUsd ? {costUsd}:{}) } : undefined
}
function number(value:unknown):number { return typeof value==='number'&&Number.isFinite(value)?value:0 }
