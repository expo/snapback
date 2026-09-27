//! A field-projection plan; retained pricing additionally requires row authority.
// @ref LLP 3000.015#1 — projection precedes pricing, copying and defaults.
use super::Value;
use crate::engine::authorized_point::RowAuthorization;
use crate::{engine::runner::SystemAccess, schema::{ColumnDefault, Table}};

impl Table {
    // @ref LLP 3000.015#1 — this price uses schema literals only, never a
    // witness's stored values. Protected rule scopes restore internal charges,
    // so even a public witness must reserve possible adopted defaults up front.
    pub(crate) fn witness_default_reservation(&self) -> u64 {
        use crate::rows::word_heap as h;
        let columns = self.columns.len();
        let mut bytes = 0_u64;
        if self.defaults.is_empty() { return 0; }
        for (name, kind) in &self.columns {
            if kind.is_optional() { continue; }
            let Some(ColumnDefault::Literal(value)) = self.defaults.get(name) else { continue };
            bytes = bytes.saturating_add(h::insertion::<String, Value>(columns) + h::text(name))
                .saturating_add(super::scalar_copy(value));
        }
        if bytes == 0 { 0 } else { bytes.saturating_add(h::slots::<usize>(2) + h::node::<String, Value>() * columns as u64) }
    }

}

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
/// A fabricated context cannot mint raw pricing authority.
/// ```compile_fail
/// use snapback4_core::{Context, Value, meter::{Meter, Cut}, Ceilings};
/// let raw = Value::String("private".into());
/// let token = Context::system().system_access().unwrap();
/// let mut caller = Meter::new(Ceilings::default(), Cut::Abort);
/// caller.heap(raw.heap_bytes(&token)).unwrap();
/// ```
/// ```compile_fail
/// use snapback4_core::engine::runner::SystemAccess;
/// let fabricated = SystemAccess(());
/// ```
/// ```compile_fail
/// use snapback4_core::engine::authorized_point::AuthorizedRow;
/// use snapback4_core::{Value, schema::Table};
/// fn fabricate(table: &Table, raw: Value) {
///     let authorized = AuthorizedRow(table.project_fields(raw, Some("alice")));
/// }
/// ```
/// A field projection alone has no row-read evidence.
/// ```compile_fail
/// use snapback4_core::{Value, schema::Table, meter::Meter};
/// fn unproven(table: &Table, raw: Value, caller: &mut Meter) {
///     caller.heap(table.project_fields(raw, Some("alice")).heap_bytes()).unwrap();
/// }
/// ```
/// Even with internal-scope evidence, a raw owned field produces an opaque
/// internal price which the caller-ledger heap API cannot accept.
/// ```compile_fail
/// use snapback4_core::{Value, engine::Authorization, meter::Meter};
/// fn raw_owned_field(raw: &Value, scope: &Authorization, caller: &mut Meter) {
///     caller.heap(raw.field("secret").unwrap().clone_heap_bytes(scope)).unwrap();
/// }
/// ```
/// A closure cannot redirect an internal price to a captured caller ledger.
/// ```compile_fail
/// use snapback4_core::{Value, engine::InternalLedger, meter::Meter};
/// fn captured(raw: &Value, internal: &mut InternalLedger, caller: &mut Meter) {
///     internal.run(|_physical, scope| {
///         raw.field("secret").unwrap().clone_heap_bytes(scope)
///             .charge(caller, scope).unwrap();
///     });
/// }
/// ```
/// Internal counters cannot relay a raw price to a captured caller ledger.
/// ```compile_fail
/// use snapback4_core::{Value, RuntimeError, engine::InternalLedger, meter::Meter};
/// fn counter_delta(raw: &Value, internal: &mut InternalLedger, caller: &mut Meter) -> Result<(), RuntimeError> {
///     internal.run(|physical, scope| {
///         let before = physical.used.heap_bytes;
///         raw.clone_heap_bytes(scope).charge(physical, scope)?;
///         caller.heap(physical.used.heap_bytes - before)?;
///         Ok(())
///     })
/// }
/// ```
/// Consuming a ledger cannot export its counters either.
/// ```compile_fail
/// use snapback4_core::{Value, engine::InternalLedger, meter::Meter};
/// fn exported(raw: &Value, mut internal: InternalLedger, caller: &mut Meter) {
///     internal.run(|physical, scope| raw.clone_heap_bytes(scope).charge(physical, scope)).unwrap();
///     caller.heap(internal.into_meter().used.heap_bytes).unwrap();
/// }
/// ```
/// An unscoped raw scalar price is unavailable too.
/// ```compile_fail
/// use snapback4_core::{Value, meter::Meter};
/// fn raw_owned_field(raw: &Value, caller: &mut Meter) {
///     caller.heap(raw.field("secret").unwrap().clone_heap_bytes()).unwrap();
/// }
/// ```
/// Raw scalar/key helpers cannot bypass row authorization.
/// ```compile_fail
/// use snapback4_core::{Value, rows::word_heap, meter::Meter};
/// fn raw(row: &Value, caller: &mut Meter) {
///     caller.heap(word_heap::scalar(row.field("secret").unwrap())).unwrap();
/// }
/// ```
/// ```compile_fail
/// use snapback4_core::{Value, rows::word_heap, meter::Meter};
/// fn raw(row: &Value, caller: &mut Meter) {
///     caller.heap(word_heap::values(&[row.field("secret").unwrap().clone()])).unwrap();
/// }
/// ```
/// Store decoder accounting requires real scope evidence before access.
/// ```compile_fail
/// use snapback4_core::{rows::{Rows,Bounds,Dir}, meter::Meter};
/// fn raw_store(rows: &dyn Rows, caller: &mut Meter) {
///     rows.scan_metered("records","byId",&[],&Bounds::default(),Dir::Asc,1,caller).unwrap();
/// }
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
    pub(crate) fn system_fields(&self, row: Value, _: &SystemAccess) -> Disclosed<'_> {
        Disclosed { row, table: self, viewer: None, system: true, public: false }
    }
}

impl Disclosed<'_> {
    /// Authored results omit engine-recorded attribution; delivery retains it.
    pub fn for_query(mut self) -> Self { self.public = true; self }

    fn visible(&self, field: &str) -> bool {
        // Captures, deadlines and event slots are stripped by recorded::public_image
        // at emission, so a timeline transition's own reads still see them.
        if self.public && (self.table.recorded.contains_key(field) || self.table.ephemeral.is_some() && field == crate::schema::through::DEADLINE) { return false; }
        if self.system { return true; }
        let Some(authority) = self.table.written_by.get(field) else { return true; };
        if authority.audience { return true; }
        let Some(viewer) = &self.viewer else { return false; };
        let owner = self.row.as_object().ok().and_then(|row| row.get(&authority.owner)).or_else(|| match self.table.defaults.get(&authority.owner) {
            Some(ColumnDefault::Literal(value)) => Some(value), _ => None,
        });
        matches!(owner, Some(Value::String(value) | Value::Id(value)) if value == viewer)
    }

    pub(crate) fn scalar_heap(&self, field: &str, _: &RowAuthorization) -> u64 {
        if !self.visible(field) { return 0; }
        self.row.as_object().ok().and_then(|row| row.get(field)).map_or(0, super::scalar_copy)
    }

    pub(crate) fn heap_bytes(&self, _: &RowAuthorization) -> u64 { self.heap_bytes_inner() }

    pub(super) fn heap_bytes_inner(&self) -> u64 {
        let Ok(fields) = self.row.as_object() else { return self.row.retained_heap(); };
        let mut bytes = 40;
        for (name, value) in fields {
            if self.visible(name) { bytes += 80 + name.capacity() as u64 + value.retained_heap(); }
        }
        for (name, kind) in &self.table.columns {
            if self.visible(name) && !fields.contains_key(name)
                && (kind.is_optional() || self.table.defaults.contains_key(name) || self.table.maintained.contains_key(name)) {
                bytes += 80 + name.len() as u64 + match self.table.defaults.get(name) {
                    Some(ColumnDefault::Literal(value)) => value.retained_heap(), _ => 0,
                };
            }
        }
        bytes
    }

    /// Copy only the disclosed fields. No hidden value's length is inspected.
    pub(crate) fn projection_heap(&self, _: &RowAuthorization) -> u64 { self.projection_heap_inner() }

    pub(super) fn projection_heap_inner(&self) -> u64 {
        let Ok(fields) = self.row.as_object() else { return 0; };
        if self.table.written_by.keys().all(|name| self.visible(name)) && self.table.recorded.keys().all(|name| self.visible(name)) { return 0; }
        let mut bytes = 40;
        for (name, value) in fields {
            if self.visible(name) { bytes += 80 + name.len() as u64 + value.clone_heap(); }
        }
        bytes
    }

    pub(crate) fn materialization_heap(&self, _: &RowAuthorization) -> u64 { self.materialization_heap_inner() }

    pub(super) fn materialization_heap_inner(&self) -> u64 {
        use crate::rows::word_heap as h;
        let Ok(fields) = self.row.as_object() else { return 0; };
        if !self.table.columns.keys().any(|name| self.visible(name) && !fields.contains_key(name)) { return 0; }
        let mut len = 0;
        let mut bytes = h::slots::<usize>(2);
        for (name, value) in fields {
            if self.visible(name) {
                bytes += h::node::<String, Value>() + h::text(name) + super::scalar_copy(value);
                len += 1;
            }
        }
        for (name, kind) in &self.table.columns {
            if !self.visible(name) || fields.contains_key(name) { continue; }
            if kind.is_optional() || self.table.defaults.contains_key(name) || self.table.maintained.contains_key(name) {
                bytes += h::insertion::<String, Value>(len) + h::text(name);
                if let Some(ColumnDefault::Literal(v)) = self.table.defaults.get(name) { bytes += super::scalar_copy(v); }
                len += 1;
            }
        }
        bytes
    }

    pub fn charge_materialization_internal(&self, meter: &mut crate::engine::InternalMeter<'_>, scope: &crate::engine::Authorization) -> Result<(), crate::error::RuntimeError> {
        super::InternalPrice(self.materialization_heap_inner()).charge(meter,scope)
    }

    pub fn charge_copy_internal(&self, meter: &mut crate::engine::InternalMeter<'_>, scope: &crate::engine::Authorization) -> Result<(), crate::error::RuntimeError> {
        use crate::rows::word_heap as h;
        let mut bytes = 0;
        if let Ok(fields) = self.row.as_object() {
            bytes = h::slots::<usize>(2);
            for (name, value) in fields {
                if self.visible(name) { bytes += h::node::<String, Value>() + h::text(name) + super::scalar_copy(value); }
            }
        }
        super::InternalPrice(bytes).charge(meter,scope)
    }

    pub fn into_value(self) -> Value {
        let Ok(fields) = self.row.as_object() else { return self.row; };
        let hidden = fields.keys().any(|name| !self.visible(name));
        let mut row = if hidden {
            let projected = fields.iter().filter(|(name,_)| self.visible(name)).map(|(name,value)|(name.clone(),value.clone())).collect();
            if matches!(self.row,Value::Map(_)) { Value::Map(projected) } else { Value::Row(projected) }
        } else { self.row.clone() };
        // Keep the original image for visibility decisions while filling the
        // result directly. The materialization prepay already covers its map
        // copy; no temporary vector of cloned defaults is needed.
        if let Value::Row(fields) | Value::Map(fields) = &mut row {
            for (name, kind) in &self.table.columns {
                if fields.contains_key(name) || !self.visible(name) { continue; }
                let value = if self.table.maintained.contains_key(name) { Value::Int(0) }
                    else if kind.is_optional() { Value::Null }
                    else if let Some(ColumnDefault::Literal(value)) = self.table.defaults.get(name) { value.clone() }
                    else { continue };
                fields.insert(name.clone(), value);
            }
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
            let price = (disclosed.heap_bytes_inner(),disclosed.projection_heap_inner(),disclosed.materialization_heap_inner());
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
