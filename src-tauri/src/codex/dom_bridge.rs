use super::profiles::Profile;
use serde_json::json;

pub const SOURCE: &str = include_str!("bridge.js");
pub const APPEARANCE_SOURCE: &str = include_str!("native-appearance.js");

pub fn appearance_expression(profile: &Profile, action: &str) -> String {
    format!(
        "{}({})",
        APPEARANCE_SOURCE,
        json!({"profile": profile, "action": action})
    )
}

pub fn expression(profile: &Profile, action: &str, css: &str) -> String {
    format!(
        "{}({})",
        SOURCE,
        json!({"profile": profile, "action": action, "css": css})
    )
}
