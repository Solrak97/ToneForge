mod context;
pub mod cursor;
pub mod provider;
pub mod settings;
mod tools;

pub use provider::ChatMessage;
pub use settings::{AgentMode, AgentSettings, UserPreferences};

use context::{build_system_prompt, live_snapshot_json, select_knowledge, truncate_history};
use provider::{chat_with_fallback, ChatMessage as Msg};
use serde::Serialize;
use serde_json::{json, Value};
use settings::AgentSettings as Settings;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tools::{execute_tool, openai_tool_schemas};
use uuid::Uuid;

const MAX_TOOL_STEPS: usize = 8;

#[derive(Clone)]
pub struct AgentRuntime {
    pub cancel: Arc<AtomicBool>,
    /// Cursor agent resumed on each turn so it keeps the conversation; cleared by "Clear".
    cursor_agent_id: Arc<Mutex<Option<String>>>,
}

impl Default for AgentRuntime {
    fn default() -> Self {
        Self {
            cancel: Arc::new(AtomicBool::new(false)),
            cursor_agent_id: Arc::new(Mutex::new(None)),
        }
    }
}

impl AgentRuntime {
    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub fn reset_cancel(&self) {
        self.cancel.store(false, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    pub fn cursor_agent_id(&self) -> Option<String> {
        self.cursor_agent_id.lock().ok().and_then(|id| id.clone())
    }

    pub fn set_cursor_agent_id(&self, agent_id: Option<String>) {
        if let Ok(mut id) = self.cursor_agent_id.lock() {
            *id = agent_id;
        }
    }
}

#[derive(Clone, Serialize)]
pub struct AgentTokenPayload {
    pub run_id: String,
    pub text: String,
}

#[derive(Clone, Serialize)]
pub struct AgentToolPayload {
    pub run_id: String,
    pub name: String,
    pub arguments: Value,
    pub result_summary: String,
    pub ok: bool,
}

#[derive(Clone, Serialize)]
pub struct AgentDonePayload {
    pub run_id: String,
    pub provider: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
pub struct AgentErrorPayload {
    pub run_id: String,
    pub error: String,
}

pub async fn run_agent_chat(
    app: AppHandle,
    runtime: AgentRuntime,
    settings: Settings,
    mut history: Vec<Msg>,
) -> Result<String, String> {
    runtime.reset_cancel();
    let run_id = Uuid::new_v4().to_string();

    let last_user = history
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .and_then(|m| m.content.clone())
        .unwrap_or_default();

    let snapshot = live_snapshot_json().await;
    let knowledge = select_knowledge(&last_user);
    let system = build_system_prompt(&settings, &snapshot, &knowledge);

    // Prepend fresh system message; drop prior system messages.
    history.retain(|m| m.role != "system");
    let mut messages = vec![Msg {
        role: "system".into(),
        content: Some(system),
        name: None,
        tool_call_id: None,
        tool_calls: None,
    }];
    messages.extend(history);
    messages = truncate_history(messages);

    let tools = openai_tool_schemas();
    let mut used_provider;

    for step in 0..MAX_TOOL_STEPS {
        if runtime.is_cancelled() {
            let _ = app.emit(
                "agent-error",
                AgentErrorPayload {
                    run_id: run_id.clone(),
                    error: "cancelled".into(),
                },
            );
            return Err("cancelled".into());
        }

        let (endpoint, assistant) =
            match chat_with_fallback(&settings, &messages, &tools).await {
                Ok(v) => v,
                Err(err) => {
                    let _ = app.emit(
                        "agent-error",
                        AgentErrorPayload {
                            run_id: run_id.clone(),
                            error: err.clone(),
                        },
                    );
                    return Err(err);
                }
            };
        used_provider = endpoint.label;

        let tool_calls = assistant.tool_calls.clone().unwrap_or_default();
        if tool_calls.is_empty() {
            let text = assistant.content.clone().unwrap_or_default();
            let _ = app.emit(
                "agent-token",
                AgentTokenPayload {
                    run_id: run_id.clone(),
                    text: text.clone(),
                },
            );
            let _ = app.emit(
                "agent-done",
                AgentDonePayload {
                    run_id: run_id.clone(),
                    provider: used_provider,
                    message: text.clone(),
                },
            );
            return Ok(text);
        }

        messages.push(assistant);

        for call in tool_calls {
            if runtime.is_cancelled() {
                return Err("cancelled".into());
            }

            let args: Value = serde_json::from_str(&call.function.arguments)
                .unwrap_or_else(|_| json!({}));
            let result = execute_tool(&call.function.name, &args).await;
            let (ok, result_value) = match result {
                Ok(v) => (true, v),
                Err(e) => (false, json!({ "error": e })),
            };
            let summary = truncate_str(&result_value.to_string(), 800);
            let _ = app.emit(
                "agent-tool",
                AgentToolPayload {
                    run_id: run_id.clone(),
                    name: call.function.name.clone(),
                    arguments: args,
                    result_summary: summary.clone(),
                    ok,
                },
            );

            messages.push(Msg {
                role: "tool".into(),
                content: Some(result_value.to_string()),
                name: None,
                tool_call_id: Some(call.id),
                tool_calls: None,
            });
        }

        tracing::debug!(step, "agent tool step complete");
    }

    let err = "agent exceeded max tool steps".to_string();
    let _ = app.emit(
        "agent-error",
        AgentErrorPayload {
            run_id,
            error: err.clone(),
        },
    );
    Err(err)
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}
