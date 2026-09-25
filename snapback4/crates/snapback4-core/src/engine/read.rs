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

use crate::rows::word_heap;
#[path = "word_merge.rs"]
mod word_merge;
#[path = "view_merge.rs"]
mod view_merge;

// @ref LLP 3000.007#18.1 — search state belongs to the generated word merge's direct lanes, never to an expression nested inside one.
#[derive(Clone)]
struct WordRead {
    admitted: bool,
    metered: bool,
    retained: bool,
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

impl Probe for Runner<'_> {
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        if !self.read_charge(MeterKind::RuleProbes, 1)? {
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
    pub(super) fn rule_dependencies(&mut self, rule: &crate::schema::RuleExpr) {
        let mut sites = Vec::new();
        rules::probe_sites(rule, &mut sites);
        for (table, _) in sites {
            if let Some(maintain) = self.schema.maintain_for(&table)
                && self.schema.table(&maintain.source).is_some_and(|source| source.is_expiring()) {
                self.read_tables.insert(maintain.source.clone());
            }
            self.read_tables.insert(table);
        }
    }

    fn prefix_verdict(&mut self, table: &Table, index: &Index, prefix: &[Value], rule: &crate::schema::RuleExpr, uniform: bool) -> Result<bool, RuntimeError> {
        if let Some(through) = &table.through && let Some(id) = index.columns().iter().zip(prefix).find_map(|(name,v)| (name == &through.reference).then_some(v)) {
            let verdict = self.parent_verdict(through,id)?;
            if verdict == super::through::ParentVerdict::Unknown { self.beyond_horizon = true; }
            return Ok(verdict == super::through::ParentVerdict::Readable);
        }
        let probe_row = Value::Row(index.components.iter().zip(prefix).filter_map(|(part, value)| part.column().map(|name| (name.clone(), value.clone()))).collect::<std::collections::BTreeMap<_, _>>().into());
        let viewer = self.context.viewer.clone();
        let expiry = self.next_expiry;
        let verdict = rules::evaluate(rule, &viewer, None, &probe_row, false, &mut PrefixProbe { runner: self });
        // Partial admission says nothing about any returned row's lifetime.
        if !uniform || !matches!(verdict, Ok(true)) { self.next_expiry = expiry; }
        let verdict = verdict?;
        // A partial conjunction denial costs the same static allowance as a uniform denial.
        Ok(self.read_charge(MeterKind::RuleProbes, rules::rule_probes(&table.rules.read))? && verdict)
    }

    // @ref LLP 3000.007#20.9 — coverage applies before a missing candidate or empty page can return zero/complete.
    fn aggregate_read_coverage(&mut self, table: &str, index: &str, key: &[Value], site: &str) {
        if !self.device { return; }
        let Some(maintain) = self.schema.maintain_for(table) else { return };
        let source = &self.schema.tables[&maintain.source];
        if self.schema.maintain_subset_unknown(table) || (source.is_expiring() && source.sync.as_ref().is_none_or(|sync| sync.horizon.is_some())) {
            self.read_tables.insert(maintain.source.clone());
            self.unknown_fact(table, index, key, site);
        }
    }

    fn horizon_coverage(&mut self, scan: &Scan, prefix: &[Value], retained: bool) {
        if retained { self.beyond_horizon = true; self.components.note(|frame| { frame.beyond = true; frame.retained = true; }); }
        else { self.unknown_fact(&scan.table, &scan.index, prefix, &scan.site); }
    }

    // @ref LLP 3000.007#17 — one rule probe, regardless of expired siblings or an expiring maintain's sources.
    fn rule_probe_exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        let (present, known) = self.probe_witness(table, index, key, equalities, false)?;
        if !known && !self.read_capped() { self.unknown_fact(table, index, key, "rule probe"); }
        Ok(present)
    }

    /// Existence witnesses are raw data, never recursively authorized rows.
    pub(super) fn probe_witness(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)], current: bool) -> Result<(bool, bool), RuntimeError> {
        let definition = self.schema.table(table).ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?;
        let index_def = definition.index(index).ok_or_else(|| RuntimeError::Schema(format!("missing index {table}.{index}")))?;
        self.read_tables.insert(table.to_owned());
        let found = self.lookup_live(table, index, index_def, key, false)?;
        let mut live = found.is_some();
        let mut known = !self.device || if current {
            match &found {
                Some(row) => self.witness_covered(table, index, key, row)?,
                None => self.authorization_absence_covered(table, index, key)?,
            }
        } else { definition.sync.as_ref().is_some_and(|s| live || s.horizon.is_none()) };
        if let Some(row) = &found {
            self.note_expiry(definition, row);
            if let Some(maintain) = self.schema.maintain_for(table)
                && let Some(source) = self.schema.table(&maintain.source).filter(|source| source.is_expiring()) {
                self.read_tables.insert(maintain.source.clone());
                if self.device_work_active {
                    let group_bytes = word_heap::slots::<Value>(maintain.by.len())
                        + maintain.by.iter().map(|field| row.field(field).map_or(0, word_heap::value)).sum::<u64>();
                    self.meter.heap(2 * group_bytes + word_heap::allocation("$contribution:".len() + maintain.target.len()))?;
                }
                let group = crate::schema::maintained_key(row, &maintain.by);
                let (name, prefix) = maintain.source_scan(source, &group);
                if self.device && source.sync.as_ref().is_none_or(|sync| sync.horizon.is_some()) { known = false; }
                let mut bounds = Bounds::default();
                live = false;
                'sources: loop {
                    let (rows, limit) = self.witness_scan(&maintain.source, name, &prefix, &bounds, 32)?;
                    let count = rows.len();
                    for (mut candidate, stored) in rows {
                        self.witness_materialize(&mut candidate, source)?;
                        bounds.after = self.witness_position(&stored, (source.index(name).expect("source index").components.len() + 1).max(prefix.len() + 1), prefix.len())?;
                        if self.device_work_active {
                            self.meter.step(maintain.evaluation_steps())?;
                            self.meter.heap(word_heap::slots::<Value>(maintain.by.len())
                                + maintain.by.iter().map(|field| candidate.field(field).map_or(0, word_heap::value)).sum::<u64>())?;
                        }
                        if !self.expired(source, &candidate) && maintain.selected(&candidate) && maintain.source_key(&candidate) == group {
                            if current && !self.witness_covered(&maintain.source, name, &prefix, &candidate)? { known = false; continue; }
                            // Existence is existential: one covered witness
                            // settles it even after an uncertain candidate.
                            if current { known = true; }
                            self.note_expiry(source, &candidate);
                            live = true;
                            break 'sources;
                        }
                    }
                    if count < limit { break; }
                }
            }
        }
        if self.device && self.schema.maintain_subset_unknown(table) { known = false; }
        // @ref LLP 3000.007#10 — the total unique probe reads once, then tests the remaining named equalities.
        Ok((live && found.as_ref().is_some_and(|row| equalities.iter().all(|(column, value)| row.field(column).unwrap_or(&Value::Null) == value)), known))
    }

    /// Point lookups must pass expired siblings, even on an index whose
    /// logical uniqueness no longer counts those rows.
    pub(super) fn live_lookup(&mut self, table_name: &str, name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        self.lookup_live(table_name, name, index, key, true)
    }

    pub(super) fn lookup_live(&mut self, table_name: &str, name: &str, index: &Index, key: &[Value], charge: bool) -> Result<Option<Value>, RuntimeError> {
        self.lookup_live_charged(table_name, name, index, key, charge, None)
    }

    // @ref LLP 3000.013#11.1 — target expiry work is charged only after authority; denied targets reveal no backlog.
    pub(super) fn lookup_live_charged(&mut self, table_name: &str, name: &str, index: &Index, key: &[Value], charge: bool, mut expired_work: Option<&mut u64>) -> Result<Option<Value>, RuntimeError> {
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        if !table.is_expiring() && !self.device_work_active {
            return self.tx.lookup(table_name, name, index, key).map(|found| found.map(|mut row| { materialize_optional_fields(&mut row, table); row }));
        }
        let mut bounds = Bounds::default();
        loop {
            let (rows, limit) = self.witness_scan(table_name, name, key, &bounds, if !table.is_expiring() { 1 } else { 32 })?;
            let count = rows.len();
            for (mut row, stored) in rows {
                self.witness_materialize(&mut row, table)?;
                if charge && !self.device_work_active && !self.read_charge(MeterKind::Examined, 1)? { return Ok(None); }
                if !self.expired(table, &row) { return Ok(Some(row)); }
                if let Some(work) = expired_work.as_deref_mut() {
                    *work = work.saturating_add(1);
                    // Stop private resolution at the existing ceiling too. A
                    // cut is a refused target, not proof of absence: an upsert
                    // must pay this debt after insert authority and before it
                    // can insert, so that arm necessarily fails its meter.
                    if *work > self.meter.ceilings.examined.saturating_sub(self.meter.used.examined) { return Ok(None); }
                }
                bounds.after = self.witness_position(&stored, index.components.len() + 1, key.len())?;
            }
            if count < limit { return Ok(None); }
        }
    }

    // Physical witness work is additional device authorization work. Queries
    // and server rules keep their existing one-probe accounting.
    fn witness_scan(&mut self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, batch: usize) -> Result<(Vec<(Value, Vec<u8>)>, usize), RuntimeError> {
        if !self.device_work_active { return Ok((self.tx.scan(table, index, prefix, bounds, Dir::Asc, batch)?, batch)); }
        let limit = self.meter.ceilings.examined.saturating_sub(self.meter.used.examined).min(batch as u64) as usize;
        if limit == 0 { self.meter.charge(MeterKind::Examined, 1)?; }
        let rows = self.tx.scan_metered(table, index, prefix, bounds, Dir::Asc, limit, &mut self.meter)?;
        self.meter.charge(MeterKind::Examined, rows.len().max(1) as u64)?;
        Ok((rows, limit))
    }

    fn witness_materialize(&mut self, row: &mut Value, table: &Table) -> Result<(), RuntimeError> {
        if self.device_work_active { self.meter.heap(word_heap::materialize(row, table))?; }
        materialize_optional_fields(row, table);
        Ok(())
    }

    fn witness_position(&mut self, stored: &[u8], components: usize, prefix: usize) -> Result<Option<Vec<Value>>, RuntimeError> {
        if self.device_work_active { self.meter.heap(word_heap::key_decode(components, stored.len()))?; }
        Ok(crate::key::decode(stored).map(|values| values.into_iter().skip(prefix).collect()))
    }

    /// A maintain over expiring source rows is a live fact before the
    /// physical sweep catches up. Recompute only that fact's group, with
    /// the usual runtime meter and device coverage rules.
    pub(crate) fn live_aggregate(&mut self, table_name: &str, row: Value) -> Result<Option<Value>, RuntimeError> {
        let Some(maintain) = self.schema.maintain_for(table_name).cloned() else { return Ok(Some(row)); };
        let source = self.schema.table(&maintain.source).ok_or_else(|| RuntimeError::Schema("missing maintain source".into()))?;
        if !source.is_expiring() { return Ok(Some(row)); }
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
                if !self.read_charge(MeterKind::Examined, 1)? { break 'sources; }
                bounds.after = crate::key::decode(&key).map(|values| values.into_iter().skip(prefix.len()).collect());
                if !self.read_charge(MeterKind::Steps, maintain.evaluation_steps())? { break 'sources; }
                if self.expired(source, &candidate) || !maintain.selected(&candidate) || maintain.source_key(&candidate) != group { continue; }
                let prior = std::mem::replace(&mut self.beyond_horizon, false);
                let allowed = self.provisional_readable(&maintain.source, &candidate);
                let unknown = self.beyond_horizon;
                self.beyond_horizon |= prior;
                if !allowed? {
                    if unknown { return Ok(None); }
                    continue;
                }
                any = true;
                self.note_expiry(source, &candidate);
                total += match &maintain.kind { crate::schema::MaintainKind::Count => 1, crate::schema::MaintainKind::Sum { of } => i128::from(candidate.field(of)?.as_int()?) };
            }
            if count < 32 { break; }
        }
        self.meter.require_uncapped()?;
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
        if let Some(column) = table.expiry_column()
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
        if effect == Effect::Insert && table.through.is_some() {
            rules::evaluate(&rule, &viewer, old.as_ref(), &next, true, &mut PrefixProbe { runner:self })
        } else { rules::evaluate(&rule, &viewer, old.as_ref(), &next, effect == Effect::Insert, self) }
    }

    /// A row by id, materialized, without a rule check.
    pub(crate) fn fetch(&mut self, table_name: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        self.schema.refuse_private(table_name)?;
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
        self.schema.refuse_private(&read.table)?;
        // @ref LLP 3000.007#20.21 — an unfinished maintained value is unavailable, never an absent group coerced to zero.
        let maintained = self.schema.maintain_for(&read.table).is_some();
        if maintained { self.meter.require_uncapped()?; }
        let value = self.get_inner(read)?;
        if maintained { self.meter.require_uncapped()?; }
        Ok(value)
    }

    fn get_inner(&mut self, read: &Read) -> Result<Value, RuntimeError> {
        let key = read.key.iter().map(|value| self.expr(value)).collect::<Result<Vec<_>, _>>()?;
        let table = self.schema.table(&read.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", read.table)))?;
        let index = table.index(&read.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", read.table, read.index)))?;
        self.read_tables.insert(read.table.clone());
        self.rule_dependencies(&table.rules.read);
        self.meter.at(&read.site);
        self.aggregate_read_coverage(&read.table, &read.index, &key, &read.site);
        let inherited = self.schema.maintain_for(&read.table).filter(|m| self.schema.tables[&m.source].through.is_some());
        let mut inherited_admitted = false;
        // @ref LLP 3000.014#5-what-derives-from-the-capture — only key-determined inputs may authorize a synthetic aggregate row.
        if let Some(m) = inherited.filter(|m| m.parent_key.is_some() || rules::deciding_fields(&read.table, table, &table.rules.read).iter().all(|field| index.columns().iter().take(key.len()).any(|column| column == field))) {
            let visible = if let Some(parent) = &m.parent_key {
                let Some(at) = index.columns().iter().position(|f| f == &parent.reference) else { return Err(RuntimeError::Structural {code:"E_READ_THROUGH_SCAN",message:format!("{} must be read by its full parent key; use {}[parent] (guide maintains)",read.table,read.table)}); };
                let parent_id = key.get(at).ok_or_else(|| RuntimeError::Input("read through aggregate needs its full parent key".into()))?;
                match self.parent_verdict(parent,parent_id)? {
                    super::through::ParentVerdict::Readable => true,
                    super::through::ParentVerdict::Unknown => { self.unknown_fact(&read.table,&read.index,&key,&read.site); false },
                    _ => false,
                }
            } else {
                let row = Value::Row(index.columns().into_iter().zip(key.iter().cloned()).collect());
                self.meter.charge(MeterKind::RuleProbes,rules::rule_probes(&table.rules.read))?;
                let viewer = self.context.viewer.clone();
                self.context.is_system() || rules::evaluate(&table.rules.read,&viewer,None,&row,false,&mut PrefixProbe {runner:self})?
            };
            if !visible { return Ok(crate::value::object([("value",Value::Null)])); }
            inherited_admitted = true;
        }
        if self.filter_depth > 0 && !self.read_charge(MeterKind::RuleProbes, 1)? { return Ok(Value::Null); }
        if self.device && table.sync.is_none() {
            self.unknown_fact(&read.table, &read.index, &key, &read.site);
        }
        if key.iter().any(|value| *value == Value::Null) && !index.columns().iter().zip(&key).all(|(column, value)| *value != Value::Null || table.columns.get(column).is_some_and(|kind| kind.is_optional())) {
            // A null key on a required column addresses nothing.
            return Ok(Value::Null);
        }
        // @ref LLP 3000.007#20.12 — reserve authorization before knowing hit, miss or hidden; an exhausted probe is not a false verdict to roll back.
        let trusted = inherited_admitted || self.context.is_system() || self.trust_synced_read(table);
        // Prediction keeps the server's reservation even for delivered rows.
        // Only the additional physical authority work uses the device allowance.
        let prepaid = !trusted || (self.device_allowance.is_some() && !self.context.is_system());
        if prepaid && !self.read_charge(MeterKind::RuleProbes, rules::rule_probes(&table.rules.read))? { return Ok(Value::Null); }
        // Hidden and absent cost one examined row and the same static probe
        // allowance, including probes that a rule would short-circuit.
        let mark = self.meter.mark();
        let expiry_mark = self.next_expiry;
        let found = self.live_lookup(&read.table, &read.index, index, &key)?;
        // An expiring lookup already charged its live candidate while
        // passing expired siblings. A miss still costs one point read.
        if (!table.is_expiring() || found.is_none()) && !self.read_charge(MeterKind::Examined, 1)? {
            return Ok(Value::Null);
        }
        let actual_aggregate = inherited.is_some() && !inherited_admitted;
        let mut group_exists = found.is_some();
        let mut row = if actual_aggregate {
            // A value-dependent rule sees the live aggregate, including its
            // logical zero on a missing group, never a null value or stale total.
            let live = found.map(|row| self.live_aggregate(&read.table, row)).transpose()?.flatten();
            group_exists = live.is_some();
            match live {
                Some(row) => row,
                None => {
                    // Own the zero image, copied group key and JSON id only
                    // after reserving their schema/key-bounded allocation.
                    self.meter.heap(super::write_target::row_copy_ceiling(table).saturating_add(key.iter().map(Value::clone_heap_bytes).fold(0_u64, u64::saturating_add).saturating_mul(8)))?;
                    let mut fields: std::collections::BTreeMap<_, _> = index.columns().into_iter().zip(key.iter().cloned()).collect();
                    let m = inherited.expect("inherited aggregate");
                    if !m.by.iter().all(|field| fields.contains_key(field)) { return Ok(crate::value::object([("value", Value::Null)])); }
                    let group: Vec<_> = m.by.iter().map(|field| fields[field].clone()).collect();
                    fields.insert("id".into(), Value::Id(crate::schema::maintained_id(&group)));
                    fields.insert("value".into(), Value::Int(0));
                    Value::Row(fields.into())
                }
            }
        } else if let Some(row) = found { row } else {
            if self.device && table.sync.as_ref().is_some_and(|s| s.horizon.is_some()) { self.unknown_fact(&read.table, &read.index, &key, &read.site); }
            return Ok(Value::Null);
        };
        if self.expired(table, &row) {
            return Ok(Value::Null);
        }
        materialize_optional_fields(&mut row, table);
        let provisional = self.is_provisional(&read.table, &row)?;
        let viewer = self.context.viewer.clone();
        let allowed = if provisional && !self.context.is_system() {
            self.authorize_read(&read.table, &row, prepaid)?
        } else { trusted || rules::evaluate(&table.rules.read, &viewer, None, &row, false, &mut PrefixProbe { runner: self })? };
        // A failed authorization owns its charges and its cut. Hidden-candidate
        // rollback must never erase exhaustion or convert it into coverage.
        if self.read_capped() { return Ok(Value::Null); }
        if allowed {
            // @ref LLP 3000.001#proposed-composition-of-retained-and-authoritative-reads — a delivered left point hit marks only its component, never whole-query coverage or a miss.
            if self.device && self.retained_row(&read.table, &row)? { self.components.note(|frame| frame.retained = true); }
            self.note_expiry(table, &row);
            let value = if actual_aggregate { if group_exists { row } else { Value::Null } }
                else { self.live_aggregate(&read.table, row)?.unwrap_or(Value::Null) };
            Ok(super::recorded::public_image(table, value))
        } else {
            self.next_expiry = expiry_mark;
            if !provisional {
                self.meter.restore(mark);
                self.read_charge(MeterKind::Examined, 1)?;
            }
            Ok(if inherited.is_some() { crate::value::object([("value", Value::Null)]) } else { Value::Null })
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
    fn discover_words(&mut self, scan: &Scan) -> Result<Option<(Vec<String>, Vec<Value>, WordRead)>, RuntimeError> {
        const MAX_WORD_LANES: usize = 32;
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
        self.word_bounds(scan, table, index, None, visibility.uniform)?;
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
                self.device_work(|runner| runner.meter.heap(256 * (192 + word_heap::values(&scope) + word_heap::text(&scan.table) + word_heap::text(&scan.index) + word_heap::text(&scan.site))))?;
            }
            retained = self.retained_group(&scan.table, &scan.index, &scope)?;
            if table.sync.is_none() { self.unknown_fact(&scan.table, &scan.index, &scope, &scan.site); }
            else if !scan.existence && table.sync.as_ref().is_some_and(|sync| sync.horizon.is_some()) {
                self.horizon_coverage(scan, &scope, retained);
            }
        }
        // @ref LLP 3000.007#18.1 — one verdict per matching scope, before word discovery and shared by its generated lanes.
        let mut admitted = self.trust_synced_read(table) || self.context.is_system() || visibility.decided_true || table.rules.read.is_uniformly_readable();
        if !admitted && !visibility.uniform { self.non_uniform = true; self.components.note(|frame| frame.non_uniform = true); }
        if terms.is_empty() {
            return Ok(None);
        }
        if !admitted {
            // Uniform word scopes can borrow their rule; simplification/cloning
            // is needed only by the existing partial-conjunction traversal.
            let partial = if visibility.uniform { None } else { rules::prefix_decision(self.schema, scan) };
            if let Some(rule) = if visibility.uniform { Some(&table.rules.read) } else { partial.as_ref() } {
            if visibility.uniform { self.meter.heap(word_heap::verdict(index, &scope, &self.context.viewer, rule))?; }
            let aborting = self.meter.cut == crate::meter::Cut::Abort;
            if aborting && !self.read_charge(MeterKind::Examined, 1)? { return Ok(None); }
            if !self.prefix_verdict(table, index, &scope, rule, visibility.uniform)? {
                return Ok(None);
            }
            admitted = visibility.uniform;
            }
        }
        // The words the first term is a prefix of, one seek per word: the
        // seek lands on the word's first entry, the next seek starts past
        // its last. Each costs one index entry on the meter.
        // @ref LLP 3000.007#20.24 — L14.2: a uniform scope's word expansion is bounded by the meter, not by 32.
        let metered_words = admitted && visibility.uniform;
        let mut words: Vec<String> = Vec::new();
        if metered_words { self.meter.heap(word_heap::text(&terms[0]))?; }
        let mut bounds = Bounds { word: Some(terms[0].clone()), ..Bounds::default() };
        loop {
            if !self.read_charge(MeterKind::IndexEntries, 1)? {
                break;
            }
            let found = if metered_words { self.tx.scan_metered(&scan.table, &scan.index, &scope, &bounds, Dir::Asc, 1, &mut self.meter)? }
                else { self.tx.scan(&scan.table, &scan.index, &scope, &bounds, Dir::Asc, 1)? };
            let Some((_, key)) = found.into_iter().next() else { break };
            if metered_words {
                // Decoder vector and string scratch before decoding; the store's fetched
                // row/key are transient, never accumulated with the discovered words.
                self.meter.heap(word_heap::key_decode(index.components.len() + 1, key.len()))?;
            }
            let Some(Value::String(word)) = crate::key::decode(&key).and_then(|values| values.into_iter().nth(position)) else {
                return Err(RuntimeError::Store(format!("{}.{} holds a key whose word is not text", scan.table, scan.index)));
            };
            if words.len() == MAX_WORD_LANES && !metered_words {
                // @ref LLP 3000.007#18.1 — the word bound limits this scope, not later lanes; actual meter ceilings still cut the whole query.
                self.components.note(|frame| frame.words = true);
                if self.word_cut_at.is_none() { self.word_cut_at = Some(format!("{} lane {:?}", scan.site, scope)); }
                break;
            }
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
        terms.remove(0); // Move the remaining terms once; every word lane shares them.
        Ok(Some((words, scope, WordRead { admitted, metered: metered_words, retained, fields, terms })))
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
            Some(Value::String(token)) if scan.opaque_cursor => {
                // A matching merge shares its validated cursor image; each bound
                // pays only its own retained values, before cloning them.
                let merged = scan.merge_site.is_some() || index.word_component().is_some();
                let suffix = if metered { word_heap::suffix(&mut self.meter, table, index, scan.prefix.len(), merged)? }
                    else if merged { Self::merge_suffix(table, index, scan.prefix.len()) }
                    else { Self::cursor_suffix(table, index, scan.prefix.len()) };
                if metered {
                    self.validate_word_cursor(&token, &scan.table, &scan.index, scan.order, &suffix, scan.variant)?;
                    let position = &self.word_cursor.as_ref().unwrap().1;
                    self.meter.heap(word_heap::values(&position.values))?;
                    if position.inclusive { bounds.at_or_after = Some(position.values.clone()); }
                    else { bounds.after = Some(position.values.clone()); }
                    self.word_shape_cursor(&scan.site, token)?;
                } else {
                let position = decode_cursor(self.schema, &token).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
                crate::cursor::check_variant(&position, scan.variant)?;
                let values = decode_cursor_for(self.schema, &token, &scan.table, &scan.index, scan.order, &suffix).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
                if scan.merge_site.is_none() && let Some(prefix) = prefix {
                    let expected = CursorScope { variant: scan.variant, generation: self.context.generation, prefix: prefix.to_vec() };
                    if position.scope.as_ref() != Some(&expected) {
                        return Err(RuntimeError::Input(format!("cursor: {}", crate::cursor::CursorError::Scope)));
                    }
                }
                if position.inclusive {
                    bounds.at_or_after = Some(values);
                } else { bounds.after = Some(values); }
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
            self.meter.heap(word_heap::values(&position.values))?;
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
        Ok(self.tx.scan_metered(&scan.table, &scan.index, &prefix, &bounds, Dir::Desc, 1, &mut self.meter)?.pop().map(|(_, key)| key))
    }

    /// A bounded page. Returns the visible rows, at most `take`, and records
    /// the page position for `next` when this scan is the program's page.
    pub(super) fn scan(&mut self, scan: &Scan) -> Result<Vec<Value>, RuntimeError> {
        let (rows, _) = self.scan_with_keys(scan)?;
        Ok(rows)
    }

    pub(super) fn scan_with_keys(&mut self, scan: &Scan) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
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
            self.meter.heap(word_heap::values(prefix) + word_heap::bounds(bounds))?;
        }
        self.scan_prepared(scan, prefix.to_vec(), bounds.clone(), take, word)
    }

    fn charge_word_key(&mut self, index: &Index, prefix_len: usize, suffix_len: usize, row: &Value) -> Result<(), RuntimeError> {
        // Exact suffix slots plus copied column bodies (computed time keys are scalars).
        let copied = index.components.iter().skip(prefix_len).filter_map(|c| c.column()).filter_map(|c| row.field(c).ok()).map(word_heap::value).sum::<u64>();
        let appended = if index.components.len() - prefix_len < suffix_len { word_heap::value(row.field("id")?) } else { 0 };
        self.meter.heap(word_heap::slots::<Value>(suffix_len) + copied + appended)
    }

    /// Resume a merge lane using its already evaluated bounds. The original
    /// expressions still govern uniformity; freezing them into literals would
    /// lose facts such as a prefix pinned to `viewer`.
    fn scan_prepared(&mut self, scan: &Scan, prefix: Vec<Value>, bounds: Bounds, take: usize, word: Option<&WordRead>) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        self.scan_consumed(scan, prefix, bounds, take, word, None, false, false)
    }

    // @ref LLP 3000.013#5.1 — domain scalars consume the ordinary authorized scan one row at a time.
    pub(super) fn stream_aggregate(&mut self, scan: &Scan, projection: Option<&Expr>) -> Result<Value, RuntimeError> {
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
        let result = self.stream_aggregate_scoped(scan, projection);
        let coverage = self.components.scalar.take().expect("scalar coverage scope");
        self.components.scalar = outer;
        let value = result?;
        if !coverage.coverage().complete {
            self.scalar_unavailable = true;
            return Err(RuntimeError::Prediction(format!("{}: streaming aggregate needs complete domain coverage", scan.site)));
        }
        Ok(value)
    }

    fn stream_aggregate_scoped(&mut self, scan: &Scan, projection: Option<&Expr>) -> Result<Value, RuntimeError> {
        self.schema.refuse_private(&scan.table)?;
        let prefix = self.prefix_values(scan)?;
        let table = &self.schema.tables[&scan.table];
        let index = &table.indexes[&scan.index];
        let bounds = self.bounds(scan, table, index, Some(&prefix))?;
        let mut total = 0_i128;
        self.page_depth += 1;
        let result = self.scan_consumed(scan, prefix, bounds, self.take(&scan.take)?, None, Some((&mut total, projection)), false, false);
        self.page_depth -= 1;
        result?;
        if scan.existence && total == 0 && self.device && table.sync.as_ref().is_some_and(|s| s.horizon.is_some()) {
            let prefix = self.prefix_values(scan)?;
            let retained = self.retained_group(&scan.table, &scan.index, &prefix)?;
            self.horizon_coverage(scan, &prefix, retained);
        }
        // @ref LLP 3000.013#5.1 — a domain total has no partial scalar answer, including on a device with unknown coverage.
        self.meter.require_uncapped()?;
        Value::int(total).map_err(Into::into)
    }

    fn scan_consumed(&mut self, scan: &Scan, prefix: Vec<Value>, bounds: Bounds, take: usize, word: Option<&WordRead>, mut aggregate: Option<(&mut i128, Option<&Expr>)>, job_page: bool, metered_domain: bool) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        if self.schema.maintain_for(&scan.table).is_some_and(|m| m.parent_key.is_some()) {
            return Err(RuntimeError::Structural {code:"E_READ_THROUGH_SCAN",message:format!("{} at {} is keyed by its parent; read {}[parent] instead of scanning groups (guide maintains)",scan.table,scan.site,scan.table)});
        }
        let table = self.schema.table(&scan.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", scan.table)))?;
        let index = table.index(&scan.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", scan.table, scan.index)))?;
        let retained = if let Some(word) = word { word.retained } else { self.device && self.retained_group(&scan.table, &scan.index, &prefix)? };
        // Matching discovery already recorded these scope dependencies/coverage.
        // Borrow that verdict; do not reallocate identical sets for every word.
        if word.is_none() {
            self.read_tables.insert(scan.table.clone());
            self.rule_dependencies(&table.rules.read);
            self.aggregate_read_coverage(&scan.table, &scan.index, &prefix, &scan.site);
            if self.device && table.sync.is_none() { self.unknown_fact(&scan.table, &scan.index, &prefix, &scan.site); }
        }
        if word.is_some_and(|w| w.metered) { self.meter.heap(word_heap::text(&scan.site))?; }
        self.meter.at(&scan.site);
        let dir = match scan.order {
            Order::Asc => Dir::Asc,
            Order::Desc => Dir::Desc,
        };
        let visibility = if word.is_some_and(|w| w.metered) { rules::Visibility { uniform: true, decided_true: true } }
            else { rules::scan_visibility(self.schema, scan) };
        let parent_pinned = table.through.as_ref().is_some_and(|t| index.columns().iter().take(prefix.len()).any(|f| f == &t.reference));
        let always_visible = !parent_pinned && (word.is_some_and(|word| word.admitted) || self.trust_synced_read(table) || self.context.is_system() || visibility.decided_true || table.rules.read.is_uniformly_readable());
        if !visibility.uniform && !always_visible && !(self.device && table.sync.is_some()) {
            self.non_uniform = true; self.components.note(|frame| frame.non_uniform = true);
        }
        let mut visible: Vec<Value> = Vec::new();
        let mut keys: Vec<Vec<u8>> = Vec::new();
        let mut last_rule_visible: Option<Vec<u8>> = None;
        let mut has_more = false;
        let mut capped = false;
        let mut filter_interrupted = false;
        let mut uniform_verdict: Option<bool> = always_visible.then_some(true);
        // @ref LLP 3000.007#17 — an aborting page pass costs one examined unit before its verdict in every world; capped queries retain their cut contract.
        let aborting = self.meter.cut == crate::meter::Cut::Abort;
        if aborting && !self.read_charge(MeterKind::Examined, 1)? { return Ok((Vec::new(), Vec::new())); }
        if !always_visible && word.is_none() && let Some(rule) = rules::prefix_decision(self.schema, scan) {
            if !self.prefix_verdict(table, index, &prefix, &rule, visibility.uniform)? { return Ok((Vec::new(), Vec::new())); }
            if visibility.uniform { uniform_verdict = Some(true); }
        }
        // Non-uniform hidden runs cost examined rows, never a materialized
        // table. A uniform page already has its verdict before fetching.
        let horizon = table.sync.as_ref().and_then(|sync| sync.horizon.as_ref());
        let by_boundary = self.device && !scan.existence && horizon.is_some_and(|horizon| horizon.by == scan.index) && dir == Dir::Desc;
        let boundary = if by_boundary { self.tx.acquired_boundary(&scan.table, &scan.index, &prefix)? } else { None };
        let mut crossed = false;
        // Internal timeline scans retain complete source rows, including arbitrary
        // application payload. Use the same pre-allocation ledger as word scans.
        // Ordinary jobs may hold an empty Purge grant; that is not a transition.
        let metered_payload = word.is_some_and(|w| w.metered) || self.view_scan_active
            || matches!(&self.timeline_authority, Some(super::timeline_authority::Authority::Transition(_)));
        let streaming = aggregate.is_some();
        let transient = streaming || metered_domain;
        if metered_payload || transient { self.meter.heap(word_heap::bounds(&bounds))?; }
        let mut cursor = bounds.clone();
        // One retained cursor/key allowance, outside the transient row scope.
        // Key payload sizes vary: only grow this reservation when a
        // larger key is encountered, before its decode or clone can allocate.
        let mut cursor_heap = 0;
        let batch = if transient || job_page { 1 } else if visibility.uniform { take + 1 } else { (take + 1).max(32) };
        let mut row_heap = None;
        let mut row_bytes = 0;
        let mut consumed = 0;

        'outer: loop {
            if transient {
                if let Some(mark) = row_heap.take() { self.meter.release_row_heap(mark, row_bytes); }
                row_bytes = 0;
                if !self.read_charge(MeterKind::Steps, 1)? { break; }
                row_heap = Some(self.meter.mark());
            }
            let fetch_heap = self.meter.used.heap_bytes;
            // No adaptive lookahead, even for non-uniform rules. A later chunk
            // establishes exhaustion; every new candidate must first fit.
            let fetched = if metered_payload || transient || job_page { self.tx.scan_metered(&scan.table, &scan.index, &prefix, &cursor, dir, batch, &mut self.meter)? }
                else { self.tx.scan(&scan.table, &scan.index, &prefix, &cursor, dir, batch)? };
            if transient { row_bytes = self.meter.used.heap_bytes - fetch_heap; }
            // The store ledger prices allocation (shared memory row handles
            // are cheap). A view also retains the full source payload while
            // scanning, even for rejected rows and fields its shape omits.
            // Charge the entire fetched buffer before filtering or projecting.
            if self.view_scan_active { self.meter.heap(fetched.iter().map(|(row, _)| row.heap_bytes()).sum())?; }
            if fetched.is_empty() {
                break;
            }
            let fetched_len = fetched.len();
            for (mut row, key) in fetched {
                if let Some(crate::rows::AcquiredBoundary::Key(floor)) = &boundary {
                    if &key < floor { crossed = true; break 'outer; }
                }
                if !self.read_charge(MeterKind::Examined, 1)? {
                    capped = true;
                    break 'outer;
                }
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
                let materialized = if metered_payload || transient || job_page { word_heap::materialize(&row, table) } else { 0 };
                if materialized > 0 { self.meter.heap(materialized)?; }
                materialize_optional_fields(&mut row, table);
                if transient { row_bytes += materialized; }
                if self.expired(table, &row) {
                    // Gone, whatever the rule says; it cost one examined row.
                    continue;
                }
                // A search's further terms: a row a lane found under its
                // first word still has to carry the rest.
                let unmatched = if let Some(word) = word.filter(|word| !word.terms.is_empty()) {
                    let texts = word.fields.iter().filter_map(|field| row.field(field).ok().and_then(|value| value.as_str().ok()));
                    let tokens = if metered_payload { word_heap::tokenize(&mut self.meter, texts)? } else { crate::words::row_tokens(texts) };
                    !crate::words::row_matches(&tokens, &word.terms)
                } else { false };
                if unmatched {
                    continue;
                }
                let row_expiry_mark = self.next_expiry;
                let allowed = match uniform_verdict {
                    Some(verdict) => verdict && self.provisional_readable(&scan.table, &row)?,
                    None => {
                        let verdict = self.check_rule(&scan.table, Effect::Read, None, &row)?;
                        verdict
                    }
                };
                if self.read_capped() {
                    capped = true;
                    break 'outer;
                }
                if allowed {
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
                    let row = super::recorded::public_image(table, row);
                    if metered_payload || transient || job_page {
                        let scratch = word_heap::allocation(key.len());
                        self.meter.heap(scratch)?;
                        if transient { row_bytes += scratch; }
                    }
                    last_rule_visible = Some(key.clone());
                    if let Some(filter) = &scan.filter {
                        if metered_payload { self.meter.heap(word_heap::text("$filter") + word_heap::insertion::<String, Value>(self.env.len()))?; }
                        let prior = self.env.insert("$filter".into(), row.clone());
                        // @ref LLP 3000.007#20.22 — predicate reads are below the page; restore depth even when evaluating one fails.
                        let page_depth = self.page_depth;
                        self.page_depth += 1;
                        self.filter_depth += 1;
                        let matched = self.expr(filter);
                        self.filter_depth -= 1;
                        self.page_depth = page_depth;
                        match prior { Some(value) => { self.env.insert("$filter".into(), value); }, None => { self.env.remove("$filter"); } }
                        if metered_payload { self.meter.heap(word_heap::text(&scan.site))?; }
                        self.meter.at(&scan.site);
                        if self.read_capped() && (matched.is_ok() || matches!(&matched, Err(RuntimeError::Bound { kind, .. }) if *kind != MeterKind::HeapBytes)) {
                            capped = true;
                            // The paved existence predicate has no verdict when its
                            // one-row search starves. Retry that membership; general
                            // counting predicates keep their existing forward progress.
                            filter_interrupted = self.schema.timelines.iter().any(|t| scan.table == t.table("Feed")) || existence_predicate(filter);
                            break 'outer;
                        }
                        let matched = matched?.as_bool()?;
                        if !matched { continue; }
                    }
                    if let Some((total, projection)) = &mut aggregate {
                        let amount = if let Some(projection) = projection {
                            let prior = self.env.insert("$filter".into(), row.clone());
                            let value = self.expr(projection);
                            match prior { Some(value) => { self.env.insert("$filter".into(), value); }, None => { self.env.remove("$filter"); } }
                            value?.as_int()? as i128
                        } else { 1 };
                        **total += amount;
                        consumed += 1;
                        if scan.existence && consumed == take { break 'outer; }
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
                        self.meter.heap(row.heap_bytes())?;
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
                    if (scan.existence || job_page) && visible.len() == take { break 'outer; }
                    if scan.filter.is_some() && visible.len() == take { has_more = true; break 'outer; }
                } else {
                    self.next_expiry = row_expiry_mark;
                }
            }
            if fetched_len < batch {
                break;
            }
        }
        if let Some(mark) = row_heap { self.meter.release_row_heap(mark, row_bytes); }
        // @ref LLP 3000.007#20.22 — a device page is complete by its acquisition boundary, carried on the wire, not by a count.
        // An existence probe is exempt (W13c): a held witness below the floor still proves existence.
        if self.device && !scan.existence && horizon.is_some() {
            let known = if by_boundary {
                match &boundary {
                    Some(crate::rows::AcquiredBoundary::Whole) => true,
                    Some(crate::rows::AcquiredBoundary::Key(floor)) => {
                        // A full page stops at its last selected key. A shorter
                        // page stops at its range end, which may cross the floor
                        // even when no older row happens to be held.
                        let stops_inside = visible.len() == take && keys.last().is_some_and(|key| key >= floor);
                        let range_inside = crate::rows::scan_range(&prefix, &bounds, dir).is_none_or(|(lo, _)| lo >= *floor);
                        stops_inside || (!crossed && range_inside)
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
        if self.page_depth == 0 && !scan.opaque_cursor && has_more && scan.filter.is_none() {
            self.page_overflow = true; self.components.note(|frame| frame.overflow = true);
        }
        if self.page_depth == 0 && scan.opaque_cursor {
            let components = index.components.len();
            // @ref LLP 3000.007#5.6 — a full page positions after its last result; a cut may pass filter rejects, never rule-hidden keys.
            let position = if visible.len() == take { keys.last() } else { last_rule_visible.as_ref().or_else(|| keys.last()) };
            // A rule-visible membership whose existence filter was cut has no
            // verdict yet. Retry it inclusively to keep its last-on-page match.
            let continues = if capped || self.non_uniform || self.word_cut_at.is_some() { position.is_some() } else { has_more };
            let mut next = if continues { position.and_then(|key| crate::key::decode(key)).map(|values| values.into_iter().take(components).skip(prefix.len()).collect()) } else { None };
            // @ref LLP 3000.007#20.24.1 — retry an interrupted predicate once; no emission at the same inclusive input position must not advertise a loop.
            if filter_interrupted && visible.is_empty() && next.is_some() && next == bounds.at_or_after { next = None; }
            self.record_page(scan.site.clone(), PagePosition { variant: scan.variant, view_suffix: None, table: scan.table.clone(), index: scan.index.clone(), order: scan.order, prefix_len: prefix.len(), prefix: (scan.merge_site.is_none() && word.is_none()).then(|| prefix.clone()), merge: scan.merge_site.is_some() || word.is_some(), interrupted: false, inclusive: filter_interrupted, shape_positions: Vec::new(), shape_resume: super::shaping::Resume::Never, next }, visible.iter())?;
        }
        Ok((visible, keys))
    }

    // @ref LLP 3000.007#19.2 — loss is monotone across executions; only the last execution at an owned site carries next.
    fn record_page<'r>(&mut self, site: String, mut page: PagePosition, rows: impl Iterator<Item = &'r Value>) -> Result<(), RuntimeError> {
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
    pub(super) fn merge(&mut self, merge: &Merge) -> Result<Vec<Value>, RuntimeError> {
        self.merge_with_words(merge, None)
    }

    fn merge_with_words(&mut self, merge: &Merge, word: Option<&WordRead>) -> Result<Vec<Value>, RuntimeError> {
        if merge.view.is_some() { return self.merge_view(merge); }
        // Keep the disclosure-sensitive non-uniform scan traversal unchanged.
        // @ref LLP 3000#7-decisions-during-execution — lazy uniform merge lanes
        if rules::lazy_merge(self.schema, merge) {
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
        if first.scan.opaque_cursor
            && let Some(after) = first.scan.after.as_deref()
            && let Value::String(token) = self.expr(after)?
        {
            crate::cursor::check_variant(&decode_cursor(self.schema, &token).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?, merge.variant)?;
            decode_cursor_for(self.schema, &token, &first.scan.table, &first.scan.index, order, &suffix).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
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
                if (lane_scan.table != first.scan.table || lane_scan.index != first.scan.index) && lane_scan.opaque_cursor
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
        if self.page_depth == 0 && !first.scan.opaque_cursor && has_more {
            self.page_overflow = true; self.components.note(|frame| frame.overflow = true);
        }
        if self.page_depth == 0 && first.scan.opaque_cursor {
            let continues = has_more && self.meter.capped_at.is_none() && self.word_cut_at.is_none();
            let next = if continues { candidates.last().map(|(key, _)| key.clone()) } else { None };
            self.record_page(merge.site.clone(), PagePosition { variant: merge.variant, view_suffix: None, table: first.scan.table.clone(), index: first.scan.index.clone(), order, prefix_len, prefix: None, merge: true, interrupted: false, inclusive: false, shape_positions: Vec::new(), shape_resume: super::shaping::Resume::Never, next }, candidates.iter().map(|(_, row)| row))?;
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
            if seen.insert(key) { self.meter.heap(value.heap_bytes() + std::mem::size_of::<Value>() as u64)?; unique.push(value); }
        }
        if let Some(prior) = prior { self.env.insert(lane.binding.clone(), prior); } else { self.env.remove(&lane.binding); }
        Ok(Box::new(unique.into_iter()))
    }

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

pub(super) struct PrefixProbe<'a, 'b> { pub(super) runner: &'a mut Runner<'b> }
impl Probe for PrefixProbe<'_, '_> {
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        self.runner.rule_probe_exists(table, index, key, equalities)
    }
    fn created(&mut self, table: &str, index: &str, key: &[Value]) -> bool { self.runner.created(table, index, key) }
}

#[cfg(all(test, feature = "sqlite"))]
#[path = "../../tests/read_verdict/mod.rs"]
mod read_verdict_tests;

// Presence selection does not turn an interrupted one-witness predicate into
// a negative verdict. Both alternatives must retain that exact consumer.
fn existence_predicate(value: &Expr) -> bool {
    match value {
        Expr::Binary { op: BinaryOp::Gt, left, right } => matches!(right.as_ref(), Expr::Literal(Value::Int(0)))
            && matches!(left.as_ref(), Expr::Builtin { builtin: Builtin::Count, args }
                if matches!(args.as_slice(), [Expr::Scan(inner)] if inner.existence)),
        Expr::Block { body, value } => {
            let Expr::Variable(target) = value.as_ref() else { return false; };
            let Some(Stmt::If { then_body, else_body, .. }) = body.last() else { return false; };
            [then_body, else_body].iter().all(|body| matches!(body.last(), Some(Stmt::Assign { name, value })
                if name == target && existence_predicate(value)))
        }
        _ => false,
    }
}
