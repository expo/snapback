//! Aggregate consumers may choose a seek order; ordinary pages keep their order.
use super::{catalog::{Catalog, TableInfo}, intent, intent_walk};
use crate::ast::{ArgDecl, Expr, FunctionBody, FunctionDecl, Literal, ReadExpr};
use std::collections::{BTreeMap, BTreeSet};

// @ref LLP 3000.013#5.1 — choose an access path, leaving aggregate scan
// admission and streaming to the consumer's existing binder/runtime contract.
#[derive(Clone, Default)]
pub(super) struct Contexts {
    pub domains: BTreeSet<String>,
    required: BTreeMap<String, BTreeSet<String>>,
}
impl Contexts {
    pub fn safe(&self, read: &ReadExpr, value: &Expr) -> bool {
        safe_endpoint(value, self.required.get(&read.site.to_string()).unwrap_or(&BTreeSet::new()))
    }
    fn visit(&mut self, value: &mut Expr, tables: &BTreeMap<String, TableInfo>, functions: &BTreeMap<String, FunctionDecl>, required: &BTreeSet<String>) {
        if let Expr::Read(read) | Expr::Exists { read, .. } = value {
            self.required.insert(read.site.to_string(), required.clone());
        }
        if let Expr::Call { name, args, .. } = value
            && matches!(name.as_str(), "count" | "sum") && !functions.contains_key(name)
            && let Some(Expr::Read(read)) = args.first() && read.range.is_none() {
            self.domains.insert(read.site.to_string());
        }
        consumer(value, tables, functions, required);
    }
}
pub(super) fn order(catalog: &mut Catalog) -> Contexts {
    let mut contexts = Contexts::default();
    for doc in &mut catalog.documents {
        for program in &mut doc.programs {
            let required = required_args(&program.args);
            let mut visit = |value: &mut Expr| contexts.visit(value, &catalog.tables, &catalog.functions, &required);
            intent_walk::statements(&mut program.prelude, &mut visit);
            intent_walk::statements(&mut program.body, &mut visit);
        }
        for function in &mut doc.functions {
            let required = required_args(&function.args);
            let mut visit = |value: &mut Expr| contexts.visit(value, &catalog.tables, &catalog.functions, &required);
            match &mut function.body {
                FunctionBody::Expression(value) => intent_walk::expression(value, &mut visit),
                FunctionBody::Block(body) => intent_walk::statements(body, &mut visit),
            }
        }
        for shape in &mut doc.shapes {
            intent_walk::shape(&mut shape.fields, &mut |value| contexts.visit(value, &catalog.tables, &catalog.functions, &BTreeSet::new()));
        }
    }
    contexts
}

fn required_args(args: &[ArgDecl]) -> BTreeSet<String> {
    args.iter().filter(|arg| !arg.type_.optional).map(|arg| arg.name.clone()).collect()
}

fn consumer(value: &mut Expr, tables: &BTreeMap<String, TableInfo>, functions: &BTreeMap<String, FunctionDecl>, required: &BTreeSet<String>) {
    match value {
        Expr::Call { name, args, .. } if matches!(name.as_str(), "count" | "sum") && !functions.contains_key(name) => {
            if let Some(Expr::Read(read)) = args.first_mut() { choose(read, tables, required); }
        }
        Expr::Exists { read, .. } => choose(read, tables, required),
        _ => {},
    }
}

fn choose(read: &mut ReadExpr, tables: &BTreeMap<String, TableInfo>, required: &BTreeSet<String>) {
    // A page bound makes row order observable even inside count/sum. Explicit
    // authored order/index choices also retain their existing meaning.
    if read.index.is_some() || !read.order_keys.is_empty() || read.range.is_some() || read.matching.is_some() { return; }
    let Some(table) = tables.get(&read.table) else { return; };
    let mut conjuncts = Vec::new();
    if let Some(filter) = &read.filter { intent::split(*filter.clone(), &mut conjuncts); }
    let mut pins = read.keys.iter().filter_map(|key| key.column.clone()).collect::<BTreeSet<_>>();
    pins.extend(conjuncts.iter().filter_map(|value| intent::equality(value, table).map(|(column, _)| column)));
    // A pinned intrinsic id already bounds the read to one row. Inserting an
    // order column after this prefix would create the invalid (id, col, id).
    if pins.contains("id") { return; }
    let mut ranges = BTreeMap::<String, (bool, bool)>::new();
    let mut unsafe_columns = BTreeSet::new();
    for (column, op, endpoint) in conjuncts.iter().filter_map(intent::comparison)
        .chain(read.seeks.iter().map(|seek| (seek.column.clone(), seek.op.clone(), seek.value.clone()))) {
        if pins.contains(&column) { continue; }
        if !safe_endpoint(&endpoint, required) { unsafe_columns.insert(column); continue; }
        let bound = ranges.entry(column).or_default();
        bound.0 |= op.starts_with('>');
        bound.1 |= op.starts_with('<');
    }
    // Choosing the order makes ordinary planning extract both endpoints. A
    // safe sibling must not hoist another bound out of its short-circuit guard.
    ranges.retain(|column, _| !unsafe_columns.contains(column));
    // Prefer a two-sided window, then a canonical column name. Permuting
    // conjunctions must not churn an automatically chosen index identity.
    let column = ranges.iter().find(|(_, (lower, upper))| *lower && *upper).or_else(|| ranges.first_key_value());
    if let Some((column, _)) = column { read.order_keys.push(column.clone()); }
}

pub(super) fn safe_endpoint(value: &Expr, required: &BTreeSet<String>) -> bool {
    // These values are present before any row predicate runs. Parameters
    // cannot be reassigned or shadowed. Numeric interval proofs admit only
    // arithmetic that stays within the safe-integer range for every input.
    match value {
        Expr::Literal { value, .. } => !matches!(value, Literal::Null),
        Expr::Name { name, .. } => matches!(name.as_str(), "now" | "viewer") || required.contains(name),
        Expr::Unary { .. } | Expr::Binary { .. } => numeric_interval(value, required).is_some(),
        _ => false,
    }
}


fn numeric_interval(value: &Expr, required: &BTreeSet<String>) -> Option<(i128, i128)> {
    let max = i128::from(snapback4_core::value::I53_MAX);
    let (low, high) = match value {
        Expr::Literal { value: Literal::Number(number), .. } => { let n = number.parse().ok()?; (n, n) }
        Expr::Name { .. } if safe_endpoint(value, required) => (-max, max),
        Expr::Unary { op, value, .. } if op == "-" => { let (lo, hi) = numeric_interval(value, required)?; (-hi, -lo) }
        Expr::Binary { op, left, right, .. } => {
            let (a, b) = numeric_interval(left, required)?;
            let (c, d) = numeric_interval(right, required)?;
            match op.as_str() {
                "+" => (a + c, b + d),
                "-" => (a - d, b - c),
                "*" => { let products = [a * c, a * d, b * c, b * d]; (*products.iter().min()?, *products.iter().max()?) }
                _ => return None,
            }
        }
        _ => return None,
    };
    (low >= -max && high <= max).then_some((low, high))
}

#[cfg(test)]
#[path = "../../tests/intent/aggregate_plans.rs"]
mod tests;
