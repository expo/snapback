use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, MutexGuard, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use tokio::sync::Notify;

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::live_wire::{LiveAuthErrorCode, LiveAuthErrorReason, LiveAuthorityDisposition};
use crate::storage::{
    AuthorizationCommitOutcome, AuthorizationCommitParticipant, AuthorizationCommitPreflight,
    AuthorizationCommitReservation, AuthorizationCommitWitness, AuthorizationExpectationView,
    AuthorizationOutboxAdmission, AuthorizationReservationCancellation, AuthorizationVersion,
    NonAuthorizingRoomAuthority, OutboxFrameDisposition, RealtimePublicationValidity,
    RoomAuthorityOperationGuard, RoomCreationAdmission, RoomReauthorizationAdmission,
    RoomRetirementAdmission, ServingDatabase,
};
pub use crate::storage::{RealtimePublicationPermit, RoomAuthorityPermit, RoomAuthorityResync};
pub use snapback_types::ephemeral::*;

/// Recover from lock poisoning the way the rest of the codebase does: room and
/// queue state is small and self-consistent per critical section, so a
/// panicked holder should not wedge the whole ephemeral subsystem.
fn lock<T>(mutex: &StdMutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Wakes the per-connection delivery task the moment a message is enqueued for
/// it, so the WebSocket loop no longer polls on a fixed interval (L8). A
/// connection with no registered waiter — embedded/test use, or an HTTP-polling
/// client — is a no-op wake. `tokio::sync::Notify` stores one permit, so a wake
/// that races an in-progress drain is not lost.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L8: event-driven delivery.
///
/// Registration is GENERATION-GUARDED (LLP 0034 review fix 1): a reconnect
/// reuses the connection id, so a new socket's `register` replaces the old
/// waker — and the old task's late teardown (a half-open TCP socket can die
/// arbitrarily long after the replacement) must not tear down state the new
/// socket now owns. `register` returns the registration's generation;
/// `unregister` removes the waker — and reports ownership — only when that
/// generation is still current, and the caller gates `disconnect` on it.
/// `is_current` lets the delivery loop make the same check mid-life
/// (ENG-23425): the per-connection outbox is keyed by connection id alone,
/// so a superseded task that keeps draining steals the new socket's
/// messages into its dead socket — it must stop draining, not just skip
/// teardown. `is_registered` extends the guard through the destructive act
/// itself (ENG-23426): teardown unregisters under the global write mutex,
/// and the ephemeral wipe re-checks for a re-registration under each
/// room/outbox lock, so a reconnect landing mid-teardown keeps its state.
struct DeliveryNotifierState {
    next_generation: Option<u64>,
    waiters: HashMap<String, DeliveryRegistration>,
    teardowns: HashMap<String, u64>,
}

#[derive(Default)]
struct DeliveryDeadlineState {
    by_deadline: BTreeMap<std::time::Instant, BTreeSet<String>>,
    running: bool,
}

#[derive(Clone, Debug)]
struct DeliveryRegistration {
    generation: u64,
    grant_id: Option<Arc<str>>,
    notify: Arc<Notify>,
    terminal: Option<DeliveryTerminalEvent>,
}

/// Internal terminal event retained beside the exact socket registration.
/// `grant_id` stays in the registration rather than the public frame, so an
/// invalidation for a predecessor can never close a replacement that reused
/// the readable connection id.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DeliveryTerminalEvent {
    pub code: LiveAuthErrorCode,
    pub reason: LiveAuthErrorReason,
    pub authority_disposition: LiveAuthorityDisposition,
    pub close_by: std::time::Instant,
}

impl Default for DeliveryNotifierState {
    fn default() -> Self {
        Self {
            next_generation: Some(1),
            waiters: HashMap::new(),
            teardowns: HashMap::new(),
        }
    }
}

pub struct DeliveryNotifier {
    state: StdMutex<DeliveryNotifierState>,
    deadlines: StdMutex<DeliveryDeadlineState>,
    deadline_changed: Notify,
    #[cfg(any(test, feature = "test-support"))]
    authorized_effect_observer_for_test: StdMutex<
        Option<(
            u64,
            Arc<std::sync::atomic::AtomicBool>,
            Arc<std::sync::atomic::AtomicBool>,
        )>,
    >,
    #[cfg(test)]
    deadline_task_spawns: AtomicU64,
    #[cfg(test)]
    deadline_timer_arms: AtomicU64,
}

impl Default for DeliveryNotifier {
    fn default() -> Self {
        Self {
            state: StdMutex::new(DeliveryNotifierState::default()),
            deadlines: StdMutex::new(DeliveryDeadlineState::default()),
            deadline_changed: Notify::new(),
            #[cfg(any(test, feature = "test-support"))]
            authorized_effect_observer_for_test: StdMutex::new(None),
            #[cfg(test)]
            deadline_task_spawns: AtomicU64::new(0),
            #[cfg(test)]
            deadline_timer_arms: AtomicU64::new(0),
        }
    }
}

/// Exact socket-generation claim held while connection cleanup runs without
/// retaining the notifier mutex. New registration for the readable id is
/// refused until this claim is finished, so teardown can cross the ephemeral
/// and LocalSnapback phases without deleting a reconnect's fresh state.
///
/// @ref LLP 0059#locking-and-linearization — notifier ownership is converted
/// into a lock-free logical claim before any other teardown subsystem runs.
#[must_use = "a claimed socket generation must be explicitly finished after cleanup"]
pub struct DeliveryTeardownClaim {
    notifier: Arc<DeliveryNotifier>,
    connection_id: String,
    generation: u64,
    finished: bool,
}

impl DeliveryTeardownClaim {
    pub fn finish(mut self) {
        self.release();
    }

    fn release(&mut self) {
        if self.finished {
            return;
        }
        let mut state = self.notifier.lock_state();
        if state.teardowns.get(&self.connection_id) == Some(&self.generation) {
            state.teardowns.remove(&self.connection_id);
        }
        self.finished = true;
    }
}

impl Drop for DeliveryTeardownClaim {
    fn drop(&mut self) {
        // Fail closed. Split cleanup is moved into an owned server task before
        // the caller can be cancelled; if that task panics, reopening this id
        // would be less safe than retaining the claim until process restart.
    }
}

impl DeliveryNotifier {
    fn lock_state(&self) -> MutexGuard<'_, DeliveryNotifierState> {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "DeliveryNotifier state lock",
        );
        lock(&self.state)
    }

    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn observe_next_wake_authorized_effect_for_test(
        &self,
        reservation_identity: u64,
        reached: Arc<std::sync::atomic::AtomicBool>,
        inactive: Arc<std::sync::atomic::AtomicBool>,
    ) {
        let replaced = lock(&self.authorized_effect_observer_for_test).replace((
            reservation_identity,
            reached,
            inactive,
        ));
        assert!(
            replaced.is_none(),
            "delivery notifier authorized-effect observer already installed"
        );
    }

    #[cfg(any(test, feature = "test-support"))]
    fn observe_authorized_effect_for_test(&self) {
        let Some((reservation_identity, reached, inactive)) =
            lock(&self.authorized_effect_observer_for_test).take()
        else {
            return;
        };
        inactive.store(
            reservation_identity != 0
                && !crate::auth::invocation::authorized_effect_reservation_active_for_test(
                    reservation_identity,
                ),
            Ordering::Release,
        );
        reached.store(true, Ordering::Release);
    }

    /// Register interest in a connection's deliveries. Returns this
    /// registration's generation and the waker; a later `register` for the
    /// same connection replaces the waker and supersedes the generation.
    pub fn register(&self, connection_id: &str) -> SnapbackResult<(u64, Arc<Notify>)> {
        self.register_inner(connection_id, None)
    }

    /// Register a socket against the opaque grant that authorized its
    /// upgrade. Terminal propagation compares both identities; the readable
    /// connection id alone is deliberately insufficient.
    pub fn register_bound(
        &self,
        connection_id: &str,
        grant_id: impl Into<Arc<str>>,
    ) -> SnapbackResult<(u64, Arc<Notify>)> {
        self.register_inner(connection_id, Some(grant_id.into()))
    }

    fn register_inner(
        &self,
        connection_id: &str,
        grant_id: Option<Arc<str>>,
    ) -> SnapbackResult<(u64, Arc<Notify>)> {
        let mut state = self.lock_state();
        if state.teardowns.contains_key(connection_id) {
            return Err(SnapbackError::error(
                "SNAPBACK_CONNECTION_TEARDOWN_PENDING",
                "realtime",
                "the predecessor socket is still completing exact connection teardown",
            ));
        }
        let generation = state.next_generation.ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_EPHEMERAL_GENERATION_EXHAUSTED",
                "ephemeral",
                "delivery registration generation exhausted",
            )
        })?;
        state.next_generation = generation.checked_add(1);
        let notify = Arc::new(Notify::new());
        state.waiters.insert(
            connection_id.to_owned(),
            DeliveryRegistration {
                generation,
                grant_id,
                notify: notify.clone(),
                terminal: None,
            },
        );
        Ok((generation, notify))
    }

    /// Atomically replace one current socket registration with a teardown
    /// claim. The claim carries no mutex guard and blocks same-id registration
    /// until cleanup explicitly finishes. A stale socket generation gets
    /// `None` and must not clean any connection state.
    pub fn begin_teardown(
        self: &Arc<Self>,
        connection_id: &str,
        generation: u64,
    ) -> Option<DeliveryTeardownClaim> {
        let notify = {
            let mut state = self.lock_state();
            if state.teardowns.contains_key(connection_id) {
                return None;
            }
            let current = state.waiters.get(connection_id)?;
            if current.generation != generation {
                return None;
            }
            let registration = state
                .waiters
                .remove(connection_id)
                .expect("the generation-matched registration remains installed");
            state.teardowns.insert(connection_id.to_owned(), generation);
            registration.notify
        };
        notify.notify_one();
        Some(DeliveryTeardownClaim {
            notifier: Arc::clone(self),
            connection_id: connection_id.to_owned(),
            generation,
            finished: false,
        })
    }

    /// Unregister only if `generation` still owns the connection's waker.
    /// Returns whether the caller was the current owner — a stale task (its
    /// registration already replaced by a reconnect) gets `false` and must
    /// not perform connection teardown.
    pub fn unregister(&self, connection_id: &str, generation: u64) -> bool {
        let mut state = self.lock_state();
        match state.waiters.get(connection_id) {
            Some(current) if current.generation == generation => {
                state.waiters.remove(connection_id);
                true
            }
            _ => false,
        }
    }

    /// Whether `generation` still owns the connection's waker. A superseded
    /// delivery task (its registration replaced by a reconnect on the same
    /// connection id) gets `false` and must stop draining the shared outbox:
    /// the messages in it now belong to the new socket (ENG-23425).
    pub fn is_current(&self, connection_id: &str, generation: u64) -> bool {
        matches!(
            self.lock_state().waiters.get(connection_id),
            Some(current) if current.generation == generation
        )
    }

    /// Whether ordinary effects may still drain to this exact registration.
    /// Terminal ownership remains current for guarded teardown, but ordinary
    /// bytes stop at the same notifier cut that installs the auth error.
    pub fn is_deliverable(&self, connection_id: &str, generation: u64) -> bool {
        matches!(
            self.lock_state().waiters.get(connection_id),
            Some(current) if current.generation == generation && current.terminal.is_none()
        )
    }

    /// Install a terminal event only for the exact bound grant. A later
    /// registration on the same readable id has a different grant id and is
    /// untouched. The wake happens after the event is visible under the same
    /// mutex, so the stream cannot observe a wake without its terminal data.
    pub fn terminalize_bound(
        &self,
        connection_id: &str,
        grant_id: &str,
        event: DeliveryTerminalEvent,
    ) -> bool {
        let notify = {
            let mut state = self.lock_state();
            let Some(registration) = state.waiters.get_mut(connection_id) else {
                return false;
            };
            if registration.grant_id.as_deref() != Some(grant_id) {
                return false;
            }
            if registration.terminal.is_none() {
                registration.terminal = Some(event);
            }
            Arc::clone(&registration.notify)
        };
        notify.notify_one();
        true
    }

    /// Retire one non-auth connection grant without manufacturing an auth
    /// terminal frame. Removing the exact registration and waking its task
    /// makes every generation-guarded drain stop immediately; a replacement
    /// grant with another opaque id is unaffected.
    pub fn retire_bound(&self, connection_id: &str, grant_id: &str) -> bool {
        let notify = {
            let mut state = self.lock_state();
            let matches = state
                .waiters
                .get(connection_id)
                .is_some_and(|registration| registration.grant_id.as_deref() == Some(grant_id));
            if !matches {
                return false;
            }
            state
                .waiters
                .remove(connection_id)
                .expect("matching registration remains installed")
                .notify
        };
        notify.notify_one();
        true
    }

    pub fn terminal_if_current(
        &self,
        connection_id: &str,
        generation: u64,
    ) -> Option<DeliveryTerminalEvent> {
        let state = self.lock_state();
        let registration = state.waiters.get(connection_id)?;
        (registration.generation == generation)
            .then_some(registration.terminal)
            .flatten()
    }

    /// Run one synchronous act only while `generation` owns the connection.
    /// The notifier lock remains held through the closure, so a replacement
    /// registration cannot linearize between the ownership check and an
    /// outbox drain. Closures must follow the documented notifier→outbox lock
    /// order and must never await.
    pub fn act_if_current<T>(
        &self,
        connection_id: &str,
        generation: u64,
        act: impl FnOnce() -> T,
    ) -> Option<T> {
        let state_guard = self.lock_state();
        let current = matches!(
            state_guard.waiters.get(connection_id),
            Some(current) if current.generation == generation && current.terminal.is_none()
        );
        let output = current.then(act);
        drop(state_guard);
        output
    }

    fn act_with_registration<T>(&self, connection_id: &str, act: impl FnOnce(bool) -> T) -> T {
        let state_guard = self.lock_state();
        let output = act(state_guard.waiters.contains_key(connection_id));
        drop(state_guard);
        output
    }

    /// Whether ANY registration currently exists for the connection id
    /// (ENG-23426). After a teardown's `unregister` succeeded, the waiters
    /// map has no entry for the id, so a later presence can only mean a
    /// reconnect re-registered it — the connection's state now belongs to
    /// the new socket. `disconnect_guarded` re-checks this under each
    /// destructive step's own lock, which is what makes the check atomic
    /// with the act: a reconnect always registers *before* it subscribes,
    /// and its subscribe needs the lock the checking step holds.
    pub fn is_registered(&self, connection_id: &str) -> bool {
        self.lock_state().waiters.contains_key(connection_id)
    }

    fn wake(self: &Arc<Self>, connection_id: &str) {
        let notifier = Arc::clone(self);
        let connection_id = connection_id.to_owned();
        crate::exec_guard::run_or_defer_after_local(move || {
            notifier.wake_now(&connection_id);
        });
    }

    fn wake_at(self: &Arc<Self>, connection_id: String, deadline: std::time::Instant) {
        let notifier = Arc::clone(self);
        crate::exec_guard::run_or_defer_after_local(move || {
            let delay = deadline.saturating_duration_since(std::time::Instant::now());
            if delay.is_zero() {
                notifier.wake_now(&connection_id);
                return;
            }
            // Server transports always run inside Tokio. An embedding without
            // a runtime can still poll after the deadline; it merely has no
            // process-owned asynchronous wake source.
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                // @ref LLP 0167#observation-semantics--what-a-delay-means —
                // one server scheduler owns absolute release deadlines; the
                // queue's monotone clamp remains the FIFO authority.
                let (spawn, earlier) = {
                    let mut state = lock(&notifier.deadlines);
                    let previous_earliest = state.by_deadline.first_key_value().map(|(at, _)| *at);
                    state
                        .by_deadline
                        .entry(deadline)
                        .or_default()
                        .insert(connection_id);
                    let earliest = state.by_deadline.first_key_value().map(|(at, _)| *at);
                    let spawn = !state.running;
                    if spawn {
                        state.running = true;
                    }
                    (spawn, !spawn && earliest < previous_earliest)
                };
                if spawn {
                    #[cfg(test)]
                    notifier
                        .deadline_task_spawns
                        .fetch_add(1, Ordering::Relaxed);
                    runtime.spawn(Arc::clone(&notifier).run_deadline_scheduler());
                } else if earlier {
                    notifier.deadline_changed.notify_one();
                }
            }
        });
    }

    async fn run_deadline_scheduler(self: Arc<Self>) {
        loop {
            let next = {
                let mut state = lock(&self.deadlines);
                let Some((deadline, _)) = state.by_deadline.first_key_value() else {
                    state.running = false;
                    return;
                };
                *deadline
            };
            #[cfg(test)]
            self.deadline_timer_arms.fetch_add(1, Ordering::Relaxed);
            tokio::select! {
                _ = tokio::time::sleep_until(tokio::time::Instant::from_std(next)) => {
                    let now = std::time::Instant::now();
                    let due = {
                        let mut state = lock(&self.deadlines);
                        let deadlines = state
                            .by_deadline
                            .range(..=now)
                            .map(|(deadline, _)| *deadline)
                            .collect::<Vec<_>>();
                        let mut due = BTreeSet::new();
                        for deadline in deadlines {
                            if let Some(connections) = state.by_deadline.remove(&deadline) {
                                due.extend(connections);
                            }
                        }
                        due.into_iter().collect::<Vec<_>>()
                    };
                    self.wake_many_now(&due);
                }
                _ = self.deadline_changed.notified() => {}
            }
        }
    }

    #[cfg(test)]
    fn deadline_scheduler_counts(&self) -> (u64, u64) {
        (
            self.deadline_task_spawns.load(Ordering::Relaxed),
            self.deadline_timer_arms.load(Ordering::Relaxed),
        )
    }

    fn wake_now(&self, connection_id: &str) {
        #[cfg(any(test, feature = "test-support"))]
        self.observe_authorized_effect_for_test();
        if let Some(registration) = self.lock_state().waiters.get(connection_id) {
            registration.notify.notify_one();
        }
    }

    fn wake_many(self: &Arc<Self>, connection_ids: &[ConnectionId]) {
        if connection_ids.is_empty() {
            return;
        }
        let notifier = Arc::clone(self);
        let connection_ids = connection_ids.to_vec();
        crate::exec_guard::run_or_defer_after_local(move || {
            notifier.wake_many_now(&connection_ids);
        });
    }

    fn wake_many_now(&self, connection_ids: &[ConnectionId]) {
        #[cfg(any(test, feature = "test-support"))]
        self.observe_authorized_effect_for_test();
        let state = self.lock_state();
        for connection_id in connection_ids {
            if let Some(registration) = state.waiters.get(connection_id) {
                registration.notify.notify_one();
            }
        }
    }
}

fn retained_string_bytes(value: &str) -> usize {
    STRING_ALLOCATION_OVERHEAD.saturating_add(value.len())
}

fn retained_scope_bytes(scope: &Scope) -> usize {
    scope
        .0
        .iter()
        .fold(MAP_ENTRY_OVERHEAD, |total, (key, value)| {
            total
                .saturating_add(MAP_ENTRY_OVERHEAD)
                .saturating_add(retained_string_bytes(key))
                .saturating_add(retained_string_bytes(value))
        })
}

fn retained_owner_bytes(owner: &EntryOwner) -> usize {
    let value = match owner {
        EntryOwner::Connection(value)
        | EntryOwner::Session(value)
        | EntryOwner::User(value)
        | EntryOwner::Custom(value) => value,
    };
    retained_string_bytes(value).saturating_add(std::mem::size_of::<EntryOwner>())
}

fn retained_room_identity_bytes(room: &RoomId) -> usize {
    ROOM_STATE_OVERHEAD.saturating_add(retained_room_id_bytes(room))
}

fn retained_room_id_bytes(room: &RoomId) -> usize {
    std::mem::size_of::<RoomId>()
        .saturating_add(retained_string_bytes(&room.collection))
        .saturating_add(retained_scope_bytes(&room.scope))
        .saturating_add(retained_string_bytes(&room.routing_key))
}

fn retained_entry_bytes(key: &EntryKey, owner: &EntryOwner, value_bytes: usize) -> usize {
    ENTRY_RECORD_OVERHEAD
        .saturating_add(MAP_ENTRY_OVERHEAD)
        .saturating_add(retained_string_bytes(&key.0))
        .saturating_add(retained_owner_bytes(owner))
        .saturating_add(value_bytes)
}

fn retained_subscriber_bytes(connection_id: &str) -> usize {
    SUBSCRIBER_RECORD_OVERHEAD
        .saturating_add(MAP_ENTRY_OVERHEAD)
        .saturating_add(retained_string_bytes(connection_id))
}

fn retained_auth_context_bytes(auth: &AuthContext) -> usize {
    [
        auth.principal.as_deref(),
        auth.session_id.as_deref(),
        auth.user_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    .fold(std::mem::size_of::<AuthContext>(), |total, value| {
        total.saturating_add(retained_string_bytes(value))
    })
    .saturating_add(auth.permissions.iter().fold(0_usize, |total, permission| {
        total
            .saturating_add(MAP_ENTRY_OVERHEAD)
            .saturating_add(retained_string_bytes(permission))
    }))
}

fn retained_connection_room_edge_bytes(connection_id: &str, room: &RoomId) -> usize {
    // Charge the outer connection-map key and set allocation to every edge.
    // That deliberately overcounts connections spanning several rooms, while
    // ensuring the per-room budget covers the complete cloned reverse edge.
    2_usize
        .saturating_mul(MAP_ENTRY_OVERHEAD)
        .saturating_add(retained_string_bytes(connection_id))
        .saturating_add(retained_room_id_bytes(room))
}

fn retained_expiry_index_entry_bytes(room: &RoomId) -> usize {
    MAP_ENTRY_OVERHEAD
        .saturating_add(std::mem::size_of::<Millis>())
        .saturating_add(retained_room_id_bytes(room))
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize)]
pub enum EntryOwner {
    Connection(ConnectionId),
    Session(String),
    User(String),
    Custom(String),
}

trait AccessPolicyExt {
    fn allows(&self, scope: &Scope, auth: &AuthContext) -> bool;
}

impl AccessPolicyExt for AccessPolicy {
    fn allows(&self, scope: &Scope, auth: &AuthContext) -> bool {
        match self {
            Self::AllowAll => true,
            Self::RequireRoomPermission { prefix } => auth
                .permissions
                .contains(&format!("{prefix}:{}", scope.normalized_key())),
            Self::RequireStreamInitiator => scope
                .get("attemptToken")
                .zip(auth.stream_initiator.as_ref())
                .is_some_and(|(attempt, candidate)| {
                    crate::stream_attempt::global_stream_attempt_registry()
                        .authorize_stream_initiator(attempt, candidate)
                        .is_ok()
                }),
        }
    }
}

pub const STREAM_COLLECTION_NAME: &str = "_snapback_stream";

/// The platform-owned live chunk room. It is installed only while the served
/// function manifest contains at least one `stream: true` action.
pub fn stream_collection_definition() -> EphemeralCollection {
    EphemeralCollection {
        name: STREAM_COLLECTION_NAME.to_owned(),
        scope_fields: vec!["attemptToken".to_owned()],
        scope_contract: serde_json::json!({"kind":"object","fields":{"attemptToken":"string"}}),
        value_contract: serde_json::json!({"kind":"stream-chunk-v1"}),
        key_mode: KeyMode::Custom,
        routing_fields: vec!["attemptToken".to_owned()],
        default_ttl_ms: 30_000,
        max_ttl_ms: 30_000,
        max_value_bytes: 20 * 1024,
        hard_max_value_bytes: 20 * 1024,
        sustained_hz: crate::stream_attempt::STREAM_CHUNKS_PER_SECOND as u32,
        burst: crate::stream_attempt::STREAM_CHUNKS_PER_SECOND as u32,
        dispatch_ms: 1,
        publish: AccessPolicy::RequireRoomPermission {
            prefix: "_snapback_stream_server".to_owned(),
        },
        subscribe: AccessPolicy::RequireStreamInitiator,
        permission_backing: None,
        max_pending_ephemeral_keys: 1_024,
    }
}

/// Exact `schema.manifest.json` bytes emitted by the slice-1 codegen for the
/// minimal sessions fixture mirrored by the `allow.members` golden in
/// `packages/snapback-codegen/authoring-validation.test.mjs`. Keeping the
/// emitted artifact here makes Rust conformance tests independent of Node while
/// preserving explicit provenance; this is not a hand-built `SchemaManifest`.
#[cfg(any(test, feature = "test-support"))]
pub const CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_JSON: &str =
    include_str!("../fixtures/codegen-membership-schema-manifest.json");

// Counterpart: packages/snapback-codegen/authoring-validation.test.mjs:
// codegenEmittedMembershipManifestMatchesRustFixtureDigest.
#[cfg(any(test, feature = "test-support"))]
pub const CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_CANONICAL_SHA256: &str =
    "2670350835e52ff98a02a3c3a38a2671294ba08b42b9539a42d3d659cb8c7a1b";

/// The bound on the durable and resync outbox lanes, independent of a
/// collection's coalescing-map cap. A subscriber that never drains cannot grow
/// either lane past this; hitting it converts the queue to a single resync
/// signal.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L1.
const MAX_OUTBOX_BACKLOG: usize = 1_024;
/// One drain acquires only a bounded number of publication permits and queue
/// leases. Remaining work is re-woken as accepted/released leases settle.
const MAX_OUTBOX_DRAIN_BATCH: usize = 64;

/// Separate ceiling for one eagerly serialized transport handoff. Queue bytes
/// remain charged while a lease is unaccepted, and selection currently owns a
/// deep envelope clone plus the JSON body, so item count alone is not a memory
/// bound. The estimator below uses JSON's six-byte worst-case string escape,
/// four-byte worst-case byte-array element, and conservative structural slack;
/// selection checks it before cloning any candidate.
///
/// @ref LLP 0059#durable-and-ephemeral-outboxes — bounded selection owns at
/// most one cumulative eager handoff budget across direct and queued frames.
pub const MAX_OUTBOX_HANDOFF_BYTES: usize = 64 * 1_024 * 1_024;
const OUTBOX_HANDOFF_JSON_EXPANSION: usize = 6;
const OUTBOX_HANDOFF_ENVELOPE_OVERHEAD: usize = 1_024;
pub const OUTBOX_HANDOFF_BATCH_OVERHEAD: usize = 2;

/// A sticky overflow may need one room-scoped resync for every room whose
/// latest-state lane was discarded. Keep that recovery ledger independently
/// bounded: it may be larger than an ordinary lane, but never grows with
/// lifetime room churn while a peer refuses to drain.
const MAX_OUTBOX_OVERFLOW_RESYNCS: usize = 4_096;

/// Exact overflow markers are exceptional predecessor-cleanup state, not a
/// per-grant history. Production exposes one current consumable effect fence
/// per readable connection id; a small fixed allowance lets delayed terminal
/// cleanup coexist with that current fence without making an attacker-chosen
/// sequence of grant ids an unbounded out-of-band queue. Crossing the bound
/// collapses to one all-authority recovery signal.
///
/// @ref LLP 0059#fenced-effects-and-live-closure — only the verified current
///   fence may consume retained connection effects.
const MAX_OUTBOX_EXACT_OVERFLOW_MARKERS: usize = 8;

/// Hard retained-allocation ceiling for one connection outbox. This covers
/// durable payload buffers, resync messages, coalescing-map keys, and the
/// ephemeral message allocations themselves. The byte ceiling is shared by
/// all lanes, so three individually item-bounded lanes cannot combine into an
/// unbounded queue.
const MAX_OUTBOX_RETAINED_BYTES: usize = 64 * 1_024 * 1_024;

/// Client overlays retain at most one delete version per possible live room
/// entry. Together with the authoritative snapshot high-water this is enough
/// to reject a delayed pre-delete upsert without turning ephemeral state into
/// durable history.
const MAX_OVERLAY_TOMBSTONES: usize = 1_024;

/// The local adapter's paved-path TTL ceiling from LLP 0013. Definition
/// validation enforces it before replacing live collection state.
const LOCAL_HARD_MAX_TTL_MS: Millis = 30_000;

/// Capability-negotiated hosted ephemeral authority-instance protocol.
/// Missing offer preserves durable/local behavior and withholds hosted
/// ephemeral; unknown values refuse before a connection lineage is minted.
pub const EPHEMERAL_AUTHORITY_PROTOCOL_V1: u32 = 1;
/// Client-local monotonic expiry conversion protocol. When negotiated, every
/// final ephemeral serialization includes the server observation time used to
/// derive remaining TTL without assuming synchronized wall clocks.
pub const EPHEMERAL_EXPIRY_PROTOCOL_V1: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EphemeralAuthorityV1 {
    pub profile: String,
    pub deployment_id: String,
    pub release_id: String,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub activation_generation: u64,
    pub machine_id: String,
    pub process_boot_id: String,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub definition_generation: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EphemeralAuthorityInstanceV1 {
    pub schema_version: String,
    pub authority: EphemeralAuthorityV1,
    pub authority_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedEphemeralFactsV1 {
    pub schema_version: String,
    pub available: bool,
    pub profile: String,
    pub backend_sha256: String,
    pub implementation_sha256: String,
    pub routing_authority_sha256: String,
    pub routed_machine_count: u32,
    pub deployment_id: String,
    pub release_id: String,
    pub activation_generation: u64,
    pub process_boot_id: String,
    pub definition_generation: u64,
    pub authority_sha256: String,
    pub maximum_active_rooms: u64,
    pub maximum_entries_per_room: u64,
    pub maximum_subscribers_per_room: u64,
    pub maximum_value_bytes: u64,
    pub maximum_frame_bytes: u64,
    pub dispatch_ms: u64,
    pub auth_invalidation_protocol: u32,
    pub state_persistence: String,
    pub loss_recovery: String,
    pub durable_lane_priority: bool,
    pub excluded_from_backup: bool,
    pub excluded_from_migration: bool,
    pub excluded_from_restore: bool,
    pub nonclaims: Vec<String>,
}

// Retained ephemeral metadata is bounded independently of value payloads.
// Otherwise a 1-byte cursor with a multi-megabyte scope/key/identity can
// bypass every value-byte and entry-count budget while being copied into room
// ids, maps, owners, reverse indexes, and fan-out envelopes.
pub const MAX_EPHEMERAL_SCOPE_FIELDS: usize = 16;
pub const MAX_EPHEMERAL_COLLECTION_NAME_BYTES: usize = 64;
pub const MAX_EPHEMERAL_SCOPE_KEY_BYTES: usize = 64;
pub const MAX_EPHEMERAL_SCOPE_VALUE_BYTES: usize = 512;
pub const MAX_EPHEMERAL_SCOPE_BYTES: usize = 4 * 1_024;
pub const MAX_EPHEMERAL_IDENTITY_BYTES: usize = 256;
pub const MAX_EPHEMERAL_CONNECTION_ID_BYTES: usize = 256;
pub const MAX_EPHEMERAL_CUSTOM_KEY_BYTES: usize = 256;
pub const MAX_EPHEMERAL_PERMISSIONS: usize = 128;
pub const MAX_EPHEMERAL_PERMISSION_BYTES: usize = 1_024;
pub const MAX_EPHEMERAL_AUTH_BYTES: usize = 16 * 1_024;

const STRING_ALLOCATION_OVERHEAD: usize = 24;
const MAP_ENTRY_OVERHEAD: usize = 48;
const ROOM_STATE_OVERHEAD: usize = 256;
const ENTRY_RECORD_OVERHEAD: usize = 128;
const SUBSCRIBER_RECORD_OVERHEAD: usize = 64;
// Covers VecDeque spare slots / BTree node layout in addition to each item's
// direct allocation. The deques shrink at destructive boundaries so an empty
// queue never hides a formerly-large backing allocation from the byte ledger.
const QUEUE_ITEM_OVERHEAD: usize = 128;

/// Idempotent app-path delete settlement. Fenced withdrawal treats a stale
/// predecessor as successful supersession, never as an operational error.
///
/// @ref LLP 0247#d3-presence-has-explicit-active-and-withdrawn-states — the
/// acknowledged epoch+entry pair is checked together under the room lock.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSettlement {
    pub status: DeleteSettlementStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<EphemeralMessage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_scope_epoch: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_entry_generation: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actual_scope_epoch: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actual_entry_generation: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum DeleteSettlementStatus {
    Deleted,
    Absent,
    Superseded,
}

impl DeleteSettlement {
    fn deleted(message: EphemeralMessage) -> Self {
        Self {
            status: DeleteSettlementStatus::Deleted,
            message: Some(message),
            expected_scope_epoch: None,
            expected_entry_generation: None,
            actual_scope_epoch: None,
            actual_entry_generation: None,
        }
    }

    fn absent() -> Self {
        Self {
            status: DeleteSettlementStatus::Absent,
            message: None,
            expected_scope_epoch: None,
            expected_entry_generation: None,
            actual_scope_epoch: None,
            actual_entry_generation: None,
        }
    }

    fn superseded(
        expected_scope_epoch: u64,
        expected_entry_generation: u64,
        actual_scope_epoch: Option<u64>,
        actual_entry_generation: Option<u64>,
    ) -> Self {
        Self {
            status: DeleteSettlementStatus::Superseded,
            message: None,
            expected_scope_epoch: Some(expected_scope_epoch),
            expected_entry_generation: Some(expected_entry_generation),
            actual_scope_epoch,
            actual_entry_generation,
        }
    }

    pub fn legacy_message(self) -> Option<EphemeralMessage> {
        self.message
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct OperatorDeleteRequest {
    pub collection: String,
    pub scope: Scope,
    pub entry_key: String,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub expected_scope_epoch: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub expected_entry_generation: u64,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct PublishOutcome {
    pub room: RoomId,
    pub key: EntryKey,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub scope_epoch: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub entry_version: u64,
    pub expires_at_ms: Millis,
}

fn retained_ephemeral_entry_message_bytes(entry: &EphemeralEntry) -> usize {
    std::mem::size_of::<EphemeralEntry>()
        .saturating_add(retained_string_bytes(&entry.key.0))
        .saturating_add(entry.value.capacity())
}

fn retained_ephemeral_message_bytes(message: &EphemeralMessage) -> usize {
    let body = match message {
        EphemeralMessage::Snapshot { room, entries, .. } => entries.iter().fold(
            retained_room_id_bytes(room).saturating_add(
                std::mem::size_of::<EphemeralEntry>().saturating_mul(entries.capacity()),
            ),
            |total, entry| total.saturating_add(retained_ephemeral_entry_message_bytes(entry)),
        ),
        EphemeralMessage::Upsert { room, entry, .. } => retained_room_id_bytes(room)
            .saturating_add(retained_ephemeral_entry_message_bytes(entry)),
        EphemeralMessage::Remove { room, key, .. } => {
            retained_room_id_bytes(room).saturating_add(retained_string_bytes(&key.0))
        }
        EphemeralMessage::ResyncRequired { room, .. } => retained_room_id_bytes(room),
        EphemeralMessage::Error { room, error, .. } => room
            .as_ref()
            .map_or(0, retained_room_id_bytes)
            .saturating_add(retained_string_bytes(&error.message)),
    };
    std::mem::size_of::<EphemeralMessage>()
        .saturating_add(std::mem::size_of::<Arc<EphemeralMessage>>())
        .saturating_add(body)
}

fn retained_durable_queue_item_bytes(message: &DurableMessage) -> usize {
    QUEUE_ITEM_OVERHEAD
        .saturating_add(std::mem::size_of::<DurableMessage>())
        .saturating_add(message.payload.capacity())
}

pub fn estimated_durable_handoff_bytes(message: &DurableMessage) -> usize {
    retained_durable_queue_item_bytes(message)
        .saturating_mul(OUTBOX_HANDOFF_JSON_EXPANSION)
        .saturating_add(OUTBOX_HANDOFF_ENVELOPE_OVERHEAD)
}

fn estimated_ephemeral_handoff_bytes(message: &EphemeralMessage) -> usize {
    retained_ephemeral_message_bytes(message)
        .saturating_mul(OUTBOX_HANDOFF_JSON_EXPANSION)
        .saturating_add(OUTBOX_HANDOFF_ENVELOPE_OVERHEAD)
}

#[cfg(test)]
pub(crate) fn estimated_envelope_handoff_bytes(envelope: &RealtimeEnvelope) -> usize {
    match envelope {
        RealtimeEnvelope::Durable(message) => estimated_durable_handoff_bytes(message),
        RealtimeEnvelope::Ephemeral(message) => estimated_ephemeral_handoff_bytes(message),
    }
}

fn retained_effect_fence_backing_bytes(effect_fence: &ConnectionEffectFence) -> usize {
    // Each Arc allocation retains the string bytes plus the strong/weak
    // counters. The Arc handles themselves are already part of the marker's
    // ConnectionEffectFence value.
    let arc_allocation = |value: &Arc<str>| {
        value
            .len()
            .saturating_add(std::mem::size_of::<usize>().saturating_mul(2))
    };
    arc_allocation(&effect_fence.authorization_stream_incarnation)
        .saturating_add(arc_allocation(&effect_fence.connection_grant_id))
        .saturating_add(match &effect_fence.authority {
            ConnectionEffectAuthority::Anonymous => 0,
            ConnectionEffectAuthority::Session { session_id, .. } => arc_allocation(session_id),
            ConnectionEffectAuthority::ServicePrincipal { token_id } => arc_allocation(token_id),
        })
}

fn retained_outbox_lease_binding_bytes(effect_fence: &ConnectionEffectFence) -> usize {
    MAP_ENTRY_OVERHEAD
        .saturating_add(std::mem::size_of::<ConnectionEffectFence>())
        .saturating_add(retained_effect_fence_backing_bytes(effect_fence))
}

/// Charge an out-of-band marker as the durable recovery frame it promises to
/// materialize plus the BTree node and Arc backing that keep its exact fence
/// alive. This is intentionally conservative: diagnostics and admission must
/// never hide marker memory merely because the wire payload is synthesized at
/// drain time.
fn retained_exact_overflow_marker_bytes(effect_fence: &ConnectionEffectFence) -> usize {
    retained_durable_queue_item_bytes(&overflow_sentinel(Some(effect_fence.clone())))
        .saturating_add(MAP_ENTRY_OVERHEAD)
        .saturating_add(retained_effect_fence_backing_bytes(effect_fence))
        .saturating_add(retained_marker_lease_index_bytes())
}

fn retained_global_overflow_signal_bytes() -> usize {
    retained_durable_queue_item_bytes(&overflow_sentinel(None))
        .saturating_add(retained_marker_lease_index_bytes())
}

fn retained_marker_lease_index_bytes() -> usize {
    MAP_ENTRY_OVERHEAD
        .saturating_add(std::mem::size_of::<OverflowMarkerLeaseKey>())
        .saturating_add(std::mem::size_of::<u64>())
}

fn retained_resync_queue_item_bytes(message: &EphemeralMessage) -> usize {
    QUEUE_ITEM_OVERHEAD.saturating_add(retained_ephemeral_message_bytes(message))
}

fn retained_ephemeral_queue_item_bytes(
    room: &RoomId,
    entry_key: &EntryKey,
    message: &EphemeralMessage,
) -> usize {
    MAP_ENTRY_OVERHEAD
        .saturating_add(retained_room_id_bytes(room))
        .saturating_add(retained_string_bytes(&entry_key.0))
        .saturating_add(retained_ephemeral_message_bytes(message))
}

#[derive(Clone, Debug)]
struct QueuedDurableMessage {
    message: Arc<DurableMessage>,
    lease_id: Option<u64>,
}

impl QueuedDurableMessage {
    fn new(message: DurableMessage) -> Self {
        Self {
            message: Arc::new(message),
            lease_id: None,
        }
    }
}

#[derive(Clone, Debug)]
struct QueuedEphemeralMessage {
    message: Arc<EphemeralMessage>,
    effect_fence: Option<ConnectionEffectFence>,
    lease_id: Option<u64>,
}

impl QueuedEphemeralMessage {
    fn new(message: Arc<EphemeralMessage>, effect_fence: Option<ConnectionEffectFence>) -> Self {
        Self {
            message,
            effect_fence,
            lease_id: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CollectionEnsureOutcome {
    pub collection_count: usize,
    pub preserved_room_count: usize,
    pub preserved_outbox_count: usize,
}

struct OutboxLeaseWake {
    delivery: Arc<DeliveryNotifier>,
    connection_id: Arc<str>,
}

struct OutboxDrainLeaseInner {
    outbox: SharedOutbox,
    lease_id: u64,
    wake: Arc<OutboxLeaseWake>,
    recovery_marker_priority: Option<RecoveryMarkerPriority>,
}

impl Drop for OutboxDrainLeaseInner {
    fn drop(&mut self) {
        let released = lock(&self.outbox).release_lease(self.lease_id);
        if released {
            self.wake.delivery.wake(&self.wake.connection_id);
        }
    }
}

/// Idempotent ownership token for one physically retained outbox frame. The
/// frame remains in queue order until a bounded transport handoff accepts it;
/// dropping the last token merely makes it eligible for a later drain.
pub struct OutboxDrainLease {
    inner: Arc<OutboxDrainLeaseInner>,
    publication_validity: Option<RealtimePublicationValidity>,
    ack_on_drop: bool,
}

pub enum OutboxLeaseCommit<T> {
    Committed,
    Superseded(T),
    OfferFailed(T),
}

impl OutboxDrainLease {
    fn new(
        outbox: SharedOutbox,
        lease_id: u64,
        wake: Arc<OutboxLeaseWake>,
        recovery_marker_priority: Option<RecoveryMarkerPriority>,
        publication_validity: Option<RealtimePublicationValidity>,
    ) -> Self {
        Self {
            inner: Arc::new(OutboxDrainLeaseInner {
                outbox,
                lease_id,
                wake,
                recovery_marker_priority,
            }),
            publication_validity,
            ack_on_drop: true,
        }
    }

    fn release_on_drop(mut self) -> Self {
        self.ack_on_drop = false;
        self
    }

    /// Validate the lease and synchronously offer its complete frame while the
    /// outbox lock excludes overflow, purge, and coalescing replacement. The
    /// failed value is returned only after the queue has released the lease;
    /// callers must drop publication permits outside this lock.
    pub fn try_commit<T>(
        &self,
        value: T,
        offer: impl FnOnce(T) -> Result<(), T>,
    ) -> OutboxLeaseCommit<T> {
        let _publication_handoff = match self.publication_validity.as_ref() {
            Some(validity) => match validity.begin_handoff() {
                Ok(handoff) => Some(handoff),
                Err(_) => {
                    let released = lock(&self.inner.outbox).release_lease(self.inner.lease_id);
                    if released {
                        self.inner
                            .wake
                            .delivery
                            .wake(&self.inner.wake.connection_id);
                    }
                    return OutboxLeaseCommit::Superseded(value);
                }
            },
            None => None,
        };
        let mut outbox = lock(&self.inner.outbox);
        if !outbox.lease_is_current(self.inner.lease_id) {
            return OutboxLeaseCommit::Superseded(value);
        }
        if outbox.recovery_marker_preempts(
            outbox.active_lease_effect_fence.as_ref(),
            self.inner.recovery_marker_priority,
        ) {
            // A cross-domain overflow can leave this ordinary lease current
            // while installing a recovery marker eligible to the same drain.
            // Release before returning so the marker can win the next drain.
            outbox.release_lease(self.inner.lease_id);
            return OutboxLeaseCommit::Superseded(value);
        }
        match offer(value) {
            Ok(()) => {
                let removed = outbox.acknowledge_leases(&[self.inner.lease_id]);
                debug_assert!(removed);
                OutboxLeaseCommit::Committed
            }
            Err(value) => {
                outbox.release_lease(self.inner.lease_id);
                OutboxLeaseCommit::OfferFailed(value)
            }
        }
    }

    pub fn wake(&self) {
        self.inner
            .wake
            .delivery
            .wake(&self.inner.wake.connection_id);
    }

    fn acknowledge(&self) -> bool {
        let _publication_handoff = match self.publication_validity.as_ref() {
            Some(validity) => match validity.begin_handoff() {
                Ok(handoff) => Some(handoff),
                Err(_) => {
                    let released = lock(&self.inner.outbox).release_lease(self.inner.lease_id);
                    if released {
                        self.inner
                            .wake
                            .delivery
                            .wake(&self.inner.wake.connection_id);
                    }
                    return false;
                }
            },
            None => None,
        };
        let (removed, marker_preempted) = {
            let mut outbox = lock(&self.inner.outbox);
            if outbox.recovery_marker_preempts(
                outbox.active_lease_effect_fence.as_ref(),
                self.inner.recovery_marker_priority,
            ) {
                (false, outbox.release_lease(self.inner.lease_id))
            } else {
                (outbox.acknowledge_leases(&[self.inner.lease_id]), false)
            }
        };
        if removed || marker_preempted {
            self.inner
                .wake
                .delivery
                .wake(&self.inner.wake.connection_id);
        }
        removed
    }

    /// Commit a complete HTTP batch at its response-body ownership boundary.
    /// All leases must name the same outbox and remain current; otherwise none
    /// are removed and dropping the handles releases them for a later poll.
    pub fn acknowledge_all(leases: &[Self]) -> bool {
        let Some(first) = leases.first() else {
            return true;
        };
        if leases
            .iter()
            .any(|lease| !Arc::ptr_eq(&first.inner.outbox, &lease.inner.outbox))
        {
            return false;
        }
        let Ok(_publication_handoffs) = leases
            .iter()
            .filter_map(|lease| lease.publication_validity.as_ref())
            .map(RealtimePublicationValidity::begin_handoff)
            .collect::<Result<Vec<_>, _>>()
        else {
            return false;
        };
        let ids = leases
            .iter()
            .map(|lease| lease.inner.lease_id)
            .collect::<Vec<_>>();
        let batch_marker_priority = leases
            .first()
            .and_then(|lease| lease.inner.recovery_marker_priority);
        if leases
            .iter()
            .any(|lease| lease.inner.recovery_marker_priority != batch_marker_priority)
        {
            return false;
        }
        let removed = {
            let mut outbox = lock(&first.inner.outbox);
            if outbox.recovery_marker_preempts(
                outbox.active_lease_effect_fence.as_ref(),
                batch_marker_priority,
            ) {
                false
            } else {
                outbox.acknowledge_leases(&ids)
            }
        };
        if removed {
            first
                .inner
                .wake
                .delivery
                .wake(&first.inner.wake.connection_id);
        }
        removed
    }
}

impl Drop for OutboxDrainLease {
    fn drop(&mut self) {
        if self.ack_on_drop {
            let _ = self.acknowledge();
        }
    }
}

/// One leased transport frame paired with the publication permit that made
/// its selection admissible. Keep this value alive until the final transport
/// handoff: a concurrently prepared authorization commit waits for durable
/// authorization and protected-room publications alike.
///
/// Embeddings can serialize [`Self::envelope`] while retaining this wrapper.
/// For compatibility with the formerly destructive public drain, ordinary
/// wrapper drop is an accepted handoff and acknowledges the frame; a sink that
/// cancels or rejects must explicitly call [`Self::release_handoff`] so the
/// frame retries. Built-in transports use an internal release-on-drop lease
/// until their exact synchronous acceptance boundary.
#[must_use = "an admitted realtime frame must remain alive through its final transport sink"]
pub struct AdmittedRealtimeEnvelope {
    envelope: RealtimeEnvelope,
    // Field drop order is semantic: compatibility Drop acknowledges the lease
    // while the publication permit below is still live. Reversing these two
    // fields opens a revocation/marker cut between sink acceptance and ack.
    lease: OutboxDrainLease,
    publication_authority: Option<RealtimePublicationPermit>,
    recovery_marker: bool,
}

impl AdmittedRealtimeEnvelope {
    pub fn envelope(&self) -> &RealtimeEnvelope {
        &self.envelope
    }

    pub fn is_recovery_marker(&self) -> bool {
        self.recovery_marker
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn into_parts(self) -> (RealtimeEnvelope, Option<RealtimePublicationPermit>) {
        self.try_into_parts()
            .expect("infallible admitted conversion lost its outbox lease")
    }

    pub(crate) fn try_into_parts(
        self,
    ) -> Option<(RealtimeEnvelope, Option<RealtimePublicationPermit>)> {
        self.lease
            .acknowledge()
            .then_some((self.envelope, self.publication_authority))
    }

    pub fn into_leased_parts(
        self,
    ) -> (
        RealtimeEnvelope,
        Option<RealtimePublicationPermit>,
        OutboxDrainLease,
    ) {
        (
            self.envelope,
            self.publication_authority,
            self.lease.release_on_drop(),
        )
    }

    /// Confirm that an embedding-owned final sink accepted this selected frame.
    /// Ordinary wrapper drop has the same success semantics for compatibility.
    pub fn commit_handoff(self) -> bool {
        self.lease.acknowledge()
    }

    /// Explicitly reject a selected frame so a later drain can retry it.
    pub fn release_handoff(self) {
        drop(self.lease.release_on_drop());
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EphemeralDiagnostics {
    pub room_count: usize,
    pub entry_count: usize,
    pub subscriber_count: usize,
    pub value_bytes: usize,
    /// All retained room/index allocations plus queued delivery allocations.
    pub retained_bytes: usize,
    /// The queued-delivery portion of `retained_bytes`.
    pub outbox_retained_bytes: usize,
    pub active_rooms: Vec<EphemeralRoomDiagnostics>,
    pub pending_ephemeral_keys: usize,
    /// Physical durable frames plus out-of-band overflow/poison signals that
    /// will materialize as durable clear-retained frames at an eligible drain.
    pub pending_durable_messages: usize,
    pub pending_resync_messages: usize,
    pub rejected_publishes: u64,
    pub rate_limited_publishes: u64,
    pub oversized_publishes: u64,
    pub unauthorized_requests: u64,
    /// Publish/delete/subscribe/unsubscribe requests rejected by the common
    /// metadata byte/cardinality bounds before they could allocate room state.
    pub metadata_rejections: u64,
    pub expired_entries: u64,
    pub disconnected_entries: u64,
    pub coalesced_updates: u64,
    pub resync_required: u64,
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L1: count of
    // outbox lanes that hit their bound and converted to a resync signal.
    pub outbox_overflows: u64,
    /// Operations rejected by a hard room/store limit (L9). Structured
    /// rejection, never silent eviction.
    ///
    /// @ref LLP 0026#limits-and-diagnostics — limits are capability facts.
    #[serde(default)]
    pub limit_rejections: u64,
    /// Room/scope/entry identities that reached the final portable integer.
    /// Void maintenance paths cannot return an error, so they retain this
    /// typed diagnostic while terminally retiring the affected room.
    #[serde(default)]
    pub generation_exhaustions: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_generation_exhaustion: Option<EphemeralError>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EphemeralRoomDiagnostics {
    pub collection: String,
    pub routing_key: String,
    pub scope: Scope,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub scope_epoch: u64,
    pub entries: usize,
    pub subscribers: usize,
    pub value_bytes: usize,
    pub retained_bytes: usize,
}

/// Counts captured by one room-linearized operator cleanup pass.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EphemeralCleanupCounts {
    pub examined: usize,
    pub eligible: usize,
    pub would_delete: usize,
    pub deleted: usize,
    pub remaining: usize,
}

impl EphemeralCleanupCounts {
    fn add_assign(&mut self, other: &Self) {
        self.examined = self.examined.saturating_add(other.examined);
        self.eligible = self.eligible.saturating_add(other.eligible);
        self.would_delete = self.would_delete.saturating_add(other.would_delete);
        self.deleted = self.deleted.saturating_add(other.deleted);
        self.remaining = self.remaining.saturating_add(other.remaining);
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EphemeralCleanupRoomReport {
    /// Stable digest of the complete room identity. Raw scope/routing values
    /// never enter the operator receipt.
    pub room_digest: String,
    pub counts: EphemeralCleanupCounts,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EphemeralCleanupCollectionReport {
    pub collection: String,
    pub counts: EphemeralCleanupCounts,
    pub rooms: Vec<EphemeralCleanupRoomReport>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EphemeralCleanupReport {
    pub counts: EphemeralCleanupCounts,
    pub collections: Vec<EphemeralCleanupCollectionReport>,
    pub truncated: bool,
    pub complete: bool,
    pub blocked_rooms: usize,
}

#[derive(Clone, Debug)]
struct EntryRecord {
    owner: EntryOwner,
    value: Vec<u8>,
    received_at_ms: Millis,
    expires_at_ms: Millis,
    scope_epoch: u64,
    entry_version: u64,
    retained_bytes: usize,
}

impl EntryRecord {
    fn to_entry(&self, key: &EntryKey) -> EphemeralEntry {
        EphemeralEntry {
            key: key.clone(),
            value: self.value.clone(),
            received_at_ms: self.received_at_ms,
            expires_at_ms: self.expires_at_ms,
            scope_epoch: self.scope_epoch,
            entry_version: self.entry_version,
        }
    }
}

#[derive(Clone, Debug)]
struct SubscriberState {
    outbox: SharedOutbox,
    auth: AuthContext,
    effect_fence: Option<ConnectionEffectFence>,
    retained_bytes: usize,
}

#[derive(Clone, Debug)]
struct RoomState {
    scope_epoch: u64,
    next_entry_version: u64,
    entries: BTreeMap<EntryKey, EntryRecord>,
    owner_connections: BTreeMap<EntryOwner, BTreeSet<ConnectionId>>,
    subscribers: BTreeMap<ConnectionId, SubscriberState>,
    owner_connection_count: usize,
    /// Exact per-room expiry counts. `indexed_deadline` is allowed to be a
    /// stale lower bound so the global cleanup index can wake early; this map
    /// is the room-local truth used to skip no-op hot-path sweeps.
    expiry_counts: BTreeMap<Millis, usize>,
    /// Running payload-only bytes for diagnostics.
    value_bytes: usize,
    /// Conservative accounting for every retained room allocation: room/scope
    /// identity, entry key/owner/value records, owner-connection edges, and
    /// subscriber identities. `max_room_value_bytes` historically named this
    /// limit; admission now applies it to the complete retained footprint.
    retained_bytes: usize,
    /// This room's entry in the store's expiry index — a lower bound on the
    /// room's earliest entry expiry, or `None` when the room is unindexed.
    ///
    /// @ref LLP 0026#as-built-sharded-local-room-authority-written-2026-07-02-before-the-l9-implementation — expiry index.
    indexed_deadline: Option<Millis>,
    /// Set (under the routing-map and room locks together) when the room is
    /// removed from the routing map. An operation that acquired this room's
    /// lock through a now-stale `Arc` must re-consult the map instead of
    /// mutating a detached room.
    retired: bool,
}

impl RoomState {
    /// Each room incarnation gets a fresh `scope_epoch` from the store-global
    /// allocator, so a room destroyed and re-created can never be
    /// stale-compared against entries from an earlier incarnation.
    ///
    /// @ref LLP 0013#stored-entry-shape — epoch change signals lost sequencing continuity.
    fn new(scope_epoch: u64, retained_bytes: usize) -> Self {
        Self {
            scope_epoch,
            next_entry_version: 1,
            entries: BTreeMap::new(),
            owner_connections: BTreeMap::new(),
            subscribers: BTreeMap::new(),
            owner_connection_count: 0,
            expiry_counts: BTreeMap::new(),
            value_bytes: 0,
            retained_bytes,
            indexed_deadline: None,
            retired: false,
        }
    }

    /// @ref LLP 0013#stored-entry-shape — the final JavaScript-safe entry version is usable; its successor retires the incarnation.
    fn ensure_version_capacity(&self, count: usize) -> Result<(), EphemeralError> {
        let count = u64::try_from(count).map_err(|_| generation_exhausted_error())?;
        if count == 0 {
            return Ok(());
        }
        self.next_entry_version
            .checked_add(count - 1)
            .filter(|last| *last <= crate::manifest::PORTABLE_STORAGE_VERSION_MAX)
            .map(|_| ())
            .ok_or_else(generation_exhausted_error)
    }

    fn allocate_version(&mut self) -> u64 {
        let version = self.next_entry_version;
        self.next_entry_version = self
            .next_entry_version
            .checked_add(1)
            .expect("entry-version capacity is preflighted before room mutation");
        version
    }

    fn owner_connection_additional_bytes(&self, owner: &EntryOwner, connection_id: &str) -> usize {
        match self.owner_connections.get(owner) {
            Some(connections) if connections.contains(connection_id) => 0,
            Some(_) => retained_string_bytes(connection_id) + MAP_ENTRY_OVERHEAD,
            None => {
                retained_owner_bytes(owner)
                    + retained_string_bytes(connection_id)
                    + 2 * MAP_ENTRY_OVERHEAD
            }
        }
    }

    fn uses_connection(&self, connection_id: &str) -> bool {
        self.subscribers.contains_key(connection_id)
            || self
                .owner_connections
                .values()
                .any(|connections| connections.contains(connection_id))
    }

    fn remember_owner_connection(&mut self, owner: &EntryOwner, connection_id: &str) {
        if self
            .owner_connections
            .entry(owner.clone())
            .or_default()
            .insert(connection_id.to_owned())
        {
            self.owner_connection_count += 1;
        }
    }
}

#[derive(Clone, Debug)]
struct RateBucket {
    tokens_milli: u64,
    last_refill_ms: Millis,
}

impl RateBucket {
    fn new(collection: &EphemeralCollection, now_ms: Millis) -> Self {
        Self {
            tokens_milli: u64::from(collection.burst).saturating_mul(1_000),
            last_refill_ms: now_ms,
        }
    }

    fn allow(&mut self, collection: &EphemeralCollection, now_ms: Millis) -> bool {
        let elapsed = now_ms.saturating_sub(self.last_refill_ms);
        let refill = elapsed.saturating_mul(u64::from(collection.sustained_hz));
        let capacity = u64::from(collection.burst).saturating_mul(1_000);
        self.tokens_milli = self.tokens_milli.saturating_add(refill).min(capacity);
        self.last_refill_ms = now_ms;

        if self.tokens_milli < 1_000 {
            return false;
        }

        self.tokens_milli -= 1_000;
        true
    }
}

#[derive(Clone, Debug)]
struct OutboundQueue {
    durable: VecDeque<QueuedDurableMessage>,
    resync: VecDeque<QueuedEphemeralMessage>,
    // Coalescing includes the exact producer fence. A delayed predecessor
    // update for the same room/key must not overwrite its successor's frame.
    ephemeral: BTreeMap<(RoomId, EntryKey, Option<ConnectionEffectFence>), QueuedEphemeralMessage>,
    durable_bytes: usize,
    resync_bytes: usize,
    ephemeral_bytes: usize,
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L1: the durable
    // and resync lanes are bounded like the ephemeral map. A subscriber that
    // never drains cannot accumulate unbounded query-result payloads; a lane at
    // capacity converts the affected authority domain to one out-of-band resync
    // signal (sticky until its eligible drain), never a silent drop.
    overflowed: bool,
    overflowed_effect_fences: BTreeSet<ConnectionEffectFence>,
    /// Conservative retained bytes for every out-of-band exact/unbound marker
    /// or for the single all-authority poison signal. Unlike the physical lane
    /// ledgers, these bytes describe recovery state synthesized at drain time.
    overflow_marker_bytes: usize,
    /// Count/byte exhaustion of the exact marker ledger cannot silently evict
    /// one authority's recovery obligation. Collapse every authority domain to
    /// this one fail-closed signal, park all new effects, and let only a
    /// verified current exact drain consume it.
    all_authorities_poisoned: bool,
    overflow_marker_leases: BTreeMap<OverflowMarkerLeaseKey, u64>,
    /// Exact grant that selected the one globally active lease batch. This is
    /// independent of each frame's producer fence: an authority-independent
    /// frame or global recovery marker selected for HTTP still belongs to the
    /// selecting grant until response ownership accepts it. Exact predecessor
    /// purge invalidates the batch without discarding those underlying bytes.
    active_lease_effect_fence: Option<ConnectionEffectFence>,
    active_lease_binding_bytes: usize,
    next_drain_lease_id: u64,
    /// Last prepared durable deadline for this readable connection. New
    /// items clamp against it, producing pipeline latency rather than N x D
    /// head-of-line service.
    last_durable_release: Option<std::time::Instant>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FrameAuthorityDisposition {
    Send,
    Retain,
    DropStale,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum OverflowMarkerLeaseKey {
    Unbound,
    Exact(ConnectionEffectFence),
    Poison,
}

/// Marker ordering at a single exact publication cut. A later broader marker
/// must supersede a lower-ranked selected marker just as every marker
/// supersedes ordinary data.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum RecoveryMarkerPriority {
    Exact,
    Unbound,
    Poison,
}

#[derive(Clone, Debug)]
struct SelectedOutboxLease {
    lease_id: u64,
    envelope: RealtimeEnvelope,
    recovery_marker_priority: Option<RecoveryMarkerPriority>,
}

/// Apply the connection-incarnation fence before any room or durable-stream
/// authority check. Authority-independent frames remain eligible for the
/// ordinary classifier. A bound frame is visible only to its exact grant;
/// an unbound compatibility drain retains it, and a successor grant drops it
/// as stale rather than adopting effects produced by the predecessor.
fn effect_fence_disposition(
    actual: Option<&ConnectionEffectFence>,
    expected: Option<&ConnectionEffectFence>,
) -> Option<FrameAuthorityDisposition> {
    match (actual, expected) {
        (None, _) => None,
        (Some(actual), Some(expected)) if actual == expected => None,
        (Some(_), Some(_)) => Some(FrameAuthorityDisposition::DropStale),
        (Some(_), None) => Some(FrameAuthorityDisposition::Retain),
    }
}

fn overflow_sentinel(effect_fence: Option<ConnectionEffectFence>) -> DurableMessage {
    // Typed since ENG-23891 (LLP 0051 D4). Wire note: the pre-typed frame
    // spelled this field `clearRetained`; the typed envelope unified it to
    // the durable lane's `clear_retained` (no shipped client read it).
    let payload = serde_json::to_vec(&crate::live_wire::LiveEnvelope::ResyncRequired {
        network_profile: None,
        reason: "outbox_overflow".to_owned(),
        subscription_id: None,
        scope: None,
        epoch: None,
        clear_retained: true,
    })
    .unwrap_or_default();
    match effect_fence {
        Some(effect_fence) => DurableMessage::bound(payload, effect_fence),
        None => DurableMessage::new(payload),
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct QueueOverflow {
    overflowed: bool,
    resync_count: usize,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct QueuePush {
    coalesced: bool,
    resync_count: usize,
    overflowed: bool,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct DurableEnqueueOutcome {
    /// This enqueue crossed the bounded queue into sticky overflow.
    pub overflowed_now: bool,
    /// The payload is represented only by the sticky overflow sentinel (the
    /// queue was already overflowed or became overflowed on this enqueue).
    pub parked_behind_overflow: bool,
}

impl OutboundQueue {
    fn new() -> Self {
        Self {
            durable: VecDeque::new(),
            resync: VecDeque::new(),
            ephemeral: BTreeMap::new(),
            durable_bytes: 0,
            resync_bytes: 0,
            ephemeral_bytes: 0,
            overflowed: false,
            overflowed_effect_fences: BTreeSet::new(),
            overflow_marker_bytes: 0,
            all_authorities_poisoned: false,
            overflow_marker_leases: BTreeMap::new(),
            active_lease_effect_fence: None,
            active_lease_binding_bytes: 0,
            next_drain_lease_id: 1,
            last_durable_release: None,
        }
    }

    fn is_overflowed(&self, effect_fence: Option<&ConnectionEffectFence>) -> bool {
        self.all_authorities_poisoned
            || effect_fence.map_or(self.overflowed, |effect_fence| {
                self.overflowed_effect_fences.contains(effect_fence)
            })
    }

    fn recompute_overflow_marker_bytes(&mut self) {
        self.overflow_marker_bytes = if self.all_authorities_poisoned {
            retained_global_overflow_signal_bytes()
        } else {
            self.overflowed_effect_fences.iter().fold(
                if self.overflowed {
                    retained_global_overflow_signal_bytes()
                } else {
                    0
                },
                |total, effect_fence| {
                    total.saturating_add(retained_exact_overflow_marker_bytes(effect_fence))
                },
            )
        };
    }

    fn recompute_retained_bytes(&mut self) {
        self.durable_bytes = self.durable.iter().fold(0, |total, queued| {
            total.saturating_add(retained_durable_queue_item_bytes(queued.message.as_ref()))
        });
        self.resync_bytes = self.resync.iter().fold(0, |total, message| {
            total.saturating_add(retained_resync_queue_item_bytes(message.message.as_ref()))
        });
        self.ephemeral_bytes = self.ephemeral.iter().fold(0, |total, (key, message)| {
            total.saturating_add(retained_ephemeral_queue_item_bytes(
                &key.0,
                &key.1,
                message.message.as_ref(),
            ))
        });
        self.last_durable_release = self
            .durable
            .iter()
            .filter_map(|queued| queued.message.release_at())
            .max();
    }

    fn retained_bytes(&self) -> usize {
        self.durable_bytes
            .saturating_add(self.resync_bytes)
            .saturating_add(self.ephemeral_bytes)
            .saturating_add(self.overflow_marker_bytes)
            .saturating_add(self.active_lease_binding_bytes)
    }

    fn compact_lane_storage(&mut self) {
        // `QUEUE_ITEM_OVERHEAD` covers at least one spare inline slot per live
        // item. Rebuild after destructive acknowledgements once geometric slack
        // would exceed that proof; an empty lane always releases all backing.
        if self.durable.is_empty() || self.durable.capacity() > self.durable.len().saturating_mul(2)
        {
            self.durable.shrink_to_fit();
        }
        if self.resync.is_empty() || self.resync.capacity() > self.resync.len().saturating_mul(2) {
            self.resync.shrink_to_fit();
        }
    }

    fn fits_bytes(&self, removed: usize, added: usize) -> bool {
        self.retained_bytes()
            .saturating_sub(removed)
            .saturating_add(added)
            <= MAX_OUTBOX_RETAINED_BYTES
    }

    /// Replace every physical lane and scoped marker with one bounded global
    /// recovery obligation. This is the fail-closed escape hatch for marker or
    /// room-recovery ledger exhaustion: preserving an arbitrary subset would
    /// silently choose which authority is allowed to remain stale.
    fn poison_all_authorities(&mut self) -> bool {
        if self.all_authorities_poisoned {
            return false;
        }
        self.durable = VecDeque::new();
        self.resync = VecDeque::new();
        self.ephemeral = BTreeMap::new();
        self.durable_bytes = 0;
        self.resync_bytes = 0;
        self.ephemeral_bytes = 0;
        self.overflowed = false;
        self.overflowed_effect_fences = BTreeSet::new();
        self.overflow_marker_leases.clear();
        self.active_lease_effect_fence = None;
        self.active_lease_binding_bytes = 0;
        self.last_durable_release = None;
        self.all_authorities_poisoned = true;
        self.recompute_overflow_marker_bytes();
        debug_assert!(self.retained_bytes() <= MAX_OUTBOX_RETAINED_BYTES);
        true
    }

    /// Install one scoped overflow obligation. `true` means the requested
    /// marker could not fit its explicit count/byte budget and the queue was
    /// instead collapsed to the all-authority poison signal.
    fn install_overflow_marker(&mut self, effect_fence: Option<&ConnectionEffectFence>) -> bool {
        let marker_bytes = effect_fence.map_or_else(
            retained_global_overflow_signal_bytes,
            retained_exact_overflow_marker_bytes,
        );
        let count_exhausted = effect_fence.is_some()
            && self.overflowed_effect_fences.len() >= MAX_OUTBOX_EXACT_OVERFLOW_MARKERS;
        if count_exhausted || !self.fits_bytes(0, marker_bytes) {
            self.poison_all_authorities();
            return true;
        }
        if let Some(effect_fence) = effect_fence {
            self.overflowed_effect_fences.insert(effect_fence.clone());
        } else {
            self.overflowed = true;
        }
        self.recompute_overflow_marker_bytes();
        false
    }

    /// Convert one queue authority domain to a durable resync signal: the
    /// connection is too far behind to replay its backlog, so drop its pending
    /// state and tell the client to re-snapshot rather than losing updates
    /// silently. Signals live in out-of-band sticky state so one authority
    /// domain's physical backlog cannot consume another domain's signal
    /// capacity. Exact signals are materialized only by their matching drain;
    /// the authority-independent signal is visible to any drain.
    ///
    /// @ref LLP 0008#realtime-delivery — overflow is a resync signal, never a drop.
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L1.
    fn overflow(
        &mut self,
        extra_ephemeral: Option<&EphemeralMessage>,
        effect_fence: Option<ConnectionEffectFence>,
    ) -> QueueOverflow {
        if self.is_overflowed(effect_fence.as_ref()) {
            return QueueOverflow::default();
        }
        let mut resync_epochs = self.pending_resync_epochs(effect_fence.as_ref());
        if let Some(message) = extra_ephemeral
            && let Some((room, scope_epoch)) = message.resync_room_epoch()
            && let Some((_, room_authority_generation)) = message
                .room_authority()
                .map(|(room, generation)| (room.clone(), generation))
        {
            resync_epochs.insert(room, (scope_epoch, room_authority_generation));
        }
        // Overflow belongs to one exact grant. Clearing the whole shared
        // readable-id queue would let a delayed predecessor destroy a
        // successor's frames.
        self.durable
            .retain(|queued| queued.message.effect_fence() != effect_fence.as_ref());
        self.resync
            .retain(|message| message.effect_fence.as_ref() != effect_fence.as_ref());
        self.ephemeral
            .retain(|_, message| message.effect_fence.as_ref() != effect_fence.as_ref());
        self.durable.shrink_to_fit();
        self.resync.shrink_to_fit();
        self.recompute_retained_bytes();
        self.clear_active_lease_binding_if_idle();
        if self.install_overflow_marker(effect_fence.as_ref()) {
            return QueueOverflow {
                overflowed: true,
                resync_count: 0,
            };
        }
        let mut resync_count = 0;
        for (room, (scope_epoch, room_authority_generation)) in resync_epochs {
            resync_count += self.record_overflow_resync_for_room(
                room,
                scope_epoch,
                room_authority_generation,
                effect_fence.clone(),
            );
            if self.all_authorities_poisoned {
                // The global signal supersedes every room-specific recovery
                // frame, all of which were cleared by the collapse.
                resync_count = 0;
                break;
            }
        }
        QueueOverflow {
            overflowed: true,
            resync_count,
        }
    }

    /// Push a non-coalescable message (resync/remove) into the resync lane,
    /// escalating to a full overflow signal if the lane is at capacity.
    fn push_resync(
        &mut self,
        message: Arc<EphemeralMessage>,
        effect_fence: Option<ConnectionEffectFence>,
    ) -> QueuePush {
        if self.is_overflowed(effect_fence.as_ref()) {
            let was_poisoned = self.all_authorities_poisoned;
            let resync_count = self.record_overflow_resync(message.as_ref(), effect_fence);
            return QueuePush {
                resync_count,
                overflowed: !was_poisoned && self.all_authorities_poisoned,
                ..QueuePush::default()
            };
        }
        let retained_bytes = retained_resync_queue_item_bytes(message.as_ref());
        if self.resync.len() >= MAX_OUTBOX_BACKLOG || !self.fits_bytes(0, retained_bytes) {
            let overflow = self.overflow(Some(message.as_ref()), effect_fence);
            return QueuePush {
                resync_count: overflow.resync_count,
                overflowed: overflow.overflowed,
                ..QueuePush::default()
            };
        }
        self.resync_bytes = self.resync_bytes.saturating_add(retained_bytes);
        self.resync
            .push_back(QueuedEphemeralMessage::new(message, effect_fence));
        QueuePush {
            resync_count: 1,
            ..QueuePush::default()
        }
    }

    fn push_ephemeral(
        &mut self,
        message: Arc<EphemeralMessage>,
        max_pending_ephemeral_keys: usize,
        effect_fence: Option<ConnectionEffectFence>,
    ) -> QueuePush {
        if self.is_overflowed(effect_fence.as_ref()) {
            let was_poisoned = self.all_authorities_poisoned;
            let resync_count = self.record_overflow_resync(message.as_ref(), effect_fence);
            return QueuePush {
                resync_count,
                overflowed: !was_poisoned && self.all_authorities_poisoned,
                ..QueuePush::default()
            };
        }
        let Some(key) = message.coalesce_key() else {
            let before = self.is_overflowed(effect_fence.as_ref());
            let result = self.push_resync(message, effect_fence);
            return QueuePush {
                resync_count: result.resync_count,
                overflowed: result.overflowed && !before,
                ..QueuePush::default()
            };
        };
        let queue_key = (key.0.clone(), key.1.clone(), effect_fence.clone());

        if !self.ephemeral.contains_key(&queue_key)
            && self.ephemeral.len() >= max_pending_ephemeral_keys
        {
            let mut resync_epochs = self
                .ephemeral
                .values()
                .filter(|pending| pending.effect_fence.as_ref() == effect_fence.as_ref())
                .filter_map(|pending| {
                    let (room, _) = pending.message.coalesce_key()?;
                    let epoch = pending.message.scope_epoch()?;
                    let (_, generation) = pending.message.room_authority()?;
                    Some((room, (epoch, generation)))
                })
                .collect::<BTreeMap<_, _>>();
            resync_epochs.insert(
                key.0.clone(),
                (
                    message.scope_epoch().unwrap_or_default(),
                    message
                        .room_authority()
                        .map_or(0, |(_, generation)| generation),
                ),
            );
            self.ephemeral
                .retain(|_, pending| pending.effect_fence.as_ref() != effect_fence.as_ref());
            self.recompute_retained_bytes();
            self.clear_active_lease_binding_if_idle();

            let mut resync_count: usize = 0;
            let mut overflowed = false;
            for (room, (scope_epoch, room_authority_generation)) in resync_epochs {
                let result = self.push_resync(
                    Arc::new(EphemeralMessage::ResyncRequired {
                        ephemeral_authority_instance: None,
                        room,
                        scope_epoch,
                        room_authority_generation,
                        reason: ResyncReason::QueueOverflow,
                    }),
                    effect_fence.clone(),
                );
                resync_count = resync_count.saturating_add(result.resync_count);
                overflowed |= result.overflowed;
            }
            return QueuePush {
                coalesced: false,
                resync_count,
                overflowed,
            };
        }

        let retained_bytes = retained_ephemeral_queue_item_bytes(&key.0, &key.1, message.as_ref());
        let replaced_bytes = self.ephemeral.get(&queue_key).map_or(0, |previous| {
            retained_ephemeral_queue_item_bytes(&key.0, &key.1, previous.message.as_ref())
        });
        if !self.fits_bytes(replaced_bytes, retained_bytes) {
            let overflow = self.overflow(Some(message.as_ref()), effect_fence);
            return QueuePush {
                resync_count: overflow.resync_count,
                overflowed: overflow.overflowed,
                ..QueuePush::default()
            };
        }

        let coalesced = self
            .ephemeral
            .insert(
                queue_key,
                QueuedEphemeralMessage::new(message, effect_fence),
            )
            .is_some();
        self.clear_active_lease_binding_if_idle();
        self.ephemeral_bytes = self
            .ephemeral_bytes
            .saturating_sub(replaced_bytes)
            .saturating_add(retained_bytes);
        QueuePush {
            coalesced,
            resync_count: 0,
            overflowed: false,
        }
    }

    /// Push a durable live-query update, bounding the lane. Returns whether this
    /// push caused an overflow-to-resync.
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L1.
    fn push_durable(&mut self, message: DurableMessage) -> QueueOverflow {
        if self.is_overflowed(message.effect_fence()) {
            return QueueOverflow::default();
        }
        let retained_bytes = retained_durable_queue_item_bytes(&message);
        if self.durable.len() >= MAX_OUTBOX_BACKLOG || !self.fits_bytes(0, retained_bytes) {
            let effect_fence = message.effect_fence().cloned();
            return self.overflow(None, effect_fence);
        }
        self.durable_bytes = self.durable_bytes.saturating_add(retained_bytes);
        self.durable.push_back(QueuedDurableMessage::new(message));
        QueueOverflow::default()
    }

    /// Remove an unleased rowless watermark that the next frame for the same
    /// subscription subsumes. Appending the successor after this preparation
    /// preserves FIFO order with every older content frame; leased messages
    /// are already owned by a transport handoff and cannot be retracted.
    ///
    /// @ref LLP 0200#21-settlement-is-decoupled-from-subscriber-work —
    ///   consecutive watermarks collapse, and newer content intrinsically
    ///   carries the watermark it supersedes.
    fn supersede_pending_live_watermarks(
        &mut self,
        subscription_id: &str,
        next_version: u64,
    ) -> u64 {
        let mut removed = 0_u64;
        self.durable.retain(|queued| {
            let Ok(envelope) = serde_json::from_slice::<crate::live_wire::LiveEnvelope>(
                &queued.message.payload,
            ) else {
                return true;
            };
            let position = match &envelope {
                crate::live_wire::LiveEnvelope::LiveReplace {
                    subscription_id,
                    version,
                    ..
                }
                | crate::live_wire::LiveEnvelope::LiveDelta {
                    subscription_id,
                    version,
                    ..
                }
                | crate::live_wire::LiveEnvelope::CurrentAsOf {
                    subscription_id,
                    version,
                    ..
                } => Some((subscription_id.as_str(), *version)),
                crate::live_wire::LiveEnvelope::AuthorizationInvalidation {
                    snapshot: Some(snapshot),
                    ..
                } => Some((snapshot.subscription_id.as_str(), snapshot.version)),
                crate::live_wire::LiveEnvelope::AuthorizationInvalidation {
                    snapshot: None, ..
                }
                | crate::live_wire::LiveEnvelope::ResyncRequired { .. } => None,
            };
            if let Some((queued_subscription, queued_version)) = position
                && queued_subscription == subscription_id
            {
                debug_assert!(
                    queued_version <= next_version,
                    "subscription {subscription_id} queued version {queued_version} before older version {next_version}",
                );
            }
            let superseded = queued.lease_id.is_none()
                && matches!(
                    &envelope,
                    crate::live_wire::LiveEnvelope::CurrentAsOf {
                        subscription_id: queued_subscription,
                        version,
                        ..
                    } if queued_subscription == subscription_id && *version <= next_version
                );
            removed = removed.saturating_add(u64::from(superseded));
            !superseded
        });
        if removed > 0 {
            self.recompute_retained_bytes();
            self.compact_lane_storage();
        }
        removed
    }

    /// Stamp the per-connection monotone deadline before the item enters the
    /// physical queue. This is preparation only; no timer or wait runs under
    /// the outbox lock.
    ///
    /// @ref LLP 0167#observation-semantics--what-a-delay-means — FIFO is a
    ///   monotone deadline clamp, so a burst shifts once instead of N times.
    fn prepare_durable_deadline(
        &mut self,
        message: &mut DurableMessage,
    ) -> Option<std::time::Instant> {
        message.clamp_release_at(self.last_durable_release);
        let deadline = message.release_at();
        if let Some(deadline) = deadline {
            self.last_durable_release = Some(deadline);
        }
        deadline
    }

    /// Drop the lanes that belong to the ephemeral epoch world — the
    /// latest-state map and the resync lane — while preserving the durable
    /// lane. Pending `live_replace`/`live_delta` payloads answer durable
    /// subscriptions that survive an ephemeral boundary (`apply_schema`
    /// leaves `LocalSnapback::subscriptions` fully live), so discarding them
    /// here would be a silent drop no resync signal ever repairs (ENG-23346).
    /// An overflowed queue is left as-is: its out-of-band overflow marker
    /// already represents the sticky resync signal.
    ///
    /// @ref LLP 0008#realtime-delivery — never a silent drop.
    fn clear_ephemeral_lanes(&mut self) {
        self.resync.clear();
        self.resync.shrink_to_fit();
        self.ephemeral.clear();
        self.resync_bytes = 0;
        self.ephemeral_bytes = 0;
        self.clear_active_lease_binding_if_idle();
    }

    /// Remove queued data from one exact retired room epoch before its
    /// terminal resync boundary is enqueued. Matching both the room epoch and
    /// producer fence preserves concurrent replacement-room and successor-
    /// grant traffic that shares the readable connection id.
    fn purge_room_epoch(
        &mut self,
        room_id: &RoomId,
        scope_epoch: u64,
        effect_fence: Option<&ConnectionEffectFence>,
    ) {
        self.resync.retain(|queued| {
            let exact_fence = queued.effect_fence.as_ref() == effect_fence;
            let exact_epoch = queued
                .message
                .resync_room_epoch()
                .is_some_and(|(room, epoch)| &room == room_id && epoch == scope_epoch);
            !(exact_fence && exact_epoch)
        });
        self.ephemeral.retain(|_, queued| {
            let exact_fence = queued.effect_fence.as_ref() == effect_fence;
            let exact_epoch = queued
                .message
                .resync_room_epoch()
                .is_some_and(|(room, epoch)| &room == room_id && epoch == scope_epoch);
            !(exact_fence && exact_epoch)
        });
        self.recompute_retained_bytes();
        self.compact_lane_storage();
        self.clear_active_lease_binding_if_idle();
    }

    /// Remove only frames produced for one exact connection grant. This is
    /// safe after readable-id reuse: successor and authority-independent
    /// traffic remain in the shared queue.
    fn purge_effect_fence(&mut self, effect_fence: &ConnectionEffectFence) -> bool {
        let invalidated_active_batch = self.invalidate_active_lease_batch(effect_fence);
        self.durable.retain(|queued| {
            queued
                .message
                .effect_fence()
                .is_none_or(|actual| actual != effect_fence)
        });
        self.resync.retain(|message| {
            message
                .effect_fence
                .as_ref()
                .is_none_or(|actual| actual != effect_fence)
        });
        self.ephemeral.retain(|_, message| {
            message
                .effect_fence
                .as_ref()
                .is_none_or(|actual| actual != effect_fence)
        });
        self.durable.shrink_to_fit();
        self.resync.shrink_to_fit();
        self.recompute_retained_bytes();
        self.overflowed_effect_fences.remove(effect_fence);
        self.overflow_marker_leases
            .remove(&OverflowMarkerLeaseKey::Exact(effect_fence.clone()));
        self.recompute_overflow_marker_bytes();
        invalidated_active_batch && self.has_pending_work()
    }

    fn invalidate_active_lease_batch(&mut self, effect_fence: &ConnectionEffectFence) -> bool {
        if self.active_lease_effect_fence.as_ref() != Some(effect_fence) {
            return false;
        }
        for queued in &mut self.durable {
            queued.lease_id = None;
        }
        for queued in &mut self.resync {
            queued.lease_id = None;
        }
        for queued in self.ephemeral.values_mut() {
            queued.lease_id = None;
        }
        // Marker ownership is invalidated, not the underlying marker. Exact
        // purge below separately retires only the matching exact obligation;
        // unbound and all-authority poison remain for the successor.
        self.overflow_marker_leases.clear();
        self.active_lease_effect_fence = None;
        self.active_lease_binding_bytes = 0;
        true
    }

    fn has_pending_work(&self) -> bool {
        !self.durable.is_empty()
            || !self.resync.is_empty()
            || !self.ephemeral.is_empty()
            || self.overflowed
            || !self.overflowed_effect_fences.is_empty()
            || self.all_authorities_poisoned
    }

    fn has_eligible_recovery_marker(
        &self,
        expected_effect_fence: Option<&ConnectionEffectFence>,
    ) -> bool {
        // Marker priority lasts until acknowledgement, not merely until its
        // first selection. A concurrent poll must defer direct projections
        // while another unpolled response owns the marker lease.
        self.highest_eligible_recovery_marker_priority(expected_effect_fence)
            .is_some()
    }

    fn highest_eligible_recovery_marker_priority(
        &self,
        expected_effect_fence: Option<&ConnectionEffectFence>,
    ) -> Option<RecoveryMarkerPriority> {
        if self.all_authorities_poisoned && expected_effect_fence.is_some() {
            Some(RecoveryMarkerPriority::Poison)
        } else if self.overflowed {
            Some(RecoveryMarkerPriority::Unbound)
        } else if expected_effect_fence
            .is_some_and(|fence| self.overflowed_effect_fences.contains(fence))
        {
            Some(RecoveryMarkerPriority::Exact)
        } else {
            None
        }
    }

    fn recovery_marker_preempts(
        &self,
        expected_effect_fence: Option<&ConnectionEffectFence>,
        selected: Option<RecoveryMarkerPriority>,
    ) -> bool {
        self.highest_eligible_recovery_marker_priority(expected_effect_fence)
            .is_some_and(|pending| selected.is_none_or(|selected| pending > selected))
    }

    fn clear_active_lease_binding_if_idle(&mut self) {
        if !self.has_active_leases() {
            self.active_lease_effect_fence = None;
            self.active_lease_binding_bytes = 0;
        }
    }

    fn allocate_lease_id(&mut self) -> Option<u64> {
        let lease_id = self.next_drain_lease_id;
        self.next_drain_lease_id = lease_id.checked_add(1)?;
        Some(lease_id)
    }

    fn lease_is_current(&self, lease_id: u64) -> bool {
        self.durable
            .iter()
            .any(|queued| queued.lease_id == Some(lease_id))
            || self
                .resync
                .iter()
                .any(|queued| queued.lease_id == Some(lease_id))
            || self
                .ephemeral
                .values()
                .any(|queued| queued.lease_id == Some(lease_id))
            || self
                .overflow_marker_leases
                .values()
                .any(|leased| *leased == lease_id)
    }

    fn has_active_leases(&self) -> bool {
        self.durable.iter().any(|queued| queued.lease_id.is_some())
            || self.resync.iter().any(|queued| queued.lease_id.is_some())
            || self
                .ephemeral
                .values()
                .any(|queued| queued.lease_id.is_some())
            || !self.overflow_marker_leases.is_empty()
    }

    fn release_lease(&mut self, lease_id: u64) -> bool {
        let released = if let Some(queued) = self
            .durable
            .iter_mut()
            .find(|queued| queued.lease_id == Some(lease_id))
        {
            queued.lease_id = None;
            true
        } else if let Some(queued) = self
            .resync
            .iter_mut()
            .find(|queued| queued.lease_id == Some(lease_id))
        {
            queued.lease_id = None;
            true
        } else if let Some(queued) = self
            .ephemeral
            .values_mut()
            .find(|queued| queued.lease_id == Some(lease_id))
        {
            queued.lease_id = None;
            true
        } else {
            let marker = self
                .overflow_marker_leases
                .iter()
                .find_map(|(marker, leased)| (*leased == lease_id).then(|| marker.clone()));
            marker.is_some_and(|marker| self.overflow_marker_leases.remove(&marker).is_some())
        };
        if released {
            self.clear_active_lease_binding_if_idle();
        }
        released
    }

    /// Prevalidate the complete ownership set before removing anything. This
    /// gives HTTP one all-or-nothing response-body handoff and gives WS exact
    /// per-frame acknowledgement without a destructive pre-handoff window.
    fn acknowledge_leases(&mut self, lease_ids: &[u64]) -> bool {
        let lease_ids = lease_ids.iter().copied().collect::<BTreeSet<_>>();
        if !lease_ids
            .iter()
            .all(|lease_id| self.lease_is_current(*lease_id))
        {
            return false;
        }

        self.durable
            .retain(|queued| queued.lease_id.is_none_or(|id| !lease_ids.contains(&id)));
        self.resync
            .retain(|queued| queued.lease_id.is_none_or(|id| !lease_ids.contains(&id)));
        self.ephemeral
            .retain(|_, queued| queued.lease_id.is_none_or(|id| !lease_ids.contains(&id)));

        let markers = self
            .overflow_marker_leases
            .iter()
            .filter(|(_, lease_id)| lease_ids.contains(lease_id))
            .map(|(marker, _)| marker.clone())
            .collect::<Vec<_>>();
        for marker in markers {
            self.overflow_marker_leases.remove(&marker);
            match marker {
                OverflowMarkerLeaseKey::Unbound => self.overflowed = false,
                OverflowMarkerLeaseKey::Exact(effect_fence) => {
                    self.overflowed_effect_fences.remove(&effect_fence);
                }
                OverflowMarkerLeaseKey::Poison => self.all_authorities_poisoned = false,
            }
        }

        self.recompute_retained_bytes();
        self.recompute_overflow_marker_bytes();
        self.compact_lane_storage();
        self.clear_active_lease_binding_if_idle();
        true
    }

    fn select_marker(
        &mut self,
        marker: OverflowMarkerLeaseKey,
        envelope: RealtimeEnvelope,
        selected: &mut Vec<SelectedOutboxLease>,
    ) {
        if selected.len() >= MAX_OUTBOX_DRAIN_BATCH
            || self.overflow_marker_leases.contains_key(&marker)
        {
            return;
        }
        let Some(lease_id) = self.allocate_lease_id() else {
            return;
        };
        let recovery_marker_priority = Some(match &marker {
            OverflowMarkerLeaseKey::Exact(_) => RecoveryMarkerPriority::Exact,
            OverflowMarkerLeaseKey::Unbound => RecoveryMarkerPriority::Unbound,
            OverflowMarkerLeaseKey::Poison => RecoveryMarkerPriority::Poison,
        });
        self.overflow_marker_leases.insert(marker, lease_id);
        selected.push(SelectedOutboxLease {
            lease_id,
            envelope,
            recovery_marker_priority,
        });
    }

    fn discard_stale_frames(
        &mut self,
        expected_effect_fence: Option<&ConnectionEffectFence>,
        classify_durable: &mut impl FnMut(&DurableMessage) -> FrameAuthorityDisposition,
        classify_ephemeral: &mut impl FnMut(&EphemeralMessage) -> FrameAuthorityDisposition,
    ) {
        self.durable.retain(|queued| {
            effect_fence_disposition(queued.message.effect_fence(), expected_effect_fence)
                .unwrap_or_else(|| classify_durable(queued.message.as_ref()))
                != FrameAuthorityDisposition::DropStale
        });
        self.resync.retain(|queued| {
            effect_fence_disposition(queued.effect_fence.as_ref(), expected_effect_fence)
                .unwrap_or_else(|| classify_ephemeral(queued.message.as_ref()))
                != FrameAuthorityDisposition::DropStale
        });
        self.ephemeral.retain(|_, queued| {
            effect_fence_disposition(queued.effect_fence.as_ref(), expected_effect_fence)
                .unwrap_or_else(|| classify_ephemeral(queued.message.as_ref()))
                != FrameAuthorityDisposition::DropStale
        });
        self.durable.shrink_to_fit();
        self.resync.shrink_to_fit();
        self.recompute_retained_bytes();
    }

    /// `expected_effect_fence` is not a caller-selected label: production
    /// supplies it only inside the connection registry's act-time validation,
    /// and there is exactly one current consumable fence for a readable id.
    /// That invariant is what lets one exact drain consume the all-authority
    /// poison signal without allowing an accumulated predecessor to steal it.
    /// Compatibility drains (`None`) deliberately leave poison parked.
    ///
    /// @ref LLP 0059#fenced-effects-and-live-closure — final exact-fence
    ///   publication and replacement-safe readable connection ids.
    #[cfg(any(test, feature = "test-support"))]
    fn drain_with_authority(
        &mut self,
        expected_effect_fence: Option<&ConnectionEffectFence>,
        classify_durable: impl FnMut(&DurableMessage) -> FrameAuthorityDisposition,
        classify_ephemeral: impl FnMut(&EphemeralMessage) -> FrameAuthorityDisposition,
    ) -> Vec<RealtimeEnvelope> {
        let selected = self.drain_with_authority_bounded(
            expected_effect_fence,
            MAX_OUTBOX_DRAIN_BATCH,
            classify_durable,
            classify_ephemeral,
        );
        let lease_ids = selected
            .iter()
            .map(|selected| selected.lease_id)
            .collect::<Vec<_>>();
        let acknowledged = self.acknowledge_leases(&lease_ids);
        debug_assert!(acknowledged);
        selected
            .into_iter()
            .map(|selected| selected.envelope)
            .collect()
    }

    #[cfg(any(test, feature = "test-support"))]
    fn drain_with_authority_bounded(
        &mut self,
        expected_effect_fence: Option<&ConnectionEffectFence>,
        max_batch: usize,
        classify_durable: impl FnMut(&DurableMessage) -> FrameAuthorityDisposition,
        classify_ephemeral: impl FnMut(&EphemeralMessage) -> FrameAuthorityDisposition,
    ) -> Vec<SelectedOutboxLease> {
        self.drain_with_authority_bounded_and_handoff_limit(
            expected_effect_fence,
            max_batch,
            MAX_OUTBOX_HANDOFF_BYTES,
            classify_durable,
            classify_ephemeral,
        )
    }

    fn drain_with_authority_bounded_and_handoff_limit(
        &mut self,
        expected_effect_fence: Option<&ConnectionEffectFence>,
        max_batch: usize,
        max_handoff_bytes: usize,
        mut classify_durable: impl FnMut(&DurableMessage) -> FrameAuthorityDisposition,
        mut classify_ephemeral: impl FnMut(&EphemeralMessage) -> FrameAuthorityDisposition,
    ) -> Vec<SelectedOutboxLease> {
        // @ref LLP 0059#durable-and-ephemeral-outboxes — leased, bounded
        // selection preserves physical queue ownership through final handoff.
        let max_batch = max_batch.min(MAX_OUTBOX_DRAIN_BATCH);
        let max_handoff_bytes = max_handoff_bytes.min(MAX_OUTBOX_HANDOFF_BYTES);
        if max_batch == 0 || self.has_active_leases() {
            return Vec::new();
        }
        debug_assert!(self.active_lease_effect_fence.is_none());
        debug_assert_eq!(self.active_lease_binding_bytes, 0);
        if let Some(effect_fence) = expected_effect_fence {
            let binding_bytes = retained_outbox_lease_binding_bytes(effect_fence);
            if !self.fits_bytes(0, binding_bytes) {
                // Preserve every pending authority domain as one recovery
                // obligation if exact handoff metadata cannot coexist with
                // the physical backlog. A pathologically oversized trusted
                // fence still fails closed rather than exceeding the ceiling.
                self.poison_all_authorities();
            }
            if !self.fits_bytes(0, binding_bytes) {
                return Vec::new();
            }
            self.active_lease_effect_fence = Some(effect_fence.clone());
            self.active_lease_binding_bytes = binding_bytes;
        }
        let mut selected = Vec::new();
        let unbound_overflow_signal = self.overflowed;
        let exact_overflow_signal = expected_effect_fence
            .filter(|effect_fence| self.overflowed_effect_fences.contains(*effect_fence))
            .cloned();
        let poisoned_overflow_signal = if self.all_authorities_poisoned {
            expected_effect_fence.cloned()
        } else {
            None
        };
        // Recovery controls precede all ordinary effects and are leased alone.
        // While selected, the global one-batch rule parks every competing HTTP
        // or WS drain until acceptance/release, so poison cannot be bypassed or
        // overtaken by a later physical frame.
        if let Some(effect_fence) = poisoned_overflow_signal {
            self.select_marker(
                OverflowMarkerLeaseKey::Poison,
                RealtimeEnvelope::Durable(overflow_sentinel(Some(effect_fence))),
                &mut selected,
            );
            self.discard_stale_frames(
                expected_effect_fence,
                &mut classify_durable,
                &mut classify_ephemeral,
            );
            self.clear_active_lease_binding_if_idle();
            return selected;
        }
        if unbound_overflow_signal {
            self.select_marker(
                OverflowMarkerLeaseKey::Unbound,
                RealtimeEnvelope::Durable(overflow_sentinel(None)),
                &mut selected,
            );
            self.discard_stale_frames(
                expected_effect_fence,
                &mut classify_durable,
                &mut classify_ephemeral,
            );
            self.clear_active_lease_binding_if_idle();
            return selected;
        }
        if let Some(effect_fence) = exact_overflow_signal {
            self.select_marker(
                OverflowMarkerLeaseKey::Exact(effect_fence.clone()),
                RealtimeEnvelope::Durable(overflow_sentinel(Some(effect_fence))),
                &mut selected,
            );
            self.discard_stale_frames(
                expected_effect_fence,
                &mut classify_durable,
                &mut classify_ephemeral,
            );
            self.clear_active_lease_binding_if_idle();
            return selected;
        }
        // Recovery markers ignore a projection-reserved payload budget: the
        // caller will discard its direct projections and emit the marker
        // alone. Check them before this ordinary-frame floor so a concurrent
        // overflow cannot disappear merely because projections consumed the
        // remaining handoff budget.
        if max_handoff_bytes <= OUTBOX_HANDOFF_BATCH_OVERHEAD {
            self.clear_active_lease_binding_if_idle();
            return selected;
        }
        let mut durable_index = 0;
        let mut removed_stale = false;
        let mut handoff_bytes = OUTBOX_HANDOFF_BATCH_OVERHEAD;
        let mut handoff_full = false;
        let network_now = std::time::Instant::now();
        while durable_index < self.durable.len() && selected.len() < max_batch {
            if self.durable[durable_index].lease_id.is_some() {
                durable_index += 1;
                continue;
            }
            let disposition = {
                let message = self.durable[durable_index].message.as_ref();
                effect_fence_disposition(message.effect_fence(), expected_effect_fence)
                    .unwrap_or_else(|| classify_durable(message))
            };
            match disposition {
                FrameAuthorityDisposition::Send => {
                    // A not-yet-due head remains physical queue ownership and
                    // therefore holds no publication permit. Stop this FIFO
                    // lane; the deadline scheduler will wake the connection.
                    //
                    // @ref LLP 0167#observation-semantics--what-a-delay-means —
                    //   all wall-clock waiting is outside admission authority.
                    if !self.durable[durable_index]
                        .message
                        .is_network_ready(network_now)
                    {
                        break;
                    }
                    let estimated = estimated_durable_handoff_bytes(
                        self.durable[durable_index].message.as_ref(),
                    );
                    if handoff_bytes.saturating_add(estimated) > max_handoff_bytes {
                        if selected.is_empty()
                            && OUTBOX_HANDOFF_BATCH_OVERHEAD.saturating_add(estimated)
                                > MAX_OUTBOX_HANDOFF_BYTES
                        {
                            let effect_fence =
                                self.durable[durable_index].message.effect_fence().cloned();
                            self.overflow(None, effect_fence);
                            return self.drain_with_authority_bounded_and_handoff_limit(
                                expected_effect_fence,
                                max_batch,
                                max_handoff_bytes,
                                classify_durable,
                                classify_ephemeral,
                            );
                        }
                        handoff_full = true;
                        break;
                    }
                    let Some(lease_id) = self.allocate_lease_id() else {
                        break;
                    };
                    let message = self.durable[durable_index].message.clone();
                    self.durable[durable_index].lease_id = Some(lease_id);
                    selected.push(SelectedOutboxLease {
                        lease_id,
                        envelope: RealtimeEnvelope::Durable((*message).clone()),
                        recovery_marker_priority: None,
                    });
                    handoff_bytes = handoff_bytes.saturating_add(estimated);
                    durable_index += 1;
                }
                FrameAuthorityDisposition::Retain => durable_index += 1,
                FrameAuthorityDisposition::DropStale => {
                    self.durable.remove(durable_index);
                    removed_stale = true;
                }
            }
        }
        let mut resync_index = 0;
        while !handoff_full && resync_index < self.resync.len() && selected.len() < max_batch {
            if self.resync[resync_index].lease_id.is_some() {
                resync_index += 1;
                continue;
            }
            let disposition = {
                let message = &self.resync[resync_index];
                effect_fence_disposition(message.effect_fence.as_ref(), expected_effect_fence)
                    .unwrap_or_else(|| classify_ephemeral(message.message.as_ref()))
            };
            match disposition {
                FrameAuthorityDisposition::Send => {
                    let estimated = estimated_ephemeral_handoff_bytes(
                        self.resync[resync_index].message.as_ref(),
                    );
                    if handoff_bytes.saturating_add(estimated) > max_handoff_bytes {
                        if selected.is_empty()
                            && OUTBOX_HANDOFF_BATCH_OVERHEAD.saturating_add(estimated)
                                > MAX_OUTBOX_HANDOFF_BYTES
                        {
                            let message = self.resync[resync_index].message.clone();
                            let effect_fence = self.resync[resync_index].effect_fence.clone();
                            self.overflow(Some(message.as_ref()), effect_fence);
                            return self.drain_with_authority_bounded_and_handoff_limit(
                                expected_effect_fence,
                                max_batch,
                                max_handoff_bytes,
                                classify_durable,
                                classify_ephemeral,
                            );
                        }
                        handoff_full = true;
                        break;
                    }
                    let Some(lease_id) = self.allocate_lease_id() else {
                        break;
                    };
                    let message = self.resync[resync_index].message.clone();
                    self.resync[resync_index].lease_id = Some(lease_id);
                    selected.push(SelectedOutboxLease {
                        lease_id,
                        envelope: RealtimeEnvelope::Ephemeral((*message).clone()),
                        recovery_marker_priority: None,
                    });
                    handoff_bytes = handoff_bytes.saturating_add(estimated);
                    resync_index += 1;
                }
                FrameAuthorityDisposition::Retain => resync_index += 1,
                FrameAuthorityDisposition::DropStale => {
                    self.resync.remove(resync_index);
                    removed_stale = true;
                }
            }
        }
        // The pending map coalesces by room/key, whose lexical map order is
        // unrelated to the room authority's monotonic entryVersion. Sort the
        // surviving latest-state messages before transport so a client's room
        // high-water can safely reject any delayed lower-version frame.
        let ephemeral_keys = self.ephemeral.keys().cloned().collect::<Vec<_>>();
        let mut ephemeral = Vec::new();
        for key in ephemeral_keys {
            if handoff_full {
                break;
            }
            if selected.len().saturating_add(ephemeral.len()) >= max_batch {
                break;
            }
            let Some(message) = self.ephemeral.get(&key) else {
                continue;
            };
            if message.lease_id.is_some() {
                continue;
            }
            let disposition =
                effect_fence_disposition(message.effect_fence.as_ref(), expected_effect_fence)
                    .unwrap_or_else(|| classify_ephemeral(message.message.as_ref()));
            match disposition {
                FrameAuthorityDisposition::Send => {
                    let estimated = estimated_ephemeral_handoff_bytes(message.message.as_ref());
                    if handoff_bytes.saturating_add(estimated) > max_handoff_bytes {
                        if selected.is_empty()
                            && ephemeral.is_empty()
                            && OUTBOX_HANDOFF_BATCH_OVERHEAD.saturating_add(estimated)
                                > MAX_OUTBOX_HANDOFF_BYTES
                        {
                            let oversized = message.message.clone();
                            let effect_fence = message.effect_fence.clone();
                            self.overflow(Some(oversized.as_ref()), effect_fence);
                            return self.drain_with_authority_bounded_and_handoff_limit(
                                expected_effect_fence,
                                max_batch,
                                max_handoff_bytes,
                                classify_durable,
                                classify_ephemeral,
                            );
                        }
                        break;
                    }
                    ephemeral.push((key, message.message.clone()));
                    handoff_bytes = handoff_bytes.saturating_add(estimated);
                }
                FrameAuthorityDisposition::Retain => {}
                FrameAuthorityDisposition::DropStale => {
                    self.ephemeral.remove(&key);
                    removed_stale = true;
                }
            }
        }
        ephemeral.sort_by(|left, right| {
            left.1
                .resync_room_epoch()
                .cmp(&right.1.resync_room_epoch())
                .then_with(|| left.1.entry_version().cmp(&right.1.entry_version()))
        });
        for (key, message) in ephemeral {
            let Some(lease_id) = self.allocate_lease_id() else {
                break;
            };
            let Some(queued) = self.ephemeral.get_mut(&key) else {
                continue;
            };
            if queued.lease_id.is_some() || !Arc::ptr_eq(&queued.message, &message) {
                continue;
            }
            queued.lease_id = Some(lease_id);
            selected.push(SelectedOutboxLease {
                lease_id,
                envelope: RealtimeEnvelope::Ephemeral((*message).clone()),
                recovery_marker_priority: None,
            });
        }
        if removed_stale {
            self.durable.shrink_to_fit();
            self.resync.shrink_to_fit();
            self.recompute_retained_bytes();
        }
        self.clear_active_lease_binding_if_idle();
        selected
    }

    fn pending_resync_epochs(
        &self,
        effect_fence: Option<&ConnectionEffectFence>,
    ) -> BTreeMap<RoomId, (u64, u64)> {
        self.resync
            .iter()
            .chain(self.ephemeral.values())
            .filter(|message| message.effect_fence.as_ref() == effect_fence)
            .filter_map(|message| {
                let (room, epoch) = message.message.resync_room_epoch()?;
                let (_, generation) = message.message.room_authority()?;
                Some((room, (epoch, generation)))
            })
            .collect()
    }

    fn record_overflow_resync(
        &mut self,
        message: &EphemeralMessage,
        effect_fence: Option<ConnectionEffectFence>,
    ) -> usize {
        let Some((room, scope_epoch)) = message.resync_room_epoch() else {
            return 0;
        };
        let room_authority_generation = message
            .room_authority()
            .map_or(0, |(_, generation)| generation);
        self.record_overflow_resync_for_room(
            room,
            scope_epoch,
            room_authority_generation,
            effect_fence,
        )
    }

    fn record_overflow_resync_for_room(
        &mut self,
        room: RoomId,
        scope_epoch: u64,
        room_authority_generation: u64,
        effect_fence: Option<ConnectionEffectFence>,
    ) -> usize {
        if self.all_authorities_poisoned {
            return 0;
        }
        let already_queued = self.resync.iter_mut().find(|pending| {
            matches!(
                pending.message.as_ref(),
                EphemeralMessage::ResyncRequired {
                    room: pending_room,
                    ..
                } if pending_room == &room
                    && pending.effect_fence.as_ref() == effect_fence.as_ref()
            )
        });
        if let Some(pending) = already_queued {
            let pending_authority = match pending.message.as_ref() {
                EphemeralMessage::ResyncRequired {
                    scope_epoch,
                    room_authority_generation,
                    ..
                } => (*scope_epoch, *room_authority_generation),
                _ => unreachable!("resync search returned a non-resync message"),
            };
            let requested_authority = (scope_epoch, room_authority_generation);
            if requested_authority > pending_authority {
                // Deduplication must not pin a stale room fence forever. A
                // newer same-room recovery replaces the queued authority
                // tuple in place; an older delayed producer cannot downgrade
                // it. The retained allocation is unchanged because only two
                // inline integers and the fixed reason differ.
                pending.message = Arc::new(EphemeralMessage::ResyncRequired {
                    ephemeral_authority_instance: None,
                    room,
                    scope_epoch,
                    room_authority_generation,
                    reason: ResyncReason::QueueOverflow,
                });
                // A newer recovery tuple supersedes an unaccepted selection.
                // Its old transport handle must fail rather than acknowledge
                // bytes that no longer represent the retained frame.
                pending.lease_id = None;
                self.clear_active_lease_binding_if_idle();
            }
            return 0;
        }
        let message = Arc::new(EphemeralMessage::ResyncRequired {
            ephemeral_authority_instance: None,
            room,
            scope_epoch,
            room_authority_generation,
            reason: ResyncReason::QueueOverflow,
        });
        let retained_bytes = retained_resync_queue_item_bytes(message.as_ref());
        if self.resync.len() >= MAX_OUTBOX_OVERFLOW_RESYNCS || !self.fits_bytes(0, retained_bytes) {
            // Silently dropping the room that crossed the recovery ledger
            // would leave precisely that overlay stale. Collapse all lanes to
            // the one bounded clear-retained signal instead.
            self.poison_all_authorities();
            return 0;
        }
        self.resync_bytes = self.resync_bytes.saturating_add(retained_bytes);
        self.resync
            .push_back(QueuedEphemeralMessage::new(message, effect_fence));
        1
    }
}

/// Hard store-level limits — capability facts, not incidental constants.
/// First hard defaults set by LLP 0032 L9; constructor-overridable so tests
/// and future targets can vary them.
///
/// @ref LLP 0026#limits-and-diagnostics — reject or resync explicitly, never silent eviction.
#[derive(Clone, Copy, Debug)]
pub struct EphemeralStoreLimits {
    /// Maximum live rooms in this process's store.
    pub max_active_rooms: usize,
    /// Maximum latest-state entries per room.
    pub max_entries_per_room: usize,
    /// Maximum registered subscribers per room.
    pub max_subscribers_per_room: usize,
    /// Maximum conservatively accounted retained allocations per room.
    pub max_room_value_bytes: usize,
}

impl Default for EphemeralStoreLimits {
    fn default() -> Self {
        Self {
            max_active_rooms: 4_096,
            max_entries_per_room: 1_024,
            max_subscribers_per_room: 1_024,
            max_room_value_bytes: 1_024 * 1_024,
        }
    }
}

/// Event counters, incremented at their sites from any thread. Gauges (room
/// and queue totals) are not here — they are computed on demand in
/// [`LocalEphemeralBackend::diagnostics`] (LLP 0032 L4).
#[derive(Default)]
struct EventCounters {
    rejected_publishes: AtomicU64,
    rate_limited_publishes: AtomicU64,
    oversized_publishes: AtomicU64,
    unauthorized_requests: AtomicU64,
    metadata_rejections: AtomicU64,
    expired_entries: AtomicU64,
    disconnected_entries: AtomicU64,
    coalesced_updates: AtomicU64,
    resync_required: AtomicU64,
    outbox_overflows: AtomicU64,
    limit_rejections: AtomicU64,
    generation_exhaustions: AtomicU64,
}

impl EventCounters {
    fn reset(&self) {
        for counter in [
            &self.rejected_publishes,
            &self.rate_limited_publishes,
            &self.oversized_publishes,
            &self.unauthorized_requests,
            &self.metadata_rejections,
            &self.expired_entries,
            &self.disconnected_entries,
            &self.coalesced_updates,
            &self.resync_required,
            &self.outbox_overflows,
            &self.limit_rejections,
            &self.generation_exhaustions,
        ] {
            counter.store(0, Ordering::Relaxed);
        }
    }
}

type SharedRoom = Arc<StdMutex<RoomState>>;
type SharedOutbox = Arc<StdMutex<OutboundQueue>>;

#[derive(Clone, Debug)]
pub struct RoomSubscriberReauthorization {
    pub connection_id: ConnectionId,
    #[cfg(any(test, feature = "test-support"))]
    pub previous_auth: AuthContext,
    pub effect_fence: Option<ConnectionEffectFence>,
}

#[derive(Clone, Debug)]
pub struct PendingRoomReauthorization {
    pub room: RoomId,
    pub obligation: RoomAuthorityResync,
    pub subscribers: Vec<RoomSubscriberReauthorization>,
}

#[derive(Clone, Debug)]
pub enum RoomSubscriberResolution {
    Authorized {
        connection_id: ConnectionId,
        expected_effect_fence: Option<ConnectionEffectFence>,
        auth: AuthContext,
    },
    Denied {
        connection_id: ConnectionId,
        expected_effect_fence: Option<ConnectionEffectFence>,
    },
}

fn authority_pending_error() -> EphemeralError {
    EphemeralError::new(
        EphemeralErrorCode::AuthorityPending,
        "protected room authority is suspended for authorization revalidation",
    )
}

fn generation_exhausted_error() -> EphemeralError {
    EphemeralError::new(
        EphemeralErrorCode::GenerationExhausted,
        "ephemeral generation cannot advance within the portable integer domain",
    )
}

#[cfg(test)]
struct DefinitionSwapTestHook {
    reached: std::sync::mpsc::SyncSender<()>,
    release: std::sync::mpsc::Receiver<()>,
}

#[cfg(any(test, feature = "test-support"))]
struct FrameBeforeFirstEnqueueTestHook {
    reached: std::sync::mpsc::SyncSender<EphemeralMessage>,
    release: std::sync::mpsc::Receiver<()>,
}

enum RoomAuthority {
    Bound(AuthorizationCommitParticipant),
    Unbound(NonAuthorizingRoomAuthority),
}

impl RoomAuthority {
    fn replace_protected_room_catalog(
        &self,
        definitions: &[EphemeralCollection],
    ) -> Result<u64, EphemeralError> {
        match self {
            Self::Bound(participant) => participant.replace_protected_room_catalog(definitions),
            Self::Unbound(authority) => authority.replace_protected_room_catalog(definitions),
        }
    }

    fn begin_protected_room_act(
        &self,
        room: &RoomId,
    ) -> Result<RoomAuthorityPermit, EphemeralError> {
        match self {
            Self::Bound(participant) => participant.begin_protected_room_act(room),
            Self::Unbound(authority) => authority.begin_protected_room_act(room),
        }
    }

    fn begin_protected_room_operation(
        &self,
        room: &RoomId,
    ) -> Result<RoomAuthorityOperationGuard, EphemeralError> {
        match self {
            Self::Bound(participant) => participant.begin_protected_room_operation(room),
            Self::Unbound(authority) => authority.begin_protected_room_operation(room),
        }
    }

    fn validate_admitted_room_act(
        &self,
        permit: &RoomAuthorityPermit,
        room: &RoomId,
    ) -> Result<RoomAuthorityOperationGuard, EphemeralError> {
        match self {
            Self::Bound(participant) => participant.validate_admitted_room_act(permit, room),
            Self::Unbound(authority) => authority.validate_admitted_room_act(permit, room),
        }
    }

    fn room_generation(&self, room: &RoomId) -> u64 {
        match self {
            Self::Bound(participant) => participant.room_generation(room),
            Self::Unbound(authority) => authority.room_generation(room),
        }
    }

    fn retire_room(&self, room: &RoomId) {
        match self {
            Self::Bound(participant) => participant.retire_room(room),
            Self::Unbound(authority) => authority.retire_room(room),
        }
    }

    fn pending_reauthorizations(&self) -> Vec<crate::storage::PendingRoomReauthorization> {
        match self {
            Self::Bound(participant) => participant.pending_reauthorizations(),
            Self::Unbound(authority) => authority.pending_reauthorizations(),
        }
    }

    fn begin_outbox_admission(
        &self,
        admit_fenced: bool,
    ) -> Result<AuthorizationOutboxAdmission<'_>, EphemeralError> {
        match self {
            Self::Bound(participant) => participant.begin_outbox_admission(admit_fenced),
            Self::Unbound(authority) => authority.begin_outbox_admission(admit_fenced),
        }
    }

    fn begin_room_creation_admission(
        &self,
        room: &RoomId,
        generation: u64,
    ) -> Result<RoomCreationAdmission<'_>, EphemeralError> {
        match self {
            Self::Bound(participant) => participant.begin_room_creation_admission(room, generation),
            Self::Unbound(authority) => authority.begin_room_creation_admission(room, generation),
        }
    }

    fn begin_room_retirement_admission(
        &self,
        room: &RoomId,
    ) -> Result<RoomRetirementAdmission<'_>, EphemeralError> {
        match self {
            Self::Bound(participant) => participant.begin_room_retirement_admission(room),
            Self::Unbound(authority) => authority.begin_room_retirement_admission(room),
        }
    }

    fn begin_room_reauthorization_admission(
        &self,
        room: &RoomId,
        generation: u64,
    ) -> Result<RoomReauthorizationAdmission<'_>, EphemeralError> {
        match self {
            Self::Bound(participant) => {
                participant.begin_room_reauthorization_admission(room, generation)
            }
            Self::Unbound(authority) => {
                authority.begin_room_reauthorization_admission(room, generation)
            }
        }
    }

    fn prepare_authorization_commit(
        &self,
        preflight: AuthorizationCommitPreflight,
        cancellation: Arc<AuthorizationReservationCancellation>,
    ) -> SnapbackResult<AuthorizationCommitReservation> {
        match self {
            Self::Bound(participant) => {
                participant.prepare_authorization_commit(preflight, cancellation)
            }
            Self::Unbound(_) => Err(SnapbackError::error(
                "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                "auth",
                "standalone ephemeral backend has no database-bound authorization participant",
            )),
        }
    }

    fn committed_outcome(
        &self,
        witness: &AuthorizationCommitWitness,
        min_commit_version: u64,
    ) -> SnapbackResult<AuthorizationCommitOutcome> {
        match self {
            Self::Bound(participant) => participant.committed_outcome(witness, min_commit_version),
            Self::Unbound(_) => Err(SnapbackError::error(
                "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                "auth",
                "standalone ephemeral backend has no authorization commit outcome",
            )),
        }
    }
}

/// The shared state behind the backend handle. All synchronization is
/// internal: a read-mostly collections registry, a small global routing map
/// whose values are per-room locks, per-connection outbox locks, a
/// rate-bucket map, a room-granular expiry index, and atomic event counters.
///
/// Lock order (outer to inner): protected terminal/reauthorization work starts
/// with `room_authority`, then `rooms` map → one room → `delivery` notifier →
/// `outboxes` map → one outbox. Ordinary room work starts at `rooms`/room.
/// `expiry_index` and `connection_rooms` remain room-leaf locks taken one at a
/// time. A generation-bound drain takes only `delivery` → `outboxes` → one
/// outbox. No enqueue retains an outbox lock while waking `delivery`, so
/// reconnect registration and draining cannot form an inversion. Never two
/// room locks; never acquire a room or the `rooms` map while holding an outbox
/// or index lock; a room holder that discovers exhaustion marks it retired and
/// releases it before acquiring the registry/routing order. `rate_buckets` is
/// a pure leaf.
///
/// @ref LLP 0026#as-built-sharded-local-room-authority-written-2026-07-02-before-the-l9-implementation — the sharded design and its lock order.
struct EphemeralShared {
    /// Definition generation barrier. Ordinary room operations take a read
    /// guard; replacement/reset takes the write guard through collection swap,
    /// room retirement, lane cleanup, and resync enqueue. A new-generation
    /// publish therefore cannot be erased by an old-generation wipe.
    lifecycle: RwLock<()>,
    #[cfg(test)]
    definition_swap_hook: StdMutex<Option<DefinitionSwapTestHook>>,
    /// One backend-local, one-shot pause at the exact constructed-frame →
    /// first-outbox-push seam used by the protected-room commit-order test.
    #[cfg(any(test, feature = "test-support"))]
    frame_before_first_enqueue_hook: StdMutex<Option<FrameBeforeFirstEnqueueTestHook>>,
    collections: RwLock<BTreeMap<String, EphemeralCollection>>,
    collection_generation: AtomicU64,
    rooms: StdMutex<BTreeMap<RoomId, SharedRoom>>,
    outboxes: StdMutex<BTreeMap<ConnectionId, SharedOutbox>>,
    /// Rate buckets keyed connection-first, so disconnect drops one
    /// connection's buckets with a single map removal instead of an
    /// O(all-buckets) retain (ENG-23348).
    rate_buckets: StdMutex<BTreeMap<ConnectionId, BTreeMap<String, RateBucket>>>,
    /// Reverse index: the rooms each connection currently subscribes to or
    /// owns entries in. Operations provisionally index before becoming
    /// visible (so disconnect finds in-flight work), then roll back failures
    /// and remove edges on unsubscribe/delete/expiry/retirement. Disconnect
    /// therefore scales with current footprint, not lifetime churn
    /// (ENG-23348, ENG-24355).
    connection_rooms: StdMutex<BTreeMap<ConnectionId, BTreeSet<RoomId>>>,
    /// At most one entry per live room: `(deadline, room)` where `deadline`
    /// is a lower bound on the room's earliest entry expiry (mirrored in the
    /// room's `indexed_deadline`), so cleanup visits only due rooms instead
    /// of scanning every room.
    expiry_index: StdMutex<BTreeMap<(Millis, RoomId), ()>>,
    counters: EventCounters,
    /// Store-global scope-epoch allocator: every room incarnation takes a
    /// fresh epoch, so recreation after prune/reset/replace is always
    /// detectable by clients (LLP 0013 §Stored entry shape).
    next_scope_epoch: AtomicU64,
    limits: EphemeralStoreLimits,
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L8: wakes the
    // delivery task on enqueue instead of a 25ms poll.
    delivery: Arc<DeliveryNotifier>,
    /// Independent commit-ordered authority gate for protected rooms. No
    /// registry mutex is held across SQLite commit; pending tickets are
    /// level-triggered barriers observed by every sink.
    room_authority: RoomAuthority,
    /// The same authenticated issuer exposed by the handshake. Advancing its
    /// expectation before removing a committed dependency closes the new-room
    /// window: an affected room absent at prepare sees either its matching
    /// ticket or the successor epoch, never a predecessor grant under a fresh
    /// control.
    authorization_issuer: StdMutex<Option<crate::auth::invalidation::LiveInvalidationIssuer>>,
}

/// The local-memory implementation of the LLP 0013 `EphemeralBackend`
/// contract: an internally synchronized, cheaply cloneable room authority.
/// This type's public API *is* the backend boundary — nothing outside this
/// module reaches a room map, and callers (server handlers, the write-lane
/// fan-out, embedded tests) operate through `&self` from any thread without
/// the global `LocalSnapback` mutex. The trait spelling of the contract is
/// deferred until the Phase 3 conformance suite provides a second consumer.
///
/// @ref LLP 0026#boundary-semantic-contract-first — the contract operations this surface implements.
/// @ref LLP 0013#room-store-model — a room authority owns room maps, versions, expiry, subscribers, and coalescing.
#[derive(Clone)]
pub struct LocalEphemeralBackend {
    shared: Arc<EphemeralShared>,
}

impl Default for LocalEphemeralBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalEphemeralBackend {
    fn lifecycle_read(&self, operation: &str) -> RwLockReadGuard<'_, ()> {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(operation);
        self.shared
            .lifecycle
            .read()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn lifecycle_write(&self, operation: &str) -> RwLockWriteGuard<'_, ()> {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(operation);
        self.shared
            .lifecycle
            .write()
            .unwrap_or_else(PoisonError::into_inner)
    }

    pub fn collection_requires_room_permission(&self, name: &str) -> bool {
        self.collection_if_loaded(name)
            .as_ref()
            .is_some_and(collection_requires_room_permission)
    }

    pub fn subscription_requires_room_permission(&self, name: &str) -> bool {
        self.collection_if_loaded(name).is_some_and(|collection| {
            matches!(
                collection.subscribe,
                AccessPolicy::RequireRoomPermission { .. }
            )
        })
    }

    pub fn collection_definition(&self, name: &str) -> Option<EphemeralCollection> {
        self.collection_if_loaded(name)
    }

    pub fn new() -> Self {
        Self::with_limits(EphemeralStoreLimits::default())
    }

    /// A store with explicit hard limits (tests, future capability overrides).
    pub fn with_limits(limits: EphemeralStoreLimits) -> Self {
        Self::with_limits_and_authority(
            limits,
            RoomAuthority::Unbound(NonAuthorizingRoomAuthority::default()),
        )
    }

    pub fn for_serving_database(
        limits: EphemeralStoreLimits,
        database: &mut ServingDatabase,
    ) -> SnapbackResult<Self> {
        // Every `usize` value, including zero, is a valid hard cap, and the
        // sync-owned graph uses only infallible standard-library lock/Arc
        // construction. There is therefore no fallible sync work to perform
        // before taking the database's one participant.
        let participant = database.take_authorization_commit_participant()?;
        let backend = Self::with_limits_and_authority(limits, RoomAuthority::Bound(participant));
        let RoomAuthority::Bound(participant) = &backend.shared.room_authority else {
            unreachable!("bound constructor installs a bound participant")
        };
        database.bind_authorization_commit_participant(participant)?;
        Ok(backend)
    }

    fn with_limits_and_authority(
        limits: EphemeralStoreLimits,
        room_authority: RoomAuthority,
    ) -> Self {
        Self {
            shared: Arc::new(EphemeralShared {
                lifecycle: RwLock::new(()),
                #[cfg(test)]
                definition_swap_hook: StdMutex::new(None),
                #[cfg(any(test, feature = "test-support"))]
                frame_before_first_enqueue_hook: StdMutex::new(None),
                collections: RwLock::new(BTreeMap::new()),
                collection_generation: AtomicU64::new(1),
                rooms: StdMutex::new(BTreeMap::new()),
                outboxes: StdMutex::new(BTreeMap::new()),
                rate_buckets: StdMutex::new(BTreeMap::new()),
                connection_rooms: StdMutex::new(BTreeMap::new()),
                expiry_index: StdMutex::new(BTreeMap::new()),
                counters: EventCounters::default(),
                next_scope_epoch: AtomicU64::new(1),
                limits,
                delivery: Arc::new(DeliveryNotifier::default()),
                room_authority,
                authorization_issuer: StdMutex::new(None),
            }),
        }
    }

    pub fn authorization_expectation_view_for_install(
        &self,
        database: &mut ServingDatabase,
    ) -> SnapbackResult<AuthorizationExpectationView> {
        let RoomAuthority::Bound(participant) = &self.shared.room_authority else {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                "auth",
                "standalone ephemeral backend has no database-bound authorization participant",
            ));
        };
        database.authorization_expectation_view_for_participant_install(participant)
    }

    pub fn activate_authorization_commit_interlock(
        &self,
        database: &mut ServingDatabase,
    ) -> SnapbackResult<()> {
        let RoomAuthority::Bound(participant) = &self.shared.room_authority else {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                "auth",
                "standalone ephemeral backend has no database-bound authorization participant",
            ));
        };
        let issuer = lock(&self.shared.authorization_issuer)
            .clone()
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                    "auth",
                    "authorization commit interlock cannot activate without an installed issuer",
                )
            })?;
        database.activate_authorization_commit_participant(
            participant,
            issuer.authorization_issuer_projection()?,
        )
    }

    pub fn committed_authorization_outcome(
        &self,
        witness: &AuthorizationCommitWitness,
        min_commit_version: u64,
    ) -> SnapbackResult<AuthorizationCommitOutcome> {
        self.shared
            .room_authority
            .committed_outcome(witness, min_commit_version)
    }

    /// Latch the bound authorization participant closed after a durable
    /// commit whose issuer outcome cannot be observed or projected exactly.
    /// This is a denial-only composition seam; it exposes no reopening or
    /// caller-selected authorization state.
    pub fn fail_closed_authorization_projection(&self, error: SnapbackError) -> SnapbackError {
        match &self.shared.room_authority {
            RoomAuthority::Bound(participant) => {
                participant.fail_closed_authorization_projection(error)
            }
            RoomAuthority::Unbound(_) => SnapbackError::error(
                "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                "auth",
                format!(
                    "authorization commit finalization failed closed after the durable commit: {} ({})",
                    error.diagnostic.message, error.diagnostic.code
                ),
            ),
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn inject_authorization_outcome_observation_failure(&self) {
        let RoomAuthority::Bound(participant) = &self.shared.room_authority else {
            panic!("authorization outcome failure injection requires a bound participant");
        };
        participant.inject_outcome_observation_failure();
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn inject_authorization_issuer_projection_failure(&self) {
        let RoomAuthority::Bound(participant) = &self.shared.room_authority else {
            panic!("authorization projection failure injection requires a bound participant");
        };
        participant.inject_issuer_projection_failure();
    }

    pub fn install_authorization_issuer(
        &self,
        issuer: crate::auth::invalidation::LiveInvalidationIssuer,
    ) {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "ephemeral authorization issuer installation",
        );
        *lock(&self.shared.authorization_issuer) = Some(issuer);
    }

    /// Install the exact database-bound issuer and activate its commit
    /// projection. Managed Local callers validate and re-enable the database
    /// latch while they still own the sole writer, then defer only the issuer
    /// copy installation. The managed handoff remains closed until that
    /// after-Local effect finishes, so no transaction can bind in between.
    /// Direct/startup callers install the issuer first and then activate.
    ///
    /// @ref LLP 0290#44-auth-time-activation — reset rebuild uses the same
    /// database-validated activation as first installation, not a bypass.
    /// @ref LLP 0059#locking-and-linearization — the issuer mutex remains
    /// outside the managed/direct Local write scope.
    pub fn install_authorization_issuer_and_activate(
        &self,
        database: &mut ServingDatabase,
        issuer: crate::auth::invalidation::LiveInvalidationIssuer,
    ) -> SnapbackResult<()> {
        let RoomAuthority::Bound(participant) = &self.shared.room_authority else {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                "auth",
                "standalone ephemeral backend has no database-bound authorization participant",
            ));
        };
        let issuer_projection = issuer.authorization_issuer_projection()?.clone();
        if crate::exec_guard::local_write_scope_active() {
            database.activate_authorization_commit_participant(participant, &issuer_projection)?;
            let backend = self.clone();
            crate::exec_guard::run_or_defer_after_local(move || {
                backend.install_authorization_issuer(issuer);
            });
            return Ok(());
        }

        self.install_authorization_issuer(issuer);
        database.activate_authorization_commit_participant(participant, &issuer_projection)
    }

    pub fn clear_authorization_issuer(&self) {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "ephemeral authorization issuer clearing",
        );
        self.suspend_authorization_commit_projection();
        *lock(&self.shared.authorization_issuer) = None;
    }

    /// Fail closed at reservation and transaction bind before removing the
    /// issuer that projects same-incarnation authorization commits.
    pub fn suspend_authorization_commit_projection(&self) {
        if let RoomAuthority::Bound(participant) = &self.shared.room_authority {
            participant.suspend_authorization_projection();
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn authorization_expectation_for_test(&self) -> Option<AuthorizationVersion> {
        lock(&self.shared.authorization_issuer)
            .as_ref()
            .map(|issuer| {
                issuer
                    .authorization_expectation()
                    .expect("test issuer expectation")
            })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn install_frame_before_first_enqueue_hook_for_test(
        &self,
        reached: std::sync::mpsc::SyncSender<EphemeralMessage>,
        release: std::sync::mpsc::Receiver<()>,
    ) {
        let previous = lock(&self.shared.frame_before_first_enqueue_hook)
            .replace(FrameBeforeFirstEnqueueTestHook { reached, release });
        assert!(previous.is_none(), "frame-before-enqueue hook is one-shot");
    }

    fn begin_room_authority_act(
        &self,
        collection: &EphemeralCollection,
        room_id: &RoomId,
    ) -> Result<Option<RoomAuthorityOperationGuard>, EphemeralError> {
        if !collection_requires_room_permission(collection) {
            return Ok(None);
        }
        self.shared
            .room_authority
            .begin_protected_room_operation(room_id)
            .map(Some)
    }

    fn room_authority_for_act(
        &self,
        collection: &EphemeralCollection,
        room_id: &RoomId,
        admitted: Option<&RoomAuthorityPermit>,
    ) -> Result<(u64, Option<RoomAuthorityOperationGuard>), EphemeralError> {
        if !collection_requires_room_permission(collection) {
            return Ok((0, None));
        }
        if let Some(admitted) = admitted {
            let operation = self
                .shared
                .room_authority
                .validate_admitted_room_act(admitted, room_id)?;
            return Ok((operation.generation(), Some(operation)));
        }
        let operation = self
            .begin_room_authority_act(collection, room_id)?
            .expect("protected room begins an authority operation");
        let generation = operation.generation();
        Ok((generation, Some(operation)))
    }

    /// Acquire the outer transport permit used while a server-derived durable
    /// permission is converted into an in-memory room act. The ordinary room
    /// operation acquires its own inner permit; this outer permit closes the
    /// read-to-registration gap and may be retained through final transport.
    pub fn begin_server_authorized_room_act(
        &self,
        collection_name: &str,
        scope: &Scope,
    ) -> Result<Option<RoomAuthorityPermit>, EphemeralError> {
        let collection = self.collection(collection_name)?;
        let room_id = room_id_for(&collection, scope)?;
        if !collection_requires_room_permission(&collection) {
            return Ok(None);
        }
        self.shared
            .room_authority
            .begin_protected_room_act(&room_id)
            .map(Some)
    }

    fn advance_collection_generation(&self) -> Result<(), EphemeralError> {
        self.shared
            .collection_generation
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |generation| {
                generation.checked_add(1)
            })
            .map(|_| ())
            .map_err(|_| {
                EphemeralError::new(
                    EphemeralErrorCode::RoomLimitExceeded,
                    "ephemeral collection definition generation exhausted",
                )
            })
    }

    pub fn reserve_authorization_commit(
        &self,
        preflight: AuthorizationCommitPreflight,
        cancellation: Arc<AuthorizationReservationCancellation>,
    ) -> SnapbackResult<AuthorizationCommitReservation> {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "off-Local room-authority commit reservation",
        );
        self.shared
            .room_authority
            .prepare_authorization_commit(preflight, cancellation)
    }

    pub fn pending_room_reauthorizations(&self) -> Vec<PendingRoomReauthorization> {
        let pending = self.shared.room_authority.pending_reauthorizations();
        let rooms = lock(&self.shared.rooms);
        pending
            .into_iter()
            .filter_map(|pending| {
                let room = rooms.get(&pending.room)?;
                let room = lock(room);
                Some(PendingRoomReauthorization {
                    room: pending.room,
                    obligation: pending.obligation,
                    subscribers: room
                        .subscribers
                        .iter()
                        .map(
                            |(connection_id, subscriber)| RoomSubscriberReauthorization {
                                connection_id: connection_id.clone(),
                                #[cfg(any(test, feature = "test-support"))]
                                previous_auth: subscriber.auth.clone(),
                                effect_fence: subscriber.effect_fence.clone(),
                            },
                        )
                        .collect(),
                })
            })
            .collect()
    }

    pub fn complete_room_reauthorization(
        &self,
        room_id: &RoomId,
        room_authority_generation: u64,
        resolutions: Vec<RoomSubscriberResolution>,
    ) -> SnapbackResult<bool> {
        // Reauthorization may remove entries and, at generation exhaustion,
        // retire the whole room and publish an epoch boundary. Serialize that
        // producer with definition/reset wipes so neither can clear the
        // other's terminal marker after missing the already-removed room.
        let _lifecycle = self.lifecycle_read("ephemeral room reauthorization completion");
        let admission = match self
            .shared
            .room_authority
            .begin_room_reauthorization_admission(room_id, room_authority_generation)
        {
            Ok(admission) => admission,
            Err(_) => return Ok(false),
        };
        let rooms = lock(&self.shared.rooms);
        let Some(room_arc) = rooms.get(room_id).cloned() else {
            admission.remove_missing_room();
            return Ok(true);
        };
        let mut room = lock(&room_arc);
        let expected = room
            .subscribers
            .iter()
            .map(|(connection_id, subscriber)| {
                (connection_id.clone(), subscriber.effect_fence.clone())
            })
            .collect::<BTreeSet<_>>();
        let resolved = resolutions
            .iter()
            .map(|resolution| match resolution {
                RoomSubscriberResolution::Authorized {
                    connection_id,
                    expected_effect_fence,
                    ..
                }
                | RoomSubscriberResolution::Denied {
                    connection_id,
                    expected_effect_fence,
                } => (connection_id.clone(), expected_effect_fence.clone()),
            })
            .collect::<BTreeSet<_>>();
        if expected != resolved || resolved.len() != resolutions.len() {
            // A readable connection id may have been replaced while durable
            // permission checks ran. Keep the level-triggered obligation
            // pending so maintenance resolves the replacement's exact fence;
            // never apply the predecessor's result to it.
            return Ok(false);
        }

        let denied = resolutions
            .iter()
            .filter_map(|resolution| match resolution {
                RoomSubscriberResolution::Denied { connection_id, .. } => {
                    Some(connection_id.clone())
                }
                RoomSubscriberResolution::Authorized { .. } => None,
            })
            .collect::<BTreeSet<_>>();
        let retiring_owners = room
            .owner_connections
            .iter()
            .filter_map(|(owner, connections)| {
                (!connections.is_empty()
                    && connections
                        .iter()
                        .all(|connection_id| denied.contains(connection_id)))
                .then_some(owner.clone())
            })
            .collect::<BTreeSet<_>>();
        let required_versions = room
            .entries
            .values()
            .filter(|record| retiring_owners.contains(&record.owner))
            .count();
        if let Err(error) = room.ensure_version_capacity(required_versions) {
            room.retired = true;
            drop(room);
            drop(rooms);
            drop(admission);
            self.retire_generation_exhausted_room(room_id);
            return Err(SnapbackError::error(
                error.code.diagnostic_code(),
                "ephemeral",
                error.message,
            ));
        }

        let mut denied_outboxes = Vec::new();
        let mut denied_connections = Vec::new();
        for resolution in &resolutions {
            match resolution {
                RoomSubscriberResolution::Authorized {
                    connection_id,
                    expected_effect_fence: _,
                    auth,
                } => {
                    let previous_retained_bytes = room
                        .subscribers
                        .get(connection_id)
                        .expect("resolution set equals current subscribers")
                        .retained_bytes;
                    let retained_bytes = retained_subscriber_bytes(connection_id)
                        .saturating_add(retained_auth_context_bytes(auth));
                    room.retained_bytes = room
                        .retained_bytes
                        .saturating_sub(previous_retained_bytes)
                        .saturating_add(retained_bytes);
                    let subscriber = room
                        .subscribers
                        .get_mut(connection_id)
                        .expect("resolution set equals current subscribers");
                    subscriber.auth = auth.clone();
                    subscriber.retained_bytes = retained_bytes;
                }
                RoomSubscriberResolution::Denied {
                    connection_id,
                    expected_effect_fence: _,
                } => {
                    let subscriber = room
                        .subscribers
                        .remove(connection_id)
                        .expect("resolution set equals current subscribers");
                    room.retained_bytes = room
                        .retained_bytes
                        .saturating_sub(subscriber.retained_bytes);
                    denied_outboxes.push((
                        connection_id.clone(),
                        subscriber.outbox,
                        subscriber.effect_fence,
                    ));
                    denied_connections.push(connection_id.clone());
                }
            }
        }

        let mut owners_to_remove = Vec::new();
        for connection_id in &denied_connections {
            let mut removed_owner_connections = 0_usize;
            for (owner, connections) in room.owner_connections.iter_mut() {
                if connections.remove(connection_id) {
                    removed_owner_connections = removed_owner_connections.saturating_add(1);
                }
                if connections.is_empty() {
                    owners_to_remove.push(owner.clone());
                }
            }
            room.owner_connection_count = room
                .owner_connection_count
                .saturating_sub(removed_owner_connections);
            room.retained_bytes = room.retained_bytes.saturating_sub(
                removed_owner_connections
                    .saturating_mul(retained_string_bytes(connection_id) + MAP_ENTRY_OVERHEAD),
            );
        }
        owners_to_remove.sort();
        owners_to_remove.dedup();
        let mut removals = Vec::new();
        for owner in owners_to_remove {
            room.owner_connections.remove(&owner);
            room.retained_bytes = room
                .retained_bytes
                .saturating_sub(retained_owner_bytes(&owner) + MAP_ENTRY_OVERHEAD);
            let keys = room
                .entries
                .iter()
                .filter_map(|(key, record)| (record.owner == owner).then_some(key.clone()))
                .collect::<Vec<_>>();
            for key in keys {
                if let Some(removal) = remove_entry_locked(
                    &mut room,
                    room_id,
                    &key,
                    RemoveReason::AuthRevoked,
                    room_authority_generation,
                )
                .expect("reauthorization removal capacity is preflighted before room mutation")
                {
                    removals.push(removal);
                }
            }
        }

        let entries = room
            .entries
            .iter()
            .map(|(key, record)| record.to_entry(key))
            .collect::<Vec<_>>();
        let high_water_version = room.next_entry_version.saturating_sub(1);
        let scope_epoch = room.scope_epoch;
        let subscribers = room
            .subscribers
            .iter()
            .map(|(connection_id, subscriber)| {
                (
                    connection_id.clone(),
                    subscriber.outbox.clone(),
                    subscriber.effect_fence.clone(),
                )
            })
            .collect::<Vec<_>>();
        let mut wakees = BTreeSet::new();
        for (connection_id, outbox, effect_fence) in &subscribers {
            let mut outbox = lock(outbox);
            for removal in &removals {
                self.record_queue_push(
                    outbox.push_resync(Arc::new(removal.clone()), effect_fence.clone()),
                );
            }
            self.record_queue_push(outbox.push_resync(
                Arc::new(EphemeralMessage::Snapshot {
                    ephemeral_authority_instance: None,
                    room: room_id.clone(),
                    scope_epoch,
                    room_authority_generation,
                    high_water_version,
                    entries: entries.clone(),
                    stream_resume: None,
                }),
                effect_fence.clone(),
            ));
            wakees.insert(connection_id.clone());
        }
        for (connection_id, outbox, effect_fence) in denied_outboxes {
            self.record_queue_push(lock(&outbox).push_resync(
                Arc::new(EphemeralMessage::Error {
                    ephemeral_authority_instance: None,
                    room: Some(room_id.clone()),
                    room_authority_generation: Some(room_authority_generation),
                    error: EphemeralError::new(
                        EphemeralErrorCode::PermissionDenied,
                        "durable room permission was revoked",
                    ),
                }),
                effect_fence,
            ));
            wakees.insert(connection_id);
        }

        admission.complete_exact();
        drop(room);
        drop(rooms);
        for connection_id in &denied_connections {
            self.unindex_connection_room_if_unused(connection_id, room_id);
        }
        self.shared
            .delivery
            .wake_many(&wakees.into_iter().collect::<Vec<_>>());
        self.prune_room_if_empty(room_id);
        Ok(true)
    }

    fn record_queue_push(&self, result: QueuePush) {
        if result.resync_count > 0 {
            self.shared
                .counters
                .resync_required
                .fetch_add(result.resync_count as u64, Ordering::Relaxed);
        }
        if result.overflowed {
            self.shared
                .counters
                .outbox_overflows
                .fetch_add(1, Ordering::Relaxed);
        }
    }

    /// The notifier the delivery task registers with (L8).
    pub fn delivery_notifier(&self) -> Arc<DeliveryNotifier> {
        self.shared.delivery.clone()
    }

    pub fn subscription_requires_permission(&self, collection: &str) -> Option<bool> {
        self.collection_if_loaded(collection).map(|definition| {
            matches!(
                definition.subscribe,
                AccessPolicy::RequireRoomPermission { .. }
            )
        })
    }

    pub fn begin_final_send(
        &self,
        envelope: &RealtimeEnvelope,
    ) -> Result<Option<RealtimePublicationPermit>, EphemeralError> {
        let mut admission = self.shared.room_authority.begin_outbox_admission(true)?;
        admission.admit_selected(envelope)
    }

    pub fn register_collection(
        &self,
        collection: EphemeralCollection,
    ) -> Result<(), EphemeralError> {
        validate_collection_definitions(std::slice::from_ref(&collection))?;
        let _generation = self.lifecycle_write("ephemeral collection registration");
        let (replaced, definitions) = {
            let collections = self
                .shared
                .collections
                .read()
                .unwrap_or_else(PoisonError::into_inner);
            match collections.get(&collection.name) {
                Some(current) if current == &collection => return Ok(()),
                Some(_) => {
                    let mut definitions = collections.values().cloned().collect::<Vec<_>>();
                    let index = definitions
                        .iter()
                        .position(|definition| definition.name == collection.name)
                        .expect("loaded collection is present in its snapshot");
                    definitions[index] = collection.clone();
                    (true, definitions)
                }
                None => {
                    let mut definitions = collections.values().cloned().collect::<Vec<_>>();
                    definitions.push(collection.clone());
                    (false, definitions)
                }
            }
        };
        self.shared
            .room_authority
            .replace_protected_room_catalog(&definitions)?;
        self.advance_collection_generation()?;
        self.shared
            .collections
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(collection.name.clone(), collection);
        if replaced {
            #[cfg(test)]
            self.pause_after_definition_swap_for_test();
            // `register_collection` is public for embedded/setup consumers.
            // A changed existing definition is the same generation boundary
            // as a whole-manifest replacement; it may not overwrite live room
            // semantics while retaining old epochs, queues, or rate buckets.
            self.wipe_rooms_signaling_resync(ResyncReason::EpochChanged);
            lock(&self.shared.rate_buckets).clear();
        }
        Ok(())
    }

    /// Provisioning-time definition load. Identical definitions are an
    /// idempotent no-op; changed definitions are a destructive replacement
    /// that retires all rooms and signals every registered subscriber.
    pub fn replace_collections(
        &self,
        collections: Vec<EphemeralCollection>,
    ) -> Result<(), EphemeralError> {
        validate_collection_definitions(&collections)?;
        let next = collections
            .into_iter()
            .map(|collection| (collection.name.clone(), collection))
            .collect::<BTreeMap<_, _>>();

        let _generation = self.lifecycle_write("ephemeral collection replacement");
        // @ref LLP 0025#store-feature-idempotent-collection-ensure — repeated
        // app-definition loads with identical ephemeral definitions must not
        // erase active cursor rooms or queued latest-state messages.
        if *self
            .shared
            .collections
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            == next
        {
            return Ok(());
        }
        let definitions = next.values().cloned().collect::<Vec<_>>();
        // Kernel catalog publication precedes sync visibility, with neither
        // lock nested inside the other. The lifecycle guard serializes the cut.
        self.shared
            .room_authority
            .replace_protected_room_catalog(&definitions)?;
        self.advance_collection_generation()?;
        *self
            .shared
            .collections
            .write()
            .unwrap_or_else(PoisonError::into_inner) = next;

        #[cfg(test)]
        self.pause_after_definition_swap_for_test();

        // A destructive replacement retires room epochs under live
        // connections: tell each registered subscriber to resubscribe instead
        // of going silent. `EpochChanged` is the ratified reason for this
        // boundary (ENG-22478 review fix D); recreated rooms carry strictly
        // higher epochs from the store-global allocator.
        self.wipe_rooms_signaling_resync(ResyncReason::EpochChanged);
        lock(&self.shared.rate_buckets).clear();
        Ok(())
    }

    #[cfg(test)]
    fn pause_after_definition_swap_for_test(&self) {
        let hook = lock(&self.shared.definition_swap_hook).take();
        if let Some(hook) = hook {
            hook.reached
                .send(())
                .expect("definition-swap test observer remains alive");
            hook.release
                .recv()
                .expect("definition-swap test releases replacement");
        }
    }

    pub fn ensure_collections(
        &self,
        collections: Vec<EphemeralCollection>,
    ) -> Result<CollectionEnsureOutcome, EphemeralError> {
        self.ensure_collections_with_error_detail(collections, true)
    }

    pub fn ensure_collections_redacted(
        &self,
        collections: Vec<EphemeralCollection>,
    ) -> Result<CollectionEnsureOutcome, EphemeralError> {
        self.ensure_collections_with_error_detail(collections, false)
    }

    fn ensure_collections_with_error_detail(
        &self,
        collections: Vec<EphemeralCollection>,
        include_names: bool,
    ) -> Result<CollectionEnsureOutcome, EphemeralError> {
        validate_collection_definitions(&collections)?;
        let _generation = self.lifecycle_read("ephemeral collection ensure");
        let expected = collections
            .into_iter()
            .map(|collection| (collection.name.clone(), collection))
            .collect::<BTreeMap<_, _>>();
        let expected_names = expected.keys().cloned().collect::<BTreeSet<_>>();

        {
            let loaded = self
                .shared
                .collections
                .read()
                .unwrap_or_else(PoisonError::into_inner);
            let loaded_names = loaded.keys().cloned().collect::<BTreeSet<_>>();

            let missing = expected_names
                .difference(&loaded_names)
                .cloned()
                .collect::<Vec<_>>();
            if !missing.is_empty() {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::UnknownCollection,
                    if include_names {
                        format!(
                            "ephemeral collection definitions are not loaded: {}",
                            missing.join(", ")
                        )
                    } else {
                        format!(
                            "ephemeral collection definitions are not loaded (missing count: {})",
                            missing.len()
                        )
                    },
                ));
            }

            let extra = loaded_names
                .difference(&expected_names)
                .cloned()
                .collect::<Vec<_>>();
            let mismatched = expected
                .iter()
                .filter_map(|(name, expected)| {
                    loaded
                        .get(name)
                        .filter(|current| *current != expected)
                        .map(|_| name.clone())
                })
                .collect::<Vec<_>>();
            if !extra.is_empty() || !mismatched.is_empty() {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::IncompatibleCollectionDefinition,
                    if include_names {
                        format!(
                            "loaded ephemeral collection definitions do not match generated artifacts (mismatched: [{}], extra: [{}])",
                            mismatched.join(", "),
                            extra.join(", ")
                        )
                    } else {
                        format!(
                            "loaded ephemeral collection definitions do not match generated artifacts (mismatched count: {}, extra count: {})",
                            mismatched.len(),
                            extra.len()
                        )
                    },
                ));
            }
        }

        Ok(CollectionEnsureOutcome {
            collection_count: expected.len(),
            preserved_room_count: lock(&self.shared.rooms).len(),
            preserved_outbox_count: lock(&self.shared.outboxes).len(),
        })
    }

    /// Explicit, observable runtime reset (LLP 0026 §Boundary): rooms are
    /// retired with `Restarted` resync signals to registered subscribers,
    /// queues and rate buckets are cleared, counters restart (the reset's own
    /// resync signals are counted, since they follow the counter reset).
    pub fn reset_runtime_state(&self) {
        let _generation = self.lifecycle_write("ephemeral runtime reset");
        self.shared.counters.reset();
        // The runtime reset retires the durable world too (the caller wipes
        // the database and drops every live subscription), so queued durable
        // payloads are pre-reset state: clear whole outboxes here, durable
        // lanes included — unlike the ephemeral-only boundary in
        // `wipe_rooms_signaling_resync` (ENG-23346). The drop is not silent:
        // `LocalSnapback::reset` enqueues a durable `resync_required` per
        // dropped subscription AFTER this call returns (ENG-23333).
        lock(&self.shared.outboxes).clear();
        self.wipe_rooms_signaling_resync(ResyncReason::Restarted);
        lock(&self.shared.rate_buckets).clear();
    }

    pub fn publish(
        &self,
        request: PublishRequest,
        now_ms: Millis,
    ) -> Result<PublishOutcome, EphemeralError> {
        self.publish_with_room_authority(request, now_ms, None)
    }

    pub fn publish_with_room_authority(
        &self,
        request: PublishRequest,
        now_ms: Millis,
        admitted: Option<&RoomAuthorityPermit>,
    ) -> Result<PublishOutcome, EphemeralError> {
        let _generation = self.lifecycle_read("ephemeral publish");
        self.validate_request_metadata(RequestMetadata {
            collection: &request.collection,
            scope: &request.scope,
            connection_id: &request.connection_id,
            auth: &request.auth,
            session_id: request.session_id.as_deref(),
            user_id: request.user_id.as_deref(),
            custom_key: request.custom_key.as_deref(),
        })?;
        let collection = self.collection(&request.collection)?;
        let room_id = room_id_for(&collection, &request.scope)?;
        let ttl_ms = request.ttl_ms.unwrap_or(collection.default_ttl_ms);
        self.validate_ttl(&collection, ttl_ms)?;
        self.validate_value_size(&collection, request.value.len())?;
        self.ensure_authorized(&collection.publish, &request.scope, &request.auth)?;
        let (room_authority_generation, _room_authority) =
            self.room_authority_for_act(&collection, &room_id, admitted)?;
        let key = entry_key_for_publish(&collection, &request)?;
        let owner = entry_owner_for(&collection, &request)?;
        self.ensure_publish_rate(&collection, &request.connection_id, now_ms)?;

        let expires_at_ms = now_ms.checked_add(ttl_ms).ok_or_else(|| {
            EphemeralError::new(
                EphemeralErrorCode::InvalidTtl,
                "ephemeral expiry exceeds the supported timestamp range",
            )
        })?;
        let connection_id = request.connection_id;
        let value = request.value;
        let value_len = value.len();
        let value_capacity = value.capacity();

        // Index the connection→room edge BEFORE the entry becomes visible: a
        // disconnect that runs after this publish's room mutation must find
        // the room in the index, or the owned entry would outlive its
        // connection until TTL expiry (ENG-23348).
        self.index_connection_room(&connection_id, &room_id);

        // One room critical section: sweep, limit checks, version allocation,
        // entry replacement, expiry indexing, and subscriber fan-out — so
        // per-room outbox order equals version order, and snapshot/register
        // atomicity holds against this publish.
        //
        // @ref LLP 0013#routing-and-rooms -- a room authority owns versions and latest-state fan-out.
        // @ref LLP 0026#as-built-sharded-local-room-authority-written-2026-07-02-before-the-l9-implementation — room-operation atomicity.
        let protected_generation =
            collection_requires_room_permission(&collection).then_some(room_authority_generation);
        let outcome = match self.with_room_create(&room_id, protected_generation, |room| {
            if let Some(previous) = room.entries.get(&key)
                && previous.expires_at_ms > now_ms
                && previous.owner != owner
            {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::Unauthorized,
                    "ephemeral entry is owned by another authenticated identity",
                ));
            }
            let required_versions = room
                .entries
                .values()
                .filter(|record| record.expires_at_ms <= now_ms)
                .count()
                .saturating_add(1);
            if let Err(error) = room.ensure_version_capacity(required_versions) {
                room.retired = true;
                return Err(error);
            }
            self.sweep_room_locked(
                room,
                &room_id,
                Some(&collection),
                now_ms,
                room_authority_generation,
            )?;

            if let Some(previous) = room.entries.get(&key)
                && previous.owner != owner
            {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::Unauthorized,
                    "ephemeral entry is owned by another authenticated identity",
                ));
            }

            let replaced_retained_bytes =
                room.entries.get(&key).map(|record| record.retained_bytes);
            if replaced_retained_bytes.is_none()
                && room.entries.len() >= self.shared.limits.max_entries_per_room
            {
                self.shared
                    .counters
                    .limit_rejections
                    .fetch_add(1, Ordering::Relaxed);
                return Err(EphemeralError::new(
                    EphemeralErrorCode::RoomLimitExceeded,
                    format!(
                        "room entry limit ({}) reached for {}",
                        self.shared.limits.max_entries_per_room, room_id.collection
                    ),
                ));
            }
            let owner_connection_bytes =
                room.owner_connection_additional_bytes(&owner, &connection_id);
            let connection_room_bytes = if room.uses_connection(&connection_id) {
                0
            } else {
                retained_connection_room_edge_bytes(&connection_id, &room_id)
            };
            let expiry_index_bytes = if room.indexed_deadline.is_none() {
                retained_expiry_index_entry_bytes(&room_id)
            } else {
                0
            };
            if owner_connection_bytes > 0
                && room.owner_connection_count >= self.shared.limits.max_subscribers_per_room
            {
                self.shared
                    .counters
                    .limit_rejections
                    .fetch_add(1, Ordering::Relaxed);
                return Err(EphemeralError::new(
                    EphemeralErrorCode::RoomLimitExceeded,
                    format!(
                        "room owner-connection limit ({}) reached for {}",
                        self.shared.limits.max_subscribers_per_room, room_id.collection
                    ),
                ));
            }
            let entry_retained_bytes = retained_entry_bytes(&key, &owner, value_capacity);
            let projected_retained_bytes = room
                .retained_bytes
                .saturating_sub(replaced_retained_bytes.unwrap_or(0))
                .saturating_add(entry_retained_bytes)
                .saturating_add(owner_connection_bytes)
                .saturating_add(connection_room_bytes)
                .saturating_add(expiry_index_bytes);
            if projected_retained_bytes > self.shared.limits.max_room_value_bytes {
                self.shared
                    .counters
                    .limit_rejections
                    .fetch_add(1, Ordering::Relaxed);
                return Err(EphemeralError::new(
                    EphemeralErrorCode::RoomLimitExceeded,
                    format!(
                        "room retained-byte limit ({}) reached for {}",
                        self.shared.limits.max_room_value_bytes, room_id.collection
                    ),
                ));
            }

            let entry_version = room.allocate_version();
            let scope_epoch = room.scope_epoch;
            room.remember_owner_connection(&owner, &connection_id);
            let record = EntryRecord {
                owner,
                value,
                received_at_ms: now_ms,
                expires_at_ms,
                scope_epoch,
                entry_version,
                retained_bytes: entry_retained_bytes,
            };
            let entry = record.to_entry(&key);
            if let Some(previous) = room.entries.insert(key.clone(), record) {
                room.value_bytes = room.value_bytes.saturating_sub(previous.value.len());
                room.retained_bytes = room.retained_bytes.saturating_sub(previous.retained_bytes);
                forget_expiry_locked(room, previous.expires_at_ms);
            }
            remember_expiry_locked(room, expires_at_ms);
            room.value_bytes += value_len;
            room.retained_bytes = room
                .retained_bytes
                .saturating_add(entry_retained_bytes)
                .saturating_add(owner_connection_bytes)
                .saturating_add(connection_room_bytes);
            // Re-assert the edge after state becomes visible. The provisional
            // edge above makes disconnect find an in-flight operation; this
            // post-write edge closes the inverse race where a disconnect
            // consumed that provisional edge before the room lock was won.
            self.index_connection_room(&connection_id, &room_id);
            self.index_room_deadline(room, &room_id, expires_at_ms);
            self.fan_out_locked(
                room,
                &room_id,
                &collection,
                EphemeralMessage::Upsert {
                    ephemeral_authority_instance: None,
                    room: room_id.clone(),
                    room_authority_generation,
                    entry,
                },
            );

            Ok(PublishOutcome {
                room: room_id.clone(),
                key: key.clone(),
                scope_epoch,
                entry_version,
                expires_at_ms,
            })
        }) {
            Ok(inner) => inner,
            Err(error) => Err(error),
        };

        if let Err(error) = &outcome
            && error.code == EphemeralErrorCode::RoomLimitExceeded
        {
            self.shared
                .counters
                .rejected_publishes
                .fetch_add(1, Ordering::Relaxed);
        }
        if let Err(error) = &outcome
            && error.code == EphemeralErrorCode::GenerationExhausted
        {
            self.retire_generation_exhausted_room(&room_id);
        }
        if outcome.is_err() {
            self.unindex_connection_room_if_unused(&connection_id, &room_id);
            self.prune_room_if_empty(&room_id);
        }
        outcome
    }

    pub fn delete(
        &self,
        request: DeleteRequest,
        now_ms: Millis,
    ) -> Result<DeleteSettlement, EphemeralError> {
        self.delete_with_room_authority(request, now_ms, None)
    }

    pub fn delete_with_room_authority(
        &self,
        request: DeleteRequest,
        now_ms: Millis,
        admitted: Option<&RoomAuthorityPermit>,
    ) -> Result<DeleteSettlement, EphemeralError> {
        let _generation = self.lifecycle_read("ephemeral delete");
        self.validate_request_metadata(RequestMetadata {
            collection: &request.collection,
            scope: &request.scope,
            connection_id: &request.connection_id,
            auth: &request.auth,
            session_id: request.session_id.as_deref(),
            user_id: request.user_id.as_deref(),
            custom_key: request.custom_key.as_deref(),
        })?;
        // @ref LLP 0013#stored-entry-shape — every client-visible fence stays
        // inside the shipped plain-JSON counter domain, including ingress.
        if request
            .expected_scope_epoch
            .is_some_and(|value| value > crate::manifest::PORTABLE_STORAGE_VERSION_MAX)
            || request
                .expected_entry_generation
                .is_some_and(|value| value > crate::manifest::PORTABLE_STORAGE_VERSION_MAX)
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::InvalidScope,
                "ephemeral delete fence values must not exceed the JSON safe-integer maximum",
            ));
        }
        let collection = self.collection(&request.collection)?;
        let room_id = room_id_for(&collection, &request.scope)?;
        self.ensure_authorized(&collection.publish, &request.scope, &request.auth)?;
        let (room_authority_generation, _room_authority) =
            self.room_authority_for_act(&collection, &room_id, admitted)?;
        let key = entry_key_for_delete(&collection, &request)?;
        let owner = entry_owner_for_delete(&collection, &request)?;
        let expected_pair = match (
            request.expected_scope_epoch,
            request.expected_entry_generation,
        ) {
            (Some(scope_epoch), Some(entry_generation)) => Some((scope_epoch, entry_generation)),
            (None, None) => None,
            _ => {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::InvalidScope,
                    "ephemeral delete expected_scope_epoch and expected_entry_generation must be supplied together",
                ));
            }
        };

        let result = match self.with_existing_room(&room_id, |room| {
            // @ref LLP 0013#authorization-and-privacy — ownership is also an
            // information boundary: authorize the live key before observing
            // its fence pair or distinguishing absent from superseded.
            if let Some(record) = room.entries.get(&key)
                && record.expires_at_ms > now_ms
                && record.owner != owner
            {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::Unauthorized,
                    "ephemeral entry is owned by another authenticated identity",
                ));
            }
            if let Some((expected_scope_epoch, expected_entry_generation)) = expected_pair {
                let actual_entry_generation =
                    room.entries.get(&key).map(|entry| entry.entry_version);
                if room.scope_epoch != expected_scope_epoch
                    || actual_entry_generation
                        .is_some_and(|actual| actual != expected_entry_generation)
                {
                    return Ok((
                        DeleteSettlement::superseded(
                            expected_scope_epoch,
                            expected_entry_generation,
                            Some(room.scope_epoch),
                            actual_entry_generation,
                        ),
                        BTreeSet::new(),
                    ));
                }
            }
            let expired = room
                .entries
                .values()
                .filter(|record| record.expires_at_ms <= now_ms)
                .count();
            let delete_after_sweep = usize::from(
                room.entries
                    .get(&key)
                    .is_some_and(|record| record.expires_at_ms > now_ms),
            );
            if let Err(error) =
                room.ensure_version_capacity(expired.saturating_add(delete_after_sweep))
            {
                room.retired = true;
                return Err(error);
            }
            self.sweep_room_locked(
                room,
                &room_id,
                Some(&collection),
                now_ms,
                room_authority_generation,
            )?;
            let Some(record) = room.entries.get(&key) else {
                return Ok((DeleteSettlement::absent(), BTreeSet::new()));
            };
            if record.owner != owner {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::Unauthorized,
                    "ephemeral entry is owned by another authenticated identity",
                ));
            }
            let affected = room
                .owner_connections
                .get(&record.owner)
                .cloned()
                .unwrap_or_default();
            let removed = remove_entry_locked(
                room,
                &room_id,
                &key,
                RemoveReason::Deleted,
                room_authority_generation,
            )?;
            if let Some(message) = &removed {
                self.fan_out_locked(room, &room_id, &collection, message.clone());
            }
            Ok((
                removed.map_or_else(DeleteSettlement::absent, DeleteSettlement::deleted),
                affected,
            ))
        }) {
            Some(result) => result,
            None => Ok((DeleteSettlement::absent(), BTreeSet::new())),
        };
        let (settlement, affected_connections) = match result {
            Ok(result) => result,
            Err(error) => {
                if error.code == EphemeralErrorCode::GenerationExhausted {
                    self.retire_generation_exhausted_room(&room_id);
                }
                return Err(error);
            }
        };
        for connection_id in affected_connections {
            self.unindex_connection_room_if_unused(&connection_id, &room_id);
        }
        self.prune_room_if_empty(&room_id);
        Ok(settlement)
    }

    /// Operator-only ephemeral-entry delete (LLP 0184 §C). Distinct from
    /// `delete`/`delete_with_room_authority`: no connection/ownership
    /// authority is evaluated — this is an explicit administrator bypass,
    /// fenced on BOTH the room's current scope epoch and the entry's own
    /// generation (`entry_version`) together, compared under the room lock.
    /// A room that empties and is recreated within one server startup gets a
    /// fresh scope epoch while its entry-version counter restarts at 1, so
    /// generation alone would not be fencing-safe against a reborn room
    /// reusing an old generation number.
    ///
    /// @ref LLP 0184#c-administrator-ephemeral-entry-delete--add-now — epoch+generation fencing, explicit bypass, ordinary notification.
    pub fn operator_delete(
        &self,
        request: OperatorDeleteRequest,
        now_ms: Millis,
    ) -> Result<EphemeralMessage, EphemeralError> {
        let _generation = self.lifecycle_read("ephemeral operator delete");
        let collection = self.collection(&request.collection)?;
        let room_id = room_id_for(&collection, &request.scope)?;
        let key = EntryKey(request.entry_key.clone());
        let (room_authority_generation, _room_authority) =
            self.room_authority_for_act(&collection, &room_id, None)?;

        let result = self.with_existing_room(&room_id, |room| {
            if room.scope_epoch != request.expected_scope_epoch {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::StaleScopeEpoch,
                    format!(
                        "expected scope epoch {} does not match the room's current epoch {}",
                        request.expected_scope_epoch, room.scope_epoch
                    ),
                ));
            }
            let Some(record) = room.entries.get(&key) else {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::EntryNotFound,
                    "no entry exists at this key in this room",
                ));
            };
            if record.entry_version != request.expected_entry_generation {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::StaleEntryGeneration,
                    format!(
                        "expected entry generation {} does not match the entry's current generation {}",
                        request.expected_entry_generation, record.entry_version
                    ),
                ));
            }

            let expired = room
                .entries
                .values()
                .filter(|record| record.expires_at_ms <= now_ms)
                .count();
            let delete_after_sweep = usize::from(record.expires_at_ms > now_ms);
            if let Err(error) =
                room.ensure_version_capacity(expired.saturating_add(delete_after_sweep))
            {
                room.retired = true;
                return Err(error);
            }
            self.sweep_room_locked(
                room,
                &room_id,
                Some(&collection),
                now_ms,
                room_authority_generation,
            )?;
            let Some(record) = room.entries.get(&key) else {
                return Ok((None, BTreeSet::new()));
            };
            let affected = room
                .owner_connections
                .get(&record.owner)
                .cloned()
                .unwrap_or_default();
            let removed = remove_entry_locked(
                room,
                &room_id,
                &key,
                RemoveReason::Deleted,
                room_authority_generation,
            )?;
            if let Some(message) = &removed {
                self.fan_out_locked(room, &room_id, &collection, message.clone());
            }
            Ok((removed, affected))
        });
        let (removed, affected_connections) = match result {
            Some(Ok(result)) => result,
            Some(Err(error)) => {
                if error.code == EphemeralErrorCode::GenerationExhausted {
                    self.retire_generation_exhausted_room(&room_id);
                }
                return Err(error);
            }
            None => {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::RoomNotFound,
                    "no room exists at this collection/scope identity",
                ));
            }
        };
        for connection_id in affected_connections {
            self.unindex_connection_room_if_unused(&connection_id, &room_id);
        }
        self.prune_room_if_empty(&room_id);
        removed.ok_or_else(|| {
            EphemeralError::new(
                EphemeralErrorCode::EntryNotFound,
                "no entry exists at this key in this room",
            )
        })
    }

    /// Remove one connection's subscriber registration from a room without
    /// touching its published entries (ENG-22527 item 3: the adapter's
    /// idle-room teardown). Dropping observation is never privileged — the
    /// HTTP layer binds the connection identity exactly as for the other
    /// ephemeral operations. Returns whether a registration was removed;
    /// an unknown collection, invalid room, or unknown registration is a quiet
    /// no-op (teardown races schema replacement, disconnect, and reap).
    pub fn unsubscribe(&self, request: SubscribeRequest) -> Result<bool, EphemeralError> {
        self.unsubscribe_with_room_authority(request, None)
    }

    pub fn unsubscribe_with_room_authority(
        &self,
        request: SubscribeRequest,
        admitted: Option<&RoomAuthorityPermit>,
    ) -> Result<bool, EphemeralError> {
        let _generation = self.lifecycle_read("ephemeral unsubscribe");
        self.validate_request_metadata(RequestMetadata {
            collection: &request.collection,
            scope: &request.scope,
            connection_id: &request.connection_id,
            auth: &request.auth,
            session_id: None,
            user_id: None,
            custom_key: None,
        })?;
        let Some(collection) = self.collection_if_loaded(&request.collection) else {
            return Ok(false);
        };
        let Ok(room_id) = room_id_for(&collection, &request.scope) else {
            return Ok(false);
        };
        let (_room_authority_generation, _room_authority) =
            self.room_authority_for_act(&collection, &room_id, admitted)?;
        let room_arc = {
            let rooms = lock(&self.shared.rooms);
            rooms.get(&room_id).cloned()
        };
        let Some(room_arc) = room_arc else {
            return Ok(false);
        };
        let removed = {
            let mut room = lock(&room_arc);
            if room.retired {
                false
            } else {
                let removed = room.subscribers.remove(&request.connection_id);
                if let Some(removed) = &removed {
                    room.retained_bytes =
                        room.retained_bytes.saturating_sub(removed.retained_bytes);
                    if !room.uses_connection(&request.connection_id) {
                        room.retained_bytes = room.retained_bytes.saturating_sub(
                            retained_connection_room_edge_bytes(&request.connection_id, &room_id),
                        );
                    }
                }
                removed.is_some()
            }
        };
        if removed {
            self.unindex_connection_room_if_unused(&request.connection_id, &room_id);
            self.prune_room_if_empty(&room_id);
        }
        Ok(removed)
    }

    pub fn subscribe(
        &self,
        request: SubscribeRequest,
        now_ms: Millis,
    ) -> Result<EphemeralMessage, EphemeralError> {
        self.subscribe_with_room_authority_and_effect_fence(request, now_ms, None, None)
    }

    pub fn subscribe_with_room_authority(
        &self,
        request: SubscribeRequest,
        now_ms: Millis,
        admitted: Option<&RoomAuthorityPermit>,
    ) -> Result<EphemeralMessage, EphemeralError> {
        self.subscribe_with_room_authority_and_effect_fence(request, now_ms, admitted, None)
    }

    pub fn subscribe_with_room_authority_and_effect_fence(
        &self,
        request: SubscribeRequest,
        now_ms: Millis,
        admitted: Option<&RoomAuthorityPermit>,
        effect_fence: Option<ConnectionEffectFence>,
    ) -> Result<EphemeralMessage, EphemeralError> {
        let _generation = self.lifecycle_read("ephemeral subscribe");
        self.validate_request_metadata(RequestMetadata {
            collection: &request.collection,
            scope: &request.scope,
            connection_id: &request.connection_id,
            auth: &request.auth,
            session_id: None,
            user_id: None,
            custom_key: None,
        })?;
        let collection = self.collection(&request.collection)?;
        let room_id = room_id_for(&collection, &request.scope)?;
        self.ensure_authorized(&collection.subscribe, &request.scope, &request.auth)?;
        let (room_authority_generation, _room_authority) =
            self.room_authority_for_act(&collection, &room_id, admitted)?;

        // Index-before-registration, same as publish: a disconnect racing
        // this subscribe must find the room in the connection's index so the
        // registration cannot survive its connection (ENG-23348).
        self.index_connection_room(&request.connection_id, &room_id);

        // @ref LLP 0013#room-store-model -- snapshot and subscriber registration must be one room operation.
        let protected_generation =
            collection_requires_room_permission(&collection).then_some(room_authority_generation);
        let outcome = match self.with_room_create(&room_id, protected_generation, |room| {
            self.sweep_room_locked(
                room,
                &room_id,
                Some(&collection),
                now_ms,
                room_authority_generation,
            )?;
            let new_subscriber = !room.subscribers.contains_key(&request.connection_id);
            if new_subscriber
                && room.subscribers.len() >= self.shared.limits.max_subscribers_per_room
            {
                self.shared
                    .counters
                    .limit_rejections
                    .fetch_add(1, Ordering::Relaxed);
                return Err(EphemeralError::new(
                    EphemeralErrorCode::RoomLimitExceeded,
                    format!(
                        "room subscriber limit ({}) reached for {}",
                        self.shared.limits.max_subscribers_per_room, room_id.collection
                    ),
                ));
            }
            let previous_subscriber_bytes = room
                .subscribers
                .get(&request.connection_id)
                .map_or(0, |subscriber| subscriber.retained_bytes);
            let subscriber_bytes = retained_subscriber_bytes(&request.connection_id)
                .saturating_add(retained_auth_context_bytes(&request.auth));
            let connection_room_bytes = if room.uses_connection(&request.connection_id) {
                0
            } else {
                retained_connection_room_edge_bytes(&request.connection_id, &room_id)
            };
            if room
                .retained_bytes
                .saturating_sub(previous_subscriber_bytes)
                .saturating_add(subscriber_bytes)
                .saturating_add(connection_room_bytes)
                > self.shared.limits.max_room_value_bytes
            {
                self.shared
                    .counters
                    .limit_rejections
                    .fetch_add(1, Ordering::Relaxed);
                return Err(EphemeralError::new(
                    EphemeralErrorCode::RoomLimitExceeded,
                    format!(
                        "room retained-byte limit ({}) reached for {}",
                        self.shared.limits.max_room_value_bytes, room_id.collection
                    ),
                ));
            }
            // The outbox exists before the registration becomes visible, so a
            // racing publish that sees this subscriber has somewhere to
            // enqueue. Fan-out keeps this handle and does not take the
            // store-global outbox map on the hot path.
            let outbox = self.ensure_outbox(&request.connection_id);
            let mut entries: Vec<EphemeralEntry> = room
                .entries
                .iter()
                .map(|(key, record)| record.to_entry(key))
                .collect();
            let stream_resume = if collection.name == STREAM_COLLECTION_NAME {
                let attempt_token = request.scope.get("attemptToken").unwrap_or_default();
                let retained_indexes = entries
                    .iter()
                    .filter_map(|entry| serde_json::from_slice::<Value>(&entry.value).ok())
                    .filter_map(|value| value.get("chunkIndex").and_then(Value::as_u64))
                    .collect::<Vec<_>>();
                if let Some(since) = request.since_chunk {
                    entries.retain(|entry| {
                        serde_json::from_slice::<Value>(&entry.value)
                            .ok()
                            .and_then(|value| value.get("chunkIndex").and_then(Value::as_u64))
                            .is_some_and(|index| index > since)
                    });
                }
                let next_chunk = crate::stream_attempt::global_stream_attempt_registry()
                    .stream_output(attempt_token)
                    .map_or(0, |attempt| attempt.chunk_count);
                let truncated = request.since_chunk.is_some_and(|since| {
                    let expected = since.saturating_add(1);
                    retained_indexes
                        .iter()
                        .min()
                        .is_some_and(|minimum| expected < *minimum)
                        || (retained_indexes.is_empty() && expected < next_chunk)
                });
                Some(StreamResumeInfo {
                    truncated,
                    next_chunk,
                    transcript_path: format!("/streams/{attempt_token}"),
                })
            } else {
                None
            };
            room.subscribers.insert(
                request.connection_id.clone(),
                SubscriberState {
                    outbox,
                    auth: request.auth.clone(),
                    effect_fence: effect_fence.clone(),
                    retained_bytes: subscriber_bytes,
                },
            );
            room.retained_bytes = room
                .retained_bytes
                .saturating_sub(previous_subscriber_bytes)
                .saturating_add(subscriber_bytes)
                .saturating_add(connection_room_bytes);
            self.index_connection_room(&request.connection_id, &room_id);
            Ok(EphemeralMessage::Snapshot {
                ephemeral_authority_instance: None,
                room: room_id.clone(),
                scope_epoch: room.scope_epoch,
                room_authority_generation,
                high_water_version: room.next_entry_version.saturating_sub(1),
                entries,
                stream_resume,
            })
        }) {
            Ok(inner) => inner,
            Err(error) => Err(error),
        };
        if outcome.is_err() {
            if outcome
                .as_ref()
                .is_err_and(|error| error.code == EphemeralErrorCode::GenerationExhausted)
            {
                self.retire_generation_exhausted_room(&room_id);
            }
            self.unindex_connection_room_if_unused(&request.connection_id, &room_id);
            self.prune_room_if_empty(&room_id);
        }
        outcome
    }

    /// Tear down one connection: its subscriber registrations, its owned
    /// entries, its outbox, and its rate buckets. Visits only the rooms in
    /// the connection's reverse index — never a full-store scan — because
    /// callers amplify this call (the reaper runs it once per stale
    /// connection, and WS teardown runs it under the global write mutex), so
    /// its cost must scale with the connection's footprint, not the store's
    /// (ENG-23348). Expired entries in untouched rooms are `cleanup_expired`'s
    /// job via the expiry index.
    ///
    /// @ref LLP 0026#as-built-sharded-local-room-authority-written-2026-07-02-before-the-l9-implementation — disconnect cost scales with the connection, not the store.
    pub fn disconnect(&self, connection_id: &str, now_ms: Millis) {
        self.disconnect_inner(connection_id, now_ms, false, true);
    }

    /// Whole-readable-id teardown after the connection registry has entered
    /// mint-only containment. Unlike an administrative disconnect, this path
    /// must not synthesize a recovery marker or wake the terminal socket: an
    /// exact typed auth event, when present, remains the sole wake owner.
    pub fn disconnect_terminal_retired(&self, connection_id: &str, now_ms: Millis) {
        self.disconnect_inner(connection_id, now_ms, false, false);
    }

    /// Generation-guarded disconnect for the WS teardown path (ENG-23426).
    /// The caller has already proven ownership by a successful `unregister`,
    /// but WS-lane ephemeral operations bypass the global write mutex, so a
    /// reconnect can register and re-subscribe *while this wipe runs*. Each
    /// destructive step therefore re-verifies — under that step's own lock —
    /// that no reconnect has re-registered the connection id, and the wipe
    /// aborts the moment the id is reclaimed: everything from that point on
    /// belongs to the new socket. Returns whether the wipe ran to completion
    /// (`false` = aborted because the id was reclaimed; any old-life residue
    /// left behind is removed by the connection's eventual final disconnect
    /// or entry TTL, and the reaper still uses the unconditional path).
    pub fn disconnect_guarded(&self, connection_id: &str, now_ms: Millis) -> bool {
        self.disconnect_inner(connection_id, now_ms, true, false)
    }

    fn disconnect_inner(
        &self,
        connection_id: &str,
        now_ms: Millis,
        guarded: bool,
        signal_disconnected: bool,
    ) -> bool {
        // Disconnect can allocate remove versions and terminally retire an
        // exhausted room. Keep its room/outbox effects in one definition
        // generation so a concurrent wipe cannot erase the only boundary.
        let _lifecycle = self.lifecycle_read("ephemeral connection disconnect");
        // Cheap early-out for the guarded path: the reconnect already owns
        // the id, so consuming the reverse index below would only orphan the
        // new socket's rooms from their eventual cleanup.
        if guarded && self.shared.delivery.is_registered(connection_id) {
            return false;
        }
        let touched = lock(&self.shared.connection_rooms)
            .remove(connection_id)
            .unwrap_or_default();
        let rooms: Vec<(RoomId, SharedRoom)> = {
            let rooms = lock(&self.shared.rooms);
            touched
                .into_iter()
                .filter_map(|room_id| {
                    let room = rooms.get(&room_id).cloned()?;
                    Some((room_id, room))
                })
                .collect()
        };

        let mut maybe_empty = Vec::new();
        let mut reclaimed_at = None;
        // ENG-23427: rooms this connection actually subscribed to, so an
        // unconditional wipe under a still-open socket can signal each one.
        let mut subscribed_rooms = Vec::new();
        for (visited, (room_id, room_arc)) in rooms.iter().enumerate() {
            let collection = self.collection_if_loaded(&room_id.collection);
            let room_authority = match collection
                .as_ref()
                .map(|collection| self.begin_room_authority_act(collection, room_id))
                .transpose()
            {
                Ok(room_authority) => room_authority.flatten(),
                Err(_) => {
                    // A prepared/committed authorization boundary owns this
                    // room. Leave its exact reverse-index suffix intact; an
                    // old-generation cleanup may not mutate or fan out while
                    // fresh reauthorization is pending.
                    reclaimed_at = Some(visited);
                    break;
                }
            };
            let room_authority_generation = room_authority
                .as_ref()
                .map(RoomAuthorityOperationGuard::generation)
                .unwrap_or(0);
            let mut room = lock(room_arc);
            // ENG-23426: check-under-the-room-lock. A reconnect registers
            // first (needing only the notifier lock) and its subscribe then
            // takes this room lock, so either its registration is visible
            // here (skip the wipe) or its subscribe lands after this room's
            // removals (and survives). Room→notifier is the established
            // lock order (`fan_out_locked` wakes under the room lock).
            if guarded && self.shared.delivery.is_registered(connection_id) {
                reclaimed_at = Some(visited);
                break;
            }
            if room.retired {
                continue;
            }
            let mut required_keys = room
                .entries
                .iter()
                .filter_map(|(key, record)| (record.expires_at_ms <= now_ms).then_some(key.clone()))
                .collect::<BTreeSet<_>>();
            let retiring_owners = room
                .owner_connections
                .iter()
                .filter_map(|(owner, connections)| {
                    (connections.len() == 1 && connections.contains(connection_id)).then_some(owner)
                })
                .collect::<BTreeSet<_>>();
            required_keys.extend(room.entries.iter().filter_map(|(key, record)| {
                retiring_owners
                    .contains(&record.owner)
                    .then_some(key.clone())
            }));
            if room.ensure_version_capacity(required_keys.len()).is_err() {
                room.retired = true;
                drop(room);
                self.retire_generation_exhausted_room(room_id);
                continue;
            }
            self.sweep_room_locked(
                &mut room,
                room_id,
                collection.as_ref(),
                now_ms,
                room_authority_generation,
            )
            .expect("disconnect removal capacity is preflighted before room mutation");
            let had_connection_room_edge = room.uses_connection(connection_id);
            if let Some(removed) = room.subscribers.remove(connection_id) {
                room.retained_bytes = room.retained_bytes.saturating_sub(removed.retained_bytes);
                subscribed_rooms.push((room_id.clone(), room.scope_epoch, removed.effect_fence));
            }
            let mut owners_to_remove = Vec::new();
            let mut removed_owner_connections = 0_usize;
            for (owner, connections) in room.owner_connections.iter_mut() {
                if connections.remove(connection_id) {
                    removed_owner_connections += 1;
                }
                if connections.is_empty() {
                    owners_to_remove.push(owner.clone());
                }
            }
            room.owner_connection_count = room
                .owner_connection_count
                .saturating_sub(removed_owner_connections);
            room.retained_bytes = room.retained_bytes.saturating_sub(
                removed_owner_connections
                    .saturating_mul(retained_string_bytes(connection_id) + MAP_ENTRY_OVERHEAD),
            );
            for owner in owners_to_remove {
                room.owner_connections.remove(&owner);
                room.retained_bytes = room
                    .retained_bytes
                    .saturating_sub(retained_owner_bytes(&owner) + MAP_ENTRY_OVERHEAD);
                let keys = room
                    .entries
                    .iter()
                    .filter_map(|(key, record)| (record.owner == owner).then_some(key.clone()))
                    .collect::<Vec<_>>();
                for key in keys {
                    if let Some(message) = remove_entry_locked(
                        &mut room,
                        room_id,
                        &key,
                        RemoveReason::Disconnected,
                        room_authority_generation,
                    )
                    .expect("disconnect removal capacity is preflighted before room mutation")
                    {
                        self.shared
                            .counters
                            .disconnected_entries
                            .fetch_add(1, Ordering::Relaxed);
                        if let Some(collection) = &collection {
                            self.fan_out_locked(&room, room_id, collection, message);
                        }
                    }
                }
            }
            if had_connection_room_edge && !room.uses_connection(connection_id) {
                room.retained_bytes = room
                    .retained_bytes
                    .saturating_sub(retained_connection_room_edge_bytes(connection_id, room_id));
            }
            if room.entries.is_empty() && room.subscribers.is_empty() {
                maybe_empty.push(room_id);
            }
        }
        for room_id in maybe_empty {
            self.prune_room_if_empty(room_id);
        }
        if let Some(visited) = reclaimed_at {
            // ENG-23426: the reverse index was consumed above, but the rooms
            // from the tripping one onward were not wiped. Re-index them so
            // the connection's eventual final disconnect still visits them —
            // otherwise an old-life subscriber entry could survive as a
            // zombie the index no longer reaches (the ENG-23348 invariant).
            // Rooms already wiped held no new-socket state: new state needs
            // a registration, and the very next room check trips on one.
            for (room_id, _) in &rooms[visited..] {
                self.index_connection_room(connection_id, room_id);
            }
            return false;
        }

        let outbox_removed =
            self.shared
                .delivery
                .act_with_registration(connection_id, |registered| {
                    // ENG-23426: same check-under-the-lock for the shared outbox. A
                    // reconnect's first enqueue goes through `ensure_outbox`, which
                    // needs this map lock, so a registration invisible here can only
                    // enqueue into a fresh entry created after this removal.
                    let mut outboxes = lock(&self.shared.outboxes);
                    if guarded && registered {
                        return false;
                    }
                    outboxes.remove(connection_id);
                    true
                });
        if !outbox_removed {
            return false;
        }
        // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D6:
        // rate buckets are keyed connection-first; drop this connection's
        // buckets on disconnect so they do not leak forever.
        lock(&self.shared.rate_buckets).remove(connection_id);
        // ENG-23427: an unconditional wipe (reaper/admin) that ran while the
        // connection still owns a delivery registration destroyed room
        // subscriptions under an OPEN socket — the pump task was merely
        // parked (e.g. in `sender.send` on a peer that stopped reading), so
        // no socket event will ever tell the client. Seed a fresh outbox
        // with one `ResyncRequired` per wiped room and store a wake permit;
        // when the peer resumes reading, the pump drains the sentinels and
        // the client re-snapshots instead of staying silently stale. The
        // guarded (WS teardown) path never signals: there a registration can
        // only be a reconnect's, whose fresh state was left intact above.
        //
        // @ref LLP 0008#realtime-delivery — a dropped subscription gets a
        // resync signal, never a silent freeze.
        if signal_disconnected
            && !subscribed_rooms.is_empty()
            && self.shared.delivery.is_registered(connection_id)
        {
            // Capture the authority generation before taking the outbox lock.
            // Final-send drains take the opposite, canonical order
            // (room-authority registry, then outbox), so looking it up from
            // inside `push_resync` would admit an ABBA deadlock.
            let subscribed_rooms = subscribed_rooms
                .into_iter()
                .map(|(room, scope_epoch, effect_fence)| {
                    let generation = self.shared.room_authority.room_generation(&room);
                    (room, scope_epoch, generation, effect_fence)
                })
                .collect::<Vec<_>>();
            let outbox = self.ensure_outbox(connection_id);
            {
                let mut outbox = lock(&outbox);
                for (room, scope_epoch, room_authority_generation, effect_fence) in subscribed_rooms
                {
                    let result = outbox.push_resync(
                        Arc::new(EphemeralMessage::ResyncRequired {
                            ephemeral_authority_instance: None,
                            room_authority_generation,
                            room,
                            scope_epoch,
                            reason: ResyncReason::Disconnected,
                        }),
                        effect_fence,
                    );
                    if result.overflowed {
                        self.shared
                            .counters
                            .outbox_overflows
                            .fetch_add(1, Ordering::Relaxed);
                    }
                    if result.resync_count > 0 {
                        self.shared
                            .counters
                            .resync_required
                            .fetch_add(result.resync_count as u64, Ordering::Relaxed);
                    }
                }
            }
            self.shared.delivery.wake(connection_id);
        }
        true
    }

    /// Prune expired entries through the expiry index: only rooms whose
    /// indexed deadline is due are visited — no scan of all rooms. Rooms left
    /// with no entries and no subscribers are pruned from the routing map;
    /// the next incarnation gets a fresh scope epoch.
    ///
    /// @ref LLP 0013#room-store-model -- cleanupExpired uses an expiry index, not a scan of every room.
    pub fn cleanup_expired(&self, now_ms: Millis) {
        // Expiry cleanup is an ordinary room mutation even though it is
        // maintenance-driven. In particular its exhaustion path publishes a
        // terminal epoch boundary that a concurrent definition/reset wipe
        // must not clear after observing the room already absent.
        let _lifecycle = self.lifecycle_read("ephemeral expiry cleanup");
        let due: Vec<RoomId> = {
            let mut index = lock(&self.shared.expiry_index);
            let mut due = Vec::new();
            while let Some(entry) = index.first_entry() {
                if entry.key().0 > now_ms {
                    break;
                }
                let ((_, room_id), ()) = entry.remove_entry();
                due.push(room_id);
            }
            due
        };

        for room_id in due {
            let collection = self.collection_if_loaded(&room_id.collection);
            let room_authority = match collection
                .as_ref()
                .map(|collection| self.begin_room_authority_act(collection, &room_id))
                .transpose()
            {
                Ok(room_authority) => room_authority.flatten(),
                Err(_) => {
                    // The expiry-index entry was consumed above. Restore an
                    // exact bound while the authorization barrier owns the
                    // room so cleanup can retry after reauthorization.
                    self.with_existing_room(&room_id, |room| {
                        if room
                            .indexed_deadline
                            .is_some_and(|deadline| deadline <= now_ms)
                        {
                            room.indexed_deadline = None;
                            room.retained_bytes = room
                                .retained_bytes
                                .saturating_sub(retained_expiry_index_entry_bytes(&room_id));
                        }
                        if let Some(earliest) = next_expiry_deadline(room) {
                            self.index_room_deadline(room, &room_id, earliest);
                        }
                    });
                    continue;
                }
            };
            let room_authority_generation = room_authority
                .as_ref()
                .map(RoomAuthorityOperationGuard::generation)
                .unwrap_or(0);
            let sweep: Option<Result<bool, EphemeralError>> =
                self.with_existing_room(&room_id, |room| {
                    // This room's index entry was consumed above. A racing
                    // publish may already have re-indexed the room at a
                    // future deadline; only clear the mirror when it still
                    // points at the consumed (due) bound.
                    if room
                        .indexed_deadline
                        .is_some_and(|deadline| deadline <= now_ms)
                    {
                        room.indexed_deadline = None;
                        room.retained_bytes = room
                            .retained_bytes
                            .saturating_sub(retained_expiry_index_entry_bytes(&room_id));
                    }
                    self.sweep_room_locked(
                        room,
                        &room_id,
                        collection.as_ref(),
                        now_ms,
                        room_authority_generation,
                    )?;
                    if let Some(earliest) = next_expiry_deadline(room) {
                        self.index_room_deadline(room, &room_id, earliest);
                    }
                    Ok(room.entries.is_empty() && room.subscribers.is_empty())
                });
            let prunable = match sweep {
                Some(Ok(prunable)) => prunable,
                Some(Err(error)) if error.code == EphemeralErrorCode::GenerationExhausted => {
                    self.retire_generation_exhausted_room(&room_id);
                    false
                }
                Some(Err(_)) | None => false,
            };
            if prunable {
                self.prune_room_if_empty(&room_id);
            }
        }
    }

    /// Preview or apply an operator-bounded expiry cleanup at an explicit
    /// cutoff. The periodic wall-clock sweep above remains the compatibility
    /// path for server maintenance; this method is the receipt-bearing LLP
    /// 0184 control operation.
    ///
    /// Each room is linearized independently. Apply uses the same
    /// `remove_entry_locked` + `fan_out_locked` mechanics as ordinary expiry,
    /// while the global bound caps the number of removed entries across the
    /// complete pass. Dry-run does not consume or rewrite the expiry index.
    ///
    /// @ref LLP 0184#p2-controlled-mutations — explicit cutoff, dry-run
    /// counts, bounded apply, and an honest truncation/blocked-room report.
    pub fn cleanup_expired_bounded(
        &self,
        cutoff_timestamp_ms: Millis,
        max_entries: usize,
        dry_run: bool,
    ) -> EphemeralCleanupReport {
        let _lifecycle = self.lifecycle_read("bounded ephemeral expiry cleanup");
        let due: Vec<RoomId> = {
            let mut index = lock(&self.shared.expiry_index);
            if dry_run {
                index
                    .iter()
                    .take_while(|((deadline, _), ())| *deadline <= cutoff_timestamp_ms)
                    .map(|((_, room_id), ())| room_id.clone())
                    .collect()
            } else {
                let mut due = Vec::new();
                while let Some(entry) = index.first_entry() {
                    if entry.key().0 > cutoff_timestamp_ms {
                        break;
                    }
                    let ((_, room_id), ()) = entry.remove_entry();
                    due.push(room_id);
                }
                due
            }
        };

        let mut remaining_budget = max_entries;
        let mut room_reports = Vec::new();
        let mut blocked_rooms = 0_usize;

        for room_id in due {
            let collection = self.collection_if_loaded(&room_id.collection);
            let room_authority = match collection
                .as_ref()
                .map(|collection| self.begin_room_authority_act(collection, &room_id))
                .transpose()
            {
                Ok(room_authority) => room_authority.flatten(),
                Err(_) => {
                    blocked_rooms = blocked_rooms.saturating_add(1);
                    if !dry_run {
                        self.with_existing_room(&room_id, |room| {
                            if room
                                .indexed_deadline
                                .is_some_and(|deadline| deadline <= cutoff_timestamp_ms)
                            {
                                room.indexed_deadline = None;
                                room.retained_bytes = room
                                    .retained_bytes
                                    .saturating_sub(retained_expiry_index_entry_bytes(&room_id));
                            }
                            if let Some(earliest) = next_expiry_deadline(room) {
                                self.index_room_deadline(room, &room_id, earliest);
                            }
                        });
                    }
                    continue;
                }
            };
            let room_authority_generation = room_authority
                .as_ref()
                .map(RoomAuthorityOperationGuard::generation)
                .unwrap_or(0);
            let available_budget = remaining_budget;
            let outcome: Option<Result<(EphemeralCleanupCounts, bool), EphemeralError>> = self
                .with_existing_room(&room_id, |room| {
                    if !dry_run
                        && room
                            .indexed_deadline
                            .is_some_and(|deadline| deadline <= cutoff_timestamp_ms)
                    {
                        room.indexed_deadline = None;
                        room.retained_bytes = room
                            .retained_bytes
                            .saturating_sub(retained_expiry_index_entry_bytes(&room_id));
                    }

                    let eligible_keys = room
                        .entries
                        .iter()
                        .filter_map(|(key, record)| {
                            (record.expires_at_ms <= cutoff_timestamp_ms).then_some(key.clone())
                        })
                        .collect::<Vec<_>>();
                    let planned = eligible_keys.len().min(available_budget);
                    let mut counts = EphemeralCleanupCounts {
                        examined: room.entries.len(),
                        eligible: eligible_keys.len(),
                        would_delete: planned,
                        deleted: 0,
                        remaining: eligible_keys.len().saturating_sub(planned),
                    };

                    if !dry_run && planned > 0 {
                        if let Err(error) = room.ensure_version_capacity(planned) {
                            if let Some(earliest) = next_expiry_deadline(room) {
                                self.index_room_deadline(room, &room_id, earliest);
                            }
                            return Err(error);
                        }
                        for key in eligible_keys.into_iter().take(planned) {
                            let affected_connections = room
                                .entries
                                .get(&key)
                                .and_then(|record| room.owner_connections.get(&record.owner))
                                .cloned()
                                .unwrap_or_default();
                            if let Some(message) = remove_entry_locked(
                                room,
                                &room_id,
                                &key,
                                RemoveReason::Expired,
                                room_authority_generation,
                            )
                            .expect("bounded cleanup capacity is preflighted before mutation")
                            {
                                counts.deleted = counts.deleted.saturating_add(1);
                                self.shared
                                    .counters
                                    .expired_entries
                                    .fetch_add(1, Ordering::Relaxed);
                                if let Some(collection) = collection.as_ref() {
                                    self.fan_out_locked(room, &room_id, collection, message);
                                }
                                for connection_id in affected_connections {
                                    self.sync_connection_room_index_locked(
                                        room,
                                        &connection_id,
                                        &room_id,
                                    );
                                }
                            }
                        }
                        counts.remaining = counts.eligible.saturating_sub(counts.deleted);
                    }

                    if !dry_run && let Some(earliest) = next_expiry_deadline(room) {
                        self.index_room_deadline(room, &room_id, earliest);
                    }
                    Ok((
                        counts,
                        !dry_run && room.entries.is_empty() && room.subscribers.is_empty(),
                    ))
                });

            match outcome {
                Some(Ok((counts, prunable))) => {
                    remaining_budget = remaining_budget.saturating_sub(if dry_run {
                        counts.would_delete
                    } else {
                        counts.deleted
                    });
                    room_reports.push((room_id.clone(), counts));
                    if prunable {
                        self.prune_room_if_empty(&room_id);
                    }
                }
                Some(Err(_)) => {
                    blocked_rooms = blocked_rooms.saturating_add(1);
                }
                None => {}
            }
        }

        let mut counts = EphemeralCleanupCounts::default();
        let mut by_collection = BTreeMap::<String, EphemeralCleanupCollectionReport>::new();
        for (room_id, room_counts) in room_reports {
            counts.add_assign(&room_counts);
            let collection = by_collection
                .entry(room_id.collection.clone())
                .or_insert_with(|| EphemeralCleanupCollectionReport {
                    collection: room_id.collection.clone(),
                    ..EphemeralCleanupCollectionReport::default()
                });
            collection.counts.add_assign(&room_counts);
            collection.rooms.push(EphemeralCleanupRoomReport {
                room_digest: ephemeral_cleanup_room_digest(&room_id),
                counts: room_counts,
            });
        }
        let truncated = counts.remaining > 0
            && if dry_run {
                counts.would_delete == max_entries
            } else {
                counts.deleted == max_entries
            };
        EphemeralCleanupReport {
            counts,
            collections: by_collection.into_values().collect(),
            truncated,
            complete: blocked_rooms == 0,
            blocked_rooms,
        }
    }

    pub fn enqueue_durable(
        &self,
        connection_id: impl Into<String>,
        payload: Vec<u8>,
    ) -> DurableEnqueueOutcome {
        self.enqueue_durable_message(connection_id, DurableMessage::new(payload))
    }

    /// Wake the current transport after publishing level-triggered durable
    /// state that the drain projects directly. No physical outbox entry is
    /// created: the retained state remains the sole delivery authority.
    pub fn wake_durable_projection(&self, connection_id: &str) {
        self.shared.delivery.wake(connection_id);
    }

    /// Prepare one scheduler-backed subscription frame for ordered enqueue.
    /// This is a no-op when the connection has no pending outbox. The Local
    /// owner calls it only while the evaluation scheduler is installed; the
    /// legacy inline lane never enters this coalescing path.
    pub fn supersede_pending_live_watermarks(
        &self,
        connection_id: &str,
        subscription_id: &str,
        next_version: u64,
    ) -> u64 {
        let outbox = lock(&self.shared.outboxes).get(connection_id).cloned();
        if let Some(outbox) = outbox {
            return lock(&outbox).supersede_pending_live_watermarks(subscription_id, next_version);
        }
        0
    }

    pub fn enqueue_durable_with_network_egress(
        &self,
        connection_id: impl Into<String>,
        payload: Vec<u8>,
        network_egress: Option<crate::network_profile::PreparedNetworkEgress>,
    ) -> DurableEnqueueOutcome {
        match network_egress {
            Some(network_egress) => self.enqueue_network_profiled_durable_message(
                connection_id,
                DurableMessage::new(payload).with_network_egress(network_egress),
            ),
            None => self.enqueue_durable(connection_id, payload),
        }
    }

    /// Retire one exact predecessor durable backlog at a sessions deployment
    /// cut. Authority-independent live frames carry no authorization-version
    /// stamp, but production still binds them to their connection effect
    /// fence. Escalating that exact fence through the existing sticky overflow
    /// path atomically drops its frames, preserves other grant incarnations
    /// and pending room resync epochs, and leaves one clear-retained sentinel.
    ///
    /// @ref LLP 0058#same-mode-provisioning — no unscoped predecessor live
    /// payload may transfer after successor activation.
    pub fn invalidate_durable_backlog_for_activation(
        &self,
        connection_id: &str,
        effect_fence: Option<&ConnectionEffectFence>,
    ) -> bool {
        let outbox = lock(&self.shared.outboxes).get(connection_id).cloned();
        let Some(outbox) = outbox else {
            return false;
        };
        let overflow = {
            let mut queue = lock(&outbox);
            if !queue
                .durable
                .iter()
                .any(|queued| queued.message.effect_fence() == effect_fence)
            {
                return false;
            }
            queue.overflow(None, effect_fence.cloned())
        };
        if overflow.overflowed {
            self.shared
                .counters
                .outbox_overflows
                .fetch_add(1, Ordering::Relaxed);
        }
        if overflow.resync_count > 0 {
            self.shared
                .counters
                .resync_required
                .fetch_add(overflow.resync_count as u64, Ordering::Relaxed);
        }
        self.shared.delivery.wake(connection_id);
        true
    }

    #[cfg(test)]
    pub(crate) fn enqueue_authorized_durable(
        &self,
        connection_id: impl Into<String>,
        payload: Vec<u8>,
        authorization: AuthorizationVersion,
    ) -> DurableEnqueueOutcome {
        self.enqueue_authorized_durable_with_network_egress(
            connection_id,
            payload,
            authorization,
            None,
        )
    }

    pub fn enqueue_authorized_durable_with_network_egress(
        &self,
        connection_id: impl Into<String>,
        payload: Vec<u8>,
        authorization: AuthorizationVersion,
        network_egress: Option<crate::network_profile::PreparedNetworkEgress>,
    ) -> DurableEnqueueOutcome {
        match network_egress {
            Some(network_egress) => self.enqueue_network_profiled_durable_message(
                connection_id,
                DurableMessage::authorized(payload, authorization)
                    .with_network_egress(network_egress),
            ),
            None => self.enqueue_durable_message(
                connection_id,
                DurableMessage::authorized(payload, authorization),
            ),
        }
    }

    pub fn enqueue_durable_bound(
        &self,
        connection_id: impl Into<String>,
        payload: Vec<u8>,
        effect_fence: ConnectionEffectFence,
    ) -> DurableEnqueueOutcome {
        self.enqueue_durable_message(connection_id, DurableMessage::bound(payload, effect_fence))
    }

    pub fn enqueue_durable_bound_with_network_egress(
        &self,
        connection_id: impl Into<String>,
        payload: Vec<u8>,
        effect_fence: ConnectionEffectFence,
        network_egress: Option<crate::network_profile::PreparedNetworkEgress>,
    ) -> DurableEnqueueOutcome {
        match network_egress {
            Some(network_egress) => self.enqueue_network_profiled_durable_message(
                connection_id,
                DurableMessage::bound(payload, effect_fence).with_network_egress(network_egress),
            ),
            None => self.enqueue_durable_bound(connection_id, payload, effect_fence),
        }
    }

    pub fn enqueue_authorized_durable_bound_with_network_egress(
        &self,
        connection_id: impl Into<String>,
        payload: Vec<u8>,
        authorization: AuthorizationVersion,
        effect_fence: ConnectionEffectFence,
        network_egress: Option<crate::network_profile::PreparedNetworkEgress>,
    ) -> DurableEnqueueOutcome {
        match network_egress {
            Some(network_egress) => self.enqueue_network_profiled_durable_message(
                connection_id,
                DurableMessage::authorized_bound(payload, authorization, effect_fence)
                    .with_network_egress(network_egress),
            ),
            None => self.enqueue_durable_message(
                connection_id,
                DurableMessage::authorized_bound(payload, authorization, effect_fence),
            ),
        }
    }

    fn enqueue_durable_message(
        &self,
        connection_id: impl Into<String>,
        message: DurableMessage,
    ) -> DurableEnqueueOutcome {
        let connection_id = connection_id.into();
        let outbox = self.ensure_outbox(&connection_id);
        let mut queue = lock(&outbox);
        let effect_fence = message.effect_fence().cloned();
        let overflow = queue.push_durable(message);
        let parked_behind_overflow = queue.is_overflowed(effect_fence.as_ref());
        drop(queue);
        if overflow.overflowed {
            self.shared
                .counters
                .outbox_overflows
                .fetch_add(1, Ordering::Relaxed);
        }
        if overflow.resync_count > 0 {
            self.shared
                .counters
                .resync_required
                .fetch_add(overflow.resync_count as u64, Ordering::Relaxed);
        }
        // Push-before-wake: the L8 lost-wakeup argument relies on the message
        // being drainable by the time the waker fires (see LLP 0026's L6/L7
        // interaction note — enqueues are no longer serialized by the global
        // mutex).
        self.shared.delivery.wake(&connection_id);
        DurableEnqueueOutcome {
            overflowed_now: overflow.overflowed,
            parked_behind_overflow,
        }
    }

    fn enqueue_network_profiled_durable_message(
        &self,
        connection_id: impl Into<String>,
        mut message: DurableMessage,
    ) -> DurableEnqueueOutcome {
        let connection_id = connection_id.into();
        let outbox = self.ensure_outbox(&connection_id);
        let mut queue = lock(&outbox);
        let effect_fence = message.effect_fence().cloned();
        let release_at = queue
            .prepare_durable_deadline(&mut message)
            .expect("profiled durable egress always carries a deadline");
        let overflow = queue.push_durable(message);
        let parked_behind_overflow = queue.is_overflowed(effect_fence.as_ref());
        drop(queue);
        if overflow.overflowed {
            self.shared
                .counters
                .outbox_overflows
                .fetch_add(1, Ordering::Relaxed);
        }
        if overflow.resync_count > 0 {
            self.shared
                .counters
                .resync_required
                .fetch_add(overflow.resync_count as u64, Ordering::Relaxed);
        }
        // A newly parked overflow marker is immediate work, while the exact
        // durable item retains its independent absolute-deadline wake.
        if parked_behind_overflow {
            self.shared.delivery.wake(&connection_id);
        }
        self.shared.delivery.wake_at(connection_id, release_at);
        DurableEnqueueOutcome {
            overflowed_now: overflow.overflowed,
            parked_behind_overflow,
        }
    }

    /// Remove retained subscriber and queued state for one exact grant while
    /// preserving any replacement that reused the readable connection id.
    pub fn purge_connection_effects(
        &self,
        connection_id: &str,
        effect_fence: &ConnectionEffectFence,
    ) {
        self.purge_connection_effects_inner(connection_id, effect_fence, true);
    }

    /// Exact terminal purge which releases predecessor leases and effects but
    /// deliberately does not wake the readable id. Typed terminal lifecycle
    /// installs the event while retiring the exact registry grant, then uses
    /// this silent cleanup so lease release cannot manufacture a later wake;
    /// low-level callers may also compose it before terminal installation.
    ///
    /// @ref LLP 0059#typed-terminal-auth-error — terminal data becomes visible
    /// under the notifier mutex before the single terminal wake.
    pub fn purge_connection_effects_silently(
        &self,
        connection_id: &str,
        effect_fence: &ConnectionEffectFence,
    ) {
        self.purge_connection_effects_inner(connection_id, effect_fence, false);
    }

    fn purge_connection_effects_inner(
        &self,
        connection_id: &str,
        effect_fence: &ConnectionEffectFence,
        wake_after_purge: bool,
    ) {
        let touched = lock(&self.shared.connection_rooms)
            .get(connection_id)
            .cloned()
            .unwrap_or_default();
        let mut maybe_empty = Vec::new();
        for room_id in touched {
            let room = lock(&self.shared.rooms).get(&room_id).cloned();
            let Some(room) = room else {
                continue;
            };
            let mut room = lock(&room);
            let remove = room
                .subscribers
                .get(connection_id)
                .is_some_and(|subscriber| subscriber.effect_fence.as_ref() == Some(effect_fence));
            let had_connection_room_edge = room.uses_connection(connection_id);
            if remove && let Some(subscriber) = room.subscribers.remove(connection_id) {
                room.retained_bytes = room
                    .retained_bytes
                    .saturating_sub(subscriber.retained_bytes);
                if had_connection_room_edge && !room.uses_connection(connection_id) {
                    room.retained_bytes =
                        room.retained_bytes
                            .saturating_sub(retained_connection_room_edge_bytes(
                                connection_id,
                                &room_id,
                            ));
                }
            }
            self.sync_connection_room_index_locked(&room, connection_id, &room_id);
            if remove && room.entries.is_empty() && room.subscribers.is_empty() {
                maybe_empty.push(room_id);
            }
        }
        // Terminal effect retirement can consume the connection's reverse-index
        // edge before the socket's eventual guarded disconnect. Prune only after
        // releasing every room lock so an exact purge cannot strand an empty
        // routing entry against the process-wide active-room limit.
        for room_id in maybe_empty {
            self.prune_room_if_empty(&room_id);
        }
        let wake_preserved_work = lock(&self.shared.outboxes)
            .get(connection_id)
            .cloned()
            .is_some_and(|outbox| lock(&outbox).purge_effect_fence(effect_fence));
        if wake_preserved_work && wake_after_purge {
            // Invalidating the predecessor's globally active lease can expose
            // authority-independent or successor work after the replacement
            // socket already performed an empty initial drain. Wake whichever
            // registration currently owns the readable id; exact retirement
            // independently filters the predecessor by opaque grant id.
            self.shared.delivery.wake(connection_id);
        }
    }

    /// Drain compatibility traffic that does not require an installed auth
    /// final-publication fence. In sessions, auth-scoped durable data and
    /// protected-room frames remain queued. A transport embedding must use
    /// [`Self::drain_outbox_for_send`] and retain each admitted wrapper until
    /// its final sink completes.
    pub fn drain_outbox(&self, connection_id: &str) -> Vec<RealtimeEnvelope> {
        Self::commit_compatibility_batch(self.lease_compatibility_outbox(connection_id))
    }

    fn lease_compatibility_outbox(&self, connection_id: &str) -> Vec<AdmittedRealtimeEnvelope> {
        // The authority obligation is level-triggered: losing or draining its
        // first signal cannot acknowledge it. Every heartbeat/poll recreates
        // the exact current-generation AuthChanged sentinel until the room's
        // fresh snapshot or trusted denial boundary completes.
        self.enqueue_room_authority_resyncs(Some(connection_id));
        self.lease_compatibility_outbox_after_resync(connection_id)
    }

    fn drain_outbox_with_authorization(
        &self,
        outbox: &SharedOutbox,
        admit_fenced: bool,
        expected_effect_fence: Option<&ConnectionEffectFence>,
        max_batch: usize,
        max_handoff_bytes: usize,
        wake: Arc<OutboxLeaseWake>,
    ) -> Vec<AdmittedRealtimeEnvelope> {
        // @ref LLP 0059#durable-and-ephemeral-outboxes — registry admission
        // precedes the sync-owned queue lock and the physical lease remains
        // owned until the final transport handoff.
        let mut admission = match self
            .shared
            .room_authority
            .begin_outbox_admission(admit_fenced)
        {
            Ok(admission) => admission,
            Err(_) => return Vec::new(),
        };
        let selected = lock(outbox).drain_with_authority_bounded_and_handoff_limit(
            expected_effect_fence,
            max_batch,
            max_handoff_bytes,
            |message| match admission.classify_durable(message) {
                OutboxFrameDisposition::Send => FrameAuthorityDisposition::Send,
                OutboxFrameDisposition::Retain => FrameAuthorityDisposition::Retain,
                OutboxFrameDisposition::DropStale => FrameAuthorityDisposition::DropStale,
            },
            |message| match admission.classify_ephemeral(message) {
                OutboxFrameDisposition::Send => FrameAuthorityDisposition::Send,
                OutboxFrameDisposition::Retain => FrameAuthorityDisposition::Retain,
                OutboxFrameDisposition::DropStale => FrameAuthorityDisposition::DropStale,
            },
        );
        selected
            .into_iter()
            .filter_map(|selected| {
                let SelectedOutboxLease {
                    lease_id,
                    envelope,
                    recovery_marker_priority,
                } = selected;
                let publication_authority = match admission.admit_selected(&envelope) {
                    Ok(permit) => permit,
                    Err(_) => {
                        drop(
                            OutboxDrainLease::new(
                                outbox.clone(),
                                lease_id,
                                wake.clone(),
                                recovery_marker_priority,
                                None,
                            )
                            .release_on_drop(),
                        );
                        return None;
                    }
                };
                let publication_validity = publication_authority
                    .as_ref()
                    .map(RealtimePublicationPermit::validity);
                let lease = OutboxDrainLease::new(
                    outbox.clone(),
                    lease_id,
                    wake.clone(),
                    recovery_marker_priority,
                    publication_validity,
                );
                Some(AdmittedRealtimeEnvelope {
                    envelope,
                    lease,
                    publication_authority,
                    recovery_marker: recovery_marker_priority.is_some(),
                })
            })
            .collect()
    }

    fn lease_compatibility_outbox_after_resync(
        &self,
        connection_id: &str,
    ) -> Vec<AdmittedRealtimeEnvelope> {
        let outbox = lock(&self.shared.outboxes).get(connection_id).cloned();
        outbox
            .map(|outbox| {
                let wake = Arc::new(OutboxLeaseWake {
                    delivery: self.shared.delivery.clone(),
                    connection_id: Arc::from(connection_id),
                });
                self.drain_outbox_with_authorization(
                    &outbox,
                    false,
                    None,
                    MAX_OUTBOX_DRAIN_BATCH,
                    MAX_OUTBOX_HANDOFF_BYTES,
                    wake,
                )
            })
            .unwrap_or_default()
    }

    fn commit_compatibility_batch(
        admitted: Vec<AdmittedRealtimeEnvelope>,
    ) -> Vec<RealtimeEnvelope> {
        admitted
            .into_iter()
            .filter_map(|admitted| {
                admitted
                    .try_into_parts()
                    .map(|(envelope, _legacy_dev_permit)| envelope)
            })
            .collect()
    }

    /// Destructively drain frames for a real transport handoff. Callers must
    /// keep each returned wrapper alive through the final sink.
    pub fn drain_outbox_for_send(&self, connection_id: &str) -> Vec<AdmittedRealtimeEnvelope> {
        self.drain_outbox_for_send_with_limit(connection_id, MAX_OUTBOX_DRAIN_BATCH)
    }

    fn drain_outbox_for_send_with_limit(
        &self,
        connection_id: &str,
        max_batch: usize,
    ) -> Vec<AdmittedRealtimeEnvelope> {
        self.enqueue_room_authority_resyncs(Some(connection_id));
        self.drain_outbox_for_send_with_limit_after_resync(connection_id, max_batch)
    }

    fn drain_outbox_for_send_with_limit_after_resync(
        &self,
        connection_id: &str,
        max_batch: usize,
    ) -> Vec<AdmittedRealtimeEnvelope> {
        let outbox = lock(&self.shared.outboxes).get(connection_id).cloned();
        outbox
            .map(|outbox| {
                let wake = Arc::new(OutboxLeaseWake {
                    delivery: self.shared.delivery.clone(),
                    connection_id: Arc::from(connection_id),
                });
                self.drain_outbox_with_authorization(
                    &outbox,
                    true,
                    None,
                    max_batch,
                    MAX_OUTBOX_HANDOFF_BYTES,
                    wake,
                )
            })
            .unwrap_or_default()
    }

    /// Destructively drain only effects produced by the exact connection
    /// grant. A readable connection id is intentionally insufficient: local
    /// profiles may reuse it and terminal cleanup may race with replacement.
    #[cfg(any(test, feature = "test-support"))]
    pub fn drain_outbox_for_send_bound(
        &self,
        connection_id: &str,
        effect_fence: &ConnectionEffectFence,
    ) -> Vec<AdmittedRealtimeEnvelope> {
        self.drain_outbox_for_send_bound_with_limit(
            connection_id,
            effect_fence,
            MAX_OUTBOX_DRAIN_BATCH,
        )
    }

    pub fn has_eligible_recovery_marker_bound(
        &self,
        connection_id: &str,
        effect_fence: &ConnectionEffectFence,
    ) -> bool {
        lock(&self.shared.outboxes)
            .get(connection_id)
            .cloned()
            .is_some_and(|outbox| lock(&outbox).has_eligible_recovery_marker(Some(effect_fence)))
    }

    /// Complete one HTTP response handoff at the exact connection-publication
    /// cut. An empty lease set still needs the outbox lock: direct projections
    /// must not pass a recovery marker installed after handler selection.
    /// Ordinary leased batches likewise lose to a cross-domain marker that did
    /// not itself invalidate their physical lease.
    pub fn acknowledge_outbox_handoff_bound(
        &self,
        connection_id: &str,
        effect_fence: &ConnectionEffectFence,
        leases: &[OutboxDrainLease],
    ) -> bool {
        let outbox = lock(&self.shared.outboxes).get(connection_id).cloned();
        let Some(outbox) = outbox else {
            return leases.is_empty();
        };
        if leases
            .iter()
            .any(|lease| !Arc::ptr_eq(&lease.inner.outbox, &outbox))
        {
            return false;
        }
        let ids = leases
            .iter()
            .map(|lease| lease.inner.lease_id)
            .collect::<Vec<_>>();
        let batch_marker_priority = leases
            .first()
            .and_then(|lease| lease.inner.recovery_marker_priority);
        if leases
            .iter()
            .any(|lease| lease.inner.recovery_marker_priority != batch_marker_priority)
        {
            return false;
        }
        let removed = {
            let mut queue = lock(&outbox);
            if (!leases.is_empty()
                && queue.active_lease_effect_fence.as_ref() != Some(effect_fence))
                || queue.recovery_marker_preempts(Some(effect_fence), batch_marker_priority)
            {
                false
            } else {
                queue.acknowledge_leases(&ids)
            }
        };
        if removed && !leases.is_empty() {
            leases[0]
                .inner
                .wake
                .delivery
                .wake(&leases[0].inner.wake.connection_id);
        }
        removed
    }

    /// Linearize a lease-less WS projection offer against recovery-marker
    /// installation. The notifier and connection registry are held by the
    /// caller; keeping this outbox lock through the bounded writer offer gives
    /// notifier -> outbox -> writer ordering without a check/offer gap.
    pub fn try_offer_projection_bound<T>(
        &self,
        connection_id: &str,
        effect_fence: &ConnectionEffectFence,
        value: T,
        offer: impl FnOnce(T) -> Result<(), T>,
    ) -> OutboxLeaseCommit<T> {
        // @ref LLP 0059#durable-and-ephemeral-outboxes — a lease-less direct
        // projection still linearizes against marker priority at writer offer.
        let outbox = self.ensure_outbox(connection_id);
        let queue = lock(&outbox);
        if queue.recovery_marker_preempts(Some(effect_fence), None) {
            return OutboxLeaseCommit::Superseded(value);
        }
        match offer(value) {
            Ok(()) => OutboxLeaseCommit::Committed,
            Err(value) => OutboxLeaseCommit::OfferFailed(value),
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn overflow_outbox_for_test(
        &self,
        connection_id: &str,
        effect_fence: Option<ConnectionEffectFence>,
    ) {
        let outbox = self.ensure_outbox(connection_id);
        lock(&outbox).overflow(None, effect_fence);
        self.shared.delivery.wake(connection_id);
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn durable_release_deadlines_for_test(
        &self,
        connection_id: &str,
    ) -> Vec<Option<std::time::Instant>> {
        let Some(outbox) = lock(&self.shared.outboxes).get(connection_id).cloned() else {
            return Vec::new();
        };
        lock(&outbox)
            .durable
            .iter()
            .map(|queued| queued.message.release_at())
            .collect()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn enqueue_ephemeral_for_test(
        &self,
        connection_id: &str,
        message: EphemeralMessage,
        effect_fence: Option<ConnectionEffectFence>,
    ) {
        let outbox = self.ensure_outbox(connection_id);
        lock(&outbox).push_ephemeral(Arc::new(message), MAX_OUTBOX_BACKLOG, effect_fence);
        self.shared.delivery.wake(connection_id);
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn has_connection_residue_for_test(&self, connection_id: &str) -> bool {
        lock(&self.shared.connection_rooms).contains_key(connection_id)
            || lock(&self.shared.outboxes).contains_key(connection_id)
            || lock(&self.shared.rate_buckets).contains_key(connection_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    fn drain_outbox_for_send_bound_with_limit(
        &self,
        connection_id: &str,
        effect_fence: &ConnectionEffectFence,
        max_batch: usize,
    ) -> Vec<AdmittedRealtimeEnvelope> {
        self.enqueue_room_authority_resyncs(Some(connection_id));
        self.drain_outbox_for_send_bound_with_limit_after_resync(
            connection_id,
            effect_fence,
            max_batch,
            MAX_OUTBOX_HANDOFF_BYTES,
        )
    }

    pub fn drain_outbox_for_send_bound_with_handoff_limit(
        &self,
        connection_id: &str,
        effect_fence: &ConnectionEffectFence,
        max_handoff_bytes: usize,
    ) -> Vec<AdmittedRealtimeEnvelope> {
        self.enqueue_room_authority_resyncs(Some(connection_id));
        self.drain_outbox_for_send_bound_with_limit_after_resync(
            connection_id,
            effect_fence,
            MAX_OUTBOX_DRAIN_BATCH,
            max_handoff_bytes,
        )
    }

    fn drain_outbox_for_send_bound_with_limit_after_resync(
        &self,
        connection_id: &str,
        effect_fence: &ConnectionEffectFence,
        max_batch: usize,
        max_handoff_bytes: usize,
    ) -> Vec<AdmittedRealtimeEnvelope> {
        let outbox = lock(&self.shared.outboxes).get(connection_id).cloned();
        outbox
            .map(|outbox| {
                let wake = Arc::new(OutboxLeaseWake {
                    delivery: self.shared.delivery.clone(),
                    connection_id: Arc::from(connection_id),
                });
                self.drain_outbox_with_authorization(
                    &outbox,
                    true,
                    Some(effect_fence),
                    max_batch,
                    max_handoff_bytes,
                    wake,
                )
            })
            .unwrap_or_default()
    }

    fn enqueue_room_authority_resyncs(&self, only_connection: Option<&str>) {
        let pending = self.shared.room_authority.pending_reauthorizations();
        let rooms = lock(&self.shared.rooms);
        let mut wakees = BTreeSet::new();
        for pending in pending {
            let room_id = pending.room;
            let resync = pending.obligation;
            let Some(room_arc) = rooms.get(&room_id) else {
                continue;
            };
            let room = lock(room_arc);
            for (connection_id, subscriber) in &room.subscribers {
                if only_connection.is_some_and(|only| only != connection_id) {
                    continue;
                }
                let result = lock(&subscriber.outbox).push_resync(
                    Arc::new(EphemeralMessage::ResyncRequired {
                        ephemeral_authority_instance: None,
                        room: room_id.clone(),
                        scope_epoch: room.scope_epoch,
                        room_authority_generation: resync.room_authority_generation,
                        reason: ResyncReason::AuthChanged,
                    }),
                    subscriber.effect_fence.clone(),
                );
                if result.resync_count > 0 {
                    self.shared
                        .counters
                        .resync_required
                        .fetch_add(result.resync_count as u64, Ordering::Relaxed);
                }
                if result.overflowed {
                    self.shared
                        .counters
                        .outbox_overflows
                        .fetch_add(1, Ordering::Relaxed);
                }
                wakees.insert(connection_id.clone());
            }
        }
        drop(rooms);
        self.shared
            .delivery
            .wake_many(&wakees.into_iter().collect::<Vec<_>>());
    }

    /// Atomically prove socket-generation ownership and destructively drain.
    /// Registration replacement takes the same notifier lock, so an old task
    /// can never remove messages that became owned by a new generation.
    pub fn drain_outbox_if_current(
        &self,
        connection_id: &str,
        generation: u64,
    ) -> Option<Vec<RealtimeEnvelope>> {
        // Resync synthesis takes the rooms map and a room lock. Keep it
        // outside the notifier generation cut: fan-out owns room → outbox →
        // notifier, and reversing that edge here would deadlock publication.
        // A superseded task may enqueue a shared obligation, but the exact
        // generation check below prevents it from selecting any frame.
        self.enqueue_room_authority_resyncs(Some(connection_id));
        let admitted = self
            .shared
            .delivery
            .act_if_current(connection_id, generation, || {
                self.lease_compatibility_outbox_after_resync(connection_id)
            })?;
        // Acknowledgement wakes the remaining queue. Do it after releasing the
        // notifier generation lock: final ownership already linearized at the
        // leased selection, and re-entering the notifier here would deadlock.
        Some(Self::commit_compatibility_batch(admitted))
    }

    pub fn drain_outbox_for_send_if_current(
        &self,
        connection_id: &str,
        generation: u64,
    ) -> Option<Vec<AdmittedRealtimeEnvelope>> {
        self.enqueue_room_authority_resyncs(Some(connection_id));
        self.shared
            .delivery
            .act_if_current(connection_id, generation, || {
                self.drain_outbox_for_send_with_limit_after_resync(connection_id, 1)
            })
    }

    pub fn drain_outbox_for_send_bound_if_current_with_handoff_limit(
        &self,
        connection_id: &str,
        generation: u64,
        effect_fence: &ConnectionEffectFence,
        max_handoff_bytes: usize,
    ) -> Option<Vec<AdmittedRealtimeEnvelope>> {
        self.enqueue_room_authority_resyncs(Some(connection_id));
        self.shared
            .delivery
            .act_if_current(connection_id, generation, || {
                self.drain_outbox_for_send_bound_with_limit_after_resync(
                    connection_id,
                    effect_fence,
                    1,
                    max_handoff_bytes,
                )
            })
    }

    pub fn diagnostics(&self) -> EphemeralDiagnostics {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "ephemeral diagnostics",
        );
        // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L4: the
        // gauge recompute happens here, on demand, not after every operation.
        let counters = &self.shared.counters;
        let mut diagnostics = EphemeralDiagnostics {
            rejected_publishes: counters.rejected_publishes.load(Ordering::Relaxed),
            rate_limited_publishes: counters.rate_limited_publishes.load(Ordering::Relaxed),
            oversized_publishes: counters.oversized_publishes.load(Ordering::Relaxed),
            unauthorized_requests: counters.unauthorized_requests.load(Ordering::Relaxed),
            metadata_rejections: counters.metadata_rejections.load(Ordering::Relaxed),
            expired_entries: counters.expired_entries.load(Ordering::Relaxed),
            disconnected_entries: counters.disconnected_entries.load(Ordering::Relaxed),
            coalesced_updates: counters.coalesced_updates.load(Ordering::Relaxed),
            resync_required: counters.resync_required.load(Ordering::Relaxed),
            outbox_overflows: counters.outbox_overflows.load(Ordering::Relaxed),
            limit_rejections: counters.limit_rejections.load(Ordering::Relaxed),
            generation_exhaustions: counters.generation_exhaustions.load(Ordering::Relaxed),
            last_generation_exhaustion: (counters.generation_exhaustions.load(Ordering::Relaxed)
                > 0)
            .then(generation_exhausted_error),
            ..EphemeralDiagnostics::default()
        };

        let rooms: Vec<(RoomId, SharedRoom)> = lock(&self.shared.rooms)
            .iter()
            .map(|(room_id, room)| (room_id.clone(), room.clone()))
            .collect();
        for (room_id, room_arc) in rooms {
            let room = lock(&room_arc);
            if room.retired {
                continue;
            }
            diagnostics.room_count += 1;
            diagnostics.entry_count += room.entries.len();
            diagnostics.subscriber_count += room.subscribers.len();
            diagnostics.value_bytes += room.value_bytes;
            diagnostics.retained_bytes += room.retained_bytes;
            diagnostics.active_rooms.push(EphemeralRoomDiagnostics {
                collection: room_id.collection.clone(),
                routing_key: room_id.routing_key.clone(),
                scope: room_id.scope.clone(),
                scope_epoch: room.scope_epoch,
                entries: room.entries.len(),
                subscribers: room.subscribers.len(),
                value_bytes: room.value_bytes,
                retained_bytes: room.retained_bytes,
            });
        }

        let outboxes: Vec<SharedOutbox> = lock(&self.shared.outboxes).values().cloned().collect();
        for outbox in outboxes {
            let outbox = lock(&outbox);
            diagnostics.pending_ephemeral_keys += outbox.ephemeral.len();
            let logical_overflow_signals = usize::from(outbox.overflowed)
                .saturating_add(outbox.overflowed_effect_fences.len())
                .saturating_add(usize::from(outbox.all_authorities_poisoned));
            diagnostics.pending_durable_messages = diagnostics
                .pending_durable_messages
                .saturating_add(outbox.durable.len())
                .saturating_add(logical_overflow_signals);
            diagnostics.pending_resync_messages += outbox.resync.len();
            diagnostics.outbox_retained_bytes = diagnostics
                .outbox_retained_bytes
                .saturating_add(outbox.retained_bytes());
        }
        diagnostics.retained_bytes = diagnostics
            .retained_bytes
            .saturating_add(diagnostics.outbox_retained_bytes);
        diagnostics
    }

    fn collection(&self, name: &str) -> Result<EphemeralCollection, EphemeralError> {
        self.collection_if_loaded(name).ok_or_else(|| {
            EphemeralError::new(
                EphemeralErrorCode::UnknownCollection,
                format!("unknown ephemeral collection {name}"),
            )
        })
    }

    fn collection_if_loaded(&self, name: &str) -> Option<EphemeralCollection> {
        self.shared
            .collections
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .get(name)
            .cloned()
    }

    /// @ref LLP 0013#stored-entry-shape — room incarnations never cross or reuse the portable scope-epoch domain.
    fn allocate_scope_epoch(&self) -> Result<u64, EphemeralError> {
        self.shared
            .next_scope_epoch
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |epoch| {
                (epoch <= crate::manifest::PORTABLE_STORAGE_VERSION_MAX)
                    .then(|| epoch.checked_add(1))
                    .flatten()
            })
            .map_err(|_| generation_exhausted_error())
    }

    fn record_generation_exhaustion(&self) {
        self.shared
            .counters
            .generation_exhaustions
            .fetch_add(1, Ordering::Relaxed);
    }

    /// Complete the fail-closed half of entry-version exhaustion. The caller
    /// first marks the exact `RoomState` retired while discovering that its
    /// next mutation cannot be represented. This method then takes the
    /// canonical authority-registry → routing-map → room → outbox order,
    /// removes that exact retired incarnation, purges its queued data, and
    /// installs only an epoch-change resync boundary. Keeping the routing map
    /// locked through enqueue prevents an unprotected replacement room from
    /// overtaking its predecessor's terminal marker.
    ///
    /// @ref LLP 0013#stored-entry-shape — entry exhaustion is whole-incarnation sequencing loss, never partial cleanup.
    fn retire_generation_exhausted_room(&self, room_id: &RoomId) {
        self.record_generation_exhaustion();

        let authority = match self
            .shared
            .room_authority
            .begin_room_retirement_admission(room_id)
        {
            Ok(authority) => authority,
            Err(_) => return,
        };
        let mut rooms = lock(&self.shared.rooms);
        let room_arc = rooms.get(room_id).cloned();
        if room_arc.as_ref().is_some_and(|room| !lock(room).retired) {
            // A same-id replacement already won after another retirement.
            // Never let a delayed duplicate retire the fresh incarnation.
            return;
        }

        let mut retired = false;
        let mut scope_epoch = 0;
        let mut subscribers = Vec::new();
        if let Some(room_arc) = room_arc {
            let mut room = lock(&room_arc);
            if room.retired {
                retired = true;
                rooms.remove(room_id);
                if let Some(deadline) = room.indexed_deadline.take() {
                    lock(&self.shared.expiry_index).remove(&(deadline, room_id.clone()));
                    room.retained_bytes = room
                        .retained_bytes
                        .saturating_sub(retained_expiry_index_entry_bytes(room_id));
                }
                scope_epoch = room.scope_epoch;
                subscribers = room
                    .subscribers
                    .iter()
                    .map(|(connection_id, subscriber)| {
                        (
                            connection_id.clone(),
                            subscriber.outbox.clone(),
                            subscriber.effect_fence.clone(),
                        )
                    })
                    .collect();
            }
        }

        let mut wakees = Vec::with_capacity(subscribers.len());
        for (connection_id, outbox, effect_fence) in subscribers {
            let mut outbox = lock(&outbox);
            outbox.purge_room_epoch(room_id, scope_epoch, effect_fence.as_ref());
            self.record_queue_push(outbox.push_resync(
                Arc::new(EphemeralMessage::ResyncRequired {
                    ephemeral_authority_instance: None,
                    room: room_id.clone(),
                    scope_epoch,
                    room_authority_generation: 0,
                    reason: ResyncReason::EpochChanged,
                }),
                effect_fence,
            ));
            wakees.push(connection_id);
        }

        authority.retire_generation_exhausted();
        drop(rooms);

        if retired {
            self.reconcile_connection_room_index(room_id);
        }
        self.shared.delivery.wake_many(&wakees);
    }

    /// Run `f` under the (created-if-needed) room's lock. Retries when the
    /// looked-up room was retired between the map lookup and the room lock —
    /// the pruner or a wipe won the race, and the retry re-consults the map,
    /// which is exactly what the retire protocol requires. Creation enforces
    /// the active-room limit and allocates the incarnation's scope epoch.
    fn with_room_create<T>(
        &self,
        room_id: &RoomId,
        protected_generation: Option<u64>,
        f: impl FnOnce(&mut RoomState) -> T,
    ) -> Result<T, EphemeralError> {
        let mut f = Some(f);
        loop {
            let room_arc = {
                // Protected creation linearizes registry-before-routing, the
                // same order as terminal retirement. A permit admitted before
                // exhaustion may finish against the predecessor room, but it
                // cannot recreate the room after the control is retired.
                // @ref LLP 0013#stored-entry-shape — stale protected permits cannot recreate a terminally retired room.
                let _authority = if let Some(generation) = protected_generation {
                    Some(
                        self.shared
                            .room_authority
                            .begin_room_creation_admission(room_id, generation)?,
                    )
                } else {
                    None
                };
                let mut rooms = lock(&self.shared.rooms);
                if let Some(existing) = rooms.get(room_id) {
                    existing.clone()
                } else {
                    if rooms.len() >= self.shared.limits.max_active_rooms {
                        self.shared
                            .counters
                            .limit_rejections
                            .fetch_add(1, Ordering::Relaxed);
                        return Err(EphemeralError::new(
                            EphemeralErrorCode::RoomLimitExceeded,
                            format!(
                                "active room limit ({}) reached",
                                self.shared.limits.max_active_rooms
                            ),
                        ));
                    }
                    let retained_bytes = retained_room_identity_bytes(room_id);
                    if retained_bytes > self.shared.limits.max_room_value_bytes {
                        self.shared
                            .counters
                            .limit_rejections
                            .fetch_add(1, Ordering::Relaxed);
                        return Err(EphemeralError::new(
                            EphemeralErrorCode::RoomLimitExceeded,
                            format!(
                                "room identity requires {retained_bytes} retained bytes; room limit is {}",
                                self.shared.limits.max_room_value_bytes
                            ),
                        ));
                    }
                    let epoch = self.allocate_scope_epoch()?;
                    let created = Arc::new(StdMutex::new(RoomState::new(epoch, retained_bytes)));
                    rooms.insert(room_id.clone(), created.clone());
                    created
                }
            };
            let mut room = lock(&room_arc);
            if room.retired {
                if protected_generation.is_some() {
                    return Err(authority_pending_error());
                }
                continue;
            }
            let f = f
                .take()
                .expect("retire retry runs the closure at most once");
            return Ok(f(&mut room));
        }
    }

    /// Like [`Self::with_room_create`] but never creates: `None` when the room
    /// does not exist (or was pruned before we could lock it).
    fn with_existing_room<T>(
        &self,
        room_id: &RoomId,
        f: impl FnOnce(&mut RoomState) -> T,
    ) -> Option<T> {
        let mut f = Some(f);
        loop {
            let room_arc = lock(&self.shared.rooms).get(room_id).cloned()?;
            let mut room = lock(&room_arc);
            if room.retired {
                continue;
            }
            let f = f
                .take()
                .expect("retire retry runs the closure at most once");
            return Some(f(&mut room));
        }
    }

    /// Retire and remove the room when it holds no entries and no
    /// subscribers, so dead rooms neither grow the routing map forever nor
    /// exhaust the active-room limit. Takes the routing map first and only
    /// `try_lock`s the room: a busy room is simply not prunable right now,
    /// and routing is never blocked behind a held room lock.
    fn prune_room_if_empty(&self, room_id: &RoomId) {
        let mut rooms = lock(&self.shared.rooms);
        let Some(room_arc) = rooms.get(room_id).cloned() else {
            return;
        };
        let mut room = match room_arc.try_lock() {
            Ok(room) => room,
            Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => return,
        };
        if room.retired || !room.entries.is_empty() || !room.subscribers.is_empty() {
            return;
        }
        room.retired = true;
        rooms.remove(room_id);
        if let Some(deadline) = room.indexed_deadline.take() {
            lock(&self.shared.expiry_index).remove(&(deadline, room_id.clone()));
            room.retained_bytes = room
                .retained_bytes
                .saturating_sub(retained_expiry_index_entry_bytes(room_id));
        }
        drop(room);
        drop(rooms);
        // Registry retirement follows routing retirement; taking the room
        // authority while the rooms map is held would invert reauthorization's
        // registry→rooms order. A pending commit keeps an exact retired
        // tombstone until its ticket settles.
        self.shared.room_authority.retire_room(room_id);
    }

    /// Retire every room, delivering a `ResyncRequired` boundary to each
    /// registered subscriber: runtime reset (`Restarted`) and destructive
    /// definition replacement (`EpochChanged`) discard the authority's state
    /// under live connections, and going silent would leave subscribers
    /// believing a dead stream is current (the scope-epoch finding). Each
    /// outbox's *ephemeral* lanes are cleared before the boundaries are
    /// pushed — the ratified ENG-22478 shape: everything queued in those
    /// lanes belongs to the retired epoch world, and the resync boundary is
    /// what turns the epoch bump into an overlay resubscription instead of
    /// silent `ignored_stale` drops. The durable lanes survive (ENG-23346):
    /// queued live-query payloads answer durable subscriptions that outlive
    /// an ephemeral boundary, and no durable resync would ever signal their
    /// loss. A boundary that retires the durable world too must clear the
    /// outbox map itself and signal durably, as `reset_runtime_state` does.
    ///
    /// Only the retired rooms' own index entries are removed (each via its
    /// `indexed_deadline` mirror, exactly as `prune_room_if_empty` does) —
    /// **never** a wholesale `expiry_index.clear()`. A concurrent
    /// async-worker publish can create a room *after* the `room_ids` snapshot
    /// but *before* this clear; that room survives the wipe, and a wholesale
    /// clear would destroy its `(deadline, room)` index entry while its
    /// mirror still claimed it was indexed, permanently detaching it from
    /// `cleanup_expired` (MEDIUM finding 1). Surviving rooms keep their index
    /// entries by construction.
    ///
    /// @ref LLP 0026#finding-scope-epoch-machinery-was-dead-code-recorded-2026-07-02 — the Restarted/EpochChanged wiring.
    fn wipe_rooms_signaling_resync(&self, reason: ResyncReason) {
        let room_ids: Vec<RoomId> = lock(&self.shared.rooms).keys().cloned().collect();
        let retired_room_ids = room_ids.iter().cloned().collect::<BTreeSet<_>>();
        let mut resyncs: Vec<(
            ConnectionId,
            EphemeralMessage,
            Option<ConnectionEffectFence>,
        )> = Vec::new();
        for room_id in room_ids {
            // Retire under map+room held together, so an operation retrying
            // through the map sees either the live room or its absence —
            // never a detached-but-unretired room it could mutate into the
            // void.
            let mut rooms = lock(&self.shared.rooms);
            let Some(room_arc) = rooms.get(&room_id).cloned() else {
                continue;
            };
            let mut room = lock(&room_arc);
            room.retired = true;
            rooms.remove(&room_id);
            drop(rooms);
            // Remove exactly this retired room's index entry (mirror-guided),
            // leaving any concurrently-created surviving room's entry intact.
            if let Some(deadline) = room.indexed_deadline.take() {
                lock(&self.shared.expiry_index).remove(&(deadline, room_id.clone()));
                room.retained_bytes = room
                    .retained_bytes
                    .saturating_sub(retained_expiry_index_entry_bytes(&room_id));
            }
            let scope_epoch = room.scope_epoch;
            let subscribers = room
                .subscribers
                .iter()
                .map(|(connection_id, subscriber)| {
                    (connection_id.clone(), subscriber.effect_fence.clone())
                })
                .collect::<Vec<_>>();
            drop(room);
            // Prepare/final-send uses authority-registry before room state.
            // Read the generation only after releasing the room lock to keep
            // that global order during a destructive epoch wipe too.
            let room_authority_generation = self.shared.room_authority.room_generation(&room_id);
            for (connection_id, effect_fence) in subscribers {
                resyncs.push((
                    connection_id,
                    EphemeralMessage::ResyncRequired {
                        ephemeral_authority_instance: None,
                        room_authority_generation,
                        room: room_id.clone(),
                        scope_epoch,
                        reason: reason.clone(),
                    },
                    effect_fence,
                ));
            }
        }
        // Reconcile each retired identity against the routing map while that
        // map is locked. A same-id replacement that already landed keeps its
        // live edges; a creator that has not landed yet blocks on the map and
        // reasserts its edge afterward. An unconditional retain here used to
        // delete a live replacement's edge (ENG-24355 review).
        for room_id in retired_room_ids {
            self.reconcile_connection_room_index(&room_id);
        }
        let outboxes: Vec<SharedOutbox> = lock(&self.shared.outboxes).values().cloned().collect();
        for outbox in outboxes {
            lock(&outbox).clear_ephemeral_lanes();
        }

        for (connection_id, message, effect_fence) in resyncs {
            let outbox = self.ensure_outbox(&connection_id);
            let result = lock(&outbox).push_resync(Arc::new(message), effect_fence);
            if result.overflowed {
                self.shared
                    .counters
                    .outbox_overflows
                    .fetch_add(1, Ordering::Relaxed);
            }
            if result.resync_count > 0 {
                self.shared
                    .counters
                    .resync_required
                    .fetch_add(result.resync_count as u64, Ordering::Relaxed);
            } else {
                self.shared
                    .counters
                    .resync_required
                    .fetch_add(1, Ordering::Relaxed);
            }
            self.shared.delivery.wake(&connection_id);
        }
    }

    fn validate_request_metadata(
        &self,
        metadata: RequestMetadata<'_>,
    ) -> Result<(), EphemeralError> {
        let result = validate_request_metadata_bounds(&metadata);
        if matches!(
            &result,
            Err(error) if error.code == EphemeralErrorCode::MetadataTooLarge
        ) {
            self.shared
                .counters
                .metadata_rejections
                .fetch_add(1, Ordering::Relaxed);
        }
        result
    }

    fn validate_ttl(
        &self,
        collection: &EphemeralCollection,
        ttl_ms: Millis,
    ) -> Result<(), EphemeralError> {
        if ttl_ms == 0 || ttl_ms > collection.max_ttl_ms {
            self.shared
                .counters
                .rejected_publishes
                .fetch_add(1, Ordering::Relaxed);
            return Err(EphemeralError::new(
                EphemeralErrorCode::InvalidTtl,
                format!("ttl {ttl_ms}ms is outside the collection budget"),
            ));
        }
        Ok(())
    }

    fn validate_value_size(
        &self,
        collection: &EphemeralCollection,
        value_bytes: usize,
    ) -> Result<(), EphemeralError> {
        let max = collection
            .max_value_bytes
            .min(collection.hard_max_value_bytes);
        if value_bytes > max {
            self.shared
                .counters
                .rejected_publishes
                .fetch_add(1, Ordering::Relaxed);
            self.shared
                .counters
                .oversized_publishes
                .fetch_add(1, Ordering::Relaxed);
            return Err(EphemeralError::new(
                EphemeralErrorCode::ValueTooLarge,
                format!("value has {value_bytes} bytes; max is {max}"),
            ));
        }
        Ok(())
    }

    fn ensure_authorized(
        &self,
        policy: &AccessPolicy,
        scope: &Scope,
        auth: &AuthContext,
    ) -> Result<(), EphemeralError> {
        if policy.allows(scope, auth) {
            return Ok(());
        }
        self.shared
            .counters
            .unauthorized_requests
            .fetch_add(1, Ordering::Relaxed);
        Err(EphemeralError::new(
            EphemeralErrorCode::Unauthorized,
            "ephemeral access denied",
        ))
    }

    fn ensure_publish_rate(
        &self,
        collection: &EphemeralCollection,
        connection_id: &str,
        now_ms: Millis,
    ) -> Result<(), EphemeralError> {
        // @ref LLP 0013#backpressure-and-coalescing -- publisher admission is distinct from subscriber pressure.
        let allowed = {
            let mut buckets = lock(&self.shared.rate_buckets);
            let bucket = buckets
                .entry(connection_id.to_owned())
                .or_default()
                .entry(collection.name.clone())
                .or_insert_with(|| RateBucket::new(collection, now_ms));
            bucket.allow(collection, now_ms)
        };
        if allowed {
            return Ok(());
        }

        self.shared
            .counters
            .rejected_publishes
            .fetch_add(1, Ordering::Relaxed);
        self.shared
            .counters
            .rate_limited_publishes
            .fetch_add(1, Ordering::Relaxed);
        Err(EphemeralError::new(
            EphemeralErrorCode::RateLimited,
            "ephemeral publish rate limit exceeded",
        ))
    }

    /// Remove this room's expired entries and fan the removals out. Called
    /// with the room lock held; per-operation sweeps keep snapshots free of
    /// expired entries regardless of the cleanup cadence.
    fn sweep_room_locked(
        &self,
        room: &mut RoomState,
        room_id: &RoomId,
        collection: Option<&EphemeralCollection>,
        now_ms: Millis,
        room_authority_generation: u64,
    ) -> Result<(), EphemeralError> {
        match next_expiry_deadline(room) {
            Some(deadline) if deadline <= now_ms => {}
            _ => return Ok(()),
        }

        let expired_keys = room
            .entries
            .iter()
            .filter_map(|(key, record)| (record.expires_at_ms <= now_ms).then_some(key.clone()))
            .collect::<Vec<_>>();
        if let Err(error) = room.ensure_version_capacity(expired_keys.len()) {
            room.retired = true;
            return Err(error);
        }
        for key in expired_keys {
            let affected_connections = room
                .entries
                .get(&key)
                .and_then(|record| room.owner_connections.get(&record.owner))
                .cloned()
                .unwrap_or_default();
            if let Some(message) = remove_entry_locked(
                room,
                room_id,
                &key,
                RemoveReason::Expired,
                room_authority_generation,
            )
            .expect("expiry batch capacity is preflighted before room mutation")
            {
                self.shared
                    .counters
                    .expired_entries
                    .fetch_add(1, Ordering::Relaxed);
                if let Some(collection) = collection {
                    self.fan_out_locked(room, room_id, collection, message);
                }
                for connection_id in affected_connections {
                    self.sync_connection_room_index_locked(room, &connection_id, room_id);
                }
            }
        }
        Ok(())
    }

    /// Enqueue `message` to every currently authorized subscriber. Called
    /// with the room lock held, so per-room outbox arrival order equals
    /// version order — the property that keeps supersede-by-key coalescing
    /// safe (a pending upsert is only ever replaced by a newer one). Outbox
    /// locks nest inside the room lock, never the reverse.
    fn fan_out_locked(
        &self,
        room: &RoomState,
        _room_id: &RoomId,
        collection: &EphemeralCollection,
        message: EphemeralMessage,
    ) {
        let recipients = room
            .subscribers
            .iter()
            .map(|(connection_id, subscriber)| {
                (
                    connection_id.clone(),
                    subscriber.outbox.clone(),
                    subscriber.effect_fence.clone(),
                )
            })
            .collect::<Vec<_>>();
        if recipients.is_empty() {
            return;
        }

        let message = Arc::new(message);
        let mut wakees = Vec::with_capacity(recipients.len());
        #[cfg(any(test, feature = "test-support"))]
        self.pause_after_frame_construction_before_first_enqueue_for_test(message.as_ref());
        for (connection_id, outbox, effect_fence) in recipients {
            let result = lock(&outbox).push_ephemeral(
                message.clone(),
                collection.max_pending_ephemeral_keys,
                effect_fence,
            );
            if result.coalesced {
                self.shared
                    .counters
                    .coalesced_updates
                    .fetch_add(1, Ordering::Relaxed);
            }
            if result.resync_count > 0 {
                self.shared
                    .counters
                    .resync_required
                    .fetch_add(result.resync_count as u64, Ordering::Relaxed);
            }
            if result.overflowed {
                self.shared
                    .counters
                    .outbox_overflows
                    .fetch_add(1, Ordering::Relaxed);
            }
            wakees.push(connection_id);
        }
        // L8: wake subscriber delivery tasks after all messages are drainable
        // (push-before-wake), with one notifier-map lock for the whole fan-out.
        self.shared.delivery.wake_many(&wakees);
    }

    #[cfg(any(test, feature = "test-support"))]
    fn pause_after_frame_construction_before_first_enqueue_for_test(
        &self,
        message: &EphemeralMessage,
    ) {
        let hook = lock(&self.shared.frame_before_first_enqueue_hook).take();
        if let Some(hook) = hook {
            hook.reached
                .send(message.clone())
                .expect("frame-before-enqueue test observer remains alive");
            hook.release
                .recv()
                .expect("frame-before-enqueue test releases fan-out");
        }
    }

    /// Record that `connection_id` has touched `room_id` (subscribed or
    /// published), so `disconnect` can visit exactly the rooms that may hold
    /// its registrations or owned entries (ENG-23348). Callers index before
    /// the room operation becomes visible, then rejected creates and every
    /// unsubscribe/delete/expiry/prune path reconcile the edge with current
    /// subscriber and owner membership. `disconnect` consumes the remaining
    /// current-room set, so lifetime room churn cannot grow its work without
    /// bound (ENG-24355). Leaf lock — taken with no other lock held.
    ///
    /// @ref LLP 0026#room-authority — the reverse index tracks current room authority membership, not historical touches.
    fn index_connection_room(&self, connection_id: &str, room_id: &RoomId) {
        lock(&self.shared.connection_rooms)
            .entry(connection_id.to_owned())
            .or_default()
            .insert(room_id.clone());
    }

    /// Reconcile one edge while the caller holds the corresponding room lock.
    /// `disconnect` never holds the reverse-index lock while acquiring a room,
    /// so room → index has no inverse lock order.
    fn sync_connection_room_index_locked(
        &self,
        room: &RoomState,
        connection_id: &str,
        room_id: &RoomId,
    ) {
        let used = room.uses_connection(connection_id);
        let mut index = lock(&self.shared.connection_rooms);
        if used {
            index
                .entry(connection_id.to_owned())
                .or_default()
                .insert(room_id.clone());
        } else if let Some(rooms) = index.get_mut(connection_id) {
            rooms.remove(room_id);
            if rooms.is_empty() {
                index.remove(connection_id);
            }
        }
    }

    fn reconcile_connection_room_index(&self, room_id: &RoomId) {
        let rooms = lock(&self.shared.rooms);
        let current = rooms.get(room_id).cloned();
        let current = current.as_ref().map(|room| lock(room));
        let mut used = BTreeSet::new();
        if let Some(room) = current.as_deref()
            && !room.retired
        {
            used.extend(room.subscribers.keys().cloned());
            for connections in room.owner_connections.values() {
                used.extend(connections.iter().cloned());
            }
        }

        let mut index = lock(&self.shared.connection_rooms);
        index.retain(|connection_id, indexed| {
            if used.contains(connection_id) {
                indexed.insert(room_id.clone());
            } else {
                indexed.remove(room_id);
            }
            !indexed.is_empty()
        });
        for connection_id in used {
            index
                .entry(connection_id)
                .or_default()
                .insert(room_id.clone());
        }
    }

    /// Remove a reverse-index edge only when the room no longer contains a
    /// subscriber registration or an owned entry for this connection. Failed
    /// creates and unsubscribe/delete/expiry paths call this so lifetime room
    /// churn cannot make disconnect work grow without bound (ENG-24355).
    fn unindex_connection_room_if_unused(&self, connection_id: &str, room_id: &RoomId) {
        self.unindex_connection_room_if_unused_with_observation(connection_id, room_id, || {});
    }

    /// Keep the routing-map and current room locks through reverse-index
    /// reconciliation. Otherwise cleanup can observe an unused room, release
    /// it, and then delete the edge after a concurrent subscribe/publish has
    /// installed current authority and reasserted that same edge (ENG-24355
    /// review). The callback is an inert production hook used by the
    /// deterministic race regression below.
    fn unindex_connection_room_if_unused_with_observation(
        &self,
        connection_id: &str,
        room_id: &RoomId,
        observed: impl FnOnce(),
    ) {
        let current_rooms = lock(&self.shared.rooms);
        if let Some(room) = current_rooms.get(room_id) {
            let room = lock(room);
            observed();
            self.sync_connection_room_index_locked(&room, connection_id, room_id);
            return;
        }

        // Holding the routing map still makes absence linearizable with room
        // creation. A creator may already have provisionally indexed itself,
        // but it cannot make room state visible until this removal completes
        // and will reassert the edge after its successful write.
        observed();
        let mut index = lock(&self.shared.connection_rooms);
        if let Some(indexed_rooms) = index.get_mut(connection_id) {
            indexed_rooms.remove(room_id);
            if indexed_rooms.is_empty() {
                index.remove(connection_id);
            }
        }
    }

    fn ensure_outbox(&self, connection_id: &str) -> SharedOutbox {
        lock(&self.shared.outboxes)
            .entry(connection_id.to_owned())
            .or_insert_with(|| Arc::new(StdMutex::new(OutboundQueue::new())))
            .clone()
    }

    /// Ensure the expiry index holds a bound ≤ `deadline` for this room.
    /// Called with the room lock held (room → index order). A steady-TTL hot
    /// room never improves its bound after the first entry, so the hot
    /// publish path skips the index entirely.
    fn index_room_deadline(&self, room: &mut RoomState, room_id: &RoomId, deadline: Millis) {
        if room
            .indexed_deadline
            .is_some_and(|current| current <= deadline)
        {
            return;
        }
        let mut index = lock(&self.shared.expiry_index);
        let newly_indexed = room.indexed_deadline.is_none();
        if let Some(previous) = room.indexed_deadline.take() {
            index.remove(&(previous, room_id.clone()));
        }
        index.insert((deadline, room_id.clone()), ());
        room.indexed_deadline = Some(deadline);
        if newly_indexed {
            room.retained_bytes = room
                .retained_bytes
                .saturating_add(retained_expiry_index_entry_bytes(room_id));
        }
    }
}

fn collection_requires_room_permission(collection: &EphemeralCollection) -> bool {
    matches!(
        collection.publish,
        AccessPolicy::RequireRoomPermission { .. }
    ) || matches!(
        collection.subscribe,
        AccessPolicy::RequireRoomPermission { .. }
    )
}

fn ephemeral_cleanup_room_digest(room_id: &RoomId) -> String {
    let digest = Sha256::digest(
        serde_json::to_vec(room_id).expect("RoomId always serializes for cleanup identity"),
    );
    let mut encoded = String::with_capacity(7 + digest.len() * 2);
    encoded.push_str("sha256:");
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

fn remove_entry_locked(
    room: &mut RoomState,
    room_id: &RoomId,
    key: &EntryKey,
    reason: RemoveReason,
    room_authority_generation: u64,
) -> Result<Option<EphemeralMessage>, EphemeralError> {
    if !room.entries.contains_key(key) {
        return Ok(None);
    }
    room.ensure_version_capacity(1)?;
    let record = room
        .entries
        .remove(key)
        .expect("entry existence was checked under the room lock");
    room.value_bytes = room.value_bytes.saturating_sub(record.value.len());
    room.retained_bytes = room.retained_bytes.saturating_sub(record.retained_bytes);
    forget_expiry_locked(room, record.expires_at_ms);
    // Custom-key collections can hold several entries owned by the same
    // connection. Keep the owner membership until its final key leaves the
    // room, or disconnect can lose the reverse-index edge and strand the
    // remaining entries until TTL expiry.
    if !room
        .entries
        .values()
        .any(|remaining| remaining.owner == record.owner)
        && let Some(connections) = room.owner_connections.remove(&record.owner)
    {
        room.owner_connection_count = room
            .owner_connection_count
            .saturating_sub(connections.len());
        let connection_bytes = connections.iter().fold(0_usize, |total, connection_id| {
            total
                .saturating_add(retained_string_bytes(connection_id))
                .saturating_add(MAP_ENTRY_OVERHEAD)
        });
        room.retained_bytes = room
            .retained_bytes
            .saturating_sub(retained_owner_bytes(&record.owner) + MAP_ENTRY_OVERHEAD)
            .saturating_sub(connection_bytes);
        for connection_id in &connections {
            if !room.uses_connection(connection_id) {
                room.retained_bytes = room
                    .retained_bytes
                    .saturating_sub(retained_connection_room_edge_bytes(connection_id, room_id));
            }
        }
    }
    let entry_version = room.allocate_version();
    Ok(Some(EphemeralMessage::Remove {
        ephemeral_authority_instance: None,
        room: room_id.clone(),
        key: key.clone(),
        scope_epoch: room.scope_epoch,
        room_authority_generation,
        entry_version,
        reason,
    }))
}

fn remember_expiry_locked(room: &mut RoomState, expires_at_ms: Millis) {
    *room.expiry_counts.entry(expires_at_ms).or_insert(0) += 1;
}

fn forget_expiry_locked(room: &mut RoomState, expires_at_ms: Millis) {
    let remove = match room.expiry_counts.get_mut(&expires_at_ms) {
        Some(count) => {
            *count = count.saturating_sub(1);
            *count == 0
        }
        None => false,
    };
    if remove {
        room.expiry_counts.remove(&expires_at_ms);
    }
}

fn next_expiry_deadline(room: &RoomState) -> Option<Millis> {
    room.expiry_counts.keys().next().copied()
}

fn valid_manifest_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

pub use snapback_kernel::ephemeral::{
    validate_collection_definitions, validate_collection_permission_backing,
};

fn metadata_too_large(message: impl Into<String>) -> EphemeralError {
    EphemeralError::new(EphemeralErrorCode::MetadataTooLarge, message)
}

fn validate_bounded_optional(
    label: &str,
    value: Option<&str>,
    max_bytes: usize,
) -> Result<(), EphemeralError> {
    if let Some(value) = value
        && value.len() > max_bytes
    {
        return Err(metadata_too_large(format!(
            "ephemeral {label} has {} bytes; max is {max_bytes}",
            value.len()
        )));
    }
    Ok(())
}

fn validate_scope_bounds(scope: &Scope) -> Result<(), EphemeralError> {
    if scope.0.len() > MAX_EPHEMERAL_SCOPE_FIELDS {
        return Err(metadata_too_large(format!(
            "ephemeral scope has {} fields; max is {MAX_EPHEMERAL_SCOPE_FIELDS}",
            scope.0.len()
        )));
    }
    let mut total = 0_usize;
    for (key, value) in &scope.0 {
        if key.len() > MAX_EPHEMERAL_SCOPE_KEY_BYTES {
            return Err(metadata_too_large(format!(
                "ephemeral scope key has {} bytes; max is {MAX_EPHEMERAL_SCOPE_KEY_BYTES}",
                key.len()
            )));
        }
        if value.len() > MAX_EPHEMERAL_SCOPE_VALUE_BYTES {
            return Err(metadata_too_large(format!(
                "ephemeral scope value for {key} has {} bytes; max is {MAX_EPHEMERAL_SCOPE_VALUE_BYTES}",
                value.len()
            )));
        }
        total = total.saturating_add(key.len()).saturating_add(value.len());
    }
    if total > MAX_EPHEMERAL_SCOPE_BYTES {
        return Err(metadata_too_large(format!(
            "ephemeral scope has {total} bytes; max is {MAX_EPHEMERAL_SCOPE_BYTES}"
        )));
    }
    Ok(())
}

fn validate_auth_bounds(auth: &AuthContext) -> Result<(), EphemeralError> {
    validate_bounded_optional(
        "principal",
        auth.principal.as_deref(),
        MAX_EPHEMERAL_IDENTITY_BYTES,
    )?;
    validate_bounded_optional(
        "session identity",
        auth.session_id.as_deref(),
        MAX_EPHEMERAL_IDENTITY_BYTES,
    )?;
    validate_bounded_optional(
        "user identity",
        auth.user_id.as_deref(),
        MAX_EPHEMERAL_IDENTITY_BYTES,
    )?;
    if auth.permissions.len() > MAX_EPHEMERAL_PERMISSIONS {
        return Err(metadata_too_large(format!(
            "ephemeral auth has {} permissions; max is {MAX_EPHEMERAL_PERMISSIONS}",
            auth.permissions.len()
        )));
    }
    let mut total = auth
        .principal
        .as_ref()
        .map_or(0, String::len)
        .saturating_add(auth.session_id.as_ref().map_or(0, String::len))
        .saturating_add(auth.user_id.as_ref().map_or(0, String::len));
    for permission in &auth.permissions {
        if permission.len() > MAX_EPHEMERAL_PERMISSION_BYTES {
            return Err(metadata_too_large(format!(
                "ephemeral permission has {} bytes; max is {MAX_EPHEMERAL_PERMISSION_BYTES}",
                permission.len()
            )));
        }
        total = total.saturating_add(permission.len());
    }
    if total > MAX_EPHEMERAL_AUTH_BYTES {
        return Err(metadata_too_large(format!(
            "ephemeral auth metadata has {total} bytes; max is {MAX_EPHEMERAL_AUTH_BYTES}"
        )));
    }
    Ok(())
}

struct RequestMetadata<'a> {
    collection: &'a str,
    scope: &'a Scope,
    connection_id: &'a str,
    auth: &'a AuthContext,
    session_id: Option<&'a str>,
    user_id: Option<&'a str>,
    custom_key: Option<&'a str>,
}

fn validate_request_metadata_bounds(metadata: &RequestMetadata<'_>) -> Result<(), EphemeralError> {
    validate_bounded_optional(
        "collection name",
        Some(metadata.collection),
        MAX_EPHEMERAL_COLLECTION_NAME_BYTES,
    )?;
    validate_scope_bounds(metadata.scope)?;
    validate_bounded_optional(
        "connection identity",
        Some(metadata.connection_id),
        MAX_EPHEMERAL_CONNECTION_ID_BYTES,
    )?;
    validate_bounded_optional(
        "claimed session identity",
        metadata.session_id,
        MAX_EPHEMERAL_IDENTITY_BYTES,
    )?;
    validate_bounded_optional(
        "claimed user identity",
        metadata.user_id,
        MAX_EPHEMERAL_IDENTITY_BYTES,
    )?;
    validate_bounded_optional(
        "custom key",
        metadata.custom_key,
        MAX_EPHEMERAL_CUSTOM_KEY_BYTES,
    )?;
    validate_auth_bounds(metadata.auth)
}

fn room_id_for(collection: &EphemeralCollection, scope: &Scope) -> Result<RoomId, EphemeralError> {
    validate_scope_bounds(scope)?;
    let expected = collection.scope_fields.iter().collect::<BTreeSet<_>>();
    let actual = scope.0.keys().collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(EphemeralError::new(
            EphemeralErrorCode::InvalidScope,
            format!(
                "scope keys for {} must exactly match [{}]",
                collection.name,
                collection.scope_fields.join(", ")
            ),
        ));
    }

    let routing_key = scope
        .routed_key(&collection.routing_fields)
        .ok_or_else(|| {
            EphemeralError::new(
                EphemeralErrorCode::InvalidScope,
                format!(
                    "scope is missing at least one routing field for {}",
                    collection.name
                ),
            )
        })?;

    Ok(RoomId {
        collection: collection.name.clone(),
        scope: scope.clone(),
        routing_key,
    })
}

fn entry_owner_for(
    collection: &EphemeralCollection,
    request: &PublishRequest,
) -> Result<EntryOwner, EphemeralError> {
    match collection.key_mode {
        KeyMode::Connection => Ok(EntryOwner::Connection(request.connection_id.clone())),
        KeyMode::Session => resolved_identity(
            request.session_id.as_deref(),
            request.auth.session_id.as_deref(),
            "session",
        )
        .map(EntryOwner::Session),
        KeyMode::User => resolved_identity(
            request.user_id.as_deref(),
            request.auth.user_id.as_deref(),
            "user",
        )
        .map(EntryOwner::User),
        // A custom key is an address, not an authority claim. Until generated
        // key-specific authorization exists, it is connection-owned: another
        // connection cannot replace/delete it even if it guesses the key.
        KeyMode::Custom => Ok(EntryOwner::Connection(request.connection_id.clone())),
    }
}

fn entry_key_for_publish(
    collection: &EphemeralCollection,
    request: &PublishRequest,
) -> Result<EntryKey, EphemeralError> {
    match collection.key_mode {
        KeyMode::Connection => Ok(EntryKey(request.connection_id.clone())),
        KeyMode::Session => resolved_identity(
            request.session_id.as_deref(),
            request.auth.session_id.as_deref(),
            "session",
        )
        .map(EntryKey),
        KeyMode::User => resolved_identity(
            request.user_id.as_deref(),
            request.auth.user_id.as_deref(),
            "user",
        )
        .map(EntryKey),
        KeyMode::Custom => request.custom_key.clone().map(EntryKey).ok_or_else(|| {
            EphemeralError::new(EphemeralErrorCode::MissingKey, "missing custom key")
        }),
    }
}

fn entry_key_for_delete(
    collection: &EphemeralCollection,
    request: &DeleteRequest,
) -> Result<EntryKey, EphemeralError> {
    match collection.key_mode {
        KeyMode::Connection => Ok(EntryKey(request.connection_id.clone())),
        KeyMode::Session => resolved_identity(
            request.session_id.as_deref(),
            request.auth.session_id.as_deref(),
            "session",
        )
        .map(EntryKey),
        KeyMode::User => resolved_identity(
            request.user_id.as_deref(),
            request.auth.user_id.as_deref(),
            "user",
        )
        .map(EntryKey),
        KeyMode::Custom => request.custom_key.clone().map(EntryKey).ok_or_else(|| {
            EphemeralError::new(EphemeralErrorCode::MissingKey, "missing custom key")
        }),
    }
}

fn entry_owner_for_delete(
    collection: &EphemeralCollection,
    request: &DeleteRequest,
) -> Result<EntryOwner, EphemeralError> {
    match collection.key_mode {
        KeyMode::Connection | KeyMode::Custom => {
            Ok(EntryOwner::Connection(request.connection_id.clone()))
        }
        KeyMode::Session => resolved_identity(
            request.session_id.as_deref(),
            request.auth.session_id.as_deref(),
            "session",
        )
        .map(EntryOwner::Session),
        KeyMode::User => resolved_identity(
            request.user_id.as_deref(),
            request.auth.user_id.as_deref(),
            "user",
        )
        .map(EntryOwner::User),
    }
}

fn resolved_identity(
    claimed: Option<&str>,
    authenticated: Option<&str>,
    kind: &str,
) -> Result<String, EphemeralError> {
    let authenticated = authenticated
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            EphemeralError::new(
                EphemeralErrorCode::MissingOwner,
                format!("missing authenticated {kind} identity"),
            )
        })?;
    if let Some(claimed) = claimed
        && claimed != authenticated
    {
        return Err(EphemeralError::new(
            EphemeralErrorCode::Unauthorized,
            format!("claimed {kind} identity conflicts with authenticated identity"),
        ));
    }
    Ok(authenticated.to_owned())
}

#[derive(Clone, Debug, Default)]
pub struct ClientEphemeralOverlay {
    rooms: BTreeMap<RoomId, OverlayRoom>,
}

#[derive(Clone, Debug, Default)]
struct OverlayRoom {
    scope_epoch: u64,
    high_water_version: u64,
    entries: BTreeMap<EntryKey, EphemeralEntry>,
    tombstones: BTreeMap<EntryKey, u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OverlayApply {
    Applied,
    IgnoredStale,
    NeedsResync,
    NotEphemeral,
}

impl ClientEphemeralOverlay {
    pub fn apply_envelope(&mut self, envelope: &RealtimeEnvelope) -> OverlayApply {
        match envelope {
            RealtimeEnvelope::Durable(_) => OverlayApply::NotEphemeral,
            RealtimeEnvelope::Ephemeral(message) => self.apply(message),
        }
    }

    pub fn apply(&mut self, message: &EphemeralMessage) -> OverlayApply {
        match message {
            EphemeralMessage::Snapshot {
                room,
                scope_epoch,
                high_water_version,
                entries,
                ..
            } => {
                if entries
                    .iter()
                    .any(|entry| entry.entry_version > *high_water_version)
                {
                    self.rooms.remove(room);
                    return OverlayApply::NeedsResync;
                }
                if let Some(current) = self.rooms.get(room)
                    && (*scope_epoch < current.scope_epoch
                        || (*scope_epoch == current.scope_epoch
                            && *high_water_version < current.high_water_version))
                {
                    return OverlayApply::IgnoredStale;
                }
                self.rooms.insert(
                    room.clone(),
                    OverlayRoom {
                        scope_epoch: *scope_epoch,
                        high_water_version: *high_water_version,
                        entries: entries
                            .iter()
                            .cloned()
                            .map(|entry| (entry.key.clone(), entry))
                            .collect(),
                        tombstones: BTreeMap::new(),
                    },
                );
                OverlayApply::Applied
            }
            EphemeralMessage::Upsert { room, entry, .. } => {
                let Some(overlay_room) = self.rooms.get_mut(room) else {
                    return OverlayApply::NeedsResync;
                };
                if overlay_room.scope_epoch != entry.scope_epoch {
                    return OverlayApply::NeedsResync;
                }
                if entry.entry_version <= overlay_room.high_water_version
                    || overlay_room
                        .tombstones
                        .get(&entry.key)
                        .is_some_and(|version| *version >= entry.entry_version)
                {
                    return OverlayApply::IgnoredStale;
                }
                overlay_room.high_water_version = entry.entry_version;
                overlay_room.tombstones.remove(&entry.key);
                overlay_room
                    .entries
                    .insert(entry.key.clone(), entry.clone());
                OverlayApply::Applied
            }
            EphemeralMessage::Remove {
                room,
                key,
                scope_epoch,
                entry_version,
                ..
            } => {
                let Some(overlay_room) = self.rooms.get_mut(room) else {
                    return OverlayApply::NeedsResync;
                };
                if overlay_room.scope_epoch != *scope_epoch {
                    return OverlayApply::NeedsResync;
                }
                if *entry_version <= overlay_room.high_water_version {
                    return OverlayApply::IgnoredStale;
                }
                overlay_room.high_water_version = *entry_version;
                overlay_room.entries.remove(key);
                overlay_room.tombstones.insert(key.clone(), *entry_version);
                while overlay_room.tombstones.len() > MAX_OVERLAY_TOMBSTONES {
                    let oldest = overlay_room
                        .tombstones
                        .iter()
                        .min_by_key(|(_, version)| *version)
                        .map(|(key, _)| key.clone());
                    if let Some(oldest) = oldest {
                        overlay_room.tombstones.remove(&oldest);
                    }
                }
                OverlayApply::Applied
            }
            EphemeralMessage::ResyncRequired { room, .. } => {
                self.rooms.remove(room);
                OverlayApply::NeedsResync
            }
            EphemeralMessage::Error { .. } => OverlayApply::NotEphemeral,
        }
    }

    pub fn get(&self, room: &RoomId, key: &EntryKey) -> Option<&EphemeralEntry> {
        self.rooms.get(room)?.entries.get(key)
    }

    pub fn room_entries(&self, room: &RoomId) -> Vec<&EphemeralEntry> {
        self.rooms
            .get(room)
            .map(|room| room.entries.values().collect())
            .unwrap_or_default()
    }

    pub fn prune_expired(&mut self, now_ms: Millis) {
        // @ref LLP 0013#client-overlay-store -- ephemeral state stays in memory and expires locally.
        for room in self.rooms.values_mut() {
            room.entries.retain(|_, entry| entry.expires_at_ms > now_ms);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacted_collection_ensure_errors_report_counts_without_names() {
        let backend = LocalEphemeralBackend::new();
        let loaded = EphemeralCollection::local_cursor("privateLoaded", "boardId");
        let extra = EphemeralCollection::local_cursor("privateExtra", "boardId");
        backend
            .replace_collections(vec![loaded.clone(), extra])
            .unwrap();
        let mut mismatched = loaded;
        mismatched.max_value_bytes += 1;

        let error = backend
            .ensure_collections_redacted(vec![mismatched])
            .expect_err("sessions-mode projection must collapse collection names");
        assert_eq!(
            error.code,
            EphemeralErrorCode::IncompatibleCollectionDefinition
        );
        assert!(error.message.contains("mismatched count: 1"));
        assert!(error.message.contains("extra count: 1"));
        assert!(!error.message.contains("privateLoaded"));
        assert!(!error.message.contains("privateExtra"));
    }

    #[test]
    fn network_deadline_clamp_preserves_fifo_without_leasing_early() {
        let profiles = crate::network_profile::NetworkProfileState::new();
        profiles
            .activate(
                crate::network_profile::NetworkConditionProfile {
                    name: "live-test".to_owned(),
                    mutation_ack_delay_ms: 0,
                    live_delta_delay_ms: 40,
                    query_response_delay_ms: 0,
                    jitter_ms: 0,
                },
                crate::network_profile::NetworkProfileAuthority::classified(
                    crate::contract_types::ServerProfile::Test,
                    crate::auth::deployment::AuthDeploymentTarget::Local,
                    false,
                    false,
                ),
                crate::network_profile::NetworkProfileSource::Api,
                None,
            )
            .unwrap();
        let basis = std::time::Instant::now();
        let first = profiles
            .admit_result(
                crate::network_profile::NetworkEgressLane::LiveDelta,
                basis + std::time::Duration::from_millis(40),
            )
            .unwrap();
        let second = profiles
            .admit_result(crate::network_profile::NetworkEgressLane::LiveDelta, basis)
            .unwrap();
        assert!(second.release_at() < first.release_at());

        let mut queue = OutboundQueue::new();
        let mut first_message =
            DurableMessage::new(b"first".to_vec()).with_network_egress(first.clone());
        let first_deadline = queue.prepare_durable_deadline(&mut first_message).unwrap();
        queue.push_durable(first_message);
        let mut second_message =
            DurableMessage::new(b"second".to_vec()).with_network_egress(second);
        let second_deadline = queue.prepare_durable_deadline(&mut second_message).unwrap();
        queue.push_durable(second_message);

        assert_eq!(second_deadline, first_deadline);
        let selected = queue.drain_with_authority_bounded_and_handoff_limit(
            None,
            MAX_OUTBOX_DRAIN_BATCH,
            MAX_OUTBOX_HANDOFF_BYTES,
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert!(selected.is_empty(), "a future deadline owns no send lease");
        assert!(queue.durable.iter().all(|queued| queued.lease_id.is_none()));
    }

    #[tokio::test]
    async fn delayed_burst_uses_one_scheduler_timer_and_releases_fifo() {
        let backend = LocalEphemeralBackend::new();
        let notifier = backend.delivery_notifier();
        let (_generation, wake) = notifier.register("profile-burst").unwrap();
        let profiles = crate::network_profile::NetworkProfileState::new();
        profiles
            .activate(
                crate::network_profile::NetworkConditionProfile {
                    name: "coalesced-burst".to_owned(),
                    mutation_ack_delay_ms: 0,
                    live_delta_delay_ms: 40,
                    query_response_delay_ms: 0,
                    jitter_ms: 0,
                },
                crate::network_profile::NetworkProfileAuthority::classified(
                    crate::contract_types::ServerProfile::Test,
                    crate::auth::deployment::AuthDeploymentTarget::Local,
                    false,
                    false,
                ),
                crate::network_profile::NetworkProfileSource::Api,
                None,
            )
            .unwrap();
        let basis = std::time::Instant::now();
        for index in 0..16_u8 {
            let egress = profiles
                .admit_result(crate::network_profile::NetworkEgressLane::LiveDelta, basis)
                .unwrap();
            backend.enqueue_durable_with_network_egress("profile-burst", vec![index], Some(egress));
        }
        assert!(backend.drain_outbox("profile-burst").is_empty());
        tokio::time::timeout(std::time::Duration::from_secs(1), wake.notified())
            .await
            .expect("coalesced deadline wakes at release");
        assert!(basis.elapsed() >= std::time::Duration::from_millis(35));
        let released = backend.drain_outbox("profile-burst");
        assert_eq!(released.len(), 16);
        for (index, envelope) in released.into_iter().enumerate() {
            let RealtimeEnvelope::Durable(message) = envelope else {
                panic!("burst emitted a non-durable frame");
            };
            assert_eq!(message.payload, vec![index as u8]);
        }
        assert_eq!(
            notifier.deadline_scheduler_counts(),
            (1, 1),
            "one burst deadline owns one scheduler task and one Tokio timer"
        );

        let normal = LocalEphemeralBackend::new();
        let normal_notifier = normal.delivery_notifier();
        normal_notifier.register("normal-burst").unwrap();
        normal.enqueue_durable("normal-burst", b"identity".to_vec());
        assert_eq!(normal_notifier.deadline_scheduler_counts(), (0, 0));
    }

    #[test]
    fn live_socket_marker_uses_admission_snapshot_and_normal_preserves_bytes() {
        let profiles = crate::network_profile::NetworkProfileState::new();
        let authority = crate::network_profile::NetworkProfileAuthority::classified(
            crate::contract_types::ServerProfile::Test,
            crate::auth::deployment::AuthDeploymentTarget::Local,
            false,
            false,
        );
        profiles
            .activate(
                crate::network_profile::NetworkConditionProfile {
                    name: "admission-snapshot".to_owned(),
                    mutation_ack_delay_ms: 0,
                    live_delta_delay_ms: 40,
                    query_response_delay_ms: 0,
                    jitter_ms: 0,
                },
                authority,
                crate::network_profile::NetworkProfileSource::Api,
                None,
            )
            .unwrap();
        let admitted = profiles
            .admit_result(
                crate::network_profile::NetworkEgressLane::LiveDelta,
                std::time::Instant::now()
                    .checked_sub(std::time::Duration::from_millis(40))
                    .unwrap(),
            )
            .expect("non-normal profile prepares delayed live egress");
        let normal_bytes = serde_json::to_vec(&crate::live_wire::LiveEnvelope::LiveReplace {
            network_profile: None,
            subscription_id: "sub_1".to_owned(),
            function: "listTodos".to_owned(),
            version: 1,
            rows: vec![],
            resume: None,
        })
        .unwrap();
        let delayed = DurableMessage::new(normal_bytes.clone()).with_network_egress(admitted);

        profiles
            .activate(
                crate::network_profile::NetworkConditionProfile {
                    name: "send-time-different".to_owned(),
                    mutation_ack_delay_ms: 0,
                    live_delta_delay_ms: 1,
                    query_response_delay_ms: 0,
                    jitter_ms: 0,
                },
                crate::network_profile::NetworkProfileAuthority::classified(
                    crate::contract_types::ServerProfile::Test,
                    crate::auth::deployment::AuthDeploymentTarget::Local,
                    false,
                    false,
                ),
                crate::network_profile::NetworkProfileSource::Api,
                None,
            )
            .unwrap();

        let delayed_bytes = delayed.into_live_socket_payload();
        let delayed_wire: serde_json::Value = serde_json::from_slice(&delayed_bytes).unwrap();
        assert_eq!(delayed_wire["network_profile"], "admission-snapshot");
        assert_ne!(delayed_wire["network_profile"], "send-time-different");

        assert_eq!(
            DurableMessage::new(normal_bytes.clone()).into_live_socket_payload(),
            normal_bytes,
            "normal frames remain byte-identical and carry no marker member"
        );
    }

    /// LLP 0032 L8 — an enqueue wakes the registered delivery waiter (and the
    /// wake permit survives a race with a not-yet-waiting task), while an
    /// unregistered connection is a no-op.
    #[tokio::test]
    async fn l8_enqueue_wakes_the_registered_delivery_waiter() {
        let backend = LocalEphemeralBackend::new();
        let notifier = backend.delivery_notifier();
        let (generation, waker) = notifier.register("conn").unwrap();

        // Enqueue before anyone awaits: the permit is stored.
        backend.enqueue_durable("conn", b"{}".to_vec());
        // notified() returns immediately thanks to the stored permit.
        tokio::time::timeout(std::time::Duration::from_secs(1), waker.notified())
            .await
            .expect("a durable enqueue must wake the registered waiter");

        // After unregister, waking is a no-op (nothing panics; nobody is woken).
        assert!(notifier.unregister("conn", generation));
        backend.enqueue_durable("conn", b"{}".to_vec());
    }

    /// LLP 0034 review fix 1 — a stale registration (superseded by a reconnect
    /// on the same connection id) must not remove the new socket's waker or
    /// claim teardown ownership; the current registration keeps working and
    /// still owns teardown.
    #[tokio::test]
    async fn stale_generation_unregister_keeps_the_new_registration() {
        let backend = LocalEphemeralBackend::new();
        let notifier = backend.delivery_notifier();

        let (old_generation, _old_waker) = notifier.register("conn").unwrap();
        // The reconnect: a new socket registers on the same connection id.
        let (new_generation, new_waker) = notifier.register("conn").unwrap();

        // The old task dies late: its unregister must be a no-op without
        // ownership (the caller gates disconnect on this).
        assert!(!notifier.unregister("conn", old_generation));

        // The new registration's waker still receives wakes.
        backend.enqueue_durable("conn", b"{}".to_vec());
        tokio::time::timeout(std::time::Duration::from_secs(1), new_waker.notified())
            .await
            .expect("the new socket's waker must survive the old task's teardown");

        // The new task still owns teardown.
        assert!(notifier.unregister("conn", new_generation));
    }

    #[test]
    fn teardown_claim_blocks_reconnect_and_rejects_stale_generation() {
        let backend = LocalEphemeralBackend::new();
        let notifier = backend.delivery_notifier();
        let (generation, _waker) = notifier
            .register_bound("conn", "grant-a")
            .expect("register predecessor");

        let claim = notifier
            .begin_teardown("conn", generation)
            .expect("the current generation owns teardown");
        let blocked = notifier
            .register_bound("conn", "grant-a")
            .expect_err("same-id reconnect waits for split cleanup");
        assert_eq!(
            blocked.diagnostic.code,
            "SNAPBACK_CONNECTION_TEARDOWN_PENDING"
        );
        assert!(notifier.begin_teardown("conn", generation).is_none());

        claim.finish();
        let (successor, _waker) = notifier
            .register_bound("conn", "grant-a")
            .expect("registration reopens after cleanup");
        assert!(successor > generation);
        assert!(notifier.begin_teardown("conn", generation).is_none());
    }

    /// ENG-23425 — the delivery loop's mid-life ownership check: a superseded
    /// registration reads as not-current (so its task stops draining the
    /// shared outbox instead of stealing the new socket's messages), the
    /// current registration reads as current, and after unregister nobody
    /// does.
    #[test]
    fn is_current_tracks_supersession_and_unregister() {
        let notifier = DeliveryNotifier::default();

        let (old_generation, _old_waker) = notifier.register("conn").unwrap();
        assert!(notifier.is_current("conn", old_generation));

        // The reconnect supersedes the old registration: only the new
        // generation may keep draining the connection's outbox.
        let (new_generation, _new_waker) = notifier.register("conn").unwrap();
        assert!(!notifier.is_current("conn", old_generation));
        assert!(notifier.is_current("conn", new_generation));

        // Unknown connections and unregistered generations are not current.
        assert!(!notifier.is_current("other", new_generation));
        assert!(notifier.unregister("conn", new_generation));
        assert!(!notifier.is_current("conn", new_generation));
    }

    #[tokio::test]
    async fn terminal_event_matches_grant_and_blocks_ordinary_delivery() {
        let notifier = DeliveryNotifier::default();
        let (generation, waker) = notifier.register_bound("conn", "grant-a").unwrap();
        let event = DeliveryTerminalEvent {
            code: LiveAuthErrorCode::SessionExpired,
            reason: LiveAuthErrorReason::Expired,
            authority_disposition: LiveAuthorityDisposition::Carrier,
            close_by: std::time::Instant::now() + std::time::Duration::from_secs(5),
        };

        assert!(!notifier.terminalize_bound("conn", "grant-b", event));
        assert!(notifier.is_deliverable("conn", generation));
        assert!(notifier.terminalize_bound("conn", "grant-a", event));
        tokio::time::timeout(std::time::Duration::from_secs(1), waker.notified())
            .await
            .expect("terminal installation wakes the exact socket");
        assert_eq!(
            notifier.terminal_if_current("conn", generation),
            Some(event)
        );
        assert!(
            notifier.is_current("conn", generation),
            "terminal owner remains current for generation-guarded teardown"
        );
        assert!(!notifier.is_deliverable("conn", generation));
    }

    #[test]
    fn delayed_terminal_event_cannot_close_replacement_grant() {
        let notifier = DeliveryNotifier::default();
        let (old_generation, _) = notifier.register_bound("conn", "grant-a").unwrap();
        let (new_generation, _) = notifier.register_bound("conn", "grant-b").unwrap();
        let event = DeliveryTerminalEvent {
            code: LiveAuthErrorCode::StreamReset,
            reason: LiveAuthErrorReason::Reset,
            authority_disposition: LiveAuthorityDisposition::DurableDelete,
            close_by: std::time::Instant::now() + std::time::Duration::from_secs(5),
        };

        assert!(!notifier.terminalize_bound("conn", "grant-a", event));
        assert_eq!(notifier.terminal_if_current("conn", old_generation), None);
        assert_eq!(notifier.terminal_if_current("conn", new_generation), None);
        assert!(notifier.is_deliverable("conn", new_generation));
    }

    #[test]
    fn delivery_generation_exhaustion_never_reuses_socket_ownership() {
        let notifier = DeliveryNotifier::default();
        lock(&notifier.state).next_generation = Some(u64::MAX);

        let (last_generation, _waker) = notifier.register("last").unwrap();
        assert_eq!(last_generation, u64::MAX);
        assert!(notifier.is_current("last", u64::MAX));
        for connection in ["next", "again"] {
            assert_eq!(
                notifier.register(connection).unwrap_err().diagnostic.code,
                "SNAPBACK_EPHEMERAL_GENERATION_EXHAUSTED"
            );
            assert!(!notifier.is_current(connection, 1));
            assert!(notifier.is_current("last", u64::MAX));
        }
    }

    #[test]
    fn generation_bound_drain_cannot_steal_replacement_messages() {
        let backend = LocalEphemeralBackend::new();
        let notifier = backend.delivery_notifier();
        let (old_generation, _old_waker) = notifier.register("conn").unwrap();
        assert!(notifier.is_current("conn", old_generation));

        // This replacement lands at the exact pause that used to exist
        // between `is_current` and the destructive drain.
        let (new_generation, _new_waker) = notifier.register("conn").unwrap();
        backend.enqueue_durable("conn", b"new-owner".to_vec());

        assert!(
            backend
                .drain_outbox_if_current("conn", old_generation)
                .is_none(),
            "the old generation must not drain after replacement"
        );
        let drained = backend
            .drain_outbox_if_current("conn", new_generation)
            .expect("new generation owns the drain");
        assert_eq!(drained.len(), 1);
    }

    #[test]
    fn public_outbox_wrapper_drop_commits_and_explicit_release_retries() {
        let backend = LocalEphemeralBackend::new();
        backend.enqueue_durable("conn", b"drop-commits".to_vec());

        let mut selected = backend.drain_outbox_for_send("conn");
        assert_eq!(selected.len(), 1);
        assert!(
            backend.drain_outbox_for_send("conn").is_empty(),
            "one active lease batch parks every competing drain"
        );
        drop(selected.pop().unwrap());
        assert!(
            backend.drain_outbox_for_send("conn").is_empty(),
            "ordinary public wrapper drop preserves the historical commit behavior"
        );

        backend.enqueue_durable("conn", b"explicit-release".to_vec());
        let selected = backend.drain_outbox_for_send("conn").pop().unwrap();
        selected.release_handoff();
        let retried = backend.drain_outbox_for_send("conn").pop().unwrap();
        let RealtimeEnvelope::Durable(message) = retried.envelope() else {
            panic!("expected the explicitly released durable frame");
        };
        assert_eq!(message.payload.as_slice(), b"explicit-release");
        assert!(retried.commit_handoff());
        assert!(backend.drain_outbox_for_send("conn").is_empty());
    }

    #[test]
    fn one_active_batch_prevents_overtaking_and_preserves_queue_order() {
        let backend = LocalEphemeralBackend::new();
        backend.enqueue_durable("conn", b"first".to_vec());
        backend.enqueue_durable("conn", b"second".to_vec());

        let first = backend
            .drain_outbox_for_send_with_limit("conn", 1)
            .pop()
            .unwrap();
        assert!(
            backend
                .drain_outbox_for_send_with_limit("conn", 1)
                .is_empty(),
            "a later frame cannot overtake an unaccepted predecessor"
        );
        first.release_handoff();

        let retry = backend
            .drain_outbox_for_send_with_limit("conn", 1)
            .pop()
            .unwrap();
        let RealtimeEnvelope::Durable(message) = retry.envelope() else {
            panic!("expected first durable frame");
        };
        assert_eq!(message.payload.as_slice(), b"first");
        assert!(retry.commit_handoff());

        let second = backend
            .drain_outbox_for_send_with_limit("conn", 1)
            .pop()
            .unwrap();
        let RealtimeEnvelope::Durable(message) = second.envelope() else {
            panic!("expected second durable frame");
        };
        assert_eq!(message.payload.as_slice(), b"second");
        assert!(second.commit_handoff());
    }

    #[test]
    fn websocket_drains_one_frame_and_replacement_generation_owns_retry() {
        let backend = LocalEphemeralBackend::new();
        let notifier = backend.delivery_notifier();
        let (old_generation, _) = notifier.register("conn").unwrap();
        backend.enqueue_durable("conn", b"first".to_vec());
        backend.enqueue_durable("conn", b"second".to_vec());

        let mut selected = backend
            .drain_outbox_for_send_if_current("conn", old_generation)
            .unwrap();
        assert_eq!(selected.len(), 1, "a WS drain holds at most one lease");
        let first = selected.pop().unwrap();
        let (envelope, permit, lease) = first.into_leased_parts();
        assert!(permit.is_none());
        let RealtimeEnvelope::Durable(message) = envelope else {
            panic!("expected first durable frame");
        };
        assert_eq!(message.payload.as_slice(), b"first");

        let (new_generation, _) = notifier.register("conn").unwrap();
        assert!(
            notifier
                .act_if_current("conn", old_generation, || {
                    lease.try_commit((), |()| Ok(()))
                })
                .is_none(),
            "the predecessor generation cannot linearize a final handoff"
        );
        drop(lease);

        let retried = backend
            .drain_outbox_for_send_if_current("conn", new_generation)
            .unwrap();
        assert_eq!(retried.len(), 1);
        let RealtimeEnvelope::Durable(message) = retried[0].envelope() else {
            panic!("expected replacement-owned retry");
        };
        assert_eq!(message.payload.as_slice(), b"first");
        assert!(retried.into_iter().next().unwrap().commit_handoff());

        let next = backend
            .drain_outbox_for_send_if_current("conn", new_generation)
            .unwrap();
        assert_eq!(next.len(), 1);
        let RealtimeEnvelope::Durable(message) = next[0].envelope() else {
            panic!("expected the second durable frame");
        };
        assert_eq!(message.payload.as_slice(), b"second");
    }

    #[test]
    fn replacement_generation_inherits_the_guarded_durable_publication() {
        use std::sync::mpsc;
        use std::time::Duration;

        let fixture = bound_backend_fixture();
        let predecessor = fixture.authorization.clone();
        let backend = Arc::new(fixture.backend.clone());
        let notifier = backend.delivery_notifier();
        let (old_generation, _old_waker) = notifier.register("conn").unwrap();
        backend.enqueue_authorized_durable("conn", b"replacement-private".to_vec(), predecessor);

        let (new_generation, _new_waker) = notifier.register("conn").unwrap();
        assert!(
            backend
                .drain_outbox_for_send_if_current("conn", old_generation)
                .is_none(),
            "the superseded socket cannot steal the queued private frame"
        );
        let admitted = backend
            .drain_outbox_for_send_if_current("conn", new_generation)
            .expect("the replacement socket owns the guarded drain");
        assert_eq!(admitted.len(), 1);
        assert!(admitted[0].publication_authority.is_some());

        let (prepared_tx, prepared_rx) = mpsc::channel();
        let commit_backend = backend.clone();
        let prepare = std::thread::spawn(move || {
            let reservation = commit_backend
                .reserve_authorization_commit(
                    AuthorizationCommitPreflight::AllProtectedRooms,
                    Arc::new(AuthorizationReservationCancellation::new()),
                )
                .unwrap();
            prepared_tx.send(reservation).unwrap();
        });
        assert!(
            prepared_rx.recv_timeout(Duration::from_millis(20)).is_err(),
            "replacement ownership must not shorten the final-publication permit"
        );
        drop(admitted);
        let reservation = prepared_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("the commit resumes after the replacement send completes");
        reservation.cancel();
        prepare.join().unwrap();
    }

    #[test]
    fn generation_bound_drain_serializes_registration_without_deadlock() {
        use std::sync::mpsc;
        use std::time::Duration;

        let fixture = bound_backend_fixture();
        let backend = Arc::new(fixture.backend.clone());
        let notifier = backend.delivery_notifier();
        let (generation, _waker) = notifier.register("conn").unwrap();
        backend.enqueue_durable("conn", b"queued".to_vec());

        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let drain_backend = backend.clone();
        let drain_notifier = notifier.clone();
        let drain = std::thread::spawn(move || {
            drain_notifier.act_if_current("conn", generation, || {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                drain_backend.lease_compatibility_outbox("conn")
            })
        });
        entered_rx.recv_timeout(Duration::from_secs(1)).unwrap();

        let (registered_tx, registered_rx) = mpsc::channel();
        let register_notifier = notifier.clone();
        let replacement = std::thread::spawn(move || {
            let registered = register_notifier.register("conn").unwrap();
            registered_tx.send(registered.0).unwrap();
        });
        assert!(
            registered_rx
                .recv_timeout(Duration::from_millis(20))
                .is_err()
        );
        release_tx.send(()).unwrap();
        assert!(registered_rx.recv_timeout(Duration::from_secs(1)).is_ok());
        let admitted = drain.join().unwrap().unwrap();
        assert_eq!(admitted.len(), 1);
        assert_eq!(
            LocalEphemeralBackend::commit_compatibility_batch(admitted).len(),
            1
        );
        replacement.join().unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn lease_settlement_waits_for_notifier_contention_without_losing_wake() {
        use std::sync::mpsc;
        use std::time::Duration;

        let backend = Arc::new(LocalEphemeralBackend::new());
        for index in 0..(MAX_OUTBOX_DRAIN_BATCH + 1) {
            backend.enqueue_durable("conn", index.to_le_bytes().to_vec());
        }
        let notifier = backend.delivery_notifier();
        let (generation, waker) = notifier.register("conn").unwrap();
        let selected = backend.drain_outbox_for_send("conn");
        assert_eq!(selected.len(), MAX_OUTBOX_DRAIN_BATCH);

        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let held_notifier = notifier.clone();
        let holder = std::thread::spawn(move || {
            held_notifier.act_if_current("conn", generation, || {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            })
        });
        entered_rx.recv_timeout(Duration::from_secs(1)).unwrap();

        let (settled_tx, settled_rx) = mpsc::channel();
        let settle = std::thread::spawn(move || {
            drop(selected);
            settled_tx.send(()).unwrap();
        });
        assert!(
            settled_rx.recv_timeout(Duration::from_millis(20)).is_err(),
            "settlement must wait instead of dropping a contended wake"
        );
        release_tx.send(()).unwrap();
        settled_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), waker.notified())
            .await
            .expect("settlement wakes remaining queued work after contention");

        let remaining = backend.drain_outbox_for_send("conn");
        assert_eq!(remaining.len(), 1);
        drop(remaining);
        settle.join().unwrap();
        holder.join().unwrap();
    }

    fn scope() -> Scope {
        Scope::from_pairs([("boardId", "board-1")])
    }

    fn room() -> RoomId {
        let scope = scope();
        RoomId {
            collection: "boardCursors".to_owned(),
            routing_key: scope
                .routed_key(&["boardId".to_owned()])
                .expect("test scope includes boardId"),
            scope,
        }
    }

    fn auth_for(scope: &Scope) -> AuthContext {
        AuthContext::default().with_room_permission("board", scope)
    }

    fn collection() -> EphemeralCollection {
        EphemeralCollection::local_cursor("boardCursors", "boardId")
            .require_room_permission("board")
    }

    #[test]
    fn membership_declaration_is_a_room_permission_backing_table() {
        use crate::manifest::{
            FieldManifest, FieldType, MembershipManifest, MembershipScope, TableManifest,
        };

        let projection = RoomPermissionProjection {
            table: "memberships".to_owned(),
            subject_field: "userId".to_owned(),
            scope_fields: BTreeMap::from([("boardId".to_owned(), "boardId".to_owned())]),
            role_field: Some("role".to_owned()),
            allowed_roles: Some(vec!["member".to_owned()]),
        };
        let ephemeral_collection = collection().permission_backed_by(projection);
        let table = TableManifest {
            name: "memberships".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "userId".to_owned(),
                    field_type: FieldType::Principal,
                    optional: false,
                },
                FieldManifest {
                    name: "boardId".to_owned(),
                    field_type: FieldType::Id {
                        table: "boards".to_owned(),
                    },
                    optional: false,
                },
                FieldManifest {
                    name: "role".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "nickname".to_owned(),
                    field_type: FieldType::String,
                    optional: true,
                },
                FieldManifest {
                    name: "expiresAt".to_owned(),
                    field_type: FieldType::Integer,
                    optional: true,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: Some(MembershipManifest {
                id: Some("board-members".to_owned()),
                principal: "userId".to_owned(),
                resource: Some("boardId".to_owned()),
                role: "role".to_owned(),
                roles: vec!["member".to_owned()],
                pending_roles: None,
                bootstrap_role: None,
                last_holder: None,
                expiry: None,
                incidental: Some(vec!["nickname".to_owned()]),
                provenance: None,
                transitions: Vec::new(),
                scope: MembershipScope::Resource,
                resource_table: Some("boards".to_owned()),
                principal_addressed_writes: None,
            }),
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        };

        validate_collection_permission_backing(
            std::slice::from_ref(&ephemeral_collection),
            std::slice::from_ref(&table),
            true,
        )
        .expect("membership declaration derives the durable room backing");

        let legacy_projection: RoomPermissionProjection =
            serde_json::from_value(serde_json::json!({
                "table": "memberships",
                "subjectField": "userId",
                "scopeFields": { "boardId": "boardId" }
            }))
            .expect("omitted role projection remains readable");
        assert_eq!(legacy_projection.role_field, None);
        assert_eq!(legacy_projection.allowed_roles, None);
        let legacy_json = serde_json::to_value(&legacy_projection).expect("serialize projection");
        assert!(legacy_json.get("roleField").is_none());
        assert!(legacy_json.get("allowedRoles").is_none());
        let omitted_role_collection = collection().permission_backed_by(legacy_projection);
        validate_collection_permission_backing(
            std::slice::from_ref(&omitted_role_collection),
            std::slice::from_ref(&table),
            true,
        )
        .expect("membership omission canonicalizes to its active role vocabulary");

        let mut pending_table = table.clone();
        pending_table.membership.as_mut().unwrap().pending_roles = Some(vec!["invited".to_owned()]);
        let mut pending_collection = ephemeral_collection.clone();
        pending_collection
            .permission_backing
            .as_mut()
            .unwrap()
            .allowed_roles = Some(vec!["invited".to_owned()]);
        let error = validate_collection_permission_backing(
            std::slice::from_ref(&pending_collection),
            std::slice::from_ref(&pending_table),
            true,
        )
        .expect_err("pending roles must never activate as room grants");
        assert_eq!(
            error.code,
            EphemeralErrorCode::IncompatibleCollectionDefinition
        );

        let mut doctored_incidental_role = table.clone();
        doctored_incidental_role
            .membership
            .as_mut()
            .unwrap()
            .incidental = Some(vec!["role".to_owned()]);
        validate_collection_permission_backing(
            std::slice::from_ref(&ephemeral_collection),
            std::slice::from_ref(&doctored_incidental_role),
            true,
        )
        .expect_err("the projected role axis must affect authorization");

        let mut mismatched_pair = ephemeral_collection;
        mismatched_pair
            .permission_backing
            .as_mut()
            .unwrap()
            .allowed_roles = None;
        validate_collection_permission_backing(
            std::slice::from_ref(&mismatched_pair),
            std::slice::from_ref(&table),
            true,
        )
        .expect_err("roleField and allowedRoles activate as one closed pair");
    }

    fn publish_request(connection_id: &str, value: &[u8]) -> PublishRequest {
        publish_request_for(connection_id, value, scope())
    }

    fn publish_request_for(connection_id: &str, value: &[u8], scope: Scope) -> PublishRequest {
        PublishRequest {
            collection: "boardCursors".to_owned(),
            auth: auth_for(&scope),
            scope,
            connection_id: connection_id.to_owned(),
            session_id: None,
            user_id: None,
            custom_key: None,
            value: value.to_vec(),
            ttl_ms: None,
        }
    }

    fn subscribe_request(connection_id: &str) -> SubscribeRequest {
        subscribe_request_for(connection_id, scope())
    }

    fn subscribe_request_for(connection_id: &str, scope: Scope) -> SubscribeRequest {
        SubscribeRequest {
            collection: "boardCursors".to_owned(),
            auth: auth_for(&scope),
            scope,
            connection_id: connection_id.to_owned(),
            since_chunk: None,
        }
    }

    #[test]
    fn reserved_stream_room_is_initiator_private_ordered_and_gap_explicit() {
        let backend = LocalEphemeralBackend::new();
        backend
            .register_collection(stream_collection_definition())
            .expect("platform stream collection");
        let authority = crate::auth::invocation::InvocationGate::prepare_authority(
            crate::auth::invocation::InvocationSource::LocalAction,
            crate::manifest::AuthMode::Dev,
            crate::contract_types::ServerProfile::Test,
            0,
            0,
            &crate::auth::invocation::WireAuthorityFields::default(),
            crate::auth::invocation::ResolvedAppAuthority::Anonymous,
        )
        .expect("prepare mode-only stream origin");
        let runner_host =
            authority.stream_runner_host(Arc::new(std::sync::atomic::AtomicBool::new(false)));
        let runner = runner_host.runner();
        let origin = authority.stream_attempt_origin();
        let initiator = crate::stream_attempt::StreamInitiator::SessionUser("user-a".to_owned());
        let client_key = format!("ephemeral-stream-test:{}", uuid::Uuid::new_v4());
        let registry = crate::stream_attempt::global_stream_attempt_registry();
        let attempt = origin
            .stage_start_with_metadata(
                registry,
                usize::MAX - 7,
                &client_key,
                runner,
                None,
                crate::stream_attempt::StreamAttemptMetadata {
                    function_id: Some("app:conversation".to_owned()),
                    initiator: Some(initiator.clone()),
                    started_at_ms: 1_000,
                },
            )
            .expect("stream attempt");
        let scope = Scope::from_pairs([("attemptToken", attempt.attempt_token.as_str())]);

        let subscribe = |connection_id: &str, candidate, since_chunk| SubscribeRequest {
            collection: STREAM_COLLECTION_NAME.to_owned(),
            scope: scope.clone(),
            connection_id: connection_id.to_owned(),
            auth: AuthContext {
                stream_initiator: Some(candidate),
                ..AuthContext::default()
            },
            since_chunk,
        };
        backend
            .subscribe(subscribe("first", initiator.clone(), None), 1_000)
            .expect("initiator first connection");
        backend
            .subscribe(subscribe("second", initiator.clone(), None), 1_000)
            .expect("same user second connection reconnects");
        for (connection, outsider) in [
            (
                "other-user",
                crate::stream_attempt::StreamInitiator::SessionUser("user-b".to_owned()),
            ),
            (
                "service",
                crate::stream_attempt::StreamInitiator::ServiceCredential(
                    "credential-b".to_owned(),
                ),
            ),
            (
                "anonymous",
                crate::stream_attempt::StreamInitiator::AnonymousConnection("anonymous".to_owned()),
            ),
        ] {
            assert_eq!(
                backend
                    .subscribe(subscribe(connection, outsider, None), 1_000)
                    .expect_err("second principal refused")
                    .code,
                EphemeralErrorCode::Unauthorized
            );
        }

        // Reserve five monotonic indexes, but retain only 3 and 4. This is
        // the post-eviction shape a reconnect must distinguish from a full
        // replay; chunks themselves remain live-only.
        for _ in 0..5 {
            registry
                .record_emit_counters_host(&runner_host, &attempt.attempt_token, 1)
                .expect("reserve chunk index");
        }
        for index in [3_u64, 4] {
            backend
                .publish(
                    PublishRequest {
                        collection: STREAM_COLLECTION_NAME.to_owned(),
                        scope: scope.clone(),
                        connection_id: "server".to_owned(),
                        session_id: None,
                        user_id: None,
                        custom_key: Some(format!("{index:020}")),
                        value: serde_json::to_vec(&serde_json::json!({
                            "attemptToken": attempt.attempt_token.clone(),
                            "chunkIndex": index,
                            "chunk": index,
                        }))
                        .unwrap(),
                        ttl_ms: None,
                        auth: AuthContext::default()
                            .with_room_permission("_snapback_stream_server", &scope),
                    },
                    1_001 + index,
                )
                .expect("server publish");
        }

        let replay = backend
            .subscribe(subscribe("third", initiator.clone(), Some(3)), 1_010)
            .expect("retained replay");
        let EphemeralMessage::Snapshot {
            entries,
            stream_resume: Some(resume),
            ..
        } = replay
        else {
            panic!("stream replay snapshot")
        };
        assert_eq!(entries.len(), 1);
        assert_eq!(
            serde_json::from_slice::<Value>(&entries[0].value).unwrap()["chunkIndex"],
            4
        );
        assert!(!resume.truncated);
        assert_eq!(resume.next_chunk, 5);

        let gap = backend
            .subscribe(subscribe("fourth", initiator, Some(0)), 1_010)
            .expect("gap snapshot");
        let EphemeralMessage::Snapshot {
            stream_resume: Some(resume),
            ..
        } = gap
        else {
            panic!("stream gap snapshot")
        };
        assert!(resume.truncated);
        assert_eq!(
            resume.transcript_path,
            format!("/streams/{}", attempt.attempt_token)
        );
    }

    fn delete_request(connection_id: &str) -> DeleteRequest {
        let scope = scope();
        DeleteRequest {
            collection: "boardCursors".to_owned(),
            auth: auth_for(&scope),
            scope,
            connection_id: connection_id.to_owned(),
            session_id: None,
            user_id: None,
            custom_key: None,
            expected_scope_epoch: None,
            expected_entry_generation: None,
        }
    }

    fn operator_delete_request(published: &PublishOutcome) -> OperatorDeleteRequest {
        OperatorDeleteRequest {
            collection: published.room.collection.clone(),
            scope: published.room.scope.clone(),
            entry_key: published.key.0.clone(),
            expected_scope_epoch: published.scope_epoch,
            expected_entry_generation: published.entry_version,
            reason: "operator repair test".to_owned(),
        }
    }

    fn set_next_entry_version(backend: &LocalEphemeralBackend, next: u64) {
        let room_arc = lock(&backend.shared.rooms)
            .get(&room())
            .cloned()
            .expect("test room exists");
        lock(&room_arc).next_entry_version = next;
    }

    fn assert_only_epoch_changed_boundary(backend: &LocalEphemeralBackend, connection_id: &str) {
        let frames = drain_through_test_sink(backend, connection_id);
        assert_eq!(frames.len(), 1, "stale room data must be purged");
        assert!(matches!(
            &frames[0],
            RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired {
                room_authority_generation: 0,
                reason: ResyncReason::EpochChanged,
                ..
            })
        ));
    }

    #[test]
    fn entry_version_allocates_portable_max_then_retires_on_the_next_publish() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let initial = backend.subscribe(subscribe_request("observer"), 1).unwrap();
        let initial_scope_epoch = initial.scope_epoch().unwrap();
        set_next_entry_version(&backend, crate::manifest::PORTABLE_STORAGE_VERSION_MAX);

        let final_entry = backend
            .publish(publish_request("owner", b"portable-max"), 2)
            .expect("the final portable entry version is representable");
        assert_eq!(
            final_entry.entry_version,
            crate::manifest::PORTABLE_STORAGE_VERSION_MAX
        );
        let error = backend
            .publish(publish_request("owner", b"must-retire"), 3)
            .expect_err("the successor cannot be represented");
        assert_eq!(error.code, EphemeralErrorCode::GenerationExhausted);
        assert_eq!(backend.diagnostics().room_count, 0);

        let replacement = backend
            .subscribe(subscribe_request("replacement"), 4)
            .expect("a fresh room incarnation opens after the old permit drains");
        assert!(replacement.scope_epoch().unwrap() > initial_scope_epoch);
        assert_only_epoch_changed_boundary(&backend, "observer");
        let diagnostics = backend.diagnostics();
        assert_eq!(diagnostics.generation_exhaustions, 1);
        assert_eq!(
            diagnostics.last_generation_exhaustion.unwrap().code,
            EphemeralErrorCode::GenerationExhausted
        );
    }

    #[test]
    fn exhausted_scope_epoch_refuses_room_insertion_without_reuse() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.shared.next_scope_epoch.store(
            crate::manifest::PORTABLE_STORAGE_VERSION_MAX,
            Ordering::Release,
        );

        let final_scope = Scope::from_pairs([("boardId", "board-max")]);
        let snapshot = backend
            .subscribe(subscribe_request_for("last", final_scope.clone()), 1)
            .expect("the final portable scope epoch is representable");
        assert_eq!(
            snapshot.scope_epoch(),
            Some(crate::manifest::PORTABLE_STORAGE_VERSION_MAX)
        );
        assert!(
            backend
                .unsubscribe(subscribe_request_for("last", final_scope))
                .unwrap()
        );
        assert_eq!(backend.diagnostics().room_count, 0);

        for board in ["board-next", "board-again"] {
            let next_scope = Scope::from_pairs([("boardId", board)]);
            let error = backend
                .subscribe(subscribe_request_for(board, next_scope), 2)
                .expect_err("scope epoch exhaustion is sticky");
            assert_eq!(error.code, EphemeralErrorCode::GenerationExhausted);
            assert_eq!(backend.diagnostics().room_count, 0);
        }
    }

    #[test]
    fn retired_protected_control_blocks_stale_active_permit_recreation() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("observer"), 1).unwrap();
        set_next_entry_version(&backend, crate::manifest::PORTABLE_STORAGE_VERSION_MAX + 1);
        let admitted = backend
            .begin_server_authorized_room_act("boardCursors", &scope())
            .unwrap()
            .expect("protected prelookup permit");

        let error = backend
            .publish_with_room_authority(publish_request("owner", b"exhausted"), 2, Some(&admitted))
            .expect_err("the admitted act retires its exhausted room");
        assert_eq!(error.code, EphemeralErrorCode::GenerationExhausted);
        assert_eq!(backend.diagnostics().room_count, 0);
        assert_eq!(
            backend
                .publish_with_room_authority(
                    publish_request("owner", b"stale-permit"),
                    3,
                    Some(&admitted),
                )
                .expect_err("a stale permit cannot recreate the retired room")
                .code,
            EphemeralErrorCode::AuthorityPending
        );
        assert_eq!(
            backend
                .publish(publish_request("owner", b"fresh-blocked"), 3)
                .expect_err("new protected acts wait for the active predecessor permit")
                .code,
            EphemeralErrorCode::AuthorityPending
        );

        drop(admitted);
        backend
            .publish(publish_request("owner", b"fresh"), 4)
            .expect("dropping the predecessor permit opens a fresh control");
        assert_eq!(backend.diagnostics().room_count, 1);
        assert_only_epoch_changed_boundary(&backend, "observer");
    }

    #[test]
    fn delete_exhaustion_retires_room_and_purges_old_lane() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("observer"), 1).unwrap();
        backend
            .publish(publish_request("owner", b"old"), 2)
            .unwrap();
        backend.drain_outbox("observer");
        set_next_entry_version(&backend, crate::manifest::PORTABLE_STORAGE_VERSION_MAX + 1);

        let error = backend
            .delete(delete_request("owner"), 3)
            .expect_err("delete cannot reuse an entry version");
        assert_eq!(error.code, EphemeralErrorCode::GenerationExhausted);
        assert_eq!(backend.diagnostics().room_count, 0);
        assert_only_epoch_changed_boundary(&backend, "observer");
    }

    #[test]
    fn unauthorized_key_owner_cannot_trigger_exhaustion_retirement() {
        let backend = LocalEphemeralBackend::new();
        let mut custom = collection();
        custom.key_mode = KeyMode::Custom;
        backend.register_collection(custom).unwrap();
        let request = |connection_id: &str, value: &[u8]| PublishRequest {
            custom_key: Some("shared-address".to_owned()),
            ..publish_request(connection_id, value)
        };
        backend.publish(request("owner", b"secret"), 1).unwrap();
        set_next_entry_version(&backend, crate::manifest::PORTABLE_STORAGE_VERSION_MAX + 1);

        let error = backend
            .publish(request("attacker", b"replace"), 2)
            .expect_err("ownership rejection precedes generation retirement");
        assert_eq!(error.code, EphemeralErrorCode::Unauthorized);
        let diagnostics = backend.diagnostics();
        assert_eq!(diagnostics.room_count, 1);
        assert_eq!(diagnostics.entry_count, 1);
        assert_eq!(diagnostics.generation_exhaustions, 0);
    }

    #[test]
    fn expiry_exhaustion_records_typed_diagnostic_and_terminally_retires_room() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("observer"), 1).unwrap();
        let published = backend
            .publish(publish_request("owner", b"expires"), 2)
            .unwrap();
        backend.drain_outbox("observer");
        set_next_entry_version(&backend, crate::manifest::PORTABLE_STORAGE_VERSION_MAX + 1);

        backend.cleanup_expired(published.expires_at_ms);
        let diagnostics = backend.diagnostics();
        assert_eq!(diagnostics.room_count, 0);
        assert_eq!(diagnostics.generation_exhaustions, 1);
        assert_eq!(
            diagnostics.last_generation_exhaustion.unwrap().code,
            EphemeralErrorCode::GenerationExhausted
        );
        assert_only_epoch_changed_boundary(&backend, "observer");
    }

    #[test]
    fn disconnect_exhaustion_terminally_retires_room_for_other_subscribers() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("observer"), 1).unwrap();
        backend
            .publish(publish_request("owner", b"owned"), 2)
            .unwrap();
        backend.drain_outbox("observer");
        set_next_entry_version(&backend, crate::manifest::PORTABLE_STORAGE_VERSION_MAX + 1);

        backend.disconnect("owner", 3);
        assert_eq!(backend.diagnostics().room_count, 0);
        assert_only_epoch_changed_boundary(&backend, "observer");
    }

    #[test]
    fn terminal_boundary_enqueue_overflow_collapses_to_clear_retained_marker() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("observer"), 1).unwrap();
        backend
            .publish(publish_request("owner", b"stale-data"), 2)
            .unwrap();
        let outbox = backend.ensure_outbox("observer");
        {
            let mut queue = lock(&outbox);
            for _ in 0..MAX_OUTBOX_BACKLOG {
                let result = queue.push_resync(
                    Arc::new(EphemeralMessage::Error {
                        ephemeral_authority_instance: None,
                        room: None,
                        room_authority_generation: None,
                        error: EphemeralError::new(
                            EphemeralErrorCode::Unauthorized,
                            "bounded filler",
                        ),
                    }),
                    None,
                );
                assert!(!result.overflowed);
            }
        }
        set_next_entry_version(&backend, crate::manifest::PORTABLE_STORAGE_VERSION_MAX + 1);

        assert_eq!(
            backend
                .publish(publish_request("owner", b"cannot-advance"), 3)
                .unwrap_err()
                .code,
            EphemeralErrorCode::GenerationExhausted
        );
        {
            let queue = lock(&outbox);
            assert!(queue.is_overflowed(None));
            assert!(queue.ephemeral.is_empty(), "the old room lane was purged");
        }
        let drained = backend.drain_outbox("observer");
        assert_eq!(drained.len(), 1);
        let RealtimeEnvelope::Durable(marker) = &drained[0] else {
            panic!("overflow must materialize the durable clear-retained marker");
        };
        let marker: serde_json::Value = serde_json::from_slice(&marker.payload).unwrap();
        assert_eq!(marker["kind"], "resync_required");
        assert_eq!(marker["reason"], "outbox_overflow");
        assert_eq!(marker["clear_retained"], true);
    }

    #[test]
    fn expiry_exhaustion_cannot_lose_its_boundary_to_definition_replacement() {
        let backend = LocalEphemeralBackend::new();
        let collection = EphemeralCollection::local_cursor("boardCursors", "boardId");
        backend.register_collection(collection.clone()).unwrap();
        let subscribe = SubscribeRequest {
            collection: "boardCursors".to_owned(),
            scope: scope(),
            connection_id: "observer".to_owned(),
            auth: AuthContext::default(),
            since_chunk: None,
        };
        let first = backend.subscribe(subscribe, 1_000).unwrap();
        let first_epoch = first.scope_epoch().unwrap();
        backend
            .publish(
                PublishRequest {
                    collection: "boardCursors".to_owned(),
                    scope: scope(),
                    connection_id: "owner".to_owned(),
                    session_id: None,
                    user_id: None,
                    custom_key: None,
                    value: b"expires".to_vec(),
                    ttl_ms: Some(1),
                    auth: AuthContext::default(),
                },
                1_000,
            )
            .unwrap();
        backend.drain_outbox("observer");
        set_next_entry_version(&backend, crate::manifest::PORTABLE_STORAGE_VERSION_MAX + 1);

        let (reached_tx, reached_rx) = std::sync::mpsc::sync_channel(0);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);
        *lock(&backend.shared.definition_swap_hook) = Some(DefinitionSwapTestHook {
            reached: reached_tx,
            release: release_rx,
        });
        let replacement_backend = backend.clone();
        let replacement = std::thread::spawn(move || {
            let mut changed = collection;
            changed.default_ttl_ms = 9_000;
            replacement_backend.register_collection(changed).unwrap();
        });
        reached_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("replacement pauses after swapping definitions");

        let (cleanup_started_tx, cleanup_started_rx) = std::sync::mpsc::sync_channel(0);
        let (cleanup_done_tx, cleanup_done_rx) = std::sync::mpsc::sync_channel(0);
        let cleanup_backend = backend.clone();
        let cleanup = std::thread::spawn(move || {
            cleanup_started_tx.send(()).unwrap();
            cleanup_backend.cleanup_expired(2_000);
            cleanup_done_tx.send(()).unwrap();
        });
        cleanup_started_rx.recv().unwrap();
        assert!(
            cleanup_done_rx
                .recv_timeout(std::time::Duration::from_millis(30))
                .is_err(),
            "expiry terminalization must wait behind the destructive generation barrier"
        );

        release_tx.send(()).unwrap();
        replacement.join().unwrap();
        cleanup_done_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("expiry cleanup resumes after replacement");
        cleanup.join().unwrap();

        let frames = backend.drain_outbox("observer");
        assert_eq!(frames.len(), 1, "one clearing boundary must survive");
        assert!(matches!(
            &frames[0],
            RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired {
                scope_epoch,
                reason: ResyncReason::EpochChanged,
                ..
            }) if *scope_epoch == first_epoch
        ));
        assert_eq!(
            backend.diagnostics().generation_exhaustions,
            0,
            "replacement won before the blocked expiry mutation"
        );
    }

    fn authorization_issuer(
        authorization: &AuthorizationVersion,
        boot_sequence: u64,
        version_stream: &str,
        view: AuthorizationExpectationView,
    ) -> crate::auth::invalidation::LiveInvalidationIssuer {
        let issuer_id = crate::auth::invalidation::IssuerId::fresh(
            authorization.incarnation.clone(),
            boot_sequence,
        )
        .unwrap();
        let authenticator =
            crate::auth::invalidation::IssuerAuthenticator::new("ephemeral-test", [0x45; 32])
                .unwrap();
        let authenticated = authenticator
            .authenticate(issuer_id, "test-target", "test-app")
            .unwrap();
        let issuer = crate::auth::invalidation::LiveInvalidationIssuer::with_authenticator(
            authenticated,
            authenticator,
            "test-target",
            "test-app",
        )
        .unwrap();
        issuer.bind_authorization_expectation(view).unwrap();
        issuer
            .install_version_stream(version_stream.to_owned())
            .unwrap();
        issuer
    }

    struct BoundBackendFixture {
        backend: LocalEphemeralBackend,
        database: ServingDatabase,
        authorization: AuthorizationVersion,
    }

    fn bound_backend_fixture() -> BoundBackendFixture {
        let local = crate::storage::LocalDatabase::memory().expect("in-memory database");
        let mut database = ServingDatabase::adopt(local).expect("serving database");
        let (authorization, version_stream, boot_sequence) = database
            .reserve_invalidation_boot_issuer()
            .expect("durable authorization snapshot");
        let backend = LocalEphemeralBackend::for_serving_database(
            EphemeralStoreLimits::default(),
            &mut database,
        )
        .expect("database-bound room authority");
        let view = backend
            .authorization_expectation_view_for_install(&mut database)
            .expect("kernel authorization expectation view");
        assert_eq!(view.current().unwrap(), authorization);
        let issuer = authorization_issuer(&authorization, boot_sequence, &version_stream, view);
        backend.install_authorization_issuer(issuer);
        backend
            .activate_authorization_commit_interlock(&mut database)
            .expect("ready authorization participant");
        BoundBackendFixture {
            backend,
            database,
            authorization,
        }
    }

    #[test]
    fn activation_without_an_installed_issuer_fails_closed() {
        let local = crate::storage::LocalDatabase::memory().expect("in-memory database");
        let mut database = ServingDatabase::adopt(local).expect("serving database");
        database
            .reserve_invalidation_boot_issuer()
            .expect("durable authorization snapshot");
        let backend = LocalEphemeralBackend::for_serving_database(
            EphemeralStoreLimits::default(),
            &mut database,
        )
        .expect("database-bound room authority");
        backend
            .authorization_expectation_view_for_install(&mut database)
            .expect("kernel view initialization alone");

        let error = backend
            .activate_authorization_commit_interlock(&mut database)
            .expect_err("a kernel view is not proof of an installed live issuer");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
    }

    #[test]
    fn managed_successor_install_reactivates_a_suspended_projection_before_reopening() {
        let mut fixture = bound_backend_fixture();
        fixture.backend.clear_authorization_issuer();
        let unavailable = fixture
            .database
            .authorization_commit_reservation_required()
            .expect_err("clearing the issuer intrinsically suspends the commit latch");
        assert_eq!(
            unavailable.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );

        let (authorization, version_stream, boot_sequence) = fixture
            .database
            .reserve_invalidation_boot_issuer()
            .expect("reserve a successor issuer while projection is suspended");
        let view = fixture
            .backend
            .authorization_expectation_view_for_install(&mut fixture.database)
            .expect("bind the successor view to the exact ready participant");
        let issuer = authorization_issuer(&authorization, boot_sequence, &version_stream, view);

        let mut local_scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        fixture
            .backend
            .install_authorization_issuer_and_activate(&mut fixture.database, issuer)
            .expect("database-validated successor activation");
        let batch = local_scope.take_after_local_batch();
        drop(local_scope);
        crate::exec_guard::run_after_local_batch(batch).unwrap();

        assert!(
            fixture
                .database
                .authorization_commit_reservation_required()
                .expect("successor projection reopens authorization commits")
        );
        assert_eq!(
            fixture
                .backend
                .authorization_expectation_for_test()
                .expect("successor issuer copy is installed before reopening"),
            authorization
        );
    }

    #[test]
    fn same_database_participant_replacement_rejects_held_room_permit() {
        let mut fixture = bound_backend_fixture();
        fixture.backend.register_collection(collection()).unwrap();
        let held = fixture
            .backend
            .begin_server_authorized_room_act("boardCursors", &scope())
            .unwrap()
            .expect("protected room returns a P0 permit");
        let transport_permit = fixture
            .backend
            .begin_server_authorized_room_act("boardCursors", &scope())
            .unwrap()
            .expect("protected room returns a second P0 transport permit");

        let _replacement = fixture
            .database
            .replace_authorization_commit_participant()
            .expect("same-database replacement retires P0");

        let error = fixture
            .backend
            .publish_with_room_authority(
                publish_request("owner", b"retired-participant"),
                2,
                Some(&held),
            )
            .expect_err("a P0 permit held across replacement must fail closed");
        assert_eq!(error.code, EphemeralErrorCode::AuthorityPending);
        assert!(
            RealtimePublicationPermit::Room(transport_permit)
                .begin_handoff()
                .is_err(),
            "a P0 permit must also fail at the final transport boundary"
        );
    }

    #[test]
    fn protected_registration_is_closed_by_the_exact_pending_ticket() {
        let fixture = bound_backend_fixture();
        let backend = fixture.backend;
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("first"), 1).unwrap();

        let first = backend
            .reserve_authorization_commit(
                AuthorizationCommitPreflight::AllProtectedRooms,
                Arc::new(AuthorizationReservationCancellation::new()),
            )
            .unwrap();
        let second = backend
            .reserve_authorization_commit(
                AuthorizationCommitPreflight::AllProtectedRooms,
                Arc::new(AuthorizationReservationCancellation::new()),
            )
            .unwrap();
        let error = backend
            .subscribe(subscribe_request("late"), 2)
            .expect_err("either pending ticket closes registration");
        assert_eq!(error.code, EphemeralErrorCode::AuthorityPending);

        first.cancel();
        let error = backend
            .subscribe(subscribe_request("late"), 3)
            .expect_err("rolling back one ticket must not clear another");
        assert_eq!(error.code, EphemeralErrorCode::AuthorityPending);
        second.cancel();
        backend
            .subscribe(subscribe_request("late"), 4)
            .expect("the exact final rollback reopens the old generation");
    }

    #[test]
    fn authorization_neutral_preflight_never_touches_the_room_registry() {
        let fixture = bound_backend_fixture();
        let backend = fixture.backend;
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("observer"), 1).unwrap();

        let reservation = backend
            .reserve_authorization_commit(
                AuthorizationCommitPreflight::NoAuthorizationEvent,
                Arc::new(AuthorizationReservationCancellation::new()),
            )
            .expect("authorization-neutral preview reserves no room state");
        backend
            .publish(publish_request("owner", b"still-live"), 2)
            .expect("neutral preflight leaves the protected room live");
        reservation.cancel();
    }

    #[test]
    #[should_panic(
        expected = "ephemeral collection registration entered while LocalSnapback write scope"
    )]
    fn lifecycle_definition_lock_rejects_local_writer_overlap() {
        let backend = LocalEphemeralBackend::new();
        let _scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        let _ = backend.register_collection(collection());
    }

    #[test]
    #[should_panic(expected = "ephemeral diagnostics entered while LocalSnapback write scope")]
    fn diagnostics_reject_local_writer_overlap() {
        let backend = LocalEphemeralBackend::new();
        let _scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        let _ = backend.diagnostics();
    }

    #[test]
    #[should_panic(
        expected = "ephemeral authorization issuer clearing entered while LocalSnapback write scope"
    )]
    fn issuer_projection_lock_rejects_local_writer_overlap() {
        let backend = LocalEphemeralBackend::new();
        let _scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        backend.clear_authorization_issuer();
    }

    #[tokio::test]
    async fn durable_enqueue_defers_notifier_wake_until_local_scope_ends() {
        use std::time::Duration;

        let backend = LocalEphemeralBackend::new();
        let notifier = backend.delivery_notifier();
        let (_generation, wake) = notifier.register("deferred-wake").unwrap();
        let mut scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        backend.enqueue_durable("deferred-wake".to_owned(), b"queued".to_vec());
        let batch = scope.take_after_local_batch();
        drop(scope);

        assert!(
            tokio::time::timeout(Duration::from_millis(10), wake.notified())
                .await
                .is_err(),
            "outbox enqueue alone may not lock or wake the notifier beneath Local"
        );
        crate::exec_guard::run_after_local_batch(batch).unwrap();
        tokio::time::timeout(Duration::from_secs(1), wake.notified())
            .await
            .expect("the owned after-Local callback delivers the deferred wake");
    }

    #[test]
    fn cancelled_quiescence_removes_only_its_exact_pending_ticket() {
        use std::time::{Duration, Instant};

        let fixture = bound_backend_fixture();
        let backend = fixture.backend;
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("observer"), 1).unwrap();
        let held = backend
            .begin_server_authorized_room_act("boardCursors", &scope())
            .unwrap()
            .expect("protected room act holds the quiescence permit");
        let cancellation = Arc::new(AuthorizationReservationCancellation::new());
        let worker_backend = backend.clone();
        let worker_cancellation = cancellation.clone();
        let worker = std::thread::spawn(move || {
            worker_backend.reserve_authorization_commit(
                AuthorizationCommitPreflight::AllProtectedRooms,
                worker_cancellation,
            )
        });

        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            match backend.begin_server_authorized_room_act("boardCursors", &scope()) {
                Err(error) if error.code == EphemeralErrorCode::AuthorityPending => break,
                Ok(permit) => drop(permit),
                Err(error) => panic!("unexpected room admission result: {error:?}"),
            }
            assert!(
                Instant::now() < deadline,
                "reservation installed its ticket"
            );
            std::thread::yield_now();
        }
        assert_eq!(
            backend
                .publish(publish_request("owner", b"blocked"), 2)
                .expect_err("pending reservation closes the affected room")
                .code,
            EphemeralErrorCode::AuthorityPending
        );

        cancellation.cancel();
        let error = match worker.join().expect("reservation worker joins") {
            Ok(reservation) => {
                reservation.cancel();
                panic!("cancelled reservation unexpectedly quiesced")
            }
            Err(error) => error,
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_RESERVATION_CANCELLED");
        let concurrent = backend
            .begin_server_authorized_room_act("boardCursors", &scope())
            .unwrap()
            .expect("exact cancellation reopens admission without consuming the held act");
        drop(concurrent);
        drop(held);
    }

    #[test]
    fn transport_drain_holds_commit_until_final_send_permit_drops() {
        use std::sync::mpsc;
        use std::time::Duration;

        let fixture = bound_backend_fixture();
        let backend = Arc::new(fixture.backend.clone());
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("observer"), 1).unwrap();
        backend
            .publish(publish_request("owner", b"one"), 2)
            .unwrap();
        let admitted = backend.drain_outbox_for_send("observer");
        assert_eq!(admitted.len(), 1);

        let (prepared_tx, prepared_rx) = mpsc::channel();
        let commit_backend = backend.clone();
        let prepare = std::thread::spawn(move || {
            let reservation = commit_backend
                .reserve_authorization_commit(
                    AuthorizationCommitPreflight::AllProtectedRooms,
                    Arc::new(AuthorizationReservationCancellation::new()),
                )
                .unwrap();
            prepared_tx.send(reservation).unwrap();
        });
        assert!(
            prepared_rx.recv_timeout(Duration::from_millis(20)).is_err(),
            "a destructively drained frame must retain its final-send permit"
        );
        drop(admitted);
        let reservation = prepared_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("dropping the transport frame releases commit preparation");
        reservation.cancel();
        prepare.join().unwrap();
    }

    #[test]
    fn same_database_replacement_rejects_previously_admitted_transport_handoff() {
        let mut fixture = bound_backend_fixture();
        fixture.backend.register_collection(collection()).unwrap();
        fixture
            .backend
            .subscribe(subscribe_request("observer"), 1)
            .unwrap();
        fixture
            .backend
            .publish(publish_request("owner", b"queued-before-replacement"), 2)
            .unwrap();
        let admitted = fixture
            .backend
            .drain_outbox_for_send("observer")
            .into_iter()
            .find(|admitted| matches!(admitted.envelope(), RealtimeEnvelope::Ephemeral(_)))
            .expect("protected frame is admitted under P0");

        let _replacement = fixture
            .database
            .replace_authorization_commit_participant()
            .expect("same-database replacement retires P0");

        assert!(
            !admitted.commit_handoff(),
            "a P0 frame admitted before replacement cannot cross the final sink afterward"
        );
    }

    #[test]
    fn prelookup_transport_permit_admits_act_after_prepare_becomes_pending() {
        use std::sync::mpsc;
        use std::time::{Duration, Instant};

        let fixture = bound_backend_fixture();
        let backend = fixture.backend;
        backend.register_collection(collection()).unwrap();
        let room_scope = scope();
        let admitted = backend
            .begin_server_authorized_room_act("boardCursors", &room_scope)
            .unwrap()
            .expect("protected room returns a prelookup permit");

        let (prepared_tx, prepared_rx) = mpsc::channel();
        let commit_backend = backend.clone();
        let prepare = std::thread::spawn(move || {
            let reservation = commit_backend
                .reserve_authorization_commit(
                    AuthorizationCommitPreflight::AllProtectedRooms,
                    Arc::new(AuthorizationReservationCancellation::new()),
                )
                .unwrap();
            prepared_tx.send(reservation).unwrap();
        });
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            match backend.begin_server_authorized_room_act("boardCursors", &room_scope) {
                Err(error) if error.code == EphemeralErrorCode::AuthorityPending => break,
                Ok(permit) => drop(permit),
                Err(error) => panic!("unexpected room admission result: {error:?}"),
            }
            assert!(Instant::now() < deadline, "prepare did not become pending");
            std::thread::yield_now();
        }

        backend
            .publish_with_room_authority(
                publish_request("owner", b"admitted-before-prepare"),
                2,
                Some(&admitted),
            )
            .expect("the prelookup permit keeps its room act before commit");
        assert!(
            prepared_rx.recv_timeout(Duration::from_millis(20)).is_err(),
            "prepare must still wait through final transport publication"
        );
        drop(admitted);
        let reservation = prepared_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("dropping the admitted permit releases prepare");
        reservation.cancel();
        prepare.join().unwrap();
    }

    #[test]
    fn durable_authorization_ticket_retains_scoped_frames_but_not_independent_traffic() {
        let fixture = bound_backend_fixture();
        let backend = fixture.backend;
        let predecessor = fixture.authorization;
        backend.enqueue_authorized_durable(
            "observer",
            b"old-private-board".to_vec(),
            predecessor.clone(),
        );
        backend.enqueue_durable("observer", b"authority-independent".to_vec());

        let reservation = backend
            .reserve_authorization_commit(
                AuthorizationCommitPreflight::AllProtectedRooms,
                Arc::new(AuthorizationReservationCancellation::new()),
            )
            .unwrap();
        let admitted = backend.drain_outbox_for_send("observer");
        assert_eq!(admitted.len(), 1);
        let (independent, permit) = admitted.into_iter().next().unwrap().into_parts();
        assert!(permit.is_none());
        assert!(matches!(
            independent,
            RealtimeEnvelope::Durable(message)
                if message.payload == b"authority-independent"
        ));

        reservation.cancel();
        let admitted = backend.drain_outbox_for_send("observer");
        assert_eq!(admitted.len(), 1);
        let (retained, permit) = admitted.into_iter().next().unwrap().into_parts();
        assert!(permit.is_some());
        assert!(matches!(
            retained,
            RealtimeEnvelope::Durable(message) if message.payload == b"old-private-board"
        ));
        drop(permit);

        let stale = AuthorizationVersion {
            incarnation: predecessor.incarnation,
            epoch: predecessor.epoch.checked_add(1).unwrap(),
        };
        backend.enqueue_authorized_durable("observer", b"stale-private-board".to_vec(), stale);
        assert!(
            backend.drain_outbox_for_send("observer").is_empty(),
            "a non-current authorization frame is discarded"
        );
    }

    #[test]
    fn public_unfenced_drain_cannot_extract_authorized_durable_data() {
        let fixture = bound_backend_fixture();
        let backend = fixture.backend;
        let predecessor = fixture.authorization;
        backend.enqueue_authorized_durable("observer", b"private-board".to_vec(), predecessor);
        backend.enqueue_durable("observer", b"authority-independent".to_vec());

        assert_eq!(
            backend.drain_outbox("observer"),
            vec![RealtimeEnvelope::Durable(DurableMessage::new(
                b"authority-independent".to_vec()
            ))],
            "the compatibility drain can publish only unfenced traffic"
        );
        let guarded = backend.drain_outbox_for_send("observer");
        assert_eq!(guarded.len(), 1);
        assert!(guarded[0].publication_authority.is_some());
        assert!(matches!(
            guarded[0].envelope(),
            RealtimeEnvelope::Durable(message) if message.payload == b"private-board"
        ));
    }

    fn recompute_room_retained_bytes(room_id: &RoomId, room: &RoomState) -> usize {
        let mut retained = retained_room_identity_bytes(room_id);
        for (key, record) in &room.entries {
            let entry_bytes = retained_entry_bytes(key, &record.owner, record.value.capacity());
            assert_eq!(
                record.retained_bytes, entry_bytes,
                "entry-local retained accounting drifted for {key:?}"
            );
            retained = retained.saturating_add(entry_bytes);
        }
        for (owner, connections) in &room.owner_connections {
            retained = retained
                .saturating_add(retained_owner_bytes(owner))
                .saturating_add(MAP_ENTRY_OVERHEAD);
            for connection_id in connections {
                retained = retained
                    .saturating_add(retained_string_bytes(connection_id))
                    .saturating_add(MAP_ENTRY_OVERHEAD);
            }
        }
        for (connection_id, subscriber) in &room.subscribers {
            assert_eq!(
                subscriber.retained_bytes,
                retained_subscriber_bytes(connection_id)
                    .saturating_add(retained_auth_context_bytes(&subscriber.auth))
            );
            retained = retained.saturating_add(subscriber.retained_bytes);
        }
        let mut indexed_connections = room.subscribers.keys().cloned().collect::<BTreeSet<_>>();
        for connections in room.owner_connections.values() {
            indexed_connections.extend(connections.iter().cloned());
        }
        for connection_id in indexed_connections {
            retained = retained
                .saturating_add(retained_connection_room_edge_bytes(&connection_id, room_id));
        }
        if room.indexed_deadline.is_some() {
            retained = retained.saturating_add(retained_expiry_index_entry_bytes(room_id));
        }
        retained
    }

    fn recompute_queue_retained_bytes(queue: &OutboundQueue) -> usize {
        let durable = queue
            .durable
            .iter()
            .map(|queued| retained_durable_queue_item_bytes(queued.message.as_ref()))
            .sum::<usize>();
        let resync = queue
            .resync
            .iter()
            .map(|message| retained_resync_queue_item_bytes(message.message.as_ref()))
            .sum::<usize>();
        let ephemeral = queue
            .ephemeral
            .iter()
            .map(|(key, message)| {
                retained_ephemeral_queue_item_bytes(&key.0, &key.1, message.message.as_ref())
            })
            .sum::<usize>();
        let overflow_markers = if queue.all_authorities_poisoned {
            retained_global_overflow_signal_bytes()
        } else {
            queue.overflowed_effect_fences.iter().fold(
                if queue.overflowed {
                    retained_global_overflow_signal_bytes()
                } else {
                    0
                },
                |total, effect_fence| {
                    total.saturating_add(retained_exact_overflow_marker_bytes(effect_fence))
                },
            )
        };
        assert_eq!(queue.durable_bytes, durable, "durable byte ledger drifted");
        assert_eq!(queue.resync_bytes, resync, "resync byte ledger drifted");
        assert_eq!(
            queue.ephemeral_bytes, ephemeral,
            "ephemeral byte ledger drifted"
        );
        assert_eq!(
            queue.overflow_marker_bytes, overflow_markers,
            "overflow-marker byte ledger drifted"
        );
        let active_lease_binding = queue
            .active_lease_effect_fence
            .as_ref()
            .map_or(0, retained_outbox_lease_binding_bytes);
        assert_eq!(
            queue.active_lease_binding_bytes, active_lease_binding,
            "active lease-binding byte ledger drifted"
        );
        durable
            .saturating_add(resync)
            .saturating_add(ephemeral)
            .saturating_add(overflow_markers)
            .saturating_add(active_lease_binding)
    }

    fn assert_retained_accounting(backend: &LocalEphemeralBackend) {
        let rooms = lock(&backend.shared.rooms);
        let mut expected_connection_rooms = BTreeMap::<ConnectionId, BTreeSet<RoomId>>::new();
        let mut expected_expiry_index = BTreeMap::<(Millis, RoomId), ()>::new();
        let mut room_bytes = 0_usize;
        for (room_id, room_arc) in rooms.iter() {
            let room = lock(room_arc);
            assert!(!room.retired, "routing map retained a retired room");
            let expected = recompute_room_retained_bytes(room_id, &room);
            assert_eq!(
                room.retained_bytes, expected,
                "room retained-byte ledger drifted for {room_id:?}"
            );
            assert!(
                expected <= backend.shared.limits.max_room_value_bytes,
                "room exceeded its admitted retained-byte budget"
            );
            room_bytes = room_bytes.saturating_add(expected);
            for connection_id in room.subscribers.keys() {
                expected_connection_rooms
                    .entry(connection_id.clone())
                    .or_default()
                    .insert(room_id.clone());
            }
            for connections in room.owner_connections.values() {
                for connection_id in connections {
                    expected_connection_rooms
                        .entry(connection_id.clone())
                        .or_default()
                        .insert(room_id.clone());
                }
            }
            if let Some(deadline) = room.indexed_deadline {
                expected_expiry_index.insert((deadline, room_id.clone()), ());
            }
        }
        assert_eq!(
            *lock(&backend.shared.connection_rooms),
            expected_connection_rooms,
            "connection→room reverse index drifted"
        );
        assert_eq!(
            *lock(&backend.shared.expiry_index),
            expected_expiry_index,
            "expiry index drifted"
        );

        let outboxes = lock(&backend.shared.outboxes);
        let mut outbox_bytes = 0_usize;
        for queue in outboxes.values() {
            let queue = lock(queue);
            let expected = recompute_queue_retained_bytes(&queue);
            assert_eq!(queue.retained_bytes(), expected);
            assert!(expected <= MAX_OUTBOX_RETAINED_BYTES);
            assert!(queue.durable.len() <= MAX_OUTBOX_BACKLOG);
            assert!(queue.ephemeral.len() <= MAX_OUTBOX_BACKLOG);
            assert!(queue.resync.len() <= MAX_OUTBOX_OVERFLOW_RESYNCS);
            assert!(queue.overflowed_effect_fences.len() <= MAX_OUTBOX_EXACT_OVERFLOW_MARKERS);
            if queue.all_authorities_poisoned {
                assert!(queue.durable.is_empty());
                assert!(queue.resync.is_empty());
                assert!(queue.ephemeral.is_empty());
                assert!(!queue.overflowed);
                assert!(queue.overflowed_effect_fences.is_empty());
            }
            outbox_bytes = outbox_bytes.saturating_add(expected);
        }
        drop(outboxes);
        drop(rooms);

        let diagnostics = backend.diagnostics();
        assert_eq!(diagnostics.outbox_retained_bytes, outbox_bytes);
        assert_eq!(
            diagnostics.retained_bytes,
            room_bytes.saturating_add(outbox_bytes)
        );
    }

    #[test]
    fn retained_accounting_tracks_replacement_and_delete_last_owner() {
        let backend = LocalEphemeralBackend::new();
        let mut custom = collection();
        custom.key_mode = KeyMode::Custom;
        backend.register_collection(custom).unwrap();

        let mut first_value = Vec::with_capacity(2_048);
        first_value.extend_from_slice(b"large-capacity-value");
        let mut first = publish_request("publisher", b"");
        first.custom_key = Some("first".to_owned());
        first.value = first_value;
        backend.publish(first, 1_000).unwrap();
        assert_retained_accounting(&backend);
        let before_replace = backend.diagnostics().retained_bytes;

        let mut replacement = publish_request("publisher", b"x");
        replacement.custom_key = Some("first".to_owned());
        backend.publish(replacement, 1_001).unwrap();
        assert_retained_accounting(&backend);
        assert!(
            backend.diagnostics().retained_bytes < before_replace,
            "replacement must release the old value allocation"
        );

        let mut second = publish_request("publisher", b"second");
        second.custom_key = Some("second".to_owned());
        backend.publish(second, 1_002).unwrap();
        assert_retained_accounting(&backend);

        let delete = |key: &str| DeleteRequest {
            collection: "boardCursors".to_owned(),
            scope: scope(),
            connection_id: "publisher".to_owned(),
            session_id: None,
            user_id: None,
            custom_key: Some(key.to_owned()),
            expected_scope_epoch: None,
            expected_entry_generation: None,
            auth: auth_for(&scope()),
        };
        backend.delete(delete("first"), 1_003).unwrap();
        assert_retained_accounting(&backend);
        assert!(
            lock(&backend.shared.connection_rooms).contains_key("publisher"),
            "the shared owner/reverse edge survives until its final key"
        );

        backend.delete(delete("second"), 1_004).unwrap();
        assert_retained_accounting(&backend);
        assert_eq!(backend.diagnostics().room_count, 0);
        assert!(!lock(&backend.shared.connection_rooms).contains_key("publisher"));
    }

    #[test]
    fn retained_accounting_tracks_expiry_and_unsubscribe() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend
            .subscribe(subscribe_request("observer"), 1_000)
            .unwrap();
        backend
            .publish(publish_request("publisher", b"cursor"), 1_001)
            .unwrap();
        assert_retained_accounting(&backend);

        backend.cleanup_expired(6_001);
        assert_retained_accounting(&backend);
        let room_id = room();
        let room_arc = lock(&backend.shared.rooms).get(&room_id).cloned().unwrap();
        let room_state = lock(&room_arc);
        assert!(room_state.entries.is_empty());
        assert!(room_state.indexed_deadline.is_none());
        drop(room_state);
        assert_eq!(
            lock(&backend.shared.connection_rooms)
                .get("observer")
                .map(BTreeSet::len),
            Some(1)
        );
        assert!(!lock(&backend.shared.connection_rooms).contains_key("publisher"));

        assert!(backend.unsubscribe(subscribe_request("observer")).unwrap());
        assert_retained_accounting(&backend);
        assert_eq!(backend.diagnostics().room_count, 0);

        backend.drain_outbox("observer");
        assert_retained_accounting(&backend);
        assert_eq!(backend.diagnostics().outbox_retained_bytes, 0);
    }

    #[test]
    fn retained_accounting_tracks_shared_owner_disconnects() {
        let backend = LocalEphemeralBackend::new();
        let mut users = collection();
        users.key_mode = KeyMode::User;
        backend.register_collection(users).unwrap();
        backend
            .subscribe(subscribe_request("observer"), 1_000)
            .unwrap();

        let publish_as_user = |connection_id: &str, value: &[u8]| {
            let mut request = publish_request(connection_id, value);
            request.user_id = Some("user-1".to_owned());
            request.auth.user_id = Some("user-1".to_owned());
            request
        };
        backend
            .publish(publish_as_user("tab-a", b"a"), 1_001)
            .unwrap();
        backend
            .publish(publish_as_user("tab-b", b"b"), 1_002)
            .unwrap();
        assert_retained_accounting(&backend);

        backend.disconnect("tab-a", 1_003);
        assert_retained_accounting(&backend);
        assert_eq!(backend.diagnostics().entry_count, 1);
        assert!(!lock(&backend.shared.connection_rooms).contains_key("tab-a"));
        assert!(lock(&backend.shared.connection_rooms).contains_key("tab-b"));

        backend.disconnect("tab-b", 1_004);
        assert_retained_accounting(&backend);
        assert_eq!(backend.diagnostics().entry_count, 0);
        assert!(!lock(&backend.shared.connection_rooms).contains_key("tab-b"));
    }

    #[test]
    fn outbound_queue_byte_and_overflow_ledgers_stay_hard_bounded() {
        let mut queue = OutboundQueue::new();
        let room = room();
        let key = EntryKey("publisher".to_owned());
        let message = Arc::new(EphemeralMessage::Upsert {
            ephemeral_authority_instance: None,
            room: room.clone(),
            room_authority_generation: 0,
            entry: EphemeralEntry {
                key: key.clone(),
                value: vec![7; 4_096],
                received_at_ms: 1,
                expires_at_ms: 30_001,
                scope_epoch: 1,
                entry_version: 1,
            },
        });
        queue.push_ephemeral(message, MAX_OUTBOX_BACKLOG, None);
        assert!(
            queue.ephemeral_bytes > 4_096,
            "cloned room/key metadata is charged"
        );
        assert_eq!(
            queue.retained_bytes(),
            recompute_queue_retained_bytes(&queue)
        );

        // The byte ceiling, not only the item ceiling, must collapse a large
        // durable backlog into the sticky resync representation.
        while !queue.overflowed {
            queue.push_durable(DurableMessage::new(vec![9; 128 * 1_024]));
        }
        assert!(queue.durable.len() < MAX_OUTBOX_BACKLOG);
        assert_eq!(
            queue.retained_bytes(),
            recompute_queue_retained_bytes(&queue)
        );
        assert!(queue.retained_bytes() <= MAX_OUTBOX_RETAINED_BYTES);

        // An attacker can continue naming rooms while the queue is sticky.
        // Crossing the recovery-ledger cap must not silently omit the final
        // room: it collapses every lane to one bounded all-authority signal.
        for index in 0..(MAX_OUTBOX_OVERFLOW_RESYNCS + 128) {
            let scope = Scope::from_pairs([("boardId", format!("board-{index}"))]);
            let room = RoomId {
                collection: "boardCursors".to_owned(),
                routing_key: scope
                    .routed_key(&["boardId".to_owned()])
                    .expect("test scope is routable"),
                scope,
            };
            queue.record_overflow_resync_for_room(room, 1, 0, None);
        }
        assert!(queue.all_authorities_poisoned);
        assert!(queue.resync.is_empty());
        assert!(queue.durable.is_empty());
        assert!(queue.ephemeral.is_empty());
        assert_eq!(
            queue.retained_bytes(),
            recompute_queue_retained_bytes(&queue)
        );
        assert!(queue.retained_bytes() <= MAX_OUTBOX_RETAINED_BYTES);

        assert!(
            queue
                .drain_with_authority(
                    None,
                    |_| FrameAuthorityDisposition::Send,
                    |_| FrameAuthorityDisposition::Send,
                )
                .is_empty(),
            "a compatibility drain cannot consume all-authority poison"
        );
        let current = ConnectionEffectFence::session("inc", "grant-current", "session", 2);
        let recovered = queue.drain_with_authority(
            Some(&current),
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert_eq!(recovered.len(), 1);
        let RealtimeEnvelope::Durable(signal) = &recovered[0] else {
            panic!("poison must materialize one durable recovery signal");
        };
        assert_eq!(signal.effect_fence(), Some(&current));
        let signal: serde_json::Value = serde_json::from_slice(&signal.payload).unwrap();
        assert_eq!(signal["kind"], "resync_required");
        assert_eq!(signal["clear_retained"], true);
        assert!(
            queue
                .drain_with_authority(
                    Some(&current),
                    |_| FrameAuthorityDisposition::Send,
                    |_| FrameAuthorityDisposition::Send,
                )
                .is_empty(),
            "the verified current drain consumes poison exactly once"
        );
        queue.drain_with_authority(
            None,
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert_eq!(queue.retained_bytes(), 0);
        assert_eq!(recompute_queue_retained_bytes(&queue), 0);
    }

    #[test]
    fn metadata_rejections_count_every_request_operation() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let oversized_connection = "x".repeat(MAX_EPHEMERAL_CONNECTION_ID_BYTES + 1);

        let mut publish = publish_request(&oversized_connection, b"cursor");
        assert_eq!(
            backend.publish(publish.clone(), 1_000).unwrap_err().code,
            EphemeralErrorCode::MetadataTooLarge
        );
        let delete = DeleteRequest {
            collection: publish.collection.clone(),
            scope: publish.scope.clone(),
            connection_id: oversized_connection.clone(),
            session_id: None,
            user_id: None,
            custom_key: None,
            expected_scope_epoch: None,
            expected_entry_generation: None,
            auth: publish.auth.clone(),
        };
        assert_eq!(
            backend.delete(delete, 1_000).unwrap_err().code,
            EphemeralErrorCode::MetadataTooLarge
        );
        let subscribe = SubscribeRequest {
            collection: publish.collection.clone(),
            scope: publish.scope.clone(),
            connection_id: oversized_connection,
            auth: publish.auth.clone(),
            since_chunk: None,
        };
        assert_eq!(
            backend
                .subscribe(subscribe.clone(), 1_000)
                .unwrap_err()
                .code,
            EphemeralErrorCode::MetadataTooLarge
        );
        assert_eq!(
            backend.unsubscribe(subscribe).unwrap_err().code,
            EphemeralErrorCode::MetadataTooLarge
        );
        assert_eq!(backend.diagnostics().metadata_rejections, 4);
        assert_eq!(backend.diagnostics().room_count, 0);
        publish.connection_id = "valid".to_owned();
        backend.publish(publish, 1_001).unwrap();
    }

    #[test]
    fn authenticated_identity_owns_session_user_and_custom_keys() {
        let backend = LocalEphemeralBackend::new();
        let mut users = collection();
        users.name = "userPresence".to_owned();
        users.key_mode = KeyMode::User;
        backend.register_collection(users).unwrap();

        let scope = scope();
        let mut publish = PublishRequest {
            collection: "userPresence".to_owned(),
            scope: scope.clone(),
            connection_id: "conn-a".to_owned(),
            session_id: None,
            user_id: Some("user-a".to_owned()),
            custom_key: None,
            value: b"a".to_vec(),
            ttl_ms: None,
            auth: AuthContext {
                user_id: Some("user-a".to_owned()),
                ..auth_for(&scope)
            },
        };
        backend.publish(publish.clone(), 1_000).unwrap();

        publish.connection_id = "conn-b".to_owned();
        publish.auth.user_id = Some("user-b".to_owned());
        let error = backend
            .publish(publish.clone(), 1_001)
            .expect_err("caller-supplied user-a must not override authenticated user-b");
        assert_eq!(error.code, EphemeralErrorCode::Unauthorized);

        let delete = DeleteRequest {
            collection: publish.collection.clone(),
            scope: scope.clone(),
            connection_id: "conn-b".to_owned(),
            session_id: None,
            user_id: Some("user-a".to_owned()),
            custom_key: None,
            expected_scope_epoch: None,
            expected_entry_generation: None,
            auth: publish.auth.clone(),
        };
        assert_eq!(
            backend.delete(delete, 1_002).unwrap_err().code,
            EphemeralErrorCode::Unauthorized
        );

        let mut custom = collection();
        custom.name = "customPresence".to_owned();
        custom.key_mode = KeyMode::Custom;
        backend.register_collection(custom).unwrap();
        let custom_publish = |connection: &str, value: &[u8]| PublishRequest {
            collection: "customPresence".to_owned(),
            scope: scope.clone(),
            connection_id: connection.to_owned(),
            session_id: None,
            user_id: None,
            custom_key: Some("shared-name".to_owned()),
            value: value.to_vec(),
            ttl_ms: None,
            auth: auth_for(&scope),
        };
        backend
            .publish(custom_publish("conn-a", b"a"), 1_003)
            .unwrap();
        assert_eq!(
            backend
                .publish(custom_publish("conn-b", b"b"), 1_004)
                .unwrap_err()
                .code,
            EphemeralErrorCode::Unauthorized,
            "custom keys are connection-owned until key-specific auth exists"
        );
        assert_eq!(
            backend
                .delete(
                    DeleteRequest {
                        collection: "customPresence".to_owned(),
                        scope,
                        connection_id: "conn-b".to_owned(),
                        session_id: None,
                        user_id: None,
                        custom_key: Some("shared-name".to_owned()),
                        expected_scope_epoch: None,
                        expected_entry_generation: None,
                        auth: publish.auth,
                    },
                    1_005,
                )
                .unwrap_err()
                .code,
            EphemeralErrorCode::Unauthorized
        );
    }

    #[test]
    fn deleting_one_custom_key_keeps_disconnect_ownership_for_the_rest() {
        let backend = LocalEphemeralBackend::new();
        let mut custom = collection();
        custom.name = "customPresence".to_owned();
        custom.key_mode = KeyMode::Custom;
        backend.register_collection(custom).unwrap();
        let scope = scope();
        let publish = |key: &str| PublishRequest {
            collection: "customPresence".to_owned(),
            scope: scope.clone(),
            connection_id: "publisher".to_owned(),
            session_id: None,
            user_id: None,
            custom_key: Some(key.to_owned()),
            value: key.as_bytes().to_vec(),
            ttl_ms: None,
            auth: auth_for(&scope),
        };
        backend.publish(publish("first"), 1_000).unwrap();
        backend.publish(publish("second"), 1_001).unwrap();

        backend
            .delete(
                DeleteRequest {
                    collection: "customPresence".to_owned(),
                    scope: scope.clone(),
                    connection_id: "publisher".to_owned(),
                    session_id: None,
                    user_id: None,
                    custom_key: Some("first".to_owned()),
                    expected_scope_epoch: None,
                    expected_entry_generation: None,
                    auth: auth_for(&scope),
                },
                1_002,
            )
            .unwrap();
        assert_eq!(backend.diagnostics().entry_count, 1);
        assert!(
            lock(&backend.shared.connection_rooms)
                .get("publisher")
                .is_some_and(|rooms| !rooms.is_empty()),
            "the remaining custom key must keep the disconnect reverse-index edge"
        );

        backend.disconnect("publisher", 1_003);
        assert_eq!(
            backend.diagnostics().entry_count,
            0,
            "disconnect must reclaim the owner's final custom key"
        );
    }

    #[test]
    fn reverse_index_is_bounded_by_current_membership_not_lifetime_churn() {
        let backend = LocalEphemeralBackend::with_limits(EphemeralStoreLimits {
            max_active_rooms: 1,
            ..EphemeralStoreLimits::default()
        });
        let mut cursors = EphemeralCollection::local_cursor("cursors", "boardId");
        cursors.sustained_hz = 1_000_000;
        cursors.burst = 1_000_000;
        backend.register_collection(cursors).unwrap();

        let request = |connection: &str, board: String| SubscribeRequest {
            collection: "cursors".to_owned(),
            scope: Scope::from_pairs([("boardId", board)]),
            connection_id: connection.to_owned(),
            auth: AuthContext::default(),
            since_chunk: None,
        };

        backend
            .subscribe(request("holder", "held".to_owned()), 1_000)
            .unwrap();
        for n in 0..1_000 {
            assert_eq!(
                backend
                    .subscribe(request("failed", format!("failed-{n}")), 1_001)
                    .unwrap_err()
                    .code,
                EphemeralErrorCode::RoomLimitExceeded
            );
        }
        assert!(
            !lock(&backend.shared.connection_rooms).contains_key("failed"),
            "failed room creation must roll back every provisional edge"
        );
        backend
            .unsubscribe(request("holder", "held".to_owned()))
            .unwrap();

        for n in 0..1_000 {
            let request = request("churn", format!("room-{n}"));
            backend.subscribe(request.clone(), 2_000).unwrap();
            backend.unsubscribe(request).unwrap();
        }
        assert!(
            !lock(&backend.shared.connection_rooms).contains_key("churn"),
            "subscribe/unsubscribe churn must leave no lifetime-monotone index"
        );
        assert_eq!(backend.diagnostics().room_count, 0);
    }

    #[test]
    fn reverse_index_cleanup_linearizes_before_concurrent_room_reuse() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("race"), 1_000).unwrap();
        let room_id = room();
        let room_arc = lock(&backend.shared.rooms)
            .get(&room_id)
            .cloned()
            .expect("subscribed room exists");

        // Leave an unused current room, then remove the old edge so the test
        // can observe exactly when the racing subscribe provisions its edge.
        assert!(lock(&room_arc).subscribers.remove("race").is_some());
        lock(&backend.shared.connection_rooms).remove("race");

        let (observed_tx, observed_rx) = std::sync::mpsc::channel();
        let (resume_tx, resume_rx) = std::sync::mpsc::channel();
        let cleanup_backend = backend.clone();
        let cleanup_room = room_id.clone();
        let cleanup = std::thread::spawn(move || {
            cleanup_backend.unindex_connection_room_if_unused_with_observation(
                "race",
                &cleanup_room,
                || {
                    observed_tx.send(()).unwrap();
                    resume_rx.recv().unwrap();
                },
            );
        });
        observed_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("cleanup reached the membership/index boundary");

        // Cleanup is paused after observing the room but still owns the room
        // lock. The reuse can provision its edge, but cannot install room
        // authority until cleanup has removed that provisional edge.
        let reuse_backend = backend.clone();
        let reuse = std::thread::spawn(move || {
            reuse_backend
                .subscribe(subscribe_request("race"), 1_001)
                .unwrap()
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
        while !lock(&backend.shared.connection_rooms)
            .get("race")
            .is_some_and(|rooms| rooms.contains(&room_id))
        {
            assert!(
                std::time::Instant::now() < deadline,
                "racing subscribe did not provision its reverse-index edge"
            );
            std::thread::yield_now();
        }

        resume_tx.send(()).unwrap();
        cleanup.join().unwrap();
        reuse.join().unwrap();

        assert!(
            lock(&backend.shared.connection_rooms)
                .get("race")
                .is_some_and(|rooms| rooms.contains(&room_id)),
            "successful reuse must reassert an edge that cleanup cannot later delete"
        );
        backend.disconnect("race", 1_002);
        assert_eq!(backend.diagnostics().subscriber_count, 0);
    }

    #[test]
    fn retired_room_index_reconciliation_preserves_same_id_replacement() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend
            .publish(publish_request("old", b"old"), 1_000)
            .unwrap();
        let room_id = room();

        backend.reset_runtime_state();
        backend
            .publish(publish_request("replacement", b"new"), 1_001)
            .unwrap();

        // Deterministically model the final reconciliation step of a wipe
        // that snapped the old RoomId before this replacement landed. It must
        // inspect the current incarnation, not delete by RoomId alone.
        backend.reconcile_connection_room_index(&room_id);
        assert!(
            lock(&backend.shared.connection_rooms)
                .get("replacement")
                .is_some_and(|rooms| rooms.contains(&room_id)),
            "same-id replacement must remain reachable by disconnect"
        );
        backend.disconnect("replacement", 1_002);
        assert_eq!(backend.diagnostics().entry_count, 0);
    }

    fn first_ephemeral(messages: Vec<RealtimeEnvelope>) -> EphemeralMessage {
        messages
            .into_iter()
            .find_map(|message| match message {
                RealtimeEnvelope::Ephemeral(message) => Some(message),
                RealtimeEnvelope::Durable(_) => None,
            })
            .expect("expected ephemeral message")
    }

    fn drain_through_test_sink(
        backend: &LocalEphemeralBackend,
        connection_id: &str,
    ) -> Vec<RealtimeEnvelope> {
        backend
            .drain_outbox_for_send(connection_id)
            .into_iter()
            .map(AdmittedRealtimeEnvelope::into_parts)
            .map(|(envelope, permit)| {
                drop(permit);
                envelope
            })
            .collect()
    }

    /// LLP 0032 S5.D6 — a connection's rate buckets are dropped on disconnect,
    /// not leaked forever.
    #[test]
    fn s5_d6_disconnect_clears_rate_buckets() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();

        backend
            .publish(publish_request("a", b"cursor"), 1_000)
            .unwrap();
        assert!(
            lock(&backend.shared.rate_buckets).contains_key("a"),
            "publishing should create a rate bucket for the connection"
        );

        backend.disconnect("a", 1_100);
        assert!(
            !lock(&backend.shared.rate_buckets).contains_key("a"),
            "disconnect must drop the connection's rate buckets"
        );
    }

    /// Mint-only terminal retirement owns the readable id as a whole. Cleanup
    /// removes rate/room/owned-entry/outbox residue but must leave the exact
    /// typed notifier event installed for the socket writer.
    #[test]
    fn terminal_retired_disconnect_clears_whole_id_without_erasing_typed_event() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let notifier = backend.delivery_notifier();
        let (generation, _waker) = notifier
            .register_bound("terminal-retired", "grant-terminal")
            .unwrap();
        backend
            .publish(publish_request("terminal-retired", b"cursor"), 1_000)
            .unwrap();
        backend
            .subscribe(subscribe_request("terminal-retired"), 1_001)
            .unwrap();
        backend.enqueue_durable("terminal-retired", b"queued".to_vec());
        assert!(lock(&backend.shared.rate_buckets).contains_key("terminal-retired"));
        assert!(lock(&backend.shared.outboxes).contains_key("terminal-retired"));

        let event = DeliveryTerminalEvent {
            code: LiveAuthErrorCode::SessionExpired,
            reason: LiveAuthErrorReason::Revoked,
            authority_disposition: LiveAuthorityDisposition::DurableDelete,
            close_by: std::time::Instant::now() + std::time::Duration::from_secs(5),
        };
        assert!(notifier.terminalize_bound("terminal-retired", "grant-terminal", event,));
        backend.disconnect_terminal_retired("terminal-retired", 1_100);

        assert_eq!(
            notifier.terminal_if_current("terminal-retired", generation),
            Some(event),
            "whole-ID cleanup preserves the exact typed terminal event"
        );
        assert!(!lock(&backend.shared.rate_buckets).contains_key("terminal-retired"));
        assert!(!lock(&backend.shared.outboxes).contains_key("terminal-retired"));
        assert!(!lock(&backend.shared.connection_rooms).contains_key("terminal-retired"));
        let diagnostics = backend.diagnostics();
        assert_eq!(diagnostics.entry_count, 0, "owned entry is removed");
        assert_eq!(diagnostics.subscriber_count, 0, "subscriber is removed");
    }

    /// ENG-23348 — disconnect visits only the rooms in the connection's
    /// reverse index, not every room in the store: an unrelated room's
    /// expired entry is untouched by the disconnect (no sweep reached it)
    /// and is later removed by `cleanup_expired` through the expiry index.
    #[test]
    fn disconnect_visits_only_the_connections_rooms() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();

        // Room board-1: an entry owned by connection "x".
        backend
            .publish(publish_request("x", b"cursor"), 1_000)
            .unwrap();

        // Room board-2: connection "y" subscribes; it never touches board-1.
        let scope_b = Scope::from_pairs([("boardId", "board-2")]);
        backend
            .subscribe(
                SubscribeRequest {
                    collection: "boardCursors".to_owned(),
                    auth: auth_for(&scope_b),
                    scope: scope_b,
                    connection_id: "y".to_owned(),
                    since_chunk: None,
                },
                1_001,
            )
            .unwrap();

        // Well past board-1's TTL: a full-store disconnect sweep would expire
        // the entry here. The indexed disconnect must not reach board-1.
        backend.disconnect("y", 60_000);
        let diag = backend.diagnostics();
        assert_eq!(
            diag.expired_entries, 0,
            "disconnect of an unrelated connection must not sweep other rooms"
        );
        assert_eq!(
            diag.entry_count, 1,
            "board-1's (expired) entry is cleanup_expired's job, not disconnect's"
        );
        assert!(
            !lock(&backend.shared.connection_rooms).contains_key("y"),
            "disconnect must consume the connection's room index"
        );

        // The expiry index still owns the expired entry's removal.
        backend.cleanup_expired(60_000);
        let diag = backend.diagnostics();
        assert_eq!(diag.expired_entries, 1);
        assert_eq!(diag.entry_count, 0);
    }

    /// ENG-23348 — the reverse index records subscribe and publish edges and
    /// disconnect still tears down state in every indexed room, including
    /// rooms the connection only published into.
    #[test]
    fn connection_room_index_covers_publish_only_rooms() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();

        // "a" publishes into board-1 (never subscribes) and subscribes to
        // board-2 (never publishes).
        backend
            .publish(publish_request("a", b"cursor"), 1_000)
            .unwrap();
        let scope_b = Scope::from_pairs([("boardId", "board-2")]);
        backend
            .subscribe(
                SubscribeRequest {
                    collection: "boardCursors".to_owned(),
                    auth: auth_for(&scope_b),
                    scope: scope_b,
                    connection_id: "a".to_owned(),
                    since_chunk: None,
                },
                1_001,
            )
            .unwrap();
        assert_eq!(
            lock(&backend.shared.connection_rooms)
                .get("a")
                .map(BTreeSet::len),
            Some(2),
            "both the publish-only and subscribe-only rooms must be indexed"
        );

        backend.disconnect("a", 1_100);
        // Both rooms are torn down: the owned entry is removed, the
        // registration dropped, and both empty rooms pruned.
        let diag = backend.diagnostics();
        assert_eq!(diag.disconnected_entries, 1);
        assert_eq!(diag.entry_count, 0);
        assert_eq!(diag.subscriber_count, 0);
        assert_eq!(diag.room_count, 0);
        assert!(!lock(&backend.shared.connection_rooms).contains_key("a"));
    }

    #[test]
    fn subscriber_gets_snapshot_then_live_cursor_update() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();

        let published = backend
            .publish(publish_request("a", b"{x:1}"), 1_000)
            .unwrap();
        let snapshot = backend.subscribe(subscribe_request("b"), 1_001).unwrap();

        let mut overlay = ClientEphemeralOverlay::default();
        assert_eq!(overlay.apply(&snapshot), OverlayApply::Applied);
        assert_eq!(
            overlay
                .get(&published.room, &EntryKey("a".to_owned()))
                .unwrap()
                .value,
            b"{x:1}".to_vec()
        );

        backend
            .publish(publish_request("a", b"{x:2}"), 1_010)
            .unwrap();
        let message = first_ephemeral(backend.drain_outbox("b"));
        assert_eq!(overlay.apply(&message), OverlayApply::Applied);
        assert_eq!(
            overlay
                .get(&published.room, &EntryKey("a".to_owned()))
                .unwrap()
                .value,
            b"{x:2}".to_vec()
        );
    }

    #[test]
    fn ttl_expiry_removes_entry_and_does_not_touch_durable_lane() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let published = backend
            .publish(publish_request("a", b"cursor"), 1_000)
            .unwrap();
        let snapshot = backend.subscribe(subscribe_request("b"), 1_001).unwrap();

        let mut overlay = ClientEphemeralOverlay::default();
        overlay.apply(&snapshot);

        backend.cleanup_expired(6_001);
        let messages = backend.drain_outbox("b");
        assert!(
            messages
                .iter()
                .all(|message| message.lane() == RealtimeLane::EphemeralLatest)
        );
        let remove = first_ephemeral(messages);
        assert!(matches!(
            remove,
            EphemeralMessage::Remove {
                reason: RemoveReason::Expired,
                ..
            }
        ));
        overlay.apply(&remove);
        assert!(
            overlay
                .get(&published.room, &EntryKey("a".to_owned()))
                .is_none()
        );
    }

    /// @ref LLP 0184#p2-controlled-mutations — preview and apply share the
    /// same global bound, while apply uses ordinary expiry fan-out.
    #[test]
    fn bounded_cleanup_previews_then_applies_with_honest_remaining_counts() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend
            .subscribe(subscribe_request("observer"), 1_000)
            .unwrap();
        backend
            .publish(publish_request("a", b"old-a"), 1_000)
            .unwrap();
        backend
            .publish(publish_request("b", b"old-b"), 1_000)
            .unwrap();
        backend
            .publish(publish_request("c", b"fresh"), 3_000)
            .unwrap();
        backend.drain_outbox("observer");

        let preview = backend.cleanup_expired_bounded(6_000, 1, true);
        assert_eq!(
            preview.counts,
            EphemeralCleanupCounts {
                examined: 3,
                eligible: 2,
                would_delete: 1,
                deleted: 0,
                remaining: 1,
            }
        );
        assert!(preview.truncated);
        assert!(preview.complete);
        assert_eq!(preview.collections.len(), 1);
        assert_eq!(preview.collections[0].collection, "boardCursors");
        assert_eq!(preview.collections[0].rooms.len(), 1);
        assert!(
            preview.collections[0].rooms[0]
                .room_digest
                .starts_with("sha256:")
        );
        assert!(backend.drain_outbox("observer").is_empty());
        assert_eq!(backend.diagnostics().entry_count, 3);

        let first = backend.cleanup_expired_bounded(6_000, 1, false);
        assert_eq!(first.counts.deleted, 1);
        assert_eq!(first.counts.remaining, 1);
        assert!(first.truncated);
        let remove = first_ephemeral(backend.drain_outbox("observer"));
        assert!(matches!(
            remove,
            EphemeralMessage::Remove {
                reason: RemoveReason::Expired,
                ..
            }
        ));

        let second = backend.cleanup_expired_bounded(6_000, 10, false);
        assert_eq!(second.counts.deleted, 1);
        assert_eq!(second.counts.remaining, 0);
        assert!(!second.truncated);
        assert_eq!(backend.diagnostics().entry_count, 1);
        assert!(matches!(
            first_ephemeral(backend.drain_outbox("observer")),
            EphemeralMessage::Remove {
                reason: RemoveReason::Expired,
                ..
            }
        ));
    }

    #[test]
    fn disconnect_cleans_connection_owned_entry() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let published = backend
            .publish(publish_request("a", b"cursor"), 1_000)
            .unwrap();
        backend.subscribe(subscribe_request("b"), 1_001).unwrap();

        backend.disconnect("a", 1_100);
        let remove = first_ephemeral(backend.drain_outbox("b"));

        assert!(matches!(
            remove,
            EphemeralMessage::Remove {
                reason: RemoveReason::Disconnected,
                ..
            }
        ));
        let snapshot = backend.subscribe(subscribe_request("c"), 1_101).unwrap();
        assert!(
            matches!(snapshot, EphemeralMessage::Snapshot { entries, .. } if entries.is_empty())
        );
        assert_eq!(published.key, EntryKey("a".to_owned()));
    }

    /// ENG-23426 — the generation-guarded wipe re-verifies ownership at every
    /// destructive step: once a reconnect re-registers the connection id, a
    /// stalled teardown must abort instead of destroying the new socket's
    /// room subscription, published entries, queued outbox messages, and
    /// reverse-index membership.
    #[test]
    fn guarded_disconnect_aborts_once_the_connection_reregisters() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let notifier = backend.delivery_notifier();

        // The reconnected socket's fresh state: registration first (the WS
        // task registers at upgrade, before any subscribe), then a room
        // subscription and a published presence entry.
        let (_generation, _waker) = notifier.register("a").unwrap();
        backend
            .publish(publish_request("a", b"cursor"), 1_000)
            .unwrap();
        backend.subscribe(subscribe_request("a"), 1_001).unwrap();
        backend
            .publish(publish_request("a", b"cursor-2"), 1_002)
            .unwrap();

        // The stalled old task's teardown (it passed `unregister` before the
        // reconnect) reaches the destructive act late: it must walk away.
        assert!(
            !backend.disconnect_guarded("a", 1_100),
            "a wipe racing a re-registration must abort"
        );

        // The reverse index still reaches the connection's room, so the
        // eventual final disconnect can clean it (ENG-23348 invariant).
        assert!(
            lock(&backend.shared.connection_rooms)
                .get("a")
                .is_some_and(|rooms| !rooms.is_empty()),
            "the reverse index must survive the aborted wipe"
        );

        // The new socket's subscription still receives fan-out, its entry
        // survived, and its queued update was not destroyed with the outbox.
        let update = first_ephemeral(backend.drain_outbox("a"));
        assert!(
            matches!(update, EphemeralMessage::Upsert { .. }),
            "queued update must survive the aborted wipe, got {update:?}"
        );
        let snapshot = backend.subscribe(subscribe_request("b"), 1_101).unwrap();
        assert!(
            matches!(&snapshot, EphemeralMessage::Snapshot { entries, .. } if entries.len() == 1),
            "the published entry must survive the aborted wipe"
        );
        backend
            .publish(publish_request("b", b"peer"), 1_102)
            .unwrap();
        assert!(
            matches!(
                first_ephemeral(backend.drain_outbox("a")),
                EphemeralMessage::Upsert { .. }
            ),
            "the room subscription must survive the aborted wipe"
        );
    }

    /// ENG-23426 — with no re-registration the guarded wipe behaves exactly
    /// like the unconditional disconnect: subscriber, owned entries, outbox,
    /// rate buckets, and reverse index are all torn down.
    #[test]
    fn guarded_disconnect_without_reregistration_wipes_everything() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();

        backend
            .publish(publish_request("a", b"cursor"), 1_000)
            .unwrap();
        backend.subscribe(subscribe_request("a"), 1_001).unwrap();

        assert!(backend.disconnect_guarded("a", 1_100));

        assert!(
            !lock(&backend.shared.outboxes).contains_key("a"),
            "outbox must be removed"
        );
        assert!(
            !lock(&backend.shared.rate_buckets).contains_key("a"),
            "rate buckets must be removed"
        );
        assert!(
            !lock(&backend.shared.connection_rooms).contains_key("a"),
            "reverse index must be consumed"
        );
        let snapshot = backend.subscribe(subscribe_request("b"), 1_101).unwrap();
        assert!(
            matches!(snapshot, EphemeralMessage::Snapshot { entries, .. } if entries.is_empty()),
            "owned entries must be removed"
        );
    }

    /// LLP 0032 L1 — a never-draining durable subscriber cannot accumulate
    /// unbounded query-result payloads: the lane bounds and collapses to a
    /// single resync signal, and drains reset it.
    #[test]
    fn l1_durable_lane_overflow_bounds_and_signals_resync() {
        let backend = LocalEphemeralBackend::new();
        for n in 0..5_000 {
            backend.enqueue_durable("conn", format!("{{\"n\":{n}}}").into_bytes());
        }

        let drained = backend.drain_outbox("conn");
        assert_eq!(
            drained.len(),
            1,
            "overflow must collapse the durable backlog to one signal"
        );
        let RealtimeEnvelope::Durable(message) = &drained[0] else {
            panic!("expected a durable resync signal");
        };
        let payload: serde_json::Value = serde_json::from_slice(&message.payload).unwrap();
        assert_eq!(payload["kind"], "resync_required");
        assert_eq!(payload["reason"], "outbox_overflow");
        assert!(backend.diagnostics().outbox_overflows >= 1);

        // After draining, the queue accepts fresh messages again.
        backend.enqueue_durable("conn", b"{\"fresh\":1}".to_vec());
        let after = backend.drain_outbox("conn");
        assert_eq!(after.len(), 1);
        let RealtimeEnvelope::Durable(message) = &after[0] else {
            panic!("expected the fresh message");
        };
        let payload: serde_json::Value = serde_json::from_slice(&message.payload).unwrap();
        assert_eq!(payload["fresh"], 1);
    }

    /// LLP 0032 L4 — gauges are computed on demand and stay accurate across
    /// operations without a per-op full recompute.
    #[test]
    fn l4_gauges_are_accurate_on_demand() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("b"), 1_000).unwrap();
        backend
            .publish(publish_request("a", b"cursor"), 1_001)
            .unwrap();

        let diag = backend.diagnostics();
        assert_eq!(diag.room_count, 1);
        assert_eq!(diag.entry_count, 1);
        assert_eq!(diag.subscriber_count, 1);
        assert!(diag.value_bytes > 0);
        assert_eq!(diag.active_rooms.len(), 1);
        assert_eq!(diag.pending_ephemeral_keys, 1);

        // Disconnecting the publisher removes its owned entry; the gauges
        // reflect it on the next on-demand read.
        backend.disconnect("a", 1_100);
        let diag = backend.diagnostics();
        assert_eq!(diag.entry_count, 0);
        assert_eq!(diag.subscriber_count, 1);
    }

    #[test]
    fn high_frequency_updates_are_coalesced_by_key() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("b"), 1_000).unwrap();

        backend
            .publish(publish_request("a", b"one"), 1_001)
            .unwrap();
        backend
            .publish(publish_request("a", b"two"), 1_002)
            .unwrap();
        backend
            .publish(publish_request("a", b"three"), 1_003)
            .unwrap();

        let messages = backend.drain_outbox("b");
        let ephemeral = messages
            .into_iter()
            .filter(|message| message.lane() == RealtimeLane::EphemeralLatest)
            .collect::<Vec<_>>();
        assert_eq!(ephemeral.len(), 1);
        let message = first_ephemeral(ephemeral);
        assert!(matches!(
            message,
            EphemeralMessage::Upsert { entry, .. } if entry.value == b"three".to_vec()
        ));
        assert!(backend.diagnostics().coalesced_updates >= 2);
    }

    #[test]
    fn oversize_and_rate_limited_publishes_are_rejected_without_snapshot_change() {
        let backend = LocalEphemeralBackend::new();
        let mut collection = collection();
        collection.max_value_bytes = 4;
        collection.burst = 2;
        collection.sustained_hz = 1;
        backend.register_collection(collection).unwrap();

        let oversize = backend
            .publish(publish_request("a", b"too-large"), 1_000)
            .unwrap_err();
        assert_eq!(oversize.code, EphemeralErrorCode::ValueTooLarge);

        backend.publish(publish_request("a", b"1"), 1_000).unwrap();
        backend.publish(publish_request("a", b"2"), 1_000).unwrap();
        let rate_limited = backend
            .publish(publish_request("a", b"3"), 1_000)
            .unwrap_err();
        assert_eq!(rate_limited.code, EphemeralErrorCode::RateLimited);

        let snapshot = backend.subscribe(subscribe_request("b"), 1_001).unwrap();
        assert!(
            matches!(snapshot, EphemeralMessage::Snapshot { entries, .. } if entries.len() == 1)
        );
    }

    #[test]
    fn overlay_rejects_stale_upserts() {
        let room = room();
        let mut overlay = ClientEphemeralOverlay::default();
        overlay.apply(&EphemeralMessage::Snapshot {
            ephemeral_authority_instance: None,
            room: room.clone(),
            scope_epoch: 1,
            room_authority_generation: 0,
            high_water_version: 2,
            entries: vec![EphemeralEntry {
                key: EntryKey("a".to_owned()),
                value: b"new".to_vec(),
                received_at_ms: 2,
                expires_at_ms: 10,
                scope_epoch: 1,
                entry_version: 2,
            }],
            stream_resume: None,
        });

        let stale = EphemeralMessage::Upsert {
            ephemeral_authority_instance: None,
            room: room.clone(),
            room_authority_generation: 0,
            entry: EphemeralEntry {
                key: EntryKey("a".to_owned()),
                value: b"old".to_vec(),
                received_at_ms: 1,
                expires_at_ms: 10,
                scope_epoch: 1,
                entry_version: 1,
            },
        };

        assert_eq!(overlay.apply(&stale), OverlayApply::IgnoredStale);
        assert_eq!(
            overlay.get(&room, &EntryKey("a".to_owned())).unwrap().value,
            b"new".to_vec()
        );
    }

    #[test]
    fn empty_snapshot_high_water_clears_state_and_blocks_delayed_upsert() {
        let room = room();
        let key = EntryKey("a".to_owned());
        let entry = |version, value: &[u8]| EphemeralEntry {
            key: key.clone(),
            value: value.to_vec(),
            received_at_ms: version,
            expires_at_ms: 10_000,
            scope_epoch: 7,
            entry_version: version,
        };
        let mut overlay = ClientEphemeralOverlay::default();
        assert_eq!(
            overlay.apply(&EphemeralMessage::Snapshot {
                ephemeral_authority_instance: None,
                room: room.clone(),
                scope_epoch: 7,
                room_authority_generation: 0,
                high_water_version: 1,
                entries: vec![entry(1, b"present")],
                stream_resume: None,
            }),
            OverlayApply::Applied
        );
        assert_eq!(
            overlay.apply(&EphemeralMessage::Snapshot {
                ephemeral_authority_instance: None,
                room: room.clone(),
                scope_epoch: 7,
                room_authority_generation: 0,
                high_water_version: 2,
                entries: Vec::new(),
                stream_resume: None,
            }),
            OverlayApply::Applied
        );
        assert!(overlay.room_entries(&room).is_empty());
        assert_eq!(
            overlay.apply(&EphemeralMessage::Upsert {
                ephemeral_authority_instance: None,
                room: room.clone(),
                room_authority_generation: 0,
                entry: entry(2, b"delayed"),
            }),
            OverlayApply::IgnoredStale
        );
        assert!(overlay.room_entries(&room).is_empty());
    }

    #[test]
    fn delete_high_water_blocks_same_version_resurrection() {
        let room = room();
        let key = EntryKey("a".to_owned());
        let mut overlay = ClientEphemeralOverlay::default();
        overlay.apply(&EphemeralMessage::Snapshot {
            ephemeral_authority_instance: None,
            room: room.clone(),
            scope_epoch: 1,
            room_authority_generation: 0,
            high_water_version: 1,
            entries: vec![EphemeralEntry {
                key: key.clone(),
                value: b"present".to_vec(),
                received_at_ms: 1,
                expires_at_ms: 10_000,
                scope_epoch: 1,
                entry_version: 1,
            }],
            stream_resume: None,
        });
        assert_eq!(
            overlay.apply(&EphemeralMessage::Remove {
                ephemeral_authority_instance: None,
                room: room.clone(),
                key: key.clone(),
                scope_epoch: 1,
                room_authority_generation: 0,
                entry_version: 2,
                reason: RemoveReason::Deleted,
            }),
            OverlayApply::Applied
        );
        assert_eq!(
            overlay.apply(&EphemeralMessage::Upsert {
                ephemeral_authority_instance: None,
                room: room.clone(),
                room_authority_generation: 0,
                entry: EphemeralEntry {
                    key: key.clone(),
                    value: b"delayed".to_vec(),
                    received_at_ms: 2,
                    expires_at_ms: 10_000,
                    scope_epoch: 1,
                    entry_version: 2,
                },
            }),
            OverlayApply::IgnoredStale
        );
        assert!(overlay.get(&room, &key).is_none());
    }

    #[test]
    fn coalesced_room_messages_drain_in_entry_version_order() {
        let backend = LocalEphemeralBackend::new();
        let mut definition = collection();
        definition.key_mode = KeyMode::Custom;
        backend.register_collection(definition).unwrap();
        backend
            .subscribe(subscribe_request("observer"), 1_000)
            .unwrap();
        let publish = |key: &str, now_ms| {
            let mut request = publish_request("publisher", key.as_bytes());
            request.custom_key = Some(key.to_owned());
            backend.publish(request, now_ms).unwrap();
        };
        publish("z", 1_001);
        publish("a", 1_002);
        let versions = backend
            .drain_outbox("observer")
            .into_iter()
            .filter_map(|message| match message {
                RealtimeEnvelope::Ephemeral(message) => message.entry_version(),
                RealtimeEnvelope::Durable(_) => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(versions, vec![1, 2]);
    }

    #[test]
    fn full_definition_and_exact_scope_validation_fail_before_state_change() {
        let backend = LocalEphemeralBackend::new();
        let valid = collection();
        backend.replace_collections(vec![valid.clone()]).unwrap();

        let mut invalid = valid.clone();
        invalid.max_ttl_ms = LOCAL_HARD_MAX_TTL_MS + 1;
        let error = backend
            .replace_collections(vec![valid.clone(), invalid])
            .expect_err("duplicate/invalid definitions must reject atomically");
        assert_eq!(
            error.code,
            EphemeralErrorCode::IncompatibleCollectionDefinition
        );

        let invalid_auth = valid.clone().require_room_permission("board:administrator");
        assert_eq!(
            backend
                .replace_collections(vec![invalid_auth])
                .expect_err("ambiguous permission prefixes must reject")
                .code,
            EphemeralErrorCode::IncompatibleCollectionDefinition
        );

        let mut extra_scope = publish_request("publisher", b"cursor");
        extra_scope
            .scope
            .0
            .insert("attacker".to_owned(), "shadow".to_owned());
        assert_eq!(
            backend.publish(extra_scope, 1_000).unwrap_err().code,
            EphemeralErrorCode::InvalidScope
        );
        backend
            .publish(publish_request("publisher", b"valid"), 1_001)
            .expect("the prior valid definition must remain installed");
    }

    #[test]
    fn durable_lane_drains_before_ephemeral_lane() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("b"), 1_000).unwrap();
        backend
            .publish(publish_request("a", b"cursor"), 1_001)
            .unwrap();
        backend.enqueue_durable("b", b"mutation-ack".to_vec());

        let messages = backend.drain_outbox("b");
        assert_eq!(messages[0].lane(), RealtimeLane::Durable);
        assert_eq!(messages[1].lane(), RealtimeLane::EphemeralLatest);
    }

    #[test]
    fn unauthorized_subscribe_is_rejected() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let mut request = subscribe_request("b");
        request.auth = AuthContext::default();

        let error = backend.subscribe(request, 1_000).unwrap_err();
        assert_eq!(error.code, EphemeralErrorCode::Unauthorized);
    }

    #[test]
    fn retained_metadata_has_independent_byte_and_cardinality_bounds() {
        let backend = LocalEphemeralBackend::new();
        let mut custom = collection();
        custom.key_mode = KeyMode::Custom;
        backend.register_collection(custom).unwrap();

        let mut huge_scope = publish_request("publisher", b"x");
        huge_scope.scope =
            Scope::from_pairs([("boardId", "s".repeat(MAX_EPHEMERAL_SCOPE_VALUE_BYTES + 1))]);
        assert_eq!(
            backend.publish(huge_scope, 1_000).unwrap_err().code,
            EphemeralErrorCode::MetadataTooLarge
        );

        let mut huge_key = publish_request("publisher", b"x");
        huge_key.custom_key = Some("k".repeat(MAX_EPHEMERAL_CUSTOM_KEY_BYTES + 1));
        assert_eq!(
            backend.publish(huge_key, 1_000).unwrap_err().code,
            EphemeralErrorCode::MetadataTooLarge
        );

        let mut huge_auth = subscribe_request("observer");
        huge_auth.auth.permissions = (0..=MAX_EPHEMERAL_PERMISSIONS)
            .map(|index| format!("permission:{index}"))
            .collect();
        assert_eq!(
            backend.subscribe(huge_auth, 1_000).unwrap_err().code,
            EphemeralErrorCode::MetadataTooLarge
        );

        assert_eq!(backend.diagnostics().room_count, 0);
    }

    #[test]
    fn overlay_prunes_expired_entries_in_memory() {
        let room = room();
        let mut overlay = ClientEphemeralOverlay::default();
        overlay.apply(&EphemeralMessage::Snapshot {
            ephemeral_authority_instance: None,
            room: room.clone(),
            scope_epoch: 1,
            room_authority_generation: 0,
            high_water_version: 1,
            entries: vec![EphemeralEntry {
                key: EntryKey("a".to_owned()),
                value: b"cursor".to_vec(),
                received_at_ms: 1,
                expires_at_ms: 5,
                scope_epoch: 1,
                entry_version: 1,
            }],
            stream_resume: None,
        });

        overlay.prune_expired(5);
        assert!(overlay.room_entries(&room).is_empty());
    }

    #[test]
    fn missing_routing_field_is_rejected() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();

        let invalid_scope = Scope::from_pairs([("notBoardId", "board-1")]);
        let request = PublishRequest {
            collection: "boardCursors".to_owned(),
            auth: AuthContext::default().with_room_permission("board", &invalid_scope),
            scope: invalid_scope,
            connection_id: "a".to_owned(),
            session_id: None,
            user_id: None,
            custom_key: None,
            value: b"cursor".to_vec(),
            ttl_ms: None,
        };

        let error = backend.publish(request, 1_000).unwrap_err();
        assert_eq!(error.code, EphemeralErrorCode::InvalidScope);
    }

    #[test]
    fn user_owned_entry_survives_until_last_publisher_disconnects() {
        let backend = LocalEphemeralBackend::new();
        let mut collection = collection();
        collection.key_mode = KeyMode::User;
        backend.register_collection(collection).unwrap();

        let mut first = publish_request("tab-a", b"online");
        first.user_id = Some("user-1".to_owned());
        first.auth.user_id = Some("user-1".to_owned());
        let published = backend.publish(first, 1_000).unwrap();

        let mut second = publish_request("tab-b", b"online-again");
        second.user_id = Some("user-1".to_owned());
        second.auth.user_id = Some("user-1".to_owned());
        backend.publish(second, 1_001).unwrap();

        backend.disconnect("tab-a", 1_010);
        let snapshot = backend
            .subscribe(subscribe_request("observer"), 1_011)
            .unwrap();
        assert!(
            matches!(snapshot, EphemeralMessage::Snapshot { entries, .. } if entries.len() == 1)
        );

        backend.disconnect("tab-b", 1_020);
        let remove = first_ephemeral(backend.drain_outbox("observer"));
        assert!(matches!(
            remove,
            EphemeralMessage::Remove {
                reason: RemoveReason::Disconnected,
                ..
            }
        ));
        assert_eq!(published.key, EntryKey("user-1".to_owned()));
    }

    #[test]
    fn queue_overflow_resyncs_every_room_with_dropped_pending_state() {
        let backend = LocalEphemeralBackend::new();
        let mut collection = collection();
        collection.max_pending_ephemeral_keys = 1;
        backend.register_collection(collection).unwrap();

        let scope_one = Scope::from_pairs([("boardId", "one")]);
        let scope_two = Scope::from_pairs([("boardId", "two")]);
        let auth_one = auth_for(&scope_one);
        let auth_two = auth_for(&scope_two);

        backend
            .subscribe(
                SubscribeRequest {
                    collection: "boardCursors".to_owned(),
                    scope: scope_one.clone(),
                    connection_id: "observer".to_owned(),
                    auth: auth_one.clone(),
                    since_chunk: None,
                },
                1_000,
            )
            .unwrap();
        backend
            .subscribe(
                SubscribeRequest {
                    collection: "boardCursors".to_owned(),
                    scope: scope_two.clone(),
                    connection_id: "observer".to_owned(),
                    auth: auth_two.clone(),
                    since_chunk: None,
                },
                1_000,
            )
            .unwrap();

        backend
            .publish(
                PublishRequest {
                    collection: "boardCursors".to_owned(),
                    scope: scope_one,
                    connection_id: "a".to_owned(),
                    session_id: None,
                    user_id: None,
                    custom_key: None,
                    value: b"one".to_vec(),
                    ttl_ms: None,
                    auth: auth_one,
                },
                1_001,
            )
            .unwrap();
        backend
            .publish(
                PublishRequest {
                    collection: "boardCursors".to_owned(),
                    scope: scope_two,
                    connection_id: "b".to_owned(),
                    session_id: None,
                    user_id: None,
                    custom_key: None,
                    value: b"two".to_vec(),
                    ttl_ms: None,
                    auth: auth_two,
                },
                1_002,
            )
            .unwrap();

        let mut messages = Vec::new();
        loop {
            let batch = backend.drain_outbox("observer");
            if batch.is_empty() {
                break;
            }
            messages.extend(batch);
        }
        assert_eq!(messages.len(), 2);
        assert!(messages.into_iter().all(|message| {
            matches!(
                message,
                RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired { .. })
            )
        }));
        assert_eq!(backend.diagnostics().resync_required, 2);
    }

    #[test]
    fn eng_23349_pending_key_cap_is_not_first_outbox_creator_wins() {
        let backend = LocalEphemeralBackend::new();
        let mut collection = EphemeralCollection::local_cursor("boardCursors", "boardId");
        collection.max_pending_ephemeral_keys = 1;
        backend.register_collection(collection).unwrap();
        let scope = Scope::from_pairs([("boardId", "board-1")]);

        // A durable message creates the outbox before the collection-specific
        // ephemeral subscription arrives. The collection's cap must still
        // govern later ephemeral inserts.
        backend.enqueue_durable("observer", b"{\"kind\":\"live_replace\"}".to_vec());
        backend
            .subscribe(
                SubscribeRequest {
                    collection: "boardCursors".to_owned(),
                    scope: scope.clone(),
                    connection_id: "observer".to_owned(),
                    auth: AuthContext::default(),
                    since_chunk: None,
                },
                1_000,
            )
            .unwrap();

        for connection_id in ["pub-a", "pub-b"] {
            backend
                .publish(
                    PublishRequest {
                        collection: "boardCursors".to_owned(),
                        scope: scope.clone(),
                        connection_id: connection_id.to_owned(),
                        session_id: None,
                        user_id: None,
                        custom_key: None,
                        value: connection_id.as_bytes().to_vec(),
                        ttl_ms: None,
                        auth: AuthContext::default(),
                    },
                    1_001,
                )
                .unwrap();
        }

        let mut messages = Vec::new();
        loop {
            let batch = backend.drain_outbox("observer");
            if batch.is_empty() {
                break;
            }
            messages.extend(batch);
        }
        assert!(
            messages
                .iter()
                .any(|message| matches!(message, RealtimeEnvelope::Durable(_))),
            "the durable first-creator message should still drain"
        );
        assert!(
            messages.iter().any(|message| matches!(
                message,
                RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired {
                    reason: ResyncReason::QueueOverflow,
                    ..
                })
            )),
            "the collection's max_pending_ephemeral_keys=1 must force a room resync"
        );
        assert!(
            !messages.iter().any(|message| matches!(
                message,
                RealtimeEnvelope::Ephemeral(EphemeralMessage::Upsert { .. })
            )),
            "overflowed latest-state keys must not drain as if the stream stayed current"
        );
    }

    #[test]
    fn eng_23432_full_overflow_preserves_ephemeral_room_resyncs() {
        let backend = LocalEphemeralBackend::new();
        let mut collection = EphemeralCollection::local_cursor("boardCursors", "boardId");
        collection.max_pending_ephemeral_keys = 1;
        backend.register_collection(collection).unwrap();

        let subscribe = |board: &str| {
            backend
                .subscribe(
                    SubscribeRequest {
                        collection: "boardCursors".to_owned(),
                        scope: Scope::from_pairs([("boardId", board)]),
                        connection_id: "observer".to_owned(),
                        auth: AuthContext::default(),
                        since_chunk: None,
                    },
                    1_000,
                )
                .unwrap();
        };
        for board in ["one", "two", "three"] {
            subscribe(board);
        }

        let publish = |board: &str, connection_id: &str, now_ms: Millis| {
            backend
                .publish(
                    PublishRequest {
                        collection: "boardCursors".to_owned(),
                        scope: Scope::from_pairs([("boardId", board)]),
                        connection_id: connection_id.to_owned(),
                        session_id: None,
                        user_id: None,
                        custom_key: None,
                        value: board.as_bytes().to_vec(),
                        ttl_ms: None,
                        auth: AuthContext::default(),
                    },
                    now_ms,
                )
                .unwrap();
        };

        // The collection cap converts the first two pending room updates into
        // per-room ephemeral resyncs.
        publish("one", "pub-one", 1_001);
        publish("two", "pub-two", 1_002);

        // Then the durable lane overflows the whole outbox. The overflow must
        // preserve those room resyncs instead of replacing them with only a
        // durable connection-wide sentinel.
        for n in 0..=MAX_OUTBOX_BACKLOG {
            backend.enqueue_durable("observer", format!("{{\"n\":{n}}}").into_bytes());
        }

        // A new room update that arrives while the queue is sticky-overflowed
        // must also be represented by a room resync before the drain resets
        // the overflow flag.
        publish("three", "pub-three", 1_003);

        let mut messages = Vec::new();
        loop {
            let batch = backend.drain_outbox("observer");
            if batch.is_empty() {
                break;
            }
            messages.extend(batch);
        }
        assert!(
            messages
                .iter()
                .any(|message| matches!(message, RealtimeEnvelope::Durable(_))),
            "full overflow still emits the durable resync sentinel"
        );
        let resync_rooms = messages
            .iter()
            .filter_map(|message| match message {
                RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired {
                    room,
                    reason: ResyncReason::QueueOverflow,
                    ..
                }) => Some(room.routing_key.clone()),
                _ => None,
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(
            resync_rooms,
            BTreeSet::from([
                "7:boardId=3:one".to_owned(),
                "7:boardId=3:two".to_owned(),
                "7:boardId=5:three".to_owned(),
            ]),
            "every room whose ephemeral lane was dropped must be told to resnapshot"
        );
    }

    #[test]
    fn eng_23347_subscriber_registration_carries_outbox_for_hot_fanout() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend
            .subscribe(subscribe_request("observer"), 1_000)
            .unwrap();

        let room_id = room();
        let room_arc = lock(&backend.shared.rooms)
            .get(&room_id)
            .cloned()
            .expect("room exists");
        let subscriber_outbox = {
            let room = lock(&room_arc);
            room.subscribers
                .get("observer")
                .expect("subscriber registered")
                .outbox
                .clone()
        };
        let mapped_outbox = lock(&backend.shared.outboxes)
            .get("observer")
            .cloned()
            .expect("outbox exists");
        assert!(
            Arc::ptr_eq(&subscriber_outbox, &mapped_outbox),
            "fan-out should use the outbox handle captured at registration"
        );

        backend
            .publish(publish_request("publisher", b"cursor"), 1_001)
            .unwrap();
        assert!(
            !backend.drain_outbox("observer").is_empty(),
            "the captured outbox handle must still receive fan-out"
        );
    }

    /// LLP 0032 L9 / LLP 0026 Phase 2 — every hard limit (entries per room,
    /// aggregate room bytes, subscribers per room, active rooms) rejects with
    /// a structured `RoomLimitExceeded` and leaves the room snapshot exactly
    /// as it was: never a silent eviction. Pruning an emptied room frees
    /// active-room capacity again.
    #[test]
    fn l9_room_limits_reject_never_silently_evict() {
        let scope = Scope::from_pairs([("boardId", "board-1")]);
        let room_id = RoomId {
            collection: "boardCursors".to_owned(),
            routing_key: scope
                .routed_key(&["boardId".to_owned()])
                .expect("routing key"),
            scope,
        };
        let owner = EntryOwner::Connection("pub".to_owned());
        let room_budget = retained_room_identity_bytes(&room_id)
            + retained_owner_bytes(&owner)
            + retained_string_bytes("pub")
            + 2 * MAP_ENTRY_OVERHEAD
            + retained_entry_bytes(&EntryKey("k1".to_owned()), &owner, 3)
            + retained_entry_bytes(&EntryKey("k2".to_owned()), &owner, 3)
            + retained_connection_room_edge_bytes("pub", &room_id)
            + retained_expiry_index_entry_bytes(&room_id)
            + retained_subscriber_bytes("obs-1")
            + retained_auth_context_bytes(&AuthContext::default())
            + retained_connection_room_edge_bytes("obs-1", &room_id);
        let backend = LocalEphemeralBackend::with_limits(EphemeralStoreLimits {
            max_active_rooms: 1,
            max_entries_per_room: 2,
            max_subscribers_per_room: 1,
            max_room_value_bytes: room_budget,
        });
        let mut collection = EphemeralCollection::local_cursor("boardCursors", "boardId");
        collection.key_mode = KeyMode::Custom;
        backend.register_collection(collection).unwrap();

        let publish = |key: &str, value: &[u8], scope_value: &str| PublishRequest {
            collection: "boardCursors".to_owned(),
            scope: Scope::from_pairs([("boardId", scope_value)]),
            connection_id: "pub".to_owned(),
            session_id: None,
            user_id: None,
            custom_key: Some(key.to_owned()),
            value: value.to_vec(),
            ttl_ms: Some(5_000),
            auth: AuthContext::default(),
        };

        backend
            .publish(publish("k1", b"aaa", "board-1"), 1_000)
            .unwrap();
        backend
            .publish(publish("k2", b"bbb", "board-1"), 1_000)
            .unwrap();

        // Entry cap: a third key is rejected.
        let entry_cap = backend
            .publish(publish("k3", b"ccc", "board-1"), 1_000)
            .unwrap_err();
        assert_eq!(entry_cap.code, EphemeralErrorCode::RoomLimitExceeded);

        // Subscriber cap: one subscriber fits, the second is rejected, and a
        // re-subscribe by the existing subscriber stays allowed.
        let subscribe = |connection: &str| SubscribeRequest {
            collection: "boardCursors".to_owned(),
            scope: Scope::from_pairs([("boardId", "board-1")]),
            connection_id: connection.to_owned(),
            auth: AuthContext::default(),
            since_chunk: None,
        };
        backend.subscribe(subscribe("obs-1"), 1_002).unwrap();
        let subscriber_cap = backend.subscribe(subscribe("obs-2"), 1_002).unwrap_err();
        assert_eq!(subscriber_cap.code, EphemeralErrorCode::RoomLimitExceeded);
        backend.subscribe(subscribe("obs-1"), 1_002).unwrap();

        // The byte cap covers retained key/owner/scope/subscriber metadata as
        // well as values. With the exact current footprint admitted, growing
        // one value by even four bytes is rejected without eviction.
        let byte_cap = backend
            .publish(publish("k1", b"seven!!", "board-1"), 1_002)
            .unwrap_err();
        assert_eq!(byte_cap.code, EphemeralErrorCode::RoomLimitExceeded);

        // Active-room cap: a second room cannot be created.
        let room_cap = backend
            .publish(publish("k1", b"ddd", "board-2"), 1_003)
            .unwrap_err();
        assert_eq!(room_cap.code, EphemeralErrorCode::RoomLimitExceeded);

        // No silent eviction anywhere: the room still holds exactly the two
        // original values.
        let snapshot = backend.subscribe(subscribe("obs-1"), 1_004).unwrap();
        let EphemeralMessage::Snapshot { entries, .. } = snapshot else {
            panic!("expected snapshot");
        };
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().any(|entry| entry.value == b"aaa".to_vec()));
        assert!(entries.iter().any(|entry| entry.value == b"bbb".to_vec()));

        let diagnostics = backend.diagnostics();
        assert_eq!(diagnostics.limit_rejections, 4);
        assert_eq!(diagnostics.entry_count, 2);

        // Pruning an emptied room frees active-room capacity: expire board-1's
        // entries, disconnect its subscriber, clean up, and board-2 fits.
        backend.disconnect("obs-1", 7_000);
        backend.cleanup_expired(7_000);
        backend
            .publish(publish("k1", b"ddd", "board-2"), 7_001)
            .expect("pruned room capacity must be reusable");
    }

    /// LLP 0032 L9 — scope epochs are live: a room destroyed (expiry-to-empty
    /// prune) and re-created gets a strictly newer epoch from the store-global
    /// allocator, so a straggling client fails safe to resync instead of
    /// misclassifying fresh entries as stale (`entryVersion` restarted at 1).
    #[test]
    fn l9_recreated_room_gets_a_fresh_scope_epoch() {
        let backend = LocalEphemeralBackend::new();
        backend
            .register_collection(EphemeralCollection::local_cursor("boardCursors", "boardId"))
            .unwrap();
        let publish = |value: &[u8]| PublishRequest {
            collection: "boardCursors".to_owned(),
            scope: Scope::from_pairs([("boardId", "board-1")]),
            connection_id: "a".to_owned(),
            session_id: None,
            user_id: None,
            custom_key: None,
            value: value.to_vec(),
            ttl_ms: None,
            auth: AuthContext::default(),
        };

        let first = backend.publish(publish(b"one"), 1_000).unwrap();
        // Age a few versions so the old incarnation's version is > 1.
        backend.publish(publish(b"two"), 1_050).unwrap();
        let old_upsert_version = backend.publish(publish(b"three"), 1_100).unwrap();
        assert!(old_upsert_version.entry_version > 1);

        // A client saw the old incarnation.
        let mut overlay = ClientEphemeralOverlay::default();
        overlay.apply(&EphemeralMessage::Snapshot {
            ephemeral_authority_instance: None,
            room: first.room.clone(),
            scope_epoch: first.scope_epoch,
            room_authority_generation: 0,
            high_water_version: old_upsert_version.entry_version,
            entries: vec![EphemeralEntry {
                key: first.key.clone(),
                value: b"three".to_vec(),
                received_at_ms: 1_100,
                expires_at_ms: old_upsert_version.expires_at_ms,
                scope_epoch: old_upsert_version.scope_epoch,
                entry_version: old_upsert_version.entry_version,
            }],
            stream_resume: None,
        });

        // The room empties (no subscribers, entries expire) and is pruned.
        backend.cleanup_expired(20_000);
        assert_eq!(backend.diagnostics().room_count, 0);

        // The next incarnation restarts entry versions at 1 — but under a
        // strictly newer epoch.
        let reborn = backend.publish(publish(b"fresh"), 21_000).unwrap();
        assert!(reborn.scope_epoch > first.scope_epoch);
        assert_eq!(reborn.entry_version, 1);

        // The straggler applies the new upsert: NeedsResync, never
        // IgnoredStale (the dead-epoch behavior would have compared
        // entry_version 1 against the retained version and dropped it).
        let applied = overlay.apply(&EphemeralMessage::Upsert {
            ephemeral_authority_instance: None,
            room: reborn.room.clone(),
            room_authority_generation: 0,
            entry: EphemeralEntry {
                key: reborn.key.clone(),
                value: b"fresh".to_vec(),
                received_at_ms: 21_000,
                expires_at_ms: reborn.expires_at_ms,
                scope_epoch: reborn.scope_epoch,
                entry_version: reborn.entry_version,
            },
        });
        assert_eq!(applied, OverlayApply::NeedsResync);
    }

    /// @ref LLP 0184#c-administrator-ephemeral-entry-delete--add-now — the
    /// operator bypass still uses the ordinary delete message and subscriber
    /// fan-out path.
    #[test]
    fn operator_delete_fenced_match_removes_and_notifies_subscribers() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend
            .subscribe(subscribe_request("observer"), 1_000)
            .unwrap();
        let published = backend
            .publish(publish_request("owner", b"cursor"), 1_001)
            .unwrap();
        let _upsert = first_ephemeral(backend.drain_outbox("observer"));

        let removed = backend
            .operator_delete(operator_delete_request(&published), 1_002)
            .unwrap();
        assert!(matches!(
            &removed,
            EphemeralMessage::Remove {
                room,
                key,
                scope_epoch,
                reason: RemoveReason::Deleted,
                ..
            } if room == &published.room
                && key == &published.key
                && *scope_epoch == published.scope_epoch
        ));
        assert_eq!(
            first_ephemeral(backend.drain_outbox("observer")),
            removed,
            "the ordinary subscriber fan-out must carry the same Remove message"
        );
        assert_eq!(backend.diagnostics().entry_count, 0);
    }

    /// @ref LLP 0247#d3-presence-has-explicit-active-and-withdrawn-states — app
    /// withdrawals use the same epoch+entry tuple as the operator path, but
    /// stale tuples settle as superseded instead of surfacing an error.
    #[test]
    fn app_delete_fenced_match_removes_and_settles_deleted() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let published = backend
            .publish(publish_request("owner", b"cursor"), 1_000)
            .unwrap();
        let settlement = backend
            .delete(
                DeleteRequest {
                    expected_scope_epoch: Some(published.scope_epoch),
                    expected_entry_generation: Some(published.entry_version),
                    ..delete_request("owner")
                },
                1_001,
            )
            .unwrap();
        assert_eq!(settlement.status, DeleteSettlementStatus::Deleted);
        assert!(settlement.message.is_some());
        assert_eq!(backend.diagnostics().entry_count, 0);
    }

    #[test]
    fn app_delete_non_owner_fences_match_unfenced_refusal_without_pair_or_presence_oracle() {
        let backend = LocalEphemeralBackend::new();
        let mut custom = collection();
        custom.name = "customPresence".to_owned();
        custom.key_mode = KeyMode::Custom;
        backend.register_collection(custom).unwrap();
        let scope = scope();
        let published = backend
            .publish(
                PublishRequest {
                    collection: "customPresence".to_owned(),
                    scope: scope.clone(),
                    connection_id: "owner".to_owned(),
                    session_id: None,
                    user_id: None,
                    custom_key: Some("shared-name".to_owned()),
                    value: b"cursor".to_vec(),
                    ttl_ms: None,
                    auth: auth_for(&scope),
                },
                1_000,
            )
            .unwrap();
        let request = |expected_scope_epoch, expected_entry_generation| DeleteRequest {
            collection: "customPresence".to_owned(),
            scope: scope.clone(),
            connection_id: "other".to_owned(),
            session_id: None,
            user_id: None,
            custom_key: Some("shared-name".to_owned()),
            expected_scope_epoch,
            expected_entry_generation,
            auth: auth_for(&scope),
        };

        let unfenced = backend
            .delete(request(None, None), 1_001)
            .expect_err("another connection cannot delete the custom key");
        let stale = backend
            .delete(
                request(
                    Some(published.scope_epoch),
                    Some(published.entry_version + 1),
                ),
                1_001,
            )
            .expect_err("a stale fence cannot bypass key ownership");
        let exact = backend
            .delete(
                request(Some(published.scope_epoch), Some(published.entry_version)),
                1_001,
            )
            .expect_err("an exact fence cannot bypass key ownership");

        assert_eq!(unfenced.code, EphemeralErrorCode::Unauthorized);
        assert_eq!(stale, unfenced, "stale fences must reveal no current pair");
        assert_eq!(exact, unfenced, "exact fences must reveal no key presence");
        assert_eq!(backend.diagnostics().entry_count, 1);
    }

    #[test]
    fn app_delete_fence_values_above_json_safe_integer_refuse_before_room_work() {
        let backend = LocalEphemeralBackend::new();
        let maximum = crate::manifest::PORTABLE_STORAGE_VERSION_MAX;
        for (expected_scope_epoch, expected_entry_generation) in
            [(maximum + 1, 1), (1, maximum + 1)]
        {
            let error = backend
                .delete(
                    DeleteRequest {
                        expected_scope_epoch: Some(expected_scope_epoch),
                        expected_entry_generation: Some(expected_entry_generation),
                        ..delete_request("owner")
                    },
                    1_000,
                )
                .expect_err("an unrepresentable fence must refuse at ingress");
            assert_eq!(error.code, EphemeralErrorCode::InvalidScope);
            assert_eq!(
                error.message,
                "ephemeral delete fence values must not exceed the JSON safe-integer maximum"
            );
        }
        assert_eq!(backend.diagnostics().room_count, 0);
    }

    #[test]
    fn app_delete_stale_generation_settles_superseded_and_preserves_successor() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let predecessor = backend
            .publish(publish_request("owner", b"old"), 1_000)
            .unwrap();
        let successor = backend
            .publish(publish_request("owner", b"new"), 1_001)
            .unwrap();
        assert!(successor.entry_version > predecessor.entry_version);

        let settlement = backend
            .delete(
                DeleteRequest {
                    expected_scope_epoch: Some(predecessor.scope_epoch),
                    expected_entry_generation: Some(predecessor.entry_version),
                    ..delete_request("owner")
                },
                1_002,
            )
            .unwrap();
        assert_eq!(settlement.status, DeleteSettlementStatus::Superseded);
        assert_eq!(settlement.actual_scope_epoch, Some(successor.scope_epoch));
        assert_eq!(
            settlement.actual_entry_generation,
            Some(successor.entry_version)
        );
        assert_eq!(backend.diagnostics().entry_count, 1);
    }

    #[test]
    fn app_delete_old_epoch_settles_superseded_for_reborn_room() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let predecessor = backend
            .publish(publish_request("owner", b"old"), 1_000)
            .unwrap();
        backend
            .delete(
                DeleteRequest {
                    expected_scope_epoch: Some(predecessor.scope_epoch),
                    expected_entry_generation: Some(predecessor.entry_version),
                    ..delete_request("owner")
                },
                1_001,
            )
            .unwrap();
        let successor = backend
            .publish(publish_request("owner", b"new"), 1_002)
            .unwrap();
        assert!(successor.scope_epoch > predecessor.scope_epoch);
        assert_eq!(successor.entry_version, 1);

        let settlement = backend
            .delete(
                DeleteRequest {
                    expected_scope_epoch: Some(predecessor.scope_epoch),
                    expected_entry_generation: Some(predecessor.entry_version),
                    ..delete_request("owner")
                },
                1_003,
            )
            .unwrap();
        assert_eq!(settlement.status, DeleteSettlementStatus::Superseded);
        assert_eq!(settlement.actual_scope_epoch, Some(successor.scope_epoch));
        assert_eq!(backend.diagnostics().entry_count, 1);
    }

    #[test]
    fn delayed_app_withdrawal_after_republish_cannot_delete_successor() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let predecessor = backend
            .publish(publish_request("owner", b"typing"), 1_000)
            .unwrap();
        let successor = backend
            .publish(publish_request("owner", b"typing-again"), 1_001)
            .unwrap();

        let delayed = backend
            .delete(
                DeleteRequest {
                    expected_scope_epoch: Some(predecessor.scope_epoch),
                    expected_entry_generation: Some(predecessor.entry_version),
                    ..delete_request("owner")
                },
                1_002,
            )
            .unwrap();
        assert_eq!(delayed.status, DeleteSettlementStatus::Superseded);
        let EphemeralMessage::Snapshot { entries, .. } = backend
            .subscribe(subscribe_request("observer"), 1_003)
            .unwrap()
        else {
            panic!("expected room snapshot");
        };
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].entry_version, successor.entry_version);
        assert_eq!(entries[0].value, b"typing-again");
    }

    #[test]
    fn operator_delete_rejects_stale_entry_generation_in_current_room() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let published = backend
            .publish(publish_request("owner", b"cursor"), 1_000)
            .unwrap();
        let mut request = operator_delete_request(&published);
        request.expected_entry_generation += 1;

        let error = backend.operator_delete(request, 1_001).unwrap_err();
        assert_eq!(error.code, EphemeralErrorCode::StaleEntryGeneration);
        assert_eq!(backend.diagnostics().entry_count, 1);
    }

    /// The new room deliberately reuses generation 1. Only the old scope
    /// epoch distinguishes the inspected predecessor entry from the reborn
    /// entry, so removing the epoch check makes this test delete the wrong
    /// entry and fail.
    ///
    /// @ref LLP 0184#acceptance — epoch and generation are one fencing tuple.
    #[test]
    fn operator_delete_rejects_old_epoch_when_reborn_room_reuses_generation_one() {
        let backend = LocalEphemeralBackend::new();
        backend
            .register_collection(EphemeralCollection::local_cursor("boardCursors", "boardId"))
            .unwrap();
        let publish = |value: &[u8]| PublishRequest {
            collection: "boardCursors".to_owned(),
            scope: scope(),
            connection_id: "owner".to_owned(),
            session_id: None,
            user_id: None,
            custom_key: None,
            value: value.to_vec(),
            ttl_ms: None,
            auth: AuthContext::default(),
        };

        let old = backend.publish(publish(b"old"), 1_000).unwrap();
        backend
            .operator_delete(operator_delete_request(&old), 1_001)
            .unwrap();
        assert_eq!(backend.diagnostics().room_count, 0);

        let reborn = backend.publish(publish(b"new"), 1_002).unwrap();
        assert!(reborn.scope_epoch > old.scope_epoch);
        assert_eq!(reborn.entry_version, 1);
        let request = OperatorDeleteRequest {
            expected_scope_epoch: old.scope_epoch,
            expected_entry_generation: reborn.entry_version,
            ..operator_delete_request(&reborn)
        };

        let error = backend.operator_delete(request, 1_003).unwrap_err();
        assert_eq!(error.code, EphemeralErrorCode::StaleScopeEpoch);
        assert_eq!(backend.diagnostics().entry_count, 1);
    }

    #[test]
    fn operator_delete_distinguishes_collection_room_and_entry_absence() {
        let backend = LocalEphemeralBackend::new();
        let unknown = backend
            .operator_delete(
                OperatorDeleteRequest {
                    collection: "missing".to_owned(),
                    scope: scope(),
                    entry_key: "owner".to_owned(),
                    expected_scope_epoch: 1,
                    expected_entry_generation: 1,
                    reason: "test".to_owned(),
                },
                1_000,
            )
            .unwrap_err();
        assert_eq!(unknown.code, EphemeralErrorCode::UnknownCollection);

        backend
            .register_collection(EphemeralCollection::local_cursor("boardCursors", "boardId"))
            .unwrap();
        let room_missing = backend
            .operator_delete(
                OperatorDeleteRequest {
                    collection: "boardCursors".to_owned(),
                    scope: scope(),
                    entry_key: "owner".to_owned(),
                    expected_scope_epoch: 1,
                    expected_entry_generation: 1,
                    reason: "test".to_owned(),
                },
                1_000,
            )
            .unwrap_err();
        assert_eq!(room_missing.code, EphemeralErrorCode::RoomNotFound);

        let snapshot = backend
            .subscribe(
                SubscribeRequest {
                    collection: "boardCursors".to_owned(),
                    scope: scope(),
                    connection_id: "observer".to_owned(),
                    auth: AuthContext::default(),
                    since_chunk: None,
                },
                1_001,
            )
            .unwrap();
        let EphemeralMessage::Snapshot { scope_epoch, .. } = snapshot else {
            panic!("expected snapshot");
        };
        let entry_missing = backend
            .operator_delete(
                OperatorDeleteRequest {
                    collection: "boardCursors".to_owned(),
                    scope: scope(),
                    entry_key: "owner".to_owned(),
                    expected_scope_epoch: scope_epoch,
                    expected_entry_generation: 1,
                    reason: "test".to_owned(),
                },
                1_002,
            )
            .unwrap_err();
        assert_eq!(entry_missing.code, EphemeralErrorCode::EntryNotFound);
    }

    /// LLP 0026 Phase 2 — cleanup is index-driven: a pass at t only removes
    /// entries whose rooms are due at t, leaves later rooms alone, prunes
    /// emptied subscriber-less rooms, and the index re-arms surviving rooms
    /// for their next deadline.
    #[test]
    fn l9_cleanup_expired_visits_due_rooms_and_prunes_empty_ones() {
        let backend = LocalEphemeralBackend::new();
        backend
            .register_collection(EphemeralCollection::local_cursor("boardCursors", "boardId"))
            .unwrap();
        let publish = |board: &str, ttl_ms: Millis| PublishRequest {
            collection: "boardCursors".to_owned(),
            scope: Scope::from_pairs([("boardId", board)]),
            connection_id: format!("conn-{board}"),
            session_id: None,
            user_id: None,
            custom_key: None,
            value: b"cursor".to_vec(),
            ttl_ms: Some(ttl_ms),
            auth: AuthContext::default(),
        };

        backend.publish(publish("early", 5_000), 1_000).unwrap();
        backend.publish(publish("late", 10_000), 1_000).unwrap();
        assert_eq!(backend.diagnostics().room_count, 2);

        // Due pass: only the early room expires; the late room's entry
        // survives untouched, and the emptied early room is pruned.
        backend.cleanup_expired(6_500);
        let diagnostics = backend.diagnostics();
        assert_eq!(diagnostics.expired_entries, 1);
        assert_eq!(diagnostics.entry_count, 1);
        assert_eq!(diagnostics.room_count, 1);
        assert_eq!(diagnostics.active_rooms[0].routing_key, "7:boardId=4:late");

        // The index re-armed the late room: its deadline still fires.
        backend.cleanup_expired(11_500);
        let diagnostics = backend.diagnostics();
        assert_eq!(diagnostics.expired_entries, 2);
        assert_eq!(diagnostics.entry_count, 0);
        assert_eq!(diagnostics.room_count, 0);
    }

    #[test]
    fn eng_23350_room_expiry_gauge_skips_not_yet_due_sweeps() {
        let backend = LocalEphemeralBackend::new();
        let mut collection = EphemeralCollection::local_cursor("boardCursors", "boardId");
        collection.key_mode = KeyMode::Custom;
        backend.register_collection(collection.clone()).unwrap();
        let room_id =
            room_id_for(&collection, &Scope::from_pairs([("boardId", "board-1")])).unwrap();

        let publish = |key: &str, ttl_ms: Millis, now_ms: Millis| {
            backend
                .publish(
                    PublishRequest {
                        collection: "boardCursors".to_owned(),
                        scope: Scope::from_pairs([("boardId", "board-1")]),
                        connection_id: "publisher".to_owned(),
                        session_id: None,
                        user_id: None,
                        custom_key: Some(key.to_owned()),
                        value: key.as_bytes().to_vec(),
                        ttl_ms: Some(ttl_ms),
                        auth: AuthContext::default(),
                    },
                    now_ms,
                )
                .unwrap();
        };

        publish("early", 5_000, 1_000); // expires at 6_000
        publish("later", 7_000, 1_000); // expires at 8_000
        publish("early", 10_000, 2_000); // replacing earliest moves it to 12_000

        let room_arc = lock(&backend.shared.rooms)
            .get(&room_id)
            .cloned()
            .expect("room exists");
        assert_eq!(
            next_expiry_deadline(&lock(&room_arc)),
            Some(8_000),
            "the exact room-local expiry gauge should advance when the earliest entry is refreshed"
        );

        // The global room index may still wake at the stale 6_000 lower bound,
        // but the exact room gauge proves nothing is due and avoids scanning
        // the whole room's entry map.
        backend.cleanup_expired(6_500);
        let diagnostics = backend.diagnostics();
        assert_eq!(diagnostics.expired_entries, 0);
        assert_eq!(diagnostics.entry_count, 2);

        backend.cleanup_expired(8_000);
        let diagnostics = backend.diagnostics();
        assert_eq!(diagnostics.expired_entries, 1);
        assert_eq!(diagnostics.entry_count, 1);
    }

    /// LLP 0032 L9 — the resync-boundary machinery is live with the ratified
    /// ENG-22478 reasons: a destructive definition replacement delivers
    /// `ResyncRequired { reason: EpochChanged }` and an explicit runtime
    /// reset delivers `ResyncRequired { reason: Restarted }` to registered
    /// subscribers instead of silently discarding their rooms. The
    /// definition-replacement boundary is ephemeral-only: queued *ephemeral*
    /// messages belong to the retired epoch world and are replaced by the
    /// boundary, but queued *durable* live-query payloads answer
    /// subscriptions that survive the boundary and must be delivered, not
    /// silently dropped (ENG-23346). The runtime reset retires the durable
    /// world too, so there the whole outbox goes (the caller signals the
    /// dropped durable subscriptions itself, ENG-23333).
    #[test]
    fn l9_reset_and_destructive_replace_signal_resync_boundaries() {
        let backend = LocalEphemeralBackend::new();
        let collection = EphemeralCollection::local_cursor("boardCursors", "boardId");
        backend
            .replace_collections(vec![collection.clone()])
            .unwrap();

        let subscribe = SubscribeRequest {
            collection: "boardCursors".to_owned(),
            scope: Scope::from_pairs([("boardId", "board-1")]),
            connection_id: "observer".to_owned(),
            auth: AuthContext::default(),
            since_chunk: None,
        };
        backend.subscribe(subscribe.clone(), 1_000).unwrap();
        backend.enqueue_durable("observer", b"{\"kind\":\"live_replace\"}".to_vec());
        // A connection holding only durable traffic — no ephemeral
        // subscription — must be untouched by the ephemeral boundary.
        backend.enqueue_durable("durable-only", b"{\"kind\":\"live_delta\"}".to_vec());

        // Destructive replacement: a changed definition retires the epoch.
        let mut changed = collection.clone();
        changed.max_value_bytes = 512;
        backend.replace_collections(vec![changed.clone()]).unwrap();

        let messages = backend.drain_outbox("observer");
        assert_eq!(
            messages.len(),
            2,
            "durable payload survives the ephemeral boundary; the boundary replaces the ephemeral lanes"
        );
        assert!(matches!(
            &messages[0],
            RealtimeEnvelope::Durable(message)
                if message.payload == b"{\"kind\":\"live_replace\"}"
        ));
        assert!(matches!(
            &messages[1],
            RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired {
                reason: ResyncReason::EpochChanged,
                ..
            })
        ));
        let durable_only = backend.drain_outbox("durable-only");
        assert_eq!(
            durable_only,
            vec![RealtimeEnvelope::Durable(DurableMessage::new(
                b"{\"kind\":\"live_delta\"}".to_vec()
            ))],
            "a durable-only connection's queue is not the ephemeral store's to wipe"
        );

        // Explicit runtime reset: subscribers get the restart boundary.
        backend.subscribe(subscribe, 2_000).unwrap();
        backend.enqueue_durable("observer", b"{\"stale\":true}".to_vec());
        backend.reset_runtime_state();
        let messages = backend.drain_outbox("observer");
        assert_eq!(messages.len(), 1);
        assert!(matches!(
            &messages[0],
            RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired {
                reason: ResyncReason::Restarted,
                ..
            })
        ));
        assert_eq!(backend.diagnostics().resync_required, 1);
    }

    #[test]
    fn changed_single_registration_holds_generation_barrier_through_wipe() {
        let backend = LocalEphemeralBackend::new();
        let collection = EphemeralCollection::local_cursor("boardCursors", "boardId");
        backend.register_collection(collection.clone()).unwrap();
        let subscribe = SubscribeRequest {
            collection: "boardCursors".to_owned(),
            scope: Scope::from_pairs([("boardId", "board-1")]),
            connection_id: "observer".to_owned(),
            auth: AuthContext::default(),
            since_chunk: None,
        };
        let first = backend.subscribe(subscribe.clone(), 1_000).unwrap();
        let EphemeralMessage::Snapshot {
            scope_epoch: first_epoch,
            ..
        } = first
        else {
            panic!("expected initial snapshot");
        };
        backend.drain_outbox("observer");

        let (reached_tx, reached_rx) = std::sync::mpsc::sync_channel(0);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);
        *lock(&backend.shared.definition_swap_hook) = Some(DefinitionSwapTestHook {
            reached: reached_tx,
            release: release_rx,
        });

        let changer_backend = backend.clone();
        let mut changed = collection;
        changed.default_ttl_ms = 9_000;
        let changer = std::thread::spawn(move || {
            changer_backend.register_collection(changed).unwrap();
        });
        reached_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("replacement reached the post-swap boundary");
        assert!(
            backend.shared.lifecycle.try_read().is_err(),
            "the definition write guard must span room retirement and resync enqueue"
        );

        // Start new-generation work while replacement is paused after making
        // the definition visible. It must wait for the old rooms/lanes to be
        // retired, then its fresh subscription and delta must survive.
        let worker_backend = backend.clone();
        let worker_started = Arc::new(std::sync::Barrier::new(2));
        let worker_barrier = worker_started.clone();
        let worker = std::thread::spawn(move || {
            worker_barrier.wait();
            let snapshot = worker_backend.subscribe(subscribe, 2_000).unwrap();
            worker_backend
                .publish(
                    PublishRequest {
                        collection: "boardCursors".to_owned(),
                        scope: Scope::from_pairs([("boardId", "board-1")]),
                        connection_id: "publisher".to_owned(),
                        session_id: None,
                        user_id: None,
                        custom_key: None,
                        value: b"new-generation".to_vec(),
                        ttl_ms: None,
                        auth: AuthContext::default(),
                    },
                    2_001,
                )
                .unwrap();
            snapshot
        });
        worker_started.wait();
        release_tx.send(()).unwrap();
        changer.join().unwrap();
        let snapshot = worker.join().unwrap();
        let EphemeralMessage::Snapshot {
            scope_epoch: next_epoch,
            ..
        } = snapshot
        else {
            panic!("expected replacement snapshot");
        };
        assert!(next_epoch > first_epoch);

        let messages = backend.drain_outbox("observer");
        assert!(matches!(
            messages.first(),
            Some(RealtimeEnvelope::Ephemeral(
                EphemeralMessage::ResyncRequired {
                    scope_epoch,
                    reason: ResyncReason::EpochChanged,
                    ..
                }
            )) if *scope_epoch == first_epoch
        ));
        assert!(
            messages.iter().any(|message| matches!(
                message,
                RealtimeEnvelope::Ephemeral(EphemeralMessage::Upsert { entry, .. })
                    if entry.scope_epoch == next_epoch && entry.value == b"new-generation"
            )),
            "new-generation deltas must be enqueued after, never wiped by, the replacement boundary: {messages:?}"
        );
    }

    /// LLP 0013 §Room store model / LLP 0026 Phase 2 — snapshot and
    /// registration are one room operation even with the room authority off
    /// any global lock: a subscriber that joins mid-stream converges to every
    /// publisher's final value (no publish falls between snapshot and
    /// registration) and never observes an epoch tear.
    #[test]
    fn l9_snapshot_registration_is_atomic_under_concurrent_publishes() {
        use std::sync::atomic::AtomicU64 as ClockCell;

        let backend = LocalEphemeralBackend::new();
        backend
            .register_collection(EphemeralCollection::local_cursor("boardCursors", "boardId"))
            .unwrap();
        let clock = Arc::new(ClockCell::new(1_000));
        let publishers = 4usize;
        let publishes_per_publisher = 50u64;

        let mut handles = Vec::new();
        for publisher in 0..publishers {
            let backend = backend.clone();
            let clock = clock.clone();
            handles.push(std::thread::spawn(move || {
                let connection = format!("pub-{publisher}");
                for n in 0..publishes_per_publisher {
                    let value = if n + 1 == publishes_per_publisher {
                        format!("final-{publisher}")
                    } else {
                        format!("v-{publisher}-{n}")
                    };
                    let now = clock.fetch_add(1, Ordering::Relaxed);
                    backend
                        .publish(
                            PublishRequest {
                                collection: "boardCursors".to_owned(),
                                scope: Scope::from_pairs([("boardId", "board-1")]),
                                connection_id: connection.clone(),
                                session_id: None,
                                user_id: None,
                                custom_key: None,
                                value: value.into_bytes(),
                                ttl_ms: Some(30_000),
                                auth: AuthContext::default(),
                            },
                            now,
                        )
                        .expect("publish under contention");
                }
            }));
        }

        // Subscribe mid-stream and stream everything into a client overlay.
        std::thread::sleep(std::time::Duration::from_millis(2));
        let now = clock.fetch_add(1, Ordering::Relaxed);
        let snapshot = backend
            .subscribe(
                SubscribeRequest {
                    collection: "boardCursors".to_owned(),
                    scope: Scope::from_pairs([("boardId", "board-1")]),
                    connection_id: "observer".to_owned(),
                    auth: AuthContext::default(),
                    since_chunk: None,
                },
                now,
            )
            .expect("subscribe mid-stream");
        let mut overlay = ClientEphemeralOverlay::default();
        assert_eq!(overlay.apply(&snapshot), OverlayApply::Applied);

        let mut resyncs = 0usize;
        let mut drain_into_overlay = |overlay: &mut ClientEphemeralOverlay| {
            for envelope in backend.drain_outbox("observer") {
                if overlay.apply_envelope(&envelope) == OverlayApply::NeedsResync {
                    resyncs += 1;
                }
            }
        };
        while handles.iter().any(|handle| !handle.is_finished()) {
            drain_into_overlay(&mut overlay);
        }
        for handle in handles {
            handle.join().expect("publisher thread");
        }
        drain_into_overlay(&mut overlay);
        assert_eq!(resyncs, 0, "one epoch throughout: no resync may occur");

        let EphemeralMessage::Snapshot { room, .. } = &snapshot else {
            panic!("expected snapshot");
        };
        for publisher in 0..publishers {
            let key = EntryKey(format!("pub-{publisher}"));
            let entry = overlay
                .get(room, &key)
                .unwrap_or_else(|| panic!("publisher {publisher} converged entry missing"));
            assert_eq!(
                entry.value,
                format!("final-{publisher}").into_bytes(),
                "subscriber must converge to publisher {publisher}'s final value"
            );
        }
    }

    /// LLP 0032 L9 (MEDIUM finding 1) — a wipe must not detach a
    /// concurrently-created surviving room from the TTL sweeper. A publisher
    /// creates fresh rooms while `reset_runtime_state` retires the snapshot
    /// set; a room born after the snapshot survives the wipe. The fix removes
    /// only retired rooms' index entries (never a wholesale
    /// `expiry_index.clear()`), so every surviving room with entries stays
    /// index-reachable. Discriminator: a far-future `cleanup_expired` must
    /// drain every entry to zero — under the pre-fix `clear()`, a detached
    /// survivor's entries would outlive TTL forever and this would hang at a
    /// nonzero `entry_count`.
    #[test]
    fn l9_wipe_does_not_detach_surviving_rooms_from_the_expiry_index() {
        use std::sync::atomic::AtomicBool;

        let backend = LocalEphemeralBackend::new();
        let mut cursors = EphemeralCollection::local_cursor("cursors", "roomId");
        cursors.sustained_hz = 10_000_000;
        cursors.burst = 10_000_000;
        backend.register_collection(cursors).unwrap();

        let stop = Arc::new(AtomicBool::new(false));
        let publisher = {
            let backend = backend.clone();
            let stop = stop.clone();
            std::thread::spawn(move || {
                const ROUTING_ROOMS: u64 = 256;
                let mut n = 0u64;
                while !stop.load(Ordering::Relaxed) {
                    // Reuse a bounded routing-key set so the concurrency
                    // witness cannot trip the independent 4,096-room
                    // production cap on a fast host. Each wipe retires the
                    // current incarnations, so later publishes still create
                    // fresh rooms that can land inside the legacy
                    // snapshot→retire window this test discriminates.
                    let request = PublishRequest {
                        collection: "cursors".to_owned(),
                        scope: Scope::from_pairs([("roomId", format!("r-{}", n % ROUTING_ROOMS))]),
                        connection_id: "pub".to_owned(),
                        session_id: None,
                        user_id: None,
                        custom_key: None,
                        value: b"x".to_vec(),
                        ttl_ms: Some(5_000),
                        auth: AuthContext::default(),
                    };
                    backend.publish(request, 1_000).expect("publish");
                    n += 1;
                }
                n
            })
        };

        // Hammer wipes against the live publisher for a fixed window, so both
        // threads genuinely overlap (a tight loop would finish before the
        // publisher thread even warms up).
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(150);
        let mut wipes = 0u64;
        while std::time::Instant::now() < deadline {
            backend.reset_runtime_state();
            wipes += 1;
            std::thread::sleep(std::time::Duration::from_micros(50));
        }
        stop.store(true, Ordering::Relaxed);
        let published = publisher.join().expect("publisher thread");
        assert!(
            published >= 100 && wipes >= 1,
            "the publisher and wipes must have genuinely overlapped \
             (published {published}, wipes {wipes})"
        );

        // Every room still holding entries must be reachable through the
        // expiry index: a far-future sweep drains them all. A room detached by
        // a wholesale index clear would keep its entries here forever.
        backend.cleanup_expired(10_000_000);
        let diagnostics = backend.diagnostics();
        assert_eq!(
            diagnostics.entry_count, 0,
            "a surviving room was detached from the expiry index (entries outlive TTL)"
        );
        assert_eq!(
            diagnostics.room_count, 0,
            "index-reachable empty rooms must prune"
        );
    }

    /// LLP 0032 L9 (LOW finding 3) — push-before-wake is load-bearing and now
    /// guarded: the event-driven delivery claim rests entirely on every
    /// enqueue site making its message drainable BEFORE it wakes the waiter.
    /// This ping-pong drives 30k strict enqueue→wake→drain round-trips with NO
    /// safety-net poll; the consumer only ever drains on a wake. A
    /// wake-before-push regression consumes a round's only wake on an empty
    /// drain and strands the late push, so the bounded timeout fails (the
    /// mutant was caught reliably; the real code passes at 30k iterations).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn l9_enqueue_is_push_before_wake_no_lost_wakeup() {
        use tokio::sync::mpsc;

        let backend = LocalEphemeralBackend::new();
        let notifier = backend.delivery_notifier();
        let (_generation, waker) = notifier.register("conn").unwrap();

        let (ack_tx, mut ack_rx) = mpsc::channel::<()>(1);
        let consumer_backend = backend.clone();
        let consumer = tokio::spawn(async move {
            loop {
                waker.notified().await;
                // Drain on wake with NO fallback poll. In correct code every
                // enqueue is followed by its wake, so a strict ping-pong never
                // leaves a spurious empty drain unaccompanied by a real wake.
                // A wake-before-push regression spends the round's only wake on
                // an empty drain, then the late push has no wake to announce it.
                let drained = consumer_backend.drain_outbox("conn");
                if !drained.is_empty() && ack_tx.send(()).await.is_err() {
                    break;
                }
            }
        });

        const ROUNDS: u64 = 30_000;
        let producer = async {
            for n in 0..ROUNDS {
                backend.enqueue_durable("conn", n.to_le_bytes().to_vec());
                // Strict ping-pong: the next enqueue waits until the consumer
                // has drained this one, so no backlog can ever mask a lost wake.
                ack_rx
                    .recv()
                    .await
                    .expect("the consumer must ack every enqueue");
            }
        };

        tokio::time::timeout(std::time::Duration::from_secs(20), producer)
            .await
            .expect("push-before-wake must deliver every enqueue with no lost wakeup");
        consumer.abort();
    }

    /// A readable id is only an address. Predecessor cleanup and even a
    /// predecessor-owned overflow may not remove the successor grant's queue
    /// entry, while authority-independent traffic remains shared.
    #[test]
    fn exact_effect_purge_and_overflow_preserve_successor_and_independent_frames() {
        let backend = LocalEphemeralBackend::new();
        let predecessor = ConnectionEffectFence::session("inc", "grant-old", "session", 1);
        let successor = ConnectionEffectFence::session("inc", "grant-new", "session", 2);

        backend.enqueue_durable_bound("reused", b"old".to_vec(), predecessor.clone());
        backend.enqueue_durable_bound("reused", b"new".to_vec(), successor.clone());
        backend.enqueue_durable("reused", b"independent".to_vec());
        for _ in 0..MAX_OUTBOX_BACKLOG {
            let outcome = backend.enqueue_durable_bound("reused", vec![7; 32], predecessor.clone());
            if outcome.overflowed_now {
                break;
            }
        }

        backend.purge_connection_effects("reused", &predecessor);
        let payloads = backend
            .drain_outbox_for_send_bound("reused", &successor)
            .into_iter()
            .filter_map(|admitted| match admitted.into_parts().0 {
                RealtimeEnvelope::Durable(message) => Some(message.payload),
                RealtimeEnvelope::Ephemeral(_) => None,
            })
            .collect::<Vec<_>>();
        assert!(payloads.iter().any(|payload| payload == b"new"));
        assert!(payloads.iter().any(|payload| payload == b"independent"));
        assert!(!payloads.iter().any(|payload| payload == b"old"));
        assert!(
            backend
                .drain_outbox_for_send_bound("reused", &predecessor)
                .is_empty(),
            "exact purge must remove the predecessor's out-of-band overflow signal"
        );
    }

    /// A predecessor can consume every physical slot in the shared readable-id
    /// queue before the successor's first frame arrives. The successor's
    /// overflow marker must still materialize a clear-retained signal only for
    /// the successor's exact drain; otherwise that first frame disappears
    /// silently when the drain discards the predecessor backlog as stale. Two
    /// independently marked successors also retain separate signals.
    #[test]
    fn predecessor_filled_queue_cannot_displace_successor_overflow_signal() {
        let backend = LocalEphemeralBackend::new();
        let predecessor = ConnectionEffectFence::session("inc", "grant-old", "session", 1);
        let successor = ConnectionEffectFence::session("inc", "grant-new", "session", 2);
        let parallel = ConnectionEffectFence::session("inc", "grant-parallel", "session", 3);

        for _ in 0..MAX_OUTBOX_BACKLOG {
            let outcome = backend.enqueue_durable_bound(
                "reused",
                b"predecessor".to_vec(),
                predecessor.clone(),
            );
            assert!(!outcome.overflowed_now);
        }
        let outcome = backend.enqueue_durable_bound(
            "reused",
            b"successor-first-frame".to_vec(),
            successor.clone(),
        );
        assert!(outcome.overflowed_now);
        assert!(outcome.parked_behind_overflow);
        let parallel_outcome = backend.enqueue_durable_bound(
            "reused",
            b"parallel-first-frame".to_vec(),
            parallel.clone(),
        );
        assert!(parallel_outcome.overflowed_now);
        assert!(parallel_outcome.parked_behind_overflow);

        let payloads = backend
            .drain_outbox_for_send_bound("reused", &successor)
            .into_iter()
            .filter_map(|admitted| match admitted.into_parts().0 {
                RealtimeEnvelope::Durable(message) => {
                    assert_eq!(message.effect_fence(), Some(&successor));
                    Some(message.payload)
                }
                RealtimeEnvelope::Ephemeral(_) => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(payloads.len(), 1);
        let signal: serde_json::Value = serde_json::from_slice(&payloads[0]).unwrap();
        assert_eq!(signal["kind"], "resync_required");
        assert_eq!(signal["reason"], "outbox_overflow");
        assert_eq!(signal["clear_retained"], true);

        let parallel_payloads = backend
            .drain_outbox_for_send_bound("reused", &parallel)
            .into_iter()
            .filter_map(|admitted| match admitted.into_parts().0 {
                RealtimeEnvelope::Durable(message) => {
                    assert_eq!(message.effect_fence(), Some(&parallel));
                    Some(message.payload)
                }
                RealtimeEnvelope::Ephemeral(_) => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(parallel_payloads.len(), 1);
        let parallel_signal: serde_json::Value =
            serde_json::from_slice(&parallel_payloads[0]).unwrap();
        assert_eq!(parallel_signal["kind"], "resync_required");
        assert_eq!(parallel_signal["reason"], "outbox_overflow");
        assert_eq!(parallel_signal["clear_retained"], true);

        backend.enqueue_durable_bound("reused", b"fresh".to_vec(), successor.clone());
        let after = backend
            .drain_outbox_for_send_bound("reused", &successor)
            .into_iter()
            .filter_map(|admitted| match admitted.into_parts().0 {
                RealtimeEnvelope::Durable(message) => Some(message.payload),
                RealtimeEnvelope::Ephemeral(_) => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(after, vec![b"fresh".to_vec()]);
    }

    /// The registry contract permits one current consumable fence for a
    /// readable id. Historical exact markers may wait for terminal cleanup,
    /// but they are a bounded fault-containment ledger, not grant history.
    /// Crossing that ledger must park every domain and produce exactly one
    /// global recovery frame for the registry-verified current drain.
    #[test]
    fn exact_overflow_marker_count_exhaustion_poison_collapses_fail_closed() {
        let mut queue = OutboundQueue::new();
        for index in 0..MAX_OUTBOX_EXACT_OVERFLOW_MARKERS {
            let fence = ConnectionEffectFence::session(
                "inc",
                format!("grant-{index}"),
                "session",
                index as u64 + 1,
            );
            assert!(queue.overflow(None, Some(fence)).overflowed);
            assert!(!queue.all_authorities_poisoned);
        }
        assert_eq!(
            queue.overflowed_effect_fences.len(),
            MAX_OUTBOX_EXACT_OVERFLOW_MARKERS
        );
        assert_eq!(
            queue.retained_bytes(),
            recompute_queue_retained_bytes(&queue)
        );
        let backend = LocalEphemeralBackend::new();
        let outbox = backend.ensure_outbox("poisoned");
        *lock(&outbox) = queue.clone();
        let marker_diagnostics = backend.diagnostics();
        assert_eq!(
            marker_diagnostics.pending_durable_messages,
            MAX_OUTBOX_EXACT_OVERFLOW_MARKERS
        );
        assert_eq!(
            marker_diagnostics.outbox_retained_bytes,
            queue.retained_bytes()
        );

        let current = ConnectionEffectFence::session(
            "inc",
            "grant-current",
            "session",
            MAX_OUTBOX_EXACT_OVERFLOW_MARKERS as u64 + 1,
        );
        assert!(queue.overflow(None, Some(current.clone())).overflowed);
        assert!(queue.all_authorities_poisoned);
        assert!(queue.overflowed_effect_fences.is_empty());
        assert!(queue.durable.is_empty());
        assert!(queue.resync.is_empty());
        assert!(queue.ephemeral.is_empty());
        assert_eq!(
            queue.retained_bytes(),
            retained_global_overflow_signal_bytes()
        );

        // Every authority domain is parked until recovery; an attempted
        // current payload cannot sneak in behind the poison signal.
        assert_eq!(
            queue.push_durable(DurableMessage::bound(
                b"must-not-leak".to_vec(),
                current.clone(),
            )),
            QueueOverflow::default()
        );
        assert!(queue.durable.is_empty());

        *lock(&outbox) = queue.clone();
        let diagnostics = backend.diagnostics();
        assert_eq!(diagnostics.pending_durable_messages, 1);
        assert_eq!(
            diagnostics.outbox_retained_bytes,
            retained_global_overflow_signal_bytes()
        );

        assert!(
            queue
                .drain_with_authority(
                    None,
                    |_| FrameAuthorityDisposition::Send,
                    |_| FrameAuthorityDisposition::Send,
                )
                .is_empty(),
            "an unverified compatibility drain cannot consume poison"
        );
        let recovered = queue.drain_with_authority(
            Some(&current),
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert_eq!(recovered.len(), 1);
        let RealtimeEnvelope::Durable(signal) = &recovered[0] else {
            panic!("expected one durable global recovery signal");
        };
        assert_eq!(signal.effect_fence(), Some(&current));
        let payload: serde_json::Value = serde_json::from_slice(&signal.payload).unwrap();
        assert_eq!(payload["kind"], "resync_required");
        assert_eq!(payload["clear_retained"], true);
        assert!(
            queue
                .drain_with_authority(
                    Some(&current),
                    |_| FrameAuthorityDisposition::Send,
                    |_| FrameAuthorityDisposition::Send,
                )
                .is_empty()
        );
    }

    #[test]
    fn exact_overflow_marker_byte_exhaustion_clears_other_physical_domains() {
        let mut queue = OutboundQueue::new();
        let predecessor = ConnectionEffectFence::session("inc", "grant-old", "session", 1);
        let empty = DurableMessage::bound(Vec::new(), predecessor.clone());
        let payload_len = MAX_OUTBOX_RETAINED_BYTES
            .saturating_sub(retained_durable_queue_item_bytes(&empty))
            .saturating_sub(1);
        assert!(
            !queue
                .push_durable(DurableMessage::bound(vec![7; payload_len], predecessor,))
                .overflowed
        );
        assert_eq!(queue.retained_bytes(), MAX_OUTBOX_RETAINED_BYTES - 1);

        let current = ConnectionEffectFence::session("inc", "grant-current", "session", 2);
        let overflow = queue.push_durable(DurableMessage::bound(vec![8], current));
        assert!(overflow.overflowed);
        assert!(queue.all_authorities_poisoned);
        assert!(queue.durable.is_empty());
        assert!(queue.resync.is_empty());
        assert!(queue.ephemeral.is_empty());
        assert!(queue.overflowed_effect_fences.is_empty());
        assert_eq!(
            queue.retained_bytes(),
            recompute_queue_retained_bytes(&queue)
        );
        assert!(queue.retained_bytes() <= MAX_OUTBOX_RETAINED_BYTES);
    }

    #[test]
    fn handoff_estimator_bounds_worst_case_json_expansion() {
        let durable = RealtimeEnvelope::Durable(DurableMessage::new(vec![u8::MAX; 4_096]));
        let escaped = "\0".repeat(4_096);
        let ephemeral = RealtimeEnvelope::Ephemeral(EphemeralMessage::Error {
            ephemeral_authority_instance: None,
            room: Some(RoomId {
                collection: escaped.clone(),
                routing_key: escaped.clone(),
                scope: Scope::from_pairs([(escaped.clone(), escaped.clone())]),
            }),
            room_authority_generation: Some(u64::MAX),
            error: EphemeralError::new(EphemeralErrorCode::Unauthorized, escaped),
        });
        for envelope in [durable, ephemeral] {
            let actual = serde_json::to_vec(&envelope).unwrap().len();
            let estimated = estimated_envelope_handoff_bytes(&envelope);
            assert!(
                actual <= estimated,
                "serialized envelope ({actual}) exceeded conservative estimate ({estimated})"
            );
            assert!(estimated <= MAX_OUTBOX_HANDOFF_BYTES);
        }
    }

    #[test]
    fn handoff_batch_stops_before_the_conservative_byte_ceiling() {
        let mut queue = OutboundQueue::new();
        for _ in 0..MAX_OUTBOX_DRAIN_BATCH {
            assert!(
                !queue
                    .push_durable(DurableMessage::new(vec![u8::MAX; 512 * 1_024]))
                    .overflowed
            );
        }
        let selected = queue.drain_with_authority_bounded(
            None,
            MAX_OUTBOX_DRAIN_BATCH,
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert!(!selected.is_empty());
        assert!(selected.len() < MAX_OUTBOX_DRAIN_BATCH);
        let estimated = selected
            .iter()
            .fold(OUTBOX_HANDOFF_BATCH_OVERHEAD, |total, selected| {
                total.saturating_add(estimated_envelope_handoff_bytes(&selected.envelope))
            });
        assert!(estimated <= MAX_OUTBOX_HANDOFF_BYTES);
        assert!(
            queue.durable.iter().any(|queued| queued.lease_id.is_none()),
            "the first candidate that would cross the byte cap remains queued"
        );
    }

    #[test]
    fn projection_reserved_budget_defers_globally_valid_frame_without_overflow() {
        let mut queue = OutboundQueue::new();
        let payload = vec![0x7f; 1_024 * 1_024];
        let message = DurableMessage::new(payload.clone());
        let estimate = estimated_durable_handoff_bytes(&message);
        assert!(OUTBOX_HANDOFF_BATCH_OVERHEAD.saturating_add(estimate) < MAX_OUTBOX_HANDOFF_BYTES);
        assert!(!queue.push_durable(message).overflowed);

        let selected = queue.drain_with_authority_bounded_and_handoff_limit(
            None,
            MAX_OUTBOX_DRAIN_BATCH,
            OUTBOX_HANDOFF_BATCH_OVERHEAD
                .saturating_add(estimate)
                .saturating_sub(1),
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert!(selected.is_empty());
        assert_eq!(queue.durable.len(), 1);
        assert!(!queue.overflowed);
        assert!(!queue.all_authorities_poisoned);

        let retry = queue.drain_with_authority_bounded(
            None,
            MAX_OUTBOX_DRAIN_BATCH,
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert!(matches!(
            retry.as_slice(),
            [SelectedOutboxLease {
                envelope: RealtimeEnvelope::Durable(message),
                ..
            }] if message.payload == payload
        ));
    }

    #[test]
    fn recovery_marker_ignores_projection_consumed_payload_budget() {
        let mut queue = OutboundQueue::new();
        let fence = ConnectionEffectFence::session("inc", "grant", "session", 1);
        assert!(queue.overflow(None, Some(fence.clone())).overflowed);
        let selected = queue.drain_with_authority_bounded_and_handoff_limit(
            Some(&fence),
            1,
            0,
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert_eq!(selected.len(), 1);
        assert_eq!(
            selected[0].recovery_marker_priority,
            Some(RecoveryMarkerPriority::Exact)
        );
    }

    #[test]
    fn ws_projection_and_outbox_clone_share_one_handoff_budget() {
        let backend = LocalEphemeralBackend::new();
        let fence = ConnectionEffectFence::session("inc", "grant", "session", 1);
        let projection = DurableMessage::new(vec![0x31; 9 * 1_024 * 1_024]);
        let projection_estimate = estimated_durable_handoff_bytes(&projection);
        let queued_payload = vec![0x32; 2 * 1_024 * 1_024];
        let queued = DurableMessage::new(queued_payload.clone());
        assert!(
            OUTBOX_HANDOFF_BATCH_OVERHEAD.saturating_add(estimated_durable_handoff_bytes(&queued))
                < MAX_OUTBOX_HANDOFF_BYTES,
            "the queued frame is globally handoff-valid"
        );
        backend.enqueue_durable("conn", queued_payload.clone());
        let notifier = backend.delivery_notifier();
        let (generation, _waker) = notifier.register("conn").unwrap();
        let remaining = MAX_OUTBOX_HANDOFF_BYTES.saturating_sub(projection_estimate);

        let selected = backend
            .drain_outbox_for_send_bound_if_current_with_handoff_limit(
                "conn", generation, &fence, remaining,
            )
            .expect("current WS drain");
        assert!(
            selected.is_empty(),
            "the queued clone must not overlap a near-cap projection vector"
        );
        let outbox = backend.ensure_outbox("conn");
        assert_eq!(lock(&outbox).durable.len(), 1);
        assert!(!lock(&outbox).overflowed);

        drop(projection);
        let retry = backend
            .drain_outbox_for_send_bound_if_current_with_handoff_limit(
                "conn",
                generation,
                &fence,
                MAX_OUTBOX_HANDOFF_BYTES,
            )
            .expect("retry after projection ownership is released");
        assert!(matches!(
            retry.as_slice(),
            [admitted] if matches!(
                admitted.envelope(),
                RealtimeEnvelope::Durable(message) if message.payload == queued_payload
            )
        ));
    }

    #[test]
    fn near_retained_cap_frame_becomes_recovery_marker_before_clone() {
        let mut queue = OutboundQueue::new();
        let empty = DurableMessage::new(Vec::new());
        let payload_len = MAX_OUTBOX_RETAINED_BYTES
            .saturating_sub(retained_durable_queue_item_bytes(&empty))
            .saturating_sub(1);
        assert!(
            !queue
                .push_durable(DurableMessage::new(vec![u8::MAX; payload_len]))
                .overflowed
        );
        let selected = queue.drain_with_authority_bounded(
            None,
            MAX_OUTBOX_DRAIN_BATCH,
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert_eq!(selected.len(), 1);
        let RealtimeEnvelope::Durable(marker) = &selected[0].envelope else {
            panic!("oversized durable handoff must become a durable recovery marker");
        };
        let marker: serde_json::Value = serde_json::from_slice(&marker.payload).unwrap();
        assert_eq!(marker["kind"], "resync_required");
        assert_eq!(marker["clear_retained"], true);
        assert!(queue.durable.is_empty());
        assert!(queue.overflowed);
        assert!(
            estimated_envelope_handoff_bytes(&selected[0].envelope) <= MAX_OUTBOX_HANDOFF_BYTES
        );
    }

    #[test]
    fn same_room_overflow_recovery_refreshes_without_stale_downgrade() {
        let mut queue = OutboundQueue::new();
        let room = room();
        let fence = ConnectionEffectFence::session("inc", "grant", "session", 1);
        assert_eq!(
            queue.record_overflow_resync_for_room(room.clone(), 1, 1, Some(fence.clone()),),
            1
        );
        let retained = queue.retained_bytes();
        assert_eq!(
            queue.record_overflow_resync_for_room(room.clone(), 1, 3, Some(fence.clone()),),
            0
        );
        queue.record_overflow_resync_for_room(room.clone(), 1, 2, Some(fence.clone()));
        queue.record_overflow_resync_for_room(room.clone(), 2, 0, Some(fence.clone()));
        queue.record_overflow_resync_for_room(room, 1, 99, Some(fence.clone()));
        assert_eq!(queue.resync.len(), 1);
        assert_eq!(queue.retained_bytes(), retained);

        let drained = queue.drain_with_authority(
            Some(&fence),
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert!(matches!(
            drained.as_slice(),
            [RealtimeEnvelope::Ephemeral(
                EphemeralMessage::ResyncRequired {
                    scope_epoch: 2,
                    room_authority_generation: 0,
                    reason: ResyncReason::QueueOverflow,
                    ..
                }
            )]
        ));
    }

    #[test]
    fn recovery_marker_is_leased_alone_and_survives_cancelled_handoff() {
        let backend = LocalEphemeralBackend::new();
        let fence = ConnectionEffectFence::session("inc", "grant", "session", 1);
        let outbox = backend.ensure_outbox("conn");
        {
            let mut queue = lock(&outbox);
            queue.push_durable(DurableMessage::new(b"ordinary".to_vec()));
            assert!(queue.overflow(None, Some(fence.clone())).overflowed);
            assert_eq!(queue.durable.len(), 1);
        }

        let marker = backend.drain_outbox_for_send_bound("conn", &fence);
        assert_eq!(marker.len(), 1, "the marker must be leased by itself");
        let RealtimeEnvelope::Durable(signal) = marker[0].envelope() else {
            panic!("expected exact recovery marker");
        };
        assert_eq!(signal.effect_fence(), Some(&fence));
        assert!(
            backend.has_eligible_recovery_marker_bound("conn", &fence),
            "priority preflight remains true until marker acknowledgement"
        );
        assert!(
            backend
                .drain_outbox_for_send_bound("conn", &fence)
                .is_empty(),
            "ordinary frames stay parked behind an unaccepted recovery marker"
        );
        marker.into_iter().next().unwrap().release_handoff();

        let marker = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .unwrap();
        let RealtimeEnvelope::Durable(signal) = marker.envelope() else {
            panic!("expected retried exact recovery marker");
        };
        assert_eq!(signal.effect_fence(), Some(&fence));
        assert!(marker.commit_handoff());

        let ordinary = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .unwrap();
        let RealtimeEnvelope::Durable(message) = ordinary.envelope() else {
            panic!("expected ordinary frame after recovery acceptance");
        };
        assert_eq!(message.payload.as_slice(), b"ordinary");
    }

    #[test]
    fn poison_survives_release_and_bounded_sink_offer_failure() {
        let backend = LocalEphemeralBackend::new();
        let fence = ConnectionEffectFence::session("inc", "grant", "session", 1);
        let outbox = backend.ensure_outbox("conn");
        assert!(lock(&outbox).poison_all_authorities());

        backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .unwrap()
            .release_handoff();
        assert!(lock(&outbox).all_authorities_poisoned);

        let selected = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .unwrap();
        let (_, permit, lease) = selected.into_leased_parts();
        assert!(permit.is_none());
        match lease.try_commit("not-accepted", Err) {
            OutboxLeaseCommit::OfferFailed(value) => assert_eq!(value, "not-accepted"),
            OutboxLeaseCommit::Committed | OutboxLeaseCommit::Superseded(_) => {
                panic!("a rejected bounded offer cannot acknowledge poison")
            }
        }
        lease.wake();
        drop(lease);
        assert!(lock(&outbox).all_authorities_poisoned);

        let final_attempt = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .unwrap();
        assert!(final_attempt.commit_handoff());
        assert!(!lock(&outbox).all_authorities_poisoned);
    }

    #[test]
    fn ws_exact_ordinary_lease_loses_to_later_unbound_recovery_marker() {
        let backend = LocalEphemeralBackend::new();
        let fence = ConnectionEffectFence::session("inc", "grant", "session", 1);
        backend.enqueue_durable_bound("conn", b"exact-ordinary".to_vec(), fence.clone());
        let selected = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .expect("select exact ordinary frame");
        let (_, permit, lease) = selected.into_leased_parts();
        assert!(permit.is_none());

        backend.overflow_outbox_for_test("conn", None);
        match lease.try_commit((), |()| Ok(())) {
            OutboxLeaseCommit::Superseded(()) => {}
            OutboxLeaseCommit::Committed | OutboxLeaseCommit::OfferFailed(()) => {
                panic!("an eligible global marker must supersede an exact ordinary offer")
            }
        }
        lease.wake();
        drop(lease);

        let marker = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .expect("global marker wins the retry");
        assert!(marker.is_recovery_marker());
        assert!(marker.commit_handoff());
        let ordinary = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .expect("exact ordinary frame remains after marker acceptance");
        assert!(matches!(
            ordinary.envelope(),
            RealtimeEnvelope::Durable(message) if message.payload == b"exact-ordinary"
        ));
    }

    #[test]
    fn ws_unbound_ordinary_lease_loses_to_later_exact_recovery_marker() {
        let backend = LocalEphemeralBackend::new();
        let fence = ConnectionEffectFence::session("inc", "grant", "session", 1);
        backend.enqueue_durable("conn", b"unbound-ordinary".to_vec());
        let selected = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .expect("select unbound ordinary frame through exact drain");
        let (_, permit, lease) = selected.into_leased_parts();
        assert!(permit.is_none());

        backend.overflow_outbox_for_test("conn", Some(fence.clone()));
        match lease.try_commit((), |()| Ok(())) {
            OutboxLeaseCommit::Superseded(()) => {}
            OutboxLeaseCommit::Committed | OutboxLeaseCommit::OfferFailed(()) => {
                panic!("an eligible exact marker must supersede an unbound ordinary offer")
            }
        }
        lease.wake();
        drop(lease);

        let marker = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .expect("exact marker wins the retry");
        assert!(marker.is_recovery_marker());
        assert!(marker.commit_handoff());
        let ordinary = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .expect("unbound ordinary frame remains after marker acceptance");
        assert!(matches!(
            ordinary.envelope(),
            RealtimeEnvelope::Durable(message) if message.payload == b"unbound-ordinary"
        ));
    }

    #[tokio::test]
    async fn marker_preempted_public_commit_releases_and_rewakes_the_queue() {
        let backend = LocalEphemeralBackend::new();
        let fence = ConnectionEffectFence::session("inc", "grant", "session", 1);
        backend.enqueue_durable("conn", b"ordinary".to_vec());
        let selected = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .expect("select ordinary frame");
        let notifier = backend.delivery_notifier();
        let (_generation, waker) = notifier.register("conn").unwrap();

        backend.overflow_outbox_for_test("conn", Some(fence.clone()));
        tokio::time::timeout(std::time::Duration::from_secs(1), waker.notified())
            .await
            .expect("consume the overflow enqueue wake");
        assert!(!selected.commit_handoff());
        tokio::time::timeout(std::time::Duration::from_secs(1), waker.notified())
            .await
            .expect("marker-preemptive lease release must announce the retry");

        let marker = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .expect("rewoken retry selects the marker");
        assert!(marker.is_recovery_marker());
    }

    #[test]
    fn selected_exact_marker_loses_to_later_unbound_marker() {
        let backend = LocalEphemeralBackend::new();
        let fence = ConnectionEffectFence::session("inc", "grant", "session", 1);
        backend.overflow_outbox_for_test("conn", Some(fence.clone()));
        let selected = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .expect("select exact recovery marker");
        let (_, permit, lease) = selected.into_leased_parts();
        assert!(permit.is_none());

        backend.overflow_outbox_for_test("conn", None);
        match lease.try_commit((), |()| Ok(())) {
            OutboxLeaseCommit::Superseded(()) => {}
            OutboxLeaseCommit::Committed | OutboxLeaseCommit::OfferFailed(()) => {
                panic!("a later unbound marker must supersede a selected exact marker")
            }
        }
        lease.wake();
        drop(lease);

        let higher = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .expect("unbound marker wins the retry");
        let RealtimeEnvelope::Durable(message) = higher.envelope() else {
            panic!("expected durable recovery marker");
        };
        assert_eq!(message.effect_fence(), None);
        assert!(higher.commit_handoff());
        let lower = backend
            .drain_outbox_for_send_bound("conn", &fence)
            .pop()
            .expect("exact marker remains after broader recovery");
        let RealtimeEnvelope::Durable(message) = lower.envelope() else {
            panic!("expected exact durable recovery marker");
        };
        assert_eq!(message.effect_fence(), Some(&fence));
    }

    #[test]
    fn predecessor_purge_invalidates_poison_lease_but_not_recovery_obligation() {
        let backend = LocalEphemeralBackend::new();
        let predecessor = ConnectionEffectFence::session("inc", "grant-old", "session", 1);
        let successor = ConnectionEffectFence::session("inc", "grant-new", "session", 2);
        let outbox = backend.ensure_outbox("conn");
        assert!(lock(&outbox).poison_all_authorities());

        let selected = backend
            .drain_outbox_for_send_bound("conn", &predecessor)
            .pop()
            .unwrap();
        let (_, permit, old_lease) = selected.into_leased_parts();
        assert!(permit.is_none());
        assert_eq!(
            lock(&outbox).active_lease_effect_fence.as_ref(),
            Some(&predecessor)
        );

        lock(&outbox).purge_effect_fence(&predecessor);
        assert!(lock(&outbox).all_authorities_poisoned);
        assert!(
            !OutboxDrainLease::acknowledge_all(std::slice::from_ref(&old_lease)),
            "the predecessor HTTP body cannot consume successor recovery"
        );
        drop(old_lease);

        let successor_marker = backend
            .drain_outbox_for_send_bound("conn", &successor)
            .pop()
            .expect("the successor must inherit the global recovery obligation");
        let RealtimeEnvelope::Durable(signal) = successor_marker.envelope() else {
            panic!("expected successor poison marker");
        };
        assert_eq!(signal.effect_fence(), Some(&successor));
        assert!(successor_marker.commit_handoff());
        assert!(!lock(&outbox).all_authorities_poisoned);
    }

    #[test]
    fn exact_selection_binds_unbound_marker_across_connection_replacement() {
        let backend = LocalEphemeralBackend::new();
        let predecessor = ConnectionEffectFence::session("inc", "grant-old", "session", 1);
        let successor = ConnectionEffectFence::session("inc", "grant-new", "session", 2);
        let outbox = backend.ensure_outbox("conn");
        assert!(lock(&outbox).overflow(None, None).overflowed);

        let selected = backend
            .drain_outbox_for_send_bound("conn", &predecessor)
            .pop()
            .unwrap();
        let (_, permit, old_lease) = selected.into_leased_parts();
        assert!(permit.is_none());
        lock(&outbox).purge_effect_fence(&predecessor);
        assert!(lock(&outbox).overflowed);
        assert!(
            !OutboxDrainLease::acknowledge_all(std::slice::from_ref(&old_lease)),
            "an authority-independent marker still belongs to its selecting exact grant"
        );
        drop(old_lease);

        let successor_marker = backend
            .drain_outbox_for_send_bound("conn", &successor)
            .pop()
            .expect("the successor must receive the unbound recovery marker");
        let RealtimeEnvelope::Durable(signal) = successor_marker.envelope() else {
            panic!("expected unbound overflow marker");
        };
        assert!(signal.effect_fence().is_none());
        assert!(successor_marker.commit_handoff());
        assert!(!lock(&outbox).overflowed);
    }

    #[test]
    fn exact_selection_binds_authority_independent_frame_to_selecting_grant() {
        let backend = LocalEphemeralBackend::new();
        let predecessor = ConnectionEffectFence::session("inc", "grant-old", "session", 1);
        let successor = ConnectionEffectFence::session("inc", "grant-new", "session", 2);
        let outbox = backend.ensure_outbox("conn");
        backend.enqueue_durable("conn", b"unbound".to_vec());

        let selected = backend
            .drain_outbox_for_send_bound("conn", &predecessor)
            .pop()
            .unwrap();
        let (_, permit, old_lease) = selected.into_leased_parts();
        assert!(permit.is_none());
        lock(&outbox).purge_effect_fence(&predecessor);
        assert!(
            !OutboxDrainLease::acknowledge_all(std::slice::from_ref(&old_lease)),
            "an unbound frame cannot be accepted by a replaced exact HTTP grant"
        );
        drop(old_lease);

        let retry = backend
            .drain_outbox_for_send_bound("conn", &successor)
            .pop()
            .expect("successor retries the authority-independent frame");
        let RealtimeEnvelope::Durable(message) = retry.envelope() else {
            panic!("expected durable retry");
        };
        assert_eq!(message.payload.as_slice(), b"unbound");
    }

    #[tokio::test]
    async fn predecessor_purge_wakes_successor_for_preserved_unbound_work() {
        let backend = LocalEphemeralBackend::new();
        let predecessor = ConnectionEffectFence::session("inc", "grant-old", "session", 1);
        let successor = ConnectionEffectFence::session("inc", "grant-new", "session", 2);
        backend.enqueue_durable("reused", b"preserved".to_vec());

        let selected = backend
            .drain_outbox_for_send_bound("reused", &predecessor)
            .pop()
            .expect("the predecessor selects the shared frame");
        let (_, _, predecessor_lease) = selected.into_leased_parts();

        let notifier = backend.delivery_notifier();
        let (_successor_generation, successor_waker) = notifier
            .register_bound("reused", "grant-new")
            .expect("the successor registers before predecessor retirement");
        assert!(
            backend
                .drain_outbox_for_send_bound("reused", &successor)
                .is_empty(),
            "the predecessor's active lease parks the successor's initial drain"
        );

        backend.purge_connection_effects("reused", &predecessor);
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            successor_waker.notified(),
        )
        .await
        .expect("purge must promptly wake the successor without a heartbeat");

        assert!(
            !OutboxDrainLease::acknowledge_all(std::slice::from_ref(&predecessor_lease)),
            "the invalidated predecessor cannot acknowledge preserved work"
        );
        let retry = backend
            .drain_outbox_for_send_bound("reused", &successor)
            .pop()
            .expect("the wake announces a successor retry");
        let RealtimeEnvelope::Durable(message) = retry.envelope() else {
            panic!("expected preserved durable frame");
        };
        assert_eq!(message.payload.as_slice(), b"preserved");
        assert!(retry.commit_handoff());
    }

    /// @ref LLP 0059#typed-terminal-auth-error — releasing an active exact
    /// lease may expose preserved work, but auth terminalization must not wake
    /// the socket until the typed terminal event is visible.
    #[tokio::test]
    async fn terminal_exact_purge_releases_active_lease_without_preterminal_wake() {
        let backend = LocalEphemeralBackend::new();
        let predecessor = ConnectionEffectFence::session("inc", "grant-old", "session", 1);
        backend.enqueue_durable("terminal", b"preserved".to_vec());
        let selected = backend
            .drain_outbox_for_send_bound("terminal", &predecessor)
            .pop()
            .expect("predecessor selects the shared frame");
        let (_, _, predecessor_lease) = selected.into_leased_parts();

        let notifier = backend.delivery_notifier();
        let (generation, waker) = notifier
            .register_bound("terminal", "grant-old")
            .expect("register exact terminal socket");
        backend.purge_connection_effects_silently("terminal", &predecessor);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(25), waker.notified())
                .await
                .is_err(),
            "lease release cannot spend the socket's only wake before terminal data exists"
        );
        assert!(
            notifier
                .terminal_if_current("terminal", generation)
                .is_none(),
            "the barrier remains preterminal until the lifecycle installs its event"
        );
        assert!(
            !OutboxDrainLease::acknowledge_all(std::slice::from_ref(&predecessor_lease)),
            "the silently purged predecessor lease cannot acknowledge preserved work"
        );

        let event = DeliveryTerminalEvent {
            code: LiveAuthErrorCode::SessionExpired,
            reason: LiveAuthErrorReason::Revoked,
            authority_disposition: LiveAuthorityDisposition::DurableDelete,
            close_by: std::time::Instant::now() + std::time::Duration::from_secs(5),
        };
        assert!(notifier.terminalize_bound("terminal", "grant-old", event));
        tokio::time::timeout(std::time::Duration::from_secs(1), waker.notified())
            .await
            .expect("typed terminal installation owns the first wake");
        assert_eq!(
            notifier.terminal_if_current("terminal", generation),
            Some(event)
        );
    }

    #[test]
    fn coalescing_replacement_supersedes_lease_without_failing_stream() {
        let backend = LocalEphemeralBackend::new();
        let outbox = backend.ensure_outbox("conn");
        let upsert = |value: &[u8], entry_version| {
            Arc::new(EphemeralMessage::Upsert {
                ephemeral_authority_instance: None,
                room: room(),
                room_authority_generation: 0,
                entry: EphemeralEntry {
                    key: EntryKey("cursor".to_owned()),
                    value: value.to_vec(),
                    received_at_ms: 1,
                    expires_at_ms: 10,
                    scope_epoch: 1,
                    entry_version,
                },
            })
        };
        lock(&outbox).push_ephemeral(upsert(b"old", 1), MAX_OUTBOX_BACKLOG, None);
        let selected = backend.drain_outbox_for_send("conn").pop().unwrap();
        assert!(
            lock(&outbox)
                .push_ephemeral(upsert(b"new", 2), MAX_OUTBOX_BACKLOG, None)
                .coalesced
        );

        let (_, permit, lease) = selected.into_leased_parts();
        assert!(permit.is_none());
        match lease.try_commit((), |()| Ok(())) {
            OutboxLeaseCommit::Superseded(()) => {}
            OutboxLeaseCommit::Committed | OutboxLeaseCommit::OfferFailed(()) => {
                panic!("replacement must be a benign supersession, not a sink failure")
            }
        }
        lease.wake();
        drop(lease);

        let replacement = backend.drain_outbox_for_send("conn").pop().unwrap();
        let RealtimeEnvelope::Ephemeral(EphemeralMessage::Upsert { entry, .. }) =
            replacement.envelope()
        else {
            panic!("expected replacement upsert");
        };
        assert_eq!(entry.value.as_slice(), b"new");
    }

    #[test]
    fn full_ephemeral_map_conversion_releases_invalidated_batch_binding() {
        let fence = ConnectionEffectFence::session("inc", "grant", "session", 1);
        let upsert = |key: &str, entry_version| {
            Arc::new(EphemeralMessage::Upsert {
                ephemeral_authority_instance: None,
                room: room(),
                room_authority_generation: 0,
                entry: EphemeralEntry {
                    key: EntryKey(key.to_owned()),
                    value: key.as_bytes().to_vec(),
                    received_at_ms: 1,
                    expires_at_ms: 10,
                    scope_epoch: 1,
                    entry_version,
                },
            })
        };
        let mut queue = OutboundQueue::new();
        queue.push_ephemeral(upsert("first", 1), 1, Some(fence.clone()));
        let selected = queue.drain_with_authority_bounded(
            Some(&fence),
            1,
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert_eq!(selected.len(), 1);
        assert_eq!(queue.active_lease_effect_fence.as_ref(), Some(&fence));

        let converted = queue.push_ephemeral(upsert("second", 2), 1, Some(fence.clone()));
        assert_eq!(converted.resync_count, 1);
        assert!(!queue.has_active_leases());
        assert!(queue.active_lease_effect_fence.is_none());
        assert_eq!(queue.active_lease_binding_bytes, 0);

        let retry = queue.drain_with_authority_bounded(
            Some(&fence),
            MAX_OUTBOX_DRAIN_BATCH,
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert_eq!(retry.len(), 1);
        assert!(retry.iter().all(|selected| matches!(
            selected.envelope,
            RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired { .. })
        )));
    }

    #[test]
    fn http_batch_acknowledgement_prevalidates_every_lease() {
        let backend = LocalEphemeralBackend::new();
        let fence = ConnectionEffectFence::session("inc", "grant", "session", 1);
        let outbox = backend.ensure_outbox("conn");
        backend.enqueue_durable("conn", b"unbound".to_vec());
        backend.enqueue_durable_bound("conn", b"bound".to_vec(), fence.clone());

        let selected = backend.drain_outbox_for_send_bound("conn", &fence);
        assert_eq!(selected.len(), 2);
        let leases = selected
            .into_iter()
            .map(|selected| {
                let (_, permit, lease) = selected.into_leased_parts();
                assert!(permit.is_none());
                lease
            })
            .collect::<Vec<_>>();

        lock(&outbox).purge_effect_fence(&fence);
        assert!(
            !OutboxDrainLease::acknowledge_all(&leases),
            "one stale member rejects the complete HTTP ownership batch"
        );
        assert_eq!(
            lock(&outbox).durable.len(),
            1,
            "prevalidation must not partially remove the current unbound frame"
        );
        drop(leases);

        let retry = backend.drain_outbox("conn");
        assert_eq!(retry.len(), 1);
        let RealtimeEnvelope::Durable(message) = &retry[0] else {
            panic!("expected unbound retry");
        };
        assert_eq!(message.payload.as_slice(), b"unbound");
    }

    #[test]
    fn destructive_cleanup_compacts_deques_and_preserves_byte_ledger() {
        let predecessor = ConnectionEffectFence::session("inc", "grant-old", "session", 1);
        let successor = ConnectionEffectFence::session("inc", "grant-new", "session", 2);
        let mut queue = OutboundQueue::new();
        for _ in 0..128 {
            queue.push_durable(DurableMessage::bound(
                b"predecessor".to_vec(),
                predecessor.clone(),
            ));
        }
        queue.push_durable(DurableMessage::bound(b"successor".to_vec(), successor));
        queue.purge_effect_fence(&predecessor);
        assert_eq!(queue.durable.len(), 1);
        assert!(queue.durable.capacity() <= 4);
        assert_eq!(
            queue.retained_bytes(),
            recompute_queue_retained_bytes(&queue)
        );

        let mut queue = OutboundQueue::new();
        for _ in 0..(MAX_OUTBOX_DRAIN_BATCH * 2) {
            queue.push_durable(DurableMessage::new(b"frame".to_vec()));
        }
        let selected = queue.drain_with_authority_bounded(
            None,
            MAX_OUTBOX_DRAIN_BATCH,
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert_eq!(selected.len(), MAX_OUTBOX_DRAIN_BATCH);
        assert!(
            queue.acknowledge_leases(
                &selected
                    .iter()
                    .map(|selected| selected.lease_id)
                    .collect::<Vec<_>>()
            )
        );
        assert!(queue.durable.capacity() <= queue.durable.len().saturating_mul(2));
        assert_eq!(
            queue.retained_bytes(),
            recompute_queue_retained_bytes(&queue)
        );

        let selected = queue.drain_with_authority_bounded(
            None,
            MAX_OUTBOX_DRAIN_BATCH,
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        assert!(
            queue.acknowledge_leases(
                &selected
                    .iter()
                    .map(|selected| selected.lease_id)
                    .collect::<Vec<_>>()
            )
        );
        assert!(queue.durable.is_empty());
        assert_eq!(queue.durable.capacity(), 0);
        assert_eq!(queue.retained_bytes(), 0);
    }

    #[test]
    fn bound_filled_queue_cannot_displace_unbound_overflow_signal() {
        let backend = LocalEphemeralBackend::new();
        let bound = ConnectionEffectFence::session("inc", "grant", "session", 1);

        for _ in 0..MAX_OUTBOX_BACKLOG {
            let outcome = backend.enqueue_durable_bound("shared", b"bound".to_vec(), bound.clone());
            assert!(!outcome.overflowed_now);
        }
        let outcome = backend.enqueue_durable("shared", b"unbound-first-frame".to_vec());
        assert!(outcome.overflowed_now);
        assert!(outcome.parked_behind_overflow);

        let unbound = backend.drain_outbox("shared");
        assert_eq!(
            unbound.len(),
            1,
            "the compatibility drain leaks no bound frame"
        );
        let RealtimeEnvelope::Durable(signal) = &unbound[0] else {
            panic!("expected the unbound durable overflow signal");
        };
        assert!(signal.effect_fence().is_none());
        let signal: serde_json::Value = serde_json::from_slice(&signal.payload).unwrap();
        assert_eq!(signal["kind"], "resync_required");
        assert_eq!(signal["reason"], "outbox_overflow");
        assert_eq!(signal["clear_retained"], true);

        let mut bound_payloads = Vec::new();
        loop {
            let batch = backend.drain_outbox_for_send_bound("shared", &bound);
            if batch.is_empty() {
                break;
            }
            bound_payloads.extend(batch.into_iter().filter_map(|admitted| {
                match admitted.into_parts().0 {
                    RealtimeEnvelope::Durable(message) => Some(message.payload),
                    RealtimeEnvelope::Ephemeral(_) => None,
                }
            }));
        }
        assert_eq!(bound_payloads.len(), MAX_OUTBOX_BACKLOG);
        assert!(
            bound_payloads
                .iter()
                .all(|payload| payload.as_slice() == b"bound")
        );

        backend.enqueue_durable("shared", b"fresh".to_vec());
        let after = backend.drain_outbox("shared");
        assert_eq!(after.len(), 1);
        let RealtimeEnvelope::Durable(message) = &after[0] else {
            panic!("expected the fresh unbound message");
        };
        assert_eq!(message.payload.as_slice(), b"fresh");
    }

    #[test]
    fn exact_effect_purge_prunes_empty_room_and_releases_active_room_capacity() {
        let backend = LocalEphemeralBackend::with_limits(EphemeralStoreLimits {
            max_active_rooms: 1,
            ..EphemeralStoreLimits::default()
        });
        backend
            .register_collection(EphemeralCollection::local_cursor("cursors", "boardId"))
            .unwrap();
        let request = |board: &str| SubscribeRequest {
            collection: "cursors".to_owned(),
            scope: Scope::from_pairs([("boardId", board)]),
            connection_id: "terminal".to_owned(),
            auth: AuthContext::default(),
            since_chunk: None,
        };
        let predecessor = ConnectionEffectFence::session("inc", "grant-old", "session", 1);
        backend
            .subscribe_with_room_authority_and_effect_fence(
                request("old"),
                1_000,
                None,
                Some(predecessor.clone()),
            )
            .expect("predecessor subscriber creates the only room");
        assert_eq!(backend.diagnostics().room_count, 1);
        assert_retained_accounting(&backend);

        backend.purge_connection_effects("terminal", &predecessor);

        assert_eq!(backend.diagnostics().room_count, 0);
        assert_retained_accounting(&backend);
        backend
            .subscribe_with_room_authority_and_effect_fence(
                request("successor"),
                1_001,
                None,
                Some(ConnectionEffectFence::session(
                    "inc",
                    "grant-new",
                    "session",
                    2,
                )),
            )
            .expect("terminal purge must release active-room capacity");
        assert_eq!(backend.diagnostics().room_count, 1);
        assert_retained_accounting(&backend);
    }

    #[test]
    fn effect_fenced_ephemeral_coalescing_cannot_overwrite_successor() {
        let predecessor = ConnectionEffectFence::session("inc", "grant-old", "session", 1);
        let successor = ConnectionEffectFence::session("inc", "grant-new", "session", 2);
        let upsert = |value: &[u8], entry_version| {
            Arc::new(EphemeralMessage::Upsert {
                ephemeral_authority_instance: None,
                room: room(),
                room_authority_generation: 1,
                entry: EphemeralEntry {
                    key: EntryKey("cursor".to_owned()),
                    value: value.to_vec(),
                    received_at_ms: 1,
                    expires_at_ms: 10,
                    scope_epoch: 1,
                    entry_version,
                },
            })
        };
        let mut queue = OutboundQueue::new();
        queue.push_ephemeral(
            upsert(b"successor", 2),
            MAX_OUTBOX_BACKLOG,
            Some(successor.clone()),
        );
        // The delayed predecessor arrives last for the same room/key. Its
        // coalescing domain must still be disjoint from the successor.
        queue.push_ephemeral(
            upsert(b"predecessor", 1),
            MAX_OUTBOX_BACKLOG,
            Some(predecessor.clone()),
        );
        assert_eq!(queue.ephemeral.len(), 2);

        queue.purge_effect_fence(&predecessor);
        let drained = queue.drain_with_authority(
            Some(&successor),
            |_| FrameAuthorityDisposition::Send,
            |_| FrameAuthorityDisposition::Send,
        );
        let values = drained
            .into_iter()
            .filter_map(|message| match message {
                RealtimeEnvelope::Ephemeral(EphemeralMessage::Upsert { entry, .. }) => {
                    Some(entry.value)
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(values, vec![b"successor".to_vec()]);
    }
}
