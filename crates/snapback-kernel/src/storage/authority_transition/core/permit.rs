//! Transaction-lifetime permit activation and cleanup.

use super::*;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::{Connection, Transaction, TransactionBehavior};
use std::ffi::CStr;
use std::os::raw::{c_char, c_int, c_void};

impl ConnectionAuthorizer {
    pub(super) fn for_database(binding: DatabaseBinding, durable_store_identity: [u8; 32]) -> Self {
        Self {
            binding,
            durable_store_identity,
            permit_cell: Arc::new(Mutex::new(AuthorizerPermitCell {
                database_origin: None,
                connection_epoch: None,
                protected_tables: registry::protected_table_registry(),
                dynamic_membership_tables: BTreeSet::new(),
                active: None,
                execution_violation: false,
                transaction_tainted: false,
            })),
        }
    }

    pub(super) fn install(&self, connection: &Connection) -> AuthorityTransitionResult<()> {
        let actual_connection = connection_identity(connection);
        let (permit_cell, mismatch) = {
            let mut cell = self
                .permit_cell
                .lock()
                .map_err(|_| AuthorityTransitionError::AuthorizerPoisoned)?;
            match &cell.database_origin {
                None => {
                    cell.database_origin = Some(DatabaseOrigin {
                        binding: self.binding.clone(),
                        durable_store_identity: self.durable_store_identity,
                        connection_identity: actual_connection,
                    });
                    cell.connection_epoch = NonZeroU64::new(1);
                    (Arc::clone(&self.permit_cell), false)
                }
                Some(origin) if origin.connection_identity == actual_connection => {
                    (Arc::clone(&self.permit_cell), false)
                }
                Some(_) => {
                    // Install a distinct, permanently unarmed cell on the
                    // second connection before reporting the mismatch. Even a
                    // caller that ignores the error cannot consult A's permit.
                    let denial_cell = AuthorizerPermitCell {
                        database_origin: Some(DatabaseOrigin {
                            binding: self.binding.clone(),
                            durable_store_identity: self.durable_store_identity,
                            connection_identity: actual_connection,
                        }),
                        connection_epoch: NonZeroU64::new(1),
                        protected_tables: cell.protected_tables.clone(),
                        dynamic_membership_tables: cell.dynamic_membership_tables.clone(),
                        active: None,
                        execution_violation: false,
                        transaction_tainted: false,
                    };
                    (Arc::new(Mutex::new(denial_cell)), true)
                }
            }
        };

        install_callbacks(connection, permit_cell)?;
        if mismatch {
            Err(AuthorityTransitionError::AuthorizerConnectionMismatch)
        } else {
            Ok(())
        }
    }

    pub(super) fn set_dynamic_membership_tables(
        &self,
        table_names: impl IntoIterator<Item = String>,
    ) -> AuthorityTransitionResult<()> {
        let mut cell = self
            .permit_cell
            .lock()
            .map_err(|_| AuthorityTransitionError::AuthorizerPoisoned)?;
        clear_stale_active(&mut cell);
        if cell.active.is_some() {
            return Err(AuthorityTransitionError::PermitAlreadyActive);
        }
        cell.dynamic_membership_tables = table_names.into_iter().collect();
        Ok(())
    }

    // @ref LLP 0313#4-private-evidence-and-permits — transaction identity is
    // allocated only after SQLite has acquired the IMMEDIATE writer cut, and
    // its origin/epoch come from the cell installed on this exact connection.
    pub(super) fn begin_immediate<'conn>(
        &self,
        connection: &'conn mut Connection,
    ) -> AuthorityTransitionResult<AuthorityTransaction<'conn>> {
        let actual_connection = connection_identity(connection);
        let (database_origin, connection_epoch) = {
            let cell = self
                .permit_cell
                .lock()
                .map_err(|_| AuthorityTransitionError::AuthorizerPoisoned)?;
            let origin = cell
                .database_origin
                .as_ref()
                .ok_or(AuthorityTransitionError::AuthorizerNotInstalled)?;
            if origin.connection_identity != actual_connection {
                return Err(AuthorityTransitionError::AuthorizerConnectionMismatch);
            }
            let epoch = cell
                .connection_epoch
                .ok_or(AuthorityTransitionError::ConnectionEpochExhausted)?;
            (origin.clone(), epoch)
        };
        let sqlite_transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| AuthorityTransitionError::SqliteAuthorizationUnavailable)?;
        let identity = TransactionIdentity {
            database_origin,
            connection_epoch,
            nonce_registry: RefCell::new(BTreeSet::new()),
            authorizer_permit_cell: Arc::clone(&self.permit_cell),
            _not_send_sync: PhantomData,
        };
        Ok(AuthorityTransaction {
            sqlite_transaction,
            identity,
        })
    }
}

impl AuthorityTransaction<'_> {
    pub(super) fn sqlite(&self) -> &Transaction<'_> {
        &self.sqlite_transaction
    }

    pub(super) fn identity(&self) -> &TransactionIdentity {
        &self.identity
    }

    pub(super) fn commit(self) -> rusqlite::Result<()> {
        let Self {
            sqlite_transaction,
            identity: _identity,
        } = self;
        sqlite_transaction.commit()
    }

    pub(super) fn rollback(self) -> rusqlite::Result<()> {
        let Self {
            sqlite_transaction,
            identity: _identity,
        } = self;
        sqlite_transaction.rollback()
    }
}

fn connection_identity(connection: &Connection) -> ConnectionIdentity {
    // SAFETY: the handle is only observed synchronously while `connection` is
    // borrowed. It is never dereferenced or used to call SQLite here.
    let address = unsafe { connection.handle() } as usize;
    ConnectionIdentity(NonZeroUsize::new(address).expect("SQLite connection handle is non-null"))
}

fn install_callbacks(
    connection: &Connection,
    permit_cell: Arc<Mutex<AuthorizerPermitCell>>,
) -> AuthorityTransitionResult<()> {
    // SQLite authorizes at prepare time. A zero-capacity cache removes one
    // retention route; permit Drop below additionally expires live statements.
    connection.set_prepared_statement_cache_capacity(0);
    install_authorizer(connection, Arc::clone(&permit_cell))?;
    install_preupdate_hook(connection, &permit_cell);

    let progress_cell = Arc::clone(&permit_cell);
    connection.progress_handler(
        1,
        Some(move || match progress_cell.lock() {
            Ok(mut cell) => std::mem::take(&mut cell.execution_violation),
            Err(_) => true,
        }),
    );

    let commit_cell = Arc::clone(&permit_cell);
    connection.commit_hook(Some(move || finish_commit(&commit_cell)));

    let rollback_cell = Arc::clone(&permit_cell);
    connection.rollback_hook(Some(move || finish_transaction(&rollback_cell)));
    Ok(())
}

fn install_authorizer(
    connection: &Connection,
    permit_cell: Arc<Mutex<AuthorizerPermitCell>>,
) -> AuthorityTransitionResult<()> {
    connection.authorizer(Some(move |context: AuthContext<'_>| {
        authorize(&permit_cell, context)
    }));
    Ok(())
}

fn install_preupdate_hook(connection: &Connection, permit_cell: &Arc<Mutex<AuthorizerPermitCell>>) {
    // SAFETY: SQLite was compiled with SQLITE_ENABLE_PREUPDATE_HOOK. The raw
    // context points at the Mutex allocation owned by `permit_cell`; the same
    // connection's authorizer/progress/commit/rollback closures each retain a
    // strong Arc until the SQLite connection and all callbacks are destroyed.
    unsafe {
        rusqlite::ffi::sqlite3_preupdate_hook(
            connection.handle(),
            Some(preupdate_callback),
            Arc::as_ptr(permit_cell) as *mut c_void,
        );
    }
}

unsafe extern "C" fn preupdate_callback(
    context: *mut c_void,
    _connection: *mut rusqlite::ffi::sqlite3,
    operation: c_int,
    database_name: *const c_char,
    table_name: *const c_char,
    _old_row_id: rusqlite::ffi::sqlite3_int64,
    _new_row_id: rusqlite::ffi::sqlite3_int64,
) {
    if context.is_null() || database_name.is_null() || table_name.is_null() {
        return;
    }
    // SAFETY: install_preupdate_hook establishes the context lifetime and the
    // SQLite callback contract guarantees NUL-terminated names here.
    let cell = unsafe { &*(context as *const Mutex<AuthorizerPermitCell>) };
    let database_name = unsafe { CStr::from_ptr(database_name) };
    let table_name = unsafe { CStr::from_ptr(table_name) };
    let Ok(database_name) = database_name.to_str() else {
        mark_execution_violation(cell);
        return;
    };
    let Ok(table_name) = table_name.to_str() else {
        mark_execution_violation(cell);
        return;
    };
    let observed = match operation {
        rusqlite::ffi::SQLITE_INSERT => RuntimeDmlAction::Insert,
        rusqlite::ffi::SQLITE_UPDATE => RuntimeDmlAction::Update,
        rusqlite::ffi::SQLITE_DELETE => RuntimeDmlAction::Delete,
        _ => {
            mark_execution_violation(cell);
            return;
        }
    };
    let Ok(mut cell) = cell.lock() else {
        return;
    };
    if !runtime_operation_allowed(&cell, database_name, table_name, observed) {
        cell.execution_violation = true;
        cell.transaction_tainted = true;
    }
}

fn mark_execution_violation(cell: &Mutex<AuthorizerPermitCell>) {
    if let Ok(mut cell) = cell.lock() {
        cell.execution_violation = true;
        cell.transaction_tainted = true;
    }
}

fn finish_transaction(permit_cell: &Arc<Mutex<AuthorizerPermitCell>>) {
    let Ok(mut cell) = permit_cell.lock() else {
        return;
    };
    finish_transaction_locked(&mut cell);
}

fn finish_commit(permit_cell: &Arc<Mutex<AuthorizerPermitCell>>) -> bool {
    let Ok(mut cell) = permit_cell.lock() else {
        return true;
    };
    let must_rollback = cell.transaction_tainted;
    finish_transaction_locked(&mut cell);
    must_rollback
}

fn finish_transaction_locked(cell: &mut AuthorizerPermitCell) {
    cell.active = None;
    cell.execution_violation = false;
    cell.transaction_tainted = false;
    cell.connection_epoch = cell
        .connection_epoch
        .and_then(|epoch| epoch.get().checked_add(1).and_then(NonZeroU64::new));
}

pub(super) fn activate<'tx, 'conn>(
    transaction: &'tx TransactionIdentity,
    sqlite_transaction: &'tx Transaction<'conn>,
    nonce: NonZeroU128,
    mutation: AuthorityMutation,
    write_set: ProtectedWriteSet,
    successor_digest: [u8; 32],
) -> AuthorityTransitionResult<AuthorityWritePermit<'tx, 'conn>> {
    // The nonce is removed here, at the only activation point. A writer can
    // call this function, but it cannot register a nonce because registration
    // requires evidence::EvidenceMintAuthority's private field.
    registry::consume_nonce(transaction, nonce)?;
    if write_set != registry::write_set_for(&mutation) {
        return Err(AuthorityTransitionError::WriteSetMismatch);
    }
    if successor_digest == [0; 32] {
        return Err(AuthorityTransitionError::SuccessorDigestMismatch);
    }
    if connection_identity(sqlite_transaction) != transaction.database_origin.connection_identity {
        return Err(AuthorityTransitionError::DatabaseOriginMismatch);
    }

    let mut cell = transaction
        .authorizer_permit_cell
        .lock()
        .map_err(|_| AuthorityTransitionError::AuthorizerPoisoned)?;
    clear_stale_active(&mut cell);
    let origin = cell
        .database_origin
        .as_ref()
        .ok_or(AuthorityTransitionError::AuthorizerNotInstalled)?;
    if !registry::origins_match(origin, &transaction.database_origin) {
        return Err(AuthorityTransitionError::DatabaseOriginMismatch);
    }
    if cell.connection_epoch != Some(transaction.connection_epoch) {
        return Err(AuthorityTransitionError::TransactionMismatch);
    }
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
        _sqlite_transaction: sqlite_transaction,
        nonce,
        mutation,
        successor_digest,
        _not_send_sync: PhantomData,
    })
}

// @ref LLP 0313#4-private-evidence-and-permits — transaction liveness is a
// connection state-machine property, not destructor reachability. COMMIT and
// ROLLBACK clear the cell and advance the epoch even if Rust owners are leaked.
fn live_active(cell: &AuthorizerPermitCell) -> Option<&ActivePermit> {
    let active = cell.active.as_ref()?;
    let epoch = cell.connection_epoch?;
    cell.database_origin.as_ref()?;
    if active.connection_epoch != epoch {
        return None;
    }
    Some(active)
}

fn clear_stale_active(cell: &mut AuthorizerPermitCell) {
    if cell.active.is_some() && live_active(cell).is_none() {
        cell.active = None;
    }
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

#[derive(Clone, Copy)]
enum RuntimeDmlAction {
    Insert,
    Update,
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
    let Some(active) = live_active(cell) else {
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

fn runtime_operation_allowed(
    cell: &AuthorizerPermitCell,
    database_name: &str,
    table_name: &str,
    observed: RuntimeDmlAction,
) -> bool {
    let is_dynamic = cell.dynamic_membership_tables.contains(table_name);
    if database_name.eq_ignore_ascii_case("main")
        && !cell.protected_tables.contains(table_name)
        && !is_dynamic
        && !table_name.starts_with("_auth_")
    {
        return true;
    }
    // Prepared statements may already have passed the prepare-time
    // authorizer. Execution therefore also fails closed when the permit is no
    // longer live; statement expiration supplies the earlier, typed refusal.
    let Some(active) = live_active(cell) else {
        return false;
    };
    active.write_set.writes.iter().any(|write| {
        registry::protected_table_name(&write.object)
            .is_some_and(|registered| registered == table_name)
            && runtime_operation_matches(&write.operation, observed, is_dynamic)
    })
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
            | (ProtectedWriteOperation::Replace, DmlAction::Insert)
            | (ProtectedWriteOperation::Delete, DmlAction::Delete)
    ) || matches!(
        (expected, observed),
        (ProtectedWriteOperation::Update(expected), DmlAction::Update(observed))
            if expected == observed
    ) || (dynamic_membership && matches!(expected, ProtectedWriteOperation::DynamicMembership))
}

fn runtime_operation_matches(
    expected: &ProtectedWriteOperation,
    observed: RuntimeDmlAction,
    dynamic_membership: bool,
) -> bool {
    matches!(
        (expected, observed),
        (ProtectedWriteOperation::Insert, RuntimeDmlAction::Insert)
            | (ProtectedWriteOperation::Replace, RuntimeDmlAction::Insert)
            | (ProtectedWriteOperation::Replace, RuntimeDmlAction::Delete)
            | (ProtectedWriteOperation::Delete, RuntimeDmlAction::Delete)
            | (ProtectedWriteOperation::Update(_), RuntimeDmlAction::Update)
    ) || (dynamic_membership && matches!(expected, ProtectedWriteOperation::DynamicMembership))
}

fn authorize_trigger(
    cell: &AuthorizerPermitCell,
    table_name: &str,
    trigger_name: &str,
    create: bool,
) -> Authorization {
    let Some(active) = live_active(cell) else {
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
    let Some(active) = live_active(cell) else {
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
    let allowed = live_active(cell).is_some_and(|active| {
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

impl Drop for AuthorityWritePermit<'_, '_> {
    fn drop(&mut self) {
        let mut expire_statements = true;
        if let Ok(mut cell) = self.transaction.authorizer_permit_cell.lock() {
            let owns_active = cell.active.as_ref().is_some_and(|active| {
                active.connection_epoch == self.transaction.connection_epoch
                    && active.nonce == self.nonce
                    && active.mutation == self.mutation
                    && active.successor_digest == self.successor_digest
            });
            if owns_active {
                cell.active = None;
            } else {
                expire_statements = false;
            }
        }
        if expire_statements {
            // sqlite3_set_authorizer expires every prepared statement on this
            // connection. A live Statement prepared under this permit must
            // therefore reprepare after Drop and observe the now-inactive cell.
            let _ = install_authorizer(
                self._sqlite_transaction,
                Arc::clone(&self.transaction.authorizer_permit_cell),
            );
        }
    }
}
