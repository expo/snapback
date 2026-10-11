//! N_DELETE_ORPHANS: a mutation deletes a row that other tables reference and
//! writes none of those tables. A reference is a typed id with no cascade, so
//! the children stay and point at a deleted row (wave 5 lane 081: cancelling a
//! screening kept its RSVPs; the roster listed them, `screeningCard` was null).
//! This states what happens; it does not change it. Whether a parent delete
//! should refuse while children exist or cascade is an open design question
//! (LLP 3000.036 §15.8). A read-through child already refuses the delete
//! (E_PARENT_HAS_CHILDREN), so it is not named here.
// @ref LLP 3000.036#15.8 — a note, not a semantic: parent deletes do not cascade.
use super::{catalog::Catalog, intent_walk as walk};
use crate::{ast::*, diag::Diagnostic};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn notes(catalog: &mut Catalog) {
    // parent table -> [(child table, reference column)]
    let mut children: BTreeMap<&str, Vec<(&str, &str)>> = BTreeMap::new();
    for (name, info) in &catalog.tables {
        if info.maintained.is_some() || info.decl.ephemeral.is_some() { continue; }
        for (column, ty) in &info.columns {
            let TypeKind::Ref { table: parent } = &ty.kind else { continue };
            if info.through.as_ref().is_some_and(|through| &through.reference == column) { continue; }
            if parent != name { children.entry(parent.as_str()).or_default().push((name.as_str(), column.as_str())); }
        }
    }
    if children.is_empty() { return; }
    let mut notes = Vec::new();
    for doc in &mut catalog.documents {
        for program in doc.programs.iter_mut().filter(|program| !matches!(program.kind, ProgramKind::Query) && !program.native) {
            let mut written = BTreeSet::new();
            let mut deletes: Vec<(String, crate::diag::Site)> = Vec::new();
            // A program that writes or reads a child table (a cleanup loop, or a
            // `require not exists child where …` guard) is taken to handle it.
            let mut visit = |value: &mut Expr| match value {
                Expr::Write { op, table, site, .. } => {
                    written.insert(table.clone());
                    if *op == WriteOp::Delete && !deletes.iter().any(|(seen, _)| seen == table) { deletes.push((table.clone(), site.clone())); }
                }
                Expr::Read(read) | Expr::Exists { read, .. } => { written.insert(read.table.clone()); }
                _ => {}
            };
            walk::statements(&mut program.prelude, &mut visit);
            walk::statements(&mut program.body, &mut visit);
            for (parent, site) in deletes {
                let Some(kept) = children.get(parent.as_str()) else { continue };
                let kept: Vec<_> = kept.iter().filter(|(child, _)| !written.contains(*child)).collect();
                let Some((child, column)) = kept.first() else { continue };
                let named = kept.iter().map(|(child, column)| format!("{child}.{column}")).collect::<Vec<_>>().join(", ");
                notes.push(Diagnostic::new(&site, "N_DELETE_ORPHANS",
                    format!("{} {}: `delete {parent}[…]` keeps the rows that reference it ({named}); a reference does not cascade, so they name a deleted {parent} row and reading it through them gives null", if program.kind == ProgramKind::Job { "job" } else { "mutation" }, program.name),
                    format!("delete or retarget them in {} first (`for row in {child} where .{column} = <the deleted id>:` then `delete {child}[row.id]`; `check` then says what bound and admission the loop needs), or keep the {parent} row and mark it instead (`update {parent}[…] {{ … }}`) if the {child} rows should stay readable", program.name)).guide("writes"));
            }
        }
    }
    catalog.planner_notes.extend(notes);
}
