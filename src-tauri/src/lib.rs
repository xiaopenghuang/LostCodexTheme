//! Native compatibility layer. No UI, shell runtime, or Codex installation edits.
pub mod codex;
#[cfg(feature = "desktop")]
pub mod desktop;
