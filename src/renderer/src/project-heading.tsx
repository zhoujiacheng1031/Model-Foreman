import { ChevronDown, FolderGit2 } from 'lucide-react'

export function ProjectHeading({ workspace, count, current, collapsed, disabled, onSelect, onToggle }: {
  workspace: string; count: number; current: boolean; collapsed: boolean; disabled?: boolean
  onSelect: () => void; onToggle: () => void
}) {
  const name = workspace.split(/[\\/]/).filter(Boolean).pop() || workspace
  return <div className="project-heading">
    <button className="project-run-toggle" title={workspace} aria-current={current ? 'true' : undefined} disabled={disabled} onClick={onSelect}><FolderGit2 size={14} /><span><b>{name}</b><small>{current ? '当前项目 · ' : ''}{count} 个任务</small></span></button>
    <button className="project-collapse" aria-label={`${collapsed ? '展开' : '收起'} ${name} 的任务`} aria-expanded={!collapsed} onClick={onToggle}><ChevronDown size={14} /></button>
  </div>
}
