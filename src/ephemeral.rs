use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex as StdMutex;
use std::sync::{Arc, MutexGuard, PoisonError, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Notify;

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
#[derive(Default)]
struct DeliveryNotifierState {
    next_generation: u64,
    waiters: HashMap<String, (u64, Arc<Notify>)>,
}

#[derive(Default)]
pub struct DeliveryNotifier {
    state: StdMutex<DeliveryNotifierState>,
}

impl DeliveryNotifier {
    /// Register interest in a connection's deliveries. Returns this
    /// registration's generation and the waker; a later `register` for the
    /// same connection replaces the waker and supersedes the generation.
    pub fn register(&self, connection_id: &str) -> (u64, Arc<Notify>) {
        let mut state = self.state.lock().unwrap();
        state.next_generation += 1;
        let generation = state.next_generation;
        let notify = Arc::new(Notify::new());
        state
            .waiters
            .insert(connection_id.to_owned(), (generation, notify.clone()));
        (generation, notify)
    }

    /// Unregister only if `generation` still owns the connection's waker.
    /// Returns whether the caller was the current owner — a stale task (its
    /// registration already replaced by a reconnect) gets `false` and must
    /// not perform connection teardown.
    pub fn unregister(&self, connection_id: &str, generation: u64) -> bool {
        let mut state = self.state.lock().unwrap();
        match state.waiters.get(connection_id) {
            Some((current, _)) if *current == generation => {
                state.waiters.remove(connection_id);
                true
            }
            _ => false,
        }
    }

    fn wake(&self, connection_id: &str) {
        if let Some((_, notify)) = self.state.lock().unwrap().waiters.get(connection_id) {
            notify.notify_one();
        }
    }
}

pub type Millis = u64;
pub type ConnectionId = String;

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize)]
pub struct RoomId {
    pub collection: String,
    pub scope: Scope,
    pub routing_key: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize)]
#[serde(transparent)]
pub struct EntryKey(pub String);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
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

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DeleteRequest {
    pub collection: String,
    pub scope: Scope,
    pub connection_id: ConnectionId,
    pub session_id: Option<String>,
    pub user_id: Option<String>,
    pub custom_key: Option<String>,
    pub auth: AuthContext,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
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

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum EphemeralErrorCode {
    UnknownCollection,
    Unauthorized,
    InvalidScope,
    MissingKey,
    MissingOwner,
    InvalidTtl,
    ValueTooLarge,
    RateLimited,
    IncompatibleCollectionDefinition,
    /// A hard room/store limit (active rooms, entries per room, subscribers
    /// per room, aggregate room bytes) rejected the operation. The limits are
    /// capability facts; hitting one is a structured rejection, never a
    /// silent eviction of live entries.
    ///
    /// @ref LLP 0013#room-store-model — memory pressure must be explicit.
    RoomLimitExceeded,
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
            Self::RateLimited => "SNAPBACK_EPHEMERAL_RATE_LIMITED",
            Self::IncompatibleCollectionDefinition => {
                "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
            }
            Self::RoomLimitExceeded => "SNAPBACK_EPHEMERAL_ROOM_LIMIT_EXCEEDED",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
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
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RemoveReason {
    Deleted,
    Disconnected,
    Expired,
}

/// Why a subscriber must resnapshot. `Restarted` is sent when runtime reset or
/// a destructive definition replacement discards room state under live
/// connections. `EpochChanged`/`AuthChanged` were removed 2026-07-02: the
/// local authority never re-epochs a live room (epochs advance per room
/// incarnation instead) and auth revocation is not integrated, so both were
/// unreachable.
///
/// @ref LLP 0026#finding-scope-epoch-machinery-was-dead-code-recorded-2026-07-02 — live-or-removed resolution.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ResyncReason {
    QueueOverflow,
    Restarted,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum EphemeralMessage {
    Snapshot {
        room: RoomId,
        scope_epoch: u64,
        entries: Vec<EphemeralEntry>,
    },
    Upsert {
        room: RoomId,
        entry: EphemeralEntry,
    },
    Remove {
        room: RoomId,
        key: EntryKey,
        scope_epoch: u64,
        entry_version: u64,
        reason: RemoveReason,
    },
    ResyncRequired {
        room: RoomId,
        scope_epoch: u64,
        reason: ResyncReason,
    },
    Error {
        room: Option<RoomId>,
        error: EphemeralError,
    },
}

impl EphemeralMessage {
    fn coalesce_key(&self) -> Option<(RoomId, EntryKey)> {
        match self {
            Self::Upsert { room, entry } => Some((room.clone(), entry.key.clone())),
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
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DurableMessage {
    pub payload: Vec<u8>,
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct EphemeralDiagnostics {
    pub room_count: usize,
    pub entry_count: usize,
    pub subscriber_count: usize,
    pub value_bytes: usize,
    pub active_rooms: Vec<EphemeralRoomDiagnostics>,
    pub pending_ephemeral_keys: usize,
    pub pending_durable_messages: usize,
    pub pending_resync_messages: usize,
    pub rejected_publishes: u64,
    pub rate_limited_publishes: u64,
    pub oversized_publishes: u64,
    pub unauthorized_requests: u64,
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

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct EphemeralRoomDiagnostics {
    pub collection: String,
    pub routing_key: String,
    pub scope: Scope,
    pub scope_epoch: u64,
    pub entries: usize,
    pub subscribers: usize,
    pub value_bytes: usize,
}

#[derive(Clone, Debug)]
struct EntryRecord {
    owner: EntryOwner,
    value: Vec<u8>,
    received_at_ms: Millis,
    expires_at_ms: Millis,
    scope_epoch: u64,
    entry_version: u64,
    serialized_bytes: usize,
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
    auth: AuthContext,
}

#[derive(Clone, Debug)]
struct RoomState {
    scope_epoch: u64,
    next_entry_version: u64,
    entries: BTreeMap<EntryKey, EntryRecord>,
    owner_connections: BTreeMap<EntryOwner, BTreeSet<ConnectionId>>,
    subscribers: BTreeMap<ConnectionId, SubscriberState>,
    /// Running aggregate of stored value bytes, for the room byte limit and
    /// diagnostics; maintained on every insert/replace/remove.
    value_bytes: usize,
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
    fn new(scope_epoch: u64) -> Self {
        Self {
            scope_epoch,
            next_entry_version: 1,
            entries: BTreeMap::new(),
            owner_connections: BTreeMap::new(),
            subscribers: BTreeMap::new(),
            value_bytes: 0,
            indexed_deadline: None,
            retired: false,
        }
    }

    fn allocate_version(&mut self) -> u64 {
        let version = self.next_entry_version;
        self.next_entry_version += 1;
        version
    }

    fn remember_owner_connection(&mut self, owner: &EntryOwner, connection_id: &str) {
        self.owner_connections
            .entry(owner.clone())
            .or_default()
            .insert(connection_id.to_owned());
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
            tokens_milli: collection.burst as u64 * 1_000,
            last_refill_ms: now_ms,
        }
    }

    fn allow(&mut self, collection: &EphemeralCollection, now_ms: Millis) -> bool {
        let elapsed = now_ms.saturating_sub(self.last_refill_ms);
        let refill = elapsed * collection.sustained_hz as u64;
        let capacity = collection.burst as u64 * 1_000;
        self.tokens_milli = (self.tokens_milli + refill).min(capacity);
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
    resync: VecDeque<EphemeralMessage>,
    ephemeral: BTreeMap<(RoomId, EntryKey), EphemeralMessage>,
    max_pending_ephemeral_keys: usize,
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L1: the durable
    // and resync lanes are bounded like the ephemeral map. A subscriber that
    // never drains cannot accumulate unbounded query-result payloads; a lane at
    // capacity converts the whole queue to a single resync signal (sticky until
    // drained), never a silent drop.
    overflowed: bool,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct QueuePush {
    coalesced: bool,
    resync_count: usize,
    overflowed: bool,
}

impl OutboundQueue {
    fn new(max_pending_ephemeral_keys: usize) -> Self {
        Self {
            durable: VecDeque::new(),
            resync: VecDeque::new(),
            ephemeral: BTreeMap::new(),
            max_pending_ephemeral_keys,
            overflowed: false,
        }
    }

    /// Convert the queue to a single durable resync signal: the connection is
    /// too far behind to replay its backlog, so drop all pending state and tell
    /// the client to re-snapshot rather than losing updates silently. Sticky
    /// until `drain` empties the queue.
    ///
    /// @ref LLP 0008#realtime-delivery — overflow is a resync signal, never a drop.
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L1.
    fn overflow(&mut self) -> bool {
        if self.overflowed {
            return false;
        }
        self.durable.clear();
        self.resync.clear();
        self.ephemeral.clear();
        self.durable.push_back(DurableMessage {
            payload: serde_json::to_vec(&json!({
                "kind": "resync_required",
                "reason": "outbox_overflow",
                "clearRetained": true,
            }))
            .unwrap_or_default(),
        });
        self.overflowed = true;
        true
    }

    /// Push a non-coalescable message (resync/remove) into the resync lane,
    /// escalating to a full overflow signal if the lane is at capacity.
    fn push_resync(&mut self, message: EphemeralMessage) {
        if self.overflowed {
            return;
        }
        if self.resync.len() >= MAX_OUTBOX_BACKLOG {
            self.overflow();
            return;
        }
        self.resync.push_back(message);
    }

    fn push_ephemeral(&mut self, message: EphemeralMessage) -> QueuePush {
        if self.overflowed {
            return QueuePush::default();
        }
        let Some(key) = message.coalesce_key() else {
            let before = self.overflowed;
            self.push_resync(message);
            return QueuePush {
                overflowed: self.overflowed && !before,
                ..QueuePush::default()
            };
        };

        if !self.ephemeral.contains_key(&key)
            && self.ephemeral.len() >= self.max_pending_ephemeral_keys
        {
            let mut resync_epochs = self
                .ephemeral
                .values()
                .filter_map(|pending| {
                    let (room, _) = pending.coalesce_key()?;
                    let epoch = pending.scope_epoch()?;
                    Some((room, epoch))
                })
                .collect::<BTreeMap<_, _>>();
            resync_epochs.insert(key.0.clone(), message.scope_epoch().unwrap_or_default());
            self.ephemeral.clear();

            let resync_count = resync_epochs.len();
            for (room, scope_epoch) in resync_epochs {
                self.push_resync(EphemeralMessage::ResyncRequired {
                    room,
                    scope_epoch,
                    reason: ResyncReason::QueueOverflow,
                });
            }
            return QueuePush {
                coalesced: false,
                resync_count,
                overflowed: self.overflowed,
            };
        }

        QueuePush {
            coalesced: self.ephemeral.insert(key, message).is_some(),
            resync_count: 0,
            overflowed: false,
        }
    }

    /// Push a durable live-query update, bounding the lane. Returns whether this
    /// push caused an overflow-to-resync.
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L1.
    fn push_durable(&mut self, message: DurableMessage) -> bool {
        if self.overflowed {
            return false;
        }
        if self.durable.len() >= MAX_OUTBOX_BACKLOG {
            return self.overflow();
        }
        self.durable.push_back(message);
        false
    }

    fn drain(&mut self) -> Vec<RealtimeEnvelope> {
        let mut messages = Vec::new();
        while let Some(message) = self.durable.pop_front() {
            messages.push(RealtimeEnvelope::Durable(message));
        }
        while let Some(message) = self.resync.pop_front() {
            messages.push(RealtimeEnvelope::Ephemeral(message));
        }
        for (_, message) in std::mem::take(&mut self.ephemeral) {
            messages.push(RealtimeEnvelope::Ephemeral(message));
        }
        // Drained: the queue can accept fresh state again.
        self.overflowed = false;
        messages
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
    /// Maximum aggregate stored value bytes per room.
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

/// The shared state behind the backend handle. All synchronization is
/// internal: a read-mostly collections registry, a small global routing map
/// whose values are per-room locks, per-connection outbox locks, a
/// rate-bucket map, a room-granular expiry index, and atomic event counters.
///
/// Lock order (outer to inner): `rooms` map → one room → { `outboxes` map,
/// one outbox, `expiry_index` }, the inner three as leaves taken one at a
/// time. Never two room locks; never a room lock while holding an outbox or
/// index lock; nothing that holds a room lock ever waits on the `rooms` map
/// (the retire/wipe/prune paths take the map first, and prune only
/// `try_lock`s the room).
///
/// @ref LLP 0026#as-built-sharded-local-room-authority-written-2026-07-02-before-the-l9-implementation — the sharded design and its lock order.
struct EphemeralShared {
    collections: RwLock<BTreeMap<String, EphemeralCollection>>,
    rooms: StdMutex<BTreeMap<RoomId, SharedRoom>>,
    outboxes: StdMutex<BTreeMap<ConnectionId, SharedOutbox>>,
    rate_buckets: StdMutex<BTreeMap<(ConnectionId, String), RateBucket>>,
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
    pub fn new() -> Self {
        Self::with_limits(EphemeralStoreLimits::default())
    }

    /// A store with explicit hard limits (tests, future capability overrides).
    pub fn with_limits(limits: EphemeralStoreLimits) -> Self {
        Self {
            shared: Arc::new(EphemeralShared {
                collections: RwLock::new(BTreeMap::new()),
                rooms: StdMutex::new(BTreeMap::new()),
                outboxes: StdMutex::new(BTreeMap::new()),
                rate_buckets: StdMutex::new(BTreeMap::new()),
                expiry_index: StdMutex::new(BTreeMap::new()),
                counters: EventCounters::default(),
                next_scope_epoch: AtomicU64::new(1),
                limits,
                delivery: Arc::new(DeliveryNotifier::default()),
            }),
        }
    }

    /// The notifier the delivery task registers with (L8).
    pub fn delivery_notifier(&self) -> Arc<DeliveryNotifier> {
        self.shared.delivery.clone()
    }

    pub fn register_collection(&self, collection: EphemeralCollection) {
        self.shared
            .collections
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(collection.name.clone(), collection);
    }

    /// Provisioning-time definition load. Identical definitions are an
    /// idempotent no-op; changed definitions are a destructive replacement
    /// that retires all rooms and signals every registered subscriber.
    pub fn replace_collections(&self, collections: Vec<EphemeralCollection>) {
        let next = collections
            .into_iter()
            .map(|collection| (collection.name.clone(), collection))
            .collect::<BTreeMap<_, _>>();

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
                return;
            }
            *current = next;
        }

        // A destructive replacement discards room state under live
        // connections: tell each registered subscriber to resubscribe instead
        // of going silent. Pending durable-lane messages are preserved — they
        // belong to durable subscriptions that survive a definition load.
        self.wipe_rooms_signaling_restart(true);
        lock(&self.shared.rate_buckets).clear();
    }

    pub fn ensure_collections(
        &self,
        collections: Vec<EphemeralCollection>,
    ) -> Result<CollectionEnsureOutcome, EphemeralError> {
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
        self.shared.counters.reset();
        self.wipe_rooms_signaling_restart(false);
        lock(&self.shared.rate_buckets).clear();
    }

    pub fn publish(
        &self,
        request: PublishRequest,
        now_ms: Millis,
    ) -> Result<PublishOutcome, EphemeralError> {
        let collection = self.collection(&request.collection)?;
        let room_id = room_id_for(&collection, &request.scope)?;
        let ttl_ms = request.ttl_ms.unwrap_or(collection.default_ttl_ms);
        self.validate_ttl(&collection, ttl_ms)?;
        self.validate_value_size(&collection, request.value.len())?;
        self.ensure_authorized(&collection.publish, &request.scope, &request.auth)?;
        let key = entry_key_for_publish(&collection, &request)?;
        let owner = entry_owner_for(&collection, &request)?;
        self.ensure_publish_rate(&collection, &request.connection_id, now_ms)?;

        let expires_at_ms = now_ms + ttl_ms;
        let connection_id = request.connection_id;
        let value = request.value;
        let value_len = value.len();

        // One room critical section: sweep, limit checks, version allocation,
        // entry replacement, expiry indexing, and subscriber fan-out — so
        // per-room outbox order equals version order, and snapshot/register
        // atomicity holds against this publish.
        //
        // @ref LLP 0013#routing-and-rooms -- a room authority owns versions and latest-state fan-out.
        // @ref LLP 0026#as-built-sharded-local-room-authority-written-2026-07-02-before-the-l9-implementation — room-operation atomicity.
        let outcome = match self.with_room_create(&room_id, |room| {
            self.sweep_room_locked(room, &room_id, Some(&collection), now_ms);

            let replaced_bytes = room
                .entries
                .get(&key)
                .map(|record| record.serialized_bytes);
            if replaced_bytes.is_none()
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
            let projected_bytes =
                room.value_bytes.saturating_sub(replaced_bytes.unwrap_or(0)) + value_len;
            if projected_bytes > self.shared.limits.max_room_value_bytes {
                self.shared
                    .counters
                    .limit_rejections
                    .fetch_add(1, Ordering::Relaxed);
                return Err(EphemeralError::new(
                    EphemeralErrorCode::RoomLimitExceeded,
                    format!(
                        "room value-byte limit ({}) reached for {}",
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
                serialized_bytes: value_len,
            };
            let entry = record.to_entry(&key);
            if let Some(previous) = room.entries.insert(key.clone(), record) {
                room.value_bytes = room.value_bytes.saturating_sub(previous.serialized_bytes);
            }
            room.value_bytes += value_len;
            self.index_room_deadline(room, &room_id, expires_at_ms);
            self.fan_out_locked(
                room,
                &room_id,
                &collection,
                EphemeralMessage::Upsert {
                    room: room_id.clone(),
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
        outcome
    }

    pub fn delete(
        &self,
        request: DeleteRequest,
        now_ms: Millis,
    ) -> Result<Option<EphemeralMessage>, EphemeralError> {
        let collection = self.collection(&request.collection)?;
        let room_id = room_id_for(&collection, &request.scope)?;
        self.ensure_authorized(&collection.publish, &request.scope, &request.auth)?;
        let key = entry_key_for_delete(&collection, &request)?;

        let removed = self
            .with_existing_room(&room_id, |room| {
                self.sweep_room_locked(room, &room_id, Some(&collection), now_ms);
                let removed = remove_entry_locked(room, &room_id, &key, RemoveReason::Deleted);
                if let Some(message) = &removed {
                    self.fan_out_locked(room, &room_id, &collection, message.clone());
                }
                removed
            })
            .flatten();
        self.prune_room_if_empty(&room_id);
        Ok(removed)
    }

    pub fn subscribe(
        &self,
        request: SubscribeRequest,
        now_ms: Millis,
    ) -> Result<EphemeralMessage, EphemeralError> {
        let collection = self.collection(&request.collection)?;
        let room_id = room_id_for(&collection, &request.scope)?;
        self.ensure_authorized(&collection.subscribe, &request.scope, &request.auth)?;

        // @ref LLP 0013#room-store-model -- snapshot and subscriber registration must be one room operation.
        self.with_room_create(&room_id, |room| {
            self.sweep_room_locked(room, &room_id, Some(&collection), now_ms);
            if !room.subscribers.contains_key(&request.connection_id)
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
            // The outbox exists before the registration becomes visible, so a
            // racing publish that sees this subscriber has somewhere to
            // enqueue.
            self.ensure_outbox(&request.connection_id, collection.max_pending_ephemeral_keys);
            let entries = room
                .entries
                .iter()
                .map(|(key, record)| record.to_entry(key))
                .collect();
            room.subscribers.insert(
                request.connection_id.clone(),
                SubscriberState {
                    auth: request.auth.clone(),
                },
            );
            Ok(EphemeralMessage::Snapshot {
                room: room_id.clone(),
                scope_epoch: room.scope_epoch,
                entries,
            })
        })?
    }

    pub fn disconnect(&self, connection_id: &str, now_ms: Millis) {
        let rooms: Vec<(RoomId, SharedRoom)> = lock(&self.shared.rooms)
            .iter()
            .map(|(room_id, room)| (room_id.clone(), room.clone()))
            .collect();

        let mut maybe_empty = Vec::new();
        for (room_id, room_arc) in rooms {
            let collection = self.collection_if_loaded(&room_id.collection);
            let mut room = lock(&room_arc);
            if room.retired {
                continue;
            }
            self.sweep_room_locked(&mut room, &room_id, collection.as_ref(), now_ms);
            room.subscribers.remove(connection_id);
            let mut owners_to_remove = Vec::new();
            for (owner, connections) in room.owner_connections.iter_mut() {
                connections.remove(connection_id);
                if connections.is_empty() {
                    owners_to_remove.push(owner.clone());
                }
            }
            for owner in owners_to_remove {
                room.owner_connections.remove(&owner);
                let keys = room
                    .entries
                    .iter()
                    .filter_map(|(key, record)| (record.owner == owner).then_some(key.clone()))
                    .collect::<Vec<_>>();
                for key in keys {
                    if let Some(message) =
                        remove_entry_locked(&mut room, &room_id, &key, RemoveReason::Disconnected)
                    {
                        self.shared
                            .counters
                            .disconnected_entries
                            .fetch_add(1, Ordering::Relaxed);
                        if let Some(collection) = &collection {
                            self.fan_out_locked(&room, &room_id, collection, message);
                        }
                    }
                }
            }
            if room.entries.is_empty() && room.subscribers.is_empty() {
                maybe_empty.push(room_id);
            }
        }
        for room_id in maybe_empty {
            self.prune_room_if_empty(&room_id);
        }

        lock(&self.shared.outboxes).remove(connection_id);
        // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D6:
        // rate buckets are keyed by (connection, collection); drop this
        // connection's buckets on disconnect so they do not leak forever.
        lock(&self.shared.rate_buckets).retain(|(conn, _), _| conn != connection_id);
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
                    }
                    self.sweep_room_locked(room, &room_id, collection.as_ref(), now_ms);
                    if let Some(earliest) = room
                        .entries
                        .values()
                        .map(|record| record.expires_at_ms)
                        .min()
                    {
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

    pub fn enqueue_durable(&self, connection_id: impl Into<String>, payload: Vec<u8>) {
        let connection_id = connection_id.into();
        let outbox = self.ensure_outbox(&connection_id, default_max_pending_ephemeral_keys());
        let overflowed = lock(&outbox).push_durable(DurableMessage { payload });
        if overflowed {
            self.shared
                .counters
                .outbox_overflows
                .fetch_add(1, Ordering::Relaxed);
        }
        // Push-before-wake: the L8 lost-wakeup argument relies on the message
        // being drainable by the time the waker fires (see LLP 0026's L6/L7
        // interaction note — enqueues are no longer serialized by the global
        // mutex).
        self.shared.delivery.wake(&connection_id);
    }

    pub fn drain_outbox(&self, connection_id: &str) -> Vec<RealtimeEnvelope> {
        let outbox = lock(&self.shared.outboxes).get(connection_id).cloned();
        outbox
            .map(|outbox| lock(&outbox).drain())
            .unwrap_or_default()
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
            diagnostics.active_rooms.push(EphemeralRoomDiagnostics {
                collection: room_id.collection.clone(),
                routing_key: room_id.routing_key.clone(),
                scope: room_id.scope.clone(),
                scope_epoch: room.scope_epoch,
                entries: room.entries.len(),
                subscribers: room.subscribers.len(),
                value_bytes: room.value_bytes,
            });
        }

        let outboxes: Vec<SharedOutbox> = lock(&self.shared.outboxes).values().cloned().collect();
        for outbox in outboxes {
            let outbox = lock(&outbox);
            diagnostics.pending_ephemeral_keys += outbox.ephemeral.len();
            diagnostics.pending_durable_messages += outbox.durable.len();
            diagnostics.pending_resync_messages += outbox.resync.len();
        }
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
                    let created = Arc::new(StdMutex::new(RoomState::new(epoch)));
                    rooms.insert(room_id.clone(), created.clone());
                    created
                }
            };
            let mut room = lock(&room_arc);
            if room.retired {
                continue;
            }
            let f = f.take().expect("retire retry runs the closure at most once");
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
            let f = f.take().expect("retire retry runs the closure at most once");
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
        }
    }

    /// Retire every room, delivering `ResyncRequired { reason: Restarted }`
    /// to each registered subscriber: runtime reset and destructive
    /// definition replacement discard the authority's state under live
    /// connections, and going silent would leave subscribers believing a
    /// dead stream is current (the scope-epoch finding). `preserve_durable`
    /// keeps pending durable-lane messages — definition replacement does not
    /// invalidate durable subscriptions; reset clears whole outboxes because
    /// it clears the subscriptions themselves.
    ///
    /// @ref LLP 0026#finding-scope-epoch-machinery-was-dead-code-recorded-2026-07-02 — the Restarted wiring.
    fn wipe_rooms_signaling_restart(&self, preserve_durable: bool) {
        let room_ids: Vec<RoomId> = lock(&self.shared.rooms).keys().cloned().collect();
        let mut resyncs: Vec<(ConnectionId, EphemeralMessage)> = Vec::new();
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
            for connection_id in room.subscribers.keys() {
                resyncs.push((
                    connection_id.clone(),
                    EphemeralMessage::ResyncRequired {
                        room: room_id.clone(),
                        scope_epoch: room.scope_epoch,
                        reason: ResyncReason::Restarted,
                    },
                ));
            }
        }
        lock(&self.shared.expiry_index).clear();

        if preserve_durable {
            let outboxes: Vec<SharedOutbox> =
                lock(&self.shared.outboxes).values().cloned().collect();
            for outbox in outboxes {
                let mut outbox = lock(&outbox);
                outbox.resync.clear();
                outbox.ephemeral.clear();
            }
        } else {
            lock(&self.shared.outboxes).clear();
        }

        for (connection_id, message) in resyncs {
            let outbox = self.ensure_outbox(&connection_id, default_max_pending_ephemeral_keys());
            lock(&outbox).push_resync(message);
            self.shared
                .counters
                .resync_required
                .fetch_add(1, Ordering::Relaxed);
            self.shared.delivery.wake(&connection_id);
        }
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
                .entry((connection_id.to_owned(), collection.name.clone()))
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
    ) {
        let expired_keys = room
            .entries
            .iter()
            .filter_map(|(key, record)| (record.expires_at_ms <= now_ms).then_some(key.clone()))
            .collect::<Vec<_>>();
        for key in expired_keys {
            if let Some(message) = remove_entry_locked(room, room_id, &key, RemoveReason::Expired) {
                self.shared
                    .counters
                    .expired_entries
                    .fetch_add(1, Ordering::Relaxed);
                if let Some(collection) = collection {
                    self.fan_out_locked(room, room_id, collection, message);
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
        room_id: &RoomId,
        collection: &EphemeralCollection,
        message: EphemeralMessage,
    ) {
        let recipients = room
            .subscribers
            .iter()
            .filter_map(|(connection_id, subscriber)| {
                collection
                    .subscribe
                    .allows(&room_id.scope, &subscriber.auth)
                    .then_some(connection_id.clone())
            })
            .collect::<Vec<_>>();

        for connection_id in recipients {
            let outbox = self.ensure_outbox(&connection_id, collection.max_pending_ephemeral_keys);
            let result = lock(&outbox).push_ephemeral(message.clone());
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
            // L8: wake the subscriber's delivery task (push-before-wake).
            self.shared.delivery.wake(&connection_id);
        }
    }

    fn ensure_outbox(&self, connection_id: &str, max_pending_ephemeral_keys: usize) -> SharedOutbox {
        lock(&self.shared.outboxes)
            .entry(connection_id.to_owned())
            .or_insert_with(|| {
                Arc::new(StdMutex::new(OutboundQueue::new(max_pending_ephemeral_keys)))
            })
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
        if let Some(previous) = room.indexed_deadline.take() {
            index.remove(&(previous, room_id.clone()));
        }
        index.insert((deadline, room_id.clone()), ());
        room.indexed_deadline = Some(deadline);
    }
}

fn remove_entry_locked(
    room: &mut RoomState,
    room_id: &RoomId,
    key: &EntryKey,
    reason: RemoveReason,
) -> Option<EphemeralMessage> {
    let record = room.entries.remove(key)?;
    room.value_bytes = room.value_bytes.saturating_sub(record.serialized_bytes);
    room.owner_connections.remove(&record.owner);
    let entry_version = room.allocate_version();
    Some(EphemeralMessage::Remove {
        room: room_id.clone(),
        key: key.clone(),
        scope_epoch: room.scope_epoch,
        entry_version,
        reason,
    })
}

fn room_id_for(collection: &EphemeralCollection, scope: &Scope) -> Result<RoomId, EphemeralError> {
    for field in &collection.scope_fields {
        if !scope.0.contains_key(field) {
            return Err(EphemeralError::new(
                EphemeralErrorCode::InvalidScope,
                format!(
                    "scope is missing required field {field} for {}",
                    collection.name
                ),
            ));
        }
    }

    let routing_key = scope.routed_key(&collection.routing_fields).ok_or_else(|| {
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
        KeyMode::Session => request
            .session_id
            .clone()
            .or_else(|| request.auth.session_id.clone())
            .map(EntryOwner::Session)
            .ok_or_else(|| {
                EphemeralError::new(EphemeralErrorCode::MissingOwner, "missing session owner")
            }),
        KeyMode::User => request
            .user_id
            .clone()
            .or_else(|| request.auth.user_id.clone())
            .map(EntryOwner::User)
            .ok_or_else(|| {
                EphemeralError::new(EphemeralErrorCode::MissingOwner, "missing user owner")
            }),
        KeyMode::Custom => request
            .custom_key
            .clone()
            .map(EntryOwner::Custom)
            .ok_or_else(|| {
                EphemeralError::new(EphemeralErrorCode::MissingKey, "missing custom key")
            }),
    }
}

fn entry_key_for_publish(
    collection: &EphemeralCollection,
    request: &PublishRequest,
) -> Result<EntryKey, EphemeralError> {
    match collection.key_mode {
        KeyMode::Connection => Ok(EntryKey(request.connection_id.clone())),
        KeyMode::Session => request
            .session_id
            .clone()
            .or_else(|| request.auth.session_id.clone())
            .map(EntryKey)
            .ok_or_else(|| {
                EphemeralError::new(EphemeralErrorCode::MissingKey, "missing session key")
            }),
        KeyMode::User => request
            .user_id
            .clone()
            .or_else(|| request.auth.user_id.clone())
            .map(EntryKey)
            .ok_or_else(|| {
                EphemeralError::new(EphemeralErrorCode::MissingKey, "missing user key")
            }),
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
        KeyMode::Session => request
            .session_id
            .clone()
            .or_else(|| request.auth.session_id.clone())
            .map(EntryKey)
            .ok_or_else(|| {
                EphemeralError::new(EphemeralErrorCode::MissingKey, "missing session key")
            }),
        KeyMode::User => request
            .user_id
            .clone()
            .or_else(|| request.auth.user_id.clone())
            .map(EntryKey)
            .ok_or_else(|| {
                EphemeralError::new(EphemeralErrorCode::MissingKey, "missing user key")
            }),
        KeyMode::Custom => request.custom_key.clone().map(EntryKey).ok_or_else(|| {
            EphemeralError::new(EphemeralErrorCode::MissingKey, "missing custom key")
        }),
    }
}

#[derive(Clone, Debug, Default)]
pub struct ClientEphemeralOverlay {
    rooms: BTreeMap<RoomId, OverlayRoom>,
}

#[derive(Clone, Debug, Default)]
struct OverlayRoom {
    scope_epoch: u64,
    entries: BTreeMap<EntryKey, EphemeralEntry>,
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
                entries,
            } => {
                self.rooms.insert(
                    room.clone(),
                    OverlayRoom {
                        scope_epoch: *scope_epoch,
                        entries: entries
                            .iter()
                            .cloned()
                            .map(|entry| (entry.key.clone(), entry))
                            .collect(),
                    },
                );
                OverlayApply::Applied
            }
            EphemeralMessage::Upsert { room, entry } => {
                let Some(overlay_room) = self.rooms.get_mut(room) else {
                    return OverlayApply::NeedsResync;
                };
                if overlay_room.scope_epoch != entry.scope_epoch {
                    return OverlayApply::NeedsResync;
                }
                if overlay_room
                    .entries
                    .get(&entry.key)
                    .is_some_and(|current| current.entry_version >= entry.entry_version)
                {
                    return OverlayApply::IgnoredStale;
                }
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
                if overlay_room
                    .entries
                    .get(key)
                    .is_some_and(|current| current.entry_version > *entry_version)
                {
                    return OverlayApply::IgnoredStale;
                }
                overlay_room.entries.remove(key);
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
        let (generation, waker) = notifier.register("conn");

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

        let (old_generation, _old_waker) = notifier.register("conn");
        // The reconnect: a new socket registers on the same connection id.
        let (new_generation, new_waker) = notifier.register("conn");

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

    fn first_ephemeral(messages: Vec<RealtimeEnvelope>) -> EphemeralMessage {
        messages
            .into_iter()
            .find_map(|message| match message {
                RealtimeEnvelope::Ephemeral(message) => Some(message),
                RealtimeEnvelope::Durable(_) => None,
            })
            .expect("expected ephemeral message")
    }

    /// LLP 0032 S5.D6 — a connection's rate buckets are dropped on disconnect,
    /// not leaked forever.
    #[test]
    fn s5_d6_disconnect_clears_rate_buckets() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection());

        backend
            .publish(publish_request("a", b"cursor"), 1_000)
            .unwrap();
        assert!(
            lock(&backend.shared.rate_buckets)
                .keys()
                .any(|(conn, _)| conn == "a"),
            "publishing should create a rate bucket for the connection"
        );

        backend.disconnect("a", 1_100);
        assert!(
            !lock(&backend.shared.rate_buckets)
                .keys()
                .any(|(conn, _)| conn == "a"),
            "disconnect must drop the connection's rate buckets"
        );
    }

    #[test]
    fn subscriber_gets_snapshot_then_live_cursor_update() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection());

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
        backend.register_collection(collection());
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
        backend.register_collection(collection());
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
        backend.register_collection(collection());
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
        backend.register_collection(collection());
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
        backend.register_collection(collection);

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
    fn durable_lane_drains_before_ephemeral_lane() {
        let backend = LocalEphemeralBackend::new();
        backend.register_collection(collection());
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
        backend.register_collection(collection());
        let mut request = subscribe_request("b");
        request.auth = AuthContext::default();

        let error = backend.subscribe(request, 1_000).unwrap_err();
        assert_eq!(error.code, EphemeralErrorCode::Unauthorized);
    }

    #[test]
    fn overlay_prunes_expired_entries_in_memory() {
        let room = room();
        let mut overlay = ClientEphemeralOverlay::default();
        overlay.apply(&EphemeralMessage::Snapshot {
            room: room.clone(),
            scope_epoch: 1,
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
        backend.register_collection(collection());

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
        backend.register_collection(collection);

        let mut first = publish_request("tab-a", b"online");
        first.user_id = Some("user-1".to_owned());
        let published = backend.publish(first, 1_000).unwrap();

        let mut second = publish_request("tab-b", b"online-again");
        second.user_id = Some("user-1".to_owned());
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
        backend.register_collection(collection);

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

    /// LLP 0032 L9 / LLP 0026 Phase 2 — every hard limit (entries per room,
    /// aggregate room bytes, subscribers per room, active rooms) rejects with
    /// a structured `RoomLimitExceeded` and leaves the room snapshot exactly
    /// as it was: never a silent eviction. Pruning an emptied room frees
    /// active-room capacity again.
    #[test]
    fn l9_room_limits_reject_never_silently_evict() {
        let backend = LocalEphemeralBackend::with_limits(EphemeralStoreLimits {
            max_active_rooms: 1,
            max_entries_per_room: 2,
            max_subscribers_per_room: 1,
            max_room_value_bytes: 8,
        });
        let mut collection = EphemeralCollection::local_cursor("boardCursors", "boardId");
        collection.key_mode = KeyMode::Custom;
        backend.register_collection(collection);

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

        backend.publish(publish("k1", b"aaa", "board-1"), 1_000).unwrap();
        backend.publish(publish("k2", b"bbb", "board-1"), 1_000).unwrap();

        // Entry cap: a third key is rejected.
        let entry_cap = backend
            .publish(publish("k3", b"ccc", "board-1"), 1_000)
            .unwrap_err();
        assert_eq!(entry_cap.code, EphemeralErrorCode::RoomLimitExceeded);

        // Byte cap: replacing k1 with a larger value would exceed 8 bytes.
        let byte_cap = backend
            .publish(publish("k1", b"seven!!", "board-1"), 1_001)
            .unwrap_err();
        assert_eq!(byte_cap.code, EphemeralErrorCode::RoomLimitExceeded);

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
        backend.register_collection(
            EphemeralCollection::local_cursor("boardCursors", "boardId"),
        );
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
        backend.register_collection(
            EphemeralCollection::local_cursor("boardCursors", "boardId"),
        );
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

    /// LLP 0032 L9 — the Restarted machinery is live: a destructive
    /// definition replacement and an explicit runtime reset both deliver
    /// `ResyncRequired { reason: Restarted }` to registered subscribers
    /// instead of silently discarding their rooms. Replacement preserves
    /// pending durable-lane messages (durable subscriptions survive a
    /// definition load); reset clears them.
    #[test]
    fn l9_reset_and_destructive_replace_signal_restarted() {
        let backend = LocalEphemeralBackend::new();
        let collection = EphemeralCollection::local_cursor("boardCursors", "boardId");
        backend.replace_collections(vec![collection.clone()]);

        let subscribe = SubscribeRequest {
            collection: "boardCursors".to_owned(),
            scope: Scope::from_pairs([("boardId", "board-1")]),
            connection_id: "observer".to_owned(),
            auth: AuthContext::default(),
        };
        backend.subscribe(subscribe.clone(), 1_000).unwrap();
        backend.enqueue_durable("observer", b"{\"kind\":\"live_replace\"}".to_vec());

        // Destructive replacement: a changed definition.
        let mut changed = collection.clone();
        changed.max_value_bytes = 512;
        backend.replace_collections(vec![changed.clone()]);

        let messages = backend.drain_outbox("observer");
        assert_eq!(messages.len(), 2, "durable survives + one restart signal");
        let RealtimeEnvelope::Durable(durable) = &messages[0] else {
            panic!("pending durable messages must survive a definition replacement");
        };
        assert_eq!(durable.payload, b"{\"kind\":\"live_replace\"}".to_vec());
        assert!(matches!(
            &messages[1],
            RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired {
                reason: ResyncReason::Restarted,
                ..
            })
        ));

        // Explicit runtime reset: subscribers get the restart signal; the
        // durable lane goes with the subscriptions it belonged to.
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

    /// LLP 0013 §Room store model / LLP 0026 Phase 2 — snapshot and
    /// registration are one room operation even with the room authority off
    /// any global lock: a subscriber that joins mid-stream converges to every
    /// publisher's final value (no publish falls between snapshot and
    /// registration) and never observes an epoch tear.
    #[test]
    fn l9_snapshot_registration_is_atomic_under_concurrent_publishes() {
        use std::sync::atomic::AtomicU64 as ClockCell;

        let backend = LocalEphemeralBackend::new();
        backend.register_collection(
            EphemeralCollection::local_cursor("boardCursors", "boardId"),
        );
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

}
