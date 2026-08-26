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

use crate::auth::invocation::PreparedAuthority;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::Serialize;
use serde_json::{Value, json};
use snapback_kernel::storage::DurableStreamAttempt;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use uuid::Uuid;

pub use snapback_types::stream_attempt::*;

pub const STREAM_CHUNK_MAX_BYTES: usize = 16 * 1024;
pub const STREAM_ATTEMPT_MAX_BYTES: usize = 2 * 1024 * 1024;
pub const STREAM_CHUNKS_PER_SECOND: usize = 20;
const STREAM_LIVE_AUTH_RETENTION: std::time::Duration = std::time::Duration::from_secs(30);

/// Opaque origin for a transition backed by a live caller publication.
///
/// The prepared authority is deliberately private: callers can carry this
/// capability but cannot manufacture or retag it. Only
/// [`PreparedAuthority::stream_attempt_origin`] constructs it.
///
/// ```compile_fail,E0451
/// use snapback_sync::stream_attempt::CallerAuthorized;
/// let _forged = CallerAuthorized { _authority: todo!() };
/// ```
pub struct CallerAuthorized {
    _authority: PreparedAuthority,
}

/// Opaque origin for the same authored transitions when only the active mode
/// admits the credential-free background or Dev invocation.
///
/// Like [`CallerAuthorized`], this cannot be constructed or selected from a
/// boolean, cause, or caller-supplied enum.
///
/// ```compile_fail,E0451
/// use snapback_sync::stream_attempt::ModeOnly;
/// let _forged = ModeOnly { _authority: todo!() };
/// ```
pub struct ModeOnly {
    _authority: PreparedAuthority,
}

enum PreparedStreamAttemptOriginKind {
    CallerAuthorized(CallerAuthorized),
    ModeOnly(ModeOnly),
}

/// The closed caller/mode origin derived from one immutable
/// [`PreparedAuthority`]. Its classification is private, so a transition site
/// must dispatch through the methods on this capability instead of choosing a
/// provenance tag itself.
pub struct PreparedStreamAttemptOrigin {
    kind: PreparedStreamAttemptOriginKind,
}

impl PreparedAuthority {
    /// Classify stream-attempt transition authority once, at the transition
    /// boundary. A retained authorization-stream or finite-service
    /// publication makes the transition caller-authorized; without either
    /// carrier, the transition is mode-only regardless of auth mode or
    /// resolved authority.
    // @ref LLP 0058#shared-invocation-authority — PreparedAuthority is the
    //   closed source/mode/resolved-authority/publication boundary.
    pub fn stream_attempt_origin(&self) -> PreparedStreamAttemptOrigin {
        let kind = match self.stream_attempt_publication_carriers() {
            (None, None) => PreparedStreamAttemptOriginKind::ModeOnly(ModeOnly {
                _authority: self.clone(),
            }),
            (Some(_), _) | (None, Some(_)) => {
                PreparedStreamAttemptOriginKind::CallerAuthorized(CallerAuthorized {
                    _authority: self.clone(),
                })
            }
        };
        PreparedStreamAttemptOrigin { kind }
    }

    /// Mint the host capability and public runner identity together for this
    /// already-prepared invocation. Callers that hold only a runner identity
    /// cannot upgrade it into host-settlement authority.
    pub fn stream_runner_host(&self, abandoned: Arc<AtomicBool>) -> StreamRunnerHost {
        StreamRunnerHost::new(self.clone(), abandoned)
    }
}

trait StreamAttemptTransitionOrigin {
    #[cfg(any(test, feature = "test-support"))]
    const PROVENANCE: &'static str;
}

impl StreamAttemptTransitionOrigin for CallerAuthorized {
    #[cfg(any(test, feature = "test-support"))]
    const PROVENANCE: &'static str = "CallerAuthorized";
}

impl StreamAttemptTransitionOrigin for ModeOnly {
    #[cfg(any(test, feature = "test-support"))]
    const PROVENANCE: &'static str = "ModeOnly";
}

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
    commit_gate: Arc<InvocationCommitGate>,
    finished: Arc<AtomicBool>,
}

impl RunnerHolder {
    fn alive(&self) -> bool {
        !self.commit_gate.abandoned.load(Ordering::SeqCst) && !self.finished.load(Ordering::SeqCst)
    }

    fn is_exact_runner(&self, runner: &StreamRunnerIdentity) -> bool {
        self.invocation_id == runner.invocation_id
            && Arc::ptr_eq(&self.commit_gate, &runner.commit_gate)
            && Arc::ptr_eq(&self.finished, &runner.finished)
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

    fn lease_held_by(&self, runner: &StreamRunnerIdentity) -> bool {
        self.holder
            .as_ref()
            .is_some_and(|holder| holder.is_exact_runner(runner))
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
    #[cfg(any(test, feature = "test-support"))]
    transition_classifications: Vec<(&'static str, &'static str)>,
}

impl RegistryInner {
    fn classify_transition<P: StreamAttemptTransitionOrigin>(
        &mut self,
        _origin: &P,
        _transition: &'static str,
    ) {
        #[cfg(any(test, feature = "test-support"))]
        self.transition_classifications
            .push((_transition, P::PROVENANCE));
    }

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

/// The one runner-owned gate identity shared by detached mutation commits,
/// watchdog abandonment, and stream-attempt transition origins. R1 only
/// unifies identity; stream-attempt persistence does not acquire this gate.
pub struct InvocationCommitGate {
    commit: StdMutex<()>,
    abandoned: Arc<AtomicBool>,
}

impl InvocationCommitGate {
    fn new(abandoned: Arc<AtomicBool>) -> Self {
        Self {
            commit: StdMutex::new(()),
            abandoned,
        }
    }

    pub fn try_lock(&self) -> std::sync::TryLockResult<std::sync::MutexGuard<'_, ()>> {
        self.commit.try_lock()
    }

    pub fn lock(&self) -> std::sync::LockResult<std::sync::MutexGuard<'_, ()>> {
        self.commit.lock()
    }

    pub fn abandoned(&self) -> &AtomicBool {
        self.abandoned.as_ref()
    }
}

/// Identity of one detached action invocation as the control plane sees it:
/// the opaque id, shared runner gate, and finished flag the lease consults.
/// Host-settlement authority cannot be derived from this public identity.
#[derive(Clone)]
pub struct StreamRunnerIdentity {
    invocation_id: String,
    commit_gate: Arc<InvocationCommitGate>,
    finished: Arc<AtomicBool>,
}

impl StreamRunnerIdentity {
    pub fn new(abandoned: Arc<AtomicBool>) -> Self {
        Self {
            invocation_id: Uuid::new_v4().to_string(),
            commit_gate: Arc::new(InvocationCommitGate::new(abandoned)),
            finished: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn invocation_id(&self) -> &str {
        &self.invocation_id
    }

    pub fn commit_gate(&self) -> Arc<InvocationCommitGate> {
        self.commit_gate.clone()
    }
}

/// Opaque owner of host-settlement authority for one exact runner. Only a
/// prepared invocation can mint this capability; there is no public
/// constructor or conversion from a caller-held [`StreamRunnerIdentity`].
///
/// ```compile_fail,E0624
/// use snapback_sync::auth::invocation::PreparedAuthority;
/// use snapback_sync::stream_attempt::StreamRunnerHost;
/// use std::sync::{Arc, atomic::AtomicBool};
///
/// let authority: PreparedAuthority = todo!();
/// let _forged = StreamRunnerHost::new(authority, Arc::new(AtomicBool::new(false)));
/// ```
#[derive(Clone)]
pub struct StreamRunnerHost {
    runner: StreamRunnerIdentity,
    _authority: PreparedAuthority,
}

impl StreamRunnerHost {
    fn new(authority: PreparedAuthority, abandoned: Arc<AtomicBool>) -> Self {
        Self {
            runner: StreamRunnerIdentity::new(abandoned),
            _authority: authority,
        }
    }

    pub fn runner(&self) -> &StreamRunnerIdentity {
        &self.runner
    }

    /// Construct the module-private transition origin only at a host entry
    /// point, bound to this capability's exact runner identity.
    fn host_settlement(&self) -> HostSettlement<'_> {
        HostSettlement {
            runner: &self.runner,
        }
    }
}

/// Module-private host-settlement origin borrowed from the exact runner whose
/// transition it authorizes. It carries no `PreparedAuthority` and remains
/// usable after caller or session retirement.
struct HostSettlement<'a> {
    runner: &'a StreamRunnerIdentity,
}

impl StreamAttemptTransitionOrigin for HostSettlement<'_> {
    #[cfg(any(test, feature = "test-support"))]
    const PROVENANCE: &'static str = "HostSettlement";
}

pub struct StreamAttemptRegistry {
    inner: StdMutex<RegistryInner>,
    persistence_mac_key:
        StdMutex<Option<snapback_types::stream_attempt::StreamAttemptPersistenceMacKey>>,
}

impl Default for StreamAttemptRegistry {
    fn default() -> Self {
        Self {
            inner: StdMutex::new(RegistryInner::default()),
            persistence_mac_key: StdMutex::new(None),
        }
    }
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

    fn with_persistence_mac_key<T>(
        &self,
        operation: impl FnOnce(&snapback_types::stream_attempt::StreamAttemptPersistenceMacKey) -> T,
    ) -> SnapbackResult<T> {
        let mut mac_key = self
            .persistence_mac_key
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if mac_key.is_none() {
            *mac_key = Some(
                snapback_types::stream_attempt::StreamAttemptPersistenceMacKey::generate()
                    .map_err(|_| {
                        SnapbackError::error(
                            "SNAPBACK_ACTION_STREAM_PERSISTENCE_AUTHORITY_UNAVAILABLE",
                            "runtime",
                            "the stream-attempt registry could not create its persistence authority",
                        )
                    })?,
            );
        }
        Ok(operation(
            mac_key
                .as_ref()
                .expect("stream persistence MAC key was initialized"),
        ))
    }

    /// Opaque verify-only half registered with the exact serving database.
    /// The MAC-authoring half never leaves this registry.
    pub fn persistence_verifier(
        &self,
    ) -> SnapbackResult<snapback_types::stream_attempt::StreamAttemptPersistenceVerifier> {
        self.with_persistence_mac_key(|key| key.verifier())
    }

    /// Snapshot and authenticate the exact dirty rows for one instance namespace.
    /// Callers cannot add or replace rows after this cut without invalidating
    /// the storage-verified HMAC-SHA256 tag.
    pub fn persistence_batch(
        &self,
        namespace: usize,
    ) -> SnapbackResult<(
        Vec<PersistedStreamAttempt>,
        snapback_types::stream_attempt::StreamAttemptPersistenceBatch,
    )> {
        let snapshots = self.dirty_snapshots(namespace);
        let rows = snapshots
            .iter()
            .map(|snapshot| snapshot.to_row().map_err(Into::into))
            .collect::<SnapbackResult<Vec<_>>>()?;
        let batch = self.with_persistence_mac_key(|key| key.authenticate(rows))?;
        Ok((snapshots, batch))
    }

    /// Idempotent start by client key. The first caller creates the attempt
    /// and binds the lease; a concurrent caller receives the existing
    /// attempt WITHOUT the lease while the holder is alive; once the holder
    /// is abandoned or finished, a new caller takes the lease over under an
    /// incremented runner generation.
    fn stage_start_from<P: StreamAttemptTransitionOrigin>(
        &self,
        origin: &P,
        namespace: usize,
        client_key: &str,
        runner: &StreamRunnerIdentity,
        persisted: Option<&PersistedStreamAttempt>,
    ) -> SnapbackResult<StreamAttemptStart> {
        self.stage_start_with_metadata_from(
            origin,
            namespace,
            client_key,
            runner,
            persisted,
            StreamAttemptMetadata::default(),
        )
    }

    /// Start the same LLP 0076 attempt with the output-stream privacy and
    /// transcript facts attached at creation.
    fn stage_start_with_metadata_from<P: StreamAttemptTransitionOrigin>(
        &self,
        origin: &P,
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
                (None, Some(holder)) if holder.is_exact_runner(runner) => true,
                (None, Some(holder)) if holder.alive() => false,
                (None, _) => {
                    // Lease takeover: the previous runner is gone without a
                    // terminal row (a narrow window before the terminalizer
                    // acts); the new runner supersedes it atomically.
                    record.runner_generation += 1;
                    record.holder = Some(RunnerHolder {
                        invocation_id: runner.invocation_id.clone(),
                        commit_gate: runner.commit_gate.clone(),
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
                inner.classify_transition(origin, "takeover");
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
                commit_gate: runner.commit_gate.clone(),
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
        if terminal.is_some() {
            inner.classify_transition(origin, "terminalAdoption");
        } else if persisted.is_some() {
            inner.classify_transition(origin, "takeover");
        } else {
            inner.classify_transition(origin, "freshStart");
        }
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
    fn stage_cursor_premark_from<P: StreamAttemptTransitionOrigin>(
        &self,
        origin: &P,
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
        if !record.lease_held_by(runner) {
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
        inner.classify_transition(origin, "cursorPremark");
        inner
            .by_cursor
            .insert(cursor_id.to_owned(), attempt_token.to_owned());
        inner.dirty.insert(attempt_token.to_owned());
        Ok(())
    }

    /// Narrow or advance a cursor's initiation state. Narrowing to
    /// `definitely_not_initiated` is legal only from `initiation_possible`
    /// (a provable pre-send failure); `response_observed` is absorbing.
    pub fn record_transport_outcome_host(
        &self,
        host: &StreamRunnerHost,
        cursor_id: &str,
        state: StreamInitiationState,
    ) {
        let origin = host.host_settlement();
        let runner = origin.runner;
        let mut inner = self.lock();
        let Some(token) = inner.by_cursor.get(cursor_id).cloned() else {
            return;
        };
        if let Some(record) = inner.by_token.get_mut(&token)
            && record.lease_held_by(runner)
            && let Some(cursor) = record.cursors.get_mut(cursor_id)
            && cursor.initiation_state != StreamInitiationState::ResponseObserved
        {
            cursor.initiation_state = state;
            inner.classify_transition(&origin, "transportOutcome");
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

    pub fn record_cursor_close_host(&self, host: &StreamRunnerHost, cursor_id: &str) {
        let origin = host.host_settlement();
        let runner = origin.runner;
        let mut inner = self.lock();
        let Some(token) = inner.by_cursor.get(cursor_id).cloned() else {
            return;
        };
        if let Some(record) = inner.by_token.get_mut(&token)
            && record.lease_held_by(runner)
            && let Some(cursor) = record.cursors.get_mut(cursor_id)
        {
            cursor.open = false;
            inner.classify_transition(&origin, "cursorClose");
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
                    if !record.lease_held_by(runner) {
                        return Err(attempt_error(
                            "progress",
                            "this runner does not hold the attempt's single-runner lease",
                            json!({ "expected": "the current runner lease", "received": "a superseded or concurrent runner" }),
                        ));
                    }
                }
                Some(terminal) => {
                    if record.open_cursor_count() > 0 && record.lease_held_by(runner) {
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
    pub fn record_progress_commit_host(&self, host: &StreamRunnerHost) {
        let origin = host.host_settlement();
        let runner = origin.runner;
        let mut inner = self.lock();
        let Some(tokens) = inner.by_invocation.get(&runner.invocation_id).cloned() else {
            return;
        };
        for token in tokens {
            if let Some(record) = inner.by_token.get_mut(&token)
                && record.terminal.is_none()
                && record.lease_held_by(runner)
                && record.open_cursor_count() > 0
            {
                record.progress_commits += 1;
                inner.classify_transition(&origin, "progressCommit");
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
    pub fn record_emit_counters_host(
        &self,
        host: &StreamRunnerHost,
        attempt_token: &str,
        byte_len: usize,
    ) -> SnapbackResult<StreamChunkEmission> {
        let origin = host.host_settlement();
        let runner = origin.runner;
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
        if !record.lease_held_by(runner) {
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
        inner.classify_transition(&origin, "emitCounters");
        inner.dirty.insert(attempt_token.to_owned());
        Ok(emission)
    }

    /// Initiator cancellation joins the existing terminal compare-and-set.
    fn stage_initiator_cancel_from<P: StreamAttemptTransitionOrigin>(
        &self,
        origin: &P,
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
        inner.classify_transition(origin, "initiatorCancel");
        inner.dirty.insert(attempt_token.to_owned());
        Ok(terminal)
    }

    /// Authored terminal settlement under the lease. Compare-and-set: the
    /// first terminal write wins and every later call receives the committed
    /// winner verbatim.
    fn settle_authored<P: StreamAttemptTransitionOrigin>(
        &self,
        origin: &P,
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
        if !record.lease_held_by(runner) {
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
        inner.classify_transition(origin, "authoredTerminal");
        inner.dirty.insert(attempt_token.to_owned());
        Ok(terminal)
    }

    /// Provider/automatic completion settlement under the exact runner lease.
    /// This is intentionally separate from authored settlement even when both
    /// carry the same terminal cause.
    pub fn settle_provider_outcome_host(
        &self,
        host: &StreamRunnerHost,
        attempt_token: &str,
        cause: StreamAttemptCause,
    ) -> SnapbackResult<StreamAttemptTerminal> {
        let origin = host.host_settlement();
        let runner = origin.runner;
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
        if !record.lease_held_by(runner) || !record.holder.as_ref().is_some_and(RunnerHolder::alive)
        {
            return Err(attempt_error(
                "settle",
                "this live runner does not hold the attempt's single-runner lease",
                json!({ "expected": "the current live runner lease", "received": "an abandoned, finished, superseded, or concurrent runner" }),
            ));
        }
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
        inner.classify_transition(&origin, "providerTerminal");
        inner.dirty.insert(attempt_token.to_owned());
        Ok(terminal)
    }

    /// Adopt a storage-issued terminal row as host settlement. The witness
    /// owns the exact current host supplied for the durable read, so callers
    /// cannot substitute a deserialized row or swap that host after the read.
    /// Storage does not claim this current adopter was the historical runner;
    /// the durable v1 row carries no identity capable of proving that stronger
    /// correspondence.
    ///
    /// ```compile_fail,E0451
    /// use snapback_kernel::storage::DurableStreamAttempt;
    /// use snapback_sync::stream_attempt::{
    ///     PersistedStreamAttempt, StreamAttemptRegistry, StreamRunnerHost,
    /// };
    /// let row: PersistedStreamAttempt = todo!();
    /// let forged: DurableStreamAttempt<StreamRunnerHost> =
    ///     DurableStreamAttempt { persisted: row, read_context: todo!() };
    /// let _ = StreamAttemptRegistry::default().adopt_terminal_host(1, forged);
    /// ```
    pub fn adopt_terminal_host(
        &self,
        namespace: usize,
        durable: DurableStreamAttempt<StreamRunnerHost>,
    ) -> SnapbackResult<StreamAttemptStart> {
        let persisted = durable.persisted();
        if persisted.terminal.is_none() {
            return Err(attempt_error(
                "attemptStart",
                "host terminal adoption requires a durable terminal attempt",
                json!({ "expected": "a terminal durable attempt", "received": "a nonterminal durable attempt" }),
            ));
        }
        let host = durable.read_context();
        let origin = host.host_settlement();
        self.stage_start_from(
            &origin,
            namespace,
            &persisted.client_key,
            origin.runner,
            Some(persisted),
        )
    }

    /// The trusted terminalizer: settle every non-terminal attempt bound to
    /// an invocation that can no longer commit (watchdog abandonment,
    /// generation retirement, authority terminalization, or completion
    /// without an authored settle). Bypasses the lease — it IS the
    /// lease-expiry reconciler — and marks the runner finished so a waiting
    /// starter can take the lease over.
    pub fn terminalize_invocation_host(
        &self,
        host: &StreamRunnerHost,
        cause: StreamAttemptCause,
    ) -> Vec<StreamAttemptTerminal> {
        let origin = host.host_settlement();
        let runner = origin.runner;
        runner.finished.store(true, Ordering::SeqCst);
        let mut inner = self.lock();
        let Some(tokens) = inner.by_invocation.get(&runner.invocation_id).cloned() else {
            return Vec::new();
        };
        let mut settled = Vec::new();
        for token in tokens {
            if let Some(record) = inner.by_token.get_mut(&token)
                && record.terminal.is_none()
                && record.lease_held_by(runner)
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
                inner.classify_transition(&origin, "automaticTerminal");
                inner.dirty.insert(token);
                settled.push(terminal);
            }
        }
        settled
    }

    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
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

    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn transition_classifications_for_test(&self) -> Vec<(&'static str, &'static str)> {
        self.lock().transition_classifications.clone()
    }
}

impl PreparedStreamAttemptOrigin {
    /// Stage an idempotent fresh start or takeover under the authority class
    /// derived from `PreparedAuthority`. A terminal durable row is rejected;
    /// a host that observed that durable winner must instead call
    /// [`StreamAttemptRegistry::adopt_terminal_host`].
    pub fn stage_start(
        &self,
        registry: &StreamAttemptRegistry,
        namespace: usize,
        client_key: &str,
        runner: &StreamRunnerIdentity,
        persisted: Option<&PersistedStreamAttempt>,
    ) -> SnapbackResult<StreamAttemptStart> {
        if persisted.is_some_and(|row| row.terminal.is_some()) {
            return Err(attempt_error(
                "attemptStart",
                "a durable terminal attempt must enter host adoption",
                json!({ "expected": "a fresh or nonterminal attempt", "received": "a terminal durable attempt" }),
            ));
        }
        match &self.kind {
            PreparedStreamAttemptOriginKind::CallerAuthorized(origin) => {
                registry.stage_start_from(origin, namespace, client_key, runner, persisted)
            }
            PreparedStreamAttemptOriginKind::ModeOnly(origin) => {
                registry.stage_start_from(origin, namespace, client_key, runner, persisted)
            }
        }
    }

    pub fn stage_start_with_metadata(
        &self,
        registry: &StreamAttemptRegistry,
        namespace: usize,
        client_key: &str,
        runner: &StreamRunnerIdentity,
        persisted: Option<&PersistedStreamAttempt>,
        metadata: StreamAttemptMetadata,
    ) -> SnapbackResult<StreamAttemptStart> {
        if persisted.is_some_and(|row| row.terminal.is_some()) {
            return Err(attempt_error(
                "attemptStart",
                "a durable terminal attempt must enter host adoption",
                json!({ "expected": "a fresh or nonterminal attempt", "received": "a terminal durable attempt" }),
            ));
        }
        match &self.kind {
            PreparedStreamAttemptOriginKind::CallerAuthorized(origin) => registry
                .stage_start_with_metadata_from(
                    origin, namespace, client_key, runner, persisted, metadata,
                ),
            PreparedStreamAttemptOriginKind::ModeOnly(origin) => registry
                .stage_start_with_metadata_from(
                    origin, namespace, client_key, runner, persisted, metadata,
                ),
        }
    }

    /// Stage the caller/mode write-ahead cursor premark. Host transport
    /// observations and close use separate host-settlement methods.
    pub fn stage_cursor_premark(
        &self,
        registry: &StreamAttemptRegistry,
        attempt_token: &str,
        cursor_id: &str,
        runner: &StreamRunnerIdentity,
    ) -> SnapbackResult<()> {
        match &self.kind {
            PreparedStreamAttemptOriginKind::CallerAuthorized(origin) => {
                registry.stage_cursor_premark_from(origin, attempt_token, cursor_id, runner)
            }
            PreparedStreamAttemptOriginKind::ModeOnly(origin) => {
                registry.stage_cursor_premark_from(origin, attempt_token, cursor_id, runner)
            }
        }
    }

    pub fn stage_authored_terminal(
        &self,
        registry: &StreamAttemptRegistry,
        attempt_token: &str,
        cause: StreamAttemptCause,
        runner: &StreamRunnerIdentity,
    ) -> SnapbackResult<StreamAttemptTerminal> {
        match &self.kind {
            PreparedStreamAttemptOriginKind::CallerAuthorized(origin) => {
                registry.settle_authored(origin, attempt_token, cause, runner)
            }
            PreparedStreamAttemptOriginKind::ModeOnly(origin) => {
                registry.settle_authored(origin, attempt_token, cause, runner)
            }
        }
    }

    pub fn stage_initiator_cancel(
        &self,
        registry: &StreamAttemptRegistry,
        attempt_token: &str,
        initiator: &StreamInitiator,
    ) -> SnapbackResult<StreamAttemptTerminal> {
        match &self.kind {
            PreparedStreamAttemptOriginKind::CallerAuthorized(origin) => {
                registry.stage_initiator_cancel_from(origin, attempt_token, initiator)
            }
            PreparedStreamAttemptOriginKind::ModeOnly(origin) => {
                registry.stage_initiator_cancel_from(origin, attempt_token, initiator)
            }
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn provenance_for_test(&self) -> &'static str {
        match &self.kind {
            PreparedStreamAttemptOriginKind::CallerAuthorized(_) => "CallerAuthorized",
            PreparedStreamAttemptOriginKind::ModeOnly(_) => "ModeOnly",
        }
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
    use crate::auth::invocation::ResolvedAppAuthority;
    use crate::manifest::AuthMode;

    fn runner_host(runner: &StreamRunnerIdentity) -> StreamRunnerHost {
        StreamRunnerHost {
            runner: runner.clone(),
            _authority: prepared_authority(
                crate::auth::invocation::InvocationSource::LocalAction,
                AuthMode::Dev,
                ResolvedAppAuthority::Anonymous,
            ),
        }
    }

    fn mode_origin() -> PreparedStreamAttemptOrigin {
        crate::auth::invocation::InvocationGate::prepare_authority(
            crate::auth::invocation::InvocationSource::LocalAction,
            AuthMode::Dev,
            crate::contract_types::ServerProfile::Test,
            0,
            0,
            &crate::auth::invocation::WireAuthorityFields::default(),
            ResolvedAppAuthority::Anonymous,
        )
        .expect("prepare mode-only test authority")
        .stream_attempt_origin()
    }

    impl StreamAttemptRegistry {
        fn start(
            &self,
            namespace: usize,
            client_key: &str,
            runner: &StreamRunnerIdentity,
            persisted: Option<&PersistedStreamAttempt>,
        ) -> SnapbackResult<StreamAttemptStart> {
            mode_origin().stage_start(self, namespace, client_key, runner, persisted)
        }

        fn start_with_metadata(
            &self,
            namespace: usize,
            client_key: &str,
            runner: &StreamRunnerIdentity,
            persisted: Option<&PersistedStreamAttempt>,
            metadata: StreamAttemptMetadata,
        ) -> SnapbackResult<StreamAttemptStart> {
            mode_origin()
                .stage_start_with_metadata(self, namespace, client_key, runner, persisted, metadata)
        }

        fn bind_cursor(
            &self,
            attempt_token: &str,
            cursor_id: &str,
            runner: &StreamRunnerIdentity,
        ) -> SnapbackResult<()> {
            mode_origin().stage_cursor_premark(self, attempt_token, cursor_id, runner)
        }

        fn cursor_initiation(
            &self,
            runner: &StreamRunnerIdentity,
            cursor_id: &str,
            state: StreamInitiationState,
        ) {
            self.record_transport_outcome_host(&runner_host(runner), cursor_id, state);
        }

        fn close_cursor(&self, runner: &StreamRunnerIdentity, cursor_id: &str) {
            self.record_cursor_close_host(&runner_host(runner), cursor_id);
        }

        fn record_progress_commit(&self, runner: &StreamRunnerIdentity) {
            self.record_progress_commit_host(&runner_host(runner));
        }

        fn emit_chunk(
            &self,
            attempt_token: &str,
            byte_len: usize,
            runner: &StreamRunnerIdentity,
        ) -> SnapbackResult<StreamChunkEmission> {
            self.record_emit_counters_host(&runner_host(runner), attempt_token, byte_len)
        }

        fn cancel_by_initiator(
            &self,
            attempt_token: &str,
            initiator: &StreamInitiator,
        ) -> SnapbackResult<StreamAttemptTerminal> {
            mode_origin().stage_initiator_cancel(self, attempt_token, initiator)
        }

        fn settle(
            &self,
            attempt_token: &str,
            cause: StreamAttemptCause,
            runner: &StreamRunnerIdentity,
        ) -> SnapbackResult<StreamAttemptTerminal> {
            mode_origin().stage_authored_terminal(self, attempt_token, cause, runner)
        }

        fn terminalize_invocation(
            &self,
            runner: &StreamRunnerIdentity,
            cause: StreamAttemptCause,
        ) -> Vec<StreamAttemptTerminal> {
            self.terminalize_invocation_host(&runner_host(runner), cause)
        }
    }

    fn runner() -> StreamRunnerIdentity {
        StreamRunnerIdentity::new(Arc::new(AtomicBool::new(false)))
    }

    fn registry() -> StreamAttemptRegistry {
        StreamAttemptRegistry::default()
    }

    fn prepared_authority(
        source: crate::auth::invocation::InvocationSource,
        mode: AuthMode,
        resolved: ResolvedAppAuthority,
    ) -> PreparedAuthority {
        crate::auth::invocation::InvocationGate::prepare_authority(
            source,
            mode,
            crate::contract_types::ServerProfile::Test,
            1,
            1,
            &crate::auth::invocation::WireAuthorityFields::default(),
            resolved,
        )
        .expect("prepare classified stream authority")
    }

    fn prepared_origin(
        source: crate::auth::invocation::InvocationSource,
        mode: AuthMode,
        resolved: ResolvedAppAuthority,
    ) -> PreparedStreamAttemptOrigin {
        prepared_authority(source, mode, resolved).stream_attempt_origin()
    }

    fn caller_origin(
        source: crate::auth::invocation::InvocationSource,
        resolved: ResolvedAppAuthority,
    ) -> PreparedStreamAttemptOrigin {
        caller_origin_in_mode(source, AuthMode::Sessions, resolved)
    }

    fn caller_origin_in_mode(
        source: crate::auth::invocation::InvocationSource,
        mode: AuthMode,
        resolved: ResolvedAppAuthority,
    ) -> PreparedStreamAttemptOrigin {
        let (_, publication) = crate::auth::session_projection::FencedPublication::
            anonymous_for_unmanaged_dev_connection();
        prepared_authority(source, mode, resolved)
            .with_fenced_publication(publication)
            .stream_attempt_origin()
    }

    fn session_authority() -> ResolvedAppAuthority {
        crate::auth::invocation::test_session_authority(
            "user-a",
            "session-a",
            "email-code",
            1,
            "authority-a",
            10_000,
            None,
            None,
        )
    }

    #[test]
    fn prepared_authority_carrier_fixtures_map_to_expected_origins() {
        assert_eq!(
            caller_origin(
                crate::auth::invocation::InvocationSource::HttpAction,
                ResolvedAppAuthority::Anonymous,
            )
            .provenance_for_test(),
            "CallerAuthorized"
        );
        assert_eq!(
            caller_origin(
                crate::auth::invocation::InvocationSource::HttpAction,
                session_authority(),
            )
            .provenance_for_test(),
            "CallerAuthorized"
        );
        assert_eq!(
            prepared_origin(
                crate::auth::invocation::InvocationSource::HttpAction,
                AuthMode::Sessions,
                crate::auth::invocation::test_service_authority(
                    "agent-a",
                    "credential-a",
                    1,
                    "grant-a",
                    "token-a",
                    Some("user-a".to_owned()),
                    Vec::new(),
                    10_000,
                    None,
                ),
            )
            .provenance_for_test(),
            "ModeOnly",
            "resolved service identity alone cannot forge a retained publication carrier",
        );
        for origin in [
            prepared_origin(
                crate::auth::invocation::InvocationSource::HttpAction,
                AuthMode::Sessions,
                ResolvedAppAuthority::Anonymous,
            ),
            prepared_origin(
                crate::auth::invocation::InvocationSource::HttpAction,
                AuthMode::Sessions,
                session_authority(),
            ),
            prepared_origin(
                crate::auth::invocation::InvocationSource::WatchEvaluation,
                AuthMode::Sessions,
                crate::auth::invocation::test_revalidated_authority("user-a", "authority-a"),
            ),
            prepared_origin(
                crate::auth::invocation::InvocationSource::Cron,
                AuthMode::Sessions,
                ResolvedAppAuthority::System,
            ),
            prepared_origin(
                crate::auth::invocation::InvocationSource::LocalAction,
                AuthMode::Dev,
                ResolvedAppAuthority::DevImpersonation {
                    user_id: "user-a".to_owned(),
                    roles: Vec::new(),
                    local_dev_only: true,
                },
            ),
        ] {
            assert_eq!(origin.provenance_for_test(), "ModeOnly");
        }
    }

    #[test]
    fn r1_transition_entry_points_record_expected_origin_classifications() {
        let registry = registry();
        // These two fixtures intentionally cross the old mode-proxy rule:
        // Dev + a retained carrier is caller-authorized, while Sessions + no
        // carrier is mode-only. Replacing the carrier rule with the old
        // `mode == Sessions` proxy reverses both classifications.
        let caller = caller_origin_in_mode(
            crate::auth::invocation::InvocationSource::HttpAction,
            AuthMode::Dev,
            ResolvedAppAuthority::Anonymous,
        );
        let mode = prepared_origin(
            crate::auth::invocation::InvocationSource::HttpAction,
            AuthMode::Sessions,
            session_authority(),
        );

        let first = runner();
        let started = mode
            .stage_start(&registry, 41, "mode-takeover", &first, None)
            .expect("mode fresh start");
        first.commit_gate.abandoned.store(true, Ordering::SeqCst);
        let takeover_runner = runner();
        let takeover = mode
            .stage_start(&registry, 41, "mode-takeover", &takeover_runner, None)
            .expect("mode takeover");

        let caller_runner = runner();
        let caller_started = caller
            .stage_start(&registry, 41, "caller", &caller_runner, None)
            .expect("caller fresh start");
        caller
            .stage_cursor_premark(
                &registry,
                &caller_started.attempt_token,
                "cursor-caller",
                &caller_runner,
            )
            .expect("caller cursor premark");
        let caller_host = runner_host(&caller_runner);
        registry.record_transport_outcome_host(
            &caller_host,
            "cursor-caller",
            StreamInitiationState::ResponseObserved,
        );
        registry.record_progress_commit_host(&caller_host);
        registry.record_cursor_close_host(&caller_host, "cursor-caller");
        caller
            .stage_authored_terminal(
                &registry,
                &caller_started.attempt_token,
                StreamAttemptCause::Complete,
                &caller_runner,
            )
            .expect("authored terminal");

        let output_runner = runner();
        let output_host = runner_host(&output_runner);
        let initiator = StreamInitiator::SessionUser("user-a".to_owned());
        let output = caller
            .stage_start_with_metadata(
                &registry,
                41,
                "output",
                &output_runner,
                None,
                StreamAttemptMetadata {
                    function_id: Some("app:stream".to_owned()),
                    initiator: Some(initiator.clone()),
                    started_at_ms: 1,
                },
            )
            .expect("output start");
        registry
            .record_emit_counters_host(&output_host, &output.attempt_token, 1)
            .expect("host emit counters");
        caller
            .stage_initiator_cancel(&registry, &output.attempt_token, &initiator)
            .expect("caller cancellation");

        let provider_runner = runner();
        let provider_host = runner_host(&provider_runner);
        let provider = caller
            .stage_start(&registry, 41, "provider", &provider_runner, None)
            .expect("provider attempt start");
        registry
            .settle_provider_outcome_host(
                &provider_host,
                &provider.attempt_token,
                StreamAttemptCause::Complete,
            )
            .expect("provider terminal");

        let automatic_runner = runner();
        let automatic_host = runner_host(&automatic_runner);
        caller
            .stage_start(&registry, 41, "automatic", &automatic_runner, None)
            .expect("automatic attempt start");
        registry.terminalize_invocation_host(&automatic_host, StreamAttemptCause::Failed);

        let terminal_snapshot = registry
            .dirty_snapshots(41)
            .into_iter()
            .find(|snapshot| snapshot.token == caller_started.attempt_token)
            .expect("terminal snapshot to persist before adoption");
        let storage = snapback_kernel::storage::LocalDatabase::memory()
            .expect("durable transition test store");
        let verifier = registry
            .persistence_verifier()
            .expect("registry persistence verifier");
        let mut storage =
            snapback_kernel::storage::ServingDatabase::adopt_with_stream_attempt_verifier(
                storage, verifier,
            )
            .expect("adopt durable transition test store");
        let (snapshots, batch) = registry
            .persistence_batch(41)
            .expect("authorize exact registry snapshots");
        assert!(
            snapshots.contains(&terminal_snapshot),
            "authorized persistence batch contains the terminal adoption source"
        );
        storage
            .settlement()
            .upsert_stream_attempts(&batch, 1)
            .expect("terminal adoption source commits");

        let adoption_registry = StreamAttemptRegistry::default();
        let durable_terminal = storage
            .settlement_read()
            .durable_stream_attempt_by_client_key("caller", caller_host.clone())
            .expect("read committed terminal")
            .expect("committed terminal exists");
        adoption_registry
            .adopt_terminal_host(42, durable_terminal)
            .expect("terminal adoption");

        assert_eq!(
            registry.transition_classifications_for_test(),
            vec![
                ("freshStart", "ModeOnly"),
                ("takeover", "ModeOnly"),
                ("freshStart", "CallerAuthorized"),
                ("cursorPremark", "CallerAuthorized"),
                ("transportOutcome", "HostSettlement"),
                ("progressCommit", "HostSettlement"),
                ("cursorClose", "HostSettlement"),
                ("authoredTerminal", "CallerAuthorized"),
                ("freshStart", "CallerAuthorized"),
                ("emitCounters", "HostSettlement"),
                ("initiatorCancel", "CallerAuthorized"),
                ("freshStart", "CallerAuthorized"),
                ("providerTerminal", "HostSettlement"),
                ("freshStart", "CallerAuthorized"),
                ("automaticTerminal", "HostSettlement"),
            ]
        );
        assert_eq!(
            adoption_registry.transition_classifications_for_test(),
            vec![("terminalAdoption", "HostSettlement")]
        );
        assert_eq!(started.attempt_token, takeover.attempt_token);
    }

    #[test]
    fn storage_rejects_unsigned_tampered_or_foreign_registry_persistence_batches() {
        let primary_registry = registry();
        let legitimate_runner = runner();
        let legitimate = primary_registry
            .start(71, "legitimate", &legitimate_runner, None)
            .expect("legitimate registry start");
        let (_, legitimate_batch) = primary_registry
            .persistence_batch(71)
            .expect("legitimate registry authenticates its dirty snapshot");
        let verifier = primary_registry
            .persistence_verifier()
            .expect("legitimate registry verifier");
        let mut unregistered_database = snapback_kernel::storage::LocalDatabase::memory()
            .expect("unregistered persistence database");
        let unregistered_error = unregistered_database
            .settlement()
            .upsert_stream_attempts(&legitimate_batch, 0)
            .expect_err("raw kernel settlement access has no persistence authority");
        assert_eq!(
            unregistered_error.diagnostic.code,
            "SNAPBACK_ACTION_STREAM_PERSISTENCE_UNAUTHORIZED"
        );
        let database = snapback_kernel::storage::LocalDatabase::memory()
            .expect("authenticated persistence database");
        let mut storage =
            snapback_kernel::storage::ServingDatabase::adopt_with_stream_attempt_verifier(
                database, verifier,
            )
            .expect("register exact stream persistence issuer");

        let unsigned = StreamAttemptPersistenceBatch::from_authenticated_parts(
            legitimate_batch.rows().to_vec(),
            legitimate_batch.issuer().to_vec(),
            Vec::new(),
        );
        let unsigned_error = storage
            .settlement()
            .upsert_stream_attempts(&unsigned, 1)
            .expect_err("an unsigned registry snapshot is refused");
        assert_eq!(
            unsigned_error.diagnostic.code,
            "SNAPBACK_ACTION_STREAM_PERSISTENCE_UNAUTHORIZED"
        );

        let wrong_issuer = StreamAttemptPersistenceBatch::from_authenticated_parts(
            legitimate_batch.rows().to_vec(),
            vec![0; legitimate_batch.issuer().len()],
            legitimate_batch.authentication_tag().to_vec(),
        );
        let wrong_issuer_error = storage
            .settlement()
            .upsert_stream_attempts(&wrong_issuer, 1)
            .expect_err("a valid tag cannot be retagged with another issuer");
        assert_eq!(
            wrong_issuer_error.diagnostic.code,
            "SNAPBACK_ACTION_STREAM_PERSISTENCE_UNAUTHORIZED"
        );

        let mut altered_record: PersistedStreamAttempt =
            serde_json::from_str(&legitimate_batch.rows()[0].2)
                .expect("decode the legitimate authenticated record");
        altered_record.chunk_count = altered_record
            .chunk_count
            .checked_add(1)
            .expect("the fixture chunk count can advance");
        let (same_token, same_client_key, altered_record_json) = altered_record
            .to_row()
            .expect("serialize the record-json-only tamper");
        assert_eq!(same_token, legitimate_batch.rows()[0].0);
        assert_eq!(same_client_key, legitimate_batch.rows()[0].1);
        assert_ne!(altered_record_json, legitimate_batch.rows()[0].2);
        let record_json_tampered = StreamAttemptPersistenceBatch::from_authenticated_parts(
            vec![(same_token, same_client_key, altered_record_json)],
            legitimate_batch.issuer().to_vec(),
            legitimate_batch.authentication_tag().to_vec(),
        );
        let record_json_tampered_error = storage
            .settlement()
            .upsert_stream_attempts(&record_json_tampered, 1)
            .expect_err("changing only authenticated record JSON invalidates the batch");
        assert_eq!(
            record_json_tampered_error.diagnostic.code,
            "SNAPBACK_ACTION_STREAM_PERSISTENCE_UNAUTHORIZED"
        );

        let fabricated = PersistedStreamAttempt {
            token: "fabricated-terminal".to_owned(),
            client_key: "fabricated-terminal".to_owned(),
            runner_generation: 1,
            progress_commits: 0,
            cursors_opened: 0,
            cursors: BTreeMap::new(),
            terminal: Some(StreamAttemptTerminal {
                cause: StreamAttemptCause::Complete,
                effect_may_have_executed: false,
                settled_by: StreamAttemptSettledBy::Terminalizer,
            }),
            function_id: None,
            initiator: None,
            started_at_ms: 0,
            settled_at_ms: Some(1),
            emitted_bytes: 0,
            chunk_count: 0,
        };
        let tampered = StreamAttemptPersistenceBatch::from_authenticated_parts(
            vec![fabricated.to_row().expect("serialize fabricated row")],
            legitimate_batch.issuer().to_vec(),
            legitimate_batch.authentication_tag().to_vec(),
        );
        let tampered_error = storage
            .settlement()
            .upsert_stream_attempts(&tampered, 1)
            .expect_err("changing authenticated row bytes invalidates the batch");
        assert_eq!(
            tampered_error.diagnostic.code,
            "SNAPBACK_ACTION_STREAM_PERSISTENCE_UNAUTHORIZED"
        );

        let foreign_registry = registry();
        let foreign_runner = runner();
        foreign_registry
            .start(71, "foreign", &foreign_runner, None)
            .expect("foreign registry start");
        let (_, foreign_batch) = foreign_registry
            .persistence_batch(71)
            .expect("foreign registry authenticates its own snapshot");
        let foreign_error = storage
            .settlement()
            .upsert_stream_attempts(&foreign_batch, 2)
            .expect_err("a different registry cannot write this serving database");
        assert_eq!(
            foreign_error.diagnostic.code,
            "SNAPBACK_ACTION_STREAM_PERSISTENCE_UNAUTHORIZED"
        );

        storage
            .settlement()
            .upsert_stream_attempts(&legitimate_batch, 3)
            .expect("the registered registry batch persists");
        assert!(
            storage
                .settlement_read()
                .durable_stream_attempt_by_client_key("legitimate", ())
                .expect("read legitimate row")
                .is_some()
        );
        assert!(
            storage
                .settlement_read()
                .durable_stream_attempt_by_client_key("fabricated-terminal", ())
                .expect("check fabricated row absence")
                .is_none()
        );
        assert_eq!(legitimate.attempt_token.len(), 36);
    }

    #[test]
    fn registry_provider_settlement_method_classifies_complete_as_host_terminalizer() {
        let registry = registry();
        let caller = caller_origin(
            crate::auth::invocation::InvocationSource::HttpAction,
            session_authority(),
        );
        let provider_runner = runner();
        let provider_host = runner_host(&provider_runner);
        let provider = caller
            .stage_start(&registry, 51, "provider-only", &provider_runner, None)
            .expect("provider attempt");
        let terminal = registry
            .settle_provider_outcome_host(
                &provider_host,
                &provider.attempt_token,
                StreamAttemptCause::Complete,
            )
            .expect("provider completion");
        assert_eq!(terminal.cause, StreamAttemptCause::Complete);
        assert_eq!(terminal.settled_by, StreamAttemptSettledBy::Terminalizer);
        let classified = registry.transition_classifications_for_test();
        assert!(classified.contains(&("providerTerminal", "HostSettlement")));
        assert!(
            !classified
                .iter()
                .any(|(transition, _)| *transition == "authoredTerminal"),
            "provider completion must not enter the authored method: {classified:?}"
        );
    }

    #[test]
    fn prepared_runner_host_reuses_its_runner_commit_gate() {
        let abandoned = Arc::new(AtomicBool::new(false));
        let runner_host = prepared_authority(
            crate::auth::invocation::InvocationSource::LocalAction,
            AuthMode::Dev,
            ResolvedAppAuthority::Anonymous,
        )
        .stream_runner_host(abandoned.clone());
        let runner = runner_host.runner();
        let origin = runner_host.host_settlement();
        assert_eq!(runner.invocation_id, origin.runner.invocation_id);
        assert!(Arc::ptr_eq(&runner.commit_gate, &origin.runner.commit_gate));
        assert!(Arc::ptr_eq(&runner.finished, &origin.runner.finished));
        assert!(Arc::ptr_eq(&runner.commit_gate().abandoned, &abandoned));
    }

    #[test]
    fn runner_bound_host_transitions_reject_a_different_lease_runner() {
        let registry = registry();
        let holder_host = prepared_authority(
            crate::auth::invocation::InvocationSource::LocalAction,
            AuthMode::Dev,
            ResolvedAppAuthority::Anonymous,
        )
        .stream_runner_host(Arc::new(AtomicBool::new(false)));
        let holder = holder_host.runner();
        // Keep the opaque invocation id equal while changing both Arc-backed
        // lease identities. This reaches invocation-indexed methods such as
        // progress commit, but it is still not the exact runner that owns the
        // lease. An unrelated invocation id would return before exercising
        // those per-record fences.
        let other_runner = StreamRunnerIdentity {
            invocation_id: holder.invocation_id.clone(),
            commit_gate: Arc::new(InvocationCommitGate::new(Arc::new(AtomicBool::new(false)))),
            finished: Arc::new(AtomicBool::new(false)),
        };
        let other_host = runner_host(&other_runner);
        let started = registry
            .start_with_metadata(
                61,
                "runner-bound-cursor",
                holder,
                None,
                StreamAttemptMetadata {
                    function_id: Some("app:runner-bound".to_owned()),
                    initiator: Some(StreamInitiator::SessionUser("user-a".to_owned())),
                    started_at_ms: 1,
                },
            )
            .expect("holder starts attempt");
        registry
            .bind_cursor(&started.attempt_token, "runner-bound-cursor", holder)
            .expect("holder binds cursor");

        registry.record_transport_outcome_host(
            &other_host,
            "runner-bound-cursor",
            StreamInitiationState::DefinitelyNotInitiated,
        );
        registry.record_progress_commit_host(&other_host);
        let wrong_emit = registry
            .record_emit_counters_host(&other_host, &started.attempt_token, 1)
            .expect_err("another runner cannot reserve output counters");
        assert_eq!(wrong_emit.diagnostic.code, "SNAPBACK_STREAM_RUNNER_FENCED");
        registry.record_cursor_close_host(&other_host, "runner-bound-cursor");
        assert!(
            registry
                .settle_provider_outcome_host(
                    &other_host,
                    &started.attempt_token,
                    StreamAttemptCause::Complete,
                )
                .is_err(),
            "another runner cannot provider-settle the holder's attempt"
        );
        assert!(
            registry
                .terminalize_invocation_host(&other_host, StreamAttemptCause::Failed)
                .is_empty(),
            "another runner cannot terminalize the holder's invocation"
        );

        let after_other = registry
            .dirty_snapshots(61)
            .into_iter()
            .find(|snapshot| snapshot.token == started.attempt_token)
            .expect("attempt snapshot");
        let cursor = after_other
            .cursors
            .get("runner-bound-cursor")
            .expect("cursor snapshot");
        assert_eq!(
            cursor.initiation_state,
            StreamInitiationState::InitiationPossible
        );
        assert!(cursor.open, "another runner cannot close this cursor");
        assert_eq!(after_other.progress_commits, 0);
        assert_eq!(after_other.chunk_count, 0);
        assert_eq!(after_other.emitted_bytes, 0);
        assert_eq!(
            registry.transition_classifications_for_test(),
            vec![("freshStart", "ModeOnly"), ("cursorPremark", "ModeOnly"),],
            "a rejected runner must not record host transitions"
        );

        registry.record_transport_outcome_host(
            &holder_host,
            "runner-bound-cursor",
            StreamInitiationState::DefinitelyNotInitiated,
        );
        registry.record_cursor_close_host(&holder_host, "runner-bound-cursor");
        let after_holder = registry
            .dirty_snapshots(61)
            .into_iter()
            .find(|snapshot| snapshot.token == started.attempt_token)
            .expect("attempt snapshot after holder observations");
        let cursor = after_holder
            .cursors
            .get("runner-bound-cursor")
            .expect("cursor snapshot after holder observations");
        assert_eq!(
            cursor.initiation_state,
            StreamInitiationState::DefinitelyNotInitiated
        );
        assert!(!cursor.open);
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
        first.commit_gate.abandoned.store(true, Ordering::SeqCst);
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
        registry.close_cursor(&holder, "cursor-c");
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
        registry.cursor_initiation(
            &holder,
            "cursor-1",
            StreamInitiationState::DefinitelyNotInitiated,
        );
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
        registry.cursor_initiation(&holder, "cursor-2", StreamInitiationState::ResponseObserved);
        // response_observed is absorbing: a later narrowing attempt is a bug
        // and must not un-observe the response.
        registry.cursor_initiation(
            &holder,
            "cursor-2",
            StreamInitiationState::DefinitelyNotInitiated,
        );
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
