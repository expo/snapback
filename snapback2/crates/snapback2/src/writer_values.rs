//! JSON-to-engine value conversion for the sole-writer protocol.

use crate::protocol::{Refusal, json_to_value};
use serde_json::Value as Json;
use snapback2_core::{ArgType, ColumnType, Generation, Value};
use std::collections::BTreeMap;

pub(super) fn operation_args(
    generation: &Generation,
    op: &str,
    args: &Json,
) -> Result<BTreeMap<String, Value>, Refusal> {
    let program = &generation
        .programs()
        .get(op)
        .ok_or_else(|| {
            Refusal::new(
                "E_OP_UNKNOWN",
                "op",
                format!("unknown operation {op}"),
                "use /api/manifest",
                "op/manifest",
            )
        })?
        .0;
    let object = args.as_object().ok_or_else(|| {
        Refusal::input(
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
        return Err(Refusal::input(
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

pub(super) fn frame_digest(frame: &Json) -> String {
    let mut value = frame.clone();
    if let Some(object) = value.as_object_mut() {
        object.remove("seq");
    }
    serde_json::to_string(&value).unwrap_or_default()
}

pub(super) fn channel_args(
    generation: &Generation,
    name: &str,
    args: &Json,
) -> Result<BTreeMap<String, Value>, Refusal> {
    let channel = generation.schema().channels.get(name).ok_or_else(|| {
        Refusal::new(
            "E_OP_CHANNEL_UNKNOWN",
            "op",
            format!("unknown channel {name}"),
            "use a channel listed by /api/manifest",
            "op/channels",
        )
    })?;
    let object = args.as_object().ok_or_else(|| {
        Refusal::input(
            "channel args must be a JSON object",
            "pass {\"arg\": value}",
        )
    })?;
    channel
        .args
        .iter()
        .map(|(name, kind)| {
            let value = match object.get(name) {
                Some(value) => json_as_arg(value, kind)?,
                None if matches!(kind, ArgType::Optional(_)) => Value::Null,
                None => {
                    return Err(Refusal::input(
                        format!("channel is missing arg {name}"),
                        "pass every required channel arg",
                    ));
                }
            };
            Ok((name.clone(), value))
        })
        .collect()
}

fn json_as_arg(value: &Json, kind: &ArgType) -> Result<Value, Refusal> {
    match kind {
        ArgType::Cursor => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| {
                Refusal::input(
                    "cursor arguments must be strings",
                    "pass a returned next token",
                )
            }),
        ArgType::Optional(_) if value.is_null() => Ok(Value::Null),
        ArgType::Optional(inner) => json_as_arg(value, inner),
        ArgType::Id | ArgType::Principal | ArgType::Ref { .. } => value
            .as_str()
            .map(|value| Value::Id(value.to_owned()))
            .ok_or_else(|| Refusal::input("id arguments must be strings", "pass a string id")),
        ArgType::List { of, .. } => value
            .as_array()
            .ok_or_else(|| Refusal::input("list arguments must be arrays", "pass a JSON array"))?
            .iter()
            .map(|value| match of {
                Some(of) => json_as_arg(value, of),
                None => json_to_value(value),
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        ArgType::Int | ArgType::Time | ArgType::Decimal { .. } | ArgType::Money { .. } => value
            .as_i64()
            .map(Value::Int)
            .ok_or_else(|| Refusal::input("numeric arguments must be integers", "pass an integer")),
        ArgType::Text { .. } | ArgType::Enum { .. } => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| {
                Refusal::input("text and enum arguments must be strings", "pass a string")
            }),
        ArgType::Bytes { .. } => json_as_bytes(value, "bytes arguments"),
        ArgType::Image { .. } | ArgType::Video { .. } => json_to_value(value),
        ArgType::Bool => value.as_bool().map(Value::Bool).ok_or_else(|| {
            Refusal::input("boolean arguments must be true or false", "pass a boolean")
        }),
        ArgType::Json { .. } | ArgType::Scalar => json_to_value(value),
    }
}

pub(super) fn json_as_kind(value: &Json, kind: &ColumnType) -> Result<Value, Refusal> {
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
            .ok_or_else(|| Refusal::input("id index values must be strings", "pass a string id")),
        ColumnType::Text { .. } | ColumnType::Enum { .. } => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| Refusal::input("text index values must be strings", "pass a string")),
        ColumnType::Bytes { .. } => json_as_bytes(value, "bytes index values"),
        ColumnType::Image { .. } | ColumnType::Video { .. } => json_to_value(value),
        ColumnType::Int
        | ColumnType::Time
        | ColumnType::Decimal { .. }
        | ColumnType::Money { .. } => value.as_i64().map(Value::Int).ok_or_else(|| {
            Refusal::input("numeric index values must be integers", "pass an integer")
        }),
        ColumnType::Bool => value.as_bool().map(Value::Bool).ok_or_else(|| {
            Refusal::input(
                "boolean index values must be true or false",
                "pass a boolean",
            )
        }),
        ColumnType::Json { .. } | ColumnType::List { .. } => json_to_value(value),
    }
}

fn json_as_bytes(value: &Json, label: &str) -> Result<Value, Refusal> {
    let bytes = value
        .as_object()
        .filter(|object| object.len() == 1)
        .and_then(|object| object.get("Bytes"))
        .and_then(Json::as_str)
        .and_then(snapback2_core::decode_bytes_hex)
        .ok_or_else(|| {
            Refusal::input(
                format!("{label} must use {{\"Bytes\":\"lowercase-base16\"}}"),
                "pass canonical lowercase even-length base16",
            )
        })?;
    Ok(Value::Bytes(bytes))
}
