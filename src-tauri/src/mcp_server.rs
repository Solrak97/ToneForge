//! Localhost HTTP API for external automation (MCP server, scripts).
//! Binds to 127.0.0.1 only. ToneForge must be running with the app open.

use crate::commands::{send_patch_to_amp, ConnectionChangedPayload, PatchUpdatedPayload};
use crate::state::AppState;
use axum::{
    extract::{Path as AxumPath, Query, State as AxumState},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use toneforge_core::preset::Patch;
use toneforge_devices::DeviceDriver;
use toneforge_library::ToneSummary;

const DEFAULT_PORT: u16 = 17352;
const POST_WRITE_SETTLE: Duration = Duration::from_millis(30);
const CHANNEL_SELECT_SETTLE: Duration = Duration::from_millis(400);

#[derive(Clone)]
struct McpApiState {
    app: AppHandle,
}

#[derive(Serialize)]
struct ApiError {
    error: String,
}

#[derive(Serialize)]
struct HealthResponse {
    ok: bool,
    service: &'static str,
    port: u16,
}

#[derive(Deserialize)]
struct ConnectBody {
    port_name: Option<String>,
}

#[derive(Deserialize)]
struct SetParamBody {
    param_id: String,
    value: i32,
}

#[derive(Deserialize)]
struct SetParamsBody {
    params: HashMap<String, i32>,
}

#[derive(Deserialize)]
struct SelectChannelBody {
    channel: u8,
}

#[derive(Deserialize)]
struct LoadToneBody {
    id: Option<i64>,
    name: Option<String>,
    write_to_device: Option<bool>,
    /// Amp channel to switch to before writing; defaults to the current one.
    channel: Option<u8>,
}

#[derive(Deserialize)]
struct SaveToneBody {
    name: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Deserialize)]
struct ImportFileBody {
    path: String,
}

#[derive(Deserialize)]
struct ExportFileBody {
    path: String,
    liveset_id: Option<i64>,
    tone_id: Option<i64>,
}

#[derive(Deserialize)]
struct LibraryQuery {
    query: Option<String>,
}

#[derive(Deserialize)]
struct ParamsQuery {
    q: Option<String>,
    limit: Option<usize>,
}

#[derive(Serialize)]
struct ParamSummary {
    id: String,
    label: String,
    group: Option<String>,
    kind: String,
    min: Option<i32>,
    max: Option<i32>,
    options: Vec<String>,
}

#[derive(Serialize)]
struct PatchSummary {
    device_model: String,
    channel: Option<u8>,
    param_count: usize,
    params: HashMap<String, serde_json::Value>,
}

impl ApiError {
    fn response(status: StatusCode, message: impl Into<String>) -> Response {
        (status, Json(ApiError { error: message.into() })).into_response()
    }
}

fn app_state(app: &AppHandle) -> Result<tauri::State<'_, AppState>, Response> {
    app.try_state::<AppState>()
        .ok_or_else(|| ApiError::response(StatusCode::SERVICE_UNAVAILABLE, "app state unavailable"))
}

fn emit_patch(app: &AppHandle, patch: Patch) {
    if let Err(e) = app.emit(
        "patch-updated",
        PatchUpdatedPayload {
            patch: patch.clone(),
        },
    ) {
        tracing::warn!(error = %e, "mcp: failed to emit patch-updated");
    }
}

fn patch_summary(patch: &Patch) -> PatchSummary {
    let params = patch
        .params
        .iter()
        .map(|(id, value)| (id.clone(), serde_json::to_value(value).unwrap_or_default()))
        .collect();
    PatchSummary {
        device_model: patch.meta.device_model.clone(),
        channel: patch.meta.channel,
        param_count: patch.params.len(),
        params,
    }
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        service: "toneforge-mcp",
        port: mcp_port(),
    })
}

async fn status(AxumState(api): AxumState<McpApiState>) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let status = state
        .connection_status()
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(status).into_response())
}

async fn list_devices(AxumState(api): AxumState<McpApiState>) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let devices = state
        .list_devices()
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(devices).into_response())
}

async fn connect(
    AxumState(api): AxumState<McpApiState>,
    Json(body): Json<ConnectBody>,
) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let port_name = match body.port_name {
        Some(name) if !name.trim().is_empty() => name,
        _ => state
            .list_devices()
            .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?
            .into_iter()
            .next()
            .map(|d| d.name)
            .ok_or_else(|| ApiError::response(StatusCode::NOT_FOUND, "no MIDI devices found"))?,
    };

    state
        .with_driver(|driver| driver.connect(&port_name))
        .map_err(|e| ApiError::response(StatusCode::BAD_REQUEST, e))?;
    state
        .set_connected(port_name.clone())
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    state
        .with_driver(|driver| driver.enter_editor_mode())
        .map_err(|e| ApiError::response(StatusCode::BAD_REQUEST, e))?;
    state
        .set_editor_mode(true)
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let patch = state
        .with_driver(|driver| driver.read_current_patch())
        .map_err(|e| ApiError::response(StatusCode::BAD_REQUEST, e))?;
    state
        .set_patch(patch.clone())
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    emit_patch(&api.app, patch.clone());

    let status = state
        .connection_status()
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::json!({
        "connection": status,
        "patch": patch_summary(&patch),
    }))
    .into_response())
}

async fn read_patch(AxumState(api): AxumState<McpApiState>) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    if !state
        .connection_status()
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?
        .connected
    {
        return Err(ApiError::response(
            StatusCode::BAD_REQUEST,
            "not connected; call POST /connect first",
        ));
    }

    let patch = state
        .with_driver(|driver| driver.read_current_patch())
        .map_err(|e| ApiError::response(StatusCode::BAD_REQUEST, e))?;
    state
        .set_patch(patch.clone())
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    emit_patch(&api.app, patch.clone());
    Ok(Json(patch_summary(&patch)).into_response())
}

async fn get_patch(AxumState(api): AxumState<McpApiState>) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let patch = state
        .last_patch()
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?
        .ok_or_else(|| ApiError::response(StatusCode::NOT_FOUND, "no patch loaded"))?;
    Ok(Json(patch_summary(&patch)).into_response())
}

async fn set_param(
    AxumState(api): AxumState<McpApiState>,
    Json(body): Json<SetParamBody>,
) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    if !state
        .connection_status()
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?
        .connected
    {
        return Err(ApiError::response(StatusCode::BAD_REQUEST, "not connected"));
    }

    state
        .with_driver(|driver| driver.write_param(&body.param_id, body.value))
        .map_err(|e| ApiError::response(StatusCode::BAD_REQUEST, e))?;
    tokio::time::sleep(POST_WRITE_SETTLE).await;

    let patch = state
        .apply_param_write(&body.param_id, body.value)
        .map_err(|e| ApiError::response(StatusCode::BAD_REQUEST, e))?;
    emit_patch(&api.app, patch.clone());

    Ok(Json(serde_json::json!({
        "param_id": body.param_id,
        "value": body.value,
        "patch": patch_summary(&patch),
    }))
    .into_response())
}

async fn set_params(
    AxumState(api): AxumState<McpApiState>,
    Json(body): Json<SetParamsBody>,
) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    if !state
        .connection_status()
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?
        .connected
    {
        return Err(ApiError::response(StatusCode::BAD_REQUEST, "not connected"));
    }
    if body.params.is_empty() {
        return Err(ApiError::response(StatusCode::BAD_REQUEST, "params map is empty"));
    }

    let mut updated: Vec<(String, i32)> = Vec::new();
    for (param_id, value) in &body.params {
        state
            .with_driver(|driver| driver.write_param(param_id, *value))
            .map_err(|e| ApiError::response(StatusCode::BAD_REQUEST, format!("{param_id}: {e}")))?;
        state
            .apply_param_write(param_id, *value)
            .map_err(|e| ApiError::response(StatusCode::BAD_REQUEST, format!("{param_id}: {e}")))?;
        updated.push((param_id.clone(), *value));
        tokio::time::sleep(POST_WRITE_SETTLE).await;
    }

    let patch = state
        .last_patch()
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?
        .ok_or_else(|| ApiError::response(StatusCode::NOT_FOUND, "no patch loaded"))?;
    emit_patch(&api.app, patch.clone());

    Ok(Json(serde_json::json!({
        "updated": updated,
        "patch": patch_summary(&patch),
    }))
    .into_response())
}

async fn list_params(
    AxumState(api): AxumState<McpApiState>,
    Query(query): Query<ParamsQuery>,
) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let limit = query.limit.unwrap_or(80).min(500);
    let q = query.q.unwrap_or_default().to_lowercase();

    let params: Vec<ParamSummary> = state
        .editable_params()
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?
        .into_iter()
        .filter(|p| {
            if !p.wired {
                return false;
            }
            if q.is_empty() {
                return true;
            }
            let hay = format!(
                "{} {} {} {:?}",
                p.id, p.label, p.group.as_deref().unwrap_or(""), p.bts_name
            )
            .to_lowercase();
            hay.contains(&q)
        })
        .take(limit)
        .map(|p| ParamSummary {
            id: p.id,
            label: p.label,
            group: p.group,
            kind: format!("{:?}", p.kind).to_lowercase(),
            min: p.min,
            max: p.max,
            options: p.options,
        })
        .collect();

    Ok(Json(params).into_response())
}

async fn list_channels(AxumState(api): AxumState<McpApiState>) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let channels = state
        .channels()
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(channels).into_response())
}

async fn select_channel(
    AxumState(api): AxumState<McpApiState>,
    Json(body): Json<SelectChannelBody>,
) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    state
        .with_driver(|driver| driver.select_channel(body.channel))
        .map_err(|e| ApiError::response(StatusCode::BAD_REQUEST, e))?;
    tokio::time::sleep(CHANNEL_SELECT_SETTLE).await;

    let patch = state
        .with_driver(|driver| driver.read_current_patch())
        .map_err(|e| ApiError::response(StatusCode::BAD_REQUEST, e))?;
    state
        .set_patch(patch.clone())
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    emit_patch(&api.app, patch.clone());
    Ok(Json(patch_summary(&patch)).into_response())
}

async fn list_library(
    AxumState(api): AxumState<McpApiState>,
    Query(query): Query<LibraryQuery>,
) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let tones: Vec<ToneSummary> = state
        .with_library(|library| library.list(query.query.as_deref()))
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(tones).into_response())
}

async fn disconnect(AxumState(api): AxumState<McpApiState>) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let _ = state.with_driver(|driver| driver.disconnect());
    state
        .set_disconnected()
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let status = state
        .connection_status()
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    if let Err(e) = api.app.emit(
        "connection-changed",
        ConnectionChangedPayload {
            status: status.clone(),
            error: None,
        },
    ) {
        tracing::warn!(error = %e, "mcp: failed to emit connection-changed");
    }
    Ok(Json(status).into_response())
}

async fn save_library_tone(
    AxumState(api): AxumState<McpApiState>,
    Json(body): Json<SaveToneBody>,
) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err(ApiError::response(
            StatusCode::BAD_REQUEST,
            "name is required",
        ));
    }
    let patch = state
        .last_patch()
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?
        .ok_or_else(|| {
            ApiError::response(
                StatusCode::BAD_REQUEST,
                "no patch loaded; read from device first",
            )
        })?;
    let record = state
        .with_library(|library| library.save(name, &patch, &body.notes, &body.tags))
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::json!({
        "id": record.id,
        "name": record.name,
        "notes": record.notes,
        "tags": record.tags,
        "device_model": record.device_model,
    }))
    .into_response())
}

async fn load_library_tone(
    AxumState(api): AxumState<McpApiState>,
    Json(body): Json<LoadToneBody>,
) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let write_to_device = body.write_to_device.unwrap_or(true);

    let tone_id = if let Some(id) = body.id {
        id
    } else if let Some(name) = body.name {
        let tones: Vec<ToneSummary> = state
            .with_library(|library| library.list(Some(&name)))
            .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
        tones
            .into_iter()
            .find(|t| t.name.eq_ignore_ascii_case(&name))
            .ok_or_else(|| ApiError::response(StatusCode::NOT_FOUND, format!("tone not found: {name}")))?
            .id
    } else {
        return Err(ApiError::response(
            StatusCode::BAD_REQUEST,
            "provide id or name",
        ));
    };

    let mut patch = state
        .with_library(|library| library.get(tone_id))
        .map_err(|e| ApiError::response(StatusCode::NOT_FOUND, e))?
        .patch;

    if write_to_device {
        send_patch_to_amp(&state, &mut patch, body.channel)
            .map_err(|e| ApiError::response(StatusCode::BAD_REQUEST, e))?;
    }

    state
        .set_patch(patch.clone())
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    emit_patch(&api.app, patch.clone());
    Ok(Json(patch_summary(&patch)).into_response())
}

async fn list_livesets(AxumState(api): AxumState<McpApiState>) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let livesets = state
        .with_library(|library| library.list_livesets())
        .map_err(|e| ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(livesets).into_response())
}

async fn get_liveset(
    AxumState(api): AxumState<McpApiState>,
    AxumPath(id): AxumPath<i64>,
) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let liveset = state
        .with_library(|library| library.get_liveset(id))
        .map_err(|e| ApiError::response(StatusCode::NOT_FOUND, e))?;
    Ok(Json(liveset).into_response())
}

async fn import_library_file(
    AxumState(api): AxumState<McpApiState>,
    Json(body): Json<ImportFileBody>,
) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let imported = crate::livesets::import_file(&state, std::path::Path::new(&body.path))
        .map_err(|e| ApiError::response(StatusCode::BAD_REQUEST, e))?;
    Ok(Json(imported).into_response())
}

async fn export_library_file(
    AxumState(api): AxumState<McpApiState>,
    Json(body): Json<ExportFileBody>,
) -> Result<Response, Response> {
    let state = app_state(&api.app)?;
    let path = std::path::Path::new(&body.path);
    let result = match (body.liveset_id, body.tone_id) {
        (Some(id), None) => crate::livesets::export_liveset(&state, id, path),
        (None, Some(id)) => crate::livesets::export_tone(&state, id, path),
        _ => {
            return Err(ApiError::response(
                StatusCode::BAD_REQUEST,
                "provide exactly one of liveset_id or tone_id",
            ))
        }
    };
    result.map_err(|e| ApiError::response(StatusCode::BAD_REQUEST, e))?;
    Ok(Json(serde_json::json!({ "path": body.path })).into_response())
}

pub fn mcp_port() -> u16 {
    std::env::var("TONEFORGE_MCP_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

pub fn start(app: AppHandle) {
    let port = mcp_port();
    tauri::async_runtime::spawn(async move {
        let api = McpApiState { app: app.clone() };
        let router = Router::new()
            .route("/health", get(health))
            .route("/status", get(status))
            .route("/devices", get(list_devices))
            .route("/connect", post(connect))
            .route("/disconnect", post(disconnect))
            .route("/patch", get(get_patch))
            .route("/patch/read", post(read_patch))
            .route("/patch/param", post(set_param))
            .route("/patch/params", post(set_params))
            .route("/params", get(list_params))
            .route("/channels", get(list_channels))
            .route("/channel", post(select_channel))
            .route("/library/tones", get(list_library))
            .route("/library/load", post(load_library_tone))
            .route("/library/save", post(save_library_tone))
            .route("/library/livesets", get(list_livesets))
            .route("/library/livesets/{id}", get(get_liveset))
            .route("/library/import", post(import_library_file))
            .route("/library/export", post(export_library_file))
            .with_state(api);

        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                tracing::error!(%e, port, "mcp: failed to bind localhost API");
                return;
            }
        };
        tracing::info!(%addr, "mcp: localhost API listening (for MCP / automation)");

        if let Err(e) = axum::serve(listener, router).await {
            tracing::error!(%e, "mcp: server stopped");
        }
    });
}
