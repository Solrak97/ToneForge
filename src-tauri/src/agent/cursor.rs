//! Cursor-agent chat: one Node bridge process (`tools/cursor-agent`) per turn.
//! The agent's only tools are the ToneForge MCP server, which drives the amp
//! through the same localhost API as the OpenAI-compatible agent.

use super::context::{build_system_prompt, live_snapshot_json, select_knowledge};
use super::provider::ChatMessage;
use super::settings::AgentSettings;
use super::{AgentDonePayload, AgentErrorPayload, AgentRuntime, AgentTokenPayload, AgentToolPayload};
use crate::mcp_server;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

const CANCEL_POLL: Duration = Duration::from_millis(200);
const TRANSCRIPT_TURNS: usize = 8;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum BridgeEvent {
    Agent {
        #[serde(rename = "agentId")]
        agent_id: String,
    },
    Text {
        text: String,
    },
    Tool {
        name: String,
        status: String,
        #[serde(default)]
        args: Value,
        #[serde(default)]
        result: Value,
    },
    Done {
        status: String,
        #[serde(default)]
        result: String,
        #[serde(default)]
        error: Option<String>,
    },
    Error {
        message: String,
    },
}

/// Bridge scripts live in the repo during development; packaged builds can point
/// `TONEFORGE_TOOLS_DIR` at a copy of `tools/`.
fn tools_dir() -> PathBuf {
    std::env::var_os("TONEFORGE_TOOLS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../tools"))
}

fn resolve_api_key(settings: &AgentSettings) -> Result<String, String> {
    let key = settings.cursor_api_key.trim();
    if !key.is_empty() {
        return Ok(key.to_string());
    }
    std::env::var("CURSOR_API_KEY")
        .ok()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .ok_or_else(|| {
            "Cursor API key not configured: add one in Agent settings or set CURSOR_API_KEY".into()
        })
}

/// A resumed agent already remembers the conversation; a fresh one gets a short
/// transcript so switching modes or restarting the app doesn't lose the thread.
fn compose_prompt(context: &str, history: &[ChatMessage], resuming: bool) -> String {
    let mut prompt = format!(
        "<toneforge_context>\n{context}\nYour tools are the ToneForge MCP tools (toneforge_*). \
         Apply tones with toneforge_set_params in a single call.\n</toneforge_context>\n\n"
    );

    let (latest, earlier) = match history.split_last() {
        Some(split) => split,
        None => return prompt,
    };

    if !resuming && !earlier.is_empty() {
        prompt.push_str("<previous_conversation>\n");
        let start = earlier.len().saturating_sub(TRANSCRIPT_TURNS);
        for message in &earlier[start..] {
            let content = message.content.as_deref().unwrap_or_default();
            prompt.push_str(&format!("{}: {}\n", message.role, content));
        }
        prompt.push_str("</previous_conversation>\n\n");
    }

    prompt.push_str(latest.content.as_deref().unwrap_or_default());
    prompt
}

fn summarize(value: &Value, max: usize) -> String {
    let text = match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    if text.chars().count() <= max {
        text
    } else {
        format!("{}…", text.chars().take(max).collect::<String>())
    }
}

pub async fn run_cursor_chat(
    app: AppHandle,
    runtime: AgentRuntime,
    settings: AgentSettings,
    workspace: PathBuf,
    history: Vec<ChatMessage>,
) -> Result<String, String> {
    runtime.reset_cancel();
    let run_id = Uuid::new_v4().to_string();
    let fail = |error: String| -> Result<String, String> {
        let _ = app.emit(
            "agent-error",
            AgentErrorPayload {
                run_id: run_id.clone(),
                error: error.clone(),
            },
        );
        Err(error)
    };

    let api_key = match resolve_api_key(&settings) {
        Ok(key) => key,
        Err(e) => return fail(e),
    };
    if let Err(e) = std::fs::create_dir_all(&workspace) {
        return fail(format!("cannot create agent workspace: {e}"));
    }

    let last_user = history
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .and_then(|m| m.content.clone())
        .unwrap_or_default();
    let snapshot = live_snapshot_json().await;
    let knowledge = select_knowledge(&last_user);
    let context = build_system_prompt(&settings, &snapshot, &knowledge);

    let agent_id = runtime.cursor_agent_id();
    let request = json!({
        "prompt": compose_prompt(&context, &history, agent_id.is_some()),
        "agentId": agent_id,
        "apiKey": api_key,
        "model": settings.cursor_model,
        "cwd": workspace,
        "mcpServerScript": tools_dir().join("mcp-server/index.mjs"),
        "toneforgeApiUrl": format!("http://127.0.0.1:{}", mcp_server::mcp_port()),
    });

    let bridge = tools_dir().join("cursor-agent/index.mjs");
    let mut child = match Command::new("node")
        .arg(&bridge)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(e) => return fail(format!("failed to start Cursor bridge (is Node installed?): {e}")),
    };

    // The request carries the API key, so it goes over stdin rather than argv.
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(request.to_string().as_bytes()).await {
            return fail(format!("failed to send request to Cursor bridge: {e}"));
        }
    }

    let stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        if let Some(mut stderr) = stderr {
            let _ = stderr.read_to_string(&mut buf).await;
        }
        buf
    });

    let Some(stdout) = child.stdout.take() else {
        return fail("Cursor bridge has no stdout".into());
    };
    let mut lines = BufReader::new(stdout).lines();
    let mut reply = String::new();
    let mut outcome: Option<Result<String, String>> = None;

    loop {
        let line = tokio::select! {
            line = lines.next_line() => line,
            _ = tokio::time::sleep(CANCEL_POLL) => {
                if runtime.is_cancelled() {
                    let _ = child.kill().await;
                    return fail("cancelled".into());
                }
                continue;
            }
        };
        let line = match line {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(e) => return fail(format!("failed reading Cursor bridge output: {e}")),
        };
        let event: BridgeEvent = match serde_json::from_str(&line) {
            Ok(event) => event,
            Err(_) => {
                tracing::debug!(line = %line, "cursor bridge: non-event output");
                continue;
            }
        };

        match event {
            BridgeEvent::Agent { agent_id } => runtime.set_cursor_agent_id(Some(agent_id)),
            BridgeEvent::Text { text } => {
                reply.push_str(&text);
                let _ = app.emit(
                    "agent-token",
                    AgentTokenPayload {
                        run_id: run_id.clone(),
                        text,
                    },
                );
            }
            BridgeEvent::Tool {
                name,
                status,
                args,
                result,
            } => {
                let _ = app.emit(
                    "agent-tool",
                    AgentToolPayload {
                        run_id: run_id.clone(),
                        name,
                        arguments: args,
                        result_summary: summarize(&result, 400),
                        ok: status == "completed",
                    },
                );
            }
            BridgeEvent::Done {
                status,
                result,
                error,
            } => {
                outcome = Some(if status == "finished" {
                    Ok(if reply.is_empty() { result } else { reply.clone() })
                } else {
                    Err(error.unwrap_or_else(|| format!("Cursor run ended with status {status}")))
                });
            }
            BridgeEvent::Error { message } => outcome = Some(Err(message)),
        }
    }

    let _ = child.wait().await;
    let stderr_text = stderr_task.await.unwrap_or_default();

    match outcome {
        Some(Ok(message)) => {
            let _ = app.emit(
                "agent-done",
                AgentDonePayload {
                    run_id: run_id.clone(),
                    provider: "cursor".into(),
                    message: message.clone(),
                },
            );
            Ok(message)
        }
        Some(Err(e)) => fail(e),
        None => {
            let detail = stderr_text.trim();
            fail(if detail.is_empty() {
                "Cursor bridge exited without a result".into()
            } else {
                format!("Cursor bridge failed: {}", summarize(&Value::String(detail.into()), 600))
            })
        }
    }
}
