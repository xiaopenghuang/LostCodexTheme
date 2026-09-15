use super::{
    error::{Error, Result},
    windows::{open_process, process_ids, process_package, process_path, Handle},
};
use serde::Serialize;
use std::path::{Path, PathBuf};
use windows::{
    core::HSTRING, ApplicationModel::PackageSignatureKind, Management::Deployment::PackageManager,
};

const FAMILY: &str = "OpenAI.Codex_2p2nqsd0c76g0";

fn official_package(name: &str) -> bool {
    name.starts_with("OpenAI.Codex_") && name.ends_with("_2p2nqsd0c76g0")
}

fn official_path_hint(path: &Path) -> bool {
    let components: Vec<_> = path
        .components()
        .map(|part| part.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect();
    components
        .windows(2)
        .any(|parts| parts[0] == "windowsapps" && parts[1].starts_with("openai.codex_"))
}

/// Registration-independent recovery check. This never authorizes process control.
pub fn any_official_running() -> Result<bool> {
    for (pid, name) in process_ids()? {
        if !name.eq_ignore_ascii_case("ChatGPT.exe") {
            continue;
        }
        let process = match open_process(pid) {
            Ok(process) => process,
            Err(Error::Io(error)) if error.raw_os_error() == Some(87) => continue,
            Err(error) => return Err(error),
        };
        if process_package(&process).is_ok_and(|name| official_package(&name)) {
            return Ok(true);
        }
        if official_path_hint(&process_path(&process)?) {
            return Err(Error::Safety(
                "possible official Codex process has an unverified package identity".into(),
            ));
        }
    }
    Ok(false)
}

#[derive(Debug, Clone, Serialize)]
pub struct Installation {
    pub version: String,
    pub package_full_name: String,
    pub package_family_name: String,
    pub app_user_model_id: String,
    pub executable: PathBuf,
}

pub fn detect() -> Result<Installation> {
    let _apartment = super::windows::Apartment::enter()?;
    let manager = PackageManager::new()?;
    let packages = manager
        .FindPackagesByUserSecurityIdPackageFamilyName(&HSTRING::new(), &HSTRING::from(FAMILY))?;
    let mut found = Vec::new();
    for package in packages {
        let id = package.Id()?;
        if id.Name()? != "OpenAI.Codex"
            || id.FamilyName()? != FAMILY
            || package.IsFramework()?
            || package.IsResourcePackage()?
            || package.SignatureKind()? != PackageSignatureKind::Store
        {
            continue;
        }
        let root =
            PathBuf::from(package.InstalledLocation()?.Path()?.to_string()).canonicalize()?;
        let executable = root.join("app").join("ChatGPT.exe").canonicalize()?;
        if !executable.is_file() || executable.parent() != Some(root.join("app").as_path()) {
            return Err(Error::Safety(
                "unexpected official executable location".into(),
            ));
        }
        let v = id.Version()?;
        let entries = package.GetAppListEntries()?;
        if entries.Size()? != 1 {
            return Err(Error::Incompatible(
                "official package has an ambiguous application entry".into(),
            ));
        }
        let app_user_model_id = entries.GetAt(0)?.AppUserModelId()?.to_string();
        if !app_user_model_id.starts_with(&format!("{FAMILY}!")) {
            return Err(Error::Safety(
                "application activation identity differs from package".into(),
            ));
        }
        found.push((
            (v.Major, v.Minor, v.Build, v.Revision),
            Installation {
                version: format!("{}.{}.{}.{}", v.Major, v.Minor, v.Build, v.Revision),
                package_full_name: id.FullName()?.to_string(),
                package_family_name: FAMILY.into(),
                executable,
                app_user_model_id,
            },
        ));
    }
    found.sort_by_key(|(version, _)| *version);
    found
        .pop()
        .map(|(_, install)| install)
        .ok_or(Error::NotInstalled)
}

impl Installation {
    pub(super) fn verify_process(&self, process: &Handle) -> Result<()> {
        if process_package(process)? != self.package_full_name
            || process_path(process)?.canonicalize()? != self.executable
        {
            return Err(Error::Safety(
                "process is not the detected official Codex executable".into(),
            ));
        }
        Ok(())
    }

    pub fn running_pids(&self) -> Result<Vec<u32>> {
        let mut result = Vec::new();
        for (pid, name) in process_ids()? {
            if !name.eq_ignore_ascii_case("ChatGPT.exe") {
                continue;
            }
            let process = match open_process(pid) {
                Ok(process) => process,
                Err(Error::Io(error)) if error.raw_os_error() == Some(87) => continue, // Exited during enumeration.
                Err(error) => return Err(error),
            };
            let path = process_path(&process)?;
            if path.canonicalize()? == self.executable {
                self.verify_process(&process)?;
                result.push(pid);
            } else if process_package(&process).is_ok_and(|name| official_package(&name)) {
                // An older Store version may still be running after an update. This only
                // blocks a new launch; it does not authorize control of that process.
                result.push(pid);
            }
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_identity_covers_previous_versions_without_trusting_lookalikes() {
        assert!(official_package(
            "OpenAI.Codex_26.908.4834.0_x64__2p2nqsd0c76g0"
        ));
        assert!(official_package("OpenAI.Codex_1.0.0.0_x64__2p2nqsd0c76g0"));
        assert!(!official_package(
            "OpenAI.ChatGPT_1.0.0.0_x64__2p2nqsd0c76g0"
        ));
        assert!(!official_package("OpenAI.Codex_1.0.0.0_x64__other"));
        assert!(official_path_hint(Path::new(
            r"C:\Program Files\WINDOWSAPPS\OpenAI.Codex_1.0.0.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe"
        )));
        assert!(!official_path_hint(Path::new(
            r"C:\tools\OpenAI.Codex_test\ChatGPT.exe"
        )));
        assert!(!official_path_hint(Path::new(
            r"C:\WindowsApps\OpenAI.ChatGPT_test\ChatGPT.exe"
        )));
    }
}
