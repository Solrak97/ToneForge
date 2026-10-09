use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};
use toneforge_devices::katana::emulator::set_emulator_enabled;
use toneforge_devices::DeviceDriver;

use super::ConnectionChangedPayload;

#[derive(Default, Serialize, Deserialize)]
struct DevModeFile {
    enabled: bool,
}

fn dev_mode_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("dev_mode.json")
}

/// Reads the saved experimental ("dev") mode and applies it (it gates the amp emulator).
pub fn restore_dev_mode(app_data_dir: &Path) -> bool {
    let enabled = std::fs::read_to_string(dev_mode_path(app_data_dir))
        .ok()
        .and_then(|raw| serde_json::from_str::<DevModeFile>(&raw).ok())
        .unwrap_or_default()
        .enabled;
    set_emulator_enabled(enabled);
    enabled
}

#[tauri::command]
pub fn get_dev_mode(app: AppHandle) -> Result<bool, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(restore_dev_mode(&dir))
}

#[tauri::command]
pub fn set_dev_mode(app: AppHandle, state: State<AppState>, enabled: bool) -> Result<bool, String> {
    tracing::info!(enabled, "set_dev_mode");
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string(&DevModeFile { enabled }).map_err(|e| e.to_string())?;
    std::fs::write(dev_mode_path(&dir), raw).map_err(|e| e.to_string())?;
    set_emulator_enabled(enabled);

    let status = state.connection_status()?;
    if !enabled && status.connected && status.emulated {
        let _ = state.with_driver(|driver| driver.disconnect());
        state.set_disconnected()?;
        let payload = ConnectionChangedPayload {
            status: state.connection_status()?,
            error: None,
        };
        if let Err(e) = app.emit("connection-changed", payload) {
            tracing::warn!(error = %e, "failed to emit connection-changed");
        }
    }
    Ok(enabled)
}
