import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppSettingsView } from '../src/renderer/src/App'
import { defaultSettings } from '../src/main/storage/database'
import { settingsGroups, readRecentWorkspaces } from '../src/renderer/src/settings-navigation'

const props = {
  settings: defaultSettings('/repo'), capabilities: [], agentEnvironment: { desktops: [], skills: [], scannedAt: '' },
  onChange: () => {}, onRefreshEnvironment: () => {}, onDesktop: () => {}, onProbeMemory: () => {}, onSetupTencentDb: () => {}, notice: ''
}

describe('settings navigation', () => {
  it('opens the connectors group without rendering every other settings form below it', () => {
    const html = renderToStaticMarkup(createElement(AppSettingsView, props))
    expect(html).toContain('id="settings-connectors"')
    expect(html).toContain('CLI、Desktop、API 与模型连接')
    expect(html).toContain('Codex CLI连接状态')
    expect(html).not.toContain('自定义 API 模型')
    expect(html).not.toContain('独立验证门禁默认值')
    expect(html).not.toContain('长期记忆设置')
  })

  it.each([
    ['role-workflow-settings', '并行与成员'],
    ['settings-verification', '固定命令'],
    ['settings-approvals', '最低置信度'],
    ['settings-memory', '记忆 Provider']
  ] as const)('keeps the %s controls reachable without unrelated forms', (section, control) => {
    const html = renderToStaticMarkup(createElement(AppSettingsView, { ...props, section }))
    expect(html.includes(control)).toBe(true)
    expect(html.includes('id="settings-connectors"')).toBe(false)
    expect(html.includes('aria-current="page"')).toBe(true)
    for (const group of settingsGroups) {
      if (group.id !== section) expect(html.includes(`id="${group.id}"`)).toBe(false)
    }
  })

  it('retains recent empty projects, ignoring corrupted history', () => {
    expect(readRecentWorkspaces({ getItem: () => '["/a","/b","/a",null,4]' })).toEqual(['/a', '/b'])
    expect(readRecentWorkspaces({ getItem: () => 'invalid' })).toEqual([])
  })
})
