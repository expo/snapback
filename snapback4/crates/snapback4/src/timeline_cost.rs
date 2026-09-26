//! Timeline work joins the application's ordinary mutation meter.
use snapback4_core::{ir, schema::{Schema, ColumnType, Table}, Value};

pub(crate) fn report(schema: &Schema, program: &ir::Program, lines: &mut Vec<String>) {
    let writes = ir::write_tables(program);
    let reads = ir::read_sites(program);
    for t in &schema.timelines {
        let affected: std::collections::BTreeSet<_> = writes.iter().filter(|(table,_)| t.maps(table)).map(|(table,_)| table.as_str()).collect();
        if !affected.is_empty() || reads.iter().any(|read| t.owns(&read.table) || t.maps(&read.table)) {
            acquisition(schema, t, lines);
        }
        if affected.is_empty() { continue; }
        lines.push(format!("    timeline {}: background delivery; derived + application writes share the 1024-row mutation ceiling", t.name));
        if affected.contains(t.posts[0].as_str()) || affected.contains(t.reposts[0].as_str()) {
            lines.push("      event insert: 1 app + 1 event + 1 own inbox + 1 durable delivery record = 4 writes, independent of follower count".into());
            lines.push("      removal: 1 app + 1 tombstone + 1 event delete + 1 purge record = 4 writes; visibility changes immediately".into());
        }
        if affected.contains(t.edges[0].as_str()) {
            lines.push("      follow: 1 edge + 1 owned admission + at most 50 newest live event copies + 1 backfill record = at most 53 writes".into());
            lines.push("      unfollow: 1 edge delete + 1 admission delete + up to 256 stale copies + 1 cleanup record = at most 259 writes; the next read excludes this actor".into());
        }
        lines.push("      background: at most 256 followers/events/copies per chunk under job ceilings; cursor and rows commit together; no authored capacities".into());
        lines.push("      reads: one private inbox lane, current private edge epoch and public tombstone point probes per examined row; reader backfill/cleanup makes complete false; foreign delivery may still be pending".into());
        if let Some(bounds) = stream_bounds(schema,t) {
            for (op,bytes) in bounds { lines.push(format!("      {op}: derived stream <= {bytes} B (application rows excluded)")); }
        }
    }
}

// @ref LLP 3000.016#4 — the certificate distinguishes acquisition from delivery and the history window.
fn acquisition(schema: &Schema, t: &snapback4_core::schema::timeline::Timeline, lines: &mut Vec<String>) {
    lines.push(format!("    following {} acquisition: global, non-sliding source floors; new arrivals accumulate", t.name));
    for name in [&t.posts[0], &t.reposts[0], &t.edges[0], &t.table("Feed")] {
        let description = match &schema.tables[name].sync {
            None => "online only".into(),
            Some(sync) => match &sync.horizon {
                None => "full sync".into(),
                Some(floor) => format!("newest {} by ({}){}", floor.last,
                    schema.tables[name].indexes[&floor.by].columns().join(", "),
                    if name == &t.table("Feed") { " per reader" } else { " globally" }),
            },
        };
        lines.push(format!("      {name}: {description}"));
    }
    for repost in [false, true] {
        lines.push(format!("      {} {}: {}", t.table("Posts"), if repost { "reposts" } else { "originals" },
            if t.fully_synced(schema, repost) { "full sync" } else { "event state follows the source's engine slot; no owned event rows on devices" }));
    }
    lines.push(format!("      {}: full sync; private edge epochs and work stay synced", t.table("RemovedEvents")));
    lines.push(format!("      history: newest {} events per followed author, unchanged; acquisition never changes delivery", snapback4_core::schema::timeline::HISTORY_WINDOW));
    lines.push("      withholding: unknown cards or inbox coverage withhold the whole query and continuation; retry original input online; loading offline, while a prediction is unobserved, or for held queries; transport failure stays loading".into());
    lines.push("      cuts: a known examined-meter prefix stays partial with its continuation; backfill and cleanup stay incomplete data".into());
}

fn row_bounds(table: &Table, event: bool) -> Option<(usize, usize, usize, usize)> {
    use snapback4_core::value::{canonical_json, I53_MIN};
    let mut bounds = (0, 0, 0, 0);
    for identity in ["x".repeat(135), format!("{}x", "\\".repeat(67))] {
        let mut fields = std::collections::BTreeMap::new();
        for (name, kind) in &table.columns {
            let value = match kind.required() {
                ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => Value::Id(identity.clone()),
                ColumnType::Bool => Value::Bool(false),
                ColumnType::Int | ColumnType::Time => Value::Int(I53_MIN),
                ColumnType::Text { max } => Value::String("\\".repeat(*max as usize)),
                ColumnType::Enum { variants: values } => Value::String(values.iter().max_by_key(|s| s.len())?.clone()),
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
    let work = event("Work", false)?;
    Some(vec![
        ("event insert", source + feed + work),
        ("follow preview", t.backfill() * feed + work + event("Edges", false)?),
        ("delivery chunk", 256 * feed + work),
        ("removal", event("RemovedEvents", false)? + event("Posts", true)? + work),
        ("purge chunk", 256 * event("Feed", true)? + event("RemovedEvents", true)? + 2 * event("Work", true)?),
    ])
}
