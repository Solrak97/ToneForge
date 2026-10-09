//! OpenAI-compatible chat completions client (local Ollama + cloud).

use super::settings::{AgentMode, AgentSettings};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type", default = "default_tool_type")]
    pub kind: String,
    pub function: ToolFunction,
}

fn default_tool_type() -> String {
    "function".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone)]
pub struct ProviderEndpoint {
    pub label: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ChatMessage,
}

pub async fn resolve_endpoint(settings: &AgentSettings) -> Result<ProviderEndpoint, String> {
    match settings.mode {
        AgentMode::Cursor => Err("Cursor mode runs through the Cursor agent bridge".into()),
        AgentMode::Local => Ok(local_endpoint(settings)),
        AgentMode::Cloud => cloud_endpoint(settings),
        AgentMode::Auto => {
            let local = local_endpoint(settings);
            if probe_reachable(&local.base_url).await {
                Ok(local)
            } else {
                cloud_endpoint(settings).or_else(|cloud_err| {
                    Err(format!(
                        "local LLM unreachable at {} and cloud unavailable: {cloud_err}",
                        local.base_url
                    ))
                })
            }
        }
    }
}

fn local_endpoint(settings: &AgentSettings) -> ProviderEndpoint {
    ProviderEndpoint {
        label: "local".into(),
        base_url: trim_slash(&settings.local_base_url),
        api_key: Some("ollama".into()),
        model: settings.local_model.clone(),
    }
}

fn cloud_endpoint(settings: &AgentSettings) -> Result<ProviderEndpoint, String> {
    if settings.cloud_api_key.trim().is_empty() {
        return Err("cloud API key is not configured".into());
    }
    Ok(ProviderEndpoint {
        label: "cloud".into(),
        base_url: trim_slash(&settings.cloud_base_url),
        api_key: Some(settings.cloud_api_key.clone()),
        model: settings.cloud_model.clone(),
    })
}

fn trim_slash(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

async fn probe_reachable(base_url: &str) -> bool {
    let url = format!("{base_url}/models");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build();
    let Ok(client) = client else {
        return false;
    };
    match client.get(&url).send().await {
        Ok(resp) => resp.status().is_success() || resp.status().as_u16() == 401,
        Err(_) => false,
    }
}

pub async fn chat_completion(
    endpoint: &ProviderEndpoint,
    messages: &[ChatMessage],
    tools: &[Value],
) -> Result<ChatMessage, String> {
    let url = format!("{}/chat/completions", endpoint.base_url);
    let mut body = json!({
        "model": endpoint.model,
        "messages": messages,
        "stream": false,
    });
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools.to_vec());
        body["tool_choice"] = json!("auto");
    }

    let mut req = reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body);
    if let Some(key) = &endpoint.api_key {
        req = req.bearer_auth(key);
    }

    let resp = req.send().await.map_err(|e| format!("LLM request failed: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("LLM HTTP {status}: {text}"));
    }

    let parsed: ChatCompletionResponse =
        serde_json::from_str(&text).map_err(|e| format!("bad LLM response: {e}; body={text}"))?;
    parsed
        .choices
        .into_iter()
        .next()
        .map(|c| c.message)
        .ok_or_else(|| "LLM returned no choices".into())
}

/// Try primary endpoint; on transport/HTTP failure in Auto mode, fall back to cloud.
pub async fn chat_with_fallback(
    settings: &AgentSettings,
    messages: &[ChatMessage],
    tools: &[Value],
) -> Result<(ProviderEndpoint, ChatMessage), String> {
    let primary = resolve_endpoint(settings).await?;
    match chat_completion(&primary, messages, tools).await {
        Ok(msg) => Ok((primary, msg)),
        Err(err) if settings.mode == AgentMode::Auto && primary.label == "local" => {
            tracing::warn!(error = %err, "local LLM failed; trying cloud");
            let cloud = cloud_endpoint(settings)?;
            let msg = chat_completion(&cloud, messages, tools).await?;
            Ok((cloud, msg))
        }
        Err(err) => Err(err),
    }
}
