# TencentDB Agent Memory 对 Model Foreman 的适用性评估

> 调研日期：2026-08-08
> 调研对象：`TencentCloud/TencentDB-Agent-Memory` 当前 GitHub 默认分支 `feat/server_team`，提交 `fe3230f176f1bf5832fee79d12494bbc2d19a8aa`（2026-08-06）。
> 资料范围：仓库源码、README、安装/部署文档、变更日志、许可证、GitHub 仓库/发布/提交/Issues/Actions 页面。没有采用第三方评测或二手文章。

## 结论

Model Foreman **需要记忆模块**，但不建议把 TencentDB Agent Memory 整套直接嵌入桌面应用，也不建议让 Foreman 的 Codex/Claude Code 请求默认经过它的 LLM Proxy。

推荐路线是：

1. 在 Foreman 内实现一个小而稳定的 `MemoryProvider` 接口和默认的 `ForemanNativeMemory`；沿用该项目最有价值的思想——分层、证据可追溯、混合检索、资产版本/权限、人工可管理。
2. 第一版只沉淀与软件交付直接相关的四类内容：项目事实、架构决策、失败教训、已验证 SOP。仅在任务成功合并且 Reviewer 通过后产生长期记忆候选。
3. 将 TencentDB Agent Memory 作为**可选 sidecar/Adapter**，通过 v3 HTTP/SDK 接入，供确实需要团队共享、Wiki、CodeGraph、ACL 的用户选择；不要成为本地 MVP 的强依赖。

原因很直接：其 Memory Core 的本地 SQLite/文件后端并不强绑定腾讯云，技术路线值得复用；但当前完整产品已扩张成 Core + Hub + Knowledge + Proxy + SDK 的团队平台，部署和安全边界远大于 Foreman 当前需要。当前默认分支仍标注 Team Memory Beta，且工程质量证据不足以支持“直接内嵌为可信核心依赖”。[README 的 Beta 声明](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/README_CN.md#L23-L26)

## 1. 产品与架构

当前版本已经不只是“对话记忆库”，而是四类团队资产平台：

- Chat Memory：L0 原始对话 → L1 原子事实 → L2 场景 → L3 Persona/Core；
- Skill：从成功任务中抽取可复用 SOP，并带版本、资源、触发边界和验证规则；
- Wiki：把文档加工成结构化页面与链接图；
- CodeGraph：索引文件、符号、调用关系和影响路径。

这是仓库正式版本变更日志明确列出的产品边界。[四类资产](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/CHANGELOG.md#L17-L28)

主要进程和职责如下：

| 模块 | 技术 | 职责 | 对 Foreman 的价值 |
|---|---|---|---|
| MemoryCore | TypeScript / Node.js 22 | L0–L3、Skill、检索、Gateway、元数据与 ACL | 分层记忆、检索和 API 契约可借鉴 |
| MemoryKnowledge | TypeScript / Hono / SQLite | Wiki、CodeGraph、MCP/HTTP 工具 | 后期可作为可选知识插件，不宜进入第一版核心 |
| MemoryPanel | TypeScript / React / Vite / Hono | Team、Agent、资产、权限、知识管理 UI | 资产审核/编辑/绑定交互值得参考 |
| MemoryProxy | TypeScript / Hono | 代理 Anthropic/OpenAI 请求，注入记忆、Skill、知识 | Foreman 不应默认采用；它会扩大凭据和内容暴露面 |
| SDK | TypeScript + Python | v3 Memory、Skill、Metadata API | 适合实现外部 Adapter |

完整部署用 Proxy 把 L2/L3、匹配的 Skill、Wiki/CodeGraph 拼进 system prompt，再转发给上游模型。[Proxy 工作方式](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/CHANGELOG.md#L42-L54) Foreman 已经掌握 Planner/Executor/Reviewer 的提示词构造，因此应在自己的编排层注入经过筛选的记忆，无需再增加一个中间人代理。

## 2. 数据模型

### 2.1 长期记忆层级

README 对层级的定义清晰：L0 保存原始对话，L1 保存事实/偏好/约束/事件，L2 按项目或场景组织，L3 保存稳定模式与高层画像；L2/L3 用于快速恢复语境，L1/L0 用于下钻核实。[层级和召回说明](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/README_CN.md#L225-L234)

源码中的 L1 记录包含：`content`、类型、优先级、场景名、来源消息 ID、时间戳轨迹、版本、session/task/team/user/agent 隔离字段。类型既支持聊天语义（persona、episodic、instruction），也支持工作语义（work_fact、work_task、work_method、work_artifact）。[L1 数据结构](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/core/record/l1-writer.ts#L30-L108)

SQLite 本地后端为 L0/L1 分别维护元数据表、`sqlite-vec` 向量表和 FTS5 表，并为 team/user/agent/session/task 建索引；另有 L1/L2/L3 更新、删除审计表。[SQLite L1/L0 schema](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/core/store/sqlite.ts#L604-L817) [FTS 与审计表](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/core/store/sqlite.ts#L960-L1084)

### 2.2 团队资产模型

元数据层包含 User、UserKey、Team、TeamMember、Agent、Task、Asset、Agent Fixed Asset、ACL 等实体。Asset 自带 `version`、`visibility`、`status`、`confidence`、`expires_at`、`last_used_at`、`usage_count` 和 `content_ref`；这是比普通向量库更值得复用的部分。[资产 schema](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/metadata/store/sqlite-adapter.ts#L223-L265)

对 Foreman，应把团队维度简化为：

- workspace/repository；
- task/run；
- role（Planner、Executor、Reviewer）；
- branch/commit；
- owner 与 visibility。

不要直接照搬 Team/Agent/Task 全套管理模型，否则单机应用会过早承担 SaaS 多租户复杂度。

## 3. 是否强绑定 TencentDB / 腾讯云

**本地 Memory Core 不强绑定 TencentDB。** 存储层定义了后端无关、能力探测式接口，SQLite 和 TCVDB 都实现同一契约；上层可以根据是否支持 vector、FTS、native hybrid 进行降级。[存储抽象原则](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/core/store/types.ts#L1-L18) 工厂默认选择 SQLite，只有配置 `storeBackend: "tcvdb"` 才创建 TCVDB 后端。[Store 工厂](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/core/store/factory.ts#L1-L89)

但“本地运行”不等于“零依赖、完全离线”：

- 一键完整部署需要 Docker；
- `.env` 要求 Memory 和 Proxy 两组 LLM endpoint/key/model；它们可以指向本机 OpenAI-compatible 服务，也可以是云 API；
- Wiki/CodeGraph 完整体验还需 Hub/Knowledge 服务；
- Service 模式会使用 TCVDB、COS、Redis 等外部设施。

一键模板明确要求两组 LLM 配置。[部署环境变量](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/deploy/global-images/.env.example#L24-L45) 因此对 Foreman 更准确的判断是：“数据可以本地保存，模型计算是否离线取决于用户配置”。

另外，一键部署生成的 Core 配置明确设置 `storeBackend: sqlite` 和 `embedding.provider: none`。[生成的本地 Core 配置](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/deploy/global-images/start-memory-core.sh#L67-L115) 这意味着开箱即用状态虽然把 recall strategy 写成 `hybrid`，实际没有 embedding 通道，召回会退化到 FTS/BM25；要获得真正的向量 + 关键词混合检索，用户还需配置 embedding 服务和正确维度。

## 4. 记忆提取、更新与检索

### 4.1 形成与调度

默认配置会自动捕获，启用 L1 智能去重，每 session 最多提取 20 条；L1 每 5 轮触发并支持 1→2→4→稳定阈值的 warm-up，空闲也会触发；L3 默认每累计 50 条新记忆触发。[配置契约](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/config.ts#L20-L104)

L1 提取后有四种去重决策：`store`、`update`、`merge`、`skip`。更新/合并会读取旧版本，删除 VectorStore 中的目标，再写新版本；JSONL 保持 append-only，旧条目之后由 cleaner 对账清理。[写入与版本更新](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/core/record/l1-writer.ts#L110-L246)

优点是保留原始证据并支持合并；缺点是“什么值得记、是否冲突、如何合并”仍依赖 LLM 判断。对代码编排场景，不能让一次失败执行或执行模型的自述直接成为长期事实。

### 4.2 召回

默认策略是 hybrid：

- SQLite 路径并行使用 FTS5/BM25 与 embedding，并在客户端用 RRF 合并；
- TCVDB 路径可使用服务端 hybrid search；
- embedding 不可用时可退化到关键词；
- 最终有最大结果数、分数阈值、单条/总字符预算、整体 timeout。

RRF 和降级逻辑在源码中是明确实现而非只写在 README。[Hybrid/RRF 实现](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/core/hooks/auto-recall.ts#L429-L769) [字符预算](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/core/hooks/auto-recall.ts#L833-L896)

这部分很适合 Foreman，但应再加三层过滤：

1. 先做权限与 repo/branch/task/role 硬过滤；
2. 再做 BM25 + embedding 召回；
3. 最后做新鲜度、可信度、冲突状态和 token budget 重排。

## 5. 部署、语言与 API

- 主要语言：TypeScript；Hermes 适配和 SDK 另含 Python。
- 运行时：Memory Core 要求 Node.js `>=22.16.0`，并依赖 `sqlite-vec`、Jieba、AI SDK、OpenTelemetry 等。[Core package](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/package.json#L95-L140)
- 部署：提供 Docker 多架构镜像及 `start-all.sh`，默认端口 Core 8420、Panel 8125、Knowledge 8424、Proxy 8096。[安装流程](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/INSTALL_CN.md#L10-L46)
- API：Core 提供 v3 HTTP 数据面、Metadata、Skill、Knowledge 接口；Knowledge 另提供 HTTP/OpenAPI 与 MCP；Proxy 同时接 Anthropic/OpenAI 协议。
- SDK：TypeScript 和 Python。v3 transport 要求 endpoint、Gateway API key、service ID，可附 user key，并默认验证 TLS。[TypeScript v3 transport](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/sdk/memory-core/typescript/src/v3/http.ts#L14-L58) [Python v3 transport](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/sdk/memory-core/python/tencentdb_agent_memory/_v3_http.py#L74-L106)

Claude Code 的官方接法不是 CLI hook，而是改写其 Anthropic API 地址：将 `ANTHROPIC_BASE_URL` 指到 `http://127.0.0.1:8096/claude-code/default`，把生成的 `sk-mem-*` user key 放入 `ANTHROPIC_AUTH_TOKEN`，再执行 `claude --model ...`；新会话由 Proxy 通过 `AskUserQuestion` 让用户选 Team → Agent → Task，之后每轮注入记忆并转发上游。[Claude Code 接入步骤](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/INSTALL_CN.md#L92-L149) 该方案能兼容 Claude Code，但也意味着 Proxy 能看到完整请求、响应和工具上下文；Foreman 自己已经控制 CLI 子进程和 prompt，因此更适合直接注入，而不是改写 Claude 的上游地址。

这使得 sidecar Adapter 很可行：Foreman 无需 fork 对方源码，只需实现健康检查、recall、record candidate、approve/reject、forget/export。

## 6. 许可证

仓库采用 MIT 许可证，可使用、修改、合并、发布、分发、再许可和销售，但必须在软件的重要部分保留版权和许可声明，并且软件不提供担保。[LICENSE](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/LICENSE#L1-L27)

如果仅借鉴架构思想、通过 HTTP Adapter 对接，不会形成强源码耦合；如果复制实现代码，需在 Foreman 的第三方声明中保留 MIT notice，并继续审查其再依赖的许可证。

## 7. 维护活跃度、测试与成熟度

### 积极信号

- GitHub 在调研日显示约 17.5k stars、1.6k forks、90 个 open issues，社区关注度高。[仓库首页](https://github.com/TencentCloud/TencentDB-Agent-Memory)
- v2.0.0 于 2026-08-03 发布；release 列表从 v0.2.2 到 v2.0.0，发布节奏活跃。[Releases](https://github.com/TencentCloud/TencentDB-Agent-Memory/releases)
- 2026-08-07 仍有新 bug、重构和 Codex 原生适配 issue，说明项目在快速开发中。[Issues](https://github.com/TencentCloud/TencentDB-Agent-Memory/issues)
- 有迁移脚本、日志脱敏、超时/字符预算、路径穿越保护、用户/资产权限和审计设计。

### 风险信号

1. **默认分支仍是快速演进分支。** 调研时 GitHub 默认分支为 `feat/server_team`，README 明示 Team Memory Beta；稳定 API/数据迁移成本仍可能变化。
2. **版本标识不一致。** 根 `CHANGELOG.md` 和 GitHub release 是 2.0.0，但当前默认分支 `MemoryCore/package.json` 仍为 `2.0.0-beta.1`。[package version](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/package.json#L1-L5)
3. **当前默认分支没有跟踪测试文件。** 在该提交执行 `git ls-files` 后，没有任何 `*.test.*`、`*.spec.*` 或 `__tests__` 文件；但 package scripts 仍引用 `vitest` 和不存在的 `__tests__/standalone/*.sh`。[测试脚本声明](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/package.json#L31-L45)
4. **公开 CI 不跑单元/集成测试。** 当前 `.github/workflows/pr-ci.yml` 只对 PR 运行安装、npm pack、manifest、包大小和 Skill 隔离守卫，没有 `npm test`，且工作目录固定在 MemoryCore，不能覆盖 Hub/Knowledge/Proxy/SDK。[CI workflow](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/.github/workflows/pr-ci.yml)
5. **Benchmark 不可复现。** README 给出 PersonaMem 48%→76%，但当前默认分支没有对应 benchmark 数据、配置、运行脚本或结果文件；只能视为项目方声明，不能作为 Foreman 选型的独立证据。[Benchmark 声明](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/README_CN.md#L248-L255)

综合判断：设计成熟度中上，产品覆盖广，维护活跃；但当前开源默认分支的可验证工程成熟度偏低。适合“参考 + 可选集成”，不适合未经隔离直接成为 Foreman 的数据核心。

## 8. 安全与隐私评估

### 已有保护

- Gateway 默认监听 `127.0.0.1`，可选 Bearer 鉴权和 CORS allowlist，令牌使用常量时间比较；非 loopback 且未开鉴权时会输出高强度警告。[Gateway 安全姿态](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/gateway/server.ts#L689-L722) [鉴权与 CORS](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/gateway/server.ts#L1063-L1174)
- user key 由 192-bit 随机值生成；历史密码工具使用 scrypt、随机盐和 pepper。[凭据生成与哈希](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/metadata/utils/crypto.ts#L1-L110)
- 本地文件 backend 拒绝绝对路径、NUL 和逃出 root 的 `..` 路径。[路径穿越保护](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/core/storage/local-backend.ts#L45-L87)
- v3 有 team/user/agent 隔离、Asset visibility/ACL、API payload/key 脱敏机制。

### 关键风险

1. **一键部署默认暴露未鉴权 Core。** 默认 `.env` 将 `MEMORY_CORE_GATEWAY_API_KEY` 留空，因为源码明确记录 Proxy 调用 Core auth 时遗漏 Bearer，二者当前不兼容。[默认关闭说明](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/deploy/global-images/.env.example#L68-L79) 同时 `start-memory-core.sh` 让 Core 监听 `0.0.0.0` 并通过 `-p` 映射到宿主机。[启动脚本](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/deploy/global-images/start-memory-core.sh#L20-L34) [绑定与端口映射](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/deploy/global-images/start-memory-core.sh#L67-L125) 在共享 Wi-Fi、公司局域网或云主机上风险很高。
2. **本地静态数据没有静态加密。** L0/L1、Markdown、SQLite 和 sidecar metadata 都以普通文件/字段写入；`meta_user_keys.key_value` 还是明文唯一字段，而非 key hash。[明文 user key schema](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/metadata/store/sqlite-adapter.ts#L119-L153) [普通文件写入](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/core/storage/local-backend.ts#L90-L104)
3. **Proxy 天然能看到完整提示词、工具输出和上游凭据。** 若开启 Opik/Langfuse/ClickHouse，内容还可能进入额外观测系统；虽然默认关闭，但 Foreman 应避免无必要地增加此数据路径。
4. **长期记忆是提示注入面。** 被污染的对话、仓库文档或执行器输出可能被提炼成高优先级 instruction/skill。现有 ACL 解决“谁能读”，并未解决“内容是否可信”。Foreman 必须增加来源信任、候选审核、状态机和 prompt-injection 扫描。
5. **删除语义需谨慎验证。** VectorStore 可实时删除，但 JSONL 是 append-only，依赖后续 cleaner 清理；用户界面中的“删除/忘记”不应在底层清理完成前宣称彻底擦除。[append-only 说明](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/fe3230f176f1bf5832fee79d12494bbc2d19a8aa/MemoryCore/src/core/record/l1-writer.ts#L4-L12)

## 9. 对 Model Foreman 可直接复用的部分

建议复用“模式和契约”，优先级如下：

1. **分层与下钻**：摘要不替代证据；任何长期记忆都必须链接到 task、run、diff、review 或原始事件。
2. **混合检索和预算**：FTS/BM25 + 可选 embedding + RRF；严格限制结果数、单条长度、总 token 和超时。
3. **Store capability 接口**：上层不依赖 SQLite/向量库；未来可换 TencentDB、Postgres 或文件后端。
4. **Asset 元数据**：version、status、confidence、expiry、owner、visibility、usage、content reference。
5. **按角色配装**：Planner 看决策和约束；Executor 看 SOP、代码事实和已知坑；Reviewer 看事故、验收规则和历史否决理由。
6. **管理 UI**：候选、已批准、已取代、已过期、已删除；支持编辑、固定、合并、拒绝和追溯证据。
7. **导入/导出与 Adapter**：Foreman 自有格式为主，TencentDB v3 SDK 为可选外部 Provider。

## 10. 建议的 Foreman 改进版方案

### 10.1 最小接口

```ts
interface MemoryProvider {
  probe(): Promise<MemoryCapabilities>;
  recall(query: RecallQuery): Promise<MemoryPacket>;
  propose(outcome: VerifiedTaskOutcome): Promise<MemoryCandidate[]>;
  approve(candidateId: string, patch?: MemoryPatch): Promise<MemoryEntry>;
  reject(candidateId: string, reason?: string): Promise<void>;
  supersede(oldId: string, replacementId: string): Promise<void>;
  forget(scope: MemoryScope): Promise<ForgetReceipt>;
  export(scope: MemoryScope): Promise<ReadableStream>;
}
```

### 10.2 Foreman 原生数据模型

每条长期记忆至少包含：

- `kind`: fact / decision / lesson / procedure / constraint；
- `scope`: workspace、repo fingerprint、branch、role、task；
- `content` 与结构化字段；
- `sourceRefs`: run event、commit、diff、test、review；
- `status`: candidate / approved / superseded / rejected / expired；
- `confidence`、`validFrom`、`validUntil`；
- `contradicts` / `supersedes`；
- `createdByModel`、`approvedBy`、prompt/model/version；
- `lastRevalidatedAt`、`usageCount`。

### 10.3 写入政策

- 规划过程、未合并分支、失败或放弃任务不自动写入长期事实；
- 只有“已合并 + 测试通过 + Reviewer 通过”的 outcome 才进入候选提取；
- Executor 只能建议记忆，不能批准；由强 Reviewer 做二次提取/冲突检查；
- 高风险 constraint/decision 默认需要人工确认；
- 代码事实要绑定 commit/tree hash，代码变化后自动标记 stale；
- 用户可关闭捕获、查看原文、导出和真正删除。

### 10.4 召回政策

- Planner：优先 architecture decision、约束和相似任务结果；
- Executor：优先已批准 SOP、失败教训、相关代码事实；
- Reviewer：优先验收规则、事故、历史 reject reason；
- 所有召回都先做 scope/ACL，再检索，再按可信度、新鲜度、证据质量和重复度重排；
- 注入内容使用明确的“不可信参考资料”边界，禁止记忆覆盖当前系统/用户指令。

### 10.5 与 TencentDB Agent Memory 的集成边界

若后续提供 TencentDB Adapter，建议只使用 Core v3/SDK：

- 默认仅连接 `127.0.0.1`；
- 要求 Gateway Bearer 开启；
- 不自动启动 Proxy、不接管 Codex/Claude 的 API base URL；
- Foreman 传入稳定的 team/agent/user/task 映射；
- Foreman UI 显示外部 Provider 的数据位置、模型 endpoint、同步和删除状态；
- 导入外部 memory 时全部先进入 `candidate`，不能直接成为 approved instruction。

## 11. 最终选型建议

| 方案 | 建议 | 理由 |
|---|---|---|
| 整套直接嵌入 Foreman | 不建议 | 进程多、部署重、安全边界大、当前测试证据不足 |
| Fork MemoryCore 并深改 | 暂不建议 | 上游快速变化，维护和迁移成本高 |
| Foreman 原生轻量记忆 | **建议作为默认** | 最贴合任务生命周期、审核和 worktree/commit 证据链 |
| TencentDB Core v3 sidecar Adapter | **建议作为可选高级功能** | 可快速获得团队共享、ACL、Skill/Wiki/CodeGraph 能力 |
| 仅借鉴设计 | **立即采用** | 分层、混合检索、资产状态、追溯和角色配装都适用 |

一句话总结：**这个项目值得参考，也值得做可选兼容，但 Foreman 的核心记忆应围绕“可验证的软件交付事实”重新设计，而不是围绕“对话 Persona”照搬。**
