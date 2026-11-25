# 更新记录

## 1.0.1 · 2026-11-25

- 新增角色与流程总览：显示执行配置数量、Codex CLI / Claude Code / ZCode / 自定义 API 等 Harness、串行或并行调度、独立验证和返工链路；点击节点直达对应配置。
- 按角色分区编辑流程，模型与规则按需展开；优化设置导航、分支背景标签和窄窗口布局。
- 运行记录支持关键词、项目与状态组合筛选，提供匹配计数、重置和空状态；分别统计待交付与已交付任务。
- 统一侧栏、最近任务、运行记录、任务详情和记忆来源任务的交付状态；增加“交付成果”入口。
- 失败任务增加原任务接续与恢复条件检查，保留有效步骤产出、现场和用量记录；默认打开日志，详情页签按任务恢复。
- 将 ZCode 接入连接器、规划 / 执行 / 审核及并行成员，使用其原生当前模型与配置；安装检测与真实模型预检分开显示。
- 同步 README、流程与恢复文档、演示界面截图和双端下载链接。

### 安装包

- `Model-Foreman-1.0.1-arm64.dmg`：macOS Apple Silicon，ad-hoc 临时签名，未公证。首次打开可能需要在“系统设置 → 隐私与安全性”选择“仍要打开”。
- `Model-Foreman-Setup-1.0.1-x64.exe`：Windows x64 NSIS 安装程序，未配置商业代码签名，SmartScreen 可能提示来源。
- `Model-Foreman-1.0.1-SHA256SUMS.txt`：双端安装包的 SHA-256 校验值。
- `Model-Foreman-1.0.1-verification.json`：版本、架构、源码提交、构建与包内校验记录。

### 验证范围

源码通过类型检查、251 项本地回归测试（3 项按条件跳过）和生产构建；流程与运行记录在 1480×940、940×740 窗口中完成交互与布局检查。界面截图使用模拟数据，未借此声称真实模型执行通过。

Windows CI 执行类型检查、专项测试、NSIS 构建及安装包内容检查；macOS 检查 DMG 完整性、密封签名、版本与包内文件。最终结果以同版本 Release 的 verification.json 为准。Windows 安装和界面尚未进行人工验收，真实 CLI 的已验证范围见[失败恢复说明](docs/architecture/failure-recovery.md)。

[下载 v1.0.1](https://github.com/zhoujiacheng1031/Model-Foreman/releases/tag/v1.0.1) · [使用说明](README.md)
