//! Database-bound protected-room authority and authorization commit settlement.
//!
//! Queue ownership, subscriber policy, resync materialization, and transport
//! handoff remain in `snapback-sync`; this module owns the authority facts and
//! the finite admission/settlement operations over them.

use super::{
    AuthorizationCommitImpact, AuthorizationCommitPreflight, AuthorizationCommitWitness,
    AuthorizationInterlockState, AuthorizationVersion, ChangedRow, DatabaseBinding,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::ephemeral::{
    AccessPolicy, AuthContext, ConnectionEffectFence, ConnectionId, DurableMessage,
    EphemeralCollection, EphemeralError, EphemeralErrorCode, EphemeralMessage, RealtimeEnvelope,
    ResyncReason, RoomId, RoomPermissionProjection, Scope, validate_collection_definitions,
};
use crate::manifest::{PORTABLE_STORAGE_VERSION_MAX, SchemaManifest};
use crate::process_bound_identity::ProcessBoundIdentity;
use rusqlite::{Connection, OptionalExtension as _, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock, PoisonError, Weak};

const ACTIVATION_PENDING: u8 = 0;
const ACTIVATION_BOUND: u8 = 1;
const ACTIVATION_READY: u8 = 2;
const ACTIVATION_RETIRED: u8 = 3;
const ROOM_REAUTHORIZATION_ACTIVE: u8 = 0;
const ROOM_REAUTHORIZATION_COMPLETE: u8 = 1;
const ROOM_REAUTHORIZATION_MISSING: u8 = 2;
const ROOM_REAUTHORIZATION_ABANDONED: u8 = 3;
const ROOM_REAUTHORIZATION_SETTLING: u8 = 4;

pub(super) struct AuthorizationParticipantActivation {
    // @ref LLP 0303#t-allocation-identity-fails-open-across-fork-and-the-ruling-belongs-here
    // — consumers compare through the current-process-aware identity instead
    // of exposing this allocation.
    identity: ProcessBoundIdentity,
    state: AtomicU8,
    projection_available: AtomicBool,
    projection: Mutex<AuthorizationProjectionState>,
    #[cfg(any(test, feature = "test-support"))]
    fail_next_outcome_observation: AtomicBool,
    #[cfg(any(test, feature = "test-support"))]
    fail_next_issuer_projection: AtomicBool,
}

struct AuthorizationProjectionState {
    epoch: u64,
    carrier: Option<Weak<AuthorizationIssuerProjectionIdentity>>,
    failure: Option<SnapbackError>,
}

impl AuthorizationParticipantActivation {
    pub(super) fn pending() -> Self {
        Self {
            identity: ProcessBoundIdentity::new(),
            state: AtomicU8::new(ACTIVATION_PENDING),
            projection_available: AtomicBool::new(false),
            projection: Mutex::new(AuthorizationProjectionState {
                epoch: 1,
                carrier: None,
                failure: None,
            }),
            #[cfg(any(test, feature = "test-support"))]
            fail_next_outcome_observation: AtomicBool::new(false),
            #[cfg(any(test, feature = "test-support"))]
            fail_next_issuer_projection: AtomicBool::new(false),
        }
    }

    fn state(&self) -> u8 {
        self.state.load(Ordering::Acquire)
    }

    pub(super) fn is_same_instance(&self, other: &Self) -> bool {
        self.identity == other.identity
    }

    pub(super) fn transition(&self, from: u8, to: u8) -> SnapbackResult<()> {
        self.state
            .compare_exchange(from, to, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ())
            .map_err(|_| participant_state_error("authorization participant activation changed"))
    }

    pub(super) fn retire(&self) {
        let mut projection = self
            .projection
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        self.projection_available.store(false, Ordering::Release);
        projection.carrier = None;
        self.state.store(ACTIVATION_RETIRED, Ordering::Release);
    }

    pub(super) fn bind(&self) -> SnapbackResult<()> {
        self.transition(ACTIVATION_PENDING, ACTIVATION_BOUND)
    }

    pub(super) fn ready(&self) -> SnapbackResult<()> {
        self.transition(ACTIVATION_BOUND, ACTIVATION_READY)
    }

    pub(super) fn is_ready(&self) -> bool {
        self.state() == ACTIVATION_READY
    }

    pub(super) fn enable_projection(
        &self,
        projection: &AuthorizationIssuerProjection,
    ) -> SnapbackResult<()> {
        if !std::ptr::eq(Arc::as_ptr(&projection.identity.view.activation), self) {
            return Err(participant_registry_mismatch());
        }
        let mut state = self
            .projection
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if !self.is_ready() {
            return Err(participant_state_error(
                "authorization projection cannot activate before the participant is ready",
            ));
        }
        if let Some(failure) = state.failure.clone() {
            return Err(failure);
        }
        if projection.identity.view.projection_epoch != state.epoch {
            return Err(projection_unavailable(
                "authorization issuer projection was invalidated by issuer suspension",
            ));
        }
        state.carrier = Some(Arc::downgrade(&projection.identity));
        self.projection_available.store(true, Ordering::Release);
        Ok(())
    }

    pub(super) fn projection_available(&self) -> bool {
        self.projection_available.load(Ordering::Acquire)
    }

    fn projection_epoch(&self) -> u64 {
        self.projection
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .epoch
    }

    pub(super) fn suspend_projection(&self) {
        let mut projection = self
            .projection
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        self.projection_available.store(false, Ordering::Release);
        projection.carrier = None;
        if let Some(next_epoch) = projection.epoch.checked_add(1) {
            projection.epoch = next_epoch;
        } else {
            projection.failure = Some(projection_unavailable(
                "authorization issuer projection suspension epoch exhausted",
            ));
        }
    }

    pub(super) fn require_projection(
        &self,
        registry: &Arc<RoomAuthorityRegistry>,
    ) -> SnapbackResult<()> {
        self.require_projection_identity(registry).map(drop)
    }

    /// Revalidate the live issuer carrier. Transaction bind deliberately calls
    /// this after `IMMEDIATE`, so its projection -> registry order is one of
    /// LLP 0290 §7.1's two explicit SQLite-first overlaps.
    fn require_projection_identity(
        &self,
        registry: &Arc<RoomAuthorityRegistry>,
    ) -> SnapbackResult<Arc<AuthorizationIssuerProjectionIdentity>> {
        let state = self
            .projection
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if let Some(failure) = state.failure.clone() {
            return Err(failure);
        }
        if !self.projection_available() {
            return Err(projection_unavailable(
                "authorization commit issuer projection is unavailable",
            ));
        }
        let projection = state
            .carrier
            .as_ref()
            .and_then(Weak::upgrade)
            .ok_or_else(|| {
                projection_unavailable("authorization commit issuer projection is no longer live")
            })?;
        if !std::ptr::eq(Arc::as_ptr(&projection.view.activation), self)
            || !Arc::ptr_eq(&projection.view.registry, registry)
            || projection.view.registry_generation != registry.generation()
            || projection.view.projection_epoch != state.epoch
        {
            return Err(projection_unavailable(
                "authorization commit issuer projection belongs to another registry or suspension epoch",
            ));
        }
        let projected = registry.lock().projected_authorization.clone();
        if projected.as_ref().map(|value| value.incarnation.as_str())
            != Some(projection.view.issuer_incarnation.as_ref())
        {
            return Err(projection_unavailable(
                "authorization commit issuer projection belongs to another incarnation",
            ));
        }
        Ok(projection)
    }

    fn fail_closed(&self, error: SnapbackError) -> SnapbackError {
        let mut projection = self
            .projection
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if let Some(failure) = projection.failure.clone() {
            return failure;
        }
        let error = SnapbackError::error(
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
            "auth",
            format!(
                "authorization commit finalization failed closed after the durable commit: {} ({})",
                error.diagnostic.message, error.diagnostic.code
            ),
        );
        self.projection_available.store(false, Ordering::Release);
        projection.carrier = None;
        projection.epoch = projection.epoch.saturating_add(1);
        projection.failure = Some(error.clone());
        error
    }

    #[cfg(any(test, feature = "test-support"))]
    fn inject_outcome_observation_failure(&self) {
        self.fail_next_outcome_observation
            .store(true, Ordering::Release);
    }

    #[cfg(any(test, feature = "test-support"))]
    fn take_outcome_observation_failure(&self) -> bool {
        self.fail_next_outcome_observation
            .swap(false, Ordering::AcqRel)
    }

    #[cfg(any(test, feature = "test-support"))]
    fn inject_issuer_projection_failure(&self) {
        self.fail_next_issuer_projection
            .store(true, Ordering::Release);
    }

    #[cfg(any(test, feature = "test-support"))]
    fn take_issuer_projection_failure(&self) -> bool {
        self.fail_next_issuer_projection
            .swap(false, Ordering::AcqRel)
    }
}

pub struct PendingRoomReauthorization {
    root: Arc<RoomAuthorityRegistry>,
    room: RoomId,
    obligation: RoomAuthorityResync,
    collection: EphemeralCollection,
}

impl PendingRoomReauthorization {
    pub fn room(&self) -> &RoomId {
        &self.room
    }

    pub fn obligation(&self) -> &RoomAuthorityResync {
        &self.obligation
    }
}

/// The identity captured by pending-room enumeration. This is deliberately a
/// different type from the publicly constructible ordinary-operation
/// [`AuthContext`]: resolution accepts no caller-built authorization answer.
pub enum RoomReauthorizationSubject {
    Unauthenticated,
    User { user_id: String },
    Session { session_id: String, generation: u64 },
}

impl RoomReauthorizationSubject {
    pub fn unauthenticated() -> Self {
        Self::Unauthenticated
    }

    pub fn user(user_id: String) -> Self {
        Self::User { user_id }
    }

    pub fn session(session_id: String, generation: u64) -> Self {
        Self::Session {
            session_id,
            generation,
        }
    }
}

/// One exact snapshotted subscriber paired with the identity that pending
/// enumeration derived from the installed subscriber and its effect fence.
pub struct RoomReauthorizationSubscriber {
    connection_id: ConnectionId,
    effect_fence: Option<ConnectionEffectFence>,
    subject: RoomReauthorizationSubject,
}

impl RoomReauthorizationSubscriber {
    pub fn new(
        connection_id: ConnectionId,
        effect_fence: Option<ConnectionEffectFence>,
        subject: RoomReauthorizationSubject,
    ) -> Self {
        Self {
            connection_id,
            effect_fence,
            subject,
        }
    }
}

/// A database-derived decision for one exact pending subscriber. The fields
/// and constructor remain kernel-private, so a caller can inspect but cannot
/// synthesize a decision that completion will accept.
pub struct ResolvedRoomSubscriberReauthorization {
    connection_id: ConnectionId,
    expected_effect_fence: Option<ConnectionEffectFence>,
    subject: RoomReauthorizationSubject,
    authorized_auth: Option<AuthContext>,
}

impl ResolvedRoomSubscriberReauthorization {
    pub fn connection_id(&self) -> &ConnectionId {
        &self.connection_id
    }

    pub fn expected_effect_fence(&self) -> Option<&ConnectionEffectFence> {
        self.expected_effect_fence.as_ref()
    }

    pub fn authorized_auth(&self) -> Option<&AuthContext> {
        self.authorized_auth.as_ref()
    }
}

/// The only carrier admitted to protected-room reauthorization completion.
/// It is rooted in the exact room-authority registry and contains only
/// database-derived subscriber decisions. It deliberately implements neither
/// `Clone` nor serialization.
///
/// @ref LLP 0303#corollary--the-artifact-must-carry-provenance-not-just-type —
/// instance provenance travels with the fact instead of being supplied beside
/// it at completion.
pub struct ResolvedRoomReauthorizationBatch {
    root: Arc<RoomAuthorityRegistry>,
    room: RoomId,
    generation: u64,
    collection: EphemeralCollection,
    min_commit_version: u64,
    resolutions: Vec<ResolvedRoomSubscriberReauthorization>,
}

impl ResolvedRoomReauthorizationBatch {
    pub fn room(&self) -> &RoomId {
        &self.room
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }
}

fn resolve_room_reauthorization_subject_on(
    connection: &Connection,
    schema: &SchemaManifest,
    projection: &RoomPermissionProjection,
    scope_fields: &[(String, String)],
    collection: &EphemeralCollection,
    room: &RoomId,
    min_commit_version: u64,
    subject: &RoomReauthorizationSubject,
) -> SnapbackResult<Option<AuthContext>> {
    let (durable_user_id, session_id) = match subject {
        RoomReauthorizationSubject::Unauthenticated => (None, None),
        RoomReauthorizationSubject::User { user_id } => (Some(user_id.clone()), None),
        RoomReauthorizationSubject::Session {
            session_id,
            generation,
        } => {
            let generation = i64::try_from(*generation).ok();
            let durable_user_id = match generation {
                Some(generation) => {
                    let floor_ms =
                        i64::try_from(super::auth::read_session_clock_floor_on(connection)?)
                            .unwrap_or(i64::MAX);
                    connection
                        .query_row(
                            "SELECT session.user_id
                             FROM _auth_sessions AS session
                             JOIN _auth_users AS user ON user.id = session.user_id
                             WHERE session.id = ?1
                               AND session.generation = ?2
                               AND session.revoked_at_ms IS NULL
                               AND session.expires_at_ms > ?3
                               AND session.absolute_expires_at_ms > ?3
                               AND user.deactivated_at_ms IS NULL",
                            params![session_id, generation, floor_ms],
                            |row| row.get::<_, String>(0),
                        )
                        .optional()?
                }
                None => None,
            };
            (durable_user_id, Some(session_id.clone()))
        }
    };
    // Even an internally enumerated userless/terminal subject runs the
    // durable membership read. Its absence is not a caller-provided denial
    // answer, and one malformed subscriber therefore cannot wedge the
    // legitimate room's retryable completion forever.
    let granted = super::room_permission_projection_granted_on(
        connection,
        schema,
        &projection.table,
        &projection.subject_field,
        durable_user_id.as_deref().unwrap_or(""),
        scope_fields,
        projection.role_field.as_deref(),
        projection.allowed_roles.as_deref(),
        min_commit_version,
    )?;
    Ok(durable_user_id.filter(|_| granted).map(|user_id| {
        let fresh = AuthContext {
            principal: None,
            session_id,
            user_id: Some(user_id.clone()),
            permissions: BTreeSet::new(),
            stream_initiator: Some(crate::stream_attempt::StreamInitiator::SessionUser(user_id)),
        };
        collection.grant_projected_room_permission(fresh, &room.scope)
    }))
}

impl AuthorizationCommitParticipant {
    /// Resolve every internally enumerated room subscriber against this exact
    /// participant and serving database, returning a registry-bound completion
    /// carrier. The live participant is privately held by the ephemeral
    /// backend; an obtainable pending observation is insufficient by itself.
    ///
    /// @ref LLP 0303#the-governing-principle — the subscriber subject comes
    /// from pending enumeration and the resulting context is database-derived,
    /// never supplied alongside the pending authority.
    pub fn resolve_room_reauthorization(
        &self,
        database: &super::ServingDatabase,
        pending: PendingRoomReauthorization,
        subscribers: Vec<RoomReauthorizationSubscriber>,
    ) -> SnapbackResult<ResolvedRoomReauthorizationBatch> {
        if !Arc::ptr_eq(&self.registry, &pending.root)
            || !pending.root.binding_matches(&database.binding())
        {
            return Err(participant_database_mismatch());
        }
        let projection = pending
            .collection
            .permission_backing
            .as_ref()
            .ok_or_else(|| {
                projection_unavailable(
                    "pending protected room lacks its durable permissionBacking projection",
                )
            })?;
        let scope_fields = projection
            .scope_fields
            .iter()
            .map(|(scope_field, table_field)| {
                pending
                    .room
                    .scope
                    .get(scope_field)
                    .map(|value| (table_field.clone(), value.to_owned()))
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_EPHEMERAL_INVALID_SCOPE",
                            "ephemeral",
                            "room scope does not satisfy its permissionBacking projection",
                        )
                    })
            })
            .collect::<SnapbackResult<Vec<_>>>()?;
        let mut resolutions = Vec::with_capacity(subscribers.len());
        for subscriber in subscribers {
            let (durable_user_id, session_id) = match &subscriber.subject {
                RoomReauthorizationSubject::Unauthenticated => (None, None),
                RoomReauthorizationSubject::User { user_id } => (Some(user_id.clone()), None),
                RoomReauthorizationSubject::Session {
                    session_id,
                    generation,
                } => {
                    let generation = i64::try_from(*generation).ok();
                    let durable_user_id = match generation {
                        Some(generation) => database.db.with_auth_read(|connection| {
                            let floor_ms = i64::try_from(super::auth::read_session_clock_floor_on(
                                connection,
                            )?)
                            .unwrap_or(i64::MAX);
                            Ok(connection
                                .query_row(
                                    "SELECT session.user_id
                                     FROM _auth_sessions AS session
                                     JOIN _auth_users AS user ON user.id = session.user_id
                                     WHERE session.id = ?1
                                       AND session.generation = ?2
                                       AND session.revoked_at_ms IS NULL
                                       AND session.expires_at_ms > ?3
                                       AND session.absolute_expires_at_ms > ?3
                                       AND user.deactivated_at_ms IS NULL",
                                    params![session_id, generation, floor_ms],
                                    |row| row.get::<_, String>(0),
                                )
                                .optional()?)
                        })?,
                        None => None,
                    };
                    (durable_user_id, Some(session_id.clone()))
                }
            };
            // Even an internally enumerated userless/terminal subject runs the
            // durable membership read. Its absence is not a caller-provided
            // denial answer, and one malformed subscriber therefore cannot
            // wedge the legitimate room's retryable completion forever.
            let granted = database.db.room_permission_projection_granted(
                &projection.table,
                &projection.subject_field,
                durable_user_id.as_deref().unwrap_or(""),
                &scope_fields,
                projection.role_field.as_deref(),
                projection.allowed_roles.as_deref(),
                pending.obligation.min_commit_version,
            )?;
            let authorized_auth = durable_user_id.filter(|_| granted).map(|user_id| {
                let fresh = AuthContext {
                    principal: None,
                    session_id,
                    user_id: Some(user_id.clone()),
                    permissions: BTreeSet::new(),
                    stream_initiator: Some(crate::stream_attempt::StreamInitiator::SessionUser(
                        user_id,
                    )),
                };
                pending
                    .collection
                    .grant_projected_room_permission(fresh, &pending.room.scope)
            });
            resolutions.push(ResolvedRoomSubscriberReauthorization {
                connection_id: subscriber.connection_id,
                expected_effect_fence: subscriber.effect_fence,
                subject: subscriber.subject,
                authorized_auth,
            });
        }
        Ok(ResolvedRoomReauthorizationBatch {
            root: self.registry.clone(),
            room: pending.room,
            generation: pending.obligation.room_authority_generation,
            collection: pending.collection,
            min_commit_version: pending.obligation.min_commit_version,
            resolutions,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoomAuthorityResync {
    pub authorization: AuthorizationVersion,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub min_commit_version: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub room_authority_generation: u64,
}

#[derive(Clone, Debug, Default)]
pub(super) struct RoomDependencySelector {
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

    fn covers(&self, other: &Self) -> bool {
        self.all_protected_rooms
            || (!other.all_protected_rooms
                && other
                    .collections
                    .iter()
                    .all(|collection| self.collections.contains(collection))
                && other.rooms.iter().all(|room| {
                    self.collections.contains(&room.collection) || self.rooms.contains(room)
                }))
    }
}

#[derive(Debug)]
struct KnownAuthorizationCommit {
    sequence: u64,
    predecessor: Option<AuthorizationVersion>,
    authorization: AuthorizationVersion,
    min_commit_version: u64,
    incarnation_rotated: bool,
    issuer_projected: AtomicBool,
}

#[derive(Clone, Debug)]
pub(super) struct RoomDependencyTicket {
    ticket_id: u64,
    outcome_sequence: u64,
    expected_authorization: Arc<OnceLock<AuthorizationVersion>>,
    known_commit: Arc<OnceLock<KnownAuthorizationCommit>>,
    registry_generation: u64,
}

#[derive(Clone, Debug)]
struct RoomDependencyPending {
    expected_authorization: Arc<OnceLock<AuthorizationVersion>>,
    known_commit: Arc<OnceLock<KnownAuthorizationCommit>>,
    selector: RoomDependencySelector,
    affected_rooms: BTreeSet<RoomId>,
}

#[derive(Clone, Debug)]
struct RoomAuthorityControl {
    generation: u64,
    active_permits: usize,
    pending_tickets: BTreeSet<u64>,
    resync: Option<RoomAuthorityResync>,
    reauthorization_completion: Option<Arc<RoomReauthorizationCompletionState>>,
    retired: bool,
}

impl Default for RoomAuthorityControl {
    fn default() -> Self {
        Self {
            generation: 1,
            active_permits: 0,
            pending_tickets: BTreeSet::new(),
            resync: None,
            reauthorization_completion: None,
            retired: false,
        }
    }
}

#[derive(Debug)]
struct RoomReauthorizationCompletionState {
    disposition: AtomicU8,
}

impl RoomReauthorizationCompletionState {
    fn active() -> Arc<Self> {
        Arc::new(Self {
            disposition: AtomicU8::new(ROOM_REAUTHORIZATION_ACTIVE),
        })
    }
}

struct RoomAuthorityRegistryState {
    next_ticket: u64,
    dependencies: BTreeMap<u64, RoomDependencyPending>,
    rooms: BTreeMap<RoomId, RoomAuthorityControl>,
    durable_authorization: Option<AuthorizationVersion>,
    projected_authorization: Option<AuthorizationVersion>,
    projected_commits: BTreeMap<u64, AuthorizationVersion>,
    active_operations: usize,
    active_durable_publications: usize,
    protected_collections: Arc<[EphemeralCollection]>,
    protected_collection_revision: u64,
    next_outcome_sequence: u64,
    latest_committed_outcome: Option<AuthorizationCommitOutcome>,
}

pub(super) struct RoomAuthorityRegistry {
    // @ref LLP 0303#t-allocation-identity-fails-open-across-fork-and-the-ruling-belongs-here
    // — database participant installation refuses registry handles inherited
    // from a creator process.
    identity: ProcessBoundIdentity,
    binding: DatabaseBinding,
    generation: AtomicU64,
    retired: AtomicBool,
    catalog_revision: AtomicU64,
    state: Mutex<RoomAuthorityRegistryState>,
    quiescent: Condvar,
    #[cfg(test)]
    completion_registry_acquired_witness:
        Mutex<Option<(Arc<std::sync::Barrier>, Arc<std::sync::Barrier>)>>,
    #[cfg(test)]
    completion_before_settlement_claim_witness:
        Mutex<Option<(Arc<std::sync::Barrier>, Arc<std::sync::Barrier>)>>,
    #[cfg(any(test, feature = "test-support"))]
    authorization_writer_settlement_wait_witness: Mutex<Option<std::sync::mpsc::Sender<()>>>,
}

impl RoomAuthorityRegistry {
    pub(super) fn new(binding: DatabaseBinding) -> Arc<Self> {
        Self::new_with_generation(binding, 1)
    }

    pub(super) fn new_with_generation(binding: DatabaseBinding, generation: u64) -> Arc<Self> {
        Arc::new(Self {
            identity: ProcessBoundIdentity::new(),
            binding,
            generation: AtomicU64::new(generation),
            retired: AtomicBool::new(false),
            catalog_revision: AtomicU64::new(1),
            state: Mutex::new(RoomAuthorityRegistryState {
                next_ticket: 1,
                dependencies: BTreeMap::new(),
                rooms: BTreeMap::new(),
                durable_authorization: None,
                projected_authorization: None,
                projected_commits: BTreeMap::new(),
                active_operations: 0,
                active_durable_publications: 0,
                protected_collections: Arc::from([]),
                protected_collection_revision: 1,
                next_outcome_sequence: 1,
                latest_committed_outcome: None,
            }),
            quiescent: Condvar::new(),
            #[cfg(test)]
            completion_registry_acquired_witness: Mutex::new(None),
            #[cfg(test)]
            completion_before_settlement_claim_witness: Mutex::new(None),
            #[cfg(any(test, feature = "test-support"))]
            authorization_writer_settlement_wait_witness: Mutex::new(None),
        })
    }

    fn lock(&self) -> MutexGuard<'_, RoomAuthorityRegistryState> {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        reconcile_room_reauthorization_completions(&mut state);
        state
    }

    #[cfg(any(test, feature = "test-support"))]
    fn install_authorization_writer_settlement_wait_witness(
        &self,
        waiting: std::sync::mpsc::Sender<()>,
    ) {
        let previous = self
            .authorization_writer_settlement_wait_witness
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .replace(waiting);
        assert!(previous.is_none(), "writer-settlement witness is one-shot");
    }

    #[cfg(any(test, feature = "test-support"))]
    fn witness_authorization_writer_waiting_for_settlement(&self) {
        let waiting = self
            .authorization_writer_settlement_wait_witness
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(waiting) = waiting {
            waiting
                .send(())
                .expect("writer-settlement observer remains alive");
        }
    }

    #[cfg(test)]
    fn install_completion_registry_acquired_witness(
        &self,
        acquired: Arc<std::sync::Barrier>,
        proceed: Arc<std::sync::Barrier>,
    ) {
        *self
            .completion_registry_acquired_witness
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some((acquired, proceed));
    }

    #[cfg(test)]
    fn witness_completion_registry_acquired(&self) {
        let witness = self
            .completion_registry_acquired_witness
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some((acquired, proceed)) = witness {
            acquired.wait();
            proceed.wait();
        }
    }

    #[cfg(test)]
    fn install_completion_before_settlement_claim_witness(
        &self,
        reached: Arc<std::sync::Barrier>,
        proceed: Arc<std::sync::Barrier>,
    ) {
        *self
            .completion_before_settlement_claim_witness
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some((reached, proceed));
    }

    #[cfg(test)]
    fn witness_completion_before_settlement_claim(&self) {
        let witness = self
            .completion_before_settlement_claim_witness
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some((reached, proceed)) = witness {
            reached.wait();
            proceed.wait();
        }
    }

    pub(super) fn binding_matches(&self, binding: &DatabaseBinding) -> bool {
        self.binding.matches(binding)
    }

    pub(super) fn is_same_instance(&self, other: &Self) -> bool {
        self.identity == other.identity
    }

    pub(super) fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    pub(super) fn is_retired(&self) -> bool {
        self.retired.load(Ordering::Acquire)
    }

    pub(super) fn retire(&self) -> SnapbackResult<()> {
        // Replacement participates in the registry mutex so every finite
        // admission either linearizes before retirement or observes it. Wait
        // only for operations that already crossed that cut; merely holding
        // an issued permit does not wedge same-database replacement.
        //
        // @ref LLP 0290#46-same-database-replacement — old permits and guards
        // fail closed once replacement returns.
        let mut state = self.lock();
        if state
            .dependencies
            .values()
            .any(|pending| pending.known_commit.get().is_some())
        {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_PARTICIPANT_DEPENDENCY_PENDING",
                "auth",
                "authorization participant has a committed dependency awaiting its deferred finalizer",
            ));
        }
        while state.rooms.values().any(|control| {
            control
                .reauthorization_completion
                .as_ref()
                .is_some_and(|completion| {
                    completion.disposition.load(Ordering::Acquire) == ROOM_REAUTHORIZATION_SETTLING
                })
        }) {
            state = self
                .quiescent
                .wait(state)
                .unwrap_or_else(PoisonError::into_inner);
            reconcile_room_reauthorization_completions(&mut state);
        }
        self.retired.store(true, Ordering::Release);
        for control in state.rooms.values_mut() {
            abandon_room_reauthorization_completion(control);
        }
        self.quiescent.notify_all();
        while state.active_operations != 0 {
            state = self
                .quiescent
                .wait(state)
                .unwrap_or_else(PoisonError::into_inner);
        }
        Ok(())
    }
}

fn abandon_room_reauthorization_completion(control: &mut RoomAuthorityControl) {
    let Some(completion) = control.reauthorization_completion.take() else {
        return;
    };
    let _ = completion.disposition.compare_exchange(
        ROOM_REAUTHORIZATION_ACTIVE,
        ROOM_REAUTHORIZATION_ABANDONED,
        Ordering::AcqRel,
        Ordering::Acquire,
    );
}

fn reconcile_room_reauthorization_completions(state: &mut RoomAuthorityRegistryState) {
    let mut remove = Vec::new();
    for (room, control) in &mut state.rooms {
        let Some(completion) = control.reauthorization_completion.as_ref() else {
            continue;
        };
        match completion.disposition.load(Ordering::Acquire) {
            ROOM_REAUTHORIZATION_ACTIVE => {}
            ROOM_REAUTHORIZATION_SETTLING => {}
            ROOM_REAUTHORIZATION_COMPLETE => {
                control.resync = None;
                control.reauthorization_completion = None;
            }
            ROOM_REAUTHORIZATION_MISSING => {
                if control.pending_tickets.is_empty() && control.active_permits == 0 {
                    remove.push(room.clone());
                }
                control.reauthorization_completion = None;
            }
            ROOM_REAUTHORIZATION_ABANDONED => {
                control.reauthorization_completion = None;
            }
            _ => unreachable!("room reauthorization disposition is kernel-minted"),
        }
    }
    for room in remove {
        state.rooms.remove(&room);
    }
}

struct RegistryOperationGuard {
    registry: Arc<RoomAuthorityRegistry>,
}

impl Drop for RegistryOperationGuard {
    fn drop(&mut self) {
        let mut state = self.registry.lock();
        state.active_operations = state.active_operations.saturating_sub(1);
        self.registry.quiescent.notify_all();
    }
}

pub struct RoomAuthorityOperationGuard {
    _operation: RegistryOperationGuard,
    generation: u64,
}

impl RoomAuthorityOperationGuard {
    pub fn generation(&self) -> u64 {
        self.generation
    }
}

pub struct RealtimePublicationHandoff {
    _operation: RegistryOperationGuard,
}

#[derive(Clone)]
pub struct RealtimePublicationValidity {
    registry: Arc<RoomAuthorityRegistry>,
    room: Option<(RoomId, u64)>,
}

/// The database-bound room-authority participant.
///
/// Its fields, constructor, transaction bind, and settlement operations are
/// kernel-private. Public methods expose only finite admission and observation
/// operations; callers cannot mint terminal facts.
///
/// @ref LLP 0290#31-authorizationcommitparticipant — exact private custody and non-forgeability.
pub struct AuthorizationCommitParticipant {
    binding: DatabaseBinding,
    registry: Arc<RoomAuthorityRegistry>,
    registry_generation: u64,
    activation: Arc<AuthorizationParticipantActivation>,
    room_reauthorization_settler: OnceLock<Arc<dyn RoomReauthorizationSettlementExecutor>>,
}

impl AuthorizationCommitParticipant {
    pub(super) fn new(
        binding: DatabaseBinding,
        registry: Arc<RoomAuthorityRegistry>,
        registry_generation: u64,
        activation: Arc<AuthorizationParticipantActivation>,
    ) -> Self {
        Self {
            binding,
            registry,
            registry_generation,
            activation,
            room_reauthorization_settler: OnceLock::new(),
        }
    }

    /// Install the sync-owned settlement implementation before this
    /// participant is bound to its database. Completion later invokes only
    /// this participant-bound implementation; callers cannot substitute code
    /// or a terminal disposition at the completion call site.
    #[doc(hidden)]
    pub fn install_room_reauthorization_settler(
        &self,
        settler: Arc<dyn RoomReauthorizationSettlementExecutor>,
    ) -> SnapbackResult<()> {
        if self.activation.state() != ACTIVATION_PENDING {
            return Err(participant_state_error(
                "room reauthorization settlement must be installed before participant binding",
            ));
        }
        self.room_reauthorization_settler.set(settler).map_err(|_| {
            participant_state_error(
                "room reauthorization settlement was already installed for this participant",
            )
        })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn install_authorization_writer_settlement_wait_witness_for_test(
        &self,
        waiting: std::sync::mpsc::Sender<()>,
    ) {
        self.registry
            .install_authorization_writer_settlement_wait_witness(waiting);
    }

    pub(super) fn binding(&self) -> &DatabaseBinding {
        &self.binding
    }

    pub(super) fn registry(&self) -> &Arc<RoomAuthorityRegistry> {
        &self.registry
    }

    pub(super) fn registry_generation(&self) -> u64 {
        self.registry_generation
    }

    pub(super) fn activation(&self) -> &Arc<AuthorizationParticipantActivation> {
        &self.activation
    }

    /// Close authorization commits before the issuer projection is removed.
    /// This is a denial-only transition: only the database-validated activation
    /// path can make projection available again.
    ///
    /// @ref LLP 0290#44-auth-time-activation — a ready transaction participant
    /// requires a live issuer projection, including across reset rebuilds.
    pub fn suspend_authorization_projection(&self) {
        self.activation.suspend_projection();
    }

    /// Convert a post-commit issuer-observation/projection failure into the
    /// same sticky denial used by kernel settlement failure. This transition
    /// is monotone: callers can close authorization projection but only the
    /// database-validated activation path can install a successor projection.
    pub fn fail_closed_authorization_projection(&self, error: SnapbackError) -> SnapbackError {
        self.activation.fail_closed(error)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn inject_outcome_observation_failure(&self) {
        self.activation.inject_outcome_observation_failure();
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn inject_issuer_projection_failure(&self) {
        self.activation.inject_issuer_projection_failure();
    }

    fn require_live_locked(&self, allow_bound: bool) -> Result<(), EphemeralError> {
        let state = self.activation.state();
        if self.registry.is_retired()
            || self.registry.generation() != self.registry_generation
            || state == ACTIVATION_RETIRED
            || (state != ACTIVATION_READY && !(allow_bound && state == ACTIVATION_BOUND))
        {
            return Err(authority_pending_error());
        }
        Ok(())
    }

    fn begin_operation_locked(
        &self,
        state: &mut RoomAuthorityRegistryState,
    ) -> Result<RegistryOperationGuard, EphemeralError> {
        state.active_operations = state
            .active_operations
            .checked_add(1)
            .ok_or_else(authority_pending_error)?;
        Ok(RegistryOperationGuard {
            registry: self.registry.clone(),
        })
    }

    pub fn replace_protected_room_catalog(
        &self,
        definitions: &[EphemeralCollection],
    ) -> Result<u64, EphemeralError> {
        validate_collection_definitions(definitions)?;
        let protected = definitions
            .iter()
            .filter(|definition| collection_requires_room_permission(definition))
            .cloned()
            .collect::<Vec<_>>();
        let mut state = self.registry.lock();
        self.require_live_locked(true)?;
        let revision = state
            .protected_collection_revision
            .checked_add(1)
            .ok_or_else(generation_exhausted_error)?;
        state.protected_collections = Arc::from(protected);
        state.protected_collection_revision = revision;
        self.registry
            .catalog_revision
            .store(revision, Ordering::Release);
        Ok(revision)
    }

    pub fn begin_protected_room_act(
        &self,
        room: &RoomId,
    ) -> Result<RoomAuthorityPermit, EphemeralError> {
        let mut state = self.registry.lock();
        self.require_live_locked(true)?;
        validate_registered_room(&state.protected_collections, room)?;
        if state
            .dependencies
            .values()
            .any(|pending| pending.selector.matches(room))
        {
            return Err(authority_pending_error());
        }
        let control = state.rooms.entry(room.clone()).or_default();
        if control.retired || !control.pending_tickets.is_empty() || control.resync.is_some() {
            return Err(authority_pending_error());
        }
        control.active_permits = control.active_permits.checked_add(1).ok_or_else(|| {
            EphemeralError::new(
                EphemeralErrorCode::AuthorityPending,
                "protected room authority permit count exhausted",
            )
        })?;
        Ok(RoomAuthorityPermit {
            registry: self.registry.clone(),
            room: room.clone(),
            generation: control.generation,
        })
    }

    pub fn begin_protected_room_operation(
        &self,
        room: &RoomId,
    ) -> Result<RoomAuthorityOperationGuard, EphemeralError> {
        let mut state = self.registry.lock();
        self.require_live_locked(true)?;
        validate_registered_room(&state.protected_collections, room)?;
        if state
            .dependencies
            .values()
            .any(|pending| pending.selector.matches(room))
        {
            return Err(authority_pending_error());
        }
        let generation = {
            let control = state.rooms.entry(room.clone()).or_default();
            if control.retired || !control.pending_tickets.is_empty() || control.resync.is_some() {
                return Err(authority_pending_error());
            }
            control.generation
        };
        let operation = self.begin_operation_locked(&mut state)?;
        Ok(RoomAuthorityOperationGuard {
            _operation: operation,
            generation,
        })
    }

    pub fn validate_admitted_room_act(
        &self,
        permit: &RoomAuthorityPermit,
        room: &RoomId,
    ) -> Result<RoomAuthorityOperationGuard, EphemeralError> {
        if !Arc::ptr_eq(&self.registry, &permit.registry) || &permit.room != room {
            return Err(authority_pending_error());
        }
        let mut state = self.registry.lock();
        self.require_live_locked(true)?;
        let Some(control) = state.rooms.get(room) else {
            return Err(authority_pending_error());
        };
        if control.retired || control.generation != permit.generation {
            return Err(authority_pending_error());
        }
        let operation = self.begin_operation_locked(&mut state)?;
        Ok(RoomAuthorityOperationGuard {
            _operation: operation,
            generation: permit.generation,
        })
    }

    pub fn room_generation(&self, room: &RoomId) -> u64 {
        let state = self.registry.lock();
        if self.require_live_locked(true).is_err() {
            return 0;
        }
        state
            .rooms
            .get(room)
            .map_or(0, |control| control.generation)
    }

    pub fn retire_room(&self, room: &RoomId) {
        let mut state = self.registry.lock();
        if self.require_live_locked(true).is_err() {
            return;
        }
        retire_room_in_state(&mut state, room);
    }

    /// @ref LLP 0059#locking-and-linearization — mark every affected room and
    /// dependency before waiting for retained publications to drain.
    pub fn prepare_authorization_commit(
        &self,
        preflight: AuthorizationCommitPreflight,
        cancellation: Arc<AuthorizationReservationCancellation>,
    ) -> SnapbackResult<AuthorizationCommitReservation> {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "off-Local room-authority commit reservation",
        );
        if matches!(
            preflight,
            AuthorizationCommitPreflight::NoAuthorizationEvent
        ) {
            return Ok(AuthorizationCommitReservation::neutral(
                self.binding.clone(),
                self.registry.clone(),
                self.registry_generation,
            ));
        }
        self.activation.require_projection(&self.registry)?;
        let mut state = self.registry.lock();
        if self.require_live_locked(false).is_err() {
            return Err(interlock_retired());
        }
        let protected_collections = state.protected_collections.clone();
        let protected_collection_revision = state.protected_collection_revision;
        let reserved_predecessor = state.durable_authorization.clone();
        let reserved_selector = match &preflight {
            AuthorizationCommitPreflight::NoAuthorizationEvent => unreachable!(),
            AuthorizationCommitPreflight::AllProtectedRooms => RoomDependencySelector::all(),
            AuthorizationCommitPreflight::AppWrites { schema, changes } => {
                selector_for_collections(
                    &protected_collections,
                    AuthorizationCommitImpact::AppWrites { schema, changes },
                )
            }
        };
        let ticket_id = state.next_ticket;
        let next_ticket = ticket_id.checked_add(1).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_EPHEMERAL_GENERATION_EXHAUSTED",
                "ephemeral",
                "protected room dependency ticket sequence exhausted",
            )
        })?;
        let outcome_sequence = state.next_outcome_sequence;
        let next_outcome_sequence = outcome_sequence.checked_add(1).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
                "auth",
                "authorization commit outcome sequence exhausted",
            )
        })?;
        let affected_rooms = state
            .rooms
            .keys()
            .filter(|room| reserved_selector.matches(room))
            .cloned()
            .collect::<BTreeSet<_>>();
        while affected_rooms.iter().any(|room| {
            state.rooms.get(room).is_some_and(|control| {
                control
                    .reauthorization_completion
                    .as_ref()
                    .is_some_and(|completion| {
                        completion.disposition.load(Ordering::Acquire)
                            == ROOM_REAUTHORIZATION_SETTLING
                    })
            })
        }) {
            #[cfg(any(test, feature = "test-support"))]
            self.registry
                .witness_authorization_writer_waiting_for_settlement();
            if self.registry.is_retired() {
                return Err(interlock_retired());
            }
            if cancellation.is_cancelled() {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_RESERVATION_CANCELLED",
                    "auth",
                    "authorization room reservation was cancelled before settlement completed",
                ));
            }
            state = self
                .registry
                .quiescent
                .wait_timeout(state, std::time::Duration::from_millis(10))
                .unwrap_or_else(PoisonError::into_inner)
                .0;
            reconcile_room_reauthorization_completions(&mut state);
        }
        if affected_rooms.iter().any(|room| {
            state
                .rooms
                .get(room)
                .is_some_and(|control| control.generation >= PORTABLE_STORAGE_VERSION_MAX)
        }) {
            return Err(SnapbackError::error(
                "SNAPBACK_EPHEMERAL_GENERATION_EXHAUSTED",
                "ephemeral",
                "room authority generation exhausted",
            ));
        }
        state.next_ticket = next_ticket;
        state.next_outcome_sequence = next_outcome_sequence;
        let expected_authorization = Arc::new(OnceLock::new());
        let known_commit = Arc::new(OnceLock::new());
        for room in &affected_rooms {
            let control = state
                .rooms
                .get_mut(room)
                .expect("enumerated room remains installed");
            control.pending_tickets.insert(ticket_id);
            // The durable writer cut is installed before invalidating an
            // in-flight room completion. If that completion returns later,
            // its exact-marker settlement loses and the new ticket keeps
            // every sink closed; the writer never depends on destructor
            // execution for liveness.
            abandon_room_reauthorization_completion(control);
        }
        state.dependencies.insert(
            ticket_id,
            RoomDependencyPending {
                expected_authorization: expected_authorization.clone(),
                known_commit: known_commit.clone(),
                selector: reserved_selector.clone(),
                affected_rooms: affected_rooms.clone(),
            },
        );
        loop {
            if self.registry.is_retired() {
                rollback_ticket(&mut state, ticket_id);
                self.registry.quiescent.notify_all();
                return Err(interlock_retired());
            }
            if cancellation.is_cancelled() {
                rollback_ticket(&mut state, ticket_id);
                self.registry.quiescent.notify_all();
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_RESERVATION_CANCELLED",
                    "auth",
                    "authorization room reservation was cancelled before quiescence",
                ));
            }
            let waiting = state.active_durable_publications != 0
                || affected_rooms.iter().any(|room| {
                    state
                        .rooms
                        .get(room)
                        .is_some_and(|control| control.active_permits != 0)
                });
            if !waiting {
                break;
            }
            state = self
                .registry
                .quiescent
                .wait_timeout(state, std::time::Duration::from_millis(10))
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        let ticket = RoomDependencyTicket {
            ticket_id,
            outcome_sequence,
            expected_authorization,
            known_commit,
            registry_generation: self.registry_generation,
        };
        Ok(AuthorizationCommitReservation {
            binding: self.binding.clone(),
            registry: self.registry.clone(),
            registry_generation: self.registry_generation,
            ticket: Some(ticket),
            reserved_selector: Some(reserved_selector),
            protected_collections,
            protected_collection_revision,
            reserved_predecessor,
            rollback_on_drop: true,
        })
    }

    pub fn committed_outcome(
        &self,
        witness: &AuthorizationCommitWitness,
        min_commit_version: u64,
    ) -> SnapbackResult<AuthorizationCommitOutcome> {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "authorization commit outcome lookup",
        );
        #[cfg(any(test, feature = "test-support"))]
        if self.activation.take_outcome_observation_failure() {
            return Err(expectation_stale(
                "injected committed authorization outcome observation failure",
            ));
        }
        let state = self.registry.lock();
        if self.require_live_locked(false).is_err() {
            return Err(interlock_retired());
        }
        let mut matches = state
            .dependencies
            .iter()
            .filter_map(|(ticket_id, pending)| {
                let known = pending.known_commit.get()?;
                (known.authorization == witness.version
                    && known.incarnation_rotated == witness.incarnation_rotated
                    && known.min_commit_version == min_commit_version)
                    .then(|| outcome_from_known(self, *ticket_id, known))
            });
        let outcome = matches
            .next()
            .ok_or_else(|| expectation_stale("authorization commit outcome is not installed"))?;
        if matches.next().is_some() {
            return Err(expectation_stale(
                "authorization commit outcome lookup is not unique",
            ));
        }
        Ok(outcome)
    }

    pub fn latest_committed_outcome(&self) -> Option<AuthorizationCommitOutcome> {
        let state = self.registry.lock();
        self.require_live_locked(false)
            .ok()
            .and_then(|()| state.latest_committed_outcome.clone())
    }

    pub fn pending_reauthorizations(&self) -> Vec<PendingRoomReauthorization> {
        let state = self.registry.lock();
        if self.require_live_locked(true).is_err() {
            return Vec::new();
        }
        state
            .rooms
            .iter()
            .filter_map(|(room, control)| {
                (control.pending_tickets.is_empty() && !control.retired)
                    .then(|| {
                        let collection = state
                            .protected_collections
                            .iter()
                            .find(|collection| collection.name == room.collection)?
                            .clone();
                        control
                            .resync
                            .clone()
                            .map(|obligation| PendingRoomReauthorization {
                                root: self.registry.clone(),
                                room: room.clone(),
                                obligation,
                                collection,
                            })
                    })
                    .flatten()
            })
            .collect()
    }

    pub fn begin_outbox_admission(
        &self,
        admit_fenced: bool,
    ) -> Result<AuthorizationOutboxAdmission<'_>, EphemeralError> {
        let state = self.registry.lock();
        self.require_live_locked(true)?;
        let admit_fenced = admit_fenced || state.durable_authorization.is_none();
        Ok(AuthorizationOutboxAdmission {
            registry: &self.registry,
            state,
            admit_fenced,
        })
    }

    pub fn begin_room_creation_admission(
        &self,
        room: &RoomId,
        generation: u64,
    ) -> Result<RoomCreationAdmission<'_>, EphemeralError> {
        let state = self.registry.lock();
        self.require_live_locked(true)?;
        let control = state.rooms.get(room).ok_or_else(authority_pending_error)?;
        if control.retired || control.generation != generation {
            return Err(authority_pending_error());
        }
        Ok(RoomCreationAdmission { _state: state })
    }

    pub fn begin_room_retirement_admission(
        &self,
        room: &RoomId,
    ) -> Result<RoomRetirementAdmission<'_>, EphemeralError> {
        let state = self.registry.lock();
        self.require_live_locked(true)?;
        Ok(RoomRetirementAdmission {
            registry: &self.registry,
            state,
            room: room.clone(),
        })
    }

    fn begin_room_reauthorization_fence(
        &self,
        room: &RoomId,
        generation: u64,
    ) -> Result<RoomReauthorizationFence, EphemeralError> {
        let mut state = self.registry.lock();
        #[cfg(test)]
        self.registry.witness_completion_registry_acquired();
        self.require_live_locked(true)?;
        let control = state
            .rooms
            .get_mut(room)
            .ok_or_else(authority_pending_error)?;
        let obligation = control.resync.clone().ok_or_else(authority_pending_error)?;
        if control.retired
            || !control.pending_tickets.is_empty()
            || control.generation != generation
            || obligation.room_authority_generation != generation
            || control.reauthorization_completion.is_some()
        {
            return Err(authority_pending_error());
        }
        let completion = RoomReauthorizationCompletionState::active();
        control.reauthorization_completion = Some(completion.clone());
        Ok(RoomReauthorizationFence {
            registry: self.registry.clone(),
            room: room.clone(),
            generation,
            completion,
        })
    }

    /// Consume a database-derived batch and run the participant-bound sync
    /// settlement when it belongs to this exact registry and generation.
    /// Completion callers provide neither executable code nor a terminal
    /// disposition. SQLite is released before the fixed settlement executor
    /// runs, and the private fence never crosses this call.
    ///
    /// @ref LLP 0303#a-durable-record-is-checked-at-acquisition-a-live-handle-outlives-it —
    /// a resolved batch is only a cache; completion revalidates its session
    /// and membership facts at the guarded effect.
    pub fn run_room_reauthorization_completion(
        &self,
        database: &super::ServingDatabase,
        batch: ResolvedRoomReauthorizationBatch,
    ) -> SnapbackResult<bool> {
        self.run_room_reauthorization_completion_on(
            &database.binding(),
            &database.db.conn,
            database.db.schema(),
            batch,
        )
    }

    /// Run the same exact completion cut on the take-once database lane
    /// owned outside managed `LocalSnapback`.
    pub fn run_room_reauthorization_completion_off_local(
        &self,
        database: &super::RoomReauthorizationDatabase,
        batch: ResolvedRoomReauthorizationBatch,
    ) -> SnapbackResult<bool> {
        let schema = database
            .schema
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        self.run_room_reauthorization_completion_on(
            &database.binding,
            &database.conn,
            &schema,
            batch,
        )
    }

    fn run_room_reauthorization_completion_on(
        &self,
        database_binding: &DatabaseBinding,
        connection: &Connection,
        schema: &SchemaManifest,
        batch: ResolvedRoomReauthorizationBatch,
    ) -> SnapbackResult<bool> {
        if crate::exec_guard::local_snapback_write_scope_active() {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_INTERLOCK_LOCAL_SCOPE_FORBIDDEN",
                "auth",
                "room reauthorization completion must run outside the LocalSnapback write scope",
            ));
        }
        if !Arc::ptr_eq(&self.registry, &batch.root)
            || !batch.root.binding_matches(database_binding)
        {
            return Ok(false);
        }
        let ResolvedRoomReauthorizationBatch {
            root: _,
            room,
            generation,
            collection,
            min_commit_version,
            resolutions,
        } = batch;
        let projection = collection.permission_backing.as_ref().ok_or_else(|| {
            projection_unavailable(
                "resolved protected room lacks its durable permissionBacking projection",
            )
        })?;
        let scope_fields = projection
            .scope_fields
            .iter()
            .map(|(scope_field, table_field)| {
                room.scope
                    .get(scope_field)
                    .map(|value| (table_field.clone(), value.to_owned()))
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_EPHEMERAL_INVALID_SCOPE",
                            "ephemeral",
                            "room scope does not satisfy its permissionBacking projection",
                        )
                    })
            })
            .collect::<SnapbackResult<Vec<_>>>()?;
        // @ref LLP 0290#71-lock-ordering — claim under the registry and
        // release that guard before SQLite. After the durable reread, the
        // exact ACTIVE -> SETTLING transition occurs before sync mutation;
        // affected writers and participant replacement wait for that finite
        // settlement instead of preempting irreversible work. Every earlier
        // error path drops the SQLite transaction before abandoning the fence
        // because the transaction is declared second.
        let fence = match self.begin_room_reauthorization_fence(&room, generation) {
            Ok(fence) => fence,
            Err(_) => return Ok(false),
        };
        let durable_fence = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)?;
        for resolution in &resolutions {
            let current = resolve_room_reauthorization_subject_on(
                &durable_fence,
                schema,
                projection,
                &scope_fields,
                &collection,
                &room,
                min_commit_version,
                &resolution.subject,
            )?;
            if current != resolution.authorized_auth {
                drop(durable_fence);
                drop(fence);
                return Ok(false);
            }
        }
        drop(durable_fence);
        #[cfg(test)]
        self.registry.witness_completion_before_settlement_claim();
        if !fence.begin_settlement() {
            return Ok(false);
        }
        let completion = RoomReauthorizationCompletion {
            room,
            generation,
            resolutions,
        };
        let settler = self.room_reauthorization_settler.get().ok_or_else(|| {
            projection_unavailable(
                "room reauthorization settlement is absent from the database-bound participant",
            )
        })?;
        let disposition = settler.settle(&completion)?;
        Ok(fence.finish(disposition))
    }
}

/// Explicitly non-authorizing authority state for standalone memory backends.
/// It cannot prepare, bind, activate, or observe authorization commits.
pub struct NonAuthorizingRoomAuthority {
    participant: AuthorizationCommitParticipant,
}

impl Default for NonAuthorizingRoomAuthority {
    fn default() -> Self {
        let binding = DatabaseBinding::isolated();
        let registry = RoomAuthorityRegistry::new(binding.clone());
        let activation = Arc::new(AuthorizationParticipantActivation {
            identity: ProcessBoundIdentity::new(),
            state: AtomicU8::new(ACTIVATION_BOUND),
            projection_available: AtomicBool::new(false),
            projection: Mutex::new(AuthorizationProjectionState {
                epoch: 1,
                carrier: None,
                failure: None,
            }),
            #[cfg(any(test, feature = "test-support"))]
            fail_next_outcome_observation: AtomicBool::new(false),
            #[cfg(any(test, feature = "test-support"))]
            fail_next_issuer_projection: AtomicBool::new(false),
        });
        Self {
            participant: AuthorizationCommitParticipant::new(binding, registry, 1, activation),
        }
    }
}

impl NonAuthorizingRoomAuthority {
    pub fn replace_protected_room_catalog(
        &self,
        definitions: &[EphemeralCollection],
    ) -> Result<u64, EphemeralError> {
        self.participant.replace_protected_room_catalog(definitions)
    }

    pub fn begin_protected_room_act(
        &self,
        room: &RoomId,
    ) -> Result<RoomAuthorityPermit, EphemeralError> {
        self.participant.begin_protected_room_act(room)
    }

    pub fn begin_protected_room_operation(
        &self,
        room: &RoomId,
    ) -> Result<RoomAuthorityOperationGuard, EphemeralError> {
        self.participant.begin_protected_room_operation(room)
    }

    pub fn validate_admitted_room_act(
        &self,
        permit: &RoomAuthorityPermit,
        room: &RoomId,
    ) -> Result<RoomAuthorityOperationGuard, EphemeralError> {
        self.participant.validate_admitted_room_act(permit, room)
    }

    pub fn room_generation(&self, room: &RoomId) -> u64 {
        self.participant.room_generation(room)
    }

    pub fn retire_room(&self, room: &RoomId) {
        self.participant.retire_room(room);
    }

    pub fn pending_reauthorizations(&self) -> Vec<PendingRoomReauthorization> {
        self.participant.pending_reauthorizations()
    }

    pub fn resolve_room_reauthorization(
        &self,
        database: &super::ServingDatabase,
        pending: PendingRoomReauthorization,
        subscribers: Vec<RoomReauthorizationSubscriber>,
    ) -> SnapbackResult<ResolvedRoomReauthorizationBatch> {
        self.participant
            .resolve_room_reauthorization(database, pending, subscribers)
    }

    pub fn begin_outbox_admission(
        &self,
        admit_fenced: bool,
    ) -> Result<AuthorizationOutboxAdmission<'_>, EphemeralError> {
        self.participant.begin_outbox_admission(admit_fenced)
    }

    pub fn begin_room_creation_admission(
        &self,
        room: &RoomId,
        generation: u64,
    ) -> Result<RoomCreationAdmission<'_>, EphemeralError> {
        self.participant
            .begin_room_creation_admission(room, generation)
    }

    pub fn begin_room_retirement_admission(
        &self,
        room: &RoomId,
    ) -> Result<RoomRetirementAdmission<'_>, EphemeralError> {
        self.participant.begin_room_retirement_admission(room)
    }

    pub fn run_room_reauthorization_completion(
        &self,
        database: &super::ServingDatabase,
        batch: ResolvedRoomReauthorizationBatch,
    ) -> SnapbackResult<bool> {
        self.participant
            .run_room_reauthorization_completion(database, batch)
    }

    pub fn run_room_reauthorization_completion_off_local(
        &self,
        database: &super::RoomReauthorizationDatabase,
        batch: ResolvedRoomReauthorizationBatch,
    ) -> SnapbackResult<bool> {
        self.participant
            .run_room_reauthorization_completion_off_local(database, batch)
    }
}

pub struct AuthorizationReservationCancellation {
    cancelled: AtomicBool,
}

impl AuthorizationReservationCancellation {
    pub fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

pub struct AuthorizationCommitReservation {
    binding: DatabaseBinding,
    registry: Arc<RoomAuthorityRegistry>,
    registry_generation: u64,
    ticket: Option<RoomDependencyTicket>,
    reserved_selector: Option<RoomDependencySelector>,
    protected_collections: Arc<[EphemeralCollection]>,
    protected_collection_revision: u64,
    reserved_predecessor: Option<AuthorizationVersion>,
    rollback_on_drop: bool,
}

impl AuthorizationCommitReservation {
    fn neutral(
        binding: DatabaseBinding,
        registry: Arc<RoomAuthorityRegistry>,
        registry_generation: u64,
    ) -> Self {
        Self {
            binding,
            registry,
            registry_generation,
            ticket: None,
            reserved_selector: None,
            protected_collections: Arc::from([]),
            protected_collection_revision: 0,
            reserved_predecessor: None,
            rollback_on_drop: false,
        }
    }

    /// @ref LLP 0290#54-bind — transaction bind compares the reservation with
    /// the committing database's private ready tuple; no caller supplies a registry.
    pub(super) fn bind(
        mut self,
        database_binding: &DatabaseBinding,
        authorization_interlock: &AuthorizationInterlockState,
        durable_predecessor: Option<&AuthorizationVersion>,
        witness: &AuthorizationCommitWitness,
        impact: AuthorizationCommitImpact<'_>,
    ) -> SnapbackResult<PreparedAuthorizationCommit> {
        if !witness.event {
            return Err(authorization_reservation_stale(
                "authorization reservation was presented for a neutral transaction",
            ));
        }
        let AuthorizationInterlockState::ParticipantReady {
            registry: ready_registry,
            registry_generation: ready_generation,
            activation: ready_activation,
        } = authorization_interlock
        else {
            return Err(projection_unavailable(
                "authorization write reached a database without a ready participant",
            ));
        };
        let activation = ready_activation.upgrade().ok_or_else(|| {
            projection_unavailable("authorization participant was dropped before transaction bind")
        })?;
        if activation.state() != ACTIVATION_READY {
            return Err(projection_unavailable(
                "authorization participant is not ready at transaction bind",
            ));
        }
        let issuer_projection = activation.require_projection_identity(ready_registry)?;
        if !self.binding.matches(database_binding) {
            return Err(participant_database_mismatch());
        }
        if !ready_registry.binding_matches(database_binding)
            || !Arc::ptr_eq(&self.registry, ready_registry)
        {
            return Err(participant_registry_mismatch());
        }
        if self.registry_generation != *ready_generation
            || self.registry_generation != ready_registry.generation()
        {
            return Err(participant_generation_mismatch());
        }
        if ready_registry.is_retired() {
            return Err(interlock_retired());
        }
        if ready_registry.catalog_revision.load(Ordering::Acquire)
            != self.protected_collection_revision
        {
            return Err(authorization_reservation_stale(
                "protected-room definitions changed after authorization reservation",
            ));
        }
        let reserved_selector = self.reserved_selector.as_ref().ok_or_else(|| {
            authorization_reservation_stale(
                "a neutral preview produced an authorization-changing transaction",
            )
        })?;
        let actual_selector = selector_for_collections(&self.protected_collections, impact);
        if !reserved_selector.covers(&actual_selector) {
            return Err(authorization_reservation_stale(
                "authorization write exceeded its off-Local protected-room reservation",
            ));
        }
        if !witness.incarnation_rotated {
            if self.reserved_predecessor.as_ref() != durable_predecessor {
                return Err(expectation_stale(
                    "authorization predecessor changed after reservation",
                )
                .with_details(serde_json::json!({
                    "reserved": self.reserved_predecessor,
                    "durable": durable_predecessor,
                })));
            }
            let predecessor = durable_predecessor.ok_or_else(|| {
                expectation_stale("authorization successor has no durable predecessor")
            })?;
            if predecessor.incarnation != witness.version.incarnation
                || predecessor.epoch.checked_add(1) != Some(witness.version.epoch)
            {
                return Err(expectation_stale(
                    "authorization successor is stale for its durable predecessor",
                ));
            }
        }
        let ticket = self.ticket.as_ref().ok_or_else(|| {
            authorization_reservation_stale("authorization reservation has no dependency ticket")
        })?;
        if ticket.registry_generation != self.registry_generation {
            return Err(participant_generation_mismatch());
        }
        let ticket = self
            .ticket
            .take()
            .expect("validated authorization dependency ticket remains owned");
        ticket
            .expected_authorization
            .set(witness.version.clone())
            .map_err(|_| expectation_stale("authorization ticket was already bound"))?;
        self.rollback_on_drop = false;
        Ok(PreparedAuthorizationCommit {
            binding: self.binding.clone(),
            registry: self.registry.clone(),
            activation,
            issuer_projection,
            registry_generation: self.registry_generation,
            ticket,
            predecessor: durable_predecessor.cloned(),
            authorization: witness.version.clone(),
            incarnation_rotated: witness.incarnation_rotated,
            rollback_on_drop: true,
        })
    }

    pub fn cancel(self) {
        drop(self);
    }

    pub fn install(self) -> ManagedAuthorizationReservationScope {
        MANAGED_AUTHORIZATION_RESERVATION.with(|slot| {
            let previous = slot.borrow_mut().replace(self);
            assert!(
                previous.is_none(),
                "managed authorization reservation already installed"
            );
        });
        ManagedAuthorizationReservationScope { active: true }
    }
}

impl Drop for AuthorizationCommitReservation {
    fn drop(&mut self) {
        if self.rollback_on_drop {
            if let Some(ticket) = self.ticket.take() {
                schedule_rollback(self.registry.clone(), ticket.ticket_id);
            }
        }
    }
}

thread_local! {
    static MANAGED_AUTHORIZATION_RESERVATION: std::cell::RefCell<Option<AuthorizationCommitReservation>> =
        const { std::cell::RefCell::new(None) };
}

pub struct ManagedAuthorizationReservationScope {
    active: bool,
}

impl ManagedAuthorizationReservationScope {
    pub fn take_unused(mut self) -> Option<AuthorizationCommitReservation> {
        self.active = false;
        MANAGED_AUTHORIZATION_RESERVATION.with(|slot| slot.borrow_mut().take())
    }
}

impl Drop for ManagedAuthorizationReservationScope {
    fn drop(&mut self) {
        if self.active {
            MANAGED_AUTHORIZATION_RESERVATION.with(|slot| drop(slot.borrow_mut().take()));
        }
    }
}

pub(super) fn take_managed_authorization_reservation() -> Option<AuthorizationCommitReservation> {
    MANAGED_AUTHORIZATION_RESERVATION.with(|slot| slot.borrow_mut().take())
}

pub(crate) struct PreparedAuthorizationCommit {
    binding: DatabaseBinding,
    registry: Arc<RoomAuthorityRegistry>,
    activation: Arc<AuthorizationParticipantActivation>,
    issuer_projection: Arc<AuthorizationIssuerProjectionIdentity>,
    registry_generation: u64,
    ticket: RoomDependencyTicket,
    predecessor: Option<AuthorizationVersion>,
    authorization: AuthorizationVersion,
    incarnation_rotated: bool,
    rollback_on_drop: bool,
}

impl PreparedAuthorizationCommit {
    /// @ref LLP 0290#55-finalize — known commit installs one concrete verdict
    /// and schedules a kernel-owned finalizer without a callback bridge.
    pub(crate) fn finalize_committed(mut self, min_commit_version: u64) -> SnapbackResult<()> {
        self.rollback_on_drop = false;
        let known = KnownAuthorizationCommit {
            sequence: self.ticket.outcome_sequence,
            predecessor: self.predecessor.clone(),
            authorization: self.authorization.clone(),
            min_commit_version,
            incarnation_rotated: self.incarnation_rotated,
            issuer_projected: AtomicBool::new(false),
        };
        self.ticket
            .known_commit
            .set(known)
            .map_err(|_| expectation_stale("authorization commit verdict was already installed"))?;
        if !self.incarnation_rotated {
            // @ref LLP 0303#why-coverage-kept-leaking-both-lanes-chose-verify-where-derive-was-available
            // — only the exact prepared commit can stage the successor that
            // the obligation registry derives from this installed issuer.
            self.issuer_projection
                .stage_committed(&self.authorization)?;
        }
        let registry = self.registry.clone();
        let activation = self.activation.clone();
        let binding = self.binding.clone();
        let generation = self.registry_generation;
        let ticket_id = self.ticket.ticket_id;
        crate::exec_guard::run_or_defer_after_local_finalizer_checked(move || {
            finalize_known_commit(&registry, &binding, generation, ticket_id)
                .map_err(|error| activation.fail_closed(error).into())
        })
        .map_err(SnapbackError::from)?;
        Ok(())
    }

    pub(crate) fn finalize_rolled_back(self) {
        drop(self);
    }

    pub(crate) fn finalize_ambiguous(mut self) {
        self.rollback_on_drop = false;
    }
}

impl Drop for PreparedAuthorizationCommit {
    fn drop(&mut self) {
        if self.rollback_on_drop {
            schedule_rollback(self.registry.clone(), self.ticket.ticket_id);
        }
    }
}

#[derive(Clone)]
pub struct AuthorizationCommitOutcome {
    binding: DatabaseBinding,
    registry: Arc<RoomAuthorityRegistry>,
    registry_generation: u64,
    ticket_id: u64,
    sequence: u64,
    predecessor: Option<AuthorizationVersion>,
    authorization: AuthorizationVersion,
    min_commit_version: u64,
    incarnation_rotated: bool,
}

impl AuthorizationCommitOutcome {
    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    pub fn authorization(&self) -> &AuthorizationVersion {
        &self.authorization
    }

    pub fn min_commit_version(&self) -> u64 {
        self.min_commit_version
    }

    pub fn incarnation_rotated(&self) -> bool {
        self.incarnation_rotated
    }
}

#[derive(Clone)]
pub struct AuthorizationExpectationView {
    registry: Arc<RoomAuthorityRegistry>,
    registry_generation: u64,
    activation: Arc<AuthorizationParticipantActivation>,
    projection_epoch: u64,
    issuer_incarnation: Arc<str>,
}

/// The exact database-bound projection capability held by a live invalidation
/// issuer. A plain authorization value is not activation proof: this carrier
/// retains the registry, generation, activation identity, suspension epoch,
/// and incarnation of the view the issuer actually owns.
///
/// @ref LLP 0290#44-auth-time-activation — READY retains only a weak lease to
/// this exact carrier, so a dropped or foreign issuer cannot leave it enabled.
#[derive(Clone)]
pub struct AuthorizationIssuerProjection {
    identity: Arc<AuthorizationIssuerProjectionIdentity>,
}

struct AuthorizationIssuerProjectionIdentity {
    view: AuthorizationExpectationView,
    committed_epoch: AtomicU64,
}

impl AuthorizationIssuerProjection {
    pub fn current(&self) -> SnapbackResult<AuthorizationVersion> {
        if self.identity.view.activation.state() == ACTIVATION_RETIRED
            || self.identity.view.registry.is_retired()
            || self.identity.view.registry.generation() != self.identity.view.registry_generation
        {
            return Err(projection_unavailable(
                "authorization issuer projection is retired",
            ));
        }
        Ok(AuthorizationVersion {
            incarnation: self.identity.view.issuer_incarnation.to_string(),
            epoch: self.identity.committed_epoch.load(Ordering::Acquire),
        })
    }

    pub fn project_committed(&self, outcome: &AuthorizationCommitOutcome) -> SnapbackResult<()> {
        self.identity.view.project_committed(outcome)
    }

    pub(super) fn matches_view(&self, view: &AuthorizationExpectationView) -> bool {
        Arc::ptr_eq(&self.identity.view.registry, &view.registry)
            && self.identity.view.registry_generation == view.registry_generation
            && Arc::ptr_eq(&self.identity.view.activation, &view.activation)
            && self.identity.view.projection_epoch == view.projection_epoch
            && self.identity.view.issuer_incarnation == view.issuer_incarnation
    }
}

impl AuthorizationIssuerProjectionIdentity {
    fn stage_committed(&self, authorization: &AuthorizationVersion) -> SnapbackResult<()> {
        if authorization.incarnation != self.view.issuer_incarnation.as_ref() {
            return Err(expectation_stale(
                "prepared authorization commit crossed its issuer incarnation",
            ));
        }
        let mut current = self.committed_epoch.load(Ordering::Acquire);
        loop {
            if authorization.epoch < current {
                return Err(expectation_stale(
                    "prepared authorization commits must advance monotonically",
                ));
            }
            match self.committed_epoch.compare_exchange_weak(
                current,
                authorization.epoch,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Ok(()),
                Err(observed) => current = observed,
            }
        }
    }
}

impl AuthorizationExpectationView {
    pub(super) fn database_binding_matches(&self, binding: &DatabaseBinding) -> bool {
        self.registry.binding_matches(binding)
    }

    pub(super) fn new(
        registry: Arc<RoomAuthorityRegistry>,
        registry_generation: u64,
        activation: Arc<AuthorizationParticipantActivation>,
        issuer_incarnation: Arc<str>,
    ) -> Self {
        let projection_epoch = activation.projection_epoch();
        Self::new_at_epoch(
            registry,
            registry_generation,
            activation,
            projection_epoch,
            issuer_incarnation,
        )
    }

    fn new_at_epoch(
        registry: Arc<RoomAuthorityRegistry>,
        registry_generation: u64,
        activation: Arc<AuthorizationParticipantActivation>,
        projection_epoch: u64,
        issuer_incarnation: Arc<str>,
    ) -> Self {
        Self {
            registry,
            registry_generation,
            activation,
            projection_epoch,
            issuer_incarnation,
        }
    }

    pub fn current(&self) -> SnapbackResult<AuthorizationVersion> {
        let state = self.registry.lock();
        if self.activation.state() == ACTIVATION_RETIRED
            || self.registry.is_retired()
            || self.registry.generation() != self.registry_generation
        {
            return Err(projection_unavailable(
                "authorization expectation view is retired",
            ));
        }
        let current = state
            .projected_authorization
            .clone()
            .ok_or_else(|| projection_unavailable("authorization expectation is uninitialized"))?;
        if current.incarnation != self.issuer_incarnation.as_ref() {
            return Err(expectation_stale(
                "authorization expectation crossed its issuer incarnation",
            ));
        }
        Ok(current)
    }

    /// Bind this exact view as the projection capability stored by one live
    /// invalidation issuer. Activation accepts this opaque identity, never a
    /// caller-supplied authorization value.
    pub fn into_issuer_projection(self) -> SnapbackResult<AuthorizationIssuerProjection> {
        let committed_authorization = self.current()?;
        Ok(AuthorizationIssuerProjection {
            identity: Arc::new(AuthorizationIssuerProjectionIdentity {
                view: self,
                committed_epoch: AtomicU64::new(committed_authorization.epoch),
            }),
        })
    }

    pub fn project_committed(&self, outcome: &AuthorizationCommitOutcome) -> SnapbackResult<()> {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "authorization issuer expectation projection",
        );
        #[cfg(any(test, feature = "test-support"))]
        if self.activation.take_issuer_projection_failure() {
            return Err(expectation_stale(
                "injected authorization issuer projection failure",
            ));
        }
        self.activation.require_projection(&self.registry)?;
        if !self.registry.binding_matches(&outcome.binding)
            || !Arc::ptr_eq(&self.registry, &outcome.registry)
            || self.registry_generation != outcome.registry_generation
        {
            return Err(participant_registry_mismatch());
        }
        let mut state = self.registry.lock();
        if self.registry.is_retired()
            || self.registry.generation() != self.registry_generation
            || self.activation.state() != ACTIVATION_READY
        {
            return Err(participant_registry_mismatch());
        }
        if outcome.incarnation_rotated {
            return Err(expectation_stale(
                "a predecessor issuer cannot project a rotated incarnation",
            ));
        }
        if outcome.authorization.incarnation != self.issuer_incarnation.as_ref() {
            return Err(expectation_stale(
                "authorization outcome belongs to a different issuer incarnation",
            ));
        }
        let known_commit = state
            .dependencies
            .get(&outcome.ticket_id)
            .ok_or_else(|| {
                expectation_stale("authorization commit dependency is no longer installed")
            })?
            .known_commit
            .clone();
        let known = known_commit
            .get()
            .ok_or_else(|| expectation_stale("authorization commit verdict is not installed"))?;
        if known.sequence != outcome.sequence
            || known.authorization != outcome.authorization
            || known.predecessor != outcome.predecessor
            || known.min_commit_version != outcome.min_commit_version
            || state.projected_authorization != outcome.predecessor
        {
            return Err(expectation_stale(
                "authorization outcome does not match the installed commit",
            ));
        }
        state.projected_authorization = Some(outcome.authorization.clone());
        state
            .projected_commits
            .insert(outcome.ticket_id, outcome.authorization.clone());
        known_commit
            .get()
            .expect("validated authorization commit remains installed")
            .issuer_projected
            .store(true, Ordering::Release);
        Ok(())
    }
}

pub struct RoomAuthorityPermit {
    registry: Arc<RoomAuthorityRegistry>,
    room: RoomId,
    generation: u64,
}

impl RoomAuthorityPermit {
    pub fn generation(&self) -> u64 {
        self.generation
    }
}

impl Drop for RoomAuthorityPermit {
    fn drop(&mut self) {
        let mut state = self.registry.lock();
        let remove = state.rooms.get_mut(&self.room).is_some_and(|control| {
            control.active_permits = control.active_permits.saturating_sub(1);
            control.retired && control.active_permits == 0 && control.pending_tickets.is_empty()
        });
        if remove {
            state.rooms.remove(&self.room);
        }
        self.registry.quiescent.notify_all();
    }
}

pub struct DurableAuthorizationPermit {
    registry: Arc<RoomAuthorityRegistry>,
}

impl Drop for DurableAuthorizationPermit {
    fn drop(&mut self) {
        let mut state = self.registry.lock();
        state.active_durable_publications = state.active_durable_publications.saturating_sub(1);
        self.registry.quiescent.notify_all();
    }
}

pub enum RealtimePublicationPermit {
    Durable(DurableAuthorizationPermit),
    Room(RoomAuthorityPermit),
}

impl RealtimePublicationPermit {
    pub fn validity(&self) -> RealtimePublicationValidity {
        match self {
            Self::Durable(permit) => RealtimePublicationValidity {
                registry: permit.registry.clone(),
                room: None,
            },
            Self::Room(permit) => RealtimePublicationValidity {
                registry: permit.registry.clone(),
                room: Some((permit.room.clone(), permit.generation)),
            },
        }
    }

    pub fn begin_handoff(&self) -> Result<RealtimePublicationHandoff, EphemeralError> {
        self.validity().begin_handoff()
    }
}

impl RealtimePublicationValidity {
    pub fn begin_handoff(&self) -> Result<RealtimePublicationHandoff, EphemeralError> {
        let mut state = self.registry.lock();
        if self.registry.is_retired() {
            return Err(authority_pending_error());
        }
        if let Some((room, generation)) = &self.room {
            let control = state.rooms.get(room).ok_or_else(authority_pending_error)?;
            if control.retired || control.generation != *generation {
                return Err(authority_pending_error());
            }
        }
        state.active_operations = state
            .active_operations
            .checked_add(1)
            .ok_or_else(authority_pending_error)?;
        Ok(RealtimePublicationHandoff {
            _operation: RegistryOperationGuard {
                registry: self.registry.clone(),
            },
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OutboxFrameDisposition {
    Send,
    Retain,
    DropStale,
}

pub struct AuthorizationOutboxAdmission<'a> {
    registry: &'a Arc<RoomAuthorityRegistry>,
    state: MutexGuard<'a, RoomAuthorityRegistryState>,
    admit_fenced: bool,
}

impl AuthorizationOutboxAdmission<'_> {
    /// @ref LLP 0059#durable-and-ephemeral-outboxes — classification occurs
    /// under registry custody before sync leases its private queue.
    pub fn classify_durable(&self, message: &DurableMessage) -> OutboxFrameDisposition {
        classify_durable(&self.state, self.admit_fenced, message)
    }

    pub fn classify_ephemeral(&self, message: &EphemeralMessage) -> OutboxFrameDisposition {
        classify_ephemeral(&self.state, self.admit_fenced, message)
    }

    pub fn admit_selected(
        &mut self,
        envelope: &RealtimeEnvelope,
    ) -> Result<Option<RealtimePublicationPermit>, EphemeralError> {
        match envelope {
            RealtimeEnvelope::Durable(message) => {
                if self.classify_durable(message) != OutboxFrameDisposition::Send {
                    return Err(authority_pending_error());
                }
                if message.authorization().is_none() {
                    return Ok(None);
                }
                self.state.active_durable_publications = self
                    .state
                    .active_durable_publications
                    .checked_add(1)
                    .ok_or_else(authority_pending_error)?;
                Ok(Some(RealtimePublicationPermit::Durable(
                    DurableAuthorizationPermit {
                        registry: self.registry.clone(),
                    },
                )))
            }
            RealtimeEnvelope::Ephemeral(message) => {
                if self.classify_ephemeral(message) != OutboxFrameDisposition::Send {
                    return Err(authority_pending_error());
                }
                if message.is_authority_independent_epoch_boundary() {
                    return Ok(None);
                }
                let Some((room, generation)) = message.room_authority() else {
                    return Ok(None);
                };
                let Some(control) = self.state.rooms.get_mut(room) else {
                    return Ok(None);
                };
                control.active_permits = control
                    .active_permits
                    .checked_add(1)
                    .ok_or_else(authority_pending_error)?;
                Ok(Some(RealtimePublicationPermit::Room(RoomAuthorityPermit {
                    registry: self.registry.clone(),
                    room: room.clone(),
                    generation,
                })))
            }
        }
    }
}

pub struct RoomCreationAdmission<'a> {
    _state: MutexGuard<'a, RoomAuthorityRegistryState>,
}

pub struct RoomRetirementAdmission<'a> {
    registry: &'a Arc<RoomAuthorityRegistry>,
    state: MutexGuard<'a, RoomAuthorityRegistryState>,
    room: RoomId,
}

impl RoomRetirementAdmission<'_> {
    pub fn retire_generation_exhausted(mut self) {
        let remove = self.state.rooms.get_mut(&self.room).is_some_and(|control| {
            control.retired = true;
            control.resync = None;
            control.pending_tickets.is_empty() && control.active_permits == 0
        });
        if remove {
            self.state.rooms.remove(&self.room);
        }
        self.registry.quiescent.notify_all();
    }
}

struct RoomReauthorizationFence {
    registry: Arc<RoomAuthorityRegistry>,
    room: RoomId,
    generation: u64,
    completion: Arc<RoomReauthorizationCompletionState>,
}

impl RoomReauthorizationFence {
    fn begin_settlement(&self) -> bool {
        let state = self.registry.lock();
        let exact = !self.registry.is_retired()
            && state.rooms.get(&self.room).is_some_and(|control| {
                control.generation == self.generation
                    && control.pending_tickets.is_empty()
                    && control
                        .resync
                        .as_ref()
                        .is_some_and(|resync| resync.room_authority_generation == self.generation)
                    && control
                        .reauthorization_completion
                        .as_ref()
                        .is_some_and(|completion| Arc::ptr_eq(completion, &self.completion))
            });
        exact
            && self
                .completion
                .disposition
                .compare_exchange(
                    ROOM_REAUTHORIZATION_ACTIVE,
                    ROOM_REAUTHORIZATION_SETTLING,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                )
                .is_ok()
    }

    fn finish(self, disposition: RoomReauthorizationDisposition) -> bool {
        let mut state = self.registry.lock();
        let exact = !self.registry.is_retired()
            && state.rooms.get(&self.room).is_some_and(|control| {
                control.generation == self.generation
                    && control.pending_tickets.is_empty()
                    && control
                        .resync
                        .as_ref()
                        .is_some_and(|resync| resync.room_authority_generation == self.generation)
                    && control
                        .reauthorization_completion
                        .as_ref()
                        .is_some_and(|completion| Arc::ptr_eq(completion, &self.completion))
            });
        if !exact {
            return false;
        }
        let terminal = disposition.as_atomic();
        if self
            .completion
            .disposition
            .compare_exchange(
                ROOM_REAUTHORIZATION_SETTLING,
                terminal,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_err()
        {
            return false;
        }
        reconcile_room_reauthorization_completions(&mut state);
        self.registry.quiescent.notify_all();
        disposition != RoomReauthorizationDisposition::Abandoned
    }
}

impl Drop for RoomReauthorizationFence {
    fn drop(&mut self) {
        let active_abandoned = self
            .completion
            .disposition
            .compare_exchange(
                ROOM_REAUTHORIZATION_ACTIVE,
                ROOM_REAUTHORIZATION_ABANDONED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok();
        let settling_abandoned = !active_abandoned
            && self
                .completion
                .disposition
                .compare_exchange(
                    ROOM_REAUTHORIZATION_SETTLING,
                    ROOM_REAUTHORIZATION_ABANDONED,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                )
                .is_ok();
        if active_abandoned || settling_abandoned {
            self.registry.quiescent.notify_all();
        }
    }
}

/// The read-only database-derived decisions lent to the participant-bound
/// settlement owner. No fence, mutex guard, SQLite transaction, or terminal
/// method is carried by this value, and completion callers cannot retain it.
pub struct RoomReauthorizationCompletion {
    room: RoomId,
    generation: u64,
    resolutions: Vec<ResolvedRoomSubscriberReauthorization>,
}

impl RoomReauthorizationCompletion {
    pub fn room(&self) -> &RoomId {
        &self.room
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn resolutions(&self) -> &[ResolvedRoomSubscriberReauthorization] {
        &self.resolutions
    }
}

/// Participant-bound implementation of the sync-owned room settlement.
///
/// # Safety
///
/// `settle` must return `Complete` only after it has applied every resolution
/// to the exact room generation and published all resulting removal and
/// denial effects. It must return `Missing` only when that room is absent and
/// `Abandoned` when the exact subscriber/effect-fence set no longer matches.
/// Violating this contract can reopen protected admission with stale sync
/// authority. The implementation is installed exactly once before database
/// binding and is never accepted from a completion caller; requiring an
/// `unsafe impl` keeps an ordinary safe-Rust caller from substituting a no-op
/// implementation that asserts a terminal disposition.
#[doc(hidden)]
pub unsafe trait RoomReauthorizationSettlementExecutor: Send + Sync {
    fn settle(
        &self,
        completion: &RoomReauthorizationCompletion,
    ) -> SnapbackResult<RoomReauthorizationDisposition>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RoomReauthorizationDisposition {
    Complete,
    Missing,
    Abandoned,
}

impl RoomReauthorizationDisposition {
    fn as_atomic(self) -> u8 {
        match self {
            Self::Complete => ROOM_REAUTHORIZATION_COMPLETE,
            Self::Missing => ROOM_REAUTHORIZATION_MISSING,
            Self::Abandoned => ROOM_REAUTHORIZATION_ABANDONED,
        }
    }
}

pub(super) fn initialize_authorization(
    participant: &AuthorizationCommitParticipant,
    authorization: Option<AuthorizationVersion>,
    allow_ready: bool,
) -> SnapbackResult<AuthorizationExpectationView> {
    let activation_state = participant.activation.state();
    if activation_state != ACTIVATION_BOUND
        && !(allow_ready && activation_state == ACTIVATION_READY)
    {
        return Err(participant_state_error(
            "authorization participant is not bound for issuer installation",
        ));
    }
    let authorization = authorization.ok_or_else(|| {
        expectation_stale("durable authorization is absent during issuer installation")
    })?;
    // Capture before the registry mutex to preserve the global
    // projection-state -> registry lock order. A concurrent suspension makes
    // the returned view stale; activation then rejects it by epoch.
    let projection_epoch = participant.activation.projection_epoch();
    let mut state = participant.registry.lock();
    if participant.require_live_locked(true).is_err() {
        return Err(interlock_retired());
    }
    let clean = state.dependencies.is_empty()
        && state.active_durable_publications == 0
        && state.projected_commits.is_empty()
        && state
            .rooms
            .values()
            .all(|control| control.pending_tickets.is_empty());
    if !clean {
        return Err(projection_unavailable(
            "authorization participant has pending authority work",
        ));
    }
    if activation_state == ACTIVATION_BOUND {
        state.durable_authorization = Some(authorization.clone());
        state.projected_authorization = Some(authorization.clone());
    } else if state.durable_authorization.as_ref() != Some(&authorization)
        || state.projected_authorization.as_ref() != Some(&authorization)
        || state
            .latest_committed_outcome
            .as_ref()
            .is_some_and(|outcome| outcome.authorization != authorization)
    {
        return Err(expectation_stale(
            "ready participant does not match the durable authorization snapshot",
        ));
    }
    Ok(AuthorizationExpectationView::new_at_epoch(
        participant.registry.clone(),
        participant.registry_generation,
        participant.activation.clone(),
        projection_epoch,
        Arc::from(authorization.incarnation),
    ))
}

pub(super) fn require_initialized_authorization(
    participant: &AuthorizationCommitParticipant,
    authorization: Option<&AuthorizationVersion>,
) -> SnapbackResult<()> {
    if participant.activation.state() != ACTIVATION_BOUND {
        return Err(participant_state_error(
            "authorization participant is not bound for activation",
        ));
    }
    let authorization = authorization.ok_or_else(|| {
        expectation_stale("durable authorization is absent during participant activation")
    })?;
    let state = participant.registry.lock();
    if participant.require_live_locked(true).is_err() {
        return Err(interlock_retired());
    }
    if state.durable_authorization.as_ref() != Some(authorization)
        || state.projected_authorization.as_ref() != Some(authorization)
        || !state.dependencies.is_empty()
        || state.active_durable_publications != 0
        || !state.projected_commits.is_empty()
        || state
            .rooms
            .values()
            .any(|control| !control.pending_tickets.is_empty())
    {
        return Err(projection_unavailable(
            "authorization participant was not initialized from the current durable snapshot",
        ));
    }
    Ok(())
}

fn classify_durable(
    state: &RoomAuthorityRegistryState,
    admit_fenced: bool,
    message: &DurableMessage,
) -> OutboxFrameDisposition {
    let Some(authorization) = message.authorization() else {
        return OutboxFrameDisposition::Send;
    };
    if !state.dependencies.is_empty() {
        return OutboxFrameDisposition::Retain;
    }
    if state.durable_authorization.as_ref() == Some(authorization) {
        if admit_fenced {
            OutboxFrameDisposition::Send
        } else {
            OutboxFrameDisposition::Retain
        }
    } else {
        OutboxFrameDisposition::DropStale
    }
}

fn classify_ephemeral(
    state: &RoomAuthorityRegistryState,
    admit_fenced: bool,
    message: &EphemeralMessage,
) -> OutboxFrameDisposition {
    if message.is_authority_independent_epoch_boundary() {
        return OutboxFrameDisposition::Send;
    }
    let Some((room, generation)) = message.room_authority() else {
        return OutboxFrameDisposition::Send;
    };
    let Some(control) = state.rooms.get(room) else {
        return if generation == 0 {
            OutboxFrameDisposition::Send
        } else {
            OutboxFrameDisposition::DropStale
        };
    };
    if control.retired || control.generation != generation {
        return OutboxFrameDisposition::DropStale;
    }
    if !control.pending_tickets.is_empty() {
        return OutboxFrameDisposition::Retain;
    }
    if let Some(resync) = &control.resync {
        let current_signal = resync.room_authority_generation == generation
            && matches!(
                message,
                EphemeralMessage::ResyncRequired {
                    reason: ResyncReason::AuthChanged,
                    ..
                }
            );
        return if current_signal && admit_fenced {
            OutboxFrameDisposition::Send
        } else {
            OutboxFrameDisposition::Retain
        };
    }
    if matches!(
        message,
        EphemeralMessage::ResyncRequired {
            reason: ResyncReason::AuthChanged,
            ..
        }
    ) {
        return OutboxFrameDisposition::DropStale;
    }
    if admit_fenced {
        OutboxFrameDisposition::Send
    } else {
        OutboxFrameDisposition::Retain
    }
}

fn finalize_known_commit(
    registry: &Arc<RoomAuthorityRegistry>,
    binding: &DatabaseBinding,
    registry_generation: u64,
    ticket_id: u64,
) -> SnapbackResult<()> {
    crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
        "room-authority commit finalization",
    );
    let mut state = registry.lock();
    let pending = state
        .dependencies
        .get(&ticket_id)
        .ok_or_else(|| expectation_stale("authorization dependency is absent at finalization"))?;
    let known = pending.known_commit.get().ok_or_else(|| {
        expectation_stale("authorization commit verdict is absent at finalization")
    })?;
    if registry.is_retired()
        || registry.generation() != registry_generation
        || !registry.binding_matches(binding)
        || pending.expected_authorization.get() != Some(&known.authorization)
        || state.durable_authorization != known.predecessor
        || pending.affected_rooms.iter().any(|room| {
            state.rooms.get(room).map_or(true, |control| {
                !control.pending_tickets.contains(&ticket_id)
            })
        })
    {
        return Err(expectation_stale(
            "authorization commit finalization facts changed",
        ));
    }
    if known.incarnation_rotated {
        if known.issuer_projected.load(Ordering::Acquire)
            || state.projected_commits.contains_key(&ticket_id)
            || state.projected_authorization != known.predecessor
        {
            return Err(expectation_stale(
                "rotated authorization commit has an invalid issuer projection",
            ));
        }
    } else if !known.issuer_projected.load(Ordering::Acquire)
        || state.projected_commits.get(&ticket_id) != Some(&known.authorization)
    {
        return Err(expectation_stale(
            "authorization issuer did not project the known commit",
        ));
    }
    let outcome = AuthorizationCommitOutcome {
        binding: binding.clone(),
        registry: registry.clone(),
        registry_generation,
        ticket_id,
        sequence: known.sequence,
        predecessor: known.predecessor.clone(),
        authorization: known.authorization.clone(),
        min_commit_version: known.min_commit_version,
        incarnation_rotated: known.incarnation_rotated,
    };
    let authorization = known.authorization.clone();
    let min_commit_version = known.min_commit_version;
    let incarnation_rotated = known.incarnation_rotated;
    let pending = state
        .dependencies
        .remove(&ticket_id)
        .expect("validated authorization dependency remains installed");
    if incarnation_rotated {
        state.projected_authorization = Some(authorization.clone());
    }
    state.durable_authorization = Some(authorization.clone());
    state.projected_commits.remove(&ticket_id);
    let mut retired = Vec::new();
    for room in pending.affected_rooms {
        let Some(control) = state.rooms.get_mut(&room) else {
            continue;
        };
        control.pending_tickets.remove(&ticket_id);
        if control.retired {
            if control.pending_tickets.is_empty() && control.active_permits == 0 {
                retired.push(room);
            }
            continue;
        }
        control.generation = control
            .generation
            .checked_add(1)
            .filter(|generation| *generation <= PORTABLE_STORAGE_VERSION_MAX)
            .expect("room generation was preflighted before authorization commit");
        control.resync = Some(RoomAuthorityResync {
            authorization: authorization.clone(),
            min_commit_version,
            room_authority_generation: control.generation,
        });
    }
    for room in retired {
        state.rooms.remove(&room);
    }
    state.latest_committed_outcome = Some(outcome);
    registry.quiescent.notify_all();
    Ok(())
}

fn schedule_rollback(registry: Arc<RoomAuthorityRegistry>, ticket_id: u64) {
    // @ref LLP 0059#locking-and-linearization — rollback removes only the
    // exact ticket and uses the finalizer bucket while Local is active.
    crate::exec_guard::run_or_defer_after_local_finalizer(move || {
        let mut state = registry.lock();
        rollback_ticket(&mut state, ticket_id);
        registry.quiescent.notify_all();
    });
}

fn rollback_ticket(state: &mut RoomAuthorityRegistryState, ticket_id: u64) -> bool {
    let Some(pending) = state.dependencies.remove(&ticket_id) else {
        return false;
    };
    let mut retired = Vec::new();
    for room in pending.affected_rooms {
        if let Some(control) = state.rooms.get_mut(&room) {
            control.pending_tickets.remove(&ticket_id);
            if control.retired && control.pending_tickets.is_empty() && control.active_permits == 0
            {
                retired.push(room);
            }
        }
    }
    for room in retired {
        state.rooms.remove(&room);
    }
    true
}

fn retire_room_in_state(state: &mut RoomAuthorityRegistryState, room: &RoomId) {
    let remove = state.rooms.get_mut(room).is_some_and(|control| {
        control.retired = true;
        control.resync = None;
        control.pending_tickets.is_empty() && control.active_permits == 0
    });
    if remove {
        state.rooms.remove(room);
    }
}

fn outcome_from_known(
    participant: &AuthorizationCommitParticipant,
    ticket_id: u64,
    known: &KnownAuthorizationCommit,
) -> AuthorizationCommitOutcome {
    AuthorizationCommitOutcome {
        binding: participant.binding.clone(),
        registry: participant.registry.clone(),
        registry_generation: participant.registry_generation,
        ticket_id,
        sequence: known.sequence,
        predecessor: known.predecessor.clone(),
        authorization: known.authorization.clone(),
        min_commit_version: known.min_commit_version,
        incarnation_rotated: known.incarnation_rotated,
    }
}

fn selector_for_collections(
    collections: &[EphemeralCollection],
    impact: AuthorizationCommitImpact<'_>,
) -> RoomDependencySelector {
    let AuthorizationCommitImpact::AppWrites { schema, changes } = impact else {
        return RoomDependencySelector::all();
    };
    selector_for_app_writes(collections, schema, changes)
}

fn selector_for_app_writes(
    collections: &[EphemeralCollection],
    schema: &SchemaManifest,
    changes: &[ChangedRow],
) -> RoomDependencySelector {
    let mut selector = RoomDependencySelector::default();
    for change in changes {
        for collection in collections {
            let Some(projection) = collection.permission_backing.as_ref() else {
                continue;
            };
            if projection.table != change.table {
                continue;
            }
            let Some(table) = schema.table(&change.table) else {
                selector.collections.insert(collection.name.clone());
                continue;
            };
            if matches!(change.op, super::ChangeOp::Update) {
                if change.changed_fields.is_empty()
                    || change
                        .changed_fields
                        .iter()
                        .any(|field| table.field(field).is_none())
                {
                    selector.collections.insert(collection.name.clone());
                    continue;
                }
                if change
                    .changed_fields
                    .iter()
                    .all(|field| !table.field_affects_authorization(field))
                {
                    continue;
                }
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
                    selector.collections.insert(collection.name.clone());
                }
            }
        }
    }
    selector
}

fn validate_registered_room(
    definitions: &[EphemeralCollection],
    room: &RoomId,
) -> Result<(), EphemeralError> {
    let collection = definitions
        .iter()
        .find(|definition| definition.name == room.collection)
        .ok_or_else(authority_pending_error)?;
    if room_id_for(collection, &room.scope)? != *room {
        return Err(authority_pending_error());
    }
    Ok(())
}

fn room_id_for(collection: &EphemeralCollection, scope: &Scope) -> Result<RoomId, EphemeralError> {
    let expected = collection.scope_fields.iter().collect::<BTreeSet<_>>();
    let actual = scope.0.keys().collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(EphemeralError::new(
            EphemeralErrorCode::InvalidScope,
            format!("scope keys do not match collection {}", collection.name),
        ));
    }
    let routing_key = scope
        .routed_key(&collection.routing_fields)
        .ok_or_else(|| {
            EphemeralError::new(
                EphemeralErrorCode::InvalidScope,
                format!("scope is missing a routing field for {}", collection.name),
            )
        })?;
    Ok(RoomId {
        collection: collection.name.clone(),
        scope: scope.clone(),
        routing_key,
    })
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

pub(super) fn authorization_reservation_stale(message: &'static str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_RESERVATION_STALE", "auth", message).with_details(
        serde_json::json!({
            "retryable": true,
            "retryStrategy": "short-jitter",
            "effectCommitted": false,
        }),
    )
}

fn projection_unavailable(message: &'static str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_PROJECTION_UNAVAILABLE", "auth", message)
}

fn expectation_stale(message: &'static str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE",
        "auth",
        message,
    )
}

fn participant_state_error(message: &'static str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_PARTICIPANT_NOT_PENDING", "auth", message)
}

fn participant_database_mismatch() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PARTICIPANT_DATABASE_MISMATCH",
        "auth",
        "authorization participant belongs to a different database",
    )
}

fn participant_registry_mismatch() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PARTICIPANT_REGISTRY_MISMATCH",
        "auth",
        "authorization participant registry does not match the database",
    )
}

fn participant_generation_mismatch() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PARTICIPANT_GENERATION_MISMATCH",
        "auth",
        "authorization participant registry generation is stale",
    )
}

fn interlock_retired() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_INTERLOCK_RETIRED",
        "auth",
        "authorization participant registry is retired",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        FieldManifest, FieldType, MembershipManifest, MembershipScope, TableManifest,
    };
    use crate::storage::{LocalDatabase, ServingDatabase};

    type TestRoomSettlement = Box<
        dyn FnOnce(&RoomReauthorizationCompletion) -> SnapbackResult<RoomReauthorizationDisposition>
            + Send,
    >;

    #[derive(Default)]
    struct TestRoomReauthorizationSettler {
        queued: Mutex<std::collections::VecDeque<TestRoomSettlement>>,
    }

    impl TestRoomReauthorizationSettler {
        fn push(
            &self,
            settle: impl FnOnce(
                &RoomReauthorizationCompletion,
            ) -> SnapbackResult<RoomReauthorizationDisposition>
            + Send
            + 'static,
        ) {
            self.queued
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push_back(Box::new(settle));
        }
    }

    // SAFETY: this kernel-private scaffold is installed only in unit fixtures;
    // each queued operation is the test's explicit model of the trusted sync
    // settlement owner and cannot be supplied through the public completion
    // call.
    unsafe impl RoomReauthorizationSettlementExecutor for TestRoomReauthorizationSettler {
        fn settle(
            &self,
            completion: &RoomReauthorizationCompletion,
        ) -> SnapbackResult<RoomReauthorizationDisposition> {
            let settle = self
                .queued
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .pop_front()
                .ok_or_else(|| {
                    projection_unavailable(
                        "kernel completion test did not install a settlement operation",
                    )
                })?;
            settle(completion)
        }
    }

    struct ReadyFixture {
        database: ServingDatabase,
        participant: AuthorizationCommitParticipant,
        settler: Arc<TestRoomReauthorizationSettler>,
        view: AuthorizationExpectationView,
        _issuer_projection: AuthorizationIssuerProjection,
        authorization: AuthorizationVersion,
    }

    fn ready_fixture() -> ReadyFixture {
        let local = LocalDatabase::memory().expect("in-memory database");
        let mut database = ServingDatabase::adopt(local).expect("serving database");
        let reservation = database
            .reserve_invalidation_boot_issuer()
            .expect("durable authorization snapshot");
        let authorization = reservation.authorization().clone();
        let participant = database
            .take_authorization_commit_participant()
            .expect("sole participant");
        let settler = Arc::new(TestRoomReauthorizationSettler::default());
        participant
            .install_room_reauthorization_settler(settler.clone())
            .expect("install the kernel-test settlement owner");
        database
            .bind_authorization_commit_participant(&participant)
            .expect("exact construction bind");
        let view = database
            .authorization_expectation_view_for_participant_install(&participant)
            .expect("kernel-owned expectation view");
        assert_eq!(view.current().unwrap(), authorization);
        let issuer_projection = view.clone().into_issuer_projection().unwrap();
        database
            .activate_authorization_commit_participant(&participant, &issuer_projection)
            .expect("ready participant");
        ReadyFixture {
            database,
            participant,
            settler,
            view,
            _issuer_projection: issuer_projection,
            authorization,
        }
    }

    fn protected_collection() -> EphemeralCollection {
        EphemeralCollection::local_cursor("boardCursors", "boardId")
            .require_room_permission("board")
    }

    fn protected_room() -> RoomId {
        room_id_for(
            &protected_collection(),
            &Scope::from_pairs([("boardId", "board-1")]),
        )
        .unwrap()
    }

    fn successor(predecessor: &AuthorizationVersion) -> AuthorizationVersion {
        AuthorizationVersion {
            incarnation: predecessor.incarnation.clone(),
            epoch: predecessor.epoch.checked_add(1).unwrap(),
        }
    }

    fn witness(authorization: AuthorizationVersion) -> AuthorizationCommitWitness {
        AuthorizationCommitWitness {
            version: authorization,
            event: true,
            incarnation_rotated: false,
            membership_declarations: Vec::new(),
        }
    }

    fn bind_all_rooms(
        fixture: &ReadyFixture,
        witness: &AuthorizationCommitWitness,
    ) -> PreparedAuthorizationCommit {
        let reservation = fixture
            .participant
            .prepare_authorization_commit(
                AuthorizationCommitPreflight::AllProtectedRooms,
                Arc::new(AuthorizationReservationCancellation::new()),
            )
            .unwrap();
        let binding = fixture.database.binding();
        reservation
            .bind(
                &binding,
                &fixture.database.db.authorization_interlock,
                Some(&fixture.authorization),
                witness,
                AuthorizationCommitImpact::AllProtectedRooms,
            )
            .unwrap()
    }

    fn install_room_resync(fixture: &ReadyFixture) -> RoomId {
        let collection = protected_collection().permission_backed_by(
            crate::ephemeral::RoomPermissionProjection {
                table: "memberships".to_owned(),
                subject_field: "userId".to_owned(),
                scope_fields: BTreeMap::from([("boardId".to_owned(), "boardId".to_owned())]),
                role_field: None,
                allowed_roles: None,
            },
        );
        fixture
            .participant
            .replace_protected_room_catalog(&[collection])
            .unwrap();
        let room = protected_room();
        drop(fixture.participant.begin_protected_room_act(&room).unwrap());
        let witness = witness(successor(&fixture.authorization));
        let prepared = bind_all_rooms(fixture, &witness);
        let mut scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        prepared.finalize_committed(7).unwrap();
        let after_local = scope.take_after_local_batch();
        drop(scope);
        let outcome = fixture
            .participant
            .committed_outcome(&witness, 7)
            .expect("known commit has one exact outcome");
        fixture.view.project_committed(&outcome).unwrap();
        crate::exec_guard::run_after_local_batch(after_local).unwrap();
        room
    }

    #[test]
    fn activation_requires_the_kernel_initialized_snapshot() {
        let local = LocalDatabase::memory().unwrap();
        let mut database = ServingDatabase::adopt(local).unwrap();
        assert!(
            !database
                .authorization_commit_reservation_required()
                .unwrap()
        );
        let reservation = database.reserve_invalidation_boot_issuer().unwrap();
        let authorization = reservation.authorization().clone();
        let participant = database.take_authorization_commit_participant().unwrap();
        let pending = database
            .authorization_commit_reservation_required()
            .expect_err("pending construction cannot select dormant serving");
        assert_eq!(
            pending.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
        database
            .bind_authorization_commit_participant(&participant)
            .unwrap();
        assert!(
            !database
                .authorization_commit_reservation_required()
                .unwrap()
        );

        let error = match AuthorizationExpectationView::new(
            participant.registry.clone(),
            participant.registry_generation,
            participant.activation.clone(),
            Arc::from(authorization.incarnation.clone()),
        )
        .into_issuer_projection()
        {
            Err(error) => error,
            Ok(_) => panic!("an uninitialized view cannot mint issuer projection proof"),
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );

        let view = database
            .authorization_expectation_view_for_participant_install(&participant)
            .unwrap();
        assert_eq!(view.current().unwrap(), authorization);
        let issuer_projection = view.into_issuer_projection().unwrap();
        database
            .activate_authorization_commit_participant(&participant, &issuer_projection)
            .unwrap();
        assert!(
            database
                .authorization_commit_reservation_required()
                .unwrap()
        );
    }

    #[test]
    fn projection_suspension_refuses_an_already_prepared_reservation_before_commit() {
        let fixture = ready_fixture();
        let reservation = fixture
            .participant
            .prepare_authorization_commit(
                AuthorizationCommitPreflight::AllProtectedRooms,
                Arc::new(AuthorizationReservationCancellation::new()),
            )
            .expect("prepare while the issuer projection is available");

        fixture.participant.suspend_authorization_projection();
        let availability = fixture
            .database
            .authorization_commit_reservation_required()
            .expect_err("suspended projection closes new authorization writes");
        assert_eq!(
            availability.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );

        let authorization = successor(&fixture.authorization);
        let error = match reservation.bind(
            &fixture.database.binding(),
            &fixture.database.db.authorization_interlock,
            Some(&fixture.authorization),
            &witness(authorization),
            AuthorizationCommitImpact::AllProtectedRooms,
        ) {
            Ok(_) => panic!("bind must recheck projection availability"),
            Err(error) => error,
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
        assert!(
            fixture.participant.registry.lock().dependencies.is_empty(),
            "failed bind exact-rolls back the prepared ticket"
        );
    }

    #[test]
    fn projection_suspension_invalidates_every_preclear_activation_carrier() {
        let mut fixture = ready_fixture();
        let stale_projection = fixture._issuer_projection.clone();
        fixture.participant.suspend_authorization_projection();

        let error = fixture
            .database
            .activate_authorization_commit_participant(&fixture.participant, &stale_projection)
            .expect_err("a pre-clear exact carrier cannot reactivate the latch");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE"
        );

        let successor_view = fixture
            .database
            .authorization_expectation_view_for_participant_install(&fixture.participant)
            .expect("obtain a post-clear exact view");
        let successor_projection = successor_view.into_issuer_projection().unwrap();
        fixture
            .database
            .activate_authorization_commit_participant(&fixture.participant, &successor_projection)
            .expect("only the post-clear carrier can reactivate");
    }

    #[test]
    fn participant_and_transaction_bind_reject_database_b() {
        let fixture_a = ready_fixture();
        let mut fixture_b = ready_fixture();

        let activation_error = fixture_b
            .database
            .activate_authorization_commit_participant(
                &fixture_a.participant,
                &fixture_a.view.clone().into_issuer_projection().unwrap(),
            )
            .expect_err("participant A cannot activate beside database B");
        assert_eq!(
            activation_error.diagnostic.code,
            "SNAPBACK_AUTH_PARTICIPANT_DATABASE_MISMATCH"
        );

        let reservation = fixture_a
            .participant
            .prepare_authorization_commit(
                AuthorizationCommitPreflight::AllProtectedRooms,
                Arc::new(AuthorizationReservationCancellation::new()),
            )
            .unwrap();
        let successor = successor(&fixture_a.authorization);
        let witness = witness(successor);
        let binding_b = fixture_b.database.binding();
        let error = match reservation.bind(
            &binding_b,
            &fixture_b.database.db.authorization_interlock,
            Some(&fixture_b.authorization),
            &witness,
            AuthorizationCommitImpact::AllProtectedRooms,
        ) {
            Err(error) => error,
            Ok(_) => panic!("transaction bind accepted database B's ready tuple"),
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PARTICIPANT_DATABASE_MISMATCH"
        );
        assert!(
            fixture_a
                .participant
                .registry
                .lock()
                .dependencies
                .is_empty()
        );
    }

    #[test]
    fn activation_rejects_a_foreign_projection_with_the_same_authorization_value() {
        let mut fixture = ready_fixture();
        let foreign = ready_fixture();
        {
            let mut state = foreign.participant.registry.lock();
            state.durable_authorization = Some(fixture.authorization.clone());
            state.projected_authorization = Some(fixture.authorization.clone());
        }
        let foreign_view = AuthorizationExpectationView::new(
            foreign.participant.registry.clone(),
            foreign.participant.registry_generation,
            foreign.participant.activation.clone(),
            Arc::from(fixture.authorization.incarnation.clone()),
        );
        let foreign_projection = foreign_view.into_issuer_projection().unwrap();
        assert_eq!(foreign_projection.current().unwrap(), fixture.authorization);

        let error = fixture
            .database
            .activate_authorization_commit_participant(&fixture.participant, &foreign_projection)
            .expect_err("matching durable values cannot substitute for exact issuer identity");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE"
        );
    }

    #[test]
    fn pending_database_rejects_a_substituted_same_database_registry() {
        let local = LocalDatabase::memory().unwrap();
        let mut database = ServingDatabase::adopt(local).unwrap();
        let expected = database.take_authorization_commit_participant().unwrap();
        let binding = database.binding();
        let substituted_registry = RoomAuthorityRegistry::new(binding.clone());
        let substituted_generation = substituted_registry.generation();
        let substituted_activation = Arc::new(AuthorizationParticipantActivation::pending());
        let substituted = AuthorizationCommitParticipant::new(
            binding,
            substituted_registry,
            substituted_generation,
            substituted_activation,
        );

        let error = database
            .bind_authorization_commit_participant(&substituted)
            .expect_err("database must retain the exact registry it minted");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PARTICIPANT_REGISTRY_MISMATCH"
        );
        database
            .bind_authorization_commit_participant(&expected)
            .expect("the exact pending participant still binds");
    }

    #[test]
    fn dropped_pending_participant_leaves_authorization_writes_fail_closed() {
        let local = LocalDatabase::memory().unwrap();
        let mut database = ServingDatabase::adopt(local).unwrap();
        let participant = database.take_authorization_commit_participant().unwrap();
        drop(participant);
        let AuthorizationInterlockState::ParticipantPending { activation, .. } =
            &database.db.authorization_interlock
        else {
            panic!("take must leave the database pending")
        };
        assert!(activation.upgrade().is_none());

        let witness = witness(AuthorizationVersion {
            incarnation: "dropped-pending".to_owned(),
            epoch: 1,
        });
        let error = match super::super::prepare_authorization_commit_interlock(
            &witness,
            AuthorizationCommitImpact::AllProtectedRooms,
            &database.db.authorization_interlock,
            &database.db.commit_authority_identity,
            None,
        ) {
            Err(error) => error,
            Ok(_) => panic!("pending construction cannot silently act disabled"),
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
    }

    #[test]
    fn premark_precedes_wait_and_exact_cancel_reopens_the_room() {
        use std::time::{Duration, Instant};

        let fixture = ready_fixture();
        fixture
            .participant
            .replace_protected_room_catalog(&[protected_collection()])
            .unwrap();
        let room = protected_room();
        let permit = fixture.participant.begin_protected_room_act(&room).unwrap();

        std::thread::scope(|scope| {
            let participant = &fixture.participant;
            let worker = scope.spawn(move || {
                participant.prepare_authorization_commit(
                    AuthorizationCommitPreflight::AllProtectedRooms,
                    Arc::new(AuthorizationReservationCancellation::new()),
                )
            });
            let deadline = Instant::now() + Duration::from_secs(1);
            loop {
                let state = fixture.participant.registry.lock();
                let premarked = state.dependencies.len() == 1
                    && state
                        .rooms
                        .get(&room)
                        .is_some_and(|control| control.pending_tickets.len() == 1);
                drop(state);
                if premarked {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "prepare did not premark before wait"
                );
                std::thread::yield_now();
            }
            assert!(fixture.participant.begin_protected_room_act(&room).is_err());
            drop(permit);
            worker.join().unwrap().unwrap().cancel();
        });

        let state = fixture.participant.registry.lock();
        assert!(state.dependencies.is_empty());
        assert!(state.rooms[&room].pending_tickets.is_empty());
    }

    #[test]
    fn retirement_wakes_waiter_and_exact_unmarks() {
        use std::time::{Duration, Instant};

        let fixture = ready_fixture();
        fixture
            .participant
            .replace_protected_room_catalog(&[protected_collection()])
            .unwrap();
        let room = protected_room();
        let permit = fixture.participant.begin_protected_room_act(&room).unwrap();

        std::thread::scope(|scope| {
            let participant = &fixture.participant;
            let worker = scope.spawn(move || {
                participant.prepare_authorization_commit(
                    AuthorizationCommitPreflight::AllProtectedRooms,
                    Arc::new(AuthorizationReservationCancellation::new()),
                )
            });
            let deadline = Instant::now() + Duration::from_secs(1);
            loop {
                if !fixture.participant.registry.lock().dependencies.is_empty() {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "prepare did not install dependency"
                );
                std::thread::yield_now();
            }
            fixture.participant.registry.retire().unwrap();
            let error = match worker.join().unwrap() {
                Err(error) => error,
                Ok(reservation) => {
                    reservation.cancel();
                    panic!("retirement did not abort prepare")
                }
            };
            assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_INTERLOCK_RETIRED");
        });
        drop(permit);
        let state = fixture.participant.registry.lock();
        assert!(state.dependencies.is_empty());
        assert!(state.rooms[&room].pending_tickets.is_empty());
    }

    #[test]
    fn catalog_drift_rejects_bind_and_rolls_back_exactly() {
        let fixture = ready_fixture();
        fixture
            .participant
            .replace_protected_room_catalog(&[protected_collection()])
            .unwrap();
        let reservation = fixture
            .participant
            .prepare_authorization_commit(
                AuthorizationCommitPreflight::AllProtectedRooms,
                Arc::new(AuthorizationReservationCancellation::new()),
            )
            .unwrap();
        fixture
            .participant
            .replace_protected_room_catalog(&[protected_collection()])
            .unwrap();
        let witness = witness(successor(&fixture.authorization));
        let binding = fixture.database.binding();
        let error = match reservation.bind(
            &binding,
            &fixture.database.db.authorization_interlock,
            Some(&fixture.authorization),
            &witness,
            AuthorizationCommitImpact::AllProtectedRooms,
        ) {
            Err(error) => error,
            Ok(_) => panic!("catalog revision drift unexpectedly bound"),
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_RESERVATION_STALE");
        assert!(fixture.participant.registry.lock().dependencies.is_empty());
    }

    #[test]
    fn issuer_projection_precedes_kernel_finalization() {
        let fixture = ready_fixture();
        fixture
            .participant
            .replace_protected_room_catalog(&[protected_collection()])
            .unwrap();
        let room = protected_room();
        drop(fixture.participant.begin_protected_room_act(&room).unwrap());
        let witness = witness(successor(&fixture.authorization));
        let prepared = bind_all_rooms(&fixture, &witness);

        let mut scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        prepared.finalize_committed(7).unwrap();
        let batch = scope.take_after_local_batch();
        drop(scope);

        let outcome = fixture
            .participant
            .committed_outcome(&witness, 7)
            .expect("known commit has one exact outcome");
        fixture.view.project_committed(&outcome).unwrap();
        {
            let state = fixture.participant.registry.lock();
            assert_eq!(state.projected_authorization, Some(witness.version.clone()));
            assert_eq!(
                state.durable_authorization,
                Some(fixture.authorization.clone())
            );
            assert_eq!(state.dependencies.len(), 1);
        }

        crate::exec_guard::run_after_local_batch(batch).unwrap();
        let state = fixture.participant.registry.lock();
        assert_eq!(state.durable_authorization, Some(witness.version.clone()));
        assert!(state.dependencies.is_empty());
        assert_eq!(state.rooms[&room].generation, 2);
        assert_eq!(
            state.rooms[&room].resync.as_ref().unwrap().authorization,
            witness.version
        );
    }

    #[test]
    fn reauthorization_batch_refuses_another_root_and_remains_retryable() {
        let source = ready_fixture();
        let target = ready_fixture();
        install_room_resync(&source);
        install_room_resync(&target);

        let wrong_database_pending = source.participant.pending_reauthorizations().pop().unwrap();
        let mismatch = match target.participant.resolve_room_reauthorization(
            &target.database,
            wrong_database_pending,
            Vec::new(),
        ) {
            Err(error) => error,
            Ok(_) => panic!("a different database resolved the source root"),
        };
        assert_eq!(
            mismatch.diagnostic.code,
            "SNAPBACK_AUTH_PARTICIPANT_DATABASE_MISMATCH"
        );
        assert_eq!(source.participant.pending_reauthorizations().len(), 1);

        let wrong_root_batch = source
            .participant
            .resolve_room_reauthorization(
                &source.database,
                source.participant.pending_reauthorizations().pop().unwrap(),
                Vec::new(),
            )
            .unwrap();
        assert!(
            !target
                .participant
                .run_room_reauthorization_completion(&target.database, wrong_root_batch)
                .unwrap(),
            "a live generation on another registry is not interchangeable"
        );
        assert_eq!(source.participant.pending_reauthorizations().len(), 1);

        let exact_batch = source
            .participant
            .resolve_room_reauthorization(
                &source.database,
                source.participant.pending_reauthorizations().pop().unwrap(),
                Vec::new(),
            )
            .unwrap();
        let stale_duplicate = source
            .participant
            .resolve_room_reauthorization(
                &source.database,
                source.participant.pending_reauthorizations().pop().unwrap(),
                Vec::new(),
            )
            .unwrap();
        source
            .settler
            .push(|_| Ok(RoomReauthorizationDisposition::Complete));
        assert!(
            source
                .participant
                .run_room_reauthorization_completion(&source.database, exact_batch)
                .unwrap(),
            "the exact root and generation admit completion"
        );
        assert!(source.participant.pending_reauthorizations().is_empty());
        assert!(
            !source
                .participant
                .run_room_reauthorization_completion(&source.database, stale_duplicate)
                .unwrap(),
            "clearing the level-triggered fact makes a duplicate batch stale"
        );
    }

    #[test]
    fn reauthorization_batch_refuses_a_reopened_handle_to_the_same_file() {
        let directory = tempfile::tempdir().expect("reauthorization reopen directory");
        let database_path = directory.path().join("snapback.sqlite3");
        let source = ready_file_fixture(&database_path);
        install_room_resync(&source);

        let pending_for_reopened_resolver = source
            .participant
            .pending_reauthorizations()
            .pop()
            .expect("source pending room batch");
        let source_batch = source
            .participant
            .resolve_room_reauthorization(
                &source.database,
                source
                    .participant
                    .pending_reauthorizations()
                    .pop()
                    .expect("source batch for completion"),
                Vec::new(),
            )
            .expect("source database derives its exact batch");

        let ReadyFixture {
            database: source_database,
            participant: source_participant,
            settler: _,
            view: source_view,
            _issuer_projection: source_projection,
            authorization: _,
        } = source;
        drop(source_database);
        drop(source_view);
        drop(source_projection);

        let target = ready_file_fixture(&database_path);
        let mismatch = match source_participant.resolve_room_reauthorization(
            &target.database,
            pending_for_reopened_resolver,
            Vec::new(),
        ) {
            Err(error) => error,
            Ok(_) => panic!("a reopened database handle resolved the predecessor graph"),
        };
        assert_eq!(
            mismatch.diagnostic.code,
            "SNAPBACK_AUTH_PARTICIPANT_DATABASE_MISMATCH"
        );
        assert!(
            !target
                .participant
                .run_room_reauthorization_completion(&target.database, source_batch)
                .expect("foreign batch is a retryable mismatch"),
            "a batch from the predecessor graph completed through a reopened handle"
        );

        install_room_resync(&target);
        let target_batch = target
            .participant
            .resolve_room_reauthorization(
                &target.database,
                target
                    .participant
                    .pending_reauthorizations()
                    .pop()
                    .expect("target pending room batch"),
                Vec::new(),
            )
            .expect("target database derives a fresh exact batch");
        target
            .settler
            .push(|_| Ok(RoomReauthorizationDisposition::Complete));
        assert!(
            target
                .participant
                .run_room_reauthorization_completion(&target.database, target_batch)
                .expect("reopened graph remains operational"),
            "fresh exact target batch reaches completion"
        );
        assert!(target.participant.pending_reauthorizations().is_empty());
    }

    #[test]
    fn room_reauthorization_completion_refuses_local_scope_and_remains_retryable() {
        let fixture = ready_fixture();
        install_room_resync(&fixture);
        let batch = fixture
            .participant
            .resolve_room_reauthorization(
                &fixture.database,
                fixture
                    .participant
                    .pending_reauthorizations()
                    .pop()
                    .expect("pending room batch"),
                Vec::new(),
            )
            .expect("database-derived room batch");

        // @ref LLP 0059#prohibited-overlap — a public or doc-hidden
        // completion owner captured by caller-supplied Local code must refuse
        // before lifecycle, SQLite, registry, or room state is acquired.
        let local_scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        let error = match fixture
            .participant
            .run_room_reauthorization_completion(&fixture.database, batch)
        {
            Err(error) => error,
            Ok(_) => panic!("completion entered beneath LocalSnapback"),
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_INTERLOCK_LOCAL_SCOPE_FORBIDDEN"
        );
        drop(local_scope);

        assert_eq!(
            fixture.participant.pending_reauthorizations().len(),
            1,
            "refusal leaves the level-triggered obligation retryable"
        );
        let retry = fixture
            .participant
            .resolve_room_reauthorization(
                &fixture.database,
                fixture
                    .participant
                    .pending_reauthorizations()
                    .pop()
                    .expect("retry pending room batch"),
                Vec::new(),
            )
            .expect("retry derives a fresh batch");
        fixture
            .settler
            .push(|_| Ok(RoomReauthorizationDisposition::Complete));
        assert!(
            fixture
                .participant
                .run_room_reauthorization_completion(&fixture.database, retry)
                .expect("outside-Local retry remains operational"),
            "exact retry reaches completion"
        );
        assert!(fixture.participant.pending_reauthorizations().is_empty());
    }

    #[test]
    fn stranded_room_reauthorization_completion_cannot_wedge_writer_or_participant_replacement() {
        use std::sync::mpsc;
        use std::time::Duration;

        let fixture = ready_fixture();
        let room = install_room_resync(&fixture);
        let generation = fixture.participant.room_generation(&room);
        let stranded = fixture
            .participant
            .begin_room_reauthorization_fence(&room, generation)
            .expect("claim a valid internal completion fence");
        let stranded_state = stranded.completion.clone();
        std::mem::forget(stranded);

        let ReadyFixture {
            mut database,
            participant,
            settler: _,
            view,
            _issuer_projection,
            authorization: _,
        } = fixture;
        let participant = Arc::new(participant);
        let writer_participant = participant.clone();
        let (writer_tx, writer_rx) = mpsc::channel();
        let writer = std::thread::spawn(move || {
            let result = writer_participant.prepare_authorization_commit(
                AuthorizationCommitPreflight::AllProtectedRooms,
                Arc::new(AuthorizationReservationCancellation::new()),
            );
            writer_tx
                .send(result)
                .expect("return stranded-fence writer result");
        });
        let reservation = writer_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("authorization writer cannot wait on destructor execution")
            .expect("authorization writer remains operational");
        reservation.cancel();
        writer.join().expect("authorization writer joins");
        assert_eq!(
            stranded_state.disposition.load(Ordering::Acquire),
            ROOM_REAUTHORIZATION_ABANDONED,
            "writer premark invalidates the destructor-suppressed fence"
        );

        let stranded = participant
            .begin_room_reauthorization_fence(&room, generation)
            .expect("claim a second valid internal completion fence");
        let stranded_state = stranded.completion.clone();
        std::mem::forget(stranded);
        let (replacement_tx, replacement_rx) = mpsc::channel();
        let replacement = std::thread::spawn(move || {
            let result = database
                .replace_authorization_commit_participant()
                .map(|_| ());
            replacement_tx
                .send(result)
                .expect("return stranded-fence replacement result");
        });
        replacement_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("participant replacement cannot wait on destructor execution")
            .expect("participant replacement remains operational");
        replacement.join().expect("participant replacement joins");
        assert_eq!(
            stranded_state.disposition.load(Ordering::Acquire),
            ROOM_REAUTHORIZATION_ABANDONED,
            "replacement invalidates the destructor-suppressed fence"
        );

        drop(view);
        drop(_issuer_projection);
        drop(participant);
    }

    #[test]
    fn participant_bound_settlement_serializes_writer_and_participant_replacement() {
        use std::sync::mpsc;
        use std::time::Duration;

        let writer_directory = tempfile::tempdir().expect("retained writer-completion directory");
        let writer_database_path = writer_directory.path().join("snapback.sqlite3");
        let mut writer_fixture = ready_file_fixture(&writer_database_path);
        install_room_resync(&writer_fixture);
        let writer_batch = writer_fixture
            .participant
            .resolve_room_reauthorization(
                &writer_fixture.database,
                writer_fixture
                    .participant
                    .pending_reauthorizations()
                    .pop()
                    .expect("real pending writer room batch"),
                Vec::new(),
            )
            .expect("resolve the writer room batch");
        let writer_completion_database = writer_fixture
            .database
            .take_room_reauthorization_database()
            .expect("claim the writer off-Local completion database");
        let ReadyFixture {
            database: _,
            participant: writer_participant,
            settler: writer_settler,
            view: writer_view,
            _issuer_projection: writer_issuer_projection,
            authorization: _,
        } = writer_fixture;
        let writer_participant = Arc::new(writer_participant);
        let completion_participant = writer_participant.clone();
        let (writer_entered_tx, writer_entered_rx) = mpsc::channel();
        let (writer_release_tx, writer_release_rx) = mpsc::channel();
        let (writer_completion_tx, writer_completion_rx) = mpsc::channel();
        writer_settler.push(move |_| {
            writer_entered_tx
                .send(())
                .expect("signal entered writer settlement");
            writer_release_rx.recv().expect("release writer settlement");
            Ok(RoomReauthorizationDisposition::Complete)
        });
        let writer_completion = std::thread::spawn(move || {
            let result = completion_participant.run_room_reauthorization_completion_off_local(
                &writer_completion_database,
                writer_batch,
            );
            writer_completion_tx
                .send(result)
                .expect("return retained writer completion");
        });
        writer_entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("writer completion reaches its participant-bound settlement");
        let pending_writer = writer_participant.clone();
        let (reservation_tx, reservation_rx) = mpsc::channel();
        let reservation_thread = std::thread::spawn(move || {
            let result = pending_writer.prepare_authorization_commit(
                AuthorizationCommitPreflight::AllProtectedRooms,
                Arc::new(AuthorizationReservationCancellation::new()),
            );
            reservation_tx
                .send(result)
                .expect("return settlement-serialized writer result");
        });
        assert!(
            reservation_rx
                .recv_timeout(Duration::from_millis(50))
                .is_err(),
            "the writer cannot premark after exact settlement validation but before its effects"
        );
        writer_release_tx
            .send(())
            .expect("release participant-bound writer settlement");
        assert!(
            writer_completion_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("writer settlement returns for cleanup")
                .expect("writer settlement remains operational"),
            "exact settlement completes before the writer premark"
        );
        reservation_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("writer resumes after settlement")
            .expect("writer remains operational")
            .cancel();
        reservation_thread.join().expect("writer thread joins");
        writer_completion
            .join()
            .expect("retained writer callback joins");
        drop(writer_view);
        drop(writer_issuer_projection);
        drop(writer_participant);

        let replacement_directory =
            tempfile::tempdir().expect("retained replacement-completion directory");
        let replacement_database_path = replacement_directory.path().join("snapback.sqlite3");
        let mut replacement_fixture = ready_file_fixture(&replacement_database_path);
        install_room_resync(&replacement_fixture);
        let replacement_batch = replacement_fixture
            .participant
            .resolve_room_reauthorization(
                &replacement_fixture.database,
                replacement_fixture
                    .participant
                    .pending_reauthorizations()
                    .pop()
                    .expect("real pending replacement room batch"),
                Vec::new(),
            )
            .expect("resolve the replacement room batch");
        let replacement_completion_database = replacement_fixture
            .database
            .take_room_reauthorization_database()
            .expect("claim the replacement off-Local completion database");
        let ReadyFixture {
            mut database,
            participant: replacement_participant,
            settler: replacement_settler,
            view: replacement_view,
            _issuer_projection: replacement_issuer_projection,
            authorization: _,
        } = replacement_fixture;
        let replacement_participant = Arc::new(replacement_participant);
        let completion_participant = replacement_participant.clone();
        let (replacement_entered_tx, replacement_entered_rx) = mpsc::channel();
        let (replacement_release_tx, replacement_release_rx) = mpsc::channel();
        let (replacement_completion_tx, replacement_completion_rx) = mpsc::channel();
        replacement_settler.push(move |_| {
            replacement_entered_tx
                .send(())
                .expect("signal entered replacement settlement");
            replacement_release_rx
                .recv()
                .expect("release replacement settlement");
            Ok(RoomReauthorizationDisposition::Complete)
        });
        let replacement_completion = std::thread::spawn(move || {
            let result = completion_participant.run_room_reauthorization_completion_off_local(
                &replacement_completion_database,
                replacement_batch,
            );
            replacement_completion_tx
                .send(result)
                .expect("return retained replacement completion");
        });
        replacement_entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("replacement completion reaches participant-bound settlement");
        let (replacement_tx, replacement_rx) = mpsc::channel();
        let replacement = std::thread::spawn(move || {
            let result = database
                .replace_authorization_commit_participant()
                .map(|_| ());
            replacement_tx
                .send(result)
                .expect("return retained-callback replacement result");
        });
        assert!(
            replacement_rx
                .recv_timeout(Duration::from_millis(50))
                .is_err(),
            "replacement cannot retire the exact participant midway through settlement"
        );
        replacement_release_tx
            .send(())
            .expect("release participant-bound replacement settlement");
        assert!(
            replacement_completion_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("replacement settlement returns for cleanup")
                .expect("replacement settlement remains operational"),
            "settlement finishes before participant replacement"
        );
        replacement_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("replacement resumes after settlement")
            .expect("replacement remains operational");
        replacement.join().expect("participant replacement joins");
        replacement_completion
            .join()
            .expect("retained replacement callback joins");
        drop(replacement_view);
        drop(replacement_issuer_projection);
        drop(replacement_participant);
    }

    #[test]
    fn room_reauthorization_without_a_settlement_operation_keeps_the_obligation() {
        let fixture = ready_fixture();
        install_room_resync(&fixture);
        let batch = fixture
            .participant
            .resolve_room_reauthorization(
                &fixture.database,
                fixture
                    .participant
                    .pending_reauthorizations()
                    .pop()
                    .expect("real pending room batch"),
                Vec::new(),
            )
            .expect("resolve the pending room batch");
        let error = fixture
            .participant
            .run_room_reauthorization_completion(&fixture.database, batch)
            .expect_err("no caller claim can substitute for a settlement operation");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
        assert_eq!(
            fixture.participant.pending_reauthorizations().len(),
            1,
            "missing settlement retains the level-triggered obligation"
        );
    }

    #[test]
    fn writer_premark_preempts_before_settlement_claim_without_running_effects() {
        use std::sync::Barrier;
        use std::sync::mpsc;
        use std::time::Duration;

        let fixture = ready_fixture();
        install_room_resync(&fixture);
        let batch = fixture
            .participant
            .resolve_room_reauthorization(
                &fixture.database,
                fixture
                    .participant
                    .pending_reauthorizations()
                    .pop()
                    .expect("real pending room batch"),
                Vec::new(),
            )
            .expect("resolve the pending room batch");
        let ReadyFixture {
            database,
            participant,
            settler,
            view,
            _issuer_projection,
            authorization: _,
        } = fixture;
        let participant = Arc::new(participant);
        settler.push(|_| panic!("a preempted completion must not reach settlement effects"));
        let before_claim = Arc::new(Barrier::new(2));
        let release_claim = Arc::new(Barrier::new(2));
        participant
            .registry
            .install_completion_before_settlement_claim_witness(
                before_claim.clone(),
                release_claim.clone(),
            );
        let completion_participant = participant.clone();
        let (completed_tx, completed_rx) = mpsc::channel();
        let completion = std::thread::spawn(move || {
            let result =
                completion_participant.run_room_reauthorization_completion(&database, batch);
            completed_tx
                .send(result)
                .expect("return preempted completion result");
        });
        before_claim.wait();

        let reservation = participant
            .prepare_authorization_commit(
                AuthorizationCommitPreflight::AllProtectedRooms,
                Arc::new(AuthorizationReservationCancellation::new()),
            )
            .expect("writer premark wins before the completion claims settlement");
        release_claim.wait();
        assert_eq!(
            completed_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("preempted completion returns")
                .expect("preempted completion remains operational"),
            false,
            "an invalidated completion cannot enter settlement"
        );
        reservation.cancel();
        completion.join().expect("late completion joins");
        assert_eq!(
            participant.pending_reauthorizations().len(),
            1,
            "preemption keeps the old level-triggered obligation pending"
        );

        drop(view);
        drop(_issuer_projection);
    }

    #[test]
    fn ready_interlock_requires_the_exact_projection_carrier_to_remain_live() {
        let ReadyFixture {
            database,
            _issuer_projection: issuer_projection,
            ..
        } = ready_fixture();
        assert!(
            database
                .authorization_commit_reservation_required()
                .unwrap()
        );
        drop(issuer_projection);

        let error = database
            .authorization_commit_reservation_required()
            .expect_err("a ready latch cannot outlive its exact issuer projection");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
    }

    #[test]
    fn missing_projection_at_deferred_finalization_latches_fail_closed_without_panicking() {
        let fixture = ready_fixture();
        let witness = witness(successor(&fixture.authorization));
        let prepared = bind_all_rooms(&fixture, &witness);
        let mut scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        prepared.finalize_committed(11).unwrap();
        let batch = scope.take_after_local_batch();
        drop(scope);

        let finalization_error = crate::exec_guard::run_after_local_batch(batch)
            .expect_err("missing issuer projection is a checked finalization failure");
        assert_eq!(
            finalization_error.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );

        let error = fixture
            .database
            .authorization_commit_reservation_required()
            .expect_err("an unprojected durable commit must poison the latch");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
        assert!(error.diagnostic.message.contains("failed closed"));
        assert_eq!(fixture.participant.registry.lock().dependencies.len(), 1);
    }

    #[test]
    fn rollback_removes_exact_ticket_but_ambiguity_retains_it() {
        let fixture = ready_fixture();
        let witness = witness(successor(&fixture.authorization));

        bind_all_rooms(&fixture, &witness).finalize_rolled_back();
        assert!(fixture.participant.registry.lock().dependencies.is_empty());

        bind_all_rooms(&fixture, &witness).finalize_ambiguous();
        assert_eq!(fixture.participant.registry.lock().dependencies.len(), 1);
    }

    #[test]
    fn outcome_lookup_refuses_non_unique_synthetic_known_commits() {
        let fixture = ready_fixture();
        let witness = witness(successor(&fixture.authorization));
        let first = bind_all_rooms(&fixture, &witness);
        let second = bind_all_rooms(&fixture, &witness);
        let mut scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        first.finalize_committed(9).unwrap();
        second.finalize_committed(9).unwrap();
        let _batch = scope.take_after_local_batch();
        drop(scope);

        let error = match fixture.participant.committed_outcome(&witness, 9) {
            Err(error) => error,
            Ok(_) => panic!("outcome lookup selected between two matches"),
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE"
        );
    }

    #[test]
    fn same_database_replacement_retires_every_old_view_and_guard() {
        let mut fixture = ready_fixture();
        fixture
            .participant
            .replace_protected_room_catalog(&[protected_collection()])
            .unwrap();
        let room = protected_room();
        drop(fixture.participant.begin_protected_room_act(&room).unwrap());
        let old_reservation = fixture
            .participant
            .prepare_authorization_commit(
                AuthorizationCommitPreflight::AllProtectedRooms,
                Arc::new(AuthorizationReservationCancellation::new()),
            )
            .unwrap();
        let old_generation = fixture.participant.registry_generation;
        let old_view = fixture.view.clone();

        let replacement = fixture
            .database
            .replace_authorization_commit_participant()
            .unwrap();
        assert_eq!(replacement.registry_generation, old_generation + 1);
        assert!(old_view.current().is_err());
        assert!(fixture.participant.begin_protected_room_act(&room).is_err());

        fixture
            .database
            .bind_authorization_commit_participant(&replacement)
            .unwrap();
        replacement
            .replace_protected_room_catalog(&[protected_collection()])
            .unwrap();
        let replacement_view = fixture
            .database
            .authorization_expectation_view_for_participant_install(&replacement)
            .unwrap();
        assert_eq!(replacement_view.current().unwrap(), fixture.authorization);
        let replacement_projection = replacement_view.into_issuer_projection().unwrap();
        fixture
            .database
            .activate_authorization_commit_participant(&replacement, &replacement_projection)
            .unwrap();
        assert_eq!(replacement.room_generation(&room), 0);

        let witness = witness(successor(&fixture.authorization));
        let binding = fixture.database.binding();
        let error = match old_reservation.bind(
            &binding,
            &fixture.database.db.authorization_interlock,
            Some(&fixture.authorization),
            &witness,
            AuthorizationCommitImpact::AllProtectedRooms,
        ) {
            Err(error) => error,
            Ok(_) => panic!("a reservation from the retired registry cannot bind"),
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PARTICIPANT_REGISTRY_MISMATCH"
        );
    }

    #[test]
    fn replacement_refuses_a_committed_dependency_until_its_finalizer_drains() {
        let mut fixture = ready_fixture();
        let authorization = successor(&fixture.authorization);
        let witness = witness(authorization.clone());
        let prepared = bind_all_rooms(&fixture, &witness);

        let mut scope = crate::exec_guard::LocalSnapbackWriteScope::enter();
        prepared.finalize_committed(9).unwrap();
        let batch = scope.take_after_local_batch();
        drop(scope);

        let outcome = fixture
            .participant
            .committed_outcome(&witness, 9)
            .expect("known commit exposes its exact deferred outcome");
        fixture
            .view
            .project_committed(&outcome)
            .expect("issuer projects before the kernel finalizer");

        let error = match fixture.database.replace_authorization_commit_participant() {
            Err(error) => error,
            Ok(_) => panic!("replacement cannot retire a committed dependency"),
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PARTICIPANT_DEPENDENCY_PENDING"
        );
        assert!(!fixture.participant.registry.is_retired());

        crate::exec_guard::run_after_local_batch(batch).unwrap();
        assert_eq!(fixture.view.current().unwrap(), authorization);
        fixture
            .database
            .replace_authorization_commit_participant()
            .expect("replacement succeeds after the exact finalizer drains");
    }

    #[test]
    fn membership_projection_selector_stays_narrow_and_unknown_fields_widen() {
        let projection = crate::ephemeral::RoomPermissionProjection {
            table: "memberships".to_owned(),
            subject_field: "userId".to_owned(),
            scope_fields: BTreeMap::from([("boardId".to_owned(), "boardId".to_owned())]),
            role_field: Some("role".to_owned()),
            allowed_roles: Some(vec!["member".to_owned()]),
        };
        let collection = protected_collection().permission_backed_by(projection);
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
        let schema = SchemaManifest {
            tables: vec![table],
            ..SchemaManifest::default()
        };
        let change = ChangedRow {
            table: "memberships".to_owned(),
            id: "member-a".to_owned(),
            op: super::super::ChangeOp::Update,
            row: Some(serde_json::json!({
                "boardId": "board-1",
                "userId": "user-a",
                "role": "guest"
            })),
            changed_fields: vec!["role".to_owned()],
        };
        let affected =
            room_id_for(&collection, &Scope::from_pairs([("boardId", "board-1")])).unwrap();
        let unrelated =
            room_id_for(&collection, &Scope::from_pairs([("boardId", "board-2")])).unwrap();
        let narrow = selector_for_app_writes(
            std::slice::from_ref(&collection),
            &schema,
            std::slice::from_ref(&change),
        );
        assert!(narrow.matches(&affected));
        assert!(!narrow.matches(&unrelated));

        let unknown = ChangedRow {
            changed_fields: vec!["futureField".to_owned()],
            ..change
        };
        let widened = selector_for_app_writes(&[collection], &schema, &[unknown]);
        assert!(widened.matches(&affected));
        assert!(widened.matches(&unrelated));
    }

    fn ready_file_fixture(database_path: &std::path::Path) -> ReadyFixture {
        let local =
            LocalDatabase::open(database_path).expect("file-backed reauthorization fixture");
        let mut database = ServingDatabase::adopt(local).expect("serving database");
        let reservation = database
            .reserve_invalidation_boot_issuer()
            .expect("durable authorization snapshot");
        let authorization = reservation.authorization().clone();
        let participant = database
            .take_authorization_commit_participant()
            .expect("sole participant");
        let settler = Arc::new(TestRoomReauthorizationSettler::default());
        participant
            .install_room_reauthorization_settler(settler.clone())
            .expect("install the kernel-test settlement owner");
        database
            .bind_authorization_commit_participant(&participant)
            .expect("exact construction bind");
        let view = database
            .authorization_expectation_view_for_participant_install(&participant)
            .expect("kernel-owned expectation view");
        assert_eq!(view.current().unwrap(), authorization);
        let issuer_projection = view.clone().into_issuer_projection().unwrap();
        database
            .activate_authorization_commit_participant(&participant, &issuer_projection)
            .expect("ready participant");
        ReadyFixture {
            database,
            participant,
            settler,
            view,
            _issuer_projection: issuer_projection,
            authorization,
        }
    }

    #[test]
    fn room_reauthorization_sqlite_contention_uses_off_local_database_lane() {
        use std::sync::mpsc;
        use std::time::{Duration, Instant};

        let directory = tempfile::tempdir().expect("reauthorization contention directory");
        let database_path = directory.path().join("snapback.sqlite3");
        let mut fixture = ready_file_fixture(&database_path);
        install_room_resync(&fixture);
        let batch = fixture
            .participant
            .resolve_room_reauthorization(
                &fixture.database,
                fixture
                    .participant
                    .pending_reauthorizations()
                    .pop()
                    .expect("real pending room batch"),
                Vec::new(),
            )
            .expect("resolve the pending room batch");
        let completion_database = fixture
            .database
            .take_room_reauthorization_database()
            .expect("claim the off-Local completion database");
        let ReadyFixture {
            database: _,
            participant,
            settler,
            view: _,
            _issuer_projection,
            authorization: _,
        } = fixture;
        let participant = Arc::new(participant);
        settler.push(|_| Ok(RoomReauthorizationDisposition::Complete));

        let writer = rusqlite::Connection::open(&database_path)
            .expect("open independent SQLite writer connection");
        writer
            .execute_batch("BEGIN IMMEDIATE")
            .expect("independent writer owns SQLite reservation");

        let completion_participant = participant.clone();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (completed_tx, completed_rx) = mpsc::channel();
        let completion = std::thread::spawn(move || {
            entered_tx.send(()).expect("signal completion start");
            let started = Instant::now();
            let result = completion_participant
                .run_room_reauthorization_completion_off_local(&completion_database, batch);
            completed_tx
                .send((started.elapsed(), result))
                .expect("return contended completion result");
        });
        entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("completion starts while the independent writer is held");
        std::thread::sleep(Duration::from_millis(50));
        assert!(
            completed_rx.try_recv().is_err(),
            "completion must still be waiting for SQLite"
        );

        let pending_participant = participant.clone();
        let (pending_tx, pending_rx) = mpsc::channel();
        let registry_probe = std::thread::spawn(move || {
            let started = Instant::now();
            let count = pending_participant.pending_reauthorizations().len();
            pending_tx
                .send((started.elapsed(), count))
                .expect("return concurrent registry observation");
        });
        let pending_result = pending_rx.recv_timeout(Duration::from_millis(250));

        writer
            .execute_batch("ROLLBACK")
            .expect("release independent SQLite writer");
        let (completion_elapsed, completion_result) = completed_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("completion returns without SQLite's five-second timeout");
        completion.join().expect("completion thread joins");
        registry_probe.join().expect("registry probe thread joins");

        let (registry_elapsed, pending_count) = pending_result
            .expect("pending-room enumeration is not blocked behind SQLite contention");
        eprintln!(
            "contention timings: registry={registry_elapsed:?}, completion={completion_elapsed:?}"
        );
        assert_eq!(pending_count, 1, "the obligation remains observable");
        assert!(
            registry_elapsed < Duration::from_millis(250),
            "registry observation took {registry_elapsed:?}"
        );
        assert!(
            completion_elapsed < Duration::from_secs(1),
            "completion took {completion_elapsed:?} after a bounded writer hold"
        );
        assert_eq!(
            completion_result.expect("completion remains operational"),
            true,
            "the exact batch completes after SQLite becomes available"
        );
    }

    #[test]
    fn room_reauthorization_reverse_schedule_cannot_deadlock_registry_to_sqlite_against_completion()
    {
        use rusqlite::TransactionBehavior;
        use std::sync::{Barrier, mpsc};
        use std::time::Duration;

        let directory = tempfile::tempdir().expect("reauthorization reverse-schedule directory");
        let database_path = directory.path().join("snapback.sqlite3");
        let mut fixture = ready_file_fixture(&database_path);
        install_room_resync(&fixture);
        let batch = fixture
            .participant
            .resolve_room_reauthorization(
                &fixture.database,
                fixture
                    .participant
                    .pending_reauthorizations()
                    .pop()
                    .expect("real pending room batch"),
                Vec::new(),
            )
            .expect("resolve the pending room batch");
        let completion_database = fixture
            .database
            .take_room_reauthorization_database()
            .expect("claim the off-Local completion database");
        let ReadyFixture {
            database: _,
            participant,
            settler,
            view: _,
            _issuer_projection,
            authorization: _,
        } = fixture;
        let participant = Arc::new(participant);
        settler.push(|_| Ok(RoomReauthorizationDisposition::Complete));

        // Stop the completion while it actually owns the registry. In the
        // repaired order SQLite is not yet acquired; under the SQLite-first
        // mutation the completion already owns both resources before this
        // witness fires.
        let registry_acquired = Arc::new(Barrier::new(2));
        let release_registry = Arc::new(Barrier::new(2));
        participant
            .registry
            .install_completion_registry_acquired_witness(
                registry_acquired.clone(),
                release_registry.clone(),
            );
        let completion_participant = participant.clone();
        let (completed_tx, completed_rx) = mpsc::channel();
        let completion = std::thread::spawn(move || {
            let result = completion_participant
                .run_room_reauthorization_completion_off_local(&completion_database, batch);
            completed_tx
                .send(result)
                .expect("return reverse-schedule completion result");
        });
        registry_acquired.wait();

        // This successful BEGIN is the SQLite acquisition witness, not a
        // scheduling inference. It can succeed while the completion is held
        // at the registry barrier only when completion acquired registry
        // before SQLite.
        let mut reverse_writer = rusqlite::Connection::open(&database_path)
            .expect("open reverse-schedule SQLite writer");
        reverse_writer
            .busy_timeout(Duration::from_secs(30))
            .expect("extend SQLite wait beyond the outer deadlock alarm");
        let reverse_transaction = reverse_writer
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .expect("reverse writer acquires SQLite while completion owns registry");

        // Let completion release registry and block on the witnessed SQLite
        // owner. Acquiring registry here completes the exact reverse schedule
        // without relying on elapsed time.
        release_registry.wait();
        let registry_guard = participant
            .begin_outbox_admission(false)
            .expect("SQLite-owning reverse writer can acquire registry");
        drop(reverse_transaction);
        drop(registry_guard);

        let result = completed_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("completion returns after the reverse writer releases SQLite");
        completion.join().expect("completion thread joins");
        assert_eq!(
            result.expect("completion remains operational"),
            true,
            "the exact batch completes after the acyclic reverse schedule"
        );
    }
}
