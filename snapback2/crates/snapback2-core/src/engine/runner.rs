#![allow(unused_imports)]
//! Runner, part 1: statements, expressions, builtins, reads, ranges.
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

#[derive(Clone, Debug)]
pub(super) enum Flow {
    Next,
    Break,
    Continue,
    Return(Value),
}

pub(super) struct Runner<'a> {
    pub(super) tx: &'a Transaction<'a>,
    pub(super) schema: &'a Schema,
    pub(super) certificate: Option<&'a Certificate>,
    pub(super) context: Context,
    pub(super) env: BTreeMap<String, Value>,
    pub(super) consts: BTreeSet<String>,
    pub(super) trace: AuthoritativeTrace,
    pub(super) receipt: ClosureReceipt,
    pub(super) rule_memo: BTreeMap<String, bool>,
    pub(super) verdicts: &'a [Verdict],
    pub(super) seq: u64,
}

impl<'a> Runner<'a> {
    pub(super) fn new(
        tx: &'a Transaction<'a>,
        schema: &'a Schema,
        certificate: &'a Certificate,
        context: Context,
        verdicts: &'a [Verdict],
        seq: u64,
    ) -> Self {
        let env = context.args.clone();
        Self {
            tx,
            schema,
            certificate: Some(certificate),
            context,
            env,
            consts: BTreeSet::new(),
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt::default(),
            rule_memo: BTreeMap::new(),
            verdicts,
            seq,
        }
    }

    pub(super) fn probe(
        tx: &'a Transaction<'a>,
        schema: &'a Schema,
        context: Context,
        verdicts: &'a [Verdict],
        seq: u64,
    ) -> Self {
        let env = context.args.clone();
        Self {
            tx,
            schema,
            certificate: None,
            context,
            env,
            consts: BTreeSet::new(),
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt::default(),
            rule_memo: BTreeMap::new(),
            verdicts,
            seq,
        }
    }

    pub(super) fn statements(&mut self, statements: &[Stmt]) -> Result<Flow, RuntimeError> {
        for statement in statements {
            self.step(1)?;
            let flow = match statement {
                Stmt::Const { name, value } => {
                    let value = self.expr(value)?;
                    self.env.insert(name.clone(), value);
                    self.consts.insert(name.clone());
                    Flow::Next
                }
                Stmt::Let { name, value } => {
                    let value = self.expr(value)?;
                    self.env.insert(name.clone(), value);
                    Flow::Next
                }
                Stmt::Assign { name, value } => {
                    if self.consts.contains(name) {
                        return Err(RuntimeError::Input(format!(
                            "cannot assign to const binding {name}"
                        )));
                    }
                    let value = self.expr(value)?;
                    self.env.insert(name.clone(), value);
                    Flow::Next
                }
                Stmt::Push { target, value } => {
                    let value = self.expr(value)?;
                    let target = self
                        .env
                        .get_mut(target)
                        .ok_or_else(|| RuntimeError::Input(format!("unknown variable {target}")))?;
                    match target {
                        Value::Array(values) => values.push(value),
                        other => {
                            return Err(ValueError::Type {
                                expected: "array",
                                actual: other.kind(),
                            }
                            .into());
                        }
                    }
                    Flow::Next
                }
                Stmt::If {
                    condition,
                    then_body,
                    else_body,
                } => {
                    let branch = if self.expr(condition)?.as_bool()? {
                        then_body
                    } else {
                        else_body
                    };
                    self.statements(branch)?
                }
                Stmt::For {
                    binding,
                    domain,
                    body,
                } => {
                    let values = self.domain(domain)?;
                    let mut result = Flow::Next;
                    for value in values {
                        self.env.insert(binding.clone(), value);
                        match self.statements(body)? {
                            Flow::Next | Flow::Continue => {}
                            Flow::Break => break,
                            returned @ Flow::Return(_) => {
                                result = returned;
                                break;
                            }
                        }
                    }
                    result
                }
                Stmt::Require { condition, code } => {
                    if !self.expr(condition)?.as_bool()? {
                        return Err(RuntimeError::Require { code: code.clone() });
                    }
                    Flow::Next
                }
                Stmt::Insert { table, row } => {
                    let row = self.expr(row)?;
                    self.insert(table, row)?;
                    Flow::Next
                }
                Stmt::Update { table, key, patch } => {
                    let key = self.expr(key)?;
                    let patch = self.expr(patch)?;
                    self.update(table, &key, patch)?;
                    Flow::Next
                }
                Stmt::Upsert { table, key, row } => {
                    let key = self.expr(key)?;
                    let row = self.expr(row)?;
                    if self.fetch_id(table, key.as_str()?)?.is_some() {
                        self.replace(table, &key, row)?;
                    } else {
                        self.insert(table, row)?;
                    }
                    Flow::Next
                }
                Stmt::Delete { table, key } => {
                    let key = self.expr(key)?;
                    self.delete(table, key.as_str()?)?;
                    Flow::Next
                }
                Stmt::Emit { effect, payload } => {
                    let payload = self.expr(payload)?;
                    self.emit(effect, payload)?;
                    Flow::Next
                }
                Stmt::Return(value) => Flow::Return(self.expr(value)?),
                Stmt::Break => Flow::Break,
                Stmt::Continue => Flow::Continue,
            };
            if !matches!(flow, Flow::Next) {
                return Ok(flow);
            }
        }
        Ok(Flow::Next)
    }

    pub(super) fn domain(&mut self, domain: &LoopDomain) -> Result<Vec<Value>, RuntimeError> {
        match domain {
            LoopDomain::Page(scan) => self
                .scan(scan)?
                .as_array()
                .map(ToOwned::to_owned)
                .map_err(Into::into),
            LoopDomain::LiteralRange {
                start,
                end_exclusive,
            } => (*start..*end_exclusive)
                .map(|value| Value::int(value as i128))
                .collect::<Result<Vec<_>, _>>()
                .map_err(Into::into),
            LoopDomain::ArgList { name, max } => {
                let values = self
                    .env
                    .get(name)
                    .ok_or_else(|| RuntimeError::Input(format!("missing arg {name}")))?
                    .as_array()?
                    .to_vec();
                if values.len() > *max as usize {
                    return Err(RuntimeError::Fanout);
                }
                Ok(values)
            }
            LoopDomain::DerivedArray { value, max, .. } => {
                let values = self.expr(value)?.as_array()?.to_vec();
                if values.len() > *max as usize {
                    return Err(RuntimeError::Fanout);
                }
                Ok(values)
            }
            LoopDomain::Recurse(recurse) => self.recurse(recurse),
        }
    }

    pub(super) fn recurse(&mut self, recurse: &Recurse) -> Result<Vec<Value>, RuntimeError> {
        let seed = self.expr(&recurse.seed)?;
        let mut queue = VecDeque::from([(seed, 0_u32)]);
        let mut visited = BTreeSet::new();
        let mut rows = Vec::new();
        while let Some((key, depth)) = queue.pop_front() {
            if depth > recurse.depth || !visited.insert(canonical_json(&key)) {
                continue;
            }
            let read = Read {
                site: recurse.site.clone(),
                table: recurse.table.clone(),
                index: recurse.index.clone(),
                key: vec![Expr::Literal(key)],
                provenance: recurse.provenance,
            };
            let row = self.get(&read)?;
            if row == Value::Null {
                continue;
            }
            let next = row.field(&recurse.next_field)?.clone();
            rows.push(row);
            match next {
                Value::Null => {}
                Value::Array(values) => {
                    if values.len() > recurse.fanout as usize {
                        return Err(RuntimeError::Fanout);
                    }
                    for value in values {
                        queue.push_back((value, depth + 1));
                    }
                }
                value => queue.push_back((value, depth + 1)),
            }
        }
        Ok(rows)
    }

    pub(super) fn expr(&mut self, expression: &Expr) -> Result<Value, RuntimeError> {
        self.step(1)?;
        match expression {
            Expr::Literal(value) => Ok(value.clone()),
            Expr::Variable(name) => self
                .env
                .get(name)
                .cloned()
                .ok_or_else(|| RuntimeError::Input(format!("unknown variable {name}"))),
            Expr::Input(input) => self.input(*input),
            Expr::Field { base, name } => Ok(self.expr(base)?.field(name)?.clone()),
            Expr::Array(values) => Ok(Value::Array(
                values
                    .iter()
                    .map(|value| self.expr(value))
                    .collect::<Result<Vec<_>, _>>()?,
            )),
            Expr::Object(values) => Ok(Value::Row(
                values
                    .iter()
                    .map(|(key, value)| Ok((key.clone(), self.expr(value)?)))
                    .collect::<Result<_, RuntimeError>>()?,
            )),
            Expr::Binary { op, left, right } => {
                let left = self.expr(left)?;
                if *op == BinaryOp::And && !left.as_bool()? {
                    return Ok(Value::Bool(false));
                }
                if *op == BinaryOp::Or && left.as_bool()? {
                    return Ok(Value::Bool(true));
                }
                let right = self.expr(right)?;
                self.binary(*op, left, right)
            }
            Expr::Unary { op, value } => {
                let value = self.expr(value)?;
                match op {
                    UnaryOp::Not => Ok(Value::Bool(!value.as_bool()?)),
                    UnaryOp::Neg => Value::int(-(value.as_int()? as i128)).map_err(Into::into),
                }
            }
            Expr::Builtin { builtin, args } => {
                let args = args
                    .iter()
                    .map(|value| self.expr(value))
                    .collect::<Result<Vec<_>, _>>()?;
                self.builtin(builtin, args)
            }
            Expr::Get(read) => self.get(read),
            Expr::Exists(read) => Ok(Value::Bool(self.get(read)? != Value::Null)),
            Expr::Scan(scan) => self.scan(scan),
        }
    }

    pub(super) fn input(&mut self, input: Input) -> Result<Value, RuntimeError> {
        match input {
            Input::Viewer => Ok(Value::Id(self.context.viewer.to_string())),
            Input::Now => self
                .context
                .now
                .map(Value::Int)
                .ok_or_else(|| RuntimeError::Input("now was not pinned".to_owned())),
            Input::NewId => self
                .context
                .new_ids
                .pop_front()
                .map(Value::Id)
                .ok_or_else(|| RuntimeError::Input("newId envelope exhausted".to_owned())),
            Input::ReadTime => self
                .context
                .read_time
                .map(Value::Int)
                .ok_or_else(|| RuntimeError::Input("readTime was not pinned".to_owned())),
        }
    }

    pub(super) fn binary(
        &self,
        op: BinaryOp,
        left: Value,
        right: Value,
    ) -> Result<Value, RuntimeError> {
        let ordering = || left.total_cmp(&right);
        match op {
            BinaryOp::Eq => Ok(Value::Bool(left == right)),
            BinaryOp::Ne => Ok(Value::Bool(left != right)),
            BinaryOp::Lt => Ok(Value::Bool(ordering() == Ordering::Less)),
            BinaryOp::Lte => Ok(Value::Bool(ordering() != Ordering::Greater)),
            BinaryOp::Gt => Ok(Value::Bool(ordering() == Ordering::Greater)),
            BinaryOp::Gte => Ok(Value::Bool(ordering() != Ordering::Less)),
            BinaryOp::Add => {
                Value::int(left.as_int()? as i128 + right.as_int()? as i128).map_err(Into::into)
            }
            BinaryOp::Sub => {
                Value::int(left.as_int()? as i128 - right.as_int()? as i128).map_err(Into::into)
            }
            BinaryOp::Mul => {
                Value::int(left.as_int()? as i128 * right.as_int()? as i128).map_err(Into::into)
            }
            BinaryOp::And => Ok(Value::Bool(left.as_bool()? && right.as_bool()?)),
            BinaryOp::Or => Ok(Value::Bool(left.as_bool()? || right.as_bool()?)),
        }
    }

    pub(super) fn builtin(
        &mut self,
        builtin: &Builtin,
        mut args: Vec<Value>,
    ) -> Result<Value, RuntimeError> {
        match builtin {
            Builtin::Len => {
                let value = args
                    .first()
                    .ok_or_else(|| RuntimeError::Input("len arg".to_owned()))?;
                let len = match value {
                    Value::String(text) | Value::Id(text) => text.chars().count(),
                    Value::Array(values) => values.len(),
                    Value::Row(values) | Value::Map(values) => values.len(),
                    other => {
                        return Err(ValueError::Type {
                            expected: "string, array, or map",
                            actual: other.kind(),
                        }
                        .into());
                    }
                };
                Value::int(len as i128).map_err(Into::into)
            }
            Builtin::Slice => {
                let value = args.remove(0);
                let start = args.remove(0).as_int()?.max(0) as usize;
                let end = args.remove(0).as_int()?.max(0) as usize;
                match value {
                    Value::Array(values) => Ok(Value::Array(
                        values
                            .into_iter()
                            .skip(start)
                            .take(end.saturating_sub(start))
                            .collect(),
                    )),
                    Value::String(value) => Ok(Value::String(
                        value
                            .chars()
                            .skip(start)
                            .take(end.saturating_sub(start))
                            .collect(),
                    )),
                    other => Err(ValueError::Type {
                        expected: "array or string",
                        actual: other.kind(),
                    }
                    .into()),
                }
            }
            Builtin::Concat => {
                let left = args.remove(0);
                let right = args.remove(0);
                match (left, right) {
                    (Value::String(mut left), Value::String(right)) => {
                        left.push_str(&right);
                        Ok(Value::String(left))
                    }
                    (Value::Id(left), Value::Id(right)) => Ok(Value::Id(format!("{left}:{right}"))),
                    (Value::Array(mut left), Value::Array(right)) => {
                        left.extend(right);
                        Ok(Value::Array(left))
                    }
                    (left, _) => Err(ValueError::Type {
                        expected: "matching strings or arrays",
                        actual: left.kind(),
                    }
                    .into()),
                }
            }
            Builtin::Min | Builtin::Max => {
                let left = args.remove(0);
                let right = args.remove(0);
                let choose_left = if matches!(builtin, Builtin::Min) {
                    left.total_cmp(&right) != Ordering::Greater
                } else {
                    left.total_cmp(&right) != Ordering::Less
                };
                Ok(if choose_left { left } else { right })
            }
            Builtin::Divmod { remainder_sink } => {
                let numerator = args.remove(0).as_int()?;
                let denominator = args.remove(0).as_int()?;
                if denominator == 0 {
                    return Err(ValueError::DivideByZero.into());
                }
                Ok(object([
                    ("quotient", Value::Int(numerator.div_euclid(denominator))),
                    ("remainder", Value::Int(numerator.rem_euclid(denominator))),
                    ("sink", Value::String(remainder_sink.clone())),
                ]))
            }
            Builtin::Sort { keys } => {
                let mut values = args.remove(0).as_array()?.to_vec();
                values.sort_by(|left, right| {
                    keys.iter()
                        .find_map(|key| {
                            let mut order = left
                                .field(&key.field)
                                .ok()?
                                .total_cmp(right.field(&key.field).ok()?);
                            if key.order == Order::Desc {
                                order = order.reverse();
                            }
                            (order != Ordering::Equal).then_some(order)
                        })
                        .unwrap_or(Ordering::Equal)
                });
                Ok(Value::Array(values))
            }
            Builtin::MentionTokens => {
                let text = args.remove(0).as_str()?.to_owned();
                let mut seen = BTreeSet::new();
                Ok(Value::Array(
                    text.split_whitespace()
                        .filter_map(|word| word.strip_prefix('@'))
                        .map(|word| word.trim_matches(|c: char| !c.is_alphanumeric() && c != '_'))
                        .filter(|word| !word.is_empty())
                        .filter(|word| seen.insert((*word).to_owned()))
                        .map(|word| Value::String(word.to_owned()))
                        .collect(),
                ))
            }
            Builtin::DeterministicShare => {
                let amount = args.remove(0).as_int()?;
                let mut recipients = args.remove(0).as_array()?.to_vec();
                let recipient = args.remove(0);
                recipients.sort_by(Value::total_cmp);
                if recipients.is_empty() {
                    return Err(ValueError::DivideByZero.into());
                }
                let position = recipients
                    .iter()
                    .position(|value| value == &recipient)
                    .ok_or_else(|| {
                        RuntimeError::Input("recipient missing from shares".to_owned())
                    })?;
                let count = recipients.len() as i64;
                let base = amount.div_euclid(count);
                let remainder = amount.rem_euclid(count) as usize;
                Value::int(base as i128 + i128::from(position < remainder)).map_err(Into::into)
            }
            Builtin::Count | Builtin::CountCapped => {
                let len = args.remove(0).as_array()?.len();
                Value::int(len as i128).map_err(Into::into)
            }
            Builtin::Sum => {
                let sum = args
                    .remove(0)
                    .as_array()?
                    .iter()
                    .try_fold(0_i128, |sum, value| {
                        value.as_int().map(|value| sum + value as i128)
                    })?;
                Value::int(sum).map_err(Into::into)
            }
        }
    }

    pub(super) fn get(&mut self, read: &Read) -> Result<Value, RuntimeError> {
        let key = read
            .key
            .iter()
            .map(|value| self.expr(value))
            .collect::<Result<Vec<_>, _>>()?;
        let found = self.lookup_raw(&read.table, &read.index, &key)?;
        if let Some(row) = found {
            self.trace.examined += 1;
            let id = row.field("id")?.as_str()?.to_owned();
            let visible = self.check_rule(&read.table, Effect::Read, &row)?;
            self.trace.points.push(PointTrace {
                site: read.site.clone(),
                table: read.table.clone(),
                index: read.index.clone(),
                key,
                examined: true,
                visible,
            });
            if visible {
                self.record_row(&read.table, &id, &row, true);
                Ok(row)
            } else {
                Ok(Value::Null)
            }
        } else {
            self.trace.points.push(PointTrace {
                site: read.site.clone(),
                table: read.table.clone(),
                index: read.index.clone(),
                key: key.clone(),
                examined: false,
                visible: false,
            });
            let absence = (read.table.clone(), read.index.clone(), key);
            self.trace.absences.push(absence.clone());
            self.receipt.absences.push(absence);
            Ok(Value::Null)
        }
    }

    pub(super) fn scan(&mut self, scan: &Scan) -> Result<Value, RuntimeError> {
        let prefix = scan
            .prefix
            .iter()
            .map(|value| self.expr(value))
            .collect::<Result<Vec<_>, _>>()?;
        let after = scan
            .after
            .as_deref()
            .map(|value| self.expr(value))
            .transpose()?;
        let before = scan
            .before
            .as_deref()
            .map(|value| self.expr(value))
            .transpose()?;
        let evaluated_range = scan
            .range
            .as_ref()
            .map(|range| self.eval_range(range))
            .transpose()?;
        let table = self
            .schema
            .table(&scan.table)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {}", scan.table)))?;
        let index = table.index(&scan.index).ok_or_else(|| {
            RuntimeError::Schema(format!("missing index {}.{}", scan.table, scan.index))
        })?;
        let take = match &scan.take {
            Bound::Literal(value) => *value as usize,
            Bound::Arg { name, max } => {
                let value = self
                    .context
                    .args
                    .get(name)
                    .ok_or_else(|| RuntimeError::Input(format!("missing take arg {name}")))?
                    .as_int()?;
                if value < 0 || value > *max as i64 {
                    return Err(RuntimeError::Fanout);
                }
                value as usize
            }
        };
        let mut rows = scan_indexed(
            self.tx,
            &scan.table,
            &scan.index,
            index,
            &prefix,
            after.as_ref(),
            before.as_ref(),
            evaluated_range.as_ref(),
            scan.order,
            take.saturating_add(2),
        )?;
        for row in &mut rows {
            materialize_optional_fields(row, table);
        }
        let stop = if rows.len() > take {
            StopReason::Limit
        } else {
            StopReason::Exhausted
        };
        let examined_rows = rows;
        self.trace.examined += examined_rows.len() as u64;
        let examined_ids = examined_rows
            .iter()
            .map(|row| {
                row.field("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut visible = Vec::new();
        for row in &examined_rows {
            if self.check_rule(&scan.table, Effect::Read, row)? {
                visible.push(row.clone());
            }
        }
        let returned: Vec<_> = visible.iter().take(take).cloned().collect();
        let halo_row = visible.get(take).cloned();
        let n2_row = visible.get(take + 1);
        let n2_key = n2_row.map(|row| index_values(row, index));
        let visible_ids = visible
            .iter()
            .map(|row| {
                row.field("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let returned_ids = returned
            .iter()
            .map(|row| {
                row.field("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect::<Result<Vec<_>, _>>()?;
        for row in returned.iter().chain(halo_row.iter()) {
            let id = row.field("id")?.as_str()?.to_owned();
            self.record_row(&scan.table, &id, row, true);
        }
        let halo = halo_row.map(|row| RowRecord {
            table: scan.table.clone(),
            id: row
                .field("id")
                .and_then(Value::as_str)
                .expect("validated row id")
                .to_owned(),
            row,
        });
        let range = TraceRange {
            site: scan.site.clone(),
            table: scan.table.clone(),
            index: scan.index.clone(),
            prefix: prefix.clone(),
            examined_ids,
            visible_ids,
            returned_ids: returned_ids.clone(),
            stop,
            absence: returned.is_empty(),
            halo: halo.clone(),
            n2_key: n2_key.clone(),
        };
        self.trace.ranges.push(range);
        // A closure extent is safe only when every examined index entry was
        // readable. If a rule hid even one candidate, rows remain deliverable
        // but stop/absence/halo facts would disclose hidden cardinality.
        if visible.len() == examined_rows.len() {
            self.receipt.ranges.push(ReceiptRange {
                site: scan.site.clone(),
                table: scan.table.clone(),
                index: scan.index.clone(),
                prefix,
                row_ids: returned_ids,
                stop,
                absence: returned.is_empty(),
                halo,
                n2_key,
            });
        }
        Ok(Value::Array(returned))
    }

    pub(super) fn eval_range(&mut self, range: &Range) -> Result<EvaluatedRange, RuntimeError> {
        Ok(EvaluatedRange {
            gt: range
                .gt
                .as_deref()
                .map(|value| self.expr(value))
                .transpose()?,
            gte: range
                .gte
                .as_deref()
                .map(|value| self.expr(value))
                .transpose()?,
            lt: range
                .lt
                .as_deref()
                .map(|value| self.expr(value))
                .transpose()?,
            lte: range
                .lte
                .as_deref()
                .map(|value| self.expr(value))
                .transpose()?,
        })
    }
}
