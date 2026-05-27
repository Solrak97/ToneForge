use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ParamValue {
    U8 { value: u8 },
    I8 { value: i8 },
    U16 { value: u16 },
    Text { value: String },
}

impl ParamValue {
    pub fn as_u8(&self) -> Option<u8> {
        match self {
            Self::U8 { value } => Some(*value),
            Self::I8 { value } => u8::try_from(*value).ok(),
            Self::U16 { value } => u8::try_from(*value).ok(),
            Self::Text { .. } => None,
        }
    }

    pub fn from_u8(value: u8) -> Self {
        Self::U8 { value }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PatchMeta {
    pub device_family: String,
    pub device_model: String,
    pub channel: Option<u8>,
    pub patch_slot: Option<u8>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Patch {
    pub meta: PatchMeta,
    pub params: BTreeMap<String, ParamValue>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub raw_blocks: BTreeMap<String, Vec<u8>>,
}

impl Patch {
    pub fn new(device_family: &str, device_model: &str) -> Self {
        Self {
            meta: PatchMeta {
                device_family: device_family.to_string(),
                device_model: device_model.to_string(),
                channel: None,
                patch_slot: None,
                name: None,
            },
            params: BTreeMap::new(),
            raw_blocks: BTreeMap::new(),
        }
    }

    pub fn set_param(&mut self, id: &str, value: ParamValue) {
        self.params.insert(id.to_string(), value);
    }

    pub fn get_param_u8(&self, id: &str) -> Option<u8> {
        self.params.get(id).and_then(|v| v.as_u8())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PresetFile {
    pub format_version: u32,
    pub exported_at: String,
    pub patch: Patch,
}

impl PresetFile {
    pub fn current_format_version() -> u32 {
        1
    }

    pub fn from_patch(patch: Patch) -> Self {
        Self {
            format_version: Self::current_format_version(),
            exported_at: chrono_now(),
            patch,
        }
    }
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}
