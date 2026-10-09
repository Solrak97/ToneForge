//! HTTP tool harness — calls the localhost ToneForge API (same as MCP).

use crate::mcp_server;
use serde_json::{json, Value};
use std::collections::HashMap;

const KEY_PARAMS: &[&str] = &[
    "patch_amp_type",
    "patch_amp_gain",
    "patch_amp_volume",
    "patch_amp_bass",
    "patch_amp_middle",
    "patch_amp_treble",
    "patch_amp_presence",
    "patch_amp_resonance",
    "patch_amp_preamp_variation",
    "patch_sw_booster_sw",
    "patch_booster_type_slot1",
    "patch_booster_drive_slot1",
    "patch_booster_effect_level_slot1",
    "patch_sw_mod_sw",
    "patch_fx_type_slot1",
    "patch_sw_fx_sw",
    "patch_fx_type_slot4",
    "patch_sw_delay_sw",
    "patch_delay_type_slot1",
    "patch_delay_time_slot1",
    "patch_delay_effect_level_slot1",
    "patch_delay_feedback_slot1",
    "patch_delay_mod_sw_slot1",
    "patch_sw_reverb_sw",
    "patch_reverb_type_slot1",
    "patch_reverb_effect_level_slot1",
    "patch_reverb_time_slot1",
    "patch_ns_sw",
    "patch_ns_threshold",
    "patch_ns_release",
];

fn api_base() -> String {
    format!("http://127.0.0.1:{}", mcp_server::mcp_port())
}

async fn http_get(path: &str) -> Result<Value, String> {
    let url = format!("{}{}", api_base(), path);
    let resp = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {status}: {text}"));
    }
    serde_json::from_str(&text).or_else(|_| Ok(json!({ "raw": text })))
}

async fn http_post(path: &str, body: Value) -> Result<Value, String> {
    let url = format!("{}{}", api_base(), path);
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {status}: {text}"));
    }
    if text.trim().is_empty() {
        return Ok(json!({ "ok": true }));
    }
    serde_json::from_str(&text).or_else(|_| Ok(json!({ "raw": text })))
}

fn summarize_patch(patch: &Value) -> Value {
    let params = patch
        .get("params")
        .and_then(|p| p.as_object())
        .cloned()
        .unwrap_or_default();
    let mut summary = serde_json::Map::new();
    for key in KEY_PARAMS {
        if let Some(v) = params.get(*key) {
            let value = v
                .get("value")
                .cloned()
                .unwrap_or_else(|| v.clone());
            summary.insert((*key).to_string(), value);
        }
    }
    json!({
        "device_model": patch.get("device_model"),
        "channel": patch.get("channel"),
        "param_count": patch.get("param_count"),
        "key_params": summary,
    })
}

pub fn openai_tool_schemas() -> Vec<Value> {
    vec![
        tool(
            "get_status",
            "Get Katana connection status (connected, port, editor mode).",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "list_devices",
            "List available MIDI device ports.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "connect",
            "Connect to a MIDI port. Omitting port_name connects to the first device.",
            json!({
                "type": "object",
                "properties": {
                    "port_name": { "type": "string", "description": "Optional MIDI port name, e.g. KATANA3" }
                },
                "additionalProperties": false
            }),
        ),
        tool(
            "disconnect",
            "Disconnect from the amp.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "get_patch",
            "Get a compact summary of the current in-memory patch (key amp/FX params only).",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "read_patch",
            "Re-read the current patch from the connected amp.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "list_params",
            "Search the wired parameter catalog by keyword.",
            json!({
                "type": "object",
                "properties": {
                    "q": { "type": "string", "description": "Search query, e.g. delay, reverb, booster" },
                    "limit": { "type": "integer", "description": "Max results (default 40)" }
                },
                "additionalProperties": false
            }),
        ),
        tool(
            "set_params",
            "Batch-write patch parameters to the amp. Prefer one call with a full tone recipe map.",
            json!({
                "type": "object",
                "properties": {
                    "params": {
                        "type": "object",
                        "description": "Map of param_id to integer value",
                        "additionalProperties": { "type": "integer" }
                    }
                },
                "required": ["params"],
                "additionalProperties": false
            }),
        ),
        tool(
            "list_channels",
            "List available amp channels (PANEL, CH1, …).",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        ),
        tool(
            "select_channel",
            "Select an amp channel by index.",
            json!({
                "type": "object",
                "properties": {
                    "channel": { "type": "integer", "description": "Channel index (0=PANEL, 1=CH1, …)" }
                },
                "required": ["channel"],
                "additionalProperties": false
            }),
        ),
        tool(
            "list_library_tones",
            "List tones in the ToneForge library.",
            json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Optional search string" }
                },
                "additionalProperties": false
            }),
        ),
        tool(
            "load_library_tone",
            "Load a library tone by id or name onto the amp.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "integer" },
                    "name": { "type": "string" },
                    "write_to_device": { "type": "boolean", "description": "Default true" },
                    "channel": { "type": "integer", "description": "Amp channel index to switch to first (see list_channels); default is the current channel" }
                },
                "additionalProperties": false
            }),
        ),
        tool(
            "save_library_tone",
            "Save the current patch into the ToneForge library.",
            json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "notes": { "type": "string" },
                    "tags": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                },
                "required": ["name"],
                "additionalProperties": false
            }),
        ),
    ]
}

fn tool(name: &str, description: &str, parameters: Value) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters
        }
    })
}

pub async fn execute_tool(name: &str, arguments: &Value) -> Result<Value, String> {
    match name {
        "get_status" => http_get("/status").await,
        "list_devices" => http_get("/devices").await,
        "connect" => {
            let port_name = arguments.get("port_name").and_then(|v| v.as_str());
            let body = match port_name {
                Some(p) if !p.is_empty() => json!({ "port_name": p }),
                _ => json!({}),
            };
            http_post("/connect", body).await
        }
        "disconnect" => http_post("/disconnect", json!({})).await,
        "get_patch" => {
            let patch = http_get("/patch").await?;
            Ok(summarize_patch(&patch))
        }
        "read_patch" => {
            let patch = http_post("/patch/read", json!({})).await?;
            Ok(summarize_patch(&patch))
        }
        "list_params" => {
            let q = arguments
                .get("q")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = arguments
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(40);
            let path = format!(
                "/params?q={}&limit={}",
                urlencoding_lite(q),
                limit.min(120)
            );
            http_get(&path).await
        }
        "set_params" => {
            let params = arguments
                .get("params")
                .cloned()
                .ok_or_else(|| "set_params requires params object".to_string())?;
            // Normalize values to i32 map for the HTTP API.
            let obj = params
                .as_object()
                .ok_or_else(|| "params must be an object".to_string())?;
            let mut map = serde_json::Map::new();
            for (k, v) in obj {
                let n = v
                    .as_i64()
                    .or_else(|| v.as_f64().map(|f| f as i64))
                    .ok_or_else(|| format!("param {k} must be a number"))?;
                map.insert(k.clone(), json!(n));
            }
            let result = http_post("/patch/params", json!({ "params": map })).await?;
            // Compact response — drop full patch dump if present.
            if let Some(updated) = result.get("updated") {
                Ok(json!({ "updated": updated, "ok": true }))
            } else {
                Ok(result)
            }
        }
        "list_channels" => http_get("/channels").await,
        "select_channel" => {
            let channel = arguments
                .get("channel")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| "channel required".to_string())?;
            let patch = http_post("/channel", json!({ "channel": channel })).await?;
            Ok(summarize_patch(&patch))
        }
        "list_library_tones" => {
            let query = arguments.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let path = if query.is_empty() {
                "/library/tones".to_string()
            } else {
                format!("/library/tones?query={}", urlencoding_lite(query))
            };
            http_get(&path).await
        }
        "load_library_tone" => {
            let mut body = serde_json::Map::new();
            if let Some(id) = arguments.get("id").and_then(|v| v.as_i64()) {
                body.insert("id".into(), json!(id));
            }
            if let Some(name) = arguments.get("name").and_then(|v| v.as_str()) {
                body.insert("name".into(), json!(name));
            }
            if let Some(w) = arguments.get("write_to_device") {
                body.insert("write_to_device".into(), w.clone());
            }
            if let Some(channel) = arguments.get("channel").and_then(|v| v.as_u64()) {
                body.insert("channel".into(), json!(channel));
            }
            let patch = http_post("/library/load", Value::Object(body)).await?;
            Ok(summarize_patch(&patch))
        }
        "save_library_tone" => {
            let name = arguments
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "name required".to_string())?;
            let notes = arguments
                .get("notes")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let tags = arguments.get("tags").cloned().unwrap_or_else(|| json!([]));
            http_post(
                "/library/save",
                json!({ "name": name, "notes": notes, "tags": tags }),
            )
            .await
        }
        other => Err(format!("unknown tool: {other}")),
    }
}

fn urlencoding_lite(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Fetch compact status + patch for system context (best-effort).
pub async fn session_snapshot() -> HashMap<String, Value> {
    let mut map = HashMap::new();
    if let Ok(status) = http_get("/status").await {
        map.insert("connection".into(), status);
    }
    if let Ok(patch) = http_get("/patch").await {
        map.insert("patch".into(), summarize_patch(&patch));
    }
    map
}
