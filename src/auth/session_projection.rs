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
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProjectionSource {
    pub authorization_stream_value: Vec<u8>,
    pub restore_declaration_id: Option<Vec<u8>>,
    pub users: Vec<ProjectionUserRow>,
    pub identities: Vec<ProjectionIdentityRow>,
    pub sessions: Vec<ProjectionSessionRow>,
    pub superseded_tokens: Vec<ProjectionTokenRow>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProjectionUserRow {
    pub id: String,
    pub created_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProjectionIdentityRow {
    pub id: String,
    pub user_id: String,
    pub provider: String,
    pub verified_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
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

#[derive(Clone, Debug, Eq, PartialEq)]
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
    Revoke { reason: RevocationReason },
    TokenSupersede { predecessor: TokenDigest },
    Expire,
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
enum ProjectedToken {
    Current {
        session_id: String,
    },
    Superseded {
        session_id: String,
        superseded_at_ms: u64,
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

    pub(crate) fn admits(
        &self,
        expected_generation: u64,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<bool> {
        let state = self.lock()?;
        Ok(state.generation == expected_generation
            && state.terminal.is_none()
            && state.pending_tickets.is_empty()
            && state.deadline.live_at(epoch_now_ms, monotonic_now))
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

    pub(crate) fn admits(
        &self,
        expected_incarnation: &AuthorizationStreamIncarnation,
    ) -> SnapbackResult<bool> {
        let state = self.lock()?;
        Ok(&state.incarnation == expected_incarnation && state.pending_tickets.is_empty())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum TicketOwner {
    Session(String),
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
            if !authority_instance_ids.insert(row.authority_instance_id) {
                return Err(projection_corrupt(
                    "duplicate projected authority-instance id",
                ));
            }
            let generation = u64::try_from(row.generation)
                .ok()
                .filter(|generation| *generation != 0)
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
                None
            };
            let session_id = row.id;
            let projected = ProjectedSession {
                session_id: session_id.clone(),
                user_id: row.user_id,
                provider: provider.clone(),
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
            if !all_digests.insert(digest)
                || token_index
                    .insert(
                        digest,
                        ProjectedToken::Superseded {
                            session_id: row.session_id,
                            superseded_at_ms,
                        },
                    )
                    .is_some()
            {
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

    pub(crate) fn act_is_admissible(
        &self,
        session_id: &str,
        expected_incarnation: &AuthorizationStreamIncarnation,
        expected_generation: u64,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<bool> {
        if !self.stream_fence.admits(expected_incarnation)? {
            return Ok(false);
        }
        let Some(session) = self.by_session.get(session_id) else {
            return Ok(false);
        };
        session
            .fence
            .admits(expected_generation, epoch_now_ms, monotonic_now)
    }

    /// Install a unique marker in both topology and leaf indexes. A sibling
    /// marker is allowed; it cannot be erased by this ticket's rollback.
    pub(crate) fn begin_session_mutation(
        &mut self,
        session_id: &str,
        expected_generation: u64,
        kind: PendingMutationKind,
    ) -> SnapbackResult<MutationTicket> {
        if !self.stream_fence.admits(&self.incarnation)? {
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
            if let PendingMutationKind::TokenSupersede { predecessor } = &kind {
                if session.current_token.as_ref() != Some(predecessor)
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
        self.token_index.remove(&current_token);
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
    ) -> SnapbackResult<()> {
        let (fence, deadline_key, current_token) = {
            let session = self.session_for_ticket(ticket, session_id)?;
            let pending = session
                .pending
                .get(ticket)
                .cloned()
                .ok_or_else(|| projection_unavailable("expiry ticket is not pending"))?;
            if pending.kind != PendingMutationKind::Expire
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
            )
        };
        let mut fence_state = fence.lock()?;
        if !fence_state.pending_tickets.contains(ticket) {
            return Err(projection_unavailable(
                "expiry ticket is absent from its leaf",
            ));
        }
        self.token_index.remove(&current_token);
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
        successor: TokenDigest,
        superseded_at_ms: u64,
    ) -> SnapbackResult<()> {
        validate_timestamp_u64(superseded_at_ms)?;
        let (fence, pending, predecessor) = {
            let session = self.session_for_ticket(ticket, session_id)?;
            let pending = session
                .pending
                .get(ticket)
                .cloned()
                .ok_or_else(|| projection_unavailable("rotation ticket is not pending"))?;
            let PendingMutationKind::TokenSupersede { predecessor } = pending.kind else {
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
            (Arc::clone(&session.fence), pending, predecessor)
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

    pub(crate) fn begin_stream_mutation(&mut self) -> SnapbackResult<MutationTicket> {
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
        let ticket = self.allocate_ticket()?;
        state.pending_tickets.insert(ticket.clone());
        self.ticket_index
            .insert(ticket.clone(), TicketOwner::Stream);
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
        Ok(true)
    }

    /// Finalize reset/restore on the existing shared stream-fence arc. Any
    /// predecessor grant that retained that arc now observes the successor
    /// incarnation and fails exact-incarnation validation.
    pub(crate) fn finalize_stream_rotation(
        &mut self,
        ticket: &MutationTicket,
        successor: AuthorizationStreamIncarnation,
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
        self.by_session.clear();
        self.token_index.clear();
        self.deadline_index.clear();
        self.ticket_index.remove(ticket);
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
        }
        drop(stream);

        for (session_id, session) in &self.by_session {
            if session_id != &session.session_id
                || session.user_id.is_empty()
                || session.provider.is_empty()
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
                .act_is_admissible(
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
                .act_is_admissible(
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
                .act_is_admissible(
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
                    .act_is_admissible(&session_id, &incarnation, 1, 101, monotonic_now,)
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
                    .act_is_admissible(&session_id, &incarnation, 2, 101, monotonic_now,)
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
                .act_is_admissible(&session_id, &incarnation, 1, 101, monotonic_now,)
                .unwrap()
        );
        assert!(projection.compare_unmark_session(&b, &session_id).unwrap());
        assert!(
            projection
                .act_is_admissible(&session_id, &incarnation, 1, 101, monotonic_now,)
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
                PendingMutationKind::TokenSupersede { predecessor },
            )
            .unwrap();
        assert!(
            !projection
                .act_is_admissible(&session_id, &incarnation, 1, 101, monotonic_now,)
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
                PendingMutationKind::TokenSupersede { predecessor },
            )
            .unwrap();
        projection
            .finalize_token_rotation(&commit, &session_id, successor, 110)
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
        let shared = projection.stream_fence();
        let rollback = projection.begin_stream_mutation().unwrap();
        assert!(!shared.admits(&predecessor).unwrap());
        assert!(projection.compare_unmark_stream(&rollback).unwrap());
        assert!(shared.admits(&predecessor).unwrap());

        let commit = projection.begin_stream_mutation().unwrap();
        let successor = AuthorizationStreamIncarnation::parse(&uuid_v7(20, 20)).unwrap();
        projection
            .finalize_stream_rotation(&commit, successor.clone())
            .unwrap();
        assert!(!shared.admits(&predecessor).unwrap());
        assert!(shared.admits(&successor).unwrap());
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
