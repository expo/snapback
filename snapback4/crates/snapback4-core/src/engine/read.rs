//! Reads: point lookups, bounded scans with the read rule hoisted where the
//! prefix decides it, opaque cursors, and merges of ordered lanes. Every
//! candidate row is charged to the meter; a query cut by the meter returns
//! what it found and is `capped` (LLP 2000.000 §6).

use super::rules::{self, Probe};
use super::authorized_scan::Authorization;
use super::runner::{PagePosition, Runner};
use crate::cursor::{CursorColumn, CursorPosition, CursorScope, decode_cursor, encode_cursor};
use crate::error::{MeterKind, RuntimeError};
use crate::ir::*;
use crate::schema::{Effect, Index, Table, materialize_optional_fields};
use crate::rows::{Bounds, Dir};
use crate::value::{Value, canonical_json};
use std::cmp::Ordering;
use std::collections::{BTreeSet, BinaryHeap, VecDeque};
use crate::rows::word_heap;

use super::authorized_scan::AUTHORIZATION_WALK_LIMIT;
#[path = "word_merge.rs"]
mod word_merge;
#[cfg(feature = "server-search")]
#[path = "membership_search.rs"]
mod membership_search;
#[path = "view_merge.rs"]
mod view_merge;
#[path = "branch_merge.rs"]
mod branch_merge;
#[path = "witness.rs"]
mod witness;

// Only the read evaluator mints key evidence, from evaluated inputs, validated
// cursors, or authorized result positions. Storage images cannot call a raw
// scalar/key pricing API; row fields use AuthorizedRow::scalar_heap instead.
struct DisclosedKey<'a>(&'a Value);
struct DisclosedKeys<'a>(&'a [Value]);
struct DisclosedBounds<'a>(&'a Bounds);
impl DisclosedKey<'_> {
    fn heap(self) -> u64 {
        match self.0 {
            Value::String(s) | Value::Id(s) => word_heap::text(s),
            Value::Bytes(b) => word_heap::allocation(b.len()),
            Value::Array(a) => DisclosedKeys(a).heap(), _ => 0,
        }
    }
    fn copy_heap(self) -> u64 {
        match self.0 {
            Value::String(s) | Value::Id(s) => s.len() as u64,
            Value::Bytes(b) => b.len() as u64,
            Value::Array(a) => word_heap::slots::<Value>(a.len()) + a.iter().map(|v|DisclosedKey(v).copy_heap()).sum::<u64>(), _ => 0,
        }
    }
}
impl DisclosedKeys<'_> {
    fn heap(self) -> u64 { word_heap::slots::<Value>(self.0.len()) + self.0.iter().map(|v|DisclosedKey(v).heap()).sum::<u64>() }
}
impl DisclosedBounds<'_> {
    fn heap(self) -> u64 {
        let b = self.0;
        [&b.after, &b.at_or_after, &b.before].into_iter().flatten().map(|v|DisclosedKeys(v).heap()).sum::<u64>()
            + [&b.gt, &b.gte, &b.lt, &b.lte].into_iter().flatten().map(|v|DisclosedKey(v).heap()).sum::<u64>()
            + b.word.as_ref().map_or(0, |s| word_heap::text(s))
    }
}

fn key_verdict_heap(index: &crate::schema::Index, prefix: &[Value], viewer: &str, rule: &crate::schema::RuleExpr) -> u64 {
    // The prefix row's collect buffer, map, Arc, viewer and probe term clones.
    let fields = index.components.iter().zip(prefix).filter_map(|(c,v)| c.column().map(|name| (name, v)));
    let row = fields.map(|(name,v)| word_heap::node::<String, Value>() + word_heap::text(name) + DisclosedKey(v).heap()).sum::<u64>();
    word_heap::vec_growth::<(String, Value)>(prefix.len()) + row + word_heap::slots::<usize>(2) + word_heap::text(viewer) + rule_values(rule, prefix, viewer)
}
fn rule_values(rule: &crate::schema::RuleExpr, prefix: &[Value], viewer: &str) -> u64 {
    use crate::schema::{RuleExpr::*, RuleTerm};
    let term = |t: &RuleTerm| match t {
        RuleTerm::Viewer => word_heap::text(viewer), RuleTerm::Literal(v) => DisclosedKey(v).heap(),
        RuleTerm::Reference { .. } | RuleTerm::ReferenceChain { .. } | RuleTerm::Field(_) | RuleTerm::OldField(_) | RuleTerm::NextField(_) => prefix.iter().map(|v|DisclosedKey(v).heap()).sum(),
    };
    match rule {
        Eq(a,b) | Ne(a,b) => term(a) + term(b),
        And(rs) | Or(rs) => rs.iter().map(|r| rule_values(r, prefix, viewer)).sum(), Not(r) => rule_values(r, prefix, viewer),
        Exists { table, key, equalities, .. } | Created { table, key, equalities, .. } => word_heap::text(table)
            + word_heap::vec_growth::<Value>(key.len()) + key.iter().map(term).sum::<u64>()
            + word_heap::vec_growth::<(String, Value)>(equalities.len()) + equalities.iter().map(|(name,v)| word_heap::text(name)+term(v)).sum::<u64>(),
        _ => 0,
    }
}

// @ref LLP 3000.007#18.1 — search state belongs to the generated word merge's direct lanes, never to an expression nested inside one.
#[derive(Clone)]
struct WordRead {
    admitted: bool,
    metered: bool,
    retained: bool,
    expiry: super::expiry::Pending,
    #[cfg(feature = "server-search")]
    selected: Option<Vec<String>>,
    fields: Vec<String>,
    terms: Vec<String>,
}

// Compiled scans are shared images; a lane owns only its evaluated position.
type PreparedLane<'a> = (&'a Scan, Vec<Value>, Bounds, VecDeque<Value>, bool, Option<std::rc::Rc<WordRead>>);

struct MergeHead {
    key: Vec<Value>,
    row: Value,
    lane: usize,
    order: Order,
}

impl Ord for MergeHead {
    fn cmp(&self, other: &Self) -> Ordering {
        let order = self.key.iter().zip(&other.key).find_map(|(a, b)| {
            let c = a.total_cmp(b);
            (c != Ordering::Equal).then_some(c)
        }).unwrap_or_else(|| self.key.len().cmp(&other.key.len()));
        let order = match self.order { Order::Asc => order.reverse(), Order::Desc => order };
        order.then_with(|| other.lane.cmp(&self.lane))
    }
}
impl PartialOrd for MergeHead { fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) } }
impl PartialEq for MergeHead { fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal } }
impl Eq for MergeHead {}

// One cached probe answer avoids refetching an unchanged fact in a loop.
// Writes invalidate it; cache hits still pay the declared logical probe charge.
#[derive(PartialEq)]
pub(super) struct WitnessKey {
    revision: u64, table: String, index: String, key: Vec<Value>,
    equalities: Vec<(String, Value)>, current: bool,
}

pub(super) struct RuleProbe<'a, 'b> {
    pub(super) runner: &'a mut Runner<'b>,
    pub(super) allowance: &'a Authorization,
}
impl Probe for RuleProbe<'_, '_> {
    fn reference(&mut self, table: &str, id: &Value, field: &str) -> Result<Option<Value>, RuntimeError> { self.runner.rule_reference(table, id, field) }
    fn take_changes(&mut self) -> Option<Vec<(i64, super::rules::Verdict)>> { self.runner.witness_changes.take() }
    fn replace_expiry(&mut self, expiry: Option<i64>) -> Option<i64> { self.runner.next_expiry.replace(expiry) }
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        self.runner.rule_probe_exists(self.allowance, table, index, key, equalities)
    }
    fn created(&mut self, table: &str, index: &str, key: &[Value]) -> bool {
        self.runner.created(table, index, key)
    }
}

/// The scanned prefix as the row a rule is judged against: each pinned column with its value.
fn prefix_row(index: &Index, prefix: &[Value]) -> Value {
    Value::Row(index.components.iter().zip(prefix).filter_map(|(part, value)| part.column().map(|name| (name.clone(), value.clone()))).collect::<std::collections::BTreeMap<_, _>>().into())
}

impl<'r> Runner<'r> {
    // @ref LLP 3000.007#17 — the dependency envelope is schema-derived too; short-circuit probes cannot disclose a hidden answer through tables.
    pub(super) fn rule_dependencies(&mut self, rule: &crate::schema::RuleExpr) {
        let mut sites = Vec::new();
        rules::probe_sites(rule, &mut sites);
        for (table, _) in sites {
            if let Some(key) = self.schema.maintain_for(&table).and_then(|m|m.row_key.as_ref()) {
                self.read_tables.insert(key.table.clone());
            }
            self.aggregate_source_dependency(&table);
            self.read_tables.insert(table);
        }
    }

    // @ref LLP 3000.007#20.24.6 — trusted delivery avoids physical probes,
    // not the logical prefix verdict or its scratch admission.
    fn reserve_delivered_scan(&mut self, table: &Table, visibility: rules::Visibility, admitted: bool, query: bool) -> Result<bool, RuntimeError> {
        if self.device && (query || self.meter.cut == crate::meter::Cut::Abort) && !self.context.is_system()
            && admitted && visibility.uniform && !visibility.decided_true && !table.rules.read.is_uniformly_readable() {
            let allowance = [(MeterKind::RuleProbes, rules::rule_probes(&table.rules.read))];
            if self.meter.cut == crate::meter::Cut::Abort { self.authorized_scan(&allowance, |_, _| Ok(()))?; }
            else { self.authorized_scratch(self.rule_scratch(&table.rules.read), &allowance, |_, _| Ok(()))?; }
            return Ok(true);
        }
        Ok(false)
    }

    // @ref LLP 3000.014#5-what-derives-from-the-capture — source invalidation is schema-derived, including empty and denied groups.
    pub(super) fn aggregate_source_dependency(&mut self, table: &str) {
        if let Some(maintain) = self.schema.maintain_for(table)
            && self.schema.tables[&maintain.source].is_expiring() {
            self.read_tables.insert(maintain.source.clone());
        }
    }

    fn prefix_verdict(&mut self, name: &str, table: &Table, index: &Index, prefix: &[Value], rule: &crate::schema::RuleExpr, uniform: bool) -> Result<(bool, super::expiry::Pending), RuntimeError> {
        let expiry = self.next_expiry.scope();
        if let Some(through) = &table.through && let Some(id) = index.columns().iter().zip(prefix).find_map(|(name,v)| (name == &through.reference).then_some(v)) {
            let verdict = self.parent_verdict(name,through,id)?;
            if verdict == super::through::ParentVerdict::Unknown { self.unknown_fact(name, crate::schema::through::CHILDREN, &[id.clone()], "read through parent"); }
            let admitted = verdict == super::through::ParentVerdict::Readable;
            return Ok((admitted, if admitted { expiry.defer() } else { Default::default() }));
        }
        let probe_row = prefix_row(index, prefix);
        let viewer = self.context.viewer.clone();
        // @ref LLP 3000.015#2 — one prepaid, restoring scope: a partial conjunction denial costs the same static allowance as a uniform denial.
        let verdict = self.authorized_scratch(self.rule_scratch(rule), &[(MeterKind::RuleProbes, rules::rule_probes(&table.rules.read))], |runner, allowance| {
            rules::evaluate(rule, &viewer, None, &probe_row, false, &mut PrefixProbe { runner, allowance })
        });
        self.trace_authorization(&verdict, name, Effect::Read, "read rule");
        let verdict = verdict?;
        if !verdict { self.filtered_clause(name, "read rule"); }
        let admitted = verdict && !self.read_capped();
        Ok((admitted, if uniform && admitted { expiry.defer() } else { Default::default() }))
    }

    /// A page guard, judged once for the caller (`rules::page_guard_decision`):
    /// a row-independent grant, or a disjunct whose row columns the prefix pins,
    /// evaluated with the prefix's values. It charges the read rule's static
    /// probe count on either verdict, and records no filtered clause: a false
    /// guard leaves the per-row walk.
    fn grant_verdict(&mut self, table: &Table, index: &Index, prefix: &[Value], rule: &crate::schema::RuleExpr) -> Result<(bool, super::expiry::Pending), RuntimeError> {
        let expiry = self.next_expiry.scope();
        let probe_row = prefix_row(index, prefix);
        let viewer = self.context.viewer.clone();
        let verdict = self.authorized_scratch(self.rule_scratch(rule), &[(MeterKind::RuleProbes, rules::rule_probes(&table.rules.read))], |runner, allowance| {
            rules::evaluate(rule, &viewer, None, &probe_row, false, &mut PrefixProbe { runner, allowance })
        })?;
        let admitted = verdict && !self.read_capped();
        Ok((admitted, if admitted { expiry.defer() } else { Default::default() }))
    }

    // @ref LLP 3000.007#20.9 — coverage applies before a missing candidate or empty page can return zero/complete.
    pub(super) fn aggregate_read_coverage(&mut self, table: &str, index: &str, key: &[Value], site: &str) -> Result<(), RuntimeError> {
        self.aggregate_source_dependency(table);
        if !self.device { return Ok(()); }
        let Some(maintain) = self.schema.maintain_for(table) else { return Ok(()); };
        if self.defer_receipt_maintain(maintain) {
            let group = self.receipt_read_group(maintain, index, key)?;
            self.receipt_maintain_pending(maintain, group.as_deref())?;
        }
        if let Some(k) = &maintain.row_key {
            // A projected view uses its member's acquisition; absence beyond that
            // horizon is unknown even though the projection has no order columns.
            if self.schema.tables[&k.table].sync.as_ref().is_none_or(|s| s.horizon.is_some()) {
                self.read_tables.insert(k.table.clone());
                // A held point value is checked against the member by live_row_view.
                let index_def = &self.schema.tables[table].indexes[index];
                if !index_def.unique || key.len() != index_def.components.len() {
                    let whole = self.schema.tables[&k.table].sync.as_ref().is_some_and(|sync| {
                        let Some(horizon) = &sync.horizon else { return false; };
                        let group = match &sync.audience {
                            crate::schema::Audience::Public => Some(vec![]),
                            crate::schema::Audience::Column(field) => index_def.columns().iter()
                                .position(|f| f == field).and_then(|i| key.get(i)).map(|v| vec![v.clone()]),
                            _ => None,
                        };
                        group.is_some_and(|group| matches!(self.tx.acquired_boundary(&k.table, &horizon.by, &group),
                            Ok(Some(crate::rows::AcquiredBoundary::Whole))))
                    });
                    if !whole { self.unknown_fact(table, index, key, site); }
                }
            }
            return Ok(());
        }
        let source = &self.schema.tables[&maintain.source];
        if self.schema.maintain_subset_unknown(table) || (source.is_expiring() && source.sync.as_ref().is_none_or(|sync| sync.horizon.is_some())) {
            self.read_tables.insert(maintain.source.clone());
            self.unknown_fact(table, index, key, site);
        }
        Ok(())
    }

    fn horizon_coverage(&mut self, scan: &Scan, prefix: &[Value], retained: bool) {
        if retained { self.beyond_horizon = true; self.components.note(|frame| { frame.beyond = true; frame.retained = true; }); }
        else { self.unknown_fact(&scan.table, &scan.index, prefix, &scan.site); }
        // @ref LLP 3000.016#2.2 — unknown inbox coverage withholds the whole query, including unshaped pages.
        if self.schema.timelines.iter().any(|timeline| scan.table == timeline.table("Feed")) { self.query_unavailable = true; }
    }

    /// Whether a row is past its table's `expire` column at this run's
    /// clock. Expired is absent: to every reader, on every host, before
    /// any rule (the sweep makes it physical). The system sees no more
    /// than anyone: an expired row contributes to nothing.
    pub(super) fn expired(&self, table: &Table, row: &Value) -> bool {
        self.context.now.is_some_and(|now| table.expired(row, now))
    }

    pub(super) fn note_expiry(&mut self, table: &Table, row: &Value) {
        if let Some(column) = table.expiry_column()
            && let Ok(Value::Int(at)) = row.field(column)
            && self.context.now.is_some_and(|now| *at > now)
        {
            self.next_expiry.note(*at);
        }
    }

    /// Delivered rows are authoritative except when a temporary audience
    /// can end on the device's clock without a server commit. Retained
    /// history stays readable; until-revoked content rechecks that audience.
    pub(super) fn trust_synced_read(&self, table: &Table) -> bool {
        self.device && table.sync.as_ref().is_some_and(|sync| {
            table.leave == crate::schema::LeavePolicy::DeliveredHistory || match &sync.audience {
                crate::schema::Audience::Target { table, .. } => self.schema.table(table).is_none_or(|target| !target.is_expiring()),
                _ => true,
            }
        })
    }

    /// Whether the viewer may `effect` the row. The system principal is the
    /// store's owner and passes every rule; validation and constraints
    /// still run for it.
    pub(crate) fn check_rule(&mut self, table_name: &str, effect: Effect, old: Option<&Value>, next: &Value) -> Result<bool, RuntimeError> {
        if effect != Effect::Read && self.timeline_may_write(table_name, effect) { return Ok(true); }
        if self.context.is_system() {
            return Ok(true);
        }
        if effect == Effect::Read && self.is_provisional(table_name, next)? { return self.provisional_readable(table_name, next); }
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        // A device holds a synced table's rows because the server delivered
        // each under the read rule and withdraws what it revokes; what
        // `retain delivered-history` kept stays readable here (LLP 3000 §7).
        if effect == Effect::Read && self.trust_synced_read(table) {
            return Ok(true);
        }
        // @ref LLP 3000.007#8 — item 7(a): an unnamed update rule judges old and next.
        let mut rule = table.rules.for_effect(effect).clone();
        if effect == Effect::Update && old.is_some() && table.judges_old_image() { rule = rule.old_and_next(); }
        if effect == Effect::Update && let Some(old) = old {
            for (field, authority) in &table.written_by {
                if !authority.audience && old.field(&authority.owner).ok() != Some(&Value::Id(self.context.viewer.clone())) {
                    rule.fold_untouched_field(field, &table.columns[field]);
                }
            }
        }
        if effect == Effect::Read { self.rule_dependencies(&rule); }
        let bytes = self.rule_scratch(&rule);
        let result = self.authorized_scratch(bytes, &[(MeterKind::RuleProbes, rules::rule_probes(&rule))], |runner, allowance| {
            let mut next = next.clone();
            materialize_optional_fields(&mut next, table);
            let old = old.map(|old| {
                let mut old = old.clone();
                materialize_optional_fields(&mut old, table);
                old
            });
            runner.evaluate_sequence_rule(allowance, table_name, &rule, effect, old.as_ref(), &next)
        }).map_err(|error| error.authorization_context(table_name, effect));
        self.trace_rule_result(&result, table_name, effect);
        result
    }

    /// A row by id, materialized, without a rule check.
    pub(crate) fn fetch(&mut self, _allowance: &Authorization, table_name: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        self.schema.refuse_private(table_name)?;
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        let found = if crate::rows::disclosed::actual_size(table) {
            self.live_lookup(_allowance, table_name, "byId", &table.indexes["byId"], &[Value::Id(id.into())], #[cfg(feature = "sqlite")] None)?
        } else { self.authorized_scratch(crate::rows::disclosed::decode_reservation(table), &[], |runner, authority| {
            runner.tx.get(authority, table_name, id).map(|found| found.map(|mut row| {
                materialize_optional_fields(&mut row, table);
                row
            }))
        })? };
        if self.device && (table.sync.is_none() || (found.is_none() && table.sync.as_ref().is_some_and(|s| s.horizon.is_some()))) { self.unknown_fact(table_name, "byId", &[Value::Id(id.to_owned())], "write target"); }
        Ok(found.filter(|row| !self.expired(table, row)))
    }

    /// The scan's prefix values, evaluated. A word term is not a value a
    /// store can seek to; `scan_words` takes those scans apart first.
    pub(super) fn prefix_values(&mut self, scan: &Scan) -> Result<Vec<Value>, RuntimeError> {
        scan.prefix
            .iter()
            .map(|key| match key {
                IndexKeyExpr::Scalar(expr) => self.expr(expr),
                IndexKeyExpr::WordPrefix(_) => Err(RuntimeError::Schema("a matching term is read through its words(..) index, never as a prefix value".into())),
            })
            .collect()
    }

    /// A `matching` read: the query's first term selects every word of the
    /// index it is a prefix of (one seek each, bounded by the meter for a
    /// uniform scope, otherwise at most `MAX_WORD_LANES`),
    /// and those words are merged as ordered lanes into one page, newest
    /// first when the index says so; every further term must also be a
    /// prefix of some word of the row (a filter over the page, never a
    /// second index). An empty term list matches nothing: its page is empty,
    /// not everything.
    fn scan_words(&mut self, scan: &Scan) -> Result<Vec<Value>, RuntimeError> {
        // @ref LLP 3000.007#20.24.1 — a uniform matching scan is always lazy: the merge position appends
        // the row id when the ordering suffix lacks it.
        if rules::scan_visibility(self.schema, scan).uniform { return self.merge_lazy(None, Some(scan)); }
        let Some((merge, word)) = self.word_lanes(scan)? else {
            if self.page_depth == 0 && scan.opaque_cursor {
                self.record_page(scan.site.clone(), PagePosition { variant: scan.variant, view_suffix: None, table: scan.table.clone(), index: scan.index.clone(), order: scan.order, prefix_len: scan.prefix.len(), prefix: None, merge: true, interrupted: false, inclusive: false, shape_positions: Vec::new(), shape_resume: super::shaping::Resume::Never, next: None }, std::iter::empty())?;
            }
            return Ok(Vec::new());
        };
        self.merge_with_words(&merge, Some(&word))
    }

    /// Admit one scope, then discover its words. Both a scoped page and a
    /// uniform matching merge use exactly this validation and charge order.
    fn prepare_words(&mut self, scan: &Scan, bounds_validated: bool) -> Result<Option<(Vec<Value>, String, WordRead)>, RuntimeError> {
        let table = self.schema.table(&scan.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", scan.table)))?;
        let index = table.index(&scan.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", scan.table, scan.index)))?;
        let Some((position, fields)) = index.word_component() else {
            return Err(RuntimeError::Schema(format!("{}.{} has no words(..) component for a matching read", scan.table, scan.index)));
        };
        let visibility = rules::scan_visibility(self.schema, scan);
        if visibility.uniform {
            // Scope slots and field names before collecting; expr charges evaluated values.
            self.meter.heap(word_heap::slots::<Value>(position) + word_heap::strings(fields))?;
        }
        let fields = fields.to_vec();
        let mut scope = Vec::with_capacity(position);
        let mut query = Value::Null;
        for key in &scan.prefix {
            match key {
                IndexKeyExpr::Scalar(expr) => scope.push(self.expr(expr)?),
                IndexKeyExpr::WordPrefix(expr) => query = self.expr(expr)?,
            }
        }
        if scope.len() != position {
            return Err(RuntimeError::Schema(format!("{}.{} takes {position} prefix values before its words, not {}", scan.table, scan.index, scope.len())));
        }
        let text = match query {
            Value::String(text) => text,
            Value::Null => String::new(),
            other => return Err(RuntimeError::Input(format!("matching takes text, not {}", other.kind()))),
        };
        let mut terms = if visibility.uniform {
            word_heap::tokenize_limit(&mut self.meter, [&*text], crate::words::MAX_TERMS)?
        } else { crate::words::terms(&text) };
        // Validate every scan input before denial or empty word discovery can
        // return. Generated lanes retain the same bounds and cursor scope.
        if !bounds_validated { self.word_bounds(scan, table, index, None, visibility.uniform)?; }
        self.take(&scan.take)?;
        if visibility.uniform {
            self.word_note_table(&scan.table)?;
            self.word_dependencies(&table.rules.read)?;
            self.meter.heap(word_heap::text(&scan.site))?;
        } else {
            self.read_tables.insert(scan.table.clone());
            self.rule_dependencies(&table.rules.read);
        }
        self.meter.at(&scan.site);
        let mut retained = false;
        if self.device {
            // @ref LLP 3000.007#18.2 — retention has no horizon requirement, including positive existence; prepay and share one scope verdict.
            // Retained-group key scratch and coverage's diagnostic JSON/names
            // are bounded before the lookup or unknown_fact formats/clones them.
            if visibility.uniform && (table.leave == crate::schema::LeavePolicy::DeliveredHistory || table.sync.is_none()
                || (!scan.existence && table.sync.as_ref().is_some_and(|sync| sync.horizon.is_some()))) {
                self.device_work(|runner| runner.meter.heap(256 * (192 + DisclosedKeys(&scope).heap() + word_heap::text(&scan.table) + word_heap::text(&scan.index) + word_heap::text(&scan.site))))?;
            }
            retained = self.retained_group(&scan.table, &scan.index, &scope)?;
            if table.sync.is_none() { self.unknown_fact(&scan.table, &scan.index, &scope, &scan.site); self.components.note(|frame| frame.speculative = true); }
            else if !scan.existence && table.sync.as_ref().is_some_and(|sync| sync.horizon.is_some()) {
                self.horizon_coverage(scan, &scope, retained);
            }
        }
        // @ref LLP 3000.007#18.1 — one verdict per matching scope, before word discovery and shared by its generated lanes.
        let parent_pinned = table.through.as_ref().is_some_and(|t| index.columns().iter().take(scope.len()).any(|f| f == &t.reference));
        let mut admitted = !parent_pinned && (self.trust_synced_read(table) || self.context.is_system() || visibility.decided_true || table.rules.read.is_uniformly_readable());
        let mut prefix_expiry = super::expiry::Pending::default();
        self.private_scan_authority(&scan.table, visibility.uniform, admitted)?;
        self.reserve_delivered_scan(table, visibility, admitted, false)?;
        if !admitted && !visibility.uniform { self.non_uniform = true; self.components.note(|frame| frame.non_uniform = true); }
        if terms.is_empty() {
            return Ok(None);
        }
        if !admitted {
            // Uniform word scopes can borrow their rule; simplification/cloning
            // is needed only by the existing partial-conjunction traversal.
            let partial = if visibility.uniform { None } else { rules::prefix_decision(self.schema, scan) };
            if let Some(rule) = if visibility.uniform { Some(&table.rules.read) } else { partial.as_ref() } {
            if visibility.uniform { self.meter.heap(key_verdict_heap(index, &scope, &self.context.viewer, rule))?; }
            let aborting = self.meter.cut == crate::meter::Cut::Abort;
            if aborting && !self.read_charge(MeterKind::Examined, 1)? { return Ok(None); }
            let (allowed, pending) = self.prefix_verdict(&scan.table, table, index, &scope, rule, visibility.uniform)?;
            if !allowed && !(self.device && parent_pinned) {
                return Ok(None);
            }
            prefix_expiry = pending;
            admitted = allowed && visibility.uniform;
            }
        }
        let first = terms.remove(0);
        Ok(Some((scope, first, WordRead { #[cfg(feature = "server-search")] selected: None, admitted, metered: admitted && visibility.uniform, retained, expiry: prefix_expiry, fields, terms })))
    }

    fn discover_words(&mut self, scan: &Scan) -> Result<Option<(Vec<String>, Vec<Value>, WordRead)>, RuntimeError> {
        const MAX_WORD_LANES: usize = 32;
        let Some((scope, first, word)) = self.prepare_words(scan, false)? else { return Ok(None) };
        let table = &self.schema.tables[&scan.table];
        let index = &table.indexes[&scan.index];
        let position = index.word_component().unwrap().0;
        let admitted = word.admitted;
        let metered_words = word.metered;
        // The words the first term is a prefix of, one seek per word: the
        // seek lands on the word's first entry, the next seek starts past
        // its last. Each costs one index entry on the meter.
        // @ref LLP 3000.007#20.24 — L14.2: a uniform scope's word expansion is bounded by the meter, not by 32.
        let mut words: Vec<String> = if metered_words { Vec::new() } else {
            self.authorized_scan(&[
                (MeterKind::IndexEntries, (MAX_WORD_LANES + 1) as u64),
                (MeterKind::RuleProbes, if admitted { 0 } else { rules::rule_probes(&table.rules.read).saturating_mul((MAX_WORD_LANES + 1) as u64) }),
            ], |runner, allowance| {
                let mut words = Vec::new();
                let mut walk_remaining = AUTHORIZATION_WALK_LIMIT;
                let mut bounds = Bounds { word: Some(first.clone()), ..Bounds::default() };
                while walk_remaining > 0 {
                    let found = runner.tx.scan(allowance, &scan.table, &scan.index, &scope, &bounds, Dir::Asc, 1)?;
                    let Some((_, key)) = found.first() else { break };
                    let Some(Value::String(token)) = crate::key::decode(key).and_then(|values| values.into_iter().nth(position)) else {
                        return Err(RuntimeError::Store("word index holds a non-text word".into()));
                    };
                    bounds.after = Some(vec![Value::String(token.clone())]);
                    let prefix: Vec<_> = scope.iter().cloned().chain([Value::String(token.clone())]).collect();
                    if runner.authorized_candidate(scan, &prefix, &Bounds::default(), Dir::Asc, &mut walk_remaining)?.is_empty() { continue; }
                    if words.len() == MAX_WORD_LANES {
                        runner.components.note(|frame| frame.words = true);
                        if runner.word_cut_at.is_none() { runner.word_cut_at = Some(format!("{} lane {:?}", scan.site, scope)); }
                        break;
                    }
                    words.push(token);
                }
                Ok(words)
            })?
        };
        if metered_words { self.meter.heap(word_heap::text(&first))?; }
        let mut bounds = Bounds { word: Some(first.clone()), ..Bounds::default() };
        while metered_words {
            if !self.read_charge(MeterKind::IndexEntries, 1)? {
                break;
            }
            let found = if metered_words { self.scan_disclosed(&scan.table, &scan.index, &scope, &bounds, Dir::Asc, 1)?.into_iter().map(|(r,k)|(r.map(|r|r.into_value()).unwrap_or(Value::Null),k)).collect() }
                else { self.metered_scan(|runner, allowance| runner.tx.scan(allowance, &scan.table, &scan.index, &scope, &bounds, Dir::Asc, 1))? };
            let Some((_, key)) = found.into_iter().next() else { break };
            if metered_words {
                // Decoder vector and string scratch before decoding; the store's fetched
                // row/key are transient, never accumulated with the discovered words.
                self.meter.heap(word_heap::key_decode(index.components.len() + 1, key.len()))?;
            }
            let Some(Value::String(word)) = crate::key::decode(&key).and_then(|values| values.into_iter().nth(position)) else {
                return Err(RuntimeError::Store(format!("{}.{} holds a key whose word is not text", scan.table, scan.index)));
            };
            if metered_words {
                // Retain the decoded token and its seek copy before either vector grows.
                // The store owns the fetched row/key; only the decoded word survives here.
                self.meter.heap(2 * word_heap::text(&word) + word_heap::slots::<Value>(1))?;
            }
            bounds.after = Some(vec![Value::String(word.clone())]);
            if metered_words { word_heap::push(&mut self.meter, &mut words, word)?; }
            else { words.push(word); }
        }
        if words.is_empty() {
            return Ok(None);
        }
        Ok(Some((words, scope, word)))
    }

    // The non-uniform traversal retains its eager order and disclosure contract.
    fn word_lanes(&mut self, scan: &Scan) -> Result<Option<(Merge, WordRead)>, RuntimeError> {
        let Some((words, scope, word)) = self.discover_words(scan)? else { return Ok(None) };
        let lanes = words.into_iter().map(|token| {
            let mut generated = scan.clone();
            generated.prefix = scope.iter().cloned().chain([Value::String(token)]).map(|v| IndexKeyExpr::Scalar(Expr::Literal(v))).collect();
            MergeLane { guard: None, distinct: None, branch: None, project: None, setup: Vec::new(), scan: generated, source: None, binding: String::new() }
        }).collect();
        Ok(Some((Merge { variant: scan.variant, position: None, view: None, order_keys: Vec::new(), site: scan.site.clone(), lanes }, word)))
    }

    fn take(&self, bound: &Bound) -> Result<usize, RuntimeError> {
        Ok(match bound {
            Bound::Literal(value) => *value as usize,
            Bound::Meter => self.meter.ceilings.examined.min(usize::MAX as u64 - 1) as usize,
            Bound::Arg { name, max } => {
                let value = self.context.args.get(name).ok_or_else(|| RuntimeError::Input(format!("missing take arg {name}")))?.as_int()?;
                if value < 0 || value > *max as i64 {
                    return Err(RuntimeError::Fanout);
                }
                value as usize
            }
        })
    }

    /// The typed columns after a prefix of `prefix_len` components: what a
    /// cursor carries. Counted in components, so a words lane's cursor is
    /// the order columns after the word.
    fn cursor_suffix(table: &Table, index: &Index, prefix_len: usize) -> Vec<CursorColumn> {
        index.components.iter().skip(prefix_len).filter_map(|component| Some(CursorColumn { name: component.key_name()?.clone(), kind: component.key_type(table)? })).collect()
    }

    // @ref LLP 3000.007.000#1 — only a merge appends the stored row id; direct descriptors and paved id-ending tokens keep their bytes.
    fn merge_suffix(table: &Table, index: &Index, prefix_len: usize) -> Vec<CursorColumn> {
        let mut suffix = Self::cursor_suffix(table, index, prefix_len);
        if suffix.last().is_none_or(|column| column.name != "id") {
            suffix.push(CursorColumn { name: "id".into(), kind: table.columns["id"].clone() });
        }
        suffix
    }

    /// The bounds of a scan: the cursor position and any value range.
    fn bounds(&mut self, scan: &Scan, table: &Table, index: &Index, prefix: Option<&[Value]>) -> Result<Bounds, RuntimeError> {
        self.word_bounds(scan, table, index, prefix, false)
    }

    fn word_bounds(&mut self, scan: &Scan, table: &Table, index: &Index, prefix: Option<&[Value]>, metered: bool) -> Result<Bounds, RuntimeError> {
        self.record_shape_cursor(&scan.site, None);
        let mut bounds = Bounds::default();
        let after = scan.after.as_deref().map(|value| self.expr(value)).transpose()?;
        let before = scan.before.as_deref().map(|value| self.expr(value)).transpose()?;
        match before {
            None | Some(Value::Null) => {}
            Some(Value::Array(values)) => bounds.before = Some(values),
            Some(value) => {
                if metered { self.meter.heap(word_heap::slots::<Value>(1))?; }
                bounds.before = Some(vec![value]);
            }
        }
        match after {
            None | Some(Value::Null) => {}
            Some(Value::String(mut token)) if scan.opaque_cursor => {
                // A matching merge shares its validated cursor image; each bound
                // pays only its own retained values, before cloning them.
                let merged = scan.merge_site.is_some() || index.word_component().is_some();
                if metered {
                    let suffix = word_heap::suffix(&mut self.meter, table, index, scan.prefix.len(), merged)?;
                    self.validate_word_cursor(&token, &scan.table, &scan.index, scan.order, &suffix, scan.variant)?;
                    let position = &self.word_cursor.as_ref().unwrap().1;
                    self.meter.heap(DisclosedKeys(&position.values).heap())?;
                    if position.inclusive { bounds.at_or_after = Some(position.values.clone()); }
                    else { bounds.after = Some(position.values.clone()); }
                    self.word_shape_cursor(&scan.site, token)?;
                } else {
                let mut position = decode_cursor(self.schema, &token).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
                crate::cursor::check_variant(&position, scan.variant)?;
                let mut cursor_prefix = scan.prefix.len();
                // @ref LLP 3000.028#3.2 — only a compiler-marked prefix extension
                // admits its previous typed descriptor and evaluated scope.
                if !merged && position.suffix.len() + cursor_prefix != index.components.len()
                    && scan.cursor_pins != 0 && (scan.cursor_pins as usize) <= cursor_prefix {
                    cursor_prefix -= scan.cursor_pins as usize;
                }
                let suffix = if merged { Self::merge_suffix(table, index, cursor_prefix) }
                    else { Self::cursor_suffix(table, index, cursor_prefix) };
                position.check_descriptor(&scan.table, &scan.index, scan.order, &suffix)
                    .map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
                let mut use_position = true;
                if scan.merge_site.is_none() && let Some(prefix) = prefix {
                    if !position.scope.as_ref().is_some_and(|scope| scope.generation == self.context.generation
                        && scope.prefix == prefix[..cursor_prefix]) {
                        return Err(RuntimeError::Input(format!("cursor: {}", crate::cursor::CursorError::Scope)));
                    }
                    let removed = prefix.len() - cursor_prefix;
                    if removed != 0 {
                        let compared = crate::key::encode(&position.values[..removed]).cmp(&crate::key::encode(&prefix[cursor_prefix..]));
                        if compared == std::cmp::Ordering::Equal {
                            position.values.drain(..removed);
                            // Shape no-progress detection must compare the same
                            // normalized position that the scan will resume.
                            position.suffix = Self::cursor_suffix(table, index, scan.prefix.len());
                            position.scope.as_mut().unwrap().prefix = prefix.to_vec();
                            token = encode_cursor(self.schema, &position)
                                .map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
                        } else {
                            // A baseline cut can stop on a filter reject. Before
                            // this scope starts from its beginning; past it uses
                            // an empty strict bound, in either direction.
                            use_position = (compared == std::cmp::Ordering::Greater) == (scan.order == Order::Asc);
                            position.values.clear();
                            position.inclusive = false;
                        }
                    }
                }
                if use_position {
                    if position.inclusive { bounds.at_or_after = Some(position.values); }
                    else { bounds.after = Some(position.values); }
                }
                self.record_shape_cursor(&scan.site, Some(token));
                }
            }
            Some(Value::Array(values)) if !scan.opaque_cursor => bounds.after = Some(values),
            Some(value) if !scan.opaque_cursor => {
                if metered { self.meter.heap(word_heap::slots::<Value>(1))?; }
                bounds.after = Some(vec![value]);
            }
            Some(_) => return Err(RuntimeError::Input("an opaque cursor is a string or null".into())),
        }
        if let Some((site, position)) = &self.view_seek && site == &scan.site {
            self.meter.heap(DisclosedKeys(&position.values).heap())?;
            if position.inclusive { bounds.at_or_after = Some(position.values.clone()); }
            else { bounds.after = Some(position.values.clone()); }
        }
        if let Some(range) = &scan.range {
            bounds.gt = range.gt.as_deref().map(|v| self.expr(v)).transpose()?;
            bounds.gte = range.gte.as_deref().map(|v| self.expr(v)).transpose()?;
            bounds.lt = range.lt.as_deref().map(|v| self.expr(v)).transpose()?;
            bounds.lte = range.lte.as_deref().map(|v| self.expr(v)).transpose()?;
        }
        Ok(bounds)
    }

    #[cfg(feature = "sqlite")]
    pub(super) fn freeze_job_domain(&mut self, scan: &Scan) -> Result<Scan, RuntimeError> {
        let mut frozen = scan.clone();
        frozen.prefix = self.prefix_values(scan)?.into_iter().map(|value| IndexKeyExpr::Scalar(Expr::Literal(value))).collect();
        if let Some(range) = &mut frozen.range {
            for value in [&mut range.gt, &mut range.gte, &mut range.lt, &mut range.lte] {
                if let Some(expr) = value { **expr = Expr::Literal(self.expr(expr)?); }
            }
        }
        for value in [&mut frozen.before, &mut frozen.after] {
            if let Some(expr) = value { **expr = Expr::Literal(self.expr(expr)?); }
        }
        Ok(frozen)
    }

    #[cfg(feature = "sqlite")]
    pub(super) fn job_page(&mut self, scan: &Scan) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        let prefix = self.prefix_values(scan)?;
        let table = &self.schema.tables[&scan.table];
        let bounds = self.bounds(scan, table, &table.indexes[&scan.index], Some(&prefix))?;
        self.scan_consumed(scan, prefix, bounds, self.take(&scan.take)?, None, None, true, false)
    }

    /// An aborting domain retains a bounded result vector, but decodes only
    /// one prepaid row at a time. Each selected image replaces that iteration's
    /// decode scratch with its retained row/vector allowance.
    pub(super) fn metered_domain(&mut self, scan: &Scan) -> Result<Vec<Value>, RuntimeError> {
        self.schema.refuse_private(&scan.table)?;
        let prefix = self.prefix_values(scan)?;
        let table = &self.schema.tables[&scan.table];
        let bounds = self.bounds(scan, table, &table.indexes[&scan.index], Some(&prefix))?;
        self.scan_consumed(scan, prefix, bounds, self.take(&scan.take)?, None, None, false, true).map(|(rows, _)| rows)
    }

    #[cfg(feature = "sqlite")]
    pub(super) fn job_upper(&mut self, scan: &Scan) -> Result<Option<Vec<u8>>, RuntimeError> {
        let prefix = self.prefix_values(scan)?;
        let table = &self.schema.tables[&scan.table];
        let bounds = self.bounds(scan, table, &table.indexes[&scan.index], Some(&prefix))?;
        self.read_charge(MeterKind::Examined, 1)?;
        Ok(self.scan_disclosed(&scan.table, &scan.index, &prefix, &bounds, Dir::Desc, 1)?.pop().map(|(_, key)| key))
    }

    /// A bounded page. Returns the visible rows, at most `take`, and records
    /// the page position for `next` when this scan is the program's page.
    pub(super) fn scan(&mut self, scan: &Scan) -> Result<Vec<Value>, RuntimeError> {
        let (rows, _) = self.scan_with_keys(scan)?;
        Ok(rows)
    }

    pub(super) fn scan_with_keys(&mut self, scan: &Scan) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        let expiry = self.next_expiry.scope();
        let rows = self.scan_with_keys_inner(scan)?;
        expiry.emit();
        Ok(rows)
    }

    fn scan_with_keys_inner(&mut self, scan: &Scan) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        self.schema.refuse_private(&scan.table)?;
        if !scan.existence { return self.scan_with_words(scan, None); }
        self.page_depth += 1;
        let result = self.scan_with_words(scan, None);
        self.page_depth -= 1;
        // A held witness proves existence even beyond an acquired horizon.
        // Only absence needs coverage; keep rule/aggregate uncertainty intact.
        if result.as_ref().is_ok_and(|(rows, _)| rows.is_empty())
            && self.device && self.schema.tables[&scan.table].sync.as_ref().is_some_and(|sync| sync.horizon.is_some()) {
            let prefix = scan.prefix.iter().filter_map(IndexKeyExpr::scalar).map(|value| self.expr(value)).collect::<Result<Vec<_>, _>>()?;
            let retained = self.retained_group(&scan.table, &scan.index, &prefix)?;
            self.horizon_coverage(scan, &prefix, retained);
        }
        result
    }

    fn scan_with_words(&mut self, scan: &Scan, word: Option<&WordRead>) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        if scan.prefix.iter().any(|key| matches!(key, IndexKeyExpr::WordPrefix(_))) {
            // A search page is a merge of word lanes; it carries no keys of
            // its own (a job never sweeps a words index).
            return self.scan_words(scan).map(|rows| (rows, Vec::new()));
        }
        let prefix = self.prefix_values(scan)?;
        self.timeline_read_pending(&scan.table, &scan.index, &prefix)?;
        let table = self.schema.table(&scan.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", scan.table)))?;
        let index = table.index(&scan.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", scan.table, scan.index)))?;
        // @ref LLP 3000.007#18.1 — generated word lanes share the search's merge cursor, not a direct cursor scoped to one word.
        let bounds = self.bounds(scan, table, index, if word.is_some() { None } else { Some(&prefix) })?;
        let take = self.take(&scan.take)?;
        self.scan_prepared(scan, prefix, bounds, take, word)
    }

    fn word_scan_prepared(&mut self, scan: &Scan, prefix: &[Value], bounds: &Bounds, take: usize, word: Option<&WordRead>) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        if word.is_some_and(|w| w.metered) {
            // Scan arguments own their prefix and bounds; Vec -> VecDeque transfers its buffer.
            self.meter.heap(DisclosedKeys(prefix).heap() + DisclosedBounds(bounds).heap())?;
        }
        self.scan_prepared(scan, prefix.to_vec(), bounds.clone(), take, word)
    }

    fn charge_word_key(&mut self, table: &str, index: &Index, prefix_len: usize, suffix_len: usize, row: &Value) -> Result<(), RuntimeError> {
        // Exact suffix slots plus copied column bodies (computed time keys are scalars).
        let row = self.project_row(table,row.clone())?;
        let copied = index.components.iter().skip(prefix_len).filter_map(|c| c.column()).map(|c|row.scalar_heap(c)).sum::<u64>();
        let appended = if index.components.len() - prefix_len < suffix_len { row.scalar_heap("id") } else { 0 };
        self.meter.heap(word_heap::slots::<Value>(suffix_len) + copied + appended)
    }

    /// Resume a merge lane using its already evaluated bounds. The original
    /// expressions still govern uniformity; freezing them into literals would
    /// lose facts such as a prefix pinned to `viewer`.
    fn scan_prepared(&mut self, scan: &Scan, prefix: Vec<Value>, bounds: Bounds, take: usize, word: Option<&WordRead>) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        self.scan_consumed(scan, prefix, bounds, take, word, None, false, false)
    }

    // @ref LLP 3000.013#5.1 — domain scalars consume the ordinary authorized scan one row at a time.
    pub(super) fn stream_aggregate(&mut self, scan: &Scan, aggregate: super::extrema::Aggregate<'_>) -> Result<Value, RuntimeError> {
        let expiry = self.next_expiry.scope();
        // Prefixes may be hoisted, and filter/projection locals evaluated
        // before this frame. Without input provenance, conservatively retain
        // earlier unknown coverage. An enclosing page's non-uniformity alone
        // does not make the scalar's inputs unknown; observe its own scans.
        // Ordinary query/component flags remain monotone throughout the scan.
        let inputs = super::components::Frame {
            beyond: self.beyond_horizon,
            unknown: self.missing_fact.is_some(),
            words: self.word_cut_at.is_some(),
            presence: self.presence_unknown,
            ..Default::default()
        };
        let outer = self.components.scalar.replace(inputs);
        let result = self.stream_aggregate_scoped(scan, aggregate);
        let coverage = self.components.scalar.take().expect("scalar coverage scope");
        self.components.scalar = outer;
        let value = result?;
        // @ref LLP 3000.036#15.12 — a visible witness proves existence over a
        // per-row rule: rows the caller may not read can only hide absence.
        // Every other gap (a cut, unknown device coverage, a held horizon,
        // words, presence) still makes the answer unavailable.
        let witnessed = scan.existence && matches!(value, Value::Int(n) if n > 0)
            && super::components::Frame { non_uniform: false, ..coverage.clone() }.coverage().complete;
        if !coverage.coverage().complete && !witnessed {
            self.scalar_unavailable = true;
            return Err(RuntimeError::Prediction(format!("{}: streaming aggregate needs complete domain coverage", scan.site)));
        }
        expiry.emit();
        Ok(value)
    }

    fn stream_aggregate_scoped(&mut self, scan: &Scan, mut aggregate: super::extrema::Aggregate<'_>) -> Result<Value, RuntimeError> {
        self.schema.refuse_private(&scan.table)?;
        let prefix = self.prefix_values(scan)?;
        let table = &self.schema.tables[&scan.table];
        let index = &table.indexes[&scan.index];
        let bounds = self.bounds(scan, table, index, Some(&prefix))?;
        self.page_depth += 1;
        let result = self.scan_consumed(scan, prefix, bounds, self.take(&scan.take)?, None, Some(&mut aggregate), false, false);
        self.page_depth -= 1;
        result?;
        if scan.existence && aggregate.is_zero() && self.device && table.sync.as_ref().is_some_and(|s| s.horizon.is_some()) {
            let prefix = self.prefix_values(scan)?;
            let retained = self.retained_group(&scan.table, &scan.index, &prefix)?;
            self.horizon_coverage(scan, &prefix, retained);
        }
        // @ref LLP 3000.013#5.1 — a domain total has no partial scalar answer, including on a device with unknown coverage.
        self.meter.require_uncapped()?;
        aggregate.finish()
    }

    /// The caller prepays the page before entering. Hidden candidates never
    /// reach the page's payload ledger, filter, lookahead or continuation.
    fn authorized_candidate(&mut self, scan: &Scan, prefix: &[Value], bounds: &Bounds, dir: Dir, remaining: &mut usize) -> Result<Vec<(Option<super::authorized_point::AuthorizedRow<'r>>, Vec<u8>)>, RuntimeError> {
        let table = &self.schema.tables[&scan.table];
        let bytes = crate::rows::disclosed::decode_reservation(table).saturating_add(self.rule_scratch(&table.rules.read));
        let result = self.authorized_scratch(bytes, &[], |runner, allowance| {
            let mut cursor = bounds.clone();
            loop {
                if *remaining == 0 || runner.tx.remaining() == 0 {
                    runner.filtered_phase(&scan.table, "authorization allowance (read)", "read rule");
                    return Ok(Vec::new());
                }
                let Some((mut row, key)) = runner.tx.scan(allowance, &scan.table, &scan.index, prefix, &cursor, dir, 1)?.pop() else { return Ok(Vec::new()); };
                cursor.after = crate::key::decode(&key).map(|key| key.into_iter().skip(prefix.len()).collect());
                materialize_optional_fields(&mut row, table);
                if let Some(row) = runner.authorize_image(&scan.table, row)? { return Ok(vec![(Some(row), key)]); }
                *remaining -= 1;
            }
        });
        match result {
            Err(RuntimeError::AuthorizationBudget { .. }) => {
                self.filtered_phase(&scan.table, "authorization allowance (read)", "read rule");
                Ok(Vec::new())
            },
            other => other,
        }
    }

    fn scan_consumed(&mut self, scan: &Scan, prefix: Vec<Value>, bounds: Bounds, take: usize, word: Option<&WordRead>, mut aggregate: Option<&mut super::extrema::Aggregate<'_>>, job_page: bool, metered_domain: bool) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        self.observe_sequence_selection(&scan.table, &scan.index, &prefix)?;
        self.event_read_unknown(&scan.table, &scan.index, &prefix, &scan.site);
        let page_expiry = self.next_expiry.scope();
        if let Some(message) = self.schema.maintain_for(&scan.table).and_then(|m| m.expiring_read_refusal(self.schema)) {
            return Err(RuntimeError::Structural { code: "E_MAINTAIN_READ_EXPIRE", message });
        }
        let aggregate_scope = self.next_expiry.scope();
        let aggregate_parent = self.aggregate_parent_prefix(scan, &prefix)?;
        if aggregate_parent == Some(false) { return Ok((Vec::new(), Vec::new())); }
        let aggregate_expiry = aggregate_scope.defer();
        let table = self.schema.table(&scan.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", scan.table)))?;
        let index = table.index(&scan.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", scan.table, scan.index)))?;
        let retained = if let Some(word) = word { word.retained } else { self.device && self.retained_group(&scan.table, &scan.index, &prefix)? };
        // Matching discovery already recorded these scope dependencies/coverage.
        // Borrow that verdict; do not reallocate identical sets for every word.
        if word.is_none() {
            self.read_tables.insert(scan.table.clone());
            self.rule_dependencies(&table.rules.read);
            self.aggregate_read_coverage(&scan.table, &scan.index, &prefix, &scan.site)?;
            if self.device && table.sync.is_none() { self.unknown_fact(&scan.table, &scan.index, &prefix, &scan.site); self.components.note(|frame| frame.speculative = true); }
        }
        if word.is_some_and(|w| w.metered) { self.meter.heap(word_heap::text(&scan.site))?; }
        self.meter.at(&scan.site);
        let dir = match scan.order {
            Order::Asc => Dir::Asc,
            Order::Desc => Dir::Desc,
        };
        let visibility = if word.is_some_and(|w| w.metered) { rules::Visibility { uniform: true, decided_true: true } }
            else { rules::scan_visibility(self.schema, scan) };
        if !visibility.uniform && !self.context.is_system() && self.schema.maintain_for(&scan.table).is_some_and(|m|m.row_key.is_some()) {
            return Err(RuntimeError::Structural { code: "E_VIEW_KEY", message: "pin the view's read audience or query by member (guide maintains)".into() });
        }
        let parent_pinned = table.through.as_ref().is_some_and(|t| index.columns().iter().take(prefix.len()).any(|f| f == &t.reference));
        let always_visible = aggregate_parent == Some(true) || !parent_pinned && (word.is_some_and(|word| word.admitted) || self.trust_synced_read(table) || self.context.is_system() || visibility.decided_true || table.rules.read.is_uniformly_readable());
        self.private_scan_authority(&scan.table, visibility.uniform, always_visible)?;
        let delivered = word.is_none() && self.reserve_delivered_scan(table, visibility, always_visible, true)?;
        // Stop only a device's logical admission cut; preauthorized server
        // and matching lanes retain their attempted-read charges.
        if delivered && self.read_capped() { return Ok((Vec::new(), Vec::new())); }
        // @ref LLP 3000.036#12 — a row-independent grant (a staff role, a
        // service seat) that holds for this caller makes every row readable:
        // the page is decided once, as a uniform page is. Its static probe
        // charge is paid on either verdict; an unproven grant walks as before.
        // @ref LLP 3000.036#16.3 — so does a disjunct the prefix pins (a parent
        // probe such as `exists boards[.board, owner = viewer]`), with its values.
        let mut grant_expiry = None;
        // @ref LLP 3000.036.001#3 — a branch merge's grant lane was admitted by its grant before it opened; one verdict, one charge.
        let lane_grant = self.merge_grant.take();
        let granted = if let Some(pending) = lane_grant { grant_expiry = Some(pending); !always_visible } else {
            !always_visible && !visibility.uniform && !parent_pinned && word.is_none() && aggregate_parent.is_none()
            && !self.device && !self.context.is_system()
            && match rules::page_guard_decision(self.schema, scan) {
                Some(rule) => {
                    let (allowed, pending) = self.grant_verdict(table, index, &prefix, &rule)?;
                    if allowed { grant_expiry = Some(pending); }
                    allowed
                }
                None => false,
            } };
        let always_visible = always_visible || granted;
        if !visibility.uniform && !always_visible && !(self.device && table.sync.is_some()) {
            self.non_uniform = true; self.components.note(|frame| frame.non_uniform = true);
        }
        let mut visible: Vec<Value> = Vec::new();
        let mut keys: Vec<Vec<u8>> = Vec::new();
        let mut last_rule_visible: Option<Vec<u8>> = None;
        let mut has_more = false;
        let mut capped = false;
        let mut filter_interrupted = false;
        let mut uniform_verdict: Option<bool> = if parent_pinned { word.map(|word| word.admitted) } else { always_visible.then_some(true) };
        let mut prefix_expiry = if let Some(pending) = grant_expiry { pending } else if aggregate_parent == Some(true) { aggregate_expiry } else { word.map_or_else(Default::default, |word| word.expiry) };
        // @ref LLP 3000.007#17 — an aborting page pass costs one examined unit before its verdict in every world; capped queries retain their cut contract.
        let aborting = self.meter.cut == crate::meter::Cut::Abort;
        if aborting && !self.read_charge(MeterKind::Examined, 1)? { return Ok((Vec::new(), Vec::new())); }
        let streaming_parent = aggregate.is_some();
        if !always_visible && word.is_none() && let Some(rule) = rules::prefix_decision(self.schema, scan) {
            let (allowed, pending) = self.prefix_verdict(&scan.table, table, index, &prefix, &rule, visibility.uniform)?;
            if !allowed && !(self.device && parent_pinned && !streaming_parent) { return Ok((Vec::new(), Vec::new())); }
            prefix_expiry = pending;
            if visibility.uniform { uniform_verdict = Some(allowed); }
        }
        // @ref LLP 3000.015#2 — reserve the complete page authorization tree
        // before discovering even one candidate, including ordinary int pages.
        let private_page = !visibility.uniform && !always_visible;
        let mut page_examined = private_page;
        let mut walk_remaining = AUTHORIZATION_WALK_LIMIT;
        if private_page {
            self.authorized_scan(&[
                (MeterKind::Examined, u64::from(!aborting)),
                (MeterKind::RuleProbes, rules::rule_probes(&table.rules.read).saturating_mul(take.saturating_add(1) as u64)),
            ], |_, _| Ok(()))?;
            if self.read_capped() { return Ok((Vec::new(), Vec::new())); }
        }
        let horizon = table.sync.as_ref().and_then(|sync| sync.horizon.as_ref());
        let by_boundary = self.device && !scan.existence && horizon.is_some_and(|horizon| horizon.by == scan.index) && dir == Dir::Desc;
        let boundary = if by_boundary { self.tx.acquired_boundary(&scan.table, &scan.index, &prefix)? } else { None };
        let mut crossed = false;
        let mut candidate_inside = false;
        // Internal timeline scans retain complete source rows, including arbitrary
        // application payload. Use the same pre-allocation ledger as word scans.
        // Ordinary jobs may hold an empty Purge grant; that is not a transition.
        let metered_payload = word.is_some_and(|w| w.metered) || self.view_scan_active
            || matches!(&self.timeline_authority, Some(super::timeline_authority::Authority::Transition(_)));
        // @ref LLP 3000.015#1 — reserve declared decode scratch, never actual private bytes.
        // Both adapters use the typed projection boundary before retention.
        let private_payload = table.written_by.values().any(|a| !a.audience);
        let streaming = aggregate.is_some();
        let transient = streaming || metered_domain;
        #[cfg(feature = "server-search")]
        let prepaid_head = !self.device && self.query_program && matches!(aggregate.as_deref(), Some(super::extrema::Aggregate::Keys { .. } | super::extrema::Aggregate::Head { .. }));
        // @ref LLP 3000.027#2 — a declared cursorless query needs no overflow row;
        // cursor positions, ordered merges, lane discovery and horizons still do.
        let stop_at_bound = !aborting && !scan.opaque_cursor && scan.merge_site.is_none() && word.is_none()
            && !self.discovering_values && !self.view_scan_active && !(self.device && horizon.is_some())
            && !transient && !job_page && scan.take != Bound::Meter;
        if metered_payload || transient { self.meter.heap(DisclosedBounds(&bounds).heap())?; }
        let mut cursor = bounds.clone();
        // One retained cursor/key allowance, outside the transient row scope.
        // Key payload sizes vary: only grow this reservation when a
        // larger key is encountered, before its decode or clone can allocate.
        let mut cursor_heap = 0;
        let batch = if transient || job_page { 1 } else if visibility.uniform || granted { take + 1 } else { (take + 1).max(32) };
        let mut row_heap = None;
        let mut row_bytes = 0;
        let mut consumed = 0;

        'outer: loop {
            if stop_at_bound && visible.len() == take { break; }
            let batch = if stop_at_bound { batch.min(take - visible.len()) } else { batch };
            if transient {
                if let Some(mark) = row_heap.take() { self.meter.release_row_heap(mark, row_bytes); }
                row_bytes = 0;
                if !self.read_charge(MeterKind::Steps, 1)? { break; }
                row_heap = Some(self.meter.mark());
            }
            // @ref LLP 3000.024#3 — the compact membership consumer reserves capacity for
            // the next examined candidate before accessing it; exhaustion probes
            // inside that reservation charge only a row that was actually found.
            #[cfg(feature = "server-search")]
            if prepaid_head && !private_page && !self.meter.room(MeterKind::Examined, 1) {
                self.read_charge(MeterKind::Examined, 1)?;
                capped = true;
                break;
            }
            let fetch_heap = self.meter.used.heap_bytes;
            // No adaptive lookahead, even for non-uniform rules. A later chunk
            // establishes exhaustion; every new candidate must first fit.
            let fetched = if private_page {
                self.authorized_candidate(scan, &prefix, &cursor, dir, &mut walk_remaining)?
            } else { self.scan_authorized(&scan.table, &scan.index, &prefix, &cursor, dir, batch, metered_payload || transient || job_page || private_payload, uniform_verdict == Some(true), #[cfg(feature = "server-search")] word.and_then(|word|word.selected.as_deref()))? };
            if private_page && (metered_payload || transient || job_page || private_payload) {
                self.meter.heap(word_heap::slots::<(Option<super::authorized_point::AuthorizedRow<'_>>, Vec<u8>)>(fetched.len()))?;
                for (row, key) in &fetched {
                    if let Some(row) = row { self.meter.heap(row.heap_bytes() + row.projection_heap() + row.materialization_heap()
                        + word_heap::key_decode(index.components.len() + 1, key.len()))?; }
                }
            }
            if self.view_scan_active && !private_payload { self.meter.heap(fetched.iter().filter_map(|(row,_)|row.as_ref()).map(|row|row.heap_bytes()).sum())?; }
            if transient { row_bytes = self.meter.used.heap_bytes - fetch_heap; }
            if fetched.is_empty() {
                break;
            }
            let fetched_len = fetched.len();
            for (row, key) in fetched {
                if let Some(crate::rows::AcquiredBoundary::Key(floor)) = &boundary {
                    if &key < floor { crossed = true; break 'outer; }
                    candidate_inside = true;
                }
                if !private_page && !self.read_charge(MeterKind::Examined, 1)? {
                    capped = true;
                    break 'outer;
                }
                let Some(row) = row else {
                    // A rejected candidate's continuation is internal scratch,
                    // never an actual-size caller charge or a published cursor.
                    cursor.after = self.authorized_scratch(crate::rows::disclosed::decode_reservation(table), &[], |_, _| {
                        Ok(crate::key::decode(&key).map(|v|v.into_iter().skip(prefix.len()).collect()))
                    })?;
                    continue;
                };
                // The previous cursor remains reserved while the new key is
                // decoded. Transient consumers release scratch with this row.
                if metered_payload || transient || job_page {
                    let scratch = word_heap::key_decode(index.components.len() + 1, key.len());
                    if transient {
                        let retained = scratch + word_heap::allocation(key.len());
                        if retained > cursor_heap { self.meter.heap(retained - cursor_heap)?; cursor_heap = retained; }
                    }
                    self.meter.heap(scratch)?;
                    if transient { row_bytes += scratch; }
                }
                cursor.after = Some(crate::key::decode(&key).unwrap_or_default().into_iter().skip(prefix.len()).collect());
                let materialized = if metered_payload || transient || job_page { row.materialization_heap() } else { 0 };
                if materialized > 0 { self.meter.heap(materialized)?; }
                let row_expiry = row.expiry();
                let (row, authority) = row.into_parts();
                if transient { row_bytes += materialized; }
                if self.expired(table, &row) {
                    // Gone, whatever the rule says; it cost one examined row.
                    continue;
                }
                if private_page {
                    if !page_examined && !self.read_charge(MeterKind::Examined, 1)? { capped = true; break 'outer; }
                    page_examined = false;
                }
                // A search's further terms: a row a lane found under its
                // first word still has to carry the rest.
                let unmatched = if let Some(word) = word.filter(|word| !word.terms.is_empty()) {
                    let texts = word.fields.iter().filter_map(|field| row.field(field).ok().and_then(|value| value.as_str().ok()));
                    let scratch = self.meter.mark();
                    let tokens = if metered_payload { word_heap::tokenize(&mut self.meter, texts)? } else { crate::words::row_tokens(texts) };
                    let unmatched = !crate::words::row_matches(&tokens, &word.terms);
                    drop(tokens);
                    if transient { self.meter.release_heap(scratch); }
                    unmatched
                } else { false };
                if unmatched {
                    continue;
                }
                // @ref LLP 3000.028#3.3 — the online device lane contains only certified Left scopes.
                if self.context.retained_search && !self.tx.search_retained_row(&scan.table, &row)? { continue; }
                let kept_history = self.device && parent_pinned && self.retained_row(&scan.table, &row)?;
                if kept_history && streaming { continue; }
                if self.device && parent_pinned && !kept_history && uniform_verdict == Some(false) { continue; }
                let mut row = row;
                if kept_history {
                    self.beyond_horizon = true;
                    self.components.note(|frame| { frame.beyond = true; frame.retained = true; });
                    if let Value::Row(fields) = &mut row { fields.mark_retained(); }
                }
                // @ref LLP 3000.014#5 — a candidate's deadline is provisional until the page emits it.
                let candidate_expiry = self.next_expiry.scope();
                self.next_expiry.inherit(if kept_history { Default::default() } else { prefix_expiry });
                self.next_expiry.inherit(row_expiry);
                if self.read_capped() {
                    capped = true;
                    break 'outer;
                }
                {
                    self.note_expiry(table, &row);
                    let live_row = self.live_aggregate(&scan.table, row)?;
                    // @ref LLP 3000.007#20.21 — a cut aggregate is unavailable, not a
                    // partial contribution presented as a total. The push that used to
                    // happen here matched maintained point reads, which now refuse
                    // under a cap rather than answer with an unfinished value.
                    if self.read_capped() {
                        capped = true;
                        break 'outer;
                    }
                    let Some(row) = live_row else { continue; };
                    let disclosed = authority.project(self.disclosed_row(table,row).for_query());
                    let disclosed_bytes = disclosed.heap_bytes();
                    let mut row = super::recorded::public_image(table, self.sequence_read_result(&scan.table, disclosed.into_value())?);
                    self.stamp_source(&scan.table, &mut row)?;
                    let pending = candidate_expiry.defer();
                    if metered_payload || transient || job_page {
                        let scratch = word_heap::allocation(key.len());
                        self.meter.heap(scratch)?;
                        if transient { row_bytes += scratch; }
                    }
                    last_rule_visible = Some(key.clone());
                    if let Some(filter) = &scan.filter {
                        // @ref LLP 3000.014#5 — completed predicate answers belong to the page even when they reject this candidate.
                        let filter_expiry = self.next_expiry.scope();
                        let filter_slot = if metered_payload { word_heap::text("$filter") + word_heap::insertion::<String, Value>(self.env.len()) } else { 0 };
                        self.meter.heap(filter_slot)?;
                        let filter_mark = self.meter.mark();
                        let prior = self.env.insert("$filter".into(), row.clone());
                        // @ref LLP 3000.007#20.22 — predicate reads are below the page; restore depth even when evaluating one fails.
                        let page_depth = self.page_depth;
                        self.page_depth += 1;
                        self.filter_depth += 1;
                        let matched = self.expr(filter);
                        self.filter_depth -= 1;
                        self.page_depth = page_depth;
                        match prior { Some(value) => { self.env.insert("$filter".into(), value); }, None => { self.env.remove("$filter"); } }
                        if transient { self.meter.release_row_heap(filter_mark, filter_slot); }
                        if metered_payload { self.meter.heap(word_heap::text(&scan.site))?; }
                        self.meter.at(&scan.site);
                        if self.read_capped() && (matched.is_ok() || matches!(&matched, Err(RuntimeError::Bound { kind, .. }) if *kind != MeterKind::HeapBytes)) {
                            capped = true;
                            // @ref LLP 3000.007#20.24.1 — a cut is an unfinished
                            // verdict for every predicate, never a rejection.
                            filter_interrupted = true;
                            break 'outer;
                        }
                        let matched = matched?.as_bool()?;
                        filter_expiry.emit();
                        if !matched { continue; }
                    }
                    let row_expiry = self.next_expiry.scope();
                    if let Some(aggregate) = &mut aggregate {
                        if matches!(aggregate, super::extrema::Aggregate::Extremum { projection: None, .. }) {
                            // Decoding, authorization and filtering are finished.
                            // Transfer row scratch to the selected payload's
                            // reservation before the fold admits its winner.
                            // Sum projections still need their source row live.
                            drop(key);
                            if let Some(mark) = row_heap.take() { self.meter.release_row_heap(mark, row_bytes); }
                            row_bytes = 0;
                        }
                        let done = aggregate.push(self, &row)?;
                        consumed += 1;
                        self.next_expiry.inherit(pending);
                        row_expiry.emit();
                        if done || (scan.existence && consumed == take) { break 'outer; }
                        continue;
                    }
                    if visible.len() == take {
                        has_more = true;
                        break 'outer;
                    }
                    if metered_domain {
                        // Decoding is finished: replace its scratch allowance
                        // with the retained image before fetching another row.
                        // Domains consume only rows; the live cursor is already
                        // reserved and no unused result keys need to be kept.
                        drop(key);
                        if let Some(mark) = row_heap.take() { self.meter.release_row_heap(mark, row_bytes); }
                        row_bytes = 0;
                        self.meter.heap(disclosed_bytes)?;
                        word_heap::push(&mut self.meter, &mut visible, row)?;
                    } else if metered_payload {
                        // Charge retention of a store-provided row and the emitted raw key
                        // before either output vector grows; moves do not copy row bodies.
                        self.meter.heap(word_heap::allocation(key.len()))?;
                        word_heap::push(&mut self.meter, &mut visible, row)?;
                        word_heap::push(&mut self.meter, &mut keys, key.clone())?;
                    } else {
                        visible.push(row);
                        keys.push(key.clone());
                    }
                    self.next_expiry.inherit(pending);
                    row_expiry.emit();
                    if (scan.existence || job_page || stop_at_bound) && visible.len() == take { break 'outer; }
                    if scan.filter.is_some() && visible.len() == take { has_more = true; break 'outer; }
                }
            }
            if !private_page && fetched_len < batch {
                break;
            }
        }
        if let Some(mark) = row_heap { self.meter.release_row_heap(mark, row_bytes); }
        // @ref LLP 3000.036.001#6 — a branch lane cut mid-read reports how far it examined (rule-visible rows only).
        if let Some((table, index, frontier)) = &mut self.scan_frontier && *table == scan.table && *index == scan.index {
            *frontier = last_rule_visible.clone().or_else(|| keys.last().cloned());
        }
        // @ref LLP 3000.007#20.22 — a device page is complete by its acquisition boundary, carried on the wire, not by a count.
        // An existence probe is exempt (W13c): a held witness below the floor still proves existence.
        if self.device && !scan.existence && horizon.is_some() {
            let known = if by_boundary {
                match &boundary {
                    Some(crate::rows::AcquiredBoundary::Whole) => true,
                    Some(crate::rows::AcquiredBoundary::Key(floor)) => {
                        // @ref LLP 3000.016#2.2 — a meter cut uses its actual candidate position, not the unvisited range end.
                        let stops_inside = visible.len() == take && keys.last().is_some_and(|key| key >= floor);
                        let cut_inside = capped && candidate_inside && !crossed;
                        let range_inside = crate::rows::scan_range(&prefix, &bounds, dir).is_none_or(|(lo, _)| lo >= *floor);
                        stops_inside || cut_inside || (!crossed && range_inside)
                    }
                    None => false,
                }
            } else { false };
            if !known { self.horizon_coverage(scan, &prefix, retained); }
            // A full boundary page must continue so the next request can fall
            // back. Lookahead cannot prove the end below a partial acquisition.
            if by_boundary && visible.len() == take && let Some(crate::rows::AcquiredBoundary::Key(floor)) = &boundary {
                if crate::rows::scan_range(&prefix, &bounds, dir).is_some_and(|(lo, _)| lo < *floor) { has_more = true; }
            }
        }
        self.note_value_source_page(has_more);
        // @ref LLP 3000.027#1 — reaching the declared top-N bound completes a cursorless answer.
        if self.page_depth == 0 && scan.opaque_cursor {
            let components = index.components.len();
            // @ref LLP 3000.007#5.6 — a full page positions after its last result; a cut may pass filter rejects, never rule-hidden keys.
            let position = if visible.len() == take { keys.last() } else { last_rule_visible.as_ref().or_else(|| keys.last()) };
            // A full page resumes after its last emission, even if lookahead's
            // predicate was interrupted; only a short page retries that row.
            let inclusive = filter_interrupted && visible.len() < take;
            let continues = if capped || self.non_uniform || self.word_cut_at.is_some() { position.is_some() } else { has_more };
            let mut next = if continues { position.and_then(|key| crate::key::decode(key)).map(|values| values.into_iter().take(components).skip(prefix.len()).collect()) } else { None };
            // @ref LLP 3000.007#20.24.1 — retry an interrupted predicate once; no emission at the same inclusive input position must not advertise a loop.
            if inclusive && visible.is_empty() && next.is_some() && next == bounds.at_or_after { next = None; }
            self.record_page(scan.site.clone(), PagePosition { variant: scan.variant, view_suffix: None, table: scan.table.clone(), index: scan.index.clone(), order: scan.order, prefix_len: prefix.len(), prefix: (scan.merge_site.is_none() && word.is_none()).then(|| prefix.clone()), merge: scan.merge_site.is_some() || word.is_some(), interrupted: false, inclusive, shape_positions: Vec::new(), shape_resume: super::shaping::Resume::Never, next }, visible.iter())?;
        }
        page_expiry.emit();
        Ok((visible, keys))
    }

    // @ref LLP 3000.007#19.2 — loss is monotone across executions; only the last execution at an owned site carries next.
    fn record_page<'row>(&mut self, site: String, mut page: PagePosition, rows: impl Iterator<Item = &'row Value>) -> Result<(), RuntimeError> {
        self.record_shape_positions(&site, &mut page, rows)?;
        if let Some(previous) = self.pages.insert(site, page) {
            self.discarded_page_loss |= previous.interrupted || previous.next.is_some();
        }
        Ok(())
    }

    /// Check every page: another result field's owner cannot carry this one's
    /// continuation. A consumed, exhausted page needs no owner, at any size.
    pub(super) fn page_position_lost(&self) -> bool {
        self.discarded_page_loss || self.pages.iter().any(|(site, page)| page.interrupted || (page.next.is_some() && self.page_owner.as_ref() != Some(site)))
    }

    fn record_shape_cursor(&mut self, site: &str, token: Option<String>) {
        if self.page_depth != 0 || !self.page_plan.shapes.values().any(|shape| shape.page == site) { return; }
        // Retain the already evaluated token, without evaluating its expression
        // again or confusing an unused cursor argument with the page's input.
        if let Some(token) = token { self.shape_cursors.insert(site.to_owned(), token); }
        else { self.shape_cursors.remove(site); }
    }

    pub(super) fn outcome_next_cursor(&self) -> Result<Option<String>, RuntimeError> {
        // @ref LLP 3000.007.000#3 — publish merge candidates using the final answer's class, without deleting raw position-loss evidence.
        if self.value_source_incomplete { return Ok(None); }
        if self.non_uniform && self.page.as_ref().is_some_and(|page| page.merge) { return Ok(None); }
        let next = self.next_cursor()?;
        // @ref LLP 3000.007#14 — ruling 35: a follow that cannot progress refuses
        if let (Some(token), Some(page), Some(owner), Some((kind, site))) = (&next, &self.page, &self.page_owner, &self.meter.capped_at)
            && page.inclusive && self.shape_cursors.get(owner) == Some(token)
            && let Some((_, position)) = self.shape_positions.iter().find(|(shape, position)| position.rows == 0 && self.page_plan.shapes.get(*shape).is_some_and(|shape| shape.page == *owner)) {
            // Zero fully shaped rows means the returned page is empty. Canonical
            // token equality also binds inclusivity, descriptor, scope and position.
            let (verb, ceiling, unit) = match kind {
                MeterKind::Examined => ("examines", self.meter.ceilings.examined, "row"),
                MeterKind::IndexEntries => ("visits", self.meter.ceilings.index_entries, "index-entry"),
                MeterKind::RuleProbes => ("uses", self.meter.ceilings.rule_probes, "rule-probe"),
                MeterKind::Steps => ("uses", self.meter.ceilings.steps, "step"),
                MeterKind::HeapBytes => ("uses", self.meter.ceilings.heap_bytes, "heap-byte"),
                MeterKind::OutputBytes => ("uses", self.meter.ceilings.output_bytes, "output-byte"),
                MeterKind::RowsWritten => ("writes", self.meter.ceilings.rows_written, "written-row"),
            };
            let mut ceiling = ceiling.to_string();
            let digits = ceiling.len();
            for i in (1..digits).rev() { if (digits - i) % 3 == 0 { ceiling.insert(i, ','); } }
            // A cap inherited by this shape names its source read, not the
            // unrelated first exhaustion site retained by the meter.
            let message = if position.inherited_cap {
                format!("the returned shape at {owner} cannot finish: the {ceiling}-{unit} meter was spent at {site} before it ran; bound that read (`first N`/`last N`) or move the shape out of the returned shape")
            } else {
                format!("the returned shape at {site} {verb} more than the {ceiling}-{unit} meter on its own; bound it (`first N`/`last N`) or move it out of the returned shape")
            };
            return Err(RuntimeError::Structural { code: "E_SHAPE_EXCEEDS_METER", message });
        }
        Ok(next)
    }

    /// Encode the raw candidate; loss accounting never uses publication eligibility.
    pub(super) fn next_cursor(&self) -> Result<Option<String>, RuntimeError> {
        let Some(page) = &self.page else { return Ok(None) };
        let Some(values) = &page.next else { return Ok(None) };
        let suffix = if let Some(suffix) = &page.view_suffix { suffix.clone() } else {
            let table = self.schema.table(&page.table).expect("scanned table");
            let index = table.index(&page.index).expect("scanned index");
            if page.merge { Self::merge_suffix(table, index, page.prefix_len) } else { Self::cursor_suffix(table, index, page.prefix_len) }
        };
        encode_cursor(self.schema, &CursorPosition { table: page.table.clone(), index: page.index.clone(), order: page.order, suffix, values: values.clone(), inclusive: page.inclusive, scope: (page.prefix.is_some() || page.variant.is_some()).then(|| CursorScope { variant: page.variant, generation: self.context.generation, prefix: page.prefix.clone().unwrap_or_default() }) })
            .map(Some)
            .map_err(|error| RuntimeError::Input(format!("cursor: {error}")))
    }

    /// Merge ordered lanes into a page. Seekable uniform lanes use a heap
    /// of heads. Other lanes retain their page scan and stable union sort.
    pub(super) fn merge(&mut self, merge: &Merge, charge: impl FnOnce(&mut Self, &[Value]) -> Result<(), RuntimeError>) -> Result<Vec<Value>, RuntimeError> {
        let expiry = self.next_expiry.scope();
        #[cfg(feature = "server-search")]
        if !self.device && self.query_program && crate::search_plan::eligible(self.schema, merge) {
            let rows = self.merge_memberships(merge, charge)?;
            expiry.emit();
            return Ok(rows);
        }
        let rows = self.merge_with_words(merge, None)?;
        charge(self, &rows)?;
        expiry.emit();
        Ok(rows)
    }

    fn merge_with_words(&mut self, merge: &Merge, word: Option<&WordRead>) -> Result<Vec<Value>, RuntimeError> {
        if merge.view.is_some() { return self.merge_view(merge); }
        if merge.branches() && rules::branch_merge_lazy(self.schema, merge) { return self.merge_branches(merge); }
        // Keep the disclosure-sensitive non-uniform scan traversal unchanged.
        // @ref LLP 3000#7-decisions-during-execution — lazy uniform merge lanes
        if !merge.branches() && rules::lazy_merge(self.schema, merge) {
            return self.merge_lazy(Some(merge), None);
        }
        let Some(first) = merge.lanes.first() else { return Ok(Vec::new()) };
        let table = self.schema.table(&first.scan.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", first.scan.table)))?;
        let index = table.index(&first.scan.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", first.scan.table, first.scan.index)))?;
        let order = first.scan.order;
        let take = self.take(&first.scan.take)?;
        let prefix_len = first.scan.prefix.len();
        let suffix = Self::merge_suffix(table, index, prefix_len);
        let suffix_len = suffix.len();
        // @ref LLP 3000.007.000#1 — the merge position: every valued component after the prefix (a computed calendar key evaluates on the row), plus the stored row id when the suffix lacks it.
        let merge_key = move |row: &Value| -> Vec<Value> {
            let mut key: Vec<Value> = index.components.iter().skip(prefix_len).filter_map(|component| component.value(row)).collect();
            if key.len() < suffix_len { key.push(row.field("id").cloned().unwrap_or(Value::Null)); }
            key
        };
        // A merge's cursor names the merge's own scope; it is checked before
        // lane discovery so an empty discovery cannot admit a foreign token.
        self.record_shape_cursor(&merge.site, None);
        // @ref LLP 3000.036.001#3 — a branch merge outside the lazy path keeps its branch-set descriptor.
        let (descriptor, view_suffix) = if merge.branches() { (merge.branch_descriptor(), Some(suffix.clone())) } else { (first.scan.index.clone(), None) };
        // A branch merge's token is scoped to every lane's pins, as on its lazy path.
        let branch_scope = if merge.branches() {
            Some(branch_merge::branch_scope(&merge.lanes.iter().map(|lane| self.prefix_values(&lane.scan)).collect::<Result<Vec<_>, _>>()?)?)
        } else { None };
        if first.scan.opaque_cursor
            && let Some(after) = first.scan.after.as_deref()
            && let Value::String(token) = self.expr(after)?
        {
            let position = decode_cursor(self.schema, &token).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
            crate::cursor::check_variant(&position, merge.variant)?;
            if let Err(error) = position.check_descriptor(&first.scan.table, &descriptor, order, &suffix) {
                // As the lazy branch merge does: another plan's token of this table restarts the read.
                if merge.branches() && position.table == first.scan.table {
                    return Err(RuntimeError::Structural { code: "E_CURSOR_INDEX", message: "cursor belongs to another plan of this read; it now merges its branches: restart this read with a null cursor".into() });
                }
                return Err(RuntimeError::Input(format!("cursor: {error}")));
            }
            if let Some(scope) = &branch_scope
                && !position.scope.as_ref().is_some_and(|s| s.generation == self.context.generation && &s.prefix == scope) {
                return Err(RuntimeError::Input(format!("cursor: {}", crate::cursor::CursorError::Scope)));
            }
            self.record_shape_cursor(&merge.site, Some(token));
        }
        let mut candidates: Vec<(Vec<Value>, Value)> = Vec::new();
        let mut seen = BTreeSet::new();
        let outer_depth = self.page_depth;
        for lane in &merge.lanes {
            self.page_depth += 1;
            let sources = self.lane_values(lane)?;
            self.page_depth -= 1;
            for source_row in sources {
                if !self.charge_lane(lane, &merge.site)? { break; }
                if lane.source.is_some() {
                    self.env.insert(lane.binding.clone(), source_row);
                }
                self.statements(&lane.setup, &merge.site)?;
                self.page_depth += 1;
                // Pages look ahead; existence needs only its first witness.
                let mut lane_scan = lane.scan.clone();
                // @ref LLP 3000.007#20.3 — translate a validated shared position to each table/index with the same ordered suffix.
                if (merge.branches() || lane_scan.table != first.scan.table || lane_scan.index != first.scan.index) && lane_scan.opaque_cursor
                    && let Some(after) = lane_scan.after.as_deref()
                    && let Value::String(token) = self.expr(after)?
                {
                    let mut position = crate::cursor::decode_cursor(self.schema, &token).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
                    let table = &self.schema.tables[&lane_scan.table];
                    let suffix = Self::merge_suffix(table, &table.indexes[&lane_scan.index], lane_scan.prefix.len());
                    if position.suffix != suffix { return Err(RuntimeError::Schema("merge lanes need the same ordered cursor suffix".into())); }
                    position.table = lane_scan.table.clone();
                    position.index = lane_scan.index.clone();
                    let token = crate::cursor::encode_cursor(self.schema, &position).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
                    lane_scan.after = Some(Box::new(Expr::Literal(Value::String(token))));
                }
                // @ref LLP 3000.007#20.22.4 — a matching existence scan stops at its first witness, without lookahead or later word lanes.
                lane_scan.take = Bound::Literal(if lane_scan.existence { 1 } else { take as u32 + 1 });
                let (rows, _) = self.scan_with_words(&lane_scan, word)?;
                self.page_depth = outer_depth;
                if lane_scan.existence && !rows.is_empty() { return Ok(rows); }
                for row in rows {
                    let id = row.field("id")?.as_str()?.to_owned();
                    if !seen.insert(id) {
                        continue;
                    }
                    let key: Vec<Value> = merge_key(&row);
                    candidates.push((key, row));
                }
            }
        }
        self.meter.step(candidates.len() as u64)?;
        candidates.sort_by(|(a, _), (b, _)| {
            let ordering = a.iter().zip(b).find_map(|(x, y)| match x.total_cmp(y) {
                Ordering::Equal => None,
                other => Some(other),
            }).unwrap_or(Ordering::Equal);
            match order {
                Order::Asc => ordering,
                Order::Desc => ordering.reverse(),
            }
        });
        let has_more = candidates.len() > take;
        self.note_value_source_page(has_more);
        candidates.truncate(take);
        if self.page_depth == 0 && first.scan.opaque_cursor {
            let continues = has_more && self.meter.capped_at.is_none() && self.word_cut_at.is_none();
            let next = if continues { candidates.last().map(|(key, _)| key.clone()) } else { None };
            self.record_page(merge.site.clone(), PagePosition { variant: merge.variant, view_suffix, table: first.scan.table.clone(), index: descriptor, order, prefix_len, prefix: branch_scope, merge: true, interrupted: false, inclusive: false, shape_positions: Vec::new(), shape_resume: super::shaping::Resume::Never, next }, candidates.iter().map(|(_, row)| row))?;
        }
        Ok(candidates.into_iter().map(|(_, row)| row).collect())
    }

    fn lane_values(&mut self, lane: &MergeLane) -> Result<Box<dyn Iterator<Item = Value>>, RuntimeError> {
        let prior_discovery = self.discovering_values;
        self.discovering_values |= lane.distinct.is_some();
        let values = (|| -> Result<Box<dyn Iterator<Item = Value>>, RuntimeError> {
            Ok(match &lane.source {
                Some(LaneSource::Scan(scan)) => Box::new(self.scan(scan)?.into_iter()),
                Some(source) => self.domain(&source.domain())?,
                None => Box::new(std::iter::once(Value::Null)),
            })
        })();
        self.discovering_values = prior_discovery;
        if lane.distinct.is_some() && (self.read_capped() || self.page_overflow || self.beyond_horizon || self.presence_unknown) {
            self.value_source_incomplete = true;
        }
        let values = values?;
        let Some(distinct) = &lane.distinct else { return Ok(values); };
        let prior = self.env.get(&lane.binding).cloned();
        let mut seen = BTreeSet::new();
        let mut unique = Vec::new();
        for value in values {
            if !self.read_charge(MeterKind::Steps, 1)? { break; }
            self.env.insert(lane.binding.clone(), value.clone());
            let key = self.expr(distinct)?;
            if key == Value::Null { continue; }
            let key = canonical_json(&key);
            self.meter.heap(key.len() as u64 + 64)?;
            if seen.insert(key) { self.meter.heap(self.environment_value_heap(&lane.binding) + std::mem::size_of::<Value>() as u64)?; unique.push(value); }
        }
        if let Some(prior) = prior { self.env.insert(lane.binding.clone(), prior); } else { self.env.remove(&lane.binding); }
        Ok(Box::new(unique.into_iter()))
    }

    // @ref LLP 3000.027#2 — discovery must still establish every required lane.
    pub(super) fn note_value_source_page(&mut self, has_more: bool) {
        if self.discovering_values && has_more {
            self.value_source_incomplete = true;
            self.page_overflow = true;
            self.components.note(|frame| frame.overflow = true);
        }
    }

    fn charge_lane(&mut self, lane: &MergeLane, site: &str) -> Result<bool, RuntimeError> {
        if matches!(lane.source, Some(LaneSource::Range { .. } | LaneSource::List { .. })) {
            self.meter.at(site);
            // Range/list iteration allocates no source rows. Its steps and
            // retained lane descriptors are metered even for empty lanes.
            if self.read_capped() { return Ok(false); }
            return self.read_charge(MeterKind::Steps, 1);
        }
        Ok(true)
    }

}

pub(super) struct PrefixProbe<'a, 'b> { pub(super) runner: &'a mut Runner<'b>, pub(super) allowance: &'a Authorization }
impl Probe for PrefixProbe<'_, '_> {
    fn take_changes(&mut self) -> Option<Vec<(i64, super::rules::Verdict)>> { self.runner.witness_changes.take() }
    fn replace_expiry(&mut self, expiry: Option<i64>) -> Option<i64> { self.runner.next_expiry.replace(expiry) }
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        self.runner.rule_probe_exists(self.allowance, table, index, key, equalities)
    }
    fn created(&mut self, table: &str, index: &str, key: &[Value]) -> bool { self.runner.created(table, index, key) }
}

#[cfg(all(test, feature = "sqlite"))]
#[path = "../../tests/read_verdict/mod.rs"]
mod read_verdict_tests;

impl PagePosition {
    pub(super) fn shape_keys_heap(&self) -> u64 {
        self.shape_positions.capacity() as u64 * std::mem::size_of::<Vec<Value>>() as u64
            + self.shape_positions.iter().map(|key| key.capacity() as u64 * std::mem::size_of::<Value>() as u64 + key.iter().map(|v|DisclosedKey(v).copy_heap()).sum::<u64>()).sum::<u64>()
    }
}
