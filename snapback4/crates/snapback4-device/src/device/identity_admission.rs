//! Native custody and ordinary admission share one exact-input identity check.
// @ref LLP 3000.007#20.4 — no accepted deferred intent may overwrite an outbox owner.
use super::*;

const KEY: &str = "client:identity-admissions";
const INPUTS: &str = "client:identity-receipt-inputs";
type Json = serde_json::Value;

fn records(value: Option<&str>) -> Result<Vec<Json>, RuntimeError> { decoded(value.unwrap_or("[]")) }
fn input(entry: &Queued) -> String { snapback4_core::value::digest(&(&entry.op, &entry.args, &entry.viewer)) }

// Terminal history must still distinguish exact-input recovery from ID reuse
// after the peer's outbox row retires. Keep only fingerprints in its own window.
pub(super) fn keep_inputs<T: DeviceTx>(tx: &T, history: &[Json]) -> Result<(), RuntimeError> {
    let mut inputs: BTreeMap<String, String> = decoded(tx.meta(INPUTS)?.as_deref().unwrap_or("{}"))?;
    inputs.retain(|id, _| history.iter().any(|w| w["id"] == *id));
    let deferred = records(tx.meta(KEY)?.as_deref())?;
    for receipt in history {
        let Some(id) = receipt["id"].as_str() else { continue; };
        if inputs.contains_key(id) { continue; }
        let entry = tx.outbox_get(id)?.map(|text| decoded::<Queued>(&text)).transpose()?;
        let entry = entry.or(deferred.iter().find(|r| r["entry"]["id"] == id).map(|r| decoded::<Queued>(&r["entry"].to_string())).transpose()?);
        if let Some(entry) = entry { inputs.insert(id.to_owned(), input(&entry)); }
    }
    tx.set_meta(INPUTS, &encoded(&inputs)?)
}

fn binding<T: DeviceTx>(tx: &T, record: &Json) -> Result<(), RuntimeError> {
    let store = record["store"].as_str().or(record["identity"]["store"].as_str());
    let current = tx.meta(STORE_ID)?;
    if record["identity"]["backend"].as_str() != tx.meta(BACKEND_IDENTITY)?.as_deref()
        || store.is_some_and(|id| current.as_deref() != Some(id)) {
        return Err(RuntimeError::Structural { code: "E_ADMISSION_STORE", message: "The backend changed before this write could be admitted. Review the current backend, then submit a new attempt.".into() });
    }
    Ok(())
}

// Ordinary admission must honor deferred binding, status and FIFO in the same
// transaction that creates the outbox row. A JS queue snapshot is not authority.
pub(super) fn admit<T: DeviceTx>(tx: &T, entry: &mut Queued, expected: Option<Option<&str>>) -> Result<(), RuntimeError> {
    let text = tx.meta(KEY)?;
    if expected.is_some_and(|expected| expected != text.as_deref()) {
        return Err(RuntimeError::Generation("deferred custody changed; retry admission".into()));
    }
    let mut records = records(text.as_deref())?;
    if let Some(index) = records.iter().position(|r| r["entry"]["id"] == entry.id) {
        let record = &records[index];
        let original: Queued = decoded(&record["entry"].to_string())?;
        same_input(&original, entry)?;
        binding(tx, record)?;
        if !record["why"].is_null() || !record["outcome"].is_null() {
            return Err(RuntimeError::Prediction("deferred custody already has a terminal outcome; recover its receipt".into()));
        }
        if records[..index].iter().any(|r| r["admitted"] != true && r["why"].is_null() && r["outcome"].is_null()) {
            return Err(RuntimeError::Prediction("an earlier deferred write awaits admission".into()));
        }
        *entry = original;
        let store = tx.meta(STORE_ID)?.ok_or_else(|| RuntimeError::Prediction("the backend store is not identified yet".into()))?;
        // Bind transport as well as admission. The server receives this original
        // identity even if another process observes a replacement before POST.
        entry.receipt_store = Some(ReceiptStore { id: Some(store.clone()), success_seq: None });
        records[index]["store"] = store.into();
        records[index]["admitted"] = true.into();
        tx.set_meta(KEY, &encoded(&records)?)?;
    } else if records.iter().any(|r| r["admitted"] != true && r["why"].is_null() && r["outcome"].is_null()) {
        return Err(RuntimeError::Prediction("an earlier deferred write awaits admission".into()));
    }
    Ok(())
}

// A compare decision owns SQLite's writer lock, including reads of ordinary
// custody and terminal history. Normalize a late capture or expiry proposal to
// that authority and make the JS plan reload before publishing any outcome.
pub(super) fn compare<T: DeviceTx>(tx: &T, expected: Option<&str>, value: &str) -> Result<bool, RuntimeError> {
    if tx.meta(KEY)?.as_deref() != expected { return Ok(false); }
    let mut proposed = records(Some(value))?;
    let original = proposed.clone();
    let history = records(tx.meta("client:write-history")?.as_deref())?;
    let inputs: BTreeMap<String, String> = decoded(tx.meta(INPUTS)?.as_deref().unwrap_or("{}"))?;
    for record in &mut proposed {
        let entry: Queued = decoded(&record["entry"].to_string())?;
        let queued = tx.outbox_get(&entry.id)?.map(|text| decoded::<Queued>(&text)).transpose()?;
        if let Some(queued) = &queued { same_input(queued, &entry)?; }
        if let Some(outcome) = history.iter().find(|w| w["id"] == entry.id) {
            if inputs.get(&entry.id).is_some_and(|known| *known != input(&entry)) {
                return Err(RuntimeError::Structural { code: "E_WRITE_ID_REUSE", message: "write id already belongs to different input; recover the original input or use a new id".into() });
            }
            record["outcome"] = outcome.clone();
            record["admitted"] = false.into();
            record.as_object_mut().unwrap().remove("why");
        } else if let Some(queued) = queued {
            record["admitted"] = true.into();
            record["store"] = queued.receipt_store.and_then(|r| r.id).or(tx.meta(STORE_ID)?).into();
            record.as_object_mut().unwrap().remove("why");
        } else if record["why"]["code"] == "E_ADMISSION_TIMEOUT" {
            // Publication may race the JS state read without changing the
            // deferred blob. Adjudicate that expiry under this writer lock too.
            let store = tx.meta(STORE_ID)?;
            let established = meta_u64(tx, "client:identity-established")?;
            if established > 0 && record["identity"]["deadline"].as_u64().is_some_and(|deadline| established <= deadline)
                && store.is_some() && tx.meta(store_identity::RESTORE_REFUSED)?.is_none()
                && record["identity"]["backend"].as_str() == tx.meta(BACKEND_IDENTITY)?.as_deref()
                && record["identity"]["store"].as_str().is_none_or(|expected| store.as_deref() == Some(expected)) {
                record["store"] = store.into();
                record.as_object_mut().unwrap().remove("why");
            }
        }
    }
    let unchanged = proposed == original;
    if unchanged { tx.set_meta(KEY, value)?; }
    else { tx.set_meta(KEY, &encoded(&proposed)?)?; }
    Ok(unchanged)
}

pub(super) fn same_input(original: &Queued, entry: &Queued) -> Result<(), RuntimeError> {
    if original.op != entry.op || original.args != entry.args || original.viewer != entry.viewer {
        return Err(RuntimeError::Structural { code: "E_WRITE_ID_REUSE", message: "write id already belongs to a different operation or arguments; retry the original input or use a new id".into() });
    }
    Ok(())
}
