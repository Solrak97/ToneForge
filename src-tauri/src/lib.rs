mod commands;
mod logging;
mod state;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            logging::set_app_handle(app.handle().clone());
            let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
            logging::init(&log_dir);
            Ok(())
        })
        .manage(AppState::default())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
