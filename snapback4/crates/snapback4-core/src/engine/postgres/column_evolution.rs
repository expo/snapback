//! The bounded physical part of ordinary maintained-column activation.
// @ref LLP 3000.007.001#3.11 — project removals, rebuild private totals, then mirror before publishing the generation.
use super::store::{Tx, decode};
use crate::{RuntimeError, Schema, Value, value::canonical_json};

/// Only derivations and their readable columns/indexes may change. In particular,
/// converting an ordinary column into an engine column is not this transition.
pub(super) fn admit(previous: &Schema, next: &Schema) -> Result<(), RuntimeError> {
    fn ordinary(schema: &Schema) -> Schema {
        let mut ordinary = schema.clone();
        ordinary.tables.retain(|name, _| schema.private_owner(name).is_none());
        ordinary.maintains.retain(|m| m.private.is_none());
        for table in ordinary.tables.values_mut() {
            table.columns.retain(|field, _| !table.maintained.contains_key(field));
            table.indexes.retain(|_, index| !index.columns().iter().any(|field| table.maintained.contains_key(field)));
            table.maintained.clear();
        }
        // These are derived prices/indexes, not another permitted schema change.
        // Program changes may also change residency/source-location facts.
        // They are executable metadata, checked by the common program admission.
        ordinary.operations.clear();
        ordinary.source_reservations.clear();
        ordinary.prepare_contribution_indexes();
        ordinary
    }
    if ordinary(previous) != ordinary(next) {
        return Err(RuntimeError::StoreUnsupported { family: "release-activation" });
    }
    Ok(())
}

/// Called only by fenced attach, after admission and release CAS checks. All
/// relations already exist and passed the normal attach shape validation.
/// Canonical values stay in Rust: jsonb would reject otherwise valid escaped NUL.
pub(super) fn project(tx: &Tx<'_>, previous: &Schema, next: &Schema) -> Result<(), RuntimeError> {
    for maintain in previous.maintains.iter().filter(|m| m.private.is_some()
        && !next.maintains.iter().any(|n| n.target == m.target)) {
        tx.rows_cache.borrow_mut().invalidate(&maintain.target);
        tx.execute("DELETE FROM i WHERE t=$1", &[&maintain.target])?;
        tx.execute("DELETE FROM r WHERE t=$1", &[&maintain.target])?;
    }
    for (name, table) in &next.tables {
        let Some(old) = previous.table(name).filter(|old| *old != table) else { continue };
        tx.rows_cache.borrow_mut().invalidate(name);
        let indexes: std::collections::BTreeSet<_> = table.indexes.keys().chain(old.indexes.keys())
            .filter(|index| old.indexes.get(*index) != table.indexes.get(*index)).cloned().collect();
        for index in &indexes { tx.execute("DELETE FROM i WHERE t=$1 AND ix=$2", &[name, index])?; }
        let mut after: Option<String> = None;
        loop {
            let rows = tx.query("SELECT id,data FROM r WHERE t=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 256", &[name, &after])?;
            if rows.is_empty() { break; }
            for row in rows {
                let id: String = row.get(0);
                let mut image: Value = decode(row.get(1))?;
                if let Value::Row(fields) | Value::Map(fields) = &mut image {
                    let before = fields.len();
                    fields.retain(|field, _| table.columns.contains_key(field));
                    if fields.len() != before {
                        tx.execute("UPDATE r SET data=$3 WHERE t=$1 AND id=$2", &[name, &id, &canonical_json(&image)])?;
                    }
                }
                // index_write enforces the portable key bound and sparse-zero
                // interpretation, just like an ordinary row write.
                for write in crate::rows::index_write(name, table, &image, None, &id)? {
                    if indexes.contains(write.name) {
                        for key in write.after { tx.execute("INSERT INTO i(t,ix,k,id) VALUES ($1,$2,$3,$4)", &[name, &write.name, &key, &id])?; }
                    }
                }
                after = Some(id);
            }
        }
    }
    Ok(())
}
