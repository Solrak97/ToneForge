use crate::CoreError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParamKind {
    U8,
    I8,
    U16,
    Enum,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParamEncoding {
    Integer1x7,
    Integer2x4,
    Integer2x7,
    Integer4x4,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParamDef {
    pub id: String,
    pub label: String,
    #[serde(deserialize_with = "deserialize_address")]
    pub address: [u8; 4],
    pub kind: ParamKind,
    #[serde(default = "default_param_encoding")]
    pub encoding: ParamEncoding,
    #[serde(default)]
    pub min: Option<i32>,
    #[serde(default)]
    pub max: Option<i32>,
    #[serde(default)]
    pub default: Option<i32>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub options: Vec<String>,
    /// When true, ToneForge reads/writes this parameter over SysEx today.
    #[serde(default)]
    pub wired: bool,
    /// Original Boss Tone Studio parameter id (PRMID_*).
    #[serde(default)]
    pub bts_name: Option<String>,
    /// Memory region: live_panel, patch_memory, etc.
    #[serde(default)]
    pub address_space: Option<String>,
    /// Display offset used by BTS UIs (display value = raw + offset).
    #[serde(default)]
    pub offset: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AddressMap {
    pub device_family: String,
    pub device_model: String,
    #[serde(deserialize_with = "deserialize_device_id")]
    pub device_id: Vec<u8>,
    #[serde(default)]
    pub live_panel_base: Option<String>,
    pub patch_query: PatchQueryDef,
    pub params: Vec<ParamDef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PatchQueryDef {
    #[serde(deserialize_with = "deserialize_address")]
    pub current_channel_address: [u8; 4],
    #[serde(default = "default_patch_select_address", deserialize_with = "deserialize_address")]
    pub patch_select_address: [u8; 4],
    #[serde(default = "default_channel_count")]
    pub channel_count: u8,
    #[serde(deserialize_with = "deserialize_address")]
    pub patch_data_address: [u8; 4],
    pub patch_data_length: u32,
    #[serde(deserialize_with = "deserialize_address")]
    pub editor_mode_address: [u8; 4],
    pub editor_mode_value: u8,
}

impl AddressMap {
    pub fn param_by_id(&self, id: &str) -> Option<&ParamDef> {
        self.params.iter().find(|p| p.id == id)
    }

    pub fn params_by_group(&self, group: &str) -> Vec<&ParamDef> {
        self.params
            .iter()
            .filter(|p| p.group.as_deref() == Some(group))
            .collect()
    }

    pub fn wired_params(&self) -> Vec<&ParamDef> {
        self.params.iter().filter(|p| p.wired).collect()
    }

    pub fn from_json_str(raw: &str) -> Result<Self, CoreError> {
        serde_json::from_str(raw).map_err(CoreError::from)
    }

    pub fn from_json_file(path: &std::path::Path) -> Result<Self, CoreError> {
        let raw = std::fs::read_to_string(path)?;
        Self::from_json_str(&raw)
    }

    /// Parses a simplified export produced from Boss Tone Studio `address_map.js`.
    /// The export is a JSON array of parameter objects with hex address strings.
    pub fn from_bts_export(raw: &str) -> Result<Self, CoreError> {
        #[derive(Deserialize)]
        struct ExportRoot {
            device_family: String,
            device_model: String,
            device_id: String,
            patch_query: ExportPatchQuery,
            parameters: Vec<ExportParam>,
        }

        #[derive(Deserialize)]
        struct ExportPatchQuery {
            current_channel_address: String,
            #[serde(default)]
            patch_select_address: Option<String>,
            #[serde(default)]
            channel_count: Option<u8>,
            patch_data_address: String,
            patch_data_length: u32,
            editor_mode_address: String,
            editor_mode_value: u8,
        }

        #[derive(Deserialize)]
        struct ExportParam {
            id: String,
            label: String,
            address: String,
            kind: ParamKind,
            #[serde(default = "default_param_encoding")]
            encoding: ParamEncoding,
            #[serde(default)]
            min: Option<i32>,
            #[serde(default)]
            max: Option<i32>,
            #[serde(default)]
            default: Option<i32>,
            #[serde(default)]
            group: Option<String>,
            #[serde(default)]
            options: Vec<String>,
            #[serde(default)]
            offset: i32,
        }

        let export: ExportRoot = serde_json::from_str(raw)?;
        Ok(Self {
            device_family: export.device_family,
            device_model: export.device_model,
            device_id: parse_hex_bytes(&export.device_id)?,
            live_panel_base: None,
            patch_query: PatchQueryDef {
                current_channel_address: parse_address(&export.patch_query.current_channel_address)?,
                patch_select_address: export
                    .patch_query
                    .patch_select_address
                    .as_deref()
                    .map(parse_address)
                    .transpose()?
                    .unwrap_or_else(default_patch_select_address),
                channel_count: export.patch_query.channel_count.unwrap_or_else(default_channel_count),
                patch_data_address: parse_address(&export.patch_query.patch_data_address)?,
                patch_data_length: export.patch_query.patch_data_length,
                editor_mode_address: parse_address(&export.patch_query.editor_mode_address)?,
                editor_mode_value: export.patch_query.editor_mode_value,
            },
            params: export
                .parameters
                .into_iter()
                .map(|p| {
                    Ok(ParamDef {
                        id: p.id,
                        label: p.label,
                        address: parse_address(&p.address)?,
                        kind: p.kind,
                        encoding: p.encoding,
                        min: p.min,
                        max: p.max,
                        default: p.default,
                        group: p.group,
                        options: p.options,
                        wired: true,
                        bts_name: None,
                        address_space: None,
                        offset: p.offset,
                    })
                })
                .collect::<Result<Vec<_>, CoreError>>()?,
        })
    }
}

fn default_patch_select_address() -> [u8; 4] {
    [0x7F, 0x00, 0x01, 0x00]
}

fn default_param_encoding() -> ParamEncoding {
    ParamEncoding::Integer1x7
}

fn default_channel_count() -> u8 {
    9
}

fn parse_hex_bytes(input: &str) -> Result<Vec<u8>, CoreError> {
    let cleaned: String = input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("")
        .replace("0x", "");
    if !cleaned.len().is_multiple_of(2) {
        return Err(CoreError::AddressMapParse(format!(
            "invalid byte string `{input}`"
        )));
    }
    (0..cleaned.len() / 2)
        .map(|i| {
            u8::from_str_radix(&cleaned[i * 2..i * 2 + 2], 16).map_err(|_| {
                CoreError::AddressMapParse(format!("invalid hex byte `{input}`"))
            })
        })
        .collect()
}

fn parse_address(input: &str) -> Result<[u8; 4], CoreError> {
    let cleaned = input.trim().trim_start_matches("0x");
    if cleaned.len() != 8 {
        return Err(CoreError::AddressMapParse(format!(
            "expected 8 hex chars, got `{input}`"
        )));
    }
    let bytes = (0..4)
        .map(|i| {
            u8::from_str_radix(&cleaned[i * 2..i * 2 + 2], 16).map_err(|_| {
                CoreError::AddressMapParse(format!("invalid hex in address `{input}`"))
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn deserialize_device_id<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum DeviceIdInput {
        Bytes(Vec<u8>),
        Hex(String),
    }

    match DeviceIdInput::deserialize(deserializer)? {
        DeviceIdInput::Bytes(bytes) => Ok(bytes),
        DeviceIdInput::Hex(raw) => parse_hex_bytes(&raw).map_err(D::Error::custom),
    }
}

fn deserialize_address<'de, D>(deserializer: D) -> Result<[u8; 4], D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum AddressInput {
        Array([u8; 4]),
        Hex(String),
    }

    match AddressInput::deserialize(deserializer)? {
        AddressInput::Array(bytes) => Ok(bytes),
        AddressInput::Hex(raw) => parse_address(&raw).map_err(D::Error::custom),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_address_hex() {
        assert_eq!(
            parse_address("60000034").unwrap(),
            [0x60, 0x00, 0x00, 0x34]
        );
    }

    #[test]
    fn load_embedded_gen3_map() {
        let map = AddressMap::from_json_str(include_str!("../data/gen3_address_map.json"))
            .expect("embedded map");
        assert_eq!(map.device_model, "katana-gen3");
        assert!(map.param_by_id("patch_amp_gain").is_some());
    }

    #[test]
    fn load_bts_export_format() {
        let raw = include_str!("../tests/fixtures/gen3_bts_export.json");
        let map = AddressMap::from_bts_export(raw).expect("bts export");
        assert_eq!(map.params.len(), 1);
        assert_eq!(map.patch_query.patch_data_length, 128);
    }
}
