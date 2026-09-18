//! Metadata checks a capture; it cannot identify or retire a partition.
use super::*;

#[derive(Deserialize)]
pub struct SyncMetadata {
    metadata: bool,
    store_id: String,
    generation: u64,
    watermark: u64,
    recovery: Option<Recovery>,
}

#[derive(Deserialize)]
struct Recovery { from: u64, snapshot: bool }

#[derive(Deserialize)]
pub struct SyncCapture {
    store_id: Option<String>,
    generation: u64,
    captured_watermark: u64,
    send_revision: u64,
    from: u64,
    stream: bool,
    recover: bool,
}

impl<S: DeviceStore> Device<S> {
    // @ref LLP 3000.007#18.2 — request-local fences precede all durable recovery effects.
    pub fn sync_metadata(&mut self, metadata: SyncMetadata, capture: SyncCapture) -> Result<bool, RuntimeError> {
        let tx = self.store.transaction()?;
        store_identity::require_healthy(&tx)?;
        if !metadata.metadata || metadata.store_id.is_empty() || metadata.generation == 0
            || capture.generation != self.generation
            || (capture.store_id.is_none() && capture.captured_watermark != 0)
            || capture.store_id.as_ref().is_some_and(|id| id != &metadata.store_id) || tx.meta(STORE_ID)? != capture.store_id
            || meta_u64(&tx, GENERATION)? != capture.generation
            || meta_u64(&tx, SEND_REVISION)? != capture.send_revision
            || meta_u64(&tx, WATERMARK)? != capture.captured_watermark {
            return Err(RuntimeError::Generation("sync metadata does not match its device capture; retry sync".into()));
        }
        if metadata.watermark < capture.captured_watermark {
            tx.set_meta(store_identity::RESTORE_REFUSED, "1")?;
            tx.commit()?;
            return Err(store_identity::restore_error());
        }
        if metadata.generation < capture.generation {
            return Err(RuntimeError::Generation("sync metadata generation is obsolete; retry sync".into()));
        }
        let snapshot = metadata.recovery.as_ref().is_some_and(|decision| decision.snapshot);
        if snapshot {
            if capture.store_id.as_ref() != Some(&metadata.store_id) || !capture.recover || !(capture.from > 0 || capture.stream) || capture.from > metadata.watermark
                || metadata.generation != capture.generation || metadata.recovery.as_ref().unwrap().from != capture.from {
                return Err(RuntimeError::Generation("snapshot recovery does not match its requested position".into()));
            }
            if (!capture.stream && capture.from != capture.captured_watermark)
                || (capture.stream && (self.snapshot_owner.is_none() || self.snapshot_owner != tx.meta(SNAPSHOT_OWNER)?
                    || meta_u64(&tx, SNAPSHOT_THROUGH)? != capture.from)) {
                return Err(RuntimeError::Generation("snapshot recovery position is no longer current".into()));
            }
            store_identity::require_owner(&tx, &self.backend_identity, &self.store_identity, self.native_digest.as_deref())?;
            let revision = capture.send_revision.checked_add(1).filter(|n| *n <= 9_007_199_254_740_991)
                .ok_or_else(|| RuntimeError::Store("send revision overflow".into()))?;
            // Keep confirmed rows/history and the restore watermark. Persist the
            // obligation before any snapshot request, including across reopen.
            tx.set_meta(SNAPSHOT_REQUIRED, "1")?;
            tx.delete_meta(&[ACQUIRED])?;
            tx.set_meta(SEND_REVISION, &revision.to_string())?;
            tx.staged_clear()?;
            tx.delete_meta(&SNAPSHOT_KEYS)?;
        }
        tx.commit()?;
        if snapshot { self.snapshot_owner = None; }
        Ok(snapshot)
    }
}
