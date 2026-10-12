//! E_FIELD_AUTHORITY at `check` for a scan the server always refuses: a page
//! over a table with a private field (`written by .owner`, not `readable by
//! audience`) whose read rule the scan does not decide. The engine refuses it
//! before walking a row (`private_scan_authority`): a bounded walk over rows
//! the caller may not read would show their population through its meter and
//! its cut, and the private field makes those rows the protected kind. The
//! test is the engine's own, made statically: the scan's visibility is not
//! uniform, not decided true by its pins, and the table is not readable by
//! everyone. Only the system (jobs) and a device trusting its synced partition
//! pass it, so queries and mutations that are not held are checked; a role
//! guard (`if`/`require` on a grant) does not change it.
// @ref LLP 3000.036#17.3 — wave 7 lane 098: `check` was green and `test` refused at run time.
use super::{catalog::Catalog, program::BoundProgram};
use crate::diag::Diagnostic;
use snapback4_core::{ir::{IndexKeyExpr, ProgramKind}, schema::Schema};

pub(super) fn check(catalog: &Catalog, schema: &Schema, programs: &[BoundProgram], diagnostics: &mut Vec<Diagnostic>) {
    for bound in programs {
        if !matches!(bound.program.kind, ProgramKind::Query | ProgramKind::Mutation) { continue; }
        if schema.operations.get(&bound.program.name).is_some_and(|fact| fact.held) { continue; }
        let mut seen = std::collections::BTreeSet::new();
        for scan in snapback4_core::ir::scans(&bound.program) {
            // A word search decides its own lanes' visibility (the matching plan).
            if scan.prefix.iter().any(|key| matches!(key, IndexKeyExpr::WordPrefix(_))) { continue; }
            let Some(table) = schema.table(&scan.table) else { continue };
            if schema.maintain_for(&scan.table).is_some() || table.rules.read.is_uniformly_readable() { continue; }
            let private: Vec<(&String, &String)> = table.written_by.iter().filter(|(_, authority)| !authority.audience).map(|(field, authority)| (field, &authority.owner)).collect();
            if private.is_empty() { continue; }
            let visibility = snapback4_core::engine::rules::scan_visibility(schema, scan);
            if visibility.uniform || visibility.decided_true { continue; }
            let Some((site, text)) = bound.sources.get(&scan.site) else { continue };
            if !seen.insert(site.to_string()) { continue; }
            let Some(index) = table.index(&scan.index) else { continue };
            let pinned: std::collections::BTreeSet<String> = index.components.iter().zip(&scan.prefix).filter_map(|(component, key)| key.scalar().and(component.column()).cloned()).collect();
            let deciding: Vec<String> = snapback4_core::engine::rules::deciding_fields(&scan.table, table, &table.rules.read).difference(&pinned).cloned().collect();
            let fields = private.iter().map(|(field, owner)| format!("{}.{field} (written by .{owner})", scan.table)).collect::<Vec<_>>().join(", ");
            let (field, owner) = private[0];
            let pin = if deciding.is_empty() { "pin the read rule's columns".to_owned() } else {
                format!("pin {} with where equalities (`{} where {} …`), so every row the page walks is one the caller may read", deciding.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", "), scan.table, deciding.iter().map(|c| format!(".{c} = viewer")).collect::<Vec<_>>().join(" and "))
            };
            let parent = singular(&scan.table);
            let guarded = snapback4_core::engine::rules::grant_dominated(schema, &bound.program, scan);
            let guard = if guarded { "; the role guard before it does not change this: the server refuses before it walks a row, for every caller" } else { "" };
            let _ = catalog;
            diagnostics.push(Diagnostic::new(site, "E_FIELD_AUTHORITY",
                format!("{} {}: `{text}` scans {} rows the caller may not all read (the read rule `{}` is not decided by this scan's pins), and {fields} is private: the server refuses this read at run time with E_FIELD_AUTHORITY (\"scope this read to a uniformly readable audience before scanning rows with private fields\"), because a walk over hidden rows shows how many there are{guard}",
                    bound.program.kind.word(), bound.program.name, scan.table, table.rules.read.quarry()),
                format!("{pin}; or move {field} into its own table keyed by the {parent} (`{parent}: {}`, `{owner}: principal`, the {field} column, `unique {parent}`, `immutable {parent}, {owner}`, `read <- .{owner} = viewer`, `insert <- .{owner} = viewer`, `update <- .{owner} = viewer`) and read it by key, so this page scans no private field; or declare `{field} … written by .{owner} readable by audience` if every reader of the row may see it", scan.table)).guide("rules"));
        }
    }
}

/// `visits` → `visit`: a column name for the reference to the parent row.
fn singular(table: &str) -> String {
    let name = table.strip_suffix("ies").map(|stem| format!("{stem}y"))
        .or_else(|| table.strip_suffix("ses").map(|stem| format!("{stem}s")))
        .or_else(|| table.strip_suffix('s').filter(|stem| !stem.ends_with('s')).map(str::to_owned))
        .unwrap_or_else(|| format!("{table}Row"));
    if name.is_empty() { format!("{table}Row") } else { name }
}
