//! Debug-build enforcement that blocking work — Hermes eval and SQLite — never
//! runs on a tokio async worker thread.
//!
//! The server's offload helpers (`with_snapback`, the read-lane runner) wrap
//! every core execution in a [`BlockingSanction`] on a `spawn_blocking` thread.
//! Chokepoints in the runtime and storage layers call
//! [`debug_assert_off_async_worker`]; a call that reaches them from inside a
//! tokio runtime context *without* the sanction is a handler running blocking
//! work on an async worker, and fails loudly in debug/test builds. Plain
//! threads (unit tests, the bench bin, direct library use) carry no tokio
//! context and pass untouched.
//!
//! @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L7: no
//! `ex_hermes_eval` or rusqlite call executes on a tokio worker.

use std::cell::{Cell, RefCell};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::diagnostic::SnapbackResult;

/// Highest auth lock rank forbidden inside a local SQLite write scope.
///
/// @ref LLP 0059#locking-and-linearization — topology, stream/session, and
///   registry locks must be released before entering the global app lane.
pub const AUTH_LOCK_RANK_CONNECTION_REGISTRY: u8 = 40;

pub type AfterLocalEffect = Box<dyn FnOnce() + Send + 'static>;
type CheckedAfterLocalEffect = Box<dyn FnOnce() -> SnapbackResult<()> + Send + 'static>;
type AfterLocalOwner = Box<dyn Send + 'static>;

enum AfterLocalWork {
    Infallible(AfterLocalEffect),
    Checked(CheckedAfterLocalEffect),
}

impl AfterLocalWork {
    fn run(self) -> SnapbackResult<()> {
        match self {
            Self::Infallible(effect) => {
                effect();
                Ok(())
            }
            Self::Checked(effect) => effect(),
        }
    }
}

pub struct AfterLocalBatch {
    effects: Vec<AfterLocalWork>,
    finalizers: Vec<AfterLocalWork>,
    owners: Vec<AfterLocalOwner>,
}

impl AfterLocalBatch {
    pub fn has_effects(&self) -> bool {
        !self.effects.is_empty() || !self.finalizers.is_empty()
    }
}

thread_local! {
    static BLOCKING_SANCTIONED: Cell<bool> = const { Cell::new(false) };
    static LOCAL_APP_WRITE_DEPTH: Cell<u32> = const { Cell::new(0) };
    static AFTER_LOCAL_EFFECTS: RefCell<Vec<AfterLocalWork>> = const { RefCell::new(Vec::new()) };
    static AFTER_LOCAL_FINALIZERS: RefCell<Vec<AfterLocalWork>> = const { RefCell::new(Vec::new()) };
    static AFTER_LOCAL_OWNERS: RefCell<Vec<AfterLocalOwner>> = const { RefCell::new(Vec::new()) };
}

/// Test-only observation that reservation hooks run outside the managed Local
/// scope. Reading the TLS counter takes no product lock.
#[cfg(any(test, feature = "test-support"))]
#[doc(hidden)]
pub fn local_snapback_write_scope_active_for_test() -> bool {
    LOCAL_APP_WRITE_DEPTH.with(|depth| depth.get() > 0)
}

/// Marks the current thread as sanctioned for blocking work until dropped.
/// Nested acquisition is harmless (restores the previous state).
pub struct BlockingSanction {
    previous: bool,
}

impl BlockingSanction {
    pub fn acquire() -> Self {
        let previous = BLOCKING_SANCTIONED.with(|flag| flag.replace(true));
        Self { previous }
    }
}

impl Drop for BlockingSanction {
    fn drop(&mut self) {
        let previous = self.previous;
        BLOCKING_SANCTIONED.with(|flag| flag.set(previous));
    }
}

/// Marks the blocking closure that owns the global `LocalSnapback` writer.
/// Auth lock-rank entry consults this independent scope so helper indirection
/// cannot hide a forbidden LocalSnapback -> stream/session/registry overlap.
pub struct LocalSnapbackWriteScope {
    outermost: bool,
    effects_taken: bool,
}

impl LocalSnapbackWriteScope {
    pub fn enter() -> Self {
        let outermost = LOCAL_APP_WRITE_DEPTH.with(|depth| {
            let outermost = depth.get() == 0;
            if outermost {
                AFTER_LOCAL_EFFECTS.with(|effects| {
                    debug_assert!(
                        effects.borrow().is_empty(),
                        "a previous LocalSnapback scope stranded after-Local effects"
                    );
                    effects.borrow_mut().clear();
                });
                AFTER_LOCAL_FINALIZERS.with(|finalizers| {
                    debug_assert!(
                        finalizers.borrow().is_empty(),
                        "a previous LocalSnapback scope stranded after-Local finalizers"
                    );
                    finalizers.borrow_mut().clear();
                });
                AFTER_LOCAL_OWNERS.with(|owners| {
                    debug_assert!(
                        owners.borrow().is_empty(),
                        "a previous LocalSnapback scope stranded after-Local owners"
                    );
                    owners.borrow_mut().clear();
                });
            }
            depth.set(
                depth
                    .get()
                    .checked_add(1)
                    .expect("LocalSnapback scope depth"),
            );
            outermost
        });
        Self {
            outermost,
            effects_taken: false,
        }
    }

    /// Transfer every effect prepared beneath the outer managed Local writer
    /// to its blocking owner. The owner must release both the Local guard and
    /// this scope before running the returned work.
    ///
    /// @ref LLP 0059#locking-and-linearization — committed process-local
    /// projection and notifier work is owned past request cancellation, but
    /// never takes an ephemeral lock beneath `LocalSnapback`.
    pub fn take_after_local_batch(&mut self) -> AfterLocalBatch {
        assert!(
            self.outermost,
            "only the outer LocalSnapback scope owns after-Local effects"
        );
        debug_assert_eq!(LOCAL_APP_WRITE_DEPTH.with(Cell::get), 1);
        self.effects_taken = true;
        let effects =
            AFTER_LOCAL_EFFECTS.with(|effects| std::mem::take(&mut *effects.borrow_mut()));
        let finalizers =
            AFTER_LOCAL_FINALIZERS.with(|finalizers| std::mem::take(&mut *finalizers.borrow_mut()));
        let owners = AFTER_LOCAL_OWNERS.with(|owners| std::mem::take(&mut *owners.borrow_mut()));
        AfterLocalBatch {
            effects,
            finalizers,
            owners,
        }
    }
}

impl Drop for LocalSnapbackWriteScope {
    fn drop(&mut self) {
        LOCAL_APP_WRITE_DEPTH.with(|depth| {
            depth.set(
                depth
                    .get()
                    .checked_sub(1)
                    .expect("LocalSnapback scope balance"),
            );
        });
        if self.outermost && !self.effects_taken {
            let stranded = AFTER_LOCAL_EFFECTS.with(|effects| {
                let stranded = effects.borrow().len();
                effects.borrow_mut().clear();
                stranded
            });
            let stranded_finalizers = AFTER_LOCAL_FINALIZERS.with(|finalizers| {
                let stranded = finalizers.borrow().len();
                finalizers.borrow_mut().clear();
                stranded
            });
            let stranded_owners = AFTER_LOCAL_OWNERS.with(|owners| {
                let stranded = owners.borrow().len();
                owners.borrow_mut().clear();
                stranded
            });
            debug_assert!(
                (stranded == 0 && stranded_finalizers == 0 && stranded_owners == 0)
                    || std::thread::panicking(),
                "managed LocalSnapback scope dropped with {stranded} effects, {stranded_finalizers} finalizers, and {stranded_owners} owners"
            );
        }
    }
}

/// Execute immediately for direct-library use, or transfer ownership to the
/// managed Local blocking scope. Managed callers flush only after releasing
/// their Local guard; cancellation of the awaiting request cannot cancel a
/// `spawn_blocking` owner that has already committed and queued this work.
pub fn run_or_defer_after_local(effect: impl FnOnce() + Send + 'static) {
    let effect: AfterLocalEffect = Box::new(effect);
    if LOCAL_APP_WRITE_DEPTH.with(Cell::get) == 0 {
        effect();
    } else {
        AFTER_LOCAL_EFFECTS.with(|effects| {
            effects
                .borrow_mut()
                .push(AfterLocalWork::Infallible(effect))
        });
    }
}

#[cfg(feature = "test-support")]
#[doc(hidden)]
pub fn deferred_after_local_effect_count_for_test() -> usize {
    assert!(
        LOCAL_APP_WRITE_DEPTH.with(Cell::get) != 0,
        "after-Local effect inventory requires an active LocalSnapback scope"
    );
    AFTER_LOCAL_EFFECTS.with(|effects| effects.borrow().len())
}

/// Execute a fallible process-local projection immediately for direct-library
/// use, or attach its result to the managed Local batch. The blocking owner
/// must inspect [`run_after_local_batch`] before acknowledging its operation.
///
/// Unlike a panic, a typed failure does not skip later ordinary effects or the
/// settlement finalizers. Authorization finalization can therefore retain its
/// exact dependency and latch fail-closed while returning the same refusal to
/// the initiating boundary.
pub fn run_or_defer_after_local_checked(
    effect: impl FnOnce() -> SnapbackResult<()> + Send + 'static,
) -> SnapbackResult<()> {
    let effect: CheckedAfterLocalEffect = Box::new(effect);
    if LOCAL_APP_WRITE_DEPTH.with(Cell::get) == 0 {
        effect()
    } else {
        AFTER_LOCAL_EFFECTS
            .with(|effects| effects.borrow_mut().push(AfterLocalWork::Checked(effect)));
        Ok(())
    }
}

/// Run an authorization settlement only after every ordinary successor
/// projection queued by the active Local scope. Storage commit hooks run
/// before the Local layer can queue reset, definition, issuer, and notifier
/// work; keeping settlement in a distinct final phase prevents those hooks
/// from reopening protected sinks over a partially published successor.
///
/// If an ordinary effect panics, this closure is dropped without running. The
/// exact authorization ticket therefore remains installed, deliberately
/// failing closed rather than publishing an incomplete successor.
pub fn run_or_defer_after_local_finalizer(finalizer: impl FnOnce() + Send + 'static) {
    let finalizer: AfterLocalEffect = Box::new(finalizer);
    if LOCAL_APP_WRITE_DEPTH.with(Cell::get) == 0 {
        finalizer();
    } else {
        AFTER_LOCAL_FINALIZERS.with(|finalizers| {
            finalizers
                .borrow_mut()
                .push(AfterLocalWork::Infallible(finalizer));
        });
    }
}

/// Checked counterpart to [`run_or_defer_after_local_finalizer`]. The
/// finalizer still runs only after every ordinary effect, and its typed failure
/// is returned by [`run_after_local_batch`] after the full checked batch has
/// had a chance to establish its fail-closed state.
pub fn run_or_defer_after_local_finalizer_checked(
    finalizer: impl FnOnce() -> SnapbackResult<()> + Send + 'static,
) -> SnapbackResult<()> {
    let finalizer: CheckedAfterLocalEffect = Box::new(finalizer);
    if LOCAL_APP_WRITE_DEPTH.with(Cell::get) == 0 {
        finalizer()
    } else {
        AFTER_LOCAL_FINALIZERS.with(|finalizers| {
            finalizers
                .borrow_mut()
                .push(AfterLocalWork::Checked(finalizer));
        });
        Ok(())
    }
}

/// Retain exact authority/admission ownership through every effect queued by
/// the active Local scope. Session/service terminal drains therefore cannot
/// pass a pre-cut fanout merely because its notifier wake was deferred.
pub fn retain_through_after_local(owner: impl Send + 'static) {
    if LOCAL_APP_WRITE_DEPTH.with(Cell::get) != 0 {
        AFTER_LOCAL_OWNERS.with(|owners| owners.borrow_mut().push(Box::new(owner)));
    }
}

pub fn local_write_scope_active() -> bool {
    LOCAL_APP_WRITE_DEPTH.with(Cell::get) != 0
}

#[must_use = "after-Local projection/finalization failures must reach the initiating boundary"]
pub fn run_after_local_batch(batch: AfterLocalBatch) -> SnapbackResult<()> {
    debug_assert_eq!(LOCAL_APP_WRITE_DEPTH.with(Cell::get), 0);
    let AfterLocalBatch {
        effects,
        finalizers,
        owners,
    } = batch;
    // Leaking exact owners on callback panic is intentionally fail-closed:
    // terminal mutation must not drain past a projection that did not finish.
    let mut owners = std::mem::ManuallyDrop::new(owners);
    let mut first_error = None;
    for effect in effects {
        if let Err(error) = effect.run()
            && first_error.is_none()
        {
            first_error = Some(error);
        }
    }
    for finalizer in finalizers {
        if let Err(error) = finalizer.run()
            && first_error.is_none()
        {
            first_error = Some(error);
        }
    }
    // SAFETY: this is the sole explicit drop, reached only after every effect.
    unsafe { std::mem::ManuallyDrop::drop(&mut owners) };
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

/// Logical continuation of the per-instance writer while committed
/// after-Local effects run. Physical Local ownership is released before any
/// ephemeral lock is acquired, but the next managed writer must wait until
/// the projection completes. A callback panic deliberately leaves this closed.
#[derive(Default)]
pub struct ManagedLocalHandoff {
    closed: AtomicBool,
    reopened: tokio::sync::Notify,
}

impl ManagedLocalHandoff {
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    pub fn close(&self) {
        let previous =
            self.closed
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire);
        assert_eq!(
            previous,
            Ok(false),
            "after-Local handoff was already closed"
        );
    }

    pub fn reopen(&self) {
        let previous = self.closed.swap(false, Ordering::AcqRel);
        assert!(previous, "after-Local handoff was not closed");
        self.reopened.notify_waiters();
    }

    pub async fn wait_until_open(self: Arc<Self>) {
        loop {
            let changed = self.reopened.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if !self.is_closed() {
                return;
            }
            changed.await;
        }
    }
}

/// Debug/test enforcement for LLP 0059's unconditional prohibited-overlap
/// rule. Mode admission (rank 50) remains allowed across a SQLite commit; the
/// topology, stream/session leaves, and exact registry (ranks 10 through 40)
/// must be released before the global app/SQLite lane is entered.
#[track_caller]
pub fn debug_assert_auth_lock_outside_local_snapback(rank: u8) {
    #[cfg(debug_assertions)]
    if rank <= AUTH_LOCK_RANK_CONNECTION_REGISTRY && LOCAL_APP_WRITE_DEPTH.with(Cell::get) != 0 {
        panic!(
            "auth rank {rank} entered while LocalSnapback write scope was active; stage the effect before the bounded auth handoff (LLP 0059)"
        );
    }
    #[cfg(not(debug_assertions))]
    let _ = rank;
}

/// Ephemeral connection teardown takes activity, room, notifier, outbox, and
/// rate-bucket locks. It must be completed before entering the global Local
/// writer so neither side can invert the other through a transport callback.
#[track_caller]
pub fn debug_assert_local_snapback_write_scope_inactive(what: &str) {
    #[cfg(debug_assertions)]
    if LOCAL_APP_WRITE_DEPTH.with(Cell::get) != 0 {
        panic!(
            "{what} entered while LocalSnapback write scope was active; split ephemeral teardown from Local topology cleanup (LLP 0059)"
        );
    }
    #[cfg(not(debug_assertions))]
    let _ = what;
}

/// Debug assertion: the caller is about to run blocking work (an engine eval or
/// a SQLite call), which must not happen on a tokio async worker. Sanctioned
/// blocking-pool threads and non-tokio threads pass. Current-thread runtimes
/// (`#[tokio::test]` default) also pass: blocking there stalls only the
/// caller's own single-threaded runtime — the hazard this guards against is
/// starving the shared workers of the server's multi-thread runtime.
#[track_caller]
pub fn debug_assert_off_async_worker(what: &str) {
    #[cfg(debug_assertions)]
    {
        let on_multi_thread_runtime = tokio::runtime::Handle::try_current()
            .map(|handle| handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread)
            .unwrap_or(false);
        if on_multi_thread_runtime && !BLOCKING_SANCTIONED.with(Cell::get) {
            panic!(
                "{what} would block a tokio async worker; route it through the \
                 blocking offload helpers (LLP 0032 L7)"
            );
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = what;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn checked_batch_runs_every_phase_and_returns_the_first_error() {
        let order = Arc::new(Mutex::new(Vec::new()));
        let mut scope = LocalSnapbackWriteScope::enter();

        let first_order = order.clone();
        run_or_defer_after_local_checked(move || {
            first_order.lock().unwrap().push("effect-error");
            Err(crate::diagnostic::SnapbackError::error(
                "FIRST_AFTER_LOCAL_FAILURE",
                "auth",
                "first checked failure",
            ))
        })
        .unwrap();
        let later_order = order.clone();
        run_or_defer_after_local_checked(move || {
            later_order.lock().unwrap().push("effect-later");
            Ok(())
        })
        .unwrap();
        let finalizer_order = order.clone();
        run_or_defer_after_local_finalizer_checked(move || {
            finalizer_order.lock().unwrap().push("finalizer-error");
            Err(crate::diagnostic::SnapbackError::error(
                "LATER_AFTER_LOCAL_FAILURE",
                "auth",
                "later checked failure",
            ))
        })
        .unwrap();

        let batch = scope.take_after_local_batch();
        drop(scope);
        let error = run_after_local_batch(batch).expect_err("checked batch must fail");
        assert_eq!(error.diagnostic.code, "FIRST_AFTER_LOCAL_FAILURE");
        assert_eq!(
            *order.lock().unwrap(),
            vec!["effect-error", "effect-later", "finalizer-error"]
        );
    }
}
