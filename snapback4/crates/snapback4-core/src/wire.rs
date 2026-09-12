//! Values on the wire are plain JSON: ids and text are strings, numbers are
//! numbers, rows are objects. The typed form (`Value`) is recovered from an
//! argument's declared type, so a device never spells a tag.

use crate::ir::ArgType;
use crate::value::Value;
use serde_json::{Map, Value as Json};
use std::collections::BTreeMap;

pub fn to_json(value: &Value) -> Json {
    match value {
        Value::Null => Json::Null,
        Value::Bool(b) => Json::Bool(*b),
        Value::Int(n) => Json::Number((*n).into()),
        Value::String(s) | Value::Id(s) => Json::String(s.clone()),
        Value::Bytes(bytes) => Json::String(crate::value::encode_bytes_hex(bytes)),
        Value::Array(items) => Json::Array(items.iter().map(to_json).collect()),
        Value::Row(fields) | Value::Map(fields) => Json::Object(fields.iter().map(|(k, v)| (k.clone(), to_json(v))).collect()),
    }
}

/// A plain JSON argument as the typed value its declaration names.
pub fn from_json(kind: &ArgType, json: &Json) -> Result<Value, String> {
    Ok(match (kind, json) {
        (ArgType::Optional(_), Json::Null) => Value::Null,
        (ArgType::Optional(inner), other) => from_json(inner, other)?,
        (ArgType::Cursor, Json::Null) => Value::Null,
        (ArgType::Cursor, Json::String(s)) => Value::String(s.clone()),
        (ArgType::Id | ArgType::Principal | ArgType::Ref { .. }, Json::String(s)) => Value::Id(s.clone()),
        (ArgType::Text { .. } | ArgType::Enum { .. }, Json::String(s)) => Value::String(s.clone()),
        (ArgType::Bytes { .. }, Json::String(s)) => Value::Bytes(crate::value::decode_bytes_hex(s).ok_or("bytes must be lowercase base16")?),
        (ArgType::Int | ArgType::Time | ArgType::Decimal { .. } | ArgType::Money { .. }, Json::Number(n)) => Value::Int(n.as_i64().ok_or("an integer")?),
        (ArgType::Bool, Json::Bool(b)) => Value::Bool(*b),
        (ArgType::Json { .. } | ArgType::Scalar, other) => untyped(other),
        (ArgType::Image { .. } | ArgType::Video { .. }, Json::Object(fields)) => Value::Map(fields.iter().map(|(k, v)| (k.clone(), if k == "id" { Value::Id(v.as_str().unwrap_or_default().to_owned()) } else { untyped(v) })).collect()),
        (ArgType::List { of, .. }, Json::Array(items)) => Value::Array(items.iter().map(|item| match of { Some(of) => from_json(of, item), None => Ok(untyped(item)) }).collect::<Result<Vec<_>, _>>()?),
        (kind, other) => return Err(format!("expected {}, got {}", describe(kind), other_kind(other))),
    })
}

/// JSON with no declared type: numbers are ints, strings are text.
pub fn untyped(json: &Json) -> Value {
    match json {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => Value::Int(n.as_i64().unwrap_or(0)),
        Json::String(s) => Value::String(s.clone()),
        Json::Array(items) => Value::Array(items.iter().map(untyped).collect()),
        Json::Object(fields) => Value::Map(fields.iter().map(|(k, v)| (k.clone(), untyped(v))).collect()),
    }
}

/// A stored row from plain JSON, typed by the table's columns.
pub fn row_from_json(table: &crate::schema::Table, json: &Json) -> Result<Value, String> {
    let Json::Object(fields) = json else { return Err("a row is an object".into()) };
    let mut out = BTreeMap::new();
    for (name, value) in fields {
        let Some(kind) = table.columns.get(name) else { return Err(format!("undeclared column {name}")) };
        out.insert(name.clone(), column_from_json(kind, value)?);
    }
    Ok(Value::Row(out.into()))
}

pub fn column_from_json(kind: &crate::schema::ColumnType, json: &Json) -> Result<Value, String> {
    use crate::schema::ColumnType as C;
    Ok(match (kind, json) {
        (C::Optional(_), Json::Null) => Value::Null,
        (C::Optional(inner), other) => column_from_json(inner, other)?,
        (C::Id | C::Principal | C::Ref { .. }, Json::String(s)) => Value::Id(s.clone()),
        (C::Text { .. } | C::Enum { .. }, Json::String(s)) => Value::String(s.clone()),
        (C::Bytes { .. }, Json::String(s)) => Value::Bytes(crate::value::decode_bytes_hex(s).ok_or("bytes must be lowercase base16")?),
        (C::Int | C::Time | C::Decimal { .. } | C::Money { .. }, Json::Number(n)) => Value::Int(n.as_i64().ok_or("an integer")?),
        (C::Bool, Json::Bool(b)) => Value::Bool(*b),
        (C::Json { .. }, other) => untyped(other),
        (C::Image { .. } | C::Video { .. }, Json::Object(fields)) => Value::Map(fields.iter().map(|(k, v)| (k.clone(), if k == "id" { Value::Id(v.as_str().unwrap_or_default().to_owned()) } else { untyped(v) })).collect()),
        (C::List { of, .. }, Json::Array(items)) => Value::Array(items.iter().map(|item| column_from_json(of, item)).collect::<Result<Vec<_>, _>>()?),
        (kind, other) => return Err(format!("expected {kind}, got {}", other_kind(other))),
    })
}

fn describe(kind: &ArgType) -> String {
    match kind {
        ArgType::Cursor => "a cursor".into(),
        ArgType::Id => "an id".into(),
        ArgType::Principal => "a principal".into(),
        ArgType::Ref { table } => format!("a {table} id"),
        ArgType::Text { max, .. } => format!("text of at most {max} characters"),
        ArgType::Bytes { .. } => "bytes".into(),
        ArgType::Image { .. } => "an image".into(),
        ArgType::Video { .. } => "a video".into(),
        ArgType::Int => "an integer".into(),
        ArgType::Bool => "a boolean".into(),
        ArgType::Time => "a time in milliseconds".into(),
        ArgType::Json { .. } => "json".into(),
        ArgType::Optional(inner) => format!("{} or null", describe(inner)),
        ArgType::Scalar => "a scalar".into(),
        ArgType::List { .. } => "a list".into(),
        ArgType::Enum { variants } => variants.iter().map(|v| format!("\"{v}\"")).collect::<Vec<_>>().join(" or "),
        ArgType::Decimal { .. } | ArgType::Money { .. } => "an integer amount in minor units".into(),
    }
}

fn other_kind(json: &Json) -> &'static str {
    match json {
        Json::Null => "null",
        Json::Bool(_) => "a boolean",
        Json::Number(_) => "a number",
        Json::String(_) => "a string",
        Json::Array(_) => "an array",
        Json::Object(_) => "an object",
    }
}

/// The plain JSON of a map of typed values.
pub fn map_to_json(values: &BTreeMap<String, Value>) -> Map<String, Json> {
    values.iter().map(|(k, v)| (k.clone(), to_json(v))).collect()
}
