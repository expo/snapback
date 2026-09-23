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
    #[serde(default, skip_serializing_if = "zero")]
    pub offset: i64,
}

impl CalendarKey {
    pub fn value(&self, row: &Value) -> Value {
        if self.column.contains('.') && !matches!(row.field(&self.column), Ok(Value::Int(_))) { return Value::Null; }
        Value::Int(calendar_ordinal(row.field(&self.column).ok().and_then(|v| v.as_int().ok()).unwrap_or(0), self.millis, self.offset))
    }
    pub fn validate(&self, source: &Table) -> Result<(), String> {
        if !source.columns.get(&self.column).is_some_and(|kind| kind == &ColumnType::Time
            || (source.recorded.contains_key(&self.column) && kind.required() == &ColumnType::Time)) || self.millis <= 0 || self.offset < 0 || self.offset >= self.millis
            || !matches!(self.function.as_str(), "day" | "hour" | "bucket")
            || (self.function == "day" && self.millis != 86_400_000) || (self.function == "hour" && self.millis != 3_600_000) {
            return Err("computed time keys need a required time column, a positive calendar duration and a nonnegative offset smaller than the period".into());
        }
        Ok(())
    }
}

fn zero(value: &i64) -> bool { *value == 0 }

// @ref LLP 3000.007#20.9 — anchored UTC ordinals use the existing integer key encoding on every host; zero offsets retain the old serialized form.
pub fn calendar_ordinal(at: i64, millis: i64, offset: i64) -> i64 {
    ((i128::from(at) - i128::from(offset)).div_euclid(i128::from(millis))) as i64
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
    pub fn selected(&self, image: &Value) -> bool { if self.private.is_some() && self.by.iter().any(|f| matches!(image.field(f), Err(_) | Ok(Value::Null))) { return false; } self.filter.as_ref().is_none_or(|p| p.matches(image)) }
    pub fn source_key(&self, image: &Value) -> Vec<Value> {
        self.by.iter().map(|field| match self.computed.get(field) {
            Some(key) => key.value(image),
            None => image.field(field).cloned().unwrap_or(Value::Null),
        }).collect()
    }
    pub fn bare_key(&self, field: &str) -> bool { self.by.iter().any(|f| f == field) && !self.computed.contains_key(field) }
    pub fn evaluation_steps(&self) -> u64 { self.filter.as_ref().map_or(0, Predicate::steps) + self.by.len() as u64 + self.computed.len() as u64 + self.computed.values().filter(|key| key.offset != 0).count() as u64 }
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
            key.validate(source)?;
        }
        Ok(())
    }
}

impl crate::schema::Schema {
    // @ref LLP 3000.007#20.9 — every expiring maintain has a selected physical contribution index, including raw schema callers.
    pub fn prepare_contribution_indexes(&mut self) {
        for table in self.tables.values_mut() {
            table.indexes.retain(|_, index| !matches!(index.components.first(), Some(crate::schema::IndexComponent::Contribution(_))));
        }
        for maintain in &self.maintains {
            if let Some(source) = self.tables.get_mut(&maintain.source).filter(|source| source.expire.is_some()) {
                source.indexes.insert(maintain.contribution_index(), crate::schema::Index {
                    components: vec![crate::schema::IndexComponent::Contribution(Box::new(maintain.clone()))], unique: false,
                });
            }
        }
    }

    // @ref LLP 3000.007#20.9 — subset delivery is not proof that a public aggregate read is complete.
    pub fn maintain_subset_unknown(&self, target: &str) -> bool {
        self.maintain_for(target).and_then(|m| self.table(&m.source)).is_some_and(|source|
            source.rules.read.is_uniformly_readable() && source.sync.as_ref().is_some_and(|s| s.audience != crate::schema::Audience::Public))
    }
}
