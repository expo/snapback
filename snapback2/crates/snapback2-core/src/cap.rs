//! Cardinality invariants share index grouping at admission, writes, and succession.
// @ref LLP 1017#22-the-semantics-the-engines-unchanged — omitted optional fields join null.

use crate::certificate::{CheckError, WriteKind};
use crate::ir::Expr;
use crate::schema::{Constraint, Index, Schema, Table};
use crate::value::Value;
use std::collections::BTreeSet;

pub(crate) fn group_key(row: &Value, by: &[String]) -> Vec<Value> {
    by.iter()
        .map(|field| row.field(field).cloned().unwrap_or(Value::Null))
        .collect()
}

pub(crate) fn enforcement_index<'a>(
    table: &'a Table,
    by: &[String],
) -> Option<(&'a String, &'a Index)> {
    table
        .indexes
        .iter()
        .find(|(_, index)| index.columns.starts_with(by))
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
