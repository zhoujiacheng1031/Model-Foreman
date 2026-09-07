import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawn, execFile } from 'node:child_process'
import { terminateProcessTree, verificationCommand } from '../src/main/executors/process-tree'

vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), execFile: vi.fn() }))
afterEach(() => vi.clearAllMocks())
describe('Windows process boundaries', () => {
  it('targets the selected PID and its descendants with taskkill', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},10000)'])
    try {
      terminateProcessTree(child, 'win32')
      expect(execFile).toHaveBeenCalledWith('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, expect.any(Function))
    } finally { child.kill(); await new Promise((resolve) => child.once('close', resolve)) }
  })
  it('preserves the verification command as one shell argument on each platform', () => {
    const command = 'npm run test -- --run "test file.ts"'
    expect(verificationCommand(command, 'win32').args).toEqual(['/d', '/s', '/c', command])
    expect(verificationCommand(command, 'win32').command).toMatch(/cmd\.exe$/i)
    expect(verificationCommand(command, 'darwin')).toEqual({ command: '/bin/zsh', args: ['-lc', command] })
  })
})

it.runIf(process.platform === 'win32')('terminates a real Windows shell and its Node descendants', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  vi.mocked(execFile).mockImplementation(actual.execFile)
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'foreman-tree-'))
  const script = join(root, 'parent.cjs')
  writeFileSync(script, `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); console.log('descendant:'+c.pid); setInterval(()=>{},1000);`)
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${process.execPath}" "${script}""`], { windowsVerbatimArguments: true })
  const closed = new Promise((resolve) => child.once('close', resolve))
  try {
    const pid = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('descendant startup timeout')), 10000)
      child.stdout.on('data', (chunk) => { const match = String(chunk).match(/descendant:(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])) } })
      child.once('error', reject)
    })
    terminateProcessTree(child)
    await closed
    expect(() => process.kill(pid, 0)).toThrow()
  } finally {
    if (child.exitCode === null && child.signalCode === null) { terminateProcessTree(child); await closed }
    rmSync(root, { recursive: true, force: true })
  }
}, 20000)
