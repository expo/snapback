//! A closed ordinary release slice, preserving the existing maintained-column lane.
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
        if let Some(candidate) = next.table(name) {
            if previous.maintain_for(name).is_some() != next.maintain_for(name).is_some() {
                return Err(refuse("evolution-authority"));
            }
            for column in table
                .columns
                .keys()
                .filter(|c| candidate.columns.contains_key(*c))
            {
                let before = table.maintained.contains_key(column) || table.engine_field(column);
                let after =
                    candidate.maintained.contains_key(column) || candidate.engine_field(column);
                if before != after {
                    return Err(refuse("evolution-authority"));
                }
            }
        }
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
    let ordinary_changed = old != new;
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
    // Cascading reference columns carry derived action-event prices even when
    // no delete operation is authored. Retiring one changes those prices along
    // with its table definition. Input derivation and executable facts are
    // checked separately; table-relative prices are not residual declarations.
    old.source_reservations.clear();
    new.source_reservations.clear();
    if old != new {
        return Err(refuse("release-activation"));
    }
    // SQLite's release source-retirement barrier visits unchanged lifetime /
    // read-through populations too. Their dormant closure belongs to EV-4;
    // an unrelated ordinary edit cannot silently skip that barrier on Postgres.
    // Preserve the previously admitted P1-MC transition (ordinary unchanged).
    if ordinary_changed && previous.tables.values().chain(next.tables.values()).any(|table|
        table.ephemeral.is_none() && (table.is_expiring() || table.through.is_some() || !table.recorded.is_empty())) {
        return Err(refuse("evolution-authority"));
    }
    Ok(())
}

/// Dormant definitions also constrain the transition: restored types cannot
/// acquire narrowing or a new storage owner through a temporarily absent name.
pub(super) fn retained(tx: &Tx<'_>, previous: &Schema, next: &Schema) -> Result<(), RuntimeError> {
    let installed =
        tx.query("SELECT to_regclass('_dormant_tables') IS NOT NULL", &[])?[0].get::<_, bool>(0);
    let mut columns = std::collections::BTreeMap::new();
    if installed {
        super::evolution_schema::verify(tx)?;
        for row in tx.query("SELECT table_name,column_name,definition FROM _dormant_columns ORDER BY table_name,column_name", &[])? {
            let name: String = row.get(0);
            let column: String = row.get(1);
            let old: super::evolution::Column = decode(row.get(2))?;
            if let Some(table) = next.table(&name).filter(|t| t.columns.contains_key(&column)) {
                if table.maintained.contains_key(&column) || table.engine_field(&column) {
                    return Err(refuse("evolution-authority"));
                }
                let restored = super::evolution::Column::retained(table, &column);
                if old.kind != restored.kind || old.default != restored.default || old.constraints != restored.constraints {
                    return Err(refuse("evolution-narrowing"));
                }
                if old != restored {
                    return Err(refuse("evolution-authority"));
                }
            }
            columns.insert((name,column),old);
        }
    }
    for (name, table) in &next.tables {
        if let Some(old) = previous.table(name) {
            if table.constraints.iter().any(
                |c| matches!(c, Constraint::Text {field,..} if !old.columns.contains_key(field) && !columns.contains_key(&(name.clone(),field.clone()))),
            ) {
                return Err(refuse("evolution-narrowing"));
            }
            for (column, kind) in &table.columns {
                if !old.columns.contains_key(column)
                    && !kind.is_optional()
                    && !table.maintained.contains_key(column)
                    && !matches!(table.defaults.get(column), Some(ColumnDefault::Literal(_)))
                {
                    if !columns.contains_key(&(name.clone(), column.clone())) {
                        return Err(refuse("evolution-required-column"));
                    }
                }
            }
        }
    }
    // Older attaches have not installed the ledgers yet; there is no hidden data.
    if !installed {
        return Ok(());
    }
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
    Ok(())
}
