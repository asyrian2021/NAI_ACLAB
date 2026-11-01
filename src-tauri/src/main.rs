#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{io::{BufRead, BufReader}, process::{Child, Command, Stdio}, sync::{mpsc, Mutex}, time::Duration};
use tauri::Manager;
mod updater;

struct Engine(Mutex<Option<Child>>);
fn stop_engine(mut process: Child) {
    // Closing stdin lets Python exit and its one-file loader clean up normally.
    process.stdin.take();
    for _ in 0..60 {
        if matches!(process.try_wait(), Ok(Some(_))) { return; }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = process.kill();
    let _ = process.wait();
}
impl Drop for Engine {
    fn drop(&mut self) {
        if let Ok(child) = self.0.get_mut() {
            if let Some(process) = child.take() { stop_engine(process); }
        }
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![updater::check_update, updater::install_update])
        .setup(|app| {
            let directory = std::env::current_exe()?.parent().unwrap().to_path_buf();
            let bundled = directory.join("nai-engine.exe");
            #[cfg(not(debug_assertions))]
            let executable = bundled;
            #[cfg(debug_assertions)]
            let executable = if bundled.exists() { bundled } else {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/nai-engine-x86_64-pc-windows-msvc.exe")
            };
            let mut command = Command::new(executable);
            command.arg("--desktop").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
            #[cfg(windows)] {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let mut child = command.spawn()?;
            let stdout = child.stdout.take().unwrap();
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(move || {
                let mut line = String::new();
                let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
                let _ = tx.send(result);
            });
            let ready = rx.recv_timeout(Duration::from_secs(45));
            let line = match ready {
                Ok(Ok(line)) if !line.is_empty() => line,
                _ => { let _ = child.kill(); let _ = child.wait(); return Err("이미지 엔진을 시작하지 못했습니다. 앱을 다시 실행하세요.".into()); }
            };
            app.manage(Engine(Mutex::new(Some(child))));
            let ready: serde_json::Value = serde_json::from_str(&line)?;
            let url: tauri::Url = ready["url"].as_str().ok_or("Invalid engine address")?.parse()?;
            app.manage(updater::EngineOrigin(url.origin().ascii_serialization()));
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url))
                // Let WebView2 deliver HTML drag/drop events to the artist list.
                .disable_drag_drop_handler()
                .title("NAI ACLAB").inner_size(1440.0, 960.0).min_inner_size(880.0, 650.0)
                .visible(std::env::var_os("NAI_ACLAB_HEADLESS_TEST").is_none())
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())?;
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(engine) = handle.try_state::<Engine>() {
                if let Ok(mut locked) = engine.0.lock() {
                    if let Some(child) = locked.take() { stop_engine(child); }
                }
            }
        }
    });
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        #[cfg(windows)] unsafe {
            let message: Vec<u16> = format!("NAI ACLAB을 시작하지 못했습니다.\n\n{error}\0").encode_utf16().collect();
            let title: Vec<u16> = "NAI ACLAB\0".encode_utf16().collect();
            windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(std::ptr::null_mut(), message.as_ptr(), title.as_ptr(), 0x10);
        }
        eprintln!("{error}");
    }
}
