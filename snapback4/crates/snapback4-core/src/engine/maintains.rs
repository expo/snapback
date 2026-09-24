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

impl Runner<'_> {
    pub(super) fn maintain(&mut self, source: &str, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
        let maintains: Vec<Maintain> = self.schema.maintains.iter().filter(|maintain| maintain.source == source).cloned().collect();
        for maintain in maintains {
            if self.device && self.schema.tables[&maintain.target].sync.is_none() { continue; }
            let source_bytes = super::write_target::row_copy_ceiling(&self.schema.tables[&maintain.source]);
            let target = &self.schema.tables[&maintain.target];
            let bytes = source_bytes.saturating_mul(2).saturating_add(super::write_target::row_copy_ceiling(target).saturating_mul(16 + 4 * target.indexes.len() as u64));
            let prepaid = self.maintain_prepaid;
            if maintain.private.is_some() && self.column_prepaid { self.maintain_prepaid = true; }
            let result = self.maintain_scratch(bytes, |runner| runner.maintain_one(&maintain, old, new));
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
        let table = self.schema.table(&maintain.source).expect("validated").clone();
        let mut changes: Vec<(Vec<Value>, i128)> = Vec::new();
        for (image, direction) in [(old, -1), (new, 1)] {
            let Some(image) = image else { continue };
            self.charge_maintain(MeterKind::Steps, maintain.evaluation_steps())?;
            let image = crate::schema::row_image(image, &table);
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
        let target = self.schema.table(&maintain.target).expect("validated").clone();
        let mut bounds = Bounds::default();
        let target_bytes = super::write_target::row_copy_ceiling(&target).saturating_mul(16 + 4 * target.indexes.len() as u64);
        self.meter.heap(target_bytes.saturating_mul(256))?;
        loop {
            let page = self.tx.scan(&maintain.target, "byId", &[], &bounds, Dir::Asc, 256)?;
            if page.is_empty() { break; }
            for (existing, key) in page {
                bounds.after = crate::key::decode(&key);
                self.refuse_timeline_write(&maintain.target, crate::schema::Effect::Delete)?;
                let entries = self.tx.delete(&maintain.target, &target, &existing)?;
                self.charge_maintain(MeterKind::IndexEntries, entries)?;
                self.row_changed(&maintain.target, Some(&existing), None, Origin::Maintained)?;
            }
        }
        let source = self.schema.table(&maintain.source).expect("validated").clone();
        self.meter.heap(super::write_target::row_copy_ceiling(&source).saturating_mul(256))?;
        let mut totals: BTreeMap<String, (Vec<Value>, i128)> = BTreeMap::new();
        bounds = Bounds::default();
        loop {
            let page = self.tx.scan(&maintain.source, "byId", &[], &bounds, Dir::Asc, 256)?;
            if page.is_empty() { break; }
            for (mut image, key) in page {
                bounds.after = crate::key::decode(&key);
                materialize_optional_fields(&mut image, &source);
                self.charge_maintain(MeterKind::Examined, 1)?;
                self.charge_maintain(MeterKind::Steps, maintain.evaluation_steps())?;
                if !maintain.selected(&image) { continue; }
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
        matches!(maintain.kind, MaintainKind::Sum { .. }) && self.schema.table(&maintain.source).is_some_and(|source| source.expire.is_some())
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
            let present = runner.tx.count_prefix(&maintain.source, &index, key, 1)? != 0;
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
        if !self.upsert_absence_proven(&maintain.target, "byGroup", key)? { return Ok(false); }
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
        let target = self.schema.table(&maintain.target).expect("validated").clone();
        self.charge_maintain(MeterKind::Examined, 1)?;
        let existing = self.tx.get(&maintain.target, &id)?;
        if self.device && existing.is_none() && !self.upsert_absence_proven(&maintain.target, "byGroup", &key)? {
            self.unknown_fact(&maintain.target, "byGroup", &key, "aggregate base");
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
                let entries = self.tx.delete(&maintain.target, &target, &existing)?;
                self.charge_maintain(MeterKind::IndexEntries, entries)?;
                self.row_changed(&maintain.target, Some(&existing), None, Origin::Maintained)?;
            }
            self.mirror_column(maintain, &key, 0)?;
            return Ok(());
        }
        let mut row = BTreeMap::from([("id".to_owned(), Value::Id(id.clone())), ("value".to_owned(), Value::Int(next as i64))]);
        for (field, value) in maintain.group_fields().iter().zip(key.iter().cloned()) {
            row.insert(field.clone(), value);
        }
        let row = Value::Row(row.into());
        if existing.as_ref() == Some(&row) { return Ok(()); }
        let entries = self.tx.put(&maintain.target, &target, &row, existing.as_ref())?;
        self.charge_maintain(MeterKind::IndexEntries, entries)?;
        self.row_changed(&maintain.target, existing.as_ref(), Some(&row), Origin::Maintained)?;
        self.mirror_column(maintain, &key, next as i64)
    }
}

fn delta(maintain: &Maintain, source: &Value, direction: i64) -> Result<i128, RuntimeError> {
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
            let maintain = Maintain { target: format!("feed{suffix}"), source: "follows".into(), by: vec!["readerId".into()],
                kind: MaintainKind::Count, filter: None, computed: Default::default(), residency: Default::default(), readable: None, private: None };
            let result = guard.apply_aggregate(&maintain, vec![Value::Id("reader".into())], 1, None);
            assert_eq!(result.unwrap_err().code(), "E_TIMELINE_OWNED");
        }
    }
}
