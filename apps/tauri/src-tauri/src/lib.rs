use std::fs;

/// Read an image file from disk and return its raw bytes. The web app
/// then decodes + runs the pipeline on those bytes via the WASM worker.
#[tauri::command]
fn load_image_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("failed to read {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![load_image_bytes])
        .run(tauri::generate_context!())
        .expect("error while running pattern-detector tauri application");
}
