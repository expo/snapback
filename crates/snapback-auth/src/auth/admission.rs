//! Process-local admission epochs for auth-mode transitions.
//!
//! A durable auth-mode generation is not sufficient to fence work already in
//! memory: a timed-out handler can still hold buffered writes or a response.
//! This module pairs that durable generation with a process-monotonic epoch,
//! counts each root admission exactly once, and makes every effect acquire the
//! same mutex used to retire an epoch.

// @ref LLP 0058#stage-ordering — staging closes admission, waits at one exact
// monotonic deadline, and retires/cancels the old epoch without killing a thread.
// @ref LLP 0058#gate-algorithm — commit and publication revalidate both the
// durable transition generation and process-local admission epoch atomically.

use crate::auth::mode::{AppDataAvailability, AuthModeStateRecord, AuthModeStatus};
use crate::auth::session_projection::{AUTH_LOCK_RANK_MODE_ADMISSION, AuthLockRankGuard};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::AuthMode;
use std::collections::BTreeMap;
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

pub const AUTH_MODE_QUIESCENCE_TIMEOUT_MS: u64 = 30_000;

static NEXT_ADMISSION_EPOCH: AtomicU64 = AtomicU64::new(1);

type CancellationHook = Arc<dyn Fn() + Send + Sync + 'static>;

#[derive(Default)]
struct CancellationState {
    cancelled: bool,
    next_hook: u64,
    hook_ids_exhausted: bool,
    hooks: BTreeMap<u64, CancellationHook>,
}

struct CancellationSignal {
    state: Mutex<CancellationState>,
    changed: tokio::sync::Notify,
}

impl Default for CancellationSignal {
    fn default() -> Self {
        Self {
            state: Mutex::new(CancellationState::default()),
            changed: tokio::sync::Notify::new(),
        }
    }
}

impl CancellationSignal {
    fn is_cancelled(&self) -> bool {
        lock(&self.state).cancelled
    }

    fn register(self: &Arc<Self>, hook: CancellationHook) -> CancellationRegistration {
        let mut state = lock(&self.state);
        if state.cancelled {
            drop(state);
            hook();
            return CancellationRegistration::inactive();
        }
        if state.hook_ids_exhausted {
            // Reusing a hook id could let an older registration remove a new
            // cancellation hook. Exhaustion therefore cancels the whole
            // signal permanently and invokes every callback fail-closed.
            state.cancelled = true;
            let hooks = std::mem::take(&mut state.hooks);
            drop(state);
            self.changed.notify_waiters();
            for registered in hooks.into_values() {
                registered();
            }
            hook();
            return CancellationRegistration::inactive();
        }
        let id = state.next_hook;
        match state.next_hook.checked_add(1) {
            Some(next) => state.next_hook = next,
            None => state.hook_ids_exhausted = true,
        }
        state.hooks.insert(id, hook);
        CancellationRegistration {
            signal: Some(self.clone()),
            id,
        }
    }

    fn cancel(&self) {
        let hooks = {
            let mut state = lock(&self.state);
            if state.cancelled {
                return;
            }
            // Mark and detach under the linearization mutex, then invoke
            // arbitrary callbacks outside it. A callback may safely observe
            // cancellation or tear down another registration without
            // re-entering this mutex and deadlocking.
            state.cancelled = true;
            std::mem::take(&mut state.hooks)
        };
        self.changed.notify_waiters();
        for hook in hooks.into_values() {
            hook();
        }
    }
}

/// RAII removal for a cooperative/engine cancellation callback.
pub struct CancellationRegistration {
    signal: Option<Arc<CancellationSignal>>,
    id: u64,
}

impl CancellationRegistration {
    fn inactive() -> Self {
        Self {
            signal: None,
            id: 0,
        }
    }
}

impl Drop for CancellationRegistration {
    fn drop(&mut self) {
        if let Some(signal) = self.signal.take() {
            lock(&signal.state).hooks.remove(&self.id);
        }
    }
}

struct EpochState {
    transition_generation: u64,
    active_mode: AuthMode,
    accepting: bool,
    retired: bool,
    transition_owned: bool,
    in_flight: usize,
    /// How many of the `in_flight` roots are the transition's own private
    /// projection admission (0 or 1). Publication effect guards clone that
    /// lease into the after-Local owner retention, so the root can outlive
    /// the commit closure; the committed-carrier check must be able to prove
    /// "every remaining root is the transition's own" without treating those
    /// retained clones as foreign admitted work.
    projection_in_flight: usize,
    cancellation: Arc<CancellationSignal>,
}

struct AdmissionState {
    current_epoch: u64,
    epochs: BTreeMap<u64, EpochState>,
}

struct AdmissionInner {
    state: Mutex<AdmissionState>,
    drained: Condvar,
    changed: tokio::sync::Notify,
}

/// One app instance's process-local admission authority.
#[derive(Clone)]
pub struct AdmissionController {
    inner: Arc<AdmissionInner>,
}

/// Opaque identity for the process-local admission graph that minted a
/// lease. Authority resolvers retain this value so invocation preparation
/// can compare provenance by pointer identity instead of trusting matching
/// mode counters supplied by a caller.
#[derive(Clone)]
pub struct AdmissionLeaseOrigin {
    controller: Arc<AdmissionInner>,
}

impl fmt::Debug for AdmissionLeaseOrigin {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AdmissionLeaseOrigin")
            .finish_non_exhaustive()
    }
}

impl PartialEq for AdmissionLeaseOrigin {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.controller, &other.controller)
    }
}

impl Eq for AdmissionLeaseOrigin {}

impl AdmissionLeaseOrigin {
    /// Whether `lease` was minted by the exact controller retained by this
    /// opaque origin. Counter equality is deliberately irrelevant.
    pub fn owns(&self, lease: &AdmissionLease) -> bool {
        lease
            .token
            .controller
            .as_ref()
            .is_some_and(|controller| Arc::ptr_eq(controller, &self.controller))
    }
}

/// Public semantic name used by server composition.
pub type AuthAdmissionController = AdmissionController;

#[derive(Debug)]
pub enum ModeCommitFailure {
    RolledBack(SnapbackError),
    Uncertain(SnapbackError),
}

impl ModeCommitFailure {
    pub fn into_error(self) -> SnapbackError {
        match self {
            Self::RolledBack(error) | Self::Uncertain(error) => error,
        }
    }
}

impl fmt::Debug for AdmissionController {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let state = lock(&self.inner.state);
        let current = state
            .epochs
            .get(&state.current_epoch)
            .expect("current admission epoch exists");
        formatter
            .debug_struct("AdmissionController")
            .field("epoch", &state.current_epoch)
            .field("transition_generation", &current.transition_generation)
            .field("active_mode", &current.active_mode)
            .field("accepting", &current.accepting)
            .field("in_flight", &current.in_flight)
            .finish()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AdmissionSnapshot {
    pub transition_generation: u64,
    pub admission_epoch: u64,
    pub active_mode: AuthMode,
    pub accepting: bool,
    pub in_flight: usize,
}

impl AdmissionController {
    /// Retain the exact process-local origin used to correlate a later
    /// resolved authority with its admission lease.
    pub fn lease_origin(&self) -> AdmissionLeaseOrigin {
        AdmissionLeaseOrigin {
            controller: self.inner.clone(),
        }
    }

    /// Prove that a lease was minted by this exact process-local controller.
    /// Composition uses this before preparing authority off the writer lane;
    /// matching counters alone are never admission evidence.
    #[doc(hidden)]
    pub fn owns_lease(&self, lease: &AdmissionLease) -> bool {
        lease
            .token
            .controller
            .as_ref()
            .is_some_and(|controller| Arc::ptr_eq(controller, &self.inner))
    }

    /// Exact process-local identity for passive commit-boundary tests. The
    /// pointer is compared only while this controller remains owned by the
    /// test scope; it is never authorization evidence or a production token.
    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn effect_guard_identity_for_test(
        &self,
        admission_epoch: u64,
    ) -> snapback_kernel::storage::AdmissionEffectGuardIdentityForTest {
        snapback_kernel::storage::admission_effect_guard_identity_for_test(
            Arc::as_ptr(&self.inner) as usize,
            admission_epoch,
        )
    }

    /// Construct a dev-mode controller. This compatibility constructor is
    /// intentionally narrow; production composition should prefer
    /// [`Self::from_mode_state`] so the epoch binds the exact durable mode.
    pub fn new(transition_generation: u64, accepting: bool) -> SnapbackResult<Self> {
        Self::new_for_mode(transition_generation, AuthMode::Dev, accepting)
    }

    pub fn from_mode_state(mode: &AuthModeStateRecord) -> SnapbackResult<Self> {
        Self::from_mode_state_with_migration_fence(mode, false)
    }

    /// Construction with the durable migration fence consulted: a process
    /// that opens over a database whose migration journal is non-terminal
    /// starts with admission closed on every lane, exactly as if the
    /// barrier had never been dropped (LLP 0081 §4 — a crash between
    /// reopen and resume cannot readmit application traffic).
    pub fn from_mode_state_with_migration_fence(
        mode: &AuthModeStateRecord,
        migration_fenced: bool,
    ) -> SnapbackResult<Self> {
        mode.validate_shape()?;
        let accepting = mode.mode_state == AuthModeStatus::Settled
            && mode.app_data_availability == AppDataAvailability::Available
            && !migration_fenced;
        Self::new_for_mode(mode.transition_generation, mode.active, accepting)
    }

    fn new_for_mode(
        transition_generation: u64,
        active_mode: AuthMode,
        accepting: bool,
    ) -> SnapbackResult<Self> {
        let epoch = next_admission_epoch()?;
        let mut epochs = BTreeMap::new();
        epochs.insert(
            epoch,
            EpochState {
                transition_generation,
                active_mode,
                accepting,
                retired: false,
                transition_owned: false,
                in_flight: 0,
                projection_in_flight: 0,
                cancellation: Arc::new(CancellationSignal::default()),
            },
        );
        Ok(Self {
            inner: Arc::new(AdmissionInner {
                state: Mutex::new(AdmissionState {
                    current_epoch: epoch,
                    epochs,
                }),
                drained: Condvar::new(),
                changed: tokio::sync::Notify::new(),
            }),
        })
    }

    pub fn snapshot(&self) -> AdmissionSnapshot {
        let state = lock(&self.inner.state);
        snapshot(&state)
    }

    /// Observation-only alias for handshake and diagnostics paths. It does
    /// not admit app-data work and therefore cannot accidentally create a root
    /// while the durable mode is pending or quarantined.
    pub fn diagnostic_snapshot(&self) -> AdmissionSnapshot {
        self.snapshot()
    }

    /// Await an epoch, mode, or open/closed posture change without polling.
    /// The notification future is registered before observing state, so a
    /// transition cannot be lost between the check and the await.
    pub async fn changed(&self, previous: AdmissionSnapshot) -> AdmissionSnapshot {
        loop {
            let mut changed = Box::pin(self.inner.changed.notified());
            changed.as_mut().enable();
            let observed = self.snapshot();
            if observed.transition_generation != previous.transition_generation
                || observed.admission_epoch != previous.admission_epoch
                || observed.active_mode != previous.active_mode
                || observed.accepting != previous.accepting
            {
                return observed;
            }
            changed.await;
        }
    }

    /// Pre-bind reconciliation after startup stage/consume/unstage changed the
    /// durable mode record constructed before server composition. No admitted
    /// work may exist; synchronization always advances to a fresh process
    /// epoch and exactly mirrors the final durable generation/availability.
    pub fn synchronize_mode_state(
        &self,
        mode: &AuthModeStateRecord,
    ) -> SnapbackResult<AdmissionSnapshot> {
        mode.validate_shape()?;
        let accepting = mode.mode_state == AuthModeStatus::Settled
            && mode.app_data_availability == AppDataAvailability::Available;
        self.synchronize_generation(mode.transition_generation, mode.active, accepting)
    }

    fn synchronize_generation(
        &self,
        transition_generation: u64,
        active_mode: AuthMode,
        accepting: bool,
    ) -> SnapbackResult<AdmissionSnapshot> {
        let (epoch, old_generation) = {
            let mut state = lock(&self.inner.state);
            let epoch = state.current_epoch;
            let current = state
                .epochs
                .get_mut(&epoch)
                .expect("current admission epoch exists");
            if current.transition_generation == transition_generation
                && current.active_mode == active_mode
                && current.accepting == accepting
            {
                return Ok(snapshot(&state));
            }
            if current.in_flight != 0 || current.retired || current.transition_owned {
                return Err(admission_closed());
            }
            current.accepting = false;
            current.transition_owned = true;
            self.inner.changed.notify_waiters();
            (epoch, current.transition_generation)
        };
        self.retire_and_reopen(
            epoch,
            old_generation,
            transition_generation,
            active_mode,
            accepting,
        )
    }

    /// Admit one finite root operation. Cloning the returned lease shares the
    /// root token and therefore does not inflate the in-flight count.
    pub fn admit(&self) -> SnapbackResult<AdmissionLease> {
        let mut state = lock(&self.inner.state);
        self.admit_locked(&mut state, None)
    }

    /// Admit a legacy dev-only entry. A settled Sessions epoch is accepting
    /// for authenticated app traffic, but it can never mint dev authority.
    pub fn admit_dev(&self) -> SnapbackResult<AdmissionLease> {
        let mut state = lock(&self.inner.state);
        self.admit_locked(&mut state, Some(AuthMode::Dev))
    }

    /// Admit only when the currently published durable mode is the expected
    /// one. This prevents an authority resolved for one mode from being paired
    /// with a lease from another.
    pub fn admit_for_mode(&self, mode: AuthMode) -> SnapbackResult<AdmissionLease> {
        let mut state = lock(&self.inner.state);
        self.admit_locked(&mut state, Some(mode))
    }

    /// Admit the bootstrap diagnostic on a stable, non-transition-owned
    /// epoch. Unlike ordinary app admission this may enter a deliberately
    /// closed pending epoch, but it is still counted and cancelled so the
    /// final response cannot mix authority facts from different epochs.
    ///
    /// @ref LLP 0059#handshake-and-readiness — diagnostic
    /// availability does not permit an uncounted handshake response.
    pub fn admit_diagnostic_for_mode(&self, mode: AuthMode) -> SnapbackResult<AdmissionLease> {
        let mut state = lock(&self.inner.state);
        let epoch = state.current_epoch;
        let current = state
            .epochs
            .get_mut(&epoch)
            .expect("current admission epoch exists");
        if current.retired || current.transition_owned {
            return Err(admission_closed());
        }
        if current.active_mode != mode {
            return Err(mode_mismatch(mode, current.active_mode));
        }
        current.in_flight = current.in_flight.checked_add(1).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_MODE_STATE_CORRUPT",
                "auth",
                "process admission count overflowed",
            )
        })?;
        Ok(AdmissionLease {
            token: Arc::new(LeaseToken {
                controller: Some(self.inner.clone()),
                transition_generation: current.transition_generation,
                admission_epoch: epoch,
                active_mode: Some(current.active_mode),
                cancellation: current.cancellation.clone(),
                diagnostic: true,
                projection: false,
            }),
        })
    }

    /// Retire/cancel the current accepting epoch after an ambiguous same-mode
    /// durable commit. The process must restart and re-read durable state; it
    /// must never keep serving from an in-memory predecessor it can no longer
    /// prove matches storage.
    pub fn fail_closed_after_uncertain_commit(&self) -> SnapbackResult<AdmissionSnapshot> {
        // Exhausting the process-wide epoch allocator must itself fail closed:
        // retire the current epoch even when no fresh diagnostic epoch can be
        // named. Restart is already required in this posture.
        let new_epoch = next_admission_epoch().ok();
        let cancellation = {
            let mut state = lock(&self.inner.state);
            let old_epoch = state.current_epoch;
            let old = state
                .epochs
                .get_mut(&old_epoch)
                .expect("current admission epoch exists");
            if old.retired || old.transition_owned {
                return Err(admission_closed());
            }
            let generation = old.transition_generation;
            let active_mode = old.active_mode;
            old.retired = true;
            old.accepting = false;
            let cancellation = old.cancellation.clone();
            if let Some(new_epoch) = new_epoch {
                state.epochs.insert(
                    new_epoch,
                    EpochState {
                        transition_generation: generation,
                        active_mode,
                        accepting: false,
                        retired: false,
                        transition_owned: false,
                        in_flight: 0,
                        projection_in_flight: 0,
                        cancellation: Arc::new(CancellationSignal::default()),
                    },
                );
                state.current_epoch = new_epoch;
            }
            self.inner.drained.notify_all();
            self.inner.changed.notify_waiters();
            cancellation
        };
        cancellation.cancel();
        Ok(self.snapshot())
    }

    fn admit_locked(
        &self,
        state: &mut AdmissionState,
        required_mode: Option<AuthMode>,
    ) -> SnapbackResult<AdmissionLease> {
        let epoch = state.current_epoch;
        let current = state
            .epochs
            .get_mut(&epoch)
            .expect("current admission epoch exists");
        if !current.accepting || current.retired {
            return Err(admission_closed());
        }
        if required_mode.is_some_and(|mode| mode != current.active_mode) {
            return Err(mode_mismatch(
                required_mode.expect("checked mode"),
                current.active_mode,
            ));
        }
        current.in_flight = current.in_flight.checked_add(1).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_MODE_STATE_CORRUPT",
                "auth",
                "process admission count overflowed",
            )
        })?;
        Ok(AdmissionLease {
            token: Arc::new(LeaseToken {
                controller: Some(self.inner.clone()),
                transition_generation: current.transition_generation,
                admission_epoch: epoch,
                active_mode: Some(current.active_mode),
                cancellation: current.cancellation.clone(),
                diagnostic: false,
                projection: false,
            }),
        })
    }

    /// Wait until a transition has published a fresh accepting epoch, then
    /// acquire one finite root. Socket resume/retry loops use this instead of
    /// retaining an authority from the suspended epoch.
    pub fn wait_for_fresh_admission(&self, previous_epoch: u64) -> SnapbackResult<AdmissionLease> {
        let mut state = lock(&self.inner.state);
        loop {
            let current = state
                .epochs
                .get(&state.current_epoch)
                .expect("current admission epoch exists");
            if state.current_epoch != previous_epoch {
                return if current.accepting && !current.retired {
                    self.admit_locked(&mut state, None)
                } else {
                    Err(admission_closed())
                };
            }
            state = self
                .inner
                .drained
                .wait(state)
                .unwrap_or_else(PoisonError::into_inner);
        }
    }

    pub async fn wait_for_fresh_admission_async(
        &self,
        previous_epoch: u64,
    ) -> SnapbackResult<AdmissionLease> {
        loop {
            let mut changed = Box::pin(self.inner.changed.notified());
            changed.as_mut().enable();
            let observed = self.snapshot();
            if observed.admission_epoch != previous_epoch {
                return if observed.accepting {
                    self.admit()
                } else {
                    Err(admission_closed())
                };
            }
            changed.await;
        }
    }

    /// Wait without polling until any accepting epoch is available and admit
    /// one finite root. Mode mismatch remains a terminal error rather than
    /// waiting for an unrelated future deployment.
    pub async fn admit_or_wait(&self) -> SnapbackResult<AdmissionLease> {
        loop {
            let mut changed = Box::pin(self.inner.changed.notified());
            changed.as_mut().enable();
            match self.admit() {
                Ok(lease) => return Ok(lease),
                Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_MODE_PENDING" => {
                    changed.await;
                }
                Err(error) => return Err(error),
            }
        }
    }

    pub async fn admit_mode_or_wait(&self, mode: AuthMode) -> SnapbackResult<AdmissionLease> {
        loop {
            let mut changed = Box::pin(self.inner.changed.notified());
            changed.as_mut().enable();
            match self.admit_for_mode(mode) {
                Ok(lease) => return Ok(lease),
                Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_MODE_PENDING" => {
                    changed.await;
                }
                Err(error) => return Err(error),
            }
        }
    }

    /// Close the current epoch and wait for its finite root leases to drain.
    /// The public path always uses the exact normative 30,000 ms deadline.
    pub fn begin_transition(&self) -> SnapbackResult<ModeTransitionGuard> {
        self.begin_transition_with_suspend_and_timeout(
            || Ok(()),
            Duration::from_millis(AUTH_MODE_QUIESCENCE_TIMEOUT_MS),
        )
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn begin_transition_for_test(
        &self,
        timeout: Duration,
    ) -> SnapbackResult<ModeTransitionGuard> {
        self.begin_transition_with_suspend_and_timeout(|| Ok(()), timeout)
    }

    /// Async server entry: close admission, synchronously suspend existing
    /// live boundaries, then drain on a blocking worker. The callback must be
    /// finite and must not wait for an invocation to finish.
    pub async fn begin_transition_async<S>(
        &self,
        suspend_live: S,
    ) -> SnapbackResult<ModeTransitionGuard>
    where
        S: FnOnce() -> SnapbackResult<()> + Send + 'static,
    {
        let controller = self.clone();
        tokio::task::spawn_blocking(move || {
            controller.begin_transition_with_suspend_and_timeout(
                suspend_live,
                Duration::from_millis(AUTH_MODE_QUIESCENCE_TIMEOUT_MS),
            )
        })
        .await
        .map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT",
                "auth",
                "auth-mode admission worker terminated before producing a transition guard",
            )
        })?
    }

    fn begin_transition_with_suspend_and_timeout<S>(
        &self,
        suspend_live: S,
        timeout: Duration,
    ) -> SnapbackResult<ModeTransitionGuard>
    where
        S: FnOnce() -> SnapbackResult<()>,
    {
        let mut state = lock(&self.inner.state);
        let epoch = state.current_epoch;
        let current = state
            .epochs
            .get_mut(&epoch)
            .expect("current admission epoch exists");
        if current.retired || current.transition_owned {
            return Err(admission_closed());
        }
        let reopen_on_abort = current.accepting;
        let active_mode = current.active_mode;
        current.accepting = false;
        current.transition_owned = true;
        let generation = current.transition_generation;
        self.inner.changed.notify_waiters();
        drop(state);
        // The normative quiescence window begins only after admission is
        // observably closed. Waiting to acquire the gate mutex (for example,
        // behind a commit effect guard) must not consume the drain budget.
        let deadline = Instant::now().checked_add(timeout).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_MODE_STATE_CORRUPT",
                "auth",
                "auth-mode quiescence deadline cannot be represented",
            )
        })?;

        if let Err(error) = suspend_live() {
            self.retire_and_reopen(epoch, generation, generation, active_mode, reopen_on_abort)?;
            return Err(error);
        }
        let mut state = lock(&self.inner.state);

        loop {
            let in_flight = state
                .epochs
                .get(&epoch)
                .expect("closing admission epoch exists")
                .in_flight;
            if in_flight == 0 {
                return Ok(ModeTransitionGuard {
                    controller: self.clone(),
                    admission_epoch: epoch,
                    transition_generation: generation,
                    active_mode,
                    reopen_on_abort,
                    finished: false,
                });
            }

            let now = Instant::now();
            if now >= deadline {
                drop(state);
                self.retire_and_reopen(
                    epoch,
                    generation,
                    generation,
                    active_mode,
                    reopen_on_abort,
                )?;
                return Err(quiescence_timeout());
            }
            let remaining = deadline.saturating_duration_since(now);
            let (next, waited) = self
                .inner
                .drained
                .wait_timeout(state, remaining)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state = next;
            if waited.timed_out()
                && state
                    .epochs
                    .get(&epoch)
                    .is_some_and(|current| current.in_flight > 0)
            {
                drop(state);
                self.retire_and_reopen(
                    epoch,
                    generation,
                    generation,
                    active_mode,
                    reopen_on_abort,
                )?;
                return Err(quiescence_timeout());
            }
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn retire_current_epoch_for_test(&self) -> SnapbackResult<ModeTransitionGuard> {
        self.begin_transition_with_suspend_and_timeout(|| Ok(()), Duration::ZERO)
    }

    /// Behavioral test seam for proving an effect guard owns the admission
    /// state mutex. A false result means another owner currently holds the
    /// mutex; a free poisoned mutex is available because production admission
    /// deliberately recovers poison through `lock`.
    ///
    /// This stays behind the explicit, non-default `test-support` feature so
    /// cross-crate engine and server unit tests can observe the auth-owned
    /// mutex when `snapback-auth` is compiled as their dependency.
    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn state_mutex_available_for_test(&self) -> bool {
        match self.inner.state.try_lock() {
            Ok(_) | Err(std::sync::TryLockError::Poisoned(_)) => true,
            Err(std::sync::TryLockError::WouldBlock) => false,
        }
    }

    fn retire_and_reopen(
        &self,
        old_epoch: u64,
        expected_generation: u64,
        new_generation: u64,
        new_active_mode: AuthMode,
        accepting: bool,
    ) -> SnapbackResult<AdmissionSnapshot> {
        let new_epoch = next_admission_epoch()?;
        let cancellation = {
            let mut state = lock(&self.inner.state);
            if state.current_epoch != old_epoch {
                return Err(admission_closed());
            }
            let old = state
                .epochs
                .get_mut(&old_epoch)
                .expect("transition admission epoch exists");
            if old.transition_generation != expected_generation
                || old.retired
                || !old.transition_owned
            {
                return Err(admission_closed());
            }
            old.retired = true;
            old.accepting = false;
            old.transition_owned = false;
            let cancellation = old.cancellation.clone();
            state.epochs.insert(
                new_epoch,
                EpochState {
                    transition_generation: new_generation,
                    active_mode: new_active_mode,
                    accepting,
                    retired: false,
                    transition_owned: false,
                    in_flight: 0,
                    projection_in_flight: 0,
                    cancellation: Arc::new(CancellationSignal::default()),
                },
            );
            state.current_epoch = new_epoch;
            self.inner.drained.notify_all();
            self.inner.changed.notify_waiters();
            cancellation
        };
        cancellation.cancel();
        Ok(self.snapshot())
    }
}

/// A counted root admission. Its clones share one `LeaseToken`.
#[derive(Clone)]
pub struct AdmissionLease {
    token: Arc<LeaseToken>,
}

impl fmt::Debug for AdmissionLease {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AdmissionLease")
            .field("transition_generation", &self.transition_generation())
            .field("admission_epoch", &self.admission_epoch())
            .field("cancelled", &self.is_cancelled())
            .finish()
    }
}

struct LeaseToken {
    controller: Option<Arc<AdmissionInner>>,
    transition_generation: u64,
    admission_epoch: u64,
    active_mode: Option<AuthMode>,
    cancellation: Arc<CancellationSignal>,
    diagnostic: bool,
    /// True only for the transition's private projection root minted by
    /// `admit_transition_projection`. Counted separately so the committed
    /// carrier can prove no *foreign* root is in flight while publication
    /// owners still retain clones of this root.
    projection: bool,
}

impl Drop for LeaseToken {
    fn drop(&mut self) {
        let Some(controller) = &self.controller else {
            return;
        };
        let mut state = lock(&controller.state);
        let mut remove = false;
        if let Some(epoch) = state.epochs.get_mut(&self.admission_epoch) {
            epoch.in_flight = epoch.in_flight.saturating_sub(1);
            if self.projection {
                epoch.projection_in_flight = epoch.projection_in_flight.saturating_sub(1);
            }
            remove = epoch.retired && epoch.in_flight == 0;
        }
        if remove && state.current_epoch != self.admission_epoch {
            state.epochs.remove(&self.admission_epoch);
        }
        controller.drained.notify_all();
    }
}

impl AdmissionLease {
    /// Retain the process-local controller identity carried by a managed
    /// lease. Diagnostic/unmanaged test leases intentionally have no origin
    /// and therefore cannot be joined to resolved session or service facts.
    pub fn origin(&self) -> Option<AdmissionLeaseOrigin> {
        self.token
            .controller
            .as_ref()
            .map(|controller| AdmissionLeaseOrigin {
                controller: controller.clone(),
            })
    }

    /// Compatibility bridge for call sites the HTTP composition lane has not
    /// yet moved onto the app's controller. Such a lease carries the exact
    /// fields but deliberately cannot claim to participate in quiescence.
    #[cfg(any(test, feature = "test-support"))]
    pub fn unmanaged(transition_generation: u64, admission_epoch: u64) -> Self {
        Self {
            token: Arc::new(LeaseToken {
                controller: None,
                transition_generation,
                admission_epoch,
                active_mode: None,
                cancellation: Arc::new(CancellationSignal::default()),
                diagnostic: false,
                projection: false,
            }),
        }
    }

    pub fn transition_generation(&self) -> u64 {
        self.token.transition_generation
    }

    pub fn admission_epoch(&self) -> u64 {
        self.token.admission_epoch
    }

    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn effect_guard_identity_for_test(
        &self,
    ) -> Option<snapback_kernel::storage::AdmissionEffectGuardIdentityForTest> {
        self.token.controller.as_ref().map(|controller| {
            snapback_kernel::storage::admission_effect_guard_identity_for_test(
                Arc::as_ptr(controller) as usize,
                self.token.admission_epoch,
            )
        })
    }

    /// Exact durable active mode bound to a managed root. Compatibility-only
    /// unmanaged leases return `None` and must not enter production paths.
    pub fn active_mode(&self) -> Option<AuthMode> {
        self.token.active_mode
    }

    pub fn require_mode(&self, expected: AuthMode) -> SnapbackResult<()> {
        if let Some(observed) = self.active_mode()
            && observed != expected
        {
            return Err(mode_mismatch(expected, observed));
        }
        Ok(())
    }

    pub fn is_cancelled(&self) -> bool {
        self.token.cancellation.is_cancelled()
    }

    pub fn is_diagnostic(&self) -> bool {
        self.token.diagnostic
    }

    /// Complete once retirement cancels this exact admitted epoch. Callers
    /// can `select!` this against response/socket I/O without polling.
    pub async fn cancelled(&self) {
        loop {
            let mut changed = Box::pin(self.token.cancellation.changed.notified());
            changed.as_mut().enable();
            if self.is_cancelled() {
                return;
            }
            changed.await;
        }
    }

    pub fn register_cancellation_hook(
        &self,
        hook: impl Fn() + Send + Sync + 'static,
    ) -> CancellationRegistration {
        self.token.cancellation.register(Arc::new(hook))
    }

    /// Cooperative check for computation, host-call, and nested-entry seams.
    pub fn validate(&self, effect: &'static str) -> SnapbackResult<()> {
        let Some(controller) = &self.token.controller else {
            return Ok(());
        };
        let state = lock(&controller.state);
        validate_lease(&state, self, effect)
    }

    /// Atomic effect check. Keep this guard alive across a SQLite commit,
    /// response send/enqueue, or live publication; epoch retirement uses the
    /// same mutex and therefore cannot cross that effect's linearization cut.
    pub fn effect_guard(&self, effect: &'static str) -> SnapbackResult<AdmissionEffectGuard<'_>> {
        let Some(controller) = &self.token.controller else {
            let guard = AdmissionEffectGuard {
                state: None,
                _rank: None,
                #[cfg(any(test, feature = "test-support"))]
                proof_identity: None,
            };
            crate::exec_guard::retain_through_after_local(self.clone());
            return Ok(guard);
        };
        let rank = AuthLockRankGuard::enter(AUTH_LOCK_RANK_MODE_ADMISSION);
        let state = lock(&controller.state);
        validate_lease(&state, self, effect)?;
        let guard = AdmissionEffectGuard {
            state: Some(state),
            _rank: Some(rank),
            #[cfg(any(test, feature = "test-support"))]
            proof_identity: Some(
                snapback_kernel::storage::admission_effect_guard_identity_for_test(
                    Arc::as_ptr(controller) as usize,
                    self.token.admission_epoch,
                ),
            ),
        };
        #[cfg(any(test, feature = "test-support"))]
        snapback_kernel::storage::enter_admission_effect_guard_for_test(
            guard
                .proof_identity
                .expect("managed admission guard has a proof identity"),
        );
        crate::exec_guard::retain_through_after_local(self.clone());
        Ok(guard)
    }
}

/// Whether this thread owns the exact controller/epoch admission-effect guard.
///
/// This is test instrumentation, not an authorization API. In particular it
/// reads only guard-lifetime bookkeeping and never touches the admission-state
/// mutex, so it is safe to call immediately beside `tx.commit()`.
#[cfg(any(test, feature = "test-support"))]
#[doc(hidden)]
pub fn current_thread_holds_admission_effect_guard_for_test(
    controller: &AdmissionController,
    admission_epoch: u64,
) -> bool {
    snapback_kernel::storage::current_thread_holds_admission_effect_guard_for_test(
        controller.effect_guard_identity_for_test(admission_epoch),
    )
}

/// Guard proving the lease was current at one effect boundary.
pub struct AdmissionEffectGuard<'a> {
    #[allow(dead_code)]
    state: Option<MutexGuard<'a, AdmissionState>>,
    _rank: Option<AuthLockRankGuard>,
    #[cfg(any(test, feature = "test-support"))]
    proof_identity: Option<snapback_kernel::storage::AdmissionEffectGuardIdentityForTest>,
}

impl Drop for AdmissionEffectGuard<'_> {
    fn drop(&mut self) {
        #[cfg(any(test, feature = "test-support"))]
        if let Some(identity) = self.proof_identity.take() {
            snapback_kernel::storage::exit_admission_effect_guard_for_test(identity);
        }
    }
}

impl fmt::Debug for AdmissionEffectGuard<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AdmissionEffectGuard")
            .field("managed", &self.state.is_some())
            .finish()
    }
}

/// Exclusive post-quiescence token. Admission remains closed until this is
/// consumed by commit publication or dropped/aborted.
pub struct ModeTransitionGuard {
    controller: AdmissionController,
    admission_epoch: u64,
    transition_generation: u64,
    active_mode: AuthMode,
    reopen_on_abort: bool,
    finished: bool,
}

/// A known committed mode transition whose durable/private Local projection
/// finished while predecessor admission remained closed. This carrier owns the
/// transition guard until off-Local lifecycle and runtime projections finish;
/// dropping it leaves a fresh epoch non-accepting rather than reopening either
/// predecessor or successor authority.
pub struct CommittedModeTransition<T> {
    transition: ModeTransitionGuard,
    output: T,
    mode: AuthModeStateRecord,
}

impl<T> fmt::Debug for CommittedModeTransition<T> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CommittedModeTransition")
            .field("transition", &self.transition)
            .field("mode", &self.mode)
            .finish_non_exhaustive()
    }
}

impl<T> CommittedModeTransition<T> {
    pub fn mode(&self) -> &AuthModeStateRecord {
        &self.mode
    }

    /// Explicitly publish the already-projected successor only after every
    /// off-Local terminal/runtime projection has completed.
    pub fn publish_successor(self) -> SnapbackResult<(T, AuthModeStateRecord, AdmissionSnapshot)> {
        let Self {
            transition,
            output,
            mode,
        } = self;
        let snapshot = transition.publish_committed_mode_state(&mode)?;
        Ok((output, mode, snapshot))
    }
}

impl fmt::Debug for ModeTransitionGuard {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ModeTransitionGuard")
            .field("admission_epoch", &self.admission_epoch)
            .field("transition_generation", &self.transition_generation)
            .field("active_mode", &self.active_mode)
            .field("reopen_on_abort", &self.reopen_on_abort)
            .finish()
    }
}

impl ModeTransitionGuard {
    pub fn transition_generation(&self) -> u64 {
        self.transition_generation
    }

    pub fn admission_epoch(&self) -> u64 {
        self.admission_epoch
    }

    pub fn active_mode(&self) -> AuthMode {
        self.active_mode
    }

    /// Run the state-sensitive preflight while the caller owns its global
    /// write lane. An error leaves Drop to retire the old epoch and reopen the
    /// unchanged durable generation under a fresh epoch.
    pub fn repeat_preflight<T>(
        &self,
        preflight: impl FnOnce() -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        self.validate_closed()?;
        let output = preflight()?;
        self.validate_closed()?;
        Ok(output)
    }

    /// Execute the exact durable commit and publish the returned mode record
    /// without yielding back to caller code between those two cuts. Only an
    /// explicit `RolledBack` result lets Drop reopen the predecessor;
    /// `Uncertain` and every failure after `Committed` leave admission closed
    /// instead of guessing at stale authority.
    pub fn commit_and_publish_mode_state<T>(
        mut self,
        commit: impl FnOnce() -> Result<(T, AuthModeStateRecord), ModeCommitFailure>,
    ) -> SnapbackResult<(T, AuthModeStateRecord, AdmissionSnapshot)> {
        self.validate_closed()?;
        // Enter the closure in fail-closed posture. Only its explicit typed
        // rollback classification is proof that Drop may reopen the
        // predecessor; an unwind or any unclassified exit after a durable cut
        // must leave admission closed.
        self.reopen_on_abort = false;
        let (output, mode) = match commit() {
            Ok(committed) => committed,
            Err(ModeCommitFailure::RolledBack(error)) => {
                self.reopen_on_abort = true;
                return Err(error);
            }
            Err(ModeCommitFailure::Uncertain(error)) => return Err(error),
        };

        // The durable cut is now known. From here on Drop must fail closed.
        mode.validate_shape()?;
        let accepting = mode.mode_state == AuthModeStatus::Settled
            && mode.app_data_availability == AppDataAvailability::Available;
        let snapshot = self.controller.retire_and_reopen(
            self.admission_epoch,
            self.transition_generation,
            mode.transition_generation,
            mode.active,
            accepting,
        )?;
        self.finished = true;
        Ok((output, mode, snapshot))
    }

    /// Execute a durable commit plus its process-local authorization
    /// projection while the predecessor epoch remains closed. The temporary
    /// lease is the transition's sole admitted root: it permits fresh-query
    /// snapshots and queue publication, but it is created only after every
    /// predecessor root drained and is dropped before the successor reopens.
    ///
    /// A confirmed rollback reopens the predecessor under a fresh epoch. Any
    /// ambiguous commit or failure after the durable cut leaves the successor
    /// closed so the process cannot serve with a partially published policy.
    ///
    /// @ref LLP 0058#same-mode-provisioning — the transition's private
    /// projection root is the only work admitted between durable activation
    /// and successor reopen.
    pub fn commit_and_project_mode_state<T>(
        mut self,
        commit: impl FnOnce(&AdmissionLease) -> Result<(T, AuthModeStateRecord), ModeCommitFailure>,
    ) -> SnapbackResult<CommittedModeTransition<T>> {
        self.validate_closed()?;
        let projection_admission = self.admit_transition_projection()?;
        // The closure may cross the durable cut before running arbitrary
        // process-local projection code. Enter it fail-closed so an unwind
        // cannot accidentally reopen the predecessor; only an explicit
        // RolledBack result re-arms abort reopening.
        self.reopen_on_abort = false;
        let committed = commit(&projection_admission);
        drop(projection_admission);
        let (output, mode) = match committed {
            Ok(committed) => committed,
            Err(ModeCommitFailure::RolledBack(error)) => {
                self.reopen_on_abort = true;
                return Err(error);
            }
            Err(ModeCommitFailure::Uncertain(error)) => return Err(error),
        };

        // From the durable cut onward, even a process-local or off-Local
        // publication failure must not reopen the predecessor. Return the
        // still-closed guard as an owned carrier; its caller must complete all
        // remaining projection before explicitly publishing the successor.
        //
        // Live publication effect guards retain clones of the projection root
        // through the after-Local owner batch, which flushes only after this
        // closure's Local scope exits. With at least one live subscription
        // that root is therefore legitimately still counted here; treating it
        // as a foreign admitted root wedged every watch-reload evolution with
        // an attached live subscriber in permanent SNAPBACK_AUTH_MODE_PENDING
        // (issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md).
        // The strict all-roots-dropped gate still holds at successor
        // publication, after the batch has flushed.
        self.validate_closed_allowing_projection_root(true)?;
        mode.validate_shape()?;
        Ok(CommittedModeTransition {
            transition: self,
            output,
            mode,
        })
    }

    fn admit_transition_projection(&self) -> SnapbackResult<AdmissionLease> {
        let mut state = lock(&self.controller.inner.state);
        let current_epoch = state.current_epoch;
        let Some(epoch) = state.epochs.get_mut(&self.admission_epoch) else {
            return Err(admission_closed());
        };
        if current_epoch != self.admission_epoch
            || epoch.transition_generation != self.transition_generation
            || epoch.active_mode != self.active_mode
            || epoch.accepting
            || epoch.retired
            || !epoch.transition_owned
            || epoch.in_flight != 0
        {
            return Err(admission_closed());
        }
        epoch.in_flight = epoch.in_flight.checked_add(1).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_MODE_STATE_CORRUPT",
                "auth",
                "transition projection admission count overflowed",
            )
        })?;
        epoch.projection_in_flight =
            epoch.projection_in_flight.checked_add(1).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_MODE_STATE_CORRUPT",
                    "auth",
                    "transition projection admission count overflowed",
                )
            })?;
        Ok(AdmissionLease {
            token: Arc::new(LeaseToken {
                controller: Some(self.controller.inner.clone()),
                transition_generation: epoch.transition_generation,
                admission_epoch: self.admission_epoch,
                active_mode: Some(epoch.active_mode),
                cancellation: epoch.cancellation.clone(),
                diagnostic: false,
                projection: true,
            }),
        })
    }

    /// Publish a durable transaction that the caller already committed. The
    /// new process epoch is installed before app-data admission reopens.
    pub fn publish_committed_generation(
        mut self,
        new_transition_generation: u64,
        accepting: bool,
    ) -> SnapbackResult<AdmissionSnapshot> {
        self.validate_closed()?;
        let snapshot = self.controller.retire_and_reopen(
            self.admission_epoch,
            self.transition_generation,
            new_transition_generation,
            self.active_mode,
            accepting,
        )?;
        self.finished = true;
        Ok(snapshot)
    }

    /// Publish the exact durable record committed under this guard. This is
    /// the required path when a consume changes active mode; the compatibility
    /// generation-only helper above preserves the old mode.
    pub fn publish_committed_mode_state(
        mut self,
        mode: &AuthModeStateRecord,
    ) -> SnapbackResult<AdmissionSnapshot> {
        self.validate_closed()?;
        mode.validate_shape()?;
        let accepting = mode.mode_state == AuthModeStatus::Settled
            && mode.app_data_availability == AppDataAvailability::Available;
        let snapshot = self.controller.retire_and_reopen(
            self.admission_epoch,
            self.transition_generation,
            mode.transition_generation,
            mode.active,
            accepting,
        )?;
        self.finished = true;
        Ok(snapshot)
    }

    /// Abort before a durable write and reopen the unchanged generation under
    /// a fresh epoch. Existing live boundaries must be resumed by preparing
    /// fresh authority after this returns.
    pub fn abort_and_reopen(mut self) -> SnapbackResult<AdmissionSnapshot> {
        let snapshot = self.controller.retire_and_reopen(
            self.admission_epoch,
            self.transition_generation,
            self.transition_generation,
            self.active_mode,
            self.reopen_on_abort,
        )?;
        self.finished = true;
        Ok(snapshot)
    }

    fn validate_closed(&self) -> SnapbackResult<()> {
        self.validate_closed_allowing_projection_root(false)
    }

    /// `allow_projection_root` is used exactly once: after the same-mode
    /// durable cut, publication effect guards may still retain clones of the
    /// transition's own private projection root in the after-Local owner
    /// batch, so the committed carrier is validated against "no foreign root
    /// in flight" rather than "no root at all". Every reopen path stays on
    /// the strict form, so the projection root is provably dropped before a
    /// successor epoch can accept work.
    // @ref LLP 0058#same-mode-provisioning — the private projection root is
    // dropped before reopen; retained publication owners must not read as a
    // foreign admitted root at the committed-carrier cut (2026-08-01 note).
    fn validate_closed_allowing_projection_root(
        &self,
        allow_projection_root: bool,
    ) -> SnapbackResult<()> {
        let state = lock(&self.controller.inner.state);
        let Some(epoch) = state.epochs.get(&self.admission_epoch) else {
            return Err(admission_closed());
        };
        let foreign_in_flight = if allow_projection_root {
            epoch.in_flight != epoch.projection_in_flight
        } else {
            epoch.in_flight != 0
        };
        if state.current_epoch != self.admission_epoch
            || epoch.transition_generation != self.transition_generation
            || epoch.active_mode != self.active_mode
            || epoch.accepting
            || epoch.retired
            || !epoch.transition_owned
            || foreign_in_flight
        {
            return Err(admission_closed());
        }
        Ok(())
    }
}

impl Drop for ModeTransitionGuard {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        let _ = self.controller.retire_and_reopen(
            self.admission_epoch,
            self.transition_generation,
            self.transition_generation,
            self.active_mode,
            self.reopen_on_abort,
        );
        self.finished = true;
    }
}

fn validate_lease(
    state: &AdmissionState,
    lease: &AdmissionLease,
    effect: &'static str,
) -> SnapbackResult<()> {
    let valid = state.current_epoch == lease.admission_epoch()
        && state
            .epochs
            .get(&lease.admission_epoch())
            .is_some_and(|epoch| {
                !epoch.retired
                    && epoch.transition_generation == lease.transition_generation()
                    && lease
                        .active_mode()
                        .is_none_or(|mode| mode == epoch.active_mode)
                    && !epoch.cancellation.is_cancelled()
            });
    if valid {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_AUTH_MODE_PENDING",
        "auth",
        format!("{effect} was suppressed because its admission epoch was retired"),
    ))
}

fn snapshot(state: &AdmissionState) -> AdmissionSnapshot {
    let current = state
        .epochs
        .get(&state.current_epoch)
        .expect("current admission epoch exists");
    AdmissionSnapshot {
        transition_generation: current.transition_generation,
        admission_epoch: state.current_epoch,
        active_mode: current.active_mode,
        accepting: current.accepting,
        in_flight: current.in_flight,
    }
}

fn next_admission_epoch() -> SnapbackResult<u64> {
    allocate_admission_epoch(&NEXT_ADMISSION_EPOCH)
}

fn allocate_admission_epoch(counter: &AtomicU64) -> SnapbackResult<u64> {
    counter
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |epoch| {
            (epoch != 0).then(|| epoch.checked_add(1)).flatten()
        })
        .map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_AUTH_MODE_STATE_CORRUPT",
                "auth",
                "process admission epoch overflowed",
            )
        })
}

fn admission_closed() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_MODE_PENDING",
        "auth",
        "app-data admission is closed for an auth-mode transition",
    )
}

fn mode_mismatch(expected: AuthMode, observed: AuthMode) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
        "auth",
        format!(
            "{} authority cannot run while the exact active auth mode is {}",
            expected.as_str(),
            observed.as_str()
        ),
    )
}

fn quiescence_timeout() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT",
        "auth",
        "auth-mode staging did not quiesce within 30000ms; the old epoch was retired",
    )
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::mode::{
        AuthModeQuarantine, DeploymentIdentity, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX,
        SCHEMA_V1_PREFIX,
    };
    use crate::manifest::AuthMode;
    use std::sync::mpsc;
    use std::thread;

    fn sessions_identity() -> DeploymentIdentity {
        let digest = |prefix: &str, byte: char| format!("{prefix}{}", byte.to_string().repeat(64));
        DeploymentIdentity {
            schema_version: "snapback.v1".to_owned(),
            auth_mode: AuthMode::Sessions,
            app_id: "app".to_owned(),
            schema_hash: digest(SCHEMA_V1_PREFIX, 'a'),
            bundle_hash: digest(FUNCTION_V1_PREFIX, 'b'),
            inputs_hash: digest(INPUTS_V1_PREFIX, 'c'),
        }
    }

    fn pending_sessions(generation: u64) -> AuthModeStateRecord {
        let mut pending = AuthModeStateRecord::initial_dev(None);
        pending.transition_generation = generation;
        pending.desired = AuthMode::Sessions;
        pending.mode_state = AuthModeStatus::PendingRestart;
        pending.app_data_availability = AppDataAvailability::RefusedPending;
        pending.requested_deployment = Some(sessions_identity());
        pending.validate_shape().unwrap();
        pending
    }

    fn settled_sessions(generation: u64) -> AuthModeStateRecord {
        let deployment = sessions_identity();
        let mut settled = AuthModeStateRecord::initial_dev(Some(deployment.clone()));
        settled.transition_generation = generation;
        settled.active = AuthMode::Sessions;
        settled.desired = AuthMode::Sessions;
        settled.sessions_ever_activated = true;
        settled.active_deployment = Some(deployment);
        settled.validate_shape().unwrap();
        settled
    }

    #[test]
    fn cloned_lease_counts_one_finite_root_invocation() {
        let controller = AdmissionController::new(7, true).unwrap();
        let lease = controller.admit().unwrap();
        let clone = lease.clone();
        assert_eq!(controller.snapshot().in_flight, 1);
        drop(lease);
        assert_eq!(controller.snapshot().in_flight, 1);
        drop(clone);
        assert_eq!(controller.snapshot().in_flight, 0);
    }

    #[test]
    fn test_seam_treats_a_free_poisoned_state_mutex_as_available() {
        let controller = AdmissionController::new(7, true).unwrap();
        let poisoner = controller.clone();
        assert!(
            thread::spawn(move || {
                let _state = poisoner.inner.state.lock().unwrap();
                panic!("poison admission state for the test seam");
            })
            .join()
            .is_err()
        );

        assert!(controller.state_mutex_available_for_test());
        assert_eq!(
            controller.snapshot().transition_generation,
            7,
            "production admission access must recover the same poisoned mutex"
        );
    }

    #[test]
    fn effect_guard_lifetime_probe_does_not_reenter_the_admission_mutex() {
        let controller = AdmissionController::new(7, true).unwrap();
        let lease = controller.admit().unwrap();
        let epoch = lease.admission_epoch();
        assert!(!current_thread_holds_admission_effect_guard_for_test(
            &controller,
            epoch
        ));
        let guard = lease.effect_guard("commit-boundary probe").unwrap();
        assert!(
            current_thread_holds_admission_effect_guard_for_test(&controller, epoch),
            "the read-only lifetime probe must work while the non-reentrant mutex is held"
        );
        drop(guard);
        assert!(!current_thread_holds_admission_effect_guard_for_test(
            &controller,
            epoch
        ));
    }

    #[test]
    fn effect_guard_lifetime_probe_is_bound_to_controller_and_epoch() {
        let target = AdmissionController::new(7, true).unwrap();
        let target_lease = target.admit().unwrap();
        let target_epoch = target_lease.admission_epoch();
        let target_guard = target_lease.effect_guard("exact target epoch").unwrap();
        assert!(current_thread_holds_admission_effect_guard_for_test(
            &target,
            target_epoch
        ));
        assert!(
            !current_thread_holds_admission_effect_guard_for_test(
                &target,
                target_epoch.saturating_add(1),
            ),
            "another epoch on the same controller must not satisfy the proof"
        );
        drop(target_guard);

        let other = AdmissionController::new(7, true).unwrap();
        let other_lease = other.admit().unwrap();
        let other_guard = other_lease.effect_guard("different controller").unwrap();

        assert!(current_thread_holds_admission_effect_guard_for_test(
            &other,
            other_lease.admission_epoch()
        ));
        assert!(
            !current_thread_holds_admission_effect_guard_for_test(&target, target_epoch),
            "a guard from another controller must not prove the target controller/epoch"
        );

        drop(other_guard);
    }

    #[test]
    fn paused_invocation_closes_new_admission_then_yields_transition_guard() {
        let controller = AdmissionController::new(3, true).unwrap();
        let lease = controller.admit().unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let worker = {
            let controller = controller.clone();
            thread::spawn(move || {
                started_tx.send(()).unwrap();
                controller.begin_transition().unwrap()
            })
        };
        started_rx.recv().unwrap();
        while controller.snapshot().accepting {
            thread::yield_now();
        }
        assert_eq!(
            controller.admit().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );
        drop(lease);
        let guard = worker.join().unwrap();
        let reopened = guard.publish_committed_generation(4, true).unwrap();
        assert_eq!(reopened.transition_generation, 4);
        assert!(reopened.accepting);
    }

    #[test]
    fn paused_old_query_drains_then_projection_finishes_before_activation_reopens() {
        let settled = settled_sessions(7);
        let controller = AdmissionController::from_mode_state(&settled).unwrap();
        let old_query = controller.admit_for_mode(AuthMode::Sessions).unwrap();
        let old_epoch = old_query.admission_epoch();
        let (started_tx, started_rx) = mpsc::channel();
        let worker = {
            let controller = controller.clone();
            thread::spawn(move || {
                started_tx.send(()).unwrap();
                controller.begin_transition().unwrap()
            })
        };
        started_rx.recv().unwrap();
        while controller.snapshot().accepting {
            thread::yield_now();
        }
        assert_eq!(controller.snapshot().in_flight, 1);
        assert_eq!(
            controller.admit().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );

        drop(old_query);
        let guard = worker.join().unwrap();
        let projected = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let observed = projected.clone();
        let committed = guard
            .commit_and_project_mode_state(|projection_admission| {
                assert_eq!(projection_admission.active_mode(), Some(AuthMode::Sessions));
                projection_admission
                    .effect_guard("activation invalidation projection")
                    .map_err(ModeCommitFailure::Uncertain)?;
                assert!(!controller.snapshot().accepting);
                assert_eq!(controller.snapshot().in_flight, 1);
                observed.store(true, Ordering::SeqCst);
                Ok(((), settled.clone()))
            })
            .unwrap();
        assert!(projected.load(Ordering::SeqCst));
        assert!(
            !controller.snapshot().accepting,
            "the committed carrier keeps successor admission closed"
        );
        let (_, returned, reopened) = committed.publish_successor().unwrap();
        assert_eq!(returned, settled);
        assert_ne!(reopened.admission_epoch, old_epoch);
        assert!(reopened.accepting);
        assert_eq!(reopened.in_flight, 0);
    }

    #[test]
    fn ambiguous_activation_projection_drops_its_root_and_stays_closed() {
        let settled = settled_sessions(9);
        let controller = AdmissionController::from_mode_state(&settled).unwrap();
        let before = controller.snapshot();
        let error = controller
            .begin_transition()
            .unwrap()
            .commit_and_project_mode_state::<()>(|projection_admission| {
                projection_admission
                    .effect_guard("ambiguous activation projection")
                    .map_err(ModeCommitFailure::Uncertain)?;
                Err(ModeCommitFailure::Uncertain(SnapbackError::error(
                    "TEST_ACTIVATION_UNCERTAIN",
                    "test",
                    "activation commit acknowledgement was lost",
                )))
            })
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_ACTIVATION_UNCERTAIN");
        let closed = controller.snapshot();
        assert_ne!(closed.admission_epoch, before.admission_epoch);
        assert_eq!(closed.transition_generation, before.transition_generation);
        assert!(!closed.accepting);
        assert_eq!(closed.in_flight, 0);
    }

    #[test]
    fn dropping_known_committed_transition_carrier_never_reopens_authority() {
        let settled = settled_sessions(11);
        let controller = AdmissionController::from_mode_state(&settled).unwrap();
        let before = controller.snapshot();
        let committed = controller
            .begin_transition()
            .unwrap()
            .commit_and_project_mode_state(|projection_admission| {
                projection_admission
                    .effect_guard("known commit private projection")
                    .map_err(ModeCommitFailure::Uncertain)?;
                Ok(((), settled.clone()))
            })
            .unwrap();
        assert!(!controller.snapshot().accepting);
        drop(committed);
        let closed = controller.snapshot();
        assert_ne!(closed.admission_epoch, before.admission_epoch);
        assert_eq!(closed.transition_generation, before.transition_generation);
        assert!(!closed.accepting);
        assert_eq!(closed.in_flight, 0);
        assert_eq!(
            controller.admit().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );
    }

    // Regression for issues/20260801-0137-a3-live-subscriber-wedges-watch-reload.md:
    // live publication effect guards clone the transition's private projection
    // root into the after-Local owner batch, which flushes only after the
    // commit closure returns. The committed carrier must tolerate its own
    // still-retained projection root (otherwise every same-mode evolution with
    // an attached live subscriber failed post-commit and wedged admission in
    // permanent SNAPBACK_AUTH_MODE_PENDING), while successor publication still
    // strictly requires that root to be dropped before reopen.
    #[test]
    fn retained_projection_root_clone_does_not_fail_the_committed_carrier() {
        let settled = settled_sessions(13);
        let controller = AdmissionController::from_mode_state(&settled).unwrap();
        let mut retained_publication_owner = None;
        let committed = controller
            .begin_transition()
            .unwrap()
            .commit_and_project_mode_state(|projection_admission| {
                // Model `effect_guard`'s after-Local owner retention: a clone
                // of the projection root outlives the commit closure.
                retained_publication_owner = Some(projection_admission.clone());
                Ok(((), settled.clone()))
            })
            .expect(
                "a retained clone of the transition's own projection root must not \
                 fail the known-committed carrier",
            );
        assert_eq!(controller.snapshot().in_flight, 1);

        // LLP 0058 same-mode provisioning: the projection root is dropped
        // before reopen. Publishing while the retained owner still holds the
        // root must refuse instead of reopening over live projection work.
        let refused = committed.publish_successor().unwrap_err();
        assert_eq!(refused.diagnostic.code, "SNAPBACK_AUTH_MODE_PENDING");
        let closed = controller.snapshot();
        assert!(!closed.accepting);

        // Once the after-Local owners flush (modeled by dropping the clone),
        // a fresh commit over the fail-closed epoch is not possible, but the
        // epoch must be fully drained: no counted root remains.
        drop(retained_publication_owner.take());
        assert_eq!(controller.snapshot().in_flight, 0);
    }

    #[test]
    fn published_successor_after_projection_root_flush_reopens_accepting() {
        let settled = settled_sessions(14);
        let controller = AdmissionController::from_mode_state(&settled).unwrap();
        let before = controller.snapshot();
        let mut retained_publication_owner = None;
        let committed = controller
            .begin_transition()
            .unwrap()
            .commit_and_project_mode_state(|projection_admission| {
                retained_publication_owner = Some(projection_admission.clone());
                Ok(((), settled.clone()))
            })
            .expect("retained projection root must not fail the committed carrier");
        // The after-Local batch flushes before the carrier's owner publishes
        // the successor; model that ordering, then reopen must succeed.
        drop(retained_publication_owner.take());
        let (_, returned, reopened) = committed
            .publish_successor()
            .expect("successor publishes after the projection root flushed");
        assert_eq!(returned, settled);
        assert_ne!(reopened.admission_epoch, before.admission_epoch);
        assert!(reopened.accepting);
        assert_eq!(reopened.in_flight, 0);
    }

    #[test]
    fn activation_projection_unwind_after_possible_commit_stays_closed() {
        let settled = settled_sessions(10);
        let controller = AdmissionController::from_mode_state(&settled).unwrap();
        let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = controller
                .begin_transition()
                .unwrap()
                .commit_and_project_mode_state::<()>(|_| {
                    panic!("injected post-commit activation projection unwind")
                });
        }));
        assert!(panic.is_err());
        let closed = controller.snapshot();
        assert!(!closed.accepting);
        assert_eq!(closed.in_flight, 0);
        assert_eq!(
            controller.admit().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );
    }

    #[test]
    fn mode_commit_unwind_after_possible_commit_stays_closed() {
        let controller = AdmissionController::new(11, true).unwrap();
        let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = controller
                .begin_transition()
                .unwrap()
                .commit_and_publish_mode_state::<()>(|| {
                    panic!("injected post-commit mode publication unwind")
                });
        }));
        assert!(panic.is_err());
        let closed = controller.snapshot();
        assert!(!closed.accepting);
        assert_eq!(closed.in_flight, 0);
    }

    #[test]
    fn timeout_retires_cancels_and_reopens_unchanged_generation() {
        assert_eq!(AUTH_MODE_QUIESCENCE_TIMEOUT_MS, 30_000);
        let controller = AdmissionController::new(11, true).unwrap();
        let lease = controller.admit().unwrap();
        let callback_fired = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let callback = callback_fired.clone();
        let _registration = lease.register_cancellation_hook(move || {
            callback.store(true, Ordering::SeqCst);
        });

        let error = controller
            .begin_transition_with_suspend_and_timeout(|| Ok(()), Duration::from_millis(10))
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
        );
        assert!(lease.is_cancelled());
        assert!(callback_fired.load(Ordering::SeqCst));
        assert_eq!(
            lease
                .effect_guard("late transaction")
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );
        let reopened = controller.snapshot();
        assert_eq!(reopened.transition_generation, 11);
        assert_ne!(reopened.admission_epoch, lease.admission_epoch());
        assert!(reopened.accepting);
        assert_eq!(reopened.in_flight, 0);
        assert_eq!(controller.admit().unwrap().transition_generation(), 11);
    }

    #[test]
    fn cancellation_hook_may_reenter_cancellation_observation() {
        let signal = Arc::new(CancellationSignal::default());
        let observed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let hook_signal = signal.clone();
        let hook_observed = observed.clone();
        let _registration = signal.register(Arc::new(move || {
            hook_observed.store(hook_signal.is_cancelled(), Ordering::SeqCst);
        }));
        signal.cancel();
        assert!(observed.load(Ordering::SeqCst));
    }

    #[test]
    fn admission_epoch_exhaustion_is_permanent_and_never_reuses_an_id() {
        let counter = AtomicU64::new(u64::MAX - 1);
        assert_eq!(allocate_admission_epoch(&counter).unwrap(), u64::MAX - 1);
        assert_eq!(counter.load(Ordering::SeqCst), u64::MAX);
        for _ in 0..2 {
            assert_eq!(
                allocate_admission_epoch(&counter)
                    .unwrap_err()
                    .diagnostic
                    .code,
                "SNAPBACK_AUTH_MODE_STATE_CORRUPT"
            );
            assert_eq!(counter.load(Ordering::SeqCst), u64::MAX);
        }
    }

    #[test]
    fn cancellation_hook_exhaustion_cancels_instead_of_reusing_an_id() {
        let signal = Arc::new(CancellationSignal {
            state: Mutex::new(CancellationState {
                cancelled: false,
                next_hook: u64::MAX,
                hook_ids_exhausted: false,
                hooks: BTreeMap::new(),
            }),
            changed: tokio::sync::Notify::new(),
        });
        let first_called = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let first_observed = first_called.clone();
        let first = signal.register(Arc::new(move || {
            first_observed.store(true, Ordering::SeqCst);
        }));
        assert!(!signal.is_cancelled());
        assert_eq!(lock(&signal.state).hooks.len(), 1);

        let second_called = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let second_observed = second_called.clone();
        let second = signal.register(Arc::new(move || {
            second_observed.store(true, Ordering::SeqCst);
        }));
        assert!(signal.is_cancelled());
        assert!(first_called.load(Ordering::SeqCst));
        assert!(second_called.load(Ordering::SeqCst));
        assert!(lock(&signal.state).hooks.is_empty());
        drop((first, second));
    }

    #[test]
    fn effect_guard_linearizes_publication_before_retirement() {
        let controller = AdmissionController::new(1, true).unwrap();
        let lease = controller.admit().unwrap();
        let permit = lease.effect_guard("response publication").unwrap();
        let (done_tx, done_rx) = mpsc::channel();
        let worker = {
            let controller = controller.clone();
            thread::spawn(move || {
                let result = controller.begin_transition_with_suspend_and_timeout(
                    || Ok(()),
                    Duration::from_millis(20),
                );
                done_tx.send(result.map(|_| ())).unwrap();
            })
        };
        thread::sleep(Duration::from_millis(5));
        assert!(done_rx.try_recv().is_err());
        drop(permit);
        drop(lease);
        assert!(done_rx.recv().unwrap().is_ok());
        worker.join().unwrap();
    }

    #[test]
    fn preclose_effect_guard_delay_does_not_consume_drain_deadline() {
        let controller = AdmissionController::new(2, true).unwrap();
        let lease = controller.admit().unwrap();
        let effect = lease
            .effect_guard("commit before transition close")
            .unwrap();
        let worker = {
            let controller = controller.clone();
            thread::spawn(move || {
                controller
                    .begin_transition_with_suspend_and_timeout(|| Ok(()), Duration::from_millis(20))
            })
        };
        thread::sleep(Duration::from_millis(30));
        let closed_after = Instant::now();
        drop(effect);
        let error = worker.join().unwrap().unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
        );
        assert!(
            closed_after.elapsed() >= Duration::from_millis(15),
            "mutex wait before close must not spend the drain deadline"
        );
        drop(lease);
    }

    #[test]
    fn failed_repeated_preflight_reopens_on_guard_drop() {
        let controller = AdmissionController::new(9, true).unwrap();
        let guard = controller.begin_transition().unwrap();
        let error = guard
            .repeat_preflight(|| -> SnapbackResult<()> {
                Err(SnapbackError::error("TEST_PREFLIGHT", "test", "refused"))
            })
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_PREFLIGHT");
        drop(guard);
        let reopened = controller.snapshot();
        assert_eq!(reopened.transition_generation, 9);
        assert!(reopened.accepting);
    }

    #[test]
    fn commit_certainty_is_the_only_authority_reopen_boundary() {
        let rolled_back = AdmissionController::new(31, true).unwrap();
        let before = rolled_back.snapshot();
        let error = rolled_back
            .begin_transition()
            .unwrap()
            .commit_and_publish_mode_state::<()>(|| {
                Err(ModeCommitFailure::RolledBack(SnapbackError::error(
                    "TEST_ROLLED_BACK",
                    "test",
                    "transaction rolled back",
                )))
            })
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_ROLLED_BACK");
        let reopened = rolled_back.snapshot();
        assert_eq!(reopened.transition_generation, before.transition_generation);
        assert_eq!(reopened.active_mode, before.active_mode);
        assert_ne!(reopened.admission_epoch, before.admission_epoch);
        assert!(reopened.accepting);

        let uncertain = AdmissionController::new(41, true).unwrap();
        let before = uncertain.snapshot();
        let error = uncertain
            .begin_transition()
            .unwrap()
            .commit_and_publish_mode_state::<()>(|| {
                Err(ModeCommitFailure::Uncertain(SnapbackError::error(
                    "TEST_COMMIT_UNCERTAIN",
                    "test",
                    "commit acknowledgement was lost",
                )))
            })
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_COMMIT_UNCERTAIN");
        let closed = uncertain.snapshot();
        assert_eq!(closed.transition_generation, before.transition_generation);
        assert_eq!(closed.active_mode, before.active_mode);
        assert_ne!(closed.admission_epoch, before.admission_epoch);
        assert!(!closed.accepting);
        assert_eq!(
            uncertain.admit().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );

        let committed = AdmissionController::new(51, true).unwrap();
        let pending = pending_sessions(52);
        let (_, returned, published) = committed
            .begin_transition()
            .unwrap()
            .commit_and_publish_mode_state(|| Ok(((), pending.clone())))
            .unwrap();
        assert_eq!(returned, pending);
        assert_eq!(published.transition_generation, 52);
        assert_eq!(published.active_mode, AuthMode::Dev);
        assert!(!published.accepting);
    }

    #[test]
    fn ambiguous_same_mode_commit_cancels_predecessor_and_stays_closed() {
        let controller = AdmissionController::new(61, true).unwrap();
        let lease = controller.admit().unwrap();
        let before = controller.snapshot();
        let closed = controller.fail_closed_after_uncertain_commit().unwrap();
        assert!(lease.is_cancelled());
        assert_ne!(closed.admission_epoch, before.admission_epoch);
        assert_eq!(closed.transition_generation, before.transition_generation);
        assert_eq!(closed.active_mode, before.active_mode);
        assert!(!closed.accepting);
        assert_eq!(
            lease
                .effect_guard("post-commit publication")
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );
    }

    #[test]
    fn pending_restage_can_own_closed_epoch_and_abort_stays_closed() {
        let controller = AdmissionController::new(12, false).unwrap();
        let guard = controller.begin_transition().unwrap();
        assert_eq!(guard.transition_generation(), 12);
        let old_epoch = guard.admission_epoch();
        drop(guard);
        let after = controller.snapshot();
        assert_eq!(after.transition_generation, 12);
        assert!(!after.accepting);
        assert_ne!(after.admission_epoch, old_epoch);
    }

    #[test]
    fn prebind_mode_sync_is_idempotent_and_mirrors_availability() {
        let controller = AdmissionController::new(0, true).unwrap();
        let settled = AuthModeStateRecord::initial_dev(None);
        let first = controller.synchronize_mode_state(&settled).unwrap();
        let second = controller.synchronize_mode_state(&settled).unwrap();
        assert_eq!(first, second);
        assert!(second.accepting);

        let pending = pending_sessions(1);
        let pending_snapshot = controller.synchronize_mode_state(&pending).unwrap();
        assert_eq!(pending_snapshot.transition_generation, 1);
        assert!(!pending_snapshot.accepting);
        assert_eq!(
            controller.synchronize_mode_state(&pending).unwrap(),
            pending_snapshot
        );

        let mut quarantined = pending;
        quarantined.transition_generation = 2;
        quarantined.mode_state = AuthModeStatus::Quarantined;
        quarantined.quarantine = Some(AuthModeQuarantine {
            transition_generation: 2,
            code: "SNAPBACK_AUTH_POLICY_UNAVAILABLE".to_owned(),
        });
        let quarantined_snapshot = controller.synchronize_mode_state(&quarantined).unwrap();
        assert_eq!(quarantined_snapshot.transition_generation, 2);
        assert!(!quarantined_snapshot.accepting);
    }

    #[test]
    fn exact_mode_sync_is_a_safe_noop_while_work_is_in_flight() {
        let controller = AdmissionController::new(0, true).unwrap();
        let lease = controller.admit().unwrap();
        let observed = controller
            .synchronize_mode_state(&AuthModeStateRecord::initial_dev(None))
            .unwrap();
        assert_eq!(observed.admission_epoch, lease.admission_epoch());
        assert_eq!(observed.in_flight, 1);
        assert!(observed.accepting);
    }

    #[test]
    fn invalid_mode_state_never_changes_controller_or_committed_publication() {
        let controller = AdmissionController::new(70, true).unwrap();
        let before = controller.snapshot();
        let mut invalid = AuthModeStateRecord::initial_dev(None);
        invalid.transition_generation = 71;
        invalid.active = AuthMode::Sessions;
        invalid.desired = AuthMode::Sessions;
        assert_eq!(
            controller
                .synchronize_mode_state(&invalid)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_MODE_STATE_CORRUPT"
        );
        assert_eq!(controller.snapshot(), before);

        let guard = controller.begin_transition().unwrap();
        assert_eq!(
            guard
                .publish_committed_mode_state(&invalid)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_MODE_STATE_CORRUPT"
        );
        let reopened = controller.snapshot();
        assert_eq!(reopened.transition_generation, before.transition_generation);
        assert_eq!(reopened.active_mode, before.active_mode);
        assert!(reopened.accepting);
        assert_ne!(reopened.admission_epoch, before.admission_epoch);
    }

    #[test]
    fn pending_suspend_failure_preserves_closed_posture() {
        let controller = AdmissionController::new(5, false).unwrap();
        let error = controller
            .begin_transition_with_suspend_and_timeout(
                || {
                    Err(SnapbackError::error(
                        "TEST_SUSPEND",
                        "test",
                        "live suspension failed",
                    ))
                },
                Duration::from_millis(10),
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_SUSPEND");
        let after = controller.snapshot();
        assert_eq!(after.transition_generation, 5);
        assert!(!after.accepting);
    }

    #[tokio::test]
    async fn close_then_waiter_registration_observes_abort_reopen_without_polling() {
        let controller = AdmissionController::new(21, true).unwrap();
        let guard = controller.begin_transition().unwrap();
        let closed = controller.diagnostic_snapshot();
        assert!(!closed.accepting);

        let waiter = {
            let controller = controller.clone();
            tokio::spawn(async move { controller.changed(closed).await })
        };
        tokio::task::yield_now().await;
        let reopened = guard.abort_and_reopen().unwrap();
        let observed = tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("change waiter must not miss reopen")
            .unwrap();
        assert_eq!(observed, reopened);
        assert!(observed.accepting);
        assert_ne!(observed.admission_epoch, closed.admission_epoch);
    }

    #[tokio::test]
    async fn pending_to_settled_mode_change_wakes_and_binds_exact_mode() {
        let controller = AdmissionController::new(5, false).unwrap();
        let pending = controller.diagnostic_snapshot();
        let waiter = {
            let controller = controller.clone();
            tokio::spawn(async move { controller.changed(pending).await })
        };
        tokio::task::yield_now().await;

        let sessions = settled_sessions(6);
        let published = controller.synchronize_mode_state(&sessions).unwrap();
        let observed = tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("pending waiter must observe settled publication")
            .unwrap();
        assert_eq!(observed, published);
        assert_eq!(observed.active_mode, AuthMode::Sessions);
        assert!(observed.accepting);
        assert_eq!(
            controller.admit_dev().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
        assert_eq!(
            controller
                .admit_for_mode(AuthMode::Sessions)
                .unwrap()
                .active_mode(),
            Some(AuthMode::Sessions)
        );
    }

    #[tokio::test]
    async fn fresh_wait_returns_terminal_pending_after_new_closed_epoch() {
        let controller = AdmissionController::new(40, true).unwrap();
        let previous = controller.snapshot();
        let guard = controller.begin_transition().unwrap();
        let pending = pending_sessions(41);
        let published = guard.publish_committed_mode_state(&pending).unwrap();
        assert!(!published.accepting);
        assert_eq!(
            controller
                .wait_for_fresh_admission(previous.admission_epoch)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );
        assert_eq!(
            controller
                .wait_for_fresh_admission_async(previous.admission_epoch)
                .await
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_MODE_PENDING"
        );
    }

    #[tokio::test]
    async fn cancellation_future_registers_before_check_and_wakes_on_timeout_retirement() {
        let controller = AdmissionController::new(31, true).unwrap();
        let lease = controller.admit().unwrap();
        let cancellation = {
            let lease = lease.clone();
            tokio::spawn(async move { lease.cancelled().await })
        };
        tokio::task::yield_now().await;
        let worker = {
            let controller = controller.clone();
            thread::spawn(move || {
                controller
                    .begin_transition_with_suspend_and_timeout(|| Ok(()), Duration::from_millis(10))
            })
        };
        tokio::time::timeout(Duration::from_secs(1), cancellation)
            .await
            .expect("cancellation waiter must wake")
            .unwrap();
        assert_eq!(
            worker.join().unwrap().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT"
        );
        assert!(lease.is_cancelled());
    }
}
