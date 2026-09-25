//! Acquisition and receipts belong to one database incarnation.
use super::*;

pub(super) const RESTORE_REFUSED: &str = "device:restore-refused";

pub(super) fn restore_cursor<T: DeviceTx>(tx: &T) -> Result<Option<u64>, RuntimeError> {
    Ok(deferred::cursor(tx)?.or(if tx.meta(SNAPSHOT_OWNER)?.is_some() { Some(meta_u64(tx, SNAPSHOT_THROUGH)?) } else { None }))
}

pub(super) fn restore_images_at<T: DeviceTx>(tx: &T) -> Result<u64, RuntimeError> {
    Ok(meta_u64(tx, deferred::IMAGES_AT)?.max(meta_u64(tx, SNAPSHOT_IMAGES_AT)?))
}

pub(super) fn adoption_capture<T: DeviceTx>(tx: &T) -> Result<BTreeMap<String, Option<String>>, RuntimeError> {
    let mut capture = BTreeMap::new();
    for key in [BACKEND_REQUIRED, STORE_ID, SEND_REVISION, BACKEND_IDENTITY, GENERATION, NATIVE_DIGEST,
        WATERMARK, ACQUIRED, RESTORE_REFUSED, deferred::IDENTITY, deferred::CURSOR,
        deferred::IMAGES_AT, SNAPSHOT_OWNER, SNAPSHOT_THROUGH, SNAPSHOT_IMAGES_AT] {
        capture.insert(key.to_owned(), tx.meta(key)?);
    }
    Ok(capture)
}

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
    pub adoption_capture: BTreeMap<String, Option<String>>,
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
    let transfer = restore_cursor(tx)?.unwrap_or(watermark);
    let captured = page.captured_restore_watermark.or(page.requested_watermark);
    let private_restore = if let Some(cut) = captured {
        // Only evidence that existed when this request left can condemn its
        // response. Legacy local callers attest only their request cursor;
        // never substitute a subsequently retained image head for an absent echo.
        // Pending declarations govern applying effects, not this head proof:
        // a newer declaration cannot erase evidence this request already held.
        let floor = page.captured_watermark.unwrap_or(0).max(cut).max(page.captured_restore_images_at.unwrap_or(0));
        page.images_at.or((!page.more).then_some(page.watermark)).is_some_and(|head| head < floor)
            || (page.requested_watermark == Some(cut) && page.watermark < cut)
    } else { false };
    let published_restore = page.watermark < watermark
        && page.requested_watermark.is_none_or(|requested| page.watermark < requested);
    if same_identity && (published_restore || private_restore) {
        tx.set_meta(RESTORE_REFUSED, "1")?;
    }
    // A halt belongs to the incarnation, even when rows are cleared, a
    // backend is adopted, identity is omitted, or its head later refills.
    if tx.meta(RESTORE_REFUSED)?.is_some() && (!identity_changed || private_identity) {
        return Ok(StoreObservation { reset: false, backend_required: tx.meta(BACKEND_REQUIRED)?.is_some_and(|value| !value.is_empty()), send_revision: revision, retired: BTreeMap::new(), adoption_capture: BTreeMap::new(), restore_refused: true });
    }
    // Healthy but obsolete evidence authorizes neither a send nor adoption.
    // Check after the captured restore proof: a private advance cannot erase
    // a restore already demonstrated against the older request's own evidence.
    let captured_progress = page.captured_restore_watermark;
    let images_at = restore_images_at(tx)?;
    if !publish_first && (captured_progress.is_some_and(|cut| cut != transfer)
        || page.captured_restore_images_at.is_some_and(|head| head != images_at)) {
        return Err(RuntimeError::Generation("private progress changed during the request; retry sync".into()));
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
                keep_write(tx, &serde_json::json!({ "state": "sent", "id": entry.id, "seq": seq, "replayed": true }).to_string())?;
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
    Ok(StoreObservation { reset, backend_required: tx.meta(BACKEND_REQUIRED)?.is_some_and(|value| !value.is_empty()), send_revision: revision, retired, adoption_capture: BTreeMap::new(), restore_refused: tx.meta(RESTORE_REFUSED)?.is_some() })
}

impl<S: DeviceStore> Device<S> {
    /// Observe the authenticated sync reply before adopting its generation
    /// or acquiring pages. A replacement is durable even if acquisition fails.
    pub fn observe_store(&mut self, page: &StreamPage) -> Result<StoreObservation, RuntimeError> {
        let tx = self.store.transaction()?;
        let mut observed = match observe(&tx, page, false) {
            Ok(observed) => observed,
            Err(error) => { tx.rollback()?; let _ = self.reject_sync_capture(page); return Err(error); }
        };
        // Carry this successful preflight through schema transport. Recapturing
        // afterward could bless private evidence the response never validated.
        observed.adoption_capture = adoption_capture(&tx)?;
        tx.commit()?;
        if observed.reset { self.snapshot_owner = None; }
        if observed.restore_refused { return Err(restore_error()); }
        Ok(observed)
    }
}

// Receipt retirement and its durable history share the fenced transaction.
pub(super) fn keep_write<T: DeviceTx>(tx: &T, value: &str) -> Result<(), RuntimeError> {
    let parse = |text: &str| snapback4_core::json_codec::from_text::<serde_json::Value>(text).map_err(|e| RuntimeError::Store(e.to_string()));
    let write = parse(value)?;
    // A list is an adopted older window; a single receipt is a new local completion.
    let adopting = write.is_array();
    let incoming = if adopting { write.as_array().unwrap().clone() } else { vec![write] };
    for entry in &incoming {
        if entry.get("id").and_then(|id| id.as_str()).is_none() { return Err(RuntimeError::Store("write receipt requires an id".into())); }
    }
    let mut history = tx.meta("client:write-history")?.map(|text| parse(&text)).transpose()?.unwrap_or_else(|| serde_json::json!([]));
    let entries = history.as_array_mut().ok_or_else(|| RuntimeError::Store("write history must be a list".into()))?;
    let mut ids: std::collections::BTreeSet<String> = entries.iter().filter_map(|entry| entry["id"].as_str().map(str::to_owned)).collect();
    let mut added = Vec::new();
    for entry in incoming {
        let id = entry["id"].as_str().unwrap();
        if ids.insert(id.to_owned()) { added.push(entry); }
        else if !adopting && entry["state"] == "sent" {
            // @ref LLP 3000.013#6 — positive outbox custody resolves an
            // unknown-outcome replacement refusal, without refreshing the window.
            if let Some(old) = entries.iter_mut().find(|old| old["id"] == id && old["state"] == "failed" && old["why"]["code"] == "E_STORE_REPLACED") {
                if let Some(data) = tx.outbox_get(id)? {
                    let queued: Queued = decoded(&data)?;
                    if queued.sent_seq.or(queued.observed_seq).is_some_and(|seq| entry["seq"].as_u64() == Some(seq)) { *old = entry; }
                }
            }
        }
    }
    if adopting { entries.splice(..0, added); } else { entries.extend(added); }
    if entries.len() > 256 { entries.drain(..entries.len() - 256); }
    tx.set_meta("client:write-history", &history.to_string())?;
    Ok(())
}
