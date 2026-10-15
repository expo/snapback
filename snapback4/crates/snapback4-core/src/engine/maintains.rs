//! Aggregate deltas, derived rebuilds and the device overlay.
use super::runner::Runner;
use super::write::Origin;
use crate::error::{MeterKind, RuntimeError};
use crate::schema::{Maintain, MaintainKind, maintained_id};
#[cfg(feature = "sqlite")]
use crate::schema::materialize_optional_fields;
#[cfg(feature = "sqlite")]
use crate::rows::{Bounds, Dir};
use crate::value::{I53_MAX, I53_MIN, Value};
#[cfg(feature = "sqlite")]
use crate::value::canonical_json;
use std::collections::BTreeMap;

const GLOBAL: &str = "$global";

fn target_group_key(maintain: &Maintain, key: &[Value]) -> Vec<Value> {
    if maintain.by.is_empty() { vec![Value::Bool(true)] } else { key.to_vec() }
}

#[cfg(feature = "sqlite")]
fn has_legacy_maintained_reference(
    kind: &crate::schema::ColumnType,
    ids: &BTreeMap<String, BTreeMap<String, String>>,
) -> bool {
    match kind {
        crate::schema::ColumnType::Ref { table } => ids.get(table).is_some_and(|ids| !ids.is_empty()),
        crate::schema::ColumnType::Optional(inner)
        | crate::schema::ColumnType::List { of: inner, .. }
        | crate::schema::ColumnType::ListRange { of: inner, .. } => has_legacy_maintained_reference(inner, ids),
        _ => false,
    }
}

#[cfg(feature = "sqlite")]
fn rewrite_legacy_maintained_reference(
    kind: &crate::schema::ColumnType,
    value: &mut Value,
    ids: &BTreeMap<String, BTreeMap<String, String>>,
) -> bool {
    match (kind, value) {
        (crate::schema::ColumnType::Ref { table }, Value::Id(id)) => {
            let Some(next) = ids.get(table).and_then(|ids| ids.get(id)) else { return false };
            *id = next.clone();
            true
        }
        (crate::schema::ColumnType::Optional(inner), value) => rewrite_legacy_maintained_reference(inner, value, ids),
        (crate::schema::ColumnType::List { of, .. } | crate::schema::ColumnType::ListRange { of, .. }, Value::Array(values)) =>
            values.iter_mut().fold(false, |changed, value| rewrite_legacy_maintained_reference(of, value, ids) || changed),
        _ => false,
    }
}

impl Runner<'_> {
    // @ref LLP 3000.022#14.3 — no predicted delta enters receipt-derived state.
    pub(super) fn defer_receipt_maintain(&self, m: &Maintain) -> bool {
        self.device && self.schema.receipt_dependencies.contains_key(&m.target)
    }

    // Cache ordinary group keys once per target/query. Predicates and receipt
    // fields are never evaluated; unknown/computed keys conservatively freeze
    // the target. An unpinned read is incomplete if any group is dirty, while
    // each returned row still decides independently whether to recount.
    #[inline(never)]
    pub(super) fn receipt_maintain_pending(&mut self, m: &Maintain, group: Option<&[Value]>) -> Result<bool, RuntimeError> {
        if !self.defer_receipt_maintain(m) { return Ok(false); }
        if !self.receipt_pending_groups.contains_key(&m.target) {
            let fields = if let Some(k) = &m.row_key { vec![k.source_key.clone()] }
                else { m.by.iter().map(|f| m.aliases.get(f).unwrap_or(f).clone()).collect() };
            let mut groups = self.receipt_overlay_groups(&m.source, &fields, !m.computed.is_empty())?;
            if let Some(k) = &m.row_key {
                let member = self.receipt_overlay_groups(&k.table, std::slice::from_ref(&k.member_key), false)?;
                groups = groups.zip(member).map(|(mut source, member)| { source.extend(member); source });
            }
            self.receipt_pending_groups.insert(m.target.clone(), groups);
        }
        let dirty = self.receipt_pending_groups[&m.target].as_ref().is_none_or(|keys|
            group.map_or(!keys.is_empty(), |group| keys.iter().any(|key| key == group)));
        if dirty {
            self.value_source_incomplete = true;
            self.components.note(|frame| frame.pending = true);
        }
        Ok(dirty)
    }

    fn receipt_overlay_groups(&self, table: &str, fields: &[String], computed: bool) -> Result<Option<Vec<Vec<Value>>>, RuntimeError> {
        if !self.tx.has_provisional(table)? { return Ok(Some(Vec::new())); }
        if computed || fields.iter().any(|f| self.schema.receipt_dependencies.get(table).is_some_and(|owned| owned.contains(f))) {
            return Ok(None);
        }
        self.tx.provisional_groups(table, fields)
    }

    // Recover a read's parent/group from the pinned index. A member point uses
    // one ordinary-key lookup; a scan without the parent stays conservative.
    pub(super) fn receipt_read_group(&mut self, m: &Maintain, index: &str, key: &[Value]) -> Result<Option<Vec<Value>>, RuntimeError> {
        if !self.defer_receipt_maintain(m) { return Ok(None); }
        let columns = self.schema.tables[&m.target].indexes[index].columns();
        let pinned = |field: &str| columns.iter().position(|c| c == field).and_then(|i| key.get(i)).cloned();
        if let Some(k) = &m.row_key {
            if let Some(parent) = pinned(&k.member_key) { return Ok(Some(vec![parent])); }
            if let Some(id) = pinned("member").or_else(|| pinned("id")) {
                let row = self.metered_scan(|r, scope| r.tx.get(scope, &k.table, id.as_str()?))?;
                return Ok(row.and_then(|row| row.field(&k.member_key).ok().cloned()).map(|v| vec![v]));
            }
            return Ok(None);
        }
        Ok(m.by.iter().map(|f| pinned(f)).collect())
    }

    pub(super) fn maintain(&mut self, source: &str, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
        self.receipt_pending_groups.clear();
        // Inserts ordinarily charge their actual aggregate work. A deferred
        // predicate cannot select that work on a device, so use the same public
        // worst-case reservation as update/delete before skipping it. Already
        // prepaid writes must not pay twice.
        if self.device && !self.maintain_prepaid && self.schema.maintains.iter().any(|m|
            m.source == source && m.private.is_none() && m.row_key.is_none() && (self.schema.receipt_dependencies.contains_key(&m.target) || self.schema.tables[&m.target].sync.is_none())) {
            self.reserve_maintains(source, &self.schema.tables[source])?;
        }
        self.maintain_row_views(source, old, new)?;
        let maintains = self.schema.maintains.iter().filter(|maintain| maintain.source == source && maintain.row_key.is_none());
        for maintain in maintains {
            if self.defer_receipt_maintain(maintain) || (self.device && self.schema.tables[&maintain.target].sync.is_none()) { continue; }
            let source_bytes = super::write_target::row_copy_ceiling(&self.schema.tables[&maintain.source]);
            let target = &self.schema.tables[&maintain.target];
            let bytes = source_bytes.saturating_mul(2).saturating_add(super::write_target::row_copy_ceiling(target).saturating_mul(16 + 4 * target.indexes.len() as u64));
            let prepaid = self.maintain_prepaid;
            if maintain.private.is_some() && self.column_prepaid { self.maintain_prepaid = true; }
            let result = self.maintain_scratch(bytes, |runner| runner.maintain_one(maintain, old, new));
            self.maintain_prepaid = prepaid;
            result?;
        }
        Ok(())
    }

    // @ref LLP 3000.007#20.9 — reserve interpreted images, both keys, targets and index buffers before allocation; release transient ownership on every exit.
    pub(super) fn maintain_scratch<T>(&mut self, bytes: u64, work: impl FnOnce(&mut Self) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        if self.maintain_prepaid { return work(self); }
        self.meter.heap(bytes)?;
        let result = work(self);
        self.meter.used.heap_bytes = self.meter.used.heap_bytes.saturating_sub(bytes);
        result
    }

    fn maintain_one(&mut self, maintain: &Maintain, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
        let table = self.schema.table(&maintain.source).expect("validated");
        let mut changes: Vec<(Vec<Value>, i128)> = Vec::new();
        for (image, direction) in [(old, -1), (new, 1)] {
            let Some(image) = image else { continue };
            self.charge_maintain(MeterKind::Steps, maintain.evaluation_steps())?;
            let image = crate::schema::row_image(image, table);
            if !maintain.selected(&image) { continue; }
            let key = maintain.source_key(&image);
            let change = delta(maintain, &image, direction)?;
            if let Some(existing) = changes.iter_mut().find(|(k, _)| *k == key) { existing.1 += change; }
            else { changes.push((key, change)); }
        }
        for (key, change) in changes {
            #[cfg(feature = "sqlite")]
            if let Some(retiring) = self.retiring.as_mut() {
                let entry = retiring.aggregates.entry((maintain.target.clone(), canonical_json(&key))).or_insert_with(|| (key, 0));
                entry.1 = entry.1.checked_add(change).ok_or_else(|| aggregate_overflow(maintain))?;
                continue;
            }
            if change != 0 || self.live_sum(maintain) {
                self.apply_aggregate(maintain, key, change, None)?;
            }
        }
        Ok(())
    }

    /// Apply a retirement's net aggregate changes, one per target row, in
    /// key order. Only a total the commit really ends with can overflow.
    #[cfg(feature = "sqlite")]
    pub(super) fn apply_retired_aggregates(&mut self, changes: BTreeMap<(String, String), (Vec<Value>, i128)>) -> Result<(), RuntimeError> {
        let schema = self.schema;
        for ((target, _), (key, change)) in changes {
            let maintain = schema.maintain_for(&target).ok_or_else(|| RuntimeError::Schema(format!("missing maintain for {target}")))?;
            if change != 0 || self.live_sum(maintain) {
                self.apply_aggregate(maintain, key, change, None)?;
            }
        }
        Ok(())
    }

    #[cfg(feature = "sqlite")]
    pub(crate) fn rebuild_maintain_reported(&mut self, maintain: &Maintain, report: &mut crate::store::adoption_report::AdoptionReport) -> Result<(), RuntimeError> {
        let started = std::time::Instant::now();
        self.rebuilt_source_rows = 0;
        self.rebuild_maintain(maintain)?;
        let rows = self.rebuilt_source_rows;
        report.views.push(crate::store::adoption_report::ViewBuild { name: maintain.label(), rows, elapsed: started.elapsed() });
        Ok(())
    }

    /// Derive every legacy-to-digest aggregate id map to a fixed point, then
    /// rewrite typed references before rebuilding the target rows. The fixed
    /// point matters when one aggregate groups by a reference to another.
    /// Every pass is inside the adoption writer transaction, so no reader can
    /// observe a dangling intermediate reference.
    #[cfg(feature = "sqlite")]
    pub(crate) fn rewrite_legacy_maintained_references(&mut self, maintains: &[Maintain], previous: Option<&crate::schema::Schema>) -> Result<u64, RuntimeError> {
        let mut legacy = Vec::new();
        for maintain in maintains.iter().filter(|maintain| maintain.private.is_none() && maintain.row_key.is_none()) {
            // The durable legacy address is the predecessor's canonical
            // logical group tuple. Decode that address with predecessor types:
            // candidate projection may already have removed predecessor group
            // columns when adoption also changes the maintain declaration.
            let identity_schema = previous.unwrap_or(self.schema);
            let identity_maintain = identity_schema.maintain_for(&maintain.target)
                .filter(|old| old.private.is_none() && old.row_key.is_none())
                .unwrap_or(maintain);
            let identity_target = identity_schema.table(&maintain.target)
                .unwrap_or_else(|| &self.schema.tables[&maintain.target]);
            let fields: Vec<_> = identity_maintain.group_fields().into_iter().map(|field| {
                let kind = identity_target.columns.get(&field).expect("validated maintain group").clone();
                (field, kind)
            }).collect();
            let mut rows = Vec::new();
            let mut bounds = Bounds::default();
            loop {
                let page = self.metered_scan(|runner, allowance| runner.tx.scan(allowance, &maintain.target, "byId", &[], &bounds, Dir::Asc, 256))?;
                if page.is_empty() { break; }
                for (row, encoded) in page {
                    bounds.after = crate::key::decode(&encoded);
                    let old = row.field("id")?.as_str()?.to_owned();
                    let address = crate::json_codec::from_text::<Vec<Value>>(&old).ok()
                        .filter(|key| key.len() == fields.len());
                    let values = match address {
                        Some(key) => key,
                        None => fields.iter().map(|(field, _)| Ok(row.field(field)?.clone()))
                            .collect::<Result<Vec<_>, RuntimeError>>()?,
                    };
                    let key = fields.iter().zip(values).map(|((_, kind), value)| (kind.clone(), value)).collect();
                    rows.push((old, key));
                }
            }
            legacy.push((maintain.target.clone(), rows));
        }

        let mut ids: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
        let mut settled = false;
        // One dependency edge can settle per pass.  Count identities rather
        // than target tables: one aggregate target may contain an arbitrary
        // acyclic chain of references to other rows in that same target.
        let identity_count = legacy.iter().map(|(_, rows)| rows.len()).sum::<usize>();
        // The first pass also materializes empty target maps, so retain one
        // additional observation pass even when every target is empty.
        for _ in 0..=identity_count.saturating_add(1) {
            let mut next_ids: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
            for (target, rows) in &legacy {
                let target_ids = next_ids.entry(target.clone()).or_default();
                for (old, key) in rows {
                    let key: Vec<_> = key.iter().map(|(kind, value)| {
                        let mut value = value.clone();
                        rewrite_legacy_maintained_reference(kind, &mut value, &ids);
                        value
                    }).collect();
                    let next = maintained_id(&key);
                    if old != &next { target_ids.insert(old.clone(), next); }
                }
            }
            if next_ids == ids {
                ids = next_ids;
                settled = true;
                break;
            }
            ids = next_ids;
        }
        if !settled {
            return Err(RuntimeError::Schema("legacy aggregate identity references form a cycle".into()));
        }

        let references: Vec<_> = self.schema.tables.iter().filter_map(|(name, table)| {
            let columns: Vec<_> = table.columns.iter().filter_map(|(column, kind)|
                has_legacy_maintained_reference(kind, &ids).then(|| (column.clone(), kind.clone())))
                .collect();
            (!columns.is_empty()).then(|| (name.clone(), table.clone(), columns))
        }).collect();
        let mut rewritten = 0_u64;
        for (name, table, columns) in references {
            let mut bounds = Bounds::default();
            loop {
                let page = self.metered_scan(|runner, allowance| runner.tx.scan(allowance, &name, "byId", &[], &bounds, Dir::Asc, 256))?;
                if page.is_empty() { break; }
                for (old, encoded) in page {
                    bounds.after = crate::key::decode(&encoded);
                    let mut next = old.clone();
                    let mut changed = false;
                    if let Value::Row(fields) | Value::Map(fields) = &mut next {
                        for (column, kind) in &columns {
                            let Some(value) = fields.get_mut(column) else { continue };
                            changed |= rewrite_legacy_maintained_reference(kind, value, &ids);
                        }
                    }
                    if changed {
                        self.tx.put(&name, &table, &next, Some(&old))?;
                        rewritten = rewritten.saturating_add(1);
                    }
                }
            }
        }
        Ok(rewritten)
    }

    /// Build one aggregate from the rows in the store: the target's rows go,
    /// then every source row contributes once. A schema change that adds or
    /// redefines a `maintain` calls this, so a count over existing rows is
    /// right from its first read (day two, LLP 2000.000 §11.2).
    #[cfg(feature = "sqlite")]
    pub(crate) fn rebuild_maintain(&mut self, maintain: &Maintain) -> Result<(), RuntimeError> {
        let heap = self.meter.used.heap_bytes;
        let saved = self.column_rebuild;
        self.column_rebuild |= maintain.private.is_some();
        let result = self.rebuild_maintain_inner(maintain);
        self.column_rebuild = saved;
        self.meter.used.heap_bytes = heap;
        result
    }

    #[cfg(feature = "sqlite")]
    fn rebuild_maintain_inner(&mut self, maintain: &Maintain) -> Result<(), RuntimeError> {
        if maintain.row_key.is_some() { return self.rebuild_row_view(maintain); }
        let target = self.schema.table(&maintain.target).expect("validated");
        let mut bounds = Bounds::default();
        let target_bytes = super::write_target::row_copy_ceiling(target).saturating_mul(16 + 4 * target.indexes.len() as u64);
        self.meter.heap(target_bytes.saturating_mul(256))?;
        loop {
            let page = self.metered_scan(|runner, allowance| runner.tx.scan(allowance, &maintain.target, "byId", &[], &bounds, Dir::Asc, 256))?;
            if page.is_empty() { break; }
            for (existing, key) in page {
                bounds.after = crate::key::decode(&key);
                self.refuse_timeline_write(&maintain.target, crate::schema::Effect::Delete)?;
                let entries = self.tx.delete(&maintain.target, target, &existing)?;
                self.charge_maintain(MeterKind::IndexEntries, entries)?;
                self.row_changed(&maintain.target, Some(&existing), None, Origin::Maintained)?;
            }
        }
        let source = self.schema.table(&maintain.source).expect("validated");
        self.meter.heap(super::write_target::row_copy_ceiling(source).saturating_mul(256))?;
        let mut totals: BTreeMap<String, (Vec<Value>, i128)> = BTreeMap::new();
        bounds = Bounds::default();
        loop {
            let page = self.metered_scan(|runner, allowance| runner.tx.scan(allowance, &maintain.source, "byId", &[], &bounds, Dir::Asc, 256))?;
            if page.is_empty() { break; }
            for (mut image, key) in page {
                self.rebuilt_source_rows += 1;
                bounds.after = crate::key::decode(&key);
                materialize_optional_fields(&mut image, source);
                self.charge_maintain(MeterKind::Examined, 1)?;
                self.charge_maintain(MeterKind::Steps, maintain.evaluation_steps())?;
                if !maintain.selected(&image) { continue; }
                // @ref LLP 3000.028#6 — a total unique owner key has one contribution; backfill streams bounded pages instead of retaining all lifetime keys in a totals map.
                if maintain.own_keys.is_some() {
                    let heap = self.meter.used.heap_bytes;
                    self.meter.heap(target_bytes)?;
                    self.apply_aggregate(maintain, maintain.source_key(&image), 1, Some(true))?;
                    self.meter.used.heap_bytes = heap;
                    continue;
                }
                self.meter.heap(target_bytes)?;
                let key = maintain.source_key(&image);
                let change = delta(maintain, &image, 1)?;
                let entry = match totals.entry(canonical_json(&key)) {
                    std::collections::btree_map::Entry::Occupied(entry) => {
                        self.meter.used.heap_bytes -= target_bytes;
                        entry.into_mut()
                    }
                    std::collections::btree_map::Entry::Vacant(entry) => entry.insert((key, 0)),
                };
                entry.1 = entry.1.checked_add(change).ok_or_else(|| aggregate_overflow(maintain))?;
            }
        }
        for (_, (key, change)) in totals {
            if change != 0 || self.live_sum(maintain) {
                self.apply_aggregate(maintain, key, change, Some(true))?;
            }
        }
        Ok(())
    }

    fn live_sum(&self, maintain: &Maintain) -> bool {
        matches!(maintain.kind, MaintainKind::Sum { .. }) && self.schema.table(&maintain.source).is_some_and(|source| source.is_expiring())
    }

    /// A zero sum is still a group while source rows remain: one signed
    /// contribution may expire before the other. Keep its candidate row so
    /// a scan, snapshot and offline replica can discover the later live sum.
    fn aggregate_source_present(&mut self, maintain: &Maintain, key: &[Value]) -> Result<bool, RuntimeError> {
        // One returned source image and its encoded key (MemoryRows also materializes count_prefix).
        let bytes = super::write_target::row_copy_ceiling(&self.schema.tables[&maintain.source]).saturating_mul(2);
        self.maintain_scratch(bytes, |runner| {
            let source = &runner.schema.tables[&maintain.source];
            let index = maintain.contribution_index();
            if !source.indexes.contains_key(&index) { return Err(RuntimeError::Schema(format!("maintain {} needs its contribution index", maintain.target))); }
            runner.charge_maintain(MeterKind::Examined, 1)?;
            let present = runner.metered_scan(|runner, allowance| runner.tx.count_prefix(allowance, &maintain.source, &index, key, 1))? != 0;
            // @ref LLP 3000.007#20.9 — a local positive witness keeps zero; absence needs complete, currently held source coverage.
            if !present && runner.device && !runner.aggregate_source_complete(maintain, key)? {
                runner.unknown_fact(&maintain.source, &index, key, "zero-sum occupancy");
                return Err(RuntimeError::Prediction("the zero-sum group's source occupancy is not known locally; queued without a predicted row".into()));
            }
            Ok(present)
        })
    }

    fn aggregate_source_complete(&mut self, maintain: &Maintain, key: &[Value]) -> Result<bool, RuntimeError> {
        let source = &self.schema.tables[&maintain.source];
        if source.sync.as_ref().is_none_or(|sync| sync.horizon.is_some()) || self.schema.maintain_subset_unknown(&maintain.target) { return Ok(false); }
        // The target has the same bare audience keys, but no source horizon.
        if !self.upsert_absence_proven(&maintain.target, "byGroup", &target_group_key(maintain, key))? { return Ok(false); }
        for (name, index) in &source.indexes {
            let values = index.columns().iter().map_while(|column| maintain.by.iter().position(|field| field == column).map(|n| key[n].clone())).collect::<Vec<_>>();
            if self.retained_group(&maintain.source, name, &values)? { return Ok(false); }
        }
        Ok(true)
    }

    fn apply_aggregate(&mut self, maintain: &Maintain, key: Vec<Value>, change: i128, source_present: Option<bool>) -> Result<(), RuntimeError> {
        if self.schema.timelines.iter().any(|t| t.owns(&maintain.target)) {
            return Err(super::timeline::refusal("E_TIMELINE_OWNED", "timeline-owned tables cannot be aggregate targets; maintain a mapped application table instead"));
        }
        let id = maintained_id(&key);
        let target = self.schema.table(&maintain.target).expect("validated");
        self.charge_maintain(MeterKind::Examined, 1)?;
        let existing = self.metered_scan(|runner, allowance| runner.tx.get(allowance, &maintain.target, &id))?;
        let target_key = target_group_key(maintain, &key);
        if self.device && existing.is_none() && !self.upsert_absence_proven(&maintain.target, "byGroup", &target_key)? {
            self.unknown_fact(&maintain.target, "byGroup", &target_key, "aggregate base");
            return Err(RuntimeError::Prediction("the affected aggregate value or its absence is not known locally; queued without a predicted row".into()));
        }
        let old_value = existing.as_ref().and_then(|row| row.field("value").ok()).map(Value::as_int).transpose()?.unwrap_or(0);
        let next = i128::from(old_value) + change;
        if !(I53_MIN as i128..=I53_MAX as i128).contains(&next) {
            return Err(aggregate_overflow(maintain));
        }
        let keep_zero = next == 0 && self.live_sum(maintain) && match source_present {
            Some(present) => present,
            None => self.aggregate_source_present(maintain, &key)?,
        };
        if next == 0 && !keep_zero {
            if let Some(existing) = existing {
                self.refuse_timeline_write(&maintain.target, crate::schema::Effect::Delete)?;
                let entries = self.tx.delete(&maintain.target, target, &existing)?;
                self.charge_maintain(MeterKind::IndexEntries, entries)?;
                self.row_changed(&maintain.target, Some(&existing), None, Origin::Maintained)?;
            }
            self.mirror_column(maintain, &key, 0)?;
            return Ok(());
        }
        let mut row = crate::small_map::collect([("id".to_owned(), Value::Id(id.clone())), ("value".to_owned(), Value::Int(next as i64))]);
        for (field, value) in maintain.group_fields().iter().zip(key.iter().cloned()) {
            row.insert(field.clone(), value);
        }
        // @ref LLP 3000.013.001#3-global-maintained-view-representation — stores index the one logical empty group by a hidden constant.
        if maintain.by.is_empty() { row.insert(GLOBAL.into(), Value::Bool(true)); }
        let row = Value::Row(row.into());
        if existing.as_ref() == Some(&row) { return Ok(()); }
        let entries = self.tx.put(&maintain.target, target, &row, existing.as_ref())?;
        self.charge_maintain(MeterKind::IndexEntries, entries)?;
        self.row_changed(&maintain.target, existing.as_ref(), Some(&row), Origin::Maintained)?;
        self.mirror_column(maintain, &key, next as i64)
    }
}

pub(super) fn delta(maintain: &Maintain, source: &Value, direction: i64) -> Result<i128, RuntimeError> {
    Ok(match &maintain.kind {
        MaintainKind::Count => i128::from(direction),
        MaintainKind::Sum { of } => i128::from(direction).checked_mul(i128::from(source.field(of)?.as_int()?)).ok_or_else(|| aggregate_overflow(maintain))?,
    })
}

// @ref LLP 3000.007#17 — an internal sum names its maintain and column, never a retained contribution or computed value.
pub(super) fn aggregate_overflow(maintain: &Maintain) -> RuntimeError {
    RuntimeError::AggregateOverflow { maintain: maintain.private.as_ref().map_or_else(|| maintain.target.clone(), |o|o.table.clone()), column: maintain.private.as_ref().map_or_else(|| "value".into(), |o|o.column.clone()) }
}

#[cfg(all(test, feature = "sqlite"))]
mod timeline_tests {
    use super::*;
    #[test]
    fn timeline_owned_tables_cannot_be_maintain_targets() {
        let schema = crate::engine::timeline_authority::write_tests::schema();
        let mut store = crate::Store::memory().unwrap(); store.install(&schema).unwrap();
        let tx = store.transaction().unwrap();
        let mut runner = Runner::new(&tx, &schema, crate::Context::system().at(1), crate::meter::Meter::new(crate::Ceilings::unbounded(),crate::meter::Cut::Abort),0);
        let mut guard = runner.timeline_scope(crate::engine::timeline_authority::Authority::Transition("feed".into()));
        for suffix in crate::schema::timeline::OWNED_SUFFIXES {
            let maintain = Maintain { own_keys: None, row_key: None, parent_key: None, aliases: Default::default(), target: format!("feed{suffix}"), source: "follows".into(), by: vec!["readerId".into()],
                kind: MaintainKind::Count, filter: None, computed: Default::default(), residency: Default::default(), readable: None, private: None };
            let result = guard.apply_aggregate(&maintain, vec![Value::Id("reader".into())], 1, None);
            assert_eq!(result.unwrap_err().code(), "E_TIMELINE_OWNED");
        }
    }
}
