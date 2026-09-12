//! The engine: one program, one principal, one SQLite transaction. A query
//! reads under the meter and returns `complete` or `capped`; a mutation
//! writes under the meter and returns `sent` with its sequence or `failed`
//! with a refusal, and applies at most once per client-minted id.

pub mod read;
pub mod rules;
pub mod runner;
pub mod validate;
pub mod write;

use crate::error::{MeterKind, Refusal, RuntimeError};
use crate::ir::{Program, ProgramKind};
use crate::meter::{Ceilings, Cut, Meter, Metered};
use crate::partition::{self, Event};
use crate::schema::Schema;
use crate::store::Store;
use crate::value::{Value, canonical_json};
use runner::Runner;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

/// Who runs the program, with what, and when.
#[derive(Clone, Debug)]
pub struct Context {
    pub viewer: String,
    pub kind: String,
    pub args: BTreeMap<String, Value>,
    pub now: Option<i64>,
    pub read_time: Option<i64>,
    /// Ids the caller minted for this run, consumed in order by `new`.
    pub new_ids: VecDeque<String>,
    entropy: u64,
}

impl Context {
    pub fn new(viewer: impl Into<String>, args: BTreeMap<String, Value>) -> Self {
        Self { viewer: viewer.into(), kind: "user".into(), args, now: None, read_time: None, new_ids: VecDeque::new(), entropy: 0 }
    }

    pub fn system() -> Self {
        let mut context = Self::new(crate::SYSTEM_PRINCIPAL, BTreeMap::new());
        context.kind = "system".into();
        context
    }

    pub fn at(mut self, now: i64) -> Self {
        self.now = Some(now);
        self
    }

    pub fn with_ids(mut self, ids: impl IntoIterator<Item = String>) -> Self {
        self.new_ids = ids.into_iter().collect();
        self
    }

    pub fn with_entropy(mut self, entropy: u64) -> Self {
        self.entropy = entropy;
        self
    }

    pub fn is_system(&self) -> bool {
        self.viewer == crate::SYSTEM_PRINCIPAL
    }

    pub(crate) fn mint(&mut self) -> String {
        if let Some(id) = self.new_ids.pop_front() {
            return id;
        }
        if self.entropy == 0 {
            self.entropy = crate::ids::seed();
        }
        crate::ids::mint(self.now.unwrap_or(0), &mut self.entropy)
    }
}

/// A query's outcome: the card's read, minus `fresh` (transport truth).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueryOutcome {
    pub data: Value,
    pub complete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capped_at: Option<(MeterKind, String)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
    /// The store's sequence when the read ran.
    pub seq: u64,
    pub metered: Metered,
    pub tables: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum WriteState {
    Sent { seq: u64, result: Value },
    Failed { why: Refusal, #[serde(default, skip_serializing_if = "Option::is_none")] current: Option<Value> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MutationOutcome {
    #[serde(flatten)]
    pub state: WriteState,
    pub metered: Metered,
    pub tables: Vec<String>,
    pub events: usize,
    /// Whether this call applied the write, or found it already applied.
    pub replayed: bool,
}

pub struct Engine {
    store: Store,
    schema: Schema,
    programs: BTreeMap<String, Program>,
    ceilings: Ceilings,
    entropy: u64,
}

impl Engine {
    pub fn new(mut store: Store, schema: Schema, programs: impl IntoIterator<Item = Program>) -> Result<Self, RuntimeError> {
        let issues = crate::schema::validate(&schema);
        if let Some(issue) = issues.first() {
            return Err(RuntimeError::Schema(format!("{}: {}", issue.path, issue.message)));
        }
        store.install(&schema)?;
        Ok(Self { store, schema, programs: programs.into_iter().map(|p| (p.name.clone(), p)).collect(), ceilings: Ceilings::default(), entropy: crate::ids::seed() })
    }

    pub fn memory(schema: Schema, programs: impl IntoIterator<Item = Program>) -> Result<Self, RuntimeError> {
        Self::new(Store::memory()?, schema, programs)
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub fn store_mut(&mut self) -> &mut Store {
        &mut self.store
    }

    pub fn program(&self, name: &str) -> Option<&Program> {
        self.programs.get(name)
    }

    pub fn programs(&self) -> impl Iterator<Item = &Program> {
        self.programs.values()
    }

    pub fn set_ceilings(&mut self, ceilings: Ceilings) {
        self.ceilings = ceilings;
    }

    pub fn ceilings(&self) -> Ceilings {
        self.ceilings
    }

    /// Replace the schema and programs in place (a successor generation);
    /// the store keeps every row and rebuilds changed indexes; the
    /// generation advances so every device re-derives its partition.
    pub fn adopt(&mut self, schema: Schema, programs: impl IntoIterator<Item = Program>) -> Result<u64, RuntimeError> {
        let issues = crate::schema::validate(&schema);
        if let Some(issue) = issues.first() {
            return Err(RuntimeError::Schema(format!("{}: {}", issue.path, issue.message)));
        }
        self.store.install(&schema)?;
        self.schema = schema;
        self.programs = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        let next = self.generation() + 1;
        self.store.set_meta("generation", &next.to_string())?;
        Ok(next)
    }

    /// The schema generation the store serves; a device holds a partition
    /// of exactly one.
    pub fn generation(&self) -> u64 {
        self.store.meta("generation").ok().flatten().and_then(|g| g.parse().ok()).unwrap_or(1)
    }

    /// Run a query. Refusals (a `require`, a rule, bad input) are the
    /// card's `denied`; store failures surface as retryable refusals too.
    pub fn query(&mut self, name: &str, mut context: Context) -> Result<QueryOutcome, Refusal> {
        let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?.clone();
        if program.kind != ProgramKind::Query {
            return Err(RuntimeError::UnknownOp(format!("{name} is a {}, not a query", program.kind.word())).into());
        }
        validate::validate_inputs(&self.schema, &program, &mut context.args)?;
        if context.now.is_none() {
            context.now = Some(crate::now_ms());
        }
        let tx = self.store.transaction()?;
        let seq = tx.next_seq()? - 1;
        let mut runner = Runner::new(&tx, &self.schema, context, Meter::new(self.ceilings, Cut::Cap), seq);
        let data = runner.run(&program)?;
        runner.charge_output(&data)?;
        let next = runner.next_cursor()?;
        let outcome = QueryOutcome {
            complete: runner.meter.capped_at.is_none(),
            capped_at: runner.meter.capped_at.clone(),
            next: if runner.meter.capped_at.is_some() { None } else { next },
            data,
            seq,
            metered: runner.meter.used,
            tables: runner.read_tables.iter().cloned().collect(),
        };
        drop(runner);
        tx.rollback()?;
        Ok(outcome)
    }

    /// The recorded outcome of a client-minted op that already applied, so a
    /// host can answer a resend before it decodes the arguments against the
    /// current generation: the op may have been renamed since.
    pub fn replay(&self, viewer: &str, op: &str) -> Result<Option<MutationOutcome>, RuntimeError> {
        let Some(outcome) = self.store.applied_outcome(viewer, op)? else {
            return Ok(None);
        };
        let mut outcome: MutationOutcome = serde_json::from_str(&outcome).map_err(|e| RuntimeError::Store(e.to_string()))?;
        outcome.replayed = true;
        Ok(Some(outcome))
    }

    /// Run a mutation. With an `op` id the write applies at most once: a
    /// replay returns the recorded outcome. The replay check comes before
    /// anything the current generation could refuse (an op renamed, an
    /// argument narrowed), so a write that applied under an earlier schema
    /// is never re-judged: its row is on the server, and the device that
    /// queued it must learn `sent`, not `failed`.
    pub fn mutate(&mut self, name: &str, op: Option<&str>, mut context: Context) -> Result<MutationOutcome, RuntimeError> {
        if let Some(op) = op
            && let Some(outcome) = self.replay(&context.viewer, op)?
        {
            return Ok(outcome);
        }
        let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?.clone();
        if program.kind == ProgramKind::Query {
            return Err(RuntimeError::UnknownOp(format!("{name} is a query, not a mutation")));
        }
        if let Err(error) = validate::validate_inputs(&self.schema, &program, &mut context.args) {
            return Ok(MutationOutcome { state: WriteState::Failed { why: error.refusal(), current: None }, metered: Metered::default(), tables: Vec::new(), events: 0, replayed: false });
        }
        if context.now.is_none() {
            context.now = Some(crate::now_ms());
        }
        context.entropy = self.entropy;
        let ceilings = if program.kind == ProgramKind::Job { Ceilings::job() } else { self.ceilings };
        let tx = self.store.transaction()?;
        if let Some(op) = op
            && let Some((_, outcome)) = tx.applied(&context.viewer, op)?
        {
            // Applied between the check above and this transaction.
            let mut outcome: MutationOutcome = serde_json::from_str(&outcome).map_err(|e| RuntimeError::Store(e.to_string()))?;
            outcome.replayed = true;
            tx.rollback()?;
            return Ok(outcome);
        }
        let viewer = context.viewer.clone();
        let now = context.now.unwrap_or(0);
        tx.savepoint("program")?;
        let mut runner = Runner::new(&tx, &self.schema, context, Meter::new(ceilings, Cut::Abort), tx.next_seq()?);
        let ran = runner.run(&program).and_then(|value| {
            runner.check_final_exists()?;
            runner.charge_output(&value)?;
            Ok(value)
        });
        let metered = runner.meter.used;
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        let events: Vec<Event> = std::mem::take(&mut runner.events);
        let outbox = std::mem::take(&mut runner.outbox);
        let rows_written = runner.rows_written;
        let mut read_tables = runner.read_tables.clone();
        self.entropy = runner.context.entropy;
        drop(runner);
        let outcome = match ran {
            Ok(result) => {
                tx.release("program")?;
                let seq = tx.next_seq()?;
                read_tables.extend(tables.iter().cloned());
                tx.record_commit(seq, now, name, &viewer, program.kind.word(), &tables, rows_written)?;
                partition::append(&tx, seq, &events)?;
                for (id, effect, payload) in &outbox {
                    tx.conn().execute(
                        "INSERT INTO _outbox(id, seq, effect, payload, state, attempts, at) VALUES (?1, ?2, ?3, ?4, 'queued', 0, ?5)",
                        rusqlite::params![id, seq as i64, effect, canonical_json(payload), now],
                    )?;
                }
                MutationOutcome { state: WriteState::Sent { seq, result }, metered, tables, events: events.len(), replayed: false }
            }
            Err(error) if error.is_refusal() => {
                tx.rollback_to("program")?;
                let current = match &error {
                    RuntimeError::Conflict { current } => {
                        let mut probe = Runner::new(&tx, &self.schema, Context::new(viewer.clone(), BTreeMap::new()).at(now), Meter::new(Ceilings::default(), Cut::Cap), 0);
                        let value = probe.get(current).ok();
                        value
                    }
                    _ => None,
                };
                MutationOutcome { state: WriteState::Failed { why: error.refusal(), current }, metered, tables: Vec::new(), events: 0, replayed: false }
            }
            Err(error) => {
                tx.rollback()?;
                return Err(error);
            }
        };
        if let Some(op) = op {
            let seq = match &outcome.state {
                WriteState::Sent { seq, .. } => *seq,
                WriteState::Failed { .. } => tx.next_seq()? - 1,
            };
            tx.record_applied(&viewer, op, seq, &serde_json::to_string(&outcome).map_err(|e| RuntimeError::Store(e.to_string()))?)?;
        }
        tx.commit()?;
        Ok(outcome)
    }

    /// Write rows as the system principal: rules are bypassed, validation,
    /// constraints, aggregates and partition events are not. One commit.
    pub fn seed(&mut self, rows: impl IntoIterator<Item = (String, Value)>) -> Result<u64, RuntimeError> {
        let now = crate::now_ms();
        let tx = self.store.transaction()?;
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
        let mut count = 0;
        for (table, row) in rows {
            runner.upsert(&table, &row.field("id")?.clone(), row)?;
            count += 1;
        }
        let events = std::mem::take(&mut runner.events);
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        drop(runner);
        if count > 0 {
            tx.record_commit(seq, now, "seed", crate::SYSTEM_PRINCIPAL, "seed", &tables, count)?;
            partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(count)
    }

    /// Delete a row as the system principal: constraints, aggregates and
    /// partition events apply. Returns the number of rows removed (0 or 1).
    pub fn seed_delete(&mut self, table: &str, id: &str) -> Result<u64, RuntimeError> {
        let now = crate::now_ms();
        let tx = self.store.transaction()?;
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
        let removed = match runner.delete(table, id) {
            Ok(()) => 1,
            Err(RuntimeError::Require { .. }) => 0,
            Err(error) => return Err(error),
        };
        let events = std::mem::take(&mut runner.events);
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        drop(runner);
        if removed > 0 {
            tx.record_commit(seq, now, "seed", crate::SYSTEM_PRINCIPAL, "seed", &tables, removed)?;
            partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(removed)
    }

    /// Load rows exactly as given: validated and indexed, rules, constraints
    /// and aggregates skipped, partition events emitted. For fixtures whose
    /// aggregates are already computed and for the conformance corpus.
    pub fn load(&mut self, rows: impl IntoIterator<Item = (String, Value)>) -> Result<u64, RuntimeError> {
        let now = crate::now_ms();
        let tx = self.store.transaction()?;
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
        let mut count = 0;
        for (table_name, row) in rows {
            validate::validate_row(&self.schema, &table_name, &row)?;
            let table = self.schema.table(&table_name).expect("validated").clone();
            let id = row.field("id")?.as_str()?.to_owned();
            let old = tx.get(&table_name, &id)?;
            tx.put(&table_name, &table, &row, old.as_ref())?;
            partition::row_changed(&mut runner, &table_name, old.as_ref(), Some(&row))?;
            runner.written_tables.insert(table_name);
            count += 1;
        }
        let events = std::mem::take(&mut runner.events);
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        drop(runner);
        if count > 0 {
            tx.record_commit(seq, now, "load", crate::SYSTEM_PRINCIPAL, "load", &tables, count)?;
            partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(count)
    }

    /// The snapshot a device takes before it follows the log.
    pub fn snapshot(&mut self, principal: &str) -> Result<(Vec<Event>, u64), RuntimeError> {
        let tx = self.store.transaction()?;
        let watermark = tx.next_seq()? - 1;
        let events = partition::snapshot(&tx, &self.schema, principal)?;
        tx.rollback()?;
        Ok((events, watermark))
    }

    pub fn stream(&mut self, principal: &str, watermark: u64, limit: usize) -> Result<partition::StreamPage, RuntimeError> {
        let tx = self.store.transaction()?;
        let page = partition::stream(&tx, principal, watermark, limit)?;
        tx.rollback()?;
        Ok(page)
    }

    /// Commits after `seq`, as the tables each touched: the online tier's
    /// invalidation signal.
    pub fn changes(&mut self, seq: u64, limit: usize) -> Result<Vec<(u64, Vec<String>)>, RuntimeError> {
        let tx = self.store.transaction()?;
        let out = tx.commits_after(seq, limit)?;
        tx.rollback()?;
        Ok(out)
    }

    pub fn seq(&self) -> Result<u64, RuntimeError> {
        self.store.seq()
    }
}
