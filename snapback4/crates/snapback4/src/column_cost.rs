//! Schema bounds for the form's own parent images; no delivery admission gate.
// @ref LLP 3000.007.003#5 — composed mutations and snapshot recovery are distinct.
use snapback4_core::{ir, schema::{ColumnType, Schema, Table}, Ceilings};

fn string_bytes(s: &str) -> u64 { serde_json::to_string(s).expect("string").len() as u64 }
fn value_bytes(kind: &ColumnType) -> Option<u64> {
    Some(match kind {
        // A tagged identity is <=144 B; plain JSON omits seven tag bytes.
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref {..} => 137,
        ColumnType::Int | ColumnType::Time | ColumnType::Decimal {..} | ColumnType::Money {..} => 17,
        ColumnType::Bool => 5,
        // Text forbids controls other than tab, CR and LF. Four-byte Unicode
        // is wider than those two-byte escapes, quotes and backslashes.
        ColumnType::Text {max} => 2 + 4 * u64::from(*max),
        ColumnType::Bytes {max} => 2 + 2 * u64::from(*max),
        ColumnType::Enum {variants} => variants.iter().map(|v|string_bytes(v)).max().unwrap_or(2),
        ColumnType::Optional(inner) => value_bytes(inner)?.max(4),
        ColumnType::List {of,max} | ColumnType::ListRange {of,max,..} => 2_u64.saturating_add(u64::from(*max).saturating_mul(value_bytes(of)?.saturating_add(1))),
        // Tagged JSON bounds the smaller untagged wire representation.
        ColumnType::Json {max_bytes} => u64::from(*max_bytes),
        // Asset map admission has no schema bound on extra metadata.
        ColumnType::Image {..} | ColumnType::Video {..} => return None,
    })
}
pub(crate) fn row_bytes(table: &Table) -> Option<u64> {
    table.columns.iter().try_fold(2_u64, |n,(name,kind)|
        Some(n.saturating_add(string_bytes(name) + 2).saturating_add(value_bytes(kind)?)))
}
pub(crate) fn event_bytes(name: &str, table: &Table) -> Option<u64> {
    if table.sync.is_none() { return Some(0); }
    let id="x".repeat(135);
    let envelope=serde_json::to_vec(&crate::sync_wire::SyncEvent {seq:Some(u64::MAX),kind:"put",table:name,id:&id,data:None}).ok()?.len() as u64;
    Some((envelope - 4).saturating_add(row_bytes(table)?).saturating_add(1))
}

pub(crate) fn report(schema: &Schema, program: &ir::Program, lines: &mut Vec<String>) {
    let (scope, ceiling)=if program.kind == ir::ProgramKind::Job { ("job chunk",Ceilings::job().rows_written) } else { ("mutation",Ceilings::default().rows_written) };
    let writes=ir::write_tables(program);
    let sources: std::collections::BTreeSet<_> = writes.iter().map(|(name,_)|name).collect();
    for source in sources {
        let columns: Vec<_> = schema.maintains.iter().filter(|m|m.source == *source && m.private.is_some()).collect();
        if columns.is_empty() { continue; }
        let count=columns.len() as u64;
        let transitions=ceiling / (1 + 4 * count);
        lines.push(format!("    maintained columns from {source}: {}",columns.iter().map(|m|m.label()).collect::<Vec<_>>().join(", ")));
        lines.push(format!("      per source attempt: 1 application write + {} reserved private/mirror writes; <= {} whole-parent puts (old/new groups); all share the {ceiling}-row {scope} ceiling",4*count,2*count));
        lines.push(format!("      composed {scope}: <= {transitions} such source transitions, <= {} parent puts; other writes and meters can lower this bound",2*count*transitions));
        let mut per_attempt=Some(0_u64);
        for m in columns {
            let owner=m.private.as_ref().unwrap();
            let parent=&schema.tables[&owner.table];
            let bytes=event_bytes(&owner.table,parent);
            per_attempt=per_attempt.zip(bytes).map(|(sum,n)|sum.saturating_add(n.saturating_mul(2)));
            let size=bytes.map(|n|format!("<= {n} B per parent put, including event framing")).unwrap_or_else(||"unknown wire bound (asset metadata); measure the parent image".into());
            lines.push(format!("      {}: {size}; private total emits 0 B; mirror preserves other fields and maintains every parent index",m.label()));
        }
        if let Some(bytes)=per_attempt {
            lines.push(format!("      own derived stream bytes: <= {} B per composed {scope}, per recipient (application events, acknowledgements and reply envelope excluded)",bytes.saturating_mul(transitions)));
        }
        lines.push("      activation: private rebuild + in-place mirror, 0 row-event bytes; parent barrier always commits; device reacquires, no column prediction".into());
        lines.push("      schema bounds may exceed 16777216 B; no write-time byte guard; an oversized current-generation stream at limit 1 restarts by snapshot with pending writes preserved".into());
    }
}

pub(crate) fn description(schema: &Schema, parent: &str) -> Vec<String> {
    schema.tables[parent].sequences.iter().map(|(column, reference)|
        format!("  sequence {parent}.{column}: counter per {} row through .{reference}; shared across child tables; provisional while pending", schema.tables[parent].columns[reference]))
        .chain(schema.maintains.iter().filter(|m|m.private.as_ref().is_some_and(|o|o.table == parent)).map(|m|
        format!("  maintained column {}: {:?} from {} by {}; parent residency: {}; server-derived, no device prediction; event-free activation reacquires snapshots",m.label(),m.kind,m.source,m.by.join(", "),snapback4_lang::bind::residency::table_line(schema,parent)))).collect()
}
