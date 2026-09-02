"use client";

import { useState } from "react";

const stories = [
  {
    id: "plan",
    index: "01",
    eyebrow: "PLAN",
    title: "强模型先把方向想清楚",
    titleParts: ["强模型先把", "方向想清楚"],
    copy: "Planner 读取目标、代码库和约束，先产出可编辑的工程合同。你批准的不是一句提示词，而是步骤、文件、验收标准与门禁。",
  },
  {
    id: "build",
    index: "02",
    eyebrow: "BUILD",
    title: "执行模型只在隔离区动手",
    titleParts: ["执行模型", "只在隔离区动手"],
    copy: "Codex 或 Claude Code 在当前仓库内创建的 worktree 中编码。进度、模型输出、Skills、Token 与耗时持续回到同一条运行时间线。",
  },
  {
    id: "verify",
    index: "03",
    eyebrow: "VERIFY",
    title: "证据决定任务是否完成",
    titleParts: ["证据决定", "任务是否完成"],
    copy: "Foreman 本地运行 lint、typecheck、test 与 build。模型说“完成”不算完成，只有可复现的门禁结果才能进入审核。",
  },
  {
    id: "deliver",
    index: "04",
    eyebrow: "DELIVER",
    title: "最后一步仍由人类掌控",
    titleParts: ["最后一步", "仍由人类掌控"],
    copy: "Reviewer 独立检查需求、Diff 和证据。Commit、Push、PR 与合并按影响分级，需要外部写入时停下来请你确认。",
  },
] as const;

function ProductFrame({ active }: { active: number }) {
  return (
    <div className="story-product" aria-live="polite">
      <div className="story-window-bar">
        <span className="traffic"><i /><i /><i /></span>
        <b>Model Foreman</b>
        <em><i /> LOCAL</em>
      </div>
      <div className="story-window-body">
        <aside className="story-side" aria-hidden="true">
          <span className="story-mini-logo" />
          {stories.map((story, index) => <i className={active === index ? "active" : ""} key={story.id}>{story.index}</i>)}
        </aside>
        <div className="story-screen">
          <div className="story-screen-head"><span><small>CURRENT RUN</small><b>可信认证升级</b></span><em>{stories[active].eyebrow}</em></div>
          <div className="story-progress"><i style={{ width: `${(active + 1) * 25}%` }} /></div>

          <div className={`story-scene scene-plan ${active === 0 ? "active" : ""}`} aria-hidden={active !== 0}>
            <div className="plan-sheet"><small>IMPLEMENTATION CONTRACT</small><h3>认证边界与会话轮换</h3><p>先固定行为，再修改实现。</p><div className="plan-row done"><i>✓</i><span><b>定位认证入口</b><small>3 files · read only</small></span></div><div className="plan-row"><i>2</i><span><b>轮换 refresh token</b><small>acceptance · replay blocked</small></span></div><div className="plan-row"><i>3</i><span><b>补齐集成门禁</b><small>test · build · security</small></span></div></div>
            <div className="approval-chip"><span>Human gate</span><b>等待批准</b></div>
          </div>

          <div className={`story-scene scene-build ${active === 1 ? "active" : ""}`} aria-hidden={active !== 1}>
            <div className="build-head"><span><small>ISOLATED WORKTREE</small><b>foreman/auth-rotation</b></span><em>Codex</em></div>
            <div className="code-panel"><span><i className="purple">1</i><code>export async function rotateSession()</code></span><span><i>2</i><code>{`  const token = await issueToken()`}</code></span><span><i>3</i><code>{`  await revoke(previousToken)`}</code></span><span><i>4</i><code>{`  return { token, expiresAt }`}</code></span></div>
            <div className="build-stats"><span><small>FILES</small><b>+ 4</b></span><span><small>TIME</small><b>2m 44s</b></span><span><small>TOKENS</small><b>57.5k</b></span></div>
          </div>

          <div className={`story-scene scene-verify ${active === 2 ? "active" : ""}`} aria-hidden={active !== 2}>
            <div className="verify-orb"><span>✓</span><b>VERIFIED</b><small>30 / 30 gates passed</small></div>
            <div className="gate-list"><span><i>✓</i><b>Typecheck</b><em>4.2s</em></span><span><i>✓</i><b>Integration tests</b><em>18.8s</em></span><span><i>✓</i><b>Production build</b><em>11.6s</em></span></div>
          </div>

          <div className={`story-scene scene-deliver ${active === 3 ? "active" : ""}`} aria-hidden={active !== 3}>
            <div className="deliver-card"><small>READY TO DELIVER</small><h3>变更、证据与审核已对齐</h3><div className="deliver-status"><span><i />Reviewer approved</span><span><i />Source branch clean</span><span><i />4 checks passed</span></div><button type="button">查看并确认交付 <b>→</b></button></div>
            <div className="pr-chip"><span>PR #128</span><b>Ready</b></div>
          </div>
        </div>
      </div>
      <div className="story-window-foot"><span><i />当前步骤可暂停并恢复</span><b>{active + 1} / {stories.length}</b></div>
    </div>
  );
}

export default function FeatureStory() {
  const [active, setActive] = useState(0);

  return (
    <section className="story-section" id="workflow">
      <div className="story-orbit orbit-one" aria-hidden="true" /><div className="story-orbit orbit-two" aria-hidden="true" />
      <div className="section-heading centered story-heading"><span className="section-kicker"><b>多模型协作</b><em>ONE CONTROLLED THREAD</em></span><h2 className="section-title"><span className="title-lock">从一句目标，</span><wbr /><span className="title-lock">到一份可交付的证据。</span></h2><p>同一个任务窗口，四个明确阶段。选择一个阶段，查看 Foreman 如何让不同模型各司其职，同时把最终控制权留给你。</p></div>
      <div className="story-layout">
        <div className="story-copy-list">
          {stories.map((story, index) => (
            <article className={active === index ? "active" : ""} key={story.id}>
              <button type="button" onClick={() => setActive(index)} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} aria-label={`查看${story.title}`} aria-pressed={active === index}>
                <span className="story-number">{story.index}</span><span className="story-article-copy"><small>{story.eyebrow}</small><h3><span className="title-lock">{story.titleParts[0]}</span><wbr /><span className="title-lock">{story.titleParts[1]}</span></h3><p>{story.copy}</p></span><i>↗</i>
              </button>
            </article>
          ))}
        </div>
        <div className="story-sticky"><ProductFrame active={active} /></div>
      </div>
    </section>
  );
}
