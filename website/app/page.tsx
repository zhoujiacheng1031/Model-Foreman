import FeatureStory from "./FeatureStory";

const capabilities = [
  { icon: "⌘", title: "长期 Goal Engine", copy: "任务图、预算、重试和检查点全部持久化。关掉应用，目标仍会从安全阶段继续。", className: "feature-goal" },
  { icon: "✓", title: "证据与资源账本", copy: "Foreman 亲自运行门禁，并按步骤记录耗时、模型、输入 / 输出 Token、费用和本地验证资源。", className: "feature-proof" },
  { icon: "◉", title: "本地工程记忆", copy: "决策、约束与 SOP 原子化保存；关联代码变化后自动失效，不让旧知识误导执行。", className: "feature-memory" },
  { icon: "↔", title: "自定义模型接入", copy: "除 Codex 与 Claude CLI 外，还可配置 OpenAI Responses 或 Anthropic Messages 兼容端点，并先用最小请求检测连通性。", className: "feature-models" },
];

const goalSteps = [
  ["01", "分析仓库与约束", "已完成"],
  ["02", "实现认证升级", "已完成"],
  ["03", "验证与安全审计", "进行中"],
  ["04", "审核并交付", "等待中"],
];

export default function Home() {
  return (
    <main className="fiber-site">
      <header className="nav-shell new-nav">
        <a className="brand" href="#top" aria-label="Model Foreman 首页">
          <span className="brand-mark" aria-hidden="true" /><strong>Model Foreman</strong>
        </a>
        <nav aria-label="主导航"><a href="#workflow">编排方式</a><a href="#features">产品能力</a><a href="#repository">安全交付</a><a href="/guide">使用指南</a></nav>
        <a className="nav-cta" href="https://github.com/zhoujiacheng1031/Model-Foreman">GitHub <span>↗</span></a>
      </header>

      <section className="hero fiber-hero" id="top">
        <div className="fiber-sky" aria-hidden="true"><i /><i /><i /></div>
        <div className="hero-copy fiber-copy">
          <span className="hero-pill"><i /> LOCAL-FIRST AGENT ORCHESTRATION</span>
          <h1><span className="title-lock">把多个模型，</span><wbr /><em className="title-lock">拧成一条交付线。</em></h1>
          <p>强模型定方向，执行模型写代码，独立门禁决定能否交付。Model Foreman 把长期目标、Skills、GitHub 与人工批准编进一条可恢复的工程工作流。</p>
          <div className="hero-actions"><a className="button primary" href="#workflow">查看编排方式</a><a className="button glass-button" href="/guide">打开使用指南 <span>↗</span></a></div>
        </div>

        <div className="fiber-console" aria-label="Model Foreman 多模型编排预览">
          <div className="fiber-console-top"><span className="traffic"><i /><i /><i /></span><b>Delivery thread · authentication upgrade</b><em><i /> RUNNING</em></div>
          <div className="thread-canvas">
            <div className="thread-role planner"><small>01 · PLAN</small><b>GPT-5.6 Sol</b><span>理解目标与仓库</span><i /></div>
            <div className="thread-role builder"><small>02 · BUILD</small><b>Codex / Claude</b><span>隔离环境内实现</span><i /></div>
            <div className="thread-role reviewer"><small>03 · REVIEW</small><b>GPT-5.6 Sol</b><span>独立审核变更</span><i /></div>
            <div className="thread-lines" aria-hidden="true"><i /><i /><i /></div>
            <div className="thread-core"><span>✓</span><b>VERIFIED</b><small>30 / 30 gates passed</small></div>
            <div className="thread-status"><span><i />main · clean</span><span>48k tokens</span><span>3m 35s</span></div>
          </div>
        </div>
        <div className="hero-trust"><span>v0.5.5 · macOS + Windows</span><i /><span>Codex + Claude + Custom API</span><i /><span>长期 Goal + 原生 Skills</span><i /><span>独立验证 + 人工门禁</span></div>
      </section>

      <FeatureStory />

      <section className="goals section" id="goals">
        <div className="goal-shell">
          <div className="goal-copy"><span className="section-kicker"><b>长期目标</b><em>DURABLE GOALS</em></span><h2 className="section-title"><span className="title-lock">关掉应用，</span><wbr /><span className="title-lock">目标继续。</span></h2><p>Foreman 将目标拆成有依赖关系的任务图。暂停、重启、重试或重新规划，都不会丢失状态、证据和预算。</p><a href="#features">了解 Goal Engine <b>›</b></a></div>
          <div className="goal-demo">
            <div className="goal-card">
              <div className="goal-card-head"><div><span className="goal-orb">G</span><span><small>ACTIVE GOAL</small><b>交付可信认证升级</b></span></div><em>68%</em></div>
              <div className="goal-progress"><i /></div>
              <div className="goal-steps">{goalSteps.map(([index,title,state], i) => <div className={`goal-step step-${i}`} key={index}><span>{i < 2 ? "✓" : index}</span><b>{title}</b><em>{state}</em></div>)}</div>
              <div className="goal-budget"><span><small>时间预算</small><b>24 小时</b></span><span><small>Token 预算</small><b>120k</b></span><span><small>最大重试</small><b>3 次</b></span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="repository-section section feature-track" id="repository">
        <div className="repository-copy feature-track-copy"><span className="section-kicker"><b>交付控制</b><em>DELIVERY CONTROL</em></span><h2 className="section-title"><span className="title-lock">从空项目开始，</span><wbr /><span className="title-lock">也能安全交付。</span></h2><p>打开已有仓库，或新建空文件夹直接启动首个任务。Foreman 会建立不含文件的本地 Git 基线，再在隔离 worktree 中编码；PR、Review 与 Actions 集中监控，Commit、合并与清理由交付向导逐步完成。</p><a className="text-link" href="/guide#workspace">查看新项目与交付向导教程 <b>›</b></a></div>
        <div className="repository-demo" aria-label="GitHub PR、CI/CD 和交付向导预览">
          <div className="repo-actions"><button>打开或创建本地项目</button><button>从 GitHub 克隆</button></div>
          <div className="repo-head"><span className="repo-avatar">M</span><span><small>GITHUB REPOSITORY</small><b>model-foreman</b><em>github.com/acme/model-foreman</em></span><i>CLEAN</i></div>
          <div className="repo-branch"><span><small>CURRENT BRANCH</small><b>⌁ main</b></span><span><small>HEAD</small><b>a0c82f0</b></span><span><small>UPSTREAM</small><b>origin/main</b></span></div>
          <div className="repo-grid"><span><b>0</b><small>AHEAD</small></span><span><b>0</b><small>BEHIND</small></span><span><b>0</b><small>STAGED</small></span><span><b>0</b><small>UNSTAGED</small></span><span><b>0</b><small>UNTRACKED</small></span><span><b>0</b><small>CONFLICTS</small></span></div>
          <div className="delivery-strip"><div><small>OPEN PULL REQUEST</small><b>#128 · Authentication hardening</b><span><i className="pass" />4 checks passed <em>APPROVED</em></span></div><div><small>RECENT ACTIONS</small><span><i className="pass" />test · success</span><span><i className="run" />release · running</span></div></div>
          <div className="safe-git-preview"><span><small>DELIVERY GUIDE</small><b>保护源改动 → 创建任务提交 → 合并 → 清理</b></span><em>一次只执行当前步骤</em></div>
          <div className="repo-policy"><i>!</i><span><b>高风险操作保留人工门禁</b><small>交付向导一次只推进一个就绪步骤，不自动 force push，也不会丢弃源项目改动。</small></span></div>
        </div>
      </section>

      <section className="observability-section section feature-track" id="observability">
        <div className="observability-copy feature-track-copy"><span className="section-kicker"><b>运行可观测</b><em>RUN OBSERVABILITY</em></span><h2 className="section-title"><span className="title-lock">每一步都</span><wbr /><span className="title-lock">看得见成本。</span></h2><p>Planner、Implementer、Foreman Verifier 与 Reviewer 的每一次调用都单独计时。输入 / 输出 Token、费用、模型、推理强度、记忆和 Skill 使用都进入同一份运行账本。</p><div className="observability-points"><span><i>01</i><b>按步骤拆分</b><small>返工和协议修复不会被总数掩盖</small></span><span><i>02</i><b>本地验证独立统计</b><small>命令数量与通过结果不计入模型 Token</small></span><span><i>03</i><b>CLI 如实报告</b><small>未报告的 Token 显示 0，不做虚假估算</small></span></div></div>
        <div className="usage-ledger-demo" aria-label="步骤耗时与资源账本预览">
          <div className="usage-ledger-head"><span><small>STEP RESOURCE LEDGER</small><b>安全令牌轮换</b></span><div><span><b>3m 35s</b><small>TIME</small></span><span><b>92.3k</b><small>TOKENS</small></span><span><b>$0.543</b><small>COST</small></span></div></div>
          <div className="usage-ledger-rows">
            <div><i className="plan">01</i><span><b>规划 · GPT-5.6 Sol</b><small>high · 4 memories · 1 skill</small></span><em>18.4s</em><strong>14.8k</strong><u>$0.084</u></div>
            <div><i className="build">02</i><span><b>执行 · GPT-5.6 Terra</b><small>xhigh · 6 memories · 2 skills</small></span><em>2m 44s</em><strong>57.5k</strong><u>$0.312</u></div>
            <div><i className="verify">03</i><span><b>独立验证 · Foreman Local</b><small>2 commands · 2 passed</small></span><em>5.1s</em><strong>0</strong><u>$0</u></div>
            <div><i className="review">04</i><span><b>审核 · Claude Opus</b><small>high · independent review</small></span><em>27.6s</em><strong>20.0k</strong><u>$0.147</u></div>
          </div>
        </div>
      </section>

      <section className="features section" id="features">
        <div className="section-heading centered"><span className="section-kicker"><b>工程确定性</b><em>ENGINEERING CERTAINTY</em></span><h2 className="section-title"><span className="title-lock">复杂归系统，</span><wbr /><span className="title-lock">清晰留给你。</span></h2><p>从协议校验到工程记忆，每一层都在减少不确定性，而不是增加一个新的黑箱。</p></div>
        <div className="feature-grid">{capabilities.map((item) => <article className={item.className} key={item.title}><div className="feature-copy"><span className="feature-icon">{item.icon}</span><h3>{item.title}</h3><p>{item.copy}</p></div><div className="feature-art" aria-hidden="true">
          {item.className === "feature-goal" && <div className="mini-goal"><span>Goal</span><i /><i /><i /><b>68%</b></div>}
          {item.className === "feature-proof" && <div className="proof-ring"><span>✓</span><b>VERIFIED</b><small>30 tests passed</small></div>}
          {item.className === "feature-memory" && <div className="memory-stack"><i>决策</i><i>约束</i><i>SOP</i></div>}
          {item.className === "feature-models" && <div className="model-stack"><i><b>OpenAI Responses</b><small>custom base URL</small></i><i><b>Anthropic Messages</b><small>compatible endpoint</small></i><i><b>连接检测</b><small>verified before use</small></i></div>}
        </div></article>)}</div>
      </section>

      <section className="desktop-section section" id="desktop">
        <div className="desktop-shell">
          <div className="desktop-copy">
            <span className="section-kicker"><b>桌面接管</b><em>CLI × DESKTOP</em></span>
            <h2 className="section-title"><span className="title-lock">自动执行，</span><wbr /><span className="title-lock">随时接管。</span></h2>
            <p>Foreman 让 CLI 保持可恢复的后台执行。需要深入讨论、临时调整或亲自判断时，它会整理目标、计划、分支、验证与审核上下文，再打开 Codex 或 Claude Desktop 接管。</p>
            <div className="desktop-points"><span><i>1</i><b>后台持续推进</b><small>关闭窗口后仍从安全检查点恢复</small></span><span><i>2</i><b>完整上下文交接</b><small>不是只复制最后一句对话</small></span><span><i>3</i><b>回到证据闭环</b><small>验证与交付仍由 Foreman 管理</small></span></div>
          </div>
          <div className="handoff-demo" aria-label="从 CLI 到 Desktop 的接管流程">
            <div className="handoff-app"><small>AUTOMATED</small><b>Codex CLI</b><span><i />Implementing</span></div>
            <div className="handoff-line"><span>目标 · 计划 · Diff · 证据</span><i>›</i></div>
            <div className="handoff-app desktop"><small>HANDOFF</small><b>Codex Desktop</b><span><i />Ready for you</span></div>
            <div className="handoff-review"><span>Foreman Verification</span><b>✓ VERIFIED</b></div>
          </div>
        </div>

        <div className="skills-shell">
          <div className="skills-visual" aria-hidden="true">
            <div className="skill-orbit"><span className="skill-core">Skill</span><i className="orbit-one" /><i className="orbit-two" /><b className="skill-chip skill-codex">$code-review</b><b className="skill-chip skill-claude">/frontend-design</b><b className="skill-chip skill-project">project</b></div>
          </div>
          <div className="skills-copy">
            <span className="section-kicker"><b>原生技能</b><em>NATIVE SKILLS</em></span><h2 className="section-title"><span className="title-lock">复用你已有的</span><wbr /><span className="title-lock"> Skills。</span></h2>
            <p>Foreman 按两套工具各自的原生目录、Plugin 命名空间和禁用设置扫描 Skill。每个角色既可以让模型自动匹配，也可以指定本轮必须使用的 Skill。</p>
            <div className="skill-modes"><div><b>自动匹配</b><small>让角色根据任务和 Skill 描述渐进式选择</small></div><div><b>指定必用</b><small>把选定 Skill 写入角色合同，执行前必须读取</small></div></div>
            <a className="text-link" href="/guide#skills">查看 Skill 配置教程 <b>›</b></a>
          </div>
        </div>
      </section>

      <section className="security section" id="security">
        <div className="security-shell">
          <div className="security-visual"><div className="privacy-orb"><span>⌾</span><i /><i /></div><small>LOCAL BY DESIGN</small></div>
          <div className="security-copy"><span className="section-kicker"><b>本地优先</b><em>LOCAL BY DESIGN</em></span><h2 className="section-title"><span className="title-lock">代码始终</span><wbr /><span className="title-lock">属于你。</span></h2><p>Foreman 默认复用本机已有的 Codex CLI 与 Claude Code 登录。自定义 API Key 只保存在本机设置中并作为执行器环境变量注入，不进入命令、任务日志或项目仓库。</p><ul><li><i>✓</i><span><b>权限最小化</b><small>规划与审核只读，执行只写隔离工作区</small></span></li><li><i>✓</i><span><b>人类批准合并</b><small>任何代码进入主分支前，都由你做最后决定</small></span></li><li><i>✓</i><span><b>本地数据存储</b><small>SQLite、FTS5 与事件证据不依赖云端服务</small></span></li></ul></div>
        </div>
      </section>

      <section className="install section" id="install">
        <div className="install-glow" aria-hidden="true" />
        <span className="section-kicker"><b>获取应用</b><em>MODEL FOREMAN 0.5.5</em></span><h2 className="section-title"><span className="title-lock">把模型能力</span><wbr /><span className="title-lock">变成确定交付。</span></h2><p>支持 Apple Silicon Mac 与 Windows x64。连接你已经在使用的编码智能体，或接入自己的兼容 API，开始第一项可信交付。</p>
        <div className="install-actions"><a className="button primary" href="https://github.com/zhoujiacheng1031/Model-Foreman">查看 GitHub 源码</a><a className="text-link" href="/guide">打开使用指南 <b>›</b></a></div>
        <div className="requirements" id="requirements"><span><small>平台</small><b>macOS Apple Silicon / Windows x64</b></span><span><small>执行器</small><b>Codex / Claude / Custom API</b></span><span><small>仓库</small><b>已有 Git 仓库或空文件夹</b></span><span><small>数据</small><b>本地 SQLite</b></span></div>
      </section>

      <footer><a className="brand" href="#top"><span className="brand-mark" aria-hidden="true" /><strong>Model Foreman</strong></a><p>强模型决定方向。证据决定交付。</p><span><a href="/guide">使用指南</a> · © 2026</span></footer>
    </main>
  );
}
