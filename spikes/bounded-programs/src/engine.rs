use crate::certificate::Certificate;
use crate::ir::*;
use crate::schema::*;
use crate::value::{canonical_json, digest, object, Value, ValueError, I53_MAX, I53_MIN};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Context {
    pub viewer: String,
    pub principal_kind: String,
    pub auth_epoch: u64,
    pub args: BTreeMap<String, Value>,
    pub now: Option<i64>,
    pub new_ids: VecDeque<String>,
    pub read_time: Option<i64>,
}

impl Context {
    pub fn query(viewer: impl Into<String>, args: BTreeMap<String, Value>) -> Self {
        Self {
            viewer: viewer.into(),
            principal_kind: "user".to_owned(),
            auth_epoch: 1,
            args,
            now: None,
            new_ids: VecDeque::new(),
            read_time: None,
        }
    }

    pub fn mutation(viewer: impl Into<String>, args: BTreeMap<String, Value>) -> Self {
        let mut context = Self::query(viewer, args);
        context.now = Some(0);
        context
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RowRecord {
    pub table: String,
    pub id: String,
    pub row: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum StopReason {
    Limit,
    Exhausted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraceRange {
    pub site: String,
    pub table: String,
    pub index: String,
    pub prefix: Vec<Value>,
    pub examined_ids: Vec<String>,
    pub visible_ids: Vec<String>,
    pub stop: StopReason,
    pub absence: bool,
    pub halo: Option<RowRecord>,
    pub n2_key: Option<Vec<Value>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleInputTrace {
    pub rule_hash: String,
    pub table: String,
    pub index: String,
    pub key: Vec<Value>,
    pub result: bool,
    pub hidden: bool,
    pub pinned_inputs_digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PointTrace {
    pub site: String,
    pub table: String,
    pub index: String,
    pub key: Vec<Value>,
    pub examined: bool,
    pub visible: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConstraintTrace {
    pub table: String,
    pub check: String,
    pub examined_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthoritativeTrace {
    pub rows: Vec<RowRecord>,
    pub points: Vec<PointTrace>,
    pub constraint_inputs: Vec<ConstraintTrace>,
    pub ranges: Vec<TraceRange>,
    pub absences: Vec<(String, String, Vec<Value>)>,
    pub rule_inputs: Vec<RuleInputTrace>,
    pub examined: u64,
    pub rule_probes: u64,
    pub steps: u64,
    pub writes: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiptRange {
    pub site: String,
    pub table: String,
    pub index: String,
    pub prefix: Vec<Value>,
    pub row_ids: Vec<String>,
    pub stop: StopReason,
    pub absence: bool,
    pub halo: Option<RowRecord>,
    pub n2_key: Option<Vec<Value>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Verdict {
    pub rule_hash: String,
    pub pinned_inputs_digest: String,
    pub principal: String,
    pub auth_epoch: u64,
    pub result: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClosureReceipt {
    pub rows: Vec<RowRecord>,
    pub ranges: Vec<ReceiptRange>,
    pub absences: Vec<(String, String, Vec<Value>)>,
    pub verdicts: Vec<Verdict>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Execution {
    pub result: Value,
    pub trace: AuthoritativeTrace,
    pub receipt: ClosureReceipt,
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Value(#[from] ValueError),
    #[error("E_SCHEMA: {0}")]
    Schema(String),
    #[error("E_REQUIRE:{code}: program requirement failed")]
    Require { code: String },
    #[error("E_RULE: {effect:?} denied on {table}")]
    Rule { table: String, effect: Effect },
    #[error("E_CONSTRAINT: {0}")]
    Constraint(String),
    #[error("E_FANOUT: runtime loop exceeded its admitted bound")]
    Fanout,
    #[error("E_STEPS: runtime steps exceeded certificate {0}")]
    Steps(u64),
    #[error("E_INPUT: {0}")]
    Input(String),
    #[error("E_TRACE_SUBSET: {0}")]
    TraceSubset(String),
}

pub struct Engine {
    connection: Connection,
    schema: Schema,
    verdicts: Vec<Verdict>,
}

impl Engine {
    pub fn memory(schema: Schema) -> Result<Self, RuntimeError> {
        let connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "CREATE TABLE rows (
                table_name TEXT NOT NULL,
                row_id TEXT NOT NULL,
                data TEXT NOT NULL,
                PRIMARY KEY (table_name, row_id)
             );
             CREATE TABLE index_entries (
                table_name TEXT NOT NULL,
                index_name TEXT NOT NULL,
                row_id TEXT NOT NULL,
                c0 TEXT, c1 TEXT, c2 TEXT, c3 TEXT,
                c4 TEXT, c5 TEXT, c6 TEXT, c7 TEXT,
                PRIMARY KEY (table_name, index_name, row_id)
             );
             CREATE INDEX index_entries_lookup ON index_entries(
                table_name, index_name, c0, c1, c2, c3, c4, c5, c6, c7, row_id
             );",
        )?;
        Ok(Self {
            connection,
            schema,
            verdicts: Vec::new(),
        })
    }

    pub(crate) fn install_verdicts(&mut self, verdicts: &[Verdict]) {
        self.verdicts = verdicts.to_vec();
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    pub fn seed(&mut self, table: &str, row: Value) -> Result<(), RuntimeError> {
        validate_row(self.schema.table(table), table, &row)?;
        let id = row.field("id")?.as_str()?.to_owned();
        self.connection.execute(
            "INSERT OR REPLACE INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)",
            params![table, id, canonical_json(&row)],
        )?;
        reindex_row(&self.connection, &self.schema, table, &row)?;
        Ok(())
    }

    pub fn rows(&self, table: &str) -> Result<Vec<Value>, RuntimeError> {
        fetch_table_connection(&self.connection, table)
    }

    pub fn execute(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
    ) -> Result<Execution, RuntimeError> {
        if certificate.plan_hash != digest(program) {
            return Err(RuntimeError::TraceSubset("plan hash mismatch".to_owned()));
        }
        if certificate.schema_hash != self.schema.hash() {
            return Err(RuntimeError::TraceSubset("schema hash mismatch".to_owned()));
        }
        let transaction = self.connection.transaction()?;
        let mut runner = Runner::new(
            &transaction,
            &self.schema,
            certificate,
            context,
            &self.verdicts,
        );
        let flow = runner.statements(&program.body)?;
        let result = match flow {
            Flow::Return(value) => value,
            _ => Value::Null,
        };
        runner.assert_bounds()?;
        let execution = Execution {
            result,
            trace: runner.trace,
            receipt: runner.receipt,
        };
        transaction.commit()?;
        Ok(execution)
    }
}

#[derive(Clone, Debug)]
enum Flow {
    Next,
    Break,
    Continue,
    Return(Value),
}

struct Runner<'a> {
    tx: &'a Transaction<'a>,
    schema: &'a Schema,
    certificate: &'a Certificate,
    context: Context,
    env: BTreeMap<String, Value>,
    consts: BTreeSet<String>,
    trace: AuthoritativeTrace,
    receipt: ClosureReceipt,
    rule_memo: BTreeMap<String, bool>,
    verdicts: &'a [Verdict],
}

impl<'a> Runner<'a> {
    fn new(
        tx: &'a Transaction<'a>,
        schema: &'a Schema,
        certificate: &'a Certificate,
        context: Context,
        verdicts: &'a [Verdict],
    ) -> Self {
        let env = context.args.clone();
        Self {
            tx,
            schema,
            certificate,
            context,
            env,
            consts: BTreeSet::new(),
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt::default(),
            rule_memo: BTreeMap::new(),
            verdicts,
        }
    }

    fn statements(&mut self, statements: &[Stmt]) -> Result<Flow, RuntimeError> {
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
                            .into())
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

    fn domain(&mut self, domain: &LoopDomain) -> Result<Vec<Value>, RuntimeError> {
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

    fn recurse(&mut self, recurse: &Recurse) -> Result<Vec<Value>, RuntimeError> {
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

    fn expr(&mut self, expression: &Expr) -> Result<Value, RuntimeError> {
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

    fn input(&mut self, input: Input) -> Result<Value, RuntimeError> {
        match input {
            Input::Viewer => Ok(Value::Id(self.context.viewer.clone())),
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

    fn binary(&self, op: BinaryOp, left: Value, right: Value) -> Result<Value, RuntimeError> {
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

    fn builtin(&mut self, builtin: &Builtin, mut args: Vec<Value>) -> Result<Value, RuntimeError> {
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
                        .into())
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

    fn get(&mut self, read: &Read) -> Result<Value, RuntimeError> {
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

    fn scan(&mut self, scan: &Scan) -> Result<Value, RuntimeError> {
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
        let rows = scan_indexed(
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
        let visible_ids = returned
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
            visible_ids: visible_ids.clone(),
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
                row_ids: visible_ids,
                stop,
                absence: returned.is_empty(),
                halo,
                n2_key,
            });
        }
        Ok(Value::Array(returned))
    }

    fn eval_range(&mut self, range: &Range) -> Result<EvaluatedRange, RuntimeError> {
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

    fn insert(&mut self, table: &str, row: Value) -> Result<(), RuntimeError> {
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

    fn update(&mut self, table: &str, key: &Value, patch: Value) -> Result<(), RuntimeError> {
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

    fn replace(&mut self, table: &str, key: &Value, new: Value) -> Result<(), RuntimeError> {
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

    fn delete(&mut self, table: &str, id: &str) -> Result<(), RuntimeError> {
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

    fn maintain(
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

    fn apply_aggregate(
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

    fn check_constraints(
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

    fn check_unique(
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

    fn check_rule(
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

    fn eval_rule(
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

    fn rule_term(&self, term: &RuleTerm, row: &Value) -> Result<Value, RuntimeError> {
        match term {
            RuleTerm::Field(name) => Ok(row.field(name)?.clone()),
            RuleTerm::Viewer => Ok(Value::Id(self.context.viewer.clone())),
            RuleTerm::Literal(value) => Ok(value.clone()),
        }
    }

    fn lookup_raw(
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

    fn fetch_id(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
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

    fn record_row(&mut self, table: &str, id: &str, row: &Value, client: bool) {
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

    fn bump_write(&mut self, table: &str) {
        *self.trace.writes.entry(table.to_owned()).or_default() += 1;
    }

    fn step(&mut self, amount: u64) -> Result<(), RuntimeError> {
        self.trace.steps = self.trace.steps.saturating_add(amount);
        if self.trace.steps > self.certificate.max_steps {
            return Err(RuntimeError::Steps(self.certificate.max_steps));
        }
        Ok(())
    }

    fn assert_bounds(&self) -> Result<(), RuntimeError> {
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

#[derive(Clone)]
struct EvaluatedRange {
    gt: Option<Value>,
    gte: Option<Value>,
    lt: Option<Value>,
    lte: Option<Value>,
}

fn fetch_table_connection(
    connection: &Connection,
    table: &str,
) -> Result<Vec<Value>, RuntimeError> {
    let mut statement = connection.prepare("SELECT data FROM rows WHERE table_name = ?1")?;
    let rows = statement.query_map([table], |row| row.get::<_, String>(0))?;
    rows.map(|row| {
        let row = row?;
        serde_json::from_str(&row).map_err(|error| RuntimeError::Schema(error.to_string()))
    })
    .collect()
}

fn reindex_row(
    connection: &Connection,
    schema: &Schema,
    table_name: &str,
    row: &Value,
) -> Result<(), RuntimeError> {
    let table = schema
        .table(table_name)
        .ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
    let id = row.field("id")?.as_str()?;
    delete_index_row(connection, table_name, id)?;
    for (index_name, index) in &table.indexes {
        if index.columns.len() > 8 {
            return Err(RuntimeError::Schema(format!(
                "index {table_name}.{index_name} has more than 8 columns in S1"
            )));
        }
        let encoded = index_values(row, index)
            .iter()
            .map(encode_index_value)
            .collect::<Result<Vec<_>, _>>()?;
        let mut values: Vec<Option<String>> = encoded.into_iter().map(Some).collect();
        values.resize(8, None);
        connection.execute(
            "INSERT INTO index_entries(
                table_name, index_name, row_id, c0, c1, c2, c3, c4, c5, c6, c7
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                table_name, index_name, id, values[0], values[1], values[2], values[3], values[4],
                values[5], values[6], values[7]
            ],
        )?;
    }
    Ok(())
}

fn delete_index_row(
    connection: &Connection,
    table_name: &str,
    id: &str,
) -> Result<(), RuntimeError> {
    connection.execute(
        "DELETE FROM index_entries WHERE table_name = ?1 AND row_id = ?2",
        params![table_name, id],
    )?;
    Ok(())
}

fn lookup_indexed(
    connection: &Connection,
    table_name: &str,
    index_name: &str,
    index: &Index,
    key: &[Value],
) -> Result<Option<Value>, RuntimeError> {
    if key.len() != index.columns.len() {
        return Err(RuntimeError::Schema(format!(
            "point read {table_name}.{index_name} supplied {} of {} key columns",
            key.len(),
            index.columns.len()
        )));
    }
    let mut parameters = vec![table_name.to_owned(), index_name.to_owned()];
    let mut predicates = Vec::new();
    for (offset, value) in key.iter().enumerate() {
        parameters.push(encode_index_value(value)?);
        predicates.push(format!("ie.c{offset} = ?{}", parameters.len()));
    }
    let sql = format!(
        "SELECT r.data
         FROM index_entries ie
         JOIN rows r ON r.table_name = ie.table_name AND r.row_id = ie.row_id
         WHERE ie.table_name = ?1 AND ie.index_name = ?2 AND {}
         LIMIT 1",
        predicates.join(" AND ")
    );
    let data: Option<String> = connection
        .query_row(&sql, params_from_iter(parameters.iter()), |row| row.get(0))
        .optional()?;
    data.map(|data| {
        serde_json::from_str(&data).map_err(|error| RuntimeError::Schema(error.to_string()))
    })
    .transpose()
}

#[allow(clippy::too_many_arguments)]
fn scan_indexed(
    connection: &Connection,
    table_name: &str,
    index_name: &str,
    index: &Index,
    prefix: &[Value],
    after: Option<&Value>,
    before: Option<&Value>,
    range: Option<&EvaluatedRange>,
    order: Order,
    limit: usize,
) -> Result<Vec<Value>, RuntimeError> {
    if prefix.len() > index.columns.len() {
        return Err(RuntimeError::Schema(format!(
            "scan {table_name}.{index_name} prefix has too many columns"
        )));
    }
    let mut parameters = vec![table_name.to_owned(), index_name.to_owned()];
    let mut predicates = Vec::new();
    let mut push_bound =
        |column: usize, operator: &str, value: &Value| -> Result<(), RuntimeError> {
            parameters.push(encode_index_value(value)?);
            predicates.push(format!("ie.c{column} {operator} ?{}", parameters.len()));
            Ok(())
        };
    for (offset, value) in prefix.iter().enumerate() {
        push_bound(offset, "=", value)?;
    }
    let range_column = prefix.len();
    if range_column < index.columns.len() {
        if let Some(value) = after {
            push_bound(range_column, ">", value)?;
        }
        if let Some(value) = before {
            push_bound(range_column, "<", value)?;
        }
        if let Some(range) = range {
            if let Some(value) = &range.gt {
                push_bound(range_column, ">", value)?;
            }
            if let Some(value) = &range.gte {
                push_bound(range_column, ">=", value)?;
            }
            if let Some(value) = &range.lt {
                push_bound(range_column, "<", value)?;
            }
            if let Some(value) = &range.lte {
                push_bound(range_column, "<=", value)?;
            }
        }
    }
    let direction = if order == Order::Asc { "ASC" } else { "DESC" };
    let ordering = (0..index.columns.len())
        .map(|offset| format!("ie.c{offset} {direction}"))
        .chain(std::iter::once(format!("ie.row_id {direction}")))
        .collect::<Vec<_>>()
        .join(", ");
    let suffix = if predicates.is_empty() {
        String::new()
    } else {
        format!(" AND {}", predicates.join(" AND "))
    };
    let sql = format!(
        "SELECT r.data
         FROM index_entries ie
         JOIN rows r ON r.table_name = ie.table_name AND r.row_id = ie.row_id
         WHERE ie.table_name = ?1 AND ie.index_name = ?2{suffix}
         ORDER BY {ordering}
         LIMIT {limit}"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(parameters.iter()), |row| {
        row.get::<_, String>(0)
    })?;
    rows.map(|row| {
        let row = row?;
        serde_json::from_str(&row).map_err(|error| RuntimeError::Schema(error.to_string()))
    })
    .collect()
}

fn encode_index_value(value: &Value) -> Result<String, RuntimeError> {
    let encoded = match value {
        Value::Null => "0".to_owned(),
        Value::Bool(value) => format!("1:{}", u8::from(*value)),
        Value::Int(value) => {
            let shifted = *value as i128 - I53_MIN as i128;
            format!("2:{shifted:020}")
        }
        Value::String(value) => format!("3:{}", hex(value.as_bytes())),
        Value::Id(value) => format!("4:{}", hex(value.as_bytes())),
        other => {
            return Err(RuntimeError::Schema(format!(
                "{} is not an indexable scalar",
                other.kind()
            )))
        }
    };
    Ok(encoded)
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(DIGITS[(byte >> 4) as usize] as char);
        encoded.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn index_values(row: &Value, index: &Index) -> Vec<Value> {
    index
        .columns
        .iter()
        .map(|column| row.field(column).cloned().unwrap_or(Value::Null))
        .collect()
}

fn row_ids(rows: &[Value]) -> Result<Vec<String>, RuntimeError> {
    rows.iter()
        .map(|row| {
            row.field("id")?
                .as_str()
                .map(ToOwned::to_owned)
                .map_err(Into::into)
        })
        .collect()
}

fn validate_row(table: Option<&Table>, table_name: &str, row: &Value) -> Result<(), RuntimeError> {
    let table = table.ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
    let object = row.as_object()?;
    if !object.contains_key("id") {
        return Err(RuntimeError::Schema(format!("{table_name} row lacks id")));
    }
    for (name, kind) in &table.columns {
        let value = object
            .get(name)
            .ok_or_else(|| RuntimeError::Schema(format!("{table_name}.{name} missing")))?;
        let valid = match (kind, value) {
            (ColumnType::Id | ColumnType::Ref { .. }, Value::Id(_)) => true,
            (ColumnType::Text { max }, Value::String(text)) => {
                text.chars().count() <= *max as usize
            }
            (ColumnType::Int | ColumnType::Time, Value::Int(value)) => {
                (I53_MIN..=I53_MAX).contains(value)
            }
            (ColumnType::Bool, Value::Bool(_)) => true,
            (ColumnType::Json { max_bytes }, value) => {
                canonical_json(value).len() <= *max_bytes as usize
            }
            _ => false,
        };
        if !valid {
            return Err(RuntimeError::Schema(format!(
                "{table_name}.{name} violates {kind:?}"
            )));
        }
    }
    Ok(())
}
