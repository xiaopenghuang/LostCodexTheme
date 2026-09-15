use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeDocument {
    pub theme: Value,
    pub custom_css: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedTheme {
    pub document: ThemeDocument,
    pub saved_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub advanced: bool,
    pub live_apply: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            advanced: false,
            live_apply: true,
        }
    }
}

pub fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

pub fn valid_asset(value: &str) -> bool {
    let Some((name, extension)) = value.rsplit_once('.') else {
        return false;
    };
    valid_id(name) && matches!(extension, "png" | "jpg" | "jpeg" | "webp")
}

fn object<'a>(
    value: &'a Value,
    required: &[&str],
    optional: &[&str],
) -> Result<&'a Map<String, Value>> {
    let fields = value.as_object().ok_or("主题配置中的字段类型不正确")?;
    if required.iter().any(|key| !fields.contains_key(*key))
        || fields
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err("主题配置缺少字段或包含不支持的字段".into());
    }
    Ok(fields)
}

fn text(value: &Value, min: usize, max: usize) -> Result<&str> {
    let value = value.as_str().ok_or("主题配置中的文字类型不正确")?;
    let length = value.chars().count();
    if length < min || length > max || value.trim().is_empty() {
        return Err("主题文字长度不正确".into());
    }
    Ok(value)
}
fn number(value: &Value, min: f64, max: f64) -> Result<f64> {
    let value = value.as_f64().ok_or("主题配置中的数值类型不正确")?;
    if !value.is_finite() || value < min || value > max {
        return Err("主题数值超出支持范围".into());
    }
    Ok(value)
}
fn color(value: &Value) -> Result<()> {
    let value = text(value, 7, 7)?;
    if !value.starts_with('#') || !value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit) {
        return Err("主题颜色格式不正确".into());
    }
    Ok(())
}
fn choice(value: &Value, options: &[&str]) -> Result<()> {
    if !options.contains(&value.as_str().unwrap_or("")) {
        return Err("主题选项不受支持".into());
    }
    Ok(())
}

impl ThemeDocument {
    pub fn id(&self) -> &str {
        self.theme["meta"]["id"].as_str().unwrap_or("")
    }
    pub fn image(&self) -> Option<&str> {
        self.theme["background"]["image"].as_str()
    }

    pub fn validate(&self) -> Result<()> {
        if self.custom_css.len() > 262144 {
            return Err("自定义样式过大".into());
        }
        object(
            &self.theme,
            &[
                "meta",
                "global",
                "background",
                "sidebar",
                "composer",
                "userMessage",
                "assistantMessage",
                "codeBlock",
                "font",
            ],
            &["workspacePanel", "summaryPanel", "toolbarButtons"],
        )?;
        let meta = &self.theme["meta"];
        object(meta, &["id", "name", "version"], &[])?;
        if !valid_id(text(&meta["id"], 1, 100)?) {
            return Err("主题标识不合法".into());
        }
        text(&meta["name"], 1, 80)?;
        if meta["version"].as_u64() != Some(1) {
            return Err("主题格式版本不受支持".into());
        }
        let global = &self.theme["global"];
        object(
            global,
            &[
                "appearance",
                "accent",
                "textColor",
                "density",
                "radius",
                "opacity",
            ],
            &[],
        )?;
        choice(&global["appearance"], &["dark", "light"])?;
        choice(&global["density"], &["compact", "normal", "comfortable"])?;
        color(&global["accent"])?;
        color(&global["textColor"])?;
        number(&global["radius"], 0., 40.)?;
        number(&global["opacity"], 0., 1.)?;
        let background = &self.theme["background"];
        object(
            background,
            &[
                "type",
                "color",
                "gradientStart",
                "gradientEnd",
                "gradientAngle",
                "opacity",
                "overlay",
                "blur",
                "positionX",
                "positionY",
                "size",
            ],
            &["image"],
        )?;
        choice(&background["type"], &["color", "gradient", "image"])?;
        choice(&background["size"], &["cover", "contain"])?;
        for key in ["color", "gradientStart", "gradientEnd"] {
            color(&background[key])?;
        }
        for key in ["opacity", "overlay"] {
            number(&background[key], 0., 1.)?;
        }
        for key in ["positionX", "positionY"] {
            number(&background[key], 0., 100.)?;
        }
        number(&background["gradientAngle"], 0., 360.)?;
        number(&background["blur"], 0., 40.)?;
        if let Some(image) = background.get("image") {
            if !valid_asset(text(image, 1, 110)?) {
                return Err("背景图片名称不合法".into());
            }
        }
        for key in [
            "sidebar",
            "composer",
            "userMessage",
            "assistantMessage",
            "codeBlock",
            "workspacePanel",
            "summaryPanel",
            "toolbarButtons",
        ] {
            if matches!(key, "workspacePanel" | "summaryPanel" | "toolbarButtons")
                && self.theme.get(key).is_none()
            {
                continue;
            }
            let surface = &self.theme[key];
            let mut fields = vec![
                "background",
                "opacity",
                "blur",
                "radius",
                "borderWidth",
                "borderColor",
                "shadow",
            ];
            match key {
                "sidebar" => fields.push("width"),
                "composer" => fields.push("padding"),
                "workspacePanel" | "summaryPanel" | "toolbarButtons" => fields.push("textColor"),
                "userMessage" | "assistantMessage" => {
                    fields.extend(["textColor", "spacing", "maxWidth"])
                }
                _ => {}
            }
            object(surface, &fields, &[])?;
            color(&surface["background"])?;
            color(&surface["borderColor"])?;
            number(&surface["opacity"], 0., 1.)?;
            number(&surface["blur"], 0., 40.)?;
            number(&surface["radius"], 0., 40.)?;
            number(&surface["borderWidth"], 0., 4.)?;
            if !surface["shadow"].is_boolean() {
                return Err("阴影设置类型不正确".into());
            }
            match key {
                "sidebar" => {
                    number(&surface["width"], 180., 360.)?;
                }
                "composer" => {
                    number(&surface["padding"], 8., 32.)?;
                }
                "workspacePanel" | "summaryPanel" | "toolbarButtons" => {
                    color(&surface["textColor"])?
                }
                "userMessage" | "assistantMessage" => {
                    color(&surface["textColor"])?;
                    number(&surface["spacing"], 0., 48.)?;
                    number(&surface["maxWidth"], 40., 100.)?;
                }
                _ => {}
            }
        }
        let font = &self.theme["font"];
        object(
            font,
            &[
                "uiFamily",
                "codeFamily",
                "uiSize",
                "codeSize",
                "weight",
                "lineHeight",
            ],
            &[],
        )?;
        for key in ["uiFamily", "codeFamily"] {
            if !text(&font[key], 1, 120)?
                .chars()
                .all(|c| c.is_alphanumeric() || " ._()-".contains(c))
            {
                return Err("字体名称包含不支持的字符".into());
            }
        }
        number(&font["uiSize"], 11., 24.)?;
        number(&font["codeSize"], 10., 24.)?;
        let weight = number(&font["weight"], 300., 700.)?;
        if weight.fract() != 0. {
            return Err("文字粗细必须是整数".into());
        }
        number(&font["lineHeight"], 1.2, 2.2)?;
        Ok(())
    }
}
