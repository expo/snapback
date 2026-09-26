//! The host and offline CLI writers share the store's lifetime ownership.
use std::{fs::{File, OpenOptions}, io::{Read, Seek, SeekFrom, Write}, path::{Path, PathBuf}};

pub(crate) fn directory(store: &Path) -> Result<PathBuf, String> {
    let path = if store.exists() { store.canonicalize().map_err(|e| e.to_string())? } else { store.to_path_buf() };
    path.parent().map(Path::to_path_buf).ok_or_else(|| "store path has no parent".into())
}

// @ref LLP 3000.019#3.4 — refuse before opening SQLite; keep ownership until the command or host exits.
pub(crate) fn acquire(dir: &Path) -> Result<File, String> {
    snapback4_core::private_fs::directory(dir).map_err(|e| e.to_string())?;
    let path = dir.join("serve.lock");
    let mut file = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(&path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    file.try_lock().map_err(|error| match error {
        std::fs::TryLockError::WouldBlock => {
            let mut text = String::new();
            let _ = (&mut file).take(1024).read_to_string(&mut text);
            let mut lines = text.lines();
            let port = lines.next().and_then(|line| line.parse::<u16>().ok());
            let owner = lines.next().map(str::to_owned).or_else(|| port.map(|p| format!("http://127.0.0.1:{p}")))
                .unwrap_or_else(|| "another CLI command or a server starting up (address pending)".into());
            format!("E_STORE_BUSY at {}: this store is live; owned by {owner}; no work was admitted. Stop its `snapback4 dev` or `snapback4 serve` process (or wait for the owning CLI command), rerun this command once, then restart the server", path.display())
        }
        std::fs::TryLockError::Error(error) => format!("cannot lock {}: {error}", path.display()),
    })?;
    // A stale address is not a live server; the OS lock alone decides ownership.
    file.set_len(0).map_err(|e| e.to_string())?;
    Ok(file)
}

pub(crate) fn command(store: &Path) -> Result<File, String> { acquire(&directory(store)?) }

pub(crate) fn announce(file: &mut File, address: std::net::SocketAddr) -> Result<(), String> {
    file.set_len(0).and_then(|_| file.seek(SeekFrom::Start(0))).map_err(|e| e.to_string())?;
    // Keep the legacy first-line port for the dev inspector; the second line
    // preserves a non-default bind address, including IPv6.
    write!(file, "{}\nhttp://{address}\n", address.port()).map_err(|e| e.to_string())
}
