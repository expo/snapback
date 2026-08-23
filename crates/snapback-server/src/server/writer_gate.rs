//! The one gate to the global writer for every serving path.
//!
//! @ref LLP 0225#3-transaction-and-commit-boundaries--who-may-commit-what — owner 5
//!   (transport adapters) acquires the writer only through this seam and
//!   never commits directly; CPU/network preparation belongs outside the
//!   guard (§3.6), which is what makes the deferred asset-prepare
//!   choreography implementable in one place.

use super::{SharedSnapback, authorization_reservation_stale, with_locked_snapback_then};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::local::LocalSnapback;
#[cfg(test)]
use crate::remainder_adapter::RemainderLocalSnapbackExt as _;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(test)]
use std::sync::{Mutex as StdMutex, OnceLock};
use std::time::Instant;

#[cfg(test)]
struct ManagedHandoffWaiterTestHook {
    handoff_identity: usize,
    reached: Arc<tokio::sync::Notify>,
}

#[cfg(test)]
static MANAGED_HANDOFF_WAITER_TEST_HOOKS: OnceLock<StdMutex<Vec<ManagedHandoffWaiterTestHook>>> =
    OnceLock::new();

#[cfg(test)]
struct ManagedWriterQueueTestHook {
    state_identity: usize,
    reached: Arc<tokio::sync::Notify>,
}

#[cfg(test)]
static MANAGED_WRITER_QUEUE_TEST_HOOKS: OnceLock<StdMutex<Vec<ManagedWriterQueueTestHook>>> =
    OnceLock::new();

#[cfg(test)]
pub(super) fn install_managed_writer_queue_test_hook(
    state: &SharedSnapback,
) -> Arc<tokio::sync::Notify> {
    let reached = Arc::new(tokio::sync::Notify::new());
    MANAGED_WRITER_QUEUE_TEST_HOOKS
        .get_or_init(|| StdMutex::new(Vec::new()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .push(ManagedWriterQueueTestHook {
            state_identity: Arc::as_ptr(state) as usize,
            reached: reached.clone(),
        });
    reached
}

#[cfg(test)]
fn notify_managed_writer_queued_for_test(state: &SharedSnapback) {
    let mut hooks = MANAGED_WRITER_QUEUE_TEST_HOOKS
        .get_or_init(|| StdMutex::new(Vec::new()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(position) = hooks
        .iter()
        .position(|hook| hook.state_identity == Arc::as_ptr(state) as usize)
    {
        hooks.swap_remove(position).reached.notify_one();
    }
}

#[cfg(test)]
pub(super) fn install_managed_handoff_waiter_test_hook(
    handoff: &Arc<crate::exec_guard::ManagedLocalHandoff>,
) -> Arc<tokio::sync::Notify> {
    let reached = Arc::new(tokio::sync::Notify::new());
    let mut hooks = MANAGED_HANDOFF_WAITER_TEST_HOOKS
        .get_or_init(|| StdMutex::new(Vec::new()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    assert!(
        !hooks
            .iter()
            .any(|hook| hook.handoff_identity == Arc::as_ptr(handoff) as usize),
        "managed handoff waiter test hook already installed for this handoff"
    );
    hooks.push(ManagedHandoffWaiterTestHook {
        handoff_identity: Arc::as_ptr(handoff) as usize,
        reached: reached.clone(),
    });
    reached
}

#[cfg(test)]
fn notify_managed_handoff_waiter_for_test(handoff: &Arc<crate::exec_guard::ManagedLocalHandoff>) {
    let mut hooks = MANAGED_HANDOFF_WAITER_TEST_HOOKS
        .get_or_init(|| StdMutex::new(Vec::new()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(position) = hooks
        .iter()
        .position(|hook| hook.handoff_identity == Arc::as_ptr(handoff) as usize)
    {
        let hook = hooks.swap_remove(position);
        hook.reached.notify_one();
    }
}

/// Run write-lane work against the instance without blocking a tokio worker.
///
/// Waiting for the global mutex stays async (`lock_owned` — queued callers
/// burn no thread); only actual execution occupies a blocking-pool thread,
/// with the owned guard moved into the closure. Every server path that can
/// reach Hermes eval or rusqlite goes through here (or the read lane), which
/// is what keeps the exec-guard assertion true. Ephemeral operations and
/// outbox drains no longer take this mutex at all (LLP 0032 L9 — they go to
/// the internally synchronized `EphemeralApi`); disconnect still locks
/// inline because it tears down durable subscriptions, which is memory-only.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L7.
pub(crate) async fn with_snapback<T, F>(state: &SharedSnapback, work: F) -> T
where
    F: FnOnce(&mut LocalSnapback) -> T + Send + 'static,
    T: Send + 'static,
{
    with_snapback_then(state, work, |output| output).await
}

pub(super) async fn lock_managed_snapback(
    state: &SharedSnapback,
) -> tokio::sync::OwnedMutexGuard<LocalSnapback> {
    loop {
        let lock = state.clone().lock_owned();
        #[cfg(test)]
        notify_managed_writer_queued_for_test(state);
        let guard = lock.await;
        let handoff = guard.managed_local_handoff();
        if !handoff.is_closed() {
            return guard;
        }
        drop(guard);
        #[cfg(test)]
        notify_managed_handoff_waiter_for_test(&handoff);
        handoff.wait_until_open().await;
    }
}

/// Watchdog-only cancellation for a detached action queued on the FIFO Local
/// writer. Dropping the selected `lock_owned` future removes only this waiter;
/// it never polls `try_lock` and cannot overtake earlier writers.
#[derive(Debug, Default)]
pub(super) struct ManagedWriterCancellation {
    cancelled: AtomicBool,
    changed: tokio::sync::Notify,
}

impl ManagedWriterCancellation {
    pub(super) fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.changed.notify_waiters();
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

/// Acquire the normal FIFO managed writer before an absolute deadline. The
/// optional cancellation carrier belongs only to the action watchdog.
pub(super) async fn lock_managed_snapback_until(
    state: &SharedSnapback,
    deadline: Instant,
    cancellation: Option<&ManagedWriterCancellation>,
) -> Option<tokio::sync::OwnedMutexGuard<LocalSnapback>> {
    loop {
        if cancellation.is_some_and(ManagedWriterCancellation::is_cancelled)
            || Instant::now() >= deadline
        {
            return None;
        }
        let lock = state.clone().lock_owned();
        tokio::pin!(lock);
        #[cfg(test)]
        notify_managed_writer_queued_for_test(state);
        let guard = if let Some(cancellation) = cancellation {
            let changed = cancellation.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if cancellation.is_cancelled() {
                return None;
            }
            tokio::select! {
                guard = &mut lock => guard,
                _ = &mut changed => return None,
                _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => return None,
            }
        } else {
            tokio::select! {
                guard = &mut lock => guard,
                _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => return None,
            }
        };
        let handoff = guard.managed_local_handoff();
        if !handoff.is_closed() {
            return Some(guard);
        }
        drop(guard);
        #[cfg(test)]
        notify_managed_handoff_waiter_for_test(&handoff);
        let opened = handoff.wait_until_open();
        tokio::pin!(opened);
        if let Some(cancellation) = cancellation {
            let changed = cancellation.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if cancellation.is_cancelled() {
                return None;
            }
            tokio::select! {
                _ = &mut opened => {}
                _ = &mut changed => return None,
                _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => return None,
            }
        } else {
            tokio::select! {
                _ = &mut opened => {}
                _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => return None,
            }
        }
    }
}

/// Run a second blocking phase after the managed Local guard and its scope
/// have been released. The first phase's deferred projections are flushed
/// before `after`, so both phases remain owned by the same uncancellable
/// `spawn_blocking` job.
///
/// @ref LLP 0059#locking-and-linearization — ephemeral diagnostics and
/// process-local projections never overlap the global Local writer.
pub(crate) async fn with_snapback_then<T, U, F, A>(state: &SharedSnapback, work: F, after: A) -> U
where
    F: FnOnce(&mut LocalSnapback) -> T + Send + 'static,
    A: FnOnce(T) -> U + Send + 'static,
    T: Send + 'static,
    U: Send + 'static,
{
    let guard = lock_managed_snapback(state).await;
    with_locked_snapback_then(guard, work, after).await
}

/// Reserve protected-room quiescence before entering managed Local/SQLite,
/// then carry only a lock-free binder through the durable transaction. A
/// generation mismatch cancels the reservation off-Local and returns a typed
/// stale result without rerunning potentially once-executed Ibex code. Once
/// the final Local guard is acquired, the blocking job owns exact cancellation,
/// rollback, commit finalization, and panic cleanup after Local release.
///
/// @ref LLP 0059#locking-and-linearization — room authority never nests
/// beneath managed Local or SQLite, including rollback and commit publication.
pub(crate) async fn with_snapback_authorization_write<T, P, F>(
    state: &SharedSnapback,
    preflight: P,
    work: F,
) -> SnapbackResult<T>
where
    P: Fn(&LocalSnapback) -> SnapbackResult<crate::storage::AuthorizationCommitPreflight>
        + Send
        + Sync
        + 'static,
    F: FnOnce(&mut LocalSnapback) -> T + Send + 'static,
    T: Send + 'static,
{
    with_snapback_staged_authorization_write(
        state,
        None,
        move |snapback| preflight(snapback).map(|preflight| (preflight, ())),
        move |snapback, ()| work(snapback),
    )
    .await
}

// Once-executed Ibex buffers must never be regenerated by a stale retry.
// Stored HostPlans may eventually opt into a bounded retry through a separate
// carrier, but this shared wrapper performs exactly one attempt and returns a
// typed stale outcome.
enum AuthorizationWriteAttempt<T> {
    Stale,
    Complete(T),
}

enum AuthorizationWriteTurn<S, T, F> {
    Complete(std::thread::Result<T>),
    NeedsReservation {
        preflight: crate::storage::AuthorizationCommitPreflight,
        staged: S,
        generation: u64,
        snapshot: (u64, crate::storage::AuthorizationVersion),
        ephemeral: crate::local::EphemeralApi,
        work: F,
    },
}

enum StagedAuthorizationWrite<S, T, F> {
    Complete(T),
    Reserved {
        staged: S,
        generation: u64,
        snapshot: (u64, crate::storage::AuthorizationVersion),
        reservation: crate::storage::AuthorizationCommitReservation,
        work: F,
    },
}

/// Opaque ownership of the reset transaction's still-closed managed handoff.
/// Only the coordinated-reset path can obtain this carrier, and it can run
/// only against the exact `ManagedLocalHandoff` it closed. Dropping it does
/// not reopen: a lost committed-reset owner must leave the store fail-closed.
pub(super) struct CommittedResetHandoff {
    handoff: Arc<crate::exec_guard::ManagedLocalHandoff>,
}

impl CommittedResetHandoff {
    pub(super) async fn with_snapback<T, F>(
        &self,
        state: &SharedSnapback,
        work: F,
    ) -> SnapbackResult<T>
    where
        F: FnOnce(&mut LocalSnapback) -> T + Send + 'static,
        T: Send + 'static,
    {
        let mut guard = state.clone().lock_owned().await;
        let installed = guard.managed_local_handoff();
        assert!(
            Arc::ptr_eq(&installed, &self.handoff) && installed.is_closed(),
            "committed reset lost ownership of its closed managed handoff"
        );
        tokio::task::spawn_blocking(move || {
            let _sanction = crate::exec_guard::BlockingSanction::acquire();
            let mut local_scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
            let output =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work(&mut guard)));
            let batch = local_scope.take_after_local_batch();
            drop(guard);
            drop(local_scope);
            crate::exec_guard::run_after_local_batch(batch).map_err(SnapbackError::from)?;
            match output {
                Ok(output) => Ok(output),
                Err(payload) => std::panic::resume_unwind(payload),
            }
        })
        .await
        .expect("committed-reset continuation task panicked")
    }

    pub(super) fn reopen(self) {
        self.handoff.reopen();
    }

    /// Release the transient reset sequencing fence after every durable and
    /// process-local authorization surface has been made fail-closed. The
    /// projection/coordinator latches, not this writer-ordering handoff, own
    /// the lasting refusal and its typed diagnostic.
    ///
    /// Keeping this distinct from the success method makes the failure owner
    /// prove its ordering at the call site: predecessor/successor issuers are
    /// cleared or suspended first, and the coordinator is globally closed,
    /// before queued writers are woken to observe that refusal.
    ///
    /// @ref LLP 0290#76-after-local-sequencing — the handoff is a transient
    /// ordering fence; the suspended participant and closed coordinator own
    /// the lasting typed refusal after a classified postcommit failure.
    pub(super) fn release_after_fail_closed(self) {
        self.handoff.reopen();
    }
}

pub(super) struct CoordinatedResetWrite<T> {
    pub(super) attempt: crate::storage::auth::AuthTransactionAttempt<T>,
    pub(super) committed_handoff: Option<CommittedResetHandoff>,
    pub(super) finalization_error: Option<SnapbackError>,
}

enum CoordinatedResetStage<T, F> {
    Complete(CoordinatedResetWrite<T>),
    NeedsReservation {
        generation: u64,
        snapshot: (u64, crate::storage::AuthorizationVersion),
        ephemeral: crate::local::EphemeralApi,
        work: F,
    },
}

fn finish_coordinated_reset_write_turn<T>(
    guard: tokio::sync::OwnedMutexGuard<LocalSnapback>,
    mut local_scope: crate::exec_guard::LocalSnapbackWriteScope,
    attempt: std::thread::Result<crate::storage::auth::AuthTransactionAttempt<T>>,
    unused: Option<crate::storage::AuthorizationCommitReservation>,
) -> CoordinatedResetWrite<T> {
    use crate::storage::auth::AuthTransactionAttempt;

    let batch = local_scope.take_after_local_batch();
    let committed = matches!(&attempt, Ok(AuthTransactionAttempt::Committed(_)));
    let close = committed || batch.has_effects() || unused.is_some();
    let handoff = close.then(|| {
        let handoff = guard.managed_local_handoff();
        handoff.close();
        handoff
    });
    drop(guard);
    drop(local_scope);
    if let Some(unused) = unused {
        unused.cancel();
    }
    let finalization_error = crate::exec_guard::run_after_local_batch(batch)
        .map_err(SnapbackError::from)
        .err();
    let attempt = match attempt {
        Ok(attempt) => attempt,
        Err(payload) => std::panic::resume_unwind(payload),
    };
    if committed {
        return CoordinatedResetWrite {
            attempt,
            committed_handoff: handoff.map(|handoff| CommittedResetHandoff { handoff }),
            finalization_error,
        };
    }
    if let Some(handoff) = handoff {
        handoff.reopen();
    }
    CoordinatedResetWrite {
        attempt,
        committed_handoff: None,
        finalization_error,
    }
}

/// Reset-only authorization write choreography. Unlike the generic wrapper,
/// a known commit transfers the closed managed handoff to the reset
/// orchestrator after the destructive finalizer drains. Publication and exact
/// successor-issuer reconstruction use that opaque carrier; no request flag
/// or generic caller can select the retained-closed path.
///
/// @ref LLP 0290#76-after-local-sequencing — the reset handoff remains closed
/// across finalizer drain, reset publication, and successor issuer rebuild.
pub(super) async fn with_snapback_coordinated_reset_write<T, F>(
    state: &SharedSnapback,
    work: F,
) -> CoordinatedResetWrite<T>
where
    F: FnOnce(&mut LocalSnapback) -> crate::storage::auth::AuthTransactionAttempt<T>
        + Send
        + 'static,
    T: Send + 'static,
{
    use crate::storage::auth::AuthTransactionAttempt;

    let mut guard = lock_managed_snapback(state).await;
    let staged = tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        let mut local_scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        if !guard.authorization_commit_reservation_required()? {
            // Disabled and construction-bound participants deliberately retain
            // the direct Local turn used by the generic writer wrapper. They
            // have no live issuer projection from which an off-Local room
            // reservation could be minted. A known reset commit still closes
            // and transfers the managed handoff before its finalizer drains.
            // ParticipantReady never enters this branch unless its exact live
            // projection is available; an unavailable ready participant is a
            // typed error above, not a reset bypass.
            //
            // @ref LLP 0290#step-8--switch-production-composition-and-transactions
            // — native reservations begin only after auth-time activation.
            let attempt =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work(&mut guard)));
            return Ok(CoordinatedResetStage::Complete(
                finish_coordinated_reset_write_turn(guard, local_scope, attempt, None),
            ));
        }
        let generation = guard.app_generation();
        let snapshot = guard.authorization_reservation_snapshot()?;
        let ephemeral = guard.ephemeral_api();
        let batch = local_scope.take_after_local_batch();
        drop(guard);
        drop(local_scope);
        crate::exec_guard::run_after_local_batch(batch).map_err(SnapbackError::from)?;
        Ok(CoordinatedResetStage::NeedsReservation {
            generation,
            snapshot,
            ephemeral,
            work,
        })
    })
    .await
    .expect("coordinated-reset staging task panicked");
    let (generation, snapshot, ephemeral, work) = match staged {
        Ok(CoordinatedResetStage::Complete(output)) => return output,
        Ok(CoordinatedResetStage::NeedsReservation {
            generation,
            snapshot,
            ephemeral,
            work,
        }) => (generation, snapshot, ephemeral, work),
        Err(error) => {
            return CoordinatedResetWrite {
                attempt: AuthTransactionAttempt::RolledBack(error),
                committed_handoff: None,
                finalization_error: None,
            };
        }
    };
    let cancellation = Arc::new(crate::storage::AuthorizationReservationCancellation::new());
    let reservation = match ephemeral.reserve_authorization_commit(
        crate::storage::AuthorizationCommitPreflight::AllProtectedRooms,
        cancellation,
    ) {
        Ok(reservation) => reservation,
        Err(error) => {
            return CoordinatedResetWrite {
                attempt: AuthTransactionAttempt::RolledBack(error),
                committed_handoff: None,
                finalization_error: None,
            };
        }
    };

    let mut guard = lock_managed_snapback(state).await;
    tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        let current_snapshot = guard.authorization_reservation_snapshot();
        let snapshot_matches = current_snapshot
            .as_ref()
            .is_ok_and(|current| current == &snapshot);
        if guard.app_generation() != generation || !snapshot_matches {
            drop(guard);
            reservation.cancel();
            let error = current_snapshot.err().unwrap_or_else(|| {
                authorization_reservation_stale(
                    "coordinated reset reservation became stale before the durable transaction",
                )
            });
            return CoordinatedResetWrite {
                attempt: AuthTransactionAttempt::RolledBack(error),
                committed_handoff: None,
                finalization_error: None,
            };
        }
        let local_scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        let reservation_scope = reservation.install();
        let attempt = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work(&mut guard)));
        let unused = reservation_scope.take_unused();
        finish_coordinated_reset_write_turn(guard, local_scope, attempt, unused)
    })
    .await
    .expect("coordinated-reset transaction task panicked")
}

struct CancelAuthorizationReservationOnDrop {
    cancellation: Arc<crate::storage::AuthorizationReservationCancellation>,
    armed: bool,
}

impl CancelAuthorizationReservationOnDrop {
    fn new(cancellation: Arc<crate::storage::AuthorizationReservationCancellation>) -> Self {
        Self {
            cancellation,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for CancelAuthorizationReservationOnDrop {
    fn drop(&mut self) {
        if self.armed {
            self.cancellation.cancel();
        }
    }
}

/// Staging may evaluate a stored mutation plan or already-buffered handler
/// effects to obtain exact changed rows. A ready authorization event then
/// leaves Local before the kernel carrier is minted. Authorization-neutral and
/// dormant-bound work stays in the original turn; the kernel still derives
/// the transaction's actual witness. After a reservation handoff, durable data
/// and authorization witnesses are rechecked; stale work is cancelled
/// off-Local and returned as a typed conflict. The one-attempt bound
/// deliberately prevents rerunning a handler whose buffered effects may
/// already have been computed.
pub(crate) async fn with_snapback_staged_authorization_write<S, T, P, F>(
    state: &SharedSnapback,
    writer_gate: Option<Arc<crate::live_coalesce::LiveFanoutCoalescer>>,
    stage: P,
    work: F,
) -> SnapbackResult<T>
where
    P: Fn(&mut LocalSnapback) -> SnapbackResult<(crate::storage::AuthorizationCommitPreflight, S)>
        + Send
        + Sync
        + 'static,
    F: FnOnce(&mut LocalSnapback, S) -> T + Send + 'static,
    S: Send + 'static,
    T: Send + 'static,
{
    let writer_turn_guard = writer_gate.map(|coalescer| Arc::new(coalescer.writer_turn_guard()));
    let mut guard = lock_managed_snapback(state).await;
    let cancellation = Arc::new(crate::storage::AuthorizationReservationCancellation::new());
    let mut cancel_on_drop = CancelAuthorizationReservationOnDrop::new(cancellation.clone());
    let stage_writer_turn_guard = writer_turn_guard.clone();
    let staged_result: SnapbackResult<StagedAuthorizationWrite<S, T, F>> =
        tokio::task::spawn_blocking(move || {
            let _writer_turn_guard = stage_writer_turn_guard;
            let _sanction = crate::exec_guard::BlockingSanction::acquire();
            let mut local_scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let (preflight, staged) = stage(&mut guard)?;
                let authorization_event = !matches!(
                    preflight,
                    crate::storage::AuthorizationCommitPreflight::NoAuthorizationEvent
                );
                let reservation_required =
                    authorization_event && guard.authorization_commit_reservation_required()?;
                if !reservation_required {
                    // The preview does not authorize the commit: the kernel
                    // still derives and checks the transaction's actual
                    // witness. A dormant ParticipantBound likewise preserves
                    // the former disabled-interlock behavior and stays in this
                    // Local turn; only ParticipantReady may split for an exact
                    // room reservation. A false neutral preview or an
                    // unexpected lifecycle transition still fails closed in
                    // the kernel before COMMIT.
                    //
                    // @ref LLP 0290#step-8--switch-production-composition-and-transactions
                    // — native reservations begin only after auth-time activation.
                    let output = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        work(&mut guard, staged)
                    }));
                    return Ok::<_, SnapbackError>(AuthorizationWriteTurn::Complete(output));
                }
                Ok::<_, SnapbackError>(AuthorizationWriteTurn::NeedsReservation {
                    preflight,
                    staged,
                    generation: guard.app_generation(),
                    snapshot: guard.authorization_reservation_snapshot()?,
                    ephemeral: guard.ephemeral_api(),
                    work,
                })
            }));
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
            after_local.map_err(SnapbackError::from)?;
            let turn = match result {
                Ok(result) => result?,
                Err(payload) => std::panic::resume_unwind(payload),
            };
            match turn {
                AuthorizationWriteTurn::Complete(output) => match output {
                    Ok(output) => Ok(StagedAuthorizationWrite::Complete(output)),
                    Err(payload) => std::panic::resume_unwind(payload),
                },
                AuthorizationWriteTurn::NeedsReservation {
                    preflight,
                    staged,
                    generation,
                    snapshot,
                    ephemeral,
                    work,
                } => {
                    let reservation =
                        ephemeral.reserve_authorization_commit(preflight, cancellation)?;
                    Ok(StagedAuthorizationWrite::Reserved {
                        staged,
                        generation,
                        snapshot,
                        reservation,
                        work,
                    })
                }
            }
        })
        .await
        .expect("authorization staging task panicked");
    cancel_on_drop.disarm();
    let (staged, generation, snapshot, reservation, work) = match staged_result? {
        StagedAuthorizationWrite::Complete(output) => return Ok(output),
        StagedAuthorizationWrite::Reserved {
            staged,
            generation,
            snapshot,
            reservation,
            work,
        } => (staged, generation, snapshot, reservation, work),
    };

    let mut guard = lock_managed_snapback(state).await;
    let commit_writer_turn_guard = writer_turn_guard.clone();
    let attempted = tokio::task::spawn_blocking(move || {
        let _writer_turn_guard = commit_writer_turn_guard;
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        let current_snapshot = match guard.authorization_reservation_snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => {
                drop(guard);
                reservation.cancel();
                return Err(error);
            }
        };
        if guard.app_generation() != generation || current_snapshot != snapshot {
            drop(guard);
            reservation.cancel();
            return Ok(AuthorizationWriteAttempt::Stale);
        }
        let mut local_scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        let reservation_scope = reservation.install();
        let output =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work(&mut guard, staged)));
        let unused = reservation_scope.take_unused();
        let batch = local_scope.take_after_local_batch();
        let handoff = (batch.has_effects() || unused.is_some()).then(|| {
            let handoff = guard.managed_local_handoff();
            handoff.close();
            handoff
        });
        drop(guard);
        drop(local_scope);
        if let Some(unused) = unused {
            unused.cancel();
        }
        let after_local = crate::exec_guard::run_after_local_batch(batch);
        if let Some(handoff) = handoff {
            handoff.reopen();
        }
        after_local.map_err(SnapbackError::from)?;
        match output {
            Ok(output) => Ok(AuthorizationWriteAttempt::Complete(output)),
            Err(payload) => std::panic::resume_unwind(payload),
        }
    })
    .await
    .expect("snapback authorization-write blocking task panicked")?;
    match attempted {
        AuthorizationWriteAttempt::Complete(output) => Ok(output),
        AuthorizationWriteAttempt::Stale => Err(authorization_reservation_stale(
            "authorization reservation became stale before the durable transaction; retry the complete write with short jitter",
        )),
    }
}

/// Run read-lane work (no global mutex) on a blocking-pool thread: the lane
/// still evals Hermes and reads SQLite, so it must not occupy a tokio worker.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6+L7.
pub(crate) async fn with_read_lane<T, F>(read: &crate::local::ReadLane, work: F) -> T
where
    F: FnOnce(&crate::local::ReadLane) -> T + Send + 'static,
    T: Send + 'static,
{
    let read = read.clone();
    tokio::task::spawn_blocking(move || {
        let _sanction = crate::exec_guard::BlockingSanction::acquire();
        work(&read)
    })
    .await
    .expect("read-lane blocking task panicked")
}
