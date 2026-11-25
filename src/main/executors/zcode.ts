import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, win32 } from 'node:path'
import { promisify } from 'node:util'
import { zcodeDefaultModel } from '../../shared/executors'
import { buildCliEnvironment } from './cli-environment'
import { commandInvocation } from './command-launch'
import { resolveExecutable } from './executable-locator'
import { ProcessExecutor } from './process-executor'
import type { AgentExecutor, ExecuteRequest, ModelPreflightRequest } from './types'

const exec = promisify(execFile)
export interface ZcodeLaunch { command: string; args: string[]; executable: string; environment: NodeJS.ProcessEnv }
interface LaunchOptions { env?: NodeJS.ProcessEnv; home?: string; platform?: NodeJS.Platform; node?: string; exists?: (path: string) => boolean }

/** Prefer an installed standalone CLI, then the desktop's Node bundle. Never read or copy credentials. */
export function resolveZcodeLaunch(options: LaunchOptions = {}): ZcodeLaunch {
  const env = options.env ?? process.env; const home = options.home ?? homedir()
  const platform = options.platform ?? process.platform; const exists = options.exists ?? existsSync
  const path = platform === 'win32' ? win32 : { join, dirname, isAbsolute }
  const explicit = env.FOREMAN_ZCODE_PATH
  if (explicit && (!path.isAbsolute(explicit) || !exists(explicit))) throw new Error('FOREMAN_ZCODE_PATH 必须指向存在的 ZCode CLI 绝对路径')
  const standalone = resolveExecutable('zcode', env)
  const bundles = platform === 'darwin'
    ? ['/Applications', join(home, 'Applications')].map((root) => join(root, 'ZCode.app', 'Contents', 'Resources', 'glm', 'zcode.cjs'))
    : platform === 'win32'
      ? [env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs', 'ZCode'), env.ProgramFiles && win32.join(env.ProgramFiles, 'ZCode')].filter((root): root is string => Boolean(root)).map((root) => win32.join(root, 'resources', 'glm', 'zcode.cjs'))
      : ['/opt/ZCode/resources/glm/zcode.cjs', '/opt/zcode/resources/glm/zcode.cjs']
  const executable = explicit ?? (standalone !== 'zcode' ? standalone : bundles.find(exists) ?? standalone)
  const environment: NodeJS.ProcessEnv = {}
  if (!/\.c?js$/i.test(executable)) return { command: executable, args: [], executable, environment }
  const resources = path.dirname(path.dirname(executable))
  const builtin = path.join(resources, 'config', 'provider', 'zcode-builtin.json')
  if (!env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE && exists(builtin)) environment.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = builtin
  // Native override variables remain authoritative, including alternative data roots.
  if (!env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE && !env.ZCODE_DATA_BASE_DIR) environment.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = path.join(home, '.zcode', 'v2', 'provider_config.json')
  environment.ELECTRON_RUN_AS_NODE = '1'
  return { command: options.node ?? process.execPath, args: [executable], executable, environment }
}

export interface ZcodeResult {
  sessionId: string; response: string
  usage?: { inputTokens?: number; outputTokens?: number }
}
export function decodeZcodeResult(raw: string): ZcodeResult {
  let records: Array<Record<string, unknown>>
  try { records = [JSON.parse(raw)] }
  catch { records = raw.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } }) }
  const result = records.reverse().find((record) => record && (record.type === 'result' || (!record.type && typeof record.response === 'string')))
  if (!result || typeof result.sessionId !== 'string' || !result.sessionId || typeof result.response !== 'string' || !result.response.trim()) throw new Error('ZCode 未返回包含 sessionId 和 response 的完整结果')
  const status = (result.projection as { status?: string } | undefined)?.status
  if (result.is_error || result.error || (status && /error|failed|cancelled|canceled|aborted/.test(status))) throw new Error('ZCode 返回失败或中断结果，请检查原生客户端的认证与模型配置')
  return result as unknown as ZcodeResult
}

function validateSelection(request: Pick<ExecuteRequest, 'model' | 'effort'>) {
  if (request.model !== zcodeDefaultModel.id) throw new Error('Unsupported model：ZCode 仅支持原生当前模型，请选择 ZCode 当前模型')
  if (request.effort !== 'default') throw new Error('Unsupported effort：ZCode 推理设置由原生客户端管理，请选择原生默认')
}

export class ZcodeExecutor extends ProcessExecutor implements AgentExecutor {
  readonly kind = 'zcode' as const
  constructor(private readonly locate: () => ZcodeLaunch = resolveZcodeLaunch) { super() }

  async probe(): ReturnType<AgentExecutor['probe']> {
    try {
      const launch = this.locate()
      const env = { ...buildCliEnvironment(process.env, [launch.command]), ...launch.environment }
      const invocation = commandInvocation(launch.command, [...launch.args, '--version'], env)
      const { stdout } = await exec(invocation.command, invocation.args, { env, timeout: 5000 })
      if (!/\d+\.\d+/.test(stdout)) throw new Error('无有效版本')
      return { installed: true, executable: launch.executable, version: stdout.trim(),
        authenticationMessage: '使用 ZCode 原生配置与凭据；安装不代表认证通过，开始任务前会实际预检当前模型。' }
    } catch {
      return { installed: false, executable: 'zcode', version: '未安装或不可执行',
        authenticationMessage: '安装 ZCode CLI 或 Desktop；也可通过 FOREMAN_ZCODE_PATH 指定 CLI 绝对路径。' }
    }
  }

  async execute(request: ExecuteRequest) {
    validateSelection(request)
    const launch = this.locate()
    const mode = request.role === 'implementer' ? 'yolo' : 'plan'
    const result = await this.runProcess(launch.command, [...launch.args, '--prompt', request.prompt, '--cwd', request.workspace,
      '--mode', mode, '--output-format', 'stream-json', '--no-color', '--disallowed-tools', 'Agent AskUserQuestion EnterPlanMode ExitPlanMode'], request, launch.environment)
    const native = decodeZcodeResult(result.output)
    return { ...result, output: native.response, sessionId: native.sessionId, usage: { inputTokens: tokens(native.usage?.inputTokens), outputTokens: tokens(native.usage?.outputTokens) } }
  }

  async preflight(request: ModelPreflightRequest) {
    validateSelection(request)
    const launch = this.locate()
    const prompt = 'Reply exactly OK. Do not inspect files and do not use tools.'
    await this.runPreflightProcess(launch.command, [...launch.args, '--prompt', prompt, '--cwd', request.workspace,
      '--mode', 'plan', '--json', '--no-color', '--disallowed-tools', 'Bash Read Write Edit MultiEdit Agent AskUserQuestion EnterPlanMode ExitPlanMode'],
    request.workspace, '', launch.environment, decodeZcodeResult)
  }

  protected extractOutput(raw: string) { return raw }
}
function tokens(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0 }
