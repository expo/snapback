//! A harness-owned asset store with bounded, one-shot fault scripts.
//!
//! @ref LLP 0285#53-defect-3--the-caller-selectable-raw-sqlite-feature —
//!   cross-crate test residue belongs in the non-shipping harness instead of
//!   preserving a caller-selectable services support feature.

use snapback_kernel::{
    assets_store::{AssetObjectDigest, AssetObjectRef, AssetStore},
    diagnostic::{SnapbackError, SnapbackResult},
};
use snapback_services::assets::AssetFsStore;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
    mpsc::{Receiver, Sender},
};

type OneShotGate = (Sender<()>, Receiver<()>);

/// An offline, fixture-owned local asset store with exact one-shot controls
/// for publication interleavings and read-back faults.
pub struct ControlledAssetStore {
    _root: tempfile::TempDir,
    inner: Arc<dyn AssetStore>,
    copy_from_staging_gate: Mutex<Option<OneShotGate>>,
    blob_hash_gate: Mutex<Option<OneShotGate>>,
    blob_put_gate: Mutex<Option<OneShotGate>>,
    replacement_blob_read: Mutex<Option<Vec<u8>>>,
    corrupt_blob_hash_call: Mutex<Option<u64>>,
    blob_hash_calls: AtomicU64,
}

impl ControlledAssetStore {
    /// Create a fresh offline store whose filesystem root is owned by this
    /// fixture and disappears with it.
    pub fn new() -> SnapbackResult<Arc<Self>> {
        let root =
            tempfile::tempdir().map_err(|error| harness_error("create asset root", error))?;
        let inner = Arc::new(AssetFsStore::open(root.path())?);
        Ok(Arc::new(Self {
            _root: root,
            inner,
            copy_from_staging_gate: Mutex::new(None),
            blob_hash_gate: Mutex::new(None),
            blob_put_gate: Mutex::new(None),
            replacement_blob_read: Mutex::new(None),
            corrupt_blob_hash_call: Mutex::new(None),
            blob_hash_calls: AtomicU64::new(0),
        }))
    }

    /// Return the fixture's ordinary backing store for arranging or
    /// inspecting offline bytes without bypassing a production owner.
    pub fn backing_store(&self) -> Arc<dyn AssetStore> {
        self.inner.clone()
    }

    /// Block the next staging-to-blob copy after announcing entry.
    pub fn block_next_copy_from_staging(
        &self,
        entered: Sender<()>,
        release: Receiver<()>,
    ) -> SnapbackResult<()> {
        arm_gate(
            &self.copy_from_staging_gate,
            (entered, release),
            "arm staging-copy gate",
        )
    }

    /// Block the next blob hash after announcing entry.
    pub fn block_next_blob_hash(
        &self,
        entered: Sender<()>,
        release: Receiver<()>,
    ) -> SnapbackResult<()> {
        arm_gate(
            &self.blob_hash_gate,
            (entered, release),
            "arm blob-hash gate",
        )
    }

    /// Block the next blob PUT after announcing entry.
    pub fn block_next_blob_put(
        &self,
        entered: Sender<()>,
        release: Receiver<()>,
    ) -> SnapbackResult<()> {
        arm_gate(&self.blob_put_gate, (entered, release), "arm blob-put gate")
    }

    /// Substitute valid caller-provided bytes for the next blob read only.
    pub fn substitute_next_blob_read(&self, bytes: Vec<u8>) -> SnapbackResult<()> {
        *lock(&self.replacement_blob_read, "arm blob-read substitution")? = Some(bytes);
        Ok(())
    }

    /// Corrupt exactly the selected blob-hash result, counting from one.
    pub fn corrupt_nth_blob_hash(&self, call: u64) -> SnapbackResult<()> {
        if call == 0 {
            return Err(SnapbackError::error(
                "SNAPBACK_TEST_FIXTURE_INVALID",
                "harness",
                "blob hash call index must be at least one",
            ));
        }
        self.blob_hash_calls.store(0, Ordering::SeqCst);
        *lock(&self.corrupt_blob_hash_call, "arm blob-hash corruption")? = Some(call);
        Ok(())
    }
}

impl AssetStore for ControlledAssetStore {
    fn kind(&self) -> &'static str {
        self.inner.kind()
    }

    fn append_staging(&self, key: &str, offset: u64, chunk: &[u8]) -> SnapbackResult<()> {
        self.inner.append_staging(key, offset, chunk)
    }

    fn write_canonical(&self, key: &str, bytes: &[u8]) -> SnapbackResult<()> {
        self.inner.write_canonical(key, bytes)
    }

    fn put_blob_idempotent(&self, key: &str, bytes: &[u8]) -> SnapbackResult<()> {
        run_gate(&self.blob_put_gate, "blob PUT")?;
        self.inner.put_blob_idempotent(key, bytes)
    }

    fn copy_from_staging(&self, source: AssetObjectRef<'_>, blob_key: &str) -> SnapbackResult<()> {
        run_gate(&self.copy_from_staging_gate, "staging copy")?;
        self.inner.copy_from_staging(source, blob_key)
    }

    fn read(&self, object: AssetObjectRef<'_>) -> SnapbackResult<Vec<u8>> {
        if matches!(object, AssetObjectRef::Blob(_))
            && let Some(replacement) =
                lock(&self.replacement_blob_read, "take blob-read substitution")?.take()
        {
            return Ok(replacement);
        }
        self.inner.read(object)
    }

    fn read_chunk(
        &self,
        object: AssetObjectRef<'_>,
        offset: u64,
        max_len: usize,
    ) -> SnapbackResult<Vec<u8>> {
        self.inner.read_chunk(object, offset, max_len)
    }

    fn hash(&self, object: AssetObjectRef<'_>) -> SnapbackResult<AssetObjectDigest> {
        if matches!(object, AssetObjectRef::Blob(_)) {
            run_gate(&self.blob_hash_gate, "blob hash")?;
        }
        let mut digest = self.inner.hash(object)?;
        if matches!(object, AssetObjectRef::Blob(_)) {
            let call = self.blob_hash_calls.fetch_add(1, Ordering::SeqCst) + 1;
            if *lock(&self.corrupt_blob_hash_call, "read blob-hash corruption")? == Some(call) {
                digest.digest = "0".repeat(64);
            }
        }
        Ok(digest)
    }

    fn exists(&self, object: AssetObjectRef<'_>) -> SnapbackResult<bool> {
        self.inner.exists(object)
    }

    fn len(&self, object: AssetObjectRef<'_>) -> SnapbackResult<Option<u64>> {
        self.inner.len(object)
    }

    fn delete_blob(&self, key: &str) -> SnapbackResult<()> {
        self.inner.delete_blob(key)
    }

    fn delete_staging_pair(&self, key: &str) -> SnapbackResult<()> {
        self.inner.delete_staging_pair(key)
    }

    fn list_staging_keys(&self) -> SnapbackResult<Vec<String>> {
        self.inner.list_staging_keys()
    }

    fn copy_blob(&self, from: &str, to: &str) -> SnapbackResult<()> {
        self.inner.copy_blob(from, to)
    }

    fn wipe_all(&self) -> SnapbackResult<()> {
        self.inner.wipe_all()
    }
}

fn lock<'a, T>(mutex: &'a Mutex<T>, action: &str) -> SnapbackResult<std::sync::MutexGuard<'a, T>> {
    mutex.lock().map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_ASSET_STORE_UNAVAILABLE",
            "harness",
            format!("controlled asset fixture could not {action}"),
        )
    })
}

fn arm_gate(
    gate: &Mutex<Option<OneShotGate>>,
    script: OneShotGate,
    action: &str,
) -> SnapbackResult<()> {
    let mut gate = lock(gate, action)?;
    if gate.is_some() {
        return Err(SnapbackError::error(
            "SNAPBACK_TEST_FIXTURE_INVALID",
            "harness",
            format!("controlled asset fixture cannot {action}: a gate is already armed"),
        ));
    }
    *gate = Some(script);
    Ok(())
}

fn run_gate(gate: &Mutex<Option<OneShotGate>>, action: &str) -> SnapbackResult<()> {
    let Some((entered, release)) = lock(gate, action)?.take() else {
        return Ok(());
    };
    entered
        .send(())
        .map_err(|error| harness_error(&format!("announce {action}"), error))?;
    release
        .recv()
        .map_err(|error| harness_error(&format!("release {action}"), error))
}

fn harness_error(action: &str, error: impl std::fmt::Display) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ASSET_STORE_UNAVAILABLE",
        "harness",
        format!("controlled asset fixture could not {action}: {error}"),
    )
}
