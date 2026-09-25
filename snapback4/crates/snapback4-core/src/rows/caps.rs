//! Physical occupancy of capped, expiring tables. Expired rows count until
//! removed; no write scans a live population to decide a cap.
use crate::{schema::{Constraint, Table}, value::Value};

pub fn required(schema: &crate::schema::Schema) -> bool {
    schema.tables.values().any(|table| table.expire.is_some()
        && table.constraints.iter().any(|constraint| matches!(constraint, Constraint::Cap { .. })))
}

pub fn key(by: &[String], group: &[Value]) -> Vec<u8> {
    // Encode names as components too: a raw schema may contain punctuation.
    // Null terminates the names (which are all strings) before group values.
    let mut values: Vec<Value> = by.iter().cloned().map(Value::String).collect();
    values.push(Value::Null);
    values.extend_from_slice(group);
    crate::key::encode(&values)
}

/// A private namespace in memory's existing transactional index map. It cannot
/// collide with a table/index label (which always contains a dot), even for
/// raw schema names containing NUL or punctuation. Rebuilt with the indexes.
pub fn slot(table: &str) -> String { format!("\0caps:{}", crate::value::encode_bytes_hex(table.as_bytes())) }

pub fn next(old: Option<&str>, delta: i64) -> Option<String> {
    let count = old.map_or(0, |s| s.parse::<u64>().expect("cap count"));
    let count = count.checked_add_signed(delta).expect("balanced cap count delta");
    (count != 0).then(|| count.to_string())
}

pub fn deltas(table: &Table, old: Option<&Value>, new: Option<&Value>) -> Vec<(Vec<u8>, i64)> {
    if table.expire.is_none() { return Vec::new(); }
    let mut changes = Vec::new();
    for (i, constraint) in table.constraints.iter().enumerate() {
        let Constraint::Cap { by, .. } = constraint else { continue };
        if table.constraints[..i].iter().any(|c| matches!(c, Constraint::Cap { by: earlier, .. } if earlier == by)) { continue; }
        let row_key = |row: &Value| {
            let row = crate::schema::row_image(row, table);
            key(by, &by.iter().map(|c| row.field(c).cloned().unwrap_or(Value::Null)).collect::<Vec<_>>())
        };
        let before = old.map(row_key);
        let after = new.map(row_key);
        if before == after { continue; }
        if let Some(key) = before { changes.push((key, -1)); }
        if let Some(key) = after { changes.push((key, 1)); }
    }
    changes
}
