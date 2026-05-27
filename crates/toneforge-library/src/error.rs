use thiserror::Error;

#[derive(Debug, Error)]
pub enum LibraryError {
    #[error("tone not found: {0}")]
    NotFound(i64),
    #[error("invalid tone name")]
    InvalidName,
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}
