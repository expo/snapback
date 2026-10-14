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
use snapback4_core::ir::{BRANCH_LANE, GRANT_LANE, MEMBERSHIP_LANE, SYSTEM_LANE};
use std::collections::BTreeMap;

/// At most this many branches: each is an index range read ahead by one
/// page, and each may be an index the planner synthesizes.
pub(super) const MAX_BRANCHES: usize = 8;

type Tables = BTreeMap<String, TableInfo>;

/// One branch's conjuncts, and whether it is the grant branch.
type Branch = (Vec<Expr>, bool);

/// Only turn an implicit whole-group read into a page when the original
/// prefix has a stored bound. A party cap does not bound a staff's all-row
/// branch. The original bound applies to the union, rather than each party.
fn bounded_page(tables: &Tables, requests: &Requests, read: &ReadExpr) -> Option<ReadExpr> {
    if read.range.is_some() { return Some(read.clone()); }
    let table = tables.get(&read.table)?;
    let mut planned = read.clone();
    let mut probe = requests.clone();
    probe.read(tables, &mut planned, false);
    let pinned: Vec<String> = planned.keys.iter().filter_map(|key| key.column.clone()).collect();
    let cap = table.decl.caps.iter().filter(|cap| cap.by.iter().all(|column| pinned.contains(column))
        && !cap.by.iter().any(|column| table.decl.columns.iter().any(|field| &field.name == column
            && field.on_delete.as_ref().is_some_and(|(action, _)| action == &OnDelete::SetNull))))
        .map(|cap| cap.max).chain(table.indexes.iter().filter(|index| table.total_unique(index))
            .filter(|index| index.columns.iter().all(|column| pinned.contains(column))).map(|_| 1)).min()?;
    if u64::from(cap) > snapback4_core::Ceilings::default().examined { return None; }
    let mut page = read.clone();
    page.range = Some(RangeSpec { order: Order::Asc, take: cap, cursor: None, site: read.site.clone() });
    Some(page)
}

// @ref LLP 3000.036.001#2 — the rule: where-branches first, then the read rule's parties and readable grants.
pub(super) fn expand(tables: &Tables, synthesized: &std::collections::BTreeSet<(String, String)>, requests: &mut Requests, read: &ReadExpr) -> Option<MergeExpr> {
    // @ref LLP 3000.036.001#16 — implicit whole-group reads retain their proven schema bound.
    let mut authored = read.clone();
    // A named plain range states the same column order. Normalize only a
    // speculative merge input; a declined candidate retains the authored read.
    if authored.range.is_some() && authored.keys.is_empty() && authored.matching.is_none()
        && authored.computed.is_empty() && authored.cursor_prefix.is_none()
        && let Some(index) = authored.index.as_ref().and_then(|name| tables.get(&authored.table)?.indexes.iter().find(|index| &index.name == name))
        && index.is_plain() {
        authored.order_keys = index.columns.clone(); authored.index = None;
    }
    let normalized = bounded_page(tables, requests, &authored)?;
    let read = &normalized;
    if let Some(merge) = scoped_membership(tables, synthesized, requests, read) { return Some(merge); }
    if let Some(merge) = membership(tables, synthesized, requests, read) { return Some(merge); }
    // An exact owner-or-membership rule belongs wholly to PAGE. If one of its
    // stricter eligibility checks declines, keep the original scan instead of
    // reinterpreting its probe as a generic grant branch.
    if owner_membership_shape(tables, synthesized, read) && !pinned_memberships(tables, synthesized, read) { return None; }
    let range = read.range.as_ref()?;
    let Some(branches) = branches(tables, synthesized, requests, read, true) else {
        return super::intent_compound::expand(tables, synthesized, requests, read);
    };
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
        if lane.keys.len() + lane.order_keys.len() > 8
            || !candidate.branch_index_fits(&tables[&read.table], &lane) { return None; }
        lanes.push(MergeLane { admission: read.filter.clone(), nulls: None, distinct: None, branch: Some(if grant { GRANT_LANE } else { BRANCH_LANE }.into()),
            planned: Some(Box::new(lane)), project: None, table: None, prefix: Vec::new(), columns: None, loop_: None, site: read.site.clone() });
    }
    if candidate.error_count() != errors { return None; }
    *requests = candidate;
    Some(MergeExpr { view_order: Vec::new(), table: read.table.clone(), matching: None, filter: None, index: String::new(), order: range.order, take: range.take,
        cursor: range.cursor.clone(), lanes, site: read.site.clone() })
}

/// An exact positive where witness that is itself a whole read-rule disjunct
/// restricts W to that audience. Enumerate it directly; other audiences cannot
/// contribute rows to W, including the system's rule bypass.
// @ref LLP 3000.036.001#17 — author-scoped pages retain their exact witness.
fn scoped_membership(tables: &Tables, synthesized: &std::collections::BTreeSet<(String, String)>, requests: &mut Requests, read: &ReadExpr) -> Option<MergeExpr> {
    let table = tables.get(&read.table)?;
    let rule = read_rule(table)?;
    let mut leaves = Vec::new(); disjuncts(rule, &mut leaves);
    let mut predicates = Vec::new(); intent::split(*read.filter.clone()?, &mut predicates);
    for (at, predicate) in predicates.iter().enumerate() {
        if !matches!(predicate, Expr::Exists { .. }) || !leaves.iter().any(|leaf|
            crate::print::expression(leaf) == crate::print::expression(predicate)) { continue; }
        let rest: Vec<_> = predicates.iter().enumerate().filter(|(n, _)| *n != at).map(|(_, p)| p.clone()).collect();
        if !rest.iter().all(total) { continue; }
        let mut narrowed = read.clone(); narrowed.filter = intent::conjunction(rest);
        let mut local = tables.clone();
        local.get_mut(&read.table)?.decl.rules.iter_mut().find(|rule| rule.effect == Effect::Read)?.value = predicate.clone();
        let mut candidate = requests.clone();
        let mut merge = membership(&local, synthesized, &mut candidate, &narrowed)?;
        // The system bypasses R, never W. Its whole-range descriptor retains
        // the authored witness, and also binds all static target pins into
        // the shared cursor scope. Other callers use exact discovery only.
        for lane in &mut merge.lanes {
            if lane.branch.as_deref() == Some(SYSTEM_LANE) {
                let planned = lane.planned.as_mut()?;
                let mut residual = planned.filter.take().map(|p| vec![*p]).unwrap_or_default();
                residual.push(predicate.clone()); planned.filter = intent::conjunction(residual);
            }
            lane.admission = read.filter.clone();
        }
        *requests = candidate;
        return Some(merge);
    }
    None
}

// @ref LLP 3000.036.001#14 — enumerate the decided membership source before merging its parent ranges.
pub(super) fn membership(tables: &Tables, synthesized: &std::collections::BTreeSet<(String, String)>, requests: &mut Requests, read: &ReadExpr) -> Option<MergeExpr> {
    let range = read.range.as_ref()?;
    let table = tables.get(&read.table)?;
    if read.index.is_some() || !read.keys.is_empty() || read.matching.is_some() || !read.computed.is_empty() || read.cursor_prefix.is_some() { return None; }
    if table.maintained.is_some() || table.through.is_some() || table.decl.ephemeral.is_some() || !table.captures.is_empty() || table.decl.public.is_some() { return None; }
    if read.filter.as_deref().is_some_and(|filter| !total(filter)) { return None; }
    let mut probe = requests.clone();
    let mut planned = read.clone();
    probe.read(tables, &mut planned, false);
    if decided(tables, &planned) { return None; }
    let mut disjunct_list = Vec::new(); disjuncts(read_rule(table)?, &mut disjunct_list);
    let (mut parties, mut memberships) = (Vec::new(), Vec::new());
    for disjunct in disjunct_list {
        if let Some(column) = party(table, &disjunct) { if !parties.contains(&column) { parties.push(column); } }
        else if matches!(disjunct, Expr::Exists { .. }) { memberships.push(disjunct); }
        else { return None; }
    }
    if memberships.is_empty() { return None; }
    let conjuncts = read.filter.as_ref().map(|filter| { let mut out = Vec::new(); intent::split(*filter.clone(), &mut out); out }).unwrap_or_default();
    let base = where_branches(table, &conjuncts).unwrap_or_else(|| vec![conjuncts.clone()]);
    // These are structural PAGE exclusions, not late core fallbacks: decline
    // before the candidate can retain party/source indexes the original scan
    // does not use.
    let membership_targets: Vec<String> = memberships.iter().map(membership_target).collect::<Option<_>>()?;
    if membership_targets.iter().any(|target| base.iter().any(|branch|
        branch.iter().filter_map(|predicate| intent::equality(predicate, table)).any(|(column, _)| column == *target))) { return None; }
    let descriptor_count = 1usize.saturating_add(base.len().saturating_mul(parties.len().saturating_add(memberships.len())));
    if descriptor_count > MAX_BRANCHES { return None; }
    let mut candidate = requests.clone();
    let errors = candidate.error_count();
    let mut lanes = Vec::with_capacity(descriptor_count);
    let mut cap_repairs = Vec::new();
    let mut order = None;
    let mut system = read.clone(); candidate.read(tables, &mut system, false);
    push_membership_lane(&candidate, table, &mut lanes, &mut order, system, SYSTEM_LANE, None, None, read.filter.clone())?;
    for branch in &base {
        for column in &parties {
            let mut lane = read.clone();
            let mut predicates = vec![viewer_pin(column, &read.site)]; predicates.extend(branch.iter().cloned());
            lane.filter = intent::conjunction(predicates); candidate.plan_lane(tables, &mut lane);
            if !decided(tables, &lane) { return None; }
            push_membership_lane(&candidate, table, &mut lanes, &mut order, lane, BRANCH_LANE, None, None, read.filter.clone())?;
        }
        for predicate in &memberships {
            let mut source_read = read.clone();
            let mut predicates = branch.clone(); predicates.push(predicate.clone()); source_read.filter = intent::conjunction(predicates);
            let mut merge = super::intent_lanes::expand(tables, synthesized, &source_read)?;
            let mut lane = merge.lanes.pop()?;
            candidate.plan_lane(tables, lane.planned.as_mut()?);
            let (_, source) = lane.loop_.as_mut()?;
            let Expr::Read(source) = source else { return None };
            let source_table = tables.get(&source.table)?;
            let source_column = membership_source_column(tables, synthesized, table, predicate)?;
            let mut source_candidate = candidate.clone();
            source_candidate.read(tables, source, false);
            // A fully pinned total unique returns at most one source row, so
            // its row may project any membership parent without ordering the
            // discovery scan by that field. Extra fixed probe equalities stay
            // as exact residuals on that one row. Discard the provisional
            // inferred index when the authored point supplies this proof.
            let one_row = source_table.indexes.iter().filter(|index| source_table.total_unique(index)
                && index.columns.iter().all(|column| source.keys.iter().any(|key| key.column.as_ref() == Some(column)))
                && one_row_source_admitted(source_table, source, index))
                .min_by_key(|index| (index.columns.len(), &index.name))
                .map(|index| (index.name.clone(), index.columns.clone()));
            if let Some((name, columns)) = one_row {
                let mut keys = std::mem::take(&mut source.keys);
                let mut point = Vec::with_capacity(columns.len());
                for column in &columns {
                    let at = keys.iter().position(|key| key.column.as_ref() == Some(column))?;
                    point.push(keys.remove(at));
                }
                let mut residuals = keys.into_iter().map(source_key_equality).collect::<Option<Vec<_>>>()?;
                if let Some(filter) = source.filter.take() { residuals.push(*filter); }
                // A filtered scan needs one lookahead slot to distinguish its
                // single accepted row from an unfinished filtered page. The
                // total unique still proves that at most one row is examined.
                if !residuals.is_empty() {
                    source.range = Some(RangeSpec { order: Order::Asc, take: 2, cursor: None, site: source.site.clone() });
                }
                source.keys = point; source.filter = intent::conjunction(residuals);
                source.order_keys = vec!["id".into()]; source.index = Some(name);
            } else { candidate = source_candidate; }
            let source_index = candidate.branch_index(source_table, source)?;
            let next_component = source.keys.len() < source_index.columns.len()
                && source_index.columns.get(source.keys.len()) == Some(&source_column);
            let one_row = source.keys.len() == source_index.columns.len() && source_table.total_unique(source_index);
            if !next_component && !one_row { return None; }
            // Uniform denial is not an empty discovery range. PAGE may commit
            // its speculative indexes only when the fixed source pins prove
            // a true read-rule disjunct, matching the core validator.
            let admitted = one_row || membership_probe_total_unique(tables, synthesized, table, predicate)
                || membership_source_capped(tables, source);
            if !membership_source_witness(tables, synthesized, table, predicate, source)
                || !source_read_admitted(source_table, source)
                || candidate.branch_index_width(source_table, source).is_none_or(|width| width > 8)
                || !candidate.branch_index_fits(source_table, source) { return None; }
            if !admitted {
                cap_repairs.push((source.table.clone(), membership_cap_repair(source_table, source, source_index)?));
            }
            push_membership_lane(&candidate, table, &mut lanes, &mut order, *lane.planned.take()?, MEMBERSHIP_LANE,
                lane.loop_.take(), lane.distinct.take(), lane.admission.take())?;
        }
    }
    if candidate.error_count() != errors { return None; }
    if !cap_repairs.is_empty() {
        cap_repairs.sort(); cap_repairs.dedup();
        let declarations = cap_repairs.iter().map(|(table, declaration)| format!("`{declaration}` on table {table}")).collect::<Vec<_>>().join(" and ");
        requests.cap_repairs.insert(read.site.to_string(), format!("add {declarations}; this is a hard stored-row limit that can refuse adoption or later writes once the group is full, so add it only when it is a real product enrollment limit"));
        return None;
    }
    *requests = candidate;
    Some(MergeExpr { view_order: Vec::new(), table: read.table.clone(), matching: None, filter: None, index: String::new(), order: range.order, take: range.take,
        cursor: range.cursor.clone(), lanes, site: read.site.clone() })
}

fn pinned_memberships(tables: &Tables, synthesized: &std::collections::BTreeSet<(String,String)>, read: &ReadExpr) -> bool {
    let Some(table) = tables.get(&read.table) else { return false };
    let Some(rule) = read_rule(table) else { return false };
    let mut conjuncts=Vec::new(); if let Some(filter)=&read.filter {intent::split(*filter.clone(),&mut conjuncts);}
    let pins: Vec<_> = conjuncts.iter().filter_map(|term| intent::equality(term,table))
        .filter(|(column,_)| !read.order_keys.contains(column)).map(|(column,_)|column).collect();
    let mut leaves=Vec::new();disjuncts(rule,&mut leaves);
    let members:Vec<_>=leaves.iter().filter(|leaf|membership_probe_point(tables,synthesized,table,leaf)).collect();
    !members.is_empty() && members.iter().all(|leaf| membership_target(leaf).is_some_and(|target|pins.contains(&target)))
}

fn source_key_equality(key: KeyPart) -> Option<Expr> {
    let column = key.column?;
    let site = key.site;
    Some(Expr::Binary { op: "=".into(), left: Box::new(Expr::Member {
        base: Box::new(Expr::Focal { site: site.clone() }), name: column, site: site.clone(),
    }), right: Box::new(key.value), site })
}

fn one_row_source_admitted(table: &TableInfo, source: &ReadExpr, index: &IndexDecl) -> bool {
    let mut point = source.clone();
    point.keys.retain(|key| key.column.as_ref().is_some_and(|column| index.columns.contains(column)));
    source_read_admitted(table, &point)
}

fn source_read_admitted(table: &TableInfo, source: &ReadExpr) -> bool {
    table.decl.public.is_some() || read_rule(table).is_some_and(|rule| by_form(rule, source))
}

/// Confirm, while requests still live in the throwaway candidate, that every
/// fixed probe component survived source planning as either a prefix pin or
/// an exact necessary residual equality. The core repeats this check on bound
/// IR; keeping it here prevents a later fallback from retaining unused indexes.
// @ref LLP 3000.036.001#14 — membership candidates commit only after their complete witness is visible in discovery.
fn membership_source_witness(tables: &Tables, synthesized: &std::collections::BTreeSet<(String, String)>,
    focal: &TableInfo, predicate: &Expr, source: &ReadExpr) -> bool {
    let Expr::Exists { read: probe, .. } = predicate else { return false };
    let Some(columns) = super::intent_lanes::probe_columns(tables, synthesized, focal, probe) else { return false };
    probe.keys.iter().zip(columns).all(|(key, column)| intent::column(&key.value).is_some()
        || source_fixed(source, &column, &key.value))
}

fn source_fixed(source: &ReadExpr, column: &str, value: &Expr) -> bool {
    source.keys.iter().any(|key| key.column.as_deref() == Some(column) && same_fixed(&key.value, value))
        || source.filter.as_deref().is_some_and(|filter| required_source_equality(filter, column, value))
}

fn required_source_equality(filter: &Expr, column: &str, value: &Expr) -> bool {
    match filter {
        Expr::Binary { op, left, right, .. } if op == "and" =>
            required_source_equality(left, column, value) || required_source_equality(right, column, value),
        Expr::Binary { op, left, right, .. } if op == "=" && intent::column(left) == Some(column) => same_fixed(right, value),
        Expr::Binary { op, left, right, .. } if op == "=" && intent::column(right) == Some(column) => same_fixed(left, value),
        _ => false,
    }
}

fn same_fixed(left: &Expr, right: &Expr) -> bool {
    match (left, right) {
        (Expr::Name { name: a, .. }, Expr::Name { name: b, .. }) => a == b,
        (Expr::Literal { value: a, .. }, Expr::Literal { value: b, .. }) => a == b,
        (Expr::Unary { op: a, value: av, .. }, Expr::Unary { op: b, value: bv, .. }) => a == b && same_fixed(av, bv),
        _ => false,
    }
}

pub(super) fn push_membership_lane(candidate: &Requests, table: &TableInfo, lanes: &mut Vec<MergeLane>, order: &mut Option<Vec<String>>, lane: ReadExpr,
    branch: &str, loop_: Option<(String, Expr)>, distinct: Option<Expr>, admission: Option<Box<Expr>>) -> Option<()> {
    if order.get_or_insert_with(|| lane.order_keys.clone()) != &lane.order_keys || lane.index.is_none() { return None; }
    if lane.keys.len() + lane.order_keys.len() > 8 || !candidate.branch_index_fits(table, &lane) { return None; }
    lanes.push(MergeLane { admission, nulls: None, distinct, branch: Some(branch.into()), planned: Some(Box::new(lane)), project: None,
        table: None, prefix: Vec::new(), columns: None, loop_, site: table.decl.site.clone() }); Some(())
}

fn membership_source_capped(tables: &Tables, source: &ReadExpr) -> bool {
    let Some(table) = tables.get(&source.table) else { return false };
    let pinned: Vec<&str> = source.keys.iter().filter_map(|key| key.column.as_deref()).collect();
    table.decl.caps.iter().any(|cap| cap.by.iter().all(|column| pinned.contains(&column.as_str()))
        && !cap.by.iter().any(|column| table.decl.columns.iter().any(|field| &field.name == column
            && field.on_delete.as_ref().is_some_and(|(action, _)| action == &OnDelete::SetNull))))
}

fn membership_cap_repair(table: &TableInfo, source: &ReadExpr, index: &IndexDecl) -> Option<String> {
    let fixed = index.columns.iter().zip(&source.keys).filter_map(|(column, key)| {
        let non_null = matches!(&key.value, Expr::Name { name, .. } if name == "viewer")
            || matches!(&key.value, Expr::Literal { value, .. } if !matches!(value, Literal::Null))
            || matches!(&key.value, Expr::Unary { op, value, .. } if op == "-" && matches!(value.as_ref(), Expr::Literal { value: Literal::Number(_), .. }));
        (column != "id" && non_null && table.columns.get(column).is_some_and(|kind| !kind.optional)).then_some(column.clone())
    }).collect::<Vec<_>>();
    Some(if fixed.is_empty() { "cap 50".into() } else { format!("cap 50 by {}", fixed.join(", ")) })
}

/// The original rule probe's selected point is total. This proves one witness
/// for an outer row, not a bound on the inverted discovery population; §15's
/// all-or-nothing meter cut supplies that safety.
// @ref LLP 3000.036.001#15 — exact total membership points admit metered discovery without pretending to cap a viewer's memberships.
fn membership_probe_total_unique(tables: &Tables, synthesized: &std::collections::BTreeSet<(String, String)>,
    focal: &TableInfo, predicate: &Expr) -> bool {
    let Expr::Exists { read, .. } = predicate else { return false };
    let Some(table) = tables.get(&read.table) else { return false };
    let Some(columns) = super::intent_lanes::probe_columns(tables, synthesized, focal, read) else { return false };
    let named = read.keys.iter().all(|key| key.column.is_some());
    table.indexes.iter().filter(|index| table.total_unique(index))
        .filter(|index| read.index.as_ref().is_none_or(|name| name == &index.name))
        .any(|index| if named {
            index.columns.iter().all(|column| columns.contains(column))
        } else {
            index.columns == columns
        })
}

fn membership_target(predicate: &Expr) -> Option<String> {
    let Expr::Exists { read, .. } = predicate else { return None };
    let mut target = None;
    for key in &read.keys {
        if let Some(column) = intent::column(&key.value) {
            if target.replace(column.to_owned()).is_some() { return None; }
        } else if !intent::independent(&key.value) { return None; }
    }
    target
}

fn membership_source_column(tables: &Tables, synthesized: &std::collections::BTreeSet<(String, String)>,
    focal: &TableInfo, predicate: &Expr) -> Option<String> {
    let Expr::Exists { read: probe, .. } = predicate else { return None };
    let columns = super::intent_lanes::probe_columns(tables, synthesized, focal, probe)?;
    probe.keys.iter().zip(columns).find_map(|(key, column)| intent::column(&key.value).map(|_| column))
}

fn owner_membership_shape(tables: &Tables, synthesized: &std::collections::BTreeSet<(String, String)>, read: &ReadExpr) -> bool {
    let Some(table) = tables.get(&read.table) else { return false };
    let Some(rule) = read_rule(table) else { return false };
    let mut leaves = Vec::new(); disjuncts(rule, &mut leaves);
    let party = leaves.iter().any(|leaf| self::party(table, leaf).is_some());
    let membership = leaves.iter().any(|leaf| membership_probe_point(tables, synthesized, table, leaf));
    party && membership && leaves.iter().all(|leaf| self::party(table, leaf).is_some() || membership_probe_point(tables, synthesized, table, leaf))
}

fn membership_probe_point(tables: &Tables, synthesized: &std::collections::BTreeSet<(String, String)>, focal: &TableInfo, predicate: &Expr) -> bool {
    let Expr::Exists { read, .. } = predicate else { return false };
    // PAGE reserves only an exact point with one target-row component. A
    // fully fixed probe is an ordinary static grant and remains eligible for
    // the older branch merge.
    if membership_target(predicate).is_none() { return false; }
    let Some(table) = tables.get(&read.table) else { return false };
    let Some(columns) = super::intent_lanes::probe_columns(tables, synthesized, focal, read) else { return false };
    let named = read.keys.iter().all(|key| key.column.is_some());
    // A byId parent-owner probe remains an ordinary page guard when the
    // outer id/reference is already pinned. Reserve the composite membership
    // points whose inverted discovery belongs to PAGE.
    table.indexes.iter().filter(|index| index.unique && index.is_plain() && index.columns != ["id"])
        .filter(|index| read.index.as_ref().is_none_or(|name| name == &index.name))
        .any(|index| if named { index.columns.iter().all(|column| columns.contains(column)) } else { index.columns == columns })
}

/// `exists t where W` with `W` branch-decided: `exists (branch 1) or …`, each
/// a decided existence read, so the answer is `true` or `false`. A rule with a
/// grant keeps its single read (a grant-guarded existence lane is not planned).
// @ref LLP 3000.036.001#8 — exists over the same shapes, without grants.
pub(super) fn exists(tables: &Tables, requests: &mut Requests, read: &ReadExpr, site: &Site) -> Option<Expr> {
    if read.range.is_some() { return None; }
    let branches = branches(tables, &Default::default(), requests, read, false)?;
    let mut candidate = requests.clone();
    let errors = candidate.error_count();
    let mut reads = Vec::with_capacity(branches.len());
    for (conjuncts, _) in branches {
        let mut lane = read.clone();
        lane.filter = intent::conjunction(conjuncts);
        candidate.read(tables, &mut lane, false);
        if !decided(tables, &lane) || !candidate.branch_index_fits(&tables[&read.table], &lane) { return None; }
        reads.push(Expr::Exists { read: lane, site: site.clone() });
    }
    if candidate.error_count() != errors { return None; }
    *requests = candidate;
    reads.into_iter().reduce(|left, right| Expr::Binary { op: "or".into(), site: site.clone(), left: Box::new(left), right: Box::new(right) })
}

/// The branches of an undecided read, or `None` when the rule does not apply.
fn branches(tables: &Tables, synthesized: &std::collections::BTreeSet<(String, String)>, requests: &Requests, read: &ReadExpr, grants: bool) -> Option<Vec<Branch>> {
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
    if read.filter.as_deref().is_some_and(|filter| !super::intent_compound::total_readable(tables, synthesized, table, filter)) { return None; }
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
pub(super) fn by_form(rule: &Expr, planned: &ReadExpr) -> bool {
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

pub(super) fn read_rule(table: &TableInfo) -> Option<&Expr> {
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
pub(super) fn columns_within(value: &Expr, pinned: &[String]) -> bool {
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
pub(super) fn total(value: &Expr) -> bool {
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
