//! Sole construction and immediate consumption of kernel-verified evidence.

use super::*;

// @ref LLP 0313#4-private-evidence-and-permits — the carrier is visible to
// the core so owning-crate probes can name it, but its fields are private to
// this custody module. A protected writer therefore cannot destructure the
// transaction, nonce, or authority facts out of evidence.
pub(super) struct KernelVerifiedEvidence<'tx> {
    transaction: &'tx TransactionIdentity,
    single_use_nonce: NonZeroU128,
    proof_kind: ProofKind,
    subject: VerifiedSubject,
    authority_class: AuthorityClass,
    purpose: AuthorityPurpose,
    predecessors: NonEmpty<DurablePredecessor>,
    time: VerifiedTime,
    write_set: ProtectedWriteSet,
    successor_digest: [u8; 32],
    _not_send_sync: PhantomData<Rc<()>>,
}

// Exact proof verifiers produce this opaque value. Its components stay in
// the evidence custodian, so writers cannot turn caller facts into proof.
pub(super) struct VerifiedProof {
    proof_kind: ProofKind,
    subject: VerifiedSubject,
    authority_class: AuthorityClass,
    purpose: AuthorityPurpose,
    predecessors: NonEmpty<DurablePredecessor>,
    time: VerifiedTime,
}

// register_nonce accepts this private-field token so descendants such as
// core::writers cannot populate the nonce registry before calling activate.
pub(super) struct EvidenceMintAuthority {
    _private: (),
}

// @ref LLP 0313#6-legitimate-minting-ceremonies — this function returns only
// the consumed transaction permit; evidence never becomes an argument or
// return value at the core boundary.
pub(super) fn verify_and_consume<'tx, 'conn>(
    sqlite_transaction: &'tx rusqlite::Transaction<'conn>,
    transaction: &'tx TransactionIdentity,
    database_origin: &DatabaseOrigin,
    proof: VerifiedProof,
    mutation: AuthorityMutation,
    successor_digest: [u8; 32],
    commit_time_ms: u64,
) -> AuthorityTransitionResult<AuthorityWritePermit<'tx, 'conn>> {
    let write_set = registry::write_set_for(&mutation);
    let mint_authority = EvidenceMintAuthority { _private: () };
    let single_use_nonce = registry::register_nonce(transaction, &mint_authority)?;
    let evidence = KernelVerifiedEvidence {
        transaction,
        single_use_nonce,
        proof_kind: proof.proof_kind,
        subject: proof.subject,
        authority_class: proof.authority_class,
        purpose: proof.purpose,
        predecessors: proof.predecessors,
        time: proof.time,
        write_set,
        successor_digest,
        _not_send_sync: PhantomData,
    };
    let result = consume(
        evidence,
        sqlite_transaction,
        ConsumptionExpectation {
            transaction,
            database_origin,
            mutation,
            write_set: registry::write_set_for(&mutation),
            successor_digest,
            commit_time_ms,
        },
    );
    if result.is_err() {
        registry::discard_nonce(transaction, single_use_nonce);
    }
    result
}

fn consume<'tx, 'conn>(
    evidence: KernelVerifiedEvidence<'tx>,
    sqlite_transaction: &'tx rusqlite::Transaction<'conn>,
    expectation: ConsumptionExpectation<'_>,
) -> AuthorityTransitionResult<AuthorityWritePermit<'tx, 'conn>> {
    if !evidence
        .transaction
        .database_origin
        .binding
        .matches(&evidence.transaction.database_origin.binding)
    {
        return Err(AuthorityTransitionError::CurrentProcessMismatch);
    }
    if !registry::origins_match(
        &evidence.transaction.database_origin,
        expectation.database_origin,
    ) {
        return Err(AuthorityTransitionError::DatabaseOriginMismatch);
    }
    if !std::ptr::eq(evidence.transaction, expectation.transaction) {
        return Err(AuthorityTransitionError::TransactionMismatch);
    }
    if !registry::proof_relation_is_valid(
        &evidence.proof_kind,
        &evidence.purpose,
        &evidence.authority_class,
    ) {
        return Err(AuthorityTransitionError::ProofRelationMismatch);
    }
    if !registry::subject_matches_class(&evidence.subject, &evidence.authority_class) {
        return Err(AuthorityTransitionError::SubjectClassMismatch);
    }
    if !registry::predecessors_are_valid(&evidence.purpose, &evidence.predecessors) {
        return Err(AuthorityTransitionError::PredecessorMismatch);
    }
    if !registry::time_is_valid(&evidence.time, expectation.commit_time_ms) {
        return Err(AuthorityTransitionError::TimeInvalid);
    }
    if !registry::purpose_matches_mutation(&evidence.purpose, &expectation.mutation)
        || !writers::contains(&expectation.mutation)
    {
        return Err(AuthorityTransitionError::MutationMismatch);
    }
    if evidence.write_set != expectation.write_set
        || evidence.write_set != registry::write_set_for(&expectation.mutation)
    {
        return Err(AuthorityTransitionError::WriteSetMismatch);
    }
    if evidence.successor_digest != expectation.successor_digest
        || evidence.successor_digest == [0; 32]
    {
        return Err(AuthorityTransitionError::SuccessorDigestMismatch);
    }
    permit::activate(
        evidence.transaction,
        sqlite_transaction,
        evidence.single_use_nonce,
        expectation.mutation,
        evidence.write_set,
        evidence.successor_digest,
    )
}

#[cfg(test)]
pub(super) fn password_proof_for_test() -> VerifiedProof {
    VerifiedProof {
        proof_kind: ProofKind::Password,
        subject: VerifiedSubject::Human([1; 32]),
        authority_class: AuthorityClass::Human,
        purpose: AuthorityPurpose::PasswordSessionIssuance,
        predecessors: NonEmpty {
            head: DurablePredecessor {
                object: ProtectedObject::AuthPasswordCredentials,
                generation: NonZeroU64::new(1).expect("nonzero predecessor generation"),
                digest: [2; 32],
            },
            tail: Vec::new(),
        },
        time: VerifiedTime {
            durable_floor_ms: 5,
            verified_at_ms: 10,
            not_after_ms: 20,
        },
    }
}
