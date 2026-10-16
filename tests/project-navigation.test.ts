import { Children, isValidElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectHeading } from '../src/renderer/src/project-heading'

function buttons(node: ReactNode): Array<{ title?: string; onClick?: () => void; 'aria-label'?: string }> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode; title?: string; onClick?: () => void; 'aria-label'?: string }>(child)) return []
    return [...(child.type === 'button' ? [child.props] : []), ...buttons(child.props.children)]
  })
}

describe('project navigation', () => {
  it('selects a project by its name without merely collapsing its tasks', () => {
    const onSelect = vi.fn(); const onToggle = vi.fn()
    const tree = ProjectHeading({ workspace: '/repo/other', count: 2, current: false, collapsed: true, onSelect, onToggle })
    buttons(tree).find((button) => button.title === '/repo/other')?.onClick?.()
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onToggle).not.toHaveBeenCalled()
  })
  it('keeps disclosure separate from project selection', () => {
    const onSelect = vi.fn(); const onToggle = vi.fn()
    const tree = ProjectHeading({ workspace: '/repo/other', count: 2, current: false, collapsed: true, onSelect, onToggle })
    buttons(tree).find((button) => button['aria-label'] === '展开 other 的任务')?.onClick?.()
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
  })
})
