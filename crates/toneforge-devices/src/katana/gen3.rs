use crate::driver::{DeviceDriver, DeviceInfo};
use crate::error::DeviceError;
use crate::transport::{is_katana_candidate, MidiTransport};
use std::time::Duration;
use toneforge_core::address_map::AddressMap;
use toneforge_core::channels::{self, ChannelDef};
use toneforge_core::preset::{ParamValue, Patch};
use toneforge_core::sysex::RolandSysExCodec;
use tracing::{debug, info, warn};

const PARAM_QUERY_TIMEOUT: Duration = Duration::from_secs(2);
const IDENTITY_QUERY_TIMEOUT: Duration = Duration::from_secs(2);

pub struct KatanaGen3Driver {
    map: AddressMap,
    transport: Option<MidiTransport>,
    connected_port: Option<String>,
    editor_mode: bool,
    model_code: Option<u8>,
    channels: Vec<ChannelDef>,
}

impl KatanaGen3Driver {
    pub fn new() -> Self {
        Self {
            map: AddressMap::from_json_str(include_str!(
                "../../../toneforge-core/data/gen3_address_map.json"
            ))
            .expect("embedded gen3 address map"),
            transport: None,
            connected_port: None,
            editor_mode: false,
            model_code: None,
            channels: channels::default_channels(),
        }
    }

    pub fn with_address_map(map: AddressMap) -> Self {
        Self {
            map,
            transport: None,
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

    fn transport_mut(&mut self) -> Result<&mut MidiTransport, DeviceError> {
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

    fn query_single_byte(&mut self, address: [u8; 4]) -> Result<u8, DeviceError> {
        let payload = self.query_bytes(address, 1, PARAM_QUERY_TIMEOUT)?;
        payload.first().copied().ok_or_else(|| {
            DeviceError::Protocol("empty query response".into())
        })
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

impl DeviceDriver for KatanaGen3Driver {
    fn list_devices(&self) -> Result<Vec<DeviceInfo>, DeviceError> {
        let names = MidiTransport::list_unique_devices()?;
        Ok(names
            .into_iter()
            .enumerate()
            .map(|(idx, name)| DeviceInfo {
                id: format!("katana-gen3:{idx}"),
                name: name.clone(),
                manufacturer_hint: Some("Boss".into()),
                model_hint: Some("Katana Gen3".into()),
            })
            .collect())
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

        if !is_katana_candidate(&port_name) {
            return Err(DeviceError::NotFound(format!(
                "port `{port_name}` does not look like a Katana device"
            )));
        }

        let transport = MidiTransport::connect(&port_name)?;
        self.transport = Some(transport);
        self.connected_port = Some(port_name.clone());
        self.editor_mode = false;
        self.detect_model();
        info!(port = %port_name, "Katana driver connected");
        Ok(())
    }

    fn disconnect(&mut self) -> Result<(), DeviceError> {
        info!(port = ?self.connected_port, "Katana driver disconnecting");
        self.transport = None;
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

    fn read_param(&mut self, param_id: &str) -> Result<u8, DeviceError> {
        self.ensure_editor_mode()?;
        let param = self
            .map
            .param_by_id(param_id)
            .ok_or_else(|| DeviceError::Protocol(format!("unknown param `{param_id}`")))?;
        self.query_single_byte(param.address)
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

            match self.query_single_byte(param.address) {
                Ok(v) => {
                    patch.set_param(&param.id, ParamValue::from_u8(v));
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

    fn write_param(&mut self, param_id: &str, value: u8) -> Result<(), DeviceError> {
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
            if i32::from(value) < min {
                return Err(DeviceError::Protocol(format!(
                    "value {value} below min {min} for `{param_id}`"
                )));
            }
        }
        if let Some(max) = param.max {
            if i32::from(value) > max {
                return Err(DeviceError::Protocol(format!(
                    "value {value} above max {max} for `{param_id}`"
                )));
            }
        }

        let address = param.address;
        let request = RolandSysExCodec::encode_set(&self.map.device_id, address, &[value]);
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
