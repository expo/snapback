//! Cardinality invariants share index grouping at admission, writes, and succession.
// @ref LLP 1017#22-the-semantics-the-engines-unchanged — omitted optional fields join null.

use crate::certificate::{CheckError, WriteKind};
use crate::ir::Expr;
use crate::schema::{Constraint, Index, Maintain, MaintainKind, Schema, Table};
use crate::value::{Value, ValueError, canonical_json};
use std::collections::BTreeSet;

pub(crate) struct MaintainedGroup {
    pub(crate) source: Value,
    pub(crate) key: Vec<Value>,
    pub(crate) id: String,
}

/// Derive the maintained row address from the same normalized source image
/// everywhere that address is used.
pub(crate) fn maintained_group(
    table: &Table,
    source: &Value,
    by: &[String],
) -> Result<MaintainedGroup, ValueError> {
    let mut source = source.clone();
    crate::engine::materialize_optional_fields(&mut source, table);
    let key = by
        .iter()
        .map(|field| source.field(field).cloned())
        .collect::<Result<Vec<_>, _>>()?;
    let id = canonical_json(&key);
    Ok(MaintainedGroup { source, key, id })
}

pub(crate) fn count_maintain<'a>(
    schema: &'a Schema,
    source: &str,
    by: &[String],
) -> Option<&'a Maintain> {
    schema.maintains.iter().find(|maintain| {
        maintain.source == source
            && maintain.by == by
            && matches!(maintain.kind, MaintainKind::Count)
    })
}

pub(crate) fn group_key(row: &Value, by: &[String]) -> Vec<Value> {
    by.iter()
        .map(|field| row.field(field).cloned().unwrap_or(Value::Null))
        .collect()
}

pub(crate) fn enforcement_index<'a>(
    table: &'a Table,
    by: &[String],
) -> Option<(&'a String, &'a Index)> {
    table.indexes.iter().find(|(_, index)| {
        index
            .scalar_columns()
            .is_some_and(|columns| columns.starts_with(by))
    })
}

// @ref LLP 1017#24-metering — only patches that may move a group need its probe.
pub(crate) fn write_caps<'a>(
    schema: &'a Schema,
    table: &str,
    kind: WriteKind,
    patch: Option<&Expr>,
) -> Vec<(&'a [String], u32)> {
    schema
        .table(table)
        .into_iter()
        .flat_map(|table| &table.constraints)
        .filter_map(|constraint| {
            let Constraint::Cap { by, max } = constraint else {
                return None;
            };
            let probes = match kind {
                WriteKind::Insert | WriteKind::Upsert => true,
                WriteKind::Update => by.iter().any(|column| match patch {
                    Some(Expr::Object(fields)) => fields.contains_key(column),
                    Some(Expr::Literal(Value::Row(fields) | Value::Map(fields))) => {
                        fields.contains_key(column)
                    }
                    _ => true,
                }),
                WriteKind::Delete | WriteKind::Emit => false,
            };
            probes.then_some((by.as_slice(), *max))
        })
        .collect()
}

pub(crate) fn schema_errors(schema: &Schema) -> Vec<(String, CheckError)> {
    let mut errors = Vec::new();
    for (name, table) in &schema.tables {
        let mut tuples = BTreeSet::new();
        for (position, constraint) in table.constraints.iter().enumerate() {
            let Constraint::Cap { by, max } = constraint else {
                continue;
            };
            let cols = by.join(", ");
            let problem = if schema.maintains.iter().any(|m| m.target == *name) {
                Some((
                    format!("cap on {name} is invalid: maintained targets are engine-owned"),
                    "remove the cap from the maintained target".to_owned(),
                ))
            } else if *max == 0 || by.is_empty() {
                Some((
                    format!("cap on {name} needs a positive max and non-empty grouping columns"),
                    "cap 50 by <cols>".to_owned(),
                ))
            } else if by.iter().collect::<BTreeSet<_>>().len() != by.len() {
                Some((
                    format!("cap on {name} repeats a grouping column"),
                    "use distinct grouping columns".to_owned(),
                ))
            } else if let Some(column) = by.iter().find(|c| !table.columns.contains_key(*c)) {
                Some((
                    format!("cap on {name} names undeclared column {column}"),
                    "name declared grouping columns".to_owned(),
                ))
            } else if let Some(column) = by.iter().find(|c| !table.columns[*c].is_indexable()) {
                Some((
                    format!("cap on {name} cannot use non-indexable column {column}"),
                    "name indexable scalar grouping columns".to_owned(),
                ))
            } else if !tuples.insert(by.clone()) {
                Some((
                    format!("{name} already caps {cols}"),
                    "remove the duplicate cap".to_owned(),
                ))
            } else if enforcement_index(table, by).is_none() {
                Some((
                    format!("cap on {name} needs an index that begins with {cols}"),
                    format!("by {cols}"),
                ))
            } else {
                None
            };
            if let Some((message, rewrite)) = problem {
                errors.push((
                    format!("schema.tables.{name}.constraints[{position}]"),
                    CheckError {
                        site: None,
                        code: "E_SCHEMA_CONSTRAINT".to_owned(),
                        message,
                        rewrite,
                    },
                ));
            }
        }
    }
    errors
}

// @ref LLP 1001#maintained-addresses — generated addresses retain the canonical
// group tuple; the ordinary user identity allowance does not price this slot.
/// A long id is admitted only in this maintained target's intrinsic address
/// slot, with a canonical tuple of values from its unchanged source domain.
pub(crate) fn validate_address(
    schema: &Schema,
    target: &str,
    value: &Value,
) -> Result<(), crate::RuntimeError> {
    if crate::value::validate_identities(value).is_ok() {
        return crate::engine::validate_column_value(
            target,
            "id",
            &crate::ColumnType::Id,
            Some(value),
        );
    }
    let invalid = || {
        crate::RuntimeError::Input(format!(
            "{target}.id is not a canonical maintained group address"
        ))
    };
    let Value::Id(id) = value else {
        return Err(invalid());
    };
    let maintain = schema
        .maintains
        .iter()
        .find(|m| m.target == target)
        .ok_or_else(invalid)?;
    if canonical_json(value).len() as u64 > crate::bounds::declared_identity_max(schema, target) {
        return Err(invalid());
    }
    let key: Vec<Value> = serde_json::from_str(id).map_err(|_| invalid())?;
    if key.len() != maintain.by.len() || canonical_json(&key) != *id {
        return Err(invalid());
    }
    let source = schema.table(&maintain.source).ok_or_else(invalid)?;
    for (name, value) in maintain.by.iter().zip(&key) {
        crate::engine::validate_typed_column_value(
            schema,
            &maintain.source,
            name,
            &source.columns[name],
            Some(value),
        )?;
    }
    Ok(())
}

pub(crate) fn validate_row_identities(
    schema: &Schema,
    table: &str,
    row: &Value,
) -> Result<(), crate::RuntimeError> {
    let fields = row.as_object()?;
    if let Some(value) = fields.get("id") {
        validate_address(schema, table, value)?;
        if let Value::Id(id) = value
            && !crate::value::identity_fits(id)
        {
            let maintain = schema
                .maintains
                .iter()
                .find(|m| m.target == table)
                .expect("validated maintained address");
            let group = maintained_group(
                schema.table(table).expect("maintained target"),
                row,
                &maintain.by,
            )?;
            if group.id != *id {
                return Err(crate::RuntimeError::Input(format!(
                    "{table}.id differs from its maintained group"
                )));
            }
        }
    }
    for (name, value) in fields.iter().filter(|(name, _)| name.as_str() != "id") {
        if let Some(kind) = schema.table(table).and_then(|t| t.columns.get(name)) {
            validate_typed_identities(schema, kind, value)?;
        } else {
            crate::value::validate_identities(value)?;
        }
    }
    Ok(())
}

pub(crate) fn validate_index_column(
    schema: &Schema,
    table: &str,
    column: &str,
    value: &Value,
) -> Result<(), crate::RuntimeError> {
    let kind = schema
        .table(table)
        .and_then(|t| t.columns.get(column))
        .ok_or_else(|| crate::RuntimeError::Schema(format!("missing column {table}.{column}")))?;
    if column == "id" && *kind == crate::ColumnType::Id {
        validate_address(schema, table, value)
    } else {
        crate::engine::validate_typed_column_value(schema, table, column, kind, Some(value))
    }
}

/// Width checks follow declared Ref/Optional/List slots, never an untyped tag.
pub(crate) fn validate_typed_identities(
    schema: &Schema,
    kind: &crate::ColumnType,
    value: &Value,
) -> Result<(), crate::RuntimeError> {
    use crate::ColumnType;
    match (kind, value) {
        (ColumnType::Ref { table }, Value::Id(id)) if !crate::value::identity_fits(id) => {
            validate_address(schema, table, value)
        }
        (ColumnType::Optional(inner), value) if value != &Value::Null => {
            validate_typed_identities(schema, inner, value)
        }
        (ColumnType::List { of, .. }, Value::Array(values)) => values
            .iter()
            .try_for_each(|v| validate_typed_identities(schema, of, v)),
        _ => crate::value::validate_identities(value),
    }
}

// Argument preflight shares the same targeted domain before shape/fanout refusal.
pub(crate) fn validate_arg_identities(
    schema: &Schema,
    kind: &crate::ArgType,
    value: &Value,
) -> Result<(), crate::RuntimeError> {
    use crate::ArgType;
    match (kind, value) {
        (ArgType::Ref { table }, Value::Id(id)) if !crate::value::identity_fits(id) => {
            validate_address(schema, table, value)
        }
        (ArgType::Optional(inner), value) if value != &Value::Null => {
            validate_arg_identities(schema, inner, value)
        }
        (ArgType::List { of: Some(of), .. }, Value::Array(values)) => values
            .iter()
            .try_for_each(|v| validate_arg_identities(schema, of, v)),
        _ => crate::value::validate_identities(value),
    }
}

pub(crate) fn validate_key_identities(
    schema: &Schema,
    table: &str,
    index: &str,
    offset: usize,
    values: &[Value],
) -> Result<(), crate::RuntimeError> {
    let declaration = schema.table(table).and_then(|t| t.index(index));
    for (position, value) in values.iter().enumerate() {
        let column = declaration
            .and_then(|i| i.components.get(offset + position))
            .and_then(|c| c.column());
        match column.map(String::as_str) {
            Some("id") => {
                if matches!(value, Value::Id(id) if !crate::value::identity_fits(id)) {
                    validate_address(schema, table, value)?;
                } else {
                    crate::value::validate_identities(value)?;
                }
            }
            Some(name) => match schema.table(table).and_then(|t| t.columns.get(name)) {
                Some(kind) => validate_typed_identities(schema, kind, value)?,
                None => crate::value::validate_identities(value)?,
            },
            None => crate::value::validate_identities(value)?,
        }
    }
    Ok(())
}
