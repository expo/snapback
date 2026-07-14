use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, MutexGuard, PoisonError, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Notify;

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::live_wire::{LiveAuthErrorCode, LiveAuthErrorReason};
use crate::storage::{
    AuthorizationCommitImpact, AuthorizationCommitInterlock, AuthorizationCommitWitness,
    AuthorizationVersion, ChangeOp, PreparedAuthorizationCommit,
};

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
pub(crate) struct DeliveryTerminalEvent {
    pub(crate) code: LiveAuthErrorCode,
    pub(crate) reason: LiveAuthErrorReason,
    pub(crate) close_by: std::time::Instant,
}

impl Default for DeliveryNotifierState {
    fn default() -> Self {
        Self {
            next_generation: Some(1),
            waiters: HashMap::new(),
        }
    }
}

#[derive(Default)]
pub struct DeliveryNotifier {
    state: StdMutex<DeliveryNotifierState>,
}

impl DeliveryNotifier {
    /// Register interest in a connection's deliveries. Returns this
    /// registration's generation and the waker; a later `register` for the
    /// same connection replaces the waker and supersedes the generation.
    pub fn register(&self, connection_id: &str) -> SnapbackResult<(u64, Arc<Notify>)> {
        self.register_inner(connection_id, None)
    }

    /// Register a socket against the opaque grant that authorized its
    /// upgrade. Terminal propagation compares both identities; the readable
    /// connection id alone is deliberately insufficient.
    pub(crate) fn register_bound(
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
        let mut state = lock(&self.state);
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

    /// Unregister only if `generation` still owns the connection's waker.
    /// Returns whether the caller was the current owner — a stale task (its
    /// registration already replaced by a reconnect) gets `false` and must
    /// not perform connection teardown.
    pub fn unregister(&self, connection_id: &str, generation: u64) -> bool {
        let mut state = lock(&self.state);
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
            lock(&self.state).waiters.get(connection_id),
            Some(current) if current.generation == generation
        )
    }

    /// Whether ordinary effects may still drain to this exact registration.
    /// Terminal ownership remains current for guarded teardown, but ordinary
    /// bytes stop at the same notifier cut that installs the auth error.
    pub(crate) fn is_deliverable(&self, connection_id: &str, generation: u64) -> bool {
        matches!(
            lock(&self.state).waiters.get(connection_id),
            Some(current) if current.generation == generation && current.terminal.is_none()
        )
    }

    /// Install a terminal event only for the exact bound grant. A later
    /// registration on the same readable id has a different grant id and is
    /// untouched. The wake happens after the event is visible under the same
    /// mutex, so the stream cannot observe a wake without its terminal data.
    pub(crate) fn terminalize_bound(
        &self,
        connection_id: &str,
        grant_id: &str,
        event: DeliveryTerminalEvent,
    ) -> bool {
        let notify = {
            let mut state = lock(&self.state);
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

    pub(crate) fn terminal_if_current(
        &self,
        connection_id: &str,
        generation: u64,
    ) -> Option<DeliveryTerminalEvent> {
        let state = lock(&self.state);
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
    fn act_if_current<T>(
        &self,
        connection_id: &str,
        generation: u64,
        act: impl FnOnce() -> T,
    ) -> Option<T> {
        let state_guard = lock(&self.state);
        let current = matches!(
            state_guard.waiters.get(connection_id),
            Some(current) if current.generation == generation && current.terminal.is_none()
        );
        let output = current.then(act);
        drop(state_guard);
        output
    }

    fn act_with_registration<T>(&self, connection_id: &str, act: impl FnOnce(bool) -> T) -> T {
        let state_guard = lock(&self.state);
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
        lock(&self.state).waiters.contains_key(connection_id)
    }

    fn wake(&self, connection_id: &str) {
        if let Some(registration) = lock(&self.state).waiters.get(connection_id) {
            registration.notify.notify_one();
        }
    }

    fn wake_many(&self, connection_ids: &[ConnectionId]) {
        if connection_ids.is_empty() {
            return;
        }
        let state = lock(&self.state);
        for connection_id in connection_ids {
            if let Some(registration) = state.waiters.get(connection_id) {
                registration.notify.notify_one();
            }
        }
    }
}

pub type Millis = u64;
pub type ConnectionId = String;

/// Internal owner identity for every delayed connection-scoped effect. The
/// readable connection id is deliberately absent: it is a routing address that
/// may be reused, while this value is the non-reusable authority incarnation
/// that produced and may consume the effect.
///
/// @ref LLP 0059#fenced-effects-and-live-closure — queued, room, and outbox
///   effects carry the complete stream/grant/session fence.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct ConnectionEffectFence {
    authorization_stream_incarnation: Arc<str>,
    connection_grant_id: Arc<str>,
    authority: ConnectionEffectAuthority,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) enum ConnectionEffectAuthority {
    Anonymous,
    Session {
        session_id: Arc<str>,
        generation: u64,
    },
}

impl ConnectionEffectFence {
    pub(crate) fn anonymous(
        authorization_stream_incarnation: impl Into<Arc<str>>,
        connection_grant_id: impl Into<Arc<str>>,
    ) -> Self {
        Self {
            authorization_stream_incarnation: authorization_stream_incarnation.into(),
            connection_grant_id: connection_grant_id.into(),
            authority: ConnectionEffectAuthority::Anonymous,
        }
    }

    pub(crate) fn session(
        authorization_stream_incarnation: impl Into<Arc<str>>,
        connection_grant_id: impl Into<Arc<str>>,
        session_id: impl Into<Arc<str>>,
        generation: u64,
    ) -> Self {
        Self {
            authorization_stream_incarnation: authorization_stream_incarnation.into(),
            connection_grant_id: connection_grant_id.into(),
            authority: ConnectionEffectAuthority::Session {
                session_id: session_id.into(),
                generation,
            },
        }
    }
}

#[derive(
    Clone,
    Debug,
    Default,
    Deserialize,
    Eq,
    PartialEq,
    Ord,
    PartialOrd,
    Hash,
    Serialize,
    schemars::JsonSchema,
)]
#[serde(transparent)]
pub struct Scope(BTreeMap<String, String>);

impl Scope {
    pub fn from_pairs<I, K, V>(pairs: I) -> Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        Self(
            pairs
                .into_iter()
                .map(|(key, value)| (key.into(), value.into()))
                .collect(),
        )
    }

    pub fn normalized_key(&self) -> String {
        self.0
            .iter()
            .map(|(key, value)| format!("{}={}", encode_component(key), encode_component(value)))
            .collect::<Vec<_>>()
            .join("|")
    }

    pub(crate) fn get(&self, field: &str) -> Option<&str> {
        self.0.get(field).map(String::as_str)
    }

    fn routed_key(&self, routing_fields: &[String]) -> Option<String> {
        if routing_fields.is_empty() {
            return Some(self.normalized_key());
        }

        let parts = routing_fields
            .iter()
            .map(|field| {
                self.0
                    .get(field)
                    .map(|value| format!("{}={}", encode_component(field), encode_component(value)))
            })
            .collect::<Option<Vec<_>>>()?;

        Some(parts.join("|"))
    }
}

fn encode_component(value: &str) -> String {
    format!("{}:{value}", value.len())
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

#[derive(
    Clone, Debug, Deserialize, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, schemars::JsonSchema,
)]
pub struct RoomId {
    pub collection: String,
    pub scope: Scope,
    pub routing_key: String,
}

#[derive(
    Clone, Debug, Deserialize, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, schemars::JsonSchema,
)]
#[serde(transparent)]
pub struct EntryKey(pub String);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum KeyMode {
    Connection,
    Session,
    User,
    Custom,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize)]
pub enum EntryOwner {
    Connection(ConnectionId),
    Session(String),
    User(String),
    Custom(String),
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct AuthContext {
    pub principal: Option<String>,
    pub session_id: Option<String>,
    pub user_id: Option<String>,
    pub permissions: BTreeSet<String>,
}

impl AuthContext {
    pub fn with_room_permission(mut self, prefix: &str, scope: &Scope) -> Self {
        self.permissions
            .insert(format!("{prefix}:{}", scope.normalized_key()));
        self
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AccessPolicy {
    AllowAll,
    RequireRoomPermission { prefix: String },
}

impl AccessPolicy {
    fn allows(&self, scope: &Scope, auth: &AuthContext) -> bool {
        match self {
            Self::AllowAll => true,
            Self::RequireRoomPermission { prefix } => auth
                .permissions
                .contains(&format!("{prefix}:{}", scope.normalized_key())),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize, schemars::JsonSchema)]
pub struct EphemeralCollection {
    pub name: String,
    #[serde(default, rename = "scopeFields", alias = "scope_fields")]
    pub scope_fields: Vec<String>,
    #[serde(rename = "keyMode", alias = "key_mode")]
    pub key_mode: KeyMode,
    #[serde(rename = "routingFields", alias = "routing_fields")]
    pub routing_fields: Vec<String>,
    #[serde(rename = "defaultTtlMs", alias = "default_ttl_ms")]
    pub default_ttl_ms: Millis,
    #[serde(rename = "maxTtlMs", alias = "max_ttl_ms")]
    pub max_ttl_ms: Millis,
    #[serde(rename = "maxValueBytes", alias = "max_value_bytes")]
    pub max_value_bytes: usize,
    #[serde(rename = "hardMaxValueBytes", alias = "hard_max_value_bytes")]
    pub hard_max_value_bytes: usize,
    #[serde(rename = "sustainedHz", alias = "sustained_hz")]
    pub sustained_hz: u32,
    pub burst: u32,
    #[serde(rename = "dispatchMs", alias = "dispatch_ms")]
    pub dispatch_ms: Millis,
    pub publish: AccessPolicy,
    pub subscribe: AccessPolicy,
    /// Durable row-existence projection that grants the room permission in
    /// sessions mode. The subject field equals the connection-bound user id;
    /// every mapped table field equals its named room-scope field.
    #[serde(
        default,
        rename = "permissionBacking",
        alias = "permission_backing",
        skip_serializing_if = "Option::is_none"
    )]
    pub permission_backing: Option<RoomPermissionProjection>,
    #[serde(
        default = "default_max_pending_ephemeral_keys",
        rename = "maxPendingEphemeralKeys",
        alias = "max_pending_ephemeral_keys"
    )]
    pub max_pending_ephemeral_keys: usize,
}

impl EphemeralCollection {
    pub fn local_cursor(name: impl Into<String>, routing_field: impl Into<String>) -> Self {
        let routing_field = routing_field.into();
        Self {
            name: name.into(),
            scope_fields: vec![routing_field.clone()],
            key_mode: KeyMode::Connection,
            routing_fields: vec![routing_field],
            default_ttl_ms: 5_000,
            max_ttl_ms: 30_000,
            max_value_bytes: 1_024,
            hard_max_value_bytes: 4_096,
            sustained_hz: 20,
            burst: 60,
            dispatch_ms: 33,
            publish: AccessPolicy::AllowAll,
            subscribe: AccessPolicy::AllowAll,
            permission_backing: None,
            max_pending_ephemeral_keys: 1_024,
        }
    }

    pub fn require_room_permission(mut self, prefix: impl Into<String>) -> Self {
        let prefix = prefix.into();
        self.publish = AccessPolicy::RequireRoomPermission {
            prefix: prefix.clone(),
        };
        self.subscribe = AccessPolicy::RequireRoomPermission { prefix };
        self
    }

    pub fn permission_backed_by(mut self, projection: RoomPermissionProjection) -> Self {
        self.permission_backing = Some(projection);
        self
    }

    pub(crate) fn grant_projected_room_permission(
        &self,
        mut auth: AuthContext,
        scope: &Scope,
    ) -> AuthContext {
        for policy in [&self.publish, &self.subscribe] {
            if let AccessPolicy::RequireRoomPermission { prefix } = policy {
                auth.permissions
                    .insert(format!("{prefix}:{}", scope.normalized_key()));
            }
        }
        auth
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoomPermissionProjection {
    pub table: String,
    pub subject_field: String,
    /// Exact room-scope field → backing-table field mapping.
    pub scope_fields: BTreeMap<String, String>,
}

fn default_max_pending_ephemeral_keys() -> usize {
    1_024
}

/// The bound on the durable and resync outbox lanes, independent of a
/// collection's coalescing-map cap. A subscriber that never drains cannot grow
/// either lane past this; hitting it converts the queue to a single resync
/// signal.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L1.
const MAX_OUTBOX_BACKLOG: usize = 1_024;

/// A sticky overflow may need one room-scoped resync for every room whose
/// latest-state lane was discarded. Keep that recovery ledger independently
/// bounded: it may be larger than an ordinary lane, but never grows with
/// lifetime room churn while a peer refuses to drain.
const MAX_OUTBOX_OVERFLOW_RESYNCS: usize = 4_096;

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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct PublishRequest {
    pub collection: String,
    pub scope: Scope,
    pub connection_id: ConnectionId,
    pub session_id: Option<String>,
    pub user_id: Option<String>,
    pub custom_key: Option<String>,
    pub value: Vec<u8>,
    pub ttl_ms: Option<Millis>,
    pub auth: AuthContext,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct DeleteRequest {
    pub collection: String,
    pub scope: Scope,
    pub connection_id: ConnectionId,
    pub session_id: Option<String>,
    pub user_id: Option<String>,
    pub custom_key: Option<String>,
    pub auth: AuthContext,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SubscribeRequest {
    pub collection: String,
    pub scope: Scope,
    pub connection_id: ConnectionId,
    pub auth: AuthContext,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PublishOutcome {
    pub room: RoomId,
    pub key: EntryKey,
    pub scope_epoch: u64,
    pub entry_version: u64,
    pub expires_at_ms: Millis,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum EphemeralErrorCode {
    UnknownCollection,
    Unauthorized,
    InvalidScope,
    MissingKey,
    MissingOwner,
    InvalidTtl,
    ValueTooLarge,
    MetadataTooLarge,
    RateLimited,
    IncompatibleCollectionDefinition,
    /// A hard room/store limit (active rooms, entries per room, subscribers
    /// per room, aggregate room bytes) rejected the operation. The limits are
    /// capability facts; hitting one is a structured rejection, never a
    /// silent eviction of live entries.
    ///
    /// @ref LLP 0013#room-store-model — memory pressure must be explicit.
    RoomLimitExceeded,
    /// A permission-changing transaction installed the room's precommit
    /// authority barrier. No protected sink may act until exact finalization
    /// and fresh reauthorization complete.
    AuthorityPending,
    /// Trusted server-side durable membership denial. Unlike the legacy
    /// `Unauthorized` code, this is safe for the client auth coordinator to
    /// treat as an authorization-loss transition.
    PermissionDenied,
}

impl EphemeralErrorCode {
    pub fn diagnostic_code(self) -> &'static str {
        match self {
            Self::UnknownCollection => "SNAPBACK_EPHEMERAL_UNKNOWN_COLLECTION",
            Self::Unauthorized => "SNAPBACK_EPHEMERAL_UNAUTHORIZED",
            Self::InvalidScope => "SNAPBACK_EPHEMERAL_INVALID_SCOPE",
            Self::MissingKey => "SNAPBACK_EPHEMERAL_MISSING_KEY",
            Self::MissingOwner => "SNAPBACK_EPHEMERAL_MISSING_OWNER",
            Self::InvalidTtl => "SNAPBACK_EPHEMERAL_INVALID_TTL",
            Self::ValueTooLarge => "SNAPBACK_EPHEMERAL_VALUE_TOO_LARGE",
            Self::MetadataTooLarge => "SNAPBACK_EPHEMERAL_METADATA_TOO_LARGE",
            Self::RateLimited => "SNAPBACK_EPHEMERAL_RATE_LIMITED",
            Self::IncompatibleCollectionDefinition => {
                "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
            }
            Self::RoomLimitExceeded => "SNAPBACK_EPHEMERAL_ROOM_LIMIT_EXCEEDED",
            Self::AuthorityPending => "SNAPBACK_EPHEMERAL_AUTHORITY_PENDING",
            Self::PermissionDenied => "SNAPBACK_AUTH_PERMISSION_DENIED",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct EphemeralError {
    pub code: EphemeralErrorCode,
    pub message: String,
}

impl EphemeralError {
    fn new(code: EphemeralErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct EphemeralEntry {
    pub key: EntryKey,
    pub value: Vec<u8>,
    pub received_at_ms: Millis,
    pub expires_at_ms: Millis,
    pub scope_epoch: u64,
    pub entry_version: u64,
}

/// Why an entry was removed. `AuthRevoked` was removed 2026-07-02: durable
/// permission-change revocation is not integrated yet (LLP 0026 §Auth and
/// revocation), so the variant was unreachable vocabulary. Reintroduce it with
/// the event that owns it.
///
/// @ref LLP 0026#finding-scope-epoch-machinery-was-dead-code-recorded-2026-07-02 — live-or-removed resolution.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum RemoveReason {
    Deleted,
    Disconnected,
    Expired,
    AuthRevoked,
}

/// Why a subscriber must resnapshot. `Restarted` is sent when an explicit
/// runtime reset discards room state under live connections; `EpochChanged`
/// when a destructive definition replacement retires room epochs (the
/// ENG-22478 review-fix-D reasons, ratified upstream and adopted by the
/// sharded authority); `Disconnected` when a server-side disconnect (the L2
/// reaper, or the admin route) wiped the connection's room registrations
/// while its socket was still open and registered (ENG-23427). `AuthChanged`
/// was removed 2026-07-02: auth revocation is not integrated, so it was
/// unreachable vocabulary.
///
/// @ref LLP 0026#finding-scope-epoch-machinery-was-dead-code-recorded-2026-07-02 — live-or-removed resolution.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ResyncReason {
    QueueOverflow,
    EpochChanged,
    Restarted,
    Disconnected,
    AuthChanged,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum EphemeralMessage {
    Snapshot {
        room: RoomId,
        scope_epoch: u64,
        room_authority_generation: u64,
        /// Authoritative room cursor at the instant the snapshot and
        /// subscriber registration became one operation. This remains valid
        /// even when `entries` is empty or the newest event was a delete.
        high_water_version: u64,
        entries: Vec<EphemeralEntry>,
    },
    Upsert {
        room: RoomId,
        room_authority_generation: u64,
        entry: EphemeralEntry,
    },
    Remove {
        room: RoomId,
        key: EntryKey,
        scope_epoch: u64,
        room_authority_generation: u64,
        entry_version: u64,
        reason: RemoveReason,
    },
    ResyncRequired {
        room: RoomId,
        scope_epoch: u64,
        room_authority_generation: u64,
        reason: ResyncReason,
    },
    Error {
        room: Option<RoomId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        room_authority_generation: Option<u64>,
        error: EphemeralError,
    },
}

impl EphemeralMessage {
    fn coalesce_key(&self) -> Option<(RoomId, EntryKey)> {
        match self {
            Self::Upsert { room, entry, .. } => Some((room.clone(), entry.key.clone())),
            Self::Remove { room, key, .. } => Some((room.clone(), key.clone())),
            _ => None,
        }
    }

    fn scope_epoch(&self) -> Option<u64> {
        match self {
            Self::Snapshot { scope_epoch, .. }
            | Self::Remove { scope_epoch, .. }
            | Self::ResyncRequired { scope_epoch, .. } => Some(*scope_epoch),
            Self::Upsert { entry, .. } => Some(entry.scope_epoch),
            Self::Error { .. } => None,
        }
    }

    fn entry_version(&self) -> Option<u64> {
        match self {
            Self::Upsert { entry, .. } => Some(entry.entry_version),
            Self::Remove { entry_version, .. } => Some(*entry_version),
            Self::Snapshot {
                high_water_version, ..
            } => Some(*high_water_version),
            Self::ResyncRequired { .. } | Self::Error { .. } => None,
        }
    }

    fn room_authority(&self) -> Option<(&RoomId, u64)> {
        match self {
            Self::Snapshot {
                room,
                room_authority_generation,
                ..
            }
            | Self::Upsert {
                room,
                room_authority_generation,
                ..
            }
            | Self::Remove {
                room,
                room_authority_generation,
                ..
            }
            | Self::ResyncRequired {
                room,
                room_authority_generation,
                ..
            } => Some((room, *room_authority_generation)),
            Self::Error {
                room: Some(room),
                room_authority_generation: Some(generation),
                ..
            } => Some((room, *generation)),
            Self::Error { .. } => None,
        }
    }

    fn resync_room_epoch(&self) -> Option<(RoomId, u64)> {
        match self {
            Self::Snapshot {
                room, scope_epoch, ..
            }
            | Self::Remove {
                room, scope_epoch, ..
            }
            | Self::ResyncRequired {
                room, scope_epoch, ..
            } => Some((room.clone(), *scope_epoch)),
            Self::Upsert { room, entry, .. } => Some((room.clone(), entry.scope_epoch)),
            Self::Error { .. } => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct DurableMessage {
    pub payload: Vec<u8>,
    /// Server-only final-publication witness for an auth-scoped durable
    /// result. Control frames and explicitly authority-independent results do
    /// not carry it. Keeping the stamp out of the wire shape prevents an
    /// implementation fence from becoming caller-controlled protocol data.
    ///
    /// @ref LLP 0053#ephemeral-room-authority-invalidation — the card-game
    ///   kick closes durable-board and room sinks at the same commit boundary.
    #[serde(skip)]
    #[schemars(skip)]
    authorization: Option<AuthorizationVersion>,
    /// Exact non-wire owner of a queued connection effect. Production
    /// connection-scoped queues always set it; `None` remains for explicitly
    /// authority-independent traffic and legacy embedding seams.
    #[serde(skip)]
    #[schemars(skip)]
    effect_fence: Option<ConnectionEffectFence>,
}

impl DurableMessage {
    pub fn new(payload: Vec<u8>) -> Self {
        Self {
            payload,
            authorization: None,
            effect_fence: None,
        }
    }

    pub(crate) fn authorized(payload: Vec<u8>, authorization: AuthorizationVersion) -> Self {
        Self {
            payload,
            authorization: Some(authorization),
            effect_fence: None,
        }
    }

    pub(crate) fn bound(payload: Vec<u8>, effect_fence: ConnectionEffectFence) -> Self {
        Self {
            payload,
            authorization: None,
            effect_fence: Some(effect_fence),
        }
    }

    pub(crate) fn authorized_bound(
        payload: Vec<u8>,
        authorization: AuthorizationVersion,
        effect_fence: ConnectionEffectFence,
    ) -> Self {
        Self {
            payload,
            authorization: Some(authorization),
            effect_fence: Some(effect_fence),
        }
    }

    fn authorization(&self) -> Option<&AuthorizationVersion> {
        self.authorization.as_ref()
    }

    fn effect_fence(&self) -> Option<&ConnectionEffectFence> {
        self.effect_fence.as_ref()
    }
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
struct QueuedEphemeralMessage {
    message: Arc<EphemeralMessage>,
    effect_fence: Option<ConnectionEffectFence>,
}

impl QueuedEphemeralMessage {
    fn new(message: Arc<EphemeralMessage>, effect_fence: Option<ConnectionEffectFence>) -> Self {
        Self {
            message,
            effect_fence,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CollectionEnsureOutcome {
    pub collection_count: usize,
    pub preserved_room_count: usize,
    pub preserved_outbox_count: usize,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RealtimeLane {
    Durable,
    EphemeralLatest,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum RealtimeEnvelope {
    Durable(DurableMessage),
    Ephemeral(EphemeralMessage),
}

impl RealtimeEnvelope {
    pub fn lane(&self) -> RealtimeLane {
        match self {
            Self::Durable(_) => RealtimeLane::Durable,
            Self::Ephemeral(_) => RealtimeLane::EphemeralLatest,
        }
    }
}

/// One destructively drained transport frame paired with the publication
/// permit that made that drain admissible. Keep this value alive until the
/// final transport handoff: a concurrently prepared authorization commit
/// waits for durable authorization and protected-room publications alike.
///
/// Embeddings can serialize [`Self::envelope`] while retaining this wrapper.
/// Consuming or dropping it before the sink completes releases the commit
/// interlock and is therefore not a valid publication handoff.
#[must_use = "an admitted realtime frame must remain alive through its final transport sink"]
pub struct AdmittedRealtimeEnvelope {
    envelope: RealtimeEnvelope,
    publication_authority: Option<RealtimePublicationPermit>,
}

impl AdmittedRealtimeEnvelope {
    pub fn envelope(&self) -> &RealtimeEnvelope {
        &self.envelope
    }

    pub(crate) fn into_parts(self) -> (RealtimeEnvelope, Option<RealtimePublicationPermit>) {
        (self.envelope, self.publication_authority)
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
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EphemeralRoomDiagnostics {
    pub collection: String,
    pub routing_key: String,
    pub scope: Scope,
    pub scope_epoch: u64,
    pub entries: usize,
    pub subscribers: usize,
    pub value_bytes: usize,
    pub retained_bytes: usize,
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

    fn allocate_version(&mut self) -> u64 {
        let version = self.next_entry_version;
        self.next_entry_version += 1;
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
    durable: VecDeque<DurableMessage>,
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
    // capacity converts the whole queue to a single resync signal (sticky until
    // drained), never a silent drop.
    overflowed: bool,
    overflowed_effect_fences: BTreeSet<ConnectionEffectFence>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FrameAuthorityDisposition {
    Send,
    Retain,
    DropStale,
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
    pub(crate) overflowed_now: bool,
    /// The payload is represented only by the sticky overflow sentinel (the
    /// queue was already overflowed or became overflowed on this enqueue).
    pub(crate) parked_behind_overflow: bool,
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
        }
    }

    fn is_overflowed(&self, effect_fence: Option<&ConnectionEffectFence>) -> bool {
        effect_fence.map_or(self.overflowed, |effect_fence| {
            self.overflowed_effect_fences.contains(effect_fence)
        })
    }

    fn recompute_retained_bytes(&mut self) {
        self.durable_bytes = self.durable.iter().fold(0, |total, message| {
            total.saturating_add(retained_durable_queue_item_bytes(message))
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
    }

    fn retained_bytes(&self) -> usize {
        self.durable_bytes
            .saturating_add(self.resync_bytes)
            .saturating_add(self.ephemeral_bytes)
    }

    fn fits_bytes(&self, removed: usize, added: usize) -> bool {
        self.retained_bytes()
            .saturating_sub(removed)
            .saturating_add(added)
            <= MAX_OUTBOX_RETAINED_BYTES
    }

    /// Convert the queue to a single durable resync signal: the connection is
    /// too far behind to replay its backlog, so drop all pending state and tell
    /// the client to re-snapshot rather than losing updates silently. Sticky
    /// until `drain` empties the queue.
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
            .retain(|message| message.effect_fence() != effect_fence.as_ref());
        self.resync
            .retain(|message| message.effect_fence.as_ref() != effect_fence.as_ref());
        self.ephemeral
            .retain(|_, message| message.effect_fence.as_ref() != effect_fence.as_ref());
        self.recompute_retained_bytes();
        // Typed since ENG-23891 (LLP 0051 D4). Wire note: the pre-typed frame
        // spelled this field `clearRetained`; the typed envelope unified it to
        // the durable lane's `clear_retained` (no shipped client read it).
        let sentinel_payload =
            serde_json::to_vec(&crate::live_wire::LiveEnvelope::ResyncRequired {
                reason: "outbox_overflow".to_owned(),
                subscription_id: None,
                scope: None,
                epoch: None,
                clear_retained: true,
            })
            .unwrap_or_default();
        let sentinel = match effect_fence.clone() {
            Some(fence) => DurableMessage::bound(sentinel_payload, fence),
            None => DurableMessage::new(sentinel_payload),
        };
        let sentinel_bytes = retained_durable_queue_item_bytes(&sentinel);
        if self.durable.len() < MAX_OUTBOX_BACKLOG && self.fits_bytes(0, sentinel_bytes) {
            self.durable_bytes = self.durable_bytes.saturating_add(sentinel_bytes);
            self.durable.push_back(sentinel);
        }
        if let Some(effect_fence) = &effect_fence {
            self.overflowed_effect_fences.insert(effect_fence.clone());
        } else {
            self.overflowed = true;
        }
        let mut resync_count = 0;
        for (room, (scope_epoch, room_authority_generation)) in resync_epochs {
            resync_count += self.record_overflow_resync_for_room(
                room,
                scope_epoch,
                room_authority_generation,
                effect_fence.clone(),
            );
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
            return QueuePush {
                resync_count: self.record_overflow_resync(message.as_ref(), effect_fence),
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
            return QueuePush {
                resync_count: self.record_overflow_resync(message.as_ref(), effect_fence),
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

            let mut resync_count: usize = 0;
            let mut overflowed = false;
            for (room, (scope_epoch, room_authority_generation)) in resync_epochs {
                let result = self.push_resync(
                    Arc::new(EphemeralMessage::ResyncRequired {
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
        self.durable.push_back(message);
        QueueOverflow::default()
    }

    /// Drop the lanes that belong to the ephemeral epoch world — the
    /// latest-state map and the resync lane — while preserving the durable
    /// lane. Pending `live_replace`/`live_delta` payloads answer durable
    /// subscriptions that survive an ephemeral boundary (`apply_schema`
    /// leaves `LocalSnapback::subscriptions` fully live), so discarding them
    /// here would be a silent drop no resync signal ever repairs (ENG-23346).
    /// An overflowed queue is left as-is: its durable lane already holds
    /// exactly the sticky connection-wide resync sentinel.
    ///
    /// @ref LLP 0008#realtime-delivery — never a silent drop.
    fn clear_ephemeral_lanes(&mut self) {
        self.resync.clear();
        self.resync.shrink_to_fit();
        self.ephemeral.clear();
        self.resync_bytes = 0;
        self.ephemeral_bytes = 0;
    }

    /// Remove only frames produced for one exact connection grant. This is
    /// safe after readable-id reuse: successor and authority-independent
    /// traffic remain in the shared queue.
    fn purge_effect_fence(&mut self, effect_fence: &ConnectionEffectFence) {
        self.durable.retain(|message| {
            message
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
        self.recompute_retained_bytes();
        self.overflowed_effect_fences.remove(effect_fence);
    }

    fn drain_with_authority(
        &mut self,
        expected_effect_fence: Option<&ConnectionEffectFence>,
        mut classify_durable: impl FnMut(&DurableMessage) -> FrameAuthorityDisposition,
        mut classify_ephemeral: impl FnMut(&EphemeralMessage) -> FrameAuthorityDisposition,
    ) -> Vec<RealtimeEnvelope> {
        let mut messages = Vec::new();
        let mut retained_durable = VecDeque::new();
        while let Some(message) = self.durable.pop_front() {
            let disposition =
                effect_fence_disposition(message.effect_fence(), expected_effect_fence)
                    .unwrap_or_else(|| classify_durable(&message));
            match disposition {
                FrameAuthorityDisposition::Send => {
                    messages.push(RealtimeEnvelope::Durable(message));
                }
                FrameAuthorityDisposition::Retain => retained_durable.push_back(message),
                FrameAuthorityDisposition::DropStale => {}
            }
        }
        self.durable = retained_durable;
        let mut retained_resync = VecDeque::new();
        while let Some(message) = self.resync.pop_front() {
            let disposition =
                effect_fence_disposition(message.effect_fence.as_ref(), expected_effect_fence)
                    .unwrap_or_else(|| classify_ephemeral(message.message.as_ref()));
            match disposition {
                FrameAuthorityDisposition::Send => {
                    messages.push(RealtimeEnvelope::Ephemeral((*message.message).clone()));
                }
                FrameAuthorityDisposition::Retain => retained_resync.push_back(message),
                FrameAuthorityDisposition::DropStale => {}
            }
        }
        self.resync = retained_resync;
        // The pending map coalesces by room/key, whose lexical map order is
        // unrelated to the room authority's monotonic entryVersion. Sort the
        // surviving latest-state messages before transport so a client's room
        // high-water can safely reject any delayed lower-version frame.
        let mut retained_ephemeral = BTreeMap::new();
        let mut ephemeral = Vec::new();
        for (key, message) in std::mem::take(&mut self.ephemeral) {
            let disposition =
                effect_fence_disposition(message.effect_fence.as_ref(), expected_effect_fence)
                    .unwrap_or_else(|| classify_ephemeral(message.message.as_ref()));
            match disposition {
                FrameAuthorityDisposition::Send => ephemeral.push(message),
                FrameAuthorityDisposition::Retain => {
                    retained_ephemeral.insert(key, message);
                }
                FrameAuthorityDisposition::DropStale => {}
            }
        }
        self.ephemeral = retained_ephemeral;
        ephemeral.sort_by(|left, right| {
            left.message
                .resync_room_epoch()
                .cmp(&right.message.resync_room_epoch())
                .then_with(|| {
                    left.message
                        .entry_version()
                        .cmp(&right.message.entry_version())
                })
        });
        for message in ephemeral {
            messages.push(RealtimeEnvelope::Ephemeral((*message.message).clone()));
        }
        self.durable.shrink_to_fit();
        self.recompute_retained_bytes();
        // Sticky overflow clears only after every retained protected frame is
        // either delivered or invalidated by a newer authority generation.
        self.overflowed = self.overflowed
            && (self
                .durable
                .iter()
                .any(|message| message.effect_fence().is_none())
                || self
                    .resync
                    .iter()
                    .any(|message| message.effect_fence.is_none())
                || self
                    .ephemeral
                    .values()
                    .any(|message| message.effect_fence.is_none()));
        let retained_fences = self
            .durable
            .iter()
            .filter_map(|message| message.effect_fence().cloned())
            .chain(
                self.resync
                    .iter()
                    .filter_map(|message| message.effect_fence.clone()),
            )
            .chain(
                self.ephemeral
                    .values()
                    .filter_map(|message| message.effect_fence.clone()),
            )
            .collect::<BTreeSet<_>>();
        self.overflowed_effect_fences
            .retain(|effect_fence| retained_fences.contains(effect_fence));
        messages
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
        let already_queued = self.resync.iter().any(|pending| {
            matches!(
                pending.message.as_ref(),
                EphemeralMessage::ResyncRequired {
                    room: pending_room,
                    ..
                } if pending_room == &room && pending.effect_fence == effect_fence
            )
        });
        if already_queued {
            return 0;
        }
        let message = Arc::new(EphemeralMessage::ResyncRequired {
            room,
            scope_epoch,
            room_authority_generation,
            reason: ResyncReason::QueueOverflow,
        });
        let retained_bytes = retained_resync_queue_item_bytes(message.as_ref());
        if self.resync.len() >= MAX_OUTBOX_OVERFLOW_RESYNCS || !self.fits_bytes(0, retained_bytes) {
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
        ] {
            counter.store(0, Ordering::Relaxed);
        }
    }
}

type SharedRoom = Arc<StdMutex<RoomState>>;
type SharedOutbox = Arc<StdMutex<OutboundQueue>>;

/// Commit-ordered authority transition published for one protected room. This
/// is deliberately separate from `scope_epoch`: permission churn does not
/// claim the room lost its ordinary entry-sequencing continuity.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoomAuthorityResync {
    pub authorization: AuthorizationVersion,
    pub min_commit_version: u64,
    pub room_authority_generation: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct RoomSubscriberReauthorization {
    pub(crate) connection_id: ConnectionId,
    #[cfg(test)]
    pub(crate) previous_auth: AuthContext,
    pub(crate) effect_fence: Option<ConnectionEffectFence>,
}

#[derive(Clone, Debug)]
pub(crate) struct PendingRoomReauthorization {
    pub(crate) room: RoomId,
    pub(crate) obligation: RoomAuthorityResync,
    pub(crate) subscribers: Vec<RoomSubscriberReauthorization>,
}

#[derive(Clone, Debug)]
pub(crate) enum RoomSubscriberResolution {
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

#[derive(Clone, Debug)]
pub struct RoomDependencyTicket {
    ticket_id: u64,
    expected_authorization: AuthorizationVersion,
}

#[derive(Clone, Debug)]
struct RoomDependencyPending {
    expected_authorization: AuthorizationVersion,
    selector: RoomDependencySelector,
    affected_rooms: BTreeSet<RoomId>,
}

/// Conservative selector installed under the same registry admission gate as
/// the affected-room barriers. Exact room ids cover inserts, deletes, and
/// subject-only updates whose permission-backing scope is known. A scope-
/// changing or otherwise untargetable write widens only to the collections
/// backed by that table; activation/destructive events widen to every room.
///
/// @ref LLP 0053#ephemeral-room-authority-invalidation — the selector and
///   matching room barriers install atomically under registry admission.
#[derive(Clone, Debug, Default)]
struct RoomDependencySelector {
    all_protected_rooms: bool,
    collections: BTreeSet<String>,
    rooms: BTreeSet<RoomId>,
}

impl RoomDependencySelector {
    fn all() -> Self {
        Self {
            all_protected_rooms: true,
            ..Self::default()
        }
    }

    fn matches(&self, room: &RoomId) -> bool {
        self.all_protected_rooms
            || self.collections.contains(&room.collection)
            || self.rooms.contains(room)
    }
}

#[derive(Clone, Debug)]
struct RoomAuthorityControl {
    generation: u64,
    active_permits: usize,
    pending_tickets: BTreeSet<u64>,
    resync: Option<RoomAuthorityResync>,
    retired: bool,
}

impl Default for RoomAuthorityControl {
    fn default() -> Self {
        Self {
            generation: 1,
            active_permits: 0,
            pending_tickets: BTreeSet::new(),
            resync: None,
            retired: false,
        }
    }
}

#[derive(Default)]
struct RoomAuthorityRegistryState {
    next_ticket: u64,
    dependencies: BTreeMap<u64, RoomDependencyPending>,
    rooms: BTreeMap<RoomId, RoomAuthorityControl>,
    durable_authorization: Option<AuthorizationVersion>,
    active_durable_publications: usize,
}

struct RoomAuthorityRegistry {
    // One registry owns both publication fences so an authorization ticket and
    // its SQLite commit establish a single cut across durable and room lanes.
    state: StdMutex<RoomAuthorityRegistryState>,
    quiescent: Condvar,
}

impl Default for RoomAuthorityRegistry {
    fn default() -> Self {
        Self {
            state: StdMutex::new(RoomAuthorityRegistryState {
                next_ticket: 1,
                ..RoomAuthorityRegistryState::default()
            }),
            quiescent: Condvar::new(),
        }
    }
}

pub(crate) struct RoomAuthorityPermit {
    registry: Arc<RoomAuthorityRegistry>,
    room: RoomId,
    generation: u64,
}

/// One auth-scoped durable frame admitted at the final transport boundary.
/// An authorization-changing commit installs its dependency ticket under the
/// same registry lock and waits for these permits to quiesce before SQLite may
/// commit. A frame already destructively drained therefore either finishes
/// before the commit or is rejected against the successor authorization.
pub(crate) struct DurableAuthorizationPermit {
    registry: Arc<RoomAuthorityRegistry>,
}

impl Drop for DurableAuthorizationPermit {
    fn drop(&mut self) {
        let mut state = lock(&self.registry.state);
        state.active_durable_publications = state.active_durable_publications.saturating_sub(1);
        self.registry.quiescent.notify_all();
    }
}

/// The single final-publication permit carried by a realtime frame. Durable
/// app rows use the authorization fence; protected ephemeral frames use their
/// exact room generation. Control and authority-independent frames need none.
pub(crate) enum RealtimePublicationPermit {
    Durable { _permit: DurableAuthorizationPermit },
    Room(RoomAuthorityPermit),
}

impl RoomAuthorityPermit {
    fn generation(&self) -> u64 {
        self.generation
    }

    /// Reuse the exact transport permit that admitted the durable lookup.
    /// Pending tickets installed after this permit are allowed: prepare is
    /// waiting for this permit to finish, so the act still linearizes before
    /// commit. Retired or mismatched room identities fail closed.
    fn admitted_generation(
        &self,
        registry: &Arc<RoomAuthorityRegistry>,
        room: &RoomId,
    ) -> Result<u64, EphemeralError> {
        if !Arc::ptr_eq(&self.registry, registry) || &self.room != room {
            return Err(authority_pending_error());
        }
        let state = lock(&registry.state);
        let Some(control) = state.rooms.get(room) else {
            return Err(authority_pending_error());
        };
        if control.retired || control.generation != self.generation {
            return Err(authority_pending_error());
        }
        Ok(self.generation)
    }
}

impl Drop for RoomAuthorityPermit {
    fn drop(&mut self) {
        let mut state = lock(&self.registry.state);
        let remove = if let Some(room) = state.rooms.get_mut(&self.room) {
            room.active_permits = room.active_permits.saturating_sub(1);
            room.retired && room.active_permits == 0 && room.pending_tickets.is_empty()
        } else {
            false
        };
        if remove {
            state.rooms.remove(&self.room);
        }
        self.registry.quiescent.notify_all();
    }
}

impl RoomAuthorityRegistry {
    fn install_durable_authorization(&self, authorization: AuthorizationVersion) {
        let mut state = lock(&self.state);
        state.durable_authorization = Some(authorization);
        self.quiescent.notify_all();
    }

    fn begin_durable_final_send(
        self: &Arc<Self>,
        authorization: &AuthorizationVersion,
    ) -> Result<DurableAuthorizationPermit, EphemeralError> {
        let mut state = lock(&self.state);
        if !state.dependencies.is_empty()
            || state.durable_authorization.as_ref() != Some(authorization)
        {
            return Err(authority_pending_error());
        }
        state.active_durable_publications = state
            .active_durable_publications
            .checked_add(1)
            .ok_or_else(|| {
                EphemeralError::new(
                    EphemeralErrorCode::AuthorityPending,
                    "durable authorization publication permit count exhausted",
                )
            })?;
        Ok(DurableAuthorizationPermit {
            registry: self.clone(),
        })
    }

    fn begin_protected_act(&self, room_id: &RoomId) -> Result<u64, EphemeralError> {
        let mut state = lock(&self.state);
        if state
            .dependencies
            .values()
            .any(|pending| pending.selector.matches(room_id))
        {
            return Err(authority_pending_error());
        }
        let room = state.rooms.entry(room_id.clone()).or_default();
        room.retired = false;
        if !room.pending_tickets.is_empty() || room.resync.is_some() {
            return Err(authority_pending_error());
        }
        room.active_permits = room.active_permits.checked_add(1).ok_or_else(|| {
            EphemeralError::new(
                EphemeralErrorCode::AuthorityPending,
                "protected room authority permit count exhausted",
            )
        })?;
        Ok(room.generation)
    }

    fn begin_final_send(
        self: &Arc<Self>,
        message: &EphemeralMessage,
    ) -> Result<Option<RoomAuthorityPermit>, EphemeralError> {
        let Some((room_id, generation)) = message.room_authority() else {
            return Ok(None);
        };
        let mut state = lock(&self.state);
        let Some(room) = state.rooms.get_mut(room_id) else {
            return if generation == 0 {
                Ok(None)
            } else {
                Err(authority_pending_error())
            };
        };
        if room.retired || room.generation != generation || !room.pending_tickets.is_empty() {
            return Err(authority_pending_error());
        }
        let auth_changed = matches!(
            message,
            EphemeralMessage::ResyncRequired {
                reason: ResyncReason::AuthChanged,
                ..
            }
        );
        match (&room.resync, auth_changed) {
            (None, false) => {}
            (Some(resync), true) if resync.room_authority_generation == generation => {}
            _ => return Err(authority_pending_error()),
        }
        room.active_permits = room.active_permits.checked_add(1).ok_or_else(|| {
            EphemeralError::new(
                EphemeralErrorCode::AuthorityPending,
                "protected room authority permit count exhausted",
            )
        })?;
        Ok(Some(RoomAuthorityPermit {
            registry: self.clone(),
            room: room_id.clone(),
            generation,
        }))
    }

    fn prepare(
        &self,
        expected_authorization: AuthorizationVersion,
        selector: RoomDependencySelector,
    ) -> SnapbackResult<RoomDependencyTicket> {
        let mut state = lock(&self.state);
        let ticket_id = state.next_ticket;
        state.next_ticket = ticket_id.checked_add(1).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_EPHEMERAL_GENERATION_EXHAUSTED",
                "ephemeral",
                "protected room dependency ticket sequence exhausted",
            )
        })?;
        let affected_rooms = state
            .rooms
            .keys()
            .filter(|room| selector.matches(room))
            .cloned()
            .collect::<BTreeSet<_>>();
        for room_id in &affected_rooms {
            state
                .rooms
                .get_mut(room_id)
                .expect("enumerated room remains present under registry gate")
                .pending_tickets
                .insert(ticket_id);
        }
        state.dependencies.insert(
            ticket_id,
            RoomDependencyPending {
                expected_authorization: expected_authorization.clone(),
                selector,
                affected_rooms: affected_rooms.clone(),
            },
        );
        while state.active_durable_publications != 0
            || affected_rooms.iter().any(|room_id| {
                state
                    .rooms
                    .get(room_id)
                    .is_some_and(|room| room.active_permits != 0)
            })
        {
            state = self
                .quiescent
                .wait(state)
                .unwrap_or_else(PoisonError::into_inner);
        }
        Ok(RoomDependencyTicket {
            ticket_id,
            expected_authorization,
        })
    }

    fn finalize(
        &self,
        ticket: &RoomDependencyTicket,
        authorization: AuthorizationVersion,
        min_commit_version: u64,
    ) -> SnapbackResult<Vec<(RoomId, RoomAuthorityResync)>> {
        if authorization != ticket.expected_authorization {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
                "auth",
                "room dependency finalization did not match its prepared authorization expectation",
            ));
        }
        let mut state = lock(&self.state);
        let pending = state.dependencies.get(&ticket.ticket_id).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE",
                "auth",
                "room dependency ticket is absent or already finalized",
            )
        })?;
        if pending.expected_authorization != authorization {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
                "auth",
                "room dependency registry expectation changed before finalization",
            ));
        }
        if pending.affected_rooms.iter().any(|room_id| {
            state
                .rooms
                .get(room_id)
                .is_some_and(|room| room.generation == u64::MAX)
        }) {
            return Err(SnapbackError::error(
                "SNAPBACK_EPHEMERAL_GENERATION_EXHAUSTED",
                "ephemeral",
                "room authority generation exhausted",
            ));
        }
        let pending = state
            .dependencies
            .remove(&ticket.ticket_id)
            .expect("validated room dependency remains under registry gate");
        state.durable_authorization = Some(authorization.clone());
        let mut resyncs = Vec::with_capacity(pending.affected_rooms.len());
        let mut retired = Vec::new();
        for room_id in pending.affected_rooms {
            let Some(room) = state.rooms.get_mut(&room_id) else {
                continue;
            };
            room.pending_tickets.remove(&ticket.ticket_id);
            if room.retired {
                if room.pending_tickets.is_empty() && room.active_permits == 0 {
                    retired.push(room_id);
                }
                continue;
            }
            room.generation += 1;
            let resync = RoomAuthorityResync {
                authorization: authorization.clone(),
                min_commit_version,
                room_authority_generation: room.generation,
            };
            room.resync = Some(resync.clone());
            resyncs.push((room_id, resync));
        }
        for room_id in retired {
            state.rooms.remove(&room_id);
        }
        self.quiescent.notify_all();
        Ok(resyncs)
    }

    fn rollback(&self, ticket: &RoomDependencyTicket) -> bool {
        let mut state = lock(&self.state);
        let Some(pending) = state.dependencies.remove(&ticket.ticket_id) else {
            return false;
        };
        let mut retired = Vec::new();
        for room_id in pending.affected_rooms {
            if let Some(room) = state.rooms.get_mut(&room_id) {
                room.pending_tickets.remove(&ticket.ticket_id);
                if room.retired && room.pending_tickets.is_empty() && room.active_permits == 0 {
                    retired.push(room_id);
                }
            }
        }
        for room_id in retired {
            state.rooms.remove(&room_id);
        }
        self.quiescent.notify_all();
        true
    }

    fn current_generation(&self, room_id: &RoomId) -> u64 {
        lock(&self.state)
            .rooms
            .get(room_id)
            .map_or(0, |room| room.generation)
    }

    fn drain_outbox(
        self: &Arc<Self>,
        outbox: &SharedOutbox,
        admit_fenced: bool,
        expected_effect_fence: Option<&ConnectionEffectFence>,
    ) -> Vec<AdmittedRealtimeEnvelope> {
        // Registry admission precedes the outbox lock. Prepare cannot install
        // a dependency ticket until this destructive drain and its permit
        // accounting complete. Enqueue takes only the outbox lock (protected
        // room enqueue already owns its permit), so no inverse lock order is
        // introduced by durable publication fencing.
        let mut state = lock(&self.state);
        // Before a durable authorization stream is installed this is the
        // legacy/dev in-memory room API: there is no auth-changing commit for
        // a permit to interlock with. Once installed, only the guarded drain
        // may extract any frame whose publication depends on that stream.
        let admit_fenced = admit_fenced || state.durable_authorization.is_none();
        let messages = lock(outbox).drain_with_authority(
            expected_effect_fence,
            |message| {
                let Some(authorization) = message.authorization() else {
                    return FrameAuthorityDisposition::Send;
                };
                if !state.dependencies.is_empty() {
                    return FrameAuthorityDisposition::Retain;
                }
                if state.durable_authorization.as_ref() == Some(authorization) {
                    if admit_fenced {
                        FrameAuthorityDisposition::Send
                    } else {
                        FrameAuthorityDisposition::Retain
                    }
                } else {
                    FrameAuthorityDisposition::DropStale
                }
            },
            |message| {
                let Some((room_id, generation)) = message.room_authority() else {
                    return FrameAuthorityDisposition::Send;
                };
                let Some(room) = state.rooms.get(room_id) else {
                    return if generation == 0 {
                        FrameAuthorityDisposition::Send
                    } else {
                        FrameAuthorityDisposition::DropStale
                    };
                };
                if room.retired || generation != room.generation {
                    return FrameAuthorityDisposition::DropStale;
                }
                if !room.pending_tickets.is_empty() {
                    return FrameAuthorityDisposition::Retain;
                }
                if let Some(resync) = &room.resync {
                    let is_current_auth_signal = resync.room_authority_generation == generation
                        && matches!(
                            message,
                            EphemeralMessage::ResyncRequired {
                                reason: ResyncReason::AuthChanged,
                                ..
                            }
                        );
                    return if is_current_auth_signal {
                        if admit_fenced {
                            FrameAuthorityDisposition::Send
                        } else {
                            FrameAuthorityDisposition::Retain
                        }
                    } else {
                        FrameAuthorityDisposition::Retain
                    };
                }
                if matches!(
                    message,
                    EphemeralMessage::ResyncRequired {
                        reason: ResyncReason::AuthChanged,
                        ..
                    }
                ) {
                    return FrameAuthorityDisposition::DropStale;
                }
                if admit_fenced {
                    FrameAuthorityDisposition::Send
                } else {
                    FrameAuthorityDisposition::Retain
                }
            },
        );
        messages
            .into_iter()
            .map(|envelope| {
                let publication_authority = match &envelope {
                    RealtimeEnvelope::Durable(message) => message.authorization().map(|_| {
                        state.active_durable_publications = state
                            .active_durable_publications
                            .checked_add(1)
                            .expect("bounded outbox cannot exhaust durable publication permits");
                        RealtimePublicationPermit::Durable {
                            _permit: DurableAuthorizationPermit {
                                registry: self.clone(),
                            },
                        }
                    }),
                    RealtimeEnvelope::Ephemeral(message) => {
                        message.room_authority().and_then(|(room_id, generation)| {
                            let room = state.rooms.get_mut(room_id)?;
                            debug_assert_eq!(room.generation, generation);
                            debug_assert!(room.pending_tickets.is_empty());
                            room.active_permits = room
                                .active_permits
                                .checked_add(1)
                                .expect("bounded outbox cannot exhaust room permits");
                            Some(RealtimePublicationPermit::Room(RoomAuthorityPermit {
                                registry: self.clone(),
                                room: room_id.clone(),
                                generation,
                            }))
                        })
                    }
                };
                AdmittedRealtimeEnvelope {
                    envelope,
                    publication_authority,
                }
            })
            .collect()
    }

    fn retire_room(&self, room_id: &RoomId) {
        let mut state = lock(&self.state);
        let Some(room) = state.rooms.get_mut(room_id) else {
            return;
        };
        room.retired = true;
        room.resync = None;
        if room.pending_tickets.is_empty() && room.active_permits == 0 {
            state.rooms.remove(room_id);
        }
    }
}

fn authority_pending_error() -> EphemeralError {
    EphemeralError::new(
        EphemeralErrorCode::AuthorityPending,
        "protected room authority is suspended for authorization revalidation",
    )
}

#[cfg(test)]
struct DefinitionSwapTestHook {
    reached: std::sync::mpsc::SyncSender<()>,
    release: std::sync::mpsc::Receiver<()>,
}

#[cfg(test)]
struct FrameBeforeFirstEnqueueTestHook {
    reached: std::sync::mpsc::SyncSender<EphemeralMessage>,
    release: std::sync::mpsc::Receiver<()>,
}

/// The shared state behind the backend handle. All synchronization is
/// internal: a read-mostly collections registry, a small global routing map
/// whose values are per-room locks, per-connection outbox locks, a
/// rate-bucket map, a room-granular expiry index, and atomic event counters.
///
/// Lock order (outer to inner): `rooms` map → one room → `delivery` notifier →
/// `outboxes` map → one outbox. `expiry_index` and `connection_rooms` remain
/// room-leaf locks taken one at a time. A generation-bound drain takes only
/// `delivery` → `outboxes` → one outbox. No enqueue retains an outbox lock
/// while waking `delivery`, so reconnect registration and draining cannot
/// form an inversion. Never two room locks; never acquire a room or the
/// `rooms` map while holding an outbox or index lock; nothing that holds a room
/// lock ever waits on the `rooms` map (the retire/wipe/prune paths take the map
/// first, and prune only `try_lock`s the room). `rate_buckets` is a pure leaf.
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
    #[cfg(test)]
    frame_before_first_enqueue_hook: StdMutex<Option<FrameBeforeFirstEnqueueTestHook>>,
    collections: RwLock<BTreeMap<String, EphemeralCollection>>,
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
    room_authority: Arc<RoomAuthorityRegistry>,
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

struct PreparedRoomAuthorizationCommit {
    backend: LocalEphemeralBackend,
    ticket: RoomDependencyTicket,
    authorization: AuthorizationVersion,
    incarnation_rotated: bool,
    rollback_on_drop: bool,
}

impl Drop for PreparedRoomAuthorizationCommit {
    fn drop(&mut self) {
        if self.rollback_on_drop {
            self.backend.rollback_room_authorization_event(&self.ticket);
        }
    }
}

impl PreparedAuthorizationCommit for PreparedRoomAuthorizationCommit {
    fn committed(mut self: Box<Self>, min_commit_version: u64) -> SnapbackResult<()> {
        // From this point on rollback is never safe: the durable transaction
        // is known committed. A failed finalization therefore leaves the
        // exact dependency ticket pending and every protected sink closed.
        self.rollback_on_drop = false;
        // A boot issuer authenticates exactly one authorization incarnation.
        // Destructive reset keeps this ticket closed while the server builds
        // and installs a successor issuer; asking the predecessor issuer to
        // publish across incarnations would turn a known committed reset into
        // a false commit-uncertain result.
        if !self.incarnation_rotated {
            self.backend
                .publish_committed_authorization(self.authorization.clone())?;
        }
        self.backend.finalize_room_authorization_event(
            &self.ticket,
            self.authorization.clone(),
            min_commit_version,
        )?;
        Ok(())
    }

    fn ambiguous(mut self: Box<Self>) {
        self.rollback_on_drop = false;
    }
}

impl AuthorizationCommitInterlock for LocalEphemeralBackend {
    fn prepare(
        &self,
        witness: &AuthorizationCommitWitness,
        impact: AuthorizationCommitImpact<'_>,
    ) -> SnapbackResult<Box<dyn PreparedAuthorizationCommit>> {
        debug_assert!(witness.event);
        let ticket = self.prepare_room_authorization_impact(witness.version.clone(), impact)?;
        Ok(Box::new(PreparedRoomAuthorizationCommit {
            backend: self.clone(),
            ticket,
            authorization: witness.version.clone(),
            incarnation_rotated: witness.incarnation_rotated,
            rollback_on_drop: true,
        }))
    }
}

impl Default for LocalEphemeralBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalEphemeralBackend {
    pub fn collection_requires_room_permission(&self, name: &str) -> bool {
        self.collection_if_loaded(name)
            .as_ref()
            .is_some_and(collection_requires_room_permission)
    }

    pub(crate) fn collection_definition(&self, name: &str) -> Option<EphemeralCollection> {
        self.collection_if_loaded(name)
    }

    pub fn new() -> Self {
        Self::with_limits(EphemeralStoreLimits::default())
    }

    /// A store with explicit hard limits (tests, future capability overrides).
    pub fn with_limits(limits: EphemeralStoreLimits) -> Self {
        Self {
            shared: Arc::new(EphemeralShared {
                lifecycle: RwLock::new(()),
                #[cfg(test)]
                definition_swap_hook: StdMutex::new(None),
                #[cfg(test)]
                frame_before_first_enqueue_hook: StdMutex::new(None),
                collections: RwLock::new(BTreeMap::new()),
                rooms: StdMutex::new(BTreeMap::new()),
                outboxes: StdMutex::new(BTreeMap::new()),
                rate_buckets: StdMutex::new(BTreeMap::new()),
                connection_rooms: StdMutex::new(BTreeMap::new()),
                expiry_index: StdMutex::new(BTreeMap::new()),
                counters: EventCounters::default(),
                next_scope_epoch: AtomicU64::new(1),
                limits,
                delivery: Arc::new(DeliveryNotifier::default()),
                room_authority: Arc::new(RoomAuthorityRegistry::default()),
                authorization_issuer: StdMutex::new(None),
            }),
        }
    }

    pub(crate) fn install_authorization_issuer(
        &self,
        issuer: crate::auth::invalidation::LiveInvalidationIssuer,
    ) {
        if let Ok(authorization) = issuer.authorization_expectation() {
            self.shared
                .room_authority
                .install_durable_authorization(authorization);
        }
        *lock(&self.shared.authorization_issuer) = Some(issuer);
    }

    pub(crate) fn clear_authorization_issuer(&self) {
        *lock(&self.shared.authorization_issuer) = None;
    }

    #[cfg(test)]
    pub(crate) fn authorization_expectation_for_test(&self) -> Option<AuthorizationVersion> {
        lock(&self.shared.authorization_issuer)
            .as_ref()
            .map(|issuer| {
                issuer
                    .authorization_expectation()
                    .expect("test issuer expectation")
            })
    }

    #[cfg(test)]
    pub(crate) fn install_frame_before_first_enqueue_hook_for_test(
        &self,
        reached: std::sync::mpsc::SyncSender<EphemeralMessage>,
        release: std::sync::mpsc::Receiver<()>,
    ) {
        let previous = lock(&self.shared.frame_before_first_enqueue_hook)
            .replace(FrameBeforeFirstEnqueueTestHook { reached, release });
        assert!(previous.is_none(), "frame-before-enqueue hook is one-shot");
    }

    fn publish_committed_authorization(
        &self,
        authorization: AuthorizationVersion,
    ) -> SnapbackResult<()> {
        let issuer = lock(&self.shared.authorization_issuer).clone();
        match issuer {
            Some(issuer) => issuer.install_authorization_expectation(authorization),
            // Standalone room-backend tests and dev embeddings intentionally
            // omit the persistent issuer; their interlock still exercises the
            // exact ticket protocol but exposes no session transport.
            None => Ok(()),
        }
    }

    fn begin_room_authority_act(
        &self,
        collection: &EphemeralCollection,
        room_id: &RoomId,
    ) -> Result<Option<RoomAuthorityPermit>, EphemeralError> {
        if !collection_requires_room_permission(collection) {
            return Ok(None);
        }
        let generation = self.shared.room_authority.begin_protected_act(room_id)?;
        Ok(Some(RoomAuthorityPermit {
            registry: self.shared.room_authority.clone(),
            room: room_id.clone(),
            generation,
        }))
    }

    fn room_authority_for_act(
        &self,
        collection: &EphemeralCollection,
        room_id: &RoomId,
        admitted: Option<&RoomAuthorityPermit>,
    ) -> Result<(u64, Option<RoomAuthorityPermit>), EphemeralError> {
        if !collection_requires_room_permission(collection) {
            return Ok((0, None));
        }
        if let Some(admitted) = admitted {
            let generation = admitted.admitted_generation(&self.shared.room_authority, room_id)?;
            return Ok((generation, None));
        }
        let permit = self
            .begin_room_authority_act(collection, room_id)?
            .expect("protected room publishes an authority permit");
        let generation = permit.generation();
        Ok((generation, Some(permit)))
    }

    /// Acquire the outer transport permit used while a server-derived durable
    /// permission is converted into an in-memory room act. The ordinary room
    /// operation acquires its own inner permit; this outer permit closes the
    /// read-to-registration gap and may be retained through final transport.
    pub(crate) fn begin_server_authorized_room_act(
        &self,
        collection_name: &str,
        scope: &Scope,
    ) -> Result<Option<RoomAuthorityPermit>, EphemeralError> {
        let collection = self.collection(collection_name)?;
        let room_id = room_id_for(&collection, scope)?;
        self.begin_room_authority_act(&collection, &room_id)
    }

    /// Install one conservative all-protected-room dependency ticket. This is
    /// retained as the explicit broad-event/test seam; ordinary app writes go
    /// through [`Self::prepare_room_authorization_impact`] so unrelated rooms
    /// remain live when their permission-backing scope is provably disjoint.
    #[cfg(test)]
    pub(crate) fn prepare_room_authorization_event(
        &self,
        expected_authorization: AuthorizationVersion,
    ) -> SnapbackResult<RoomDependencyTicket> {
        self.shared
            .room_authority
            .prepare(expected_authorization, RoomDependencySelector::all())
    }

    fn prepare_room_authorization_impact(
        &self,
        expected_authorization: AuthorizationVersion,
        impact: AuthorizationCommitImpact<'_>,
    ) -> SnapbackResult<RoomDependencyTicket> {
        let selector = self.room_dependency_selector(impact);
        self.shared
            .room_authority
            .prepare(expected_authorization, selector)
    }

    fn room_dependency_selector(
        &self,
        impact: AuthorizationCommitImpact<'_>,
    ) -> RoomDependencySelector {
        let AuthorizationCommitImpact::AppWrites { schema, changes } = impact else {
            return RoomDependencySelector::all();
        };
        let collections = self
            .shared
            .collections
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .values()
            .filter(|collection| collection_requires_room_permission(collection))
            .filter_map(|collection| {
                collection
                    .permission_backing
                    .as_ref()
                    .map(|projection| (collection.clone(), projection.clone()))
            })
            .collect::<Vec<_>>();
        let mut selector = RoomDependencySelector::default();
        for change in changes {
            for (collection, projection) in &collections {
                if projection.table != change.table {
                    continue;
                }
                let Some(table) = schema.table(&change.table) else {
                    // Authorization event classification already treats an
                    // unknown table as affected. The room selector must not
                    // narrow that conservative decision with less metadata.
                    selector.collections.insert(collection.name.clone());
                    continue;
                };
                let projection_fields = projection
                    .scope_fields
                    .values()
                    .chain(std::iter::once(&projection.subject_field))
                    .collect::<BTreeSet<_>>();
                if matches!(change.op, ChangeOp::Update) {
                    if change.changed_fields.is_empty() {
                        selector.collections.insert(collection.name.clone());
                        continue;
                    }
                    if change
                        .changed_fields
                        .iter()
                        .any(|field| table.field(field).is_none())
                    {
                        // Unknown names are incomplete change metadata, not a
                        // proof that this projection is disjoint.
                        selector.collections.insert(collection.name.clone());
                        continue;
                    }
                    if change
                        .changed_fields
                        .iter()
                        .all(|field| !projection_fields.contains(field))
                    {
                        continue;
                    }
                    // The post-image cannot identify the predecessor room
                    // when a scope field itself moves, so widen to this one
                    // collection rather than guessing away the old room.
                    if change.changed_fields.iter().any(|field| {
                        projection
                            .scope_fields
                            .values()
                            .any(|scope_field| scope_field == field)
                    }) {
                        selector.collections.insert(collection.name.clone());
                        continue;
                    }
                }
                let Some(Value::Object(row)) = change.row.as_ref() else {
                    selector.collections.insert(collection.name.clone());
                    continue;
                };
                let scope = projection
                    .scope_fields
                    .iter()
                    .map(|(scope_field, table_field)| {
                        row.get(table_field)
                            .and_then(Value::as_str)
                            .map(|value| (scope_field.clone(), value.to_owned()))
                    })
                    .collect::<Option<Vec<_>>>();
                let Some(scope) = scope else {
                    selector.collections.insert(collection.name.clone());
                    continue;
                };
                match room_id_for(collection, &Scope::from_pairs(scope)) {
                    Ok(room) => {
                        selector.rooms.insert(room);
                    }
                    Err(_) => {
                        // Loaded definitions were validated, but fail closed
                        // if a future definition shape defeats reconstruction.
                        selector.collections.insert(collection.name.clone());
                    }
                }
            }
        }
        selector
    }

    pub(crate) fn finalize_room_authorization_event(
        &self,
        ticket: &RoomDependencyTicket,
        authorization: AuthorizationVersion,
        min_commit_version: u64,
    ) -> SnapbackResult<Vec<(RoomId, RoomAuthorityResync)>> {
        let resyncs =
            self.shared
                .room_authority
                .finalize(ticket, authorization, min_commit_version)?;
        self.enqueue_room_authority_resyncs(None);
        Ok(resyncs)
    }

    pub(crate) fn rollback_room_authorization_event(&self, ticket: &RoomDependencyTicket) -> bool {
        self.shared.room_authority.rollback(ticket)
    }

    pub(crate) fn pending_room_reauthorizations(&self) -> Vec<PendingRoomReauthorization> {
        let pending = {
            let authority = lock(&self.shared.room_authority.state);
            authority
                .rooms
                .iter()
                .filter_map(|(room, control)| {
                    if !control.pending_tickets.is_empty() {
                        return None;
                    }
                    control
                        .resync
                        .as_ref()
                        .map(|obligation| (room.clone(), obligation.clone()))
                })
                .collect::<Vec<_>>()
        };
        let rooms = lock(&self.shared.rooms);
        pending
            .into_iter()
            .filter_map(|(room_id, obligation)| {
                let room = rooms.get(&room_id)?;
                let room = lock(room);
                Some(PendingRoomReauthorization {
                    room: room_id,
                    obligation,
                    subscribers: room
                        .subscribers
                        .iter()
                        .map(
                            |(connection_id, subscriber)| RoomSubscriberReauthorization {
                                connection_id: connection_id.clone(),
                                #[cfg(test)]
                                previous_auth: subscriber.auth.clone(),
                                effect_fence: subscriber.effect_fence.clone(),
                            },
                        )
                        .collect(),
                })
            })
            .collect()
    }

    pub(crate) fn complete_room_reauthorization(
        &self,
        room_id: &RoomId,
        room_authority_generation: u64,
        resolutions: Vec<RoomSubscriberResolution>,
    ) -> SnapbackResult<bool> {
        let mut authority = lock(&self.shared.room_authority.state);
        let Some(control) = authority.rooms.get(room_id) else {
            return Ok(false);
        };
        if !control.pending_tickets.is_empty()
            || control.generation != room_authority_generation
            || control
                .resync
                .as_ref()
                .is_none_or(|resync| resync.room_authority_generation != room_authority_generation)
        {
            return Ok(false);
        }
        let rooms = lock(&self.shared.rooms);
        let Some(room_arc) = rooms.get(room_id).cloned() else {
            authority.rooms.remove(room_id);
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
                ) {
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
                    room: room_id.clone(),
                    scope_epoch,
                    room_authority_generation,
                    high_water_version,
                    entries: entries.clone(),
                }),
                effect_fence.clone(),
            ));
            wakees.insert(connection_id.clone());
        }
        for (connection_id, outbox, effect_fence) in denied_outboxes {
            self.record_queue_push(lock(&outbox).push_resync(
                Arc::new(EphemeralMessage::Error {
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

        authority
            .rooms
            .get_mut(room_id)
            .expect("validated room authority remains under registry gate")
            .resync = None;
        drop(room);
        drop(rooms);
        drop(authority);
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

    pub(crate) fn subscription_requires_permission(&self, collection: &str) -> Option<bool> {
        self.collection_if_loaded(collection).map(|definition| {
            matches!(
                definition.subscribe,
                AccessPolicy::RequireRoomPermission { .. }
            )
        })
    }

    pub(crate) fn begin_final_send(
        &self,
        envelope: &RealtimeEnvelope,
    ) -> Result<Option<RealtimePublicationPermit>, EphemeralError> {
        match envelope {
            RealtimeEnvelope::Durable(message) => message
                .authorization()
                .map(|authorization| {
                    self.shared
                        .room_authority
                        .begin_durable_final_send(authorization)
                        .map(|permit| RealtimePublicationPermit::Durable { _permit: permit })
                })
                .transpose(),
            RealtimeEnvelope::Ephemeral(message) => self
                .shared
                .room_authority
                .begin_final_send(message)
                .map(|permit| permit.map(RealtimePublicationPermit::Room)),
        }
    }

    pub fn register_collection(
        &self,
        collection: EphemeralCollection,
    ) -> Result<(), EphemeralError> {
        validate_collection_definitions(std::slice::from_ref(&collection))?;
        let _generation = self
            .shared
            .lifecycle
            .write()
            .unwrap_or_else(PoisonError::into_inner);
        let replaced = {
            let mut collections = self
                .shared
                .collections
                .write()
                .unwrap_or_else(PoisonError::into_inner);
            match collections.get(&collection.name) {
                Some(current) if current == &collection => return Ok(()),
                Some(_) => {
                    collections.insert(collection.name.clone(), collection);
                    true
                }
                None => {
                    collections.insert(collection.name.clone(), collection);
                    false
                }
            }
        };
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

        let _generation = self
            .shared
            .lifecycle
            .write()
            .unwrap_or_else(PoisonError::into_inner);
        {
            let mut current = self
                .shared
                .collections
                .write()
                .unwrap_or_else(PoisonError::into_inner);
            // @ref LLP 0025#store-feature-idempotent-collection-ensure — repeated
            // app-definition loads with identical ephemeral definitions must not
            // erase active cursor rooms or queued latest-state messages.
            if *current == next {
                return Ok(());
            }
            *current = next;
        }

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
        validate_collection_definitions(&collections)?;
        let _generation = self
            .shared
            .lifecycle
            .read()
            .unwrap_or_else(PoisonError::into_inner);
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
                    format!(
                        "ephemeral collection definitions are not loaded: {}",
                        missing.join(", ")
                    ),
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
                    format!(
                        "loaded ephemeral collection definitions do not match generated artifacts (mismatched: [{}], extra: [{}])",
                        mismatched.join(", "),
                        extra.join(", ")
                    ),
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
        let _generation = self
            .shared
            .lifecycle
            .write()
            .unwrap_or_else(PoisonError::into_inner);
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

    pub(crate) fn publish_with_room_authority(
        &self,
        request: PublishRequest,
        now_ms: Millis,
        admitted: Option<&RoomAuthorityPermit>,
    ) -> Result<PublishOutcome, EphemeralError> {
        let _generation = self
            .shared
            .lifecycle
            .read()
            .unwrap_or_else(PoisonError::into_inner);
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
        let outcome = match self.with_room_create(&room_id, |room| {
            self.sweep_room_locked(
                room,
                &room_id,
                Some(&collection),
                now_ms,
                room_authority_generation,
            );

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
    ) -> Result<Option<EphemeralMessage>, EphemeralError> {
        self.delete_with_room_authority(request, now_ms, None)
    }

    pub(crate) fn delete_with_room_authority(
        &self,
        request: DeleteRequest,
        now_ms: Millis,
        admitted: Option<&RoomAuthorityPermit>,
    ) -> Result<Option<EphemeralMessage>, EphemeralError> {
        let _generation = self
            .shared
            .lifecycle
            .read()
            .unwrap_or_else(PoisonError::into_inner);
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
        self.ensure_authorized(&collection.publish, &request.scope, &request.auth)?;
        let (room_authority_generation, _room_authority) =
            self.room_authority_for_act(&collection, &room_id, admitted)?;
        let key = entry_key_for_delete(&collection, &request)?;
        let owner = entry_owner_for_delete(&collection, &request)?;

        let (removed, affected_connections) = match self.with_existing_room(&room_id, |room| {
            self.sweep_room_locked(
                room,
                &room_id,
                Some(&collection),
                now_ms,
                room_authority_generation,
            );
            let Some(record) = room.entries.get(&key) else {
                return Ok((None, BTreeSet::new()));
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
            );
            if let Some(message) = &removed {
                self.fan_out_locked(room, &room_id, &collection, message.clone());
            }
            Ok((removed, affected))
        }) {
            Some(result) => result?,
            None => (None, BTreeSet::new()),
        };
        for connection_id in affected_connections {
            self.unindex_connection_room_if_unused(&connection_id, &room_id);
        }
        self.prune_room_if_empty(&room_id);
        Ok(removed)
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

    pub(crate) fn unsubscribe_with_room_authority(
        &self,
        request: SubscribeRequest,
        admitted: Option<&RoomAuthorityPermit>,
    ) -> Result<bool, EphemeralError> {
        let _generation = self
            .shared
            .lifecycle
            .read()
            .unwrap_or_else(PoisonError::into_inner);
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

    pub(crate) fn subscribe_with_room_authority(
        &self,
        request: SubscribeRequest,
        now_ms: Millis,
        admitted: Option<&RoomAuthorityPermit>,
    ) -> Result<EphemeralMessage, EphemeralError> {
        self.subscribe_with_room_authority_and_effect_fence(request, now_ms, admitted, None)
    }

    pub(crate) fn subscribe_with_room_authority_and_effect_fence(
        &self,
        request: SubscribeRequest,
        now_ms: Millis,
        admitted: Option<&RoomAuthorityPermit>,
        effect_fence: Option<ConnectionEffectFence>,
    ) -> Result<EphemeralMessage, EphemeralError> {
        let _generation = self
            .shared
            .lifecycle
            .read()
            .unwrap_or_else(PoisonError::into_inner);
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
        let outcome = match self.with_room_create(&room_id, |room| {
            self.sweep_room_locked(
                room,
                &room_id,
                Some(&collection),
                now_ms,
                room_authority_generation,
            );
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
            let entries = room
                .entries
                .iter()
                .map(|(key, record)| record.to_entry(key))
                .collect();
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
                room: room_id.clone(),
                scope_epoch: room.scope_epoch,
                room_authority_generation,
                high_water_version: room.next_entry_version.saturating_sub(1),
                entries,
            })
        }) {
            Ok(inner) => inner,
            Err(error) => Err(error),
        };
        if outcome.is_err() {
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
        self.disconnect_inner(connection_id, now_ms, false);
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
        self.disconnect_inner(connection_id, now_ms, true)
    }

    fn disconnect_inner(&self, connection_id: &str, now_ms: Millis, guarded: bool) -> bool {
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
                .map(RoomAuthorityPermit::generation)
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
            self.sweep_room_locked(
                &mut room,
                room_id,
                collection.as_ref(),
                now_ms,
                room_authority_generation,
            );
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
                    ) {
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
        if !guarded
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
                    let generation = self.shared.room_authority.current_generation(&room);
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
                .map(RoomAuthorityPermit::generation)
                .unwrap_or(0);
            let prunable = self
                .with_existing_room(&room_id, |room| {
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
                    );
                    if let Some(earliest) = next_expiry_deadline(room) {
                        self.index_room_deadline(room, &room_id, earliest);
                    }
                    room.entries.is_empty() && room.subscribers.is_empty()
                })
                .unwrap_or(false);
            if prunable {
                self.prune_room_if_empty(&room_id);
            }
        }
    }

    pub fn enqueue_durable(
        &self,
        connection_id: impl Into<String>,
        payload: Vec<u8>,
    ) -> DurableEnqueueOutcome {
        self.enqueue_durable_message(connection_id, DurableMessage::new(payload))
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
    pub(crate) fn invalidate_durable_backlog_for_activation(
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
                .any(|message| message.effect_fence() == effect_fence)
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

    pub(crate) fn enqueue_authorized_durable(
        &self,
        connection_id: impl Into<String>,
        payload: Vec<u8>,
        authorization: AuthorizationVersion,
    ) -> DurableEnqueueOutcome {
        self.enqueue_durable_message(
            connection_id,
            DurableMessage::authorized(payload, authorization),
        )
    }

    pub(crate) fn enqueue_durable_bound(
        &self,
        connection_id: impl Into<String>,
        payload: Vec<u8>,
        effect_fence: ConnectionEffectFence,
    ) -> DurableEnqueueOutcome {
        self.enqueue_durable_message(connection_id, DurableMessage::bound(payload, effect_fence))
    }

    pub(crate) fn enqueue_authorized_durable_bound(
        &self,
        connection_id: impl Into<String>,
        payload: Vec<u8>,
        authorization: AuthorizationVersion,
        effect_fence: ConnectionEffectFence,
    ) -> DurableEnqueueOutcome {
        self.enqueue_durable_message(
            connection_id,
            DurableMessage::authorized_bound(payload, authorization, effect_fence),
        )
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

    /// Remove retained subscriber and queued state for one exact grant while
    /// preserving any replacement that reused the readable connection id.
    pub(crate) fn purge_connection_effects(
        &self,
        connection_id: &str,
        effect_fence: &ConnectionEffectFence,
    ) {
        let touched = lock(&self.shared.connection_rooms)
            .get(connection_id)
            .cloned()
            .unwrap_or_default();
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
            if remove && let Some(subscriber) = room.subscribers.remove(connection_id) {
                room.retained_bytes = room
                    .retained_bytes
                    .saturating_sub(subscriber.retained_bytes);
            }
            self.sync_connection_room_index_locked(&room, connection_id, &room_id);
        }
        if let Some(outbox) = lock(&self.shared.outboxes).get(connection_id).cloned() {
            lock(&outbox).purge_effect_fence(effect_fence);
        }
    }

    /// Drain compatibility traffic that does not require an installed auth
    /// final-publication fence. In sessions, auth-scoped durable data and
    /// protected-room frames remain queued. A transport embedding must use
    /// [`Self::drain_outbox_for_send`] and retain each admitted wrapper until
    /// its final sink completes.
    pub fn drain_outbox(&self, connection_id: &str) -> Vec<RealtimeEnvelope> {
        // The authority obligation is level-triggered: losing or draining its
        // first signal cannot acknowledge it. Every heartbeat/poll recreates
        // the exact current-generation AuthChanged sentinel until the room's
        // fresh snapshot or trusted denial boundary completes.
        self.enqueue_room_authority_resyncs(Some(connection_id));
        let outbox = lock(&self.shared.outboxes).get(connection_id).cloned();
        outbox
            .map(|outbox| {
                self.shared
                    .room_authority
                    .drain_outbox(&outbox, false, None)
            })
            .unwrap_or_default()
            .into_iter()
            .map(|admitted| {
                let (envelope, _legacy_dev_permit) = admitted.into_parts();
                envelope
            })
            .collect()
    }

    /// Destructively drain frames for a real transport handoff. Callers must
    /// keep each returned wrapper alive through the final sink.
    pub fn drain_outbox_for_send(&self, connection_id: &str) -> Vec<AdmittedRealtimeEnvelope> {
        self.enqueue_room_authority_resyncs(Some(connection_id));
        let outbox = lock(&self.shared.outboxes).get(connection_id).cloned();
        outbox
            .map(|outbox| self.shared.room_authority.drain_outbox(&outbox, true, None))
            .unwrap_or_default()
    }

    /// Destructively drain only effects produced by the exact connection
    /// grant. A readable connection id is intentionally insufficient: local
    /// profiles may reuse it and terminal cleanup may race with replacement.
    pub(crate) fn drain_outbox_for_send_bound(
        &self,
        connection_id: &str,
        effect_fence: &ConnectionEffectFence,
    ) -> Vec<AdmittedRealtimeEnvelope> {
        self.enqueue_room_authority_resyncs(Some(connection_id));
        let outbox = lock(&self.shared.outboxes).get(connection_id).cloned();
        outbox
            .map(|outbox| {
                self.shared
                    .room_authority
                    .drain_outbox(&outbox, true, Some(effect_fence))
            })
            .unwrap_or_default()
    }

    fn enqueue_room_authority_resyncs(&self, only_connection: Option<&str>) {
        let pending = {
            let authority = lock(&self.shared.room_authority.state);
            authority
                .rooms
                .iter()
                .filter_map(|(room_id, control)| {
                    if !control.pending_tickets.is_empty() {
                        return None;
                    }
                    control
                        .resync
                        .as_ref()
                        .map(|resync| (room_id.clone(), resync.clone()))
                })
                .collect::<Vec<_>>()
        };
        let rooms = lock(&self.shared.rooms);
        let mut wakees = BTreeSet::new();
        for (room_id, resync) in pending {
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
    pub(crate) fn drain_outbox_if_current(
        &self,
        connection_id: &str,
        generation: u64,
    ) -> Option<Vec<RealtimeEnvelope>> {
        self.shared
            .delivery
            .act_if_current(connection_id, generation, || {
                self.drain_outbox(connection_id)
            })
    }

    pub(crate) fn drain_outbox_for_send_if_current(
        &self,
        connection_id: &str,
        generation: u64,
    ) -> Option<Vec<AdmittedRealtimeEnvelope>> {
        self.shared
            .delivery
            .act_if_current(connection_id, generation, || {
                self.drain_outbox_for_send(connection_id)
            })
    }

    pub(crate) fn drain_outbox_for_send_bound_if_current(
        &self,
        connection_id: &str,
        generation: u64,
        effect_fence: &ConnectionEffectFence,
    ) -> Option<Vec<AdmittedRealtimeEnvelope>> {
        self.shared
            .delivery
            .act_if_current(connection_id, generation, || {
                self.drain_outbox_for_send_bound(connection_id, effect_fence)
            })
    }

    pub fn diagnostics(&self) -> EphemeralDiagnostics {
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
            diagnostics.pending_durable_messages += outbox.durable.len();
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

    /// Run `f` under the (created-if-needed) room's lock. Retries when the
    /// looked-up room was retired between the map lookup and the room lock —
    /// the pruner or a wipe won the race, and the retry re-consults the map,
    /// which is exactly what the retire protocol requires. Creation enforces
    /// the active-room limit and allocates the incarnation's scope epoch.
    fn with_room_create<T>(
        &self,
        room_id: &RoomId,
        f: impl FnOnce(&mut RoomState) -> T,
    ) -> Result<T, EphemeralError> {
        let mut f = Some(f);
        loop {
            let room_arc = {
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
                    let epoch = self.shared.next_scope_epoch.fetch_add(1, Ordering::Relaxed);
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
                    let created = Arc::new(StdMutex::new(RoomState::new(epoch, retained_bytes)));
                    rooms.insert(room_id.clone(), created.clone());
                    created
                }
            };
            let mut room = lock(&room_arc);
            if room.retired {
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
            let room_authority_generation = self.shared.room_authority.current_generation(&room_id);
            for (connection_id, effect_fence) in subscribers {
                resyncs.push((
                    connection_id,
                    EphemeralMessage::ResyncRequired {
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
    ) {
        match next_expiry_deadline(room) {
            Some(deadline) if deadline <= now_ms => {}
            _ => return,
        }

        let expired_keys = room
            .entries
            .iter()
            .filter_map(|(key, record)| (record.expires_at_ms <= now_ms).then_some(key.clone()))
            .collect::<Vec<_>>();
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
            ) {
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
        #[cfg(test)]
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

    #[cfg(test)]
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

fn remove_entry_locked(
    room: &mut RoomState,
    room_id: &RoomId,
    key: &EntryKey,
    reason: RemoveReason,
    room_authority_generation: u64,
) -> Option<EphemeralMessage> {
    let record = room.entries.remove(key)?;
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
    Some(EphemeralMessage::Remove {
        room: room_id.clone(),
        key: key.clone(),
        scope_epoch: room.scope_epoch,
        room_authority_generation,
        entry_version,
        reason,
    })
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

/// Validate the complete local ephemeral definition set before it can replace
/// live authority state. Codegen performs the same authoring checks, but the
/// Rust parser is the artifact authority (LLP 0037), so direct ingestion must
/// fail closed too.
pub fn validate_collection_definitions(
    collections: &[EphemeralCollection],
) -> Result<(), EphemeralError> {
    let mut names = BTreeSet::new();
    for collection in collections {
        if !valid_manifest_identifier(&collection.name)
            || collection.name.len() > MAX_EPHEMERAL_COLLECTION_NAME_BYTES
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection name {:?} is not a portable identifier",
                    collection.name
                ),
            ));
        }
        if !names.insert(collection.name.clone()) {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} is declared more than once",
                    collection.name
                ),
            ));
        }

        let scope = collection
            .scope_fields
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        if scope.is_empty()
            || scope.len() > MAX_EPHEMERAL_SCOPE_FIELDS
            || scope.len() != collection.scope_fields.len()
            || scope.iter().any(|field| {
                !valid_manifest_identifier(field) || field.len() > MAX_EPHEMERAL_SCOPE_KEY_BYTES
            })
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} needs unique non-empty portable scope fields",
                    collection.name
                ),
            ));
        }
        let routing = collection
            .routing_fields
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        if routing.is_empty()
            || routing.len() != collection.routing_fields.len()
            || !routing.is_subset(&scope)
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} needs unique routing fields drawn from its scope",
                    collection.name
                ),
            ));
        }

        if collection.default_ttl_ms == 0
            || collection.default_ttl_ms > collection.max_ttl_ms
            || collection.max_ttl_ms > LOCAL_HARD_MAX_TTL_MS
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} TTL budget must satisfy 0 < default <= max <= {}ms",
                    collection.name, LOCAL_HARD_MAX_TTL_MS
                ),
            ));
        }
        if collection.max_value_bytes == 0
            || collection.hard_max_value_bytes == 0
            || collection.max_value_bytes > collection.hard_max_value_bytes
            || collection.hard_max_value_bytes > 4_096
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} value budget must satisfy 0 < max <= hardMax <= 4096",
                    collection.name
                ),
            ));
        }
        if collection.sustained_hz == 0
            || collection.burst == 0
            || collection.dispatch_ms == 0
            || collection.max_pending_ephemeral_keys == 0
            || collection.max_pending_ephemeral_keys > MAX_OUTBOX_BACKLOG
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} rate, dispatch, and pending-key budgets must be positive and pending keys may not exceed {}",
                    collection.name, MAX_OUTBOX_BACKLOG
                ),
            ));
        }
        for policy in [&collection.publish, &collection.subscribe] {
            if matches!(policy, AccessPolicy::RequireRoomPermission { prefix } if
                !valid_manifest_identifier(prefix) || prefix.len() > MAX_EPHEMERAL_SCOPE_KEY_BYTES)
            {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::IncompatibleCollectionDefinition,
                    format!(
                        "ephemeral collection {} has an invalid authorization prefix",
                        collection.name
                    ),
                ));
            }
        }
    }
    Ok(())
}

pub fn validate_collection_permission_backing(
    collections: &[EphemeralCollection],
    tables: &[crate::manifest::TableManifest],
    require_for_protected: bool,
) -> Result<(), EphemeralError> {
    for collection in collections {
        let protected = collection_requires_room_permission(collection);
        let Some(projection) = collection.permission_backing.as_ref() else {
            if require_for_protected && protected {
                return Err(EphemeralError::new(
                    EphemeralErrorCode::IncompatibleCollectionDefinition,
                    format!(
                        "protected ephemeral collection {} requires a durable permissionBacking projection in sessions mode",
                        collection.name
                    ),
                ));
            }
            continue;
        };
        if !protected {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} declares permissionBacking without a protected room policy",
                    collection.name
                ),
            ));
        }
        let Some(table) = tables.iter().find(|table| table.name == projection.table) else {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} permissionBacking references unknown table {}",
                    collection.name, projection.table
                ),
            ));
        };
        if !table.permission_backing {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} permissionBacking table {} is not marked permissionBacking",
                    collection.name, table.name
                ),
            ));
        }
        let declared_scope = collection
            .scope_fields
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        let projected_scope = projection
            .scope_fields
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>();
        if projected_scope != declared_scope {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} permissionBacking must map every exact room scope field",
                    collection.name
                ),
            ));
        }
        let mut read_fields = projection
            .scope_fields
            .values()
            .cloned()
            .collect::<BTreeSet<_>>();
        read_fields.insert(projection.subject_field.clone());
        if read_fields.iter().any(|field| table.field(field).is_none()) {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} permissionBacking references an unknown field on {}",
                    collection.name, table.name
                ),
            ));
        }
        if let Some(permission_fields) = &table.permission_fields
            && !read_fields
                .iter()
                .all(|field| permission_fields.contains(field))
        {
            return Err(EphemeralError::new(
                EphemeralErrorCode::IncompatibleCollectionDefinition,
                format!(
                    "ephemeral collection {} permissionBacking reads fields omitted from {}.permissionFields",
                    collection.name, table.name
                ),
            ));
        }
    }
    Ok(())
}

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
    fn replacement_generation_inherits_the_guarded_durable_publication() {
        use std::sync::mpsc;
        use std::time::Duration;

        let backend = Arc::new(LocalEphemeralBackend::new());
        let predecessor = authorization(0);
        backend
            .shared
            .room_authority
            .install_durable_authorization(predecessor.clone());
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
            let ticket = commit_backend
                .prepare_room_authorization_event(authorization(1))
                .unwrap();
            prepared_tx.send(ticket).unwrap();
        });
        assert!(
            prepared_rx.recv_timeout(Duration::from_millis(20)).is_err(),
            "replacement ownership must not shorten the final-publication permit"
        );
        drop(admitted);
        let ticket = prepared_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("the commit resumes after the replacement send completes");
        assert!(backend.rollback_room_authorization_event(&ticket));
        prepare.join().unwrap();
    }

    #[test]
    fn generation_bound_drain_serializes_registration_without_deadlock() {
        use std::sync::mpsc;
        use std::time::Duration;

        let backend = Arc::new(LocalEphemeralBackend::new());
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
                drain_backend.drain_outbox("conn")
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
        assert_eq!(drain.join().unwrap().unwrap().len(), 1);
        replacement.join().unwrap();
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
    fn unknown_change_field_widens_permission_projection_to_collection() {
        use crate::manifest::{FieldManifest, FieldType, SchemaManifest, TableManifest};
        use crate::storage::ChangedRow;

        let projection = RoomPermissionProjection {
            table: "memberships".to_owned(),
            subject_field: "userId".to_owned(),
            scope_fields: BTreeMap::from([("boardId".to_owned(), "boardId".to_owned())]),
        };
        let backend = LocalEphemeralBackend::new();
        backend
            .register_collection(collection().permission_backed_by(projection))
            .unwrap();
        let schema = SchemaManifest {
            tables: vec![TableManifest {
                name: "memberships".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "boardId".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "userId".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: true,
                permission_fields: Some(vec!["boardId".to_owned(), "userId".to_owned()]),
            }],
            ..SchemaManifest::default()
        };
        let changes = [ChangedRow {
            table: "memberships".to_owned(),
            id: "member-a".to_owned(),
            op: ChangeOp::Update,
            row: Some(serde_json::json!({"boardId": "board-1", "userId": "user-a"})),
            changed_fields: vec!["futureField".to_owned()],
        }];

        let selector = backend.room_dependency_selector(AuthorizationCommitImpact::AppWrites {
            schema: &schema,
            changes: &changes,
        });
        let other_scope = Scope::from_pairs([("boardId", "board-2")]);
        let other_room = room_id_for(&collection(), &other_scope).unwrap();
        assert!(!selector.all_protected_rooms);
        assert_eq!(
            selector.collections,
            BTreeSet::from(["boardCursors".to_owned()])
        );
        assert!(selector.matches(&room()));
        assert!(selector.matches(&other_room));
    }

    fn publish_request(connection_id: &str, value: &[u8]) -> PublishRequest {
        let scope = scope();
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
        let scope = scope();
        SubscribeRequest {
            collection: "boardCursors".to_owned(),
            auth: auth_for(&scope),
            scope,
            connection_id: connection_id.to_owned(),
        }
    }

    fn authorization(epoch: u64) -> AuthorizationVersion {
        AuthorizationVersion {
            incarnation: "0197f862-f196-7bb2-b3f0-2a67185dfd17".to_owned(),
            epoch,
        }
    }

    #[test]
    fn protected_registration_is_closed_by_the_exact_pending_ticket() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("first"), 1).unwrap();

        let first = backend
            .prepare_room_authorization_event(authorization(1))
            .unwrap();
        let second = backend
            .prepare_room_authorization_event(authorization(2))
            .unwrap();
        let error = backend
            .subscribe(subscribe_request("late"), 2)
            .expect_err("either pending ticket closes registration");
        assert_eq!(error.code, EphemeralErrorCode::AuthorityPending);

        assert!(backend.rollback_room_authorization_event(&first));
        let error = backend
            .subscribe(subscribe_request("late"), 3)
            .expect_err("rolling back one ticket must not clear another");
        assert_eq!(error.code, EphemeralErrorCode::AuthorityPending);
        assert!(backend.rollback_room_authorization_event(&second));
        backend
            .subscribe(subscribe_request("late"), 4)
            .expect("the exact final rollback reopens the old generation");
    }

    #[test]
    fn transport_drain_holds_commit_until_final_send_permit_drops() {
        use std::sync::mpsc;
        use std::time::Duration;

        let backend = Arc::new(LocalEphemeralBackend::new());
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
            let ticket = commit_backend
                .prepare_room_authorization_event(authorization(1))
                .unwrap();
            prepared_tx.send(ticket).unwrap();
        });
        assert!(
            prepared_rx.recv_timeout(Duration::from_millis(20)).is_err(),
            "a destructively drained frame must retain its final-send permit"
        );
        drop(admitted);
        let ticket = prepared_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("dropping the transport frame releases commit preparation");
        assert!(backend.rollback_room_authorization_event(&ticket));
        prepare.join().unwrap();
    }

    #[test]
    fn prelookup_transport_permit_admits_act_after_prepare_becomes_pending() {
        use std::sync::mpsc;
        use std::time::{Duration, Instant};

        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let room_scope = scope();
        let admitted = backend
            .begin_server_authorized_room_act("boardCursors", &room_scope)
            .unwrap()
            .expect("protected room returns a prelookup permit");

        let (prepared_tx, prepared_rx) = mpsc::channel();
        let commit_backend = backend.clone();
        let prepare = std::thread::spawn(move || {
            let prepared = AuthorizationCommitInterlock::prepare(
                &commit_backend,
                &AuthorizationCommitWitness {
                    version: authorization(1),
                    event: true,
                    incarnation_rotated: false,
                },
                AuthorizationCommitImpact::AllProtectedRooms,
            )
            .unwrap();
            prepared_tx.send(prepared).unwrap();
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
        let prepared = prepared_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("dropping the admitted permit releases prepare");
        drop(prepared);
        prepare.join().unwrap();
    }

    #[test]
    fn durable_authorization_ticket_retains_scoped_frames_but_not_independent_traffic() {
        let backend = LocalEphemeralBackend::new();
        let predecessor = authorization(0);
        let successor = authorization(1);
        backend
            .shared
            .room_authority
            .install_durable_authorization(predecessor.clone());
        backend.enqueue_authorized_durable(
            "observer",
            b"old-private-board".to_vec(),
            predecessor.clone(),
        );
        backend.enqueue_durable("observer", b"authority-independent".to_vec());

        let ticket = backend
            .prepare_room_authorization_event(successor.clone())
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

        assert!(backend.rollback_room_authorization_event(&ticket));
        let admitted = backend.drain_outbox_for_send("observer");
        assert_eq!(admitted.len(), 1);
        let (retained, permit) = admitted.into_iter().next().unwrap().into_parts();
        assert!(permit.is_some());
        assert!(matches!(
            retained,
            RealtimeEnvelope::Durable(message) if message.payload == b"old-private-board"
        ));
        drop(permit);

        backend.enqueue_authorized_durable(
            "observer",
            b"stale-private-board".to_vec(),
            predecessor,
        );
        let ticket = backend
            .prepare_room_authorization_event(successor.clone())
            .unwrap();
        assert!(backend.drain_outbox_for_send("observer").is_empty());

        backend
            .finalize_room_authorization_event(&ticket, successor, 7)
            .unwrap();
        assert!(
            backend.drain_outbox_for_send("observer").is_empty(),
            "the predecessor-stamped board frame is discarded after commit"
        );
    }

    #[test]
    fn public_unfenced_drain_cannot_extract_authorized_durable_data() {
        let backend = LocalEphemeralBackend::new();
        let predecessor = authorization(0);
        backend
            .shared
            .room_authority
            .install_durable_authorization(predecessor.clone());
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

    #[test]
    fn committed_authorization_event_drops_old_frames_and_refires_auth_changed() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("observer"), 1).unwrap();
        backend
            .publish(publish_request("owner", b"old"), 2)
            .unwrap();

        let expected = authorization(1);
        let ticket = backend
            .prepare_room_authorization_event(expected.clone())
            .unwrap();
        let resyncs = backend
            .finalize_room_authorization_event(&ticket, expected, 7)
            .unwrap();
        assert_eq!(resyncs.len(), 1);
        assert_eq!(resyncs[0].1.room_authority_generation, 2);

        let first = drain_through_test_sink(&backend, "observer");
        assert!(
            first.iter().all(|frame| !matches!(
                frame,
                RealtimeEnvelope::Ephemeral(EphemeralMessage::Upsert { .. })
            )),
            "the generation-1 upsert is stale"
        );
        assert!(first.iter().any(|frame| matches!(
            frame,
            RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired {
                room_authority_generation: 2,
                reason: ResyncReason::AuthChanged,
                ..
            })
        )));
        let second = drain_through_test_sink(&backend, "observer");
        assert!(second.iter().any(|frame| matches!(
            frame,
            RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired {
                room_authority_generation: 2,
                reason: ResyncReason::AuthChanged,
                ..
            })
        )));
    }

    #[test]
    fn ambiguous_authorization_commit_leaves_every_protected_act_pending() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("observer"), 1).unwrap();
        let witness = AuthorizationCommitWitness {
            version: authorization(1),
            event: true,
            incarnation_rotated: false,
        };
        let prepared = AuthorizationCommitInterlock::prepare(
            &backend,
            &witness,
            AuthorizationCommitImpact::AllProtectedRooms,
        )
        .unwrap();
        prepared.ambiguous();

        let error = backend
            .publish(publish_request("owner", b"blocked"), 2)
            .expect_err("an uncertain COMMIT may never exact-unmark its ticket");
        assert_eq!(error.code, EphemeralErrorCode::AuthorityPending);
    }

    #[test]
    fn fresh_room_reauthorization_revokes_owner_and_emits_trusted_boundaries() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        backend.subscribe(subscribe_request("owner"), 1).unwrap();
        backend.subscribe(subscribe_request("survivor"), 1).unwrap();
        backend
            .publish(publish_request("owner", b"secret"), 2)
            .unwrap();
        backend.drain_outbox("owner");
        backend.drain_outbox("survivor");

        let expected = authorization(1);
        let ticket = backend
            .prepare_room_authorization_event(expected.clone())
            .unwrap();
        let (_, obligation) = backend
            .finalize_room_authorization_event(&ticket, expected, 11)
            .unwrap()
            .pop()
            .unwrap();
        let refreshed = auth_for(&scope());
        assert!(
            backend
                .complete_room_reauthorization(
                    &room(),
                    obligation.room_authority_generation,
                    vec![
                        RoomSubscriberResolution::Denied {
                            connection_id: "owner".to_owned(),
                            expected_effect_fence: None,
                        },
                        RoomSubscriberResolution::Authorized {
                            connection_id: "survivor".to_owned(),
                            expected_effect_fence: None,
                            auth: refreshed,
                        },
                    ],
                )
                .unwrap()
        );

        let survivor = drain_through_test_sink(&backend, "survivor");
        assert!(survivor.iter().any(|frame| matches!(
            frame,
            RealtimeEnvelope::Ephemeral(EphemeralMessage::Remove {
                reason: RemoveReason::AuthRevoked,
                room_authority_generation: 2,
                ..
            })
        )));
        assert!(survivor.iter().any(|frame| matches!(
            frame,
            RealtimeEnvelope::Ephemeral(EphemeralMessage::Snapshot {
                room_authority_generation: 2,
                entries,
                ..
            }) if entries.is_empty()
        )));
        let denied = drain_through_test_sink(&backend, "owner");
        assert!(denied.iter().any(|frame| matches!(
            frame,
            RealtimeEnvelope::Ephemeral(EphemeralMessage::Error {
                error: EphemeralError {
                    code: EphemeralErrorCode::PermissionDenied,
                    ..
                },
                room_authority_generation: Some(2),
                ..
            })
        )));
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
            .map(retained_durable_queue_item_bytes)
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
        assert_eq!(queue.durable_bytes, durable, "durable byte ledger drifted");
        assert_eq!(queue.resync_bytes, resync, "resync byte ledger drifted");
        assert_eq!(
            queue.ephemeral_bytes, ephemeral,
            "ephemeral byte ledger drifted"
        );
        durable.saturating_add(resync).saturating_add(ephemeral)
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
        // The recovery ledger remains capped in both dimensions.
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
        assert_eq!(queue.resync.len(), MAX_OUTBOX_OVERFLOW_RESYNCS);
        assert_eq!(
            queue.retained_bytes(),
            recompute_queue_retained_bytes(&queue)
        );
        assert!(queue.retained_bytes() <= MAX_OUTBOX_RETAINED_BYTES);

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
        });

        let stale = EphemeralMessage::Upsert {
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
                room: room.clone(),
                scope_epoch: 7,
                room_authority_generation: 0,
                high_water_version: 1,
                entries: vec![entry(1, b"present")],
            }),
            OverlayApply::Applied
        );
        assert_eq!(
            overlay.apply(&EphemeralMessage::Snapshot {
                room: room.clone(),
                scope_epoch: 7,
                room_authority_generation: 0,
                high_water_version: 2,
                entries: Vec::new(),
            }),
            OverlayApply::Applied
        );
        assert!(overlay.room_entries(&room).is_empty());
        assert_eq!(
            overlay.apply(&EphemeralMessage::Upsert {
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
        });
        assert_eq!(
            overlay.apply(&EphemeralMessage::Remove {
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

        let messages = backend.drain_outbox("observer");
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

        let messages = backend.drain_outbox("observer");
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

        let messages = backend.drain_outbox("observer");
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
                let mut n = 0u64;
                while !stop.load(Ordering::Relaxed) {
                    // A fresh room every publish: some are born inside a wipe's
                    // snapshot→retire window and survive it.
                    let request = PublishRequest {
                        collection: "cursors".to_owned(),
                        scope: Scope::from_pairs([("roomId", format!("r-{n}"))]),
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
            published >= 100 && wipes >= 20,
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
    }

    #[test]
    fn effect_fenced_ephemeral_coalescing_cannot_overwrite_successor() {
        let predecessor = ConnectionEffectFence::session("inc", "grant-old", "session", 1);
        let successor = ConnectionEffectFence::session("inc", "grant-new", "session", 2);
        let upsert = |value: &[u8], entry_version| {
            Arc::new(EphemeralMessage::Upsert {
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

    /// A permission result resolved for one grant must not be installed on a
    /// same-id replacement. The level-triggered room obligation stays pending
    /// and the replacement is resolved on the next maintenance pass.
    #[test]
    fn room_reauthorization_replacement_fence_keeps_obligation_pending() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection()).unwrap();
        let predecessor = ConnectionEffectFence::session("inc", "grant-old", "session", 1);
        let successor = ConnectionEffectFence::session("inc", "grant-new", "session", 2);
        backend
            .subscribe_with_room_authority_and_effect_fence(
                subscribe_request("same-id"),
                1,
                None,
                Some(predecessor.clone()),
            )
            .unwrap();
        let expected = authorization(1);
        let ticket = backend
            .prepare_room_authorization_event(expected.clone())
            .unwrap();
        let (_, obligation) = backend
            .finalize_room_authorization_event(&ticket, expected, 11)
            .unwrap()
            .pop()
            .unwrap();
        let pending = backend.pending_room_reauthorizations().pop().unwrap();

        let room_arc = lock(&backend.shared.rooms).get(&room()).cloned().unwrap();
        lock(&room_arc)
            .subscribers
            .get_mut("same-id")
            .unwrap()
            .effect_fence = Some(successor.clone());

        assert!(
            !backend
                .complete_room_reauthorization(
                    &room(),
                    obligation.room_authority_generation,
                    vec![RoomSubscriberResolution::Authorized {
                        connection_id: "same-id".to_owned(),
                        expected_effect_fence: pending.subscribers[0].effect_fence.clone(),
                        auth: auth_for(&scope()),
                    }],
                )
                .unwrap()
        );
        assert_eq!(backend.pending_room_reauthorizations().len(), 1);
        assert_eq!(
            lock(&room_arc)
                .subscribers
                .get("same-id")
                .unwrap()
                .effect_fence,
            Some(successor)
        );
    }
}
