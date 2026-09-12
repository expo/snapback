//! Day two (LLP 2000.000 §7.3, LLP 1020 Part A): what one schema may become
//! next. Widening is additive and applies in place; checked narrowing needs
//! the data to fit; a rule change re-derives partitions; a rename is a drop
//! plus an add and says so.

use crate::schema::{ColumnType, Schema};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Change {
    /// Nothing a device holds changes shape.
    Additive,
    /// A stored value may not fit; the store is checked before adoption.
    Narrowing,
    /// Rows a device holds may no longer be its to hold: partitions re-derive.
    RuleChange,
    /// Data is lost: needs an explicit plan.
    Destructive,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Step {
    pub path: String,
    pub change: Change,
    pub message: String,
}

/// Classify the difference between two schemas.
pub fn classify(from: &Schema, to: &Schema) -> Vec<Step> {
    let mut steps = Vec::new();
    for (name, old) in &from.tables {
        let path = format!("tables.{name}");
        let Some(new) = to.tables.get(name) else {
            steps.push(Step { path, change: Change::Destructive, message: format!("table {name} is removed; its rows are lost") });
            continue;
        };
        for (column, old_kind) in &old.columns {
            let cpath = format!("{path}.columns.{column}");
            match new.columns.get(column) {
                None => steps.push(Step { path: cpath, change: Change::Destructive, message: format!("column {name}.{column} is removed; its values are lost") }),
                Some(new_kind) if new_kind == old_kind => {}
                Some(new_kind) => steps.push(Step { path: cpath, change: column_change(old_kind, new_kind), message: format!("column {name}.{column} changes from {old_kind} to {new_kind}") }),
            }
        }
        for (column, kind) in &new.columns {
            if !old.columns.contains_key(column) {
                let change = if kind.is_optional() { Change::Additive } else { Change::Narrowing };
                steps.push(Step { path: format!("{path}.columns.{column}"), change, message: if kind.is_optional() { format!("column {name}.{column} is added as optional") } else { format!("column {name}.{column} is added as required; existing rows must already carry it") } });
            }
        }
        for (index, definition) in &new.indexes {
            match old.indexes.get(index) {
                None => steps.push(Step { path: format!("{path}.indexes.{index}"), change: if definition.unique { Change::Narrowing } else { Change::Additive }, message: format!("index {name}.{index} is added{}", if definition.unique { "; existing rows must be unique under it" } else { "" }) }),
                Some(old_definition) if old_definition != definition => steps.push(Step { path: format!("{path}.indexes.{index}"), change: if definition.unique { Change::Narrowing } else { Change::Additive }, message: format!("index {name}.{index} is redefined and rebuilt") }),
                _ => {}
            }
        }
        if old.rules != new.rules {
            steps.push(Step { path: format!("{path}.rules"), change: Change::RuleChange, message: format!("{name}'s rules change; every device re-derives its partition of {name}") });
        }
        if old.sync != new.sync {
            steps.push(Step { path: format!("{path}.sync"), change: Change::RuleChange, message: format!("{name}'s sync declaration changes; every device re-derives its partition of {name}") });
        }
        if old.constraints != new.constraints {
            steps.push(Step { path: format!("{path}.constraints"), change: Change::Narrowing, message: format!("{name}'s constraints change; existing rows must satisfy them") });
        }
    }
    for name in to.tables.keys() {
        if !from.tables.contains_key(name) {
            steps.push(Step { path: format!("tables.{name}"), change: Change::Additive, message: format!("table {name} is added") });
        }
    }
    if from.maintains != to.maintains {
        steps.push(Step { path: "maintains".into(), change: Change::Additive, message: "maintained aggregates change and are rebuilt".into() });
    }
    steps
}

fn column_change(old: &ColumnType, new: &ColumnType) -> Change {
    match (old, new) {
        (ColumnType::Optional(a), ColumnType::Optional(b)) => column_change(a, b),
        // Optional becoming required narrows; required becoming optional widens.
        (ColumnType::Optional(a), b) => worse(Change::Narrowing, column_change(a, b)),
        (a, ColumnType::Optional(b)) => worse(Change::Additive, column_change(a, b)),
        (ColumnType::Text { max: a }, ColumnType::Text { max: b }) | (ColumnType::Bytes { max: a }, ColumnType::Bytes { max: b }) | (ColumnType::Json { max_bytes: a }, ColumnType::Json { max_bytes: b }) => {
            if b >= a { Change::Additive } else { Change::Narrowing }
        }
        (ColumnType::Enum { variants: a }, ColumnType::Enum { variants: b }) => {
            if a.iter().all(|v| b.contains(v)) { Change::Additive } else { Change::Narrowing }
        }
        (ColumnType::List { of: a, max: am }, ColumnType::List { of: b, max: bm }) => {
            if a == b && bm >= am { Change::Additive } else { Change::Narrowing }
        }
        _ => Change::Destructive,
    }
}

fn rank(change: &Change) -> u8 {
    match change {
        Change::Additive => 0,
        Change::RuleChange => 1,
        Change::Narrowing => 2,
        Change::Destructive => 3,
    }
}

fn worse(a: Change, b: Change) -> Change {
    if rank(&b) > rank(&a) { b } else { a }
}

/// The worst change in a set of steps.
pub fn worst(steps: &[Step]) -> Change {
    steps.iter().map(|step| &step.change).max_by_key(|change| rank(change)).cloned().unwrap_or(Change::Additive)
}
