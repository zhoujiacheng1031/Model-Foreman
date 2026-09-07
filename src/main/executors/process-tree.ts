import { execFile, type ChildProcess } from 'node:child_process'

/** Stop the shell and its harness descendants, preserving other runs. */
export function terminateProcessTree(child: ChildProcess, platform = process.platform): void {
  if (!child.pid) return
  if (platform === 'win32') {
    execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
      if (error && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    })
    return
  }
  try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
}

export function verificationCommand(command: string, platform = process.platform): { command: string; args: string[] } {
  return platform === 'win32'
    ? { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
    : { command: '/bin/zsh', args: ['-lc', command] }
}
