import type { AppSettings, Effort, ExecutorKind, RoleConfig, RunSummary } from '../../shared/contracts'

export function ParallelSettings({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const policy = settings.execution ?? { maxParallelAgents: 1, agents: [] }
  const agents = policy.agents
  const update = (index: number, patch: Partial<RoleConfig>) => onChange({ ...settings, execution: { ...policy, agents: agents.map((agent, i) => i === index ? { ...agent, ...patch } : agent) } })
  return <section className="parallel-agents-settings">
    <h3>并行执行 Agent</h3>
    <p>按已批准步骤的依赖和文件范围调度，每个 Agent 使用独立 worktree。汇总后统一验证与审核；返工由主执行角色处理。</p>
    <label>最多同时执行 <select aria-label="最大并行 Agent 数" value={policy.maxParallelAgents} onChange={(event) => onChange({ ...settings, execution: { ...policy, maxParallelAgents: Number(event.target.value) } })}>
      {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count === 1 ? '1（串行）' : count}</option>)}
    </select></label>
    <p>并行数大于 1 时启用成员调度；未配置成员时复用执行角色，配置后按步骤轮流分配。仅对新任务生效。</p>
    {agents.map((agent, index) => <div className="parallel-agent-config" key={index}>
      <b>Agent {index + 1}</b>
      <label>执行器<select aria-label={`Agent ${index + 1} 执行器`} value={agent.executor} onChange={(event) => {
        const executor = event.target.value as ExecutorKind; const model = settings.models[executor][0]
        update(index, { executor, model: model?.id ?? '', effort: model?.efforts[0] ?? 'medium', skills: [], skillMode: 'auto' })
      }}><option value="codex">Codex CLI</option><option value="claude">Claude Code</option><option value="custom" disabled={!settings.models.custom.length}>自定义 API</option></select></label>
      <label>模型<select aria-label={`Agent ${index + 1} 模型`} value={agent.model} onChange={(event) => {
        const model = settings.models[agent.executor].find((item) => item.id === event.target.value)
        update(index, { model: event.target.value, effort: model?.efforts.includes(agent.effort) ? agent.effort : model?.efforts[0] ?? 'medium' })
      }}>{!settings.models[agent.executor].some((model) => model.id === agent.model) && <option value={agent.model}>{agent.model}</option>}{settings.models[agent.executor].map((model) => <option value={model.id} key={model.id}>{model.label}</option>)}</select></label>
      <label>推理强度<select aria-label={`Agent ${index + 1} 推理强度`} value={agent.effort} onChange={(event) => update(index, { effort: event.target.value as Effort })}>
        {(settings.models[agent.executor].find((model) => model.id === agent.model)?.efforts ?? ['low', 'medium', 'high']).map((effort) => <option key={effort}>{effort}</option>)}
      </select></label>
      <button className="quiet-button" onClick={() => onChange({ ...settings, execution: { ...policy, agents: agents.filter((_, i) => i !== index) } })}>移除 Agent {index + 1}</button>
    </div>)}
    <button className="quiet-button" disabled={agents.length >= 4} onClick={() => onChange({ ...settings, execution: { ...policy, agents: [...agents, structuredClone(settings.roles.implementer)] } })}>添加执行 Agent</button>
  </section>
}

export function AgentTaskPanel({ run }: { run: RunSummary }) {
  if (!run.agentTasks?.length) return null
  const labels = { pending: '等待依赖', running: '执行中', ready: '等待汇总', integrated: '已汇总，待整体交付', interrupted: '已中断，可恢复', failed: '失败，保留证据' }
  return <section className="agent-task-panel"><h3>Agent 工作记忆与执行状态</h3><p>过程记录仅用于本任务接力；通过最终审核及合并后，才进入长期知识治理。</p>
    {run.agentTasks.map((task) => <details key={task.id}><summary><b>{task.stepId} · {task.title}</b><span>{labels[task.status]}</span></summary>
      <p>{task.config.executor} / {task.config.model} · 第 {task.attempt} 次执行</p>
      <p>依赖：{task.dependencies.join('、') || '无'} · 范围：{task.files.join('、') || '工作区独占'}</p>
      <p>工作区：{task.workspace ?? '尚未创建'}</p><p>基准：{task.baseCommit ?? '待确定'} · 产出：{task.commit ?? '未提交'}</p>
      {task.error && <pre>{task.error}</pre>}{task.report && <pre>{JSON.stringify(task.report, null, 2)}</pre>}
      {task.memorySnapshot && <details><summary>查看本次上下文快照 · {task.memorySnapshot.entries.length} 条长期记忆</summary><small>{task.memorySnapshot.at} · {task.memorySnapshot.id}</small><pre>{task.memorySnapshot.text || '没有适用记忆'}</pre></details>}
    </details>)}
  </section>
}
