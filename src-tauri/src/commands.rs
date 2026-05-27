use crate::state::{preset_from_json, preset_to_json, AppState, ConnectionStatus};
use tauri::{AppHandle, Emitter, State};
use toneforge_core::address_map::ParamDef;
use toneforge_core::preset::Patch;
use toneforge_devices::{DeviceDriver, DeviceInfo};

#[derive(Clone, serde::Serialize)]
struct ConnectionChangedPayload {
    status: ConnectionStatus,
    error: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct PatchUpdatedPayload {
    patch: Patch,
}

#[tauri::command]
pub fn list_devices(state: State<AppState>) -> Result<Vec<DeviceInfo>, String> {
    state.list_devices()
}

#[tauri::command]
pub fn connect_device(
    app: AppHandle,
    state: State<AppState>,
    port_name: String,
) -> Result<ConnectionStatus, String> {
    state.with_driver(|driver| driver.connect(&port_name))?;
    state.set_connected(port_name.clone())?;
    state.with_driver(|driver| driver.enter_editor_mode())?;
    state.set_editor_mode(true)?;

    let status = state.connection_status()?;
    let error = state.last_error()?;
    let _ = app.emit("connection-changed", ConnectionChangedPayload {
        status: status.clone(),
        error,
    });
    Ok(status)
}

#[tauri::command]
pub fn disconnect_device(app: AppHandle, state: State<AppState>) -> Result<ConnectionStatus, String> {
    let _ = state.with_driver(|driver| driver.disconnect());
    state.set_disconnected()?;
    let status = state.connection_status()?;
    let _ = app.emit("connection-changed", ConnectionChangedPayload {
        status: status.clone(),
        error: None,
    });
    Ok(status)
}

#[tauri::command]
pub fn get_connection_status(state: State<AppState>) -> Result<ConnectionStatus, String> {
    state.connection_status()
}

#[tauri::command]
pub fn read_patch(app: AppHandle, state: State<AppState>) -> Result<Patch, String> {
    let patch = state.with_driver(|driver| driver.read_current_patch())?;
    state.set_patch(patch.clone())?;
    let _ = app.emit("patch-updated", PatchUpdatedPayload {
        patch: patch.clone(),
    });
    Ok(patch)
}

#[tauri::command]
pub fn set_param(
    app: AppHandle,
    state: State<AppState>,
    param_id: String,
    value: u8,
) -> Result<Patch, String> {
    state.with_driver(|driver| driver.write_param(&param_id, value))?;
    let patch = state.with_driver(|driver| driver.read_current_patch())?;
    state.set_patch(patch.clone())?;
    let _ = app.emit("patch-updated", PatchUpdatedPayload {
        patch: patch.clone(),
    });
    Ok(patch)
}

#[tauri::command]
pub fn save_preset(state: State<AppState>, path: String) -> Result<(), String> {
    let patch = state
        .last_patch()?
        .ok_or_else(|| "no patch loaded; read from device first".to_string())?;
    let json = preset_to_json(&patch)?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_preset(app: AppHandle, state: State<AppState>, path: String) -> Result<Patch, String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let preset = preset_from_json(&raw)?;
    let patch = preset.patch;

    for (param_id, value) in &patch.params {
        if let Some(v) = value.as_u8() {
            let _ = state.with_driver(|driver| driver.write_param(param_id, v));
        }
    }

    let synced = state.with_driver(|driver| driver.read_current_patch()).unwrap_or(patch.clone());
    state.set_patch(synced.clone())?;
    let _ = app.emit("patch-updated", PatchUpdatedPayload { patch: synced.clone() });
    Ok(synced)
}

#[tauri::command]
pub fn list_editable_params(state: State<AppState>) -> Result<Vec<ParamDef>, String> {
    state.editable_params()
}
