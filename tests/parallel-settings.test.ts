import { Children, isValidElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ParallelSettings } from '../src/renderer/src/parallel-agents'
import { defaultSettings } from '../src/main/storage/database'

interface ControlProps {
  children?: ReactNode; className?: string; disabled?: boolean
  onClick?: () => void; onChange?: (event: { target: { value: string } }) => void
  [key: string]: unknown
}
function findControl(node: ReactNode, match: (props: ControlProps) => boolean): ControlProps | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<ControlProps>(child)) continue
    if (match(child.props)) return child.props
    const found = findControl(child.props.children, match)
    if (found) return found
  }
}
function control(node: ReactNode, match: (props: ControlProps) => boolean): ControlProps {
  const found = findControl(node, match)
  if (!found) throw new Error('Expected settings control was not rendered')
  return found
}
function fixture(limit: number, count: number) {
  const settings = defaultSettings('/repo')
  settings.execution = { maxParallelAgents: limit, agents: Array.from({ length: count }, () => structuredClone(settings.roles.implementer)) }
  const onChange = vi.fn()
  const tree = ParallelSettings({ settings, onChange })
  return { settings, onChange, tree,
    add: control(tree, (props) => props.className === 'quiet-button'),
    limit: control(tree, (props) => props['aria-label'] === '最大并行 Agent 数') }
}

describe('parallel settings member capacity', () => {
  it('uses the selected limit for adding members, including stale click handlers', () => {
    const full = fixture(3, 3)
    expect(full.add.disabled).toBe(true)
    full.add.onClick?.()
    expect(full.onChange).not.toHaveBeenCalled()
    const available = fixture(3, 2)
    expect(available.add.disabled).toBe(false)
    available.add.onClick?.()
    expect(available.onChange.mock.calls[0][0].execution.agents).toHaveLength(3)
  })

  it('does not silently discard configured members when lowering the limit', () => {
    const full = fixture(4, 4)
    const three = control(full.limit.children, (props) => props.value === 3)
    expect(three.disabled).toBe(true)
    full.limit.onChange?.({ target: { value: '3' } })
    expect(full.onChange).not.toHaveBeenCalled()
    expect(full.settings.execution?.agents).toHaveLength(4)
    const fits = fixture(4, 2)
    fits.limit.onChange?.({ target: { value: '3' } })
    expect(fits.onChange.mock.calls[0][0].execution).toMatchObject({ maxParallelAgents: 3, agents: fits.settings.execution?.agents })
  })

  it('keeps historical excess members available for removal without allowing more', () => {
    const existing = fixture(3, 4)
    expect(existing.add.disabled).toBe(true)
    const remove = control(existing.tree, (props) => props['aria-label'] === '移除 Agent 4')
    remove.onClick?.()
    const next = existing.onChange.mock.calls[0][0]
    expect(next.execution.agents).toHaveLength(3)
    expect(next.execution.maxParallelAgents).toBe(3)
  })
})
