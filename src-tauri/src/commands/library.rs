use crate::state::AppState;
use tauri::{AppHandle, Emitter, Manager, State};
use toneforge_core::preset::Patch;
use toneforge_devices::DeviceDriver;
use toneforge_library::{SaveToneRequest, ToneRecord, ToneSummary};

use super::{apply_patch_to_device, PatchUpdatedPayload};

#[tauri::command]
pub fn list_library_tones(
    state: State<AppState>,
    query: Option<String>,
) -> Result<Vec<ToneSummary>, String> {
    state.with_library(|library| library.list(query.as_deref()))
}

#[tauri::command]
pub fn get_library_tone(state: State<AppState>, id: i64) -> Result<ToneRecord, String> {
    state.with_library(|library| library.get(id))
}

#[tauri::command]
pub fn save_library_tone(
    state: State<AppState>,
    request: SaveToneRequest,
) -> Result<ToneRecord, String> {
    let patch = state
        .last_patch()?
        .ok_or_else(|| "no patch loaded; read from device first".to_string())?;
    tracing::info!(name = %request.name, "save_library_tone");
    state.with_library(|library| library.save(&request.name, &patch, &request.notes, &request.tags))
}

#[tauri::command]
pub fn delete_library_tone(state: State<AppState>, id: i64) -> Result<(), String> {
    tracing::info!(id, "delete_library_tone");
    state.with_library(|library| library.delete(id).map(|_| ()))
}

#[tauri::command]
pub fn rename_library_tone(
    state: State<AppState>,
    id: i64,
    name: String,
) -> Result<ToneRecord, String> {
    tracing::info!(id, name = %name, "rename_library_tone");
    state.with_library(|library| library.update_name(id, &name))
}

#[tauri::command]
pub fn load_library_tone(
    app: AppHandle,
    state: State<AppState>,
    id: i64,
    write_to_device: bool,
) -> Result<Patch, String> {
    tracing::info!(id, write_to_device, "load_library_tone");
    let tone = state.with_library(|library| library.get(id))?;
    let patch = tone.patch;

    if write_to_device {
        if !state.connection_status()?.connected {
            return Err("connect to your Katana before sending a tone to the amp".to_string());
        }
        apply_patch_to_device(&state, &patch)?;
    }

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
pub fn import_library_tone_from_amp(
    state: State<AppState>,
    request: SaveToneRequest,
) -> Result<ToneRecord, String> {
    if !state.connection_status()?.connected {
        return Err("connect to your Katana before importing from the amp".to_string());
    }
    tracing::info!(name = %request.name, "import_library_tone_from_amp");
    let patch = state.with_driver(|driver| driver.read_current_patch())?;
    state.set_patch(patch.clone())?;
    state.with_library(|library| library.save(&request.name, &patch, &request.notes, &request.tags))
}

#[tauri::command]
pub fn import_library_tone_from_file(
    state: State<AppState>,
    path: String,
    request: SaveToneRequest,
) -> Result<ToneRecord, String> {
    tracing::info!(path = %path, "import_library_tone_from_file");
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let preset = crate::state::preset_from_json(&raw)?;
    let patch = preset.patch;

    let name = {
        let trimmed = request.name.trim();
        if trimmed.is_empty() {
            std::path::Path::new(&path)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("Imported tone")
                .to_string()
        } else {
            trimmed.to_string()
        }
    };

    state.with_library(|library| library.save(&name, &patch, &request.notes, &request.tags))
}

#[tauri::command]
pub fn get_library_db_path(app: AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("toneforge.db");
    Ok(path.display().to_string())
}
