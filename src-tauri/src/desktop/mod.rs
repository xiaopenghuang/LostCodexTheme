//! Desktop IPC exposes product operations, never raw processes or debugger endpoints.
#[cfg(windows)]
mod adapter;
#[cfg(windows)]
mod lifecycle;
mod model;
mod storage;

#[cfg(windows)]
use adapter::{Adapter, CodexStatus};
use model::{Result, SavedTheme, ThemeDocument};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use storage::Storage;
use tauri::{Emitter, Manager, State};

#[cfg(windows)]
struct DesktopState {
    storage: Arc<Storage>,
    adapter: Adapter,
    draft_pending: AtomicBool,
    close_granted: AtomicBool,
    isolated_test: bool,
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|_| "后台任务被中断，请重试")?
}

#[cfg(windows)]
#[tauri::command]
async fn list_themes(state: State<'_, DesktopState>) -> Result<Vec<SavedTheme>> {
    let storage = state.storage.clone();
    blocking(move || storage.list_themes()).await
}
#[cfg(windows)]
#[tauri::command]
async fn save_theme(state: State<'_, DesktopState>, document: ThemeDocument) -> Result<SavedTheme> {
    let storage = state.storage.clone();
    blocking(move || storage.save_theme(document)).await
}
#[cfg(windows)]
#[tauri::command]
async fn delete_theme(state: State<'_, DesktopState>, id: String) -> Result<()> {
    let storage = state.storage.clone();
    blocking(move || storage.delete_theme(&id)).await
}
#[cfg(windows)]
#[tauri::command]
async fn load_draft(state: State<'_, DesktopState>) -> Result<Option<ThemeDocument>> {
    let storage = state.storage.clone();
    blocking(move || storage.load_draft()).await
}
#[cfg(windows)]
#[tauri::command]
async fn save_draft(state: State<'_, DesktopState>, document: ThemeDocument) -> Result<()> {
    let storage = state.storage.clone();
    blocking(move || storage.save_draft(document)).await
}
#[cfg(windows)]
#[tauri::command]
async fn clear_draft(state: State<'_, DesktopState>) -> Result<()> {
    let storage = state.storage.clone();
    blocking(move || storage.clear_draft()).await
}
#[cfg(windows)]
#[tauri::command]
async fn save_image(state: State<'_, DesktopState>, name: String, bytes: Vec<u8>) -> Result<()> {
    let storage = state.storage.clone();
    blocking(move || storage.save_image(&name, &bytes)).await
}
#[cfg(windows)]
#[tauri::command]
async fn load_image(state: State<'_, DesktopState>, name: String) -> Result<Vec<u8>> {
    let storage = state.storage.clone();
    blocking(move || storage.load_image(&name)).await
}
#[cfg(windows)]
#[tauri::command]
async fn list_system_fonts() -> Result<Vec<String>> {
    blocking(|| {
        let mut database = fontdb::Database::new();
        database.load_system_fonts();
        let mut families: Vec<_> = database
            .faces()
            .flat_map(|face| face.families.iter().map(|family| family.0.clone()))
            .filter(|family| {
                !family.is_empty()
                    && family.chars().count() <= 120
                    && family
                        .chars()
                        .all(|ch| ch.is_alphanumeric() || " ._()-".contains(ch))
            })
            .collect();
        families.sort();
        families.dedup();
        Ok(families)
    })
    .await
}
#[cfg(windows)]
#[tauri::command]
async fn save_export(
    window: tauri::WebviewWindow,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<bool> {
    if bytes.len() > 32 * 1024 * 1024 || !bytes.starts_with(b"PK\x03\x04") {
        return Err("导出的主题包为空、过大或格式不正确".into());
    }
    if !file_name.ends_with(".zip")
        || file_name.chars().count() > 100
        || file_name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return Err("导出文件名不正确".into());
    }
    blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("导出主题包")
            .add_filter("LostCodexTheme", &["zip"])
            .set_file_name(&file_name)
            .save_file()
        else {
            return Ok(false);
        };
        storage::save_export_file(&path, &bytes)?;
        Ok(true)
    })
    .await
}
#[cfg(windows)]
#[tauri::command]
async fn get_codex_status(state: State<'_, DesktopState>) -> Result<CodexStatus> {
    let adapter = state.adapter.clone();
    blocking(move || adapter.status()).await
}
#[cfg(windows)]
#[tauri::command]
async fn start_theming_session(state: State<'_, DesktopState>) -> Result<CodexStatus> {
    if state.isolated_test {
        return Err("隔离测试模式禁止操作 Codex".into());
    }
    let adapter = state.adapter.clone();
    blocking(move || adapter.start()).await
}
#[cfg(windows)]
#[tauri::command]
async fn apply_theme_css(
    state: State<'_, DesktopState>,
    css: String,
    custom_css: String,
) -> Result<CodexStatus> {
    if state.isolated_test {
        return Err("隔离测试模式禁止操作 Codex".into());
    }
    let adapter = state.adapter.clone();
    blocking(move || adapter.apply(css, custom_css)).await
}
#[cfg(windows)]
#[tauri::command]
async fn restore_default(state: State<'_, DesktopState>) -> Result<CodexStatus> {
    if state.isolated_test {
        return Err("隔离测试模式禁止操作 Codex".into());
    }
    let adapter = state.adapter.clone();
    blocking(move || adapter.restore()).await
}
#[cfg(windows)]
#[tauri::command]
async fn reconnect_codex(state: State<'_, DesktopState>) -> Result<CodexStatus> {
    if state.isolated_test {
        return Err("隔离测试模式禁止操作 Codex".into());
    }
    let adapter = state.adapter.clone();
    blocking(move || adapter.reconnect()).await
}
#[cfg(windows)]
#[tauri::command]
async fn get_diagnostics(state: State<'_, DesktopState>) -> Result<String> {
    let adapter = state.adapter.clone();
    blocking(move || adapter.diagnostics()).await
}
#[cfg(windows)]
#[tauri::command]
fn close_editor(window: tauri::WebviewWindow, state: State<'_, DesktopState>) -> Result<()> {
    if state.adapter.session_active() {
        return Err("请先恢复 Codex 默认状态，再退出编辑器".into());
    }
    state.close_granted.store(true, Ordering::Release);
    if window.close().is_err() {
        state.close_granted.store(false, Ordering::Release);
        return Err("无法关闭窗口".into());
    }
    Ok(())
}
#[cfg(windows)]
#[tauri::command]
fn set_editor_dirty(state: State<'_, DesktopState>, dirty: bool) {
    state.draft_pending.store(dirty, Ordering::Release);
}

#[cfg(windows)]
#[tauri::command]
fn request_editor_exit(app: tauri::AppHandle) -> Result<()> {
    lifecycle::request_exit(&app).map_err(|_| "无法打开退出确认，请从托盘重新打开窗口".into())
}

#[cfg(windows)]
#[tauri::command]
fn get_runtime_info(
    window: tauri::WebviewWindow,
    state: State<'_, DesktopState>,
) -> serde_json::Value {
    serde_json::json!({ "version": env!("CARGO_PKG_VERSION"), "isolatedTest": state.isolated_test,
        "windowVisible": window.is_visible().ok(),
        "trayAvailable": window.app_handle().tray_by_id(lifecycle::TRAY_ID).is_some(),
        "testDirectory": if state.isolated_test { Some(state.storage.root_path().display().to_string()) } else { None } })
}
#[cfg(windows)]
#[tauri::command]
async fn get_preferences(state: State<'_, DesktopState>) -> Result<model::Preferences> {
    let storage = state.storage.clone();
    blocking(move || storage.load_preferences()).await
}
#[cfg(windows)]
#[tauri::command]
async fn save_preferences(
    state: State<'_, DesktopState>,
    preferences: model::Preferences,
) -> Result<()> {
    let storage = state.storage.clone();
    blocking(move || storage.save_preferences(preferences)).await
}
#[cfg(windows)]
#[tauri::command]
async fn open_logs_directory(state: State<'_, DesktopState>) -> Result<()> {
    let storage = state.storage.clone();
    blocking(move || {
        let root = std::env::var_os("SystemRoot").ok_or("无法确定 Windows 目录")?;
        std::process::Command::new(std::path::PathBuf::from(root).join("explorer.exe"))
            .arg(storage.logs_directory()?)
            .spawn()
            .map_err(|_| "无法打开日志文件夹")?;
        Ok(())
    })
    .await
}

#[cfg(windows)]
pub fn run() {
    let test_root = if cfg!(debug_assertions) {
        std::env::var_os("LCT_SMOKE_DIRECTORY").map(std::path::PathBuf::from)
    } else {
        None
    };
    if test_root.as_ref().is_some_and(|root| !root.is_absolute()) {
        eprintln!("Smoke directory must be absolute");
        return;
    }
    let isolated_test = test_root.is_some();
    let mut context = tauri::generate_context!();
    if let Some(root) = &test_root {
        context.config_mut().identifier =
            format!("com.lostcodextheme.smoke.{}", std::process::id());
        if let Some(window) = context.config_mut().app.windows.first_mut() {
            window.visible = false;
            window.data_directory = Some(root.join("webview"));
        }
    }
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Err(error) = lifecycle::show_editor(app) {
                lifecycle::report_error(app, error);
            }
        }))
        .setup(move |app| {
            let local = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is missing")?;
            let storage = Arc::new(
                Storage::open(
                    test_root
                        .clone()
                        .unwrap_or_else(|| std::path::PathBuf::from(local).join("LostCodexTheme")),
                )
                .map_err(std::io::Error::other)?,
            );
            let handle = app.handle().clone();
            let adapter = Adapter::spawn(storage.clone(), move |status| {
                let _ = handle.emit("lct-codex-status", status);
            })
            .map_err(std::io::Error::other)?;
            storage.log("editor started; no Codex session was launched automatically");
            app.manage(DesktopState {
                storage,
                adapter,
                draft_pending: AtomicBool::new(false),
                close_granted: AtomicBool::new(false),
                isolated_test,
            });
            lifecycle::install(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(state) = window.try_state::<DesktopState>() {
                    if !state.close_granted.load(Ordering::Acquire) {
                        api.prevent_close();
                        // Hiding keeps the worker, draft autosave and owned job
                        // alive. Only close_editor can authorize a real exit.
                        if window.app_handle().tray_by_id(lifecycle::TRAY_ID).is_some() {
                            if let Err(error) = window.hide() {
                                lifecycle::report_error(window.app_handle(), error);
                            }
                        } else {
                            lifecycle::report_error(window.app_handle(), "Tray icon unavailable");
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_themes,
            save_theme,
            delete_theme,
            load_draft,
            save_draft,
            clear_draft,
            save_image,
            load_image,
            list_system_fonts,
            save_export,
            get_codex_status,
            start_theming_session,
            apply_theme_css,
            restore_default,
            reconnect_codex,
            get_diagnostics,
            close_editor,
            request_editor_exit,
            set_editor_dirty,
            get_runtime_info,
            get_preferences,
            save_preferences,
            open_logs_directory
        ])
        .run(context);
    if let Err(error) = result {
        if isolated_test {
            eprintln!("Native smoke startup failed: {error}");
            return;
        }
        rfd::MessageDialog::new()
            .set_title("LostCodexTheme 无法启动")
            .set_description(format!("请检查本地数据目录与运行环境。\n{error}"))
            .set_level(rfd::MessageLevel::Error)
            .show();
    }
}

#[cfg(not(windows))]
pub fn run() {
    eprintln!("LostCodexTheme desktop currently supports Windows only.");
}
