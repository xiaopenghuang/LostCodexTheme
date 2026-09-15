# Development Guide / 开发指南

## Environment / 环境

Use Windows x64, Node.js 22 LTS, stable Rust with the MSVC target, Visual Studio C++ Build Tools with a Windows SDK, and Microsoft Edge WebView2 Runtime. Browser tests use an installed Google Chrome. Codex-dependent stylesheet tests inspect an installed official Windows package read-only; they are not live acceptance tests.

开发脚本优先使用项目 `.tools/cargo` 与 `.tools/rustup`，不存在时使用系统 Rust。工具链、`node_modules`、`target`、`dist` 和 `artifacts` 均不入库。浏览器版与桌面版的主题存储相互独立。

## Development / 开发

```powershell
npm ci
npm run desktop:dev
```

For browser-only editing, use `npm run dev`. Opening the editor does not start or connect to Codex. Production runs do not require Node.js, PowerShell, or Rust.

运行 `npm run desktop:icons` 会从 `assets/branding/icon.png` 重新生成桌面图标和 `public/icon.png`。原图与 Windows 所需图标纳入版本管理，生成的移动平台图标不入库。

## Tests / 测试

Run these commands sequentially from the repository root. Do not rebuild `dist` while production browser tests are running. Native smoke requires a completed debug build and launches only its own isolated test editor, not Codex.

```powershell
npm test
npm run test:production
.\scripts\cargo.ps1 test --all-targets --features desktop
.\scripts\cargo.ps1 clippy --all-targets --features desktop '--' -D warnings
.\scripts\cargo.ps1 fmt --all '--' --check
.\scripts\cargo.ps1 build --features desktop
npm run test:native
```

`npm test` builds the Rust `codex_poc` example before running the suite, so fixtures use the same adapter contract as the backend. Native smoke verifies real storage/image/font IPC and close-to-tray/exit behavior in a disposable app profile while explicitly rejecting Codex-mutating commands.

自动化通过不代表真实 Codex 连接、最大化布局或安装升级已验收。任何需要重启 Codex 的测试，都应在用户保存工作并明确安排后单独进行。

## Build / 构建

```powershell
npm run desktop:build
npm run test:installer
```

The NSIS installer is generated under `target/release/bundle/nsis/`. The build collects dependency license texts and checksum-verified MPL source archives before packaging. Source archives under `licenses/sources/` are intentional redistribution materials, not build cache. Static installer inspection does not execute setup, upgrade, or uninstall.

安装包不提交到 Git。发布时将安装包与其 `.sha256` 文件上传到同一 GitHub Release，并确保标签指向构建所用的源码版本。未通过实机和安装验收的版本应标为预发布版，不能宣传为完整兼容的稳定版。

## Contribution / 贡献

Keep compatibility selectors centralized in the Rust profile and add regression tests for behavior changes. Preserve ownership checks and restoration boundaries. Do not commit private diagnostics, credentials, conversations, official Codex application resources, local environment files, or generated test outputs.

提交前请运行与改动相关的检查，在 Pull Request 中说明影响范围与实际验证内容。代码遵循项目 MIT 许可证，新增第三方材料需要保留对应许可证。
