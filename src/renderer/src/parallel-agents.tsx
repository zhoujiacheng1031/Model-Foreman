import { Bot, Brain, ChevronDown, FileCode2, GitBranch, Layers3, Plus, Trash2 } from 'lucide-react'
import type { AppSettings, Effort, ExecutorKind, RoleConfig, RunSummary } from '../../shared/contracts'

export function ParallelSettings({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const policy = settings.execution ?? { maxParallelAgents: 1, agents: [] }
  const agents = policy.agents
  const update = (index: number, patch: Partial<RoleConfig>) => onChange({ ...settings, execution: { ...policy, agents: agents.map((agent, i) => i === index ? { ...agent, ...patch } : agent) } })
  return <section className="parallel-agents-settings" aria-labelledby="parallel-settings-title">
    <div className="memory-settings-head parallel-section-head"><Layers3 size={18} /><div><b id="parallel-settings-title">并行执行 Agent</b><span>独立步骤分工执行，汇总后统一验证与审核。</span></div><span className="parallel-count">{policy.maxParallelAgents === 1 ? '串行模式' : `最多 ${policy.maxParallelAgents} 个并行`}</span></div>
    <div className="workflow-policy-strip parallel-policy"><div><GitBranch size={16} /><span><b>按依赖与修改范围调度</b><small>配置对新任务生效；返工由主执行角色处理。</small></span></div><label><span>并行上限</span><select aria-label="最大并行 Agent 数" value={policy.maxParallelAgents} onChange={(event) => onChange({ ...settings, execution: { ...policy, maxParallelAgents: Number(event.target.value) } })}>
      {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count === 1 ? '1 · 串行' : `${count} 个`}</option>)}
    </select></label></div>
    <div className="parallel-members-heading"><div><b>执行成员</b><span>{agents.length ? `${agents.length} / 4 个成员 · 按步骤轮流分配` : '未配置成员时，复用上方执行角色'}</span></div><button type="button" className="quiet-button" disabled={agents.length >= 4} onClick={() => onChange({ ...settings, execution: { ...policy, agents: [...agents, structuredClone(settings.roles.implementer)] } })}><Plus size={14} />添加成员</button></div>
    {agents.length === 0 && <div className="parallel-empty"><Bot size={20} /><div><b>使用主执行角色</b><p>提高并行上限即可让独立步骤同时执行，也可添加成员分别选择模型。</p></div></div>}
    <div className="parallel-agent-grid">{agents.map((agent, index) => <article className="role-card role-implementer parallel-agent-config" key={index}>
      <div className="role-card-head"><span className="role-number">{String(index + 1).padStart(2, '0')}</span><div><small>EXECUTION AGENT</small><h2>执行成员 {index + 1}</h2></div><button type="button" className="parallel-remove" aria-label={`移除 Agent ${index + 1}`} title={`移除执行成员 ${index + 1}`} onClick={() => onChange({ ...settings, execution: { ...policy, agents: agents.filter((_, i) => i !== index) } })}><Trash2 size={15} /></button></div>
      <div className="parallel-member-fields"><label><span>执行器</span><select aria-label={`Agent ${index + 1} 执行器`} value={agent.executor} onChange={(event) => {
        const executor = event.target.value as ExecutorKind; const model = settings.models[executor][0]
        update(index, { executor, model: model?.id ?? '', effort: model?.efforts[0] ?? 'medium', skills: [], skillMode: 'auto' })
      }}><option value="codex">Codex CLI</option><option value="claude">Claude Code</option><option value="custom" disabled={!settings.models.custom.length}>自定义 API</option></select></label>
      <label><span>模型</span><select aria-label={`Agent ${index + 1} 模型`} value={agent.model} onChange={(event) => {
        const model = settings.models[agent.executor].find((item) => item.id === event.target.value)
        update(index, { model: event.target.value, effort: model?.efforts.includes(agent.effort) ? agent.effort : model?.efforts[0] ?? 'medium' })
      }}>{!settings.models[agent.executor].some((model) => model.id === agent.model) && <option value={agent.model}>{agent.model}</option>}{settings.models[agent.executor].map((model) => <option value={model.id} key={model.id}>{model.label}</option>)}</select></label>
      <label><span>推理强度</span><select aria-label={`Agent ${index + 1} 推理强度`} value={agent.effort} onChange={(event) => update(index, { effort: event.target.value as Effort })}>
        {(settings.models[agent.executor].find((model) => model.id === agent.model)?.efforts ?? ['low', 'medium', 'high']).map((effort) => <option key={effort}>{effort}</option>)}
      </select></label></div>
      <div className="parallel-member-foot"><GitBranch size={13} /><span>独立工作区 · {agent.skillMode === 'explicit' ? `${agent.skills.length} 个指定 Skill` : 'Skill 自动匹配'}</span></div>
    </article>)}</div>
    {agents.length > 0 && policy.maxParallelAgents === 1 && <p className="parallel-mode-note">当前为串行模式，使用主执行角色。将并行上限调至 2 或以上可启用这些成员。</p>}
  </section>
}

export function AgentTaskPanel({ run }: { run: RunSummary }) {
  if (!run.agentTasks?.length) return null
  const labels = { pending: '等待执行', running: '执行中', ready: '等待汇总', integrated: run.resolution === 'merged' ? '已交付' : '已汇总', interrupted: '已中断', failed: '执行失败' }
  const integrated = run.agentTasks.filter((task) => task.status === 'integrated').length
  return <section className="agent-task-panel" aria-label="Agent 工作记忆与执行状态">
    <div className="memory-settings-head parallel-section-head"><Layers3 size={18} /><div><b>Agent 协作进度</b><span>工作记录用于任务接力，整体交付后进入长期记忆治理。</span></div><span className="parallel-count">{integrated} / {run.agentTasks.length} 已汇总</span></div>
    <div className="agent-task-list">{run.agentTasks.map((task) => <details className="agent-task-item" key={task.id}><summary><span className="agent-task-icon"><Bot size={17} /></span><span className="agent-task-title"><b>{task.title}</b><small>{task.stepId} · {task.config.executor} / {task.config.model} · 第 {task.attempt} 次执行</small></span><span className={`agent-task-status status-${task.status}`}><i />{labels[task.status]}</span><ChevronDown className="agent-task-chevron" size={15} /></summary>
      <div className="agent-task-body"><dl className="agent-task-metadata"><div><dt>依赖步骤</dt><dd>{task.dependencies.join('、') || '无依赖'}</dd></div><div><dt>修改范围</dt><dd>{task.files.join('、') || '工作区独占'}</dd></div><div className="agent-task-workspace"><dt>工作区</dt><dd>{task.workspace ?? '尚未创建'}</dd></div><div><dt>基准提交</dt><dd title={task.baseCommit}>{task.baseCommit?.slice(0, 12) ?? '待确定'}</dd></div><div><dt>产出提交</dt><dd title={task.commit}>{task.commit?.slice(0, 12) ?? '未提交'}</dd></div></dl>
      {task.error && <div className="agent-task-error"><b>执行异常 · 现场已保留</b><pre>{task.error}</pre></div>}
      {task.report && <div className="agent-task-report"><h4><FileCode2 size={14} />执行报告</h4><p>{task.report.summary}</p>{task.report.filesChanged.length > 0 && <div className="agent-file-tags">{task.report.filesChanged.map((file, i) => <span key={`${file}-${i}`}>{file}</span>)}</div>}{task.report.unresolved.length > 0 && <div className="agent-task-error"><b>待解决事项</b><ul>{task.report.unresolved.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}{task.report.commandsRun.length > 0 && <details className="agent-memory-details"><summary>已执行命令 · {task.report.commandsRun.length} 条<ChevronDown size={14} /></summary><pre>{task.report.commandsRun.join('\n')}</pre></details>}</div>}
      {task.memorySnapshot && <details className="agent-memory-details"><summary><span><Brain size={14} />上下文快照</span><small>{task.memorySnapshot.entries.length} 条长期记忆</small><ChevronDown size={14} /></summary><div className="agent-memory-meta"><span>{new Date(task.memorySnapshot.at).toLocaleString('zh-CN')}</span><span>{task.memorySnapshot.id}</span></div><pre>{task.memorySnapshot.text || '本次没有适用记忆'}</pre></details>}
      </div>
    </details>)}</div>
  </section>
}
