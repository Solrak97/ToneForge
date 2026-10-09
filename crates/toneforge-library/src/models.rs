use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use toneforge_core::Patch;

/// Params copied into [`ToneSummary::preview`]: enough to draw a tone's signal chain in a list
/// (amp type, each effect block's switch and live color) without loading the whole patch.
pub const PREVIEW_PARAM_IDS: &[&str] = &[
    "patch_amp_type",
    "patch_sw_booster_sw",
    "patch_sw_mod_sw",
    "patch_sw_fx_sw",
    "patch_sw_delay_sw",
    "patch_sw_reverb_sw",
    "patch_color_booster_color",
    "patch_color_mod_color",
    "patch_color_fx_color",
    "patch_color_delay_color",
    "patch_color_reverb_color",
];

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
    /// Values of [`PREVIEW_PARAM_IDS`] present in the tone's patch.
    #[serde(default)]
    pub preview: BTreeMap<String, i32>,
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

/// A bank of tones, shared as a BOSS TONE STUDIO `.tsl` file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveSetSummary {
    pub id: i64,
    pub name: String,
    pub notes: String,
    pub tone_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveSetRecord {
    pub id: i64,
    pub name: String,
    pub notes: String,
    /// In bank order.
    pub tones: Vec<ToneSummary>,
    pub created_at: String,
    pub updated_at: String,
}

/// One tone to create, e.g. a patch decoded from a `.tsl`.
#[derive(Debug, Clone)]
pub struct NewTone {
    pub name: String,
    pub patch: Patch,
    pub notes: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveToneRequest {
    pub name: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub tags: Vec<String>,
}
