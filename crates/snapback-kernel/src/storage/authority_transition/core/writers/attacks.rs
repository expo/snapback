//! Unit-only reproductions of routes the production writer API cannot spell.

use super::super::*;
use rusqlite::{CachedStatement, params};

const SESSION_INSERT: &str =
    "INSERT INTO _auth_sessions(id, user_id, assurance_generation) VALUES(?1, ?2, ?3)";

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
    transaction.connection.execute_batch("COMMIT")
}

pub(in super::super) fn prime_cached_session_insert<'connection>(
    transaction: &'connection mut ProtectedTx<'_>,
) -> rusqlite::Result<CachedStatement<'connection>> {
    transaction.connection.prepare_cached(SESSION_INSERT)
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
    let mut stale = ProtectedTx {
        connection: transaction.connection,
        authorizer_cell: transaction.authorizer_cell,
        generation: transaction.generation.saturating_sub(1),
        operation: transaction.operation,
        _scope: PhantomData,
        _not_send_sync: PhantomData,
    };
    super::insert_password_session(&mut stale, session_id, user_id, 1)
}
