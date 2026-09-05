//! Additive generation succession and explicit destructive migration plans.
// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — destructive changes need a plan.

use crate::engine::{
    RuntimeError, materialize_optional_fields, rebuild_owned_aggregate_target, reindex_row,
    validate_column_value,
};
use crate::schema::{ColumnType, Maintain, MaintainKind, Schema};
use crate::store::Store;
use crate::value::{I53_MAX, I53_MIN, Value, canonical_json};
use rusqlite::{Connection, Transaction, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Drop {
    Table {
        name: String,
        rows: u64,
    },
    Column {
        table: String,
        name: String,
    },
    Index {
        table: String,
        name: String,
    },
    TypeChange {
        table: String,
        column: String,
        from: ColumnType,
        to: ColumnType,
    },
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPlan {
    pub drops: Vec<Drop>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UniqueConflict {
    pub table: String,
    pub index: String,
    pub key: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Error, Serialize, Deserialize)]
#[error("{code}: {message}; rewrite: {rewrite}")]
#[serde(rename_all = "camelCase")]
pub struct SuccessorRefusal {
    pub code: String,
    pub message: String,
    pub rewrite: String,
    pub plan: MigrationPlan,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conflicts: Vec<UniqueConflict>,
    #[serde(flatten)]
    pub narrowing: Option<NarrowingConflict>,
}

impl SuccessorRefusal {
    pub(crate) fn destructive(plan: MigrationPlan) -> Self {
        Self {
            code: "E_SUCCESSOR_DESTRUCTIVE".to_owned(),
            message: "destructive successor requires an explicit migration plan".to_owned(),
            rewrite: "apply exactly the returned migration plan".to_owned(),
            plan,
            conflicts: Vec::new(),
            narrowing: None,
        }
    }

    pub(crate) fn store(error: &RuntimeError) -> Self {
        Self {
            code: "E_SUCCESSOR_STORE".to_owned(),
            message: error.to_string(),
            rewrite: "repair the store error and retry the successor".to_owned(),
            plan: MigrationPlan::default(),
            conflicts: Vec::new(),
            narrowing: None,
        }
    }

    fn required_column(table: &str, column: &str) -> Self {
        Self {
            code: "E_SUCCESSOR_COLUMN_REQUIRED".to_owned(),
            message: format!(
                "successor leaves required column {table}.{column} absent on stored rows"
            ),
            rewrite: format!(
                "declare {table}.{column} as T?, apply; fill it with an operator mutation (`run fill_{table}_{column} --as system`; a job once J1b lands); then declare T and apply again"
            ),
            plan: MigrationPlan::default(),
            conflicts: Vec::new(),
            narrowing: None,
        }
    }

    fn unique(conflicts: Vec<UniqueConflict>) -> Self {
        let indexes = conflicts
            .iter()
            .map(|conflict| format!("{}.{}", conflict.table, conflict.index))
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
            .join(", ");
        Self {
            code: "E_SUCCESSOR_UNIQUE".to_owned(),
            message: format!("new unique index has conflicting keys in {indexes}"),
            rewrite: "make the index non-unique or fix the rows".to_owned(),
            plan: MigrationPlan::default(),
            conflicts,
            narrowing: None,
        }
    }

    fn invalid_row(table: &str, row: &str, error: impl std::fmt::Display) -> Self {
        Self {
            code: "E_SUCCESSOR_ROW_INVALID".to_owned(),
            message: format!("successor validation refused stored row {table}.{row}: {error}"),
            rewrite: format!("repair or remove stored row {table}.{row}, then retry the successor"),
            plan: MigrationPlan::default(),
            conflicts: Vec::new(),
            narrowing: None,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessorReport {
    pub from: String,
    pub to: String,
    pub added_tables: Vec<String>,
    pub added_columns: Vec<String>,
    pub added_indexes: Vec<String>,
    pub backfilled_maintains: u64,
}

pub(crate) fn plan(
    store: &Store,
    current: &Schema,
    next: &Schema,
) -> Result<MigrationPlan, RuntimeError> {
    let mut drops = Vec::new();
    for (table_name, table) in &current.tables {
        let Some(next_table) = next.tables.get(table_name) else {
            let rows: i64 = store.conn.query_row(
                "SELECT COUNT(*) FROM rows WHERE table_name = ?1",
                [table_name],
                |row| row.get(0),
            )?;
            drops.push(Drop::Table {
                name: table_name.clone(),
                rows: rows.max(0) as u64,
            });
            continue;
        };
        for (column, column_type) in &table.columns {
            match next_table.columns.get(column) {
                None => drops.push(Drop::Column {
                    table: table_name.clone(),
                    name: column.clone(),
                }),
                Some(next_type)
                    if next_type != column_type && !is_narrowing(column_type, next_type) =>
                {
                    drops.push(Drop::TypeChange {
                        table: table_name.clone(),
                        column: column.clone(),
                        from: column_type.clone(),
                        to: next_type.clone(),
                    })
                }
                Some(_) => {}
            }
        }
        for (index, definition) in &table.indexes {
            if next_table
                .indexes
                .get(index)
                .is_none_or(|next_index| next_index.columns != definition.columns)
            {
                drops.push(Drop::Index {
                    table: table_name.clone(),
                    name: index.clone(),
                });
            }
        }
    }
    Ok(MigrationPlan { drops })
}

pub(crate) fn successor_refusal(
    store: &Store,
    current: &Schema,
    next: &Schema,
) -> Result<Option<SuccessorRefusal>, RuntimeError> {
    let migration = plan(store, current, next)?;
    if !migration.drops.is_empty() {
        return Ok(Some(SuccessorRefusal::destructive(migration)));
    }
    additive_refusal(&store.conn, current, next)
}

pub(crate) fn additive_refusal(
    connection: &Connection,
    current: &Schema,
    next: &Schema,
) -> Result<Option<SuccessorRefusal>, RuntimeError> {
    let rebuilt_targets = maintained_targets_requiring_rebuild(current, next);
    if let Some(refusal) = narrowing_refusal(connection, current, next)? {
        return Ok(Some(refusal));
    }
    for (table_name, current_table) in &current.tables {
        let Some(next_table) = next.tables.get(table_name) else {
            continue;
        };
        if rebuilt_targets.contains(table_name) {
            continue;
        }
        let absent_required = next_table.columns.iter().find(|(column, kind)| {
            current_table
                .columns
                .get(*column)
                .is_none_or(|current_kind| {
                    current_kind != *kind && !is_narrowing(current_kind, kind)
                })
                && !matches!(kind, ColumnType::Optional(_))
        });
        if let Some((column, _)) = absent_required {
            let rows: i64 = connection.query_row(
                "SELECT COUNT(*) FROM rows WHERE table_name = ?1",
                [table_name],
                |row| row.get(0),
            )?;
            if rows > 0 {
                return Ok(Some(SuccessorRefusal::required_column(table_name, column)));
            }
        }
    }

    if let Some(refusal) = validate_stored_rows(connection, current, next, &rebuilt_targets)? {
        return Ok(Some(refusal));
    }

    let mut conflicts = Vec::new();
    for (table_name, next_table) in &next.tables {
        let Some(current_table) = current.tables.get(table_name) else {
            continue;
        };
        if rebuilt_targets.contains(table_name) {
            continue;
        }
        let rows = fetch_rows(connection, table_name)?;
        for (index_name, index) in &next_table.indexes {
            let newly_unique = index.unique
                && !current_table
                    .indexes
                    .get(index_name)
                    .is_some_and(|old| old.unique && old.columns == index.columns);
            if !newly_unique {
                continue;
            }
            let mut counts = BTreeMap::<String, (Vec<Value>, usize)>::new();
            for row in &rows {
                let key = index
                    .columns
                    .iter()
                    .map(|column| row.field(column).cloned().unwrap_or(Value::Null))
                    .collect::<Vec<_>>();
                let encoded = canonical_json(&key);
                counts
                    .entry(encoded)
                    .and_modify(|(_, count)| *count += 1)
                    .or_insert((key, 1));
            }
            for (_, (key, count)) in counts {
                if count > 1 {
                    conflicts.push(UniqueConflict {
                        table: table_name.clone(),
                        index: index_name.clone(),
                        key,
                    });
                    if conflicts.len() == 10 {
                        return Ok(Some(SuccessorRefusal::unique(conflicts)));
                    }
                }
            }
        }
    }
    let mut future_targets = BTreeMap::<String, BTreeMap<String, Value>>::new();
    for target in rebuilt_targets {
        future_targets.insert(
            target.clone(),
            projected_target_rows(connection, next, &target)?,
        );
    }
    for (table_name, rows) in future_targets {
        let Some(table) = next.table(&table_name) else {
            // A destructive migration already removed an old maintained target
            // whose declaration is absent from the successor.
            continue;
        };
        for (index_name, index) in table.indexes.iter().filter(|(_, index)| index.unique) {
            let mut counts = BTreeMap::<String, (Vec<Value>, usize)>::new();
            for row in rows.values() {
                let key = index
                    .columns
                    .iter()
                    .map(|column| row.field(column).cloned().unwrap_or(Value::Null))
                    .collect::<Vec<_>>();
                counts
                    .entry(canonical_json(&key))
                    .and_modify(|(_, count)| *count += 1)
                    .or_insert((key, 1));
            }
            for (_, (key, count)) in counts {
                if count > 1 {
                    let conflict = UniqueConflict {
                        table: table_name.clone(),
                        index: index_name.clone(),
                        key,
                    };
                    if !conflicts.contains(&conflict) {
                        conflicts.push(conflict);
                    }
                    if conflicts.len() == 10 {
                        return Ok(Some(SuccessorRefusal::unique(conflicts)));
                    }
                }
            }
        }
    }
    Ok((!conflicts.is_empty()).then(|| SuccessorRefusal::unique(conflicts)))
}

pub(crate) fn validate_stored_rows(
    connection: &Connection,
    current: &Schema,
    next: &Schema,
    replaced_tables: &BTreeSet<String>,
) -> Result<Option<SuccessorRefusal>, RuntimeError> {
    for (table_name, next_table) in &next.tables {
        if replaced_tables.contains(table_name) {
            continue;
        }
        let current_table = current.tables.get(table_name);
        let columns = next_table
            .columns
            .iter()
            .filter(|(column, kind)| {
                match current_table.and_then(|table| table.columns.get(*column)) {
                    None => true,
                    Some(current_kind) => {
                        current_kind != *kind
                            && (contains_id_or_ref(kind) || is_narrowing(current_kind, kind))
                    }
                }
            })
            .collect::<Vec<_>>();
        if columns.is_empty() {
            continue;
        }
        let mut statement = connection
            .prepare("SELECT row_id, data FROM rows WHERE table_name = ?1 ORDER BY row_id")?;
        let rows = statement.query_map([table_name], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (row_id, data) = row?;
            let value = match serde_json::from_str::<Value>(&data) {
                Ok(value) => value,
                Err(error) => {
                    return Ok(Some(SuccessorRefusal::invalid_row(
                        table_name, &row_id, error,
                    )));
                }
            };
            let object = match value.as_object() {
                Ok(object) => object,
                Err(error) => {
                    return Ok(Some(SuccessorRefusal::invalid_row(
                        table_name, &row_id, error,
                    )));
                }
            };
            for (column, kind) in &columns {
                if let Err(error) =
                    validate_column_value(table_name, column, kind, object.get(*column))
                {
                    return Ok(Some(SuccessorRefusal::invalid_row(
                        table_name, &row_id, error,
                    )));
                }
            }
        }
    }
    Ok(None)
}

fn contains_id_or_ref(kind: &ColumnType) -> bool {
    match kind {
        ColumnType::Id | ColumnType::Ref { .. } => true,
        ColumnType::Optional(inner) | ColumnType::List { of: inner, .. } => {
            contains_id_or_ref(inner)
        }
        _ => false,
    }
}

pub(crate) fn apply_additive(
    transaction: &Transaction<'_>,
    current: &Schema,
    next: &Schema,
    from: String,
    to: String,
    predecessor_maintain_ids: Option<BTreeMap<String, BTreeSet<String>>>,
) -> Result<SuccessorReport, RuntimeError> {
    let mut report = SuccessorReport {
        from,
        to,
        ..SuccessorReport::default()
    };
    for table in next.tables.keys() {
        if !current.tables.contains_key(table) {
            report.added_tables.push(table.clone());
        }
    }
    for (table_name, next_table) in &next.tables {
        let Some(table) = current.tables.get(table_name) else {
            for index in next_table.indexes.keys() {
                report.added_indexes.push(format!("{table_name}.{index}"));
            }
            continue;
        };
        for column in next_table.columns.keys() {
            if !table.columns.contains_key(column) {
                report.added_columns.push(format!("{table_name}.{column}"));
            }
        }
        for (index, next_index) in &next_table.indexes {
            if table
                .indexes
                .get(index)
                .is_none_or(|old| old.columns != next_index.columns)
            {
                report.added_indexes.push(format!("{table_name}.{index}"));
            }
        }
    }
    let changed_maintains = changed_maintains(current, next);
    report.backfilled_maintains = changed_maintains.len() as u64;

    for table_name in next.tables.keys() {
        let needs_reindex = current.tables.get(table_name).is_some_and(|table| {
            next.tables[table_name].indexes.iter().any(|(name, index)| {
                table
                    .indexes
                    .get(name)
                    .is_none_or(|old| old.columns != index.columns)
            })
        });
        if needs_reindex {
            let rows = fetch_rows(transaction, table_name)?;
            for row in rows {
                reindex_row(transaction, next, table_name, &row)?;
            }
        }
    }
    let mut predecessor_maintain_ids = predecessor_maintain_ids
        .map(Ok)
        .unwrap_or_else(|| projected_predecessor_ids(transaction, current, next))?;
    for target in maintained_targets_requiring_rebuild(current, next) {
        rebuild_target(
            transaction,
            next,
            &target,
            predecessor_maintain_ids.remove(&target).unwrap_or_default(),
        )?;
    }
    Ok(report)
}

pub(crate) fn apply_migration_drops(
    transaction: &Transaction<'_>,
    current: &mut Schema,
    migration: &MigrationPlan,
    released_at: i64,
) -> Result<(), RuntimeError> {
    for drop in &migration.drops {
        match drop {
            Drop::Table { name, .. } => {
                // @ref LLP 1006#2a-one-asset-one-home-author-ruling-2026-09-01 — destructive successors release every affine cell they remove.
                crate::assets_ledger::release_table_assets(transaction, name, released_at)?;
                transaction.execute("DELETE FROM index_entries WHERE table_name = ?1", [name])?;
                transaction.execute("DELETE FROM rows WHERE table_name = ?1", [name])?;
            }
            Drop::Column { table, name }
            | Drop::TypeChange {
                table,
                column: name,
                ..
            } => {
                crate::assets_ledger::release_column_assets(transaction, table, name, released_at)?;
                drop_column_values(transaction, table, name)?;
                transaction.execute("DELETE FROM index_entries WHERE table_name = ?1", [table])?;
            }
            Drop::Index { table, name } => {
                transaction.execute(
                    "DELETE FROM index_entries WHERE table_name = ?1 AND index_name = ?2",
                    params![table, name],
                )?;
            }
        }
    }
    for drop in &migration.drops {
        match drop {
            Drop::Table { name, .. } => {
                current.tables.remove(name);
            }
            Drop::Column { table, name } => {
                if let Some(table) = current.tables.get_mut(table) {
                    table.columns.remove(name);
                    table.indexes.clear();
                }
            }
            Drop::Index { table, name } => {
                if let Some(table) = current.tables.get_mut(table) {
                    table.indexes.remove(name);
                }
            }
            Drop::TypeChange { table, .. } => {
                if let Some(table) = current.tables.get_mut(table) {
                    // Keep predecessor column types in the comparison schema.
                    // The values were dropped above, so successor admission
                    // must still see the retype and validate the resulting
                    // absence against the successor type.
                    table.indexes.clear();
                }
            }
        }
    }
    Ok(())
}

fn fetch_rows(connection: &Connection, table: &str) -> Result<Vec<Value>, RuntimeError> {
    let mut statement = connection.prepare("SELECT data FROM rows WHERE table_name = ?1")?;
    let rows = statement.query_map([table], |row| row.get::<_, String>(0))?;
    rows.map(|row| {
        serde_json::from_str(&row?).map_err(|error| RuntimeError::Serialization(error.to_string()))
    })
    .collect()
}

fn drop_column_values(
    transaction: &Transaction<'_>,
    table: &str,
    column: &str,
) -> Result<(), RuntimeError> {
    for mut row in fetch_rows(transaction, table)? {
        let id = row.field("id")?.as_str()?.to_owned();
        match &mut row {
            Value::Row(fields) | Value::Map(fields) => {
                fields.remove(column);
            }
            _ => continue,
        }
        transaction.execute(
            "UPDATE rows SET data = ?3 WHERE table_name = ?1 AND row_id = ?2",
            params![table, id, canonical_json(&row)],
        )?;
    }
    Ok(())
}

fn changed_maintains<'a>(current: &'a Schema, next: &'a Schema) -> Vec<&'a Maintain> {
    let mut unmatched_next = next.maintains.iter().collect::<Vec<_>>();
    let mut changed = Vec::new();
    for maintain in &current.maintains {
        if let Some(offset) = unmatched_next
            .iter()
            .position(|candidate| *candidate == maintain)
        {
            unmatched_next.remove(offset);
        } else {
            changed.push(maintain);
        }
    }
    changed.extend(unmatched_next);
    changed
}

// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — additions,
// removals, declaration multiplicity, and projection-relevant type changes
// rebuild every affected derived target retained by the successor.
fn maintained_targets_requiring_rebuild(current: &Schema, next: &Schema) -> BTreeSet<String> {
    let mut targets = changed_maintains(current, next)
        .into_iter()
        .map(|maintain| maintain.target.clone())
        .collect::<BTreeSet<_>>();

    for maintain in next
        .maintains
        .iter()
        .filter(|maintain| current.maintains.contains(maintain))
    {
        let source_fields = maintain.by.iter().chain(match &maintain.kind {
            MaintainKind::Count => None,
            MaintainKind::Sum { of } => Some(of),
        });
        let source_changed = source_fields.into_iter().any(|field| {
            current
                .table(&maintain.source)
                .and_then(|table| table.columns.get(field))
                != next
                    .table(&maintain.source)
                    .and_then(|table| table.columns.get(field))
        });
        let target_changed = ["id", "value"]
            .into_iter()
            .chain(maintain.by.iter().map(String::as_str))
            .any(|field| {
                current
                    .table(&maintain.target)
                    .and_then(|table| table.columns.get(field))
                    != next
                        .table(&maintain.target)
                        .and_then(|table| table.columns.get(field))
            });
        if source_changed || target_changed {
            targets.insert(maintain.target.clone());
        }
    }

    targets.retain(|target| next.tables.contains_key(target));
    targets
}

pub(crate) fn projected_predecessor_ids(
    connection: &Connection,
    current: &Schema,
    next: &Schema,
) -> Result<BTreeMap<String, BTreeSet<String>>, RuntimeError> {
    maintained_targets_requiring_rebuild(current, next)
        .into_iter()
        .map(|target| {
            let ids = projected_target_rows(connection, current, &target)?
                .into_keys()
                .collect();
            Ok((target, ids))
        })
        .collect()
}

fn rebuild_target(
    transaction: &Transaction<'_>,
    schema: &Schema,
    target: &str,
    mut owned_ids: BTreeSet<String>,
) -> Result<(), RuntimeError> {
    let rows = projected_target_rows(transaction, schema, target)?;
    owned_ids.extend(rows.keys().cloned());
    rebuild_owned_aggregate_target(
        transaction,
        schema,
        target,
        &owned_ids,
        rows.into_values().collect(),
    )
}

fn projected_target_rows(
    connection: &Connection,
    schema: &Schema,
    target: &str,
) -> Result<BTreeMap<String, Value>, RuntimeError> {
    let mut combined = BTreeMap::<String, Value>::new();
    for maintain in schema
        .maintains
        .iter()
        .filter(|maintain| maintain.target == target)
    {
        for row in projected_backfill_rows(connection, schema, maintain)? {
            let id = row.field("id")?.as_str()?.to_owned();
            if let Some(existing) = combined.get_mut(&id) {
                let total = existing.field("value")?.as_int()? as i128
                    + row.field("value")?.as_int()? as i128;
                if !(I53_MIN as i128..=I53_MAX as i128).contains(&total) {
                    return Err(RuntimeError::Constraint(format!(
                        "aggregate backfill overflow for {target}"
                    )));
                }
                match existing {
                    Value::Row(fields) | Value::Map(fields) => {
                        fields.insert("value".to_owned(), Value::Int(total as i64));
                    }
                    _ => {
                        return Err(RuntimeError::Schema(format!(
                            "aggregate backfill for {target} produced a non-row"
                        )));
                    }
                }
            } else {
                combined.insert(id, row);
            }
        }
    }
    Ok(combined)
}

fn projected_backfill_rows(
    connection: &Connection,
    schema: &Schema,
    maintain: &Maintain,
) -> Result<Vec<Value>, RuntimeError> {
    let source = schema
        .table(&maintain.source)
        .ok_or_else(|| RuntimeError::Schema(format!("missing table {}", maintain.source)))?;
    let mut groups = BTreeMap::<String, (Vec<Value>, i128)>::new();
    for mut row in fetch_rows(connection, &maintain.source)? {
        materialize_optional_fields(&mut row, source);
        let group = maintain
            .by
            .iter()
            .map(|field| row.field(field).cloned())
            .collect::<Result<Vec<_>, _>>()?;
        let id = canonical_json(&group);
        let amount = match &maintain.kind {
            MaintainKind::Count => 1_i128,
            MaintainKind::Sum { of } => row.field(of)?.as_int()? as i128,
        };
        groups
            .entry(id)
            .and_modify(|(_, value)| *value += amount)
            .or_insert((group, amount));
    }
    groups
        .into_iter()
        .map(|(id, (group, value))| {
            if !(I53_MIN as i128..=I53_MAX as i128).contains(&value) {
                return Err(RuntimeError::Constraint(format!(
                    "aggregate backfill overflow for {}",
                    maintain.target
                )));
            }
            let mut fields = BTreeMap::from([
                ("id".to_owned(), Value::Id(id.clone())),
                ("value".to_owned(), Value::Int(value as i64)),
            ]);
            for (name, value) in maintain.by.iter().zip(group) {
                fields.insert(name.clone(), value);
            }
            Ok(Value::Row(fields))
        })
        .collect()
}

#[path = "successor_narrowing.rs"]
mod narrowing;
pub use narrowing::NarrowingConflict;
use narrowing::{is_narrowing, narrowing_refusal};
