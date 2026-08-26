//! Raw SQLite custody for the exact password-session ceremony.
//!
//! This module is nested below `evidence`, not above `writers`. Rust privacy
//! therefore lets the evidence choreography construct the scoped view while a
//! writer sibling can invoke only the exact operation below. In particular,
//! writer code cannot read either the transaction or the composite authorizer
//! state.

use super::super::*;
use crate::storage::write_authority::WriterAuthorityV1;
#[cfg(test)]
use rusqlite::Params;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization, TransactionOperation};
use rusqlite::{Connection, Transaction, params};
use std::marker::PhantomData;
use std::rc::Rc;
#[cfg(snapback_authority_mutation_share_connection_state)]
use std::sync::Weak;
use std::sync::{Arc, Mutex};

#[cfg(snapback_authority_mutation_share_connection_state)]
static SHARED_CONNECTION_STATE_MUTATION: Mutex<Option<Weak<CompositePolicyState>>> =
    Mutex::new(None);

pub(in crate::storage::authority_transition::core) struct DerivedPasswordSession {
    pub(super) session_id: String,
    pub(super) subject_user_id: String,
    pub(super) assurance_generation: i64,
}

impl DerivedPasswordSession {
    pub(super) fn new(
        session_id: String,
        subject_user_id: String,
        assurance_generation: i64,
    ) -> Self {
        Self {
            session_id,
            subject_user_id,
            assurance_generation,
        }
    }
}

#[allow(unexpected_cfgs)]
pub(in crate::storage::authority_transition::core) struct CompositePolicyState {
    #[cfg(not(snapback_authority_mutation_writer_raw_access))]
    pub(super) transition: Mutex<AuthorizerCell>,
    #[cfg(snapback_authority_mutation_writer_raw_access)]
    pub(in crate::storage::authority_transition::core) transition: Mutex<AuthorizerCell>,
    writer_authority: WriterAuthorityV1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ResourceCustody {
    PrivateConnectionMemory,
    #[cfg(test)]
    SharedFileForRejectionProbe,
}

/// The SQLite handle and writer-policy limb are created and consumed as one
/// private object. No activation API accepts either limb independently.
///
/// @ref LLP 0303#a-guard-held-in-per-handle-state-is-opt-in — Landing A
/// accepts only a connection-private memory resource; shared-file custody is
/// not inferred from a handle-local callback.
#[allow(unexpected_cfgs)]
pub(in crate::storage::authority_transition::core) struct InitializedConnection {
    #[cfg(not(snapback_authority_mutation_expose_initialized_limbs))]
    connection: Connection,
    #[cfg(snapback_authority_mutation_expose_initialized_limbs)]
    pub(in crate::storage::authority_transition::core) connection: Connection,
    #[cfg(not(snapback_authority_mutation_expose_initialized_limbs))]
    writer_authority: WriterAuthorityV1,
    #[cfg(snapback_authority_mutation_expose_initialized_limbs)]
    pub(in crate::storage::authority_transition::core) writer_authority: WriterAuthorityV1,
    #[cfg(not(snapback_authority_mutation_expose_initialized_limbs))]
    custody: ResourceCustody,
    #[cfg(snapback_authority_mutation_expose_initialized_limbs)]
    pub(in crate::storage::authority_transition::core) custody: ResourceCustody,
}

// @ref LLP 0311#65-closed-transaction-gateway — the connection and the one
// composite callback state have one owner. Construction validates the durable
// schema before replacing any previously installed callback, and replacement
// composes rather than discards WriterAuthorityV1.
pub(in crate::storage::authority_transition::core) struct GuardedConnection {
    pub(super) connection: Connection,
    pub(super) durable_origin: DurableOrigin,
    pub(super) resource_binding: ResourceBinding,
    pub(super) statement_cache_policy: StatementCachePolicy,
    pub(super) authorizer_state: Arc<CompositePolicyState>,
}

// @ref LLP 0303#derivation-is-a-lifetime-property-not-a-constructor-event —
// the writer receives only this generative borrow. Its raw fields are private
// to `evidence::protected_tx`, a sibling of `core::writers`, so descendant
// writer privacy cannot replace the authorizer or corrupt the generation.
#[allow(unexpected_cfgs)]
pub(in crate::storage::authority_transition::core) struct ProtectedTx<'scope> {
    #[cfg(not(snapback_authority_mutation_writer_raw_access))]
    connection: &'scope Connection,
    #[cfg(snapback_authority_mutation_writer_raw_access)]
    pub(in crate::storage::authority_transition::core) connection: &'scope Connection,
    #[cfg(not(snapback_authority_mutation_writer_raw_access))]
    authorizer_state: &'scope Arc<CompositePolicyState>,
    #[cfg(snapback_authority_mutation_writer_raw_access)]
    pub(in crate::storage::authority_transition::core) authorizer_state:
        &'scope Arc<CompositePolicyState>,
    generation: u64,
    operation: RegisteredOperation,
    _scope: PhantomData<&'scope mut &'scope ()>,
    _not_send_sync: PhantomData<Rc<()>>,
}

impl GuardedConnection {
    pub(super) fn from_initialized(
        initialized: InitializedConnection,
    ) -> AuthorityTransitionResult<Self> {
        if initialized.custody != ResourceCustody::PrivateConnectionMemory
            && !cfg!(snapback_authority_mutation_allow_shared_file)
        {
            return Err(AuthorityTransitionError::SharedFileCustodyUnproven);
        }
        registry::validate_initialized_schema(&initialized.connection)?;
        Self::install_composite_authorizer(initialized)
    }

    fn install_composite_authorizer(
        initialized: InitializedConnection,
    ) -> AuthorityTransitionResult<Self> {
        let InitializedConnection {
            connection,
            writer_authority,
            custody: _,
        } = initialized;
        let (durable_origin, resource_binding) = registry::read_resource_guard(&connection)?;
        #[cfg(snapback_authority_mutation_discard_owned_writer_policy)]
        let writer_authority = WriterAuthorityV1::default();
        let fresh_authorizer_state = Arc::new(CompositePolicyState {
            transition: Mutex::new(AuthorizerCell {
                #[cfg(not(snapback_authority_mutation_stale_reused_state))]
                phase: ScopePhase::Idle { generation: 0 },
                #[cfg(snapback_authority_mutation_stale_reused_state)]
                phase: ScopePhase::Active {
                    generation: 0,
                    operation: RegisteredOperation::IssuePasswordSession,
                },
            }),
            writer_authority,
        });
        #[cfg(not(snapback_authority_mutation_share_connection_state))]
        let authorizer_state = fresh_authorizer_state;
        #[cfg(snapback_authority_mutation_share_connection_state)]
        let authorizer_state = {
            let mut shared = SHARED_CONNECTION_STATE_MUTATION
                .lock()
                .expect("connection-state mutation mutex");
            if let Some(existing) = shared.as_ref().and_then(Weak::upgrade) {
                existing
            } else {
                *shared = Some(Arc::downgrade(&fresh_authorizer_state));
                fresh_authorizer_state
            }
        };

        // SQLite authorizes statements when they are prepared. A zero-capacity
        // cache is therefore part of the security boundary, not a tuning knob.
        #[cfg(not(snapback_authority_mutation_statement_cache))]
        connection.set_prepared_statement_cache_capacity(0);
        #[cfg(snapback_authority_mutation_statement_cache)]
        connection.set_prepared_statement_cache_capacity(16);
        let installed_state = Arc::clone(&authorizer_state);
        connection.authorizer(Some(move |context: AuthContext<'_>| {
            authorize_composed(&installed_state, context)
        }));

        Ok(Self {
            connection,
            durable_origin,
            resource_binding,
            statement_cache_policy: StatementCachePolicy::Disabled,
            authorizer_state,
        })
    }
}

impl InitializedConnection {
    pub(super) fn private_memory() -> AuthorityTransitionResult<Self> {
        Ok(Self {
            connection: Connection::open_in_memory()?,
            writer_authority: WriterAuthorityV1::default(),
            custody: ResourceCustody::PrivateConnectionMemory,
        })
    }

    #[cfg(test)]
    pub(super) fn shared_file_for_rejection_probe(
        path: &std::path::Path,
    ) -> AuthorityTransitionResult<Self> {
        Ok(Self {
            connection: Connection::open(path)?,
            writer_authority: WriterAuthorityV1::default(),
            custody: ResourceCustody::SharedFileForRejectionProbe,
        })
    }

    #[cfg(test)]
    pub(super) fn execute_batch(&self, sql: &str) -> rusqlite::Result<()> {
        self.connection.execute_batch(sql)
    }

    #[cfg(test)]
    pub(super) fn execute<P: Params>(&self, sql: &str, params: P) -> rusqlite::Result<usize> {
        self.connection.execute(sql, params)
    }

    #[cfg(test)]
    pub(super) fn arm_covered_table_for_test(
        &self,
        table: &str,
    ) -> crate::diagnostic::SnapbackResult<()> {
        self.writer_authority
            .arm_covered_table_for_authority_transition_test(&self.connection, table)
    }
}

impl<'scope> ProtectedTx<'scope> {
    pub(super) fn new(
        transaction: &'scope Transaction<'_>,
        authorizer_state: &'scope Arc<CompositePolicyState>,
        generation: u64,
        operation: RegisteredOperation,
    ) -> Self {
        Self {
            connection: transaction,
            authorizer_state,
            generation,
            operation,
            _scope: PhantomData,
            _not_send_sync: PhantomData,
        }
    }

    fn scope_is_current(&self) -> bool {
        self.scope_is_current_at(self.generation)
    }

    fn scope_is_current_at(&self, generation: u64) -> bool {
        let Ok(cell) = self.authorizer_state.transition.lock() else {
            return false;
        };
        match cell.phase {
            ScopePhase::Active {
                generation: active_generation,
                operation,
            } => {
                #[cfg(not(snapback_authority_mutation_ignore_scope_generation))]
                let generation_matches = active_generation == generation;
                #[cfg(snapback_authority_mutation_ignore_scope_generation)]
                let generation_matches = true;
                generation_matches && operation == self.operation
            }
            ScopePhase::Idle { .. } | ScopePhase::Committing { .. } => false,
        }
    }

    pub(in crate::storage::authority_transition::core) fn insert_password_session(
        &mut self,
        derived: &DerivedPasswordSession,
    ) -> AuthorityTransitionResult<usize> {
        if !self.scope_is_current() || self.operation != RegisteredOperation::IssuePasswordSession {
            return Err(AuthorityTransitionError::ScopeAlreadyActive);
        }
        Ok(self.connection.execute(
            super::super::writers::PASSWORD_SESSION_INSERT_SQL,
            params![
                &derived.session_id,
                &derived.subject_user_id,
                derived.assurance_generation
            ],
        )?)
    }
}

#[cfg(test)]
mod attacks;

#[cfg(test)]
pub(super) use attacks::guarded_from_hostile_schema_for_effect_time_test;
#[cfg(test)]
pub(super) use attacks::mutate_resource_guard_for_effect_time_test;

#[allow(unexpected_cfgs)]
fn authorize_composed(
    state: &Arc<CompositePolicyState>,
    context: AuthContext<'_>,
) -> Authorization {
    #[cfg(not(snapback_authority_mutation_discard_writer_policy))]
    let writer = state.writer_authority.authorize_context(context);
    #[cfg(snapback_authority_mutation_discard_writer_policy)]
    let writer = Authorization::Allow;
    let transition = authorize_transition(&state.transition, context);
    compose(writer, transition)
}

fn compose(left: Authorization, right: Authorization) -> Authorization {
    match (left, right) {
        (Authorization::Deny, _) | (_, Authorization::Deny) => Authorization::Deny,
        (Authorization::Ignore, _) | (_, Authorization::Ignore) => Authorization::Ignore,
        (Authorization::Allow, Authorization::Allow) => Authorization::Allow,
        _ => Authorization::Deny,
    }
}

fn authorize_transition(cell: &Mutex<AuthorizerCell>, context: AuthContext<'_>) -> Authorization {
    let Ok(cell) = cell.lock() else {
        return Authorization::Deny;
    };
    if context
        .database_name
        .is_some_and(|database| !database.eq_ignore_ascii_case("main"))
    {
        return Authorization::Deny;
    }

    match context.action {
        AuthAction::Insert { table_name } if table_name.eq_ignore_ascii_case("_auth_sessions") => {
            if cfg!(snapback_authority_mutation_allow_unscoped_conflicts)
                || cfg!(snapback_authority_mutation_statement_cache)
                || (active_operation(&cell) == Some(RegisteredOperation::IssuePasswordSession)
                    && context.accessor.is_none())
            {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        AuthAction::Insert { table_name }
        | AuthAction::Delete { table_name }
        | AuthAction::Update { table_name, .. }
            if registry::is_protected_table(table_name) =>
        {
            if cfg!(snapback_authority_mutation_allow_unscoped_conflicts)
                || cfg!(snapback_authority_mutation_allow_fk_cascade)
            {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        AuthAction::CreateIndex { .. }
        | AuthAction::CreateTable { .. }
        | AuthAction::CreateTempIndex { .. }
        | AuthAction::CreateTempTable { .. }
        | AuthAction::CreateTempTrigger { .. }
        | AuthAction::CreateTempView { .. }
        | AuthAction::CreateTrigger { .. }
        | AuthAction::CreateView { .. }
        | AuthAction::DropIndex { .. }
        | AuthAction::DropTable { .. }
        | AuthAction::DropTempIndex { .. }
        | AuthAction::DropTempTable { .. }
        | AuthAction::DropTempTrigger { .. }
        | AuthAction::DropTempView { .. }
        | AuthAction::DropTrigger { .. }
        | AuthAction::DropView { .. }
        | AuthAction::AlterTable { .. }
        | AuthAction::Reindex { .. }
        | AuthAction::Analyze { .. }
        | AuthAction::CreateVtable { .. }
        | AuthAction::DropVtable { .. }
        | AuthAction::Attach { .. }
        | AuthAction::Detach { .. }
        | AuthAction::Savepoint { .. }
        | AuthAction::Unknown { .. } => Authorization::Deny,
        AuthAction::Transaction { operation } => authorize_transaction(cell.phase, operation),
        AuthAction::Pragma {
            pragma_name,
            pragma_value,
        } => {
            if pragma_value.is_none()
                && [
                    "application_id",
                    "data_version",
                    "database_list",
                    "foreign_keys",
                    "schema_version",
                    "table_info",
                    "table_list",
                    "user_version",
                ]
                .iter()
                .any(|name| pragma_name.eq_ignore_ascii_case(name))
            {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        AuthAction::Read { .. }
        | AuthAction::Select
        | AuthAction::Function { .. }
        | AuthAction::Recursive => Authorization::Allow,
        _ => Authorization::Allow,
    }
}

fn active_operation(cell: &AuthorizerCell) -> Option<RegisteredOperation> {
    match cell.phase {
        ScopePhase::Active { operation, .. } => Some(operation),
        ScopePhase::Idle { .. } | ScopePhase::Committing { .. } => None,
    }
}

fn authorize_transaction(phase: ScopePhase, operation: TransactionOperation) -> Authorization {
    let allowed = matches!(
        (phase, operation),
        (
            ScopePhase::Idle { .. },
            TransactionOperation::Begin | TransactionOperation::Rollback
        ) | (
            ScopePhase::Committing { .. },
            TransactionOperation::Unknown
                | TransactionOperation::Release
                | TransactionOperation::Rollback
        )
    );
    if allowed {
        Authorization::Allow
    } else {
        Authorization::Deny
    }
}
