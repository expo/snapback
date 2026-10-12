//! A table-typed argument is an id with a stronger name. Storing it in a
//! reference column still does not prove that the target row exists.

use super::{catalog::Catalog, intent_walk as walk};
use crate::{ast::{Expr, ProgramKind, TypeKind, WriteOp}, diag::{Diagnostic, Site}};
use snapback4_core::schema::{Constraint, RuleExpr, RuleTerm, Schema};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone)]
struct Candidate {
    argument: String,
    target: String,
    child: String,
    column: String,
    op: WriteOp,
    site: Site,
}

/// Name a likely missing existence check while leaving opaque helpers alone:
/// they may deliberately own that check.
// @ref LLP 3000.039#7 — reference types validate id shape, never target
// existence; `N_REFERENCE_UNCHECKED` points to the explicit lookup form.
pub(super) fn notes(catalog: &Catalog, schema: &Schema) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for doc in &catalog.documents {
        for program in doc.programs.iter().filter(|program| program.kind == ProgramKind::Mutation && !program.native) {
            let arguments: BTreeMap<String, String> = program.args.iter().filter_map(|arg| match &arg.type_.kind {
                TypeKind::Ref { table } => Some((arg.name.clone(), table.clone())),
                _ => None,
            }).collect();
            if arguments.is_empty() { continue; }

            let mut looked_up = BTreeSet::new();
            let mut opaque = BTreeSet::new();
            let mut candidates = Vec::new();
            let mut body: Vec<_> = program.prelude.iter().chain(&program.body).cloned().collect();
            walk::statements(&mut body, &mut |expr| match expr {
                Expr::Read(read) | Expr::Exists { read, .. } => {
                    for key in &read.keys {
                        if let Expr::Name { name, .. } = &key.value
                            && arguments.get(name).is_some_and(|target| target == &read.table) {
                            looked_up.insert(name.clone());
                        }
                    }
                }
                Expr::Call { args, .. } => {
                    for arg in args {
                        if let Expr::Name { name, .. } = arg && arguments.contains_key(name) {
                            opaque.insert(name.clone());
                        }
                    }
                }
                Expr::Write { op, table, fields, site, .. } if *op != WriteOp::Delete => {
                    let Some(child) = catalog.tables.get(table) else { return };
                    for field in fields {
                        let Some(kind) = child.columns.get(&field.name) else { continue };
                        let TypeKind::Ref { table: target } = &kind.kind else { continue };
                        let argument = match &field.value {
                            Some(Expr::Name { name, .. }) => name,
                            None => &field.name,
                            _ => continue,
                        };
                        if arguments.get(argument) != Some(target) { continue }
                        candidates.push(Candidate { argument: argument.clone(), target: target.clone(), child: table.clone(), column: field.name.clone(), op: *op, site: site.clone() });
                    }
                }
                _ => {}
            });

            let mut emitted = BTreeSet::new();
            for candidate in candidates {
                if looked_up.contains(&candidate.argument) || opaque.contains(&candidate.argument)
                    || write_contract_checks(schema, &candidate) || !emitted.insert(candidate.argument.clone()) {
                    continue;
                }
                notes.push(Diagnostic::new(&candidate.site, "N_REFERENCE_UNCHECKED",
                    format!("mutation {} stores argument {} directly in {}.{}, but never looks up {}[{}]: a reference accepts any well-formed id even when the row is absent", program.name, candidate.argument, candidate.child, candidate.column, candidate.target, candidate.argument),
                    format!("bind `parent = {}[{}] ! else NOT_FOUND` before the write, then store `parent.id`; keep the direct id only when dangling references are intentional", candidate.target, candidate.argument)).guide("types"));
            }
        }
    }
    notes
}

fn write_contract_checks(schema: &Schema, candidate: &Candidate) -> bool {
    let Some(table) = schema.table(&candidate.child) else { return false };
    if table.through.as_ref().is_some_and(|through| through.reference == candidate.column) { return true }
    let rule_checks = |rule: &RuleExpr| rule_checks_target(rule, &candidate.target, &candidate.column);
    let final_exists = || table.constraints.iter().any(|constraint| {
        matches!(constraint, Constraint::FinalExistsOnInsert { table, key, .. }
            if table == &candidate.target && key.iter().any(|term| term_reads_new_column(term, &candidate.column)))
    });
    match candidate.op {
        WriteOp::Insert => rule_checks(&table.rules.insert) || final_exists(),
        WriteOp::Update => rule_checks(&table.rules.update),
        WriteOp::Upsert => (rule_checks(&table.rules.insert) || final_exists()) && rule_checks(&table.rules.update),
        WriteOp::Delete => true,
    }
}

fn rule_checks_target(rule: &RuleExpr, target: &str, column: &str) -> bool {
    match rule {
        RuleExpr::And(items) => items.iter().any(|item| rule_checks_target(item, target, column)),
        RuleExpr::Or(items) => !items.is_empty() && items.iter().all(|item| rule_checks_target(item, target, column)),
        RuleExpr::Not(_) => false,
        RuleExpr::Eq(left, right) | RuleExpr::Ne(left, right) | RuleExpr::Compare(_, left, right) => {
            [left, right].iter().any(|term| term_looks_up_column(term, column))
        }
        RuleExpr::Exists { table, key, equalities, .. } | RuleExpr::Created { table, key, equalities, .. } => {
            table == target && key.iter().chain(equalities.iter().map(|(_, term)| term)).any(|term| term_reads_new_column(term, column))
        }
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => false,
    }
}

/// Only the image being stored proves the new argument exists. An old-image
/// field or reference hop checks the row's previous parent and says nothing
/// about the replacement supplied by this mutation.
fn term_reads_new_column(term: &RuleTerm, column: &str) -> bool {
    matches!(term, RuleTerm::Field(field) | RuleTerm::NextField(field) if field == column)
        || term_looks_up_column(term, column)
}

fn term_looks_up_column(term: &RuleTerm, column: &str) -> bool {
    term.reference_source().is_some_and(|(source, old)| source == column && !old)
}
