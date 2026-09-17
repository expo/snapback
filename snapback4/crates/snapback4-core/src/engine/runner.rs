//! The interpreter's spine: statements, expressions and builtins. Reads live
//! in `read.rs`, writes in `write.rs`; both are methods on `Runner`.

use super::Context;
use crate::smallmap::{SmallMap, SmallSet};
use crate::error::{MeterKind, RuntimeError};
use crate::ir::*;
use crate::meter::{Cut, Meter};
use crate::partition::Event;
use crate::schema::Schema;
use crate::rows::Rows;
use crate::value::{Value, ValueError, canonical_json, object};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Clone, Debug)]
pub(super) enum Flow {
    Next,
    Break,
    Continue,
    Return(Value),
}

/// One evaluated cursor-bearing page; the return plan selects its owner.
#[derive(Clone, Debug)]
pub(crate) struct PagePosition {
    pub table: String,
    pub index: String,
    pub order: Order,
    pub prefix_len: usize,
    pub prefix: Option<Vec<Value>>,
    /// A collector exited with rows still unconsumed, even on a short page.
    pub interrupted: bool,
    /// The suffix values of the last returned row, if another visible row
    /// followed it (else the page is the last one).
    pub next: Option<Vec<Value>>,
}

pub struct Runner<'a> {
    pub(crate) tx: &'a dyn Rows,
    pub(crate) schema: &'a Schema,
    pub(crate) context: Context,
    pub(crate) meter: Meter,
    pub(crate) env: SmallMap<String, Value>,
    pub(crate) consts: SmallSet<String>,
    /// Rows this transaction inserted, by (table, index, encoded key).
    pub(crate) created: BTreeMap<(String, String, String), usize>,
    /// Current facts owned by each row inserted in this execution. Distinct
    /// rows can share a key; counts preserve their independent ownership.
    pub(crate) created_rows: BTreeMap<(String, String), Vec<(String, String, String)>>,
    pub(crate) inserted: Vec<(String, Value)>,
    /// Tables read and tables written, for live subscriptions and commits.
    pub(crate) read_tables: SmallSet<String>,
    pub(crate) written_tables: SmallSet<String>,
    pub(crate) rows_written: u64,
    pub(crate) next_expiry: Option<i64>,
    /// Partition events, accumulated for the commit.
    pub(crate) events: Vec<Event>,
    /// Queued effects with their grace dependencies.
    pub(crate) outbox: Vec<super::presence::Emission>,
    pub(super) effect_presence: super::presence::EffectPresence,
    /// How deep inside page loops the runner is; a scan at depth 0 may own
    /// the program's `next`.
    pub(crate) page_depth: usize,
    pub(crate) page: Option<PagePosition>,
    pub(crate) pages: SmallMap<String, PagePosition>,
    /// Loss from replaced executions cannot be repaired by a later page.
    pub(super) discarded_page_loss: bool,
    pub(super) page_owner: Option<String>,
    page_plan: super::pages::Plan,
    /// Whether a scan ran whose read rule the prefix does not decide. Such a
    /// result is `capped` whatever the meter found (LLP 1001 §3): a page
    /// that was `complete` only when few hidden rows were walked would
    /// count them.
    pub(crate) non_uniform: bool,
    /// The program's page had more rows than it returned and no cursor to
    /// continue on: the result is not `complete`, and the card says so.
    pub(crate) page_overflow: bool,
    /// First scope whose word expansion exceeded 32; incomplete, without
    /// stopping later lanes or setting the query's meter cut.
    pub(crate) word_cut_at: Option<String>,
    /// Running on a device over its partition (`engine::local`): a synced
    /// table's rows are readable as held, an online-only table's are not
    /// here, and a page at the horizon may continue on the server.
    pub(crate) device: bool,
    /// The device touched an online-only table or a horizon: `complete: false`.
    pub(crate) beyond_horizon: bool,
    pub(crate) missing_fact: Option<String>,
    /// Reads inside a where filter share the query's rule-probe budget.
    pub(crate) filter_depth: u32,
    /// The program read `connected[p]` where no registry answers (a
    /// device): a query's result is not `complete`; the compiled execution
    /// fact excludes a mutation with this site from prediction.
    pub(crate) presence_unknown: bool,
    /// The sequence this run will commit as (a query reads at `seq`).
    #[allow(dead_code)]
    pub(crate) seq: u64,
    pub(crate) statement_site: String,
    pub(crate) evaluating_write_condition: bool,
    prediction_guards: SmallSet<String>,
    pub(super) discard_effects: bool,
    /// The prediction paid for an untaken presence arm the server may skip.
    pub(crate) charged_untaken: bool,
    pub(crate) maintain_prepaid: bool,
    pub(crate) maintain_heap: u64,
}

impl<'a> Runner<'a> {
    // @ref LLP 3000.007#5.6 — non-uniform server work depends on hidden populations; its cut reason must stay private too.
    pub(crate) fn read_cut(&self) -> Option<super::ReadCut> {
        if self.non_uniform && !self.device { None }
        else if self.meter.capped_at.is_some() { Some(super::ReadCut::Meter) }
        else if self.word_cut_at.is_some() { Some(super::ReadCut::Words) }
        else { None }
    }

    pub fn new(tx: &'a dyn Rows, schema: &'a Schema, context: Context, meter: Meter, seq: u64) -> Self {
        let mut env = SmallMap::new();
        for (name, value) in &context.args {
            env.insert(name.clone(), value.clone());
        }
        Self {
            tx,
            schema,
            context,
            meter,
            env,
            consts: SmallSet::new(),
            created: BTreeMap::new(),
            created_rows: BTreeMap::new(),
            inserted: Vec::new(),
            read_tables: SmallSet::new(),
            written_tables: SmallSet::new(),
            rows_written: 0,
            next_expiry: None,
            events: Vec::new(),
            outbox: Vec::new(),
            effect_presence: Default::default(),
            page_depth: 0,
            page: None,
            pages: SmallMap::new(),
            discarded_page_loss: false,
            page_owner: None,
            page_plan: super::pages::Plan::default(),
            non_uniform: false,
            page_overflow: false,
            word_cut_at: None,
            device: false,
            beyond_horizon: false,
            missing_fact: None,
            filter_depth: 0,
            presence_unknown: false,
            seq,
            statement_site: String::new(),
            evaluating_write_condition: false,
            prediction_guards: SmallSet::new(),
            discard_effects: false,
            charged_untaken: false,
            maintain_prepaid: false,
            maintain_heap: 0,
        }
    }

    pub fn run(&mut self, program: &Program) -> Result<Value, RuntimeError> {
        self.page_plan = super::pages::plan(program, self.schema, self.tx.prefetch_enabled());
        self.prediction_guards = self.schema.operations.get(&program.name)
            .filter(|fact| self.device && fact.connected_effects_only && fact.predicts.as_deref() == Some("eligible"))
            .map(|fact| fact.prediction_guards.iter().cloned().collect()).unwrap_or_default();
        // @ref LLP 3000.007#5.0 — charge allocations before admitting the relaxed forms.
        // A heap cut cannot invent a partial scalar/shape or a continuation.
        // Unwind immediately; both query hosts publish null, incomplete, with
        // the private capped_at recorded by Meter::heap (LLP 3000 §7).
        let result = (|| {
            self.prepare_effect_presence(program)?;
            for value in self.context.args.values() { self.meter.heap(value.clone_heap_bytes())?; }
            self.statements(&program.body, &program.name)
        })();
        match result {
            Ok(Flow::Return(value)) => Ok(value),
            Ok(_) => Ok(Value::Null),
            Err(RuntimeError::Bound { kind: MeterKind::HeapBytes, .. }) if self.meter.cut == Cut::Cap => {
                self.page = None;
                Ok(Value::Null)
            }
            Err(error) => Err(error),
        }
    }

    pub(super) fn statements(&mut self, statements: &[Stmt], prefix: &str) -> Result<Flow, RuntimeError> {
        for (index, statement) in statements.iter().enumerate() {
            self.effect_presence.reads.clear();
            let site = format!("{prefix}:{}", index + 1);
            if matches!(statement, Stmt::Insert { .. } | Stmt::InsertIfAbsent { .. } | Stmt::Update { .. } | Stmt::Upsert { .. } | Stmt::WriteTarget { .. } | Stmt::Delete { .. } | Stmt::Emit { .. }) { self.refuse_condition_write()?; }
            self.statement_site = site.clone();
            self.meter.at(&site);
            self.meter.step(1)?;
            let flow = match statement {
                Stmt::Const { name, value } => {
                    let value = self.expr(value)?;
                    self.meter.heap(value.heap_bytes())?;
                    self.bind_effect_value(name, value)?;
                    self.consts.insert(name.clone());
                    Flow::Next
                }
                Stmt::Let { name, value } | Stmt::Assign { name, value } => {
                    if matches!(statement, Stmt::Assign { .. }) && self.consts.contains(name) {
                        return Err(RuntimeError::Input(format!("cannot assign to const binding {name}")));
                    }
                    let value = self.expr(value)?;
                    self.meter.heap(value.heap_bytes())?;
                    self.bind_effect_value(name, value)?;
                    Flow::Next
                }
                Stmt::Push { target, value } => {
                    let value = self.expr(value)?;
                    self.meter.heap(value.heap_bytes() + std::mem::size_of::<Value>() as u64)?;
                    self.push_presence_value(target)?;
                    match self.env.get_mut(target) {
                        Some(Value::Array(values)) => values.push(value),
                        Some(other) => return Err(ValueError::Type { expected: "array", actual: other.kind() }.into()),
                        None => return Err(RuntimeError::Input(format!("unknown variable {target}"))),
                    }
                    Flow::Next
                }
                Stmt::If { condition, then_body, else_body } => {
                    let take_then = self.expr(condition)?.as_bool()?;
                    let (branch, arm, untaken, other) = if take_then { (then_body, "then", else_body, "else") } else { (else_body, "else", then_body, "then") };
                    let guard = self.enter_presence_guard(&site, take_then)?;
                    if self.prediction_guards.contains(&site) { self.charge_untaken(untaken, &format!("{site}:{other}"))?; }
                    let result = self.statements(branch, &format!("{site}:{arm}"));
                    self.effect_presence.guard = guard;
                    result?
                }
                Stmt::For { binding, domain, body } => {
                    let mut values = self.domain(domain)?;
                    let is_page = matches!(domain, LoopDomain::Page(_) | LoopDomain::Recurse(_));
                    if is_page {
                        self.page_depth += 1;
                    }
                    let mut result = Flow::Next;
                    while let Some(value) = values.next() {
                        if matches!(domain, LoopDomain::LiteralRange { .. } | LoopDomain::ExpressionRange { .. }) { self.meter.step(1)?; }
                        self.bind(binding, value);
                        let flow = self.statements(body, &site)?;
                        if matches!(flow, Flow::Break | Flow::Return(_)) && values.size_hint().0 > 0
                            && let Some(page) = self.page_plan.collectors.get(&site).and_then(|page| self.pages.get_mut(page)) {
                            page.interrupted = true;
                        }
                        match flow {
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
                Stmt::WriteTarget { target, patch, upsert, condition, result } => {
                    let value = self.write_target(target, patch, *upsert, condition.as_ref(), result.is_some())?;
                    if let Some(name) = result { self.meter.heap(value.heap_bytes())?; self.bind(name, value); }
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
                    // @ref LLP 3000.007#19.1 — effect identity belongs to the commit, never to the row/result id supply.
                    let presence = self.emission_presence()?;
                    if !self.discard_effects {
                        let id = format!("effect-{:016x}-{:016x}", self.seq, self.outbox.len());
                        self.outbox.push((id, effect.clone(), payload, presence));
                    }
                    Flow::Next
                }
                Stmt::Return(value) => {
                    let value = self.expr(value)?;
                    self.page_owner = self.page_plan.returns.get(&site).cloned();
                    self.page = self.page_owner.as_ref().and_then(|owner| self.pages.get(owner)).cloned();
                    Flow::Return(value)
                },
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
        self.effect_presence.variables.remove(name);
        self.env.insert(name.to_owned(), value);
    }

    fn domain(&mut self, domain: &LoopDomain) -> Result<Box<dyn Iterator<Item = Value>>, RuntimeError> {
        let values = match domain {
            LoopDomain::Page(scan) => {
                let values = self.scan(scan)?;
                self.page_plan.prefetch.fill(&scan.site, &values, &self.context, self.schema, self.tx);
                self.meter.heap(values.capacity() as u64 * std::mem::size_of::<Value>() as u64 + values.iter().map(Value::heap_bytes).sum::<u64>())?;
                Ok(values)
            }
            LoopDomain::LiteralRange { start, end_exclusive } => {
                return Ok(Box::new((*start..*end_exclusive).map(Value::Int)));
            }
            // @ref LLP 3000.007#5.7 — expression bounds are evaluated once; iteration consumes steps without allocating the range.
            LoopDomain::ExpressionRange { start, end_exclusive } => {
                let start = self.expr(start)?.as_int()?;
                let end = self.expr(end_exclusive)?.as_int()?;
                return Ok(Box::new((start..end).map(Value::Int)));
            }
            LoopDomain::ArgList { name, max } => {
                let value = self.env.get(name).ok_or_else(|| RuntimeError::Input(format!("missing arg {name}")))?;
                self.meter.heap(value.clone_heap_bytes())?;
                let values = value.as_array()?.to_vec();
                if values.len() > *max as usize {
                    return Err(RuntimeError::Fanout);
                }
                Ok(values)
            }
            LoopDomain::DerivedArray { value, max, .. } => {
                let site = self.statement_site.clone();
                let values = into_array(self.expr(value)?)?;
                if values.len() > *max as usize {
                    return Err(RuntimeError::Fanout);
                }
                self.page_plan.prefetch.fill(&site, &values, &self.context, self.schema, self.tx);
                Ok(values)
            }
            LoopDomain::Recurse(recurse) => self.recurse(recurse),
        }?;
        Ok(Box::new(values.into_iter()))
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
            let next = row.field(&recurse.next_field)?;
            self.meter.heap(next.clone_heap_bytes() + row.heap_bytes() + std::mem::size_of::<Value>() as u64)?;
            let next = next.clone();
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
        self.read_presence_value(expression)?;
        match expression {
            Expr::Literal(value) => {
                self.meter.heap(value.clone_heap_bytes())?;
                Ok(value.clone())
            }
            Expr::Variable(name) => {
                let value = self.env.get(name).ok_or_else(|| RuntimeError::Input(format!("unknown variable {name}")))?;
                self.meter.heap(value.clone_heap_bytes())?;
                Ok(value.clone())
            }
            Expr::Input(input) => self.input(*input),
            Expr::Field { base, name } => {
                if let Some((base, steps)) = borrowed(&self.env, base)? {
                    self.meter.step(steps)?;
                    if *base == Value::Null { return Ok(Value::Null); }
                    let value = base.field(name)?;
                    self.meter.heap(value.clone_heap_bytes())?;
                    return Ok(value.clone());
                }
                let base = self.expr(base)?;
                match base {
                    Value::Null => Ok(Value::Null),
                    other => {
                        let value = other.field(name)?;
                        self.meter.heap(value.clone_heap_bytes())?;
                        Ok(value.clone())
                    }
                }
            }
            Expr::Block { body, value } => {
                self.statements(body, "where")?;
                self.expr(value)
            }
            Expr::Array(values) => {
                let values = values.iter().map(|value| self.expr(value)).collect::<Result<Vec<_>, _>>()?;
                let value = Value::Array(values);
                self.meter.heap(value.heap_bytes())?;
                Ok(value)
            }
            Expr::Shape { base, fields } => {
                // @ref LLP 3000.007#5.3 — shaping a device row preserves its own pending metadata.
                let base = self.expr(base)?;
                let mut fields = fields.iter().map(|(key, value)| Ok((key.clone(), self.expr(value)?))).collect::<Result<SmallMap<_, _>, RuntimeError>>()?;
                if base.as_object()?.get("pending") == Some(&Value::Bool(true)) { fields.insert("pending".into(), Value::Bool(true)); }
                let value = Value::Row(fields.into());
                self.meter.heap(value.heap_bytes())?;
                Ok(value)
            }
            Expr::Object(values) => {
                let fields = values.iter().map(|(key, value)| Ok((key.clone(), self.expr(value)?))).collect::<Result<SmallMap<_, _>, RuntimeError>>()?;
                let value = Value::Row(fields.into());
                self.meter.heap(value.heap_bytes())?;
                Ok(value)
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
                if args.len() != builtin.arity() && !(matches!(builtin, Builtin::Calendar { .. }) && args.len() == 2) {
                    return Err(RuntimeError::Input(format!("builtin {builtin:?} takes {} arguments, received {}", builtin.arity(), args.len())));
                }
                // Inspect a held value without allocating a copy just to count
                // it. Reads that need ownership still charge every actual clone.
                if matches!(builtin, Builtin::Len | Builtin::Count | Builtin::CountCapped | Builtin::Sum) {
                    if let Some((value, steps)) = borrowed(&self.env, &args[0])? {
                        self.meter.step(steps)?;
                        return scalar_builtin(builtin, value);
                    }
                }
                let args = args.iter().map(|value| self.expr(value)).collect::<Result<Vec<_>, _>>()?;
                self.builtin(builtin, args)
            }
            Expr::Get(read) => {
                let value = self.get(read)?;
                self.meter.heap(value.heap_bytes())?;
                Ok(value)
            }
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
            Input::Viewer => {
                self.meter.heap(self.context.viewer.len() as u64)?;
                Ok(Value::Id(self.context.viewer.clone()))
            }
            Input::Now => self.context.now.map(Value::Int).ok_or_else(|| RuntimeError::Input("now is not pinned in a query".to_owned())),
            Input::NewId => {
                let id = self.context.mint()?;
                let value = Value::Id(id);
                crate::value::validate_identities(&value)?;
                self.meter.heap(value.heap_bytes())?;
                Ok(value)
            }
            Input::ReadTime => self.context.read_time.map(Value::Int).ok_or_else(|| RuntimeError::Input("readTime is not pinned".to_owned())),
        }
    }

    fn builtin(&mut self, builtin: &Builtin, mut args: Vec<Value>) -> Result<Value, RuntimeError> {
        let result: Result<Value, RuntimeError> = match builtin {
            Builtin::Len | Builtin::Count | Builtin::CountCapped | Builtin::Sum => scalar_builtin(builtin, &args[0]),
            Builtin::Calendar { millis } => {
                if *millis <= 0 { return Err(RuntimeError::Input("calendar duration must be positive".into())); }
                let offset = args.get(1).map(Value::as_int).transpose()?.unwrap_or(0);
                if offset < 0 || offset >= *millis { return Err(RuntimeError::Input("calendar offset must be nonnegative and smaller than its period".into())); }
                Ok(Value::Int(crate::maintain::calendar_ordinal(args[0].as_int()?, *millis, offset)))
            }
            Builtin::Lower | Builtin::Trim => {
                let text = args[0].as_str()?;
                let value = Value::String(if matches!(builtin, Builtin::Lower) { text.to_lowercase() } else { text.trim().to_owned() });
                // @ref LLP 3000.007#5.3 — the small text library charges every new result to the heap meter.
                self.meter.heap(value.heap_bytes())?;
                Ok(value)
            }
            Builtin::Sha256 => {
                let text = args[0].as_str()?;
                let work = u64::try_from(text.len()).ok().and_then(|bytes| bytes.checked_add(1)).unwrap_or(u64::MAX);
                self.meter.step(work)?;
                let value = Value::String(format!("{:x}", Sha256::digest(text.as_bytes())));
                // @ref LLP 3000.007#5.0 — runtime work and each new result allocation stay inside the meter.
                // The digest Value owns one fixed 64-byte lowercase ASCII string;
                // charge its String capacity as Value::heap_bytes does elsewhere.
                self.meter.heap(value.heap_bytes())?;
                Ok(value)
            }
            Builtin::Group { field } => {
                // @ref LLP 3000.007#5.3 — groups retain first-seen order; keys and the result are heap charged.
                let values = into_array(args.remove(0))?;
                let mut positions = BTreeMap::<String, usize>::new();
                let mut groups: Vec<(Value, Vec<Value>)> = Vec::new();
                for value in values {
                    self.meter.step(1)?;
                    let key = value.field(field)?.clone();
                    let encoded = canonical_json(&key);
                    self.meter.heap(encoded.len() as u64 + key.clone_heap_bytes())?;
                    let next = groups.len();
                    let position = *positions.entry(encoded).or_insert(next);
                    if position == next { groups.push((key, Vec::new())); }
                    groups[position].1.push(value);
                }
                Ok(Value::Array(groups.into_iter().map(|(key, items)| object([("key", key), ("items", Value::Array(items))])).collect()))
            }
            Builtin::First | Builtin::Last | Builtin::At => {
                let values = into_array(args.remove(0))?;
                let position = match builtin { Builtin::First => 0, Builtin::Last => values.len().saturating_sub(1), _ => usize::try_from(args[0].as_int()?).unwrap_or(usize::MAX) };
                Ok(values.into_iter().nth(position).unwrap_or(Value::Null))
            }
            Builtin::Join => {
                let values = args[0].as_array()?;
                let sep = args[1].as_str()?;
                let mut text = String::new();
                for (index, value) in values.iter().enumerate() {
                    if index > 0 { text.push_str(sep); }
                    text.push_str(value.as_str()?);
                }
                let value = Value::String(text);
                self.meter.heap(value.heap_bytes())?;
                Ok(value)
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
                    (left @ Value::String(_), right) | (left, right @ Value::String(_)) => {
                        let left = concat_text(&left);
                        let right = concat_text(&right);
                        for text in [&left, &right] {
                            if let Cow::Owned(text) = text { self.meter.heap(text.capacity() as u64)?; }
                        }
                        Ok(Value::String(format!("{left}{right}")))
                    }
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
                let mut values = into_array(args.remove(0))?;
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
                let text = args[0].as_str()?;
                let mut seen = BTreeSet::new();
                let mut tokens = Vec::new();
                for word in text.split(is_mention_whitespace).filter_map(|word| word.strip_prefix('@')) {
                    let word = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '_');
                    if !word.is_empty() && !seen.contains(word) {
                        self.meter.heap(80)?; // Deduplication tree entry, borrowing the input text.
                        seen.insert(word);
                        tokens.push(Value::String(word.to_owned()));
                    }
                }
                Ok(Value::Array(tokens))
            }
            Builtin::DeterministicShare => {
                let amount = args.remove(0).as_int()?;
                let mut recipients = into_array(args.remove(0))?;
                self.meter.heap(recipients.capacity() as u64 * std::mem::size_of::<Value>() as u64 + recipients.iter().map(Value::heap_bytes).sum::<u64>())?;
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
            Builtin::Connected => {
                let principal = args.remove(0);
                let principal = match &principal {
                    Value::Id(id) | Value::String(id) => id.as_str(),
                    Value::Null => return Ok(Value::Int(0)),
                    other => return Err(ValueError::Type { expected: "principal", actual: other.kind() }.into()),
                };
                match &self.context.presence {
                    Some(presence) => {
                        if self.effect_presence.enabled {
                            let (live, deadline) = presence.effect_presence(principal);
                            self.grace_read(principal, deadline.filter(|_| live == 0))?;
                            Value::int(live as i128).map_err(Into::into)
                        } else { Value::int(presence.connections(principal) as i128).map_err(Into::into) }
                    },
                    None => {
                        // Nobody here knows: a device reads everyone as
                        // connected (the least speculative rows) and the
                        // server's answer replaces its prediction; `run`
                        // and tests read nobody as connected.
                        self.presence_unknown = true;
                        if self.effect_presence.enabled { self.grace_read(principal, None)?; }
                        Ok(Value::Int(if self.device { 1 } else { 0 }))
                    }
                }
            }
        };
        let value = result?;
        if matches!(builtin, Builtin::Group { .. } | Builtin::First | Builtin::Last | Builtin::At | Builtin::Concat | Builtin::Slice | Builtin::Sort { .. } | Builtin::MentionTokens | Builtin::Divmod { .. }) {
            self.meter.heap(value.heap_bytes())?;
        }
        Ok(value)
    }

    /// Charge the bytes a result will occupy on the wire.
    pub(super) fn charge_output(&mut self, value: &Value) -> Result<bool, RuntimeError> {
        // Count the canonical tagged representation without allocating a
        // second result-sized string. A shaped/scalar result cannot be
        // truncated without changing its type or inventing a continuation.
        struct Counter(u64);
        impl std::io::Write for Counter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> { self.0 = self.0.saturating_add(bytes.len() as u64); Ok(bytes.len()) }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        let mut count = Counter(0);
        serde_json::to_writer(&mut count, value).map_err(|e| RuntimeError::Store(e.to_string()))?;
        if !self.meter.charge(MeterKind::OutputBytes, count.0)? {
            return Err(RuntimeError::Bound { kind: MeterKind::OutputBytes, actual: count.0, ceiling: self.meter.ceilings.output_bytes, site: self.meter.site().to_owned() });
        }
        Ok(true)
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

fn concat_text(value: &Value) -> Cow<'_, str> {
    match value {
        Value::String(text) | Value::Id(text) => Cow::Borrowed(text),
        Value::Int(int) => Cow::Owned(int.to_string()),
        Value::Bool(value) => Cow::Borrowed(if *value { "true" } else { "false" }),
        Value::Null => Cow::Borrowed(""),
        other => Cow::Owned(canonical_json(other)),
    }
}

fn into_array(value: Value) -> Result<Vec<Value>, RuntimeError> {
    match value {
        Value::Array(values) => Ok(values),
        other => Err(ValueError::Type { expected: "array", actual: other.kind() }.into()),
    }
}

/// Only side-effect-free leaves can be borrowed; storage/input evaluation
/// remains in expr, and visiting a borrowed leaf costs the same steps.
fn borrowed<'a>(env: &'a SmallMap<String, Value>, expr: &'a Expr) -> Result<Option<(&'a Value, u64)>, RuntimeError> {
    match expr {
        Expr::Literal(value) => Ok(Some((value, 1))),
        Expr::Variable(name) => env.get(name).map(|value| Some((value, 1))).ok_or_else(|| RuntimeError::Input(format!("unknown variable {name}"))),
        Expr::Field { base, name } => match borrowed(env, base)? {
            Some((value, steps)) => Ok(Some((if *value == Value::Null { value } else { value.field(name)? }, steps + 1))),
            None => Ok(None),
        },
        _ => Ok(None),
    }
}

fn scalar_builtin(builtin: &Builtin, value: &Value) -> Result<Value, RuntimeError> {
    let count = match builtin {
        Builtin::Len => match value {
            Value::String(text) | Value::Id(text) => text.chars().count(),
            Value::Array(values) => values.len(),
            Value::Row(values) | Value::Map(values) => values.len(),
            other => return Err(ValueError::Type { expected: "string, array, or map", actual: other.kind() }.into()),
        },
        Builtin::Count | Builtin::CountCapped => value.as_array()?.len(),
        Builtin::Sum => return Value::int(value.as_array()?.iter().try_fold(0_i128, |sum, value| value.as_int().map(|value| sum + value as i128))?).map_err(Into::into),
        _ => unreachable!("only scalar inspectors borrow their argument"),
    };
    Value::int(count as i128).map_err(Into::into)
}
