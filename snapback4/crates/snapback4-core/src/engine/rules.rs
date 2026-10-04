//! Rule evaluation and the static facts about it that the engine hoists: a
//! rule that is proven true by the scanned prefix (`decided_true`) costs no
//! probes; a rule whose deciding fields are pinned by the prefix (`uniform`) is
//! decided once for the whole range. Copied from Snapback 2's uniformity
//! analysis (LLP 2000.000 §5.1); the certificate that priced these is gone,
//! the analysis is not.

use crate::ir::{Expr, IndexKeyExpr, Input, Merge, Scan};
use crate::schema::{ColumnType, RuleExpr, RuleTerm, Schema, Table};
use crate::value::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Visibility {
    /// One verdict serves every row of the scanned prefix.
    pub uniform: bool,
    /// That verdict is `true` before any row is read.
    pub decided_true: bool,
}

pub fn scan_visibility(schema: &Schema, scan: &Scan) -> Visibility {
    let Some(table) = schema.table(&scan.table) else { return Visibility::default() };
    let Some(index) = table.index(&scan.index) else { return Visibility::default() };
    let pinned = |name: &str| index.components.iter().zip(&scan.prefix).find_map(|(part, key)| (part.column().is_some_and(|column| column == name)).then(|| key.scalar()).flatten());
    visibility(&scan.table, table, &table.rules.read, &pinned)

}

// @ref LLP 3000.007#20.5 — a missing upsert may insert only when the complete held group and its key decide that no hidden target can exist.
pub fn upsert_absence(schema: &Schema, name: &str, index: &str, key: &[Expr]) -> Result<Visibility, &'static str> {
    let table = schema.table(name).ok_or("the target is online only")?;
    let sync = table.sync.as_ref().ok_or("the target is online only")?;
    if sync.horizon.is_some() { return Err("the target has a horizon"); }
    let rule = table.rules.read.device_audience_rule();
    // Public subset sync has no whole-table absence proof. Its group coverage
    // is a separate decision; do not infer it merely from the public read rule.
    if rule.is_uniformly_readable() && sync.audience != crate::schema::Audience::Public { return Err("the key's synced group is not established"); }
    let index = table.index(index).ok_or("the key does not pin readability")?;
    let pinned = crate::small_map::collect(index.components.iter().zip(key).filter_map(|(part, expression)| part.column().map(|column| (column, expression))));
    let visibility = prefix_visibility(name, table, &rule, &pinned);
    if !visibility.uniform { return Err("the key does not pin readability"); }
    Ok(visibility)
}

// @ref LLP 3000.007#18.1 — simplify self-witnesses, then pre-check only the leading conjuncts whose fields the scope pins, in evaluation order.
pub(super) fn prefix_decision(schema: &Schema, scan: &Scan) -> Option<RuleExpr> {
    let table = schema.table(&scan.table)?;
    let index = table.index(&scan.index)?;
    let pinned: BTreeMap<_,_> = crate::small_map::collect(index.components.iter().zip(&scan.prefix).filter_map(|(part, key)| part.column().zip(key.scalar())));
    if table.through.as_ref().is_some_and(|t| pinned.contains_key(&t.reference)) { return Some(table.rules.read.clone()); }
    let rule = simplify_prefix(&table.rules.read, &scan.table, table, &pinned);
    if matches!(rule, RuleExpr::Allow) { return None; }
    let mut terms = Vec::new();
    conjuncts(rule, &mut terms);
    let decided: Vec<_> = terms.into_iter().take_while(|term| {
        let mut fields = BTreeSet::new();
        term.fields(&mut fields);
        fields.iter().all(|field| pinned.contains_key(field))
    }).collect();
    (!decided.is_empty()).then_some(RuleExpr::And(decided))
}

// Flatten only conjunctions, preserving left-to-right short-circuit order.
fn conjuncts(rule: RuleExpr, out: &mut Vec<RuleExpr>) {
    match rule { RuleExpr::And(terms) => for term in terms { conjuncts(term, out); }, rule => out.push(rule) }
}

fn simplify_prefix(rule: &RuleExpr, name: &str, table: &Table, pinned: &BTreeMap<&String, &Expr>) -> RuleExpr {
    if rule_true(rule, name, table, &|name| pinned.iter().find_map(|(key, value)| (key.as_str() == name).then_some(*value))) { return RuleExpr::Allow; }
    match rule {
        RuleExpr::And(terms) => {
            let mut out = Vec::new();
            for term in terms { conjuncts(simplify_prefix(term, name, table, pinned), &mut out); }
            out.retain(|term| !matches!(term, RuleExpr::Allow));
            RuleExpr::And(out)
        },
        RuleExpr::Or(_) => {
            // Use the same self-witness absorption as uniformity, but remove
            // the absorbed field read from the expression we actually run.
            let terms = rule.disjuncts();
            RuleExpr::Or(terms.iter().filter(|term| !terms.iter().any(|other| self_probe_absorbs(name, table, term, other))).map(|term| simplify_prefix(term, name, table, pinned)).collect())
        }
        RuleExpr::Not(inner) => RuleExpr::Not(Box::new(simplify_prefix(inner, name, table, pinned))),
        _ => rule.clone(),
    }
}

/// Lazy lanes need a position that identifies one row within the lane.
/// Keep setup evaluation and non-uniform traversal in their original order.
pub fn lazy_merge(schema: &Schema, merge: &Merge) -> bool {
    let Some(first) = merge.lanes.first() else { return true };
    merge.lanes.iter().all(|lane| {
        let scan = &lane.scan;
        lane.project.is_none() && lane.setup.is_empty() && scan.table == first.scan.table && scan.index == first.scan.index
            && scan.prefix.iter().enumerate().all(|(position, key)| matches!(key, IndexKeyExpr::Scalar(_)) || position + 1 == scan.prefix.len())
            && scan.order == first.scan.order && scan.prefix.len() == first.scan.prefix.len()
            && scan_visibility(schema, scan).uniform
            && schema.table(&scan.table).is_some_and(|table| table.index(&scan.index).is_some_and(|index| {
                // Nullable unique keys allow multiple nulls; they are not a
                // position from which a one-row refill can safely resume.
                let total_unique = index.unique && index.components.iter().all(|component| component.key_type(table).is_some_and(|kind| !kind.is_optional()));
                scan.prefix.len() < index.components.len() && (total_unique || index.columns().last().is_some_and(|c| c == "id"))
            }))
    })
}

/// The same analysis for an arbitrary pinned prefix (`sync` audiences and
/// merge lanes use it too).
pub fn prefix_visibility(table_name: &str, table: &Table, rule: &RuleExpr, pinned: &BTreeMap<&String, &Expr>) -> Visibility {
    visibility(table_name, table, rule, &|name| pinned.iter().find_map(|(key, value)| (key.as_str() == name).then_some(*value)))
}

// @ref LLP 3000.007#20.24 — visibility borrows compiled rule/scan images; word lanes allocate no analysis maps or field sets.
fn visibility<'a>(name: &str, table: &Table, rule: &RuleExpr, pinned: &impl Fn(&str) -> Option<&'a Expr>) -> Visibility {
    if table.through.as_ref().is_some_and(|t| pinned(&t.reference).is_some()) { return Visibility {uniform:true,decided_true:false}; }
    let decided_true = rule_true(rule, name, table, pinned);
    Visibility { uniform: decided_true || fields_pinned(name, table, rule, pinned), decided_true }
}
fn any_disjunct(rule: &RuleExpr, test: &impl Fn(&RuleExpr) -> bool) -> bool {
    match rule { RuleExpr::Or(terms) => terms.iter().any(|term| any_disjunct(term, test)), other => test(other) }
}
fn all_disjunct(rule: &RuleExpr, test: &impl Fn(&RuleExpr) -> bool) -> bool {
    match rule { RuleExpr::Or(terms) => terms.iter().all(|term| all_disjunct(term, test)), other => test(other) }
}
fn fields_pinned<'a>(name: &str, table: &Table, rule: &RuleExpr, pinned: &impl Fn(&str) -> Option<&'a Expr>) -> bool {
    let term = |term: &RuleTerm| !matches!(term, RuleTerm::Field(field) | RuleTerm::Reference { column: field, .. } if pinned(field).is_none());
    match rule {
        RuleExpr::Or(_) => all_disjunct(rule, &|part| any_disjunct(rule, &|other| self_probe_absorbs(name, table, part, other)) || fields_pinned(name, table, part, pinned)),
        RuleExpr::And(terms) => terms.iter().all(|part| fields_pinned(name, table, part, pinned)),
        RuleExpr::Not(inner) => fields_pinned(name, table, inner, pinned),
        RuleExpr::Eq(a, b) | RuleExpr::Ne(a, b) | RuleExpr::Compare(_,a,b) => term(a) && term(b),
        RuleExpr::Exists { key, equalities, .. } | RuleExpr::Created { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_, term)| term)).all(term),
        RuleExpr::Allow | RuleExpr::Deny | RuleExpr::Public { .. } => true,
    }
}

/// Fields that decide a rule after absorbing same-row equalities into
/// self-probes in each `or`. Shared by runtime hoisting and compiler notes.
pub fn deciding_fields(table_name: &str, table: &Table, rule: &RuleExpr) -> BTreeSet<String> {
    if let Some(t) = &table.through { return BTreeSet::from([t.reference.clone()]); }
    let mut used = BTreeSet::new();
    match rule {
        RuleExpr::Or(_) => {
            let disjuncts = rule.disjuncts();
            for disjunct in &disjuncts {
                if !disjuncts.iter().any(|other| self_probe_absorbs(table_name, table, disjunct, other)) {
                    used.extend(deciding_fields(table_name, table, disjunct));
                }
            }
        }
        RuleExpr::And(terms) => terms.iter().for_each(|term| used.extend(deciding_fields(table_name, table, term))),
        RuleExpr::Not(inner) => used.extend(deciding_fields(table_name, table, inner)),
        _ => rule.fields(&mut used),
    }
    used
}

fn self_probe_absorbs(table_name: &str, table: &Table, disjunct: &RuleExpr, other: &RuleExpr) -> bool {
    let column = match disjunct {
        RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) => column,
        _ => return false,
    };
    let RuleExpr::Exists { table: target, index, key, equalities, .. } = other else { return false };
    if target != table_name { return false; }
    let Some(index) = table.index(index) else { return false };
    // @ref LLP 3000.007#16 — the equal row is its own witness on a total unique key; literal key terms cannot absorb it.
    index.unique && index.is_plain() && key.len() == index.components.len()
        && equalities.iter().all(|(field, term)| matches!(term, RuleTerm::Field(source) if source == field) || (field == column && matches!(term, RuleTerm::Viewer)))
        && index.components.iter().any(|part| part.column() == Some(column))
        && index.components.iter().filter_map(|part| part.column()).zip(key).all(|(component, term)| {
            table.columns.get(component).is_some_and(|kind| !kind.is_optional())
                && if component == column { matches!(term, RuleTerm::Viewer) } else { matches!(term, RuleTerm::Field(field) if field == component) }
        })
}

fn pinned_term(term: &RuleTerm, expression: &Expr) -> bool {
    match (term, expression) {
        (RuleTerm::Viewer, Expr::Input(Input::Viewer)) => true,
        (RuleTerm::Literal(left), Expr::Literal(right)) => left == right,
        _ => false,
    }
}

fn rule_true<'a>(rule: &RuleExpr, table_name: &str, table: &Table, pinned: &impl Fn(&str) -> Option<&'a Expr>) -> bool {
    match rule {
        RuleExpr::Allow | RuleExpr::Public { .. } => true,
        RuleExpr::Eq(left, right) => [(left, right), (right, left)].iter().any(|(field, value)| {
            let RuleTerm::Field(column) = field else { return false };
            pinned(column).is_some_and(|expression| pinned_term(value, expression))
        }),
        RuleExpr::Or(rules) => rules.iter().any(|rule| rule_true(rule, table_name, table, pinned)),
        RuleExpr::And(rules) => !rules.is_empty() && rules.iter().all(|rule| rule_true(rule, table_name, table, pinned)),
        RuleExpr::Exists { table: target, index, key, equalities, .. } if target == table_name => {
            // A self-probe on a total unique key whose every component is
            // either the row's own column or pinned to the probing value is
            // true for every row the prefix selects.
            let Some(index) = table.index(index) else { return false };
            // Extra tests must be true on the self-witness too; a unique key alone cannot decide them.
            equalities.iter().all(|(column, term)| match term {
                RuleTerm::Field(field) => field == column,
                _ => pinned(column).is_some_and(|expression| pinned_term(term, expression)),
            }) && index.unique
                && index.is_plain()
                && !key.is_empty()
                && key.len() == index.components.len()
                && index.components.iter().filter_map(|part| part.column()).zip(key).all(|(column, term)| {
                    table.columns.get(column).is_some_and(|ty| !matches!(ty, ColumnType::Optional(_)))
                        && match term {
                            RuleTerm::Field(field) => field == column,
                            _ => pinned(column).is_some_and(|expression| pinned_term(term, expression)),
                        }
                })
        }
        _ => false,
    }
}

/// The prefix expressions of a scan as `IndexKeyExpr`s, for callers that
/// pin values rather than expressions.
pub fn pinned_literals(prefix: &[Value]) -> Vec<IndexKeyExpr> {
    prefix.iter().map(|value| IndexKeyExpr::Scalar(Expr::Literal(value.clone()))).collect()
}

/// Something that can answer an `exists`/`created` probe while a rule runs.
pub trait Probe {
    fn reference(&mut self, _table: &str, _id: &Value, _field: &str) -> Result<Option<Value>, crate::error::RuntimeError> { Ok(None) }
    /// Exact count-predicate transitions, distinct from ordinary witness expiry.
    fn take_changes(&mut self) -> Option<Vec<(i64, super::rules::Verdict)>> { None }
    /// Exchange the private expiry accumulator; ordinary probes have none.
    fn replace_expiry(&mut self, _expiry: Option<i64>) -> Option<i64> { None }
    /// Coverage of the most recent leaf, consumed once by the shared evaluator.
    fn take_unknown(&mut self) -> bool { false }
    /// Called only when evaluation loads a field, after short-circuit decisions.
    fn field(&mut self, _field: &str, _old: bool) {}
    /// Apply the schema's point-key null rule before storage access. Timeline
    /// evaluation can visit operands that logical short-circuiting would skip.
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, crate::error::RuntimeError>;
    fn created(&mut self, table: &str, index: &str, key: &[Value]) -> bool;
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Verdict { Readable, Denied, #[default] Unknown }

impl Verdict {
    fn not(self) -> Self {
        match self { Self::Readable => Self::Denied, Self::Denied => Self::Readable, Self::Unknown => Self::Unknown }
    }
    fn combine(self, other: Self, conjunction: bool) -> Self {
        let decisive = if conjunction { Self::Denied } else { Self::Readable };
        if self == decisive || other == decisive { decisive }
        else if self == Self::Unknown || other == Self::Unknown { Self::Unknown }
        else { decisive.not() }
    }
}

/// Evaluate a rule over a row image (and its old image, for update rules).
pub fn evaluate(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, created_allowed: bool, probe: &mut dyn Probe) -> Result<bool, crate::error::RuntimeError> {
    evaluate_verdict(rule, viewer, old, next, created_allowed, probe).map(|verdict| verdict == Verdict::Readable)
}

pub(super) fn evaluate_verdict(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, created_allowed: bool, probe: &mut dyn Probe) -> Result<Verdict, crate::error::RuntimeError> {
    let prior = probe.replace_expiry(None);
    let result = timeline(rule, viewer, old, next, created_allowed, probe);
    probe.replace_expiry(match &result {
        Ok(answer) if answer.value == Verdict::Readable => earliest(prior, answer.changes.first().map(|(time, _)| *time)),
        _ => prior,
    });
    result.map(|answer| answer.value)
}

pub(super) fn earliest(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) { (Some(a), Some(b)) => Some(a.min(b)), (a, b) => a.or(b) }
}

struct Timeline {
    value: Verdict,
    changes: Vec<(i64, Verdict)>,
    // Proven from rule structure and verdicts, never from witness deadlines.
    invariant: bool,
}
impl Timeline {
    fn constant(value: Verdict) -> Self { Self { value, changes: Vec::new(), invariant: true } }
    fn combine(self, other: Self, conjunction: bool) -> Self {
        let (mut left, mut right) = (self.value, other.value);
        let mut result = Self::constant(left.combine(right, conjunction));
        let decisive = if conjunction { Verdict::Denied } else { Verdict::Readable };
        result.invariant = (self.invariant && left == decisive)
            || (other.invariant && right == decisive) || (self.invariant && other.invariant);
        let (mut a, mut b) = (self.changes.as_slice(), other.changes.as_slice());
        let mut previous = result.value;
        while let Some(time) = earliest(a.first().map(|(t, _)| *t), b.first().map(|(t, _)| *t)) {
            // All rows expiring at the same instant disappear together. This
            // preserves correlations, including A or not A and A and not A.
            if let Some((head, tail)) = a.split_first() && head.0 == time { left = head.1; a = tail; }
            if let Some((head, tail)) = b.split_first() && head.0 == time { right = head.1; b = tail; }
            let value = left.combine(right, conjunction);
            if value != previous { result.changes.push((time, value)); previous = value; }
        }
        result
    }
}

// @ref LLP 3000.015#2 — next_expiry is the first expiry boundary that changes
// the complete bound rule's verdict, not a branch or first witness lifetime.
// Leaves prove their timeline within the original shared allowance. Combining
// those timelines performs no further storage reads.
fn timeline(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, created_allowed: bool, probe: &mut dyn Probe) -> Result<Timeline, crate::error::RuntimeError> {
    match rule {
        RuleExpr::And(terms) | RuleExpr::Or(terms) => {
            let conjunction = matches!(rule, RuleExpr::And(_));
            let decisive = if conjunction { Verdict::Denied } else { Verdict::Readable };
            let mut answer = Timeline::constant(decisive.not());
            for term in terms {
                answer = answer.combine(timeline(term, viewer, old, next, created_allowed, probe)?, conjunction);
                // Whole-rule expiry needs the remaining alternatives unless
                // structure/verdicts alone prove them irrelevant. An exists
                // with a permanent witness visits exactly the same branches
                // as one with a finite witness, under the same physical bound.
                // Logical guard narrowing does not assume this traversal skips
                // an operand: ordinary unique null points return a known miss
                // before touching storage (LLP 3000.013 §2.2).
                if answer.value == decisive && answer.invariant { break; }
            }
            Ok(answer)
        }
        RuleExpr::Not(inner) => {
            let mut answer = timeline(inner, viewer, old, next, created_allowed, probe)?;
            answer.value = answer.value.not();
            for (_, value) in &mut answer.changes { *value = value.not(); }
            Ok(answer)
        }
        _ => {
            probe.take_changes();
            let mut missing = false;
            let value = evaluate_leaf(rule, viewer, old, next, created_allowed, probe, &mut missing)?;
            let expiry = probe.replace_expiry(None);
            let mut answer = Timeline::constant(if probe.take_unknown() || missing { Verdict::Unknown } else if value { Verdict::Readable } else { Verdict::Denied });
            if let Some(changes) = probe.take_changes() {
                answer.changes = changes;
                answer.invariant = false;
                return Ok(answer);
            }
            // An absent witness stays absent as rows expire. Positive probes
            // (including created facts with extra tests) need their alternatives
            // in both lifetime worlds; the observed deadline cannot decide this.
            answer.invariant = rule_probes(rule) == 0 || answer.value == Verdict::Denied;
            if answer.value == Verdict::Readable && let Some(time) = expiry { answer.changes.push((time, Verdict::Denied)); }
            Ok(answer)
        }
    }
}

fn evaluate_leaf(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, created_allowed: bool, probe: &mut dyn Probe, missing: &mut bool) -> Result<bool, crate::error::RuntimeError> {
    match rule {
        RuleExpr::Public { .. } | RuleExpr::Allow => Ok(true),
        RuleExpr::Deny => Ok(false),
        RuleExpr::Eq(left, right) => Ok(term(left, viewer, old, next, probe, missing)? == term(right, viewer, old, next, probe, missing)?),
        RuleExpr::Ne(left, right) => Ok(term(left, viewer, old, next, probe, missing)? != term(right, viewer, old, next, probe, missing)?),
        RuleExpr::Compare(op,left,right) => {
            let left = term(left, viewer, old, next, probe, missing)?;
            let right = term(right, viewer, old, next, probe, missing)?;
            let (Value::Int(a),Value::Int(b)) = (left,right) else { return Ok(false); };
            Ok(match op { crate::ir::BinaryOp::Gte => a >= b, crate::ir::BinaryOp::Gt => a > b,
                crate::ir::BinaryOp::Lte => a <= b, crate::ir::BinaryOp::Lt => a < b, _ => false })
        }
        RuleExpr::And(_) | RuleExpr::Or(_) | RuleExpr::Not(_) => unreachable!("compound rule"),
        RuleExpr::Exists { table, index, key, equalities, .. } | RuleExpr::Created { table, index, key, equalities, .. } => {
            // Bind each operand once, through one codec/allocation path for both leaves.
            let created = matches!(rule, RuleExpr::Created { .. });
            if created && !created_allowed {
                return Err(crate::error::RuntimeError::Schema("created probes are valid only in insert rules".into()));
            }
            let key = key.iter().map(|term| self::term(term, viewer, old, next, probe, missing)).collect::<Result<Vec<_>, _>>()?;
            if *missing { return Ok(false); }
            if created {
                if !probe.created(table, index, &key) { return Ok(false); }
                if equalities.is_empty() { return Ok(true); }
            }
            let equalities = equalities.iter().map(|(column, value)| Ok((column.clone(), term(value, viewer, old, next, probe, missing)?))).collect::<Result<Vec<_>, crate::error::RuntimeError>>()?;
            if *missing { return Ok(false); }
            probe.exists(table, index, &key, &equalities)
        }
    }
}

fn term(term: &RuleTerm, viewer: &str, old: Option<&Value>, next: &Value, probe: &mut dyn Probe, missing: &mut bool) -> Result<Value, crate::error::RuntimeError> {
    Ok(match term {
        RuleTerm::Field(field) | RuleTerm::NextField(field) => { probe.field(field, false); next.field(field).cloned().unwrap_or(Value::Null) },
        RuleTerm::OldField(field) => { probe.field(field, true); old.and_then(|old| old.field(field).ok()).cloned().unwrap_or(Value::Null) },
        RuleTerm::Reference { table, column, field, old: previous } => {
            probe.field(column, *previous);
            let row = if *previous { old } else { Some(next) };
            let id = row.and_then(|r| r.field(column).ok()).unwrap_or(&Value::Null);
            match probe.reference(table, id, field)? {
                Some(value) => value,
                None => { *missing = true; Value::Null }
            }
        },
        RuleTerm::Viewer => Value::Id(viewer.to_owned()),
        RuleTerm::Literal(value) => value.clone(),
    })
}

/// The schema-derived probe allowance, independent of short-circuit answers.
pub(crate) fn rule_probes(rule: &RuleExpr) -> u64 {
    let hops = |terms: &[&RuleTerm]| terms.iter().filter(|t| matches!(t, RuleTerm::Reference { .. })).count() as u64;
    match rule {
        RuleExpr::Eq(a,b) | RuleExpr::Ne(a,b) | RuleExpr::Compare(_,a,b) => hops(&[a,b]),
        RuleExpr::Exists { key, equalities, .. } => 1 + key.iter().chain(equalities.iter().map(|(_,t)| t)).map(|t| hops(&[t])).sum::<u64>(),
        // @ref LLP 3000.007#17 — created facts with extra equalities take the metered exists path when the fact holds.
        RuleExpr::Created { key, equalities, .. } => u64::from(!equalities.is_empty()) + key.iter().chain(equalities.iter().map(|(_,t)| t)).map(|t| hops(&[t])).sum::<u64>(),
        RuleExpr::And(terms) | RuleExpr::Or(terms) => terms.iter().map(rule_probes).fold(0, u64::saturating_add),
        RuleExpr::Not(inner) => rule_probes(inner),
        RuleExpr::Allow | RuleExpr::Deny | RuleExpr::Public { .. } => 0,
    }
}

/// A rule's probe sites, as `(table, index)`: what a rule reads besides the
/// row, for live subscriptions and the partition audience.
pub fn probe_sites(rule: &RuleExpr, out: &mut Vec<(String, String)>) {
    fn term(t: &RuleTerm, out: &mut Vec<(String, String)>) {
        if let RuleTerm::Reference { table, .. } = t { out.push((table.clone(), "byId".into())); }
    }
    match rule {
        RuleExpr::Eq(a,b) | RuleExpr::Ne(a,b) | RuleExpr::Compare(_,a,b) => { term(a,out); term(b,out); }
        RuleExpr::Exists { table, index, key, equalities, .. } | RuleExpr::Created { table, index, key, equalities, .. } => {
            out.push((table.clone(), index.clone()));
            for t in key.iter().chain(equalities.iter().map(|(_,t)| t)) { term(t,out); }
        }
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().for_each(|item| probe_sites(item, out)),
        RuleExpr::Not(inner) => probe_sites(inner, out),
        _ => {}
    }
}

#[cfg(test)]
mod lifetime_tests {
    use super::*;
    struct Witness { present: bool, until: Option<i64>, expiry: Option<i64>, visited: Vec<String> }
    impl Probe for Witness {
        fn replace_expiry(&mut self, expiry: Option<i64>) -> Option<i64> { std::mem::replace(&mut self.expiry, expiry) }
        fn exists(&mut self, table: &str, _: &str, _: &[Value], _: &[(String,Value)]) -> Result<bool, crate::RuntimeError> {
            self.visited.push(table.into());
            if table == "early" { self.expiry = self.until; Ok(self.present) } else { Ok(true) }
        }
        fn created(&mut self, _: &str, _: &str, _: &[Value]) -> bool { true }
    }
    #[test]
    fn branch_selection_uses_verdicts_and_structure_including_created_tests() {
        let exists = |name: &str| RuleExpr::Exists { table: name.into(), index: "byId".into(), key: vec![], provenance: crate::ir::KeyProvenance::Const, equalities: vec![] };
        let created = RuleExpr::Created { table: "early".into(), index: "byId".into(), key: vec![], provenance: crate::ir::KeyProvenance::Const,
            equalities: vec![("kind".into(), RuleTerm::Literal(Value::Int(1)))] };
        for early in [exists("early"), created] {
            for until in [None, Some(2000)] {
                for (rule, present, verdict, visits) in [
                    (RuleExpr::Or(vec![early.clone(), exists("stable")]), true, true, vec!["early", "stable"]),
                    (RuleExpr::And(vec![early.clone(), exists("stable")]), false, false, vec!["early"]),
                    (RuleExpr::Or(vec![RuleExpr::Allow, early.clone()]), true, true, vec![]),
                    (RuleExpr::And(vec![RuleExpr::Deny, early.clone()]), true, false, vec![]),
                ] {
                    let mut probe = Witness { present, until, expiry: None, visited: vec![] };
                    assert_eq!(evaluate(&rule, "alice", None, &Value::Null, true, &mut probe).unwrap(), verdict);
                    assert_eq!(probe.visited, visits);
                    assert_eq!(probe.expiry, None, "stable authority or denial exports no deadline");
                }
            }
        }
    }
}
