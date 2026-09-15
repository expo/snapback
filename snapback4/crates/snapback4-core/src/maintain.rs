//! Row-local contributions shared by native and wasm writes, expiry and adoption.
use crate::schema::{ColumnType, Maintain, Table};
use crate::value::Value;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CalendarKey {
    pub function: String,
    pub column: String,
    pub millis: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Operand { Field(String), Literal(Value) }
impl Operand {
    fn value<'a>(&'a self, row: &'a Value) -> &'a Value {
        match self { Self::Field(field) => row.field(field).unwrap_or(&Value::Null), Self::Literal(value) => value }
    }
    fn fields(&self, out: &mut BTreeSet<String>) { if let Self::Field(field) = self { out.insert(field.clone()); } }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Predicate {
    Bool(bool), Field(String), Not(Box<Predicate>), And(Box<Predicate>, Box<Predicate>), Or(Box<Predicate>, Box<Predicate>),
    Compare { op: String, left: Operand, right: Operand },
}
impl Predicate {
    pub fn matches(&self, row: &Value) -> bool {
        match self {
            Self::Bool(value) => *value,
            Self::Field(field) => matches!(row.field(field), Ok(Value::Bool(true))),
            Self::Not(value) => !value.matches(row),
            Self::And(a, b) => a.matches(row) && b.matches(row),
            Self::Or(a, b) => a.matches(row) || b.matches(row),
            Self::Compare { op, left, right } => {
                let (a, b) = (left.value(row), right.value(row));
                match op.as_str() { "=" => a == b, "!=" => a != b, "<" => a.total_cmp(b).is_lt(), "<=" => !a.total_cmp(b).is_gt(), ">" => a.total_cmp(b).is_gt(), ">=" => !a.total_cmp(b).is_lt(), _ => false }
            }
        }
    }
    pub fn steps(&self) -> u64 {
        match self { Self::Not(p) => 1 + p.steps(), Self::And(a,b) | Self::Or(a,b) => 1 + a.steps() + b.steps(), Self::Compare { .. } => 3, _ => 1 }
    }
    pub fn fields(&self, out: &mut BTreeSet<String>) {
        match self {
            Self::Field(field) => { out.insert(field.clone()); }
            Self::Not(p) => p.fields(out), Self::And(a,b) | Self::Or(a,b) => { a.fields(out); b.fields(out); }
            Self::Compare { left, right, .. } => { left.fields(out); right.fields(out); }
            Self::Bool(_) => {}
        }
    }
}

// @ref LLP 3000.007#20.9 — one evaluator supplies filters and Euclidean calendar keys on every host and lifecycle path.
impl Maintain {
    pub fn selected(&self, image: &Value) -> bool { self.filter.as_ref().is_none_or(|p| p.matches(image)) }
    pub fn source_key(&self, image: &Value) -> Vec<Value> {
        self.by.iter().map(|field| match self.computed.get(field) {
            Some(key) => Value::Int(image.field(&key.column).ok().and_then(|v| v.as_int().ok()).unwrap_or(0).div_euclid(key.millis)),
            None => image.field(field).cloned().unwrap_or(Value::Null),
        }).collect()
    }
    pub fn bare_key(&self, field: &str) -> bool { self.by.iter().any(|f| f == field) && !self.computed.contains_key(field) }
    pub fn evaluation_steps(&self) -> u64 { self.filter.as_ref().map_or(0, Predicate::steps) + self.by.len() as u64 + self.computed.len() as u64 }
    pub fn dependencies(&self) -> BTreeSet<String> {
        let mut fields = BTreeSet::new();
        if let Some(p) = &self.filter { p.fields(&mut fields); }
        for field in &self.by { fields.insert(self.computed.get(field).map_or(field, |key| &key.column).clone()); }
        if let crate::schema::MaintainKind::Sum { of } = &self.kind { fields.insert(of.clone()); }
        fields
    }
    pub fn contribution_index(&self) -> String { format!("$contribution:{}", self.target) }
    pub fn source_scan<'a>(&self, source: &'a Table, group: &[Value]) -> (&'a str, Vec<Value>) {
        let name = self.contribution_index();
        if let Some((name, _)) = source.indexes.get_key_value(&name) { return (name, group.to_vec()); }
        source.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().starts_with(&self.by))
            .map(|(name, _)| (name.as_str(), group.to_vec())).unwrap_or(("byId", Vec::new()))
    }
    pub fn validate_keys(&self, source: &Table) -> Result<(), String> {
        for key in self.computed.values() {
            if source.columns.get(&key.column) != Some(&ColumnType::Time) || key.millis <= 0
                || !matches!(key.function.as_str(), "day" | "hour" | "bucket")
                || (key.function == "day" && key.millis != 86_400_000) || (key.function == "hour" && key.millis != 3_600_000) {
                return Err("computed maintain keys need a required time column and a positive calendar duration".into());
            }
        }
        Ok(())
    }
}
