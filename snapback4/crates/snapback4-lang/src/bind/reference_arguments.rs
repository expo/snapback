//! A table-typed argument is an id with a stronger name. Storing it in a
//! reference column still does not prove that the target row exists.

use super::{catalog::Catalog, intent_walk as walk};
use crate::{ast::{Expr, FunctionBody, ProgramKind, ReadExpr, Stmt, TypeKind, WriteOp}, diag::{Diagnostic, Site}};
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

/// Name a likely missing existence check. Known helpers count only when their
/// body actually looks up the argument; passing an id through does not.
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
            let mut candidates = Vec::new();
            let mut body: Vec<_> = program.prelude.iter().chain(&program.body).cloned().collect();
            walk::statements(&mut body, &mut |expr| match expr {
                Expr::Read(read) | Expr::Exists { read, .. } => {
                    for (name, target) in &arguments {
                        if target == &read.table && read_checks_target_id(schema, read, name, target) {
                            looked_up.insert(name.clone());
                        }
                    }
                }
                Expr::Call { name: helper, args, .. } => {
                    for (position, arg) in args.iter().enumerate() {
                        if let Expr::Name { name, .. } = arg && arguments.contains_key(name) {
                            let target = &arguments[name];
                            if helper_looks_up(catalog, schema, helper, position, target, &mut BTreeSet::new()) {
                                looked_up.insert(name.clone());
                            }
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
                if looked_up.contains(&candidate.argument) || write_contract_checks(schema, &candidate)
                    || !emitted.insert(candidate.argument.clone()) {
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

/// Inline one reference-valued helper parameter symbolically. Recursion proves
/// nothing by itself, and every successful path must perform the lookup.
fn helper_looks_up(catalog: &Catalog, schema: &Schema, name: &str, position: usize, target: &str, stack: &mut BTreeSet<String>) -> bool {
    if !stack.insert(name.to_owned()) { return false }
    let found = catalog.functions.get(name).and_then(|function| {
        let parameter = &function.args.get(position)?.name;
        Some(match &function.body {
            FunctionBody::Expression(value) => expression_must_lookup(catalog, schema, value, parameter, target, stack),
            FunctionBody::Block(body) => statements_must_lookup(catalog, schema, body, parameter, target, stack),
        })
    }).unwrap_or(false);
    stack.remove(name);
    found
}

fn statements_must_lookup(catalog: &Catalog, schema: &Schema, body: &[Stmt], parameter: &str, target: &str, stack: &mut BTreeSet<String>) -> bool {
    for statement in body {
        let expression = match statement {
            Stmt::Bind { value, .. } | Stmt::Expr { value, .. } | Stmt::Return { value, .. } => Some(value),
            Stmt::Require { condition, .. } => Some(condition),
            Stmt::Emit { payload, .. } => Some(payload),
            Stmt::If { condition, then_body, else_body, .. } => {
                if expression_must_lookup(catalog, schema, condition, parameter, target, stack)
                    || (statements_must_lookup(catalog, schema, then_body, parameter, target, stack)
                        && statements_must_lookup(catalog, schema, else_body, parameter, target, stack)) { return true }
                // Either arm can return before a later statement. Without a
                // full flow proof that later lookup is not mandatory.
                return false;
            }
            Stmt::As { principal, .. } | Stmt::For { domain: principal, .. } => Some(principal),
            Stmt::Break { .. } | Stmt::Continue { .. } => None,
        };
        if expression.is_some_and(|value| expression_must_lookup(catalog, schema, value, parameter, target, stack)) { return true }
        if matches!(statement, Stmt::Return { .. } | Stmt::Break { .. } | Stmt::Continue { .. }) { return false }
        if matches!(statement, Stmt::Bind { names, .. } if names.iter().any(|name| name == parameter)) { return false }
    }
    false
}

fn expression_must_lookup(catalog: &Catalog, schema: &Schema, expression: &Expr, parameter: &str, target: &str, stack: &mut BTreeSet<String>) -> bool {
    let child = |value: &Expr, stack: &mut BTreeSet<String>| expression_must_lookup(catalog, schema, value, parameter, target, stack);
    match expression {
        Expr::Read(read) | Expr::Exists { read, .. } if read.table == target && read_checks_target_id(schema, read, parameter, target) => true,
        Expr::Read(read) | Expr::Exists { read, .. } | Expr::Created { read, .. } => read.keys.iter().any(|key| child(&key.value, stack)),
        Expr::Unary { value, .. } | Expr::Member { base: value, .. } | Expr::Assert { value, .. } | Expr::ShapeUse { base: value, .. } => child(value, stack),
        Expr::Binary { op, left, right, .. } if matches!(op.as_str(), "and" | "or") => child(left, stack) && child(right, stack),
        Expr::Binary { left, right, .. } => child(left, stack) || child(right, stack),
        Expr::Array { items, .. } => items.iter().any(|value| child(value, stack)),
        Expr::Call { name, args, .. } => args.iter().any(|value| child(value, stack))
            || args.iter().enumerate().any(|(position, argument)| matches!(argument, Expr::Name { name, .. } if name == parameter)
                && helper_looks_up(catalog, schema, name, position, target, stack)),
        Expr::Object { fields, .. } => fields.iter().filter_map(|field| field.value.as_ref()).any(|value| child(value, stack)),
        Expr::Shape { base, fields, .. } => child(base, stack) || fields.iter().any(|field| match field {
            crate::ast::ShapeField::Field { value, .. } => child(value, stack),
            _ => false,
        }),
        Expr::If { condition, then, otherwise, .. } => child(condition, stack) || (child(then, stack) && child(otherwise, stack)),
        Expr::Walk { seed, .. } => child(seed, stack),
        Expr::Write { keys, fields, condition, .. } => keys.iter().any(|key| child(&key.value, stack))
            || fields.iter().filter_map(|field| field.value.as_ref()).any(|value| child(value, stack))
            || condition.as_deref().is_some_and(|value| child(value, stack)),
        Expr::Merge(_) | Expr::Name { .. } | Expr::Focal { .. } | Expr::Literal { .. } => false,
    }
}

fn read_checks_target_id(schema: &Schema, read: &ReadExpr, parameter: &str, target: &str) -> bool {
    let is_parameter = |value: &Expr| matches!(value, Expr::Name { name, .. } if name == parameter);
    if read.keys.iter().any(|key| key.column.as_deref() == Some("id") && is_parameter(&key.value)) { return true }
    if read.keys.iter().any(|key| key.column.is_some()) { return false }
    let index = read.index.as_deref().or(Some("byId")).and_then(|name| schema.table(target)?.index(name));
    index.is_some_and(|index| index.columns().iter().zip(&read.keys).any(|(column, key)| column == "id" && is_parameter(&key.value)))
}

fn write_contract_checks(schema: &Schema, candidate: &Candidate) -> bool {
    let Some(table) = schema.table(&candidate.child) else { return false };
    if table.through.as_ref().is_some_and(|through| through.reference == candidate.column) { return true }
    let rule_checks = |rule: &RuleExpr| rule_checks_target(schema, rule, &candidate.target, &candidate.column);
    let final_exists = || table.constraints.iter().any(|constraint| {
        matches!(constraint, Constraint::FinalExistsOnInsert { table, index, key }
            if table == &candidate.target && probe_checks_target_id(schema, table, index, key, &[], &candidate.column))
    });
    match candidate.op {
        WriteOp::Insert => rule_checks(&table.rules.insert) || final_exists(),
        WriteOp::Update => rule_checks(&table.rules.update),
        WriteOp::Upsert => (rule_checks(&table.rules.insert) || final_exists()) && rule_checks(&table.rules.update),
        WriteOp::Delete => true,
    }
}

fn rule_checks_target(schema: &Schema, rule: &RuleExpr, target: &str, column: &str) -> bool {
    match rule {
        RuleExpr::And(items) => items.iter().any(|item| rule_checks_target(schema, item, target, column)),
        RuleExpr::Or(items) => !items.is_empty() && items.iter().all(|item| rule_checks_target(schema, item, target, column)),
        RuleExpr::Not(_) => false,
        RuleExpr::Eq(left, right) | RuleExpr::Ne(left, right) | RuleExpr::Compare(_, left, right) => {
            [left, right].iter().any(|term| term_looks_up_column(term, column))
        }
        RuleExpr::Exists { table, index, key, equalities, .. } | RuleExpr::Created { table, index, key, equalities, .. } => {
            table == target && probe_checks_target_id(schema, table, index, key, equalities, column)
        }
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => false,
    }
}

/// A target probe through an alias does not establish the stored reference id.
fn probe_checks_target_id(schema: &Schema, target: &str, index: &str, key: &[RuleTerm], equalities: &[(String, RuleTerm)], column: &str) -> bool {
    let indexed_id = schema.table(target).and_then(|table| table.index(index)).is_some_and(|index| {
        index.columns().iter().zip(key).any(|(target_column, term)| target_column == "id" && term_reads_new_column(term, column))
    });
    indexed_id || equalities.iter().any(|(target_column, term)| target_column == "id" && term_reads_new_column(term, column))
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
