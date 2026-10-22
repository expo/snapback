//! Completion files are namespaced by logical identity, never a connection URL.
// @ref LLP 3000.009.001.000#3.4 — Postgres workers require an explicit durable state directory and store binding.
use crate::{RuntimeError, store_port::AnyStore};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
impl AnyStore {
    pub fn worker_ledger_path(
        &self,
        state_directory: Option<&Path>,
    ) -> Result<PathBuf, RuntimeError> {
        let directory = match self.database_path().filter(|path| !path.is_empty()) {
            Some(path) => Path::new(path)
                .canonicalize()
                .map_err(|error| RuntimeError::Store(error.to_string()))?
                .parent()
                .ok_or_else(|| RuntimeError::Store("worker ledger store parent is absent".into()))?
                .to_path_buf(),
            None => {
                #[cfg(feature = "postgres")]
                if matches!(self, Self::Postgres(_)) {
                    // Identity precedes location: an unbound store always
                    // refuses by name, even if its state directory is absent.
                    self.store_identity()?
                        .filter(|id| !id.is_empty())
                        .ok_or(RuntimeError::WorkerStoreIdentity)?;
                    state_directory.filter(|path| path.is_absolute()).ok_or_else(|| RuntimeError::Structural {
                        code: "E_WORKER_STATE", message: "Postgres worker ledger requires an explicit absolute durable state directory".into(),
                    })?.to_path_buf()
                } else {
                    return Err(RuntimeError::Store(
                        "worker ledger needs a file-backed store".into(),
                    ));
                }
                #[cfg(not(feature = "postgres"))]
                {
                    let _ = state_directory;
                    return Err(RuntimeError::Store(
                        "worker ledger needs a file-backed store".into(),
                    ));
                }
            }
        };
        let id = self
            .store_identity()?
            .filter(|id| !id.is_empty())
            .ok_or(RuntimeError::WorkerStoreIdentity)?;
        let namespace = format!("{:x}", Sha256::digest(id.as_bytes()));
        Ok(directory.join(format!("worker-ledger-{namespace}.sqlite")))
    }
}
