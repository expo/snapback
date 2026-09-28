//! A left group's delivered rows remain a device answer. This is partition
//! state, persisted with its rows, not a query cache or a public Read field.
use super::*;
use std::cell::Cell;

pub(super) const GROUPS: &str = "device:history:groups";
pub(super) const STAGED_GROUPS: &str = "device:snapshot:groups";
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) enum Membership {
    Held, Left,
    /// Rejoining can mix new deliveries with old retained images. Only ids
    /// delivered again have current coverage until a replacement snapshot.
    Rejoined(BTreeSet<String>),
}
pub(super) type Groups = BTreeMap<String, BTreeMap<String, Membership>>;

pub(super) fn load(tx: &dyn crate::store::StreamTx, key: &str) -> Result<Groups, RuntimeError> {
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

pub(super) fn events(tx: &dyn crate::store::StreamTx, schema: &Schema, events: &[StreamEvent], joined: &wire::HeldGroups, staged: bool) -> Result<(), RuntimeError> {
    if joined.is_empty() && !events.iter().any(|event| schema.table(&event.table).is_some_and(|table| table.leave == LeavePolicy::DeliveredHistory)) { return Ok(()); }
    let meta = if staged { STAGED_GROUPS } else { GROUPS };
    let mut groups = load(tx, meta)?;
    let joined: BTreeMap<String, BTreeSet<String>> = joined.iter().map(|(name, groups)| {
        Ok((name.clone(), groups.iter().map(encoded).collect::<Result<_, RuntimeError>>()?))
    }).collect::<Result<_, RuntimeError>>()?;
    // The server includes actual acquisitions only, never continuous renewals.
    // Reset every old epoch before collecting this page's delivered ids.
    for (name, joined) in &joined {
        for group in joined {
            groups.entry(name.clone()).or_default().insert(group.clone(), Membership::Rejoined(BTreeSet::new()));
        }
    }
    for event in events {
        let Some(table) = schema.table(&event.table).filter(|table| table.sync.is_some() && table.leave == LeavePolicy::DeliveredHistory) else { continue };
        match event.kind.as_str() {
            "scope" => { groups.entry(event.table.clone()).or_default().insert(key(&scope_group(table, event)?)?, Membership::Left); }
            "put" => {
                let row = wire::row_from_json(table, event.data.as_ref().ok_or_else(|| RuntimeError::Input("event row is missing".into()))?).map_err(RuntimeError::Input)?;
                let entries = groups.entry(event.table.clone()).or_default();
                let key = row_key(table, &row)?;
                let joining = joined.get(&event.table).is_some_and(|groups| groups.contains(&key));
                // A put alone proves neither full acquisition nor departure.
                if joining { entries.entry(key.clone()).or_insert(Membership::Rejoined(BTreeSet::new())); }
                if let Some(membership) = entries.get_mut(&key) {
                    if joining && !matches!(membership, Membership::Rejoined(_)) { *membership = Membership::Rejoined(BTreeSet::new()); }
                    if let Membership::Rejoined(ids) = membership { ids.insert(row.field("id")?.as_str()?.to_owned()); }
                }
            }
            _ => {}
        }
    }
    for (name, joined) in joined {
        for group in joined {
            let entries = groups.entry(name.clone()).or_default();
            let membership = entries.entry(group).or_insert(Membership::Left);
            // An empty acquisition after a scope also starts a fresh epoch.
            if !matches!(membership, Membership::Rejoined(_)) { *membership = Membership::Rejoined(BTreeSet::new()); }
        }
    }
    tx.set_meta(meta, &encoded(&groups)?)
}

#[derive(Clone, Copy)]
pub(super) enum Coverage<'a> { Row(&'a Value), Range(&'a str, &'a [Value]) }

#[derive(PartialEq, Eq)]
pub(super) enum CoverageState { Unknown, Held, Retained }

pub(super) fn retained(schema: &Schema, groups: &Groups, name: &str, coverage: Coverage<'_>) -> Result<bool, RuntimeError> {
    Ok(coverage_state(schema, groups, name, coverage)? == CoverageState::Retained)
}

// @ref LLP 3000.007#18.2 — reads and predictions consult the same persisted held/left groups, including empty groups.
pub(super) fn coverage_state(schema: &Schema, groups: &Groups, name: &str, coverage: Coverage<'_>) -> Result<CoverageState, RuntimeError> {
    let Some(table) = schema.table(name).filter(|table| table.sync.is_some()) else { return Ok(CoverageState::Unknown) };
    // @ref LLP 3000.028#3.4 — owner-key absence needs this principal's published whole group, even with until-revoked rows.
    if table.leave != LeavePolicy::DeliveredHistory && !schema.maintain_for(name).is_some_and(|m| m.own_keys.is_some()) { return Ok(CoverageState::Held); }
    let group = match coverage {
        Coverage::Row(row) => row_key(table, row)?,
        Coverage::Range(index, prefix) => {
            let Some(index) = table.index(index) else { return Ok(CoverageState::Unknown) };
            let pinned: BTreeMap<_, _> = index.components.iter().zip(prefix).filter_map(|(part, value)| part.column().map(|column| (column, value))).collect();
            let Some(group) = audience_prefix(table).iter().map(|column| pinned.get(column).map(|value| (*value).clone())).collect::<Option<Vec<_>>>() else { return Ok(CoverageState::Unknown) };
            // An empty audience is the whole public table, for every lookup key
            // and scan prefix, including a read that finds no rows.
            key(&group)?
        }
    };
    Ok(match groups.get(name).and_then(|groups| groups.get(&group)) {
        Some(Membership::Held) => CoverageState::Held,
        Some(Membership::Left) => CoverageState::Retained,
        Some(Membership::Rejoined(ids)) => match coverage {
            Coverage::Row(row) if row.field("id").ok().and_then(|id| id.as_str().ok()).is_some_and(|id| ids.contains(id)) => CoverageState::Held,
            Coverage::Row(_) => CoverageState::Retained,
            // A live rejoined range can miss current rows: allow fallback.
            // Its individually retained images still cannot certify a capture.
            Coverage::Range(..) => CoverageState::Unknown,
        },
        None => CoverageState::Unknown,
    })
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
    fn current_row(&self, name: &str, row: &Value) -> Result<bool, RuntimeError> {
        Ok(history::coverage_state(self.schema, &self.groups, name, history::Coverage::Row(row))? == history::CoverageState::Held)
    }
    fn current_group(&self, name: &str, index: &str, prefix: &[Value]) -> Result<bool, RuntimeError> {
        Ok(history::coverage_state(self.schema, &self.groups, name, history::Coverage::Range(index, prefix))? == history::CoverageState::Held)
    }
    fn acquired_boundary(&self, table: &str, index: &str, prefix: &[Value]) -> Result<Option<snapback4_core::rows::AcquiredBoundary>, RuntimeError> {
        boundary::read(&self.boundaries, self.schema, table, index, prefix)
    }
    fn search_retained_row(&self, name: &str, row: &Value) -> Result<bool, RuntimeError> {
        Ok(self.schema.table(name).is_some_and(|table| table.leave == LeavePolicy::DeliveredHistory)
            && is_left(&self.groups, name, &row_key(&self.schema.tables[name], row)?))
    }
    fn retained_row(&self, name: &str, row: &Value) -> Result<bool, RuntimeError> {
        let kept = retained(self.schema, &self.groups, name, Coverage::Row(row))?;
        if kept { self.retained.set(true); }
        Ok(kept)
    }
    fn retained_group(&self, name: &str, index: &str, prefix: &[Value]) -> Result<bool, RuntimeError> {
        let retained = retained(self.schema, &self.groups, name, Coverage::Range(index, prefix))?;
        if retained { self.retained.set(true); }
        Ok(retained)
    }
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> { self.tx.get(table, id) }
    fn lookup(&self, table: &str, name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> { self.tx.lookup(table, name, index, key) }
    fn scan(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { self.tx.scan(table, index, prefix, bounds, dir, limit) }
    fn index_head(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir) -> Result<Option<Vec<Value>>, RuntimeError> { self.tx.index_head(table,index,prefix,bounds,dir) }
    fn scan_metered(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, scope: &snapback4_core::engine::Authorization, meter: &mut snapback4_core::engine::InternalMeter<'_>) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { self.tx.scan_metered(table, index, prefix, bounds, dir, limit, scope, meter) }
    fn cap_count(&self, table: &str, by: &[String], group: &[Value]) -> Result<u64, RuntimeError> {
        self.tx.cap_count(table, by, group)
    }
    fn count_prefix(&self, table: &str, index: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> { self.tx.count_prefix(table, index, prefix, limit) }
    fn put(&self, name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> { self.tx.put(name, table, row, old) }
    fn delete(&self, name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> { self.tx.delete(name, table, old) }
}
