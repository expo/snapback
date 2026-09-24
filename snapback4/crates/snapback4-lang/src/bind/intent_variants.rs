//! Argument-presence decisions select ordinary admitted reads, before planning.
use super::{catalog::{Catalog, TableInfo}, intent, intent_walk as walk};
use crate::{ast::*, diag::{Diagnostic, Site}};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const PRESENT: &str = "$intentPresent";
pub(super) const SEARCH: &str = "$intentSearch";
type Inputs = BTreeMap<String, bool>; // argument-only binding -> possibly optional

pub(super) fn condition(expr: &Expr) -> Option<(&str, &Expr)> {
    if let Expr::Call { name, args, .. } = expr && matches!(name.as_str(), PRESENT | SEARCH) {
        args.first().map(|arg| (name.as_str(), arg))
    } else { None }
}

// @ref LLP 3000.013#2.1 — presence alternatives share normal planning,
// authorization, admission, meters and the server/device interpreter.
pub(super) fn expand(catalog: &mut Catalog) {
    let mut notes = Vec::new();
    // Keep authored expressions in why/check output before snapshots and
    // alternatives introduce private compiler names at those same sites.
    for doc in &mut catalog.documents {
        walk::document(doc, &mut |value| {
            if let Expr::Read(read) | Expr::Exists { read, .. } = value {
                catalog.read_origins.entry(read.site.to_string()).or_insert_with(|| crate::print::read_expr(read));
            }
        });
    }
    for doc in &mut catalog.documents {
        for program in &mut doc.programs {
            let mut inputs = inputs(&program.args);
            body(&mut program.prelude, &mut inputs, &catalog.functions, &catalog.tables, &mut notes);
            body(&mut program.body, &mut inputs, &catalog.functions, &catalog.tables, &mut notes);
        }
        for function in &mut doc.functions {
            let mut inputs = inputs(&function.args);
            match &mut function.body {
                FunctionBody::Expression(value) => expression(value, &inputs, &catalog.functions, &catalog.tables, &mut notes),
                FunctionBody::Block(stmts) => body(stmts, &mut inputs, &catalog.functions, &catalog.tables, &mut notes),
            }
        }
        for shape in &mut doc.shapes {
            walk::shape(&mut shape.fields, &mut |value| rewrite(value, &Inputs::new(), &catalog.functions, &catalog.tables, &mut notes));
        }
    }
    catalog.planner_notes.extend(notes);
}

fn inputs(args: &[ArgDecl]) -> Inputs { args.iter().map(|arg| (arg.name.clone(), arg.type_.optional)).collect() }

fn input_only(value: &Expr, inputs: &Inputs, functions: &BTreeMap<String, FunctionDecl>) -> bool {
    fn check(value: &Expr, inputs: &Inputs, functions: &BTreeMap<String, FunctionDecl>, stack: &mut BTreeSet<String>) -> bool {
        match value {
            Expr::Name { name, .. } => inputs.contains_key(name),
            Expr::Literal { .. } => true,
            Expr::Unary { value, .. } | Expr::Assert { value, .. } => check(value, inputs, functions, stack),
            Expr::Binary { left, right, .. } => check(left, inputs, functions, stack) && check(right, inputs, functions, stack),
            Expr::If { condition, then, otherwise, .. } => [condition, then, otherwise].iter().all(|value| check(value, inputs, functions, stack)),
            Expr::Array { items, .. } => items.iter().all(|value| check(value, inputs, functions, stack)),
            Expr::Call { name, args, .. } => {
                if !args.iter().all(|value| check(value, inputs, functions, stack)) { return false; }
                if let Some(function) = functions.get(name) {
                    if !stack.insert(name.clone()) { return false; }
                    let mut local = self::inputs(&function.args);
                    let result = match &function.body {
                        FunctionBody::Expression(value) => check(value, &local, functions, stack),
                        FunctionBody::Block(body) => pure_body(body, &mut local, functions, stack),
                    };
                    stack.remove(name); result
                } else { ["lower", "trim", "count", "first", "last", "at", "slice", "min", "max", "join", "tokens", "range", "sha256", "share"].contains(&name.as_str()) }
            }
            _ => false,
        }
    }
    fn pure_body(body: &[Stmt], inputs: &mut Inputs, functions: &BTreeMap<String, FunctionDecl>, stack: &mut BTreeSet<String>) -> bool {
        body.iter().all(|stmt| match stmt {
            Stmt::Bind { names, value, .. } => {
                if !check(value, inputs, functions, stack) { return false; }
                for name in names { inputs.insert(name.clone(), true); } true
            }
            Stmt::Return { value, .. } | Stmt::Expr { value, .. } => check(value, inputs, functions, stack),
            Stmt::Require { condition, .. } => check(condition, inputs, functions, stack),
            Stmt::If { condition, then_body, else_body, .. } => check(condition, inputs, functions, stack)
                && pure_body(then_body, &mut inputs.clone(), functions, stack) && pure_body(else_body, &mut inputs.clone(), functions, stack),
            Stmt::For { name, domain, body, .. } => {
                if !check(domain, inputs, functions, stack) { return false; }
                let mut local = inputs.clone();
                local.insert(name.clone(), true);
                pure_body(body, &mut local, functions, stack)
            }
            _ => false,
        })
    }
    check(value, inputs, functions, &mut BTreeSet::new())
}

fn possibly_optional(value: &Expr, inputs: &Inputs) -> bool {
    match value {
        Expr::Name { name, .. } => inputs.get(name).copied().unwrap_or(true),
        Expr::Literal { value, .. } => matches!(value, Literal::Null),
        Expr::Assert { .. } | Expr::Unary { .. } => false,
        Expr::Binary { op, right, .. } => op == "??" && possibly_optional(right, inputs),
        Expr::If { then, otherwise, .. } => possibly_optional(then, inputs) || possibly_optional(otherwise, inputs),
        Expr::Array { .. } => false,
        _ => true,
    }
}

fn body(stmts: &mut [Stmt], inputs: &mut Inputs, functions: &BTreeMap<String, FunctionDecl>, tables: &BTreeMap<String, TableInfo>, notes: &mut Vec<Diagnostic>) {
    for stmt in stmts {
        match stmt {
            Stmt::Bind { names, value, .. } => {
                let only = input_only(value, inputs, functions);
                let optional = possibly_optional(value, inputs);
                expression(value, inputs, functions, tables, notes);
                for name in names { if only { inputs.insert(name.clone(), optional); } else { inputs.remove(name); } }
            }
            Stmt::If { condition, then_body, else_body, .. } => {
                expression(condition, inputs, functions, tables, notes);
                let (mut yes, mut no) = (inputs.clone(), inputs.clone());
                body(then_body, &mut yes, functions, tables, notes); body(else_body, &mut no, functions, tables, notes);
                inputs.retain(|name, optional| {
                    if let (Some(a), Some(b)) = (yes.get(name), no.get(name)) { *optional = *a || *b; true } else { false }
                });
            }
            Stmt::For { name, domain, body: stmts, .. } => {
                expression(domain, inputs, functions, tables, notes);
                let mut changed = BTreeSet::new();
                assignments(stmts, &mut changed);
                for name in changed { inputs.remove(&name); }
                let mut local = inputs.clone(); local.remove(name);
                body(stmts, &mut local, functions, tables, notes);
            }
            other => walk::statements(std::slice::from_mut(other), &mut |value| rewrite(value, inputs, functions, tables, notes)),
        }
    }
}
fn assignments(stmts: &[Stmt], names: &mut BTreeSet<String>) {
    for stmt in stmts { match stmt {
        Stmt::Bind { names: bound, .. } => names.extend(bound.iter().cloned()),
        Stmt::If { then_body, else_body, .. } => { assignments(then_body, names); assignments(else_body, names); }
        Stmt::For { body, .. } => assignments(body, names), _ => {},
    } }
}
fn expression(value: &mut Expr, inputs: &Inputs, functions: &BTreeMap<String, FunctionDecl>, tables: &BTreeMap<String, TableInfo>, notes: &mut Vec<Diagnostic>) {
    walk::expression(value, &mut |value| rewrite(value, inputs, functions, tables, notes));
}
// Snapshot a needle once: choosing its presence must not rerun a helper's
// reads or mutation effects when the selected words scan evaluates matching.
fn search_condition(needle: Expr, site: &Site) -> (Expr, Expr) {
    let name = format!("$intentNeedle{}", snapback4_core::value::digest(&site.to_string()));
    let binding = Expr::Name { name, site: site.clone() };
    (Expr::Call { name: SEARCH.into(), args: vec![needle, binding.clone()], site: site.clone() }, binding)
}

fn rewrite(value: &mut Expr, inputs: &Inputs, functions: &BTreeMap<String, FunctionDecl>, tables: &BTreeMap<String, TableInfo>, notes: &mut Vec<Diagnostic>) {
    match value {
        Expr::Merge(merge) if merge.matching.is_some() => {
            if let Some(index) = tables.get(&merge.table).and_then(|table| table.indexes.iter().find(|index| index.name == merge.index))
                && let Some((position, _)) = &index.words {
                let mut browse = merge.clone();
                browse.matching = None;
                for lane in &mut browse.lanes {
                    lane.planned = Some(Box::new(ReadExpr {
                        table: merge.table.clone(), index: Some(merge.index.clone()), computed: index.computed.clone(),
                        keys: lane.prefix.iter().enumerate().map(|(i, value)| KeyPart {
                            column: lane.columns.as_ref().and_then(|names| names.get(i).cloned().flatten()).or_else(|| index.columns.get(i).cloned()),
                            value: value.clone(), site: value.site().clone(),
                        }).collect(),
                        order_keys: index.columns[*position..].to_vec(), seeks: Vec::new(), matching: None,
                        filter: merge.filter.clone(), range: Some(RangeSpec { order: merge.order, take: merge.take, cursor: None, site: lane.site.clone() }), site: lane.site.clone(),
                    }));
                    browse_leaf(lane.planned.as_mut().unwrap(), tables);
                }
                let (condition, needle) = search_condition(*merge.matching.clone().unwrap(), &merge.site);
                let mut matching = merge.clone(); matching.matching = Some(Box::new(needle));
                *value = Expr::If { condition: Box::new(condition),
                    then: Box::new(Expr::Merge(matching)), otherwise: Box::new(Expr::Merge(browse)), site: merge.site.clone() };
            }
        }
        Expr::Read(_) | Expr::Exists { .. } => {
            let exists = matches!(value, Expr::Exists { .. });
            let read = match value { Expr::Read(read) | Expr::Exists { read, .. } => read, _ => unreachable!() };
            if let Some(planned) = variants(read, exists, inputs, tables, functions, notes) { *value = planned; }
        }
        Expr::Call { name, args, site } if matches!(name.as_str(), "count" | "sum") && !functions.contains_key(name)
            && args.first().is_some_and(|arg| matches!(arg, Expr::If { condition: test, .. } if condition(test).is_some())) => {
                *value = lift(name, args, site, tables, &inputs.iter().filter(|(_, optional)| !**optional).map(|(name, _)| name.clone()).collect());
            }
        _ => {},
    }
}
fn lift(name: &str, args: &[Expr], site: &Site, tables: &BTreeMap<String, TableInfo>, required: &BTreeSet<String>) -> Expr {
    if let Expr::If { then, condition, otherwise, site: branch } = &args[0] {
        let mut yes = args.to_vec(); yes[0] = *then.clone();
        let mut no = args.to_vec(); no[0] = *otherwise.clone();
        let mut present = required.clone();
        if let Some((PRESENT, Expr::Name { name, .. })) = self::condition(condition) { present.insert(name.clone()); }
        Expr::If { then: Box::new(lift(name, &yes, site, tables, &present)), condition: condition.clone(), otherwise: Box::new(lift(name, &no, site, tables, required)), site: branch.clone() }
    } else {
        let mut args = args.to_vec();
        if let Some(Expr::Read(read)) = args.first_mut() { super::intent_aggregates::choose(read, tables, required); }
        Expr::Call { name: name.into(), args, site: site.clone() }
    }
}

fn optional<'a>(predicate: &'a Expr, inputs: &Inputs, functions: &BTreeMap<String, FunctionDecl>) -> Option<(&'a str, &'a Expr)> {
    let Expr::Binary { op, left, right, .. } = predicate else { return None; };
    if op != "or" { return None; }
    for (guard, value) in [(left, right), (right, left)] {
        let Expr::Binary { op, left, right, .. } = guard.as_ref() else { continue; };
        if op != "=" { continue; }
        let name = match (left.as_ref(), right.as_ref()) {
            (Expr::Name { name, .. }, Expr::Literal { value: Literal::Null, .. }) |
            (Expr::Literal { value: Literal::Null, .. }, Expr::Name { name, .. }) => name,
            _ => continue,
        };
        if inputs.get(name) != Some(&true) { continue; }
        let Expr::Binary { op, left, right, .. } = value.as_ref() else { continue; };
        if !matches!(op.as_str(), "=" | "in" | "<" | "<=" | ">" | ">=") { continue; }
        let endpoint = if intent::column(left).is_some() { right } else if op != "in" && intent::column(right).is_some() { left } else { continue; };
        if !input_only(endpoint, inputs, functions) { continue; }
        let required = inputs.iter().filter(|(input, optional)| !**optional || *input == name).map(|(input, _)| input.clone()).collect();
        if !super::intent_aggregates::safe_endpoint(endpoint, &required) { continue; }
        let mut used = BTreeSet::new();
        walk::expression(&mut *endpoint.clone(), &mut |e| { if let Expr::Name { name, .. } = e { used.insert(name.clone()); } });
        if !used.contains(name) || used.iter().any(|other| other != name && inputs.get(other) == Some(&true)) { continue; }
        return Some((name, value));
    }
    None
}

fn variants(read: &ReadExpr, exists: bool, inputs: &Inputs, tables: &BTreeMap<String, TableInfo>, functions: &BTreeMap<String, FunctionDecl>, notes: &mut Vec<Diagnostic>) -> Option<Expr> {
    let mut parts = Vec::new();
    if let Some(filter) = &read.filter { intent::split(*filter.clone(), &mut parts); }
    let candidates: Vec<_> = parts.iter().enumerate().filter_map(|(i, value)| optional(value, inputs, functions).map(|(name, predicate)| (i, name.to_owned(), predicate.clone()))).collect();
    let mut names = Vec::new();
    for (_, name, _) in &candidates { if !names.contains(name) { names.push(name.clone()); } }
    if names.len() > 3 {
        let extra = names[3..].join(", ");
        notes.push(Diagnostic::new(&read.site, "N_OPTIONAL_FILTER_LIMIT", format!("optional filters {extra} stay residual: at most three inputs receive presence variants"),
            format!("keep these metered residual filters, or branch on {extra} in separate queries to plan their pins")).guide("reads"));
        names.truncate(3);
    }
    let search = read.matching.clone();
    if names.is_empty() && search.is_none() { return None; }
    let search = search.map(|needle| search_condition(*needle, &read.site));
    let mut read = read.clone();
    read.matching = search.as_ref().map(|(_, needle)| Box::new(needle.clone()));
    let tests: Vec<_> = names.iter().map(|name| Expr::Call { name: PRESENT.into(), args: vec![Expr::Name { name: name.clone(), site: read.site.clone() }], site: read.site.clone() })
        .chain(search.iter().map(|(condition, _)| condition.clone())).collect();
    fn build(read: &ReadExpr, exists: bool, parts: &[Expr], candidates: &[(usize, String, Expr)], names: &[String], tests: &[Expr], bits: &mut Vec<bool>, tables: &BTreeMap<String, TableInfo>, required: &BTreeSet<String>) -> Expr {
        if bits.len() < tests.len() {
            let test = tests[bits.len()].clone();
            bits.push(true); let yes = build(read, exists, parts, candidates, names, tests, bits, tables, required);
            *bits.last_mut().unwrap() = false; let no = build(read, exists, parts, candidates, names, tests, bits, tables, required);
            bits.pop();
            return Expr::If { condition: Box::new(test), then: Box::new(yes), otherwise: Box::new(no), site: read.site.clone() };
        }
        let mut read = read.clone();
        read.filter = intent::conjunction(parts.iter().enumerate().filter_map(|(i, original)| {
            if let Some((_, name, predicate)) = candidates.iter().find(|(at, name, _)| *at == i && names.contains(name)) {
                bits[names.iter().position(|n| n == name).unwrap()].then(|| predicate.clone())
            } else { Some(original.clone()) }
        }).collect());
        if read.matching.is_some() && !bits[names.len()] {
            browse_leaf(&mut read, tables);
        }
        if exists {
            let mut required = required.clone();
            required.extend(names.iter().zip(bits).filter(|(_, present)| **present).map(|(name, _)| name.clone()));
            super::intent_aggregates::choose(&mut read, tables, &required);
            Expr::Exists { site: read.site.clone(), read }
        } else { Expr::Read(read) }
    }
    let required = inputs.iter().filter(|(_, optional)| !**optional).map(|(name, _)| name.clone()).collect();
    Some(build(&read, exists, &parts, &candidates, &names, &tests, &mut Vec::new(), tables, &required))
}

// Normalize this generated read only. Its predicates, needle and key values
// may contain unrelated point reads whose columns and order must not change.
// @ref LLP 3000.013#2.1 — an explicit words order disambiguates its browse alternative only.
fn browse_leaf(read: &mut ReadExpr, tables: &BTreeMap<String, TableInfo>) {
    read.matching = None;
    let authored = read.index.take().and_then(|name| tables.get(&read.table)?.indexes.iter().find(|index| index.name == name));
    let Some(index) = authored else { return; };
    let Some((position, _)) = &index.words else { return; };
    for (key, column) in read.keys.iter_mut().zip(&index.columns) { key.column.get_or_insert_with(|| column.clone()); }
    if read.order_keys.is_empty() { read.order_keys = index.columns[*position..].to_vec(); }
    read.computed = index.computed.clone();
    // The authored words index already resolved the intended ordering. Its
    // generated browse alternative deterministically reuses an equivalent
    // plain index, including a unique index with an implicit id suffix.
    let table = &tables[&read.table];
    let ordered = |index: &IndexDecl| {
        let mut columns = index.columns.clone();
        if columns.last().map(String::as_str) != Some("id") { columns.push("id".into()); }
        columns
    };
    let computed = super::intent::computed_descriptor(table, &index.computed);
    read.index = table.indexes.iter().filter(|candidate| candidate.words.is_none()
        && ordered(candidate) == ordered(index)
        && super::intent::computed_descriptor(table, &candidate.computed) == computed)
        .min_by_key(|candidate| &candidate.name).map(|candidate| candidate.name.clone());
}
