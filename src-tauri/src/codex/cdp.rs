use super::{
    error::{Error, Result},
    target_resolver::{validate_socket, CdpTarget},
};
use serde_json::{json, Value};
use std::{
    io::Read,
    net::{Ipv4Addr, SocketAddr, TcpStream},
    time::{Duration, Instant},
};
use tungstenite::{protocol::WebSocketConfig, Message, WebSocket};

const LIMIT: usize = 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(3);

pub struct Endpoint {
    port: u16,
    client: reqwest::blocking::Client,
}

impl Endpoint {
    pub fn new(port: u16) -> Result<Self> {
        if port < 1024 {
            return Err(Error::Safety("privileged debug port".into()));
        }
        Ok(Self {
            port,
            client: reqwest::blocking::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(TIMEOUT)
                .build()?,
        })
    }

    fn get(&self, route: &str) -> Result<Value> {
        let response = self
            .client
            .get(format!("http://127.0.0.1:{}{route}", self.port))
            .send()?;
        if !response.status().is_success() {
            return Err(Error::Protocol(format!(
                "discovery HTTP {}",
                response.status()
            )));
        }
        let mut bytes = Vec::new();
        response.take((LIMIT + 1) as u64).read_to_end(&mut bytes)?;
        if bytes.len() > LIMIT {
            return Err(Error::Protocol("discovery response too large".into()));
        }
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn targets(&self) -> Result<Vec<CdpTarget>> {
        Ok(serde_json::from_value(self.get("/json/list")?)?)
    }

    pub fn browser_id(&self) -> Result<String> {
        let version = self.get("/json/version")?;
        let raw = version["webSocketDebuggerUrl"]
            .as_str()
            .ok_or_else(|| Error::Protocol("missing browser identity".into()))?;
        let id = raw.rsplit('/').next().unwrap_or("");
        validate_socket(raw, self.port, "browser", id)?;
        Ok(id.into())
    }
}

pub struct CdpClient {
    socket: WebSocket<TcpStream>,
    next_id: u64,
    renderer_changed: bool,
}

impl CdpClient {
    pub fn connect(target: &CdpTarget, port: u16) -> Result<Self> {
        let url = validate_socket(&target.websocket_url, port, "page", &target.id)?;
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let stream = TcpStream::connect_timeout(&address, TIMEOUT)?;
        stream.set_read_timeout(Some(TIMEOUT))?;
        stream.set_write_timeout(Some(TIMEOUT))?;
        let config = WebSocketConfig::default()
            .max_message_size(Some(LIMIT))
            .max_frame_size(Some(LIMIT));
        let (socket, _) =
            tungstenite::client::client_with_config(url.as_str(), stream, Some(config))
                .map_err(|e| Error::Protocol(format!("WebSocket handshake failed: {e}")))?;
        Ok(Self {
            socket,
            next_id: 0,
            renderer_changed: false,
        })
    }

    pub fn evaluate(&mut self, expression: &str) -> Result<Value> {
        let result = self.command(
            "Runtime.evaluate",
            json!({
                "expression": expression, "returnByValue": true, "awaitPromise": true,
                "timeout": 2000, "userGesture": false,
            }),
        )?;
        result["result"]
            .get("value")
            .cloned()
            .ok_or_else(|| Error::Protocol("evaluation returned no value".into()))
    }

    pub fn enable_events(&mut self) -> Result<()> {
        self.command("Page.enable", json!({}))?;
        Ok(())
    }

    fn notice_event(&mut self, event: &Value) {
        let method = event["method"].as_str().unwrap_or("");
        if method == "Page.loadEventFired"
            || (method == "Page.frameNavigated"
                && event["params"]["frame"].get("parentId").is_none())
        {
            self.renderer_changed = true;
        }
    }

    /// Drain already-arrived events without blocking product commands or subscribing to console data.
    pub fn poll_renderer_events(&mut self) -> Result<bool> {
        self.socket.get_mut().set_nonblocking(true)?;
        let result: Result<bool> = (|| {
            for _ in 0..32 {
                match self.socket.read() {
                    Ok(Message::Text(text)) => {
                        self.notice_event(&serde_json::from_str::<Value>(&text)?);
                    }
                    Ok(Message::Close(_)) => {
                        return Err(Error::Protocol("renderer closed connection".into()))
                    }
                    Ok(_) => {}
                    Err(tungstenite::Error::Io(error))
                        if error.kind() == std::io::ErrorKind::WouldBlock =>
                    {
                        break
                    }
                    Err(error) => return Err(error.into()),
                }
            }
            Ok(std::mem::take(&mut self.renderer_changed))
        })();
        self.socket.get_mut().set_nonblocking(false)?;
        result
    }

    fn command(&mut self, method: &'static str, parameters: Value) -> Result<Value> {
        self.next_id += 1;
        let id = self.next_id;
        self.socket.send(Message::Text(
            json!({ "id": id, "method": method, "params": parameters })
                .to_string()
                .into(),
        ))?;
        let deadline = Instant::now() + TIMEOUT;
        loop {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .filter(|v| !v.is_zero())
                .ok_or(Error::Timeout("CDP command"))?;
            self.socket.get_mut().set_read_timeout(Some(remaining))?;
            match self.socket.read()? {
                Message::Text(text) => {
                    let response: Value = serde_json::from_str(&text)?;
                    if response["id"].as_u64() != Some(id) {
                        self.notice_event(&response);
                        continue;
                    }
                    if response.get("error").is_some()
                        || response["result"].get("exceptionDetails").is_some()
                    {
                        // Do not include arbitrary renderer text or private page data in diagnostics.
                        return Err(Error::Protocol("renderer rejected evaluation".into()));
                    }
                    return response
                        .get("result")
                        .cloned()
                        .ok_or_else(|| Error::Protocol("command returned no result".into()));
                }
                Message::Close(_) => {
                    return Err(Error::Protocol("renderer closed connection".into()))
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, net::TcpListener, thread};

    fn http_response(status: &str, body: &str) -> (u16, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let task = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(TIMEOUT)).unwrap();
            let mut request = [0; 4096];
            let _ = socket.read(&mut request);
            let _ = socket.write_all(response.as_bytes());
        });
        (port, task)
    }

    #[test]
    fn discovery_rejects_http_redirects() {
        let (port, task) = http_response("302 Found\r\nLocation: http://example.invalid/", "[]");
        assert!(matches!(
            Endpoint::new(port).unwrap().targets(),
            Err(Error::Protocol(_))
        ));
        task.join().unwrap();
    }

    #[test]
    fn discovery_limits_response_size() {
        let (port, task) = http_response("200 OK", &" ".repeat(LIMIT + 1));
        assert!(matches!(
            Endpoint::new(port).unwrap().targets(),
            Err(Error::Protocol(_))
        ));
        task.join().unwrap();
    }

    #[test]
    fn discovery_parses_target_list() {
        let (port, task) = http_response(
            "200 OK",
            r#"[{"id":"a","type":"page","url":"app://-/index.html"}]"#,
        );
        assert_eq!(Endpoint::new(port).unwrap().targets().unwrap()[0].id, "a");
        task.join().unwrap();
    }

    fn websocket_response(exception: bool) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(TIMEOUT)).unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            let request: Value =
                serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
            assert_eq!(request["method"], "Runtime.evaluate");
            assert_eq!(request["params"]["returnByValue"], true);
            socket
                .send(Message::Text(
                    json!({"method":"Runtime.executionContextCreated", "params":{}})
                        .to_string()
                        .into(),
                ))
                .unwrap();
            let result = if exception {
                json!({"exceptionDetails":{"text":"private page text"}})
            } else {
                json!({"result":{"type":"number","value":42}})
            };
            socket
                .send(Message::Text(
                    json!({"id":request["id"],"result":result})
                        .to_string()
                        .into(),
                ))
                .unwrap();
        });
        let target = CdpTarget {
            id: "a".into(),
            kind: "page".into(),
            url: "app://-/index.html".into(),
            title: "Codex".into(),
            websocket_url: format!("ws://127.0.0.1:{port}/devtools/page/a"),
        };
        let result = CdpClient::connect(&target, port)
            .unwrap()
            .evaluate("21 * 2");
        if exception {
            assert!(!result
                .unwrap_err()
                .to_string()
                .contains("private page text"));
        } else {
            assert_eq!(result.unwrap(), 42);
        }
        server.join().unwrap();
    }

    #[test]
    fn evaluation_ignores_events_and_matches_response_ids() {
        websocket_response(false);
    }

    #[test]
    fn evaluation_rejects_exceptions_without_logging_page_data() {
        websocket_response(true);
    }
}
