use super::{
    detector::Installation,
    error::{Error, Result},
    windows::{self as native, OwnedJob},
};
use std::{collections::HashSet, path::Path};
use windows::{
    core::PCWSTR,
    Win32::{
        System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER, CLSCTX_LOCAL_SERVER},
        UI::Shell::{ApplicationActivationManager, IApplicationActivationManager, AO_NONE},
    },
};

fn activation(installation: &Installation, arguments: &[String]) -> Result<u32> {
    let _apartment = native::Apartment::enter()?;
    let app: Vec<u16> = installation
        .app_user_model_id
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let command = arguments
        .iter()
        .map(|argument| native::quote_argument(argument))
        .collect::<Vec<_>>()
        .join(" ");
    let arguments: Vec<u16> = command.encode_utf16().chain(Some(0)).collect();
    let manager: IApplicationActivationManager = unsafe {
        CoCreateInstance(
            &ApplicationActivationManager,
            None,
            CLSCTX_INPROC_SERVER | CLSCTX_LOCAL_SERVER,
        )?
    };
    Ok(unsafe {
        manager.ActivateApplication(PCWSTR(app.as_ptr()), PCWSTR(arguments.as_ptr()), AO_NONE)?
    })
}

fn matches_arguments(arguments: &[String], port: u16, profile: &Path) -> bool {
    let expected_port = format!("--remote-debugging-port={port}");
    let expected_profile = format!("--user-data-dir={}", profile.display());
    let flags: Vec<_> = arguments
        .iter()
        .filter(|argument| {
            argument.starts_with("--remote-debugging-") || argument.starts_with("--user-data-dir")
        })
        .collect();
    flags.len() == 3
        && flags.iter().any(|arg| arg.as_str() == expected_port)
        && flags
            .iter()
            .any(|arg| arg.as_str() == "--remote-debugging-address=127.0.0.1")
        && flags.iter().any(|arg| arg.as_str() == expected_profile)
}

pub(super) fn launch(
    installation: &Installation,
    arguments: &[String],
    port: u16,
    profile: &Path,
    isolated: bool,
) -> Result<OwnedJob> {
    match OwnedJob::spawn(&installation.executable, arguments) {
        Ok(job) => return Ok(job),
        Err(Error::Native { operation, source })
            if operation.starts_with("CreateProcessW") && source.raw_os_error() == Some(5) =>
        {
            // Activation may target an existing window. It is never an isolated-test fallback.
            if isolated {
                return Err(Error::Native { operation, source });
            }
        }
        Err(error) => return Err(error),
    }
    if !installation.running_pids()?.is_empty() {
        return Err(Error::AlreadyRunning);
    }
    let baseline: HashSet<_> = native::process_ids()?
        .into_iter()
        .map(|(pid, _)| pid)
        .collect();
    let started = native::current_file_time();
    let pid = activation(installation, arguments)
        .map_err(|error| Error::ActivationUnverified(format!("activation: {error}")))?;
    let claim = || -> Result<OwnedJob> {
        if baseline.contains(&pid) {
            return Err(Error::Safety(
                "activation returned a pre-existing PID".into(),
            ));
        }
        let process = native::open_managed_process(pid)?;
        installation.verify_process(&process)?;
        if native::creation_time(&process)? < started
            || !matches_arguments(&native::command_arguments(&process)?, port, profile)
        {
            return Err(Error::Safety(
                "activation process age or launch arguments differ".into(),
            ));
        }
        OwnedJob::adopt(process, pid, &baseline)
    };
    claim().map_err(|error| Error::ActivationUnverified(format!("claim PID {pid}: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn activation_claim_requires_exact_raw_flags() {
        let profile = Path::new(r"C:\LCT\session-profile");
        let arguments = vec![
            "ChatGPT.exe".into(),
            "--remote-debugging-address=127.0.0.1".into(),
            "--remote-debugging-port=49123".into(),
            format!("--user-data-dir={}", profile.display()),
        ];
        assert!(matches_arguments(&arguments, 49123, profile));
        let mut duplicate = arguments.clone();
        duplicate.push("--remote-debugging-address=0.0.0.0".into());
        assert!(!matches_arguments(&duplicate, 49123, profile));
        assert!(!matches_arguments(&arguments, 49124, profile));
        assert!(!matches_arguments(
            &["codex://--remote-debugging-port=49123".into()],
            49123,
            profile
        ));
    }
}
