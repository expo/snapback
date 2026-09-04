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

struct TrackedValue {
    value: Value,
    provenance: ResultProvenance,
}

#[derive(Clone, Copy)]
struct CandidateCheckpoint {
    rows: usize,
    ranges: usize,
    absences: usize,
    verdicts: usize,
    rule_memos: usize,
    visibility_memos: usize,
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
}

impl<'a> Runner<'a> {
    pub(super) fn new(
        tx: &'a Transaction<'a>,
        schema: &'a Schema,
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
            certificate: Some(certificate),
            rule_certificate: None,
            context,
            env,
            env_provenance: BTreeMap::new(),
            consts: BTreeSet::new(),
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt {
                schema_hash: Some(schema.hash()),
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
        }
    }

    pub(super) fn probe(
        tx: &'a Transaction<'a>,
        schema: &'a Schema,
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
            certificate: None,
            rule_certificate,
            context,
            env,
            env_provenance: BTreeMap::new(),
            consts: BTreeSet::new(),
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt {
                schema_hash: Some(schema.hash()),
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
        }
    }

    pub(super) fn statements(&mut self, statements: &[Stmt]) -> Result<Flow, RuntimeError> {
        for statement in statements {
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
                    for tracked in values {
                        self.env.insert(binding.clone(), tracked.value);
                        self.env_provenance
                            .insert(binding.clone(), tracked.provenance);
                        match self.statements(body)? {
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
            Expr::Scan(scan) => {
                let values = self.scan_tracked(scan)?;
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
            Builtin::DedupeById { site, .. } => {
                let source = args.remove(0);
                let values = source.value.as_array()?.to_vec();
                let provenance = aligned_provenance(source.provenance, values.len());
                let mut seen = BTreeSet::new();
                let mut deduplicated = Vec::new();
                for (value, provenance) in values.into_iter().zip(provenance) {
                    let id = value.field("id")?.as_str()?.to_owned();
                    if seen.insert(id) {
                        deduplicated.push((value, provenance));
                    }
                }
                let last_returned_suffix = self
                    .certificate
                    .and_then(|certificate| certificate.result_page_site.as_ref())
                    .filter(|page| page.merge && page.site == *site)
                    .and_then(|page| {
                        let take = self
                            .certificate
                            .and_then(|certificate| {
                                certificate
                                    .merge_sites
                                    .iter()
                                    .find(|entry| entry.site == *site)
                            })
                            .map(|entry| entry.take as usize)?;
                        let row = &deduplicated.iter().take(take).last()?.0;
                        page.suffix
                            .iter()
                            .map(|column| row.field(&column.name).cloned().ok())
                            .collect::<Option<Vec<_>>>()
                    });
                self.trace.merges.push(MergeTrace {
                    site: site.clone(),
                    deduplicated_union_len: deduplicated.len() as u64,
                    last_returned_suffix,
                });
                let (values, provenance): (Vec<_>, Vec<_>) = deduplicated.into_iter().unzip();
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
            Builtin::DedupeById { site, .. } => {
                let values = args.remove(0).as_array()?.to_vec();
                let mut seen = BTreeSet::new();
                let mut deduplicated = Vec::new();
                for value in values {
                    let id = value.field("id")?.as_str()?.to_owned();
                    if seen.insert(id) {
                        deduplicated.push(value);
                    }
                }
                let last_returned_suffix = self
                    .certificate
                    .and_then(|certificate| certificate.result_page_site.as_ref())
                    .filter(|page| page.merge && page.site == *site)
                    .and_then(|page| {
                        let take = self
                            .certificate
                            .and_then(|certificate| {
                                certificate
                                    .merge_sites
                                    .iter()
                                    .find(|entry| entry.site == *site)
                            })
                            .map(|entry| entry.take as usize)?;
                        let row = deduplicated.iter().take(take).last()?;
                        page.suffix
                            .iter()
                            .map(|column| row.field(&column.name).cloned().ok())
                            .collect::<Option<Vec<_>>>()
                    });
                self.trace.merges.push(MergeTrace {
                    site: site.clone(),
                    deduplicated_union_len: deduplicated.len() as u64,
                    last_returned_suffix,
                });
                Ok(Value::Array(deduplicated))
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
            self.trace.points.push(PointTrace {
                site: read.site.clone(),
                table: read.table.clone(),
                index: read.index.clone(),
                key: key.clone(),
                examined: false,
                visible: false,
                digest: None,
            });
            let absence = (read.table.clone(), read.index.clone(), key);
            self.trace.absences.push(absence.clone());
            self.receipt.absences.push(absence);
            Ok(TrackedValue::plain(Value::Null))
        }
    }

    fn scan_tracked(&mut self, scan: &Scan) -> Result<Vec<TrackedValue>, RuntimeError> {
        let prefix = scan
            .prefix
            .iter()
            .map(|value| self.expr(value))
            .collect::<Result<Vec<_>, _>>()?;
        let mut after = scan
            .after
            .as_deref()
            .map(|value| self.expr(value))
            .transpose()?;
        if after == Some(Value::Null) && scan.opaque_cursor {
            after = None;
        }
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
        if scan.opaque_cursor {
            let suffix = index.columns[scan.prefix.len()..]
                .iter()
                .map(|name| {
                    table
                        .columns
                        .get(name)
                        .cloned()
                        .map(|kind| crate::cursor::CursorColumn {
                            name: name.clone(),
                            kind,
                        })
                })
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| RuntimeError::Schema("missing cursor index column".to_owned()))?;
            after = match after {
                Some(Value::String(token)) => Some(Value::Array(
                    decode_cursor_for(&token, &scan.table, &scan.index, scan.order, &suffix)
                        .map_err(|error| RuntimeError::Input(error.to_string()))?,
                )),
                None => None,
                Some(_) => {
                    return Err(RuntimeError::Input(
                        "opaque cursor value must be a string or null".to_owned(),
                    ));
                }
            };
        }
        let read_site = self
            .certificate
            .expect("ordinary scans have a certificate")
            .read_sites
            .iter()
            .find(|site| site.site == scan.site)
            .cloned()
            .ok_or_else(|| {
                RuntimeError::TraceSubset(format!("undeclared read site {}", scan.site))
            })?;
        let uniform = read_site.hoist;
        let always_visible = matches!(table.rules.read, RuleExpr::Public { .. } | RuleExpr::Allow);
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
        let certificate = self.certificate.expect("ordinary scans have a certificate");
        let remaining_examined = certificate.max_examined.saturating_sub(self.trace.examined);
        let remaining_rule_probes = certificate
            .max_rule_probes
            .saturating_sub(self.trace.rule_probes);
        let candidate_limit = if always_visible || read_site.rule_probes_per_candidate == 0 {
            remaining_examined
        } else if uniform {
            if remaining_rule_probes < read_site.rule_probes_per_candidate {
                0
            } else {
                remaining_examined
            }
        } else {
            remaining_examined
                .min(remaining_rule_probes.saturating_div(read_site.rule_probes_per_candidate))
        };
        let candidate_limit = usize::try_from(candidate_limit).unwrap_or(usize::MAX);
        let fetch_limit = if always_visible {
            candidate_limit.min(take.saturating_add(2))
        } else {
            candidate_limit
        };
        // @ref LLP 1001#3-read-and-write-states-no-silent-states — uniformly false ranges halt after one determination.
        // A hoisted rule has one verdict for the entire prefix. Probe one
        // candidate first so a uniformly false range can terminate without
        // fetching or charging the hidden population row by row.
        let mut uniform_result = None;
        let mut uniform_false_row = None;
        let mut uniform_empty = false;
        if uniform && !always_visible && fetch_limit > 0 {
            let mut probe = scan_indexed(
                self.tx,
                &scan.table,
                &scan.index,
                table,
                index,
                &prefix,
                after.as_ref(),
                before.as_ref(),
                evaluated_range.as_ref(),
                scan.order,
                1,
            )?;
            if let Some(mut row) = probe.pop() {
                materialize_optional_fields(&mut row, table);
                let checkpoint = self.candidate_checkpoint();
                let allowed = self.check_rule(&scan.table, Effect::Read, None, &row)?;
                uniform_result = Some(allowed);
                if !allowed {
                    // The candidate and its rule inputs remain authoritative
                    // trace only; the viewer gets the same absence as empty.
                    self.rollback_candidate(checkpoint);
                    uniform_false_row = Some(row);
                }
            } else {
                uniform_empty = true;
            }
        }
        let mut rows = if uniform_false_row.is_some() || uniform_empty {
            Vec::new()
        } else {
            scan_indexed(
                self.tx,
                &scan.table,
                &scan.index,
                table,
                index,
                &prefix,
                after.as_ref(),
                before.as_ref(),
                evaluated_range.as_ref(),
                scan.order,
                fetch_limit,
            )?
        };
        for row in &mut rows {
            materialize_optional_fields(row, table);
        }
        let fetched = rows.len();
        let uniformly_false = uniform_false_row.is_some();
        let mut examined_rows = uniform_false_row.into_iter().collect::<Vec<_>>();
        let mut visible = Vec::new();
        for row in rows {
            let visible_target = if uniform {
                take.saturating_add(2)
            } else {
                take
            };
            if visible.len() >= visible_target {
                break;
            }
            let checkpoint = self.candidate_checkpoint();
            let allowed = match uniform_result {
                Some(allowed) => allowed,
                None => {
                    let allowed = self.check_rule(&scan.table, Effect::Read, None, &row)?;
                    if uniform {
                        uniform_result = Some(allowed);
                    }
                    allowed
                }
            };
            if !allowed {
                // A rule probe keyed by a hidden candidate is authoritative trace,
                // never a receipt artifact: even a public absence would reveal the row.
                self.rollback_candidate(checkpoint);
            }
            examined_rows.push(row.clone());
            if allowed {
                visible.push(row);
            }
        }
        let source_exhausted = uniformly_false
            || uniform_empty
            || (examined_rows.len() == fetched && fetched < fetch_limit);
        let stop = if (uniform && visible.len() <= take && source_exhausted)
            || (!uniform && visible.len() < take && source_exhausted)
        {
            StopReason::Exhausted
        } else {
            StopReason::Limit
        };
        self.trace.examined += examined_rows.len() as u64;
        let examined_ids = examined_rows
            .iter()
            .map(|row| {
                row.field("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let returned: Vec<_> = visible.iter().take(take).cloned().collect();
        let halo_row = uniform.then(|| visible.get(take).cloned()).flatten();
        let n2_row = uniform.then(|| visible.get(take + 1)).flatten();
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
        let rule_hash = self.schema.rule_hash(&table.rules.read);
        let evaluated_take = u32::try_from(take).map_err(|_| RuntimeError::Fanout)?;
        let range = TraceRange {
            site: scan.site.clone(),
            table: scan.table.clone(),
            index: scan.index.clone(),
            prefix: prefix.clone(),
            order: scan.order,
            take: evaluated_take,
            after: after.clone(),
            before: before.clone(),
            gt: evaluated_range.as_ref().and_then(|range| range.gt.clone()),
            gte: evaluated_range.as_ref().and_then(|range| range.gte.clone()),
            lt: evaluated_range.as_ref().and_then(|range| range.lt.clone()),
            lte: evaluated_range.as_ref().and_then(|range| range.lte.clone()),
            rule_hash: rule_hash.clone(),
            examined_ids,
            visible_ids,
            returned_ids: returned_ids.clone(),
            stop,
            absence: returned.is_empty(),
            halo: halo.clone(),
            n2_key: n2_key.clone(),
        };
        self.trace.ranges.push(range);
        // Only a certified-uniform range can carry an extent. A uniformly false,
        // exhausted range carries the same visible absence as a physically empty one.
        if uniform && (uniform_result != Some(false) || stop == StopReason::Exhausted) {
            self.receipt.ranges.push(ReceiptRange {
                site: scan.site.clone(),
                table: scan.table.clone(),
                index: scan.index.clone(),
                prefix,
                order: scan.order,
                take: evaluated_take,
                after,
                before,
                gt: evaluated_range.as_ref().and_then(|range| range.gt.clone()),
                gte: evaluated_range.as_ref().and_then(|range| range.gte.clone()),
                lt: evaluated_range.as_ref().and_then(|range| range.lt.clone()),
                lte: evaluated_range.and_then(|range| range.lte),
                rule_hash,
                row_ids: returned_ids.clone(),
                stop,
                absence: returned.is_empty(),
                halo,
                n2_key,
            });
        }
        Ok(returned
            .into_iter()
            .zip(returned_ids)
            .map(|(value, id)| TrackedValue {
                value,
                provenance: ResultProvenance::Row {
                    table: scan.table.clone(),
                    id,
                },
            })
            .collect())
    }

    fn candidate_checkpoint(&self) -> CandidateCheckpoint {
        CandidateCheckpoint {
            rows: self.receipt.rows.len(),
            ranges: self.receipt.ranges.len(),
            absences: self.receipt.absences.len(),
            verdicts: self.receipt.verdicts.len(),
            rule_memos: self.rule_memo_entries.len(),
            visibility_memos: self.visibility_memo_entries.len(),
        }
    }

    fn rollback_candidate(&mut self, checkpoint: CandidateCheckpoint) {
        self.receipt.rows.truncate(checkpoint.rows);
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
