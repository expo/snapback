//! Host-owned `StreamAttemptV1` control plane.
//!
//! The runtime — not the authored schema — owns the attempt identity, the
//! single-runner lease, the per-cursor `initiationState`, and the terminal
//! cause plus effect certainty, and issues the action an opaque attempt token.
//! The trusted terminalizer uses this record to write a durable winner by
//! compare-and-set once the authored action can no longer commit, so the
//! attempt never remains `running` with no winner.
//!
// @ref LLP 0076#settlement-and-retry — trusted terminalizer + single-runner
//   lease are specified contract: a durable winner always exists and no two
//   runners can commit against one attempt.
// @ref LLP 0076#author-decisions--2026-07-23 — decision 2: the effect
//   certainty persists on this host-owned record; decision 3: a parent
//   attempt owns settlement and lease while each upstream request gets a
//   child cursor record whose certainty folds pessimistically into the
//   parent.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use uuid::Uuid;

pub use snapback_types::stream_attempt::*;

pub const STREAM_CHUNK_MAX_BYTES: usize = 16 * 1024;
pub const STREAM_ATTEMPT_MAX_BYTES: usize = 2 * 1024 * 1024;
pub const STREAM_CHUNKS_PER_SECOND: usize = 20;
const STREAM_LIVE_AUTH_RETENTION: std::time::Duration = std::time::Duration::from_secs(30);

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct StreamAttemptMetadata {
    pub function_id: Option<String>,
    pub initiator: Option<StreamInitiator>,
    pub started_at_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StreamChunkEmission {
    pub attempt_token: String,
    pub chunk_index: u64,
    pub chunk_count: u64,
    pub total_bytes: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamOutputSnapshot {
    pub attempt_token: String,
    pub function_id: String,
    pub initiator: StreamInitiator,
    pub started_at_ms: u64,
    pub settled_at_ms: Option<u64>,
    pub terminal: Option<StreamAttemptTerminal>,
    pub chunk_count: u64,
}

struct RunnerHolder {
    invocation_id: String,
    abandoned: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
}

impl RunnerHolder {
    fn alive(&self) -> bool {
        !self.abandoned.load(Ordering::SeqCst) && !self.finished.load(Ordering::SeqCst)
    }
}

struct CursorRecord {
    initiation_state: StreamInitiationState,
    open: bool,
}

struct AttemptRecord {
    token: String,
    namespace: usize,
    client_key: String,
    runner_generation: u64,
    holder: Option<RunnerHolder>,
    progress_commits: u64,
    cursors_opened: u64,
    cursors: BTreeMap<String, CursorRecord>,
    terminal: Option<StreamAttemptTerminal>,
    function_id: Option<String>,
    initiator: Option<StreamInitiator>,
    started_at_ms: u64,
    settled_at_ms: Option<u64>,
    emitted_bytes: u64,
    chunk_count: u64,
    recent_emits: VecDeque<std::time::Instant>,
    /// Keep the initiator fact as long as the reserved live room can retain
    /// chunks after terminal settlement. This is process-only subscription
    /// authority, not a durable resume cursor.
    live_auth_retain_until: Option<std::time::Instant>,
}

impl AttemptRecord {
    fn effect_fold(&self) -> bool {
        self.cursors
            .values()
            .any(|cursor| cursor.initiation_state != StreamInitiationState::DefinitelyNotInitiated)
    }

    fn lease_held_by(&self, invocation_id: &str) -> bool {
        self.holder
            .as_ref()
            .is_some_and(|holder| holder.invocation_id == invocation_id)
    }

    fn open_cursor_count(&self) -> usize {
        self.cursors.values().filter(|cursor| cursor.open).count()
    }

    fn retain_live_auth_after_settlement(&mut self) {
        if self.initiator.is_some() {
            self.live_auth_retain_until =
                std::time::Instant::now().checked_add(STREAM_LIVE_AUTH_RETENTION);
        }
    }

    fn live_auth_is_retained(&self, now: std::time::Instant) -> bool {
        self.live_auth_retain_until
            .is_some_and(|deadline| now < deadline)
    }
}

#[derive(Default)]
struct RegistryInner {
    by_token: BTreeMap<String, AttemptRecord>,
    by_client_key: BTreeMap<(usize, String), String>,
    by_invocation: BTreeMap<String, BTreeSet<String>>,
    by_cursor: BTreeMap<String, String>,
    /// Tokens whose durable row is stale. Drained by the host's flush points;
    /// watchdog-leg terminals are deliberately write-behind (the watchdog must
    /// never wait on the instance lock) and ride the next flush or, after a
    /// crash, the startup reconciler.
    dirty: BTreeSet<String>,
}

impl RegistryInner {
    fn snapshot(&self, token: &str) -> Option<PersistedStreamAttempt> {
        let record = self.by_token.get(token)?;
        Some(PersistedStreamAttempt {
            token: record.token.clone(),
            client_key: record.client_key.clone(),
            runner_generation: record.runner_generation,
            progress_commits: record.progress_commits,
            cursors_opened: record.cursors_opened,
            cursors: record
                .cursors
                .iter()
                .map(|(id, cursor)| {
                    (
                        id.clone(),
                        PersistedStreamCursor {
                            initiation_state: cursor.initiation_state,
                            open: cursor.open,
                        },
                    )
                })
                .collect(),
            terminal: record.terminal.clone(),
            function_id: record.function_id.clone(),
            initiator: record.initiator.clone(),
            started_at_ms: record.started_at_ms,
            settled_at_ms: record.settled_at_ms,
            emitted_bytes: record.emitted_bytes,
            chunk_count: record.chunk_count,
        })
    }

    fn reap_terminal(&mut self, token: &str) {
        let Some(record) = self.by_token.remove(token) else {
            return;
        };
        debug_assert!(record.terminal.is_some());
        let client_key = (record.namespace, record.client_key);
        if self.by_client_key.get(&client_key).map(String::as_str) == Some(token) {
            self.by_client_key.remove(&client_key);
        }
        for cursor_id in record.cursors.keys() {
            if self.by_cursor.get(cursor_id).map(String::as_str) == Some(token) {
                self.by_cursor.remove(cursor_id);
            }
        }
        self.by_invocation.retain(|_, tokens| {
            tokens.remove(token);
            !tokens.is_empty()
        });
    }

    /// Whether any invocation this process still tracks holds the token. A
    /// referencing invocation may yet consult the record process-live: the
    /// per-read attempt-to-cursor cancellation signal, and `settle` returning
    /// the committed winner verbatim (including a hung worker observing the
    /// watchdog's terminal after abandonment), both require the record until
    /// the last referencing invocation is released.
    fn referenced_by_any_invocation(&self, token: &str) -> bool {
        self.by_invocation
            .values()
            .any(|tokens| tokens.contains(token))
    }

    fn reap_expired_live_auth(&mut self, now: std::time::Instant) {
        let expired = self
            .by_token
            .iter()
            .filter(|(token, record)| {
                record.terminal.is_some()
                    && !record.live_auth_is_retained(now)
                    && !self.dirty.contains(*token)
                    && !self.referenced_by_any_invocation(token)
            })
            .map(|(token, _)| token.clone())
            .collect::<Vec<_>>();
        for token in expired {
            self.reap_terminal(&token);
        }
    }
}

/// Identity of one detached action invocation as the control plane sees it:
/// the opaque id plus the liveness flags the lease consults.
#[derive(Clone)]
pub struct StreamRunnerIdentity {
    pub invocation_id: String,
    pub abandoned: Arc<AtomicBool>,
    pub finished: Arc<AtomicBool>,
}

impl StreamRunnerIdentity {
    pub fn new(abandoned: Arc<AtomicBool>) -> Self {
        Self {
            invocation_id: Uuid::new_v4().to_string(),
            abandoned,
            finished: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Default)]
pub struct StreamAttemptRegistry {
    inner: StdMutex<RegistryInner>,
}

fn attempt_error(operation: &'static str, message: &'static str, details: Value) -> SnapbackError {
    let mut details = details.as_object().cloned().unwrap_or_default();
    details.insert("operation".to_owned(), json!(operation));
    details.insert(
        "repair".to_owned(),
        json!("guide/backend/actions-and-fetch#stream-a-response"),
    );
    SnapbackError::error("SNAPBACK_ACTION_STREAM_INVALID", "runtime", message)
        .with_details(Value::Object(details))
}

fn stream_error(
    code: &'static str,
    operation: &'static str,
    message: &'static str,
) -> SnapbackError {
    SnapbackError::error(code, "runtime", message).with_details(json!({ "operation": operation }))
}

fn unix_time_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

impl StreamAttemptRegistry {
    fn lock(&self) -> std::sync::MutexGuard<'_, RegistryInner> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Idempotent start by client key. The first caller creates the attempt
    /// and binds the lease; a concurrent caller receives the existing
    /// attempt WITHOUT the lease while the holder is alive; once the holder
    /// is abandoned or finished, a new caller takes the lease over under an
    /// incremented runner generation.
    pub fn start(
        &self,
        namespace: usize,
        client_key: &str,
        runner: &StreamRunnerIdentity,
        persisted: Option<&PersistedStreamAttempt>,
    ) -> SnapbackResult<StreamAttemptStart> {
        self.start_with_metadata(
            namespace,
            client_key,
            runner,
            persisted,
            StreamAttemptMetadata::default(),
        )
    }

    /// Start the same LLP 0076 attempt with the output-stream privacy and
    /// transcript facts attached at creation. Existing fetch-stream callers
    /// continue through [`Self::start`] and therefore do not gain this surface.
    pub fn start_with_metadata(
        &self,
        namespace: usize,
        client_key: &str,
        runner: &StreamRunnerIdentity,
        persisted: Option<&PersistedStreamAttempt>,
        metadata: StreamAttemptMetadata,
    ) -> SnapbackResult<StreamAttemptStart> {
        if client_key.is_empty() || client_key.len() > 512 || client_key.contains(['\r', '\n']) {
            return Err(attempt_error(
                "attemptStart",
                "stream attempt client key must be a bounded single-line string",
                json!({ "expected": "a non-empty single-line key <= 512 bytes", "received": "invalid client key shape" }),
            ));
        }
        let mut inner = self.lock();
        inner.reap_expired_live_auth(std::time::Instant::now());
        let key = (namespace, client_key.to_owned());
        if let Some(token) = inner.by_client_key.get(&key).cloned() {
            let record = inner
                .by_token
                .get_mut(&token)
                .expect("client-key index points at a live attempt record");
            let mut took_over = false;
            let lease_held = match (&record.terminal, &record.holder) {
                (Some(_), _) => false,
                (None, Some(holder)) if holder.invocation_id == runner.invocation_id => true,
                (None, Some(holder)) if holder.alive() => false,
                (None, _) => {
                    // Lease takeover: the previous runner is gone without a
                    // terminal row (a narrow window before the terminalizer
                    // acts); the new runner supersedes it atomically.
                    record.runner_generation += 1;
                    record.holder = Some(RunnerHolder {
                        invocation_id: runner.invocation_id.clone(),
                        abandoned: runner.abandoned.clone(),
                        finished: runner.finished.clone(),
                    });
                    took_over = true;
                    true
                }
            };
            let start = StreamAttemptStart {
                attempt_token: record.token.clone(),
                runner_generation: record.runner_generation,
                lease_held,
                progress_commits: record.progress_commits,
                terminal: record.terminal.clone(),
            };
            let token = record.token.clone();
            if took_over {
                inner.dirty.insert(token.clone());
            }
            inner
                .by_invocation
                .entry(runner.invocation_id.clone())
                .or_default()
                .insert(token);
            return Ok(start);
        }
        // Adopt a durable row this process has not seen (the previous runner
        // died with its process; the startup reconciler already settled it,
        // but adopt defensively either way): the durable identity survives,
        // the runner generation advances, and this runner takes the lease
        // only when no durable winner exists.
        let (
            token,
            runner_generation,
            progress_commits,
            cursors_opened,
            cursors,
            terminal,
            function_id,
            initiator,
            started_at_ms,
            settled_at_ms,
            emitted_bytes,
            chunk_count,
        ) = match persisted {
            Some(row) => (
                row.token.clone(),
                row.runner_generation + 1,
                row.progress_commits,
                row.cursors_opened,
                row.cursors
                    .iter()
                    .map(|(id, cursor)| {
                        (
                            id.clone(),
                            CursorRecord {
                                initiation_state: cursor.initiation_state,
                                open: false,
                            },
                        )
                    })
                    .collect(),
                row.terminal.clone(),
                row.function_id.clone(),
                row.initiator.clone(),
                row.started_at_ms,
                row.settled_at_ms,
                row.emitted_bytes,
                row.chunk_count,
            ),
            None => (
                Uuid::new_v4().to_string(),
                1,
                0,
                0,
                BTreeMap::new(),
                None,
                metadata.function_id,
                metadata.initiator,
                metadata.started_at_ms,
                None,
                0,
                0,
            ),
        };
        let lease_held = terminal.is_none();
        let live_auth_retain_until = (terminal.is_some() && initiator.is_some())
            .then(|| std::time::Instant::now() + STREAM_LIVE_AUTH_RETENTION);
        let record = AttemptRecord {
            token: token.clone(),
            namespace,
            client_key: client_key.to_owned(),
            runner_generation,
            holder: lease_held.then(|| RunnerHolder {
                invocation_id: runner.invocation_id.clone(),
                abandoned: runner.abandoned.clone(),
                finished: runner.finished.clone(),
            }),
            progress_commits,
            cursors_opened,
            cursors,
            terminal: terminal.clone(),
            function_id,
            initiator,
            started_at_ms,
            settled_at_ms,
            emitted_bytes,
            chunk_count,
            recent_emits: VecDeque::new(),
            live_auth_retain_until,
        };
        inner.by_client_key.insert(key, token.clone());
        inner.by_token.insert(token.clone(), record);
        inner.dirty.insert(token.clone());
        inner
            .by_invocation
            .entry(runner.invocation_id.clone())
            .or_default()
            .insert(token.clone());
        Ok(StreamAttemptStart {
            attempt_token: token,
            runner_generation,
            lease_held,
            progress_commits,
            terminal,
        })
    }

    /// Snapshot the dirty rows of one instance namespace for durable upsert.
    /// Dirty flags are cleared separately AFTER the upsert commits, so a
    /// failed write leaves the rows queued for the next flush point.
    pub fn dirty_snapshots(&self, namespace: usize) -> Vec<PersistedStreamAttempt> {
        let inner = self.lock();
        inner
            .dirty
            .iter()
            .filter(|token| {
                inner
                    .by_token
                    .get(*token)
                    .is_some_and(|record| record.namespace == namespace)
            })
            .filter_map(|token| inner.snapshot(token))
            .collect()
    }

    /// Acknowledge the exact snapshots that committed. A concurrent registry
    /// update remains dirty; a flushed terminal snapshot is reaped once no
    /// live invocation still references it (the durable row is authoritative
    /// on the next client-key lookup). While an invocation still holds the
    /// token, the record stays process-live: the per-read cancellation signal
    /// (`cursor_attempt_terminal`) and the settle CAS returning the committed
    /// winner verbatim both read it.
    // @ref LLP 0076#authority-and-lifecycle — terminal settlement must stay
    //   observable to the cursor's reader and to later settle calls until the
    //   referencing invocations end; retention reaps at release, not at the
    //   first durable flush.
    pub fn clear_flushed(&self, snapshots: &[PersistedStreamAttempt]) {
        let mut inner = self.lock();
        let now = std::time::Instant::now();
        for snapshot in snapshots {
            if inner.snapshot(&snapshot.token).as_ref() != Some(snapshot) {
                continue;
            }
            inner.dirty.remove(&snapshot.token);
            if snapshot.terminal.is_some()
                && !inner.referenced_by_any_invocation(&snapshot.token)
                && !inner
                    .by_token
                    .get(&snapshot.token)
                    .is_some_and(|record| record.live_auth_is_retained(now))
            {
                inner.reap_terminal(&snapshot.token);
            }
        }
        inner.reap_expired_live_auth(now);
    }

    /// Release one invocation's interest in its attempts once that invocation
    /// can no longer consult them (its worker completed or died — NOT the
    /// watchdog leg, where a hung worker may still observe the winner). Any
    /// released terminal record nobody else references is reaped immediately
    /// when its durable row is current, or by the next flush's
    /// `clear_flushed` when it is still dirty — this is the retention point
    /// that keeps the registry bounded on streaming-action workloads.
    pub fn release_invocation(&self, runner: &StreamRunnerIdentity) {
        let mut inner = self.lock();
        let now = std::time::Instant::now();
        let Some(tokens) = inner.by_invocation.remove(&runner.invocation_id) else {
            return;
        };
        for token in tokens {
            if inner
                .by_token
                .get(&token)
                .is_some_and(|record| record.terminal.is_some())
                && !inner.dirty.contains(&token)
                && !inner.referenced_by_any_invocation(&token)
                && !inner
                    .by_token
                    .get(&token)
                    .is_some_and(|record| record.live_auth_is_retained(now))
            {
                inner.reap_terminal(&token);
            }
        }
        inner.reap_expired_live_auth(now);
    }

    /// Bind an upstream cursor (child record, decision 3) to an attempt
    /// before its request is handed to the outbound stack. Refuses a second
    /// upstream open after the first durable progress commit — transport
    /// re-segmentation could associate one sequence with different bytes —
    /// and any bind without the current lease.
    pub fn bind_cursor(
        &self,
        attempt_token: &str,
        cursor_id: &str,
        runner: &StreamRunnerIdentity,
    ) -> SnapbackResult<()> {
        let mut inner = self.lock();
        let Some(record) = inner.by_token.get_mut(attempt_token) else {
            return Err(attempt_error(
                "open",
                "the stream attempt token is unknown to this host",
                json!({ "expected": "a host-issued attempt token", "received": "unknown attempt token" }),
            ));
        };
        if record.terminal.is_some() {
            return Err(attempt_error(
                "open",
                "the stream attempt already carries a committed terminal settlement",
                json!({ "expected": "a running attempt", "received": "terminal attempt" }),
            ));
        }
        if !record.lease_held_by(&runner.invocation_id) {
            return Err(attempt_error(
                "open",
                "this runner does not hold the attempt's single-runner lease",
                json!({ "expected": "the current runner lease", "received": "a superseded or concurrent runner" }),
            ));
        }
        if record.cursors_opened >= 1 && record.progress_commits >= 1 {
            return Err(attempt_error(
                "open",
                "retry is prohibited after the first durable progress commit",
                json!({ "expected": "at most one upstream request once progress committed", "received": "a reopened upstream request" }),
            ));
        }
        record.cursors_opened += 1;
        record.cursors.insert(
            cursor_id.to_owned(),
            CursorRecord {
                // The write-ahead pre-mark: the cursor is presumed possibly
                // initiated from the moment it is bound, BEFORE any bytes
                // reach the outbound stack; only a provable pre-send failure
                // narrows it.
                initiation_state: StreamInitiationState::InitiationPossible,
                open: true,
            },
        );
        inner
            .by_cursor
            .insert(cursor_id.to_owned(), attempt_token.to_owned());
        inner.dirty.insert(attempt_token.to_owned());
        Ok(())
    }

    /// Narrow or advance a cursor's initiation state. Narrowing to
    /// `definitely_not_initiated` is legal only from `initiation_possible`
    /// (a provable pre-send failure); `response_observed` is absorbing.
    pub fn cursor_initiation(&self, cursor_id: &str, state: StreamInitiationState) {
        let mut inner = self.lock();
        let Some(token) = inner.by_cursor.get(cursor_id).cloned() else {
            return;
        };
        if let Some(record) = inner.by_token.get_mut(&token)
            && let Some(cursor) = record.cursors.get_mut(cursor_id)
            && cursor.initiation_state != StreamInitiationState::ResponseObserved
        {
            cursor.initiation_state = state;
            inner.dirty.insert(token);
        }
    }

    /// The direct attempt-to-cursor cancellation signal: whether the attempt
    /// owning this cursor has a committed terminal settlement. The read path
    /// consults this before every pull, so a durable cancellation reaches the
    /// reader without waiting for the next progress mutation.
    // @ref LLP 0076#authority-and-lifecycle — terminal settlement closes the
    //   cursor and prevents another successful read.
    pub fn cursor_attempt_terminal(&self, cursor_id: &str) -> bool {
        let inner = self.lock();
        let Some(token) = inner.by_cursor.get(cursor_id) else {
            return false;
        };
        inner
            .by_token
            .get(token)
            .is_some_and(|record| record.terminal.is_some())
    }

    pub fn close_cursor(&self, cursor_id: &str) {
        let mut inner = self.lock();
        let Some(token) = inner.by_cursor.get(cursor_id).cloned() else {
            return;
        };
        if let Some(record) = inner.by_token.get_mut(&token)
            && let Some(cursor) = record.cursors.get_mut(cursor_id)
        {
            cursor.open = false;
            inner.dirty.insert(token);
        }
    }

    /// The host progress fence consulted before every nested mutation of an
    /// invocation that started or joined attempts. Refuses commits from a
    /// runner that does not hold the lease, and late commits while a
    /// terminal attempt still owns open cursors.
    pub fn progress_guard(&self, runner: &StreamRunnerIdentity) -> SnapbackResult<()> {
        let inner = self.lock();
        let Some(tokens) = inner.by_invocation.get(&runner.invocation_id) else {
            return Ok(());
        };
        for token in tokens {
            let Some(record) = inner.by_token.get(token) else {
                continue;
            };
            match &record.terminal {
                None => {
                    if !record.lease_held_by(&runner.invocation_id) {
                        return Err(attempt_error(
                            "progress",
                            "this runner does not hold the attempt's single-runner lease",
                            json!({ "expected": "the current runner lease", "received": "a superseded or concurrent runner" }),
                        ));
                    }
                }
                Some(terminal) => {
                    if record.open_cursor_count() > 0 && record.lease_held_by(&runner.invocation_id)
                    {
                        return Err(attempt_error(
                            "progress",
                            "the stream attempt is already terminal; late progress is fenced",
                            json!({ "expected": "a running attempt", "received": format!("terminal attempt ({:?})", terminal.cause) }),
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    /// Record one successful durable progress commit for every non-terminal
    /// attempt this invocation holds with an open cursor.
    pub fn record_progress_commit(&self, runner: &StreamRunnerIdentity) {
        let mut inner = self.lock();
        let Some(tokens) = inner.by_invocation.get(&runner.invocation_id).cloned() else {
            return;
        };
        for token in tokens {
            if let Some(record) = inner.by_token.get_mut(&token)
                && record.terminal.is_none()
                && record.lease_held_by(&runner.invocation_id)
                && record.open_cursor_count() > 0
            {
                record.progress_commits += 1;
                inner.dirty.insert(token);
            }
        }
    }

    pub fn stream_output(&self, attempt_token: &str) -> Option<StreamOutputSnapshot> {
        let inner = self.lock();
        let record = inner.by_token.get(attempt_token)?;
        Some(StreamOutputSnapshot {
            attempt_token: record.token.clone(),
            function_id: record.function_id.clone()?,
            initiator: record.initiator.clone()?,
            started_at_ms: record.started_at_ms,
            settled_at_ms: record.settled_at_ms,
            terminal: record.terminal.clone(),
            chunk_count: record.chunk_count,
        })
    }

    pub fn stream_initiator(&self, attempt_token: &str) -> Option<StreamInitiator> {
        let mut inner = self.lock();
        inner.reap_expired_live_auth(std::time::Instant::now());
        inner
            .by_token
            .get(attempt_token)
            .and_then(|record| record.initiator.clone())
    }

    pub fn authorize_stream_initiator(
        &self,
        attempt_token: &str,
        candidate: &StreamInitiator,
    ) -> SnapbackResult<()> {
        let mut inner = self.lock();
        inner.reap_expired_live_auth(std::time::Instant::now());
        let Some(record) = inner.by_token.get(attempt_token) else {
            return Err(stream_error(
                "SNAPBACK_STREAM_ATTEMPT_NOT_FOUND",
                "authorize",
                "the stream attempt does not exist in this process",
            ));
        };
        if record.initiator.as_ref() != Some(candidate) {
            return Err(stream_error(
                "SNAPBACK_STREAM_FORBIDDEN",
                "authorize",
                "the resolved authority did not initiate this stream",
            ));
        }
        Ok(())
    }

    /// Reserve one monotonic output index under the same runner lease as the
    /// attempt. The transport publishes only after this guard succeeds.
    pub fn emit_chunk(
        &self,
        attempt_token: &str,
        byte_len: usize,
        runner: &StreamRunnerIdentity,
    ) -> SnapbackResult<StreamChunkEmission> {
        if byte_len > STREAM_CHUNK_MAX_BYTES {
            return Err(stream_error(
                "SNAPBACK_STREAM_CHUNK_TOO_LARGE",
                "emit",
                "a stream chunk exceeds the 16 KiB encoded limit",
            ));
        }
        let mut inner = self.lock();
        let Some(record) = inner.by_token.get_mut(attempt_token) else {
            return Err(stream_error(
                "SNAPBACK_STREAM_ATTEMPT_NOT_FOUND",
                "emit",
                "the stream attempt token is unknown",
            ));
        };
        if record.function_id.is_none() || record.initiator.is_none() {
            return Err(stream_error(
                "SNAPBACK_STREAM_NOT_DECLARED",
                "emit",
                "this attempt is not a declared output stream",
            ));
        }
        if let Some(terminal) = &record.terminal {
            let code = if terminal.cause == StreamAttemptCause::Cancelled {
                "SNAPBACK_STREAM_CANCELLED"
            } else {
                "SNAPBACK_STREAM_TERMINAL"
            };
            return Err(stream_error(
                code,
                "emit",
                "the stream attempt is already terminal",
            ));
        }
        if !record.lease_held_by(&runner.invocation_id) {
            return Err(stream_error(
                "SNAPBACK_STREAM_RUNNER_FENCED",
                "emit",
                "this action no longer owns the stream attempt lease",
            ));
        }
        let next_total = record.emitted_bytes.saturating_add(byte_len as u64);
        if next_total > STREAM_ATTEMPT_MAX_BYTES as u64 {
            return Err(stream_error(
                "SNAPBACK_STREAM_ATTEMPT_LIMIT_EXCEEDED",
                "emit",
                "the stream attempt exceeds the 2 MiB output limit",
            ));
        }
        let now = std::time::Instant::now();
        while record.recent_emits.front().is_some_and(|instant| {
            now.duration_since(*instant) >= std::time::Duration::from_secs(1)
        }) {
            record.recent_emits.pop_front();
        }
        if record.recent_emits.len() >= STREAM_CHUNKS_PER_SECOND {
            return Err(stream_error(
                "SNAPBACK_STREAM_RATE_LIMITED",
                "emit",
                "the stream attempt exceeds 20 emitted chunks per second",
            ));
        }
        let chunk_index = record.chunk_count;
        record.chunk_count += 1;
        record.emitted_bytes = next_total;
        record.recent_emits.push_back(now);
        let emission = StreamChunkEmission {
            attempt_token: record.token.clone(),
            chunk_index,
            chunk_count: record.chunk_count,
            total_bytes: record.emitted_bytes,
        };
        inner.dirty.insert(attempt_token.to_owned());
        Ok(emission)
    }

    /// Initiator cancellation joins the existing terminal compare-and-set.
    pub fn cancel_by_initiator(
        &self,
        attempt_token: &str,
        initiator: &StreamInitiator,
    ) -> SnapbackResult<StreamAttemptTerminal> {
        self.authorize_stream_initiator(attempt_token, initiator)?;
        let mut inner = self.lock();
        let record = inner
            .by_token
            .get_mut(attempt_token)
            .expect("authorization observed the attempt under the same registry");
        if let Some(terminal) = &record.terminal {
            return Ok(terminal.clone());
        }
        let terminal = StreamAttemptTerminal {
            cause: StreamAttemptCause::Cancelled,
            effect_may_have_executed: record.effect_fold(),
            settled_by: StreamAttemptSettledBy::Authored,
        };
        record.terminal = Some(terminal.clone());
        record.settled_at_ms = Some(unix_time_millis());
        record.retain_live_auth_after_settlement();
        for cursor in record.cursors.values_mut() {
            cursor.open = false;
        }
        inner.dirty.insert(attempt_token.to_owned());
        Ok(terminal)
    }

    /// Authored terminal settlement under the lease. Compare-and-set: the
    /// first terminal write wins and every later call receives the committed
    /// winner verbatim.
    pub fn settle(
        &self,
        attempt_token: &str,
        cause: StreamAttemptCause,
        runner: &StreamRunnerIdentity,
    ) -> SnapbackResult<StreamAttemptTerminal> {
        let mut inner = self.lock();
        let Some(record) = inner.by_token.get_mut(attempt_token) else {
            return Err(attempt_error(
                "settle",
                "the stream attempt token is unknown to this host",
                json!({ "expected": "a host-issued attempt token", "received": "unknown attempt token" }),
            ));
        };
        if let Some(terminal) = &record.terminal {
            return Ok(terminal.clone());
        }
        if !record.lease_held_by(&runner.invocation_id) {
            return Err(attempt_error(
                "settle",
                "this runner does not hold the attempt's single-runner lease",
                json!({ "expected": "the current runner lease", "received": "a superseded or concurrent runner" }),
            ));
        }
        let terminal = StreamAttemptTerminal {
            cause,
            effect_may_have_executed: record.effect_fold(),
            settled_by: StreamAttemptSettledBy::Authored,
        };
        record.terminal = Some(terminal.clone());
        record.settled_at_ms = Some(unix_time_millis());
        record.retain_live_auth_after_settlement();
        for cursor in record.cursors.values_mut() {
            cursor.open = false;
        }
        inner.dirty.insert(attempt_token.to_owned());
        Ok(terminal)
    }

    /// The trusted terminalizer: settle every non-terminal attempt bound to
    /// an invocation that can no longer commit (watchdog abandonment,
    /// generation retirement, authority terminalization, or completion
    /// without an authored settle). Bypasses the lease — it IS the
    /// lease-expiry reconciler — and marks the runner finished so a waiting
    /// starter can take the lease over.
    pub fn terminalize_invocation(
        &self,
        runner: &StreamRunnerIdentity,
        cause: StreamAttemptCause,
    ) -> Vec<StreamAttemptTerminal> {
        runner.finished.store(true, Ordering::SeqCst);
        let mut inner = self.lock();
        let Some(tokens) = inner.by_invocation.get(&runner.invocation_id).cloned() else {
            return Vec::new();
        };
        let mut settled = Vec::new();
        for token in tokens {
            if let Some(record) = inner.by_token.get_mut(&token)
                && record.terminal.is_none()
                && record.lease_held_by(&runner.invocation_id)
            {
                let terminal = StreamAttemptTerminal {
                    cause,
                    effect_may_have_executed: record.effect_fold(),
                    settled_by: StreamAttemptSettledBy::Terminalizer,
                };
                record.terminal = Some(terminal.clone());
                record.settled_at_ms = Some(unix_time_millis());
                record.retain_live_auth_after_settlement();
                for cursor in record.cursors.values_mut() {
                    cursor.open = false;
                }
                inner.dirty.insert(token);
                settled.push(terminal);
            }
        }
        settled
    }

    #[cfg(test)]
    pub fn terminal(&self, attempt_token: &str) -> Option<StreamAttemptTerminal> {
        self.lock()
            .by_token
            .get(attempt_token)
            .and_then(|record| record.terminal.clone())
    }

    #[cfg(test)]
    fn index_counts(&self) -> (usize, usize, usize, usize, usize) {
        let inner = self.lock();
        (
            inner.by_token.len(),
            inner.by_client_key.len(),
            inner.by_invocation.len(),
            inner.by_cursor.len(),
            inner.dirty.len(),
        )
    }
}

/// Process-global registry, namespaced per instance by the caller (the local
/// server namespaces by its `SharedSnapback` allocation identity).
pub fn global_stream_attempt_registry() -> &'static StreamAttemptRegistry {
    static REGISTRY: OnceLock<StreamAttemptRegistry> = OnceLock::new();
    REGISTRY.get_or_init(StreamAttemptRegistry::default)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runner() -> StreamRunnerIdentity {
        StreamRunnerIdentity::new(Arc::new(AtomicBool::new(false)))
    }

    fn registry() -> StreamAttemptRegistry {
        StreamAttemptRegistry::default()
    }

    #[test]
    fn start_is_idempotent_and_second_live_runner_gets_no_lease() {
        let registry = registry();
        let first = runner();
        let second = runner();
        let started = registry
            .start(1, "client-key", &first, None)
            .expect("start");
        assert!(started.lease_held);
        assert_eq!(started.runner_generation, 1);

        let joined = registry
            .start(1, "client-key", &second, None)
            .expect("join");
        assert_eq!(joined.attempt_token, started.attempt_token);
        assert!(!joined.lease_held, "a live holder keeps the lease");
        assert_eq!(joined.runner_generation, 1);

        // The same invocation re-starting still holds its lease.
        let same = registry
            .start(1, "client-key", &first, None)
            .expect("restart");
        assert!(same.lease_held);
    }

    #[test]
    fn lease_takeover_requires_a_dead_holder_and_bumps_runner_generation() {
        let registry = registry();
        let first = runner();
        let second = runner();
        let started = registry.start(7, "key", &first, None).expect("start");
        first.abandoned.store(true, Ordering::SeqCst);
        let taken = registry.start(7, "key", &second, None).expect("takeover");
        assert_eq!(taken.attempt_token, started.attempt_token);
        assert!(taken.lease_held);
        assert_eq!(taken.runner_generation, 2);

        // The superseded runner can no longer commit progress or settle.
        assert_eq!(
            registry
                .progress_guard(&first)
                .expect_err("superseded runner is fenced")
                .diagnostic
                .code,
            "SNAPBACK_ACTION_STREAM_INVALID"
        );
        assert_eq!(
            registry
                .settle(&started.attempt_token, StreamAttemptCause::Complete, &first)
                .expect_err("superseded runner cannot settle")
                .diagnostic
                .code,
            "SNAPBACK_ACTION_STREAM_INVALID"
        );
    }

    #[test]
    fn settle_is_compare_and_set_and_returns_the_durable_winner_verbatim() {
        let registry = registry();
        let holder = runner();
        let started = registry.start(1, "cas", &holder, None).expect("start");
        registry
            .bind_cursor(&started.attempt_token, "cursor-1", &holder)
            .expect("bind");

        // Terminalizer races the authored settle and wins the CAS.
        let settled = registry.terminalize_invocation(&holder, StreamAttemptCause::TimedOut);
        assert_eq!(settled.len(), 1);
        let authored = registry
            .settle(
                &started.attempt_token,
                StreamAttemptCause::Complete,
                &holder,
            )
            .expect("late authored settle receives the winner");
        assert_eq!(authored.cause, StreamAttemptCause::TimedOut);
        assert_eq!(authored.settled_by, StreamAttemptSettledBy::Terminalizer);
        assert!(
            authored.effect_may_have_executed,
            "a bound cursor is initiation_possible until proven otherwise"
        );
    }

    #[test]
    fn durably_flushed_terminal_attempt_is_reaped_from_every_registry_index() {
        let registry = registry();
        let holder = runner();
        let started = registry.start(1, "reap", &holder, None).expect("start");
        registry
            .bind_cursor(&started.attempt_token, "cursor-reap", &holder)
            .expect("bind");
        registry
            .settle(
                &started.attempt_token,
                StreamAttemptCause::Complete,
                &holder,
            )
            .expect("settle");

        let snapshots = registry.dirty_snapshots(1);
        assert_eq!(snapshots.len(), 1);
        assert!(snapshots[0].terminal.is_some());
        registry.clear_flushed(&snapshots);

        // The holder invocation still references the attempt: the flushed
        // terminal must stay observable (per-read cancellation signal, settle
        // returning the winner verbatim) — only the dirty flag clears.
        assert!(
            registry.terminal(&started.attempt_token).is_some(),
            "a referenced terminal attempt survives its durable flush"
        );
        assert!(registry.cursor_attempt_terminal("cursor-reap"));
        assert_eq!(registry.index_counts().4, 0, "the dirty flag clears");

        // Releasing the last referencing invocation reaps the durably
        // flushed terminal record from every index.
        registry.release_invocation(&holder);
        assert_eq!(registry.index_counts(), (0, 0, 0, 0, 0));
        assert_eq!(registry.terminal(&started.attempt_token), None);
    }

    #[test]
    fn release_of_a_dirty_terminal_attempt_defers_reap_to_the_next_flush() {
        let registry = registry();
        let holder = runner();
        let started = registry
            .start(1, "reap-dirty", &holder, None)
            .expect("start");
        registry
            .settle(&started.attempt_token, StreamAttemptCause::Failed, &holder)
            .expect("settle");

        // Released before the terminal row was durably flushed: the record
        // must survive (the pending write still needs a flush point).
        registry.release_invocation(&holder);
        assert!(registry.terminal(&started.attempt_token).is_some());

        let snapshots = registry.dirty_snapshots(1);
        assert_eq!(snapshots.len(), 1);
        registry.clear_flushed(&snapshots);
        assert_eq!(registry.index_counts(), (0, 0, 0, 0, 0));
    }

    #[test]
    fn abandoned_invocation_terminalization_race_has_exactly_one_winner() {
        let registry = Arc::new(registry());
        let holder = runner();
        let started = registry.start(3, "race", &holder, None).expect("start");
        registry
            .bind_cursor(&started.attempt_token, "cursor-race", &holder)
            .expect("bind");
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let authored = {
            let registry = registry.clone();
            let holder = holder.clone();
            let token = started.attempt_token.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                registry.settle(&token, StreamAttemptCause::Complete, &holder)
            })
        };
        let terminalizer = {
            let registry = registry.clone();
            let holder = holder.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                registry.terminalize_invocation(&holder, StreamAttemptCause::Cancelled)
            })
        };
        let authored = authored.join().expect("authored settle joins");
        let terminalized = terminalizer.join().expect("terminalizer joins");
        let winner = registry
            .terminal(&started.attempt_token)
            .expect("a durable winner always exists");
        match (&authored, terminalized.as_slice()) {
            (Ok(terminal), []) => {
                assert_eq!(terminal, &winner);
                assert_eq!(winner.settled_by, StreamAttemptSettledBy::Authored);
            }
            (Ok(terminal), [by_terminalizer]) => {
                // The terminalizer won the CAS; the authored path received
                // the committed winner verbatim.
                assert_eq!(by_terminalizer, &winner);
                assert_eq!(terminal, &winner);
                assert_eq!(winner.settled_by, StreamAttemptSettledBy::Terminalizer);
            }
            other => panic!("unexpected race outcome: {other:?}"),
        }
    }

    #[test]
    fn retry_after_first_durable_progress_commit_is_refused() {
        let registry = registry();
        let holder = runner();
        let started = registry.start(1, "retry", &holder, None).expect("start");
        registry
            .bind_cursor(&started.attempt_token, "cursor-a", &holder)
            .expect("first upstream open");
        registry.record_progress_commit(&holder);
        let refusal = registry
            .bind_cursor(&started.attempt_token, "cursor-b", &holder)
            .expect_err("reopen after durable progress must fail");
        assert_eq!(refusal.diagnostic.code, "SNAPBACK_ACTION_STREAM_INVALID");

        // Before any progress commit a reopen (idempotent retry) is legal.
        let fresh = registry
            .start(1, "retry-fresh", &holder, None)
            .expect("start");
        registry
            .bind_cursor(&fresh.attempt_token, "cursor-c", &holder)
            .expect("first open");
        registry.close_cursor("cursor-c");
        registry
            .bind_cursor(&fresh.attempt_token, "cursor-d", &holder)
            .expect("pre-progress retry is legal");
    }

    #[test]
    fn late_progress_against_a_terminal_attempt_with_open_cursor_is_fenced() {
        let registry = registry();
        let holder = runner();
        let started = registry.start(1, "late", &holder, None).expect("start");
        registry
            .bind_cursor(&started.attempt_token, "cursor-late", &holder)
            .expect("bind");
        // A durable cancellation lands (authored settle) while bytes are in
        // flight; the cursor closes with the settle, so the guard passes
        // afterwards — the fence is the terminal row itself.
        registry
            .settle(
                &started.attempt_token,
                StreamAttemptCause::Cancelled,
                &holder,
            )
            .expect("authored cancel");
        assert!(registry.progress_guard(&holder).is_ok());

        // But a cursor that somehow remains open against a terminal attempt
        // (the abandoned-read window) is refused.
        registry
            .bind_cursor(&started.attempt_token, "cursor-zombie", &holder)
            .expect_err("terminal attempt refuses new cursors");
    }

    #[test]
    fn initiation_narrowing_and_response_observed_fold_into_certainty() {
        let registry = registry();
        let holder = runner();
        let started = registry.start(1, "fold", &holder, None).expect("start");
        registry
            .bind_cursor(&started.attempt_token, "cursor-1", &holder)
            .expect("bind");
        registry.cursor_initiation("cursor-1", StreamInitiationState::DefinitelyNotInitiated);
        let settled = registry.terminalize_invocation(&holder, StreamAttemptCause::Failed);
        assert_eq!(settled.len(), 1);
        assert!(
            !settled[0].effect_may_have_executed,
            "a provable pre-send failure carries no effect uncertainty"
        );

        let second = registry.start(1, "fold-2", &holder, None).expect("start");
        registry
            .bind_cursor(&second.attempt_token, "cursor-2", &holder)
            .expect("bind");
        registry.cursor_initiation("cursor-2", StreamInitiationState::ResponseObserved);
        // response_observed is absorbing: a later narrowing attempt is a bug
        // and must not un-observe the response.
        registry.cursor_initiation("cursor-2", StreamInitiationState::DefinitelyNotInitiated);
        let settled = registry.terminalize_invocation(&holder, StreamAttemptCause::Cancelled);
        assert_eq!(settled.len(), 1);
        assert!(settled[0].effect_may_have_executed);
    }

    #[test]
    fn output_stream_privacy_indexes_bounds_and_cancel_share_the_attempt_lease() {
        let registry = registry();
        let holder = runner();
        let initiator = StreamInitiator::SessionUser("user-a".to_owned());
        let started = registry
            .start_with_metadata(
                9,
                "output-stream",
                &holder,
                None,
                StreamAttemptMetadata {
                    function_id: Some("app:conversation".to_owned()),
                    initiator: Some(initiator.clone()),
                    started_at_ms: 100,
                },
            )
            .expect("start output stream");

        registry
            .authorize_stream_initiator(&started.attempt_token, &initiator)
            .expect("the initiating user reconnects on any connection");
        for outsider in [
            StreamInitiator::SessionUser("user-b".to_owned()),
            StreamInitiator::ServiceCredential("credential-b".to_owned()),
            StreamInitiator::AnonymousConnection("connection-b".to_owned()),
        ] {
            assert_eq!(
                registry
                    .authorize_stream_initiator(&started.attempt_token, &outsider)
                    .expect_err("room possession is not stream authority")
                    .diagnostic
                    .code,
                "SNAPBACK_STREAM_FORBIDDEN"
            );
        }

        let first = registry
            .emit_chunk(&started.attempt_token, 5, &holder)
            .expect("first emit");
        let second = registry
            .emit_chunk(&started.attempt_token, 7, &holder)
            .expect("second emit");
        assert_eq!((first.chunk_index, second.chunk_index), (0, 1));
        assert_eq!(second.total_bytes, 12);
        assert_eq!(
            registry
                .emit_chunk(&started.attempt_token, STREAM_CHUNK_MAX_BYTES + 1, &holder)
                .expect_err("chunk ceiling")
                .diagnostic
                .code,
            "SNAPBACK_STREAM_CHUNK_TOO_LARGE"
        );

        {
            let mut inner = registry.lock();
            let record = inner.by_token.get_mut(&started.attempt_token).unwrap();
            record.emitted_bytes = STREAM_ATTEMPT_MAX_BYTES as u64;
            record.recent_emits.clear();
        }
        assert_eq!(
            registry
                .emit_chunk(&started.attempt_token, 1, &holder)
                .expect_err("attempt ceiling")
                .diagnostic
                .code,
            "SNAPBACK_STREAM_ATTEMPT_LIMIT_EXCEEDED"
        );

        let terminal = registry
            .cancel_by_initiator(&started.attempt_token, &initiator)
            .expect("initiator cancel");
        assert_eq!(terminal.cause, StreamAttemptCause::Cancelled);
        assert_eq!(
            registry
                .emit_chunk(&started.attempt_token, 1, &holder)
                .expect_err("next emit observes cancellation")
                .diagnostic
                .code,
            "SNAPBACK_STREAM_CANCELLED"
        );
    }

    #[test]
    fn output_stream_rate_limit_is_typed() {
        let registry = registry();
        let holder = runner();
        let started = registry
            .start_with_metadata(
                10,
                "rate-stream",
                &holder,
                None,
                StreamAttemptMetadata {
                    function_id: Some("app:rate".to_owned()),
                    initiator: Some(StreamInitiator::ServiceCredential(
                        "credential-a".to_owned(),
                    )),
                    started_at_ms: 100,
                },
            )
            .expect("start rate stream");
        for _ in 0..STREAM_CHUNKS_PER_SECOND {
            registry
                .emit_chunk(&started.attempt_token, 1, &holder)
                .expect("burst allowance");
        }
        assert_eq!(
            registry
                .emit_chunk(&started.attempt_token, 1, &holder)
                .expect_err("rate ceiling")
                .diagnostic
                .code,
            "SNAPBACK_STREAM_RATE_LIMITED"
        );
    }
}
