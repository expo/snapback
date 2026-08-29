//! Additive generation succession and explicit destructive migration plans.
// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — destructive changes need a plan.

use crate::engine::{RuntimeError, reindex_row, validate_row};
use crate::schema::{ColumnType, Maintain, MaintainKind, Schema};
use crate::store::Store;
use crate::value::{I53_MAX, I53_MIN, Value, canonical_json};
use rusqlite::{Transaction, params};
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

#[derive(Clone, Debug, PartialEq, Eq, Error, Serialize, Deserialize)]
#[error("{code}: destructive successor requires an explicit migration plan")]
#[serde(rename_all = "camelCase")]
pub struct SuccessorRefusal {
    pub code: String,
    pub plan: MigrationPlan,
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

pub(crate) fn apply_additive(
    store: &mut Store,
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

    let transaction = store.conn.transaction()?;
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
            let rows = fetch_rows(&transaction, table_name)?;
            for row in rows {
                reindex_row(&transaction, next, table_name, &row)?;
            }
        }
    }
    for maintain in &new_maintains {
        backfill(&transaction, next, maintain)?;
    }
    transaction.commit()?;
    Ok(report)
}

pub(crate) fn apply_migration_drops(
    store: &mut Store,
    current: &mut Schema,
    next: &Schema,
    migration: &MigrationPlan,
) -> Result<(), RuntimeError> {
    let expected = plan(store, current, next)?;
    if &expected != migration {
        return Err(RuntimeError::MigrationPlan(format!(
            "supplied plan does not match the current destructive delta: expected {:?}",
            expected.drops
        )));
    }
    let transaction = store.conn.transaction()?;
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
                drop_column_values(&transaction, table, name)?;
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
    transaction.commit()?;

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

fn fetch_rows(transaction: &Transaction<'_>, table: &str) -> Result<Vec<Value>, RuntimeError> {
    let mut statement = transaction.prepare("SELECT data FROM rows WHERE table_name = ?1")?;
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
    let mut groups = BTreeMap::<String, (Vec<Value>, i128)>::new();
    for row in fetch_rows(transaction, &maintain.source)? {
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
    for (id, (group, value)) in groups {
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
        let row = Value::Row(fields);
        validate_row(schema.table(&maintain.target), &maintain.target, &row)?;
        transaction.execute(
            "INSERT INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)
             ON CONFLICT(table_name, row_id) DO UPDATE SET data = excluded.data",
            params![maintain.target, id, canonical_json(&row)],
        )?;
        reindex_row(transaction, schema, &maintain.target, &row)?;
    }
    Ok(())
}
