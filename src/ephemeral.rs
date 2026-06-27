use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde::{Deserialize, Serialize};

pub type Millis = u64;
pub type ConnectionId = String;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EphemeralCollection {
    pub name: String,
    pub key_mode: KeyMode,
    pub routing_fields: Vec<String>,
    pub default_ttl_ms: Millis,
    pub max_ttl_ms: Millis,
    pub max_value_bytes: usize,
    pub hard_max_value_bytes: usize,
    pub sustained_hz: u32,
    pub burst: u32,
    pub dispatch_ms: Millis,
    pub publish: AccessPolicy,
    pub subscribe: AccessPolicy,
    pub max_pending_ephemeral_keys: usize,
}

impl EphemeralCollection {
    pub fn local_cursor(name: impl Into<String>, routing_field: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            key_mode: KeyMode::Connection,
            routing_fields: vec![routing_field.into()],
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
    pub rejected_publishes: u64,
    pub rate_limited_publishes: u64,
    pub oversized_publishes: u64,
    pub unauthorized_requests: u64,
    pub expired_entries: u64,
    pub disconnected_entries: u64,
    pub coalesced_updates: u64,
    pub resync_required: u64,
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
    fn new() -> Self {
        Self {
            scope_epoch: 1,
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
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct QueuePush {
    coalesced: bool,
    resync_count: usize,
}

impl OutboundQueue {
    fn new(max_pending_ephemeral_keys: usize) -> Self {
        Self {
            durable: VecDeque::new(),
            resync: VecDeque::new(),
            ephemeral: BTreeMap::new(),
            max_pending_ephemeral_keys,
        }
    }

    fn push_ephemeral(&mut self, message: EphemeralMessage) -> QueuePush {
        let Some(key) = message.coalesce_key() else {
            self.resync.push_back(message);
            return QueuePush::default();
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
                self.resync.push_back(EphemeralMessage::ResyncRequired {
                    room,
                    scope_epoch,
                    reason: ResyncReason::QueueOverflow,
                });
            }
            return QueuePush {
                coalesced: false,
                resync_count,
            };
        }

        QueuePush {
            coalesced: self.ephemeral.insert(key, message).is_some(),
            resync_count: 0,
        }
    }

    fn push_durable(&mut self, message: DurableMessage) {
        self.durable.push_back(message);
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
        messages
    }
}

pub struct LocalEphemeralBackend {
    collections: BTreeMap<String, EphemeralCollection>,
    rooms: BTreeMap<RoomId, RoomState>,
    rate_buckets: BTreeMap<(ConnectionId, String), RateBucket>,
    outbox: BTreeMap<ConnectionId, OutboundQueue>,
    diagnostics: EphemeralDiagnostics,
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
        }
    }

    pub fn register_collection(&mut self, collection: EphemeralCollection) {
        self.collections.insert(collection.name.clone(), collection);
        self.refresh_counts();
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
            let room = self
                .rooms
                .entry(room_id.clone())
                .or_insert_with(RoomState::new);
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
        self.refresh_counts();

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
        self.refresh_counts();
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
            let room = self
                .rooms
                .entry(room_id.clone())
                .or_insert_with(RoomState::new);
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
        self.refresh_counts();

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
        self.refresh_counts();
    }

    pub fn cleanup_expired(&mut self, now_ms: Millis) {
        let room_ids = self.rooms.keys().cloned().collect::<Vec<_>>();
        for room_id in room_ids {
            self.sweep_room_expired(&room_id, now_ms);
        }
        self.refresh_counts();
    }

    pub fn enqueue_durable(&mut self, connection_id: impl Into<String>, payload: Vec<u8>) {
        let connection_id = connection_id.into();
        self.outbox
            .entry(connection_id)
            .or_insert_with(|| OutboundQueue::new(1_024))
            .push_durable(DurableMessage { payload });
    }

    pub fn drain_outbox(&mut self, connection_id: &str) -> Vec<RealtimeEnvelope> {
        self.outbox
            .get_mut(connection_id)
            .map(OutboundQueue::drain)
            .unwrap_or_default()
    }

    pub fn diagnostics(&mut self) -> EphemeralDiagnostics {
        self.refresh_counts();
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

    fn refresh_counts(&mut self) {
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
