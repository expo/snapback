//! Acquisition and receipts belong to one database incarnation.
use super::*;

// The installed program set is shared, but each native owner has its own
// interpreter. Same-generation replacement must invalidate that interpreter.
pub(super) fn backend_identity(backend: &Backend) -> String {
    let mut programs: Vec<_> = backend.programs.iter().collect();
    programs.sort_by(|a, b| a.name.cmp(&b.name));
    snapback4_core::value::digest(&(&backend.schema, programs, backend.generation))
}

#[derive(Debug, Serialize)]
pub struct StoreObservation {
    pub reset: bool,
    pub backend_required: bool,
    pub send_revision: u64,
    pub retired: BTreeMap<String, u64>,
}

// @ref LLP 3000.007#18.2 — replacement discards the old partition, never an unsent write or a known receipt.
pub(super) fn observe<T: DeviceTx>(tx: &T, page: &StreamPage) -> Result<StoreObservation, RuntimeError> {
    let mut revision = meta_u64(tx, SEND_REVISION)?;
    let previous = tx.meta(STORE_ID)?;
    if page.send_revision.is_some_and(|expected| expected != revision) {
        let message = if page.store_id.is_some() && page.store_id != previous {
            "the backend store was replaced during sync; retry sync"
        } else {
            "a mutation send overlapped the sync response; retry sync"
        };
        return Err(RuntimeError::Generation(message.into()));
    }
    let watermark = meta_u64(tx, WATERMARK)?;
    // A response belongs to its request, not to a newer owner's acquisition.
    if page.captured_watermark.is_some_and(|expected| expected != watermark) {
        return Err(RuntimeError::Generation("another owner advanced acquisition during sync; retry sync".into()));
    }
    let identity_changed = page.store_id.as_ref().is_some_and(|id| previous.as_ref() != Some(id));
    let reset = (identity_changed && (previous.is_some() || tx.meta(ACQUIRED)?.is_some() || meta_u64(tx, WATERMARK)? > 0 || tx.meta(SNAPSHOT_OWNER)?.is_some()))
        || (page.store_id.is_none() && page.requested_watermark.is_some_and(|requested| page.watermark < requested) && page.captured_watermark == Some(watermark));
    let mut retired = BTreeMap::new();
    if reset {
        tx.clear_rows()?;
        tx.base_clear()?;
        tx.staged_clear()?;
        tx.set_meta(WATERMARK, "0")?;
        tx.set_meta(BACKEND_REQUIRED, page.store_id.as_deref().unwrap_or("legacy"))?;
        tx.delete_meta(&[ACQUIRED, history::GROUPS])?;
        tx.delete_meta(&SNAPSHOT_KEYS)?;
        for data in tx.outbox_entries()? {
            let mut entry: Queued = decoded(&data)?;
            if let Some(seq) = entry.sent_seq.or(entry.observed_seq) {
                // A receipt proves execution in the old store. It is not
                // permission to execute that write in the replacement.
                retired.insert(entry.id.clone(), seq);
                tx.outbox_delete(&entry.id)?;
            } else {
                entry.predictable = false;
                entry.predicted.clear();
                predictions::enqueue(tx, &entry)?;
            }
        }
    }
    if identity_changed {
        tx.set_meta(STORE_ID, page.store_id.as_deref().expect("changed identity"))?;
    }
    if reset || identity_changed {
        revision = revision.checked_add(1).filter(|n| *n <= 9_007_199_254_740_991).ok_or_else(|| RuntimeError::Store("send revision overflow".into()))?;
        tx.set_meta(SEND_REVISION, &revision.to_string())?;
    }
    Ok(StoreObservation { reset, backend_required: tx.meta(BACKEND_REQUIRED)?.is_some_and(|value| !value.is_empty()), send_revision: revision, retired })
}

impl<S: DeviceStore> Device<S> {
    /// Observe the authenticated sync reply before adopting its generation
    /// or acquiring pages. A replacement is durable even if acquisition fails.
    pub fn observe_store(&mut self, page: &StreamPage) -> Result<StoreObservation, RuntimeError> {
        let tx = self.store.transaction()?;
        let observed = observe(&tx, page)?;
        tx.commit()?;
        if observed.reset { self.snapshot_owner = None; }
        Ok(observed)
    }
}
