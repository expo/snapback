//! A query page whose predicate, or whose table's read rule, is a
//! disjunction of branches each pinning an index prefix that decides the read
//! rule plans as the merge of the branch ranges (LLP 3000.036.001): `tasks where
//! .owner = viewer or .assignee = viewer last 50 by .at after c`, or the same
//! list read through `read <- .owner = viewer or .assignee = viewer`. A page
//! its own pins already decide is never rewritten, so no complete plan, index
//! or cursor changes.
use super::{catalog::TableInfo, intent::{self, Requests}};
use crate::ast::*;
use crate::diag::Site;
use snapback4_core::ir::{BRANCH_LANE, GRANT_LANE};
use std::collections::BTreeMap;

/// At most this many branches: each is an index range read ahead by one
/// page, and each may be an index the planner synthesizes.
pub(super) const MAX_BRANCHES: usize = 8;

type Tables = BTreeMap<String, TableInfo>;

/// One branch's conjuncts, and whether it is the grant branch.
type Branch = (Vec<Expr>, bool);

// @ref LLP 3000.036.001#2 — the rule: where-branches first, then the read rule's parties and readable grants.
pub(super) fn expand(tables: &Tables, requests: &mut Requests, read: &ReadExpr) -> Option<MergeExpr> {
    let range = read.range.as_ref()?;
    let branches = branches(tables, requests, read, true)?;
    let mut candidate = requests.clone();
    let errors = candidate.error_count();
    let mut lanes = Vec::with_capacity(branches.len());
    let mut order: Option<Vec<String>> = None;
    for (conjuncts, grant) in branches {
        let mut lane = read.clone();
        lane.filter = intent::conjunction(conjuncts);
        // The grant lane is the read as written: plan it exactly as the
        // single-index plan would, so the binding check's fallback to it is
        // that plan (an order-column pin a guard needs stays a pin, LLP 3000.036
        // §16.3); its order must still match the party lanes', or no merge.
        if grant { candidate.read(tables, &mut lane, false); } else { candidate.plan_lane(tables, &mut lane); }
        if !grant && !decided(tables, &lane) { return None; }
        // Every lane resumes from one shared position: the same order columns
        // after its pins (lane planning never pins an order column).
        if order.get_or_insert_with(|| lane.order_keys.clone()) != &lane.order_keys || lane.index.is_none() { return None; }
        // An index holds at most 8 components; a lane never makes a program refuse.
        if lane.keys.len() + lane.order_keys.len() > 8 { return None; }
        lanes.push(MergeLane { admission: read.filter.clone(), nulls: None, distinct: None, branch: Some(if grant { GRANT_LANE } else { BRANCH_LANE }.into()),
            planned: Some(Box::new(lane)), project: None, table: None, prefix: Vec::new(), columns: None, loop_: None, site: read.site.clone() });
    }
    if candidate.error_count() != errors { return None; }
    *requests = candidate;
    Some(MergeExpr { view_order: Vec::new(), table: read.table.clone(), matching: None, filter: None, index: String::new(), order: range.order, take: range.take,
        cursor: range.cursor.clone(), lanes, site: read.site.clone() })
}

/// `exists t where W` with `W` branch-decided: `exists (branch 1) or …`, each
/// a decided existence read, so the answer is `true` or `false`. A rule with a
/// grant keeps its single read (a grant-guarded existence lane is not planned).
// @ref LLP 3000.036.001#8 — exists over the same shapes, without grants.
pub(super) fn exists(tables: &Tables, requests: &mut Requests, read: &ReadExpr, site: &Site) -> Option<Expr> {
    if read.range.is_some() { return None; }
    let branches = branches(tables, requests, read, false)?;
    let mut candidate = requests.clone();
    let errors = candidate.error_count();
    let mut reads = Vec::with_capacity(branches.len());
    for (conjuncts, _) in branches {
        let mut lane = read.clone();
        lane.filter = intent::conjunction(conjuncts);
        candidate.read(tables, &mut lane, false);
        if !decided(tables, &lane) { return None; }
        reads.push(Expr::Exists { read: lane, site: site.clone() });
    }
    if candidate.error_count() != errors { return None; }
    *requests = candidate;
    reads.into_iter().reduce(|left, right| Expr::Binary { op: "or".into(), site: site.clone(), left: Box::new(left), right: Box::new(right) })
}

/// The branches of an undecided read, or `None` when the rule does not apply.
fn branches(tables: &Tables, requests: &Requests, read: &ReadExpr, grants: bool) -> Option<Vec<Branch>> {
    let table = tables.get(&read.table)?;
    if read.index.is_some() || !read.keys.is_empty() || read.matching.is_some() || !read.computed.is_empty() || read.cursor_prefix.is_some() { return None; }
    if table.maintained.is_some() || table.through.is_some() || table.decl.ephemeral.is_some() || !table.captures.is_empty() || table.decl.public.is_some() { return None; }
    let rule = read_rule(table)?;
    // A page its own pins decide keeps its plan.
    let mut probe = requests.clone();
    let mut planned = read.clone();
    probe.read(tables, &mut planned, false);
    if decided(tables, &planned) { return None; }
    // Each lane evaluates the predicate's parts on its own rows: they must be
    // total, so moving an alternative into its own lane cannot raise a refusal
    // that the original's short circuit skipped (`or (… and 1 / n = 1)`).
    if read.filter.as_deref().is_some_and(|filter| !total(filter)) { return None; }
    let conjuncts = read.filter.as_ref().map(|filter| { let mut out = Vec::new(); intent::split(*filter.clone(), &mut out); out }).unwrap_or_default();
    let alternatives = where_branches(table, &conjuncts);
    // Case 1: every alternative of the one `or` in `where` decides the rule.
    if let Some(alternatives) = &alternatives
        && alternatives.iter().all(|alternative| {
            let mut lane = read.clone();
            lane.filter = intent::conjunction(alternative.clone());
            let mut probe = requests.clone();
            probe.plan_lane(tables, &mut lane);
            decided(tables, &lane)
        }) {
        return Some(alternatives.iter().map(|alternative| (alternative.clone(), false)).collect());
    }
    // Case 2: the read rule is parties and page guards: readable grants, and
    // disjuncts the page's own pins decide (LLP 3000.036 §16.3), which the
    // binding check confirms with the core's `covering_grant`.
    let mut disjunct_list = Vec::new();
    disjuncts(rule, &mut disjunct_list);
    if disjunct_list.len() < 2 { return None; }
    let pinned: Vec<String> = conjuncts.iter().filter_map(|conjunct| intent::equality(conjunct, table).map(|(column, _)| column)).collect();
    let mut parties = Vec::new();
    for disjunct in &disjunct_list {
        if let Some(column) = party(table, disjunct) { if !parties.contains(&column) { parties.push(column); } }
        else if columns_within(disjunct, &pinned) { /* a guard: the grant lane reads it */ }
        else { return None; }
    }
    // `exists` takes case 1 only: an `or` of party reads misses rows for the
    // system, which every rule admits, and a guard lane has no existence form.
    if parties.is_empty() || !grants { return None; }
    let base = alternatives.unwrap_or_else(|| vec![conjuncts.clone()]);
    // The grant lane, the read as written, is read for a caller its guards
    // admit and for the system (which every rule admits); a rule of parties
    // alone has no guard, so the lane is the system's only.
    let mut out = vec![(conjuncts, true)];
    for branch in &base {
        for column in &parties {
            let mut lane = vec![viewer_pin(column, &read.site)];
            lane.extend(branch.iter().cloned());
            out.push((lane, false));
        }
    }
    (out.len() <= MAX_BRANCHES).then_some(out)
}

/// The alternatives of the read's one top-level `or` conjunct, each with the
/// other conjuncts, when every alternative holds an equality pin.
fn where_branches(table: &TableInfo, conjuncts: &[Expr]) -> Option<Vec<Vec<Expr>>> {
    let ors: Vec<usize> = conjuncts.iter().enumerate().filter(|(_, conjunct)| matches!(conjunct, Expr::Binary { op, .. } if op == "or")).map(|(n, _)| n).collect();
    let [position] = ors.as_slice() else { return None };
    let mut alternatives = Vec::new();
    disjuncts(&conjuncts[*position], &mut alternatives);
    if alternatives.len() < 2 || alternatives.len() > MAX_BRANCHES { return None; }
    let rest: Vec<Expr> = conjuncts.iter().enumerate().filter(|(n, _)| n != position).map(|(_, conjunct)| conjunct.clone()).collect();
    alternatives.into_iter().map(|alternative| {
        let mut lane = Vec::new();
        intent::split(alternative, &mut lane);
        if !lane.iter().any(|conjunct| pin(table, conjunct)) { return None; }
        lane.extend(rest.iter().cloned());
        Some(lane)
    }).collect()
}

/// An equality the planner turns into an index prefix. A nullable column is
/// pinned only to `viewer`, never to a value that may be null, so a branch
/// never seeks a null the original filter rejects.
fn pin(table: &TableInfo, conjunct: &Expr) -> bool {
    let Some((column, value)) = intent::equality(conjunct, table) else { return false };
    column != "id" && table.columns.get(&column).is_some_and(|ty| !ty.optional || is_viewer(&value))
}

/// The planned read's prefix decides the read rule: every column the rule
/// reads is pinned (with the self-witness proof), or the rule is true by the
/// pins' form (the core's `rule_true`, and the Lean model's `Rule.byForm`).
pub(super) fn decided(tables: &Tables, planned: &ReadExpr) -> bool {
    let Some(table) = tables.get(&planned.table) else { return false };
    if super::intent_lanes::prefix_decides_rule(tables, planned) { return true; }
    read_rule(table).is_some_and(|rule| by_form(rule, planned))
}

/// `allow`, `.col = viewer` pinned to `viewer`, `.col = 'x'` pinned to `'x'`,
/// and `or`/`and` of those.
fn by_form(rule: &Expr, planned: &ReadExpr) -> bool {
    let pinned = |column: &str| planned.keys.iter().find(|key| key.column.as_deref() == Some(column)).map(|key| &key.value);
    match rule {
        Expr::Name { name, .. } if name == "allow" => true,
        Expr::Binary { op, left, right, .. } if op == "or" => by_form(left, planned) || by_form(right, planned),
        Expr::Binary { op, left, right, .. } if op == "and" => by_form(left, planned) && by_form(right, planned),
        Expr::Binary { op, left, right, .. } if op == "=" => {
            let (column, value) = match (intent::column(left), intent::column(right)) {
                (Some(column), None) => (column, right.as_ref()),
                (None, Some(column)) => (column, left.as_ref()),
                _ => return false,
            };
            match (value, pinned(column)) {
                (value, Some(pin)) if is_viewer(value) => is_viewer(pin),
                (Expr::Literal { value, .. }, Some(Expr::Literal { value: pin, .. })) => value == pin && *value != Literal::Null,
                _ => false,
            }
        }
        _ => false,
    }
}

fn read_rule(table: &TableInfo) -> Option<&Expr> {
    match table.decl.rules.iter().filter(|rule| rule.effect == Effect::Read).collect::<Vec<_>>().as_slice() {
        [rule] => Some(&rule.value),
        _ => None,
    }
}

fn disjuncts(value: &Expr, out: &mut Vec<Expr>) {
    if let Expr::Binary { op, left, right, .. } = value && op == "or" { disjuncts(left, out); disjuncts(right, out); }
    else { out.push(value.clone()); }
}

/// `.col = viewer` (either side) on a principal column of the row.
fn party(table: &TableInfo, value: &Expr) -> Option<String> {
    let Expr::Binary { op, left, right, .. } = value else { return None };
    if op != "=" { return None; }
    let column = match (intent::column(left), intent::column(right)) {
        (Some(column), None) if is_viewer(right) => column,
        (None, Some(column)) if is_viewer(left) => column,
        _ => return None,
    };
    (table.columns.get(column)?.kind == TypeKind::Principal).then(|| column.to_owned())
}

/// A rule disjunct every row column of which the page pins: none for a role
/// or a seat, the parent's column for a parent probe under its pin.
fn columns_within(value: &Expr, pinned: &[String]) -> bool {
    let mut copy = value.clone();
    let mut within = true;
    super::intent_walk::expression(&mut copy, &mut |value| {
        if let Expr::Member { base, name, .. } = value && matches!(base.as_ref(), Expr::Focal { .. }) && !pinned.contains(name) { within = false; }
        else if let Expr::Focal { .. } = value { /* reached through a member, checked there */ }
    });
    within && !has_focal_without_member(value)
}

/// A bare `.` (the whole row) is not a pinned column.
fn has_focal_without_member(value: &Expr) -> bool {
    match value {
        Expr::Focal { .. } => true,
        Expr::Member { base, .. } if matches!(base.as_ref(), Expr::Focal { .. }) => false,
        Expr::Member { base, .. } | Expr::Unary { value: base, .. } => has_focal_without_member(base),
        Expr::Binary { left, right, .. } => has_focal_without_member(left) || has_focal_without_member(right),
        Expr::Exists { read, .. } => read.keys.iter().any(|key| has_focal_without_member(&key.value)) || read.filter.as_deref().is_some_and(has_focal_without_member),
        Expr::Call { args, .. } | Expr::Array { items: args, .. } => args.iter().any(has_focal_without_member),
        _ => false,
    }
}

/// A predicate whose evaluation never refuses and never reads: comparisons,
/// `in` and boolean operators over the row's own columns, arguments, literals
/// and `viewer`. Arithmetic (even `now - 7d`, which overflows at the clock's
/// bound), assertions, calls and reads are left to the single-index plan, and
/// so is a member of anything but the row (`.meta.ok`, `m.ok`), which binds to
/// a read of the referenced row that a meter can cut (GPT round 4, finding 1).
// @ref LLP 3000.036.001#2 — totality: no read, so a lane is cut only between candidates
fn total(value: &Expr) -> bool {
    match value {
        Expr::Literal { .. } | Expr::Name { .. } | Expr::Focal { .. } => true,
        Expr::Member { base, .. } => matches!(base.as_ref(), Expr::Focal { .. }),
        Expr::Unary { op, value, .. } => op == "not" && total(value),
        Expr::Binary { op, left, right, .. } => matches!(op.as_str(), "=" | "!=" | "<" | "<=" | ">" | ">=" | "and" | "or" | "in") && total(left) && total(right),
        Expr::Array { items, .. } => items.iter().all(total),
        _ => false,
    }
}

fn is_viewer(value: &Expr) -> bool { matches!(value, Expr::Name { name, .. } if name == "viewer") }

fn viewer_pin(column: &str, site: &Site) -> Expr {
    Expr::Binary { op: "=".into(), site: site.clone(),
        left: Box::new(Expr::Member { base: Box::new(Expr::Focal { site: site.clone() }), name: column.into(), site: site.clone() }),
        right: Box::new(Expr::Name { name: "viewer".into(), site: site.clone() }) }
}
