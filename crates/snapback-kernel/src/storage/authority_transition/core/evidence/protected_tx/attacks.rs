//! Unit-only exact operations used to exercise scope liveness and caching.

use super::*;
use rusqlite::CachedStatement;

impl ProtectedTx<'_> {
    pub(in crate::storage::authority_transition::core) fn transaction_control_for_test(
        &mut self,
    ) -> rusqlite::Result<()> {
        self.connection.execute_batch("COMMIT")
    }

    pub(in crate::storage::authority_transition::core) fn prepare_cached_for_test(
        &mut self,
    ) -> rusqlite::Result<CachedStatement<'_>> {
        self.connection
            .prepare_cached(super::super::super::writers::PASSWORD_SESSION_INSERT_SQL)
    }

    pub(in crate::storage::authority_transition::core) fn insert_at_generation_for_test(
        &mut self,
        generation: u64,
        session_id: &str,
        user_id: &str,
    ) -> AuthorityTransitionResult<usize> {
        if !self.scope_is_current_at(generation) {
            return Err(AuthorityTransitionError::ScopeAlreadyActive);
        }
        Ok(self.connection.execute(
            super::super::super::writers::PASSWORD_SESSION_INSERT_SQL,
            params![session_id, user_id, 1_i64],
        )?)
    }
}
