import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TencentDbSetupService } from '../src/main/memory/tencentdb-setup'

describe('TencentDbSetupService', () => {
  it('stops before filesystem or terminal changes when Docker is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'foreman-tencentdb-missing-'))
    const run = vi.fn(async (command: string) => {
      if (command === 'docker') throw new Error('ENOENT')
      return { stdout: 'git version 2.0', stderr: '' }
    })
    const launch = vi.fn(async () => {})

    const result = await new TencentDbSetupService(root, run, launch).prepareAndLaunch()

    expect(result).toMatchObject({ ok: false, stage: 'prerequisite_missing' })
    expect(result.message).toContain('Docker')
    expect(launch).not.toHaveBeenCalled()
  })

  it('reuses a prepared official repository and launches a constant audited wrapper', async () => {
    const root = await mkdtemp(join(tmpdir(), 'foreman-tencentdb-ready-'))
    const deploy = join(root, 'TencentDB-Agent-Memory', 'deploy', 'global-images')
    await mkdir(join(root, 'TencentDB-Agent-Memory', '.git'), { recursive: true })
    await mkdir(deploy, { recursive: true })
    await writeFile(join(deploy, 'start-all.sh'), '#!/usr/bin/env bash\n')
    const run = vi.fn(async (_command: string, _args: string[]) => ({ stdout: 'ready', stderr: '' }))
    const launch = vi.fn(async () => {})

    const result = await new TencentDbSetupService(root, run, launch).prepareAndLaunch()

    expect(result).toMatchObject({ ok: true, stage: 'terminal_opened', endpoint: 'http://127.0.0.1:8420' })
    expect(run).toHaveBeenCalledWith('git', ['--version'])
    expect(run).toHaveBeenCalledWith('docker', ['version', '--format', '{{.Server.Version}}'])
    expect(run.mock.calls.some((call) => call[1]?.[0] === 'clone')).toBe(false)
    const launcher = join(root, 'configure-tencentdb-memory.command')
    expect(await readFile(launcher, 'utf8')).toContain('exec ./start-all.sh')
    expect(launch).toHaveBeenCalledWith(launcher, deploy)
  })
})
