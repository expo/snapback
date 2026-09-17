//! Reads: point lookups, bounded scans with the read rule hoisted where the
//! prefix decides it, opaque cursors, and merges of ordered lanes. Every
//! candidate row is charged to the meter; a query cut by the meter returns
//! what it found and is `capped` (LLP 2000.000 §6).

use super::rules::{self, Probe};
use super::runner::{PagePosition, Runner};
use crate::cursor::{CursorColumn, CursorPosition, CursorScope, decode_cursor, decode_cursor_for, encode_cursor};
use crate::error::{MeterKind, RuntimeError};
use crate::ir::*;
use crate::schema::{Effect, Index, Table, materialize_optional_fields};
use crate::rows::{Bounds, Dir};
use crate::value::{Value, canonical_json};
use std::cmp::Ordering;
use std::collections::{BTreeSet, BinaryHeap, VecDeque};

// @ref LLP 3000.007#18.1 — search state belongs to the generated word merge's direct lanes, never to an expression nested inside one.
struct WordRead {
    admitted: bool,
    fields: Vec<String>,
    terms: Vec<String>,
}

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

impl Probe for Runner<'_> {
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        if !self.meter.charge(MeterKind::RuleProbes, 1)? {
            // Cut: no lookup and no verdict; the site stops on `capped_at`.
            return Ok(false);
        }
        self.rule_probe_exists(table, index, key, equalities)
    }

    fn created(&mut self, table: &str, index: &str, key: &[Value]) -> bool {
        self.created.contains_key(&(table.to_owned(), index.to_owned(), canonical_json(&key)))
    }
}

impl Runner<'_> {
    // @ref LLP 3000.007#17 — the dependency envelope is schema-derived too; short-circuit probes cannot disclose a hidden answer through tables.
    fn rule_dependencies(&mut self, rule: &crate::schema::RuleExpr) {
        let mut sites = Vec::new();
        rules::probe_sites(rule, &mut sites);
        for (table, _) in sites {
            if let Some(maintain) = self.schema.maintain_for(&table)
                && self.schema.table(&maintain.source).is_some_and(|source| source.expire.is_some()) {
                self.read_tables.insert(maintain.source.clone());
            }
            self.read_tables.insert(table);
        }
    }

    fn prefix_verdict(&mut self, table: &Table, index: &Index, prefix: &[Value], rule: &crate::schema::RuleExpr, uniform: bool) -> Result<bool, RuntimeError> {
        let probe_row = Value::Row(index.components.iter().zip(prefix).filter_map(|(part, value)| part.column().map(|name| (name.clone(), value.clone()))).collect::<crate::smallmap::SmallMap<_, _>>().into());
        let viewer = self.context.viewer.clone();
        let expiry = self.next_expiry;
        let verdict = rules::evaluate(rule, &viewer, None, &probe_row, false, &mut PrefixProbe { runner: self });
        // Partial admission says nothing about any returned row's lifetime.
        if !uniform || !matches!(verdict, Ok(true)) { self.next_expiry = expiry; }
        let verdict = verdict?;
        // A partial conjunction denial costs the same static allowance as a uniform denial.
        Ok(self.meter.charge(MeterKind::RuleProbes, rules::rule_probes(&table.rules.read))? && verdict)
    }

    // @ref LLP 3000.007#20.9 — coverage applies before a missing candidate or empty page can return zero/complete.
    fn aggregate_read_coverage(&mut self, table: &str, index: &str, key: &[Value], site: &str) {
        if !self.device { return; }
        let Some(maintain) = self.schema.maintain_for(table) else { return };
        let source = &self.schema.tables[&maintain.source];
        if self.schema.maintain_subset_unknown(table) || (source.expire.is_some() && source.sync.as_ref().is_none_or(|sync| sync.horizon.is_some())) {
            self.read_tables.insert(maintain.source.clone());
            self.unknown_fact(table, index, key, site);
        }
    }

    fn horizon_coverage(&mut self, scan: &Scan, prefix: &[Value], retained: bool) {
        if retained { self.beyond_horizon = true; }
        else { self.unknown_fact(&scan.table, &scan.index, prefix, &scan.site); }
    }

    // @ref LLP 3000.007#17 — one rule probe, regardless of expired siblings or an expiring maintain's sources.
    fn rule_probe_exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        self.aggregate_read_coverage(table, index, key, "rule probe");
        let definition = self.schema.table(table).ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?;
        let index_def = definition.index(index).ok_or_else(|| RuntimeError::Schema(format!("missing index {table}.{index}")))?;
        self.read_tables.insert(table.to_owned());
        let found = self.lookup_live(table, index, index_def, key, false)?;
        let mut live = found.is_some();
        if let Some(row) = &found {
            self.note_expiry(definition, row);
            if let Some(maintain) = self.schema.maintain_for(table)
                && let Some(source) = self.schema.table(&maintain.source).filter(|source| source.expire.is_some()) {
                self.read_tables.insert(maintain.source.clone());
                let group = crate::schema::maintained_key(row, &maintain.by);
                let (name, prefix) = maintain.source_scan(source, &group);
                if self.device && source.sync.as_ref().is_none_or(|sync| sync.horizon.is_some()) { self.unknown_fact(&maintain.source, name, &prefix, "rule probe"); }
                let mut bounds = Bounds::default();
                live = false;
                'sources: loop {
                    let rows = self.tx.scan(&maintain.source, name, &prefix, &bounds, Dir::Asc, 32)?;
                    let count = rows.len();
                    for (candidate, stored) in rows {
                        let candidate = crate::schema::row_image(&candidate, source);
                        bounds.after = crate::key::decode(&stored).map(|v| v.into_iter().skip(prefix.len()).collect());
                        if !self.expired(source, &candidate) && maintain.selected(&candidate) && maintain.source_key(&candidate) == group {
                            self.note_expiry(source, &candidate);
                            live = true;
                            break 'sources;
                        }
                    }
                    if count < 32 { break; }
                }
            }
        }
        if self.device && (definition.sync.is_none() || (!live && definition.sync.as_ref().is_some_and(|s| s.horizon.is_some()))) { self.unknown_fact(table, index, key, "rule probe"); }
        // @ref LLP 3000.007#10 — the total unique probe reads once, then tests the remaining named equalities.
        Ok(live && found.as_ref().is_some_and(|row| equalities.iter().all(|(column, value)| row.field(column).unwrap_or(&Value::Null) == value)))
    }

    /// Point lookups must pass expired siblings, even on an index whose
    /// logical uniqueness no longer counts those rows.
    pub(super) fn live_lookup(&mut self, table_name: &str, name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        self.lookup_live(table_name, name, index, key, true)
    }

    pub(super) fn lookup_live(&mut self, table_name: &str, name: &str, index: &Index, key: &[Value], charge: bool) -> Result<Option<Value>, RuntimeError> {
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        if table.expire.is_none() {
            return self.tx.lookup(table_name, name, index, key).map(|found| found.map(|mut row| { materialize_optional_fields(&mut row, table); row }));
        }
        let mut bounds = Bounds::default();
        loop {
            let rows = self.tx.scan(table_name, name, key, &bounds, Dir::Asc, 32)?;
            let count = rows.len();
            for (mut row, stored) in rows {
                materialize_optional_fields(&mut row, table);
                if charge && !self.meter.charge(MeterKind::Examined, 1)? { return Ok(None); }
                bounds.after = crate::key::decode(&stored).map(|values| values.into_iter().skip(key.len()).collect());
                if !self.expired(table, &row) { return Ok(Some(row)); }
            }
            if count < 32 { return Ok(None); }
        }
    }

    /// A maintain over expiring source rows is a live fact before the
    /// physical sweep catches up. Recompute only that fact's group, with
    /// the usual runtime meter and device coverage rules.
    pub(crate) fn live_aggregate(&mut self, table_name: &str, row: Value) -> Result<Option<Value>, RuntimeError> {
        let Some(maintain) = self.schema.maintain_for(table_name).cloned() else { return Ok(Some(row)); };
        let source = self.schema.table(&maintain.source).ok_or_else(|| RuntimeError::Schema("missing maintain source".into()))?;
        if source.expire.is_none() { return Ok(Some(row)); }
        let bytes = super::write_target::row_copy_ceiling(source).saturating_mul(32)
            .saturating_add(super::write_target::row_copy_ceiling(&self.schema.tables[table_name]).saturating_mul(16));
        self.maintain_scratch(bytes, |runner| runner.live_aggregate_inner(&maintain, row))
    }

    fn live_aggregate_inner(&mut self, maintain: &crate::schema::Maintain, row: Value) -> Result<Option<Value>, RuntimeError> {
        let source = &self.schema.tables[&maintain.source];
        self.read_tables.insert(maintain.source.clone());
        let group = crate::schema::maintained_key(&row, &maintain.by);
        let (index, prefix) = maintain.source_scan(source, &group);
        if self.device && source.sync.as_ref().is_none_or(|sync| sync.horizon.is_some()) {
            self.unknown_fact(&maintain.source, index, &prefix, "live aggregate");
        }
        let mut bounds = Bounds::default();
        let mut total = 0_i128;
        let mut any = false;
        'sources: loop {
            let rows = self.tx.scan(&maintain.source, index, &prefix, &bounds, Dir::Asc, 32)?;
            let count = rows.len();
            for (mut candidate, key) in rows {
                materialize_optional_fields(&mut candidate, source);
                if !self.meter.charge(MeterKind::Examined, 1)? { break 'sources; }
                bounds.after = crate::key::decode(&key).map(|values| values.into_iter().skip(prefix.len()).collect());
                if !self.meter.charge(MeterKind::Steps, maintain.evaluation_steps())? { break 'sources; }
                if self.expired(source, &candidate) || !maintain.selected(&candidate) || maintain.source_key(&candidate) != group { continue; }
                any = true;
                self.note_expiry(source, &candidate);
                total += match &maintain.kind { crate::schema::MaintainKind::Count => 1, crate::schema::MaintainKind::Sum { of } => i128::from(candidate.field(of)?.as_int()?) };
            }
            if count < 32 { break; }
        }
        if !any { return Ok(None); }
        if !(crate::value::I53_MIN as i128..=crate::value::I53_MAX as i128).contains(&total) {
            return Err(super::maintains::aggregate_overflow(&maintain));
        }
        let mut fields = row.as_object()?.clone();
        fields.insert("value".into(), Value::Int(total as i64));
        Ok(Some(Value::Row(fields.into())))
    }

    /// Whether a row is past its table's `expire` column at this run's
    /// clock. Expired is absent: to every reader, on every host, before
    /// any rule (the sweep makes it physical). The system sees no more
    /// than anyone: an expired row contributes to nothing.
    pub(super) fn expired(&self, table: &Table, row: &Value) -> bool {
        self.context.now.is_some_and(|now| table.expired(row, now))
    }

    fn note_expiry(&mut self, table: &Table, row: &Value) {
        if let Some(column) = &table.expire
            && let Ok(Value::Int(at)) = row.field(column)
            && self.context.now.is_some_and(|now| *at > now)
        {
            self.next_expiry = Some(self.next_expiry.map_or(*at, |prior| prior.min(*at)));
        }
    }

    /// Delivered rows are authoritative except when a temporary audience
    /// can end on the device's clock without a server commit. Retained
    /// history stays readable; until-revoked content rechecks that audience.
    fn trust_synced_read(&self, table: &Table) -> bool {
        self.device && table.sync.as_ref().is_some_and(|sync| {
            table.leave == crate::schema::LeavePolicy::DeliveredHistory || match &sync.audience {
                crate::schema::Audience::Target { table, .. } => self.schema.table(table).is_none_or(|target| target.expire.is_none()),
                _ => true,
            }
        })
    }

    /// Whether the viewer may `effect` the row. The system principal is the
    /// store's owner and passes every rule; validation and constraints
    /// still run for it.
    pub(crate) fn check_rule(&mut self, table_name: &str, effect: Effect, old: Option<&Value>, next: &Value) -> Result<bool, RuntimeError> {
        if self.context.is_system() {
            return Ok(true);
        }
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        // A device holds a synced table's rows because the server delivered
        // each under the read rule and withdraws what it revokes; what
        // `retain delivered-history` kept stays readable here (LLP 3000 §7).
        if effect == Effect::Read && self.trust_synced_read(table) {
            return Ok(true);
        }
        let rule = table.rules.for_effect(effect).clone();
        if effect == Effect::Read { self.rule_dependencies(&rule); }
        let mut next = next.clone();
        materialize_optional_fields(&mut next, table);
        let old = old.map(|old| {
            let mut old = old.clone();
            materialize_optional_fields(&mut old, table);
            old
        });
        let viewer = self.context.viewer.clone();
        rules::evaluate(&rule, &viewer, old.as_ref(), &next, effect == Effect::Insert, self)
    }

    /// A row by id, materialized, without a rule check.
    pub(crate) fn fetch(&mut self, table_name: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        let found = self.tx.get(table_name, id)?;
        if self.device && (table.sync.is_none() || (found.is_none() && table.sync.as_ref().is_some_and(|s| s.horizon.is_some()))) { self.unknown_fact(table_name, "byId", &[Value::Id(id.to_owned())], "write target"); }
        Ok(found.filter(|row| !self.expired(table, row)).map(|mut row| {
            materialize_optional_fields(&mut row, table);
            row
        }))
    }

    /// A point read: the row when it exists and the viewer may read it, else
    /// `null`. Hidden and absent are the same word on purpose.
    pub(super) fn get(&mut self, read: &Read) -> Result<Value, RuntimeError> {
        let key = read.key.iter().map(|value| self.expr(value)).collect::<Result<Vec<_>, _>>()?;
        let table = self.schema.table(&read.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", read.table)))?;
        let index = table.index(&read.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", read.table, read.index)))?;
        self.read_tables.insert(read.table.clone());
        self.rule_dependencies(&table.rules.read);
        self.meter.at(&read.site);
        self.aggregate_read_coverage(&read.table, &read.index, &key, &read.site);
        if self.filter_depth > 0 && !self.meter.charge(MeterKind::RuleProbes, 1)? { return Ok(Value::Null); }
        if self.device && table.sync.is_none() {
            self.unknown_fact(&read.table, &read.index, &key, &read.site);
        }
        if key.iter().any(|value| *value == Value::Null) && !index.columns().iter().zip(&key).all(|(column, value)| *value != Value::Null || table.columns.get(column).is_some_and(|kind| kind.is_optional())) {
            // A null key on a required column addresses nothing.
            return Ok(Value::Null);
        }
        // @ref LLP 3000.007#20.12 — reserve authorization before knowing hit, miss or hidden; an exhausted probe is not a false verdict to roll back.
        let trusted = self.context.is_system() || self.trust_synced_read(table);
        if !trusted && !self.meter.charge(MeterKind::RuleProbes, rules::rule_probes(&table.rules.read))? { return Ok(Value::Null); }
        // Hidden and absent cost one examined row and the same static probe
        // allowance, including probes that a rule would short-circuit.
        let mark = self.meter.mark();
        let expiry_mark = self.next_expiry;
        let found = self.live_lookup(&read.table, &read.index, index, &key)?;
        // An expiring lookup already charged its live candidate while
        // passing expired siblings. A miss still costs one point read.
        if (table.expire.is_none() || found.is_none()) && !self.meter.charge(MeterKind::Examined, 1)? {
            return Ok(Value::Null);
        }
        let Some(mut row) = found else {
            if self.device && table.sync.as_ref().is_some_and(|s| s.horizon.is_some()) { self.unknown_fact(&read.table, &read.index, &key, &read.site); }
            return Ok(Value::Null);
        };
        if self.expired(table, &row) {
            return Ok(Value::Null);
        }
        materialize_optional_fields(&mut row, table);
        let viewer = self.context.viewer.clone();
        let allowed = trusted || rules::evaluate(&table.rules.read, &viewer, None, &row, false, &mut PrefixProbe { runner: self })?;
        if allowed {
            self.note_expiry(table, &row);
            Ok(self.live_aggregate(&read.table, row)?.unwrap_or(Value::Null))
        } else {
            self.next_expiry = expiry_mark;
            self.meter.restore(mark);
            self.meter.charge(MeterKind::Examined, 1)?;
            Ok(Value::Null)
        }
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
    /// index it is a prefix of (one seek each, at most `MAX_WORD_LANES`),
    /// and those words are merged as ordered lanes into one page, newest
    /// first when the index says so; every further term must also be a
    /// prefix of some word of the row (a filter over the page, never a
    /// second index). No term matches nothing: an empty search is empty,
    /// not everything.
    fn scan_words(&mut self, scan: &Scan) -> Result<Vec<Value>, RuntimeError> {
        const MAX_WORD_LANES: usize = 32;
        let table = self.schema.table(&scan.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", scan.table)))?;
        let index = table.index(&scan.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", scan.table, scan.index)))?;
        let Some((position, fields)) = index.word_component() else {
            return Err(RuntimeError::Schema(format!("{}.{} has no words(..) component for a matching read", scan.table, scan.index)));
        };
        let fields = fields.to_vec();
        let mut scope = Vec::new();
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
        let terms = crate::words::terms(&text);
        // Validate every scan input before denial or empty word discovery can
        // return. Generated lanes retain the same bounds and cursor scope.
        self.bounds(scan, table, index, None)?;
        self.take(&scan.take)?;
        self.read_tables.insert(scan.table.clone());
        self.rule_dependencies(&table.rules.read);
        self.meter.at(&scan.site);
        if self.device && table.sync.is_none() {
            self.unknown_fact(&scan.table, &scan.index, &scope, &scan.site);
        }
        if self.device && table.sync.as_ref().is_some_and(|sync| sync.horizon.is_some()) {
            let retained = self.tx.retained_group(&scan.table, &scan.index, &scope)?;
            self.horizon_coverage(scan, &scope, retained);
        }
        let empty_page = |this: &mut Self| {
            if this.page_depth == 0 && scan.opaque_cursor {
                this.record_page(scan.site.clone(), PagePosition { table: scan.table.clone(), index: scan.index.clone(), order: scan.order, prefix_len: position + 1, prefix: None, interrupted: false, next: None });
            }
        };
        // @ref LLP 3000.007#18.1 — one verdict per matching scope, before word discovery; the outer merge orders these scoped pages.
        let visibility = rules::scan_visibility(self.schema, scan);
        let mut admitted = self.trust_synced_read(table) || self.context.is_system() || visibility.decided_true || table.rules.read.is_uniformly_readable();
        if !admitted && !visibility.uniform { self.non_uniform = true; }
        if terms.is_empty() {
            empty_page(self);
            return Ok(Vec::new());
        }
        if !admitted && let Some(rule) = rules::prefix_decision(self.schema, scan) {
            let aborting = self.meter.cut == crate::meter::Cut::Abort;
            if aborting && !self.meter.charge(MeterKind::Examined, 1)? { empty_page(self); return Ok(Vec::new()); }
            if !self.prefix_verdict(table, index, &scope, &rule, visibility.uniform)? {
                empty_page(self);
                return Ok(Vec::new());
            }
            admitted = visibility.uniform;
        }
        // The words the first term is a prefix of, one seek per word: the
        // seek lands on the word's first entry, the next seek starts past
        // its last. Each costs one index entry on the meter.
        let mut words: Vec<String> = Vec::new();
        let mut bounds = Bounds { word: Some(terms[0].clone()), ..Bounds::default() };
        loop {
            if !self.meter.charge(MeterKind::IndexEntries, 1)? {
                break;
            }
            let found = self.tx.scan(&scan.table, &scan.index, &scope, &bounds, Dir::Asc, 1)?;
            let Some((_, key)) = found.into_iter().next() else { break };
            let Some(Value::String(word)) = crate::key::decode(&key).and_then(|values| values.into_iter().nth(position)) else {
                return Err(RuntimeError::Store(format!("{}.{} holds a key whose word is not text", scan.table, scan.index)));
            };
            if words.len() == MAX_WORD_LANES {
                // @ref LLP 3000.007#18.1 — the word bound limits this scope, not later lanes; actual meter ceilings still cut the whole query.
                if self.word_cut_at.is_none() { self.word_cut_at = Some(format!("{} lane {:?}", scan.site, scope)); }
                break;
            }
            bounds.after = Some(vec![Value::String(word.clone())]);
            words.push(word);
        }
        if words.is_empty() {
            empty_page(self);
            return Ok(Vec::new());
        }
        let lanes = words
            .iter()
            .map(|word| {
                let mut prefix: Vec<IndexKeyExpr> = scope.iter().map(|value| IndexKeyExpr::Scalar(Expr::Literal(value.clone()))).collect();
                prefix.push(IndexKeyExpr::Scalar(Expr::Literal(Value::String(word.clone()))));
                MergeLane { setup: Vec::new(), scan: Scan { prefix, ..scan.clone() }, source: None, binding: String::new() }
            })
            .collect();
        let merge = Merge { site: scan.site.clone(), lanes };
        let word = WordRead { admitted, fields, terms: terms[1..].to_vec() };
        self.merge_with_words(&merge, Some(&word))
    }

    fn take(&self, bound: &Bound) -> Result<usize, RuntimeError> {
        Ok(match bound {
            Bound::Literal(value) => *value as usize,
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
        index.suffix_after(prefix_len).iter().map(|name| CursorColumn { name: name.clone(), kind: table.columns[name].clone() }).collect()
    }

    /// The bounds of a scan: the cursor position and any value range.
    fn bounds(&mut self, scan: &Scan, table: &Table, index: &Index, prefix: Option<&[Value]>) -> Result<Bounds, RuntimeError> {
        let mut bounds = Bounds::default();
        let after = scan.after.as_deref().map(|value| self.expr(value)).transpose()?;
        let before = scan.before.as_deref().map(|value| self.expr(value)).transpose()?;
        match before {
            None | Some(Value::Null) => {}
            Some(Value::Array(values)) => bounds.before = Some(values),
            Some(value) => bounds.before = Some(vec![value]),
        }
        match after {
            None | Some(Value::Null) => {}
            Some(Value::String(token)) if scan.opaque_cursor => {
                let suffix = Self::cursor_suffix(table, index, scan.prefix.len());
                let values = decode_cursor_for(self.schema, &token, &scan.table, &scan.index, scan.order, &suffix).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
                if scan.merge_site.is_none() && let Some(prefix) = prefix {
                    let expected = CursorScope { generation: self.context.generation, prefix: prefix.to_vec() };
                    if decode_cursor(self.schema, &token).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?.scope.as_ref() != Some(&expected) {
                        return Err(RuntimeError::Input(format!("cursor: {}", crate::cursor::CursorError::Scope)));
                    }
                }
                bounds.after = Some(values);
            }
            Some(Value::Array(values)) if !scan.opaque_cursor => bounds.after = Some(values),
            Some(value) if !scan.opaque_cursor => bounds.after = Some(vec![value]),
            Some(_) => return Err(RuntimeError::Input("an opaque cursor is a string or null".into())),
        }
        if let Some(range) = &scan.range {
            bounds.gt = range.gt.as_deref().map(|v| self.expr(v)).transpose()?;
            bounds.gte = range.gte.as_deref().map(|v| self.expr(v)).transpose()?;
            bounds.lt = range.lt.as_deref().map(|v| self.expr(v)).transpose()?;
            bounds.lte = range.lte.as_deref().map(|v| self.expr(v)).transpose()?;
        }
        Ok(bounds)
    }

    /// A bounded page. Returns the visible rows, at most `take`, and records
    /// the page position for `next` when this scan is the program's page.
    pub(super) fn scan(&mut self, scan: &Scan) -> Result<Vec<Value>, RuntimeError> {
        let (rows, _) = self.scan_with_keys(scan)?;
        Ok(rows)
    }

    pub(super) fn scan_with_keys(&mut self, scan: &Scan) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        self.scan_with_words(scan, None)
    }

    fn scan_with_words(&mut self, scan: &Scan, word: Option<&WordRead>) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        if scan.prefix.iter().any(|key| matches!(key, IndexKeyExpr::WordPrefix(_))) {
            // A search page is a merge of word lanes; it carries no keys of
            // its own (a job never sweeps a words index).
            return self.scan_words(scan).map(|rows| (rows, Vec::new()));
        }
        let prefix = self.prefix_values(scan)?;
        let table = self.schema.table(&scan.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", scan.table)))?;
        let index = table.index(&scan.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", scan.table, scan.index)))?;
        // @ref LLP 3000.007#18.1 — generated word lanes share the search's merge cursor, not a direct cursor scoped to one word.
        let bounds = self.bounds(scan, table, index, if word.is_some() { None } else { Some(&prefix) })?;
        let take = self.take(&scan.take)?;
        self.scan_prepared(scan, prefix, bounds, take, word)
    }

    /// Resume a merge lane using its already evaluated bounds. The original
    /// expressions still govern uniformity; freezing them into literals would
    /// lose facts such as a prefix pinned to `viewer`.
    fn scan_prepared(&mut self, scan: &Scan, prefix: Vec<Value>, bounds: Bounds, take: usize, word: Option<&WordRead>) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        let table = self.schema.table(&scan.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", scan.table)))?;
        let index = table.index(&scan.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", scan.table, scan.index)))?;
        let retained = self.device && self.tx.retained_group(&scan.table, &scan.index, &prefix)?;
        self.read_tables.insert(scan.table.clone());
        self.rule_dependencies(&table.rules.read);
        self.meter.at(&scan.site);
        self.aggregate_read_coverage(&scan.table, &scan.index, &prefix, &scan.site);
        if self.device && table.sync.is_none() {
            self.unknown_fact(&scan.table, &scan.index, &prefix, &scan.site);
        }
        let dir = match scan.order {
            Order::Asc => Dir::Asc,
            Order::Desc => Dir::Desc,
        };
        let visibility = rules::scan_visibility(self.schema, scan);
        let always_visible = word.is_some_and(|word| word.admitted) || self.trust_synced_read(table) || self.context.is_system() || visibility.decided_true || table.rules.read.is_uniformly_readable();
        if !visibility.uniform && !always_visible && !(self.device && table.sync.is_some()) {
            self.non_uniform = true;
        }
        let mut visible: Vec<Value> = Vec::new();
        let mut keys: Vec<Vec<u8>> = Vec::new();
        let mut last_rule_visible: Option<Vec<u8>> = None;
        let mut has_more = false;
        let mut capped = false;
        let mut uniform_verdict: Option<bool> = always_visible.then_some(true);
        // @ref LLP 3000.007#17 — an aborting page pass costs one examined unit before its verdict in every world; capped queries retain their cut contract.
        let aborting = self.meter.cut == crate::meter::Cut::Abort;
        if aborting && !self.meter.charge(MeterKind::Examined, 1)? { return Ok((Vec::new(), Vec::new())); }
        if !always_visible && word.is_none() && let Some(rule) = rules::prefix_decision(self.schema, scan) {
            if !self.prefix_verdict(table, index, &prefix, &rule, visibility.uniform)? { return Ok((Vec::new(), Vec::new())); }
            if visibility.uniform { uniform_verdict = Some(true); }
        }
        // Non-uniform hidden runs cost examined rows, never a materialized
        // table. A uniform page already has its verdict before fetching.
        let mut cursor = bounds.clone();
        let batch = if visibility.uniform { take + 1 } else { (take + 1).max(32) };
        'outer: loop {
            let fetched = self.tx.scan(&scan.table, &scan.index, &prefix, &cursor, dir, batch)?;
            if fetched.is_empty() {
                break;
            }
            let fetched_len = fetched.len();
            for (mut row, key) in fetched {
                if !self.meter.charge(MeterKind::Examined, 1)? {
                    capped = true;
                    break 'outer;
                }
                cursor.after = Some(crate::key::decode(&key).unwrap_or_default().into_iter().skip(prefix.len()).collect());
                materialize_optional_fields(&mut row, table);
                if self.expired(table, &row) {
                    // Gone, whatever the rule says; it cost one examined row.
                    continue;
                }
                // A search's further terms: a row a lane found under its
                // first word still has to carry the rest.
                let unmatched = word.is_some_and(|word| {
                    let texts: Vec<&str> = word.fields.iter().filter_map(|field| row.field(field).ok().and_then(|value| value.as_str().ok())).collect();
                    !crate::words::row_matches(&crate::words::row_tokens(texts), &word.terms)
                });
                if unmatched {
                    continue;
                }
                let row_expiry_mark = self.next_expiry;
                let allowed = match uniform_verdict {
                    Some(verdict) => verdict,
                    None => {
                        let verdict = self.check_rule(&scan.table, Effect::Read, None, &row)?;
                        verdict
                    }
                };
                if self.meter.capped_at.is_some() {
                    capped = true;
                    break 'outer;
                }
                if allowed {
                    self.note_expiry(table, &row);
                    let aggregate = self.live_aggregate(&scan.table, row)?;
                    if self.meter.capped_at.is_some() {
                        // The aggregate carries the live contribution observed
                        // before this cut, just as a maintained point read does.
                        if let Some(row) = aggregate && visible.len() < take {
                            visible.push(row);
                            keys.push(key.clone());
                        }
                        capped = true;
                        break 'outer;
                    }
                    let Some(row) = aggregate else { continue; };
                    last_rule_visible = Some(key.clone());
                    if let Some(filter) = &scan.filter {
                        let prior = self.env.insert("$filter".into(), row.clone());
                        self.filter_depth += 1;
                        let matched = self.expr(filter);
                        self.filter_depth -= 1;
                        match prior { Some(value) => { self.env.insert("$filter".into(), value); }, None => { self.env.remove("$filter"); } }
                        let matched = matched?.as_bool()?;
                        self.meter.at(&scan.site);
                        if self.meter.capped_at.is_some() { capped = true; break 'outer; }
                        if !matched { continue; }
                    }
                    if visible.len() == take {
                        has_more = true;
                        break 'outer;
                    }
                    visible.push(row);
                    keys.push(key.clone());
                    if scan.filter.is_some() && visible.len() == take { has_more = true; break 'outer; }
                } else {
                    self.next_expiry = row_expiry_mark;
                }
            }
            if fetched_len < batch {
                break;
            }
        }
        // Acquired horizons do not backfill. Missing rows and alternate
        // index orderings cannot establish a complete answer from counts.
        if self.device
            && let Some(horizon) = table.sync.as_ref().and_then(|sync| sync.horizon.as_ref())
            && (horizon.by != scan.index || scan.order != crate::ir::Order::Desc || !has_more)
        {
            self.horizon_coverage(scan, &prefix, retained);
        }
        if self.page_depth == 0 && !scan.opaque_cursor && has_more && scan.filter.is_none() {
            self.page_overflow = true;
        }
        if self.page_depth == 0 && scan.opaque_cursor {
            let components = index.components.len();
            // @ref LLP 3000.007#5.6 — a full page positions after its last result; a cut may pass filter rejects, never rule-hidden keys.
            let position = if visible.len() == take { keys.last() } else { last_rule_visible.as_ref().or_else(|| keys.last()) };
            let continues = if capped || self.non_uniform || self.word_cut_at.is_some() { position.is_some() } else { has_more };
            let next = if continues { position.and_then(|key| crate::key::decode(key)).map(|values| values.into_iter().take(components).skip(prefix.len()).collect()) } else { None };
            self.record_page(scan.site.clone(), PagePosition { table: scan.table.clone(), index: scan.index.clone(), order: scan.order, prefix_len: prefix.len(), prefix: (scan.merge_site.is_none() && word.is_none()).then(|| prefix.clone()), interrupted: false, next });
        }
        Ok((visible, keys))
    }

    // @ref LLP 3000.007#19.2 — loss is monotone across executions; only the last execution at an owned site carries next.
    fn record_page(&mut self, site: String, page: PagePosition) {
        if let Some(previous) = self.pages.insert(site, page) {
            self.discarded_page_loss |= previous.interrupted || previous.next.is_some();
        }
    }

    /// Check every page: another result field's owner cannot carry this one's
    /// continuation. A consumed, exhausted page needs no owner, at any size.
    pub(super) fn page_position_lost(&self) -> bool {
        self.discarded_page_loss || self.pages.iter().any(|(site, page)| page.interrupted || (page.next.is_some() && self.page_owner.as_ref() != Some(site)))
    }

    /// The opaque `next` cursor of the program's page, if it has one.
    pub(super) fn next_cursor(&self) -> Result<Option<String>, RuntimeError> {
        let Some(page) = &self.page else { return Ok(None) };
        let Some(values) = &page.next else { return Ok(None) };
        let table = self.schema.table(&page.table).expect("scanned table");
        let index = table.index(&page.index).expect("scanned index");
        let suffix = Self::cursor_suffix(table, index, page.prefix_len);
        encode_cursor(self.schema, &CursorPosition { table: page.table.clone(), index: page.index.clone(), order: page.order, suffix, values: values.clone(), scope: page.prefix.as_ref().map(|prefix| CursorScope { generation: self.context.generation, prefix: prefix.clone() }) })
            .map(Some)
            .map_err(|error| RuntimeError::Input(format!("cursor: {error}")))
    }

    /// Merge ordered lanes into a page. Seekable uniform lanes use a heap
    /// of heads. Other lanes retain their page scan and stable union sort.
    pub(super) fn merge(&mut self, merge: &Merge) -> Result<Vec<Value>, RuntimeError> {
        self.merge_with_words(merge, None)
    }

    fn merge_with_words(&mut self, merge: &Merge, word: Option<&WordRead>) -> Result<Vec<Value>, RuntimeError> {
        // Keep the disclosure-sensitive non-uniform scan traversal unchanged.
        // @ref LLP 3000#7-decisions-during-execution — lazy uniform merge lanes
        if rules::lazy_merge(self.schema, merge) {
            return self.merge_lazy(merge, word);
        }
        let Some(first) = merge.lanes.first() else { return Ok(Vec::new()) };
        let table = self.schema.table(&first.scan.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", first.scan.table)))?;
        let index = table.index(&first.scan.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", first.scan.table, first.scan.index)))?;
        let order = first.scan.order;
        let take = self.take(&first.scan.take)?;
        let prefix_len = first.scan.prefix.len();
        let suffix_columns: Vec<String> = index.suffix_after(prefix_len);
        // A merge's cursor names the merge's own scope; it is checked before
        // lane discovery so an empty discovery cannot admit a foreign token.
        if first.scan.opaque_cursor
            && let Some(after) = first.scan.after.as_deref()
            && let Value::String(token) = self.expr(after)?
        {
            let suffix = Self::cursor_suffix(table, index, prefix_len);
            decode_cursor_for(self.schema, &token, &first.scan.table, &first.scan.index, order, &suffix).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
        }
        let mut candidates: Vec<(Vec<Value>, Value)> = Vec::new();
        let mut seen = BTreeSet::new();
        let outer_depth = self.page_depth;
        for lane in &merge.lanes {
            let sources = match &lane.source {
                Some(source) => {
                    self.page_depth += 1;
                    let rows = self.scan(source)?;
                    self.page_depth -= 1;
                    rows
                }
                None => vec![Value::Null],
            };
            for source_row in sources {
                if lane.source.is_some() {
                    self.env.insert(lane.binding.clone(), source_row);
                }
                self.statements(&lane.setup, &merge.site)?;
                self.page_depth += 1;
                // Each lane reads one row past the page, so a lane that alone
                // fills the page still shows there is more to continue on.
                let mut lane_scan = lane.scan.clone();
                // @ref LLP 3000.007#20.3 — validate the common cursor above, then translate its descriptor for each same-shaped table.
                if lane_scan.table != first.scan.table && lane_scan.opaque_cursor
                    && let Some(after) = lane_scan.after.as_deref()
                    && let Value::String(token) = self.expr(after)?
                {
                    let mut position = crate::cursor::decode_cursor(self.schema, &token).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
                    position.table = lane_scan.table.clone();
                    let token = crate::cursor::encode_cursor(self.schema, &position).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
                    lane_scan.after = Some(Box::new(Expr::Literal(Value::String(token))));
                }
                lane_scan.take = Bound::Literal(take as u32 + 1);
                let (rows, _) = self.scan_with_words(&lane_scan, word)?;
                self.page_depth = outer_depth;
                for row in rows {
                    let id = row.field("id")?.as_str()?.to_owned();
                    if !seen.insert(id) {
                        continue;
                    }
                    let key: Vec<Value> = suffix_columns.iter().map(|column| row.field(column).cloned().unwrap_or(Value::Null)).collect();
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
        candidates.truncate(take);
        if self.page_depth == 0 && !first.scan.opaque_cursor && has_more {
            self.page_overflow = true;
        }
        if self.page_depth == 0 && first.scan.opaque_cursor {
            let continues = self.merge_can_continue() && has_more;
            let next = if continues { candidates.last().map(|(key, _)| key.clone()) } else { None };
            self.record_page(merge.site.clone(), PagePosition { table: first.scan.table.clone(), index: first.scan.index.clone(), order, prefix_len, prefix: None, interrupted: false, next });
        }
        Ok(candidates.into_iter().map(|(_, row)| row).collect())
    }

    // @ref LLP 3000.007#18.1 — one shared position must be established by every lane, including a lane cut before contributing a row.
    fn merge_can_continue(&self) -> bool {
        // A cut can leave unread rows ahead of the last merged result. The
        // existing cursor has no per-lane positions, so it cannot resume that
        // page safely. Withhold for the entire non-uniform class, even without
        // a cut: presence of next must not reveal a hidden run's meter cost.
        !self.non_uniform && self.meter.capped_at.is_none() && self.word_cut_at.is_none()
    }

    /// One head per uniform lane, then advance only the winning lane. Each
    /// one-row scan retains the ordinary scan's lookahead and meter checks.
    /// Deduplicate before counting the page, including overlapping lanes.
    fn merge_lazy(&mut self, merge: &Merge, word: Option<&WordRead>) -> Result<Vec<Value>, RuntimeError> {
        let Some(first) = merge.lanes.first() else { return Ok(Vec::new()) };
        let table = self.schema.table(&first.scan.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", first.scan.table)))?;
        let index = table.index(&first.scan.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", first.scan.table, first.scan.index)))?;
        let take = self.take(&first.scan.take)?;
        let order = first.scan.order;
        let prefix_len = first.scan.prefix.len();
        let columns: Vec<_> = index.suffix_after(prefix_len);
        if first.scan.opaque_cursor
            && let Some(after) = first.scan.after.as_deref()
            && let Value::String(token) = self.expr(after)?
        {
            decode_cursor_for(self.schema, &token, &first.scan.table, &first.scan.index, order, &Self::cursor_suffix(table, index, prefix_len))
                .map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
        }
        let key_of = |row: &Value| columns.iter().map(|column| row.field(column).cloned().unwrap_or(Value::Null)).collect::<Vec<_>>();
        let depth = self.page_depth;
        self.page_depth += 1;
        let mut lanes = Vec::new();
        let mut heap = BinaryHeap::new();
        for lane in &merge.lanes {
            let sources = match &lane.source { Some(source) => self.scan(source)?, None => vec![Value::Null] };
            for source_row in sources {
                if lane.source.is_some() { self.env.insert(lane.binding.clone(), source_row); }
                let prefix = self.prefix_values(&lane.scan)?;
                let definition = self.schema.table(&lane.scan.table).ok_or_else(|| RuntimeError::Schema("missing merge table".into()))?;
                let index = definition.index(&lane.scan.index).ok_or_else(|| RuntimeError::Schema("missing merge index".into()))?;
                let bounds = self.bounds(&lane.scan, definition, index, None)?;
                lanes.push((&lane.scan, prefix, bounds, VecDeque::new(), false));
            }
        }
        // A small merge benefits from a page per lane: repeated one-row SQL
        // seeks would cost more than reading those few pages in one call.
        let batch = if lanes.len() <= 8 { take + 1 } else { 1 };
        for (position, (scan, prefix, bounds, buffer, done)) in lanes.iter_mut().enumerate() {
            let (rows, _) = self.scan_prepared(scan, prefix.clone(), bounds.clone(), batch, word)?;
            *done = rows.len() < batch;
            *buffer = rows.into();
            if let Some(row) = buffer.pop_front() {
                self.meter.step(1)?;
                heap.push(MergeHead { key: key_of(&row), row, lane: position, order });
            }
        }
        let mut seen = BTreeSet::new();
        let mut page = Vec::new();
        let mut has_more = false;
        let mut last = None;
        while let Some(head) = heap.pop() {
            self.meter.step(1)?;
            if seen.insert(head.row.field("id")?.as_str()?.to_owned()) {
                if page.len() == take { has_more = true; break; }
                last = Some(head.key.clone());
                page.push(head.row);
            }
            let (scan, prefix, bounds, buffer, done) = &mut lanes[head.lane];
            bounds.after = Some(head.key);
            if buffer.is_empty() && !*done && self.meter.capped_at.is_none() {
                let (rows, _) = self.scan_prepared(scan, prefix.clone(), bounds.clone(), batch, word)?;
                *done = rows.len() < batch;
                *buffer = rows.into();
            }
            if let Some(row) = buffer.pop_front() {
                heap.push(MergeHead { key: key_of(&row), row, lane: head.lane, order });
            }
        }
        self.page_depth = depth;
        if depth == 0 {
            if first.scan.opaque_cursor {
                let continues = self.merge_can_continue() && has_more;
                self.record_page(merge.site.clone(), PagePosition { table: first.scan.table.clone(), index: first.scan.index.clone(), order, prefix_len, prefix: None, interrupted: false, next: if continues { last } else { None } });
            } else if has_more { self.page_overflow = true; }
        }
        Ok(page)
    }
}

struct PrefixProbe<'a, 'b> { runner: &'a mut Runner<'b> }
impl Probe for PrefixProbe<'_, '_> {
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        self.runner.rule_probe_exists(table, index, key, equalities)
    }
    fn created(&mut self, table: &str, index: &str, key: &[Value]) -> bool { self.runner.created(table, index, key) }
}

#[cfg(all(test, feature = "sqlite"))]
#[path = "../../tests/read_verdict/mod.rs"]
mod read_verdict_tests;
