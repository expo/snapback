//! Native witness inspection, outside the measured acquire/answer interval.
use super::*;

impl<S: DeviceStore> Device<S> {
    // @ref LLP 3000.030#13 — compare actual group counts and persisted coverage before reconnect.
    pub(crate) fn witness_coverage(&mut self, viewer: &str) -> Result<serde_json::Value, RuntimeError> {
        let tx = self.store.read_transaction()?;
        let history = history::load(&tx, history::GROUPS)?;
        let boundaries = DeviceTx::meta_prefix(&tx, boundary::BOUNDARIES)?;
        let mut groups = BTreeMap::<String, BTreeMap<String, u64>>::new();
        for (table, entries) in &history {
            for group in entries.keys() { groups.entry(table.clone()).or_default().insert(group.clone(), 0); }
        }
        // Horizon facts also represent an empty acquired group.
        for (key, _) in &boundaries {
            let (table, _, prefix): (String, String, String) = decoded(&key[boundary::BOUNDARIES.len()..])?;
            let values = snapback4_core::value::decode_bytes_hex(&prefix)
                .and_then(|bytes| snapback4_core::key::decode(&bytes))
                .ok_or_else(|| RuntimeError::Store("invalid witness acquisition boundary".into()))?;
            let key = encoded(&values.iter().map(wire::to_json).collect::<Vec<_>>())?;
            groups.entry(table).or_default().insert(key, 0);
        }
        for (name, table, sync) in self.schema.synced() {
            let entries = groups.entry(name.to_owned()).or_default();
            // Unwindowed public and principal partitions have an implicit group,
            // including when empty. Target partitions need rows or stored facts.
            match &sync.audience {
                Audience::Public => { entries.entry("[]".into()).or_default(); }
                Audience::Column(_) => { entries.entry(encoded(&[viewer])?).or_default(); }
                Audience::Target { .. } => {}
            }
            let mut bounds = Bounds::default();
            loop {
                let rows = tx.scan(name, "byId", &[], &bounds, Dir::Asc, 512)?;
                for (row, _) in &rows {
                    *entries.entry(history::row_key(table, row)?).or_default() += 1;
                    bounds.after = Some(vec![row.field("id")?.clone()]);
                }
                if rows.len() < 512 { break; }
            }
        }
        let result = serde_json::json!({ "groups": groups, "history": encoded(&history)?, "boundaries": boundaries });
        tx.rollback()?;
        Ok(result)
    }
}
