//! Fixed password-session issuance SQL.

use super::super::*;
use rusqlite::params;

pub(in super::super) fn insert_password_session(
    transaction: &mut ProtectedTx<'_>,
    session_id: &str,
    subject_user_id: &str,
    assurance_generation: i64,
) -> AuthorityTransitionResult<usize> {
    if !transaction.scope_is_current()
        || transaction.operation != RegisteredOperation::IssuePasswordSession
    {
        return Err(AuthorityTransitionError::ScopeAlreadyActive);
    }
    Ok(transaction.connection.execute(
        "INSERT INTO _auth_sessions(
             id, user_id, assurance_generation
         ) VALUES(?1, ?2, ?3)",
        params![session_id, subject_user_id, assurance_generation],
    )?)
}
