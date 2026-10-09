mod agent;
mod commands;
mod livesets;
mod logging;
mod mcp_server;
mod state;

use agent::AgentRuntime;
use state::AppState;
use tauri::Manager;
use toneforge_library::ToneLibrary;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            logging::set_app_handle(app.handle().clone());
            let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
            logging::init(&log_dir);

            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let dev_mode = commands::restore_dev_mode(&data_dir);
            tracing::info!(dev_mode, "developer mode restored");

            let db_path = data_dir.join("toneforge.db");
            let library = ToneLibrary::open(&db_path).map_err(|e| e.to_string())?;
            tracing::info!(path = %db_path.display(), "tone library opened");

            app.manage(AppState::new(library));
            app.manage(AgentRuntime::default());
            mcp_server::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_devices,
            commands::connect_device,
            commands::disconnect_device,
            commands::get_connection_status,
            commands::list_channels,
            commands::select_channel,
            commands::read_patch,
            commands::get_cached_patch,
            commands::set_param,
            commands::list_editable_params,
            commands::get_log_path,
            commands::list_library_tones,
            commands::get_library_tone,
            commands::save_library_tone,
            commands::delete_library_tone,
            commands::rename_library_tone,
            commands::update_library_tone_patch,
            commands::load_library_tone,
            commands::import_library_tone_from_amp,
            commands::import_library_file,
            commands::export_library_tone,
            commands::list_livesets,
            commands::get_liveset,
            commands::create_liveset,
            commands::rename_liveset,
            commands::delete_liveset,
            commands::add_tone_to_liveset,
            commands::remove_tone_from_liveset,
            commands::reorder_liveset,
            commands::export_liveset,
            commands::seed_library_demo_tones,
            commands::get_library_db_path,
            commands::get_dev_mode,
            commands::set_dev_mode,
            commands::get_agent_settings,
            commands::set_agent_settings,
            commands::agent_chat,
            commands::agent_cancel,
            commands::agent_reset,
            commands::get_agent_preferences,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
