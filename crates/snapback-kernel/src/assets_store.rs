//! The store-agnostic asset byte-store seam.
//!
//! @ref LLP 0044#byte-stores-and-resumable-transfer — exactly two store
//!   implementations behind one interface: the local filesystem and one
//!   S3-compatible seam. The trait is the 0044 store-interface enumeration;
//!   per-provider qualification is separate later evidence, so nothing here
//!   widens a capability claim.

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
