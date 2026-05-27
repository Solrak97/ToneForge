use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid SysEx message: {0}")]
    InvalidSysEx(String),
    #[error("checksum mismatch: expected {expected:#04x}, got {actual:#04x}")]
    ChecksumMismatch { expected: u8, actual: u8 },
    #[error("address map parse error: {0}")]
    AddressMapParse(String),
    #[error("parameter not found: {0}")]
    ParamNotFound(String),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}
