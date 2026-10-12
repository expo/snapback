//! The interpreter's spine: statements, expressions and builtins. Reads live
//! in `read.rs`, writes in `write.rs`; both are methods on `Runner`.

#[path = "extrema.rs"]
pub(crate) mod extrema;

use super::Context;
use crate::error::{MeterKind, RuntimeError};
use crate::ir::*;
use crate::meter::{Cut, Meter};
#[cfg(feature = "sqlite")]
use crate::partition::PendingEvents;
#[cfg(feature = "sqlite")]
use std::collections::HashMap;
use crate::schema::Schema;
use crate::rows::Rows;
use crate::value::{Value, ValueError, canonical_json, object};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

// Only this evaluator can manufacture expression-pricing authority. Store
// rows must pass project_row before entering its environment or result values.
pub(crate) struct ExpressionAccess(());

/// Minted only at the runner boundary; Context is data, never pricing authority.
pub(crate) struct SystemAccess(());
impl Runner<'_> {
    pub(super) fn system_access(&self) -> Option<SystemAccess> {
        self.context.is_system().then_some(SystemAccess(()))
    }
}
pub(super) fn expression_heap(value: &Value) -> u64 { value.expression_heap(ExpressionAccess(())) }
pub(super) fn expression_copy(value: &Value) -> u64 { value.expression_copy(ExpressionAccess(())) }

#[derive(Clone, Debug)]
pub(super) enum Flow {
    Next,
    Break,
    Continue,
    Return(Value),
}

/// What a commit's retirement of its already-expired births
/// (`retire_expired_births`) shares across the rows it removes.
#[cfg(feature = "sqlite")]
#[derive(Default)]
pub(crate) struct Retiring {
    /// Net aggregate changes by (target, canonical key), applied once at the
    /// end: the order of removal must not reach a total no commit would hold.
    pub(crate) aggregates: BTreeMap<(String, String), (Vec<Value>, i128)>,
    /// Whether an audience key keeps a live row, by (table, group index,
    /// canonical key). Removing expired rows cannot change the answer, so each
    /// key is scanned once.
    pub(crate) live_keys: HashMap<(String, String, String), bool>,
}

/// One evaluated cursor-bearing page; the return plan selects its owner.
#[derive(Clone, Debug)]
pub(crate) struct PagePosition {
    pub variant: Option<crate::ir::VariantId>,
    pub view_suffix: Option<Vec<crate::cursor::CursorColumn>>,
    pub table: String,
    pub index: String,
    pub order: Order,
    pub prefix_len: usize,
    pub prefix: Option<Vec<Value>>,
    pub merge: bool,
    /// A collector exited with rows still unconsumed, even on a short page.
    pub interrupted: bool,
    /// Raw continuation candidate; outcome publication applies the final read class.
    pub next: Option<Vec<Value>>,
    pub inclusive: bool,
    pub shape_positions: Vec<Vec<Value>>,
    pub(super) shape_resume: super::shaping::Resume,
}

pub struct Runner<'a> {
    #[cfg(feature = "sqlite")]
    pub(super) following_witnesses: Option<Vec<super::following_history::projection::Witness>>,
    #[cfg(feature = "sqlite")]
    pub(super) job_read_scope: u8,
    pub(super) receipt_operation: String,
    pub(super) receipt_allocation: bool,
    #[cfg(feature = "sqlite")]
    pub(super) delivery: super::delivery::Tracking,
    pub(crate) tx: super::authorized_scan::GuardedRows<'a>,
    pub(crate) schema: &'a Schema,
    pub(crate) context: Context,
    pub(crate) meter: Meter,
    /// Prediction-only authority work has its own allowance. None on queries
    /// and while that allowance is active (nested checks share the same meter).
    pub(super) device_allowance: Option<Meter>,
    pub(super) device_work_active: bool,
    /// Caller ceiling and public reservations inside a restoring rule scope.
    /// Private internal charges never advance this public admission ledger.
    pub(super) caller_heap_ceiling: Option<(u64, u64)>,
    pub(crate) env: BTreeMap<String, Value>,
    pub(crate) consts: BTreeSet<String>,
    /// Program-only use counts; None keeps standalone/raw statement callers conservative.
    pub(super) insert_uses: Option<BTreeMap<String, u8>>,
    /// Rows this transaction inserted, by (table, index, encoded key).
    pub(crate) created: BTreeMap<(String, String, String), usize>,
    /// Current facts owned by each row inserted in this execution. Distinct
    /// rows can share a key; counts preserve their independent ownership.
    pub(crate) created_rows: BTreeMap<(String, String), Vec<(String, String, String)>>,
    pub(crate) inserted: Vec<(String, Value)>,
    /// Images written during this execution, including reads inside prediction.
    pub(super) provisional_rows: BTreeSet<(String, String)>,
    /// Sticky after consuming an unsettled ordinal: aliases and control flow
    /// can carry that dependency into a later refusal.
    pub(super) provisional_sequence_read: bool,
    /// Tables read and tables written, for live subscriptions and commits.
    pub(crate) read_tables: BTreeSet<String>,
    pub(crate) written_tables: BTreeSet<String>,
    pub(crate) rows_written: u64,
    pub(crate) next_expiry: super::expiry::Expiry,
    pub(super) witness_cache: Option<(super::read::WitnessKey, (bool, bool, Option<i64>))>,
    pub(super) witness_changes: Option<Vec<(i64, super::rules::Verdict)>>,
    /// Partition events, accumulated for the commit; a logless host builds none.
    #[cfg(feature = "sqlite")]
    pub(crate) events: PendingEvents,
    /// Synced rows this commit inserted, by (table, id), and grants it newly
    /// made, by (partition, content table, group), each with the number of
    /// its events logged before its birth (a row deleted and re-inserted, a
    /// grant revoked and re-made). What was born and undone before the
    /// commit ends existed at no commit boundary, so only those earlier
    /// events stay.
    #[cfg(feature = "sqlite")]
    pub(crate) born_rows: HashMap<(String, String), usize>,
    #[cfg(feature = "sqlite")]
    pub(crate) born_grants: HashMap<(String, String, String), usize>,
    /// Synced rows that existed before this commit and changed in it: the
    /// number of their events logged before the first change, and the
    /// partitions they were in at the commit's start. Every later change is
    /// accounted from that boundary, so a partition the row only passed
    /// through inside the commit is sent neither its image nor its id.
    #[cfg(feature = "sqlite")]
    pub(crate) touched_rows: HashMap<(String, String), (usize, std::collections::BTreeSet<String>)>,
    /// Set only while a commit retires the rows it inserted already expired.
    #[cfg(feature = "sqlite")]
    pub(crate) retiring: Option<Retiring>,
    /// Queued effects with their grace dependencies.
    pub(crate) outbox: Vec<super::presence::Emission>,
    pub(super) effect_presence: super::presence::EffectPresence,
    /// How deep inside page loops the runner is; a scan at depth 0 may own
    /// the program's `next`.
    pub(crate) search_rows: Option<Value>,
    pub(crate) decoration_expiry: Option<i64>,
    pub(crate) retained_seen: bool,
    pub(super) decoration_cache: Option<BTreeMap<(String, String, Vec<u8>), Value>>,
    pub(crate) page_depth: usize,
    pub(crate) page: Option<PagePosition>,
    pub(crate) pages: BTreeMap<String, PagePosition>,
    /// Matching scopes share one validated cursor image within a query.
    /// Validated view position translated to one source index, scoped to its scan.
    pub(super) view_seek: Option<(String, crate::cursor::CursorPosition)>,
    /// Projected source scans pay for fetched payloads before discarding fields.
    pub(super) view_scan_active: bool,
    /// The grant verdict that admitted the branch-merge lane being read.
    pub(super) merge_grant: Option<super::expiry::Pending>,
    /// Armed by a branch merge around a lane's read with the lane's table and
    /// index: the key of the last rule-visible candidate that read examined.
    pub(super) scan_frontier: Option<(String, String, Option<Vec<u8>>)>,
    pub(super) word_cursor: Option<(String, crate::cursor::CursorPosition)>,
    /// Loss from replaced executions cannot be repaired by a later page.
    pub(super) discarded_page_loss: bool,
    pub(super) page_owner: Option<String>,
    pub(super) page_plan: super::pages::Plan,
    #[cfg(feature = "server-search")]
    pub(super) ordinary_search_cursor: Option<(String, String)>,
    #[cfg(feature = "server-search")]
    pub(super) search_scopes: Option<Vec<String>>,
    /// Read paths that actually stopped on a cap, including an inherited cap.
    pub(super) read_cuts: u64,
    pub(super) shape_positions: BTreeMap<String, super::shaping::ShapePosition>,
    /// Evaluated input cursors of returned shape sources, keyed by read site.
    pub(super) shape_cursors: BTreeMap<String, String>,
    /// Whether a scan ran whose read rule the prefix does not decide. Such a
    /// result is `capped` whatever the meter found (LLP 1001 §3): a page
    /// that was `complete` only when few hidden rows were walked would
    /// count them.
    pub(crate) non_uniform: bool,
    pub(super) scalar_unavailable: bool,
    /// An interrupted evaluation's null placeholder is not an application value.
    pub(crate) query_unavailable: bool,
    /// A lane-discovery source was truncated before all values were known.
    /// Declared answer bounds do not set this (LLP 3000.027 §2).
    pub(crate) page_overflow: bool,
    pub(super) discovering_values: bool,
    pub(super) value_source_incomplete: bool,
    pub(super) receipt_pending_groups: BTreeMap<String, Option<Vec<Vec<Value>>>>,
    pub(crate) timeline_pending: bool,
    /// First scope whose word expansion exceeded 32; incomplete, without
    /// stopping later lanes or setting the query's meter cut.
    pub(crate) word_cut_at: Option<String>,
    /// Running on a device over its partition (`engine::local`):
    /// delivered rows are trusted; provisional images need current read
    /// authority. Online-only and horizon reads may need the server.
    pub(crate) device: bool,
    pub(super) query_program: bool,
    /// Prediction deduplicates keys within this attempt, never in the server ledger.
    pub(super) effect_once_keys: BTreeSet<String>,
    pub(crate) event_free: bool,
    #[cfg(feature = "sqlite")]
    pub(super) column_rebuild: bool,
    #[cfg(feature = "sqlite")]
    pub(super) rebuilt_source_rows: u64,
    #[cfg(feature = "sqlite")]
    pub(super) count_version: Option<(String, String)>,
    #[cfg(feature = "sqlite")]
    pub(super) recount_budget: Option<(std::time::Instant, std::time::Duration)>,
    #[cfg(feature = "sqlite")]
    pub(crate) import_targets: Option<&'a BTreeMap<(String, String), Value>>,
    /// The device touched an online-only table or a horizon: `complete: false`.
    pub(crate) beyond_horizon: bool,
    pub(crate) missing_fact: Option<String>,
    pub(super) components: super::components::Frames,
    pub(super) component_observation: bool,
    /// Reads inside a where filter share the query's rule-probe budget.
    pub(crate) filter_depth: u32,
    /// The program read `connected[p]` where no registry answers (a
    /// device): a query's result is not `complete`; the compiled execution
    /// fact excludes a mutation with this site from prediction.
    pub(crate) presence_unknown: bool,
    /// Principals whose `connected[p]` this run read on a server, with the
    /// count it saw: read once per run, so every read agrees (LLP 3000.018 §3.1).
    pub(crate) presence_read: BTreeMap<String, u64>,
    /// The sequence this run will commit as (a query reads at `seq`).
    #[allow(dead_code)]
    pub(crate) seq: u64,
    pub(crate) statement_site: String,
    pub(crate) evaluating_write_condition: bool,
    prediction_guards: BTreeSet<String>,
    pub(super) prediction_skips: BTreeSet<String>,
    pub(super) discard_effects: bool,
    /// The prediction paid for an untaken presence arm the server may skip.
    pub(crate) charged_untaken: bool,
    pub(crate) maintain_prepaid: bool,
    /// Tables a delete's referential actions may write (LLP 3000.039 §4.2):
    /// their events are not counted in the reply.
    pub(crate) action_tables: BTreeSet<String>,
    /// The engine's own write for a referential action is running: it
    /// consults no rule of the row it writes (LLP 3000.039 §4.1).
    pub(crate) engine_action: bool,
    pub(crate) capture_prepaid: bool,
    pub(crate) maintain_heap: u64,
    pub(super) timeline_authority: Option<super::timeline_authority::Authority>,
    #[cfg(feature = "server-search")]
    pub(super) compact_memberships: usize,
    pub(crate) column_heap: u64,
    pub(crate) reservation_deferred: bool,
    pub(crate) column_prepaid: bool,
    #[cfg(feature = "sqlite")]
    pub(super) assets_prepaid: bool,
}

impl<'a> Runner<'a> {
    pub(super) fn measured_expr(&mut self, expr: &Expr) -> Result<(Value, u64), RuntimeError> {
        let value = self.expr(expr)?;
        let bytes = expression_heap(&value);
        Ok((value, bytes))
    }
    pub(super) fn environment_value_copy_heap(&self, name: &str) -> u64 { self.env.get(name).map_or(0, |v| v.expression_copy(ExpressionAccess(()))) }
    pub(super) fn expr_input(&mut self, expr: &Expr) -> Result<crate::value::Supplied,RuntimeError> {
        Ok(self.expr(expr)?.expression_input(ExpressionAccess(())))
    }
    pub(super) fn environment_heap(&self) -> u64 { self.env.values().map(expression_heap).sum() }
    pub(super) fn component_object(&mut self, fields: super::components::EvaluatedFields) -> Result<Value, RuntimeError> {
        let row = fields.into_value();
        self.meter.heap(expression_heap(&row))?;
        Ok(row)
    }

    // @ref LLP 3000.007#5.6 — non-uniform server work depends on hidden populations; its cut reason must stay private too.
    pub(crate) fn read_cut(&self) -> Option<super::ReadCut> {
        if self.non_uniform && !self.device { None }
        else if self.meter.capped_at.is_some() { Some(super::ReadCut::Meter) }
        else if self.word_cut_at.is_some() { Some(super::ReadCut::Words) }
        else { None }
    }

    pub fn new(tx: &'a dyn Rows, schema: &'a Schema, context: Context, meter: Meter, seq: u64) -> Self {
        let mut env = BTreeMap::new();
        for (name, value) in &context.args {
            env.insert(name.clone(), value.clone());
        }
        Self {
            #[cfg(feature = "sqlite")]
            job_read_scope: 0,
            receipt_operation: String::new(),
            #[cfg(feature = "sqlite")]
            following_witnesses: None,
            receipt_allocation: false,
            #[cfg(feature = "sqlite")]
            delivery: Default::default(),
            tx: super::authorized_scan::GuardedRows::new(tx),
            schema,
            context,
            meter,
            device_allowance: None,
            device_work_active: false,
            caller_heap_ceiling: None,
            env,
            consts: BTreeSet::new(),
            created: BTreeMap::new(),
            created_rows: BTreeMap::new(),
            inserted: Vec::new(),
            provisional_rows: BTreeSet::new(),
            provisional_sequence_read: false,
            read_tables: BTreeSet::new(),
            written_tables: BTreeSet::new(),
            rows_written: 0,
            next_expiry: Default::default(),
            witness_cache: None,
            witness_changes: None,
            #[cfg(feature = "sqlite")]
            events: PendingEvents::default(),
            #[cfg(feature = "sqlite")]
            born_rows: HashMap::new(),
            #[cfg(feature = "sqlite")]
            born_grants: HashMap::new(),
            #[cfg(feature = "sqlite")]
            touched_rows: HashMap::new(),
            #[cfg(feature = "sqlite")]
            retiring: None,
            outbox: Vec::new(),
            effect_presence: Default::default(),
            search_rows: None,
            decoration_expiry: None,
            retained_seen: false,
            decoration_cache: None,
            page_depth: 0,
            page: None,
            pages: BTreeMap::new(),
            word_cursor: None,
            view_seek: None,
            view_scan_active: false,
            merge_grant: None,
            scan_frontier: None,
            discarded_page_loss: false,
            page_owner: None,
            page_plan: super::pages::Plan::default(),
            #[cfg(feature = "server-search")]
            ordinary_search_cursor: None,
            #[cfg(feature = "server-search")]
            search_scopes: None,
            read_cuts: 0,
            shape_positions: BTreeMap::new(),
            shape_cursors: BTreeMap::new(),
            non_uniform: false,
            scalar_unavailable: false,
            query_unavailable: false,
            page_overflow: false,
            discovering_values: false,
            value_source_incomplete: false,
            receipt_pending_groups: BTreeMap::new(),
            timeline_pending: false,
            word_cut_at: None,
            device: false,
            query_program: false,
            effect_once_keys: BTreeSet::new(),
            event_free: false,
            #[cfg(feature = "sqlite")]
            column_rebuild: false,
            #[cfg(feature = "sqlite")]
            rebuilt_source_rows: 0,
            #[cfg(feature = "sqlite")]
            count_version: None,
            #[cfg(feature = "sqlite")]
            recount_budget: None,
            #[cfg(feature = "sqlite")]
            import_targets: None,
            beyond_horizon: false,
            missing_fact: None,
            components: Default::default(),
            component_observation: false,
            filter_depth: 0,
            presence_unknown: false,
            presence_read: BTreeMap::new(),
            seq,
            statement_site: String::new(),
            evaluating_write_condition: false,
            prediction_guards: BTreeSet::new(),
            prediction_skips: BTreeSet::new(),
            insert_uses: None,
            discard_effects: false,
            charged_untaken: false,
            maintain_prepaid: false,
            action_tables: BTreeSet::new(),
            engine_action: false,
            capture_prepaid: false,
            maintain_heap: 0,
            timeline_authority: None,
            column_heap: 0,
            reservation_deferred: false,
            #[cfg(feature = "server-search")]
            compact_memberships: 0,
            column_prepaid: false,
            #[cfg(feature = "sqlite")]
            assets_prepaid: false,
        }
    }

    pub fn run(&mut self, program: &Program) -> Result<Value, RuntimeError> {
        if let Some(value) = self.run_decorated_search(program)? { return Ok(value); }
        self.insert_uses = (program.kind != ProgramKind::Query).then(|| effects::Effects::variable_uses(&program.body));
        self.receipt_operation = program.name.clone();
        self.prepare_components(program);
        self.page_plan = super::pages::plan(program, self.schema, self.tx.prefetch_enabled());
        self.prediction_guards = self.schema.operations.get(&program.name)
            .filter(|fact| self.device && fact.connected_effects_only && fact.predicts.as_deref() == Some("eligible"))
            .map(|fact| fact.prediction_guards.iter().cloned().collect()).unwrap_or_default();
        self.query_program = program.kind == ProgramKind::Query;
        self.prediction_skips = self.schema.operations.get(&program.name)
            .filter(|fact| self.device && program.kind == ProgramKind::Mutation && fact.predicts.as_deref() == Some("eligible"))
            .map(|fact| fact.prediction_skips.iter().cloned().collect()).unwrap_or_default();
        // @ref LLP 3000.007#5.0 — charge allocations before admitting the relaxed forms.
        // A heap or maintained-value cut cannot invent a scalar/shape or a
        // continuation. Keep the internal null placeholder and private meter
        // detail, but mark it unavailable so transports cannot publish ready null.
        let result = (|| {
            self.prepare_effect_presence(program)?;
            for value in self.context.args.values() { self.meter.heap(value.expression_copy(ExpressionAccess(())))?; }
            self.statements(&program.body, &program.name)
        })();
        if let Err(RuntimeError::AuthorizationBudget { table, effect }) = &result {
            self.trace_unlocated_budget(table, *effect);
        }
        // @ref LLP 3000.024#decision — the page plan follows the generated
        // result binding through return. Keep the final copy charge, and use
        // the original IR only on refusal rather than cloning it per execution.
        #[cfg(feature = "server-search")]
        if matches!(result, Err(RuntimeError::Bound { kind: MeterKind::HeapBytes, .. }))
            && let Some(returned) = self.page_plan.returns.get(&self.statement_site)
            && let Some(Some(count)) = self.page_plan.compact.get(&returned.page)
            && let Some(merge) = crate::search_plan::merges(&program.body).into_iter().find(|merge| merge.site == returned.page) {
            return Err(self.opening_error(merge, *count, true));
        }
        match result {
            Ok(Flow::Return(value)) => Ok(value),
            Ok(_) => Ok(Value::Null),
            Err(RuntimeError::Bound { kind, .. }) if self.meter.cut == Cut::Cap
                && (kind == MeterKind::HeapBytes || self.meter.capped_at.as_ref().is_some_and(|cut| cut.0 == kind)) => {
                self.page = None;
                self.query_unavailable = true;
                Ok(Value::Null)
            }
            Err(RuntimeError::Prediction(_)) if self.meter.cut == Cut::Cap && self.scalar_unavailable => {
                self.page = None;
                self.query_unavailable = true;
                Ok(Value::Null)
            }
            Err(error) => Err(error),
        }
    }

    /// Logical work charged so far, including a refused transaction.
    pub fn metered(&self) -> crate::meter::Metered { self.meter.used }

    pub(super) fn statements(&mut self, statements: &[Stmt], prefix: &str) -> Result<Flow, RuntimeError> {
        for (index, statement) in statements.iter().enumerate() {
            let (previous, capped, component_return) = self.begin_component(index);
            let result = (|| {
            self.effect_presence.reads.clear();
            let site = format!("{prefix}:{}", index + 1);
            // @ref LLP 3000.013#12.3 — infallible effect-payload reads and their
            // exclusive bindings use actual-value server fees. Omitted payloads
            // can exhaust the server meter after prediction (the documented
            // exception); once-key charges still run on both hosts.
            if self.prediction_skips.contains(&site) {
                if let Stmt::Emit { effect, once, .. } = statement { self.effect_once(effect, once.as_ref())?; }
                return Ok(Flow::Next);
            }
            if matches!(statement, Stmt::Insert { .. } | Stmt::InsertIfAbsent { .. } | Stmt::Update { .. } | Stmt::Upsert { .. } | Stmt::WriteTarget { .. } | Stmt::Delete { .. } | Stmt::DeleteTarget { .. } | Stmt::Emit { .. }) { self.refuse_condition_write()?; }
            self.statement_site = site.clone();
            self.meter.at(&site);
            self.meter.step(1)?;
            let flow = match statement {
                Stmt::Const { name, value } => {
                    let value = self.binding_expr(value)?;
                    self.bind_effect_value(name, value)?;
                    self.consts.insert(name.clone());
                    Flow::Next
                }
                Stmt::Let { name, value } | Stmt::Assign { name, value } => {
                    if matches!(statement, Stmt::Assign { .. }) && self.consts.contains(name) {
                        return Err(RuntimeError::Input(format!("cannot assign to const binding {name}")));
                    }
                    let value = self.binding_expr(value)?;
                    self.bind_effect_value(name, value)?;
                    Flow::Next
                }
                Stmt::Push { target, value } => {
                    let value = self.expr(value)?;
                    self.meter.heap(expression_heap(&value) + std::mem::size_of::<Value>() as u64)?;
                    self.push_presence_value(target)?;
                    match self.env.get_mut(target) {
                        Some(Value::Array(values)) => values.push(value),
                        Some(other) => return Err(ValueError::Type { expected: "array", actual: other.kind() }.into()),
                        None => return Err(missing_variable(target, &self.statement_site)),
                    }
                    Flow::Next
                }
                Stmt::If { condition, then_body, else_body } => {
                    let actual = self.expr(condition)?.as_bool()?;
                    let take_then = self.presence_arm(&site, actual);
                    #[cfg(not(target_arch = "wasm32"))]
                    let restore = (take_then != actual).then(|| super::presence::short_target(condition, then_body, else_body)).flatten();
                    let (branch, arm, untaken, other) = if take_then { (then_body, "then", else_body, "else") } else { (else_body, "else", then_body, "then") };
                    let guard = self.enter_presence_guard(&site, take_then)?;
                    if self.prediction_guards.contains(&site) { self.charge_untaken(untaken, &format!("{site}:{other}"))?; }
                    let result = self.statements(branch, &format!("{site}:{arm}"));
                    self.effect_presence.guard = guard;
                    #[cfg(not(target_arch = "wasm32"))]
                    if let Some(name) = restore {
                        if let Some(value) = self.effect_presence.variables.get_mut(name) {
                            value.absent = value.absent.or_else(|| self.env.get(name).and_then(super::presence::Scalar::of));
                        }
                        *self.env.get_mut(name).unwrap() = Value::Bool(actual);
                    }
                    result?
                }
                Stmt::For { binding, domain, body } => {
                    #[cfg(feature = "sqlite")]
                    if let LoopDomain::DerivedArray { value: Expr::Builtin { builtin: Builtin::JobQuery { program, cursor, all: true }, args }, .. } = domain {
                        if self.device { return Err(RuntimeError::Input("job viewer reads require a server job scope".into())); }
                        return self.job_query_rows(program, cursor.as_deref(), args, binding, body, &site);
                    }
                    let mut values = self.domain(domain)?;
                    let is_page = matches!(domain, LoopDomain::Page(_) | LoopDomain::Recurse(_));
                    if is_page {
                        self.page_depth += 1;
                    }
                    let shape = self.page_plan.shapes.get(&site).cloned();
                    self.shape_positions.remove(&site);
                    let mut row_index = 0;
                    let mut result = Flow::Next;
                    while let Some(value) = values.next() {
                        if matches!(domain, LoopDomain::LiteralRange { .. } | LoopDomain::ExpressionRange { .. }) { self.meter.step(1)?; }
                        self.bind(binding, value);
                        let cut_mark = self.read_cuts;
                        let inherited_cap = self.meter.capped_at.is_some();
                        let lengths = shape.as_ref().map(|shape| self.shape_lengths(shape));
                        let flow = self.statements(body, &site);
                        if let Some(shape) = &shape
                            && self.shape_starved(cut_mark, &flow) {
                            self.trim_shape(&site, shape, row_index, lengths.as_deref().unwrap(), inherited_cap);
                            break;
                        }
                        let flow = flow?;
                        row_index += 1;
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
                Stmt::Require { condition, code, site: authored, message } => {
                    if !self.expr(condition)?.as_bool()? {
                        return Err(RuntimeError::Require { code: code.clone(), site: authored.clone().or(Some(site)), message: message.clone() });
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
                    let consumed = self.insert_uses.as_ref().is_none_or(|uses| uses.contains_key(result));
                    if consumed {
                        let value = if self.insert_if_absent(table, row.clone().expression_input(ExpressionAccess(())))? { self.sequence_result(table, row)? } else { Value::Null };
                        self.bind(result, value);
                    } else {
                        self.insert_if_absent(table, row.expression_input(ExpressionAccess(())))?;
                    }
                    Flow::Next
                }
                Stmt::Insert { table, row } => {
                    let image = self.expr(row)?;
                    // @ref LLP 3000.007#5.4 — the compiler also creates a
                    // temporary for discarded inserts; only another use demands its result.
                    let consumed = matches!(row, Expr::Variable(name) if self.insert_uses.as_ref().is_none_or(|uses| uses.get(name).copied().unwrap_or(0) > 1));
                    if !consumed || !self.needs_insert_result(table, &image) {
                        self.insert(table, image.expression_input(ExpressionAccess(())))?;
                    } else {
                        // @ref LLP 3000.007#5.4 — the Arc clone shares this image;
                        // result completion prepays the actual field-map copy.
                        self.insert(table, image.clone().expression_input(ExpressionAccess(())))?;
                        // A bound insert keeps its engine-filled image in the result local.
                        if let Expr::Variable(name) = row {
                            let result = self.sequence_result(table, image)?;
                            self.bind(name, result);
                        }
                    }
                    Flow::Next
                }
                Stmt::Update { table, key, patch } => {
                    let key = self.expr(key)?;
                    let patch = self.expr(patch)?;
                    self.update(table, &key, patch.expression_input(ExpressionAccess(())))?;
                    Flow::Next
                }
                Stmt::Upsert { table, key, row } => {
                    let key = self.expr(key)?;
                    let row = self.expr(row)?;
                    self.upsert(table, &key, row.expression_input(ExpressionAccess(())))?;
                    Flow::Next
                }
                Stmt::WriteTarget { target, patch, upsert, condition, result } => {
                    let value = self.write_target(target, patch, *upsert, condition.as_ref(), result.is_some())?;
                    if let Some(name) = result { self.meter.heap(expression_heap(&value))?; self.bind(name, value); }
                    Flow::Next
                }
                Stmt::DeleteTarget { target } => { self.delete_target(target)?; Flow::Next }
                Stmt::Delete { table, key } => {
                    let key = self.expr(key)?;
                    self.delete(table, key.as_str()?)?;
                    Flow::Next
                }
                Stmt::Emit { effect, payload, once } => {
                    let payload = self.expr(payload)?;
                    if !self.schema.effects.iter().any(|e| e == effect) {
                        return Err(RuntimeError::Schema(format!("unknown effect {effect}")));
                    }
                    if !self.effect_once(effect, once.as_ref())? { return Ok(Flow::Next); }
                    let presence = self.emission_presence()?;
                    if !self.discard_effects {
                        let id = format!("effect-{:016x}-{:016x}", self.seq, self.outbox.len());
                        self.outbox.push((id, effect.clone(), payload, presence));
                    }
                    Flow::Next
                }
                Stmt::Return(value) => {
                    let result = match value {
                        Expr::Object(fields) if component_return => self.component_record(fields, value),
                        _ => self.expr(value),
                    };
                    // A nested expression can change statement_site. Preserve
                    // this return's origin when its final copy unwinds to run().
                    #[cfg(feature = "server-search")]
                    if matches!(result, Err(RuntimeError::Bound { kind: MeterKind::HeapBytes, .. })) {
                        self.statement_site = site;
                        return result.map(Flow::Return);
                    }
                    let value = result?;
                    let returned = self.page_plan.returns.get(&site);
                    self.page_owner = returned.map(|returned| returned.page.clone());
                    let shaped = returned.into_iter().flat_map(|returned| &returned.shapes)
                        .filter_map(|shape| self.shape_positions.get(shape)).min_by_key(|position| position.rows);
                    self.page = self.page_owner.as_ref().and_then(|owner| self.pages.get(owner)).map(|page| PagePosition {
                        variant: page.variant,
                        view_suffix: page.view_suffix.clone(),
                        table: page.table.clone(), index: page.index.clone(), order: page.order, prefix_len: page.prefix_len,
                        prefix: page.prefix.clone(), merge: page.merge, interrupted: page.interrupted,
                        next: shaped.map_or_else(|| page.next.clone(), |position| position.next.clone()),
                        inclusive: shaped.map_or(page.inclusive, |position| position.inclusive), shape_positions: Vec::new(), shape_resume: page.shape_resume,
                    });
                    Flow::Return(value)
                },
                Stmt::Break => Flow::Break,
                Stmt::Continue => Flow::Continue,
            };
            Ok(flow)
            })();
            self.end_component(previous, capped);
            let flow = result?;
            if !matches!(flow, Flow::Next) {
                return Ok(flow);
            }
        }
        Ok(Flow::Next)
    }

    // @ref LLP 3000.013#5.3 — runtime key charges are identical on both
    // hosts; only the authoritative host claims durable keys.
    fn effect_once(&mut self, effect: &str, once: Option<&Expr>) -> Result<bool, RuntimeError> {
        let Some(expr) = once else { return Ok(true); };
        let key = self.expr(expr)?;
        key.as_array()?;
        self.reservation_deferred |= self.device;
        self.meter.step(1)?;
        let encoded = canonical_json(&Value::Array(vec![Value::String(effect.into()), key]));
        self.meter.heap(encoded.len() as u64)?;
        let inserted = if self.device || self.discard_effects { self.effect_once_keys.insert(encoded) }
            else { self.tx.effect_once(effect, &encoded)? };
        if inserted {
            self.meter.charge(MeterKind::RowsWritten, 1)?;
            self.rows_written += 1;
        }
        Ok(inserted)
    }

    fn binding_expr(&mut self, expression: &Expr) -> Result<Value, RuntimeError> {
        let value = self.expr(expression)?;
        let charged = self.meter.heap(expression_heap(&value));
        // @ref LLP 3000.024#decision — Quarry's search conditional binds the
        // merge result before returning it. That reservation still belongs to
        // the compact page and must not turn its buffered hits into heap-null.
        #[cfg(feature = "server-search")]
        if matches!(charged, Err(RuntimeError::Bound { kind: MeterKind::HeapBytes, .. }))
            && let Expr::Merge(merge) = expression
            && !self.device && self.query_program && crate::search_plan::eligible(self.schema, merge) {
            return Err(self.opening_error(merge, self.compact_memberships, true));
        }
        charged?;
        Ok(value)
    }

    pub(super) fn bind(&mut self, name: &str, value: Value) {
        #[cfg(feature = "sqlite")]
        self.clear_delivery_variable(name);
        self.effect_presence.variables.remove(name);
        self.env.insert(name.to_owned(), value);
    }

    pub(super) fn domain(&mut self, domain: &LoopDomain) -> Result<Box<dyn Iterator<Item = Value>>, RuntimeError> {
        let values = match domain {
            LoopDomain::Page(scan) => {
                // @ref LLP 3000.013#5.2 — uncapped inner job domains must pay before decoding/retaining each row, not after materializing a whole page.
                let prepaid = scan.take == Bound::Meter && self.meter.cut == Cut::Abort
                    && !scan.prefix.iter().any(|key| matches!(key, IndexKeyExpr::WordPrefix(_)));
                let values = if prepaid { self.metered_domain(scan)? } else { self.scan(scan)? };
                #[cfg(feature = "postgres")]
                self.page_plan.prefetch.fill(&scan.site, &values, &self.context, self.schema, &self.tx);
                if !prepaid { self.meter.heap(values.capacity() as u64 * std::mem::size_of::<Value>() as u64 + values.iter().map(expression_heap).sum::<u64>())?; }
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
                self.meter.heap(value.expression_copy(ExpressionAccess(())))?;
                let values = value.as_array()?.to_vec();
                if values.len() > *max as usize {
                    return Err(RuntimeError::Fanout);
                }
                Ok(values)
            }
            LoopDomain::DerivedArray { value, max, .. } => {
                #[cfg(feature = "postgres")]
                let site = self.statement_site.clone();
                let values = into_array(self.expr(value)?)?;
                if values.len() > *max as usize {
                    return Err(RuntimeError::Fanout);
                }
                #[cfg(feature = "postgres")]
                self.page_plan.prefetch.fill(&site, &values, &self.context, self.schema, &self.tx);
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
            self.meter.heap(next.expression_copy(ExpressionAccess(())) + expression_heap(&row) + std::mem::size_of::<Value>() as u64)?;
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
        #[cfg(feature = "sqlite")]
        { self.delivery.last = None; }
        #[cfg(not(target_arch = "wasm32"))]
        { self.effect_presence.absent = None; }
        let result = self.presence_expr(expression);
        #[cfg(not(target_arch = "wasm32"))]
        if !matches!(expression, Expr::Variable(_) | Expr::Binary { .. } | Expr::Unary { op: UnaryOp::Not, .. } | Expr::Builtin { builtin: Builtin::Connected, .. }) {
            self.effect_presence.absent = None;
        }
        #[cfg(feature = "sqlite")]
        if !matches!(expression, Expr::Variable(_) | Expr::Field { .. } | Expr::Block { .. } | Expr::Builtin { builtin: Builtin::OptionalField { .. }, .. }) { self.delivery.last = None; }
        result
    }

    fn presence_expr(&mut self, expression: &Expr) -> Result<Value, RuntimeError> {
        self.meter.step(1)?;
        self.read_presence_value(expression)?;
        match expression {
            Expr::Literal(value) => {
                self.meter.heap(value.expression_copy(ExpressionAccess(())))?;
                Ok(value.clone())
            }
            Expr::Variable(name) => {
                #[cfg(feature = "sqlite")]
                self.delivery_variable(name);
                #[cfg(not(target_arch = "wasm32"))]
                { self.effect_presence.absent = self.effect_presence.variables.get(name).and_then(|v| v.absent); }
                let value = self.env.get(name).ok_or_else(|| missing_variable(name, &self.statement_site))?;
                self.meter.heap(value.expression_copy(ExpressionAccess(())))?;
                Ok(value.clone())
            }
            Expr::Input(input) => self.input(*input),
            Expr::Field { base, name } => {
                if let Some((base, steps)) = borrowed(&self.env, base, &self.statement_site)? {
                    self.meter.step(steps)?;
                    if *base == Value::Null { return Ok(Value::Null); }
                    self.provisional_sequence_read |= self.sequence_field_is_provisional(base, name)?;
                    #[cfg(feature = "sqlite")]
                    { if let Value::Row(fields) | Value::Map(fields) = base { self.delivery.field(fields, name); } }
                    let value = base.field(name)?;
                    self.meter.heap(value.expression_copy(ExpressionAccess(())))?;
                    return Ok(value.clone());
                }
                let base = self.expr(base)?;
                match base {
                    Value::Null => Ok(Value::Null),
                    other => {
                        self.provisional_sequence_read |= self.sequence_field_is_provisional(&other, name)?;
                        #[cfg(feature = "sqlite")]
                        self.delivery_field(&other, name);
                        let value = other.field(name)?;
                        self.meter.heap(value.expression_copy(ExpressionAccess(())))?;
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
                self.meter.heap(expression_heap(&value))?;
                Ok(value)
            }
            Expr::Shape { base, fields } => {
                // @ref LLP 3000.007#5.3 — shaping a device row preserves its own pending metadata.
                let base = self.expr(base)?;
                #[cfg(feature = "sqlite")]
                let (mut fields, origins) = self.delivery_fields(fields)?;
                #[cfg(not(feature = "sqlite"))]
                let mut fields: crate::value::ObjectFields = fields.iter().map(|(key, value)| Ok((key.clone(), self.expr(value)?))).collect::<Result<_, RuntimeError>>()?;
                // @ref LLP 3000.014#5 — retained history stays marked through projections.
                // A spread can merge multiple row bases. Application fields named
                // retained are ordinary data; only the reader creates provenance.
                let bases = if let Value::Array(bases) = &base { bases.as_slice() } else { std::slice::from_ref(&base) };
                fields.inherit_source(bases);
                #[cfg(feature = "sqlite")]
                self.project_delivery(&mut fields, origins);
                for base in bases {
                    if base.as_object()?.get("pending") == Some(&Value::Bool(true)) { fields.insert("pending".into(), Value::Bool(true)); }
                    if matches!(base, Value::Row(base) | Value::Map(base) if base.is_retained()) { fields.mark_retained(); }
                }
                let value = Value::Row(fields);
                self.meter.heap(expression_heap(&value))?;
                Ok(value)
            }
            Expr::Object(values) => {
                #[cfg(feature = "sqlite")]
                let value = {
                    let (mut fields, origins) = self.delivery_fields(values)?;
                    self.project_delivery(&mut fields, origins);
                    Value::Row(fields)
                };
                #[cfg(not(feature = "sqlite"))]
                let value = {
                    let fields = crate::small_map::try_collect(values.iter().map(|(key, value)| -> Result<_, RuntimeError> { Ok((key.clone(), self.expr(value)?)) }))?;
                    Value::Row(fields.into())
                };
                self.meter.heap(expression_heap(&value))?;
                Ok(value)
            }
            Expr::Binary { op, left, right } => {
                let left = self.expr(left)?;
                #[cfg(not(target_arch = "wasm32"))]
                let projected = self.effect_presence.absent;
                if *op == BinaryOp::And && !left.as_bool()? {
                    return Ok(Value::Bool(false));
                }
                if *op == BinaryOp::Or && left.as_bool()? {
                    return Ok(Value::Bool(true));
                }
                let right = self.expr(right)?;
                #[cfg(not(target_arch = "wasm32"))]
                self.presence_binary(*op, &left, projected, &right);
                binary(*op, left, right)
            }
            Expr::Unary { op, value } => {
                let value = self.expr(value)?;
                match op {
                    UnaryOp::Not => {
                        #[cfg(not(target_arch = "wasm32"))]
                        { self.effect_presence.absent = match self.effect_presence.absent { Some(super::presence::Scalar::Bool(b)) => Some(super::presence::Scalar::Bool(!b)), _ => None }; }
                        Ok(Value::Bool(!value.as_bool()?))
                    },
                    UnaryOp::Neg => Value::int(-(value.as_int()? as i128)).map_err(Into::into),
                }
            }
            Expr::Builtin { builtin, args } => {
                #[cfg(feature = "sqlite")]
                if self.device && matches!(builtin, Builtin::JobAs | Builtin::JobQuery { .. }) {
                    return Err(RuntimeError::Input("job viewer reads require a server job scope".into()));
                }
                #[cfg(feature = "sqlite")]
                match builtin {
                    Builtin::JobAs => return self.job_as(args),
                    Builtin::JobQuery { program, all: false, .. } => return self.job_query_value(program, args),
                    _ => {}
                }
                #[cfg(feature = "sqlite")]
                if matches!(builtin, Builtin::JobAs | Builtin::JobQuery { .. }) {
                    return Err(RuntimeError::Input("job viewer reads require a server job scope; use all(query(...)) only as a for domain".into()));
                }
                if let Builtin::Extremum { max, domain, .. } | Builtin::ExtremumOf { max, domain } = builtin {
                    if args.len() != builtin.arity() { return Err(RuntimeError::Input("min/max needs its source and projection".into())); }
                    let field = if let Builtin::Extremum { field, .. } = builtin { field.as_str() } else { "" };
                    return self.extremum(&args[0], field, args.get(1), *max, *domain);
                }
                if matches!(builtin, Builtin::Count | Builtin::Sum) && let Some(Expr::Scan(scan)) = args.first()
                    && (scan.take == Bound::Meter || scan.existence) && !scan.prefix.iter().any(|key| matches!(key, IndexKeyExpr::WordPrefix(_)))
                    && ((matches!(builtin, Builtin::Count) && args.len() == 1) || (matches!(builtin, Builtin::Sum) && args.len() == 2)) {
                    let result = self.stream_aggregate(scan, super::extrema::Aggregate::total(args.get(1)));
                    if matches!(&result, Err(RuntimeError::Bound { kind: MeterKind::Steps, .. })) && self.meter.cut == Cut::Cap {
                        self.meter.capped_at.get_or_insert((MeterKind::Steps, scan.site.clone()));
                    }
                    return result;
                }
                if args.len() != builtin.arity() && !(matches!(builtin, Builtin::Calendar { .. }) && args.len() == 2) {
                    return Err(RuntimeError::Input(format!("builtin {builtin:?} takes {} arguments, received {}", builtin.arity(), args.len())));
                }
                // Inspect a held value without allocating a copy just to count
                // it. Reads that need ownership still charge every actual clone.
                if matches!(builtin, Builtin::Len | Builtin::Count | Builtin::CountCapped | Builtin::Sum) {
                    if let Some((value, steps)) = borrowed(&self.env, &args[0], &self.statement_site)? {
                        self.meter.step(steps)?;
                        return scalar_builtin(builtin, value);
                    }
                }
                let args = args.iter().map(|value| self.expr(value)).collect::<Result<Vec<_>, _>>()?;
                self.builtin(builtin, args)
            }
            Expr::Get(read) => {
                let value = self.get(read)?;
                self.meter.heap(expression_heap(&value))?;
                Ok(value)
            }
            Expr::Exists(read) => {
                let value = self.get(read)?;
                // The private null-value aggregate result preserves scalar
                // denial versus authorized zero; it is not an existing row.
                Ok(Value::Bool(value != Value::Null && !(self.schema.maintain_for(&read.table).is_some() && value.field("value").ok() == Some(&Value::Null))))
            }
            Expr::Scan(scan) => {
                let values = self.scan(scan)?;
                self.meter.heap(values.iter().map(expression_heap).sum::<u64>())?;
                Ok(Value::Array(values))
            }
            Expr::Merge(merge) => {
                let values = self.merge(merge, |runner, values| runner.meter.heap(values.iter().map(expression_heap).sum::<u64>()))?;
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
                self.meter.heap(expression_heap(&value))?;
                Ok(value)
            }
            Input::ReadTime => self.context.read_time.map(Value::Int).ok_or_else(|| RuntimeError::Input("readTime is not pinned".to_owned())),
        }
    }

    fn builtin(&mut self, builtin: &Builtin, mut args: Vec<Value>) -> Result<Value, RuntimeError> {
        let result: Result<Value, RuntimeError> = match builtin {
            #[cfg(feature = "sqlite")]
            Builtin::JobAs | Builtin::JobQuery { .. } => unreachable!("job builtins dispatch before evaluating arguments"),
            Builtin::ExtremumOf { .. } | Builtin::Extremum { .. } => unreachable!("column extrema evaluate their source under scalar coverage"),
            Builtin::ReceiptSettled { table } => {
                // This primitive remains for settled-only query accounting.
                // Raw IR invoking it during prediction must keep queue custody.
                if self.device_allowance.is_some() {
                    return Err(RuntimeError::Prediction("receipt state needs server settlement".into()));
                }
                Ok(Value::Bool(!self.is_provisional(table, &args[0])?))
            },
            Builtin::ProjectFields { table } => {
                let row = args.remove(0);
                if row == Value::Null { Ok(row) } else {
                    let row = self.with_defaults(table, row.expression_input(ExpressionAccess(())))?.into_value();
                    self.project_row(table, row).map(|row| super::recorded::public_image(&self.schema.tables[table], row.into_value()))
                }
            }
            Builtin::OptionalField { field } => {
                #[cfg(feature = "sqlite")]
                self.delivery_field(&args[0], field);
                Ok(args[0].field(field).cloned().unwrap_or(Value::Null))
            },
            Builtin::Len | Builtin::Count | Builtin::CountCapped | Builtin::Sum => scalar_builtin(builtin, &args[0]),
            Builtin::Calendar { millis } => {
                if *millis <= 0 { return Err(RuntimeError::Input("calendar duration must be positive".into())); }
                let offset = args.get(1).map(Value::as_int).transpose()?.unwrap_or(0);
                if offset < 0 || offset >= *millis { return Err(RuntimeError::Input("calendar offset must be nonnegative and smaller than its period".into())); }
                Ok(Value::Int(crate::maintain::calendar_ordinal(args[0].as_int()?, *millis, offset)))
            }
            Builtin::Civil(function) => Ok(Value::Int(function.apply(args[0].as_int()?)?)),
            Builtin::Lower | Builtin::Trim => {
                let text = args[0].as_str()?;
                let value = Value::String(if matches!(builtin, Builtin::Lower) { text.to_lowercase() } else { text.trim().to_owned() });
                // @ref LLP 3000.007#5.3 — the small text library charges every new result to the heap meter.
                self.meter.heap(expression_heap(&value))?;
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
                self.meter.heap(expression_heap(&value))?;
                Ok(value)
            }
            Builtin::Group { field, optional } => {
                // @ref LLP 3000.007#5.3 — groups retain first-seen order; keys and the result are heap charged.
                let values = into_array(args.remove(0))?;
                let mut positions = BTreeMap::<String, usize>::new();
                let mut groups: Vec<(Value, Vec<Value>)> = Vec::new();
                for value in values {
                    self.meter.step(1)?;
                    let key = if *optional { value.field(field).unwrap_or(&Value::Null) } else { value.field(field)? }.clone();
                    let encoded = canonical_json(&key);
                    self.meter.heap(encoded.len() as u64 + key.expression_copy(ExpressionAccess(())))?;
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
                self.meter.heap(expression_heap(&value))?;
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
                        if !key.optional { value.field(&key.field)?; }
                    }
                }
                self.meter.step(values.len() as u64)?;
                values.sort_by(|left, right| {
                    keys.iter()
                        .find_map(|key| {
                            let mut order = left.field(&key.field).unwrap_or(&Value::Null).total_cmp(right.field(&key.field).unwrap_or(&Value::Null));
                            if key.order == Order::Desc {
                                order = order.reverse();
                            }
                            (order != Ordering::Equal).then_some(order)
                        })
                        .unwrap_or(Ordering::Equal)
                });
                Ok(Value::Array(values))
            }
            Builtin::SearchPresent => {
                let text = args[0].as_str()?;
                let mark = self.meter.mark();
                let present = !crate::rows::word_heap::tokenize_limit(&mut self.meter, [text], crate::words::MAX_TERMS)?.is_empty();
                self.meter.release_heap(mark);
                Ok(Value::Bool(present))
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
                self.meter.heap(recipients.capacity() as u64 * std::mem::size_of::<Value>() as u64 + recipients.iter().map(expression_heap).sum::<u64>())?;
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
                            let (live, deadline) = presence.effect_presence_at(principal, self.context.now.unwrap_or_default());
                            self.grace_read(principal, deadline)?;
                            #[cfg(not(target_arch = "wasm32"))]
                            if !self.device && live > 0 && deadline.is_some() { self.effect_presence.absent = Some(super::presence::Scalar::Count(0)); }
                            Value::int(live as i128).map_err(Into::into)
                        } else {
                            // @ref LLP 3000.018#3.1 — one run reads each principal once, so every read in an answer agrees; the memo is metered.
                            let open = match self.presence_read.get(principal) {
                                Some(open) => *open,
                                None => {
                                    self.meter.heap((principal.len() as u64).saturating_add(64))?;
                                    let open = presence.connections(principal);
                                    self.presence_read.insert(principal.to_owned(), open);
                                    open
                                }
                            };
                            Value::int(open as i128).map_err(Into::into)
                        }
                    },
                    None => {
                        // Nobody here knows: a device reads everyone as
                        // connected (the least speculative rows) and the
                        // server's answer replaces its prediction; `run`
                        // and tests read nobody as connected.
                        self.presence_unknown = true;
                        self.components.note(|frame| { frame.presence = true; frame.speculative = true; });
                        if self.effect_presence.enabled { self.grace_read(principal, None)?; }
                        Ok(Value::Int(if self.device { 1 } else { 0 }))
                    }
                }
            }
        };
        let value = result?;
        if matches!(builtin, Builtin::ProjectFields { .. } | Builtin::OptionalField { .. } | Builtin::Group { .. } | Builtin::First | Builtin::Last | Builtin::At | Builtin::Concat | Builtin::Slice | Builtin::Sort { .. } | Builtin::MentionTokens | Builtin::Divmod { .. }) {
            self.meter.heap(expression_heap(&value))?;
        }
        Ok(value)
    }

    /// Charge the bytes a result will occupy on the wire.
    pub(super) fn charge_output(&mut self, value: &Value) -> Result<bool, RuntimeError> {
        // Count the canonical tagged representation without allocating a
        // second result-sized string. A shaped/scalar result cannot be
        // truncated without changing its type or inventing a continuation.
        let mut count = crate::json_codec::value_bytes(value).map_err(|e| RuntimeError::Store(e.to_string()))?;
        // Devices stamp provenance even when no retained image needs transport.
        let carries_mask = if self.device { value.has_retained_rows() } else { self.context.row_provenance };
        if carries_mask {
            // Reserve before constructing the mask and its transport image.
            // Application data cannot forge which rows the fallback preserves.
            let (heap, steps) = value.provenance_allowance();
            self.meter.step(steps)?;
            self.meter.heap(heap.saturating_mul(2))?;
            count = count.saturating_add(crate::json_codec::value_bytes(&value.retained_rows_mask()).map_err(|e| RuntimeError::Store(e.to_string()))?);
        }
        if !self.meter.charge(MeterKind::OutputBytes, count)? {
            return Err(RuntimeError::Bound { kind: MeterKind::OutputBytes, actual: count, ceiling: self.meter.ceilings.output_bytes, site: self.meter.site().to_owned() });
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
fn borrowed<'a>(env: &'a BTreeMap<String, Value>, expr: &'a Expr, site: &str) -> Result<Option<(&'a Value, u64)>, RuntimeError> {
    match expr {
        Expr::Literal(value) => Ok(Some((value, 1))),
        Expr::Variable(name) => env.get(name).map(|value| Some((value, 1))).ok_or_else(|| missing_variable(name, site)),
        Expr::Field { base, name } => match borrowed(env, base, site)? {
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

fn missing_variable(name: &str, site: &str) -> RuntimeError {
    if name.starts_with('$') {
        RuntimeError::Structural { code: "E_INTERNAL", message: format!("internal compiler error: an undefined temporary was evaluated in operation/site {site}; recompile and report this operation") }
    } else { RuntimeError::Input(format!("unknown variable {name}")) }
}
