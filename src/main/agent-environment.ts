import { access, readFile, readdir, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve, win32 } from 'node:path'
import { promisify } from 'node:util'
import type { AgentEnvironment, AgentSkill, DesktopCapability, ExecutorKind, SkillScope } from '../shared/contracts'

interface EnvironmentOptions {
  home?: string
  applicationRoots?: string[]
  adminCodexRoot?: string
}

interface SkillLocation {
  provider: ExecutorKind
  root: string
  scope: SkillScope
  format: 'directory' | 'command'
  maxDepth?: number
}

const execFileAsync = promisify(execFile)

export class AgentEnvironmentService {
  private readonly home: string
  private readonly applicationRoots: string[]
  private readonly adminCodexRoot: string

  constructor(options: EnvironmentOptions = {}) {
    this.home = options.home ?? homedir()
    this.applicationRoots = options.applicationRoots ?? defaultApplicationRoots(this.home)
    this.adminCodexRoot = options.adminCodexRoot ?? '/etc/codex/skills'
  }

  async inspect(workspace: string): Promise<AgentEnvironment> {
    const [desktops, skills] = await Promise.all([this.probeDesktops(), this.discoverSkills(workspace)])
    return { desktops, skills, scannedAt: new Date().toISOString() }
  }

  async probeDesktops(): Promise<DesktopCapability[]> {
    return Promise.all([
      this.probeDesktop('codex', ['ChatGPT.app', 'Codex.app', 'ChatGPT.exe', 'Codex.exe', 'ChatGPT.lnk', 'Codex.lnk']),
      this.probeDesktop('claude', ['Claude.app', 'Claude.exe', 'Claude.lnk'])
    ])
  }

  async desktop(kind: ExecutorKind): Promise<DesktopCapability> {
    const desktops = await this.probeDesktops()
    return desktops.find((item) => item.kind === kind)!
  }

  async discoverSkills(workspace: string): Promise<AgentSkill[]> {
    const locations = await this.skillLocations(resolve(workspace))
    const [discoveredRows, visibility] = await Promise.all([
      Promise.all(locations.map((location) => this.scanLocation(location))),
      this.skillVisibility(resolve(workspace))
    ])
    const discovered = discoveredRows.flat().map((skill) => ({
      ...skill,
      enabled: skill.provider === 'codex'
        ? !visibility.disabledCodexPaths.has(resolve(skill.path))
        : claudeSkillEnabled(skill, visibility.claudeOverrides, visibility.disabledClaudePlugins)
    }))
    const unique = [...new Map(discovered.map((skill) => [skill.id, skill])).values()]
    const counts = new Map<string, number>()
    for (const skill of unique) {
      const key = `${skill.provider}:${skill.invocation}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return unique
      .map((skill) => ({ ...skill, conflict: (counts.get(`${skill.provider}:${skill.invocation}`) ?? 0) > 1 }))
      .sort((a, b) => providerRank(a.provider) - providerRank(b.provider) || scopeRank(a.scope) - scopeRank(b.scope) || a.name.localeCompare(b.name))
  }

  private async probeDesktop(kind: ExecutorKind, appNames: string[]): Promise<DesktopCapability> {
    for (const root of this.applicationRoots) {
      for (const appName of appNames) {
        const appPath = join(root, appName)
        if (await exists(appPath)) {
          return {
            kind, installed: true, appName: appName.replace(/\.(?:app|exe|lnk)$/i, ''), appPath,
            handoff: kind === 'claude' ? 'cli-session' : 'launcher',
            message: kind === 'claude' ? '可打开 Desktop；交互式 CLI 会话支持 /desktop 接管' : '可打开 Desktop；自动任务继续由 SDK/CLI 执行'
          }
        }
      }
    }
    const store = await windowsStoreDesktop(kind)
    if (store) return store
    return {
      kind, installed: false, appName: kind === 'codex' ? 'ChatGPT / Codex' : 'Claude', appPath: '',
      handoff: kind === 'claude' ? 'cli-session' : 'launcher', message: '未在系统应用目录中检测到'
    }
  }

  private async skillLocations(workspace: string): Promise<SkillLocation[]> {
    const ancestors = await projectAncestors(workspace)
    const projectLocations = ancestors.flatMap((folder) => [
      { provider: 'codex' as const, root: join(folder, '.agents', 'skills'), scope: 'project' as const, format: 'directory' as const },
      { provider: 'claude' as const, root: join(folder, '.claude', 'skills'), scope: 'project' as const, format: 'directory' as const },
      { provider: 'claude' as const, root: join(folder, '.claude', 'commands'), scope: 'compatibility' as const, format: 'command' as const }
    ])
    return [
      ...projectLocations,
      { provider: 'codex', root: join(this.home, '.agents', 'skills'), scope: 'user', format: 'directory' },
      { provider: 'codex', root: join(this.home, '.codex', 'skills'), scope: 'compatibility', format: 'directory' },
      { provider: 'codex', root: join(this.home, '.codex', 'plugins', 'cache'), scope: 'plugin', format: 'directory', maxDepth: 7 },
      { provider: 'codex', root: this.adminCodexRoot, scope: 'admin', format: 'directory' },
      { provider: 'claude', root: join(this.home, '.claude', 'skills'), scope: 'user', format: 'directory' },
      { provider: 'claude', root: join(this.home, '.claude', 'commands'), scope: 'compatibility', format: 'command' },
      { provider: 'claude', root: join(this.home, '.claude', 'plugins', 'cache'), scope: 'plugin', format: 'directory', maxDepth: 7 }
    ]
  }

  private async skillVisibility(workspace: string) {
    const disabledCodexPaths = new Set<string>()
    try {
      const source = await readFile(join(this.home, '.codex', 'config.toml'), 'utf8')
      for (const match of source.matchAll(/\[\[skills\.config\]\]([\s\S]*?)(?=\n\[\[|$)/g)) {
        const block = match[1]
        if (!/enabled\s*=\s*false/.test(block)) continue
        const path = block.match(/path\s*=\s*["']([^"']+)["']/)?.[1]
        if (path) disabledCodexPaths.add(resolve(path.replace(/^~(?=\/)/, this.home)))
      }
    } catch { /* Config is optional. */ }

    const claudeOverrides = new Map<string, string>()
    const disabledClaudePlugins = new Set<string>()
    const ancestors = (await projectAncestors(workspace)).reverse()
    const settingsFiles = [join(this.home, '.claude', 'settings.json'), ...ancestors.flatMap((folder) => [join(folder, '.claude', 'settings.json'), join(folder, '.claude', 'settings.local.json')])]
    for (const path of settingsFiles) {
      try {
        const value = JSON.parse(await readFile(path, 'utf8')) as { skillOverrides?: Record<string, string>; enabledPlugins?: Record<string, boolean> }
        for (const [name, state] of Object.entries(value.skillOverrides ?? {})) claudeOverrides.set(name, state)
        for (const [name, enabled] of Object.entries(value.enabledPlugins ?? {})) {
          const plugin = name.split('@')[0]
          if (enabled) disabledClaudePlugins.delete(plugin); else disabledClaudePlugins.add(plugin)
        }
      } catch { /* Ignore missing or temporarily invalid third-party settings. */ }
    }
    return { disabledCodexPaths, claudeOverrides, disabledClaudePlugins }
  }

  private async scanLocation(location: SkillLocation): Promise<AgentSkill[]> {
    if (!await exists(location.root)) return []
    const files = location.format === 'command'
      ? (await filesAtRoot(location.root)).filter((file) => extname(file) === '.md')
      : await findNamedFiles(location.root, 'SKILL.md', location.maxDepth ?? 3)
    const skills: AgentSkill[] = []
    for (const path of files) {
      try {
        const source = await readFile(path, 'utf8')
        const metadata = frontmatter(source)
        const fallback = location.format === 'command' ? basename(path, extname(path)) : basename(dirname(path))
        const name = metadata.name || fallback
        const pluginName = location.scope === 'plugin' ? inferPluginName(location.root, path) : ''
        const invocationName = pluginName ? `${pluginName}:${name}` : name
        skills.push({
          id: `${location.provider}:${resolve(path)}`, provider: location.provider, name,
          description: metadata.description || firstParagraph(source) || '未提供说明',
          invocation: location.provider === 'codex' ? `$${invocationName}` : `/${invocationName}`,
          scope: location.scope, path: resolve(path), enabled: true, conflict: false
        })
      } catch { /* Ignore unreadable third-party skills while keeping the rest discoverable. */ }
    }
    return skills
  }
}

async function projectAncestors(workspace: string): Promise<string[]> {
  const rows: string[] = []
  let current = workspace
  for (;;) {
    rows.push(current)
    if (await exists(join(current, '.git'))) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return rows
}

async function findNamedFiles(root: string, target: string, maxDepth: number, depth = 0): Promise<string[]> {
  if (depth > maxDepth) return []
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return [] }
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isFile() && entry.name === target) files.push(path)
    else if (entry.isDirectory() || entry.isSymbolicLink()) {
      try { if ((await stat(path)).isDirectory()) files.push(...await findNamedFiles(path, target, maxDepth, depth + 1)) } catch { /* broken symlink */ }
    }
  }
  return files
}

async function filesAtRoot(root: string): Promise<string[]> {
  try { return (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => join(root, entry.name)) }
  catch { return [] }
}

function frontmatter(source: string): Record<string, string> {
  if (!source.startsWith('---')) return {}
  const end = source.indexOf('\n---', 3)
  if (end < 0) return {}
  const result: Record<string, string> = {}
  for (const line of source.slice(3, end).split('\n')) {
    const match = line.match(/^([\w-]+):\s*(.+)$/)
    if (match) result[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return result
}

function firstParagraph(source: string): string {
  const body = source.startsWith('---') ? source.slice(source.indexOf('\n---', 3) + 4) : source
  return body.split(/\n\s*\n/).map((part) => part.replace(/^#+\s*/gm, '').trim()).find(Boolean)?.slice(0, 240) ?? ''
}

function inferPluginName(root: string, path: string): string {
  const relative = path.slice(root.length + 1).split(/[\\/]/).filter(Boolean)
  const skillsIndex = relative.lastIndexOf('skills')
  if (skillsIndex > 0) {
    const parent = relative[skillsIndex - 1]
    if (/^v?\d+(?:\.\d+){1,}/.test(parent) && skillsIndex > 1) return relative[skillsIndex - 2]
    return parent
  }
  return ''
}

function scopeRank(scope: SkillScope): number { return ({ project: 0, user: 1, plugin: 2, admin: 3, compatibility: 4 })[scope] }
function providerRank(provider: ExecutorKind): number { return provider === 'codex' ? 0 : 1 }
function claudeSkillEnabled(skill: AgentSkill, overrides: Map<string, string>, disabledPlugins: Set<string>): boolean {
  const invocation = skill.invocation.slice(1)
  if (skill.scope === 'plugin') return !disabledPlugins.has(invocation.split(':')[0])
  const state = overrides.get(invocation) ?? overrides.get(skill.name)
  return state !== 'off'
}
async function exists(path: string): Promise<boolean> { try { await access(path); return true } catch { return false } }

function defaultApplicationRoots(home: string): string[] {
  if (process.platform !== 'win32') return ['/Applications', join(home, 'Applications')]
  const local = process.env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local')
  const roaming = process.env.APPDATA || win32.join(home, 'AppData', 'Roaming')
  return [
    win32.join(local, 'Microsoft', 'WindowsApps'),
    win32.join(local, 'Programs', 'ChatGPT'),
    win32.join(local, 'Programs', 'Codex'),
    win32.join(local, 'Programs', 'Claude'),
    win32.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ]
}

async function windowsStoreDesktop(kind: ExecutorKind): Promise<DesktopCapability | null> {
  if (process.platform !== 'win32') return null
  const pattern = kind === 'codex' ? '(OpenAI.*(ChatGPT|Codex)|(ChatGPT|Codex).*OpenAI)' : '(Anthropic.*Claude|Claude.*Anthropic)'
  const script = `$p=Get-AppxPackage | Where-Object { $_.Name -match '${pattern}' } | Select-Object -First 1; if($p){$p.PackageFamilyName}`
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 3500, windowsHide: true })
    const family = stdout.trim().split(/\r?\n/).at(-1)?.trim()
    if (!family) return null
    return {
      kind, installed: true, appName: kind === 'codex' ? 'ChatGPT / Codex' : 'Claude',
      appPath: `shell:AppsFolder\\${family}!App`, handoff: kind === 'claude' ? 'cli-session' : 'launcher',
      message: kind === 'claude' ? '已检测到 Windows Store Desktop；交互式 CLI 会话支持接管' : '已检测到 Windows Store Desktop；自动任务继续由 SDK/CLI 执行'
    }
  } catch { return null }
}
