/* eslint-disable @next/next/no-img-element */
import ProductTour from "./ProductTour";

const workflow = [
  ["01", "规划", "强模型读取目标、仓库与约束，先形成可编辑的工程计划。"],
  ["02", "隔离执行", "执行模型在独立 worktree 中修改代码，主工作区保持干净。"],
  ["03", "本地验证", "Foreman 亲自运行门禁，保留可复现的测试与构建证据。"],
  ["04", "人工批准", "审核结论、Diff 与风险同时呈现，远端写入前由你确认。"],
];

const capabilities = [
  ["长期目标", "任务图、预算、重试与检查点持续保存，关闭窗口后也能从安全阶段恢复。"],
  ["工程记忆", "决策、约束与 SOP 在本地沉淀；关联代码变化后自动失效，避免旧知识误导执行。"],
  ["自定义模型", "支持 OpenAI Responses 与 Anthropic Messages 兼容端点，并在启用前检测连通性。"],
];

export default function Home() {
  return (
    <main className="product-home-v2">
      <header className="mf-nav">
        <a className="mf-brand" href="#top" aria-label="Model Foreman 首页">
          <span className="brand-mark" aria-hidden="true" />
          <strong>Model Foreman</strong>
        </a>
        <nav aria-label="主导航">
          <a href="#tour">产品导览</a>
          <a href="#workflow">工作方式</a>
          <a href="#capabilities">核心能力</a>
          <a href="#download">安全与下载</a>
        </nav>
        <div className="mf-nav-actions">
          <a href="/guide">使用指南</a>
          <a className="mf-nav-github" href="https://github.com/zhoujiacheng1031/Model-Foreman">GitHub</a>
        </div>
      </header>

      <section className="mf-hero" id="top">
        <div className="mf-hero-copy">
          <span className="mf-eyebrow"><i /> LOCAL-FIRST AGENT ORCHESTRATION</span>
          <h1>从目标到交付，<em>每一步都有证据。</em></h1>
          <p>Model Foreman 把规划、隔离执行、本地验证与人工批准串进同一条可恢复的工程工作流。</p>
          <div className="mf-actions">
            <a className="mf-button mf-button-primary" href="https://github.com/zhoujiacheng1031/Model-Foreman/releases/latest">下载桌面版</a>
            <a className="mf-button mf-button-secondary" href="/guide">查看使用指南</a>
          </div>
        </div>

        <ProductTour />
      </section>

      <section className="mf-section mf-workflow" id="workflow">
        <div className="mf-section-heading">
          <span className="mf-kicker">CONTROLLED DELIVERY</span>
          <h2>不是多开几个模型，<br />而是让每一步可控。</h2>
          <p>同一个任务窗口，四个职责明确的阶段。模型负责能力，Foreman 负责边界、证据与恢复。</p>
        </div>
        <div className="mf-flow-grid">
          {workflow.map(([index, title, copy]) => (
            <article key={index}>
              <span>{index}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mf-section mf-real-ui" id="product">
        <div className="mf-section-heading centered">
          <span className="mf-kicker">REAL PRODUCT, REAL WORKFLOW</span>
          <h2>界面只呈现下一步需要的事。</h2>
          <p>角色、任务与模型设置遵循同一套层级和间距。以下均为真实应用界面，敏感路径已经脱敏。</p>
        </div>
        <div className="mf-shot-grid">
          <figure className="mf-shot mf-shot-wide">
            <div><img src="/product-task-input.png" alt="Model Foreman 发起任务界面" /></div>
            <figcaption><span>任务输入</span><strong>先描述结果，再决定如何编排</strong></figcaption>
          </figure>
          <figure className="mf-shot">
            <div><img src="/product-roles.png" alt="Model Foreman 角色与流程界面" /></div>
            <figcaption><span>角色与流程</span><strong>规划、执行、审核各有边界</strong></figcaption>
          </figure>
          <figure className="mf-shot mf-shot-settings">
            <div><img src="/product-settings.png" alt="Model Foreman 自定义模型设置界面" /></div>
            <figcaption><span>模型设置</span><strong>兼容端点、连接检测与角色映射</strong></figcaption>
          </figure>
        </div>
      </section>

      <section className="mf-section mf-capabilities" id="capabilities">
        <div className="mf-section-heading">
          <span className="mf-kicker">ENGINEERING CERTAINTY</span>
          <h2>复杂归系统，<br />清晰留给你。</h2>
        </div>
        <div className="mf-capability-grid">
          {capabilities.map(([title, copy], index) => (
            <article key={title}>
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mf-section mf-download" id="download">
        <div className="mf-download-copy">
          <span className="mf-kicker">LOCAL BY DESIGN</span>
          <h2>代码、密钥与运行证据，<br />始终留在你的机器上。</h2>
          <p>复用本机 Codex CLI 与 Claude Code 登录；自定义 API Key 仅作为执行器环境变量注入，不进入项目仓库或任务日志。</p>
          <div className="mf-actions left">
            <a className="mf-button mf-button-primary" href="https://github.com/zhoujiacheng1031/Model-Foreman/releases/latest">获取 v0.5.5</a>
            <a className="mf-button mf-button-secondary" href="https://github.com/zhoujiacheng1031/Model-Foreman">查看源代码</a>
          </div>
        </div>
        <div className="mf-safety-list">
          <article><span>01</span><div><h3>权限最小化</h3><p>规划与审核只读，执行只写隔离工作区。</p></div></article>
          <article><span>02</span><div><h3>人类批准远端写入</h3><p>Commit、Push、PR 与合并按影响分级确认。</p></div></article>
          <article><span>03</span><div><h3>本地持久化</h3><p>SQLite、FTS5、运行日志与检查点无需云端服务。</p></div></article>
        </div>
      </section>

      <footer className="mf-footer">
        <a className="mf-brand" href="#top"><span className="brand-mark" aria-hidden="true" /><strong>Model Foreman</strong></a>
        <p>强模型定方向，证据决定交付。</p>
        <span><a href="/guide">使用指南</a> · © 2026</span>
      </footer>
    </main>
  );
}
