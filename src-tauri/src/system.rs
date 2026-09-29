//! Device and Discord helpers used by Performance Guard, Legitimate Buddy,
//! Panic Abort and "Launch on startup".

use serde::Serialize;
use std::collections::HashSet;
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
    /// physical memory in MB: all of it, and what's free right now
    total_mb: u64,
    free_mb: u64,
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
        let ok = unsafe { GlobalMemoryStatusEx(&mut mem) } != 0;
        let memory = if ok { mem.dwMemoryLoad as f32 } else { 0.0 };
        let (total_mb, free_mb) = if ok { (mem.ullTotalPhys >> 20, mem.ullAvailPhys >> 20) } else { (0, 0) };

        return SystemLoad { cpu: cpu.clamp(0.0, 100.0) as f32, memory, cores, total_mb, free_mb };
    }
    #[cfg(not(target_os = "windows"))]
    SystemLoad { cpu: 0.0, memory: 0.0, cores, total_mb: 0, free_mb: 0 }
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

// ----- game window tray icons -----
// A game window adds a tray icon and removes it when it closes. A game that is
// force-stopped can't, and Windows then keeps showing its icon until the mouse
// passes over it; once the process is gone nothing can remove it any more. So
// Questly takes a game's icon down itself, while its window still exists, right
// before stopping it.

/// Every game window (class "DQCTray") with the id of its process.
#[cfg(target_os = "windows")]
fn runner_windows() -> Vec<(windows_sys::Win32::Foundation::HWND, u32)> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowExW, GetWindowThreadProcessId};

    let class: Vec<u16> = "DQCTray\0".encode_utf16().collect();
    let mut found = Vec::new();
    let mut hwnd = std::ptr::null_mut();
    loop {
        hwnd = unsafe { FindWindowExW(std::ptr::null_mut(), hwnd, class.as_ptr(), std::ptr::null()) };
        if hwnd.is_null() {
            break;
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        if pid != 0 {
            found.push((hwnd, pid));
        }
    }
    found
}

#[cfg(target_os = "windows")]
fn remove_runner_tray_icon(hwnd: windows_sys::Win32::Foundation::HWND) {
    use windows_sys::Win32::UI::Shell::{Shell_NotifyIconW, NIM_DELETE, NOTIFYICONDATAW};

    let mut nid: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
    nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    nid.hWnd = hwnd;
    nid.uID = 1; // a game window's only icon (src-win/src/main.cpp)
    // fails harmlessly when the icon is already hidden (Auto hide, --hidden)
    unsafe { Shell_NotifyIconW(NIM_DELETE, &nid) };
}

/// The file name of a running process's program ("VALORANT.exe").
#[cfg(target_os = "windows")]
fn process_file_name(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut len);
        CloseHandle(handle);
        if ok == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        std::path::Path::new(&path).file_name().map(|f| f.to_string_lossy().to_string())
    }
}

/// Takes down the tray icons of the game windows running as `exe_name`, before they're stopped.
pub fn remove_runner_tray_icons(exe_name: &str) {
    remove_runner_tray_icons_of(&HashSet::from([exe_name.to_lowercase()]));
}

/// The same for several games (`exe_names` in lowercase), in one pass over the
/// game windows however many are running.
pub fn remove_runner_tray_icons_of(exe_names: &HashSet<String>) {
    #[cfg(target_os = "windows")]
    for (hwnd, pid) in runner_windows() {
        if process_file_name(pid).is_some_and(|name| exe_names.contains(&name.to_lowercase())) {
            remove_runner_tray_icon(hwnd);
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = exe_names;
}

/// Ends every running program whose file is `exe_name`, like `taskkill /F /IM`, but
/// through the Windows API: no console program is started, so no window opens or
/// takes the focus. Returns how many were ended.
pub fn terminate_by_name(exe_name: &str) -> Result<usize, String> {
    terminate_by_names(&HashSet::from([exe_name.to_lowercase()]))
}

/// The same for several files (`exe_names` in lowercase), from one list of the
/// running programs, so Stop all stays quick with thousands of games.
pub fn terminate_by_names(exe_names: &HashSet<String>) -> Result<usize, String> {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
        };
        use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err("Couldn't list the running programs.".into());
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut pids = Vec::new();
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                if exe_names.contains(&String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase()) {
                    pids.push(entry.th32ProcessID);
                }
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
        let mut ended = 0;
        for pid in pids {
            let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if !handle.is_null() {
                // exit code 1, as taskkill /F: Questly doesn't mistake it for "closed from its window"
                if TerminateProcess(handle, 1) != 0 {
                    ended += 1;
                }
                CloseHandle(handle);
            }
        }
        Ok(ended)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = exe_names;
        Ok(0)
    }
}

// ----- Panic Abort: end every game window, tracked or not -----

#[tauri::command]
pub fn kill_all_runners() -> usize {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

        let mut pids: Vec<u32> = Vec::new();
        for (hwnd, pid) in runner_windows() {
            remove_runner_tray_icon(hwnd);
            if !pids.contains(&pid) {
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

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    /// Starts the real game program (build it first: `pnpm build:runner:win`), takes
    /// its tray icon down the way Stop does, and checks Windows no longer has it.
    /// Shows a tray icon for a moment, so it only runs when asked:
    /// `cargo test --lib -- --ignored tray_icon`
    #[test]
    #[ignore]
    fn tray_icon_is_removed_before_a_game_is_stopped() {
        use windows_sys::Win32::UI::Shell::{Shell_NotifyIconGetRect, NOTIFYICONIDENTIFIER};

        let exe = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src-win/target/release/src-win.exe");
        let mut child = std::process::Command::new(&exe).args(["--title", "Questly test"]).spawn().expect("runner");
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let hwnd = runner_windows().into_iter().find(|(_, pid)| *pid == child.id()).expect("game window").0;
        let has_icon = || unsafe {
            let mut id: NOTIFYICONIDENTIFIER = std::mem::zeroed();
            id.cbSize = std::mem::size_of::<NOTIFYICONIDENTIFIER>() as u32;
            id.hWnd = hwnd;
            id.uID = 1;
            let mut rect = std::mem::zeroed();
            Shell_NotifyIconGetRect(&id, &mut rect) == 0
        };
        assert!(has_icon(), "the game window should show a tray icon");
        remove_runner_tray_icons("SRC-WIN.EXE");
        let removed = !has_icon();
        let _ = child.kill();
        assert!(removed, "the tray icon should be gone before the game is stopped");
    }

    /// Stop ends a game without starting any other program (no console window
    /// can pop up): `cargo test --lib -- --ignored stop_ends`
    #[test]
    #[ignore]
    fn stop_ends_the_game_without_a_helper_program() {
        let exe = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src-win/target/release/src-win.exe");
        let mut child = std::process::Command::new(&exe).args(["--title", "Questly test"]).spawn().expect("runner");
        std::thread::sleep(std::time::Duration::from_millis(1500));
        remove_runner_tray_icons("src-win.exe");
        let ended = terminate_by_name("src-win.exe").unwrap();
        let status = child.wait().unwrap();
        assert!(ended >= 1, "the game should have been ended");
        assert_eq!(status.code(), Some(1), "ended like taskkill /F, not as if closed from its window");
        assert_eq!(terminate_by_name("src-win.exe").unwrap(), 0, "nothing left to end");
    }

    /// Stop all ends games with different file names in one go (hidden game
    /// windows, so no tray icons show): `cargo test --lib -- --ignored stop_all`
    #[test]
    #[ignore]
    fn stop_all_ends_every_game_in_one_go() {
        let runner = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src-win/target/release/src-win.exe");
        let dir = std::env::temp_dir().join(format!("questly-stop-all-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let names = ["questly-test-a.exe", "questly-test-b.exe", "questly-test-c.exe"];
        let mut children: Vec<_> = names
            .iter()
            .map(|name| {
                let exe = dir.join(name);
                std::fs::copy(&runner, &exe).expect("copy of the game program");
                std::process::Command::new(&exe).args(["--title", "Questly test", "--hidden"]).spawn().expect("runner")
            })
            .collect();
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let set: HashSet<String> = names.iter().map(|n| n.to_string()).collect();
        remove_runner_tray_icons_of(&set);
        let ended = terminate_by_names(&set).unwrap();
        let codes: Vec<_> = children.iter_mut().map(|c| c.wait().unwrap().code()).collect();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(ended, names.len(), "every game should have been ended");
        assert!(codes.iter().all(|c| *c == Some(1)), "all ended like taskkill /F: {:?}", codes);
        assert_eq!(terminate_by_names(&set).unwrap(), 0, "nothing left to end");
    }
}