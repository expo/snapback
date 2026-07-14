//! Detached authorization-stream projection and leaf-fence model.
//!
//! This module deliberately has no server or provider call-site wiring. A
//! caller first obtains one storage snapshot, builds and validates the whole
//! projection here, and only then publishes it behind the item-5 coordinator.
//!
//! @ref LLP 0056#server-authority-model — the process projection contains
//! only durable identifiers, token digests, deadlines, and shared fences.
//! @ref LLP 0056#two-phase-mutation-protocol — unique tickets, rather than a
//! saved session snapshot, own every reversible pre-commit marker.

use crate::auth::crypto::TokenHash;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fmt;
use std::num::NonZeroU64;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use uuid::Uuid;

pub(crate) const AUTHORIZATION_STREAM_FORMAT_VERSION: u32 = 1;
pub(crate) const SESSION_PROJECTION_FORMAT_VERSION: u32 = 1;
pub(crate) const AUTHORIZATION_STREAM_META_KEY: &str = "auth_stream_incarnation_v1";
const MAX_SAFE_TIMESTAMP: u64 = 9_007_199_254_740_991;
const MAX_SAFE_GENERATION: u64 = 9_007_199_254_740_991;
pub(crate) const TERMINAL_CLOSE_GRACE: Duration = Duration::from_millis(5_000);

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct AuthorizationStreamIncarnation(String);

impl AuthorizationStreamIncarnation {
    pub(crate) fn fresh() -> Self {
        Self(Uuid::now_v7().to_string())
    }

    pub(crate) fn parse(value: &str) -> SnapbackResult<Self> {
        validate_canonical_uuid_v7(value).map_err(|_| {
            stream_corrupt("authorization-stream incarnation is not a canonical UUIDv7")
        })?;
        Ok(Self(value.to_owned()))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AuthorizationStreamRecord {
    format_version: u32,
    incarnation: String,
}

impl AuthorizationStreamRecord {
    pub(crate) fn new(incarnation: AuthorizationStreamIncarnation) -> Self {
        Self {
            format_version: AUTHORIZATION_STREAM_FORMAT_VERSION,
            incarnation: incarnation.0,
        }
    }

    /// Parse the closed record and require byte-for-byte canonical encoding.
    /// This rejects whitespace, reordered fields, duplicate fields, unknown
    /// fields, non-UTF-8 input, and non-canonical UUID spellings alike.
    pub(crate) fn parse_exact(bytes: &[u8]) -> SnapbackResult<Self> {
        let record: Self = serde_json::from_slice(bytes).map_err(|_| {
            stream_corrupt("authorization-stream metadata is not a closed format-1 record")
        })?;
        record.validate()?;
        let canonical = record.encode_bytes()?;
        if canonical != bytes {
            return Err(stream_corrupt(
                "authorization-stream metadata is not canonically encoded",
            ));
        }
        Ok(record)
    }

    pub(crate) fn encode_bytes(&self) -> SnapbackResult<Vec<u8>> {
        self.validate()?;
        serde_json::to_vec(self)
            .map_err(|_| stream_corrupt("authorization-stream metadata could not be encoded"))
    }

    pub(crate) fn encode_string(&self) -> SnapbackResult<String> {
        String::from_utf8(self.encode_bytes()?)
            .map_err(|_| stream_corrupt("authorization-stream metadata could not be encoded"))
    }

    pub(crate) fn incarnation(&self) -> AuthorizationStreamIncarnation {
        AuthorizationStreamIncarnation(self.incarnation.clone())
    }

    fn validate(&self) -> SnapbackResult<()> {
        if self.format_version != AUTHORIZATION_STREAM_FORMAT_VERSION {
            return Err(stream_corrupt(
                "authorization-stream metadata has an unsupported format",
            ));
        }
        AuthorizationStreamIncarnation::parse(&self.incarnation)?;
        Ok(())
    }
}

/// Raw rows copied from one SQLite read transaction. Numeric fields remain
/// signed and digests remain variable-length until detached validation so a
/// malformed database cannot be normalized accidentally while reading it.
#[derive(Clone, Eq, PartialEq)]
pub(crate) struct ProjectionSource {
    pub authorization_stream_value: Vec<u8>,
    pub restore_declaration_id: Option<Vec<u8>>,
    pub users: Vec<ProjectionUserRow>,
    pub identities: Vec<ProjectionIdentityRow>,
    pub sessions: Vec<ProjectionSessionRow>,
    pub superseded_tokens: Vec<ProjectionTokenRow>,
}

impl fmt::Debug for ProjectionSource {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProjectionSource([REDACTED])")
    }
}

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct ProjectionUserRow {
    pub id: String,
    pub created_at_ms: i64,
}

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct ProjectionIdentityRow {
    pub id: String,
    pub user_id: String,
    pub provider: String,
    pub verified_at_ms: i64,
}

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct ProjectionSessionRow {
    pub id: String,
    pub user_id: String,
    pub identity_id: String,
    pub authority_instance_id: String,
    pub token_hash: Vec<u8>,
    pub generation: i64,
    pub created_at_ms: i64,
    pub last_used_at_ms: i64,
    pub expires_at_ms: i64,
    pub absolute_expires_at_ms: i64,
    pub revoked_at_ms: Option<i64>,
}

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct ProjectionTokenRow {
    pub token_hash: Vec<u8>,
    pub session_id: String,
    pub superseded_at_ms: i64,
}

#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct TokenDigest([u8; 32]);

impl TokenDigest {
    pub(crate) fn from_slice(bytes: &[u8]) -> SnapbackResult<Self> {
        let digest: [u8; 32] = bytes.try_into().map_err(|_| {
            projection_corrupt("a projected token digest does not contain exactly 32 bytes")
        })?;
        Ok(Self(digest))
    }

    pub(crate) fn from_token_hash(token_hash: &TokenHash) -> Self {
        Self(*token_hash.as_bytes())
    }

    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Debug for TokenDigest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TokenDigest([REDACTED])")
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct MutationTicket {
    startup_id: String,
    sequence: NonZeroU64,
}

impl fmt::Display for MutationTicket {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}:{}", self.startup_id, self.sequence)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct DeadlinePair {
    pub monotonic_deadline: Instant,
    pub epoch_deadline_ms: u64,
}

impl DeadlinePair {
    pub(crate) fn derive(
        epoch_deadline_ms: u64,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Self> {
        validate_timestamp_u64(epoch_deadline_ms)?;
        validate_timestamp_u64(epoch_now_ms)?;
        let remaining_ms = epoch_deadline_ms.saturating_sub(epoch_now_ms);
        let monotonic_deadline = monotonic_now
            .checked_add(Duration::from_millis(remaining_ms))
            .ok_or_else(|| projection_corrupt("a projected monotonic deadline overflowed"))?;
        Ok(Self {
            monotonic_deadline,
            epoch_deadline_ms,
        })
    }

    fn live_at(&self, epoch_now_ms: u64, monotonic_now: Instant) -> bool {
        epoch_now_ms < self.epoch_deadline_ms && monotonic_now < self.monotonic_deadline
    }
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct DeadlineKey {
    monotonic_deadline: Instant,
    epoch_deadline_ms: u64,
    session_id: String,
    generation: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RevocationReason {
    DurableRevocation,
    Logout,
    CapEviction,
    FamilyAlarm,
    RefreshReuse,
    Reset,
    Restore,
    Expired,
    Uncertain,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProjectedSessionState {
    Current,
    Revoked { reason: RevocationReason },
    Expired,
    Uncertain,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PendingMutationKind {
    Revoke {
        reason: RevocationReason,
    },
    TokenSupersede {
        predecessor: TokenDigest,
        successor: TokenDigest,
        superseded_at_ms: u64,
    },
    Expire {
        deadline: DeadlinePair,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PendingMutation {
    expected_generation: u64,
    kind: PendingMutationKind,
}

#[derive(Debug)]
struct ProjectedSession {
    session_id: String,
    user_id: String,
    provider: String,
    authority_instance_id: String,
    generation: u64,
    expires_at_ms: u64,
    absolute_expires_at_ms: u64,
    deadline: DeadlinePair,
    state: ProjectedSessionState,
    current_token: Option<TokenDigest>,
    pending: BTreeMap<MutationTicket, PendingMutation>,
    fence: Arc<SessionFence>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProjectedSessionAuthority {
    pub session_id: String,
    pub user_id: String,
    pub provider: String,
    pub generation: u64,
    pub authority_instance_id: String,
    pub expires_at_ms: u64,
    pub absolute_expires_at_ms: u64,
}

/// Exact immutable identity copied from one stored session grant for
/// projection revalidation.
///
/// @ref LLP 0056#grant-shape — every grant identity field participates in the
/// revalidation comparison; the mutable deadline is deliberately excluded.
pub(crate) struct BoundConnectionSessionIdentity<'a> {
    expected_incarnation: &'a AuthorizationStreamIncarnation,
    session_id: &'a str,
    user_id: &'a str,
    provider: &'a str,
    generation: u64,
}

impl<'a> BoundConnectionSessionIdentity<'a> {
    pub(crate) fn new(
        expected_incarnation: &'a AuthorizationStreamIncarnation,
        session_id: &'a str,
        user_id: &'a str,
        provider: &'a str,
        generation: u64,
    ) -> Self {
        Self {
            expected_incarnation,
            session_id,
            user_id,
            provider,
            generation,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ExpiredSession {
    pub authorization_stream_incarnation: String,
    pub session_id: String,
    pub generation: u64,
    /// Absolute monotonic close deadline. For an ordinary expiry this is the
    /// projected deadline plus five seconds; when a forward wall-clock jump
    /// newly proves expiry, observation time starts that same fixed budget.
    pub close_by: Instant,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProjectedSessionInsert {
    pub session_id: String,
    pub user_id: String,
    pub provider: String,
    pub authority_instance_id: String,
    pub generation: u64,
    pub token_digest: TokenDigest,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
    pub absolute_expires_at_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ProjectedTokenResolution {
    Current(ProjectedSessionAuthority),
    Superseded {
        authority: ProjectedSessionAuthority,
        superseded_at_ms: u64,
    },
    Terminal,
    Unavailable,
    Unknown,
}

/// Connection-open classification keeps an attributable session key even
/// while its leaf is blocked. The key is used only for the per-session local
/// throttle; a blocked or terminal leaf never produces grant authority.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ProjectedConnectionTokenResolution {
    Current(ProjectedSessionAuthority),
    Superseded(ProjectedSessionAuthority),
    Unavailable { session_id: String, generation: u64 },
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum ProjectedToken {
    Current {
        session_id: String,
    },
    Superseded {
        session_id: String,
        superseded_at_ms: u64,
    },
    Terminal {
        session_id: String,
    },
    Unavailable {
        session_id: String,
    },
}

#[derive(Debug)]
pub(crate) struct SessionFence {
    state: Mutex<SessionFenceState>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SessionFenceState {
    generation: u64,
    deadline: DeadlinePair,
    terminal: Option<RevocationReason>,
    pending_tickets: BTreeSet<MutationTicket>,
}

impl SessionFence {
    fn new(generation: u64, deadline: DeadlinePair, terminal: Option<RevocationReason>) -> Self {
        Self {
            state: Mutex::new(SessionFenceState {
                generation,
                deadline,
                terminal,
                pending_tickets: BTreeSet::new(),
            }),
        }
    }

    fn lock(&self) -> SnapbackResult<MutexGuard<'_, SessionFenceState>> {
        self.state
            .lock()
            .map_err(|_| projection_unavailable("a session fence is poisoned"))
    }

    fn admits_locked(
        state: &SessionFenceState,
        expected_generation: u64,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> bool {
        state.generation == expected_generation
            && state.terminal.is_none()
            && state.pending_tickets.is_empty()
            && state.deadline.live_at(epoch_now_ms, monotonic_now)
    }
}

#[derive(Debug)]
pub(crate) struct StreamFence {
    state: Mutex<StreamFenceState>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct StreamFenceState {
    incarnation: AuthorizationStreamIncarnation,
    pending_tickets: BTreeSet<MutationTicket>,
}

impl StreamFence {
    fn new(incarnation: AuthorizationStreamIncarnation) -> Self {
        Self {
            state: Mutex::new(StreamFenceState {
                incarnation,
                pending_tickets: BTreeSet::new(),
            }),
        }
    }

    fn lock(&self) -> SnapbackResult<MutexGuard<'_, StreamFenceState>> {
        self.state
            .lock()
            .map_err(|_| projection_unavailable("the authorization-stream fence is poisoned"))
    }

    fn admits_locked(
        state: &StreamFenceState,
        expected_incarnation: &AuthorizationStreamIncarnation,
    ) -> bool {
        &state.incarnation == expected_incarnation && state.pending_tickets.is_empty()
    }
}

/// Cloneable, bearer-free handles for the final synchronous publication cut.
/// Validation and `publish` happen while stream then session guards remain
/// held. The closure must only perform a bounded nonblocking in-memory handoff;
/// it must never enter SQLite/provider state, await, or perform socket I/O.
#[derive(Clone, Debug)]
pub(crate) struct FencedPublication {
    expected_incarnation: AuthorizationStreamIncarnation,
    stream: Arc<StreamFence>,
    session: Option<SessionPublicationFence>,
}

#[derive(Clone, Debug)]
struct SessionPublicationFence {
    expected_generation: u64,
    session: Arc<SessionFence>,
}

impl FencedPublication {
    pub(crate) fn authorization_stream_incarnation(&self) -> &str {
        self.expected_incarnation.as_str()
    }

    /// Consume one prepared buffer into its synchronous handoff only if the
    /// exact authority is still live at the linearization cut.
    ///
    /// @ref LLP 0056#act-time-validation — stream/session validation and the
    /// leaf publication are one guarded operation, never check-then-act.
    pub(crate) fn try_publish<T>(
        &self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
        publish: impl FnOnce() -> SnapbackResult<T>,
    ) -> SnapbackResult<Option<T>> {
        validate_timestamp_u64(epoch_now_ms)?;
        let stream = self.stream.lock()?;
        if !StreamFence::admits_locked(&stream, &self.expected_incarnation) {
            return Ok(None);
        }
        let Some(session) = &self.session else {
            return publish().map(Some);
        };
        let session_state = session.session.lock()?;
        if !SessionFence::admits_locked(
            &session_state,
            session.expected_generation,
            epoch_now_ms,
            monotonic_now,
        ) {
            return Ok(None);
        }
        publish().map(Some)
    }

    pub(crate) fn anonymous_for_unmanaged_dev_connection() -> (String, Self) {
        static TEST_STREAM: std::sync::OnceLock<(
            AuthorizationStreamIncarnation,
            Arc<StreamFence>,
        )> = std::sync::OnceLock::new();
        let (incarnation, stream) = TEST_STREAM.get_or_init(|| {
            let incarnation = AuthorizationStreamIncarnation::fresh();
            let stream = Arc::new(StreamFence::new(incarnation.clone()));
            (incarnation, stream)
        });
        (
            incarnation.as_str().to_owned(),
            Self {
                expected_incarnation: incarnation.clone(),
                stream: Arc::clone(stream),
                session: None,
            },
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum TicketOwner {
    Session(String),
    Issuance(String),
    Stream,
}

/// The detached topology object. Integration wraps this in the coordinator's
/// topology mutex; session and stream fence arcs are then cloned into grants.
#[derive(Debug)]
pub(crate) struct SessionProjection {
    format_version: u32,
    incarnation: AuthorizationStreamIncarnation,
    projection_startup_id: String,
    by_session: HashMap<String, ProjectedSession>,
    token_index: HashMap<TokenDigest, ProjectedToken>,
    deadline_index: BTreeSet<DeadlineKey>,
    ticket_index: HashMap<MutationTicket, TicketOwner>,
    pending_issuances: BTreeMap<MutationTicket, ProjectedSessionInsert>,
    stream_pending: BTreeMap<MutationTicket, AuthorizationStreamIncarnation>,
    next_ticket: Option<NonZeroU64>,
    stream_fence: Arc<StreamFence>,
}

impl SessionProjection {
    /// Build from a complete detached source. Nothing externally reachable is
    /// mutated if any validation fails.
    pub(crate) fn rebuild(
        source: ProjectionSource,
        projection_startup_id: &str,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Self> {
        validate_canonical_uuid_v7(projection_startup_id)
            .map_err(|_| projection_corrupt("projection startup id is not a canonical UUIDv7"))?;
        validate_timestamp_u64(epoch_now_ms)?;
        let incarnation =
            AuthorizationStreamRecord::parse_exact(&source.authorization_stream_value)?
                .incarnation();
        if let Some(raw_declaration) = source.restore_declaration_id.as_deref() {
            let declaration = std::str::from_utf8(raw_declaration)
                .map_err(|_| projection_corrupt("restore declaration metadata is not UTF-8"))?;
            validate_canonical_uuid_v7(declaration).map_err(|_| {
                projection_corrupt("restore declaration metadata is not a canonical UUIDv7")
            })?;
        }

        let mut users = HashMap::new();
        for row in source.users {
            validate_projection_id(&row.id, "user")?;
            validate_timestamp_i64(row.created_at_ms, "user creation")?;
            if users.insert(row.id, row.created_at_ms).is_some() {
                return Err(projection_corrupt("duplicate projected user id"));
            }
        }

        let mut identities = HashMap::new();
        for row in source.identities {
            validate_projection_id(&row.id, "identity")?;
            validate_projection_id(&row.user_id, "identity user")?;
            validate_timestamp_i64(row.verified_at_ms, "identity verification")?;
            if row.provider.is_empty() || !users.contains_key(&row.user_id) {
                return Err(projection_corrupt(
                    "a projected identity has an invalid provider or dangling user",
                ));
            }
            if identities
                .insert(row.id, (row.user_id, row.provider))
                .is_some()
            {
                return Err(projection_corrupt("duplicate projected identity id"));
            }
        }

        let mut by_session = HashMap::new();
        let mut token_index = HashMap::new();
        let mut deadline_index = BTreeSet::new();
        let mut all_digests = HashSet::new();
        let mut authority_instance_ids = HashSet::new();
        for row in source.sessions {
            validate_projection_id(&row.id, "session")?;
            validate_projection_id(&row.user_id, "session user")?;
            validate_projection_id(&row.identity_id, "session identity")?;
            validate_projection_id(&row.authority_instance_id, "authority instance")?;
            if !authority_instance_ids.insert(row.authority_instance_id.clone()) {
                return Err(projection_corrupt(
                    "duplicate projected authority-instance id",
                ));
            }
            let generation = u64::try_from(row.generation)
                .ok()
                .filter(|generation| *generation != 0 && *generation <= MAX_SAFE_GENERATION)
                .ok_or_else(|| projection_corrupt("a projected session generation is invalid"))?;
            let created_at_ms = validate_timestamp_i64(row.created_at_ms, "session creation")?;
            let last_used_at_ms = validate_timestamp_i64(row.last_used_at_ms, "session last use")?;
            let expires_at_ms = validate_timestamp_i64(row.expires_at_ms, "session expiry")?;
            let absolute_expires_at_ms =
                validate_timestamp_i64(row.absolute_expires_at_ms, "session absolute expiry")?;
            let revoked_at_ms = row
                .revoked_at_ms
                .map(|value| validate_timestamp_i64(value, "session revocation"))
                .transpose()?;
            if created_at_ms > last_used_at_ms
                || last_used_at_ms > expires_at_ms
                || expires_at_ms > absolute_expires_at_ms
                || revoked_at_ms.is_some_and(|revoked| revoked < created_at_ms)
            {
                return Err(projection_corrupt(
                    "a projected session has contradictory timestamps",
                ));
            }
            let Some((identity_user_id, provider)) = identities.get(&row.identity_id) else {
                return Err(projection_corrupt(
                    "a projected session has a dangling identity",
                ));
            };
            if identity_user_id != &row.user_id || !users.contains_key(&row.user_id) {
                return Err(projection_corrupt(
                    "a projected session identity does not bind its user",
                ));
            }
            let digest = TokenDigest::from_slice(&row.token_hash)?;
            if !all_digests.insert(digest) {
                return Err(projection_corrupt(
                    "duplicate projected current-token digest",
                ));
            }
            let deadline = DeadlinePair::derive(expires_at_ms, epoch_now_ms, monotonic_now)?;
            let (state, terminal) = if revoked_at_ms.is_some() {
                (
                    ProjectedSessionState::Revoked {
                        reason: RevocationReason::DurableRevocation,
                    },
                    Some(RevocationReason::DurableRevocation),
                )
            } else if expires_at_ms <= epoch_now_ms {
                (
                    ProjectedSessionState::Expired,
                    Some(RevocationReason::Expired),
                )
            } else {
                (ProjectedSessionState::Current, None)
            };
            let current_token = if state == ProjectedSessionState::Current {
                if token_index
                    .insert(
                        digest,
                        ProjectedToken::Current {
                            session_id: row.id.clone(),
                        },
                    )
                    .is_some()
                {
                    return Err(projection_corrupt(
                        "duplicate projected current-token digest",
                    ));
                }
                let inserted = deadline_index.insert(DeadlineKey {
                    monotonic_deadline: deadline.monotonic_deadline,
                    epoch_deadline_ms: deadline.epoch_deadline_ms,
                    session_id: row.id.clone(),
                    generation,
                });
                if !inserted {
                    return Err(projection_corrupt("duplicate projected deadline entry"));
                }
                Some(digest)
            } else {
                if token_index
                    .insert(
                        digest,
                        ProjectedToken::Terminal {
                            session_id: row.id.clone(),
                        },
                    )
                    .is_some()
                {
                    return Err(projection_corrupt(
                        "duplicate projected terminal-token digest",
                    ));
                }
                None
            };
            let session_id = row.id;
            let projected = ProjectedSession {
                session_id: session_id.clone(),
                user_id: row.user_id,
                provider: provider.clone(),
                authority_instance_id: row.authority_instance_id,
                generation,
                expires_at_ms,
                absolute_expires_at_ms,
                deadline,
                state,
                current_token,
                pending: BTreeMap::new(),
                fence: Arc::new(SessionFence::new(generation, deadline, terminal)),
            };
            if by_session.insert(session_id, projected).is_some() {
                return Err(projection_corrupt("duplicate projected session id"));
            }
        }

        for row in source.superseded_tokens {
            validate_projection_id(&row.session_id, "superseded-token session")?;
            if !by_session.contains_key(&row.session_id) {
                return Err(projection_corrupt(
                    "a projected superseded token has a dangling session",
                ));
            }
            let superseded_at_ms =
                validate_timestamp_i64(row.superseded_at_ms, "token supersession")?;
            let digest = TokenDigest::from_slice(&row.token_hash)?;
            let token = match by_session.get(&row.session_id) {
                Some(session) if session.state == ProjectedSessionState::Current => {
                    ProjectedToken::Superseded {
                        session_id: row.session_id,
                        superseded_at_ms,
                    }
                }
                Some(_) => ProjectedToken::Terminal {
                    session_id: row.session_id,
                },
                None => unreachable!("checked projected superseded-token owner"),
            };
            if !all_digests.insert(digest) || token_index.insert(digest, token).is_some() {
                return Err(projection_corrupt("duplicate projected token digest"));
            }
        }

        let projection = Self {
            format_version: SESSION_PROJECTION_FORMAT_VERSION,
            incarnation: incarnation.clone(),
            projection_startup_id: projection_startup_id.to_owned(),
            by_session,
            token_index,
            deadline_index,
            ticket_index: HashMap::new(),
            pending_issuances: BTreeMap::new(),
            stream_pending: BTreeMap::new(),
            next_ticket: NonZeroU64::new(1),
            stream_fence: Arc::new(StreamFence::new(incarnation)),
        };
        projection.check_invariants()?;
        Ok(projection)
    }

    pub(crate) fn rebuild_with_fresh_startup_id(
        source: ProjectionSource,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Self> {
        Self::rebuild(
            source,
            &Uuid::now_v7().to_string(),
            epoch_now_ms,
            monotonic_now,
        )
    }

    pub(crate) fn incarnation(&self) -> &AuthorizationStreamIncarnation {
        &self.incarnation
    }

    pub(crate) fn stream_fence(&self) -> Arc<StreamFence> {
        Arc::clone(&self.stream_fence)
    }

    pub(crate) fn session_fence(&self, session_id: &str) -> Option<Arc<SessionFence>> {
        self.by_session
            .get(session_id)
            .map(|session| Arc::clone(&session.fence))
    }

    pub(crate) fn session_publication_fence(
        &self,
        session_id: &str,
        expected_generation: u64,
    ) -> SnapbackResult<FencedPublication> {
        let session = self.by_session.get(session_id).ok_or_else(|| {
            projection_unavailable("the publication session is absent from the projection")
        })?;
        if session.generation != expected_generation {
            return Err(projection_unavailable(
                "the publication generation does not match the projection",
            ));
        }
        Ok(FencedPublication {
            expected_incarnation: self.incarnation.clone(),
            stream: Arc::clone(&self.stream_fence),
            session: Some(SessionPublicationFence {
                expected_generation,
                session: Arc::clone(&session.fence),
            }),
        })
    }

    pub(crate) fn anonymous_publication_fence(&self) -> FencedPublication {
        FencedPublication {
            expected_incarnation: self.incarnation.clone(),
            stream: Arc::clone(&self.stream_fence),
            session: None,
        }
    }

    /// Observe both authoritative clocks and terminalize every due exact
    /// `(session, generation, deadline)` entry under one topology ownership
    /// pass. Each entry still receives a unique ticket, so sibling operations
    /// retain their own markers and can reconcile independently.
    pub(crate) fn expire_due(
        &mut self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Vec<ExpiredSession>> {
        validate_timestamp_u64(epoch_now_ms)?;
        let due: Vec<_> = self
            .deadline_index
            .iter()
            .filter(|key| {
                epoch_now_ms >= key.epoch_deadline_ms || monotonic_now >= key.monotonic_deadline
            })
            .map(|key| {
                let wall_jump_observation =
                    epoch_now_ms >= key.epoch_deadline_ms && monotonic_now < key.monotonic_deadline;
                let close_origin = if wall_jump_observation {
                    monotonic_now
                } else {
                    key.monotonic_deadline
                };
                (
                    key.session_id.clone(),
                    key.generation,
                    close_origin.checked_add(TERMINAL_CLOSE_GRACE),
                )
            })
            .collect();
        let mut expired = Vec::with_capacity(due.len());
        for (session_id, generation, close_by) in due {
            let close_by = close_by.ok_or_else(|| {
                projection_unavailable("terminal close deadline overflowed monotonic time")
            })?;
            let ticket = self.begin_expiry(&session_id, generation, epoch_now_ms, monotonic_now)?;
            self.finalize_expiry(&ticket, &session_id, epoch_now_ms, monotonic_now)?;
            expired.push(ExpiredSession {
                authorization_stream_incarnation: self.incarnation.as_str().to_owned(),
                session_id,
                generation,
                close_by,
            });
        }
        Ok(expired)
    }

    /// Expiry scheduling never sleeps more than one second, so a forward wall
    /// jump is observed and permanently terminalized within the protocol bound.
    pub(crate) fn expiry_scan_delay(&self, monotonic_now: Instant) -> Duration {
        let until_first = self
            .deadline_index
            .iter()
            .next()
            .map(|deadline| {
                deadline
                    .monotonic_deadline
                    .saturating_duration_since(monotonic_now)
            })
            .unwrap_or(Duration::from_millis(1_000));
        until_first.min(Duration::from_millis(1_000))
    }

    /// Resolve a bearer digest entirely from the process projection. The
    /// returned authority is bearer-free and retains the internal
    /// `authority_instance_id` needed to construct `ResolvedAppAuthority`;
    /// connection grants intentionally omit that field later.
    pub(crate) fn resolve_token(
        &self,
        digest: &TokenDigest,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<ProjectedTokenResolution> {
        let stream = self.stream_fence.lock()?;
        if !StreamFence::admits_locked(&stream, &self.incarnation) {
            return Ok(ProjectedTokenResolution::Unavailable);
        }
        let (session_id, superseded_at_ms) = match self.token_index.get(digest) {
            Some(ProjectedToken::Current { session_id }) => (session_id, None),
            Some(ProjectedToken::Superseded {
                session_id,
                superseded_at_ms,
            }) => (session_id, Some(*superseded_at_ms)),
            Some(ProjectedToken::Terminal { .. }) => {
                return Ok(ProjectedTokenResolution::Terminal);
            }
            Some(ProjectedToken::Unavailable { .. }) => {
                return Ok(ProjectedTokenResolution::Unavailable);
            }
            None => return Ok(ProjectedTokenResolution::Unknown),
        };
        let Some(session) = self.by_session.get(session_id) else {
            return Err(projection_unavailable(
                "a projected token has a dangling session",
            ));
        };
        let session_fence = session.fence.lock()?;
        if session.state != ProjectedSessionState::Current
            || !session_fence.deadline.live_at(epoch_now_ms, monotonic_now)
            || session_fence.terminal.is_some()
        {
            return Ok(ProjectedTokenResolution::Terminal);
        }
        if !SessionFence::admits_locked(
            &session_fence,
            session.generation,
            epoch_now_ms,
            monotonic_now,
        ) {
            return Ok(ProjectedTokenResolution::Unavailable);
        }
        let authority = ProjectedSessionAuthority {
            session_id: session.session_id.clone(),
            user_id: session.user_id.clone(),
            provider: session.provider.clone(),
            generation: session.generation,
            authority_instance_id: session.authority_instance_id.clone(),
            expires_at_ms: session.expires_at_ms,
            absolute_expires_at_ms: session.absolute_expires_at_ms,
        };
        Ok(match superseded_at_ms {
            Some(superseded_at_ms) => ProjectedTokenResolution::Superseded {
                authority,
                superseded_at_ms,
            },
            None => ProjectedTokenResolution::Current(authority),
        })
    }

    /// Classify a canonical connection-open bearer without consulting the
    /// provider or SQLite. Unlike ordinary finite-request resolution, this
    /// retains only the redacted bucket key for a known but blocked token so
    /// rejected attempts cannot escape the exact session throttle.
    ///
    /// @ref LLP 0056#reuse-and-mismatch — every canonical open is indexed in
    /// the process projection and current, superseded, blocked, and unknown
    /// tokens consume their specified independent buckets.
    pub(crate) fn classify_connection_token(
        &self,
        digest: &TokenDigest,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<ProjectedConnectionTokenResolution> {
        validate_timestamp_u64(epoch_now_ms)?;
        let stream = self.stream_fence.lock()?;
        let (session_id, superseded) = match self.token_index.get(digest) {
            Some(ProjectedToken::Current { session_id }) => (session_id, false),
            Some(ProjectedToken::Superseded { session_id, .. }) => (session_id, true),
            Some(ProjectedToken::Terminal { session_id })
            | Some(ProjectedToken::Unavailable { session_id }) => (session_id, false),
            None => return Ok(ProjectedConnectionTokenResolution::Unknown),
        };
        let Some(session) = self.by_session.get(session_id) else {
            return Err(projection_unavailable(
                "a projected connection token has a dangling session",
            ));
        };
        let session_fence = session.fence.lock()?;
        if !StreamFence::admits_locked(&stream, &self.incarnation)
            || session.state != ProjectedSessionState::Current
            || !SessionFence::admits_locked(
                &session_fence,
                session.generation,
                epoch_now_ms,
                monotonic_now,
            )
        {
            return Ok(ProjectedConnectionTokenResolution::Unavailable {
                session_id: session.session_id.clone(),
                generation: session.generation,
            });
        }
        let authority = ProjectedSessionAuthority {
            session_id: session.session_id.clone(),
            user_id: session.user_id.clone(),
            provider: session.provider.clone(),
            generation: session.generation,
            authority_instance_id: session.authority_instance_id.clone(),
            expires_at_ms: session.expires_at_ms,
            absolute_expires_at_ms: session.absolute_expires_at_ms,
        };
        Ok(if superseded {
            ProjectedConnectionTokenResolution::Superseded(authority)
        } else {
            ProjectedConnectionTokenResolution::Current(authority)
        })
    }

    /// Rehydrate the internal authority-instance field omitted from a stored
    /// connection grant. Every grant identity field is compared before that
    /// internal value is returned, and the same stream/session locks prove
    /// the exact generation is still available at this preparation point.
    pub(crate) fn resolve_bound_connection_session(
        &self,
        identity: BoundConnectionSessionIdentity<'_>,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Option<ProjectedSessionAuthority>> {
        let BoundConnectionSessionIdentity {
            expected_incarnation,
            session_id,
            user_id,
            provider,
            generation,
        } = identity;
        validate_timestamp_u64(epoch_now_ms)?;
        let stream = self.stream_fence.lock()?;
        if !StreamFence::admits_locked(&stream, expected_incarnation)
            || expected_incarnation != &self.incarnation
        {
            return Ok(None);
        }
        let Some(session) = self.by_session.get(session_id) else {
            return Ok(None);
        };
        let session_fence = session.fence.lock()?;
        if session.user_id != user_id
            || session.provider != provider
            || session.generation != generation
            || session.state != ProjectedSessionState::Current
            || !SessionFence::admits_locked(&session_fence, generation, epoch_now_ms, monotonic_now)
        {
            return Ok(None);
        }
        Ok(Some(ProjectedSessionAuthority {
            session_id: session.session_id.clone(),
            user_id: session.user_id.clone(),
            provider: session.provider.clone(),
            generation: session.generation,
            authority_instance_id: session.authority_instance_id.clone(),
            expires_at_ms: session.expires_at_ms,
            absolute_expires_at_ms: session.absolute_expires_at_ms,
        }))
    }

    /// Publish the safe post-act deadline after either a coalesced durable
    /// write or the provider's no-write fast path. The exact stale deadline is
    /// replaced under topology-then-session order; a concurrent terminal or
    /// pending mutation merely loses the extension and cannot revive access.
    pub(crate) fn publish_authenticated_use_deadline(
        &mut self,
        session_id: &str,
        expected_generation: u64,
        epoch_now_ms: u64,
        monotonic_now: Instant,
        sliding_window_ms: u64,
        durable_expires_at_ms: Option<u64>,
    ) -> SnapbackResult<Option<u64>> {
        validate_timestamp_u64(epoch_now_ms)?;
        let (fence, predecessor_key, desired_expires_at_ms) = {
            let Some(session) = self.by_session.get(session_id) else {
                return Ok(None);
            };
            if session.generation != expected_generation
                || session.state != ProjectedSessionState::Current
            {
                return Ok(None);
            }
            let in_memory = epoch_now_ms
                .checked_add(sliding_window_ms)
                .unwrap_or(MAX_SAFE_TIMESTAMP)
                .min(session.absolute_expires_at_ms);
            let desired = durable_expires_at_ms
                .unwrap_or(in_memory)
                .max(in_memory)
                .min(session.absolute_expires_at_ms);
            validate_timestamp_u64(desired)?;
            (
                Arc::clone(&session.fence),
                deadline_key_for(session),
                desired,
            )
        };
        let mut fence_state = fence.lock()?;
        if fence_state.generation != expected_generation
            || fence_state.terminal.is_some()
            || !fence_state.pending_tickets.is_empty()
        {
            return Ok(None);
        }
        let session = self.by_session.get(session_id).expect("checked above");
        if desired_expires_at_ms <= session.expires_at_ms {
            return Ok(Some(session.expires_at_ms));
        }
        if !self.deadline_index.contains(&predecessor_key) {
            return Err(projection_unavailable(
                "authenticated-use deadline predecessor is missing",
            ));
        }
        let deadline = DeadlinePair::derive(desired_expires_at_ms, epoch_now_ms, monotonic_now)?;
        self.deadline_index.remove(&predecessor_key);
        let inserted = self.deadline_index.insert(DeadlineKey {
            monotonic_deadline: deadline.monotonic_deadline,
            epoch_deadline_ms: deadline.epoch_deadline_ms,
            session_id: session_id.to_owned(),
            generation: expected_generation,
        });
        if !inserted {
            return Err(projection_unavailable(
                "authenticated-use deadline replacement collided",
            ));
        }
        let session = self.by_session.get_mut(session_id).expect("checked above");
        session.expires_at_ms = desired_expires_at_ms;
        session.deadline = deadline;
        fence_state.deadline = deadline;
        Ok(Some(desired_expires_at_ms))
    }

    /// Fail one affected session closed when a known commit cannot be
    /// published exactly. The caller then requires controlled rebuild before
    /// treating the durable/projection relationship as healthy again.
    pub(crate) fn mark_session_uncertain(
        &mut self,
        ticket: &MutationTicket,
        session_id: &str,
        committed_generation: Option<u64>,
    ) -> SnapbackResult<()> {
        let session = self.session_for_ticket(ticket, session_id)?;
        let fence = Arc::clone(&session.fence);
        let deadline_key = deadline_key_for(session);
        let current_token = session.current_token;
        let mut fence_state = fence.lock()?;
        if !fence_state.pending_tickets.contains(ticket) {
            return Err(projection_unavailable(
                "uncertain mutation ticket is absent from its leaf",
            ));
        }
        if let Some(current_token) = current_token {
            self.token_index.insert(
                current_token,
                ProjectedToken::Unavailable {
                    session_id: session_id.to_owned(),
                },
            );
        }
        self.deadline_index.remove(&deadline_key);
        let session = self.by_session.get_mut(session_id).expect("checked above");
        if let Some(generation) = committed_generation {
            session.generation = generation;
            fence_state.generation = generation;
        }
        session.state = ProjectedSessionState::Uncertain;
        session.current_token = None;
        session.pending.remove(ticket);
        self.ticket_index.remove(ticket);
        fence_state.terminal = Some(RevocationReason::Uncertain);
        fence_state.pending_tickets.remove(ticket);
        Ok(())
    }

    /// Reserve the exact new session/token identity before its durable insert.
    /// This ticket blocks reset but no existing session leaf, so unrelated
    /// finite acts remain independent while the SQLite transaction runs.
    pub(crate) fn begin_issuance(
        &mut self,
        insert: ProjectedSessionInsert,
    ) -> SnapbackResult<MutationTicket> {
        validate_projection_id(&insert.session_id, "issued session")?;
        validate_projection_id(&insert.user_id, "issued session user")?;
        validate_projection_id(&insert.authority_instance_id, "issued authority instance")?;
        validate_timestamp_u64(insert.created_at_ms)?;
        validate_timestamp_u64(insert.expires_at_ms)?;
        validate_timestamp_u64(insert.absolute_expires_at_ms)?;
        if insert.provider.is_empty()
            || insert.generation == 0
            || insert.generation > MAX_SAFE_GENERATION
            || insert.created_at_ms > insert.expires_at_ms
            || insert.expires_at_ms > insert.absolute_expires_at_ms
            || self.by_session.contains_key(&insert.session_id)
            || self.token_index.contains_key(&insert.token_digest)
            || self.pending_issuances.values().any(|pending| {
                pending.session_id == insert.session_id
                    || pending.authority_instance_id == insert.authority_instance_id
                    || pending.token_digest == insert.token_digest
            })
            || self
                .by_session
                .values()
                .any(|session| session.authority_instance_id == insert.authority_instance_id)
        {
            return Err(projection_unavailable(
                "planned session issuance collides with projected authority",
            ));
        }
        let stream_fence = Arc::clone(&self.stream_fence);
        let stream = stream_fence.lock()?;
        if !StreamFence::admits_locked(&stream, &self.incarnation) {
            return Err(projection_unavailable(
                "the authorization stream is unavailable for issuance",
            ));
        }
        let ticket = self.allocate_ticket()?;
        self.ticket_index.insert(
            ticket.clone(),
            TicketOwner::Issuance(insert.session_id.clone()),
        );
        self.pending_issuances.insert(ticket.clone(), insert);
        Ok(ticket)
    }

    pub(crate) fn compare_unmark_issuance(
        &mut self,
        ticket: &MutationTicket,
        expected_session_id: &str,
    ) -> SnapbackResult<bool> {
        if self.ticket_index.get(ticket)
            != Some(&TicketOwner::Issuance(expected_session_id.to_owned()))
        {
            return Ok(false);
        }
        let pending = self.pending_issuances.get(ticket).ok_or_else(|| {
            projection_unavailable("issuance ticket lacks its exact pending insert")
        })?;
        if pending.session_id != expected_session_id {
            return Err(projection_unavailable(
                "issuance ticket names a different pending session",
            ));
        }
        self.pending_issuances.remove(ticket);
        self.ticket_index.remove(ticket);
        Ok(true)
    }

    pub(crate) fn finalize_issuance(
        &mut self,
        ticket: &MutationTicket,
        expected_session_id: &str,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<()> {
        validate_timestamp_u64(epoch_now_ms)?;
        if self.ticket_index.get(ticket)
            != Some(&TicketOwner::Issuance(expected_session_id.to_owned()))
        {
            return Err(projection_unavailable(
                "issuance ticket does not own the committed session",
            ));
        }
        let insert =
            self.pending_issuances.get(ticket).cloned().ok_or_else(|| {
                projection_unavailable("issuance ticket lacks its committed insert")
            })?;
        if insert.session_id != expected_session_id
            || self.by_session.contains_key(expected_session_id)
            || self.token_index.contains_key(&insert.token_digest)
        {
            return Err(projection_unavailable(
                "committed issuance no longer matches its projection reservation",
            ));
        }
        let stream = self.stream_fence.lock()?;
        if !StreamFence::admits_locked(&stream, &self.incarnation) {
            return Err(projection_unavailable(
                "authorization stream changed before issuance finalize",
            ));
        }
        let deadline = DeadlinePair::derive(insert.expires_at_ms, epoch_now_ms, monotonic_now)?;
        if !deadline.live_at(epoch_now_ms, monotonic_now) {
            return Err(projection_unavailable(
                "committed issuance expired before projection finalize",
            ));
        }
        let session = ProjectedSession {
            session_id: insert.session_id.clone(),
            user_id: insert.user_id,
            provider: insert.provider,
            authority_instance_id: insert.authority_instance_id,
            generation: insert.generation,
            expires_at_ms: insert.expires_at_ms,
            absolute_expires_at_ms: insert.absolute_expires_at_ms,
            deadline,
            state: ProjectedSessionState::Current,
            current_token: Some(insert.token_digest),
            pending: BTreeMap::new(),
            fence: Arc::new(SessionFence::new(insert.generation, deadline, None)),
        };
        let deadline_key = deadline_key_for(&session);
        if self
            .token_index
            .insert(
                insert.token_digest,
                ProjectedToken::Current {
                    session_id: expected_session_id.to_owned(),
                },
            )
            .is_some()
            || !self.deadline_index.insert(deadline_key)
            || self
                .by_session
                .insert(expected_session_id.to_owned(), session)
                .is_some()
        {
            return Err(projection_unavailable(
                "committed issuance projection indexes collided",
            ));
        }
        self.pending_issuances.remove(ticket);
        self.ticket_index.remove(ticket);
        Ok(())
    }

    /// Install a unique marker in both topology and leaf indexes. A sibling
    /// marker is allowed; it cannot be erased by this ticket's rollback.
    pub(crate) fn begin_session_mutation(
        &mut self,
        session_id: &str,
        expected_generation: u64,
        kind: PendingMutationKind,
    ) -> SnapbackResult<MutationTicket> {
        if matches!(kind, PendingMutationKind::Expire { .. }) {
            return Err(projection_unavailable(
                "expiry must use the deadline-proving begin operation",
            ));
        }
        let stream_fence = Arc::clone(&self.stream_fence);
        let stream_state = stream_fence.lock()?;
        if !StreamFence::admits_locked(&stream_state, &self.incarnation) {
            return Err(projection_unavailable(
                "the authorization stream is unavailable for a session mutation",
            ));
        }
        let fence = {
            let session = self.by_session.get(session_id).ok_or_else(|| {
                projection_unavailable("the planned session is absent from the projection")
            })?;
            if session.generation != expected_generation
                || session.state != ProjectedSessionState::Current
            {
                return Err(projection_unavailable(
                    "the planned session no longer matches the projection",
                ));
            }
            if let PendingMutationKind::TokenSupersede {
                predecessor,
                successor,
                superseded_at_ms,
            } = &kind
            {
                validate_timestamp_u64(*superseded_at_ms)?;
                if session.current_token.as_ref() != Some(predecessor)
                    || predecessor == successor
                    || self.token_index.contains_key(successor)
                    || !matches!(
                        self.token_index.get(predecessor),
                        Some(ProjectedToken::Current { session_id: owner }) if owner == session_id
                    )
                {
                    return Err(projection_unavailable(
                        "the planned predecessor token no longer matches the projection",
                    ));
                }
            }
            Arc::clone(&session.fence)
        };
        let ticket = self.allocate_ticket()?;
        let mut fence_state = fence.lock()?;
        if fence_state.generation != expected_generation || fence_state.terminal.is_some() {
            return Err(projection_unavailable(
                "the planned session no longer matches its leaf fence",
            ));
        }
        let session = self
            .by_session
            .get_mut(session_id)
            .expect("session validated before leaf acquisition");
        session.pending.insert(
            ticket.clone(),
            PendingMutation {
                expected_generation,
                kind,
            },
        );
        self.ticket_index
            .insert(ticket.clone(), TicketOwner::Session(session_id.to_owned()));
        fence_state.pending_tickets.insert(ticket.clone());
        Ok(ticket)
    }

    /// Atomically prove an authoritative deadline has elapsed and install its
    /// unique terminal ticket. A wall-clock jump or the monotonic deadline may
    /// independently prove due; once marked, later clock movement cannot make
    /// the session transiently live again.
    pub(crate) fn begin_expiry(
        &mut self,
        session_id: &str,
        expected_generation: u64,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<MutationTicket> {
        validate_timestamp_u64(epoch_now_ms)?;
        let stream_fence = Arc::clone(&self.stream_fence);
        let stream_state = stream_fence.lock()?;
        if !StreamFence::admits_locked(&stream_state, &self.incarnation) {
            return Err(projection_unavailable(
                "the authorization stream is unavailable for expiry",
            ));
        }
        let (fence, deadline) = {
            let session = self.by_session.get(session_id).ok_or_else(|| {
                projection_unavailable("the expiry session is absent from the projection")
            })?;
            if session.generation != expected_generation
                || session.state != ProjectedSessionState::Current
                || session.deadline.live_at(epoch_now_ms, monotonic_now)
            {
                return Err(projection_unavailable(
                    "the expiry deadline is not due for the projected generation",
                ));
            }
            (Arc::clone(&session.fence), session.deadline)
        };
        let ticket = self.allocate_ticket()?;
        let mut fence_state = fence.lock()?;
        if fence_state.generation != expected_generation
            || fence_state.terminal.is_some()
            || fence_state.deadline != deadline
            || fence_state.deadline.live_at(epoch_now_ms, monotonic_now)
        {
            return Err(projection_unavailable(
                "the expiry deadline no longer matches its leaf fence",
            ));
        }
        self.by_session
            .get_mut(session_id)
            .expect("session validated before leaf acquisition")
            .pending
            .insert(
                ticket.clone(),
                PendingMutation {
                    expected_generation,
                    kind: PendingMutationKind::Expire { deadline },
                },
            );
        self.ticket_index
            .insert(ticket.clone(), TicketOwner::Session(session_id.to_owned()));
        fence_state.pending_tickets.insert(ticket.clone());
        Ok(ticket)
    }

    /// Remove only the marker still owned by this exact ticket. Generation or
    /// terminal changes caused by a sibling do not make the operation restore
    /// an old whole-session snapshot.
    pub(crate) fn compare_unmark_session(
        &mut self,
        ticket: &MutationTicket,
        expected_session_id: &str,
    ) -> SnapbackResult<bool> {
        if self.ticket_index.get(ticket)
            != Some(&TicketOwner::Session(expected_session_id.to_owned()))
        {
            return Ok(false);
        }
        let Some(session) = self.by_session.get(expected_session_id) else {
            return Err(projection_unavailable(
                "a session ticket has no projected owner",
            ));
        };
        if !session.pending.contains_key(ticket) {
            return Err(projection_unavailable(
                "a session ticket is missing from its projected owner",
            ));
        }
        let fence = Arc::clone(&session.fence);
        let mut fence_state = fence.lock()?;
        if !fence_state.pending_tickets.contains(ticket) {
            return Err(projection_unavailable(
                "a session ticket is missing from its leaf fence",
            ));
        }
        self.by_session
            .get_mut(expected_session_id)
            .expect("owner checked above")
            .pending
            .remove(ticket);
        self.ticket_index.remove(ticket);
        fence_state.pending_tickets.remove(ticket);
        Ok(true)
    }

    pub(crate) fn finalize_revocation(
        &mut self,
        ticket: &MutationTicket,
        session_id: &str,
        committed_generation: u64,
    ) -> SnapbackResult<()> {
        let (fence, pending, deadline_key, current_token) = {
            let session = self.session_for_ticket(ticket, session_id)?;
            let pending = session
                .pending
                .get(ticket)
                .cloned()
                .ok_or_else(|| projection_unavailable("revocation ticket is not pending"))?;
            let expected_successor = pending
                .expected_generation
                .checked_add(1)
                .filter(|generation| *generation <= MAX_SAFE_GENERATION)
                .ok_or_else(|| projection_unavailable("session generation overflowed"))?;
            if committed_generation != expected_successor
                || session.generation != pending.expected_generation
                || session.state != ProjectedSessionState::Current
            {
                return Err(projection_unavailable(
                    "committed revocation does not match the projected predecessor",
                ));
            }
            let PendingMutationKind::Revoke { .. } = pending.kind else {
                return Err(projection_unavailable(
                    "ticket does not own a revocation mutation",
                ));
            };
            let current_token = session.current_token.ok_or_else(|| {
                projection_unavailable("current projected session lacks its token")
            })?;
            (
                Arc::clone(&session.fence),
                pending,
                deadline_key_for(session),
                current_token,
            )
        };
        if !matches!(
            self.token_index.get(&current_token),
            Some(ProjectedToken::Current { session_id: owner }) if owner == session_id
        ) || !self.deadline_index.contains(&deadline_key)
        {
            return Err(projection_unavailable(
                "revocation indexes do not match the projected predecessor",
            ));
        }
        let PendingMutationKind::Revoke { reason } = pending.kind else {
            unreachable!();
        };
        let mut fence_state = fence.lock()?;
        if fence_state.generation != pending.expected_generation
            || !fence_state.pending_tickets.contains(ticket)
        {
            return Err(projection_unavailable(
                "revocation leaf does not match the projected predecessor",
            ));
        }
        self.token_index.insert(
            current_token,
            ProjectedToken::Terminal {
                session_id: session_id.to_owned(),
            },
        );
        self.deadline_index.remove(&deadline_key);
        let session = self.by_session.get_mut(session_id).expect("checked above");
        session.generation = committed_generation;
        session.state = ProjectedSessionState::Revoked { reason };
        session.current_token = None;
        session.pending.remove(ticket);
        self.ticket_index.remove(ticket);
        fence_state.generation = committed_generation;
        fence_state.terminal = Some(reason);
        fence_state.pending_tickets.remove(ticket);
        Ok(())
    }

    pub(crate) fn finalize_expiry(
        &mut self,
        ticket: &MutationTicket,
        session_id: &str,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<()> {
        validate_timestamp_u64(epoch_now_ms)?;
        let (fence, deadline_key, current_token, deadline) = {
            let session = self.session_for_ticket(ticket, session_id)?;
            let pending = session
                .pending
                .get(ticket)
                .cloned()
                .ok_or_else(|| projection_unavailable("expiry ticket is not pending"))?;
            let PendingMutationKind::Expire { deadline } = pending.kind else {
                return Err(projection_unavailable(
                    "ticket does not own an expiry mutation",
                ));
            };
            if session.deadline != deadline
                || deadline.live_at(epoch_now_ms, monotonic_now)
                || session.generation != pending.expected_generation
                || session.state != ProjectedSessionState::Current
            {
                return Err(projection_unavailable(
                    "expiry does not match the projected predecessor",
                ));
            }
            (
                Arc::clone(&session.fence),
                deadline_key_for(session),
                session.current_token.ok_or_else(|| {
                    projection_unavailable("current projected session lacks its token")
                })?,
                deadline,
            )
        };
        let mut fence_state = fence.lock()?;
        if !fence_state.pending_tickets.contains(ticket)
            || fence_state.deadline != deadline
            || fence_state.deadline.live_at(epoch_now_ms, monotonic_now)
        {
            return Err(projection_unavailable(
                "expiry ticket or due deadline is absent from its leaf",
            ));
        }
        self.token_index.insert(
            current_token,
            ProjectedToken::Terminal {
                session_id: session_id.to_owned(),
            },
        );
        self.deadline_index.remove(&deadline_key);
        let session = self.by_session.get_mut(session_id).expect("checked above");
        session.state = ProjectedSessionState::Expired;
        session.current_token = None;
        session.pending.remove(ticket);
        self.ticket_index.remove(ticket);
        fence_state.terminal = Some(RevocationReason::Expired);
        fence_state.pending_tickets.remove(ticket);
        Ok(())
    }

    pub(crate) fn finalize_token_rotation(
        &mut self,
        ticket: &MutationTicket,
        session_id: &str,
    ) -> SnapbackResult<()> {
        let (fence, pending, predecessor, successor, superseded_at_ms) = {
            let session = self.session_for_ticket(ticket, session_id)?;
            let pending = session
                .pending
                .get(ticket)
                .cloned()
                .ok_or_else(|| projection_unavailable("rotation ticket is not pending"))?;
            let PendingMutationKind::TokenSupersede {
                predecessor,
                successor,
                superseded_at_ms,
            } = pending.kind.clone()
            else {
                return Err(projection_unavailable(
                    "ticket does not own a token rotation",
                ));
            };
            if session.generation != pending.expected_generation
                || session.state != ProjectedSessionState::Current
                || session.current_token != Some(predecessor)
            {
                return Err(projection_unavailable(
                    "rotation does not match the projected predecessor",
                ));
            }
            (
                Arc::clone(&session.fence),
                pending,
                predecessor,
                successor,
                superseded_at_ms,
            )
        };
        if predecessor == successor
            || self.token_index.contains_key(&successor)
            || !matches!(
                self.token_index.get(&predecessor),
                Some(ProjectedToken::Current { session_id: owner }) if owner == session_id
            )
        {
            return Err(projection_unavailable(
                "rotation token indexes do not match the committed transition",
            ));
        }
        let mut fence_state = fence.lock()?;
        if fence_state.generation != pending.expected_generation
            || fence_state.terminal.is_some()
            || !fence_state.pending_tickets.contains(ticket)
        {
            return Err(projection_unavailable(
                "rotation leaf does not match the projected predecessor",
            ));
        }
        self.token_index.insert(
            predecessor,
            ProjectedToken::Superseded {
                session_id: session_id.to_owned(),
                superseded_at_ms,
            },
        );
        self.token_index.insert(
            successor,
            ProjectedToken::Current {
                session_id: session_id.to_owned(),
            },
        );
        let session = self.by_session.get_mut(session_id).expect("checked above");
        session.current_token = Some(successor);
        session.pending.remove(ticket);
        self.ticket_index.remove(ticket);
        fence_state.pending_tickets.remove(ticket);
        Ok(())
    }

    pub(crate) fn begin_stream_mutation(
        &mut self,
        successor: AuthorizationStreamIncarnation,
    ) -> SnapbackResult<MutationTicket> {
        if !self.ticket_index.is_empty() {
            return Err(projection_unavailable(
                "the authorization stream has in-flight session mutations",
            ));
        }
        let fence = Arc::clone(&self.stream_fence);
        let mut state = fence.lock()?;
        if state.incarnation != self.incarnation || !state.pending_tickets.is_empty() {
            return Err(projection_unavailable(
                "the authorization stream is already unavailable",
            ));
        }
        if successor == self.incarnation {
            return Err(projection_unavailable(
                "stream rotation successor equals its predecessor",
            ));
        }
        let ticket = self.allocate_ticket()?;
        state.pending_tickets.insert(ticket.clone());
        self.ticket_index
            .insert(ticket.clone(), TicketOwner::Stream);
        self.stream_pending.insert(ticket.clone(), successor);
        Ok(ticket)
    }

    pub(crate) fn compare_unmark_stream(
        &mut self,
        ticket: &MutationTicket,
    ) -> SnapbackResult<bool> {
        if self.ticket_index.get(ticket) != Some(&TicketOwner::Stream) {
            return Ok(false);
        }
        let mut state = self.stream_fence.lock()?;
        if !state.pending_tickets.contains(ticket) {
            return Err(projection_unavailable(
                "a stream ticket is absent from its fence",
            ));
        }
        state.pending_tickets.remove(ticket);
        self.ticket_index.remove(ticket);
        self.stream_pending.remove(ticket);
        Ok(true)
    }

    /// Finalize reset/restore on the existing shared stream-fence arc. Any
    /// predecessor grant that retained that arc now observes the successor
    /// incarnation and fails exact-incarnation validation.
    pub(crate) fn finalize_stream_rotation(
        &mut self,
        ticket: &MutationTicket,
    ) -> SnapbackResult<()> {
        if self.ticket_index.len() != 1
            || self.ticket_index.get(ticket) != Some(&TicketOwner::Stream)
        {
            return Err(projection_unavailable(
                "stream rotation does not own the complete mutation barrier",
            ));
        }
        let mut state = self.stream_fence.lock()?;
        if state.incarnation != self.incarnation || !state.pending_tickets.contains(ticket) {
            return Err(projection_unavailable(
                "stream rotation fence does not match its predecessor",
            ));
        }
        let successor = self.stream_pending.get(ticket).cloned().ok_or_else(|| {
            projection_unavailable("stream rotation ticket has no exact planned successor")
        })?;
        self.by_session.clear();
        self.token_index.clear();
        self.deadline_index.clear();
        self.ticket_index.remove(ticket);
        self.stream_pending.remove(ticket);
        self.incarnation = successor.clone();
        state.incarnation = successor;
        state.pending_tickets.remove(ticket);
        Ok(())
    }

    pub(crate) fn check_invariants(&self) -> SnapbackResult<()> {
        if self.format_version != SESSION_PROJECTION_FORMAT_VERSION {
            return Err(projection_corrupt("projection format is unsupported"));
        }
        validate_canonical_uuid_v7(&self.projection_startup_id)
            .map_err(|_| projection_corrupt("projection startup id is invalid"))?;
        let stream = self.stream_fence.lock()?;
        if stream.incarnation != self.incarnation {
            return Err(projection_corrupt(
                "projection and stream-fence incarnations differ",
            ));
        }
        for ticket in &stream.pending_tickets {
            if self.ticket_index.get(ticket) != Some(&TicketOwner::Stream) {
                return Err(projection_corrupt(
                    "stream-fence ticket lacks an exact topology owner",
                ));
            }
            let successor = self.stream_pending.get(ticket).ok_or_else(|| {
                projection_corrupt("stream-fence ticket lacks its planned successor")
            })?;
            if successor == &self.incarnation {
                return Err(projection_corrupt(
                    "stream-fence ticket repeats the current incarnation",
                ));
            }
        }
        if self.stream_pending.keys().cloned().collect::<BTreeSet<_>>() != stream.pending_tickets {
            return Err(projection_corrupt(
                "planned stream successors and stream-fence tickets differ",
            ));
        }
        drop(stream);

        for (session_id, session) in &self.by_session {
            if session_id != &session.session_id
                || session.user_id.is_empty()
                || session.provider.is_empty()
                || session.authority_instance_id.is_empty()
                || session.expires_at_ms > session.absolute_expires_at_ms
            {
                return Err(projection_corrupt("projected session shape is invalid"));
            }
            let fence = session.fence.lock()?;
            if fence.generation != session.generation
                || fence.deadline != session.deadline
                || fence.pending_tickets != session.pending.keys().cloned().collect()
            {
                return Err(projection_corrupt(
                    "projected session and leaf fence differ",
                ));
            }
            let expected_terminal = match session.state {
                ProjectedSessionState::Current => None,
                ProjectedSessionState::Revoked { reason } => Some(reason),
                ProjectedSessionState::Expired => Some(RevocationReason::Expired),
                ProjectedSessionState::Uncertain => Some(RevocationReason::Uncertain),
            };
            if fence.terminal != expected_terminal {
                return Err(projection_corrupt(
                    "projected terminal state and leaf fence differ",
                ));
            }
            drop(fence);
            for ticket in session.pending.keys() {
                if self.ticket_index.get(ticket) != Some(&TicketOwner::Session(session_id.clone()))
                {
                    return Err(projection_corrupt(
                        "session pending ticket lacks an exact topology owner",
                    ));
                }
            }
            match session.state {
                ProjectedSessionState::Current => {
                    let digest = session.current_token.ok_or_else(|| {
                        projection_corrupt("current projected session lacks a token")
                    })?;
                    if !matches!(
                        self.token_index.get(&digest),
                        Some(ProjectedToken::Current { session_id: owner }) if owner == session_id
                    ) || !self.deadline_index.contains(&deadline_key_for(session))
                    {
                        return Err(projection_corrupt(
                            "current projected session indexes are incomplete",
                        ));
                    }
                }
                _ => {
                    if session.current_token.is_some()
                        || self.deadline_index.contains(&deadline_key_for(session))
                    {
                        return Err(projection_corrupt(
                            "terminal projected session retains a current index",
                        ));
                    }
                }
            }
        }
        for (digest, token) in &self.token_index {
            match token {
                ProjectedToken::Current { session_id } => {
                    let Some(session) = self.by_session.get(session_id) else {
                        return Err(projection_corrupt("current token has a dangling session"));
                    };
                    if session.state != ProjectedSessionState::Current
                        || session.current_token.as_ref() != Some(digest)
                    {
                        return Err(projection_corrupt(
                            "current token does not match its projected session",
                        ));
                    }
                }
                ProjectedToken::Superseded { session_id, .. } => {
                    if !self.by_session.contains_key(session_id) {
                        return Err(projection_corrupt(
                            "superseded token has a dangling session",
                        ));
                    }
                }
                ProjectedToken::Terminal { session_id } => {
                    let Some(session) = self.by_session.get(session_id) else {
                        return Err(projection_corrupt("terminal token has a dangling session"));
                    };
                    if session.state == ProjectedSessionState::Current {
                        return Err(projection_corrupt(
                            "terminal token points at a current session",
                        ));
                    }
                }
                ProjectedToken::Unavailable { session_id } => {
                    let Some(session) = self.by_session.get(session_id) else {
                        return Err(projection_corrupt(
                            "unavailable token has a dangling session",
                        ));
                    };
                    if session.state != ProjectedSessionState::Uncertain {
                        return Err(projection_corrupt(
                            "unavailable token points at a certain session",
                        ));
                    }
                }
            }
        }
        for deadline in &self.deadline_index {
            let Some(session) = self.by_session.get(&deadline.session_id) else {
                return Err(projection_corrupt("deadline has a dangling session"));
            };
            if session.state != ProjectedSessionState::Current
                || deadline != &deadline_key_for(session)
            {
                return Err(projection_corrupt(
                    "deadline does not match its current projected session",
                ));
            }
        }
        for (ticket, insert) in &self.pending_issuances {
            if self.ticket_index.get(ticket)
                != Some(&TicketOwner::Issuance(insert.session_id.clone()))
                || self.by_session.contains_key(&insert.session_id)
                || self.token_index.contains_key(&insert.token_digest)
            {
                return Err(projection_corrupt(
                    "pending issuance lacks an exact collision-free topology owner",
                ));
            }
        }
        for (ticket, owner) in &self.ticket_index {
            match owner {
                TicketOwner::Session(session_id) => {
                    if !self
                        .by_session
                        .get(session_id)
                        .is_some_and(|session| session.pending.contains_key(ticket))
                    {
                        return Err(projection_corrupt(
                            "topology ticket has no exact session member",
                        ));
                    }
                }
                TicketOwner::Issuance(session_id) => {
                    if self
                        .pending_issuances
                        .get(ticket)
                        .is_none_or(|insert| &insert.session_id != session_id)
                    {
                        return Err(projection_corrupt(
                            "issuance topology ticket has no exact pending insert",
                        ));
                    }
                }
                TicketOwner::Stream => {
                    if !self.stream_fence.lock()?.pending_tickets.contains(ticket) {
                        return Err(projection_corrupt(
                            "topology ticket has no exact stream member",
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    fn session_for_ticket(
        &self,
        ticket: &MutationTicket,
        session_id: &str,
    ) -> SnapbackResult<&ProjectedSession> {
        if self.ticket_index.get(ticket) != Some(&TicketOwner::Session(session_id.to_owned())) {
            return Err(projection_unavailable(
                "mutation ticket does not own the expected session",
            ));
        }
        self.by_session
            .get(session_id)
            .ok_or_else(|| projection_unavailable("mutation ticket has a dangling session"))
    }

    fn allocate_ticket(&mut self) -> SnapbackResult<MutationTicket> {
        let sequence = self.next_ticket.ok_or_else(|| {
            projection_unavailable("projection mutation-ticket counter is exhausted")
        })?;
        self.next_ticket = sequence.get().checked_add(1).and_then(NonZeroU64::new);
        let ticket = MutationTicket {
            startup_id: self.projection_startup_id.clone(),
            sequence,
        };
        if self.ticket_index.contains_key(&ticket) {
            return Err(projection_unavailable(
                "projection generated a duplicate mutation ticket",
            ));
        }
        Ok(ticket)
    }

    #[cfg(test)]
    fn set_next_ticket_for_test(&mut self, sequence: Option<NonZeroU64>) {
        self.next_ticket = sequence;
    }

    #[cfg(test)]
    pub(crate) fn pending_kind_for_test(
        &self,
        session_id: &str,
        ticket: &MutationTicket,
    ) -> Option<PendingMutationKind> {
        self.by_session
            .get(session_id)?
            .pending
            .get(ticket)
            .map(|pending| pending.kind.clone())
    }

    #[cfg(test)]
    fn test_act_is_admissible(
        &self,
        session_id: &str,
        expected_incarnation: &AuthorizationStreamIncarnation,
        expected_generation: u64,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<bool> {
        if expected_incarnation != &self.incarnation {
            return Ok(false);
        }
        self.session_publication_fence(session_id, expected_generation)?
            .try_publish(epoch_now_ms, monotonic_now, || Ok(()))
            .map(|published| published.is_some())
    }
}

fn deadline_key_for(session: &ProjectedSession) -> DeadlineKey {
    DeadlineKey {
        monotonic_deadline: session.deadline.monotonic_deadline,
        epoch_deadline_ms: session.deadline.epoch_deadline_ms,
        session_id: session.session_id.clone(),
        generation: session.generation,
    }
}

fn validate_projection_id(value: &str, label: &str) -> SnapbackResult<()> {
    validate_canonical_uuid_v7(value)
        .map_err(|_| projection_corrupt(&format!("projected {label} id is not a canonical UUIDv7")))
}

fn validate_canonical_uuid_v7(value: &str) -> Result<(), ()> {
    let parsed = Uuid::parse_str(value).map_err(|_| ())?;
    if parsed.get_version_num() != 7 || parsed.hyphenated().to_string() != value {
        return Err(());
    }
    Ok(())
}

fn validate_timestamp_i64(value: i64, label: &str) -> SnapbackResult<u64> {
    let value = u64::try_from(value)
        .ok()
        .filter(|value| *value <= MAX_SAFE_TIMESTAMP)
        .ok_or_else(|| projection_corrupt(&format!("projected {label} timestamp is invalid")))?;
    Ok(value)
}

fn validate_timestamp_u64(value: u64) -> SnapbackResult<()> {
    if value > MAX_SAFE_TIMESTAMP {
        return Err(projection_corrupt(
            "a projected timestamp exceeds the portable range",
        ));
    }
    Ok(())
}

fn stream_corrupt(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT", "auth", message)
}

fn projection_corrupt(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_PROJECTION_CORRUPT", "auth", message)
}

fn projection_unavailable(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_PROJECTION_UNAVAILABLE", "auth", message)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPOCH_NOW_MS: u64 = 100;

    fn uuid_v7(timestamp_ms: u64, byte: u8) -> String {
        uuid::Builder::from_unix_timestamp_millis(timestamp_ms, &[byte; 10])
            .into_uuid()
            .to_string()
    }

    fn encoded_stream(byte: u8) -> Vec<u8> {
        AuthorizationStreamRecord::new(
            AuthorizationStreamIncarnation::parse(&uuid_v7(1, byte)).unwrap(),
        )
        .encode_bytes()
        .unwrap()
    }

    fn source() -> ProjectionSource {
        let user_id = uuid_v7(2, 2);
        let identity_id = uuid_v7(3, 3);
        ProjectionSource {
            authorization_stream_value: encoded_stream(1),
            restore_declaration_id: None,
            users: vec![ProjectionUserRow {
                id: user_id.clone(),
                created_at_ms: 1,
            }],
            identities: vec![ProjectionIdentityRow {
                id: identity_id.clone(),
                user_id: user_id.clone(),
                provider: "email-code".to_owned(),
                verified_at_ms: 2,
            }],
            sessions: vec![ProjectionSessionRow {
                id: uuid_v7(4, 4),
                user_id,
                identity_id,
                authority_instance_id: uuid_v7(5, 5),
                token_hash: vec![11; 32],
                generation: 1,
                created_at_ms: 3,
                last_used_at_ms: 4,
                expires_at_ms: 200,
                absolute_expires_at_ms: 300,
                revoked_at_ms: None,
            }],
            superseded_tokens: vec![ProjectionTokenRow {
                token_hash: vec![10; 32],
                session_id: uuid_v7(4, 4),
                superseded_at_ms: 3,
            }],
        }
    }

    fn startup_id() -> String {
        uuid_v7(10, 10)
    }

    fn rebuild_at(source: ProjectionSource, monotonic_now: Instant) -> SessionProjection {
        SessionProjection::rebuild(source, &startup_id(), EPOCH_NOW_MS, monotonic_now).unwrap()
    }

    fn only_session_id(projection: &SessionProjection) -> String {
        projection.by_session.keys().next().unwrap().clone()
    }

    fn assert_code(error: SnapbackError, expected: &str) {
        assert_eq!(error.diagnostic.code, expected);
    }

    #[test]
    fn stream_record_requires_the_exact_closed_encoding() {
        let canonical = encoded_stream(1);
        let parsed = AuthorizationStreamRecord::parse_exact(&canonical).unwrap();
        assert_eq!(parsed.encode_bytes().unwrap(), canonical);

        let id = uuid_v7(1, 1);
        for malformed in [
            format!("{{ \"formatVersion\":1,\"incarnation\":\"{id}\"}}"),
            format!("{{\"incarnation\":\"{id}\",\"formatVersion\":1}}"),
            format!("{{\"formatVersion\":2,\"incarnation\":\"{id}\"}}"),
            format!("{{\"formatVersion\":1,\"incarnation\":\"{id}\",\"x\":0}}"),
            "{\"formatVersion\":1,\"incarnation\":\"not-a-uuid\"}".to_owned(),
        ] {
            assert_code(
                AuthorizationStreamRecord::parse_exact(malformed.as_bytes()).unwrap_err(),
                "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT",
            );
        }
    }

    #[test]
    fn rebuild_derives_dual_deadlines_and_checks_both_clocks() {
        let monotonic_now = Instant::now();
        let projection = rebuild_at(source(), monotonic_now);
        let session_id = only_session_id(&projection);
        let incarnation = projection.incarnation().clone();
        assert!(
            projection
                .test_act_is_admissible(
                    &session_id,
                    &incarnation,
                    1,
                    199,
                    monotonic_now + Duration::from_millis(99),
                )
                .unwrap()
        );
        assert!(
            !projection
                .test_act_is_admissible(
                    &session_id,
                    &incarnation,
                    1,
                    200,
                    monotonic_now + Duration::from_millis(50),
                )
                .unwrap()
        );
        // A backward wall-clock jump cannot outlive the monotonic deadline.
        assert!(
            !projection
                .test_act_is_admissible(
                    &session_id,
                    &incarnation,
                    1,
                    50,
                    monotonic_now + Duration::from_millis(100),
                )
                .unwrap()
        );
        projection.check_invariants().unwrap();
    }

    #[test]
    fn restart_retains_terminal_classification_for_current_and_superseded_tokens() {
        let monotonic_now = Instant::now();
        for terminal_source in [
            {
                let mut source = source();
                source.sessions[0].generation = 2;
                source.sessions[0].revoked_at_ms = Some(99);
                source
            },
            {
                let mut source = source();
                source.sessions[0].expires_at_ms = EPOCH_NOW_MS as i64;
                source
            },
        ] {
            let projection = rebuild_at(terminal_source, monotonic_now);
            for digest in [[11; 32], [10; 32]] {
                assert_eq!(
                    projection
                        .resolve_token(
                            &TokenDigest::from_slice(&digest).unwrap(),
                            EPOCH_NOW_MS,
                            monotonic_now,
                        )
                        .unwrap(),
                    ProjectedTokenResolution::Terminal
                );
            }
            assert_eq!(
                projection
                    .resolve_token(
                        &TokenDigest::from_slice(&[99; 32]).unwrap(),
                        EPOCH_NOW_MS,
                        monotonic_now,
                    )
                    .unwrap(),
                ProjectedTokenResolution::Unknown
            );
            projection.check_invariants().unwrap();
        }
    }

    #[test]
    fn restart_reconstructs_only_the_durable_remaining_deadline() {
        let first_mono = Instant::now();
        let first = DeadlinePair::derive(200, 100, first_mono).unwrap();
        assert_eq!(
            first.monotonic_deadline.duration_since(first_mono),
            Duration::from_millis(100)
        );
        let restart_mono = first_mono + Duration::from_secs(10);
        let restarted = DeadlinePair::derive(200, 150, restart_mono).unwrap();
        assert_eq!(
            restarted.monotonic_deadline.duration_since(restart_mono),
            Duration::from_millis(50)
        );
    }

    #[test]
    fn rebuild_rejects_each_independent_corruption_source() {
        let monotonic_now = Instant::now();

        let mut duplicate = source();
        let mut second = duplicate.sessions[0].clone();
        second.id = uuid_v7(6, 6);
        second.authority_instance_id = uuid_v7(7, 7);
        duplicate.sessions.push(second);
        assert_code(
            SessionProjection::rebuild(duplicate, &startup_id(), EPOCH_NOW_MS, monotonic_now)
                .unwrap_err(),
            "SNAPBACK_AUTH_PROJECTION_CORRUPT",
        );

        let mut dangling = source();
        dangling.sessions[0].identity_id = uuid_v7(99, 99);
        assert_code(
            SessionProjection::rebuild(dangling, &startup_id(), EPOCH_NOW_MS, monotonic_now)
                .unwrap_err(),
            "SNAPBACK_AUTH_PROJECTION_CORRUPT",
        );

        let mut generation = source();
        generation.sessions[0].generation = 0;
        assert_code(
            SessionProjection::rebuild(generation, &startup_id(), EPOCH_NOW_MS, monotonic_now)
                .unwrap_err(),
            "SNAPBACK_AUTH_PROJECTION_CORRUPT",
        );

        let mut oversized_generation = source();
        oversized_generation.sessions[0].generation = (MAX_SAFE_GENERATION + 1) as i64;
        assert_code(
            SessionProjection::rebuild(
                oversized_generation,
                &startup_id(),
                EPOCH_NOW_MS,
                monotonic_now,
            )
            .unwrap_err(),
            "SNAPBACK_AUTH_PROJECTION_CORRUPT",
        );

        let mut timestamp = source();
        timestamp.sessions[0].last_used_at_ms = 201;
        assert_code(
            SessionProjection::rebuild(timestamp, &startup_id(), EPOCH_NOW_MS, monotonic_now)
                .unwrap_err(),
            "SNAPBACK_AUTH_PROJECTION_CORRUPT",
        );

        let mut marker = source();
        marker.restore_declaration_id = Some(b"not-a-declaration".to_vec());
        assert_code(
            SessionProjection::rebuild(marker, &startup_id(), EPOCH_NOW_MS, monotonic_now)
                .unwrap_err(),
            "SNAPBACK_AUTH_PROJECTION_CORRUPT",
        );

        let mut incarnation = source();
        incarnation.authorization_stream_value = b"{\"formatVersion\":1}".to_vec();
        assert_code(
            SessionProjection::rebuild(incarnation, &startup_id(), EPOCH_NOW_MS, monotonic_now)
                .unwrap_err(),
            "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT",
        );
    }

    #[test]
    fn projection_source_debug_redacts_every_raw_row_and_digest() {
        let debug = format!("{:?}", source());
        assert_eq!(debug, "ProjectionSource([REDACTED])");
        assert!(!debug.contains("token_hash"));
        assert!(!debug.contains("11"));
    }

    #[test]
    fn publication_closure_runs_while_stream_and_session_guards_are_held() {
        let monotonic_now = Instant::now();
        let projection = rebuild_at(source(), monotonic_now);
        let session_id = only_session_id(&projection);
        let publication = projection
            .session_publication_fence(&session_id, 1)
            .unwrap();
        let observed = publication
            .try_publish(101, monotonic_now, || {
                assert!(publication.stream.state.try_lock().is_err());
                assert!(
                    publication
                        .session
                        .as_ref()
                        .unwrap()
                        .session
                        .state
                        .try_lock()
                        .is_err()
                );
                Ok("published")
            })
            .unwrap();
        assert_eq!(observed, Some("published"));
    }

    #[test]
    fn due_expiry_is_terminal_even_if_wall_clock_moves_backward() {
        let monotonic_now = Instant::now();
        let mut projection = rebuild_at(source(), monotonic_now);
        let session_id = only_session_id(&projection);
        let incarnation = projection.incarnation().clone();
        let expired = projection
            .expire_due(200, monotonic_now + Duration::from_millis(50))
            .unwrap();
        assert_eq!(
            expired,
            vec![ExpiredSession {
                authorization_stream_incarnation: incarnation.as_str().to_owned(),
                session_id: session_id.clone(),
                generation: 1,
                close_by: monotonic_now + Duration::from_millis(50) + TERMINAL_CLOSE_GRACE,
            }]
        );
        assert!(
            !projection
                .test_act_is_admissible(
                    &session_id,
                    &incarnation,
                    1,
                    50,
                    monotonic_now + Duration::from_millis(50),
                )
                .unwrap()
        );
        projection.check_invariants().unwrap();
    }

    #[test]
    fn unique_tickets_and_exact_unmark_preserve_sibling_barriers() {
        for finalize_second in [false, true] {
            let monotonic_now = Instant::now();
            let mut projection = rebuild_at(source(), monotonic_now);
            let session_id = only_session_id(&projection);
            let incarnation = projection.incarnation().clone();
            let a = projection
                .begin_session_mutation(
                    &session_id,
                    1,
                    PendingMutationKind::Revoke {
                        reason: RevocationReason::Logout,
                    },
                )
                .unwrap();
            let b = projection
                .begin_session_mutation(
                    &session_id,
                    1,
                    PendingMutationKind::Revoke {
                        reason: RevocationReason::FamilyAlarm,
                    },
                )
                .unwrap();
            assert_ne!(a, b);
            assert_eq!(a.to_string(), format!("{}:1", startup_id()));
            assert_eq!(b.to_string(), format!("{}:2", startup_id()));
            assert!(
                !projection
                    .test_act_is_admissible(&session_id, &incarnation, 1, 101, monotonic_now,)
                    .unwrap()
            );
            let (winner, loser) = if finalize_second { (&b, &a) } else { (&a, &b) };
            projection
                .finalize_revocation(winner, &session_id, 2)
                .unwrap();
            assert!(
                projection
                    .compare_unmark_session(loser, &session_id)
                    .unwrap()
            );
            let session = projection.by_session.get(&session_id).unwrap();
            assert!(matches!(
                session.state,
                ProjectedSessionState::Revoked { .. }
            ));
            assert!(session.pending.is_empty());
            assert!(
                !projection
                    .test_act_is_admissible(&session_id, &incarnation, 2, 101, monotonic_now,)
                    .unwrap()
            );
            projection.check_invariants().unwrap();
        }
    }

    #[test]
    fn rollback_of_one_ticket_never_clears_its_sibling() {
        let monotonic_now = Instant::now();
        let mut projection = rebuild_at(source(), monotonic_now);
        let session_id = only_session_id(&projection);
        let incarnation = projection.incarnation().clone();
        let a = projection
            .begin_session_mutation(
                &session_id,
                1,
                PendingMutationKind::Revoke {
                    reason: RevocationReason::Logout,
                },
            )
            .unwrap();
        let b = projection
            .begin_session_mutation(
                &session_id,
                1,
                PendingMutationKind::Revoke {
                    reason: RevocationReason::CapEviction,
                },
            )
            .unwrap();
        assert!(projection.compare_unmark_session(&a, &session_id).unwrap());
        assert!(
            !projection
                .test_act_is_admissible(&session_id, &incarnation, 1, 101, monotonic_now,)
                .unwrap()
        );
        assert!(projection.compare_unmark_session(&b, &session_id).unwrap());
        assert!(
            projection
                .test_act_is_admissible(&session_id, &incarnation, 1, 101, monotonic_now,)
                .unwrap()
        );
        projection.check_invariants().unwrap();
    }

    #[test]
    fn rotation_overlay_blocks_predecessor_until_exact_outcome() {
        let monotonic_now = Instant::now();
        let mut projection = rebuild_at(source(), monotonic_now);
        let session_id = only_session_id(&projection);
        let incarnation = projection.incarnation().clone();
        let predecessor = TokenDigest::from_slice(&[11; 32]).unwrap();
        let successor = TokenDigest::from_slice(&[12; 32]).unwrap();
        let rollback = projection
            .begin_session_mutation(
                &session_id,
                1,
                PendingMutationKind::TokenSupersede {
                    predecessor,
                    successor,
                    superseded_at_ms: 110,
                },
            )
            .unwrap();
        assert!(
            !projection
                .test_act_is_admissible(&session_id, &incarnation, 1, 101, monotonic_now,)
                .unwrap()
        );
        assert!(
            projection
                .compare_unmark_session(&rollback, &session_id)
                .unwrap()
        );
        assert!(matches!(
            projection.token_index.get(&predecessor),
            Some(ProjectedToken::Current { .. })
        ));

        let commit = projection
            .begin_session_mutation(
                &session_id,
                1,
                PendingMutationKind::TokenSupersede {
                    predecessor,
                    successor,
                    superseded_at_ms: 110,
                },
            )
            .unwrap();
        projection
            .finalize_token_rotation(&commit, &session_id)
            .unwrap();
        assert!(matches!(
            projection.token_index.get(&predecessor),
            Some(ProjectedToken::Superseded { .. })
        ));
        assert!(matches!(
            projection.token_index.get(&successor),
            Some(ProjectedToken::Current { .. })
        ));
        assert_eq!(
            projection.by_session[&session_id].current_token,
            Some(successor)
        );
        projection.check_invariants().unwrap();
    }

    #[test]
    fn stream_rotation_reuses_the_fence_and_invalidates_predecessor_authority() {
        let mut projection = rebuild_at(source(), Instant::now());
        let predecessor = projection.incarnation().clone();
        let predecessor_publication = projection.anonymous_publication_fence();
        let rollback_successor = AuthorizationStreamIncarnation::parse(&uuid_v7(19, 19)).unwrap();
        let rollback = projection
            .begin_stream_mutation(rollback_successor)
            .unwrap();
        assert!(
            predecessor_publication
                .try_publish(101, Instant::now(), || Ok(()))
                .unwrap()
                .is_none()
        );
        assert!(projection.compare_unmark_stream(&rollback).unwrap());
        assert!(
            predecessor_publication
                .try_publish(101, Instant::now(), || Ok(()))
                .unwrap()
                .is_some()
        );

        let successor = AuthorizationStreamIncarnation::parse(&uuid_v7(20, 20)).unwrap();
        let commit = projection.begin_stream_mutation(successor.clone()).unwrap();
        projection.finalize_stream_rotation(&commit).unwrap();
        assert!(
            predecessor_publication
                .try_publish(101, Instant::now(), || Ok(()))
                .unwrap()
                .is_none()
        );
        assert_eq!(projection.incarnation(), &successor);
        assert_ne!(projection.incarnation(), &predecessor);
        assert!(
            projection
                .anonymous_publication_fence()
                .try_publish(101, Instant::now(), || Ok(()))
                .unwrap()
                .is_some()
        );
        assert!(projection.by_session.is_empty());
        projection.check_invariants().unwrap();
    }

    #[test]
    fn ticket_counter_never_wraps() {
        let mut projection = rebuild_at(source(), Instant::now());
        let session_id = only_session_id(&projection);
        projection.set_next_ticket_for_test(NonZeroU64::new(u64::MAX));
        let last = projection
            .begin_session_mutation(
                &session_id,
                1,
                PendingMutationKind::Revoke {
                    reason: RevocationReason::Logout,
                },
            )
            .unwrap();
        projection
            .compare_unmark_session(&last, &session_id)
            .unwrap();
        assert_code(
            projection
                .begin_session_mutation(
                    &session_id,
                    1,
                    PendingMutationKind::Revoke {
                        reason: RevocationReason::Logout,
                    },
                )
                .unwrap_err(),
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
        );
    }
}
