import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8')

describe('custom model settings experience', () => {
  it('auto-saves settings and removes the two redundant settings save buttons', () => {
    expect(app).toContain("setNotice('正在自动保存…')")
    expect(app).toContain("setNotice('已自动保存')")
    expect(app).not.toContain("notice || '保存设置'")
    expect(app).not.toContain("notice || '保存配置'")
    expect(app).toContain('修改后自动保存')
  })

  it('checks each complete custom model with its unsaved configuration', () => {
    expect(preload).toContain("ipcRenderer.invoke('models:probe-custom', model, workspace)")
    expect(main).toContain("ipcMain.handle('models:probe-custom'")
    expect(main).toContain('new CustomApiExecutor((id) => id === model.id ? model : undefined)')
    expect(app).toContain('检测连接')
    expect(app).toContain('custom-model-check-result')
  })

  it('renders custom models, capabilities, and role flow as peer settings cards', () => {
    const workflow = app.slice(app.indexOf('function WorkflowView'), app.indexOf('function AppSettingsView'))
    expect(workflow).toContain('<section className="custom-model-settings"')
    expect(workflow).toContain('<section className="model-catalog-card" id="settings-model-catalog">')
    expect(workflow).toContain('<section className="workflow-diagram settings-workflow-settings"')
    expect(workflow).not.toContain('return (\n    <section className="settings-workflow-settings"')
  })
})
