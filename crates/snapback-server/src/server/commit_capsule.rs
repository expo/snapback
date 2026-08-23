//! One absolute-deadline capsule around authority reservation, queued Local
//! acquisition, staging, the final admission cut, COMMIT, and exact
//! reconciliation.
//!
//! Durable watch management is the first production adopter. The route-free
//! failure-injection prototype in `server/tests.rs` remains the mechanism-level
//! proof for queueing, deadline, panic, and ambiguity behavior.
//!
//! @ref LLP 0058#split-phase-authorized-effect-fence — caller authority is
//!   reserved outside Local and the mode guard is acquired only at COMMIT.
//! @ref LLP 0059#rollback-and-ambiguous-commit — only exact intended rows can
//!   turn an ambiguous COMMIT into success; every other result stays closed.
//! @ref LLP 0225#3-transaction-and-commit-boundaries--who-may-commit-what —
//!   the adapter owns orchestration while the kernel-supplied pending value
//!   remains the only SQLite commit primitive.

use super::{SharedSnapback, writer_gate::lock_managed_snapback};
use crate::admin::AppState;
use crate::auth::invocation::{AuthorizedEffectReservation, PreparedAuthority};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::local::LocalSnapback;
use serde_json::{Map, Value, json};
use std::any::Any;
use std::collections::BTreeMap;
use std::marker::PhantomData;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::time::{Instant, timeout_at};

pub(crate) const COMMIT_OUTCOME_UNCERTAIN_CODE: &str = "SNAPBACK_COMMIT_OUTCOME_UNCERTAIN";

#[derive(Clone, Debug)]
pub(crate) struct CommitCapsuleSpec {
    pub operation: &'static str,
    pub operation_identity: String,
    pub deadline: Instant,
    pub uncertain_diagnostic: &'static str,
    #[cfg(test)]
    pub test_pause_id: Option<String>,
}

#[derive(Debug)]
enum CommitAttemptState<T> {
    Committed(T),
    RolledBack(SnapbackError),
    CommitUncertain { cause: SnapbackError },
}

#[derive(Debug)]
pub(crate) struct CommitAttempt<T>(CommitAttemptState<T>);

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

/// The durable destination, caller authority, and database commit authority
/// are minted as one checked capsule input rather than accepted independently.
#[derive(Clone, Debug)]
pub(crate) struct CommitCapsuleBinding(crate::storage::CommitCapsuleAuthority);

impl CommitCapsuleBinding {
    pub(crate) fn new(authority: crate::storage::CommitCapsuleAuthority) -> Self {
        Self(authority)
    }

    fn authority(&self) -> &crate::storage::CommitCapsuleAuthority {
        &self.0
    }
}

pub(crate) struct CommitCapsuleDestination {
    state: SharedSnapback,
    authority: PreparedAuthority,
    binding: CommitCapsuleBinding,
}

impl CommitCapsuleDestination {
    pub(crate) fn bind(runtime: &AppState, authority: PreparedAuthority) -> SnapbackResult<Self> {
        if !runtime
            .auth_admission_controller()
            .owns_lease(authority.admission_lease())
        {
            return Err(SnapbackError::error(
                "SNAPBACK_COMMIT_CAPSULE_DESTINATION_MISMATCH",
                "server",
                "the prepared authority does not belong to the destination AppState",
            ));
        }
        Ok(Self {
            state: runtime.snapback.clone(),
            authority,
            binding: runtime.commit_capsule_binding.clone(),
        })
    }

    #[cfg(test)]
    pub(crate) fn commit_authority_for_test(&self) -> crate::storage::CommitCapsuleAuthority {
        self.binding.0.clone()
    }
}

#[derive(Debug)]
pub(crate) enum CommitCapsuleOutcome<T> {
    Committed { value: T, reconciled: bool },
    Refused(SnapbackError),
    TimedOut { phase: CommitTimeoutPhase },
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

/// A staged kernel transaction whose only remaining operations are rollback,
/// ambiguity preparation, and COMMIT. `prepare_commit` must only move/mark an
/// already-prepared uncertainty carrier; `commit` must not validate admission
/// or enter Local again.
pub(crate) trait PendingCommit: Sized {
    type Output;
    type Uncertain: Send + 'static;

    fn rollback(self) -> SnapbackResult<()>;

    /// Mark the operation ambiguous before SQLite COMMIT can panic or error.
    fn prepare_commit(&mut self) -> Self::Uncertain;

    /// COMMIT the already-staged transaction. A known-success adapter must
    /// settle any terminal carrier it shares with `prepare_commit`; the
    /// capsule alone owns the ambiguity carrier across this call.
    fn commit(
        self,
        authority: &crate::storage::CommitCapsuleAuthority,
    ) -> SnapbackResult<Self::Output>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FinalCutDisposition {
    TimedOut,
    Refused,
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
/// guard, marks ambiguity, and invokes the kernel COMMIT primitive.
pub(crate) struct FinalCommitCut<U> {
    operation: &'static str,
    operation_identity: String,
    deadline: Instant,
    commit_authority: crate::storage::CommitCapsuleAuthority,
    disposition: Option<FinalCutDisposition>,
    panic_uncertain: Option<U>,
    uncertain_retention: CommitUncertainRetention<U>,
    #[cfg(test)]
    before_guard_for_test: Option<Box<dyn FnOnce() + Send>>,
}

impl<U: Send + 'static> FinalCommitCut<U> {
    fn new(
        operation: &'static str,
        operation_identity: String,
        deadline: Instant,
        commit_authority: crate::storage::CommitCapsuleAuthority,
        uncertain_retention: CommitUncertainRetention<U>,
    ) -> Self {
        Self {
            operation,
            operation_identity,
            deadline,
            commit_authority,
            disposition: None,
            panic_uncertain: None,
            uncertain_retention,
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
        reservation: &AuthorizedEffectReservation,
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
            return match pending.rollback() {
                Ok(()) => {
                    self.disposition = Some(FinalCutDisposition::TimedOut);
                    CommitAttempt(CommitAttemptState::RolledBack(
                        CommitTimeoutPhase::FinalCut.diagnostic(),
                    ))
                }
                Err(error) => {
                    CommitAttempt(CommitAttemptState::RolledBack(with_effect_false(error)))
                }
            };
        }

        let commit_guard = match reservation.commit_guard(self.operation) {
            Ok(guard) => guard,
            Err(error) => {
                return match pending.rollback() {
                    Ok(()) => {
                        self.disposition = Some(FinalCutDisposition::Refused);
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
        // Nothing that can fail or unwind sits between CommitStarted and the
        // COMMIT call. From this assignment onward a timeout is forbidden.
        self.disposition = Some(FinalCutDisposition::CommitStarted);
        let result = pending.commit(&self.commit_authority);
        // Nothing below this explicit drop may hold or re-enter AdmissionState.
        drop(commit_guard);

        match result {
            Ok(value) => {
                // COMMIT returned known success, so the ambiguity carrier no
                // longer needs out-of-band retention.
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

    /// Accept an idempotent predecessor only through the kernel's exact-row
    /// witness for this database and operation. No caller value can mint a
    /// committed attempt.
    pub(crate) fn exact_existing<T>(
        &mut self,
        reservation: &AuthorizedEffectReservation,
        witness: crate::storage::ExactCommitRows<T>,
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
        let commit_guard = match reservation.commit_guard(self.operation) {
            Ok(guard) => guard,
            Err(error) => {
                self.disposition = Some(FinalCutDisposition::Refused);
                return CommitAttempt(CommitAttemptState::RolledBack(with_refusal_facts(error)));
            }
        };
        let result = witness.into_value_for(&self.commit_authority, &self.operation_identity);
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

enum BlockingCapsuleResult<T> {
    Complete(CommitCapsuleOutcome<T>),
    Panicked(Box<dyn Any + Send>),
}

pub(crate) async fn with_bounded_commit_capsule<T, Intent, Gate, Uncertain>(
    destination: CommitCapsuleDestination,
    spec: CommitCapsuleSpec,
    terminal_gate: Gate,
    intent: Intent,
    transact: impl FnOnce(
        &mut LocalSnapback,
        &Intent,
        Gate,
        &AuthorizedEffectReservation,
        &mut FinalCommitCut<Uncertain>,
    ) -> CommitAttempt<T>
    + Send
    + 'static,
    reconcile: impl FnOnce(
        &mut LocalSnapback,
        &Intent,
        &Uncertain,
    ) -> SnapbackResult<Option<crate::storage::ExactCommitRows<T>>>
    + Send
    + 'static,
    uncertain_retention: CommitUncertainRetention<Uncertain>,
) -> CommitCapsuleOutcome<T>
where
    T: Send + 'static,
    Intent: Send + 'static,
    Gate: Send + 'static,
    Uncertain: Send + 'static,
{
    let CommitCapsuleDestination {
        state,
        authority,
        binding,
    } = destination;
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
    let reservation = match authority.reserve_authorized_effect(spec.operation) {
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

    // The entire queued future owns the reservation, gate, immutable intent,
    // and both closures. Timeout cancellation therefore removes only this
    // FIFO mutex waiter and drops every permit/gate carrier it captured.
    let queued = async move {
        let guard = lock_managed_snapback(&state).await;
        (
            guard,
            reservation,
            terminal_gate,
            intent,
            transact,
            reconcile,
            binding,
            uncertain_retention,
        )
    };
    let Ok((
        mut guard,
        reservation,
        terminal_gate,
        intent,
        transact,
        reconcile,
        binding,
        uncertain_retention,
    )) = timeout_at(spec.deadline, queued).await
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
            spec.operation_identity.clone(),
            spec.deadline,
            binding.authority().clone(),
            uncertain_retention,
        );
        let attempt = catch_unwind(AssertUnwindSafe(|| {
            transact(
                &mut guard,
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
                            reconcile(&mut guard, &intent, final_cut.reconciliation_carrier())
                        }));
                        match reconciliation {
                            Err(payload) => {
                                final_cut.retain_panic_uncertain();
                                BlockingCapsuleResult::Panicked(payload)
                            }
                            Ok(Ok(Some(witness))) => match witness.into_value_for(
                                &final_cut.commit_authority,
                                &final_cut.operation_identity,
                            ) {
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
