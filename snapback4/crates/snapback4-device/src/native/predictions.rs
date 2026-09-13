//! Durable confirmed images beneath the ordered native outbox.
use super::*;
use rusqlite::params;

// @ref LLP 3000#7-decisions-during-execution — pending belongs to the device
// card, not the application row supplied to the shared mutation interpreter.
// Only this metadata is removed; undeclared application fields still refuse.
pub(super) fn without_pending(mut row: Value) -> Value {
    if let Value::Row(fields) = &mut row { fields.remove("pending"); }
    row
}
pub(super) fn remember(tx: &Tx<'_>, table: &str, id: &str) -> Result<(), RuntimeError> {
    let row = tx.get(table, id)?.map(|row| serde_json::to_string(&row).expect("stored value"));
    tx.conn().execute("INSERT OR IGNORE INTO _device_base(t, id, data) VALUES (?1, ?2, ?3)", params![table, id, row])?;
    Ok(())
}
pub(super) fn restore(tx: &Tx<'_>, schema: &Schema) -> Result<(), RuntimeError> {
    let rows: Vec<(String, String, Option<String>)> = tx.conn().prepare("SELECT t, id, data FROM _device_base ORDER BY t, id")?.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
    for (name, id, data) in rows {
        let Some(table) = schema.table(&name) else { continue };
        let old = tx.get(&name, &id)?;
        if let Some(data) = data {
            let row: Value = serde_json::from_str(&data).map_err(|e| RuntimeError::Store(e.to_string()))?;
            tx.put(&name, table, &row, old.as_ref())?;
        } else if let Some(old) = old { tx.delete(&name, table, &old)?; }
    }
    tx.conn().execute("DELETE FROM _device_base", [])?;
    Ok(())
}
pub(super) fn enqueue(tx: &Tx<'_>, entry: &Queued) -> Result<(), RuntimeError> {
    let json = serde_json::to_string(entry).map_err(|e| RuntimeError::Store(e.to_string()))?;
    tx.conn().execute("INSERT INTO _device_outbox(seq, id, entry) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET entry = excluded.entry", params![i64::try_from(entry.seq).map_err(|_| RuntimeError::Input("submission sequence exceeds the stored integer range".into()))?, entry.id, json])?;
    Ok(())
}
pub(super) fn run(tx: &Tx<'_>, schema: &Schema, program: &Program, entry: &Queued) -> Result<(Vec<String>, Vec<String>), RuntimeError> {
    let context = Context::new(&entry.viewer, typed_args(program, &entry.args)?).at(entry.now).with_ids(entry.new_ids.clone());
    let predicting = Predicting { tx, written: RefCell::new(Vec::new()) };
    let prediction = local::predict(&predicting, schema, program, context, Ceilings::default())?;
    Ok((predicting.written.into_inner(), prediction.new_ids))
}
pub(super) fn replay(tx: &Tx<'_>, schema: &Schema, programs: &BTreeMap<String, Program>, watermark: u64) -> Result<(), RuntimeError> {
    let entries: Vec<String> = tx.conn().prepare("SELECT entry FROM _device_outbox ORDER BY seq")?.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    for data in entries {
        let mut entry: Queued = serde_json::from_str(&data).map_err(|e| RuntimeError::Store(e.to_string()))?;
        if entry.sent_seq.is_some_and(|seq| seq <= watermark) { tx.conn().execute("DELETE FROM _device_outbox WHERE id = ?1", [&entry.id])?; continue; }
        if entry.observed_seq.is_some_and(|seq| seq <= watermark) { continue; }
        let Some(program) = programs.get(&entry.op) else { continue };
        if !entry.predictable || entry.viewer.is_empty() { continue; }
        tx.savepoint("replay")?;
        match run(tx, schema, program, &entry) {
            Ok((_, ids)) if ids.len() <= entry.new_ids.len() => tx.release("replay")?,
            Ok(_) => {
                // An in-flight server request already owns the admitted id
                // supply. A changed population cannot invent more stable
                // client ids retroactively; withdraw this prediction.
                tx.rollback_to("replay")?;
                entry.predictable = false; entry.predicted.clear(); enqueue(tx, &entry)?;
            },
            Err(error) if error.is_refusal() => { tx.rollback_to("replay")?; }
            Err(error) => return Err(error),
        }
    }
    Ok(())
}
