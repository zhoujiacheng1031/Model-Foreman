# Model Foreman

Model Foreman 是一个本地优先的多模型开发编排工作台：规划者先把需求变成可审核的执行合同，执行者只在隔离 worktree 中修改代码，验证器运行真实工程门禁，审核者再根据 Diff 与证据决定是否交付。

当前版本：**0.5.5** · 支持 macOS（Apple Silicon）与 Windows（x64）。

[产品官网](https://model-foreman.jiachengz135.chatgpt.site) · [使用指南](https://model-foreman.jiachengz135.chatgpt.site/guide)

## 当前能力

- 可视化配置 Planner、Implementer、Reviewer 的执行器、模型、推理强度和提示词
- 自定义 API 模型：支持 OpenAI Responses 与 Anthropic Messages 兼容接口，可配置 Base URL、API Key 和模型名称，并在设置页执行最小请求检测连通性
- 持久化 Goal Runtime：把成功标准展开为有依赖关系的 Task Graph，由 Durable Scheduler 跨应用重启持续推进
- Goal 支持时间、Token、费用和循环预算，任务级重试、人工暂停/恢复、明确终止原因与确定性完成裁决
- Codex CLI 与 Claude Code CLI Adapter，并自动检测本机安装状态
- 工作台项目与交付面板：打开已有本地 Git 仓库、直接选择/新建空文件夹从零开发，或从 GitHub HTTPS/SSH 地址克隆；展示当前分支、HEAD、上游、ahead/behind、工作区状态、PR、Review、Checks 与近期 Actions
- 慎重 Git 助手：Commit / Push 必须先预览、再输入一次性确认短语；只提交已暂存文件，只推送既有 upstream，禁止自动暂存、自动创建 upstream 和 force push
- GitHub CLI 就绪引导：在工作台检测 `gh` 安装与登录状态，提供 `brew install gh`、`gh auth login`、官方指南和重新检测步骤，不代替用户授权或保存 GitHub 凭据
- 步骤资源账本：分别记录 Planner、Implementer、Foreman Verifier、Reviewer 及返工调用的耗时、输入/输出 Token、费用、执行器、模型、记忆、Skill 与本地验证命令数
- 可视化角色 Skill 分配：Planner、Implementer、Reviewer 可分别使用原生自动匹配，或勾选本轮指定必用的 Codex / Claude Skills
- 结构化执行合同 → 逐步批准 → 执行 → 独立验证 → 审核 → 自动返工的编排状态机
- Planner、Implementer、Reviewer 使用可校验 JSON 协议；格式漂移会触发一次受限修复
- 执行合同可编辑，每一步包含验收标准、涉及文件和验证命令
- Foreman 独立运行验证命令并记录退出码、输出、耗时和工作区 SHA-256 指纹
- 运行中可以暂停并补充指令；应用重启后从持久化检查点恢复
- 每个任务从安全 Git 基线创建独立的 `foreman/...` 分支和 Git worktree；空文件夹会初始化 `main` 和一个不包含文件的本地基线
- 规划和审核只读，只有执行角色获得工作目录写权限
- JSONL/stream-json 事件实时展示
- 使用本机 SQLite 保存配置、任务、结果和完整事件记录
- 任务取消、最大返工轮次和历史任务浏览
- 可视化统一 Diff，包含修改文件和未跟踪新文件
- 审核通过后安全 fast-forward 合并，或放弃并清理 worktree/分支
- 应用异常退出后标记中断任务，同时保留可检查的 worktree
- 本地 SQLite + FTS5 原子化长期记忆，按 Planner、Implementer、Reviewer 角色召回
- 仅在任务审核通过并成功合并后生成事实、方案、实施和审核记忆候选
- 可视化记忆治理：批准、拒绝、删除、来源提交/文件、置信度、召回次数和重新验证状态
- 可选 TencentDB Memory Core v3 Adapter，支持健康检查和严格隔离检索

## 快速开始

1. 安装并登录至少一种执行器：Codex CLI 或 Claude Code。
2. 启动 Model Foreman，在工作台选择现有 Git 仓库、空目录，或从 GitHub 克隆项目。
3. 前往“设置 → 角色与流程”选择三个角色的执行器、模型和 Skills；需要接入私有网关时添加自定义 API 模型并先检测连接。
4. 回到工作台描述目标，审核 Planner 生成的合同后再批准执行。
5. 检查验证证据与统一 Diff，通过交付向导完成提交、合并和清理。

完整教程见[官网使用指南](https://model-foreman.jiachengz135.chatgpt.site/guide)。

## 本地开发

要求 Node.js 22+，并至少安装一种执行器：`codex` 或 `claude`。

```bash
npm install
npm run dev
```

验证与构建：

```bash
npm run typecheck
npm test
npm run build
npm run package
```

本机开发目录包使用 `npm run package`。没有 Developer ID、需要发给可信测试用户时，使用 `npm run dist:mac:adhoc`；该命令在干净临时目录中完成临时签名，并挂载 DMG 严格验证内部应用，避免接收方因无效资源签名看到“应用已损坏”。测试用户首次打开仍需前往“系统设置 → 隐私与安全性”选择“仍要打开”。

面向普通用户的正式发布使用 `npm run release:mac`；它要求 Developer ID 与公证凭据，并自动执行签名、公证、staple 和 Gatekeeper 验证。不要把 `npm run dist:mac` 产生的开发构建直接对外转发。配置及无 Developer ID 的限制见 [macOS 签名与公证](docs/macos-signing-notarization.md)。

## 模块 seam

- `src/main/orchestrator.ts`：编排模块，只通过 `AgentExecutor` Interface 调用模型
- `src/main/goals/`：GoalRuntime 与 DurableScheduler Module；数据库是唯一权威状态，定时器只负责唤醒
- `src/main/protocols/`：RoleProtocol Module，负责结构化协议、校验和有限修复
- `src/main/verification/`：Verification Module，负责命令发现、执行、超时和证据指纹
- `src/main/executors/`：Codex 和 Claude Code Adapter
- `src/main/storage/database.ts`：SQLite 持久化模块
- `src/main/workspace/`：Git worktree Workspace Interface 与实现
- `src/main/delivery.ts`：Diff、合并、放弃与清理模块
- `src/main/memory/`：Memory Module Interface、本地治理实现和 TencentDB v3 Adapter
- `src/preload/index.ts`：桌面进程与界面的最小桥接 Interface
- `src/renderer/`：React 可视化工作台

模型 ID 不写死在执行器实现里，可直接在“设置 → 角色与流程”修改。默认配置为 Sol 规划/审核、Terra 执行，也可接入兼容 OpenAI Responses 或 Anthropic Messages 的自定义端点。

## 安全说明

默认的 Codex / Claude 执行器复用 CLI 已有登录状态。用户主动配置的自定义 API Key 会随其他设置保存在本机 SQLite 中，只作为子进程环境变量注入，不写入命令参数、任务日志或 Git 仓库；请仅在可信设备上使用并妥善保护本机账户。桌面渲染进程启用 Chromium sandbox、context isolation、禁用 Node integration，并以 CSP 限制可加载资源。Planner 与 Reviewer 使用只读权限；Implementer 只对隔离 worktree 使用写权限。Planner 完成后流程会暂停，必须在工作台明确批准计划才会进入执行阶段。

仓库通过 `.gitignore` 排除 `.env*`、签名证书、SQLite 数据库、运行日志、构建包、官网本地部署状态和 `.pet-runs/` 生成记录。提交前仍建议使用自己的密钥扫描工具复核暂存区。

已有仓库的 worktree 基于 `HEAD` 创建；源目录中的未提交改动不会自动带入隔离分支，应用会在事件流中给出提示。普通空文件夹或无 commit 的干净 Git 仓库会在首个任务前自动建立空基线；包含现有文件但没有基线的目录必须先由用户检查并手动提交，Foreman 永不静默 `git add` 或接管这些文件。

## 使用流程

1. 在“工作台”的“项目与交付”中打开已有本地 Git 仓库、选择/新建一个空文件夹，或粘贴 GitHub 地址克隆。空项目会在首个任务时安全初始化；已有仓库可直接检查分支、PR、CI/CD 与工作区状态（PR / Actions 监控需要已登录的 GitHub CLI `gh`）。
2. 在“角色 Skill 分配”中为三个角色选择自动匹配或指定必用，再配置执行器、模型与推理强度。
3. 在工作台描述目标并开始任务。
4. Planner 生成执行合同后，编辑摘要、步骤、验收标准和命令，并逐步批准。
5. Implementer 修改隔离 worktree；Foreman 独立运行验证门禁，再交给 Reviewer 审核。
6. 在 Diff 面板检查最终变更。
7. 打开“交付向导”，按界面逐步保护源项目已有改动、创建任务提交、fast-forward 合并、恢复原有改动并清理；不需要手工复制 Git 命令。
8. 任务失败时可创建新的隔离运行重试，或经确认后先清理 worktree/分支再删除记录；Goal 引用的运行保留证据链，需在长期目标中重新规划。

新任务的隔离工作区位于当前项目的 `.foreman/worktrees/<任务 ID>`，Foreman 会将 `.foreman/` 写入该仓库的本地 Git exclude，不会改动项目 `.gitignore`。日志页支持“关键进度 / 模型输出 / 全部事件”三种视图。

Reviewer 的最大返工轮次属于协作流程策略，在“角色与流程”的流程图上方设置；长期记忆开关、召回预算与可选 TencentDB sidecar 参数统一在“记忆治理”中设置。

自动合并要求源目录没有未提交改动，并且源分支没有与任务分支发生分叉；否则应用会保留 worktree 并给出错误，方便人工处理。

## 长期目标与循环

“长期目标”页面要求至少填写一条成功标准。Foreman 会把每条标准变成一个顺序依赖的任务节点：前一节点只有经过独立验证、Reviewer 批准并 fast-forward 合并后，下一节点才会变为可运行。每个节点仍保留执行合同人工批准门禁，可从目标页打开对应任务检查和批准。

Goal Runtime 不依赖常驻 `while(true)`。Goal、Task、run、证据、尝试次数和终止原因都持久化到 SQLite；Durable Scheduler 每次只读取数据库并推进一个确定动作。应用重启时，活动 run 会先转为安全检查点，Scheduler 再自动恢复。暂停的 Goal 不会被后台唤醒。

每次模型调用会从 Codex/Claude 的 JSON 事件中累计 input/output tokens 和已报告费用。调度前会同时检查时间、Token、费用、Goal 循环次数和任务尝试次数。预算耗尽、依赖无可运行节点或自动交付失败都会以明确原因终止或阻塞，不会无限循环。阻塞后可由用户启动一次新的 Goal 规划循环；它会保留旧 run 的用量历史和证据，再由 Planner 重新生成合同，而不会清零预算。

Goal 创建时先为全新空项目建立安全基线，再绑定源仓库 HEAD 与工作区状态指纹。检测到 Foreman 之外的变化时，Goal 自动暂停，既有任务证据标记为 `invalidated`；用户明确选择“重新验证”后才会重新建立任务链。最终完成要求所有节点都有已合并提交、Reviewer `approved` 且 Verification 不为 `failed` 的证据。

## 长期记忆

Foreman 默认使用本机数据库保存长期记忆，不需要额外服务。任务只有满足以下条件才会产生候选：结构化 Reviewer verdict 为 `approved`、独立验证未失败（若无可执行门禁则显式记为 `skipped` 并交由 Reviewer 评估风险）、任务完成、用户执行安全合并。候选在“记忆治理”页面批准后才会进入角色提示词；新版本批准时会把同一交付知识的旧版本标记为 `superseded`。

记忆按合同决策、前置约束、步骤 SOP、验收规则和重要审核发现拆成原子条目，并绑定来源 run、commit 和文件。当后续交付修改关联文件时，旧记忆自动进入 `needs_revalidation`，不会继续召回。

## 暂停、恢复与验证

运行中的任务可从事件面板暂停。Foreman 会终止当前 CLI/验证进程，保存所处阶段、执行合同、worktree 和补充指令；恢复时从最近的安全阶段重新进入。应用意外退出时，启动迁移也会把中断任务转换为 `paused`，而不是直接判定失败。

验证命令可以在设置页固定配置；留空时自动发现 `package.json` 中的 `lint`、`typecheck`、`test` 和 `build`。Planner 建议的命令只有通过安全命令前缀和元字符检查后才会执行。验证报告绑定当前 Git commit 与包含未提交/未跟踪内容的工作区 SHA-256 指纹。

召回会先按工作目录和角色允许的类型过滤，再使用 SQLite FTS5/BM25 搜索，并受条数和字符预算限制。注入文本明确标记为不可信参考资料，不能覆盖当前系统或用户指令。

TencentDB Memory Core 是可选 sidecar。“设置 → 长期记忆”提供“一键配置并启动”：先检查 Git、Docker CLI 与 Docker daemon，再把官方仓库下载到应用专用目录，并在独立终端打开官方交互式安装器。下载与容器启动前会显示影响确认；LLM 密钥直接输入官方安装器，不写入 Foreman 数据库或任务日志。

Foreman 只保存 Endpoint、隔离 ID 和环境变量名称，不保存实际密钥。连接已有 Core 时，可在启动应用前设置：

```bash
export TDAI_GATEWAY_TOKEN='your-gateway-bearer-token'
export TDAI_USER_KEY='your-user-key'
npm run dev
```

Adapter 使用 `/health` 检测 Core，并通过 `/v3/atomic/search` 读取团队记忆；Core 不可用时自动回退到 Foreman 本地记忆，不会阻断规划、执行或交付。Foreman 不修改 `ANTHROPIC_BASE_URL`，也不会让 Codex/Claude Code 请求经过 TencentDB Proxy。

详细选型与源码审计见 [TencentDB Agent Memory 评估](docs/research/tencentdb-agent-memory-evaluation.md)。
