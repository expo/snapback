//! A closed ordinary release slice; unchanged authority-bearing tables survive.
// @ref LLP 3000.009.001.000#3.5 — unsupported changes refuse before installation/preparation writes.
use super::store::{Tx, decode};
use crate::{
    RuntimeError, Schema,
    schema::{ColumnDefault, Constraint, Table},
};

fn refuse(family: &'static str) -> RuntimeError {
    RuntimeError::StoreUnsupported { family }
}
fn plain(table: &Table) -> bool {
    table.ephemeral.is_none()
        && table.through.is_none()
        && table.recorded.is_empty()
        && table.expire.is_none()
        && table.not_before.is_none()
        && table.sequences.is_empty()
        && table.written_by.is_empty()
        && table.column_reads.is_empty()
}
fn compatible(old: &Table, next: &Table) -> Result<(), RuntimeError> {
    if old == next {
        return Ok(());
    }
    if !plain(old) || !plain(next) {
        return Err(refuse("evolution-authority"));
    }
    for (column, kind) in &old.columns {
        if next.columns.get(column).is_some_and(|new| new != kind)
            || (next.columns.contains_key(column)
                && old.defaults.get(column) != next.defaults.get(column))
        {
            return Err(refuse("evolution-narrowing"));
        }
    }
    for column in old.columns.keys().filter(|c| next.columns.contains_key(*c)) {
        if old.on_delete.get(column) != next.on_delete.get(column) {
            return Err(refuse("evolution-authority"));
        }
    }
    // Logical unique constraints are represented by their rebuilt index. Text
    // constraints on a retired/new column travel with that column's definition.
    let constraints = |table: &Table| {
        table
            .constraints
            .iter()
            .filter(|c| match c {
                Constraint::Unique { .. } => false,
                Constraint::Text { field, .. } => {
                    old.columns.contains_key(field) && next.columns.contains_key(field)
                }
                _ => true,
            })
            .cloned()
            .collect::<Vec<_>>()
    };
    if constraints(old) != constraints(next) {
        return Err(refuse("evolution-narrowing"));
    }
    let mut comparable = next.clone();
    comparable.constraints = old.constraints.clone();
    comparable.on_delete = old.on_delete.clone();
    comparable.columns = old.columns.clone();
    comparable.defaults = old.defaults.clone();
    comparable.indexes = old.indexes.clone();
    if &comparable != old {
        return Err(refuse("evolution-authority"));
    }
    Ok(())
}
pub(super) fn admit(previous: &Schema, next: &Schema) -> Result<(), RuntimeError> {
    if !next.backfills.is_empty()
        || !next.downfills.is_empty()
        || !previous.backfills.is_empty()
        || !previous.downfills.is_empty()
    {
        return Err(refuse("evolution-backfill"));
    }
    if !next.table_renames.is_empty()
        || !next.asset_renames.is_empty()
        || !previous.table_renames.is_empty()
        || !previous.asset_renames.is_empty()
    {
        return Err(refuse("evolution-renames"));
    }
    for (name, table) in &previous.tables {
        if !next.tables.contains_key(name) && !table.maintained.is_empty() {
            return Err(refuse("evolution-authority"));
        }
    }
    let mut old = crate::engine::activation_facts::ordinary(previous);
    let mut new = crate::engine::activation_facts::ordinary(next);
    // Authored-index custody is descriptive, not a second physical declaration.
    old.authored_indexes = Default::default();
    new.authored_indexes = Default::default();
    old.unique_refusals.clear();
    new.unique_refusals.clear();
    for name in old.tables.keys().chain(new.tables.keys()) {
        match (old.table(name), new.table(name)) {
            (Some(a), Some(b)) => compatible(a, b)?,
            (Some(table), None) | (None, Some(table)) if !plain(table) => {
                return Err(refuse("evolution-authority"));
            }
            _ => {}
        }
    }
    old.tables.clear();
    new.tables.clear();
    if old != new {
        return Err(refuse("release-activation"));
    }
    Ok(())
}

/// Dormant definitions also constrain the transition: restored types cannot
/// acquire narrowing or a new storage owner through a temporarily absent name.
pub(super) fn retained(tx: &Tx<'_>, previous: &Schema, next: &Schema) -> Result<(), RuntimeError> {
    for (name, table) in &next.tables {
        if let Some(old) = previous.table(name) {
            if table.constraints.iter().any(
                |c| matches!(c, Constraint::Text {field,..} if !old.columns.contains_key(field)),
            ) {
                return Err(refuse("evolution-narrowing"));
            }
            for (column, kind) in &table.columns {
                if !old.columns.contains_key(column)
                    && !kind.is_optional()
                    && !table.maintained.contains_key(column)
                    && !matches!(table.defaults.get(column), Some(ColumnDefault::Literal(_)))
                {
                    let exists: bool = tx
                        .query("SELECT to_regclass('_dormant_columns') IS NOT NULL", &[])?[0]
                        .get(0);
                    if !exists || !tx.query("SELECT EXISTS(SELECT 1 FROM _dormant_columns WHERE table_name=$1 AND column_name=$2)", &[name,column])?[0].get::<_,bool>(0) {
                        return Err(refuse("evolution-required-column"));
                    }
                }
            }
        }
    }
    // Older attaches have not installed the ledgers yet; there is no hidden data.
    if !tx.query("SELECT to_regclass('_dormant_tables') IS NOT NULL", &[])?[0].get::<_, bool>(0) {
        return Ok(());
    }
    super::evolution_schema::verify(tx)?;
    for row in tx.query(
        "SELECT table_name,definition FROM _dormant_tables ORDER BY table_name",
        &[],
    )? {
        let name: String = row.get(0);
        if let Some(table) = next.table(&name) {
            let old: Table = decode(row.get(1))?;
            if !old.maintained.is_empty() {
                return Err(refuse("evolution-authority"));
            }
            compatible(&old, table)?;
            for (column, kind) in &table.columns {
                if !old.columns.contains_key(column)
                    && !kind.is_optional()
                    && !matches!(table.defaults.get(column), Some(ColumnDefault::Literal(_)))
                {
                    return Err(refuse("evolution-required-column"));
                }
            }
        }
    }
    for row in tx.query("SELECT table_name,column_name,definition FROM _dormant_columns ORDER BY table_name,column_name", &[])? {
        let name: String = row.get(0); let column: String = row.get(1);
        if let Some(table) = next.table(&name).filter(|t| t.columns.contains_key(&column)) {
            let old: super::evolution::Column = decode(row.get(2))?;
            if table.columns[&column] != old.kind || table.defaults.get(&column) != old.default.as_ref() {
                return Err(refuse("evolution-narrowing"));
            }
            if table.maintained.contains_key(&column) || table.engine_field(&column) { return Err(refuse("evolution-authority")); }
        }
    }
    Ok(())
}
