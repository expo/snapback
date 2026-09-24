//! Aggregate consumers may choose a seek order; ordinary pages keep their order.
use super::{catalog::{Catalog, TableInfo}, intent, intent_walk};
use crate::ast::{Expr, ReadExpr};
use std::collections::{BTreeMap, BTreeSet};

// @ref LLP 3000.013#5.1 — choose an access path, leaving aggregate scan
// admission and streaming to the consumer's existing binder/runtime contract.
pub(super) fn order(catalog: &mut Catalog) {
    for doc in &mut catalog.documents {
        intent_walk::document(doc, &mut |value| match value {
            Expr::Call { name, args, .. } if matches!(name.as_str(), "count" | "sum") && !catalog.functions.contains_key(name) => {
                if let Some(Expr::Read(read)) = args.first_mut() { choose(read, &catalog.tables); }
            }
            Expr::Exists { read, .. } => choose(read, &catalog.tables),
            _ => {},
        });
    }
}

fn choose(read: &mut ReadExpr, tables: &BTreeMap<String, TableInfo>) {
    // A page bound makes row order observable even inside count/sum. Explicit
    // authored order/index choices also retain their existing meaning.
    if read.index.is_some() || !read.order_keys.is_empty() || read.range.is_some() || read.matching.is_some() { return; }
    let Some(table) = tables.get(&read.table) else { return; };
    let mut conjuncts = Vec::new();
    if let Some(filter) = &read.filter { intent::split(*filter.clone(), &mut conjuncts); }
    let mut pins = read.keys.iter().filter_map(|key| key.column.clone()).collect::<BTreeSet<_>>();
    pins.extend(conjuncts.iter().filter_map(|value| intent::equality(value, table).map(|(column, _)| column)));
    let mut ranges = BTreeMap::<String, (bool, bool)>::new();
    for (column, op) in conjuncts.iter().filter_map(intent::comparison).map(|(column, op, _)| (column, op))
        .chain(read.seeks.iter().map(|seek| (seek.column.clone(), seek.op.clone()))) {
        if pins.contains(&column) { continue; }
        let bound = ranges.entry(column).or_default();
        bound.0 |= op.starts_with('>');
        bound.1 |= op.starts_with('<');
    }
    // Prefer a two-sided window, then a canonical column name. Permuting
    // conjunctions must not churn an automatically chosen index identity.
    let column = ranges.iter().find(|(_, (lower, upper))| *lower && *upper).or_else(|| ranges.first_key_value());
    if let Some((column, _)) = column { read.order_keys.push(column.clone()); }
}

#[cfg(test)]
#[path = "../../tests/intent/aggregate_plans.rs"]
mod tests;
