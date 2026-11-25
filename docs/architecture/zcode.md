# ZCode 产品接入

从 v1.0.1 起，ZCode 作为独立执行器，提供运行环境检查、Desktop 打开、规划/执行/审核角色、并行执行成员、模型预检、日志和 Token 统计。旧设置读取时补入 ZCode 目录，原有角色与自定义模型保持不变。macOS Apple Silicon 与 Windows x64 安装包见 [v1.0.1 Release](https://github.com/zhoujiacheng1031/Model-Foreman/releases/tag/v1.0.1)。

## 使用

1. 安装 ZCode，在它自身的客户端中配置并验证模型与凭据。
2. 在 Foreman「设置 → 连接器」刷新检测。先查找 PATH 中的独立 `zcode`；macOS 也查找系统或用户 Applications 下的 Desktop 内置 CLI。`FOREMAN_ZCODE_PATH` 可指定存在的 CLI 绝对路径（独立可执行文件或 Node `.cjs` bundle）；环境变量须对 Foreman 进程可见。
3. 在「角色与流程」为所需角色或并行成员选择 ZCode。模型固定显示「ZCode 当前模型（原生配置）」，推理强度显示「原生默认」。当前 CLI 没有可靠的每次调用模型和 effort 覆盖入口，因此 Foreman 不提供无效的替代选项；需要切换时在 ZCode 自身完成配置。
4. 在连接器中选择 ZCode，点击「检测此连接器」运行实际预检。安装检测不触发付费请求，也不将版本号当作认证成功。预检会消耗真实用量；开始角色调用前仍会重检。原生当前模型会改变，因此不缓存其跨调用预检成功结果。

Foreman 不读取、保存或转交 ZCode API Key。Node bundle 使用应用内置运行时启动，传递原生配置文件的路径；已有 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`、`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`、`ZCODE_DATA_BASE_DIR` 覆盖优先。原生 Skill、插件和登录状态由 ZCode 管理，Foreman 不提供其 Skill 清单与必用选择器。

实现角色使用非交互 `yolo` 模式，在 Foreman 准备的 Git worktree 中编辑和执行命令；规划与审核使用 `plan`。禁用交互提问、进入/退出计划及内部 Agent 工具，避免自动任务等待权限客户端或另行调度子代理。worktree 不是操作系统安全沙箱。输出必须包含完整原生 result；即使退出码为 0，失败或截断结果仍会被拒绝。取消沿用现有的任务范围进程树终止机制。

原生配置格式和权限语义参考 [ZCode 配置](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/docs/usage/03-config.md)、[权限](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/docs/usage/05-permissions.md)和[自动化](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/docs/usage/13-automation.md)。Foreman 的失败恢复重建文件与任务状态，每次调用使用新原生会话，不使用全局 `--continue`。

## 验证

```bash
FOREMAN_HARNESS_REPORT_DIR=/absolute/path/to/results \
FOREMAN_ZCODE_EXPECT_MODEL=glm-5.3 \
npm run test:harness -- zcode native-default
```

`FOREMAN_ZCODE_EXPECT_MODEL` 只用于验收：在原生诊断中核对实际模型，不负责切换模型。验收子类调用产品 `ZcodeExecutor`，只增加临时目录限制、故障注入与证据检查。独立验证命令不依赖模型自报成功。

2026-11-24 本轮使用 macOS、ZCode CLI 0.18.0、原生当前模型 glm-5.3。规划角色返回有效的结构化合同且工作区未变；调用前故障和实际 SIGKILL 恢复场景均完成本地验证、实际审查及临时仓库合并，A/B/C 尝试次数均为 1/1/2。证据保存在 `output/verification/zcode-product-20261124/`。界面通过隔离浏览器预览验证，原生 CLI 和主进程编排另行真实验证；没有声称完成安装包或 Windows 的端到端验收。

## DSH 结论

DSH 从接口上具备接入条件：[官方 CLI](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.md)提供 headless、JSON 事件和非交互权限策略。但 2026-11-24 本机 0.2.2-rc.5 的原生最小只读调用返回 `MISSING_CREDENTIAL`，缺少 `deepseek-official` 路由凭据，无法继续真实任务验收。本次不增加 DSH 产品入口，不转用其他客户端的密钥；这不等于 DSH 桌面端所有配置或未来版本不可接入。
