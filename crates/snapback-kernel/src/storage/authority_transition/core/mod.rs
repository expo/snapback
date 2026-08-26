//! Connection-owned protected-effect scope.

use rusqlite::Connection;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization, TransactionOperation};
use std::marker::PhantomData;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

mod evidence;
mod registry;
mod writers;

#[derive(Debug)]
enum AuthorityTransitionError {
    Sqlite(rusqlite::Error),
    CorruptResourceGuard,
    ResourceGuardChanged,
    ProofRefused,
    ScopeAlreadyActive,
    ScopeGenerationExhausted,
    ScopeStatePoisoned,
}

impl From<rusqlite::Error> for AuthorityTransitionError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

type AuthorityTransitionResult<T> = Result<T, AuthorityTransitionError>;

#[derive(Clone, Eq, PartialEq)]
struct DurableOrigin([u8; 32]);

#[derive(Clone, Eq, PartialEq)]
struct ResourceBinding([u8; 32]);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RegisteredOperation {
    IssuePasswordSession,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ScopePhase {
    Idle {
        generation: u64,
    },
    Active {
        generation: u64,
        operation: RegisteredOperation,
    },
    Committing {
        generation: u64,
    },
}

struct AuthorizerCell {
    phase: ScopePhase,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StatementCachePolicy {
    Disabled,
}

// @ref LLP 0311#65-closed-transaction-gateway — the connection and its
// authorizer state have one owner. There is no install-on-an-arbitrary-
// connection method and no raw connection accessor.
struct GuardedConnection {
    connection: Connection,
    durable_origin: DurableOrigin,
    resource_binding: ResourceBinding,
    statement_cache_policy: StatementCachePolicy,
    authorizer_cell: Arc<Mutex<AuthorizerCell>>,
}

// @ref LLP 0303#derivation-is-a-lifetime-property-not-a-constructor-event —
// the writer receives only this generative borrow. It cannot dereference to
// SQLite, commit, prepare arbitrary SQL, or return a statement.
struct ProtectedTx<'scope> {
    connection: &'scope Connection,
    authorizer_cell: &'scope Arc<Mutex<AuthorizerCell>>,
    generation: u64,
    operation: RegisteredOperation,
    _scope: PhantomData<&'scope mut &'scope ()>,
    _not_send_sync: PhantomData<Rc<()>>,
}

impl GuardedConnection {
    fn from_initialized(connection: Connection) -> AuthorityTransitionResult<Self> {
        let (durable_origin, resource_binding) = registry::read_resource_guard(&connection)?;
        let authorizer_cell = Arc::new(Mutex::new(AuthorizerCell {
            phase: ScopePhase::Idle { generation: 0 },
        }));
        // SQLite authorizes statements when they are prepared. A zero-capacity
        // cache is therefore part of the security boundary, not a tuning knob.
        connection.set_prepared_statement_cache_capacity(0);
        let installed_cell = Arc::clone(&authorizer_cell);
        connection.authorizer(Some(move |context: AuthContext<'_>| {
            authorize(&installed_cell, context)
        }));

        Ok(Self {
            connection,
            durable_origin,
            resource_binding,
            statement_cache_policy: StatementCachePolicy::Disabled,
            authorizer_cell,
        })
    }
}

impl ProtectedTx<'_> {
    fn scope_is_current(&self) -> bool {
        let Ok(cell) = self.authorizer_cell.lock() else {
            return false;
        };
        matches!(
            cell.phase,
            ScopePhase::Active {
                generation,
                operation,
            } if generation == self.generation && operation == self.operation
        )
    }
}

fn authorize(cell: &Arc<Mutex<AuthorizerCell>>, context: AuthContext<'_>) -> Authorization {
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
            if active_operation(&cell) == Some(RegisteredOperation::IssuePasswordSession)
                && context.accessor.is_none()
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
            Authorization::Deny
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

#[allow(unexpected_cfgs)]
mod compile_fail {
    #[cfg(snapback_authority_compile_fail)]
    use super::*;

    #[cfg(snapback_authority_compile_fail)]
    include!("compile_fail/commit_protected_tx.rs");
    #[cfg(snapback_authority_compile_fail)]
    include!("compile_fail/deref_protected_tx.rs");
    #[cfg(snapback_authority_compile_fail)]
    include!("compile_fail/open_effect_scope_from_writer.rs");
    #[cfg(snapback_authority_compile_fail)]
    include!("compile_fail/raw_connection_accessor.rs");
}
