//! One absolute-deadline capsule around authority reservation, queued Local
//! acquisition, staging, the final admission cut, COMMIT, and exact
//! reconciliation.
//!
//! Durable watch management is the first production adopter. Production route
//! code receives only one already-bound destination and invokes one consuming
//! watch operation; every authority-bearing lifecycle state remains private.
//!
//! @ref LLP 0058#split-phase-authorized-effect-fence — caller authority is
//!   reserved outside Local and the mode guard is acquired only at COMMIT.
//! @ref LLP 0059#rollback-and-ambiguous-commit — production reconciliation
//!   queries compare complete intended rows and return a database-, operation-,
//!   and semantic-fingerprint-bound witness.
//! @ref LLP 0225#3-transaction-and-commit-boundaries--who-may-commit-what —
//!   the adapter owns orchestration while production adopters use a sealed,
//!   kernel-supplied pending transaction and an opaque closed commit origin.

#[cfg(test)]
use super::writer_gate::lock_managed_snapback_until;
use super::writer_gate::with_snapback_until;
use crate::admin::AppState;
use crate::auth::invocation::{
    AuthorizedEffectReservation, AuthorizedEffectReservationError, CallerAuthorityTerminalCause,
    PreparedAuthority,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::local::LocalSnapback;
#[cfg(test)]
use crate::remainder_adapter::RemainderLocalSnapbackExt as _;
use serde_json::{Map, Value, json};
use std::any::Any;
use std::collections::BTreeMap;
use std::marker::PhantomData;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::time::Instant;

pub(crate) const COMMIT_OUTCOME_UNCERTAIN_CODE: &str = "SNAPBACK_COMMIT_OUTCOME_UNCERTAIN";

const WATCH_MANAGEMENT_COMMIT_BUDGET: std::time::Duration = std::time::Duration::from_secs(5);

/// The process graph, admission graph, and opaque kernel commit origin travel
/// as one carrier. Only this module can inspect the origin; route modules can
/// neither extract it nor compose it with a pending transaction.
///
/// @ref LLP 0225#3-transaction-and-commit-boundaries--who-may-commit-what —
/// the adapter retains one origin-bound destination instead of composing
/// database and admission authority independently.
#[derive(Clone)]
pub(crate) struct CommitCapsuleRuntimeBinding {
    state: super::SharedSnapback,
    admission: crate::auth::admission::AuthAdmissionController,
    graph_identity: crate::local::EngineAppStateGraphIdentity,
    origin: crate::storage::CommitCapsuleOrigin,
}

impl CommitCapsuleRuntimeBinding {
    pub(crate) fn new(
        state: super::SharedSnapback,
        admission: crate::auth::admission::AuthAdmissionController,
        graph_identity: crate::local::EngineAppStateGraphIdentity,
        origin: crate::storage::CommitCapsuleOrigin,
    ) -> Self {
        Self {
            state,
            admission,
            graph_identity,
            origin,
        }
    }

    fn state(&self) -> &super::SharedSnapback {
        &self.state
    }

    pub(crate) fn admission(&self) -> &crate::auth::admission::AuthAdmissionController {
        &self.admission
    }

    fn origin(&self) -> &crate::storage::CommitCapsuleOrigin {
        &self.origin
    }

    fn matches_local(&self, local: &crate::local::LocalSnapback) -> bool {
        self.graph_identity.matches_local(local)
    }
}

#[cfg(test)]
struct WatchCapsuleProbeInner {
    expected_guard: crate::storage::AdmissionEffectGuardIdentityForTest,
    budget: std::time::Duration,
    scope: crate::auth::invocation::AuthorizedEffectScopeProbeForTest,
    reservation_identity: std::sync::atomic::AtomicU64,
    invocations: std::sync::atomic::AtomicUsize,
    events: Mutex<Vec<&'static str>>,
    receipt: Mutex<Option<crate::storage::DurableCommitObservationReceiptForTest>>,
}

#[cfg(test)]
#[derive(Clone)]
pub(crate) struct WatchCapsuleProbeForTest(Arc<WatchCapsuleProbeInner>);

#[cfg(test)]
static WATCH_CAPSULE_PROBES_FOR_TEST: OnceLock<Mutex<BTreeMap<String, WatchCapsuleProbeForTest>>> =
    OnceLock::new();

#[cfg(test)]
pub(crate) fn install_watch_capsule_probe_for_test(
    operation_identity: impl Into<String>,
    expected_guard: crate::storage::AdmissionEffectGuardIdentityForTest,
    budget: std::time::Duration,
) -> WatchCapsuleProbeForTest {
    let operation_identity = operation_identity.into();
    let probe = WatchCapsuleProbeForTest(Arc::new(WatchCapsuleProbeInner {
        expected_guard,
        budget,
        scope: crate::auth::invocation::AuthorizedEffectScopeProbeForTest::new(format!(
            "origin-bound:{operation_identity}"
        )),
        reservation_identity: std::sync::atomic::AtomicU64::new(0),
        invocations: std::sync::atomic::AtomicUsize::new(0),
        events: Mutex::new(Vec::new()),
        receipt: Mutex::new(None),
    }));
    let replaced = WATCH_CAPSULE_PROBES_FOR_TEST
        .get_or_init(|| Mutex::new(BTreeMap::new()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(operation_identity, probe.clone());
    assert!(replaced.is_none(), "watch capsule probe identity reused");
    probe
}

#[cfg(test)]
fn take_watch_capsule_probe_for_test(operation_identity: &str) -> Option<WatchCapsuleProbeForTest> {
    let probe = WATCH_CAPSULE_PROBES_FOR_TEST
        .get_or_init(|| Mutex::new(BTreeMap::new()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(operation_identity);
    if let Some(probe) = &probe {
        probe
            .0
            .invocations
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
    probe
}

#[cfg(test)]
impl WatchCapsuleProbeForTest {
    fn record(&self, event: &'static str) {
        self.0
            .events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(event);
    }

    pub(crate) fn events(&self) -> Vec<&'static str> {
        self.0
            .events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub(crate) fn invocations(&self) -> usize {
        self.0.invocations.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub(crate) fn reservation_identity(&self) -> u64 {
        self.0
            .reservation_identity
            .load(std::sync::atomic::Ordering::SeqCst)
    }

    pub(crate) fn scope(&self) -> &crate::auth::invocation::AuthorizedEffectScopeProbeForTest {
        &self.0.scope
    }

    pub(crate) fn receipt(&self) -> Option<crate::storage::DurableCommitObservationReceiptForTest> {
        self.0
            .receipt
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

#[derive(Clone, Debug)]
#[cfg(test)]
pub(crate) struct CommitCapsuleSpec {
    pub operation: &'static str,
    pub deadline: Instant,
    pub uncertain_diagnostic: &'static str,
    #[cfg(test)]
    pub test_pause_id: Option<String>,
}

#[derive(Debug)]
#[cfg(test)]
enum CommitAttemptState<T> {
    Committed(T),
    RolledBack(SnapbackError),
    CommitUncertain { cause: SnapbackError },
}

#[derive(Debug)]
#[cfg(test)]
pub(crate) struct CommitAttempt<T>(CommitAttemptState<T>);

#[cfg(test)]
impl<T> CommitAttempt<T> {
    pub(crate) fn rolled_back(error: SnapbackError) -> Self {
        Self(CommitAttemptState::RolledBack(error))
    }

    pub(crate) fn map_committed<U>(self, map: impl FnOnce(T) -> U) -> CommitAttempt<U> {
        CommitAttempt(match self.0 {
            CommitAttemptState::Committed(value) => CommitAttemptState::Committed(map(value)),
            CommitAttemptState::RolledBack(error) => CommitAttemptState::RolledBack(error),
            CommitAttemptState::CommitUncertain { cause } => {
                CommitAttemptState::CommitUncertain { cause }
            }
        })
    }
}

pub(crate) struct CommitCapsuleDestination {
    authority: PreparedAuthority,
    runtime: CommitCapsuleRuntimeBinding,
}

impl CommitCapsuleDestination {
    pub(crate) fn bind(runtime: &AppState, authority: PreparedAuthority) -> SnapbackResult<Self> {
        let runtime = runtime.commit_capsule_runtime.clone();
        if !runtime.admission().owns_lease(authority.admission_lease()) {
            return Err(SnapbackError::error(
                "SNAPBACK_COMMIT_CAPSULE_DESTINATION_MISMATCH",
                "server",
                "the prepared authority does not belong to the destination AppState",
            ));
        }
        Ok(Self { authority, runtime })
    }

    /// Consume one bound origin and one inert watch request. No authority-
    /// bearing phase, callback, deadline, guard, or reconciliation capability
    /// crosses this adopter boundary.
    pub(crate) async fn execute_watch_management(
        self,
        intent: crate::storage::watches::WatchManagementIntent,
        #[cfg(test)] test_pause_id: Option<String>,
    ) -> CommitCapsuleOutcome<crate::storage::watches::WatchManagementCommit> {
        let operation_identity = intent.operation_identity().as_ref().to_owned();
        let request = WatchManagementRequest {
            intent,
            #[cfg(test)]
            test_pause_id,
            #[cfg(test)]
            test_probe: take_watch_capsule_probe_for_test(&operation_identity),
        };
        let (retention, recovery) = match CommitUncertainRetention::new(&operation_identity) {
            Ok(pair) => pair,
            Err(error) => return CommitCapsuleOutcome::Rejected(error),
        };
        Bound::new(self, request, retention, recovery)
            .reserve()
            .await
            .outcome
    }
}

/// Request data for the first sealed kernel operation. Its policy metadata is
/// derived here, not selected by the route.
struct WatchManagementRequest {
    intent: crate::storage::watches::WatchManagementIntent,
    #[cfg(test)]
    test_pause_id: Option<String>,
    #[cfg(test)]
    test_probe: Option<WatchCapsuleProbeForTest>,
}

impl WatchManagementRequest {
    fn operation(&self) -> &'static str {
        match &self.intent {
            crate::storage::watches::WatchManagementIntent::Transition { target, .. } => {
                match target {
                    crate::watches::WatchStatus::Dead => "watch delete",
                    crate::watches::WatchStatus::Suspended => "watch suspend",
                    crate::watches::WatchStatus::Active => "watch resume",
                }
            }
            crate::storage::watches::WatchManagementIntent::Renewal { .. } => "watchAnchor renewal",
        }
    }
}

#[derive(Clone)]
enum CommitTerminalCause {
    Caller(CallerAuthorityTerminalCause),
}

#[derive(Clone, Default)]
struct CommitTerminalLatch(Arc<OnceLock<CommitTerminalCause>>);

impl CommitTerminalLatch {
    fn latch_caller(&self, cause: CallerAuthorityTerminalCause) -> CallerAuthorityTerminalCause {
        let proposed = CommitTerminalCause::Caller(cause);
        let _ = self.0.set(proposed);
        match self
            .0
            .get()
            .expect("the terminal latch contains the proposed or earlier cause")
        {
            CommitTerminalCause::Caller(cause) => cause.clone(),
        }
    }
}

// All authority-bearing phases are intentionally module-private. Each
// transition consumes its predecessor; only Finished can cross back out.
struct Bound {
    destination: CommitCapsuleDestination,
    request: WatchManagementRequest,
    deadline: Instant,
    terminal: CommitTerminalLatch,
    retention: CommitUncertainRetention<crate::storage::watches::WatchManagementIntendedRows>,
    recovery: CommitUncertainRetentionHandle<crate::storage::watches::WatchManagementIntendedRows>,
}

impl Bound {
    fn new(
        destination: CommitCapsuleDestination,
        request: WatchManagementRequest,
        retention: CommitUncertainRetention<crate::storage::watches::WatchManagementIntendedRows>,
        recovery: CommitUncertainRetentionHandle<
            crate::storage::watches::WatchManagementIntendedRows,
        >,
    ) -> Self {
        #[cfg(test)]
        let budget = request
            .test_probe
            .as_ref()
            .map_or(WATCH_MANAGEMENT_COMMIT_BUDGET, |probe| probe.0.budget);
        #[cfg(not(test))]
        let budget = WATCH_MANAGEMENT_COMMIT_BUDGET;
        Self {
            destination,
            request,
            deadline: Instant::now() + budget,
            terminal: CommitTerminalLatch::default(),
            retention,
            recovery,
        }
    }

    async fn reserve(self) -> Finished<crate::storage::watches::WatchManagementCommit> {
        let Bound {
            destination,
            request,
            deadline,
            terminal,
            retention,
            recovery,
        } = self;
        if Instant::now() >= deadline {
            return Finished::timed_out(CommitTimeoutPhase::WriterAcquire);
        }
        #[cfg(test)]
        if let Some(probe) = &request.test_probe {
            assert!(
                !crate::exec_guard::local_snapback_write_scope_active_for_test(),
                "origin-bound reservation entered Local"
            );
            probe.record("before-reservation");
        }
        #[cfg(test)]
        super::pause_test_finite_authority_request(
            request.test_pause_id.as_deref(),
            super::TestFiniteAuthorityPausePoint::BeforeAuthorizedEffectReservation,
            None,
        )
        .await;
        if Instant::now() >= deadline {
            return Finished::timed_out(CommitTimeoutPhase::WriterAcquire);
        }
        let CommitCapsuleDestination { authority, runtime } = destination;
        let operation = request.operation();
        let effect = match authority.reserve_authorized_effect_classified(operation) {
            Ok(effect) => effect,
            Err(AuthorizedEffectReservationError::Terminal(cause)) => {
                return Finished::caller_terminal(terminal.latch_caller(cause));
            }
            Err(AuthorizedEffectReservationError::NonTerminal(error)) => {
                return Finished::rejected(error);
            }
        };
        #[cfg(test)]
        let effect = if let Some(probe) = &request.test_probe {
            assert!(
                !crate::exec_guard::local_snapback_write_scope_active_for_test(),
                "the exact origin-bound reservation ran inside Local"
            );
            let identity = effect.identity_for_test();
            probe
                .0
                .reservation_identity
                .store(identity, std::sync::atomic::Ordering::SeqCst);
            probe.record("reserved");
            effect.with_scope_probe_for_test(probe.0.scope.clone())
        } else {
            effect
        };
        let reserved = Reserved {
            runtime,
            request,
            deadline,
            terminal,
            reservation: CommitCapsuleReservation { authority, effect },
            retention,
            recovery,
        };
        #[cfg(test)]
        super::pause_test_finite_authority_request(
            reserved.request.test_pause_id.as_deref(),
            super::TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
            None,
        )
        .await;
        reserved.acquire_worker().await
    }
}

struct Reserved {
    runtime: CommitCapsuleRuntimeBinding,
    request: WatchManagementRequest,
    deadline: Instant,
    terminal: CommitTerminalLatch,
    reservation: CommitCapsuleReservation,
    retention: CommitUncertainRetention<crate::storage::watches::WatchManagementIntendedRows>,
    recovery: CommitUncertainRetentionHandle<crate::storage::watches::WatchManagementIntendedRows>,
}

impl Reserved {
    async fn acquire_worker(self) -> Finished<crate::storage::watches::WatchManagementCommit> {
        let state = self.runtime.state().clone();
        let deadline = self.deadline;
        with_snapback_until(&state, deadline.into_std(), move |local| {
            WorkerOwned::claim(self, local).finish()
        })
        .await
        .unwrap_or_else(|| Finished::timed_out(CommitTimeoutPhase::WriterAcquire))
    }
}

struct WorkerOwned<'local> {
    local: &'local mut LocalSnapback,
    runtime: CommitCapsuleRuntimeBinding,
    request: WatchManagementRequest,
    deadline: Instant,
    terminal: CommitTerminalLatch,
    reservation: CommitCapsuleReservation,
    retention: CommitUncertainRetention<crate::storage::watches::WatchManagementIntendedRows>,
    recovery: CommitUncertainRetentionHandle<crate::storage::watches::WatchManagementIntendedRows>,
}

impl<'local> WorkerOwned<'local> {
    fn claim(reserved: Reserved, local: &'local mut LocalSnapback) -> Self {
        let Reserved {
            runtime,
            request,
            deadline,
            terminal,
            reservation,
            retention,
            recovery,
        } = reserved;
        #[cfg(test)]
        if let Some(probe) = &request.test_probe {
            probe.record("worker-claimed");
        }
        Self {
            local,
            runtime,
            request,
            deadline,
            terminal,
            reservation,
            retention,
            recovery,
        }
    }

    fn finish(self) -> Finished<crate::storage::watches::WatchManagementCommit> {
        let WorkerOwned {
            local,
            runtime,
            request,
            deadline,
            terminal,
            reservation,
            mut retention,
            recovery,
        } = self;
        if !runtime.matches_local(local) {
            drop(reservation);
            return Finished::rejected(SnapbackError::error(
                "SNAPBACK_COMMIT_CAPSULE_DESTINATION_MISMATCH",
                "server",
                "the managed worker no longer owns the bound AppState graph",
            ));
        }
        #[cfg(test)]
        let observation = request.test_probe.as_ref().map(|probe| {
            let observation = crate::storage::observe_next_authorized_durable_commits_for_test(
                1,
                probe.0.expected_guard,
                probe.reservation_identity(),
            );
            *probe
                .0
                .receipt
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(observation.receipt());
            observation
        });
        let pending = match local.stage_watch_management(
            reservation.authority_view(),
            &request.intent,
            super::now_millis(),
        ) {
            Ok(pending) => pending,
            Err(error) => {
                drop(reservation);
                return Finished::rolled_back(error);
            }
        };
        #[cfg(test)]
        if let Some(probe) = &request.test_probe {
            probe.record("staged");
        }
        if Instant::now() >= deadline {
            let rollback = pending.rollback();
            drop(reservation);
            return match rollback {
                Ok(()) => Finished::timed_out(CommitTimeoutPhase::FinalCut),
                Err(error) => Finished::rolled_back(error),
            };
        }
        let guard = match reservation
            .effect()
            .commit_guard_classified(request.operation())
        {
            Ok(guard) => guard,
            Err(AuthorizedEffectReservationError::Terminal(cause)) => {
                let rollback = pending.rollback();
                return match rollback {
                    Ok(()) => Finished::caller_terminal(terminal.latch_caller(cause)),
                    Err(error) => Finished::rolled_back(error),
                };
            }
            Err(AuthorizedEffectReservationError::NonTerminal(error)) => {
                let rollback = pending.rollback();
                return match rollback {
                    Ok(()) => Finished::rejected(error),
                    Err(rollback_error) => Finished::rolled_back(rollback_error),
                };
            }
        };
        #[cfg(test)]
        if let Some(probe) = &request.test_probe {
            probe.record("guarded");
        }
        let guarded = Guarded {
            pending,
            guard,
            origin: runtime.origin(),
            retention: &mut retention,
            #[cfg(test)]
            probe: request.test_probe.as_ref(),
            #[cfg(test)]
            operation: request.operation(),
        };
        let attempt = guarded.finish();
        #[cfg(test)]
        drop(observation);
        // Guarded::finish has already dropped the non-reentrant mode guard.
        // The reservation is then released before observation, reconciliation,
        // after-Local work, or response construction can begin.
        drop(reservation);
        #[cfg(test)]
        if let Some(probe) = &request.test_probe {
            assert!(probe.0.scope.is_inactive());
            probe.record("reservation-released");
        }
        match attempt {
            GuardedAttempt::Committed(committed) => {
                local.observe_watch_management_commit(&committed);
                Finished::committed(committed, false)
            }
            GuardedAttempt::CommitUncertain { intended, cause } => {
                match local.reconcile_watch_management(&intended) {
                    Ok(Some(witness)) => match runtime
                        .origin()
                        .accept_watch_management_reconciliation(witness, &intended)
                    {
                        Ok(committed) => {
                            local.observe_watch_management_commit(&committed);
                            Finished::committed(committed, true)
                        }
                        Err(error) => {
                            retention.retain(intended);
                            Finished::uncertain_and_report(error, recovery)
                        }
                    },
                    Ok(None) => {
                        retention.retain(intended);
                        Finished::uncertain_and_report(
                            commit_uncertain(
                                COMMIT_OUTCOME_UNCERTAIN_CODE,
                                SnapbackError::error(
                                    "SNAPBACK_COMMIT_INTENDED_ROWS_ABSENT",
                                    "storage",
                                    "the exact intended successor rows were absent or partial",
                                ),
                            ),
                            recovery,
                        )
                    }
                    Err(error) => {
                        retention.retain(intended);
                        Finished::uncertain_and_report(
                            commit_uncertain(COMMIT_OUTCOME_UNCERTAIN_CODE, error),
                            recovery,
                        )
                    }
                }
                .with_commit_cause(cause)
            }
        }
    }
}

struct Guarded<'guard, 'connection> {
    pending: crate::storage::watches::WatchManagementPending<'connection>,
    guard: crate::auth::invocation::AuthorizedEffectCommitGuard<'guard>,
    origin: &'guard crate::storage::CommitCapsuleOrigin,
    retention:
        &'guard mut CommitUncertainRetention<crate::storage::watches::WatchManagementIntendedRows>,
    #[cfg(test)]
    probe: Option<&'guard WatchCapsuleProbeForTest>,
    #[cfg(test)]
    operation: &'static str,
}

enum GuardedAttempt<T, I> {
    Committed(T),
    CommitUncertain { intended: I, cause: SnapbackError },
}

impl Guarded<'_, '_> {
    fn finish(
        self,
    ) -> GuardedAttempt<
        crate::storage::watches::WatchManagementCommit,
        crate::storage::watches::WatchManagementIntendedRows,
    > {
        let Guarded {
            pending,
            guard,
            origin,
            retention,
            #[cfg(test)]
            probe,
            #[cfg(test)]
            operation,
        } = self;
        let intended = pending.intended_rows().clone();
        let result = catch_unwind(AssertUnwindSafe(|| origin.commit_watch_management(pending)));
        #[cfg(test)]
        if let Some(probe) = probe {
            assert!(probe.0.scope.is_active_for(operation));
            probe.record("commit-returned");
        }
        drop(guard);
        #[cfg(test)]
        if let Some(probe) = probe {
            assert!(probe.0.scope.is_reservation_held());
            assert!(!probe.0.scope.is_active_for(operation));
            probe.record("guard-released");
        }
        match result {
            Ok(Ok(committed)) => GuardedAttempt::Committed(committed),
            Ok(Err(cause)) => GuardedAttempt::CommitUncertain { intended, cause },
            Err(payload) => {
                retention.retain(intended);
                std::panic::resume_unwind(payload)
            }
        }
    }
}

struct Finished<T> {
    outcome: CommitCapsuleOutcome<T>,
}

impl<T> Finished<T> {
    fn committed(value: T, reconciled: bool) -> Self {
        Self {
            outcome: CommitCapsuleOutcome::Committed { value, reconciled },
        }
    }

    fn caller_terminal(cause: CallerAuthorityTerminalCause) -> Self {
        Self {
            outcome: CommitCapsuleOutcome::CallerTerminal(cause),
        }
    }

    fn rejected(error: SnapbackError) -> Self {
        Self {
            outcome: CommitCapsuleOutcome::Rejected(with_refusal_facts(error)),
        }
    }

    fn timed_out(phase: CommitTimeoutPhase) -> Self {
        Self {
            outcome: CommitCapsuleOutcome::TimedOut { phase },
        }
    }

    fn rolled_back(error: SnapbackError) -> Self {
        Self {
            outcome: CommitCapsuleOutcome::RolledBack(with_effect_false(error)),
        }
    }

    fn uncertain_and_report(
        error: SnapbackError,
        recovery: CommitUncertainRetentionHandle<
            crate::storage::watches::WatchManagementIntendedRows,
        >,
    ) -> Self {
        let retained = recovery.snapshot();
        eprintln!(
            "{}",
            json!({
                "kind": "watch_management_commit_unresolved",
                "code": COMMIT_OUTCOME_UNCERTAIN_CODE,
                "operationIdentity": retained
                    .as_ref()
                    .map(|snapshot| snapshot.operation_identity.as_str()),
                "retentionId": retained
                    .as_ref()
                    .map(|snapshot| format!("{:?}", snapshot.id)),
                "retentionState": retained
                    .as_ref()
                    .map(|snapshot| format!("{:?}", snapshot.state)),
            })
        );
        Self {
            outcome: CommitCapsuleOutcome::Uncertain(error),
        }
    }

    fn with_commit_cause(mut self, cause: SnapbackError) -> Self {
        if let CommitCapsuleOutcome::Uncertain(error) = &mut self.outcome {
            object_details(error)
                .entry("commitCauseCode".to_owned())
                .or_insert(Value::String(cause.diagnostic.code));
        }
        self
    }
}

/// The capsule-private pairing of one prepared authority and the exact effect
/// reservation it minted. Transaction closures may borrow the authority view
/// only through this carrier; callers cannot supply a second staging identity.
pub(crate) struct CommitCapsuleReservation {
    authority: PreparedAuthority,
    effect: AuthorizedEffectReservation,
}

impl CommitCapsuleReservation {
    #[cfg(test)]
    fn reserve(authority: PreparedAuthority, operation: &'static str) -> SnapbackResult<Self> {
        let effect = authority.reserve_authorized_effect(operation)?;
        Ok(Self { authority, effect })
    }

    fn authority_view(&self) -> &PreparedAuthority {
        &self.authority
    }

    fn effect(&self) -> &AuthorizedEffectReservation {
        &self.effect
    }

    #[cfg(test)]
    pub(crate) fn set_commit_guard_failure_for_test(&self, error: SnapbackError) {
        self.effect.set_commit_guard_failure_for_test(error);
    }
}

#[derive(Debug)]
pub(crate) enum CommitCapsuleOutcome<T> {
    Committed {
        value: T,
        reconciled: bool,
    },
    CallerTerminal(CallerAuthorityTerminalCause),
    Rejected(SnapbackError),
    #[cfg(test)]
    Refused(SnapbackError),
    TimedOut {
        phase: CommitTimeoutPhase,
    },
    RolledBack(SnapbackError),
    Uncertain(SnapbackError),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CommitTimeoutPhase {
    WriterAcquire,
    FinalCut,
}

impl CommitTimeoutPhase {
    pub(crate) fn diagnostic(self) -> SnapbackError {
        let (code, phase, message) = match self {
            Self::WriterAcquire => (
                "SNAPBACK_WRITER_ACQUIRE_TIMEOUT",
                "writerAcquire",
                "the bounded commit capsule expired while waiting for the managed writer",
            ),
            Self::FinalCut => (
                "SNAPBACK_COMMIT_DEADLINE_EXCEEDED",
                "finalCut",
                "the bounded commit capsule expired before COMMIT began",
            ),
        };
        SnapbackError::error(code, "server", message).with_details(json!({
            "capsuleOutcome": "timedOut",
            "phase": phase,
            "retryable": true,
            "retryStrategy": "short-jitter",
            "effectCommitted": false,
            "effectMayHaveCommitted": false,
        }))
    }
}

/// Adapter contract expected of the capsule's production pending
/// transactions. `prepare_commit` should only move/mark an already-prepared
/// uncertainty carrier; `commit` should not validate admission or enter Local
/// again.
///
/// This is an open `pub(crate)` trait, not a seal. Another implementation can
/// ignore the supplied authority, return a successful value without a durable
/// write, or commit a captured pending transaction for another database. Such
/// an implementation would violate the contract without being rejected by the
/// type system; see `issues/20260822-capsule-structural-residuals.md`.
#[cfg(test)]
pub(crate) trait PendingCommit: Sized {
    type Output;
    type Uncertain: Send + 'static;

    fn rollback(self) -> SnapbackResult<()>;

    /// Mark the operation ambiguous before SQLite COMMIT can panic or error.
    fn prepare_commit(&mut self) -> Self::Uncertain;

    /// COMMIT the already-staged transaction. A known-success adapter must
    /// settle any terminal carrier it shares with `prepare_commit`; the
    /// capsule alone owns the ambiguity carrier across this call.
    fn commit(self, origin: &crate::storage::CommitCapsuleOrigin) -> SnapbackResult<Self::Output>;
}

/// The Local capability passed as a capsule closure parameter. This type does
/// not implement `Deref` and does not itself expose `LocalSnapback`, so the
/// parameter no longer hands legacy autocommitting operations to the closure.
/// Rust closures can still capture authorities exposed elsewhere, and the
/// public staging/commit pair remains reachable without `FinalCommitCut`; this
/// parameter narrowing is therefore not a structural commit seal.
///
/// @ref LLP 0225#3-transaction-and-commit-boundaries--who-may-commit-what —
/// capsule callers are expected to compose typed kernel staging operations;
/// the remaining capture path is tracked as a structural residual.
#[cfg(test)]
pub(crate) struct CommitCapsuleTransaction<'local> {
    local: &'local mut LocalSnapback,
}

#[cfg(test)]
impl CommitCapsuleTransaction<'_> {
    fn new(local: &mut LocalSnapback) -> CommitCapsuleTransaction<'_> {
        CommitCapsuleTransaction { local }
    }

    pub(crate) fn stage_watch_management<'connection>(
        &'connection mut self,
        reservation: &CommitCapsuleReservation,
        intent: &crate::storage::watches::WatchManagementIntent,
        now_ms: u64,
    ) -> SnapbackResult<crate::storage::watches::WatchManagementPending<'connection>> {
        self.local
            .stage_watch_management(reservation.authority_view(), intent, now_ms)
    }

    pub(crate) fn reconcile_watch_management(
        &mut self,
        intended: &crate::storage::watches::WatchManagementIntendedRows,
    ) -> SnapbackResult<
        Option<
            crate::storage::ExactCommitRows<
                crate::storage::watches::WatchManagementIntendedRows,
                crate::storage::watches::WatchManagementCommit,
            >,
        >,
    > {
        self.local.reconcile_watch_management(intended)
    }

    pub(crate) fn observe_watch_management_commit(
        &self,
        committed: &crate::storage::watches::WatchManagementCommit,
    ) {
        self.local.observe_watch_management_commit(committed);
    }

    #[cfg(test)]
    pub(crate) fn stage_prototype<'connection>(
        &'connection mut self,
        intent: &crate::storage::commit_capsule_prototype::PrototypeIntent,
        include_consumed_proof: bool,
    ) -> SnapbackResult<crate::storage::commit_capsule_prototype::PrototypeStage<'connection>> {
        self.local
            .remainder_stage_commit_capsule_prototype(intent, include_consumed_proof)
    }

    #[cfg(test)]
    pub(crate) fn reconcile_prototype(
        &mut self,
        intent: &crate::storage::commit_capsule_prototype::PrototypeIntent,
    ) -> SnapbackResult<
        Option<
            crate::storage::ExactCommitRows<
                crate::storage::commit_capsule_prototype::PrototypeIntent,
                crate::storage::commit_capsule_prototype::PrototypeValue,
            >,
        >,
    > {
        self.local
            .remainder_reconcile_commit_capsule_prototype(intent)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[cfg(test)]
enum FinalCutDisposition {
    TimedOut,
    Refused,
    ExactExisting,
    CommitStarted,
}

pub(crate) const MAX_COMMIT_UNCERTAIN_RETENTIONS: usize = 1_024;

static NEXT_COMMIT_UNCERTAIN_RETENTION_ID: AtomicU64 = AtomicU64::new(1);
static COMMIT_UNCERTAIN_RETENTION_REGISTRY: OnceLock<Mutex<CommitUncertainRetentionRegistry>> =
    OnceLock::new();

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct CommitUncertainRetentionId(u64);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CommitUncertainRetentionState {
    Reserved,
    Retaining,
    Recoverable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CommitUncertainRetentionSnapshot {
    pub id: CommitUncertainRetentionId,
    pub operation_identity: String,
    pub state: CommitUncertainRetentionState,
}

struct CommitUncertainRetentionSlot<U> {
    carrier: Mutex<Option<U>>,
}

struct CommitUncertainRetentionEntry {
    operation_identity: String,
    state: CommitUncertainRetentionState,
    slot: Arc<dyn Any + Send + Sync>,
}

#[derive(Default)]
struct CommitUncertainRetentionRegistry {
    entries: BTreeMap<CommitUncertainRetentionId, CommitUncertainRetentionEntry>,
}

fn commit_uncertain_retention_registry() -> &'static Mutex<CommitUncertainRetentionRegistry> {
    COMMIT_UNCERTAIN_RETENTION_REGISTRY
        .get_or_init(|| Mutex::new(CommitUncertainRetentionRegistry::default()))
}

/// Identity-only inspection and recovery authority for one retained ambiguity.
///
/// This handle owns no storage. The process registry is the independent owner,
/// and exact removal is refused until the capsule has left its retain step.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CommitUncertainRetentionHandle<U> {
    id: CommitUncertainRetentionId,
    marker: PhantomData<fn() -> U>,
}

impl<U: Send + 'static> CommitUncertainRetentionHandle<U> {
    pub(crate) fn id(&self) -> CommitUncertainRetentionId {
        self.id
    }

    pub(crate) fn snapshot(&self) -> Option<CommitUncertainRetentionSnapshot> {
        let registry = commit_uncertain_retention_registry()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        registry
            .entries
            .get(&self.id)
            .map(|entry| CommitUncertainRetentionSnapshot {
                id: self.id,
                operation_identity: entry.operation_identity.clone(),
                state: entry.state,
            })
    }

    /// Enumerate every process-owned slot for one stable operation identity.
    ///
    /// More than one exact retention id may exist when overlapping attempts
    /// carry the same logical operation identity, so recovery must inspect
    /// every returned snapshot rather than assuming identity uniqueness.
    pub(crate) fn snapshots_by_operation_identity(
        operation_identity: &str,
    ) -> Vec<CommitUncertainRetentionSnapshot> {
        let registry = commit_uncertain_retention_registry()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        registry
            .entries
            .iter()
            .filter(|(_, entry)| entry.operation_identity == operation_identity)
            .map(|(id, entry)| CommitUncertainRetentionSnapshot {
                id: *id,
                operation_identity: entry.operation_identity.clone(),
                state: entry.state,
            })
            .collect()
    }

    /// Rediscover typed recovery authority from the stable operation identity
    /// and one exact id returned by `snapshots_by_operation_identity`.
    pub(crate) fn lookup_by_operation_identity(
        operation_identity: &str,
        id: CommitUncertainRetentionId,
    ) -> SnapbackResult<Self> {
        let registry = commit_uncertain_retention_registry()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(entry) = registry.entries.get(&id) else {
            return Err(retention_not_found());
        };
        if entry.operation_identity != operation_identity {
            return Err(retention_identity_mismatch());
        }
        if Arc::downcast::<CommitUncertainRetentionSlot<U>>(Arc::clone(&entry.slot)).is_err() {
            return Err(SnapbackError::error(
                "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_TYPE_MISMATCH",
                "server",
                "the commit-uncertain retention carrier type does not match its recovery owner",
            ));
        }
        Ok(Self {
            id,
            marker: PhantomData,
        })
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.snapshot()
            .is_none_or(|snapshot| snapshot.state == CommitUncertainRetentionState::Reserved)
    }

    /// Remove one exact carrier only after its capsule has stopped using it.
    /// The operation-specific recovery owner must first prove the durable
    /// predecessor or successor and then settle the returned carrier.
    pub(crate) fn remove_after_recovery(&self, operation_identity: &str) -> SnapbackResult<U> {
        let mut registry = commit_uncertain_retention_registry()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(entry) = registry.entries.get(&self.id) else {
            return Err(retention_not_found());
        };
        if entry.operation_identity != operation_identity {
            return Err(retention_identity_mismatch());
        }
        if entry.state != CommitUncertainRetentionState::Recoverable {
            return Err(SnapbackError::error(
                "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_ACTIVE",
                "server",
                "commit-uncertain retention cannot be removed while its capsule is active",
            ));
        }
        let slot = Arc::downcast::<CommitUncertainRetentionSlot<U>>(Arc::clone(&entry.slot))
            .map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_TYPE_MISMATCH",
                    "server",
                    "the commit-uncertain retention carrier type does not match its recovery owner",
                )
            })?;
        let carrier = slot
            .carrier
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
            .expect("a recoverable commit-uncertain entry owns its carrier");
        registry.entries.remove(&self.id);
        Ok(carrier)
    }
}

fn retention_not_found() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_NOT_FOUND",
        "server",
        "the exact commit-uncertain retention identity is not present",
    )
}

fn retention_identity_mismatch() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_IDENTITY_MISMATCH",
        "server",
        "the commit-uncertain retention does not match the recovery operation identity",
    )
}

/// Capsule-owned write authority for one bounded commit-uncertain slot.
///
/// Construction reserves one of the process-wide bounded slots and registers
/// an independent owner before the capsule can reach COMMIT. Callers receive
/// only an identity-based inspection/recovery handle, never mutable storage.
pub(crate) struct CommitUncertainRetention<U> {
    id: CommitUncertainRetentionId,
    slot: Arc<CommitUncertainRetentionSlot<U>>,
    #[cfg(test)]
    after_store_for_test: Option<Box<dyn FnOnce() + Send>>,
}

impl<U: Send + 'static> CommitUncertainRetention<U> {
    pub(crate) fn new(
        operation_identity: impl Into<String>,
    ) -> SnapbackResult<(Self, CommitUncertainRetentionHandle<U>)> {
        let operation_identity = operation_identity.into();
        assert!(
            !operation_identity.is_empty(),
            "commit-uncertain retention requires an operation identity"
        );
        let id = CommitUncertainRetentionId(
            NEXT_COMMIT_UNCERTAIN_RETENTION_ID.fetch_add(1, Ordering::Relaxed),
        );
        let slot = Arc::new(CommitUncertainRetentionSlot {
            carrier: Mutex::new(None),
        });
        let mut registry = commit_uncertain_retention_registry()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if registry.entries.len() >= MAX_COMMIT_UNCERTAIN_RETENTIONS {
            return Err(SnapbackError::error(
                "SNAPBACK_COMMIT_UNCERTAIN_RETENTION_EXHAUSTED",
                "server",
                "the bounded commit-uncertain retention registry is full",
            )
            .with_details(json!({
                "maxEntries": MAX_COMMIT_UNCERTAIN_RETENTIONS,
                "effectCommitted": false,
                "effectMayHaveCommitted": false,
                "retryable": false,
            })));
        }
        let previous = registry.entries.insert(
            id,
            CommitUncertainRetentionEntry {
                operation_identity,
                state: CommitUncertainRetentionState::Reserved,
                slot: slot.clone(),
            },
        );
        assert!(previous.is_none(), "commit-uncertain retention id reused");
        drop(registry);
        Ok((
            Self {
                id,
                slot,
                #[cfg(test)]
                after_store_for_test: None,
            },
            CommitUncertainRetentionHandle {
                id,
                marker: PhantomData,
            },
        ))
    }

    #[cfg(test)]
    pub(crate) fn set_after_store_for_test(&mut self, hook: impl FnOnce() + Send + 'static) {
        assert!(
            self.after_store_for_test.replace(Box::new(hook)).is_none(),
            "a commit capsule retain-step hook is already installed"
        );
    }

    fn retain(&mut self, carrier: U) {
        let mut registry = commit_uncertain_retention_registry()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let entry = registry
            .entries
            .get_mut(&self.id)
            .expect("a live capsule keeps its reserved retention slot registered");
        assert_eq!(
            entry.state,
            CommitUncertainRetentionState::Reserved,
            "a commit capsule ambiguity can be retained only once"
        );
        let previous = self
            .slot
            .carrier
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .replace(carrier);
        assert!(
            previous.is_none(),
            "a commit-uncertain retention slot already owns a carrier"
        );
        entry.state = CommitUncertainRetentionState::Retaining;
        drop(registry);
        #[cfg(test)]
        if let Some(hook) = self.after_store_for_test.take() {
            hook();
        }
    }
}

impl<U> Drop for CommitUncertainRetention<U> {
    fn drop(&mut self) {
        let mut registry = commit_uncertain_retention_registry()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(entry) = registry.entries.get_mut(&self.id) else {
            return;
        };
        let has_carrier = self
            .slot
            .carrier
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_some();
        if has_carrier {
            entry.state = CommitUncertainRetentionState::Recoverable;
        } else {
            registry.entries.remove(&self.id);
        }
    }
}

/// The final-cut token exposes no validation or Local-entry capability. It
/// checks the one absolute deadline, acquires the non-reentrant admission
/// guard, marks ambiguity, and invokes the supplied `PendingCommit` adapter.
/// The ordering and one-shot disposition are enforced here; the open adapter
/// contract does not itself prove that a durable commit occurred in the same
/// database or operation.
#[cfg(test)]
pub(crate) struct FinalCommitCut<I: crate::storage::CommitCapsuleIntent, U> {
    operation: &'static str,
    deadline: Instant,
    commit_origin: crate::storage::CommitCapsuleOrigin,
    disposition: Option<FinalCutDisposition>,
    panic_uncertain: Option<U>,
    uncertain_retention: CommitUncertainRetention<U>,
    intent: PhantomData<fn(&I)>,
    #[cfg(test)]
    before_guard_for_test: Option<Box<dyn FnOnce() + Send>>,
}

#[cfg(test)]
impl<I: crate::storage::CommitCapsuleIntent, U: Send + 'static> FinalCommitCut<I, U> {
    fn new(
        operation: &'static str,
        deadline: Instant,
        commit_origin: crate::storage::CommitCapsuleOrigin,
        uncertain_retention: CommitUncertainRetention<U>,
    ) -> Self {
        Self {
            operation,
            deadline,
            commit_origin,
            disposition: None,
            panic_uncertain: None,
            uncertain_retention,
            intent: PhantomData,
            #[cfg(test)]
            before_guard_for_test: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn set_before_guard_for_test(&mut self, hook: impl FnOnce() + Send + 'static) {
        assert!(
            self.before_guard_for_test.replace(Box::new(hook)).is_none(),
            "a commit capsule pre-guard hook is already installed"
        );
    }

    pub(crate) fn commit<T, Pending>(
        &mut self,
        reservation: &CommitCapsuleReservation,
        pending: Pending,
    ) -> CommitAttempt<T>
    where
        Pending: PendingCommit<Output = T, Uncertain = U>,
    {
        assert!(
            self.disposition.is_none(),
            "a final commit cut can be consumed only once"
        );
        #[cfg(test)]
        if let Some(hook) = self.before_guard_for_test.take() {
            hook();
        }

        if Instant::now() >= self.deadline {
            self.disposition = Some(FinalCutDisposition::TimedOut);
            return match pending.rollback() {
                Ok(()) => CommitAttempt(CommitAttemptState::RolledBack(
                    CommitTimeoutPhase::FinalCut.diagnostic(),
                )),
                Err(error) => {
                    CommitAttempt(CommitAttemptState::RolledBack(with_effect_false(error)))
                }
            };
        }

        let commit_guard = match reservation.effect().commit_guard(self.operation) {
            Ok(guard) => guard,
            Err(error) => {
                self.disposition = Some(FinalCutDisposition::Refused);
                return match pending.rollback() {
                    Ok(()) => {
                        CommitAttempt(CommitAttemptState::RolledBack(with_refusal_facts(error)))
                    }
                    Err(rollback_error) => CommitAttempt(CommitAttemptState::RolledBack(
                        with_effect_false(rollback_error),
                    )),
                };
            }
        };

        let mut pending = pending;
        let carrier = pending.prepare_commit();
        self.panic_uncertain = Some(carrier);
        // Nothing sits between CommitStarted and the adapter call. From this
        // assignment onward a timeout is forbidden.
        self.disposition = Some(FinalCutDisposition::CommitStarted);
        let result = pending.commit(&self.commit_origin);
        // Nothing below this explicit drop may hold or re-enter AdmissionState.
        drop(commit_guard);

        match result {
            Ok(value) => {
                // The adapter returned success, so the ambiguity carrier no
                // longer needs out-of-band retention. PendingCommit's open
                // contract is not itself proof that a durable COMMIT occurred.
                drop(self.panic_uncertain.take());
                CommitAttempt(CommitAttemptState::Committed(value))
            }
            Err(cause) => {
                // Keep the carrier capsule-owned across the return into the
                // caller-supplied transaction closure. Caller unwind between
                // this point and reconciliation therefore cannot reopen it.
                CommitAttempt(CommitAttemptState::CommitUncertain { cause })
            }
        }
    }

    /// Accept an idempotent predecessor only through a kernel-minted witness
    /// whose database and operation identifier match. This does not bind the
    /// intent instance or reject a semantically different intent with the same
    /// caller-constructed identifier.
    pub(crate) fn exact_existing<T>(
        &mut self,
        reservation: &CommitCapsuleReservation,
        intent: &I,
        witness: crate::storage::ExactCommitRows<I, T>,
    ) -> CommitAttempt<T> {
        assert!(
            self.disposition.is_none(),
            "a final commit cut can be consumed only once"
        );
        if Instant::now() >= self.deadline {
            self.disposition = Some(FinalCutDisposition::TimedOut);
            return CommitAttempt(CommitAttemptState::RolledBack(
                CommitTimeoutPhase::FinalCut.diagnostic(),
            ));
        }
        let commit_guard = match reservation.effect().commit_guard(self.operation) {
            Ok(guard) => guard,
            Err(error) => {
                self.disposition = Some(FinalCutDisposition::Refused);
                return CommitAttempt(CommitAttemptState::RolledBack(with_refusal_facts(error)));
            }
        };
        self.disposition = Some(FinalCutDisposition::ExactExisting);
        let result = witness.into_value_for(&self.commit_origin, intent);
        drop(commit_guard);
        match result {
            Ok(value) => CommitAttempt(CommitAttemptState::Committed(value)),
            Err(error) => CommitAttempt(CommitAttemptState::RolledBack(with_effect_false(error))),
        }
    }

    fn retain_panic_uncertain(&mut self) {
        let Some(carrier) = self.panic_uncertain.take() else {
            return;
        };
        self.uncertain_retention.retain(carrier);
    }

    fn reconciliation_carrier(&self) -> &U {
        self.panic_uncertain
            .as_ref()
            .expect("reconciliation lost its capsule-owned uncertainty carrier")
    }

    fn discard_reconciled_carrier(&mut self) {
        drop(self.panic_uncertain.take());
    }
}

#[cfg(test)]
enum BlockingCapsuleResult<T> {
    Complete(CommitCapsuleOutcome<T>),
    Panicked(Box<dyn Any + Send>),
}

#[cfg(test)]
pub(crate) async fn with_bounded_commit_capsule<T, Intent, Gate, Uncertain>(
    destination: CommitCapsuleDestination,
    spec: CommitCapsuleSpec,
    terminal_gate: Gate,
    intent: Intent,
    transact: impl FnOnce(
        &mut CommitCapsuleTransaction<'_>,
        &Intent,
        Gate,
        &CommitCapsuleReservation,
        &mut FinalCommitCut<Intent, Uncertain>,
    ) -> CommitAttempt<T>
    + Send
    + 'static,
    reconcile: impl FnOnce(
        &mut CommitCapsuleTransaction<'_>,
        &Intent,
        &Uncertain,
    ) -> SnapbackResult<Option<crate::storage::ExactCommitRows<Intent, T>>>
    + Send
    + 'static,
    uncertain_retention: CommitUncertainRetention<Uncertain>,
) -> CommitCapsuleOutcome<T>
where
    T: Send + 'static,
    Intent: crate::storage::CommitCapsuleIntent + Send + 'static,
    Gate: Send + 'static,
    Uncertain: Send + 'static,
{
    let CommitCapsuleDestination { authority, runtime } = destination;
    let state = runtime.state().clone();
    // Reservation acquisition is part of the capsule API rather than caller
    // setup. A capsule future that has not been polled therefore owns no
    // authority permit, and every successfully created reservation is born
    // under this already-established absolute deadline.
    if Instant::now() >= spec.deadline {
        return CommitCapsuleOutcome::TimedOut {
            phase: CommitTimeoutPhase::WriterAcquire,
        };
    }
    #[cfg(test)]
    super::pause_test_finite_authority_request(
        spec.test_pause_id.as_deref(),
        super::TestFiniteAuthorityPausePoint::BeforeAuthorizedEffectReservation,
        None,
    )
    .await;
    let reservation = match CommitCapsuleReservation::reserve(authority, spec.operation) {
        Ok(reservation) => reservation,
        Err(error) => return CommitCapsuleOutcome::Refused(with_refusal_facts(error)),
    };
    #[cfg(test)]
    super::pause_test_finite_authority_request(
        spec.test_pause_id.as_deref(),
        super::TestFiniteAuthorityPausePoint::AfterAuthorizedEffectReservation,
        None,
    )
    .await;

    // The shared bounded FIFO primitive owns the selected mutex future. On
    // timeout this stack frame drops the reservation, gate, immutable intent,
    // and both closures together with that one waiter.
    let Some(mut guard) = lock_managed_snapback_until(&state, spec.deadline.into_std(), None).await
    else {
        return CommitCapsuleOutcome::TimedOut {
            phase: CommitTimeoutPhase::WriterAcquire,
        };
    };

    tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        let mut local_scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        let mut final_cut = FinalCommitCut::new(
            spec.operation,
            spec.deadline,
            runtime.origin().clone(),
            uncertain_retention,
        );
        let mut transaction = CommitCapsuleTransaction::new(&mut guard);
        let attempt = catch_unwind(AssertUnwindSafe(|| {
            transact(
                &mut transaction,
                &intent,
                terminal_gate,
                &reservation,
                &mut final_cut,
            )
        }));

        let output = match attempt {
            Err(payload) => {
                // If COMMIT had started, FinalCommitCut has owned the
                // ambiguity carrier since before calling the pending adapter.
                // Retain it only after the admission guard has unwound.
                final_cut.retain_panic_uncertain();
                drop(reservation);
                BlockingCapsuleResult::Panicked(payload)
            }
            Ok(attempt) => {
                match attempt.0 {
                    CommitAttemptState::Committed(value) => {
                        drop(reservation);
                        BlockingCapsuleResult::Complete(CommitCapsuleOutcome::Committed {
                            value,
                            reconciled: false,
                        })
                    }
                    CommitAttemptState::RolledBack(error) => {
                        drop(reservation);
                        BlockingCapsuleResult::Complete(match final_cut.disposition {
                            Some(FinalCutDisposition::TimedOut) => CommitCapsuleOutcome::TimedOut {
                                phase: CommitTimeoutPhase::FinalCut,
                            },
                            Some(FinalCutDisposition::Refused) => {
                                CommitCapsuleOutcome::Refused(error)
                            }
                            _ => CommitCapsuleOutcome::RolledBack(with_effect_false(error)),
                        })
                    }
                    CommitAttemptState::CommitUncertain {
                        cause: _commit_cause,
                    } => {
                        // The reservation now owns only caller-effect permits;
                        // the exact terminal closure is held by panic_uncertain.
                        // Releasing those permits lets terminal drain proceed
                        // and cannot settle or drop the ambiguity carrier.
                        drop(reservation);
                        let reconciliation = catch_unwind(AssertUnwindSafe(|| {
                            reconcile(
                                &mut transaction,
                                &intent,
                                final_cut.reconciliation_carrier(),
                            )
                        }));
                        match reconciliation {
                            Err(payload) => {
                                final_cut.retain_panic_uncertain();
                                BlockingCapsuleResult::Panicked(payload)
                            }
                            Ok(Ok(Some(witness))) => match witness
                                .into_value_for(&final_cut.commit_origin, &intent)
                            {
                                Ok(value) => {
                                    final_cut.discard_reconciled_carrier();
                                    BlockingCapsuleResult::Complete(
                                        CommitCapsuleOutcome::Committed {
                                            value,
                                            reconciled: true,
                                        },
                                    )
                                }
                                Err(cause) => {
                                    final_cut.retain_panic_uncertain();
                                    BlockingCapsuleResult::Complete(
                                        CommitCapsuleOutcome::Uncertain(commit_uncertain(
                                            spec.uncertain_diagnostic,
                                            cause,
                                        )),
                                    )
                                }
                            },
                            Ok(Ok(None)) => {
                                final_cut.retain_panic_uncertain();
                                BlockingCapsuleResult::Complete(CommitCapsuleOutcome::Uncertain(
                                    commit_uncertain(
                                        spec.uncertain_diagnostic,
                                        SnapbackError::error(
                                            "SNAPBACK_COMMIT_INTENDED_ROWS_ABSENT",
                                            "storage",
                                            "the exact intended successor rows were absent or partial",
                                        ),
                                    ),
                                ))
                            }
                            Ok(Err(cause)) => {
                                final_cut.retain_panic_uncertain();
                                BlockingCapsuleResult::Complete(CommitCapsuleOutcome::Uncertain(
                                    commit_uncertain(spec.uncertain_diagnostic, cause),
                                ))
                            }
                        }
                    }
                }
            }
        };
        drop(transaction);

        let batch = local_scope.take_after_local_batch();
        let handoff = batch.has_effects().then(|| {
            let handoff = guard.managed_local_handoff();
            handoff.close();
            handoff
        });
        drop(guard);
        drop(local_scope);
        let after_local = crate::exec_guard::run_after_local_batch(batch);
        if let Some(handoff) = handoff {
            handoff.reopen();
        }
        debug_assert!(
            after_local.is_ok(),
            "commit capsule prototype queues no fallible after-Local work"
        );

        match output {
            BlockingCapsuleResult::Complete(outcome) => outcome,
            BlockingCapsuleResult::Panicked(payload) => std::panic::resume_unwind(payload),
        }
    })
    .await
    .expect("bounded commit capsule blocking task panicked")
}

fn object_details(error: &mut SnapbackError) -> &mut Map<String, Value> {
    if !error.diagnostic.details.is_object() {
        error.diagnostic.details = Value::Object(Map::new());
    }
    error
        .diagnostic
        .details
        .as_object_mut()
        .expect("diagnostic details were normalized to an object")
}

fn with_effect_false(mut error: SnapbackError) -> SnapbackError {
    let details = object_details(&mut error);
    details
        .entry("effectCommitted".to_owned())
        .or_insert(Value::Bool(false));
    details
        .entry("effectMayHaveCommitted".to_owned())
        .or_insert(Value::Bool(false));
    error
}

fn with_refusal_facts(mut error: SnapbackError) -> SnapbackError {
    let details = object_details(&mut error);
    details.insert(
        "capsuleOutcome".to_owned(),
        Value::String("authorityRefused".to_owned()),
    );
    details.insert("effectCommitted".to_owned(), Value::Bool(false));
    details.insert("effectMayHaveCommitted".to_owned(), Value::Bool(false));
    details
        .entry("retryable".to_owned())
        .or_insert(Value::Bool(false));
    error
}

fn commit_uncertain(code: &'static str, cause: SnapbackError) -> SnapbackError {
    SnapbackError::error(
        if code.is_empty() {
            COMMIT_OUTCOME_UNCERTAIN_CODE
        } else {
            code
        },
        "server",
        "COMMIT outcome could not be proved by exact intended-row reconciliation",
    )
    .with_details(json!({
        "capsuleOutcome": "commitUncertain",
        "phase": "reconciliation",
        "retryable": false,
        "effectCommitted": null,
        "effectMayHaveCommitted": true,
        "causeCode": cause.diagnostic.code,
    }))
}
