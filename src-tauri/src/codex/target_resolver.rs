use super::{
    error::{Error, Result},
    profiles::Profile,
};
use serde::Deserialize;
use url::Url;

#[derive(Clone, Debug, Deserialize)]
pub struct CdpTarget {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(rename = "webSocketDebuggerUrl", default)]
    pub websocket_url: String,
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}

pub fn validate_socket(raw: &str, port: u16, kind: &str, id: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| Error::Safety("invalid debugger URL".into()))?;
    // Require the canonical spelling as well as the parsed host. No shorthand IPs.
    let prefix = format!("ws://127.0.0.1:{port}/");
    if !valid_id(id)
        || !raw.starts_with(&prefix)
        || url.scheme() != "ws"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(port)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != format!("/devtools/{kind}/{id}")
        || raw != url.as_str()
    {
        return Err(Error::Safety(
            "debugger URL is outside the owned loopback endpoint".into(),
        ));
    }
    Ok(url)
}

pub fn is_main_url(raw: &str, profile: &Profile) -> bool {
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "app"
        || !profile.hosts.contains(&url.host_str().unwrap_or(""))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !matches!(url.path(), "/" | "/index.html")
    {
        return false;
    }
    let decoded_query = url
        .query_pairs()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");
    let surface = format!(
        "{} {} {}",
        url.path(),
        decoded_query,
        url.fragment().unwrap_or("")
    )
    .to_lowercase();
    !profile.excluded.iter().any(|word| surface.contains(word))
}

pub fn candidates(targets: &[CdpTarget], profile: &Profile, port: u16) -> Vec<CdpTarget> {
    let mut result: Vec<_> = targets
        .iter()
        .filter(|target| {
            target.kind == "page"
                && is_main_url(&target.url, profile)
                && validate_socket(&target.websocket_url, port, "page", &target.id).is_ok()
        })
        .cloned()
        .collect();
    // A title is only a tie-breaker, never evidence of identity.
    result.sort_by_key(|t| (!t.title.eq_ignore_ascii_case("Codex"), t.id.clone()));
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codex::profiles::DEFAULT;

    #[test]
    fn reject_remote_and_confused_sockets() {
        for raw in [
            "ws://localhost:9335/devtools/page/a",
            "ws://127.1:9335/devtools/page/a",
            "ws://127.0.0.1:9336/devtools/page/a",
            "ws://evil.test:9335/devtools/page/a",
            "ws://user@127.0.0.1:9335/devtools/page/a",
            "ws://127.0.0.1:9335/devtools/browser/a",
            "ws://127.0.0.1:9335/devtools/page/a?x",
            "ws://127.0.0.1:9335/devtools/page/a#x",
            "ws://127.0.0.1:9335/devtools/page/b",
            "wss://127.0.0.1:9335/devtools/page/a",
        ] {
            assert!(validate_socket(raw, 9335, "page", "a").is_err(), "{raw}");
        }
        assert!(validate_socket("ws://127.0.0.1:9335/devtools/page/a", 9335, "page", "a").is_ok());
    }

    #[test]
    fn exclude_auxiliary_targets_including_encoded_routes() {
        for raw in [
            "https://chatgpt.com/",
            "app://evil/index.html",
            "app://-/avatar-overlay-composition-surface.html",
            "app://-/index.html?initialRoute=%2Favatar-overlay",
            "app://-/index.html?initialRoute=%2F%61vatar-overlay",
            "app://-/index.html#secondary",
            "devtools://devtools/index.html",
            "app://-/browser.html",
        ] {
            assert!(!is_main_url(raw, &DEFAULT), "{raw}");
        }
        assert!(is_main_url("app://-/index.html", &DEFAULT));
        assert!(is_main_url("app://codex/", &DEFAULT));
    }

    #[test]
    fn does_not_select_first_target() {
        let target = |id: &str, url: &str| CdpTarget {
            id: id.into(),
            kind: "page".into(),
            url: url.into(),
            title: "Codex".into(),
            websocket_url: format!("ws://127.0.0.1:9335/devtools/page/{id}"),
        };
        let found = candidates(
            &[
                target("overlay", "app://-/index.html?initialRoute=/avatar-overlay"),
                target("main", "app://-/index.html"),
            ],
            &DEFAULT,
            9335,
        );
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "main");
    }
}
