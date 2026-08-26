//! Sole construction and immediate consumption of kernel-verified evidence.

use super::*;

// @ref LLP 0313#6-legitimate-minting-ceremonies — this function returns only
// the consumed transaction permit; evidence never becomes an argument or
// return value at the core boundary.
pub(super) fn verify_and_consume<'tx>(
    transaction: &'tx TransactionIdentity,
    database_origin: &DatabaseOrigin,
    proof: VerifiedProof,
    mutation: AuthorityMutation,
    successor_digest: [u8; 32],
    commit_time_ms: u64,
) -> AuthorityTransitionResult<AuthorityWritePermit<'tx>> {
    let write_set = registry::write_set_for(&mutation);
    let single_use_nonce = registry::register_nonce(transaction)?;
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
    consume(
        evidence,
        ConsumptionExpectation {
            transaction,
            database_origin,
            mutation,
            write_set: registry::write_set_for(&mutation),
            successor_digest,
            commit_time_ms,
        },
    )
}

fn consume<'tx>(
    evidence: KernelVerifiedEvidence<'tx>,
    expectation: ConsumptionExpectation<'_>,
) -> AuthorityTransitionResult<AuthorityWritePermit<'tx>> {
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
    registry::consume_nonce(evidence.transaction, evidence.single_use_nonce)?;
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
        evidence.single_use_nonce,
        expectation.mutation,
        evidence.write_set,
        evidence.successor_digest,
    )
}
