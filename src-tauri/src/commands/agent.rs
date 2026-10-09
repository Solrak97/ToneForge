use crate::agent::{
    self, AgentMode, AgentRuntime, AgentSettings, ChatMessage as AgentChatMessage,
    UserPreferences,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

#[derive(Deserialize)]
pub struct AgentChatRequest {
    pub messages: Vec<AgentUiMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentUiMessage {
    pub role: String,
    pub content: String,
}

#[tauri::command]
pub fn get_agent_settings(app: AppHandle) -> Result<AgentSettings, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    agent::settings::load_settings(&dir)
}

#[tauri::command]
pub fn set_agent_settings(app: AppHandle, settings: AgentSettings) -> Result<AgentSettings, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    agent::settings::save_settings(&dir, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub async fn agent_chat(
    app: AppHandle,
    runtime: State<'_, AgentRuntime>,
    request: AgentChatRequest,
) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let settings = agent::settings::load_settings(&dir)?;

    let history: Vec<AgentChatMessage> = request
        .messages
        .into_iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .map(|m| AgentChatMessage {
            role: m.role,
            content: Some(m.content),
            name: None,
            tool_call_id: None,
            tool_calls: None,
        })
        .collect();

    if history.is_empty() {
        return Err("no messages".into());
    }

    if settings.mode == AgentMode::Cursor {
        let workspace = dir.join("cursor-agent");
        return agent::cursor::run_cursor_chat(
            app.clone(),
            (*runtime).clone(),
            settings,
            workspace,
            history,
        )
        .await;
    }

    agent::run_agent_chat(app.clone(), (*runtime).clone(), settings, history).await
}

#[tauri::command]
pub fn agent_cancel(runtime: State<'_, AgentRuntime>) -> Result<(), String> {
    runtime.request_cancel();
    Ok(())
}

/// Starts the next Cursor turn with a fresh agent instead of resuming the old one.
#[tauri::command]
pub fn agent_reset(runtime: State<'_, AgentRuntime>) -> Result<(), String> {
    runtime.set_cursor_agent_id(None);
    Ok(())
}

#[tauri::command]
pub fn get_agent_preferences(app: AppHandle) -> Result<UserPreferences, String> {
    Ok(get_agent_settings(app)?.preferences)
}
