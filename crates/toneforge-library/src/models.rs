use serde::{Deserialize, Serialize};
use toneforge_core::Patch;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToneSummary {
    pub id: i64,
    pub name: String,
    pub device_model: String,
    pub channel: Option<u8>,
    pub tags: Vec<String>,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToneRecord {
    pub id: i64,
    pub name: String,
    pub device_family: String,
    pub device_model: String,
    pub channel: Option<u8>,
    pub patch: Patch,
    pub tags: Vec<String>,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveToneRequest {
    pub name: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub tags: Vec<String>,
}
