import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConnectorsView } from '../src/renderer/src/connectors'
import { defaultSettings } from '../src/main/storage/database'
import { mergeConnectorScan } from '../src/renderer/src/model-capabilities'
import { modelReadiness } from '../src/renderer/src/runtime-readiness'
import type { ExecutorCapability, ModelCapabilityScan } from '../src/shared/contracts'

const settings = defaultSettings('/repo')
const capability: ExecutorCapability = { kind: 'claude', installed: true, executable: 'claude', version: '2', authenticated: false, authenticationMessage: 'CLI installed, not logged in' }
const previous: ModelCapabilityScan = { checkedAt: '2026-10-01T00:00:00Z', models: [{kind:'claude',model:'sonnet',roles:[],availability:'available',supportedEfforts:['low'],checks:[],message:'old pass'}] }
const props = {
  settings, capabilities: [capability], environment: {desktops:[{kind:'claude' as const,installed:true,appName:'Claude',appPath:'/apps/Claude',handoff:'launcher' as const,message:''}],skills:[],scannedAt:''},
  scan: previous, checking: false, checkingKind: null, scanError: '', onSelect() {}, onScan() {}, onRefresh() {}, onDesktop() {}, onWorkflow() {}, onCatalog() {}, customEditor: createElement('div',null,'API 配置表单')
}

describe('connector status ownership', () => {
  it('separates installed CLI and Desktop from missing authentication and historical model success', () => {
    const html = renderToStaticMarkup(createElement(ConnectorsView,{...props,kind:'claude'}))
    expect(html).toContain('Claude Code连接状态')
    expect(html).toContain('账户认证')
    expect(html).toContain('未登录')
    expect(html).toContain('已安装')
    expect(html).toContain('打开 Desktop')
    expect(html).not.toContain('>上次检测通过</em>')
    expect(html).not.toContain('API 配置表单')
    expect(html).not.toContain('Codex CLI连接状态')
  })

  it('shows a native authentication check as pending rather than inventing a signed-in state', () => {
    const html = renderToStaticMarkup(createElement(ConnectorsView,{...props,kind:'zcode',capabilities:[{...capability,kind:'zcode',authenticated:undefined}]}))
    expect(html).toContain('待预检')
    expect(html).toContain('原生配置管理')
    expect(html).toContain('原生默认')
    expect(html).not.toContain('已登录')
    expect(html).not.toContain('候选模型目录')
  })

  it('opens API configuration inside the same owner without rendering unrelated native diagnostics', () => {
    const html = renderToStaticMarkup(createElement(ConnectorsView,{...props,kind:'custom'}))
    expect(html).toContain('API 配置表单')
    expect(html).not.toContain('账户认证')
    expect(html).not.toContain('打开 Desktop')
    expect(html.match(/role="radiogroup"/g)).toHaveLength(1)
  })

  it('retains the original timestamps and evidence of connectors outside a targeted scan', () => {
    const next = mergeConnectorScan(previous,{checkedAt:'2026-11-24T00:00:00Z',models:[{kind:'zcode',model:'native-default',roles:[],availability:'available',supportedEfforts:['default'],checks:[],message:'new pass'}]},'zcode')
    expect(next.models).toHaveLength(2)
    expect(next.models.find((model)=>model.kind==='claude')?.checkedAt).toBe(previous.checkedAt)
    expect(next.models.find((model)=>model.kind==='zcode')?.checkedAt).toBe(next.checkedAt)
    const current = {...capability,authenticated:true}
    expect(modelReadiness(settings,[current],next,'claude','sonnet').detail).toContain(new Date(previous.checkedAt).toLocaleString('zh-CN'))
  })
})
