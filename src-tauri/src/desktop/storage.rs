use super::model::{valid_asset, valid_id, Preferences, Result, SavedTheme, ThemeDocument};
use chrono::{SecondsFormat, Utc};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAX_RECORD: usize = 1024 * 1024;
const MAX_IMAGE: usize = 10 * 1024 * 1024;

pub struct Storage {
    root: PathBuf,
    writes: Mutex<()>,
}

fn reject_link(path: &Path) -> Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("无法检查本地文件".into()),
    };
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("数据目录不允许使用链接或重解析点".into());
        }
    }
    if metadata.file_type().is_symlink() {
        return Err("数据目录不允许使用符号链接".into());
    }
    Ok(())
}

fn bounded_read(path: &Path, limit: usize) -> Result<Vec<u8>> {
    reject_link(path)?;
    let file = File::open(path).map_err(|_| "无法读取本地文件")?;
    let mut bytes = Vec::new();
    file.take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取本地文件失败")?;
    if bytes.len() > limit {
        return Err("本地文件超出大小限制".into());
    }
    Ok(bytes)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    reject_link(path)?;
    let parent = path.parent().ok_or("无法确定保存目录")?;
    reject_link(parent)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建临时保存文件")?;
    temp.write_all(bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "写入失败，请检查磁盘空间")?;
    temp.persist(path)
        .map_err(|_| "保存未完成，原文件未被替换")?;
    Ok(())
}

/// Destination is selected through the OS Save dialog, never supplied by frontend IPC.
pub fn save_export_file(path: &Path, bytes: &[u8]) -> Result<()> {
    if path
        .extension()
        .and_then(|s| s.to_str())
        .is_none_or(|s| !s.eq_ignore_ascii_case("zip"))
    {
        return Err("主题包必须保存为 ZIP 文件".into());
    }
    atomic_write(path, bytes)
}

impl Storage {
    pub fn root_path(&self) -> &Path {
        &self.root
    }
    pub fn open(root: PathBuf) -> Result<Self> {
        reject_link(&root)?;
        fs::create_dir_all(&root).map_err(|_| "无法创建用户数据目录")?;
        let root = root.canonicalize().map_err(|_| "无法确定用户数据目录")?;
        for name in ["themes", "images", "backups", "logs", "session-profile"] {
            let path = root.join(name);
            reject_link(&path)?;
            fs::create_dir_all(&path).map_err(|_| "无法创建主题数据目录")?;
        }
        Ok(Self {
            root,
            writes: Mutex::new(()),
        })
    }

    fn path(&self, directory: &str, name: &str) -> Result<PathBuf> {
        self.check_root()?;
        let directory = self.root.join(directory);
        reject_link(&directory)?;
        if directory
            .canonicalize()
            .map_err(|_| "数据目录无法访问")?
            .parent()
            != Some(self.root.as_path())
        {
            return Err("数据目录已被更改，请重新打开编辑器".into());
        }
        let path = directory.join(name);
        reject_link(&path)?;
        Ok(path)
    }

    fn check_root(&self) -> Result<()> {
        reject_link(&self.root)?;
        if self
            .root
            .canonicalize()
            .map_err(|_| "用户数据目录无法访问")?
            != self.root
        {
            return Err("用户数据目录已被更改".into());
        }
        Ok(())
    }

    pub fn load_preferences(&self) -> Result<Preferences> {
        self.check_root()?;
        let path = self.root.join("config.json");
        reject_link(&path)?;
        if !path.exists() {
            return Ok(Preferences::default());
        }
        serde_json::from_slice(&bounded_read(&path, 4096)?)
            .map_err(|_| "偏好设置文件损坏，原文件已保留".into())
    }

    pub fn save_preferences(&self, preferences: Preferences) -> Result<()> {
        self.check_root()?;
        let _guard = self.writes.lock().map_err(|_| "本地存储暂时不可用")?;
        atomic_write(
            &self.root.join("config.json"),
            &serde_json::to_vec_pretty(&preferences).map_err(|_| "无法保存偏好设置")?,
        )
    }

    pub fn logs_directory(&self) -> Result<PathBuf> {
        Ok(self
            .path("logs", "lost-codex-theme.log")?
            .parent()
            .ok_or("日志目录无法访问")?
            .to_path_buf())
    }

    pub fn pending_activation(&self) -> Result<bool> {
        self.check_root()?;
        let path = self.root.join("pending-activation.json");
        reject_link(&path)?;
        Ok(path.exists())
    }

    pub fn set_pending_activation(&self, pending: bool) -> Result<()> {
        self.check_root()?;
        let _guard = self.writes.lock().map_err(|_| "本地存储暂时不可用")?;
        let path = self.root.join("pending-activation.json");
        reject_link(&path)?;
        if pending {
            atomic_write(&path, b"{\"manualExitRequired\":true}")
        } else if path.exists() {
            fs::remove_file(path).map_err(|_| "无法清除启动恢复记录".into())
        } else {
            Ok(())
        }
    }

    fn theme_path(&self, id: &str) -> Result<PathBuf> {
        if !valid_id(id) {
            return Err("主题标识不合法".into());
        }
        self.path("themes", &format!("{id}.json"))
    }

    pub fn list_themes(&self) -> Result<Vec<SavedTheme>> {
        let directory = self
            .path("themes", "index")?
            .parent()
            .unwrap()
            .to_path_buf();
        let mut result = Vec::new();
        for entry in fs::read_dir(directory).map_err(|_| "无法读取主题列表")? {
            let entry = entry.map_err(|_| "无法读取主题记录")?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let bytes = bounded_read(&path, MAX_RECORD)?;
            let record: SavedTheme =
                serde_json::from_slice(&bytes).map_err(|_| "有主题文件损坏，原文件已保留")?;
            record.document.validate()?;
            if path.file_stem().and_then(|s| s.to_str()) != Some(record.document.id()) {
                return Err("主题文件标识不匹配，原文件已保留".into());
            }
            result.push(record);
        }
        result.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
        Ok(result)
    }

    pub fn save_theme(&self, document: ThemeDocument) -> Result<SavedTheme> {
        document.validate()?;
        let _guard = self.writes.lock().map_err(|_| "本地存储暂时不可用")?;
        if let Some(image) = document.image() {
            self.load_image(image)?;
        }
        let path = self.theme_path(document.id())?;
        let record = SavedTheme {
            document,
            saved_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        };
        if path.exists() {
            let previous = bounded_read(&path, MAX_RECORD)?;
            let backup = self.path("backups", &format!("{}.json", record.document.id()))?;
            atomic_write(&backup, &previous)?;
        }
        let bytes = serde_json::to_vec_pretty(&record).map_err(|_| "无法序列化主题")?;
        if bytes.len() > MAX_RECORD {
            return Err("主题配置过大".into());
        }
        atomic_write(&path, &bytes)?;
        Ok(record)
    }

    pub fn delete_theme(&self, id: &str) -> Result<()> {
        let _guard = self.writes.lock().map_err(|_| "本地存储暂时不可用")?;
        let path = self.theme_path(id)?;
        if !path.exists() {
            return Ok(());
        }
        let bytes = bounded_read(&path, MAX_RECORD)?;
        atomic_write(
            &self.path("backups", &format!("{id}-deleted.json"))?,
            &bytes,
        )?;
        fs::remove_file(path).map_err(|_| "无法移除主题，请稍后重试".into())
    }

    pub fn load_draft(&self) -> Result<Option<ThemeDocument>> {
        self.check_root()?;
        let path = self.root.join("autosave.json");
        reject_link(&path)?;
        if !path.exists() {
            return Ok(None);
        }
        let bytes = bounded_read(&path, MAX_RECORD)?;
        let document: ThemeDocument = serde_json::from_slice(&bytes)
            .map_err(|_| "草稿文件损坏，已保留原文件。请手动保存当前主题")?;
        document.validate()?;
        Ok(Some(document))
    }

    pub fn save_draft(&self, document: ThemeDocument) -> Result<()> {
        self.check_root()?;
        document.validate()?;
        let _guard = self.writes.lock().map_err(|_| "本地存储暂时不可用")?;
        let bytes = serde_json::to_vec(&document).map_err(|_| "无法保存草稿")?;
        if bytes.len() > MAX_RECORD {
            return Err("草稿配置过大".into());
        }
        atomic_write(&self.root.join("autosave.json"), &bytes)
    }

    pub fn clear_draft(&self) -> Result<()> {
        self.check_root()?;
        let _guard = self.writes.lock().map_err(|_| "本地存储暂时不可用")?;
        let path = self.root.join("autosave.json");
        reject_link(&path)?;
        if path.exists() {
            let metadata = fs::metadata(&path).map_err(|_| "无法检查草稿文件")?;
            if !metadata.is_file() {
                return Err("草稿路径不是普通文件".into());
            }
            let backup = self.path(
                "backups",
                &format!(
                    "discarded-draft-{}-{}.json",
                    Utc::now().timestamp_nanos_opt().unwrap_or_default(),
                    std::process::id()
                ),
            )?;
            fs::rename(path, backup).map_err(|_| "无法备份旧草稿，原文件已保留")?;
        }
        Ok(())
    }

    pub fn validate_image(name: &str, bytes: &[u8]) -> Result<()> {
        if !valid_asset(name) || bytes.is_empty() || bytes.len() > MAX_IMAGE {
            return Err("图片名称或大小不符合要求".into());
        }
        let format = image::guess_format(bytes).map_err(|_| "无法识别图片格式")?;
        let expected = match name.rsplit('.').next() {
            Some("png") => image::ImageFormat::Png,
            Some("webp") => image::ImageFormat::WebP,
            Some("jpg" | "jpeg") => image::ImageFormat::Jpeg,
            _ => return Err("不支持的图片格式".into()),
        };
        if format != expected {
            return Err("图片内容与文件扩展名不一致".into());
        }
        let reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
        let (width, height) = reader.into_dimensions().map_err(|_| "图片数据已损坏")?;
        if width == 0
            || height == 0
            || width > 16384
            || height > 16384
            || u64::from(width) * u64::from(height) > 50_000_000
        {
            return Err("图片尺寸过大或不正确".into());
        }
        Ok(())
    }

    pub fn save_image(&self, name: &str, bytes: &[u8]) -> Result<()> {
        Self::validate_image(name, bytes)?;
        let _guard = self.writes.lock().map_err(|_| "本地存储暂时不可用")?;
        let path = self.path("images", name)?;
        if path.exists() {
            return Err("图片标识已存在，请重新选择图片".into());
        }
        atomic_write(&path, bytes)
    }
    pub fn load_image(&self, name: &str) -> Result<Vec<u8>> {
        if !valid_asset(name) {
            return Err("图片名称不合法".into());
        }
        let bytes = bounded_read(&self.path("images", name)?, MAX_IMAGE)?;
        Self::validate_image(name, &bytes)?;
        Ok(bytes)
    }

    pub fn session_profile(&self) -> Result<PathBuf> {
        let path = self.root.join("session-profile");
        reject_link(&path)?;
        if path
            .canonicalize()
            .map_err(|_| "主题工作目录无法访问")?
            .parent()
            != Some(self.root.as_path())
        {
            return Err("主题工作目录已被更改".into());
        }
        Ok(path)
    }

    pub fn log(&self, event: &str) {
        let Ok(_guard) = self.writes.lock() else {
            return;
        };
        let Ok(path) = self.path("logs", "lost-codex-theme.log") else {
            return;
        };
        if fs::metadata(&path).is_ok_and(|m| m.len() > 2 * 1024 * 1024) {
            let Ok(previous) = self.path("logs", "lost-codex-theme.previous.log") else {
                return;
            };
            if let Ok(bytes) = bounded_read(&path, 3 * 1024 * 1024) {
                if atomic_write(&previous, &bytes).is_err() || atomic_write(&path, &[]).is_err() {
                    return;
                }
            }
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let safe = event.replace(['\r', '\n'], " ");
            let _ = writeln!(
                file,
                "{} {}",
                Utc::now().to_rfc3339(),
                safe.chars().take(1000).collect::<String>()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> ThemeDocument {
        serde_json::from_str(include_str!("../../../tests/fixtures/document.json")).unwrap()
    }
    fn setup() -> (tempfile::TempDir, Storage) {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::open(directory.path().join("data")).unwrap();
        (directory, storage)
    }

    #[test]
    fn save_load_backup_and_delete_are_consistent() {
        let (_temporary, storage) = setup();
        let document = fixture();
        storage.save_theme(document.clone()).unwrap();
        let mut changed = document.clone();
        changed.theme["meta"]["name"] = "Changed".into();
        storage.save_theme(changed).unwrap();
        assert_eq!(
            storage.list_themes().unwrap()[0].document.theme["meta"]["name"],
            "Changed"
        );
        let backup: SavedTheme =
            serde_json::from_slice(&fs::read(storage.root.join("backups/fixture.json")).unwrap())
                .unwrap();
        assert_eq!(backup.document.theme, document.theme);
        storage.delete_theme("fixture").unwrap();
        assert!(storage.list_themes().unwrap().is_empty());
        assert!(storage.root.join("backups/fixture-deleted.json").exists());
    }

    #[test]
    fn invalid_updates_leave_the_previous_record_intact() {
        let (_temporary, storage) = setup();
        storage.save_theme(fixture()).unwrap();
        let mut invalid = fixture();
        invalid.theme["composer"]["radius"] = 900.into();
        assert!(storage.save_theme(invalid).is_err());
        assert_eq!(
            storage.list_themes().unwrap()[0].document.theme["composer"]["radius"],
            18
        );
        assert!(storage.delete_theme("../outside").is_err());
        assert!(storage.load_image("../../outside.png").is_err());
    }

    #[test]
    fn optional_work_panels_round_trip_and_reject_invalid_updates() {
        let (_temporary, storage) = setup();
        let mut document = fixture();
        document.validate().unwrap();
        for key in ["workspacePanel", "summaryPanel", "toolbarButtons"] {
            let mut panel = document.theme["codeBlock"].clone();
            panel["textColor"] = "#abcdef".into();
            panel["opacity"] = 0.35.into();
            document.theme[key] = panel;
        }
        storage.save_theme(document.clone()).unwrap();
        storage.save_draft(document.clone()).unwrap();
        assert_eq!(
            storage.list_themes().unwrap()[0].document.theme,
            document.theme
        );
        assert_eq!(storage.load_draft().unwrap().unwrap().theme, document.theme);
        for key in ["workspacePanel", "summaryPanel", "toolbarButtons"] {
            for invalid in [
                serde_json::Value::Null,
                serde_json::json!({}),
                serde_json::json!({"opacity":2}),
            ] {
                let mut changed = document.clone();
                changed.theme[key] = invalid;
                assert!(storage.save_theme(changed).is_err());
            }
            let mut changed = document.clone();
            changed.theme[key]["textColor"] = "bad".into();
            assert!(storage.save_theme(changed).is_err());
        }
        assert_eq!(
            storage.list_themes().unwrap()[0].document.theme,
            document.theme
        );
    }

    #[test]
    fn drafts_preferences_and_recovery_markers_round_trip() {
        let (_temporary, storage) = setup();
        storage.save_draft(fixture()).unwrap();
        assert_eq!(storage.load_draft().unwrap().unwrap().id(), "fixture");
        storage.clear_draft().unwrap();
        assert!(storage.load_draft().unwrap().is_none());
        assert_eq!(
            fs::read_dir(storage.root.join("backups")).unwrap().count(),
            1
        );
        storage
            .save_preferences(Preferences {
                advanced: true,
                live_apply: false,
            })
            .unwrap();
        let preferences = storage.load_preferences().unwrap();
        assert!(preferences.advanced);
        assert!(!preferences.live_apply);
        storage.set_pending_activation(true).unwrap();
        assert!(storage.pending_activation().unwrap());
        storage.set_pending_activation(false).unwrap();
        assert!(!storage.pending_activation().unwrap());
    }

    #[test]
    fn broken_oversized_drafts_can_be_preserved_without_decoding() {
        let (_temporary, storage) = setup();
        fs::write(
            storage.root.join("autosave.json"),
            vec![b'x'; MAX_RECORD + 1],
        )
        .unwrap();
        assert!(storage.load_draft().is_err());
        storage.clear_draft().unwrap();
        assert!(!storage.root.join("autosave.json").exists());
        let backup = fs::read_dir(storage.root.join("backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap();
        assert_eq!(backup.metadata().unwrap().len(), (MAX_RECORD + 1) as u64);
    }

    #[test]
    fn image_storage_checks_signature_dimensions_and_immutability() {
        let (_temporary, storage) = setup();
        let mut output = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(2, 2)
            .write_to(&mut output, image::ImageFormat::Png)
            .unwrap();
        let bytes = output.into_inner();
        storage.save_image("image.png", &bytes).unwrap();
        assert_eq!(storage.load_image("image.png").unwrap(), bytes);
        assert!(storage.save_image("image.png", &bytes).is_err());
        assert!(storage.save_image("wrong.jpg", &bytes).is_err());
        assert!(storage.save_image("payload.png", b"not an image").is_err());
    }
}
