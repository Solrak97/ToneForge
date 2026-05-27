use std::sync::Mutex;
use toneforge_core::address_map::ParamDef;
use toneforge_core::preset::{Patch, PresetFile};
use toneforge_devices::{DeviceDriver, DeviceInfo, KatanaGen3Driver};

#[derive(Default)]
pub struct AppState {
    inner: Mutex<StateInner>,
}

struct StateInner {
    driver: KatanaGen3Driver,
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
}

impl Default for StateInner {
    fn default() -> Self {
        Self {
            driver: KatanaGen3Driver::new(),
            connection: ConnectionStatus::default(),
            last_patch: None,
            last_error: None,
        }
    }
}

impl AppState {
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

    pub fn editable_params(&self) -> Result<Vec<ParamDef>, String> {
        let inner = self.inner.lock().map_err(|_| "state lock poisoned".to_string())?;
        Ok(inner.driver.address_map().params.clone())
    }

    pub fn list_devices(&self) -> Result<Vec<DeviceInfo>, String> {
        self.with_driver(|driver| driver.list_devices())
    }
}

pub fn preset_to_json(patch: &Patch) -> Result<String, String> {
    let preset = PresetFile::from_patch(patch.clone());
    serde_json::to_string_pretty(&preset).map_err(|e| e.to_string())
}

pub fn preset_from_json(raw: &str) -> Result<PresetFile, String> {
    serde_json::from_str(raw).map_err(|e| e.to_string())
}
