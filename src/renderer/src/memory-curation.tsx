import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MemoryCurationInput, MemoryEntry } from '../../shared/contracts'

export function needsMemoryCuration(entry: MemoryEntry): boolean {
  return Boolean(entry.sourceRef?.startsWith('contract.') || entry.sourceRef === 'legacy.result')
}

function MemoryDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    ref.current?.showModal()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog className="memory-dialog" ref={ref} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose() }}><header><h2>{title}</h2><button className="quiet-button" onClick={onClose} aria-label="关闭记忆预览">关闭</button></header>{children}</dialog>
}

export function MemoryCurationDialog({ entries, busy, onClose, onSave }: {
  entries: MemoryEntry[]; busy?: string; onClose: () => void; onSave: (input: MemoryCurationInput) => Promise<boolean>
}) {
  const [chosen, setChosen] = useState(entries.map((entry) => entry.id))
  const [title, setTitle] = useState(entries.length === 1 ? entries[0].title : '项目经验')
  const [content, setContent] = useState(entries.length === 1 ? entries[0].content : '')
  const [applicability, setApplicability] = useState('')
  const selected = entries.filter((entry) => chosen.includes(entry.id))
  const invalid = !selected.length || !title.trim() || !content.trim() || !applicability.trim()
  const save = async () => {
    if (invalid) return
    if (await onSave({ sources: selected.map((entry) => ({ id: entry.id, version: entry.version ?? 1 })), title, content, applicability })) onClose()
  }
  return <MemoryDialog title="整理为一条可复用记忆" onClose={onClose}>
    <p>从下方来源中提炼经验，写明适用条件。保存后生成一条待审候选，所选原候选标记为已拒绝并保留来源记录。</p>
    <details className="curation-sources"><summary>查看并选择来源（已选 {chosen.length}/{entries.length}）</summary>{entries.map((entry) => <label key={entry.id}><input type="checkbox" checked={chosen.includes(entry.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, entry.id] : chosen.filter((id) => id !== entry.id))} /><span><b>{entry.title}</b><span>{entry.content}</span></span></label>)}</details>
    <label>记忆标题<input autoFocus maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label>适用范围（必填）<textarea maxLength={2000} value={applicability} onChange={(e) => setApplicability(e.target.value)} placeholder="例如：仅适用于本项目认证模块；修改令牌校验时参考，其他文案任务不适用。" /></label>
    <label>可复用内容（必填）<textarea className="curation-content" maxLength={12000} value={content} onChange={(e) => setContent(e.target.value)} placeholder="写下以后遇到同类问题时仍然有用的决策或经验，去掉本次任务的字数、文件数量等一次性要求。" /></label>
    <p className="form-hint" role="status">{invalid ? '请选择来源，并填写标题、适用范围和可复用内容。' : `将 ${selected.length} 条原候选整理为 1 条；保存后仍需单独预览批准。`}</p>
    <footer><button className="quiet-button" onClick={onClose}>取消</button><button className="primary" disabled={Boolean(busy) || invalid} onClick={() => void save()}>保存待审候选</button></footer>
  </MemoryDialog>
}

export function MemoryApprovalDialog({ entry, busy, onClose, onApprove }: { entry: MemoryEntry; busy?: string; onClose: () => void; onApprove: () => Promise<boolean> }) {
  return <MemoryDialog title="预览将保存的记忆" onClose={onClose}><h3>{entry.title}</h3><p className="memory-preview-content">{entry.content}</p><p className="form-hint">批准后只在本项目召回。来源提交：{entry.sourceCommit?.slice(0, 12) ?? '手动记录'}。请核对适用范围和内容。</p><footer><button className="quiet-button" onClick={onClose}>返回</button><button className="primary" disabled={Boolean(busy)} onClick={() => void onApprove().then((ok) => { if (ok) onClose() })}>确认批准</button></footer></MemoryDialog>
}
