import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "使用指南",
  description: "Model Foreman 快速上手：角色分工、Skills、长期目标、Desktop 接管、验证与交付。",
};

const steps = [
  { id: "prepare", index: "01", title: "准备本机环境", summary: "安装应用和至少一种执行器。", body: <>Model Foreman 0.5.7 支持 Apple Silicon Mac 与 Windows x64。准备一个已有 Git 仓库，或直接准备一个全新空文件夹；再安装并登录 <b>Codex CLI</b>、<b>Claude Code</b>，也可以在设置中接入兼容 API。Desktop 应用不是后台执行的必需项，但安装后可随时人工接管。</> },
  { id: "workspace", index: "02", title: "打开项目，监控交付状态", summary: "既可连接已有仓库，也可从空文件夹启动首个任务。", body: <>进入“工作台”的“项目与交付”，选择已有 Git 仓库，或在系统文件夹选择器中新建空文件夹。空项目的首个任务会自动初始化 <code>main</code> 和不包含任何文件的本地基线，再创建隔离 worktree；如果文件夹已有文件却没有 Git 基线，Foreman 会要求你先人工检查和提交，绝不会静默导入。连接 GitHub remote 后，还可按界面引导安装、登录 <b>GitHub CLI（gh）</b>，每 30 秒只读刷新 PR、Review、Checks 与近期 Actions。</> },
  { id: "skills", index: "03", title: "配置角色、模型与 Skills", summary: "三个角色分别选择执行器、模型和本轮必用 Skill。", body: <>前往“设置 → 角色与流程”。Planner、Implementer 与 Reviewer 可分别使用 Codex、Claude 或自定义 API；自定义模型支持 OpenAI Responses 与 Anthropic Messages 兼容协议，完整填写 URL、API Key 和模型名称后先点击“检测连接”。每个角色的 Skills 可交给模型自动匹配，也可勾选本轮指定必用项。</> },
  { id: "first-run", index: "04", title: "发起第一项任务", summary: "描述结果，并观察每一步真实消耗。", body: <>回到工作台，写清最终结果和约束。Planner 会先生成可编辑的执行合同；检查步骤、文件、验收标准与验证命令，逐步批准后 Implementer 才会开始修改代码。“步骤耗时与资源”会分别记录 Planner、Implementer、Verifier、Reviewer 及返工调用的耗时、模型、输入 / 输出 Token、费用、记忆与 Skill；CLI 没有报告的数据会显示 0，不做估算。</> },
  { id: "goal", index: "05", title: "创建长期目标", summary: "把复杂交付拆成可恢复的任务图。", body: <>在“长期目标”填写最终目标和逐条成功标准，并设置时间、Token、费用、循环和重试预算。Reviewer 的最大返工轮次位于“角色与流程”的协作流程策略中；每个节点都要经过实现、独立验证、审核与合并，下一节点才会解锁。</> },
  { id: "handoff", index: "06", title: "需要时交给 Desktop", summary: "一键带上完整任务上下文继续讨论。", body: <>任务详情出现“Codex 接管”或“Claude 接管”时，点击即可复制目标、计划、分支、结果与审核上下文并打开对应 Desktop。Desktop 负责人的临时判断，Foreman 继续负责可追溯的验证和最终交付。</> },
  { id: "deliver", index: "07", title: "审核证据并安全交付", summary: "查看 Diff 与门禁，再跟随向导逐步完成交付。", body: <>Reviewer 批准后，检查统一 Diff 与 Foreman 实际运行的 lint、typecheck、test、build 结果。交付向导会把保护源改动、创建任务提交、合并与清理拆成可理解的步骤：每次只显示当前需要处理的决定、影响和结果，不会跳步执行，也不会 force push 或丢弃源项目改动。完成交付后，审核通过的决策、约束与 SOP 才能进入长期记忆候选。</> },
];

export default function GuidePage() {
  return <main className="guide-page fiber-site">
    <header className="nav-shell new-nav guide-topnav">
      <Link className="brand" href="/" aria-label="返回 Model Foreman 首页"><span className="brand-mark" aria-hidden="true" /><strong>Model Foreman</strong><em>Guide</em></Link>
      <nav aria-label="指南导航"><a href="#quickstart">快速开始</a><a href="#skills">Skills</a><a href="#goal">长期目标</a><a href="#troubleshooting">排查问题</a></nav>
      <Link className="nav-cta" href="/">返回产品页</Link>
    </header>

    <section className="guide-hero">
      <div className="guide-aura" aria-hidden="true" />
      <span className="hero-pill"><i /> MODEL FOREMAN GUIDE</span>
      <h1><span className="title-lock">从第一个任务，</span><wbr /><em className="title-lock">到长期可信交付。</em></h1>
      <p>这份指南带你完成仓库与 PR 监控、角色分工、Skill 配置、长期目标、Desktop 接管与安全交付。</p>
      <div className="guide-hero-actions"><a className="button primary" href="#quickstart">开始教程</a><span>约 10 分钟 · 无需 API Key</span></div>
    </section>

    <section className="guide-prereqs" aria-label="开始前准备">
      <article><span>01</span><b>桌面系统</b><small>macOS Apple Silicon / Windows x64</small></article>
      <article><span>02</span><b>已有仓库或空项目</b><small>本地 · GitHub · 从零开始</small></article>
      <article><span>03</span><b>至少一个执行器</b><small>Codex CLI 或 Claude Code</small></article>
      <article><span>04</span><b>可选 Desktop</b><small>用于人工接管</small></article>
    </section>

    <section className="guide-layout" id="quickstart">
      <aside className="guide-index">
        <small>快速开始</small>
        {steps.map(step => <a href={`#${step.id}`} key={step.id}><span>{step.index}</span>{step.title}</a>)}
        <a href="#troubleshooting"><span>08</span>常见问题</a>
      </aside>
      <div className="guide-content">
        <div className="guide-intro"><span>QUICKSTART</span><h2>完成一次完整的 Foreman 工作流</h2><p>建议第一次先选择一个边界清楚、可以在 30 分钟内验证的小任务。熟悉计划批准、验证和交付闭环后，再启动长期 Goal。</p></div>
        {steps.map((step) => <article className="guide-step" id={step.id} key={step.id}>
          <div className="guide-step-number">{step.index}</div>
          <div className="guide-step-copy"><small>STEP {step.index}</small><h3>{step.title}</h3><strong>{step.summary}</strong><p>{step.body}</p>
            {step.id === "workspace" && <div className="guide-checklist"><span>空项目自动建立本地安全基线</span><span>已有文件绝不静默暂存或提交</span><span>GitHub 项目继续监控 PR 与 Actions</span></div>}
            {step.id === "workspace" && <div className="guide-callout gh-guide"><div><small>INSTALL</small><b>brew install gh</b></div><i>›</i><div><small>LOGIN</small><b>gh auth login</b></div><i>›</i><div><small>FOREMAN</small><b>重新检测</b></div></div>}
            {step.id === "skills" && <div className="guide-callout skill-guide"><div><span>AUTO</span><b>原生自动匹配</b><small>模型按描述渐进式选择</small></div><i>或</i><div><span>EXPLICIT</span><b>界面勾选指定必用</b><small>写入角色合同并强制读取</small></div></div>}
            {step.id === "goal" && <div className="guide-checklist"><span>成功标准必须可验证</span><span>设置明确的终止预算</span><span>工作区变化后先重新验证</span></div>}
            {step.id === "first-run" && <div className="guide-callout usage-guide"><div><small>TIME</small><b>每步真实耗时</b></div><div><small>TOKENS</small><b>输入 / 输出分开</b></div><div><small>RESOURCE</small><b>模型、Skill 与验证</b></div></div>}
            {step.id === "handoff" && <div className="guide-callout handoff-guide"><div><small>BACKGROUND</small><b>CLI 自动执行</b></div><i>›</i><div><small>CONTEXT</small><b>Foreman 整理交接</b></div><i>›</i><div><small>HUMAN LOOP</small><b>Desktop 接管</b></div></div>}
            {step.id === "deliver" && <div className="guide-callout git-guide"><div><small>PROTECT</small><b>先处理源项目改动</b></div><i>›</i><div><small>COMMIT</small><b>创建任务提交</b></div><i>›</i><div><small>MERGE</small><b>确认后合并与清理</b></div></div>}
          </div>
        </article>)}

        <section className="troubleshooting" id="troubleshooting">
          <span>TROUBLESHOOTING</span><h2>遇到问题时，按现象逐项检查。</h2>
          <details><summary>没有检测到 Codex 或 Claude Code</summary><p>先在终端确认对应 CLI 可以正常运行并已经登录，然后回到“设置 → 角色与流程”重新扫描环境。Desktop 与 CLI 是分别检测的，只有 Desktop 缺失不会影响后台任务。</p></details>
          <details><summary>自定义 API 模型无法使用</summary><p>确认协议、Base URL、API Key 和模型名称均已填写，再点击“检测连接”。Foreman 会发送最小预检请求；只有配置完整且预检通过的模型才适合分配给角色。API Key 保存在本机设置中，不会显示在运行日志或命令参数里。</p></details>
          <details><summary>Skill 没有出现在角色设置里</summary><p>确认 Skill 包含有效的 SKILL.md，并放在当前项目或用户级原生目录中；再检查它是否被 Codex 配置、Claude skillOverrides 或 Plugin 设置禁用。</p></details>
          <details><summary>计划完成后没有自动编码</summary><p>这是预期的安全门禁。Foreman 会停在“等待批准”，需要你检查并批准执行合同，Implementer 才会获得隔离工作区写权限。</p></details>
          <details><summary>可以直接从空仓库或空文件夹开始吗</summary><p>可以。选择或新建一个空文件夹，首个普通任务或长期 Goal 会自动初始化 main、创建不含文件的本地基线，再进入隔离 worktree。若目录已经包含文件但尚无 Git commit，需要先由你检查并手动建立基线，避免敏感文件被误提交。</p></details>
          <details><summary>为什么看不到 PR 或 CI/CD 状态</summary><p>确认仓库 remote 指向 GitHub，并在终端安装、登录 GitHub CLI（gh）。Foreman 的交付监控是只读的；没有登录时仍可正常查看本地 Git 状态。</p></details>
          <details><summary>任务完成后怎样合并到项目</summary><p>打开任务的交付向导，按顺序处理源项目改动、任务提交、合并和 worktree 清理。界面会解释当前步骤为何受阻以及接下来要做什么；每次只执行你明确确认的当前步骤。</p></details>
          <details><summary>无法自动合并</summary><p>确认源仓库没有未提交改动，且源分支没有和任务分支发生分叉。Foreman 会保留 worktree，避免覆盖你的工作。</p></details>
        </section>
      </div>
    </section>

    <section className="guide-next"><span>READY</span><h2>从一个小而明确的任务开始。</h2><p>让第一次运行走完整个计划、批准、实现、验证、审核与交付闭环。</p><Link className="button primary" href="/">返回 Model Foreman</Link></section>
    <footer><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true" /><strong>Model Foreman</strong></Link><p>强模型决定方向。证据决定交付。</p><span><Link href="/">产品首页</Link> · © 2026</span></footer>
  </main>;
}
