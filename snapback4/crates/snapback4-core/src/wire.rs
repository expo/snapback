//! Values on the wire are plain JSON: ids and text are strings, numbers are
//! numbers, rows are objects. The typed form (`Value`) is recovered from an
//! argument's declared type, so a device never spells a tag.

use crate::ir::ArgType;
use crate::value::Value;
use serde_json::{Map, Value as Json};
#[cfg(test)]
use std::collections::BTreeMap;

/// Audience prefixes only, keyed by delivered-history table. An empty list
/// means this principal currently holds none of that table’s groups.
pub type HeldGroups = crate::smallmap::SmallMap<String, Vec<Vec<Json>>>;

/// Serialize a borrowed value directly in its plain wire form, without
/// allocating an intermediate JSON tree. The tagged store form is unchanged.
pub struct Plain<'a>(pub &'a Value);

impl serde::Serialize for Plain<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            Value::Null => serializer.serialize_unit(),
            Value::Bool(value) => serializer.serialize_bool(*value),
            Value::Int(value) => serializer.serialize_i64(*value),
            Value::String(value) | Value::Id(value) => serializer.serialize_str(value),
            Value::Bytes(value) => serializer.serialize_str(&crate::value::encode_bytes_hex(value)),
            Value::Array(values) => serializer.collect_seq(values.iter().map(Plain)),
            Value::Row(_) | Value::Map(_) => serializer.collect_map(self.0.as_object().expect("object").iter().map(|(key, value)| (key, Plain(value)))),
        }
    }
}

pub fn to_json(value: &Value) -> Json {
    match value {
        Value::Null => Json::Null,
        Value::Bool(b) => Json::Bool(*b),
        Value::Int(n) => Json::Number((*n).into()),
        Value::String(s) | Value::Id(s) => Json::String(s.clone()),
        Value::Bytes(bytes) => Json::String(crate::value::encode_bytes_hex(bytes)),
        Value::Array(items) => Json::Array(items.iter().map(to_json).collect()),
        Value::Row(_) | Value::Map(_) => Json::Object(value.as_object().expect("object").iter().map(|(k, v)| (k.clone(), to_json(v))).collect()),
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
        (ArgType::Json { .. } | ArgType::Scalar, other) => untyped(other)?,
        (ArgType::Image { .. } | ArgType::Video { .. }, Json::Object(fields)) => asset_from_json(fields)?,
        (ArgType::List { of, .. }, Json::Array(items)) => Value::Array(items.iter().map(|item| match of { Some(of) => from_json(of, item), None => untyped(item) }).collect::<Result<Vec<_>, _>>()?),
        (kind, other) => return Err(format!("expected {}, got {}", describe(kind), other_kind(other))),
    })
}

/// JSON with no declared type: numbers are ints, strings are text.
pub fn untyped(json: &Json) -> Result<Value, String> {
    Ok(match json {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => {
            let n = n.as_i64().filter(|n| (crate::value::I53_MIN..=crate::value::I53_MAX).contains(n))
                .ok_or("a number must be an integer in the signed 53-bit range")?;
            Value::Int(n)
        }
        Json::String(s) => Value::String(s.clone()),
        Json::Array(items) => Value::Array(items.iter().map(untyped).collect::<Result<_, _>>()?),
        Json::Object(fields) => Value::Map(fields.iter().map(|(k, v)| Ok((k.clone(), untyped(v)?))).collect::<Result<_, String>>()?),
    })
}

fn asset_from_json(fields: &Map<String, Json>) -> Result<Value, String> {
    Ok(Value::Map(fields.iter().map(|(k, v)| Ok((k.clone(), if k == "id" {
        Value::Id(v.as_str().ok_or("an asset id must be a string")?.to_owned())
    } else { untyped(v)? }))).collect::<Result<_, String>>()?))
}

/// A stored row from plain JSON, typed by the table's columns.
pub fn row_from_json(table: &crate::schema::Table, json: &Json) -> Result<Value, String> {
    let Json::Object(fields) = json else { return Err("a row is an object".into()) };
    let mut out = crate::smallmap::SmallMap::new();
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
        (C::Json { .. }, other) => untyped(other)?,
        (C::Image { .. } | C::Video { .. }, Json::Object(fields)) => asset_from_json(fields)?,
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
pub fn map_to_json<'a>(values: impl IntoIterator<Item = (&'a String, &'a Value)>) -> Map<String, Json> {
    values.into_iter().map(|(k, v)| (k.clone(), to_json(v))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn borrowed_wire_encoding_matches_every_value_form() {
        let escaped = "\"\\\n\r\t\u{0}\u{1f} café 🦀";
        let values = Value::Array(vec![
            Value::Null, Value::Bool(false), Value::Bool(true),
            Value::Int(crate::value::I53_MIN), Value::Int(0), Value::Int(crate::value::I53_MAX),
            Value::String(escaped.into()), Value::Id(escaped.into()), Value::Bytes((0..=255).collect()),
            Value::Row(BTreeMap::from([(escaped.into(), Value::Array(vec![Value::Null]))]).into()),
            Value::Map(BTreeMap::from([("nested".into(), Value::Row(BTreeMap::new().into()))]).into()),
            Value::Array(vec![]),
        ]);
        let bytes = serde_json::to_vec(&Plain(&values)).unwrap();
        assert_eq!(bytes, serde_json::to_vec(&to_json(&values)).unwrap());
        let decoded: Json = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded[0], Json::Null);
        assert_eq!(decoded[6], escaped);
        assert_eq!(decoded[8].as_str().unwrap().len(), 512);
        assert!(decoded[9][escaped][0].is_null());
    }
}
