//! Conservative dependencies whose dormant population cannot enforce a gate.
// @ref LLP 3000.000.000.000#4-rollback-safeguards — counts from the exact preview; dependencies are not predicate matches.
use snapback4_core::{Schema, ir, store::DormantItem};
use std::collections::{BTreeMap, BTreeSet};

fn tables(value: &serde_json::Value, out: &mut BTreeSet<String>) {
    match value {
        serde_json::Value::Object(fields) => for (key, value) in fields {
            if key == "table" { if let Some(table) = value.as_str() { out.insert(table.into()); } }
            else { tables(value, out); }
        },
        serde_json::Value::Array(items) => for item in items { tables(item, out); },
        _ => (),
    }
}

pub(super) fn warnings(schema: &Schema, programs: &BTreeMap<String, ir::Program>, items: &[DormantItem], release: u64) -> Vec<String> {
    let mut warnings = Vec::new();
    for (name, program) in programs {
        let mut reads: BTreeSet<_> = ir::read_sites(program).into_iter().map(|site| site.table).collect();
        let written = ir::write_tables(program);
        // Rules on written targets can depend on a roster even without an authored query.
        for (table, _) in &written {
            if let Some(table) = schema.table(table) { tables(&serde_json::to_value(&table.rules).unwrap(), &mut reads); }
        }
        let mut visited = BTreeSet::new();
        while let Some(table) = reads.iter().find(|name| !visited.contains(*name)).cloned() {
            visited.insert(table.clone());
            for maintain in schema.maintains.iter().filter(|m| m.target == table) { reads.insert(maintain.source.clone()); }
            if let Some(table) = schema.table(&table) {
                tables(&serde_json::to_value(&table.rules.read).unwrap(), &mut reads);
                if let Some(parent) = &table.through { reads.insert(parent.parent.clone()); }
            }
        }
        for item in items.iter().filter(|item| item.rows > 0 && matches!(item.kind.as_str(), "rows" | "table") && reads.contains(&item.path)) {
            warnings.push(format!("release {release}'s `{name}` cannot see {} dormant {} {} (sample ids [{}]); dependency warning, not a predicate match — preserve this gate in a bridge release (guide deploy)", item.rows, item.path, if item.rows == 1 { "row" } else { "rows" }, item.sample_ids.join(", ")));
        }
    }
    warnings.sort(); warnings.dedup(); warnings
}
