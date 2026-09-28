//! Acquisition facts belong to the partition, never to an ordinary row put.
use super::*;
use snapback4_core::rows::AcquiredBoundary;

pub(super) const BOUNDARIES: &str = "device:acquisition-boundaries:";
pub(super) const STAGED: &str = "device:snapshot:boundaries:";
pub(super) const REPORT: &str = "device:acquisition-report";
// None (an empty metadata value) is unfinished; strings are whole, a hex key,
// or unknown until a replacement snapshot discards earlier retained copies.
#[derive(Default)]
pub(super) struct Boundaries {
    values: BTreeMap<String, Option<String>>,
    editing: Option<bool>,
    loaded: BTreeSet<String>,
    removed: BTreeSet<String>,
}

fn key(name: &str, index: &str, group: &[Value]) -> Result<String, RuntimeError> {
    encoded(&(name, index, snapback4_core::value::encode_bytes_hex(&snapback4_core::key::encode(group))))
}

impl Boundaries {
    pub fn load(tx: &dyn crate::store::StreamTx, staged: bool) -> Result<Self, RuntimeError> {
        let prefix = if staged { STAGED } else { BOUNDARIES };
        Ok(Self { values: tx.meta_prefix(prefix)?.into_iter().map(|(k, v)| (k[prefix.len()..].to_owned(), (!v.is_empty()).then_some(v))).collect(), ..Self::default() })
    }
    /// Stream application addresses only the groups on this page. A read
    /// transaction instead loads the namespace once for all its merge lanes.
    pub fn editing(staged: bool) -> Self { Self { editing: Some(staged), ..Self::default() } }
    fn ensure(&mut self, tx: &dyn crate::store::StreamTx, k: &str) -> Result<(), RuntimeError> {
        if let Some(staged) = self.editing && self.loaded.insert(k.to_owned()) {
            let prefix = if staged { STAGED } else { BOUNDARIES };
            if let Some(value) = tx.meta(&format!("{prefix}{k}"))? {
                self.values.insert(k.to_owned(), (!value.is_empty()).then_some(value));
            }
        }
        Ok(())
    }
    pub fn save(&self, tx: &dyn crate::store::StreamTx, staged: bool) -> Result<(), RuntimeError> {
        let prefix = if staged { STAGED } else { BOUNDARIES };
        // A replacement publishes all staged groups and removes absent ones.
        // Ordinary pages compare only their cached, individually addressed entries.
        if self.editing.is_none() {
            for (stored, _) in tx.meta_prefix(prefix)? {
                if !self.values.contains_key(&stored[prefix.len()..]) { tx.delete_meta(&[&stored])?; }
            }
        }
        for (k, value) in &self.values {
            let stored = format!("{prefix}{k}");
            let value = value.as_deref().unwrap_or("");
            if tx.meta(&stored)?.as_deref() != Some(value) { tx.set_meta(&stored, value)?; }
        }
        for k in &self.removed { tx.delete_meta(&[&format!("{prefix}{k}")])?; }
        Ok(())
    }
    pub fn marker(&mut self, tx: &dyn crate::store::StreamTx, schema: &Schema, marker: &wire::Acquisition, snapshot: bool) -> Result<(), RuntimeError> {
        let valid = (|| {
            let table = schema.table(&marker.table)?;
            let horizon = table.sync.as_ref()?.horizon.as_ref()?;
            if horizon.by != marker.index { return None; }
            let columns = audience_prefix(table);
            if columns.len() != marker.group.len() { return None; }
            let group = columns.iter().zip(&marker.group).map(|(column, value)| wire::column_from_json(&table.columns[column], value)).collect::<Result<Vec<_>, _>>().ok()?;
            let k = key(&marker.table, &marker.index, &group).ok()?;
            if let Some(floor) = &marker.floor {
                if floor != "whole" {
                    let bytes = snapback4_core::value::decode_bytes_hex(floor)?;
                    let values = snapback4_core::key::decode(&bytes)?;
                    if !values.starts_with(&group) || values.len() != table.index(&marker.index)?.components.len() + 1 { return None; }
                }
            }
            Some(k)
        })();
        let valid = if let Some(k) = valid {
            self.ensure(tx, &k)?;
            (marker.floor.is_none() || self.values.get(&k) == Some(&None)
                || self.values.get(&k).and_then(|v| v.as_deref()) == Some("unknown")).then_some(k)
        } else { None };
        if let Some(k) = valid {
            if marker.floor.is_some() && self.values.get(&k).and_then(|v| v.as_deref()) == Some("unknown") { return Ok(()); }
            let table = schema.table(&marker.table).expect("validated table");
            // @ref LLP 3000.007#18.2 — a join cannot certify retained copies from an earlier membership; a full snapshot replaces them.
            let retained = !snapshot && marker.floor.is_none() && table.leave == LeavePolicy::DeliveredHistory
                && (self.values.contains_key(&k) || !tx.scan(&marker.table, &marker.index,
                    &audience_prefix(table).iter().zip(&marker.group).map(|(c, v)| wire::column_from_json(&table.columns[c], v)).collect::<Result<Vec<_>, _>>().map_err(RuntimeError::Input)?,
                    &Bounds::default(), Dir::Asc, 1)?.is_empty());
            self.removed.remove(&k);
            self.values.insert(k, if retained { Some("unknown".into()) } else { marker.floor.clone() });
        }
        else {
            let report = format!("ignored acquisition boundary for {}.{}: group is not acquiring or boundary is invalid", marker.table, marker.index);
            tx.set_meta(REPORT, &report)?;
            #[cfg(not(target_arch = "wasm32"))]
            snapback4_core::diagnostic!("{report}");
            #[cfg(target_arch = "wasm32")]
            eprintln!("{report}");
        }
        Ok(())
    }
    pub fn accept(&mut self, tx: &dyn crate::store::StreamTx, name: &str, table: &Table, row: &Value, held: bool) -> Result<bool, RuntimeError> {
        if held { return Ok(true); }
        let Some(sync) = &table.sync else { return Ok(true) };
        let Some(horizon) = &sync.horizon else { return Ok(true) };
        let k = key(name, &horizon.by, &snapback4_core::partition::group_of(sync, row))?;
        self.ensure(tx, &k)?;
        let Some(Some(floor)) = self.values.get(&k) else { return Ok(true) };
        if floor == "whole" || floor == "unknown" { return Ok(true); }
        let index = table.index(&horizon.by).expect("horizon index");
        Ok(snapback4_core::rows::index_key(index, row, row.field("id")?.as_str()?) >= snapback4_core::value::decode_bytes_hex(floor).unwrap_or_default())
    }
    pub fn scope(&mut self, tx: &dyn crate::store::StreamTx, name: &str, table: &Table, group: &[Value]) -> Result<(), RuntimeError> {
        if let Some(horizon) = table.sync.as_ref().and_then(|sync| sync.horizon.as_ref()) {
            let k = key(name, &horizon.by, group)?;
            self.ensure(tx, &k)?;
            if table.leave != LeavePolicy::DeliveredHistory || self.values.get(&k) == Some(&None) {
                self.values.remove(&k); self.removed.insert(k);
            }
        }
        Ok(())
    }
}

pub(super) fn retain<T: DeviceTx>(tx: &T, schema: &Schema) -> Result<(), RuntimeError> {
    let groups = history::load(tx, history::STAGED_GROUPS)?;
    let mut kept = Boundaries::default();
    for (k, floor) in Boundaries::load(tx, false)?.values {
        let (name, _, prefix): (String, String, String) = decoded(&k)?;
        let group = snapback4_core::value::decode_bytes_hex(&prefix).and_then(|bytes| snapback4_core::key::decode(&bytes)).unwrap_or_default();
        let group = encoded(&group.iter().map(wire::to_json).collect::<Vec<_>>())?;
        if schema.table(&name).is_some_and(|table| table.leave == LeavePolicy::DeliveredHistory) && history::is_left(&groups, &name, &group) {
            kept.values.insert(k, floor);
        }
    }
    kept.save(tx, true)
}

pub(super) fn read(boundaries: &Boundaries, schema: &Schema, name: &str, index: &str, prefix: &[Value]) -> Result<Option<AcquiredBoundary>, RuntimeError> {
    let Some(table) = schema.table(name) else { return Ok(None) };
    let Some(horizon) = table.sync.as_ref().and_then(|sync| sync.horizon.as_ref()) else { return Ok(None) };
    let width = audience_prefix(table).len();
    if index != horizon.by || prefix.len() < width { return Ok(None); }
    Ok(boundaries.values.get(&key(name, index, &prefix[..width])?).and_then(|floor| floor.as_ref()).and_then(|floor| {
        if floor == "whole" { Some(AcquiredBoundary::Whole) }
        else { snapback4_core::value::decode_bytes_hex(floor).map(AcquiredBoundary::Key) }
    }))
}

pub(super) fn validate_positions(page: &StreamPage) -> Result<(), RuntimeError> {
    if page.acquisitions.iter().any(|marker| marker.at > page.events.len()) || page.acquisitions.windows(2).any(|pair| pair[0].at > pair[1].at) {
        return Err(RuntimeError::Input("acquisition markers must be ordered within the page".into()));
    }
    Ok(())
}
