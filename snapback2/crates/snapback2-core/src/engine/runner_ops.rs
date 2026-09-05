#![allow(unused_imports)]
//! Runner, part 2: writes, maintenance, constraints, rules, bookkeeping.
use super::*;
use crate::certificate::Certificate;
use crate::ir::*;
use crate::schema::*;
use crate::value::{I53_MAX, I53_MIN, Value, ValueError, canonical_json, digest, object};
use rusqlite::{Connection, OptionalExtension, Transaction, params, params_from_iter};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use thiserror::Error;

impl<'a> Runner<'a> {
    pub(super) fn insert(&mut self, table: &str, row: Value) -> Result<(), RuntimeError> {
        validate_row(self.schema.table(table), table, &row)?;
        if !self.check_rule(table, Effect::Insert, None, &row)? {
            return Err(RuntimeError::Rule {
                table: table.to_owned(),
                effect: Effect::Insert,
            });
        }
        self.check_constraints(table, None, &row, Effect::Insert)?;
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
        reindex_row(self.tx, self.schema, table, &row)?;
        self.remember_created_row(table, &row)?;
        self.inserted_rows.push((table.to_owned(), row.clone()));
        self.clear_rule_memos();
        self.touch_row(table, &row)?;
        self.bump_write(table);
        self.maintain(table, None, Some(&row))?;
        Ok(())
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
        let mut new = old.as_object()?.clone();
        for (name, value) in patch.as_object()? {
            new.insert(name.clone(), value.clone());
        }
        self.replace(table, key, Value::Row(new))
    }

    pub(super) fn upsert(
        &mut self,
        table: &str,
        key: &Value,
        row: Value,
    ) -> Result<(), RuntimeError> {
        validate_row(self.schema.table(table), table, &row)?;
        validate_addressed_row_id(table, key, &row)?;
        if self.fetch_id(table, key.as_str()?)?.is_some() {
            self.replace(table, key, row)
        } else {
            self.insert(table, row)
        }
    }

    pub(super) fn replace(
        &mut self,
        table: &str,
        key: &Value,
        new: Value,
    ) -> Result<(), RuntimeError> {
        let key_id = key.as_str()?;
        let row_id = new.field("id")?.as_str()?;
        if key_id != row_id {
            return Err(RuntimeError::Input(format!(
                "{table} replacement key {key_id} does not match row id {row_id}"
            )));
        }
        let old = self
            .fetch_id(table, key_id)?
            .ok_or_else(|| RuntimeError::Input(format!("missing {table} row")))?;
        validate_row(self.schema.table(table), table, &new)?;
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
        self.touch_row(table, &old)?;
        self.tx.execute(
            "UPDATE rows SET data = ?3 WHERE table_name = ?1 AND row_id = ?2",
            params![table, key_id, canonical_json(&new)],
        )?;
        reindex_row(self.tx, self.schema, table, &new)?;
        self.refresh_created_points(table, &new)?;
        self.clear_rule_memos();
        self.touch_row(table, &new)?;
        self.bump_write(table);
        self.maintain(table, Some(&old), Some(&new))?;
        Ok(())
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
        self.touch_row(table, &old)?;
        self.tx.execute(
            "DELETE FROM rows WHERE table_name = ?1 AND row_id = ?2",
            params![table, id],
        )?;
        delete_index_row(self.tx, table, id)?;
        self.forget_created_points(table, id);
        self.clear_rule_memos();
        self.bump_write(table);
        self.maintain(table, Some(&old), None)?;
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
            if let Some(old) = old {
                self.apply_aggregate(&maintain, old, -1)?;
            }
            if let Some(new) = new {
                self.apply_aggregate(&maintain, new, 1)?;
            }
        }
        Ok(())
    }

    pub(super) fn apply_aggregate(
        &mut self,
        maintain: &Maintain,
        source: &Value,
        direction: i64,
    ) -> Result<(), RuntimeError> {
        let table = self
            .schema
            .table(&maintain.source)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {}", maintain.source)))?;
        let mut source = source.clone();
        materialize_optional_fields(&mut source, table);
        let group: Vec<_> = maintain
            .by
            .iter()
            .map(|field| source.field(field).cloned())
            .collect::<Result<_, _>>()?;
        let id = canonical_json(&group);
        let delta = match &maintain.kind {
            MaintainKind::Count => direction,
            MaintainKind::Sum { of } => direction
                .checked_mul(source.field(of)?.as_int()?)
                .ok_or_else(|| {
                    RuntimeError::Constraint("aggregate multiplication overflow".to_owned())
                })?,
        };
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
        let next = old_value as i128 + delta as i128;
        if !(I53_MIN as i128..=I53_MAX as i128).contains(&next) {
            return Err(ValueError::Overflow(next).into());
        }
        let mut row = BTreeMap::from([
            ("id".to_owned(), Value::Id(id.clone())),
            ("value".to_owned(), Value::Int(next as i64)),
        ]);
        for (field, value) in maintain.by.iter().zip(group) {
            row.insert(field.clone(), value);
        }
        self.write_aggregate_row(&maintain.target, Value::Row(row))
    }

    pub(super) fn write_aggregate_row(
        &mut self,
        target: &str,
        row: Value,
    ) -> Result<(), RuntimeError> {
        let id = row.field("id")?.as_str()?.to_owned();
        let existing = self.fetch_id(target, &id)?;
        validate_row(self.schema.table(target), target, &row)?;
        let effect = if existing.is_some() {
            Effect::Update
        } else {
            Effect::Insert
        };
        // LLP 1001 §7 ruling: maintained targets are engine-owned, so aggregate
        // writes bypass user insert/update/delete rules but never constraints or unique indexes.
        self.check_constraints(target, existing.as_ref(), &row, effect)?;
        if let Some(existing) = &existing {
            self.touch_row(target, existing)?;
        }
        self.tx.execute(
            "INSERT INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)
             ON CONFLICT(table_name, row_id) DO UPDATE SET data = excluded.data",
            params![target, id, canonical_json(&row)],
        )?;
        let aggregate = self
            .fetch_id(target, &id)?
            .expect("aggregate row was just upserted");
        reindex_row(self.tx, self.schema, target, &aggregate)?;
        if effect == Effect::Insert {
            self.remember_created_row(target, &aggregate)?;
            self.inserted_rows
                .push((target.to_owned(), aggregate.clone()));
        } else {
            self.refresh_created_points(target, &aggregate)?;
        }
        self.clear_rule_memos();
        self.touch_row(target, &aggregate)?;
        self.bump_write(target);
        Ok(())
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
            // Maintained targets are engine-owned, but their declared
            // constraints still bind successor rebuild deletions.
            self.check_constraints(target, Some(&row), &row, Effect::Delete)?;
            self.touch_row(target, &row)?;
            self.tx.execute(
                "DELETE FROM rows WHERE table_name = ?1 AND row_id = ?2",
                params![target, id],
            )?;
            delete_index_row(self.tx, target, &id)?;
            self.forget_created_points(target, &id);
            self.clear_rule_memos();
            self.bump_write(target);
        }
        Ok(())
    }

    pub(super) fn emit(&mut self, effect: &str, payload: Value) -> Result<(), RuntimeError> {
        let id = self
            .context
            .new_ids
            .pop_front()
            .ok_or_else(|| RuntimeError::Input("newId envelope exhausted".to_owned()))?;
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
                Constraint::Unique { index } if effect != Effect::Delete => {
                    self.check_unique(table_name, &table, index, old, new)?
                }
                Constraint::Cap { by, max } => {
                    let prefix = by
                        .iter()
                        .map(|field| new.field(field).cloned())
                        .collect::<Result<Vec<_>, _>>()?;
                    let increases_group = match effect {
                        Effect::Insert => true,
                        Effect::Update => {
                            let old = old.expect("update has preimage");
                            let old_prefix = by
                                .iter()
                                .map(|field| old.field(field).cloned())
                                .collect::<Result<Vec<_>, _>>()?;
                            old_prefix != prefix
                        }
                        Effect::Read | Effect::Delete => false,
                    };
                    if !increases_group {
                        continue;
                    }
                    let (index_name, index) = table
                        .indexes
                        .iter()
                        .find(|(_, index)| index.columns.starts_with(by))
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
                    self.trace.constraint_inputs.push(ConstraintTrace {
                        table: table_name.to_owned(),
                        check: format!("Cap({by:?},{max})"),
                        index: index_name.clone(),
                        prefix,
                        examined_ids: row_ids(&rows)?,
                    });
                    if rows.len() >= *max as usize {
                        return Err(RuntimeError::Constraint(format!(
                            "{table_name} cap {max} reached"
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
                        let valid = match format {
                            None => true,
                            Some(TextFormat::Handle) => text.bytes().all(|byte| {
                                byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'
                            }),
                            Some(TextFormat::Url) => {
                                let rest = text
                                    .strip_prefix("https://")
                                    .or_else(|| text.strip_prefix("http://"));
                                rest.is_some_and(|rest| {
                                    !rest.is_empty()
                                        && rest.chars().all(|character| {
                                            !character.is_whitespace() && !character.is_control()
                                        })
                                })
                            }
                        };
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
            if index.unique && effect != Effect::Delete {
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

    pub(super) fn check_unique(
        &mut self,
        table_name: &str,
        table: &Table,
        index_name: &str,
        old: Option<&Value>,
        new: &Value,
    ) -> Result<(), RuntimeError> {
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
        let duplicate = examined.into_iter().any(|row| {
            let id = row.field("id").ok().and_then(|id| id.as_str().ok());
            id != old_id
        });
        if duplicate {
            return Err(RuntimeError::Constraint(format!(
                "sealed unique conflict on {table_name}.{index_name}"
            )));
        }
        Ok(())
    }

    pub(super) fn check_rule(
        &mut self,
        table: &str,
        effect: Effect,
        old: Option<&Value>,
        next: &Value,
    ) -> Result<bool, RuntimeError> {
        // @ref LLP 1016#d1--the-system-principal-is-the-stores-owner — the owner skips all viewer rules, never write validation or trace accounting.
        if self.context.viewer.is_system() {
            return Ok(true);
        }
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
        let rule_hash = self.schema.rule_hash(&rule);
        let authority_miss_serial = self.authority_miss_serial;
        let allowed = self.eval_rule(
            &rule,
            &rule_hash,
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
        let hash = self.schema.rule_hash(&read);
        self.eval_visibility_rule(&read, &hash, found)?;
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
        let mut found = lookup_indexed(self.tx, table, index, index_schema, key)?;
        if let Some(row) = &mut found {
            materialize_optional_fields(row, table_schema);
        }
        Ok(found)
    }

    pub(super) fn fetch_id(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        let data: Option<String> = self
            .tx
            .query_row(
                "SELECT data FROM rows WHERE table_name = ?1 AND row_id = ?2",
                params![table, id],
                |row| row.get(0),
            )
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
        let record = RowRecord {
            table: table.to_owned(),
            id: id.to_owned(),
            row: row.clone(),
        };
        if !self
            .trace
            .rows
            .iter()
            .any(|existing| existing.table == table && existing.id == id)
        {
            self.trace.rows.push(record.clone());
        }
        if client
            && !self
                .receipt
                .rows
                .iter()
                .any(|existing| existing.table == table && existing.id == id)
        {
            self.receipt.rows.push(record);
        }
    }

    pub(super) fn bump_write(&mut self, table: &str) {
        *self.trace.writes.entry(table.to_owned()).or_default() += 1;
    }

    pub(super) fn step(&mut self, amount: u64) -> Result<(), RuntimeError> {
        self.trace.steps = self.trace.steps.saturating_add(amount);
        let max_steps = self
            .certificate
            .map(|certificate| certificate.max_steps)
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

    pub(super) fn assert_rule_bounds(&self) -> Result<(), RuntimeError> {
        let certificate = self
            .rule_certificate
            .expect("certified rule execution has a certificate");
        if self.trace.rule_probes > certificate.max_rule_probes {
            return Err(RuntimeError::TraceSubset(format!(
                "rule probes {} > certificate {}",
                self.trace.rule_probes, certificate.max_rule_probes
            )));
        }
        if self.trace.steps > certificate.max_steps {
            return Err(RuntimeError::TraceSubset(format!(
                "steps {} > certificate {}",
                self.trace.steps, certificate.max_steps
            )));
        }
        Ok(())
    }

    pub(super) fn assert_bounds(&self) -> Result<(), RuntimeError> {
        let certificate = self
            .certificate
            .expect("ordinary program execution has a certificate");
        if self.trace.examined > certificate.max_examined {
            return Err(RuntimeError::TraceSubset(format!(
                "examined {} > certificate {}",
                self.trace.examined, certificate.max_examined
            )));
        }
        if self.trace.rule_probes > certificate.max_rule_probes {
            return Err(RuntimeError::TraceSubset(format!(
                "rule probes {} > certificate {}",
                self.trace.rule_probes, certificate.max_rule_probes
            )));
        }
        let mut calls = BTreeMap::<&str, u64>::new();
        for point in &self.trace.points {
            let site = self
                .certificate
                .expect("checked above")
                .read_sites
                .iter()
                .find(|site| site.site == point.site)
                .ok_or_else(|| {
                    RuntimeError::TraceSubset(format!("undeclared point site {}", point.site))
                })?;
            if site.table != point.table || site.index != point.index || site.take != 1 {
                return Err(RuntimeError::TraceSubset(format!(
                    "point site {} does not match its certificate",
                    point.site
                )));
            }
            *calls.entry(&point.site).or_default() += 1;
        }
        for range in &self.trace.ranges {
            let site = self
                .certificate
                .expect("checked above")
                .read_sites
                .iter()
                .find(|site| site.site == range.site)
                .ok_or_else(|| {
                    RuntimeError::TraceSubset(format!("undeclared read site {}", range.site))
                })?;
            if site.table != range.table || site.index != range.index {
                return Err(RuntimeError::TraceSubset(format!(
                    "range site {} does not match its certificate",
                    range.site
                )));
            }
            *calls.entry(&range.site).or_default() += 1;
            let maximum = certificate.max_examined;
            if range.examined_ids.len() as u64 > maximum {
                return Err(RuntimeError::TraceSubset(format!(
                    "site {} examined {} > certificate {}",
                    range.site,
                    range.examined_ids.len(),
                    maximum
                )));
            }
        }
        for (site, actual) in calls {
            let maximum = self
                .certificate
                .expect("checked above")
                .read_sites
                .iter()
                .find(|read| read.site == site)
                .expect("checked above")
                .max_calls;
            if actual > maximum {
                return Err(RuntimeError::TraceSubset(format!(
                    "site {site} calls {actual} > {maximum}"
                )));
            }
        }
        // @ref LLP 1001#2-what-a-commit-records — direct and maintained
        // physical writes are contained per target table, including both
        // old/new aggregate applications for update and upsert.
        let mut declared_by_table = BTreeMap::<&str, u64>::new();
        let mut derived_maintained_writes = BTreeMap::<String, u64>::new();
        let mut derived_maintained_amplification = 0_u64;
        for site in &certificate.write_sites {
            let direct = declared_by_table.entry(site.table.as_str()).or_default();
            *direct = direct.saturating_add(site.max_rows);
            for maintain in self
                .schema
                .maintains
                .iter()
                .filter(|maintain| maintain.source == site.table)
            {
                let applications = site
                    .max_rows
                    .saturating_mul(site.kind.maintained_applications());
                let target = declared_by_table
                    .entry(maintain.target.as_str())
                    .or_default();
                *target = target.saturating_add(applications);
                let certified_target = derived_maintained_writes
                    .entry(maintain.target.clone())
                    .or_default();
                *certified_target = certified_target.saturating_add(applications);
                derived_maintained_amplification =
                    derived_maintained_amplification.saturating_add(applications);
            }
        }
        if certificate.maintained_writes != derived_maintained_writes {
            return Err(RuntimeError::TraceSubset(format!(
                "maintained writes {:?} != derived {:?}",
                certificate.maintained_writes, derived_maintained_writes
            )));
        }
        if certificate.maintained_amplification != derived_maintained_amplification {
            return Err(RuntimeError::TraceSubset(format!(
                "maintained amplification {} != derived {}",
                certificate.maintained_amplification, derived_maintained_amplification
            )));
        }
        for (table, writes) in &self.trace.writes {
            let declared = declared_by_table.get(table.as_str()).copied().unwrap_or(0);
            if *writes > declared {
                return Err(RuntimeError::TraceSubset(format!(
                    "writes to {table} {writes} > {declared}"
                )));
            }
        }
        for row in &self.receipt.rows {
            if !self
                .trace
                .rows
                .iter()
                .any(|trace| trace.table == row.table && trace.id == row.id)
            {
                return Err(RuntimeError::TraceSubset(format!(
                    "receipt row {}.{} absent from trace",
                    row.table, row.id
                )));
            }
        }
        for range in &self.receipt.ranges {
            if !self
                .trace
                .ranges
                .iter()
                .any(|trace| trace.site == range.site)
            {
                return Err(RuntimeError::TraceSubset(format!(
                    "receipt range {} absent from trace",
                    range.site
                )));
            }
        }
        // @ref LLP 1001#2-what-a-commit-records — receipt absences stay inside the server trace.
        // issues/20260829-bounded-programs-receipt-absences-unvalidated.md
        for absence in &self.receipt.absences {
            if !self.trace.absences.contains(absence) {
                return Err(RuntimeError::TraceSubset(format!(
                    "receipt absence {absence:?} absent from trace"
                )));
            }
        }
        for verdict in &self.receipt.verdicts {
            if !self
                .certificate
                .expect("checked above")
                .rule_hashes
                .values()
                .any(|hash| hash == &verdict.rule_hash)
            {
                return Err(RuntimeError::TraceSubset(
                    "receipt verdict rule hash absent from certificate".to_owned(),
                ));
            }
            if !self.trace.rule_inputs.iter().any(|input| {
                input.rule_hash == verdict.rule_hash
                    && input.pinned_inputs_digest == verdict.pinned_inputs_digest
                    && input.hidden
            }) {
                return Err(RuntimeError::TraceSubset(
                    "receipt verdict absent from authoritative hidden input".to_owned(),
                ));
            }
        }
        for constraint in &self.trace.constraint_inputs {
            if !certificate.constraint_checks.iter().any(|declared| {
                declared.starts_with(&format!("{}:", constraint.table))
                    && declared.contains(&constraint.check)
            }) {
                return Err(RuntimeError::TraceSubset(format!(
                    "constraint trace {}:{} absent from certificate",
                    constraint.table, constraint.check
                )));
            }
        }
        Ok(())
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
