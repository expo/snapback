//! Unit-only reproductions of routes the production writer API cannot spell.

use super::super::evidence::ProtectedTx;
use super::super::*;
use rusqlite::{CachedStatement, params};

const SESSION_INSERT: &str =
    "INSERT OR ABORT INTO _auth_sessions(id, user_id, assurance_generation) VALUES(?1, ?2, ?3)";

pub(in super::super) fn unscoped_session_insert(
    connection: &Connection,
    session_id: &str,
    user_id: &str,
) -> rusqlite::Result<usize> {
    connection.execute(SESSION_INSERT, params![session_id, user_id, 1_i64])
}

pub(in super::super) fn transaction_control_sql(
    transaction: &mut ProtectedTx<'_>,
) -> rusqlite::Result<()> {
    transaction.transaction_control_for_test()
}

pub(in super::super) fn prime_cached_session_insert<'connection>(
    transaction: &'connection mut ProtectedTx<'_>,
) -> rusqlite::Result<CachedStatement<'connection>> {
    transaction.prepare_cached_for_test()
}

pub(in super::super) fn execute_cached_session_insert(
    connection: &Connection,
    session_id: &str,
) -> rusqlite::Result<usize> {
    connection
        .prepare_cached(SESSION_INSERT)?
        .execute(params![session_id, "cache-attacker", 1_i64])
}

pub(in super::super) fn stale_generation_session_insert(
    transaction: &mut ProtectedTx<'_>,
    session_id: &str,
    user_id: &str,
) -> AuthorityTransitionResult<usize> {
    transaction.insert_at_generation_for_test(
        transaction_generation_for_test(transaction).saturating_sub(1),
        session_id,
        user_id,
    )
}

fn transaction_generation_for_test(_transaction: &ProtectedTx<'_>) -> u64 {
    // The first successful ceremony advances to generation 1 and this helper is
    // called only from the live generation-2 regression. Supplying 1 is the
    // stale copied fact under attack; writer code still cannot read the live
    // generation or authorizer cell.
    2
}
