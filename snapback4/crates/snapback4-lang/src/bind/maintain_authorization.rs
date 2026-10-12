//! Point maintains whose audience is narrower than their query need an
//! explicit authorization decision before the lookup.

use super::catalog::Catalog;
use crate::{ast::{Expr, ProgramKind, ReadExpr, Stmt}, diag::Diagnostic};
use snapback4_core::schema::{RuleExpr, Schema};
use std::collections::{BTreeMap, BTreeSet};

/// A bare maintained point exposes three outcomes: value, authorized zero,
/// and hidden null. Name that decision when no earlier top-level requirement
/// makes the query's refusal contract explicit.
// @ref LLP 3000.013#14.7 — hidden hit and miss are both null; only an admitted
// absent group has the aggregate identity.
pub(super) fn notes(catalog: &Catalog, schema: &Schema) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    let mut seen = BTreeSet::new();
    for doc in &catalog.documents {
        for program in doc.programs.iter().filter(|program| program.kind == ProgramKind::Query && !program.native) {
            let mut requirements = Vec::new();
            for statement in program.prelude.iter().chain(&program.body) {
                if let Stmt::Require { condition, .. } = statement {
                    requirements.push(condition);
                    continue;
                }
                let Stmt::Return { value: Expr::Read(read), .. } = statement else { continue };
                let Some(info) = catalog.tables.get(&read.table) else { continue };
                let Some(maintain) = &info.maintained else { continue };
                let Some(table) = schema.table(&read.table) else { continue };
                if requirements.iter().any(|condition| matches_view_rule(condition, maintain, read))
                    || read.range.is_some() || read.keys.len() != maintain.by.len()
                    || table.rules.read.is_uniformly_readable() || matches!(table.rules.read, RuleExpr::Deny)
                    || !seen.insert((program.site.file.clone(), program.name.clone(), read.table.clone())) {
                    continue;
                }
                notes.push(Diagnostic::new(&read.site, "N_MAINTAIN_AUTHORIZATION",
                    format!("query {} returns bare maintained point {}: its read rule is narrower than the query's callers, so an admitted hit returns its value, an admitted miss returns zero, and a hidden hit or miss returns null", program.name, read.table),
                    format!("add `require <the matching {} read condition> else NOT_ALLOWED` before this lookup, or return and handle the nullable result when unauthorized callers are intentional", read.table)).guide("maintains"));
            }
        }
    }
    notes
}

/// Exact substitution is deliberately conservative: an unrelated requirement
/// must not hide the note, and a guard we cannot prove equivalent keeps it.
fn matches_view_rule(condition: &Expr, maintain: &crate::ast::MaintainDecl, read: &ReadExpr) -> bool {
    let Some(rule) = &maintain.read else { return false };
    if maintain.by.len() != read.keys.len() { return false }
    let mut keys: BTreeMap<String, Expr> = maintain.by.iter().map(|field| field.trim_start_matches('.').to_owned())
        .zip(read.keys.iter().map(|key| key.value.clone())).collect();
    for key in &read.keys {
        if let Some(column) = &key.column { keys.insert(column.clone(), key.value.clone()); }
    }
    let mut expected = rule.value.clone();
    super::intent_walk::expression(&mut expected, &mut |expr| {
        if let Expr::Member { base, name, .. } = expr
            && matches!(base.as_ref(), Expr::Focal { .. })
            && let Some(value) = keys.get(name) {
            *expr = value.clone();
        }
    });
    canonical(expected) == canonical(condition.clone())
}

fn canonical(mut expression: Expr) -> String {
    super::intent_walk::expression(&mut expression, &mut |expr| {
        if let Expr::Read(read) | Expr::Exists { read, .. } | Expr::Created { read, .. } = expr {
            for key in &mut read.keys {
                if key.column.as_deref() == Some("id") { key.column = None; }
            }
        }
    });
    crate::print::expression(&expression)
}
