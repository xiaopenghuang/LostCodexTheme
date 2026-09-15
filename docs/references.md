# Reference Research

## 0.1.10 Header Button Variants

The 0.1.9 toolbar mapping covered only central header-obstacle/no-drag actions.
Read-only source shows two additional paths: Ova/jva in app-initial renders
`data-test-id=header-shell-slot` outside the central context-menu surface; p6e
in app-primary renders HeaderToolbar.Actions under the page header. The local
conversation page Os supplies the overflow menu and other actions to this latter
path, while Ds supplies unified thread actions through HeaderAction.
Both now map to the existing toolbar-button part, with scoped header anchors.
No locale-dependent label, document-wide button selector or native caption
override is used. Source establishes layout variants, not a live proof that
maximization alone triggers a specific variant.

## 0.1.9 Work Panels

Read-only installed 26.908.4834.0 source anchors:

- `app-initial-d9bed9d614d8.js`, Vba: right-panel focus-area aside, native
  animated width, divider, clip-path wrapper, then absolute top-0/bottom-0 paint
  layer using app-shell-panel-background with color-surface fallback. Fill only
  that inner layer, never the aside or divider, to preserve toolbar cutouts.
- The same entry renders app-shell-header-context-menu-surface, header-obstacle
  groups and no-drag action wrappers. Only buttons under these wrappers map to
  toolbar-button, excluding native captions and portaled menus.
- `app-primary-17b54400f32a.js`, wUt/vHt: summary Content uses the island variant,
  rounded-3xl + bg-surface-elevated-secondary, containing two divs then
  presentation sections. The selector requires that full structure rather than
  matching all raised surfaces or relying on translated labels.
- `review-file-tree-pane-aa17362785e6.js` uses inline color-surface/text tokens
  for the file tree. `text-file-editor-tab-content.electron-157a7bea3259.js`
  passes color-surface into the shared fit/Rr shadow-root CSS for data-file.
  Scoped inherited tokens clear these inner fills; syntax/diff colors are not
  blanket-overridden and no shadow-root DOM or embedded page is modified.

Browser fixtures use installed global CSS with source-shaped panel markup and
a synthetic editor shadow root. This is not live renderer or native glyph proof.

## 0.1.8 Thread-Top Fade

Installed 26.908.4834.0 `app-initial-a09fe9cd72bc.css` defines
`_MainContentTopFade_xmgnx_2` as an absolute, pointer-transparent 16px fade from
color-surface to transparent, with visible and full-bleed states. It is separate
from the ApplicationMenuTopBar drag region and MainContentFrame edge divider.
The adapter requires the native class anchor and data-app-shell-main-content-top-fade
attribute, and clears only its background. Native geometry, z-index, opacity,
border radius, frame borders and window controls are deliberately preserved.

## 0.1.7 Thread-Bottom Scrim

Read-only inspection of installed 26.908.4834.0 finds `_4n` (exported as `zi`) in
`app-primary-17b54400f32a.js`. It renders an aria-hidden decorative div with
pointer-events-none, absolute, bottom-0, bg-gradient-to-t, from-surface and
via-surface classes. `thread-scroll-layout-3e622961d8b2.js` places it directly
inside an aria-hidden sticky bottom-0 spacer under `.thread-scroll-container`.
The spacer height depends on thread-scroll-padding-bottom and must be retained.
The adapter maps only the nested decorative div to composer-backdrop and clears
its background, without changing global color-surface or composer tokens.

## 0.1.6 Native Appearance Synchronization

The user authorized automatic native dark/light preference synchronization on
2026-09-15 after rejecting the opaque 0.1.4 caption backdrop. The original
backdrop and geometry listeners are removed; native controls remain untouched.
Read-only inspection of installed 26.908.4834.0 establishes the following
version-specific interface, not a promise of stable public API compatibility.

`.vite/build/src-CCXHtyvY.js` defines `appearanceTheme` as a read-write enum of
system/light/dark. `main-D8abTQQE.js` exposes get-setting and set-setting through
the `vscode://codex/` fetch bridge. A fetch response carries responseType,
requestId, status and bodyJsonString. `preload.js` exposes
electronBridge.sendMessageFromView and forwards responses as window messages.
`window-all-closed-BxbCP6YG.js` sets nativeTheme.themeSource from that preference;
the main window's nativeTheme updated listener calls setTitleBarOverlay with a
transparent background and matching native symbol color. The adapter uses only
this exact preference, never arbitrary endpoints or keys. Readback and native
media verification are required. This saved setting intentionally persists on
restore/exit. No installed application file or running Codex was modified during
development or isolated testing.

## 0.1.4 Read-Only Native Surface Inspection

For installed Codex 26.908.4834.0, `app-initial-d9bed9d614d8.js` defines settings
groups with `backgroundColor: var(--color-background-panel,
var(--color-background-primary-soft-alpha))`. The shared stylesheet also uses
`--color-surface-elevated` for menus and controls. These neutral surfaces must
be mapped together with the foreground, including nested data-theme scopes.
`local-conversation-turn-eb4d46a6eeb0.js` defines the user anchor as a full-width
navigation wrapper; `conversation-blocks-f4cdb94dfab0.js` renders the actual
`.bg-user-message` inside an end-aligned flex group.

Read-only inspection of `.vite/build/main-D8abTQQE.js` shows transparent native
titleBarOverlay with symbolColor selected from nativeTheme.shouldUseDarkColors
(white or #1f1f1f), not DOM text colors. The renderer uses the public
navigator.windowControlsOverlay API for titlebar geometry. The adapter uses
that same public geometry for a non-interactive backdrop matching the native
prefers-color-scheme palette. It does not call Electron internals, mutate native
preferences, or replace the original buttons. Tests mock geometry only; live
glyph rendering remains an acceptance item.

## Original Reference

Reference project: [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin).
Source snapshot inspected during development:
`34335d27d54300eccb325cc652f6c93fef428b84`, on 2026-09-14.

## Material Consulted

`windows/README.en.md` describes official Store package discovery, loopback CDP,
isolated user-data directories, raw-launch denial, package activation argument
handling, and full restore. It explicitly distinguishes failed launch diagnostics
from actual compatibility evidence.

`windows/scripts/start-dream-skin.ps1` was inspected for the launch argument
shape and the non-default profile requirement. `windows/scripts/common-windows.ps1`
and `windows/scripts/injector.mjs` were inspected in relevant excerpts for
debugger URL validation, browser identity, app targets, overlay exclusion, and
renderer probing. No PowerShell or Node production runtime was imported.

`windows/assets/selectors.json` supplied compatibility observations about
`app://-/index.html`, native sidebar anchors, composer module prefixes, and
semantic message attributes. The selected observations are centralized in
`src-tauri/src/codex/profiles.rs`, with no claim that the default heuristic is
verified against this machine's Codex build.

[Issue 378](https://github.com/Fei-Away/Codex-Dream-Skin/issues/378) supplied
reported Windows PID-reuse and launch/selector regressions. Its author-reported
results are not treated as our own live verification.

The reference README's discussion of issue 235 supplied historical examples
of denied raw launches and builds that retain flags but expose no listener.
The current machine's failure is recorded independently rather than inferred
from those older versions.

## Code and License

LostCodexTheme's Rust control layer, CDP client, bridge logic, test harnesses,
and process-ownership strategy were independently implemented. No reference
runtime, UI, theme files, or substantive function bodies were copied. Selector
facts and compatibility behavior were used as reference data.

The inspected repository uses the MIT license. The upstream license is retained
in `THIRD_PARTY_NOTICES.md` for attribution of referenced selector material.
This notice does not select a license for LostCodexTheme itself.

## Native Windows API Research

Microsoft's `IApplicationActivationManager::ActivateApplication` documentation
was consulted for the activation PID contract, argument handling, and the
limitations of design-mode/no-splash flags. Only `AO_NONE` is used; package
debugger registration and debug-mode changes are not used.

https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-iapplicationactivationmanager-activateapplication

The public `ProcessCommandLineInformation` definition in System Informer's
`phnt/include/ntpsapi.h` was consulted to verify information class 60 and its
`UNICODE_STRING` return shape. No function bodies were copied. The code uses
an independently written bounded native buffer reader, and never logs a
process's complete command line. Source consulted on 2026-09-14:

https://github.com/winsiderss/systeminformer/blob/master/phnt/include/ntpsapi.h

The pinned Dream Skin `common-windows.ps1` launch functions were subsequently
read in full for package activation, exact raw-argument retention, and protocol
redirect behavior. LostCodexTheme prefers the suspended direct path for its
pre-execution job ownership guarantee, then permits activation only in the
non-isolated desktop workflow with no pre-existing official instances. It does
not copy Dream Skin's process-stop strategy or remove ownership checks to force
compatibility.

## Local Native Palette Observations

On 2026-09-15, the installed official Codex 26.908.4834.0 package was opened
read-only to inspect CSS token names and composer layering, not application
behavior or conversation data. The inspected entries were
`webview/assets/app-dddf03d14541.css`, `app-initial-a09fe9cd72bc.css`, and
`app-primary-42ed0a4bb496.css`. Observations included neutral `--color-text` and
`--color-token-text-*` aliases, descendant `[data-theme]` declarations, and
`--composer-layout-surface-*` / `--color-background-composer-action-bar` fills.

The independently authored mapping is in `src-tauri/src/codex/native-theme.css`.
The regression test reads only stylesheet entries into memory and uses a
synthetic DOM with blocked network access. No official resources are modified
or bundled with LostCodexTheme. No warning-color or syntax-color definitions
are replaced by the neutral palette adapter.

Further read-only inspection of `app-initial-d9bed9d614d8.js` and the matching
styles established the sidebar layout relationship. Codex writes the preferred
width to the document element, animates the shell's left-panel width, and gives
the inner wrapper both inline width and minimum width. Header slots use the
same shell width while rows use the sidebar spacing token. Overriding only the
aside cannot safely drive that state. The 0.1.3 adapter therefore preserves
native sizing rather than mutating React stores, synthesizing input in Codex,
or clipping controls to conceal the mismatch. No native application code was
executed or copied into the product during this inspection.
