//! `t where .col = value shapeName`: the postfix shape parses onto the last
//! operand, but the builder shapes the page. Hoisting it before planning keeps
//! the equality a prefix pin, so a declared shape never changes which index or
//! cap covers the read (app-farm wave 5, lane 100).
// @ref LLP 3000.036#15.1 — a shape suffix must not change prefix coverage.
use super::{catalog::{Catalog, TableInfo}, intent::independent, intent_walk as walk};
use crate::ast::*;
use std::collections::BTreeSet;

pub(super) fn hoist(catalog: &mut Catalog) {
    let shapes: BTreeSet<String> = catalog.documents.iter().flat_map(|doc| doc.shapes.iter().map(|shape| shape.name.clone())).collect();
    if shapes.is_empty() { return; }
    let tables = &catalog.tables;
    for doc in &mut catalog.documents {
        walk::document(doc, &mut |value| {
            let Expr::Read(read) = value else { return };
            let Some(table) = tables.get(&read.table) else { return };
            let Some(filter) = read.filter.as_mut() else { return };
            let Some((name, site)) = take_trailing(filter, &shapes, table) else { return };
            let read = std::mem::replace(read, empty(&site));
            *value = Expr::ShapeUse { base: Box::new(Expr::Read(read)), name, site };
        });
    }
}

fn empty(site: &crate::diag::Site) -> ReadExpr {
    ReadExpr { table: String::new(), keys: Vec::new(), index: None, site: site.clone(), cursor_prefix: None, computed: Default::default(),
        order_keys: Vec::new(), range: None, matching: None, filter: None, seeks: Vec::new() }
}

/// Removes the rightmost postfix shape when it ends a comparison of a scalar
/// column with a row-independent operand (an argument, a literal). A shaped
/// value is an object, and an object never compares with a scalar column, so
/// the shape can only mean the page. Anything else (an object compared with an
/// object, a row-dependent operand) keeps the binder's typed recognition.
fn take_trailing(expr: &mut Expr, shapes: &BTreeSet<String>, table: &TableInfo) -> Option<(String, crate::diag::Site)> {
    let Expr::Binary { op, left, right, .. } = expr else { return None };
    if op == "and" { return take_trailing(right, shapes, table); }
    if !matches!(op.as_str(), "=" | "!=" | "<" | "<=" | ">" | ">=") || !scalar_column(left, table) { return None; }
    let Expr::ShapeUse { base, name, site } = right.as_mut() else { return None };
    if !shapes.contains(name) || !independent(base) { return None; }
    let found = (name.clone(), site.clone());
    **right = *base.clone();
    Some(found)
}

fn scalar_column(value: &Expr, table: &TableInfo) -> bool {
    let Expr::Member { base, name, .. } = value else { return false };
    if !matches!(base.as_ref(), Expr::Focal { .. }) { return false; }
    name == "id" || table.columns.get(name).is_some_and(|column| matches!(column.kind,
        TypeKind::Text { .. } | TypeKind::Id | TypeKind::Principal | TypeKind::Int | TypeKind::IntRange { .. } | TypeKind::Decimal { .. } | TypeKind::Money { .. }
        | TypeKind::Time | TypeKind::Bool | TypeKind::Enum { .. } | TypeKind::Ref { .. }))
}
