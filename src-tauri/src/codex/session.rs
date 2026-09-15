use super::{
    cdp::{CdpClient, Endpoint},
    detector::{detect, Installation},
    error::{Error, Result},
    injector,
    profiles::DEFAULT,
    target_resolver,
    windows::{listeners, open_process, OwnedJob},
};
use std::{
    net::{IpAddr, Ipv4Addr, TcpListener},
    path::PathBuf,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

/// The job handle owns only this launch and its children. Never attach to a saved PID.
pub struct CodexSession {
    installation: Installation,
    job: OwnedJob,
    endpoint: Endpoint,
    port: u16,
    browser_id: Option<String>,
    pub profile_path: PathBuf,
    pub preserved_existing: bool,
}

impl CodexSession {
    #[cfg(test)]
    pub(crate) fn test_owned_process() -> Self {
        let executable = PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32")
            .join("ping.exe");
        let reservation = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = reservation.local_addr().unwrap().port();
        Self {
            job: OwnedJob::spawn(&executable, &["-t".into(), "127.0.0.1".into()]).unwrap(),
            installation: Installation {
                version: "test-only".into(),
                package_full_name: "not-codex".into(),
                package_family_name: "not-codex".into(),
                app_user_model_id: "not-codex".into(),
                executable,
            },
            endpoint: Endpoint::new(port).unwrap(),
            port,
            browser_id: None,
            profile_path: PathBuf::new(),
            preserved_existing: true,
        }
    }

    pub fn launch(isolated: bool) -> Result<Self> {
        Self::launch_internal(isolated, None)
    }

    pub fn launch_managed(profile_path: PathBuf) -> Result<Self> {
        Self::launch_internal(false, Some(profile_path))
    }

    fn launch_internal(isolated: bool, managed_profile: Option<PathBuf>) -> Result<Self> {
        let installation = detect()?;
        let existing = installation.running_pids()?;
        if !isolated && !existing.is_empty() {
            return Err(Error::AlreadyRunning);
        }
        let reservation = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = reservation.local_addr()?.port();
        let endpoint = Endpoint::new(port)?;
        let local = std::env::var_os("LOCALAPPDATA")
            .ok_or_else(|| Error::Safety("LOCALAPPDATA is missing".into()))?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| Error::Safety("invalid system clock".into()))?
            .as_nanos();
        let profile_path = managed_profile.unwrap_or_else(|| {
            PathBuf::from(local)
                .join("LostCodexTheme")
                .join("poc-profiles")
                .join(format!("{}-{stamp}", std::process::id()))
        });
        std::fs::create_dir_all(&profile_path)?;
        let arguments = vec![
            "--remote-debugging-address=127.0.0.1".into(),
            format!("--remote-debugging-port={port}"),
            format!("--user-data-dir={}", profile_path.display()),
        ];
        // The startup race is resolved by OS listener ownership checks before any HTTP request.
        drop(reservation);
        let job =
            super::launcher::launch(&installation, &arguments, port, &profile_path, isolated)?;
        let session = Self {
            installation,
            job,
            endpoint,
            port,
            browser_id: None,
            profile_path,
            preserved_existing: !existing.is_empty(),
        };
        session.installation.verify_process(&session.job.process)?;
        Ok(session)
    }

    fn verify_listener(&self) -> Result<()> {
        let rows = listeners()?;
        let matching: Vec<_> = rows.iter().filter(|row| row.port == self.port).collect();
        if matching.is_empty() {
            return Err(Error::Timeout("waiting for Codex debug listener"));
        }
        for row in matching {
            if row.address != IpAddr::V4(Ipv4Addr::LOCALHOST) {
                return Err(Error::Safety(
                    "debug listener is not exclusively 127.0.0.1".into(),
                ));
            }
            let process = open_process(row.pid)?;
            self.installation.verify_process(&process)?;
            if !self.job.contains(&process)? {
                return Err(Error::Safety(
                    "debug listener is not owned by this launch".into(),
                ));
            }
        }
        Ok(())
    }

    pub fn connect(&mut self, timeout: Duration) -> Result<CdpClient> {
        let deadline = Instant::now() + timeout;
        let mut detail = "Codex did not open a verified debug listener".to_string();
        while Instant::now() < deadline {
            if self.job.active_count()? == 0 {
                return Err(Error::Incompatible(
                    "isolated launch exited or delegated to an existing instance".into(),
                ));
            }
            match self.verify_listener() {
                Err(Error::Timeout(_)) => {
                    std::thread::sleep(Duration::from_millis(300));
                    continue;
                }
                Err(error) => return Err(error),
                Ok(()) => {}
            }
            let browser_id = self.endpoint.browser_id()?;
            if self.browser_id.as_ref().is_some_and(|id| *id != browser_id) {
                return Err(Error::Safety(
                    "browser identity changed during the session".into(),
                ));
            }
            self.browser_id = Some(browser_id);
            let targets =
                target_resolver::candidates(&self.endpoint.targets()?, &DEFAULT, self.port);
            for target in targets {
                if Instant::now() >= deadline {
                    break;
                }
                self.verify_listener()?;
                let mut client = CdpClient::connect(&target, self.port)?;
                match injector::probe(&mut client, &DEFAULT) {
                    Ok(probe) if probe["compatible"] == true && probe["foreground"] == true => {
                        client.enable_events()?;
                        return Ok(client);
                    }
                    _ => {
                        detail = "main renderer lacks visible profile anchors; no CSS was injected"
                            .into()
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        Err(Error::Incompatible(detail))
    }

    pub fn apply_test(&self, client: &mut CdpClient) -> Result<()> {
        self.verify_listener()?;
        if self.endpoint.browser_id()? != self.browser_id.as_deref().unwrap_or("") {
            return Err(Error::Safety(
                "browser identity changed before apply".into(),
            ));
        }
        injector::apply_test(client, &DEFAULT)
    }

    pub fn apply_css(&self, client: &mut CdpClient, css: &str) -> Result<()> {
        self.verify_identity()?;
        injector::apply_css(client, &DEFAULT, css)
    }

    pub fn verify_css(&self, client: &mut CdpClient, css: &str) -> Result<bool> {
        self.verify_identity()?;
        injector::verify_css(client, &DEFAULT, css)
    }

    pub fn verify_identity(&self) -> Result<()> {
        self.verify_listener()?;
        if self.endpoint.browser_id()? != self.browser_id.as_deref().unwrap_or("") {
            return Err(Error::Safety(
                "browser identity changed during operation".into(),
            ));
        }
        Ok(())
    }

    pub fn is_running(&self) -> Result<bool> {
        Ok(self.job.active_count()? != 0)
    }
    pub fn version(&self) -> &str {
        &self.installation.version
    }

    pub fn full_restore(&self) -> Result<()> {
        self.job.terminate()?;
        // Job accounting may reach zero before the OS releases its listener.
        wait_for_listener_release(Duration::from_secs(3), || {
            Ok(listeners()?.iter().any(|row| row.port == self.port))
        })
    }

    pub fn process_id(&self) -> u32 {
        self.job.pid
    }
}

fn wait_for_listener_release(
    timeout: Duration,
    mut occupied: impl FnMut() -> Result<bool>,
) -> Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        if !occupied()? {
            return Ok(());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(Error::Safety("debug listener remains after bounded cleanup wait; no unowned process was terminated".into()));
        }
        std::thread::sleep(remaining.min(Duration::from_millis(100)));
    }
}

/// Only called after the test job and debug port are confirmed closed.
pub fn open_normally() -> Result<()> {
    let _apartment = super::windows::Apartment::enter()?;
    let install = detect()?;
    if install.running_pids()?.is_empty() {
        use windows::{
            core::PCWSTR,
            Win32::{
                System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER, CLSCTX_LOCAL_SERVER},
                UI::Shell::{ApplicationActivationManager, IApplicationActivationManager, AO_NONE},
            },
        };
        let aumid: Vec<u16> = install
            .app_user_model_id
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let manager: IApplicationActivationManager = unsafe {
            CoCreateInstance(
                &ApplicationActivationManager,
                None,
                CLSCTX_LOCAL_SERVER | CLSCTX_INPROC_SERVER,
            )?
        };
        unsafe {
            manager.ActivateApplication(PCWSTR(aumid.as_ptr()), PCWSTR::null(), AO_NONE)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod cleanup_tests {
    use super::*;

    #[test]
    fn delayed_listener_release_is_waited_for() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            drop(listener);
        });
        wait_for_listener_release(Duration::from_secs(2), || {
            Ok(listeners()?.iter().any(|row| row.port == port))
        })
        .unwrap();
        release.join().unwrap();
    }

    #[test]
    fn occupied_port_is_not_closed_or_treated_as_success() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(wait_for_listener_release(Duration::ZERO, || {
            Ok(listeners()?.iter().any(|row| row.port == port))
        })
        .is_err());
        assert!(listeners().unwrap().iter().any(|row| row.port == port));
    }

    #[test]
    fn unreadable_listener_table_never_confirms_cleanup() {
        assert!(wait_for_listener_release(Duration::ZERO, || {
            Err(Error::Safety("test inspection failure".into()))
        })
        .is_err());
    }
}
