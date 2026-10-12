//! Typed admission of rows and arguments at the store's trust boundary. A
//! value that does not fit its declared type is refused before any rule or
//! constraint sees it.

use crate::error::RuntimeError;
use crate::ir::{ArgType, Program};
use crate::schema::{ColumnType, Constraint, Schema, TextFormat, contains_system_principal};
use crate::value::{I53_MAX, I53_MIN, Value, canonical_json};
use std::collections::BTreeMap;

pub fn validate_row(schema: &Schema, table_name: &str, row: &Value) -> Result<(), RuntimeError> {
    validate_image(schema, table_name, row, None, false, false)
}

// @ref LLP 3000.015#3 — row-view storage is a private numerical cache, not a disclosure.
// No certificate yet means no computed fields; public/input validation stays strict.
#[cfg(feature = "sqlite")]
pub(crate) fn validate_maintained_cache(schema: &Schema, table_name: &str, row: &Value) -> Result<(), RuntimeError> {
    let cache = schema.maintain_for(table_name).is_some_and(|m| m.row_key.is_some());
    validate_image(schema, table_name, row, None, false, cache)
}

/// A predicting patch preserves unknown, untouched fields as omissions.
/// The authoritative writer always uses the complete-row validator.
pub(super) fn validate_projection(schema: &Schema, table_name: &str, row: &Value, viewer: Option<&str>) -> Result<(), RuntimeError> {
    validate_image(schema, table_name, row, viewer, false, false)
}

/// Application input is checked before engine slots are prepared. The final
/// stored image must also pass validate_row, with every required slot present.
pub(super) fn validate_before_slots(schema: &Schema, table_name: &str, row: &Value) -> Result<(), RuntimeError> {
    validate_image(schema, table_name, row, None, true, false)
}

fn validate_image(schema: &Schema, table_name: &str, row: &Value, viewer: Option<&str>, before_slots: bool, cache: bool) -> Result<(), RuntimeError> {
    let table = schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
    let object = row.as_object()?;
    if !object.contains_key("id") {
        return Err(RuntimeError::Schema(format!("{table_name} row lacks id")));
    }
    if let Some(name) = object.keys().find(|name| !table.columns.contains_key(*name)) {
        return Err(RuntimeError::Input(format!("{table_name} row contains undeclared field {name}")));
    }
    for (name, kind) in &table.columns {
        if before_slots && crate::schema::timeline::is_slot(name) { continue; }
        if cache && matches!(name.as_str(), "value" | "recountPending") && !object.contains_key(name) { continue; }
        let value = object.get(name).or_else(|| table.maintained.contains_key(name).then_some(&Value::Int(0)));
        if value.is_none() && viewer.is_some_and(|viewer| table.written_by.get(name).is_some_and(|authority|
            !authority.audience && row.field(&authority.owner).ok() != Some(&Value::Id(viewer.into())))) { continue; }
        validate_column(table_name, name, kind, value)?;
    }
    for constraint in &table.constraints {
        if let Constraint::Text { field, min, format } = constraint
            && let Some(Value::String(text)) = object.get(field)
        {
            validate_text(&format!("{table_name}.{field}"), text, *min, *format).map_err(|error| RuntimeError::Constraint(error.to_string().trim_start_matches("E_INPUT: ").to_owned()))?;
        }
    }
    Ok(())
}

pub fn validate_column(table_name: &str, name: &str, kind: &ColumnType, value: Option<&Value>) -> Result<(), RuntimeError> {
    let label = format!("{table_name}.{name}");
    if let Some(value) = value {
        crate::value::validate_identities(value)?;
        if contains_system_principal(value) {
            return Err(RuntimeError::Input(format!("{label} cannot carry the reserved system principal")));
        }
    }
    if let Some(code_point) = disallowed_control(kind, value) {
        return Err(RuntimeError::Input(format!("{label} contains disallowed control character U+{code_point:04X}")));
    }
    validate_column_minimum(kind, value, &label)?;
    if !fits(kind, value) {
        return Err(RuntimeError::Input(match value {
            None | Some(Value::Null) => format!("{label} is required ({kind})"),
            Some(value) => format!("{label} must be {kind}, not {}", describe(value)),
        }));
    }
    Ok(())
}

// @ref LLP 3000.007#5.4 — nested/optional columns use the same minimum on server and device writes.
fn validate_column_minimum(kind: &ColumnType, value: Option<&Value>, label: &str) -> Result<(), RuntimeError> {
    match (kind, value) {
        (ColumnType::Optional(inner), Some(value)) => validate_column_minimum(inner, Some(value), label),
        (ColumnType::List { of, .. } | ColumnType::ListRange { of, .. }, Some(Value::Array(items))) => {
            if let ColumnType::ListRange { min, .. } = kind { validate_list_minimum(label, items.len(), *min)?; }
            for item in items { validate_column_minimum(of, Some(item), label)?; }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn validate_list_minimum(label: &str, length: usize, min: u32) -> Result<(), RuntimeError> {
    if length < min as usize {
        return Err(RuntimeError::Input(format!("{label} needs at least {min} {}; got {length}", if min == 1 { "item" } else { "items" })));
    }
    Ok(())
}

fn describe(value: &Value) -> String {
    match value {
        Value::String(text) if text.chars().count() > 24 => format!("{} characters of text", text.chars().count()),
        Value::String(text) => format!("the text '{text}'"),
        Value::Id(id) => format!("the id '{id}'"),
        Value::Int(n) => format!("the number {n}"),
        Value::Bool(b) => format!("the boolean {b}"),
        Value::Null => "null".into(),
        Value::Bytes(b) => format!("{} bytes", b.len()),
        Value::Array(items) => format!("a list of {}", items.len()),
        Value::Row(_) | Value::Map(_) => "an object".into(),
    }
}

pub fn validate_text(label: &str, text: &str, min: u32, format: Option<TextFormat>) -> Result<(), RuntimeError> {
    let length = text.chars().count();
    if length < min as usize {
        return Err(RuntimeError::Input(format!("{label} needs at least {min} characters; got {length}")));
    }
    if let Some(format) = format
        && !format.matches(text)
    {
        return Err(RuntimeError::Input(match format {
            TextFormat::Handle => format!("{label} must be a handle: lowercase letters, digits and underscores"),
            TextFormat::Url => format!("{label} must be an http or https URL"),
        }));
    }
    Ok(())
}

fn disallowed_control(kind: &ColumnType, value: Option<&Value>) -> Option<u32> {
    match (kind, value) {
        (ColumnType::Optional(inner), Some(value)) => disallowed_control(inner, Some(value)),
        (ColumnType::List { of, .. } | ColumnType::ListRange { of, .. }, Some(Value::Array(values))) => values.iter().find_map(|value| disallowed_control(of, Some(value))),
        (ColumnType::Text { .. }, Some(Value::String(text))) => disallowed_text_control(text),
        _ => None,
    }
}

/// Text forbids C0 controls except tab, LF and CR.
pub fn disallowed_text_control(text: &str) -> Option<u32> {
    text.chars().find(|c| c.is_control() && !matches!(c, '\t' | '\n' | '\r')).map(|c| c as u32)
}

fn fits(kind: &ColumnType, value: Option<&Value>) -> bool {
    match (kind, value) {
        (ColumnType::Optional(_), None | Some(Value::Null)) => true,
        (ColumnType::Optional(inner), Some(value)) => fits(inner, Some(value)),
        (ColumnType::List { of, max } | ColumnType::ListRange { of, max, .. }, Some(Value::Array(values))) => values.len() <= *max as usize && values.iter().all(|value| fits(of, Some(value))),
        // @ref LLP 3000#7-decisions-during-execution — typed references do not imply target existence
        (ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. }, Some(Value::Id(_))) => true,
        (ColumnType::Text { max }, Some(Value::String(text))) => text.chars().count() <= *max as usize,
        (ColumnType::Bytes { max }, Some(Value::Bytes(bytes))) => bytes.len() <= *max as usize,
        (ColumnType::Image { .. } | ColumnType::Video { .. }, Some(Value::Map(fields))) => fields.get("id").is_some_and(|id| matches!(id, Value::Id(_))),
        (ColumnType::Enum { variants }, Some(Value::String(value))) => variants.contains(value),
        (ColumnType::Int | ColumnType::Time | ColumnType::Decimal { .. } | ColumnType::Money { .. }, Some(Value::Int(value))) => (I53_MIN..=I53_MAX).contains(value),
        // @ref LLP 3000.040#14-where-the-bound-is-enforced — the slot's bound is part of its type: every stored write and argument meets it here.
        (ColumnType::IntRange { min, max }, Some(Value::Int(value))) => (I53_MIN..=I53_MAX).contains(value) && (*min..=*max).contains(value),
        (ColumnType::Bool, Some(Value::Bool(_))) => true,
        (ColumnType::Json { max_bytes }, Some(value)) => canonical_json(value).len() <= *max_bytes as usize,
        _ => false,
    }
}

/// Validate the arguments and fill each omitted optional with `null`, so
/// a caller that leaves `c` out reads page one.
#[cfg(not(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite"))))]
pub fn validate_inputs(schema: &Schema, program: &Program, inputs: &mut BTreeMap<String, Value>) -> Result<(), RuntimeError> {
    super::admission::check(schema, program)?;
    validate_arguments(schema, program, inputs)
}

// @ref LLP 3000.002#proposed-device-representation-and-codec-redesign — the web predicts a server-admitted backend; the server and native hosts still check every call.
pub(super) fn validate_device_inputs(schema: &Schema, program: &Program, inputs: &mut BTreeMap<String, Value>) -> Result<(), RuntimeError> {
    #[cfg(not(any(all(target_arch = "wasm32", feature = "web", not(feature = "sqlite")), feature = "web-device-check")))]
    super::admission::check(schema, program)?;
    validate_arguments(schema, program, inputs)
}

fn validate_arguments(schema: &Schema, program: &Program, inputs: &mut BTreeMap<String, Value>) -> Result<(), RuntimeError> {
    for (name, kind) in &program.args {
        if !inputs.contains_key(name) && (kind.is_optional() || matches!(kind, ArgType::Cursor)) {
            inputs.insert(name.clone(), Value::Null);
        }
        let value = inputs.get(name).ok_or_else(|| RuntimeError::Input(format!("missing argument {name}")))?;
        validate_arg(schema, kind, value, name)?;
    }
    if let Some(extra) = inputs.keys().find(|name| !program.args.contains_key(*name)) {
        return Err(RuntimeError::Input(format!("{} takes no argument {extra}", program.name)));
    }
    Ok(())
}

pub fn validate_arg(schema: &Schema, kind: &ArgType, value: &Value, label: &str) -> Result<(), RuntimeError> {
    if !kind.bounds_valid() {
        return Err(RuntimeError::Input(format!("{label} has a minimum greater than its maximum")));
    }
    crate::value::validate_identities(value)?;
    if contains_system_principal(value) {
        return Err(RuntimeError::Input(format!("{label} cannot carry the reserved system principal")));
    }
    match kind {
        ArgType::Cursor => match value {
            Value::Null => Ok(()),
            Value::String(token) => crate::cursor::decode_cursor(schema, token).map(|_| ()).map_err(|error| RuntimeError::Input(format!("{label}: {error}"))),
            _ => Err(RuntimeError::Input(format!("{label} must be an opaque cursor string or null"))),
        },
        ArgType::Optional(_) if *value == Value::Null => Ok(()),
        ArgType::Optional(inner) => validate_arg(schema, inner, value, label),
        ArgType::Scalar => match value {
            Value::Row(_) | Value::Map(_) => Err(RuntimeError::Input(format!("{label} must be a scalar"))),
            _ => Ok(()),
        },
        ArgType::Text { max, min, format } => match value {
            Value::String(text) => {
                if let Some(code_point) = disallowed_text_control(text) {
                    return Err(RuntimeError::Input(format!("{label} contains disallowed control character U+{code_point:04X}")));
                }
                if text.chars().count() > *max as usize {
                    return Err(RuntimeError::Input(format!("{label} is longer than {max} characters")));
                }
                validate_text(label, text, *min, *format)
            }
            other => Err(RuntimeError::Input(format!("{label} must be text, not {}", describe(other)))),
        },
        ArgType::List { of, max } | ArgType::ListRange { of, max, .. } => match value {
            Value::Array(items) => {
                if let ArgType::ListRange { min, .. } = kind { validate_list_minimum(label, items.len(), *min)?; }
                if items.len() > *max as usize {
                    return Err(RuntimeError::Input(format!("{label} has more than {max} items")));
                }
                if let Some(of) = of {
                    for item in items {
                        validate_arg(schema, of, item, label)?;
                    }
                }
                Ok(())
            }
            other => Err(RuntimeError::Input(format!("{label} must be a list, not {}", describe(other)))),
        },
        other => {
            let column = crate::schema::arg_as_column(other).ok_or_else(|| RuntimeError::Input(format!("{label} has no column form")))?;
            if fits(&column, Some(value)) { Ok(()) } else { Err(RuntimeError::Input(format!("{label} must be {column}, not {}", describe(value)))) }
        }
    }
}
