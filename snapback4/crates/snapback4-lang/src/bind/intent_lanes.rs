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
                let source = Expr::Read(ReadExpr { computed: Default::default(), table: probe.table.clone(), keys: Vec::new(), seeks: Vec::new(), filter: intent::conjunction(pins),
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
