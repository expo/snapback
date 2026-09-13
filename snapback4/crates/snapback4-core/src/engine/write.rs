//! Writes: the four words, their rules, the constraints (unique, cap,
//! immutable, append-only, after-insert), maintained aggregates, and the
//! partition events every row change produces.

use super::runner::Runner;
use super::validate::validate_row;
use crate::assets::{AssetKind, asset_id};
use crate::error::{MeterKind, RuntimeError};
use crate::partition;
use crate::schema::{ColumnType, Constraint, Effect, Maintain, MaintainKind, Table, maintained_id, maintained_key, materialize_optional_fields};
#[cfg(feature = "sqlite")]
use crate::rows::{Bounds, Dir};
use crate::rows::index_values;
use crate::value::{I53_MAX, I53_MIN, Value, ValueError, canonical_json};
use std::collections::BTreeMap;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Origin {
    Source,
    Maintained,
}

impl Runner<'_> {
    pub(super) fn insert(&mut self, table: &str, row: Value) -> Result<(), RuntimeError> {
        self.insert_mode(table, row, false).map(|_| ())
    }

    pub(super) fn insert_if_absent(&mut self, table: &str, row: Value) -> Result<bool, RuntimeError> {
        self.insert_mode(table, row, true)
    }

    fn insert_mode(&mut self, table_name: &str, row: Value, if_absent: bool) -> Result<bool, RuntimeError> {
        self.refuse_engine_owned(table_name)?;
        let row = self.with_asset_facts(table_name, row)?;
        validate_row(self.schema, table_name, &row)?;
        if !self.check_rule(table_name, Effect::Insert, None, &row)? {
            return Err(RuntimeError::Rule { table: table_name.to_owned(), effect: Effect::Insert });
        }
        let table = self.schema.table(table_name).expect("validated").clone();
        if if_absent {
            for (name, index) in table.indexes.iter().filter(|(_, index)| index.unique) {
                let key = index_values(index, &row);
                if self.tx.lookup(table_name, name, index, &key)?.is_some() {
                    return Ok(false);
                }
            }
        }
        let id = row.field("id")?.as_str()?.to_owned();
        if self.tx.get(table_name, &id)?.is_some() {
            return Err(RuntimeError::Constraint(format!("{table_name} already has a row with id {id}")));
        }
        self.check_constraints(table_name, None, &row, Effect::Insert)?;
        let entries = self.tx.put(table_name, &table, &row, None)?;
        self.meter.charge(MeterKind::IndexEntries, entries)?;
        self.row_changed(table_name, None, Some(&row), Origin::Source)?;
        Ok(true)
    }

    pub(super) fn update(&mut self, table_name: &str, key: &Value, patch: Value) -> Result<(), RuntimeError> {
        self.refuse_engine_owned(table_name)?;
        if patch.as_object()?.contains_key("id") {
            return Err(RuntimeError::Input(format!("{table_name} update patch cannot change id")));
        }
        let id = key.as_str()?;
        let Some(old) = self.fetch(table_name, id)? else {
            return Err(RuntimeError::Require { site: Some(self.statement_site.clone()), code: "NOT_FOUND".to_owned() });
        };
        let mut new = old.as_object()?.clone();
        for (name, value) in patch.as_object()? {
            new.insert(name.clone(), value.clone());
        }
        self.replace(table_name, old, Value::Row(new.into()))
    }

    pub(super) fn upsert(&mut self, table_name: &str, key: &Value, row: Value) -> Result<(), RuntimeError> {
        self.refuse_engine_owned(table_name)?;
        validate_row(self.schema, table_name, &row)?;
        let id = key.as_str()?;
        if row.field("id")?.as_str()? != id {
            return Err(RuntimeError::Input(format!("{table_name} upsert row id must equal its key")));
        }
        match self.fetch(table_name, id)? {
            Some(old) => self.replace(table_name, old, row),
            None => self.insert(table_name, row),
        }
    }

    fn replace(&mut self, table_name: &str, old: Value, new: Value) -> Result<(), RuntimeError> {
        let new = self.with_asset_facts(table_name, new)?;
        validate_row(self.schema, table_name, &new)?;
        if !self.check_rule(table_name, Effect::Update, Some(&old), &new)? {
            return Err(RuntimeError::Rule { table: table_name.to_owned(), effect: Effect::Update });
        }
        self.check_constraints(table_name, Some(&old), &new, Effect::Update)?;
        let table = self.schema.table(table_name).expect("validated").clone();
        let entries = self.tx.put(table_name, &table, &new, Some(&old))?;
        self.meter.charge(MeterKind::IndexEntries, entries)?;
        self.row_changed(table_name, Some(&old), Some(&new), Origin::Source)
    }

    pub(super) fn delete(&mut self, table_name: &str, id: &str) -> Result<(), RuntimeError> {
        self.refuse_engine_owned(table_name)?;
        let Some(old) = self.fetch(table_name, id)? else {
            return Err(RuntimeError::Require { site: Some(self.statement_site.clone()), code: "NOT_FOUND".to_owned() });
        };
        if !self.check_rule(table_name, Effect::Delete, None, &old)? {
            return Err(RuntimeError::Rule { table: table_name.to_owned(), effect: Effect::Delete });
        }
        self.check_constraints(table_name, Some(&old), &old, Effect::Delete)?;
        let table = self.schema.table(table_name).expect("validated").clone();
        let entries = self.tx.delete(table_name, &table, &old)?;
        self.meter.charge(MeterKind::IndexEntries, entries)?;
        self.row_changed(table_name, Some(&old), None, Origin::Source)
    }

    /// Remove a row the engine itself retires (an expired one): no rule and
    /// no constraint stands between the engine and its own sweep, while
    /// aggregates and partition events apply as for any delete.
    #[cfg(feature = "sqlite")]
    pub(super) fn remove(&mut self, table_name: &str, old: &Value) -> Result<(), RuntimeError> {
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?.clone();
        let entries = self.tx.delete(table_name, &table, old)?;
        self.meter.charge(MeterKind::IndexEntries, entries)?;
        self.row_changed(table_name, Some(old), None, Origin::Source)
    }

    /// An `image`/`video` column names an upload by id; the row carries the
    /// facts the server established about it (type, bytes, dimensions,
    /// duration), never the client's word for them. The upload must be the
    /// writer's own and of the column's kind and size. The system principal
    /// may name an asset that was never uploaded: a fixture's placeholder,
    /// metadata only, never served.
    fn with_asset_facts(&mut self, table_name: &str, row: Value) -> Result<Value, RuntimeError> {
        if !self.tx.holds_assets() {
            // A device: the row keeps the asset value as sent; the server
            // establishes the facts when the write arrives.
            return Ok(row);
        }
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        if !table.columns.values().any(|kind| matches!(kind.required(), ColumnType::Image { .. } | ColumnType::Video { .. })) {
            return Ok(row);
        }
        let mut fields = row.as_object()?.clone();
        for (column, kind) in &table.columns {
            let (wanted, max) = match kind.required() {
                ColumnType::Image { max, .. } => (AssetKind::Image, *max),
                ColumnType::Video { max } => (AssetKind::Video, *max),
                _ => continue,
            };
            let Some(id) = asset_id(fields.get(column)).map(str::to_owned) else { continue };
            let Some(asset) = self.tx.asset(&id)? else {
                if self.context.is_system() {
                    // A fixture's placeholder: keep it, in the asset shape.
                    let mut map = fields.get(column).and_then(|value| value.as_object().ok()).cloned().unwrap_or_default();
                    for fact in crate::assets::FACTS {
                        map.entry(fact.to_owned()).or_insert(Value::Null);
                    }
                    fields.insert(column.clone(), Value::Map(map.into()));
                    continue;
                }
                return Err(RuntimeError::Asset { code: "E_ASSET_UNKNOWN", message: format!("{table_name}.{column} names an upload {id} that is not yours or does not exist; upload the bytes first (POST /assets) and place the id it returns") });
            };
            if asset.owner != self.context.viewer && !self.context.is_system() {
                return Err(RuntimeError::Asset { code: "E_ASSET_UNKNOWN", message: format!("{table_name}.{column} names an upload {id} that is not yours or does not exist; upload the bytes first (POST /assets) and place the id it returns") });
            }
            if asset.kind != wanted {
                return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: format!("{table_name}.{column} takes {} and {id} is {}", wanted.word(), asset.kind.word()) });
            }
            if asset.bytes > u64::from(max) {
                return Err(RuntimeError::Asset { code: "E_ASSET_TOO_LARGE", message: format!("{table_name}.{column} takes at most {max} bytes; {id} is {}", asset.bytes) });
            }
            fields.insert(column.clone(), asset.column_value());
        }
        Ok(Value::Row(fields.into()))
    }

    /// One asset, one home: the column that now names an upload claims it
    /// for this row; the one it no longer names releases it, and the bytes
    /// are served no more. Part of every physical row change.
    fn place_assets(&mut self, table_name: &str, table: &Table, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
        if !self.tx.holds_assets() {
            return Ok(());
        }
        let now = self.context.now.unwrap_or(0);
        let id = old.or(new).expect("a row change has an image").field("id")?.as_str()?.to_owned();
        for (column, kind) in &table.columns {
            if !matches!(kind.required(), ColumnType::Image { .. } | ColumnType::Video { .. }) {
                continue;
            }
            let before = asset_id(old.and_then(|old| old.field(column).ok())).map(str::to_owned);
            let after = asset_id(new.and_then(|new| new.field(column).ok())).map(str::to_owned);
            if before == after {
                continue;
            }
            if let Some(released) = before {
                self.tx.release_asset(&released, now)?;
            }
            if let Some(claimed) = after {
                if self.context.is_system() && self.tx.asset(&claimed)?.is_none() {
                    continue;
                }
                self.tx.claim_asset(&claimed, &self.context.viewer, table_name, &id, column)?;
            }
        }
        Ok(())
    }

    /// Programs never write a maintained target; the engine does.
    fn refuse_engine_owned(&self, table: &str) -> Result<(), RuntimeError> {
        if self.schema.maintain_for(table).is_some() {
            return Err(RuntimeError::Schema(format!("{table} is a maintained aggregate; write its source rows instead")));
        }
        Ok(())
    }

    fn check_constraints(&mut self, table_name: &str, old: Option<&Value>, new: &Value, effect: Effect) -> Result<(), RuntimeError> {
        let table = self.schema.table(table_name).expect("validated").clone();
        let id = new.field("id")?.as_str()?.to_owned();
        if effect != Effect::Delete {
            for (name, index) in table.indexes.iter().filter(|(_, index)| index.unique) {
                let key = index_values(index, new);
                if key.iter().any(|value| *value == Value::Null) {
                    continue;
                }
                if let Some(existing) = self.tx.lookup(table_name, name, index, &key)?
                    && existing.field("id")?.as_str()? != id
                {
                    return Err(RuntimeError::Constraint(format!("{table_name} already has a row where {} = {}", index.columns().join(", "), key.iter().map(describe).collect::<Vec<_>>().join(", "))));
                }
            }
        }
        for constraint in &table.constraints {
            match constraint {
                Constraint::Unique { .. } | Constraint::Text { .. } | Constraint::FinalExistsOnInsert { .. } => {}
                Constraint::AppendOnly => {
                    if effect != Effect::Insert {
                        return Err(RuntimeError::Constraint(format!("{table_name} is append-only")));
                    }
                }
                Constraint::Immutable { fields } => {
                    if let Some(old) = old
                        && effect == Effect::Update
                    {
                        let mut old_image = old.clone();
                        materialize_optional_fields(&mut old_image, &table);
                        let mut new_image = new.clone();
                        materialize_optional_fields(&mut new_image, &table);
                        for field in fields {
                            if old_image.field(field).ok() != new_image.field(field).ok() {
                                return Err(RuntimeError::Constraint(format!("{table_name}.{field} is immutable")));
                            }
                        }
                    }
                }
                Constraint::Cap { by, max } => {
                    if effect == Effect::Delete {
                        continue;
                    }
                    let group: Vec<Value> = by.iter().map(|field| new.field(field).cloned().unwrap_or(Value::Null)).collect();
                    let moved = old.is_none_or(|old| by.iter().map(|field| old.field(field).cloned().unwrap_or(Value::Null)).collect::<Vec<_>>() != group);
                    if !moved {
                        continue;
                    }
                    let index_name = table.indexes.iter().find(|(_, index)| index.columns().starts_with(by)).map(|(name, _)| name.clone()).ok_or_else(|| RuntimeError::Schema(format!("cap by {} has no leading index", by.join(", "))))?;
                    self.meter.charge(MeterKind::IndexEntries, 1)?;
                    let count = self.tx.count_prefix(table_name, &index_name, &group, *max as u64 + 1)?;
                    if count >= *max as u64 {
                        return Err(RuntimeError::Constraint(format!("{table_name} holds at most {max} rows where {} = {}", by.join(", "), group.iter().map(describe).collect::<Vec<_>>().join(", "))));
                    }
                }
            }
        }
        Ok(())
    }

    /// `after insert <- exists t[...]` holds for every row inserted this
    /// transaction; checked once the program has run.
    pub(super) fn check_final_exists(&mut self) -> Result<(), RuntimeError> {
        let inserted = std::mem::take(&mut self.inserted);
        for (table_name, row) in &inserted {
            let table = self.schema.table(table_name).expect("validated").clone();
            for constraint in &table.constraints {
                let Constraint::FinalExistsOnInsert { table: target, index, key } = constraint else { continue };
                let key: Vec<Value> = key
                    .iter()
                    .map(|term| match term {
                        crate::schema::RuleTerm::Field(field) | crate::schema::RuleTerm::NextField(field) => row.field(field).cloned().unwrap_or(Value::Null),
                        crate::schema::RuleTerm::Viewer => Value::Id(self.context.viewer.clone()),
                        crate::schema::RuleTerm::Literal(value) => value.clone(),
                        crate::schema::RuleTerm::OldField(_) => Value::Null,
                    })
                    .collect();
                self.read_tables.insert(target.clone());
                let definition = self.schema.table(target).ok_or_else(|| RuntimeError::Schema(format!("missing {target}")))?;
                let target_index = definition.index(index).ok_or_else(|| RuntimeError::Schema(format!("missing {target}.{index}")))?;
                let found = self.tx.lookup(target, index, target_index, &key)?;
                if self.device && (definition.sync.is_none() || (found.is_none() && definition.sync.as_ref().is_some_and(|s| s.horizon.is_some()))) { self.beyond_horizon = true; }
                if found.is_none() {
                    return Err(RuntimeError::Constraint(format!("inserting into {table_name} requires a matching row in {target} by the end of the mutation")));
                }
            }
        }
        self.inserted = inserted;
        Ok(())
    }

    /// The shared tail of every physical row change: creation facts, the
    /// write meter, maintained aggregates, and the partition events.
    fn row_changed(&mut self, table_name: &str, old: Option<&Value>, new: Option<&Value>, origin: Origin) -> Result<(), RuntimeError> {
        self.written_tables.insert(table_name.to_owned());
        self.rows_written += 1;
        self.meter.charge(MeterKind::RowsWritten, 1)?;
        let table = self.schema.table(table_name).expect("validated").clone();
        // Final-exists obligations retain immutable successful-insert images.
        // Current creation facts have separate per-row ownership, so updates
        // and deletes remove only that row's contributions in O(index count).
        let id = old.or(new).expect("a row change has an image").field("id")?.as_str()?;
        let owner = (table_name.to_owned(), id.to_owned());
        let previous = self.created_rows.remove(&owner);
        let was_created = previous.is_some() || old.is_none();
        if let Some(keys) = previous {
            for key in keys {
                if let Some(count) = self.created.get_mut(&key) {
                    *count -= 1;
                    if *count == 0 { self.created.remove(&key); }
                }
            }
        }
        if old.is_none() {
            if let Some(row) = new { self.inserted.push((table_name.to_owned(), row.clone())); }
        }
        if was_created {
            if let Some(row) = new {
                let keys: Vec<_> = table.indexes.iter().map(|(name, index)|
                    (table_name.to_owned(), name.clone(), canonical_json(&index_values(index, row)))).collect();
                for key in &keys { *self.created.entry(key.clone()).or_default() += 1; }
                self.created_rows.insert(owner, keys);
            }
        }
        partition::row_changed(self, table_name, old, new)?;
        if origin == Origin::Source {
            self.place_assets(table_name, &table, old, new)?;
            self.maintain(table_name, old, new)?;
        }
        Ok(())
    }

    fn maintain(&mut self, source: &str, old: Option<&Value>, new: Option<&Value>) -> Result<(), RuntimeError> {
        let maintains: Vec<Maintain> = self.schema.maintains.iter().filter(|maintain| maintain.source == source).cloned().collect();
        for maintain in maintains {
            let table = self.schema.table(&maintain.source).expect("validated").clone();
            let mut changes: Vec<(Vec<Value>, i128)> = Vec::new();
            if let Some(old) = old {
                let mut image = old.clone();
                materialize_optional_fields(&mut image, &table);
                let key = maintained_key(&image, &maintain.by);
                changes.push((key, delta(&maintain, &image, -1)?));
            }
            if let Some(new) = new {
                let mut image = new.clone();
                materialize_optional_fields(&mut image, &table);
                let key = maintained_key(&image, &maintain.by);
                let change = delta(&maintain, &image, 1)?;
                if let Some(existing) = changes.iter_mut().find(|(k, _)| *k == key) {
                    existing.1 += change;
                } else {
                    changes.push((key, change));
                }
            }
            for (key, change) in changes {
                if change != 0 {
                    self.apply_aggregate(&maintain, key, change)?;
                }
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
        let target = self.schema.table(&maintain.target).expect("validated").clone();
        for (existing, _) in self.tx.scan(&maintain.target, "byId", &[], &Bounds::default(), Dir::Asc, usize::MAX)? {
            let entries = self.tx.delete(&maintain.target, &target, &existing)?;
            self.meter.charge(MeterKind::IndexEntries, entries)?;
            self.row_changed(&maintain.target, Some(&existing), None, Origin::Maintained)?;
        }
        let source = self.schema.table(&maintain.source).expect("validated").clone();
        let mut totals: BTreeMap<String, (Vec<Value>, i128)> = BTreeMap::new();
        for (row, _) in self.tx.scan(&maintain.source, "byId", &[], &Bounds::default(), Dir::Asc, usize::MAX)? {
            let mut image = row;
            materialize_optional_fields(&mut image, &source);
            let key = maintained_key(&image, &maintain.by);
            let change = delta(maintain, &image, 1)?;
            let entry = totals.entry(canonical_json(&key)).or_insert((key, 0));
            entry.1 += change;
        }
        for (_, (key, change)) in totals {
            if change != 0 {
                self.apply_aggregate(maintain, key, change)?;
            }
        }
        Ok(())
    }

    fn apply_aggregate(&mut self, maintain: &Maintain, key: Vec<Value>, change: i128) -> Result<(), RuntimeError> {
        let id = maintained_id(&key);
        let target = self.schema.table(&maintain.target).expect("validated").clone();
        let existing = self.tx.get(&maintain.target, &id)?;
        let old_value = existing.as_ref().and_then(|row| row.field("value").ok()).map(Value::as_int).transpose()?.unwrap_or(0);
        let next = i128::from(old_value) + change;
        if !(I53_MIN as i128..=I53_MAX as i128).contains(&next) {
            return Err(ValueError::Overflow(next).into());
        }
        if next == 0 {
            if let Some(existing) = existing {
                let entries = self.tx.delete(&maintain.target, &target, &existing)?;
                self.meter.charge(MeterKind::IndexEntries, entries)?;
                self.row_changed(&maintain.target, Some(&existing), None, Origin::Maintained)?;
            }
            return Ok(());
        }
        let mut row = BTreeMap::from([("id".to_owned(), Value::Id(id.clone())), ("value".to_owned(), Value::Int(next as i64))]);
        for (field, value) in maintain.by.iter().zip(key) {
            row.insert(field.clone(), value);
        }
        let row = Value::Row(row.into());
        let entries = self.tx.put(&maintain.target, &target, &row, existing.as_ref())?;
        self.meter.charge(MeterKind::IndexEntries, entries)?;
        self.row_changed(&maintain.target, existing.as_ref(), Some(&row), Origin::Maintained)
    }
}

fn delta(maintain: &Maintain, source: &Value, direction: i64) -> Result<i128, RuntimeError> {
    Ok(match &maintain.kind {
        MaintainKind::Count => i128::from(direction),
        MaintainKind::Sum { of } => i128::from(direction).checked_mul(i128::from(source.field(of)?.as_int()?)).ok_or_else(|| RuntimeError::Constraint("aggregate multiplication overflow".to_owned()))?,
    })
}

fn describe(value: &Value) -> String {
    match value {
        Value::String(s) | Value::Id(s) => format!("'{s}'"),
        other => canonical_json(other),
    }
}
