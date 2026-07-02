use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Notify;

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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RemoveReason {
    Deleted,
    Disconnected,
    Expired,
    AuthRevoked,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ResyncReason {
    QueueOverflow,
    EpochChanged,
    Restarted,
    AuthChanged,
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
}

impl RoomState {
    fn new(scope_epoch: u64) -> Self {
        Self {
            scope_epoch,
            next_entry_version: 1,
            entries: BTreeMap::new(),
            owner_connections: BTreeMap::new(),
            subscribers: BTreeMap::new(),
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

pub struct LocalEphemeralBackend {
    collections: BTreeMap<String, EphemeralCollection>,
    rooms: BTreeMap<RoomId, RoomState>,
    rate_buckets: BTreeMap<(ConnectionId, String), RateBucket>,
    outbox: BTreeMap<ConnectionId, OutboundQueue>,
    diagnostics: EphemeralDiagnostics,
    // Monotonic scope-epoch source (ENG-22478 review fix D): epochs survive
    // room recreation — a room rebuilt after collection replace/reset gets a
    // HIGHER epoch, so entry versions restarting at 1 are never mistaken for
    // stale updates within an attached overlay's previous window. Never
    // reset (monotonic for the process lifetime).
    scope_epoch_counter: u64,
    // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L8: wakes the
    // delivery task on enqueue instead of a 25ms poll.
    delivery: Arc<DeliveryNotifier>,
}

impl Default for LocalEphemeralBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalEphemeralBackend {
    pub fn new() -> Self {
        Self {
            collections: BTreeMap::new(),
            rooms: BTreeMap::new(),
            rate_buckets: BTreeMap::new(),
            outbox: BTreeMap::new(),
            diagnostics: EphemeralDiagnostics::default(),
            scope_epoch_counter: 0,
            delivery: Arc::new(DeliveryNotifier::default()),
        }
    }

    /// The notifier the delivery task registers with (L8).
    pub fn delivery_notifier(&self) -> Arc<DeliveryNotifier> {
        self.delivery.clone()
    }

    pub fn register_collection(&mut self, collection: EphemeralCollection) {
        self.collections.insert(collection.name.clone(), collection);
    }

    pub fn replace_collections(&mut self, collections: Vec<EphemeralCollection>) {
        let next = collections
            .into_iter()
            .map(|collection| (collection.name.clone(), collection))
            .collect::<BTreeMap<_, _>>();

        // @ref LLP 0025#store-feature-idempotent-collection-ensure — repeated
        // app-definition loads with identical ephemeral definitions must not
        // erase active cursor rooms or queued latest-state messages.
        if self.collections == next {
            return;
        }

        self.clear_rooms_with_resync(ResyncReason::EpochChanged);
        self.collections = next;
    }

    /// Tear down every room while telling its attached subscribers to
    /// re-snapshot (ENG-22478 review fix D): the room's epoch is retired, a
    /// recreated room gets a strictly higher one (the monotonic counter), and
    /// the ResyncRequired boundary is what turns the epoch bump into an
    /// overlay resubscription instead of silent ignored_stale drops.
    fn clear_rooms_with_resync(&mut self, reason: ResyncReason) {
        let attached: Vec<(RoomId, u64, Vec<ConnectionId>)> = self
            .rooms
            .iter()
            .map(|(room_id, room)| {
                (
                    room_id.clone(),
                    room.scope_epoch,
                    room.subscribers.keys().cloned().collect(),
                )
            })
            .collect();
        self.rooms.clear();
        self.rate_buckets.clear();
        self.outbox.clear();
        for (room_id, scope_epoch, subscribers) in attached {
            let Some(collection) = self.collections.get(&room_id.collection).cloned() else {
                continue;
            };
            for connection_id in subscribers {
                let queue = self.ensure_outbox(&connection_id, &collection);
                queue.push_ephemeral(EphemeralMessage::ResyncRequired {
                    room: room_id.clone(),
                    scope_epoch,
                    reason: reason.clone(),
                });
                self.delivery.wake(&connection_id);
            }
        }
    }

    pub fn ensure_collections(
        &mut self,
        collections: Vec<EphemeralCollection>,
    ) -> Result<CollectionEnsureOutcome, EphemeralError> {
        let expected = collections
            .into_iter()
            .map(|collection| (collection.name.clone(), collection))
            .collect::<BTreeMap<_, _>>();
        let expected_names = expected.keys().cloned().collect::<BTreeSet<_>>();
        let loaded_names = self.collections.keys().cloned().collect::<BTreeSet<_>>();

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
                self.collections
                    .get(name)
                    .filter(|loaded| *loaded != expected)
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

        Ok(CollectionEnsureOutcome {
            collection_count: expected.len(),
            preserved_room_count: self.rooms.len(),
            preserved_outbox_count: self.outbox.len(),
        })
    }

    pub fn reset_runtime_state(&mut self) {
        self.clear_rooms_with_resync(ResyncReason::Restarted);
        self.diagnostics = EphemeralDiagnostics::default();
    }

    pub fn publish(
        &mut self,
        request: PublishRequest,
        now_ms: Millis,
    ) -> Result<PublishOutcome, EphemeralError> {
        let collection = self.collection(&request.collection)?;
        let room_id = self.room_id(&collection, &request.scope)?;
        let ttl_ms = request.ttl_ms.unwrap_or(collection.default_ttl_ms);
        self.validate_ttl(&collection, ttl_ms)?;
        self.validate_value_size(&collection, request.value.len())?;
        self.ensure_authorized(&collection.publish, &request.scope, &request.auth)?;
        let key = self.entry_key_for_publish(&collection, &request)?;
        let owner = self.entry_owner(&collection, &request)?;
        self.ensure_publish_rate(&collection, &request.connection_id, now_ms)?;

        self.sweep_room_expired(&room_id, now_ms);
        let expires_at_ms = now_ms + ttl_ms;

        // @ref LLP 0013#routing-and-rooms -- a room authority owns versions and latest-state fan-out.
        let (scope_epoch, entry_version, entry) = {
            let next_epoch = self.scope_epoch_counter + 1;
            let room = self.rooms.entry(room_id.clone()).or_insert_with(|| {
                RoomState::new(next_epoch)
            });
            if room.scope_epoch == next_epoch {
                self.scope_epoch_counter = next_epoch;
            }
            let entry_version = room.allocate_version();
            let scope_epoch = room.scope_epoch;
            room.remember_owner_connection(&owner, &request.connection_id);
            let record = EntryRecord {
                owner,
                value: request.value,
                received_at_ms: now_ms,
                expires_at_ms,
                scope_epoch,
                entry_version,
                serialized_bytes: key.0.len(),
            };
            let serialized_bytes = record.value.len();
            let entry = EphemeralEntry {
                key: key.clone(),
                value: record.value.clone(),
                received_at_ms: now_ms,
                expires_at_ms,
                scope_epoch,
                entry_version,
            };
            let mut stored = record;
            stored.serialized_bytes = serialized_bytes;
            room.entries.insert(key.clone(), stored);
            (scope_epoch, entry_version, entry)
        };

        self.enqueue_to_authorized_subscribers(
            &collection,
            &room_id,
            EphemeralMessage::Upsert {
                room: room_id.clone(),
                entry,
            },
        );

        Ok(PublishOutcome {
            room: room_id,
            key,
            scope_epoch,
            entry_version,
            expires_at_ms,
        })
    }

    pub fn delete(
        &mut self,
        request: DeleteRequest,
        now_ms: Millis,
    ) -> Result<Option<EphemeralMessage>, EphemeralError> {
        let collection = self.collection(&request.collection)?;
        let room_id = self.room_id(&collection, &request.scope)?;
        self.ensure_authorized(&collection.publish, &request.scope, &request.auth)?;
        self.sweep_room_expired(&room_id, now_ms);
        let key = self.entry_key_for_delete(&collection, &request)?;

        let Some(remove) = self.remove_entry(&room_id, &key, RemoveReason::Deleted) else {
            return Ok(None);
        };

        self.enqueue_to_authorized_subscribers(&collection, &room_id, remove.clone());
        Ok(Some(remove))
    }

    pub fn subscribe(
        &mut self,
        request: SubscribeRequest,
        now_ms: Millis,
    ) -> Result<EphemeralMessage, EphemeralError> {
        let collection = self.collection(&request.collection)?;
        let room_id = self.room_id(&collection, &request.scope)?;
        self.ensure_authorized(&collection.subscribe, &request.scope, &request.auth)?;
        self.sweep_room_expired(&room_id, now_ms);

        // @ref LLP 0013#room-store-model -- snapshot and subscriber registration must be one room operation.
        let (scope_epoch, entries) = {
            let next_epoch = self.scope_epoch_counter + 1;
            let room = self.rooms.entry(room_id.clone()).or_insert_with(|| {
                RoomState::new(next_epoch)
            });
            if room.scope_epoch == next_epoch {
                self.scope_epoch_counter = next_epoch;
            }
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
            (room.scope_epoch, entries)
        };
        self.ensure_outbox(&request.connection_id, &collection);

        Ok(EphemeralMessage::Snapshot {
            room: room_id,
            scope_epoch,
            entries,
        })
    }

    pub fn disconnect(&mut self, connection_id: &str, now_ms: Millis) {
        let room_ids = self.rooms.keys().cloned().collect::<Vec<_>>();
        let mut removals = Vec::new();

        for room_id in room_ids {
            self.sweep_room_expired(&room_id, now_ms);
            if let Some(room) = self.rooms.get_mut(&room_id) {
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
                        if let Some(message) = Self::remove_entry_from_room(
                            room,
                            &room_id,
                            &key,
                            RemoveReason::Disconnected,
                        ) {
                            removals.push((room_id.clone(), message));
                            self.diagnostics.disconnected_entries += 1;
                        }
                    }
                }
            }
        }

        for (room_id, message) in removals {
            if let Some(collection) = self.collections.get(&room_id.collection).cloned() {
                self.enqueue_to_authorized_subscribers(&collection, &room_id, message);
            }
        }
        self.outbox.remove(connection_id);
        // @ref LLP 0032#phase-1--safety-floor-and-confirmed-defects — S5.D6:
        // rate buckets are keyed by (connection, collection); drop this
        // connection's buckets on disconnect so they do not leak forever.
        self.rate_buckets
            .retain(|(conn, _), _| conn != connection_id);
    }

    pub fn cleanup_expired(&mut self, now_ms: Millis) {
        let room_ids = self.rooms.keys().cloned().collect::<Vec<_>>();
        for room_id in room_ids {
            self.sweep_room_expired(&room_id, now_ms);
        }
    }

    pub fn enqueue_durable(&mut self, connection_id: impl Into<String>, payload: Vec<u8>) {
        let connection_id = connection_id.into();
        let overflowed = self
            .outbox
            .entry(connection_id.clone())
            .or_insert_with(|| OutboundQueue::new(1_024))
            .push_durable(DurableMessage { payload });
        if overflowed {
            self.diagnostics.outbox_overflows += 1;
        }
        self.delivery.wake(&connection_id);
    }

    pub fn drain_outbox(&mut self, connection_id: &str) -> Vec<RealtimeEnvelope> {
        self.outbox
            .get_mut(connection_id)
            .map(OutboundQueue::drain)
            .unwrap_or_default()
    }

    pub fn diagnostics(&mut self) -> EphemeralDiagnostics {
        // @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L4: the
        // gauge recompute happens here, on demand, not after every operation.
        self.recompute_counts();
        self.diagnostics.clone()
    }

    fn collection(&self, name: &str) -> Result<EphemeralCollection, EphemeralError> {
        self.collections.get(name).cloned().ok_or_else(|| {
            EphemeralError::new(
                EphemeralErrorCode::UnknownCollection,
                format!("unknown ephemeral collection {name}"),
            )
        })
    }

    fn room_id(
        &self,
        collection: &EphemeralCollection,
        scope: &Scope,
    ) -> Result<RoomId, EphemeralError> {
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

    fn validate_ttl(
        &mut self,
        collection: &EphemeralCollection,
        ttl_ms: Millis,
    ) -> Result<(), EphemeralError> {
        if ttl_ms == 0 || ttl_ms > collection.max_ttl_ms {
            self.diagnostics.rejected_publishes += 1;
            return Err(EphemeralError::new(
                EphemeralErrorCode::InvalidTtl,
                format!("ttl {ttl_ms}ms is outside the collection budget"),
            ));
        }
        Ok(())
    }

    fn validate_value_size(
        &mut self,
        collection: &EphemeralCollection,
        value_bytes: usize,
    ) -> Result<(), EphemeralError> {
        let max = collection
            .max_value_bytes
            .min(collection.hard_max_value_bytes);
        if value_bytes > max {
            self.diagnostics.rejected_publishes += 1;
            self.diagnostics.oversized_publishes += 1;
            return Err(EphemeralError::new(
                EphemeralErrorCode::ValueTooLarge,
                format!("value has {value_bytes} bytes; max is {max}"),
            ));
        }
        Ok(())
    }

    fn ensure_authorized(
        &mut self,
        policy: &AccessPolicy,
        scope: &Scope,
        auth: &AuthContext,
    ) -> Result<(), EphemeralError> {
        if policy.allows(scope, auth) {
            return Ok(());
        }
        self.diagnostics.unauthorized_requests += 1;
        Err(EphemeralError::new(
            EphemeralErrorCode::Unauthorized,
            "ephemeral access denied",
        ))
    }

    fn ensure_publish_rate(
        &mut self,
        collection: &EphemeralCollection,
        connection_id: &str,
        now_ms: Millis,
    ) -> Result<(), EphemeralError> {
        // @ref LLP 0013#backpressure-and-coalescing -- publisher admission is distinct from subscriber pressure.
        let key = (connection_id.to_owned(), collection.name.clone());
        let bucket = self
            .rate_buckets
            .entry(key)
            .or_insert_with(|| RateBucket::new(collection, now_ms));
        if bucket.allow(collection, now_ms) {
            return Ok(());
        }

        self.diagnostics.rejected_publishes += 1;
        self.diagnostics.rate_limited_publishes += 1;
        Err(EphemeralError::new(
            EphemeralErrorCode::RateLimited,
            "ephemeral publish rate limit exceeded",
        ))
    }

    fn entry_owner(
        &self,
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
        &self,
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
        &self,
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

    fn sweep_room_expired(&mut self, room_id: &RoomId, now_ms: Millis) {
        let mut removals = Vec::new();
        if let Some(room) = self.rooms.get_mut(room_id) {
            let expired_keys = room
                .entries
                .iter()
                .filter_map(|(key, record)| (record.expires_at_ms <= now_ms).then_some(key.clone()))
                .collect::<Vec<_>>();
            for key in expired_keys {
                if let Some(message) =
                    Self::remove_entry_from_room(room, room_id, &key, RemoveReason::Expired)
                {
                    removals.push(message);
                    self.diagnostics.expired_entries += 1;
                }
            }
        }

        if let Some(collection) = self.collections.get(&room_id.collection).cloned() {
            for message in removals {
                self.enqueue_to_authorized_subscribers(&collection, room_id, message);
            }
        }
    }

    fn remove_entry(
        &mut self,
        room_id: &RoomId,
        key: &EntryKey,
        reason: RemoveReason,
    ) -> Option<EphemeralMessage> {
        self.rooms
            .get_mut(room_id)
            .and_then(|room| Self::remove_entry_from_room(room, room_id, key, reason))
    }

    fn remove_entry_from_room(
        room: &mut RoomState,
        room_id: &RoomId,
        key: &EntryKey,
        reason: RemoveReason,
    ) -> Option<EphemeralMessage> {
        let record = room.entries.remove(key)?;
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

    fn enqueue_to_authorized_subscribers(
        &mut self,
        collection: &EphemeralCollection,
        room_id: &RoomId,
        message: EphemeralMessage,
    ) {
        let subscribers = self
            .rooms
            .get(room_id)
            .map(|room| {
                room.subscribers
                    .iter()
                    .filter_map(|(connection_id, subscriber)| {
                        collection
                            .subscribe
                            .allows(&room_id.scope, &subscriber.auth)
                            .then_some(connection_id.clone())
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        for connection_id in subscribers {
            let queue = self.ensure_outbox(&connection_id, collection);
            let result = queue.push_ephemeral(message.clone());
            if result.coalesced {
                self.diagnostics.coalesced_updates += 1;
            }
            self.diagnostics.resync_required += result.resync_count as u64;
            if result.overflowed {
                self.diagnostics.outbox_overflows += 1;
            }
            // L8: wake the subscriber's delivery task.
            self.delivery.wake(&connection_id);
        }
    }

    fn ensure_outbox(
        &mut self,
        connection_id: &str,
        collection: &EphemeralCollection,
    ) -> &mut OutboundQueue {
        self.outbox
            .entry(connection_id.to_owned())
            .or_insert_with(|| OutboundQueue::new(collection.max_pending_ephemeral_keys))
    }

    /// Recompute the gauge diagnostics (room/entry/subscriber counts, value
    /// bytes, per-room detail, and the outbox pending totals) from the current
    /// state. These gauges are read only through [`Self::diagnostics`] (the
    /// `/inspect` path), so this O(rooms + entries + outboxes) pass runs
    /// on-demand there rather than after every publish/subscribe/delete —
    /// keeping the hot ephemeral path O(1). The event counters
    /// (`rejected_publishes`, `coalesced_updates`, `outbox_overflows`, …) are
    /// incremented at their sites and are not touched here.
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L4: counters
    /// are no longer recomputed after every ephemeral operation.
    fn recompute_counts(&mut self) {
        self.diagnostics.room_count = self.rooms.len();
        self.diagnostics.entry_count = self.rooms.values().map(|room| room.entries.len()).sum();
        self.diagnostics.subscriber_count =
            self.rooms.values().map(|room| room.subscribers.len()).sum();
        self.diagnostics.value_bytes = self
            .rooms
            .values()
            .flat_map(|room| room.entries.values())
            .map(|record| record.serialized_bytes)
            .sum();
        self.diagnostics.active_rooms = self
            .rooms
            .iter()
            .map(|(room_id, room)| EphemeralRoomDiagnostics {
                collection: room_id.collection.clone(),
                routing_key: room_id.routing_key.clone(),
                scope: room_id.scope.clone(),
                scope_epoch: room.scope_epoch,
                entries: room.entries.len(),
                subscribers: room.subscribers.len(),
                value_bytes: room
                    .entries
                    .values()
                    .map(|record| record.serialized_bytes)
                    .sum(),
            })
            .collect();
        self.diagnostics.pending_ephemeral_keys = self
            .outbox
            .values()
            .map(|queue| queue.ephemeral.len())
            .sum();
        self.diagnostics.pending_durable_messages =
            self.outbox.values().map(|queue| queue.durable.len()).sum();
        self.diagnostics.pending_resync_messages =
            self.outbox.values().map(|queue| queue.resync.len()).sum();
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
        let mut backend = LocalEphemeralBackend::new();
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
        let mut backend = LocalEphemeralBackend::new();
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
        let mut backend = LocalEphemeralBackend::new();
        backend.register_collection(collection());

        backend
            .publish(publish_request("a", b"cursor"), 1_000)
            .unwrap();
        assert!(
            backend
                .rate_buckets
                .keys()
                .any(|(conn, _)| conn == "a"),
            "publishing should create a rate bucket for the connection"
        );

        backend.disconnect("a", 1_100);
        assert!(
            !backend.rate_buckets.keys().any(|(conn, _)| conn == "a"),
            "disconnect must drop the connection's rate buckets"
        );
    }

    #[test]
    fn subscriber_gets_snapshot_then_live_cursor_update() {
        let mut backend = LocalEphemeralBackend::new();
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
        let mut backend = LocalEphemeralBackend::new();
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
        let mut backend = LocalEphemeralBackend::new();
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
        let mut backend = LocalEphemeralBackend::new();
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
        let mut backend = LocalEphemeralBackend::new();
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
        let mut backend = LocalEphemeralBackend::new();
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
        let mut backend = LocalEphemeralBackend::new();
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
        let mut backend = LocalEphemeralBackend::new();
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
        let mut backend = LocalEphemeralBackend::new();
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
        let mut backend = LocalEphemeralBackend::new();
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
        let mut backend = LocalEphemeralBackend::new();
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
        let mut backend = LocalEphemeralBackend::new();
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
}
