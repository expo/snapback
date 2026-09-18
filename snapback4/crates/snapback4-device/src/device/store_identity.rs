//! Acquisition and receipts belong to one database incarnation.
use super::*;

pub(super) const RESTORE_REFUSED: &str = "device:restore-refused";

pub(super) fn restore_error() -> RuntimeError {
    RuntimeError::Structural { code: "E_STORE_RESTORE", message: "the backend store was restored or shrank below this device's watermark; stop this client and use a fresh device store and outbox".into() }
}

pub(super) fn require_healthy<T: DeviceTx>(tx: &T) -> Result<(), RuntimeError> {
    if tx.meta(RESTORE_REFUSED)?.is_some() { return Err(restore_error()); }
    Ok(())
}

// The installed program set is shared, but each native owner has its own
// interpreter. Same-generation replacement must invalidate that interpreter.
pub(super) fn backend_identity(backend: &Backend) -> String {
    let mut programs: Vec<_> = backend.programs.iter().collect();
    programs.sort_by(|a, b| a.name.cmp(&b.name));
    snapback4_core::value::digest(&(&backend.schema, programs, backend.generation))
}

// @ref LLP 3000.007#18.2 — each owner's interpreter and loaded native bytes belong to its adopted incarnation.
pub(super) fn require_owner<T: DeviceTx>(tx: &T, backend: &str, store_id: &Option<String>, native: Option<&str>) -> Result<(), RuntimeError> {
    require_backend(tx, backend, store_id)?;
    if tx.meta(NATIVE_DIGEST)?.filter(|s| !s.is_empty()).as_deref() != native { return Err(obsolete()); }
    Ok(())
}

pub(super) fn require_backend<T: DeviceTx>(tx: &T, backend: &str, store_id: &Option<String>) -> Result<(), RuntimeError> {
    if tx.meta(BACKEND_IDENTITY)?.as_deref() != Some(backend) || &tx.meta(STORE_ID)? != store_id { return Err(obsolete()); }
    Ok(())
}

fn obsolete() -> RuntimeError {
    RuntimeError::Prediction("this owner's backend is obsolete; reconnect to adopt the current backend".into())
}

#[derive(Debug, Serialize)]
pub struct StoreObservation {
    pub reset: bool,
    pub backend_required: bool,
    pub send_revision: u64,
    pub retired: BTreeMap<String, u64>,
    #[serde(skip)]
    pub(super) restore_refused: bool,
}

// @ref LLP 3000.007#18.2 — replacement discards the old partition, never an unsent write or a known receipt.
pub(super) fn observe<T: DeviceTx>(tx: &T, page: &StreamPage, publish_first: bool) -> Result<StoreObservation, RuntimeError> {
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
    let transfer_identity = tx.meta(deferred::IDENTITY)?;
    let receipt_identity = previous.as_ref().or(transfer_identity.as_ref());
    let private_identity = previous.is_none() && page.store_id.is_some() && transfer_identity == page.store_id;
    let same_identity = page.store_id.is_some() && (!identity_changed || private_identity);
    // @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — private progress is restore evidence, never publication authority.
    let transfer = deferred::cursor(tx)?.or(if tx.meta(SNAPSHOT_OWNER)?.is_some() { Some(meta_u64(tx, SNAPSHOT_THROUGH)?) } else { None });
    let private_restore = if let Some(transfer) = transfer.filter(|cut| page.requested_watermark == Some(*cut)) {
        // A delayed reply from an earlier private cut cannot accuse a healthy
        // store of restore. Revision and published-capture checks ran above.
        predictions::declaration(tx, page)?;
        let floor = watermark.max(transfer).max(meta_u64(tx, deferred::IMAGES_AT)?).max(meta_u64(tx, SNAPSHOT_IMAGES_AT)?);
        page.images_at.or((!page.more).then_some(page.watermark)).is_some_and(|head| head < floor)
            || page.watermark < transfer
    } else { false };
    let published_restore = page.watermark < watermark
        && page.requested_watermark.is_none_or(|requested| page.watermark < requested);
    if same_identity && (published_restore || private_restore) {
        tx.set_meta(RESTORE_REFUSED, "1")?;
    }
    // A halt belongs to the incarnation, even when rows are cleared, a
    // backend is adopted, identity is omitted, or its head later refills.
    if tx.meta(RESTORE_REFUSED)?.is_some() && (!identity_changed || private_identity) {
        return Ok(StoreObservation { reset: false, backend_required: tx.meta(BACKEND_REQUIRED)?.is_some_and(|value| !value.is_empty()), send_revision: revision, retired: BTreeMap::new(), restore_refused: true });
    }
    let reset = (identity_changed && !private_identity && (receipt_identity.is_some() || tx.meta(ACQUIRED)?.is_some_and(|value| !value.is_empty()) || meta_u64(tx, WATERMARK)? > 0 || tx.meta(SNAPSHOT_OWNER)?.is_some()))
        || (!page.snapshot_catchup && page.store_id.is_none() && page.requested_watermark.is_some_and(|requested| page.watermark < requested) && page.captured_watermark == Some(watermark));
    let mut retired = BTreeMap::new();
    if reset {
        // Replacement retires receipts of the old incarnation, including its
        // private transfer. A legacy rewind can retire only published effects.
        let private = deferred::cursor(tx)?.is_some() || tx.meta(SNAPSHOT_OWNER)?.is_some();
        predictions::bind_legacy_receipts(tx)?;
        for data in tx.outbox_entries()? {
            let mut entry: Queued = decoded(&data)?;
            if let Some(seq) = entry.sent_seq.or(entry.observed_seq).filter(|seq| predictions::receipt_matches(&entry, receipt_identity.map(String::as_str)) && (identity_changed || !private || *seq <= watermark)) {
                // A receipt proves execution in the old store. It is not
                // permission to execute that write in the replacement.
                retired.insert(entry.id.clone(), seq);
                predictions::remove(tx, &entry.id)?;
            } else {
                entry.predictable = false;
                entry.predicted.clear();
                predictions::enqueue(tx, &entry)?;
            }
        }
        // Inspect receipts before dropping their observation authority.
        tx.delete_meta(&[RESTORE_REFUSED])?;
        tx.clear_rows()?;
        tx.base_clear()?;
        reset_publication(tx, false)?;
        tx.set_meta(WATERMARK, "0")?;
        tx.set_meta(BACKEND_REQUIRED, page.store_id.as_deref().unwrap_or("legacy"))?;
        tx.delete_meta(&[ACQUIRED, history::GROUPS, boundary::BOUNDARIES, boundary::REPORT])?;
    }
    let incoming = page.store_id.as_ref().or(transfer_identity.as_ref());
    let adopt_identity = incoming.is_some() && previous.as_ref() != incoming && (publish_first || reset || previous.is_some());
    if adopt_identity {
        tx.set_meta(STORE_ID, incoming.expect("changed identity"))?;
    } else if previous.is_none() {
        // Observation may be followed by backend adoption without applying
        // this page. Remember its authenticated identity independently of rows.
        deferred::stage_identity(tx, page.store_id.as_deref())?;
    }
    if reset || adopt_identity {
        revision = revision.checked_add(1).filter(|n| *n <= 9_007_199_254_740_991).ok_or_else(|| RuntimeError::Store("send revision overflow".into()))?;
        tx.set_meta(SEND_REVISION, &revision.to_string())?;
    }
    Ok(StoreObservation { reset, backend_required: tx.meta(BACKEND_REQUIRED)?.is_some_and(|value| !value.is_empty()), send_revision: revision, retired, restore_refused: tx.meta(RESTORE_REFUSED)?.is_some() })
}

impl<S: DeviceStore> Device<S> {
    /// Observe the authenticated sync reply before adopting its generation
    /// or acquiring pages. A replacement is durable even if acquisition fails.
    pub fn observe_store(&mut self, page: &StreamPage) -> Result<StoreObservation, RuntimeError> {
        let tx = self.store.transaction()?;
        let observed = match observe(&tx, page, false) {
            Ok(observed) => observed,
            Err(error) => { tx.rollback()?; let _ = self.reject_sync_capture(page); return Err(error); }
        };
        tx.commit()?;
        if observed.reset { self.snapshot_owner = None; }
        if observed.restore_refused { return Err(restore_error()); }
        Ok(observed)
    }
}
