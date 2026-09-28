//! Device and Discord helpers used by Performance Guard, Legitimate Buddy,
//! Panic Abort and "Launch on startup".

use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::{app_local_dir, run_hidden};

// ----- Performance Guard: CPU and memory load -----

#[derive(Serialize)]
pub struct SystemLoad {
    /// % of CPU time used since the previous call (0 on the first call)
    cpu: f32,
    /// % of physical memory in use
    memory: f32,
    cores: usize,
}

/// (idle, total) CPU times from the previous sample
static LAST_CPU: Mutex<Option<(u64, u64)>> = Mutex::new(None);

#[tauri::command]
pub fn system_load() -> SystemLoad {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::FILETIME;
        use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        use windows_sys::Win32::System::Threading::GetSystemTimes;

        let ft = |f: &FILETIME| ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64;
        let mut idle: FILETIME = unsafe { std::mem::zeroed() };
        let mut kernel: FILETIME = unsafe { std::mem::zeroed() };
        let mut user: FILETIME = unsafe { std::mem::zeroed() };
        let mut cpu = 0.0f64;
        if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } != 0 {
            // kernel time includes idle time
            let (idle_t, total) = (ft(&idle), ft(&kernel) + ft(&user));
            let mut last = LAST_CPU.lock().unwrap();
            if let Some((last_idle, last_total)) = *last {
                let busy_span = total.saturating_sub(last_total);
                if busy_span > 0 {
                    cpu = (1.0 - idle_t.saturating_sub(last_idle) as f64 / busy_span as f64) * 100.0;
                }
            }
            *last = Some((idle_t, total));
        }

        let mut mem: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
        mem.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        let memory = if unsafe { GlobalMemoryStatusEx(&mut mem) } != 0 { mem.dwMemoryLoad as f32 } else { 0.0 };

        return SystemLoad { cpu: cpu.clamp(0.0, 100.0) as f32, memory, cores };
    }
    #[cfg(not(target_os = "windows"))]
    SystemLoad { cpu: 0.0, memory: 0.0, cores }
}

// ----- Legitimate Buddy: how long since the last keyboard/mouse input -----

#[tauri::command]
pub fn idle_seconds() -> u64 {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::SystemInformation::GetTickCount;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        if unsafe { GetLastInputInfo(&mut info) } != 0 {
            let now = unsafe { GetTickCount() };
            return (now.wrapping_sub(info.dwTime) / 1000) as u64;
        }
        0
    }
    #[cfg(not(target_os = "windows"))]
    0
}

/// Ids of games Questly has already set up on this PC (their dummy files exist).
#[tauri::command]
pub fn installed_game_ids() -> Vec<String> {
    std::fs::read_dir(app_local_dir().join("games"))
        .map(|dir| {
            dir.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default()
}

// ----- Discord check: is it running, open it, close it -----

/// (id, display name, install folder under %LOCALAPPDATA%, process name)
const DISCORD_CLIENTS: [(&str, &str, &str, &str); 4] = [
    ("discord", "Discord", "Discord", "Discord.exe"),
    ("discordptb", "Discord PTB", "DiscordPTB", "DiscordPTB.exe"),
    ("discordcanary", "Discord Canary", "DiscordCanary", "DiscordCanary.exe"),
    ("discorddevelopment", "Discord Development", "DiscordDevelopment", "DiscordDevelopment.exe"),
];

fn running_process_names() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
        };
        let mut names = Vec::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return names;
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if Process32FirstW(snap, &mut entry) != 0 {
                loop {
                    let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                    names.push(String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase());
                    if Process32NextW(snap, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
        }
        names
    }
    #[cfg(not(target_os = "windows"))]
    Vec::new()
}

fn discord_update_exe(folder: &str) -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    let path = base.join(folder).join("Update.exe");
    path.exists().then_some(path)
}

#[derive(Serialize)]
pub struct DiscordClient {
    id: String,
    name: String,
    installed: bool,
    running: bool,
}

#[tauri::command]
pub fn discord_status() -> Vec<DiscordClient> {
    let running = running_process_names();
    DISCORD_CLIENTS
        .iter()
        .map(|(id, name, folder, exe)| DiscordClient {
            id: id.to_string(),
            name: name.to_string(),
            installed: discord_update_exe(folder).is_some(),
            running: running.iter().any(|p| p == &exe.to_lowercase()),
        })
        .filter(|c| c.installed || c.running)
        .collect()
}

#[tauri::command]
pub fn start_discord(id: String) -> Result<(), String> {
    let (_, name, folder, exe) = DISCORD_CLIENTS
        .iter()
        .find(|c| c.0 == id)
        .ok_or_else(|| format!("Unknown Discord client: {}", id))?;
    let update = discord_update_exe(folder).ok_or_else(|| format!("{} isn't installed", name))?;
    std::process::Command::new(update)
        .args(["--processStart", exe])
        .spawn()
        .map_err(|e| format!("Couldn't start {}: {}", name, e))?;
    Ok(())
}

#[tauri::command]
pub fn close_discord(id: String) -> Result<(), String> {
    let (_, _, _, exe) = DISCORD_CLIENTS
        .iter()
        .find(|c| c.0 == id)
        .ok_or_else(|| format!("Unknown Discord client: {}", id))?;
    #[cfg(target_os = "windows")]
    {
        // /F: Discord otherwise just minimizes to its tray
        run_hidden("taskkill", &["/F", "/IM", exe])
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = exe;
        Ok(())
    }
}

// ----- Panic Abort: end every game window, tracked or not -----

#[tauri::command]
pub fn kill_all_runners() -> usize {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
        use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowExW, GetWindowThreadProcessId};

        let class: Vec<u16> = "DQCTray\0".encode_utf16().collect();
        let mut pids: Vec<u32> = Vec::new();
        let mut hwnd = std::ptr::null_mut();
        loop {
            hwnd = unsafe { FindWindowExW(std::ptr::null_mut(), hwnd, class.as_ptr(), std::ptr::null()) };
            if hwnd.is_null() {
                break;
            }
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
            if pid != 0 && !pids.contains(&pid) {
                pids.push(pid);
            }
        }
        let mut killed = 0;
        for pid in pids {
            unsafe {
                let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
                if !handle.is_null() {
                    if TerminateProcess(handle, 1) != 0 {
                        killed += 1;
                    }
                    CloseHandle(handle);
                }
            }
        }
        killed
    }
    #[cfg(not(target_os = "windows"))]
    0
}

// ----- Launch on startup (per-user Run key, no admin needed) -----

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

#[tauri::command]
pub fn get_autostart() -> bool {
    #[cfg(target_os = "windows")]
    {
        run_hidden("reg", &["query", RUN_KEY, "/v", "Questly"]).is_ok()
    }
    #[cfg(not(target_os = "windows"))]
    false
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let value = format!("\"{}\" --autostart", exe.display());
            run_hidden("reg", &["add", RUN_KEY, "/v", "Questly", "/t", "REG_SZ", "/d", &value, "/f"])
        } else {
            // missing value = already off
            let _ = run_hidden("reg", &["delete", RUN_KEY, "/v", "Questly", "/f"]);
            Ok(())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Err("Launch on startup is only available on Windows".into())
    }
}
