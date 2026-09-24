//! Jobs and schedules (LLP 1016 §4 D2–D5, carried into Snapback 4). A job
//! is a sequence of sweeps; each `chunk` block walks one index a page per
//! commit, its cursor committed with the rows it wrote, so a chunk is
//! wholly done or not started and a crash resumes at the next one. Jobs
//! run as the system principal under the job ceilings. A schedule fires
//! its job once per period from the server's clock, exactly once per
//! boundary across restarts: the boundary it fired for is committed with
//! the job row.

use super::runner::{Flow, Runner};
use super::validate::validate_inputs;
use super::{Context, Engine};
use crate::error::RuntimeError;
use crate::ir::{Expr, LoopDomain, ProgramKind, Scan, Stmt};
use crate::meter::{Ceilings, Cut, Meter};
use crate::partition;
use crate::store::{Bounds, Dir};
use crate::value::{Value, canonical_json, decode_bytes_hex, digest, encode_bytes_hex};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobState {
    Queued,
    Running,
    Done,
    /// A chunk refused (a constraint, a ceiling, a changed program): the
    /// job waits with the refusal; its rows so far stay.
    Parked,
}

impl JobState {
    fn word(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Done => "done",
            Self::Parked => "parked",
        }
    }
}

/// One enqueued run of a job, as `doctor` and `run` print it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobRun {
    pub id: String,
    pub name: String,
    pub state: JobState,
    pub sweep: u32,
    pub chunks: u64,
    #[serde(default)]
    pub chunk_size: u32,
    #[serde(default)]
    pub retries: u64,
    #[serde(default)]
    pub heap_peak: u64,
    pub rows_written: u64,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct Head {
    run: JobRun,
    args: BTreeMap<String, Value>,
    program_hash: String,
    cursor: Option<Vec<u8>>,
    upper: Option<Vec<u8>>,
    domain: Option<Scan>,
}

const COLUMNS: &str = "id, name, args, program_hash, state, sweep, cursor, upper, chunks, rows_written, created_at, updated_at, error, chunk_size, retries, heap_peak, domain";

fn read_head(row: &rusqlite::Row<'_>) -> rusqlite::Result<Head> {
    let state: String = row.get(4)?;
    let args: Value = serde_json::from_str::<Value>(&row.get::<_, String>(2)?).unwrap_or(Value::Null);
    Ok(Head {
        run: JobRun {
            id: row.get(0)?,
            name: row.get(1)?,
            state: match state.as_str() {
                "queued" => JobState::Queued,
                "running" => JobState::Running,
                "done" => JobState::Done,
                _ => JobState::Parked,
            },
            sweep: row.get::<_, i64>(5)? as u32,
            chunks: row.get::<_, i64>(8)? as u64,
            rows_written: row.get::<_, i64>(9)? as u64,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
            error: row.get(12)?,
            chunk_size: row.get::<_, i64>(13)? as u32,
            retries: row.get::<_, i64>(14)? as u64,
            heap_peak: row.get::<_, i64>(15)? as u64,
        },
        args: args.as_object().map(|fields| fields.clone()).unwrap_or_default(),
        program_hash: row.get(3)?,
        cursor: row.get::<_, Option<String>>(6)?.and_then(|hex| decode_bytes_hex(&hex)),
        upper: row.get::<_, Option<String>>(7)?.and_then(|hex| decode_bytes_hex(&hex)),
        domain: row.get::<_, Option<String>>(16)?.map(|json| serde_json::from_str(&json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(16, rusqlite::types::Type::Text, Box::new(error)))).transpose()?,
    })
}

fn insert_job(conn: &Connection, id: &str, name: &str, args: &BTreeMap<String, Value>, program_hash: &str, now: i64) -> Result<(), RuntimeError> {
    conn.execute(
        "INSERT INTO _jobs(id, name, args, program_hash, state, sweep, cursor, upper, chunks, rows_written, created_at, updated_at, error) VALUES (?1, ?2, ?3, ?4, 'queued', 0, NULL, NULL, 0, 0, ?5, ?5, NULL)",
        params![id, name, canonical_json(&Value::Map(args.clone().into())), program_hash, now],
    )?;
    Ok(())
}

/// Durable admission identity for a queued run. Quarry jobs retain their
/// original Program digest. A native continuation also binds the exact wasm
/// bytes that define its private state format. The explicit no-module value
/// lets an initially missing module reach the useful E_NATIVE refusal, while
/// every legacy declaration-only native hash fails closed at chunk admission.
// @ref LLP 3000.005#4 — queued native continuations bind Program plus exact wasm bytes; changed and legacy-unbound runs park.
fn job_admission_hash(program: &crate::ir::Program, native_digest: Option<&str>) -> String {
    let program_hash = digest(program);
    if !program.native {
        return program_hash;
    }
    format!("native-v1:{program_hash}:{}", native_digest.unwrap_or("no-module"))
}

/// What one chunk did.
struct Chunk {
    last_key: Option<Vec<u8>>,
    visited: usize,
    /// `break`: the sweep ends after this chunk.
    ended: bool,
    /// `return`: the job ends after this chunk.
    finished: bool,
}

/// The sweep's rows from the cursor, at most one page, none past the key
/// captured when the sweep began; each bound and run through the body.
fn sweep_chunk(runner: &mut Runner<'_>, scan: &Scan, cursor: Option<&[u8]>, upper: &[u8], binding: &str, body: &[Stmt], site: &str, adaptive: bool) -> Result<Chunk, RuntimeError> {
    let take = scan.take.maximum() as usize;
    let mut page = scan.clone();
    page.opaque_cursor = false;
    page.after = cursor.map(|key| Box::new(Expr::Literal(Value::Array(crate::key::decode(key).unwrap_or_default().into_iter().skip(scan.prefix.len()).collect()))));
    let (rows, keys) = if adaptive { runner.job_page(&page)? } else { runner.scan_with_keys(&page)? };
    let mut chunk = Chunk { last_key: None, visited: 0, ended: false, finished: false };
    for (row, key) in rows.into_iter().zip(keys) {
        if key.as_slice() > upper {
            chunk.ended = true;
            break;
        }
        chunk.visited += 1;
        runner.env.insert(binding.to_owned(), row);
        match runner.statements(body, site)? {
            Flow::Break => {
                chunk.last_key = Some(key);
                chunk.ended = true;
                break;
            }
            Flow::Return(_) => {
                chunk.last_key = Some(key);
                chunk.finished = true;
                break;
            }
            Flow::Next | Flow::Continue => {}
        }
        chunk.last_key = Some(key);
    }
    if chunk.visited < take {
        chunk.ended = true;
    }
    if chunk.last_key.as_deref() == Some(upper) {
        chunk.ended = true;
    }
    Ok(chunk)
}

impl Engine {
    /// Queue a run of a job. Its arguments are validated now; it runs as
    /// the system principal when its turn comes (`run_job_chunk`).
    pub fn enqueue_job(&mut self, name: &str, mut args: BTreeMap<String, Value>, now: i64) -> Result<String, RuntimeError> {
        let program = self.programs.get(name).ok_or_else(|| RuntimeError::UnknownOp(name.to_owned()))?.clone();
        if program.kind != ProgramKind::Job {
            return Err(RuntimeError::UnknownOp(format!("{name} is a {}, not a job", program.kind.word())));
        }
        validate_inputs(&self.schema, &program, &mut args)?;
        let id = crate::ids::mint(now, &mut self.entropy)?;
        #[cfg(feature = "native")]
        let program_hash = job_admission_hash(&program, self.native.as_deref().map(super::native::Module::digest));
        #[cfg(not(feature = "native"))]
        let program_hash = job_admission_hash(&program, None);
        let tx = self.store.transaction()?;
        insert_job(tx.conn(), &id, name, &args, &program_hash, now)?;
        tx.commit()?;
        Ok(id)
    }

    /// Run a job to completion, here and now: enqueued, then every chunk
    /// in turn (behind whatever was queued first). For `snapback4 run`.
    pub fn run_job(&mut self, name: &str, args: BTreeMap<String, Value>, now: i64) -> Result<JobRun, RuntimeError> {
        let id = self.enqueue_job(name, args, now)?;
        while let Some(run) = self.run_job_chunk(now)? {
            if run.id == id && matches!(run.state, JobState::Done | JobState::Parked) {
                return Ok(run);
            }
        }
        self.job(&id)?.ok_or_else(|| RuntimeError::Store(format!("job {id} vanished")))
    }

    pub fn job(&self, id: &str) -> Result<Option<JobRun>, RuntimeError> {
        Ok(self.store.conn().query_row(&format!("SELECT {COLUMNS} FROM _jobs WHERE id = ?1"), [id], read_head).optional()?.map(|head| head.run))
    }

    /// The most recent runs, newest first.
    pub fn jobs(&self, limit: usize) -> Result<Vec<JobRun>, RuntimeError> {
        let mut statement = self.store.conn().prepare(&format!("SELECT {COLUMNS} FROM _jobs ORDER BY created_at DESC LIMIT ?1"))?;
        let rows = statement.query_map([limit as i64], read_head)?;
        Ok(rows.map(|head| head.map(|head| head.run)).collect::<Result<_, _>>()?)
    }

    /// One chunk of the head job (queued or running, oldest first): one
    /// page of its current sweep through the body, the rows and the cursor
    /// in one commit. `Ok(None)` when nothing is queued. A refused chunk
    /// parks the job with the refusal; a job whose program changed since
    /// it was queued parks with `E_JOB_GENERATION`.
    pub fn run_job_chunk(&mut self, now: i64) -> Result<Option<JobRun>, RuntimeError> {
        let presence = self.presence.clone();
        let tx = self.store.transaction()?;
        let head = tx.conn().query_row(&format!("SELECT {COLUMNS} FROM _jobs WHERE state IN ('queued', 'running') ORDER BY created_at, id LIMIT 1"), [], read_head).optional()?;
        let Some(mut head) = head else { return Ok(None) };
        let program = self.programs.get(&head.run.name).cloned();
        #[cfg(feature = "native")]
        let current_hash = program.as_ref().map(|program| job_admission_hash(program, self.native.as_deref().map(super::native::Module::digest)));
        #[cfg(not(feature = "native"))]
        let current_hash = program.as_ref().map(|program| job_admission_hash(program, None));
        let Some(program) = program.filter(|_| current_hash.as_deref() == Some(&head.program_hash)) else {
            tx.conn().execute("UPDATE _jobs SET state = 'parked', error = ?2, updated_at = ?3 WHERE id = ?1", params![head.run.id, format!("E_JOB_GENERATION: job {} or its native module changed (or the run predates module binding) since this run was queued; queue it again", head.run.name), now])?;
            tx.commit()?;
            return self.job(&head.run.id);
        };
        if program.native {
            let id = head.run.id.clone();
            #[cfg(feature = "native")]
            native_chunk(tx, &self.schema, self.native.as_deref(), &mut self.native_logs, head, &program, now, self.dev_effects)?;
            #[cfg(not(feature = "native"))]
            native_chunk(tx, head, &program, now)?;
            return self.job(&id);
        }
        let mut sweeps = Vec::new();
        let mut setup_start = 0;
        for (index, statement) in program.body.iter().enumerate() {
            if let Stmt::For { binding, domain: LoopDomain::Page(scan), body } = statement {
                sweeps.push((binding.as_str(), scan, body.as_slice(), &program.body[setup_start..index]));
                setup_start = index + 1;
            }
        }
        let sweep = head.run.sweep as usize;
        if sweep >= sweeps.len() {
            tx.conn().execute("UPDATE _jobs SET state = 'done', sweep = ?2, cursor = NULL, upper = NULL, updated_at = ?3 WHERE id = ?1", params![head.run.id, sweeps.len() as i64, now])?;
            tx.commit()?;
            return self.job(&head.run.id);
        }
        let (binding, domain, body, setup) = sweeps[sweep];
        let adaptive = domain.take == crate::ir::Bound::Meter;
        let mut frozen = head.domain.clone();
        let mut frozen_upper = head.upper.clone();
        let mut size = if adaptive { if head.cursor.is_none() || head.run.chunk_size == 0 { 64 } else { head.run.chunk_size } } else { domain.take.maximum() as u32 };
        loop {
            tx.savepoint("job_chunk")?;
            let seq = tx.next_seq()?;
            let mut context = Context::system().at(now).with_presence(presence.clone());
            context.args = head.args.clone();
            let mut runner = Runner::new(&tx, &self.schema, context, Meter::new(Ceilings::job(), Cut::Abort), seq);

            // The sweep's upper key is captured when it begins: a row the body
            // inserts beyond it is never visited, so a sweep over its own
            // table ends.
            let site = format!("{}:{}", program.name, sweep + 1);
            let authority = super::timeline_authority::Authority::purge(&self.schema, &program.name);
            let outcome = (|| {
                // @ref LLP 3000.007#5.2 — replay setup for every chunk, in its transaction and under its meter.
                if let Flow::Return(_) = runner.statements(setup, &format!("{site}:prelude"))? {
                    return Ok((Chunk { last_key: None, visited: 0, ended: true, finished: true }, None));
                }
                // @ref LLP 3000.013#5.2 — freeze evaluated prefix/seek bounds once per sweep, alongside the committed cursor.
                if adaptive && frozen.is_none() { frozen = Some(runner.freeze_job_domain(domain)?); }
                if let Some(frozen) = &frozen { runner.meter.heap(2 * canonical_json(frozen).len() as u64)?; }
                let mut scan = frozen.as_ref().unwrap_or(domain).clone();
                scan.take = crate::ir::Bound::Literal(size);
                let scan = &scan;
                let mut guard = runner.timeline_scope(authority);
                let runner = &mut *guard;
                let upper = match &frozen_upper {
                    Some(upper) => Some(upper.clone()),
                    None if adaptive => runner.job_upper(scan)?,
                    None => {
                        let prefix = runner.prefix_values(scan)?;
                        tx.scan(&scan.table, &scan.index, &prefix, &Bounds::default(), Dir::Desc, 1)?.pop().map(|(_, key)| key)
                    }
                };
                if adaptive {
                    if let Some(upper) = &upper { runner.meter.heap(2 * crate::rows::word_heap::allocation(upper.len()))?; }
                    frozen_upper = upper.clone();
                }
                match upper {
                    Some(upper) => sweep_chunk(runner, scan, head.cursor.as_deref(), &upper, binding, body, &site, adaptive).map(|chunk| (chunk, Some(upper))),
                    None => Ok((Chunk { last_key: None, visited: 0, ended: true, finished: false }, None)),
                }
            })();
            let outcome = outcome.and_then(|chunk| runner.check_final_exists().map(|()| chunk));
            let events = runner.events.take();
            let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
            let outbox = std::mem::take(&mut runner.outbox);
            let rows_written = runner.rows_written;
            head.run.heap_peak = head.run.heap_peak.max(runner.meter.heap_peak);
            drop(runner);
            match outcome {
                Ok((chunk, upper)) => {
                    if rows_written > 0 || !events.is_empty() || !outbox.is_empty() {
                        tx.record_commit(seq, now, &head.run.name, crate::SYSTEM_PRINCIPAL, "job", &tables, rows_written)?;
                        partition::append(&tx, seq, &events)?;
                        super::effects::record(&tx, &outbox, seq, now, self.dev_effects, &self.schema)?;
                    }
                    let (next_sweep, cursor, upper) = if chunk.finished { (sweeps.len(), None, None) } else if chunk.ended { (sweep + 1, None, None) } else { (sweep, chunk.last_key, upper) };
                    let state = if next_sweep >= sweeps.len() { JobState::Done } else { JobState::Running };
                    tx.conn().execute(
                        "UPDATE _jobs SET state = ?2, sweep = ?3, cursor = ?4, upper = ?5, chunks = chunks + 1, rows_written = rows_written + ?6, updated_at = ?7, chunk_size = ?8, retries = ?9, heap_peak = ?10, domain = ?11 WHERE id = ?1",
                        params![head.run.id, state.word(), next_sweep as i64, cursor.as_deref().map(encode_bytes_hex), upper.as_deref().map(encode_bytes_hex), rows_written as i64, now, size, head.run.retries as i64, head.run.heap_peak as i64, if next_sweep == sweep { frozen.as_ref().map(canonical_json) } else { None }],
                    )?;
                    tx.commit()?;
                    return Ok(self.job(&head.run.id)?);
                }
                Err(error) if error.is_refusal() => {
                    tx.rollback_to("job_chunk")?;
                    // @ref LLP 3000.013#5.2 — retry the same atomic chunk; only a one-item meter refusal parks an adaptive sweep.
                    if adaptive && size > 1 && matches!(error, RuntimeError::Bound { .. }) {
                        size /= 2;
                        head.run.retries += 1;
                        continue;
                    }
                    let refusal = error.refusal();
                    tx.conn().execute("UPDATE _jobs SET state = 'parked', error = ?2, updated_at = ?3, chunk_size = ?4, retries = ?5, heap_peak = ?6 WHERE id = ?1", params![head.run.id, format!("{}: {}", refusal.code, refusal.message), now, size, head.run.retries as i64, head.run.heap_peak as i64])?;
                    tx.commit()?;
                    return self.job(&head.run.id);
                }
                Err(error) => {
                    tx.rollback()?;
                    return Err(error);
                }
            }
        }
    }

    /// Queue the job of every schedule whose period boundary the clock has
    /// crossed since it last fired, with the period that ended there as
    /// `periodStart`/`periodEnd` when the job declares them. The boundary
    /// fired for is committed with the job row, so a restart never fires
    /// twice for one period; a schedule seen for the first time fires from
    /// its next boundary. Returns the names fired.
    pub fn fire_schedules(&mut self, now: i64) -> Result<Vec<String>, RuntimeError> {
        let mut fired = Vec::new();
        for schedule in self.schema.schedules.clone() {
            let boundary = schedule.boundary(now);
            let key = format!("schedule:{}", schedule.name);
            let shape_key = format!("schedule-shape:{}", schedule.name);
            let shape = digest(&schedule);
            let program = self.programs.get(&schedule.target).filter(|p| matches!(p.kind, ProgramKind::Job | ProgramKind::Action))
                .ok_or_else(|| RuntimeError::Schema(format!("schedule {} names missing job or action {}; restore its target before firing it", schedule.name, schedule.target)))?.clone();
            if program.kind == ProgramKind::Action && !schedule.service.as_deref().is_some_and(crate::identity::is_service) {
                return Err(RuntimeError::Schema("a scheduled action requires its declared service seat".into()));
            }
            if program.kind == ProgramKind::Job && schedule.service.is_some() {
                return Err(RuntimeError::Schema("a scheduled job runs as the system, not a service seat".into()));
            }
            let tx = self.store.transaction()?;
            let previous_shape: Option<String> = tx.conn().query_row("SELECT value FROM _meta WHERE key = ?1", [&shape_key], |row| row.get(0)).optional()?;
            if previous_shape.as_ref().is_some_and(|previous| previous != &shape) {
                tx.set_meta(&key, &boundary.to_string())?;
                tx.set_meta(&shape_key, &shape)?;
                tx.commit()?;
                continue;
            }
            tx.set_meta(&shape_key, &shape)?;
            let last: Option<i64> = tx.conn().query_row("SELECT value FROM _meta WHERE key = ?1", [&key], |row| row.get::<_, String>(0)).optional()?.and_then(|value| value.parse().ok());
            if last.is_some_and(|last| last >= boundary) {
                tx.commit()?;
                continue;
            }
            let Some(_) = last else {
                tx.set_meta(&key, &boundary.to_string())?;
                tx.commit()?;
                continue;
            };
            let mut args = BTreeMap::new();
            if program.args.contains_key("periodStart") {
                args.insert("periodStart".to_owned(), Value::Int(boundary - schedule.every_ms as i64));
            }
            if program.args.contains_key("periodEnd") {
                args.insert("periodEnd".to_owned(), Value::Int(boundary));
            }
            let id = crate::ids::mint(now, &mut self.entropy)?;
            if program.kind == ProgramKind::Action {
                let principal = schedule.service.as_deref().expect("checked service seat");
                validate_inputs(&self.schema, &program, &mut args)?;
                super::actions::authorize(&program, principal)?;
                let raw = serde_json::Value::Object(crate::wire::map_to_json(&args));
                let context = Context::new(principal, args).at(now);
                // @ref LLP 3000.009#5.2 — the boundary and service-seat admission are one commit.
                super::actions::insert_request(&tx, &self.schema, &program, &id, &context, &raw, true, now)?;
            } else {
                #[cfg(feature = "native")]
                let program_hash = job_admission_hash(&program, self.native.as_deref().map(super::native::Module::digest));
                #[cfg(not(feature = "native"))]
                let program_hash = job_admission_hash(&program, None);
                insert_job(tx.conn(), &id, &schedule.target, &args, &program_hash, now)?;
            }
            tx.conn().execute("INSERT INTO _meta(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, boundary.to_string()])?;
            tx.commit()?;
            fired.push(schedule.name.clone());
        }
        Ok(fired)
    }
}

/// One chunk of a native job (LLP 3000.005): the module runs once with
/// the state it returned last time, inside one transaction under the job
/// ceilings; its rows and events commit with the state, a refusal parks
/// it, a trap parks it with the reason. Over the engine's fields, not the
/// engine, because the transaction borrows its store.
#[cfg(feature = "native")]
fn native_chunk(tx: crate::store::Tx<'_>, schema: &crate::schema::Schema, module: Option<&super::native::Module>, logs: &mut super::native::Logs, head: Head, program: &crate::ir::Program, now: i64, dev: bool) -> Result<(), RuntimeError> {
    use super::native::{self, Step};
    tx.savepoint("job_chunk")?;
    let seq = tx.next_seq()?;
    let mut context = Context::system().at(now);
    context.args = head.args.clone();
    let runner = Runner::new(&tx, schema, context, Meter::new(Ceilings::job(), Cut::Abort), seq);
    let state: Option<serde_json::Value> = head.cursor.as_deref().and_then(|bytes| serde_json::from_slice(bytes).ok());
    let outcome = match module {
        Some(module) => native::run_chunk(module, runner, &program.name, &head.args, state, now),
        None => native::missing(runner, &program.name),
    };
    logs.extend(&program.name, outcome.logs);
    match outcome.step {
        Ok(step) => {
            if outcome.rows_written > 0 || !outcome.events.is_empty() {
                tx.record_commit(seq, now, &head.run.name, crate::SYSTEM_PRINCIPAL, "job", &outcome.tables, outcome.rows_written)?;
                partition::append(&tx, seq, &outcome.events)?;
                super::effects::record(&tx, &outcome.outbox, seq, now, dev, schema)?;
            }
            let (state, cursor) = match step {
                Step::Done => (JobState::Done, None),
                Step::Again(state) => (JobState::Running, Some(encode_bytes_hex(state.to_string().as_bytes()))),
            };
            tx.conn().execute(
                "UPDATE _jobs SET state = ?2, cursor = ?3, chunks = chunks + 1, rows_written = rows_written + ?4, updated_at = ?5 WHERE id = ?1",
                params![head.run.id, state.word(), cursor, outcome.rows_written as i64, now],
            )?;
            tx.commit()
        }
        Err(error) if error.is_refusal() => {
            tx.rollback_to("job_chunk")?;
            let refusal = error.refusal();
            tx.conn().execute("UPDATE _jobs SET state = 'parked', error = ?2, updated_at = ?3 WHERE id = ?1", params![head.run.id, format!("{}: {}", refusal.code, refusal.message), now])?;
            tx.commit()
        }
        Err(error) => {
            tx.rollback()?;
            Err(error)
        }
    }
}

/// Built without native jobs: a native job parks, saying so.
#[cfg(not(feature = "native"))]
fn native_chunk(tx: crate::store::Tx<'_>, head: Head, program: &crate::ir::Program, now: i64) -> Result<(), RuntimeError> {
    tx.conn().execute("UPDATE _jobs SET state = 'parked', error = ?2, updated_at = ?3 WHERE id = ?1", params![head.run.id, format!("E_NATIVE: job {} is native and this server was built without native jobs", program.name), now])?;
    tx.commit()
}
