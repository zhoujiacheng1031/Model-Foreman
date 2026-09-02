import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const modelEnvironmentKeys = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL'
] as const

/**
 * Reads only model identifiers from Claude Code's active configuration.
 * Only whitelisted model fields are retained and returned; credentials and the
 * CC-Switch database are never accessed by this discovery routine.
 */
export async function discoverClaudeModelIds(home = homedir(), workspace = process.cwd()): Promise<string[]> {
  const values: string[] = []
  for (const path of claudeSettingsFiles(home, workspace)) {
    try {
      const settings = JSON.parse(await readFile(path, 'utf8')) as {
        model?: unknown
        modelOverrides?: Record<string, unknown>
        env?: Record<string, unknown>
      }
      if (typeof settings.model === 'string') values.push(settings.model)
      for (const value of Object.values(settings.modelOverrides ?? {})) if (typeof value === 'string') values.push(value)
      for (const key of modelEnvironmentKeys) {
        const value = settings.env?.[key]
        if (typeof value === 'string') values.push(value)
        const displayName = settings.env?.[`${key}_NAME`]
        if (typeof displayName === 'string') values.push(displayName)
      }
    } catch { /* Missing or temporarily invalid third-party configuration is non-fatal. */ }
  }
  return [...new Set(values.map(normalizeModelId).filter(Boolean))]
}

function claudeSettingsFiles(home: string, workspace: string): string[] {
  const directories = [join(home, '.claude')]
  let current = resolve(workspace)
  for (;;) {
    directories.push(join(current, '.claude'))
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return [...new Set(directories.flatMap((directory) => [join(directory, 'settings.json'), join(directory, 'settings.local.json')]))]
}

function normalizeModelId(value: string): string {
  return value.trim().replace(/\s*\[1m\]\s*$/i, '').trim()
}
