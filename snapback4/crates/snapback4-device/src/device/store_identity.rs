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
    // A matching identity with a lower head is a restore, not a new store.
    // Persist the halt with the old watermark; neither retry nor adoption
    // may silently turn the same identity into a fresh acquisition.
    if !identity_changed && page.store_id.is_some() && page.watermark < watermark
        && page.requested_watermark.is_none_or(|requested| page.watermark < requested) {
        tx.set_meta(RESTORE_REFUSED, "1")?;
    }
    if reset {
        tx.delete_meta(&[RESTORE_REFUSED])?;
        tx.clear_rows()?;
        tx.base_clear()?;
        tx.staged_clear()?;
        tx.set_meta(WATERMARK, "0")?;
        tx.set_meta(BACKEND_REQUIRED, page.store_id.as_deref().unwrap_or("legacy"))?;
        tx.delete_meta(&[ACQUIRED, SNAPSHOT_REQUIRED, history::GROUPS, boundary::BOUNDARIES, boundary::REPORT])?;
        tx.delete_meta(&SNAPSHOT_KEYS)?;
        for data in tx.outbox_entries()? {
            let mut entry: Queued = decoded(&data)?;
            if let Some(seq) = entry.sent_seq.or(entry.observed_seq) {
                // A receipt proves execution in the old store. It is not
                // permission to execute that write in the replacement.
                keep_write(tx, &serde_json::json!({ "state": "sent", "id": entry.id, "seq": seq, "replayed": true }).to_string())?;
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
    Ok(StoreObservation { reset, backend_required: tx.meta(BACKEND_REQUIRED)?.is_some_and(|value| !value.is_empty()), send_revision: revision, retired, restore_refused: tx.meta(RESTORE_REFUSED)?.is_some() })
}

impl<S: DeviceStore> Device<S> {
    /// Observe the authenticated sync reply before adopting its generation
    /// or acquiring pages. A replacement is durable even if acquisition fails.
    pub fn observe_store(&mut self, page: &StreamPage) -> Result<StoreObservation, RuntimeError> {
        let tx = self.store.transaction()?;
        let first_identity = tx.meta(STORE_ID)?.is_none() && self.store_identity.is_none();
        let observed = observe(&tx, page)?;
        tx.commit()?;
        if first_identity && !observed.reset { self.store_identity = page.store_id.clone(); }
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
        if ids.insert(entry["id"].as_str().unwrap().to_owned()) { added.push(entry); }
    }
    if adopting { entries.splice(..0, added); } else { entries.extend(added); }
    if entries.len() > 256 { entries.drain(..entries.len() - 256); }
    tx.set_meta("client:write-history", &history.to_string())?;
    Ok(())
}
