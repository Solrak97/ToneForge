use crate::error::LibraryError;
use crate::models::{
    LiveSetRecord, LiveSetSummary, NewTone, ToneRecord, ToneSummary, PREVIEW_PARAM_IDS,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeMap;
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

const MIGRATION_V2: &str = "
CREATE TABLE IF NOT EXISTS livesets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS liveset_tones (
    liveset_id INTEGER NOT NULL,
    tone_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (liveset_id, tone_id)
);
CREATE INDEX IF NOT EXISTS idx_liveset_tones_tone ON liveset_tones(tone_id);
";

const TONE_SUMMARY_COLUMNS: &str =
    "t.id, t.name, t.device_model, t.channel, t.tags, t.notes, t.created_at, t.updated_at, t.patch_json";

pub struct ToneLibrary {
    conn: Mutex<Connection>,
}

impl ToneLibrary {
    pub fn open(path: &Path) -> Result<Self, LibraryError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Self::with_connection(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self, LibraryError> {
        Self::with_connection(Connection::open_in_memory()?)
    }

    fn with_connection(conn: Connection) -> Result<Self, LibraryError> {
        conn.execute_batch(MIGRATION_V1)?;
        conn.execute_batch(MIGRATION_V2)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn list(&self, query: Option<&str>) -> Result<Vec<ToneSummary>, LibraryError> {
        let conn = self.conn.lock().expect("library db lock");
        let mut sql = String::from(
            "SELECT id, name, device_model, channel, tags, notes, created_at, updated_at, patch_json \
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
        let conn = self.conn.lock().expect("library db lock");
        let id = insert_tone(&conn, name, patch, notes, tags)?;
        drop(conn);
        self.get(id)
    }

    pub fn delete(&self, id: i64) -> Result<(), LibraryError> {
        let conn = self.conn.lock().expect("library db lock");
        let changed = conn.execute("DELETE FROM tones WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(LibraryError::NotFound(id));
        }
        conn.execute("DELETE FROM liveset_tones WHERE tone_id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_livesets(&self) -> Result<Vec<LiveSetSummary>, LibraryError> {
        let conn = self.conn.lock().expect("library db lock");
        let mut stmt = conn.prepare(
            "SELECT l.id, l.name, l.notes, COUNT(lt.tone_id), l.created_at, l.updated_at
             FROM livesets l LEFT JOIN liveset_tones lt ON lt.liveset_id = l.id
             GROUP BY l.id ORDER BY l.name COLLATE NOCASE, l.id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(LiveSetSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                notes: row.get(2)?,
                tone_count: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(LibraryError::from)
    }

    pub fn get_liveset(&self, id: i64) -> Result<LiveSetRecord, LibraryError> {
        let conn = self.conn.lock().expect("library db lock");
        let (name, notes, created_at, updated_at) = conn
            .query_row(
                "SELECT name, notes, created_at, updated_at FROM livesets WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?
            .ok_or(LibraryError::LiveSetNotFound(id))?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {TONE_SUMMARY_COLUMNS} FROM liveset_tones lt JOIN tones t ON t.id = lt.tone_id
             WHERE lt.liveset_id = ?1 ORDER BY lt.position"
        ))?;
        let tones = stmt
            .query_map(params![id], map_summary_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(LiveSetRecord {
            id,
            name,
            notes,
            tones,
            created_at,
            updated_at,
        })
    }

    pub fn create_liveset(&self, name: &str, notes: &str) -> Result<LiveSetRecord, LibraryError> {
        let conn = self.conn.lock().expect("library db lock");
        let id = insert_liveset(&conn, name, notes)?;
        drop(conn);
        self.get_liveset(id)
    }

    pub fn rename_liveset(&self, id: i64, name: &str) -> Result<LiveSetRecord, LibraryError> {
        let name = valid_name(name)?;
        let conn = self.conn.lock().expect("library db lock");
        let changed = conn.execute(
            "UPDATE livesets SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now_iso8601(), id],
        )?;
        if changed == 0 {
            return Err(LibraryError::LiveSetNotFound(id));
        }
        drop(conn);
        self.get_liveset(id)
    }

    /// Deletes the bank only; its tones stay in the library.
    pub fn delete_liveset(&self, id: i64) -> Result<(), LibraryError> {
        let conn = self.conn.lock().expect("library db lock");
        if conn.execute("DELETE FROM livesets WHERE id = ?1", params![id])? == 0 {
            return Err(LibraryError::LiveSetNotFound(id));
        }
        conn.execute("DELETE FROM liveset_tones WHERE liveset_id = ?1", params![id])?;
        Ok(())
    }

    pub fn add_tone_to_liveset(&self, liveset_id: i64, tone_id: i64) -> Result<LiveSetRecord, LibraryError> {
        let conn = self.conn.lock().expect("library db lock");
        ensure_liveset(&conn, liveset_id)?;
        ensure_tone(&conn, tone_id)?;
        append_to_liveset(&conn, liveset_id, tone_id)?;
        touch_liveset(&conn, liveset_id)?;
        drop(conn);
        self.get_liveset(liveset_id)
    }

    pub fn remove_tone_from_liveset(
        &self,
        liveset_id: i64,
        tone_id: i64,
    ) -> Result<LiveSetRecord, LibraryError> {
        let conn = self.conn.lock().expect("library db lock");
        ensure_liveset(&conn, liveset_id)?;
        conn.execute(
            "DELETE FROM liveset_tones WHERE liveset_id = ?1 AND tone_id = ?2",
            params![liveset_id, tone_id],
        )?;
        touch_liveset(&conn, liveset_id)?;
        drop(conn);
        self.get_liveset(liveset_id)
    }

    /// Sets the bank order; ids that aren't in the liveset are ignored.
    pub fn reorder_liveset(&self, liveset_id: i64, tone_ids: &[i64]) -> Result<LiveSetRecord, LibraryError> {
        let mut conn = self.conn.lock().expect("library db lock");
        ensure_liveset(&conn, liveset_id)?;
        let tx = conn.transaction()?;
        for (position, tone_id) in tone_ids.iter().enumerate() {
            tx.execute(
                "UPDATE liveset_tones SET position = ?1 WHERE liveset_id = ?2 AND tone_id = ?3",
                params![position as i64, liveset_id, tone_id],
            )?;
        }
        touch_liveset(&tx, liveset_id)?;
        tx.commit()?;
        drop(conn);
        self.get_liveset(liveset_id)
    }

    /// Creates the tones and a liveset holding them, in order, atomically.
    pub fn import_liveset(
        &self,
        name: &str,
        notes: &str,
        tones: &[NewTone],
    ) -> Result<LiveSetRecord, LibraryError> {
        let mut conn = self.conn.lock().expect("library db lock");
        let tx = conn.transaction()?;
        let liveset_id = insert_liveset(&tx, name, notes)?;
        for tone in tones {
            let tone_id = insert_tone(&tx, &tone.name, &tone.patch, &tone.notes, &tone.tags)?;
            append_to_liveset(&tx, liveset_id, tone_id)?;
        }
        tx.commit()?;
        drop(conn);
        self.get_liveset(liveset_id)
    }

    /// Full records of a liveset's tones, in bank order.
    pub fn liveset_tones(&self, liveset_id: i64) -> Result<Vec<ToneRecord>, LibraryError> {
        self.get_liveset(liveset_id)?
            .tones
            .iter()
            .map(|tone| self.get(tone.id))
            .collect()
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

    pub fn update_patch(&self, id: i64, patch: &Patch) -> Result<ToneRecord, LibraryError> {
        let patch_json = serde_json::to_string(&PresetFile::from_patch(patch.clone()))?;
        let conn = self.conn.lock().expect("library db lock");
        let changed = conn.execute(
            "UPDATE tones SET patch_json = ?1, device_model = ?2, updated_at = ?3 WHERE id = ?4",
            params![patch_json, patch.meta.device_model, now_iso8601(), id],
        )?;
        if changed == 0 {
            return Err(LibraryError::NotFound(id));
        }
        drop(conn);
        self.get(id)
    }

    pub fn is_empty(&self) -> Result<bool, LibraryError> {
        let conn = self.conn.lock().expect("library db lock");
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM tones", [], |row| row.get(0))?;
        Ok(count == 0)
    }
}

fn valid_name(name: &str) -> Result<&str, LibraryError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(LibraryError::InvalidName);
    }
    Ok(name)
}

fn insert_tone(
    conn: &Connection,
    name: &str,
    patch: &Patch,
    notes: &str,
    tags: &[String],
) -> Result<i64, LibraryError> {
    let name = valid_name(name)?;
    let now = now_iso8601();
    let patch_json = serde_json::to_string(&PresetFile::from_patch(patch.clone()))?;
    let tags_json = serde_json::to_string(tags)?;
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
    Ok(conn.last_insert_rowid())
}

fn insert_liveset(conn: &Connection, name: &str, notes: &str) -> Result<i64, LibraryError> {
    let name = valid_name(name)?;
    let now = now_iso8601();
    conn.execute(
        "INSERT INTO livesets (name, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![name, notes, now, now],
    )?;
    Ok(conn.last_insert_rowid())
}

fn append_to_liveset(conn: &Connection, liveset_id: i64, tone_id: i64) -> Result<(), LibraryError> {
    conn.execute(
        "INSERT OR IGNORE INTO liveset_tones (liveset_id, tone_id, position)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(position), -1) + 1 FROM liveset_tones WHERE liveset_id = ?1))",
        params![liveset_id, tone_id],
    )?;
    Ok(())
}

fn touch_liveset(conn: &Connection, liveset_id: i64) -> Result<(), LibraryError> {
    conn.execute(
        "UPDATE livesets SET updated_at = ?1 WHERE id = ?2",
        params![now_iso8601(), liveset_id],
    )?;
    Ok(())
}

fn ensure_liveset(conn: &Connection, id: i64) -> Result<(), LibraryError> {
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM livesets WHERE id = ?1)", params![id], |r| r.get(0))?;
    exists.then_some(()).ok_or(LibraryError::LiveSetNotFound(id))
}

fn ensure_tone(conn: &Connection, id: i64) -> Result<(), LibraryError> {
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM tones WHERE id = ?1)", params![id], |r| r.get(0))?;
    exists.then_some(()).ok_or(LibraryError::NotFound(id))
}

fn map_summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ToneSummary> {
    let tags_raw: String = row.get(4)?;
    let patch_json: String = row.get(8)?;
    Ok(ToneSummary {
        preview: preview_params(&patch_json),
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

/// Values of [`PREVIEW_PARAM_IDS`] in a stored preset; a preset that fails to parse previews as empty.
fn preview_params(patch_json: &str) -> BTreeMap<String, i32> {
    let Ok(preset) = serde_json::from_str::<PresetFile>(patch_json) else {
        return BTreeMap::new();
    };
    PREVIEW_PARAM_IDS
        .iter()
        .filter_map(|id| {
            let value = preset.patch.params.get(*id)?.as_i32()?;
            Some(((*id).to_string(), value))
        })
        .collect()
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

        let mut edited = loaded.patch.clone();
        edited.set_param("patch_amp_gain", ParamValue::from_u8(40));
        let updated = library.update_patch(saved.id, &edited).expect("update patch");
        assert_eq!(updated.patch.get_param_u8("patch_amp_gain"), Some(40));
        assert_eq!(updated.name, "Crunch Lead");

        library.delete(saved.id).expect("delete");
        assert!(library.get(saved.id).is_err());
    }

    #[test]
    fn summaries_carry_chain_preview() {
        let library = ToneLibrary::open_in_memory().expect("memory db");
        let mut patch = sample_patch();
        patch.set_param("patch_amp_type", ParamValue::from_u8(3));
        patch.set_param("patch_sw_delay_sw", ParamValue::from_u8(1));
        patch.set_param("patch_color_delay_color", ParamValue::from_u8(2));
        let saved = library.save("Chain", &patch, "", &[]).expect("save");
        let set = library.create_liveset("Set", "").expect("liveset");
        library.add_tone_to_liveset(set.id, saved.id).expect("add");

        let listed = library.list(None).expect("list");
        let preview = &listed[0].preview;
        assert_eq!(preview.get("patch_amp_type"), Some(&3));
        assert_eq!(preview.get("patch_sw_delay_sw"), Some(&1));
        assert_eq!(preview.get("patch_color_delay_color"), Some(&2));
        assert!(!preview.contains_key("patch_amp_gain"));

        let in_set = library.get_liveset(set.id).expect("get liveset");
        assert_eq!(&in_set.tones[0].preview, preview);
    }

    #[test]
    fn import_from_preset_json() {
        let library = ToneLibrary::open_in_memory().expect("memory db");
        let preset = PresetFile::from_patch(sample_patch());
        let json = serde_json::to_string(&preset).expect("json");
        let parsed: PresetFile = serde_json::from_str(&json).expect("parse");
        let saved = library
            .save("Imported", &parsed.patch, "from file", &[])
            .expect("save");
        assert_eq!(saved.name, "Imported");
        assert_eq!(saved.notes, "from file");
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

    fn names(liveset: &LiveSetRecord) -> Vec<&str> {
        liveset.tones.iter().map(|t| t.name.as_str()).collect()
    }

    #[test]
    fn liveset_membership_and_order() {
        let library = ToneLibrary::open_in_memory().expect("memory db");
        let a = library.save("A", &sample_patch(), "", &[]).expect("a");
        let b = library.save("B", &sample_patch(), "", &[]).expect("b");
        let c = library.save("C", &sample_patch(), "", &[]).expect("c");
        let set = library.create_liveset("Gig", "").expect("create");

        for tone in [&a, &b, &c, &a] {
            library.add_tone_to_liveset(set.id, tone.id).expect("add");
        }
        assert_eq!(names(&library.get_liveset(set.id).unwrap()), ["A", "B", "C"]);

        let reordered = library.reorder_liveset(set.id, &[c.id, a.id, b.id]).expect("reorder");
        assert_eq!(names(&reordered), ["C", "A", "B"]);

        let removed = library.remove_tone_from_liveset(set.id, a.id).expect("remove");
        assert_eq!(names(&removed), ["C", "B"]);
        assert!(library.get(a.id).is_ok(), "removing from a liveset keeps the tone");

        let other = library.create_liveset("Practice", "").expect("create");
        library.add_tone_to_liveset(other.id, b.id).expect("add");
        library.delete(b.id).expect("delete tone");
        assert_eq!(names(&library.get_liveset(set.id).unwrap()), ["C"]);
        assert!(library.get_liveset(other.id).unwrap().tones.is_empty());

        let summaries = library.list_livesets().expect("list");
        assert_eq!(summaries.iter().map(|s| s.tone_count).collect::<Vec<_>>(), [1, 0]);

        library.delete_liveset(set.id).expect("delete liveset");
        assert!(library.get(c.id).is_ok(), "deleting a liveset keeps its tones");
        assert!(matches!(
            library.get_liveset(set.id),
            Err(LibraryError::LiveSetNotFound(_))
        ));
    }

    #[test]
    fn import_liveset_creates_tones_in_order() {
        let library = ToneLibrary::open_in_memory().expect("memory db");
        let tones: Vec<NewTone> = ["One", "Two", "Three"]
            .into_iter()
            .map(|name| NewTone {
                name: name.into(),
                patch: sample_patch(),
                notes: format!("{name} memo"),
                tags: vec![],
            })
            .collect();
        let set = library.import_liveset("Blues", "", &tones).expect("import");
        assert_eq!(names(&set), ["One", "Two", "Three"]);
        assert_eq!(library.liveset_tones(set.id).unwrap()[1].notes, "Two memo");
        assert_eq!(library.list(None).unwrap().len(), 3);
    }

    #[test]
    fn import_liveset_is_atomic() {
        let library = ToneLibrary::open_in_memory().expect("memory db");
        let bad = NewTone {
            name: "  ".into(),
            patch: sample_patch(),
            notes: String::new(),
            tags: vec![],
        };
        let good = NewTone { name: "Fine".into(), ..bad.clone() };
        assert!(library.import_liveset("Broken", "", &[good, bad]).is_err());
        assert!(library.list(None).unwrap().is_empty());
        assert!(library.list_livesets().unwrap().is_empty());
    }
}
