mod commands;
mod logging;
mod state;

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

            let db_path = app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("toneforge.db");
            let library = ToneLibrary::open(&db_path).map_err(|e| e.to_string())?;
            tracing::info!(path = %db_path.display(), "tone library opened");

            app.manage(AppState::new(library));
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
            commands::set_param,
            commands::save_preset,
            commands::load_preset,
            commands::list_editable_params,
            commands::get_log_path,
            commands::list_library_tones,
            commands::get_library_tone,
            commands::save_library_tone,
            commands::delete_library_tone,
            commands::rename_library_tone,
            commands::load_library_tone,
            commands::get_library_db_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
