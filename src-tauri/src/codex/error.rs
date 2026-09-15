#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Codex is not installed for this user")]
    NotInstalled,
    #[error("Codex is already running; close it yourself or use the isolated PoC")]
    AlreadyRunning,
    #[error("Safety verification failed: {0}")]
    Safety(String),
    #[error("CSS exceeds the size limit: {actual_bytes} bytes, maximum {max_bytes} bytes")]
    StyleTooLarge {
        actual_bytes: usize,
        max_bytes: usize,
    },
    #[error("This Codex version could not be verified: {0}")]
    Incompatible(String),
    #[error("Native appearance synchronization failed: {0}")]
    NativeAppearance(String),
    #[error("Package activation could not be safely claimed; fully exit the newly opened Codex before retrying: {0}")]
    ActivationUnverified(String),
    #[error("Operation timed out: {0}")]
    Timeout(&'static str),
    #[error("CDP operation failed: {0}")]
    Protocol(String),
    #[error("Windows operation {operation} failed: {source}")]
    Native {
        operation: &'static str,
        #[source]
        source: std::io::Error,
    },
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    WebSocket(#[from] tungstenite::Error),
    #[cfg(windows)]
    #[error(transparent)]
    Windows(#[from] windows::core::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
