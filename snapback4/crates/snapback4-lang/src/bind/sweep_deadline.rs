//! Advisory only: direct scheduled status transitions and their mutation readers.
// @ref LLP 3000.013.002#5 — a sweep is not an exact deadline; this lint is not a safety proof.
use super::catalog::Catalog;
use crate::{ast::*, diag::Diagnostic};
use std::collections::{BTreeMap, BTreeSet};

fn read_table(expr: &Expr) -> Option<&str> {
    match expr { Expr::Name { name, .. } => Some(name), Expr::Read(read) => Some(&read.table), Expr::Assert { value, .. } => read_table(value), _ => None }
}
fn aliases(body: &[Stmt], out: &mut BTreeMap<String, String>) {
    for stmt in body {
        match stmt {
            Stmt::Bind { names, value, .. } if names.len() == 1 => {
                if let Some(table) = read_table(value) { out.insert(names[0].clone(), table.into()); }
            }
            Stmt::For { name, domain, body, .. } => {
                if let Some(table) = read_table(domain) { out.insert(name.clone(), table.into()); }
                aliases(body, out);
            }
            Stmt::If { then_body, else_body, .. } => { aliases(then_body, out); aliases(else_body, out); }
            Stmt::As { body, .. } => aliases(body, out),
            _ => {}
        }
    }
}
fn member(expr: &Expr, aliases: &BTreeMap<String, String>) -> Option<(String, String, String)> {
    let Expr::Member { base, name: field, .. } = expr else { return None };
    let Expr::Name { name, .. } = base.as_ref() else { return None };
    Some((aliases.get(name)?.clone(), field.clone(), name.clone()))
}
fn clock(expr: &Expr, period: bool) -> bool {
    let mut found = false;
    super::intent_walk::expression(&mut expr.clone(), &mut |e| {
        if matches!(e, Expr::Name { name, .. } if name == "now" || (period && name == "periodEnd")) { found = true; }
    }); found
}
fn comparisons(body: &[Stmt], aliases: &BTreeMap<String, String>, period: bool) -> Vec<(String, String, String, Expr)> {
    let mut out = Vec::new();
    super::intent_walk::statements(&mut body.to_vec(), &mut |expr| {
        if let Expr::Binary { op, left, right, .. } = &*expr && ["<", "<=", ">", ">="].contains(&op.as_str()) {
            for (value, time) in [(left.as_ref(), right.as_ref()), (right.as_ref(), left.as_ref())] {
                if clock(time, period) && let Some((table, field, name)) = member(value, aliases) {
                    out.push((table, field, name, expr.clone()));
                }
            }
        }
    }); out
}
fn condition_fields(body: &[Stmt], aliases: &BTreeMap<String, String>, out: &mut BTreeSet<(String, String, String)>) {
    for stmt in body {
        let condition = match stmt {
            Stmt::Require { condition, .. } | Stmt::If { condition, .. } => Some(condition),
            _ => None,
        };
        if let Some(condition) = condition {
            super::intent_walk::expression(&mut condition.clone(), &mut |expr| {
                if let Some(field) = member(expr, aliases) { out.insert(field); }
            });
        }
        match stmt {
            Stmt::For { body, .. } | Stmt::As { body, .. } => condition_fields(body, aliases, out),
            Stmt::If { then_body, else_body, .. } => { condition_fields(then_body, aliases, out); condition_fields(else_body, aliases, out); }
            _ => {}
        }
    }
}
fn literal_updates(body: &[Stmt]) -> BTreeSet<(String, String)> {
    let mut writes = BTreeSet::new();
    super::intent_walk::statements(&mut body.to_vec(), &mut |expr| {
        if let Expr::Write { op: WriteOp::Update, table, fields, .. } = expr {
            for field in fields {
                if matches!(field.value, Some(Expr::Literal { value: Literal::Str(_) | Literal::Bool(_), .. })) {
                    writes.insert((table.clone(), field.name.clone()));
                }
            }
        }
    });
    writes
}
pub(super) fn notes(catalog: &Catalog) -> Vec<Diagnostic> {
    let programs: Vec<_> = catalog.documents.iter().flat_map(|doc| {
        let module = std::path::Path::new(&doc.file).file_stem().and_then(|s| s.to_str()).unwrap_or("schema");
        doc.programs.iter().map(move |program| (if module == "schema" { program.name.clone() } else { format!("{module}.{}", program.name) }, program))
    }).collect();
    let scheduled: BTreeSet<_> = catalog.documents.iter().flat_map(|doc| &doc.schedules).map(|s| s.target.as_str()).collect();
    let mut notes = Vec::new();
    let mut emitted = BTreeSet::new();
    for (job_name, job) in programs.iter().filter(|(name, p)| p.kind == ProgramKind::Job && !p.native && scheduled.contains(name.as_str())) {
        let mut bindings = BTreeMap::new(); aliases(&job.body, &mut bindings);
        let deadlines = comparisons(&job.body, &bindings, true);
        let writes = literal_updates(&job.body);
        let mut job_conditions = BTreeSet::new();
        condition_fields(&job.body, &bindings, &mut job_conditions);
        for (mutation_name, mutation) in programs.iter().filter(|(_, p)| p.kind == ProgramKind::Mutation && !p.native) {
            let mut bindings = BTreeMap::new(); aliases(&mutation.body, &mut bindings);
            let mut conditions = BTreeSet::new(); condition_fields(&mutation.body, &bindings, &mut conditions);
            let checked = comparisons(&mutation.body, &bindings, false);
            let mutation_writes = literal_updates(&mutation.body);
            for (table, deadline, _job_alias, _comparison) in &deadlines {
                if !catalog.tables.get(table).and_then(|info| info.columns.get(deadline)).is_some_and(|column| matches!(column.kind, TypeKind::Time)) { continue; }
                for (target, status, alias) in &conditions {
                    let direct = writes.contains(&(table.clone(), status.clone()));
                    let coupled = writes.iter().any(|(t, _)| t == table)
                        && job_conditions.iter().any(|(t, field, _)| t == table && field == status)
                        && mutation_writes.contains(&(table.clone(), status.clone()));
                    if target != table || (!direct && !coupled)
                        || checked.iter().any(|(t, f, a, _)| t == table && f == deadline && a == alias)
                        || !emitted.insert((mutation_name.clone(), table.clone(), deadline.clone(), status.clone())) { continue; }
                    let relation = if direct { format!("tests {alias}.{status} (column {table}.{status}); scheduled job {job_name} has a literal update of that column") }
                        else { format!("tests {alias}.{status} and writes column {table}.{status}; scheduled job {job_name} also tests that column") };
                    notes.push(Diagnostic::new(&mutation.site, "N_SWEEP_DEADLINE",
                        format!("mutation {mutation_name} {relation}; the job contains a time comparison on {table}.{deadline}; no direct comparison of {alias}.{deadline} with now was found. A sweep-written status can lag a time boundary; this syntactic advisory is not a proof of control flow, row identity or safety, or a security finding"),
                        format!("if this is an operation deadline, enforce the intended time boundary on {alias}.{deadline} against now inside this mutation, choosing the opening/closing direction and equality boundary explicitly; keep the sweep for notifications/cleanup. Notification-only sweeps need no extra deadline guard; review row identity and helper guards before changing behavior")).guide("time"));
                }
            }
        }
    }
    notes
}
