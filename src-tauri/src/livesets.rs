//! BOSS TONE STUDIO liveset (`.tsl`) files: library import and export.

use crate::state::AppState;
use serde::Serialize;
use std::path::Path;
use toneforge_core::address_map::AddressMap;
use toneforge_core::preset::Patch;
use toneforge_core::{LiveSetFile, TslPatch};
use toneforge_library::{LiveSetRecord, NewTone};

#[derive(Debug, Clone, Serialize)]
pub struct LibraryImport {
    /// Set when the file held more than one patch.
    pub liveset: Option<LiveSetRecord>,
    pub tone_ids: Vec<i64>,
}

/// Imports a `.tsl` (one tone, or a liveset of tones) or a legacy ToneForge JSON preset.
pub fn import_file(state: &AppState, path: &Path) -> Result<LibraryImport, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let file = match LiveSetFile::parse(&raw) {
        Ok(file) => file,
        Err(tsl_err) => {
            let patch = legacy_patch(&raw).ok_or_else(|| tsl_err.to_string())?;
            let record = state.with_library(|l| l.save(&file_stem(path), &patch, "", &[]))?;
            return Ok(LibraryImport {
                liveset: None,
                tone_ids: vec![record.id],
            });
        }
    };

    let tones = state.with_address_map(|map| decode_tones(map, &file))??;
    match tones.as_slice() {
        [] => Err("liveset has no patches".to_string()),
        [tone] => {
            let record = state.with_library(|l| l.save(&tone.name, &tone.patch, &tone.notes, &tone.tags))?;
            Ok(LibraryImport {
                liveset: None,
                tone_ids: vec![record.id],
            })
        }
        _ => {
            let name = non_empty(&file.name).unwrap_or_else(|| file_stem(path));
            let liveset = state.with_library(|l| l.import_liveset(&name, "", &tones))?;
            let tone_ids = liveset.tones.iter().map(|t| t.id).collect();
            Ok(LibraryImport {
                liveset: Some(liveset),
                tone_ids,
            })
        }
    }
}

pub fn export_liveset(state: &AppState, liveset_id: i64, path: &Path) -> Result<(), String> {
    let liveset = state.with_library(|l| l.get_liveset(liveset_id))?;
    let tones = state.with_library(|l| l.liveset_tones(liveset_id))?;
    let patches = state.with_address_map(|map| {
        tones
            .iter()
            .map(|tone| encode(map, &tone.patch, &tone.name, &tone.notes))
            .collect::<Result<Vec<_>, _>>()
    })??;
    write(path, &LiveSetFile::new(&liveset.name, patches))
}

pub fn export_tone(state: &AppState, tone_id: i64, path: &Path) -> Result<(), String> {
    let tone = state.with_library(|l| l.get(tone_id))?;
    let patch = state.with_address_map(|map| encode(map, &tone.patch, &tone.name, &tone.notes))??;
    write(path, &LiveSetFile::new(&tone.name, vec![patch]))
}

fn decode_tones(map: &AddressMap, file: &LiveSetFile) -> Result<Vec<NewTone>, String> {
    file.patches()
        .iter()
        .enumerate()
        .map(|(index, tsl)| {
            let patch = tsl.to_patch(map).map_err(|e| e.to_string())?;
            let name = patch
                .meta
                .name
                .as_deref()
                .and_then(non_empty)
                .unwrap_or_else(|| format!("Patch {}", index + 1));
            Ok(NewTone {
                name,
                patch,
                notes: tsl.memo_text(),
                tags: Vec::new(),
            })
        })
        .collect()
}

fn encode(map: &AddressMap, patch: &Patch, name: &str, notes: &str) -> Result<TslPatch, String> {
    let mut named = patch.clone();
    named.meta.name = Some(name.to_string());
    TslPatch::from_patch(&named, map, notes).map_err(|e| e.to_string())
}

fn legacy_patch(raw: &str) -> Option<Patch> {
    crate::state::preset_from_json(raw).ok().map(|preset| preset.patch)
}

fn write(path: &Path, file: &LiveSetFile) -> Result<(), String> {
    let json = file.to_json().map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn non_empty(text: &str) -> Option<String> {
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .and_then(non_empty)
        .unwrap_or_else(|| "Imported tone".to_string())
}
