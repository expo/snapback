//! Advice only: a held query cannot fall back for an unsynced read.
use super::BoundProgram;
use crate::diag::Diagnostic;
use snapback4_core::{ir, schema::Schema};

// @ref LLP 3000.021#3.1 — inspect lowered may-reads, including expanded helpers and shapes, regardless of the branch taken.
pub(super) fn notes(schema: &Schema, programs: &[BoundProgram]) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for bound in programs {
        if !schema.operations.get(&bound.program.name).is_some_and(|fact| fact.held) { continue; }
        for read in ir::read_sites(&bound.program) {
            let Some(table) = schema.tables.get(&read.table) else { continue; };
            // A horizon or a word index does not make a source unsynced.
            if table.sync.is_some() { continue; }
            let location = bound.sources.get(&read.site).map_or(&bound.site, |(site, _)| site);
            notes.push(Diagnostic::new(location, "N_HELD_UNKNOWN",
                format!("held query {} may read {} at {}: this query may read data unavailable on a device; when that read is needed, `held` prevents server fallback ({} has no sync)", bound.program.name, read.table, read.site, read.table),
                "move the read to its own query, or drop `held`").guide("sync"));
        }
    }
    notes.sort_by(|a, b| (&a.site.file, a.site.line, a.site.col, &a.message).cmp(&(&b.site.file, b.site.line, b.site.col, &b.message)));
    notes.dedup();
    notes
}
