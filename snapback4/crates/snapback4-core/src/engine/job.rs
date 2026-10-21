//! Jobs and schedules (LLP 1016 §4 D2–D5, carried into Snapback 4). A job
//! is a sequence of sweeps; each `chunk` block walks one index a page per
//! commit, its cursor committed with the rows it wrote, so a chunk is
//! wholly done or not started and a crash resumes at the next one. Jobs
//! run as the system principal under the job ceilings. A schedule fires
//! its job once per period from the server's clock, exactly once per
//! boundary across restarts: the boundary it fired for is committed with
//! the job row.

use crate::rows::Rows;
use super::committer::{Committer, Kind, Member};

use super::runner::{Flow, Runner};
use super::validate::validate_inputs;
use super::{Context, Engine};
use crate::error::RuntimeError;
use crate::ir::{Expr, LoopDomain, ProgramKind, Scan, Stmt};
use crate::meter::{Ceilings, Cut, Meter};
use crate::store::{Bounds, Dir};
use crate::value::{Value, canonical_json, digest};
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
    pub(crate) fn word(self) -> &'static str {
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

/// The durable continuation, independent of a database row representation.
pub(crate) struct Head {
    pub(crate) run: JobRun,
    pub(crate) args: BTreeMap<String, Value>,
    pub(crate) program_hash: String,
    pub(crate) cursor: Option<Vec<u8>>,
    pub(crate) upper: Option<Vec<u8>>,
    pub(crate) domain: Option<Scan>,
}

pub(crate) struct JobChunkUpdate<'a> {
    pub(crate) id: &'a str,
    pub(crate) state: JobState,
    pub(crate) sweep: usize,
    pub(crate) cursor: Option<&'a [u8]>,
    pub(crate) upper: Option<&'a [u8]>,
    pub(crate) rows_written: u64,
    pub(crate) now: i64,
    pub(crate) size: u32,
    pub(crate) retries: u64,
    pub(crate) heap_peak: u64,
    pub(crate) domain: Option<&'a Scan>,
}

/// Bounded inspection facts; presentation and byte truncation belong to the host.
pub struct JobSummary {
    pub id: String,
    pub name: String,
    pub state: String,
    pub rows_written: i64,
    pub error: Option<String>,
    pub error_truncated: bool,
}

/// Snapshot inspection of the work family. No policy or presentation lives here.
// @ref LLP 3000.009.001.000#10 — one jobs contract on SQLite and Postgres.
// Inspection may open a driver snapshot; SQLite retains shared public accessors.
#[allow(dead_code)] // P1a conformance seam; the mutable Postgres host joins in P1b.
pub(crate) trait JobStore {
    fn job(&mut self, id: &str) -> Result<Option<JobRun>, RuntimeError>;
    /// Limits above i64::MAX clamp to i64::MAX.
    fn jobs(&mut self, limit: usize) -> Result<Vec<JobRun>, RuntimeError>;
    fn schedule_shape(&mut self, name: &str) -> Result<Option<String>, RuntimeError>;
    fn schedule_boundary(&mut self, name: &str) -> Result<Option<i64>, RuntimeError>;
    fn latest_schedule_boundary(&mut self) -> Result<Option<i64>, RuntimeError>;
    fn job_summaries(&mut self, error_bytes: usize) -> Result<Vec<JobSummary>, RuntimeError>;
    fn job_count(&mut self) -> Result<i64, RuntimeError>;
}

/// Access to job continuations and schedule watermarks in the caller's writer.
/// Policy decides state, refusal text, chunk size and the order of these calls.
// @ref LLP 3000.009.001.000#3.3 — the boundary and admitted job stay in one transaction.
// Postgres writes require the existing serialized shared-head fence.
pub(crate) trait JobTransaction {
    fn insert_job(
        &self,
        id: &str,
        name: &str,
        args: &BTreeMap<String, Value>,
        program_hash: &str,
        now: i64,
    ) -> Result<(), RuntimeError> {
        validate_job_key(id)?;
        validate_job_key(name)?;
        self.insert_job_record(id, name, args, program_hash, now)
    }
    fn insert_job_record(
        &self,
        id: &str,
        name: &str,
        args: &BTreeMap<String, Value>,
        program_hash: &str,
        now: i64,
    ) -> Result<(), RuntimeError>;
    fn head_job(&self) -> Result<Option<Head>, RuntimeError>;
    fn park_job(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError> {
        self.park_job_record(id, &job_diagnostic(error), now)
    }
    fn park_job_record(&self, id: &str, error: &str, now: i64) -> Result<(), RuntimeError>;
    fn finish_job_sweeps(&self, id: &str, sweeps: usize, now: i64) -> Result<(), RuntimeError>;
    fn job_counters(&self, id: &str) -> Result<Option<(i64, i64)>, RuntimeError>;
    fn record_job_chunk(&self, chunk: JobChunkUpdate<'_>) -> Result<(), RuntimeError> {
        let Some((chunks, rows)) = self.job_counters(chunk.id)? else {
            return Ok(());
        };
        let total = add_job_counter(rows, chunk.rows_written);
        self.write_job_chunk(chunk, add_job_counter(chunks, 1), total)
    }
    fn write_job_chunk(
        &self,
        chunk: JobChunkUpdate<'_>,
        chunks: i64,
        rows: i64,
    ) -> Result<(), RuntimeError>;
    fn park_job_chunk(
        &self,
        id: &str,
        error: &str,
        now: i64,
        size: u32,
        retries: u64,
        heap_peak: u64,
    ) -> Result<(), RuntimeError> {
        self.park_job_chunk_record(id, &job_diagnostic(error), now, size, retries, heap_peak)
    }
    fn park_job_chunk_record(
        &self,
        id: &str,
        error: &str,
        now: i64,
        size: u32,
        retries: u64,
        heap_peak: u64,
    ) -> Result<(), RuntimeError>;
    #[cfg(feature = "native")]
    fn record_native_job_chunk(
        &self,
        id: &str,
        state: JobState,
        cursor: Option<&[u8]>,
        rows_written: u64,
        now: i64,
    ) -> Result<(), RuntimeError> {
        let Some((chunks, rows)) = self.job_counters(id)? else {
            return Ok(());
        };
        self.write_native_job_chunk(
            id,
            state,
            cursor,
            add_job_counter(chunks, 1),
            add_job_counter(rows, rows_written),
            now,
        )
    }
    #[cfg(feature = "native")]
    fn write_native_job_chunk(
        &self,
        id: &str,
        state: JobState,
        cursor: Option<&[u8]>,
        chunks: i64,
        rows: i64,
        now: i64,
    ) -> Result<(), RuntimeError>;
    fn schedule_shape(&self, name: &str) -> Result<Option<String>, RuntimeError>;
    fn schedule_boundary(&self, name: &str) -> Result<Option<i64>, RuntimeError>;
    fn schedule_exists(&self, name: &str) -> Result<bool, RuntimeError>;
    fn set_schedule_shape(&self, name: &str, shape: &str) -> Result<(), RuntimeError> {
        if name.contains('\0') && !self.schedule_exists(name)? {
            validate_job_key(name)?;
        }
        self.write_schedule_shape(name, shape)
    }
    fn set_schedule_boundary(&self, name: &str, boundary: i64) -> Result<(), RuntimeError> {
        if name.contains('\0') && !self.schedule_exists(name)? {
            validate_job_key(name)?;
        }
        self.write_schedule_boundary(name, boundary)
    }
    fn write_schedule_shape(&self, name: &str, shape: &str) -> Result<(), RuntimeError>;
    fn write_schedule_boundary(&self, name: &str, boundary: i64) -> Result<(), RuntimeError>;
}

// @ref LLP 3000.009.001.000#9.1 — new keys reject NUL; stored keys remain addressable, diagnostics normalize before truncation.
fn validate_job_key(key: &str) -> Result<(), RuntimeError> {
    if key.contains('\0') {
        return Err(RuntimeError::Input(
            "job and schedule identifiers cannot contain U+0000".into(),
        ));
    }
    Ok(())
}
fn job_diagnostic(error: &str) -> std::borrow::Cow<'_, str> {
    if error.contains('\0') {
        error.replace('\0', "\u{fffd}").into()
    } else {
        error.into()
    }
}

// @ref LLP 3000.009.001.000#3.3 — accounting saturates at the signed storage maximum, before any adapter write.
pub(crate) fn job_counter(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}
fn add_job_counter(previous: i64, added: u64) -> i64 {
    job_counter(previous as u64).saturating_add(job_counter(added))
}
/// Oversized unsigned inspection limits clamp to the largest signed value.
pub(crate) fn job_limit(value: usize) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}
/// Summary prefix lengths use an explicit signed 32-bit bound on both stores.
pub(crate) fn job_error_limit(value: usize) -> i64 {
    job_limit(value).min(i64::from(i32::MAX))
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
fn sweep_chunk(runner: &mut Runner<'_>, scan: &Scan, cursor: Option<&[u8]>, upper: &[u8], binding: &str, body: &[Stmt], site: &str, adaptive: bool, started: std::time::Instant, budget: std::time::Duration) -> Result<Chunk, RuntimeError> {
    let take = scan.take.maximum() as usize;
    let mut page = scan.clone();
    page.opaque_cursor = false;
    page.after = cursor.map(|key| Box::new(Expr::Literal(Value::Array(crate::key::decode(key).unwrap_or_default().into_iter().skip(scan.prefix.len()).collect()))));
    let (rows, keys) = if adaptive { runner.job_page(&page)? } else { runner.scan_with_keys(&page)? };
    let mut chunk = Chunk { last_key: None, visited: 0, ended: false, finished: false };
    let mut yielded = false;
    for (row, key) in rows.into_iter().zip(keys) {
        if chunk.visited > 0 && started.elapsed() >= budget { yielded = true; break; }
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
    if !yielded && chunk.visited < take {
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
        let id = crate::ids::mint(now, &mut self.minter)?;
        #[cfg(feature = "native")]
        let program_hash = job_admission_hash(&program, self.native.as_deref().map(super::native::Module::digest));
        #[cfg(not(feature = "native"))]
        let program_hash = job_admission_hash(&program, None);
        let tx = self.store.transaction()?;
        tx.insert_job(&id, name, &args, &program_hash, now)?;
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
        self.store.job(id)
    }

    /// The most recent runs, newest first.
    pub fn jobs(&self, limit: usize) -> Result<Vec<JobRun>, RuntimeError> {
        self.store.jobs(limit)
    }

    /// One chunk of the head job (queued or running, oldest first): one
    /// page of its current sweep through the body, the rows and the cursor
    /// in one commit. `Ok(None)` when nothing is queued. A refused chunk
    /// parks the job with the refusal; a job whose program changed since
    /// it was queued parks with `E_JOB_GENERATION`.
    pub fn run_job_chunk(&mut self, now: i64) -> Result<Option<JobRun>, RuntimeError> {
        self.run_job_chunk_for(now, std::time::Duration::MAX)
    }

    /// Yield between complete Quarry iterations. A native call remains one
    /// fuel- and meter-bounded atomic invocation, as does one Quarry iteration.
    /// The guest ABI only yields on `again`: at most one native invocation is
    /// admitted per slice, with 2,000,000,000 fuel, 1,000,000 host steps, 16,384
    /// examined rows and 8,192 writes (Ceilings::job). It cannot be suspended
    /// across a commit without losing its transaction. The duration is therefore
    /// cooperative, not a wall-clock bound on a native call or one row/commit.
    /// The host charges the full overrun to its between-slice pacing pause.
    pub fn run_job_chunk_for(&mut self, now: i64, budget: std::time::Duration) -> Result<Option<JobRun>, RuntimeError> {
        let started = std::time::Instant::now();
        let presence = self.presence.clone();
        let id = Committer::run(&mut self.store, Member::new(Kind::Engine, |tx| {
            // @ref LLP 3000.036.003#3.2 — a job's
            // runner, partition events and commit share the floor pinned inside
            // their writer transaction, for Quarry and native chunks alike.
            let now = tx.pin_writer_time(&self.schema, now)?;
            let head = tx.head_job()?;
            let Some(mut head) = head else { return Ok(tx.abort(None)) };
            let program = self.programs.get(&head.run.name).cloned();
            #[cfg(feature = "native")]
            let current_hash = program.as_ref().map(|program| job_admission_hash(program, self.native.as_deref().map(super::native::Module::digest)));
            #[cfg(not(feature = "native"))]
            let current_hash = program.as_ref().map(|program| job_admission_hash(program, None));
            let Some(program) = program.filter(|_| current_hash.as_deref() == Some(&head.program_hash)) else {
                tx.park_job(&head.run.id, &format!("E_JOB_GENERATION: job {} or its native module changed (or the run predates module binding) since this run was queued; queue it again", head.run.name), now)?;
                return tx.complete(Some(head.run.id));
            };
            if program.native {
                let id = head.run.id.clone();
                #[cfg(feature = "native")]
                let outcome = native_chunk(tx, &self.schema, self.native.as_deref(), &mut self.native_logs, self.minter.clone(), head, &program, now, self.dev_effects);
                #[cfg(not(feature = "native"))]
                let outcome = native_chunk(tx, head, &program, now);
                return outcome.map(|disposition| disposition.map(|()| Some(id)));
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
            // @ref LLP 3000.013#5.2 — only recorded table sweeps commit resumable work.
            // Non-page loops may compute a prefix (for example a bounded sum).
            // They must be write/emit-free, including their domain expressions,
            // and precede a sweep whose metered setup will actually execute them.
            // Unsupported work anywhere parks before the first chunk commits.
            let unsupported = program.body.iter().enumerate().find_map(|(position, statement)| match statement {
                Stmt::For { binding, domain, .. } if !matches!(domain, LoopDomain::Page(_))
                    && (position >= setup_start || !super::read_only::statements::<false>(std::slice::from_ref(statement))) => Some((position + 1, binding)),
                _ => None,
            });
            if sweeps.is_empty() || unsupported.is_some() {
                let reason = unsupported.map_or_else(|| "has no recorded table sweep".to_owned(),
                    |(position, binding)| format!("has an unsupported top-level loop at statement {position} (`for {binding}`)"));
                tx.park_job(&head.run.id,
                    &format!("E_JOB_SWEEP: job {} {reason}; bind its work as `for row in table:` and put optional filters inside the loop", program.name), now)?;
                return tx.complete(Some(head.run.id));
            }
            if sweep >= sweeps.len() {
                tx.finish_job_sweeps(&head.run.id, sweeps.len(), now)?;
                return tx.complete(Some(head.run.id));
            }
            let (binding, domain, body, setup) = sweeps[sweep];
            let adaptive = domain.take == crate::ir::Bound::Meter;
            let mut frozen = head.domain.clone();
            let mut frozen_upper = head.upper.clone();
            let mut size = if adaptive { if head.cursor.is_none() || head.run.chunk_size == 0 { 64 } else { head.run.chunk_size } } else { domain.take.maximum() as u32 };
            loop {
                tx.savepoint("job_chunk")?;
                let seq = tx.next_seq()?;
                let mut context = Context::system().at(now).with_presence(presence.clone()).with_minter(self.minter.clone());
                context.args = head.args.clone();
                context = context.with_generation(self.generation);
                let mut runner = Runner::new(&tx, &self.schema, context, Meter::new(Ceilings::job(), Cut::Abort), seq);
                runner.job_read_scope = 1;
                runner.insert_uses = Some(crate::ir::effects::Effects::variable_uses(&program.body));

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
                        Some(upper) => sweep_chunk(runner, scan, head.cursor.as_deref(), &upper, binding, body, &site, adaptive, started, budget).map(|chunk| (chunk, Some(upper))),
                        None => Ok((Chunk { last_key: None, visited: 0, ended: true, finished: false }, None)),
                    }
                })();
                let outcome = outcome.and_then(|chunk| runner.retire_expired_births().map(|_| chunk));
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
                            tx.append(seq, &events)?;
                            tx.record_effects(&outbox, seq, now, self.dev_effects, &self.schema)?;
                        }
                        let (next_sweep, cursor, upper) = if chunk.finished { (sweeps.len(), None, None) } else if chunk.ended { (sweep + 1, None, None) } else { (sweep, chunk.last_key, upper) };
                        let state = if next_sweep >= sweeps.len() { JobState::Done } else { JobState::Running };
                        tx.record_job_chunk(JobChunkUpdate {
                            id: &head.run.id, state, sweep: next_sweep,
                            cursor: cursor.as_deref(), upper: upper.as_deref(), rows_written, now,
                            size, retries: head.run.retries, heap_peak: head.run.heap_peak,
                            domain: if next_sweep == sweep { frozen.as_ref() } else { None },
                        })?;
                        return tx.complete(Some(head.run.id));
                    }
                    Err(error) if error.is_refusal() => {
                        tx.rollback_to("job_chunk")?;
                        // @ref LLP 3000.013#5.2 — retry the same atomic chunk; only a one-item meter refusal parks an adaptive sweep.
                        if adaptive && size > 1 && matches!(error, RuntimeError::Bound { .. } | RuntimeError::AuthorizationBudget { .. }) {
                            size /= 2;
                            head.run.retries += 1;
                            continue;
                        }
                        let refusal = error.refusal();
                        tx.park_job_chunk(&head.run.id, &format!("{}: {}", refusal.code, refusal.message), now, size, head.run.retries, head.run.heap_peak)?;
                        return tx.complete(Some(head.run.id));
                    }
                    Err(error) => {
                        tx.rollback(())?;
                        return Err(error);
                    }
                }
            }
        }))?;
        match id {
            Some(id) => self.job(&id),
            None => Ok(None),
        }
    }

    /// Queue the job of every schedule whose period boundary the clock has
    /// crossed since it last fired, with the period that ended there as
    /// `periodStart`/`periodEnd` when the job declares them. The boundary
    /// fired for is committed with the job row, so a restart never fires
    /// twice for one period; a schedule seen for the first time fires from
    /// its next boundary. Returns the names fired.
    pub fn fire_schedules(&mut self, now: i64) -> Result<Vec<String>, RuntimeError> {
        self.fire_schedule_range(now, 0..self.schema.schedules.len(), None)
    }

    /// One atomic schedule boundary, so the host can release its writer between
    /// schedules. A changed/shortened schema is revisited on the next tick.
    pub fn fire_schedule_at(&mut self, now: i64, index: usize) -> Result<Vec<String>, RuntimeError> {
        self.fire_schedule_range(now, index..index.saturating_add(1), None)
    }

    /// Admit one historical period on the current clock. In particular an
    /// action's deadline begins at admission, not at the historical boundary.
    // @ref LLP 3000.007#20.12.1 — period identity and admission time are distinct during explicit catch-up.
    pub fn fire_schedule_boundary_at(&mut self, now: i64, index: usize, boundary: i64) -> Result<Vec<String>, RuntimeError> {
        let schedule = self.schema.schedules.get(index).ok_or_else(|| RuntimeError::Input("unknown schedule index".into()))?;
        if schedule.boundary(boundary) != boundary || boundary > schedule.boundary(now) {
            return Err(RuntimeError::Input("schedule window must end at an elapsed boundary".into()));
        }
        self.fire_schedule_range(now, index..index.saturating_add(1), Some(boundary))
    }

    fn fire_schedule_range(&mut self, now: i64, range: std::ops::Range<usize>, selected: Option<i64>) -> Result<Vec<String>, RuntimeError> {
        let mut fired = Vec::new();
        for schedule in self.schema.schedules.get(range).unwrap_or(&[]).to_vec() {
            let boundary = selected.unwrap_or_else(|| schedule.boundary(now));
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
            let previous_shape: Option<String> = tx.schedule_shape(&schedule.name)?;
            if previous_shape.as_ref().is_some_and(|previous| previous != &shape) {
                tx.set_schedule_boundary(&schedule.name, boundary)?;
                tx.set_schedule_shape(&schedule.name, &shape)?;
                tx.commit()?;
                continue;
            }
            tx.set_schedule_shape(&schedule.name, &shape)?;
            let last: Option<i64> = tx.schedule_boundary(&schedule.name)?;
            if last.is_some_and(|last| last >= boundary) {
                tx.commit()?;
                continue;
            }
            let Some(_) = last else {
                tx.set_schedule_boundary(&schedule.name, boundary)?;
                tx.commit()?;
                continue;
            };
            let mut args = BTreeMap::new();
            if program.args.contains_key("periodStart") {
                args.insert("periodStart".to_owned(), Value::Int(schedule.previous(boundary)));
            }
            if program.args.contains_key("periodEnd") {
                args.insert("periodEnd".to_owned(), Value::Int(boundary));
            }
            let id = crate::ids::mint(now, &mut self.minter)?;
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
                tx.insert_job(&id, &schedule.target, &args, &program_hash, now)?;
            }
            tx.set_schedule_boundary(&schedule.name, boundary)?;
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
fn native_chunk(tx: super::committer::MemberTx<'_, '_>, schema: &crate::schema::Schema, module: Option<&super::native::Module>, logs: &mut super::native::Logs, minter: crate::ids::Mint, head: Head, program: &crate::ir::Program, now: i64, dev: bool) -> Result<super::committer::Disposition<()>, RuntimeError> {
    use super::native::{self, Step};
    tx.savepoint("job_chunk")?;
    let seq = tx.next_seq()?;
    let mut context = Context::system().at(now).with_minter(minter);
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
                tx.append(seq, &outcome.events)?;
                tx.record_effects(&outcome.outbox, seq, now, dev, schema)?;
            }
            let (state, cursor) = match step {
                Step::Done => (JobState::Done, None),
                Step::Again(state) => (JobState::Running, Some(state.to_string().into_bytes())),
            };
            tx.record_native_job_chunk(&head.run.id, state, cursor.as_deref(), outcome.rows_written, now)?;
            tx.complete(())
        }
        Err(error) if error.is_refusal() => {
            tx.rollback_to("job_chunk")?;
            let refusal = error.refusal();
            tx.park_job(&head.run.id, &format!("{}: {}", refusal.code, refusal.message), now)?;
            tx.complete(())
        }
        Err(error) => {
            tx.rollback(())?;
            Err(error)
        }
    }
}

/// Built without native jobs: a native job parks, saying so.
#[cfg(not(feature = "native"))]
fn native_chunk(tx: super::committer::MemberTx<'_, '_>, head: Head, program: &crate::ir::Program, now: i64) -> Result<super::committer::Disposition<()>, RuntimeError> {
    tx.park_job(&head.run.id, &format!("E_NATIVE: job {} is native and this server was built without native jobs", program.name), now)?;
    tx.complete(())
}

/// Adapter-neutral cases: each adapter supplies its own transaction lifecycle.
#[cfg(test)]
pub(crate) mod test_cases;
