use super::Schema;
use std::collections::BTreeSet;

impl Schema {
    // @ref LLP 3000.029#9 — disclosure fences need the whole schema footprint,
    // independent of occupancy, expiry, coverage and short-circuit evaluation.
    pub fn read_dependencies(&self, tables: &mut BTreeSet<String>) {
        let mut pending: Vec<_> = tables.iter().cloned().collect();
        while let Some(name) = pending.pop() {
            let mut add = |name: &str| {
                if tables.insert(name.to_owned()) { pending.push(name.to_owned()); }
            };
            if let Some(table) = self.tables.get(&name) {
                let mut probes = Vec::new();
                crate::engine::rules::probe_sites(&table.rules.read, &mut probes);
                for (table, _) in probes { add(&table); }
                if let Some(through) = &table.through { add(&through.parent); }
            }
            for maintain in &self.maintains {
                if maintain.target != name && !maintain.private.as_ref().is_some_and(|owner| owner.table == name) { continue; }
                add(&maintain.source);
                if let Some(key) = &maintain.row_key { add(&key.table); }
                if let Some(key) = &maintain.parent_key { add(&key.parent); }
            }
            for timeline in &self.timelines {
                if timeline.owns(&name) {
                    for owned in &timeline.owned { add(owned); }
                    for source in timeline.event_tables() { add(source); }
                    if !timeline.authors[0].is_empty() { add(&timeline.authors[0]); }
                }
            }
        }
    }
}
