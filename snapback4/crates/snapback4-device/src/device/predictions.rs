//! Durable confirmed images beneath the ordered outbox: a prediction
//! remembers what it replaces, a refusal restores it, and the survivors
//! are replayed in submission order over the confirmed base.
use super::*;

// @ref LLP 3000#7-decisions-during-execution — pending belongs to the device
// card, not the application row supplied to the shared mutation interpreter.
// Only this metadata is removed; undeclared application fields still refuse.
pub(super) fn without_pending(mut row: Value) -> Value {
    if let Value::Row(fields) = &mut row {
        fields.remove("pending");
    }
    row
}

pub(super) fn remember<T: DeviceTx>(tx: &T, table: &str, id: &str) -> Result<(), RuntimeError> {
    let image = tx.get(table, id)?.map(|row| encoded(&row)).transpose()?;
    tx.base_remember(table, id, image.as_deref())
}

pub(super) fn restore<T: DeviceTx>(tx: &T, schema: &Schema) -> Result<(), RuntimeError> {
    for (name, id, image) in tx.base_entries()? {
        let Some(table) = schema.table(&name) else { continue };
        let old = tx.get(&name, &id)?;
        match image {
            Some(image) => {
                let row: Value = decoded(&image)?;
                tx.put(&name, table, &row, old.as_ref())?;
            }
            None => {
                if let Some(old) = old {
                    tx.delete(&name, table, &old)?;
                }
            }
        }
    }
    tx.base_clear()
}

pub(super) fn enqueue<T: DeviceTx>(tx: &T, entry: &Queued) -> Result<(), RuntimeError> {
    tx.outbox_upsert(entry.seq, &entry.id, &encoded(entry)?)
}

pub(super) fn run<T: DeviceTx>(tx: &T, schema: &Schema, program: &Program, entry: &Queued) -> Result<(Vec<String>, Vec<String>), RuntimeError> {
    // Missing acquisition is missing evidence, never an authored refusal.
    // Admission already handles E_PREDICT by durably queueing without a row.
    require_acquired(tx, schema, program)?;
    // Replay mints past the admitted ids only to discover it needs more (and
    // is then withdrawn): its entropy comes from the entry, never the clock.
    let entropy = entry.id.bytes().fold(entry.seq.wrapping_mul(0x9E37_79B9_7F4A_7C15), |acc, byte| (acc ^ u64::from(byte)).wrapping_mul(0x100_0000_01B3));
    let context = Context::new(&entry.viewer, media::inputs(tx, program, &entry.viewer, &entry.args)?).at(entry.now).with_generation(meta_u64(tx, GENERATION)?).with_ids(entry.new_ids.clone()).with_entropy(entropy | 1);
    let predicting = Predicting { tx, schema, groups: history::load(tx, history::GROUPS)?, boundaries: boundary::Boundaries::load(tx, false)?, written: RefCell::new(Vec::new()) };
    let prediction = local::predict(&predicting, schema, program, context, Ceilings::default())?;
    Ok((predicting.written.into_inner(), prediction.new_ids))
}

// Request capture and published replay eligibility are separate: a deferred
// response must not change the overlay. The exclusion band ends at the request
// capture; writes admitted later must remain eligible on the published base.
const CAPTURE: &str = "device:declaration:capture";
const PUBLISHED: &str = "device:declaration:published";
const PENDING_LIMIT: usize = 256;

// (declared through, declaration complete, outbox upper bound at request time).
pub(super) type Declaration = (u64, bool, u64);

#[derive(Serialize, Deserialize)]
pub(super) struct Capture {
    pub ids: Vec<String>,
    pub declaration: Declaration,
}

// The interval and declared IDs must be the same prefix, regardless of the
// adapter's iteration order. Equal submission numbers cannot define a prefix.
fn ordered_entries<T: DeviceTx>(tx: &T) -> Result<Vec<Queued>, RuntimeError> {
    let mut entries = tx.outbox_entries()?.iter().map(|data| decoded::<Queued>(data)).collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.seq);
    if entries.windows(2).any(|pair| pair[0].seq >= pair[1].seq) {
        return Err(RuntimeError::Store("outbox submission numbers must be unique".into()));
    }
    Ok(entries)
}

// All builders share the in-flight declaration. A poll/retry cannot widen it;
// successful apply consumes it, and begin_send abandons obsolete requests.
pub(super) fn capture<T: DeviceTx>(tx: &T) -> Result<Capture, RuntimeError> {
    if let Some(capture) = load_capture(tx)? { return Ok(capture); }
    let entries = ordered_entries(tx)?;
    let capture = Capture {
        ids: entries.iter().take(PENDING_LIMIT).map(|q| q.id.clone()).collect(),
        declaration: (entries.iter().take(PENDING_LIMIT).last().map_or(0, |q| q.seq), entries.len() <= PENDING_LIMIT,
            // SUBMISSION is the inclusive last assigned number, never the next.
            entries.last().map_or(0, |q| q.seq).max(meta_u64(tx, SUBMISSION)?)),
    };
    tx.set_meta(CAPTURE, &encoded(&capture)?)?;
    Ok(capture)
}

// The checkpoint stored only bounds. Submission numbers never get reused,
// so its still-unretired IDs can be recovered without widening that capture.
fn load_capture<T: DeviceTx>(tx: &T) -> Result<Option<Capture>, RuntimeError> {
    let Some(data) = tx.meta(CAPTURE)?.filter(|s| !s.is_empty()) else { return Ok(None) };
    if let Ok(capture) = decoded::<Capture>(&data) { return Ok(Some(capture)); }
    let declaration: Declaration = decoded(&data)?;
    let ids: Vec<_> = ordered_entries(tx)?.into_iter().filter(|entry| entry.seq <= declaration.0).map(|entry| entry.id).collect();
    if ids.len() > PENDING_LIMIT {
        return Err(RuntimeError::Store("checkpoint pending declaration exceeds its prefix limit".into()));
    }
    Ok(Some(Capture { ids, declaration }))
}

pub(super) fn declaration<T: DeviceTx>(tx: &T, page: &StreamPage) -> Result<Declaration, RuntimeError> {
    let capture = load_capture(tx)?;
    match (page.pending_through, page.pending_complete) {
        (Some(through), Some(complete)) => {
            if let Some(capture) = &capture {
                let captured = capture.declaration;
                if through != captured.0 || complete != captured.1 || page.pending_bound.is_some_and(|bound| bound != captured.2) {
                    return Err(RuntimeError::Input("pending declaration echo differs from its request capture".into()));
                }
                return Ok(captured);
            }
            let bound = page.pending_bound;
            let bound = match bound {
                Some(bound) if bound >= through => bound,
                None if complete => through,
                _ => return Err(RuntimeError::Input("incomplete local pending declaration capture".into())),
            };
            Ok((through, complete, bound))
        }
        (None, None) => Ok(capture.map_or((0, false, 0), |c| c.declaration)),
        _ => Err(RuntimeError::Input("incomplete local pending declaration capture".into())),
    }
}

pub(super) fn clear_capture<T: DeviceTx>(tx: &T) -> Result<(), RuntimeError> {
    // FIRST_CAPTURE no longer has a writer: it was a second, conflicting
    // representation of the request. Remove residue at the same boundary.
    tx.delete_meta(&[CAPTURE, "device:declaration:first-capture"])
}

pub(super) fn reset<T: DeviceTx>(tx: &T, keep_images: bool) -> Result<(), RuntimeError> {
    clear_capture(tx)?;
    if !keep_images {
        tx.delete_meta(&[PUBLISHED])?;
        for data in tx.outbox_entries()? {
            let mut entry: Queued = decoded(&data)?;
            if let Some(seq) = entry.observed_seq.take() {
                // Dropping publication evidence must not turn a known execution
                // into an unsent write that a later replacement could retry.
                entry.sent_seq.get_or_insert(seq);
                enqueue(tx, &entry)?;
            }
        }
        // sent_seq proves execution, independently of our images. Keep it for
        // at-most-once settlement; with watermark zero it cannot suppress replay.
    }
    Ok(())
}

pub(super) fn publish_declaration<T: DeviceTx>(tx: &T, declaration: Declaration) -> Result<(), RuntimeError> {
    tx.set_meta(PUBLISHED, &encoded(&(declaration.0, declaration.2))?)?;
    clear_capture(tx)
}

pub(super) fn replay_limit<T: DeviceTx>(tx: &T) -> Result<(u64, u64), RuntimeError> {
    tx.meta(PUBLISHED)?.filter(|s| !s.is_empty()).map(|data| decoded(&data)).transpose().map(|v| v.unwrap_or((0, 0)))
}

// @ref LLP 3000.001#reliability-catchup — the publication decision and replay share eligibility, including the declaration guard.
pub(super) fn replayable(entry: &Queued, programs: &BTreeMap<String, Program>, watermark: u64, declaration: (u64, u64), store: Option<&str>) -> bool {
    !(receipt_matches(entry, store) && entry.sent_seq.is_some_and(|seq| seq <= watermark))
        // An observation is written only with its published row effects. A
        // generation can reset the transfer watermark while retaining them.
        && !(receipt_matches(entry, store) && entry.observed_seq.is_some())
        && entry.predictable && !entry.viewer.is_empty() && programs.contains_key(&entry.op)
        && (entry.seq <= declaration.0 || entry.seq > declaration.1)
}

pub(super) fn replay<T: DeviceTx>(tx: &T, schema: &Schema, programs: &BTreeMap<String, Program>, watermark: u64) -> Result<(), RuntimeError> {
    let declaration = replay_limit(tx)?;
    let store = tx.meta(STORE_ID)?;
    for data in tx.outbox_entries()? {
        let mut entry: Queued = decoded(&data)?;
        if receipt_matches(&entry, store.as_deref()) && entry.sent_seq.is_some_and(|seq| seq <= watermark) {
            remove(tx, &entry.id)?;
            continue;
        }
        if !replayable(&entry, programs, watermark, declaration, store.as_deref()) { continue; }
        let program = &programs[&entry.op];
        tx.savepoint("replay")?;
        match run(tx, schema, program, &entry) {
            // B2a is independent of page deferral: refusal withdrawal uses this set.
            Ok((predicted, ids)) if ids.len() <= entry.new_ids.len() => {
                tx.release("replay")?;
                if entry.predicted != predicted {
                    entry.predicted = predicted;
                    enqueue(tx, &entry)?;
                }
            },
            Ok(_) => {
                // An in-flight server request already owns the admitted id
                // supply. A changed population cannot invent more stable
                // client ids retroactively; withdraw this prediction.
                tx.rollback_to("replay")?;
                entry.predictable = false;
                entry.predicted.clear();
                enqueue(tx, &entry)?;
            }
            Err(RuntimeError::Prediction(_)) => {
                tx.rollback_to("replay")?;
                entry.predictable = false;
                entry.predicted.clear();
                enqueue(tx, &entry)?;
            }
            Err(error) if error.is_refusal() => tx.rollback_to("replay")?,
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

// Receipts and their incarnation are one outbox value, persisted together.
pub(super) fn receipt_matches(entry: &Queued, store: Option<&str>) -> bool {
    entry.receipt_store.as_ref().is_none_or(|receipt| receipt.id.as_deref() == store)
}

pub(super) fn record_receipt<T: DeviceTx>(tx: &T, entry: &mut Queued, seq: u64, observed: bool) -> Result<(), RuntimeError> {
    let store = tx.meta(STORE_ID)?.or(tx.meta(deferred::IDENTITY)?);
    if (entry.sent_seq.is_some() || entry.observed_seq.is_some()) && !receipt_matches(entry, store.as_deref()) {
        return Ok(()); // A replacement cannot rebind a preserved old receipt.
    }
    entry.receipt_store = Some(ReceiptStore { id: store });
    if observed { entry.observed_seq = Some(seq); } else { entry.sent_seq = Some(seq); }
    enqueue(tx, entry)
}

pub(super) fn remove<T: DeviceTx>(tx: &T, id: &str) -> Result<(), RuntimeError> {
    tx.outbox_delete(id)
}

// Upgrade old implicit receipts while their original incarnation is still
// available. The ordinary receipt writer owns the only persisted binding.
pub(super) fn bind_legacy_receipts<T: DeviceTx>(tx: &T) -> Result<(), RuntimeError> {
    for data in tx.outbox_entries()? {
        let mut entry: Queued = decoded(&data)?;
        if entry.receipt_store.is_none() && let Some(seq) = entry.sent_seq.or(entry.observed_seq) {
            let observed = entry.sent_seq.is_none();
            record_receipt(tx, &mut entry, seq, observed)?;
        }
    }
    Ok(())
}
