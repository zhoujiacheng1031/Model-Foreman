import { useId } from 'react'
import { Check, SlidersHorizontal } from 'lucide-react'
import type { ExecutorKind } from '../../shared/contracts'
import { executorLabel } from '../../shared/executors'
import openaiLogo from './assets/executors/openai.png'
import claudeLogo from './assets/executors/claude.png'
import zcodeLogo from './assets/executors/zcode.png'

const options: Array<{ kind: ExecutorKind; name: string }> = [
  { kind: 'codex', name: 'Codex' }, { kind: 'claude', name: 'Claude' },
  { kind: 'zcode', name: 'ZCode' }, { kind: 'custom', name: 'API' }
]
const logos = { codex: openaiLogo, claude: claudeLogo, zcode: zcodeLogo }

export function ExecutorLogo({ kind }: { kind: ExecutorKind }) {
  return kind === 'custom'
    ? <SlidersHorizontal className="executor-logo executor-logo-api" aria-hidden="true" />
    : <img className="executor-logo" src={logos[kind]} alt="" aria-hidden="true" draggable={false} width="36" height="36" />
}

/** Native radios provide arrow-key navigation, a single Tab stop and disabled-option skipping. */
export function ExecutorPicker({ value, onChange, customAvailable, label, heading = '执行器' }: {
  value: ExecutorKind; onChange: (kind: ExecutorKind) => void; customAvailable: boolean; label: string; heading?: string
}) {
  const group = useId()
  return <div className="executor-picker" role="radiogroup" aria-label={label}>
    <div className="executor-picker-heading" aria-hidden="true"><span>{heading}</span><small>{executorLabel(value)}</small></div>
    <div className="executor-picker-options">
      {options.map(({ kind, name }) => {
        const disabled = kind === 'custom' && !customAvailable
        const title = disabled ? '自定义 API · 请先在连接器中完成 API 配置' : executorLabel(kind)
        return <label className="executor-option" key={kind} title={title}>
          <input type="radio" name={group} value={kind} checked={value === kind} disabled={disabled}
            aria-label={executorLabel(kind)} onChange={() => onChange(kind)} />
          <span className="executor-option-surface">
            <span className="executor-option-icon"><ExecutorLogo kind={kind} /></span>
            <span className="executor-option-name">{name}</span>
            <span className="executor-option-check" aria-hidden="true"><Check size={9} strokeWidth={3} /></span>
          </span>
        </label>
      })}
    </div>
  </div>
}
