use super::DesktopState;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

pub const TRAY_ID: &str = "lct-background";

pub fn show_editor(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    }
    Ok(())
}

pub fn request_exit(app: &AppHandle) -> tauri::Result<()> {
    show_editor(app)?;
    // The existing frontend confirmation drains pending work and restores the
    // owned Codex session. Tray actions must never bypass that exit guard.
    app.emit_to("main", "lct-close-requested", ())
}

pub fn report_error(app: &AppHandle, error: impl std::fmt::Display) {
    if let Some(state) = app.try_state::<DesktopState>() {
        state
            .storage
            .log(&format!("editor window operation failed: {error}"));
    }
    rfd::MessageDialog::new()
        .set_title("LostCodexTheme")
        .set_description("无法切换窗口状态，程序没有退出。请重新打开窗口后再试。")
        .set_level(rfd::MessageLevel::Error)
        .show();
}

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "lct-open", "打开换肤软件", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "lct-exit", "退出换肤软件...", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &separator, &exit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("Missing tray icon")?;
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("LostCodexTheme - 后台运行")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let result = match event.id.as_ref() {
                "lct-open" => show_editor(app),
                "lct-exit" => request_exit(app),
                _ => return,
            };
            if let Err(error) = result {
                report_error(app, error);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                if let Err(error) = show_editor(tray.app_handle()) {
                    report_error(tray.app_handle(), error);
                }
            }
        })
        .build(app)?;
    // Keep an explicit owner for the entire application lifetime.
    app.manage(tray);
    Ok(())
}
