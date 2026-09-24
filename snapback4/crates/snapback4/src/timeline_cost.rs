//! Timeline work joins the application's ordinary mutation meter.
use snapback4_core::{ir, schema::{Schema, ColumnType, Table}, Value};

pub(crate) fn report(schema: &Schema, program: &ir::Program, lines: &mut Vec<String>) {
    let writes = ir::write_tables(program);
    for t in &schema.timelines {
        let affected: std::collections::BTreeSet<_> = writes.iter().filter(|(table,_)| t.maps(table)).map(|(table,_)| table.as_str()).collect();
        if affected.is_empty() { continue; }
        lines.push(format!("    timeline {}: background delivery; derived + application writes share the 1024-row mutation ceiling", t.name));
        if affected.contains(t.posts[0].as_str()) || affected.contains(t.reposts[0].as_str()) {
            lines.push("      event insert: 1 app + 1 event + 1 own inbox + 1 durable delivery record = 4 writes, independent of follower count".into());
            lines.push("      removal: 1 app + 1 tombstone + 1 event delete + 1 purge record = 4 writes; visibility changes immediately".into());
        }
        if affected.contains(t.edges[0].as_str()) {
            lines.push("      follow: 1 edge + at most 50 newest live event copies + 1 backfill record = at most 52 writes".into());
            lines.push("      unfollow: 1 edge delete + 1 cleanup record = 2 writes; the next read excludes this actor".into());
        }
        lines.push("      background: at most 256 followers/events/copies per chunk under job ceilings; cursor and rows commit together; no authored capacities".into());
        lines.push("      reads: one private inbox lane, current public edge and tombstone point probes per candidate; foreign delivery may still be pending".into());
        if let Some(bounds) = stream_bounds(schema,t) {
            for (op,bytes) in bounds { lines.push(format!("      {op}: derived stream <= {bytes} B (application rows excluded)")); }
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

/// A conservative sum across every recipient, so any one partition's derived
/// events fit too. Online-only counts/totals do not enter the sync stream.
/// Deletes carry no row image. Each event includes its trailing array comma.
pub(crate) fn stream_bounds(schema: &Schema, t: &snapback4_core::schema::timeline::Timeline) -> Option<Vec<(&'static str, usize)>> {
    let event = |suffix: &str, delete: bool| -> Option<usize> {
        let name = t.table(suffix);
        let table = schema.table(&name)?;
        let row = if delete { 4 } else { row_bounds(table, suffix == "Posts")?.3 };
        let id = "x".repeat(if suffix == "Posts" { 135 } else { 64 });
        // u64::MAX also bounds all valid stream sequence encodings.
        let envelope = serde_json::to_vec(&crate::sync_wire::SyncEvent {seq:Some(u64::MAX), kind:if delete {"del"} else {"put"}, table:&name, id:&id, data:None}).ok()?.len();
        Some(envelope - 4 + row + 1)
    };
    let feed = event("Feed", false)?;
    let source = event("Posts", false)?;
    Some(vec![
        ("event insert", source + feed),
        ("follow preview", t.backfill() * feed),
        ("delivery chunk", 256 * feed),
        ("removal", event("RemovedEvents", false)? + event("Posts", true)?),
        ("purge chunk", 256 * event("Feed", true)? + event("RemovedEvents", true)?),
    ])
}
