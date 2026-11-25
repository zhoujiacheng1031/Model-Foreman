import { useState, type ReactNode } from 'react'
import { Activity, ChevronRight, LoaderCircle, Monitor, Puzzle, RefreshCw, TerminalSquare } from 'lucide-react'
import type { AgentEnvironment, AppSettings, ExecutorCapability, ExecutorKind, ModelCapabilityScan } from '../../shared/contracts'
import { effortLabel, executorLabel, modelLabel } from '../../shared/executors'
import { ExecutorLogo, ExecutorPicker } from './executor-picker'
import { executorReadiness, modelReadiness } from './runtime-readiness'
import { selectableModelCatalog } from './model-capabilities'

export function ConnectorsView({ kind, onSelect, settings, capabilities, environment, scan, checking, checkingKind, scanError, onScan, onRefresh, onDesktop, onWorkflow, onCatalog, customEditor, notice }: {
  kind: ExecutorKind; onSelect: (kind: ExecutorKind) => void
  settings: AppSettings; capabilities: ExecutorCapability[]; environment: AgentEnvironment; scan: ModelCapabilityScan | null
  checking: boolean; checkingKind: ExecutorKind | null; scanError: string; onScan: (kind: ExecutorKind) => void
  onRefresh: () => void | Promise<void>; onDesktop: (kind: ExecutorKind) => void; onWorkflow: () => void
  onCatalog: (kind: ExecutorKind, value: string) => void; customEditor: ReactNode; notice?: string
}) {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const capability = capabilities.find((item) => item.kind === kind)
  const desktop = environment.desktops.find((item) => item.kind === kind)
  const skills = environment.skills.filter((item) => item.provider === kind && item.enabled)
  const readiness = executorReadiness(kind, capabilities)
  const models = selectableModelCatalog(settings, scan, kind)
  async function refresh() {
    setRefreshing(true); setRefreshError('')
    try { await onRefresh() }
    catch { setRefreshError('状态刷新失败，已保留上次结果。请稍后重试。') }
    finally { setRefreshing(false) }
  }
  return <section className="connectors-view" id="settings-connectors" aria-label="连接器">
    <div className="connector-toolbar"><p>集中管理客户端、认证与模型连接。模型检测会发送请求并产生用量。</p><button className="quiet-button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{refreshing ? '刷新中…' : '刷新状态'}</button></div>
    {refreshError && <p className="connector-feedback error" role="alert">{refreshError}</p>}
    <ExecutorPicker label="查看连接器" heading="连接器" value={kind} onChange={onSelect} customAvailable />
    {kind === 'custom' ? customEditor : <>
      <article className="connector-detail" aria-label={`${executorLabel(kind)}连接状态`}>
        <header className="connector-heading"><span className="connector-brand"><ExecutorLogo kind={kind} /><span><h2>{executorLabel(kind)}</h2><small>客户端与认证</small></span></span><span className={`connection-badge ${readiness.state}`}>{readiness.label}</span></header>
        <div className="connector-facts">
          <div><TerminalSquare size={17} /><span><b>CLI</b><small>{capability?.installed ? capability.version : '安装对应 CLI 后刷新状态'}</small></span><strong className={capability?.installed ? 'available' : 'unavailable'}>{capability?.installed ? '已安装' : capability ? '未安装' : '待检查'}</strong></div>
          <div><Activity size={17} /><span><b>账户认证</b><small>{readiness.detail}</small></span><strong className={capability?.authenticated ? 'available' : 'pending'}>{!capability?.installed ? '待检查' : capability.authenticated === true ? '已登录' : capability.authenticated === false ? '未登录' : '待预检'}</strong></div>
          <div><Monitor size={17} /><span><b>Desktop</b><small>{desktop?.installed ? '打开客户端并复制接管提示' : '安装桌面客户端后可打开'}</small></span><strong className={desktop?.installed ? 'available' : 'pending'}>{desktop?.installed ? '已安装' : '未检测到'}</strong><button className="quiet-button" disabled={!desktop?.installed} onClick={() => onDesktop(kind)}>打开 Desktop</button></div>
        </div>
        {notice && !/保存|待完善/.test(notice) && <p className="connector-action-notice" role="status">{notice}</p>}
        <details className="connector-diagnostics"><summary>安装路径与认证诊断</summary><dl><dt>CLI 路径</dt><dd>{capability?.executable || '未检测到'}</dd><dt>Desktop 路径</dt><dd>{desktop?.appPath || '未检测到'}</dd></dl><pre>{capability?.authenticationMessage || '暂无认证诊断，请刷新状态'}</pre></details>
      </article>
      <section className="connector-models" aria-label={`${executorLabel(kind)}模型连接`}>
        <header><span><h3>模型连接</h3><p>下方记录表示上次检测结果，任务开始前仍会预检。</p></span><button className="quiet-button" disabled={checking || !capability?.installed || !models.length} onClick={() => onScan(kind)}>{checking ? <LoaderCircle className="spin" size={14} /> : <Activity size={14} />}{checking ? checkingKind === kind ? '检测中…' : '其他连接器检测中…' : '检测此连接器'}</button></header>
        {scanError && <p className="connector-feedback error" role="alert">{scanError}</p>}
        {!models.length && <p className="connector-empty">暂无候选模型，可在高级配置中添加。</p>}
        <div className="connector-model-list">{models.map((model) => {
          const result = scan?.models.find((item) => item.kind === kind && item.model === model.id)
          const status = modelReadiness(settings, capabilities, scan, kind, model.id)
          return <article key={model.id}><span><b>{modelLabel(model.id) === model.id ? model.label : modelLabel(model.id)}</b><small>{kind === 'zcode' ? '模型与推理选项由 ZCode 原生配置管理' : model.id}</small></span><span className="connector-model-state"><em className={`connection-badge ${status.state}`} title={status.detail}>{status.label}</em><small>{result ? `上次检测 ${new Date(result.checkedAt ?? scan!.checkedAt).toLocaleString('zh-CN')}` : '尚无检测记录'}</small></span><div className="connector-efforts"><small>{result ? '上次检测通过的强度' : '候选强度（未验证）'}</small>{(result?.supportedEfforts ?? model.efforts).map((effort) => <i key={effort}>{effortLabel(effort)}</i>)}</div>{result && result.availability === 'unavailable' && <p className="connector-model-error">{result.message}</p>}</article>
        })}</div>
        {(kind === 'codex' || kind === 'claude') && <details className="connector-catalog"><summary>高级配置 · 候选模型目录</summary><label><span>每行：模型 ID | 显示名称 | 支持强度</span><textarea disabled={checking} aria-label={`${executorLabel(kind)}候选模型`} value={settings.models[kind].map((model) => `${model.id} | ${model.label} | ${model.efforts.join(',')}`).join('\n')} onChange={(event) => onCatalog(kind, event.target.value)} /></label></details>}
      </section>
      <details className="connector-skills"><summary><Puzzle size={15} />{kind === 'zcode' ? 'Skill 由 ZCode 自身管理' : `可发现 Skill · ${skills.length}`}</summary>{kind !== 'zcode' && skills.map((skill) => <div key={skill.id}><b>{skill.invocation}</b><small>{skill.description}</small></div>)}<button className="connector-link" onClick={onWorkflow}>前往角色与流程分配 <ChevronRight size={13} /></button></details>
    </>}
  </section>
}
