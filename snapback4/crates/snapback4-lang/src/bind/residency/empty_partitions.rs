//! P9 advice only. PAGE4 owns planner reach and runtime completeness proofs.
use super::*;
use crate::bind::BoundProgram;

// @ref LLP 3000.011.003.000#11-wave-11-runtime-upgrade-history — name the empty filtered-partition risk without changing query planning.
pub(in crate::bind) fn notes(schema: &Schema, programs: &[BoundProgram]) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for bound in programs.iter().filter(|p| p.program.kind == ProgramKind::Query) {
        if !schema.operations.get(&bound.program.name).is_some_and(|fact| fact.runs.as_deref() == Some("device")) { continue; }
        let mut seen = BTreeSet::new();
        for scan in ir::scans(&bound.program).into_iter().filter(|scan| !scan.existence && scan.after.is_none()) {
            let Some(table) = schema.table(&scan.table) else { continue; };
            let Some(sync) = table.sync.as_ref().filter(|s| s.horizon.is_none()) else { continue; };
            // A pinned sync audience already names its acquired empty group.
            // P9 is a public source subdivided by a reference outside that
            // audience, rather than a predicate on an acquired owner group.
            if sync.audience != Audience::Public || schema.maintain_for(&scan.table).is_some() { continue; }
            let audience = match &sync.audience { Audience::Public => Vec::new(), Audience::Column(c) => vec![c.clone()], Audience::Target { prefix, .. } => prefix.clone() };
            let scoped = table.index(&scan.index).is_some_and(|index| index.columns().iter().take(scan.prefix.len()).any(|column| !audience.contains(column) && matches!(table.columns.get(column), Some(snapback4_core::schema::ColumnType::Ref { .. }))));
            if !scoped || !seen.insert((scan.site.clone(), scan.table.clone())) { continue; }
            let location = bound.sources.get(&scan.site).map_or(&bound.site, |(site, _)| site);
            notes.push(Diagnostic::new(location, "N_SYNC_EMPTY",
                format!("query {} is device-planned over unbounded sync on {}: there is no bounded acquisition proof for an empty filtered partition; this read can stay loading until coverage is established", bound.program.name, scan.table),
                "bound the sync and read its window unfiltered, then filter in the client; or call through app.online.query / useOnline().query for server history. This is coverage advice, not a promise that every empty result stays loading").guide("sync"));
        }
    }
    notes
}
