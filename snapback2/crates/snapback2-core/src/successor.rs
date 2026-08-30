//! Additive generation succession and explicit destructive migration plans.
// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — destructive changes need a plan.

use crate::engine::{RuntimeError, reindex_row, write_aggregate_backfill};
use crate::schema::{ColumnType, Maintain, MaintainKind, Schema};
use crate::store::Store;
use crate::value::{I53_MAX, I53_MIN, Value, canonical_json};
use rusqlite::{Connection, Transaction, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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
}

impl SuccessorRefusal {
    pub(crate) fn destructive(plan: MigrationPlan) -> Self {
        Self {
            code: "E_SUCCESSOR_DESTRUCTIVE".to_owned(),
            message: "destructive successor requires an explicit migration plan".to_owned(),
            rewrite: "apply exactly the returned migration plan".to_owned(),
            plan,
            conflicts: Vec::new(),
        }
    }

    pub(crate) fn store(error: &RuntimeError) -> Self {
        Self {
            code: "E_SUCCESSOR_STORE".to_owned(),
            message: error.to_string(),
            rewrite: "repair the store error and retry the successor".to_owned(),
            plan: MigrationPlan::default(),
            conflicts: Vec::new(),
        }
    }

    fn required_column(table: &str, column: &str) -> Self {
        Self {
            code: "E_SUCCESSOR_COLUMN_REQUIRED".to_owned(),
            message: format!(
                "successor adds required column {table}.{column} to a table that has rows"
            ),
            rewrite: format!(
                "wrap {table}.{column} in t.optional(...) or add it to an empty table"
            ),
            plan: MigrationPlan::default(),
            conflicts: Vec::new(),
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
                Some(next_type) if next_type != column_type => drops.push(Drop::TypeChange {
                    table: table_name.clone(),
                    column: column.clone(),
                    from: column_type.clone(),
                    to: next_type.clone(),
                }),
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
    for (table_name, current_table) in &current.tables {
        let Some(next_table) = next.tables.get(table_name) else {
            continue;
        };
        let added_required = next_table.columns.iter().find(|(column, kind)| {
            !current_table.columns.contains_key(*column) && !matches!(kind, ColumnType::Optional(_))
        });
        if let Some((column, _)) = added_required {
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

    let mut conflicts = Vec::new();
    for (table_name, next_table) in &next.tables {
        let Some(current_table) = current.tables.get(table_name) else {
            continue;
        };
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
    let new_maintains: Vec<_> = next
        .maintains
        .iter()
        .filter(|maintain| !current.maintains.contains(maintain))
        .collect();
    let mut future_targets = BTreeMap::<String, BTreeMap<String, Value>>::new();
    for maintain in new_maintains {
        let rows = if let Some(rows) = future_targets.get_mut(&maintain.target) {
            rows
        } else {
            let existing = fetch_rows(connection, &maintain.target)?
                .into_iter()
                .map(|row| {
                    let id = row.field("id")?.as_str()?.to_owned();
                    Ok((id, row))
                })
                .collect::<Result<BTreeMap<_, _>, RuntimeError>>()?;
            future_targets.insert(maintain.target.clone(), existing);
            future_targets
                .get_mut(&maintain.target)
                .expect("target was just inserted")
        };
        for row in projected_backfill_rows(connection, maintain)? {
            let id = row.field("id")?.as_str()?.to_owned();
            rows.insert(id, row);
        }
    }
    for (table_name, rows) in future_targets {
        let table = next
            .table(&table_name)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
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

pub(crate) fn apply_additive(
    transaction: &Transaction<'_>,
    current: &Schema,
    next: &Schema,
    from: String,
    to: String,
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
    let new_maintains: Vec<_> = next
        .maintains
        .iter()
        .filter(|maintain| !current.maintains.contains(maintain))
        .cloned()
        .collect();
    report.backfilled_maintains = new_maintains.len() as u64;

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
    for maintain in &new_maintains {
        backfill(transaction, next, maintain)?;
    }
    Ok(report)
}

pub(crate) fn apply_migration_drops(
    transaction: &Transaction<'_>,
    current: &mut Schema,
    migration: &MigrationPlan,
) -> Result<(), RuntimeError> {
    for drop in &migration.drops {
        match drop {
            Drop::Table { name, .. } => {
                transaction.execute("DELETE FROM index_entries WHERE table_name = ?1", [name])?;
                transaction.execute("DELETE FROM rows WHERE table_name = ?1", [name])?;
            }
            Drop::Column { table, name }
            | Drop::TypeChange {
                table,
                column: name,
                ..
            } => {
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
            Drop::TypeChange {
                table, column, to, ..
            } => {
                if let Some(table) = current.tables.get_mut(table) {
                    table.columns.insert(column.clone(), to.clone());
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

fn backfill(
    transaction: &Transaction<'_>,
    schema: &Schema,
    maintain: &Maintain,
) -> Result<(), RuntimeError> {
    let rows = projected_backfill_rows(transaction, maintain)?;
    write_aggregate_backfill(transaction, schema, &maintain.target, rows)
}

fn projected_backfill_rows(
    connection: &Connection,
    maintain: &Maintain,
) -> Result<Vec<Value>, RuntimeError> {
    let mut groups = BTreeMap::<String, (Vec<Value>, i128)>::new();
    for row in fetch_rows(connection, &maintain.source)? {
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
