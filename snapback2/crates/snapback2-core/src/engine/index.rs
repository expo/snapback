#![allow(unused_imports)]
//! SQLite-backed index maintenance and row helpers.
use super::*;
use crate::certificate::Certificate;
use crate::ir::*;
use crate::schema::*;
use crate::value::{I53_MAX, I53_MIN, Value, ValueError, canonical_json, digest, object};
use rusqlite::{Connection, OptionalExtension, Transaction, params, params_from_iter};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use thiserror::Error;

#[derive(Clone)]
pub(super) struct EvaluatedRange {
    pub(super) gt: Option<Value>,
    pub(super) gte: Option<Value>,
    pub(super) lt: Option<Value>,
    pub(super) lte: Option<Value>,
}

pub(crate) fn fetch_table_connection(
    connection: &Connection,
    table: &str,
) -> Result<Vec<Value>, RuntimeError> {
    let mut statement = connection.prepare("SELECT data FROM rows WHERE table_name = ?1")?;
    let rows = statement.query_map([table], |row| row.get::<_, String>(0))?;
    rows.map(|row| {
        let row = row?;
        serde_json::from_str(&row).map_err(|error| RuntimeError::Schema(error.to_string()))
    })
    .collect()
}

pub(crate) fn reindex_row(
    connection: &Connection,
    schema: &Schema,
    table_name: &str,
    row: &Value,
) -> Result<(), RuntimeError> {
    let table = schema
        .table(table_name)
        .ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
    let id = row.field("id")?.as_str()?;
    delete_index_row(connection, table_name, id)?;
    for (index_name, index) in &table.indexes {
        if index.columns.len() > 8 {
            return Err(RuntimeError::Schema(format!(
                "index {table_name}.{index_name} has more than 8 columns in S1"
            )));
        }
        let encoded = index_values(row, index)
            .iter()
            .map(encode_index_value)
            .collect::<Result<Vec<_>, _>>()?;
        let mut values: Vec<Option<String>> = encoded.into_iter().map(Some).collect();
        values.resize(8, None);
        connection.execute(
            "INSERT INTO index_entries(
                table_name, index_name, row_id, c0, c1, c2, c3, c4, c5, c6, c7
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                table_name, index_name, id, values[0], values[1], values[2], values[3], values[4],
                values[5], values[6], values[7]
            ],
        )?;
    }
    Ok(())
}

pub(super) fn delete_index_row(
    connection: &Connection,
    table_name: &str,
    id: &str,
) -> Result<(), RuntimeError> {
    connection.execute(
        "DELETE FROM index_entries WHERE table_name = ?1 AND row_id = ?2",
        params![table_name, id],
    )?;
    Ok(())
}

pub(super) fn lookup_indexed(
    connection: &Connection,
    table_name: &str,
    index_name: &str,
    index: &Index,
    key: &[Value],
) -> Result<Option<Value>, RuntimeError> {
    if key.len() != index.columns.len() {
        return Err(RuntimeError::Schema(format!(
            "point read {table_name}.{index_name} supplied {} of {} key columns",
            key.len(),
            index.columns.len()
        )));
    }
    let mut parameters = vec![table_name.to_owned(), index_name.to_owned()];
    let mut predicates = Vec::new();
    for (offset, value) in key.iter().enumerate() {
        parameters.push(encode_index_value(value)?);
        predicates.push(format!("ie.c{offset} = ?{}", parameters.len()));
    }
    let sql = format!(
        "SELECT r.data
         FROM index_entries ie
         JOIN rows r ON r.table_name = ie.table_name AND r.row_id = ie.row_id
         WHERE ie.table_name = ?1 AND ie.index_name = ?2 AND {}
         LIMIT 1",
        predicates.join(" AND ")
    );
    let data: Option<String> = connection
        .query_row(&sql, params_from_iter(parameters.iter()), |row| row.get(0))
        .optional()?;
    data.map(|data| {
        serde_json::from_str(&data).map_err(|error| RuntimeError::Schema(error.to_string()))
    })
    .transpose()
}

#[allow(clippy::too_many_arguments)]
pub(super) fn scan_indexed(
    connection: &Connection,
    table_name: &str,
    index_name: &str,
    index: &Index,
    prefix: &[Value],
    after: Option<&Value>,
    before: Option<&Value>,
    range: Option<&EvaluatedRange>,
    order: Order,
    limit: usize,
) -> Result<Vec<Value>, RuntimeError> {
    if prefix.len() > index.columns.len() {
        return Err(RuntimeError::Schema(format!(
            "scan {table_name}.{index_name} prefix has too many columns"
        )));
    }
    let mut parameters = vec![table_name.to_owned(), index_name.to_owned()];
    let mut predicates = Vec::new();
    let mut push_bound =
        |column: usize, operator: &str, value: &Value| -> Result<(), RuntimeError> {
            parameters.push(encode_index_value(value)?);
            predicates.push(format!("ie.c{column} {operator} ?{}", parameters.len()));
            Ok(())
        };
    for (offset, value) in prefix.iter().enumerate() {
        push_bound(offset, "=", value)?;
    }
    let range_column = prefix.len();
    if range_column < index.columns.len() {
        if let Some(value) = after {
            push_bound(range_column, ">", value)?;
        }
        if let Some(value) = before {
            push_bound(range_column, "<", value)?;
        }
        if let Some(range) = range {
            if let Some(value) = &range.gt {
                push_bound(range_column, ">", value)?;
            }
            if let Some(value) = &range.gte {
                push_bound(range_column, ">=", value)?;
            }
            if let Some(value) = &range.lt {
                push_bound(range_column, "<", value)?;
            }
            if let Some(value) = &range.lte {
                push_bound(range_column, "<=", value)?;
            }
        }
    }
    let direction = if order == Order::Asc { "ASC" } else { "DESC" };
    let ordering = (0..index.columns.len())
        .map(|offset| format!("ie.c{offset} {direction}"))
        .chain(std::iter::once(format!("ie.row_id {direction}")))
        .collect::<Vec<_>>()
        .join(", ");
    let suffix = if predicates.is_empty() {
        String::new()
    } else {
        format!(" AND {}", predicates.join(" AND "))
    };
    let sql = format!(
        "SELECT r.data
         FROM index_entries ie
         JOIN rows r ON r.table_name = ie.table_name AND r.row_id = ie.row_id
         WHERE ie.table_name = ?1 AND ie.index_name = ?2{suffix}
         ORDER BY {ordering}
         LIMIT {limit}"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(parameters.iter()), |row| {
        row.get::<_, String>(0)
    })?;
    rows.map(|row| {
        let row = row?;
        serde_json::from_str(&row).map_err(|error| RuntimeError::Schema(error.to_string()))
    })
    .collect()
}

pub(super) fn encode_index_value(value: &Value) -> Result<String, RuntimeError> {
    let encoded = match value {
        Value::Null => "0".to_owned(),
        Value::Bool(value) => format!("1:{}", u8::from(*value)),
        Value::Int(value) => {
            let shifted = *value as i128 - I53_MIN as i128;
            format!("2:{shifted:020}")
        }
        Value::String(value) => format!("3:{}", hex(value.as_bytes())),
        Value::Id(value) => format!("4:{}", hex(value.as_bytes())),
        other => {
            return Err(RuntimeError::Schema(format!(
                "{} is not an indexable scalar",
                other.kind()
            )));
        }
    };
    Ok(encoded)
}

pub(super) fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(DIGITS[(byte >> 4) as usize] as char);
        encoded.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    encoded
}

pub(crate) fn index_values(row: &Value, index: &Index) -> Vec<Value> {
    index
        .columns
        .iter()
        .map(|column| row.field(column).cloned().unwrap_or(Value::Null))
        .collect()
}

pub(crate) fn materialize_optional_fields(row: &mut Value, table: &Table) {
    let fields = match row {
        Value::Row(fields) | Value::Map(fields) => fields,
        _ => return,
    };
    for (name, kind) in &table.columns {
        if matches!(kind, ColumnType::Optional(_)) {
            fields.entry(name.clone()).or_insert(Value::Null);
        }
    }
}

pub(super) fn row_ids(rows: &[Value]) -> Result<Vec<String>, RuntimeError> {
    rows.iter()
        .map(|row| {
            row.field("id")?
                .as_str()
                .map(ToOwned::to_owned)
                .map_err(Into::into)
        })
        .collect()
}

pub(crate) fn validate_row(
    table: Option<&Table>,
    table_name: &str,
    row: &Value,
) -> Result<(), RuntimeError> {
    let table = table.ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
    let object = row.as_object()?;
    if !object.contains_key("id") {
        return Err(RuntimeError::Schema(format!("{table_name} row lacks id")));
    }
    for (name, kind) in &table.columns {
        if !valid_column_value(kind, object.get(name)) {
            return Err(RuntimeError::Input(format!(
                "{table_name}.{name} violates {kind:?}"
            )));
        }
    }
    Ok(())
}

fn valid_column_value(kind: &ColumnType, value: Option<&Value>) -> bool {
    match (kind, value) {
        (ColumnType::Optional(_), None | Some(Value::Null)) => true,
        (ColumnType::Optional(inner), Some(value)) => valid_column_value(inner, Some(value)),
        (ColumnType::List { of, max }, Some(Value::Array(values))) => {
            values.len() <= *max as usize
                && values
                    .iter()
                    .all(|value| valid_column_value(of, Some(value)))
        }
        (ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. }, Some(Value::Id(_))) => {
            true
        }
        (ColumnType::Text { max }, Some(Value::String(text))) => {
            text.chars().count() <= *max as usize
        }
        (ColumnType::Enum { variants }, Some(Value::String(value))) => variants.contains(value),
        (
            ColumnType::Int
            | ColumnType::Time
            | ColumnType::Decimal { .. }
            | ColumnType::Money { .. },
            Some(Value::Int(value)),
        ) => (I53_MIN..=I53_MAX).contains(value),
        (ColumnType::Bool, Some(Value::Bool(_))) => true,
        (ColumnType::Json { max_bytes }, Some(value)) => {
            canonical_json(value).len() <= *max_bytes as usize
        }
        _ => false,
    }
}
