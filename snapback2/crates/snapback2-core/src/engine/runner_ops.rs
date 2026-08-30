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
        if !self.check_rule(table, Effect::Insert, &row)? {
            return Err(RuntimeError::Rule {
                table: table.to_owned(),
                effect: Effect::Insert,
            });
        }
        self.check_constraints(table, None, &row, Effect::Insert)?;
        let id = row.field("id")?.as_str()?.to_owned();
        self.tx.execute(
            "INSERT INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)",
            params![table, id, canonical_json(&row)],
        )?;
        reindex_row(self.tx, self.schema, table, &row)?;
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
        let old = self.fetch_id(table, key.as_str()?)?.ok_or_else(|| {
            RuntimeError::Input(format!(
                "missing {table} row {}",
                key.as_str().unwrap_or("?")
            ))
        })?;
        let mut new = old.as_object()?.clone();
        for (name, value) in patch.as_object()? {
            new.insert(name.clone(), value.clone());
        }
        self.replace(table, key, Value::Row(new))
    }

    pub(super) fn replace(
        &mut self,
        table: &str,
        key: &Value,
        new: Value,
    ) -> Result<(), RuntimeError> {
        let old = self
            .fetch_id(table, key.as_str()?)?
            .ok_or_else(|| RuntimeError::Input(format!("missing {table} row")))?;
        validate_row(self.schema.table(table), table, &new)?;
        if !self.check_rule(table, Effect::Update, &old)?
            || !self.check_rule(table, Effect::Update, &new)?
        {
            return Err(RuntimeError::Rule {
                table: table.to_owned(),
                effect: Effect::Update,
            });
        }
        self.check_constraints(table, Some(&old), &new, Effect::Update)?;
        self.touch_row(table, &old)?;
        self.tx.execute(
            "UPDATE rows SET data = ?3 WHERE table_name = ?1 AND row_id = ?2",
            params![table, key.as_str()?, canonical_json(&new)],
        )?;
        reindex_row(self.tx, self.schema, table, &new)?;
        self.touch_row(table, &new)?;
        self.bump_write(table);
        self.maintain(table, Some(&old), Some(&new))?;
        Ok(())
    }

    pub(super) fn delete(&mut self, table: &str, id: &str) -> Result<(), RuntimeError> {
        let Some(old) = self.fetch_id(table, id)? else {
            return Ok(());
        };
        if !self.check_rule(table, Effect::Delete, &old)? {
            return Err(RuntimeError::Rule {
                table: table.to_owned(),
                effect: Effect::Delete,
            });
        }
        self.check_constraints(table, Some(&old), &old, Effect::Delete)?;
        self.touch_row(table, &old)?;
        self.tx.execute(
            "DELETE FROM rows WHERE table_name = ?1 AND row_id = ?2",
            params![table, id],
        )?;
        delete_index_row(self.tx, table, id)?;
        self.bump_write(table);
        self.maintain(table, Some(&old), None)?;
        Ok(())
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
        self.touch_row(target, &aggregate)?;
        self.bump_write(target);
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
                Constraint::Unique { index } => {
                    self.check_unique(table_name, &table, index, old, new)?
                }
                Constraint::Cap { by, max } if effect == Effect::Insert => {
                    let (index_name, index) = table
                        .indexes
                        .iter()
                        .find(|(_, index)| index.columns.starts_with(by))
                        .ok_or_else(|| {
                            RuntimeError::Schema(format!(
                                "cap on {table_name} requires an index beginning with {by:?}"
                            ))
                        })?;
                    let prefix = by
                        .iter()
                        .map(|field| new.field(field).cloned())
                        .collect::<Result<Vec<_>, _>>()?;
                    let rows = scan_indexed(
                        self.tx,
                        table_name,
                        index_name,
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
                        examined_ids: row_ids(&rows)?,
                    });
                    if rows.len() >= *max as usize {
                        return Err(RuntimeError::Constraint(format!(
                            "{table_name} cap {max} reached"
                        )));
                    }
                }
                _ => {}
            }
        }
        for (name, index) in &table.indexes {
            if index.unique {
                self.check_unique(table_name, &table, name, old, new)?;
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
        row: &Value,
    ) -> Result<bool, RuntimeError> {
        // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — seed rows
        // are engine-owned; user rules do not bind them, while write validation below does.
        if self.context.seed_write {
            return Ok(true);
        }
        let table = self
            .schema
            .table(table)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?;
        let rule = table.rules.for_effect(effect).clone();
        let mut row = row.clone();
        materialize_optional_fields(&mut row, table);
        let rule_hash = self.schema.rule_hash(&rule);
        self.eval_rule(&rule, &rule_hash, &row)
    }

    pub(super) fn eval_rule(
        &mut self,
        rule: &RuleExpr,
        rule_hash: &str,
        row: &Value,
    ) -> Result<bool, RuntimeError> {
        match rule {
            RuleExpr::Public { .. } | RuleExpr::Allow => Ok(true),
            RuleExpr::Deny => Ok(false),
            RuleExpr::Eq(left, right) => {
                Ok(self.rule_term(left, row)? == self.rule_term(right, row)?)
            }
            RuleExpr::Ne(left, right) => {
                Ok(self.rule_term(left, row)? != self.rule_term(right, row)?)
            }
            RuleExpr::And(rules) => {
                for rule in rules {
                    if !self.eval_rule(rule, rule_hash, row)? {
                        return Ok(false);
                    }
                }
                Ok(true)
            }
            RuleExpr::Or(rules) => {
                for rule in rules {
                    if self.eval_rule(rule, rule_hash, row)? {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            RuleExpr::Not(rule) => Ok(!self.eval_rule(rule, rule_hash, row)?),
            RuleExpr::Exists {
                table, index, key, ..
            } => {
                let key = key
                    .iter()
                    .map(|term| self.rule_term(term, row))
                    .collect::<Result<Vec<_>, _>>()?;
                let pinned_inputs_digest = digest(&(table, index, &key));
                let memo_key = format!("{rule_hash}:{pinned_inputs_digest}");
                if let Some(result) = self.rule_memo.get(&memo_key) {
                    return Ok(*result);
                }
                if let Some(verdict) = self.verdicts.iter().find(|verdict| {
                    verdict.rule_hash == rule_hash
                        && verdict.pinned_inputs_digest == pinned_inputs_digest
                        && verdict.principal == self.context.viewer
                        && verdict.auth_epoch == self.context.auth_epoch
                }) {
                    self.rule_memo.insert(memo_key, verdict.result);
                    return Ok(verdict.result);
                }
                let found = self.lookup_raw(table, index, &key)?;
                let result = found.is_some();
                let hidden = self.rule_input_hidden(table, found.as_ref())?;
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
                        principal: self.context.viewer.clone(),
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
                self.rule_memo.insert(memo_key, result);
                Ok(result)
            }
        }
    }

    // @ref LLP 0331#failure-and-disclosure-semantics — whether a relationship
    // probe is client-readable follows the referenced table's read rule for
    // this viewer; authors cannot label the probe readable or hidden.
    fn rule_input_hidden(
        &mut self,
        table: &str,
        found: Option<&Value>,
    ) -> Result<bool, RuntimeError> {
        let read = self
            .schema
            .table(table)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?
            .rules
            .read
            .clone();
        let Some(found) = found else {
            return Ok(!matches!(read, RuleExpr::Public { .. } | RuleExpr::Allow));
        };
        let hash = self.schema.rule_hash(&read);
        Ok(!self.eval_visibility_rule(&read, &hash, found)?)
    }

    fn eval_visibility_rule(
        &mut self,
        rule: &RuleExpr,
        rule_hash: &str,
        row: &Value,
    ) -> Result<bool, RuntimeError> {
        match rule {
            RuleExpr::Public { .. } | RuleExpr::Allow => Ok(true),
            RuleExpr::Deny => Ok(false),
            RuleExpr::Eq(left, right) => {
                Ok(self.rule_term(left, row)? == self.rule_term(right, row)?)
            }
            RuleExpr::Ne(left, right) => {
                Ok(self.rule_term(left, row)? != self.rule_term(right, row)?)
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
                    .map(|term| self.rule_term(term, row))
                    .collect::<Result<Vec<_>, _>>()?;
                let pinned_inputs_digest = digest(&(table, index, &key));
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
                self.visibility_memo.insert(memo_key, result);
                Ok(result)
            }
        }
    }

    pub(super) fn rule_term(&self, term: &RuleTerm, row: &Value) -> Result<Value, RuntimeError> {
        match term {
            RuleTerm::Field(name) => Ok(row.field(name)?.clone()),
            RuleTerm::Viewer => Ok(Value::Id(self.context.viewer.clone())),
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
        if let Some(certificate) = self.certificate
            && self.trace.steps > certificate.max_steps
        {
            return Err(RuntimeError::Steps(certificate.max_steps));
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
            *calls.entry(&range.site).or_default() += 1;
            if range.examined_ids.len() as u64 > site.take + 2 {
                return Err(RuntimeError::TraceSubset(format!(
                    "site {} examined {} > take+2 {}",
                    range.site,
                    range.examined_ids.len(),
                    site.take + 2
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
        for (table, writes) in &self.trace.writes {
            let declared: u64 = self
                .certificate
                .expect("checked above")
                .write_sites
                .iter()
                .filter(|site| &site.table == table)
                .map(|site| site.max_rows)
                .sum::<u64>()
                + certificate.maintained_amplification;
            if *writes > declared
                && !self
                    .schema
                    .maintains
                    .iter()
                    .any(|maintain| &maintain.target == table)
            {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::certificate::{Ceilings, Checker};

    #[test]
    fn receipt_absence_missing_from_trace_is_rejected() {
        let mut connection = Connection::open_in_memory().unwrap();
        let transaction = connection.transaction().unwrap();
        let schema = Schema::default();
        let program = Program {
            name: "absence-bound".to_owned(),
            kind: ProgramKind::Query,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Return(Expr::Literal(Value::Null))],
        };
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&program)
            .unwrap();
        let verdicts = Vec::new();
        let mut runner = Runner::new(
            &transaction,
            &schema,
            &certificate,
            Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
            &verdicts,
            0,
        );
        runner.receipt.absences.push((
            "items".to_owned(),
            "byId".to_owned(),
            vec![Value::Id("missing".to_owned())],
        ));

        let error = runner.assert_bounds().unwrap_err();
        assert!(error.to_string().starts_with("E_TRACE_SUBSET:"));
        assert!(
            matches!(error, RuntimeError::TraceSubset(message) if message.contains("receipt absence"))
        );
    }
}
