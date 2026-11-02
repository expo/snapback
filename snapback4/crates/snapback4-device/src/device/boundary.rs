//! Acquisition facts belong to the partition, never to an ordinary row put.
use super::*;
use snapback4_core::rows::AcquiredBoundary;

pub(super) const BOUNDARIES: &str = "device:acquisition-boundaries:";
pub(super) const STAGED: &str = "device:snapshot:boundaries:";
pub(super) const REPORT: &str = "device:acquisition-report";
pub(super) const COUNT: &str = "device:acquisition-group-count";

fn floored(value: Option<&str>) -> bool {
    value.is_some_and(|s| s == "whole" || (!s.is_empty() && snapback4_core::value::decode_bytes_hex(s).is_some()))
}

// Derived progress only, never coverage evidence. Rebuild on opening so legacy
// stores need no eager migration and an older writer cannot leave a stale count.
pub(super) fn initialize_count<T: DeviceTx>(tx: &T) -> Result<(), RuntimeError> {
    let count = Boundaries::load(tx, false)?.floored_groups();
    let kept = tx.meta(COUNT)?;
    // Missing already means zero; opening a legacy store need not rewrite it.
    if (count != 0 || kept.is_some()) && kept.as_deref() != Some(&count.to_string()) {
        tx.set_meta(COUNT, &count.to_string())?;
    }
    Ok(())
}
pub(super) fn count<T: DeviceTx>(tx: &T) -> Result<usize, RuntimeError> { Ok(meta_u64(tx, COUNT)? as usize) }
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
    pub fn has_table(&self, name: &str) -> Result<bool, RuntimeError> {
        for (k, floor) in &self.values {
            let (table, _, _): (String, String, String) = decoded(k)?;
            if table == name && floor.is_some() { return Ok(true); }
        }
        Ok(false)
    }
    pub fn floored_groups(&self) -> usize {
        self.values.values().filter(|v| floored(v.as_deref())).count()
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
        // @ref LLP 3000.001.001#8-progress-and-ui — status counts commit/defer with the floors; ordinary pages still address only their changed groups.
        let count = if staged { None } else if self.editing.is_none() { Some(self.floored_groups() as i64) } else {
            let mut count = tx.meta(COUNT)?.as_deref().map(decoded::<i64>).transpose()?.unwrap_or(0);
            for (k, value) in &self.values {
                count += i64::from(floored(value.as_deref())) - i64::from(floored(tx.meta(&format!("{prefix}{k}"))?.as_deref()));
            }
            for k in &self.removed { count -= i64::from(floored(tx.meta(&format!("{prefix}{k}"))?.as_deref())); }
            Some(count)
        };
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
        if let Some(count) = count {
            if count < 0 { return Err(RuntimeError::Store("invalid acquisition group count".into())); }
            let value = count.to_string();
            if tx.meta(COUNT)?.as_deref() != Some(&value) { tx.set_meta(COUNT, &value)?; }
        }
        Ok(())
    }
    pub fn marker(&mut self, tx: &dyn crate::store::StreamTx, schema: &Schema, marker: &wire::Acquisition, snapshot: bool, progressive: bool) -> Result<(), RuntimeError> {
        let valid = (|| {
            let table = schema.table(&marker.table)?;
            // Acquisition markers belong only to a single-audience window.
            let (audience, _) = table.sync.as_ref()?.single_window(&marker.index)?;
            let columns = audience.columns();
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
            let group = encoded(&marker.group)?;
            let groups = if progressive { history::load(tx, history::GROUPS)? } else { Default::default() };
            let current = progressive && groups.get(&marker.table).and_then(|g| g.get(&group))
                .is_none_or(|membership| *membership == history::Membership::Held);
            // @ref LLP 3000.001.001#61-the-acquisition-page — held unwalked puts are not retained copies from a previous membership.
            let retained = !current && !snapshot && marker.floor.is_none() && table.leave == LeavePolicy::DeliveredHistory
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
    /// Whether an unheld row's put is inside its single-audience acquired window.
    pub fn accept(&mut self, tx: &dyn crate::store::StreamTx, name: &str, table: &Table, row: &Value, held: bool) -> Result<bool, RuntimeError> {
        if held { return Ok(true); }
        let Some(sync) = &table.sync else { return Ok(true) };
        let Some(horizon) = &sync.horizon else { return Ok(true) };
        let k = key(name, &horizon.by, &snapback4_core::partition::arm_group(&sync.audience, row))?;
        self.ensure(tx, &k)?;
        match self.values.get(&k) {
            None | Some(None) => Ok(true),
            Some(Some(floor)) if floor == "whole" || floor == "unknown" => Ok(true),
            Some(Some(floor)) => {
                let index = table.index(&horizon.by).expect("horizon index");
                Ok(snapback4_core::rows::index_key(index, row, row.field("id")?.as_str()?) >= snapback4_core::value::decode_bytes_hex(floor).unwrap_or_default())
            }
        }
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
    let Some((audience, _)) = table.sync.as_ref().and_then(|sync| sync.single_window(index)) else { return Ok(None) };
    let width = audience.columns().len();
    if prefix.len() < width { return Ok(None); }
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
