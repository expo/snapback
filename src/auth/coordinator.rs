//! Item-5 ownership boundary for the process-local session projection.
//!
//! The coordinator owns the topology mutex. A premark method installs a
//! unique projection ticket and returns an immutable carrier; no guard is
//! retained in that carrier, so provider/SQLite commit necessarily runs with
//! every topology and leaf lock released. Exact finalize or rollback then
//! reacquires topology → stream/session in the sole permitted order.

use super::crypto::SessionBearer;
use super::invocation::ResolvedAppAuthority;
use super::provider::{
    AUTH_SESSION_SLIDING_WINDOW_MS, AUTH_SESSION_SUPERSESSION_GRACE_MS, AuthenticatedUse,
    CredentialIssue, PlannedIssuanceCommit, PlannedPasswordChangeCommit, PlannedRevocationCommit,
    PlannedRotationCommit, ProviderPasswordChangePlan, ProviderRevocationPlan,
    ProviderSessionIssuancePlan, ProviderTokenRotationPlan, SessionRevocation,
};
use super::session_projection::{
    AUTH_LOCK_RANK_TOPOLOGY, AuthorityWorkDrain, BoundConnectionSessionIdentity, DueExpiryBatch,
    DueExpiryFinalization, FencedPublication, MutationTicket, PendingMutationKind,
    ProjectedBoundSessionResolution, ProjectedConnectionTokenResolution, ProjectedSessionAuthority,
    ProjectedTokenResolution, RankedMutexGuard, SessionProjection, ranked_mutex_lock,
};
use crate::contract_types::{AuthorizationStreamIncarnation, RevocationReason, TokenDigest};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::auth::AuthTransactionAttempt;
use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub(crate) struct AuthCoordinator {
    topology: Mutex<CoordinatorTopology>,
    #[cfg(test)]
    fail_next_finalize: std::sync::atomic::AtomicBool,
}

struct CoordinatorTopology {
    projection: SessionProjection,
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

pub(crate) struct PremarkedRevocation {
    plan: ProviderRevocationPlan,
    ticket: MutationTicket,
    terminal_target: CommittedRevocationTarget,
}

impl PremarkedRevocation {
    pub(crate) fn plan(&self) -> &ProviderRevocationPlan {
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

pub(crate) struct PremarkedRotation {
    plan: ProviderTokenRotationPlan,
    ticket: MutationTicket,
}

pub(crate) struct PremarkedIssuance {
    plan: ProviderSessionIssuancePlan,
    issuance_ticket: MutationTicket,
    revocation_tickets: Vec<MutationTicket>,
    revocation_terminal_targets: Vec<CommittedRevocationTarget>,
}

pub(crate) struct PremarkedPasswordChange {
    plan: ProviderPasswordChangePlan,
    rotation_ticket: MutationTicket,
    revocation_tickets: Vec<MutationTicket>,
    revocation_terminal_targets: Vec<CommittedRevocationTarget>,
}

pub(crate) struct PremarkedStreamReset {
    predecessor: AuthorizationStreamIncarnation,
    successor: AuthorizationStreamIncarnation,
    ticket: MutationTicket,
}

impl PremarkedStreamReset {
    pub(crate) fn predecessor(&self) -> &AuthorizationStreamIncarnation {
        &self.predecessor
    }

    pub(crate) fn successor(&self) -> &AuthorizationStreamIncarnation {
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
    pub(crate) fn plan(&self) -> &ProviderSessionIssuancePlan {
        &self.plan
    }
}

impl PremarkedPasswordChange {
    pub(crate) fn plan(&self) -> &ProviderPasswordChangePlan {
        &self.plan
    }
}

impl std::fmt::Debug for PremarkedIssuance {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("PremarkedIssuance([REDACTED])")
    }
}

impl PremarkedRotation {
    pub(crate) fn plan(&self) -> &ProviderTokenRotationPlan {
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
pub(crate) enum CommittedAuthResponseClass {
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
    response_class: CommittedAuthResponseClass,
}

/// Cloneable only so it can cross `http::Extensions`; every clone shares one
/// mutex-protected capability and exactly one caller can consume it.
#[derive(Clone, Debug)]
pub(crate) struct CommittedAuthOutcome {
    state: Arc<Mutex<Option<CommittedAuthOutcomeState>>>,
}

impl CommittedAuthOutcome {
    pub(crate) fn try_publish<T>(
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
        state
            .publication
            .try_publish(epoch_now_ms, monotonic_now, publish)
    }
}

#[derive(Debug)]
pub(crate) enum RevocationFinish {
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
pub(crate) enum RotationFinish {
    Committed(CredentialIssue),
    CandidateCollision,
    PredecessorChanged,
}

// As above, the successful issuance payload stays inline so its bearer and
// optional eviction result move together through the exact finalize boundary.
#[allow(clippy::large_enum_variant)]
#[derive(Debug)]
pub(crate) enum IssuanceFinish {
    Committed {
        issue: CredentialIssue,
        outcome: CommittedAuthOutcome,
    },
    CodeInvalid,
    CodeLocked,
    CredentialInvalid,
    CredentialThrottled,
    SenderKeyBound,
    CandidateCollision,
    PredecessorChanged,
    RehearsalReplay(serde_json::Value),
    RehearsalDenied(SnapbackError),
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug)]
pub(crate) enum PasswordChangeFinish {
    Committed(CredentialIssue),
    CredentialInvalid,
    CredentialThrottled,
    CandidateCollision,
    PredecessorChanged,
}

/// Exact predecessor authority that must be terminalized after a known
/// durable revocation commit. The target is captured while `Begin` still owns
/// a coherent projection, so post-commit projection failure cannot erase the
/// information required by the server terminal lifecycle.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CommittedRevocationTarget {
    authorization_stream_incarnation: String,
    session_id: String,
    predecessor_generation: u64,
}

impl CommittedRevocationTarget {
    pub(crate) fn authorization_stream_incarnation(&self) -> &str {
        &self.authorization_stream_incarnation
    }

    pub(crate) fn session_id(&self) -> &str {
        &self.session_id
    }

    pub(crate) fn predecessor_generation(&self) -> u64 {
        self.predecessor_generation
    }
}

/// A coordinator result whose known-committed revocation fact must be
/// consumed before the result (including its original diagnostic) is
/// returned to the request path.
#[must_use = "known-committed revocations require terminal propagation"]
pub(crate) struct AuthFinish<T> {
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

    pub(crate) fn into_parts(self) -> (SnapbackResult<T>, Vec<CommittedRevocationTarget>) {
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
#[derive(Debug)]
pub(crate) struct PreparedBearerAuthority {
    authority: ResolvedAppAuthority,
    publication: FencedPublication,
}

/// Projection-owned authority used to mint one session-bound connection
/// grant. The full resolved authority is short-lived: the registry strips the
/// authority-instance id and bearer before storing the immutable grant key.
#[derive(Debug)]
pub(crate) struct PreparedConnectionSessionAuthority {
    authority: ResolvedAppAuthority,
    authorization_stream_incarnation: String,
    deadline_ms: u64,
    publication: FencedPublication,
}

impl PreparedConnectionSessionAuthority {
    pub(crate) fn into_parts(self) -> (ResolvedAppAuthority, String, u64, FencedPublication) {
        (
            self.authority,
            self.authorization_stream_incarnation,
            self.deadline_ms,
            self.publication,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ConnectionSessionThrottleKey {
    pub(crate) authorization_stream_incarnation: String,
    pub(crate) session_id: String,
    pub(crate) generation: u64,
}

#[derive(Debug)]
#[allow(clippy::large_enum_variant)] // transient resolution value; boxing the hot arm buys nothing
pub(crate) enum ConnectionBearerResolution {
    Current(PreparedConnectionSessionAuthority),
    Superseded(ConnectionSessionThrottleKey),
    Unavailable(ConnectionSessionThrottleKey),
    Unknown {
        authorization_stream_incarnation: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(clippy::large_enum_variant)] // transient resolution value; boxing the hot arm buys nothing
pub(crate) enum BoundSessionResolution {
    Current(ResolvedAppAuthority),
    Terminal { reason: RevocationReason },
    Unavailable,
}

#[derive(Debug)]
pub(crate) struct PreparedAnonymousConnectionAuthority {
    pub(crate) authorization_stream_incarnation: String,
    pub(crate) publication: FencedPublication,
}

impl PreparedBearerAuthority {
    pub(crate) fn authority(&self) -> &ResolvedAppAuthority {
        &self.authority
    }

    pub(crate) fn into_parts(self) -> (ResolvedAppAuthority, FencedPublication) {
        (self.authority, self.publication)
    }
}

impl AuthCoordinator {
    pub(crate) fn new(projection: SessionProjection) -> SnapbackResult<Self> {
        projection.check_invariants()?;
        Ok(Self {
            topology: Mutex::new(CoordinatorTopology {
                projection,
                rebuild_required_sessions: BTreeSet::new(),
                global_rebuild_required: false,
            }),
            #[cfg(test)]
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
    pub(crate) async fn premark_revocation(
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

    pub(crate) async fn premark_rotation(
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

    pub(crate) async fn premark_issuance(
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

    pub(crate) async fn premark_password_change(
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
    pub(crate) async fn premark_stream_reset(
        self: &Arc<Self>,
    ) -> SnapbackResult<PremarkedStreamReset> {
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

    pub(crate) fn premark_stream_reset_if_drained(
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

    pub(crate) fn finish_stream_reset<T>(
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

    pub(crate) fn finish_revocation(
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

    pub(crate) fn finish_rotation(
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
                if self.take_finalize_failpoint()
                    || topology
                        .projection
                        .finalize_token_rotation(&carrier.ticket, carrier.plan.session_id())
                        .is_err()
                {
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
                }
                Ok(RotationFinish::Committed(carrier.plan.into_issue(session)))
            }
        }
    }

    pub(crate) fn finish_issuance(
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

    pub(crate) fn finish_password_change(
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
    pub(crate) fn resolve_required_bearer(
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
        topology.prepare_bearer_authority(authority)
    }

    /// @ref LLP 0057#rotation — family operations own supersession outcomes.
    /// Resolve a bearer for an operation that owns the token-family state
    /// machine. Unlike ordinary finite use, refresh and logout must admit an
    /// attributable superseded token regardless of grace age so their durable
    /// planner can select the exact refresh-reuse or logout outcome. Resolution
    /// remains projection-only and returns the same final-publication fence.
    pub(crate) fn resolve_family_bearer(
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
        topology.prepare_bearer_authority(authority)
    }

    /// Bind an anonymous finite publication to the current authorization
    /// stream. Reset/restore can therefore fence an already-computed public
    /// response at the same final handoff used for session responses.
    pub(crate) fn prepare_anonymous_publication(&self) -> SnapbackResult<FencedPublication> {
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        Ok(topology.projection.anonymous_publication_fence())
    }

    /// Return the current anonymous stream fence without provider or SQLite
    /// access. The caller performs the final grant insertion through this
    /// fence, so a concurrent reset cannot publish predecessor authority.
    pub(crate) fn prepare_anonymous_connection(
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
    pub(crate) fn classify_connection_bearer(
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
                    .session_publication_fence(&authority.session_id, authority.generation)?;
                let deadline_ms = authority.expires_at_ms;
                ConnectionBearerResolution::Current(PreparedConnectionSessionAuthority {
                    authority: ResolvedAppAuthority::Session {
                        user_id: authority.user_id,
                        session_id: authority.session_id,
                        provider: authority.provider,
                        generation: authority.generation,
                        authority_instance_id: authority.authority_instance_id,
                        session_not_after_ms: authority
                            .expires_at_ms
                            .min(authority.absolute_expires_at_ms),
                        provider_not_after_ms: None,
                        rehearsal_provenance: authority.rehearsal_provenance,
                    },
                    authorization_stream_incarnation: incarnation,
                    deadline_ms,
                    publication,
                })
            }
            ProjectedConnectionTokenResolution::Superseded(authority) => {
                ConnectionBearerResolution::Superseded(key(
                    authority.session_id,
                    authority.generation,
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
    pub(crate) fn resolve_bound_connection_session(
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
                    BoundSessionResolution::Current(ResolvedAppAuthority::Session {
                        user_id: authority.user_id,
                        session_id: authority.session_id,
                        provider: authority.provider,
                        generation: authority.generation,
                        authority_instance_id: authority.authority_instance_id,
                        session_not_after_ms: authority
                            .expires_at_ms
                            .min(authority.absolute_expires_at_ms),
                        provider_not_after_ms: None,
                        rehearsal_provenance: authority.rehearsal_provenance,
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
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare_retained_effect_session(
        &self,
        authorization_stream_incarnation: &str,
        session_id: &str,
        user_id: &str,
        provider: &str,
        generation: u64,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<PreparedBearerAuthority> {
        let resolved = self.resolve_bound_connection_session(
            authorization_stream_incarnation,
            session_id,
            user_id,
            provider,
            generation,
            epoch_now_ms,
            monotonic_now,
        )?;
        let BoundSessionResolution::Current(authority) = resolved else {
            return Err(projection_unavailable());
        };
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required
            || topology.projection.incarnation().as_str() != authorization_stream_incarnation
        {
            return Err(projection_unavailable());
        }
        let publication = topology
            .projection
            .session_publication_fence(session_id, generation)?;
        Ok(PreparedBearerAuthority {
            authority,
            publication,
        })
    }

    /// Publish the later deadline only after the provider's durable result is
    /// known (or its explicit no-write result is known). Refresh never calls
    /// this path.
    pub(crate) fn finalize_authenticated_use(
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

    pub(crate) fn sample_due_expiries(
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

    pub(crate) async fn expire_sampled_due(
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

    pub(crate) fn expiry_scan_delay(&self, monotonic_now: Instant) -> SnapbackResult<Duration> {
        let topology = self.lock_topology()?;
        Ok(topology.projection.expiry_scan_delay(monotonic_now))
    }

    pub(crate) fn requires_rebuild(&self, session_id: &str) -> SnapbackResult<bool> {
        let topology = self.lock_topology()?;
        Ok(topology.global_rebuild_required
            || topology.rebuild_required_sessions.contains(session_id))
    }

    pub(crate) fn check_invariants(&self) -> SnapbackResult<()> {
        self.lock_topology()?.projection.check_invariants()
    }

    /// Exact process authority identity advertised by the bootstrap
    /// handshake and captured by clients for every retained/queued scope.
    pub(crate) fn authorization_stream_incarnation(&self) -> SnapbackResult<String> {
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        Ok(topology.projection.incarnation().as_str().to_owned())
    }

    pub(crate) fn fail_global_closed(&self) -> SnapbackResult<()> {
        self.lock_topology()?.global_rebuild_required = true;
        Ok(())
    }

    fn lock_topology(&self) -> SnapbackResult<RankedMutexGuard<'_, CoordinatorTopology>> {
        ranked_mutex_lock(&self.topology, AUTH_LOCK_RANK_TOPOLOGY)
            .map_err(|_| projection_unavailable())
    }

    #[cfg(test)]
    pub(crate) fn inject_finalize_failure(&self) {
        self.fail_next_finalize
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    #[cfg(test)]
    fn take_finalize_failpoint(&self) -> bool {
        self.fail_next_finalize
            .swap(false, std::sync::atomic::Ordering::SeqCst)
    }

    #[cfg(not(test))]
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
    ) -> SnapbackResult<PreparedBearerAuthority> {
        if self
            .rebuild_required_sessions
            .contains(&authority.session_id)
        {
            return Err(projection_unavailable());
        }
        let publication = self
            .projection
            .session_publication_fence(&authority.session_id, authority.generation)?;
        Ok(PreparedBearerAuthority {
            authority: ResolvedAppAuthority::Session {
                user_id: authority.user_id,
                session_id: authority.session_id,
                provider: authority.provider,
                generation: authority.generation,
                authority_instance_id: authority.authority_instance_id,
                session_not_after_ms: authority
                    .expires_at_ms
                    .min(authority.absolute_expires_at_ms),
                provider_not_after_ms: None,
                rehearsal_provenance: authority.rehearsal_provenance,
            },
            publication,
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
    use crate::auth::crypto::{CryptoError, RandomSource};
    use crate::auth::invocation::{InvocationGate, InvocationSource, WireAuthorityFields};
    use crate::auth::provider::PlannedTokenSource;
    use crate::auth::session_projection::{
        AuthorizationStreamRecord, ProjectedSessionInsert, ProjectionIdentityRow,
        ProjectionSessionRow, ProjectionSource, ProjectionUserRow,
    };
    use crate::contract_types::{AuthorizationStreamIncarnation, RevocationReason, ServerProfile};
    use crate::local::LocalSnapback;
    use crate::manifest::AuthMode;
    use crate::server::{SharedSnapback, spawn_owned_auth_transaction, with_snapback};
    use std::sync::Arc;
    use std::time::Duration;

    struct FixedRandom(u8);

    impl RandomSource for FixedRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            destination.fill(self.0);
            Ok(())
        }
    }

    fn uuid_v7(timestamp_ms: u64, byte: u8) -> String {
        uuid::Builder::from_unix_timestamp_millis(timestamp_ms, &[byte; 10])
            .into_uuid()
            .to_string()
    }

    struct Fixture {
        coordinator: Arc<AuthCoordinator>,
        incarnation: String,
        session_id: String,
        bearer: String,
        digest: TokenDigest,
        authority_instance_id: String,
        monotonic_start: Instant,
    }

    fn fixture() -> Fixture {
        let bearer = SessionBearer::generate(&FixedRandom(7)).unwrap();
        let bearer_text = bearer.expose_secret().to_owned();
        let token_hash = bearer.token_hash();
        let digest = TokenDigest::from_token_hash(&token_hash);
        let user_id = uuid_v7(2, 2);
        let identity_id = uuid_v7(3, 3);
        let session_id = uuid_v7(4, 4);
        let authority_instance_id = uuid_v7(5, 5);
        let incarnation = uuid_v7(1, 1);
        let source = ProjectionSource {
            authorization_stream_value: AuthorizationStreamRecord::new(
                AuthorizationStreamIncarnation::parse(&incarnation).unwrap(),
            )
            .encode_bytes()
            .unwrap(),
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
                id: session_id.clone(),
                user_id,
                identity_id,
                authority_instance_id: authority_instance_id.clone(),
                token_hash: token_hash.as_bytes().to_vec(),
                generation: 1,
                created_at_ms: 3,
                last_used_at_ms: 4,
                expires_at_ms: 1_000,
                absolute_expires_at_ms: 9_000_000_000,
                revoked_at_ms: None,
                terminal_cause: None,
                rehearsal_provenance: None,
            }],
            superseded_tokens: Vec::new(),
        };
        let monotonic_start = Instant::now();
        let projection =
            SessionProjection::rebuild(source, &uuid_v7(6, 6), 100, monotonic_start).unwrap();
        Fixture {
            coordinator: Arc::new(AuthCoordinator::new(projection).unwrap()),
            incarnation,
            session_id,
            bearer: bearer_text,
            digest,
            authority_instance_id,
            monotonic_start,
        }
    }

    fn plan(fixture: &Fixture, reason: RevocationReason) -> ProviderRevocationPlan {
        ProviderRevocationPlan::for_test(
            fixture.session_id.clone(),
            1,
            fixture.digest,
            PlannedTokenSource::Current,
            reason,
        )
    }

    fn committed(fixture: &Fixture) -> AuthTransactionAttempt<PlannedRevocationCommit> {
        AuthTransactionAttempt::Committed(PlannedRevocationCommit::Committed(SessionRevocation {
            session_id: fixture.session_id.clone(),
            generation: 2,
        }))
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
    /// owned by a task queued on the real LocalSnapback mutex.
    async fn cancel_waiter_with_owned_rollback_blocked_on_local<P, T, F, Probe>(
        local: SharedSnapback,
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
        let transaction = spawn_owned_auth_transaction(async move {
            let _ = queued_tx.send(());
            let attempt = with_snapback(&local, |_snapback| {
                AuthTransactionAttempt::<P>::RolledBack(SnapbackError::error(
                    "TEST_ROLLBACK",
                    "test",
                    "known rollback",
                ))
            })
            .await;
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

    fn local_blocker_fixture() -> SharedSnapback {
        Arc::new(tokio::sync::Mutex::new(
            LocalSnapback::memory().expect("owned auth transaction Local fixture"),
        ))
    }

    #[test]
    fn required_bearer_resolution_is_memory_only_and_retains_authority_instance() {
        let fixture = fixture();
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
            ResolvedAppAuthority::Session {
                authority_instance_id,
                generation: 1,
                ..
            } if authority_instance_id == &fixture.authority_instance_id
        ));
    }

    #[tokio::test]
    async fn premark_carrier_holds_no_topology_or_leaf_guard() {
        let fixture = fixture();
        let carrier = fixture
            .coordinator
            .premark_revocation(plan(&fixture, RevocationReason::Logout))
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
        let fixture = fixture();
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
        let revocation = plan(&fixture, RevocationReason::Logout);
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
        let fixture = fixture();
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
        let revocation = plan(&fixture, RevocationReason::Logout);
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
        let fixture = fixture();
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
        let fixture = fixture();
        let (_, publication) = fixture
            .coordinator
            .resolve_required_bearer(&fixture.bearer, 999, fixture.monotonic_start)
            .unwrap()
            .into_parts();
        let permit = publication
            .try_reserve_work(999, fixture.monotonic_start)
            .unwrap()
            .expect("work starts immediately before expiry");
        let batch = fixture
            .coordinator
            .sample_due_expiries(1_000, fixture.monotonic_start + Duration::from_millis(900))
            .unwrap()
            .expect("one due expiry");
        let coordinator = fixture.coordinator.clone();
        let pending = tokio::spawn(async move { coordinator.expire_sampled_due(batch).await });
        wait_until_publication_closed(&publication, 999, fixture.monotonic_start).await;
        pending.abort();
        assert!(pending.await.unwrap_err().is_cancelled());
        assert!(
            publication
                .try_reserve_work(999, fixture.monotonic_start)
                .unwrap()
                .is_some()
        );
        drop(permit);
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn cancelled_revocation_waiter_leaves_owned_local_transaction_to_exact_rollback() {
        let fixture = fixture();
        let (_, publication) = fixture
            .coordinator
            .resolve_required_bearer(&fixture.bearer, 200, fixture.monotonic_start)
            .unwrap()
            .into_parts();
        let carrier = fixture
            .coordinator
            .premark_revocation(plan(&fixture, RevocationReason::Logout))
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
        let fixture = fixture();
        let (_, publication) = fixture
            .coordinator
            .resolve_required_bearer(&fixture.bearer, 200, fixture.monotonic_start)
            .unwrap()
            .into_parts();
        let successor_bearer = SessionBearer::generate(&FixedRandom(8)).unwrap();
        let carrier = fixture
            .coordinator
            .premark_rotation(ProviderTokenRotationPlan::for_test(
                fixture.session_id.clone(),
                1,
                fixture.digest,
                successor_bearer,
                250,
            ))
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
        let fixture = fixture();
        let bearer = SessionBearer::generate(&FixedRandom(9)).unwrap();
        let projected = ProjectedSessionInsert {
            session_id: uuid_v7(20, 20),
            user_id: uuid_v7(21, 21),
            provider: "email-code".to_owned(),
            authority_instance_id: uuid_v7(22, 22),
            generation: 1,
            token_digest: TokenDigest::from_token_hash(&bearer.token_hash()),
            created_at_ms: 200,
            expires_at_ms: 1_000,
            absolute_expires_at_ms: 2_000,
            rehearsal_provenance: None,
        };
        let carrier = fixture
            .coordinator
            .premark_issuance(ProviderSessionIssuancePlan::for_test(projected, bearer))
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
        let fixture = fixture();
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
        let fixture = fixture();
        let successor_bearer = SessionBearer::generate(&FixedRandom(8)).unwrap();
        let successor_digest = TokenDigest::from_token_hash(&successor_bearer.token_hash());
        let plan = ProviderTokenRotationPlan::for_test(
            fixture.session_id.clone(),
            1,
            fixture.digest,
            successor_bearer,
            250,
        );
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
    async fn sibling_rollback_never_reopens_a_committed_revocation_in_either_order() {
        for second_wins in [false, true] {
            let fixture = fixture();
            let a = fixture
                .coordinator
                .premark_revocation(plan(&fixture, RevocationReason::Logout))
                .await
                .unwrap();
            let b = fixture
                .coordinator
                .premark_revocation(plan(&fixture, RevocationReason::FamilyAlarm))
                .await
                .unwrap();
            let (winner, loser) = if second_wins { (b, a) } else { (a, b) };
            let outcome = fixture
                .coordinator
                .finish_revocation(winner, committed(&fixture))
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
                    .resolve_required_bearer(&fixture.bearer, 200, fixture.monotonic_start,)
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
        let logout_fixture = fixture();
        let carrier = logout_fixture
            .coordinator
            .premark_revocation(plan(&logout_fixture, RevocationReason::Logout))
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

        let family_fixture = fixture();
        let carrier = family_fixture
            .coordinator
            .premark_revocation(plan(&family_fixture, RevocationReason::FamilyAlarm))
            .await
            .unwrap();
        let RevocationFinish::Committed { outcome, .. } = family_fixture
            .coordinator
            .finish_revocation(carrier, committed(&family_fixture))
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
        let fixture = fixture();
        let carrier = fixture
            .coordinator
            .premark_revocation(plan(&fixture, RevocationReason::Logout))
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
        let fixture = fixture();
        let winner = fixture
            .coordinator
            .premark_revocation(plan(&fixture, RevocationReason::Logout))
            .await
            .unwrap();
        let loser = fixture
            .coordinator
            .premark_revocation(plan(&fixture, RevocationReason::FamilyAlarm))
            .await
            .unwrap();
        fixture
            .coordinator
            .finish_revocation(winner, committed(&fixture))
            .unwrap();
        let outcome = fixture
            .coordinator
            .finish_revocation(
                loser,
                AuthTransactionAttempt::Committed(PlannedRevocationCommit::AlreadyTerminal {
                    generation: 2,
                    reason: Some(RevocationReason::Logout),
                }),
            )
            .unwrap();
        assert!(matches!(
            outcome,
            RevocationFinish::AlreadyTerminal {
                generation: 2,
                reason: Some(RevocationReason::Logout)
            }
        ));
        fixture.coordinator.check_invariants().unwrap();
    }

    #[tokio::test]
    async fn known_commit_finalize_failure_marks_session_uncertain_and_requires_rebuild() {
        let fixture = fixture();
        let carrier = fixture
            .coordinator
            .premark_revocation(plan(&fixture, RevocationReason::Logout))
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
        let fixture = fixture();
        let carrier = fixture
            .coordinator
            .premark_revocation(plan(&fixture, RevocationReason::Logout))
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
        let fixture = fixture();
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
        let fixture = fixture();
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
        let fixture = fixture();
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
        let fixture = fixture();
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

    #[test]
    fn no_write_authenticated_use_replaces_stale_deadline_and_extends_memory_only() {
        let fixture = fixture();
        let at_use = fixture.monotonic_start + Duration::from_millis(100);
        let extended = fixture
            .coordinator
            .finalize_authenticated_use(
                &fixture.session_id,
                1,
                AuthenticatedUse::Unchanged {
                    expires_at_ms: 1_000,
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
                1_000,
                fixture.monotonic_start + Duration::from_millis(900),
            )
            .unwrap();
        fixture.coordinator.check_invariants().unwrap();
    }
}
