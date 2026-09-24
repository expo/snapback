//! Retire derived state atomically; rebuild retained sources on the delivery queue.
// @ref LLP 3000.013#4-following-without-caps — adoption is a new delivery boundary.
use super::*;
use crate::{schema::Schema, store::Tx, Context, Ceilings, meter::{Meter, Cut}, partition};
use rusqlite::OptionalExtension;

fn populated(tx: &Tx<'_>, table: &str) -> Result<bool, RuntimeError> {
    Ok(tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM r JOIN _catalog c ON r.t = c.num WHERE c.name = ?1)", [table], |row| row.get(0))?)
}

pub(crate) fn check_activation(tx: &Tx<'_>, schema: &Schema) -> Result<(), RuntimeError> {
    crate::schema::timeline::check_version(schema)?;
    let previous: Option<String> = tx.conn().query_row("SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')", [], |row| row.get(0)).optional()?;
    let previous: Schema = previous.map(|s| crate::json_codec::from_text(&s).map_err(|e| RuntimeError::Store(e.to_string()))).transpose()?.unwrap_or_default();
    // The 0.3 publication modes cannot be interpreted by the V2 worker.
    crate::schema::timeline::check_version(&previous)?;
    let retired: std::collections::BTreeSet<_> = previous.timelines.iter()
        .filter(|old| !schema.timelines.iter().any(|new| old.same_declaration(new)))
        .flat_map(|old| old.owned.iter().cloned()).collect();
    for new in &schema.timelines {
        if previous.timelines.iter().any(|old| old.same_declaration(new)) { continue; }
        for table in &new.owned {
            if !retired.contains(table) && populated(tx, table)? {
                return Err(refusal("E_TIMELINE_ACTIVATE", format!("view {}: owned table {table} contains application data; rename the view to leave that table intact", new.name)));
            }
        }
    }
    // Clear even when a retired name is reused in the candidate. No old copy,
    // epoch, tombstone or queued delivery can cross the generation boundary.
    // Catalog numbers stay reserved, exactly as for removed maintained tables.
    for table in retired {
        tx.conn().execute("DELETE FROM r WHERE t = (SELECT num FROM _catalog WHERE name = ?1)", [&table])?;
        if let Some(old) = previous.table(&table) {
            for index in old.indexes.keys() {
                tx.conn().execute("DELETE FROM i WHERE ti = (SELECT num FROM _catalog WHERE name = ?1)", [format!("{table}.{index}")])?;
            }
        }
    }
    Ok(())
}

pub(crate) fn activate_rebuilds(tx: &Tx<'_>, schema: &Schema, previous: Option<&Schema>, now: i64) -> Result<(), RuntimeError> {
    for t in &schema.timelines {
        if previous.is_some_and(|old| old.timelines.iter().any(|old| old.same_declaration(t))) { continue; }
        if !t.event_tables().iter().map(|table| populated(tx, table)).collect::<Result<Vec<_>, _>>()?.into_iter().any(|p| p) { continue; }
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(tx, schema, Context::system().at(now), Meter::new(Ceilings::job(), Cut::Abort), seq);
        let mut runner = runner.timeline_scope(super::super::timeline_authority::Authority::Transition(t.name.clone()));
        runner.timeline_enqueue(t, "rebuild", Value::Id(super::rebuild::REBUILD_SEAT.into()), Value::Null, Value::Null, Value::Null, 0, None)?;
        let events = runner.events.take();
        let tables: Vec<_> = runner.written_tables.iter().cloned().collect();
        tx.record_commit(seq, now, &format!("{}:rebuild", t.name), crate::SYSTEM_PRINCIPAL, "rebuild", &tables, runner.rows_written)?;
        partition::append(tx, seq, &events)?;
    }
    Ok(())
}
