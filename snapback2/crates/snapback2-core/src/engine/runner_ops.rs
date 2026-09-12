//! Row writes and their shared constraint and derived-write lifecycle.
use super::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum RowChangeOrigin {
    Source,
    Maintained,
}

impl<'a> Runner<'a> {
    pub(super) fn insert(&mut self, table: &str, row: Value) -> Result<(), RuntimeError> {
        self.insert_mode(table, row, false).map(|_| ())
    }

    pub(super) fn insert_if_absent(&mut self, table: &str, row: Value) -> Result<bool, RuntimeError> {
        self.insert_mode(table, row, true)
    }

    fn insert_mode(&mut self, table: &str, row: Value, if_absent: bool) -> Result<bool, RuntimeError> {
        validate_row(&self.schema, table, &row)?;
        if !self.check_rule(table, Effect::Insert, None, &row)? {
            return Err(RuntimeError::Rule {
                table: table.to_owned(),
                effect: Effect::Insert,
            });
        }
        if if_absent {
            let definition = self.schema.table(table).expect("validated table").clone();
            let indexes: BTreeSet<_> = definition.indexes.iter().filter(|(_, index)| index.unique)
                .map(|(name, _)| name.clone()).chain(definition.constraints.iter().filter_map(|constraint|
                    if let Constraint::Unique { index } = constraint { Some(index.clone()) } else { None })).collect();
            let checkpoint = self.trace.constraint_inputs.len();
            let local = self.rule_authority == RuleAuthority::ReceiptOnly;
            let mut missing = false;
            for index in indexes {
                let key = index_values(&row, definition.index(&index).expect("unique index"));
                if self.unique_conflict(table, &definition, &index, None, &row)? {
                    if local { self.trace.constraint_inputs.truncate(checkpoint); }
                    return Ok(false);
                }
                if self.rule_authority == RuleAuthority::ReceiptOnly
                    && !self.authority_absences.iter().any(|(t, i, k)| t == table && i == &index && k == &key) {
                    missing = true;
                }
            }
            // This primitive owns its absence proof; preliminary misses are
            // not independent ClientStore obligations after its decision.
            if local { self.trace.constraint_inputs.truncate(checkpoint); }
            if missing { self.missing_authority = true; return Ok(false); }
        }
        self.check_constraints_inner(table, None, &row, Effect::Insert, if_absent)?;
        let id = row.field("id")?.as_str()?.to_owned();
        if self.rule_authority == RuleAuthority::StoreAuthoritative {
            crate::assets_ledger::reconcile_row_assets(
                self.tx,
                self.schema,
                table,
                &id,
                None,
                Some(&row),
                self.context.viewer(),
                self.context.now.unwrap_or_else(unix_millis),
            )?;
        }
        self.tx.execute(
            "INSERT INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)",
            params![table, id, canonical_json(&row)],
        )?;
        let work = reindex_row(self.tx, self.schema, table, &row)?;
        self.finish_row_change(table, None, Some(&row), work, RowChangeOrigin::Source)?;
        Ok(true)
    }

    pub(super) fn update(
        &mut self,
        table: &str,
        key: &Value,
        patch: Value,
    ) -> Result<(), RuntimeError> {
        if patch.as_object()?.contains_key("id") {
            return Err(RuntimeError::Input(format!(
                "{table} update patch cannot change id"
            )));
        }
        let id = key.as_str()?;
        let Some(old) = self.fetch_id(table, id)? else {
            return self.missing_write_row(table, id);
        };
        if self.acknowledgement.as_deref() == Some(table) && !self.acknowledge(table, &old)? { return Ok(()); }
        let mut new = old.as_object()?.clone();
        for (name, value) in patch.as_object()? {
            new.insert(name.clone(), value.clone());
        }
        if self.acknowledgement.as_deref() == Some(table) { new.insert("seq".into(), Value::Int(self.seq as i64)); }
        self.replace_existing(table, key, old, Value::Row(new.into()))
    }

    pub(super) fn upsert(
        &mut self,
        table: &str,
        key: &Value,
        row: Value,
    ) -> Result<(), RuntimeError> {
        validate_row(&self.schema, table, &row)?;
        validate_addressed_row_id(table, key, &row)?;
        if let Some(old) = self.fetch_id(table, key.as_str()?)? {
            self.replace_existing(table, key, old, row)
        } else {
            self.insert(table, row)
        }
    }

    // Callers have just fetched this preimage, with no intervening row writes.
    // Update and upsert share validation and the complete write lifecycle.
    fn replace_existing(
        &mut self,
        table: &str,
        key: &Value,
        old: Value,
        new: Value,
    ) -> Result<(), RuntimeError> {
        let key_id = key.as_str()?;
        validate_row(&self.schema, table, &new)?;
        validate_addressed_row_id(table, key, &new)?;
        // @ref LLP 1001#9-schema-additions — update policy is one relation over both row images.
        if !self.check_rule(table, Effect::Update, Some(&old), &new)? {
            return Err(RuntimeError::Rule {
                table: table.to_owned(),
                effect: Effect::Update,
            });
        }
        self.check_constraints(table, Some(&old), &new, Effect::Update)?;
        if self.rule_authority == RuleAuthority::StoreAuthoritative {
            crate::assets_ledger::reconcile_row_assets(
                self.tx,
                self.schema,
                table,
                key_id,
                Some(&old),
                Some(&new),
                self.context.viewer(),
                self.context.now.unwrap_or_else(unix_millis),
            )?;
        }
        self.tx.execute(
            "UPDATE rows SET data = ?3 WHERE table_name = ?1 AND row_id = ?2",
            params![table, key_id, canonical_json(&new)],
        )?;
        let work = reindex_replaced_row(self.tx, self.schema, table, &old, &new)?;
        self.finish_row_change(table, Some(&old), Some(&new), work, RowChangeOrigin::Source)
    }

    pub(super) fn delete(&mut self, table: &str, id: &str) -> Result<(), RuntimeError> {
        let Some(old) = self.fetch_id(table, id)? else {
            return self.missing_write_row(table, id);
        };
        if !self.check_rule(table, Effect::Delete, None, &old)? {
            return Err(RuntimeError::Rule {
                table: table.to_owned(),
                effect: Effect::Delete,
            });
        }
        self.check_constraints(table, Some(&old), &old, Effect::Delete)?;
        if self.rule_authority == RuleAuthority::StoreAuthoritative {
            crate::assets_ledger::reconcile_row_assets(
                self.tx,
                self.schema,
                table,
                id,
                Some(&old),
                None,
                self.context.viewer(),
                self.context.now.unwrap_or_else(unix_millis),
            )?;
        }
        self.tx.execute(
            "DELETE FROM rows WHERE table_name = ?1 AND row_id = ?2",
            params![table, id],
        )?;
        let work = delete_index_row(self.tx, table, id)?;
        self.finish_row_change(table, Some(&old), None, work, RowChangeOrigin::Source)
    }

    /// Complete the shared post-validation portion of one physical row change.
    /// SQLite owns the row and ordinary index mutation before this point; the
    /// runner owns derived invalidation, provenance, timers, and aggregates in
    /// the same transaction before the next statement may execute.
    // @ref LLP 1001#2-what-a-commit-records — every physical source or
    // maintained-target row change records the same transactional lifecycle.
    pub(super) fn finish_row_change(
        &mut self,
        table: &str,
        old: Option<&Value>,
        new: Option<&Value>,
        index_work: search_index::Derivation,
        origin: RowChangeOrigin,
    ) -> Result<(), RuntimeError> {
        if let Some(preimages) = &mut self.replay_preimages {
            let row = old.or(new).expect("physical row change has an image");
            let id = row.field("id")?.as_str()?.to_owned();
            if !preimages.contains_key(&(table.to_owned(), id.clone())) {
                self.replay_preimage_bytes = self.replay_preimage_bytes.saturating_add(
                    128 + table.len() as u64 + id.len() as u64 + old.map_or(0, Value::heap_bytes),
                );
                if self.replay_preimage_bytes > crate::certificate::Ceilings::default().heap_bytes {
                    self.replay_preimages = None;
                } else {
                    preimages.insert((table.to_owned(), id), old.cloned());
                }
            }
        }
        self.search_nodes.clear();
        self.derive_charge(index_work)?;
        match (old, new) {
            (None, Some(row)) => {
                self.remember_created_row(table, row)?;
            }
            (Some(_), Some(row)) => {
                self.refresh_created_points(table, row)?;
            }
            (Some(row), None) => {
                self.forget_created_points(table, row.field("id")?.as_str()?);
            }
            _ => {}
        }
        if old.is_none()
            && let Some(row) = new
        {
            self.inserted_rows.push((table.to_owned(), row.clone()));
        }
        self.clear_rule_memos();
        if let Some(row) = old {
            self.touch_row(table, row)?;
        }
        if let Some(row) = new {
            self.touch_row(table, row)?;
        }
        self.bump_write(table);
        self.maintain_timers(table, old, new)?;
        self.deliver_row_change(table, old, new)?;
        if origin == RowChangeOrigin::Source {
            self.maintain(table, old, new)?;
        }
        Ok(())
    }

    // @ref LLP 1011#b3-one-missing-row-rule-no-id-in-an-upsert-row — a local
    // write can distinguish proved absence from missing receipt authority.
    fn missing_write_row(&mut self, table: &str, id: &str) -> Result<(), RuntimeError> {
        if self.rule_authority == RuleAuthority::ReceiptOnly
            && !self
                .authority_absences
                .iter()
                .any(|(held_table, index, key)| {
                    held_table == table
                        && index == "byId"
                        && matches!(key.as_slice(), [Value::Id(value)] if value == id)
                })
        {
            self.mark_missing_authority();
            Ok(())
        } else {
            Err(RuntimeError::Require {
                site: None,
                code: "NOT_FOUND".to_owned(),
            })
        }
    }

    pub(super) fn maintain(
        &mut self,
        source: &str,
        old: Option<&Value>,
        new: Option<&Value>,
    ) -> Result<(), RuntimeError> {
        let maintains: Vec<_> = self
            .schema
            .maintains
            .iter()
            .filter(|maintain| maintain.source == source)
            .cloned()
            .collect();
        for maintain in maintains {
            let table = self.schema.table(&maintain.source).ok_or_else(|| {
                RuntimeError::Schema(format!("missing table {}", maintain.source))
            })?;
            // A row move applies the old group before the new group. This is
            // observable when the maintained target has a cross-group unique
            // constraint, so do not derive execution order from address sort.
            let mut changes = Vec::<(String, Vec<Value>, i128)>::new();
            if let Some(old) = old {
                let group = crate::cap::maintained_group(table, old, &maintain.by)?;
                let delta = self.aggregate_delta(&maintain, &group.source, -1)?;
                changes.push((group.id, group.key, delta));
            }
            if let Some(new) = new {
                let group = crate::cap::maintained_group(table, new, &maintain.by)?;
                let delta = self.aggregate_delta(&maintain, &group.source, 1)?;
                if let Some(change) = changes.iter_mut().find(|change| change.0 == group.id) {
                    change.2 += delta;
                } else {
                    changes.push((group.id, group.key, delta));
                }
            }
            for (id, key, delta) in changes {
                self.apply_aggregate_change(&maintain, id, key, delta)?;
            }
        }
        Ok(())
    }

    fn aggregate_delta(
        &self,
        maintain: &Maintain,
        source: &Value,
        direction: i64,
    ) -> Result<i128, RuntimeError> {
        Ok(match &maintain.kind {
            MaintainKind::Count => i128::from(direction),
            MaintainKind::Sum { of } => i128::from(direction)
                .checked_mul(i128::from(source.field(of)?.as_int()?))
                .ok_or_else(|| {
                    RuntimeError::Constraint("aggregate multiplication overflow".to_owned())
                })?,
        })
    }

    // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — maintained rows
    // use the canonical sparse representation and ordinary row lifecycle.
    fn apply_aggregate_change(
        &mut self,
        maintain: &Maintain,
        id: String,
        key: Vec<Value>,
        delta: i128,
    ) -> Result<(), RuntimeError> {
        let existing = self.fetch_id(&maintain.target, &id)?;
        // @ref LLP 1001#2-what-a-commit-records — a local aggregate may start
        // from zero only when authority proved the deterministic target absent.
        if existing.is_none()
            && self.rule_authority == RuleAuthority::ReceiptOnly
            && !self.authority_absences.iter().any(|(table, index, key)| {
                table == &maintain.target
                    && index == "byId"
                    && matches!(key.as_slice(), [Value::Id(value)] if value == &id)
            })
        {
            self.mark_missing_authority();
            return Ok(());
        }
        let old_value = existing
            .as_ref()
            .and_then(|row| row.field("value").ok())
            .map(Value::as_int)
            .transpose()?
            .unwrap_or(0);
        let next = i128::from(old_value) + delta;
        if !(I53_MIN as i128..=I53_MAX as i128).contains(&next) {
            return Err(ValueError::Overflow(next).into());
        }
        let empty = next == 0;
        if empty {
            if let Some(existing) = existing {
                return self.delete_aggregate_row(&maintain.target, existing);
            }
            return Ok(());
        }
        let mut row = BTreeMap::from([
            ("id".to_owned(), Value::Id(id.clone())),
            ("value".to_owned(), Value::Int(next as i64)),
        ]);
        for (field, value) in maintain.by.iter().zip(key) {
            row.insert(field.clone(), value);
        }
        self.write_aggregate_row(&maintain.target, Value::Row(row.into()))
    }

    fn delete_aggregate_row(&mut self, target: &str, row: Value) -> Result<(), RuntimeError> {
        let id = row.field("id")?.as_str()?.to_owned();
        self.check_constraints(target, Some(&row), &row, Effect::Delete)?;
        self.tx.execute(
            "DELETE FROM rows WHERE table_name = ?1 AND row_id = ?2",
            params![target, id],
        )?;
        let work = delete_index_row(self.tx, target, &id)?;
        self.finish_row_change(target, Some(&row), None, work, RowChangeOrigin::Maintained)
    }

    pub(super) fn write_aggregate_row(
        &mut self,
        target: &str,
        row: Value,
    ) -> Result<(), RuntimeError> {
        let id = row.field("id")?.as_str()?.to_owned();
        let existing = self.fetch_id(target, &id)?;
        validate_row(self.schema, target, &row)?;
        let effect = if existing.is_some() {
            Effect::Update
        } else {
            Effect::Insert
        };
        // LLP 1001 §7 ruling: maintained targets are engine-owned, so aggregate
        // writes bypass user insert/update/delete rules but never constraints or unique indexes.
        self.check_constraints(target, existing.as_ref(), &row, effect)?;
        self.tx.execute(
            "INSERT INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)
             ON CONFLICT(table_name, row_id) DO UPDATE SET data = excluded.data",
            params![target, id, canonical_json(&row)],
        )?;
        let aggregate = self
            .fetch_id(target, &id)?
            .expect("aggregate row was just upserted");
        let work = reindex_row(self.tx, self.schema, target, &aggregate)?;
        self.finish_row_change(
            target,
            existing.as_ref(),
            Some(&aggregate),
            work,
            RowChangeOrigin::Maintained,
        )
    }

    // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — stale
    // predecessor projection ids are cleared under next-generation constraints.
    pub(super) fn clear_aggregate_ids(
        &mut self,
        target: &str,
        ids: &BTreeSet<String>,
    ) -> Result<(), RuntimeError> {
        let rows = fetch_table_connection(self.tx, target)?;
        for row in rows {
            let id = row.field("id")?.as_str()?.to_owned();
            if !ids.contains(&id) {
                continue;
            }
            self.delete_aggregate_row(target, row)?;
        }
        Ok(())
    }

    pub(super) fn emit(&mut self, effect: &str, payload: Value) -> Result<(), RuntimeError> {
        let id = self.input(Input::NewId)?.as_str()?.to_owned();
        let now = self
            .context
            .now
            .ok_or_else(|| RuntimeError::Input("now was not pinned".to_owned()))?;
        self.tx.execute(
            "INSERT INTO _outbox(
                id, seq, effect, payload, state, attempts, next_at,
                last_error, result, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, 'queued', 0, ?5, NULL, NULL, ?5, ?5)",
            params![id, self.seq as i64, effect, canonical_json(&payload), now],
        )?;
        self.trace.emits.push(EmitRecord {
            id,
            effect: effect.to_owned(),
        });
        self.bump_write("_outbox");
        Ok(())
    }

    pub(super) fn touch_row(&mut self, table: &str, row: &Value) -> Result<(), RuntimeError> {
        let table_schema = self
            .schema
            .table(table)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?;
        let row_id = row.field("id")?.as_str()?.to_owned();
        if table_schema.indexes.is_empty() {
            self.trace.touched.push(TouchedKey {
                table: table.to_owned(),
                index: String::new(),
                key: Vec::new(),
                row_id: row_id.clone(),
            });
        }
        for (index, definition) in &table_schema.indexes {
            if let Some(offset) = definition.derived_offset() {
                let touch = crate::store::ScopeTouch {
                    table: table.into(),
                    index: index.clone(),
                    prefix: index_values(row, definition)[..offset].to_vec(),
                };
                if !self.trace.scope_touches.contains(&touch) {
                    self.trace.scope_touches.push(touch);
                }
                continue;
            }
            self.trace.touched.push(TouchedKey {
                table: table.to_owned(),
                index: index.clone(),
                key: index_values(row, definition),
                row_id: row_id.clone(),
            });
        }
        Ok(())
    }

    fn remember_created_row(&mut self, table: &str, row: &Value) -> Result<(), RuntimeError> {
        let id = row.field("id")?.as_str()?.to_owned();
        self.created_rows.insert((table.to_owned(), id));
        self.refresh_created_points(table, row)
    }

    fn refresh_created_points(&mut self, table: &str, row: &Value) -> Result<(), RuntimeError> {
        let id = row.field("id")?.as_str()?.to_owned();
        if !self.created_rows.contains(&(table.to_owned(), id.clone())) {
            return Ok(());
        }
        self.forget_created_points(table, &id);
        let indexes = self
            .schema
            .table(table)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?
            .indexes
            .clone();
        for (index, definition) in indexes {
            if definition.derived_offset().is_some() {
                continue;
            }
            self.created_points.insert((
                table.to_owned(),
                index,
                canonical_json(&index_values(row, &definition)),
                id.clone(),
            ));
        }
        Ok(())
    }

    fn forget_created_points(&mut self, table: &str, id: &str) {
        self.created_points
            .retain(|(row_table, _, _, row_id)| row_table != table || row_id != id);
    }

    pub(super) fn check_constraints(
        &mut self,
        table_name: &str,
        old: Option<&Value>,
        new: &Value,
        effect: Effect,
    ) -> Result<(), RuntimeError> {
        self.check_constraints_inner(table_name, old, new, effect, false)
    }

    fn check_constraints_inner(&mut self, table_name: &str, old: Option<&Value>, new: &Value,
        effect: Effect, skip_unique: bool) -> Result<(), RuntimeError> {
        let table = self
            .schema
            .table(table_name)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?
            .clone();
        for constraint in &table.constraints {
            match constraint {
                Constraint::AppendOnly if effect != Effect::Insert => {
                    return Err(RuntimeError::Constraint(format!(
                        "{table_name} is appendOnly"
                    )));
                }
                Constraint::Immutable { fields } if effect == Effect::Update => {
                    let old = old.expect("update has preimage");
                    if fields
                        .iter()
                        .any(|field| old.field(field).ok() != new.field(field).ok())
                    {
                        return Err(RuntimeError::Constraint(format!(
                            "{table_name} immutable fields changed"
                        )));
                    }
                }
                Constraint::Unique { index } if effect != Effect::Delete && !skip_unique => {
                    self.check_unique(table_name, &table, index, old, new)?
                }
                Constraint::Cap { by, max } => {
                    let prefix = crate::cap::group_key(new, by);
                    let increases_group = match effect {
                        Effect::Insert => true,
                        Effect::Update => {
                            let old = old.expect("update has preimage");
                            let old_prefix = crate::cap::group_key(old, by);
                            old_prefix != prefix
                        }
                        Effect::Read | Effect::Delete => false,
                    };
                    if !increases_group {
                        continue;
                    }
                    if let Some(maintain) = crate::cap::count_maintain(self.schema, table_name, by)
                    {
                        let group = crate::cap::maintained_group(&table, new, by)?;
                        let count_row = self.fetch_id(&maintain.target, &group.id)?;
                        let proven_absent = self.authority_absences.iter().any(
                            |(target, index, key)| {
                                target == &maintain.target
                                    && index == "byId"
                                    && matches!(key.as_slice(), [Value::Id(value)] if value == &group.id)
                            },
                        );
                        if count_row.is_none()
                            && self.rule_authority == RuleAuthority::ReceiptOnly
                            && !proven_absent
                        {
                            // @ref LLP 1017#24-metering — the one-row reserve cannot
                            // honestly cover a source scan. Match aggregate replay and
                            // make the tentative mutation partial instead of inventing zero.
                            self.mark_missing_authority();
                            continue;
                        }
                        let count = count_row
                            .as_ref()
                            .map(|row| row.field("value").and_then(Value::as_int))
                            .transpose()?
                            .unwrap_or(0);
                        self.trace.examined += 1;
                        self.trace.constraint_inputs.push(ConstraintTrace {
                            table: maintain.target.clone(),
                            check: format!("Cap({by:?},{max})"),
                            index: "byId".to_owned(),
                            prefix: vec![Value::Id(group.id.clone())],
                            examined_ids: count_row
                                .as_ref()
                                .map(|_| vec![group.id.clone()])
                                .unwrap_or_default(),
                        });
                        if count >= i64::from(*max) {
                            return Err(RuntimeError::Constraint(format!(
                                "{table_name} cap {max} reached for group ({}) = {}",
                                by.join(", "),
                                canonical_json(&Value::Array(group.key))
                            )));
                        }
                        continue;
                    }
                    let (index_name, index) = crate::cap::enforcement_index(&table, by)
                        .ok_or_else(|| {
                            RuntimeError::Schema(format!(
                                "cap on {table_name} requires an index beginning with {by:?}"
                            ))
                        })?;
                    let rows = scan_indexed(
                        self.tx,
                        table_name,
                        index_name,
                        &table,
                        index,
                        &prefix,
                        None,
                        None,
                        None,
                        Order::Asc,
                        *max as usize,
                    )?;
                    self.trace.examined += rows.len() as u64;
                    self.trace.constraint_inputs.push(ConstraintTrace {
                        table: table_name.to_owned(),
                        check: format!("Cap({by:?},{max})"),
                        index: index_name.clone(),
                        prefix: prefix.clone(),
                        examined_ids: row_ids(&rows)?,
                    });
                    if rows.len() >= *max as usize {
                        return Err(RuntimeError::Constraint(format!(
                            "{table_name} cap {max} reached for group ({}) = {}",
                            by.join(", "),
                            canonical_json(&Value::Array(prefix))
                        )));
                    }
                }
                Constraint::Text { field, min, format }
                    if matches!(effect, Effect::Insert | Effect::Update) =>
                {
                    let value = new.as_object()?.get(field);
                    if let Some(value) = value.filter(|value| !matches!(value, Value::Null)) {
                        let text = value.as_str()?;
                        if text.chars().count() < *min as usize {
                            return Err(RuntimeError::Constraint(format!(
                                "{table_name}.{field} must contain at least {min} characters"
                            )));
                        }
                        let valid = format.is_none_or(|format| format.matches(text));
                        if !valid {
                            let expected = match format {
                                Some(TextFormat::Handle) => {
                                    "lowercase a-z, digits, and underscore only"
                                }
                                Some(TextFormat::Url) => {
                                    "one absolute http:// or https:// URL without whitespace"
                                }
                                None => unreachable!(),
                            };
                            return Err(RuntimeError::Constraint(format!(
                                "{table_name}.{field} must use {expected}"
                            )));
                        }
                    }
                }
                _ => {}
            }
        }
        for (name, index) in &table.indexes {
            if index.unique && effect != Effect::Delete && !skip_unique {
                self.check_unique(table_name, &table, name, old, new)?;
            }
        }
        Ok(())
    }

    // @ref LLP 1001#9-schema-additions — creator-seat existence is checked after all writes but before commit.
    /// Enforce insert-scoped relational constraints against the transaction's
    /// final state. The queued source image is the successful insert image;
    /// later updates or deletes do not turn this into a general invariant.
    pub(super) fn check_final_constraints(&mut self) -> Result<(), RuntimeError> {
        let inserted_rows = self.inserted_rows.clone();
        for (source_table, source_row) in inserted_rows {
            let constraints = self
                .schema
                .table(&source_table)
                .ok_or_else(|| RuntimeError::Schema(format!("missing table {source_table}")))?
                .constraints
                .clone();
            for constraint in constraints {
                let Constraint::FinalExistsOnInsert {
                    table,
                    index,
                    key: terms,
                } = constraint
                else {
                    continue;
                };
                let key = terms
                    .iter()
                    .map(|term| self.rule_term(term, None, &source_row))
                    .collect::<Result<Vec<_>, _>>()?;
                let found = self.lookup_raw(&table, &index, &key)?;
                self.trace.rule_probes += 1;
                self.trace.constraint_inputs.push(ConstraintTrace {
                    table: table.clone(),
                    check: format!(
                        "FinalExistsOnInsert({source_table}->{table}.{index},{terms:?})"
                    ),
                    index: index.clone(),
                    prefix: key.clone(),
                    examined_ids: found
                        .as_ref()
                        .and_then(|row| row.field("id").ok())
                        .and_then(|id| id.as_str().ok())
                        .map(|id| vec![id.to_owned()])
                        .unwrap_or_default(),
                });
                if found.is_none() {
                    return Err(RuntimeError::Constraint(format!(
                        "{source_table} insert requires final row at {table}.{index} {key:?}"
                    )));
                }
            }
        }
        Ok(())
    }

    pub(super) fn check_unique(&mut self, table_name: &str, table: &Table, index_name: &str,
        old: Option<&Value>, new: &Value) -> Result<(), RuntimeError> {
        if self.unique_conflict(table_name, table, index_name, old, new)? {
            return Err(RuntimeError::Constraint(format!("sealed unique conflict on {table_name}.{index_name}")));
        }
        Ok(())
    }

    fn unique_conflict(
        &mut self,
        table_name: &str,
        table: &Table,
        index_name: &str,
        old: Option<&Value>,
        new: &Value,
    ) -> Result<bool, RuntimeError> {
        let index = table
            .index(index_name)
            .ok_or_else(|| RuntimeError::Schema(format!("missing unique index {index_name}")))?;
        let wanted = index_values(new, index);
        let old_id = old
            .and_then(|row| row.field("id").ok())
            .and_then(|id| id.as_str().ok());
        let examined = scan_indexed(
            self.tx,
            table_name,
            index_name,
            table,
            index,
            &wanted,
            None,
            None,
            None,
            Order::Asc,
            2,
        )?;
        self.trace.constraint_inputs.push(ConstraintTrace {
            table: table_name.to_owned(),
            check: format!("Unique({index_name})"),
            index: index_name.to_owned(),
            prefix: wanted,
            examined_ids: row_ids(&examined)?,
        });
        Ok(examined.into_iter().any(|row| {
            let id = row.field("id").ok().and_then(|id| id.as_str().ok());
            id != old_id
        }))
    }

    pub(super) fn check_rule(
        &mut self,
        table: &str,
        effect: Effect,
        old: Option<&Value>,
        next: &Value,
    ) -> Result<bool, RuntimeError> {
        if effect == Effect::Update && self.acknowledgement.as_deref() == Some(table) { return Ok(true); }
        // @ref LLP 1016#d1--the-system-principal-is-the-stores-owner — only viewer rules are bypassed; row validation, constraints, and trace accounting still run.
        if self.context.viewer.is_system() {
            return Ok(true);
        }
        let table_name = table;
        let table = self
            .schema
            .table(table)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?;
        let rule = table.rules.for_effect(effect).clone();
        let mut next = next.clone();
        materialize_optional_fields(&mut next, table);
        let mut old = old.cloned();
        if let Some(old) = &mut old {
            materialize_optional_fields(old, table);
        }
        let rule_hash = self.hashes.table(table_name, effect);
        let authority_miss_serial = self.authority_miss_serial;
        let allowed = self.eval_rule(
            &rule,
            rule_hash,
            old.as_ref(),
            &next,
            effect == Effect::Insert,
        )?;
        // A missing authority fact is unknown, not false: negation and
        // disjunction may not turn its fail-closed placeholder into access.
        Ok(allowed && self.authority_miss_serial == authority_miss_serial)
    }

    pub(super) fn eval_rule(
        &mut self,
        rule: &RuleExpr,
        rule_hash: &str,
        old: Option<&Value>,
        next: &Value,
        created_allowed: bool,
    ) -> Result<bool, RuntimeError> {
        if self.rule_certificate.is_some() {
            self.step(1)?;
        }
        match rule {
            RuleExpr::Public { .. } | RuleExpr::Allow => Ok(true),
            RuleExpr::Deny => Ok(false),
            RuleExpr::Eq(left, right) => {
                Ok(self.rule_term(left, old, next)? == self.rule_term(right, old, next)?)
            }
            RuleExpr::Ne(left, right) => {
                Ok(self.rule_term(left, old, next)? != self.rule_term(right, old, next)?)
            }
            RuleExpr::And(rules) => {
                for rule in rules {
                    if !self.eval_rule(rule, rule_hash, old, next, created_allowed)? {
                        return Ok(false);
                    }
                }
                Ok(true)
            }
            RuleExpr::Or(rules) => {
                for rule in rules {
                    if self.eval_rule(rule, rule_hash, old, next, created_allowed)? {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            RuleExpr::Not(rule) => {
                Ok(!self.eval_rule(rule, rule_hash, old, next, created_allowed)?)
            }
            RuleExpr::Exists {
                table, index, key, ..
            } => {
                // @ref LLP 1001#9-schema-additions — authors cannot
                // label authorization inputs readable. The schema proves whether
                // the exact indexed row is readable; every other protected input
                // is represented by an authority verdict.
                let structurally_readable = self.schema.rule_input_is_readable(table, index, key);
                let key = key
                    .iter()
                    .map(|term| self.rule_term(term, old, next))
                    .collect::<Result<Vec<_>, _>>()?;
                let pinned_inputs_digest = crate::offline::rule_inputs_digest(table, index, &key);
                let memo_key = format!("{rule_hash}:{pinned_inputs_digest}");
                if let Some(result) = self.rule_memo.get(&memo_key) {
                    return Ok(*result);
                }
                if let Some(verdict) = self.verdicts.iter().find(|verdict| {
                    verdict.rule_hash == rule_hash
                        && verdict.pinned_inputs_digest == pinned_inputs_digest
                        && verdict.principal == self.context.viewer.as_str()
                        && verdict.auth_epoch == self.context.auth_epoch
                }) {
                    self.rule_memo.insert(memo_key.clone(), verdict.result);
                    self.rule_memo_entries.push(memo_key);
                    return Ok(verdict.result);
                }
                if !structurally_readable && self.rule_authority == RuleAuthority::ReceiptOnly {
                    self.mark_missing_authority();
                    return Ok(false);
                }
                let found = self.lookup_raw(table, index, &key)?;
                let result = found.is_some();
                // Always evaluate the target policy so its authoritative
                // transitive probes stay metered and traced. Structural proof
                // alone controls disclosure; the viewer-specific result is
                // deliberately not an authority to reveal this input.
                self.trace_rule_input_policy(table, found.as_ref())?;
                let hidden = !structurally_readable;
                self.trace.rule_probes += 1;
                self.trace.rule_inputs.push(RuleInputTrace {
                    rule_hash: rule_hash.to_owned(),
                    table: table.clone(),
                    index: index.clone(),
                    key: key.clone(),
                    result,
                    hidden,
                    pinned_inputs_digest: pinned_inputs_digest.clone(),
                });
                if hidden {
                    self.receipt.verdicts.push(Verdict {
                        rule_hash: rule_hash.to_owned(),
                        pinned_inputs_digest,
                        principal: self.context.viewer.to_string(),
                        auth_epoch: self.context.auth_epoch,
                        result,
                    });
                } else if let Some(found) = found {
                    let id = found.field("id")?.as_str()?.to_owned();
                    self.record_row(table, &id, &found, true);
                } else {
                    let absence = (table.clone(), index.clone(), key);
                    self.trace.absences.push(absence.clone());
                    self.receipt.absences.push(absence);
                }
                self.rule_memo.insert(memo_key.clone(), result);
                self.rule_memo_entries.push(memo_key);
                Ok(result)
            }
            RuleExpr::Created {
                table, index, key, ..
            } => {
                if !created_allowed {
                    return Err(RuntimeError::Schema(
                        "created-row probe evaluated outside a table insert rule".to_owned(),
                    ));
                }
                let key = key
                    .iter()
                    .map(|term| self.rule_term(term, old, next))
                    .collect::<Result<Vec<_>, _>>()?;
                let pinned_inputs_digest =
                    crate::offline::created_inputs_digest(table, index, &key);
                let encoded_key = canonical_json(&key);
                let result = self.created_points.iter().any(
                    |(created_table, created_index, created_key, _)| {
                        created_table == table
                            && created_index == index
                            && created_key == &encoded_key
                    },
                );
                self.trace.rule_probes += 1;
                self.trace.rule_inputs.push(RuleInputTrace {
                    rule_hash: rule_hash.to_owned(),
                    table: table.clone(),
                    index: index.clone(),
                    key,
                    result,
                    // A transaction-local provenance fact can never become a
                    // reusable row, absence, or authority receipt.
                    hidden: true,
                    pinned_inputs_digest,
                });
                Ok(result)
            }
        }
    }

    // @ref LLP 1001#9-schema-additions — dynamic policy evaluation preserves
    // authoritative metering and nested traces, while structural exact-row
    // proof alone determines whether the input is client-readable.
    fn trace_rule_input_policy(
        &mut self,
        table: &str,
        found: Option<&Value>,
    ) -> Result<(), RuntimeError> {
        let read = self
            .schema
            .table(table)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?
            .rules
            .read
            .clone();
        let Some(found) = found else {
            return Ok(());
        };
        let hash = self.hashes.table(table, Effect::Read);
        self.eval_visibility_rule(&read, hash, found)?;
        Ok(())
    }

    fn eval_visibility_rule(
        &mut self,
        rule: &RuleExpr,
        rule_hash: &str,
        row: &Value,
    ) -> Result<bool, RuntimeError> {
        if self.rule_certificate.is_some() {
            self.step(1)?;
        }
        match rule {
            RuleExpr::Public { .. } | RuleExpr::Allow => Ok(true),
            RuleExpr::Deny => Ok(false),
            RuleExpr::Eq(left, right) => {
                Ok(self.rule_term(left, None, row)? == self.rule_term(right, None, row)?)
            }
            RuleExpr::Ne(left, right) => {
                Ok(self.rule_term(left, None, row)? != self.rule_term(right, None, row)?)
            }
            RuleExpr::And(rules) => {
                for rule in rules {
                    if !self.eval_visibility_rule(rule, rule_hash, row)? {
                        return Ok(false);
                    }
                }
                Ok(true)
            }
            RuleExpr::Or(rules) => {
                for rule in rules {
                    if self.eval_visibility_rule(rule, rule_hash, row)? {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            RuleExpr::Not(rule) => Ok(!self.eval_visibility_rule(rule, rule_hash, row)?),
            RuleExpr::Exists {
                table, index, key, ..
            } => {
                let key = key
                    .iter()
                    .map(|term| self.rule_term(term, None, row))
                    .collect::<Result<Vec<_>, _>>()?;
                let pinned_inputs_digest = crate::offline::rule_inputs_digest(table, index, &key);
                let memo_key = format!("{rule_hash}:{pinned_inputs_digest}");
                if let Some(result) = self.visibility_memo.get(&memo_key) {
                    return Ok(*result);
                }
                let result = self.lookup_raw(table, index, &key)?.is_some();
                // Visibility derivation is authoritative work and uses the
                // same certificate meter as an outer rule probe. It does not
                // recursively classify this nested input for disclosure, so
                // self-referential read rules terminate after this lookup.
                self.trace.rule_probes = self.trace.rule_probes.saturating_add(1);
                self.trace.rule_inputs.push(RuleInputTrace {
                    rule_hash: rule_hash.to_owned(),
                    table: table.clone(),
                    index: index.clone(),
                    key,
                    result,
                    hidden: true,
                    pinned_inputs_digest,
                });
                self.visibility_memo.insert(memo_key.clone(), result);
                self.visibility_memo_entries.push(memo_key);
                Ok(result)
            }
            RuleExpr::Created { .. } => Err(RuntimeError::Schema(
                "created-row probe evaluated while deriving read visibility".to_owned(),
            )),
        }
    }

    fn clear_rule_memos(&mut self) {
        self.rule_memo.clear();
        self.rule_memo_entries.clear();
        self.visibility_memo.clear();
        self.visibility_memo_entries.clear();
    }

    pub(super) fn rule_term(
        &self,
        term: &RuleTerm,
        old: Option<&Value>,
        next: &Value,
    ) -> Result<Value, RuntimeError> {
        match term {
            RuleTerm::Field(name) => Ok(next.field(name)?.clone()),
            RuleTerm::NextField(name) => old
                .ok_or_else(|| {
                    RuntimeError::Schema(
                        "next-row rule term evaluated outside an update rule".to_owned(),
                    )
                })
                .and_then(|_| next.field(name).cloned().map_err(Into::into)),
            RuleTerm::OldField(name) => old
                .ok_or_else(|| {
                    RuntimeError::Schema(
                        "old-row rule term evaluated outside an update rule".to_owned(),
                    )
                })?
                .field(name)
                .cloned()
                .map_err(Into::into),
            RuleTerm::Viewer => Ok(Value::Id(self.context.viewer.to_string())),
            RuleTerm::Literal(value) => Ok(value.clone()),
        }
    }

    pub(super) fn lookup_raw(
        &self,
        table: &str,
        index: &str,
        key: &[Value],
    ) -> Result<Option<Value>, RuntimeError> {
        let table_schema = self
            .schema
            .table(table)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?;
        let index_schema = table_schema
            .index(index)
            .ok_or_else(|| RuntimeError::Schema(format!("missing index {table}.{index}")))?;
        let mut found = lookup_indexed(self.tx, self.schema, table, index, index_schema, key)?;
        if let Some(row) = &mut found {
            materialize_optional_fields(row, table_schema);
        }
        Ok(found)
    }

    pub(super) fn fetch_id(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        let mut statement = self.tx.prepare_cached(
            "SELECT data FROM rows WHERE table_name = ?1 AND row_id = ?2",
        )?;
        let data: Option<String> = statement
            .query_row(params![table, id], |row| row.get(0))
            .optional()?;
        let mut row = data
            .map(|data| {
                serde_json::from_str(&data).map_err(|error| RuntimeError::Schema(error.to_string()))
            })
            .transpose()?;
        if let Some(row) = &mut row {
            let table = self
                .schema
                .table(table)
                .ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?;
            materialize_optional_fields(row, table);
        }
        Ok(row)
    }

    pub(super) fn record_row(&mut self, table: &str, id: &str, row: &Value, client: bool) {
        let retained = self.row_membership.record(
            &mut self.trace.rows,
            &mut self.receipt.rows,
            table,
            id,
            row,
            client,
        );
        if self.account_search_pool {
            self.derived_hold(retained);
        }
    }

    pub(super) fn bump_write(&mut self, table: &str) {
        *self.trace.writes.entry(table.to_owned()).or_default() += 1;
    }

    pub(super) fn step(&mut self, amount: u64) -> Result<(), RuntimeError> {
        self.trace.steps = self.trace.steps.saturating_add(amount);
        let max_steps = self
            .certificate
            .map(|certificate| {
                certificate
                    .max_steps
                    .saturating_sub(certificate.derived_steps)
            })
            .or_else(|| {
                self.rule_certificate
                    .map(|certificate| certificate.max_steps)
            });
        if let Some(max_steps) = max_steps
            && self.trace.steps > max_steps
        {
            return Err(RuntimeError::Steps(max_steps));
        }
        Ok(())
    }

    fn mark_missing_authority(&mut self) {
        self.missing_authority = true;
        self.authority_miss_serial = self.authority_miss_serial.saturating_add(1);
    }


}

// @ref LLP 1001#1-store-storers — serialized row identity may never diverge from its storage address.
// @ref LLP 1001#9-schema-additions — implicit row identity cannot change through an addressed write.
fn validate_addressed_row_id(table: &str, key: &Value, row: &Value) -> Result<(), RuntimeError> {
    let key = key.as_str()?;
    let row_id = row.field("id")?.as_str()?;
    if row_id != key {
        return Err(RuntimeError::Input(format!(
            "{table} row id {row_id:?} does not match addressed key {key:?}"
        )));
    }
    Ok(())
}

#[cfg(test)]
#[path = "runner_ops_tests.rs"]
mod tests;
