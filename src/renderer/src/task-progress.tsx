import { Check, Circle, LoaderCircle, Minus, X } from 'lucide-react'
import type { RunSummary } from '../../shared/contracts'

export function taskProgress(run: RunSummary) {
  const phase = run.status === 'paused' || run.status === 'failed' ? run.checkpointPhase ?? run.status : run.status
  const current = ['planning', 'awaiting_approval'].includes(phase) ? 0 : phase === 'implementing' ? 1 : phase === 'verifying' ? 2 : ['reviewing', 'awaiting_review_approval'].includes(phase) ? 3 : run.status === 'completed' ? 4 : -1
  return ['规划', '实现', '验证', '审核', '交付'].map((label, index) => {
    let state = current > index ? 'done' : current === index ? 'active' : 'idle'
    if (index === 2 && run.verification) {
      state = run.verification.status === 'passed' ? 'done' : run.verification.status === 'failed' ? 'failed' : 'skipped'
      if (state === 'skipped') label = '验证已跳过'
    }
    if (index === 3 && run.status === 'awaiting_review_approval') label = '审核待确认'
    if (index === 4 && run.resolution === 'merged') { state = 'done'; label = '已交付' }
    else if (index === 4 && run.resolution === 'discarded') { state = 'stopped'; label = '已放弃' }
    else if (index === 4 && run.status === 'completed') { state = 'active'; label = '待交付' }
    if (index === current && ['paused', 'failed', 'cancelled'].includes(run.status)) state = run.status === 'failed' ? 'failed' : 'stopped'
    return { label, state }
  })
}

export function TaskProgress({ run }: { run: RunSummary }) {
  return <ol className="task-progress" aria-label="任务阶段">{taskProgress(run).map(({ label, state }, index) => <li className={state} key={index} aria-current={state === 'active' ? 'step' : undefined}>
    <span className="task-progress-mark">{state === 'done' ? <Check size={14} /> : state === 'skipped' || state === 'stopped' ? <Minus size={14} /> : state === 'failed' ? <X size={14} /> : state === 'active' ? <LoaderCircle size={14} /> : <Circle size={12} />}</span><span>{label}</span>
  </li>)}</ol>
}
