//! A left group's delivered rows remain a device answer. This is partition
//! state, persisted with its rows, not a query cache or a public Read field.
use super::*;
use std::cell::Cell;

pub(super) const GROUPS: &str = "device:history:groups";
pub(super) const STAGED_GROUPS: &str = "device:snapshot:groups";
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(super) enum Membership { Held, Left }
pub(super) type Groups = BTreeMap<String, BTreeMap<String, Membership>>;

pub(super) fn load<T: DeviceTx>(tx: &T, key: &str) -> Result<Groups, RuntimeError> {
    tx.meta(key)?.map(|value| decoded(&value)).transpose().map(|value| value.unwrap_or_default())
}

fn key(group: &[Value]) -> Result<String, RuntimeError> {
    encoded(&group.iter().map(wire::to_json).collect::<Vec<_>>())
}

pub(super) fn row_key(table: &Table, row: &Value) -> Result<String, RuntimeError> {
    key(&audience_prefix(table).iter().map(|column| row.field(column).cloned()).collect::<Result<Vec<_>, _>>()?)
}

pub(super) fn is_left(groups: &Groups, table: &str, group: &str) -> bool {
    groups.get(table).and_then(|groups| groups.get(group)) == Some(&Membership::Left)
}

pub(super) fn events<T: DeviceTx>(tx: &T, schema: &Schema, events: &[StreamEvent], joined: &wire::HeldGroups, staged: bool) -> Result<(), RuntimeError> {
    if joined.is_empty() && !events.iter().any(|event| schema.table(&event.table).is_some_and(|table| table.leave == LeavePolicy::DeliveredHistory)) { return Ok(()); }
    let meta = if staged { STAGED_GROUPS } else { GROUPS };
    let mut groups = load(tx, meta)?;
    for event in events {
        let Some(table) = schema.table(&event.table).filter(|table| table.sync.is_some() && table.leave == LeavePolicy::DeliveredHistory) else { continue };
        match event.kind.as_str() {
            "scope" => { groups.entry(event.table.clone()).or_default().insert(key(&scope_group(table, event)?)?, Membership::Left); }
            "put" => {
                let row = wire::row_from_json(table, event.data.as_ref().ok_or_else(|| RuntimeError::Input("event row is missing".into()))?).map_err(RuntimeError::Input)?;
                groups.entry(event.table.clone()).or_default().insert(row_key(table, &row)?, Membership::Held);
            }
            _ => {}
        }
    }
    for (name, joined) in joined {
        for group in joined { groups.entry(name.clone()).or_default().insert(encoded(group)?, Membership::Held); }
    }
    tx.set_meta(meta, &encoded(&groups)?)
}

pub(super) enum Coverage<'a> { Row(&'a Value), Range(&'a str, &'a [Value]) }

// @ref LLP 3000.007#18.2 — reads and predictions consult the same persisted held/left groups, including empty groups.
pub(super) fn retained(schema: &Schema, groups: &Groups, name: &str, coverage: Coverage<'_>) -> Result<bool, RuntimeError> {
    let Some(table) = schema.table(name).filter(|table| table.sync.is_some() && table.leave == LeavePolicy::DeliveredHistory) else { return Ok(false) };
    let group = match coverage {
        Coverage::Row(row) => row_key(table, row)?,
        Coverage::Range(index, prefix) => {
            let Some(index) = table.index(index) else { return Ok(false) };
            let pinned: BTreeMap<_, _> = index.components.iter().zip(prefix).filter_map(|(part, value)| part.column().map(|column| (column, value))).collect();
            let Some(group) = audience_prefix(table).iter().map(|column| pinned.get(column).map(|value| (*value).clone())).collect::<Option<Vec<_>>>() else { return Ok(false) };
            // An empty audience is the whole public table, for every lookup key
            // and scan prefix, including a read that finds no rows.
            key(&group)?
        }
    };
    Ok(is_left(groups, name, &group))
}

/// The core asks about the evaluated scan prefix, so arbitrary expressions,
/// cursors and empty retained groups follow the same path as a literal key.
pub(super) struct Reading<'a, T: DeviceTx> {
    pub tx: &'a T,
    pub schema: &'a Schema,
    pub groups: Groups,
    pub boundaries: boundary::Boundaries,
    pub retained: Cell<bool>,
}

impl<T: DeviceTx> Rows for Reading<'_, T> {
    fn provisional_row(&self, _table: &str, row: &Value) -> Result<bool, RuntimeError> {
        Ok(row.field("pending") == Ok(&Value::Bool(true)))
    }
    fn acquired_boundary(&self, table: &str, index: &str, prefix: &[Value]) -> Result<Option<snapback4_core::rows::AcquiredBoundary>, RuntimeError> {
        boundary::read(&self.boundaries, self.schema, table, index, prefix)
    }
    fn retained_row(&self, name: &str, row: &Value) -> Result<bool, RuntimeError> {
        retained(self.schema, &self.groups, name, Coverage::Row(row))
    }
    fn retained_group(&self, name: &str, index: &str, prefix: &[Value]) -> Result<bool, RuntimeError> {
        let retained = retained(self.schema, &self.groups, name, Coverage::Range(index, prefix))?;
        if retained { self.retained.set(true); }
        Ok(retained)
    }
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> { self.tx.get(table, id) }
    fn lookup(&self, table: &str, name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> { self.tx.lookup(table, name, index, key) }
    fn scan(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { self.tx.scan(table, index, prefix, bounds, dir, limit) }
    fn scan_metered(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, meter: &mut snapback4_core::meter::Meter) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { self.tx.scan_metered(table, index, prefix, bounds, dir, limit, meter) }
    fn count_prefix(&self, table: &str, index: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> { self.tx.count_prefix(table, index, prefix, limit) }
    fn put(&self, name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> { self.tx.put(name, table, row, old) }
    fn delete(&self, name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> { self.tx.delete(name, table, old) }
}
