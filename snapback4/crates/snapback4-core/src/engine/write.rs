//! Writes: the four words, their rules, the constraints (unique, cap,
//! immutable, append-only, after-insert), maintained aggregates, and the
//! partition events every row change produces.

use super::runner::Runner;
use super::validate::validate_row;
use crate::assets::{AssetKind, asset_id};
use crate::error::{MeterKind, RuntimeError};
use crate::partition;
use crate::schema::{ColumnType, Constraint, Effect, Table, materialize_optional_fields};
use crate::rows::{Bounds, Dir};
use crate::rows::index_values;
use crate::value::{Value, canonical_json};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Origin {
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
        let row = self.with_defaults(table_name, row)?;
        if !self.check_rule(table_name, Effect::Insert, None, &row)? {
            return Err(RuntimeError::Rule { table: table_name.to_owned(), effect: Effect::Insert });
        }
        let row = self.with_asset_facts(table_name, row, None, None)?;
        validate_row(self.schema, table_name, &row)?;
        let table = self.schema.table(table_name).expect("validated").clone();
        if if_absent {
            for (name, index) in table.indexes.iter().filter(|(_, index)| index.unique) {
                let key = index_values(index, &row);
                if key.iter().any(|value| *value == Value::Null) {
                    continue;
                }
                if let Some(existing) = self.live_lookup(table_name, name, index, &key)? {
                    self.visible_collision(table_name, &existing, Effect::Insert)?;
                    return Ok(false);
                }
            }
        }
        let id = row.field("id")?.as_str()?.to_owned();
        if let Some(existing) = self.tx.get(table_name, &id)? {
            if !self.expired(&table, &existing) {
                self.visible_collision(table_name, &existing, Effect::Insert)?;
                return Err(RuntimeError::Constraint(format!("{table_name} already has a row with id {id}")));
            }
            self.remove(table_name, &existing)?;
        }
        self.check_constraints(table_name, None, &row, Effect::Insert)?;
        let entries = self.maintain_scratch(self.contribution_heap(&table), |runner| runner.tx.put(table_name, &table, &row, None))?;
        self.charge_source_indexes(&table, None, Some(&row), entries)?;
        self.row_changed(table_name, None, Some(&row), Origin::Source)?;
        Ok(true)
    }

    pub(super) fn update(&mut self, table_name: &str, key: &Value, patch: Value) -> Result<(), RuntimeError> {
        self.target_attempt(|runner| runner.update_attempt(table_name, key, patch))
    }

    fn update_attempt(&mut self, table_name: &str, key: &Value, patch: Value) -> Result<(), RuntimeError> {
        self.refuse_engine_owned(table_name)?;
        if patch.as_object()?.contains_key("id") {
            return Err(RuntimeError::Input(format!("{table_name} update patch cannot change id")));
        }
        let id = key.as_str()?;
        self.reserve_target_resolution(table_name, &self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?.clone(), &patch, false)?;
        let Some(old) = self.fetch(table_name, id)? else {
            return Err(self.write_miss(table_name, "byId", &[key.clone()]));
        };
        if self.device && self.schema.tables[table_name].sync.is_none() { return Err(self.write_miss(table_name, "byId", &[key.clone()])); }
        let readable = self.check_rule(table_name, Effect::Read, None, &old)?;
        let patch = self.ignore_hidden_immutable_patch(table_name, patch, readable)?;
        let new = self.merge_patch(&old, &patch)?;
        self.replace(table_name, old, new, readable, &patch)
    }

    pub(super) fn upsert(&mut self, table_name: &str, key: &Value, row: Value) -> Result<(), RuntimeError> {
        self.target_attempt(|runner| runner.upsert_attempt(table_name, key, row))
    }

    fn upsert_attempt(&mut self, table_name: &str, key: &Value, row: Value) -> Result<(), RuntimeError> {
        self.refuse_engine_owned(table_name)?;
        let id = key.as_str()?;
        if row.field("id")?.as_str()? != id {
            return Err(RuntimeError::Input(format!("{table_name} upsert row id must equal its key")));
        }
        self.reserve_target_resolution(table_name, &self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?.clone(), &row, true)?;
        match self.fetch(table_name, id)? {
            Some(old) => {
                let readable = self.check_rule(table_name, Effect::Read, None, &old)?;
                let row = self.ignore_hidden_immutable_patch(table_name, row, readable)?;
                // @ref LLP 3000.007#5.4 — an existing row receives a patch; omitted columns keep their values.
                let new = self.merge_patch(&old, &row)?;
                self.replace(table_name, old, new, readable, &row)
            }
            None if self.device && !self.upsert_absence_proven(table_name, "byId", &[key.clone()])? => Err(self.write_miss(table_name, "byId", &[key.clone()])),
            None => self.insert_upsert(table_name, "byId", row),
        }
    }

    pub(super) fn insert_upsert(&mut self, table_name: &str, addressed_index: &str, row: Value) -> Result<(), RuntimeError> {
        // Defaults fill first, so a patch that leaves a defaulted column out is a complete row here.
        let row = self.with_defaults(table_name, row)?;
        if self.device { self.prove_upsert_insert(table_name, addressed_index, &row)?; }
        // @ref LLP 3000.007#17 — absent upserts decide insert authority before asset or constraint diagnostics.
        if !self.check_rule(table_name, Effect::Insert, None, &row)? { return Err(self.no_write_target()); }
        // An incomplete insert patch has the same word as a refused hidden target.
        if let Err(error) = validate_row(self.schema, table_name, &row) {
            return Err(if matches!(error, RuntimeError::Input(_)) { self.no_write_target() } else { error });
        }
        match self.insert(table_name, row) {
            Err(RuntimeError::Input(_)) => Err(self.no_write_target()),
            result => result,
        }
    }

    fn replace(&mut self, table_name: &str, old: Value, new: Value, readable: bool, patch: &Value) -> Result<(), RuntimeError> {
        self.authorize_update(table_name, &old, &new, readable)?;
        self.replace_authorized(table_name, old, new, readable, patch)
    }

    // @ref LLP 3000.007#8 — item 7: pre-write read authority controls details; update authority precedes asset diagnostics.
    pub(super) fn authorize_update(&mut self, table: &str, old: &Value, new: &Value, readable: bool) -> Result<(), RuntimeError> {
        if !self.check_rule(table, Effect::Update, Some(old), new)? {
            return Err(if readable { RuntimeError::Rule { table: table.into(), effect: Effect::Update } } else { self.no_write_target() });
        }
        Ok(())
    }

    pub(super) fn replace_authorized(&mut self, table_name: &str, old: Value, new: Value, readable: bool, patch: &Value) -> Result<(), RuntimeError> {
        let new = self.with_asset_facts(table_name, new, Some(&old), (!readable).then_some(patch))?;
        if let Err(error) = validate_row(self.schema, table_name, &new) { return Err(if readable { error } else { self.no_write_target() }); }
        self.check_constraints(table_name, Some(&old), &new, Effect::Update)?;
        let table = self.schema.table(table_name).expect("validated").clone();
        let entries = self.maintain_scratch(self.contribution_heap(&table), |runner| runner.tx.put(table_name, &table, &new, Some(&old)))?;
        self.charge_source_indexes(&table, Some(&old), Some(&new), entries)?;
        self.row_changed(table_name, Some(&old), Some(&new), Origin::Source)
    }

    pub(super) fn delete(&mut self, table_name: &str, id: &str) -> Result<(), RuntimeError> {
        self.target_attempt(|runner| runner.delete_attempt(table_name, id))
    }

    fn delete_attempt(&mut self, table_name: &str, id: &str) -> Result<(), RuntimeError> {
        self.refuse_engine_owned(table_name)?;
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?.clone();
        // @ref LLP 3000.007#20.9 — delete prepays hidden contribution work before fetching its old image, with the same attempt lifetime as update.
        self.reserve_maintains(table_name, &table)?;
        let Some(old) = self.fetch(table_name, id)? else {
            return Err(RuntimeError::Require { site: Some(self.statement_site.clone()), code: "NOT_FOUND".to_owned() });
        };
        if !self.check_rule(table_name, Effect::Delete, None, &old)? {
            return Err(RuntimeError::Rule { table: table_name.to_owned(), effect: Effect::Delete });
        }
        self.check_constraints(table_name, Some(&old), &old, Effect::Delete)?;
        let entries = self.maintain_scratch(self.contribution_heap(&table), |runner| runner.tx.delete(table_name, &table, &old))?;
        self.charge_source_indexes(&table, Some(&old), None, entries)?;
        self.row_changed(table_name, Some(&old), None, Origin::Source)
    }

    /// Remove a row the engine itself retires (an expired one): no rule and
    /// no constraint stands between the engine and its own sweep, while
    /// aggregates and partition events apply as for any delete.
    pub(super) fn remove(&mut self, table_name: &str, old: &Value) -> Result<(), RuntimeError> {
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?.clone();
        let entries = self.maintain_scratch(self.contribution_heap(&table), |runner| runner.tx.delete(table_name, &table, old))?;
        self.charge_source_indexes(&table, Some(old), None, entries)?;
        self.row_changed(table_name, Some(old), None, Origin::Source)
    }

    /// A column with a declared default takes it when the written row leaves
    /// it out, before validation and before the asset facts, so the row the
    /// rules and the constraints see is the complete one.
    // @ref LLP 3000.007#5.4 — omitted defaults use the clock and viewer of the host running the insert.
    fn with_defaults(&mut self, table_name: &str, row: Value) -> Result<Value, RuntimeError> {
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        if !table.defaults.keys().any(|name| row.as_object().is_ok_and(|fields| !fields.contains_key(name))) {
            return Ok(row);
        }
        let mut fields = row.as_object()?.clone();
        for (name, default) in &table.defaults {
            if !fields.contains_key(name) {
                let value = default.value(self.context.now.ok_or_else(|| RuntimeError::Input("write clock is not pinned".into()))?, &self.context.viewer);
                fields.insert(name.clone(), value);
            }
        }
        let row = Value::Row(fields.into());
        self.meter.heap(row.heap_bytes())?;
        Ok(row)
    }

    /// An `image`/`video` column names an upload by id; the row carries the
    /// facts the server established about it (type, bytes, dimensions,
    /// duration), never the client's word for them. The upload must be the
    /// writer's own and of the column's kind and size. The system principal
    /// may name an asset that was never uploaded: a fixture's placeholder,
    /// metadata only, never served.
    fn with_asset_facts(&mut self, table_name: &str, row: Value, old: Option<&Value>, hidden_patch: Option<&Value>) -> Result<Value, RuntimeError> {
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
            // @ref LLP 3000.007#17 — omitted placements survive; an explicit hidden assignment proves upload ownership even when its id matches.
            let explicit = hidden_patch.is_some_and(|patch| patch.as_object().is_ok_and(|fields| fields.contains_key(column)));
            if let Some(before) = old.and_then(|row| row.field(column).ok())
                && !explicit && asset_id(Some(before)).is_some() && asset_id(Some(before)) == asset_id(fields.get(column)) {
                fields.insert(column.clone(), before.clone());
                continue;
            }
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
            // Equal explicit hidden assignments already passed with_asset_facts ownership validation.
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
    pub(super) fn refuse_engine_owned(&self, table: &str) -> Result<(), RuntimeError> {
        self.refuse_condition_write()?;
        if self.schema.maintain_for(table).is_some() {
            return Err(RuntimeError::Schema(format!("{table} is a maintained aggregate; write its source rows instead")));
        }
        Ok(())
    }

    fn check_constraints(&mut self, table_name: &str, old: Option<&Value>, new: &Value, effect: Effect) -> Result<(), RuntimeError> {
        let table = self.schema.table(table_name).expect("validated").clone();
        let id = new.field("id")?.as_str()?.to_owned();
        let readable = match old { Some(old) if effect == Effect::Update => self.check_rule(table_name, Effect::Read, None, old)?, _ => true };
        if effect != Effect::Delete {
            for (name, index) in table.indexes.iter().filter(|(_, index)| index.unique) {
                let key = index_values(index, new);
                if key.iter().any(|value| *value == Value::Null) {
                    continue;
                }
                if let Some(existing) = self.live_lookup(table_name, name, index, &key)?
                    && existing.field("id")?.as_str()? != id
                {
                    if effect == Effect::Update && !readable { return Err(self.no_write_target()); }
                    self.visible_collision(table_name, &existing, effect)?;
                    return Err(RuntimeError::Constraint(format!("{table_name}.{name} already has a row where {} = {}", index.columns().join(", "), key.iter().map(describe).collect::<Vec<_>>().join(", "))));
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
                    // Hidden patch fields were removed by ignore_hidden_immutable_patch;
                    // do not turn this constraint into a second value comparison.
                    if effect == Effect::Update && !readable { continue; }
                    if let Some(old) = old
                        && effect == Effect::Update
                    {
                        let mut old_image = old.clone();
                        materialize_optional_fields(&mut old_image, &table);
                        let mut new_image = new.clone();
                        materialize_optional_fields(&mut new_image, &table);
                        for field in fields {
                            if old_image.field(field).ok() != new_image.field(field).ok() {
                                return Err(if readable { RuntimeError::Constraint(format!("{table_name}.{field} is immutable")) } else { self.no_write_target() });
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
                    let index_name = table.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().starts_with(by)).map(|(name, _)| name.clone()).ok_or_else(|| RuntimeError::Schema(format!("cap by {} has no leading index", by.join(", "))))?;
                    self.meter.charge(MeterKind::IndexEntries, 1)?;
                    let count = if table.expire.is_none() {
                        self.tx.count_prefix(table_name, &index_name, &group, *max as u64 + 1)?
                    } else {
                        let mut count = 0;
                        let mut bounds = Bounds::default();
                        loop {
                            let rows = self.tx.scan(table_name, &index_name, &group, &bounds, Dir::Asc, 256)?;
                            let fetched = rows.len();
                            for (row, key) in rows {
                                self.meter.charge(MeterKind::Examined, 1)?;
                                bounds.after = crate::key::decode(&key).map(|values| values.into_iter().skip(group.len()).collect());
                                if !self.expired(&table, &row) { count += 1; }
                                if count >= *max as u64 { break; }
                            }
                            if count >= *max as u64 || fetched < 256 { break; }
                        }
                        count
                    };
                    if count >= *max as u64 {
                        // @ref LLP 3000.007#17 — cap diagnostics describe the schema, never retained group values.
                        return Err(RuntimeError::Constraint(format!("{table_name} holds at most {max} rows per group by {}", by.join(", "))));
                    }
                }
            }
        }
        Ok(())
    }

    // @ref LLP 3000#7-decisions-during-execution — hidden collisions use the ordinary write-rule refusal
    fn visible_collision(
        &mut self,
        table: &str,
        row: &Value,
        effect: Effect,
    ) -> Result<(), RuntimeError> {
        let mut image = row.clone();
        let definition = self.schema.table(table).expect("validated");
        materialize_optional_fields(&mut image, definition);
        let expired = definition.expired(&image, self.context.now.unwrap_or(0));
        if expired || !self.check_rule(table, Effect::Read, None, &image)? {
            return Err(RuntimeError::Rule {
                table: table.to_owned(),
                effect,
            });
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
                let found = match self.live_lookup(target, index, target_index, &key)? {
                    Some(row) => self.live_aggregate(target, row)?,
                    None => None,
                };
                if found.is_none() {
                    // @ref LLP 3000.007#20.5 — a final-exists miss needs the same readable, fully held group proof as upsert absence; a local hit needs no absence proof.
                    // Budget spent only while establishing device coverage is the device's
                    // uncertainty, not the write's: the server needs no such proof.
                    let proven = self.device && match self.upsert_absence_proven(target, index, &key) {
                        Ok(proven) => proven,
                        Err(RuntimeError::Bound { .. }) => false,
                        Err(error) => return Err(error),
                    };
                    if self.device && !proven {
                        let first_unknown = self.missing_fact.is_none();
                        self.unknown_fact(target, index, &key, "after insert");
                        if first_unknown && let Some(message) = &mut self.missing_fact {
                            *message = message.replace("the row or its absence is past the acquired horizon or online only", "the probe key does not establish a fully held, readable group without a horizon");
                        }
                    }
                    return Err(RuntimeError::Constraint(format!("inserting into {table_name} requires a matching row in {target} by the end of the mutation")));
                }
            }
        }
        self.inserted = inserted;
        Ok(())
    }

    fn contribution_heap(&self, table: &Table) -> u64 {
        table.indexes.values().fold(0, |bytes: u64, index| match index.components.first() {
            Some(crate::schema::IndexComponent::Contribution(maintain)) => bytes.saturating_add(
                super::write_target::row_copy_ceiling(&self.schema.tables[&maintain.target]).saturating_mul(16)),
            _ => bytes,
        })
    }

    fn charge_source_indexes(&mut self, table: &Table, old: Option<&Value>, new: Option<&Value>, mut entries: u64) -> Result<(), RuntimeError> {
        for index in table.indexes.values() {
            if let Some(crate::schema::IndexComponent::Contribution(maintain)) = index.components.first() {
                self.charge_maintain(MeterKind::Steps, maintain.evaluation_steps() * (u64::from(old.is_some()) + u64::from(new.is_some())))?;
            }
        }
        if self.maintain_prepaid {
            let id = old.or(new).expect("source image").field("id")?.as_str()?;
            for index in table.indexes.values() {
                if matches!(index.components.first(), Some(crate::schema::IndexComponent::Contribution(_))) {
                    let before = old.map(|row| crate::rows::stored_index_keys(table, index, row, id)).unwrap_or_default();
                    let after = new.map(|row| crate::rows::stored_index_keys(table, index, row, id)).unwrap_or_default();
                    let changed = before.iter().filter(|key| !after.contains(key)).count() + after.iter().filter(|key| !before.contains(key)).count();
                    entries = entries.saturating_sub(changed as u64);
                }
            }
        }
        self.meter.charge(MeterKind::IndexEntries, entries)?;
        Ok(())
    }

    /// The shared tail of every physical row change: creation facts, the
    /// write meter, maintained aggregates, and the partition events.
    pub(super) fn row_changed(&mut self, table_name: &str, old: Option<&Value>, new: Option<&Value>, origin: Origin) -> Result<(), RuntimeError> {
        self.written_tables.insert(table_name.to_owned());
        self.rows_written += 1;
        if origin == Origin::Maintained { self.charge_maintain(MeterKind::RowsWritten, 1)?; }
        else { self.meter.charge(MeterKind::RowsWritten, 1)?; }
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

}

fn describe(value: &Value) -> String {
    match value {
        Value::String(s) | Value::Id(s) => format!("'{s}'"),
        other => canonical_json(other),
    }
}
