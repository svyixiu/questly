//! The startup splash window and the accent-colored app icon.

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::{app_local_dir, show_main_window};

// ----- splash -----
// The main window loads hidden while the splash plays. The main app reports
// its loading stages (1..=3) through `splash_stage`; the splash turns a dot
// green for each, then calls `finish_splash`, which shows the main window.

static SPLASH_STAGE: AtomicU8 = AtomicU8::new(0);
static SPLASH_DONE: AtomicBool = AtomicBool::new(false);

pub fn open_splash(app: &tauri::App) {
    let built = WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("splash.html".into()))
        .title("Questly")
        .inner_size(280.0, 280.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .center()
        .build();
    if built.is_err() {
        finish(app.handle());
        return;
    }
    // never leave anyone staring at a splash if the app gets stuck loading
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(15));
        finish(&handle);
    });
}

fn finish(app: &AppHandle) {
    if SPLASH_DONE.swap(true, Ordering::SeqCst) {
        return;
    }
    show_main_window(app);
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.destroy();
    }
}

#[tauri::command]
pub fn splash_stage(app: AppHandle, stage: u8) {
    let previous = SPLASH_STAGE.fetch_max(stage, Ordering::SeqCst);
    if stage > previous {
        let _ = app.emit_to("splash", "splash_stage", stage);
    }
}

/// For the splash to catch up on stages reported before it finished loading.
#[tauri::command]
pub fn get_splash_stage() -> u8 {
    SPLASH_STAGE.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn finish_splash(app: AppHandle) {
    finish(&app);
}

// ----- accent-colored icon -----
// The frontend draws the logo in the current accent and sends it as an .ico
// (several sizes) plus a small RGBA image for the tray. The window gets the
// best-fitting size from the .ico, like a native app would.

#[cfg(target_os = "windows")]
static WINDOW_ICONS: std::sync::Mutex<(isize, isize)> = std::sync::Mutex::new((0, 0));

fn icons_dir() -> std::path::PathBuf {
    app_local_dir().join("icons")
}

/// The icon file the shortcuts currently point at (it must not be deleted).
fn shortcut_icon() -> std::path::PathBuf {
    std::fs::read_to_string(icons_dir().join("shortcuts.txt"))
        .map(|name| icons_dir().join(name.trim()))
        .unwrap_or_default()
}

/// Icons of earlier colors; files still in use are simply skipped.
fn remove_old_icons(keep: &[std::path::PathBuf]) {
    if let Ok(entries) = std::fs::read_dir(icons_dir()) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().is_some_and(|e| e == "ico") && !keep.contains(&p) {
                let _ = std::fs::remove_file(p);
            }
        }
    }
}

#[tauri::command]
pub fn set_brand_icon(
    app: AppHandle,
    ico: Vec<u8>,
    tray_rgba: Vec<u8>,
    tray_size: u32,
    key: String,
) -> Result<String, String> {
    if !key.chars().all(|c| c.is_ascii_alphanumeric()) || key.is_empty() || key.len() > 32 {
        return Err("bad icon key".into());
    }
    let dir = icons_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {}", dir.display(), e))?;
    // one file per color: Explorer caches icons by path
    let path = dir.join(format!("questly-{}.ico", key));
    if !path.exists() {
        std::fs::write(&path, &ico).map_err(|e| format!("Couldn't write the icon: {}", e))?;
    }
    remove_old_icons(&[path.clone(), shortcut_icon()]);

    if tray_size > 0 && tray_rgba.len() == (tray_size * tray_size * 4) as usize {
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_icon(Some(tauri::image::Image::new_owned(tray_rgba, tray_size, tray_size)));
        }
    }

    #[cfg(target_os = "windows")]
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(hwnd) = window.hwnd() {
            set_window_icon_from_file(hwnd.0 as _, &path);
        }
    }
    Ok(path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
fn set_window_icon_from_file(hwnd: windows_sys::Win32::Foundation::HWND, path: &std::path::Path) {
    use windows_sys::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, LoadImageW, SendMessageW, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_LOADFROMFILE, SM_CXICON,
        SM_CXSMICON, WM_SETICON,
    };
    let wide: Vec<u16> = path.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
    unsafe {
        let dpi = GetDpiForWindow(hwnd).max(96);
        let load = |metric| {
            let size = GetSystemMetricsForDpi(metric, dpi);
            LoadImageW(std::ptr::null_mut(), wide.as_ptr(), IMAGE_ICON, size, size, LR_LOADFROMFILE)
        };
        let big = load(SM_CXICON);
        let small = load(SM_CXSMICON);
        if big.is_null() || small.is_null() {
            return;
        }
        SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, big as isize);
        SendMessageW(hwnd, WM_SETICON, ICON_SMALL as usize, small as isize);
        // free the icons from the previous color (never the app's original ones)
        let mut held = WINDOW_ICONS.lock().unwrap();
        for old in [held.0, held.1] {
            if old != 0 {
                DestroyIcon(old as _);
            }
        }
        *held = (big as isize, small as isize);
    }
}

/// Points Questly's shortcuts (Desktop, Start menu, pinned to the taskbar) at
/// the current icon, so they match the accent too. Only for the installed copy.
#[tauri::command]
pub fn set_shortcut_icon(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let icon = std::path::PathBuf::from(&path);
        if icon.parent() != Some(icons_dir().as_path()) || !icon.exists() {
            return Err("unknown icon file".into());
        }
        let exe = crate::installed_exe();
        let script = format!(
            r#"$ErrorActionPreference='SilentlyContinue'
$exe={exe}; $icon={icon}
$shell=New-Object -ComObject WScript.Shell
$places=@(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Questly.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Questly.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Questly.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\StartMenu\Questly.lnk')
)
foreach ($p in $places) {{
  if (Test-Path -LiteralPath $p) {{
    $s=$shell.CreateShortcut($p)
    if ($s.TargetPath -ieq $exe) {{ $s.IconLocation="$icon,0"; $s.Save() }}
  }}
}}"#,
            exe = crate::ps_quote(&exe.to_string_lossy()),
            icon = crate::ps_quote(&path),
        );
        crate::run_hidden("powershell", &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])?;
        if let Some(name) = icon.file_name() {
            let _ = std::fs::write(icons_dir().join("shortcuts.txt"), name.to_string_lossy().as_bytes());
        }
        remove_old_icons(&[icon.clone()]);
        // tell Explorer and the taskbar to redraw icons
        unsafe {
            use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
            SHChangeNotify(SHCNE_ASSOCCHANGED as _, SHCNF_IDLIST as _, std::ptr::null(), std::ptr::null());
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = path;
    Ok(())
}
