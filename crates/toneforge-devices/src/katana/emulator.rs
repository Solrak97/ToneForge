//! In-memory Katana Gen 3 that answers Roland RQ1/DT1 SysEx like the real amp.
//!
//! Lets ToneForge be developed and tested without hardware: the driver's address
//! encoding, channel switching, and patch reads all run unchanged against it.

use crate::error::DeviceError;
use crate::katana::gen3::encode_param_payload;
use crate::transport::hex_sysex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use toneforge_core::address_map::AddressMap;
use toneforge_core::sysex::{RolandSysExCodec, SysExOp};
use tracing::debug;

pub const EMULATOR_PORT_NAME: &str = "ToneForge Katana Emulator";
pub const EMULATOR_DEVICE_ID: &str = "katana-gen3:emulator";

/// Katana-50 Gen 3 model code (PANEL + CH1 + CH2).
const EMULATED_MODEL_CODE: u8 = 0x05;
const EMULATED_CHANNEL_COUNT: u8 = 3;

static EMULATOR_ALLOWED: AtomicBool = AtomicBool::new(false);

/// Follows [`set_emulator_enabled`] (the app's experimental mode); `TONEFORGE_EMULATOR=1|0` overrides.
pub fn emulator_enabled() -> bool {
    match std::env::var("TONEFORGE_EMULATOR") {
        Ok(v) => matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"),
        Err(_) => EMULATOR_ALLOWED.load(Ordering::Relaxed),
    }
}

pub fn set_emulator_enabled(enabled: bool) {
    EMULATOR_ALLOWED.store(enabled, Ordering::Relaxed);
}

type Memory = HashMap<u32, u8>;

pub struct EmulatedKatana {
    device_id: Vec<u8>,
    current_channel_address: u32,
    patch_select_address: u32,
    editor_mode_address: u32,
    channel: u8,
    live: Memory,
    stored: HashMap<u8, Memory>,
}

impl EmulatedKatana {
    pub fn new(map: &AddressMap) -> Self {
        let defaults = default_memory(map);

        let mut stored = HashMap::new();
        stored.insert(0, defaults.clone());
        stored.insert(
            1,
            with_overrides(map, &defaults, &[("patch_amp_type", 3), ("patch_amp_gain", 60)]),
        );
        stored.insert(
            2,
            with_overrides(map, &defaults, &[("patch_amp_type", 4), ("patch_amp_gain", 75)]),
        );

        Self {
            device_id: map.device_id.clone(),
            current_channel_address: linear(map.patch_query.current_channel_address),
            patch_select_address: linear(map.patch_query.patch_select_address),
            editor_mode_address: linear(map.patch_query.editor_mode_address),
            channel: 0,
            live: defaults,
            stored,
        }
    }

    pub fn model_code(&self) -> u8 {
        EMULATED_MODEL_CODE
    }

    /// Handles one outgoing SysEx frame; returns the amp's reply for queries.
    pub fn handle(&mut self, frame: &[u8]) -> Result<Option<Vec<u8>>, DeviceError> {
        debug!(bytes = frame.len(), sysex = %hex_sysex(frame), "EMU TX");
        let message = RolandSysExCodec::decode(frame)?;
        if message.device_id != self.device_id {
            return Ok(None);
        }
        let address = linear(message.address);

        match message.op {
            SysExOp::Set => {
                self.apply_set(address, &message.payload);
                Ok(None)
            }
            SysExOp::Query => {
                let length = RolandSysExCodec::decode_u32_be7(&message.payload)
                    .ok_or_else(|| DeviceError::Protocol("query missing length".into()))?;
                let data = if address == self.current_channel_address {
                    RolandSysExCodec::encode_integer2x4(self.channel).to_vec()
                } else {
                    (0..length)
                        .map(|i| self.live.get(&(address + i)).copied().unwrap_or(0))
                        .collect()
                };
                let reply = RolandSysExCodec::encode_set(&self.device_id, message.address, &data);
                debug!(bytes = reply.len(), sysex = %hex_sysex(&reply), "EMU RX response");
                Ok(Some(reply))
            }
        }
    }

    fn apply_set(&mut self, address: u32, payload: &[u8]) {
        if address == self.editor_mode_address {
            return;
        }
        if address == self.patch_select_address {
            if let Some(channel) = RolandSysExCodec::decode_integer2x4(payload) {
                if channel < EMULATED_CHANNEL_COUNT {
                    // Like the hardware: unsaved panel edits are discarded on channel change.
                    self.channel = channel;
                    self.live = self.stored.get(&channel).cloned().unwrap_or_default();
                }
            }
            return;
        }
        for (i, byte) in payload.iter().enumerate() {
            self.live.insert(address + i as u32, *byte);
        }
    }
}

/// Roland addresses are four 7-bit bytes, so packing them as base-128 makes
/// consecutive bytes consecutive integers.
fn linear(address: [u8; 4]) -> u32 {
    RolandSysExCodec::decode_u32_be7(&address).unwrap_or(0)
}

fn default_memory(map: &AddressMap) -> Memory {
    let mut memory = Memory::new();
    for param in &map.params {
        let mut value = param.default.or(param.min).unwrap_or(0);
        if let Some(min) = param.min {
            value = value.max(min);
        }
        if let Some(max) = param.max {
            value = value.min(max);
        }
        write_param(&mut memory, map, &param.id, value);
    }
    memory
}

fn with_overrides(map: &AddressMap, base: &Memory, overrides: &[(&str, i32)]) -> Memory {
    let mut memory = base.clone();
    for (id, value) in overrides {
        write_param(&mut memory, map, id, *value);
    }
    memory
}

fn write_param(memory: &mut Memory, map: &AddressMap, id: &str, value: i32) {
    let Some(param) = map.param_by_id(id) else {
        return;
    };
    let Ok(bytes) = encode_param_payload(param, value) else {
        return;
    };
    let base = linear(param.address);
    for (i, byte) in bytes.into_iter().enumerate() {
        memory.insert(base + i as u32, byte);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::driver::DeviceDriver;
    use crate::katana::gen3::KatanaGen3Driver;

    fn connected_driver() -> KatanaGen3Driver {
        set_emulator_enabled(true);
        let mut driver = KatanaGen3Driver::new();
        driver.connect(EMULATOR_PORT_NAME).expect("connect emulator");
        driver
    }

    #[test]
    fn write_then_read_roundtrips() {
        let mut driver = connected_driver();
        driver.write_param("patch_amp_gain", 42).expect("write");
        assert_eq!(driver.read_param("patch_amp_gain").expect("read"), 42);
    }

    #[test]
    fn multi_byte_params_roundtrip() {
        let mut driver = connected_driver();
        driver.write_param("patch_delay_time_slot1", 620).expect("write");
        assert_eq!(driver.read_param("patch_delay_time_slot1").expect("read"), 620);
    }

    #[test]
    fn channel_select_loads_stored_patch() {
        let mut driver = connected_driver();
        driver.write_param("patch_amp_gain", 10).expect("write");
        driver.select_channel(2).expect("select");
        assert_eq!(driver.read_current_channel().expect("channel"), 2);
        assert_eq!(driver.read_param("patch_amp_type").expect("amp type"), 4);
        driver.select_channel(0).expect("select panel");
        assert_ne!(driver.read_param("patch_amp_gain").expect("gain"), 10);
    }

    #[test]
    fn reads_full_patch() {
        let mut driver = connected_driver();
        let patch = driver.read_current_patch().expect("patch");
        assert!(patch.params.len() > 100);
        assert_eq!(patch.meta.channel, Some(0));
    }

    #[test]
    fn state_survives_reconnect() {
        let mut driver = connected_driver();
        driver.write_param("patch_amp_volume", 17).expect("write");
        driver.disconnect().expect("disconnect");
        driver.connect(EMULATOR_PORT_NAME).expect("reconnect");
        assert_eq!(driver.read_param("patch_amp_volume").expect("read"), 17);
    }
}
