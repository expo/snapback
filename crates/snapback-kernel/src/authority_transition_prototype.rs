//! Throwaway compiled prototype for the LLP 0293 authority-transition shape.
//!
//! This is evidence, not implementation. It deliberately uses a tiny schema
//! and omits product semantics while retaining the real Rust visibility,
//! ownership, rusqlite transaction, authorizer, and move-only shapes.
//!
//! @ref LLP 0292#4-ideal-end-state — the kernel derives exact operations and
//!   owns transactional revalidation; callers do not submit authority.
//! @ref LLP 0283#method-lessons-worth-keeping — inherent implementations must
//!   remain in the crate defining their receiver type.

#![allow(dead_code)]

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::marker::PhantomData;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

const AUTHORITY_TABLE: &str = "_prototype_authority";
const MEMBERSHIP_TABLE: &str = "_prototype_membership_alpha";
const MEMBERSHIP_REGISTRY_TABLE: &str = "_prototype_membership_registry";
const DELIVERY_TABLE: &str = "_prototype_delivery_receipts";
const CRON_TABLE: &str = "_prototype_cron_due";
const SECRET_RECEIPT_TABLE: &str = "_prototype_secret_receipts";

pub struct QueryKind;
pub struct DeliveryKind;
pub struct CronKind;

/// Publicly nameable and movable, but neither constructible nor cloneable.
/// The exact `Kind` specialization owns its consuming operation.
pub struct PreparedOperation<Kind> {
    operation_id: String,
    target: String,
    predecessor_digest: [u8; 32],
    _kind: PhantomData<Kind>,
}

impl PreparedOperation<QueryKind> {
    pub fn execute_query(self) -> (String, String) {
        (self.operation_id, self.target)
    }
}

impl PreparedOperation<DeliveryKind> {
    pub fn finish_delivery(self) -> (String, String) {
        (self.operation_id, self.target)
    }
}

impl PreparedOperation<CronKind> {
    pub fn execute_cron(self) -> (String, String) {
        (self.operation_id, self.target)
    }
}

/// Untrusted delivery material crossing from an adapter into the kernel.
/// It is not evidence; the durable receipt is reloaded and authenticated in
/// the transaction that consumes it.
pub struct PresentedDeliveryArtifact<'a> {
    pub challenge_id: &'a str,
    pub provider_event_id: &'a str,
    pub authenticator: &'a [u8],
}

/// Untrusted provider material. The private computation result never crosses
/// the kernel boundary and is re-bound to durable rows in the transaction.
pub struct PresentedProviderArtifact<'a> {
    pub subject: &'a str,
    pub signed_bytes: &'a [u8],
}

/// Raw generated secret is not evidence and carries no authority plan.
pub struct GeneratedSecret(String);

impl GeneratedSecret {
    pub fn expose_for_delivery(self) -> String {
        self.0
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum AuthorityPurpose {
    Query,
    Delivery,
    Cron,
    SecretIssue,
}

/// The selected evidence shape is deliberately `!Send + !Sync` and move-only.
struct KernelVerifiedEvidence {
    database_identity: u64,
    transaction_epoch: u64,
    single_use_nonce: u64,
    purpose: AuthorityPurpose,
    predecessor_digest: [u8; 32],
    write_set: BTreeSet<String>,
    successor_digest: [u8; 32],
    _not_send_sync: PhantomData<Rc<()>>,
}

struct SnapshotBoundComputation {
    predecessor_digest: [u8; 32],
}

#[derive(Clone)]
struct ConnectionPermitCell {
    inner: Arc<Mutex<PermitState>>,
    next_epoch: Arc<AtomicU64>,
    next_nonce: Arc<AtomicU64>,
}

#[derive(Default)]
struct PermitState {
    protected_tables: BTreeSet<String>,
    dynamic_membership_tables: BTreeSet<String>,
    registered_nonces: BTreeSet<(u64, u64)>,
    active: Option<ActivePermit>,
}

struct ActivePermit {
    epoch: u64,
    nonce: u64,
    write_set: BTreeSet<String>,
}

impl ConnectionPermitCell {
    fn new() -> Self {
        let protected_tables = [
            AUTHORITY_TABLE,
            DELIVERY_TABLE,
            CRON_TABLE,
            SECRET_RECEIPT_TABLE,
        ]
        .into_iter()
        .map(str::to_owned)
        .collect();
        Self {
            inner: Arc::new(Mutex::new(PermitState {
                protected_tables,
                ..PermitState::default()
            })),
            next_epoch: Arc::new(AtomicU64::new(1)),
            next_nonce: Arc::new(AtomicU64::new(1)),
        }
    }

    fn install(&self, connection: &Connection) {
        connection.set_prepared_statement_cache_capacity(0);
        let inner = Arc::clone(&self.inner);
        connection.authorizer(Some(move |context: AuthContext<'_>| {
            authorize(&inner, context)
        }));
    }

    fn allocate_epoch_nonce(&self) -> rusqlite::Result<(u64, u64)> {
        let epoch = self.next_epoch.fetch_add(1, Ordering::Relaxed);
        let nonce = self.next_nonce.fetch_add(1, Ordering::Relaxed);
        if epoch == 0 || nonce == 0 {
            return Err(rusqlite::Error::InvalidQuery);
        }
        self.lock()?.registered_nonces.insert((epoch, nonce));
        Ok((epoch, nonce))
    }

    fn replace_dynamic_membership(
        &self,
        tables: impl IntoIterator<Item = String>,
    ) -> rusqlite::Result<()> {
        self.lock()?.dynamic_membership_tables = tables.into_iter().collect();
        Ok(())
    }

    fn consume(&self, evidence: KernelVerifiedEvidence) -> rusqlite::Result<AuthorityWritePermit> {
        let mut state = self.lock()?;
        if evidence.database_identity == 0
            || !state
                .registered_nonces
                .remove(&(evidence.transaction_epoch, evidence.single_use_nonce))
            || state.active.is_some()
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        state.active = Some(ActivePermit {
            epoch: evidence.transaction_epoch,
            nonce: evidence.single_use_nonce,
            write_set: evidence.write_set,
        });
        drop(state);
        Ok(AuthorityWritePermit {
            inner: Arc::clone(&self.inner),
            epoch: evidence.transaction_epoch,
            nonce: evidence.single_use_nonce,
        })
    }

    fn lock(&self) -> rusqlite::Result<MutexGuard<'_, PermitState>> {
        self.inner.lock().map_err(|_| rusqlite::Error::InvalidQuery)
    }
}

struct AuthorityWritePermit {
    inner: Arc<Mutex<PermitState>>,
    epoch: u64,
    nonce: u64,
}

impl Drop for AuthorityWritePermit {
    fn drop(&mut self) {
        let Ok(mut state) = self.inner.lock() else {
            return;
        };
        if state
            .active
            .as_ref()
            .is_some_and(|active| active.epoch == self.epoch && active.nonce == self.nonce)
        {
            state.active = None;
        }
    }
}

fn authorize(inner: &Arc<Mutex<PermitState>>, context: AuthContext<'_>) -> Authorization {
    let Ok(state) = inner.lock() else {
        return Authorization::Deny;
    };
    let table = match context.action {
        AuthAction::Insert { table_name }
        | AuthAction::Delete { table_name }
        | AuthAction::Update { table_name, .. } => Some(table_name),
        _ => None,
    };
    let Some(table) = table else {
        return Authorization::Allow;
    };
    let protected =
        state.protected_tables.contains(table) || state.dynamic_membership_tables.contains(table);
    if !protected {
        return Authorization::Allow;
    }
    if context.accessor.is_none()
        && state
            .active
            .as_ref()
            .is_some_and(|permit| permit.write_set.contains(table))
    {
        Authorization::Allow
    } else {
        Authorization::Deny
    }
}

pub struct PrototypeAuthorityStore {
    connection: Connection,
    permit_cell: ConnectionPermitCell,
    database_identity: u64,
}

impl PrototypeAuthorityStore {
    pub fn memory() -> rusqlite::Result<Self> {
        let connection = Connection::open_in_memory()?;
        let permit_cell = ConnectionPermitCell::new();
        permit_cell.install(&connection);
        connection.execute_batch(&format!(
            "CREATE TABLE {AUTHORITY_TABLE}(operation_id TEXT PRIMARY KEY, target TEXT NOT NULL);
             CREATE TABLE {MEMBERSHIP_REGISTRY_TABLE}(table_name TEXT PRIMARY KEY);
             CREATE TABLE {MEMBERSHIP_TABLE}(operation_id TEXT PRIMARY KEY, member TEXT NOT NULL);
             CREATE TABLE {DELIVERY_TABLE}(
                 challenge_id TEXT PRIMARY KEY,
                 provider_event_id TEXT NOT NULL,
                 authenticator_digest BLOB NOT NULL,
                 consumed INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE {CRON_TABLE}(
                 work_id TEXT PRIMARY KEY,
                 due_ms INTEGER NOT NULL,
                 claim_generation INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE {SECRET_RECEIPT_TABLE}(
                 operation_id TEXT PRIMARY KEY,
                 secret_digest BLOB NOT NULL
             );
             INSERT INTO {MEMBERSHIP_REGISTRY_TABLE}(table_name) VALUES('{MEMBERSHIP_TABLE}');"
        ))?;
        Ok(Self {
            connection,
            permit_cell,
            database_identity: 1,
        })
    }

    /// A complete positive borrow probe: private computation happens first;
    /// then `Transaction<'_>` borrows only `connection`, while the installed
    /// authorizer, epoch/nonce registry, and dynamic schema mutate through an
    /// independently-owned connection-local cell.
    pub fn prepare_query(
        &mut self,
        operation_id: &str,
        target: &str,
    ) -> rusqlite::Result<PreparedOperation<QueryKind>> {
        let computation = compute_provider_artifact(PresentedProviderArtifact {
            subject: target,
            signed_bytes: operation_id.as_bytes(),
        });
        let permit_cell = self.permit_cell.clone();
        let database_identity = self.database_identity;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        install_dynamic_membership_from_transaction(&transaction, &permit_cell)?;
        let write_set = [AUTHORITY_TABLE.to_owned(), MEMBERSHIP_TABLE.to_owned()]
            .into_iter()
            .collect();
        let evidence = mint_evidence(
            &permit_cell,
            database_identity,
            AuthorityPurpose::Query,
            computation.predecessor_digest,
            write_set,
            operation_id,
            target,
        )?;
        let predecessor_digest = evidence.predecessor_digest;
        let permit = permit_cell.consume(evidence)?;
        durable_writer::write_query(&transaction, operation_id, target)?;
        let prepared = PreparedOperation {
            operation_id: operation_id.to_owned(),
            target: target.to_owned(),
            predecessor_digest,
            _kind: PhantomData,
        };
        transaction.commit()?;
        drop(permit);
        Ok(prepared)
    }

    /// The adapter crosses the DAG with raw cryptographic material; the
    /// kernel reloads and consumes its durable authenticated handoff receipt.
    pub fn consume_delivery(
        &mut self,
        artifact: PresentedDeliveryArtifact<'_>,
    ) -> rusqlite::Result<PreparedOperation<DeliveryKind>> {
        let permit_cell = self.permit_cell.clone();
        let database_identity = self.database_identity;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let expected: Option<(String, Vec<u8>, i64)> = transaction
            .query_row(
                &format!(
                    "SELECT provider_event_id, authenticator_digest, consumed
                     FROM {DELIVERY_TABLE} WHERE challenge_id = ?1"
                ),
                [artifact.challenge_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let expected = expected.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        let actual = Sha256::digest(artifact.authenticator).to_vec();
        if expected.0 != artifact.provider_event_id || expected.1 != actual || expected.2 != 0 {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let predecessor_digest = digest_parts(&[
            artifact.challenge_id.as_bytes(),
            artifact.provider_event_id.as_bytes(),
            &actual,
        ]);
        let write_set = [DELIVERY_TABLE.to_owned()].into_iter().collect();
        let evidence = mint_evidence(
            &permit_cell,
            database_identity,
            AuthorityPurpose::Delivery,
            predecessor_digest,
            write_set,
            artifact.challenge_id,
            artifact.provider_event_id,
        )?;
        let permit = permit_cell.consume(evidence)?;
        durable_writer::consume_delivery(&transaction, artifact.challenge_id)?;
        let prepared = PreparedOperation {
            operation_id: artifact.challenge_id.to_owned(),
            target: artifact.provider_event_id.to_owned(),
            predecessor_digest,
            _kind: PhantomData,
        };
        transaction.commit()?;
        drop(permit);
        Ok(prepared)
    }

    /// Cron uses a real due row and a compare-and-swap generation. This probe
    /// intentionally selects LLP 0293's "new durable due/claim row" option.
    pub fn claim_due_cron(
        &mut self,
        work_id: &str,
        now_ms: u64,
    ) -> rusqlite::Result<PreparedOperation<CronKind>> {
        let permit_cell = self.permit_cell.clone();
        let database_identity = self.database_identity;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (due_ms, generation): (u64, u64) = transaction.query_row(
            &format!("SELECT due_ms, claim_generation FROM {CRON_TABLE} WHERE work_id = ?1"),
            [work_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        if due_ms > now_ms {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let predecessor_digest = digest_parts(&[
            work_id.as_bytes(),
            &due_ms.to_le_bytes(),
            &generation.to_le_bytes(),
        ]);
        let write_set = [CRON_TABLE.to_owned()].into_iter().collect();
        let evidence = mint_evidence(
            &permit_cell,
            database_identity,
            AuthorityPurpose::Cron,
            predecessor_digest,
            write_set,
            work_id,
            "cron",
        )?;
        let permit = permit_cell.consume(evidence)?;
        durable_writer::claim_cron(&transaction, work_id, generation)?;
        let prepared = PreparedOperation {
            operation_id: work_id.to_owned(),
            target: "cron".to_owned(),
            predecessor_digest,
            _kind: PhantomData,
        };
        transaction.commit()?;
        drop(permit);
        Ok(prepared)
    }

    /// Retain only the raw generated secret and a powerless idempotency key
    /// across commit. Reconciliation reloads a durable digest; it retains no
    /// evidence and no authority-bearing mutation plan.
    pub fn issue_generated_secret(
        &mut self,
        operation_id: &str,
    ) -> rusqlite::Result<GeneratedSecret> {
        let secret = GeneratedSecret(format!("secret-{operation_id}"));
        let digest = Sha256::digest(secret.0.as_bytes()).to_vec();
        let permit_cell = self.permit_cell.clone();
        let database_identity = self.database_identity;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let predecessor_digest = digest_parts(&[operation_id.as_bytes(), &digest]);
        let evidence = mint_evidence(
            &permit_cell,
            database_identity,
            AuthorityPurpose::SecretIssue,
            predecessor_digest,
            [SECRET_RECEIPT_TABLE.to_owned()].into_iter().collect(),
            operation_id,
            "generated-secret",
        )?;
        let permit = permit_cell.consume(evidence)?;
        durable_writer::write_secret_receipt(&transaction, operation_id, &digest)?;
        transaction.commit()?;
        drop(permit);
        reconcile_generated_secret(&self.connection, operation_id, secret)
    }

    #[cfg(test)]
    fn seed_delivery_receipt(
        &mut self,
        challenge_id: &str,
        provider_event_id: &str,
        authenticator: &[u8],
    ) -> rusqlite::Result<()> {
        let permit_cell = self.permit_cell.clone();
        let transaction = self.connection.transaction()?;
        let digest = Sha256::digest(authenticator).to_vec();
        let evidence = mint_evidence(
            &permit_cell,
            self.database_identity,
            AuthorityPurpose::Delivery,
            digest_parts(&[
                challenge_id.as_bytes(),
                provider_event_id.as_bytes(),
                &digest,
            ]),
            [DELIVERY_TABLE.to_owned()].into_iter().collect(),
            challenge_id,
            provider_event_id,
        )?;
        let permit = permit_cell.consume(evidence)?;
        durable_writer::seed_delivery(&transaction, challenge_id, provider_event_id, &digest)?;
        transaction.commit()?;
        drop(permit);
        Ok(())
    }

    #[cfg(test)]
    fn seed_cron(&mut self, work_id: &str, due_ms: u64) -> rusqlite::Result<()> {
        let permit_cell = self.permit_cell.clone();
        let transaction = self.connection.transaction()?;
        let evidence = mint_evidence(
            &permit_cell,
            self.database_identity,
            AuthorityPurpose::Cron,
            digest_parts(&[work_id.as_bytes(), &due_ms.to_le_bytes()]),
            [CRON_TABLE.to_owned()].into_iter().collect(),
            work_id,
            "seed-cron",
        )?;
        let permit = permit_cell.consume(evidence)?;
        durable_writer::seed_cron(&transaction, work_id, due_ms)?;
        transaction.commit()?;
        drop(permit);
        Ok(())
    }

    #[cfg(feature = "authority-prototype-negative-borrow")]
    fn refresh_dynamic_membership_through_owner(
        &mut self,
        transaction: &Transaction<'_>,
    ) -> rusqlite::Result<()> {
        install_dynamic_membership_from_transaction(transaction, &self.permit_cell)
    }
}

fn compute_provider_artifact(artifact: PresentedProviderArtifact<'_>) -> SnapshotBoundComputation {
    SnapshotBoundComputation {
        predecessor_digest: digest_parts(&[artifact.subject.as_bytes(), artifact.signed_bytes]),
    }
}

fn install_dynamic_membership_from_transaction(
    transaction: &Transaction<'_>,
    permit_cell: &ConnectionPermitCell,
) -> rusqlite::Result<()> {
    let mut statement = transaction.prepare(&format!(
        "SELECT table_name FROM {MEMBERSHIP_REGISTRY_TABLE} ORDER BY table_name"
    ))?;
    let tables = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    permit_cell.replace_dynamic_membership(tables)
}

fn mint_evidence(
    permit_cell: &ConnectionPermitCell,
    database_identity: u64,
    purpose: AuthorityPurpose,
    predecessor_digest: [u8; 32],
    write_set: BTreeSet<String>,
    operation_id: &str,
    target: &str,
) -> rusqlite::Result<KernelVerifiedEvidence> {
    let (transaction_epoch, single_use_nonce) = permit_cell.allocate_epoch_nonce()?;
    Ok(KernelVerifiedEvidence {
        database_identity,
        transaction_epoch,
        single_use_nonce,
        purpose,
        predecessor_digest,
        successor_digest: digest_parts(&[
            operation_id.as_bytes(),
            target.as_bytes(),
            &predecessor_digest,
        ]),
        write_set,
        _not_send_sync: PhantomData,
    })
}

fn digest_parts(parts: &[&[u8]]) -> [u8; 32] {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u64).to_le_bytes());
        hash.update(part);
    }
    hash.finalize().into()
}

fn reconcile_generated_secret(
    connection: &Connection,
    operation_id: &str,
    secret: GeneratedSecret,
) -> rusqlite::Result<GeneratedSecret> {
    let stored: Vec<u8> = connection.query_row(
        &format!("SELECT secret_digest FROM {SECRET_RECEIPT_TABLE} WHERE operation_id = ?1"),
        [operation_id],
        |row| row.get(0),
    )?;
    if stored == Sha256::digest(secret.0.as_bytes()).as_slice() {
        Ok(secret)
    } else {
        Err(rusqlite::Error::InvalidQuery)
    }
}

/// Protected SQL is physically nested under the parent and exposed only with
/// legal `pub(super)` visibility.
mod durable_writer {
    use super::*;

    pub(super) fn write_query(
        transaction: &Transaction<'_>,
        operation_id: &str,
        target: &str,
    ) -> rusqlite::Result<()> {
        let mut authority = transaction.prepare(&format!(
            "INSERT INTO {AUTHORITY_TABLE}(operation_id, target) VALUES(?1, ?2)"
        ))?;
        authority.execute(params![operation_id, target])?;
        drop(authority);
        let mut membership = transaction.prepare(&format!(
            "INSERT INTO {MEMBERSHIP_TABLE}(operation_id, member) VALUES(?1, ?2)"
        ))?;
        membership.execute(params![operation_id, target])?;
        Ok(())
    }

    pub(super) fn seed_delivery(
        transaction: &Transaction<'_>,
        challenge_id: &str,
        provider_event_id: &str,
        digest: &[u8],
    ) -> rusqlite::Result<()> {
        transaction.execute(
            &format!(
                "INSERT INTO {DELIVERY_TABLE}
                 (challenge_id, provider_event_id, authenticator_digest)
                 VALUES(?1, ?2, ?3)"
            ),
            params![challenge_id, provider_event_id, digest],
        )?;
        Ok(())
    }

    pub(super) fn consume_delivery(
        transaction: &Transaction<'_>,
        challenge_id: &str,
    ) -> rusqlite::Result<()> {
        let changed = transaction.execute(
            &format!(
                "UPDATE {DELIVERY_TABLE} SET consumed = 1
                 WHERE challenge_id = ?1 AND consumed = 0"
            ),
            [challenge_id],
        )?;
        if changed == 1 {
            Ok(())
        } else {
            Err(rusqlite::Error::InvalidQuery)
        }
    }

    pub(super) fn seed_cron(
        transaction: &Transaction<'_>,
        work_id: &str,
        due_ms: u64,
    ) -> rusqlite::Result<()> {
        transaction.execute(
            &format!("INSERT INTO {CRON_TABLE}(work_id, due_ms) VALUES(?1, ?2)"),
            params![work_id, due_ms],
        )?;
        Ok(())
    }

    pub(super) fn claim_cron(
        transaction: &Transaction<'_>,
        work_id: &str,
        generation: u64,
    ) -> rusqlite::Result<()> {
        let changed = transaction.execute(
            &format!(
                "UPDATE {CRON_TABLE} SET claim_generation = claim_generation + 1
                 WHERE work_id = ?1 AND claim_generation = ?2"
            ),
            params![work_id, generation],
        )?;
        if changed == 1 {
            Ok(())
        } else {
            Err(rusqlite::Error::InvalidQuery)
        }
    }

    pub(super) fn write_secret_receipt(
        transaction: &Transaction<'_>,
        operation_id: &str,
        digest: &[u8],
    ) -> rusqlite::Result<()> {
        transaction.execute(
            &format!(
                "INSERT INTO {SECRET_RECEIPT_TABLE}(operation_id, secret_digest)
                 VALUES(?1, ?2)"
            ),
            params![operation_id, digest],
        )?;
        Ok(())
    }
}

/// Language-level proof of the selected ownership layout: the receiver is
/// defined in the parent owner module; the authority child hosts its inherent
/// impl and can access parent-private state; its writer child exposes only
/// `pub(super)` back to the authority parent.
mod selected_nested_layout {
    struct Owner {
        hidden_state: u64,
    }

    mod authority_transition {
        use super::Owner;

        impl Owner {
            pub(super) fn commit_transition(&mut self) {
                writer::write(self);
            }
        }

        mod writer {
            use super::Owner;

            pub(super) fn write(owner: &mut Owner) {
                owner.hidden_state += 1;
            }
        }
    }

    pub(super) fn compile_witness() -> u64 {
        let mut owner = Owner { hidden_state: 0 };
        owner.commit_transition();
        owner.hidden_state
    }
}

#[cfg(feature = "authority-prototype-negative-borrow")]
pub fn negative_naive_owner_borrow(store: &mut PrototypeAuthorityStore) -> rusqlite::Result<()> {
    let transaction = store.connection.transaction()?;
    store.refresh_dynamic_membership_through_owner(&transaction)?;
    transaction.commit()
}

#[cfg(feature = "authority-prototype-negative-http-extension")]
pub fn negative_http_extension_requires_clone(operation: PreparedOperation<QueryKind>) {
    let mut extensions = http::Extensions::new();
    extensions.insert(operation);
}

#[cfg(feature = "authority-prototype-negative-sibling-visibility")]
mod negative_illegal_sibling_visibility {
    mod authority_transition {}

    mod sibling_writer {
        pub(in super::authority_transition) fn write() {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn authorization_denied(error: &rusqlite::Error) -> bool {
        matches!(
            error,
            rusqlite::Error::SqliteFailure(inner, _)
                if inner.code == rusqlite::ErrorCode::AuthorizationForStatementDenied
        )
    }

    #[test]
    fn transaction_authorizer_epoch_nonce_dynamic_schema_and_statements_coexist() {
        let mut store = PrototypeAuthorityStore::memory().unwrap();
        let operation = store.prepare_query("operation-1", "member-1").unwrap();
        assert_eq!(
            operation.execute_query(),
            ("operation-1".to_owned(), "member-1".to_owned())
        );

        let error = store
            .connection
            .execute(
                &format!(
                    "INSERT INTO {AUTHORITY_TABLE}(operation_id, target) VALUES('forged', 'x')"
                ),
                [],
            )
            .unwrap_err();
        assert!(authorization_denied(&error), "{error:?}");

        let error = store
            .connection
            .execute(
                &format!(
                    "INSERT INTO {MEMBERSHIP_TABLE}(operation_id, member) VALUES('forged', 'x')"
                ),
                [],
            )
            .unwrap_err();
        assert!(authorization_denied(&error), "{error:?}");
    }

    #[test]
    fn durable_delivery_receipt_crosses_without_a_public_claim() {
        let mut store = PrototypeAuthorityStore::memory().unwrap();
        store
            .seed_delivery_receipt("challenge-1", "event-1", b"provider-mac")
            .unwrap();
        let operation = store
            .consume_delivery(PresentedDeliveryArtifact {
                challenge_id: "challenge-1",
                provider_event_id: "event-1",
                authenticator: b"provider-mac",
            })
            .unwrap();
        assert_eq!(
            operation.finish_delivery(),
            ("challenge-1".to_owned(), "event-1".to_owned())
        );
    }

    #[test]
    fn cron_uses_a_durable_due_claim_row() {
        let mut store = PrototypeAuthorityStore::memory().unwrap();
        store.seed_cron("cron-1", 10).unwrap();
        let operation = store.claim_due_cron("cron-1", 10).unwrap();
        assert_eq!(
            operation.execute_cron(),
            ("cron-1".to_owned(), "cron".to_owned())
        );
    }

    #[test]
    fn generated_secret_reconciles_without_evidence_or_plan() {
        let mut store = PrototypeAuthorityStore::memory().unwrap();
        let secret = store.issue_generated_secret("issue-1").unwrap();
        assert_eq!(secret.expose_for_delivery(), "secret-issue-1");
    }

    #[test]
    fn nested_layout_and_move_only_send_shape_compile() {
        fn assert_send_static<T: Send + 'static>() {}
        fn assert_send_future<T: std::future::Future + Send>(_: &T) {}
        assert_send_static::<PreparedOperation<QueryKind>>();
        assert_eq!(selected_nested_layout::compile_witness(), 1);

        let mut store = PrototypeAuthorityStore::memory().unwrap();
        let asynchronous = store
            .prepare_query("async-operation", "query-target")
            .unwrap();
        let future = async move { asynchronous.execute_query() };
        assert_send_future(&future);
        drop(future);

        let detached = store
            .prepare_query("detached-operation", "thread-target")
            .unwrap();
        let result = std::thread::spawn(move || detached.execute_query())
            .join()
            .unwrap();
        assert_eq!(
            result,
            ("detached-operation".to_owned(), "thread-target".to_owned())
        );
    }
}
