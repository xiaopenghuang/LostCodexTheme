<p align="center">
  <img src="public/icon.png" width="112" height="112" alt="LostCodexTheme icon" />
</p>

<h1 align="center">LostCodexTheme</h1>

<p align="center">Make Codex Desktop feel like your own workspace.</p>

<p align="center"><a href="README.md">中文</a> · English</p>

<p align="center">
  <a href="https://github.com/xiaopenghuang/LostCodexTheme/releases/tag/v0.2.1"><img src="https://img.shields.io/badge/version-0.2.1_preview-38523f" alt="v0.2.1 preview" /></a>
  <img src="https://img.shields.io/badge/platform-Windows_x64-0078D4" alt="Windows x64" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-586c55" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/built_with-Tauri_2_%2B_React-52697c" alt="Tauri 2 and React" />
</p>

LostCodexTheme is a local-first visual theme editor for Codex Desktop on Windows. Customize backgrounds, sidebars, the composer, messages, and work panels without writing CSS, with an isolated preview as you edit. Built with Tauri 2, Rust, React, and TypeScript, the packaged app requires neither Node.js nor Rust.

This is an independent third-party project, not affiliated with or endorsed by OpenAI. Version 0.2.1 is a public preview. Live Codex compatibility and installation, upgrade, and uninstall acceptance remain incomplete; this release does not certify any Codex version as fully compatible.

## Preview

![LostCodexTheme visual theme editor](docs/assets/editor.png)

The screenshot shows the editor's simulated preview, not a live Codex conversation. The editor UI is currently primarily in Chinese.

## What You Can Customize

**Backgrounds and palettes.** Choose solid colors, gradients, or local PNG, JPEG, and WebP images up to 10 MiB. Wallpaper can extend behind the sidebar and work panels, with independent color, opacity, and blur controls. Display copies are optimized when needed; stored and exported originals remain unchanged.

**Surfaces and typography.** Adjust the sidebar, composer, user and assistant messages, code blocks, and fonts. Work Panels adds controls for the right file panel, Outputs/Sources cards, and header buttons. Native caption buttons are not replaced; terminal rendering and embedded webpage contents are outside the theming scope.

**Editing and sharing.** Start with eight presets, use undo/redo and draft recovery, save themes locally, and import or export theme packages. Compatible Codex Dream Skin packages can also be converted. Browser development mode provides editing and simulated previews only; it never connects to Codex.

**Background operation.** Closing the editor or pressing Alt+F4 hides it to the Windows system tray while the theme session continues. Click the tray icon to reopen it. The tray menu and Settings provide an explicit Exit action.

## Download And Use

Download `LostCodexTheme_0.2.1_x64-setup.exe` from [GitHub Releases](https://github.com/xiaopenghuang/LostCodexTheme/releases). The installer targets Windows x64 and the desktop UI requires Microsoft Edge WebView2 Runtime. The current installer is not code-signed; a SHA-256 checksum file is provided alongside it.

Open LostCodexTheme, choose a preset or upload a wallpaper, adjust the modules, and save your theme. Before connecting, save your work and fully exit Codex yourself, then use the connection action in the editor's upper-right corner to start a themed session. Saving a theme alone does not apply it to an already-open Codex window.

To keep the theme active, close the editor window rather than choosing Exit. **Restore and explicit Exit may close the Codex session started by this tool before requesting a normal launch. Save your work first.** Force-terminating the editor or a crash may also close its managed Codex session.

Applying a theme synchronizes Codex's saved native light/dark appearance so that caption buttons match. That preference persists after Restore or Exit. The app applies runtime styles through a validated local loopback CDP connection without modifying Codex installation files, `app.asar`, or signatures. Check Settings diagnostics if connection fails; a working preview does not prove a successful connection.

## Compatibility And Validation

Compatibility observations and automated stylesheet fixtures are based on Codex `26.908.4834.0`. Automated tests do not replace live-window acceptance, and Codex updates may require adapter changes. Live sidebar width follows Codex's own divider; the editor's width setting affects only the simulated preview.

See the [release notes](docs/releases/0.2.1.md) for validation scope, known limitations, and fixes. Report problems through [Issues](https://github.com/xiaopenghuang/LostCodexTheme/issues) with your Windows and Codex versions, reproduction steps, and redacted screenshots. Do not include credentials or private conversations.

## Run From Source

Development requires Windows x64, Node.js 22 LTS, the stable Rust MSVC toolchain, Visual Studio C++ Build Tools with a Windows SDK, and WebView2 Runtime.

```powershell
git clone https://github.com/xiaopenghuang/LostCodexTheme.git
cd LostCodexTheme
npm ci
npm run desktop:dev
```

Use `npm run dev` for browser-only editor development or `npm run desktop:build` to build the installer. Scripts prefer a project-local `.tools` Rust toolchain when present and otherwise use system Rust. Toolchains and dependency caches are not included in the repository. See the [development guide](docs/development.md) for testing and build details.

## Repository Layout

`src/` contains the editor, theme model, preview, and package conversion. `src-tauri/` contains the desktop entry point, storage, process management, and Codex adapter. `tests/` and `scripts/` contain regression tests and development/build tooling.

`assets/branding/` contains the original application icon; `public/` and `src-tauri/icons/` contain the web and desktop variants. `docs/` contains public documentation and screenshots. `licenses/` and the root third-party notices preserve dependency licenses and required source archives. Build outputs, personal configuration, local audit history, and development environments stay out of Git. Installers are distributed through Releases only.

## License And Acknowledgments

Licensed under [MIT](LICENSE). Third-party components retain their respective licenses; see [third-party notices](THIRD_PARTY_NOTICES.md) and the [dependency license collection](THIRD_PARTY_DEPENDENCIES.txt).

Thanks to [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin) for compatibility research references. Sources and independent implementation boundaries are documented in [references](docs/references.md).
