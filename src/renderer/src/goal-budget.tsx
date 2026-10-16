import type { GoalInput } from '../../shared/contracts'

export interface GoalBudget {
  hours: number
  tokens: number
  cost: number
  unlimitedCost: boolean
  iterations: number
  attempts: number
}

export const defaultGoalBudget: GoalBudget = { hours: 24, tokens: 2_000_000, cost: 5, unlimitedCost: false, iterations: 24, attempts: 2 }

export function goalBudgetError(value: GoalBudget): string {
  if (!Number.isInteger(value.hours) || value.hours < 1 || value.hours > 720) return '运行时间应为 1–720 小时'
  if (!Number.isInteger(value.tokens) || value.tokens < 1000 || value.tokens > 100_000_000) return 'Token 预算应为 1,000–100,000,000'
  if (!value.unlimitedCost && (!Number.isFinite(value.cost) || value.cost < 0.01 || value.cost > 100_000)) return '请设置至少 $0.01 的费用上限，或明确选择不限费用'
  if (!Number.isInteger(value.iterations) || value.iterations < 1 || value.iterations > 100) return '最大循环应为 1–100 次'
  if (!Number.isInteger(value.attempts) || value.attempts < 1 || value.attempts > 8) return '每个任务的最多尝试次数应为 1–8 次'
  return ''
}

export function goalBudgetInput(value: GoalBudget): Pick<GoalInput, 'timeBudgetSeconds' | 'tokenBudget' | 'costBudgetUsd' | 'maxIterations' | 'maxTaskAttempts'> {
  const error = goalBudgetError(value)
  if (error) throw new Error(error)
  return { timeBudgetSeconds: value.hours * 3600, tokenBudget: value.tokens, costBudgetUsd: value.unlimitedCost ? undefined : value.cost, maxIterations: value.iterations, maxTaskAttempts: value.attempts }
}

export function GoalBudgetFields({ value, onChange }: { value: GoalBudget; onChange: (value: GoalBudget) => void }) {
  const number = (key: keyof GoalBudget, next: string) => onChange({ ...value, [key]: Number(next) })
  return <section className="goal-budget-settings" aria-label="运行预算">
    <div className="budget-primary"><label><span>费用上限（USD）</span><input type="number" min="0.01" max="100000" step="0.01" value={value.cost} disabled={value.unlimitedCost} onChange={(e) => number('cost', e.target.value)} /></label>
      <label className="budget-unlimited"><input type="checkbox" checked={value.unlimitedCost} onChange={(e) => onChange({ ...value, unlimitedCost: e.target.checked })} />不限费用（仍受时间、Token 与循环限制）</label></div>
    <p className={`budget-summary ${value.unlimitedCost ? 'unlimited' : ''}`} role="status">{value.unlimitedCost ? '费用未设上限' : `费用上限 $${value.cost.toFixed(2)}`} · 最长 {value.hours} 小时 · {value.tokens.toLocaleString('zh-CN')} Token · 最多 {value.iterations} 次循环</p>
    <small>预算在任务调度时检查，耗尽后停止目标；费用以执行器已报告的用量为准，正在进行的调用可能超出预算。</small>
    <details className="goal-advanced"><summary>调整时间、Token 与循环</summary><div className="goal-budget">
      <label><span>最长运行时间（小时）</span><input type="number" min="1" max="720" value={value.hours} onChange={(e) => number('hours', e.target.value)} /></label>
      <label><span>Token 预算</span><input type="number" min="1000" max="100000000" value={value.tokens} onChange={(e) => number('tokens', e.target.value)} /></label>
      <label><span>最大循环次数</span><input type="number" min="1" max="100" value={value.iterations} onChange={(e) => number('iterations', e.target.value)} /></label>
      <label><span>每个任务最多尝试</span><input type="number" min="1" max="8" value={value.attempts} onChange={(e) => number('attempts', e.target.value)} /></label>
    </div></details>
    {goalBudgetError(value) && <p className="form-hint error" role="alert">{goalBudgetError(value)}</p>}
  </section>
}
