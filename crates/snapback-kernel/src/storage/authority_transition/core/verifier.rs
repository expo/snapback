//! Private bridge from exact proof verifiers to evidence consumption.

use super::*;

pub(super) fn consume_verified_proof<'tx, 'conn>(
    sqlite_transaction: &'tx rusqlite::Transaction<'conn>,
    transaction: &'tx TransactionIdentity,
    database_origin: &DatabaseOrigin,
    proof: evidence::VerifiedProof,
    mutation: AuthorityMutation,
    successor_digest: [u8; 32],
    commit_time_ms: u64,
) -> AuthorityTransitionResult<AuthorityWritePermit<'tx, 'conn>> {
    evidence::verify_and_consume(
        sqlite_transaction,
        transaction,
        database_origin,
        proof,
        mutation,
        successor_digest,
        commit_time_ms,
    )
}
