//! Transaction-lifetime permit activation and cleanup.

use super::*;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::{Connection, Transaction, TransactionBehavior};

impl ConnectionAuthorizer {
    pub(super) fn for_database(
        binding: DatabaseBinding,
        durable_store_identity: [u8; 32],
        connection_epoch: NonZeroU64,
    ) -> Self {
        Self {
            database_origin: DatabaseOrigin {
                binding,
                durable_store_identity,
            },
            connection_epoch,
            permit_cell: Arc::new(Mutex::new(AuthorizerPermitCell {
                protected_tables: registry::protected_table_registry(),
                dynamic_membership_tables: BTreeSet::new(),
                active: None,
            })),
        }
    }

    pub(super) fn install(&self, connection: &Connection) {
        // SQLite authorizes at prepare time. Cached statements prepared while
        // a permit is live must not remain executable after the permit drops.
        connection.set_prepared_statement_cache_capacity(0);
        let permit_cell = Arc::clone(&self.permit_cell);
        connection.authorizer(Some(move |context: AuthContext<'_>| {
            authorize(&permit_cell, context)
        }));
    }

    pub(super) fn set_dynamic_membership_tables(
        &self,
        table_names: impl IntoIterator<Item = String>,
    ) -> AuthorityTransitionResult<()> {
        let mut cell = self
            .permit_cell
            .lock()
            .map_err(|_| AuthorityTransitionError::AuthorizerPoisoned)?;
        if cell.active.is_some() {
            return Err(AuthorityTransitionError::PermitAlreadyActive);
        }
        cell.dynamic_membership_tables = table_names.into_iter().collect();
        Ok(())
    }

    // @ref LLP 0313#4-private-evidence-and-permits — transaction identity is
    // allocated only after SQLite has acquired the IMMEDIATE writer cut.
    pub(super) fn begin_immediate<'conn>(
        &self,
        connection: &'conn mut Connection,
    ) -> rusqlite::Result<(Transaction<'conn>, TransactionIdentity)> {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let identity = TransactionIdentity {
            database_origin: self.database_origin.clone(),
            connection_epoch: self.connection_epoch,
            nonce_registry: RefCell::new(BTreeSet::new()),
            authorizer_permit_cell: Arc::clone(&self.permit_cell),
            _not_send_sync: PhantomData,
        };
        Ok((transaction, identity))
    }
}

pub(super) fn activate<'tx>(
    transaction: &'tx TransactionIdentity,
    nonce: NonZeroU128,
    mutation: AuthorityMutation,
    write_set: ProtectedWriteSet,
    successor_digest: [u8; 32],
) -> AuthorityTransitionResult<AuthorityWritePermit<'tx>> {
    let mut cell = transaction
        .authorizer_permit_cell
        .lock()
        .map_err(|_| AuthorityTransitionError::AuthorizerPoisoned)?;
    if cell.active.is_some() {
        return Err(AuthorityTransitionError::PermitAlreadyActive);
    }
    cell.active = Some(ActivePermit {
        connection_epoch: transaction.connection_epoch,
        nonce,
        mutation,
        write_set,
        successor_digest,
    });
    drop(cell);
    Ok(AuthorityWritePermit {
        transaction,
        nonce,
        mutation,
        successor_digest,
        _not_send_sync: PhantomData,
    })
}

fn authorize(
    permit_cell: &Arc<Mutex<AuthorizerPermitCell>>,
    context: AuthContext<'_>,
) -> Authorization {
    let Ok(cell) = permit_cell.lock() else {
        return Authorization::Deny;
    };
    if context
        .database_name
        .is_some_and(|database| !database.eq_ignore_ascii_case("main"))
    {
        return Authorization::Deny;
    }

    match context.action {
        AuthAction::Insert { table_name } => {
            authorize_dml(&cell, table_name, DmlAction::Insert, context.accessor)
        }
        AuthAction::Update {
            table_name,
            column_name,
        } => authorize_dml(
            &cell,
            table_name,
            DmlAction::Update(column_name),
            context.accessor,
        ),
        AuthAction::Delete { table_name } => {
            authorize_dml(&cell, table_name, DmlAction::Delete, context.accessor)
        }
        AuthAction::CreateTrigger {
            trigger_name,
            table_name,
        } => authorize_trigger(&cell, table_name, trigger_name, true),
        AuthAction::DropTrigger {
            trigger_name,
            table_name,
        } => authorize_trigger(&cell, table_name, trigger_name, false),
        AuthAction::CreateIndex { table_name, .. }
        | AuthAction::CreateTable { table_name }
        | AuthAction::DropIndex { table_name, .. }
        | AuthAction::DropTable { table_name }
        | AuthAction::AlterTable { table_name, .. } => authorize_schema(&cell, Some(table_name)),
        AuthAction::CreateView { .. }
        | AuthAction::DropView { .. }
        | AuthAction::Reindex { .. }
        | AuthAction::Analyze { .. }
        | AuthAction::CreateVtable { .. }
        | AuthAction::DropVtable { .. } => authorize_schema(&cell, None),
        AuthAction::CreateTempIndex { .. }
        | AuthAction::CreateTempTable { .. }
        | AuthAction::CreateTempTrigger { .. }
        | AuthAction::CreateTempView { .. }
        | AuthAction::DropTempIndex { .. }
        | AuthAction::DropTempTable { .. }
        | AuthAction::DropTempTrigger { .. }
        | AuthAction::DropTempView { .. } => Authorization::Deny,
        AuthAction::Attach { .. } => {
            authorize_connection_operation(&cell, &ProtectedWriteOperation::AttachDatabase)
        }
        AuthAction::Detach { .. } => {
            authorize_connection_operation(&cell, &ProtectedWriteOperation::DetachDatabase)
        }
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
        | AuthAction::Transaction { .. }
        | AuthAction::Savepoint { .. }
        | AuthAction::Recursive => Authorization::Allow,
        AuthAction::Unknown { .. } => Authorization::Deny,
        _ => Authorization::Deny,
    }
}

enum DmlAction<'a> {
    Insert,
    Update(&'a str),
    Delete,
}

fn authorize_dml(
    cell: &AuthorizerPermitCell,
    table_name: &str,
    action: DmlAction<'_>,
    accessor: Option<&str>,
) -> Authorization {
    let is_dynamic = cell.dynamic_membership_tables.contains(table_name);
    if !cell.protected_tables.contains(table_name)
        && !is_dynamic
        && !table_name.starts_with("_auth_")
    {
        return Authorization::Allow;
    }
    let Some(active) = cell.active.as_ref() else {
        return Authorization::Deny;
    };
    let allowed = active.write_set.writes.iter().any(|write| {
        registry::protected_table_name(&write.object)
            .is_some_and(|registered| registered == table_name)
            && accessor_matches(&write.accessor, accessor)
            && operation_matches(&write.operation, &action, is_dynamic)
    });
    if allowed {
        Authorization::Allow
    } else {
        Authorization::Deny
    }
}

fn accessor_matches(expected: &ProtectedWriteAccessor, observed: Option<&str>) -> bool {
    match (expected, observed) {
        (ProtectedWriteAccessor::Direct, None) => true,
        (ProtectedWriteAccessor::Trigger(expected), Some(observed)) => expected == &observed,
        _ => false,
    }
}

fn operation_matches(
    expected: &ProtectedWriteOperation,
    observed: &DmlAction<'_>,
    dynamic_membership: bool,
) -> bool {
    matches!(
        (expected, observed),
        (ProtectedWriteOperation::Insert, DmlAction::Insert)
            | (ProtectedWriteOperation::Delete, DmlAction::Delete)
    ) || matches!(
        (expected, observed),
        (ProtectedWriteOperation::Update(expected), DmlAction::Update(observed))
            if expected == observed
    ) || (dynamic_membership && matches!(expected, ProtectedWriteOperation::DynamicMembership))
}

fn authorize_trigger(
    cell: &AuthorizerPermitCell,
    table_name: &str,
    trigger_name: &str,
    create: bool,
) -> Authorization {
    let Some(active) = cell.active.as_ref() else {
        return Authorization::Deny;
    };
    let allowed = active.write_set.writes.iter().any(|write| {
        registry::protected_table_name(&write.object)
            .is_some_and(|registered| registered == table_name)
            && matches!(write.accessor, ProtectedWriteAccessor::Direct)
            && match &write.operation {
                ProtectedWriteOperation::CreateTrigger(expected) if create => {
                    expected == &trigger_name
                }
                ProtectedWriteOperation::DropTrigger(expected) if !create => {
                    expected == &trigger_name
                }
                _ => false,
            }
    });
    if allowed {
        Authorization::Allow
    } else {
        Authorization::Deny
    }
}

fn authorize_schema(cell: &AuthorizerPermitCell, table_name: Option<&str>) -> Authorization {
    let Some(active) = cell.active.as_ref() else {
        return Authorization::Deny;
    };
    let allowed = active.write_set.writes.iter().any(|write| {
        matches!(write.operation, ProtectedWriteOperation::Schema)
            && matches!(write.accessor, ProtectedWriteAccessor::Direct)
            && match table_name {
                Some(table) => {
                    matches!(write.object, ProtectedObject::Connection)
                        || registry::protected_table_name(&write.object)
                            .is_some_and(|registered| registered == table)
                }
                None => matches!(write.object, ProtectedObject::Connection),
            }
    });
    if allowed {
        Authorization::Allow
    } else {
        Authorization::Deny
    }
}

fn authorize_connection_operation(
    cell: &AuthorizerPermitCell,
    operation: &ProtectedWriteOperation,
) -> Authorization {
    let allowed = cell.active.as_ref().is_some_and(|active| {
        active.write_set.writes.iter().any(|write| {
            matches!(write.object, ProtectedObject::Connection)
                && &write.operation == operation
                && matches!(write.accessor, ProtectedWriteAccessor::Direct)
        })
    });
    if allowed {
        Authorization::Allow
    } else {
        Authorization::Deny
    }
}

impl Drop for AuthorityWritePermit<'_> {
    fn drop(&mut self) {
        let Ok(mut cell) = self.transaction.authorizer_permit_cell.lock() else {
            return;
        };
        let owns_active = cell.active.as_ref().is_some_and(|active| {
            active.connection_epoch == self.transaction.connection_epoch
                && active.nonce == self.nonce
                && active.mutation == self.mutation
                && active.successor_digest == self.successor_digest
        });
        if owns_active {
            cell.active = None;
        }
    }
}
