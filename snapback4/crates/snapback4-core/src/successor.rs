//! Day two (LLP 2000.000 §7.3, LLP 1020 Part A): what one schema may become
//! next. Widening is additive and applies in place; checked narrowing needs
//! the data to fit; a rule change re-derives partitions; a rename is a drop
//! plus an add and says so.

use crate::schema::{Constraint, ColumnDefault, ColumnType, Schema};
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

impl Step {
    pub fn rewrite(&self, schema: &Schema) -> String {
        if self.path.starts_with("maintains[") { return "keep the prior maintain definition, or repair source contributions before adopting this filter, key or sum".into(); }
        let path: Vec<_> = self.path.split('.').collect();
        match path.as_slice() {
            ["tables", table, "columns", column] => {
                let kind = &schema.tables[*table].columns[*column];
                if self.message.contains(" is added ") {
                    format!("{column}: {} ? or {column}: {} default <literal>; otherwise backfill existing rows before making the column required", kind.required(), kind.required())
                } else {
                    format!("keep {column}'s previous type and default, or repair existing values before adopting {column}: {kind}")
                }
            }
            ["tables", _, "indexes", index] => format!("make {index} non-unique, or repair duplicate keys before adopting it"),
            ["tables", table, ..] => format!("keep {table}'s current constraints, or repair existing rows before adopting the new constraints"),
            _ => "keep the current schema, or repair existing rows before adopting this change".into(),
        }
    }

    pub fn refusal(&self, schema: &Schema) -> crate::error::RuntimeError {
        crate::error::RuntimeError::Structural { code: "E_ADOPT", message: format!("{}\n  rewrite: {}", self.message, self.rewrite(schema)) }
    }
}

/// Classify the difference between two schemas.
pub fn classify(from: &Schema, to: &Schema) -> Vec<Step> {
    let mut steps = Vec::new();
    for (name, old) in from.visible_tables() {
        let path = format!("tables.{name}");
        let Some(new) = to.tables.get(name) else {
            steps.push(Step { path, change: Change::Destructive, message: format!("table {name} is removed; its rows are lost") });
            continue;
        };
        if from.maintain_for(name).is_some() && to.maintain_for(name).is_some() {
            if old.rules != new.rules || old.sync != new.sync {
                steps.push(Step { path: format!("{path}.rules"), change: Change::RuleChange, message: format!("{name}'s aggregate audience changes; every device re-derives its partition") });
            }
            continue;
        }
        for (column, old_kind) in &old.columns {
            let cpath = format!("{path}.columns.{column}");
            match new.columns.get(column) {
                None => steps.push(Step { path: cpath, change: Change::Destructive, message: format!("column {name}.{column} is removed; its values are lost") }),
                Some(new_kind) if new_kind == old_kind => {
                    if !new_kind.is_optional() && old.defaults.get(column) != new.defaults.get(column) {
                        steps.push(Step { path: cpath, change: Change::Narrowing, message: format!("column {name}.{column} changes its default; existing rows must fit the new definition") });
                    }
                }
                Some(new_kind) => steps.push(Step { path: cpath, change: column_change(old_kind, new_kind), message: format!("column {name}.{column} changes from {old_kind} to {new_kind}") }),
            }
        }
        for (column, kind) in &new.columns {
            if !old.columns.contains_key(column) {
                // @ref LLP 3000.007#18.3 — literal defaults describe old images on every host; contextual defaults belong to the write
                let (change, message) = match (kind.is_optional(), new.defaults.get(column)) {
                    (true, _) => (Change::Additive, format!("column {name}.{column} is added as optional")),
                    (false, Some(ColumnDefault::Literal(value))) => {
                        let value = crate::wire::to_json(value);
                        (Change::Additive, format!("column {name}.{column} is added with default {value}; rows written before it read {value}"))
                    }
                    (false, Some(default)) => {
                        let (word, context) = match default { ColumnDefault::Now => ("now", "clock"), _ => ("viewer", "viewer") };
                        (Change::Narrowing, format!("column {name}.{column} is added as required with default {word}; existing rows would read the adoption's {context}"))
                    }
                    (false, None) if new.maintained.contains_key(column) => (Change::Additive, format!("required maintained column {name}.{column} added; activation derives its value, missing stored fields read 0")),
                    (false, None) => (Change::Narrowing, format!("column {name}.{column} is added as required; existing rows must already carry it")),
                };
                steps.push(Step { path: format!("{path}.columns.{column}"), change, message });
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
        if old.expire != new.expire {
            steps.push(Step { path: format!("{path}.expire"), change: Change::RuleChange, message: match &new.expire { Some(column) => format!("{name} now expires at .{column}; rows already past it vanish and are swept"), None => format!("{name} no longer expires; rows past .{} stay", old.expire.as_deref().unwrap_or("")) } });
        }
        // Caps also bind materialized defaults. A new column's text default
        // is checked by the compiler; absent optionals are null. New unique
        // indexes are classified above; immutability has no old value to bind.
        let existed = |constraint: &Constraint| match constraint {
            Constraint::Unique { index } => old.indexes.contains_key(index),
            Constraint::Cap { .. } => true,
            Constraint::Immutable { fields } => fields.iter().all(|c| old.columns.contains_key(c)),
            Constraint::Text { field, .. } => old.columns.contains_key(field),
            Constraint::Capabilities(_) | Constraint::Recorded | Constraint::AppendOnly | Constraint::FinalExistsOnInsert { .. } => true,
        };
        let binding: Vec<&Constraint> = new.constraints.iter().filter(|c| existed(c)).collect();
        if old.constraints.iter().collect::<Vec<_>>() != binding {
            steps.push(Step { path: format!("{path}.constraints"), change: Change::Narrowing, message: format!("{name}'s constraints change; existing rows must satisfy them") });
        }
    }
    for name in to.visible_tables().map(|(name,_)|name) {
        if !from.tables.contains_key(name) {
            steps.push(Step { path: format!("tables.{name}"), change: Change::Additive, message: format!("table {name} is added") });
        }
    }
    // @ref LLP 3000.007#20.9 — derived changes report their declaration; activation still owns the existing atomic rebuild.
    for (position, maintain) in to.maintains.iter().enumerate() {
        let old = from.maintain_for(&maintain.target);
        let interpretation_changed = maintain_rebuild_needed(from, to, maintain);
        let indexes_changed = old.is_some_and(|_| from.tables[&maintain.target].indexes != to.tables[&maintain.target].indexes);
        if interpretation_changed || indexes_changed {
            steps.push(Step { path: format!("maintains[{position}]"), change: Change::Additive,
                message: format!("maintain {} needs a derived rebuild of its filter, keys, totals or indexes; adoption rebuilds from source rows without rewriting them", maintain.label()) });
        }
    }
    if from.schedules != to.schedules {
        steps.push(Step { path: "schedules".into(), change: Change::Additive, message: "schedules change; each fires from its next boundary".into() });
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

/// This literal-default addition can interpret held device images without
/// changing their audience, lifetime, constraints or existing column meaning.
pub fn keeps_literal_default_images(from: &Schema, to: &Schema) -> bool {
    if from.maintains != to.maintains { return false; }
    let mut added_literal = false;
    for (name, old) in from.visible_tables() {
        let Some(new) = to.table(name) else { return false };
        if new.columns.iter().any(|(column, kind)| !old.columns.contains_key(column) && !kind.is_optional()
            && !matches!(new.defaults.get(column), Some(ColumnDefault::Literal(_)))) { return false; }
        if new.indexes.iter().any(|(index, definition)| !old.indexes.contains_key(index) && definition.unique) { return false; }
        added_literal |= new.columns.iter().any(|(column, kind)| !old.columns.contains_key(column)
            && !kind.is_optional() && matches!(new.defaults.get(column), Some(ColumnDefault::Literal(_))));
        let mut projected = new.clone();
        projected.columns.retain(|column, _| old.columns.contains_key(column));
        projected.defaults.retain(|column, _| old.columns.contains_key(column));
        projected.indexes.retain(|index, _| old.indexes.contains_key(index));
        projected.constraints.retain(|constraint| match constraint {
            // The compiler checks the new field's literal against its text
            // constraint. Immutability has no previous value to constrain.
            Constraint::Text { field, .. } => old.columns.contains_key(field),
            Constraint::Immutable { fields } => fields.iter().any(|field| old.columns.contains_key(field)),
            _ => true,
        });
        if &projected != old { return false; }
    }
    added_literal
}

/// Aggregate inputs include the interpretation of absent fields, not only the
/// declaration text. Optionality can override a formerly effective default.
// @ref LLP 3000.007.001#3.11 — rebuild on resolved source dependency changes.
pub(crate) fn maintain_rebuild_needed(from: &Schema, to: &Schema, maintain: &crate::schema::Maintain) -> bool {
    maintain.row_key.as_ref().is_some_and(|k|from.table(&k.table)!=to.table(&k.table))
        || from.maintain_for(&maintain.target) != Some(maintain)
        || from.table(&maintain.source).and_then(|t| t.expire.as_ref()) != to.table(&maintain.source).and_then(|t| t.expire.as_ref())
        || maintain.dependencies().iter().any(|field| interpretation(from, &maintain.source, field) != interpretation(to, &maintain.source, field))
}

pub(crate) fn interpretation<'a>(schema: &'a Schema, table: &str, field: &str) -> Option<(Option<&'a ColumnType>, Option<&'a ColumnDefault>, Option<&'a crate::schema::RecordedField>)> {
    schema.table(table).map(|t| (t.columns.get(field), t.defaults.get(field), t.recorded.get(field)))
}
