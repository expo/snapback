//! Bounded positive DNF of a read rule. Each conjunct is retained in its
//! range; a guard opens only that range, never the other rule branches.
// @ref LLP 3000.036.001#16 — complete compound pages use the same bounded merge and discovery fence.
use super::{catalog::TableInfo, intent::{self, Requests}, intent_branches as branches};
use crate::ast::*;
use snapback4_core::ir::{BRANCH_LANE, GUARDED_LANE, SYSTEM_LANE, VACANCY_LANE, BOUNDED_LANE};
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
            let Some(columns) = point_columns(tables, synthesized, focal, probe) else { return false };
            if !target.indexes.iter().any(|index| target.total_unique(index) && index.columns.iter().all(|column| columns.contains(column))) { return false; }
            let mut point = probe.clone();
            for (key, column) in point.keys.iter_mut().zip(columns) { key.column = Some(column); }
            target.decl.public.is_some() || branches::read_rule(target).is_some_and(|source_rule|
                branches::by_form(source_rule, &point) || crate::print::expression(source_rule) == crate::print::expression(value))
        }
        _ => false,
    }
}

/// Resolve a point whose declared unique key is positional while additional
/// fixed equalities name columns (`roles[viewer, role = 'advisor']`). Named
/// equalities constrain the point but do not widen its identity key.
fn point_columns(tables: &Tables, synthesized: &BTreeSet<(String, String)>, focal: &TableInfo, probe: &ReadExpr) -> Option<Vec<String>> {
    if probe.keys.iter().all(|key| key.column.is_some()) {
        return Some(probe.keys.iter().filter_map(|key| key.column.clone()).collect());
    }
    let mut positional = probe.clone();
    positional.keys.retain(|key| key.column.is_none());
    let mut resolved = super::intent_lanes::probe_columns(tables, synthesized, focal, &positional)?.into_iter();
    probe.keys.iter().map(|key| key.column.clone().or_else(|| resolved.next())).collect()
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
    if let Some(merge) = vacancy(tables, synthesized, requests, read) { return Some(merge); }
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
        let mut probes = Vec::new();
        for atom in &leaf {
            if let Expr::Exists { .. } = atom {
                if branches::columns_within(atom, &[]) && leaf.len() == 1 {
                    // The core chooses one usable page guard for a guarded
                    // lane. Prove this particular omitted alternative too,
                    // so another readable static disjunct cannot conceal a
                    // hidden or timed one.
                    if !total_readable(tables, synthesized, table, atom) { return None; }
                } else {
                    // A static point beside another atom is a fixed guard too;
                    // omitting it from the retained residual would weaken the
                    // authored conjunction. A sole static point is instead the
                    // ordinary guarded lane for that top-level rule alternative.
                    probes.push(atom.clone());
                }
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
        // A conjunction may require one grant fixed by the authored page
        // prefix and one per-row grant discovered by PAGE.  Retain the fixed
        // point as an exact residual predicate on every discovered target
        // lane; the bound validator independently verifies that predicate
        // against the original rule before admitting the merge.
        // @ref LLP 3000.036.001#18 — a pinned grant may guard one varying per-row grant.
        let mut fixed_read = lane_read.clone();
        let mut fixed_candidate = candidate.clone();
        fixed_candidate.plan_lane(tables, &mut fixed_read);
        let pinned: BTreeMap<_, _> = fixed_read.keys.iter().filter_map(|key|
            key.column.as_ref().filter(|_| fixed_key_total(&key.value)).map(|column| (column.clone(), key.value.clone()))).collect();
        let mut witness = None;
        let mut fixed_guards = Vec::new();
        for mut probe in probes {
            let fields: Vec<_> = match &probe { Expr::Exists { read, .. } => read.keys.iter().filter_map(|key| intent::column(&key.value)).collect(), _ => Vec::new() };
            // A point with no outer fields is already fixed; a point with
            // outer fields becomes fixed only after every field is pinned.
            if fields.iter().all(|field| pinned.contains_key(*field)) {
                super::intent_walk::expression(&mut probe, &mut |value| {
                    if let Some(replacement) = intent::column(value).and_then(|column| pinned.get(column)) { *value = replacement.clone(); }
                });
                // The residual runs as an ordinary authored read, while the
                // rule probe itself has system visibility.  They are
                // equivalent only for an exact, timeless point the caller is
                // structurally allowed to read.
                if !total_readable(tables, synthesized, table, &probe) { return None; }
                fixed_guards.push(probe);
            } else if witness.replace(probe).is_some() { return None; }
        }
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
            for mut lane in merge.lanes.into_iter().filter(|lane| lane.branch.as_deref() != Some(SYSTEM_LANE)) {
                if !fixed_guards.is_empty() {
                    let planned = lane.planned.as_mut()?;
                    let mut predicates = planned.filter.take().map(|filter| vec![*filter]).unwrap_or_default();
                    predicates.extend(fixed_guards.iter().cloned());
                    planned.filter = intent::conjunction(predicates);
                }
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

/// A top-level `not exists point[.id]` explicitly makes vacancy observable.
/// One server lane checks the original rule for every candidate and may report
/// exhaustion only after the physical range ends. It carries no ordinary
/// filter because rule probes use wider system visibility.
// @ref LLP 3000.036.001#18 — exact vacancy is the sole non-uniform exhaustion lane.
pub(super) fn vacancy(tables: &Tables, synthesized: &BTreeSet<(String, String)>, requests: &mut Requests,
    read: &ReadExpr) -> Option<MergeExpr> {
    let range = read.range.as_ref()?;
    let table = tables.get(&read.table)?;
    let rule = branches::read_rule(table)?;
    if read.filter.as_deref().is_some_and(|filter| !branches::total(filter)) || read.index.is_some() || !read.keys.is_empty() || read.matching.is_some()
        || !read.computed.is_empty() || read.cursor_prefix.is_some()
        || table.through.is_some() || table.maintained.is_some() || table.decl.ephemeral.is_some()
        || table.decl.columns.iter().any(|column| column.written_by.is_some())
        || (table.decl.sync.is_some() && !table.decl.online_only) { return None; }
    fn alternatives<'a>(value: &'a Expr, out: &mut Vec<&'a Expr>) {
        match value {
            Expr::Binary { op, left, right, .. } if op == "or" => { alternatives(left, out); alternatives(right, out); }
            other => out.push(other),
        }
    }
    let mut disjuncts = Vec::new(); alternatives(rule, &mut disjuncts);
    let admitted = disjuncts.iter().any(|value| {
        let Expr::Unary { op, value, .. } = value else { return false };
        let Expr::Exists { read: probe, .. } = value.as_ref() else { return false };
        if op != "not" || probe.range.is_some() || probe.filter.is_some() || probe.matching.is_some()
            || !probe.seeks.is_empty() { return false; }
        let varying = probe.keys.iter().filter_map(|key| intent::column(&key.value)).collect::<BTreeSet<_>>().len();
        if varying != 1 || probe.keys.iter().any(|key| intent::column(&key.value).is_none() && !fixed_key_total(&key.value)) { return false; }
        let Some(target) = tables.get(&probe.table) else { return false };
        let Some(columns) = point_columns(tables, synthesized, table, probe) else { return false };
        target.indexes.iter().any(|index| target.total_unique(index) && index.columns.iter().all(|column| columns.contains(column))
            && probe.keys.iter().zip(&columns).filter(|(key,column)| index.columns.contains(column) && intent::column(&key.value).is_some()).count() == 1)
    });
    let mut candidate = requests.clone(); let errors = candidate.error_count();
    let mut system = read.clone(); candidate.read(tables, &mut system, false);
    let mut lane = read.clone(); candidate.plan_lane(tables, &mut lane);
    let pins = lane.keys.iter().filter_map(|key| key.column.as_ref()).collect::<Vec<_>>();
    fn probes(value: &Expr) -> u64 {
        match value {
            Expr::Exists { .. } => 1,
            Expr::Unary { value, .. } => probes(value),
            Expr::Binary { left, right, .. } => probes(left).saturating_add(probes(right)),
            _ => 0,
        }
    }
    // A schema-fixed oversized walk must not shadow an existing indexed or
    // caller-granted plan. Runtime separately reserves all static occurrences.
    let bounded = table.decl.not_before.is_none() && table.decl.expire.is_none() && table.decl.caps.iter().any(|cap|
        u64::from(cap.max).saturating_add(1).saturating_mul(1 + probes(rule)) < snapback4_core::Ceilings::default().examined
        && cap.by.iter().all(|column| pins.contains(&column)
        && !table.decl.columns.iter().any(|decl| &decl.name == column && decl.on_delete.as_ref().is_some_and(|(action,_)| *action == OnDelete::SetNull))));
    if !admitted && !bounded { return None; }
    let mut lanes = Vec::with_capacity(2); let mut order = None;
    branches::push_membership_lane(&candidate, table, &mut lanes, &mut order, system, SYSTEM_LANE, None, None, None)?;
    branches::push_membership_lane(&candidate, table, &mut lanes, &mut order, lane, if bounded { BOUNDED_LANE } else { VACANCY_LANE }, None, None, None)?;
    if candidate.error_count() != errors { return None; }
    *requests = candidate;
    Some(MergeExpr { view_order: Vec::new(), table: read.table.clone(), matching: None, filter: None,
        index: String::new(), order: range.order, take: range.take, cursor: range.cursor.clone(), lanes, site: read.site.clone() })
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
