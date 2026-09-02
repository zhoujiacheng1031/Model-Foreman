import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProcessExecutor } from '../src/main/executors/process-executor'
import type { ExecuteRequest } from '../src/main/executors/types'

class CliHarness extends ProcessExecutor {
  execute(command: string, request: ExecuteRequest) { return this.runProcess(command, [], request) }
  protected extractOutput(raw: string) { return raw.trim() }
}

describe('ProcessExecutor GUI environment', () => {
  it('runs an env-node CLI when the desktop PATH is minimal', async () => {
    const home = await mkdtemp(join(tmpdir(), 'foreman-gui-env-'))
    const cliDirectory = join(home, '.local', 'bin')
    const nodeDirectory = join(home, '.nvm', 'versions', 'node', 'v22.0.0', 'bin')
    await Promise.all([mkdir(cliDirectory, { recursive:true }), mkdir(nodeDirectory, { recursive:true })])
    const cli = join(cliDirectory, 'codex')
    const node = join(nodeDirectory, 'node')
    await writeFile(cli, '#!/usr/bin/env node\nconsole.log("runtime-ok")\n')
    await writeFile(node, '#!/bin/sh\nprintf \'runtime-ok\\n\'\n')
    await Promise.all([chmod(cli, 0o755), chmod(node, 0o755)])

    const previous = { HOME:process.env.HOME, PATH:process.env.PATH }
    process.env.HOME = home; process.env.PATH = '/usr/bin:/bin'
    try {
      const request: ExecuteRequest = {
        runId:'gui-path', role:'planner', model:'test', effort:'medium', prompt:'', workspace:home, emit:()=>{}
      }
      await expect(new CliHarness().execute(cli, request)).resolves.toMatchObject({ output:'runtime-ok', exitCode:0 })
    } finally {
      if (previous.HOME === undefined) delete process.env.HOME; else process.env.HOME = previous.HOME
      if (previous.PATH === undefined) delete process.env.PATH; else process.env.PATH = previous.PATH
      await rm(home, { recursive:true, force:true })
    }
  })

  it('does not present the non-fatal Codex model refresh timeout as a task error', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'foreman-codex-warning-'))
    const cli = join(folder, 'codex-warning')
    await writeFile(cli, '#!/bin/sh\necho "2026-08-12T08:46:18Z ERROR codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit" >&2\necho ok\n')
    await chmod(cli, 0o755)
    const events: Array<{kind:string;message:string}> = []
    try {
      const request: ExecuteRequest = { runId:'warning', role:'planner', model:'test', effort:'medium', prompt:'', workspace:folder, emit:(event)=>events.push(event) }
      await expect(new CliHarness().execute(cli, request)).resolves.toMatchObject({ output:'ok', exitCode:0 })
      expect(events).toContainEqual(expect.objectContaining({ kind:'status', message:'Codex 后台模型列表刷新超时；当前任务仍在继续。' }))
      expect(events.some((event) => event.kind === 'stderr' && event.message.includes('codex_models_manager'))).toBe(false)
    } finally { await rm(folder, { recursive:true, force:true }) }
  })
})
