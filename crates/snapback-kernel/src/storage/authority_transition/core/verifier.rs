//! Private bridge from exact proof verifiers to evidence consumption.

use super::*;

pub(super) fn consume_verified_proof<'tx>(
    transaction: &'tx TransactionIdentity,
    database_origin: &DatabaseOrigin,
    proof: VerifiedProof,
    mutation: AuthorityMutation,
    successor_digest: [u8; 32],
    commit_time_ms: u64,
) -> AuthorityTransitionResult<AuthorityWritePermit<'tx>> {
    evidence::verify_and_consume(
        transaction,
        database_origin,
        proof,
        mutation,
        successor_digest,
        commit_time_ms,
    )
}
