//! Physical page eligibility derived solely from Quarry surface declarations.
use super::*;

/// The executable predicate classifier currently knows literal/viewer point
/// terms only. Preserve an explicit boundary for admitted native argument
/// and signed-expression keys rather than reporting a model disagreement
/// under an incompletely translated completeness proof.
pub(super) fn static_key_issue(read: &ReadExpr) -> Option<&'static str> {
    fn missing(expr: &Expr) -> bool {
        match expr {
            Expr::Exists { read, .. } => read.keys.iter().all(|key| model_independent(&key.value))
                && read.keys.iter().any(|key|
                !matches!(&key.value, Expr::Literal { .. })
                && !matches!(&key.value, Expr::Name { name, .. } if name == "viewer")),
            Expr::Binary { left, right, .. } => missing(left) || missing(right),
            Expr::Unary { value, .. } => missing(value),
            _ => false,
        }
    }
    read.filter.as_deref().is_some_and(missing).then_some("page-static-key-expression")
}

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
    if !compound(&rule) && !matches!(&rule, Expr::Binary { op, .. } if op == "or") { return None; }
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
    let mut simple = Vec::new(); flatten_or(&rule, &mut simple);
    // Existing party and exact point-membership classifiers take precedence;
    // their where alternatives already have an independent physical proof.
    if simple.iter().all(|leaf| party_column(target, leaf).is_some() || membership_physical(module, target, leaf).is_some()) { return None; }
    let leaves = ranges(&rule)?;
    let (system, bases) = model_page_pins(target, read);
    // The model's compound classifier deliberately keeps the where-branch
    // composition outside its fragment until it models each source prefix.
    if bases.len() > 1 { return Some("page-compound-where-branches"); }
    let mut fits = vec![model_plain_index_fit(module, target, &model_lane_columns(system.clone(), &read.order_keys), true)];
    for leaf in leaves {
        let mut pins = system.clone();
        let mut predicates = Vec::new();
        if let Some(filter) = &read.filter { flatten_and(filter, &mut predicates); }
        predicates.extend(leaf.iter().copied());
        let fixed: BTreeMap<_, _> = predicates.iter().filter_map(|atom| {
            let Expr::Binary { op, left, right, .. } = atom else { return None };
            if op != "=" { return None; }
            let (column, value) = if let Some(column) = column_of(left) { (column, right.as_ref()) }
                else { (column_of(right)?, left.as_ref()) };
            matches!(value, Expr::Name { .. } | Expr::Literal { .. }).then(|| (column.to_owned(), value.clone()))
        }).collect();
        for atom in &leaf {
            if let Some(column) = model_equality_column(target, atom) {
                if target.cols.iter().any(|col| col.name == column && col.nullable)
                    && party_column(target, atom).is_none() { return Some("page-compound-nullable-pin"); }
                pins.push(column);
            }
        }
        for atom in leaf {
            let mut substituted = atom.clone();
            crate::bind::intent_walk::expression(&mut substituted, &mut |e| {
                if let Some(value) = column_of(e).and_then(|column| fixed.get(column)) { *e = value.clone(); }
            });
            if let Some(membership) = membership_physical(module, target, &substituted) {
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


/// The model's direct grant theorem remains positive. Standard bounded
/// negative-grant pages use the independent branch classifier; direct scalar
/// absence/aggregation and fallible-filter fallback stay explicitly outside
/// that executable completeness fragment until its negative-view proof lands.
pub(super) fn negative_grant_issue(module: &LeanModule, read: &ReadExpr) -> Option<&'static str> {
    if !read.keys.is_empty() && read.filter.is_none() && read.range.is_none() { return None; }
    fn negative_probe(expr: &Expr) -> bool {
        match expr {
            Expr::Unary { op, value, .. } if op=="not" => matches!(value.as_ref(),Expr::Exists {..}),
            Expr::Binary { op, left, right, .. } if op=="and" || op=="or" => negative_probe(left) || negative_probe(right),
            _=>false,
        }
    }
    let table = module.surface_tables.iter().find(|table| table.name == read.table)?;
    let rule = &table.rules.iter().find(|rule| rule.effect == Effect::Read)?.value;
    if !negative_probe(rule) { return None; }
    fn total(expr: &Expr) -> bool {
        match expr {
            Expr::Name { .. } | Expr::Literal { .. } | Expr::Focal { .. } => true,
            Expr::Member { base, .. } => matches!(base.as_ref(), Expr::Focal { .. }),
            Expr::Binary { op, left, right, .. } => matches!(op.as_str(), "=" | "!=" | "<" | "<=" | ">" | ">=" | "and" | "or" | "in") && total(left) && total(right),
            Expr::Unary { op, value, .. } => op == "not" && total(value),
            Expr::Array { items, .. } => items.iter().all(total), _ => false,
        }
    }
    fn distributed_width(expr: &Expr) -> usize {
        match expr {
            Expr::Binary { op, left, right, .. } if op=="or" => distributed_width(left).saturating_add(distributed_width(right)).min(8),
            Expr::Binary { op, left, right, .. } if op=="and" => distributed_width(left).saturating_mul(distributed_width(right)).min(8),
            _=>1,
        }
    }
    (read.range.is_none() || read.filter.as_deref().is_some_and(|filter| !total(filter)) || distributed_width(rule) >= 8)
        .then_some("page-negative-grant-fallback")
}

/// Named order normalization is speculative in the native compiler. Only
/// the independently modeled unfiltered mixed range fragment normalizes here;
/// filtered or one-party fallback candidates stay named Unsupported.
pub(super) fn named_merge_fragment(module: &LeanModule, read: &ReadExpr) -> bool {
    if read.filter.as_deref().is_some_and(|filter| !matches!(filter, Expr::Literal { value: Literal::Bool(true), .. })) { return false; }
    let Some(target)=module.tables.iter().find(|t|t.name==read.table) else {return false;};
    let Some(rule)=module.surface_tables.iter().find(|t|t.name==read.table).and_then(|t|t.rules.iter().find(|r|r.effect==Effect::Read)).map(|r|&r.value) else {return false;};
    if !matches!(rule,Expr::Binary {op,..} if op=="or") {return false;}
    let mut leaves=Vec::new();flatten_or(rule,&mut leaves);
    leaves.len()<=7 && leaves.iter().any(|leaf|party_column(target,leaf).is_some())
        && leaves.iter().all(|leaf|party_column(target,leaf).is_some() || membership_physical(module,target,leaf).is_some()
            || model_equality_column(target,leaf).is_some())
}
