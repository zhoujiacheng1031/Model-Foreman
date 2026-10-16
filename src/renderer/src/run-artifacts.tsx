import type { ExecutionContract, RunSummary } from '../../shared/contracts'

function RawArtifact({ label, content }: { label: string; content?: string }) {
  return content ? <details className="raw-artifact"><summary>{label}（原始数据）</summary><pre>{content}</pre></details> : null
}

export function ContractSummary({ contract, raw }: { contract?: ExecutionContract; raw?: string }) {
  return <section className="readable-artifact"><h3>执行计划</h3>{contract ? <>
    <p>{contract.summary}</p>
    <ol className="readable-steps">{contract.steps.map((step) => <li key={step.id}><b>{step.title}</b><p>{step.description}</p>
      {!!step.acceptanceCriteria.length && <ul>{step.acceptanceCriteria.map((criterion, i) => <li key={i}>{criterion}</li>)}</ul>}
      {!!step.files.length && <small>涉及文件：{step.files.join('、')}</small>}
    </li>)}</ol>
    {!!contract.risks.length && <div><h4>需要留意</h4><ul>{contract.risks.map((risk, i) => <li key={i}>{risk}</li>)}</ul></div>}
    {!!contract.assumptions.length && <details><summary>前置条件</summary><ul>{contract.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
  </> : <LegacySummary content={raw} empty="规划完成后会显示步骤与验收标准。" />}
    <RawArtifact label="执行合同" content={raw} />
  </section>
}

function LegacySummary({ content, empty }: { content?: string; empty: string }) {
  if (!content) return <p className="empty-copy">{empty}</p>
  try {
    const parsed = JSON.parse(content)
    const summary = parsed.summary ?? parsed.result ?? parsed.message
    return <p>{typeof summary === 'string' ? summary : '已保存原始记录，可展开查看详情。'}</p>
  } catch { return <p className="plain-result">{content}</p> }
}

export function resultPreview(content: string): string {
  const first = content.match(/^[\s\S]*?[。！？](?:[\s\S]*?[。！？])?/)?.[0] ?? content
  return first.length > 200 ? `${first.slice(0, 200)}…` : first
}

export function RunOverview({ run, onOpenProject, onEvidence }: { run?: RunSummary; onOpenProject: () => void; onEvidence: () => void }) {
  const implementation = run?.implementationReport
  const review = run?.reviewDecision
  const verification = run?.verification
  const files = implementation?.filesChanged ?? [...new Set(run?.contract?.steps.flatMap((step) => step.files) ?? [])]
  return <div className="run-result-overview">
    <section className="readable-artifact result-primary"><div className="result-heading"><h3>{implementation && files.length === 1 ? `变更 ${files[0]}` : '成果摘要'}</h3>{run?.resolution === 'merged' && <button className="quiet-button" onClick={onOpenProject}>打开成果目录</button>}</div>
      {implementation ? <p className="plain-result">{resultPreview(implementation.summary)}</p> : <LegacySummary content={run?.result} empty="任务执行后将在这里显示成果摘要。" />}
      {!!files.length && <div><h4>{implementation ? '变更文件' : '计划涉及文件（以变更证据为准）'}</h4><ul className="result-files">{files.map((file) => <li key={file}>{file}</li>)}</ul></div>}
      {!!implementation?.unresolved.length && <div className="result-unresolved"><h4>未完成事项</h4><ul>{implementation.unresolved.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
      {run?.error && <p role="alert" className="form-hint error">{run.error}</p>}
    </section>
    <section className="readable-artifact review-summary"><p className={`verification-result ${verification?.status ?? 'pending'}`}>{!verification ? '独立验证：尚无记录' : verification.status === 'passed' ? '独立验证通过' : verification.status === 'failed' ? '独立验证未通过' : '独立验证已跳过：没有运行验证命令'}{review && <b> · 审核{review.verdict === 'approved' ? '通过' : review.verdict === 'blocked' ? '受阻' : '要求修改'}</b>}</p>
      <RawArtifact label="阅读完整执行报告" content={run?.result ?? (implementation ? JSON.stringify(implementation, null, 2) : undefined)} />
      {review ? <details className="review-details" open={review.verdict !== 'approved'}><summary>审核详情</summary><p>{review.summary}</p>{!!review.findings.length && <ul>{review.findings.map((finding, i) => <li key={i}><b>{finding.title}</b><p>{finding.requiredChange}</p></li>)}</ul>}<RawArtifact label="审核记录" content={run?.review} /></details> : <LegacySummary content={run?.review} empty="审核完成后会显示结论和待处理问题。" />}
      <button className="quiet-button" onClick={onEvidence}>查看变更与验证证据</button>
    </section>
  </div>
}
