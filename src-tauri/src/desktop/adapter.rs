use super::{model::Result, storage::Storage};
use crate::codex::{
    cdp::CdpClient,
    css_safety, detector,
    error::Error,
    injector,
    profiles::DEFAULT,
    session::{open_normally, CodexSession},
};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexStatus {
    pub state: String,
    pub message: String,
    pub version: Option<String>,
    pub verified: bool,
    pub session_active: bool,
    pub manual_exit_required: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recovery_worker(storage: Arc<Storage>) -> Worker {
        storage.set_pending_activation(true).unwrap();
        Worker {
            storage,
            emit: Box::new(|_| {}),
            active: Arc::new(AtomicBool::new(true)),
            status: CodexStatus {
                state: "error".into(),
                message: "unverified activation".into(),
                version: None,
                verified: false,
                session_active: false,
                manual_exit_required: true,
            },
            session: None,
            client: None,
            desired_css: None,
            last_error: Some("previous activation".into()),
            reconnect_attempts: 0,
            next_check: Instant::now(),
        }
    }

    #[test]
    fn recovery_clears_without_an_installation_when_no_process_remains() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Arc::new(Storage::open(directory.path().to_owned()).unwrap());
        let mut worker = recovery_worker(storage.clone());
        worker.reconcile_activation(|| Ok(false)).unwrap();
        worker.publish();
        assert!(!storage.pending_activation().unwrap());
        assert!(!worker.status.manual_exit_required);
        assert!(!worker.active.load(Ordering::Acquire));
        assert!(worker.last_error.is_none());
    }

    #[test]
    fn recovery_keeps_exit_guard_for_running_or_uninspectable_processes() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Arc::new(Storage::open(directory.path().to_owned()).unwrap());
        let mut worker = recovery_worker(storage.clone());
        worker.reconcile_activation(|| Ok(true)).unwrap();
        assert!(worker.status.manual_exit_required);
        assert!(storage.pending_activation().unwrap());
        assert!(worker
            .reconcile_activation(|| Err(Error::Safety("identity unavailable".into())))
            .is_err());
        assert!(worker.active.load(Ordering::Acquire));
        assert!(storage.pending_activation().unwrap());
    }

    #[test]
    fn exhausted_reconnects_still_detect_owned_process_exit() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Arc::new(Storage::open(directory.path().to_owned()).unwrap());
        let mut worker = recovery_worker(storage.clone());
        worker.status.manual_exit_required = false;
        worker.session = Some(CodexSession::test_owned_process());
        worker.reconnect_attempts = 3;
        worker.desired_css = Some("body { color: red; }".into());
        worker.publish();
        worker.next_check = Instant::now() + Duration::from_secs(8);
        assert!(worker.poll_timeout() <= Duration::from_secs(1));
        worker.health_check(false);
        assert_eq!(worker.reconnect_attempts, 3);
        assert!(worker.session.is_some());
        worker.session.as_ref().unwrap().full_restore().unwrap();
        worker.health_check(false);
        assert!(worker.session.is_none());
        assert!(worker.desired_css.is_none());
        assert!(!worker.active.load(Ordering::Acquire));
        assert!(!storage.pending_activation().unwrap());
        assert_eq!(worker.status.state, "disconnected");
        assert_eq!(worker.poll_timeout(), Duration::from_secs(3600));
    }

    #[test]
    fn startup_exit_guard_is_active_before_worker_initialization() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Arc::new(Storage::open(directory.path().to_owned()).unwrap());
        storage.set_pending_activation(true).unwrap();
        let adapter = Adapter::spawn(storage, |_| {}).unwrap();
        assert!(adapter.session_active());
    }
}

enum Action {
    Status,
    Start,
    Apply { css: String, custom_css: String },
    Restore,
    Reconnect,
    Diagnostics,
}
enum Reply {
    Status(CodexStatus),
    Diagnostics(String),
}
struct Request {
    action: Action,
    reply: SyncSender<Result<Reply>>,
}

#[derive(Clone)]
pub struct Adapter {
    sender: SyncSender<Request>,
    active: Arc<AtomicBool>,
}

impl Adapter {
    pub fn spawn(
        storage: Arc<Storage>,
        emit: impl Fn(CodexStatus) + Send + 'static,
    ) -> Result<Self> {
        let (sender, receiver) = mpsc::sync_channel(8);
        // Publish the persisted exit guard before the adapter can reach the UI.
        let manual_exit_required = storage.pending_activation().unwrap_or(true);
        let active = Arc::new(AtomicBool::new(manual_exit_required));
        let ownership = active.clone();
        thread::Builder::new()
            .name("lct-codex-adapter".into())
            .spawn(move || {
                let mut worker = Worker {
                    storage,
                    emit: Box::new(emit),
                    active: ownership,
                    status: CodexStatus {
                        state: "disconnected".into(),
                        message: "Codex 未连接".into(),
                        version: None,
                        verified: false,
                        session_active: false,
                        manual_exit_required,
                    },
                    session: None,
                    client: None,
                    desired_css: None,
                    last_error: None,
                    reconnect_attempts: 0,
                    next_check: Instant::now() + Duration::from_secs(8),
                };
                worker.run(receiver);
            })
            .map_err(|_| "无法启动 Codex 兼容线程")?;
        Ok(Self { sender, active })
    }

    pub fn session_active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    fn request(&self, action: Action) -> Result<Reply> {
        let (reply, response) = mpsc::sync_channel(1);
        self.sender
            .send(Request { action, reply })
            .map_err(|_| "Codex 控制线程已结束，请重新打开编辑器")?;
        response
            .recv()
            .map_err(|_| "Codex 操作被中断，请检查当前窗口状态".to_owned())?
    }

    fn status_request(&self, action: Action) -> Result<CodexStatus> {
        match self.request(action)? {
            Reply::Status(status) => Ok(status),
            _ => Err("内部响应类型不匹配".into()),
        }
    }
    pub fn status(&self) -> Result<CodexStatus> {
        self.status_request(Action::Status)
    }
    pub fn start(&self) -> Result<CodexStatus> {
        self.status_request(Action::Start)
    }
    pub fn apply(&self, css: String, custom_css: String) -> Result<CodexStatus> {
        self.status_request(Action::Apply { css, custom_css })
    }
    pub fn restore(&self) -> Result<CodexStatus> {
        self.status_request(Action::Restore)
    }
    pub fn reconnect(&self) -> Result<CodexStatus> {
        self.status_request(Action::Reconnect)
    }
    pub fn diagnostics(&self) -> Result<String> {
        match self.request(Action::Diagnostics)? {
            Reply::Diagnostics(text) => Ok(text),
            _ => Err("内部响应类型不匹配".into()),
        }
    }
}

struct Worker {
    storage: Arc<Storage>,
    emit: Box<dyn Fn(CodexStatus) + Send>,
    active: Arc<AtomicBool>,
    status: CodexStatus,
    session: Option<CodexSession>,
    client: Option<CdpClient>,
    desired_css: Option<String>,
    last_error: Option<String>,
    reconnect_attempts: u32,
    next_check: Instant,
}

impl Worker {
    fn publish(&mut self) {
        self.status.session_active = self.session.is_some();
        self.active.store(
            self.status.session_active || self.status.manual_exit_required,
            Ordering::Release,
        );
        (self.emit)(self.status.clone());
    }

    fn record_error(&mut self, operation: &str, error: &Error) -> String {
        self.storage.log(&format!("{operation}: {error}"));
        self.last_error = Some(format!("{operation}: {error}"));
        if matches!(error, Error::ActivationUnverified(_)) {
            self.status.manual_exit_required = true;
            if let Err(error) = self.storage.set_pending_activation(true) {
                self.storage
                    .log(&format!("activation recovery marker: {error}"));
            }
        }
        let message: String = match error {
            Error::StyleTooLarge { max_bytes, .. } if *max_bytes == css_safety::MAX_CUSTOM => {
                "自定义样式过大，请缩减后重新应用。".into()
            }
            Error::StyleTooLarge { .. } => "背景图片与主题样式过大，请缩小图片后重新应用。".into(),
            Error::AlreadyRunning => {
                "Codex 正在运行。请先保存工作并完全退出，再连接主题编辑器。".into()
            }
            Error::NotInstalled => "没有找到当前用户安装的官方 Codex 桌面版。".into(),
            Error::NativeAppearance(_) => "Codex 原生明暗模式同步未通过验证，窗口按钮配色尚未确认。请重新应用主题，或在 Codex 外观设置中选择对应的深浅模式。".into(),
            Error::ActivationUnverified(_) => {
                "系统启动结果无法安全核验，未进行主题注入。请完全退出新打开的 Codex，再重试。"
                    .into()
            }
            Error::Native { operation, .. } if operation.starts_with("CreateProcessW") => {
                "Windows 拒绝了主题启动。安装文件未被修改，当前版本仍需验证系统启动方式。".into()
            }
            Error::Safety(_) => "安全检查未通过，操作已经停止。可在高级模式查看诊断信息。".into(),
            Error::Incompatible(_) => {
                "当前 Codex 窗口暂时无法应用主题，请确认主窗口已打开后重试。".into()
            }
            _ => "无法完成 Codex 操作，请稍后重试或查看诊断信息。".into(),
        };
        self.status.state = "error".into();
        self.status.message = message.clone();
        self.status.verified = false;
        self.publish();
        message
    }

    fn discover(&mut self) -> Result<()> {
        if self.session.is_some() {
            return Ok(());
        }
        self.reconcile_activation(detector::any_official_running)?;
        match detector::detect() {
            Ok(installation) => {
                self.status.version = Some(installation.version);
                if self.last_error.is_none() && !self.status.manual_exit_required {
                    self.status.state = "disconnected".into();
                    self.status.message = "Codex 未连接".into();
                }
            }
            Err(Error::NotInstalled) => {
                self.status.state = "not-installed".into();
                self.status.message = "尚未安装 Codex".into();
                self.status.version = None;
            }
            Err(error) => {
                let message = self.record_error("detect", &error);
                self.status.state = "error".into();
                self.status.message = message;
            }
        }
        self.publish();
        Ok(())
    }

    fn reconcile_activation(
        &mut self,
        running: impl FnOnce() -> crate::codex::error::Result<bool>,
    ) -> Result<()> {
        if self.status.manual_exit_required {
            if running().map_err(|error| self.record_error("activation recovery check", &error))? {
                self.status.state = "error".into();
                self.status.message = "启动结果尚未核验，请先完全退出 Codex".into();
            } else {
                self.storage.set_pending_activation(false)?;
                self.status.manual_exit_required = false;
                self.last_error = None;
            }
        }
        Ok(())
    }

    fn start(&mut self) -> Result<()> {
        self.discover()?;
        if self.status.manual_exit_required {
            return Err("请完全退出新打开的 Codex，再重新连接".into());
        }
        if self.session.is_some() {
            return self.reconnect();
        }
        let profile = self.storage.session_profile()?;
        // Commit recovery intent before any activation can expose a debugging endpoint.
        self.storage.set_pending_activation(true)?;
        let session = match CodexSession::launch_managed(profile) {
            Ok(session) => session,
            Err(error) => {
                if matches!(error, Error::ActivationUnverified(_)) {
                    self.status.manual_exit_required = true;
                } else {
                    // Pre-launch failures and dropped owned jobs cannot leave an unclaimed activation.
                    self.storage.set_pending_activation(false)?;
                }
                return Err(self.record_error("launch", &error));
            }
        };
        self.status.manual_exit_required = false;
        self.status.version = Some(session.version().into());
        self.session = Some(session);
        self.status.message = "正在检查 Codex 窗口".into();
        self.publish();
        match self
            .session
            .as_mut()
            .unwrap()
            .connect(Duration::from_secs(25))
        {
            Ok(client) => {
                self.client = Some(client);
                self.last_error = None;
                self.reconnect_attempts = 0;
                self.status.state = "connected".into();
                self.status.message = "Codex 已连接".into();
                self.status.verified = true;
                self.next_check = Instant::now() + Duration::from_secs(8);
                self.storage
                    .log("theming session connected; renderer profile verified");
                self.publish();
                Ok(())
            }
            Err(error) => {
                let message = self.record_error("connect", &error);
                if let Err(cleanup) = self.close_owned("failed connection cleanup") {
                    self.status.state = "error".into();
                    self.status.message = "连接失败，主题进程仍需恢复".into();
                    self.publish();
                    return Err(format!("{message} {cleanup}"));
                }
                self.status.state = "error".into();
                self.status.message = message.clone();
                self.publish();
                Err(message)
            }
        }
    }

    fn apply(&mut self, css: String, custom: String) -> Result<()> {
        css_safety::validate(&css, false)
            .map_err(|error| self.record_error("validate generated CSS", &error))?;
        css_safety::validate(&custom, true)
            .map_err(|error| self.record_error("validate custom CSS", &error))?;
        let combined = if custom.trim().is_empty() {
            css
        } else {
            format!("{css}\n/* User styles */\n{custom}")
        };
        if self.session.is_none() {
            return Err("请先连接 Codex".into());
        }
        if self.client.is_none() {
            self.reconnect()?;
        }
        let result = self
            .session
            .as_ref()
            .unwrap()
            .apply_css(self.client.as_mut().ok_or("Codex 窗口尚未连接")?, &combined);
        match result {
            Ok(()) => {
                self.desired_css = Some(combined);
                self.last_error = None;
                self.status.state = "applied".into();
                self.status.message = "主题已应用".into();
                self.status.verified = true;
                self.storage.log("theme applied and verified");
                self.publish();
                Ok(())
            }
            Err(error) => {
                let message = self.record_error("apply", &error);
                // Keep the last verified appearance when a new style fails.
                let rollback = if let (Some(previous), Some(client), Some(session)) = (
                    &self.desired_css,
                    self.client.as_mut(),
                    self.session.as_ref(),
                ) {
                    session.apply_css(client, previous)
                } else if let Some(client) = self.client.as_mut() {
                    injector::soft_restore(client, &DEFAULT)
                } else {
                    Ok(())
                };
                if let Err(error) = rollback {
                    self.record_error("apply rollback", &error);
                }
                self.status.state = "error".into();
                self.status.message = message.clone();
                self.publish();
                Err(message)
            }
        }
    }

    fn close_owned(&mut self, reason: &str) -> Result<()> {
        self.storage.log(&format!(
            "cleanup requested: {reason}; owned session: {}; manual exit required: {}",
            self.session.is_some(),
            self.status.manual_exit_required
        ));
        if self.session.is_none() && self.status.manual_exit_required {
            return Err("启动尚未核验，恢复记录已保留，请手动完全退出 Codex".into());
        }
        self.client = None;
        if let Some(session) = self.session.as_ref() {
            if let Err(error) = session.full_restore() {
                return Err(self.record_error("full restore", &error));
            }
        }
        self.session = None;
        self.desired_css = None;
        self.status.verified = false;
        self.status.manual_exit_required = false;
        self.reconnect_attempts = 0;
        self.publish();
        if let Err(error) = self.storage.set_pending_activation(false) {
            self.storage.log(&format!(
                "clear recovery marker after confirmed cleanup: {error}"
            ));
        }
        Ok(())
    }

    fn restore(&mut self) -> Result<()> {
        if self.status.manual_exit_required {
            self.discover()?;
            if self.status.manual_exit_required {
                return Err("未核验的启动实例不能自动关闭，请先手动完全退出 Codex".into());
            }
        }
        if self.session.is_none() {
            self.status.state = "disconnected".into();
            self.status.message = "没有活动的主题连接".into();
            self.publish();
            return Ok(());
        }
        self.close_owned("user restore or restore-and-exit")?;
        if let Err(error) = open_normally() {
            let message = self.record_error("normal relaunch", &error);
            self.status.state = "error".into();
            self.status.message = "主题连接已结束，请手动正常打开 Codex".into();
            self.publish();
            return Err(message);
        }
        self.last_error = None;
        self.status.state = "disconnected".into();
        self.status.message = "已恢复官方启动".into();
        self.storage
            .log("owned session stopped; normal application activation requested");
        self.publish();
        Ok(())
    }

    fn reconnect(&mut self) -> Result<()> {
        let Some(session) = self.session.as_mut() else {
            return Err("没有可重新连接的主题实例，请先连接 Codex".into());
        };
        self.client = None;
        let result = session.connect(Duration::from_secs(12));
        let mut client = result.map_err(|error| self.record_error("reconnect", &error))?;
        if let Some(css) = &self.desired_css {
            let result = self.session.as_ref().unwrap().apply_css(&mut client, css);
            if let Err(error) = result {
                return Err(self.record_error("reapply", &error));
            }
        }
        self.client = Some(client);
        self.reconnect_attempts = 0;
        self.status.state = if self.desired_css.is_some() {
            "applied"
        } else {
            "connected"
        }
        .into();
        self.status.message = if self.desired_css.is_some() {
            "主题已重新应用"
        } else {
            "Codex 已连接"
        }
        .into();
        self.status.verified = true;
        self.next_check = Instant::now() + Duration::from_secs(8);
        self.publish();
        Ok(())
    }

    fn health_check(&mut self, renderer_changed: bool) {
        if self.session.is_none() {
            return;
        }
        let running = self.session.as_ref().unwrap().is_running();
        if matches!(running, Ok(false)) {
            if self.close_owned("owned process already exited").is_ok() {
                self.status.state = "disconnected".into();
                self.status.message = "Codex 已退出，主题连接已结束".into();
                self.publish();
            }
            return;
        }
        // Exhausted renderer retries must not disable owned-process exit detection.
        if self.reconnect_attempts >= 3 {
            return;
        }
        // Low-frequency fallback only; it never starts a new process.
        let healthy = !renderer_changed
            && match (&self.session, &mut self.client, &self.desired_css) {
                (Some(session), Some(client), Some(css)) => {
                    session.verify_css(client, css).unwrap_or(false)
                }
                (Some(session), Some(_), None) => session.verify_identity().is_ok(),
                _ => false,
            };
        if healthy {
            return;
        }
        let attempts = self.reconnect_attempts + 1;
        if self.reconnect().is_err() {
            self.reconnect_attempts = attempts;
            self.status.state = "error".into();
            self.status.message = "Codex 窗口连接中断，可重新连接或恢复默认".into();
            self.next_check = Instant::now() + Duration::from_secs(8 * u64::from(attempts));
            self.publish();
        }
    }

    fn poll_timeout(&self) -> Duration {
        if self.session.is_some() {
            self.next_check
                .saturating_duration_since(Instant::now())
                .min(Duration::from_secs(1))
        } else {
            Duration::from_secs(3600)
        }
    }

    fn run(&mut self, receiver: Receiver<Request>) {
        loop {
            let timeout = self.poll_timeout();
            match receiver.recv_timeout(timeout) {
                Ok(request) => {
                    let result = match request.action {
                        Action::Status => self.discover().map(|_| Reply::Status(self.status.clone())),
                        Action::Start => self.start().map(|_| Reply::Status(self.status.clone())),
                        Action::Apply { css, custom_css } => self.apply(css, custom_css).map(|_| Reply::Status(self.status.clone())),
                        Action::Restore => self.restore().map(|_| Reply::Status(self.status.clone())),
                        Action::Reconnect => self.reconnect().map(|_| Reply::Status(self.status.clone())),
                        Action::Diagnostics => Ok(Reply::Diagnostics(format!(
                            "LostCodexTheme {}\nCodex version: {}\nProfile: {}\nState: {}\nOwned session: {}\nRenderer anchors verified: {}\nFull lifecycle acceptance: pending\nLast error: {}",
                            env!("CARGO_PKG_VERSION"), self.status.version.as_deref().unwrap_or("not detected"), DEFAULT.id, self.status.state,
                            self.session.is_some(), self.status.verified, self.last_error.as_deref().unwrap_or("none")))),
                    };
                    let _ = request.reply.send(result);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let changed = self
                        .client
                        .as_mut()
                        .is_some_and(|client| client.poll_renderer_events().unwrap_or(true));
                    if changed || Instant::now() >= self.next_check {
                        self.next_check = Instant::now() + Duration::from_secs(8);
                        self.health_check(changed);
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if let Err(error) = self.close_owned("editor worker channel closed") {
                        self.storage.log(&format!("worker exit cleanup: {error}"));
                    }
                    break;
                }
            }
        }
    }
}
