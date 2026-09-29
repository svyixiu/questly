//! Updates from GitHub: Settings → About → Check for updates.
//!
//! The latest release is read from GitHub's API. Its Questly.exe is downloaded
//! into %LOCALAPPDATA%\Questly\updates with progress events, and its SHA-256 is
//! checked against the checksum GitHub publishes for it before anything runs.
//! Then Questly quits and starts the new file with `--update`, which installs
//! itself over this one and opens the installed copy.
//!
//! The download address and checksum stay on this side: the interface can only
//! ask to check, download, cancel or install, never pass a file or URL.

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const REPO: &str = "svyixiu/questly";
const ASSET: &str = "Questly.exe";

/// What the last check found, when there's something newer.
struct Release {
    version: String,
    url: String,
    sha256: String,
    size: u64,
}

static FOUND: Mutex<Option<Release>> = Mutex::new(None);
/// the downloaded file, once its checksum matched
static READY: Mutex<Option<PathBuf>> = Mutex::new(None);
static DOWNLOADING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
pub struct UpdateInfo {
    current: String,
    latest: String,
    available: bool,
    /// the release notes (Markdown, as written on GitHub)
    notes: String,
    published_at: String,
    /// bytes to download
    size: u64,
    /// the release page, to read it in a browser
    page: String,
}

#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: u64,
}

fn updates_dir() -> PathBuf {
    crate::app_local_dir().join("updates")
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Questly/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

/// A 64-character hex checksum, in lowercase.
fn valid_sha256(s: &str) -> Option<String> {
    let s = s.trim().to_ascii_lowercase();
    (s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())).then_some(s)
}

/// Older releases only have the checksum in their notes ("SHA-256: `…`").
fn sha256_in_notes(notes: &str) -> Option<String> {
    let after = &notes[notes.find("SHA-256")?..];
    after
        .split(|c: char| !c.is_ascii_hexdigit())
        .find(|word| word.len() == 64)
        .and_then(valid_sha256)
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.clone();
    let release: Value = client()?
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub couldn't answer right now: {e}"))?
        .json()
        .await
        .map_err(|e| format!("GitHub's answer couldn't be read: {e}"))?;

    let tag = release["tag_name"].as_str().unwrap_or_default();
    let latest = semver::Version::parse(tag.trim_start_matches('v'))
        .map_err(|_| format!("The latest release has an unexpected version: {tag}"))?;
    let notes = release["body"].as_str().unwrap_or_default().to_string();
    let available = latest > current;

    let mut size = 0;
    *FOUND.lock().unwrap() = None;
    if available {
        let asset = release["assets"]
            .as_array()
            .and_then(|assets| assets.iter().find(|a| a["name"].as_str() == Some(ASSET)))
            .ok_or(format!("Questly {latest} is out, but its release has no {ASSET} to download yet."))?;
        let url = asset["browser_download_url"].as_str().unwrap_or_default().to_string();
        // only files attached to this project's own releases
        let expected = format!("https://github.com/{REPO}/releases/download/").to_ascii_lowercase();
        if !url.to_ascii_lowercase().starts_with(&expected) {
            return Err("The update's download address isn't one of Questly's releases, so it wasn't used.".into());
        }
        let sha256 = asset["digest"]
            .as_str()
            .and_then(|d| d.strip_prefix("sha256:"))
            .and_then(valid_sha256)
            .or_else(|| sha256_in_notes(&notes))
            .ok_or("GitHub doesn't list a checksum for this update, so it can't be checked. Download it from the website instead.")?;
        size = asset["size"].as_u64().unwrap_or(0);
        *FOUND.lock().unwrap() = Some(Release { version: latest.to_string(), url, sha256, size });
    }

    Ok(UpdateInfo {
        current: current.to_string(),
        latest: latest.to_string(),
        available,
        notes,
        published_at: release["published_at"].as_str().unwrap_or_default().to_string(),
        size,
        page: release["html_url"].as_str().unwrap_or_default().to_string(),
    })
}

/// Downloads the update found by the last check, with "update_progress" events.
/// Errors with "cancelled" when cancel_update_download stopped it.
#[tauri::command]
pub async fn download_update(app: AppHandle) -> Result<(), String> {
    let (version, url, sha256, size) = {
        let found = FOUND.lock().unwrap();
        let r = found.as_ref().ok_or("Check for updates first.")?;
        (r.version.clone(), r.url.clone(), r.sha256.clone(), r.size)
    };
    if DOWNLOADING.swap(true, Ordering::SeqCst) {
        return Err("The update is already downloading.".into());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let result = download(&app, &version, &url, &sha256, size).await;
    DOWNLOADING.store(false, Ordering::SeqCst);
    result
}

async fn download(app: &AppHandle, version: &str, url: &str, sha256: &str, size: u64) -> Result<(), String> {
    let dir = updates_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make {}: {e}", dir.display()))?;
    let part = dir.join(format!("Questly-{version}.exe.part"));
    let done = dir.join(format!("Questly-{version}.exe"));

    let mut response = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Couldn't start the download: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub couldn't send the file: {e}"))?;
    let total = response.content_length().unwrap_or(size);
    let mut file = fs::File::create(&part).map_err(|e| format!("Couldn't save the download: {e}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;
    let mut last_event = Instant::now();
    let _ = app.emit("update_progress", Progress { downloaded, total });

    let outcome: Result<(), String> = async {
        loop {
            if CANCEL.load(Ordering::SeqCst) {
                return Err("cancelled".to_string());
            }
            let chunk = tokio::time::timeout(Duration::from_secs(30), response.chunk())
                .await
                .map_err(|_| "The download stalled. Check your connection and try again.".to_string())?
                .map_err(|e| format!("The download stopped: {e}"))?;
            let Some(chunk) = chunk else { break };
            file.write_all(&chunk).map_err(|e| format!("Couldn't save the download: {e}"))?;
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;
            if last_event.elapsed() >= Duration::from_millis(100) {
                last_event = Instant::now();
                let _ = app.emit("update_progress", Progress { downloaded, total });
            }
        }
        let _ = app.emit("update_progress", Progress { downloaded, total });
        file.flush().map_err(|e| format!("Couldn't save the download: {e}"))?;
        if format!("{:x}", hasher.finalize()) != sha256 {
            return Err("The downloaded file doesn't match the checksum GitHub lists for it, so it wasn't used. Try again.".into());
        }
        Ok(())
    }
    .await;
    drop(file);

    if let Err(e) = outcome {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    let _ = fs::remove_file(&done);
    fs::rename(&part, &done).map_err(|e| format!("Couldn't finish the download: {e}"))?;
    *READY.lock().unwrap() = Some(done);
    Ok(())
}

#[tauri::command]
pub fn cancel_update_download() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Quits and starts the downloaded version. An installed Questly passes
/// `--update`, so the new file installs itself over this one and opens it.
#[tauri::command]
pub fn install_update(app: AppHandle) -> Result<(), String> {
    let path = READY.lock().unwrap().clone().ok_or("Download the update first.")?;
    if !path.is_file() {
        return Err("The downloaded update is gone. Check for updates again.".into());
    }
    let installed = std::env::current_exe()
        .map(|this| crate::same_file(&this, &crate::installed_exe()))
        .unwrap_or(false);
    let args: &[&str] = if installed { &["--update"] } else { &[] };
    crate::quit_and_start(&app, &path, args)
}

/// Downloads that were installed (or given up on) are removed the next time
/// the installed Questly starts.
pub fn clean_old_downloads() {
    let installed = std::env::current_exe()
        .map(|this| crate::same_file(&this, &crate::installed_exe()))
        .unwrap_or(false);
    if installed && !std::env::args().any(|a| a == "--update") {
        std::thread::spawn(|| {
            let _ = fs::remove_dir_all(updates_dir());
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_checksum_in_release_notes() {
        let notes = "Download **Questly.exe** below.\n\nSHA-256: `A57F7D40E65E7D10D699F2F31DD297070A8D6CF143A71C9AAA66BA95206F11EF`\n";
        assert_eq!(
            sha256_in_notes(notes).as_deref(),
            Some("a57f7d40e65e7d10d699f2f31dd297070a8d6cf143a71c9aaa66ba95206f11ef")
        );
        assert_eq!(sha256_in_notes("no checksum here"), None);
        assert_eq!(sha256_in_notes("SHA-256: `abc123`"), None);
    }
}
