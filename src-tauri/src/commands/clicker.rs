use enigo::{Button, Coordinate, Direction, Enigo, Mouse, Settings};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

pub const CLICKER_STATUS_EVENT: &str = "clicker:status";
pub const CLICKER_PROGRESS_EVENT: &str = "clicker:progress";
const MIN_INTERVAL_MS: u64 = 100;
const FIXED_PRESS_DURATION_MS: u64 = 5;
const START_DELAY_MS: u64 = 3_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClickProfile {
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    pub interval_ms: u64,
    pub press_duration_ms: u64,
    pub repeat_mode: RepeatMode,
    pub repeat_count: u64,
    pub button: ClickButton,
    #[serde(default)]
    pub click_position: ClickPosition,
    #[serde(default)]
    pub targets: Vec<ClickTarget>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClickTarget {
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    Count,
    Infinite,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ClickPosition {
    #[default]
    Center,
    Random,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ClickButton {
    Left,
    Right,
    Middle,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClickerStatus {
    pub state: String,
    pub completed: u64,
    pub target_count: Option<u64>,
    pub error: Option<String>,
}

impl Default for ClickerStatus {
    fn default() -> Self {
        Self {
            state: "idle".into(),
            completed: 0,
            target_count: None,
            error: None,
        }
    }
}

#[derive(Clone, Default)]
pub struct ClickerRuntime {
    pub status: Arc<Mutex<ClickerStatus>>,
    cancel: Arc<Mutex<Option<Arc<AtomicBool>>>>,
}

fn emit_status(app: &AppHandle, runtime: &ClickerRuntime) {
    if let Ok(status) = runtime.status.lock() {
        let _ = app.emit(CLICKER_STATUS_EVENT, status.clone());
    }
}

fn settings_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("GoTap")
        .join("settings.json")
}

fn validate(profile: &ClickProfile) -> Result<(), String> {
    if profile.x < -100_000 || profile.x > 100_000 || profile.y < -100_000 || profile.y > 100_000 {
        return Err("点击坐标超出有效范围".into());
    }
    if profile.interval_ms < MIN_INTERVAL_MS || profile.interval_ms > 86_400_000 {
        return Err("点击间隔必须在 100 毫秒至 24 小时之间".into());
    }
    if profile.press_duration_ms != FIXED_PRESS_DURATION_MS {
        return Err("按下时长固定为 5 毫秒".into());
    }
    if profile.repeat_count > 999_999 {
        return Err("点击次数必须在 0 至 999999 之间".into());
    }
    for target in &profile.targets {
        if target.x < -100_000 || target.x > 100_000 || target.y < -100_000 || target.y > 100_000 {
            return Err("步骤坐标超出有效范围".into());
        }
    }
    Ok(())
}

fn input_button(button: &ClickButton) -> Button {
    match button {
        ClickButton::Left => Button::Left,
        ClickButton::Right => Button::Right,
        ClickButton::Middle => Button::Middle,
    }
}

fn interruptible_delay(cancel: &AtomicBool, duration: Duration) -> bool {
    let deadline = Instant::now() + duration;
    while !cancel.load(Ordering::Relaxed) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return true;
        }
        thread::sleep(remaining.min(Duration::from_millis(5)));
    }
    false
}

fn random_seed() -> u64 {
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    if seed == 0 {
        0x9e37_79b9_7f4a_7c15
    } else {
        seed
    }
}

fn next_random(state: &mut u64) -> u64 {
    if *state == 0 {
        *state = 0x9e37_79b9_7f4a_7c15;
    }
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

fn random_coordinate(center: i32, size: u32, state: &mut u64) -> i32 {
    if size == 0 {
        return center;
    }
    let start = center as i64 - (size as i64 / 2);
    let value = start + (next_random(state) % size as u64) as i64;
    value.clamp(i32::MIN as i64, i32::MAX as i64) as i32
}

fn resolve_click_point(
    target: (i32, i32, u32, u32),
    position: &ClickPosition,
    state: &mut u64,
) -> (i32, i32) {
    let (x, y, width, height) = target;
    match position {
        ClickPosition::Center => (x, y),
        ClickPosition::Random => (
            random_coordinate(x, width, state),
            random_coordinate(y, height, state),
        ),
    }
}

fn point_inside_target(point: (i32, i32), target: (i32, i32, u32, u32)) -> bool {
    let (point_x, point_y) = point;
    let (center_x, center_y, width, height) = target;
    let half_width = (width / 2) as i64;
    let half_height = (height / 2) as i64;
    let point_x = point_x as i64;
    let point_y = point_y as i64;
    let center_x = center_x as i64;
    let center_y = center_y as i64;
    point_x >= center_x - half_width
        && point_x <= center_x - half_width + width as i64
        && point_y >= center_y - half_height
        && point_y <= center_y - half_height + height as i64
}

enum CursorSleepResult {
    Completed,
    Cancelled,
    LeftTarget,
}

fn interruptible_sleep_with_cursor_check(
    cancel: &AtomicBool,
    duration: Duration,
    enigo: &mut Enigo,
    target: (i32, i32, u32, u32),
) -> Result<CursorSleepResult, String> {
    let deadline = Instant::now() + duration;
    while !cancel.load(Ordering::Relaxed) {
        let cursor = enigo.location().map_err(|error| error.to_string())?;
        if !point_inside_target(cursor, target) {
            return Ok(CursorSleepResult::LeftTarget);
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(CursorSleepResult::Completed);
        }
        thread::sleep(remaining.min(Duration::from_millis(5)));
    }
    Ok(CursorSleepResult::Cancelled)
}

pub fn stop_clicking(runtime: &ClickerRuntime) {
    if let Ok(cancel) = runtime.cancel.lock() {
        if let Some(flag) = cancel.as_ref() {
            flag.store(true, Ordering::Relaxed);
        }
    }
    if let Ok(mut status) = runtime.status.lock() {
        if status.state == "running" {
            status.state = "stopped".into();
        }
    }
}

#[tauri::command]
pub fn get_clicker_status(runtime: State<'_, ClickerRuntime>) -> ClickerStatus {
    runtime
        .status
        .lock()
        .map(|status| status.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn start_clicking(
    app: AppHandle,
    runtime: State<'_, ClickerRuntime>,
    profile: ClickProfile,
) -> Result<(), String> {
    validate(&profile)?;
    let runtime = runtime.inner().clone();
    stop_clicking(&runtime);
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut slot = runtime.cancel.lock().map_err(|_| "点击器状态锁定失败")?;
        *slot = Some(cancel.clone());
    }
    {
        let mut status = runtime.status.lock().map_err(|_| "点击器状态锁定失败")?;
        let infinite =
            matches!(profile.repeat_mode, RepeatMode::Infinite) || profile.repeat_count == 0;
        *status = ClickerStatus {
            state: "running".into(),
            completed: 0,
            target_count: if infinite {
                None
            } else {
                Some(profile.repeat_count)
            },
            error: None,
        };
    }
    emit_status(&app, &runtime);
    thread::spawn(move || {
        let mut enigo = match Enigo::new(&Settings::default()) {
            Ok(value) => value,
            Err(error) => {
                if let Ok(mut status) = runtime.status.lock() {
                    status.state = "error".into();
                    status.error = Some(error.to_string());
                }
                emit_status(&app, &runtime);
                return;
            }
        };
        if !interruptible_delay(&cancel, Duration::from_millis(START_DELAY_MS)) {
            if let Ok(mut status) = runtime.status.lock() {
                if status.state == "running" {
                    status.state = "stopped".into();
                }
            }
            emit_status(&app, &runtime);
            return;
        }
        let button = input_button(&profile.button);
        let targets = if profile.targets.is_empty() {
            vec![(profile.x, profile.y, profile.width, profile.height)]
        } else {
            profile
                .targets
                .iter()
                .map(|target| (target.x, target.y, target.width, target.height))
                .collect()
        };
        let mut completed = 0u64;
        let mut random_state = random_seed();
        let infinite =
            matches!(profile.repeat_mode, RepeatMode::Infinite) || profile.repeat_count == 0;
        let mut left_target = false;
        loop {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let target = targets[(completed as usize) % targets.len()];
            let (x, y) = resolve_click_point(target, &profile.click_position, &mut random_state);
            if let Err(error) = enigo
                .move_mouse(x, y, Coordinate::Abs)
                .and_then(|_| enigo.button(button, Direction::Press))
            {
                if let Ok(mut status) = runtime.status.lock() {
                    status.state = "error".into();
                    status.error = Some(error.to_string());
                }
                break;
            }
            let press_result = interruptible_sleep_with_cursor_check(
                &cancel,
                Duration::from_millis(profile.press_duration_ms),
                &mut enigo,
                target,
            );
            let _ = enigo.button(button, Direction::Release);
            match press_result {
                Ok(CursorSleepResult::Completed) => {}
                Ok(CursorSleepResult::Cancelled) => break,
                Ok(CursorSleepResult::LeftTarget) => {
                    left_target = true;
                    cancel.store(true, Ordering::Relaxed);
                    break;
                }
                Err(error) => {
                    if let Ok(mut status) = runtime.status.lock() {
                        status.state = "error".into();
                        status.error = Some(error);
                    }
                    break;
                }
            }
            completed += 1;
            if let Ok(mut status) = runtime.status.lock() {
                status.completed = completed;
            }
            let _ = app.emit(CLICKER_PROGRESS_EVENT, completed);
            if !infinite && completed >= profile.repeat_count {
                break;
            }
            let gap = profile
                .interval_ms
                .saturating_sub(profile.press_duration_ms);
            match interruptible_sleep_with_cursor_check(
                &cancel,
                Duration::from_millis(gap),
                &mut enigo,
                target,
            ) {
                Ok(CursorSleepResult::Completed) => {}
                Ok(CursorSleepResult::Cancelled) => break,
                Ok(CursorSleepResult::LeftTarget) => {
                    left_target = true;
                    cancel.store(true, Ordering::Relaxed);
                    break;
                }
                Err(error) => {
                    if let Ok(mut status) = runtime.status.lock() {
                        status.state = "error".into();
                        status.error = Some(error);
                    }
                    break;
                }
            }
        }
        if let Ok(mut status) = runtime.status.lock() {
            if left_target {
                status.state = "stopped".into();
                status.error = Some("鼠标移出点击区域，已自动停止".into());
            } else if status.state == "running" {
                status.state = if cancel.load(Ordering::Relaxed) {
                    "stopped"
                } else {
                    "completed"
                }
                .into();
            }
        }
        emit_status(&app, &runtime);
    });
    Ok(())
}

#[tauri::command]
pub fn stop_clicking_command(runtime: State<'_, ClickerRuntime>) {
    stop_clicking(&runtime);
}

#[tauri::command]
pub fn get_cursor_position() -> Result<(i32, i32), String> {
    let enigo = Enigo::new(&Settings::default()).map_err(|error| error.to_string())?;
    enigo.location().map_err(|error| error.to_string())
}

#[tauri::command]
// WebView2 can deadlock when a WebviewWindow is created from a synchronous
// command. Keep this command async so selection windows render on Windows.
pub async fn open_selection_window(app: AppHandle) -> Result<(), String> {
    destroy_selection_windows(&app);
    let monitors = app
        .available_monitors()
        .map_err(|error| error.to_string())?;
    if monitors.is_empty() {
        return Err("未找到可用显示器".into());
    }
    for (index, monitor) in monitors.iter().enumerate() {
        let scale = monitor.scale_factor();
        let position = monitor.position();
        let size = monitor.size();
        let url = format!(
            "index.html?selection=1&offsetX={}&offsetY={}",
            position.x as f64 / scale,
            position.y as f64 / scale
        );
        tauri::WebviewWindowBuilder::new(
            &app,
            format!("selection-{index}"),
            tauri::WebviewUrl::App(url.into()),
        )
        .title("选择点击区域")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .position(position.x as f64 / scale, position.y as f64 / scale)
        .inner_size(size.width as f64 / scale, size.height as f64 / scale)
        .focused(index == 0)
        .build()
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn close_selection_windows(app: AppHandle) {
    destroy_selection_windows(&app);
}

fn destroy_selection_windows(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("selection-") || label == "selection" {
            let _ = window.destroy();
        }
    }
}

#[tauri::command]
pub fn load_settings() -> Result<Option<ClickProfile>, String> {
    let path = settings_path();
    if !path.is_file() {
        return Ok(None);
    }
    let value = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&value)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_settings(profile: ClickProfile) -> Result<(), String> {
    validate(&profile)?;
    let path = settings_path();
    fs::create_dir_all(path.parent().ok_or("无效的配置路径")?)
        .map_err(|error| error.to_string())?;
    fs::write(
        path,
        serde_json::to_vec_pretty(&profile).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> ClickProfile {
        ClickProfile {
            x: 100,
            y: 200,
            width: 0,
            height: 0,
            interval_ms: 1_000,
            press_duration_ms: FIXED_PRESS_DURATION_MS,
            repeat_mode: RepeatMode::Count,
            repeat_count: 3,
            button: ClickButton::Left,
            click_position: ClickPosition::Center,
            targets: Vec::new(),
        }
    }

    #[test]
    fn accepts_valid_profile() {
        assert!(validate(&profile()).is_ok());
    }

    #[test]
    fn rejects_press_duration_equal_to_interval() {
        let mut value = profile();
        value.press_duration_ms = value.interval_ms;
        assert!(validate(&value).is_err());
    }

    #[test]
    fn rejects_interval_shorter_than_minimum() {
        let mut value = profile();
        value.interval_ms = MIN_INTERVAL_MS - 1;
        assert!(validate(&value).is_err());
    }

    #[test]
    fn rejects_non_fixed_press_duration() {
        let mut value = profile();
        value.press_duration_ms = FIXED_PRESS_DURATION_MS + 1;
        assert!(validate(&value).is_err());
    }

    #[test]
    fn allows_infinite_mode_without_repeat_count() {
        let mut value = profile();
        value.repeat_mode = RepeatMode::Infinite;
        value.repeat_count = 0;
        assert!(validate(&value).is_ok());
    }

    #[test]
    fn allows_zero_repeat_count_as_infinite() {
        let mut value = profile();
        value.repeat_count = 0;
        assert!(validate(&value).is_ok());
    }

    #[test]
    fn random_click_point_stays_inside_target() {
        let mut state = 123_u64;
        for _ in 0..100 {
            let (x, y) =
                resolve_click_point((100, 200, 20, 10), &ClickPosition::Random, &mut state);
            assert!((90..110).contains(&x));
            assert!((195..205).contains(&y));
        }
    }

    #[test]
    fn random_click_point_without_area_uses_center() {
        let mut state = 123_u64;
        assert_eq!(
            resolve_click_point((100, 200, 0, 0), &ClickPosition::Random, &mut state),
            (100, 200)
        );
    }

    #[test]
    fn cursor_boundary_matches_selected_target() {
        let target = (100, 200, 20, 10);
        assert!(point_inside_target((90, 195), target));
        assert!(point_inside_target((110, 205), target));
        assert!(!point_inside_target((89, 200), target));
        assert!(!point_inside_target((100, 206), target));
    }
}

#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .status()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    Err("辅助功能设置入口仅适用于 macOS".into())
}

#[tauri::command]
pub async fn control_request(
    path: String,
    method: String,
    body: Option<serde_json::Value>,
    access_token: Option<String>,
) -> Result<serde_json::Value, String> {
    const API_BASE_URLS: [&str; 2] = ["https://gotap.123371.com", "https://gotop.123371.com"];
    let client = reqwest::Client::builder()
        .no_proxy()
        .user_agent("GoTap/0.1")
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| format!("无法创建服务器请求：{error}"))?;
    let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())
        .map_err(|error| format!("无效的请求方法：{error}"))?;
    let body = body
        .map(|body| serde_json::to_vec(&body))
        .transpose()
        .map_err(|error| error.to_string())?;
    let mut last_error = None;
    for base_url in API_BASE_URLS {
        let mut request = client.request(method.clone(), format!("{base_url}{path}"));
        if let Some(token) = access_token
            .as_deref()
            .filter(|token| !token.trim().is_empty())
        {
            request = request.bearer_auth(token);
        }
        if let Some(body) = body.as_ref() {
            request = request
                .header("content-type", "application/json")
                .body(body.clone());
        }
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        };
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|error| format!("读取服务器响应失败：{error}"))?;
        let value = if text.trim().is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::from_str(&text).map_err(|error| format!("服务器返回数据无效：{error}"))?
        };
        if !status.is_success() {
            let detail = value
                .get("detail")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_else(|| status.canonical_reason().unwrap_or("请求失败"));
            return Err(detail.to_owned());
        }
        return Ok(value);
    }
    Err(format!(
        "无法连接服务器，请检查网络或稍后重试：{}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "未知网络错误".into())
    ))
}
