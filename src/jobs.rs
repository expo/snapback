//! Durable one-off background work — the first implementation slice of
//! LLP 0070's `durable-work-single-process-sqlite-v1` profile (the `runAfter`
//! case): transactional `ctx.jobs.enqueue` from mutations, a paved default
//! queue, `availableAt = now + delay`, fenced claims with append-only attempt
//! receipts, and a set-based injected-clock drain as the deterministic test
//! seam.
//!
//! Claim boundary (LLP 0070 §Non-goals): while LLP 0070 is Draft, nothing in
//! this module claims the `durable-work-single-process-sqlite-v1` tuple or any
//! durable-background-work capability class. The code exists to carry the
//! executable evidence the Draft needs; capability facts emitted anywhere must
//! say `experimental` and name the boundary.
//!
//! @ref LLP 0070#semantics — job identity/enqueue, state machine, claims and
//! fencing, and the jitter profile implemented here follow the RFC's §Semantics;
//! deliberate v1 narrowings are the RFC body's "First slice as shipped"
//! section (the 2026-07-31 amendment note, absorbed 2026-08-01).

use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// The paved default queue (LLP 0121 OQ1): `ctx.jobs.enqueue` requires zero
/// app-side queue declaration in v1; every job lands on this queue with the
/// paved limits below published as target facts.
pub const JOBS_DEFAULT_QUEUE: &str = "default";

/// The pseudo-table name job state changes are published under for live
/// matching and captured read dependencies. It is not an application schema
/// table: only the generated declared job-status query reads it, and only job
/// lifecycle transitions write it (LLP 0121 option 3 — a declared operation,
/// not an ambient system table).
pub const JOBS_STATUS_TABLE: &str = "_snapback_jobs";

/// Paved v1 limits — published, not configurable per-app in this slice.
pub const JOBS_MAX_ENQUEUES_PER_MUTATION: usize = 16;
pub const JOBS_MAX_DELAY_MS: u64 = 2_592_000_000; // 30 days
pub const JOBS_MAX_ARGS_BYTES: usize = 65_536;
pub const JOBS_MAX_IDEMPOTENCY_KEY_BYTES: usize = 200;
pub const JOBS_MAX_ATTEMPTS_CEILING: u32 = 8;
pub const JOBS_DEFAULT_MAX_ATTEMPTS: u32 = 1;
pub const JOBS_LEASE_MS: u64 = 30_000;
pub const JOBS_CLAIM_BATCH: usize = 64;
pub const JOBS_DRAIN_MAX_WAVES: usize = 16;
pub const JOBS_BACKOFF_BASE_MS: u64 = 1_000;
pub const JOBS_BACKOFF_CAP_MS: u64 = 60_000;
pub const JOBS_JITTER_CEILING_MS: u64 = 1_000;

/// One enqueue buffered by a mutation handler, carried with the mutation's
/// other buffered effects to the single SQLite commit. Validation happened at
/// the host op (shape/limits) and at staging (callee admission); insertion
/// happens inside the mutation's own transaction, so rollback leaves no job.
///
/// @ref LLP 0070#job-identity-and-enqueue — validation and insertion occur in
/// the same database transaction as the mutation's ordinary writes.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct BufferedJobEnqueue {
    /// Allocated through the invocation's ctx-answer ledger (LLP 0051 D1), so
    /// job identity is stable under record/replay — the deterministic-identity
    /// half of the drain seam (LLP 0121 open question 9, decided for v1).
    pub job_id: String,
    pub queue: String,
    pub action: String,
    pub args: Value,
    pub idempotency_key: Option<String>,
    pub max_attempts: u32,
    pub available_at_ms: u64,
}

/// Producer provenance recorded on every job row inserted by one mutation
/// commit (0127 decision 7: LLP 0070 owns the enqueue-association shape; the
/// job row carries the producing mutation's identity and committed snapshot
/// version).
#[derive(Clone, Debug, PartialEq)]
pub struct JobProducer {
    pub mutation_id: String,
    pub function: String,
    pub principal: Option<String>,
}

/// The bounded per-enqueue fact echoed on the producing mutation's receipt —
/// the mutation-side half of the association (jobId/action/availableAt only;
/// never argument values).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct JobEnqueueFact {
    #[serde(rename = "jobId")]
    pub job_id: String,
    pub action: String,
    #[serde(rename = "availableAtMs")]
    pub available_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum JobState {
    Pending,
    Claimed,
    Succeeded,
    Dead,
    Cancelled,
}

impl JobState {
    pub fn as_str(self) -> &'static str {
        match self {
            JobState::Pending => "pending",
            JobState::Claimed => "claimed",
            JobState::Succeeded => "succeeded",
            JobState::Dead => "dead",
            JobState::Cancelled => "cancelled",
        }
    }

    fn parse(value: &str) -> SnapbackResult<Self> {
        Ok(match value {
            "pending" => JobState::Pending,
            "claimed" => JobState::Claimed,
            "succeeded" => JobState::Succeeded,
            "dead" => JobState::Dead,
            "cancelled" => JobState::Cancelled,
            other => {
                return Err(SnapbackError::error(
                    "SNAPBACK_JOB_STATE_INVALID",
                    "jobs",
                    format!("stored job state {other:?} is outside the closed v1 vocabulary"),
                ));
            }
        })
    }
}

/// The privacy-bounded job-status projection: lifecycle facts only — opaque
/// ids, action/queue names, timestamps, counters, and diagnostic codes; never
/// argument values or result payloads (the receipt-grade privacy rule of
/// LLP 0034 §3.3 applied to the jobs family).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct JobStatusRow {
    #[serde(rename = "jobId")]
    pub job_id: String,
    pub queue: String,
    pub action: String,
    pub state: JobState,
    #[serde(rename = "availableAtMs")]
    pub available_at_ms: u64,
    #[serde(rename = "enqueuedAtMs")]
    pub enqueued_at_ms: u64,
    #[serde(rename = "attemptCount")]
    pub attempt_count: u32,
    #[serde(rename = "maxAttempts")]
    pub max_attempts: u32,
    #[serde(rename = "stateVersion")]
    pub state_version: u64,
    #[serde(rename = "terminalAtMs")]
    pub terminal_at_ms: Option<u64>,
    #[serde(rename = "lastErrorCode")]
    pub last_error_code: Option<String>,
    #[serde(rename = "producerMutationId")]
    pub producer_mutation_id: String,
    #[serde(rename = "producerSnapshotVersion")]
    pub producer_snapshot_version: Option<u64>,
    #[serde(rename = "producerFunction")]
    pub producer_function: String,
}

impl JobStatusRow {
    /// The row shape served by the declared job-status query and published on
    /// job ChangedRows. `_id` mirrors `jobId` so the generic live machinery's
    /// row-identity conventions hold.
    pub fn to_row_value(&self) -> Value {
        json!({
            "_id": self.job_id,
            "jobId": self.job_id,
            "queue": self.queue,
            "action": self.action,
            "state": self.state.as_str(),
            "availableAtMs": self.available_at_ms,
            "enqueuedAtMs": self.enqueued_at_ms,
            "attemptCount": self.attempt_count,
            "maxAttempts": self.max_attempts,
            "stateVersion": self.state_version,
            "terminalAtMs": self.terminal_at_ms,
            "lastErrorCode": self.last_error_code,
            "producerMutationId": self.producer_mutation_id,
            "producerSnapshotVersion": self.producer_snapshot_version,
            "producerFunction": self.producer_function,
        })
    }
}

/// Append-only attempt receipt (LLP 0070's receipt family: immutable job
/// intent + append-only attempts). Rows are inserted at claim and completed at
/// terminal publication; a superseded claim's row keeps its own outcome and a
/// stale finisher cannot rewrite a successor's.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct JobAttemptRecord {
    #[serde(rename = "jobId")]
    pub job_id: String,
    pub attempt: u32,
    #[serde(rename = "claimId")]
    pub claim_id: String,
    pub fence: u64,
    #[serde(rename = "claimedAtMs")]
    pub claimed_at_ms: u64,
    #[serde(rename = "leaseExpiresAtMs")]
    pub lease_expires_at_ms: u64,
    pub drive: String,
    #[serde(rename = "finishedAtMs")]
    pub finished_at_ms: Option<u64>,
    pub outcome: Option<String>,
    #[serde(rename = "diagnosticCode")]
    pub diagnostic_code: Option<String>,
}

/// One claimed job handed to the executor: the immutable intent plus the
/// fenced claim facts the finish CAS must present.
#[derive(Clone, Debug)]
pub struct ClaimedJob {
    pub job_id: String,
    pub queue: String,
    pub action: String,
    pub args: Value,
    pub attempt: u32,
    pub max_attempts: u32,
    pub claim_id: String,
    pub fence: u64,
    pub claimed_at_ms: u64,
    pub lease_expires_at_ms: u64,
    pub idempotency_key: Option<String>,
}

impl ClaimedJob {
    /// Bounded admission facts for the non-billable scheduled wrapper. The
    /// action itself is observed independently as a logical function run.
    ///
    /// @ref LLP 0154#d2--the-observation-span-classification-registry-and-phase-1-kinds
    pub(crate) fn telemetry_details(&self) -> Value {
        serde_json::json!({ "attempt": self.attempt, "trigger": "job" })
    }
}

/// Terminal classification a finished attempt publishes.
#[derive(Clone, Debug)]
pub enum JobAttemptOutcome {
    Succeeded,
    /// Handler failure: retryable until attempts are exhausted, then dead.
    Failed(Diagnostic),
}

/// What `finish_job_in_tx` durably decided.
#[derive(Clone, Debug, PartialEq)]
pub enum JobFinishDisposition {
    Succeeded,
    /// Re-pended for a later attempt at the returned `available_at_ms`.
    RetryPending {
        available_at_ms: u64,
    },
    Dead,
    /// The claim's fence was superseded or the job state moved on; nothing
    /// about the job changed. The stale attempt row keeps its own outcome.
    StalePublication,
}

/// One drained attempt's synchronous receipt — what the injected-clock drain
/// returns to its caller (the acceptance seam's "returns receipts
/// synchronously"). Lifecycle facts and codes only.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct JobDrainRecord {
    #[serde(rename = "jobId")]
    pub job_id: String,
    pub queue: String,
    pub action: String,
    pub attempt: u32,
    #[serde(rename = "claimId")]
    pub claim_id: String,
    pub fence: u64,
    /// `succeeded` | `retry_pending` | `dead` | `stale_publication`.
    pub disposition: String,
    #[serde(rename = "diagnosticCode")]
    pub diagnostic_code: Option<String>,
    #[serde(rename = "nextAvailableAtMs")]
    pub next_available_at_ms: Option<u64>,
}

impl JobDrainRecord {
    pub(crate) fn telemetry_terminal(&self) -> (i64, Option<&str>) {
        match self.disposition.as_str() {
            "succeeded" => (200, None),
            "retry_pending" | "dead" => (500, self.diagnostic_code.as_deref()),
            "stale_publication" => (409, None),
            _ => (500, self.diagnostic_code.as_deref()),
        }
    }
}

pub fn create_jobs_infra(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS _snapback_jobs_v1 (
          job_id TEXT PRIMARY KEY,
          queue TEXT NOT NULL,
          action TEXT NOT NULL,
          args_json TEXT NOT NULL,
          args_digest TEXT NOT NULL,
          idempotency_key TEXT,
          available_at_ms INTEGER NOT NULL,
          enqueued_at_ms INTEGER NOT NULL,
          max_attempts INTEGER NOT NULL,
          producer_mutation_id TEXT NOT NULL,
          producer_snapshot_version INTEGER,
          producer_function TEXT NOT NULL,
          producer_principal TEXT,
          state TEXT NOT NULL,
          state_version INTEGER NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          current_claim_id TEXT,
          current_fence INTEGER NOT NULL DEFAULT 0,
          claim_expires_at_ms INTEGER,
          terminal_at_ms INTEGER,
          last_error_code TEXT
        );
        CREATE INDEX IF NOT EXISTS _snapback_jobs_v1_due
          ON _snapback_jobs_v1(state, available_at_ms, job_id);
        CREATE UNIQUE INDEX IF NOT EXISTS _snapback_jobs_v1_idem
          ON _snapback_jobs_v1(queue, action, idempotency_key)
          WHERE idempotency_key IS NOT NULL;
        CREATE TABLE IF NOT EXISTS _snapback_job_attempts_v1 (
          job_id TEXT NOT NULL,
          attempt INTEGER NOT NULL,
          claim_id TEXT NOT NULL,
          fence INTEGER NOT NULL,
          claimed_at_ms INTEGER NOT NULL,
          lease_expires_at_ms INTEGER NOT NULL,
          drive TEXT NOT NULL,
          finished_at_ms INTEGER,
          outcome TEXT,
          diagnostic_code TEXT,
          PRIMARY KEY (job_id, attempt)
        );
        ",
    )?;
    Ok(())
}

/// Canonical argument bytes and their digest (LLP 0070: canonical,
/// validator-checked argument bytes and their digest). Canonicalization is
/// recursive key sort; the digest is over the serialized canonical form.
pub fn canonical_args(args: &Value) -> SnapbackResult<(String, String)> {
    let canonical = canonical_json_value(args.clone());
    let encoded = serde_json::to_string(&canonical).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_JOB_ARGS_INVALID",
            "jobs",
            "job arguments could not be canonically serialized",
        )
        .with_details(json!({ "error": error.to_string() }))
    })?;
    if encoded.len() > JOBS_MAX_ARGS_BYTES {
        return Err(SnapbackError::error(
            "SNAPBACK_JOB_ARGS_TOO_LARGE",
            "jobs",
            format!(
                "job arguments exceed the paved v1 limit of {JOBS_MAX_ARGS_BYTES} canonical bytes"
            ),
        )
        .with_details(json!({
            "canonicalBytes": encoded.len(),
            "maximum": JOBS_MAX_ARGS_BYTES,
        })));
    }
    let mut digest = Sha256::new();
    digest.update(b"snapback:job-args:v1\n");
    digest.update(encoded.as_bytes());
    Ok((encoded, format!("sha256:{:x}", digest.finalize())))
}

fn canonical_json_value(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, canonical_json_value(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect::<Map<_, _>>(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(canonical_json_value).collect()),
        other => other,
    }
}

/// The v1 retry jitter profile, exactly as LLP 0070 §Execution and retries
/// pins it: `u64be(SHA256("snapback-job-jitter-v1" || 0x00 || canonicalJobId
/// || u32be(attemptNumber))[0..8])` mapped modulo `(ceiling + 1)`, added to
/// the saturated exponential base delay with checked u64 arithmetic.
pub fn retry_delay_ms(job_id: &str, attempt: u32) -> u64 {
    let exponent = attempt.saturating_sub(1).min(32);
    let base = JOBS_BACKOFF_BASE_MS
        .checked_shl(exponent)
        .unwrap_or(JOBS_BACKOFF_CAP_MS)
        .min(JOBS_BACKOFF_CAP_MS);
    let mut digest = Sha256::new();
    digest.update(b"snapback-job-jitter-v1");
    digest.update([0x00]);
    digest.update(job_id.as_bytes());
    digest.update(attempt.to_be_bytes());
    let bytes = digest.finalize();
    let mut prefix = [0u8; 8];
    prefix.copy_from_slice(&bytes[0..8]);
    let jitter = u64::from_be_bytes(prefix) % (JOBS_JITTER_CEILING_MS + 1);
    base.saturating_add(jitter)
}

/// An existing job found under a scoped idempotency key.
pub struct ExistingIdempotentJob {
    pub job_id: String,
    pub args_digest: String,
    pub max_attempts: u32,
    pub available_at_ms: u64,
}

pub fn find_job_by_scoped_idempotency(
    conn: &Connection,
    queue: &str,
    action: &str,
    idempotency_key: &str,
) -> SnapbackResult<Option<ExistingIdempotentJob>> {
    Ok(conn
        .query_row(
            "SELECT job_id, args_digest, max_attempts, available_at_ms
               FROM _snapback_jobs_v1
              WHERE queue = ?1 AND action = ?2 AND idempotency_key = ?3",
            params![queue, action, idempotency_key],
            |row| {
                Ok(ExistingIdempotentJob {
                    job_id: row.get(0)?,
                    args_digest: row.get(1)?,
                    max_attempts: row.get(2)?,
                    available_at_ms: row.get(3)?,
                })
            },
        )
        .optional()?)
}

pub fn idempotency_key_reused(queue: &str, action: &str, idempotency_key: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED",
        "jobs",
        "the scoped idempotency key is already bound to a job with different action, args, or policy",
    )
    .with_details(json!({
        "queue": queue,
        "action": action,
        // The key is application-chosen and may be sensitive; report length only.
        "idempotencyKeyBytes": idempotency_key.len(),
    }))
}

/// Insert the mutation's buffered enqueues inside its own open transaction.
/// Returns the per-job facts for the mutation receipt plus the status rows
/// for live fan-out. A scoped-idempotency conflict discovered here (a job
/// inserted since the handler's read snapshot) fails the whole transaction:
/// byte-identical intents get a typed raced code (a retry converges on the
/// existing job at the handler's execution-time lookup), and divergent reuse
/// gets the fail-closed reuse code.
pub fn insert_enqueued_jobs_in_tx(
    tx: &Connection,
    producer: &JobProducer,
    snapshot_version: u64,
    enqueues: &[BufferedJobEnqueue],
    now_ms: u64,
) -> SnapbackResult<Vec<JobStatusRow>> {
    let mut rows = Vec::with_capacity(enqueues.len());
    for enqueue in enqueues {
        let (canonical, digest) = canonical_args(&enqueue.args)?;
        if let Some(key) = enqueue.idempotency_key.as_deref()
            && let Some(existing) =
                find_job_by_scoped_idempotency(tx, &enqueue.queue, &enqueue.action, key)?
        {
            if existing.args_digest == digest && existing.max_attempts == enqueue.max_attempts {
                return Err(SnapbackError::error(
                    "SNAPBACK_JOB_IDEMPOTENCY_KEY_RACED",
                    "jobs",
                    "an identical idempotent job was inserted concurrently; retry the mutation to observe it",
                )
                .with_details(json!({ "jobId": existing.job_id })));
            }
            return Err(idempotency_key_reused(&enqueue.queue, &enqueue.action, key));
        }
        tx.execute(
            "INSERT INTO _snapback_jobs_v1 (
               job_id, queue, action, args_json, args_digest, idempotency_key,
               available_at_ms, enqueued_at_ms, max_attempts,
               producer_mutation_id, producer_snapshot_version, producer_function,
               producer_principal, state, state_version, attempt_count,
               current_claim_id, current_fence, claim_expires_at_ms,
               terminal_at_ms, last_error_code
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                       'pending', 1, 0, NULL, 0, NULL, NULL, NULL)",
            params![
                enqueue.job_id,
                enqueue.queue,
                enqueue.action,
                canonical,
                digest,
                enqueue.idempotency_key,
                enqueue.available_at_ms,
                now_ms,
                enqueue.max_attempts,
                producer.mutation_id,
                snapshot_version,
                producer.function,
                producer.principal,
            ],
        )?;
        rows.push(JobStatusRow {
            job_id: enqueue.job_id.clone(),
            queue: enqueue.queue.clone(),
            action: enqueue.action.clone(),
            state: JobState::Pending,
            available_at_ms: enqueue.available_at_ms,
            enqueued_at_ms: now_ms,
            attempt_count: 0,
            max_attempts: enqueue.max_attempts,
            state_version: 1,
            terminal_at_ms: None,
            last_error_code: None,
            producer_mutation_id: producer.mutation_id.clone(),
            producer_snapshot_version: Some(snapshot_version),
            producer_function: producer.function.clone(),
        });
    }
    Ok(rows)
}

/// Set-based claim: every eligible job with `available_at_ms <= now_ms`, in
/// the deterministic v1 order (`available_at_ms`, then canonical job-id
/// bytes), up to the batch bound. Eligible means `pending`, or `claimed` with
/// an expired lease (the successor-claim path: the expired attempt receives
/// its terminal outcome and the successor takes a strictly greater fence).
///
/// The claim runs in ONE transaction — a concurrent drain cannot double-claim
/// (the exactly-once-per-attempt-fence property the acceptance suite pins).
pub fn claim_due_jobs_in_tx(
    tx: &Connection,
    now_ms: u64,
    limit: usize,
    drive: &str,
    claim_id_source: &mut dyn FnMut() -> String,
) -> SnapbackResult<Vec<ClaimedJob>> {
    struct DueJob {
        job_id: String,
        queue: String,
        action: String,
        args_json: String,
        max_attempts: u32,
        state: String,
        state_version: u64,
        attempt_count: u32,
        current_fence: u64,
        current_claim_id: Option<String>,
        claim_expires_at_ms: Option<u64>,
        idempotency_key: Option<String>,
    }
    let mut statement = tx.prepare(
        "SELECT job_id, queue, action, args_json, max_attempts, state,
                state_version, attempt_count, current_fence, current_claim_id,
                claim_expires_at_ms, idempotency_key
           FROM _snapback_jobs_v1
          WHERE available_at_ms <= ?1
            AND (state = 'pending'
                 OR (state = 'claimed' AND claim_expires_at_ms IS NOT NULL
                     AND claim_expires_at_ms <= ?1))
          ORDER BY available_at_ms ASC, job_id ASC
          LIMIT ?2",
    )?;
    let due = statement
        .query_map(params![now_ms, limit as i64], |row| {
            Ok(DueJob {
                job_id: row.get(0)?,
                queue: row.get(1)?,
                action: row.get(2)?,
                args_json: row.get(3)?,
                max_attempts: row.get(4)?,
                state: row.get(5)?,
                state_version: row.get(6)?,
                attempt_count: row.get(7)?,
                current_fence: row.get(8)?,
                current_claim_id: row.get(9)?,
                claim_expires_at_ms: row.get(10)?,
                idempotency_key: row.get(11)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);

    let mut claims = Vec::with_capacity(due.len());
    for job in due {
        let state = JobState::parse(&job.state)?;
        if state == JobState::Claimed {
            // Successor claim over an expired lease: terminally record the
            // expired attempt before the new claim (LLP 0070 §Claims and
            // fencing). The stale worker keeps its attempt row; it can no
            // longer publish job state.
            let expired_claim_id = job.current_claim_id.clone().unwrap_or_default();
            tx.execute(
                "UPDATE _snapback_job_attempts_v1
                    SET finished_at_ms = ?1, outcome = 'lease_expired',
                        diagnostic_code = 'SNAPBACK_JOB_LEASE_EXPIRED'
                  WHERE job_id = ?2 AND attempt = ?3 AND claim_id = ?4
                    AND outcome IS NULL",
                params![
                    job.claim_expires_at_ms.unwrap_or(now_ms),
                    job.job_id,
                    job.attempt_count,
                    expired_claim_id
                ],
            )?;
        }
        let attempt = job.attempt_count + 1;
        if attempt > job.max_attempts {
            // An expired final attempt that never published: dead-letter it.
            let updated = tx.execute(
                "UPDATE _snapback_jobs_v1
                    SET state = 'dead', state_version = state_version + 1,
                        current_claim_id = NULL, claim_expires_at_ms = NULL,
                        terminal_at_ms = ?1,
                        last_error_code = 'SNAPBACK_JOB_ATTEMPTS_EXHAUSTED'
                  WHERE job_id = ?2 AND state = ?3 AND state_version = ?4",
                params![now_ms, job.job_id, job.state, job.state_version],
            )?;
            debug_assert_eq!(updated, 1, "single-transaction claim saw a stable row");
            continue;
        }
        let claim_id = claim_id_source();
        let fence = job.current_fence.checked_add(1).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_JOB_FENCE_EXHAUSTED",
                "jobs",
                "the per-job fencing token is exhausted and may never wrap",
            )
            .with_details(json!({ "jobId": job.job_id }))
        })?;
        let lease_expires_at_ms = now_ms.saturating_add(JOBS_LEASE_MS);
        let updated = tx.execute(
            "UPDATE _snapback_jobs_v1
                SET state = 'claimed', state_version = state_version + 1,
                    attempt_count = ?1, current_claim_id = ?2,
                    current_fence = ?3, claim_expires_at_ms = ?4
              WHERE job_id = ?5 AND state = ?6 AND state_version = ?7",
            params![
                attempt,
                claim_id,
                fence,
                lease_expires_at_ms,
                job.job_id,
                job.state,
                job.state_version
            ],
        )?;
        debug_assert_eq!(updated, 1, "single-transaction claim saw a stable row");
        tx.execute(
            "INSERT INTO _snapback_job_attempts_v1 (
               job_id, attempt, claim_id, fence, claimed_at_ms,
               lease_expires_at_ms, drive, finished_at_ms, outcome, diagnostic_code
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, NULL)",
            params![
                job.job_id,
                attempt,
                claim_id,
                fence,
                now_ms,
                lease_expires_at_ms,
                drive
            ],
        )?;
        let args = serde_json::from_str(&job.args_json).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_JOB_STATE_INVALID",
                "jobs",
                "stored job arguments are not valid JSON",
            )
            .with_details(json!({ "jobId": job.job_id, "error": error.to_string() }))
        })?;
        claims.push(ClaimedJob {
            job_id: job.job_id,
            queue: job.queue,
            action: job.action,
            args,
            attempt,
            max_attempts: job.max_attempts,
            claim_id,
            fence,
            claimed_at_ms: now_ms,
            lease_expires_at_ms,
            idempotency_key: job.idempotency_key,
        });
    }
    Ok(claims)
}

/// Atomic terminal publication for one attempt (LLP 0070 §Atomic result
/// publication, narrowed to the v1 slice): compare job state, claim id, and
/// fence in one transaction; append the attempt outcome; transition to
/// succeeded, retry-pending (with the deterministic backoff-plus-jitter
/// delay), or dead. A stale fence publishes nothing but its own attempt row's
/// outcome.
pub fn finish_job_in_tx(
    tx: &Connection,
    claim: &ClaimedJob,
    outcome: &JobAttemptOutcome,
    now_ms: u64,
) -> SnapbackResult<JobFinishDisposition> {
    let (attempt_outcome, diagnostic_code): (&str, Option<String>) = match outcome {
        JobAttemptOutcome::Succeeded => ("succeeded", None),
        JobAttemptOutcome::Failed(diagnostic) => {
            if claim.attempt >= claim.max_attempts {
                ("dead", Some(diagnostic.code.clone()))
            } else {
                ("retryable", Some(diagnostic.code.clone()))
            }
        }
    };
    // The attempt row is this claim's own receipt: record its outcome
    // (bounded, code-only) — but never rewrite an already-terminal attempt.
    // A successor claim may have terminally recorded this attempt as
    // lease_expired; the append-only ledger keeps that disposition, and the
    // stale finisher publishes nothing (LLP 0070 §Claims and fencing).
    tx.execute(
        "UPDATE _snapback_job_attempts_v1
            SET finished_at_ms = ?1, outcome = ?2, diagnostic_code = ?3
          WHERE job_id = ?4 AND attempt = ?5 AND claim_id = ?6
            AND outcome IS NULL",
        params![
            now_ms,
            attempt_outcome,
            diagnostic_code,
            claim.job_id,
            claim.attempt,
            claim.claim_id
        ],
    )?;
    let disposition = match outcome {
        JobAttemptOutcome::Succeeded => {
            let updated = tx.execute(
                "UPDATE _snapback_jobs_v1
                    SET state = 'succeeded', state_version = state_version + 1,
                        current_claim_id = NULL, claim_expires_at_ms = NULL,
                        terminal_at_ms = ?1, last_error_code = NULL
                  WHERE job_id = ?2 AND state = 'claimed'
                    AND current_claim_id = ?3 AND current_fence = ?4",
                params![now_ms, claim.job_id, claim.claim_id, claim.fence],
            )?;
            if updated == 1 {
                JobFinishDisposition::Succeeded
            } else {
                JobFinishDisposition::StalePublication
            }
        }
        JobAttemptOutcome::Failed(diagnostic) => {
            if claim.attempt >= claim.max_attempts {
                let updated = tx.execute(
                    "UPDATE _snapback_jobs_v1
                        SET state = 'dead', state_version = state_version + 1,
                            current_claim_id = NULL, claim_expires_at_ms = NULL,
                            terminal_at_ms = ?1, last_error_code = ?2
                      WHERE job_id = ?3 AND state = 'claimed'
                        AND current_claim_id = ?4 AND current_fence = ?5",
                    params![
                        now_ms,
                        diagnostic.code,
                        claim.job_id,
                        claim.claim_id,
                        claim.fence
                    ],
                )?;
                if updated == 1 {
                    JobFinishDisposition::Dead
                } else {
                    JobFinishDisposition::StalePublication
                }
            } else {
                let available_at_ms =
                    now_ms.saturating_add(retry_delay_ms(&claim.job_id, claim.attempt));
                let updated = tx.execute(
                    "UPDATE _snapback_jobs_v1
                        SET state = 'pending', state_version = state_version + 1,
                            current_claim_id = NULL, claim_expires_at_ms = NULL,
                            available_at_ms = ?1, last_error_code = ?2
                      WHERE job_id = ?3 AND state = 'claimed'
                        AND current_claim_id = ?4 AND current_fence = ?5",
                    params![
                        available_at_ms,
                        diagnostic.code,
                        claim.job_id,
                        claim.claim_id,
                        claim.fence
                    ],
                )?;
                if updated == 1 {
                    JobFinishDisposition::RetryPending { available_at_ms }
                } else {
                    JobFinishDisposition::StalePublication
                }
            }
        }
    };
    Ok(disposition)
}

pub fn job_status_row(conn: &Connection, job_id: &str) -> SnapbackResult<Option<JobStatusRow>> {
    let row = conn
        .query_row(
            "SELECT job_id, queue, action, state, available_at_ms, enqueued_at_ms,
                    attempt_count, max_attempts, state_version, terminal_at_ms,
                    last_error_code, producer_mutation_id,
                    producer_snapshot_version, producer_function
               FROM _snapback_jobs_v1 WHERE job_id = ?1",
            params![job_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, u64>(4)?,
                    row.get::<_, u64>(5)?,
                    row.get::<_, u32>(6)?,
                    row.get::<_, u32>(7)?,
                    row.get::<_, u64>(8)?,
                    row.get::<_, Option<u64>>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, Option<u64>>(12)?,
                    row.get::<_, String>(13)?,
                ))
            },
        )
        .optional()?;
    let Some((
        job_id,
        queue,
        action,
        state,
        available_at_ms,
        enqueued_at_ms,
        attempt_count,
        max_attempts,
        state_version,
        terminal_at_ms,
        last_error_code,
        producer_mutation_id,
        producer_snapshot_version,
        producer_function,
    )) = row
    else {
        return Ok(None);
    };
    Ok(Some(JobStatusRow {
        job_id,
        queue,
        action,
        state: JobState::parse(&state)?,
        available_at_ms,
        enqueued_at_ms,
        attempt_count,
        max_attempts,
        state_version,
        terminal_at_ms,
        last_error_code,
        producer_mutation_id,
        producer_snapshot_version,
        producer_function,
    }))
}

pub fn job_attempts(conn: &Connection, job_id: &str) -> SnapbackResult<Vec<JobAttemptRecord>> {
    let mut statement = conn.prepare(
        "SELECT job_id, attempt, claim_id, fence, claimed_at_ms,
                lease_expires_at_ms, drive, finished_at_ms, outcome, diagnostic_code
           FROM _snapback_job_attempts_v1
          WHERE job_id = ?1 ORDER BY attempt ASC",
    )?;
    let records = statement
        .query_map(params![job_id], |row| {
            Ok(JobAttemptRecord {
                job_id: row.get(0)?,
                attempt: row.get(1)?,
                claim_id: row.get(2)?,
                fence: row.get(3)?,
                claimed_at_ms: row.get(4)?,
                lease_expires_at_ms: row.get(5)?,
                drive: row.get(6)?,
                finished_at_ms: row.get(7)?,
                outcome: row.get(8)?,
                diagnostic_code: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(records)
}

pub fn list_job_status_rows(conn: &Connection, limit: usize) -> SnapbackResult<Vec<JobStatusRow>> {
    let mut statement = conn.prepare(
        "SELECT job_id FROM _snapback_jobs_v1
          ORDER BY enqueued_at_ms DESC, job_id DESC LIMIT ?1",
    )?;
    let ids = statement
        .query_map(params![limit as i64], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut rows = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(row) = job_status_row(conn, &id)? {
            rows.push(row);
        }
    }
    Ok(rows)
}

pub fn pending_job_count(conn: &Connection) -> SnapbackResult<u64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM _snapback_jobs_v1 WHERE state IN ('pending', 'claimed')",
        [],
        |row| row.get(0),
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        create_jobs_infra(&conn).expect("jobs infra");
        conn
    }

    fn producer() -> JobProducer {
        JobProducer {
            mutation_id: "mut_test".into(),
            function: "reportIncident".into(),
            principal: Some("user_1".into()),
        }
    }

    fn enqueue(job_id: &str, available_at_ms: u64) -> BufferedJobEnqueue {
        BufferedJobEnqueue {
            job_id: job_id.into(),
            queue: JOBS_DEFAULT_QUEUE.into(),
            action: "notify".into(),
            args: json!({ "b": 2, "a": 1 }),
            idempotency_key: None,
            max_attempts: 1,
            available_at_ms,
        }
    }

    #[test]
    fn canonical_args_sorts_keys_and_digests_stably() {
        let (bytes_a, digest_a) = canonical_args(&json!({ "b": 2, "a": 1 })).unwrap();
        let (bytes_b, digest_b) = canonical_args(&json!({ "a": 1, "b": 2 })).unwrap();
        assert_eq!(bytes_a, bytes_b);
        assert_eq!(bytes_a, "{\"a\":1,\"b\":2}");
        assert_eq!(digest_a, digest_b);
        let (_, different) = canonical_args(&json!({ "a": 1, "b": 3 })).unwrap();
        assert_ne!(digest_a, different);
    }

    #[test]
    fn retry_delay_is_deterministic_bounded_and_grows() {
        let first = retry_delay_ms("job_a", 1);
        assert_eq!(first, retry_delay_ms("job_a", 1));
        assert!(first >= JOBS_BACKOFF_BASE_MS);
        assert!(first <= JOBS_BACKOFF_BASE_MS + JOBS_JITTER_CEILING_MS);
        let seventh = retry_delay_ms("job_a", 7);
        assert!(seventh >= JOBS_BACKOFF_CAP_MS);
        assert!(seventh <= JOBS_BACKOFF_CAP_MS + JOBS_JITTER_CEILING_MS);
        // Distinct job identity shifts the jitter (same framing rule).
        assert_ne!(
            retry_delay_ms("job_a", 1) - JOBS_BACKOFF_BASE_MS,
            retry_delay_ms("job_b", 1) - JOBS_BACKOFF_BASE_MS,
            "jitter framing must include the canonical job id"
        );
    }

    #[test]
    fn claim_is_set_based_ordered_and_exactly_once() {
        let mut conn = memory_conn();
        let tx = conn.transaction().unwrap();
        insert_enqueued_jobs_in_tx(
            &tx,
            &producer(),
            7,
            &[
                enqueue("job_b", 100),
                enqueue("job_a", 100),
                enqueue("job_c", 200),
            ],
            50,
        )
        .unwrap();
        tx.commit().unwrap();

        let mut n = 0;
        let mut ids = move || {
            n += 1;
            format!("claim_{n}")
        };
        let tx = conn.transaction().unwrap();
        let claims =
            claim_due_jobs_in_tx(&tx, 150, JOBS_CLAIM_BATCH, "forced-drain", &mut ids).unwrap();
        tx.commit().unwrap();
        // Due set only, ordered by (available_at_ms, job_id bytes).
        assert_eq!(
            claims.iter().map(|c| c.job_id.as_str()).collect::<Vec<_>>(),
            vec!["job_a", "job_b"]
        );
        assert!(claims.iter().all(|c| c.fence == 1 && c.attempt == 1));

        // A second drain at the same instant claims nothing: attempts are fenced.
        let mut ids2 = || "claim_dup".to_owned();
        let tx = conn.transaction().unwrap();
        let again =
            claim_due_jobs_in_tx(&tx, 150, JOBS_CLAIM_BATCH, "forced-drain", &mut ids2).unwrap();
        tx.commit().unwrap();
        assert!(
            again.is_empty(),
            "claimed jobs must not be re-claimed under a live lease"
        );
    }

    #[test]
    fn stale_fence_cannot_publish_after_successor_claim() {
        let mut conn = memory_conn();
        let tx = conn.transaction().unwrap();
        let mut job = enqueue("job_x", 0);
        job.max_attempts = 3;
        insert_enqueued_jobs_in_tx(&tx, &producer(), 1, &[job], 0).unwrap();
        tx.commit().unwrap();

        let mut first_ids = || "claim_first".to_owned();
        let tx = conn.transaction().unwrap();
        let first = claim_due_jobs_in_tx(&tx, 0, JOBS_CLAIM_BATCH, "forced-drain", &mut first_ids)
            .unwrap()
            .remove(0);
        tx.commit().unwrap();

        // Lease expires; a successor drain re-claims with a greater fence and
        // terminally records the expired attempt.
        let mut second_ids = || "claim_second".to_owned();
        let tx = conn.transaction().unwrap();
        let second = claim_due_jobs_in_tx(
            &tx,
            JOBS_LEASE_MS + 1,
            JOBS_CLAIM_BATCH,
            "forced-drain",
            &mut second_ids,
        )
        .unwrap()
        .remove(0);
        tx.commit().unwrap();
        assert_eq!(second.attempt, 2);
        assert!(second.fence > first.fence);

        // The stale first claim publishes nothing.
        let tx = conn.transaction().unwrap();
        let disposition = finish_job_in_tx(
            &tx,
            &first,
            &JobAttemptOutcome::Succeeded,
            JOBS_LEASE_MS + 2,
        )
        .unwrap();
        tx.commit().unwrap();
        assert_eq!(disposition, JobFinishDisposition::StalePublication);
        let status = job_status_row(&conn, "job_x").unwrap().unwrap();
        assert_eq!(status.state, JobState::Claimed);

        // The successor publishes success.
        let tx = conn.transaction().unwrap();
        let disposition = finish_job_in_tx(
            &tx,
            &second,
            &JobAttemptOutcome::Succeeded,
            JOBS_LEASE_MS + 3,
        )
        .unwrap();
        tx.commit().unwrap();
        assert_eq!(disposition, JobFinishDisposition::Succeeded);
        let attempts = job_attempts(&conn, "job_x").unwrap();
        assert_eq!(attempts.len(), 2);
        assert_eq!(attempts[0].outcome.as_deref(), Some("lease_expired"));
        assert_eq!(attempts[1].outcome.as_deref(), Some("succeeded"));
    }

    // @ref LLP 0070#claims-and-fencing — a successor claim after process
    // restart must terminally receipt the expired attempt and advance its fence.
    #[test]
    fn file_backed_crash_reopen_expires_attempt_and_fences_successor() {
        let directory = tempfile::tempdir().expect("jobs fixture directory");
        let database_path = directory.path().join("jobs.sqlite");
        let first;

        {
            let mut conn = Connection::open(&database_path).expect("open file-backed sqlite");
            create_jobs_infra(&conn).expect("jobs infra");
            let tx = conn.transaction().unwrap();
            let mut job = enqueue("job_reopen", 100);
            job.max_attempts = 2;
            insert_enqueued_jobs_in_tx(&tx, &producer(), 7, &[job], 100).unwrap();
            tx.commit().unwrap();

            let mut first_ids = || "claim_before_crash".to_owned();
            let tx = conn.transaction().unwrap();
            first = claim_due_jobs_in_tx(
                &tx,
                100,
                JOBS_CLAIM_BATCH,
                "autonomous-worker",
                &mut first_ids,
            )
            .unwrap()
            .remove(0);
            tx.commit().unwrap();
            assert_eq!(first.attempt, 1);
            assert_eq!(first.fence, 1);

            // Model a process crash: close the only database connection while
            // attempt 1 remains claimed, with no finish publication.
        }

        let mut conn = Connection::open(&database_path).expect("reopen file-backed sqlite");
        create_jobs_infra(&conn).expect("idempotent jobs infra on reopen");

        let mut early_ids = || "claim_too_early".to_owned();
        let tx = conn.transaction().unwrap();
        let early = claim_due_jobs_in_tx(
            &tx,
            first.lease_expires_at_ms - 1,
            JOBS_CLAIM_BATCH,
            "autonomous-worker",
            &mut early_ids,
        )
        .unwrap();
        tx.commit().unwrap();
        assert!(
            early.is_empty(),
            "the persisted attempt keeps its live lease"
        );

        let mut second_ids = || "claim_after_reopen".to_owned();
        let tx = conn.transaction().unwrap();
        let second = claim_due_jobs_in_tx(
            &tx,
            first.lease_expires_at_ms,
            JOBS_CLAIM_BATCH,
            "autonomous-worker",
            &mut second_ids,
        )
        .unwrap()
        .remove(0);
        tx.commit().unwrap();
        assert_eq!(second.attempt, 2);
        assert_eq!(second.fence, first.fence + 1);
        assert_ne!(second.claim_id, first.claim_id);

        let attempts = job_attempts(&conn, "job_reopen").unwrap();
        assert_eq!(attempts.len(), 2);
        assert_eq!(attempts[0].attempt, 1);
        assert_eq!(attempts[0].fence, first.fence);
        assert_eq!(attempts[0].finished_at_ms, Some(first.lease_expires_at_ms));
        assert_eq!(attempts[0].outcome.as_deref(), Some("lease_expired"));
        assert_eq!(
            attempts[0].diagnostic_code.as_deref(),
            Some("SNAPBACK_JOB_LEASE_EXPIRED")
        );
        assert_eq!(attempts[1].attempt, 2);
        assert_eq!(attempts[1].fence, second.fence);
        assert_eq!(attempts[1].outcome, None);

        let status = job_status_row(&conn, "job_reopen").unwrap().unwrap();
        assert_eq!(status.state, JobState::Claimed);
        assert_eq!(status.attempt_count, 2);
        assert_eq!(status.max_attempts, 2);
        assert_eq!(status.state_version, 3);
        assert_eq!(status.terminal_at_ms, None);

        // The pre-crash holder has lost its fence even though its claim value
        // still exists in this test process.
        let tx = conn.transaction().unwrap();
        let stale = finish_job_in_tx(
            &tx,
            &first,
            &JobAttemptOutcome::Succeeded,
            first.lease_expires_at_ms + 1,
        )
        .unwrap();
        tx.commit().unwrap();
        assert_eq!(stale, JobFinishDisposition::StalePublication);

        let terminal_at_ms = first.lease_expires_at_ms + 2;
        let tx = conn.transaction().unwrap();
        let disposition =
            finish_job_in_tx(&tx, &second, &JobAttemptOutcome::Succeeded, terminal_at_ms).unwrap();
        tx.commit().unwrap();
        assert_eq!(disposition, JobFinishDisposition::Succeeded);

        let status = job_status_row(&conn, "job_reopen").unwrap().unwrap();
        assert_eq!(status.state, JobState::Succeeded);
        assert_eq!(status.attempt_count, 2);
        assert_eq!(status.state_version, 4);
        assert_eq!(status.terminal_at_ms, Some(terminal_at_ms));
        assert_eq!(status.last_error_code, None);

        let attempts = job_attempts(&conn, "job_reopen").unwrap();
        assert_eq!(attempts.len(), 2);
        assert_eq!(attempts[0].outcome.as_deref(), Some("lease_expired"));
        assert_eq!(
            attempts[0].diagnostic_code.as_deref(),
            Some("SNAPBACK_JOB_LEASE_EXPIRED")
        );
        assert_eq!(attempts[1].outcome.as_deref(), Some("succeeded"));
        assert_eq!(attempts[1].diagnostic_code, None);
    }

    #[test]
    fn failed_attempts_retry_with_deterministic_backoff_then_dead_letter() {
        let mut conn = memory_conn();
        let tx = conn.transaction().unwrap();
        let mut job = enqueue("job_r", 0);
        job.max_attempts = 2;
        insert_enqueued_jobs_in_tx(&tx, &producer(), 1, &[job], 0).unwrap();
        tx.commit().unwrap();

        let failure = JobAttemptOutcome::Failed(Diagnostic::error(
            "SNAPBACK_TEST_ACTION_FAILED",
            "jobs",
            "boom",
        ));

        let mut ids = || "c1".to_owned();
        let tx = conn.transaction().unwrap();
        let claim = claim_due_jobs_in_tx(&tx, 0, JOBS_CLAIM_BATCH, "forced-drain", &mut ids)
            .unwrap()
            .remove(0);
        let disposition = finish_job_in_tx(&tx, &claim, &failure, 10).unwrap();
        tx.commit().unwrap();
        let JobFinishDisposition::RetryPending { available_at_ms } = disposition else {
            panic!("first failure of two attempts must re-pend");
        };
        assert_eq!(available_at_ms, 10 + retry_delay_ms("job_r", 1));

        let mut ids = || "c2".to_owned();
        let tx = conn.transaction().unwrap();
        let claim = claim_due_jobs_in_tx(
            &tx,
            available_at_ms,
            JOBS_CLAIM_BATCH,
            "forced-drain",
            &mut ids,
        )
        .unwrap()
        .remove(0);
        assert_eq!(claim.attempt, 2);
        let disposition = finish_job_in_tx(&tx, &claim, &failure, available_at_ms + 5).unwrap();
        tx.commit().unwrap();
        assert_eq!(disposition, JobFinishDisposition::Dead);
        let status = job_status_row(&conn, "job_r").unwrap().unwrap();
        assert_eq!(status.state, JobState::Dead);
        assert_eq!(
            status.last_error_code.as_deref(),
            Some("SNAPBACK_TEST_ACTION_FAILED")
        );
        assert_eq!(job_attempts(&conn, "job_r").unwrap().len(), 2);
    }

    #[test]
    fn divergent_idempotency_key_reuse_fails_closed_in_the_insert_transaction() {
        let mut conn = memory_conn();
        let tx = conn.transaction().unwrap();
        let mut first = enqueue("job_1", 0);
        first.idempotency_key = Some("key".into());
        insert_enqueued_jobs_in_tx(&tx, &producer(), 1, &[first], 0).unwrap();
        tx.commit().unwrap();

        let tx = conn.transaction().unwrap();
        let mut divergent = enqueue("job_2", 0);
        divergent.idempotency_key = Some("key".into());
        divergent.args = json!({ "different": true });
        let error = insert_enqueued_jobs_in_tx(&tx, &producer(), 2, &[divergent], 1).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED");

        let mut identical = enqueue("job_3", 0);
        identical.idempotency_key = Some("key".into());
        let error = insert_enqueued_jobs_in_tx(&tx, &producer(), 2, &[identical], 1).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_JOB_IDEMPOTENCY_KEY_RACED");
    }
}
