use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    #[default]
    Cursor,
    Auto,
    Local,
    Cloud,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserPreferences {
    /// Preferred amp volume range (inclusive).
    pub preferred_volume_min: u8,
    pub preferred_volume_max: u8,
    /// Avoid tape echo / delay mod / heavy chorus wobble.
    pub avoid_wobble_fx: bool,
    /// Free-form notes (pickups, guitar, room, etc.).
    pub notes: String,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            preferred_volume_min: 8,
            preferred_volume_max: 25,
            avoid_wobble_fx: true,
            notes: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AgentSettings {
    pub mode: AgentMode,
    /// Empty means fall back to the `CURSOR_API_KEY` environment variable.
    pub cursor_api_key: String,
    pub cursor_model: String,
    pub local_base_url: String,
    pub local_model: String,
    pub cloud_base_url: String,
    pub cloud_api_key: String,
    pub cloud_model: String,
    pub preferences: UserPreferences,
}

impl Default for AgentSettings {
    fn default() -> Self {
        Self {
            mode: AgentMode::Cursor,
            cursor_api_key: String::new(),
            cursor_model: "composer-2.5".into(),
            local_base_url: "http://127.0.0.1:11434/v1".into(),
            local_model: "llama3.2".into(),
            cloud_base_url: "https://api.openai.com/v1".into(),
            cloud_api_key: String::new(),
            cloud_model: "gpt-4o-mini".into(),
            preferences: UserPreferences::default(),
        }
    }
}

pub fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("agent_settings.json")
}

pub fn load_settings(app_data_dir: &Path) -> Result<AgentSettings, String> {
    let path = settings_path(app_data_dir);
    if !path.exists() {
        return Ok(AgentSettings::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("invalid agent settings: {e}"))
}

pub fn save_settings(app_data_dir: &Path, settings: &AgentSettings) -> Result<(), String> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let path = settings_path(app_data_dir);
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())
}
