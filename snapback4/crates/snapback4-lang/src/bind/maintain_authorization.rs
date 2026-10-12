//! Point maintains whose audience is narrower than their query need an
//! explicit authorization decision before the lookup.

use super::catalog::Catalog;
use crate::{ast::{Effect, Expr, ProgramKind, ReadExpr, RuleDecl, Stmt}, diag::Diagnostic};
use snapback4_core::schema::{RuleExpr, Schema};
use std::collections::{BTreeMap, BTreeSet};

/// A bare maintained point exposes three outcomes: value, authorized zero,
/// and hidden null. Name that decision when no dominating requirement makes
/// the query's refusal contract explicit.
// @ref LLP 3000.013#14.7 — hidden hit and miss are both null; only an admitted
// absent group has the aggregate identity.
pub(super) fn notes(catalog: &Catalog, schema: &Schema) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    let mut seen = BTreeSet::new();
    for doc in &catalog.documents {
        for program in doc.programs.iter().filter(|program| program.kind == ProgramKind::Query && !program.native) {
            let mut requirements: Vec<Expr> = Vec::new();
            let statements: Vec<_> = program.prelude.iter().chain(&program.body).cloned().collect();
            inspect(&statements, &mut requirements, &mut |read, requirements| {
                let Some(info) = catalog.tables.get(&read.table) else { return };
                let Some(maintain) = &info.maintained else { return };
                let Some(table) = schema.table(&read.table) else { return };
                let expected = info.decl.rules.iter().find(|rule| rule.effect == Effect::Read)
                    .and_then(|rule| substituted_view_rule(maintain, rule, read));
                if expected.as_ref().is_some_and(|expected| constant_bool(expected) == Some(true))
                    || expected.as_ref().is_some_and(|expected| requirements.iter().any(|condition| canonical(condition.clone()) == canonical(expected.clone())))
                    || read.range.is_some() || read.keys.len() != maintain.by.len()
                    || table.rules.read.is_uniformly_readable() || matches!(table.rules.read, RuleExpr::Deny)
                    || !seen.insert((program.site.file.clone(), program.name.clone(), read.table.clone())) {
                    return;
                }
                notes.push(Diagnostic::new(&read.site, "N_MAINTAIN_AUTHORIZATION",
                    format!("query {} returns bare maintained point {}: its read rule is narrower than the query's callers, so an admitted hit returns its value, an admitted miss returns zero, and a hidden hit or miss returns null", program.name, read.table),
                    format!("add `require <the matching {} read condition> else NOT_ALLOWED` before this lookup, or return and handle the nullable result when unauthorized callers are intentional", read.table)).guide("maintains"));
            });
        }
    }
    notes
}

/// Visit returns with the requirements that still dominate them. Branches
/// carry independent facts; a fact survives a join only when both arms keep
/// it. A loop may run, so an assignment in its body invalidates the fact
/// after the loop too. An `as` body starts under another viewer.
fn inspect(statements: &[Stmt], requirements: &mut Vec<Expr>, visit: &mut impl FnMut(&ReadExpr, &[Expr])) {
    for statement in statements {
        match statement {
            Stmt::Require { condition, .. } => requirements.push(condition.clone()),
            Stmt::Bind { names, .. } => requirements.retain(|condition| !mentions_any(condition, names)),
            Stmt::Return { value: Expr::Read(read), .. } => visit(read, requirements),
            Stmt::If { then_body, else_body, .. } => {
                let mut then_requirements = requirements.clone();
                inspect(then_body, &mut then_requirements, visit);
                let mut else_requirements = requirements.clone();
                inspect(else_body, &mut else_requirements, visit);
                then_requirements.retain(|condition| contains(&else_requirements, condition));
                then_requirements.dedup_by(|left, right| canonical(left.clone()) == canonical(right.clone()));
                *requirements = then_requirements;
            }
            Stmt::For { name, body, .. } => {
                // A later iteration enters with every assignment from the
                // preceding one. Invalidate loop-carried requirements before
                // visiting returns in the body, not only after the loop.
                let mut assigned = BTreeSet::new();
                assigned_names(body, &mut assigned);
                let assigned: Vec<_> = assigned.into_iter().collect();
                let mut body_requirements = requirements.clone();
                body_requirements.retain(|condition| !mentions_any(condition, &assigned));
                body_requirements.retain(|condition| !mentions_any(condition, std::slice::from_ref(name)));
                inspect(body, &mut body_requirements, visit);
                requirements.retain(|condition| !mentions_any(condition, &assigned));
            }
            Stmt::As { body, .. } => {
                let mut scoped = Vec::new();
                inspect(body, &mut scoped, visit);
                let mut assigned = BTreeSet::new();
                assigned_names(body, &mut assigned);
                let assigned: Vec<_> = assigned.into_iter().collect();
                requirements.retain(|condition| !mentions_any(condition, &assigned));
            }
            Stmt::Expr { .. } | Stmt::Emit { .. } | Stmt::Break { .. } | Stmt::Continue { .. }
            | Stmt::Return { .. } => {}
        }
    }
}

fn contains(requirements: &[Expr], condition: &Expr) -> bool {
    let condition = canonical(condition.clone());
    requirements.iter().any(|candidate| canonical(candidate.clone()) == condition)
}

fn assigned_names(statements: &[Stmt], names: &mut BTreeSet<String>) {
    for statement in statements {
        match statement {
            Stmt::Bind { names: assigned, .. } => names.extend(assigned.iter().cloned()),
            Stmt::If { then_body, else_body, .. } => {
                assigned_names(then_body, names);
                assigned_names(else_body, names);
            }
            Stmt::As { body, .. } | Stmt::For { body, .. } => assigned_names(body, names),
            _ => {}
        }
    }
}

fn mentions_any(expression: &Expr, names: &[String]) -> bool {
    let mut expression = expression.clone();
    let mut found = false;
    super::intent_walk::expression(&mut expression, &mut |expr| {
        if let Expr::Name { name, .. } = expr
            && names.contains(name) {
            found = true;
        }
    });
    found
}

/// Exact substitution is deliberately conservative: an unrelated requirement
/// must not hide the note, and a guard we cannot prove equivalent keeps it.
fn substituted_view_rule(maintain: &crate::ast::MaintainDecl, rule: &RuleDecl, read: &ReadExpr) -> Option<Expr> {
    if maintain.by.len() != read.keys.len() { return None }
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
    Some(expected)
}

/// Evaluate only identities whose truth follows from the authored expression
/// itself. A key such as `counts[viewer]` proves `.owner = viewer`; a probe or
/// comparison with an argument remains caller-dependent.
fn constant_bool(expression: &Expr) -> Option<bool> {
    match expression {
        Expr::Name { name, .. } if matches!(name.as_str(), "allow" | "public" | "true") => Some(true),
        Expr::Name { name, .. } if matches!(name.as_str(), "deny" | "false") => Some(false),
        Expr::Literal { value: crate::ast::Literal::Bool(value), .. } => Some(*value),
        Expr::Unary { op, value, .. } if op == "not" => constant_bool(value).map(|value| !value),
        Expr::Binary { op, left, right, .. } if op == "and" => match (constant_bool(left), constant_bool(right)) {
            (Some(false), _) | (_, Some(false)) => Some(false),
            (Some(true), Some(true)) => Some(true),
            _ => None,
        },
        Expr::Binary { op, left, right, .. } if op == "or" => match (constant_bool(left), constant_bool(right)) {
            (Some(true), _) | (_, Some(true)) => Some(true),
            (Some(false), Some(false)) => Some(false),
            _ => None,
        },
        Expr::Binary { op, left, right, .. } if matches!(op.as_str(), "=" | "!=")
            && canonical(left.as_ref().clone()) == canonical(right.as_ref().clone()) => Some(op == "="),
        _ => None,
    }
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
