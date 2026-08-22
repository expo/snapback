use crate::storage::AuthorizationVersion;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

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
pub struct ConnectionEffectFence {
    pub authorization_stream_incarnation: Arc<str>,
    pub connection_grant_id: Arc<str>,
    pub authority: ConnectionEffectAuthority,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ConnectionEffectAuthority {
    Anonymous,
    Session {
        session_id: Arc<str>,
        generation: u64,
    },
    ServicePrincipal {
        token_id: Arc<str>,
    },
}

impl ConnectionEffectFence {
    pub fn anonymous(
        authorization_stream_incarnation: impl Into<Arc<str>>,
        connection_grant_id: impl Into<Arc<str>>,
    ) -> Self {
        Self {
            authorization_stream_incarnation: authorization_stream_incarnation.into(),
            connection_grant_id: connection_grant_id.into(),
            authority: ConnectionEffectAuthority::Anonymous,
        }
    }

    pub fn session(
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

    pub fn service_principal(
        authorization_stream_incarnation: impl Into<Arc<str>>,
        connection_grant_id: impl Into<Arc<str>>,
        token_id: impl Into<Arc<str>>,
    ) -> Self {
        Self {
            authorization_stream_incarnation: authorization_stream_incarnation.into(),
            connection_grant_id: connection_grant_id.into(),
            authority: ConnectionEffectAuthority::ServicePrincipal {
                token_id: token_id.into(),
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
pub struct Scope(pub BTreeMap<String, String>);

impl Scope {
    pub fn get(&self, field: &str) -> Option<&str> {
        self.0.get(field).map(String::as_str)
    }
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

    pub fn routed_key(&self, routing_fields: &[String]) -> Option<String> {
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

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct AuthContext {
    pub principal: Option<String>,
    pub session_id: Option<String>,
    pub user_id: Option<String>,
    pub permissions: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_initiator: Option<crate::stream_attempt::StreamInitiator>,
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
    RequireStreamInitiator,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize, schemars::JsonSchema)]
pub struct EphemeralCollection {
    pub name: String,
    #[serde(default, rename = "scopeFields", alias = "scope_fields")]
    pub scope_fields: Vec<String>,
    /// Frozen generated scope/value contracts retained for prepared clients.
    /// The server's existing request validators remain authoritative.
    ///
    /// @ref LLP 0107#public-api — prepared React bindings admit the complete
    /// generated/deployed collection schema rather than reconstructing it.
    #[serde(default, rename = "scopeContract", alias = "scope_contract")]
    pub scope_contract: serde_json::Value,
    #[serde(default, rename = "valueContract", alias = "value_contract")]
    pub value_contract: serde_json::Value,
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
            scope_contract: serde_json::json!({"kind": "unknown"}),
            value_contract: serde_json::json!({"kind": "unknown"}),
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

    pub fn grant_projected_room_permission(
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
    /// Optional role axis for membership-backed room authority. Omission on a
    /// membership table canonicalizes to its declared role axis; only legacy
    /// non-membership permission-backing tables remain role-blind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_field: Option<String>,
    /// Closed active-role subset admitted by `role_field`. This is paired with
    /// `role_field`; activation rejects either field in isolation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_roles: Option<Vec<String>>,
}

fn default_max_pending_ephemeral_keys() -> usize {
    1_024
}

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
    #[serde(default)]
    pub expected_scope_epoch: Option<u64>,
    #[serde(default)]
    pub expected_entry_generation: Option<u64>,
    pub auth: AuthContext,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SubscribeRequest {
    pub collection: String,
    pub scope: Scope,
    pub connection_id: ConnectionId,
    pub auth: AuthContext,
    #[serde(default, rename = "sinceChunk", alias = "since_chunk")]
    pub since_chunk: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StreamResumeInfo {
    pub truncated: bool,
    pub next_chunk: u64,
    pub transcript_path: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum EphemeralErrorCode {
    UnknownCollection,
    RoomNotFound,
    EntryNotFound,
    StaleScopeEpoch,
    StaleEntryGeneration,
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
    /// A client-visible room, entry, or delivery identity reached the final
    /// exact plain-JSON integer. Reuse would create an ABA, so the operation
    /// is refused without mutating predecessor state.
    GenerationExhausted,
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
            Self::RoomNotFound => "SNAPBACK_EPHEMERAL_ROOM_NOT_FOUND",
            Self::EntryNotFound => "SNAPBACK_EPHEMERAL_ENTRY_NOT_FOUND",
            Self::StaleScopeEpoch => "SNAPBACK_EPHEMERAL_STALE_SCOPE_EPOCH",
            Self::StaleEntryGeneration => "SNAPBACK_EPHEMERAL_STALE_ENTRY_GENERATION",
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
            Self::GenerationExhausted => "SNAPBACK_EPHEMERAL_GENERATION_EXHAUSTED",
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
    /// The migration-fence refusal for the ephemeral-publish lane
    /// (LLP 0081 §4): mapped onto the lane's authority-pending class — the
    /// durable authority is deliberately unavailable until the barrier
    /// clears.
    pub fn migration_fenced(message: impl Into<String>) -> Self {
        Self::new(EphemeralErrorCode::AuthorityPending, message)
    }

    pub fn new(code: EphemeralErrorCode, message: impl Into<String>) -> Self {
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
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub scope_epoch: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ephemeral_authority_instance: Option<String>,
        room: RoomId,
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        scope_epoch: u64,
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        room_authority_generation: u64,
        /// Authoritative room cursor at the instant the snapshot and
        /// subscriber registration became one operation. This remains valid
        /// even when `entries` is empty or the newest event was a delete.
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        high_water_version: u64,
        entries: Vec<EphemeralEntry>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stream_resume: Option<StreamResumeInfo>,
    },
    Upsert {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ephemeral_authority_instance: Option<String>,
        room: RoomId,
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        room_authority_generation: u64,
        entry: EphemeralEntry,
    },
    Remove {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ephemeral_authority_instance: Option<String>,
        room: RoomId,
        key: EntryKey,
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        scope_epoch: u64,
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        room_authority_generation: u64,
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        entry_version: u64,
        reason: RemoveReason,
    },
    ResyncRequired {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ephemeral_authority_instance: Option<String>,
        room: RoomId,
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        scope_epoch: u64,
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        room_authority_generation: u64,
        reason: ResyncReason,
    },
    Error {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ephemeral_authority_instance: Option<String>,
        room: Option<RoomId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
        room_authority_generation: Option<u64>,
        error: EphemeralError,
    },
}

impl EphemeralMessage {
    /// Install the connection-negotiated authority witness immediately before
    /// serialization. Queues remain authority-neutral so a stale process
    /// witness cannot be retained across a connection replacement.
    pub fn install_ephemeral_authority_instance(&mut self, instance: Option<&str>) {
        let slot = match self {
            Self::Snapshot {
                ephemeral_authority_instance,
                ..
            }
            | Self::Upsert {
                ephemeral_authority_instance,
                ..
            }
            | Self::Remove {
                ephemeral_authority_instance,
                ..
            }
            | Self::ResyncRequired {
                ephemeral_authority_instance,
                ..
            }
            | Self::Error {
                ephemeral_authority_instance,
                ..
            } => ephemeral_authority_instance,
        };
        *slot = instance.map(str::to_owned);
    }

    pub fn coalesce_key(&self) -> Option<(RoomId, EntryKey)> {
        match self {
            Self::Upsert { room, entry, .. } => Some((room.clone(), entry.key.clone())),
            Self::Remove { room, key, .. } => Some((room.clone(), key.clone())),
            _ => None,
        }
    }

    pub fn scope_epoch(&self) -> Option<u64> {
        match self {
            Self::Snapshot { scope_epoch, .. }
            | Self::Remove { scope_epoch, .. }
            | Self::ResyncRequired { scope_epoch, .. } => Some(*scope_epoch),
            Self::Upsert { entry, .. } => Some(entry.scope_epoch),
            Self::Error { .. } => None,
        }
    }

    pub fn entry_version(&self) -> Option<u64> {
        match self {
            Self::Upsert { entry, .. } => Some(entry.entry_version),
            Self::Remove { entry_version, .. } => Some(*entry_version),
            Self::Snapshot {
                high_water_version, ..
            } => Some(*high_water_version),
            Self::ResyncRequired { .. } | Self::Error { .. } => None,
        }
    }

    pub fn room_authority(&self) -> Option<(&RoomId, u64)> {
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

    pub fn is_authority_independent_epoch_boundary(&self) -> bool {
        matches!(
            self,
            Self::ResyncRequired {
                room_authority_generation: 0,
                reason: ResyncReason::EpochChanged,
                ..
            }
        )
    }

    pub fn resync_room_epoch(&self) -> Option<(RoomId, u64)> {
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
    /// Immutable non-wire profile snapshot for this live frame. The separate
    /// release field may also be populated on a subsequent normal item when
    /// FIFO clamps it behind a delayed predecessor.
    ///
    /// @ref LLP 0167#honesty-requirements — delay and any future wire marker
    ///   must read the same admission snapshot.
    #[serde(skip)]
    #[schemars(skip)]
    network_egress: Option<crate::network_profile::PreparedNetworkEgress>,
    #[serde(skip)]
    #[schemars(skip)]
    release_at: Option<std::time::Instant>,
}

impl DurableMessage {
    pub fn new(payload: Vec<u8>) -> Self {
        Self {
            payload,
            authorization: None,
            effect_fence: None,
            network_egress: None,
            release_at: None,
        }
    }

    pub fn authorized(payload: Vec<u8>, authorization: AuthorizationVersion) -> Self {
        Self {
            payload,
            authorization: Some(authorization),
            effect_fence: None,
            network_egress: None,
            release_at: None,
        }
    }

    pub fn bound(payload: Vec<u8>, effect_fence: ConnectionEffectFence) -> Self {
        Self {
            payload,
            authorization: None,
            effect_fence: Some(effect_fence),
            network_egress: None,
            release_at: None,
        }
    }

    pub fn authorized_bound(
        payload: Vec<u8>,
        authorization: AuthorizationVersion,
        effect_fence: ConnectionEffectFence,
    ) -> Self {
        Self {
            payload,
            authorization: Some(authorization),
            effect_fence: Some(effect_fence),
            network_egress: None,
            release_at: None,
        }
    }

    pub fn authorization(&self) -> Option<&AuthorizationVersion> {
        self.authorization.as_ref()
    }

    pub fn effect_fence(&self) -> Option<&ConnectionEffectFence> {
        self.effect_fence.as_ref()
    }

    pub fn with_network_egress(
        mut self,
        network_egress: crate::network_profile::PreparedNetworkEgress,
    ) -> Self {
        self.release_at = Some(network_egress.release_at());
        self.network_egress = Some(network_egress);
        self
    }

    pub fn release_at(&self) -> Option<std::time::Instant> {
        self.release_at
    }

    pub fn clamp_release_at(&mut self, predecessor: Option<std::time::Instant>) {
        if let Some(network_egress) = &mut self.network_egress {
            network_egress.clamp_release_at(predecessor);
            self.release_at = Some(network_egress.release_at());
        } else if let Some(predecessor) = predecessor {
            self.release_at = Some(
                self.release_at
                    .map_or(predecessor, |own| own.max(predecessor)),
            );
        }
    }

    pub fn is_network_ready(&self, now: std::time::Instant) -> bool {
        self.release_at.is_none_or(|deadline| deadline <= now)
    }

    /// Produce the socket-lane bytes at the final serialization cut. The
    /// marker is derived only from this message's admission snapshot; a
    /// concurrent active-profile change cannot rewrite an in-flight frame.
    /// Normal and compatibility payloads take the byte-preserving fast path.
    ///
    /// @ref LLP 0167#honesty-requirements — delayed socket frames identify
    ///   the exact profile snapshot that supplied their deadline.
    pub fn into_live_socket_payload(mut self) -> Vec<u8> {
        self.install_live_wire_network_profile_marker();
        self.payload
    }

    /// Install the LLP 0093 marker into a durable transport handoff. This
    /// mutates only the selected copy, never the queued frame, and reads only
    /// the immutable admission snapshot retained beside that copy. A normal
    /// or compatibility frame remains byte-identical.
    ///
    /// @ref LLP 0167#honesty-requirements — poll/socket delay and marker must
    ///   describe the same per-frame admission snapshot.
    pub fn install_live_wire_network_profile_marker(&mut self) {
        let Some(network_egress) = &self.network_egress else {
            return;
        };
        let Ok(envelope) = serde_json::from_slice::<crate::live_wire::LiveEnvelope>(&self.payload)
        else {
            return;
        };
        if let Ok(payload) = serde_json::to_vec(
            &envelope.with_network_profile(network_egress.profile_name().to_owned()),
        ) {
            self.payload = payload;
        }
    }
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
    pub fn into_poll_lane_frame(mut self) -> Self {
        if let Self::Durable(message) = &mut self {
            message.install_live_wire_network_profile_marker();
        }
        self
    }

    pub fn lane(&self) -> RealtimeLane {
        match self {
            Self::Durable(_) => RealtimeLane::Durable,
            Self::Ephemeral(_) => RealtimeLane::EphemeralLatest,
        }
    }
}
