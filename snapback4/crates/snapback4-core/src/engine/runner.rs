//! The interpreter's spine: statements, expressions and builtins. Reads live
//! in `read.rs`, writes in `write.rs`; both are methods on `Runner`.

use super::Context;
use crate::error::{MeterKind, RuntimeError};
use crate::ir::*;
use crate::meter::Meter;
use crate::partition::Event;
use crate::schema::Schema;
use crate::store::Tx;
use crate::value::{Value, ValueError, canonical_json, object};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Clone, Debug)]
pub(super) enum Flow {
    Next,
    Break,
    Continue,
    Return(Value),
}

/// The page a `next` cursor can continue: the last top-level cursor-bearing
/// scan the program evaluated before it returned.
#[derive(Clone, Debug)]
pub(crate) struct PagePosition {
    pub table: String,
    pub index: String,
    pub order: Order,
    pub prefix_len: usize,
    /// The suffix values of the last returned row, if another visible row
    /// followed it (else the page is the last one).
    pub next: Option<Vec<Value>>,
}

pub struct Runner<'a> {
    pub(crate) tx: &'a Tx<'a>,
    pub(crate) schema: &'a Schema,
    pub(crate) context: Context,
    pub(crate) meter: Meter,
    pub(crate) env: BTreeMap<String, Value>,
    pub(crate) consts: BTreeSet<String>,
    /// Rows this transaction inserted, by (table, index, encoded key).
    pub(crate) created: BTreeSet<(String, String, String)>,
    pub(crate) inserted: Vec<(String, Value)>,
    /// Tables read and tables written, for live subscriptions and commits.
    pub(crate) read_tables: BTreeSet<String>,
    pub(crate) written_tables: BTreeSet<String>,
    pub(crate) rows_written: u64,
    /// Partition events, accumulated for the commit.
    pub(crate) events: Vec<Event>,
    /// Queued effects: `(id, effect, payload)`.
    pub(crate) outbox: Vec<(String, String, Value)>,
    /// How deep inside page loops the runner is; a scan at depth 0 may own
    /// the program's `next`.
    pub(crate) page_depth: usize,
    pub(crate) page: Option<PagePosition>,
    /// Whether a scan ran whose read rule the prefix does not decide. Such a
    /// result is `capped` whatever the meter found (LLP 1001 §3): a page
    /// that was `complete` only when few hidden rows were walked would
    /// count them.
    pub(crate) non_uniform: bool,
    /// The program's page had more rows than it returned and no cursor to
    /// continue on: the result is not `complete`, and the card says so.
    pub(crate) page_overflow: bool,
    /// The sequence this run will commit as (a query reads at `seq`).
    #[allow(dead_code)]
    pub(crate) seq: u64,
    pub(crate) statement_site: String,
}

impl<'a> Runner<'a> {
    pub fn new(tx: &'a Tx<'a>, schema: &'a Schema, context: Context, meter: Meter, seq: u64) -> Self {
        let mut env = BTreeMap::new();
        for (name, value) in &context.args {
            env.insert(name.clone(), value.clone());
        }
        Self {
            tx,
            schema,
            context,
            meter,
            env,
            consts: BTreeSet::new(),
            created: BTreeSet::new(),
            inserted: Vec::new(),
            read_tables: BTreeSet::new(),
            written_tables: BTreeSet::new(),
            rows_written: 0,
            events: Vec::new(),
            outbox: Vec::new(),
            page_depth: 0,
            page: None,
            non_uniform: false,
            page_overflow: false,
            seq,
            statement_site: String::new(),
        }
    }

    pub fn run(&mut self, program: &Program) -> Result<Value, RuntimeError> {
        match self.statements(&program.body, &program.name)? {
            Flow::Return(value) => Ok(value),
            _ => Ok(Value::Null),
        }
    }

    pub(super) fn statements(&mut self, statements: &[Stmt], prefix: &str) -> Result<Flow, RuntimeError> {
        for (index, statement) in statements.iter().enumerate() {
            let site = format!("{prefix}:{}", index + 1);
            self.statement_site = site.clone();
            self.meter.at(&site);
            self.meter.step(1)?;
            let flow = match statement {
                Stmt::Const { name, value } => {
                    let value = self.expr(value)?;
                    self.bind(name, value);
                    self.consts.insert(name.clone());
                    Flow::Next
                }
                Stmt::Let { name, value } | Stmt::Assign { name, value } => {
                    if matches!(statement, Stmt::Assign { .. }) && self.consts.contains(name) {
                        return Err(RuntimeError::Input(format!("cannot assign to const binding {name}")));
                    }
                    let value = self.expr(value)?;
                    self.bind(name, value);
                    Flow::Next
                }
                Stmt::Push { target, value } => {
                    let value = self.expr(value)?;
                    self.meter.heap(value.heap_bytes() + 16)?;
                    match self.env.get_mut(target) {
                        Some(Value::Array(values)) => values.push(value),
                        Some(other) => return Err(ValueError::Type { expected: "array", actual: other.kind() }.into()),
                        None => return Err(RuntimeError::Input(format!("unknown variable {target}"))),
                    }
                    Flow::Next
                }
                Stmt::If { condition, then_body, else_body } => {
                    let (branch, arm) = if self.expr(condition)?.as_bool()? { (then_body, "then") } else { (else_body, "else") };
                    self.statements(branch, &format!("{site}:{arm}"))?
                }
                Stmt::For { binding, domain, body } => {
                    let values = self.domain(domain)?;
                    let is_page = matches!(domain, LoopDomain::Page(_) | LoopDomain::Recurse(_));
                    if is_page {
                        self.page_depth += 1;
                    }
                    let mut result = Flow::Next;
                    for value in values {
                        self.bind(binding, value);
                        match self.statements(body, &site)? {
                            Flow::Next | Flow::Continue => {}
                            Flow::Break => break,
                            returned @ Flow::Return(_) => {
                                result = returned;
                                break;
                            }
                        }
                    }
                    if is_page {
                        self.page_depth -= 1;
                    }
                    result
                }
                Stmt::Require { condition, code, site: authored } => {
                    if !self.expr(condition)?.as_bool()? {
                        return Err(RuntimeError::Require { code: code.clone(), site: authored.clone().or(Some(site)) });
                    }
                    Flow::Next
                }
                Stmt::Check { condition, current } => {
                    if !self.expr(condition)?.as_bool()? {
                        let key = current.key.iter().map(|value| self.expr(value)).collect::<Result<Vec<_>, _>>()?;
                        let mut read = current.clone();
                        read.key = key.into_iter().map(Expr::Literal).collect();
                        return Err(RuntimeError::Conflict { current: read });
                    }
                    Flow::Next
                }
                Stmt::InsertIfAbsent { table, row, result } => {
                    let row = self.expr(row)?;
                    let value = if self.insert_if_absent(table, row.clone())? { row } else { Value::Null };
                    self.bind(result, value);
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
                    if !self.schema.effects.iter().any(|e| e == effect) {
                        return Err(RuntimeError::Schema(format!("unknown effect {effect}")));
                    }
                    let id = self.context.mint();
                    self.outbox.push((id, effect.clone(), payload));
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

    fn bind(&mut self, name: &str, value: Value) {
        self.env.insert(name.to_owned(), value);
    }

    fn domain(&mut self, domain: &LoopDomain) -> Result<Vec<Value>, RuntimeError> {
        match domain {
            LoopDomain::Page(scan) => self.scan(scan),
            LoopDomain::LiteralRange { start, end_exclusive } => (*start..*end_exclusive).map(|value| Value::int(value as i128)).collect::<Result<Vec<_>, _>>().map_err(Into::into),
            LoopDomain::ArgList { name, max } => {
                let values = self.env.get(name).ok_or_else(|| RuntimeError::Input(format!("missing arg {name}")))?.as_array()?.to_vec();
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
            let read = Read { site: recurse.site.clone(), table: recurse.table.clone(), index: recurse.index.clone(), key: vec![Expr::Literal(key)], provenance: recurse.provenance };
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
        self.meter.step(1)?;
        match expression {
            Expr::Literal(value) => Ok(value.clone()),
            Expr::Variable(name) => self.env.get(name).cloned().ok_or_else(|| RuntimeError::Input(format!("unknown variable {name}"))),
            Expr::Input(input) => self.input(*input),
            Expr::Field { base, name } => {
                let base = self.expr(base)?;
                match base {
                    Value::Null => Ok(Value::Null),
                    other => Ok(other.field(name)?.clone()),
                }
            }
            Expr::Array(values) => {
                let values = values.iter().map(|value| self.expr(value)).collect::<Result<Vec<_>, _>>()?;
                self.meter.heap(values.len() as u64 * 16)?;
                Ok(Value::Array(values))
            }
            Expr::Object(values) => {
                let fields = values.iter().map(|(key, value)| Ok((key.clone(), self.expr(value)?))).collect::<Result<BTreeMap<_, _>, RuntimeError>>()?;
                self.meter.heap(fields.len() as u64 * 32)?;
                Ok(Value::Row(fields.into()))
            }
            Expr::Binary { op, left, right } => {
                let left = self.expr(left)?;
                if *op == BinaryOp::And && !left.as_bool()? {
                    return Ok(Value::Bool(false));
                }
                if *op == BinaryOp::Or && left.as_bool()? {
                    return Ok(Value::Bool(true));
                }
                let right = self.expr(right)?;
                binary(*op, left, right)
            }
            Expr::Unary { op, value } => {
                let value = self.expr(value)?;
                match op {
                    UnaryOp::Not => Ok(Value::Bool(!value.as_bool()?)),
                    UnaryOp::Neg => Value::int(-(value.as_int()? as i128)).map_err(Into::into),
                }
            }
            Expr::Builtin { builtin, args } => {
                if args.len() != builtin.arity() {
                    return Err(RuntimeError::Input(format!("builtin {builtin:?} takes {} arguments, received {}", builtin.arity(), args.len())));
                }
                let args = args.iter().map(|value| self.expr(value)).collect::<Result<Vec<_>, _>>()?;
                self.builtin(builtin, args)
            }
            Expr::Get(read) => self.get(read),
            Expr::Exists(read) => Ok(Value::Bool(self.get(read)? != Value::Null)),
            Expr::Scan(scan) => {
                let values = self.scan(scan)?;
                self.meter.heap(values.iter().map(Value::heap_bytes).sum::<u64>())?;
                Ok(Value::Array(values))
            }
            Expr::Merge(merge) => {
                let values = self.merge(merge)?;
                self.meter.heap(values.iter().map(Value::heap_bytes).sum::<u64>())?;
                Ok(Value::Array(values))
            }
        }
    }

    pub(super) fn input(&mut self, input: Input) -> Result<Value, RuntimeError> {
        match input {
            Input::Viewer => Ok(Value::Id(self.context.viewer.clone())),
            Input::Now => self.context.now.map(Value::Int).ok_or_else(|| RuntimeError::Input("now is not pinned in a query".to_owned())),
            Input::NewId => {
                let id = self.context.mint();
                crate::value::validate_identities(&Value::Id(id.clone()))?;
                Ok(Value::Id(id))
            }
            Input::ReadTime => self.context.read_time.map(Value::Int).ok_or_else(|| RuntimeError::Input("readTime is not pinned".to_owned())),
        }
    }

    fn builtin(&mut self, builtin: &Builtin, mut args: Vec<Value>) -> Result<Value, RuntimeError> {
        match builtin {
            Builtin::Len => {
                let len = match &args[0] {
                    Value::String(text) | Value::Id(text) => text.chars().count(),
                    Value::Array(values) => values.len(),
                    Value::Row(values) | Value::Map(values) => values.len(),
                    other => return Err(ValueError::Type { expected: "string, array, or map", actual: other.kind() }.into()),
                };
                Value::int(len as i128).map_err(Into::into)
            }
            Builtin::Slice => {
                let value = args.remove(0);
                let start = args.remove(0).as_int()?.max(0) as usize;
                let end = args.remove(0).as_int()?.max(0) as usize;
                let length = end.saturating_sub(start);
                match value {
                    Value::Array(values) => Ok(Value::Array(values.into_iter().skip(start).take(length).collect())),
                    Value::String(value) => Ok(Value::String(value.chars().skip(start).take(length).collect())),
                    other => Err(ValueError::Type { expected: "array or string", actual: other.kind() }.into()),
                }
            }
            Builtin::Concat => {
                let left = args.remove(0);
                let right = args.remove(0);
                match (left, right) {
                    (left @ Value::String(_), right) | (left, right @ Value::String(_)) => Ok(Value::String(format!("{}{}", concat_text(&left), concat_text(&right)))),
                    (Value::Id(left), Value::Id(right)) => Ok(Value::Id(canonical_json(&[Value::Id(left), Value::Id(right)]))),
                    (Value::Array(mut left), Value::Array(right)) => {
                        left.extend(right);
                        Ok(Value::Array(left))
                    }
                    (left, _) => Err(ValueError::Type { expected: "matching strings or arrays", actual: left.kind() }.into()),
                }
            }
            Builtin::Min | Builtin::Max => {
                let left = args.remove(0);
                let right = args.remove(0);
                let choose_left = if matches!(builtin, Builtin::Min) { left.total_cmp(&right) != Ordering::Greater } else { left.total_cmp(&right) != Ordering::Less };
                Ok(if choose_left { left } else { right })
            }
            Builtin::Divmod { remainder_sink } => {
                let numerator = args.remove(0).as_int()?;
                let denominator = args.remove(0).as_int()?;
                if denominator == 0 {
                    return Err(ValueError::DivideByZero.into());
                }
                Ok(object([("quotient", Value::Int(numerator.div_euclid(denominator))), ("remainder", Value::Int(numerator.rem_euclid(denominator))), ("sink", Value::String(remainder_sink.clone()))]))
            }
            Builtin::Sort { keys } => {
                let mut values = args.remove(0).as_array()?.to_vec();
                for value in &values {
                    for key in keys {
                        value.field(&key.field)?;
                    }
                }
                self.meter.step(values.len() as u64)?;
                values.sort_by(|left, right| {
                    keys.iter()
                        .find_map(|key| {
                            let mut order = left.field(&key.field).expect("validated").total_cmp(right.field(&key.field).expect("validated"));
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
                    return Err(RuntimeError::Input("share recipients must be unique".to_owned()));
                }
                let position = recipients.iter().position(|value| value == &recipient).ok_or_else(|| RuntimeError::Input("recipient missing from shares".to_owned()))?;
                let count = recipients.len() as i64;
                let base = amount.div_euclid(count);
                let remainder = amount.rem_euclid(count) as usize;
                Value::int(base as i128 + i128::from(position < remainder)).map_err(Into::into)
            }
            Builtin::Count | Builtin::CountCapped => Value::int(args.remove(0).as_array()?.len() as i128).map_err(Into::into),
            Builtin::Sum => {
                let sum = args.remove(0).as_array()?.iter().try_fold(0_i128, |sum, value| value.as_int().map(|value| sum + value as i128))?;
                Value::int(sum).map_err(Into::into)
            }
        }
    }

    /// Charge the bytes a result will occupy on the wire.
    pub(super) fn charge_output(&mut self, value: &Value) -> Result<bool, RuntimeError> {
        self.meter.charge(MeterKind::OutputBytes, canonical_json(value).len() as u64)
    }
}

pub(super) fn binary(op: BinaryOp, left: Value, right: Value) -> Result<Value, RuntimeError> {
    let ordering = || left.total_cmp(&right);
    match op {
        BinaryOp::Eq => Ok(Value::Bool(left == right)),
        BinaryOp::Ne => Ok(Value::Bool(left != right)),
        BinaryOp::SameValueZero => Ok(Value::Bool(same_value_zero(&left, &right)?)),
        BinaryOp::Lt => Ok(Value::Bool(ordering() == Ordering::Less)),
        BinaryOp::Lte => Ok(Value::Bool(ordering() != Ordering::Greater)),
        BinaryOp::Gt => Ok(Value::Bool(ordering() == Ordering::Greater)),
        BinaryOp::Gte => Ok(Value::Bool(ordering() != Ordering::Less)),
        BinaryOp::Add => Value::int(left.as_int()? as i128 + right.as_int()? as i128).map_err(Into::into),
        BinaryOp::Sub => Value::int(left.as_int()? as i128 - right.as_int()? as i128).map_err(Into::into),
        BinaryOp::Mul => Value::int(left.as_int()? as i128 * right.as_int()? as i128).map_err(Into::into),
        BinaryOp::And => Ok(Value::Bool(left.as_bool()? && right.as_bool()?)),
        BinaryOp::Or => Ok(Value::Bool(left.as_bool()? || right.as_bool()?)),
    }
}

fn same_value_zero(left: &Value, right: &Value) -> Result<bool, ValueError> {
    match (left, right) {
        (Value::Null, Value::Null) => Ok(true),
        (Value::Null, _) | (_, Value::Null) => Ok(false),
        (Value::Bool(a), Value::Bool(b)) => Ok(a == b),
        (Value::Int(a), Value::Int(b)) => Ok(a == b),
        (Value::String(a), Value::String(b)) | (Value::Id(a), Value::Id(b)) => Ok(a == b),
        (Value::Bytes(a), Value::Bytes(b)) => Ok(a == b),
        (Value::Array(_) | Value::Row(_) | Value::Map(_), _) | (_, Value::Array(_) | Value::Row(_) | Value::Map(_)) => Err(ValueError::Type { expected: "scalar", actual: left.kind() }),
        _ => Ok(false),
    }
}

fn is_mention_whitespace(character: char) -> bool {
    character.is_whitespace() || matches!(character, ',' | ';' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>' | '"' | '\'')
}

fn concat_text(value: &Value) -> String {
    match value {
        Value::String(text) | Value::Id(text) => text.clone(),
        Value::Int(int) => int.to_string(),
        Value::Bool(bool) => bool.to_string(),
        Value::Null => String::new(),
        other => canonical_json(other),
    }
}
