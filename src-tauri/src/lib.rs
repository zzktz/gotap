mod auto_launch;
mod commands;

use commands::{ClickerRuntime, CLICKER_STATUS_EVENT};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent, WindowEvent,
};

const SHOW_WINDOW_MENU_ID: &str = "show-window";
const TOGGLE_CLICKER_MENU_ID: &str = "toggle-clicker";
const QUIT_MENU_ID: &str = "quit";

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(ClickerRuntime::default())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let show_window =
                MenuItem::with_id(app, SHOW_WINDOW_MENU_ID, "显示 GoTap", true, None::<&str>)?;
            let toggle_clicker = MenuItem::with_id(
                app,
                TOGGLE_CLICKER_MENU_ID,
                "开始/停止点击",
                true,
                None::<&str>,
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, QUIT_MENU_ID, "退出 GoTap", true, None::<&str>)?;
            let tray_menu =
                Menu::with_items(app, &[&show_window, &toggle_clicker, &separator, &quit])?;
            let tray_builder = TrayIconBuilder::with_id("gotap-tray")
                .menu(&tray_menu)
                .tooltip("GoTap")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    SHOW_WINDOW_MENU_ID => show_main_window(app),
                    TOGGLE_CLICKER_MENU_ID => {
                        let _ = app.emit("tray:toggle-clicker", ());
                    }
                    QUIT_MENU_ID => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });

            #[cfg(target_os = "macos")]
            let tray_builder = tray_builder.icon(
                app.default_window_icon()
                    .cloned()
                    .expect("missing default application icon"),
            );
            #[cfg(not(target_os = "macos"))]
            let tray_builder = tray_builder.icon(
                app.default_window_icon()
                    .cloned()
                    .expect("missing default application icon"),
            );
            std::mem::forget(tray_builder.build(app)?);

            if let Some(window) = app.get_webview_window("main") {
                let window_for_events = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_for_events.hide();
                    }
                });
                let _ = window.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::control_request,
            commands::get_clicker_status,
            commands::start_clicking,
            commands::stop_clicking_command,
            commands::get_cursor_position,
            commands::open_selection_window,
            commands::load_settings,
            commands::save_settings,
            commands::set_auto_launch,
            commands::get_auto_launch_status
        ])
        .build(tauri::generate_context!())
        .expect("failed to build GoTap")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. }) {
                commands::stop_clicking(app.state::<ClickerRuntime>().inner());
                let _ = app.emit(CLICKER_STATUS_EVENT, ());
            }
        });
}
