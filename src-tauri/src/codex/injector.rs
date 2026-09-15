use super::{
    cdp::CdpClient,
    dom_bridge,
    error::{Error, Result},
    profiles::Profile,
};
use serde_json::Value;

pub const TEST_CSS: &str =
    "html { outline: 3px solid #ff2d55 !important; outline-offset: -3px !important; }";

pub fn probe(client: &mut CdpClient, profile: &Profile) -> Result<Value> {
    client.evaluate(&dom_bridge::expression(profile, "probe", ""))
}

pub fn apply_test(client: &mut CdpClient, profile: &Profile) -> Result<()> {
    client.evaluate(&dom_bridge::expression(profile, "apply", TEST_CSS))?;
    let evidence = client.evaluate(&dom_bridge::expression(profile, "verify", TEST_CSS))?;
    if evidence["applied"] != true || evidence["testOutline"] != true {
        soft_restore(client, profile)?;
        return Err(Error::Incompatible("test style did not take effect".into()));
    }
    Ok(())
}

pub fn apply_css(client: &mut CdpClient, profile: &Profile, css: &str) -> Result<()> {
    let rendered = theme_css(profile, css);
    super::css_safety::validate(&rendered, false)?;
    client.evaluate(&dom_bridge::expression(profile, "apply", &rendered))?;
    let appearance = client
        .evaluate(&dom_bridge::appearance_expression(profile, "sync"))
        .map_err(|_| Error::NativeAppearance("native-settings-evaluation-failed".into()))?;
    if appearance["synced"] != true {
        return Err(Error::NativeAppearance(
            appearance["reason"]
                .as_str()
                .unwrap_or("unverified-response")
                .into(),
        ));
    }
    if !verify_css(client, profile, css)? {
        return Err(Error::Incompatible(
            "style injection could not be verified".into(),
        ));
    }
    Ok(())
}

pub fn verify_css(client: &mut CdpClient, profile: &Profile, css: &str) -> Result<bool> {
    let result = client.evaluate(&dom_bridge::expression(
        profile,
        "verify",
        &theme_css(profile, css),
    ))?;
    if result["applied"] != true || result["compatible"] != true {
        return Ok(false);
    }
    let appearance = client.evaluate(&dom_bridge::appearance_expression(profile, "verify"))?;
    Ok(appearance["synced"] == true)
}

pub fn theme_css(profile: &Profile, css: &str) -> String {
    // User custom CSS remains last so explicit overrides keep working.
    format!("{}\n{css}", profile.native_css)
}

pub fn soft_restore(client: &mut CdpClient, profile: &Profile) -> Result<()> {
    let result = client.evaluate(&dom_bridge::expression(profile, "restore", ""))?;
    if result["restored"] != true {
        return Err(Error::Safety("renderer restoration failed".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codex::profiles::DEFAULT;
    use crate::codex::target_resolver::CdpTarget;
    use serde_json::json;

    fn mock_client(steps: Vec<(String, Value)>) -> (CdpClient, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            for (expression, value) in steps {
                let request: Value =
                    serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
                assert_eq!(request["method"], "Runtime.evaluate");
                assert_eq!(request["params"]["awaitPromise"], true);
                assert_eq!(request["params"]["expression"], expression);
                socket.send(tungstenite::Message::Text(json!({
                    "id": request["id"], "result": {"result": {"type": "object", "value": value}}
                }).to_string().into())).unwrap();
            }
        });
        let target = CdpTarget {
            id: "appearance-test".into(),
            kind: "page".into(),
            url: "app://-/index.html".into(),
            title: "Fixture".into(),
            websocket_url: format!("ws://127.0.0.1:{port}/devtools/page/appearance-test"),
        };
        (CdpClient::connect(&target, port).unwrap(), server)
    }

    #[test]
    fn applying_css_requires_native_sync_and_native_verification() {
        let css = "body { color-scheme: dark; }";
        let rendered = theme_css(&DEFAULT, css);
        for verified in [true, false] {
            let (mut client, server) = mock_client(vec![
                (
                    dom_bridge::expression(&DEFAULT, "apply", &rendered),
                    json!({"applied":true}),
                ),
                (
                    dom_bridge::appearance_expression(&DEFAULT, "sync"),
                    json!({"synced":true}),
                ),
                (
                    dom_bridge::expression(&DEFAULT, "verify", &rendered),
                    json!({"applied":true,"compatible":true}),
                ),
                (
                    dom_bridge::appearance_expression(&DEFAULT, "verify"),
                    json!({"synced":verified}),
                ),
            ]);
            assert_eq!(apply_css(&mut client, &DEFAULT, css).is_ok(), verified);
            server.join().unwrap();
        }
    }

    #[test]
    fn native_sync_failure_is_not_reported_as_a_successful_theme() {
        let css = "body { color-scheme: dark; }";
        let (mut client, server) = mock_client(vec![
            (
                dom_bridge::expression(&DEFAULT, "apply", &theme_css(&DEFAULT, css)),
                json!({"applied":true}),
            ),
            (
                dom_bridge::appearance_expression(&DEFAULT, "sync"),
                json!({"synced":false,"reason":"settings-rejected"}),
            ),
        ]);
        assert!(matches!(
            apply_css(&mut client, &DEFAULT, css),
            Err(Error::NativeAppearance(_))
        ));
        server.join().unwrap();
    }

    #[test]
    fn profile_palette_is_validated_and_precedes_user_styles() {
        let css = "[data-lct-part=\"root\"] { --lct-text-color: #e6e8e5; }\n.native-title { color: #abcdef !important; }";
        let rendered = theme_css(&DEFAULT, css);
        assert!(rendered.starts_with(DEFAULT.native_css));
        assert!(rendered.ends_with(css));
        assert!(crate::codex::css_safety::validate(&rendered, false).is_ok());
        assert!(!DEFAULT.native_css.contains(".syntax"));
        assert!(!DEFAULT.native_css.contains("--color-text-warning:"));
    }
}
