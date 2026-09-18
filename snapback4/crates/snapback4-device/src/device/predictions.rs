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
pub(super) const DECLARATION_PREFIX: &str = "device:declaration:";
pub(super) const CAPTURE: &str = "device:declaration:capture";
pub(super) const FIRST_CAPTURE: &str = "device:declaration:first-capture";
pub(super) const PUBLISHED: &str = "device:declaration:published";

// (declared through, declaration complete, outbox upper bound at request time).
pub(super) type Declaration = (u64, bool, u64);

pub(super) fn declaration<T: DeviceTx>(tx: &T, page: &StreamPage) -> Result<Declaration, RuntimeError> {
    let capture = tx.meta(CAPTURE)?.filter(|s| !s.is_empty()).map(|s| decoded::<Declaration>(&s)).transpose()?;
    match (page.pending_through, page.pending_complete) {
        (Some(through), Some(complete)) => Ok((through, complete,
            page.pending_bound.or(capture.map(|c| c.2)).unwrap_or(through))),
        (None, None) => {
            let latest = capture.unwrap_or((0, false, 0));
            // Only an un-echoed reply is ambiguous. Never narrow the next
            // request's live declaration; successful apply ends this window.
            let first = tx.meta(FIRST_CAPTURE)?.filter(|s| !s.is_empty()).map(|s| decoded::<Declaration>(&s)).transpose()?.unwrap_or(latest);
            Ok((first.0.min(latest.0), first.1 && latest.1 && first.0 == latest.0, first.2.max(latest.2)))
        }
        _ => Err(RuntimeError::Input("incomplete local pending declaration capture".into())),
    }
}

pub(super) fn clear_capture<T: DeviceTx>(tx: &T) -> Result<(), RuntimeError> {
    tx.delete_meta(&[CAPTURE, FIRST_CAPTURE])
}

pub(super) fn publish_declaration<T: DeviceTx>(tx: &T, declaration: Declaration) -> Result<(), RuntimeError> {
    tx.set_meta(PUBLISHED, &encoded(&(declaration.0, declaration.2))?)?;
    clear_capture(tx)
}

pub(super) fn replay_limit<T: DeviceTx>(tx: &T) -> Result<(u64, u64), RuntimeError> {
    tx.meta(PUBLISHED)?.filter(|s| !s.is_empty()).map(|data| decoded(&data)).transpose().map(|v| v.unwrap_or((0, 0)))
}

// @ref LLP 3000.001#reliability-catchup — the publication decision and replay share eligibility, including the declaration guard.
pub(super) fn replayable(entry: &Queued, programs: &BTreeMap<String, Program>, watermark: u64, declaration: (u64, u64)) -> bool {
    !entry.sent_seq.is_some_and(|seq| seq <= watermark)
        // An observation is written only with its published row effects. A
        // generation can reset the transfer watermark while retaining them.
        && entry.observed_seq.is_none()
        && entry.predictable && !entry.viewer.is_empty() && programs.contains_key(&entry.op)
        && (entry.seq <= declaration.0 || entry.seq > declaration.1)
}

pub(super) fn replay<T: DeviceTx>(tx: &T, schema: &Schema, programs: &BTreeMap<String, Program>, watermark: u64) -> Result<(), RuntimeError> {
    let declaration = replay_limit(tx)?;
    for data in tx.outbox_entries()? {
        let mut entry: Queued = decoded(&data)?;
        if entry.sent_seq.is_some_and(|seq| seq <= watermark) {
            tx.outbox_delete(&entry.id)?;
            continue;
        }
        if !replayable(&entry, programs, watermark, declaration) { continue; }
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
