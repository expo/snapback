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
    // Replay mints past the admitted ids only to discover it needs more (and
    // is then withdrawn): its entropy comes from the entry, never the clock.
    let entropy = entry.id.bytes().fold(entry.seq.wrapping_mul(0x9E37_79B9_7F4A_7C15), |acc, byte| (acc ^ u64::from(byte)).wrapping_mul(0x100_0000_01B3));
    let context = Context::new(&entry.viewer, media::inputs(tx, program, &entry.viewer, &entry.args)?).at(entry.now).with_ids(entry.new_ids.clone()).with_entropy(entropy | 1);
    let predicting = Predicting { tx, written: RefCell::new(Vec::new()) };
    let prediction = local::predict(&predicting, schema, program, context, Ceilings::default())?;
    Ok((predicting.written.into_inner(), prediction.new_ids))
}

pub(super) fn replay<T: DeviceTx>(tx: &T, schema: &Schema, programs: &BTreeMap<String, Program>, watermark: u64) -> Result<(), RuntimeError> {
    for data in tx.outbox_entries()? {
        let mut entry: Queued = decoded(&data)?;
        if entry.sent_seq.is_some_and(|seq| seq <= watermark) {
            tx.outbox_delete(&entry.id)?;
            continue;
        }
        if entry.observed_seq.is_some_and(|seq| seq <= watermark) {
            continue;
        }
        let Some(program) = programs.get(&entry.op) else { continue };
        if !entry.predictable || entry.viewer.is_empty() {
            continue;
        }
        tx.savepoint("replay")?;
        match run(tx, schema, program, &entry) {
            Ok((_, ids)) if ids.len() <= entry.new_ids.len() => tx.release("replay")?,
            Ok(_) => {
                // An in-flight server request already owns the admitted id
                // supply. A changed population cannot invent more stable
                // client ids retroactively; withdraw this prediction.
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
