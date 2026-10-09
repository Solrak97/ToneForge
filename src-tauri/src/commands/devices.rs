use crate::state::AppState;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use toneforge_core::address_map::ParamDef;
use toneforge_core::preset::Patch;
use toneforge_devices::{DeviceDriver, DeviceInfo};

const POST_WRITE_SETTLE: Duration = Duration::from_millis(30);
const CHANNEL_SELECT_SETTLE: Duration = Duration::from_millis(400);

#[derive(Clone, serde::Serialize)]
pub struct ConnectionChangedPayload {
    pub status: crate::state::ConnectionStatus,
    pub error: Option<String>,
}

#[derive(Clone, serde::Serialize)]
pub struct PatchUpdatedPayload {
    pub patch: Patch,
}

#[derive(Clone, serde::Serialize)]
pub struct ChannelInfo {
    pub index: u8,
    pub label: String,
}

pub(crate) fn apply_patch_to_device(state: &AppState, patch: &Patch) -> Result<(), String> {
    let mut write_failures = 0usize;
    for (param_id, value) in &patch.params {
        if let Some(v) = value.as_i32() {
            match state.with_driver(|driver| driver.write_param(param_id, v)) {
                Ok(()) => tracing::debug!(param_id = %param_id, value = v, "patch param written"),
                Err(err) => {
                    write_failures += 1;
                    tracing::warn!(param_id = %param_id, value = v, error = %err, "patch param write failed");
                }
            }
        }
    }
    if write_failures > 0 {
        tracing::warn!(write_failures, "some patch params failed to write");
    }
    Ok(())
}

/// Channel the amp is on right now, or `None` when it can't be asked.
pub(crate) fn amp_channel(state: &AppState) -> Option<u8> {
    state
        .with_driver(|driver| driver.read_current_channel())
        .ok()
}

/// Writes `patch` to the amp, switching to `channel` first when given, and tags the patch with
/// the channel it now lives on.
pub(crate) fn send_patch_to_amp(
    state: &AppState,
    patch: &mut Patch,
    channel: Option<u8>,
) -> Result<(), String> {
    if !state.connection_status()?.connected {
        return Err("connect to your Katana before sending a tone to the amp".to_string());
    }
    let target = match channel {
        Some(channel) => {
            if amp_channel(state) != Some(channel) {
                tracing::info!(channel, "switching channel before sending tone");
                state.with_driver(|driver| driver.select_channel(channel))?;
                std::thread::sleep(CHANNEL_SELECT_SETTLE);
            }
            Some(channel)
        }
        None => amp_channel(state),
    };
    apply_patch_to_device(state, patch)?;
    patch.meta.channel = target;
    patch.meta.patch_slot = target;
    Ok(())
}

#[tauri::command]
pub fn list_channels(state: State<AppState>) -> Result<Vec<ChannelInfo>, String> {
    Ok(state
        .channels()?
        .into_iter()
        .map(|channel| ChannelInfo {
            index: channel.index,
            label: channel.label,
        })
        .collect())
}

#[tauri::command]
pub fn select_channel(
    app: AppHandle,
    state: State<AppState>,
    channel: u8,
) -> Result<Patch, String> {
    tracing::info!(channel, "select_channel");
    state.with_driver(|driver| driver.select_channel(channel))?;
    std::thread::sleep(CHANNEL_SELECT_SETTLE);

    let patch = state.with_driver(|driver| driver.read_current_patch())?;
    tracing::info!(
        param_count = patch.params.len(),
        channel = ?patch.meta.channel,
        "read patch after channel select"
    );
    state.set_patch(patch.clone())?;
    if let Err(e) = app.emit(
        "patch-updated",
        PatchUpdatedPayload {
            patch: patch.clone(),
        },
    ) {
        tracing::warn!(error = %e, "failed to emit patch-updated");
    }
    Ok(patch)
}

#[tauri::command]
pub fn list_devices(state: State<AppState>) -> Result<Vec<DeviceInfo>, String> {
    tracing::debug!("list_devices");
    let devices = state.list_devices()?;
    tracing::info!(count = devices.len(), "listed MIDI devices");
    Ok(devices)
}

#[tauri::command]
pub fn connect_device(
    app: AppHandle,
    state: State<AppState>,
    port_name: String,
) -> Result<crate::state::ConnectionStatus, String> {
    tracing::info!(port = %port_name, "connect_device");
    state.with_driver(|driver| driver.connect(&port_name))?;
    state.set_connected(port_name.clone())?;
    state.with_driver(|driver| driver.enter_editor_mode())?;
    state.set_editor_mode(true)?;

    let status = state.connection_status()?;
    let error = state.last_error()?;
    if let Err(e) = app.emit(
        "connection-changed",
        ConnectionChangedPayload {
            status: status.clone(),
            error: error.clone(),
        },
    ) {
        tracing::warn!(error = %e, "failed to emit connection-changed");
    }
    tracing::info!(editor_mode = status.editor_mode, "connected");
    Ok(status)
}

#[tauri::command]
pub fn disconnect_device(
    app: AppHandle,
    state: State<AppState>,
) -> Result<crate::state::ConnectionStatus, String> {
    tracing::info!("disconnect_device");
    let _ = state.with_driver(|driver| driver.disconnect());
    state.set_disconnected()?;
    let status = state.connection_status()?;
    if let Err(e) = app.emit(
        "connection-changed",
        ConnectionChangedPayload {
            status: status.clone(),
            error: None,
        },
    ) {
        tracing::warn!(error = %e, "failed to emit connection-changed");
    }
    Ok(status)
}

#[tauri::command]
pub fn get_connection_status(
    state: State<AppState>,
) -> Result<crate::state::ConnectionStatus, String> {
    state.connection_status()
}

/// The last patch the backend read or wrote, without touching the device.
#[tauri::command]
pub fn get_cached_patch(state: State<AppState>) -> Result<Option<Patch>, String> {
    state.last_patch()
}

#[tauri::command]
pub fn read_patch(app: AppHandle, state: State<AppState>) -> Result<Patch, String> {
    tracing::debug!("read_patch");
    let patch = state.with_driver(|driver| driver.read_current_patch())?;
    tracing::info!(
        param_count = patch.params.len(),
        channel = ?patch.meta.channel,
        "read patch from device"
    );
    state.set_patch(patch.clone())?;
    if let Err(e) = app.emit(
        "patch-updated",
        PatchUpdatedPayload {
            patch: patch.clone(),
        },
    ) {
        tracing::warn!(error = %e, "failed to emit patch-updated");
    }
    Ok(patch)
}

#[tauri::command]
pub fn set_param(
    app: AppHandle,
    state: State<AppState>,
    param_id: String,
    value: i32,
) -> Result<Patch, String> {
    tracing::info!(param_id = %param_id, value, "set_param");
    state.with_driver(|driver| driver.write_param(&param_id, value))?;
    std::thread::sleep(POST_WRITE_SETTLE);

    let patch = state.apply_param_write(&param_id, value)?;

    if let Err(e) = app.emit(
        "patch-updated",
        PatchUpdatedPayload {
            patch: patch.clone(),
        },
    ) {
        tracing::warn!(error = %e, "failed to emit patch-updated");
    }
    Ok(patch)
}

#[tauri::command]
pub fn list_editable_params(state: State<AppState>) -> Result<Vec<ParamDef>, String> {
    state.editable_params()
}

#[tauri::command]
pub fn get_log_path(app: AppHandle) -> Result<String, String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    Ok(crate::logging::log_file_path(&log_dir).display().to_string())
}
