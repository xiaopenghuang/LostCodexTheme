use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Profile {
    pub id: &'static str,
    pub hosts: &'static [&'static str],
    pub excluded: &'static [&'static str],
    pub parts: &'static [(&'static str, &'static str)],
    #[serde(rename = "nativeCss")]
    pub native_css: &'static str,
}

// Heuristic only. A version is not certified until the live PoC passes.
pub const DEFAULT: Profile = Profile {
    id: "default-owl-heuristic",
    hosts: &["-", "codex"],
    excluded: &["overlay", "avatar", "devtools", "secondary", "picture-in-picture"],
    native_css: include_str!("native-theme.css"),
    parts: &[
        ("root", "body"),
        ("main", "main[data-app-shell-main-surface], main.main-surface, main[class*='_MainContentSurface_']"),
        ("sidebar", "aside.app-shell-left-panel"),
        ("composer", "[data-composer-surface-variant][data-composer-radius-variant], [class*='_ComposerLayoutRoot_'], .composer-surface-chrome"),
        ("user-message", ".bg-user-message, [data-message-author-role='user']:not(:has(.bg-user-message)), [data-local-conversation-user-anchor]:not(:has(.bg-user-message, [data-message-author-role='user']))"),
        ("assistant-message", "[data-message-author-role='assistant'], [data-local-conversation-final-assistant]"),
        ("code-block", "pre:has(code)"),
        ("header", "header.app-header-tint, header[data-app-shell-header-edge-scroll], header[class*='_Header_']"),
        ("home", "[role='main']:has([data-testid='home-icon'])"),
        ("thread", ".thread-scroll-container"),
        ("workspace-shell", "aside[data-app-shell-focus-area='right-panel']"),
        ("workspace-panel", "aside[data-app-shell-focus-area='right-panel'] > div > .absolute.inset-0 > .absolute.top-0.bottom-0"),
        ("summary-panel", ".rounded-3xl.bg-surface-elevated-secondary:has(> div > div > section[role='presentation'])"),
        ("toolbar-button", "[data-testid='app-shell-header-context-menu-surface'] [data-app-shell-header-obstacle] > .no-drag button, [data-pip-obstacle='app-shell-header'] [data-test-id='header-shell-slot'] .no-drag button, [data-testid='app-shell-header-context-menu-surface'] [data-app-shell-page-header] [data-app-shell-header-toolbar] > .ms-auto button"),
        ("thread-top-fade", "[class*='_MainContentTopFade_'][data-app-shell-main-content-top-fade]"),
        ("composer-backdrop", ".thread-scroll-container [aria-hidden='true'].sticky.bottom-0 > [aria-hidden='true'].pointer-events-none.absolute.bottom-0.bg-gradient-to-t.from-surface.via-surface"),
        ("composer-toolbar", "[data-composer-footer-responsive], [class*='_ComposerLayoutFooter_'], .composer-surface-chrome [class*='_footer_']"),
        ("dialog", "[role='dialog']"),
    ],
};
