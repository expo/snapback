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

#[derive(Clone, PartialEq, Eq)]
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
    table: &Table,
    index: &Index,
    prefix: &[Value],
    after: Option<&Value>,
    before: Option<&Value>,
    range: Option<&EvaluatedRange>,
    order: Order,
    limit: usize,
) -> Result<Vec<Value>, RuntimeError> {
    let mut statement = prepare_scan_indexed(
        connection, table_name, index_name, table, index, prefix, after, before, range, order,
        limit,
    )?;
    let mut rows = statement.raw_query();
    let mut values = Vec::new();
    while let Some(row) = rows.next()? {
        let data: String = row.get(0)?;
        values.push(
            serde_json::from_str(&data).map_err(|error| RuntimeError::Schema(error.to_string()))?,
        );
    }
    Ok(values)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn prepare_scan_indexed<'a>(
    connection: &'a Connection,
    table_name: &str,
    index_name: &str,
    table: &Table,
    index: &Index,
    prefix: &[Value],
    after: Option<&Value>,
    before: Option<&Value>,
    range: Option<&EvaluatedRange>,
    order: Order,
    limit: usize,
) -> Result<rusqlite::Statement<'a>, RuntimeError> {
    let (sql, parameters) = scan_query(
        table_name, index_name, table, index, prefix, after, before, range, order, limit,
        None, intrinsic_id_order(table, index),
    )?;
    let mut statement = connection.prepare(&sql)?;
    bind_scan(&mut statement, &parameters)?;
    Ok(statement)
}

// @ref LLP 1001#1-store-storers — validated intrinsic ids equal storage addresses;
// a full index key ending in that id is a total order without a row_id tie term.
// Other indexes keep the original SQL, even if another proof could suffice.
pub(super) fn intrinsic_id_order(table: &Table, index: &Index) -> bool {
    index.columns.last().is_some_and(|column| column == "id")
        && table.columns.get("id") == Some(&ColumnType::Id)
}

// Initial heads with the same bounds differ only in their equality prefix.
// Share one query template across the merge's statically identical scan shapes.
// Runtime-varying bounds fall back to the ordinary seek, as do all refills.
pub(super) struct InitialSeek {
    sql: String,
    parameters: Vec<String>,
    prefix_width: usize,
    after: Option<Value>,
    before: Option<Value>,
    range: Option<EvaluatedRange>,
}

impl InitialSeek {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn new(
        table_name: &str, index_name: &str, table: &Table, index: &Index,
        prefix: &[Value], after: Option<&Value>, before: Option<&Value>,
        range: Option<&EvaluatedRange>, order: Order, reserve: u64,
    ) -> Result<Option<Box<Self>>, RuntimeError> {
        let (sql, mut parameters) = scan_query(
            table_name, index_name, table, index, prefix, after, before, range,
            order, 1, None, true,
        )?;
        // These encodings are rebound for every stream. Retaining them would
        // charge a second, unused copy of arbitrarily wide equality keys.
        parameters.drain(2..2 + prefix.len());
        // Inspect borrowed bounds before cloning: a refused wide template must
        // not allocate typed copies merely to discover it cannot retain them.
        if !Self::retained_parts(&sql, &parameters, after, before, range)
            .is_some_and(|bytes| bytes <= reserve)
        {
            return Ok(None);
        }
        let initial = Self { sql, parameters, prefix_width: prefix.len(),
            after: after.cloned(), before: before.cloned(), range: range.cloned() };
        Ok(initial.retained_bytes().is_some_and(|bytes| bytes <= reserve)
            .then(|| Box::new(initial)))
    }

    pub(super) fn retained_bytes(&self) -> Option<u64> {
        Self::retained_parts(&self.sql, &self.parameters, self.after.as_ref(),
            self.before.as_ref(), self.range.as_ref())
    }

    fn retained_parts(sql: &String, parameters: &Vec<String>, after: Option<&Value>,
        before: Option<&Value>, range: Option<&EvaluatedRange>) -> Option<u64>
    {
        // Include the sole optional box, its inline fields, all allocation
        // capacities (not lengths), names and both encoded and typed bounds.
        // Rejected templates die before the next lane; no authored-count vector.
        let mut bytes = (std::mem::size_of::<Option<Box<Self>>>() + std::mem::size_of::<Self>()) as u64;
        bytes = bytes.checked_add(sql.capacity() as u64)?;
        bytes = bytes.checked_add(parameters.capacity().checked_mul(std::mem::size_of::<String>())? as u64)?;
        for parameter in parameters {
            bytes = bytes.checked_add(parameter.capacity() as u64)?;
        }
        for value in [after, before,
            range.and_then(|r| r.gt.as_ref()), range.and_then(|r| r.gte.as_ref()),
            range.and_then(|r| r.lt.as_ref()), range.and_then(|r| r.lte.as_ref())]
            .into_iter().flatten()
        {
            bytes = bytes.checked_add(bound_capacity(value)?)?;
        }
        Some(bytes)
    }

    pub(super) fn matches(
        &self, prefix: &[Value], after: Option<&Value>, before: Option<&Value>,
        range: Option<&EvaluatedRange>,
    ) -> bool {
        self.prefix_width == prefix.len() && self.after.as_ref() == after
            && self.before.as_ref() == before && self.range.as_ref() == range
    }

    pub(super) fn seek(
        &self, connection: &Connection, prefix: &[Value],
    ) -> Result<Option<Value>, RuntimeError> {
        let mut statement = connection.prepare_cached(&self.sql)?;
        for (offset, value) in self.parameters.iter().enumerate() {
            let position = offset + 1 + if offset < 2 { 0 } else { self.prefix_width };
            statement.raw_bind_parameter(position, value)?;
        }
        for (offset, value) in prefix.iter().enumerate() {
            statement.raw_bind_parameter(offset + 3, encode_index_value(value)?)?;
        }
        let mut rows = statement.raw_query();
        rows.next()?.map(|row| {
            let data: String = row.get(0)?;
            serde_json::from_str(&data).map_err(|error| RuntimeError::Schema(error.to_string()))
        }).transpose()
    }
}

fn bound_capacity(value: &Value) -> Option<u64> {
    match value {
        Value::Null | Value::Bool(_) | Value::Int(_) => Some(0),
        Value::String(value) | Value::Id(value) => Some(value.capacity() as u64),
        Value::Bytes(value) => Some(value.capacity() as u64),
        Value::Array(values) => values.iter().try_fold(
            values.capacity().checked_mul(std::mem::size_of::<Value>())? as u64,
            |bytes, value| bytes.checked_add(bound_capacity(value)?),
        ),
        // Index bounds are scalars or scalar tuples. If that domain ever grows,
        // keep ordinary seek until its retained representation is priced here.
        Value::Row(_) | Value::Map(_) => None,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn seek_scan_indexed(
    connection: &Connection,
    table_name: &str,
    index_name: &str,
    table: &Table,
    index: &Index,
    prefix: &[Value],
    after: Option<&Value>,
    before: Option<&Value>,
    range: Option<&EvaluatedRange>,
    order: Order,
    last_examined: Option<&[Value]>,
) -> Result<Option<Value>, RuntimeError> {
    let (sql, parameters) = scan_query(
        table_name, index_name, table, index, prefix, after, before, range, order, 1,
        last_examined, true,
    )?;
    // The connection's bounded statement cache keys SQL shapes, never actor
    // values. Drop Rows and return the statement before another lane seeks.
    let mut statement = connection.prepare_cached(&sql)?;
    bind_scan(&mut statement, &parameters)?;
    let mut rows = statement.raw_query();
    rows.next()?.map(|row| {
        let data: String = row.get(0)?;
        serde_json::from_str(&data).map_err(|error| RuntimeError::Schema(error.to_string()))
    }).transpose()
}

fn bind_scan(statement: &mut rusqlite::Statement<'_>, parameters: &[String]) -> Result<(), RuntimeError> {
    for (i, value) in parameters.iter().enumerate() {
        statement.raw_bind_parameter(i + 1, value)?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn scan_query(
    table_name: &str,
    index_name: &str,
    table: &Table,
    index: &Index,
    prefix: &[Value],
    after: Option<&Value>,
    before: Option<&Value>,
    range: Option<&EvaluatedRange>,
    order: Order,
    limit: usize,
    last_examined: Option<&[Value]>,
    intrinsic_order: bool,
) -> Result<(String, Vec<String>), RuntimeError> {
    if prefix.len() > index.columns.len() {
        return Err(RuntimeError::Schema(format!(
            "scan {table_name}.{index_name} prefix has too many columns"
        )));
    }
    // @ref LLP 1001#3-read-and-write-states-no-silent-states — a cursor must
    // move a scan; a fully named index has no post-prefix position to compare.
    if prefix.len() == index.columns.len() && (after.is_some() || before.is_some()) {
        return Err(RuntimeError::Schema(format!(
            "scan {table_name}.{index_name} prefix names every index column, so a cursor has no position to compare; remove after/before or shorten the prefix"
        )));
    }
    let mut parameters = vec![table_name.to_owned(), index_name.to_owned()];
    let mut predicates = Vec::new();
    for (offset, value) in prefix.iter().enumerate() {
        push_index_bound(&mut parameters, &mut predicates, offset, "=", value)?;
    }
    let range_column = prefix.len();
    if range_column < index.columns.len() {
        if let Some(value) = after {
            push_cursor_bound(
                &mut parameters,
                &mut predicates,
                range_column,
                if order == Order::Asc { ">" } else { "<" },
                value,
                table_name,
                index_name,
                table,
                index,
            )?;
        }
        if let Some(value) = before {
            push_cursor_bound(
                &mut parameters,
                &mut predicates,
                range_column,
                if order == Order::Asc { "<" } else { ">" },
                value,
                table_name,
                index_name,
                table,
                index,
            )?;
        }
        if let Some(range) = range {
            if let Some(value) = &range.gt {
                push_index_bound(&mut parameters, &mut predicates, range_column, ">", value)?;
            }
            if let Some(value) = &range.gte {
                push_index_bound(&mut parameters, &mut predicates, range_column, ">=", value)?;
            }
            if let Some(value) = &range.lt {
                push_index_bound(&mut parameters, &mut predicates, range_column, "<", value)?;
            }
            if let Some(value) = &range.lte {
                push_index_bound(&mut parameters, &mut predicates, range_column, "<=", value)?;
            }
        }
    }
    if let Some(key) = last_examined {
        // This extra bound intersects (never replaces) all original bounds.
        // Equality-prefix + the entire index key includes the intrinsic id.
        push_cursor_bound(&mut parameters, &mut predicates, 0,
            if order == Order::Asc { ">" } else { "<" },
            &Value::Array(key.to_vec()), table_name, index_name, table, index)?;
    }
    let direction = if order == Order::Asc { "ASC" } else { "DESC" };
    let ordering = (0..index.columns.len())
        .map(|offset| format!("ie.c{offset} {direction}"))
        .chain((!intrinsic_order || !intrinsic_id_order(table, index))
            .then(|| format!("ie.row_id {direction}")))
        .collect::<Vec<_>>()
        .join(", ");
    let suffix = if predicates.is_empty() {
        String::new()
    } else {
        format!(" AND {}", predicates.join(" AND "))
    };
    // Store planner pin, not a job rule: every `scan_indexed` query seeks `index_entries_lookup`,
    // uniqueness probes and page reads alike. SQLite can otherwise choose the row-cleanup index
    // to satisfy row_id ordering and scan the whole table per write; the J1b 100,000-row fill
    // measured that cost, and the corpus is unchanged under the pin.
    // @ref LLP 1016#implementation-record--j1b — a store planner pin justified by the J1b measurement, applying to every exact-prefix ordered probe.
    let sql = format!(
        "SELECT r.data
         FROM index_entries ie INDEXED BY index_entries_lookup
         JOIN rows r ON r.table_name = ie.table_name AND r.row_id = ie.row_id
         WHERE ie.table_name = ?1 AND ie.index_name = ?2{suffix}
         ORDER BY {ordering}
         LIMIT {limit}"
    );
    Ok((sql, parameters))
}

fn push_index_bound(
    parameters: &mut Vec<String>,
    predicates: &mut Vec<String>,
    column: usize,
    operator: &str,
    value: &Value,
) -> Result<(), RuntimeError> {
    parameters.push(encode_index_value(value)?);
    predicates.push(format!("ie.c{column} {operator} ?{}", parameters.len()));
    Ok(())
}

fn push_cursor_bound(
    parameters: &mut Vec<String>,
    predicates: &mut Vec<String>,
    first_column: usize,
    operator: &str,
    cursor: &Value,
    table_name: &str,
    index_name: &str,
    table: &Table,
    index: &Index,
) -> Result<(), RuntimeError> {
    let column_count = index.columns.len();
    let remaining = column_count - first_column;
    let values = match cursor {
        Value::Array(values) => values.as_slice(),
        value if remaining == 1 => std::slice::from_ref(value),
        value => {
            return Err(RuntimeError::Schema(format!(
                "cursor for {remaining} remaining index columns must be an array, got {}",
                value.kind()
            )));
        }
    };
    if values.len() != remaining {
        return Err(RuntimeError::Schema(format!(
            "cursor supplied {} of {remaining} remaining index columns",
            values.len()
        )));
    }
    let columns = (first_column..column_count)
        .map(|column| format!("ie.c{column}"))
        .collect::<Vec<_>>()
        .join(", ");
    let mut placeholders = Vec::with_capacity(values.len());
    for (offset, value) in values.iter().enumerate() {
        let encoded = encode_index_value(value)?;
        let column = &index.columns[first_column + offset];
        let expected = table.columns.get(column).ok_or_else(|| {
            RuntimeError::Schema(format!(
                "index {table_name}.{index_name} names missing column {column}"
            ))
        })?;
        if !cursor_value_matches_column(value, expected) {
            return Err(RuntimeError::Schema(format!(
                "cursor component for {table_name}.{index_name} column {column} must be {}, got {}",
                cursor_column_kind(expected),
                value.kind()
            )));
        }
        parameters.push(encoded);
        placeholders.push(format!("?{}", parameters.len()));
    }
    predicates.push(format!(
        "({columns}) {operator} ({})",
        placeholders.join(", ")
    ));
    Ok(())
}

fn cursor_value_matches_column(value: &Value, column: &ColumnType) -> bool {
    // @ref LLP 1001#3-read-and-write-states-no-silent-states — Null is the
    // universal pre-first cursor sentinel, independent of stored nullability.
    if matches!(value, Value::Null) {
        return true;
    }
    match column {
        ColumnType::Optional(inner) => cursor_value_matches_column(value, inner),
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => {
            matches!(value, Value::Id(_))
        }
        ColumnType::Text { .. } | ColumnType::Enum { .. } => {
            matches!(value, Value::String(_))
        }
        ColumnType::Int
        | ColumnType::Time
        | ColumnType::Decimal { .. }
        | ColumnType::Money { .. } => matches!(value, Value::Int(_)),
        ColumnType::Bool => matches!(value, Value::Bool(_)),
        ColumnType::Bytes { .. } => matches!(value, Value::Bytes(_)),
        ColumnType::Image { .. } | ColumnType::Video { .. } => false,
        ColumnType::Json { .. } => matches!(
            value,
            Value::Bool(_) | Value::Int(_) | Value::String(_) | Value::Id(_) | Value::Bytes(_)
        ),
        ColumnType::List { .. } => false,
    }
}

fn cursor_column_kind(column: &ColumnType) -> &'static str {
    match column {
        ColumnType::Optional(inner) => cursor_column_kind(inner),
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => "Id",
        ColumnType::Text { .. } | ColumnType::Enum { .. } => "String",
        ColumnType::Int
        | ColumnType::Time
        | ColumnType::Decimal { .. }
        | ColumnType::Money { .. } => "Int",
        ColumnType::Bool => "Bool",
        ColumnType::Bytes { .. } => "Bytes",
        ColumnType::Image { .. } | ColumnType::Video { .. } => "a non-asset scalar",
        ColumnType::Json { .. } | ColumnType::List { .. } => "an indexable scalar",
    }
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
        // Each tuple component occupies its own SQLite column. The scalar tag
        // plus order-preserving hex therefore needs no inter-component delimiter.
        Value::Bytes(value) => format!("5:{}", hex(value)),
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
    if let Some(name) = object
        .keys()
        .find(|name| !table.columns.contains_key(*name))
    {
        return Err(RuntimeError::Input(format!(
            "{table_name} row contains undeclared field {name}"
        )));
    }
    if object
        .get("id")
        .is_some_and(value_contains_reserved_principal)
    {
        return Err(RuntimeError::Input(format!(
            "{table_name}.id cannot carry the reserved system principal"
        )));
    }
    for (name, kind) in &table.columns {
        validate_column_value(table_name, name, kind, object.get(name))?;
    }
    Ok(())
}

pub(crate) fn validate_column_value(
    table_name: &str,
    name: &str,
    kind: &ColumnType,
    value: Option<&Value>,
) -> Result<(), RuntimeError> {
    // @ref LLP 1001#6-identity-identityrs — authored data cannot forge
    // the engine-private system actor through any nested value, including
    // generic JSON that can later be projected into an actor-bearing slot.
    if value.is_some_and(value_contains_reserved_principal) {
        return Err(RuntimeError::Input(format!(
            "{table_name}.{name} cannot carry the reserved system principal"
        )));
    }
    if let Some(code_point) = disallowed_column_text_control_code_point(kind, value) {
        return Err(RuntimeError::Input(format!(
            "{table_name}.{name} contains disallowed control character U+{code_point:04X}"
        )));
    }
    if kind.contains_asset() {
        crate::assets::column_asset_uses(kind, value, &format!("{table_name}.{name}"))?;
        return Ok(());
    }
    if !valid_column_value(kind, value) {
        return Err(RuntimeError::Input(format!(
            "{table_name}.{name} violates {kind:?}"
        )));
    }
    Ok(())
}

fn disallowed_column_text_control_code_point(
    kind: &ColumnType,
    value: Option<&Value>,
) -> Option<u32> {
    match (kind, value) {
        (ColumnType::Optional(inner), Some(value)) => {
            disallowed_column_text_control_code_point(inner, Some(value))
        }
        (ColumnType::List { of, .. }, Some(Value::Array(values))) => values
            .iter()
            .find_map(|value| disallowed_column_text_control_code_point(of, Some(value))),
        (ColumnType::Text { .. }, Some(Value::String(text))) => {
            disallowed_text_control_code_point(text)
        }
        _ => None,
    }
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
        (ColumnType::Bytes { max }, Some(Value::Bytes(bytes))) => bytes.len() <= *max as usize,
        // Asset-bearing descriptors are handled above so their typed refusal
        // is not collapsed into the generic E_INPUT family code.
        (ColumnType::Image { .. } | ColumnType::Video { .. }, _) => false,
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

// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — writes and successor
// admission share the same text minimum/format checks on retained values.
pub(crate) fn validate_text_constraint(
    table_name: &str,
    field: &str,
    min: u32,
    format: Option<TextFormat>,
    value: Option<&Value>,
) -> Result<(), RuntimeError> {
    if let Some(value) = value.filter(|value| !matches!(value, Value::Null)) {
        let text = value.as_str()?;
        if text.chars().count() < min as usize {
            return Err(RuntimeError::Constraint(format!(
                "{table_name}.{field} must contain at least {min} characters"
            )));
        }
        let valid = match format {
            None => true,
            Some(TextFormat::Handle) => text
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'),
            Some(TextFormat::Url) => {
                let rest = text
                    .strip_prefix("https://")
                    .or_else(|| text.strip_prefix("http://"));
                rest.is_some_and(|rest| {
                    !rest.is_empty()
                        && rest
                            .chars()
                            .all(|character| !character.is_whitespace() && !character.is_control())
                })
            }
        };
        if !valid {
            let expected = match format {
                Some(TextFormat::Handle) => "lowercase a-z, digits, and underscore only",
                Some(TextFormat::Url) => "one absolute http:// or https:// URL without whitespace",
                None => unreachable!(),
            };
            return Err(RuntimeError::Constraint(format!(
                "{table_name}.{field} must use {expected}"
            )));
        }
    }
    Ok(())
}
