//! Schema-directed public JSON conversion. Inherited from Snapback 2's writer boundary.
// @ref LLP 2000#13-first-implementation-choices — named operations use the same typed boundary on query and durable write paths.
use crate::{ArgType, ColumnType, RuntimeError, Value};
use serde_json::Value as Json;
use std::collections::BTreeMap;

fn input(message: impl Into<String>, hint: impl Into<String>) -> RuntimeError {
    RuntimeError::Input(format!("{}; {}", message.into(), hint.into()))
}

pub fn program_args(
    program: &crate::Program,
    args: &Json,
) -> Result<BTreeMap<String, Value>, RuntimeError> {
    let object = args.as_object().ok_or_else(|| {
        input(
            "operation args must be a JSON object",
            "pass {} when there are no args",
        )
    })?;
    let unknown: Vec<_> = object
        .keys()
        .filter(|key| !program.args.contains_key(*key))
        .cloned()
        .collect();
    if !unknown.is_empty() {
        return Err(input(
            format!("unknown operation args: {}", unknown.join(", ")),
            "remove args not declared by the operation",
        ));
    }
    let mut values = BTreeMap::new();
    for (name, kind) in &program.args {
        let Some(value) = object.get(name) else {
            if matches!(kind, ArgType::Optional(_)) {
                values.insert(name.clone(), Value::Null);
            }
            continue;
        };
        values.insert(name.clone(), json_as_arg(value, kind)?);
    }
    Ok(values)
}

fn json_as_arg(value: &Json, kind: &ArgType) -> Result<Value, RuntimeError> {
    match kind {
        ArgType::Cursor => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| {
                input(
                    "cursor arguments must be strings",
                    "pass a returned next token",
                )
            }),
        ArgType::Optional(_) if value.is_null() => Ok(Value::Null),
        ArgType::Optional(inner) => json_as_arg(value, inner),
        ArgType::Id | ArgType::Principal | ArgType::Ref { .. } => value
            .as_str()
            .map(|value| Value::Id(value.to_owned()))
            .ok_or_else(|| input("id arguments must be strings", "pass a string id")),
        ArgType::List { of, .. } => value
            .as_array()
            .ok_or_else(|| input("list arguments must be arrays", "pass a JSON array"))?
            .iter()
            .map(|value| match of {
                Some(of) => json_as_arg(value, of),
                None => json_to_value(value),
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        ArgType::Int | ArgType::Time | ArgType::Decimal { .. } | ArgType::Money { .. } => value
            .as_i64()
            .filter(|value| value.unsigned_abs() <= 9_007_199_254_740_991)
            .map(Value::Int)
            .ok_or_else(|| input("numeric arguments must be integers", "pass an integer")),
        ArgType::Text { .. } | ArgType::Enum { .. } => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| input("text and enum arguments must be strings", "pass a string")),
        ArgType::Bytes { .. } => json_as_bytes(value, "bytes arguments"),
        ArgType::Image { .. } | ArgType::Video { .. } => json_to_value(value),
        ArgType::Bool => value
            .as_bool()
            .map(Value::Bool)
            .ok_or_else(|| input("boolean arguments must be true or false", "pass a boolean")),
        ArgType::Json { .. } | ArgType::Scalar => json_to_value(value),
    }
}

pub fn json_as_kind(value: &Json, kind: &ColumnType) -> Result<Value, RuntimeError> {
    match kind {
        ColumnType::Optional(inner) => {
            if value.is_null() {
                Ok(Value::Null)
            } else {
                json_as_kind(value, inner)
            }
        }
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => value
            .as_str()
            .map(|value| Value::Id(value.to_owned()))
            .ok_or_else(|| input("id index values must be strings", "pass a string id")),
        ColumnType::Text { .. } | ColumnType::Enum { .. } => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| input("text index values must be strings", "pass a string")),
        ColumnType::Bytes { .. } => json_as_bytes(value, "bytes index values"),
        ColumnType::Image { .. } | ColumnType::Video { .. } => json_to_value(value),
        ColumnType::Int
        | ColumnType::Time
        | ColumnType::Decimal { .. }
        | ColumnType::Money { .. } => value
            .as_i64()
            .filter(|value| value.unsigned_abs() <= 9_007_199_254_740_991)
            .map(Value::Int)
            .ok_or_else(|| input("numeric index values must be integers", "pass an integer")),
        ColumnType::Bool => value.as_bool().map(Value::Bool).ok_or_else(|| {
            input(
                "boolean index values must be true or false",
                "pass a boolean",
            )
        }),
        ColumnType::List { of, .. } => value
            .as_array()
            .ok_or_else(|| input("list values must be arrays", "pass a JSON array"))?
            .iter()
            .map(|value| json_as_kind(value, of))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        ColumnType::Json { .. } => json_to_value(value),
    }
}

fn json_as_bytes(value: &Json, label: &str) -> Result<Value, RuntimeError> {
    let bytes = value
        .as_object()
        .filter(|object| object.len() == 1)
        .and_then(|object| object.get("Bytes"))
        .and_then(Json::as_str)
        .and_then(crate::decode_bytes_hex)
        .ok_or_else(|| {
            input(
                format!("{label} must use {{\"Bytes\":\"lowercase-base16\"}}"),
                "pass canonical lowercase even-length base16",
            )
        })?;
    Ok(Value::Bytes(bytes))
}
pub fn json_to_value(value: &Json) -> Result<Value, RuntimeError> {
    match value {
        Json::Null => Ok(Value::Null),
        Json::Bool(value) => Ok(Value::Bool(*value)),
        Json::Number(value) => value.as_i64().filter(|value| value.unsigned_abs() <= 9_007_199_254_740_991).map(Value::Int).ok_or_else(|| {
            input(
                "numbers must be signed i53 integers",
                "send an integer within JavaScript's safe range",
            )
        }),
        Json::String(value) => Ok(Value::String(value.clone())),
        Json::Array(values) => values
            .iter()
            .map(json_to_value)
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Json::Object(values) => values
            .iter()
            .map(|(key, value)| Ok((key.clone(), json_to_value(value)?)))
            .collect::<Result<BTreeMap<_, _>, RuntimeError>>()
            .map(|fields| Value::Map(fields.into())),
    }
}
