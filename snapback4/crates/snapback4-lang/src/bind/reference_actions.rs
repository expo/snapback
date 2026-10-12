//! Referential actions (LLP 3000.038): each reference between ordinary durable
//! tables says what deleting its target does — `on delete restrict` (the
//! default), `cascade`, `set null` or `keep`. This pass synthesizes the index
//! a reference is probed through, lowers the action into the schema, refuses
//! what a column cannot carry, checks that a delete's cascade fits its
//! program, and names every delete whose behavior the restrict default changed.
// @ref LLP 3000.038#2 — restrict is the default; cascade and set null need a cap on the reference.
use super::catalog::Catalog;
use super::intent_walk as walk;
use crate::{ast::*, diag::Diagnostic};
use snapback4_core::schema::{self as core, references::{self, OnDelete as Action}};
use std::collections::{BTreeMap, BTreeSet};

fn action(declared: OnDelete) -> Action {
    match declared { OnDelete::Restrict => Action::Restrict, OnDelete::Cascade => Action::Cascade, OnDelete::SetNull => Action::SetNull, OnDelete::Keep => Action::Keep }
}

/// Before the schema is bound: every reference whose action probes its
/// children gets an index leading with the reference (then the child's
/// `expire at` column), unless one already exists. A `cap N by <column>` is
/// served by the same index.
pub(super) fn indexes(catalog: &mut Catalog) {
    let ordinary = |catalog: &Catalog, name: &str| catalog.tables.get(name).is_some_and(|info| info.maintained.is_none() && info.decl.ephemeral.is_none());
    let mut wanted = Vec::new();
    for (name, info) in &catalog.tables {
        if !ordinary(catalog, name) { continue; }
        for column in &info.decl.columns {
            let TypeKind::Ref { table: parent } = &column.type_.kind else { continue };
            if column.on_delete.as_ref().is_some_and(|(a, _)| *a == OnDelete::Keep) || !ordinary(catalog, parent) { continue; }
            if info.through.as_ref().is_some_and(|through| through.reference == column.name) { continue; }
            let mut leading = vec![column.name.clone()];
            if let Some((expire, _)) = &info.decl.expire { leading.push(expire.clone()); }
            if info.indexes.iter().any(|index| index.is_plain() && index.columns.starts_with(&leading)) { continue; }
            leading.push("id".into());
            wanted.push((name.clone(), IndexDecl { name: references::reference_index_name(&column.name), columns: leading, unique: false, refusal: None, words: None, computed: BTreeMap::new(), site: column.site.clone() }));
        }
    }
    for (table, index) in wanted {
        catalog.synthesized.insert((table.clone(), index.name.clone()));
        catalog.tables.get_mut(&table).expect("catalog table").indexes.push(index);
    }
}

/// After receipts and timelines are bound (they decide which tables are
/// engine bookkeeping): lower each action, refusing what a column cannot carry.
pub(super) fn bind(catalog: &Catalog, schema: &mut core::Schema, diagnostics: &mut Vec<Diagnostic>) {
    let mut lowered: Vec<(String, String, Action)> = Vec::new();
    for (name, info) in &catalog.tables {
        if info.maintained.is_some() { continue; }
        for column in &info.decl.columns {
            let declared = column.on_delete.as_ref();
            let site = declared.map_or(&column.site, |(_, site)| site);
            let refuse = |diagnostics: &mut Vec<Diagnostic>, message: String, rewrite: String| diagnostics.push(Diagnostic::new(site, "E_REFERENCE_ACTION", message, rewrite).guide("writes"));
            let TypeKind::Ref { table: parent } = &column.type_.kind else {
                if declared.is_some() { refuse(diagnostics, format!("{name}.{} is not a reference; `on delete` belongs on a column whose type names a table", column.name), format!("{}: <table> on delete …, or remove `on delete`", column.name)); }
                continue;
            };
            if !schema.tables.contains_key(parent) || !schema.tables.contains_key(name) { continue; }
            if !schema.actionable(name) || !schema.actionable(parent) {
                if declared.is_some() {
                    refuse(diagnostics, format!("{name}.{} -> {parent} carries no delete action: ephemeral tables, engine-maintained tables and receipt or timeline bookkeeping keep their own lifetimes, so the row stays when {parent} is deleted", column.name), "remove `on delete`".into());
                }
                continue;
            }
            let chosen = declared.map_or(Action::Restrict, |(a, _)| action(*a));
            let table = &schema.tables[name];
            let through = table.through.as_ref().is_some_and(|t| t.reference == column.name);
            if chosen.writes() && let Some(reason) = references::write_target_refusal(schema, name) {
                refuse(diagnostics, format!("{} on {name}.{}: {reason}; another row's delete may not delete or rewrite its rows", chosen.words(), column.name), format!("{}: {parent} on delete restrict   -- or keep", column.name));
                continue;
            }
            if chosen == Action::Keep && through {
                refuse(diagnostics, format!("on delete keep on read-through {name}.{}: a read-through child lives within its parent (LLP 3000.014 §3), so it cannot outlive it", column.name), format!("{}: {parent} on delete cascade, or leave it undeclared (restrict)", column.name));
                continue;
            }
            if chosen == Action::SetNull && let Some(reason) = references::set_null_refusal(schema, name, table, &column.name) {
                refuse(diagnostics, format!("on delete set null on {name}.{}: {reason}", column.name), format!("{}: {parent} on delete cascade, or {}: {parent} on delete restrict", column.name, column.name));
                continue;
            }
            if chosen == Action::Cascade && through && table.is_expiring() {
                refuse(diagnostics, format!("on delete cascade on read-through {name}.{} needs a child that never expires: an expired, unswept child still holds its parent (LLP 3000.014 §3.3)", column.name),
                    format!("keep `{}: {parent}` (restrict); delete live {name} rows, let the sweep take expired ones, then delete the {parent} row", column.name));
                continue;
            }
            if chosen.writes() && schema.reference_cap(name, &column.name).is_none() {
                diagnostics.push(Diagnostic::new(site, "E_CASCADE_BOUND",
                    format!("{} on {name}.{} needs `cap N by {}`: a delete of a {parent} row writes its {name} rows in the same transaction, so the number of them must have a product limit", chosen.words(), column.name, column.name),
                    format!("cap 500 by {}   -- choose the product limit; for an unbounded relation keep `on delete restrict` and delete the {name} rows in a job first (guide writes)", column.name)).guide("writes"));
                continue;
            }
            lowered.push((name.clone(), column.name.clone(), chosen));
        }
    }
    for (name, column, chosen) in lowered {
        schema.tables.get_mut(&name).expect("bound table").on_delete.insert(column, chosen);
    }
    // A cascade must end: no table reaches itself through cascades.
    let mut reported = BTreeSet::new();
    for name in schema.tables.keys().cloned().collect::<Vec<_>>() {
        if schema.delete_reservation(&name).is_some() || !schema.is_referenced(&name) { continue; }
        let Some(r) = schema.referencing(&name).find(|r| r.action == Action::Cascade) else { continue };
        if !reported.insert((r.child.to_owned(), r.column.to_owned())) { continue; }
        let site = catalog.tables.get(r.child).and_then(|info| info.decl.columns.iter().find(|c| c.name == r.column)).map(|c| c.on_delete.as_ref().map_or(&c.site, |(_, s)| s).clone()).unwrap_or_default();
        diagnostics.push(Diagnostic::new(&site, "E_REFERENCE_ACTION", format!("on delete cascade from {name} reaches {name} again: a cascade must end, so the cascading references cannot form a cycle"),
            format!("{}: {name} on delete restrict   -- or set null on an optional reference", r.column)).guide("writes"));
    }
    for issue in references::validate(schema) {
        let site = catalog.site_for(&issue.path);
        if diagnostics.iter().any(|d| matches!(d.code.as_str(), "E_REFERENCE_ACTION" | "E_CASCADE_BOUND")) { break; }
        diagnostics.push(Diagnostic::new(&site, "E_REFERENCE_ACTION", issue.message, "declare the reference's action the line names (guide writes)").guide("writes"));
    }
}

/// Every delete site: a cascade whose reservation cannot fit its program is
/// `E_CASCADE_BOUND`; an undeclared reference that can now refuse the delete
/// is `N_DELETE_RESTRICTED` (it replaces `N_DELETE_ORPHANS`).
// @ref LLP 3000.038#7 — the note fires exactly where the restrict default changed a delete's behavior.
pub(super) fn sites(catalog: &Catalog, schema: &core::Schema, diagnostics: &mut Vec<Diagnostic>) -> Vec<Diagnostic> {
    // parent -> the undeclared references that now refuse its delete.
    let mut undeclared: BTreeMap<&str, Vec<(&str, &str)>> = BTreeMap::new();
    for (name, info) in &catalog.tables {
        for column in info.decl.columns.iter().filter(|c| c.on_delete.is_none()) {
            let TypeKind::Ref { table: parent } = &column.type_.kind else { continue };
            // A read-through child refused its parent's delete before (E_PARENT_HAS_CHILDREN).
            if info.through.as_ref().is_some_and(|t| t.reference == column.name) { continue; }
            if schema.tables.get(name).and_then(|t| t.on_delete.get(&column.name)) == Some(&Action::Restrict) {
                undeclared.entry(parent.as_str()).or_default().push((name.as_str(), column.name.as_str()));
            }
        }
    }
    let mut notes = Vec::new();
    for doc in &catalog.documents {
        for program in doc.programs.iter().filter(|p| !matches!(p.kind, ProgramKind::Query) && !p.native) {
            let mut deletes: Vec<(String, crate::diag::Site)> = Vec::new();
            let mut program = program.clone();
            let mut visit = |value: &mut Expr| if let Expr::Write { op: WriteOp::Delete, table, site, .. } = value
                && !deletes.iter().any(|(seen, _)| seen == table) { deletes.push((table.clone(), site.clone())); };
            walk::statements(&mut program.prelude, &mut visit);
            walk::statements(&mut program.body, &mut visit);
            let word = if program.kind == ProgramKind::Job { "job" } else { "mutation" };
            for (parent, site) in deletes {
                if let Some(price) = schema.delete_reservation(&parent) && let Some(over) = over_ceiling(&price, program.kind == ProgramKind::Job) {
                    let chain = schema.referencing(&parent).filter(|r| r.action.writes())
                        .map(|r| format!("{}.{} ({}, cap {})", r.child, r.column, r.action.words(), schema.reference_cap(r.child, r.column).unwrap_or(0))).collect::<Vec<_>>().join(", ");
                    diagnostics.push(Diagnostic::new(&site, "E_CASCADE_BOUND",
                        format!("{word} {}: `delete {parent}[…]` reserves {over} for what it deletes or clears through {chain}, whether or not those rows exist, so the {word} can never commit", program.name),
                        format!("lower the cap on the cascading reference; or keep `on delete restrict` there and delete those rows first in a job (`chunk`), then the {parent} row; or mark the {parent} row (`archived: bool`) and sweep it in a job (guide writes)")).guide("writes"));
                }
                // The delete reaches every table its cascades reach; their undeclared
                // references refuse it too.
                let mut reached = vec![parent.clone()];
                let mut at = 0;
                while at < reached.len() {
                    let next: Vec<String> = schema.referencing(&reached[at]).filter(|r| r.action == Action::Cascade).map(|r| r.child.to_owned()).collect();
                    for table in next { if !reached.contains(&table) { reached.push(table); } }
                    at += 1;
                }
                let kept: Vec<(&str, &str, &str)> = reached.iter().flat_map(|table| undeclared.get(table.as_str()).into_iter().flatten().map(move |(c, col)| (table.as_str(), *c, *col))).collect();
                let Some(&(target, child, column)) = kept.first() else { continue };
                let named = kept.iter().map(|(_, child, column)| format!("{child}.{column}")).collect::<Vec<_>>().join(", ");
                let through = if target == parent { String::new() } else { format!(" (through its cascade to {target})") };
                notes.push(Diagnostic::new(&site, "N_DELETE_RESTRICTED",
                    format!("{word} {}: `delete {parent}[…]`{through} now refuses E_REFERENCED while a live row references it ({named}): an undeclared reference is `on delete restrict`; before 0.5 the referencing rows stayed and named a deleted row", program.name),
                    format!("declare what deleting a {target} row does to each: `{column}: {target} on delete cascade` deletes the {child} rows (with `cap N by {column}`), `{column}: {target} ? on delete set null` clears an optional reference, `on delete keep` keeps them as before, and `on delete restrict` keeps this refusal; any declaration silences this note. Anyone whose insert rule admits a {child} row naming a {target} can hold it under restrict")).guide("writes"));
            }
        }
    }
    notes
}

/// The meter a reservation exceeds for a mutation (or a job), if any.
fn over_ceiling(price: &references::Price, job: bool) -> Option<String> {
    let c = if job { snapback4_core::Ceilings::job() } else { snapback4_core::Ceilings::default() };
    let limits = [(price[3], c.rows_written, "rows written"), (price[2], c.examined, "rows examined"), (price[1], c.index_entries, "index entries"), (price[0], c.steps, "steps"), (price[4], c.heap_bytes, "heap bytes"), (price[6], c.rule_probes, "rule probes")];
    limits.iter().find(|(used, limit, _)| used > limit).map(|(used, limit, kind)| format!("{used} {kind} (a {} may use {limit})", if job { "job chunk" } else { "mutation" }))
}
