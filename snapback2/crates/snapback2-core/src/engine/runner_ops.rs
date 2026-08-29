#![allow(unused_imports)]
//! Runner, part 2: writes, maintenance, constraints, rules, bookkeeping.
use super::*;
use crate::certificate::Certificate;
use crate::ir::*;
use crate::schema::*;
use crate::value::{canonical_json, digest, object, Value, ValueError, I53_MAX, I53_MIN};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Transaction};
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
        self.bump_write(table);
        self.maintain(table, None, Some(&row))?;
        Ok(())
    }

    pub(super) fn update(&mut self, table: &str, key: &Value, patch: Value) -> Result<(), RuntimeError> {
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

    pub(super) fn replace(&mut self, table: &str, key: &Value, new: Value) -> Result<(), RuntimeError> {
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
        self.tx.execute(
            "UPDATE rows SET data = ?3 WHERE table_name = ?1 AND row_id = ?2",
            params![table, key.as_str()?, canonical_json(&new)],
        )?;
        reindex_row(self.tx, self.schema, table, &new)?;
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
        validate_row(
            self.schema.table(&maintain.target),
            &maintain.target,
            &Value::Row(row.clone()),
        )?;
        let effect = if existing.is_some() {
            Effect::Update
        } else {
            Effect::Insert
        };
        if !self.check_rule(&maintain.target, effect, &Value::Row(row.clone()))? {
            return Err(RuntimeError::Rule {
                table: maintain.target.clone(),
                effect,
            });
        }
        self.check_constraints(
            &maintain.target,
            existing.as_ref(),
            &Value::Row(row.clone()),
            effect,
        )?;
        self.tx.execute(
            "INSERT INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)
             ON CONFLICT(table_name, row_id) DO UPDATE SET data = excluded.data",
            params![maintain.target, id, canonical_json(&Value::Row(row))],
        )?;
        let aggregate = self
            .fetch_id(&maintain.target, &id)?
            .expect("aggregate row was just upserted");
        reindex_row(self.tx, self.schema, &maintain.target, &aggregate)?;
        self.bump_write(&maintain.target);
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
                    )))
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
        let rule = self
            .schema
            .table(table)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?
            .rules
            .for_effect(effect)
            .clone();
        let rule_hash = rule.hash();
        self.eval_rule(&rule, &rule_hash, row)
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
            RuleExpr::PrincipalKind(kind) => Ok(&self.context.principal_kind == kind),
            RuleExpr::Exists {
                table,
                index,
                key,
                input_visibility,
                ..
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
                let hidden = *input_visibility == RuleInputVisibility::Hidden;
                if hidden {
                    if let Some(verdict) = self.verdicts.iter().find(|verdict| {
                        verdict.rule_hash == rule_hash
                            && verdict.pinned_inputs_digest == pinned_inputs_digest
                            && verdict.principal == self.context.viewer
                            && verdict.auth_epoch == self.context.auth_epoch
                    }) {
                        self.rule_memo.insert(memo_key, verdict.result);
                        return Ok(verdict.result);
                    }
                }
                let found = self.lookup_raw(table, index, &key)?;
                let result = found.is_some();
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
        lookup_indexed(self.tx, table, index, index_schema, key)
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
        data.map(|data| {
            serde_json::from_str(&data).map_err(|error| RuntimeError::Schema(error.to_string()))
        })
        .transpose()
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
        if self.trace.steps > self.certificate.max_steps {
            return Err(RuntimeError::Steps(self.certificate.max_steps));
        }
        Ok(())
    }

    pub(super) fn assert_bounds(&self) -> Result<(), RuntimeError> {
        if self.trace.examined > self.certificate.max_examined {
            return Err(RuntimeError::TraceSubset(format!(
                "examined {} > certificate {}",
                self.trace.examined, self.certificate.max_examined
            )));
        }
        if self.trace.rule_probes > self.certificate.max_rule_probes {
            return Err(RuntimeError::TraceSubset(format!(
                "rule probes {} > certificate {}",
                self.trace.rule_probes, self.certificate.max_rule_probes
            )));
        }
        let mut calls = BTreeMap::<&str, u64>::new();
        for point in &self.trace.points {
            let site = self
                .certificate
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
                .write_sites
                .iter()
                .filter(|site| &site.table == table)
                .map(|site| site.max_rows)
                .sum::<u64>()
                + self.certificate.maintained_amplification;
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
        for verdict in &self.receipt.verdicts {
            if !self
                .certificate
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
            if !self.certificate.constraint_checks.iter().any(|declared| {
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
