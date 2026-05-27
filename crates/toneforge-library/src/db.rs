use crate::error::LibraryError;
use crate::models::{ToneRecord, ToneSummary};
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;
use toneforge_core::{Patch, PresetFile};

const MIGRATION_V1: &str = "
CREATE TABLE IF NOT EXISTS tones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    device_family TEXT NOT NULL,
    device_model TEXT NOT NULL,
    channel INTEGER,
    patch_json TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tones_name ON tones(name);
CREATE INDEX IF NOT EXISTS idx_tones_device_model ON tones(device_model);
";

pub struct ToneLibrary {
    conn: Mutex<Connection>,
}

impl ToneLibrary {
    pub fn open(path: &Path) -> Result<Self, LibraryError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(MIGRATION_V1)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn open_in_memory() -> Result<Self, LibraryError> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(MIGRATION_V1)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn list(&self, query: Option<&str>) -> Result<Vec<ToneSummary>, LibraryError> {
        let conn = self.conn.lock().expect("library db lock");
        let mut sql = String::from(
            "SELECT id, name, device_model, channel, tags, notes, created_at, updated_at \
             FROM tones",
        );
        if let Some(q) = query.map(str::trim).filter(|q| !q.is_empty()) {
            sql.push_str(" WHERE name LIKE ?1 OR notes LIKE ?1 OR tags LIKE ?1");
            sql.push_str(" ORDER BY updated_at DESC, id DESC");
            let pattern = format!("%{q}%");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([pattern], map_summary_row)?;
            return rows.collect::<Result<Vec<_>, _>>().map_err(LibraryError::from);
        }
        sql.push_str(" ORDER BY updated_at DESC, id DESC");

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], map_summary_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(LibraryError::from)
    }

    pub fn get(&self, id: i64) -> Result<ToneRecord, LibraryError> {
        let conn = self.conn.lock().expect("library db lock");
        conn.query_row(
            "SELECT id, name, device_family, device_model, channel, patch_json, tags, notes, created_at, updated_at \
             FROM tones WHERE id = ?1",
            params![id],
            map_record_row,
        )
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => LibraryError::NotFound(id),
            other => LibraryError::from(other),
        })
    }

    pub fn save(
        &self,
        name: &str,
        patch: &Patch,
        notes: &str,
        tags: &[String],
    ) -> Result<ToneRecord, LibraryError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(LibraryError::InvalidName);
        }

        let now = now_iso8601();
        let patch_json = serde_json::to_string(&PresetFile::from_patch(patch.clone()))?;
        let tags_json = serde_json::to_string(tags)?;

        let conn = self.conn.lock().expect("library db lock");
        conn.execute(
            "INSERT INTO tones (name, device_family, device_model, channel, patch_json, tags, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                name,
                patch.meta.device_family,
                patch.meta.device_model,
                patch.meta.channel,
                patch_json,
                tags_json,
                notes,
                now,
                now,
            ],
        )?;
        let id = conn.last_insert_rowid();
        drop(conn);
        self.get(id)
    }

    pub fn delete(&self, id: i64) -> Result<(), LibraryError> {
        let conn = self.conn.lock().expect("library db lock");
        let changed = conn.execute("DELETE FROM tones WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(LibraryError::NotFound(id));
        }
        Ok(())
    }

    pub fn update_name(&self, id: i64, name: &str) -> Result<ToneRecord, LibraryError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(LibraryError::InvalidName);
        }
        let now = now_iso8601();
        let conn = self.conn.lock().expect("library db lock");
        let changed = conn.execute(
            "UPDATE tones SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, id],
        )?;
        if changed == 0 {
            return Err(LibraryError::NotFound(id));
        }
        drop(conn);
        self.get(id)
    }
}

fn map_summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ToneSummary> {
    let tags_raw: String = row.get(4)?;
    Ok(ToneSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        device_model: row.get(2)?,
        channel: row.get(3)?,
        tags: parse_tags(&tags_raw),
        notes: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn map_record_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ToneRecord> {
    let patch_json: String = row.get(5)?;
    let tags_raw: String = row.get(6)?;
    let preset: PresetFile = serde_json::from_str(&patch_json).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(
            5,
            rusqlite::types::Type::Text,
            Box::new(err),
        )
    })?;
    Ok(ToneRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        device_family: row.get(2)?,
        device_model: row.get(3)?,
        channel: row.get(4)?,
        patch: preset.patch,
        tags: parse_tags(&tags_raw),
        notes: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn parse_tags(raw: &str) -> Vec<String> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use toneforge_core::ParamValue;

    fn sample_patch() -> Patch {
        let mut patch = Patch::new("boss-katana", "katana-gen3");
        patch.meta.channel = Some(1);
        patch.meta.name = Some("Test".into());
        patch.set_param("patch_amp_gain", ParamValue::from_u8(75));
        patch
    }

    #[test]
    fn save_list_get_delete_roundtrip() {
        let library = ToneLibrary::open_in_memory().expect("memory db");
        let saved = library
            .save("Crunch Lead", &sample_patch(), "test note", &["crunch".into()])
            .expect("save");

        let listed = library.list(None).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Crunch Lead");

        let loaded = library.get(saved.id).expect("get");
        assert_eq!(loaded.patch.get_param_u8("patch_amp_gain"), Some(75));

        library.delete(saved.id).expect("delete");
        assert!(library.get(saved.id).is_err());
    }

    #[test]
    fn search_by_name() {
        let library = ToneLibrary::open_in_memory().expect("memory db");
        library
            .save("Clean Room", &sample_patch(), "", &[])
            .expect("save");
        library
            .save("Heavy Gain", &sample_patch(), "", &[])
            .expect("save");

        let hits = library.list(Some("clean")).expect("search");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "Clean Room");
    }
}
