#![allow(unused_imports)]
//! Runner, part 1: statements, expressions, builtins, reads, ranges.
use super::*;
use crate::certificate::{Certificate, RuleCertificate};
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
    Return(Value, ResultProvenance),
}

pub(super) struct TrackedValue {
    pub(super) value: Value,
    pub(super) provenance: ResultProvenance,
}

#[path = "connected.rs"]
mod connected;

#[derive(Clone, Copy)]
pub(super) struct CandidateCheckpoint {
    rows: usize,
    ranges: usize,
    absences: usize,
    verdicts: usize,
    rule_memos: usize,
    visibility_memos: usize,
    rule_inputs: usize,
}

impl TrackedValue {
    fn plain(value: Value) -> Self {
        Self {
            value,
            provenance: ResultProvenance::None,
        }
    }
}

pub(super) struct Runner<'a> {
    pub(super) tx: &'a Transaction<'a>,
    pub(super) schema: &'a Schema,
    pub(super) hashes: &'a hashes::PolicyHashes,
    pub(super) row_membership: row_membership::RowMembership,
    pub(super) certificate: Option<&'a Certificate>,
    pub(super) rule_certificate: Option<&'a RuleCertificate>,
    pub(super) context: Context,
    pub(super) env: BTreeMap<String, Value>,
    pub(super) env_provenance: BTreeMap<String, ResultProvenance>,
    pub(super) consts: BTreeSet<String>,
    pub(super) trace: AuthoritativeTrace,
    pub(super) receipt: ClosureReceipt,
    pub(super) rule_memo: BTreeMap<String, bool>,
    pub(super) rule_memo_entries: Vec<String>,
    /// Row identities inserted by this runner. This is transaction-local
    /// provenance, not durable authority and not reconstructed from storage.
    pub(super) created_rows: BTreeSet<(String, String)>,
    /// Current indexed points for those created row identities. Keeping this
    /// separately makes a non-unique target key true when *any* matching row
    /// was created, without scanning pre-existing rows.
    pub(super) created_points: BTreeSet<(String, String, String, String)>,
    /// Source rows whose insert-scoped final constraints must hold after the
    /// complete statement body and immediately before commit.
    pub(super) inserted_rows: Vec<(String, Value)>,
    pub(super) visibility_memo: BTreeMap<String, bool>,
    pub(super) visibility_memo_entries: Vec<String>,
    pub(super) verdicts: &'a [Verdict],
    pub(super) authority_absences: &'a [(String, String, Vec<Value>)],
    pub(super) rule_authority: RuleAuthority,
    pub(super) missing_authority: bool,
    pub(super) authority_miss_serial: u64,
    pub(super) seq: u64,
    /// Index ranges of `trace.rule_inputs` minted while a rule check ran on a
    /// candidate row that turned out hidden. They stay in the authoritative
    /// trace (metering, invalidation) but never reach a client-facing compare.
    pub(super) discarded_rule_inputs: Vec<std::ops::Range<usize>>,
}

impl<'a> Runner<'a> {
    pub(super) fn new(
        tx: &'a Transaction<'a>,
        schema: &'a Schema,
        hashes: &'a hashes::PolicyHashes,
        certificate: &'a Certificate,
        context: Context,
        verdicts: &'a [Verdict],
        authority_absences: &'a [(String, String, Vec<Value>)],
        rule_authority: RuleAuthority,
        seq: u64,
    ) -> Self {
        let env = context.args.clone();
        Self {
            tx,
            schema,
            hashes,
            row_membership: Default::default(),
            certificate: Some(certificate),
            rule_certificate: None,
            context,
            env,
            env_provenance: BTreeMap::new(),
            consts: BTreeSet::new(),
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt {
                schema_hash: Some(hashes.schema.clone()),
                ..ClosureReceipt::default()
            },
            rule_memo: BTreeMap::new(),
            rule_memo_entries: Vec::new(),
            created_rows: BTreeSet::new(),
            created_points: BTreeSet::new(),
            inserted_rows: Vec::new(),
            visibility_memo: BTreeMap::new(),
            visibility_memo_entries: Vec::new(),
            verdicts,
            authority_absences,
            rule_authority,
            missing_authority: false,
            authority_miss_serial: 0,
            seq,
            discarded_rule_inputs: Vec::new(),
        }
    }

    pub(super) fn probe(
        tx: &'a Transaction<'a>,
        schema: &'a Schema,
        hashes: &'a hashes::PolicyHashes,
        context: Context,
        verdicts: &'a [Verdict],
        authority_absences: &'a [(String, String, Vec<Value>)],
        rule_authority: RuleAuthority,
        seq: u64,
        rule_certificate: Option<&'a RuleCertificate>,
    ) -> Self {
        let env = context.args.clone();
        Self {
            tx,
            schema,
            hashes,
            row_membership: Default::default(),
            certificate: None,
            rule_certificate,
            context,
            env,
            env_provenance: BTreeMap::new(),
            consts: BTreeSet::new(),
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt {
                schema_hash: Some(hashes.schema.clone()),
                ..ClosureReceipt::default()
            },
            rule_memo: BTreeMap::new(),
            rule_memo_entries: Vec::new(),
            created_rows: BTreeSet::new(),
            created_points: BTreeSet::new(),
            inserted_rows: Vec::new(),
            visibility_memo: BTreeMap::new(),
            visibility_memo_entries: Vec::new(),
            verdicts,
            authority_absences,
            rule_authority,
            missing_authority: false,
            authority_miss_serial: 0,
            seq,
            discarded_rule_inputs: Vec::new(),
        }
    }

    pub(super) fn statements(&mut self, statements: &[Stmt]) -> Result<Flow, RuntimeError> {
        self.statements_at(statements, "")
    }

    fn statements_at(&mut self, statements: &[Stmt], prefix: &str) -> Result<Flow, RuntimeError> {
        for (index, statement) in statements.iter().enumerate() {
            let path = format!("{prefix}{index}");
            // @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — preserve the attempted write site even when validation refuses before a row is touched.
            if self.context.operator_by.is_some() {
                use crate::certificate::WriteKind;
                let site = match statement {
                    Stmt::Insert { table, .. } => Some((table.as_str(), WriteKind::Insert)),
                    Stmt::Update { table, .. } => Some((table.as_str(), WriteKind::Update)),
                    Stmt::Upsert { table, .. } => Some((table.as_str(), WriteKind::Upsert)),
                    Stmt::Delete { table, .. } => Some((table.as_str(), WriteKind::Delete)),
                    Stmt::Emit { .. } => Some(("_outbox", WriteKind::Emit)),
                    _ => None,
                };
                if let Some((table, kind)) = site {
                    // Certificates aggregate by table and kind, including loop bounds.
                    self.trace.last_write_attempt = Some(
                        self.certificate
                            .and_then(|certificate| {
                                certificate
                                    .write_sites
                                    .iter()
                                    .find(|site| site.table == table && site.kind == kind)
                            })
                            .ok_or_else(|| {
                                RuntimeError::TraceSubset(format!(
                                    "undeclared write site {table}.{kind:?}"
                                ))
                            })?
                            .clone(),
                    );
                }
            }
            self.step(1)?;
            let flow = match statement {
                Stmt::Const { name, value } => {
                    let tracked = self.expr_tracked(value)?;
                    self.env.insert(name.clone(), tracked.value);
                    self.env_provenance.insert(name.clone(), tracked.provenance);
                    self.consts.insert(name.clone());
                    Flow::Next
                }
                Stmt::Let { name, value } => {
                    let tracked = self.expr_tracked(value)?;
                    self.env.insert(name.clone(), tracked.value);
                    self.env_provenance.insert(name.clone(), tracked.provenance);
                    Flow::Next
                }
                Stmt::Assign { name, value } => {
                    if self.consts.contains(name) {
                        return Err(RuntimeError::Input(format!(
                            "cannot assign to const binding {name}"
                        )));
                    }
                    let tracked = self.expr_tracked(value)?;
                    self.env.insert(name.clone(), tracked.value);
                    self.env_provenance.insert(name.clone(), tracked.provenance);
                    Flow::Next
                }
                Stmt::Push { target, value } => {
                    let tracked = self.expr_tracked(value)?;
                    let target_value = self
                        .env
                        .get_mut(target)
                        .ok_or_else(|| RuntimeError::Input(format!("unknown variable {target}")))?;
                    match target_value {
                        Value::Array(values) => {
                            let prior_len = values.len();
                            values.push(tracked.value);
                            let provenance = self
                                .env_provenance
                                .entry(target.clone())
                                .or_insert_with(|| {
                                    ResultProvenance::Array(vec![ResultProvenance::None; prior_len])
                                });
                            match provenance {
                                ResultProvenance::Array(values) => values.push(tracked.provenance),
                                other => {
                                    *other = ResultProvenance::Array(
                                        std::iter::repeat_n(ResultProvenance::None, prior_len)
                                            .chain([tracked.provenance])
                                            .collect(),
                                    );
                                }
                            }
                        }
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
                    let (branch, arm) = if self.expr(condition)?.as_bool()? {
                        (then_body, "then")
                    } else {
                        (else_body, "else")
                    };
                    self.statements_at(branch, &format!("{path}/{arm}/"))?
                }
                Stmt::For {
                    binding,
                    domain,
                    body,
                } => {
                    let values = self.domain(domain)?;
                    let mut result = Flow::Next;
                    for tracked in values {
                        self.env.insert(binding.clone(), tracked.value);
                        self.env_provenance
                            .insert(binding.clone(), tracked.provenance);
                        match self.statements_at(body, &format!("{path}/body/"))? {
                            Flow::Next | Flow::Continue => {}
                            Flow::Break => break,
                            returned @ Flow::Return(..) => {
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
                    self.upsert(table, &key, row)?;
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
                Stmt::Return(value) => {
                    let tracked = self.expr_tracked(value)?;
                    self.trace.result_page_return = Some(path);
                    Flow::Return(tracked.value, tracked.provenance)
                }
                Stmt::Break => Flow::Break,
                Stmt::Continue => Flow::Continue,
            };
            if !matches!(flow, Flow::Next) {
                return Ok(flow);
            }
        }
        Ok(Flow::Next)
    }

    fn domain(&mut self, domain: &LoopDomain) -> Result<Vec<TrackedValue>, RuntimeError> {
        match domain {
            LoopDomain::Page(scan) => self.scan_tracked(scan),
            LoopDomain::LiteralRange {
                start,
                end_exclusive,
            } => (*start..*end_exclusive)
                .map(|value| Value::int(value as i128))
                .collect::<Result<Vec<_>, _>>()
                .map(|values| values.into_iter().map(TrackedValue::plain).collect())
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
                Ok(values.into_iter().map(TrackedValue::plain).collect())
            }
            LoopDomain::DerivedArray { value, max, .. } => {
                let tracked = self.expr_tracked(value)?;
                let values = tracked.value.as_array()?.to_vec();
                if values.len() > *max as usize {
                    return Err(RuntimeError::Fanout);
                }
                let provenance = match tracked.provenance {
                    ResultProvenance::Array(provenance) if provenance.len() == values.len() => {
                        provenance
                    }
                    _ => vec![ResultProvenance::None; values.len()],
                };
                Ok(values
                    .into_iter()
                    .zip(provenance)
                    .map(|(value, provenance)| TrackedValue { value, provenance })
                    .collect())
            }
            LoopDomain::Recurse(recurse) => self.recurse(recurse),
        }
    }

    fn recurse(&mut self, recurse: &Recurse) -> Result<Vec<TrackedValue>, RuntimeError> {
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
            let row = self.get_tracked(&read)?;
            if row.value == Value::Null {
                continue;
            }
            let next = row.value.field(&recurse.next_field)?.clone();
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
        self.expr_tracked(expression).map(|tracked| tracked.value)
    }

    fn expr_tracked(&mut self, expression: &Expr) -> Result<TrackedValue, RuntimeError> {
        self.step(1)?;
        match expression {
            Expr::Literal(value) => Ok(TrackedValue::plain(value.clone())),
            Expr::Variable(name) => self
                .env
                .get(name)
                .cloned()
                .map(|value| TrackedValue {
                    value,
                    provenance: self.env_provenance.get(name).cloned().unwrap_or_default(),
                })
                .ok_or_else(|| RuntimeError::Input(format!("unknown variable {name}"))),
            Expr::Input(input) => self.input(*input).map(TrackedValue::plain),
            Expr::Field { base, name } => {
                let tracked = self.expr_tracked(base)?;
                let value = tracked.value.field(name)?.clone();
                let provenance = match tracked.provenance {
                    ResultProvenance::Object(mut values) => values.remove(name).unwrap_or_default(),
                    _ => ResultProvenance::None,
                };
                Ok(TrackedValue { value, provenance })
            }
            Expr::Array(values) => {
                let tracked = values
                    .iter()
                    .map(|value| self.expr_tracked(value))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(TrackedValue {
                    value: Value::Array(tracked.iter().map(|item| item.value.clone()).collect()),
                    provenance: ResultProvenance::Array(
                        tracked.into_iter().map(|item| item.provenance).collect(),
                    ),
                })
            }
            Expr::Object(values) => {
                let tracked = values
                    .iter()
                    .map(|(key, value)| Ok((key.clone(), self.expr_tracked(value)?)))
                    .collect::<Result<BTreeMap<_, _>, RuntimeError>>()?;
                Ok(TrackedValue {
                    value: Value::Row(
                        tracked
                            .iter()
                            .map(|(key, item)| (key.clone(), item.value.clone()))
                            .collect(),
                    ),
                    provenance: ResultProvenance::Object(
                        tracked
                            .into_iter()
                            .map(|(key, item)| (key, item.provenance))
                            .collect(),
                    ),
                })
            }
            Expr::Binary { op, left, right } => {
                let left = self.expr(left)?;
                if *op == BinaryOp::And && !left.as_bool()? {
                    return Ok(TrackedValue::plain(Value::Bool(false)));
                }
                if *op == BinaryOp::Or && left.as_bool()? {
                    return Ok(TrackedValue::plain(Value::Bool(true)));
                }
                let right = self.expr(right)?;
                self.binary(*op, left, right).map(TrackedValue::plain)
            }
            Expr::Unary { op, value } => {
                let value = self.expr(value)?;
                match op {
                    UnaryOp::Not => Ok(TrackedValue::plain(Value::Bool(!value.as_bool()?))),
                    UnaryOp::Neg => Value::int(-(value.as_int()? as i128))
                        .map(TrackedValue::plain)
                        .map_err(Into::into),
                }
            }
            Expr::Builtin { builtin, args } => {
                if args.len() != builtin.arity() {
                    return Err(RuntimeError::Input(format!(
                        "builtin {builtin:?} requires {} arguments, received {}",
                        builtin.arity(),
                        args.len()
                    )));
                }
                let args = args
                    .iter()
                    .map(|value| self.expr_tracked(value))
                    .collect::<Result<Vec<_>, _>>()?;
                self.builtin_tracked(builtin, args)
            }
            Expr::Get(read) => self.get_tracked(read),
            Expr::Exists(read) => Ok(TrackedValue::plain(Value::Bool(
                self.get_tracked(read)?.value != Value::Null,
            ))),
            Expr::Scan(_) | Expr::Merge(_) => {
                let values = match expression {
                    Expr::Scan(scan) => self.scan_tracked(scan)?,
                    Expr::Merge(merge) => self.merge_tracked(merge)?,
                    _ => unreachable!(),
                };
                Ok(TrackedValue {
                    value: Value::Array(values.iter().map(|item| item.value.clone()).collect()),
                    provenance: ResultProvenance::Array(
                        values.into_iter().map(|item| item.provenance).collect(),
                    ),
                })
            }
        }
    }

    fn builtin_tracked(
        &mut self,
        builtin: &Builtin,
        mut args: Vec<TrackedValue>,
    ) -> Result<TrackedValue, RuntimeError> {
        match builtin {
            Builtin::Slice => {
                let source = args.remove(0);
                let start = args.remove(0).value.as_int()?.max(0) as usize;
                let end = args.remove(0).value.as_int()?.max(0) as usize;
                let length = end.saturating_sub(start);
                match source.value {
                    Value::Array(values) => {
                        let provenance = aligned_provenance(source.provenance, values.len());
                        Ok(TrackedValue {
                            value: Value::Array(
                                values.into_iter().skip(start).take(length).collect(),
                            ),
                            provenance: ResultProvenance::Array(
                                provenance.into_iter().skip(start).take(length).collect(),
                            ),
                        })
                    }
                    Value::String(value) => Ok(TrackedValue::plain(Value::String(
                        value.chars().skip(start).take(length).collect(),
                    ))),
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
                match (left.value, right.value) {
                    (left @ Value::String(_), right) | (left, right @ Value::String(_)) => {
                        Ok(TrackedValue::plain(Value::String(format!(
                            "{}{}",
                            concat_text(&left),
                            concat_text(&right)
                        ))))
                    }
                    (Value::Id(left), Value::Id(right)) => {
                        Ok(TrackedValue::plain(Value::Id(canonical_json(&[
                            Value::Id(left),
                            Value::Id(right),
                        ]))))
                    }
                    (Value::Array(mut left_values), Value::Array(right_values)) => {
                        let mut provenance = aligned_provenance(left.provenance, left_values.len());
                        provenance.extend(aligned_provenance(right.provenance, right_values.len()));
                        left_values.extend(right_values);
                        Ok(TrackedValue {
                            value: Value::Array(left_values),
                            provenance: ResultProvenance::Array(provenance),
                        })
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
                    left.value.total_cmp(&right.value) != Ordering::Greater
                } else {
                    left.value.total_cmp(&right.value) != Ordering::Less
                };
                Ok(if choose_left { left } else { right })
            }
            Builtin::Sort { keys } => {
                let source = args.remove(0);
                let values = source.value.as_array()?.to_vec();
                let provenance = aligned_provenance(source.provenance, values.len());
                let mut tracked = values.into_iter().zip(provenance).collect::<Vec<_>>();
                for (value, _) in &tracked {
                    for key in keys {
                        value.field(&key.field)?;
                    }
                }
                tracked.sort_by(|(left, _), (right, _)| {
                    keys.iter()
                        .find_map(|key| {
                            let mut order = left
                                .field(&key.field)
                                .expect("sort keys were validated")
                                .total_cmp(
                                    right.field(&key.field).expect("sort keys were validated"),
                                );
                            if key.order == Order::Desc {
                                order = order.reverse();
                            }
                            (order != Ordering::Equal).then_some(order)
                        })
                        .unwrap_or(Ordering::Equal)
                });
                let (values, provenance): (Vec<_>, Vec<_>) = tracked.into_iter().unzip();
                Ok(TrackedValue {
                    value: Value::Array(values),
                    provenance: ResultProvenance::Array(provenance),
                })
            }

            _ => self
                .builtin(
                    builtin,
                    args.into_iter().map(|tracked| tracked.value).collect(),
                )
                .map(TrackedValue::plain),
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
            BinaryOp::SameValueZero => Ok(Value::Bool(same_value_zero(&left, &right)?)),
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
        if args.len() != builtin.arity() {
            return Err(RuntimeError::Input(format!(
                "builtin {builtin:?} requires {} arguments, received {}",
                builtin.arity(),
                args.len()
            )));
        }
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
                    (left @ Value::String(_), right) | (left, right @ Value::String(_)) => Ok(
                        Value::String(format!("{}{}", concat_text(&left), concat_text(&right))),
                    ),
                    (Value::Id(left), Value::Id(right)) => Ok(Value::Id(canonical_json(&[
                        Value::Id(left),
                        Value::Id(right),
                    ]))),
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
                for value in &values {
                    for key in keys {
                        value.field(&key.field)?;
                    }
                }
                values.sort_by(|left, right| {
                    keys.iter()
                        .find_map(|key| {
                            let mut order = left
                                .field(&key.field)
                                .expect("sort keys were validated")
                                .total_cmp(
                                    right.field(&key.field).expect("sort keys were validated"),
                                );
                            if key.order == Order::Desc {
                                order = order.reverse();
                            }
                            (order != Ordering::Equal).then_some(order)
                        })
                        .unwrap_or(Ordering::Equal)
                });
                Ok(Value::Array(values))
            }
            Builtin::Words => {
                let text = args.remove(0).as_str()?.to_owned();
                let mut seen = BTreeSet::new();
                Ok(Value::Array(
                    text.split(|c: char| !c.is_ascii_alphanumeric())
                        .filter(|word| !word.is_empty())
                        .map(str::to_ascii_lowercase)
                        .filter(|word| seen.insert(word.clone()))
                        .map(Value::String)
                        .collect(),
                ))
            }
            Builtin::MentionTokens => {
                let text = args.remove(0).as_str()?.to_owned();
                let mut seen = BTreeSet::new();
                Ok(Value::Array(
                    text.split(is_mention_whitespace)
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
                if recipients.windows(2).any(|pair| pair[0] == pair[1]) {
                    return Err(RuntimeError::Input(
                        "share recipients must be unique".to_owned(),
                    ));
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

    fn get_tracked(&mut self, read: &Read) -> Result<TrackedValue, RuntimeError> {
        let key = read
            .key
            .iter()
            .map(|value| self.expr(value))
            .collect::<Result<Vec<_>, _>>()?;
        if read.table == crate::CONNECTED_TABLE {
            return self.connected_read(read, key);
        }
        let found = self.lookup_raw(&read.table, &read.index, &key)?;
        if let Some(row) = found {
            self.trace.examined += 1;
            let id = row.field("id")?.as_str()?.to_owned();
            let checkpoint = self.candidate_checkpoint();
            let visible = self.check_rule(&read.table, Effect::Read, None, &row)?;
            self.trace.points.push(PointTrace {
                site: read.site.clone(),
                table: read.table.clone(),
                index: read.index.clone(),
                key,
                examined: true,
                visible,
                digest: Some(crate::offline::row_digest(&row)),
            });
            if visible {
                self.record_row(&read.table, &id, &row, true);
                Ok(TrackedValue {
                    value: row,
                    provenance: ResultProvenance::Row {
                        table: read.table.clone(),
                        id,
                    },
                })
            } else {
                // A hidden point candidate is authoritative trace only. Rule
                // evaluation may have learned public rows, absences, ranges,
                // or verdicts; shipping any of them would distinguish the
                // hidden hit from an alternate-key miss.
                self.rollback_candidate(checkpoint);
                Ok(TrackedValue::plain(Value::Null))
            }
        } else {
            let point = PointTrace {
                site: read.site.clone(),
                table: read.table.clone(),
                index: read.index.clone(),
                key: key.clone(),
                examined: false,
                visible: false,
                digest: None,
            };
            // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs —
            // preserve the authored point for OCC; derive only its exact empty
            // unique-group extent, with a separate actual primary-ID probe.
            if matches!(self.rule_authority, RuleAuthority::StoreAuthoritative)
                && let Some(evidence) = crate::cap::count_absence_evidence(
                    self.schema,
                    &point,
                    self.hashes.table(&read.table, Effect::Read),
                )
            {
                self.step(4)?;
                let primary = self.lookup_raw(&read.table, "byId", &evidence.primary.2)?;
                self.trace.examined += u64::from(primary.is_some());
                self.trace.constraint_inputs.push(ConstraintTrace {
                    table: read.table.clone(),
                    check: "public-count-absence".to_owned(),
                    index: "byId".to_owned(),
                    prefix: evidence.primary.2.clone(),
                    examined_ids: primary
                        .as_ref()
                        .map(|_| vec![canonical_json(&key)])
                        .unwrap_or_default(),
                });
                if primary.is_none() {
                    self.trace.absences.push(evidence.primary.clone());
                    self.receipt.absences.push(evidence.primary);
                    self.receipt.ranges.push(evidence.range);
                }
            }
            self.trace.points.push(point);
            let absence = (read.table.clone(), read.index.clone(), key);
            self.trace.absences.push(absence.clone());
            self.receipt.absences.push(absence);
            Ok(TrackedValue::plain(Value::Null))
        }
    }

    pub(super) fn candidate_checkpoint(&self) -> CandidateCheckpoint {
        CandidateCheckpoint {
            rows: self.receipt.rows.len(),
            ranges: self.receipt.ranges.len(),
            absences: self.receipt.absences.len(),
            verdicts: self.receipt.verdicts.len(),
            rule_memos: self.rule_memo_entries.len(),
            visibility_memos: self.visibility_memo_entries.len(),
            rule_inputs: self.trace.rule_inputs.len(),
        }
    }

    pub(super) fn rollback_candidate(&mut self, checkpoint: CandidateCheckpoint) {
        // @ref LLP 1012#7-writes-offline — a hidden candidate's rule inputs
        // are authoritative trace only; the replay compare must not see them,
        // or a planted verdict would tell a hidden row from an absent one.
        if self.trace.rule_inputs.len() > checkpoint.rule_inputs {
            self.discarded_rule_inputs
                .push(checkpoint.rule_inputs..self.trace.rule_inputs.len());
        }
        for row in self.receipt.rows.drain(checkpoint.rows..) {
            self.row_membership.remove_receipt(&self.trace.rows, &row.table, &row.id);
        }
        self.receipt.ranges.truncate(checkpoint.ranges);
        self.receipt.absences.truncate(checkpoint.absences);
        self.receipt.verdicts.truncate(checkpoint.verdicts);
        for key in self.rule_memo_entries.split_off(checkpoint.rule_memos) {
            self.rule_memo.remove(&key);
        }
        for key in self
            .visibility_memo_entries
            .split_off(checkpoint.visibility_memos)
        {
            self.visibility_memo.remove(&key);
        }
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

fn aligned_provenance(provenance: ResultProvenance, length: usize) -> Vec<ResultProvenance> {
    match provenance {
        ResultProvenance::Array(values) if values.len() == length => values,
        _ => vec![ResultProvenance::None; length],
    }
}

fn same_value_zero(left: &Value, right: &Value) -> Result<bool, ValueError> {
    // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — Id/String are one authored JS string domain; composites have no IR identity.
    match (left, right) {
        (Value::Null, Value::Null) => Ok(true),
        (Value::Bool(left), Value::Bool(right)) => Ok(left == right),
        (Value::Int(left), Value::Int(right)) => Ok(left == right),
        (Value::String(left) | Value::Id(left), Value::String(right) | Value::Id(right)) => {
            Ok(left == right)
        }
        (Value::Bytes(_) | Value::Row(_) | Value::Array(_) | Value::Map(_), _) => {
            Err(ValueError::Type {
                expected: "primitive SameValueZero operand",
                actual: left.kind(),
            })
        }
        (_, Value::Bytes(_) | Value::Row(_) | Value::Array(_) | Value::Map(_)) => {
            Err(ValueError::Type {
                expected: "primitive SameValueZero operand",
                actual: right.kind(),
            })
        }
        _ => Ok(false),
    }
}

fn is_mention_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'..='\u{000d}'
            | '\u{0020}'
            | '\u{0085}'
            | '\u{00a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
    )
}

fn concat_text(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(value) => value.to_string(),
        Value::Int(value) => value.to_string(),
        Value::String(value) | Value::Id(value) => value.clone(),
        Value::Bytes(value) => crate::value::encode_bytes_hex(value),
        Value::Array(values) => values.iter().map(concat_text).collect::<Vec<_>>().join(","),
        Value::Row(_) | Value::Map(_) => "[object Object]".to_owned(),
    }
}
