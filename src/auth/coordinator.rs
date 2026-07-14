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
    CredentialIssue, PlannedIssuanceCommit, PlannedRevocationCommit, PlannedRotationCommit,
    ProviderRevocationPlan, ProviderSessionIssuancePlan, ProviderTokenRotationPlan,
    SessionRevocation,
};
use super::session_projection::{
    AuthorizationStreamIncarnation, BoundConnectionSessionIdentity, ExpiredSession,
    FencedPublication, MutationTicket, PendingMutationKind, ProjectedConnectionTokenResolution,
    ProjectedSessionAuthority, ProjectedTokenResolution, RevocationReason, SessionProjection,
    TokenDigest,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::auth::AuthTransactionAttempt;
use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, MutexGuard};
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
    eviction_ticket: Option<MutationTicket>,
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
    PredecessorChanged,
}

// As above, the successful issuance payload stays inline so its bearer and
// optional eviction result move together through the exact finalize boundary.
#[allow(clippy::large_enum_variant)]
#[derive(Debug)]
pub(crate) enum IssuanceFinish {
    Committed(CredentialIssue),
    CodeInvalid,
    CodeLocked,
    PredecessorChanged,
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
pub(crate) enum ConnectionBearerResolution {
    Current(PreparedConnectionSessionAuthority),
    Superseded(ConnectionSessionThrottleKey),
    Unavailable(ConnectionSessionThrottleKey),
    Unknown {
        authorization_stream_incarnation: String,
    },
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

    /// Install the leaf marker, then return only immutable CAS inputs plus the
    /// ticket. The returned carrier owns no lock and may cross the provider
    /// transaction boundary safely.
    ///
    /// @ref LLP 0059#plan-begin-commit-finalize — the leaf is blocked before
    /// commit begins, and no projection/fence guard enters SQLite.
    pub(crate) fn premark_revocation(
        &self,
        plan: ProviderRevocationPlan,
    ) -> SnapbackResult<PremarkedRevocation> {
        let mut topology = self.lock_topology()?;
        topology.require_session_available(plan.session_id())?;
        let ticket = topology.projection.begin_session_mutation(
            plan.session_id(),
            plan.expected_generation(),
            PendingMutationKind::Revoke {
                reason: plan.reason(),
            },
        )?;
        Ok(PremarkedRevocation { plan, ticket })
    }

    pub(crate) fn premark_rotation(
        &self,
        plan: ProviderTokenRotationPlan,
    ) -> SnapbackResult<PremarkedRotation> {
        let mut topology = self.lock_topology()?;
        topology.require_session_available(plan.session_id())?;
        let ticket = topology.projection.begin_session_mutation(
            plan.session_id(),
            plan.expected_generation(),
            PendingMutationKind::TokenSupersede {
                predecessor: plan.predecessor_digest(),
                successor: plan.successor_digest(),
                superseded_at_ms: plan.superseded_at_ms(),
            },
        )?;
        Ok(PremarkedRotation { plan, ticket })
    }

    pub(crate) fn premark_issuance(
        &self,
        plan: ProviderSessionIssuancePlan,
    ) -> SnapbackResult<PremarkedIssuance> {
        let mut topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        if let Some(eviction) = plan.eviction() {
            topology.require_session_available(eviction.session_id())?;
        }
        let insert = plan.projected_insert();
        let issuance_ticket = topology.projection.begin_issuance(insert)?;
        let eviction_ticket = match plan.eviction() {
            Some(eviction) => match topology.projection.begin_session_mutation(
                eviction.session_id(),
                eviction.expected_generation(),
                PendingMutationKind::Revoke {
                    reason: RevocationReason::CapEviction,
                },
            ) {
                Ok(ticket) => Some(ticket),
                Err(error) => {
                    let _ = topology.projection.compare_unmark_issuance(
                        &issuance_ticket,
                        &plan.projected_insert().session_id,
                    );
                    return Err(error);
                }
            },
            None => None,
        };
        Ok(PremarkedIssuance {
            plan,
            issuance_ticket,
            eviction_ticket,
        })
    }

    /// Block the shared authorization stream before the destructive database
    /// transaction begins. The carrier owns no lock and binds one exact
    /// predecessor/successor pair across SQLite commit.
    ///
    /// @ref LLP 0059#reset-restore-and-stream-publication — reset uses the
    /// same premark/commit/finalize protocol as session leaf mutations.
    pub(crate) fn premark_stream_reset(&self) -> SnapbackResult<PremarkedStreamReset> {
        let mut topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        let predecessor = topology.projection.incarnation().clone();
        let successor = AuthorizationStreamIncarnation::fresh();
        let ticket = topology
            .projection
            .begin_stream_mutation(successor.clone())?;
        Ok(PremarkedStreamReset {
            predecessor,
            successor,
            ticket,
        })
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
            }) => {
                exact_unmark_revocation(&mut topology, &carrier)?;
                Ok(RevocationFinish::AlreadyTerminal { generation })
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
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CodeInvalid) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Ok(IssuanceFinish::CodeInvalid)
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CodeLocked) => {
                exact_unmark_issuance(&mut topology, &carrier)?;
                Ok(IssuanceFinish::CodeLocked)
            }
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
                session,
                committed_revocation,
            }) => {
                if session.id != session_id
                    || committed_revocation
                        .as_ref()
                        .map(|value| (value.session_id.as_str(), value.generation))
                        != carrier.plan.eviction().map(|eviction| {
                            (
                                eviction.session_id(),
                                eviction.expected_generation().saturating_add(1),
                            )
                        })
                {
                    fail_issuance_closed(&mut topology, &carrier);
                    return Err(projection_unavailable());
                }
                if let (Some(ticket), Some(revocation)) =
                    (&carrier.eviction_ticket, committed_revocation.as_ref())
                    && topology
                        .projection
                        .finalize_revocation(ticket, &revocation.session_id, revocation.generation)
                        .is_err()
                {
                    fail_issuance_closed(&mut topology, &carrier);
                    return Err(projection_unavailable());
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
                Ok(IssuanceFinish::Committed(
                    carrier.plan.into_issue(session, committed_revocation),
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
        let bearer = SessionBearer::parse(bearer).map_err(|_| auth_required())?;
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
                ProjectedTokenResolution::Terminal => return Err(session_expired()),
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
        let bearer = SessionBearer::parse(bearer).map_err(|_| auth_required())?;
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
                ProjectedTokenResolution::Terminal => return Err(session_expired()),
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
    ) -> SnapbackResult<Option<ResolvedAppAuthority>> {
        let incarnation = AuthorizationStreamIncarnation::parse(authorization_stream_incarnation)?;
        let topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        Ok(topology
            .projection
            .resolve_bound_connection_session(
                BoundConnectionSessionIdentity::new(
                    &incarnation,
                    session_id,
                    user_id,
                    provider,
                    generation,
                ),
                epoch_now_ms,
                monotonic_now,
            )?
            .map(|authority| ResolvedAppAuthority::Session {
                user_id: authority.user_id,
                session_id: authority.session_id,
                provider: authority.provider,
                generation: authority.generation,
                authority_instance_id: authority.authority_instance_id,
                session_not_after_ms: authority
                    .expires_at_ms
                    .min(authority.absolute_expires_at_ms),
                provider_not_after_ms: None,
            }))
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

    pub(crate) fn expire_due(
        &self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Vec<ExpiredSession>> {
        let mut topology = self.lock_topology()?;
        if topology.global_rebuild_required {
            return Err(projection_unavailable());
        }
        topology.projection.expire_due(epoch_now_ms, monotonic_now)
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

    fn lock_topology(&self) -> SnapbackResult<MutexGuard<'_, CoordinatorTopology>> {
        self.topology.lock().map_err(|_| projection_unavailable())
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
    if let (Some(ticket), Some(eviction)) = (&carrier.eviction_ticket, carrier.plan.eviction())
        && !matches!(
            topology
                .projection
                .compare_unmark_session(ticket, eviction.session_id()),
            Ok(true)
        )
    {
        topology.global_rebuild_required = true;
        return Err(projection_unavailable());
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

fn fail_issuance_closed(topology: &mut CoordinatorTopology, carrier: &PremarkedIssuance) {
    if let (Some(ticket), Some(eviction)) = (&carrier.eviction_ticket, carrier.plan.eviction()) {
        fail_session_closed(
            topology,
            ticket,
            eviction.session_id(),
            eviction.expected_generation().checked_add(1),
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

fn session_expired() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_SESSION_EXPIRED",
        "auth",
        "authentication session is expired or revoked",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CryptoError, RandomSource};
    use crate::auth::provider::PlannedTokenSource;
    use crate::auth::session_projection::{
        AuthorizationStreamIncarnation, AuthorizationStreamRecord, ProjectionIdentityRow,
        ProjectionSessionRow, ProjectionSource, ProjectionUserRow, RevocationReason,
    };
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
        let incarnation = AuthorizationStreamIncarnation::parse(&uuid_v7(1, 1)).unwrap();
        let source = ProjectionSource {
            authorization_stream_value: AuthorizationStreamRecord::new(incarnation)
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
            }],
            superseded_tokens: Vec::new(),
        };
        let monotonic_start = Instant::now();
        let projection =
            SessionProjection::rebuild(source, &uuid_v7(6, 6), 100, monotonic_start).unwrap();
        Fixture {
            coordinator: Arc::new(AuthCoordinator::new(projection).unwrap()),
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

    #[test]
    fn premark_carrier_holds_no_topology_or_leaf_guard() {
        let fixture = fixture();
        let carrier = fixture
            .coordinator
            .premark_revocation(plan(&fixture, RevocationReason::Logout))
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

    #[test]
    fn rotation_ticket_binds_exact_predecessor_successor_and_timestamp() {
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
        let carrier = fixture.coordinator.premark_rotation(plan).unwrap();
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

    #[test]
    fn sibling_rollback_never_reopens_a_committed_revocation_in_either_order() {
        for second_wins in [false, true] {
            let fixture = fixture();
            let a = fixture
                .coordinator
                .premark_revocation(plan(&fixture, RevocationReason::Logout))
                .unwrap();
            let b = fixture
                .coordinator
                .premark_revocation(plan(&fixture, RevocationReason::FamilyAlarm))
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

    #[test]
    fn committed_outcome_is_one_shot_and_response_class_bound() {
        let logout_fixture = fixture();
        let carrier = logout_fixture
            .coordinator
            .premark_revocation(plan(&logout_fixture, RevocationReason::Logout))
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

    #[test]
    fn committed_outcome_does_not_survive_stream_incarnation_change() {
        let fixture = fixture();
        let carrier = fixture
            .coordinator
            .premark_revocation(plan(&fixture, RevocationReason::Logout))
            .unwrap();
        let RevocationFinish::Committed { outcome, .. } = fixture
            .coordinator
            .finish_revocation(carrier, committed(&fixture))
            .unwrap()
        else {
            panic!("logout revocation committed");
        };
        let reset = fixture.coordinator.premark_stream_reset().unwrap();
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

    #[test]
    fn already_terminal_loser_exact_unmarks_after_sibling_finalize() {
        let fixture = fixture();
        let winner = fixture
            .coordinator
            .premark_revocation(plan(&fixture, RevocationReason::Logout))
            .unwrap();
        let loser = fixture
            .coordinator
            .premark_revocation(plan(&fixture, RevocationReason::FamilyAlarm))
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
                }),
            )
            .unwrap();
        assert!(matches!(
            outcome,
            RevocationFinish::AlreadyTerminal { generation: 2 }
        ));
        fixture.coordinator.check_invariants().unwrap();
    }

    #[test]
    fn known_commit_finalize_failure_marks_session_uncertain_and_requires_rebuild() {
        let fixture = fixture();
        let carrier = fixture
            .coordinator
            .premark_revocation(plan(&fixture, RevocationReason::Logout))
            .unwrap();
        fixture.coordinator.inject_finalize_failure();
        let error = fixture
            .coordinator
            .finish_revocation(carrier, committed(&fixture))
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE"
        );
        assert!(
            fixture
                .coordinator
                .requires_rebuild(&fixture.session_id)
                .unwrap()
        );
        fixture.coordinator.check_invariants().unwrap();
    }

    #[test]
    fn ambiguous_commit_never_exact_unmarks_and_requires_rebuild() {
        let fixture = fixture();
        let carrier = fixture
            .coordinator
            .premark_revocation(plan(&fixture, RevocationReason::Logout))
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

    #[test]
    fn stream_reset_rollback_exactly_reopens_predecessor_publication() {
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
        let carrier = fixture.coordinator.premark_stream_reset().unwrap();
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

    #[test]
    fn committed_stream_reset_installs_exact_successor_and_fences_predecessor() {
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
        let carrier = fixture.coordinator.premark_stream_reset().unwrap();
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

    #[test]
    fn uncertain_stream_reset_stays_globally_blocked() {
        let fixture = fixture();
        let carrier = fixture.coordinator.premark_stream_reset().unwrap();
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
