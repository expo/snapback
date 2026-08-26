//! Closed purpose, mutation, predecessor, and protected-object registries.

use super::*;
use sha2::{Digest, Sha256};

pub(super) fn origins_match(left: &DatabaseOrigin, right: &DatabaseOrigin) -> bool {
    left.durable_store_identity == right.durable_store_identity
        && left.connection_identity == right.connection_identity
        && left.binding.matches(&right.binding)
}

pub(super) fn register_nonce(
    transaction: &TransactionIdentity,
    _mint_authority: &evidence::EvidenceMintAuthority,
) -> AuthorityTransitionResult<NonZeroU128> {
    for _ in 0..16 {
        let mut bytes = [0_u8; 16];
        getrandom::fill(&mut bytes).map_err(|_| AuthorityTransitionError::NonceGenerationFailed)?;
        let Some(nonce) = NonZeroU128::new(u128::from_le_bytes(bytes)) else {
            continue;
        };
        if transaction.nonce_registry.borrow_mut().insert(nonce) {
            return Ok(nonce);
        }
    }
    Err(AuthorityTransitionError::NonceGenerationFailed)
}

pub(super) fn discard_nonce(transaction: &TransactionIdentity, nonce: NonZeroU128) {
    transaction.nonce_registry.borrow_mut().remove(&nonce);
}

pub(super) fn consume_nonce(
    transaction: &TransactionIdentity,
    nonce: NonZeroU128,
) -> AuthorityTransitionResult<()> {
    if transaction.nonce_registry.borrow_mut().remove(&nonce) {
        Ok(())
    } else {
        Err(AuthorityTransitionError::NonceMissingOrConsumed)
    }
}

pub(super) fn proof_relation_is_valid(
    proof: &ProofKind,
    purpose: &AuthorityPurpose,
    class: &AuthorityClass,
) -> bool {
    match proof {
        ProofKind::Bearer => bearer::accepts(purpose, class),
        ProofKind::Password => password::accepts(purpose, class),
        ProofKind::RecoveryCode => recovery::accepts(purpose, class),
        ProofKind::DeliveryProof => delivery::accepts(purpose, class),
        ProofKind::StepUpProof => step_up::accepts(purpose, class),
        ProofKind::AdministratorAnchor => administrator::accepts(purpose, class),
        ProofKind::SealedInternalService => internal_work::accepts(purpose, class),
    }
}

pub(super) fn subject_matches_class(subject: &VerifiedSubject, class: &AuthorityClass) -> bool {
    matches!(
        (subject, class),
        (VerifiedSubject::Human(_), AuthorityClass::Human)
            | (
                VerifiedSubject::DelegatedService(_),
                AuthorityClass::DelegatedService
            )
            | (
                VerifiedSubject::AutonomousService(_),
                AuthorityClass::AutonomousService
            )
            | (VerifiedSubject::Operator(_), AuthorityClass::Operator)
            | (
                VerifiedSubject::InternalWork(_),
                AuthorityClass::InternalWork
            )
            | (
                VerifiedSubject::NonProductionRehearsal(_),
                AuthorityClass::NonProductionRehearsal
            )
    )
}

pub(super) fn purpose_matches_mutation(
    purpose: &AuthorityPurpose,
    mutation: &AuthorityMutation,
) -> bool {
    matches!(
        (purpose, mutation),
        (
            AuthorityPurpose::BearerSessionRotation,
            AuthorityMutation::RotateBearerSession
        ) | (
            AuthorityPurpose::PasswordSessionIssuance,
            AuthorityMutation::IssuePasswordSession
        ) | (
            AuthorityPurpose::RecoveryCredentialRotation,
            AuthorityMutation::RotateRecoveryCredential
        ) | (
            AuthorityPurpose::DeliveryIdentityConfirmation,
            AuthorityMutation::ConfirmDeliveredIdentity
        ) | (
            AuthorityPurpose::StepUpTransition,
            AuthorityMutation::CommitStepUpTransition
        ) | (
            AuthorityPurpose::AdministratorRestore,
            AuthorityMutation::RestoreAuthorityStore
        ) | (
            AuthorityPurpose::InternalWorkTransition,
            AuthorityMutation::CommitInternalWork
        )
    )
}

pub(super) fn predecessors_are_valid(
    purpose: &AuthorityPurpose,
    predecessors: &NonEmpty<DurablePredecessor>,
) -> bool {
    let expected = predecessor_objects_for(purpose);
    let observed = std::iter::once(&predecessors.head)
        .chain(predecessors.tail.iter())
        .collect::<Vec<_>>();
    observed.len() == expected.len()
        && observed.iter().zip(expected).all(|(predecessor, object)| {
            &predecessor.object == object && predecessor.digest != [0; 32]
        })
}

fn predecessor_objects_for(purpose: &AuthorityPurpose) -> &'static [ProtectedObject] {
    match purpose {
        AuthorityPurpose::BearerSessionRotation => &[ProtectedObject::AuthSessionTokens],
        AuthorityPurpose::PasswordSessionIssuance => &[ProtectedObject::AuthPasswordCredentials],
        AuthorityPurpose::RecoveryCredentialRotation => &[ProtectedObject::AuthRecoveryCodes],
        AuthorityPurpose::DeliveryIdentityConfirmation => &[ProtectedObject::AuthVerificationCodes],
        AuthorityPurpose::StepUpTransition => &[ProtectedObject::AuthAssurances],
        AuthorityPurpose::AdministratorRestore => &[ProtectedObject::AuthorizationInvalidation],
        AuthorityPurpose::InternalWorkTransition => &[ProtectedObject::JobAuthority],
    }
}

pub(super) fn time_is_valid(time: &VerifiedTime, commit_time_ms: u64) -> bool {
    time.durable_floor_ms <= time.verified_at_ms
        && time.verified_at_ms <= commit_time_ms
        && commit_time_ms <= time.not_after_ms
}

pub(super) fn write_set_for(mutation: &AuthorityMutation) -> ProtectedWriteSet {
    use ProtectedObject as Object;
    use ProtectedWriteOperation as Operation;

    let writes = match mutation {
        AuthorityMutation::RotateBearerSession => vec![
            direct(Object::AuthSessions, Operation::Update("generation")),
            direct(Object::AuthSessionTokens, Operation::Delete),
            direct(Object::AuthSessionTokens, Operation::Insert),
        ],
        AuthorityMutation::IssuePasswordSession => vec![
            direct(Object::AuthPasswordAttempts, Operation::Update("attempts")),
            direct(Object::AuthSessions, Operation::Insert),
            direct(Object::AuthSessionTokens, Operation::Insert),
        ],
        AuthorityMutation::RotateRecoveryCredential => vec![
            direct(
                Object::AuthRecoveryCodes,
                Operation::Update("consumed_at_ms"),
            ),
            direct(Object::AuthCredentials, Operation::Update("generation")),
            direct(Object::AuthSessions, Operation::Insert),
            direct(Object::AuthSessionTokens, Operation::Insert),
        ],
        AuthorityMutation::ConfirmDeliveredIdentity => vec![
            direct(
                Object::AuthVerificationCodes,
                Operation::Update("consumed_at_ms"),
            ),
            direct(Object::AuthIdentities, Operation::Insert),
        ],
        AuthorityMutation::CommitStepUpTransition => vec![
            direct(Object::AuthAssurances, Operation::Insert),
            direct(
                Object::AuthSessions,
                Operation::Update("assurance_generation"),
            ),
        ],
        AuthorityMutation::RestoreAuthorityStore => vec![
            direct(Object::Connection, Operation::Schema),
            direct(Object::Connection, Operation::AttachDatabase),
            direct(Object::Connection, Operation::DetachDatabase),
        ],
        AuthorityMutation::CommitInternalWork => vec![
            direct(Object::JobAuthority, Operation::Update("claim_generation")),
            direct(Object::PushAuthority, Operation::Insert),
        ],
    };
    ProtectedWriteSet {
        writes: writes.into_iter().collect(),
    }
}

fn direct(object: ProtectedObject, operation: ProtectedWriteOperation) -> ProtectedWrite {
    ProtectedWrite {
        object,
        operation,
        accessor: ProtectedWriteAccessor::Direct,
    }
}

pub(super) fn protected_table_name(object: &ProtectedObject) -> Option<&str> {
    Some(match object {
        ProtectedObject::AuthUsers => "_auth_users",
        ProtectedObject::AuthIdentities => "_auth_identities",
        ProtectedObject::AuthSessions => "_auth_sessions",
        ProtectedObject::AuthSessionTokens => "_auth_session_tokens",
        ProtectedObject::AuthCredentials => "_auth_credentials",
        ProtectedObject::AuthPasswordCredentials => "_auth_password_credentials",
        ProtectedObject::AuthPasskeyCredentials => "_auth_passkey_credentials",
        ProtectedObject::AuthRecoveryCodeSets => "_auth_recovery_code_sets",
        ProtectedObject::AuthRecoveryCodes => "_auth_recovery_codes",
        ProtectedObject::AuthAssurances => "_auth_assurances",
        ProtectedObject::AuthAgentCredentials => "_auth_agent_credentials",
        ProtectedObject::AuthGrants => "_auth_grants",
        ProtectedObject::AuthGrantTokens => "_auth_grant_tokens",
        ProtectedObject::AuthAgentInvitations => "_auth_agent_invitations",
        ProtectedObject::AuthPairingRequests => "_auth_pairing_requests",
        ProtectedObject::AuthScopeBases => "_auth_scope_bases",
        ProtectedObject::AuthVerificationCodes => "_auth_verification_codes",
        ProtectedObject::AuthPasswordAttempts => "_auth_password_attempts",
        ProtectedObject::AuthProvisioningReceipts => "_auth_provisioning_receipts",
        ProtectedObject::AuthSecurityEvents => "_auth_security_events",
        ProtectedObject::AuthorizationInvalidation => "_snapback_auth_invalidation_boot_epoch_v1",
        ProtectedObject::AuthorizedLeaseReservations => "_snapback_authorized_lease_reservations",
        ProtectedObject::CapabilityLinks => "_snapback_capability_links",
        ProtectedObject::IntegrationRecords => "_snapback_integration_records",
        ProtectedObject::JobAuthority => "_snapback_jobs_v1",
        ProtectedObject::PendingEffects => "_snapback_pending_effects",
        ProtectedObject::PushAuthority => "_snapback_job_push_grants_v1",
        ProtectedObject::RehearsalProvenance => "_snapback_job_rehearsal_provenance_v1",
        ProtectedObject::Watches => "_snapback_watches",
        ProtectedObject::WatchFirings => "_snapback_watch_firings",
        ProtectedObject::DynamicMembership(table) => table,
        ProtectedObject::Connection => return None,
    })
}

pub(super) fn protected_table_registry() -> BTreeSet<&'static str> {
    [
        ProtectedObject::AuthUsers,
        ProtectedObject::AuthIdentities,
        ProtectedObject::AuthSessions,
        ProtectedObject::AuthSessionTokens,
        ProtectedObject::AuthCredentials,
        ProtectedObject::AuthPasswordCredentials,
        ProtectedObject::AuthPasskeyCredentials,
        ProtectedObject::AuthRecoveryCodeSets,
        ProtectedObject::AuthRecoveryCodes,
        ProtectedObject::AuthAssurances,
        ProtectedObject::AuthAgentCredentials,
        ProtectedObject::AuthGrants,
        ProtectedObject::AuthGrantTokens,
        ProtectedObject::AuthAgentInvitations,
        ProtectedObject::AuthPairingRequests,
        ProtectedObject::AuthScopeBases,
        ProtectedObject::AuthVerificationCodes,
        ProtectedObject::AuthPasswordAttempts,
        ProtectedObject::AuthProvisioningReceipts,
        ProtectedObject::AuthSecurityEvents,
        ProtectedObject::AuthorizationInvalidation,
        ProtectedObject::AuthorizedLeaseReservations,
        ProtectedObject::CapabilityLinks,
        ProtectedObject::IntegrationRecords,
        ProtectedObject::JobAuthority,
        ProtectedObject::PendingEffects,
        ProtectedObject::PushAuthority,
        ProtectedObject::RehearsalProvenance,
        ProtectedObject::Watches,
        ProtectedObject::WatchFirings,
    ]
    .iter()
    .filter_map(protected_table_name)
    .collect()
}

pub(super) fn write_set_digest(write_set: &ProtectedWriteSet) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for write in &write_set.writes {
        if let Some(table) = protected_table_name(&write.object) {
            hasher.update((table.len() as u64).to_le_bytes());
            hasher.update(table.as_bytes());
        } else {
            hasher.update(0_u64.to_le_bytes());
        }
    }
    hasher.finalize().into()
}
