import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentExecutor, ExecuteRequest, ModelPreflightRequest } from './types'
import { ProcessExecutor } from './process-executor'
import { resolveExecutable } from './executable-locator'
import { buildCliEnvironment } from './cli-environment'
import { commandInvocation } from './command-launch'

const execFileAsync = promisify(execFile)

export class ClaudeExecutor extends ProcessExecutor implements AgentExecutor {
  readonly kind = 'claude' as const
  private get executable() { return resolveExecutable(this.kind) }

  async probe() {
    const executable = this.executable
    const env = buildCliEnvironment(process.env, [executable])
    try {
      const version = commandInvocation(executable, ['--version'], env)
      const { stdout } = await execFileAsync(version.command, version.args, { env, timeout: 4000 })
      try {
        const auth = commandInvocation(executable, ['auth', 'status', '--json'], env)
        const status = await execFileAsync(auth.command, auth.args, { env, timeout: 4000 })
        const parsed = JSON.parse(status.stdout) as { loggedIn?: boolean; authMethod?: string; apiProvider?: string }
        const authenticated = parsed.loggedIn === true
        return { installed: true, executable, version: stdout.trim(), authenticated,
          authenticationMessage: authenticated ? `已登录 · ${parsed.authMethod ?? parsed.apiProvider ?? 'Claude Code'}` : 'CLI 已安装，但尚未登录' }
      } catch (error) {
        return { installed: true, executable, version: stdout.trim(), authenticated: false,
          authenticationMessage: processErrorOutput(error) || 'CLI 已安装，但无法确认登录状态' }
      }
    } catch {
      return { installed: false, executable, version: '未安装', authenticated: false, authenticationMessage: '未检测到独立安装的 Claude Code CLI' }
    }
  }

  execute(request: ExecuteRequest) {
    const permissionMode = request.role === 'implementer' ? 'acceptEdits' : 'plan'
    const args = [
      '-p', '--output-format', 'stream-json', '--verbose',
      '--model', request.model, '--effort', request.effort,
      '--permission-mode', permissionMode
    ]
    return this.runProcess(this.executable, args, request)
  }

  preflight(request: ModelPreflightRequest) {
    return this.runPreflightProcess(this.executable, [
      '-p', '--output-format', 'json', '--model', request.model, '--effort', request.effort,
      '--permission-mode', 'plan', '--tools', '', '--no-session-persistence'
    ], request.workspace, 'Reply exactly OK. Do not inspect files and do not use tools.')
  }

  protected extractOutput(raw: string): string {
    let result = ''
    for (const line of raw.trim().split('\n')) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>
        if (event.type === 'result' && typeof event.result === 'string') result = event.result
      } catch { /* preserved as event output */ }
    }
    return result || raw.trim()
  }
}

function processErrorOutput(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const value = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string }
  return `${value.stdout ?? ''}\n${value.stderr ?? ''}`.trim() || value.message || ''
}
