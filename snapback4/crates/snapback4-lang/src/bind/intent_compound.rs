//! Bounded positive DNF of a read rule. Each conjunct is retained in its
//! range; a guard opens only that range, never the other rule branches.
// @ref LLP 3000.036.001#16 — complete compound pages use the same bounded merge and discovery fence.
use super::{catalog::TableInfo, intent::{self, Requests}, intent_branches as branches};
use crate::ast::*;
use snapback4_core::ir::{BRANCH_LANE, GUARDED_LANE, SYSTEM_LANE};
use std::collections::{BTreeMap, BTreeSet};

type Tables = BTreeMap<String, TableInfo>;

/// Comparisons and readable static points have a total logical predicate.
/// A physical point can still cut: the merge frontier excludes an unfinished
/// filter candidate, so continuation retries it rather than skipping it.
pub(super) fn total_readable(tables: &Tables, synthesized: &BTreeSet<(String, String)>, focal: &TableInfo, value: &Expr) -> bool {
    if branches::total(value) { return true; }
    match value {
        Expr::Binary { op, left, right, .. } if op == "and" || op == "or" =>
            total_readable(tables, synthesized, focal, left) && total_readable(tables, synthesized, focal, right),
        Expr::Exists { read: probe, .. } if branches::columns_within(value, &[]) => {
            if probe.range.is_some() || probe.filter.is_some() || probe.matching.is_some() || !probe.seeks.is_empty() { return false; }
            if !probe.keys.iter().all(|key| fixed_key_total(&key.value)) { return false; }
            let Some(target) = tables.get(&probe.table) else { return false };
            if target.through.is_some() || target.decl.not_before.is_some() || target.decl.expire.is_some() { return false; }
            let Some(columns) = super::intent_lanes::probe_columns(tables, synthesized, focal, probe) else { return false };
            if !target.indexes.iter().any(|index| target.total_unique(index) && index.columns.iter().all(|column| columns.contains(column))) { return false; }
            let mut point = probe.clone();
            for (key, column) in point.keys.iter_mut().zip(columns) { key.column = Some(column); }
            target.decl.public.is_some() || branches::read_rule(target).is_some_and(|source_rule|
                branches::by_form(source_rule, &point) || crate::print::expression(source_rule) == crate::print::expression(value))
        }
        _ => false,
    }
}

/// Distribution must not evaluate a fallible key on an overlapping party's
/// row where the original short circuit skipped it. Signed numeric literals
/// are bound constants; arithmetic, assertions, calls and reads stay put.
fn fixed_key_total(value: &Expr) -> bool {
    matches!(value, Expr::Name { .. } | Expr::Literal { .. })
        || matches!(value, Expr::Unary { op, value, .. } if op == "-" && matches!(value.as_ref(), Expr::Literal { value: Literal::Number(_), .. }))
}

pub(super) fn expand(tables: &Tables, synthesized: &BTreeSet<(String, String)>, requests: &mut Requests, read: &ReadExpr) -> Option<MergeExpr> {
    let range = read.range.as_ref()?;
    let table = tables.get(&read.table)?;
    if read.index.is_some() || !read.keys.is_empty() || read.matching.is_some() || !read.computed.is_empty() || read.cursor_prefix.is_some()
        || table.maintained.is_some() || table.through.is_some() || table.decl.ephemeral.is_some() || !table.captures.is_empty() || table.decl.public.is_some()
        || read.filter.as_deref().is_some_and(|filter| !branches::total(filter)) { return None; }
    let rule = branches::read_rule(table)?;
    // Keep the published simple plans and descriptors. This pass handles
    // compound rules, not the existing party/grant or exact membership rule.
    if !compound(rule) && !matches!(rule, Expr::Binary { op, .. } if op == "or") { return None; }
    let leaves = dnf(table, rule)?;
    if leaves.len() + 1 > branches::MAX_BRANCHES { return None; }
    let mut candidate = requests.clone();
    let errors = candidate.error_count();
    let mut lanes = Vec::new();
    let mut order = None;
    let mut system = read.clone(); candidate.read(tables, &mut system, false);
    if branches::decided(tables, &system) { return None; }
    branches::push_membership_lane(&candidate, table, &mut lanes, &mut order, system, SYSTEM_LANE, None, None, read.filter.clone())?;
    for leaf in leaves {
        let mut pins = Vec::new();
        let mut witness = None;
        for atom in &leaf {
            if let Expr::Exists { .. } = atom && !branches::columns_within(atom, &[]) {
                if witness.replace(atom.clone()).is_some() { return None; }
            } else if intent::equality(atom, table).is_some() {
                pins.push(atom.clone());
            } else if matches!(atom, Expr::Unary { .. }) && !branches::columns_within(atom, &[]) {
                // A bare negated boolean pin was handled above. Negated
                // probes are outside this positive distribution classifier.
                return None;
            } else if !branches::columns_within(atom, &[]) { return None; }
        }
        let mut lane_read = read.clone();
        if let Some(filter) = &read.filter { pins.push(*filter.clone()); }
        lane_read.filter = intent::conjunction(pins);
        if let Some(mut witness) = witness {
            // Substitute only necessary equality pins with infallible fixed
            // values. This leaves at most one varying source component in a
            // two-party parent witness; no copied-parent relationship is assumed.
            let mut fixed_read = lane_read.clone();
            let mut fixed_candidate = candidate.clone();
            fixed_candidate.plan_lane(tables, &mut fixed_read);
            let pinned: BTreeMap<_, _> = fixed_read.keys.iter().filter_map(|key|
                key.column.as_ref().filter(|_| fixed_key_total(&key.value)).map(|column| (column.clone(), key.value.clone()))).collect();
            let target_pinned = if let Expr::Exists { read: probe, .. } = &witness {
                let fields: Vec<_> = probe.keys.iter().filter_map(|key| intent::column(&key.value)).collect();
                !fields.is_empty() && fields.iter().all(|field| pinned.contains_key(*field))
            } else { false };
            if target_pinned {
                candidate.plan_lane(tables, &mut lane_read);
                branches::push_membership_lane(&candidate, table, &mut lanes, &mut order, lane_read, GUARDED_LANE, None, None, read.filter.clone())?;
                continue;
            }
            // Reuse PAGE's complete source admission on exactly this witness.
            // The real schema still has the entire compound rule; the bound
            // validator verifies its remaining conjuncts from these pins.
            if leaf.iter().any(|atom| !matches!(atom, Expr::Exists { .. }) && intent::equality(atom, table).is_none()) { return None; }
            super::intent_walk::expression(&mut witness, &mut |value| {
                if let Some(replacement) = intent::column(value).and_then(|column| pinned.get(column)) { *value = replacement.clone(); }
            });
            let mut local = tables.clone();
            local.get_mut(&read.table)?.decl.rules.iter_mut().find(|rule| rule.effect == Effect::Read)?.value = witness;
            let merge = branches::membership(&local, synthesized, &mut candidate, &lane_read)?;
            for lane in merge.lanes.into_iter().filter(|lane| lane.branch.as_deref() != Some(SYSTEM_LANE)) {
                if order.as_ref() != Some(&lane.planned.as_ref()?.order_keys) { return None; }
                lanes.push(lane);
                if lanes.len() > branches::MAX_BRANCHES { return None; }
            }
        } else {
            candidate.plan_lane(tables, &mut lane_read);
            let branch = if branches::decided(tables, &lane_read) { BRANCH_LANE } else { GUARDED_LANE };
            // Binding repeats guard readability against the real core schema.
            // Do not put a grant probe in the residual row predicate.
            branches::push_membership_lane(&candidate, table, &mut lanes, &mut order, lane_read, branch, None, None, read.filter.clone())?;
        }
    }
    if candidate.error_count() != errors { return None; }
    *requests = candidate;
    Some(MergeExpr { view_order: Vec::new(), table: read.table.clone(), matching: None, filter: None, index: String::new(), order: range.order,
        take: range.take, cursor: range.cursor.clone(), lanes, site: read.site.clone() })
}

fn compound(rule: &Expr) -> bool {
    match rule {
        Expr::Binary { op, .. } if op == "and" || op == "!=" => true,
        Expr::Binary { op, left, right, .. } if op == "or" => compound(left) || compound(right),
        _ => false,
    }
}

/// At most seven positive alternatives plus the system range. A nullable
/// enum's `!= null` is exactly its finite set of non-null values.
fn dnf(table: &TableInfo, value: &Expr) -> Option<Vec<Vec<Expr>>> {
    let out = match value {
        Expr::Binary { op, left, right, .. } if op == "or" => {
            let mut out = dnf(table, left)?; out.extend(dnf(table, right)?); out
        }
        Expr::Binary { op, left, right, .. } if op == "and" => {
            let a = dnf(table, left)?; let b = dnf(table, right)?;
            if a.len().saturating_mul(b.len()) >= branches::MAX_BRANCHES { return None; }
            a.into_iter().flat_map(|a| b.iter().map(move |b| { let mut out = a.clone(); out.extend(b.clone()); out })).collect()
        }
        Expr::Binary { op, left, right, site } if op == "!=" => {
            let (column, term) = if let Some(column) = intent::column(left) { (column, right) } else { (intent::column(right)?, left) };
            let kind = table.columns.get(column)?;
            let TypeKind::Enum { variants } = &kind.kind else { return None; };
            let include = |variant: &String| match term.as_ref() {
                Expr::Literal { value: Literal::Null, .. } if kind.optional => Some(true),
                Expr::Literal { value: Literal::Str(excluded), .. } if !kind.optional => Some(variant != excluded),
                _ => None,
            };
            if variants.iter().any(|variant| include(variant).is_none()) { return None; }
            variants.iter().filter(|variant| include(variant).unwrap()).map(|variant| vec![Expr::Binary { op: "=".into(), left: Box::new(Expr::Member {
                base: Box::new(Expr::Focal { site: site.clone() }), name: column.into(), site: site.clone() }),
                right: Box::new(Expr::Literal { value: Literal::Str(variant.clone()), site: site.clone() }), site: site.clone() }]).collect()
        }
        other => vec![vec![other.clone()]],
    };
    (out.len() < branches::MAX_BRANCHES).then_some(out)
}
