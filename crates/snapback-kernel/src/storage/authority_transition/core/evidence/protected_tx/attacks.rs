//! Unit-only exact operations used to exercise scope liveness and caching.

use super::*;
use rusqlite::CachedStatement;

pub(in crate::storage::authority_transition::core::evidence) fn guarded_from_hostile_schema_for_effect_time_test(
    initialized: InitializedConnection,
) -> AuthorityTransitionResult<GuardedConnection> {
    GuardedConnection::install_composite_authorizer(initialized)
}

pub(in crate::storage::authority_transition::core::evidence) fn mutate_resource_guard_for_effect_time_test(
    guarded: &GuardedConnection,
    resource_binding: &[u8; 32],
) -> rusqlite::Result<()> {
    guarded
        .connection
        .authorizer(None::<fn(AuthContext<'_>) -> Authorization>);
    guarded.connection.execute(
        "UPDATE _snapback_authorization_publication_guard_v1
         SET resource_binding = ?1 WHERE singleton = 1",
        [resource_binding.as_slice()],
    )?;
    let installed_state = Arc::clone(&guarded.authorizer_state);
    guarded
        .connection
        .authorizer(Some(move |context: AuthContext<'_>| {
            authorize_composed(&installed_state, context)
        }));
    Ok(())
}

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
