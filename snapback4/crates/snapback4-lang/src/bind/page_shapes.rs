//! `t where .col = value shapeName`: the postfix shape parses onto the last
//! operand, but the builder shapes the page. Hoisting it before planning keeps
//! the equality a prefix pin, so a declared shape never changes which index or
//! cap covers the read (app-farm wave 5, lane 100).
// @ref LLP 3000.036#15.1 — a shape suffix must not change prefix coverage.
use super::{catalog::Catalog, intent::independent, intent_walk as walk};
use crate::ast::*;

pub(super) fn hoist(catalog: &mut Catalog) {
    let shapes: std::collections::BTreeSet<String> = catalog.documents.iter().flat_map(|doc| doc.shapes.iter().map(|shape| shape.name.clone())).collect();
    if shapes.is_empty() { return; }
    for doc in &mut catalog.documents {
        walk::document(doc, &mut |value| {
            let Expr::Read(read) = value else { return };
            let Some(filter) = read.filter.as_mut() else { return };
            // Only a row-independent operand (an argument, a literal): an object
            // compared with a column is never a valid predicate, so the shape can
            // only mean the page. Row-dependent operands keep the binder's
            // typed recognition (`page_shape`).
            let Some((name, site)) = take_trailing(filter, &shapes) else { return };
            let read = std::mem::replace(read, empty(&site));
            *value = Expr::ShapeUse { base: Box::new(Expr::Read(read)), name, site };
        });
    }
}

fn empty(site: &crate::diag::Site) -> ReadExpr {
    ReadExpr { table: String::new(), keys: Vec::new(), index: None, site: site.clone(), cursor_prefix: None, computed: Default::default(),
        order_keys: Vec::new(), range: None, matching: None, filter: None, seeks: Vec::new() }
}

/// Removes the rightmost postfix shape when it applies to an independent operand.
fn take_trailing(expr: &mut Expr, shapes: &std::collections::BTreeSet<String>) -> Option<(String, crate::diag::Site)> {
    match expr {
        Expr::ShapeUse { base, name, site } if shapes.contains(name) && independent(base) => {
            let found = (name.clone(), site.clone());
            *expr = *base.clone();
            Some(found)
        }
        Expr::Binary { op, right, .. } if matches!(op.as_str(), "and" | "=" | "!=" | "<" | "<=" | ">" | ">=") => take_trailing(right, shapes),
        _ => None,
    }
}
