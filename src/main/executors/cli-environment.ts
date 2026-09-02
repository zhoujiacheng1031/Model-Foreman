import { readdirSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, win32 } from 'node:path'

/** Builds a deterministic GUI-safe PATH without invoking the user's shell. */
export function buildCliEnvironment(env: NodeJS.ProcessEnv = process.env, executables: string[] = []): NodeJS.ProcessEnv {
  const windows = isWindowsEnvironment(env)
  const pathApi = windows ? win32 : { dirname, isAbsolute }
  const preferred = executables.map((path) => pathApi.dirname(path)).filter((path) => pathApi.isAbsolute(path))
  return { ...env, PATH: unique([...preferred, ...cliSearchDirectories(env)]).join(windows ? ';' : delimiter) }
}

/** Makes non-executor child processes (git, gh and verification commands) use the same PATH. */
export function configureCliEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  env.PATH = buildCliEnvironment(env).PATH
}

export function cliSearchDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  const windows = isWindowsEnvironment(env)
  const pathJoin = windows ? win32.join : join
  const home = env.HOME || env.USERPROFILE || ''
  const configured = (env.PATH ?? '').split(windows ? ';' : delimiter).filter(Boolean)
  const explicit = [env.NVM_BIN, env.PNPM_HOME, env.VOLTA_HOME && pathJoin(env.VOLTA_HOME, 'bin'), env.FNM_MULTISHELL_PATH && pathJoin(env.FNM_MULTISHELL_PATH, 'bin')]
  const common = windows ? [
    env.APPDATA && pathJoin(env.APPDATA, 'npm'),
    env.LOCALAPPDATA && pathJoin(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'),
    env.LOCALAPPDATA && pathJoin(env.LOCALAPPDATA, 'Programs', 'nodejs'),
    env.LOCALAPPDATA && pathJoin(env.LOCALAPPDATA, 'Volta', 'bin'),
    home && pathJoin(home, 'AppData', 'Roaming', 'npm'),
    home && pathJoin(home, '.local', 'bin'),
    home && pathJoin(home, '.volta', 'bin')
  ] : [
    '/opt/homebrew/bin', '/usr/local/bin',
    home && pathJoin(home, '.local', 'bin'),
    home && pathJoin(home, '.npm-global', 'bin'),
    home && pathJoin(home, '.volta', 'bin'),
    home && pathJoin(home, '.asdf', 'shims'),
    home && pathJoin(home, '.local', 'share', 'mise', 'shims'),
    home && pathJoin(home, '.nvm', 'current', 'bin')
  ]
  const managed = home ? [
    ...versionBins(pathJoin(home, '.nvm', 'versions', 'node'), 'bin', pathJoin),
    ...versionBins(pathJoin(home, '.local', 'share', 'fnm', 'node-versions'), pathJoin('installation', 'bin'), pathJoin),
    ...versionBins(pathJoin(home, '.fnm', 'node-versions'), pathJoin('installation', 'bin'), pathJoin)
  ] : []
  return unique([...configured, ...explicit, ...common, ...managed].filter((entry): entry is string => Boolean(entry)))
}

export function isWindowsEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OS === 'Windows_NT' || Boolean(env.PATHEXT) || /^[A-Za-z]:[\\/]/.test(env.USERPROFILE ?? '')
}

function versionBins(root: string, suffix: string, pathJoin: (...paths: string[]) => string = join): string[] {
  try {
    return readdirSync(root, { withFileTypes:true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric:true }))
      .map((version) => pathJoin(root, version, suffix))
  } catch { return [] }
}

function unique(entries: string[]): string[] { return [...new Set(entries)] }
