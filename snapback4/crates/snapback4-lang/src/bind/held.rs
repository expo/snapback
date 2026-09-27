//! Advice only: a held query cannot fall back for a read unavailable on a device.
use super::BoundProgram;
use crate::diag::Diagnostic;
use snapback4_core::{ir, schema::Schema};

// @ref LLP 3000.021#3.1 — inspect lowered may-reads, including expanded helpers and shapes, regardless of the branch taken.
pub(super) fn notes(schema: &Schema, programs: &[BoundProgram]) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for bound in programs {
        if !schema.operations.get(&bound.program.name).is_some_and(|fact| fact.held) { continue; }
        let scans = ir::scans(&bound.program);
        for read in ir::read_sites(&bound.program) {
            let Some(table) = schema.tables.get(&read.table) else { continue; };
            let location = bound.sources.get(&read.site).map_or(&bound.site, |(site, _)| site);
            // A horizon or a word index does not make a source unsynced.
            // Match the engine's parent_pinned prefix test; unpinned synced
            // children use their captured authority without reading the parent.
            let parent = table.through.as_ref().filter(|parent| scans.iter().any(|scan|
                scan.site == read.site && table.index(&scan.index).is_some_and(|index|
                    index.columns().iter().take(scan.prefix.len()).any(|field| field == &parent.reference))))
                // Parent-key aggregate points resolve their parent before the value.
                .or_else(|| schema.maintain_for(&read.table).and_then(|view| view.parent_key.as_ref()).filter(|_| read.kind == "point"));
            for source in std::iter::once(read.table.as_str()).chain(parent.map(|parent| parent.parent.as_str())) {
                if schema.tables.get(source).is_none_or(|table| table.sync.is_some()) { continue; }
                notes.push(Diagnostic::new(location, "N_HELD_UNKNOWN",
                    format!("held query {} may read {} at {}: this query may read data unavailable on a device; when that read is needed, `held` prevents server fallback ({} has no sync)", bound.program.name, source, read.site, source),
                    "move the read to its own query, or drop `held`").guide("sync"));
            }
        }
        // Connected has no table read in the IR. Binding records each expanded
        // presence occurrence, including helpers and shapes, at its source site.
        for (_, (location, name)) in bound.sources.iter().filter(|(key, _)| key.starts_with("presence/")) {
            notes.push(Diagnostic::new(location, "N_HELD_UNKNOWN",
                format!("held query {} may read {name}: this query may read data unavailable on a device; when that read is needed, `held` prevents server fallback (connected is server presence)", bound.program.name),
                "move the read to its own query, or drop `held`").guide("sync"));
        }
    }
    notes.sort_by(|a, b| (&a.site.file, a.site.line, a.site.col, &a.message).cmp(&(&b.site.file, b.site.line, b.site.col, &b.message)));
    notes.dedup();
    notes
}
