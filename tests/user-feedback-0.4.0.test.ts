import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExecutable } from '../src/main/executors/executable-locator'
import { commandInvocation } from '../src/main/executors/command-launch'
import { discoverClaudeModelIds } from '../src/main/executors/claude-model-discovery'
import { AgentEnvironmentService } from '../src/main/agent-environment'
import { selectableModelCatalog } from '../src/renderer/src/model-capabilities'
import { defaultSettings } from '../src/main/storage/database'
import type { ModelCapabilityScan } from '../src/shared/contracts'

describe('0.4.0 user feedback regressions', () => {
  it('finds a Codex npm shim installed for the current Windows user', () => {
    const profile = 'C:\\Users\\tester'
    const appData = win32.join(profile, 'AppData', 'Roaming')
    const codexShim = win32.join(appData, 'npm', 'codex.cmd')

    expect(resolveExecutable('codex', {
      USERPROFILE: profile,
      APPDATA: appData,
      PATH: 'C:\\Windows\\System32;C:\\Windows',
      PATHEXT: '.COM;.EXE;.BAT;.CMD'
    }, (path) => path === codexShim)).toBe(codexShim)

    const invocation = commandInvocation(codexShim, ['--version'], { PATHEXT: '.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' })
    expect(invocation.command).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(invocation.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
  })

  it('keeps a model discovered through a CC-Switch alias even when it was not in defaults', () => {
    const settings = defaultSettings('/repo')
    const scan: ModelCapabilityScan = {
      checkedAt: new Date().toISOString(),
      models: [{
        kind: 'claude', model: 'glm-5.3', roles: ['implementer'], availability: 'available',
        supportedEfforts: ['low', 'medium', 'high'], checks: [], message: 'available through CC-Switch'
      }]
    }

    expect(selectableModelCatalog(settings, scan, 'claude').map((model) => model.id)).toContain('glm-5.3')
  })

  it('reads the active CC-Switch Opus and Fable mappings without exposing credentials', async () => {
    const home = await mkdtemp(join(tmpdir(), 'foreman-cc-switch-'))
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: 'must-not-be-read',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3[1M]',
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'glm-5.3',
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'glm-5.3[1M]'
      }
    }))

    expect(await discoverClaudeModelIds(home, '/repo')).toEqual(['glm-5.3'])
  })

  it('detects the Windows ChatGPT/Codex desktop launcher', async () => {
    const root = await mkdtemp(join(tmpdir(), 'foreman-windows-app-'))
    const apps = join(root, 'WindowsApps')
    await mkdir(apps, { recursive: true })
    await writeFile(join(apps, 'ChatGPT.exe'), '')

    const desktop = await new AgentEnvironmentService({ home: root, applicationRoots: [apps] }).desktop('codex')
    expect(desktop.installed).toBe(true)
    expect(desktop.appPath).toContain('ChatGPT.exe')
  })

  it('ships an actionable TencentDB setup guide instead of a bare configuration form', async () => {
    const app = await readFile(join(process.cwd(), 'src', 'renderer', 'src', 'App.tsx'), 'utf8')

    expect(app).toContain('TencentDB 配置向导')
    expect(app).toContain('自动检查与准备')
    expect(app).toContain('一键配置并启动')
    expect(app).toContain('验证连接')
    expect(app).toContain('Gateway Token 环境变量')
    expect(app).toContain('完整检测目录')
  })
})
