use std::sync::Mutex;
use toneforge_core::address_map::{AddressMap, ParamDef, ParamKind};
use toneforge_core::preset::{ParamValue, Patch, PresetFile};
use toneforge_devices::{DeviceDriver, DeviceInfo, KatanaGen3Driver};
use toneforge_library::ToneLibrary;
use tracing::warn;

pub struct AppState {
    inner: Mutex<StateInner>,
}

struct StateInner {
    driver: KatanaGen3Driver,
    library: ToneLibrary,
    connection: ConnectionStatus,
    last_patch: Option<Patch>,
    last_error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub port_name: Option<String>,
    pub device_model: Option<String>,
    pub editor_mode: bool,
    #[serde(default)]
    pub emulated: bool,
}

impl AppState {
    pub fn new(library: ToneLibrary) -> Self {
        Self {
            inner: Mutex::new(StateInner {
                driver: KatanaGen3Driver::new(),
                library,
                connection: ConnectionStatus::default(),
                last_patch: None,
                last_error: None,
            }),
        }
    }

    pub fn with_library<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&ToneLibrary) -> Result<R, toneforge_library::LibraryError>,
    {
        let inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        f(&inner.library).map_err(|e| e.to_string())
    }

    pub fn with_driver<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut KatanaGen3Driver) -> Result<R, toneforge_devices::DeviceError>,
    {
        let mut inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        match f(&mut inner.driver) {
            Ok(value) => {
                inner.last_error = None;
                Ok(value)
            }
            Err(err) => {
                let message = err.to_string();
                warn!(error = %message, "driver operation failed");
                inner.last_error = Some(message.clone());
                Err(message)
            }
        }
    }

    pub fn set_connected(&self, port_name: String) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        inner.connection = ConnectionStatus {
            connected: true,
            port_name: Some(port_name),
            device_model: Some(inner.driver.device_model().to_string()),
            editor_mode: false,
            emulated: inner.driver.is_emulated(),
        };
        Ok(())
    }

    pub fn set_disconnected(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        inner.connection = ConnectionStatus::default();
        inner.last_patch = None;
        Ok(())
    }

    pub fn set_editor_mode(&self, enabled: bool) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        inner.connection.editor_mode = enabled;
        Ok(())
    }

    pub fn set_patch(&self, patch: Patch) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        inner.last_patch = Some(patch);
        Ok(())
    }

    pub fn apply_param_write(&self, param_id: &str, value: i32) -> Result<Patch, String> {
        let mut inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        let kind = inner
            .driver
            .address_map()
            .param_by_id(param_id)
            .map(|p| p.kind)
            .ok_or_else(|| format!("unknown param `{param_id}`"))?;
        let patch = inner
            .last_patch
            .as_mut()
            .ok_or_else(|| "no patch loaded; read from device first".to_string())?;
        let next_value = match kind {
            ParamKind::U16 => {
                let v = u16::try_from(value).map_err(|_| format!("invalid u16 value: {value}"))?;
                ParamValue::U16 { value: v }
            }
            ParamKind::I8 => {
                let v = i8::try_from(value).map_err(|_| format!("invalid i8 value: {value}"))?;
                ParamValue::I8 { value: v }
            }
            ParamKind::Text => ParamValue::Text {
                value: value.to_string(),
            },
            _ => {
                if let Ok(v) = u8::try_from(value) {
                    ParamValue::U8 { value: v }
                } else {
                    let v = i8::try_from(value).map_err(|_| format!("invalid i8 value: {value}"))?;
                    ParamValue::I8 { value: v }
                }
            }
        };
        patch.set_param(param_id, next_value);
        Ok(patch.clone())
    }

    pub fn connection_status(&self) -> Result<ConnectionStatus, String> {
        let inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        Ok(inner.connection.clone())
    }

    pub fn last_patch(&self) -> Result<Option<Patch>, String> {
        let inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        Ok(inner.last_patch.clone())
    }

    pub fn last_error(&self) -> Result<Option<String>, String> {
        let inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        Ok(inner.last_error.clone())
    }

    pub fn with_address_map<R>(&self, f: impl FnOnce(&AddressMap) -> R) -> Result<R, String> {
        let inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        Ok(f(inner.driver.address_map()))
    }

    pub fn editable_params(&self) -> Result<Vec<ParamDef>, String> {
        let inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        Ok(inner.driver.address_map().params.clone())
    }

    pub fn list_devices(&self) -> Result<Vec<DeviceInfo>, String> {
        self.with_driver(|driver| driver.list_devices())
    }

    pub fn channels(&self) -> Result<Vec<toneforge_core::ChannelDef>, String> {
        let inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        Ok(inner.driver.channels().to_vec())
    }
}

pub fn preset_from_json(raw: &str) -> Result<PresetFile, String> {
    serde_json::from_str(raw).map_err(|e| e.to_string())
}
