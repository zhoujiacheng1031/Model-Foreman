import { terminateProcessTree, verificationCommand } from '../executors/process-tree'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { VerificationCheck, VerificationReport, VerificationSettings } from '../../shared/contracts'
import type { VerificationModule } from './types'

export class LocalVerificationModule implements VerificationModule {
  private readonly active = new Map<symbol, { runId: string; controller: AbortController }>()

  async verify(workspace: string, settings: VerificationSettings, suggestedCommands: string[] = [], runId = workspace): Promise<VerificationReport> {
    const key = Symbol(); const controller = new AbortController(); const signal = controller.signal
    this.active.set(key, { runId, controller })
    try {
    const startedAt = new Date().toISOString(); const commands = settings.enabled ? await this.commands(workspace, settings.commands, suggestedCommands) : []
    const checks: VerificationCheck[] = []
    for (const command of commands) {
      const check = await this.run(workspace, command, settings.timeoutSeconds, signal); signal.throwIfAborted(); checks.push(check)
      if (!check.passed && settings.stopOnFailure) break
    }
    signal.throwIfAborted()
    const commit = await this.gitCommit(workspace, signal)
    const workspaceFingerprint = await this.fingerprint(workspace)
    signal.throwIfAborted()
    const status = checks.length === 0 ? 'skipped' : checks.every((check) => check.passed) ? 'passed' : 'failed'
    return { origin: 'foreman-local-verifier', status, passed: status === 'passed', commit, workspaceFingerprint, startedAt, completedAt: new Date().toISOString(), checks }
    } finally { this.active.delete(key) }
  }

  cancel(runId?: string): void {
    for (const session of this.active.values()) if (runId === undefined || session.runId === runId) session.controller.abort(new Error('验证已取消'))
  }

  private async commands(workspace: string, configured: string[], suggested: string[]): Promise<string[]> {
    if (configured.length) return unique(configured)
    try {
      const pkg = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
      const order = ['lint', 'typecheck', 'test', 'build']
      const discovered = order.filter((name) => pkg.scripts?.[name]).map((name) => `npm run ${name}`)
      return unique([...suggested.filter(safeSuggestedCommand), ...discovered])
    } catch { return unique(suggested.filter(safeSuggestedCommand)) }
  }

  private run(workspace: string, command: string, timeoutSeconds: number, signal: AbortSignal): Promise<VerificationCheck> {
    signal.throwIfAborted()
    return new Promise((resolve) => {
      const started = Date.now(); let output = ''; let settled = false
      const invocation = verificationCommand(command)
      const child = spawn(invocation.command, invocation.args, { cwd: workspace, env: process.env, detached: process.platform !== 'win32', windowsVerbatimArguments: process.platform === 'win32' })
      const terminate = () => terminateProcessTree(child)
      signal.addEventListener('abort', terminate, { once: true })
      const append = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-24000) }
      child.stdout?.on('data', append); child.stderr?.on('data', append)
      const timer = setTimeout(() => { terminate(); finish(null, false, `${output}\n[timeout]`) }, timeoutSeconds * 1000)
      const finish = (exitCode: number | null, passed: boolean, finalOutput = output) => {
        if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', terminate)
        resolve({ command, exitCode, passed, durationMs: Date.now() - started, output: finalOutput.trim() })
      }
      child.on('error', (error) => finish(null, false, `${output}\n${error.message}`))
      child.on('close', (code) => finish(code, code === 0))
    })
  }

  private async gitCommit(workspace: string, signal: AbortSignal): Promise<string> {
    const result = await this.run(workspace, 'git rev-parse HEAD', 10, signal)
    return result.passed ? result.output.trim().split('\n').at(-1) ?? 'unknown' : 'unknown'
  }

  private async fingerprint(workspace: string): Promise<string> {
    const hash = createHash('sha256')
    try {
      hash.update(await captureGit(workspace, ['diff', '--binary', '--no-ext-diff', 'HEAD']))
      const untracked = (await captureGit(workspace, ['ls-files', '--others', '--exclude-standard', '-z'])).toString().split('\0').filter(Boolean).sort()
      for (const file of untracked) { hash.update(file); hash.update(await readFile(join(workspace, file))) }
      return hash.digest('hex')
    } catch { return 'unknown' }
  }
}

function unique(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 12) }
function safeSuggestedCommand(command: string): boolean {
  return /^(npm|pnpm|yarn|bun|cargo|go|pytest|python -m pytest|gradle|mvn|dotnet)\b/.test(command.trim()) && !/[;&|><`$]/.test(command)
}

function captureGit(workspace: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: workspace }); const chunks: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk)); child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`git ${args[0]} exited ${code}`)))
  })
}
