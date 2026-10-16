<p align="center">
  <img src="website/public/foreman-line-cat-icon.png" width="104" alt="Model Foreman logo">
</p>

<h1 align="center">Model Foreman</h1>

<p align="center">
  从目标到交付，每一步都有证据。<br>
  本地优先的多模型开发编排与安全交付工作台。
</p>

<p align="center">
  <a href="https://model-foreman.jiachengz135.chatgpt.site">产品官网</a> ·
  <a href="https://model-foreman.jiachengz135.chatgpt.site/guide">使用指南</a> ·
  <a href="https://github.com/zhoujiacheng1031/Model-Foreman/releases">已发布安装包</a>
</p>

<p align="center"><strong>源码版本 v1.0.0</strong> · macOS / Windows 桌面应用</p>

![Model Foreman 1.0.0 真实工作台：紫色草稿页签、蓝色已有任务页签与普通任务提示](docs/images/workbench-1.0.0.jpg)

## 从目标到可审核的交付

Model Foreman 将规划者、执行者、审核者和本地工程验证串在一起：规划者拆解目标，执行者在隔离 worktree 中修改代码，审核者结合 Diff 与验证结果给出判断，再由你通过交付向导完成合并。规划与审核的批准策略可分别配置。

| 规划 | 隔离执行 | 本地验证 | 交付 |
| --- | --- | --- | --- |
| 明确步骤与验收标准 | 在任务分支与 worktree 中工作 | 运行配置的 lint、测试与构建命令 | 检查证据、合并与清理工作区 |

## 1.0.0 的工作方式

- **多页签工作台**：每次“新任务”创建独立草稿，同一项目最多打开 8 个页签。切换任务保留输入；关闭任务页签不会停止运行，有内容的草稿可从“恢复草稿”找回。
- **更清楚的任务识别**：已有任务页签使用蓝色，新任务与草稿使用紫色；普通任务和长期目标也分别使用蓝、紫配色，配合图标和用途提示。
- **项目切换与最近任务**：通过项目入口切换工作区，草稿按项目保存；最近任务以卡片展示，可直接回到原任务页签。
- **分组设置**：运行环境、API 模型、模型检测、角色与流程、验证门禁、人工批准、长期记忆分别管理，减少长页滚动。

| 任务类型 | 适用场景 | 开始前填写 |
| --- | --- | --- |
| 普通任务 | 一次明确的功能、修复或文档改动 | 任务描述，可选标题 |
| 长期目标 | 需要分阶段推进、反复验证的持续交付 | 最终目标、逐行成功标准，以及费用、时间、Token 和循环预算 |

长期目标按预算与检查点推进。费用以执行器报告的用量为准，正在进行的调用可能超出预算。

## 模型协作与并行执行

分别为规划、执行和审核配置执行器、模型、推理强度及专用 Skill。支持 Codex CLI、Claude Code，以及 OpenAI Responses、Anthropic Messages 兼容的自定义 API 模型；完整配置自动保存，连接检测单独执行。

在“设置 → 角色与流程”中选择 1–4 个并行上限，默认 1 为串行模式：

- 配置的执行成员数不超过所选上限，例如上限为 3 时最多添加 3 个成员。
- 降低上限前先移除多余成员；历史超额配置会保留并提示调整。
- 未配置成员时复用主执行角色；配置对新任务生效，已有任务保留创建时的策略。
- 实际并发取决于步骤依赖与文件修改范围；有依赖或范围冲突的步骤会串行执行。上限按单个任务计算。

各成员在独立 worktree 中执行，汇总后统一验证与审核。任务详情保留步骤、日志、用量、报告和工作记忆快照。更多执行与恢复边界见 [并行执行与记忆治理](docs/architecture/parallel-agents-memory.md)。

## 证据、恢复与记忆

- **交付证据**：查看成果、计划、Diff、验证结果、Token、费用与事件日志；已跳过的验证会明确标注。
- **运行恢复**：支持暂停、继续和检查点恢复；任务中断后可补充上下文，失败任务可重试。
- **长期记忆治理**：从审核通过且成功合并的交付中提取候选，保留来源证据；支持候选整理、批准、拒绝和失效检查。默认本地存储，写入需要批准。

## 安装与快速开始

[1.0.0 Release](https://github.com/zhoujiacheng1031/Model-Foreman/releases/tag/v1.0.0) 提供 macOS Apple Silicon（DMG）和 Windows x64（EXE）安装包，以及 SHA-256 校验文件。双平台 CI 构建与包内版本检查已通过；Windows 安装和界面尚未进行人工验收。

macOS 安装包使用临时签名、尚未公证；首次打开可能需要在“系统设置 → 隐私与安全性”中选择“仍要打开”。Windows 安装程序未配置商业代码签名证书，SmartScreen 可能显示来源提示。

1. 安装对应平台的已发布安装包，或按下方说明从源码运行。
2. 安装并登录所用的 Codex CLI 或 Claude Code CLI，在“设置 → 运行环境”检查状态。
3. 打开本地 Git 仓库、空目录，或从 GitHub 克隆项目。
4. 配置角色与模型，点击“新任务”，选择普通任务或长期目标并填写目标。
5. 按批准策略检查计划、验证结果与 Diff，通过交付向导完成合并。

## 本地开发与打包

需要 Node.js 22+、Git，以及所用的本地执行器。

```bash
npm install
npm run dev
```

验证源码：

```bash
npm run typecheck
npm test
npm run build
```

生成本机安装包：

```bash
# macOS Apple Silicon 本地测试包，临时签名、未公证
npm run dist:mac:adhoc

# Windows x64 安装包，需要对应构建环境
npm run dist:win
```

macOS 正式分发的签名、公证与验包说明见 [macOS 签名与公证](docs/macos-signing-notarization.md)。

## 安全边界

- 复用本地 CLI 登录状态；自定义 API Key 保存在本机，通过执行器环境变量注入，不写入命令或任务日志。
- Git 分支与 worktree 用于协作隔离，不是操作系统安全沙箱；执行器仍可能访问本机凭据和共享服务。
- 验证结论取决于实际运行的命令；跳过验证不等于测试通过。
- 产品中的 Commit 与 Push 提供预览和确认，不自动 force push。
- `.env*`、证书、数据库、运行日志和构建包由 `.gitignore` 排除。

## 进一步了解

- [产品使用指南](https://model-foreman.jiachengz135.chatgpt.site/guide)
- [并行执行与记忆治理](docs/architecture/parallel-agents-memory.md)
- [macOS 签名、公证与分发](docs/macos-signing-notarization.md)
- [TencentDB Agent Memory 评估](docs/research/tencentdb-agent-memory-evaluation.md)
- [提交问题与建议](https://github.com/zhoujiacheng1031/Model-Foreman/issues)
