import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentExecutor, ExecuteRequest, ModelPreflightRequest } from './types'
import { ProcessExecutor } from './process-executor'
import { resolveExecutable } from './executable-locator'
import { buildCliEnvironment } from './cli-environment'
import { commandInvocation } from './command-launch'

const execFileAsync = promisify(execFile)

export class CodexExecutor extends ProcessExecutor implements AgentExecutor {
  readonly kind = 'codex' as const
  private get executable() { return resolveExecutable(this.kind) }

  async probe() {
    const executable = this.executable
    const env = buildCliEnvironment(process.env, [executable])
    try {
      const version = commandInvocation(executable, ['--version'], env)
      const { stdout } = await execFileAsync(version.command, version.args, { env, timeout: 4000 })
      try {
        const login = commandInvocation(executable, ['login', 'status'], env)
        const status = await execFileAsync(login.command, login.args, { env, timeout: 4000 })
        const message = `${status.stdout}\n${status.stderr}`.trim()
        const authenticated = /logged in/i.test(message)
        return { installed: true, executable, version: stdout.trim(), authenticated,
          authenticationMessage: authenticated ? message || '已登录' : message || 'CLI 已安装，但尚未登录' }
      } catch (error) {
        const message = processErrorOutput(error)
        return { installed: true, executable, version: stdout.trim(), authenticated: false,
          authenticationMessage: message || 'CLI 已安装，但无法确认登录状态' }
      }
    } catch {
      return { installed: false, executable, version: '未安装', authenticated: false, authenticationMessage: '未检测到独立安装的 Codex CLI' }
    }
  }

  execute(request: ExecuteRequest) {
    const sandbox = request.role === 'implementer' ? 'workspace-write' : 'read-only'
    const args = [
      'exec', '-', '--json', '--skip-git-repo-check', '-C', request.workspace,
      '-m', request.model, '-s', sandbox,
      '-c', `model_reasoning_effort=${JSON.stringify(request.effort)}`
    ]
    return this.runProcess(this.executable, args, request)
  }

  preflight(request: ModelPreflightRequest) {
    return this.runPreflightProcess(this.executable, [
      'exec', '-', '--json', '--skip-git-repo-check', '-C', request.workspace, '-m', request.model, '-s', 'read-only',
      '-c', `model_reasoning_effort=${JSON.stringify(request.effort)}`
    ], request.workspace, 'Reply exactly OK. Do not inspect files and do not use tools.')
  }

  protected extractOutput(raw: string): string {
    const lines = raw.trim().split('\n')
    const messages: string[] = []
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>
        const item = event.item as Record<string, unknown> | undefined
        if (item?.type === 'agent_message' && typeof item.text === 'string') messages.push(item.text)
        if (event.type === 'message' && typeof event.message === 'string') messages.push(event.message)
      } catch { /* raw CLI chatter is still preserved in the event log */ }
    }
    return messages.at(-1) ?? raw.trim()
  }
}

function processErrorOutput(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const value = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string }
  return `${value.stdout ?? ''}\n${value.stderr ?? ''}`.trim() || value.message || ''
}
