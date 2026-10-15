//! Aggregate consumers may choose a seek order; ordinary pages keep their order.
use super::{catalog::{Catalog, TableInfo}, intent, intent_walk};
use crate::ast::{ArgDecl, Expr, FunctionBody, FunctionDecl, Literal, ReadExpr};
use std::collections::{BTreeMap, BTreeSet};

// @ref LLP 3000.013#5.1 — choose an access path, leaving aggregate scan
// admission and streaming to the consumer's existing binder/runtime contract.
#[derive(Clone, Default)]
pub(super) struct Contexts {
    pub domains: BTreeSet<String>,
    pub extrema: BTreeMap<String, String>,
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
            && is_consumer(name, args, tables) && !functions.contains_key(name)
            && let Some(Expr::Read(read)) = args.first() && read.range.is_none() {
            self.domains.insert(read.site.to_string());
            if matches!(name.as_str(), "min" | "max") && let Some(field) = args.get(1).and_then(intent::column) {
                self.extrema.insert(read.site.to_string(), field.into());
            }
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

// @ref LLP 3000.019#3.2 — defer overload selection to the typed binder.
// Optional filters and inferred lanes may materialize an ordinary read before
// then. Keep the unpaged domain as an alternative for a scalar projection;
// a binary collection comparison still receives its original page plan.
pub(super) fn remember_domains(catalog: &mut Catalog) {
    for doc in &mut catalog.documents {
        intent_walk::document(doc, &mut |expr| {
            if let Expr::Call { name, args, .. } = expr
                && matches!(name.as_str(), "min" | "max") && args.len() == 2
                && !catalog.functions.contains_key(name) && intent::column(&args[1]).is_none()
                && let Expr::Read(read) = &args[0]
                && read.range.is_none() && read.matching.is_none()
                && catalog.tables.get(&read.table).is_some_and(|table|
                    !table.maintained.as_ref().is_some_and(|maintain| maintain.by.is_empty())) {
                catalog.extremum_domains.insert(read.site.to_string(), read.clone());
            }
        });
    }
}

fn required_args(args: &[ArgDecl]) -> BTreeSet<String> {
    args.iter().filter(|arg| !arg.type_.optional).map(|arg| arg.name.clone()).collect()
}

pub(super) fn is_consumer(name: &str, args: &[Expr], tables: &BTreeMap<String, TableInfo>) -> bool {
    if matches!(name, "count" | "sum") { return true; }
    if !matches!(name, "min" | "max") { return false; }
    let field = args.get(1).and_then(intent::column);
    // @ref LLP 3000.019#3.2 — expression extrema use ordinary aggregate scan planning.
    // Collection-valued second arguments keep binary page comparison planning.
    if field.is_none() && args.get(1).is_none_or(may_be_collection) { return false; }
    // A binary comparison of two pages keeps their observable row order.
    // A focal member absent from this table can belong to an outer shape.
    match args.first() {
        Some(Expr::Read(read)) => tables.get(&read.table).is_some_and(|table|
            extremum_domain(read, table) && field.is_none_or(|field| field == "id" || table.columns.contains_key(field))),
        _ => true,
    }
}

// Before type binding, only select an aggregate order for a definitely scalar
// result. Otherwise leave the source order intact for the binary overload;
// the binder can still admit a scalar aggregate over that ordinary scan.
fn may_be_collection(value: &Expr) -> bool {
    match value {
        Expr::Literal { .. } | Expr::Unary { .. } | Expr::Exists { .. } | Expr::Created { .. } => false,
        Expr::Binary { op, left, right, .. } if op == "??" || op == "+" => may_be_collection(left) || may_be_collection(right),
        Expr::Binary { .. } => false,
        Expr::If { then, otherwise, .. } => may_be_collection(then) || may_be_collection(otherwise),
        Expr::Assert { value, .. } => may_be_collection(value),
        // Calls can be user helpers, including helpers which return pages.
        _ => true,
    }
}

fn extremum_domain(read: &ReadExpr, table: &TableInfo) -> bool {
    if !read.order_keys.is_empty() || read.range.is_some() || read.matching.is_some()
        || read.filter.is_some() || !read.seeks.is_empty() || read.keys.is_empty() { return true; }
    // Decide the argument's kind before adding an aggregate order. In
    // particular, a complete maintained group lookup is a scalar total.
    // Positional keys without an index retain their point/refusal path;
    // only the binder can resolve their types or diagnose an ambiguity.
    let named = read.keys.iter().all(|key| key.column.is_some());
    if !named && read.index.is_none() { return false; }
    let index = read.index.as_deref().or_else(|| table.maintained.as_ref().map(|_| "byGroup"));
    !table.indexes.iter().any(|candidate| candidate.unique && candidate.is_plain()
        && index.is_none_or(|name| candidate.name == name)
        && (candidate.columns.len() == read.keys.len()
            || named && table.total_unique(candidate) && candidate.columns.len() < read.keys.len())
        && (!named || candidate.columns.iter().all(|column| read.keys.iter().any(|key| key.column.as_ref() == Some(column)))))
}

fn consumer(value: &mut Expr, tables: &BTreeMap<String, TableInfo>, functions: &BTreeMap<String, FunctionDecl>, required: &BTreeSet<String>) {
    match value {
        Expr::Call { name, args, .. } if is_consumer(name, args, tables) && !functions.contains_key(name) => {
            choose_consumer(name, args, tables, required);
        }
        Expr::Exists { read, .. } => choose(read, tables, required),
        _ => {},
    }
}

pub(super) fn choose_consumer(name: &str, args: &mut [Expr], tables: &BTreeMap<String, TableInfo>, required: &BTreeSet<String>) {
    if !is_consumer(name, args, tables) { return; }
    let field = if matches!(name, "min" | "max") { args.get(1).and_then(intent::column).map(str::to_owned) } else { None };
    let Some(Expr::Read(read)) = args.first_mut() else { return; };
    if let Some(field) = field
        && read.index.is_none() && read.order_keys.is_empty() && read.range.is_none() && read.matching.is_none()
        && let Some(table) = tables.get(&read.table) {
        let mut conjuncts = Vec::new();
        if let Some(filter) = &read.filter { intent::split(*filter.clone(), &mut conjuncts); }
        let mut pins = read.keys.iter().filter_map(|key| key.column.clone()).collect::<BTreeSet<_>>();
        pins.extend(conjuncts.iter().filter_map(|value| intent::equality(value, table).map(|(column, _)| column)));
        let pins: Vec<_> = pins.into_iter().collect();
        if !pins.iter().any(|pin| pin == "id") && table.indexes.iter().any(|index| index.is_plain()
            && index.columns.get(pins.len()) == Some(&field) && index.columns[..pins.len()].iter().all(|column| pins.contains(column))) {
            read.order_keys.push(field);
            return;
        }
    }
    choose(read, tables, required);
}

pub(super) fn choose(read: &mut ReadExpr, tables: &BTreeMap<String, TableInfo>, required: &BTreeSet<String>) {
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
