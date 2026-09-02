import { accessSync, constants } from 'node:fs'
import { join, win32 } from 'node:path'
import { cliSearchDirectories, isWindowsEnvironment } from './cli-environment'

type ExecutableCheck = (path: string) => boolean

export function resolveExecutable(command: 'codex' | 'claude', env: NodeJS.ProcessEnv = process.env, check: ExecutableCheck = isExecutable): string {
  const searchEntries = cliSearchDirectories(env)
  const windows = isWindowsEnvironment(env)
  const pathJoin = windows ? win32.join : join
  const names = executableNames(command, env, windows)
  for (const candidate of [...new Set(searchEntries.flatMap((entry) => names.map((name) => pathJoin(entry, name))))]) {
    if (check(candidate)) return candidate
  }
  return command
}

function executableNames(command: string, env: NodeJS.ProcessEnv, windows: boolean): string[] {
  if (!windows) return [command]
  const extensions = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((value) => value.trim().toLowerCase()).filter(Boolean)
  return [command, ...extensions.map((extension) => `${command}${extension.startsWith('.') ? extension : `.${extension}`}`)]
}

function isExecutable(path: string): boolean {
  try { accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return true }
  catch { return false }
}
