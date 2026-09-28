//! Membership and bounded-list predicates enumerate ordinary metered lanes.
use super::{catalog::TableInfo, intent};
use crate::ast::*;
use std::collections::BTreeMap;

pub(super) fn expand(tables: &BTreeMap<String, TableInfo>, read: &ReadExpr) -> Option<MergeExpr> {
    if read.index.is_some() || !read.keys.is_empty() { return None; }
    let mut predicates = Vec::new();
    intent::split(*read.filter.clone()?, &mut predicates);
    let name = "$intentLane";
    for position in 0..predicates.len() {
        let predicate = &predicates[position];
        let (column, source, value) = match predicate {
            Expr::Binary { op, left, right, .. } if op == "in" => {
                if !intent::independent(right) { continue; }
                let column = intent::column(left)?.to_owned();
                (column, *right.clone(), Expr::Name { name: name.into(), site: predicate.site().clone() })
            }
            Expr::Binary { op, .. } if op == "!=" => {
                let Some((column, source)) = enum_complement(predicate, tables.get(&read.table)?) else { continue; };
                (column, source, Expr::Name { name: name.into(), site: predicate.site().clone() })
            }
            Expr::Exists { read: probe, .. } => {
                let target = tables.get(&probe.table)?;
                if probe.filter.is_some() || probe.matching.is_some() || !probe.seeks.is_empty() || probe.range.is_some() { continue; }
                let columns = if probe.keys.iter().all(|key| key.column.is_some()) {
                    probe.keys.iter().filter_map(|key| key.column.clone()).collect::<Vec<_>>()
                } else {
                    let indexes: Vec<_> = target.indexes.iter().filter(|index| index.unique && index.is_plain() && index.columns.len() == probe.keys.len())
                        .filter(|index| probe.index.as_ref().is_none_or(|name| &index.name == name)).collect();
                    let [index] = indexes.as_slice() else { continue; };
                    index.columns.clone()
                };
                let mut pins = Vec::new();
                let mut varying = None;
                for (at, key) in probe.keys.iter().enumerate() {
                    let target_column = key.column.clone().unwrap_or_else(|| columns[at].clone());
                    if let Some(column) = intent::column(&key.value) {
                        if varying.is_some() { return None; }
                        varying = Some((column.to_owned(), target_column));
                    } else {
                        if !intent::independent(&key.value) { return None; }
                        pins.push(Expr::Binary { op: "=".into(), left: Box::new(focal(&target_column, &key.site)), right: Box::new(key.value.clone()), site: key.site.clone() });
                    }
                }
                let (column, target_column) = varying?;
                let source = Expr::Read(ReadExpr { cursor_prefix: None, computed: Default::default(), table: probe.table.clone(), keys: Vec::new(), seeks: Vec::new(), filter: intent::conjunction(pins),
                    index: None, range: None, matching: None, order_keys: vec![target_column.clone()], site: probe.site.clone() });
                let value = Expr::Member { base: Box::new(Expr::Name { name: name.into(), site: probe.site.clone() }), name: target_column, site: probe.site.clone() };
                (column, source, value)
            }
            _ => continue,
        };
        let distinct = value.clone();
        let mut lane_read = read.clone();
        let nullable_in = matches!(predicate, Expr::Binary { op, .. } if op == "in")
            // Range lanes produce integers only; no fallback index is needed.
            && !matches!(&source, Expr::Call { name, .. } if name == "range")
            && tables.get(&read.table)?.columns.get(&column).is_some_and(|ty| ty.optional);
        predicates.remove(position);
        let nulls = nullable_in.then(|| {
            let mut null_read = read.clone();
            null_read.filter = intent::conjunction(predicates.clone());
            (column.clone(), Box::new(null_read))
        });
        predicates.push(Expr::Binary { op: "=".into(), left: Box::new(focal(&column, &read.site)), right: Box::new(value), site: read.site.clone() });
        lane_read.filter = intent::conjunction(predicates);
        let range = read.range.clone().unwrap_or(RangeSpec { order: Order::Asc, take: 8192, cursor: None, site: read.site.clone() });
        return Some(MergeExpr { view_order: Vec::new(), table: read.table.clone(), matching: None, filter: None, index: String::new(), order: range.order, take: range.take,
            cursor: range.cursor, lanes: vec![MergeLane { nulls, distinct: Some(distinct), branch: None, table: None, planned: Some(Box::new(lane_read)), project: None, prefix: Vec::new(), columns: None,
                loop_: Some((name.into(), source)), site: read.site.clone() }], site: read.site.clone() });
    }
    None
}

fn focal(name: &str, site: &crate::diag::Site) -> Expr { Expr::Member { base: Box::new(Expr::Focal { site: site.clone() }), name: name.into(), site: site.clone() } }

// @ref LLP 3000.013#2.1 — small required enums have a finite complement;
// nullable enums keep total inequality as a residual, including null rows.
fn enum_complement(predicate: &Expr, table: &TableInfo) -> Option<(String, Expr)> {
    let Expr::Binary { left, right, site, .. } = predicate else { return None; };
    let (column, value) = if let Some(column) = intent::column(left) { (column, right.as_ref()) }
        else { (intent::column(right)?, left.as_ref()) };
    let ty = table.columns.get(column)?;
    let TypeKind::Enum { variants } = &ty.kind else { return None; };
    if ty.optional || variants.len() > 8 { return None; }
    let values = |exclude: Option<&str>| Expr::Array { site: site.clone(), items: variants.iter()
        .filter(|variant| Some(variant.as_str()) != exclude)
        .map(|variant| Expr::Literal { value: Literal::Str(variant.clone()), site: site.clone() }).collect() };
    let source = match value {
        Expr::Literal { value: Literal::Str(exclude), .. } => values(Some(exclude)),
        // Stable bindings are safe to test while opening lanes. Fallible
        // expressions stay under their original row predicate's guards.
        Expr::Name { name, .. } if !matches!(name.as_str(), "new" | "now" | "viewer") => {
            variants.iter().rev().fold(values(None), |otherwise, variant| Expr::If {
                condition: Box::new(Expr::Binary { op: "=".into(), left: Box::new(value.clone()),
                    right: Box::new(Expr::Literal { value: Literal::Str(variant.clone()), site: site.clone() }), site: site.clone() }),
                then: Box::new(values(Some(variant))), otherwise: Box::new(otherwise), site: site.clone() })
        }
        _ => return None,
    };
    Some((column.into(), source))
}

// Conservative authorization proof before schema binding: every source-row
// field read by the rule must be pinned, including any nullable fallback.
// Declining an optimization preserves the ordinary scan's continuation; it
// does not change the source rule or the merge runtime's disclosure contract.
pub(super) fn prefixes_decide_rules(tables: &BTreeMap<String, TableInfo>, merge: &MergeExpr) -> bool {
    merge.lanes.iter().all(|lane| lane.planned.iter().map(Box::as_ref)
        .chain(lane.nulls.iter().map(|(_, read)| read.as_ref()))
        .chain(lane.loop_.iter().filter_map(|(_, source)| if let Expr::Read(read) = source { Some(read) } else { None }))
        .all(|read| prefix_decides_rule(tables, read)))
}

fn prefix_decides_rule(tables: &BTreeMap<String, TableInfo>, read: &ReadExpr) -> bool {
    let Some(table) = tables.get(&read.table) else { return false; };
    if table.maintained.is_some() { return false; }
    let pinned = read.keys.iter().filter_map(|key| key.column.as_ref().map(|name| (name.as_str(), &key.value))).collect::<BTreeMap<_, _>>();
    table.decl.rules.iter().filter(|rule| rule.effect == Effect::Read).all(|rule| {
        let mut predicate = rule.value.clone();
        // An exact probe of this very row is true, even when some of its
        // fields vary. This is the existing membership self-witness proof.
        super::intent_walk::expression(&mut predicate, &mut |value| {
            if let Expr::Exists { read: probe, site } = value && self_witness(table, probe, &pinned) {
                *value = Expr::Literal { value: Literal::Bool(true), site: site.clone() };
            }
        });
        let mut decided = true;
        super::intent_walk::expression(&mut predicate, &mut |value| {
            if let Some(column) = intent::column(value) && !pinned.contains_key(column) { decided = false; }
        });
        decided
    })
}

fn self_witness(table: &TableInfo, probe: &ReadExpr, pins: &BTreeMap<&str, &Expr>) -> bool {
    if probe.table != table.decl.name || probe.filter.is_some() || probe.matching.is_some() || !probe.seeks.is_empty() { return false; }
    let columns = if probe.keys.iter().all(|key| key.column.is_some()) {
        let columns: Vec<_> = probe.keys.iter().filter_map(|key| key.column.clone()).collect();
        if !table.indexes.iter().any(|index| table.total_unique(index) && index.columns.iter().all(|name| columns.contains(name))) { return false; }
        columns
    } else {
        let indexes: Vec<_> = table.indexes.iter().filter(|index| table.total_unique(index) && index.columns.len() == probe.keys.len()
            && probe.index.as_ref().is_none_or(|name| name == &index.name)).collect();
        let [index] = indexes.as_slice() else { return false; };
        index.columns.clone()
    };
    probe.keys.iter().zip(columns).all(|(key, column)| intent::column(&key.value) == Some(column.as_str())
        || pins.get(column.as_str()).is_some_and(|value| crate::print::expression(value) == crate::print::expression(&key.value)))
}
