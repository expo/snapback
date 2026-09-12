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
}

const COLUMNS: &str = "id, name, args, program_hash, state, sweep, cursor, upper, chunks, rows_written, created_at, updated_at, error";

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
        },
        args: args.as_object().map(|fields| fields.clone()).unwrap_or_default(),
        program_hash: row.get(3)?,
        cursor: row.get::<_, Option<String>>(6)?.and_then(|hex| decode_bytes_hex(&hex)),
        upper: row.get::<_, Option<String>>(7)?.and_then(|hex| decode_bytes_hex(&hex)),
    })
}

fn insert_job(conn: &Connection, id: &str, name: &str, args: &BTreeMap<String, Value>, program_hash: &str, now: i64) -> Result<(), RuntimeError> {
    conn.execute(
        "INSERT INTO _jobs(id, name, args, program_hash, state, sweep, cursor, upper, chunks, rows_written, created_at, updated_at, error) VALUES (?1, ?2, ?3, ?4, 'queued', 0, NULL, NULL, 0, 0, ?5, ?5, NULL)",
        params![id, name, canonical_json(&Value::Map(args.clone().into())), program_hash, now],
    )?;
    Ok(())
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
fn sweep_chunk(runner: &mut Runner<'_>, scan: &Scan, cursor: Option<&[u8]>, upper: &[u8], binding: &str, body: &[Stmt], site: &str) -> Result<Chunk, RuntimeError> {
    let take = scan.take.maximum() as usize;
    let mut page = scan.clone();
    page.opaque_cursor = false;
    page.after = cursor.map(|key| Box::new(Expr::Literal(Value::Array(crate::key::decode(key).unwrap_or_default().into_iter().skip(scan.prefix.len()).collect()))));
    let (rows, keys) = runner.scan_with_keys(&page)?;
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
        let id = crate::ids::mint(now, &mut self.entropy);
        insert_job(self.store.conn(), &id, name, &args, &digest(&program), now)?;
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
        let head = self.store.conn().query_row(&format!("SELECT {COLUMNS} FROM _jobs WHERE state IN ('queued', 'running') ORDER BY created_at, id LIMIT 1"), [], read_head).optional()?;
        let Some(head) = head else { return Ok(None) };
        let program = self.programs.get(&head.run.name).cloned();
        let Some(program) = program.filter(|program| digest(program) == head.program_hash) else {
            return self.park(&head.run.id, now, "E_JOB_GENERATION", &format!("job {} changed (or went away) since this run was queued; queue it again", head.run.name));
        };
        let sweeps: Vec<(&str, &Scan, &[Stmt])> = program.body.iter().filter_map(|stmt| match stmt { Stmt::For { binding, domain: LoopDomain::Page(scan), body } => Some((binding.as_str(), scan, body.as_slice())), _ => None }).collect();
        let sweep = head.run.sweep as usize;
        if sweep >= sweeps.len() {
            return self.finish(&head.run.id, now, sweeps.len());
        }
        let (binding, scan, body) = sweeps[sweep];
        let tx = self.store.transaction()?;
        let seq = tx.next_seq()?;
        let mut context = Context::system().at(now);
        context.args = head.args.clone();
        let mut runner = Runner::new(&tx, &self.schema, context, Meter::new(Ceilings::job(), Cut::Abort), seq);
        // The sweep's upper key is captured when it begins: a row the body
        // inserts beyond it is never visited, so a sweep over its own
        // table ends.
        let upper = match &head.upper {
            Some(upper) => Ok(Some(upper.clone())),
            None => runner.prefix_values(scan).and_then(|prefix| Ok(tx.scan(&scan.table, &scan.index, &prefix, &Bounds::default(), Dir::Desc, 1)?.pop().map(|(_, key)| key))),
        };
        let site = format!("{}:{}", program.name, sweep + 1);
        let outcome = match upper {
            Ok(Some(upper)) => sweep_chunk(&mut runner, scan, head.cursor.as_deref(), &upper, binding, body, &site).map(|chunk| (chunk, Some(upper))),
            Ok(None) => Ok((Chunk { last_key: None, visited: 0, ended: true, finished: false }, None)),
            Err(error) => Err(error),
        };
        let events = std::mem::take(&mut runner.events);
        let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
        let outbox = std::mem::take(&mut runner.outbox);
        let rows_written = runner.rows_written;
        drop(runner);
        match outcome {
            Ok((chunk, upper)) => {
                if rows_written > 0 || !events.is_empty() {
                    tx.record_commit(seq, now, &head.run.name, crate::SYSTEM_PRINCIPAL, "job", &tables, rows_written)?;
                    partition::append(&tx, seq, &events)?;
                    for (id, effect, payload) in &outbox {
                        tx.conn().execute("INSERT INTO _outbox(id, seq, effect, payload, state, attempts, at) VALUES (?1, ?2, ?3, ?4, 'queued', 0, ?5)", params![id, seq as i64, effect, canonical_json(payload), now])?;
                    }
                }
                let (next_sweep, cursor, upper) = if chunk.finished { (sweeps.len(), None, None) } else if chunk.ended { (sweep + 1, None, None) } else { (sweep, chunk.last_key, upper) };
                let state = if next_sweep >= sweeps.len() { JobState::Done } else { JobState::Running };
                tx.conn().execute(
                    "UPDATE _jobs SET state = ?2, sweep = ?3, cursor = ?4, upper = ?5, chunks = chunks + 1, rows_written = rows_written + ?6, updated_at = ?7 WHERE id = ?1",
                    params![head.run.id, state.word(), next_sweep as i64, cursor.as_deref().map(encode_bytes_hex), upper.as_deref().map(encode_bytes_hex), rows_written as i64, now],
                )?;
                tx.commit()?;
                Ok(self.job(&head.run.id)?)
            }
            Err(error) if error.is_refusal() => {
                tx.rollback()?;
                let refusal = error.refusal();
                self.park(&head.run.id, now, &refusal.code, &refusal.message)
            }
            Err(error) => {
                tx.rollback()?;
                Err(error)
            }
        }
    }

    fn park(&mut self, id: &str, now: i64, code: &str, message: &str) -> Result<Option<JobRun>, RuntimeError> {
        self.store.conn().execute("UPDATE _jobs SET state = 'parked', error = ?2, updated_at = ?3 WHERE id = ?1", params![id, format!("{code}: {message}"), now])?;
        self.job(id)
    }

    fn finish(&mut self, id: &str, now: i64, sweeps: usize) -> Result<Option<JobRun>, RuntimeError> {
        self.store.conn().execute("UPDATE _jobs SET state = 'done', sweep = ?2, cursor = NULL, upper = NULL, updated_at = ?3 WHERE id = ?1", params![id, sweeps as i64, now])?;
        self.job(id)
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
            let last: Option<i64> = self.store.meta(&key)?.and_then(|value| value.parse().ok());
            if last == Some(boundary) {
                continue;
            }
            let program = self.programs.get(&schedule.target).cloned();
            let (Some(program), Some(_)) = (program, last) else {
                self.store.set_meta(&key, &boundary.to_string())?;
                continue;
            };
            let mut args = BTreeMap::new();
            if program.args.contains_key("periodStart") {
                args.insert("periodStart".to_owned(), Value::Int(boundary - schedule.every_ms as i64));
            }
            if program.args.contains_key("periodEnd") {
                args.insert("periodEnd".to_owned(), Value::Int(boundary));
            }
            let id = crate::ids::mint(now, &mut self.entropy);
            let tx = self.store.transaction()?;
            insert_job(tx.conn(), &id, &schedule.target, &args, &digest(&program), now)?;
            tx.conn().execute("INSERT INTO _meta(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, boundary.to_string()])?;
            tx.commit()?;
            fired.push(schedule.name.clone());
        }
        Ok(fired)
    }
}
