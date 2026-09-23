//! Timeline work joins the application's ordinary mutation meter.
use snapback4_core::{ir, schema::{Schema, ColumnType, Table}, Value};

pub(crate) fn report(schema: &Schema, program: &ir::Program, lines: &mut Vec<String>) {
    let writes = ir::write_tables(program);
    for t in &schema.timelines {
        let affected: std::collections::BTreeSet<_> = writes.iter().filter(|(table,_)|t.maps(table)).map(|(table,_)|table.as_str()).collect();
        if affected.is_empty() && program.name != t.purge { continue; }
        lines.push(format!("    timeline {}: derived + all application writes share the 1024-row mutation ceiling; composition beyond it refuses atomically",t.name));
        if affected.contains(t.authors[0].as_str()) { lines.push("      profile insert: 1 app row + up to 1 mode = 2 writes; deletion keeps the mode; activation registers <=1000 existing profiles in one commit".into()); }
        if affected.contains(t.posts[0].as_str()) || affected.contains(t.reposts[0].as_str()) {
            lines.push("      event insert: 1 app + 1 source + up to 51 private copies = 53 writes; shared: 1 app + 1 source + 1 broadcast + at most 1 own copy = 4 writes".into());
            lines.push("      removal: 1 app + tombstone + source delete + at most 1 broadcast delete = 4 writes; unchanged flag: no derived writes; identity/time updates and flag reversal refuse".into());
        }
        if affected.contains(t.edges[0].as_str()) {
            lines.push("      follow: read <=1000 source events, visit newest 865; promotion installs <=52 routes at 3 writes each plus mode; with one app edge and 865 copies = 1023 writes".into());
            lines.push("      unfollow: per-(reader, actor) cap bounds <=1000 private-copy deletes + route, private total, public count + one app edge = 1004 writes; a refollow is a second transition".into());
        }
        if program.name == t.purge { lines.push("      purge: <=1001 private-copy deletes + 1 tombstone = 1002 writes per chunk".into()); }
        lines.push("      owned row bounds: index entries / index-key bytes / tagged JSON bytes / wire JSON bytes (application rows and SQLite overhead excluded; updates price old and new keys)".into());
        for suffix in ["Authors", "Pulls", "PullCounts", "PullTotals", "Posts", "RemovedEvents", "Feed", "Broadcast"] {
            if let Some((entries, keys, tagged, wire)) = schema.table(&t.table(suffix)).and_then(|table| row_bounds(table, suffix == "Posts")) {
                lines.push(format!("        {}: {entries} / {keys} / {tagged} / {wire}", t.table(suffix)));
            } else {
                lines.push(format!("        {}: unknown row bound; inspect the schema before composing writes", t.table(suffix)));
            }
        }
    }
}

fn row_bounds(table: &Table, event: bool) -> Option<(usize, usize, usize, usize)> {
    use snapback4_core::value::{canonical_json, I53_MIN};
    let mut bounds = (0, 0, 0, 0);
    for identity in ["x".repeat(135), format!("{}x", "\\".repeat(67))] {
        let mut fields = std::collections::BTreeMap::new();
        for (name, kind) in &table.columns {
            let value = match kind {
                ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => Value::Id(identity.clone()),
                ColumnType::Bool => Value::Bool(false),
                ColumnType::Int | ColumnType::Time => Value::Int(I53_MIN),
                _ => return None,
            };
            fields.insert(name.clone(), value);
        }
        // Events preserve the caller's full identity; every other owned id is
        // 64 hexadecimal characters, including the internal maintained total.
        fields.insert("id".into(), Value::Id(if event { identity } else { "f".repeat(64) }));
        let row = Value::Row(fields.into());
        let id = row.field("id").ok()?.as_str().ok()?;
        let keys: Vec<_> = table.indexes.values().flat_map(|index| snapback4_core::rows::index_keys(index, &row, id)).collect();
        bounds.0 = bounds.0.max(keys.len());
        bounds.1 = bounds.1.max(keys.iter().map(Vec::len).sum());
        bounds.2 = bounds.2.max(canonical_json(&row).len());
        bounds.3 = bounds.3.max(serde_json::to_vec(&snapback4_core::wire::to_json(&row)).ok()?.len());
    }
    Some(bounds)
}
