//! One absolute-deadline capsule around authority reservation, queued Local
//! acquisition, staging, the final admission cut, COMMIT, and exact
//! reconciliation.
//!
//! This module deliberately has no production-route caller yet. The first
//! caller is the route-free failure-injection prototype in `server/tests.rs`.
//!
//! @ref LLP 0058#split-phase-authorized-effect-fence — caller authority is
//!   reserved outside Local and the mode guard is acquired only at COMMIT.
//! @ref LLP 0059#rollback-and-ambiguous-commit — only exact intended rows can
//!   turn an ambiguous COMMIT into success; every other result stays closed.
//! @ref LLP 0225#3-transaction-and-commit-boundaries--who-may-commit-what —
//!   the adapter owns orchestration while the kernel-supplied pending value
//!   remains the only SQLite commit primitive.

use super::{SharedSnapback, writer_gate::lock_managed_snapback};
use crate::auth::invocation::{AuthorizedEffectReservation, PreparedAuthority};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::local::LocalSnapback;
use serde_json::{Map, Value, json};
use std::any::Any;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Arc, Mutex};
use tokio::time::{Instant, timeout_at};

pub(crate) const COMMIT_OUTCOME_UNCERTAIN_CODE: &str = "SNAPBACK_COMMIT_OUTCOME_UNCERTAIN";

#[derive(Clone, Copy, Debug)]
pub(crate) struct CommitCapsuleSpec {
    pub operation: &'static str,
    pub deadline: Instant,
    pub uncertain_diagnostic: &'static str,
}

#[derive(Debug)]
pub(crate) enum CommitAttempt<T> {
    Committed(T),
    RolledBack(SnapbackError),
    CommitUncertain { cause: SnapbackError },
}

#[derive(Debug)]
pub(crate) enum ExactReconciliation<T> {
    IntendedRows(T),
    Uncertain { cause: SnapbackError },
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
    fn commit(self) -> SnapbackResult<Self::Output>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FinalCutDisposition {
    TimedOut,
    Refused,
    CommitStarted,
}

/// Shared storage that receives an ambiguity carrier before any retain-step
/// hook can run. The caller keeps another handle to the same storage, so an
/// unwind after insertion cannot drop the last fail-closed owner.
pub(crate) struct CommitUncertainRetention<U> {
    retained: Arc<Mutex<Vec<U>>>,
    #[cfg(test)]
    after_store_for_test: Option<Box<dyn FnOnce() + Send>>,
}

impl<U> CommitUncertainRetention<U> {
    pub(crate) fn new(retained: &Arc<Mutex<Vec<U>>>) -> Self {
        Self {
            retained: Arc::clone(retained),
            #[cfg(test)]
            after_store_for_test: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn set_after_store_for_test(&mut self, hook: impl FnOnce() + Send + 'static) {
        assert!(
            self.after_store_for_test.replace(Box::new(hook)).is_none(),
            "a commit capsule retain-step hook is already installed"
        );
    }

    fn retain(&mut self, carrier: U) {
        {
            let mut retained = self
                .retained
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            retained.push(carrier);
        }
        #[cfg(test)]
        if let Some(hook) = self.after_store_for_test.take() {
            hook();
        }
    }
}

/// The final-cut token exposes no validation or Local-entry capability. It
/// checks the one absolute deadline, acquires the non-reentrant admission
/// guard, marks ambiguity, and invokes the kernel COMMIT primitive.
pub(crate) struct FinalCommitCut<U> {
    operation: &'static str,
    deadline: Instant,
    disposition: Option<FinalCutDisposition>,
    panic_uncertain: Option<U>,
    uncertain_retention: CommitUncertainRetention<U>,
    #[cfg(test)]
    before_guard_for_test: Option<Box<dyn FnOnce() + Send>>,
}

impl<U: Send + 'static> FinalCommitCut<U> {
    fn new(
        operation: &'static str,
        deadline: Instant,
        uncertain_retention: CommitUncertainRetention<U>,
    ) -> Self {
        Self {
            operation,
            deadline,
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
                    CommitAttempt::RolledBack(CommitTimeoutPhase::FinalCut.diagnostic())
                }
                Err(error) => CommitAttempt::RolledBack(with_effect_false(error)),
            };
        }

        let commit_guard = match reservation.commit_guard(self.operation) {
            Ok(guard) => guard,
            Err(error) => {
                return match pending.rollback() {
                    Ok(()) => {
                        self.disposition = Some(FinalCutDisposition::Refused);
                        CommitAttempt::RolledBack(with_refusal_facts(error))
                    }
                    Err(rollback_error) => {
                        CommitAttempt::RolledBack(with_effect_false(rollback_error))
                    }
                };
            }
        };

        let mut pending = pending;
        let carrier = pending.prepare_commit();
        self.panic_uncertain = Some(carrier);
        // Nothing that can fail or unwind sits between CommitStarted and the
        // COMMIT call. From this assignment onward a timeout is forbidden.
        self.disposition = Some(FinalCutDisposition::CommitStarted);
        let result = pending.commit();
        // Nothing below this explicit drop may hold or re-enter AdmissionState.
        drop(commit_guard);

        match result {
            Ok(value) => {
                // COMMIT returned known success, so the ambiguity carrier no
                // longer needs out-of-band retention.
                drop(self.panic_uncertain.take());
                CommitAttempt::Committed(value)
            }
            Err(cause) => {
                // Keep the carrier capsule-owned across the return into the
                // caller-supplied transaction closure. Caller unwind between
                // this point and reconciliation therefore cannot reopen it.
                CommitAttempt::CommitUncertain { cause }
            }
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
    state: &SharedSnapback,
    spec: CommitCapsuleSpec,
    authority: PreparedAuthority,
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
    reconcile: impl FnOnce(&mut LocalSnapback, &Intent, &Uncertain) -> ExactReconciliation<T>
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
    // Reservation acquisition is part of the capsule API rather than caller
    // setup. A capsule future that has not been polled therefore owns no
    // authority permit, and every successfully created reservation is born
    // under this already-established absolute deadline.
    if Instant::now() >= spec.deadline {
        return CommitCapsuleOutcome::TimedOut {
            phase: CommitTimeoutPhase::WriterAcquire,
        };
    }
    let reservation = match authority.reserve_authorized_effect(spec.operation) {
        Ok(reservation) => reservation,
        Err(error) => return CommitCapsuleOutcome::Refused(with_refusal_facts(error)),
    };

    // The entire queued future owns the reservation, gate, immutable intent,
    // and both closures. Timeout cancellation therefore removes only this
    // FIFO mutex waiter and drops every permit/gate carrier it captured.
    let queued = async move {
        let guard = lock_managed_snapback(state).await;
        (
            guard,
            reservation,
            terminal_gate,
            intent,
            transact,
            reconcile,
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
        let mut final_cut = FinalCommitCut::new(spec.operation, spec.deadline, uncertain_retention);
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
                match attempt {
                    CommitAttempt::Committed(value) => {
                        drop(reservation);
                        BlockingCapsuleResult::Complete(CommitCapsuleOutcome::Committed {
                            value,
                            reconciled: false,
                        })
                    }
                    CommitAttempt::RolledBack(error) => {
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
                    CommitAttempt::CommitUncertain {
                        cause: _commit_cause,
                    } => {
                        // FinalCommitCut has owned the carrier continuously
                        // since prepare_commit, including across the return
                        // through caller code. Release the caller permit only
                        // after that ownership is established.
                        drop(reservation);
                        let reconciliation = catch_unwind(AssertUnwindSafe(|| {
                            reconcile(&mut guard, &intent, final_cut.reconciliation_carrier())
                        }));
                        match reconciliation {
                            Err(payload) => {
                                final_cut.retain_panic_uncertain();
                                BlockingCapsuleResult::Panicked(payload)
                            }
                            Ok(ExactReconciliation::IntendedRows(value)) => {
                                final_cut.discard_reconciled_carrier();
                                BlockingCapsuleResult::Complete(CommitCapsuleOutcome::Committed {
                                    value,
                                    reconciled: true,
                                })
                            }
                            Ok(ExactReconciliation::Uncertain { cause }) => {
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
