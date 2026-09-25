//! Transactional per-parent ordinals and device suffix predictions.
// @ref LLP 3000.015#2 — the counter is shared across tables and commits only with the write.
use super::runner::Runner;
use crate::rows::word_heap;
use crate::{
    error::{MeterKind, RuntimeError},
    rows::{Bounds, Dir},
    schema::{ColumnType, Effect, RuleExpr, Table},
    value::Value,
};
use std::collections::BTreeMap;

pub(super) fn exhausted() -> RuntimeError {
    RuntimeError::Structural {
        code: "E_SEQUENCE_EXHAUSTED",
        message: "parent sequence exhausted the int range; create a new parent (guide types)".into(),
    }
}

pub(super) fn refuse_fields(table: &Table, name: &str, row: &Value) -> Result<(), RuntimeError> {
    for column in table.sequences.keys() {
        if row.as_object()?.contains_key(column) {
            return Err(RuntimeError::Structural {
                code: "E_SEQUENCE_SUPPLIED",
                message: format!("{name}.{column} is engine-assigned; omit {column} from inserts and patches (guide writes)"),
            });
        }
    }
    Ok(())
}

impl Runner<'_> {
    /// The insert image is supplied, unlike a write target's hidden old row.
    /// Reserve its exact copy and static authorization/counter allowance before
    /// learning a read witness; do not reserve schema-maximum hidden payloads.
    pub(super) fn reserve_sequence_authorization(&mut self, table: &Table, row: &Value) -> Result<(), RuntimeError> {
        let probes = super::rules::rule_probes(&table.rules.read).saturating_add(super::rules::rule_probes(&table.rules.insert).saturating_mul(2));
        for (kind, amount, used, ceiling) in [
            (MeterKind::RuleProbes, probes, self.meter.used.rule_probes, self.meter.ceilings.rule_probes),
            (MeterKind::IndexEntries, table.sequences.len() as u64, self.meter.used.index_entries, self.meter.ceilings.index_entries),
            (MeterKind::HeapBytes, row.heap_bytes(), self.meter.used.heap_bytes, self.meter.ceilings.heap_bytes),
        ] {
            if !self.meter.room(kind, amount) { return Err(RuntimeError::Bound { kind, actual: used.saturating_add(amount), ceiling, site: self.meter.site().into() }); }
        }
        Ok(())
    }

    pub(super) fn sequence_insert_readable(&mut self, name: &str, row: &Value) -> Result<bool, RuntimeError> {
        let table = &self.schema.tables[name];
        if table.sequences.is_empty() || self.context.is_system() || table.rules.read.is_uniformly_readable() { return Ok(true); }
        // Read authority must be established from supplied/defaulted fields,
        // independently of the hidden counter's eventual assignment.
        if super::rules::deciding_fields(name, table, &table.rules.read).iter().any(|field| table.sequences.contains_key(field)) { return Ok(false); }
        self.evaluate_read_rule(name, row)
    }

    // @ref LLP 3000.015#2 — index membership and order consume provisional
    // ordinals even when the requested suffix currently contains no rows.
    pub(super) fn observe_sequence_selection(&mut self, name: &str, index_name: &str, prefix: &[Value]) -> Result<(), RuntimeError> {
        if !self.device || self.device_allowance.is_none() || self.provisional_sequence_read { return Ok(()); }
        let table = &self.schema.tables[name];
        let index = table.index(index_name).expect("validated index");
        let Some(position) = index.columns().iter().position(|field| table.sequences.contains_key(field)) else { return Ok(()); };
        let arity = index.components.len() + 1;
        let stable = &prefix[..prefix.len().min(position)];
        let dependent = self.authorized_scan(&[], |runner| runner.device_work(|runner| {
            let mut bounds = Bounds::default();
            loop {
                let rows = runner.tx.scan_metered(name, index_name, stable, &bounds, Dir::Asc, 1, &mut runner.meter)?;
                let Some((row, key)) = rows.first() else { return Ok(false); };
                runner.meter.charge(MeterKind::Examined, 1)?;
                if runner.is_provisional(name, row)? { return Ok(true); }
                runner.meter.heap(word_heap::key_decode(arity, key.len()))?;
                bounds.after = crate::key::decode(key).map(|key| key.into_iter().skip(stable.len()).collect());
            }
        }))?;
        self.provisional_sequence_read |= dependent;
        Ok(())
    }

    pub(super) fn sequence_field_is_provisional(&self, row: &Value, field: &str) -> Result<bool, RuntimeError> {
        if !self.device || row.field("id").and_then(Value::as_str).is_err() { return Ok(false); }
        for (name, table) in &self.schema.tables {
            if table.sequences.contains_key(field) && self.is_provisional(name, row)? { return Ok(true); }
        }
        Ok(false)
    }

    pub(super) fn evaluate_sequence_rule(&mut self, name: &str, rule: &RuleExpr, effect: Effect, old: Option<&Value>, next: &Value) -> Result<bool, RuntimeError> {
        let next_provisional = self.device && (effect == Effect::Insert || self.is_provisional(name, next)?);
        let old_provisional = old.map(|row| self.is_provisional(name, row)).transpose()?.unwrap_or(false);
        let viewer = self.context.viewer.clone();
        super::rules::evaluate(rule, &viewer, old, next, effect == Effect::Insert, &mut SequenceProbe {
            runner: self, table: name, old: old_provisional, next: next_provisional,
        })
    }

    pub(super) fn observe_sequence_columns(&mut self, name: &str, row: &Value, fields: &[String], inserting: bool) -> Result<(), RuntimeError> {
        if self.device && fields.iter().any(|field| self.schema.tables[name].sequences.contains_key(field)) {
            self.provisional_sequence_read |= inserting || self.is_provisional(name, row)?;
        }
        Ok(())
    }

    /// Author-facing point reads and pages share the sequence result contract.
    pub(super) fn sequence_read_result(&mut self, name: &str, mut row: Value) -> Result<Value, RuntimeError> {
        if row != Value::Null && row.field("pending") != Ok(&Value::Bool(true)) && !self.schema.tables[name].sequences.is_empty() && self.is_provisional(name, &row)? {
            self.meter.heap(word_heap::object_copy(&row) + word_heap::insertion::<String, Value>(row.as_object()?.len()) + word_heap::text("pending"))?;
            if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.insert("pending".into(), Value::Bool(true)); }
        }
        Ok(row)
    }

    #[cfg(feature = "sqlite")]
    pub(super) fn import_sequences(&mut self, name: &str, mut row: Value, old: Option<&Value>, restore: bool) -> Result<Value, RuntimeError> {
        let table = self.schema.table(name).ok_or_else(|| RuntimeError::Schema(format!("missing table {name}")))?;
        if table.sequences.is_empty() {
            return Ok(row);
        }
        if !restore {
            refuse_fields(table, name, &row)?;
            if let Some(old) = old {
                for (column, reference) in &table.sequences {
                    if row.field(reference)? != old.field(reference)? {
                        return Err(RuntimeError::Structural {
                            code: "E_SEQUENCE_PARENT",
                            message: format!("{name}.{reference} cannot change after sequence allocation; import a new row id (guide types)"),
                        });
                    }
                    if let Value::Row(fields) | Value::Map(fields) = &mut row {
                        fields.insert(column.clone(), old.field(column)?.clone());
                    }
                }
            } else {
                let (candidate, full) = self.sequence_fields(name, row)?;
                if full {
                    return Err(exhausted());
                }
                row = candidate;
            }
        }
        for (column, reference) in &self.schema.tables[name].sequences {
            let ColumnType::Ref { table: parent } = &self.schema.tables[name].columns[reference] else {
                unreachable!("validated sequence")
            };
            let value = row.field(column)?.as_int()?;
            if value < 1 || value > crate::value::I53_MAX {
                return Err(RuntimeError::Input("restored sequences must be positive ints".into()));
            }
            let id = row.field(reference)?.as_str()?;
            self.tx.set_sequence(parent, id, self.tx.sequence_value(parent, id)?.max(value))?;
        }
        Ok(row)
    }

    pub(super) fn sequence_fields(&mut self, name: &str, mut row: Value) -> Result<(Value, bool), RuntimeError> {
        let table = self.schema.table(name).ok_or_else(|| RuntimeError::Schema(format!("missing table {name}")))?;
        if table.sequences.is_empty() {
            return Ok((row, false));
        }
        refuse_fields(table, name, &row)?;
        self.meter.heap(row.heap_bytes())?;
        let mut values = BTreeMap::new();
        let mut full = false;
        for (column, reference) in &table.sequences {
            let Some(ColumnType::Ref { table: parent }) = table.columns.get(reference) else {
                return Err(RuntimeError::Structural {
                    code: "E_SEQUENCE_PARENT",
                    message: format!("{name}.{reference} must be a required parent reference (guide types)"),
                });
            };
            let id = row.field(reference)?.as_str()?.to_owned();
            let key = (parent.clone(), id.clone());
            let previous = if let Some(value) = values.get(&key) {
                *value
            } else if self.device {
                self.authorized_scan(&[], |runner| runner.device_work(|runner| runner.sequence_floor(parent, &id)))?
            } else {
                self.authorized_scan(&[(MeterKind::IndexEntries, 1)], |runner| runner.tx.sequence_value(parent, &id))?
            };
            let next = if previous >= crate::value::I53_MAX {
                if self.device {
                    return Err(RuntimeError::Prediction(
                        "a provisional sequence cannot fit above the held values; queue the write for the server (guide writes)".into(),
                    ));
                }
                // The last representable value is only an authority candidate.
                // Callers must refuse full before validation or writes; only
                // if-absent keys without a sequence can establish a no-op.
                // denied writers cannot use exhaustion to inspect parent state.
                full = true;
                crate::value::I53_MAX
            } else {
                previous + 1
            };
            values.insert(key, next);
            if let Value::Row(fields) | Value::Map(fields) = &mut row {
                fields.insert(column.clone(), Value::Int(next));
            }
        }
        Ok((row, full))
    }

    /// One indexed suffix per declaring column, including pending rows. Never
    /// consult server counters on a device or claim these local values settled.
    fn sequence_floor(&mut self, parent: &str, id: &str) -> Result<i64, RuntimeError> {
        let mut floor = self.tx.provisional_sequence_floor(parent, id)?;
        for (name, table) in &self.schema.tables {
            for (column, reference) in &table.sequences {
                if table.columns.get(reference) != Some(&ColumnType::Ref { table: parent.into() }) {
                    continue;
                }
                self.meter.charge(MeterKind::IndexEntries, 1)?;
                let rows = self.tx.scan_metered(
                    name,
                    &crate::schema::sequence_index(column),
                    &[Value::Id(id.into())],
                    &Bounds::default(),
                    Dir::Desc,
                    1,
                    &mut self.meter,
                )?;
                if let Some((row, _)) = rows.first() {
                    floor = floor.max(row.field(column)?.as_int()?);
                }
            }
        }
        Ok(floor)
    }

    /// Called only after if-absent collisions and constraints have passed.
    pub(super) fn commit_sequences(&mut self, name: &str, row: &Value) -> Result<(), RuntimeError> {
        if self.device {
            return Ok(());
        }
        let table = self.schema.table(name).ok_or_else(|| RuntimeError::Schema(format!("missing table {name}")))?;
        for (column, reference) in &table.sequences {
            let ColumnType::Ref { table: parent } = &table.columns[reference] else {
                unreachable!("validated sequence")
            };
            let id = row.field(reference)?.as_str()?;
            self.meter.charge(MeterKind::IndexEntries, 1)?;
            self.tx.set_sequence(parent, id, row.field(column)?.as_int()?)?;
        }
        Ok(())
    }

    /// Fill the insert expression's result with its assigned fields. The
    /// original insert payload never becomes a caller-supplied ordinal.
    pub(super) fn sequence_result(&mut self, name: &str, mut row: Value) -> Result<Value, RuntimeError> {
        let table = self.schema.table(name).ok_or_else(|| RuntimeError::Schema(format!("missing table {name}")))?;
        if table.sequences.is_empty() {
            return Ok(row);
        }
        let stored = self.tx.get(name, row.field("id")?.as_str()?)?.expect("just inserted");
        self.meter.heap(stored.heap_bytes())?;
        if let Value::Row(fields) | Value::Map(fields) = &mut row {
            for column in table.sequences.keys() {
                fields.insert(column.clone(), stored.field(column)?.clone());
            }
            if self.device {
                fields.insert("pending".into(), Value::Bool(true));
            }
        }
        Ok(row)
    }
}

/// Dependency tracking follows rule evaluation, including its short circuits.
struct SequenceProbe<'a, 'b> {
    runner: &'a mut Runner<'b>,
    table: &'a str,
    old: bool,
    next: bool,
}
impl super::rules::Probe for SequenceProbe<'_, '_> {
    fn field(&mut self, field: &str, old: bool) {
        self.runner.provisional_sequence_read |= (if old { self.old } else { self.next })
            && self.runner.schema.tables[self.table].sequences.contains_key(field);
    }
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        super::rules::Probe::exists(self.runner, table, index, key, equalities)
    }
    fn created(&mut self, table: &str, index: &str, key: &[Value]) -> bool {
        super::rules::Probe::created(self.runner, table, index, key)
    }
}

#[cfg(all(test, feature = "sqlite"))]
mod tests {
    use super::*;
    use crate::{Context, meter::{Ceilings, Cut, Meter}, store::Store, value::object};

    #[test]
    fn pending_copy_is_charged_before_mutation_at_the_heap_ceiling() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table parents:\n  public\n  online only\ntable messages:\n  parent: parents\n  ordinal: sequence by parent\n  payload: text <=20000\n  public\n  sync public\n".into())]);
        assert!(bound.diagnostics.is_empty());
        let schema: crate::schema::Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&bound.schema).unwrap()).unwrap();
        let mut store = Store::memory().unwrap();
        store.install(&schema).unwrap();
        let tx = store.transaction().unwrap();
        let original = object([("id", Value::Id("pending".into())), ("parent", Value::Id("p".into())), ("ordinal", Value::Int(1)), ("payload", Value::String("x".repeat(20000)))]);
        let copy = word_heap::object_copy(&original) + word_heap::insertion::<String, Value>(original.as_object().unwrap().len()) + word_heap::text("pending");
        for room in [copy - 1, copy] {
            let ceiling = Ceilings::default().heap_bytes;
            let mut runner = Runner::new(&tx, &schema, Context::new("alice", Default::default()), Meter::new(Ceilings::default(), Cut::Abort), 0);
            runner.device = true;
            runner.provisional_rows.insert(("messages".into(), "pending".into()));
            runner.meter.heap(ceiling - room).unwrap();
            let result = runner.sequence_read_result("messages", original.clone());
            assert!(original.field("pending").is_err(), "the shared store image cannot mutate");
            if room < copy {
                assert!(matches!(result, Err(RuntimeError::Bound { kind: MeterKind::HeapBytes, .. })));
            } else {
                let row = result.unwrap();
                assert_eq!(row.field("pending"), Ok(&Value::Bool(true)));
                assert_eq!(runner.meter.used.heap_bytes, ceiling);
                let again = runner.sequence_read_result("messages", row.clone()).unwrap();
                assert!(std::ptr::eq(row.as_object().unwrap(), again.as_object().unwrap()), "an existing pending marker must preserve the shared map");
                assert_eq!(runner.meter.used.heap_bytes, ceiling);
            }
        }
    }
}
