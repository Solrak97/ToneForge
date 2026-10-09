//! BOSS TONE STUDIO liveset files (`.tsl`) for the Katana Gen 3.
//!
//! A liveset is JSON: `{ name, formatRev, device, data: [[ { memo, paramSet } ]] }`.
//! Each `paramSet` maps a patch block (`PATCH%AMP`, `PATCH%FX_DETAIL(1)`, …) to the
//! block's memory as two-digit hex strings. The block layout and factory defaults
//! are exported from BOSS TONE STUDIO by `tools/tsl/tsl.mjs layout`.
//!
//! Decoded patches keep every block in [`Patch::raw_blocks`], so settings ToneForge
//! doesn't model (pedal and footswitch assigns, …) survive a re-export unchanged.

use crate::address_map::{AddressMap, ParamDef, ParamEncoding, ParamKind};
use crate::preset::{ParamValue, Patch};
use crate::CoreError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

pub const GEN3_DEVICE: &str = "KATANA Gen3";
pub const FORMAT_REV: &str = "0000";
pub const FILE_EXTENSION: &str = "tsl";

const NAME_BLOCK: &str = "PATCH%COM";
const NAME_LENGTH: usize = 16;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveSetFile {
    pub name: String,
    #[serde(rename = "formatRev")]
    pub format_rev: String,
    pub device: String,
    pub data: Vec<Vec<TslPatch>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TslPatch {
    /// BTS `PatchInfo`: `{ memo, isToneCentralPatch }`.
    #[serde(default)]
    pub memo: Value,
    #[serde(rename = "paramSet")]
    pub param_set: BTreeMap<String, Vec<String>>,
}

impl LiveSetFile {
    pub fn new(name: &str, patches: Vec<TslPatch>) -> Self {
        Self {
            name: name.to_string(),
            format_rev: FORMAT_REV.to_string(),
            device: GEN3_DEVICE.to_string(),
            data: vec![patches],
        }
    }

    pub fn parse(raw: &str) -> Result<Self, CoreError> {
        let file: Self = serde_json::from_str(raw)
            .map_err(|e| CoreError::Tsl(format!("not a BOSS TONE STUDIO liveset: {e}")))?;
        if file.device != GEN3_DEVICE {
            return Err(CoreError::Tsl(format!(
                "liveset is for `{}`; ToneForge supports {GEN3_DEVICE} livesets",
                file.device
            )));
        }
        Ok(file)
    }

    pub fn to_json(&self) -> Result<String, CoreError> {
        Ok(serde_json::to_string(self)?)
    }

    pub fn patches(&self) -> &[TslPatch] {
        self.data.first().map(Vec::as_slice).unwrap_or_default()
    }
}

impl TslPatch {
    pub fn memo_text(&self) -> String {
        match &self.memo {
            Value::Object(obj) => obj.get("memo").and_then(Value::as_str).unwrap_or_default().to_string(),
            Value::String(text) => text.clone(),
            _ => String::new(),
        }
    }

    /// Decodes the patch name and every parameter in `map`; all blocks are kept raw.
    pub fn to_patch(&self, map: &AddressMap) -> Result<Patch, CoreError> {
        let layout = gen3_layout();
        let mut blocks = BTreeMap::new();
        for (name, defaults) in &layout.blocks {
            let bytes = match self.param_set.get(name) {
                Some(hex) => pad_with_defaults(parse_hex_block(name, hex)?, defaults),
                None => defaults.clone(),
            };
            blocks.insert(name.clone(), bytes);
        }
        for (name, hex) in &self.param_set {
            if !blocks.contains_key(name) {
                blocks.insert(name.clone(), parse_hex_block(name, hex)?);
            }
        }

        let mut patch = Patch::new(&map.device_family, &map.device_model);
        patch.meta.name = Some(decode_name(&blocks[NAME_BLOCK]));
        for def in &map.params {
            let Some((block, index)) = layout.params.get(&def.id) else {
                continue;
            };
            let Some(raw) = read_raw(&blocks[block], *index, def.encoding) else {
                continue;
            };
            if let Some(value) = to_param_value(def, raw - def.offset) {
                patch.set_param(&def.id, value);
            }
        }
        patch.raw_blocks = blocks;
        Ok(patch)
    }

    /// Encodes `patch` on top of its raw blocks (or the factory defaults).
    pub fn from_patch(patch: &Patch, map: &AddressMap, notes: &str) -> Result<Self, CoreError> {
        let layout = gen3_layout();
        let mut blocks = patch.raw_blocks.clone();
        for (name, defaults) in &layout.blocks {
            let bytes = blocks.remove(name).unwrap_or_default();
            blocks.insert(name.clone(), pad_with_defaults(bytes, defaults));
        }

        let defs: HashMap<&str, &ParamDef> = map.params.iter().map(|p| (p.id.as_str(), p)).collect();
        for (id, value) in &patch.params {
            let (Some(def), Some((block, index)), Some(value)) =
                (defs.get(id.as_str()), layout.params.get(id), value.as_i32())
            else {
                continue;
            };
            let bytes = blocks.get_mut(block).expect("layout block present");
            write_raw(bytes, *index, def.encoding, value + def.offset)
                .map_err(|e| CoreError::Tsl(format!("{id}={value}: {e}")))?;
        }

        let name = patch.meta.name.as_deref().unwrap_or_default();
        blocks
            .get_mut(NAME_BLOCK)
            .expect("name block present")
            .splice(0..NAME_LENGTH, encode_name(name));

        Ok(Self {
            memo: json!({ "memo": notes, "isToneCentralPatch": false }),
            param_set: blocks
                .into_iter()
                .map(|(name, bytes)| (name, bytes.iter().map(|b| format!("{b:02X}")).collect()))
                .collect(),
        })
    }
}

struct TslLayout {
    /// Block name -> factory default bytes, in BTS order.
    blocks: Vec<(String, Vec<u8>)>,
    /// ToneForge param id -> (block name, byte index within the block).
    params: HashMap<String, (String, usize)>,
}

fn gen3_layout() -> &'static TslLayout {
    static LAYOUT: OnceLock<TslLayout> = OnceLock::new();
    LAYOUT.get_or_init(|| {
        #[derive(Deserialize)]
        struct LayoutFile {
            blocks: Vec<LayoutBlock>,
            params: HashMap<String, (String, usize)>,
        }
        #[derive(Deserialize)]
        struct LayoutBlock {
            name: String,
            defaults: String,
        }

        let file: LayoutFile = serde_json::from_str(include_str!("../data/gen3_tsl_layout.json"))
            .expect("embedded gen3 tsl layout");
        TslLayout {
            blocks: file
                .blocks
                .into_iter()
                .map(|b| {
                    let bytes = (0..b.defaults.len() / 2)
                        .map(|i| u8::from_str_radix(&b.defaults[i * 2..i * 2 + 2], 16).expect("hex default"))
                        .collect();
                    (b.name, bytes)
                })
                .collect(),
            params: file.params,
        }
    })
}

fn parse_hex_block(name: &str, hex: &[String]) -> Result<Vec<u8>, CoreError> {
    hex.iter()
        .map(|byte| {
            u8::from_str_radix(byte.trim(), 16)
                .map_err(|_| CoreError::Tsl(format!("{name}: invalid byte `{byte}`")))
        })
        .collect()
}

/// Like BTS `LibrarianModel.read`: short blocks from older files take the default tail.
fn pad_with_defaults(mut bytes: Vec<u8>, defaults: &[u8]) -> Vec<u8> {
    if bytes.len() < defaults.len() {
        bytes.extend_from_slice(&defaults[bytes.len()..]);
    }
    bytes
}

fn read_raw(bytes: &[u8], index: usize, encoding: ParamEncoding) -> Option<i32> {
    let b = |i: usize| bytes.get(index + i).map(|v| i32::from(*v));
    Some(match encoding {
        ParamEncoding::Integer1x7 => b(0)?,
        ParamEncoding::Integer2x4 => (b(0)? << 4) | b(1)?,
        ParamEncoding::Integer2x7 => (b(0)? << 7) | b(1)?,
        ParamEncoding::Integer4x4 => (b(0)? << 12) | (b(1)? << 8) | (b(2)? << 4) | b(3)?,
    })
}

fn write_raw(bytes: &mut [u8], index: usize, encoding: ParamEncoding, raw: i32) -> Result<(), String> {
    let encoded: Vec<i32> = match encoding {
        ParamEncoding::Integer1x7 if (0..=0x7f).contains(&raw) => vec![raw],
        ParamEncoding::Integer2x4 if (0..=0xff).contains(&raw) => vec![raw >> 4, raw & 0x0f],
        ParamEncoding::Integer2x7 if (0..=0x3fff).contains(&raw) => vec![raw >> 7, raw & 0x7f],
        ParamEncoding::Integer4x4 if (0..=0xffff).contains(&raw) => {
            vec![raw >> 12, (raw >> 8) & 0x0f, (raw >> 4) & 0x0f, raw & 0x0f]
        }
        _ => return Err(format!("raw value {raw} does not fit {encoding:?}")),
    };
    let slot = bytes
        .get_mut(index..index + encoded.len())
        .ok_or_else(|| format!("byte {index} is outside the block"))?;
    for (dst, src) in slot.iter_mut().zip(encoded) {
        *dst = src as u8;
    }
    Ok(())
}

fn to_param_value(def: &ParamDef, value: i32) -> Option<ParamValue> {
    match def.kind {
        ParamKind::Text => None,
        ParamKind::U16 => u16::try_from(value).ok().map(|value| ParamValue::U16 { value }),
        ParamKind::I8 => i8::try_from(value).ok().map(|value| ParamValue::I8 { value }),
        ParamKind::U8 | ParamKind::Enum => u8::try_from(value)
            .map(|value| ParamValue::U8 { value })
            .or_else(|_| i8::try_from(value).map(|value| ParamValue::I8 { value }))
            .ok(),
    }
}

fn decode_name(bytes: &[u8]) -> String {
    bytes
        .iter()
        .take(NAME_LENGTH)
        .map(|b| if (0x20..=0x7e).contains(b) { *b as char } else { ' ' })
        .collect::<String>()
        .trim_end()
        .to_string()
}

fn encode_name(name: &str) -> Vec<u8> {
    let mut out: Vec<u8> = name
        .chars()
        .take(NAME_LENGTH)
        .map(|c| if (' '..='}').contains(&c) { c as u8 } else { b' ' })
        .collect();
    out.resize(NAME_LENGTH, b' ');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gen3_map() -> AddressMap {
        AddressMap::from_json_str(include_str!("../data/gen3_address_map.json")).expect("map")
    }

    fn blues() -> LiveSetFile {
        LiveSetFile::parse(include_str!("../../../examples/livesets/blues.tsl")).expect("blues liveset")
    }

    #[test]
    fn layout_covers_every_mapped_param() {
        let map = gen3_map();
        let layout = gen3_layout();
        assert_eq!(layout.blocks.len(), 80);
        for def in &map.params {
            assert!(layout.params.contains_key(&def.id), "{} missing from layout", def.id);
        }
    }

    #[test]
    fn decodes_example_liveset() {
        let map = gen3_map();
        let file = blues();
        assert_eq!(file.name, "ToneForge Blues");
        assert_eq!(file.patches().len(), 5);

        let texas = file.patches()[1].to_patch(&map).expect("decode");
        assert_eq!(texas.meta.name.as_deref(), Some("Texas Crunch"));
        assert_eq!(texas.params["patch_amp_type"].as_i32(), Some(3));
        assert_eq!(texas.params["patch_amp_gain"].as_i32(), Some(45));
        assert_eq!(texas.params["patch_booster_type_slot1"].as_i32(), Some(11));
        assert_eq!(texas.params["patch_booster_tone_slot1"].as_i32(), Some(4));
        assert!(file.patches()[1].memo_text().starts_with("SRV-style"));

        let lead = file.patches()[3].to_patch(&map).expect("decode");
        assert_eq!(lead.params["patch_delay_time_slot1"].as_i32(), Some(380));
    }

    #[test]
    fn reexport_is_byte_exact() {
        let map = gen3_map();
        for original in blues().patches() {
            let patch = original.to_patch(&map).expect("decode");
            let again = TslPatch::from_patch(&patch, &map, &original.memo_text()).expect("encode");
            assert_eq!(again.param_set, original.param_set);
        }
    }

    #[test]
    fn encodes_patch_without_raw_blocks() {
        let map = gen3_map();
        let mut patch = Patch::new("boss-katana", "katana-gen3");
        patch.meta.name = Some("Fresh".into());
        patch.set_param("patch_amp_gain", ParamValue::U8 { value: 42 });
        patch.set_param("patch_booster_tone_slot1", ParamValue::I8 { value: -4 });
        patch.set_param("patch_delay_time_slot1", ParamValue::U16 { value: 480 });

        let tsl = TslPatch::from_patch(&patch, &map, "note").expect("encode");
        assert_eq!(tsl.param_set.len(), 80);
        assert_eq!(tsl.memo_text(), "note");

        let back = tsl.to_patch(&map).expect("decode");
        assert_eq!(back.meta.name.as_deref(), Some("Fresh"));
        assert_eq!(back.params["patch_amp_gain"].as_i32(), Some(42));
        assert_eq!(back.params["patch_booster_tone_slot1"].as_i32(), Some(-4));
        assert_eq!(back.params["patch_delay_time_slot1"].as_i32(), Some(480));
    }

    #[test]
    fn rejects_other_devices() {
        let raw = r#"{"name":"x","formatRev":"0000","device":"KATANA MkII","data":[[]]}"#;
        assert!(LiveSetFile::parse(raw).is_err());
    }
}
