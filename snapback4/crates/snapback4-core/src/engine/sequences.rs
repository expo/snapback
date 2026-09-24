//! Transactional per-parent ordinals and device suffix predictions.
// @ref LLP 3000.015#2 — the counter is shared across tables and commits only with the write.
use super::runner::Runner;
use crate::{
    error::{MeterKind, RuntimeError},
    rows::{Bounds, Dir},
    schema::{ColumnType, Table},
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
                self.device_work(|runner| runner.sequence_floor(parent, &id))?
            } else {
                self.meter.charge(MeterKind::IndexEntries, 1)?;
                self.tx.sequence_value(parent, &id)?
            };
            let next = if previous >= crate::value::I53_MAX {
                if self.device {
                    return Err(RuntimeError::Prediction(
                        "a provisional sequence cannot fit above the held values; queue the write for the server (guide writes)".into(),
                    ));
                }
                // The last representable value is only an authority candidate.
                // Callers must refuse full before validation, collisions or writes;
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
