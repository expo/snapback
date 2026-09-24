//! Finite time windows become bucket lanes; both exact endpoints stay filters.
use super::{catalog::TableInfo, intent};
use crate::ast::*;
use std::collections::BTreeMap;

pub(super) fn expand(tables: &BTreeMap<String, TableInfo>, read: &ReadExpr) -> Option<MergeExpr> {
    if read.index.is_some() || !read.keys.is_empty() { return None; }
    let table = tables.get(&read.table)?;
    let mut predicates = Vec::new();
    intent::split(*read.filter.clone()?, &mut predicates);
    for predicate in &predicates {
        let Expr::Binary { op, left, right, .. } = predicate else { continue; };
        if !matches!(op.as_str(), ">" | ">=") { continue; }
        let Some(column) = intent::column(left) else { continue; };
        if table.columns.get(column)?.kind != TypeKind::Time || table.columns.get(column)?.optional || read.order_keys.first().map(String::as_str).unwrap_or("id") == column { continue; }
        let Expr::Binary { op, left, right: duration, .. } = right.as_ref() else { continue; };
        if op != "-" || !matches!(left.as_ref(), Expr::Name { name, .. } if name == "now") { continue; }
        let Some(duration) = constant(duration) else { continue; };
        let function = if (0..=48 * 3_600_000).contains(&duration) { "hour" } else if duration <= 92 * 86_400_000 && duration >= 0 { "day" } else { continue; };
        if table.columns.contains_key(function) { continue; }
        let upper = predicates.iter().find_map(|predicate| match predicate {
            Expr::Binary { op, left, right, .. } if matches!(op.as_str(), "<" | "<=") && intent::column(left) == Some(column) && finite(right) => Some(*right.clone()),
            _ => None,
        })?;
        let call = |value: Expr| Expr::Call { name: function.into(), args: vec![value], site: read.site.clone() };
        let name = "$windowBucket";
        let source = Expr::Call { name: "range".into(), args: vec![call(*right.clone()), Expr::Binary { op: "+".into(), left: Box::new(call(upper)), right: Box::new(Expr::Literal { value: Literal::Number("1".into()), site: read.site.clone() }), site: read.site.clone() }], site: read.site.clone() };
        let mut lane_read = read.clone();
        lane_read.keys.push(KeyPart { column: Some(function.into()), value: Expr::Name { name: name.into(), site: read.site.clone() }, site: read.site.clone() });
        lane_read.computed.insert(function.into(), call(Expr::Name { name: column.into(), site: read.site.clone() }));
        let range = read.range.clone().unwrap_or(RangeSpec { order: Order::Asc, take: 8192, cursor: None, site: read.site.clone() });
        return Some(MergeExpr { view_order: Vec::new(), table: read.table.clone(), matching: None, filter: None, index: String::new(), order: range.order, take: range.take, cursor: range.cursor,
            lanes: vec![MergeLane { nulls: None, distinct: None, branch: None, planned: Some(Box::new(lane_read)), project: None, table: None, prefix: Vec::new(), columns: None, loop_: Some((name.into(), source)), site: read.site.clone() }], site: read.site.clone() });
    }
    None
}

fn finite(value: &Expr) -> bool {
    matches!(value, Expr::Name { name, .. } if name == "now")
        || matches!(value, Expr::Literal { value: Literal::Number(_), .. })
        || matches!(value, Expr::Binary { op, left, right, .. } if matches!(op.as_str(), "+" | "-") && matches!(left.as_ref(), Expr::Name { name, .. } if name == "now") && constant(right).is_some())
}


pub(super) fn missing_upper(tables: &BTreeMap<String, TableInfo>, read: &ReadExpr) -> Option<crate::diag::Diagnostic> {
    if read.index.is_some() { return None; }
    let table = tables.get(&read.table)?;
    let mut predicates = Vec::new(); intent::split(*read.filter.clone()?, &mut predicates);
    for predicate in &predicates {
        if let Expr::Binary { op, left, right, .. } = predicate
            && matches!(op.as_str(), ">" | ">=") && let Some(column) = intent::column(left)
            && table.columns.get(column).is_some_and(|ty| ty.kind == TypeKind::Time)
            && read.order_keys.first().map(String::as_str).unwrap_or("id") != column
            && matches!(right.as_ref(), Expr::Binary { op, left, right, .. } if op == "-" && matches!(left.as_ref(), Expr::Name { name, .. } if name == "now") && constant(right).is_some())
            && !predicates.iter().any(|value| matches!(value, Expr::Binary { op, left, right, .. } if matches!(op.as_str(), "<" | "<=") && intent::column(left) == Some(column) && finite(right))) {
            return Some(crate::diag::Diagnostic::new(&read.site, "N_SPARSE_FILTER", format!("{} has no finite upper bound on .{column}; future rows remain in this metered residual scan", read.table), format!("add `and .{column} <= now` if the intended window ends now; otherwise keep the residual scan")).guide("reads"));
        }
    }
    None
}

fn constant(value: &Expr) -> Option<i64> {
    let value = match value {
        Expr::Literal { value: Literal::Number(value), .. } => value.parse().ok()?,
        Expr::Unary { op, value, .. } if op == "-" => constant(value)?.checked_neg()?,
        Expr::Binary { op, left, right, .. } => {
            let (a, b) = (constant(left)?, constant(right)?);
            match op.as_str() { "+" => a.checked_add(b)?, "-" => a.checked_sub(b)?, "*" => a.checked_mul(b)?, _ => return None }
        }
        _ => return None,
    };
    (value >= -snapback4_core::value::I53_MAX && value <= snapback4_core::value::I53_MAX).then_some(value)
}
