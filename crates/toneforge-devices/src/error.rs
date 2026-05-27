use thiserror::Error;
use toneforge_core::CoreError;

#[derive(Debug, Error)]
pub enum DeviceError {
    #[error("midi error: {0}")]
    Midi(String),
    #[error("device not connected")]
    NotConnected,
    #[error("device not found: {0}")]
    NotFound(String),
    #[error("operation timed out")]
    Timeout,
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error(transparent)]
    Core(#[from] CoreError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}
