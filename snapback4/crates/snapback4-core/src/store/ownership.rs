//! Compatible native device ownership, retained by the SQLite store.
use super::*;

impl Store {
    // @ref LLP 3000.019#3.4 — every native entry point excludes a backend owner before initializing the device.
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
                // Declare the guard before SQLite so error paths also close the
                // connection first. The successful store retains the same guard.
                let owner = crate::private_fs::file(&real, false).map_err(&failure)?;
                let locked = owner.try_lock_shared();
                let meta = owner.metadata().map_err(&failure)?;
                let identity = (meta.dev(), meta.ino());
                if !fs::metadata(&real).is_ok_and(|m| (m.dev(), m.ino()) == identity) { continue; }
                locked.map_err(|e| match e {
                    fs::TryLockError::WouldBlock => RuntimeError::StoreBusy { path: real.display().to_string() },
                    fs::TryLockError::Error(e) => failure(e),
                })?;
                let mut store = Store::open(&real)?;
                if store.file_identity != Some(identity) {
                    return Err(RuntimeError::Store(format!("owned database at {} moved or was replaced; stop and reopen its current path", real.display())));
                }
                store.ownership = Some(Arc::new(owner));
                return Ok(store);
            }
            Err(failure(std::io::Error::other("database path kept changing during ownership acquisition")))
        }
        #[cfg(not(unix))]
        Err(RuntimeError::Store(format!("device ownership at {} requires Unix", path.display())))
    }
}
