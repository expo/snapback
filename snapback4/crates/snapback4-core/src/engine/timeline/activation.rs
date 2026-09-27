//! Retirement is atomic. Existing history cannot be reconstructed from sources.
// @ref LLP 3000.013#4-following-without-caps — copies, admission history and derived totals share activation.
use super::*;
use crate::{schema::Schema, store::Tx};
use rusqlite::OptionalExtension;

fn populated(tx: &Tx<'_>, table: &str) -> Result<bool, RuntimeError> {
    Ok(tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM r JOIN _catalog c ON r.t = c.num WHERE c.name = ?1)", [table], |row| row.get(0))?)
}

/// Fence stores left by the withdrawn experimental builder. Recognize its
/// single control identity, never execute it or resume a partial reconstruction.
/// Removing the view bypasses this fence and retires that work in the same commit.
pub(crate) fn check_no_rebuilds(tx: &Tx<'_>, schema: &Schema) -> Result<(), RuntimeError> {
    for t in &schema.timelines {
        let id = crate::schema::timeline::owned_id(&t.name, "Work", &[
            Value::String("rebuild".into()), Value::Id("service:$timeline-rebuild".into()),
            Value::Null, Value::Null, Value::Null,
        ]);
        let exists: bool = tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM r WHERE t = (SELECT num FROM _catalog WHERE name = ?1) AND id = ?2)", [&t.table("Work"), &id], |row| row.get(0))?;
        if exists {
            return Err(refusal("E_TIMELINE_REDEFINE", format!("view {}: an unfinished experimental reconstruction cannot prove repost identities or complete history; remove the view and deploy, then add the new definition over empty event and edge tables, or use the planned home query in guide feeds over the retained sources", t.name)));
        }
    }
    Ok(())
}

pub(crate) fn check_activation(tx: &Tx<'_>, schema: &Schema) -> Result<(), RuntimeError> {
    crate::schema::timeline::check_version(schema)?;
    let previous: Option<String> = tx.conn().query_row("SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')", [], |row| row.get(0)).optional()?;
    let previous: Schema = previous.map(|s| crate::json_codec::from_text(&s).map_err(|e| RuntimeError::Store(e.to_string()))).transpose()?.unwrap_or_default();
    crate::schema::timeline::check_version(&previous)?;
    for old in &previous.timelines {
        if let Some(new) = schema.timelines.iter().find(|new| old.name == new.name) {
            if !old.same_declaration(new) {
                return Err(refusal("E_TIMELINE_REDEFINE", format!("view {}: changing its predicate or sources cannot recover edge-admission history or repost identities without their declaration-specific slots; original event ids are post ids; remove the view and deploy, then add the new definition over empty event and edge tables, or use the planned home query in guide feeds over the retained sources", old.name)));
            }
        }
    }
    check_no_rebuilds(tx, schema)?;
    let retired = crate::successor::retired_timeline_tables(&previous, schema);
    for new in &schema.timelines {
        if previous.timelines.iter().any(|old| old.same_declaration(new)) { continue; }
        for table in &new.owned {
            if !retired.contains(table) && populated(tx, table)? {
                return Err(refusal("E_TIMELINE_ACTIVATE", format!("view {}: owned table {table} contains application data; rename the view to leave that table intact", new.name)));
            }
        }
        for table in new.event_tables() {
            if populated(tx, table)? {
                return Err(refusal("E_TIMELINE_ACTIVATE", format!("view {}: source table {table} is populated; original event ids are post ids, but this new declaration has no repost identity slots or edge-admission history. Use the planned query from guide feeds: query home(c: cursor ?): return activity where .actor = viewer or exists follows[viewer, .actor] last 20 by .at after c", new.name)));
            }
        }
    }
    // Clear reused names too. This includes dependent public/private aggregate
    // targets; surviving maintained columns are reset by ordinary activation.
    // Catalog numbers stay reserved, as for removed maintained tables.
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
