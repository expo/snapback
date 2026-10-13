//! Physical page eligibility derived solely from Quarry surface declarations.
use super::*;

// @ref LLP 3000.036.001#16 — reproduce implicit bounds from surface
// constraints, independently of the planner's selected index or IR.
pub(super) fn implicit_page(module: &LeanModule, read: &ReadExpr) -> Option<ReadExpr> {
    if read.range.is_some() || !read.keys.is_empty() || read.index.is_some() { return None; }
    let target = module.tables.iter().find(|table| table.name == read.table)?;
    let mut predicates = Vec::new();
    if let Some(filter) = &read.filter { flatten_and(filter, &mut predicates); }
    let pinned: Vec<String> = predicates.iter().filter_map(|predicate| model_equality_column(target, predicate)).collect();
    let cap = target.caps.iter().filter(|(_, by)| by.iter().all(|column| pinned.contains(column)
        && !target.cols.iter().any(|col| &col.name == column && col.on_delete == Some("setNull"))))
        .map(|(max, _)| *max).chain(target.uniques.iter().filter(|key| key.iter().all(|column|
            pinned.contains(column) && (column == "id" || target.cols.iter().any(|col| &col.name == column && !col.nullable))))
            .map(|_| 1)).min()?;
    if cap > 8192 { return None; }
    let mut page = read.clone();
    page.range = Some(ast::RangeSpec { order: Order::Asc, take: cap, cursor: None, site: read.site.clone() });
    Some(page)
}

pub(super) fn membership_physical_issue(module: &LeanModule, read: &ReadExpr) -> Option<&'static str> {
    if read.range.is_none() || !read.keys.is_empty() { return None }
    let target = module.tables.iter().find(|table| table.name == read.table)?;
    let decl = module.surface_tables.iter().find(|table| table.name == read.table)?;
    let rule = decl.rules.iter().find(|rule| rule.effect == Effect::Read && rule.bindings.is_empty()).map(|rule| &rule.value)?;
    let mut leaves = Vec::new();
    flatten_or(rule, &mut leaves);
    let mut parties = Vec::new();
    let mut memberships = Vec::new();
    for leaf in leaves {
        if let Some(column) = party_column(target, leaf) { parties.push(column.to_owned()); }
        else if let Some(membership) = membership_physical(module, target, leaf) { memberships.push(membership); }
        else { return None; }
    }
    if memberships.is_empty() { return None }
    if memberships.iter().any(|membership| !membership.source_admissible) {
        return Some("page-membership-source-unique");
    }
    let mut fits = Vec::new();
    for membership in &memberships {
        let Some(table) = module.tables.iter().find(|table| table.name == membership.source) else { return Some("page-membership-key-bound") };
        fits.push(match &membership.index {
            Some(index) => model_selected_index_fit(module, table, index),
            None => model_plain_index_fit(module, table, &membership.columns, false),
        });
    }
    let (system_pins, branches) = model_page_pins(target, read);
    fits.push(model_plain_index_fit(module, target, &model_lane_columns(system_pins, &read.order_keys), true));
    for branch in branches {
        for prefix in parties.iter().chain(memberships.iter().map(|membership| &membership.target_parent)) {
            let mut pins = branch.clone();
            if !pins.contains(prefix) { pins.push(prefix.clone()); pins.sort(); }
            fits.push(model_plain_index_fit(module, target, &model_lane_columns(pins, &read.order_keys), true));
        }
    }
    if fits.contains(&ModelIndexFit::Ambiguous) { Some("page-membership-index-selection") }
    else if fits.contains(&ModelIndexFit::Nonportable) { Some("page-membership-key-bound") }
    else { None }
}

/// Compound PAGE3 remains outside the executable model when its physical
/// lanes cannot be independently reconstructed from the surface. Logical
/// distribution is proved separately; an unsupported read is never a pass.
pub(super) fn compound_physical_issue(module: &LeanModule, read: &ReadExpr) -> Option<&'static str> {
    if read.range.is_none() || !read.keys.is_empty() { return None; }
    let target = module.tables.iter().find(|table| table.name == read.table)?;
    let decl = module.surface_tables.iter().find(|table| table.name == read.table)?;
    let rule = decl.rules.iter().find(|rule| rule.effect == Effect::Read)?.value.clone();
    fn compound(e: &Expr) -> bool {
        match e {
            Expr::Binary { op, .. } if op == "and" => true,
            Expr::Binary { op, left, right, .. } if op == "or" => compound(left) || compound(right),
            _ => false,
        }
    }
    if !compound(&rule) { return None; }
    fn ranges(e: &Expr) -> Option<Vec<Vec<&Expr>>> {
        let out = match e {
            Expr::Binary { op, left, right, .. } if op == "or" => {
                let mut out = ranges(left)?; out.extend(ranges(right)?); out
            }
            Expr::Binary { op, left, right, .. } if op == "and" => {
                let a = ranges(left)?; let b = ranges(right)?;
                if a.len().saturating_mul(b.len()) > 7 { return None; }
                a.into_iter().flat_map(|a| b.iter().map(move |b| { let mut out = a.clone(); out.extend(b); out })).collect()
            }
            other => vec![vec![other]],
        };
        (out.len() <= 7).then_some(out)
    }
    let leaves = ranges(&rule)?;
    let (system, bases) = model_page_pins(target, read);
    // The model's compound classifier deliberately keeps the where-branch
    // composition outside its fragment until it models each source prefix.
    if bases.len() > 1 { return Some("page-compound-where-branches"); }
    let mut fits = vec![model_plain_index_fit(module, target, &model_lane_columns(system.clone(), &read.order_keys), true)];
    for leaf in leaves {
        let mut pins = system.clone();
        for atom in leaf {
            if let Some(column) = model_equality_column(target, atom) {
                if target.cols.iter().any(|col| col.name == column && col.nullable)
                    && party_column(target, atom).is_none() { return Some("page-compound-nullable-pin"); }
                pins.push(column);
            } else if let Some(membership) = membership_physical(module, target, atom) {
                if !pins.contains(&membership.target_parent) && !system.contains(&membership.target_parent) {
                    if !membership.source_admissible { return Some("page-membership-source-unique"); }
                    pins.push(membership.target_parent);
                    let source = module.tables.iter().find(|table| table.name == membership.source)?;
                    fits.push(match &membership.index {
                        Some(index) => model_selected_index_fit(module, source, index),
                        None => model_plain_index_fit(module, source, &membership.columns, false),
                    });
                }
            }
        }
        pins.sort(); pins.dedup();
        fits.push(model_plain_index_fit(module, target, &model_lane_columns(pins, &read.order_keys), true));
    }
    if fits.contains(&ModelIndexFit::Ambiguous) { Some("page-compound-index-selection") }
    else if fits.contains(&ModelIndexFit::Nonportable) { Some("page-compound-key-bound") }
    else { None }
}

