//! The store-agnostic asset byte-store seam.
//!
//! @ref LLP 0044#byte-stores-and-resumable-transfer — exactly two store
//!   implementations behind one interface: the local filesystem and one
//!   S3-compatible seam. The trait is the 0044 store-interface enumeration;
//!   per-provider qualification is separate later evidence, so nothing here
//!   widens a capability claim.

use crate::assets::AssetFsStore;
use crate::diagnostic::{SnapbackError, SnapbackResult};

/// One object in the store, namespaced the way LLP 0044 separates custody:
/// restricted staging, the canonical rewrite staged beside it (one custody
/// unit with its source), and immutable published blobs.
#[derive(Clone, Copy, Debug)]
pub enum AssetObjectRef<'a> {
    Staging(&'a str),
    Canonical(&'a str),
    Blob(&'a str),
}

/// Streamed digest facts over one object: exact length, lowercase-hex
/// SHA-256, and the head bytes trusted content detection reads.
#[derive(Clone, Debug)]
pub struct AssetObjectDigest {
    pub byte_length: u64,
    /// Lowercase hex SHA-256 over the full byte stream.
    pub digest: String,
    /// The first bytes, for trusted content detection.
    pub head: Vec<u8>,
}

pub const ASSET_OBJECT_HEAD_BYTES: usize = 64;

/// The 0044 store interface. Implementations must keep every operation
/// idempotent or NotFound-tolerant exactly as documented per method — the
/// publication crash-recovery protocol probes and re-drives through this
/// seam.
pub trait AssetStore: Send + Sync {
    /// The store parameter of the lifecycle capability claim
    /// (`assetLifecycleStores`), e.g. `local-fs`.
    fn kind(&self) -> &'static str;

    /// Write `chunk` at exactly `offset` in the staging object, creating it
    /// when absent. A re-received tail after a crash overwrites in place;
    /// bytes are durable before the caller advances its acknowledged
    /// offset.
    fn append_staging(&self, key: &str, offset: u64, chunk: &[u8]) -> SnapbackResult<()>;

    /// The canonical rewrite staged beside its source: always writes (a
    /// re-run replaces a stale rewrite), same restricted custody and
    /// lifetime as the source.
    fn write_canonical(&self, key: &str, bytes: &[u8]) -> SnapbackResult<()>;

    /// Idempotent publish: writes the immutable blob object unless an
    /// object already exists at the key. Callers verify by re-hashing.
    fn put_blob_idempotent(&self, key: &str, bytes: &[u8]) -> SnapbackResult<()>;

    fn read(&self, object: AssetObjectRef<'_>) -> SnapbackResult<Vec<u8>>;

    /// Up to `max_len` bytes at `offset`; empty at EOF. Delivery streams
    /// through this so no store leaks paths or handles.
    fn read_chunk(
        &self,
        object: AssetObjectRef<'_>,
        offset: u64,
        max_len: usize,
    ) -> SnapbackResult<Vec<u8>>;

    /// Streamed digest/length/head facts; the publication protocol's verify
    /// step and finalization's read-back both ride this.
    fn hash(&self, object: AssetObjectRef<'_>) -> SnapbackResult<AssetObjectDigest>;

    fn exists(&self, object: AssetObjectRef<'_>) -> SnapbackResult<bool>;

    fn len(&self, object: AssetObjectRef<'_>) -> SnapbackResult<Option<u64>>;

    /// NotFound-tolerant delete of a blob object.
    fn delete_blob(&self, key: &str) -> SnapbackResult<()>;

    /// NotFound-tolerant delete of the staging custody pair (source +
    /// canonical rewrite) as one unit.
    fn delete_staging_pair(&self, key: &str) -> SnapbackResult<()>;

    /// Every staging custody unit currently present, by opaque key; the GC
    /// sweep diffs this against live attempts to find crash orphans.
    fn list_staging_keys(&self) -> SnapbackResult<Vec<String>>;

    /// Migration seam: copy an immutable blob object to a new key within
    /// the store, byte-identical.
    fn copy_blob(&self, from: &str, to: &str) -> SnapbackResult<()>;

    /// Destructive-reset companion (LLP 0109 §17): empty both namespaces
    /// wholesale after the reset transaction cleared the tables.
    fn wipe_all(&self) -> SnapbackResult<()>;
}

fn store_unavailable(context: &str, error: impl std::fmt::Display) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ASSET_STORE_UNAVAILABLE",
        "assets",
        format!("{context}: {error}"),
    )
}

impl AssetFsStore {
    fn resolve(&self, object: AssetObjectRef<'_>) -> SnapbackResult<std::path::PathBuf> {
        match object {
            AssetObjectRef::Staging(key) => self.staging_path(key),
            AssetObjectRef::Canonical(key) => self.canonical_staging_path(key),
            AssetObjectRef::Blob(key) => self.blob_path(key),
        }
    }
}

/// Streamed SHA-256 + length + head over a filesystem path. Kept as the FS
/// implementation detail; store-agnostic callers use `AssetStore::hash`.
pub(crate) fn hash_path(path: &std::path::Path) -> SnapbackResult<AssetObjectDigest> {
    use sha2::Digest as _;
    use std::io::Read as _;
    let mut file = std::fs::File::open(path)
        .map_err(|error| store_unavailable("cannot open staged object", error))?;
    let mut hasher = sha2::Sha256::new();
    let mut head = Vec::with_capacity(ASSET_OBJECT_HEAD_BYTES);
    let mut byte_length = 0u64;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| store_unavailable("cannot read staged object", error))?;
        if read == 0 {
            break;
        }
        if head.len() < ASSET_OBJECT_HEAD_BYTES {
            let take = (ASSET_OBJECT_HEAD_BYTES - head.len()).min(read);
            head.extend_from_slice(&buffer[..take]);
        }
        byte_length += read as u64;
        hasher.update(&buffer[..read]);
    }
    let digest = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(AssetObjectDigest { byte_length, digest, head })
}

impl AssetStore for AssetFsStore {
    fn kind(&self) -> &'static str {
        crate::assets::ASSET_STORE_LOCAL_FS
    }

    fn append_staging(&self, key: &str, offset: u64, chunk: &[u8]) -> SnapbackResult<()> {
        use std::io::{Seek, SeekFrom, Write};
        let path = self.staging_path(key)?;
        // Deliberately not `truncate`: chunks land at their exact offset,
        // and a re-received tail after a crash overwrites in place.
        #[allow(clippy::suspicious_open_options)]
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(false)
            .write(true)
            .open(path)
            .map_err(|error| store_unavailable("cannot open staging object", error))?;
        file.seek(SeekFrom::Start(offset))
            .and_then(|_| file.write_all(chunk))
            .and_then(|()| file.flush())
            .and_then(|()| file.sync_data())
            .map_err(|error| store_unavailable("cannot append staging chunk", error))
    }

    fn write_canonical(&self, key: &str, bytes: &[u8]) -> SnapbackResult<()> {
        let path = self.canonical_staging_path(key)?;
        std::fs::write(path, bytes)
            .map_err(|error| store_unavailable("cannot stage canonical rewrite", error))
    }

    fn put_blob_idempotent(&self, key: &str, bytes: &[u8]) -> SnapbackResult<()> {
        let path = self.blob_path(key)?;
        if path.exists() {
            return Ok(());
        }
        std::fs::write(path, bytes)
            .map_err(|error| store_unavailable("cannot publish object", error))
    }

    fn read(&self, object: AssetObjectRef<'_>) -> SnapbackResult<Vec<u8>> {
        let path = self.resolve(object)?;
        std::fs::read(path).map_err(|error| store_unavailable("cannot read object", error))
    }

    fn read_chunk(
        &self,
        object: AssetObjectRef<'_>,
        offset: u64,
        max_len: usize,
    ) -> SnapbackResult<Vec<u8>> {
        use std::io::{Read as _, Seek, SeekFrom};
        let path = self.resolve(object)?;
        let mut file = std::fs::File::open(path)
            .map_err(|error| store_unavailable("cannot open object", error))?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| store_unavailable("cannot seek object", error))?;
        let mut buffer = vec![0u8; max_len];
        let mut filled = 0usize;
        while filled < buffer.len() {
            let read = file
                .read(&mut buffer[filled..])
                .map_err(|error| store_unavailable("cannot read object", error))?;
            if read == 0 {
                break;
            }
            filled += read;
        }
        buffer.truncate(filled);
        Ok(buffer)
    }

    fn hash(&self, object: AssetObjectRef<'_>) -> SnapbackResult<AssetObjectDigest> {
        hash_path(&self.resolve(object)?)
    }

    fn exists(&self, object: AssetObjectRef<'_>) -> SnapbackResult<bool> {
        Ok(self.resolve(object)?.exists())
    }

    fn len(&self, object: AssetObjectRef<'_>) -> SnapbackResult<Option<u64>> {
        match std::fs::metadata(self.resolve(object)?) {
            Ok(meta) => Ok(Some(meta.len())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(store_unavailable("cannot stat object", error)),
        }
    }

    fn delete_blob(&self, key: &str) -> SnapbackResult<()> {
        match std::fs::remove_file(self.blob_path(key)?) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(store_unavailable("cannot delete object", error)),
        }
    }

    fn delete_staging_pair(&self, key: &str) -> SnapbackResult<()> {
        self.delete_staging(key)
    }

    fn list_staging_keys(&self) -> SnapbackResult<Vec<String>> {
        AssetFsStore::list_staging_keys(self)
    }

    fn copy_blob(&self, from: &str, to: &str) -> SnapbackResult<()> {
        let source = self.blob_path(from)?;
        let target = self.blob_path(to)?;
        std::fs::copy(source, target)
            .map(|_| ())
            .map_err(|error| store_unavailable("cannot copy object", error))
    }

    fn wipe_all(&self) -> SnapbackResult<()> {
        AssetFsStore::wipe_all(self)
    }
}
