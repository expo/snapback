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
    AccessPolicy, DurableMessage, EphemeralCollection, EphemeralError, EphemeralErrorCode,
    EphemeralMessage, RealtimeEnvelope, ResyncReason, RoomId, Scope,
    validate_collection_definitions,
};
use crate::manifest::{PORTABLE_STORAGE_VERSION_MAX, SchemaManifest};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock, PoisonError};

const ACTIVATION_PENDING: u8 = 0;
const ACTIVATION_BOUND: u8 = 1;
const ACTIVATION_READY: u8 = 2;
const ACTIVATION_RETIRED: u8 = 3;

pub(super) struct AuthorizationParticipantActivation {
    state: AtomicU8,
}

impl AuthorizationParticipantActivation {
    pub(super) fn pending() -> Self {
        Self {
            state: AtomicU8::new(ACTIVATION_PENDING),
        }
    }

    fn state(&self) -> u8 {
        self.state.load(Ordering::Acquire)
    }

    pub(super) fn transition(&self, from: u8, to: u8) -> SnapbackResult<()> {
        self.state
            .compare_exchange(from, to, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ())
            .map_err(|_| participant_state_error("authorization participant activation changed"))
    }

    pub(super) fn retire(&self) {
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
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PendingRoomReauthorization {
    pub room: RoomId,
    pub obligation: RoomAuthorityResync,
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

struct RoomAuthorityRegistryState {
    next_ticket: u64,
    dependencies: BTreeMap<u64, RoomDependencyPending>,
    rooms: BTreeMap<RoomId, RoomAuthorityControl>,
    durable_authorization: Option<AuthorizationVersion>,
    projected_authorization: Option<AuthorizationVersion>,
    projected_commits: BTreeMap<u64, AuthorizationVersion>,
    active_durable_publications: usize,
    protected_collections: Arc<[EphemeralCollection]>,
    protected_collection_revision: u64,
    next_outcome_sequence: u64,
    latest_committed_outcome: Option<AuthorizationCommitOutcome>,
}

pub(super) struct RoomAuthorityRegistry {
    binding: DatabaseBinding,
    generation: AtomicU64,
    retired: AtomicBool,
    catalog_revision: AtomicU64,
    state: Mutex<RoomAuthorityRegistryState>,
    quiescent: Condvar,
}

impl RoomAuthorityRegistry {
    pub(super) fn new(binding: DatabaseBinding) -> Arc<Self> {
        Self::new_with_generation(binding, 1)
    }

    pub(super) fn new_with_generation(binding: DatabaseBinding, generation: u64) -> Arc<Self> {
        Arc::new(Self {
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
                active_durable_publications: 0,
                protected_collections: Arc::from([]),
                protected_collection_revision: 1,
                next_outcome_sequence: 1,
                latest_committed_outcome: None,
            }),
            quiescent: Condvar::new(),
        })
    }

    fn lock(&self) -> MutexGuard<'_, RoomAuthorityRegistryState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn binding_matches(&self, binding: &DatabaseBinding) -> bool {
        self.binding.matches(binding)
    }

    pub(super) fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    pub(super) fn is_retired(&self) -> bool {
        self.retired.load(Ordering::Acquire)
    }

    pub(super) fn retire(&self) {
        self.retired.store(true, Ordering::Release);
        self.quiescent.notify_all();
    }
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
        }
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

    fn require_live(&self, allow_bound: bool) -> Result<(), EphemeralError> {
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

    pub fn replace_protected_room_catalog(
        &self,
        definitions: &[EphemeralCollection],
    ) -> Result<u64, EphemeralError> {
        self.require_live(true)?;
        validate_collection_definitions(definitions)?;
        let protected = definitions
            .iter()
            .filter(|definition| collection_requires_room_permission(definition))
            .cloned()
            .collect::<Vec<_>>();
        let mut state = self.registry.lock();
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
        self.require_live(true)?;
        let mut state = self.registry.lock();
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

    pub fn validate_admitted_room_act(
        &self,
        permit: &RoomAuthorityPermit,
        room: &RoomId,
    ) -> Result<u64, EphemeralError> {
        if !Arc::ptr_eq(&self.registry, &permit.registry) || &permit.room != room {
            return Err(authority_pending_error());
        }
        let state = self.registry.lock();
        let Some(control) = state.rooms.get(room) else {
            return Err(authority_pending_error());
        };
        if control.retired || control.generation != permit.generation {
            return Err(authority_pending_error());
        }
        Ok(permit.generation)
    }

    pub fn room_generation(&self, room: &RoomId) -> u64 {
        self.registry
            .lock()
            .rooms
            .get(room)
            .map_or(0, |control| control.generation)
    }

    pub fn retire_room(&self, room: &RoomId) {
        retire_room_in_state(&self.registry, room);
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
        if self.activation.state() != ACTIVATION_READY {
            return Err(projection_unavailable(
                "authorization participant is not ready",
            ));
        }
        let mut state = self.registry.lock();
        if self.registry.is_retired() || self.registry.generation() != self.registry_generation {
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
            state
                .rooms
                .get_mut(room)
                .expect("enumerated room remains installed")
                .pending_tickets
                .insert(ticket_id);
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
        let state = self.registry.lock();
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
        self.registry.lock().latest_committed_outcome.clone()
    }

    pub fn pending_reauthorizations(&self) -> Vec<PendingRoomReauthorization> {
        self.registry
            .lock()
            .rooms
            .iter()
            .filter_map(|(room, control)| {
                (control.pending_tickets.is_empty() && !control.retired)
                    .then(|| {
                        control
                            .resync
                            .clone()
                            .map(|obligation| PendingRoomReauthorization {
                                room: room.clone(),
                                obligation,
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
        self.require_live(true)?;
        let state = self.registry.lock();
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
        Ok(RoomRetirementAdmission {
            registry: &self.registry,
            state,
            room: room.clone(),
        })
    }

    pub fn begin_room_reauthorization_admission(
        &self,
        room: &RoomId,
        generation: u64,
    ) -> Result<RoomReauthorizationAdmission<'_>, EphemeralError> {
        let state = self.registry.lock();
        let control = state.rooms.get(room).ok_or_else(authority_pending_error)?;
        let obligation = control.resync.clone().ok_or_else(authority_pending_error)?;
        if control.retired
            || !control.pending_tickets.is_empty()
            || control.generation != generation
            || obligation.room_authority_generation != generation
        {
            return Err(authority_pending_error());
        }
        Ok(RoomReauthorizationAdmission {
            state,
            room: room.clone(),
            generation,
        })
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
            state: AtomicU8::new(ACTIVATION_BOUND),
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

    pub fn validate_admitted_room_act(
        &self,
        permit: &RoomAuthorityPermit,
        room: &RoomId,
    ) -> Result<u64, EphemeralError> {
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

    pub fn begin_room_reauthorization_admission(
        &self,
        room: &RoomId,
        generation: u64,
    ) -> Result<RoomReauthorizationAdmission<'_>, EphemeralError> {
        self.participant
            .begin_room_reauthorization_admission(room, generation)
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
            return Err(projection_unavailable(
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
        let registry = self.registry.clone();
        let binding = self.binding.clone();
        let generation = self.registry_generation;
        let ticket_id = self.ticket.ticket_id;
        crate::exec_guard::run_or_defer_after_local_finalizer(move || {
            finalize_known_commit(&registry, &binding, generation, ticket_id)
                .expect("prevalidated authorization commit finalizes after Local");
        });
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
    issuer_incarnation: Arc<str>,
}

impl AuthorizationExpectationView {
    pub(super) fn new(
        registry: Arc<RoomAuthorityRegistry>,
        registry_generation: u64,
        activation: Arc<AuthorizationParticipantActivation>,
        issuer_incarnation: Arc<str>,
    ) -> Self {
        Self {
            registry,
            registry_generation,
            activation,
            issuer_incarnation,
        }
    }

    pub fn current(&self) -> SnapbackResult<AuthorizationVersion> {
        if self.activation.state() == ACTIVATION_RETIRED
            || self.registry.is_retired()
            || self.registry.generation() != self.registry_generation
        {
            return Err(projection_unavailable(
                "authorization expectation view is retired",
            ));
        }
        let current = self
            .registry
            .lock()
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

    pub fn project_committed(&self, outcome: &AuthorizationCommitOutcome) -> SnapbackResult<()> {
        crate::exec_guard::debug_assert_local_snapback_write_scope_inactive(
            "authorization issuer expectation projection",
        );
        if !self.registry.binding_matches(&outcome.binding)
            || !Arc::ptr_eq(&self.registry, &outcome.registry)
            || self.registry_generation != outcome.registry_generation
            || self.registry.is_retired()
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
        let mut state = self.registry.lock();
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

pub struct RoomReauthorizationAdmission<'a> {
    state: MutexGuard<'a, RoomAuthorityRegistryState>,
    room: RoomId,
    generation: u64,
}

impl RoomReauthorizationAdmission<'_> {
    pub fn complete_exact(mut self) {
        if let Some(control) = self.state.rooms.get_mut(&self.room) {
            if control.generation == self.generation
                && control
                    .resync
                    .as_ref()
                    .is_some_and(|resync| resync.room_authority_generation == self.generation)
            {
                control.resync = None;
            }
        }
    }

    pub fn remove_missing_room(mut self) {
        let should_remove = self.state.rooms.get(&self.room).is_some_and(|control| {
            control.generation == self.generation
                && control.pending_tickets.is_empty()
                && control.active_permits == 0
        });
        if should_remove {
            self.state.rooms.remove(&self.room);
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
    let mut state = participant.registry.lock();
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
    Ok(AuthorizationExpectationView::new(
        participant.registry.clone(),
        participant.registry_generation,
        participant.activation.clone(),
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

fn retire_room_in_state(registry: &Arc<RoomAuthorityRegistry>, room: &RoomId) {
    let mut state = registry.lock();
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

fn authorization_reservation_stale(message: &'static str) -> SnapbackError {
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

    struct ReadyFixture {
        database: ServingDatabase,
        participant: AuthorizationCommitParticipant,
        view: AuthorizationExpectationView,
        authorization: AuthorizationVersion,
    }

    fn ready_fixture() -> ReadyFixture {
        let local = LocalDatabase::memory().expect("in-memory database");
        let mut database = ServingDatabase::adopt(local).expect("serving database");
        let (authorization, _, _) = database
            .reserve_invalidation_boot_issuer()
            .expect("durable authorization snapshot");
        let participant = database
            .take_authorization_commit_participant()
            .expect("sole participant");
        database
            .bind_authorization_commit_participant(&participant)
            .expect("exact construction bind");
        let view = database
            .authorization_expectation_view_for_participant_install(&participant)
            .expect("kernel-owned expectation view");
        assert_eq!(view.current().unwrap(), authorization);
        database
            .activate_authorization_commit_participant(&participant)
            .expect("ready participant");
        ReadyFixture {
            database,
            participant,
            view,
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

    #[test]
    fn activation_requires_the_kernel_initialized_snapshot() {
        let local = LocalDatabase::memory().unwrap();
        let mut database = ServingDatabase::adopt(local).unwrap();
        let (authorization, _, _) = database.reserve_invalidation_boot_issuer().unwrap();
        let participant = database.take_authorization_commit_participant().unwrap();
        database
            .bind_authorization_commit_participant(&participant)
            .unwrap();

        let error = database
            .activate_authorization_commit_participant(&participant)
            .expect_err("construction binding alone cannot enable the interlock");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );

        let view = database
            .authorization_expectation_view_for_participant_install(&participant)
            .unwrap();
        assert_eq!(view.current().unwrap(), authorization);
        database
            .activate_authorization_commit_participant(&participant)
            .unwrap();
    }

    #[test]
    fn participant_and_transaction_bind_reject_database_b() {
        let fixture_a = ready_fixture();
        let mut fixture_b = ready_fixture();

        let activation_error = fixture_b
            .database
            .activate_authorization_commit_participant(&fixture_a.participant)
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
            fixture.participant.registry.retire();
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

        crate::exec_guard::run_after_local_batch(batch);
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
        fixture
            .database
            .activate_authorization_commit_participant(&replacement)
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
    fn membership_projection_selector_stays_narrow_and_unknown_fields_widen() {
        let projection = crate::ephemeral::RoomPermissionProjection {
            table: "memberships".to_owned(),
            subject_field: "userId".to_owned(),
            scope_fields: BTreeMap::from([("boardId".to_owned(), "boardId".to_owned())]),
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
}
