use std::{sync::atomic::{AtomicBool, Ordering}, time::Duration};
use tauri::{ipc::Channel, Manager};
use tauri_plugin_updater::UpdaterExt;

pub struct EngineOrigin(pub String);
static INSTALLING: AtomicBool = AtomicBool::new(false);
fn trusted(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    if url.origin().ascii_serialization() != window.state::<EngineOrigin>().0 {
        return Err("허용되지 않은 업데이트 요청입니다.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn check_update(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    trusted(&window)?;
    let update = app.updater_builder().timeout(Duration::from_secs(20)).build()
        .map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(match update {
        Some(update) => serde_json::json!({"version":update.version,"notes":update.body,"current":app.package_info().version.to_string()}),
        None => serde_json::json!({"current":app.package_info().version.to_string()}),
    })
}
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, window: tauri::WebviewWindow, version: String, progress: Channel<serde_json::Value>) -> Result<(), String> {
    trusted(&window)?;
    if INSTALLING.swap(true, Ordering::SeqCst) { return Err("이미 업데이트 중입니다.".into()); }
    let result = async {
        let cleanup = app.clone();
        let update = app.updater_builder().timeout(Duration::from_secs(120))
            .on_before_exit(move || {
                if let Some(engine) = cleanup.try_state::<super::Engine>() {
                    if let Ok(mut guard) = engine.0.lock() {
                        if let Some(child) = guard.take() { super::stop_engine(child); }
                    }
                }
                cleanup.cleanup_before_exit();
            }).build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?
            .ok_or("설치할 업데이트가 없습니다.")?;
        if update.version != version { return Err("새 버전 정보가 변경되었습니다. 다시 확인하세요.".into()); }
        let mut downloaded = 0;
        let bytes = update.download(|chunk, total| {
            downloaded += chunk;
            let _ = progress.send(serde_json::json!({"downloaded":downloaded,"total":total}));
        }, || {}).await.map_err(|e| e.to_string())?;
        // download() verifies the signature before the engine is stopped.
        let _ = progress.send(serde_json::json!({"installing":true}));
        update.install(bytes).map_err(|e| e.to_string())
    }.await;
    INSTALLING.store(false, Ordering::SeqCst);
    result
}
