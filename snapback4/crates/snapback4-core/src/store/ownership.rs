//! Compatible native device ownership, retained by the SQLite store.
use super::*;

impl Store {
    // @ref LLP 3000.019#3.4 — native entry points share the sidecar flock, leaving SQLite's inode locks alone.
    pub fn open_shared(path: &Path) -> Result<Self, RuntimeError> {
        #[cfg(unix)]
        {
            use std::{fs, os::unix::fs::MetadataExt, sync::Arc};
            let failure = |e| RuntimeError::Store(format!("device store at {}: {e}; reopen a regular device store", path.display()));
            for _ in 0..16 {
                let real = match path.canonicalize() {
                    Ok(real) => real,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
                        crate::private_fs::directory(parent).map_err(&failure)?;
                        parent.canonicalize().map_err(&failure)?.join(path.file_name().ok_or_else(|| failure(std::io::Error::other("missing filename")))?)
                    }
                    Err(e) => return Err(failure(e)),
                };
                let before = crate::private_fs::database_metadata(&real).map_err(&failure)?;
                let owner = crate::private_fs::owner_file(&real).map_err(&failure)?;
                owner.try_lock_shared().map_err(|e| match e {
                    fs::TryLockError::WouldBlock => RuntimeError::StoreBusy { path: real.display().to_string() },
                    fs::TryLockError::Error(e) => failure(e),
                })?;
                if !crate::private_fs::owner_is_named(&real, &owner) { continue; }
                // Create only after ownership; WouldBlock leaves a moved
                // store's old path absent instead of manufacturing a database.
                crate::private_fs::database_file(&real).map_err(&failure)?;
                let meta = crate::private_fs::database_metadata(&real).map_err(&failure)?
                    .ok_or_else(|| failure(std::io::Error::other("database disappeared during ownership acquisition")))?;
                let identity = (meta.dev(), meta.ino());
                if before.is_some_and(|m| (m.dev(), m.ino()) != identity) { continue; }
                let mut store = Self::open_base(&real, std::time::Duration::from_secs(5), false)?;
                if store.file_identity != Some(identity) {
                    return Err(RuntimeError::Store(format!("owned database at {} moved or was replaced; stop and reopen its current path", real.display())));
                }
                if !crate::private_fs::owner_is_named(&real, &owner) {
                    return Err(RuntimeError::Store(format!("ownership sidecar at {} changed during open; stop all owners and reopen the store; leave <database>-owner in place because deleting it while a process runs ends exclusion", real.display())));
                }
                crate::private_fs::database_metadata(&real).map_err(&failure)?;
                store.retain_ownership(Arc::new(owner))?;
                return Ok(store);
            }
            Err(failure(std::io::Error::other("database path kept changing during ownership acquisition")))
        }
        #[cfg(not(unix))]
        Err(RuntimeError::Store(format!("device ownership at {} requires Unix", path.display())))
    }
}

impl Store {
    // @ref LLP 3000.019#3.4 — retain the lock for the connection's lifetime; exclusion requires leaving its sidecar in place.
    #[cfg(unix)]
    pub fn retain_ownership(&mut self, owner: std::sync::Arc<std::fs::File>) -> Result<(), RuntimeError> {
        self.ownership = Some(owner);
        self.check_ownership()
    }

    pub fn check_ownership(&self) -> Result<(), RuntimeError> {
        #[cfg(unix)]
        if self.ownership.is_some() {
            let path = Path::new(self.conn.path().unwrap_or_default());
            // Preserve the stat-only database/hard-link check. This is not
            // revocation: raw conn() users do not pass through this method.
            // Deleting the sidecar ends exclusion without stopping old work.
            crate::private_fs::database_metadata(path)
                .map_err(|e| RuntimeError::Store(format!("database at {}: {e}", path.display())))?;
        }
        Ok(())
    }
}
