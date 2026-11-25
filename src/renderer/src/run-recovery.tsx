import { Check, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react'
import type { RunRecoveryPlan, RunSummary } from '../../shared/contracts'

const actionLabel = { reuse: '复用已汇总产出', integrate: '汇总已有产出', retry: '接续执行', pending: '等待依赖后执行' }

export function RunRecoveryDialog({ run, plan, busy, error, onClose, onRefresh, onRecover, onRetry }: {
  run: RunSummary; plan: RunRecoveryPlan; busy: boolean; error: string
  onClose: () => void; onRefresh: () => void; onRecover: () => void; onRetry: () => void
}) {
  return <div className="approval-scrim" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose() }}>
    <section className="resume-panel recovery-panel" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
      <header><span><RotateCcw size={18} /><span><small>继续原任务</small><b id="recovery-title">检查失败现场与可复用产出</b></span></span></header>
      <div className="resume-context">
        <label><span>任务</span><p>{run.title}</p></label>
        <label><span>失败原因{run.failure ? ` · ${new Date(run.failure.at).toLocaleString('zh-CN')}` : ''}</span><p>{run.failure?.message || run.error || '未记录失败原因'}</p></label>
        <div className={`recovery-readiness ${plan.available ? 'ready' : 'blocked'}`} role="status"><ShieldCheck size={17} /><span><b>{plan.available ? '检查通过，可以继续' : '当前无法接续'}</b><small>{plan.reason}</small></span></div>
        {plan.steps.length > 0 && <ul className="recovery-step-list">{plan.steps.map((step) => <li key={step.stepId}><span><b>{step.title}</b><small>{step.stepId}</small></span><span>{actionLabel[step.action]}</span></li>)}</ul>}
        {plan.available && <p>沿用原任务与工作区，保留执行记录和累计用量。恢复后将重新运行完整验证与独立审查。</p>}
        {error && <p className="recovery-error" role="alert">{error}</p>}
      </div>
      <footer><button className="quiet-button" autoFocus disabled={busy} onClick={onClose}>关闭</button><button className="quiet-button" disabled={busy} onClick={onRetry}>重新创建任务</button><button className="quiet-button" disabled={busy} onClick={onRefresh}><RefreshCw size={14} />重新检查</button><button className="primary" disabled={busy || !plan.available} onClick={onRecover}><Check size={14} />继续原任务</button></footer>
    </section>
  </div>
}
