import { execFile } from 'node:child_process'
import { access, chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { TencentDbSetupResult } from '../../shared/contracts'

const execFileAsync = promisify(execFile)
const repositoryUrl = 'https://github.com/TencentCloud/TencentDB-Agent-Memory.git'

type CommandRunner = (command: string, args: string[], cwd?: string) => Promise<{ stdout: string; stderr: string }>
type TerminalLauncher = (script: string, cwd: string) => Promise<void>

export class TencentDbSetupService {
  constructor(
    private readonly integrationRoot: string,
    private readonly run: CommandRunner = runCommand,
    private readonly launch: TerminalLauncher = launchTerminal
  ) {}

  async prepareAndLaunch(): Promise<TencentDbSetupResult> {
    const git = await this.check('git', ['--version'], '未检测到 Git。请先安装 Git，再重试一键配置。')
    if (!git.ok) return git

    const docker = await this.check('docker', ['version', '--format', '{{.Server.Version}}'], '未检测到可用的 Docker daemon。请安装并启动 Docker Desktop，再重试。')
    if (!docker.ok) return docker

    const repository = join(this.integrationRoot, 'TencentDB-Agent-Memory')
    await mkdir(this.integrationRoot, { recursive: true })
    if (!await exists(join(repository, '.git'))) {
      if (await exists(repository)) {
        return failure('repository_conflict', `配置目录已存在但不是有效 Git 仓库：${repository}。请移走该目录后重试。`)
      }
      try {
        await this.run('git', ['clone', '--depth', '1', repositoryUrl, repository], this.integrationRoot)
      } catch (error) {
        return failure('clone_failed', `下载 TencentDB Agent Memory 失败：${errorMessage(error)}`)
      }
    }

    const deployDirectory = join(repository, 'deploy', 'global-images')
    const officialLauncher = join(deployDirectory, 'start-all.sh')
    if (!await exists(officialLauncher)) {
      return failure('unsupported_repository', '官方仓库中未找到 deploy/global-images/start-all.sh；仓库结构可能已变化，请更新 Model Foreman 后重试。')
    }

    const launcher = join(this.integrationRoot, 'configure-tencentdb-memory.command')
    await writeFile(launcher, launcherScript(deployDirectory), { encoding: 'utf8', mode: 0o700 })
    await chmod(launcher, 0o700)
    try {
      await this.launch(launcher, deployDirectory)
    } catch (error) {
      return failure('terminal_failed', `已准备官方仓库，但无法打开配置终端：${errorMessage(error)}`)
    }

    return {
      ok: true,
      stage: 'terminal_opened',
      message: '已打开 TencentDB 官方配置终端。按提示填写 LLM 连接后，脚本会启动本地服务；密钥不会写入 Foreman 数据库。',
      directory: deployDirectory,
      endpoint: 'http://127.0.0.1:8420'
    }
  }

  private async check(command: string, args: string[], message: string): Promise<TencentDbSetupResult> {
    try {
      await this.run(command, args)
      return { ok: true, stage: 'prerequisites_ready', message, endpoint: 'http://127.0.0.1:8420' }
    } catch (error) {
      return failure('prerequisite_missing', `${message}（${errorMessage(error)}）`)
    }
  }
}

function launcherScript(deployDirectory: string): string {
  const escapedDirectory = deployDirectory.replaceAll("'", "'\\''")
  return `#!/usr/bin/env bash
set -euo pipefail
cd '${escapedDirectory}'
printf '\\nModel Foreman · TencentDB Memory 一键配置\\n'
printf '即将运行 TencentDB 官方交互式安装器。它会下载并启动 Docker 容器，默认使用 8420/8125/8424/8096 端口。\\n'
printf 'LLM 密钥只输入到官方安装器，不会保存到 Model Foreman。按 Ctrl+C 可随时取消。\\n\\n'
exec ./start-all.sh
`
}

async function runCommand(command: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024 })
}

async function launchTerminal(script: string, cwd: string): Promise<void> {
  if (process.platform === 'darwin') {
    await runCommand('/usr/bin/open', ['-a', 'Terminal', script], cwd)
    return
  }
  if (process.platform === 'win32') {
    const bash = await firstExisting([
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe')
    ])
    if (!bash) throw new Error('未找到 Git Bash；请安装 Git for Windows')
    const child = execFile(bash, [script], { cwd, windowsHide: false })
    child.unref()
    return
  }
  const child = execFile('x-terminal-emulator', ['-e', '/bin/bash', script], { cwd })
  child.unref()
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const path of paths.filter(Boolean)) if (await exists(path)) return path
  return undefined
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

function failure(stage: TencentDbSetupResult['stage'], message: string): TencentDbSetupResult {
  return { ok: false, stage, message, endpoint: 'http://127.0.0.1:8420' }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.trim()) return error.stderr.trim()
  return error instanceof Error ? error.message : String(error)
}
