//! Deliberately narrow evidence: a written field is a scalar maintain read.
//! Matching column names, types, group keys or counter increments alone are
//! not evidence that two values mean the same thing.
use crate::{ast::{self, Expr, Stmt}, diag::Diagnostic};
use snapback4_core::schema::{Audience, Constraint, RuleExpr, RuleTerm, Schema};
use std::collections::BTreeSet;
use super::catalog::Catalog;

// @ref LLP 3000.007#20.20 — a maintain owns its target; a handwritten copy retains the target table's ordinary write authority.
pub(super) fn notes(catalog: &Catalog, schema: &Schema) -> Vec<Diagnostic> {
    let mut copies = BTreeSet::new();
    for doc in &catalog.documents {
        for program in &doc.programs {
            body(&program.prelude, &mut copies);
            body(&program.body, &mut copies);
        }
        for function in &doc.functions {
            match &function.body {
                ast::FunctionBody::Expression(value) => expr(value, &mut copies),
                ast::FunctionBody::Block(stmts) => body(stmts, &mut copies),
            }
        }
    }
    copies.into_iter().filter_map(|(table, column, aggregate)| {
        let target = schema.table(&table)?;
        let maintain = schema.maintain_for(&aggregate)?;
        if maintain.source == table || schema.maintain_for(&table).is_some()
            || !(target.rules.read.is_uniformly_readable() || target.sync.as_ref().is_some_and(|sync| sync.audience == Audience::Public))
            || truth(&target.rules.update) != Some(true)
            || target.constraints.iter().any(|constraint| matches!(constraint, Constraint::AppendOnly) || matches!(constraint, Constraint::Immutable { fields } if fields.contains(&column))) {
            return None;
        }
        let site = catalog.site_for(&format!("tables.{table}.columns.{column}"));
        let rule = target.rules.update.quarry();
        Some(Diagnostic::new(&site, "N_PUBLIC_AGGREGATE_COPY",
            format!("column {table}.{column} copies maintain {aggregate}, an aggregate of {} the engine already keeps; `update <- {rule}` lets any principal set this public column through a mutation that writes it", maintain.source),
            format!("read maintain {aggregate} directly, or restrict the update rule on {table} so callers cannot choose {column}; restrict its insert rule too if callers can supply the initial value"))
            .guide("feeds"))
    }).collect()
}

/// Only prove simple unconditional rules; a row/probe-dependent rule is
/// unknown, never assumed unrestricted. This is not an authorization checker.
fn truth(rule: &RuleExpr) -> Option<bool> {
    match rule {
        RuleExpr::Allow | RuleExpr::Public { .. } => Some(true),
        RuleExpr::Deny => Some(false),
        RuleExpr::Not(inner) => truth(inner).map(|value| !value),
        RuleExpr::And(terms) | RuleExpr::Or(terms) => {
            let and = matches!(rule, RuleExpr::And(_));
            let values: Vec<_> = terms.iter().map(truth).collect();
            if values.contains(&Some(!and)) { Some(!and) }
            else if values.iter().all(|value| *value == Some(and)) { Some(and) }
            else { None }
        }
        RuleExpr::Eq(left, right) | RuleExpr::Ne(left, right) => {
            let equal = match (left, right) {
                (RuleTerm::Viewer, RuleTerm::Viewer) => true,
                (RuleTerm::Literal(left), RuleTerm::Literal(right)) => left == right,
                _ => return None,
            };
            Some(if matches!(rule, RuleExpr::Eq(..)) { equal } else { !equal })
        }
        _ => None,
    }
}

type Copies = BTreeSet<(String, String, String)>;

fn body(stmts: &[Stmt], copies: &mut Copies) {
    for stmt in stmts {
        match stmt {
            Stmt::Bind { value, .. } | Stmt::Expr { value, .. } | Stmt::Return { value, .. } => expr(value, copies),
            Stmt::Require { condition, .. } => expr(condition, copies),
            Stmt::Emit { payload, .. } => expr(payload, copies),
            Stmt::If { condition, then_body, else_body, .. } => {
                expr(condition, copies); body(then_body, copies); body(else_body, copies);
            }
            Stmt::For { domain, body: stmts, .. } => { expr(domain, copies); body(stmts, copies); }
            Stmt::Break { .. } | Stmt::Continue { .. } => {}
        }
    }
}

fn expr(value: &Expr, copies: &mut Copies) {
    match value {
        Expr::Write { table, fields, .. } => {
            for field in fields {
                if let Some(Expr::Read(read)) = &field.value && read.range.is_none() {
                    copies.insert((table.clone(), field.name.clone(), read.table.clone()));
                }
                if let Some(value) = &field.value { expr(value, copies); }
            }
        }
        Expr::Unary { value, .. } | Expr::Member { base: value, .. } | Expr::Assert { value, .. }
            | Expr::ShapeUse { base: value, .. } => expr(value, copies),
        Expr::Binary { left, right, .. } => { expr(left, copies); expr(right, copies); }
        Expr::If { then, condition, otherwise, .. } => { expr(then, copies); expr(condition, copies); expr(otherwise, copies); }
        Expr::Array { items, .. } | Expr::Call { args: items, .. } => { for item in items { expr(item, copies); } }
        Expr::Object { fields, .. } => { for field in fields { if let Some(value) = &field.value { expr(value, copies); } } }
        Expr::Shape { base, fields, .. } => {
            expr(base, copies);
            for field in fields { if let ast::ShapeField::Field { value, .. } = field { expr(value, copies); } }
        }
        _ => {}
    }
}
