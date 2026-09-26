//! Project-local dev discovery, independent of the serving store's ownership lock.
// @ref LLP 3000.019#3.7 — fresh/temporary stores advertise the same inspector.
use crate::project::Project;
use serde::{Deserialize, Serialize};
use std::{fs::{self, File, OpenOptions}, io::{self, Read, Write}, path::{Path, PathBuf}};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

#[derive(Serialize, Deserialize)]
pub(crate) struct Address {
    pub project: PathBuf,
    pub port: u16,
    pub store_id: String,
    pub temporary: bool,
}
pub(crate) struct Registration { path: PathBuf, file: File }

fn open(path: &Path, create: bool) -> io::Result<File> {
    let file = OpenOptions::new().read(true).write(create).create(create)
        .mode(0o600).custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK).open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file() || meta.nlink() != 1 || meta.uid() != unsafe { libc::geteuid() } {
        return Err(io::Error::other("dev address must be an owned regular file with one link"));
    }
    Ok(file)
}
fn same_file(path: &Path, file: &File) -> bool {
    let Ok(path) = fs::symlink_metadata(path) else { return false; };
    let Ok(file) = file.metadata() else { return false; };
    path.is_file() && path.nlink() == 1 && path.dev() == file.dev() && path.ino() == file.ino()
}
impl Registration {
    pub fn new(project: &Project, port: u16, store_id: String, temporary: bool) -> Result<Self, String> {
        let create = || -> io::Result<Self> {
            fs::create_dir_all(project.data_dir())?;
            let path = project.data_dir().join(format!("dev-address-{port}.json"));
            let mut file = open(&path, true)?;
            file.try_lock().map_err(io::Error::other)?;
            if !same_file(&path, &file) { return Err(io::Error::other("dev address changed while opening")); }
            let address = Address { project: project.root.canonicalize()?, port, store_id, temporary };
            let bytes = serde_json::to_vec(&address)?;
            file.set_len(0)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            Ok(Self { path, file })
        };
        let record = create().map_err(|e| format!("cannot advertise dev inspector: {e}; remove the stale or unsafe dev-address file in .snapback4 and retry snapback4 dev"))?;
        // Orderly termination runs Registration::drop even without a child worker.
        crate::lifecycle::address_cleanup();
        Ok(record)
    }
}
impl Drop for Registration {
    fn drop(&mut self) {
        if same_file(&self.path, &self.file) { let _ = fs::remove_file(&self.path); }
    }
}

/// Newest live host first; multiple fresh hosts may coexist. A crash can leave
/// a file, but only a held lifetime lock plus matching HTTP identity is live.
pub(crate) fn read(project: &Project) -> Vec<Address> {
    let Some(root) = project.root.canonicalize().ok() else { return Vec::new(); };
    let Ok(entries) = fs::read_dir(project.data_dir()) else { return Vec::new(); };
    let mut records = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(port) = name.to_str().and_then(|s| s.strip_prefix("dev-address-")).and_then(|s| s.strip_suffix(".json")).and_then(|s| s.parse::<u16>().ok()) else { continue; };
        let path = entry.path();
        let Ok(file) = open(&path, false) else { continue; };
        if !matches!(file.try_lock(), Err(fs::TryLockError::WouldBlock)) { continue; }
        if !same_file(&path, &file) { continue; }
        let modified = file.metadata().and_then(|m| m.modified()).ok();
        let mut bytes = Vec::new();
        if file.take(8193).read_to_end(&mut bytes).is_err() || bytes.len() > 8192 { continue; }
        let Ok(address) = serde_json::from_slice::<Address>(&bytes) else { continue; };
        if address.project == root && address.port == port { records.push((modified, address)); }
    }
    records.sort_by(|a, b| b.0.cmp(&a.0));
    records.into_iter().map(|(_, address)| address).collect()
}

#[cfg(test)]
#[path = "../tests/latency/discovery.rs"]
mod tests;
