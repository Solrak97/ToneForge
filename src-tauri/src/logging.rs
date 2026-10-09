use std::fs::OpenOptions;
use std::path::Path;
use std::sync::OnceLock;

use chrono::Local;
use tauri::{AppHandle, Emitter};
use tracing::Level;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer};

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[derive(Clone, serde::Serialize)]
pub struct DebugLogPayload {
    pub timestamp: String,
    pub level: String,
    pub target: String,
    pub message: String,
}

pub fn set_app_handle(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

pub fn init(log_dir: &Path) {
    let _ = std::fs::create_dir_all(log_dir);

    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new("toneforge=debug,toneforge_devices=debug,toneforge_core=debug")
    });

    let stderr_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .with_ansi(true);

    let file_layer = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("toneforge.log"))
        .ok()
        .map(|file| {
            tracing_subscriber::fmt::layer()
                .with_writer(std::sync::Mutex::new(file))
                .with_ansi(false)
                .with_target(true)
        });

    let tauri_layer = TauriEventLayer;

    let registry = tracing_subscriber::registry()
        .with(env_filter)
        .with(stderr_layer)
        .with(tauri_layer);

    if let Some(layer) = file_layer {
        registry.with(layer).init();
    } else {
        registry.init();
    }

    tracing::info!(log_dir = %log_dir.display(), "ToneForge logging initialized");
}

struct TauriEventLayer;

impl<S> Layer<S> for TauriEventLayer
where
    S: tracing::Subscriber,
{
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let Some(handle) = APP_HANDLE.get() else {
            return;
        };

        let metadata = event.metadata();
        let level = metadata.level();
        if *level == Level::TRACE {
            return;
        }

        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        if visitor.message.is_empty() {
            return;
        }

        let payload = DebugLogPayload {
            timestamp: Local::now().format("%H:%M:%S%.3f").to_string(),
            level: level.to_string().to_lowercase(),
            target: metadata.target().to_string(),
            message: visitor.message,
        };

        let _ = handle.emit("debug-log", payload);
    }
}

#[derive(Default)]
struct MessageVisitor {
    message: String,
}

impl tracing::field::Visit for MessageVisitor {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.message.push_str(value);
        }
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" && self.message.is_empty() {
            self.message = format!("{value:?}");
            if self.message.starts_with('"') && self.message.ends_with('"') {
                self.message = self.message[1..self.message.len() - 1].to_string();
            }
        }
    }
}

pub fn log_file_path(log_dir: &Path) -> std::path::PathBuf {
    log_dir.join("toneforge.log")
}
