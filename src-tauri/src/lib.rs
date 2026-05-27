mod commands;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_devices,
            commands::connect_device,
            commands::disconnect_device,
            commands::get_connection_status,
            commands::read_patch,
            commands::set_param,
            commands::save_preset,
            commands::load_preset,
            commands::list_editable_params,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
