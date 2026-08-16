//! The store-agnostic asset byte-store seam.
//!
//! @ref LLP 0044#byte-stores-and-resumable-transfer — exactly two store
//!   implementations behind one interface: the local filesystem and one
//!   S3-compatible seam. The trait is the 0044 store-interface enumeration;
//!   per-provider qualification is separate later evidence, so nothing here
//!   widens a capability claim.

use crate::assets::AssetFsStore;
use crate::diagnostic::{SnapbackError, SnapbackResult};

const TUS_PATCH_LOCK_STRIPES: usize = 64;

/// Clone-shared, per-attempt serialization for the unlocked TUS append/CAS
/// window. Requests for one attempt cannot overwrite each other's staging tail
/// before the winning offset CAS; unrelated attempts normally remain parallel,
/// with bounded hash collisions allowed to serialize conservatively. Acquired
/// guards are owned so an unabortable blocking append retains serialization if
/// its awaiting HTTP request is cancelled.
#[derive(Clone)]
pub(crate) struct AssetTusPatchGates {
    stripes: std::sync::Arc<Vec<std::sync::Arc<tokio::sync::Mutex<()>>>>,
}

impl Default for AssetTusPatchGates {
    fn default() -> Self {
        Self {
            stripes: std::sync::Arc::new(
                (0..TUS_PATCH_LOCK_STRIPES)
                    .map(|_| std::sync::Arc::new(tokio::sync::Mutex::new(())))
                    .collect(),
            ),
        }
    }
}

impl AssetTusPatchGates {
    pub(crate) async fn acquire(&self, attempt_id: &str) -> tokio::sync::OwnedMutexGuard<()> {
        use std::hash::{Hash as _, Hasher as _};

        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        attempt_id.hash(&mut hasher);
        let stripe = (hasher.finish() as usize) % self.stripes.len();
        self.stripes[stripe].clone().lock_owned().await
    }
}

/// The closed set of byte-store backends selectable for one LocalSnapback
/// instance. Backend choice is captured at instance construction; asset paths
/// never consult the process environment.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AssetStoreBackend {
    LocalFs,
    S3,
}

impl AssetStoreBackend {
    pub(crate) fn parse_env_value(value: Option<&str>) -> SnapbackResult<Self> {
        match value {
            None | Some("local-fs") => Ok(Self::LocalFs),
            Some("s3") => Ok(Self::S3),
            Some(_) => Err(SnapbackError::error(
                "SNAPBACK_ASSET_STORE_CONFIG_INVALID",
                "assets",
                "SNAPBACK_ASSET_STORE must be local-fs or s3",
            )),
        }
    }
}

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

    /// Stream a restricted staging object into an immutable blob. Store
    /// implementations should avoid buffering the whole object; the default
    /// preserves compatibility for stores whose native copy lane is not yet
    /// active.
    fn copy_from_staging(&self, source: AssetObjectRef<'_>, blob_key: &str) -> SnapbackResult<()> {
        if matches!(source, AssetObjectRef::Blob(_)) {
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_STORE_OP_UNSUPPORTED",
                "assets",
                "copy_from_staging requires a restricted staging object",
            ));
        }
        let bytes = self.read(source)?;
        self.put_blob_idempotent(blob_key, &bytes)
    }

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

/// Same-directory temp write followed by file and directory durability. The
/// rename is the publication cut: callers never expose a partially written
/// canonical or blob object at its final path.
fn durable_replace(
    path: &std::path::Path,
    context: &str,
    write: impl FnOnce(&mut std::fs::File) -> std::io::Result<()>,
) -> SnapbackResult<()> {
    use std::io::Write as _;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| store_unavailable(context, "object path has no valid file name"))?;
    let temporary_name = file_name
        .strip_suffix(crate::assets::ASSET_CANONICAL_SUFFIX)
        .map(|key| format!("{key}-tmp{}", crate::assets::ASSET_CANONICAL_SUFFIX))
        .unwrap_or_else(|| format!("{file_name}-tmp"));
    let temporary = path.with_file_name(temporary_name);
    match std::fs::remove_file(&temporary) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(store_unavailable(context, error)),
    }
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        write(&mut file)?;
        file.flush()?;
        file.sync_data()?;
        std::fs::rename(&temporary, path)?;
        crate::secure_file::sync_parent(path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|error| store_unavailable(context, error))
}

fn sync_existing(path: &std::path::Path, context: &str) -> SnapbackResult<()> {
    std::fs::File::open(path)
        .and_then(|file| file.sync_data())
        .and_then(|()| crate::secure_file::sync_parent(path))
        .map_err(|error| store_unavailable(context, error))
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
    Ok(AssetObjectDigest {
        byte_length,
        digest,
        head,
    })
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
        durable_replace(&path, "cannot stage canonical rewrite", |file| {
            use std::io::Write as _;
            file.write_all(bytes)
        })
    }

    fn put_blob_idempotent(&self, key: &str, bytes: &[u8]) -> SnapbackResult<()> {
        let path = self.blob_path(key)?;
        if path.exists() {
            return sync_existing(&path, "cannot confirm published object durability");
        }
        durable_replace(&path, "cannot publish object", |file| {
            use std::io::Write as _;
            file.write_all(bytes)
        })
    }

    fn copy_from_staging(&self, source: AssetObjectRef<'_>, blob_key: &str) -> SnapbackResult<()> {
        if matches!(source, AssetObjectRef::Blob(_)) {
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_STORE_OP_UNSUPPORTED",
                "assets",
                "copy_from_staging requires a restricted staging object",
            ));
        }
        let target = self.blob_path(blob_key)?;
        if target.exists() {
            return sync_existing(&target, "cannot confirm published object durability");
        }
        let source = self.resolve(source)?;
        durable_replace(&target, "cannot publish staged object", |target| {
            let mut source = std::fs::File::open(source)?;
            std::io::copy(&mut source, target).map(|_| ())
        })
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

#[cfg(test)]
mod tests {
    use super::{AssetObjectRef, AssetStore, AssetStoreBackend};

    #[test]
    fn asset_store_backend_config_parser_is_closed_without_process_env_mutation() {
        assert_eq!(
            AssetStoreBackend::parse_env_value(None).unwrap(),
            AssetStoreBackend::LocalFs
        );
        assert_eq!(
            AssetStoreBackend::parse_env_value(Some("local-fs")).unwrap(),
            AssetStoreBackend::LocalFs
        );
        assert_eq!(
            AssetStoreBackend::parse_env_value(Some("s3")).unwrap(),
            AssetStoreBackend::S3
        );
        let error = AssetStoreBackend::parse_env_value(Some("unknown")).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_ASSET_STORE_CONFIG_INVALID");
    }

    #[test]
    fn assets_store_durable_publication_replaces_canonical_and_keeps_blobs_immutable() {
        let root = tempfile::tempdir().expect("temp asset store");
        let store = crate::assets::AssetFsStore::open(root.path()).expect("open store");
        let staging_key = crate::assets::AssetFsStore::new_opaque_key();
        let blob_key = crate::assets::AssetFsStore::new_opaque_key();

        store
            .append_staging(&staging_key, 0, b"staged bytes")
            .expect("durable staging");
        store
            .copy_from_staging(AssetObjectRef::Staging(&staging_key), &blob_key)
            .expect("streamed publication");
        assert_eq!(
            store.read(AssetObjectRef::Blob(&blob_key)).expect("blob"),
            b"staged bytes"
        );

        store
            .put_blob_idempotent(&blob_key, b"different bytes")
            .expect("idempotent existing blob");
        assert_eq!(
            store.read(AssetObjectRef::Blob(&blob_key)).expect("blob"),
            b"staged bytes",
            "an immutable blob is never overwritten"
        );

        store
            .write_canonical(&staging_key, b"first canonical")
            .expect("first canonical");
        store
            .write_canonical(&staging_key, b"second canonical")
            .expect("replacement canonical");
        assert_eq!(
            store
                .read(AssetObjectRef::Canonical(&staging_key))
                .expect("canonical"),
            b"second canonical"
        );
        let temporary_entries =
            std::fs::read_dir(crate::assets::AssetFsStore::staging_directory(root.path()))
                .expect("list staging")
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().contains("-tmp"))
                .count();
        assert_eq!(temporary_entries, 0, "publication leaves no temp files");
    }
}
