# macOS 签名与公证

Model Foreman 通过 `electron-builder` 完成 Developer ID 签名、Apple 公证和 ticket stapling。正式发布入口是：

```bash
npm run release:mac
```

该命令会先拒绝缺失或不完整的凭据，然后依次执行类型检查、测试、生产构建、DMG/ZIP 签名与公证，以及 `codesign`、Gatekeeper 和 stapler 验证。任何一步失败都不会产生可发布结论。

## 没有 Developer ID 时的可信测试分发

仅发给已知、信任你的测试用户时，运行：

```bash
npm run dist:mac:adhoc
```

该构建使用完整的 ad-hoc 签名，不会获得 Apple 的开发者身份背书或公证票据。脚本会在 macOS 临时目录打包，清理会破坏签名的文件扩展属性，执行 `codesign --deep --strict`，验证密封资源，再挂载 DMG 对其中的应用重复验证。只有全部通过后，DMG 才会复制到 `release/`。

测试用户应把应用拖到“应用程序”后尝试打开一次；若被 Gatekeeper 拦截，则进入“系统设置 → 隐私与安全性”，确认应用来源后点击“仍要打开”。这不是面向陌生公众的无交互安装方案。若希望用户直接双击安装并正常打开，仍须使用 Developer ID 签名和 Apple 公证。

`npm run dist:mac` 只用于开发调试，不应作为分发产物。

## 1. 前提

- 有效的 Apple Developer Program 会员资格。
- Xcode Command Line Tools；本机已有 `notarytool` 与 `stapler`。
- `Developer ID Application` 证书及其私钥。直接分发 `.app`、DMG 或 ZIP 不需要 `Developer ID Installer`；后者只用于签署 flat `.pkg` 安装包。
- 一组 Apple 公证凭据。

当前机器检查结果为 `0 valid identities found`，因此必须先完成下一节。不要把 `.p12`、`.p8`、密码或 Apple ID 凭据提交到仓库。

## 2. 安装 Developer ID Application 证书

在 Apple Developer 的 Certificates 页面创建 `Developer ID Application` 证书。下载 `.cer` 后双击安装；创建 CSR 的这台 Mac 还必须保有对应私钥。完成后检查：

```bash
security find-identity -v -p codesigning
```

输出应包含：

```text
Developer ID Application: 你的组织名称 (TEAMID)
```

CI 不使用登录钥匙串时，可导出带私钥的加密 `.p12`，把其 Base64 内容存为 CI secret `CSC_LINK`，密码存为 `CSC_KEY_PASSWORD`。

## 3. 配置公证认证

以下三种方式任选一种。CI 推荐 App Store Connect API Key；个人开发机推荐 Keychain Profile。

### Keychain Profile（本机推荐）

执行一次：

```bash
xcrun notarytool store-credentials "model-foreman-notary" \
  --apple-id "你的 Apple ID" \
  --team-id "10 位 TEAM ID"
```

不要在命令行参数中填写密码；`notarytool` 会通过安全交互提示读取 App 专用密码，避免它进入 shell history。

随后发布时只暴露 profile 名称：

```bash
export APPLE_KEYCHAIN_PROFILE=model-foreman-notary
npm run release:mac
```

### App Store Connect API Key（CI 推荐）

```bash
export APPLE_API_KEY='Base64 编码后的 .p8 内容'
export APPLE_API_KEY_ID='KEY_ID'
export APPLE_API_ISSUER='ISSUER_ID'
export APPLE_TEAM_ID='TEAM_ID'
export CSC_LINK='Base64 编码后的 Developer ID .p12'
export CSC_KEY_PASSWORD='p12 密码'
npm run release:mac
```

### Apple ID

```bash
export APPLE_ID='开发者账户邮箱'
export APPLE_APP_SPECIFIC_PASSWORD='App 专用密码，不是 Apple ID 登录密码'
export APPLE_TEAM_ID='TEAM_ID'
npm run release:mac
```

## 4. 构建结果与验证

成功后 `release/` 会包含 DMG、ZIP 和已签名应用。发布脚本自动执行：

```bash
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/Model Foreman.app"
spctl --assess --verbose=2 --type exec "release/mac-arm64/Model Foreman.app"
xcrun stapler validate "release/mac-arm64/Model Foreman.app"
```

Gatekeeper 应报告 `accepted`，来源应为 `Notarized Developer ID`；stapler 应报告验证成功。可以再次运行 `npm run verify:mac`，但它只接受已经签名且公证的产物，当前未签名开发包会按预期失败。

仓库还包含 `.github/workflows/release-macos.yml`。在 GitHub 仓库配置以下 Actions Secrets 后，可手动触发，或推送 `v*` 标签触发：

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_TEAM_ID`

流水线权限保持为 `contents: read`，不会自动创建 Release 或发布文件；验证通过的 DMG/ZIP 仅保存为短期 Actions artifact。

## 5. 安全配置

- Hardened Runtime 已启用。
- entitlement 只开放 Electron/V8 需要的 `com.apple.security.cs.allow-jit`。
- 没有启用 `get-task-allow`、DYLD 环境变量、禁用 library validation 或 App Sandbox entitlement。
- App Sandbox 与 Chromium renderer sandbox 是不同机制；直接分发版 Electron 不应启用 Mac App Store 的 App Sandbox。
- 公证由 `notarytool` 路径完成；不使用 Apple 已停止接收上传的 `altool`。

官方参考：

- [Apple：Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- [Apple：Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [electron-builder：macOS Notarization](https://www.electron.build/docs/notarization/)
