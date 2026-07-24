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
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use uuid::Uuid;

/// The five frozen terminal settlement kinds (LLP 0075
/// `requiredSettlementKinds`); the certainty axis is orthogonal, never a
/// sixth kind.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamAttemptCause {
    Complete,
    Failed,
    Cancelled,
    TimedOut,
    Ambiguous,
}

impl StreamAttemptCause {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "complete" => Some(Self::Complete),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            "timed_out" => Some(Self::TimedOut),
            "ambiguous" => Some(Self::Ambiguous),
            _ => None,
        }
    }
}

/// The crash-safe effect-certainty axis (LLP 0076 §Settlement and retry).
/// This module holds the process-live state machine; the durable write-ahead
/// pre-mark substrate is tracked by the initiation-state ticket.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamInitiationState {
    DefinitelyNotInitiated,
    InitiationPossible,
    ResponseObserved,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamAttemptSettledBy {
    Authored,
    Terminalizer,
}

/// The committed terminal fact. Once written it never changes; later settle
/// calls receive this exact record verbatim ("the durable winner is
/// authoritative").
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamAttemptTerminal {
    pub cause: StreamAttemptCause,
    /// True when any child cursor's `initiationState` is not
    /// `definitely_not_initiated` — the pessimistic parent fold of
    /// decision 3.
    pub effect_may_have_executed: bool,
    pub settled_by: StreamAttemptSettledBy,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamAttemptStart {
    pub attempt_token: String,
    pub runner_generation: u64,
    /// Whether THIS invocation holds the single-runner lease. A concurrent
    /// caller receives the same attempt without the lease and cannot commit
    /// progress or settle.
    pub lease_held: bool,
    pub progress_commits: u64,
    pub terminal: Option<StreamAttemptTerminal>,
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
    runner_generation: u64,
    holder: Option<RunnerHolder>,
    progress_commits: u64,
    cursors_opened: u64,
    cursors: BTreeMap<String, CursorRecord>,
    terminal: Option<StreamAttemptTerminal>,
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
}

#[derive(Default)]
struct RegistryInner {
    by_token: BTreeMap<String, AttemptRecord>,
    by_client_key: BTreeMap<(usize, String), String>,
    by_invocation: BTreeMap<String, BTreeSet<String>>,
    by_cursor: BTreeMap<String, String>,
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
    ) -> SnapbackResult<StreamAttemptStart> {
        if client_key.is_empty() || client_key.len() > 512 || client_key.contains(['\r', '\n']) {
            return Err(attempt_error(
                "attemptStart",
                "stream attempt client key must be a bounded single-line string",
                json!({ "expected": "a non-empty single-line key <= 512 bytes", "received": "invalid client key shape" }),
            ));
        }
        let mut inner = self.lock();
        let key = (namespace, client_key.to_owned());
        if let Some(token) = inner.by_client_key.get(&key).cloned() {
            let record = inner
                .by_token
                .get_mut(&token)
                .expect("client-key index points at a live attempt record");
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
            inner
                .by_invocation
                .entry(runner.invocation_id.clone())
                .or_default()
                .insert(token);
            return Ok(start);
        }
        let token = Uuid::new_v4().to_string();
        let record = AttemptRecord {
            token: token.clone(),
            runner_generation: 1,
            holder: Some(RunnerHolder {
                invocation_id: runner.invocation_id.clone(),
                abandoned: runner.abandoned.clone(),
                finished: runner.finished.clone(),
            }),
            progress_commits: 0,
            cursors_opened: 0,
            cursors: BTreeMap::new(),
            terminal: None,
        };
        inner.by_client_key.insert(key, token.clone());
        inner.by_token.insert(token.clone(), record);
        inner
            .by_invocation
            .entry(runner.invocation_id.clone())
            .or_default()
            .insert(token.clone());
        Ok(StreamAttemptStart {
            attempt_token: token,
            runner_generation: 1,
            lease_held: true,
            progress_commits: 0,
            terminal: None,
        })
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
        }
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
                    if record.open_cursor_count() > 0
                        && record.lease_held_by(&runner.invocation_id)
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
            }
        }
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
        for cursor in record.cursors.values_mut() {
            cursor.open = false;
        }
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
                for cursor in record.cursors.values_mut() {
                    cursor.open = false;
                }
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
        let started = registry.start(1, "client-key", &first).expect("start");
        assert!(started.lease_held);
        assert_eq!(started.runner_generation, 1);

        let joined = registry.start(1, "client-key", &second).expect("join");
        assert_eq!(joined.attempt_token, started.attempt_token);
        assert!(!joined.lease_held, "a live holder keeps the lease");
        assert_eq!(joined.runner_generation, 1);

        // The same invocation re-starting still holds its lease.
        let same = registry.start(1, "client-key", &first).expect("restart");
        assert!(same.lease_held);
    }

    #[test]
    fn lease_takeover_requires_a_dead_holder_and_bumps_runner_generation() {
        let registry = registry();
        let first = runner();
        let second = runner();
        let started = registry.start(7, "key", &first).expect("start");
        first.abandoned.store(true, Ordering::SeqCst);
        let taken = registry.start(7, "key", &second).expect("takeover");
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
        let started = registry.start(1, "cas", &holder).expect("start");
        registry
            .bind_cursor(&started.attempt_token, "cursor-1", &holder)
            .expect("bind");

        // Terminalizer races the authored settle and wins the CAS.
        let settled = registry.terminalize_invocation(&holder, StreamAttemptCause::TimedOut);
        assert_eq!(settled.len(), 1);
        let authored = registry
            .settle(&started.attempt_token, StreamAttemptCause::Complete, &holder)
            .expect("late authored settle receives the winner");
        assert_eq!(authored.cause, StreamAttemptCause::TimedOut);
        assert_eq!(authored.settled_by, StreamAttemptSettledBy::Terminalizer);
        assert!(
            authored.effect_may_have_executed,
            "a bound cursor is initiation_possible until proven otherwise"
        );
    }

    #[test]
    fn abandoned_invocation_terminalization_race_has_exactly_one_winner() {
        let registry = Arc::new(registry());
        let holder = runner();
        let started = registry.start(3, "race", &holder).expect("start");
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
        let started = registry.start(1, "retry", &holder).expect("start");
        registry
            .bind_cursor(&started.attempt_token, "cursor-a", &holder)
            .expect("first upstream open");
        registry.record_progress_commit(&holder);
        let refusal = registry
            .bind_cursor(&started.attempt_token, "cursor-b", &holder)
            .expect_err("reopen after durable progress must fail");
        assert_eq!(refusal.diagnostic.code, "SNAPBACK_ACTION_STREAM_INVALID");

        // Before any progress commit a reopen (idempotent retry) is legal.
        let fresh = registry.start(1, "retry-fresh", &holder).expect("start");
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
        let started = registry.start(1, "late", &holder).expect("start");
        registry
            .bind_cursor(&started.attempt_token, "cursor-late", &holder)
            .expect("bind");
        // A durable cancellation lands (authored settle) while bytes are in
        // flight; the cursor closes with the settle, so the guard passes
        // afterwards — the fence is the terminal row itself.
        registry
            .settle(&started.attempt_token, StreamAttemptCause::Cancelled, &holder)
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
        let started = registry.start(1, "fold", &holder).expect("start");
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

        let second = registry.start(1, "fold-2", &holder).expect("start");
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
}
