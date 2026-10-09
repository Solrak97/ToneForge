use crate::driver::{DeviceDriver, DeviceInfo};
use crate::error::DeviceError;
use crate::katana::emulator::{
    emulator_enabled, EmulatedKatana, EMULATOR_DEVICE_ID, EMULATOR_PORT_NAME,
};
use crate::transport::{is_katana_candidate, MidiTransport};
use std::time::Duration;
use toneforge_core::address_map::{AddressMap, ParamDef, ParamEncoding, ParamKind};
use toneforge_core::channels::{self, ChannelDef};
use toneforge_core::preset::{ParamValue, Patch};
use toneforge_core::sysex::RolandSysExCodec;
use tracing::{debug, info, warn};

const PARAM_QUERY_TIMEOUT: Duration = Duration::from_secs(2);
const IDENTITY_QUERY_TIMEOUT: Duration = Duration::from_secs(2);

enum Link {
    Midi(MidiTransport),
    Emulated(EmulatedKatana),
}

impl Link {
    fn send_sysex(&mut self, data: &[u8]) -> Result<(), DeviceError> {
        match self {
            Link::Midi(t) => t.send_sysex(data),
            Link::Emulated(e) => e.handle(data).map(|_| ()),
        }
    }

    fn request_response(&mut self, request: &[u8], timeout: Duration) -> Result<Vec<u8>, DeviceError> {
        match self {
            Link::Midi(t) => t.request_response(request, timeout),
            Link::Emulated(e) => e.handle(request)?.ok_or(DeviceError::Timeout),
        }
    }

    fn query_identity(&mut self, timeout: Duration) -> Result<Option<u8>, DeviceError> {
        match self {
            Link::Midi(t) => t.query_identity(timeout),
            Link::Emulated(e) => Ok(Some(e.model_code())),
        }
    }
}

pub struct KatanaGen3Driver {
    map: AddressMap,
    transport: Option<Link>,
    /// Emulator state kept across disconnects so edits survive a reconnect.
    parked_emulator: Option<EmulatedKatana>,
    connected_port: Option<String>,
    editor_mode: bool,
    model_code: Option<u8>,
    channels: Vec<ChannelDef>,
}

impl KatanaGen3Driver {
    pub fn new() -> Self {
        Self::with_address_map(
            AddressMap::from_json_str(include_str!(
                "../../../toneforge-core/data/gen3_address_map.json"
            ))
            .expect("embedded gen3 address map"),
        )
    }

    pub fn with_address_map(map: AddressMap) -> Self {
        Self {
            map,
            transport: None,
            parked_emulator: None,
            connected_port: None,
            editor_mode: false,
            model_code: None,
            channels: channels::default_channels(),
        }
    }

    pub fn address_map(&self) -> &AddressMap {
        &self.map
    }

    pub fn channels(&self) -> &[ChannelDef] {
        &self.channels
    }

    pub fn model_code(&self) -> Option<u8> {
        self.model_code
    }

    pub fn is_emulated(&self) -> bool {
        matches!(self.transport, Some(Link::Emulated(_)))
    }

    fn detect_model(&mut self) {
        let Ok(transport) = self.transport_mut() else {
            return;
        };
        match transport.query_identity(IDENTITY_QUERY_TIMEOUT) {
            Ok(Some(code)) => {
                self.model_code = Some(code);
                self.channels = channels::channels_for_model_code(code);
                info!(
                    model_code = format!("{code:02X}"),
                    channels = self.channels.len(),
                    "Katana model detected"
                );
            }
            Ok(None) => {
                warn!("identity reply received but model code not parsed; using default channels");
            }
            Err(err) => {
                warn!(error = %err, "identity query failed; using default channels");
            }
        }
    }

    fn transport_mut(&mut self) -> Result<&mut Link, DeviceError> {
        self.transport.as_mut().ok_or(DeviceError::NotConnected)
    }

    fn query_bytes(
        &mut self,
        address: [u8; 4],
        length: u32,
        timeout: Duration,
    ) -> Result<Vec<u8>, DeviceError> {
        let request =
            RolandSysExCodec::encode_query(&self.map.device_id, address, length);
        let response = self
            .transport_mut()?
            .request_response(&request, timeout)?;
        let message = RolandSysExCodec::decode(&response)?;
        Ok(message.payload)
    }

    fn read_param_value(&mut self, param: &ParamDef) -> Result<i32, DeviceError> {
        let size = match param.encoding {
            ParamEncoding::Integer1x7 => 1,
            ParamEncoding::Integer2x4 | ParamEncoding::Integer2x7 => 2,
            ParamEncoding::Integer4x4 => 4,
        };
        let payload = self.query_bytes(param.address, size, PARAM_QUERY_TIMEOUT)?;
        let raw = match param.encoding {
            ParamEncoding::Integer1x7 => payload
                .first()
                .copied()
                .map(i32::from)
                .ok_or_else(|| DeviceError::Protocol("empty query response".into()))?,
            ParamEncoding::Integer2x4 => RolandSysExCodec::decode_integer2x4(&payload)
                .map(i32::from)
                .ok_or_else(|| DeviceError::Protocol("invalid INTEGER2x4 response".into()))?,
            ParamEncoding::Integer2x7 => RolandSysExCodec::decode_integer2x7(&payload)
                .map(i32::from)
                .ok_or_else(|| DeviceError::Protocol("invalid INTEGER2x7 response".into()))?,
            ParamEncoding::Integer4x4 => RolandSysExCodec::decode_integer4x4(&payload)
                .map(i32::from)
                .ok_or_else(|| DeviceError::Protocol("invalid INTEGER4x4 response".into()))?,
        };
        Ok(raw - param.offset)
    }

    fn query_current_channel(&mut self) -> Result<u8, DeviceError> {
        self.ensure_editor_mode()?;
        let address = self.map.patch_query.current_channel_address;
        let payload = self.query_bytes(address, 2, PARAM_QUERY_TIMEOUT)?;
        RolandSysExCodec::decode_integer2x4(&payload).ok_or_else(|| {
            DeviceError::Protocol("invalid channel response".into())
        })
    }

    fn select_channel_on_device(&mut self, channel: u8) -> Result<(), DeviceError> {
        self.ensure_editor_mode()?;

        if !channels::is_valid_channel(&self.channels, channel) {
            return Err(DeviceError::Protocol(format!(
                "channel {channel} is not available on this Katana model"
            )));
        }

        let address = self.map.patch_query.patch_select_address;
        let data = RolandSysExCodec::encode_integer2x4(channel);
        let request = RolandSysExCodec::encode_set(&self.map.device_id, address, &data);
        self.transport_mut()?.send_sysex(&request)?;
        info!(channel, "channel select sent");
        Ok(())
    }

    fn ensure_editor_mode(&mut self) -> Result<(), DeviceError> {
        if !self.editor_mode {
            self.enter_editor_mode()?;
        }
        Ok(())
    }
}

impl Default for KatanaGen3Driver {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) fn encode_param_payload(param: &ParamDef, value: i32) -> Result<Vec<u8>, DeviceError> {
    let raw = value + param.offset;
    if raw < 0 {
        return Err(DeviceError::Protocol(format!(
            "value {value} underflows raw encoding for `{}`",
            param.id
        )));
    }
    match param.encoding {
        ParamEncoding::Integer1x7 => {
            let b = u8::try_from(raw).map_err(|_| {
                DeviceError::Protocol(format!("value {value} out of range for `{}`", param.id))
            })?;
            Ok(vec![b])
        }
        ParamEncoding::Integer2x4 => {
            let b = u8::try_from(raw).map_err(|_| {
                DeviceError::Protocol(format!("value {value} out of range for `{}`", param.id))
            })?;
            Ok(RolandSysExCodec::encode_integer2x4(b).to_vec())
        }
        ParamEncoding::Integer2x7 => {
            let v = u16::try_from(raw).map_err(|_| {
                DeviceError::Protocol(format!("value {value} out of range for `{}`", param.id))
            })?;
            Ok(RolandSysExCodec::encode_integer2x7(v).to_vec())
        }
        ParamEncoding::Integer4x4 => {
            let v = u16::try_from(raw).map_err(|_| {
                DeviceError::Protocol(format!("value {value} out of range for `{}`", param.id))
            })?;
            Ok(RolandSysExCodec::encode_integer4x4(v).to_vec())
        }
    }
}

impl DeviceDriver for KatanaGen3Driver {
    fn list_devices(&self) -> Result<Vec<DeviceInfo>, DeviceError> {
        let names = match MidiTransport::list_unique_devices() {
            Ok(names) => names,
            Err(err) if emulator_enabled() => {
                warn!(error = %err, "MIDI scan failed; listing emulator only");
                Vec::new()
            }
            Err(err) => return Err(err),
        };
        let mut devices: Vec<DeviceInfo> = names
            .into_iter()
            .enumerate()
            .map(|(idx, name)| DeviceInfo {
                id: format!("katana-gen3:{idx}"),
                name: name.clone(),
                manufacturer_hint: Some("Boss".into()),
                model_hint: Some("Katana Gen3".into()),
            })
            .collect();
        if emulator_enabled() {
            devices.push(DeviceInfo {
                id: EMULATOR_DEVICE_ID.into(),
                name: EMULATOR_PORT_NAME.into(),
                manufacturer_hint: Some("ToneForge".into()),
                model_hint: Some("Katana Gen3 (emulated)".into()),
            });
        }
        Ok(devices)
    }

    fn connect(&mut self, device_id: &str) -> Result<(), DeviceError> {
        let port_name = if device_id.contains(':') {
            self.list_devices()?
                .into_iter()
                .find(|d| d.id == device_id)
                .map(|d| d.name)
                .ok_or_else(|| DeviceError::NotFound(device_id.to_string()))?
        } else {
            device_id.to_string()
        };

        let link = if port_name == EMULATOR_PORT_NAME {
            if !emulator_enabled() {
                return Err(DeviceError::NotFound(
                    "the emulator is only available in experimental mode".into(),
                ));
            }
            let emulator = self
                .parked_emulator
                .take()
                .unwrap_or_else(|| EmulatedKatana::new(&self.map));
            Link::Emulated(emulator)
        } else {
            if !is_katana_candidate(&port_name) {
                return Err(DeviceError::NotFound(format!(
                    "port `{port_name}` does not look like a Katana device"
                )));
            }
            Link::Midi(MidiTransport::connect(&port_name)?)
        };

        self.transport = Some(link);
        self.connected_port = Some(port_name.clone());
        self.editor_mode = false;
        self.detect_model();
        info!(port = %port_name, emulated = self.is_emulated(), "Katana driver connected");
        Ok(())
    }

    fn disconnect(&mut self) -> Result<(), DeviceError> {
        info!(port = ?self.connected_port, "Katana driver disconnecting");
        if let Some(Link::Emulated(emulator)) = self.transport.take() {
            self.parked_emulator = Some(emulator);
        }
        self.connected_port = None;
        self.editor_mode = false;
        self.model_code = None;
        self.channels = channels::default_channels();
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.transport.is_some()
    }

    fn enter_editor_mode(&mut self) -> Result<(), DeviceError> {
        let address = self.map.patch_query.editor_mode_address;
        let value = self.map.patch_query.editor_mode_value;
        let request = RolandSysExCodec::encode_set(&self.map.device_id, address, &[value]);
        self.transport_mut()?.send_sysex(&request)?;
        debug!(address = ?address, value, "entered editor mode");
        self.editor_mode = true;
        Ok(())
    }

    fn read_param(&mut self, param_id: &str) -> Result<i32, DeviceError> {
        self.ensure_editor_mode()?;
        let param = self
            .map
            .param_by_id(param_id)
            .cloned()
            .ok_or_else(|| DeviceError::Protocol(format!("unknown param `{param_id}`")))?;
        self.read_param_value(&param)
    }

    fn read_current_patch(&mut self) -> Result<Patch, DeviceError> {
        self.ensure_editor_mode()?;

        let channel = self.query_current_channel().ok();

        let mut patch = Patch::new(&self.map.device_family, &self.map.device_model);
        patch.meta.channel = channel;
        patch.meta.patch_slot = channel;

        let mut read_count = 0usize;
        let mut fail_count = 0usize;

        for param in self.map.params.clone() {
            if !param.wired {
                continue;
            }

            match self.read_param_value(&param) {
                Ok(v) => {
                    match param.kind {
                        ParamKind::U16 => {
                            if let Ok(v16) = u16::try_from(v) {
                                patch.set_param(&param.id, ParamValue::U16 { value: v16 });
                            }
                        }
                        ParamKind::I8 => {
                            if let Ok(v8) = i8::try_from(v) {
                                patch.set_param(&param.id, ParamValue::I8 { value: v8 });
                            }
                        }
                        _ => {
                            if let Ok(v8) = u8::try_from(v) {
                                patch.set_param(&param.id, ParamValue::U8 { value: v8 });
                            } else if let Ok(v8) = i8::try_from(v) {
                                patch.set_param(&param.id, ParamValue::I8 { value: v8 });
                            }
                        }
                    }
                    read_count += 1;
                }
                Err(err) => {
                    fail_count += 1;
                    debug!(
                        param_id = %param.id,
                        error = %err,
                        "param read failed"
                    );
                }
            }
        }

        if read_count == 0 {
            return Err(DeviceError::Protocol(
                "failed to read any parameters from device".into(),
            ));
        }

        if fail_count > 0 {
            warn!(
                read_count,
                fail_count,
                "patch read partial; some parameters unavailable"
            );
        }

        info!(param_count = patch.params.len(), "patch read complete");
        Ok(patch)
    }

    fn write_param(&mut self, param_id: &str, value: i32) -> Result<(), DeviceError> {
        self.ensure_editor_mode()?;

        let param = self
            .map
            .param_by_id(param_id)
            .ok_or_else(|| DeviceError::Protocol(format!("unknown param `{param_id}`")))?;

        if !param.wired {
            return Err(DeviceError::Protocol(format!(
                "param `{param_id}` is not wired for SysEx I/O yet"
            )));
        }

        if let Some(min) = param.min {
            if value < min {
                return Err(DeviceError::Protocol(format!(
                    "value {value} below min {min} for `{param_id}`"
                )));
            }
        }
        if let Some(max) = param.max {
            if value > max {
                return Err(DeviceError::Protocol(format!(
                    "value {value} above max {max} for `{param_id}`"
                )));
            }
        }

        let address = param.address;
        let payload = encode_param_payload(param, value)?;
        let request = RolandSysExCodec::encode_set(&self.map.device_id, address, &payload);
        self.transport_mut()?.send_sysex(&request)?;
        debug!(param_id, address = ?address, value, "write_param sent");

        Ok(())
    }

    fn read_current_channel(&mut self) -> Result<u8, DeviceError> {
        self.query_current_channel()
    }

    fn select_channel(&mut self, channel: u8) -> Result<(), DeviceError> {
        self.select_channel_on_device(channel)
    }

    fn device_model(&self) -> &str {
        &self.map.device_model
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn driver_embedded_map_loads() {
        let driver = KatanaGen3Driver::new();
        assert_eq!(driver.device_model(), "katana-gen3");
        assert!(driver.address_map().param_by_id("patch_amp_gain").is_some());
    }
}
