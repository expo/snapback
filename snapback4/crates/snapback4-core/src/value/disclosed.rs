//! The sole row-pricing capability on principal-visible ledgers.
// @ref LLP 3000.015#1 — projection precedes pricing, copying and defaults.
use super::Value;
use crate::{engine::SystemAccess, schema::{ColumnDefault, Table}};

/// A projection plan. The stored image is private, cannot be dereferenced and
/// cannot enter a row allocation helper. Only visible fields can be inspected.
/// Consuming the plan builds that image, including its missing-field defaults.
///
/// ```compile_fail
/// use snapback4_core::{Value, rows::word_heap, schema::Table};
/// fn raw(row: &Value, table: &Table) { word_heap::materialize(row, table); }
/// ```
/// ```compile_fail
/// use snapback4_core::Value;
/// fn raw(row: &Value) -> u64 { row.heap_bytes() }
/// ```
/// ```compile_fail
/// use snapback4_core::{Value, rows::word_heap};
/// fn raw(row: &Value) -> u64 { word_heap::value(row) }
/// ```
/// ```compile_fail
/// use snapback4_core::{Value, rows::word_heap};
/// fn raw(row: &Value) -> u64 { word_heap::object_copy(row) }
/// ```
/// ```compile_fail
/// use snapback4_core::{Value, engine::write};
/// fn raw(row: &Value) -> u64 { write::supplied_heap(row) }
/// ```
pub struct Disclosed<'a> {
    row: Value,
    table: &'a Table,
    viewer: Option<String>,
    system: bool,
    public: bool,
}

impl Table {
    pub fn project_fields(&self, row: Value, viewer: Option<&str>) -> Disclosed<'_> {
        Disclosed { row, table: self, viewer: if self.written_by.is_empty() { None } else { viewer.map(str::to_owned) }, system: false, public: false }
    }

    /// Maintenance runs on its own Runner/Meter, never on a reader's receipt.
    pub fn system_fields(&self, row: Value, _: &SystemAccess) -> Disclosed<'_> {
        Disclosed { row, table: self, viewer: None, system: true, public: false }
    }
}

impl Disclosed<'_> {
    /// Authored results omit engine-recorded attribution; delivery retains it.
    pub fn for_query(mut self) -> Self { self.public = true; self }

    pub fn field_heap(&self, field: &str) -> u64 {
        if !self.visible(field) { return 0; }
        self.row.field(field).ok().map_or_else(|| match self.table.defaults.get(field) {
            Some(ColumnDefault::Literal(value)) => value.retained_heap(), _ => 0,
        }, Value::retained_heap)
    }

    fn visible(&self, field: &str) -> bool {
        if self.public && self.table.recorded.contains_key(field) { return false; }
        self.system || !self.table.written_by.get(field).is_some_and(|a| !a.audience
            && !self.viewer.as_ref().is_some_and(|viewer| self.row.field(&a.owner).ok().or_else(|| match self.table.defaults.get(&a.owner) {
                Some(ColumnDefault::Literal(value)) => Some(value), _ => None,
            }).and_then(|v|v.as_str().ok()) == Some(viewer.as_str())))
    }

    pub fn heap_bytes(&self) -> u64 {
        let Ok(fields) = self.row.as_object() else { return self.row.retained_heap(); };
        40 + fields.iter().filter(|(name, _)| self.visible(name))
            .map(|(name, value)| 80 + name.capacity() as u64 + value.retained_heap()).sum::<u64>()
            + self.table.columns.iter().filter(|(name,kind)| self.visible(name) && !fields.contains_key(*name)
                && (kind.is_optional() || self.table.defaults.contains_key(*name) || self.table.maintained.contains_key(*name)))
                .map(|(name,_)|80 + name.len() as u64 + self.field_heap(name)).sum::<u64>()
    }

    /// Copy only the disclosed fields. No hidden value's length is inspected.
    pub fn projection_heap(&self) -> u64 {
        let Ok(fields) = self.row.as_object() else { return 0; };
        if self.table.written_by.keys().chain(self.table.recorded.keys()).all(|name| self.visible(name)) { return 0; }
        40 + fields.iter().filter(|(name, _)| self.visible(name))
            .map(|(name, value)| 80 + name.len() as u64 + value.clone_heap_bytes()).sum::<u64>()
    }

    pub fn copy_heap(&self) -> u64 {
        use crate::rows::word_heap as h;
        self.row.as_object().map_or(0, |fields| h::slots::<usize>(2)
            + fields.iter().filter(|(name,_)|self.visible(name)).map(|(name,value)|h::node::<String,Value>() + h::text(name) + h::scalar(value)).sum::<u64>())
    }

    pub fn materialization_heap(&self) -> u64 {
        use crate::rows::word_heap as h;
        let Ok(fields) = self.row.as_object() else { return 0; };
        let missing = self.table.columns.iter().filter(|(name, _)| self.visible(name) && !fields.contains_key(*name));
        if missing.clone().next().is_none() { return 0; }
        let mut len = fields.keys().filter(|name| self.visible(name)).count();
        let mut bytes = h::slots::<usize>(2) + h::node::<String, Value>() * len as u64
            + fields.iter().filter(|(name, _)| self.visible(name)).map(|(name,v)| h::text(name) + h::scalar(v)).sum::<u64>();
        for (name, kind) in missing {
            if kind.is_optional() || self.table.defaults.contains_key(name) || self.table.maintained.contains_key(name) {
                bytes += h::insertion::<String, Value>(len) + h::text(name);
                if let Some(ColumnDefault::Literal(v)) = self.table.defaults.get(name) { bytes += h::scalar(v); }
                len += 1;
            }
        }
        bytes
    }

    pub fn into_value(self) -> Value {
        let Ok(fields) = self.row.as_object() else { return self.row; };
        let hidden = fields.keys().any(|name| !self.visible(name));
        let defaults: Vec<_> = self.table.columns.iter().filter(|(name, _)| self.visible(name) && !fields.contains_key(*name))
            .filter_map(|(name,kind)| {
                let value = if self.table.maintained.contains_key(name) { Value::Int(0) }
                    else if kind.is_optional() { Value::Null }
                    else if let Some(ColumnDefault::Literal(value)) = self.table.defaults.get(name) { value.clone() }
                    else { return None };
                Some((name.clone(),value))
            }).collect();
        let mut row = if hidden {
            let projected = fields.iter().filter(|(name,_)| self.visible(name)).map(|(name,value)|(name.clone(),value.clone())).collect();
            if matches!(self.row,Value::Map(_)) { Value::Map(projected) } else { Value::Row(projected) }
        } else { self.row };
        if !defaults.is_empty() && let Value::Row(fields) | Value::Map(fields) = &mut row {
            fields.extend(defaults);
        }
        row
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{ColumnType,FieldAuthority,public_table};
    use std::collections::BTreeMap;
    #[test]
    fn projection_defaults_and_physical_private_omission_are_stable() {
        let mut table = public_table(BTreeMap::from([("id".into(),ColumnType::Id),("owner".into(),ColumnType::Principal),
            ("secret".into(),ColumnType::Text { max:1000000 }),("extra".into(),ColumnType::Optional(Box::new(ColumnType::Int)))]),BTreeMap::new());
        table.written_by.insert("secret".into(),FieldAuthority {owner:"owner".into(),audience:false});
        table.defaults.insert("secret".into(),ColumnDefault::Literal(Value::String("private default".into())));
        table.defaults.insert("owner".into(),ColumnDefault::Literal(Value::Id("bob".into())));
        let mut observations = Vec::new();
        for secret in [None,Some(""),Some("large private content")] {
            let mut fields = BTreeMap::from([("id".into(),Value::Id("row".into()))]);
            if let Some(secret) = secret { fields.insert("secret".into(),Value::String(secret.into())); }
            let raw = Value::Row(fields.into());
            let disclosed = table.project_fields(raw.clone(),Some("alice"));
            let price = (disclosed.heap_bytes(),disclosed.projection_heap(),disclosed.materialization_heap());
            let value = disclosed.into_value();
            assert_eq!(value.field("extra").unwrap(),&Value::Null);
            assert!(value.field("secret").is_err());
            observations.push((price,value));
            let own = table.project_fields(raw,Some("bob")).into_value();
            assert_eq!(own.field("secret").unwrap().as_str().unwrap(),secret.unwrap_or("private default"));
        }
        assert!(observations.windows(2).all(|pair|pair[0]==pair[1]));
    }
}
