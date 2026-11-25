import type { ChildProcess } from 'node:child_process'
import { CodexExecutor } from '../../src/main/executors/codex'
import { ClaudeExecutor } from '../../src/main/executors/claude'
import { terminateProcessTree } from '../../src/main/executors/process-tree'
import { ZcodeNativeExecutor } from './zcode-native'

function crash(children: Iterable<{ runId: string; child: ChildProcess }>, runId: string): boolean {
  let sent = false
  for (const entry of children) {
    if (entry.runId !== runId || !entry.child.pid) continue
    try {
      if (process.platform === 'win32') terminateProcessTree(entry.child)
      else process.kill(-entry.child.pid, 'SIGKILL')
      sent = true
    } catch { /* An already-exited process is not a successful crash injection. */ }
  }
  return sent
}

class CrashableCodex extends CodexExecutor {
  crash(runId: string) { return crash(this.children.values(), runId) }
}
class CrashableClaude extends ClaudeExecutor {
  crash(runId: string) { return crash(this.children.values(), runId) }
}
class CrashableZcode extends ZcodeNativeExecutor {
  crash(runId: string) { return crash(this.children.values(), runId) }
}
export const realCliHarness = (kind: 'codex' | 'claude' | 'zcode') => kind === 'codex' ? new CrashableCodex() : kind === 'claude' ? new CrashableClaude() : new CrashableZcode()
