//! Physical page eligibility derived solely from Quarry surface declarations.
use super::*;

enum PagePins {
    Plain(Vec<String>),
    Product { system: Vec<String>, branches: Vec<Vec<String>> },
    Invalid,
}

/// Reconstruct the native planner's bounded Cartesian product from the
/// authored filter.  This stays surface-derived: the executable model cannot
/// trust the binder's proof metadata when deciding whether comparison is safe.
// @ref LLP 3000.036.001#18 — every modeled PAGE filter lane has its own exact physical prefix.
fn page_pins(table: &Table, read: &ReadExpr) -> PagePins {
    let Some(filter) = read.filter.as_deref() else { return PagePins::Plain(Vec::new()) };
    let mut conjuncts = Vec::new();
    flatten_and(filter, &mut conjuncts);
    let system = model_pin_columns(table, &conjuncts, &read.order_keys);
    let mut branches = vec![Vec::new()];
    let mut distributed = false;
    for conjunct in &conjuncts {
        let mut alternatives = Vec::new();
        flatten_or(conjunct, &mut alternatives);
        distributed |= alternatives.len() > 1;
        if branches.len().saturating_mul(alternatives.len()) > 8 { return PagePins::Invalid; }
        branches = branches.into_iter().flat_map(|prefix| alternatives.iter().map(move |alternative| {
            let mut lane = prefix.clone();
            flatten_and(alternative, &mut lane);
            lane
        })).collect();
    }
    if !distributed || branches.len() < 2 { return PagePins::Plain(system); }
    // The native candidate declines an alternative product when any lane has
    // no physical pin.  That leaves the authored read on its ordinary,
    // incomplete scan, which the model can still execute directly.
    if branches.iter().any(|branch| !branch.iter().any(|atom| page_pin(table, atom))) {
        return PagePins::Plain(system);
    }
    PagePins::Product {
        system,
        branches: branches.into_iter().map(|branch| model_pin_columns(table, &branch, &read.order_keys)).collect(),
    }
}

fn page_pin(table: &Table, expression: &Expr) -> bool {
    if let Expr::Binary { op, left, right, .. } = expression && op == "=" {
        let (column, value) = if let Some(column) = column_of(left) { (column, right.as_ref()) }
            else if let Some(column) = column_of(right) { (column, left.as_ref()) }
            else { return false };
        return column != "id" && model_independent(value) && table.cols.iter().find(|field| field.name == column)
            .is_some_and(|field| !field.nullable || matches!(value, Expr::Name { name, .. } if name == "viewer"));
    }
    let value = if let Expr::Unary { op, value, .. } = expression && op == "not" { value.as_ref() } else { expression };
    let Some(column) = column_of(value) else { return false };
    column != "id" && table.cols.iter().find(|field| field.name == column)
        .is_some_and(|field| !field.nullable && matches!(field.kind, Kind::Bool))
}

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
        if let Some(column) = party_column(target, leaf) {
            if !parties.iter().any(|party| party == column) { parties.push(column.to_owned()); }
        }
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
    let (system_pins, branches) = match page_pins(target, read) {
        PagePins::Plain(system) => (system.clone(), vec![system]),
        PagePins::Product { system, branches } => {
            // A product that pins any membership witness's varying outer
            // field is declined by the native planner.  Preserve the modeled
            // ordinary scan instead of counting those pins as PAGE lanes.
            if memberships.iter().any(|membership| branches.iter().any(|branch|
                branch.contains(&membership.target_parent))) {
                (system.clone(), vec![system])
            } else {
                (system, branches)
            }
        }
        PagePins::Invalid => return Some("page-membership-filter-product"),
    };
    if 1usize.saturating_add(branches.len().saturating_mul(parties.len().saturating_add(memberships.len()))) > 8 {
        return Some("page-membership-filter-product");
    }
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
    let system = match page_pins(target, read) {
        PagePins::Plain(system) => system,
        PagePins::Product { .. } | PagePins::Invalid => return Some("page-compound-where-branches"),
    };
    // The model's compound classifier deliberately keeps the where-branch
    // composition outside its fragment until it models each source prefix.
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
