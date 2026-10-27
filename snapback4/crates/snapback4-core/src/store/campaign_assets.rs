//! Immutable verified bytes for private replay worlds; ledgers remain per-store.
// @ref LLP 3000.036.004.000.000#campaign-byte-snapshots — immutable bytes never supply ledger authority.
use super::*;
use std::{
    io::{Read, Write},
    sync::Arc,
};
const LIMIT: usize = 32 * 1024 * 1024;
const ENTRIES: usize = 65_536;
#[derive(Clone)]
pub(super) struct Snapshot {
    bytes: usize,
    blobs: Arc<BTreeMap<String, Arc<Vec<u8>>>>,
}
impl Snapshot {
    fn empty() -> Self {
        Self {
            bytes: 0,
            blobs: Arc::new(BTreeMap::new()),
        }
    }
}
fn read_bounded(path: &Path, limit: usize) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(std::io::Error::other("campaign byte cache limit"));
    }
    Ok(bytes)
}
impl Store {
    /// Only deterministic campaigns opt in. Ordinary stores retain byte copies.
    #[doc(hidden)]
    pub fn memory_for_campaign() -> Result<Self, RuntimeError> {
        let store = Self::memory()?;
        store.campaign_assets.replace(Some(Snapshot::empty()));
        Ok(store)
    }
    pub(crate) fn campaign_assets_enabled(&self) -> bool {
        self.campaign_assets.borrow().is_some()
    }
    pub(crate) fn capture_campaign_assets(&self) -> Result<(), RuntimeError> {
        if self.campaign_assets_enabled() {
            return Ok(());
        }
        let mut snapshot = Snapshot::empty();
        let mut paths = Vec::new();
        if self.assets_dir.exists() {
            for entry in std::fs::read_dir(&self.assets_dir).map_err(io)? {
                if snapshot.blobs.len() >= ENTRIES {
                    return Err(RuntimeError::Store(
                        "campaign byte cache entry limit".into(),
                    ));
                }
                let entry = entry.map_err(io)?;
                if !entry.file_type().map_err(io)?.is_file() {
                    return Err(RuntimeError::Store(
                        "fixture asset is not a regular file".into(),
                    ));
                }
                let bytes = read_bounded(&entry.path(), LIMIT - snapshot.bytes).map_err(io)?;
                snapshot.bytes += bytes.len();
                let name = entry
                    .file_name()
                    .into_string()
                    .map_err(|_| RuntimeError::Store("fixture asset name is not UTF-8".into()))?;
                Arc::make_mut(&mut snapshot.blobs).insert(name, Arc::new(bytes));
                paths.push(entry.path());
            }
        }
        // Install only a complete snapshot; a failed capture leaves the normal
        // fork untouched. Failed unlinks merely retain an ordinary private copy.
        self.campaign_assets.replace(Some(snapshot));
        for path in paths {
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    }
    pub(crate) fn retain_campaign_asset(&self, id: &str) {
        let remaining = match self.campaign_assets.borrow().as_ref() {
            Some(s) if s.blobs.len() < ENTRIES || s.blobs.contains_key(id) => {
                LIMIT.saturating_sub(s.bytes)
            }
            _ => return,
        };
        if remaining == 0 {
            return;
        }
        let path = self.asset_path(id);
        let Ok(bytes) = read_bounded(&path, remaining) else {
            return;
        };
        let mut cache = self.campaign_assets.borrow_mut();
        let Some(snapshot) = cache.as_mut() else {
            return;
        };
        if bytes.len() > LIMIT.saturating_sub(snapshot.bytes) {
            return;
        }
        let size = bytes.len();
        let old = Arc::make_mut(&mut snapshot.blobs).insert(id.into(), Arc::new(bytes));
        snapshot.bytes = snapshot.bytes.saturating_sub(old.map_or(0, |b| b.len())) + size;
        drop(cache);
        let _ = std::fs::remove_file(path);
    }
    pub(crate) fn materialize_campaign_asset(&self, id: &str) -> Result<(), RuntimeError> {
        let bytes = self
            .campaign_assets
            .borrow()
            .as_ref()
            .and_then(|s| s.blobs.get(id).cloned());
        let Some(bytes) = bytes else {
            return Ok(());
        };
        let path = self.asset_path(id);
        if path.exists() {
            return Ok(());
        }
        crate::private_fs::directory(&self.assets_dir).map_err(io)?;
        let mut file = match crate::private_fs::file(&path, true) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return Ok(()),
            Err(e) => return Err(io(e)),
        };
        if let Err(e) = file.write_all(&bytes) {
            let _ = std::fs::remove_file(path);
            return Err(io(e));
        }
        Ok(())
    }
}
fn io(e: std::io::Error) -> RuntimeError {
    RuntimeError::Store(e.to_string())
}
