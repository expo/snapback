//! Experimental Postgres backend for evaluating real Quarry execution.
//! Not a deploy target: no auth host, migrations, native module, asset ledger,
//! jobs, actions, or effect worker. Callers are trusted hosts, as with Engine.
//! @ref LLP 3000#7-decisions-during-execution — evaluate storage portability before productizing it
mod log;
mod store;
mod authority;
mod prefetch;
mod tail;
#[cfg(test)]
mod tests;
pub use store::WriteMode;

use super::{Context, MutationOutcome, QueryOutcome, WriteState, runner::Runner, validate};
use crate::{
    error::{Refusal, RuntimeError},
    ir::{ArgType, Program, ProgramKind},
    meter::{Ceilings, Cut, Meter, Metered},
    partition::{self, PartitionRows, SnapshotCursor, SnapshotPage, StreamPage},
    schema::Schema,
    value::{Value, canonical_json},
};
use postgres::{Client, error::SqlState};
use std::collections::BTreeMap;
use store::{Store, decode, namespace};
use crate::rows::Rows;

#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
pub struct Stats {
    /// Explicit driver calls including BEGIN/COMMIT and cold prepares, not a
    /// packet count. Implicit rollback when an errored transaction drops is omitted.
    pub database_calls: u64,
    pub transaction_retries: u64,
    pub prefetch_marked_reads: u64,
    /// Largest marked page in the most recent transaction.
    pub prefetch_page_reads: u64,
    pub prefetch_rows_transferred: u64,
    pub prefetch_bytes_transferred: u64,
}

pub struct PostgresEngine {
    store: Store,
    schema: Schema,
    programs: BTreeMap<String, Program>,
    ceilings: Ceilings,
    mode: WriteMode,
    retries: u64,
    precharge: Metered,
}

impl PostgresEngine {
    /// Create a NEW, isolated sb4_eval_* namespace; never replace an existing
    /// schema. TLS/credentials are owned by the caller's configured Client.
    pub fn create(
        mut client: Client,
        name: &str,
        mut schema: Schema,
        programs: impl IntoIterator<Item = Program>,
    ) -> Result<Self, RuntimeError> {
        let name = namespace(name)?;
        refuse_maintained_columns(&schema)?;
        super::columns::validate_before_prepare(&schema)?;
        schema.prepare_contribution_indexes();
        let programs: BTreeMap<_, _> = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        supported(&schema, &programs)?;
        let mut tx = client.transaction()?;
        tx.batch_execute(&format!("CREATE SCHEMA {name}; SET search_path = {name}, pg_catalog;"))?;
        tx.batch_execute(store::DDL)?;
        tx.execute(
            "INSERT INTO _backend VALUES (true,$1,$2,$3)",
            &[&store::VERSION, &canonical_json(&schema), &canonical_json(&programs)],
        )?;
        tx.commit()?;
        Self::attach(client, schema, programs)
    }

    /// Reopen persisted, immutable compiled content. No activation/migration API.
    pub fn open(mut client: Client, name: &str) -> Result<Self, RuntimeError> {
        let name = namespace(name)?;
        client.batch_execute(&format!("SET search_path = {name}, pg_catalog;"))?;
        let row = client.query_one("SELECT version,schema,programs FROM _backend WHERE singleton", &[])?;
        if row.get::<_, &str>(0) != store::VERSION {
            return Err(RuntimeError::Store("not this Postgres evaluation store version".into()));
        }
        let schema = decode(row.get(1))?;
        let programs = decode(row.get(2))?;
        supported(&schema, &programs)?;
        // Existing immutable stores adopt this portable admission policy at open.
        // Return one offending index and its exact count, never its row payloads.
        if let Some(row) = client.query(
            "SELECT t, ix, COUNT(*) FROM i WHERE octet_length(k) > $1 GROUP BY t, ix ORDER BY t, ix LIMIT 1",
            &[&(crate::rows::MAX_INDEX_KEY_BYTES as i32)],
        )?.first() {
            return Err(crate::rows::index_key_refusal(row.get(0), row.get(1), row.get::<_, i64>(2) as u64));
        }
        client.batch_execute("CREATE TABLE IF NOT EXISTS _sequences (parent TEXT NOT NULL, id TEXT NOT NULL, value BIGINT NOT NULL, PRIMARY KEY(parent, id));")?;
        Self::attach(client, schema, programs)
    }

    fn attach(mut client: Client, schema: Schema, programs: BTreeMap<String, Program>) -> Result<Self, RuntimeError> {
        client.batch_execute("SET statement_timeout = '5s'; SET lock_timeout = '5s';")?;
        client.batch_execute("DROP INDEX IF EXISTS _log_row_seq; DROP INDEX IF EXISTS _log_row_seq_kind;")?;
        Ok(Self { store: Store::new(client), schema, programs, ceilings: Ceilings::default(), mode: WriteMode::Serialized, retries: 0, precharge: Metered::default() })
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }
    pub fn programs(&self) -> &BTreeMap<String, Program> {
        &self.programs
    }
    pub fn generation(&self) -> u64 {
        1
    }
    pub fn set_ceilings(&mut self, ceilings: Ceilings) {
        self.ceilings = ceilings;
    }
    pub fn set_write_mode(&mut self, mode: WriteMode) {
        self.mode = mode;
    }
    /// Evaluation switch: only physical access changes, never the runner.
    pub fn set_prefetch(&mut self, enabled: bool) { self.store.prefetch = enabled; }
    /// Differential evaluation: reserve budget before the first logical charge.
    pub fn set_meter_precharge(&mut self, used: Metered) { self.precharge = used; }

    pub fn stats(&self) -> Stats {
        Stats { database_calls: self.store.calls.get(), transaction_retries: self.retries,
            prefetch_marked_reads: self.store.marked_reads.get(), prefetch_page_reads: self.store.page_reads.get(), prefetch_rows_transferred: self.store.prefetch_rows.get(),
            prefetch_bytes_transferred: self.store.prefetch_bytes.get() }
    }

    pub fn query(&mut self, name: &str, mut context: Context) -> Result<QueryOutcome, Refusal> {
        context.generation = self.generation();
        let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.into()))?;
        if program.kind != ProgramKind::Query {
            return Err(RuntimeError::UnknownOp(format!("{name} is not a query")).into());
        }
        super::server_query_allowed(&self.schema, name)?;
        validate::validate_inputs(&self.schema, program, &mut context.args)?;
        context.now.get_or_insert_with(crate::now_ms);
        let tx = self.store.transaction(None)?;
        let seq = tx.next_seq()? - 1;
        let mut runner = Runner::new(&tx, &self.schema, context, Meter::new(self.ceilings, Cut::Cap), seq);
        runner.meter.used = self.precharge;
        let data = runner.run(program)?;
        runner.charge_output(&data)?;
        let outcome = QueryOutcome {
            complete: runner.meter.capped_at.is_none()
                && runner.word_cut_at.is_none()
                && !runner.non_uniform
                && !runner.page_overflow
                && !runner.page_position_lost(),
            cut: runner.read_cut(),
            capped_at: runner.meter.capped_at.clone(),
            word_cut_at: runner.word_cut_at.clone(),
            next: runner.outcome_next_cursor()?,
            data,
            seq,
            metered: runner.meter.used,
            tables: runner.read_tables.iter().cloned().collect(),
            next_expiry: runner.next_expiry,
        };
        drop(runner);
        tx.rollback()?;
        Ok(outcome)
    }

    pub fn replay(&mut self, viewer: &str, op: &str) -> Result<Option<MutationOutcome>, RuntimeError> {
        let tx = self.store.transaction(None)?;
        let receipt = tx.applied(viewer, op)?;
        tx.rollback()?;
        receipt.as_deref().map(MutationOutcome::from_receipt).transpose()
    }

    /// Compare wire identity before decoding against the installed program.
    // @ref LLP 3000.009#5.1 — an id binds the admitted operation and arguments.
    fn replay_mutation(&mut self, viewer: &str, id: &str, name: &str, args_digest: &str) -> Result<Option<MutationOutcome>, RuntimeError> {
        let tx = self.store.transaction(None)?;
        let receipt = tx.applied_bound(viewer, id, name, args_digest)?;
        tx.rollback()?;
        receipt.as_deref().map(MutationOutcome::from_receipt).transpose()
    }

    pub fn mutate(&mut self, name: &str, op: Option<&str>, mut context: Context) -> Result<MutationOutcome, RuntimeError> {
        context.generation = self.generation();
        let wire_args = if op.is_some() { context.wire_args.take().unwrap_or_else(|| serde_json::Value::Object(crate::wire::map_to_json(&context.args))) }
            else { serde_json::Value::Null };
        let args_digest = crate::store::payload_digest(&wire_args);
        // Preserve the bound replay-before-validation contract, including
        // unknown or renamed programs. Never return a historical result row.
        if let Some(op) = op
            && let Some(outcome) = self.replay_mutation(&context.viewer, op, name, &args_digest)?
        {
            return Ok(outcome);
        }
        let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.into()))?.clone();
        if program.kind != ProgramKind::Mutation {
            return Err(RuntimeError::UnknownOp(format!("{name} is not a mutation")));
        }
        if let Err(error) = validate::validate_inputs(&self.schema, &program, &mut context.args) {
            return Ok(failed(error.refusal(), None, Metered::default()));
        }
        context.now.get_or_insert_with(crate::now_ms);
        if context.entropy == 0 {
            context.entropy = crate::ids::seed();
        }
        // @ref LLP 3000#7-decisions-during-execution — retries rerun Quarry, rules, maintains, and bookkeeping together
        for attempt in 0..=32 {
            match self.mutate_once(&program, op, context.clone(), &args_digest) {
                Err(error) if retry_transaction(&error) && attempt < 32 => {
                    self.retries += 1;
                    let delay = (100_u64 << attempt.min(6)) + crate::ids::seed() % 250;
                    std::thread::sleep(std::time::Duration::from_micros(delay));
                }
                outcome => return outcome,
            }
        }
        unreachable!()
    }

    fn mutate_once(&mut self, program: &Program, op: Option<&str>, context: Context, args_digest: &str) -> Result<MutationOutcome, RuntimeError> {
        let tx = self.store.transaction(Some(self.mode))?;
        if let Some(op) = op
            && let Some(receipt) = tx.applied_bound(&context.viewer, op, &program.name, args_digest)?
        {
            let outcome = MutationOutcome::from_receipt(&receipt)?;
            tx.rollback()?;
            return Ok(outcome);
        }
        let viewer = context.viewer.clone();
        let now = context.now.unwrap_or(0);
        let seq = tx.next_seq()?;
        tx.batch("SAVEPOINT program")?;
        let mut runner = Runner::new(&tx, &self.schema, context, Meter::new(self.ceilings, Cut::Abort), seq);
        runner.meter.used = self.precharge;
        let ran = runner.run(program).and_then(|value| {
            runner.check_final_exists()?;
            runner.charge_output(&value)?;
            Ok(value)
        });
        let metered = runner.meter.used;
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        let events = runner.events.take();
        let outbox = std::mem::take(&mut runner.outbox);
        let writes = runner.rows_written;
        drop(runner);
        let outcome = match ran {
            Ok(result) => {
                tx.batch("RELEASE SAVEPOINT program")?;
                tx.record_commit(seq, now, &program.name, &viewer, program.kind.word(), &tables, writes)?;
                partition::append(&tx, seq, &events)?;
                tx.record_effects(&outbox, seq, now)?;
                MutationOutcome { state: WriteState::Sent { seq, result }, metered, tables, events: events.len(), replayed: false }
            }
            Err(error) if error.is_refusal() => {
                tx.rollback_program()?;
                let current = if let RuntimeError::Conflict { current } = &error {
                    let mut probe = Runner::new(
                        &tx,
                        &self.schema,
                        Context::new(&viewer, BTreeMap::new()).at(now),
                        Meter::new(Ceilings::default(), Cut::Cap),
                        0,
                    );
                    probe.get(current).ok()
                } else {
                    None
                };
                failed(error.refusal(), current, metered)
            }
            Err(error) => return Err(error), // dropping the transaction rolls back ALL state
        };
        if let Some(op) = op {
            let recorded_seq = match outcome.state {
                WriteState::Sent { seq, .. } => seq,
                WriteState::Failed { .. } => seq - 1,
            };
            tx.record_applied(&viewer, op, recorded_seq, &canonical_json(&outcome.receipt(Some(op))), &program.name, args_digest, now)?;
        }
        tx.commit()?;
        Ok(outcome)
    }

    /// Load rows exactly as given: validated and indexed, rules, constraints
    /// and aggregates skipped, partition events emitted. For fixtures whose
    /// aggregates are already computed and for the conformance corpus.
    pub fn load(&mut self, rows: impl IntoIterator<Item = (String, Value)>) -> Result<u64, RuntimeError> {
        let now = crate::now_ms();
        let tx = self.store.transaction(Some(WriteMode::Serialized))?;
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
        let mut count = 0;
        for (table_name, row) in rows {
            let old = tx.get(&table_name, row.field("id")?.as_str()?)?;
            let row = runner.import_sequences(&table_name, row, old.as_ref(), false)?;
            validate::validate_row(&self.schema, &table_name, &row)?;
            let table = self.schema.table(&table_name).expect("validated").clone();
            let id = row.field("id")?.as_str()?.to_owned();
            let old = tx.get(&table_name, &id)?;
            tx.put(&table_name, &table, &row, old.as_ref())?;
            partition::row_changed(&mut runner, &table_name, old.as_ref(), Some(&row), crate::engine::write::Origin::Source)?;
            runner.written_tables.insert(table_name);
            count += 1;
        }
        let events = runner.events.take();
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        drop(runner);
        if count > 0 {
            tx.record_commit(seq, now, "load", crate::SYSTEM_PRINCIPAL, "load", &tables, count)?;
            partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(count)
    }

    /// Fixture loading still uses the real validation, maintains and sync paths.
    pub fn seed_at(&mut self, rows: impl IntoIterator<Item = (String, Value)>, now: i64) -> Result<u64, RuntimeError> {
        let tx = self.store.transaction(Some(WriteMode::Serialized))?;
        let seq = tx.next_seq()?;
        let mut runner = Runner::new(&tx, &self.schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
        let mut count = 0;
        for (table, row) in rows {
            runner.upsert(&table, &row.field("id")?.clone(), row)?;
            count += 1;
        }
        runner.check_final_exists()?;
        let events = runner.events.take();
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        drop(runner);
        if count > 0 {
            tx.record_commit(seq, now, "seed", crate::SYSTEM_PRINCIPAL, "seed", &tables, count)?;
            partition::append(&tx, seq, &events)?;
        }
        tx.commit()?;
        Ok(count)
    }

    pub fn snapshot_page(
        &mut self,
        viewer: &str,
        cursor: Option<SnapshotCursor>,
        limit: usize,
        now: i64,
    ) -> Result<SnapshotPage, RuntimeError> {
        let tx = self.store.transaction(None)?;
        let page = partition::snapshot_page(&tx, &self.schema, viewer, cursor, limit, now)?;
        tx.rollback()?;
        Ok(page)
    }

    pub fn stream(&mut self, viewer: &str, watermark: u64, limit: usize, now: i64) -> Result<StreamPage, RuntimeError> {
        let tx = self.store.transaction(None)?;
        let page = partition::stream(&tx, &self.schema, viewer, watermark, limit, now)?;
        tx.rollback()?;
        Ok(page)
    }
}

fn failed(why: Refusal, current: Option<Value>, metered: Metered) -> MutationOutcome {
    MutationOutcome { state: WriteState::Failed { why, current }, metered, tables: Vec::new(), events: 0, replayed: false }
}

fn retry_transaction(error: &RuntimeError) -> bool {
    let RuntimeError::Postgres(error) = error else {
        return false;
    };
    let Some(error) = error.as_db_error() else {
        return false;
    };
    error.code() == &SqlState::T_R_SERIALIZATION_FAILURE || error.code() == &SqlState::T_R_DEADLOCK_DETECTED
        // Two concurrent refused operations can race only on their receipt;
        // neither advances the commit head. Recheck that receipt from scratch.
        || (error.code() == &SqlState::UNIQUE_VIOLATION && error.constraint() == Some("_ops_pkey"))
}

fn supported(schema: &Schema, programs: &BTreeMap<String, Program>) -> Result<(), RuntimeError> {
    refuse_maintained_columns(schema)?;
    schema.validate_column_owners()?;
    for program in programs.values() {
        for table in crate::ir::read_sites(program).into_iter().map(|s|s.table).chain(crate::ir::write_tables(program).into_iter().map(|(t,_)|t)) { schema.refuse_private(&table)?; }
    }
    if let Some(issue) = crate::schema::validate(schema).first() {
        return Err(RuntimeError::Schema(format!("{}: {}", issue.path, issue.message)));
    }
    fn asset_arg(arg: &ArgType) -> bool {
        match arg {
            ArgType::Image { .. } | ArgType::Video { .. } => true,
            ArgType::Optional(inner) | ArgType::List { of: Some(inner), .. } => asset_arg(inner),
            _ => false,
        }
    }
    if !schema.schedules.is_empty() || !schema.routes.is_empty()
        || schema.tables.values().any(|t| t.columns.values().any(|c| c.contains_asset()))
        || programs
            .values()
            .any(|p| p.native || !matches!(p.kind, ProgramKind::Query | ProgramKind::Mutation) || p.args.values().any(asset_arg))
    {
        return Err(RuntimeError::Schema("Postgres evaluation supports data queries/mutations and transactional emit records only; assets, native modules, jobs, actions, routes and schedules are not implemented".into()));
    }
    Ok(())
}

// @ref LLP 3000.007.001#3.11 — this evaluation backend claims no maintained-column parity.
fn refuse_maintained_columns(schema: &Schema) -> Result<(), RuntimeError> {
    if schema.tables.values().any(|table| !table.maintained.is_empty())
        || schema.maintains.iter().any(|maintain| maintain.private.is_some())
    {
        return Err(RuntimeError::Structural { code: "E_POSTGRES_MAINTAINED_COLUMN",
            message: "Postgres evaluation does not support maintained columns or their private maintains; use the SQLite engine for maintained columns (guide maintains)".into() });
    }
    Ok(())
}
