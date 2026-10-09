use crate::livesets::LibraryImport;
use crate::state::AppState;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, State};
use toneforge_core::preset::Patch;
use toneforge_devices::DeviceDriver;
use toneforge_library::{LiveSetRecord, LiveSetSummary, SaveToneRequest, ToneRecord, ToneSummary};
use toneforge_core::preset::ParamValue;

use super::{amp_channel, send_patch_to_amp, PatchUpdatedPayload};

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
pub fn update_library_tone_patch(
    state: State<AppState>,
    id: i64,
    patch: Patch,
) -> Result<ToneRecord, String> {
    tracing::info!(id, "update_library_tone_patch");
    state.with_library(|library| library.update_patch(id, &patch))
}

#[tauri::command]
pub fn load_library_tone(
    app: AppHandle,
    state: State<AppState>,
    id: i64,
    write_to_device: bool,
    channel: Option<u8>,
) -> Result<Patch, String> {
    tracing::info!(id, write_to_device, ?channel, "load_library_tone");
    let tone = state.with_library(|library| library.get(id))?;
    let mut patch = tone.patch;

    if write_to_device {
        send_patch_to_amp(&state, &mut patch, channel)?;
    } else if state.connection_status()?.connected {
        // Edits from the editor go to the amp's current channel, so tag the patch with it.
        patch.meta.channel = amp_channel(&state);
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
pub fn import_library_file(state: State<AppState>, path: String) -> Result<LibraryImport, String> {
    tracing::info!(path = %path, "import_library_file");
    crate::livesets::import_file(&state, Path::new(&path))
}

#[tauri::command]
pub fn export_library_tone(state: State<AppState>, id: i64, path: String) -> Result<(), String> {
    tracing::info!(id, path = %path, "export_library_tone");
    crate::livesets::export_tone(&state, id, Path::new(&path))
}

#[tauri::command]
pub fn list_livesets(state: State<AppState>) -> Result<Vec<LiveSetSummary>, String> {
    state.with_library(|library| library.list_livesets())
}

#[tauri::command]
pub fn get_liveset(state: State<AppState>, id: i64) -> Result<LiveSetRecord, String> {
    state.with_library(|library| library.get_liveset(id))
}

#[tauri::command]
pub fn create_liveset(state: State<AppState>, name: String) -> Result<LiveSetRecord, String> {
    tracing::info!(name = %name, "create_liveset");
    state.with_library(|library| library.create_liveset(&name, ""))
}

#[tauri::command]
pub fn rename_liveset(state: State<AppState>, id: i64, name: String) -> Result<LiveSetRecord, String> {
    tracing::info!(id, name = %name, "rename_liveset");
    state.with_library(|library| library.rename_liveset(id, &name))
}

#[tauri::command]
pub fn delete_liveset(state: State<AppState>, id: i64) -> Result<(), String> {
    tracing::info!(id, "delete_liveset");
    state.with_library(|library| library.delete_liveset(id))
}

#[tauri::command]
pub fn add_tone_to_liveset(
    state: State<AppState>,
    liveset_id: i64,
    tone_id: i64,
) -> Result<LiveSetRecord, String> {
    tracing::info!(liveset_id, tone_id, "add_tone_to_liveset");
    state.with_library(|library| library.add_tone_to_liveset(liveset_id, tone_id))
}

#[tauri::command]
pub fn remove_tone_from_liveset(
    state: State<AppState>,
    liveset_id: i64,
    tone_id: i64,
) -> Result<LiveSetRecord, String> {
    tracing::info!(liveset_id, tone_id, "remove_tone_from_liveset");
    state.with_library(|library| library.remove_tone_from_liveset(liveset_id, tone_id))
}

#[tauri::command]
pub fn reorder_liveset(
    state: State<AppState>,
    liveset_id: i64,
    tone_ids: Vec<i64>,
) -> Result<LiveSetRecord, String> {
    state.with_library(|library| library.reorder_liveset(liveset_id, &tone_ids))
}

#[tauri::command]
pub fn export_liveset(state: State<AppState>, id: i64, path: String) -> Result<(), String> {
    tracing::info!(id, path = %path, "export_liveset");
    crate::livesets::export_liveset(&state, id, Path::new(&path))
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

#[tauri::command]
pub fn seed_library_demo_tones(state: State<AppState>) -> Result<usize, String> {
    state.with_library(|library| {
        if !library.is_empty()? {
            return Ok(0usize);
        }

        let mut created = 0usize;

        let mk = |name: &str, notes: &str, tags: &[&str], f: fn(&mut Patch)| -> Result<(), toneforge_library::LibraryError> {
            let mut patch = Patch::new("boss-katana", "katana-gen3");
            patch.meta.channel = Some(0);
            patch.meta.name = Some(name.to_string());
            f(&mut patch);
            let tag_vec = tags.iter().map(|s| s.to_string()).collect::<Vec<_>>();
            let _ = library.save(name, &patch, notes, &tag_vec)?;
            Ok(())
        };

        // IDs below are from our Gen3 map; missing params are simply ignored by the UI.
        mk(
            "Clean Glass",
            "Bright clean with subtle ambience.",
            &["Clean", "Ambient"],
            |p| {
                p.set_param("patch_amp_gain", ParamValue::from_u8(25));
                p.set_param("patch_amp_volume", ParamValue::from_u8(60));
                p.set_param("patch_amp_bass", ParamValue::from_u8(45));
                p.set_param("patch_amp_middle", ParamValue::from_u8(45));
                p.set_param("patch_amp_treble", ParamValue::from_u8(65));
                p.set_param("patch_amp_presence", ParamValue::from_u8(60));
                p.set_param("patch_sw_reverb_sw", ParamValue::from_u8(1));
                p.set_param("patch_reverb_effect_level_slot1", ParamValue::from_u8(35));
            },
        )?;
        created += 1;

        mk(
            "Crunch Machine",
            "Classic crunch; touch-sensitive.",
            &["Crunch", "Rhythm"],
            |p| {
                p.set_param("patch_amp_gain", ParamValue::from_u8(55));
                p.set_param("patch_amp_volume", ParamValue::from_u8(70));
                p.set_param("patch_amp_bass", ParamValue::from_u8(50));
                p.set_param("patch_amp_middle", ParamValue::from_u8(60));
                p.set_param("patch_amp_treble", ParamValue::from_u8(55));
                p.set_param("patch_amp_presence", ParamValue::from_u8(50));
                p.set_param("patch_sw_booster_sw", ParamValue::from_u8(1));
                p.set_param("patch_booster_drive_slot1", ParamValue::from_u8(35));
                p.set_param("patch_booster_effect_level_slot1", ParamValue::from_u8(55));
            },
        )?;
        created += 1;

        mk(
            "High Gain Lead",
            "Tight low-end, singing leads.",
            &["High Gain", "Lead"],
            |p| {
                p.set_param("patch_amp_gain", ParamValue::from_u8(80));
                p.set_param("patch_amp_volume", ParamValue::from_u8(65));
                p.set_param("patch_amp_bass", ParamValue::from_u8(45));
                p.set_param("patch_amp_middle", ParamValue::from_u8(55));
                p.set_param("patch_amp_treble", ParamValue::from_u8(60));
                p.set_param("patch_amp_presence", ParamValue::from_u8(55));
                p.set_param("patch_sw_delay_sw", ParamValue::from_u8(1));
                p.set_param("patch_delay_effect_level_slot1", ParamValue::from_u8(32));
            },
        )?;
        created += 1;

        mk(
            "Doom Wall",
            "Slow, huge, and dark.",
            &["Doom", "High Gain"],
            |p| {
                p.set_param("patch_amp_gain", ParamValue::from_u8(90));
                p.set_param("patch_amp_volume", ParamValue::from_u8(55));
                p.set_param("patch_amp_bass", ParamValue::from_u8(70));
                p.set_param("patch_amp_middle", ParamValue::from_u8(45));
                p.set_param("patch_amp_treble", ParamValue::from_u8(40));
                p.set_param("patch_amp_presence", ParamValue::from_u8(35));
                p.set_param("patch_sw_reverb_sw", ParamValue::from_u8(1));
                p.set_param("patch_reverb_effect_level_slot1", ParamValue::from_u8(45));
            },
        )?;
        created += 1;

        mk(
            "Ambient Pad",
            "Shimmer-ish wash (placeholder).",
            &["Ambient"],
            |p| {
                p.set_param("patch_amp_gain", ParamValue::from_u8(30));
                p.set_param("patch_amp_volume", ParamValue::from_u8(55));
                p.set_param("patch_sw_delay_sw", ParamValue::from_u8(1));
                p.set_param("patch_delay_effect_level_slot1", ParamValue::from_u8(45));
                p.set_param("patch_sw_reverb_sw", ParamValue::from_u8(1));
                p.set_param("patch_reverb_effect_level_slot1", ParamValue::from_u8(55));
            },
        )?;
        created += 1;

        Ok(created)
    })
}
