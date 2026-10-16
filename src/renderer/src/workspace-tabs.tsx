import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileDiff, List, Plus, TerminalSquare, X } from 'lucide-react'
import { MAX_WORKSPACE_TABS, tabLimitMessage } from './workspace-documents'

export interface WorkspaceTab { id: string; kind: 'draft' | 'run'; title: string; hasDraft?: boolean }
export const workspaceTabId = (id: string) => `workspace-tab-${encodeURIComponent(id)}`
const focusActiveTab = () => window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.workspace-tabbar [role=tab][aria-selected=true]')?.focus())

export function WorkspaceTabs({ tabs, activeId, closedDrafts, onSelect, onNew, onClose, onRestore }: {
  tabs: WorkspaceTab[]; activeId: string; closedDrafts: Array<{ id: string; title: string }>
  onSelect: (id: string) => void; onNew: () => void; onClose: (id: string) => void; onRestore: (id: string) => void
}) {
  const atLimit = tabs.length >= MAX_WORKSPACE_TABS
  return <div className="workspace-tabbar"><div role="tablist" aria-label="工作区任务" onKeyDown={(event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete'].includes(event.key)) return
    if (!(event.target as HTMLElement).matches('[role=tab]')) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')]
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    event.preventDefault()
    if (event.key === 'Delete') { onClose(tabs[current].id); focusActiveTab(); return }
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    buttons[index]?.focus(); buttons[index]?.click()
  }}>
    {tabs.map((tab) => <div className={tab.id === activeId ? 'workspace-tab selected' : 'workspace-tab'} data-kind={tab.kind} key={tab.id}>
      <button id={workspaceTabId(tab.id)} role="tab" aria-controls={tab.kind === 'draft' ? 'workspace-draft-panel' : 'workspace-run-panel'} aria-selected={tab.id === activeId} tabIndex={tab.id === activeId ? 0 : -1} title={tab.title} onFocus={(event) => event.currentTarget.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' })} onClick={() => onSelect(tab.id)}>{tab.kind === 'run' ? <FileDiff size={15} /> : <TerminalSquare size={15} />}<span>{tab.title}{tab.hasDraft ? ' · 草稿' : ''}</span></button>
      <button className="workspace-tab-close" aria-label={`关闭页签：${tab.title}`} title={tab.kind === 'draft' ? tab.hasDraft ? '关闭页签，内容保留在“恢复草稿”' : '关闭空白草稿页签' : '关闭页签，已启动的任务继续运行'} onClick={() => { onClose(tab.id); focusActiveTab() }}><X size={12} /></button>
    </div>)}
  </div><div className="workspace-tab-actions">
    {tabs.length > 0 && <WorkspaceTabMenu label="切换已打开的页签" title={atLimit ? tabLimitMessage : '切换已打开的页签'} text={`${tabs.length}/${MAX_WORKSPACE_TABS}`} items={tabs.map((tab) => ({ id: tab.id, title: tab.title, active: tab.id === activeId }))} onSelect={onSelect} />}
    {closedDrafts.length > 0 && <WorkspaceTabMenu label="恢复已关闭草稿" text={`恢复草稿（${closedDrafts.length}）`} items={closedDrafts} onSelect={onRestore} />}
    <button className="new-task-button" disabled={atLimit} title={atLimit ? tabLimitMessage : '新建独立任务页签'} onClick={() => { onNew(); focusActiveTab() }}><Plus size={15} />新任务</button>
  </div></div>
}

function WorkspaceTabMenu({ label, title, text, items, onSelect }: {
  label: string; title?: string; text: string; items: Array<{ id: string; title: string; active?: boolean }>; onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  return <div className="workspace-tab-picker" ref={root} onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus() } }}>
    <button className="workspace-menu-trigger" aria-label={label} aria-expanded={open} title={title} onClick={() => setOpen(!open)}><List size={14} /><span>{text}</span><ChevronDown size={12} /></button>
    {open && <div className="workspace-tab-menu" aria-label={label}>{items.map((item) => <button key={item.id} title={item.title} aria-current={item.active ? 'true' : undefined} onClick={() => { setOpen(false); onSelect(item.id); focusActiveTab() }}>{item.title}</button>)}</div>}
  </div>
}
