//! Writes: the four words, their rules, the constraints (unique, cap,
//! immutable, append-only, after-insert), maintained aggregates, and the
//! partition events every row change produces.

use super::runner::Runner;
use super::validate::validate_row;
use crate::error::{MeterKind, RuntimeError};
use crate::partition;
use crate::schema::{Constraint, Effect, Table, materialize_optional_fields};
use crate::rows::{Bounds, Dir};
use crate::rows::index_values;
use crate::value::{Value, Supplied, canonical_json};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Origin {
    Source,
    Maintained,
}

#[path = "write_target.rs"]
pub(crate) mod target;
#[path = "write_references.rs"]
mod references;

impl Runner<'_> {
    pub(super) fn insert(&mut self, table: &str, row: Supplied) -> Result<(), RuntimeError> {
        self.insert_mode(table, row, false).map(|_| ())
    }

    pub(super) fn insert_if_absent(&mut self, table: &str, row: Supplied) -> Result<bool, RuntimeError> {
        self.insert_mode(table, row, true)
    }

    fn insert_mode(&mut self, table_name: &str, row: Supplied, if_absent: bool) -> Result<bool, RuntimeError> {
        if self.device && if_absent && self.schema.tables[table_name].through.is_some() {
            return Err(RuntimeError::Prediction("insert if absent on a read-through child queues without a row".into()));
        }
        self.target_attempt(table_name, |runner| {
            let mark = runner.meter.mark();
            let result = runner.insert_attempt(table_name, row, if_absent, None).map_err(|error| error.authorization_context(table_name, Effect::Insert));
            // @ref LLP 3000.015#2 — denied direct allocations hide deferred
            // read witnesses and counter work just as NOT_FOUND hides targets.
            if matches!(&result, Err(RuntimeError::Rule { effect: Effect::Insert, .. } | RuntimeError::AuthorizationBudget { .. }))
                && runner.schema.tables.get(table_name).is_some_and(|table| !table.sequences.is_empty()) {
                runner.meter.restore(mark);
            }
            result
        })
    }

    fn insert_attempt(&mut self, table_name: &str, row: Supplied, if_absent: bool, upsert_index: Option<&str>) -> Result<bool, RuntimeError> {
        self.refuse_engine_owned(table_name, Effect::Insert)?;
        self.refuse_receipt_fields(table_name, &row, true)?;
        self.refuse_recorded(table_name, &row)?;
        let supplied_sequence = super::sequences::refuse_fields(&self.schema.tables[table_name], table_name, &row);
        // A directly supplied field is a payload error before any lookup;
        // only an upsert's copied address waits for insert authority.
        if upsert_index.is_none() && supplied_sequence.is_err() { return supplied_sequence.map(|_| false); }
        let supplied = row.clone();
        let row = self.with_defaults(table_name, row)?;
        if self.schema.tables[table_name].ephemeral.is_some() { self.meter.heap(row.heap_bytes())?; }
        let row = row.ephemeral(&self.schema.tables[table_name], self.context.now.unwrap_or(0))?;
        // @ref LLP 3000.014#4-the-capture — reserve, then stamp the parent capture before any rule sees the image.
        self.reserve_capture(&self.schema.tables[table_name])?;
        let row = self.capture_insert(table_name, row)?;
        let table = &self.schema.tables[table_name];
        let independent = !table.sequences.is_empty() && !super::rules::deciding_fields(table_name, table, &table.rules.insert)
            .iter().any(|field| table.sequences.contains_key(field));
        // An independent denial must never consult a hidden read witness.
        let authorized = independent && self.check_rule(table_name, Effect::Insert, None, &row)?;
        if independent && !authorized {
            return Err(if upsert_index.is_some() { self.no_write_target() } else { self.rule_refusal(table_name, Effect::Insert, "insert rule") });
        }
        if !table.sequences.is_empty() {
            // Admission reserves the worst case before either read verdict;
            // restoring a refusal alone cannot hide a boundary abort.
            // An independent insert rule was already prepaid and evaluated.
            // Only still-pending checks belong in this preflight allowance.
            let insert_checks = if authorized { 0 } else { 1 + u64::from(upsert_index.is_some() && supplied_sequence.is_ok()) };
            self.reserve_sequence_authorization(table, &row, insert_checks)?;
        }
        // @ref LLP 3000.015#2 — an unreadable allocation cannot expose counter,
        // uniqueness or cap state, even to a principal allowed to insert.
        if !self.sequence_insert_readable(table_name, &row)? {
            self.refusing_clause(table_name, "sequence read authority");
            return Err(if upsert_index.is_some() { self.no_write_target() } else { self.rule_refusal(table_name, Effect::Insert, "sequence read authority") });
        }
        if let Err(error) = supplied_sequence {
            // @ref LLP 3000.007#17 — absent upserts decide insert authority before field diagnostics.
            // A target key may supply an ordinal even when the patch does not.
            if !authorized && !self.check_rule(table_name, Effect::Insert, None, &row)? {
                return Err(if upsert_index.is_some() { self.no_write_target() } else { self.rule_refusal(table_name, Effect::Insert, "insert rule") });
            }
            return Err(if upsert_index.is_some() { self.no_write_target() } else { error });
        }
        if upsert_index.is_some() {
            self.authorize_fields(table_name, &row, &supplied).map_err(|_| self.no_write_target())?;
        } else { self.authorize_fields(table_name, &row, &supplied)?; }
        // The image copy an event slot costs is the writer's own supplied bytes (LLP 3000.015 §1).
        let image_bytes = row.heap_bytes();
        let (row, sequence_full) = self.sequence_fields(table_name, row)?;
        let row = self.receipt_insert_fields(table_name, row)?;
        if let Some(index) = upsert_index {
            if self.device { self.prove_upsert_insert(table_name, index, &row)?; }
            // Preserve upsert's target preflight before the ordinary insert checks;
            // only this first authority refusal is an undisclosed target miss.
            if !authorized && !self.check_rule(table_name, Effect::Insert, None, &row)? { return Err(self.no_write_target()); }
            if sequence_full { return Err(super::sequences::exhausted()); }
            // Engine event slots are stamped after predecessor/sequence checks,
            // just as on an ordinary insert; preflight validates authored fields.
            if let Err(error) = super::validate::validate_before_slots(self.schema, table_name, &row) {
                return Err(if matches!(error, RuntimeError::Input(_)) { self.no_write_target() } else { error });
            }
        }
        if !authorized && !self.check_rule(table_name, Effect::Insert, None, &row)? {
            return Err(self.rule_refusal(table_name, Effect::Insert, "insert rule"));
        }
        // Retry keys independent of engine allocation still identify a no-op
        // at the ceiling. Never use the clamped authority candidate as a key.
        if sequence_full && if_absent {
            let table = &self.schema.tables[table_name];
            for (name, index) in table.indexes.iter().filter(|(_, index)| index.unique && index.columns().iter().all(|column| !table.sequences.contains_key(column))) {
                let key = index_values(index, &row);
                if key.contains(&Value::Null) { continue; }
                if self.collision_lookup(table_name, name, index, &key, None, Effect::Insert)?.is_some() {
                    self.observe_sequence_columns(table_name, &row, &index.columns(), true)?;
                    return Ok(false);
                }
            }
        }
        if sequence_full { return Err(super::sequences::exhausted()); }
        let row = self.record_insert(table_name, row)?;
        let row = self.birth_columns(table_name, row)?;
        let row = self.with_asset_facts(table_name, row, None, None)?;
        super::validate::validate_before_slots(self.schema, table_name, &row)?;
        if if_absent {
            for (name, index) in table.indexes.iter().filter(|(_, index)| index.unique) {
                let key = index_values(index, &row);
                if key.iter().any(|value| *value == Value::Null) {
                    continue;
                }
                if self.collision_lookup(table_name, name, index, &key, None, Effect::Insert)?.is_some() {
                    self.observe_sequence_columns(table_name, &row, &index.columns(), true)?;
                    return Ok(false);
                }
            }
        }
        let id = row.field("id")?.as_str()?.to_owned();
        if if_absent && self.device {
            // @ref LLP 3000.007#20.5 — if-absent's insert arm needs the same image, unique-population and cap proof as upsert.
            // Upsert mints its insert id; if-absent may instead supply one.
            // Only a freshly minted id can skip the primary-key absence proof.
            let index = if self.context.minted_ids.contains(&id) {
                table.indexes.iter().find(|(name, index)| name.as_str() != "byId" && index.unique && !index_values(index, &row).contains(&Value::Null))
                    .map_or("byId", |(name, _)| name.as_str())
            } else { "byId" };
            self.prove_upsert_insert(table_name, index, &row)?;
        }
        // An upsert has already resolved this exact address (or minted the id)
        // and reserved both target proofs. Retiring an expired predecessor
        // uses that same allowance, not a third read-rule reservation.
        let collision_probes = if upsert_index.is_some() { 0 } else { super::rules::rule_probes(&table.rules.read) };
        let has_children = self.schema.children(table_name).next().is_some();
        let predecessor = self.authorized_scan(&[(MeterKind::RuleProbes, collision_probes)], |runner, allowance| {
            let existing = runner.tx.get(allowance, table_name, &id)?;
            if let Some(row) = &existing {
                if !runner.expired(table, row) { runner.visible_collision(table_name, row, Effect::Insert, "unique id")?; }
                // @ref LLP 3000.014#3-a-child-lives-within-its-parent — an expired birth with physical
                // children collides like a live birth: check the old image's authority under the same
                // reservation, without treating expiry as denial. A non-reader never probes the children.
                else if has_children && !runner.check_rule(table_name, Effect::Read, None, row)? {
                    return Err(runner.rule_refusal(table_name, Effect::Insert, "unique id"));
                }
            }
            Ok(existing)
        })?;
        if predecessor.as_ref().is_none_or(|old| self.expired(table, old)) && has_children {
            let mark = self.meter.mark();
            if self.physical_children(table_name, &Value::Id(id.clone()))? {
                // The bounded probes have completed. Their occupancy is not
                // disclosed by the collision's logical meter or heap peak.
                self.meter.restore(mark);
                return Err(if predecessor.is_some() {
                    RuntimeError::Constraint(format!("{table_name} already has a row with id {id}"))
                } else { self.rule_refusal(table_name, Effect::Insert, "parent identity has stored children") });
            }
        }
        if let Some(existing) = &predecessor {
            if !self.expired(table, &existing) {
                return Err(RuntimeError::Constraint(format!("{table_name} already has a row with id {id}")));
            }
            // The expired predecessor is internal authorization work, not a
            // disclosed examination (LLP 3000.015 §§1–2).
            self.remove(table_name, existing)?;
        }
        // The server's same-id expired replacement preserves occupancy in
        // unchanged cap groups. A device cannot rely on an expired predecessor.
        self.check_constraints(table_name, predecessor.as_ref(), &row, Effect::Insert)?;
        self.commit_sequences(table_name, &row)?;
        self.commit_receipt_counter(table_name, &row)?;
        let row = self.prepare_event_slots(table_name, None, row, image_bytes)?;
        validate_row(self.schema, table_name, &row)?;
        let entries = self.maintain_scratch(self.contribution_heap(table), |runner| runner.tx.put(table_name, table, &row, None))?;
        self.charge_source_indexes(table, None, Some(&row), entries)?;
        self.row_changed(table_name, None, Some(&row), Origin::Source)?;
        Ok(true)
    }

    pub(super) fn update(&mut self, table_name: &str, key: &Value, patch: Supplied) -> Result<(), RuntimeError> {
        self.target_attempt(table_name, |runner| runner.update_attempt(table_name, key, patch))
    }

    fn update_attempt(&mut self, table_name: &str, key: &Value, patch: Supplied) -> Result<(), RuntimeError> {
        self.refuse_engine_owned(table_name, Effect::Update)?;
        self.refuse_receipt_fields(table_name, &patch, false)?;
        self.refuse_recorded(table_name, &patch)?;
        super::sequences::refuse_fields(&self.schema.tables[table_name], table_name, &patch)?;
        if patch.as_object()?.contains_key("id") {
            return Err(RuntimeError::Input(format!("{table_name} update patch cannot change id")));
        }
        let id = key.as_str()?;
        self.reserve_target_resolution(table_name, self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?, &patch, false)?;
        let Some(old) = self.metered_scan(|runner, allowance| runner.fetch(allowance, table_name, id))? else {
            return Err(self.write_miss(table_name, "byId", &[key.clone()]));
        };
        if self.device && self.schema.tables[table_name].sync.is_none() { return Err(self.write_miss(table_name, "byId", &[key.clone()])); }
        let readable = self.check_rule(table_name, Effect::Read, None, &old)?;
        let patch = self.ignore_hidden_immutable_patch(table_name, patch, readable)?;
        let (new, copy) = self.merge_patch(table_name, &old, &patch, readable)?;
        self.replace(table_name, old, new, readable, &patch, copy)
    }

    pub(super) fn upsert(&mut self, table_name: &str, key: &Value, row: Supplied) -> Result<(), RuntimeError> {
        self.target_attempt(table_name, |runner| runner.upsert_attempt(table_name, key, row))
    }

    fn upsert_attempt(&mut self, table_name: &str, key: &Value, row: Supplied) -> Result<(), RuntimeError> {
        self.refuse_upsert_owned(table_name)?;
        self.refuse_receipt_fields(table_name, &row, false)?;
        self.refuse_recorded(table_name, &row)?;
        super::sequences::refuse_fields(&self.schema.tables[table_name], table_name, &row)?;
        let id = key.as_str()?;
        if row.field("id")?.as_str()? != id {
            return Err(RuntimeError::Input(format!("{table_name} upsert row id must equal its key")));
        }
        self.reserve_target_resolution(table_name, self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?, &row, true)?;
        match self.metered_scan(|runner, allowance| runner.fetch(allowance, table_name, id))? {
            Some(old) => {
                let readable = self.check_rule(table_name, Effect::Read, None, &old)?;
                let row = self.ignore_hidden_immutable_patch(table_name, row, readable)?;
                // @ref LLP 3000.007#5.4 — an existing row receives a patch; omitted columns keep their values.
                let (new, copy) = self.merge_patch(table_name, &old, &row, readable)?;
                self.replace(table_name, old, new, readable, &row, copy)
            }
            None if self.device && !self.upsert_absence_proven(table_name, "byId", &[key.clone()])? => Err(self.write_miss(table_name, "byId", &[key.clone()])),
            None => self.insert_upsert(table_name, "byId", row),
        }
    }

    pub(super) fn insert_upsert(&mut self, table_name: &str, addressed_index: &str, row: Supplied) -> Result<(), RuntimeError> {
        self.refuse_upsert_owned(table_name)?;
        if self.schema.tables[table_name].through.is_some() {
            // A read-through child's insert arm keeps the hidden-target word for every authority refusal.
            return self.insert_attempt(table_name, row, false, Some(addressed_index)).map(|_| ()).map_err(|e| match e {
                RuntimeError::Rule {..} | RuntimeError::Input(_) => self.no_write_target(), other => other,
            });
        }
        match self.insert_attempt(table_name, row, false, Some(addressed_index)).map(|_| ()) {
            Err(RuntimeError::Input(_)) => Err(self.no_write_target()),
            result => result,
        }
    }

    fn replace(&mut self, table_name: &str, old: Value, new: Value, readable: bool, patch: &Value, copy: u64) -> Result<(), RuntimeError> {
        self.authorize_update_fields(table_name, &old, &new, patch, readable)?;
        self.replace_authorized(table_name, old, new, readable, patch, copy)
    }

    /// `copy` is the merged image's lawful price, charged again for an engine slot copy.
    pub(super) fn replace_authorized(&mut self, table_name: &str, old: Value, new: Value, readable: bool, patch: &Value, copy: u64) -> Result<(), RuntimeError> {
        self.refuse_engine_owned(table_name, Effect::Update)?;
        self.refuse_receipt_fields(table_name, patch, false)?;
        self.refuse_recorded(table_name, patch)?;
        super::sequences::refuse_fields(&self.schema.tables[table_name], table_name, patch)?;
        self.authorize_fields(table_name, &old, patch)?;
        let definition = &self.schema.tables[table_name];
        for path in definition.columns.keys().filter(|field| definition.engine_field(field) && field.as_str() != crate::schema::through::DEADLINE) {
            if old.field(path).ok() != new.field(path).ok() {
                return Err(if readable { RuntimeError::Structural { code: "E_RECORDED_FIELD", message: format!("engine replacement changed stored attribution at {table_name}.{path} (guide maintains)") } } else { self.no_write_target() });
            }
        }
        let mut new = new;
        self.schema.tables[table_name].recompute_deadline(&mut new)?;
        // @ref LLP 3000.017#2.2 — extending life re-admits the new image.
        if self.schema.tables[table_name].stamp_ephemeral(&mut new, self.context.now.unwrap_or(0))?
            && !self.check_rule(table_name, Effect::Insert, None, &new)? {
            return Err(if readable { RuntimeError::Rule { table: table_name.into(), effect: Effect::Update } } else { self.no_write_target() });
        }
        let new = self.with_asset_facts(table_name, new, Some(&old), (!readable).then_some(patch))?;
        if let Err(error) = super::validate::validate_projection(self.schema, table_name, &new, self.device.then_some(self.context.viewer.as_str())) { return Err(if readable { error } else { self.no_write_target() }); }
        self.check_constraints(table_name, Some(&old), &new, Effect::Update)?;
        let new = self.prepare_event_slots(table_name, Some(&old), new, copy)?;
        // A predicting device keeps another owner's omitted private field as an omission.
        super::validate::validate_projection(self.schema, table_name, &new, self.device.then_some(self.context.viewer.as_str()))?;
        let table = self.schema.table(table_name).expect("validated");
        let entries = self.maintain_scratch(self.contribution_heap(table), |runner| runner.tx.put(table_name, table, &new, Some(&old)))?;
        self.charge_source_indexes(table, Some(&old), Some(&new), entries)?;
        self.row_changed(table_name, Some(&old), Some(&new), Origin::Source)
    }

    pub(super) fn delete(&mut self, table_name: &str, id: &str) -> Result<(), RuntimeError> {
        self.target_attempt(table_name, |runner| runner.delete_attempt(table_name, id))
    }

    fn delete_attempt(&mut self, table_name: &str, id: &str) -> Result<(), RuntimeError> {
        self.refuse_engine_owned(table_name, Effect::Delete)?;
        self.refuse_receipt_scope_delete(table_name)?;
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        self.reserve_write_rules(table, &[Effect::Read, Effect::Delete])?;
        // @ref LLP 3000.007#20.9 — delete prepays hidden contribution work before fetching its old image, with the same attempt lifetime as update.
        self.reserve_maintains(table_name, table)?;
        let Some(old) = self.metered_scan(|runner, allowance| runner.fetch(allowance, table_name, id))? else {
            return Err(RuntimeError::Require { site: Some(self.statement_site.clone()), code: "NOT_FOUND".to_owned(), message: None });
        };
        // @ref LLP 3000.038#3 — a delete that consults referencing rows needs read authority on its row first.
        if (self.schema.children(table_name).next().is_some() || self.schema.is_referenced(table_name)) && !self.check_rule(table_name,Effect::Read,None,&old)? {
            self.refusing_clause(table_name, "read rule");
            return Err(self.no_write_target());
        }
        if !self.check_rule(table_name, Effect::Delete, None, &old)? {
            return Err(if self.check_rule(table_name, Effect::Read, None, &old)? {
                RuntimeError::Rule { table: table_name.to_owned(), effect: Effect::Delete }
            } else { self.no_write_target() });
        }
        self.delete_authorized(table_name, old)
    }

    pub(super) fn delete_authorized(&mut self, table_name: &str, old: Value) -> Result<(), RuntimeError> {
        let old = if self.schema.is_referenced(table_name) {
            self.apply_reference_actions(table_name, &old)?;
            // @ref LLP 3000.038#3 — the actions may have changed the root (a maintained column mirrored from its children): remove its current image.
            let id = old.field("id")?.as_str()?.to_owned();
            self.metered_scan(|runner, allowance| runner.tx.get(allowance, table_name, &id))?.unwrap_or(old)
        } else { old };
        self.delete_row(table_name, old)
    }

    /// A delete's own removal of one row, its rules already decided: receipt
    /// membership, the read-through child probe, constraints, maintains and
    /// the partition event. A referential cascade removes each row this way.
    pub(super) fn delete_row(&mut self, table_name: &str, old: Value) -> Result<(), RuntimeError> {
        let table = &self.schema.tables[table_name];
        self.receipt_member_removed(table_name, &old)?;
        self.refuse_live_children(table_name,old.field("id")?)?;
        self.check_constraints(table_name, Some(&old), &old, Effect::Delete)?;
        let entries = self.maintain_scratch(self.contribution_heap(table), |runner| runner.tx.delete(table_name, table, &old))?;
        self.charge_source_indexes(table, Some(&old), None, entries)?;
        self.row_changed(table_name, Some(&old), None, Origin::Source)
    }

    /// Remove a row the engine itself retires (an expired one): no rule and
    /// no constraint stands between the engine and its own sweep, while
    /// aggregates and partition events apply as for any delete.
    pub(super) fn remove(&mut self, table_name: &str, old: &Value) -> Result<(), RuntimeError> {
        self.refuse_engine_owned(table_name, Effect::Delete)?;
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        let entries = self.maintain_scratch(self.contribution_heap(table), |runner| runner.tx.delete(table_name, table, old))?;
        self.charge_source_indexes(table, Some(old), None, entries)?;
        self.row_changed(table_name, Some(old), None, Origin::Source)
    }

    /// At a program commit's end, retire every row the commit inserted whose
    /// lifetime has already ended: it was never live at a commit boundary, so
    /// it leaves no row for a later sweep to announce. Inside the commit the
    /// row existed as written (an insert-then-update still works). Engine
    /// bookkeeping, unmetered: the device's prediction does not do it, and
    /// the program's metering is already recorded. Its work, returned, stays
    /// linear in the rows retired: each aggregate row takes one net change
    /// and each audience key is scanned for a live row once. Seeds and loads
    /// keep their rows for the sweep.
    // @ref LLP 3000#7-decisions-during-execution — a row whose lifetime ended by its own commit's end never exists at a commit boundary.
    #[cfg(feature = "sqlite")]
    pub(crate) fn retire_expired_births(&mut self) -> Result<crate::meter::Metered, RuntimeError> {
        let Some(now) = self.context.now else { return Ok(Default::default()) };
        let mut born: Vec<(String, String)> = self.born_rows.keys().filter(|(table, _)| self.schema.table(table).is_some_and(|t| t.is_expiring())).cloned().collect();
        if born.is_empty() {
            return Ok(Default::default());
        }
        // The log's order must not depend on a map's iteration order.
        let order = self.schema.through_order();
        born.sort_by_key(|(name,id)| (std::cmp::Reverse(order.iter().position(|n| n == name)),id.clone()));
        let meter = std::mem::replace(&mut self.meter, crate::meter::Meter::new(crate::meter::Ceilings::unbounded(), crate::meter::Cut::Abort));
        self.retiring = Some(Default::default());
        let retired = born.iter().try_for_each(|(table_name, id)| {
            let Some(row) = self.metered_scan(|runner, allowance| runner.tx.get(allowance, table_name, id))? else { return Ok(()) };
            let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
            if table.expired(&row, now) && !self.physical_children(table_name,row.field("id")?)? { self.remove(table_name, &row) } else { Ok(()) }
        });
        let aggregates = self.retiring.take().map(|retiring| retiring.aggregates).unwrap_or_default();
        let retired = retired.and_then(|()| self.apply_retired_aggregates(aggregates));
        let work = std::mem::replace(&mut self.meter, meter).used;
        retired.map(|()| work)
    }

    /// A column with a declared default takes it when the written row leaves
    /// it out, before validation and before the asset facts, so the row the
    /// rules and the constraints see is the complete one.
    // @ref LLP 3000.007#5.4 — omitted defaults use the clock and viewer of the host running the insert.
    pub(super) fn with_defaults(&mut self, table_name: &str, row: Supplied) -> Result<Supplied, RuntimeError> {
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        if !table.defaults.keys().any(|name| row.as_object().is_ok_and(|fields| !fields.contains_key(name))) {
            return Ok(row);
        }
        let row = row.defaults(table,self.context.now.ok_or_else(||RuntimeError::Input("write clock is not pinned".into()))?,&self.context.viewer)?;
        self.meter.heap(row.heap_bytes())?;
        Ok(row)
    }

    /// An `image`/`video` column names an upload by id; the row carries the
    /// facts the server established about it (type, bytes, dimensions,
    /// duration), never the client's word for them. The upload must be the
    /// writer's own and of the column's kind and size. The system principal
    /// may name an asset that was never uploaded: a fixture's placeholder,
    /// metadata only, never served.
    // Web stores hold received asset facts, never the authoritative upload ledger.
    #[cfg(not(feature = "sqlite"))]
    fn with_asset_facts(&mut self, _table_name: &str, row: Value, _old: Option<&Value>, _hidden_patch: Option<&Value>) -> Result<Value, RuntimeError> {
        Ok(row)
    }

    pub(super) fn refuse_upsert_owned(&self, table: &str) -> Result<(), RuntimeError> {
        self.refuse_engine_owned(table, Effect::Insert)?;
        self.refuse_engine_owned(table, Effect::Update)
    }

    /// Programs never write a maintained target; the engine does.
    pub(super) fn refuse_engine_owned(&self, table: &str, effect: Effect) -> Result<(), RuntimeError> {
        // @ref LLP 3000.022#14.3 — pending member changes cannot rewrite settled requirements.
        if self.device && effect != Effect::Insert && self.schema.receipts.iter().any(|f| f.members == table || f.runs == table) {
            return Err(RuntimeError::Prediction("receipt membership changes and progress queue until settlement".into()));
        }
        self.refuse_receipt_table(table)?;
        self.refuse_condition_write()?;
        self.refuse_timeline_write(table, effect)?;
        self.schema.refuse_private(table)?;
        if self.schema.maintain_for(table).is_some() {
            return Err(RuntimeError::Schema(format!("{table} is a maintained aggregate; write its source rows instead")));
        }
        Ok(())
    }

    fn check_constraints(&mut self, table_name: &str, old: Option<&Value>, new: &Value, effect: Effect) -> Result<(), RuntimeError> {
        let table = self.schema.table(table_name).expect("validated");
        let id = new.field("id")?.as_str()?.to_owned();
        let readable = match old { Some(old) if effect == Effect::Update => self.check_rule(table_name, Effect::Read, None, old)?, _ => true };
        if effect != Effect::Delete {
            for (name, index) in table.indexes.iter().filter(|(_, index)| index.unique) {
                // byId can only return this id (already checked on insert).
                // An unchanged admitted unique key cannot acquire a collision.
                if name == "byId" { continue; }
                let key = index_values(index, new);
                if old.is_some_and(|old| index_values(index, old) == key) { continue; }
                if key.iter().any(|value| *value == Value::Null) {
                    continue;
                }
                // @ref LLP 3000.007#20.5 — holding the target does not cover a different unique population.
                if self.device && effect == Effect::Update && !self.device_work(|runner| runner.upsert_absence_proven(table_name, name, &key))? {
                    return Err(self.write_miss(table_name, name, &key));
                }
                if let Some(existing) = self.collision_lookup(table_name, name, index, &key, Some(&id), effect)
                    .map_err(|error| if !readable && matches!(error, RuntimeError::Rule { .. }) { self.no_write_target() } else { error })?
                    && existing.field("id")?.as_str()? != id
                {
                    self.observe_sequence_columns(table_name, new, &index.columns(), effect == Effect::Insert)?;
                    if effect == Effect::Update && !readable {
                        #[cfg(feature = "sqlite")]
                        self.refusing_clause(table_name, &format!("unique {}", index.columns().join(", ")));
                        return Err(self.no_write_target());
                    }
                    // @ref LLP 3000.036#13.9 — the dev log names the `unique` line that refused (wave 3 I3).
                    self.refusing_clause(table_name, &format!("unique {}", index.columns().join(", ")));
                    let detail = format!("{table_name}.{name} already has a row where {} = {}", index.columns().join(", "), key.iter().map(describe).collect::<Vec<_>>().join(", "));
                    if let Some(refusal) = self.schema.unique_refusals.get(table_name).and_then(|indexes| indexes.get(name)) {
                        return Err(RuntimeError::NamedConstraint { code: refusal.code.clone(), message: refusal.message.clone(), detail });
                    }
                    return Err(RuntimeError::Constraint(detail));
                }
            }
        }
        for constraint in &table.constraints {
            match constraint {
                Constraint::Capabilities(_) | Constraint::Recorded | Constraint::Unique { .. } | Constraint::Text { .. } | Constraint::FinalExistsOnInsert { .. } => {}
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
                        materialize_optional_fields(&mut old_image, table);
                        let mut new_image = new.clone();
                        materialize_optional_fields(&mut new_image, table);
                        for field in fields {
                            if old_image.field(field).ok() != new_image.field(field).ok() {
                                if readable { self.refusing_clause(table_name, &format!("immutable {field}")); }
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
                    // @ref LLP 3000.038#2.2 — a `set null` reference's null rows belong to no parent: its cap does not count them.
                    if self.schema.cap_skips_null(table, by, &group) { continue; }
                    // @ref LLP 3000.013#11.1 — an expired local predecessor may have been swept and its capacity refilled before sync arrives.
                    let predecessor = old.filter(|row| !self.device || !self.expired(table, row));
                    let moved = predecessor.is_none_or(|old| by.iter().map(|field| old.field(field).cloned().unwrap_or(Value::Null)).collect::<Vec<_>>() != group);
                    if !moved {
                        continue;
                    }
                    // A complete live snapshot omits unswept expired rows, so
                    // its physical count cannot establish room on the server.
                    // A count at the last delivered watermark would also be
                    // stale after a sweep whose sync has not arrived yet.
                    if self.device && table.is_expiring() {
                        return Err(RuntimeError::Prediction(format!("{table_name}'s expiring cap needs the server's physical occupancy; queue this write until the server settles it")));
                    }
                    let index_name = table.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().starts_with(by)).map(|(name, _)| name.clone()).ok_or_else(|| RuntimeError::Schema(format!("cap by {} has no leading index", by.join(", "))))?;
                    // @ref LLP 3000.007#20.5 — moving a held row needs complete coverage of the destination cap group.
                    if self.device && effect == Effect::Update && !self.device_work(|runner| runner.upsert_absence_proven(table_name, &index_name, &group))? {
                        return Err(self.write_miss(table_name, &index_name, &group));
                    }
                    let private_cap = !table.sequences.is_empty() && !self.context.is_system() && !table.rules.read.is_uniformly_readable();
                    let count = self.authorized_scan(&[
                        (MeterKind::IndexEntries, 1),
                        (MeterKind::Examined, if private_cap { *max as u64 } else { 0 }),
                        (MeterKind::RuleProbes, if private_cap { super::rules::rule_probes(&table.rules.read).saturating_mul(*max as u64) } else { 0 }),
                    ], |runner, allowance| {
                        if !private_cap && !table.is_expiring() {
                            return runner.tx.count_prefix(allowance, table_name, &index_name, &group, *max as u64 + 1);
                        }
                        // Main's transactional occupancy is a cheap upper bound
                        // on live rows. Below the cap it proves room without a
                        // walk; at the cap, B2's bounded live scan decides. A
                        // private sequence cap must still authorize occupants.
                        if !private_cap {
                            let physical = runner.tx.cap_count(allowance, table_name, by, &group)?;
                            if physical < *max as u64 { return Ok(physical); }
                        }
                        let mut count = 0;
                        let mut bounds = Bounds::default();
                        loop {
                            // Expired occupants consume physical work, never
                            // hidden-dependent logical charges. Exhaustion
                            // cannot establish occupancy and reveals no detail.
                            let batch = runner.tx.remaining().min(32);
                            if batch == 0 { return Err(RuntimeError::AuthorizationBudget { table: table_name.into(), effect }); }
                            let rows = runner.tx.scan(allowance, table_name, &index_name, &group, &bounds, Dir::Asc, batch)?;
                            let fetched = rows.len();
                            for (row, key) in rows {
                                bounds.after = crate::key::decode(&key).map(|values| values.into_iter().skip(group.len()).collect());
                                if !runner.expired(table, &row) {
                                    if private_cap { runner.visible_collision(table_name, &row, effect, &format!("cap {}", by.join(", ")))?; }
                                    count += 1;
                                }
                                if count >= *max as u64 { break; }
                            }
                            if count >= *max as u64 || fetched < batch { break; }
                        }
                        Ok(count)
                    })?;
                    if count >= *max as u64 {
                        self.observe_sequence_columns(table_name, new, by, effect == Effect::Insert)?;
                        // @ref LLP 3000.007#17 — cap diagnostics describe the schema, never retained group values.
                        self.refusing_clause(table_name, &format!("cap {}", by.join(", ")));
                        let message = format!("{table_name} holds at most {max} rows per group by {}", by.join(", "));
                        return Err(if table.is_expiring() {
                            RuntimeError::ExpiringCap { message, site: self.statement_site.clone() }
                        } else { RuntimeError::Constraint(message) });
                    }
                }
            }
        }
        Ok(())
    }

    fn collision_lookup(&mut self, table: &str, name: &str, index: &crate::schema::Index, key: &[Value], except: Option<&str>, effect: Effect) -> Result<Option<Value>, RuntimeError> {
        let probes = super::rules::rule_probes(&self.schema.tables[table].rules.read);
        self.authorized_scan(&[(MeterKind::RuleProbes, probes)], |runner, allowance| {
            let found = runner.live_lookup(allowance, table, name, index, key, #[cfg(feature = "sqlite")] None)?;
            if let Some(row) = &found && Some(row.field("id")?.as_str()?) != except {
                runner.observe_sequence_columns(table, row, &index.columns(), effect == Effect::Insert)?;
                runner.visible_collision(table, row, effect, &format!("unique {}", index.columns().join(", ")))?;
            }
            Ok(found)
        })
    }

    // @ref LLP 3000#7-decisions-during-execution — hidden collisions use the ordinary write-rule refusal
    fn visible_collision(
        &mut self,
        table: &str,
        row: &Value,
        effect: Effect,
        clause: &str,
    ) -> Result<(), RuntimeError> {
        let mut image = row.clone();
        let definition = self.schema.table(table).expect("validated");
        materialize_optional_fields(&mut image, definition);
        let expired = definition.expired(&image, self.context.now.unwrap_or(0));
        if expired || !self.check_rule(table, Effect::Read, None, &image)? {
            return Err(self.rule_refusal(table, effect, clause));
        }
        Ok(())
    }

    /// `after insert <- exists t[...]` holds for every row inserted this
    /// transaction; checked once the program has run.
    pub(super) fn check_final_exists(&mut self) -> Result<(), RuntimeError> {
        let inserted = std::mem::take(&mut self.inserted);
        for (table_name, row) in &inserted {
            let table = self.schema.table(table_name).expect("validated");
            for constraint in &table.constraints {
                let Constraint::FinalExistsOnInsert { table: target, index, key } = constraint else { continue };
                let refusal = || RuntimeError::Constraint(format!("inserting into {table_name} requires a matching row in {target} by the end of the mutation"));
                let has_references = key.iter().any(|term| term.reference_source().is_some());
                let key: Vec<Value> = if has_references {
                    // Preserve the structural target probe, but authorize each
                    // live row supplying its key before it can confer authority.
                    let rule = crate::schema::RuleExpr::Exists { table: target.clone(), index: index.clone(), key: key.clone(), equalities: vec![], provenance: crate::ir::KeyProvenance::Shape };
                    for term in key { if let crate::schema::RuleTerm::Field(field) = term { self.provisional_sequence_read |= self.device && table.sequences.contains_key(field); } }
                    self.final_reference_key(table_name, &rule, row)?.ok_or_else(refusal)?
                } else { key
                    .iter()
                    .map(|term| match term {
                        crate::schema::RuleTerm::Field(field) | crate::schema::RuleTerm::NextField(field) => {
                            // This inserted image owns a provisional ordinal even if no expression read it.
                            self.provisional_sequence_read |= self.device && table.sequences.contains_key(field);
                            row.field(field).cloned().unwrap_or(Value::Null)
                        },
                        crate::schema::RuleTerm::Viewer => Value::Id(self.context.viewer.clone()),
                        crate::schema::RuleTerm::Literal(value) => value.clone(),
                        crate::schema::RuleTerm::OldField(_) | crate::schema::RuleTerm::Reference { .. } | crate::schema::RuleTerm::ReferenceChain { .. } => Value::Null,
                    })
                    .collect() };
                self.read_tables.insert(target.clone());
                self.observe_sequence_selection(target, index, &key)?;
                let definition = self.schema.table(target).ok_or_else(|| RuntimeError::Schema(format!("missing {target}")))?;
                let target_index = definition.index(index).ok_or_else(|| RuntimeError::Schema(format!("missing {target}.{index}")))?;
                let found = match self.lookup_stored(target, index, target_index, &key, true)? {
                    Some(row) => self.live_aggregate(target, row)?,
                    None => None,
                };
                if has_references && self.device && let Some(row) = &found
                    && !self.witness_covered(target, index, &key, row)? {
                    self.unknown_fact(target, index, &key, "after insert");
                    return Err(refusal());
                }
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
        if old.is_some() && new.is_none() { self.timeline_purge_charge(table_name)?; }
        if self.schema.visible(table_name) { self.written_tables.insert(table_name.to_owned()); }
        if origin == Origin::Source {
            for m in self.schema.maintains.iter().filter(|m|m.row_key.as_ref().is_some_and(|k|k.table == table_name)) {
                self.written_tables.insert(m.target.clone());
            }
            for m in self.schema.maintains.iter().filter(|m|m.source == table_name) {
                if let Some(owner) = &m.private { self.written_tables.insert(owner.table.clone()); }
                if m.row_key.is_some() { self.written_tables.insert(m.target.clone()); }
            }
        }
        self.rows_written += 1;
        // @ref LLP 3000.038#4.2 — rows a delete's actions change, derived rows included, are not counted in the reply.
        if self.in_reference_actions && let Some(id) = old.or(new).and_then(|row| row.field("id").ok()).and_then(|id| id.as_str().ok()) {
            self.action_rows.insert((table_name.to_owned(), id.to_owned()));
        }
        if origin == Origin::Maintained { self.charge_maintain(MeterKind::RowsWritten, 1)?; }
        else { self.meter.charge(MeterKind::RowsWritten, 1)?; }
        let table = self.schema.table(table_name).expect("validated");
        // Final-exists obligations retain immutable successful-insert images.
        // Current creation facts have separate per-row ownership, so updates
        // and deletes remove only that row's contributions in O(index count).
        let id = old.or(new).expect("a row change has an image").field("id")?.as_str()?;
        let owner = (table_name.to_owned(), id.to_owned());
        if self.device && new.is_some() { self.provisional_rows.insert(owner.clone()); }
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
        #[cfg(all(feature = "sqlite", not(feature = "web-device-check")))]
        if !self.event_free { partition::row_changed(self, table_name, old, new, origin)?; }
        #[cfg(not(feature = "sqlite"))]
        if !self.event_free { partition::account_row_change::<false>(self, table_name, old, new, origin)?; }
        #[cfg(all(feature = "sqlite", feature = "web-device-check"))]
        if self.device { if !self.event_free { partition::account_row_change::<false>(self, table_name, old, new, origin)?; } }
        else if !self.event_free { partition::row_changed(self, table_name, old, new, origin)?; }
        if origin == Origin::Source {
            // @ref LLP 3000.015#3 — a source born expired never enters the count basis.
            // Retire it now, in the same transaction, so a later correction/sweep
            // cannot subtract a contribution which was never added. Other derived
            // consumers see the same physical deletion (including an expiring update).
            let new = if let Some(row) = new.filter(|row| self.expired(table, row))
                && self.schema.maintains.iter().any(|m| m.source == table_name && m.row_key.is_some())
            {
                let entries = self.tx.delete(table_name, table, row)?;
                self.meter.charge(MeterKind::IndexEntries, entries)?;
                None
            } else { new };
            if old.is_some() || new.is_some() {
                #[cfg(feature = "sqlite")]
                self.place_assets(table_name, table, old, new)?;
                self.maintain(table_name, old, new)?;
                if self.schema.timelines.iter().any(|t| t.maps(table_name)) { self.timeline_transition(table_name, old, new)?; }
            }
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
