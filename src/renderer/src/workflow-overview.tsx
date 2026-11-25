import { GitFork, RotateCcw, ShieldCheck, ShieldOff, Workflow } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import type { AppSettings, ExecutorKind, RoleConfig, RoleKey } from '../../shared/contracts'
import { executorLabel, modelLabel } from '../../shared/executors'
import { ExecutorLogo } from './executor-picker'

/** Match initial execution dispatch: serial ignores member overrides; parallel reuses the main role when empty. */
export function workflowOverview(settings: AppSettings) {
  const policy = settings.execution ?? { maxParallelAgents: 1, agents: [] }
  const concurrency = Math.min(4, Math.max(1, Math.trunc(policy.maxParallelAgents)))
  const parallel = concurrency > 1
  const members = parallel && policy.agents.length ? policy.agents : [settings.roles.implementer]
  const harnesses = [...new Set<ExecutorKind>([settings.roles.planner.executor, ...members.map(member => member.executor), settings.roles.reviewer.executor])]
  return { parallel, concurrency, members, harnesses, reuseMain: parallel && policy.agents.length === 0, inactiveMembers: parallel ? 0 : policy.agents.length }
}

function modelName(settings: AppSettings, config: RoleConfig) {
  return settings.models[config.executor].find(model => model.id === config.model)?.label || modelLabel(config.model) || '未选择模型'
}

function ExecutorIdentity({ settings, config }: { settings: AppSettings; config: RoleConfig }) {
  const name = modelName(settings, config)
  return <div className="overview-executor"><ExecutorLogo kind={config.executor} /><div><b>{executorLabel(config.executor)}</b><small title={name}>{name}</small></div></div>
}

export type WorkflowTarget = RoleKey | 'parallel' | 'verification'

export function WorkflowOverview({ settings, onConfigure }: { settings: AppSettings; onConfigure?: (target: WorkflowTarget) => void }) {
  const [expanded, setExpanded] = useState(false)
  const overview = workflowOverview(settings)
  const approval = (role: 'planner' | 'reviewer') => settings.approvals[role].autoApprove
    ? `置信度 ≥ ${Math.round(settings.approvals[role].minConfidence * 100)}% 时自动批准`
    : '等待人工批准'
  return <figure className={`workflow-overview${expanded ? ' show-details' : ''}`} aria-label="角色与流程总览">
    <figcaption className="workflow-overview-heading"><div><Workflow size={16} /><h3>流程总览</h3></div><span className={overview.parallel ? 'overview-mode parallel' : 'overview-mode'}>{overview.parallel ? <GitFork size={13} /> : <Workflow size={13} />}{overview.parallel ? `最多 ${overview.concurrency} 个执行 Agent 并行` : '1 个执行 Agent · 串行'}</span></figcaption>
    <div className="overview-facts"><span>{overview.members.length} 套执行配置</span><span>{overview.harnesses.length} 种 Harness</span><div className="overview-harnesses" aria-label="当前流程使用的 Harness">{overview.harnesses.map(kind => <span key={kind}><ExecutorLogo kind={kind} />{executorLabel(kind)}</span>)}</div><button className="overview-detail-toggle" aria-expanded={expanded} aria-controls="workflow-overview-graph" onClick={() => setExpanded(!expanded)}>{expanded ? '收起细节' : '模型与规则'}</button></div>
    <p className="overview-scroll-hint">向右滚动查看完整流程 →</p>
    <div className="workflow-overview-scroll" tabIndex={0} role="region" aria-label="协作流程图，窄窗口可横向滚动">
      <ol className="workflow-overview-graph" id="workflow-overview-graph">
        <li className="overview-stage"><h4><span>01</span>规划者</h4><button type="button" className="overview-role-node" disabled={!onConfigure} aria-label="配置规划者" onClick={() => onConfigure?.('planner')}><ExecutorIdentity settings={settings} config={settings.roles.planner} /><span className="overview-node-note">只读规划 · 生成执行合同</span></button><p>{approval('planner')}</p></li>
        <li className="overview-stage overview-execution"><h4><span>02</span>执行阶段<button className="overview-dispatch-link" disabled={!onConfigure} onClick={() => onConfigure?.('parallel')}>{overview.parallel ? '并行调度' : '串行执行'}</button></h4><div className="overview-members" data-parallel={overview.parallel && overview.members.length > 1} style={{ '--overview-member-count': overview.members.length } as CSSProperties}>
          {overview.members.map((config, index) => <button type="button" className="overview-member" key={index} disabled={!onConfigure} aria-label={overview.parallel && !overview.reuseMain ? `配置执行成员 ${index + 1}` : '配置主执行者'} onClick={() => onConfigure?.(overview.parallel && !overview.reuseMain ? 'parallel' : 'implementer')}><span className="overview-member-label">{!overview.parallel || overview.reuseMain ? '主执行者' : <><span className="overview-member-prefix">执行</span>成员 {index + 1}</>}{overview.reuseMain && <em>复用至各并行步骤</em>}</span><ExecutorIdentity settings={settings} config={config} /></button>)}
        </div><p>{overview.parallel ? '按步骤分配 → 汇总改动' : '按合同顺序完成实现'}</p></li>
        <li className={`overview-stage overview-verification${settings.verification.enabled ? '' : ' disabled'}`}><h4><span>03</span>独立验证</h4><button type="button" className="overview-role-node" disabled={!onConfigure} aria-label="配置独立验证" onClick={() => onConfigure?.('verification')}><div className="overview-local-icon">{settings.verification.enabled ? <ShieldCheck size={22} /> : <ShieldOff size={22} />}</div><b>Foreman 本地</b><small className={settings.verification.enabled ? 'overview-node-note' : undefined}>{settings.verification.enabled ? '运行项目验证命令' : '已关闭 · 跳过验证'}</small></button><p>{settings.verification.enabled ? settings.verification.stopOnFailure ? '失败即停止' : '记录失败并交给审核' : '直接进入审核'}</p></li>
        <li className="overview-stage"><h4><span>04</span>审核者</h4><button type="button" className="overview-role-node" disabled={!onConfigure} aria-label="配置审核者" onClick={() => onConfigure?.('reviewer')}><ExecutorIdentity settings={settings} config={settings.roles.reviewer} /><span className="overview-node-note">只读审核 · 检查变更证据</span></button><p>{approval('reviewer')}</p></li>
      </ol>
    </div>
    <div className="overview-rework"><RotateCcw size={14} /><span>{settings.maxReviewLoops > 0 ? <>审核要求修改 → 主执行者返工 → {settings.verification.enabled ? '验证与再审核' : '再审核'}，最多 <b>{settings.maxReviewLoops}</b> 轮。<small>返工使用 {executorLabel(settings.roles.implementer.executor)} · {modelName(settings, settings.roles.implementer)}</small></> : '未启用返工循环；审核未通过时停止。'}</span></div>
    <p className="overview-scheduling-note">配置随修改更新，用于新任务。{overview.parallel && '实际并发受步骤依赖和文件冲突约束；同一套配置可用于多个并行步骤。'}{overview.inactiveMembers > 0 && `已保存的 ${overview.inactiveMembers} 套并行成员配置当前未启用。`}</p>
  </figure>
}
