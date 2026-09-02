import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExecutable } from '../src/main/executors/executable-locator'

describe('CLI executable locator', () => {
  it('finds user-installed CLIs when the desktop app has a minimal PATH', async () => {
    const home = await mkdtemp(join(tmpdir(), 'foreman-cli-home-'))
    const localBin = join(home, '.local', 'bin')
    await mkdir(localBin, { recursive: true })
    await writeFile(join(localBin, 'claude'), '#!/bin/sh\necho test\n')
    await chmod(join(localBin, 'claude'), 0o755)

    expect(resolveExecutable('claude', { HOME: home, PATH: '/usr/bin:/bin' })).toBe(join(localBin, 'claude'))
  })

  it('knows the standard Apple Silicon Homebrew location', () => {
    expect(resolveExecutable('codex', { HOME: '/Users/test', PATH: '/usr/bin:/bin' }, (path) => path === '/opt/homebrew/bin/codex'))
      .toBe('/opt/homebrew/bin/codex')
  })

  it('discovers CLIs installed under an NVM Node version', async () => {
    const home = await mkdtemp(join(tmpdir(), 'foreman-nvm-home-'))
    const bin = join(home, '.nvm', 'versions', 'node', 'v22.14.0', 'bin')
    await mkdir(bin, { recursive:true }); await writeFile(join(bin, 'codex'), '#!/usr/bin/env node\n'); await chmod(join(bin, 'codex'), 0o755)
    expect(resolveExecutable('codex', { HOME:home, PATH:'/usr/bin:/bin' }, (path) => path === join(bin, 'codex'))).toBe(join(bin, 'codex'))
  })

  it('does not report a Desktop-bundled executable as an installed CLI', () => {
    const desktopBinary = '/Applications/ChatGPT.app/Contents/Resources/codex'
    expect(resolveExecutable('codex', { HOME: '/Users/test', PATH: '/usr/bin:/bin' }, (path) => path === desktopBinary)).toBe('codex')
  })
})
