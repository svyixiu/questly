// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use once_cell::sync::OnceCell;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Listener, Manager,
};

mod brand;
mod rpc;
mod runner;
mod system;

// Global static instance of the Discord client
static DISCORD_CLIENT: OnceCell<Mutex<Option<rpc::Client>>> = OnceCell::new();

fn get_discord_client() -> &'static Mutex<Option<rpc::Client>> {
    DISCORD_CLIENT.get_or_init(|| Mutex::new(None))
}

// When set, closing the window hides it to the tray instead of quitting.
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_main_window(app);
        }
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show window", true, None::<&str>)?;
    let stop_all = MenuItem::with_id(app, "stop_all", "Stop all games", true, None::<&str>)?;
    let hide_games = MenuItem::with_id(app, "hide_games", "Hide game windows", true, None::<&str>)?;
    let show_games = MenuItem::with_id(app, "show_games", "Show game windows", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &stop_all, &separator, &hide_games, &show_games, &separator2, &quit],
    )?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Questly")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            // the frontend owns the process state, so let it do the stopping
            "stop_all" => {
                let _ = app.emit("tray_stop_all", ());
            }
            "hide_games" => {
                post_to_runner_windows(false);
            }
            "show_games" => {
                post_to_runner_windows(true);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[tauri::command]
fn hide_window(handle: AppHandle) {
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn show_window(handle: AppHandle) {
    show_main_window(&handle);
}

/// Really quits, even when "Close to tray" is on (used by the risk notice's Quit).
#[tauri::command]
fn quit_app(handle: AppHandle) {
    handle.exit(0);
}

#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

/// Hides or shows the windows (and tray icons) of every running dummy game.
/// The Windows runner (src-win) registers its window class as "DQCTray" and
/// handles these two messages. Returns how many runner windows were found.
#[cfg(target_os = "windows")]
fn post_to_runner_windows(visible: bool) -> usize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowExW, PostMessageW, WM_APP};
    const WM_DQC_HIDE: u32 = WM_APP + 2;
    const WM_DQC_SHOW: u32 = WM_APP + 3;

    let class: Vec<u16> = "DQCTray\0".encode_utf16().collect();
    let message = if visible { WM_DQC_SHOW } else { WM_DQC_HIDE };
    let mut count = 0;
    let mut hwnd = std::ptr::null_mut();
    loop {
        // FindWindowExW also finds hidden top-level windows
        hwnd = unsafe { FindWindowExW(std::ptr::null_mut(), hwnd, class.as_ptr(), std::ptr::null()) };
        if hwnd.is_null() {
            break;
        }
        // wParam = position, so shown windows cascade instead of stacking
        unsafe { PostMessageW(hwnd, message, count, 0) };
        count += 1;
    }
    count
}

#[cfg(not(target_os = "windows"))]
fn post_to_runner_windows(_visible: bool) -> usize {
    0
}

#[tauri::command]
fn set_game_windows_visible(visible: bool) -> usize {
    post_to_runner_windows(visible)
}

// ----- where Questly keeps things -----

fn env_dir(var: &str) -> Option<PathBuf> {
    env::var_os(var).map(PathBuf::from)
}

fn home_config_dir() -> PathBuf {
    env_dir("HOME").map(|h| h.join(".config")).unwrap_or_else(env::temp_dir)
}

/// %APPDATA%\Questly: the editable library.json lives here.
fn app_data_dir() -> PathBuf {
    env_dir("APPDATA").unwrap_or_else(home_config_dir).join("Questly")
}

/// %LOCALAPPDATA%\Questly: machine-local files (the dummy game executables).
fn app_local_dir() -> PathBuf {
    env_dir("LOCALAPPDATA").unwrap_or_else(home_config_dir).join("Questly")
}

/// %LOCALAPPDATA%\Programs\Questly: where the installer puts the app.
fn install_dir() -> PathBuf {
    env_dir("LOCALAPPDATA")
        .unwrap_or_else(home_config_dir)
        .join("Programs")
        .join("Questly")
}

fn installed_exe() -> PathBuf {
    install_dir().join(if cfg!(windows) { "Questly.exe" } else { "Questly" })
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase(),
        _ => false,
    }
}

/// Runs a program without flashing a console window.
fn run_hidden(program: &str, args: &[&str]) -> Result<(), String> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run {}: {}", program, e))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Single-quoted PowerShell string literal.
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

// ----- library.json -----

fn library_file_path() -> PathBuf {
    app_data_dir().join("library.json")
}

/// Earlier builds kept library.json next to the exe; bring it along once.
fn migrate_old_library(target: &Path) {
    if target.exists() {
        return;
    }
    let old = env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("library.json")));
    if let Some(old) = old.filter(|p| p.exists()) {
        let _ = fs::create_dir_all(app_data_dir());
        let _ = fs::copy(&old, target);
    }
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(serde::Serialize)]
struct LibraryFile {
    path: String,
    /// None when the file doesn't exist yet
    content: Option<String>,
    modified_ms: u64,
}

#[tauri::command]
fn read_library_file() -> Result<LibraryFile, String> {
    let path = library_file_path();
    migrate_old_library(&path);
    let content = match fs::read_to_string(&path) {
        Ok(content) => Some(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Failed to read {}: {}", path.display(), e)),
    };
    Ok(LibraryFile {
        path: path.to_string_lossy().to_string(),
        modified_ms: if content.is_some() { modified_ms(&path) } else { 0 },
        content,
    })
}

/// Writes via a temp file + rename so the file is never left half-written.
#[tauri::command]
fn write_library_file(content: String) -> Result<u64, String> {
    let path = library_file_path();
    fs::create_dir_all(app_data_dir()).map_err(|e| format!("Failed to create the data folder: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| format!("Failed to write {}: {}", tmp.display(), e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Failed to replace {}: {}", path.display(), e))?;
    Ok(modified_ms(&path))
}

#[tauri::command]
fn reveal_library_file() -> Result<(), String> {
    let path = library_file_path();
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()
            .map_err(|e| format!("Failed to open Explorer: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path.parent().unwrap_or_else(|| Path::new(".")))
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    Ok(())
}

/// Import/export: reads or writes a file the user picked in a system dialog.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Couldn't read {}: {}", path, e))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("Couldn't write {}: {}", path, e))
}

// ----- installer / launcher -----
// The same Questly.exe is both the installer and the app. Run from anywhere
// else (e.g. Downloads) it offers to install itself into
// %LOCALAPPDATA%\Programs\Questly, adds shortcuts and an "Apps & features"
// entry (per-user, no admin rights needed), then launches the installed copy.

#[derive(serde::Serialize)]
struct InstallInfo {
    current_exe: String,
    install_dir: String,
    installed_exe: String,
    data_dir: String,
    /// this process is the installed copy
    running_installed: bool,
    /// an installed copy exists
    installed_exists: bool,
    /// development build: never show the installer
    dev: bool,
    /// started from "Apps & features" → Uninstall
    uninstall_requested: bool,
    /// started by Windows at sign-in (Launch on startup)
    autostarted: bool,
    version: String,
}

#[tauri::command]
fn install_info(handle: AppHandle) -> InstallInfo {
    let current = env::current_exe().unwrap_or_default();
    let target = installed_exe();
    InstallInfo {
        current_exe: current.to_string_lossy().to_string(),
        install_dir: install_dir().to_string_lossy().to_string(),
        installed_exe: target.to_string_lossy().to_string(),
        data_dir: app_data_dir().to_string_lossy().to_string(),
        running_installed: same_file(&current, &target),
        installed_exists: target.exists(),
        dev: cfg!(debug_assertions),
        uninstall_requested: env::args().any(|a| a == "--uninstall"),
        autostarted: env::args().any(|a| a == "--autostart"),
        version: handle.package_info().version.to_string(),
    }
}

#[tauri::command]
fn install_app(handle: AppHandle, desktop_shortcut: bool, start_menu: bool) -> Result<String, String> {
    let dir = install_dir();
    let target = installed_exe();
    let current = env::current_exe().map_err(|e| format!("Couldn't find Questly's own file: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {}", dir.display(), e))?;

    if !same_file(&current, &target) {
        // copy next to the target first, so a failed copy never breaks an existing install
        let staged = dir.join("Questly.exe.new");
        fs::copy(&current, &staged).map_err(|e| format!("Couldn't copy Questly: {}", e))?;
        if target.exists() {
            fs::remove_file(&target).map_err(|_| {
                let _ = fs::remove_file(&staged);
                "The installed Questly is still open. Quit it (tray icon → Quit), then try again.".to_string()
            })?;
        }
        fs::rename(&staged, &target).map_err(|e| format!("Couldn't finish installing: {}", e))?;
    }
    let _ = fs::create_dir_all(app_data_dir());

    #[cfg(target_os = "windows")]
    {
        let exe = target.to_string_lossy().to_string();
        let script = format!(
            r#"$ErrorActionPreference='Stop'
$exe={exe}; $dir={dir}
function Lnk($path) {{ $s=(New-Object -ComObject WScript.Shell).CreateShortcut($path); $s.TargetPath=$exe; $s.WorkingDirectory=$dir; $s.IconLocation="$exe,0"; $s.Description='Questly'; $s.Save() }}
if ({desktop}) {{ Lnk (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Questly.lnk') }}
if ({start}) {{ Lnk (Join-Path ([Environment]::GetFolderPath('Programs')) 'Questly.lnk') }}
$k='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Questly'
New-Item -Path $k -Force | Out-Null
New-ItemProperty -Path $k -Name DisplayName -Value 'Questly' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $k -Name DisplayVersion -Value {version} -PropertyType String -Force | Out-Null
New-ItemProperty -Path $k -Name Publisher -Value 'Questly' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $k -Name DisplayIcon -Value "$exe,0" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $k -Name InstallLocation -Value $dir -PropertyType String -Force | Out-Null
New-ItemProperty -Path $k -Name UninstallString -Value ('"' + $exe + '" --uninstall') -PropertyType String -Force | Out-Null
New-ItemProperty -Path $k -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $k -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $k -Name EstimatedSize -Value {size_kb} -PropertyType DWord -Force | Out-Null"#,
            exe = ps_quote(&exe),
            dir = ps_quote(&dir.to_string_lossy()),
            desktop = if desktop_shortcut { "$true" } else { "$false" },
            start = if start_menu { "$true" } else { "$false" },
            version = ps_quote(&handle.package_info().version.to_string()),
            size_kb = fs::metadata(&target).map(|m| m.len() / 1024).unwrap_or(0),
        );
        run_hidden("powershell", &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
            .map_err(|e| format!("Installed, but couldn't create shortcuts: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (desktop_shortcut, start_menu, &handle);
    }

    Ok(target.to_string_lossy().to_string())
}

/// Starts the installed copy and closes this one (the installer).
#[tauri::command]
fn launch_installed(handle: AppHandle) -> Result<(), String> {
    let target = installed_exe();
    std::process::Command::new(&target)
        .current_dir(install_dir())
        .spawn()
        .map_err(|e| format!("Couldn't start {}: {}", target.display(), e))?;
    handle.exit(0);
    Ok(())
}

/// Removes shortcuts, the "Apps & features" entry and the installed files
/// (after this process exits). With `remove_data`, also the library,
/// dummy games and saved settings.
#[tauri::command]
fn uninstall_app(handle: AppHandle, remove_data: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"
foreach ($f in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  Remove-Item -LiteralPath (Join-Path $f 'Questly.lnk') -Force -ErrorAction SilentlyContinue
}
Remove-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Questly' -Recurse -Force -ErrorAction SilentlyContinue"#;
        run_hidden("powershell", &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])?;

        let mut dirs = vec![install_dir()];
        if remove_data {
            dirs.push(app_data_dir());
            dirs.push(app_local_dir());
            if let Ok(webview_data) = handle.path().app_local_data_dir() {
                dirs.push(webview_data);
            }
        }
        // files in use can only go once Questly has exited: let a detached cmd finish the job
        let removals: Vec<String> = dirs
            .iter()
            .map(|d| format!("rmdir /s /q \"{}\"", d.display()))
            .collect();
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .raw_arg(format!("/c ping 127.0.0.1 -n 3 >nul & {}", removals.join(" & ")))
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| format!("Couldn't schedule file removal: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = fs::remove_dir_all(install_dir());
        if remove_data {
            let _ = fs::remove_dir_all(app_data_dir());
            let _ = fs::remove_dir_all(app_local_dir());
        }
    }
    handle.exit(0);
    Ok(())
}

// ----- Discord detection -----
// Discord's desktop client logs "[RunningGameStore] Running Games Changed" to
// logs/renderer_js.log whenever its game detection picks up (or loses) a game.
// We tail that file and forward the relevant lines to the frontend. Only those
// two line shapes are parsed; nothing else from the log is read or sent anywhere.

fn discord_renderer_logs() -> Vec<PathBuf> {
    const CHANNELS: [&str; 4] = ["discord", "discordptb", "discordcanary", "discorddevelopment"];
    let mut bases: Vec<PathBuf> = Vec::new();
    if let Some(appdata) = env::var_os("APPDATA") {
        bases.push(PathBuf::from(appdata));
    }
    if let Some(home) = env::var_os("HOME") {
        let home = PathBuf::from(home);
        bases.push(home.join("Library/Application Support"));
        bases.push(home.join(".config"));
    }
    let mut found = Vec::new();
    for base in &bases {
        for channel in CHANNELS {
            let path = base.join(channel).join("logs").join("renderer_js.log");
            if path.exists() {
                found.push(path);
            }
        }
    }
    found
}

#[derive(Clone, serde::Serialize)]
struct DiscordLogEvent {
    /// "running_games_changed" or "primary_game"
    kind: String,
    /// local timestamp as written by Discord, e.g. "2026-09-28 19:06:20.359"
    time: String,
    /// the game Discord considers primary (primary_game only)
    game: Option<String>,
    /// "<exe path>:<game name>" (primary_game only)
    key: Option<String>,
    /// discord / discordptb / discordcanary …
    source: String,
}

fn parse_discord_line(line: &str, source: &str) -> Option<DiscordLogEvent> {
    let time = line.strip_prefix('[')?.split(']').next()?.to_string();
    if line.contains("[RunningGameStore] Running Games Changed") {
        return Some(DiscordLogEvent {
            kind: "running_games_changed".into(),
            time,
            game: None,
            key: None,
            source: source.to_string(),
        });
    }
    const MARKER: &str = "handleRunningGamesChange visibleGame=";
    if let Some(i) = line.find(MARKER) {
        let rest = &line[i + MARKER.len()..];
        let (game, rest) = rest.split_once(" newPrimaryKey=")?;
        let key = rest.split(" currentSessionGameKey=").next().unwrap_or("").trim();
        return Some(DiscordLogEvent {
            kind: "primary_game".into(),
            time,
            game: (game != "null").then(|| game.to_string()),
            key: (key != "null" && !key.is_empty()).then(|| key.to_string()),
            source: source.to_string(),
        });
    }
    None
}

#[tauri::command]
fn discord_log_paths() -> Vec<String> {
    discord_renderer_logs()
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

fn start_discord_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        use std::collections::HashMap;
        use std::io::{Read, Seek, SeekFrom};

        let mut offsets: HashMap<PathBuf, u64> = HashMap::new();
        let mut partial: HashMap<PathBuf, String> = HashMap::new();
        loop {
            for path in discord_renderer_logs() {
                let len = match fs::metadata(&path) {
                    Ok(m) => m.len(),
                    Err(_) => continue,
                };
                // start at the current end: only lines written from now on matter
                let offset = offsets.entry(path.clone()).or_insert(len);
                if len < *offset {
                    // rotated or truncated
                    *offset = 0;
                    partial.remove(&path);
                }
                if len == *offset {
                    continue;
                }
                let Ok(mut file) = fs::File::open(&path) else { continue };
                if file.seek(SeekFrom::Start(*offset)).is_err() {
                    continue;
                }
                let mut buf = Vec::new();
                if file.read_to_end(&mut buf).is_err() {
                    continue;
                }
                *offset += buf.len() as u64;

                let source = path
                    .parent()
                    .and_then(|p| p.parent())
                    .and_then(|p| p.file_name())
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let mut text = partial.remove(&path).unwrap_or_default();
                text.push_str(&String::from_utf8_lossy(&buf));
                let mut lines: Vec<&str> = text.split('\n').collect();
                // keep an unfinished last line for the next round
                let rest = lines.pop().unwrap_or("").to_string();
                for line in lines {
                    if let Some(event) = parse_discord_line(line, &source) {
                        let _ = app.emit("discord_log_event", event);
                    }
                }
                partial.insert(path, rest);
            }
            std::thread::sleep(std::time::Duration::from_millis(700));
        }
    });
}

fn runner_resource_name() -> &'static str {
    #[cfg(target_os = "windows")]
    let runner_name = "data/src-win.exe";

    #[cfg(target_os = "linux")]
    let runner_name = "data/src-linux";

    #[cfg(target_os = "macos")]
    let runner_name = "data/src-darwin";

    runner_name
}

fn is_app_bundle(executable_name: &str) -> bool {
    cfg!(target_os = "macos") && executable_name.ends_with(".app")
}

fn bundle_binary_name(app_name: &str) -> String {
    app_name
        .strip_suffix(".app")
        .unwrap_or(app_name)
        .to_string()
}

/// Discord application ids are 64-bit numbers, too big for JavaScript numbers,
/// so they arrive as text. They become folder names: digits only.
fn check_app_id(app_id: &str) -> Result<&str, String> {
    if !app_id.is_empty() && app_id.len() <= 20 && app_id.chars().all(|c| c.is_ascii_digit()) {
        Ok(app_id)
    } else {
        Err(format!("Not a valid game id: {}", app_id))
    }
}

/// Dummy game files live in %LOCALAPPDATA%\Questly\games, so they work the
/// same whether Questly runs installed or straight from a download.
fn game_folder_path(path: &str, app_id: &str) -> PathBuf {
    let normalized_path = Path::new(path).to_string_lossy().to_string();

    app_local_dir()
        .join("games")
        .join(app_id)
        .join(normalized_path)
}

/// On Windows the runner is compiled into Questly itself, so the app is a
/// single self-contained .exe that can be shared and installed from anywhere.
#[cfg(target_os = "windows")]
static RUNNER_EXE: &[u8] = include_bytes!("../resources/src-win.exe");

fn resolve_runner_template(handle: &AppHandle) -> Result<PathBuf, String> {
    handle
        .path()
        .resolve(runner_resource_name(), BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve runner template: {}", e))
}

fn make_macos_app_bundle(
    app_bundle_path: &Path,
    app_name: &str,
    display_name: &str,
    runner_template: &Path,
) -> Result<PathBuf, String> {
    let binary_name = bundle_binary_name(app_name);
    let macos_dir = app_bundle_path.join("Contents/MacOS");
    fs::create_dir_all(&macos_dir)
        .map_err(|e| format!("Failed to create app bundle directories: {}", e))?;

    let target_executable_path = macos_dir.join(&binary_name);
    fs::copy(runner_template, &target_executable_path)
        .map_err(|e| format!("Failed to copy dummy executable: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&target_executable_path)
            .map_err(|e| format!("Failed to read executable permissions: {}", e))?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&target_executable_path, permissions)
            .map_err(|e| format!("Failed to set executable permissions: {}", e))?;
    }

    let info_plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>{display_name}</string>
    <key>CFBundleExecutable</key>
    <string>{binary_name}</string>
    <key>CFBundleIdentifier</key>
    <string>me.markterence.discordquestcompleter.dummy</string>
    <key>CFBundleName</key>
    <string>{display_name}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
</dict>
</plist>
"#
    );

    fs::write(app_bundle_path.join("Contents/Info.plist"), info_plist)
        .map_err(|e| format!("Failed to write Info.plist: {}", e))?;

    Ok(target_executable_path)
}

fn launch_executable_path(game_folder_path: &Path, executable_name: &str) -> PathBuf {
    if is_app_bundle(executable_name) {
        game_folder_path
            .join(executable_name)
            .join("Contents/MacOS")
            .join(bundle_binary_name(executable_name))
    } else {
        game_folder_path.join(executable_name)
    }
}

fn stop_process_name(exec_name: &str) -> String {
    if is_app_bundle(exec_name) {
        bundle_binary_name(exec_name)
    } else {
        exec_name.to_string()
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command(rename_all = "snake_case")]
async fn create_fake_game(
    handle: tauri::AppHandle,
    path: &str,
    executable_name: &str,
    path_len: i64,
    app_id: String,
    display_name: Option<String>,
) -> Result<String, String> {
    let game_folder_path = game_folder_path(path, check_app_id(&app_id)?);

    println!("Game folder path: {:?}", game_folder_path);
    println!(
        "Game full path: {:?}",
        game_folder_path.join(executable_name)
    );

    match fs::create_dir_all(&game_folder_path) {
        Ok(_) => {
            println!("Successfully created directory: {:?}", game_folder_path);
        }
        Err(e) => return Err(format!("Failed to create game folder: {}", e)),
    };

    #[cfg(target_os = "windows")]
    if !is_app_bundle(executable_name) {
        let target = game_folder_path.join(executable_name);
        // already in place (and possibly running, which locks the file): nothing to do
        let up_to_date = fs::metadata(&target)
            .map(|m| m.len() == RUNNER_EXE.len() as u64)
            .unwrap_or(false);
        if !up_to_date {
            fs::write(&target, RUNNER_EXE)
                .map_err(|e| format!("Failed to write dummy executable: {}", e))?;
        }
        let _ = (&handle, path_len, &display_name);
        return Ok(format!("Dummy executable ready at: {:?}", target));
    }

    let resource_path = resolve_runner_template(&handle)?;
    println!("Creating dummy game executable from: {:?}", resource_path);

    if is_app_bundle(executable_name) {
        let app_bundle_path = game_folder_path.join(executable_name);
        let bundle_display_name = display_name
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| bundle_binary_name(executable_name));
        let target_executable_path = make_macos_app_bundle(
            &app_bundle_path,
            executable_name,
            &bundle_display_name,
            &resource_path,
        )?;
        return Ok(format!(
            "Dummy app bundle created at: {:?}",
            target_executable_path
        ));
    }

    let target_executable_path = game_folder_path.join(executable_name);
    match fs::copy(&resource_path, &target_executable_path) {
        Ok(_) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = std::fs::metadata(&target_executable_path)
                    .map_err(|e| format!("Failed to get file metadata: {}", e))?
                    .permissions();
                perms.set_mode(0o755);
                std::fs::set_permissions(&target_executable_path, perms)
                    .map_err(|e| format!("Failed to set executable permissions: {}", e))?;
            }

            Ok(format!(
                "Dummy executable copied to: {:?}",
                target_executable_path
            ))
        }
        Err(e) => Err(format!("Failed to copy dummy executable: {}", e)),
    }
}

#[cfg(target_os = "macos")]
fn launch_macos_app_bundle(app_bundle_path: &Path, title: &str) -> Result<(), String> {
    let mut command = std::process::Command::new("open");
    command
        .arg("-n")
        .arg("-g")
        .arg("-a")
        .arg(app_bundle_path)
        .arg("--args")
        .arg("--title")
        .arg(title);

    command
        .spawn()
        .map_err(|e| format!("Failed to launch app bundle with open: {}", e))?;

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
async fn run_background_process(
    handle: AppHandle,
    name: &str,
    path: &str,
    executable_name: &str,
    path_len: i64,
    app_id: String,
    hidden: Option<bool>,
    // "hidden" | "parked" (just off-screen) | "visible"
    window_mode: Option<String>,
    // Discord CDN icon for the game window
    icon_url: Option<String>,
    // Questly's theme as "bg,ink,muted,line,btn,btnInk,accent,danger" hex colors
    colors: Option<String>,
) -> Result<String, String> {
    let app_id = check_app_id(&app_id)?.to_string();
    let game_folder_path = game_folder_path(path, &app_id);
    let game_root = app_local_dir().join("games").join(&app_id);

    if is_app_bundle(executable_name) {
        #[cfg(target_os = "macos")]
        {
            let bundle_path = game_folder_path.join(executable_name);
            launch_macos_app_bundle(&bundle_path, name)?;
            return Ok("App bundle launched successfully".to_string());
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = name;
            return Err("App bundle launches are only supported on macOS".to_string());
        }
    }

    let executable_path = launch_executable_path(&game_folder_path, executable_name);
    
    let mode = window_mode.unwrap_or_else(|| {
        if hidden.unwrap_or(false) { "hidden" } else { "parked" }.to_string()
    });

    let mut cmd = std::process::Command::new(&executable_path);
    cmd.args(["--title", name])
       .current_dir(game_folder_path);
    match mode.as_str() {
        // Settings > Auto hide / game windows: no window or tray icon at all
        "hidden" => { cmd.arg("--hidden"); }
        "visible" => { cmd.arg("--show"); }
        _ => {}
    }
    if mode != "hidden" {
        if let Some(icon) = ensure_game_icon(&game_root, icon_url.as_deref()).await {
            cmd.arg("--icon").arg(icon);
        }
    }
    if let Some(colors) = colors.filter(|c| c.len() <= 120 && c.chars().all(|ch| ch.is_ascii_hexdigit() || ch == ',')) {
        cmd.arg("--colors").arg(colors);
    }

    // Platform-specific process spawning
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0); // Create new process group on Unix
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start process: {}", e))?;

    // Watch the game so Questly knows when it's closed from its own window.
    // Exit code 2 = "Close & delete": remove this game's files once it has exited.
    let exe = executable_name.to_string();
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        let mut deleted = false;
        if code == 2 {
            for _ in 0..10 {
                if fs::remove_dir_all(&game_root).is_ok() || !game_root.exists() {
                    deleted = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
            }
        }
        let _ = handle.emit(
            "game_exited",
            serde_json::json!({
                "app_id": app_id.to_string(),
                "executable_name": exe,
                "code": code,
                "deleted": deleted,
            }),
        );
    });

    Ok("Process started successfully".to_string())
}

/// Downloads the game's icon once (Discord's CDN only) for the game window.
async fn ensure_game_icon(game_root: &Path, url: Option<&str>) -> Option<PathBuf> {
    let path = game_root.join("icon.png");
    if path.exists() {
        return Some(path);
    }
    let url = url.filter(|u| u.starts_with("https://cdn.discordapp.com/app-icons/"))?;
    let client = tauri_plugin_http::reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .ok()?;
    let bytes = client.get(url).send().await.ok()?.error_for_status().ok()?.bytes().await.ok()?;
    fs::create_dir_all(game_root).ok()?;
    fs::write(&path, &bytes).ok()?;
    Some(path)
}

#[tauri::command(rename_all = "snake_case")]
async fn stop_process(exec_name: String) -> Result<(), String> {
    let process_name = stop_process_name(&exec_name);

    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("taskkill")
            .arg("/F")
            .arg("/IM")
            .arg(&process_name)
            .output()
            .map_err(|e| format!("Failed to execute taskkill: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "Failed to stop process: {}",
                String::from_utf8_lossy(&output.stderr)
            ))
        }
    }

    #[cfg(target_os = "macos")]
    {
        if is_app_bundle(&exec_name) {
            let bundle_pattern = format!("{}/Contents/MacOS", exec_name);
            let output = std::process::Command::new("pkill")
                .arg("-f")
                .arg(&bundle_pattern)
                .output()
                .map_err(|e| format!("Failed to execute pkill: {}", e))?;

            if output.status.success() {
                return Ok(());
            }
        }

        let output = std::process::Command::new("pkill")
            .arg("-x")
            .arg(&process_name)
            .output()
            .map_err(|e| format!("Failed to execute pkill: {}", e))?;

        if output.status.success() || output.status.code() == Some(1) {
            Ok(())
        } else {
            Err(format!(
                "Failed to stop process: {}",
                String::from_utf8_lossy(&output.stderr)
            ))
        }
    }
    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("pkill")
            .arg("-f")
            .arg(&exec_name)
            .output()
            .map_err(|e| format!("Failed to execute pkill: {}", e))?;

        if output.status.success() || output.status.code() == Some(1) {
            // pkill returns 1 if no processes were killed, which is fine
            Ok(())
        } else {
            Err(format!(
                "Failed to stop process: {}",
                String::from_utf8_lossy(&output.stderr)
            ))
        }
    }
}

/// Usage: Calling from JS:
/// ```javascript
/// await invoke('connect_to_discord_rpc_3', json, 'connect' | 'disconnect');
#[tauri::command(rename_all = "snake_case")]
fn connect_to_discord_rpc_3(handle: AppHandle, activity_json: String, action: String) {
    let app = handle.clone();

    let event_connecting = "client_connecting";
    let event_connected = "client_connected";
    let event_disconnect = "event_disconnect";
    let event_connect = "event_connect";

    let activity = runner::parse_activity_json(&activity_json).unwrap();

    let connecting_payload = serde_json::json!({
        "app_id": activity.app_id,
    });

    let client_option = {
        let mut client_guard = get_discord_client().lock().unwrap();
        // Take the client out, leaving None in its place
        client_guard.take()
        // MutexGuard is dropped here at the end of scope
    };

    let task = tauri::async_runtime::spawn(async move {
        handle
            .emit(event_connecting, connecting_payload)
            .unwrap_or_else(|e| eprintln!("Failed to emit event: {}", e));

        let client = runner::set_activity(activity_json)
            .await
            .map_err(|e| {
                println!("Failed to set activity: {}", e);
            })
            .unwrap();

        let connected_payload = serde_json::json!({
            "app_id": activity.app_id,
        });

        {
            let mut client_guard = get_discord_client().lock().unwrap();
            *client_guard = Some(client);
        }

        handle
            .emit(event_connected, connected_payload)
            .unwrap_or_else(|e| {
                eprintln!("Failed to emit event: {}", e);
            });

        handle.listen(event_disconnect, move |_| {
            println!("Disconnecting from Discord RPC inner");
            let disconnect_task = tauri::async_runtime::spawn(async move {
                let client_option = {
                    let mut client_guard = get_discord_client().lock().unwrap();
                    // Take the client out, leaving None in its place
                    client_guard.take()
                    // MutexGuard is dropped here at the end of scope
                };
                if let Some(client) = client_option {
                    client.discord.disconnect().await;
                    println!("Disconnected from Discord RPC inner");
                }
            });
            // disconnect_task.abort();
        });
    });

    app.listen(event_disconnect, move |_| {
        println!("Disconnecting from Discord RPC...");
        task.abort();
    });
}

#[tauri::command(rename_all = "snake_case")]
async fn fetch_gamelist_gh_mirror() -> tauri::ipc::Response {
    let res = tauri_plugin_http::reqwest::get("https://markterence.github.io/discord-quest-completer/detectable.json").await;
    tauri::ipc::Response::new(res.unwrap().text().await.unwrap())
}

#[tauri::command(rename_all = "snake_case")]
async fn fetch_gamelist_from_discord() -> tauri::ipc::Response {
    let res = tauri_plugin_http::reqwest::get("https://discord.com/api/applications/detectable").await;
    tauri::ipc::Response::new(res.unwrap().text().await.unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            setup_tray(app)?;
            start_discord_watcher(app.handle().clone());
            // The main window starts hidden (tauri.conf.json) and appears when
            // the splash is done. Started by Windows at sign-in ("Launch on
            // startup"), Questly skips the splash and stays in the tray.
            if !env::args().any(|a| a == "--autostart") {
                brand::open_splash(app);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && CLOSE_TO_TRAY.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            hide_window,
            show_window,
            set_close_to_tray,
            quit_app,
            set_game_windows_visible,
            read_library_file,
            write_library_file,
            reveal_library_file,
            read_text_file,
            write_text_file,
            install_info,
            install_app,
            launch_installed,
            uninstall_app,
            discord_log_paths,
            system::system_load,
            system::idle_seconds,
            system::installed_game_ids,
            system::discord_status,
            system::start_discord,
            system::close_discord,
            system::kill_all_runners,
            system::get_autostart,
            system::set_autostart,
            brand::splash_stage,
            brand::get_splash_stage,
            brand::finish_splash,
            brand::set_brand_icon,
            brand::set_shortcut_icon,
            greet,
            create_fake_game,
            stop_process,
            connect_to_discord_rpc_3,
            run_background_process,
            fetch_gamelist_gh_mirror,
            fetch_gamelist_from_discord
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}