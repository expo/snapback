//! Item-5 ownership boundary for the process-local session projection.
//!
//! The coordinator owns the topology mutex. A premark method installs a
//! unique projection ticket and returns an immutable carrier; no guard is
//! retained in that carrier, so provider/SQLite commit necessarily runs with
//! every topology and leaf lock released. Exact finalize or rollback then
//! reacquires topology → stream/session in the sole permitted order.

use super::admission::{AdmissionController, AdmissionLease};
use super::crypto::SessionBearer;
use super::invocation::{
    InvocationGate, InvocationSource, PreparedAuthority, RehearsalAuthorityBinding,
    ResolvedAppAuthority, WireAuthorityFields,
};
use super::provider::{
    AUTH_SESSION_SLIDING_WINDOW_MS, AUTH_SESSION_SUPERSESSION_GRACE_MS, AuthenticatedUse,
    CredentialIssue, PlannedIssuanceCommit, PlannedPasswordChangeCommit, PlannedRevocationCommit,
    PlannedRotationCommit, ProviderPasswordChangePlan, ProviderRevocationPlan,
    ProviderSessionIssuancePlan, ProviderTokenRotationPlan, SessionRevocation,
};
use super::session_projection::{
    AUTH_LOCK_RANK_TOPOLOGY, AuthorityWorkDrain, BoundConnectionSessionIdentity, DueExpiryBatch,
    DueExpiryFinalization, FencedPublication, FinalizedRotationPublicationCut, MutationTicket,
    PendingMutationKind, ProjectedBoundSessionResolution, ProjectedConnectionTokenResolution,
    ProjectedSessionAuthority, ProjectedTokenResolution, ProjectionSource, RankedMutexGuard,
    SessionProjection, ranked_mutex_lock,
};
use crate::contract_types::{
    AuthorizationStreamIncarnation, RevocationReason, ServerProfile, TokenDigest,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::AuthMode;
use crate::storage::auth::AuthTransactionAttempt;
use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub struct AuthCoordinator {
    /// Identity of the database whose admitted snapshot produced this live
    /// projection. Retained effect-session views must match it before use.
    database_binding: Option<crate::storage::DatabaseBinding>,
    topology: Mutex<CoordinatorTopology>,
    rehearsal_live_authority: crate::auth::rehearsal::RehearsalLiveAuthorityRegistry,
    #[cfg(any(test, feature = "test-support"))]
    fail_next_finalize: std::sync::atomic::AtomicBool,
}

/// Opaque, correlated input for a database-bound coordinator reconstruction.
/// Its fields remain private so a dependent crate cannot pair caller-authored
/// projection rows with an unrelated database identity.
///
/// @ref LLP 0303#the-governing-principle — source and database identity stay
///   one non-dismantlable value across the outer-lock handoff.
pub struct PreparedLocalSessionCoordinator {
    database_binding: crate::storage::DatabaseBinding,
    source: ProjectionSource,
    admission: AdmissionController,
    epoch_now_ms: u64,
    monotonic_now: Instant,
}

struct CoordinatorTopology {
    projection: SessionProjection,
    admission: AdmissionController,
    rebuild_required_sessions: BTreeSet<String>,
    global_rebuild_required: bool,
}

enum PendingDrainCleanup {
    Session {
        ticket: MutationTicket,
        session_id: String,
    },
    Issuance {
        issuance_ticket: MutationTicket,
        session_id: String,
        revocations: Vec<(MutationTicket, String)>,
    },
    PasswordChange {
        rotation_ticket: MutationTicket,
        rotation_session_id: String,
        revocations: Vec<(MutationTicket, String)>,
    },
    Stream {
        ticket: MutationTicket,
    },
    Expiries {
        entries: Vec<(MutationTicket, String)>,
    },
}

struct PendingDrainRollback {
    coordinator: Arc<AuthCoordinator>,
    cleanup: Option<PendingDrainCleanup>,
}

impl PendingDrainRollback {
    fn new(coordinator: Arc<AuthCoordinator>, cleanup: PendingDrainCleanup) -> Self {
        Self {
            coordinator,
            cleanup: Some(cleanup),
        }
    }

    fn disarm(&mut self) {
        self.cleanup = None;
    }
}

impl Drop for PendingDrainRollback {
    fn drop(&mut self) {
        let Some(cleanup) = self.cleanup.take() else {
            return;
        };
        self.coordinator.rollback_cancelled_drain(cleanup);
    }
}

impl std::fmt::Debug for AuthCoordinator {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AuthCoordinator")
            .field("topology", &"[REDACTED]")
            .finish()
    }
}

pub struct PremarkedRevocation {
    plan: ProviderRevocationPlan,
    ticket: MutationTicket,
    terminal_target: CommittedRevocationTarget,
}

impl PremarkedRevocation {
    pub fn plan(&self) -> &ProviderRevocationPlan {
        &self.plan
    }
}

impl std::fmt::Debug for PremarkedRevocation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PremarkedRevocation")
            .field("session_id", &self.plan.session_id())
            .field("expected_generation", &self.plan.expected_generation())
            .field("ticket", &self.ticket)
            .finish()
    }
}

pub struct PremarkedRotation {
    plan: ProviderTokenRotationPlan,
    ticket: MutationTicket,
}

pub struct PremarkedIssuance {
    plan: ProviderSessionIssuancePlan,
    issuance_ticket: MutationTicket,
    revocation_tickets: Vec<MutationTicket>,
    revocation_terminal_targets: Vec<CommittedRevocationTarget>,
}

pub struct PremarkedPasswordChange {
    plan: ProviderPasswordChangePlan,
    rotation_ticket: MutationTicket,
    revocation_tickets: Vec<MutationTicket>,
    revocation_terminal_targets: Vec<CommittedRevocationTarget>,
}

pub struct PremarkedStreamReset {
    predecessor: AuthorizationStreamIncarnation,
    successor: AuthorizationStreamIncarnation,
    ticket: MutationTicket,
}

impl PremarkedStreamReset {
    pub fn predecessor(&self) -> &AuthorizationStreamIncarnation {
        &self.predecessor
    }

    pub fn successor(&self) -> &AuthorizationStreamIncarnation {
        &self.successor
    }
}

impl std::fmt::Debug for PremarkedStreamReset {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PremarkedStreamReset")
            .field("predecessor", &self.predecessor)
            .field("successor", &self.successor)
            .field("ticket", &self.ticket)
            .finish()
    }
}

impl PremarkedIssuance {
    pub fn plan(&self) -> &ProviderSessionIssuancePlan {
        &self.plan
    }
}

impl PremarkedPasswordChange {
    pub fn plan(&self) -> &ProviderPasswordChangePlan {
        &self.plan
    }
}

impl std::fmt::Debug for PremarkedIssuance {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("PremarkedIssuance([REDACTED])")
    }
}

impl PremarkedRotation {
    pub fn plan(&self) -> &ProviderTokenRotationPlan {
        &self.plan
    }
}

impl std::fmt::Debug for PremarkedRotation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PremarkedRotation")
            .field("session_id", &self.plan.session_id())
            .field("expected_generation", &self.plan.expected_generation())
            .field("ticket", &self.ticket)
            .finish()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommittedAuthResponseClass {
    CredentialSecret,
    LogoutNoContent,
    FamilyAlarmAccepted,
    ProviderAuthError,
    InternalOnly,
}

#[derive(Debug)]
struct CommittedAuthOutcomeState {
    publication: FencedPublication,
    ticket: MutationTicket,
    permitted_pending_tickets: BTreeSet<MutationTicket>,
    finalized_rotation_cut: Option<FinalizedRotationPublicationCut>,
    response_class: CommittedAuthResponseClass,
}

/// Cloneable only so it can cross `http::Extensions`; every clone shares one
/// mutex-protected capability and exactly one caller can consume it.
#[derive(Clone, Debug)]
pub struct CommittedAuthOutcome {
    state: Arc<Mutex<Option<CommittedAuthOutcomeState>>>,
}

impl CommittedAuthOutcome {
    pub fn try_publish<T>(
        self,
        response_class: CommittedAuthResponseClass,
        epoch_now_ms: u64,
        monotonic_now: Instant,
        publish: impl FnOnce() -> SnapbackResult<T>,
    ) -> SnapbackResult<Option<T>> {
        let state = self
            .state
            .lock()
            .map_err(|_| projection_unavailable())?
            .take()
            .ok_or_else(projection_unavailable)?;
        if state.response_class != response_class {
            return Err(projection_unavailable());
        }
        // `ticket` is an unforgeable proof minted only after exact finalize.
        // Keep it alive through the guarded handoff so the capability binds
        // both the finalized mutation and its fixed response class.
        let _finalized_ticket = state.ticket;
        match state.finalized_rotation_cut {
            Some(finalized_cut) => state.publication.try_publish_committed_rotation(
                epoch_now_ms,
                monotonic_now,
                &state.permitted_pending_tickets,
                finalized_cut,
                publish,
            ),
            None => state
                .publication
                .try_publish(epoch_now_ms, monotonic_now, publish),
        }
    }
}

#[derive(Debug)]
pub enum RevocationFinish {
    Committed {
        revocation: SessionRevocation,
        outcome: CommittedAuthOutcome,
    },
    AlreadyTerminal {
        generation: u64,
        reason: Option<crate::contract_types::RevocationReason>,
    },
    PredecessorChanged,
}

// The committed credential is an intentionally inline, one-owner protocol
// carrier. Boxing it would force every server publication path to unpack a
// second allocation without changing the secret's ownership or drop boundary.
#[allow(clippy::large_enum_variant)]
#[derive(Debug)]
pub enum RotationFinish {
    Committed {
        issue: CredentialIssue,
        outcome: CommittedAuthOutcome,
    },
    CandidateCollision,
    PredecessorChanged,
}

// As above, the successful issuance payload stays inline so its bearer and
// optional eviction result move together through the exact finalize boundary.
#[allow(clippy::large_enum_variant)]
#[derive(Debug)]
pub enum IssuanceFinish {
    Committed {
        issue: CredentialIssue,
        outcome: CommittedAuthOutcome,
    },
    CodeInvalid,
    CodeLocked,
    CredentialInvalid,
    CredentialThrottled,
    GuestBudgetRefused {
        budget_name: &'static str,
        retry_after_ms: u64,
        correlation_id: String,
    },
    GuestIdempotencyConflict,
    SenderKeyBound,
    CandidateCollision,
    PredecessorChanged,
    RehearsalReplay(serde_json::Value),
    RehearsalDenied(SnapbackError),
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug)]
pub enum PasswordChangeFinish {
    Committed(CredentialIssue),
    CredentialInvalid,
    CredentialThrottled,
    GuestClaimCollision,
    GuestAlreadyClaimed,
    GuestBudgetRefused {
        budget_name: &'static str,
        retry_after_ms: u64,
    },
    CandidateCollision,
    PredecessorChanged,
}

/// Exact predecessor authority that must be terminalized after a known
/// durable revocation commit. The target is captured while `Begin` still owns
/// a coherent projection, so post-commit projection failure cannot erase the
/// information required by the server terminal lifecycle.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommittedRevocationTarget {
    authorization_stream_incarnation: String,
    session_id: String,
    predecessor_generation: u64,
}

impl CommittedRevocationTarget {
    pub fn authorization_stream_incarnation(&self) -> &str {
        &self.authorization_stream_incarnation
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn predecessor_generation(&self) -> u64 {
        self.predecessor_generation
    }
}

/// A coordinator result whose known-committed revocation fact must be
/// consumed before the result (including its original diagnostic) is
/// returned to the request path.
#[must_use = "known-committed revocations require terminal propagation"]
pub struct AuthFinish<T> {
    outcome: SnapbackResult<T>,
    committed_revocations: Vec<CommittedRevocationTarget>,
}

impl<T> AuthFinish<T> {
    fn new(
        outcome: SnapbackResult<T>,
        committed_revocations: Vec<CommittedRevocationTarget>,
    ) -> Self {
        Self {
            outcome,
            committed_revocations,
        }
    }

    pub fn into_parts(self) -> (SnapbackResult<T>, Vec<CommittedRevocationTarget>) {
        (self.outcome, self.committed_revocations)
    }

    #[cfg(test)]
    fn unwrap(self) -> T
    where
        T: std::fmt::Debug,
    {
        self.outcome.unwrap()
    }

    #[cfg(test)]
    fn unwrap_err(self) -> SnapbackError
    where
        T: std::fmt::Debug,
    {
        self.outcome.unwrap_err()
    }
}

/// Projection-resolved authority plus the leaf handles required for the final
/// synchronous publication cut. Callers may compute with `authority`, but
/// bytes/effects become observable only through `publication.try_publish`.
#[derive(Clone, Debug)]
pub struct PreparedBearerAuthority {
    authority: ResolvedAppAuthority,
    publication: FencedPublication,
    bearer: Option<Arc<SessionBearer>>,
}

/// Projection-owned authority used to mint one session-bound connection
/// grant. The full resolved authority is short-lived: the registry strips the
/// authority-instance id and bearer before storing the immutable grant key.
#[derive(Clone, Debug)]
pub struct PreparedConnectionSessionAuthority {
    authority: ResolvedAppAuthority,
    authorization_stream_incarnation: String,
    deadline_ms: u64,
    publication: FencedPublication,
    bearer: Arc<SessionBearer>,
}

impl PreparedConnectionSessionAuthority {
    pub fn route_authority(&self) -> PreparedBearerAuthority {
        PreparedBearerAuthority {
            authority: self.authority.clone(),
            publication: self.publication.clone(),
            bearer: Some(self.bearer.clone()),
        }
    }

    pub fn into_parts(self) -> (ResolvedAppAuthority, String, u64, FencedPublication) {
        (
            self.authority,
            self.authorization_stream_incarnation,
            self.deadline_ms,
            self.publication,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConnectionSessionThrottleKey {
    pub authorization_stream_incarnation: String,
    pub session_id: String,
    pub(crate) generation: u64,
}

impl ConnectionSessionThrottleKey {
    pub fn generation(&self) -> u64 {
        self.generation
    }
}

#[derive(Debug)]
#[allow(clippy::large_enum_variant)] // transient resolution value; boxing the hot arm buys nothing
pub enum ConnectionBearerResolution {
    Current(PreparedConnectionSessionAuthority),
    Superseded(ConnectionSessionThrottleKey),
    Unavailable(ConnectionSessionThrottleKey),
    Unknown {
        authorization_stream_incarnation: String,
    },
}

#[derive(Clone, Debug)]
#[allow(clippy::large_enum_variant)] // transient resolution value; boxing the hot arm buys nothing
pub enum BoundSessionResolution {
    Current(PreparedBearerAuthority),
    Terminal { reason: RevocationReason },
    Unavailable,
}

#[derive(Debug)]
pub struct PreparedAnonymousConnectionAuthority {
    pub authorization_stream_incarnation: String,
    pub(crate) publication: FencedPublication,
}

impl PreparedAnonymousConnectionAuthority {
    pub fn into_parts(self) -> (String, FencedPublication) {
        (self.authorization_stream_incarnation, self.publication)
    }
}

impl PreparedBearerAuthority {
    pub fn resolved(&self) -> &ResolvedAppAuthority {
        &self.authority
    }

    pub(crate) fn authority(&self) -> &ResolvedAppAuthority {
        &self.authority
    }

    pub(crate) fn into_parts(self) -> (ResolvedAppAuthority, FencedPublication) {
        (self.authority, self.publication)
    }

    pub fn matches_authority_instance_id(&self, expected: &str) -> bool {
        matches!(
            &self.authority,
            ResolvedAppAuthority::Session(subject)
                if subject.authority_instance_id() == expected
        )
    }

    /// Re-enter one approved effect only through the original session
    /// resolution's sealed admission origin. The approver's lease is already
    /// bound to a different subject and must never be reused here.
    ///
    /// @ref LLP 0303#derivation-is-a-lifetime-property-not-a-constructor-event — retained work rejoins only its sealed producer graph.
    pub fn prepare_retained_effect(
        self,
        database: &mut crate::storage::ServingDatabase,
        profile: ServerProfile,
        wire: &WireAuthorityFields,
        now_ms: u64,
    ) -> SnapbackResult<PreparedAuthority> {
        let admission = match &self.authority {
            ResolvedAppAuthority::Session(subject) => subject
                .admission_origin()
                .admit_for_mode(AuthMode::Sessions)?,
            _ => {
                return Err(SnapbackError::error(
                    "SNAPBACK_EFFECT_AUTHORITY_INVALID",
                    "effects",
                    "retained effect session carrier does not contain session authority",
                ));
            }
        };
        self.prepare(
            database,
            InvocationSource::EffectExecution,
            AuthMode::Sessions,
            profile,
            admission,
            wire,
            now_ms,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        self,
        database: &mut crate::storage::ServingDatabase,
        source: InvocationSource,
        active_mode: AuthMode,
        profile: ServerProfile,
        admission: AdmissionLease,
        wire: &WireAuthorityFields,
        now_ms: u64,
    ) -> SnapbackResult<PreparedAuthority> {
        let session_claims = self
            .authority
            .session_id()
            .map(|session_id| database.identity_claims(session_id, now_ms, profile))
            .transpose()?;
        let authority = InvocationGate::prepare_admitted_authority(
            source,
            active_mode,
            profile,
            admission,
            wire,
            self.authority,
            session_claims,
        )?
        .with_fenced_publication(self.publication);
        Ok(match self.bearer {
            Some(bearer) => authority.with_pending_effect_session_bearer(bearer),
            None => authority,
        })
    }
}

impl AuthCoordinator {
    /// Construct from a complete catalog and binding read from the same
    /// serving database receiver. There is no portable admitted snapshot to
    /// dismantle or relocate between databases.
    ///
    /// @ref LLP 0303#the-governing-principle — derive both the reconstructed
    /// session subjects and their database provenance at the consuming cut.
    pub fn from_session_database(
        database: &mut crate::storage::ServingDatabase,
        admission: AdmissionController,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Self> {
        let database_binding = database.binding();
        let source = database.session_projection_source()?;
        Self::new_inner(
            SessionProjection::rebuild_with_fresh_startup_id(source, epoch_now_ms, monotonic_now)?,
            admission,
            Some(database_binding),
        )
    }

    /// Construct the stream-only projection from one serving database
    /// receiver. This is the catalog-absent/direct-reset sibling of
    /// [`Self::from_session_database`].
    pub fn from_stream_database(
        database: &mut crate::storage::ServingDatabase,
        admission: AdmissionController,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Self> {
        let database_binding = database.binding();
        let source = database.stream_projection_source()?;
        Self::new_inner(
            SessionProjection::rebuild_with_fresh_startup_id(source, epoch_now_ms, monotonic_now)?,
            admission,
            Some(database_binding),
        )
    }

    /// Local-database sibling used by database-bound embedders and tests that
    /// have not adopted a serving commit-authority graph. Source and binding
    /// still derive from the same receiver.
    pub fn from_local_session_database(
        database: &mut crate::storage::LocalDatabase,
        admission: AdmissionController,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Self> {
        Self::from_prepared_local_session_database(Self::prepare_from_local_session_database(
            database,
            admission,
            epoch_now_ms,
            monotonic_now,
        )?)
    }

    /// Capture the correlated projection source and database binding while a
    /// caller owns the database, without entering any auth lock. This supports
    /// the required LocalSnapback-before-auth lock order: finalize the opaque
    /// preparation only after releasing the outer engine write scope.
    ///
    /// @ref LLP 0059#locking-and-linearization — projection leaf locks are
    ///   entered only after the outer LocalSnapback write scope is released.
    pub fn prepare_from_local_session_database(
        database: &mut crate::storage::LocalDatabase,
        admission: AdmissionController,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<PreparedLocalSessionCoordinator> {
        Ok(PreparedLocalSessionCoordinator {
            database_binding: database.binding(),
            source: database.session_projection_source()?,
            admission,
            epoch_now_ms,
            monotonic_now,
        })
    }

    /// Finish an opaque database-derived preparation after its database owner
    /// has released any outer engine write scope. Callers cannot replace the
    /// captured source or its correlated binding.
    pub fn from_prepared_local_session_database(
        prepared: PreparedLocalSessionCoordinator,
    ) -> SnapbackResult<Self> {
        Self::new_inner(
            SessionProjection::rebuild_with_fresh_startup_id(
                prepared.source,
                prepared.epoch_now_ms,
                prepared.monotonic_now,
            )?,
            prepared.admission,
            Some(prepared.database_binding),
        )
    }

    pub(crate) fn new(projection: SessionProjection) -> SnapbackResult<Self> {
        Self::new_inner(projection, AdmissionController::new(0, true)?, None)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn new_with_admission(
        projection: SessionProjection,
        admission: AdmissionController,
    ) -> SnapbackResult<Self> {
        Self::new_inner(projection, admission, None)
    }

    /// Read-only test observation for proving that a database-bound rebuild
    /// preserved an exact durable terminal cause. This cannot construct,
    /// replace, or detach projection state.
    #[cfg(any(test, feature = "test-support"))]
    pub fn terminal_reason_for_bearer_for_test(
        &self,
        bearer: &str,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Option<RevocationReason>> {
        let bearer = SessionBearer::parse_any_version(bearer).map_err(|_| auth_required())?;
        let digest = TokenDigest::from_token_hash(&bearer.token_hash());
        let topology = self.lock_topology()?;
        match topology
            .projection
            .resolve_token(&digest, epoch_now_ms, monotonic_now)?
        {
            ProjectedTokenResolution::Terminal { reason } => Ok(Some(reason)),
            _ => Ok(None),
        }
    }

    fn new_inner(
        projection: SessionProjection,
        admission: AdmissionController,
        database_binding: Option<crate::storage::DatabaseBinding>,
    ) -> SnapbackResult<Self> {
        projection.check_invariants()?;
        Ok(Self {
            database_binding,
            topology: Mutex::new(CoordinatorTopology {
                projection,
                admission,
                rebuild_required_sessions: BTreeSet::new(),
                global_rebuild_required: false,
            }),
            rehearsal_live_authority: Default::default(),
            #[cfg(any(test, feature = "test-support"))]
            fail_next_finalize: std::sync::atomic::AtomicBool::new(false),
        })
    }

    fn rollback_cancelled_drain(&self, cleanup: PendingDrainCleanup) {
        let Ok(mut topology) = self.lock_topology() else {
            // A poisoned coordinator is already fail-closed. Leaving the
            // marker installed is safer than guessing at projection state.
            return;
        };
        let cleaned = match cleanup {
            PendingDrainCleanup::Session { ticket, session_id } => topology
                .projection
                .compare_unmark_session(&ticket, &session_id)
                .unwrap_or(false),
            PendingDrainCleanup::Issuance {
                issuance_ticket,
                session_id,
                revocations,
            } => {
                let mut revocations_cleaned = true;
                for (ticket, revoked_session_id) in revocations {
                    revocations_cleaned &= topology
                        .projection
                        .compare_unmark_session(&ticket, &revoked_session_id)
                        .unwrap_or(false);
                }
                let issuance_cleaned = topology
                    .projection
                    .compare_unmark_issuance(&issuance_ticket, &session_id)
                    .unwrap_or(false);
                revocations_cleaned && issuance_cleaned
            }
            PendingDrainCleanup::PasswordChange {
                rotation_ticket,
                rotation_session_id,
                revocations,
            } => {
                let mut cleaned = topology
                    .projection
                    .compare_unmark_session(&rotation_ticket, &rotation_session_id)
                    .unwrap_or(false);
                for (ticket, session_id) in revocations {
                    cleaned &= topology
                        .projection
                        .compare_unmark_session(&ticket, &session_id)
                        .unwrap_or(false);
                }
                cleaned
            }
            PendingDrainCleanup::Stream { ticket } => topology
                .projection
                .compare_unmark_stream(&ticket)
                .unwrap_or(false),
            PendingDrainCleanup::Expiries { entries } => {
                let mut cleaned = true;
                for (ticket, session_id) in entries {
                    cleaned &= topology
                        .projection
                        .compare_unmark_session(&ticket, &session_id)
                        .unwrap_or(false);
                }
                cleaned
            }
        };
        if !cleaned {
            topology.global_rebuild_required = true;
        }
    }

    /// Install the leaf marker, then return only immutable CAS inputs plus the
    /// ticket. The returned carrier owns no lock and may cross the provider
    /// transaction boundary safely.
    ///
    /// @ref LLP 0059#plan-begin-commit-finalize — the leaf is blocked before
    /// commit begins, and no projection/fence guard enters SQLite.
    pub async fn premark_revocation(
        self: &Arc<Self>,
        plan: ProviderRevocationPlan,
    ) -> SnapbackResult<PremarkedRevocation> {
        let (ticket, drain, terminal_target) = {
            let mut topology = self.lock_topology()?;
            topology.require_session_available(plan.session_id())?;
            let terminal_target = CommittedRevocationTarget {
                authorization_stream_incarnation: topology
                    .projection
                    .incarnation()
                    .as_str()
                    .to_owned(),
                session_id: plan.session_id().to_owned(),
                predecessor_generation: plan.expected_generation(),
            };
            let premarked = topology.projection.begin_session_mutation(
                plan.session_id(),
                plan.expected_generation(),
                PendingMutationKind::Revoke {
                    reason: plan.reason(),
                },
            )?;
            (premarked.ticket, premarked.drain, terminal_target)
        };
        let mut rollback = PendingDrainRollback::new(
            Arc::clone(self),
            PendingDrainCleanup::Session {
                ticket: ticket.clone(),
                session_id: plan.session_id().to_owned(),
            },
        );
        drain.wait().await;
        rollback.disarm();
        Ok(PremarkedRevocation {
            plan,
            ticket,
            terminal_target,
        })
    }

    pub async fn premark_rotation(
        self: &Arc<Self>,
        plan: ProviderTokenRotationPlan,
    ) -> SnapbackResult<PremarkedRotation> {
        let (ticket, drain) = {
            let mut topology = self.lock_topology()?;
            topology.require_session_available(plan.session_id())?;
            let premarked = topology.projection.begin_session_mutation(
                plan.session_id(),
                plan.expected_generation(),
                PendingMutationKind::TokenSupersede {
                    predecessor: plan.predecessor_digest(),
                    successor: plan.successor_digest(),
                    superseded_at_ms: plan.superseded_at_ms(),
                },
            )?;
            (premarked.ticket, premarked.drain)
        };
        let mut rollback = PendingDrainRollback::new(
            Arc::clone(self),
            PendingDrainCleanup::Session {
                ticket: ticket.clone(),
                session_id: plan.session_id().to_owned(),
            },
        );
        drain.wait().await;
        rollback.disarm();
        Ok(PremarkedRotation { plan, ticket })
    }

    pub async fn premark_issuance(
        self: &Arc<Self>,
        plan: ProviderSessionIssuancePlan,
    ) -> SnapbackResult<PremarkedIssuance> {
        let (issuance_ticket, revocation_tickets, revocation_drains, revocation_terminal_targets) = {
            let mut topology = self.lock_topology()?;
            if topology.global_rebuild_required {
                return Err(projection_unavailable());
            }
            for revocation in plan.revocations() {
                topology.require_session_available(revocation.session_id())?;
            }
            let revocation_terminal_targets = plan
                .revocations()
                .iter()
                .map(|revocation| CommittedRevocationTarget {
                    authorization_stream_incarnation: topology
                        .projection
                        .incarnation()
                        .as_str()
                        .to_owned(),
                    session_id: revocation.session_id().to_owned(),
                    predecessor_generation: revocation.expected_generation(),
                })
                .collect::<Vec<_>>();
            let insert = plan.projected_insert();
            let issuance_ticket = topology.projection.begin_issuance(insert)?;
            let mut revocation_tickets = Vec::with_capacity(plan.revocations().len());
            let mut revocation_drains = Vec::with_capacity(plan.revocations().len());
            for revocation in plan.revocations() {
                match topology.projection.begin_session_mutation(
                    revocation.session_id(),
                    revocation.expected_generation(),
                    PendingMutationKind::Revoke {
                        reason: revocation.reason(),
                    },
                ) {
                    Ok(premarked) => {
                        revocation_tickets.push(premarked.ticket);
                        revocation_drains.push(premarked.drain);
                    }
                    Err(error) => {
                        for (ticket, earlier) in
                            revocation_tickets.iter().zip(plan.revocations().iter())
                        {
                            let _ = topology
                                .projection
                                .compare_unmark_session(ticket, earlier.session_id());
                        }
                        let _ = topology.projection.compare_unmark_issuance(
                            &issuance_ticket,
                            &plan.projected_insert().session_id,
                        );
                        return Err(error);
                    }
                }
            }
            (
                issuance_ticket,
                revocation_tickets,
                revocation_drains,
                revocation_terminal_targets,
            )
        };
        let mut rollback = PendingDrainRollback::new(
            Arc::clone(self),
            PendingDrainCleanup::Issuance {
                issuance_ticket: issuance_ticket.clone(),
                session_id: plan.projected_insert().session_id,
                revocations: revocation_tickets
                    .iter()
                    .zip(plan.revocations())
                    .map(|(ticket, revocation)| {
                        (ticket.clone(), revocation.session_id().to_owned())
                    })
                    .collect(),
            },
        );
        for drain in revocation_drains {
            drain.wait().await;
        }
        rollback.disarm();
        Ok(PremarkedIssuance {
            plan,
            issuance_ticket,
            revocation_tickets,
            revocation_terminal_targets,
        })
    }

    pub async fn premark_password_change(
        self: &Arc<Self>,
        plan: ProviderPasswordChangePlan,
    ) -> SnapbackResult<PremarkedPasswordChange> {
        let (rotation_ticket, rotation_drain, revocation_tickets, revocation_drains, targets) = {
            let mut topology = self.lock_topology()?;
            if topology.global_rebuild_required {
                return Err(projection_unavailable());
            }
            topology.require_session_available(plan.rotation().session_id())?;
            for revocation in plan.revocations() {
                topology.require_session_available(revocation.session_id())?;
            }
            let rotation = topology.projection.begin_session_mutation(
                plan.rotation().session_id(),
                plan.rotation().expected_generation(),
                PendingMutationKind::TokenSupersede {
                    predecessor: plan.rotation().predecessor_digest(),
                    successor: plan.rotation().successor_digest(),
                    superseded_at_ms: plan.rotation().superseded_at_ms(),
                },
            )?;
            let mut revocation_tickets = Vec::with_capacity(plan.revocations().len());
            let mut revocation_drains = Vec::with_capacity(plan.revocations().len());
            for revocation in plan.revocations() {
                match topology.projection.begin_session_mutation(
                    revocation.session_id(),
                    revocation.expected_generation(),
                    PendingMutationKind::Revoke {
                        reason: revocation.reason(),
                    },
                ) {
                    Ok(premarked) => {
                        revocation_tickets.push(premarked.ticket);
                        revocation_drains.push(premarked.drain);
                    }
                    Err(error) => {
                        for (ticket, earlier) in revocation_tickets.iter().zip(plan.revocations()) {
                            let _ = topology
                                .projection
                                .compare_unmark_session(ticket, earlier.session_id());
                        }
                        let _ = topology
                            .projection
                            .compare_unmark_session(&rotation.ticket, plan.rotation().session_id());
                        return Err(error);
                    }
                }
            }
            let targets = plan
                .revocations()
                .iter()
                .map(|revocation| CommittedRevocationTarget {
                    authorization_stream_incarnation: topology
                        .projection
                        .incarnation()
                        .as_str()
                        .to_owned(),
                    session_id: revocation.session_id().to_owned(),
                    predecessor_generation: revocation.expected_generation(),
                })
                .collect();
            (
                rotation.ticket,
                rotation.drain,
                revocation_tickets,
                revocation_drains,
                targets,
            )
        };
        let mut rollback = PendingDrainRollback::new(
            Arc::clone(self),
            PendingDrainCleanup::PasswordChange {
                rotation_ticket: rotation_ticket.clone(),
                rotation_session_id: plan.rotation().session_id().to_owned(),
                revocations: revocation_tickets
                    .iter()
                    .zip(plan.revocations())
                    .map(|(ticket, revocation)| {
                        (ticket.clone(), revocation.session_id().to_owned())
                    })
                    .collect(),
            },
        );
        rotation_drain.wait().await;
        for drain in revocation_drains {
            drain.wait().await;
        }
        rollback.disarm();
        Ok(PremarkedPasswordChange {
            plan,
            rotation_ticket,
            revocation_tickets,
            revocation_terminal_targets: targets,
        })
    }

    /// Block the shared authorization stream before the destructive database
    /// transaction begins. The carrier owns no lock and binds one exact
    /// predecessor/successor pair across SQLite commit.
    ///
    /// @ref LLP 0059#reset-restore-and-stream-publication — reset uses the
    /// same premark/commit/finalize protocol as session leaf mutations.
    pub async fn premark_stream_reset(self: &Arc<Self>) -> SnapbackResult<PremarkedStreamReset> {
        let (predecessor, successor, ticket, drain) = self.begin_stream_reset_marker()?;
        let mut rollback = PendingDrainRollback::new(
            Arc::clone(self),
            PendingDrainCleanup::Stream {
                ticket: ticket.clone(),
            },
        );
        drain.wait().await;
        rollback.disarm();
        Ok(PremarkedStreamReset {
            predecessor,
            successor,
            ticket,
        })
    }

    pub fn premark_stream_reset_if_drained(
        self: &Arc<Self>,
    ) -> SnapbackResult<PremarkedStreamReset> {
        let (predecessor, successor, ticket, drain) = self.begin_stream_reset_marker()?;
        if !drain.is_drained() {
            self.rollback_cancelled_drain(PendingDrainCleanup::Stream {
                ticket: ticket.clone(),
            });
            return Err(projection_unavailable());
        }
        Ok(PremarkedStreamReset {
            predecessor,
            successor,
            ticket,
        })
    }

    fn begin_stream_reset_marker(
        &self,
    ) -> SnapbackResult<(
        AuthorizationStreamIncarnation,
        AuthorizationStreamIncarnation,
        MutationTicket,
        AuthorityWorkDrain,
    )> {
        let mut topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        let predecessor = topology.projection.incarnation().clone();
        let successor = AuthorizationStreamIncarnation::fresh();
        let premarked = topology
            .projection
            .begin_stream_mutation(successor.clone())?;
        Ok((predecessor, successor, premarked.ticket, premarked.drain))
    }

    pub fn finish_stream_reset<T>(
        &self,
        carrier: PremarkedStreamReset,
        attempt: AuthTransactionAttempt<T>,
    ) -> SnapbackResult<T> {
        let mut topology = self.lock_topology()?;
        match attempt {
            AuthTransactionAttempt::RolledBack(error) => {
                match topology.projection.compare_unmark_stream(&carrier.ticket) {
                    Ok(true) => Err(error),
                    Ok(false) | Err(_) => {
                        topology.global_rebuild_required = true;
                        Err(projection_unavailable())
                    }
                }
            }
            AuthTransactionAttempt::CommitUncertain(_) => {
                // Keep the stream ticket installed: all predecessor publication
                // remains blocked until a full durable rebuild establishes truth.
                topology.global_rebuild_required = true;
                Err(revocation_uncertain())
            }
            AuthTransactionAttempt::Committed(output) => {
                if self.take_finalize_failpoint()
                    || topology
                        .projection
                        .finalize_stream_rotation(&carrier.ticket)
                        .is_err()
                    || topology.projection.incarnation() != &carrier.successor
                {
                    topology.global_rebuild_required = true;
                    return Err(projection_unavailable());
                }
                topology.rebuild_required_sessions.clear();
                Ok(output)
            }
        }
    }

    pub fn finish_revocation(
        &self,
        carrier: PremarkedRevocation,
        attempt: AuthTransactionAttempt<PlannedRevocationCommit>,
    ) -> AuthFinish<RevocationFinish> {
        let committed_revocation = matches!(
            &attempt,
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::Committed(_))
        )
        .then(|| vec![carrier.terminal_target.clone()])
        .unwrap_or_default();
        let outcome = self.finish_revocation_outcome(carrier, attempt);
        AuthFinish::new(outcome, committed_revocation)
    }

    fn finish_revocation_outcome(
        &self,
        carrier: PremarkedRevocation,
        attempt: AuthTransactionAttempt<PlannedRevocationCommit>,
    ) -> SnapbackResult<RevocationFinish> {
        let mut topology = self.lock_topology()?;
        match attempt {
            AuthTransactionAttempt::RolledBack(error) => {
                exact_unmark_revocation(&mut topology, &carrier)?;
                Err(error)
            }
            AuthTransactionAttempt::CommitUncertain(_error) => {
                fail_session_closed(
                    &mut topology,
                    &carrier.ticket,
                    carrier.plan.session_id(),
                    None,
                );
                Err(revocation_uncertain())
            }
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::PredecessorChanged) => {
                exact_unmark_revocation(&mut topology, &carrier)?;
                Ok(RevocationFinish::PredecessorChanged)
            }
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::AlreadyTerminal {
                generation,
                reason,
            }) => {
                exact_unmark_revocation(&mut topology, &carrier)?;
                Ok(RevocationFinish::AlreadyTerminal { generation, reason })
            }
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::Committed(revocation)) => {
                let expected_generation = carrier
                    .plan
                    .expected_generation()
                    .checked_add(1)
                    .ok_or_else(projection_unavailable)?;
                if revocation.session_id != carrier.plan.session_id()
                    || revocation.generation != expected_generation
                {
                    fail_session_closed(
                        &mut topology,
                        &carrier.ticket,
                        carrier.plan.session_id(),
                        Some(revocation.generation),
                    );
                    return Err(projection_unavailable());
                }
                if self.take_finalize_failpoint()
                    || topology
                        .projection
                        .finalize_revocation(
                            &carrier.ticket,
                            carrier.plan.session_id(),
                            revocation.generation,
                        )
                        .is_err()
                {
                    fail_session_closed(
                        &mut topology,
                        &carrier.ticket,
                        carrier.plan.session_id(),
                        Some(revocation.generation),
                    );
                    return Err(projection_unavailable());
                }
                let response_class = match carrier.plan.reason() {
                    RevocationReason::Logout => CommittedAuthResponseClass::LogoutNoContent,
                    RevocationReason::FamilyAlarm => {
                        CommittedAuthResponseClass::FamilyAlarmAccepted
                    }
                    RevocationReason::RefreshReuse => CommittedAuthResponseClass::ProviderAuthError,
                    _ => CommittedAuthResponseClass::InternalOnly,
                };
                let outcome = CommittedAuthOutcome {
                    state: Arc::new(Mutex::new(Some(CommittedAuthOutcomeState {
                        publication: topology.projection.anonymous_publication_fence(),
                        ticket: carrier.ticket.clone(),
                        permitted_pending_tickets: BTreeSet::new(),
                        finalized_rotation_cut: None,
                        response_class,
                    }))),
                };
                Ok(RevocationFinish::Committed {
                    revocation,
                    outcome,
                })
            }
        }
    }

    pub fn finish_rotation(
        &self,
        carrier: PremarkedRotation,
        attempt: AuthTransactionAttempt<PlannedRotationCommit>,
    ) -> SnapbackResult<RotationFinish> {
        let mut topology = self.lock_topology()?;
        match attempt {
            AuthTransactionAttempt::RolledBack(error) => {
                exact_unmark_rotation(&mut topology, &carrier)?;
                Err(error)
            }
            AuthTransactionAttempt::CommitUncertain(_error) => {
                fail_session_closed(
                    &mut topology,
                    &carrier.ticket,
                    carrier.plan.session_id(),
                    None,
                );
                Err(revocation_uncertain())
            }
            AuthTransactionAttempt::Committed(PlannedRotationCommit::PredecessorChanged) => {
                exact_unmark_rotation(&mut topology, &carrier)?;
                Ok(RotationFinish::PredecessorChanged)
            }
            AuthTransactionAttempt::Committed(PlannedRotationCommit::CandidateCollision) => {
                exact_unmark_rotation(&mut topology, &carrier)?;
                Ok(RotationFinish::CandidateCollision)
            }
            AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed { session }) => {
                let response_publication =
                    topology.projection.prepare_rotation_response_publication(
                        &carrier.ticket,
                        carrier.plan.session_id(),
                        carrier.plan.expected_generation(),
                        carrier.plan.predecessor_digest(),
                        carrier.plan.successor_digest(),
                        carrier.plan.superseded_at_ms(),
                    );
                let Ok((publication, permitted_pending_tickets)) = response_publication else {
                    fail_session_closed(
                        &mut topology,
                        &carrier.ticket,
                        carrier.plan.session_id(),
                        Some(carrier.plan.expected_generation()),
                    );
                    return Err(projection_unavailable());
                };
                let finalized_rotation_cut = if self.take_finalize_failpoint() {
                    None
                } else {
                    topology
                        .projection
                        .finalize_token_rotation(&carrier.ticket, carrier.plan.session_id(), None)
                        .ok()
                };
                let Some(finalized_rotation_cut) = finalized_rotation_cut else {
                    fail_session_closed(
                        &mut topology,
                        &carrier.ticket,
                        carrier.plan.session_id(),
                        Some(carrier.plan.expected_generation()),
                    );
                    // The carrier's plaintext drops here, so a committed
                    // credential is never published while its projection is
                    // unavailable.
                    return Err(projection_unavailable());
                };
                let outcome = CommittedAuthOutcome {
                    state: Arc::new(Mutex::new(Some(CommittedAuthOutcomeState {
                        publication,
                        ticket: carrier.ticket.clone(),
                        permitted_pending_tickets,
                        finalized_rotation_cut: Some(finalized_rotation_cut),
                        response_class: CommittedAuthResponseClass::CredentialSecret,
                    }))),
                };
                Ok(RotationFinish::Committed {
                    issue: carrier.plan.into_issue(session),
                    outcome,
                })
            }
        }
    }

    pub fn finish_issuance(
        &self,
        carrier: PremarkedIssuance,
        attempt: AuthTransactionAttempt<PlannedIssuanceCommit>,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> AuthFinish<IssuanceFinish> {
        let committed_revocations = match &attempt {
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
                committed_revocations,
                ..
            }) if committed_revocations.len() == carrier.revocation_terminal_targets.len() => {
                carrier.revocation_terminal_targets.clone()
            }
            _ => Vec::new(),
        };
        let outcome = self.finish_issuance_outcome(carrier, attempt, epoch_now_ms, monotonic_now);
        AuthFinish::new(outcome, committed_revocations)
    }

    fn finish_issuance_outcome(
        &self,
        carrier: PremarkedIssuance,
        attempt: AuthTransactionAttempt<PlannedIssuanceCommit>,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<IssuanceFinish> {
        let mut topology = self.lock_topology()?;
        let session_id = carrier.plan.projected_insert().session_id;
        match attempt {
            AuthTransactionAttempt::RolledBack(error) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Err(error)
            }
            AuthTransactionAttempt::CommitUncertain(_) => {
                fail_issuance_closed(&mut topology, &carrier);
                Err(revocation_uncertain())
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::PredecessorChanged) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Ok(IssuanceFinish::PredecessorChanged)
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CandidateCollision) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Ok(IssuanceFinish::CandidateCollision)
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CodeInvalid) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Ok(IssuanceFinish::CodeInvalid)
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CodeLocked) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Ok(IssuanceFinish::CodeLocked)
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CredentialInvalid {
                ..
            }) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Ok(IssuanceFinish::CredentialInvalid)
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CredentialThrottled) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Ok(IssuanceFinish::CredentialThrottled)
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::GuestBudgetRefused {
                budget_name,
                retry_after_ms,
                correlation_id,
            }) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Ok(IssuanceFinish::GuestBudgetRefused {
                    budget_name,
                    retry_after_ms,
                    correlation_id,
                })
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::GuestIdempotencyConflict) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Ok(IssuanceFinish::GuestIdempotencyConflict)
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::SenderKeyBound) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Ok(IssuanceFinish::SenderKeyBound)
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::RehearsalReplay(value)) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Ok(IssuanceFinish::RehearsalReplay(value))
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::RehearsalDenied(error)) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Ok(IssuanceFinish::RehearsalDenied(error))
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
                session,
                committed_revocations,
            }) => {
                let revocations_match = committed_revocations.len()
                    == carrier.plan.revocations().len()
                    && committed_revocations
                        .iter()
                        .zip(carrier.plan.revocations())
                        .all(|(committed, planned)| {
                            committed.session_id == planned.session_id()
                                && committed.generation
                                    == planned.expected_generation().saturating_add(1)
                        });
                if session.id != session_id || !revocations_match {
                    fail_issuance_closed(&mut topology, &carrier);
                    return Err(projection_unavailable());
                }
                for (ticket, revocation) in carrier
                    .revocation_tickets
                    .iter()
                    .zip(&committed_revocations)
                {
                    if topology
                        .projection
                        .finalize_revocation(ticket, &revocation.session_id, revocation.generation)
                        .is_err()
                    {
                        fail_issuance_closed(&mut topology, &carrier);
                        return Err(projection_unavailable());
                    }
                }
                if self.take_finalize_failpoint()
                    || topology
                        .projection
                        .finalize_issuance(
                            &carrier.issuance_ticket,
                            &session_id,
                            epoch_now_ms,
                            monotonic_now,
                        )
                        .is_err()
                {
                    fail_issuance_closed(&mut topology, &carrier);
                    return Err(projection_unavailable());
                }
                let outcome = CommittedAuthOutcome {
                    state: Arc::new(Mutex::new(Some(CommittedAuthOutcomeState {
                        publication: topology.projection.anonymous_publication_fence(),
                        ticket: carrier.issuance_ticket.clone(),
                        permitted_pending_tickets: BTreeSet::new(),
                        finalized_rotation_cut: None,
                        response_class: CommittedAuthResponseClass::CredentialSecret,
                    }))),
                };
                Ok(IssuanceFinish::Committed {
                    issue: carrier.plan.into_issue(session, committed_revocations),
                    outcome,
                })
            }
        }
    }

    pub fn finish_password_change(
        &self,
        carrier: PremarkedPasswordChange,
        attempt: AuthTransactionAttempt<PlannedPasswordChangeCommit>,
    ) -> AuthFinish<PasswordChangeFinish> {
        let terminal_targets = match &attempt {
            AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::Committed {
                committed_revocations,
                ..
            }) if committed_revocations.len() == carrier.revocation_terminal_targets.len() => {
                carrier.revocation_terminal_targets.clone()
            }
            _ => Vec::new(),
        };
        let outcome = self.finish_password_change_outcome(carrier, attempt);
        AuthFinish::new(outcome, terminal_targets)
    }

    fn finish_password_change_outcome(
        &self,
        carrier: PremarkedPasswordChange,
        attempt: AuthTransactionAttempt<PlannedPasswordChangeCommit>,
    ) -> SnapbackResult<PasswordChangeFinish> {
        let mut topology = self.lock_topology()?;
        match attempt {
            AuthTransactionAttempt::RolledBack(error) => {
                exact_unmark_password_change(&mut topology, &carrier)?;
                Err(error)
            }
            AuthTransactionAttempt::CommitUncertain(_) => {
                fail_password_change_closed(&mut topology, &carrier);
                Err(revocation_uncertain())
            }
            AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::PredecessorChanged) => {
                exact_unmark_password_change(&mut topology, &carrier)?;
                Ok(PasswordChangeFinish::PredecessorChanged)
            }
            AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::CandidateCollision) => {
                exact_unmark_password_change(&mut topology, &carrier)?;
                Ok(PasswordChangeFinish::CandidateCollision)
            }
            AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::CredentialInvalid {
                ..
            }) => {
                exact_unmark_password_change(&mut topology, &carrier)?;
                Ok(PasswordChangeFinish::CredentialInvalid)
            }
            AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::CredentialThrottled) => {
                exact_unmark_password_change(&mut topology, &carrier)?;
                Ok(PasswordChangeFinish::CredentialThrottled)
            }
            AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::GuestClaimCollision) => {
                exact_unmark_password_change(&mut topology, &carrier)?;
                Ok(PasswordChangeFinish::GuestClaimCollision)
            }
            AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::GuestAlreadyClaimed) => {
                exact_unmark_password_change(&mut topology, &carrier)?;
                Ok(PasswordChangeFinish::GuestAlreadyClaimed)
            }
            AuthTransactionAttempt::Committed(
                PlannedPasswordChangeCommit::GuestBudgetRefused {
                    budget_name,
                    retry_after_ms,
                },
            ) => {
                exact_unmark_password_change(&mut topology, &carrier)?;
                Ok(PasswordChangeFinish::GuestBudgetRefused {
                    budget_name,
                    retry_after_ms,
                })
            }
            AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::Committed {
                session,
                committed_revocations,
            }) => {
                let revocations_match = committed_revocations.len()
                    == carrier.plan.revocations().len()
                    && committed_revocations
                        .iter()
                        .zip(carrier.plan.revocations())
                        .all(|(committed, planned)| {
                            committed.session_id == planned.session_id()
                                && committed.generation
                                    == planned.expected_generation().saturating_add(1)
                        });
                if session.id != carrier.plan.rotation().session_id() || !revocations_match {
                    fail_password_change_closed(&mut topology, &carrier);
                    return Err(projection_unavailable());
                }
                for (ticket, revocation) in carrier
                    .revocation_tickets
                    .iter()
                    .zip(&committed_revocations)
                {
                    if topology
                        .projection
                        .finalize_revocation(ticket, &revocation.session_id, revocation.generation)
                        .is_err()
                    {
                        fail_password_change_closed(&mut topology, &carrier);
                        return Err(projection_unavailable());
                    }
                }
                if self.take_finalize_failpoint()
                    || topology
                        .projection
                        .finalize_token_rotation(
                            &carrier.rotation_ticket,
                            carrier.plan.rotation().session_id(),
                            carrier.plan.successor_provider(),
                        )
                        .is_err()
                {
                    fail_password_change_closed(&mut topology, &carrier);
                    return Err(projection_unavailable());
                }
                Ok(PasswordChangeFinish::Committed(
                    carrier.plan.into_issue(session),
                ))
            }
        }
    }

    /// Required-session bearer resolution is memory-only. It never enters
    /// `LocalDatabase`, and it retains authority-instance identity for item 7
    /// while exposing neither digest nor fence to application code.
    pub fn resolve_required_bearer(
        &self,
        bearer: &str,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<PreparedBearerAuthority> {
        let bearer = SessionBearer::parse_any_version(bearer).map_err(|_| auth_required())?;
        let digest = TokenDigest::from_token_hash(&bearer.token_hash());
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        let authority =
            match topology
                .projection
                .resolve_token(&digest, epoch_now_ms, monotonic_now)?
            {
                ProjectedTokenResolution::Current(authority) => authority,
                ProjectedTokenResolution::Superseded {
                    authority,
                    superseded_at_ms,
                } => {
                    let age = epoch_now_ms
                        .checked_sub(superseded_at_ms)
                        .ok_or_else(projection_unavailable)?;
                    if age > AUTH_SESSION_SUPERSESSION_GRACE_MS {
                        return Err(credential_superseded());
                    }
                    authority
                }
                ProjectedTokenResolution::Terminal { reason } => {
                    return Err(session_expired(reason));
                }
                ProjectedTokenResolution::Unavailable => return Err(projection_unavailable()),
                ProjectedTokenResolution::Unknown => return Err(auth_required()),
            };
        topology.prepare_bearer_authority(authority, Some(Arc::new(bearer)))
    }

    /// @ref LLP 0057#rotation — family operations own supersession outcomes.
    /// Resolve a bearer for an operation that owns the token-family state
    /// machine. Unlike ordinary finite use, refresh and logout must admit an
    /// attributable superseded token regardless of grace age so their durable
    /// planner can select the exact refresh-reuse or logout outcome. Resolution
    /// remains projection-only and returns the same final-publication fence.
    pub fn resolve_family_bearer(
        &self,
        bearer: &str,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<PreparedBearerAuthority> {
        let bearer = SessionBearer::parse_any_version(bearer).map_err(|_| auth_required())?;
        let digest = TokenDigest::from_token_hash(&bearer.token_hash());
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        let authority =
            match topology
                .projection
                .resolve_token(&digest, epoch_now_ms, monotonic_now)?
            {
                ProjectedTokenResolution::Current(authority)
                | ProjectedTokenResolution::Superseded { authority, .. } => authority,
                ProjectedTokenResolution::Terminal { reason } => {
                    return Err(session_expired(reason));
                }
                ProjectedTokenResolution::Unavailable => return Err(projection_unavailable()),
                ProjectedTokenResolution::Unknown => return Err(auth_required()),
            };
        topology.prepare_bearer_authority(authority, Some(Arc::new(bearer)))
    }

    /// Bind an anonymous finite publication to the current authorization
    /// stream. Reset/restore can therefore fence an already-computed public
    /// response at the same final handoff used for session responses.
    pub fn prepare_anonymous_publication(&self) -> SnapbackResult<FencedPublication> {
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        Ok(topology.projection.anonymous_publication_fence())
    }

    /// Return the current anonymous stream fence without provider or SQLite
    /// access. The caller performs the final grant insertion through this
    /// fence, so a concurrent reset cannot publish predecessor authority.
    pub fn prepare_anonymous_connection(
        &self,
    ) -> SnapbackResult<PreparedAnonymousConnectionAuthority> {
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        Ok(PreparedAnonymousConnectionAuthority {
            authorization_stream_incarnation: topology.projection.incarnation().as_str().to_owned(),
            publication: topology.projection.anonymous_publication_fence(),
        })
    }

    /// Classify a canonical bearer exclusively through the detached
    /// projection. Superseded and blocked tokens retain only their throttle
    /// key and can never mint or renew a connection grant.
    ///
    /// @ref LLP 0059#connection-bound-authority — connection open never falls
    /// through to provider/SQLite resolution and only an exact current leaf
    /// yields a grant publication fence.
    pub fn classify_connection_bearer(
        &self,
        bearer: &SessionBearer,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<ConnectionBearerResolution> {
        let digest = TokenDigest::from_token_hash(&bearer.token_hash());
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        let incarnation = topology.projection.incarnation().as_str().to_owned();
        let resolution =
            topology
                .projection
                .classify_connection_token(&digest, epoch_now_ms, monotonic_now)?;
        let key = |session_id: String, generation| ConnectionSessionThrottleKey {
            authorization_stream_incarnation: incarnation.clone(),
            session_id,
            generation,
        };
        Ok(match resolution {
            ProjectedConnectionTokenResolution::Current(authority) => {
                let publication = topology
                    .projection
                    .session_publication_fence(authority.session_id(), authority.generation())?;
                let deadline_ms = authority.expires_at_ms();
                ConnectionBearerResolution::Current(PreparedConnectionSessionAuthority {
                    authority: ResolvedAppAuthority::from_projected_session(
                        authority,
                        topology.admission.lease_origin(),
                    ),
                    authorization_stream_incarnation: incarnation,
                    deadline_ms,
                    publication,
                    bearer: Arc::new(
                        SessionBearer::parse_any_version(bearer.expose_secret())
                            .map_err(|_| auth_required())?,
                    ),
                })
            }
            ProjectedConnectionTokenResolution::Superseded(authority) => {
                ConnectionBearerResolution::Superseded(key(
                    authority.session_id().to_owned(),
                    authority.generation(),
                ))
            }
            ProjectedConnectionTokenResolution::Unavailable {
                session_id,
                generation,
            } => ConnectionBearerResolution::Unavailable(key(session_id, generation)),
            ProjectedConnectionTokenResolution::Unknown => ConnectionBearerResolution::Unknown {
                authorization_stream_incarnation: incarnation,
            },
        })
    }

    /// Rehydrate the internal authority-instance field deliberately omitted
    /// from a stored grant. This is a bounded in-memory projection lookup; the
    /// grant's cloned `FencedPublication` still owns the final act-time cut.
    #[allow(clippy::too_many_arguments)]
    pub fn resolve_bound_connection_session(
        &self,
        authorization_stream_incarnation: &str,
        session_id: &str,
        user_id: &str,
        provider: &str,
        generation: u64,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<BoundSessionResolution> {
        let incarnation = AuthorizationStreamIncarnation::parse(authorization_stream_incarnation)?;
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        Ok(
            match topology.projection.resolve_bound_connection_session(
                BoundConnectionSessionIdentity::new(
                    &incarnation,
                    session_id,
                    user_id,
                    provider,
                    generation,
                ),
                epoch_now_ms,
                monotonic_now,
            )? {
                ProjectedBoundSessionResolution::Current(authority) => {
                    let authority = ResolvedAppAuthority::from_projected_session(
                        authority,
                        topology.admission.lease_origin(),
                    );
                    let publication = topology
                        .projection
                        .session_publication_fence(session_id, generation)?;
                    BoundSessionResolution::Current(PreparedBearerAuthority {
                        authority,
                        publication,
                        bearer: None,
                    })
                }
                ProjectedBoundSessionResolution::Terminal { reason } => {
                    BoundSessionResolution::Terminal { reason }
                }
                ProjectedBoundSessionResolution::Unavailable => BoundSessionResolution::Unavailable,
            },
        )
    }

    /// Rehydrate a bearer-free session snapshot for one approved effect and
    /// return the same final-publication fence used by bearer resolution.
    /// Every durable identity coordinate and the stream incarnation must
    /// still be current; no bearer is recovered or retained.
    /// @ref LLP 0303#the-governing-principle — every retained session
    /// coordinate is read from the pending-effect approval carrier.
    pub fn prepare_retained_effect_session(
        &self,
        retained: &crate::storage::pending_effects::RetainedEffectSessionAuthority<'_>,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<PreparedBearerAuthority> {
        if !self
            .database_binding
            .as_ref()
            .is_some_and(|binding| retained.belongs_to_database(binding))
        {
            return Err(SnapbackError::error(
                "SNAPBACK_EFFECT_AUTHORITY_INVALID",
                "effects",
                "retained effect session authority belongs to a different database",
            ));
        }
        let resolved = self.resolve_bound_connection_session(
            retained.authorization_stream_incarnation(),
            retained.session_id(),
            retained.user_id(),
            retained.provider(),
            retained.generation(),
            epoch_now_ms,
            monotonic_now,
        )?;
        let BoundSessionResolution::Current(authority) = resolved else {
            return Err(projection_unavailable());
        };
        if !authority.matches_authority_instance_id(retained.authority_instance_id()) {
            return Err(SnapbackError::error(
                "SNAPBACK_EFFECT_BINDING_STALE",
                "effects",
                "the original session authority instance is no longer current",
            ));
        }
        Ok(authority)
    }

    /// Publish the later deadline only after the provider's durable result is
    /// known (or its explicit no-write result is known). Refresh never calls
    /// this path.
    pub fn finalize_authenticated_use(
        &self,
        session_id: &str,
        expected_generation: u64,
        outcome: AuthenticatedUse,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Option<u64>> {
        let durable_expires_at_ms = match outcome {
            AuthenticatedUse::NotLive => return Ok(None),
            AuthenticatedUse::Unchanged { .. } => None,
            AuthenticatedUse::Extended { expires_at_ms } => Some(expires_at_ms),
        };
        let mut topology = self.lock_topology()?;
        topology.require_session_available(session_id)?;
        topology.projection.publish_authenticated_use_deadline(
            session_id,
            expected_generation,
            epoch_now_ms,
            monotonic_now,
            AUTH_SESSION_SLIDING_WINDOW_MS,
            durable_expires_at_ms,
        )
    }

    pub fn sample_due_expiries(
        &self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Option<DueExpiryBatch>> {
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        topology
            .projection
            .sample_due_expiries(epoch_now_ms, monotonic_now)
    }

    pub async fn expire_sampled_due(
        self: &Arc<Self>,
        batch: DueExpiryBatch,
    ) -> SnapbackResult<DueExpiryFinalization> {
        let premarked = {
            let mut topology = self.lock_topology()?;
            if topology.global_rebuild_required {
                return Err(projection_unavailable());
            }
            topology.projection.begin_sampled_due_expiries(batch)?
        };
        let cleanup_entries = premarked
            .entries
            .iter()
            .map(|entry| (entry.ticket.clone(), entry.session_id.clone()))
            .collect();
        let drains = premarked
            .entries
            .iter()
            .map(|entry| entry.drain.clone())
            .collect::<Vec<_>>();
        let mut rollback = PendingDrainRollback::new(
            Arc::clone(self),
            PendingDrainCleanup::Expiries {
                entries: cleanup_entries,
            },
        );
        for drain in drains {
            drain.wait().await;
        }
        rollback.disarm();
        let mut topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        let finalized = topology.projection.finalize_sampled_due_expiries(premarked);
        if finalized.failed_closed() {
            topology.global_rebuild_required = true;
        }
        Ok(finalized)
    }

    pub fn expiry_scan_delay(&self, monotonic_now: Instant) -> SnapbackResult<Duration> {
        let topology = self.lock_topology()?;
        Ok(topology.projection.expiry_scan_delay(monotonic_now))
    }

    pub fn requires_rebuild(&self, session_id: &str) -> SnapbackResult<bool> {
        let topology = self.lock_topology()?;
        Ok(topology.global_rebuild_required
            || topology.rebuild_required_sessions.contains(session_id))
    }

    pub(crate) fn check_invariants(&self) -> SnapbackResult<()> {
        self.lock_topology()?.projection.check_invariants()
    }

    /// Exact process authority identity advertised by the bootstrap
    /// handshake and captured by clients for every retained/queued scope.
    pub fn authorization_stream_incarnation(&self) -> SnapbackResult<String> {
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        Ok(topology.projection.incarnation().as_str().to_owned())
    }

    /// Bind the bootstrap response to this coordinator's current stream.
    /// The raw incarnation setter remains crate-private so a higher adapter
    /// cannot assert an arbitrary authorization-stream identity.
    pub fn bind_authorization_stream(
        &self,
        authority: PreparedAuthority,
    ) -> SnapbackResult<PreparedAuthority> {
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        let incarnation = topology.projection.incarnation().as_str().to_owned();
        authority.bind_authorization_stream(&topology.admission, incarnation)
    }

    /// Mint the process-live half of rehearsal authority only from an
    /// admitted coordinator. The returned carrier keeps the raw registry out
    /// of invocation-preparation APIs.
    pub fn rehearsal_authority_binding(&self) -> SnapbackResult<RehearsalAuthorityBinding> {
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        drop(topology);
        let binding = RehearsalAuthorityBinding::new(self.rehearsal_live_authority.clone());
        Ok(binding)
    }

    pub fn rehearsal_capability_active(&self, now_ms: u64) -> bool {
        let mut live = self
            .rehearsal_live_authority
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        live.retain(|_, authority| authority.expires_at_ms > now_ms);
        !live.is_empty()
    }

    pub fn publish_rehearsal_grant(&self, minted: &crate::auth::rehearsal::MintedRehearsalGrant) {
        self.rehearsal_live_authority
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                minted.grant.grant_id.clone(),
                crate::auth::rehearsal::RehearsalLiveAuthority {
                    expires_at_ms: minted.grant.expires_at,
                    parent_grant_id: None,
                },
            );
    }

    pub fn publish_rehearsal_window(&self, window: &crate::auth::rehearsal::AuthRehearsalWindowV1) {
        self.rehearsal_live_authority
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                window.window_id.clone(),
                crate::auth::rehearsal::RehearsalLiveAuthority {
                    expires_at_ms: window.expires_at,
                    parent_grant_id: Some(window.grant_id.clone()),
                },
            );
    }

    pub fn retire_rehearsal_grant(&self, grant_id: &str) {
        self.rehearsal_live_authority
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|authority_id, authority| {
                authority_id != grant_id && authority.parent_grant_id.as_deref() != Some(grant_id)
            });
    }

    pub fn clear_rehearsal_authority(&self) {
        self.rehearsal_live_authority
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }

    pub fn fail_global_closed(&self) -> SnapbackResult<()> {
        self.lock_topology()?.global_rebuild_required = true;
        Ok(())
    }

    fn lock_topology(&self) -> SnapbackResult<RankedMutexGuard<'_, CoordinatorTopology>> {
        ranked_mutex_lock(&self.topology, AUTH_LOCK_RANK_TOPOLOGY)
            .map_err(|_| projection_unavailable())
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn inject_finalize_failure(&self) {
        self.fail_next_finalize
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    #[cfg(any(test, feature = "test-support"))]
    fn take_finalize_failpoint(&self) -> bool {
        self.fail_next_finalize
            .swap(false, std::sync::atomic::Ordering::SeqCst)
    }

    #[cfg(not(any(test, feature = "test-support")))]
    fn take_finalize_failpoint(&self) -> bool {
        false
    }
}

impl CoordinatorTopology {
    fn require_session_available(&self, session_id: &str) -> SnapbackResult<()> {
        if self.global_rebuild_required || self.rebuild_required_sessions.contains(session_id) {
            Err(projection_unavailable())
        } else {
            Ok(())
        }
    }

    fn prepare_bearer_authority(
        &self,
        authority: ProjectedSessionAuthority,
        bearer: Option<Arc<SessionBearer>>,
    ) -> SnapbackResult<PreparedBearerAuthority> {
        if self
            .rebuild_required_sessions
            .contains(authority.session_id())
        {
            return Err(projection_unavailable());
        }
        let publication = self
            .projection
            .session_publication_fence(authority.session_id(), authority.generation())?;
        Ok(PreparedBearerAuthority {
            authority: ResolvedAppAuthority::from_projected_session(
                authority,
                self.admission.lease_origin(),
            ),
            publication,
            bearer,
        })
    }
}

fn exact_unmark_revocation(
    topology: &mut CoordinatorTopology,
    carrier: &PremarkedRevocation,
) -> SnapbackResult<()> {
    match topology
        .projection
        .compare_unmark_session(&carrier.ticket, carrier.plan.session_id())
    {
        Ok(true) => Ok(()),
        Ok(false) | Err(_) => {
            topology.global_rebuild_required = true;
            Err(projection_unavailable())
        }
    }
}

fn exact_unmark_rotation(
    topology: &mut CoordinatorTopology,
    carrier: &PremarkedRotation,
) -> SnapbackResult<()> {
    match topology
        .projection
        .compare_unmark_session(&carrier.ticket, carrier.plan.session_id())
    {
        Ok(true) => Ok(()),
        Ok(false) | Err(_) => {
            topology.global_rebuild_required = true;
            Err(projection_unavailable())
        }
    }
}

fn exact_unmark_issuance(
    topology: &mut CoordinatorTopology,
    carrier: &PremarkedIssuance,
) -> SnapbackResult<()> {
    for (ticket, revocation) in carrier
        .revocation_tickets
        .iter()
        .zip(carrier.plan.revocations())
    {
        if !matches!(
            topology
                .projection
                .compare_unmark_session(ticket, revocation.session_id()),
            Ok(true)
        ) {
            topology.global_rebuild_required = true;
            return Err(projection_unavailable());
        }
    }
    let session_id = carrier.plan.projected_insert().session_id;
    match topology
        .projection
        .compare_unmark_issuance(&carrier.issuance_ticket, &session_id)
    {
        Ok(true) => Ok(()),
        Ok(false) | Err(_) => {
            topology.global_rebuild_required = true;
            Err(projection_unavailable())
        }
    }
}

fn exact_unmark_password_change(
    topology: &mut CoordinatorTopology,
    carrier: &PremarkedPasswordChange,
) -> SnapbackResult<()> {
    for (ticket, revocation) in carrier
        .revocation_tickets
        .iter()
        .zip(carrier.plan.revocations())
    {
        if !matches!(
            topology
                .projection
                .compare_unmark_session(ticket, revocation.session_id()),
            Ok(true)
        ) {
            topology.global_rebuild_required = true;
            return Err(projection_unavailable());
        }
    }
    if matches!(
        topology.projection.compare_unmark_session(
            &carrier.rotation_ticket,
            carrier.plan.rotation().session_id(),
        ),
        Ok(true)
    ) {
        Ok(())
    } else {
        topology.global_rebuild_required = true;
        Err(projection_unavailable())
    }
}

fn fail_password_change_closed(
    topology: &mut CoordinatorTopology,
    carrier: &PremarkedPasswordChange,
) {
    for (ticket, revocation) in carrier
        .revocation_tickets
        .iter()
        .zip(carrier.plan.revocations())
    {
        fail_session_closed(
            topology,
            ticket,
            revocation.session_id(),
            revocation.expected_generation().checked_add(1),
        );
    }
    fail_session_closed(
        topology,
        &carrier.rotation_ticket,
        carrier.plan.rotation().session_id(),
        Some(carrier.plan.rotation().expected_generation()),
    );
    topology.global_rebuild_required = true;
}

fn fail_issuance_closed(topology: &mut CoordinatorTopology, carrier: &PremarkedIssuance) {
    for (ticket, revocation) in carrier
        .revocation_tickets
        .iter()
        .zip(carrier.plan.revocations())
    {
        fail_session_closed(
            topology,
            ticket,
            revocation.session_id(),
            revocation.expected_generation().checked_add(1),
        );
    }
    let session_id = carrier.plan.projected_insert().session_id;
    let _ = topology
        .projection
        .compare_unmark_issuance(&carrier.issuance_ticket, &session_id);
    topology.global_rebuild_required = true;
}

fn fail_session_closed(
    topology: &mut CoordinatorTopology,
    ticket: &MutationTicket,
    session_id: &str,
    committed_generation: Option<u64>,
) {
    if topology
        .projection
        .mark_session_uncertain(ticket, session_id, committed_generation)
        .is_ok()
    {
        topology
            .rebuild_required_sessions
            .insert(session_id.to_owned());
    } else {
        topology.global_rebuild_required = true;
    }
}

fn projection_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
        "auth",
        "authentication projection is unavailable",
    )
}

fn revocation_uncertain() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_REVOCATION_UNCERTAIN",
        "auth",
        "authentication mutation commit could not be reconciled",
    )
}

fn auth_required() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_REQUIRED",
        "auth",
        "authentication is required",
    )
}

fn credential_superseded() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED",
        "auth",
        "authentication credential has been superseded",
    )
}

fn session_expired(reason: RevocationReason) -> SnapbackError {
    let authority_disposition = match reason.authority_disposition() {
        super::session_projection::TerminalAuthorityDisposition::Carrier => "carrier",
        super::session_projection::TerminalAuthorityDisposition::DurableDelete => "durableDelete",
    };
    SnapbackError::error(
        "SNAPBACK_AUTH_SESSION_EXPIRED",
        "auth",
        "authentication session is expired or revoked",
    )
    .with_details(serde_json::json!({
        "authorityDisposition": authority_disposition,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::OsRandom;
    use crate::auth::invocation::{InvocationGate, InvocationSource, WireAuthorityFields};
    use crate::auth::keyring::AuthKeyringStore;
    use crate::auth::provider::{
        AuthAdmission, AuthProvider, CredentialIssue, PasswordIssuanceCustody,
        PlannedIssuanceCommit, PlannedLogout, PlannedPasswordChangeCommit, PlannedRefresh,
        ProviderGuestSessionPlan,
    };
    use crate::contract_types::{
        ApiManifest, AuthProviderProfile, RevocationReason, ServerProfile,
    };
    use crate::manifest::{ArtifactGeneration, AuthMode, FunctionKind, SchemaManifest};
    use std::sync::Arc;
    use std::time::Duration;

    const FIXTURE_SESSION_CREATED_MS: u64 = 100;
    const FIXTURE_SESSION_EXPIRES_MS: u64 =
        FIXTURE_SESSION_CREATED_MS + AUTH_SESSION_SLIDING_WINDOW_MS;
    const FIXTURE_SESSION_ABSOLUTE_EXPIRES_MS: u64 =
        FIXTURE_SESSION_CREATED_MS + crate::auth::provider::AUTH_SESSION_ABSOLUTE_WINDOW_MS;
    const FIXTURE_ROTATION_MS: u64 = 250;
    const FIXTURE_FAMILY_ALARM_MS: u64 =
        FIXTURE_ROTATION_MS + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1;
    const FIXTURE_FAMILY_COMMIT_MS: u64 = FIXTURE_FAMILY_ALARM_MS + 1;

    fn pending_session_owner_evidence(
        bearer: &str,
    ) -> crate::storage::pending_effects::PendingEffectOwnerEvidence {
        crate::storage::pending_effects::PendingEffectOwnerEvidence::Session(
            SessionBearer::parse_any_version(bearer).expect("pending-effect test session bearer"),
        )
    }

    struct Fixture {
        coordinator: Arc<AuthCoordinator>,
        admission_controller: AdmissionController,
        incarnation: String,
        user_id: String,
        session_id: String,
        bearer: String,
        digest: TokenDigest,
        authority_instance_id: String,
        substituted_user_id: String,
        substituted_session_id: String,
        substituted_bearer: String,
        monotonic_start: Instant,
        provider: Arc<AuthProvider>,
        provider_admission: AuthAdmission,
        planning_database: Mutex<crate::storage::LocalDatabase>,
    }

    async fn fixture() -> Fixture {
        fixture_with_substituted_session(false).await
    }

    fn mint_guest_session(
        provider: &AuthProvider,
        database: &mut crate::storage::LocalDatabase,
        idempotency_key: &str,
    ) -> CredentialIssue {
        let planned = provider
            .plan_guest_session(
                database,
                // The fixture keyring becomes active at epoch 100. The real
                // provider correctly refuses issuance before that ceremony.
                FIXTURE_SESSION_CREATED_MS,
                crate::auth::provider::AUTH_SESSION_ABSOLUTE_WINDOW_MS,
                crate::auth::throttle::RollingWindowBudgetTerms {
                    limit: 10,
                    window_ms: 1_000,
                },
                idempotency_key,
                "coordinator-test-app",
                "coordinator-test-deployment",
                &format!("sha256:{}", "a".repeat(64)),
                PasswordIssuanceCustody::Bearer,
            )
            .expect("plan guest session through the production provider");
        let ProviderGuestSessionPlan::Planned(plan) = planned else {
            panic!("fresh guest idempotency key must plan an issuance");
        };
        let attempt = provider.commit_guest_issuance(database, &plan.commit_plan());
        let AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
            session,
            committed_revocations,
        }) = attempt
        else {
            panic!("production guest issuance must commit");
        };
        plan.into_issue(session, committed_revocations)
    }

    async fn fixture_with_substituted_session(include_substituted_session: bool) -> Fixture {
        fixture_with_sessions(include_substituted_session, false).await
    }

    async fn fixture_with_claimed_password_session() -> Fixture {
        fixture_with_sessions(false, true).await
    }

    async fn fixture_with_sessions(
        include_substituted_session: bool,
        claim_original_password: bool,
    ) -> Fixture {
        let monotonic_start = Instant::now();
        let admission_controller =
            crate::auth::invocation::test_admission_controller(AuthMode::Sessions, 0)
                .expect("sessions admission controller");
        let mut planning_database =
            crate::storage::LocalDatabase::memory().expect("provider planning database");
        planning_database
            .activate_current_auth_catalog()
            .expect("activate provider planning catalog");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(100, &OsRandom)
            .expect("initialize provider planning keyring");
        let provider = Arc::new(
            AuthProvider::new(AuthProviderProfile::Test, keyring)
                .expect("construct provider planning authority"),
        );
        let mut issued = mint_guest_session(
            provider.as_ref(),
            &mut planning_database,
            "coordinator-original-session",
        );
        let substituted = include_substituted_session.then(|| {
            mint_guest_session(
                provider.as_ref(),
                &mut planning_database,
                "coordinator-substituted-session",
            )
        });
        if claim_original_password {
            let plan = provider
                .plan_guest_claim_password(
                    &planning_database,
                    issued.response().token(),
                    "coordinator-family-alarm@example.test",
                    crate::auth::identity_core::PasswordSecret::new(
                        "coordinator-family-alarm-password".to_owned(),
                    ),
                    FIXTURE_SESSION_CREATED_MS + 1,
                    "coordinator-family-recovery-key",
                    &[7; 32],
                    crate::auth::throttle::RollingWindowBudgetTerms {
                        limit: 10,
                        window_ms: 1_000,
                    },
                    PasswordIssuanceCustody::Bearer,
                )
                .await
                .expect("plan guest password claim through the production provider");
            let attempt =
                provider.commit_password_change(&mut planning_database, &plan.commit_plan());
            let AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::Committed {
                session,
                ..
            }) = attempt
            else {
                panic!("production guest password claim must commit");
            };
            issued = plan.into_issue(session);
        }
        let session = &issued.response().session;
        let user_id = session.user_id.clone();
        let session_id = session.id.clone();
        let authority_instance_id = session.authority_instance_id.clone();
        let bearer_text = issued.response().token().expose_secret().to_owned();
        let digest = TokenDigest::from_token_hash(&issued.response().token().token_hash());
        let substituted_user_id = substituted
            .as_ref()
            .map(|issue| issue.response().session.user_id.clone())
            .unwrap_or_default();
        let substituted_session_id = substituted
            .as_ref()
            .map(|issue| issue.response().session.id.clone())
            .unwrap_or_default();
        let substituted_bearer = substituted
            .as_ref()
            .map(|issue| issue.response().token().expose_secret().to_owned())
            .unwrap_or_default();
        let incarnation = planning_database
            .ensure_authorization_stream_incarnation()
            .expect("mint provider planning authorization stream")
            .as_str()
            .to_owned();
        let coordinator = Arc::new(
            AuthCoordinator::from_local_session_database(
                &mut planning_database,
                admission_controller.clone(),
                100,
                monotonic_start,
            )
            .expect("project the production-created sessions"),
        );
        let provider_admission = provider.admit().await;
        Fixture {
            coordinator,
            admission_controller,
            incarnation,
            user_id,
            session_id,
            bearer: bearer_text,
            digest,
            authority_instance_id,
            substituted_user_id,
            substituted_session_id,
            substituted_bearer,
            monotonic_start,
            provider,
            provider_admission,
            planning_database: Mutex::new(planning_database),
        }
    }

    async fn fixture_from_database(
        include_substituted_session: bool,
        database: &mut crate::storage::LocalDatabase,
    ) -> Fixture {
        let mut fixture = fixture_with_substituted_session(include_substituted_session).await;
        database
            .activate_current_auth_catalog()
            .expect("activate database-backed session fixture catalog");
        let issued = mint_guest_session(
            fixture.provider.as_ref(),
            database,
            "coordinator-original-session",
        );
        assert_eq!(issued.response().session.user_id, fixture.user_id);
        assert_eq!(issued.response().session.id, fixture.session_id);
        if include_substituted_session {
            let substituted = mint_guest_session(
                fixture.provider.as_ref(),
                database,
                "coordinator-substituted-session",
            );
            assert_eq!(
                substituted.response().session.user_id,
                fixture.substituted_user_id
            );
            assert_eq!(
                substituted.response().session.id,
                fixture.substituted_session_id
            );
        }
        fixture.incarnation = database
            .ensure_authorization_stream_incarnation()
            .expect("mint database-backed session fixture stream")
            .as_str()
            .to_owned();
        fixture.coordinator = Arc::new(
            AuthCoordinator::from_local_session_database(
                database,
                fixture.admission_controller.clone(),
                100,
                fixture.monotonic_start,
            )
            .expect("build database-bound session coordinator"),
        );
        fixture
    }

    fn logout_plan(fixture: &Fixture) -> ProviderRevocationPlan {
        let database = fixture.planning_database.lock().unwrap();
        match fixture
            .provider_admission
            .plan_logout(&database, &fixture.bearer, 200)
            .expect("plan logout through the provider")
        {
            PlannedLogout::Revoke(plan) => plan,
            _ => panic!("fixture bearer is a live current session"),
        }
    }

    fn rotation_plan(fixture: &Fixture, now_ms: u64) -> ProviderTokenRotationPlan {
        rotation_plan_for(fixture, &fixture.bearer, now_ms)
    }

    fn rotation_plan_for(
        fixture: &Fixture,
        bearer: &str,
        now_ms: u64,
    ) -> ProviderTokenRotationPlan {
        let database = fixture.planning_database.lock().unwrap();
        match fixture
            .provider_admission
            .plan_refresh(&database, bearer, now_ms)
            .expect("plan refresh through the provider")
        {
            PlannedRefresh::Rotate(plan) => plan,
            _ => panic!("fixture bearer is a live current session"),
        }
    }

    fn issuance_plan(fixture: &Fixture) -> ProviderSessionIssuancePlan {
        let mut database = fixture.planning_database.lock().unwrap();
        let planned = fixture
            .provider
            .plan_guest_session(
                &mut database,
                200,
                10_000,
                crate::auth::throttle::RollingWindowBudgetTerms {
                    limit: 10,
                    window_ms: 1_000,
                },
                "coordinator-issuance-plan",
                "coordinator-test-app",
                "coordinator-test-deployment",
                &format!("sha256:{}", "a".repeat(64)),
                PasswordIssuanceCustody::Bearer,
            )
            .expect("plan guest issuance through the provider");
        let ProviderGuestSessionPlan::Planned(planned) = planned else {
            panic!("fresh guest idempotency key yields an issuance plan");
        };
        planned.into_coordinated_parts().0
    }

    async fn family_alarm_fixture() -> (Fixture, ProviderRevocationPlan) {
        let mut fixture = fixture_with_claimed_password_session().await;
        let predecessor_bearer = fixture.bearer.clone();
        let rotation = rotation_plan(&fixture, FIXTURE_ROTATION_MS);
        let commit_plan = rotation.commit_plan();
        let carrier = fixture
            .coordinator
            .premark_rotation(rotation)
            .await
            .expect("premark provider-planned rotation");
        let attempt = {
            let mut database = fixture.planning_database.lock().unwrap();
            fixture
                .provider_admission
                .commit_planned_rotation(&mut database, &commit_plan)
        };
        let RotationFinish::Committed { issue, .. } = fixture
            .coordinator
            .finish_rotation(carrier, attempt)
            .expect("finalize provider-planned rotation")
        else {
            panic!("provider-planned rotation commits");
        };
        fixture.bearer = issue.response().token().expose_secret().to_owned();
        fixture.digest = TokenDigest::from_token_hash(&issue.response().token().token_hash());
        let family = {
            let database = fixture.planning_database.lock().unwrap();
            fixture
                .provider_admission
                .plan_family_alarm(&database, &predecessor_bearer, FIXTURE_FAMILY_ALARM_MS)
                .expect("plan family alarm from the durable predecessor")
                .revocation_plan()
                .expect("superseded bearer produces an actionable revocation")
        };
        (fixture, family)
    }

    fn committed(fixture: &Fixture) -> AuthTransactionAttempt<PlannedRevocationCommit> {
        AuthTransactionAttempt::Committed(PlannedRevocationCommit::Committed(SessionRevocation {
            session_id: fixture.session_id.clone(),
            generation: 2,
        }))
    }

    fn committed_rotation_session(fixture: &Fixture) -> crate::auth::wire::SessionResponse {
        crate::auth::wire::SessionResponse {
            id: fixture.session_id.clone(),
            user_id: fixture.user_id.clone(),
            provider: "guest".to_owned(),
            created_at: FIXTURE_SESSION_CREATED_MS,
            expires_at: FIXTURE_SESSION_EXPIRES_MS,
            absolute_expires_at: FIXTURE_SESSION_ABSOLUTE_EXPIRES_MS,
            authority_instance_id: fixture.authority_instance_id.clone(),
            generation: 1,
        }
    }

    async fn wait_until_publication_closed(
        publication: &FencedPublication,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                match publication
                    .try_reserve_work(epoch_now_ms, monotonic_now)
                    .expect("probe publication")
                {
                    Some(probe) => drop(probe),
                    None => return,
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("pending marker closes publication");
    }

    /// Model request cancellation at the dangerous boundary: the request owns
    /// only the join waiter while the carrier and its exact finish are already
    /// owned by a task queued on the same owned async-mutex shape used by
    /// `LocalSnapback`. The guarded value is irrelevant to this coordinator
    /// ownership proof.
    async fn cancel_waiter_with_owned_rollback_blocked_on_local<P, T, F, Probe>(
        local: Arc<tokio::sync::Mutex<()>>,
        finish: F,
        blocked_probe: Probe,
    ) -> T
    where
        P: Send + 'static,
        T: Send + 'static,
        F: FnOnce(AuthTransactionAttempt<P>) -> T + Send + 'static,
        Probe: FnOnce(),
    {
        let blocker = local.clone().lock_owned().await;
        let (queued_tx, queued_rx) = tokio::sync::oneshot::channel();
        let (finished_tx, finished_rx) = tokio::sync::oneshot::channel();
        let transaction = tokio::spawn(async move {
            let _ = queued_tx.send(());
            let _local = local.lock().await;
            let attempt = AuthTransactionAttempt::<P>::RolledBack(SnapbackError::error(
                "TEST_ROLLBACK",
                "test",
                "known rollback",
            ));
            assert!(finished_tx.send(finish(attempt)).is_ok());
        });
        let waiter = tokio::spawn(transaction);
        queued_rx.await.expect("owned transaction reaches Local");
        tokio::task::yield_now().await;
        assert!(
            !waiter.is_finished(),
            "owned transaction remains queued behind the Local blocker"
        );
        waiter.abort();
        assert!(waiter.await.unwrap_err().is_cancelled());
        blocked_probe();
        drop(blocker);
        tokio::time::timeout(Duration::from_secs(2), finished_rx)
            .await
            .expect("owned transaction completes after Local reopens")
            .expect("owned transaction publishes its finish")
    }

    fn local_blocker_fixture() -> Arc<tokio::sync::Mutex<()>> {
        Arc::new(tokio::sync::Mutex::new(()))
    }

    #[tokio::test]
    async fn required_bearer_resolution_is_memory_only_and_retains_authority_instance() {
        let fixture = fixture().await;
        let authority = fixture
            .coordinator
            .resolve_required_bearer(
                &fixture.bearer,
                200,
                fixture.monotonic_start + Duration::from_millis(100),
            )
            .unwrap();
        assert!(matches!(
            authority.authority(),
            ResolvedAppAuthority::Session(subject)
                if subject.authority_instance_id() == fixture.authority_instance_id
                    && subject.generation() == 1
        ));
    }

    #[tokio::test]
    async fn cloned_admission_lease_cannot_prepare_two_genuine_session_resolutions() {
        let mut database = crate::storage::LocalDatabase::memory()
            .expect("session authority lease fixture database");
        let fixture = fixture_from_database(true, &mut database).await;
        let mut database = crate::storage::ServingDatabase::adopt(database)
            .expect("adopt session authority lease fixture database");
        let first = fixture
            .coordinator
            .resolve_required_bearer(&fixture.bearer, 200, fixture.monotonic_start)
            .unwrap();
        let second = fixture
            .coordinator
            .resolve_required_bearer(&fixture.substituted_bearer, 200, fixture.monotonic_start)
            .unwrap();
        assert_ne!(
            first.resolved().session_id(),
            second.resolved().session_id()
        );

        let admission = fixture
            .admission_controller
            .admit_for_mode(AuthMode::Sessions)
            .unwrap();
        first
            .prepare(
                &mut database,
                InvocationSource::HttpQuery,
                AuthMode::Sessions,
                ServerProfile::Test,
                admission.clone(),
                &WireAuthorityFields::default(),
                200,
            )
            .expect("the first genuine resolution claims the shared lease identity");
        let error = second
            .prepare(
                &mut database,
                InvocationSource::HttpQuery,
                AuthMode::Sessions,
                ServerProfile::Test,
                admission,
                &WireAuthorityFields::default(),
                200,
            )
            .expect_err("the cloned lease cannot authorize a distinct resolved subject");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_POLICY_UNAVAILABLE");
    }

    #[tokio::test]
    async fn retained_effect_session_rejects_foreign_database_composition_and_borrow_reuse() {
        let mut database_b = crate::storage::LocalDatabase::memory()
            .expect("independent retained-effect session consumer database B");
        let fixture = fixture_from_database(false, &mut database_b).await;
        let mut database_a = crate::storage::LocalDatabase::memory()
            .expect("retained-effect session producer database A");
        database_a
            .activate_current_auth_catalog()
            .expect("activate protected auth catalog in database A");
        let producer_issue = mint_guest_session(
            fixture.provider.as_ref(),
            &mut database_a,
            "coordinator-original-session",
        );
        assert_eq!(producer_issue.response().session.user_id, fixture.user_id);
        assert_eq!(producer_issue.response().session.id, fixture.session_id);
        let mut manifest = SchemaManifest::default();
        manifest.api = Some(ApiManifest {
            enabled: true,
            ..ApiManifest::default()
        });
        database_a
            .schema_seed()
            .apply_schema(manifest)
            .expect("activate pending-effect storage in database A");
        let mut database_a = crate::storage::ServingDatabase::adopt(database_a)
            .expect("adopt retained-effect producer database A");
        let exact = crate::storage::pending_effects::PendingEffectAuthority::Session {
            user_id: fixture.user_id.clone(),
            session_id: fixture.session_id.clone(),
            provider: "guest".to_owned(),
            generation: 1,
            authority_instance_id: fixture.authority_instance_id.clone(),
            authorization_stream_incarnation: fixture.incarnation.clone(),
        };
        let owner = database_a
            .resolve_pending_effect_owner(pending_session_owner_evidence(&fixture.bearer), 100)
            .expect("derive producer owner from database A");
        let created = database_a
            .create_pending_effect_admitted(
                &owner,
                crate::storage::pending_effects::CreatePendingEffect {
                    function_id: "fn:write".to_owned(),
                    function_name: "write".to_owned(),
                    function_kind: FunctionKind::Mutation,
                    args: serde_json::json!({ "title": "foreign-database" }),
                    caller_lane: "integration".to_owned(),
                    caller_key: "session-cross-database-test".to_owned(),
                    authority: exact,
                    generation: ArtifactGeneration {
                        schema_version: "snapback.v1".to_owned(),
                        app_id: "app".to_owned(),
                        schema_hash: "schema".to_owned(),
                        bundle_hash: "bundle".to_owned(),
                        inputs_hash: "inputs".to_owned(),
                    },
                    link_origin_id: None,
                    approver_principal_id: Some(fixture.user_id.clone()),
                    declared_write_set: vec!["todos".to_owned()],
                    now_ms: 100,
                    ttl_ms: 1_000,
                },
            )
            .expect("store matching session coordinates in database A");
        let approval = database_a
            .prepare_pending_effect_approval(&owner, &created.id, 200)
            .expect("derive a retained session view from database A");
        let crate::storage::pending_effects::RetainedEffectOriginalAuthority::Session(retained) =
            approval.original_authority()
        else {
            panic!("stored session authority must produce the session borrow view")
        };

        for attempt in 1..=2 {
            let error = fixture
                .coordinator
                .prepare_retained_effect_session(
                    &retained,
                    200,
                    fixture.monotonic_start + Duration::from_millis(100),
                )
                .expect_err("database B must reject database A's borrowed retained view");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_EFFECT_AUTHORITY_INVALID",
                "foreign borrowed use {attempt}"
            );
        }
    }

    #[tokio::test]
    async fn retained_effect_session_reconstruction_derives_the_stored_original_subject() {
        let mut database = crate::storage::LocalDatabase::memory()
            .expect("pending-effect session derivation database");
        let fixture = fixture_from_database(true, &mut database).await;
        let mut manifest = SchemaManifest::default();
        manifest.api = Some(ApiManifest {
            enabled: true,
            ..ApiManifest::default()
        });
        database
            .schema_seed()
            .apply_schema(manifest)
            .expect("activate pending-effect storage");
        let mut database = crate::storage::ServingDatabase::adopt(database)
            .expect("adopt pending-effect session derivation database");
        let exact = crate::storage::pending_effects::PendingEffectAuthority::Session {
            user_id: fixture.user_id.clone(),
            session_id: fixture.session_id.clone(),
            provider: "guest".to_owned(),
            generation: 1,
            authority_instance_id: fixture.authority_instance_id.clone(),
            authorization_stream_incarnation: fixture.incarnation.clone(),
        };
        let request = |authority| crate::storage::pending_effects::CreatePendingEffect {
            function_id: "fn:write".to_owned(),
            function_name: "write".to_owned(),
            function_kind: FunctionKind::Mutation,
            args: serde_json::json!({ "title": "derived" }),
            caller_lane: "integration".to_owned(),
            caller_key: "session-derivation-test".to_owned(),
            authority,
            generation: ArtifactGeneration {
                schema_version: "snapback.v1".to_owned(),
                app_id: "app".to_owned(),
                schema_hash: "schema".to_owned(),
                bundle_hash: "bundle".to_owned(),
                inputs_hash: "inputs".to_owned(),
            },
            link_origin_id: None,
            approver_principal_id: Some(fixture.user_id.clone()),
            declared_write_set: vec!["todos".to_owned()],
            now_ms: 100,
            ttl_ms: 1_000,
        };
        let owner = database
            .resolve_pending_effect_owner(pending_session_owner_evidence(&fixture.bearer), 100)
            .expect("derive the exact session pending-effect owner");
        let created = database
            .create_pending_effect_admitted(&owner, request(exact.clone()))
            .expect("store original session authority B");
        let approval = database
            .prepare_pending_effect_approval(&owner, &created.id, 200)
            .expect("derive the exact effect for approver A");
        let crate::storage::pending_effects::RetainedEffectOriginalAuthority::Session(retained) =
            approval.original_authority()
        else {
            panic!("stored session authority must produce the session borrow view")
        };
        fixture
            .coordinator
            .resolve_bound_connection_session(
                &fixture.incarnation,
                &fixture.substituted_session_id,
                &fixture.substituted_user_id,
                "guest",
                1,
                200,
                fixture.monotonic_start + Duration::from_millis(100),
            )
            .expect("confirm independently selectable substitute C is live");
        let reconstructed = fixture
            .coordinator
            .prepare_retained_effect_session(
                &retained,
                200,
                fixture.monotonic_start + Duration::from_millis(100),
            )
            .expect("reconstruct stored original session authority B");
        let ResolvedAppAuthority::Session(subject) = reconstructed.authority() else {
            panic!("retained session reconstruction must produce session authority")
        };
        assert_eq!(subject.user_id(), fixture.user_id.as_str());

        let mut cases = Vec::new();
        let mut add_case =
            |name: &'static str,
             mutate: fn(&mut crate::storage::pending_effects::PendingEffectAuthority)| {
                let mut retained = exact.clone();
                mutate(&mut retained);
                cases.push((name, retained));
            };
        add_case("stream-lower", |authority| {
            let crate::storage::pending_effects::PendingEffectAuthority::Session {
                authorization_stream_incarnation,
                ..
            } = authority
            else {
                unreachable!()
            };
            *authorization_stream_incarnation = String::new();
        });
        add_case("stream-higher", |authority| {
            let crate::storage::pending_effects::PendingEffectAuthority::Session {
                authorization_stream_incarnation,
                ..
            } = authority
            else {
                unreachable!()
            };
            *authorization_stream_incarnation = "\u{10ffff}".to_owned();
        });
        add_case("session-lower", |authority| {
            let crate::storage::pending_effects::PendingEffectAuthority::Session {
                session_id, ..
            } = authority
            else {
                unreachable!()
            };
            *session_id = String::new();
        });
        add_case("session-higher", |authority| {
            let crate::storage::pending_effects::PendingEffectAuthority::Session {
                session_id, ..
            } = authority
            else {
                unreachable!()
            };
            *session_id = "\u{10ffff}".to_owned();
        });
        add_case("user-lower", |authority| {
            let crate::storage::pending_effects::PendingEffectAuthority::Session {
                user_id, ..
            } = authority
            else {
                unreachable!()
            };
            *user_id = String::new();
        });
        add_case("user-higher", |authority| {
            let crate::storage::pending_effects::PendingEffectAuthority::Session {
                user_id, ..
            } = authority
            else {
                unreachable!()
            };
            *user_id = "\u{10ffff}".to_owned();
        });
        add_case("provider-lower", |authority| {
            let crate::storage::pending_effects::PendingEffectAuthority::Session {
                provider, ..
            } = authority
            else {
                unreachable!()
            };
            *provider = String::new();
        });
        add_case("provider-higher", |authority| {
            let crate::storage::pending_effects::PendingEffectAuthority::Session {
                provider, ..
            } = authority
            else {
                unreachable!()
            };
            *provider = "\u{10ffff}".to_owned();
        });
        add_case("generation-lower", |authority| {
            let crate::storage::pending_effects::PendingEffectAuthority::Session {
                generation, ..
            } = authority
            else {
                unreachable!()
            };
            *generation = 0;
        });
        add_case("generation-higher", |authority| {
            let crate::storage::pending_effects::PendingEffectAuthority::Session {
                generation, ..
            } = authority
            else {
                unreachable!()
            };
            *generation = 2;
        });
        add_case("instance-lower", |authority| {
            let crate::storage::pending_effects::PendingEffectAuthority::Session {
                authority_instance_id,
                ..
            } = authority
            else {
                unreachable!()
            };
            *authority_instance_id = String::new();
        });
        add_case("instance-higher", |authority| {
            let crate::storage::pending_effects::PendingEffectAuthority::Session {
                authority_instance_id,
                ..
            } = authority
            else {
                unreachable!()
            };
            *authority_instance_id = "\u{10ffff}".to_owned();
        });
        cases.push(("exact", exact));
        let mut accepted = Vec::new();
        let mut refused = Vec::new();
        for (name, authority) in cases {
            let owner = match database
                .resolve_pending_effect_owner(pending_session_owner_evidence(&fixture.bearer), 100)
            {
                Ok(owner) => owner,
                Err(_) => {
                    refused.push(name);
                    continue;
                }
            };
            let created = database
                .create_pending_effect_admitted(&owner, request(authority))
                .expect("store one retained session coordinate case");
            let approval = database
                .prepare_pending_effect_approval(&owner, &created.id, 200)
                .expect("derive one retained session coordinate case");
            let crate::storage::pending_effects::RetainedEffectOriginalAuthority::Session(retained) =
                approval.original_authority()
            else {
                panic!("coordinate case must retain the session arm")
            };
            let result = fixture.coordinator.prepare_retained_effect_session(
                &retained,
                200,
                fixture.monotonic_start + Duration::from_millis(100),
            );
            if result.is_ok() {
                accepted.push(name);
            } else {
                refused.push(name);
            }
        }
        assert_eq!(
            accepted,
            [
                "stream-lower",
                "stream-higher",
                "session-lower",
                "session-higher",
                "user-lower",
                "user-higher",
                "provider-lower",
                "provider-higher",
                "generation-lower",
                "generation-higher",
                "instance-lower",
                "instance-higher",
                "exact",
            ]
        );
        assert!(refused.is_empty());
    }

    #[tokio::test]
    async fn premark_carrier_holds_no_topology_or_leaf_guard() {
        let fixture = fixture().await;
        let carrier = fixture
            .coordinator
            .premark_revocation(logout_plan(&fixture))
            .await
            .unwrap();
        assert!(fixture.coordinator.topology.try_lock().is_ok());
        let rollback = SnapbackError::error("TEST_ROLLBACK", "test", "known rollback");
        let error = fixture
            .coordinator
            .finish_revocation(carrier, AuthTransactionAttempt::RolledBack(rollback))
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_ROLLBACK");
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn session_premark_closes_continuous_reservations_then_drains() {
        let fixture = fixture().await;
        let (_, publication) = fixture
            .coordinator
            .resolve_required_bearer(&fixture.bearer, 200, fixture.monotonic_start)
            .unwrap()
            .into_parts();
        let permit = publication
            .try_reserve_work(200, fixture.monotonic_start)
            .unwrap()
            .expect("initial retained session work");
        let coordinator = fixture.coordinator.clone();
        let revocation = logout_plan(&fixture);
        let mut pending =
            tokio::spawn(async move { coordinator.premark_revocation(revocation).await });
        wait_until_publication_closed(&publication, 200, fixture.monotonic_start).await;
        assert!(!pending.is_finished());
        for _ in 0..256 {
            assert!(
                publication
                    .try_reserve_work(200, fixture.monotonic_start)
                    .unwrap()
                    .is_none(),
                "fresh work cannot starve a pending terminal mutation"
            );
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(10), &mut pending)
                .await
                .is_err()
        );
        drop(permit);
        let carrier = tokio::time::timeout(Duration::from_secs(2), pending)
            .await
            .expect("session drain completes")
            .expect("premark task joins")
            .expect("premark succeeds");
        let rollback = SnapbackError::error("TEST_ROLLBACK", "test", "known rollback");
        assert_eq!(
            fixture
                .coordinator
                .finish_revocation(carrier, AuthTransactionAttempt::RolledBack(rollback))
                .unwrap_err()
                .diagnostic
                .code,
            "TEST_ROLLBACK"
        );
    }

    #[tokio::test]
    async fn cancelling_session_drain_exactly_rolls_back_its_pending_marker() {
        let fixture = fixture().await;
        let (_, publication) = fixture
            .coordinator
            .resolve_required_bearer(&fixture.bearer, 200, fixture.monotonic_start)
            .unwrap()
            .into_parts();
        let permit = publication
            .try_reserve_work(200, fixture.monotonic_start)
            .unwrap()
            .expect("initial retained session work");
        let coordinator = fixture.coordinator.clone();
        let revocation = logout_plan(&fixture);
        let pending = tokio::spawn(async move { coordinator.premark_revocation(revocation).await });
        wait_until_publication_closed(&publication, 200, fixture.monotonic_start).await;
        pending.abort();
        assert!(pending.await.unwrap_err().is_cancelled());
        assert!(
            publication
                .try_reserve_work(200, fixture.monotonic_start)
                .unwrap()
                .is_some(),
            "cancelling the drain removes only its exact marker"
        );
        drop(permit);
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn cancelling_stream_drain_reopens_the_exact_predecessor() {
        let fixture = fixture().await;
        let publication = fixture.coordinator.prepare_anonymous_publication().unwrap();
        let permit = publication
            .try_reserve_work(200, fixture.monotonic_start)
            .unwrap()
            .expect("initial retained stream work");
        let coordinator = fixture.coordinator.clone();
        let pending = tokio::spawn(async move { coordinator.premark_stream_reset().await });
        wait_until_publication_closed(&publication, 200, fixture.monotonic_start).await;
        pending.abort();
        assert!(pending.await.unwrap_err().is_cancelled());
        assert!(
            publication
                .try_reserve_work(200, fixture.monotonic_start)
                .unwrap()
                .is_some()
        );
        drop(permit);
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn cancelling_expiry_drain_removes_every_exact_due_marker() {
        let fixture = fixture().await;
        let before_expiry_ms = FIXTURE_SESSION_EXPIRES_MS - 1;
        let before_expiry_monotonic =
            fixture.monotonic_start + Duration::from_millis(AUTH_SESSION_SLIDING_WINDOW_MS - 1);
        let (_, publication) = fixture
            .coordinator
            .resolve_required_bearer(&fixture.bearer, before_expiry_ms, before_expiry_monotonic)
            .unwrap()
            .into_parts();
        let permit = publication
            .try_reserve_work(before_expiry_ms, before_expiry_monotonic)
            .unwrap()
            .expect("work starts immediately before expiry");
        let batch = fixture
            .coordinator
            .sample_due_expiries(
                FIXTURE_SESSION_EXPIRES_MS,
                fixture.monotonic_start + Duration::from_millis(AUTH_SESSION_SLIDING_WINDOW_MS),
            )
            .unwrap()
            .expect("one due expiry");
        let coordinator = fixture.coordinator.clone();
        let pending = tokio::spawn(async move { coordinator.expire_sampled_due(batch).await });
        wait_until_publication_closed(&publication, before_expiry_ms, before_expiry_monotonic)
            .await;
        pending.abort();
        assert!(pending.await.unwrap_err().is_cancelled());
        assert!(
            publication
                .try_reserve_work(before_expiry_ms, before_expiry_monotonic)
                .unwrap()
                .is_some()
        );
        drop(permit);
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn cancelled_revocation_waiter_leaves_owned_local_transaction_to_exact_rollback() {
        let fixture = fixture().await;
        let (_, publication) = fixture
            .coordinator
            .resolve_required_bearer(&fixture.bearer, 200, fixture.monotonic_start)
            .unwrap()
            .into_parts();
        let carrier = fixture
            .coordinator
            .premark_revocation(logout_plan(&fixture))
            .await
            .unwrap();
        let finish_coordinator = fixture.coordinator.clone();
        let blocked_publication = publication.clone();
        let outcome = cancel_waiter_with_owned_rollback_blocked_on_local(
            local_blocker_fixture(),
            move |attempt| finish_coordinator.finish_revocation(carrier, attempt),
            move || {
                assert!(
                    blocked_publication
                        .try_reserve_work(200, fixture.monotonic_start)
                        .unwrap()
                        .is_none(),
                    "cancelling only the waiter must not reopen the revocation predecessor"
                );
            },
        )
        .await;
        assert_eq!(outcome.unwrap_err().diagnostic.code, "TEST_ROLLBACK");
        assert!(
            publication
                .try_reserve_work(200, fixture.monotonic_start)
                .unwrap()
                .is_some(),
            "the independently owned exact rollback reopens the predecessor"
        );
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn cancelled_rotation_waiter_leaves_owned_local_transaction_to_exact_rollback() {
        let fixture = fixture().await;
        let (_, publication) = fixture
            .coordinator
            .resolve_required_bearer(&fixture.bearer, 200, fixture.monotonic_start)
            .unwrap()
            .into_parts();
        let carrier = fixture
            .coordinator
            .premark_rotation(rotation_plan(&fixture, 250))
            .await
            .unwrap();
        let finish_coordinator = fixture.coordinator.clone();
        let blocked_publication = publication.clone();
        let outcome = cancel_waiter_with_owned_rollback_blocked_on_local(
            local_blocker_fixture(),
            move |attempt| finish_coordinator.finish_rotation(carrier, attempt),
            move || {
                assert!(
                    blocked_publication
                        .try_reserve_work(200, fixture.monotonic_start)
                        .unwrap()
                        .is_none(),
                    "cancelling only the waiter must not reopen the rotation predecessor"
                );
            },
        )
        .await;
        assert_eq!(outcome.unwrap_err().diagnostic.code, "TEST_ROLLBACK");
        fixture
            .coordinator
            .resolve_required_bearer(&fixture.bearer, 200, fixture.monotonic_start)
            .expect("the predecessor bearer is live after exact rollback");
        assert!(
            publication
                .try_reserve_work(200, fixture.monotonic_start)
                .unwrap()
                .is_some()
        );
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn cancelled_issuance_waiter_leaves_owned_local_transaction_to_exact_rollback() {
        let fixture = fixture().await;
        let carrier = fixture
            .coordinator
            .premark_issuance(issuance_plan(&fixture))
            .await
            .unwrap();
        let finish_coordinator = fixture.coordinator.clone();
        let blocked_coordinator = fixture.coordinator.clone();
        let monotonic_start = fixture.monotonic_start;
        let outcome = cancel_waiter_with_owned_rollback_blocked_on_local(
            local_blocker_fixture(),
            move |attempt| {
                finish_coordinator.finish_issuance(carrier, attempt, 200, monotonic_start)
            },
            move || {
                assert!(
                    blocked_coordinator
                        .premark_stream_reset_if_drained()
                        .is_err(),
                    "the issuance ticket remains installed after only its waiter is cancelled"
                );
            },
        )
        .await;
        assert_eq!(outcome.unwrap_err().diagnostic.code, "TEST_ROLLBACK");
        let reset = fixture.coordinator.premark_stream_reset().await.unwrap();
        assert_eq!(
            fixture
                .coordinator
                .finish_stream_reset::<()>(
                    reset,
                    AuthTransactionAttempt::RolledBack(SnapbackError::error(
                        "TEST_ROLLBACK",
                        "test",
                        "known rollback",
                    )),
                )
                .unwrap_err()
                .diagnostic
                .code,
            "TEST_ROLLBACK"
        );
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn cancelled_stream_reset_waiter_leaves_owned_local_transaction_to_exact_rollback() {
        let fixture = fixture().await;
        let publication = fixture.coordinator.prepare_anonymous_publication().unwrap();
        let predecessor = fixture
            .coordinator
            .authorization_stream_incarnation()
            .unwrap();
        let carrier = fixture.coordinator.premark_stream_reset().await.unwrap();
        let finish_coordinator = fixture.coordinator.clone();
        let blocked_publication = publication.clone();
        let outcome = cancel_waiter_with_owned_rollback_blocked_on_local(
            local_blocker_fixture(),
            move |attempt: AuthTransactionAttempt<()>| {
                finish_coordinator.finish_stream_reset(carrier, attempt)
            },
            move || {
                assert!(
                    blocked_publication
                        .try_reserve_work(200, fixture.monotonic_start)
                        .unwrap()
                        .is_none(),
                    "cancelling only the waiter must not reopen the predecessor stream"
                );
            },
        )
        .await;
        assert_eq!(outcome.unwrap_err().diagnostic.code, "TEST_ROLLBACK");
        assert_eq!(
            fixture
                .coordinator
                .authorization_stream_incarnation()
                .unwrap(),
            predecessor
        );
        assert!(
            publication
                .try_reserve_work(200, fixture.monotonic_start)
                .unwrap()
                .is_some()
        );
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn rotation_ticket_binds_exact_predecessor_successor_and_timestamp() {
        let fixture = fixture().await;
        let plan = rotation_plan(&fixture, 250);
        let successor_digest = plan.successor_digest();
        let carrier = fixture.coordinator.premark_rotation(plan).await.unwrap();
        {
            let topology = fixture.coordinator.topology.lock().unwrap();
            assert_eq!(
                topology
                    .projection
                    .pending_kind_for_test(&fixture.session_id, &carrier.ticket),
                Some(PendingMutationKind::TokenSupersede {
                    predecessor: fixture.digest,
                    successor: successor_digest,
                    superseded_at_ms: 250,
                })
            );
        }
        assert!(fixture.coordinator.topology.try_lock().is_ok());
        let error = fixture
            .coordinator
            .finish_rotation(
                carrier,
                AuthTransactionAttempt::RolledBack(SnapbackError::error(
                    "TEST_ROLLBACK",
                    "test",
                    "known rollback",
                )),
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_ROLLBACK");
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn committed_rotation_response_ignores_only_doomed_sibling_refresh_tickets() {
        let fixture = fixture().await;
        let (_, ordinary_publication) = fixture
            .coordinator
            .resolve_required_bearer(&fixture.bearer, 200, fixture.monotonic_start)
            .unwrap()
            .into_parts();
        let winner = fixture
            .coordinator
            .premark_rotation(rotation_plan(&fixture, 250))
            .await
            .unwrap();
        let loser = fixture
            .coordinator
            .premark_rotation(rotation_plan(&fixture, 250))
            .await
            .unwrap();

        let RotationFinish::Committed { issue, outcome } = fixture
            .coordinator
            .finish_rotation(
                winner,
                AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed {
                    session: committed_rotation_session(&fixture),
                }),
            )
            .unwrap()
        else {
            panic!("first refresh commits its exact successor");
        };
        assert!(
            ordinary_publication
                .try_publish(250, fixture.monotonic_start, || Ok(()))
                .unwrap()
                .is_none(),
            "the ordinary predecessor publication remains blocked by the sibling ticket"
        );
        assert_eq!(
            outcome
                .try_publish(
                    CommittedAuthResponseClass::CredentialSecret,
                    250,
                    fixture.monotonic_start,
                    || Ok("winner"),
                )
                .unwrap(),
            Some("winner"),
            "the exact committed credential response ignores only the sibling refresh that can no longer win"
        );
        let (credential, committed_revocation) = issue.into_parts();
        assert!(committed_revocation.is_none());
        assert_eq!(credential.session.id, fixture.session_id);

        assert!(matches!(
            fixture
                .coordinator
                .finish_rotation(
                    loser,
                    AuthTransactionAttempt::Committed(PlannedRotationCommit::PredecessorChanged),
                )
                .unwrap(),
            RotationFinish::PredecessorChanged
        ));
        assert!(
            ordinary_publication
                .try_publish(250, fixture.monotonic_start, || Ok(()))
                .unwrap()
                .is_some(),
            "the same session authority reopens after its losing refresh exact-unmarks"
        );
        fixture.coordinator.check_invariants().unwrap();

        let successor_fixture = self::fixture().await;
        let successor_one_plan = rotation_plan(&successor_fixture, 250);
        let successor_one_commit = successor_one_plan.commit_plan();
        let first_rotation = successor_fixture
            .coordinator
            .premark_rotation(successor_one_plan)
            .await
            .unwrap();
        let RotationFinish::Committed {
            issue: successor_one_issue,
            outcome: successor_one_outcome,
        } = successor_fixture
            .coordinator
            .finish_rotation(first_rotation, {
                let mut database = successor_fixture.planning_database.lock().unwrap();
                successor_fixture
                    .provider_admission
                    .commit_planned_rotation(&mut database, &successor_one_commit)
            })
            .unwrap()
        else {
            panic!("first same-generation successor commits");
        };
        let successor_one_text = successor_one_issue
            .response()
            .token()
            .expose_secret()
            .to_owned();
        let successor_two_plan = rotation_plan_for(&successor_fixture, &successor_one_text, 260);
        let successor_two_commit = successor_two_plan.commit_plan();
        let second_rotation = successor_fixture
            .coordinator
            .premark_rotation(successor_two_plan)
            .await
            .unwrap();
        let RotationFinish::Committed {
            issue: successor_two_issue,
            ..
        } = successor_fixture
            .coordinator
            .finish_rotation(second_rotation, {
                let mut database = successor_fixture.planning_database.lock().unwrap();
                successor_fixture
                    .provider_admission
                    .commit_planned_rotation(&mut database, &successor_two_commit)
            })
            .unwrap()
        else {
            panic!("second provider-planned successor commits");
        };
        let successor_two_text = successor_two_issue
            .response()
            .token()
            .expose_secret()
            .to_owned();
        let successor_two_authority = successor_fixture
            .coordinator
            .resolve_required_bearer(&successor_two_text, 270, successor_fixture.monotonic_start)
            .unwrap();
        assert!(matches!(
            successor_two_authority.authority(),
            ResolvedAppAuthority::Session(subject) if subject.generation() == 1
        ));
        assert!(
            successor_one_outcome
                .try_publish(
                    CommittedAuthResponseClass::CredentialSecret,
                    270,
                    successor_fixture.monotonic_start,
                    || Ok(()),
                )
                .unwrap()
                .is_none(),
            "a finalized successor-one outcome cannot publish after a ticket-free, same-generation successor-two rotation"
        );
        successor_fixture.coordinator.check_invariants().unwrap();

        let deadline_fixture = self::fixture().await;
        let deadline_rotation = deadline_fixture
            .coordinator
            .premark_rotation(rotation_plan(&deadline_fixture, 250))
            .await
            .unwrap();
        let RotationFinish::Committed {
            outcome: captured_deadline_outcome,
            ..
        } = deadline_fixture
            .coordinator
            .finish_rotation(
                deadline_rotation,
                AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed {
                    session: committed_rotation_session(&deadline_fixture),
                }),
            )
            .unwrap()
        else {
            panic!("deadline fixture rotation commits");
        };
        assert!(
            deadline_fixture
                .coordinator
                .finalize_authenticated_use(
                    &deadline_fixture.session_id,
                    1,
                    AuthenticatedUse::Unchanged {
                        expires_at_ms: FIXTURE_SESSION_EXPIRES_MS,
                    },
                    300,
                    deadline_fixture.monotonic_start + Duration::from_millis(100),
                )
                .unwrap()
                .is_some(),
            "authenticated use replaces the captured deadline"
        );
        assert!(
            captured_deadline_outcome
                .try_publish(
                    CommittedAuthResponseClass::CredentialSecret,
                    350,
                    deadline_fixture.monotonic_start + Duration::from_millis(150),
                    || Ok(()),
                )
                .unwrap()
                .is_none(),
            "a committed refresh outcome cannot publish after its authenticated-use deadline snapshot is replaced"
        );
        deadline_fixture.coordinator.check_invariants().unwrap();

        let revocation_fixture = self::fixture().await;
        let winner = revocation_fixture
            .coordinator
            .premark_rotation(rotation_plan(&revocation_fixture, 250))
            .await
            .unwrap();
        let revocation = revocation_fixture
            .coordinator
            .premark_revocation(logout_plan(&revocation_fixture))
            .await
            .unwrap();
        let RotationFinish::Committed { outcome, .. } = revocation_fixture
            .coordinator
            .finish_rotation(
                winner,
                AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed {
                    session: committed_rotation_session(&revocation_fixture),
                }),
            )
            .unwrap()
        else {
            panic!("rotation commits before the pending revocation");
        };
        assert!(
            outcome
                .try_publish(
                    CommittedAuthResponseClass::CredentialSecret,
                    250,
                    revocation_fixture.monotonic_start,
                    || Ok(()),
                )
                .unwrap()
                .is_none(),
            "a real revocation ticket is never admitted by the refresh-only exception"
        );
        assert!(matches!(
            revocation_fixture
                .coordinator
                .finish_revocation(
                    revocation,
                    AuthTransactionAttempt::Committed(PlannedRevocationCommit::PredecessorChanged),
                )
                .unwrap(),
            RevocationFinish::PredecessorChanged
        ));
        revocation_fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn sibling_rollback_never_reopens_a_committed_revocation_in_either_order() {
        for second_wins in [false, true] {
            let (fixture, family_plan) = family_alarm_fixture().await;
            let logout_plan = logout_plan(&fixture);
            let a = fixture
                .coordinator
                .premark_revocation(logout_plan.clone())
                .await
                .unwrap();
            let b = fixture
                .coordinator
                .premark_revocation(family_plan.clone())
                .await
                .unwrap();
            let (winner, winner_plan, loser) = if second_wins {
                (b, family_plan, a)
            } else {
                (a, logout_plan, b)
            };
            let committed = {
                let mut database = fixture.planning_database.lock().unwrap();
                fixture.provider_admission.commit_planned_revocation(
                    &mut database,
                    &winner_plan,
                    FIXTURE_FAMILY_COMMIT_MS,
                )
            };
            let outcome = fixture
                .coordinator
                .finish_revocation(winner, committed)
                .unwrap();
            assert!(matches!(outcome, RevocationFinish::Committed { .. }));
            let rollback = SnapbackError::error("TEST_ROLLBACK", "test", "known rollback");
            assert_eq!(
                fixture
                    .coordinator
                    .finish_revocation(loser, AuthTransactionAttempt::RolledBack(rollback))
                    .unwrap_err()
                    .diagnostic
                    .code,
                "TEST_ROLLBACK"
            );
            assert_eq!(
                fixture
                    .coordinator
                    .resolve_required_bearer(
                        &fixture.bearer,
                        FIXTURE_FAMILY_COMMIT_MS,
                        fixture.monotonic_start,
                    )
                    .unwrap_err()
                    .diagnostic
                    .code,
                "SNAPBACK_AUTH_SESSION_EXPIRED"
            );
            fixture.coordinator.check_invariants().unwrap();
        }
    }

    #[tokio::test]
    async fn committed_outcome_is_one_shot_and_response_class_bound() {
        let logout_fixture = fixture().await;
        let carrier = logout_fixture
            .coordinator
            .premark_revocation(logout_plan(&logout_fixture))
            .await
            .unwrap();
        let RevocationFinish::Committed { outcome, .. } = logout_fixture
            .coordinator
            .finish_revocation(carrier, committed(&logout_fixture))
            .unwrap()
        else {
            panic!("logout revocation committed");
        };
        let duplicate = outcome.clone();
        assert_eq!(
            duplicate
                .try_publish(
                    CommittedAuthResponseClass::LogoutNoContent,
                    200,
                    logout_fixture.monotonic_start,
                    || Ok("published"),
                )
                .unwrap(),
            Some("published")
        );
        assert_eq!(
            outcome
                .try_publish(
                    CommittedAuthResponseClass::LogoutNoContent,
                    200,
                    logout_fixture.monotonic_start,
                    || Ok("duplicate"),
                )
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );

        let (family_fixture, family_plan) = family_alarm_fixture().await;
        let carrier = family_fixture
            .coordinator
            .premark_revocation(family_plan.clone())
            .await
            .unwrap();
        let committed_family_alarm = {
            let mut database = family_fixture.planning_database.lock().unwrap();
            family_fixture.provider_admission.commit_planned_revocation(
                &mut database,
                &family_plan,
                FIXTURE_FAMILY_COMMIT_MS,
            )
        };
        let RevocationFinish::Committed { outcome, .. } = family_fixture
            .coordinator
            .finish_revocation(carrier, committed_family_alarm)
            .unwrap()
        else {
            panic!("family-alarm revocation committed");
        };
        assert_eq!(
            outcome
                .try_publish(
                    CommittedAuthResponseClass::LogoutNoContent,
                    200,
                    family_fixture.monotonic_start,
                    || Ok(()),
                )
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
    }

    #[tokio::test]
    async fn committed_outcome_does_not_survive_stream_incarnation_change() {
        let fixture = fixture().await;
        let carrier = fixture
            .coordinator
            .premark_revocation(logout_plan(&fixture))
            .await
            .unwrap();
        let RevocationFinish::Committed { outcome, .. } = fixture
            .coordinator
            .finish_revocation(carrier, committed(&fixture))
            .unwrap()
        else {
            panic!("logout revocation committed");
        };
        let reset = fixture.coordinator.premark_stream_reset().await.unwrap();
        fixture
            .coordinator
            .finish_stream_reset(reset, AuthTransactionAttempt::Committed(()))
            .unwrap();
        assert_eq!(
            outcome
                .try_publish(
                    CommittedAuthResponseClass::LogoutNoContent,
                    200,
                    fixture.monotonic_start,
                    || Ok("stale"),
                )
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn already_terminal_loser_exact_unmarks_after_sibling_finalize() {
        let (fixture, family_plan) = family_alarm_fixture().await;
        let logout_plan = logout_plan(&fixture);
        let winner = fixture
            .coordinator
            .premark_revocation(family_plan.clone())
            .await
            .unwrap();
        let loser = fixture
            .coordinator
            .premark_revocation(logout_plan.clone())
            .await
            .unwrap();
        let committed_family_alarm = {
            let mut database = fixture.planning_database.lock().unwrap();
            fixture.provider_admission.commit_planned_revocation(
                &mut database,
                &family_plan,
                FIXTURE_FAMILY_COMMIT_MS,
            )
        };
        fixture
            .coordinator
            .finish_revocation(winner, committed_family_alarm)
            .unwrap();
        let already_terminal = {
            let mut database = fixture.planning_database.lock().unwrap();
            fixture.provider_admission.commit_planned_revocation(
                &mut database,
                &logout_plan,
                FIXTURE_FAMILY_COMMIT_MS + 1,
            )
        };
        let outcome = fixture
            .coordinator
            .finish_revocation(loser, already_terminal)
            .unwrap();
        assert!(
            matches!(
                &outcome,
                RevocationFinish::AlreadyTerminal {
                    generation: 2,
                    reason: Some(RevocationReason::FamilyAlarm)
                }
            ),
            "unexpected loser outcome: {outcome:?}"
        );
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn known_commit_finalize_failure_marks_session_uncertain_and_requires_rebuild() {
        let fixture = fixture().await;
        let carrier = fixture
            .coordinator
            .premark_revocation(logout_plan(&fixture))
            .await
            .unwrap();
        fixture.coordinator.inject_finalize_failure();
        let (outcome, terminal_target) = fixture
            .coordinator
            .finish_revocation(carrier, committed(&fixture))
            .into_parts();
        let error = outcome.unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
        assert_eq!(
            terminal_target,
            vec![CommittedRevocationTarget {
                authorization_stream_incarnation: fixture.incarnation.clone(),
                session_id: fixture.session_id.clone(),
                predecessor_generation: 1,
            }],
            "known durable commit retains its exact predecessor terminal target"
        );
        assert!(
            fixture
                .coordinator
                .requires_rebuild(&fixture.session_id)
                .unwrap()
        );
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn ambiguous_commit_never_exact_unmarks_and_requires_rebuild() {
        let fixture = fixture().await;
        let carrier = fixture
            .coordinator
            .premark_revocation(logout_plan(&fixture))
            .await
            .unwrap();
        let error = fixture
            .coordinator
            .finish_revocation(
                carrier,
                AuthTransactionAttempt::CommitUncertain(SnapbackError::error(
                    "SNAPBACK_SQLITE_ERROR",
                    "storage",
                    "ambiguous commit",
                )),
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_REVOCATION_UNCERTAIN");
        assert!(
            fixture
                .coordinator
                .requires_rebuild(&fixture.session_id)
                .unwrap()
        );
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn stream_reset_rollback_exactly_reopens_predecessor_publication() {
        let fixture = fixture().await;
        let predecessor = fixture
            .coordinator
            .authorization_stream_incarnation()
            .unwrap();
        let (_, publication) = fixture
            .coordinator
            .resolve_required_bearer(&fixture.bearer, 200, fixture.monotonic_start)
            .unwrap()
            .into_parts();
        let carrier = fixture.coordinator.premark_stream_reset().await.unwrap();
        assert!(
            publication
                .try_publish(200, fixture.monotonic_start, || Ok(()))
                .unwrap()
                .is_none()
        );
        let error = fixture
            .coordinator
            .finish_stream_reset::<()>(
                carrier,
                AuthTransactionAttempt::RolledBack(SnapbackError::error(
                    "TEST_ROLLBACK",
                    "test",
                    "known rollback",
                )),
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_ROLLBACK");
        assert_eq!(
            fixture
                .coordinator
                .authorization_stream_incarnation()
                .unwrap(),
            predecessor
        );
        assert!(
            publication
                .try_publish(200, fixture.monotonic_start, || Ok(()))
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn committed_stream_reset_installs_exact_successor_and_fences_predecessor() {
        let fixture = fixture().await;
        let predecessor = fixture
            .coordinator
            .authorization_stream_incarnation()
            .unwrap();
        let (_, publication) = fixture
            .coordinator
            .resolve_required_bearer(&fixture.bearer, 200, fixture.monotonic_start)
            .unwrap()
            .into_parts();
        let carrier = fixture.coordinator.premark_stream_reset().await.unwrap();
        let successor = carrier.successor().as_str().to_owned();
        fixture
            .coordinator
            .finish_stream_reset(carrier, AuthTransactionAttempt::Committed(()))
            .unwrap();
        assert_ne!(successor, predecessor);
        assert_eq!(
            fixture
                .coordinator
                .authorization_stream_incarnation()
                .unwrap(),
            successor
        );
        assert!(
            publication
                .try_publish(200, fixture.monotonic_start, || Ok(()))
                .unwrap()
                .is_none()
        );
        assert_eq!(
            fixture
                .coordinator
                .resolve_required_bearer(&fixture.bearer, 200, fixture.monotonic_start)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REQUIRED"
        );
    }

    #[tokio::test]
    async fn protected_erasure_admin_publication_refuses_predecessor_stream_after_reset() {
        let fixture = fixture().await;
        let publication = fixture
            .coordinator
            .prepare_anonymous_publication()
            .expect("prepare admin-bypass publication fence");
        let prepared = InvocationGate::prepare_authority(
            InvocationSource::ProtectedRecordErasure,
            AuthMode::Sessions,
            ServerProfile::Test,
            1,
            1,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::AdminBypass {
                reason: "protected erasure test".to_owned(),
            },
        )
        .expect("prepare protected-erasure authority")
        .with_fenced_publication(publication);
        let reset = fixture
            .coordinator
            .premark_stream_reset()
            .await
            .expect("premark authorization-stream reset");
        fixture
            .coordinator
            .finish_stream_reset(reset, AuthTransactionAttempt::Committed(()))
            .expect("commit authorization-stream reset");
        let outcome = prepared
            .try_fenced_publication(200, fixture.monotonic_start, || -> SnapbackResult<()> {
                panic!("stale protected-erasure publication must not run")
            })
            .expect("closed fence returns a refusal disposition");
        assert!(outcome.is_none());
    }

    #[tokio::test]
    async fn uncertain_stream_reset_stays_globally_blocked() {
        let fixture = fixture().await;
        let carrier = fixture.coordinator.premark_stream_reset().await.unwrap();
        let error = fixture
            .coordinator
            .finish_stream_reset::<()>(
                carrier,
                AuthTransactionAttempt::CommitUncertain(SnapbackError::error(
                    "SNAPBACK_SQLITE_ERROR",
                    "storage",
                    "ambiguous commit",
                )),
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_REVOCATION_UNCERTAIN");
        assert_eq!(
            fixture
                .coordinator
                .authorization_stream_incarnation()
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
    }

    #[tokio::test]
    async fn no_write_authenticated_use_replaces_stale_deadline_and_extends_memory_only() {
        let fixture = fixture().await;
        let at_use = fixture.monotonic_start + Duration::from_millis(100);
        let extended = fixture
            .coordinator
            .finalize_authenticated_use(
                &fixture.session_id,
                1,
                AuthenticatedUse::Unchanged {
                    expires_at_ms: FIXTURE_SESSION_EXPIRES_MS,
                },
                200,
                at_use,
            )
            .unwrap()
            .unwrap();
        assert_eq!(extended, 200 + AUTH_SESSION_SLIDING_WINDOW_MS);
        // At the predecessor deadline both clocks would have rejected the
        // session. The replacement remains live without any durable write.
        fixture
            .coordinator
            .resolve_required_bearer(
                &fixture.bearer,
                FIXTURE_SESSION_EXPIRES_MS,
                fixture.monotonic_start + Duration::from_millis(AUTH_SESSION_SLIDING_WINDOW_MS),
            )
            .unwrap();
        fixture.coordinator.check_invariants().unwrap();
    }
}
