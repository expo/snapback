use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::ephemeral::{validate_collection_definitions, validate_collection_permission_backing};
use crate::manifest::{
    AuthInput, CLIENT_MUTATION_ACK_MAX_IDS, CTX_ANSWER_LEDGER_MAX_IDS, CTX_ANSWER_LEDGER_VERSION,
    CtxAnswerLedger, FieldManifest, FieldType, FilterOp, HandlerInput, MembershipManifest,
    MembershipOp, MembershipProvenance, MembershipScope, MembershipTarget, MutationOutput,
    MutationPlan, MutationStep,
    OrderDirection, QUERY_INTERNAL_OVERFETCH_MAX, QUERY_MAX_FILTER_BINDINGS, QUERY_MAX_IN_ITEMS,
    QueryOutput, QueryPlan, ReadDependency, ReturnValue, SchemaManifest, SeedData, TableManifest,
    ValueExpr, auth_fingerprint, effective_query_limit, replay_opaque_id_is_valid,
    validate_ctx_answer_ledger, validate_portable_timestamp_millis, validate_query_plan_shape,
};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{
    Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior, params,
    params_from_iter,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value, json};
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

// The item-3 provider integration consumes these crate-private seams after this
// catalog lane lands; keep the catalog module narrow without making unfinished
// provider routes part of the public storage API in this commit.
#[allow(dead_code)]
#[path = "storage/auth.rs"]
pub(crate) mod auth;

// @ref LLP 0055#principal-kinds — agent-principal ownership and durable
//   deactivation live in their own module beneath the auth catalog. Grant/token
//   lifecycle (G3/G4) is not wired yet, so the storage methods are dead until
//   the routes land.
#[allow(dead_code)]
#[path = "storage/auth_agents.rs"]
pub(crate) mod auth_agents;

// @ref LLP 0055#credentials-and-tokens — credential rotation, time-only family
//   tombstones, revoke-self, and scoped-token mint/validation live below the
//   protected auth catalog rather than the app-data mutation surface.
#[allow(dead_code)]
#[path = "storage/auth_agent_credentials.rs"]
pub(crate) mod auth_agent_credentials;

// @ref LLP 0055#grants — immutable exact-function scopes bind a durable basis
//   generation; removal and authority-significant manifest changes leave
//   tombstones so old consent cannot revive after re-add or restart.
#[allow(dead_code)]
#[path = "storage/auth_scope_bases.rs"]
pub(crate) mod auth_scope_bases;

// @ref LLP 0055#grants — pairing-code consent and immutable delegated grants
//   are one protected-catalog lifecycle, with concrete scope bases captured at
//   consent and no silent cap eviction.
#[allow(dead_code)]
#[path = "storage/auth_grants.rs"]
pub(crate) mod auth_grants;

#[allow(dead_code)]
#[path = "storage/auth_rescue.rs"]
pub(crate) mod auth_rescue;

#[path = "storage/auth_mode.rs"]
pub(crate) mod auth_mode;

#[path = "storage/authorization.rs"]
pub(crate) mod authorization;

#[path = "storage/auth_invalidation.rs"]
pub(crate) mod auth_invalidation;

#[path = "storage/authorized_lease.rs"]
pub(crate) mod authorized_lease;

#[allow(dead_code)] // Called by the ENG-24603 pre-bind/coordinator integration lane.
#[path = "storage/auth_stream.rs"]
pub(crate) mod auth_stream;

#[cfg(test)]
type ResetCommitHook = Box<dyn FnOnce() -> SnapbackResult<()>>;

#[cfg(test)]
thread_local! {
    /// Deterministic failure injection immediately before reset+seed commit.
    /// Thread-local keeps parallel tests from perturbing unrelated databases.
    static BEFORE_RESET_COMMIT_HOOK: std::cell::RefCell<Option<ResetCommitHook>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AuthorizationCommitFaultForTest {
    BeforeCommit,
    AfterRollback,
    AfterCommit,
}

#[cfg(test)]
thread_local! {
    /// One-shot generic authorization-COMMIT fault. `AfterRollback` and
    /// `AfterCommit` force exact durable predecessor/successor reconciliation.
    static AUTHORIZATION_COMMIT_FAULT: std::cell::Cell<Option<AuthorizationCommitFaultForTest>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(test)]
pub(crate) fn inject_authorization_commit_fault_for_test(fault: AuthorizationCommitFaultForTest) {
    AUTHORIZATION_COMMIT_FAULT.with(|slot| {
        assert!(
            slot.get().is_none(),
            "authorization commit fault must be one-shot"
        );
        slot.set(Some(fault));
    });
}

#[cfg(test)]
pub(crate) fn inject_reset_commit_failure_for_test() {
    BEFORE_RESET_COMMIT_HOOK.with(|slot| {
        assert!(slot.borrow().is_none(), "reset hook must be one-shot");
        *slot.borrow_mut() = Some(Box::new(|| {
            Err(SnapbackError::error(
                "SNAPBACK_ACTION_TIMEOUT",
                "storage",
                "injected reset commit-boundary failure",
            ))
        }));
    });
}

const META_SCHEMA_MANIFEST: &str = "schema_manifest";
const META_CRON_STATE: &str = "cron_state";
// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3 monotonic replay floor:
// the highest change version
// that pruning has removed. A resume from at/above it is guaranteed replayable;
// below it, a change may be gone, so the client must resnapshot.
const META_RETENTION_FLOOR: &str = "retention_floor";
const META_CLIENT_MUTATION_GC_TOTAL: &str = "client_mutation_gc_total";
const META_CLIENT_MUTATION_RECORDS: &str = "client_mutation_records";
const META_CLIENT_MUTATION_BYTES: &str = "client_mutation_bytes";
const META_CLIENT_MUTATION_COUNTERS_VERSION: &str = "client_mutation_counters_version";
const CLIENT_MUTATION_COUNTERS_VERSION: u64 = 3;
const TEST_CLIENT_MUTATION_AUTHORITY_INSTANCE_ID: &str = "018f0d90-7b24-7a22-8c33-445566778899";
/// A hard availability bound, deliberately equal to the existing journal
/// version budget. We refuse a new durable identity instead of evicting an
/// unacknowledged result and risking duplicate execution after response loss.
pub const CLIENT_MUTATION_MAX_RECORDS: u64 = 10_000;
/// One retained output is bounded by the portable mutation-plan artifact
/// budget; the aggregate is 1,024 such maximum outputs, matching the bounded
/// replay-ledger/runtime lane. Both are hard refusal limits, never eviction.
pub const CLIENT_MUTATION_MAX_RESULT_BYTES: u64 =
    crate::value_expr::MAX_PLAN_SERIALIZED_BYTES as u64;
pub const CLIENT_MUTATION_MAX_BYTES: u64 = 1_024 * CLIENT_MUTATION_MAX_RESULT_BYTES;
/// One auth context cannot monopolize the global exactly-once ledger. This is
/// deliberately smaller than the global record cap while still allowing a
/// large disconnected queue for one principal.
pub const CLIENT_MUTATION_MAX_RECORDS_PER_AUTH: u64 = 1_024;
/// Per-auth retained results are capped at 128 maximum-sized outputs (8 MiB).
pub const CLIENT_MUTATION_MAX_BYTES_PER_AUTH: u64 = 128 * CLIENT_MUTATION_MAX_RESULT_BYTES;

#[derive(Clone, Copy)]
struct ClientMutationRetentionLimits {
    records: u64,
    bytes: u64,
    records_per_auth: u64,
    bytes_per_auth: u64,
}

#[cfg(test)]
thread_local! {
    /// Small deterministic limits let unit tests exercise N+1 admission
    /// without constructing a 10,000-row / 64-MiB ledger. The override is
    /// thread-local so parallel tests and production behavior are unchanged.
    static CLIENT_MUTATION_TEST_LIMITS: std::cell::Cell<Option<ClientMutationRetentionLimits>> =
        const { std::cell::Cell::new(None) };
}

fn client_mutation_retention_limits() -> ClientMutationRetentionLimits {
    #[cfg(test)]
    if let Some(limits) = CLIENT_MUTATION_TEST_LIMITS.with(std::cell::Cell::get) {
        return limits;
    }
    ClientMutationRetentionLimits {
        records: CLIENT_MUTATION_MAX_RECORDS,
        bytes: CLIENT_MUTATION_MAX_BYTES,
        records_per_auth: CLIENT_MUTATION_MAX_RECORDS_PER_AUTH,
        bytes_per_auth: CLIENT_MUTATION_MAX_BYTES_PER_AUTH,
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClientMutationRetentionInfo {
    pub records: u64,
    pub bytes: u64,
    pub gc_total: u64,
    pub max_records: u64,
    pub max_bytes: u64,
    pub max_result_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct StorageInfo {
    #[serde(rename = "sqlitePath", alias = "sqlite_path")]
    pub sqlite_path: Option<PathBuf>,
    pub version: u64,
    pub tables: Vec<String>,
    #[serde(rename = "clientMutationRetention")]
    pub client_mutation_retention: ClientMutationRetentionInfo,
}

/// A page of rows read through the schema-aware storage layer for the admin
/// data explorer.
///
/// @ref LLP 0017#durable-data-exploration-and-edits — exploration reads go
/// through schema-aware storage and expose system fields, never raw SQLite
/// physical details.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TableScan {
    pub table: String,
    /// Stable display order: `_id`, declared fields, then system timestamps.
    pub columns: Vec<String>,
    pub rows: Vec<Value>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum ChangeOp {
    Insert,
    Update,
    Delete,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ChangedRow {
    pub table: String,
    pub id: String,
    pub op: ChangeOp,
    pub row: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changed_fields: Vec<String>,
}

/// The one durable authorization-stream witness. The incarnation closes reset
/// and restore ABA; the JS-safe epoch advances for ordinary authorization
/// events within that stream.
///
/// @ref LLP 0053#the-authorization-version — v1 has one global durable pair.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationVersion {
    pub incarnation: String,
    #[schemars(range(max = MAX_AUTHORIZATION_EPOCH))]
    pub epoch: u64,
}

/// JavaScript's largest exactly representable integer. The durable epoch
/// refuses at this boundary rather than wrapping or losing wire precision.
pub const MAX_AUTHORIZATION_EPOCH: u64 = 9_007_199_254_740_991;

/// Exact authorization state produced inside a caller-owned commit. `event`
/// is false for an ordinary/disjoint app commit, while `incarnation_rotated`
/// distinguishes destructive boundaries from epoch advances.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationCommitWitness {
    pub version: AuthorizationVersion,
    pub event: bool,
    pub incarnation_rotated: bool,
    /// Stable LLP 0056 declaration ids whose writes contributed to this event.
    /// Empty for non-membership events and ordinary commits. The durable
    /// authorization version remains the one global pair LLP 0053 pins; this
    /// attribution exists for per-declaration blast-radius measurement.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub membership_declarations: Vec<String>,
}

/// Process-local impact metadata for the protected-room commit interlock.
///
/// The durable authorization version intentionally remains one global pair,
/// but an app-data event can still carry enough transaction-local facts to
/// keep unrelated protected rooms live. Activation and destructive boundaries
/// have no safe row selector and therefore conservatively target every room.
///
/// @ref LLP 0053#ephemeral-room-authority-invalidation — writers prepare a
///   dependency selector before commit instead of globally suspending rooms.
#[derive(Clone, Copy, Debug)]
pub(crate) enum AuthorizationCommitImpact<'a> {
    AllProtectedRooms,
    AppWrites {
        schema: &'a SchemaManifest,
        changes: &'a [ChangedRow],
    },
}

/// Process-local sink barrier paired with the durable authorization hook.
/// Implementations install their level-triggered state before SQLite commit,
/// hold no mutex across commit, and receive an explicit ambiguous outcome
/// instead of guessing that a failed COMMIT rolled back.
pub(crate) trait AuthorizationCommitInterlock: Send + Sync {
    fn prepare(
        &self,
        witness: &AuthorizationCommitWitness,
        impact: AuthorizationCommitImpact<'_>,
    ) -> SnapbackResult<Box<dyn PreparedAuthorizationCommit>>;
}

pub(crate) trait PreparedAuthorizationCommit: Send {
    fn committed(self: Box<Self>, min_commit_version: u64) -> SnapbackResult<()>;
    fn ambiguous(self: Box<Self>);
}

/// Commit with the exact authorization pair observed before this transaction's
/// hook. The predecessor is not derivable from the successor: first activation
/// advances from absent metadata, while destructive boundaries rotate the
/// incarnation.
///
/// @ref LLP 0053#ephemeral-room-authority-invalidation — a failed COMMIT may
///   finalize only after successor proof, and may exact-unmark only after
///   predecessor/rollback proof; every other outcome keeps the ticket pending.
fn commit_with_authorization_interlock(
    tx: Transaction<'_>,
    witness: &AuthorizationCommitWitness,
    impact: AuthorizationCommitImpact<'_>,
    predecessor: Option<AuthorizationVersion>,
    min_commit_version: u64,
    interlock: Option<Arc<dyn AuthorizationCommitInterlock>>,
) -> SnapbackResult<()> {
    let prepared = prepare_authorization_commit_interlock(witness, impact, interlock.as_ref())?;
    commit_with_prepared_authorization_interlock(
        tx,
        witness,
        predecessor,
        min_commit_version,
        prepared,
    )
}

/// Install and drain the targeted room dependency before a caller acquires
/// any process-global commit fence. An affected room may delay this step, so
/// holding the admission-controller mutex here would make unrelated room
/// routes queue behind the affected commit and violate L9.
///
/// @ref LLP 0053#ephemeral-room-authority-invalidation — targeted dependency
///   preparation must not suspend unrelated protected rooms.
fn prepare_authorization_commit_interlock(
    witness: &AuthorizationCommitWitness,
    impact: AuthorizationCommitImpact<'_>,
    interlock: Option<&Arc<dyn AuthorizationCommitInterlock>>,
) -> SnapbackResult<Option<Box<dyn PreparedAuthorizationCommit>>> {
    if !witness.event {
        return Ok(None);
    }
    interlock
        .map(|interlock| interlock.prepare(witness, impact))
        .transpose()
}

/// Commit after any targeted room dependency has already quiesced. Callers
/// that need a global lifecycle fence acquire it immediately before entering
/// this helper, so the fence covers the SQLite cut without covering the room
/// wait.
fn commit_with_prepared_authorization_interlock(
    tx: Transaction<'_>,
    witness: &AuthorizationCommitWitness,
    predecessor: Option<AuthorizationVersion>,
    min_commit_version: u64,
    prepared: Option<Box<dyn PreparedAuthorizationCommit>>,
) -> SnapbackResult<()> {
    let Some(prepared) = prepared else {
        return tx.commit().map_err(Into::into);
    };

    // Keep the Transaction handle so a COMMIT error can be reconciled on the
    // same serialized connection before another supported writer can advance
    // the durable authorization pair. No room/registry lock is held here.
    let commit = commit_authorization_transaction(&tx);
    if commit.is_ok() {
        return prepared.committed(min_commit_version);
    }
    let commit_error = commit.expect_err("checked error outcome");

    if !tx.is_autocommit() && tx.execute_batch("ROLLBACK").is_ok() {
        // SQLite confirmed that this exact transaction rolled back. Dropping
        // the prepared handle compare-removes only its ticket.
        drop(prepared);
        return Err(commit_error);
    }

    if tx.is_autocommit() {
        match auth_stream::read_authorization_version_snapshot(&tx) {
            Ok(actual) if actual == Some(witness.version.clone()) => {
                return prepared.committed(min_commit_version);
            }
            Ok(actual) if actual == predecessor => {
                drop(prepared);
                return Err(commit_error);
            }
            Ok(_) | Err(_) => {}
        }
    }

    // The transaction may have committed, rolled back, or left the connection
    // unreadable. Keep the exact process-local ticket closed; process rebuild
    // is the only safe recovery because owner-level durable-query/schema
    // publication did not complete. No timeout path may reopen it.
    prepared.ambiguous();
    Err(commit_error)
}

fn commit_authorization_transaction(tx: &Transaction<'_>) -> SnapbackResult<()> {
    #[cfg(test)]
    let fault = AUTHORIZATION_COMMIT_FAULT.with(|slot| slot.take());
    #[cfg(test)]
    if fault == Some(AuthorizationCommitFaultForTest::BeforeCommit) {
        return Err(SnapbackError::error(
            "TEST_AUTHORIZATION_COMMIT_FAILURE",
            "auth",
            "injected failure before authorization COMMIT",
        ));
    }

    #[cfg(test)]
    if fault == Some(AuthorizationCommitFaultForTest::AfterRollback) {
        tx.execute_batch("ROLLBACK")?;
        return Err(SnapbackError::error(
            "TEST_AUTHORIZATION_COMMIT_FAILURE",
            "auth",
            "injected authorization COMMIT error after durable rollback",
        ));
    }

    tx.execute_batch("COMMIT")?;

    #[cfg(test)]
    if fault == Some(AuthorizationCommitFaultForTest::AfterCommit) {
        return Err(SnapbackError::error(
            "TEST_AUTHORIZATION_COMMIT_FAILURE",
            "auth",
            "injected lost authorization COMMIT acknowledgement",
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MutationCommit {
    pub output: MutationOutput,
    pub changes: Vec<ChangedRow>,
    #[serde(default)]
    pub read_dependencies: Vec<CapturedReadDependency>,
    #[serde(default)]
    pub write_dependencies: Vec<CapturedWriteDependency>,
    /// `None` means no commit occurred (dry-run or exact replay). Every fresh
    /// committed app writer returns the pair observed/written in its SQLite
    /// transaction, including ordinary commits that did not advance it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization: Option<AuthorizationCommitWitness>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct SeedCommit {
    pub output: MutationOutput,
    pub authorization: AuthorizationCommitWitness,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ResetCommit {
    pub seeded: Option<MutationOutput>,
    pub authorization: AuthorizationCommitWitness,
}

/// Durable identity for one queued client mutation. The server stores this in
/// the same SQLite transaction as the mutation result, closing the
/// response-loss/reconnect duplicate window (LLP 0043 M2).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClientMutationIdentity {
    pub id: String,
    pub function: String,
    pub auth_fingerprint: String,
    pub authority_instance_id: String,
    pub input_fingerprint: String,
}

struct BufferedCommitOptions<'a> {
    ctx_ledger: Option<CtxAnswerLedger>,
    apply: bool,
    identity: Option<&'a ClientMutationIdentity>,
}

pub(crate) struct BufferedCommitPayload {
    pub writes: Vec<BufferedWrite>,
    pub membership_plans: Vec<AuthorizedMembershipPlan>,
    pub read_dependencies: Vec<CapturedReadDependency>,
    pub result: Value,
    pub ctx_ledger: CtxAnswerLedger,
}

struct BufferedEffects {
    writes: Vec<BufferedWrite>,
    membership_plans: Vec<AuthorizedMembershipPlan>,
    read_dependencies: Vec<CapturedReadDependency>,
    result: Value,
}

#[derive(Clone, Copy)]
struct MembershipCommitAuthority<'a> {
    gate: MembershipWriteGate,
    writer: Option<&'a MembershipWriter>,
}

impl<'a> MembershipCommitAuthority<'a> {
    const fn deny() -> Self {
        Self {
            gate: MembershipWriteGate::Deny,
            writer: None,
        }
    }

    const fn sanctioned(writer: &'a MembershipWriter) -> Self {
        Self {
            gate: MembershipWriteGate::Sanctioned,
            writer: Some(writer),
        }
    }
}

impl ClientMutationIdentity {
    pub fn new(id: impl Into<String>, function: impl Into<String>, input: &HandlerInput) -> Self {
        Self::for_authority(
            id,
            function,
            input,
            TEST_CLIENT_MUTATION_AUTHORITY_INSTANCE_ID,
        )
    }

    pub fn for_authority(
        id: impl Into<String>,
        function: impl Into<String>,
        input: &HandlerInput,
        authority_instance_id: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            function: function.into(),
            auth_fingerprint: auth_fingerprint(&input.auth),
            authority_instance_id: authority_instance_id.into(),
            input_fingerprint: mutation_input_fingerprint(input),
        }
    }
}

/// One executed IR mutation plan with its recorded deterministic answers —
/// what the plan wrote (or would write), every host-generated id in answer
/// order, and the frozen evaluation clock. The commit path discards the
/// ledger halves; the dry-run path reports them as `deterministicInputs`
/// (LLP 0051 D8).
pub struct MutationPlanExecution {
    pub commit: MutationCommit,
    /// Host-generated ids in answer order (`Insert`/`InsertEach` row ids) —
    /// the IR half of LLP 0051 D1's one ordered `generatedIds` sequence.
    pub generated_ids: Vec<String>,
    /// The frozen evaluation clock every clock expression answered with.
    pub now_ms: u64,
    /// The database version the plan evaluated against.
    pub snapshot_version: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CapturedReadDependency {
    pub kind: CapturedReadKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predicate: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CapturedReadKind {
    Row,
    MissingRow,
    Query,
    Auth,
    Permission,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CapturedWriteDependency {
    pub table: String,
    pub id: String,
    pub op: ChangeOp,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum BufferedWrite {
    Insert {
        table: String,
        id: String,
        values: Map<String, Value>,
    },
    Patch {
        table: String,
        id: String,
        values: Map<String, Value>,
    },
    Delete {
        table: String,
        id: String,
    },
}

impl BufferedWrite {
    pub fn table(&self) -> &str {
        match self {
            BufferedWrite::Insert { table, .. }
            | BufferedWrite::Patch { table, .. }
            | BufferedWrite::Delete { table, .. } => table,
        }
    }

    pub fn id(&self) -> &str {
        match self {
            BufferedWrite::Insert { id, .. }
            | BufferedWrite::Patch { id, .. }
            | BufferedWrite::Delete { id, .. } => id,
        }
    }
}

pub struct LocalDatabase {
    conn: Connection,
    path: Option<PathBuf>,
    schema: SchemaManifest,
    // @ref LLP 0003#database-model — reads use a separate pool of WAL reader
    // connections so queries do not queue behind writes. `None` for in-memory
    // databases, which cannot run WAL; those fall back to the serialized lane.
    reader_pool: Option<Arc<ReaderPool>>,
    authorization_interlock: Option<Arc<dyn AuthorizationCommitInterlock>>,
}

fn reset_and_seed_transaction(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    seed: Option<SeedData>,
    successor: &crate::auth::session_projection::AuthorizationStreamIncarnation,
) -> SnapbackResult<Option<MutationOutput>> {
    // @ref LLP 0057#catalog-write-and-lifecycle-rules — auth state is
    // deleted in dependency order inside the same transaction as app reset,
    // while the protected catalog DDL and marker remain installed.
    auth::reset_auth_catalog_in(tx)?;
    // @ref LLP 0007#schema-evolution — dormant rollback tables are still
    // inside the app-wide reset boundary.
    for table in physical_user_tables(tx)? {
        tx.execute(&format!("DELETE FROM {}", quote_ident(&table)?), [])?;
    }
    tx.execute("DELETE FROM _snapback_changes", [])?;
    tx.execute("DELETE FROM _snapback_client_mutations", [])?;
    tx.execute("DELETE FROM _snapback_client_mutation_auth_retention", [])?;
    tx.execute("DELETE FROM _snapback_membership_transitions", [])?;
    auth_invalidation::clear_retry_episodes_in(tx)?;
    authorized_lease::clear_authorized_lease_reservations_in(tx)?;
    auth_invalidation::rotate_data_version_stream_in(tx)?;
    tx.execute(
        "DELETE FROM _snapback_meta WHERE key = ?1",
        params![META_RETENTION_FLOOR],
    )?;
    save_meta_u64(tx, META_CLIENT_MUTATION_RECORDS, 0)?;
    save_meta_u64(tx, META_CLIENT_MUTATION_BYTES, 0)?;
    save_meta_u64(tx, META_CLIENT_MUTATION_GC_TOTAL, 0)?;
    tx.execute(
        "DELETE FROM _snapback_meta WHERE key = ?1",
        params![META_CRON_STATE],
    )?;
    // @ref LLP 0059#reset-restore-and-stream-publication — the successor is
    // durable in the same transaction as every destructive reset effect.
    auth_stream::rotate_authorization_stream_incarnation_in(tx, successor)?;
    tx.execute("UPDATE _snapback_version SET version = 0 WHERE id = 1", [])?;

    match seed {
        None => Ok(None),
        Some(seed) => {
            let changes = seed_into_transaction(tx, schema, seed, 1)?;
            let changed_count = changes.len();
            if changed_count > 0 {
                set_version(tx, 1)?;
            }
            Ok(Some(MutationOutput {
                version: if changed_count > 0 { 1 } else { 0 },
                changed_count,
                result: Value::Null,
                ctx_ledger: None,
            }))
        }
    }
}

impl LocalDatabase {
    pub fn memory() -> SnapbackResult<Self> {
        let conn = Connection::open_in_memory()?;
        let mode_inspection = auth_mode::inspect_for_open(&conn)?;
        let mut db = Self {
            conn,
            path: None,
            schema: SchemaManifest::default(),
            reader_pool: None,
            authorization_interlock: None,
        };
        db.configure(false)?;
        db.create_infra()?;
        auth_mode::adopt_after_infra(&mut db, mode_inspection)?;
        Ok(db)
    }

    pub fn open(path: impl AsRef<Path>) -> SnapbackResult<Self> {
        let path = path.as_ref().to_path_buf();
        let conn = Connection::open(&path)?;
        // @ref LLP 0058#corrupt-state-boundary — inspect and cross-validate all
        // four mode keys before WAL configuration or any additive infra write.
        let mode_inspection = auth_mode::inspect_for_open(&conn)?;
        // @ref LLP 0057#reservation — a stored manifest is an admission
        // boundary on every reopen, not only when a new schema is applied.
        // Probe and validate it before WAL configuration or any additive infra
        // migration so a reserved-name database reaches the collision-recovery
        // caller without a request-attributable storage mutation.
        let stored_schema = mode_inspection.active_manifest().cloned();
        if let Some(manifest) = &stored_schema {
            validate_schema(manifest)?;
        }
        let mut db = Self {
            conn,
            path: Some(path.clone()),
            schema: SchemaManifest::default(),
            reader_pool: None,
            authorization_interlock: None,
        };
        db.configure(true)?;
        db.create_infra()?;
        db.schema = stored_schema.unwrap_or_default();
        auth_mode::adopt_after_infra(&mut db, mode_inspection)?;
        // The pool is created after configure/create_infra so readers open an
        // existing WAL database with the infra tables committed.
        db.reader_pool = Some(Arc::new(ReaderPool::new(path)));
        Ok(db)
    }

    /// The WAL reader pool for lock-free read-lane queries; `None` for
    /// in-memory databases (no WAL, reads stay on the serialized write lane).
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
    pub fn reader_pool(&self) -> Option<Arc<ReaderPool>> {
        self.reader_pool.clone()
    }

    /// Capture an owned, in-memory read snapshot for detached handler
    /// execution when the live database has no WAL reader pool (`:memory:`).
    /// The backup runs while the caller holds the short instance lock; handler
    /// JavaScript runs only after this owned copy has been returned.
    ///
    /// @ref LLP 0028#execution-the-action-class — ENG-24340 isolates nested
    /// mutation execution from the live in-memory write connection.
    pub(crate) fn detached_read_snapshot(&self) -> SnapbackResult<Self> {
        let mut conn = Connection::open_in_memory()?;
        {
            let backup = rusqlite::backup::Backup::new(&self.conn, &mut conn)?;
            backup.run_to_completion(128, std::time::Duration::from_millis(1), None)?;
        }
        Ok(Self {
            conn,
            path: None,
            schema: self.schema.clone(),
            reader_pool: None,
            authorization_interlock: None,
        })
    }

    pub(crate) fn install_authorization_interlock(
        &mut self,
        interlock: Arc<dyn AuthorizationCommitInterlock>,
    ) {
        self.authorization_interlock = Some(interlock);
    }

    pub fn schema(&self) -> &SchemaManifest {
        &self.schema
    }

    /// File-backed databases publish their canonical storage path to sibling
    /// system stores (notably the auth keyring); memory databases return None.
    /// This does not expose the SQLite connection or an app-data escape hatch.
    #[allow(dead_code)] // Consumed by the ENG-24596 keyring integration lane.
    pub(crate) fn database_path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn info(&self) -> SnapbackResult<StorageInfo> {
        Ok(StorageInfo {
            sqlite_path: self.path.clone(),
            version: self.current_version()?,
            tables: self
                .schema
                .tables
                .iter()
                .map(|table| table.name.clone())
                .collect(),
            client_mutation_retention: self.client_mutation_retention_info()?,
        })
    }

    pub fn client_mutation_retention_info(&self) -> SnapbackResult<ClientMutationRetentionInfo> {
        let (records, bytes) = client_mutation_retention_counters(&self.conn)?;
        let gc_total = optional_meta_u64(&self.conn, META_CLIENT_MUTATION_GC_TOTAL)?.unwrap_or(0);
        Ok(ClientMutationRetentionInfo {
            records,
            bytes,
            gc_total,
            max_records: CLIENT_MUTATION_MAX_RECORDS,
            max_bytes: CLIENT_MUTATION_MAX_BYTES,
            max_result_bytes: CLIENT_MUTATION_MAX_RESULT_BYTES,
        })
    }

    /// Reclaim full settlement payloads only after the client has durably
    /// removed those ids from its replay queue. The auth fingerprint prevents
    /// one authority from acknowledging another user's opaque ids.
    pub fn acknowledge_client_mutations(
        &mut self,
        auth_fingerprint: &str,
        ids: &[String],
    ) -> SnapbackResult<u64> {
        self.acknowledge_client_mutations_inner(auth_fingerprint, None, ids)
    }

    pub(crate) fn acknowledge_client_mutations_for_authority(
        &mut self,
        auth_fingerprint: &str,
        authority_instance_id: &str,
        ids: &[String],
    ) -> SnapbackResult<u64> {
        self.acknowledge_client_mutations_inner(
            auth_fingerprint,
            Some(authority_instance_id),
            ids,
        )
    }

    fn acknowledge_client_mutations_inner(
        &mut self,
        auth_fingerprint: &str,
        authority_instance_id: Option<&str>,
        ids: &[String],
    ) -> SnapbackResult<u64> {
        if ids.len() > CLIENT_MUTATION_ACK_MAX_IDS {
            return Err(SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_ACK_LIMIT_EXCEEDED",
                "sync",
                format!(
                    "one request may acknowledge at most {CLIENT_MUTATION_ACK_MAX_IDS} client mutations"
                ),
            ));
        }
        let unique = ids.iter().collect::<BTreeSet<_>>();
        for id in &unique {
            if !replay_opaque_id_is_valid(id) {
                return Err(SnapbackError::error(
                    "SNAPBACK_CLIENT_MUTATION_ID_INVALID",
                    "sync",
                    "acknowledged client mutation id is invalid",
                ));
            }
        }
        if unique.is_empty() {
            return Ok(0);
        }
        let tx = self.conn.transaction()?;
        let (retained_records, retained_bytes) = client_mutation_retention_counters(&tx)?;
        let (auth_records, auth_bytes) =
            client_mutation_auth_retention_counters(&tx, auth_fingerprint)?;
        let mut deleted = 0_u64;
        let mut deleted_bytes = 0_u64;
        for id in unique {
            let row_bytes = tx
                .query_row(
                    "SELECT
                       length(CAST(client_mutation_id AS BLOB)) +
                       length(CAST(function AS BLOB)) +
                       length(CAST(auth_fingerprint AS BLOB)) +
                       COALESCE(length(CAST(authority_instance_id AS BLOB)), 0) +
                       length(CAST(input_fingerprint AS BLOB)) +
                       length(CAST(output_json AS BLOB))
                     FROM _snapback_client_mutations
                     WHERE client_mutation_id = ?1 AND auth_fingerprint = ?2
                       AND (?3 IS NULL OR authority_instance_id = ?3)",
                    params![id, auth_fingerprint, authority_instance_id],
                    |row| row.get::<_, u64>(0),
                )
                .optional()?;
            let Some(row_bytes) = row_bytes else {
                continue;
            };
            let removed = tx.execute(
                "DELETE FROM _snapback_client_mutations
                 WHERE client_mutation_id = ?1 AND auth_fingerprint = ?2
                   AND (?3 IS NULL OR authority_instance_id = ?3)",
                params![id, auth_fingerprint, authority_instance_id],
            )? as u64;
            deleted = deleted.saturating_add(removed);
            if removed > 0 {
                deleted_bytes = deleted_bytes.checked_add(row_bytes).ok_or_else(|| {
                    invalid_client_mutation_retention_state(
                        "acknowledged client-mutation byte count overflowed",
                    )
                })?;
            }
        }
        if deleted > 0 {
            let records = retained_records.checked_sub(deleted).ok_or_else(|| {
                invalid_client_mutation_retention_state(
                    "acknowledgement would underflow the retained record counter",
                )
            })?;
            let bytes = retained_bytes.checked_sub(deleted_bytes).ok_or_else(|| {
                invalid_client_mutation_retention_state(
                    "acknowledgement would underflow the retained byte counter",
                )
            })?;
            save_meta_u64(&tx, META_CLIENT_MUTATION_RECORDS, records)?;
            save_meta_u64(&tx, META_CLIENT_MUTATION_BYTES, bytes)?;
            let auth_records = auth_records.checked_sub(deleted).ok_or_else(|| {
                invalid_client_mutation_retention_state(
                    "acknowledgement would underflow the auth record counter",
                )
            })?;
            let auth_bytes = auth_bytes.checked_sub(deleted_bytes).ok_or_else(|| {
                invalid_client_mutation_retention_state(
                    "acknowledgement would underflow the auth byte counter",
                )
            })?;
            save_client_mutation_auth_retention_counters(
                &tx,
                auth_fingerprint,
                auth_records,
                auth_bytes,
            )?;
            let gc_total = optional_meta_u64(&tx, META_CLIENT_MUTATION_GC_TOTAL)?
                .unwrap_or(0)
                .checked_add(deleted)
                .ok_or_else(|| {
                    invalid_client_mutation_retention_state(
                        "client-mutation acknowledgement total overflowed",
                    )
                })?;
            save_meta_u64(&tx, META_CLIENT_MUTATION_GC_TOTAL, gc_total)?;
        }
        tx.commit()?;
        Ok(deleted)
    }

    /// Administrative recovery for a client that can no longer send durable
    /// acknowledgements. Purging deliberately gives up exactly-once replay for
    /// the removed settlements, so callers must gate it as an admin write.
    /// Ledger rows plus global/per-auth counters change in one transaction.
    pub fn purge_client_mutation_settlements(
        &mut self,
        auth_fingerprint: Option<&str>,
    ) -> SnapbackResult<u64> {
        let tx = self.conn.transaction()?;
        let (retained_records, retained_bytes) = client_mutation_retention_counters(&tx)?;
        let deleted = match auth_fingerprint {
            Some(auth_fingerprint) => {
                let (auth_records, auth_bytes) =
                    client_mutation_auth_retention_counters(&tx, auth_fingerprint)?;
                let deleted = tx.execute(
                    "DELETE FROM _snapback_client_mutations WHERE auth_fingerprint = ?1",
                    params![auth_fingerprint],
                )? as u64;
                if deleted != auth_records {
                    return Err(invalid_client_mutation_retention_state(
                        "auth purge row count did not match its retention counter",
                    ));
                }
                save_meta_u64(
                    &tx,
                    META_CLIENT_MUTATION_RECORDS,
                    retained_records.checked_sub(auth_records).ok_or_else(|| {
                        invalid_client_mutation_retention_state(
                            "auth purge would underflow the global record counter",
                        )
                    })?,
                )?;
                save_meta_u64(
                    &tx,
                    META_CLIENT_MUTATION_BYTES,
                    retained_bytes.checked_sub(auth_bytes).ok_or_else(|| {
                        invalid_client_mutation_retention_state(
                            "auth purge would underflow the global byte counter",
                        )
                    })?,
                )?;
                save_client_mutation_auth_retention_counters(&tx, auth_fingerprint, 0, 0)?;
                deleted
            }
            None => {
                let deleted = tx.execute("DELETE FROM _snapback_client_mutations", [])? as u64;
                if deleted != retained_records {
                    return Err(invalid_client_mutation_retention_state(
                        "global purge row count did not match its retention counter",
                    ));
                }
                tx.execute("DELETE FROM _snapback_client_mutation_auth_retention", [])?;
                save_meta_u64(&tx, META_CLIENT_MUTATION_RECORDS, 0)?;
                save_meta_u64(&tx, META_CLIENT_MUTATION_BYTES, 0)?;
                deleted
            }
        };
        tx.commit()?;
        Ok(deleted)
    }

    /// Return the durably settled result for a client mutation identity.
    /// Function/auth mismatches fail closed instead of treating the key as a
    /// cache hit under different authority.
    pub fn client_mutation_result(
        &self,
        identity: &ClientMutationIdentity,
    ) -> SnapbackResult<Option<MutationOutput>> {
        validate_client_mutation_identity(identity)?;
        let row: Option<(String, String, Option<String>, String, String)> = self
            .conn
            .query_row(
                "SELECT function, auth_fingerprint, authority_instance_id,
                        input_fingerprint, output_json
                 FROM _snapback_client_mutations WHERE client_mutation_id = ?1",
                params![identity.id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()?;
        let Some((function, retained_auth, retained_authority, retained_input, output_json)) = row
        else {
            return Ok(None);
        };
        if function != identity.function {
            return Err(SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
                "sync",
                "client mutation id was already used for another function",
            )
            .with_details(json!({
                "clientMutationId": identity.id,
                "expectedFunction": function,
                "actualFunction": identity.function,
            })));
        }
        if retained_auth != identity.auth_fingerprint {
            if retained_auth.starts_with("fnv1a:") {
                return Err(SnapbackError::error(
                    "SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED",
                    "auth",
                    "client mutation uses a legacy auth fingerprint that cannot be rebound safely; acknowledge the consumed result or use the admin purge recovery path",
                )
                .with_details(json!({ "clientMutationId": identity.id })));
            }
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_STALE_RESULT",
                "auth",
                "client mutation was recorded under another auth context",
            )
            .with_details(json!({ "clientMutationId": identity.id })));
        }
        let Some(retained_authority) = retained_authority else {
            return Err(SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED",
                "auth",
                "client mutation predates authority descriptors and cannot be rebound safely; acknowledge the consumed result or use the admin purge recovery path",
            )
            .with_details(json!({ "clientMutationId": identity.id })));
        };
        if retained_authority != identity.authority_instance_id {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_STALE_RESULT",
                "auth",
                "client mutation was settled under another authority instance; discard it or explicitly re-record it under the current authority",
            )
            .with_details(json!({
                "clientMutationId": identity.id,
                "reason": "authority_instance_mismatch",
                "guidance": "discard_or_rerecord",
                "automaticRetry": false,
            })));
        }
        if retained_input != identity.input_fingerprint {
            return Err(SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
                "sync",
                "client mutation id was already used with another mutation payload",
            )
            .with_details(json!({
                "clientMutationId": identity.id,
                "reason": "input_fingerprint_mismatch",
            })));
        }
        let output = serde_json::from_str(&output_json).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CLIENT_MUTATION_RESULT_INVALID",
                "storage",
                "stored client mutation result could not be decoded",
            )
            .with_details(json!({
                "clientMutationId": identity.id,
                "error": error.to_string(),
            }))
        })?;
        Ok(Some(output))
    }

    pub fn current_version(&self) -> SnapbackResult<u64> {
        current_version_on(&self.conn)
    }

    /// Prune the change journal to bound its growth: delete changes that are
    /// outside **both** the version window (older than `retain_versions` behind
    /// the current version) and the time window (older than `retain_ms`). A
    /// change is kept if it is within either window, so a burst of writes and a
    /// long-idle table are both retained conservatively.
    ///
    /// A table's **newest** change is never pruned, even when cold. Read-set
    /// validation uses `MAX(version) WHERE table_name = ?` and treats
    /// captured-version-equals-current as "unchanged since the read"; if the
    /// last change of a cold table were pruned, that `MAX` would drop to 0 and
    /// spuriously conflict a mutation that only *read* the table. Retaining the
    /// per-table high-water row keeps the invariant while still bounding the
    /// journal (at most one version's worth of rows per table survives the
    /// window, and table count is bounded by the schema).
    ///
    /// @ref LLP 0008#retention-and-resume — version-and-time-bounded retention.
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3.
    pub fn prune_change_journal(
        &self,
        now_ms: u64,
        retain_versions: u64,
        retain_ms: u64,
    ) -> SnapbackResult<u64> {
        let version_floor = self.current_version()?.saturating_sub(retain_versions);
        let time_floor = now_ms.saturating_sub(retain_ms);
        // Predicate for a prunable row: outside both windows, and not its
        // table's high-water change (which read-set validation still needs).
        let prunable = "version < ?1 AND changed_at_ms < ?2 \
             AND version < (SELECT MAX(version) FROM _snapback_changes t2 \
                            WHERE t2.table_name = _snapback_changes.table_name)";
        // Advance the monotonic replay floor to the highest version actually
        // pruned this pass, so a resume at/above the floor is guaranteed to have
        // a contiguous journal.
        let highest_pruned: Option<i64> = self.conn.query_row(
            &format!("SELECT MAX(version) FROM _snapback_changes WHERE {prunable}"),
            params![version_floor as i64, time_floor as i64],
            |row| row.get(0),
        )?;
        if let Some(highest_pruned) = highest_pruned {
            let floor = self.load_retention_floor()?.max(highest_pruned as u64 + 1);
            self.save_retention_floor(floor)?;
        }
        let deleted = self.conn.execute(
            &format!("DELETE FROM _snapback_changes WHERE {prunable}"),
            params![version_floor as i64, time_floor as i64],
        )?;
        Ok(deleted as u64)
    }

    /// The monotonic replay floor: the highest change version pruning has
    /// removed (0 if nothing has ever been pruned). A version-based resume from
    /// below this may hit a pruned gap and must resnapshot; from at/above it the
    /// journal is contiguous. Distinct from a table's validation high-water,
    /// which pruning preserves.
    ///
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3.
    pub fn journal_floor_version(&self) -> SnapbackResult<u64> {
        self.load_retention_floor()
    }

    fn load_retention_floor(&self) -> SnapbackResult<u64> {
        let value: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![META_RETENTION_FLOOR],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value.and_then(|value| value.parse().ok()).unwrap_or(0))
    }

    fn save_retention_floor(&self, floor: u64) -> SnapbackResult<()> {
        self.conn.execute(
            "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_RETENTION_FLOOR, floor.to_string()],
        )?;
        Ok(())
    }

    pub fn change_journal_len(&self) -> SnapbackResult<u64> {
        let count: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                    row.get(0)
                })?;
        Ok(count as u64)
    }

    /// Whether a client must resnapshot rather than replay. `from_version` is
    /// the earliest change version the client still needs (it has applied every
    /// version before it, and wants `[from_version, current]`). If that is below
    /// the monotonic replay floor, a needed change may have been pruned, so the
    /// client must resnapshot; at/above the floor the journal is contiguous and
    /// can be replayed. A floor of 0 (nothing ever pruned) never forces a
    /// resnapshot.
    ///
    /// This is the retention contract for the version-based replay path; the
    /// consumer is future sync work ([LLP 0032](./0032-decision-and-implementation-hardening.plan.md)
    /// P4 / DK-3), and this primitive keeps the floor authoritative meanwhile.
    ///
    /// @ref LLP 0008#retention-and-resume — resume below the retained floor requires resnapshot.
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3.
    pub fn resume_requires_resnapshot(&self, from_version: u64) -> SnapbackResult<bool> {
        Ok(from_version < self.journal_floor_version()?)
    }

    /// The `EXPLAIN QUERY PLAN` detail for the per-mutation read-set validation
    /// query, so a test can assert it uses the `(table_name, version)` index
    /// rather than scanning.
    /// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3 index gate.
    pub fn explain_table_change_version_plan(&self, table: &str) -> SnapbackResult<String> {
        let table = schema_table(&self.schema, table)?;
        let mut statement = self.conn.prepare(
            "EXPLAIN QUERY PLAN SELECT MAX(version) FROM _snapback_changes WHERE table_name = ?1",
        )?;
        let rows = statement.query_map(params![table.name], |row| row.get::<_, String>(3))?;
        let mut detail = String::new();
        for row in rows {
            detail.push_str(&row?);
            detail.push('\n');
        }
        Ok(detail)
    }

    pub fn apply_schema(&mut self, manifest: SchemaManifest) -> SnapbackResult<Vec<Diagnostic>> {
        self.apply_schema_mode_aware(manifest)?;
        Ok(Vec::new())
    }

    pub fn reset(&mut self) -> SnapbackResult<()> {
        self.reset_and_seed(None).map(|_| ())
    }

    /// Replace all app data with an optional declarative seed in one SQLite
    /// transaction. Validation, inserts, version reset, and seed changes are
    /// all covered by the same commit: any error drops the transaction and
    /// leaves the previous database byte-for-byte visible to callers.
    ///
    /// @ref LLP 0003#execution-and-write-semantics — a logical mutation has
    /// one durable commit boundary; reset+seed is one operation, not a
    /// committed reset followed by a fallible second mutation.
    pub fn reset_and_seed(
        &mut self,
        seed: Option<SeedData>,
    ) -> SnapbackResult<Option<MutationOutput>> {
        use crate::auth::coordinator::AuthCoordinator;
        use crate::auth::session_projection::{
            AuthorizationStreamRecord, ProjectionSource, SessionProjection,
        };

        let incarnation = self.ensure_authorization_stream_incarnation()?;
        // A standalone database owns no published session projection or grant
        // registry. Coordinate only its durable stream so reset remains the
        // recovery path even when the auth rows being deleted are corrupt.
        // Server-owned reset uses the installed full coordinator instead.
        let source = ProjectionSource {
            authorization_stream_value: AuthorizationStreamRecord::new(incarnation)
                .encode_bytes()?,
            restore_declaration_id: None,
            users: Vec::new(),
            identities: Vec::new(),
            sessions: Vec::new(),
            superseded_tokens: Vec::new(),
        };
        let projection =
            SessionProjection::rebuild_with_fresh_startup_id(source, now_millis(), Instant::now())?;
        let coordinator = AuthCoordinator::new(projection)?;
        let carrier = coordinator.premark_stream_reset()?;
        let predecessor = carrier.predecessor().clone();
        let successor = carrier.successor().clone();
        let attempt =
            self.attempt_reset_and_seed_with_authorization_stream(seed, &predecessor, &successor);
        coordinator.finish_stream_reset(carrier, attempt)
    }

    /// Coordinated destructive reset with explicit commit certainty. A unique
    /// stream successor is the durable operation marker used to reconcile a
    /// lost COMMIT acknowledgement without replaying seed effects.
    pub(crate) fn attempt_reset_and_seed_with_authorization_stream(
        &mut self,
        seed: Option<SeedData>,
        predecessor: &crate::auth::session_projection::AuthorizationStreamIncarnation,
        successor: &crate::auth::session_projection::AuthorizationStreamIncarnation,
    ) -> auth::AuthTransactionAttempt<Option<MutationOutput>> {
        let schema = self.schema.clone();
        let authorization_interlock = self.authorization_interlock.clone();
        let tx = match self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
        {
            Ok(tx) => tx,
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error.into()),
        };
        let authorization_predecessor = match auth_stream::read_authorization_version_on(&tx) {
            Ok(version) => version,
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error),
        };
        if authorization_predecessor
            .as_ref()
            .map(|version| version.incarnation.as_str())
            != Some(predecessor.as_str())
        {
            return auth::AuthTransactionAttempt::RolledBack(SnapbackError::error(
                "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT",
                "auth",
                "reset coordinator predecessor does not match durable authorization state",
            ));
        }
        let seeded = match reset_and_seed_transaction(&tx, &schema, seed, successor) {
            Ok(seeded) => seeded,
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error),
        };
        #[cfg(test)]
        if let Err(error) = BEFORE_RESET_COMMIT_HOOK.with(|slot| {
            if let Some(hook) = slot.borrow_mut().take() {
                hook()?;
            }
            Ok::<(), SnapbackError>(())
        }) {
            return auth::AuthTransactionAttempt::RolledBack(error);
        }
        let authorization = AuthorizationCommitWitness {
            version: AuthorizationVersion {
                incarnation: successor.as_str().to_owned(),
                epoch: 0,
            },
            event: true,
            incarnation_rotated: true,
            membership_declarations: Vec::new(),
        };
        let min_commit_version = seeded.as_ref().map_or(0, |output| output.version);
        let prepared = match authorization_interlock
            .as_ref()
            .map(|interlock| {
                interlock.prepare(&authorization, AuthorizationCommitImpact::AllProtectedRooms)
            })
            .transpose()
        {
            Ok(prepared) => prepared,
            Err(error) => return auth::AuthTransactionAttempt::RolledBack(error),
        };
        match tx.commit() {
            Ok(()) => match prepared {
                Some(prepared) => match prepared.committed(min_commit_version) {
                    Ok(()) => auth::AuthTransactionAttempt::Committed(seeded),
                    Err(error) => auth::AuthTransactionAttempt::CommitUncertain(error),
                },
                None => auth::AuthTransactionAttempt::Committed(seeded),
            },
            Err(error) => {
                let error = SnapbackError::from(error);
                match auth_stream::read_authorization_version_snapshot(&self.conn) {
                    Ok(durable) if durable == Some(authorization.version.clone()) => match prepared
                    {
                        Some(prepared) => match prepared.committed(min_commit_version) {
                            Ok(()) => auth::AuthTransactionAttempt::Committed(seeded),
                            Err(error) => auth::AuthTransactionAttempt::CommitUncertain(error),
                        },
                        None => auth::AuthTransactionAttempt::Committed(seeded),
                    },
                    Ok(durable) if durable == authorization_predecessor => {
                        drop(prepared);
                        auth::AuthTransactionAttempt::RolledBack(error)
                    }
                    Ok(_) | Err(_) => {
                        if let Some(prepared) = prepared {
                            prepared.ambiguous();
                        }
                        auth::AuthTransactionAttempt::CommitUncertain(error)
                    }
                }
            }
        }
    }

    /// Authorization-aware compatibility seam for direct storage callers.
    /// Item 5's coordinated reset chooses and durably publishes the successor
    /// stream; the exact version read after that successful cut is its proof.
    pub fn reset_and_seed_with_authorization(
        &mut self,
        seed: Option<SeedData>,
    ) -> SnapbackResult<ResetCommit> {
        let seeded = self.reset_and_seed(seed)?;
        Ok(ResetCommit {
            seeded,
            authorization: AuthorizationCommitWitness {
                version: self.authorization_version()?,
                event: true,
                incarnation_rotated: true,
                membership_declarations: Vec::new(),
            },
        })
    }

    pub fn load_cron_state(&self) -> SnapbackResult<Option<Value>> {
        let value: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![META_CRON_STATE],
                |row| row.get(0),
            )
            .optional()?;

        value
            .map(|value| {
                serde_json::from_str(&value).map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_CRON_STATE_PARSE_FAILED",
                        "cron",
                        "stored cron runtime state could not be parsed",
                    )
                    .with_detail("error", error.to_string())
                })
            })
            .transpose()
    }

    pub fn save_cron_state(&mut self, value: &Value) -> SnapbackResult<()> {
        let state_json = serde_json::to_string(value).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_CRON_STATE_SERIALIZE_FAILED",
                "cron",
                "cron runtime state could not be serialized",
            )
            .with_detail("error", error.to_string())
        })?;
        self.conn.execute(
            "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_CRON_STATE, state_json],
        )?;
        Ok(())
    }

    pub fn seed(&mut self, seed: SeedData) -> SnapbackResult<MutationOutput> {
        self.seed_with_authorization(seed)
            .map(|commit| commit.output)
    }

    pub fn seed_with_authorization(&mut self, seed: SeedData) -> SnapbackResult<SeedCommit> {
        let current_version = self.current_version()?;
        let next_version = current_version + 1;
        let schema = self.schema.clone();
        let authorization_interlock = self.authorization_interlock.clone();
        let tx = self.conn.transaction()?;
        let changes = seed_into_transaction(&tx, &schema, seed, next_version)?;
        let changed_count = changes.len();

        if changed_count > 0 {
            set_version(&tx, next_version)?;
        }
        let authorization_predecessor = auth_stream::read_authorization_version_on(&tx)?;
        let authorization = authorization::authorization_commit_hook_in(
            &tx,
            authorization::AuthorizationCommitCause::AppWrites {
                schema: &schema,
                changes: &changes,
            },
        )?;
        let version = if changed_count > 0 {
            next_version
        } else {
            current_version
        };
        commit_with_authorization_interlock(
            tx,
            &authorization,
            AuthorizationCommitImpact::AppWrites {
                schema: &schema,
                changes: &changes,
            },
            authorization_predecessor,
            version,
            authorization_interlock,
        )?;

        Ok(SeedCommit {
            output: MutationOutput {
                version,
                changed_count,
                result: Value::Null,
                ctx_ledger: None,
            },
            authorization,
        })
    }

    pub fn query(&self, plan: &QueryPlan, input: &HandlerInput) -> SnapbackResult<QueryOutput> {
        query_on(&self.conn, &self.schema, plan, input)
    }

    pub(crate) fn room_permission_projection_granted(
        &self,
        table_name: &str,
        subject_field: &str,
        user_id: &str,
        scope_fields: &[(String, String)],
        min_commit_version: u64,
    ) -> SnapbackResult<bool> {
        room_permission_projection_granted_on(
            &self.conn,
            &self.schema,
            table_name,
            subject_field,
            user_id,
            scope_fields,
            min_commit_version,
        )
    }

    pub(crate) fn query_with_storage_limit(
        &self,
        plan: &QueryPlan,
        input: &HandlerInput,
        storage_limit: usize,
    ) -> SnapbackResult<QueryOutput> {
        query_on_with_storage_limit(&self.conn, &self.schema, plan, input, storage_limit)
    }

    pub fn get(&self, table: &str, id: &str) -> SnapbackResult<Option<Value>> {
        get_on(&self.conn, &self.schema, table, id)
    }

    pub fn table_change_version(&self, table: &str) -> SnapbackResult<u64> {
        let table = schema_table(&self.schema, table)?;
        table_change_version_from_connection(&self.conn, &table.name)
    }

    pub fn generate_id(&self) -> String {
        new_id()
    }

    /// Read a page of a table for the admin data explorer.
    ///
    /// Schema-aware and read-only: the table must be a known schema table, rows
    /// decode through the same field-type rules as `query`, and ordering is a
    /// stable `(_createdAt, _id)` so paging is deterministic. This is the paved
    /// read path; it is not raw SQL.
    ///
    /// @ref LLP 0017#durable-data-exploration-and-edits — read-only exploration
    /// through schema-aware storage with system fields shown.
    pub fn scan_table(
        &self,
        table: &str,
        limit: usize,
        offset: usize,
    ) -> SnapbackResult<TableScan> {
        let table_manifest = schema_table(&self.schema, table)?;
        let quoted = quote_ident(table)?;

        let total: i64 =
            self.conn
                .query_row(&format!("SELECT COUNT(*) FROM {quoted}"), [], |row| {
                    row.get(0)
                })?;

        let sql = format!(
            "SELECT * FROM {quoted} ORDER BY \"_createdAt\" ASC, \"_id\" ASC LIMIT ?1 OFFSET ?2"
        );
        let mut statement = self.conn.prepare(&sql)?;
        let columns = statement
            .column_names()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let mut sql_rows = statement.query(params![limit as i64, offset as i64])?;
        let mut rows = Vec::new();
        while let Some(row) = sql_rows.next()? {
            rows.push(row_to_document(row, table_manifest, &columns)?);
        }

        let mut display_columns = vec!["_id".to_owned()];
        display_columns.extend(table_manifest.fields.iter().map(|field| field.name.clone()));
        display_columns.extend([
            "_version".to_owned(),
            "_createdAt".to_owned(),
            "_updatedAt".to_owned(),
        ]);

        Ok(TableScan {
            table: table.to_owned(),
            columns: display_columns,
            rows,
            total: total as usize,
            limit,
            offset,
        })
    }

    pub fn execute_mutation(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
    ) -> SnapbackResult<MutationCommit> {
        Ok(self.execute_mutation_plan(plan, input, true, None)?.commit)
    }

    /// Execute a host plan with lifecycle checks throughout its finite step
    /// loops, then acquire a caller-owned guard only for the final SQLite
    /// commit. Detached actions use this to keep untrusted/data-dependent plan
    /// execution outside their abandonment gate while still linearizing the
    /// durable commit against the public watchdog.
    pub(crate) fn execute_mutation_guarded<G, Check, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        Ok(self
            .execute_mutation_plan_with_lifecycle(
                plan,
                input,
                true,
                None,
                &check_live,
                before_commit,
            )?
            .commit)
    }

    pub fn execute_mutation_idempotent(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
    ) -> SnapbackResult<MutationCommit> {
        Ok(self
            .execute_mutation_plan(plan, input, true, Some(identity))?
            .commit)
    }

    pub(crate) fn execute_mutation_idempotent_guarded<G, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        identity: &ClientMutationIdentity,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        Ok(self
            .execute_mutation_plan_with_lifecycle(
                plan,
                input,
                true,
                Some(identity),
                &|| Ok(()),
                before_commit,
            )?
            .commit)
    }

    /// Dry-run an IR mutation (LLP 0051 D8): the identical step loop, binding
    /// environment, in-transaction `Get` reads, and read-set validation as
    /// `execute_mutation` — then the transaction is rolled back instead of
    /// committed. Fidelity is by construction: this *is* the commit path with
    /// the final `COMMIT` swapped for `ROLLBACK`, so the answer is evidence,
    /// not a lower-fidelity evaluator (LLP 0024 §Dry-Run rule).
    ///
    /// @ref LLP 0051#d8-the-agent-surface-dry-run-becomes-cheap-and-trustworthy —
    ///   plan evaluation against a snapshot with a recorded ledger;
    ///   execute-and-discard on the buffered substrate.
    pub fn dry_run_mutation(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
    ) -> SnapbackResult<MutationPlanExecution> {
        self.execute_mutation_plan(plan, input, false, None)
    }

    fn execute_mutation_plan(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        apply: bool,
        identity: Option<&ClientMutationIdentity>,
    ) -> SnapbackResult<MutationPlanExecution> {
        self.execute_mutation_plan_with_lifecycle(plan, input, apply, identity, &|| Ok(()), || {
            Ok(())
        })
    }

    fn execute_mutation_plan_with_lifecycle<G, Check, BeforeCommit>(
        &mut self,
        plan: &MutationPlan,
        input: &HandlerInput,
        apply: bool,
        identity: Option<&ClientMutationIdentity>,
        check_live: &Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationPlanExecution>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        crate::exec_guard::debug_assert_off_async_worker("a SQLite mutation");
        check_live()?;
        // @ref LLP 0003#execution-and-write-semantics — one mutation commits all buffered writes at one version.
        let schema = self.schema.clone();
        let replay_ledger = validate_plan_replay_ledger(input)?;
        let now_ms = replay_ledger
            .as_ref()
            .map(|ledger| ledger.now)
            .unwrap_or_else(now_millis);
        validate_portable_timestamp_millis(now_ms)?;
        let current_version = self.current_version()?;
        let next_version = current_version + 1;
        let authorization_interlock = self.authorization_interlock.clone();
        let tx = self.conn.transaction()?;

        // @ref LLP 0032#phase-2--execution-semantics-honesty — E3 (Option A),
        // ratified-and-extended by LLP 0051 D2: the client-supplied read_set
        // remains the isolation baseline for *plain* plans (their reads happened
        // on the client, so the client declares the baseline and the server
        // enforces it atomically here). Since `Get`/`Guard` landed, a plan is no
        // longer necessarily an unconditional write sequence — plan `Get` reads
        // execute inside this same transaction (they can never be stale relative
        // to the commit, so they need no conflict validation) and are captured
        // server-side into `read_dependencies` for receipts and derived
        // overlays. (Ibex handlers still differ: they read → await → commit
        // across an async window, so their reads are captured server-side and
        // validated in `commit_buffered_writes`.)
        validate_read_set(&tx, &schema, &input.read_set)?;

        // Fail closed on bounds/profile violations before any step executes.
        crate::value_expr::validate_mutation_plan(plan)?;

        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   HostPlan cannot authorize a membership write in v1: every generic
        //   form (`Insert`/`Patch`/`Delete`/`DeleteWhere`/`InsertEach`) targeting
        //   a declared membership table is refused, typed, before any step runs.
        //   This path also serves dry-run (apply=false) and nested
        //   action->mutation, so the refusal covers both by construction.
        for step in &plan.steps {
            let generic_target = match step {
                MutationStep::Insert { table, .. }
                | MutationStep::Patch { table, .. }
                | MutationStep::Delete { table, .. }
                | MutationStep::DeleteWhere { table, .. }
                | MutationStep::InsertEach { table, .. } => Some(table.as_str()),
                MutationStep::Get { .. }
                | MutationStep::Guard { .. }
                | MutationStep::Let { .. } => None,
            };
            if let Some(target) = generic_target
                && schema.table(target).is_some_and(|t| t.membership.is_some())
            {
                return Err(membership_hostplan_write_denied(target));
            }
        }

        let mut bindings = BTreeMap::new();
        let direct_input = input.auth.direct_authorization_baseline().map(|auth| {
            let mut direct = input.clone();
            direct.auth = auth;
            direct
        });
        let mut direct_bindings = direct_input.as_ref().map(|_| BTreeMap::new());
        let mut changes = Vec::new();
        let mut read_dependencies: Vec<CapturedReadDependency> = Vec::new();
        // Every host-generated id in answer order — the IR half of the
        // ctx-answer ledger (LLP 0051 D1's `generatedIds`), reported by
        // dry-run as `deterministicInputs`.
        let plan_ids = RefCell::new(PlanIdSource::new(replay_ledger));
        let next_id = || plan_ids.borrow_mut().next();

        for step in &plan.steps {
            check_live()?;
            match step {
                MutationStep::Insert {
                    table,
                    values,
                    bind_id_as,
                } => {
                    let table = schema_table(&schema, table)?;
                    // @ref LLP 0056 — a protected resource may not be created
                    //   without seating its bootstrap holder (bootstrap path
                    //   only); a HostPlan generic insert cannot do that.
                    enforce_protected_resource_insert_guard(&schema, &table.name)?;
                    let id = next_id()?;
                    if let Some(binding) = bind_id_as {
                        let value = Value::String(id.clone());
                        bindings.insert(binding.clone(), value.clone());
                        if let Some(direct) = direct_bindings.as_mut() {
                            direct.insert(binding.clone(), value);
                        }
                    }

                    let row = eval_value_map(values, input, &bindings, now_ms, &next_id)?;
                    let changed_fields = changed_field_names(&row);
                    let document = insert_document(&tx, table, &id, &row, next_version, now_ms)?;
                    record_change(
                        &tx,
                        next_version,
                        &table.name,
                        &id,
                        ChangeOp::Insert,
                        Some(&document),
                        now_ms,
                    )?;
                    changes.push(ChangedRow {
                        table: table.name.clone(),
                        id,
                        op: ChangeOp::Insert,
                        row: Some(document),
                        changed_fields,
                    });
                }
                MutationStep::Patch { table, id, values } => {
                    let table = schema_table(&schema, table)?;
                    if values.is_empty() {
                        continue;
                    }
                    let id = expect_string(
                        eval_expr(id, input, &bindings, now_ms, Some(&next_id))?,
                        "patch id",
                    )?;
                    let row = eval_value_map(values, input, &bindings, now_ms, &next_id)?;
                    let changed_fields = changed_field_names(&row);
                    if patch_document(&tx, table, &id, &row, next_version, now_ms)? {
                        let document = get_document_from_tx(&tx, table, &id)?;
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Update,
                            document.as_ref(),
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Update,
                            row: document,
                            changed_fields,
                        });
                    }
                }
                MutationStep::Delete { table, id } => {
                    let table = schema_table(&schema, table)?;
                    let id = expect_string(
                        eval_expr(id, input, &bindings, now_ms, Some(&next_id))?,
                        "delete id",
                    )?;
                    // @ref LLP 0056 — deleting a resource row does not silently
                    //   orphan its memberships; refuse while any remain (teardown
                    //   via clearForResource is the only path, and it is
                    //   host-bound, not a HostPlan generic delete).
                    enforce_resource_delete_guard(&schema, &tx, &table.name, Some(&id))?;
                    let document = get_document_from_tx(&tx, table, &id)?;
                    if delete_document(&tx, table, &id)? {
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Delete,
                            None,
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Delete,
                            row: document,
                            changed_fields: Vec::new(),
                        });
                    }
                }
                // @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
                // Get binds the row or null; missing is data, not failure. The
                // read runs inside the commit transaction (never stale) and is
                // captured server-side for receipts/overlays; a missing row is a
                // MissingRow entry pinned to the table's change version, the
                // per-row validation shape the buffered path already uses.
                MutationStep::Get {
                    table,
                    id,
                    bind_as,
                    else_error,
                } => {
                    let table = schema_table(&schema, table)?;
                    let id = expect_string(
                        eval_expr(id, input, &bindings, now_ms, Some(&next_id))?,
                        "get id",
                    )?;
                    let document = get_document_from_tx(&tx, table, &id)?;
                    let dependency = match &document {
                        Some(_) => CapturedReadDependency {
                            kind: CapturedReadKind::Row,
                            table: Some(table.name.clone()),
                            id: Some(id.clone()),
                            version: get_row_version(&tx, table, &id)?,
                            predicate: None,
                            rows: Vec::new(),
                            field: None,
                            value: None,
                            order: None,
                            limit: None,
                            result_count: None,
                            boundary: None,
                        },
                        None => CapturedReadDependency {
                            kind: CapturedReadKind::MissingRow,
                            table: Some(table.name.clone()),
                            id: Some(id.clone()),
                            version: Some(table_change_version_from_tx(&tx, &table.name)?),
                            predicate: None,
                            rows: Vec::new(),
                            field: None,
                            value: None,
                            order: None,
                            limit: None,
                            result_count: None,
                            boundary: None,
                        },
                    };
                    read_dependencies.push(dependency);
                    match document {
                        Some(row) => {
                            if let Some(direct) = direct_bindings.as_mut() {
                                direct.insert(bind_as.clone(), row.clone());
                            }
                            bindings.insert(bind_as.clone(), row);
                        }
                        None => {
                            if let Some(code) = else_error {
                                return Err(SnapbackError::error(
                                    code.clone(),
                                    "handler",
                                    format!("get on {} {id} found no row", table.name),
                                )
                                .with_details(json!({
                                    "table": table.name,
                                    "id": id,
                                    "step": "Get",
                                })));
                            }
                            bindings.insert(bind_as.clone(), Value::Null);
                            if let Some(direct) = direct_bindings.as_mut() {
                                direct.insert(bind_as.clone(), Value::Null);
                            }
                        }
                    }
                }
                MutationStep::Guard { cond, else_error } => {
                    let admitted = eval_authorization_decision_values(
                        cond,
                        input,
                        &bindings,
                        direct_bindings.as_ref(),
                        now_ms,
                        Some(&next_id),
                    )?
                    .iter()
                    .all(crate::value_expr::truthy);
                    if !admitted {
                        return Err(SnapbackError::error(
                            else_error.clone(),
                            "handler",
                            "mutation guard failed",
                        )
                        .with_details(json!({ "step": "Guard" })));
                    }
                }
                MutationStep::Let { bind_as, expr } => {
                    let projection_dependent = direct_bindings.as_ref().is_some_and(|direct| {
                        value_expr_depends_on_projection(expr, &bindings, direct)
                    });
                    if projection_dependent && expr.uses_runtime_intrinsic() {
                        return Err(SnapbackError::error(
                            "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED",
                            "auth",
                            "actor-aware authorization bindings cannot depend on runtime clock or id inputs",
                        ));
                    }
                    let value = eval_expr(expr, input, &bindings, now_ms, Some(&next_id))?;
                    if let (Some(direct_input), Some(direct_bindings)) =
                        (direct_input.as_ref(), direct_bindings.as_mut())
                    {
                        let direct_value = if projection_dependent {
                            eval_expr(expr, direct_input, direct_bindings, now_ms, Some(&next_id))?
                        } else {
                            value.clone()
                        };
                        direct_bindings.insert(bind_as.clone(), direct_value);
                    }
                    bindings.insert(bind_as.clone(), value);
                }
                MutationStep::DeleteWhere { table, filter } => {
                    let table = schema_table(&schema, table)?;
                    // Reuse the query WHERE builder so DeleteWhere filters share
                    // matcher/SQL semantics with reads (empty filter = clear).
                    let scan_plan = QueryPlan {
                        table: table.name.clone(),
                        filters: filter.clone(),
                        membership_filters: Vec::new(),
                        order: Vec::new(),
                        limit: None,
                        indexed_by: None,
                    };
                    let (sql, params) = build_query_sql(
                        table,
                        &schema,
                        &scan_plan,
                        input,
                        &bindings,
                        direct_bindings.as_ref(),
                        now_ms,
                        Some(&next_id),
                        None,
                    )?;
                    let rows = {
                        let mut statement = tx.prepare(&sql)?;
                        let columns = statement
                            .column_names()
                            .into_iter()
                            .map(ToOwned::to_owned)
                            .collect::<Vec<_>>();
                        let mut matched = statement.query(params_from_iter(params.iter()))?;
                        let mut rows = Vec::new();
                        while let Some(row) = matched.next()? {
                            check_live()?;
                            rows.push(row_to_document(row, table, &columns)?);
                        }
                        rows
                    };
                    // Row-granular deletes so live_delta membership maintenance
                    // sees each removal, exactly as per-row Delete steps.
                    for row in rows {
                        check_live()?;
                        let Some(id) = row.get("_id").and_then(Value::as_str).map(str::to_owned)
                        else {
                            continue;
                        };
                        // @ref LLP 0056 — a bulk resource delete cannot orphan
                        //   memberships either; each matched resource row is
                        //   guarded exactly like a single Delete.
                        enforce_resource_delete_guard(&schema, &tx, &table.name, Some(&id))?;
                        if delete_document(&tx, table, &id)? {
                            record_change(
                                &tx,
                                next_version,
                                &table.name,
                                &id,
                                ChangeOp::Delete,
                                None,
                                now_ms,
                            )?;
                            changes.push(ChangedRow {
                                table: table.name.clone(),
                                id,
                                op: ChangeOp::Delete,
                                row: Some(row.clone()),
                                changed_fields: Vec::new(),
                            });
                        }
                    }
                }
                MutationStep::InsertEach {
                    table,
                    source,
                    item_as,
                    values,
                } => {
                    let table = schema_table(&schema, table)?;
                    enforce_protected_resource_insert_guard(&schema, &table.name)?;
                    let source_value = eval_expr(source, input, &bindings, now_ms, Some(&next_id))?;
                    let Value::Array(items) = source_value else {
                        return Err(SnapbackError::error(
                            "SNAPBACK_PLAN_SOURCE_INVALID",
                            "runtime",
                            "InsertEach source must evaluate to an array",
                        )
                        .with_details(json!({ "table": table.name })));
                    };
                    if items.len() > crate::value_expr::MAX_INSERT_EACH_FANOUT {
                        return Err(SnapbackError::error(
                            "SNAPBACK_PLAN_BOUNDS",
                            "runtime",
                            format!(
                                "InsertEach fan-out {} exceeds the declared bound ({})",
                                items.len(),
                                crate::value_expr::MAX_INSERT_EACH_FANOUT
                            ),
                        ));
                    }
                    for item in items {
                        check_live()?;
                        // The item binding is scoped to this step's value maps.
                        let mut item_bindings = bindings.clone();
                        item_bindings.insert(item_as.clone(), item);
                        let id = next_id()?;
                        let row = eval_value_map(values, input, &item_bindings, now_ms, &next_id)?;
                        let changed_fields = changed_field_names(&row);
                        let document =
                            insert_document(&tx, table, &id, &row, next_version, now_ms)?;
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Insert,
                            Some(&document),
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Insert,
                            row: Some(document),
                            changed_fields,
                        });
                    }
                }
            }
        }

        if !changes.is_empty() {
            set_version(&tx, next_version)?;
        }

        let result = match &plan.return_value {
            Some(ReturnValue::Literal(value)) => value.clone(),
            Some(ReturnValue::Binding(name)) => bindings.get(name).cloned().unwrap_or(Value::Null),
            Some(ReturnValue::Document { table, id }) => {
                let table = schema_table(&schema, table)?;
                let id = expect_string(
                    eval_expr(id, input, &bindings, now_ms, Some(&next_id))?,
                    "document id",
                )?;
                get_document_from_tx(&tx, table, &id)?.unwrap_or(Value::Null)
            }
            Some(ReturnValue::ChangedCount) | None => json!(changes.len()),
            Some(ReturnValue::Expr(expr)) => {
                eval_expr(expr, input, &bindings, now_ms, Some(&next_id))?
            }
        };

        plan_ids.borrow().ensure_exact_consumption()?;
        let generated_ids = plan_ids.borrow().generated.clone();

        let version = if changes.is_empty() {
            current_version
        } else {
            next_version
        };
        let output_ledger = CtxAnswerLedger {
            version: CTX_ANSWER_LEDGER_VERSION,
            ids: match replay_ledger.as_ref() {
                Some(ledger) => ledger.ids.clone(),
                None => generated_ids.clone(),
            },
            now: now_ms,
            auth_fingerprint: None,
        };
        let output = MutationOutput {
            version,
            changed_count: changes.len(),
            result,
            ctx_ledger: Some(output_ledger),
        };
        let authorization_predecessor = if apply {
            auth_stream::read_authorization_version_on(&tx)?
        } else {
            None
        };
        let authorization = if apply {
            Some(authorization::authorization_commit_hook_in(
                &tx,
                authorization::AuthorizationCommitCause::AppWrites {
                    schema: &schema,
                    changes: &changes,
                },
            )?)
        } else {
            None
        };
        if apply {
            check_live()?;
            let prepared_authorization_commit = prepare_authorization_commit_interlock(
                authorization
                    .as_ref()
                    .expect("an applied mutation has an authorization witness"),
                AuthorizationCommitImpact::AppWrites {
                    schema: &schema,
                    changes: &changes,
                },
                authorization_interlock.as_ref(),
            )?;
            // Targeted room quiescence happens before this process-global
            // fence. The returned guard still lives through tx.commit(), but
            // an affected room cannot make unrelated route admission wait on
            // the admission-controller mutex.
            let _commit_guard = before_commit()?;
            check_live()?;
            if let Some(identity) = identity {
                record_client_mutation_result(&tx, identity, &output)?;
            }
            commit_with_prepared_authorization_interlock(
                tx,
                authorization
                    .as_ref()
                    .expect("an applied mutation has an authorization witness"),
                authorization_predecessor,
                version,
                prepared_authorization_commit,
            )?;
        } else {
            // Execute-and-discard (LLP 0051 D8): everything above — writes,
            // change-log records, the version bump — evaporates here.
            tx.rollback()?;
        }

        Ok(MutationPlanExecution {
            commit: MutationCommit {
                output,
                write_dependencies: captured_writes_from_changes(&changes),
                changes,
                read_dependencies,
                authorization,
            },
            generated_ids,
            now_ms,
            snapshot_version: current_version,
        })
    }

    pub fn commit_buffered_writes(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
    ) -> SnapbackResult<MutationCommit> {
        self.apply_buffered_writes(
            input,
            writes,
            read_dependencies,
            result,
            BufferedCommitOptions {
                ctx_ledger: None,
                apply: true,
                identity: None,
            },
        )
    }

    /// Detached-action buffered commit with the same lifecycle split as
    /// [`Self::execute_mutation_guarded`]: build and validate the transaction
    /// under caller checks, then hold the caller's guard only across COMMIT.
    pub(crate) fn commit_buffered_writes_idempotent_guarded<G, Check, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        payload: BufferedCommitPayload,
        identity: Option<&ClientMutationIdentity>,
        check_live: Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        let BufferedCommitPayload {
            writes,
            membership_plans,
            read_dependencies,
            result,
            ctx_ledger,
        } = payload;
        self.apply_buffered_writes_with_lifecycle(
            input,
            BufferedEffects {
                writes,
                membership_plans,
                read_dependencies,
                result,
            },
            BufferedCommitOptions {
                ctx_ledger: Some(ctx_ledger),
                apply: true,
                identity,
            },
            &check_live,
            before_commit,
        )
    }

    /// Dry-run the buffered-write commit (LLP 0051 D8): identical read-set
    /// validation and write application as `commit_buffered_writes`, rolled
    /// back instead of committed. The JS-tier half of execute-and-discard —
    /// the handler already ran against the buffered ctx; this answers what
    /// its writes would do without keeping them.
    pub(crate) fn dry_run_buffered_writes(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        membership_plans: Vec<AuthorizedMembershipPlan>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
        ctx_ledger: CtxAnswerLedger,
    ) -> SnapbackResult<MutationCommit> {
        self.apply_buffered_writes_with_lifecycle_gated(
            input,
            BufferedEffects {
                writes,
                membership_plans,
                read_dependencies,
                result,
            },
            BufferedCommitOptions {
                ctx_ledger: Some(ctx_ledger),
                apply: false,
                identity: None,
            },
            MembershipCommitAuthority::deny(),
            &|| Ok(()),
            || Ok(()),
        )
    }

    fn apply_buffered_writes(
        &mut self,
        input: &HandlerInput,
        writes: Vec<BufferedWrite>,
        read_dependencies: Vec<CapturedReadDependency>,
        result: Value,
        options: BufferedCommitOptions<'_>,
    ) -> SnapbackResult<MutationCommit> {
        self.apply_buffered_writes_with_lifecycle_gated(
            input,
            BufferedEffects {
                writes,
                membership_plans: Vec::new(),
                read_dependencies,
                result,
            },
            options,
            MembershipCommitAuthority::deny(),
            &|| Ok(()),
            || Ok(()),
        )
    }

    fn apply_buffered_writes_with_lifecycle<G, Check, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        effects: BufferedEffects,
        options: BufferedCommitOptions<'_>,
        check_live: &Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.apply_buffered_writes_with_lifecycle_gated(
            input,
            effects,
            options,
            MembershipCommitAuthority::deny(),
            check_live,
            before_commit,
        )
    }

    fn apply_buffered_writes_with_lifecycle_gated<G, Check, BeforeCommit>(
        &mut self,
        input: &HandlerInput,
        effects: BufferedEffects,
        options: BufferedCommitOptions<'_>,
        membership_authority: MembershipCommitAuthority<'_>,
        check_live: &Check,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<MutationCommit>
    where
        Check: Fn() -> SnapbackResult<()>,
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        crate::exec_guard::debug_assert_off_async_worker("a SQLite commit");
        check_live()?;
        let BufferedEffects {
            writes,
            membership_plans,
            mut read_dependencies,
            result,
        } = effects;
        for authorized in &membership_plans {
            read_dependencies.extend(authorized.plan.read_dependencies.iter().cloned());
        }
        // @ref LLP 0003#execution-and-write-semantics — JS ctx.db writes are buffered during handler execution and committed once after completion.
        let schema = self.schema.clone();
        // The handler's frozen clock is part of the buffered effect, not a
        // value to rediscover at reconnect/commit time. Replay, optimistic
        // output, persisted system fields, and the journal therefore share
        // one timestamp (LLP 0007 §Timestamps; LLP 0051 D1).
        let now_ms = options
            .ctx_ledger
            .as_ref()
            .or(input.ctx_ledger.as_ref())
            .map(|ledger| ledger.now)
            .unwrap_or_else(now_millis);
        validate_portable_timestamp_millis(now_ms)?;
        let current_version = self.current_version()?;
        let next_version = current_version + 1;
        let authorization_interlock = self.authorization_interlock.clone();
        let tx = self.conn.transaction()?;

        validate_read_set(&tx, &schema, &input.read_set)?;
        // @ref LLP 0020#phase-3-capture-read-sets-during-handler-execution — handler-captured dependencies are validated at commit so callers no longer own the read-set.
        validate_captured_read_set(&tx, &schema, input, &read_dependencies)?;

        let mut carried_writes: Vec<_> = writes
            .into_iter()
            .map(|write| {
                (
                    write,
                    membership_authority.gate,
                    membership_authority.writer.cloned(),
                )
            })
            .collect();
        for authorized in membership_plans {
            carried_writes.extend(authorized.plan.writes.into_iter().map(|write| {
                (
                    write,
                    MembershipWriteGate::Sanctioned,
                    Some(authorized.writer.clone()),
                )
            }));
        }

        let mut changes = Vec::new();
        for (write, write_gate, write_writer) in carried_writes {
            check_live()?;
            if write_gate == MembershipWriteGate::Sanctioned {
                revalidate_sanctioned_membership_write(&schema, &tx, &write)?;
            }
            // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
            //   the writer-class seam. A raw `ctx.db` membership-table write, and
            //   a resource delete that would orphan memberships, are refused here
            //   below both buffered Ibex writes and HostPlan. `Sanctioned` writes
            //   come from the host-evaluated generated methods, which already
            //   authorized them.
            let guard_op = match &write {
                BufferedWrite::Insert { .. } => MembershipGuardOp::Insert,
                BufferedWrite::Patch { .. } => MembershipGuardOp::Patch,
                BufferedWrite::Delete { .. } => MembershipGuardOp::Delete,
            };
            enforce_membership_write_gate(
                &schema,
                &tx,
                write.table(),
                guard_op,
                Some(write.id()),
                write_gate,
            )?;
            match write {
                BufferedWrite::Insert { table, id, values } => {
                    let table = schema_table(&schema, &table)?;
                    let changed_fields = changed_field_names(&values);
                    let document = insert_document(&tx, table, &id, &values, next_version, now_ms)?;
                    write_membership_creation_provenance(
                        &tx,
                        table,
                        &id,
                        write_writer.as_ref(),
                    )?;
                    record_membership_transition(
                        &tx,
                        table,
                        ChangeOp::Insert,
                        None,
                        Some(&document),
                        &changed_fields,
                        next_version,
                        write_writer.as_ref(),
                    )?;
                    record_change(
                        &tx,
                        next_version,
                        &table.name,
                        &id,
                        ChangeOp::Insert,
                        Some(&document),
                        now_ms,
                    )?;
                    changes.push(ChangedRow {
                        table: table.name.clone(),
                        id,
                        op: ChangeOp::Insert,
                        row: Some(document),
                        changed_fields,
                    });
                }
                BufferedWrite::Patch { table, id, values } => {
                    let table = schema_table(&schema, &table)?;
                    if values.is_empty() {
                        continue;
                    }
                    let before = get_document_from_tx(&tx, table, &id)?;
                    let changed_fields = changed_field_names(&values);
                    if patch_document(&tx, table, &id, &values, next_version, now_ms)? {
                        let document = get_document_from_tx(&tx, table, &id)?;
                        record_membership_transition(
                            &tx,
                            table,
                            ChangeOp::Update,
                            before.as_ref(),
                            document.as_ref(),
                            &changed_fields,
                            next_version,
                            write_writer.as_ref(),
                        )?;
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Update,
                            document.as_ref(),
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Update,
                            row: document,
                            changed_fields,
                        });
                    }
                }
                BufferedWrite::Delete { table, id } => {
                    let table = schema_table(&schema, &table)?;
                    let document = get_document_from_tx(&tx, table, &id)?;
                    if delete_document(&tx, table, &id)? {
                        record_membership_transition(
                            &tx,
                            table,
                            ChangeOp::Delete,
                            document.as_ref(),
                            None,
                            &[],
                            next_version,
                            write_writer.as_ref(),
                        )?;
                        record_change(
                            &tx,
                            next_version,
                            &table.name,
                            &id,
                            ChangeOp::Delete,
                            None,
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: table.name.clone(),
                            id,
                            op: ChangeOp::Delete,
                            row: document,
                            changed_fields: Vec::new(),
                        });
                    }
                }
            }
        }

        if !changes.is_empty() {
            set_version(&tx, next_version)?;
        }

        let version = if changes.is_empty() {
            current_version
        } else {
            next_version
        };
        let output = MutationOutput {
            version,
            changed_count: changes.len(),
            result,
            ctx_ledger: options.ctx_ledger,
        };
        let authorization_predecessor = if options.apply {
            auth_stream::read_authorization_version_on(&tx)?
        } else {
            None
        };
        let authorization = if options.apply {
            Some(authorization::authorization_commit_hook_in(
                &tx,
                authorization::AuthorizationCommitCause::AppWrites {
                    schema: &schema,
                    changes: &changes,
                },
            )?)
        } else {
            None
        };
        if options.apply {
            check_live()?;
            let prepared_authorization_commit = prepare_authorization_commit_interlock(
                authorization
                    .as_ref()
                    .expect("an applied mutation has an authorization witness"),
                AuthorizationCommitImpact::AppWrites {
                    schema: &schema,
                    changes: &changes,
                },
                authorization_interlock.as_ref(),
            )?;
            // No handler/plan or targeted room wait runs under this guard; it
            // linearizes only identity recording plus the final SQLite COMMIT.
            let _commit_guard = before_commit()?;
            check_live()?;
            if let Some(identity) = options.identity {
                record_client_mutation_result(&tx, identity, &output)?;
            }
            commit_with_prepared_authorization_interlock(
                tx,
                authorization
                    .as_ref()
                    .expect("an applied mutation has an authorization witness"),
                authorization_predecessor,
                version,
                prepared_authorization_commit,
            )?;
        } else {
            // Execute-and-discard (LLP 0051 D8): validated and applied above,
            // discarded here.
            tx.rollback()?;
        }

        Ok(MutationCommit {
            output,
            write_dependencies: captured_writes_from_changes(&changes),
            changes,
            read_dependencies,
            authorization,
        })
    }

    fn configure(&mut self, file_backed: bool) -> SnapbackResult<()> {
        self.conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;
            ",
        )?;
        if file_backed {
            self.conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        }
        Ok(())
    }

    fn create_infra(&mut self) -> SnapbackResult<()> {
        // @ref LLP 0003#database-model — the local SQLite core owns meta, version, and change tables.
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS _snapback_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS _snapback_version (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              version INTEGER NOT NULL
            );
            INSERT INTO _snapback_version(id, version)
            VALUES(1, 0)
            ON CONFLICT(id) DO NOTHING;
            CREATE TABLE IF NOT EXISTS _snapback_changes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              version INTEGER NOT NULL,
              table_name TEXT NOT NULL,
              row_id TEXT NOT NULL,
              op TEXT NOT NULL,
              row_json TEXT,
              changed_at_ms INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS _snapback_changes_by_version
              ON _snapback_changes(version, id);
            -- @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3: the
            -- per-mutation read-set validation runs MAX(version) WHERE
            -- table_name = ?, which was a full scan on the (version, id) index.
            CREATE INDEX IF NOT EXISTS _snapback_changes_by_table_version
              ON _snapback_changes(table_name, version);
            -- @ref LLP 0056#agents -- full membership provenance is an
            -- append-only durable record, including transitions whose source
            -- membership row is later deleted.
            CREATE TABLE IF NOT EXISTS _snapback_membership_transitions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              declaration_id TEXT NOT NULL,
              op TEXT NOT NULL,
              principal TEXT NOT NULL,
              resource TEXT,
              from_role TEXT,
              to_role TEXT,
              actor TEXT NOT NULL,
              effective TEXT NOT NULL,
              grant_id TEXT,
              commit_version INTEGER NOT NULL CHECK(commit_version >= 0),
              writer_class TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS _snapback_membership_transitions_by_declaration
              ON _snapback_membership_transitions(declaration_id, commit_version, id);
            -- LLP 0043 M2: exactly-once queued replay. The settled output and
            -- data changes are written in one SQLite transaction.
            CREATE TABLE IF NOT EXISTS _snapback_client_mutations (
              client_mutation_id TEXT PRIMARY KEY,
              function TEXT NOT NULL,
              auth_fingerprint TEXT NOT NULL,
              authority_instance_id TEXT,
              input_fingerprint TEXT NOT NULL,
              output_json TEXT NOT NULL,
              settled_at_ms INTEGER NOT NULL,
              settled_version INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS _snapback_client_mutation_auth_retention (
              auth_fingerprint TEXT PRIMARY KEY,
              records INTEGER NOT NULL CHECK(records >= 0),
              bytes INTEGER NOT NULL CHECK(bytes >= 0)
            );
            -- @ref LLP 0053#invalidation-is-an-obligation-not-a-message —
            -- retry episodes are durable auth-control state, never outbox
            -- messages or process-local timer records.
            CREATE TABLE IF NOT EXISTS _snapback_auth_retry_episodes (
              authority_subject TEXT NOT NULL,
              client_store_id TEXT NOT NULL,
              query_key TEXT NOT NULL,
              episode_json TEXT NOT NULL,
              PRIMARY KEY(authority_subject, client_store_id, query_key)
            );
            CREATE TABLE IF NOT EXISTS _snapback_auth_retry_counters (
              authority_subject TEXT NOT NULL,
              client_store_id TEXT NOT NULL,
              records INTEGER NOT NULL CHECK(records >= 0),
              PRIMARY KEY(authority_subject, client_store_id)
            );
            -- @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client —
            -- a request id is consumed only at the same linearization point
            -- that rechecks data/auth/activation and the server clock.
            CREATE TABLE IF NOT EXISTS _snapback_authorized_lease_reservations (
              lease_request_id TEXT PRIMARY KEY,
              lease_id TEXT NOT NULL UNIQUE,
              client_store_id TEXT NOT NULL,
              query_key TEXT NOT NULL,
              query_instance_id INTEGER NOT NULL CHECK(query_instance_id > 0),
              principal_id TEXT NOT NULL,
              authorization_incarnation TEXT NOT NULL,
              authorization_epoch INTEGER NOT NULL CHECK(authorization_epoch >= 0),
              version_stream TEXT NOT NULL,
              snapshot_commit_version INTEGER NOT NULL CHECK(snapshot_commit_version >= 0),
              activation_hash TEXT NOT NULL,
              issued_at_server_ms INTEGER NOT NULL CHECK(issued_at_server_ms >= 0),
              authorized_until_server_ms INTEGER NOT NULL CHECK(authorized_until_server_ms > issued_at_server_ms),
              lease_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS _snapback_authorized_lease_expiry
              ON _snapback_authorized_lease_reservations(authorized_until_server_ms);
            ",
        )?;
        // Older databases predate settlement-version metadata. SQLite cannot
        // express ADD COLUMN IF NOT EXISTS, so inspect before applying the
        // additive internal migration.
        let mut columns = self
            .conn
            .prepare("PRAGMA table_info(_snapback_client_mutations)")?;
        let names = columns
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<BTreeSet<_>, _>>()?;
        drop(columns);
        if !names.contains("settled_version") {
            self.conn.execute(
                "ALTER TABLE _snapback_client_mutations
                 ADD COLUMN settled_version INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !names.contains("authority_instance_id") {
            self.conn.execute(
                "ALTER TABLE _snapback_client_mutations
                 ADD COLUMN authority_instance_id TEXT",
                [],
            )?;
        }
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS _snapback_client_mutations_by_settlement
             ON _snapback_client_mutations(settled_version, settled_at_ms)",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS _snapback_client_mutations_by_auth
             ON _snapback_client_mutations(auth_fingerprint)",
            [],
        )?;
        self.ensure_client_mutation_retention_counters()?;
        Ok(())
    }

    /// Install the O(1) retention-accounting metadata for old databases.
    /// Existing ledgers are scanned once only when either counter is absent or
    /// malformed; every later settlement and acknowledgement maintains both
    /// values in the same transaction as its ledger-row change.
    ///
    /// @ref LLP 0043#milestone-2-queued-mutation-replay — refusal limits and
    /// acknowledgement-driven GC must preserve exactly-once settlements.
    fn ensure_client_mutation_retention_counters(&mut self) -> SnapbackResult<()> {
        let tx = self.conn.transaction()?;
        let version = optional_meta_u64_lenient(&tx, META_CLIENT_MUTATION_COUNTERS_VERSION)?;
        let records = optional_meta_u64_lenient(&tx, META_CLIENT_MUTATION_RECORDS)?;
        let bytes = optional_meta_u64_lenient(&tx, META_CLIENT_MUTATION_BYTES)?;
        if version != Some(CLIENT_MUTATION_COUNTERS_VERSION) || records.is_none() || bytes.is_none()
        {
            let (records, bytes) = scan_client_mutation_retention_totals(&tx)?;
            save_meta_u64(&tx, META_CLIENT_MUTATION_RECORDS, records)?;
            save_meta_u64(&tx, META_CLIENT_MUTATION_BYTES, bytes)?;
            tx.execute("DELETE FROM _snapback_client_mutation_auth_retention", [])?;
            tx.execute(
                "INSERT INTO _snapback_client_mutation_auth_retention(
                   auth_fingerprint, records, bytes
                 )
                 SELECT auth_fingerprint, COUNT(*), SUM(
                   length(CAST(client_mutation_id AS BLOB)) +
                   length(CAST(function AS BLOB)) +
                   length(CAST(auth_fingerprint AS BLOB)) +
                   COALESCE(length(CAST(authority_instance_id AS BLOB)), 0) +
                   length(CAST(input_fingerprint AS BLOB)) +
                   length(CAST(output_json AS BLOB))
                 )
                 FROM _snapback_client_mutations
                 GROUP BY auth_fingerprint",
                [],
            )?;
            save_meta_u64(
                &tx,
                META_CLIENT_MUTATION_COUNTERS_VERSION,
                CLIENT_MUTATION_COUNTERS_VERSION,
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

fn load_schema_manifest_from_connection(
    conn: &Connection,
) -> SnapbackResult<Option<SchemaManifest>> {
    let has_meta = conn
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_snapback_meta'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !has_meta {
        return Ok(None);
    }

    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![META_SCHEMA_MANIFEST],
            |row| row.get(0),
        )
        .optional()?;

    value
        .map(|value| {
            serde_json::from_str(&value).map_err(|error| {
                SnapbackError::error(
                    "SNAPBACK_SCHEMA_PARSE_FAILED",
                    "schema",
                    "stored schema manifest could not be parsed",
                )
                .with_detail("error", error.to_string())
            })
        })
        .transpose()
}

/// Resolve one schema-checked room membership projection on any SQLite
/// connection. A read-lane caller supplies a pinned WAL transaction so the
/// permission row, data head, and authorization witness share one snapshot.
///
/// @ref LLP 0053#ephemeral-room-authority-invalidation — durable room
/// permission lookup must remain on the admitted side of the commit barrier.
pub(crate) fn room_permission_projection_granted_on(
    conn: &Connection,
    schema: &SchemaManifest,
    table_name: &str,
    subject_field: &str,
    user_id: &str,
    scope_fields: &[(String, String)],
    min_commit_version: u64,
) -> SnapbackResult<bool> {
    let observed = current_version_on(conn)?;
    if observed < min_commit_version {
        return Err(SnapbackError::error(
            "SNAPBACK_EPHEMERAL_AUTHORITY_PENDING",
            "ephemeral",
            "durable permission snapshot has not reached the room authorization cause",
        )
        .with_detail("observedVersion", observed)
        .with_detail("minCommitVersion", min_commit_version));
    }
    let table = schema_table(schema, table_name)?;
    ensure_field(table, subject_field)?;
    for (field, _) in scope_fields {
        ensure_field(table, field)?;
    }
    let mut predicates = vec![format!("{} = ?1", quote_ident(subject_field)?)];
    for (index, (field, _)) in scope_fields.iter().enumerate() {
        predicates.push(format!("{} = ?{}", quote_ident(field)?, index + 2));
    }
    let sql = format!(
        "SELECT EXISTS(SELECT 1 FROM {} WHERE {} LIMIT 1)",
        quote_ident(table_name)?,
        predicates.join(" AND ")
    );
    let values = std::iter::once(SqlValue::Text(user_id.to_owned()))
        .chain(
            scope_fields
                .iter()
                .map(|(_, value)| SqlValue::Text(value.clone())),
        )
        .collect::<Vec<_>>();
    let granted: i64 = conn.query_row(&sql, params_from_iter(values.iter()), |row| row.get(0))?;
    Ok(granted != 0)
}

/// Read the complete durable authorization witness from the caller's pinned
/// transaction. Missing state is never interpreted as continuity.
pub(crate) fn authorization_version_on(conn: &Connection) -> SnapbackResult<AuthorizationVersion> {
    auth_stream::read_authorization_version_on(conn)?.ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_AUTHORIZATION_VERSION_CORRUPT",
            "auth",
            "authorization-version metadata is missing",
        )
    })
}

/// Read a query plan against any connection: shared by the write lane (the
/// live connection, serialized under the global mutex) and the read lane (a
/// pooled reader inside a pinned WAL read transaction). The version is read
/// after the rows on purpose — inside a read transaction both come from the
/// pinned snapshot; on the write lane the global mutex serializes writers.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6: the
/// version/rows pair must come from one snapshot; the read lane guarantees it
/// with a pinned read transaction instead of the global mutex.
pub(crate) fn query_on(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &QueryPlan,
    input: &HandlerInput,
) -> SnapbackResult<QueryOutput> {
    query_on_with_storage_limit(conn, schema, plan, input, effective_query_limit(plan))
}

pub(crate) fn query_on_with_storage_limit(
    conn: &Connection,
    schema: &SchemaManifest,
    plan: &QueryPlan,
    input: &HandlerInput,
    storage_limit: usize,
) -> SnapbackResult<QueryOutput> {
    crate::exec_guard::debug_assert_off_async_worker("a SQLite query");
    let table = schema_table(schema, &plan.table)?;
    validate_query_plan_shape(plan)?;
    // LLP 0056 M3: fail-closed validation of each declaration-bound membership
    // predicate against the schema and the queried table — an unknown
    // declaration, an out-of-vocabulary `hasRole`, or a resource row field that
    // is not a field of the queried table is refused before the query runs.
    for predicate in &plan.membership_filters {
        crate::membership_rules::validate_membership_predicate(schema, table, predicate)?;
    }
    if storage_limit > QUERY_INTERNAL_OVERFETCH_MAX {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_LIMIT_INVALID",
            "query",
            format!(
                "internal query overfetch {storage_limit} exceeds {QUERY_INTERNAL_OVERFETCH_MAX}"
            ),
        ));
    }
    validate_query_index(table, plan)?;
    let (sql, values) = build_query_sql(
        table,
        schema,
        plan,
        input,
        &BTreeMap::new(),
        None,
        now_millis(),
        None,
        Some(storage_limit),
    )?;
    let mut statement = conn.prepare(&sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query(params_from_iter(values.iter()))?;
    let mut output = Vec::new();

    while let Some(row) = rows.next()? {
        output.push(row_to_document(row, table, &columns)?);
    }

    Ok(QueryOutput {
        version: current_version_on(conn)?,
        rows: output,
    })
}

pub(crate) fn get_on(
    conn: &Connection,
    schema: &SchemaManifest,
    table: &str,
    id: &str,
) -> SnapbackResult<Option<Value>> {
    crate::exec_guard::debug_assert_off_async_worker("a SQLite point read");
    let table = schema_table(schema, table)?;
    let sql = format!("SELECT * FROM {} WHERE _id = ?1", quote_ident(&table.name)?);
    let mut statement = conn.prepare(&sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row_to_document(row, table, &columns)?))
    } else {
        Ok(None)
    }
}

pub(crate) fn current_version_on(conn: &Connection) -> SnapbackResult<u64> {
    crate::exec_guard::debug_assert_off_async_worker("a SQLite version read");
    let version: i64 = conn.query_row(
        "SELECT version FROM _snapback_version WHERE id = 1",
        [],
        |row| row.get(0),
    )?;
    Ok(version as u64)
}

/// A read-only storage view for query execution on either lane.
///
/// `Live` borrows the write connection (serialized under the global instance
/// mutex). `Pinned` is a pooled read-only connection inside a WAL read
/// transaction: every read through it (rows, versions, change high-waters)
/// comes from one snapshot. Actions carry no view at all — their `ctx.db`
/// reads route through the action host, which chooses the locking policy per
/// call (ENG-23324).
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L6.
pub enum DbRead<'a> {
    Live(&'a LocalDatabase),
    Pinned {
        conn: &'a Connection,
        schema: &'a SchemaManifest,
    },
}

impl DbRead<'_> {
    fn live(&self) -> Option<&LocalDatabase> {
        match self {
            DbRead::Live(db) => Some(db),
            DbRead::Pinned { .. } => None,
        }
    }

    /// The schema backing this read view — used by LLP 0056 membership helpers
    /// to resolve a declaration id to its table and field names.
    pub(crate) fn schema(&self) -> &SchemaManifest {
        match self {
            DbRead::Pinned { schema, .. } => schema,
            DbRead::Live(db) => db.schema(),
        }
    }

    pub fn query(&self, plan: &QueryPlan, input: &HandlerInput) -> SnapbackResult<QueryOutput> {
        match self {
            DbRead::Pinned { conn, schema } => query_on(conn, schema, plan, input),
            _ => self.live().expect("live db").query(plan, input),
        }
    }

    pub(crate) fn query_with_storage_limit(
        &self,
        plan: &QueryPlan,
        input: &HandlerInput,
        storage_limit: usize,
    ) -> SnapbackResult<QueryOutput> {
        match self {
            DbRead::Pinned { conn, schema } => {
                query_on_with_storage_limit(conn, schema, plan, input, storage_limit)
            }
            _ => self
                .live()
                .expect("live db")
                .query_with_storage_limit(plan, input, storage_limit),
        }
    }

    pub fn get(&self, table: &str, id: &str) -> SnapbackResult<Option<Value>> {
        match self {
            DbRead::Pinned { conn, schema } => get_on(conn, schema, table, id),
            _ => self.live().expect("live db").get(table, id),
        }
    }

    pub fn table_change_version(&self, table: &str) -> SnapbackResult<u64> {
        match self {
            DbRead::Pinned { conn, schema } => {
                let table = schema_table(schema, table)?;
                table_change_version_from_connection(conn, &table.name)
            }
            _ => self.live().expect("live db").table_change_version(table),
        }
    }

    pub fn current_version(&self) -> SnapbackResult<u64> {
        match self {
            DbRead::Pinned { conn, .. } => current_version_on(conn),
            _ => self.live().expect("live db").current_version(),
        }
    }

    pub fn generate_id(&self) -> String {
        new_id()
    }
}

/// How many idle reader connections the pool retains. Checkout never waits:
/// an empty pool opens a fresh read-only connection on demand, and check-in
/// drops connections beyond this cap, so the pool itself has no blocking or
/// deadlock surface.
const READER_POOL_RETAINED: usize = 4;

/// A pool of read-only WAL connections for the lock-free read lane.
///
/// @ref LLP 0003#database-model — queries run read-only against a WAL reader
/// pool and need not take the write lock at all.
pub struct ReaderPool {
    path: PathBuf,
    idle: Mutex<Vec<Connection>>,
}

impl ReaderPool {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            idle: Mutex::new(Vec::new()),
        }
    }

    pub fn checkout(&self) -> SnapbackResult<PooledReader<'_>> {
        crate::exec_guard::debug_assert_off_async_worker("a reader-pool checkout");
        let pooled = self
            .idle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pop();
        let conn = match pooled {
            Some(conn) => conn,
            None => self.open_reader()?,
        };
        Ok(PooledReader {
            pool: self,
            conn: Some(conn),
        })
    }

    fn open_reader(&self) -> SnapbackResult<Connection> {
        let conn = Connection::open_with_flags(
            &self.path,
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_URI
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.execute_batch(
            "
            PRAGMA query_only = ON;
            PRAGMA busy_timeout = 5000;
            ",
        )?;
        Ok(conn)
    }

    fn check_in(&self, conn: Connection) {
        let mut idle = self
            .idle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if idle.len() < READER_POOL_RETAINED {
            idle.push(conn);
        }
    }
}

/// A checked-out reader connection; returns to the pool on drop.
pub struct PooledReader<'a> {
    pool: &'a ReaderPool,
    conn: Option<Connection>,
}

impl PooledReader<'_> {
    pub fn conn(&self) -> &Connection {
        self.conn.as_ref().expect("pooled reader connection")
    }
}

impl Drop for PooledReader<'_> {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take() {
            self.pool.check_in(conn);
        }
    }
}

trait WithDetail {
    fn with_detail(self, key: &str, value: impl Into<Value>) -> Self;
}

impl WithDetail for SnapbackError {
    fn with_detail(mut self, key: &str, value: impl Into<Value>) -> Self {
        if !self.diagnostic.details.is_object() {
            self.diagnostic.details = Value::Object(Map::new());
        }
        self.diagnostic.details[key] = value.into();
        self
    }
}

/// The reserved caller-class identifiers that a role literal must never
/// shadow: they name caller *classes* in the transition matrix, not roles.
/// @ref LLP 0056#declaring-a-membership-table — `"self"`/`"none"` are reserved.
const MEMBERSHIP_RESERVED_ROLE_NAMES: [&str; 2] = ["self", "none"];

fn membership_error(
    code: &str,
    table: &str,
    declaration: &str,
    message: impl Into<String>,
) -> SnapbackError {
    SnapbackError::error(code, "schema", message.into())
        .with_detail("table", table.to_owned())
        .with_detail("declaration", declaration.to_owned())
}

/// Validate one role literal against the closed-vocabulary rules: non-empty, no
/// reserved caller-class name, no reserved `:` separator, no control
/// characters. Comparison is by **exact decoded value** — no case folding, no
/// Unicode normalization — so two writers can never disagree about whether a
/// role is declared.
///
/// @ref LLP 0056#declaring-a-membership-table — reserved names, the `:`
///   separator, control-character rejection, exact-decoded comparison.
fn validate_membership_role_literal(
    table: &str,
    declaration: &str,
    role: &str,
    axis: &str,
) -> SnapbackResult<()> {
    if role.is_empty() {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ROLE_EMPTY",
            table,
            declaration,
            format!("{axis} contains an empty role literal"),
        ));
    }
    if MEMBERSHIP_RESERVED_ROLE_NAMES.contains(&role) {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_RESERVED_ROLE",
            table,
            declaration,
            format!(
                "role {role:?} is a reserved caller class in the transition matrix, not a role"
            ),
        )
        .with_detail("role", role.to_owned()));
    }
    if role.contains(':') {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ROLE_RESERVED_SEPARATOR",
            table,
            declaration,
            format!(
                "role {role:?} contains the reserved ':' separator (reserved for a future \
                 cross-declaration spelling such as \"appRoles:admin\")"
            ),
        )
        .with_detail("role", role.to_owned()));
    }
    if role.chars().any(char::is_control) {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ROLE_CONTROL_CHARACTER",
            table,
            declaration,
            format!("role {role:?} contains a control character"),
        )
        .with_detail("role", role.to_owned()));
    }
    Ok(())
}

/// Fail-closed structural validation of one `.membership()` declaration. This
/// is the M1 declaration surface for LLP 0056: it enforces the closed, non-null,
/// exact-decoded vocabulary, the immutable-axis field shape, the reserved-name
/// traps, the `roles`/`pendingRoles` disjointness, the stable-id uniqueness, and
/// reserves the generated unique index's physical name. It does **not** execute
/// the transition matrix (M2), wire invalidation (M5), or fill provenance (M5).
fn validate_membership_declaration(
    table: &TableManifest,
    field_names: &BTreeSet<String>,
    physical_index_names: &mut BTreeMap<String, String>,
    declaration_ids: &mut BTreeMap<String, String>,
) -> SnapbackResult<()> {
    let Some(membership) = &table.membership else {
        return Ok(());
    };
    let declaration = membership.effective_id(&table.name).to_owned();

    if let Some(field) = table
        .fields
        .iter()
        .find(|field| MEMBERSHIP_PROVENANCE_COLUMNS.contains(&field.name.as_str()))
    {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_PROVENANCE_FIELD_RESERVED",
            &table.name,
            &declaration,
            format!(
                "field {:?} is host-managed membership provenance and cannot be app-declared",
                field.name
            ),
        )
        .with_detail("field", field.name.clone()));
    }

    // The derivation owns the table: a hand-written permissionBacking is a
    // conflicting second authorization declaration over the same rows.
    // @ref LLP 0056#declaring-a-membership-table — declaring `.membership()`
    //   alongside `permissionBacking` is a typed manifest error.
    if table.permission_backing || table.permission_fields.is_some() {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_PERMISSION_BACKING_CONFLICT",
            &table.name,
            &declaration,
            "a membership table must not also declare permissionBacking/permissionFields; the \
             derivation owns the table",
        ));
    }

    // --- Stable declaration id: shape + manifest-global uniqueness. ---
    if let Some(pinned) = &membership.id
        && !is_identifier(pinned)
    {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ID_INVALID",
            &table.name,
            &declaration,
            format!("pinned declaration id {pinned:?} is not a valid identifier"),
        ));
    }
    if let Some(previous) = declaration_ids.insert(declaration.clone(), table.name.clone()) {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ID_COLLISION",
            &table.name,
            &declaration,
            format!(
                "membership declaration id {declaration:?} is already used by table {previous:?}; \
                 ids are unique across the manifest"
            ),
        )
        .with_detail("otherTable", previous));
    }

    // --- Axes: existence, non-optional, correct nominal type, distinctness. ---
    let principal_field =
        require_membership_axis_field(table, &declaration, &membership.principal, "principal")?;
    if principal_field.field_type != FieldType::Principal {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_PRINCIPAL_TYPE",
            &table.name,
            &declaration,
            format!(
                "principal axis {:?} must be declared v.principal(); found {}",
                membership.principal,
                field_type_name(&principal_field.field_type)
            ),
        ));
    }

    let role_field = require_membership_axis_field(table, &declaration, &membership.role, "role")?;
    if role_field.field_type != FieldType::String {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ROLE_TYPE",
            &table.name,
            &declaration,
            format!(
                "role axis {:?} must be a string; found {}",
                membership.role,
                field_type_name(&role_field.field_type)
            ),
        ));
    }

    let mut axis_fields = vec![membership.principal.as_str(), membership.role.as_str()];
    match membership.scope {
        MembershipScope::Resource => {
            let resource = membership.resource.as_deref().ok_or_else(|| {
                membership_error(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_AXIS_REQUIRED",
                    &table.name,
                    &declaration,
                    "a resource-scoped membership must declare a non-null resource field",
                )
            })?;
            let resource_field =
                require_membership_axis_field(table, &declaration, resource, "resource")?;
            if !matches!(
                resource_field.field_type,
                FieldType::String | FieldType::Principal
            ) {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_TYPE",
                    &table.name,
                    &declaration,
                    format!(
                        "resource axis {resource:?} must be an id/string reference; found {}",
                        field_type_name(&resource_field.field_type)
                    ),
                ));
            }
            axis_fields.push(resource);
        }
        MembershipScope::App => {
            if membership.resource.is_some() {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_APP_SCOPE_RESOURCE",
                    &table.name,
                    &declaration,
                    "an app-scoped membership (scope: \"app\") must not declare a resource field; \
                     its resource is a system-constant singleton",
                ));
            }
            if membership.resource_table.is_some() {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_APP_SCOPE_RESOURCE_TABLE",
                    &table.name,
                    &declaration,
                    "an app-scoped membership has no resource table",
                ));
            }
        }
    }
    {
        let mut seen = BTreeSet::new();
        for axis in &axis_fields {
            if !seen.insert(*axis) {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_AXIS_COLLISION",
                    &table.name,
                    &declaration,
                    format!("field {axis:?} is used for more than one membership axis"),
                ));
            }
        }
    }

    // --- Role vocabulary: non-empty, valid literals, roles/pending disjoint,
    //     union is closed; confusable near-duplicates refused. ---
    if membership.roles.is_empty() {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_EMPTY_VOCABULARY",
            &table.name,
            &declaration,
            "roles must declare at least one role",
        ));
    }
    let mut roles = BTreeSet::new();
    for role in &membership.roles {
        validate_membership_role_literal(&table.name, &declaration, role, "roles")?;
        if !roles.insert(role.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_DUPLICATE_ROLE",
                &table.name,
                &declaration,
                format!("roles repeats {role:?}"),
            ));
        }
    }
    let mut pending = BTreeSet::new();
    for role in membership.pending_roles.iter().flatten() {
        validate_membership_role_literal(&table.name, &declaration, role, "pendingRoles")?;
        if roles.contains(role.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_ROLE_PENDING_OVERLAP",
                &table.name,
                &declaration,
                format!("{role:?} appears in both roles and pendingRoles; they must be disjoint"),
            )
            .with_detail("role", role.clone()));
        }
        if !pending.insert(role.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_DUPLICATE_ROLE",
                &table.name,
                &declaration,
                format!("pendingRoles repeats {role:?}"),
            ));
        }
    }
    // The closed write vocabulary is `roles ∪ pendingRoles`.
    let vocabulary: BTreeSet<&str> = roles
        .iter()
        .copied()
        .chain(pending.iter().copied())
        .collect();
    // Confusable near-duplicates: two roles that differ only by ASCII case
    // would let a `"Host"` write and a `"host"` write disagree about the same
    // authority. M1 refuses the declaration (fail-closed); broader Unicode
    // confusable folding is a follow-on.
    // @ref LLP 0056#declaring-a-membership-table — confusable near-duplicates.
    let mut folded: BTreeMap<String, &str> = BTreeMap::new();
    for role in &vocabulary {
        let key = role.to_ascii_lowercase();
        if let Some(previous) = folded.insert(key, role)
            && previous != *role
        {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_CONFUSABLE_ROLES",
                &table.name,
                &declaration,
                format!(
                    "roles {previous:?} and {role:?} are confusable (differ only by case); role \
                     comparison is exact-decoded, so both cannot be declared"
                ),
            ));
        }
    }

    // --- bootstrapRole ∈ roles. ---
    if let Some(bootstrap) = &membership.bootstrap_role
        && !roles.contains(bootstrap.as_str())
    {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_BOOTSTRAP_ROLE_UNKNOWN",
            &table.name,
            &declaration,
            format!("bootstrapRole {bootstrap:?} is not one of the declared (non-pending) roles"),
        )
        .with_detail("role", bootstrap.clone()));
    }

    // --- lastHolder: resource-scope only; protect ∈ roles; bootstrapRole == protect. ---
    if let Some(last_holder) = &membership.last_holder {
        if membership.scope == MembershipScope::App {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_LAST_HOLDER_APP_SCOPE",
                &table.name,
                &declaration,
                "lastHolder is not available on scope: \"app\" declarations (the singleton has no \
                 creation event to anchor establishment on)",
            ));
        }
        if !roles.contains(last_holder.protect.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_LAST_HOLDER_ROLE_UNKNOWN",
                &table.name,
                &declaration,
                format!(
                    "lastHolder.protect {:?} is not one of the declared (non-pending) roles",
                    last_holder.protect
                ),
            )
            .with_detail("role", last_holder.protect.clone()));
        }
        // Establishment leg: the protected role must be the one the creation
        // witness seats, or the guarantee has no non-vacuous first leg.
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   `bootstrapRole == protect` or it is a manifest error.
        if membership.bootstrap_role.as_deref() != Some(last_holder.protect.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_LAST_HOLDER_BOOTSTRAP_MISMATCH",
                &table.name,
                &declaration,
                format!(
                    "lastHolder.protect {:?} requires bootstrapRole to seat the same role (found {:?})",
                    last_holder.protect, membership.bootstrap_role
                ),
            ));
        }
    }

    // --- expiry: field is a declared non-axis column; remove-only in v1. ---
    if let Some(expiry) = &membership.expiry {
        if !field_names.contains(&expiry.field) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_UNKNOWN",
                &table.name,
                &declaration,
                format!("expiry.field {:?} is not a declared column", expiry.field),
            ));
        }
        if axis_fields.contains(&expiry.field.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_EXPIRY_FIELD_AXIS",
                &table.name,
                &declaration,
                format!(
                    "expiry.field {:?} may not be a membership axis",
                    expiry.field
                ),
            ));
        }
        // Remove is the only v1 effect: with no declared role ordering the host
        // cannot prove a downgrade is non-escalating.
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   remove-only; `downgradeTo:` is a manifest error.
        if expiry.on_expiry != "remove" {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_EXPIRY_EFFECT_UNSUPPORTED",
                &table.name,
                &declaration,
                format!(
                    "expiry.onExpiry {:?} is unsupported; v1 supports only \"remove\" (no declared \
                     role ordering means no provable non-escalation)",
                    expiry.on_expiry
                ),
            ));
        }
    }

    // --- incidental: declared columns, and the hard authorization floor. ---
    for column in membership.incidental.iter().flatten() {
        if !field_names.contains(column) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_INCIDENTAL_UNKNOWN",
                &table.name,
                &declaration,
                format!("incidental names undeclared column {column:?}"),
            ));
        }
        // The floor: the principal/resource/role axes can never be attested
        // incidental. (Generated provenance columns join the floor in M5, when
        // they exist as columns.)
        // @ref LLP 0056#invalidation-the-llp-0053-mapping — the incidental floor.
        if axis_fields.contains(&column.as_str()) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_INCIDENTAL_FLOOR",
                &table.name,
                &declaration,
                format!(
                    "column {column:?} is a membership authorization axis and can never be \
                     attested incidental"
                ),
            )
            .with_detail("column", column.clone()));
        }
    }

    // --- Transition shape: no unknown role hides in by/from/to, no undeclared
    //     column hides in a patch's fields. Runtime evaluation is M2. ---
    for transition in &membership.transitions {
        for by in &transition.by {
            let reserved = MEMBERSHIP_RESERVED_ROLE_NAMES.contains(&by.as_str());
            if !reserved && !vocabulary.contains(by.as_str()) {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_CALLER",
                    &table.name,
                    &declaration,
                    format!(
                        "transition {:?} names caller class {by:?}, which is neither a declared \
                         role nor a reserved class (self/none)",
                        transition.op.as_str()
                    ),
                ));
            }
        }
        for role in transition
            .from
            .iter()
            .flatten()
            .chain(transition.to.iter().flatten())
        {
            if !vocabulary.contains(role.as_str()) {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_ROLE",
                    &table.name,
                    &declaration,
                    format!(
                        "transition {:?} references role {role:?}, which is not in the closed \
                         vocabulary",
                        transition.op.as_str()
                    ),
                )
                .with_detail("role", role.clone()));
            }
        }
        for column in transition.fields.iter().flatten() {
            if !field_names.contains(column) {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_TRANSITION_UNKNOWN_FIELD",
                    &table.name,
                    &declaration,
                    format!(
                        "transition {:?} patches undeclared column {column:?}",
                        transition.op.as_str()
                    ),
                ));
            }
            if axis_fields.contains(&column.as_str()) {
                return Err(membership_error(
                    "SNAPBACK_MEMBERSHIP_TRANSITION_AXIS_FIELD",
                    &table.name,
                    &declaration,
                    format!(
                        "transition {:?} may not patch membership axis {column:?} (axes are \
                         immutable after insert)",
                        transition.op.as_str()
                    ),
                ));
            }
        }
        // `by` on an effect-bearing transition targeting `other` cannot be the
        // reserved `self`. Deeper reachability diagnostics are M2.
        if matches!(transition.target, MembershipTarget::Other)
            && transition.by.iter().any(|by| by == "self")
        {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_TRANSITION_SELF_ON_OTHER",
                &table.name,
                &declaration,
                format!(
                    "transition {:?} uses caller class \"self\" with target \"other\", which is \
                     contradictory",
                    transition.op.as_str()
                ),
            ));
        }
    }

    // --- Reserve the generated unique index's physical name so a user index
    //     cannot silently collide with it. ---
    if let Some((index_name, _)) = membership_unique_index(table) {
        let physical = format!("{}_{}", table.name, index_name);
        let owner = format!("{}.{} (generated membership index)", table.name, index_name);
        if let Some(previous) = physical_index_names.insert(physical.clone(), owner) {
            return Err(membership_error(
                "SNAPBACK_MEMBERSHIP_INDEX_NAME_COLLISION",
                &table.name,
                &declaration,
                format!(
                    "the generated membership index collides with the physical index name \
                     {physical} already used by {previous}"
                ),
            )
            .with_detail("physicalName", physical));
        }
    }

    Ok(())
}

/// Require a membership axis field: declared, and **non-optional** — a nullable
/// key axis silently defeats the unique index (SQLite/Postgres admit multiple
/// NULL-bearing rows), so it is refused at the declaration.
/// @ref LLP 0056#declaring-a-membership-table — key columns are required and
///   non-null; a nullable axis defeats uniqueness.
fn require_membership_axis_field<'a>(
    table: &'a TableManifest,
    declaration: &str,
    field: &str,
    axis: &str,
) -> SnapbackResult<&'a FieldManifest> {
    let manifest = table.field(field).ok_or_else(|| {
        membership_error(
            "SNAPBACK_MEMBERSHIP_AXIS_FIELD_UNKNOWN",
            &table.name,
            declaration,
            format!("{axis} axis references undeclared field {field:?}"),
        )
    })?;
    if manifest.optional {
        return Err(membership_error(
            "SNAPBACK_MEMBERSHIP_OPTIONAL_KEY_AXIS",
            &table.name,
            declaration,
            format!(
                "{axis} axis {field:?} is optional; membership key axes must be non-null or the \
                 uniqueness invariant is silently defeated"
            ),
        )
        .with_detail("field", field.to_owned())
        .with_detail("axis", axis.to_owned()));
    }
    Ok(manifest)
}

fn sqlite_object_exists(tx: &Transaction<'_>, kind: &str, name: &str) -> SnapbackResult<bool> {
    Ok(tx
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = ?1 AND name = ?2",
            params![kind, name],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn nonnull_activation_axis(
    value: Option<String>,
    table: &str,
    declaration: &str,
    axis: &str,
) -> SnapbackResult<String> {
    match value {
        Some(value) if !value.is_empty() => Ok(value),
        _ => Err(membership_error(
            "SNAPBACK_MEMBERSHIP_ACTIVATION_NULL_AXIS",
            table,
            declaration,
            format!(
                "an existing row has a null/empty {axis} axis; a null key axis silently defeats \
                 the membership uniqueness invariant"
            ),
        )
        .with_detail("axis", axis.to_owned())),
    }
}

/// Fail-closed scan of **existing data** when a `.membership()` declaration is
/// activated over a table that already holds rows (the brownfield-adopt path).
/// Refuses activation on: a null/empty key axis, a role outside the closed
/// (exact-decoded) vocabulary — which is also the vocabulary-shrink-with-extant
/// -rows refusal and the `"Host"`-vs-`"host"` refusal — a duplicate
/// `(principal, resource)` pair, a membership referencing a non-existent
/// resource, and (where `lastHolder` is declared) any live resource lacking a
/// holder of the protected role.
///
/// The uniqueness/nullability legs are additionally backstopped by the
/// generated unique index and the non-null columns, but this scan produces a
/// **typed** diagnostic naming the declaration rather than a raw SQLite error.
///
/// The `lastHolder` leg counts **eligible** holders — a principal that is not
/// permanently deactivated (LLP 0055 `deactivated_at`, landed in G1) — reusing
/// G1's predicate ([`auth_agents::principal_is_eligible_on`]). Referential
/// integrity and the live-resource enumeration require the declaration's
/// `resourceTable` binding, which codegen fills from `v.id(...)` under the
/// LLP 0004 follow-on.
///
/// @ref LLP 0056#declaring-a-membership-table — activation over existing data
///   is fail-closed across vocabulary, uniqueness, nullability, and referential
///   integrity.
fn validate_membership_activation(
    tx: &Transaction<'_>,
    manifest: &SchemaManifest,
) -> SnapbackResult<()> {
    for table in &manifest.tables {
        let Some(membership) = &table.membership else {
            continue;
        };
        let declaration = membership.effective_id(&table.name).to_owned();
        if !sqlite_object_exists(tx, "table", &table.name)? {
            // Fresh apply: nothing exists to be nonconforming.
            continue;
        }
        let physical = physical_columns(tx, &table.name)?;
        if !physical.contains_key(&membership.principal) || !physical.contains_key(&membership.role)
        {
            // A key column is being added in this same apply, so there are no
            // pre-existing values in it to validate.
            continue;
        }
        let resource_column = match membership.scope {
            MembershipScope::Resource => {
                let resource = membership
                    .resource
                    .as_deref()
                    .expect("resource axis validated by validate_membership_declaration");
                if !physical.contains_key(resource) {
                    continue;
                }
                Some(resource)
            }
            MembershipScope::App => None,
        };
        let vocabulary: BTreeSet<&str> = membership.vocabulary().collect();
        // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
        //   Validation leg: activation/import refuse when a live resource lacks
        //   an *eligible* holder. G1 (LLP 0055 `deactivated_at`) has landed, so
        //   this scan now excludes permanently-deactivated principals rather than
        //   counting rows (the M1 boundary). A missing `_auth_users` (no auth
        //   catalog yet) means no deactivation state, so every holder is eligible.
        let deactivation_state_available =
            sqlite_object_exists(tx, "table", "_auth_users")?;

        let mut select_columns = vec![membership.principal.clone(), membership.role.clone()];
        if let Some(resource) = resource_column {
            select_columns.push(resource.to_owned());
        }
        let quoted = select_columns
            .iter()
            .map(|column| quote_ident(column))
            .collect::<SnapbackResult<Vec<_>>>()?
            .join(", ");
        let sql = format!("SELECT {quoted} FROM {}", quote_ident(&table.name)?);

        let mut seen_pairs: BTreeSet<(String, Option<String>)> = BTreeSet::new();
        let mut referenced_resources: BTreeSet<String> = BTreeSet::new();
        let mut protected_resources: BTreeSet<String> = BTreeSet::new();
        {
            let mut statement = tx.prepare(&sql)?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                let principal = nonnull_activation_axis(
                    row.get::<_, Option<String>>(0)?,
                    &table.name,
                    &declaration,
                    "principal",
                )?;
                let role = nonnull_activation_axis(
                    row.get::<_, Option<String>>(1)?,
                    &table.name,
                    &declaration,
                    "role",
                )?;
                let resource = if resource_column.is_some() {
                    Some(nonnull_activation_axis(
                        row.get::<_, Option<String>>(2)?,
                        &table.name,
                        &declaration,
                        "resource",
                    )?)
                } else {
                    None
                };

                // Exact-decoded vocabulary: a `"Host"` row against a `"host"`
                // vocabulary fails here, and so does a vocabulary shrink that
                // stranded rows carrying a removed role.
                if !vocabulary.contains(role.as_str()) {
                    return Err(membership_error(
                        "SNAPBACK_MEMBERSHIP_ACTIVATION_UNKNOWN_ROLE",
                        &table.name,
                        &declaration,
                        format!(
                            "an existing row carries role {role:?}, which is not in the closed \
                             vocabulary (comparison is exact-decoded)"
                        ),
                    )
                    .with_detail("role", role));
                }

                if !seen_pairs.insert((principal.clone(), resource.clone())) {
                    return Err(membership_error(
                        "SNAPBACK_MEMBERSHIP_ACTIVATION_DUPLICATE",
                        &table.name,
                        &declaration,
                        "existing rows duplicate a (principal, resource) pair; the membership \
                         uniqueness invariant would be violated",
                    )
                    .with_detail("principal", principal));
                }

                if let Some(resource) = resource {
                    if membership
                        .last_holder
                        .as_ref()
                        .is_some_and(|last_holder| last_holder.protect == role)
                        && (!deactivation_state_available
                            || crate::storage::auth_agents::principal_is_eligible_on(
                                tx, &principal,
                            )?)
                    {
                        protected_resources.insert(resource.clone());
                    }
                    referenced_resources.insert(resource);
                }
            }
        }

        // Referential integrity and the live-resource enumeration both require
        // the resource-table binding.
        if let Some(resource_table) = membership.resource_table.as_deref()
            && resource_column.is_some()
            && sqlite_object_exists(tx, "table", resource_table)?
        {
            for resource in &referenced_resources {
                if !sqlite_object_exists_row(tx, resource_table, resource)? {
                    return Err(membership_error(
                        "SNAPBACK_MEMBERSHIP_ACTIVATION_DANGLING_RESOURCE",
                        &table.name,
                        &declaration,
                        format!(
                            "a membership references resource {resource:?}, which does not exist \
                             in {resource_table}"
                        ),
                    )
                    .with_detail("resource", resource.clone()));
                }
            }
            if let Some(last_holder) = &membership.last_holder {
                let mut statement =
                    tx.prepare(&format!("SELECT _id FROM {}", quote_ident(resource_table)?))?;
                let mut rows = statement.query([])?;
                while let Some(row) = rows.next()? {
                    let resource: String = row.get(0)?;
                    if !protected_resources.contains(&resource) {
                        return Err(membership_error(
                            "SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_RESOURCE",
                            &table.name,
                            &declaration,
                            format!(
                                "live resource {resource:?} has no holder of the protected role \
                                 {:?}",
                                last_holder.protect
                            ),
                        )
                        .with_detail("resource", resource)
                        .with_detail("role", last_holder.protect.clone()));
                    }
                }
            }
        }
    }
    Ok(())
}

fn sqlite_object_exists_row(tx: &Transaction<'_>, table: &str, id: &str) -> SnapbackResult<bool> {
    Ok(tx
        .query_row(
            &format!("SELECT 1 FROM {} WHERE _id = ?1", quote_ident(table)?),
            params![id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn validate_schema(manifest: &SchemaManifest) -> SnapbackResult<()> {
    validate_collection_definitions(&manifest.ephemeral_collections).map_err(|error| {
        SnapbackError::error(error.code.diagnostic_code(), "ephemeral", error.message)
    })?;
    let mut tables = BTreeSet::new();
    // SQLite index names are database-global, and the physical name is
    // `{table}_{index}` joined with `_` — a character both identifiers may
    // contain — so distinct declarations can join to the same physical name
    // (table `foo` + index `bar_baz` vs table `foo_bar` + index `baz`).
    // Validate joined names globally; otherwise the second index would
    // silently never be created (`create_index` would find the first one).
    let mut physical_index_names: BTreeMap<String, String> = BTreeMap::new();
    // Stable membership declaration ids are unique across the whole manifest —
    // a collision is a load error, because helpers, audit rows, room bindings,
    // and future LLP 0055 resource-scope grants reference the id durably.
    // @ref LLP 0056#declaring-a-membership-table — ids are unique across the manifest.
    let mut membership_declaration_ids: BTreeMap<String, String> = BTreeMap::new();
    for table in &manifest.tables {
        validate_user_identifier("table", &table.name)?;
        if !tables.insert(table.name.clone()) {
            return Err(SnapbackError::error(
                "SNAPBACK_SCHEMA_DUPLICATE_TABLE",
                "schema",
                format!("duplicate table {}", table.name),
            ));
        }

        let mut fields = BTreeSet::new();
        for field in &table.fields {
            validate_user_identifier("field", &field.name)?;
            if is_system_field(&field.name) {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_SYSTEM_FIELD",
                    "schema",
                    format!("{} is managed by Snapback", field.name),
                ));
            }
            if !fields.insert(field.name.clone()) {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_DUPLICATE_FIELD",
                    "schema",
                    format!("duplicate field {}.{}", table.name, field.name),
                ));
            }
        }

        if table.permission_fields.is_some() && !table.permission_backing {
            return Err(SnapbackError::error(
                "SNAPBACK_SCHEMA_PERMISSION_FIELDS_WITHOUT_BACKING",
                "schema",
                format!(
                    "table {} declares permissionFields without permissionBacking",
                    table.name
                ),
            )
            .with_detail("table", table.name.clone()));
        }
        if let Some(permission_fields) = &table.permission_fields {
            let mut seen_permission_fields = BTreeSet::new();
            for field in permission_fields {
                validate_user_identifier("permission field", field)?;
                if !fields.contains(field) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SCHEMA_PERMISSION_FIELD_UNKNOWN",
                        "schema",
                        format!(
                            "table {} permissionFields references unknown field {}",
                            table.name, field
                        ),
                    )
                    .with_detail("table", table.name.clone())
                    .with_detail("field", field.clone()));
                }
                if !seen_permission_fields.insert(field.clone()) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SCHEMA_PERMISSION_FIELD_DUPLICATE",
                        "schema",
                        format!(
                            "table {} permissionFields repeats field {}",
                            table.name, field
                        ),
                    )
                    .with_detail("table", table.name.clone())
                    .with_detail("field", field.clone()));
                }
            }
        }

        let mut indexes = BTreeSet::new();
        for index in &table.indexes {
            validate_user_identifier("index", &index.name)?;
            if !indexes.insert(index.name.clone()) {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_DUPLICATE_INDEX",
                    "schema",
                    format!("duplicate index {}.{}", table.name, index.name),
                ));
            }
            let physical = format!("{}_{}", table.name, index.name);
            let declaration = format!("{}.{}", table.name, index.name);
            if let Some(previous) = physical_index_names.insert(physical.clone(), declaration) {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_INDEX_NAME_COLLISION",
                    "schema",
                    format!(
                        "index {}.{} and {previous} share the physical index name \
                         {physical}; SQLite index names are database-global — \
                         rename one of them",
                        table.name, index.name
                    ),
                )
                .with_detail("physicalName", physical)
                .with_detail(
                    "declarations",
                    json!([previous, format!("{}.{}", table.name, index.name)]),
                ));
            }
            if index.fields.is_empty() {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_EMPTY_INDEX",
                    "schema",
                    format!("index {}.{} has no fields", table.name, index.name),
                ));
            }
            for field in &index.fields {
                ensure_field(table, field)?;
            }
        }

        validate_membership_declaration(
            table,
            &fields,
            &mut physical_index_names,
            &mut membership_declaration_ids,
        )?;
    }

    validate_collection_permission_backing(
        &manifest.ephemeral_collections,
        &manifest.tables,
        manifest.effective_auth_mode() == crate::manifest::AuthMode::Sessions,
    )
    .map_err(|error| {
        SnapbackError::error(error.code.diagnostic_code(), "ephemeral", error.message)
    })?;

    Ok(())
}

/// Reject a manifest that redeclares an existing field with a different type.
///
/// The migrator never rewrites stored data, so a retyped field would leave the
/// physical column carrying values encoded under the old declaration while the
/// stored manifest — and every generated client type — promises the new one.
/// Even affinity-preserving changes (string → json, boolean → integer) change
/// how stored values decode, so any declared-type change is refused.
///
/// @ref LLP 0003#database-model — the migrator must "reject type changes that
/// would require rewriting existing data"; the read lane's schema-race safety
/// argument also assumes fields are never retyped.
fn reject_field_retypes(current: &SchemaManifest, next: &SchemaManifest) -> SnapbackResult<()> {
    for table in &next.tables {
        let Some(current_table) = current.tables.iter().find(|t| t.name == table.name) else {
            continue;
        };
        for field in &table.fields {
            let Some(current_field) = current_table.field(&field.name) else {
                continue;
            };
            if current_field.field_type != field.field_type {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_FIELD_RETYPED",
                    "schema",
                    format!(
                        "field {}.{} cannot change type from {} to {}; \
                         retyping stored data is not supported — add a new field instead",
                        table.name,
                        field.name,
                        field_type_name(&current_field.field_type),
                        field_type_name(&field.field_type)
                    ),
                )
                .with_detail("table", table.name.clone())
                .with_detail("field", field.name.clone())
                .with_detail("existingType", field_type_name(&current_field.field_type))
                .with_detail("requestedType", field_type_name(&field.field_type)));
            }
        }
    }
    Ok(())
}

/// Required fields need a physical invariant, not only a generated type. A
/// nullable column may tighten only when every stored row is already non-null;
/// `create_or_update_table` then rebuilds the table atomically with `NOT NULL`.
/// A new required column still needs an empty table because there is no value
/// to synthesize for existing rows.
fn reject_unsafe_required_field_changes(
    conn: &Connection,
    current: &SchemaManifest,
    next: &SchemaManifest,
) -> SnapbackResult<()> {
    // The additive migrator intentionally preserves removed physical columns.
    // A required column therefore cannot disappear from a still-declared
    // table, or become optional, without leaving a hidden `NOT NULL` constraint
    // that makes otherwise-valid future inserts fail. Refuse that logical
    // weakening until the schema language has an explicit drop/backfill
    // migration. A whole removed table remains dormant and is checked against
    // its surviving physical columns if it is later reintroduced.
    //
    // @ref LLP 0007#schema-evolution — conservative evolution must preserve
    // rollback data without accepting a manifest the physical schema cannot
    // implement.
    for current_table in &current.tables {
        let Some(next_table) = next.table(&current_table.name) else {
            continue;
        };
        for previous in current_table.fields.iter().filter(|field| !field.optional) {
            let requested_change = match next_table.field(&previous.name) {
                None => Some("remove"),
                Some(field) if field.optional => Some("makeOptional"),
                Some(_) => None,
            };
            if let Some(requested_change) = requested_change {
                return Err(SnapbackError::error(
                    "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED",
                    "schema",
                    format!(
                        "required field {}.{} cannot be removed or made optional while its preserved SQLite column is NOT NULL; explicit drop/backfill migrations are not supported",
                        current_table.name, previous.name
                    ),
                )
                .with_detail("table", current_table.name.clone())
                .with_detail("field", previous.name.clone())
                .with_detail("requestedChange", requested_change));
            }
        }
    }

    for table in &next.tables {
        let Some(current_table) = current.table(&table.name) else {
            continue;
        };
        for field in &table.fields {
            match current_table.field(&field.name) {
                Some(previous) if !field.optional => {
                    let null_count: i64 = conn.query_row(
                        &format!(
                            "SELECT COUNT(*) FROM {} WHERE {} IS NULL",
                            quote_ident(&table.name)?,
                            quote_ident(&field.name)?
                        ),
                        [],
                        |row| row.get(0),
                    )?;
                    if null_count > 0 {
                        return Err(SnapbackError::error(
                            "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED",
                            "schema",
                            format!(
                                "field {}.{} cannot become physically required while {null_count} stored rows are null",
                                table.name, field.name
                            ),
                        )
                        .with_detail("table", table.name.clone())
                        .with_detail("field", field.name.clone())
                        .with_detail("existingNullRows", null_count)
                        .with_detail("wasOptional", previous.optional));
                    }
                }
                None if !field.optional => {
                    let row_count: i64 = conn.query_row(
                        &format!("SELECT COUNT(*) FROM {}", quote_ident(&table.name)?),
                        [],
                        |row| row.get(0),
                    )?;
                    if row_count > 0 {
                        return Err(SnapbackError::error(
                            "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED",
                            "schema",
                            format!(
                                "required field {}.{} cannot be added to {row_count} existing rows without a default/backfill",
                                table.name, field.name
                            ),
                        )
                        .with_detail("table", table.name.clone())
                        .with_detail("field", field.name.clone())
                        .with_detail("existingRows", row_count));
                    }
                }
                _ => {}
            }
        }
    }
    Ok(())
}

/// The manifest wire name of a field type (matches `FieldType`'s serde
/// serialization), for error messages and diagnostics.
fn field_type_name(field_type: &FieldType) -> &'static str {
    match field_type {
        FieldType::String => "String",
        FieldType::Boolean => "Boolean",
        FieldType::Integer => "Integer",
        FieldType::Real => "Real",
        FieldType::Json => "Json",
        FieldType::Principal => "Principal",
    }
}

fn create_or_update_table(tx: &Transaction<'_>, table: &TableManifest) -> SnapbackResult<()> {
    let mut columns = vec![
        "_id TEXT PRIMARY KEY".to_owned(),
        "_version INTEGER NOT NULL".to_owned(),
        "_createdAt INTEGER NOT NULL".to_owned(),
        "_updatedAt INTEGER NOT NULL".to_owned(),
    ];
    for field in &table.fields {
        columns.push(format!(
            "{} {}{}",
            quote_ident(&field.name)?,
            sqlite_type(&field.field_type),
            if field.optional { "" } else { " NOT NULL" }
        ));
    }
    if table
        .membership
        .as_ref()
        .is_some_and(|membership| membership.provenance.is_some())
    {
        columns.extend(
            MEMBERSHIP_PROVENANCE_COLUMNS
                .iter()
                .map(|column| format!("{} TEXT", quote_ident(column).expect("fixed identifier"))),
        );
    }

    tx.execute(
        &format!(
            "CREATE TABLE IF NOT EXISTS {} ({})",
            quote_ident(&table.name)?,
            columns.join(", ")
        ),
        [],
    )?;

    let existing = physical_columns(tx, &table.name)?;
    for column in existing.values() {
        if !is_system_field(&column.name) && table.field(&column.name).is_none() && column.not_null
        {
            return Err(SnapbackError::error(
                "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED",
                "schema",
                format!(
                    "table {} cannot omit preserved required field {}; its SQLite column is still NOT NULL",
                    table.name, column.name
                ),
            )
            .with_detail("table", table.name.clone())
            .with_detail("field", column.name.clone())
            .with_detail("requestedChange", "remove"));
        }
    }
    for field in &table.fields {
        match existing.get(&field.name) {
            None => {
                tx.execute(
                    &format!(
                        "ALTER TABLE {} ADD COLUMN {} {}{}",
                        quote_ident(&table.name)?,
                        quote_ident(&field.name)?,
                        sqlite_type(&field.field_type),
                        if field.optional { "" } else { " NOT NULL" }
                    ),
                    [],
                )?;
            }
            // @ref LLP 0003#database-model — the migrator is additive-only and
            // must reject type changes that would require rewriting existing
            // data. The physical column keeps its declared affinity forever,
            // so silently accepting a retyped manifest would hand back values
            // decoded under the old declaration while schema and generated
            // types promise the new one.
            Some(column) => {
                let declared = sqlite_type(&field.field_type);
                if !column.declared_type.eq_ignore_ascii_case(declared) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SCHEMA_FIELD_RETYPED",
                        "schema",
                        format!(
                            "field {}.{} cannot change storage type from {} to {}; \
                             retyping stored data is not supported — add a new field instead",
                            table.name, field.name, column.declared_type, declared
                        ),
                    )
                    .with_detail("table", table.name.clone())
                    .with_detail("field", field.name.clone())
                    .with_detail("existingType", column.declared_type.clone())
                    .with_detail("requestedType", declared));
                }
            }
        }
    }

    if table
        .membership
        .as_ref()
        .is_some_and(|membership| membership.provenance.is_some())
    {
        let existing = physical_columns(tx, &table.name)?;
        for column in MEMBERSHIP_PROVENANCE_COLUMNS {
            if !existing.contains_key(column) {
                tx.execute(
                    &format!(
                        "ALTER TABLE {} ADD COLUMN {} TEXT",
                        quote_ident(&table.name)?,
                        quote_ident(column)?
                    ),
                    [],
                )?;
            }
        }
        // Brownfield adoption is allowed: rows predating the declaration get
        // an explicit historical tag instead of blocking activation.
        tx.execute(
            &format!(
                "UPDATE {} SET {} = COALESCE({}, 'preexisting'), {} = COALESCE({}, 'preexisting')",
                quote_ident(&table.name)?,
                quote_ident(MEMBERSHIP_GRANTED_BY_ACTOR)?,
                quote_ident(MEMBERSHIP_GRANTED_BY_ACTOR)?,
                quote_ident(MEMBERSHIP_GRANTED_BY_EFFECTIVE)?,
                quote_ident(MEMBERSHIP_GRANTED_BY_EFFECTIVE)?,
            ),
            [],
        )?;
    }

    // Repair both a safe optional→required evolution and legacy databases
    // whose manifest already said "required" while the physical column was
    // nullable. Validation above proves every affected row is non-null; this
    // rebuild and the manifest write share the surrounding transaction.
    let columns = physical_columns(tx, &table.name)?;
    let required = table
        .fields
        .iter()
        .filter(|field| !field.optional)
        .map(|field| field.name.clone())
        .collect::<BTreeSet<_>>();
    if columns.values().any(|column| {
        required.contains(&column.name) && !column.not_null && column.primary_key == 0
    }) {
        rebuild_table_with_required_columns(tx, &table.name, &columns, &required)?;
    }

    Ok(())
}

fn rebuild_table_with_required_columns(
    tx: &Transaction<'_>,
    table: &str,
    columns: &BTreeMap<String, PhysicalColumn>,
    required: &BTreeSet<String>,
) -> SnapbackResult<()> {
    for field in required {
        let null_count: i64 = tx.query_row(
            &format!(
                "SELECT COUNT(*) FROM {} WHERE {} IS NULL",
                quote_ident(table)?,
                quote_ident(field)?
            ),
            [],
            |row| row.get(0),
        )?;
        if null_count > 0 {
            return Err(SnapbackError::error(
                "SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED",
                "schema",
                format!(
                    "field {table}.{field} cannot become physically required while {null_count} stored rows are null"
                ),
            )
            .with_detail("table", table.to_owned())
            .with_detail("field", field.clone())
            .with_detail("existingNullRows", null_count));
        }
    }

    let temporary = format!("_snapback_rebuild_{}_{}", table, Uuid::now_v7().simple());
    let definitions = columns
        .values()
        .map(|column| {
            let declared_type = safe_rebuild_column_type(column)?;
            let mut definition = format!("{} {}", quote_ident(&column.name)?, declared_type);
            if column.primary_key > 0 {
                definition.push_str(" PRIMARY KEY");
            } else if column.not_null || required.contains(&column.name) {
                definition.push_str(" NOT NULL");
            }
            Ok(definition)
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    let names = columns
        .values()
        .map(|column| quote_ident(&column.name))
        .collect::<SnapbackResult<Vec<_>>>()?;
    tx.execute(
        &format!(
            "CREATE TABLE {} ({})",
            quote_ident(&temporary)?,
            definitions.join(", ")
        ),
        [],
    )?;
    tx.execute(
        &format!(
            "INSERT INTO {} ({}) SELECT {} FROM {}",
            quote_ident(&temporary)?,
            names.join(", "),
            names.join(", "),
            quote_ident(table)?
        ),
        [],
    )?;
    tx.execute(&format!("DROP TABLE {}", quote_ident(table)?), [])?;
    tx.execute(
        &format!(
            "ALTER TABLE {} RENAME TO {}",
            quote_ident(&temporary)?,
            quote_ident(table)?
        ),
        [],
    )?;
    Ok(())
}

fn safe_rebuild_column_type(column: &PhysicalColumn) -> SnapbackResult<&'static str> {
    let canonical = match column.declared_type.trim().to_ascii_uppercase().as_str() {
        "TEXT" => "TEXT",
        "INTEGER" => "INTEGER",
        "REAL" => "REAL",
        _ => {
            return Err(SnapbackError::error(
                "SNAPBACK_SCHEMA_PHYSICAL_COLUMN_INVALID",
                "schema",
                format!(
                    "physical column {} has unsupported declaration {:?}",
                    column.name, column.declared_type
                ),
            ));
        }
    };
    if column.default_sql.is_some() {
        return Err(SnapbackError::error(
            "SNAPBACK_SCHEMA_PHYSICAL_COLUMN_INVALID",
            "schema",
            format!(
                "physical column {} has an unexpected default declaration",
                column.name
            ),
        ));
    }
    match column.name.as_str() {
        "_id" if canonical == "TEXT" && column.primary_key == 1 => {}
        "_version" | "_createdAt" | "_updatedAt"
            if canonical == "INTEGER" && column.primary_key == 0 && column.not_null => {}
        name if !is_system_field(name) && column.primary_key == 0 => {}
        _ => {
            return Err(SnapbackError::error(
                "SNAPBACK_SCHEMA_PHYSICAL_COLUMN_INVALID",
                "schema",
                format!(
                    "physical column {} has unexpected system/primary-key metadata",
                    column.name
                ),
            ));
        }
    }
    Ok(canonical)
}

/// The reserved logical name of the generated membership uniqueness index.
/// `validate_schema` reserves its physical name, so a user index cannot collide
/// with it.
pub(crate) const MEMBERSHIP_UNIQUE_INDEX_NAME: &str = "_membership_pk";
pub(crate) const MEMBERSHIP_GRANTED_BY_ACTOR: &str = "grantedByActor";
pub(crate) const MEMBERSHIP_GRANTED_BY_EFFECTIVE: &str = "grantedByEffective";
pub(crate) const MEMBERSHIP_GRANTED_BY_GRANT: &str = "grantedByGrant";
const MEMBERSHIP_PROVENANCE_COLUMNS: [&str; 3] = [
    MEMBERSHIP_GRANTED_BY_ACTOR,
    MEMBERSHIP_GRANTED_BY_EFFECTIVE,
    MEMBERSHIP_GRANTED_BY_GRANT,
];

/// The generated true-unique index for a membership table: `(principal,
/// resource)` for a resource-scoped declaration, or `(principal)` for
/// `scope: "app"` (whose resource is a system-constant singleton, so a
/// principal holds at most one global role per declaration). `None` for a
/// non-membership table. The non-null key axes — enforced at the declaration —
/// are what keep this index total.
///
/// @ref LLP 0056#declaring-a-membership-table — one row per `(principal,
///   resource)`, delivered by a generated true-unique composite index.
pub(crate) fn membership_unique_index(table: &TableManifest) -> Option<(String, Vec<String>)> {
    let membership = table.membership.as_ref()?;
    let mut fields = vec![membership.principal.clone()];
    if let Some(resource) = &membership.resource {
        fields.push(resource.clone());
    }
    Some((MEMBERSHIP_UNIQUE_INDEX_NAME.to_owned(), fields))
}

/// Create or rebuild a declared index so the physical index always matches
/// the manifest.
///
/// SQLite index names are database-global and `CREATE INDEX IF NOT EXISTS`
/// matches on name alone, so a bare create has two silent no-op modes: the
/// physical name may already belong to a stale index (left on another table
/// by an earlier schema epoch), or the index may exist with an outdated
/// field list after the manifest changed. Either way the declared index
/// would never exist, while `validate_query_index` keeps accepting
/// `indexed_by` hints for it (it checks only the manifest). Compare the
/// existing definition from `sqlite_master`/`PRAGMA index_info` and drop and
/// recreate on any mismatch — index rebuilds are non-destructive.
///
/// @ref LLP 0003#database-model — the migrator keeps declared indexes in
/// sync with the manifest rather than treating name existence as done.
fn create_index(
    tx: &Transaction<'_>,
    table: &TableManifest,
    name: &str,
    fields: &[String],
    unique: bool,
) -> SnapbackResult<()> {
    let mut columns = fields
        .iter()
        .map(|field| {
            ensure_field(table, field)?;
            quote_ident(field)
        })
        .collect::<SnapbackResult<Vec<_>>>()?;
    // A non-unique index appends `_id` so it is a covering, tie-broken key. A
    // **unique** index must not: `_id` is per-row unique, so including it would
    // make the whole key trivially unique and silently defeat the declared
    // uniqueness invariant (LLP 0056 relies on true `(principal, resource)`
    // uniqueness). The declared columns must be non-null for it to be total —
    // enforced at the declaration by `validate_membership_declaration`.
    // @ref LLP 0056#declaring-a-membership-table — true-unique, total index.
    if !unique {
        columns.push(quote_ident("_id")?);
    }

    let physical_name = format!("{}_{}", table.name, name);
    if let Some(existing) = physical_index(tx, &physical_name)? {
        let desired: Vec<String> = if unique {
            fields.to_vec()
        } else {
            fields.iter().cloned().chain(["_id".to_owned()]).collect()
        };
        if existing.table == table.name && existing.columns == desired && existing.unique == unique
        {
            return Ok(());
        }
        tx.execute(&format!("DROP INDEX {}", quote_ident(&physical_name)?), [])?;
    }
    tx.execute(
        &format!(
            "CREATE {}INDEX {} ON {} ({})",
            if unique { "UNIQUE " } else { "" },
            quote_ident(&physical_name)?,
            quote_ident(&table.name)?,
            columns.join(", ")
        ),
        [],
    )?;
    Ok(())
}

/// A physical SQLite index's owning table and ordered column list, read from
/// `sqlite_master` and `PRAGMA index_info` so schema apply can compare it
/// against the manifest's declaration.
struct PhysicalIndex {
    table: String,
    columns: Vec<String>,
    unique: bool,
}

fn physical_index(tx: &Transaction<'_>, name: &str) -> SnapbackResult<Option<PhysicalIndex>> {
    let row = tx
        .query_row(
            "SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?1",
            params![name],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()?;
    let Some((table, sql)) = row else {
        return Ok(None);
    };
    // Our declared indexes always carry `sql`; a NULL sql (an auto-index from a
    // UNIQUE table constraint) never matches a manifest declaration, so
    // treating it as non-unique forces the caller to rebuild — the same
    // conservative posture the column comparison already takes.
    let unique = sql
        .as_deref()
        .is_some_and(|sql| sql.to_ascii_uppercase().contains("CREATE UNIQUE INDEX"));
    let mut statement = tx.prepare(&format!("PRAGMA index_info({})", quote_ident(name)?))?;
    let mut rows = statement.query([])?;
    let mut columns = Vec::new();
    while let Some(row) = rows.next()? {
        // The column name is NULL for rowid or expression members, which a
        // manifest index never declares; mapping those to "" can never match
        // a declared column, so the caller rebuilds the index.
        columns.push(row.get::<_, Option<String>>(2)?.unwrap_or_default());
    }
    Ok(Some(PhysicalIndex {
        table,
        columns,
        unique,
    }))
}

/// Existing physical column facts from `PRAGMA table_info`, used both for type
/// checks and for lossless required-field table rebuilds.
struct PhysicalColumn {
    name: String,
    declared_type: String,
    not_null: bool,
    default_sql: Option<String>,
    primary_key: i64,
}

fn physical_user_tables(conn: &Connection) -> SnapbackResult<Vec<String>> {
    let mut statement = conn.prepare(
        "SELECT name
         FROM sqlite_schema
         WHERE type = 'table'
           AND name NOT GLOB 'sqlite_*'
         ORDER BY name",
    )?;
    let tables = statement
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(tables
        .into_iter()
        .filter(|name| {
            let folded = name.to_ascii_lowercase();
            !folded.starts_with("_snapback") && !is_auth_reserved_identifier(name)
        })
        .collect())
}

fn physical_columns(
    tx: &Transaction<'_>,
    table: &str,
) -> SnapbackResult<BTreeMap<String, PhysicalColumn>> {
    let mut statement = tx.prepare(&format!("PRAGMA table_info({})", quote_ident(table)?))?;
    let mut rows = statement.query([])?;
    let mut columns = BTreeMap::new();
    while let Some(row) = rows.next()? {
        let column = PhysicalColumn {
            name: row.get(1)?,
            declared_type: row.get(2)?,
            not_null: row.get::<_, i64>(3)? != 0,
            default_sql: row.get(4)?,
            primary_key: row.get(5)?,
        };
        columns.insert(column.name.clone(), column);
    }
    Ok(columns)
}

/// Fail closed when a query declares `indexed_by` for an index the table's
/// schema does not define. The v0 SQLite target does not yet consult the hint
/// for planning, but silently accepting an unknown index name is a
/// silent-drop-class violation: the hint would be a no-op the author believes
/// is load-bearing. Validating it here makes the honest state explicit until
/// the hint is wired into planning (or removed).
///
/// @ref LLP 0032#phase-2--execution-semantics-honesty — E5: `indexed_by` is
/// validated rather than silently ignored.
fn validate_query_index(table: &TableManifest, plan: &QueryPlan) -> SnapbackResult<()> {
    let Some(index_name) = &plan.indexed_by else {
        return Ok(());
    };
    validate_user_identifier("index", index_name)?;
    if table.indexes.iter().any(|index| &index.name == index_name) {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_QUERY_UNKNOWN_INDEX",
        "storage",
        format!(
            "query declares index {index_name:?} which table {:?} does not define",
            table.name
        ),
    )
    .with_details(json!({
        "table": table.name,
        "requestedIndex": index_name,
        "knownIndexes": table.indexes.iter().map(|index| &index.name).collect::<Vec<_>>(),
    })))
}

#[allow(clippy::too_many_arguments)]
fn build_query_sql(
    table: &TableManifest,
    schema: &SchemaManifest,
    plan: &QueryPlan,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    direct_bindings: Option<&BTreeMap<String, Value>>,
    now_ms: u64,
    runtime_id: Option<&dyn Fn() -> SnapbackResult<String>>,
    sql_limit: Option<usize>,
) -> SnapbackResult<(String, Vec<SqlValue>)> {
    let mut sql = format!("SELECT * FROM {}", quote_ident(&table.name)?);
    let mut values = Vec::new();
    let mut where_parts = Vec::new();
    let mut in_items = 0usize;
    let mut filter_bindings = 0usize;

    for filter in &plan.filters {
        ensure_field_or_system(table, &filter.field)?;
        match filter.op {
            FilterOp::Eq => {
                let field_type = field_type(table, &filter.field);
                for value in eval_authorization_decision_values(
                    &filter.value,
                    input,
                    bindings,
                    direct_bindings,
                    now_ms,
                    runtime_id,
                )? {
                    if value.is_null()
                        && authorization_expr_depends_on_projection(
                            &filter.value,
                            input,
                            bindings,
                            direct_bindings,
                        )
                    {
                        where_parts.push("1 = 0".to_owned());
                        continue;
                    }
                    validate_query_filter_value(table, &filter.field, &value)?;
                    add_query_filter_bindings(&mut filter_bindings, 1, &filter.field)?;
                    values.push(json_to_sql_value(&value, field_type)?);
                    where_parts.push(format!("{} = ?", quote_ident(&filter.field)?));
                }
            }
            FilterOp::In => {
                let field_type = field_type(table, &filter.field);
                for value in eval_authorization_decision_values(
                    &filter.value,
                    input,
                    bindings,
                    direct_bindings,
                    now_ms,
                    runtime_id,
                )? {
                    if value.is_null()
                        && authorization_expr_depends_on_projection(
                            &filter.value,
                            input,
                            bindings,
                            direct_bindings,
                        )
                    {
                        where_parts.push("1 = 0".to_owned());
                        continue;
                    }
                    let Some(items) = value.as_array() else {
                        return Err(SnapbackError::error(
                            "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
                            "query",
                            format!(
                                "query filter {}.{} In expects an array",
                                table.name, filter.field
                            ),
                        )
                        .with_detail("field", Value::String(filter.field.clone()))
                        .with_detail("op", Value::String("In".to_owned()))
                        .with_detail("value", value));
                    };
                    in_items = in_items.saturating_add(items.len());
                    if in_items > QUERY_MAX_IN_ITEMS {
                        return Err(SnapbackError::error(
                            "SNAPBACK_QUERY_IN_ITEMS_EXCEEDED",
                            "query",
                            format!(
                                "query In operands contain {in_items} total items; maxInItems is {QUERY_MAX_IN_ITEMS}"
                            ),
                        )
                        .with_detail("maxInItems", QUERY_MAX_IN_ITEMS as u64));
                    }
                    if matches!(field_type, Some(FieldType::Json)) {
                        validate_query_filter_value(table, &filter.field, &Value::Null)?;
                    }
                    add_query_filter_bindings(&mut filter_bindings, items.len(), &filter.field)?;
                    if items.is_empty() {
                        where_parts.push("1 = 0".to_owned());
                    } else {
                        for item in items {
                            validate_query_filter_value(table, &filter.field, item)?;
                            values.push(json_to_sql_value(item, field_type)?);
                        }
                        let placeholders =
                            (0..items.len()).map(|_| "?").collect::<Vec<_>>().join(", ");
                        where_parts.push(format!(
                            "{} IN ({placeholders})",
                            quote_ident(&filter.field)?
                        ));
                    }
                }
            }
            FilterOp::Lt | FilterOp::Lte | FilterOp::Gt | FilterOp::Gte => {
                let field_type = field_type(table, &filter.field);
                let op = match filter.op {
                    FilterOp::Lt => "<",
                    FilterOp::Lte => "<=",
                    FilterOp::Gt => ">",
                    FilterOp::Gte => ">=",
                    FilterOp::Eq | FilterOp::In => unreachable!("handled above"),
                };
                for value in eval_authorization_decision_values(
                    &filter.value,
                    input,
                    bindings,
                    direct_bindings,
                    now_ms,
                    runtime_id,
                )? {
                    if value.is_null()
                        && authorization_expr_depends_on_projection(
                            &filter.value,
                            input,
                            bindings,
                            direct_bindings,
                        )
                    {
                        where_parts.push("1 = 0".to_owned());
                        continue;
                    }
                    validate_query_filter_value(table, &filter.field, &value)?;
                    add_query_filter_bindings(&mut filter_bindings, 1, &filter.field)?;
                    values.push(json_to_sql_value(&value, field_type)?);
                    where_parts.push(format!("{} {op} ?", quote_ident(&filter.field)?));
                }
            }
        }
    }

    // LLP 0056 M3: lower each declaration-bound membership semi-join to a
    // correlated `EXISTS` over the membership table. Non-recursive by design —
    // SQL applies no row-visibility rules, so a locked-down roster cannot break
    // role evaluation for guests. A row-field resource ref correlates against
    // the outer row; a query-argument ref binds a fixed value.
    // @ref LLP 0056#rule-helpers — the declaration-bound membership predicate.
    for predicate in &plan.membership_filters {
        let (clause, extra) = build_membership_exists_sql(
            schema,
            table,
            predicate,
            input,
            bindings,
            now_ms,
            runtime_id,
            &mut filter_bindings,
        )?;
        where_parts.push(clause);
        values.extend(extra);
    }

    if !where_parts.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_parts.join(" AND "));
    }

    if !plan.order.is_empty() {
        let mut order_parts = Vec::new();
        for order in &plan.order {
            ensure_orderable_field(table, &order.field)?;
            let direction = match order.direction {
                OrderDirection::Asc => "ASC",
                OrderDirection::Desc => "DESC",
            };
            // Snapback owns ordering semantics: NULL is last in both
            // directions, and `_id` is the final stable tie-break. Do not
            // inherit SQLite's ASC NULL-first default (LLP 0007 §Queries).
            order_parts.push(format!(
                "{} {direction} NULLS LAST",
                quote_ident(&order.field)?
            ));
        }
        order_parts.push("\"_id\" ASC".to_owned());
        sql.push_str(" ORDER BY ");
        sql.push_str(&order_parts.join(", "));
    }

    if let Some(limit) = sql_limit {
        sql.push_str(" LIMIT ");
        sql.push_str(&limit.to_string());
    }

    Ok((sql, values))
}

/// Lower one declaration-bound membership semi-join to a correlated `EXISTS`
/// subquery over the membership table (LLP 0056 M3). Returns the WHERE clause
/// and its bound parameters (in SQL order). Fail-closed: an unresolved
/// declaration errors, and an absent effective principal matches no rows.
#[allow(clippy::too_many_arguments)]
fn build_membership_exists_sql(
    schema: &SchemaManifest,
    outer: &TableManifest,
    predicate: &crate::manifest::MembershipPredicate,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    now_ms: u64,
    runtime_id: Option<&dyn Fn() -> SnapbackResult<String>>,
    filter_bindings: &mut usize,
) -> SnapbackResult<(String, Vec<SqlValue>)> {
    let Some((mtable, membership)) =
        crate::membership_rules::find_declaration(schema, &predicate.declaration)
    else {
        return Err(SnapbackError::error(
            "SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION",
            "query",
            format!(
                "membership predicate names declaration {:?}, which is not declared",
                predicate.declaration
            ),
        ));
    };
    // No effective principal → the predicate matches no rows (fail-closed).
    let Some(user_id) = input.auth.user_id.as_deref() else {
        return Ok(("(0 = 1)".to_owned(), Vec::new()));
    };

    let mtable_ident = quote_ident(&mtable.name)?;
    let principal_ident = quote_ident(&membership.principal)?;
    let role_ident = quote_ident(&membership.role)?;
    let mut params: Vec<SqlValue> = Vec::new();
    let mut conds: Vec<String> = Vec::new();

    // principal = the effective principal.
    add_query_filter_bindings(filter_bindings, 1, &membership.principal)?;
    params.push(json_to_sql_value(
        &Value::String(user_id.to_owned()),
        Some(&FieldType::Principal),
    )?);
    conds.push(format!("{mtable_ident}.{principal_ident} = ?"));

    // resource axis (absent for scope: "app").
    if let Some(resource_field) = &membership.resource {
        let resource_ident = quote_ident(resource_field)?;
        match &predicate.resource {
            crate::manifest::MembershipResourceRef::RowField(field) => {
                ensure_field_or_system(outer, field)?;
                conds.push(format!(
                    "{mtable_ident}.{resource_ident} = {}.{}",
                    quote_ident(&outer.name)?,
                    quote_ident(field)?
                ));
            }
            crate::manifest::MembershipResourceRef::Arg(path) => {
                let value = eval_expr(
                    &ValueExpr::Arg(path.clone()),
                    input,
                    bindings,
                    now_ms,
                    runtime_id,
                )?;
                add_query_filter_bindings(filter_bindings, 1, resource_field)?;
                params.push(json_to_sql_value(&value, field_type(mtable, resource_field))?);
                conds.push(format!("{mtable_ident}.{resource_ident} = ?"));
            }
        }
    }

    // role IN (...) over the effective roles.
    let roles = crate::membership_rules::effective_roles(membership, predicate.roles.as_deref());
    if roles.is_empty() {
        return Ok(("(0 = 1)".to_owned(), Vec::new()));
    }
    add_query_filter_bindings(filter_bindings, roles.len(), &membership.role)?;
    let mut placeholders = Vec::with_capacity(roles.len());
    for role in &roles {
        params.push(json_to_sql_value(
            &Value::String(role.clone()),
            Some(&FieldType::String),
        )?);
        placeholders.push("?");
    }
    conds.push(format!(
        "{mtable_ident}.{role_ident} IN ({})",
        placeholders.join(", ")
    ));

    let clause = format!(
        "EXISTS (SELECT 1 FROM {mtable_ident} WHERE {})",
        conds.join(" AND ")
    );
    Ok((clause, params))
}

fn add_query_filter_bindings(
    total: &mut usize,
    additional: usize,
    field_name: &str,
) -> SnapbackResult<()> {
    *total = total.saturating_add(additional);
    if *total > QUERY_MAX_FILTER_BINDINGS {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED",
            "query",
            format!(
                "query filters bind {} values after {field_name}; maxFilterBindings is {QUERY_MAX_FILTER_BINDINGS}",
                *total
            ),
        )
        .with_detail("maxFilterBindings", QUERY_MAX_FILTER_BINDINGS as u64));
    }
    Ok(())
}

fn validate_query_filter_value(
    table: &TableManifest,
    field_name: &str,
    value: &Value,
) -> SnapbackResult<()> {
    if let Some(field) = table.field(field_name) {
        if field.field_type == FieldType::Json {
            return Err(SnapbackError::error(
                "SNAPBACK_QUERY_FILTER_UNSUPPORTED_FIELD_TYPE",
                "query",
                format!(
                    "query filter {}.{} has non-portable Json type",
                    table.name, field_name
                ),
            ));
        }
        let compatible = if value.is_null() {
            field.optional
        } else {
            match field.field_type {
                FieldType::String | FieldType::Principal => value.is_string(),
                FieldType::Boolean => value.is_boolean(),
                FieldType::Integer => portable_integer_value(value).is_some(),
                FieldType::Real => value.as_f64().is_some(),
                FieldType::Json => unreachable!("Json filters returned above"),
            }
        };
        if compatible {
            return Ok(());
        }
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
            "query",
            format!(
                "query filter {}.{} has a value incompatible with its declared type",
                table.name, field_name
            ),
        )
        .with_detail("table", table.name.clone())
        .with_detail("field", field_name.to_owned())
        .with_detail("fieldType", format!("{:?}", field.field_type)));
    }

    let compatible = match field_name {
        "_id" => value.is_string(),
        "_version" | "_createdAt" | "_updatedAt" => {
            portable_integer_value(value).is_some_and(|value| value >= 0)
        }
        _ => false,
    };
    if compatible {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_QUERY_FILTER_VALUE_INVALID",
        "query",
        format!(
            "query filter {}.{} has a value incompatible with its system-field type",
            table.name, field_name
        ),
    )
    .with_detail("table", table.name.clone())
    .with_detail("field", field_name.to_owned()))
}

fn validate_read_set(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    read_set: &[ReadDependency],
) -> SnapbackResult<()> {
    for dependency in read_set {
        let table = schema_table(schema, &dependency.table)?;
        let current = get_row_version(tx, table, &dependency.id)?;
        if current != Some(dependency.version) {
            return Err(SnapbackError::error(
                "SNAPBACK_MUTATION_CONFLICT",
                "storage",
                "mutation read set changed before commit",
            )
            .with_detail(
                "dependency",
                json!({
                    "table": dependency.table,
                    "id": dependency.id,
                    "expected": dependency.version,
                    "actual": current,
                }),
            ));
        }
    }
    Ok(())
}

fn validate_captured_read_set(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    input: &HandlerInput,
    read_set: &[CapturedReadDependency],
) -> SnapbackResult<()> {
    for dependency in read_set {
        match dependency.kind {
            CapturedReadKind::Row => {
                let table_name = dependency_table(dependency)?;
                let id = dependency_id(dependency)?;
                let expected = dependency.version.ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_CAPTURED_READ_INVALID",
                        "storage",
                        "captured row dependency is missing a version",
                    )
                })?;
                let table = schema_table(schema, table_name)?;
                let current = get_row_version(tx, table, id)?;
                if current != Some(expected) {
                    return Err(captured_conflict(
                        "captured row read changed before commit",
                        dependency,
                        json!({
                            "kind": "row",
                            "table": table_name,
                            "id": id,
                            "expected": expected,
                            "actual": current,
                        }),
                        read_set,
                    ));
                }
            }
            CapturedReadKind::MissingRow => {
                let table_name = dependency_table(dependency)?;
                let id = dependency_id(dependency)?;
                let table = schema_table(schema, table_name)?;
                let current = get_row_version(tx, table, id)?;
                // @ref LLP 0032#phase-2--execution-semantics-honesty — E4: a
                // "row X was absent" read is invalidated only if X is present
                // now — a current-state check, not a whole-table version bump.
                // A disjoint write that inserts a *different* row no longer
                // conflicts.
                if current.is_some() {
                    return Err(captured_conflict(
                        "captured missing-row read changed before commit",
                        dependency,
                        json!({
                            "kind": "missingRow",
                            "table": table_name,
                            "id": id,
                            "expected": dependency.version,
                            "actual": current,
                        }),
                        read_set,
                    ));
                }
            }
            CapturedReadKind::Query => {
                let table_name = dependency_table(dependency)?;
                let expected = dependency.version.ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_CAPTURED_READ_INVALID",
                        "storage",
                        "captured query dependency is missing a table version",
                    )
                })?;
                schema_table(schema, table_name)?;
                let current = table_change_version_from_tx(tx, table_name)?;
                if current == expected {
                    // Fast path: the table has not changed at all.
                    continue;
                }
                // @ref LLP 0032#phase-2--execution-semantics-honesty — E4:
                // the table changed, but only conflict if a change since the
                // read actually affects *this query's* result — reuse the live
                // matcher's predicate so a disjoint-row write (one that does not
                // match the query) no longer conflicts every mutation. If the
                // captured version is below the retention floor the intervening
                // changes were pruned and we cannot tell, so conflict
                // conservatively.
                let floor = retention_floor_from_tx(tx)?;
                let affected = if expected.saturating_add(1) < floor {
                    true
                } else {
                    changes_to_table_since(tx, table_name, expected)?
                        .iter()
                        .any(|change| {
                            crate::live_matcher::query_dependency_change_may_affect(
                                input, dependency, change,
                            )
                        })
                };
                if affected {
                    return Err(captured_conflict(
                        "captured query read changed before commit",
                        dependency,
                        json!({
                            "kind": "query",
                            "table": table_name,
                            "expected": expected,
                            "actual": current,
                            "predicate": dependency.predicate,
                            "rows": dependency.rows,
                        }),
                        read_set,
                    ));
                }
            }
            CapturedReadKind::Auth => {}
            CapturedReadKind::Permission => {}
        }
    }
    Ok(())
}

fn dependency_table(dependency: &CapturedReadDependency) -> SnapbackResult<&str> {
    dependency.table.as_deref().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_CAPTURED_READ_INVALID",
            "storage",
            "captured dependency is missing a table",
        )
    })
}

fn dependency_id(dependency: &CapturedReadDependency) -> SnapbackResult<&str> {
    dependency.id.as_deref().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_CAPTURED_READ_INVALID",
            "storage",
            "captured dependency is missing a row id",
        )
    })
}

fn captured_conflict(
    message: &str,
    dependency: &CapturedReadDependency,
    details: Value,
    read_set: &[CapturedReadDependency],
) -> SnapbackError {
    SnapbackError::error("SNAPBACK_MUTATION_CONFLICT", "storage", message)
        .with_detail("dependency", details)
        .with_detail("capturedDependency", json!(dependency))
        .with_detail("capturedReads", json!(read_set))
        .with_detail("retryPolicy", "reject")
}

fn get_row_version(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
) -> SnapbackResult<Option<u64>> {
    let mut statement = tx.prepare_cached(&format!(
        "SELECT _version FROM {} WHERE _id = ?1",
        quote_ident(&table.name)?
    ))?;
    let version: Option<i64> = statement
        .query_row(params![id], |row| row.get(0))
        .optional()?;
    Ok(version.map(|version| version as u64))
}

fn table_change_version_from_connection(conn: &Connection, table: &str) -> SnapbackResult<u64> {
    let version: Option<i64> = conn.query_row(
        "SELECT MAX(version) FROM _snapback_changes WHERE table_name = ?1",
        params![table],
        |row| row.get(0),
    )?;
    Ok(version.unwrap_or(0) as u64)
}

fn table_change_version_from_tx(tx: &Transaction<'_>, table: &str) -> SnapbackResult<u64> {
    let mut statement =
        tx.prepare_cached("SELECT MAX(version) FROM _snapback_changes WHERE table_name = ?1")?;
    let version: Option<i64> = statement.query_row(params![table], |row| row.get(0))?;
    Ok(version.unwrap_or(0) as u64)
}

/// The changes to `table` committed after `version`, reconstructed as
/// `ChangedRow`s. `changed_fields` is not journaled, so it is left empty (the
/// matcher treats an update with unknown changed fields conservatively).
///
/// @ref LLP 0032#phase-2--execution-semantics-honesty — E4: predicate-granularity validation.
fn changes_to_table_since(
    tx: &Transaction<'_>,
    table: &str,
    version: u64,
) -> SnapbackResult<Vec<ChangedRow>> {
    let mut statement = tx.prepare_cached(
        "SELECT row_id, op, row_json FROM _snapback_changes \
         WHERE table_name = ?1 AND version > ?2 ORDER BY version, id",
    )?;
    let rows = statement.query_map(params![table, version as i64], |row| {
        let id: String = row.get(0)?;
        let op: String = row.get(1)?;
        let row_json: Option<String> = row.get(2)?;
        Ok((id, op, row_json))
    })?;
    let mut changes = Vec::new();
    for row in rows {
        let (id, op, row_json) = row?;
        let op = match op.as_str() {
            "insert" => ChangeOp::Insert,
            "update" => ChangeOp::Update,
            _ => ChangeOp::Delete,
        };
        let row = row_json
            .as_deref()
            .and_then(|json| serde_json::from_str::<Value>(json).ok());
        changes.push(ChangedRow {
            table: table.to_owned(),
            id,
            op,
            row,
            changed_fields: Vec::new(),
        });
    }
    Ok(changes)
}

/// The monotonic retention floor recorded by pruning (0 if none). A captured
/// read below it cannot be validated precisely — the changes it would need were
/// pruned — so validation must fall back to a conservative conflict.
///
/// @ref LLP 0032#phase-3--lifecycle-and-resource-hardening — L3 / E4.
fn retention_floor_from_tx(tx: &Transaction<'_>) -> SnapbackResult<u64> {
    let value: Option<String> = tx
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![META_RETENTION_FLOOR],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value.and_then(|value| value.parse().ok()).unwrap_or(0))
}

fn captured_writes_from_changes(changes: &[ChangedRow]) -> Vec<CapturedWriteDependency> {
    changes
        .iter()
        .map(|change| CapturedWriteDependency {
            table: change.table.clone(),
            id: change.id.clone(),
            op: change.op.clone(),
        })
        .collect()
}

fn changed_field_names(values: &Map<String, Value>) -> Vec<String> {
    let mut fields = values.keys().cloned().collect::<Vec<_>>();
    fields.sort();
    fields
}

fn eval_value_map(
    values: &BTreeMap<String, ValueExpr>,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    now_ms: u64,
    runtime_id: &dyn Fn() -> SnapbackResult<String>,
) -> SnapbackResult<Map<String, Value>> {
    let mut output = Map::new();
    for (key, expr) in values {
        output.insert(
            key.clone(),
            eval_expr(expr, input, bindings, now_ms, Some(runtime_id))?,
        );
    }
    Ok(output)
}

// One shared evaluator (crate::value_expr) serves mutation execution, the
// live matcher, and filter→SQL compilation, so semantics cannot drift per
// call site (LLP 0051 D2's analyzability invariant).
fn eval_expr(
    expr: &ValueExpr,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    now_ms: u64,
    runtime_id: Option<&dyn Fn() -> SnapbackResult<String>>,
) -> SnapbackResult<Value> {
    let default_id = || Ok(new_id());
    let env = crate::value_expr::ExprEnv {
        args: &input.args,
        auth_user_id: input.auth.user_id.as_deref(),
        auth_kind: input.auth.authorization_kind.as_deref(),
        auth_actor_kind: input.auth.authorization_actor_kind.as_deref(),
        auth_is_delegated: input.auth.authorization_is_delegated,
        bindings: Some(bindings),
        now_ms: Some(now_ms),
        runtime_id: Some(runtime_id.unwrap_or(&default_id)),
    };
    crate::value_expr::eval_value_expr(expr, &env).map_err(|error| error.into_snapback())
}

/// Evaluate one host-owned declarative authorization decision under the
/// delegated projection and its sealed direct-human baseline. Closed IR lets
/// actor-independent decisions reuse the identical answer; actor-aware nodes
/// are evaluated twice and callers intersect the resulting constraints.
/// Runtime intrinsics are refused before evaluation so the second projection
/// cannot allocate a second id or observe a different clock.
// @ref LLP 0055#resolved-authority-serviceprincipal — single execution, per-decision double authorization, stricter answer wins.
fn eval_authorization_decision_values(
    expr: &ValueExpr,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    direct_bindings: Option<&BTreeMap<String, Value>>,
    now_ms: u64,
    runtime_id: Option<&dyn Fn() -> SnapbackResult<String>>,
) -> SnapbackResult<Vec<Value>> {
    let is_actor_aware = authorization_expr_depends_on_projection(
        expr,
        input,
        bindings,
        direct_bindings,
    );
    if input.auth.authorization_is_delegated
        && is_actor_aware
        && expr.uses_runtime_intrinsic()
    {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED",
            "auth",
            "actor-aware authorization decisions cannot depend on runtime clock or id inputs",
        ));
    }
    let delegated = eval_expr(expr, input, bindings, now_ms, runtime_id)?;
    if !input.auth.authorization_is_delegated || !is_actor_aware {
        return Ok(vec![delegated]);
    }
    let mut direct = input.clone();
    direct.auth = input
        .auth
        .direct_authorization_baseline()
        .expect("delegated authorization input has a direct baseline");
    Ok(vec![
        delegated,
        eval_expr(
            expr,
            &direct,
            direct_bindings.unwrap_or(bindings),
            now_ms,
            runtime_id,
        )?,
    ])
}

fn authorization_expr_depends_on_projection(
    expr: &ValueExpr,
    input: &HandlerInput,
    bindings: &BTreeMap<String, Value>,
    direct_bindings: Option<&BTreeMap<String, Value>>,
) -> bool {
    input.auth.authorization_is_delegated
        && direct_bindings.map_or_else(
            || expr.uses_actor_projection(),
            |direct| value_expr_depends_on_projection(expr, bindings, direct),
        )
}

fn value_expr_depends_on_projection(
    expr: &ValueExpr,
    bindings: &BTreeMap<String, Value>,
    direct_bindings: &BTreeMap<String, Value>,
) -> bool {
    match expr {
        ValueExpr::AuthActorKind | ValueExpr::AuthIsDelegated => true,
        ValueExpr::Binding(name) => bindings.get(name) != direct_bindings.get(name),
        ValueExpr::Field { base, .. } => {
            value_expr_depends_on_projection(base, bindings, direct_bindings)
        }
        ValueExpr::Binary { left, right, .. } => {
            value_expr_depends_on_projection(left, bindings, direct_bindings)
                || value_expr_depends_on_projection(right, bindings, direct_bindings)
        }
        ValueExpr::Unary { expr, .. } => {
            value_expr_depends_on_projection(expr, bindings, direct_bindings)
        }
        ValueExpr::If { cond, then, r#else } => {
            value_expr_depends_on_projection(cond, bindings, direct_bindings)
                || value_expr_depends_on_projection(then, bindings, direct_bindings)
                || value_expr_depends_on_projection(r#else, bindings, direct_bindings)
        }
        ValueExpr::Concat(values) | ValueExpr::Call { args: values, .. } => values
            .iter()
            .any(|value| value_expr_depends_on_projection(value, bindings, direct_bindings)),
        ValueExpr::Record { fields } => fields
            .values()
            .any(|value| value_expr_depends_on_projection(value, bindings, direct_bindings)),
        ValueExpr::Arg(_)
        | ValueExpr::Args
        | ValueExpr::AuthUserId
        | ValueExpr::AuthKind
        | ValueExpr::Literal(_)
        | ValueExpr::RuntimeId
        | ValueExpr::RuntimeNow
        | ValueExpr::MembershipExists(_) => false,
    }
}

fn timestamp_to_sql_millis(value: u64) -> SnapbackResult<i64> {
    validate_portable_timestamp_millis(value)?;
    i64::try_from(value).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_TIMESTAMP_OUT_OF_RANGE",
            "storage",
            format!("runtime timestamp {value} cannot be represented by the storage engine"),
        )
    })
}

fn seed_into_transaction(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    seed: SeedData,
    version: u64,
) -> SnapbackResult<Vec<ChangedRow>> {
    let mut changes = Vec::new();
    let now_ms = now_millis();
    for (table_name, rows) in seed.tables {
        let table = schema_table(schema, &table_name)?;
        for mut row in rows {
            // Declarative seeds may choose a stable id, but every other
            // system field remains host-owned. Remove the seed identity
            // carrier before entering the same insert validator used by
            // handler/derived writes.
            let id = match row.remove("_id") {
                None => new_id(),
                Some(Value::String(id)) if !id.is_empty() => id,
                Some(_) => {
                    return Err(SnapbackError::error(
                        "SNAPBACK_SEED_INVALID",
                        "storage",
                        format!("seed _id for {table_name} must be a nonempty string"),
                    ));
                }
            };
            let changed_fields = changed_field_names(&row);
            let document = insert_document(tx, table, &id, &row, version, now_ms)?;
            record_change(
                tx,
                version,
                &table.name,
                &id,
                ChangeOp::Insert,
                Some(&document),
                now_ms,
            )?;
            changes.push(ChangedRow {
                table: table.name.clone(),
                id,
                op: ChangeOp::Insert,
                row: Some(document),
                changed_fields,
            });
        }
    }
    Ok(changes)
}

fn version_to_sql_integer(value: u64) -> SnapbackResult<i64> {
    i64::try_from(value).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_VERSION_OUT_OF_RANGE",
            "storage",
            format!("version {value} cannot be represented by the storage engine"),
        )
    })
}

// ============================================================================
// LLP 0056 M2: the membership write path
//
// The write surface the review loop reshaped most (§Writes). Its shape here:
//   * a declared transition matrix, closed by default — every fact (caller
//     class, target self/other, old role, new role) is derived by the host from
//     the TARGET ROW READ IN THE SAME TRANSACTION, never from a caller argument;
//   * a writer-class seam below BOTH buffered Ibex writes and HostPlan (the
//     `enforce_membership_write_gate` / HostPlan pre-pass above) — a `ctx.db`-only
//     gate would be a hole;
//   * `lastHolder` counting ELIGIBLE holders (LLP 0055 `deactivated_at`, reused
//     from G1) with the holder-set, resource-existence, and roster-emptiness
//     aggregates CAPTURED so concurrent finals cannot both commit;
//   * creation/deletion witnesses (bootstrap/teardown) bound to the resource row
//     actually appearing/disappearing in this transaction.
//
// The generated JS methods (`ctx.membership.<decl>.*`) dispatch through the
// host-owned command/authority carrier into these methods (see
// `IbexHostContext::handle_host_call`). Cron->sweep remains the separate LLP
// 0004 follow-on.
// ============================================================================

/// The resolved authority a membership write runs under, mapped from
/// `ResolvedAppAuthority`. The invocation classes carry an effective principal;
/// autonomous service principals additionally retain the grant that authorized
/// them. `System`/`AdminBypass`/`Anonymous` match **no** transition class at all
/// — not even `"none"` (§Writes: "an authority with no effective principal
/// matches _no_ class"). `Seed`/`Import`/`Admin` are the privileged
/// non-invocation writers: they carry their own authority and so bypass the
/// transition matrix, but every table invariant still applies.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
///   writer-class matrix; userless authorities are refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MembershipWriter {
    User { effective_principal: String },
    Delegated {
        actor_principal: String,
        effective_principal: String,
        grant_id: String,
        authority_creating_consent: bool,
    },
    Autonomous {
        actor_principal: String,
        grant_id: String,
        authority_creating_consent: bool,
    },
    System,
    AdminBypass,
    Anonymous,
    Seed,
    Import {
        granted_by_actor: String,
        granted_by_effective: String,
        granted_by_grant: Option<String>,
    },
    Admin,
}

impl MembershipWriter {
    /// Map the resolved app authority to a membership writer class. `Session`
    /// and dev-impersonation carry the effective principal; system, adminBypass
    /// (which LLP 0039 projects as anonymous), and anonymous carry none. This is
    /// the seam the LLP 0004 bridge crosses when it wires `ctx.membership.*` to
    /// these host methods.
    pub fn from_resolved(resolved: &crate::auth::invocation::ResolvedAppAuthority) -> Self {
        Self::from_resolved_with_authority_creating(resolved, false)
    }

    pub(crate) fn from_resolved_with_authority_creating(
        resolved: &crate::auth::invocation::ResolvedAppAuthority,
        authority_creating_consent: bool,
    ) -> Self {
        use crate::auth::invocation::ResolvedAppAuthority as Resolved;
        match resolved {
            Resolved::Session { user_id, .. } | Resolved::DevImpersonation { user_id, .. } => {
                Self::User {
                    effective_principal: user_id.clone(),
                }
            }
            Resolved::ServicePrincipal {
                actor_user_id,
                effective_user_id,
                grant_id,
                ..
            } => effective_user_id.as_ref().map_or_else(
                || Self::Autonomous {
                    actor_principal: actor_user_id.clone(),
                    grant_id: grant_id.clone(),
                    authority_creating_consent,
                },
                |effective_user_id| Self::Delegated {
                    actor_principal: actor_user_id.clone(),
                    effective_principal: effective_user_id.clone(),
                    grant_id: grant_id.clone(),
                    authority_creating_consent,
                },
            ),
            Resolved::System => Self::System,
            Resolved::AdminBypass { .. } => Self::AdminBypass,
            Resolved::Anonymous => Self::Anonymous,
        }
    }

    pub(crate) fn is_service_principal(&self) -> bool {
        matches!(self, Self::Delegated { .. } | Self::Autonomous { .. })
    }

    pub(crate) fn has_authority_creating_consent(&self) -> bool {
        match self {
            Self::Delegated {
                authority_creating_consent,
                ..
            }
            | Self::Autonomous {
                authority_creating_consent,
                ..
            } => *authority_creating_consent,
            _ => false,
        }
    }

    /// The effective principal, or `None` for every userless / non-invocation
    /// writer. A `None` here is what makes an open-join `by: ["none"]` transition
    /// unreachable by a userless authority.
    fn effective_principal(&self) -> Option<&str> {
        match self {
            Self::User { effective_principal }
            | Self::Delegated {
                effective_principal,
                ..
            } => Some(effective_principal),
            Self::Autonomous {
                actor_principal, ..
            } => Some(actor_principal),
            _ => None,
        }
    }

    fn is_privileged_noninvocation(&self) -> bool {
        matches!(self, Self::Seed | Self::Import { .. } | Self::Admin)
    }

    fn provenance(&self) -> Option<MembershipWriteProvenance> {
        let values = match self {
            Self::User { effective_principal } => MembershipWriteProvenance {
                actor: effective_principal.clone(),
                effective: effective_principal.clone(),
                grant: None,
                writer_class: "invocation".to_owned(),
            },
            Self::Delegated {
                actor_principal,
                effective_principal,
                grant_id,
                ..
            } => MembershipWriteProvenance {
                actor: actor_principal.clone(),
                effective: effective_principal.clone(),
                grant: Some(grant_id.clone()),
                writer_class: "delegated".to_owned(),
            },
            Self::Autonomous {
                actor_principal,
                grant_id,
                ..
            } => MembershipWriteProvenance {
                actor: actor_principal.clone(),
                effective: actor_principal.clone(),
                grant: Some(grant_id.clone()),
                writer_class: "autonomous".to_owned(),
            },
            Self::System => MembershipWriteProvenance::tagged("system"),
            Self::Seed => MembershipWriteProvenance::tagged("seed"),
            Self::Import {
                granted_by_actor,
                granted_by_effective,
                granted_by_grant,
            } => MembershipWriteProvenance {
                actor: granted_by_actor.clone(),
                effective: granted_by_effective.clone(),
                grant: granted_by_grant.clone(),
                writer_class: "import".to_owned(),
            },
            Self::Admin => MembershipWriteProvenance::tagged("hostOps:dataEdit"),
            Self::AdminBypass | Self::Anonymous => return None,
        };
        Some(values)
    }

    /// A minimal handler input carrying just the effective principal so the
    /// sanctioned commit records a coherent auth fingerprint. Membership writes
    /// never carry a client read set (the host derives every fact); the captured
    /// aggregates ride `read_dependencies`.
    fn handler_input(&self) -> HandlerInput {
        let principal = self.effective_principal().map(str::to_owned);
        HandlerInput {
            auth: AuthInput {
                principal: principal.clone(),
                session_id: None,
                user_id: principal,
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct MembershipWriteProvenance {
    actor: String,
    effective: String,
    grant: Option<String>,
    writer_class: String,
}

impl MembershipWriteProvenance {
    fn tagged(tag: &str) -> Self {
        Self {
            actor: tag.to_owned(),
            effective: tag.to_owned(),
            grant: None,
            writer_class: tag.to_owned(),
        }
    }
}

/// The caller's authorization class over a resource, disjoint and totally
/// ordered — `Own` ("self") wins over any `Role`, and `None` is the authenticated
/// member-less member. A userless authority produces no class and never reaches
/// this type.
enum MembershipCallerClass {
    Own,
    Role(String),
    None,
}

impl MembershipCallerClass {
    fn token(&self) -> &str {
        match self {
            Self::Own => "self",
            Self::Role(role) => role,
            Self::None => "none",
        }
    }
}

/// A read of the membership target row: the axes and the row version that the
/// write captures as a snapshot-bound dependency (so a role revoked between the
/// check and commit fails commit-time validation).
struct MembershipTargetRow {
    id: String,
    principal: String,
    resource: Option<String>,
    role: String,
    version: u64,
}

/// The pre-authorized effect of one membership operation: the row writes plus
/// the captured aggregate dependencies, ready to commit under the `Sanctioned`
/// gate. The plan/commit split exists so two concurrent operations can be
/// evaluated against one snapshot and then committed in sequence, exercising the
/// captured-read linearization exactly as the buffered handler path would.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
///   holder-set / resource-existence reads are captured, not snapshot-only.
#[derive(Debug)]
pub struct MembershipPlan {
    writes: Vec<BufferedWrite>,
    read_dependencies: Vec<CapturedReadDependency>,
    result: Value,
    /// Rows the expiry sweep skipped because they are the last eligible holder
    /// of a protected role (protection wins over expiry). Empty for every other
    /// operation.
    skipped_protected: Vec<String>,
}

/// A membership effect whose writer was derived from the closed invocation
/// authority by the Rust host. Application code can request a declaration-bound
/// operation, but it cannot construct or alter this carrier.
///
/// @ref LLP 0056#protocol-obligations-deferred-to-implementation — the host-owned writer-authority carrier
///   remains distinct from raw buffered writes through replay, dry-run, and
///   nested mutation commit.
#[derive(Debug)]
pub(crate) struct AuthorizedMembershipPlan {
    writer: MembershipWriter,
    plan: MembershipPlan,
}

impl AuthorizedMembershipPlan {
    pub(crate) fn user_transition(writer: MembershipWriter, plan: MembershipPlan) -> Self {
        Self { writer, plan }
    }
}

/// A declaration-bound membership operation buffered by the host bridge. Both
/// the table binding and writer are host-derived; only operation arguments come
/// from application code.
#[derive(Debug)]
pub(crate) struct BufferedMembershipCommand {
    writer: MembershipWriter,
    table: String,
    op: BufferedMembershipOp,
}

#[derive(Debug)]
enum BufferedMembershipOp {
    Insert(Map<String, Value>),
    SetRole {
        member_id: String,
        role: String,
    },
    Remove {
        member_id: String,
    },
    Patch {
        member_id: String,
        values: Map<String, Value>,
    },
}

impl BufferedMembershipCommand {
    pub(crate) fn insert(
        writer: MembershipWriter,
        table: String,
        values: Map<String, Value>,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::Insert(values),
        }
    }

    pub(crate) fn set_role(
        writer: MembershipWriter,
        table: String,
        member_id: String,
        role: String,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::SetRole { member_id, role },
        }
    }

    pub(crate) fn remove(writer: MembershipWriter, table: String, member_id: String) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::Remove { member_id },
        }
    }

    pub(crate) fn patch(
        writer: MembershipWriter,
        table: String,
        member_id: String,
        values: Map<String, Value>,
    ) -> Self {
        Self {
            writer,
            table,
            op: BufferedMembershipOp::Patch { member_id, values },
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MembershipCreationProvenance {
    pub actor: String,
    pub effective: String,
    pub grant: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MembershipTransitionRecord {
    pub declaration: String,
    pub op: String,
    pub principal: String,
    pub resource: Option<String>,
    pub from_role: Option<String>,
    pub to_role: Option<String>,
    pub actor: String,
    pub effective: String,
    pub grant: Option<String>,
    pub commit_version: u64,
    pub writer_class: String,
}

impl MembershipPlan {
    /// Rows the sweep left live because `lastHolder` wins over expiry.
    pub fn skipped_protected(&self) -> &[String] {
        &self.skipped_protected
    }
}

fn membership_refusal(code: &str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "auth", message)
}

fn resolve_membership_decl<'a>(
    schema: &'a SchemaManifest,
    table: &str,
) -> SnapbackResult<(&'a TableManifest, &'a MembershipManifest)> {
    let table = schema_table(schema, table)?;
    let membership = table.membership.as_ref().ok_or_else(|| {
        membership_refusal(
            "SNAPBACK_MEMBERSHIP_NOT_DECLARED",
            format!("table {} carries no .membership() declaration", table.name),
        )
    })?;
    Ok((table, membership))
}

fn read_membership_row(
    conn: &Connection,
    table: &TableManifest,
    membership: &MembershipManifest,
    id: &str,
) -> SnapbackResult<Option<MembershipTargetRow>> {
    let mut columns = vec![membership.principal.clone(), membership.role.clone()];
    if let Some(resource) = &membership.resource {
        columns.push(resource.clone());
    }
    let quoted = columns
        .iter()
        .map(|column| quote_ident(column))
        .collect::<SnapbackResult<Vec<_>>>()?
        .join(", ");
    let sql = format!(
        "SELECT {quoted}, _version FROM {} WHERE _id = ?1",
        quote_ident(&table.name)?
    );
    let has_resource = membership.resource.is_some();
    let row = conn
        .query_row(&sql, params![id], |row| {
            let principal: String = row.get(0)?;
            let role: String = row.get(1)?;
            let (resource, version): (Option<String>, i64) = if has_resource {
                (row.get(2)?, row.get(3)?)
            } else {
                (None, row.get(2)?)
            };
            Ok(MembershipTargetRow {
                id: id.to_owned(),
                principal,
                resource,
                role,
                version: version as u64,
            })
        })
        .optional()?;
    Ok(row)
}

/// The caller's own role over a resource, read in the same connection. `None`
/// means the caller holds no membership for that resource in this declaration
/// (the `"none"` open-join class).
fn read_caller_role(
    conn: &Connection,
    table: &TableManifest,
    membership: &MembershipManifest,
    resource: Option<&str>,
    principal: &str,
) -> SnapbackResult<Option<String>> {
    let (sql, bound): (String, Vec<String>) = match (&membership.resource, resource) {
        (Some(resource_col), Some(resource_value)) => (
            format!(
                "SELECT {role} FROM {table} WHERE {principal} = ?1 AND {resource} = ?2",
                role = quote_ident(&membership.role)?,
                table = quote_ident(&table.name)?,
                principal = quote_ident(&membership.principal)?,
                resource = quote_ident(resource_col)?,
            ),
            vec![principal.to_owned(), resource_value.to_owned()],
        ),
        (None, _) => (
            format!(
                "SELECT {role} FROM {table} WHERE {principal} = ?1",
                role = quote_ident(&membership.role)?,
                table = quote_ident(&table.name)?,
                principal = quote_ident(&membership.principal)?,
            ),
            vec![principal.to_owned()],
        ),
        (Some(_), None) => return Ok(None),
    };
    let role = conn
        .query_row(&sql, params_from_iter(bound.iter()), |row| {
            row.get::<_, String>(0)
        })
        .optional()?;
    Ok(role)
}

fn read_resource_version(
    conn: &Connection,
    resource_table: &str,
    resource_id: &str,
) -> SnapbackResult<Option<u64>> {
    let version: Option<i64> = conn
        .query_row(
            &format!(
                "SELECT _version FROM {} WHERE _id = ?1",
                quote_ident(resource_table)?
            ),
            params![resource_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(version.map(|version| version as u64))
}

/// Find a transition that authorizes `(op, caller class, target, from, to)`.
/// Closed by default: `None` means refuse. Field-binding is validated by the
/// caller once a candidate op/class/target/role match is found — an op match
/// that fails field-binding is still a refusal, never a silent narrowing.
fn matches_role_lists(transition: &crate::manifest::MembershipTransition, from: Option<&str>, to: Option<&str>) -> bool {
    let from_ok = match (from, &transition.from) {
        (None, _) => true,
        (Some(from), Some(list)) => list.iter().any(|role| role == from),
        (Some(_), None) => false,
    };
    let to_ok = match (to, &transition.to) {
        (None, _) => true,
        (Some(to), Some(list)) => list.iter().any(|role| role == to),
        (Some(_), None) => false,
    };
    from_ok && to_ok
}

/// The generated true-unique index makes concurrent same-pair inserts resolve to
/// one row; the referential-integrity and closed-vocabulary refusals are
/// enforced here on the live path for every writer, not only at activation.
impl LocalDatabase {
    pub(crate) fn authorize_membership_commands(
        &self,
        commands: Vec<BufferedMembershipCommand>,
    ) -> SnapbackResult<Vec<AuthorizedMembershipPlan>> {
        commands
            .into_iter()
            .map(|command| {
                let plan = match command.op {
                    BufferedMembershipOp::Insert(values) => {
                        self.plan_membership_insert(&command.writer, &command.table, values)?
                    }
                    BufferedMembershipOp::SetRole { member_id, role } => self
                        .plan_membership_set_role(
                            &command.writer,
                            &command.table,
                            &member_id,
                            &role,
                        )?,
                    BufferedMembershipOp::Remove { member_id } => self
                        .plan_membership_remove(&command.writer, &command.table, &member_id)?,
                    BufferedMembershipOp::Patch { member_id, values } => self
                        .plan_membership_patch(
                            &command.writer,
                            &command.table,
                            &member_id,
                            values,
                        )?,
                };
                Ok(AuthorizedMembershipPlan::user_transition(command.writer, plan))
            })
            .collect()
    }

    /// Commit a pre-authorized membership effect under the `Sanctioned` gate:
    /// the engine has already derived and checked the transition, `lastHolder`,
    /// referential integrity, and the witnesses, so the raw-write refusal and
    /// resource-delete guard are waived for exactly these writes. The captured
    /// aggregates are validated at commit like every other read set.
    pub fn commit_membership_plan(
        &mut self,
        writer: &MembershipWriter,
        plan: MembershipPlan,
    ) -> SnapbackResult<MutationCommit> {
        let input = writer.handler_input();
        self.apply_buffered_writes_with_lifecycle_gated(
            &input,
            BufferedEffects {
                writes: plan.writes,
                membership_plans: Vec::new(),
                read_dependencies: plan.read_dependencies,
                result: plan.result,
            },
            BufferedCommitOptions {
                ctx_ledger: None,
                apply: true,
                identity: None,
            },
            MembershipCommitAuthority::sanctioned(writer),
            &|| Ok(()),
            || Ok(()),
        )
    }

    /// Build a privileged non-invocation insert. Seed, import, and admin data
    /// edit carry their own authority, so they bypass the transition matrix but
    /// still pass the closed vocabulary, resource, uniqueness, eligibility,
    /// provenance, and invalidation seams at commit.
    pub fn plan_privileged_membership_insert(
        &self,
        writer: &MembershipWriter,
        table: &str,
        values: Map<String, Value>,
    ) -> SnapbackResult<MembershipPlan> {
        if !writer.is_privileged_noninvocation() {
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_REQUIRED",
                "privileged membership insertion requires seed, import, or admin data-edit authority",
            ));
        }
        let schema = self.schema.clone();
        let (table_manifest, membership) = resolve_membership_decl(&schema, table)?;
        let principal = extract_axis(&values, &membership.principal, "principal")?;
        let role = extract_axis(&values, &membership.role, "role")?;
        require_in_vocabulary(membership, &role)?;
        if let (Some(resource_field), Some(resource_table)) =
            (&membership.resource, &membership.resource_table)
        {
            let resource = extract_axis(&values, resource_field, "resource")?;
            if read_resource_version(&self.conn, resource_table, &resource)?.is_none() {
                return Err(membership_refusal(
                    "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING",
                    format!(
                        "privileged membership insert names resource {resource:?}, which does not exist in {resource_table}"
                    ),
                ));
            }
        }
        self.require_eligible_if_protected(membership, &role, &principal)?;
        Ok(MembershipPlan {
            writes: vec![BufferedWrite::Insert {
                table: table_manifest.name.clone(),
                id: new_id(),
                values,
            }],
            read_dependencies: Vec::new(),
            result: Value::Null,
            skipped_protected: Vec::new(),
        })
    }

    pub fn membership_creation_provenance(
        &self,
        table: &str,
        id: &str,
    ) -> SnapbackResult<Option<MembershipCreationProvenance>> {
        let (table, membership) = resolve_membership_decl(&self.schema, table)?;
        if membership.provenance.is_none() {
            return Ok(None);
        }
        self.conn
            .query_row(
                &format!(
                    "SELECT {}, {}, {} FROM {} WHERE _id = ?1",
                    quote_ident(MEMBERSHIP_GRANTED_BY_ACTOR)?,
                    quote_ident(MEMBERSHIP_GRANTED_BY_EFFECTIVE)?,
                    quote_ident(MEMBERSHIP_GRANTED_BY_GRANT)?,
                    quote_ident(&table.name)?,
                ),
                params![id],
                |row| {
                    Ok(MembershipCreationProvenance {
                        actor: row.get(0)?,
                        effective: row.get(1)?,
                        grant: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(SnapbackError::from)
    }

    pub fn membership_transition_log(
        &self,
        declaration: &str,
    ) -> SnapbackResult<Vec<MembershipTransitionRecord>> {
        let mut statement = self.conn.prepare(
            "SELECT declaration_id, op, principal, resource, from_role, to_role,
                    actor, effective, grant_id, commit_version, writer_class
             FROM _snapback_membership_transitions
             WHERE declaration_id = ?1
             ORDER BY commit_version, id",
        )?;
        statement
            .query_map(params![declaration], |row| {
                Ok(MembershipTransitionRecord {
                    declaration: row.get(0)?,
                    op: row.get(1)?,
                    principal: row.get(2)?,
                    resource: row.get(3)?,
                    from_role: row.get(4)?,
                    to_role: row.get(5)?,
                    actor: row.get(6)?,
                    effective: row.get(7)?,
                    grant: row.get(8)?,
                    commit_version: row.get::<_, i64>(9)? as u64,
                    writer_class: row.get(10)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(SnapbackError::from)
    }

    /// Plan an `insert` transition (open-join, invite, ...). Reads the resource
    /// row and captures it (referential integrity + insert-vs-teardown race),
    /// derives the caller class over that resource, and matches the declared
    /// matrix. Field-bound: a column outside the matched transition's `fields`
    /// (e.g. an open-join seating its own far-future `expiresAt`) is refused.
    pub fn plan_membership_insert(
        &self,
        writer: &MembershipWriter,
        table: &str,
        values: Map<String, Value>,
    ) -> SnapbackResult<MembershipPlan> {
        let schema = self.schema.clone();
        let (table_manifest, membership) = resolve_membership_decl(&schema, table)?;
        // A userless authority matches no class, including `"none"`.
        let effective = self.require_effective_principal(writer)?;

        let inserted_principal = extract_axis(&values, &membership.principal, "principal")?;
        let inserted_role = extract_axis(&values, &membership.role, "role")?;
        require_in_vocabulary(membership, &inserted_role)?;
        let inserted_resource = match &membership.resource {
            Some(resource_field) => Some(extract_axis(&values, resource_field, "resource")?),
            None => None,
        };

        let mut read_dependencies = Vec::new();

        // Referential integrity: the resource row must exist, and we capture it
        // so a concurrent teardown/delete linearizes at commit.
        if let (Some(resource_id), Some(resource_table)) =
            (inserted_resource.as_deref(), membership.resource_table.as_deref())
        {
            let version = read_resource_version(&self.conn, resource_table, resource_id)?
                .ok_or_else(|| {
                    membership_refusal(
                        "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING",
                        format!(
                            "membership insert names resource {resource_id:?}, which does not \
                             exist in {resource_table}"
                        ),
                    )
                })?;
            read_dependencies.push(resource_row_dependency(resource_table, resource_id, version));
        }

        // Caller class over the inserted resource, and target self/other.
        let target = if inserted_principal == effective {
            MembershipTarget::Own
        } else {
            MembershipTarget::Other
        };
        let caller_role = read_caller_role(
            &self.conn,
            table_manifest,
            membership,
            inserted_resource.as_deref(),
            effective,
        )?;
        let class = match caller_role {
            Some(role) => MembershipCallerClass::Role(role),
            None => MembershipCallerClass::None,
        };

        let matched = membership
            .transitions
            .iter()
            .find(|transition| {
                transition.op == MembershipOp::Insert
                    && transition.target == target
                    && transition.by.iter().any(|by| by == class.token())
                    && matches_role_lists(transition, None, Some(&inserted_role))
            })
            .ok_or_else(|| transition_denied(MembershipOp::Insert, class.token(), target))?;

        // Field-bound insert: only the axes and the matched transition's `fields`
        // may be written.
        enforce_insert_fields(membership, matched, &values)?;

        // Seating into a protected role requires an eligible principal — the set
        // can never be kept full with corpses.
        self.require_eligible_if_protected(membership, &inserted_role, &inserted_principal)?;

        let id = new_id();
        Ok(MembershipPlan {
            writes: vec![BufferedWrite::Insert {
                table: table_manifest.name.clone(),
                id,
                values,
            }],
            read_dependencies,
            result: Value::Null,
            skipped_protected: Vec::new(),
        })
    }

    /// Plan a `setRole` transition (accept-invite, promote, demote). Re-reads the
    /// **target row** and binds its own resource and principal (check-A/write-B
    /// is unspellable), then matches the matrix on `from`/`to`. Demoting the
    /// final eligible holder of a protected role is refused; promoting an
    /// ineligible principal into it is refused.
    pub fn plan_membership_set_role(
        &self,
        writer: &MembershipWriter,
        table: &str,
        member_id: &str,
        to_role: &str,
    ) -> SnapbackResult<MembershipPlan> {
        let schema = self.schema.clone();
        let (table_manifest, membership) = resolve_membership_decl(&schema, table)?;
        let effective = self.require_effective_principal(writer)?;
        require_in_vocabulary(membership, to_role)?;

        let row = read_membership_row(&self.conn, table_manifest, membership, member_id)?
            .ok_or_else(|| target_row_missing(member_id))?;
        let (class, target) = self.derive_class_and_target(
            table_manifest,
            membership,
            row.resource.as_deref(),
            &row.principal,
            effective,
        )?;

        let matched = membership
            .transitions
            .iter()
            .find(|transition| {
                transition.op == MembershipOp::SetRole
                    && transition.target == target
                    && transition.by.iter().any(|by| by == class.token())
                    && matches_role_lists(transition, Some(&row.role), Some(to_role))
            })
            .ok_or_else(|| transition_denied(MembershipOp::SetRole, class.token(), target))?;
        let _ = matched;

        let mut read_dependencies = vec![target_row_dependency(&table_manifest.name, &row)];

        // Demotion out of a protected role must leave an eligible holder; capture
        // the survivor so two concurrent demotions of the final two cannot both
        // commit.
        self.guard_protected_departure(
            table_manifest,
            membership,
            &row,
            to_role != protected_role(membership),
            &mut read_dependencies,
        )?;
        // Promotion into a protected role requires an eligible target principal.
        self.require_eligible_if_protected(membership, to_role, &row.principal)?;

        let mut patch = Map::new();
        patch.insert(membership.role.clone(), Value::String(to_role.to_owned()));
        Ok(MembershipPlan {
            writes: vec![BufferedWrite::Patch {
                table: table_manifest.name.clone(),
                id: row.id.clone(),
                values: patch,
            }],
            read_dependencies,
            result: Value::Null,
            skipped_protected: Vec::new(),
        })
    }

    /// Plan a `remove` transition (leave, decline, kick). Binds the target row's
    /// resource and principal; refuses removing the final eligible holder of a
    /// protected role (the teardown witness is the only path that clears it).
    pub fn plan_membership_remove(
        &self,
        writer: &MembershipWriter,
        table: &str,
        member_id: &str,
    ) -> SnapbackResult<MembershipPlan> {
        let schema = self.schema.clone();
        let (table_manifest, membership) = resolve_membership_decl(&schema, table)?;
        let effective = self.require_effective_principal(writer)?;

        let row = read_membership_row(&self.conn, table_manifest, membership, member_id)?
            .ok_or_else(|| target_row_missing(member_id))?;
        let (class, target) = self.derive_class_and_target(
            table_manifest,
            membership,
            row.resource.as_deref(),
            &row.principal,
            effective,
        )?;

        membership
            .transitions
            .iter()
            .find(|transition| {
                transition.op == MembershipOp::Remove
                    && transition.target == target
                    && transition.by.iter().any(|by| by == class.token())
                    && matches_role_lists(transition, Some(&row.role), None)
            })
            .ok_or_else(|| transition_denied(MembershipOp::Remove, class.token(), target))?;

        let mut read_dependencies = vec![target_row_dependency(&table_manifest.name, &row)];
        self.guard_protected_departure(table_manifest, membership, &row, true, &mut read_dependencies)?;

        Ok(MembershipPlan {
            writes: vec![BufferedWrite::Delete {
                table: table_manifest.name.clone(),
                id: row.id.clone(),
            }],
            read_dependencies,
            result: Value::Null,
            skipped_protected: Vec::new(),
        })
    }

    /// Plan a `patch` transition over the declaration's non-axis, non-role
    /// columns. Field-bound: a column outside the matched transition's `fields`
    /// is refused — in particular a `by: ["self"]` preferences patch cannot
    /// extend the member's own `expiresAt` (the self-renewal hole).
    pub fn plan_membership_patch(
        &self,
        writer: &MembershipWriter,
        table: &str,
        member_id: &str,
        values: Map<String, Value>,
    ) -> SnapbackResult<MembershipPlan> {
        let schema = self.schema.clone();
        let (table_manifest, membership) = resolve_membership_decl(&schema, table)?;
        let effective = self.require_effective_principal(writer)?;

        let row = read_membership_row(&self.conn, table_manifest, membership, member_id)?
            .ok_or_else(|| target_row_missing(member_id))?;
        let (class, target) = self.derive_class_and_target(
            table_manifest,
            membership,
            row.resource.as_deref(),
            &row.principal,
            effective,
        )?;

        // A patch never touches the axes or the role (immutability; role changes
        // go through setRole). Refuse before op matching so the error names the
        // real cause.
        for key in values.keys() {
            if key == &membership.principal
                || key == &membership.role
                || membership.resource.as_deref() == Some(key.as_str())
            {
                return Err(membership_refusal(
                    "SNAPBACK_MEMBERSHIP_PATCH_AXIS",
                    format!("patch may not write membership axis/role column {key:?}"),
                ));
            }
        }

        let matched = membership
            .transitions
            .iter()
            .find(|transition| {
                transition.op == MembershipOp::Patch
                    && transition.target == target
                    && transition.by.iter().any(|by| by == class.token())
                    && values
                        .keys()
                        .all(|key| transition.fields.iter().flatten().any(|field| field == key))
            })
            .ok_or_else(|| transition_denied(MembershipOp::Patch, class.token(), target))?;
        let _ = matched;

        Ok(MembershipPlan {
            writes: vec![BufferedWrite::Patch {
                table: table_manifest.name.clone(),
                id: row.id.clone(),
                values,
            }],
            read_dependencies: vec![target_row_dependency(&table_manifest.name, &row)],
            result: Value::Null,
            skipped_protected: Vec::new(),
        })
    }

    /// Plan the bootstrap of a fresh resource: insert the resource row and, in
    /// the SAME transaction, seat the server-derived effective principal in the
    /// declaration's `bootstrapRole`. The witness is bound to *this* creation —
    /// the resource id is host-minted and fresh, so a mutation that did not
    /// create the resource can never obtain it (an existing/emptied/imported
    /// resource has no fresh row to seat against). Single-use by construction:
    /// one resource insert, one bootstrap seat.
    ///
    /// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
    ///   bootstrap is bound to CREATION, not emptiness; it seats only the
    ///   server-derived effective principal in `bootstrapRole`.
    pub fn plan_membership_bootstrap(
        &self,
        writer: &MembershipWriter,
        resource_table: &str,
        resource_values: Map<String, Value>,
        membership_table: &str,
    ) -> SnapbackResult<MembershipPlan> {
        let schema = self.schema.clone();
        let (member_table_manifest, membership) =
            resolve_membership_decl(&schema, membership_table)?;
        // The bootstrap seat is the server-derived effective principal; a userless
        // authority cannot bootstrap.
        let effective = self.require_effective_principal(writer)?;
        let bootstrap_role = membership.bootstrap_role.as_deref().ok_or_else(|| {
            membership_refusal(
                "SNAPBACK_MEMBERSHIP_NO_BOOTSTRAP_ROLE",
                format!(
                    "declaration {} has no bootstrapRole to seat",
                    membership.effective_id(&member_table_manifest.name)
                ),
            )
        })?;
        if membership.resource_table.as_deref() != Some(resource_table) {
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_BOOTSTRAP_RESOURCE_MISMATCH",
                format!(
                    "declaration {} does not bind resource table {resource_table}",
                    membership.effective_id(&member_table_manifest.name)
                ),
            ));
        }
        // The bootstrap holder must be eligible (a deactivated principal cannot
        // invoke; this is defence in depth against a stale writer).
        self.require_eligible_if_protected(membership, bootstrap_role, effective)?;

        let resource_field = membership.resource.clone().ok_or_else(|| {
            membership_refusal(
                "SNAPBACK_MEMBERSHIP_BOOTSTRAP_APP_SCOPE",
                "bootstrap is a resource-scoped operation",
            )
        })?;
        let resource_id = new_id();
        let mut member_values = Map::new();
        member_values.insert(
            membership.principal.clone(),
            Value::String(effective.to_owned()),
        );
        member_values.insert(resource_field, Value::String(resource_id.clone()));
        member_values.insert(
            membership.role.clone(),
            Value::String(bootstrap_role.to_owned()),
        );

        Ok(MembershipPlan {
            writes: vec![
                BufferedWrite::Insert {
                    table: resource_table.to_owned(),
                    id: resource_id,
                    values: resource_values,
                },
                BufferedWrite::Insert {
                    table: member_table_manifest.name.clone(),
                    id: new_id(),
                    values: member_values,
                },
            ],
            read_dependencies: Vec::new(),
            result: Value::Null,
            skipped_protected: Vec::new(),
        })
    }

    /// Plan the teardown of a resource: clear the whole roster of every
    /// declaration bound to `resource_table` AND delete the resource row, in one
    /// transaction. The deletion witness waives `lastHolder` — a resource that
    /// ceases to exist strands nobody — resolving the delete-refused-vs-lastHolder
    /// deadlock. Unspellable outside a mutation that deletes that resource row.
    ///
    /// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
    ///   deletion witness -> teardown; `clearForResource` waives `lastHolder`.
    pub fn plan_membership_teardown(
        &self,
        writer: &MembershipWriter,
        resource_table: &str,
        resource_id: &str,
    ) -> SnapbackResult<MembershipPlan> {
        let schema = self.schema.clone();
        // Teardown deletes the resource under app authority; a userless authority
        // has no standing to delete it.
        self.require_effective_principal(writer)?;
        if read_resource_version(&self.conn, resource_table, resource_id)?.is_none() {
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_TEARDOWN_RESOURCE_MISSING",
                format!("teardown names resource {resource_id:?}, which does not exist"),
            ));
        }

        let mut writes = Vec::new();
        let mut read_dependencies = Vec::new();
        for table in &schema.tables {
            let Some(membership) = &table.membership else {
                continue;
            };
            if membership.scope != MembershipScope::Resource {
                continue;
            }
            if membership.resource_table.as_deref() != Some(resource_table) {
                continue;
            }
            let Some(resource_column) = membership.resource.as_deref() else {
                continue;
            };
            let sql = format!(
                "SELECT _id FROM {} WHERE {} = ?1",
                quote_ident(&table.name)?,
                quote_ident(resource_column)?
            );
            let mut statement = self.conn.prepare(&sql)?;
            let ids = statement
                .query_map(params![resource_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            for id in ids {
                writes.push(BufferedWrite::Delete {
                    table: table.name.clone(),
                    id,
                });
            }
            // Capture the roster emptiness conservatively: a concurrent open-join
            // insert that fills this resource's range after the plan snapshot
            // bumps the table's change version and fails this dependency at
            // commit, so an insert-then-teardown ordering yields exactly one
            // winner (no orphan on a deleted resource). The reverse ordering is
            // caught by the insert's captured resource row.
            // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
            //   the roster-emptiness read is captured, the third aggregate.
            read_dependencies.push(CapturedReadDependency {
                kind: CapturedReadKind::Query,
                table: Some(table.name.clone()),
                id: None,
                version: Some(table_change_version_from_connection(&self.conn, &table.name)?),
                predicate: None,
                rows: Vec::new(),
                field: None,
                value: None,
                order: None,
                limit: None,
                result_count: None,
                boundary: None,
            });
        }
        writes.push(BufferedWrite::Delete {
            table: resource_table.to_owned(),
            id: resource_id.to_owned(),
        });

        Ok(MembershipPlan {
            writes,
            read_dependencies,
            result: Value::Null,
            skipped_protected: Vec::new(),
        })
    }

    /// Plan the expiry sweep for one declaration. **System authority only** — the
    /// sole system-authority membership write. Acts only on rows of THIS
    /// declaration whose declared expiry field is past on `now_ms` (the
    /// rollback-checked clock the caller supplies), and performs only `remove`.
    /// `lastHolder` WINS over expiry: an expired final eligible holder of the
    /// protected role is skipped, left live, and named in `skipped_protected`
    /// (so `expiry` does not bound a protected role).
    ///
    /// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
    ///   remove-only; `lastHolder` wins over expiry with a typed diagnostic.
    pub fn plan_membership_sweep_expired(
        &self,
        writer: &MembershipWriter,
        table: &str,
        now_ms: u64,
    ) -> SnapbackResult<MembershipPlan> {
        if !matches!(writer, MembershipWriter::System) {
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_SWEEP_AUTHORITY",
                "sweepExpired is the only system-authority membership write and requires \
                 resolved system authority",
            ));
        }
        let schema = self.schema.clone();
        let (table_manifest, membership) = resolve_membership_decl(&schema, table)?;
        let expiry = membership.expiry.as_ref().ok_or_else(|| {
            membership_refusal(
                "SNAPBACK_MEMBERSHIP_NO_EXPIRY",
                format!(
                    "declaration {} declares no expiry field to sweep",
                    membership.effective_id(&table_manifest.name)
                ),
            )
        })?;

        // Rows whose declared expiry field is strictly in the past. A null expiry
        // is never swept.
        let mut columns = vec![membership.principal.clone(), membership.role.clone()];
        if let Some(resource) = &membership.resource {
            columns.push(resource.clone());
        }
        let quoted = columns
            .iter()
            .map(|column| quote_ident(column))
            .collect::<SnapbackResult<Vec<_>>>()?
            .join(", ");
        let sql = format!(
            "SELECT _id, {quoted} FROM {} WHERE {field} IS NOT NULL AND {field} < ?1 ORDER BY _id",
            quote_ident(&table_manifest.name)?,
            field = quote_ident(&expiry.field)?
        );
        let has_resource = membership.resource.is_some();
        let mut statement = self.conn.prepare(&sql)?;
        let expired = statement
            .query_map(params![now_ms as i64], |row| {
                let id: String = row.get(0)?;
                let principal: String = row.get(1)?;
                let role: String = row.get(2)?;
                let resource: Option<String> = if has_resource { row.get(3)? } else { None };
                Ok((id, principal, role, resource))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let protect = membership.last_holder.as_ref().map(|last| last.protect.clone());
        let mut writes = Vec::new();
        let mut skipped_protected = Vec::new();
        // Sequential accounting: a row already marked for removal is no longer a
        // surviving eligible holder, so two expired protected holders cannot both
        // be swept into a strand.
        let mut removed: BTreeSet<String> = BTreeSet::new();
        for (id, principal, role, resource) in expired {
            let is_protected_final = match (&protect, &resource) {
                (Some(protect), Some(resource)) if protect == &role => {
                    let survivors = crate::storage::auth_agents::eligible_protected_holder_rows(
                        &self.conn,
                        &table_manifest.name,
                        &membership.principal,
                        membership.resource.as_deref().unwrap_or_default(),
                        &membership.role,
                        resource,
                        protect,
                        &principal,
                    )?;
                    !survivors.iter().any(|(member_id, _, _)| !removed.contains(member_id))
                }
                _ => false,
            };
            if is_protected_final {
                skipped_protected.push(id);
                continue;
            }
            removed.insert(id.clone());
            writes.push(BufferedWrite::Delete {
                table: table_manifest.name.clone(),
                id,
            });
        }

        Ok(MembershipPlan {
            writes,
            read_dependencies: Vec::new(),
            result: Value::Null,
            skipped_protected,
        })
    }

    fn require_effective_principal<'a>(
        &self,
        writer: &'a MembershipWriter,
    ) -> SnapbackResult<&'a str> {
        if writer.is_privileged_noninvocation() {
            // Privileged non-invocation writers do not run the transition matrix;
            // callers that reach the matrix must not pass one.
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_PRIVILEGED_WRITER_MATRIX",
                "a seed/import/admin writer does not evaluate the transition matrix",
            ));
        }
        writer.effective_principal().ok_or_else(|| {
            membership_refusal(
                "SNAPBACK_MEMBERSHIP_NO_EFFECTIVE_PRINCIPAL",
                "an authority with no effective principal (system, adminBypass, anonymous) matches \
                 no transition class",
            )
        })
    }

    /// Self wins over a role; a role applies only when the caller is not the
    /// target; else `"none"`.
    fn derive_class_and_target(
        &self,
        table: &TableManifest,
        membership: &MembershipManifest,
        resource: Option<&str>,
        target_principal: &str,
        effective: &str,
    ) -> SnapbackResult<(MembershipCallerClass, MembershipTarget)> {
        if effective == target_principal {
            return Ok((MembershipCallerClass::Own, MembershipTarget::Own));
        }
        let caller_role = read_caller_role(&self.conn, table, membership, resource, effective)?;
        let class = match caller_role {
            Some(role) => MembershipCallerClass::Role(role),
            None => MembershipCallerClass::None,
        };
        Ok((class, MembershipTarget::Other))
    }

    /// A departure (remove, or a demotion whose `to` leaves the protected role)
    /// of a protected-role holder must leave an eligible holder; capture the
    /// survivor row so concurrent finals linearize to one commit.
    fn guard_protected_departure(
        &self,
        table: &TableManifest,
        membership: &MembershipManifest,
        row: &MembershipTargetRow,
        departing: bool,
        read_dependencies: &mut Vec<CapturedReadDependency>,
    ) -> SnapbackResult<()> {
        let Some(last_holder) = &membership.last_holder else {
            return Ok(());
        };
        if !departing || row.role != last_holder.protect {
            return Ok(());
        }
        let Some(resource) = &row.resource else {
            return Ok(());
        };
        let survivors = crate::storage::auth_agents::eligible_protected_holder_rows(
            &self.conn,
            &table.name,
            &membership.principal,
            membership.resource.as_deref().unwrap_or_default(),
            &membership.role,
            resource,
            &last_holder.protect,
            &row.principal,
        )?;
        let Some((survivor_id, survivor_version, _)) = survivors.into_iter().next() else {
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND",
                format!(
                    "removing/demoting this holder would leave resource {resource:?} with no \
                     eligible holder of the protected role {:?}",
                    last_holder.protect
                ),
            )
            .with_detail("resource", resource.clone())
            .with_detail("role", last_holder.protect.clone()));
        };
        // Rely on THIS survivor remaining: a concurrent removal of it fails
        // commit-time read-set validation, so exactly one final removal commits.
        read_dependencies.push(CapturedReadDependency {
            kind: CapturedReadKind::Row,
            table: Some(table.name.clone()),
            id: Some(survivor_id),
            version: Some(survivor_version),
            predicate: None,
            rows: Vec::new(),
            field: None,
            value: None,
            order: None,
            limit: None,
            result_count: None,
            boundary: None,
        });
        Ok(())
    }

    /// Seating or promoting a principal into a protected role requires that
    /// principal to be eligible (not permanently deactivated): the eligible
    /// holder set cannot be kept full with corpses.
    fn require_eligible_if_protected(
        &self,
        membership: &MembershipManifest,
        role: &str,
        principal: &str,
    ) -> SnapbackResult<()> {
        let Some(last_holder) = &membership.last_holder else {
            return Ok(());
        };
        if role != last_holder.protect {
            return Ok(());
        }
        if !crate::storage::auth_agents::principal_is_eligible_on(&self.conn, principal)? {
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_INELIGIBLE_HOLDER",
                format!(
                    "principal {principal:?} is permanently deactivated and cannot hold the \
                     protected role {:?}",
                    last_holder.protect
                ),
            )
            .with_detail("principal", principal.to_owned())
            .with_detail("role", last_holder.protect.clone()));
        }
        Ok(())
    }
}

fn protected_role(membership: &MembershipManifest) -> &str {
    membership
        .last_holder
        .as_ref()
        .map(|last| last.protect.as_str())
        .unwrap_or("")
}

fn extract_axis(values: &Map<String, Value>, field: &str, axis: &str) -> SnapbackResult<String> {
    match values.get(field) {
        Some(Value::String(value)) if !value.is_empty() => Ok(value.clone()),
        _ => Err(membership_refusal(
            "SNAPBACK_MEMBERSHIP_NULL_AXIS",
            format!("membership insert is missing a non-null {axis} axis ({field})"),
        )),
    }
}

fn require_in_vocabulary(membership: &MembershipManifest, role: &str) -> SnapbackResult<()> {
    if membership.vocabulary().any(|declared| declared == role) {
        return Ok(());
    }
    Err(membership_refusal(
        "SNAPBACK_MEMBERSHIP_UNKNOWN_ROLE",
        format!("role {role:?} is outside the closed vocabulary (comparison is exact-decoded)"),
    )
    .with_detail("role", role.to_owned()))
}

/// Field-bound insert: the values may carry the axes and only the columns the
/// matched transition names in `fields`. An open-join insert seating its own
/// far-future `expiresAt` is refused because that column is not in the
/// transition's `fields`.
fn enforce_insert_fields(
    membership: &MembershipManifest,
    transition: &crate::manifest::MembershipTransition,
    values: &Map<String, Value>,
) -> SnapbackResult<()> {
    for key in values.keys() {
        if key == &membership.principal
            || key == &membership.role
            || membership.resource.as_deref() == Some(key.as_str())
        {
            continue;
        }
        if !transition.fields.iter().flatten().any(|field| field == key) {
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_INSERT_FIELD_DENIED",
                format!(
                    "insert may not seat column {key:?}: it is not named in the matched \
                     transition's fields"
                ),
            )
            .with_detail("field", key.clone()));
        }
    }
    Ok(())
}

fn transition_denied(op: MembershipOp, class: &str, target: MembershipTarget) -> SnapbackError {
    membership_refusal(
        "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED",
        format!(
            "no declared transition authorizes op {:?} by caller class {class:?} on target {}",
            op.as_str(),
            match target {
                MembershipTarget::Own => "self",
                MembershipTarget::Other => "other",
            }
        ),
    )
    .with_detail("op", op.as_str())
    .with_detail("callerClass", class.to_owned())
}

fn target_row_missing(member_id: &str) -> SnapbackError {
    membership_refusal(
        "SNAPBACK_MEMBERSHIP_TARGET_MISSING",
        format!("no membership row {member_id:?} exists"),
    )
}

fn target_row_dependency(table: &str, row: &MembershipTargetRow) -> CapturedReadDependency {
    CapturedReadDependency {
        kind: CapturedReadKind::Row,
        table: Some(table.to_owned()),
        id: Some(row.id.clone()),
        version: Some(row.version),
        predicate: None,
        rows: Vec::new(),
        field: None,
        value: None,
        order: None,
        limit: None,
        result_count: None,
        boundary: None,
    }
}

fn resource_row_dependency(table: &str, id: &str, version: u64) -> CapturedReadDependency {
    CapturedReadDependency {
        kind: CapturedReadKind::Row,
        table: Some(table.to_owned()),
        id: Some(id.to_owned()),
        version: Some(version),
        predicate: None,
        rows: Vec::new(),
        field: None,
        value: None,
        order: None,
        limit: None,
        result_count: None,
        boundary: None,
    }
}

/// The writer-class gate applied at the buffered-Ibex commit seam. `Deny` is
/// every ordinary writer; `Sanctioned` is the host-evaluated membership engine,
/// which has already authorized its writes.
#[derive(Clone, Copy, PartialEq, Eq)]
enum MembershipWriteGate {
    Deny,
    Sanctioned,
}

#[derive(Clone, Copy)]
enum MembershipGuardOp {
    Insert,
    Patch,
    Delete,
}

/// Recheck invariants whose captured pre-state can be changed by an earlier raw
/// write in this same transaction. Captured dependencies close concurrent
/// races, but validation happens before buffered writes are applied; without
/// this application-point check, a mixed mutation could delete a resource and
/// then spend a previously authorized membership-insert plan against it.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — every
///   writer preserves referential integrity at the central commit seam.
fn revalidate_sanctioned_membership_write(
    schema: &SchemaManifest,
    tx: &Transaction<'_>,
    write: &BufferedWrite,
) -> SnapbackResult<()> {
    let BufferedWrite::Insert { table, values, .. } = write else {
        return Ok(());
    };
    let Some(table_manifest) = schema.table(table) else {
        return Ok(());
    };
    let Some(membership) = &table_manifest.membership else {
        return Ok(());
    };
    let (Some(resource_field), Some(resource_table)) =
        (&membership.resource, &membership.resource_table)
    else {
        return Ok(());
    };
    let resource = extract_axis(values, resource_field, "resource")?;
    if read_resource_version(tx, resource_table, &resource)?.is_none() {
        return Err(membership_refusal(
            "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING",
            format!(
                "membership insert names resource {resource:?}, which no longer exists in \
                 {resource_table}"
            ),
        ));
    }
    Ok(())
}

impl MembershipGuardOp {
    fn as_str(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::Patch => "patch",
            Self::Delete => "delete",
        }
    }
}

/// The buffered-write half of the writer-class seam. Under `Deny`: a raw write to
/// a declared membership table is refused; creating a resource of a
/// `lastHolder`-protected declaration without the bootstrap path is refused; and
/// deleting a resource row that still has memberships is refused (teardown is the
/// only path). `Sanctioned` writes are let through — the engine vouches for them.
fn enforce_membership_write_gate(
    schema: &SchemaManifest,
    tx: &Transaction<'_>,
    table: &str,
    op: MembershipGuardOp,
    row_id: Option<&str>,
    gate: MembershipWriteGate,
) -> SnapbackResult<()> {
    if gate == MembershipWriteGate::Sanctioned {
        return Ok(());
    }
    if schema.table(table).is_some_and(|t| t.membership.is_some()) {
        return Err(membership_raw_write_denied(table, op));
    }
    match op {
        MembershipGuardOp::Insert => enforce_protected_resource_insert_guard(schema, table)?,
        MembershipGuardOp::Delete => enforce_resource_delete_guard(schema, tx, table, row_id)?,
        MembershipGuardOp::Patch => {}
    }
    Ok(())
}

/// Creating a resource row of a `lastHolder`-protected declaration is refused
/// unless it goes through the bootstrap path (which seats the bootstrap holder
/// in the same transaction). Otherwise the establishment leg would be vacuous —
/// a protected resource could exist with no holder at all.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
///   establishment: creating a protected resource is refused unless the same
///   transaction spends its bootstrap-holder witness.
fn enforce_protected_resource_insert_guard(
    schema: &SchemaManifest,
    resource_table: &str,
) -> SnapbackResult<()> {
    for table in &schema.tables {
        let Some(membership) = &table.membership else {
            continue;
        };
        if membership.last_holder.is_none() {
            continue;
        }
        if membership.resource_table.as_deref() != Some(resource_table) {
            continue;
        }
        return Err(membership_refusal(
            "SNAPBACK_MEMBERSHIP_BOOTSTRAP_REQUIRED",
            format!(
                "creating a resource of the lastHolder-protected declaration {} requires seating \
                 its bootstrap holder in the same transaction (use the bootstrap path)",
                membership.effective_id(&table.name)
            ),
        )
        .with_detail("resourceTable", resource_table.to_owned())
        .with_detail("membershipTable", table.name.clone()));
    }
    Ok(())
}

/// Deleting a resource row does not silently orphan its memberships: refuse while
/// any membership references it. The teardown deletion witness
/// (`clearForResource`) is the only path that clears a roster, and it runs
/// `Sanctioned`, so this guard never fires on the legitimate teardown.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the host
///   refuses the resource delete while memberships remain, typed.
fn enforce_resource_delete_guard(
    schema: &SchemaManifest,
    tx: &Transaction<'_>,
    resource_table: &str,
    row_id: Option<&str>,
) -> SnapbackResult<()> {
    let Some(row_id) = row_id else {
        return Ok(());
    };
    for table in &schema.tables {
        let Some(membership) = &table.membership else {
            continue;
        };
        if membership.scope != MembershipScope::Resource {
            continue;
        }
        if membership.resource_table.as_deref() != Some(resource_table) {
            continue;
        }
        let Some(resource_column) = membership.resource.as_deref() else {
            continue;
        };
        if !sqlite_object_exists(tx, "table", &table.name)? {
            continue;
        }
        let count: i64 = tx.query_row(
            &format!(
                "SELECT COUNT(*) FROM {} WHERE {} = ?1",
                quote_ident(&table.name)?,
                quote_ident(resource_column)?
            ),
            params![row_id],
            |row| row.get(0),
        )?;
        if count > 0 {
            return Err(membership_refusal(
                "SNAPBACK_MEMBERSHIP_RESOURCE_DELETE_BLOCKED",
                format!(
                    "resource {row_id:?} still has {count} membership(s) in {}; clear the roster \
                     through teardown (clearForResource) in the same transaction",
                    table.name
                ),
            )
            .with_detail("resource", row_id.to_owned())
            .with_detail("membershipTable", table.name.clone()));
        }
    }
    Ok(())
}

fn membership_raw_write_denied(table: &str, op: MembershipGuardOp) -> SnapbackError {
    membership_refusal(
        "SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED",
        format!(
            "raw {} on declared membership table {table} is refused; membership rows are written \
             only through the host-evaluated generated methods",
            op.as_str()
        ),
    )
    .with_detail("table", table.to_owned())
    .with_detail("op", op.as_str().to_owned())
}

fn membership_hostplan_write_denied(table: &str) -> SnapbackError {
    membership_refusal(
        "SNAPBACK_MEMBERSHIP_HOSTPLAN_WRITE_DENIED",
        format!(
            "HostPlan cannot authorize a membership write in v1; every generic form targeting the \
             declared membership table {table} is refused"
        ),
    )
    .with_detail("table", table.to_owned())
}

fn membership_write_provenance(
    writer: Option<&MembershipWriter>,
) -> SnapbackResult<MembershipWriteProvenance> {
    writer.and_then(MembershipWriter::provenance).ok_or_else(|| {
        membership_refusal(
            "SNAPBACK_MEMBERSHIP_PROVENANCE_UNAVAILABLE",
            "a provenance-enabled membership write lacks a resolved writer attribution",
        )
    })
}

fn write_membership_creation_provenance(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
    writer: Option<&MembershipWriter>,
) -> SnapbackResult<()> {
    let Some(membership) = &table.membership else {
        return Ok(());
    };
    if membership.provenance.is_none() {
        return Ok(());
    }
    let provenance = membership_write_provenance(writer)?;
    tx.execute(
        &format!(
            "UPDATE {} SET {} = ?1, {} = ?2, {} = ?3 WHERE _id = ?4",
            quote_ident(&table.name)?,
            quote_ident(MEMBERSHIP_GRANTED_BY_ACTOR)?,
            quote_ident(MEMBERSHIP_GRANTED_BY_EFFECTIVE)?,
            quote_ident(MEMBERSHIP_GRANTED_BY_GRANT)?,
        ),
        params![
            provenance.actor,
            provenance.effective,
            provenance.grant,
            id
        ],
    )?;
    Ok(())
}

fn membership_axis_value(
    row: Option<&Value>,
    field: &str,
    label: &str,
) -> SnapbackResult<Option<String>> {
    let Some(row) = row.and_then(Value::as_object) else {
        return Ok(None);
    };
    row.get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .map(Some)
        .ok_or_else(|| {
            membership_refusal(
                "SNAPBACK_MEMBERSHIP_PROVENANCE_ROW_INVALID",
                format!("membership {label} field {field:?} is absent or not a string"),
            )
        })
}

#[allow(clippy::too_many_arguments)]
fn record_membership_transition(
    tx: &Transaction<'_>,
    table: &TableManifest,
    op: ChangeOp,
    before: Option<&Value>,
    after: Option<&Value>,
    changed_fields: &[String],
    commit_version: u64,
    writer: Option<&MembershipWriter>,
) -> SnapbackResult<()> {
    let Some(membership) = &table.membership else {
        return Ok(());
    };
    if membership.provenance != Some(MembershipProvenance::Full) {
        return Ok(());
    }
    if op == ChangeOp::Update
        && changed_fields
            .iter()
            .all(|field| !table.field_affects_authorization(field))
    {
        return Ok(());
    }
    let provenance = membership_write_provenance(writer)?;
    let current = after.or(before);
    let principal = membership_axis_value(current, &membership.principal, "principal")?
        .expect("membership transition has a row image");
    let resource = membership
        .resource
        .as_deref()
        .map(|field| membership_axis_value(current, field, "resource"))
        .transpose()?
        .flatten();
    let from_role = membership_axis_value(before, &membership.role, "role")?;
    let to_role = membership_axis_value(after, &membership.role, "role")?;
    let op = match op {
        ChangeOp::Insert => "insert",
        ChangeOp::Delete => "remove",
        ChangeOp::Update if changed_fields.contains(&membership.role) => "setRole",
        ChangeOp::Update => "patch",
    };
    tx.execute(
        "INSERT INTO _snapback_membership_transitions(
           declaration_id, op, principal, resource, from_role, to_role,
           actor, effective, grant_id, commit_version, writer_class
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            membership.effective_id(&table.name),
            op,
            principal,
            resource,
            from_role,
            to_role,
            provenance.actor,
            provenance.effective,
            provenance.grant,
            commit_version,
            provenance.writer_class,
        ],
    )?;
    Ok(())
}

fn insert_document(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
    row: &Map<String, Value>,
    version: u64,
    now_ms: u64,
) -> SnapbackResult<Value> {
    for key in row.keys() {
        if is_system_field(key) {
            return Err(SnapbackError::error(
                "SNAPBACK_SYSTEM_FIELD_WRITE",
                "storage",
                format!("{key} is managed by Snapback"),
            ));
        }
        ensure_field(table, key)?;
    }

    let mut document = Map::new();
    document.insert("_id".to_owned(), Value::String(id.to_owned()));
    document.insert("_version".to_owned(), json!(version));
    document.insert("_createdAt".to_owned(), json!(now_ms));
    document.insert("_updatedAt".to_owned(), json!(now_ms));

    let mut columns = vec![
        "_id".to_owned(),
        "_version".to_owned(),
        "_createdAt".to_owned(),
        "_updatedAt".to_owned(),
    ];
    let mut values = vec![
        SqlValue::Text(id.to_owned()),
        SqlValue::Integer(version as i64),
        SqlValue::Integer(timestamp_to_sql_millis(now_ms)?),
        SqlValue::Integer(timestamp_to_sql_millis(now_ms)?),
    ];

    for field in &table.fields {
        let value = match row.get(&field.name) {
            Some(value) => {
                validate_declared_field_value(field, value)?;
                value.clone()
            }
            None if field.optional => Value::Null,
            None => {
                return Err(SnapbackError::error(
                    "SNAPBACK_FIELD_MISSING",
                    "storage",
                    format!("required field {}.{} is missing", table.name, field.name),
                ));
            }
        };
        values.push(json_to_sql_value(&value, Some(&field.field_type))?);
        columns.push(field.name.clone());
        document.insert(
            field.name.clone(),
            normalize_json_value(value, &field.field_type)?,
        );
    }

    let placeholders = (0..columns.len())
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");
    let quoted_columns = columns
        .iter()
        .map(|column| quote_ident(column))
        .collect::<SnapbackResult<Vec<_>>>()?
        .join(", ");
    let mut statement = tx.prepare_cached(&format!(
        "INSERT INTO {} ({quoted_columns}) VALUES ({placeholders})",
        quote_ident(&table.name)?
    ))?;
    statement
        .execute(params_from_iter(values.iter()))
        .map_err(map_unique_constraint_error)?;

    Ok(Value::Object(document))
}

/// Reclassify a SQLite UNIQUE-constraint failure into a stable, typed
/// conflict. This is error *typing*, not write authorization: it does not
/// change who may write, only how the exactly-one-wins outcome of a true-unique
/// index surfaces. LLP 0056's generated `(principal, resource)` index is the
/// only user-facing unique index today, so a second insert of an existing pair
/// yields exactly one row and this one typed conflict.
///
/// @ref LLP 0056#declaring-a-membership-table — exactly-one-wins on concurrent
///   same-pair inserts is delivered by the unique index at serialized commit.
fn map_unique_constraint_error(error: rusqlite::Error) -> SnapbackError {
    if let rusqlite::Error::SqliteFailure(failure, message) = &error
        && failure.code == rusqlite::ErrorCode::ConstraintViolation
    {
        let text = message.clone().unwrap_or_default();
        if text.contains("UNIQUE") {
            return SnapbackError::error(
                "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION",
                "storage",
                "write violates a unique index (one row per declared key)",
            )
            .with_detail("error", text);
        }
    }
    SnapbackError::from(error)
}

fn patch_document(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
    row: &Map<String, Value>,
    version: u64,
    now_ms: u64,
) -> SnapbackResult<bool> {
    let mut assignments = vec!["_version = ?".to_owned(), "_updatedAt = ?".to_owned()];
    let mut values = vec![
        SqlValue::Integer(version as i64),
        SqlValue::Integer(timestamp_to_sql_millis(now_ms)?),
    ];

    for (field, value) in row {
        if is_system_field(field) {
            return Err(SnapbackError::error(
                "SNAPBACK_SYSTEM_FIELD_WRITE",
                "storage",
                format!("{field} is managed by Snapback"),
            ));
        }
        let field_manifest = ensure_field(table, field)?;
        validate_declared_field_value(field_manifest, value)?;
        assignments.push(format!("{} = ?", quote_ident(field)?));
        values.push(json_to_sql_value(value, Some(&field_manifest.field_type))?);
    }
    // Validate the complete patch before consulting row existence. The
    // portable contract rejects malformed writes independent of current
    // state; a missing id must not turn protected/unknown/wrong-type values
    // into an accepted no-op while the hosted target rejects them.
    if get_row_version(tx, table, id)?.is_none() {
        return Ok(false);
    }
    values.push(SqlValue::Text(id.to_owned()));

    let mut statement = tx.prepare_cached(&format!(
        "UPDATE {} SET {} WHERE _id = ?",
        quote_ident(&table.name)?,
        assignments.join(", ")
    ))?;
    statement
        .execute(params_from_iter(values.iter()))
        .map_err(map_unique_constraint_error)?;
    Ok(true)
}

fn delete_document(tx: &Transaction<'_>, table: &TableManifest, id: &str) -> SnapbackResult<bool> {
    let mut statement = tx.prepare_cached(&format!(
        "DELETE FROM {} WHERE _id = ?1",
        quote_ident(&table.name)?
    ))?;
    let changed = statement.execute(params![id])?;
    Ok(changed > 0)
}

fn get_document_from_tx(
    tx: &Transaction<'_>,
    table: &TableManifest,
    id: &str,
) -> SnapbackResult<Option<Value>> {
    let sql = format!("SELECT * FROM {} WHERE _id = ?1", quote_ident(&table.name)?);
    let mut statement = tx.prepare_cached(&sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row_to_document(row, table, &columns)?))
    } else {
        Ok(None)
    }
}

fn record_change(
    tx: &Transaction<'_>,
    version: u64,
    table: &str,
    id: &str,
    op: ChangeOp,
    row: Option<&Value>,
    now_ms: u64,
) -> SnapbackResult<()> {
    let mut statement = tx.prepare_cached(
        "INSERT INTO _snapback_changes(version, table_name, row_id, op, row_json, changed_at_ms)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    statement.execute(params![
        version as i64,
        table,
        id,
        match op {
            ChangeOp::Insert => "insert",
            ChangeOp::Update => "update",
            ChangeOp::Delete => "delete",
        },
        row.map(Value::to_string),
        timestamp_to_sql_millis(now_ms)?
    ])?;
    Ok(())
}

fn set_version(tx: &Transaction<'_>, version: u64) -> SnapbackResult<()> {
    tx.execute(
        "UPDATE _snapback_version SET version = ?1 WHERE id = 1",
        params![version as i64],
    )?;
    Ok(())
}

fn row_to_document(
    row: &rusqlite::Row<'_>,
    table: &TableManifest,
    columns: &[String],
) -> SnapbackResult<Value> {
    let mut document = Map::new();
    for (index, column) in columns.iter().enumerate() {
        let field_type = field_type(table, column);
        document.insert(
            column.clone(),
            sqlite_to_json(row.get_ref(index)?, field_type)?,
        );
    }
    Ok(Value::Object(document))
}

fn sqlite_to_json(value: ValueRef<'_>, field_type: Option<&FieldType>) -> SnapbackResult<Value> {
    match value {
        ValueRef::Null => Ok(Value::Null),
        ValueRef::Integer(value) => {
            if matches!(field_type, Some(FieldType::Boolean)) {
                Ok(Value::Bool(value != 0))
            } else {
                Ok(Value::Number(Number::from(value)))
            }
        }
        ValueRef::Real(value) => Number::from_f64(value).map(Value::Number).ok_or_else(|| {
            SnapbackError::error("SNAPBACK_INVALID_FLOAT", "storage", "SQLite returned NaN")
        }),
        ValueRef::Text(value) => {
            let text = String::from_utf8_lossy(value).into_owned();
            if matches!(field_type, Some(FieldType::Json)) {
                serde_json::from_str(&text).map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_JSON_PARSE_FAILED",
                        "storage",
                        "stored JSON field could not be parsed",
                    )
                    .with_detail("error", error.to_string())
                })
            } else {
                Ok(Value::String(text))
            }
        }
        ValueRef::Blob(_) => Err(SnapbackError::error(
            "SNAPBACK_UNSUPPORTED_BLOB",
            "storage",
            "blob values are not supported in the v0 local store",
        )),
    }
}

// Plain JSON/JavaScript is the v0 portable wire, so declared Integer fields
// use the one range every target represents without aliases. Exact i64 needs
// a future tagged/string encoding rather than target-dependent acceptance.
// @ref LLP 0007#data-model — portable v0 integers are JavaScript-safe signed integers.
const PORTABLE_INTEGER_MAX: i64 = 9_007_199_254_740_991;
const PORTABLE_INTEGER_MIN: i64 = -PORTABLE_INTEGER_MAX;

fn portable_integer_value(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .filter(|value| (PORTABLE_INTEGER_MIN..=PORTABLE_INTEGER_MAX).contains(value))
        .or_else(|| {
            value.as_u64().and_then(|value| {
                if value <= PORTABLE_INTEGER_MAX as u64 {
                    Some(value as i64)
                } else {
                    None
                }
            })
        })
        .or_else(|| {
            value.as_f64().and_then(|value| {
                if value.is_finite()
                    && value.fract() == 0.0
                    && value >= PORTABLE_INTEGER_MIN as f64
                    && value <= PORTABLE_INTEGER_MAX as f64
                {
                    Some(value as i64)
                } else {
                    None
                }
            })
        })
}

fn json_to_sql_value(value: &Value, field_type: Option<&FieldType>) -> SnapbackResult<SqlValue> {
    if value.is_null() {
        return Ok(SqlValue::Null);
    }

    match field_type {
        None if value.is_string() => value
            .as_str()
            .map(|value| SqlValue::Text(value.to_owned()))
            .ok_or_else(|| type_error("string", value)),
        None if value.is_boolean() => value
            .as_bool()
            .map(|value| SqlValue::Integer(i64::from(value)))
            .ok_or_else(|| type_error("boolean", value)),
        None if value.as_i64().is_some() || value.as_u64().is_some() => value
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| {
                value.as_u64().and_then(|value| {
                    if value <= i64::MAX as u64 {
                        Some(SqlValue::Integer(value as i64))
                    } else {
                        None
                    }
                })
            })
            .ok_or_else(|| type_error("integer", value)),
        None if value.is_number() => value
            .as_f64()
            .map(SqlValue::Real)
            .ok_or_else(|| type_error("real", value)),
        None => Err(type_error("portable scalar", value)),
        // A principal is nominal typing over the string space: it stores and
        // coerces exactly like a String (LLP 0056 §Declaring a membership table).
        Some(FieldType::String) | Some(FieldType::Principal) => value
            .as_str()
            .map(|value| SqlValue::Text(value.to_owned()))
            .ok_or_else(|| type_error("string", value)),
        Some(FieldType::Boolean) => value
            .as_bool()
            .map(|value| SqlValue::Integer(i64::from(value)))
            .ok_or_else(|| type_error("boolean", value)),
        Some(FieldType::Integer) => portable_integer_value(value)
            .map(SqlValue::Integer)
            .ok_or_else(|| type_error("integer", value)),
        Some(FieldType::Real) => value
            .as_f64()
            .map(SqlValue::Real)
            .ok_or_else(|| type_error("real", value)),
        Some(FieldType::Json) => {
            serde_json::to_string(value)
                .map(SqlValue::Text)
                .map_err(|error| {
                    SnapbackError::error(
                        "SNAPBACK_JSON_SERIALIZE_FAILED",
                        "storage",
                        "JSON field could not be serialized",
                    )
                    .with_detail("error", error.to_string())
                })
        }
    }
}

fn normalize_json_value(value: Value, field_type: &FieldType) -> SnapbackResult<Value> {
    match field_type {
        FieldType::Json => Ok(value),
        _ => {
            json_to_sql_value(&value, Some(field_type))?;
            Ok(value)
        }
    }
}

fn validate_declared_field_value(field: &FieldManifest, value: &Value) -> SnapbackResult<()> {
    if value.is_null() && !field.optional {
        return Err(type_error(field_type_name(&field.field_type), value));
    }
    Ok(())
}

fn type_error(expected: &str, value: &Value) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_FIELD_TYPE_MISMATCH",
        "storage",
        format!("expected {expected} value"),
    )
    .with_detail("value", value.clone())
}

fn schema_table<'a>(schema: &'a SchemaManifest, table: &str) -> SnapbackResult<&'a TableManifest> {
    validate_user_identifier("table", table)?;
    schema.table(table).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_UNKNOWN_TABLE",
            "schema",
            format!("unknown table {table}"),
        )
    })
}

fn ensure_field<'a>(table: &'a TableManifest, field: &str) -> SnapbackResult<&'a FieldManifest> {
    validate_user_identifier("field", field)?;
    table.field(field).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_UNKNOWN_FIELD",
            "schema",
            format!("unknown field {}.{field}", table.name),
        )
    })
}

fn ensure_field_or_system(table: &TableManifest, field: &str) -> SnapbackResult<()> {
    if is_system_field(field) {
        return Ok(());
    }
    ensure_field(table, field).map(|_| ())
}

fn ensure_orderable_field(table: &TableManifest, field: &str) -> SnapbackResult<()> {
    ensure_field_or_system(table, field)?;
    if matches!(field_type(table, field), Some(FieldType::Json)) {
        return Err(SnapbackError::error(
            "SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE",
            "query",
            format!(
                "query order field {}.{field} has non-portable Json type",
                table.name
            ),
        )
        .with_detail("table", table.name.clone())
        .with_detail("field", field.to_owned())
        .with_detail("fieldType", "Json"));
    }
    Ok(())
}

fn field_type<'a>(table: &'a TableManifest, field: &str) -> Option<&'a FieldType> {
    table.field(field).map(|field| &field.field_type)
}

fn is_system_field(field: &str) -> bool {
    matches!(field, "_id" | "_version" | "_createdAt" | "_updatedAt")
}

fn sqlite_type(field_type: &FieldType) -> &'static str {
    match field_type {
        FieldType::String | FieldType::Json | FieldType::Principal => "TEXT",
        FieldType::Boolean | FieldType::Integer => "INTEGER",
        FieldType::Real => "REAL",
    }
}

fn validate_user_identifier(kind: &str, value: &str) -> SnapbackResult<()> {
    if !is_identifier(value) || value.starts_with("_snapback") || is_auth_reserved_identifier(value)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_INVALID_IDENTIFIER",
            "schema",
            format!("invalid {kind} identifier {value}"),
        ));
    }
    Ok(())
}

/// `_auth` is a complete namespace root, and SQLite folds ASCII identifier
/// case. Keep this predicate shared by manifest and runtime name resolvers so
/// no casing variant becomes an alternate path into the protected catalog.
///
/// @ref LLP 0057#reservation — absolute ASCII-case-insensitive reservation.
pub(crate) fn is_auth_reserved_identifier(value: &str) -> bool {
    let folded = value.to_ascii_lowercase();
    folded == "_auth" || folded.starts_with("_auth_")
}

fn quote_ident(value: &str) -> SnapbackResult<String> {
    if !is_identifier(value) {
        return Err(SnapbackError::error(
            "SNAPBACK_INVALID_IDENTIFIER",
            "storage",
            format!("invalid SQL identifier {value}"),
        ));
    }
    Ok(format!("\"{value}\""))
}

fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first == '_' || first.is_ascii_alphabetic()) {
        return false;
    }
    chars.all(|char| char == '_' || char.is_ascii_alphanumeric())
}

fn expect_string(value: Value, label: &str) -> SnapbackResult<String> {
    value.as_str().map(ToOwned::to_owned).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_EXPECTED_STRING",
            "runtime",
            format!("{label} must evaluate to a string"),
        )
    })
}

fn validate_plan_replay_ledger(input: &HandlerInput) -> SnapbackResult<Option<&CtxAnswerLedger>> {
    validate_ctx_answer_ledger(input)
}

struct PlanIdSource<'a> {
    replay: Option<&'a CtxAnswerLedger>,
    cursor: usize,
    generated: Vec<String>,
}

impl<'a> PlanIdSource<'a> {
    fn new(replay: Option<&'a CtxAnswerLedger>) -> Self {
        Self {
            replay,
            cursor: 0,
            generated: Vec::new(),
        }
    }

    fn next(&mut self) -> SnapbackResult<String> {
        if self.generated.len() >= CTX_ANSWER_LEDGER_MAX_IDS {
            return Err(SnapbackError::error(
                "SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED",
                "runtime",
                format!(
                    "mutation requested more than {} host-generated ids",
                    CTX_ANSWER_LEDGER_MAX_IDS
                ),
            ));
        }
        let id = match self.replay {
            Some(ledger) => ledger.ids.get(self.cursor).cloned().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_CTX_LEDGER_EXHAUSTED",
                    "runtime",
                    format!(
                        "replay consumed all {} ledgered ids and the mutation asked for another",
                        ledger.ids.len()
                    ),
                )
            })?,
            None => new_id(),
        };
        self.cursor += 1;
        self.generated.push(id.clone());
        Ok(id)
    }

    fn ensure_exact_consumption(&self) -> SnapbackResult<()> {
        if let Some(ledger) = self.replay
            && self.cursor != ledger.ids.len()
        {
            return Err(SnapbackError::error(
                "SNAPBACK_CTX_LEDGER_UNUSED_IDS",
                "runtime",
                format!(
                    "replay consumed {} of {} ledgered ids; the mutation diverged from its recording",
                    self.cursor,
                    ledger.ids.len()
                ),
            ));
        }
        Ok(())
    }
}

fn validate_client_mutation_identity(identity: &ClientMutationIdentity) -> SnapbackResult<()> {
    if !replay_opaque_id_is_valid(&identity.id) {
        return Err(SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_ID_INVALID",
            "sync",
            "client mutation id must match the declared opaque replay-id bounds/alphabet",
        ));
    }
    let parsed_authority = Uuid::parse_str(&identity.authority_instance_id).ok();
    if parsed_authority.as_ref().map(Uuid::get_version_num) != Some(7)
        || parsed_authority
            .as_ref()
            .is_some_and(|parsed| parsed.to_string() != identity.authority_instance_id)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_RETENTION_STATE_INVALID",
            "sync",
            "retained client mutation authority instance must be a canonical UUIDv7",
        ));
    }
    Ok(())
}

fn mutation_input_fingerprint(input: &HandlerInput) -> String {
    // Correlation is receipt-routing metadata and may legitimately change on
    // app reload. Args, optimistic baseline, and replay ledger identify the
    // logical mutation and must be byte-equivalent after canonical key sort.
    let value = canonical_json(json!({
        "args": input.args,
        "readSet": input.read_set,
        "ctxLedger": input.ctx_ledger,
    }));
    let encoded = serde_json::to_vec(&value).expect("mutation identity JSON serializes");
    let mut digest = Sha256::new();
    digest.update(encoded);
    format!("sha256:{:x}", digest.finalize())
}

fn canonical_json(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, canonical_json(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(canonical_json).collect()),
        other => other,
    }
}

/// The logical retained-byte definition is stable and deliberately excludes
/// SQLite row/index overhead. It is the sum of the six replay-identity/result
/// payloads whose contents the server must keep for exactly-once replay.
fn scan_client_mutation_retention_totals(conn: &Connection) -> SnapbackResult<(u64, u64)> {
    let (records, bytes): (u64, u64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(
           length(CAST(client_mutation_id AS BLOB)) +
           length(CAST(function AS BLOB)) +
           length(CAST(auth_fingerprint AS BLOB)) +
           COALESCE(length(CAST(authority_instance_id AS BLOB)), 0) +
           length(CAST(input_fingerprint AS BLOB)) +
           length(CAST(output_json AS BLOB))
         ), 0) FROM _snapback_client_mutations",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok((records, bytes))
}

fn invalid_client_mutation_retention_state(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_CLIENT_MUTATION_RETENTION_STATE_INVALID",
        "storage",
        message,
    )
}

fn meta_text(conn: &Connection, key: &str) -> SnapbackResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()?)
}

/// Startup migration helper: a missing or malformed pre-counter value asks
/// the caller to rebuild from the ledger once. Runtime accounting uses the
/// strict helper below and never treats an invalid counter as zero.
fn optional_meta_u64_lenient(conn: &Connection, key: &str) -> SnapbackResult<Option<u64>> {
    Ok(meta_text(conn, key)?.and_then(|value| value.parse().ok()))
}

fn optional_meta_u64(conn: &Connection, key: &str) -> SnapbackResult<Option<u64>> {
    meta_text(conn, key)?
        .map(|value| {
            value.parse::<u64>().map_err(|_| {
                invalid_client_mutation_retention_state(format!(
                    "retention metadata {key} is not an unsigned integer"
                ))
            })
        })
        .transpose()
}

fn client_mutation_retention_counters(conn: &Connection) -> SnapbackResult<(u64, u64)> {
    let records = optional_meta_u64(conn, META_CLIENT_MUTATION_RECORDS)?.ok_or_else(|| {
        invalid_client_mutation_retention_state("retained record counter is missing")
    })?;
    let bytes = optional_meta_u64(conn, META_CLIENT_MUTATION_BYTES)?.ok_or_else(|| {
        invalid_client_mutation_retention_state("retained byte counter is missing")
    })?;
    Ok((records, bytes))
}

fn client_mutation_auth_retention_counters(
    conn: &Connection,
    auth_fingerprint: &str,
) -> SnapbackResult<(u64, u64)> {
    Ok(conn
        .query_row(
            "SELECT records, bytes
             FROM _snapback_client_mutation_auth_retention
             WHERE auth_fingerprint = ?1",
            params![auth_fingerprint],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .unwrap_or((0, 0)))
}

fn save_client_mutation_auth_retention_counters(
    conn: &Connection,
    auth_fingerprint: &str,
    records: u64,
    bytes: u64,
) -> SnapbackResult<()> {
    if records == 0 {
        if bytes != 0 {
            return Err(invalid_client_mutation_retention_state(
                "zero retained auth records had a nonzero byte counter",
            ));
        }
        conn.execute(
            "DELETE FROM _snapback_client_mutation_auth_retention
             WHERE auth_fingerprint = ?1",
            params![auth_fingerprint],
        )?;
    } else {
        conn.execute(
            "INSERT INTO _snapback_client_mutation_auth_retention(
               auth_fingerprint, records, bytes
             ) VALUES(?1, ?2, ?3)
             ON CONFLICT(auth_fingerprint) DO UPDATE SET
               records = excluded.records,
               bytes = excluded.bytes",
            params![auth_fingerprint, records, bytes],
        )?;
    }
    Ok(())
}

fn save_meta_u64(conn: &Connection, key: &str, value: u64) -> SnapbackResult<()> {
    conn.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value.to_string()],
    )?;
    Ok(())
}

fn record_client_mutation_result(
    tx: &Transaction<'_>,
    identity: &ClientMutationIdentity,
    output: &MutationOutput,
) -> SnapbackResult<()> {
    validate_client_mutation_identity(identity)?;
    let output_json = serde_json::to_string(output).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_RESULT_INVALID",
            "storage",
            "client mutation result could not be encoded",
        )
        .with_details(json!({ "error": error.to_string() }))
    })?;
    let output_bytes = output_json.len() as u64;
    if output_bytes > CLIENT_MUTATION_MAX_RESULT_BYTES {
        return Err(SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE",
            "sync",
            format!(
                "serialized client mutation result is {output_bytes} bytes; the durable replay cap is {CLIENT_MUTATION_MAX_RESULT_BYTES}"
            ),
        )
        .with_details(json!({
            "bytes": output_bytes,
            "maxBytes": CLIENT_MUTATION_MAX_RESULT_BYTES,
        })));
    }
    let (retained, retained_bytes) = client_mutation_retention_counters(tx)?;
    let (auth_retained, auth_retained_bytes) =
        client_mutation_auth_retention_counters(tx, &identity.auth_fingerprint)?;
    let new_bytes = identity.id.len() as u64
        + identity.function.len() as u64
        + identity.auth_fingerprint.len() as u64
        + identity.authority_instance_id.len() as u64
        + identity.input_fingerprint.len() as u64
        + output_bytes;
    let limits = client_mutation_retention_limits();
    let admitted_bytes = retained_bytes.checked_add(new_bytes);
    let auth_admitted_bytes = auth_retained_bytes.checked_add(new_bytes);
    if retained >= limits.records
        || admitted_bytes.is_none_or(|bytes| bytes > limits.bytes)
        || auth_retained >= limits.records_per_auth
        || auth_admitted_bytes.is_none_or(|bytes| bytes > limits.bytes_per_auth)
    {
        let scope = if auth_retained >= limits.records_per_auth
            || auth_admitted_bytes.is_none_or(|bytes| bytes > limits.bytes_per_auth)
        {
            "auth"
        } else {
            "global"
        };
        return Err(SnapbackError::error(
            "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL",
            "sync",
            "durable client-mutation replay retention is full; acknowledge consumed results before submitting another durable id",
        )
        .with_details(json!({
            "records": retained,
            "maxRecords": limits.records,
            "bytes": retained_bytes,
            "incomingBytes": new_bytes,
            "maxBytes": limits.bytes,
            "authRecords": auth_retained,
            "maxAuthRecords": limits.records_per_auth,
            "authBytes": auth_retained_bytes,
            "maxAuthBytes": limits.bytes_per_auth,
            "scope": scope,
        })));
    }
    tx.execute(
        "INSERT INTO _snapback_client_mutations(
           client_mutation_id, function, auth_fingerprint, authority_instance_id,
           input_fingerprint, output_json, settled_at_ms, settled_version
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            identity.id,
            identity.function,
            identity.auth_fingerprint,
            identity.authority_instance_id,
            identity.input_fingerprint,
            output_json,
            timestamp_to_sql_millis(now_millis())?,
            version_to_sql_integer(output.version)?,
        ],
    )?;
    save_meta_u64(tx, META_CLIENT_MUTATION_RECORDS, retained + 1)?;
    save_meta_u64(
        tx,
        META_CLIENT_MUTATION_BYTES,
        admitted_bytes.expect("checked by retention admission"),
    )?;
    save_client_mutation_auth_retention_counters(
        tx,
        &identity.auth_fingerprint,
        auth_retained + 1,
        auth_admitted_bytes.expect("checked by per-auth retention admission"),
    )?;
    Ok(())
}

pub(crate) fn new_id() -> String {
    Uuid::now_v7().to_string()
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod guarded_commit_tests {
    use super::*;
    use std::cell::Cell;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    fn schema() -> SchemaManifest {
        SchemaManifest {
            tables: vec![TableManifest {
                name: "items".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "title".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                    FieldManifest {
                        name: "rank".to_owned(),
                        field_type: FieldType::Integer,
                        optional: true,
                    },
                    FieldManifest {
                        name: "metadata".to_owned(),
                        field_type: FieldType::Json,
                        optional: true,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: None,
            }],
            ..SchemaManifest::default()
        }
    }

    fn database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.apply_schema(schema()).expect("apply test schema");
        db
    }

    #[test]
    fn delegated_host_decisions_intersect_actor_aware_rules_with_direct_baseline() {
        let delegated = HandlerInput {
            auth: AuthInput {
                user_id: Some("effective-user".to_owned()),
                ..AuthInput::default()
            }
            .with_authorization_projection(Some("human"), Some("agent"), true),
            ..HandlerInput::default()
        };
        let direct = HandlerInput {
            auth: AuthInput {
                user_id: Some("effective-user".to_owned()),
                ..AuthInput::default()
            }
            .with_authorization_projection(Some("human"), None, false),
            ..HandlerInput::default()
        };
        let mut query_db = database();
        query_db
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![
                        Map::from_iter([("title".to_owned(), json!("delegated"))]),
                        Map::from_iter([("title".to_owned(), json!("direct"))]),
                    ],
                )]),
            })
            .expect("seed actor-aware query rows");

        let actor_aware_query = QueryPlan {
            table: "items".to_owned(),
            filters: vec![crate::manifest::FilterExpr {
                field: "title".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::If {
                    cond: Box::new(ValueExpr::AuthIsDelegated),
                    then: Box::new(ValueExpr::Literal(json!("delegated"))),
                    r#else: Box::new(ValueExpr::Literal(json!("direct"))),
                },
            }],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        };
        assert!(
            query_db
                .query(&actor_aware_query, &delegated)
                .expect("run intersected delegated query")
                .rows
                .is_empty(),
            "delegated and direct row constraints are intersected"
        );
        assert_eq!(
            query_db
                .query(&actor_aware_query, &direct)
                .expect("run direct query")
                .rows
                .len(),
            1
        );

        let disjunctive_query = QueryPlan {
            filters: vec![crate::manifest::FilterExpr {
                field: "title".to_owned(),
                op: FilterOp::In,
                value: ValueExpr::If {
                    cond: Box::new(ValueExpr::AuthIsDelegated),
                    then: Box::new(ValueExpr::Literal(json!(["direct", "delegated"]))),
                    r#else: Box::new(ValueExpr::Literal(json!(["direct"]))),
                },
            }],
            ..actor_aware_query.clone()
        };
        let intersected = query_db
            .query(&disjunctive_query, &delegated)
            .expect("intersect a disjunctive delegated row rule")
            .rows;
        assert_eq!(intersected.len(), 1, "the delegated disjunct cannot widen the row set");
        assert_eq!(intersected[0]["title"], "direct");
        assert_eq!(intersected.len(), 1, "aggregate count derives only from admitted rows");
        assert_eq!(
            intersected
                .iter()
                .map(|row| row["title"].clone())
                .collect::<Vec<_>>(),
            vec![json!("direct")],
            "a projection cannot recover the excluded row"
        );
        let opaque = json!({ "opaque": &intersected });
        assert_eq!(opaque["opaque"].as_array().map(Vec::len), Some(1));
        assert_eq!(
            opaque["opaque"][0]["title"], "direct",
            "opaque results are still derived from the intersected row set"
        );

        let actor_only_query = QueryPlan {
            filters: vec![crate::manifest::FilterExpr {
                field: "title".to_owned(),
                op: FilterOp::Eq,
                value: ValueExpr::AuthActorKind,
            }],
            ..actor_aware_query.clone()
        };
        assert!(
            query_db
                .query(&actor_only_query, &delegated)
                .expect("a missing direct actor fails closed instead of widening")
                .rows
                .is_empty()
        );

        let actor_only = ValueExpr::Binary {
            op: crate::manifest::BinaryOp::Eq,
            left: Box::new(ValueExpr::AuthActorKind),
            right: Box::new(ValueExpr::Literal(json!("agent"))),
        };
        let delegated_disjunction = ValueExpr::Binary {
            op: crate::manifest::BinaryOp::Or,
            left: Box::new(ValueExpr::Binary {
                op: crate::manifest::BinaryOp::Eq,
                left: Box::new(ValueExpr::AuthUserId),
                right: Box::new(ValueExpr::Literal(json!("somebody-else"))),
            }),
            right: Box::new(ValueExpr::AuthIsDelegated),
        };
        let negated_actor = ValueExpr::Unary {
            op: crate::manifest::UnaryOp::Not,
            expr: Box::new(ValueExpr::Binary {
                op: crate::manifest::BinaryOp::Eq,
                left: Box::new(ValueExpr::AuthActorKind),
                right: Box::new(ValueExpr::Literal(json!("agent"))),
            }),
        };
        for (name, cond) in [
            ("actor-only", actor_only),
            ("delegated-disjunction", delegated_disjunction),
            ("negated-actor", negated_actor),
        ] {
            let mut db = database();
            let plan = MutationPlan {
                steps: vec![MutationStep::Guard {
                    cond,
                    else_error: "TEST_AUTH_RULE_DENIED".to_owned(),
                }],
                return_value: Some(ReturnValue::ChangedCount),
            };
            let error = db
                .execute_mutation(&plan, &delegated)
                .expect_err("the direct baseline must veto delegated-only authority");
            assert_eq!(error.diagnostic.code, "TEST_AUTH_RULE_DENIED", "{name}");
        }

        let mut db = database();
        let aliased_actor_rule = MutationPlan {
            steps: vec![
                MutationStep::Let {
                    bind_as: "delegated".to_owned(),
                    expr: ValueExpr::AuthIsDelegated,
                },
                MutationStep::Guard {
                    cond: ValueExpr::Binding("delegated".to_owned()),
                    else_error: "TEST_AUTH_RULE_DENIED".to_owned(),
                },
            ],
            return_value: Some(ReturnValue::ChangedCount),
        };
        let error = db
            .execute_mutation(&aliased_actor_rule, &delegated)
            .expect_err("binding aliases cannot hide actor dependence from a trusted guard");
        assert_eq!(error.diagnostic.code, "TEST_AUTH_RULE_DENIED");
    }

    fn permission_schema(permission_fields: Option<Vec<&str>>) -> SchemaManifest {
        let mut schema = schema();
        let table = &mut schema.tables[0];
        table.permission_backing = true;
        table.permission_fields =
            permission_fields.map(|fields| fields.into_iter().map(str::to_owned).collect());
        schema
    }

    fn permission_database(permission_fields: Option<Vec<&str>>) -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.apply_schema(permission_schema(permission_fields))
            .expect("apply permission schema");
        db
    }

    fn file_database() -> (tempfile::TempDir, PathBuf, LocalDatabase) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("guarded.sqlite3");
        let mut db = LocalDatabase::open(&path).expect("file database");
        db.apply_schema(schema()).expect("apply test schema");
        (dir, path, db)
    }

    fn insert_plan() -> MutationPlan {
        let insert = |title: &str| {
            let mut values = BTreeMap::new();
            values.insert("title".to_owned(), ValueExpr::Literal(json!(title)));
            MutationStep::Insert {
                table: "items".to_owned(),
                values,
                bind_id_as: None,
            }
        };
        MutationPlan {
            steps: vec![insert("one"), insert("two")],
            return_value: Some(ReturnValue::ChangedCount),
        }
    }

    fn buffered_writes() -> Vec<BufferedWrite> {
        [("item_one", "one"), ("item_two", "two")]
            .into_iter()
            .map(|(id, title)| {
                let mut values = Map::new();
                values.insert("title".to_owned(), json!(title));
                BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: id.to_owned(),
                    values,
                }
            })
            .collect()
    }

    fn ledger() -> CtxAnswerLedger {
        CtxAnswerLedger {
            version: CTX_ANSWER_LEDGER_VERSION,
            ids: Vec::new(),
            now: 0,
            auth_fingerprint: None,
        }
    }

    fn buffered_payload() -> BufferedCommitPayload {
        BufferedCommitPayload {
            writes: buffered_writes(),
            membership_plans: Vec::new(),
            read_dependencies: Vec::new(),
            result: json!(2),
            ctx_ledger: ledger(),
        }
    }

    fn cancelled() -> SnapbackError {
        SnapbackError::error(
            "SNAPBACK_ACTION_TIMEOUT",
            "runtime",
            "guarded commit test cancellation",
        )
    }

    fn assert_empty(db: &LocalDatabase) {
        assert_eq!(db.current_version().expect("version"), 0);
        assert_eq!(db.scan_table("items", 10, 0).expect("scan").total, 0);
    }

    struct TestRetentionLimits(Option<ClientMutationRetentionLimits>);

    impl TestRetentionLimits {
        fn install(records: u64, bytes: u64) -> Self {
            Self::install_all(records, bytes, u64::MAX, u64::MAX)
        }

        fn install_all(
            records: u64,
            bytes: u64,
            records_per_auth: u64,
            bytes_per_auth: u64,
        ) -> Self {
            let previous = CLIENT_MUTATION_TEST_LIMITS.with(|slot| {
                slot.replace(Some(ClientMutationRetentionLimits {
                    records,
                    bytes,
                    records_per_auth,
                    bytes_per_auth,
                }))
            });
            Self(previous)
        }
    }

    impl Drop for TestRetentionLimits {
        fn drop(&mut self) {
            CLIENT_MUTATION_TEST_LIMITS.with(|slot| slot.set(self.0));
        }
    }

    fn seed_data(id: &str, title: &str) -> SeedData {
        SeedData {
            tables: BTreeMap::from([(
                "items".to_owned(),
                vec![Map::from_iter([
                    ("_id".to_owned(), json!(id)),
                    ("title".to_owned(), json!(title)),
                ])],
            )]),
        }
    }

    #[test]
    fn activation_and_ordinary_writes_preserve_the_closed_event_universe() {
        let mut db = LocalDatabase::memory().expect("database");
        let missing_predecessor = db
            .authorization_version()
            .expect_err("fresh database has no invented authorization version");
        let missing_predecessor_observed =
            missing_predecessor.diagnostic.code == "SNAPBACK_AUTHORIZATION_VERSION_CORRUPT";
        assert!(missing_predecessor_observed);
        db.apply_schema(schema()).expect("initial activation");
        let activated = db.authorization_version().expect("activation version");
        assert_eq!(activated.epoch, 1);

        db.apply_schema(schema())
            .expect("idempotent schema application");
        let after_idempotent = db.authorization_version().unwrap();
        assert_eq!(after_idempotent, activated);

        let commit = db
            .execute_mutation(&insert_plan(), &HandlerInput::default())
            .expect("ordinary host-plan commit");
        let removed_id = commit.changes[0].id.clone();
        let witness = commit.authorization.expect("postcommit witness");
        assert!(!witness.event);
        assert!(!witness.incarnation_rotated);
        assert_eq!(witness.version, activated);

        let removal = db
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Delete {
                    table: "items".to_owned(),
                    id: removed_id,
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("ordinary result-removing commit");
        let removal_witness = removal.authorization.unwrap();
        assert!(!removal_witness.event);
        assert_eq!(removal_witness.version, activated);
        println!(
            "SNAPBACK_AUTH_ACCEPTANCE_DEPLOYMENT_RECEIPT={}",
            json!({
                "missingPredecessorObserved": missing_predecessor_observed,
                "activationEpoch": activated.epoch,
                "idempotentActivationEpochAdvance": after_idempotent.epoch - activated.epoch,
                "ordinaryWriteRaisedAuthorizationEvent": witness.event,
                "ordinaryRemovalRaisedAuthorizationEvent": removal_witness.event,
            })
        );
    }

    #[test]
    fn permission_field_declarations_are_closed_and_schema_checked() {
        let mut db = LocalDatabase::memory().expect("database");

        let mut without_backing = schema();
        without_backing.tables[0].permission_fields = Some(vec!["rank".to_owned()]);
        let error = db
            .apply_schema(without_backing)
            .expect_err("permissionFields requires permissionBacking");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_SCHEMA_PERMISSION_FIELDS_WITHOUT_BACKING"
        );

        let mut unknown = permission_schema(Some(vec!["missing"]));
        let error = db
            .apply_schema(unknown.clone())
            .expect_err("unknown permission field");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_SCHEMA_PERMISSION_FIELD_UNKNOWN"
        );

        unknown.tables[0].permission_fields = Some(vec!["rank".to_owned(), "rank".to_owned()]);
        let error = db
            .apply_schema(unknown)
            .expect_err("duplicate permission field");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_SCHEMA_PERMISSION_FIELD_DUPLICATE"
        );
    }

    #[test]
    fn protected_room_projection_is_exact_and_permission_backed() {
        let table = TableManifest {
            name: "memberships".to_owned(),
            fields: vec![
                FieldManifest {
                    name: "userId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
                FieldManifest {
                    name: "boardId".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                },
            ],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: true,
            permission_fields: Some(vec!["userId".to_owned(), "boardId".to_owned()]),
            membership: None,
        };
        let projection = crate::ephemeral::RoomPermissionProjection {
            table: "memberships".to_owned(),
            subject_field: "userId".to_owned(),
            scope_fields: BTreeMap::from([("boardId".to_owned(), "boardId".to_owned())]),
        };
        let collection =
            crate::ephemeral::EphemeralCollection::local_cursor("boardCursors", "boardId")
                .require_room_permission("board")
                .permission_backed_by(projection);
        let manifest = SchemaManifest {
            auth: Some(crate::manifest::AuthManifest {
                mode: crate::manifest::AuthMode::Sessions,
            }),
            tables: vec![table],
            ephemeral_collections: vec![collection],
            ..SchemaManifest::default()
        };
        validate_schema(&manifest).expect("exact durable room projection");

        let mut missing_scope = manifest.clone();
        missing_scope.ephemeral_collections[0]
            .permission_backing
            .as_mut()
            .unwrap()
            .scope_fields
            .clear();
        let error = validate_schema(&missing_scope).expect_err("scope mapping must be exact");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
        );

        let mut omitted_read_field = manifest;
        omitted_read_field.tables[0].permission_fields = Some(vec!["userId".to_owned()]);
        let error = validate_schema(&omitted_read_field)
            .expect_err("permissionFields must cover every projected read");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION"
        );
    }

    #[test]
    fn host_plan_permission_write_advances_once_and_dry_run_rolls_back() {
        let mut db = permission_database(Some(vec!["rank"]));
        let baseline = db.authorization_version().unwrap();

        let dry_run = db
            .dry_run_mutation(&insert_plan(), &HandlerInput::default())
            .expect("host-plan dry run");
        assert_eq!(dry_run.commit.authorization, None);
        assert_eq!(db.authorization_version().unwrap(), baseline);
        assert_eq!(db.scan_table("items", 10, 0).unwrap().total, 0);

        let commit = db
            .execute_mutation(&insert_plan(), &HandlerInput::default())
            .expect("host-plan commit");
        let witness = commit.authorization.expect("postcommit witness");
        assert!(witness.event);
        assert_eq!(witness.version.epoch, baseline.epoch + 1);
        assert_eq!(witness.version, db.authorization_version().unwrap());
    }

    #[test]
    fn buffered_ibex_writes_use_permission_field_narrowing() {
        let mut db = permission_database(Some(vec!["rank"]));
        let baseline = db.authorization_version().unwrap();
        let input = HandlerInput::default();

        let inserted = db
            .commit_buffered_writes(
                &input,
                vec![BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "item".to_owned(),
                    values: Map::from_iter([
                        ("title".to_owned(), json!("before")),
                        ("rank".to_owned(), json!(1)),
                    ]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("buffered insert");
        let inserted_witness = inserted.authorization.unwrap();
        assert!(inserted_witness.event);
        assert_eq!(inserted_witness.version.epoch, baseline.epoch + 1);

        let disjoint = db
            .commit_buffered_writes(
                &input,
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "item".to_owned(),
                    values: Map::from_iter([("title".to_owned(), json!("after"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("known disjoint patch");
        let disjoint_witness = disjoint.authorization.unwrap();
        assert!(!disjoint_witness.event);
        assert_eq!(disjoint_witness.version, inserted_witness.version);

        let permission = db
            .commit_buffered_writes(
                &input,
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "item".to_owned(),
                    values: Map::from_iter([("rank".to_owned(), json!(2))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("permission patch");
        let permission_witness = permission.authorization.unwrap();
        assert!(permission_witness.event);
        assert_eq!(
            permission_witness.version.epoch,
            inserted_witness.version.epoch + 1
        );

        let deleted = db
            .commit_buffered_writes(
                &input,
                vec![BufferedWrite::Delete {
                    table: "items".to_owned(),
                    id: "item".to_owned(),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("permission delete");
        assert!(deleted.authorization.unwrap().event);
    }

    #[test]
    fn seed_and_reset_return_exact_transaction_witnesses() {
        let mut db = permission_database(Some(vec!["rank"]));
        let baseline = db.authorization_version().unwrap();
        let seed = db
            .seed_with_authorization(seed_data("old", "old data"))
            .expect("permission seed");
        assert!(seed.authorization.event);
        assert_eq!(seed.authorization.version.epoch, baseline.epoch + 1);
        assert_eq!(
            seed.authorization.version,
            db.authorization_version().unwrap()
        );

        let reset = db
            .reset_and_seed_with_authorization(Some(seed_data("new", "new data")))
            .expect("reset with seed");
        assert!(reset.authorization.event);
        assert!(reset.authorization.incarnation_rotated);
        assert_eq!(reset.authorization.version.epoch, 0);
        assert_ne!(
            reset.authorization.version.incarnation,
            seed.authorization.version.incarnation
        );
        assert_eq!(
            reset.authorization.version,
            db.authorization_version().unwrap()
        );

        let post_reset = db
            .seed_with_authorization(seed_data("again", "again"))
            .expect("post-reset permission seed");
        assert_eq!(post_reset.authorization.version.epoch, baseline.epoch);
        assert_ne!(
            post_reset.authorization.version.incarnation, baseline.incarnation,
            "equal epochs across reset cannot create an ABA witness"
        );
    }

    #[test]
    fn authorization_version_persists_across_ordinary_restart() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("authorization-version.sqlite3");
        let committed = {
            let mut db = LocalDatabase::open(&path).expect("database");
            db.apply_schema(permission_schema(None))
                .expect("permission schema");
            db.execute_mutation(&insert_plan(), &HandlerInput::default())
                .expect("permission commit");
            db.authorization_version().unwrap()
        };
        let reopened = LocalDatabase::open(&path).expect("reopen database");
        assert_eq!(reopened.authorization_version().unwrap(), committed);
    }

    #[test]
    fn epoch_exhaustion_refuses_and_rolls_back_permission_commit() {
        let mut db = permission_database(None);
        db.conn
            .execute(
                "UPDATE _snapback_meta SET value = ?1 WHERE key = ?2",
                params![
                    MAX_AUTHORIZATION_EPOCH.to_string(),
                    auth_stream::AUTHORIZATION_EPOCH_META_KEY
                ],
            )
            .expect("set maximum epoch");
        let error = db
            .execute_mutation(&insert_plan(), &HandlerInput::default())
            .expect_err("nonwrapping epoch must refuse");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTHORIZATION_EPOCH_EXHAUSTED"
        );
        assert_eq!(db.scan_table("items", 10, 0).unwrap().total, 0);
        assert_eq!(
            db.authorization_version().unwrap().epoch,
            MAX_AUTHORIZATION_EPOCH
        );
    }

    #[test]
    fn reset_seed_rolls_back_insert_and_precommit_failures() {
        let mut db = database();
        db.seed(seed_data("old", "old data")).expect("initial seed");
        let predecessor_incarnation = db
            .ensure_authorization_stream_incarnation()
            .expect("initialize authorization stream");
        let predecessor_version = db.authorization_version().unwrap();

        let duplicate_seed = SeedData {
            tables: BTreeMap::from([(
                "items".to_owned(),
                vec![
                    Map::from_iter([
                        ("_id".to_owned(), json!("duplicate")),
                        ("title".to_owned(), json!("first")),
                    ]),
                    Map::from_iter([
                        ("_id".to_owned(), json!("duplicate")),
                        ("title".to_owned(), json!("second")),
                    ]),
                ],
            )]),
        };
        db.reset_and_seed(Some(duplicate_seed))
            .expect_err("duplicate insert must roll back the reset transaction");
        let scan = db
            .scan_table("items", 10, 0)
            .expect("scan after insert failure");
        assert_eq!(scan.total, 1);
        assert_eq!(scan.rows[0]["_id"], "old");
        assert_eq!(db.current_version().unwrap(), 1);
        assert_eq!(
            db.authorization_stream_incarnation().unwrap(),
            predecessor_incarnation
        );
        assert_eq!(db.authorization_version().unwrap(), predecessor_version);

        BEFORE_RESET_COMMIT_HOOK.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(|| {
                Err(SnapbackError::error(
                    "SNAPBACK_ACTION_TIMEOUT",
                    "storage",
                    "injected reset commit-boundary failure",
                ))
            }));
        });
        db.reset_and_seed(Some(seed_data("new", "new data")))
            .expect_err("precommit injection must roll back the reset transaction");
        let scan = db
            .scan_table("items", 10, 0)
            .expect("scan after commit-boundary failure");
        assert_eq!(scan.total, 1);
        assert_eq!(scan.rows[0]["_id"], "old");
        assert_eq!(db.current_version().unwrap(), 1);
        assert_eq!(
            db.authorization_stream_incarnation().unwrap(),
            predecessor_incarnation
        );
        assert_eq!(db.authorization_version().unwrap(), predecessor_version);

        db.reset_and_seed(Some(seed_data("new", "new data")))
            .expect("successful reset");
        assert_ne!(
            db.authorization_stream_incarnation().unwrap(),
            predecessor_incarnation
        );
        assert_eq!(db.authorization_version().unwrap().epoch, 0);
    }

    #[test]
    fn oversized_idempotency_result_rolls_back_rows_and_settlement() {
        let mut db = database();
        let input = HandlerInput {
            args: json!({
                "result": "x".repeat(CLIENT_MUTATION_MAX_RESULT_BYTES as usize + 1),
            }),
            ..HandlerInput::default()
        };
        let identity = ClientMutationIdentity::new("cm_large_result", "hostPlan", &input);
        let mut plan = insert_plan();
        // Keep the plan itself comfortably inside the portable artifact bound:
        // production output can be much larger than its expression when it is
        // derived from request data.
        plan.return_value = Some(ReturnValue::Expr(ValueExpr::Arg("result".to_owned())));
        let error = match db.execute_mutation_plan_with_lifecycle(
            &plan,
            &input,
            true,
            Some(&identity),
            &|| Ok(()),
            || Ok(()),
        ) {
            Ok(_) => panic!("oversized retained output must reject the whole transaction"),
            Err(error) => error,
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE"
        );
        assert_empty(&db);
        assert_eq!(
            db.client_mutation_retention_info().unwrap().records,
            0,
            "a rejected output cannot leave an idempotency row"
        );
    }

    #[test]
    fn retention_record_n_plus_one_refuses_without_losing_replay_or_writes() {
        let _limits = TestRetentionLimits::install(2, u64::MAX);
        let mut db = database();
        let input = HandlerInput::default();
        let first = ClientMutationIdentity::new("cm_record_limit_1", "hostPlan", &input);
        let second = ClientMutationIdentity::new("cm_record_limit_2", "hostPlan", &input);
        for identity in [&first, &second] {
            db.execute_mutation_plan_with_lifecycle(
                &insert_plan(),
                &input,
                true,
                Some(identity),
                &|| Ok(()),
                || Ok(()),
            )
            .expect("settlement below the fixture limit");
        }
        let retained = db.client_mutation_retention_info().unwrap();
        assert_eq!(retained.records, 2);
        assert_eq!(db.scan_table("items", 10, 0).unwrap().total, 4);
        assert_eq!(db.current_version().unwrap(), 2);

        let refused = ClientMutationIdentity::new("cm_record_limit_3", "hostPlan", &input);
        let error = match db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input,
            true,
            Some(&refused),
            &|| Ok(()),
            || Ok(()),
        ) {
            Ok(_) => panic!("record N+1 must fail closed"),
            Err(error) => error,
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL"
        );
        assert_eq!(db.client_mutation_retention_info().unwrap(), retained);
        assert_eq!(db.scan_table("items", 10, 0).unwrap().total, 4);
        assert_eq!(db.current_version().unwrap(), 2);
        assert!(db.client_mutation_result(&first).unwrap().is_some());
        assert_eq!(db.client_mutation_result(&refused).unwrap(), None);
    }

    #[test]
    fn retention_byte_n_plus_one_refuses_without_losing_replay_or_writes() {
        let mut db = database();
        let input = HandlerInput::default();
        let first = ClientMutationIdentity::new("cm_byte_limit_1", "hostPlan", &input);
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input,
            true,
            Some(&first),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("first settlement");
        let retained = db.client_mutation_retention_info().unwrap();
        let _limits = TestRetentionLimits::install(10, retained.bytes);

        let refused = ClientMutationIdentity::new("cm_byte_limit_2", "hostPlan", &input);
        let error = match db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input,
            true,
            Some(&refused),
            &|| Ok(()),
            || Ok(()),
        ) {
            Ok(_) => panic!("byte N+1 must fail closed"),
            Err(error) => error,
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL"
        );
        assert_eq!(db.client_mutation_retention_info().unwrap(), retained);
        assert_eq!(db.scan_table("items", 10, 0).unwrap().total, 2);
        assert_eq!(db.current_version().unwrap(), 1);
        assert!(db.client_mutation_result(&first).unwrap().is_some());
        assert_eq!(db.client_mutation_result(&refused).unwrap(), None);
    }

    #[test]
    fn per_auth_record_limit_preserves_capacity_for_another_principal() {
        let _limits = TestRetentionLimits::install_all(10, u64::MAX, 2, u64::MAX);
        let mut db = database();
        let input_a = HandlerInput {
            auth: crate::manifest::AuthInput {
                user_id: Some("auth-a".to_owned()),
                ..crate::manifest::AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let input_b = HandlerInput {
            auth: crate::manifest::AuthInput {
                user_id: Some("auth-b".to_owned()),
                ..crate::manifest::AuthInput::default()
            },
            ..HandlerInput::default()
        };
        for suffix in ["1", "2"] {
            let identity =
                ClientMutationIdentity::new(format!("cm_auth_a_{suffix}"), "hostPlan", &input_a);
            db.execute_mutation_plan_with_lifecycle(
                &insert_plan(),
                &input_a,
                true,
                Some(&identity),
                &|| Ok(()),
                || Ok(()),
            )
            .expect("same auth below cap");
        }
        let refused = ClientMutationIdentity::new("cm_auth_a_3", "hostPlan", &input_a);
        let error = match db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input_a,
            true,
            Some(&refused),
            &|| Ok(()),
            || Ok(()),
        ) {
            Ok(_) => panic!("per-auth record N+1 must fail closed"),
            Err(error) => error,
        };
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_RETENTION_FULL"
        );
        assert_eq!(error.diagnostic.details["scope"], "auth");
        assert_eq!(db.scan_table("items", 10, 0).unwrap().total, 4);

        let other = ClientMutationIdentity::new("cm_auth_b_1", "hostPlan", &input_b);
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input_b,
            true,
            Some(&other),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("another auth retains independent capacity");
        assert_eq!(db.client_mutation_retention_info().unwrap().records, 3);
        assert_eq!(
            client_mutation_auth_retention_counters(&db.conn, &refused.auth_fingerprint)
                .unwrap()
                .0,
            2
        );
        assert_eq!(
            client_mutation_auth_retention_counters(&db.conn, &other.auth_fingerprint)
                .unwrap()
                .0,
            1
        );
    }

    #[test]
    fn per_auth_byte_limit_preserves_capacity_for_another_principal() {
        let mut db = database();
        let input_a = HandlerInput {
            auth: crate::manifest::AuthInput {
                user_id: Some("bytes-a".to_owned()),
                ..crate::manifest::AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let input_b = HandlerInput {
            auth: crate::manifest::AuthInput {
                user_id: Some("bytes-b".to_owned()),
                ..crate::manifest::AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let first = ClientMutationIdentity::new("cm_auth_bytes_a_1", "hostPlan", &input_a);
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input_a,
            true,
            Some(&first),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("first auth settlement");
        let (_, auth_bytes) =
            client_mutation_auth_retention_counters(&db.conn, &first.auth_fingerprint).unwrap();
        let _limits = TestRetentionLimits::install_all(10, u64::MAX, 10, auth_bytes);

        let refused = ClientMutationIdentity::new("cm_auth_bytes_a_2", "hostPlan", &input_a);
        let error = match db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input_a,
            true,
            Some(&refused),
            &|| Ok(()),
            || Ok(()),
        ) {
            Ok(_) => panic!("per-auth byte N+1 must fail closed"),
            Err(error) => error,
        };
        assert_eq!(error.diagnostic.details["scope"], "auth");
        assert_eq!(db.scan_table("items", 10, 0).unwrap().total, 2);

        let other = ClientMutationIdentity::new("cm_auth_bytes_b_1", "hostPlan", &input_b);
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input_b,
            true,
            Some(&other),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("another auth has an independent byte budget");
        assert_eq!(db.client_mutation_retention_info().unwrap().records, 2);
    }

    #[test]
    fn explicit_authenticated_acknowledgement_reclaims_settlement_and_tracks_gc() {
        let mut db = database();
        let input = HandlerInput::default();
        let identity = ClientMutationIdentity::new("cm_ack_1", "hostPlan", &input);
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input,
            true,
            Some(&identity),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("settle mutation");
        let retained = db.client_mutation_retention_info().unwrap();
        assert_eq!(retained.records, 1);
        assert!(retained.bytes > 0);
        assert_eq!(
            db.acknowledge_client_mutations("another-auth", std::slice::from_ref(&identity.id))
                .unwrap(),
            0,
            "another authority cannot reclaim the result"
        );
        assert_eq!(
            db.acknowledge_client_mutations(
                &identity.auth_fingerprint,
                &[identity.id.clone(), identity.id.clone()]
            )
            .unwrap(),
            1,
            "duplicate acknowledgements are idempotently deduplicated"
        );
        let reclaimed = db.client_mutation_retention_info().unwrap();
        assert_eq!(reclaimed.records, 0);
        assert_eq!(reclaimed.gc_total, 1);
    }

    #[test]
    fn legacy_auth_fingerprint_is_quarantined_from_replay_but_remains_acknowledgeable() {
        let mut db = database();
        let input = HandlerInput {
            auth: crate::manifest::AuthInput {
                principal: Some("legacy-user".to_owned()),
                session_id: Some("legacy-session".to_owned()),
                user_id: Some("legacy-user".to_owned()),
                ..crate::manifest::AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let current = ClientMutationIdentity::new("cm_legacy_auth", "hostPlan", &input);
        let legacy_fingerprint = crate::manifest::legacy_auth_fingerprint(&input.auth);
        let mut legacy = current.clone();
        legacy.auth_fingerprint = legacy_fingerprint.clone();
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input,
            true,
            Some(&legacy),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("legacy settlement");
        let before = db.client_mutation_retention_info().unwrap();
        let error = db
            .client_mutation_result(&current)
            .expect_err("a 64-bit legacy alias cannot be rebound safely");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED"
        );
        let after = db.client_mutation_retention_info().unwrap();
        assert_eq!(
            after, before,
            "quarantine does not rewrite rows or counters"
        );
        assert_eq!(
            client_mutation_auth_retention_counters(&db.conn, &legacy_fingerprint).unwrap(),
            (1, before.bytes)
        );
        assert_eq!(
            db.acknowledge_client_mutations(
                &legacy_fingerprint,
                std::slice::from_ref(&current.id),
            )
            .unwrap(),
            1
        );
        assert_eq!(db.client_mutation_retention_info().unwrap().records, 0);
    }

    #[test]
    fn retention_counters_backfill_reopen_and_ack_transactionally() {
        let (_dir, path, mut db) = file_database();
        let input = HandlerInput::default();
        let identity = ClientMutationIdentity::new("cm_counter_reopen", "hostPlan", &input);
        db.execute_mutation_plan_with_lifecycle(
            &insert_plan(),
            &input,
            true,
            Some(&identity),
            &|| Ok(()),
            || Ok(()),
        )
        .expect("settle mutation");
        let before = db.client_mutation_retention_info().unwrap();
        assert_eq!(before.records, 1);
        assert!(before.bytes > 0);

        // Simulate a database created before the counters existed. Reopen is
        // the only path that scans the retained ledger and installs them.
        db.conn
            .execute(
                "DELETE FROM _snapback_meta WHERE key IN (?1, ?2)",
                params![META_CLIENT_MUTATION_RECORDS, META_CLIENT_MUTATION_BYTES],
            )
            .unwrap();
        drop(db);
        let mut reopened = LocalDatabase::open(&path).expect("reopen and backfill counters");
        assert_eq!(reopened.client_mutation_retention_info().unwrap(), before);

        assert_eq!(
            reopened
                .acknowledge_client_mutations(
                    &identity.auth_fingerprint,
                    std::slice::from_ref(&identity.id),
                )
                .unwrap(),
            1
        );
        let after_ack = reopened.client_mutation_retention_info().unwrap();
        assert_eq!(after_ack.records, 0);
        assert_eq!(after_ack.bytes, 0);
        assert_eq!(after_ack.gc_total, 1);
        drop(reopened);

        let reopened = LocalDatabase::open(&path).expect("reopen acknowledged counters");
        assert_eq!(
            reopened.client_mutation_retention_info().unwrap(),
            after_ack
        );
    }

    #[test]
    fn admin_recovery_purge_updates_global_and_auth_counters_atomically() {
        let mut db = database();
        let make_input = |user: &str| HandlerInput {
            auth: crate::manifest::AuthInput {
                user_id: Some(user.to_owned()),
                ..crate::manifest::AuthInput::default()
            },
            ..HandlerInput::default()
        };
        let input_a = make_input("purge-a");
        let input_b = make_input("purge-b");
        let identities = [
            ClientMutationIdentity::new("cm_purge_a_1", "hostPlan", &input_a),
            ClientMutationIdentity::new("cm_purge_a_2", "hostPlan", &input_a),
            ClientMutationIdentity::new("cm_purge_b_1", "hostPlan", &input_b),
        ];
        for (identity, input) in [
            (&identities[0], &input_a),
            (&identities[1], &input_a),
            (&identities[2], &input_b),
        ] {
            db.execute_mutation_plan_with_lifecycle(
                &insert_plan(),
                input,
                true,
                Some(identity),
                &|| Ok(()),
                || Ok(()),
            )
            .expect("settle purge fixture");
        }
        assert_eq!(db.client_mutation_retention_info().unwrap().records, 3);
        assert_eq!(
            db.purge_client_mutation_settlements(Some(&identities[0].auth_fingerprint))
                .unwrap(),
            2
        );
        let after_auth = db.client_mutation_retention_info().unwrap();
        assert_eq!(after_auth.records, 1);
        assert_eq!(after_auth.gc_total, 0, "admin purge is not client ACK GC");
        assert_eq!(
            client_mutation_auth_retention_counters(&db.conn, &identities[0].auth_fingerprint)
                .unwrap(),
            (0, 0)
        );
        assert!(db.client_mutation_result(&identities[0]).unwrap().is_none());
        assert!(db.client_mutation_result(&identities[2]).unwrap().is_some());

        assert_eq!(db.purge_client_mutation_settlements(None).unwrap(), 1);
        let empty = db.client_mutation_retention_info().unwrap();
        assert_eq!((empty.records, empty.bytes), (0, 0));
        assert!(db.client_mutation_result(&identities[2]).unwrap().is_none());
    }

    struct CommitVisibilityGuard {
        reader: Connection,
        active: Arc<AtomicBool>,
        dropped: Arc<AtomicBool>,
        expected_rows: i64,
    }

    impl Drop for CommitVisibilityGuard {
        fn drop(&mut self) {
            let visible: i64 = self
                .reader
                .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
                .expect("guard drop visibility query");
            assert_eq!(
                visible, self.expected_rows,
                "the caller's guard must remain alive through SQLite COMMIT"
            );
            self.active.store(false, Ordering::SeqCst);
            self.dropped.store(true, Ordering::SeqCst);
        }
    }

    #[test]
    fn guarded_host_plan_cancellation_rolls_back_rows_version_and_idempotency() {
        let input = HandlerInput::default();
        let plan = insert_plan();

        let mut during_iteration = database();
        let checks = Cell::new(0_usize);
        let error = during_iteration
            .execute_mutation_guarded(
                &plan,
                &input,
                || {
                    checks.set(checks.get() + 1);
                    if checks.get() == 3 {
                        Err(cancelled())
                    } else {
                        Ok(())
                    }
                },
                || Ok(()),
            )
            .expect_err("second-step lifecycle check must cancel the transaction");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_empty(&during_iteration);

        let mut before_commit = permission_database(None);
        let authorization_before = before_commit.authorization_version().unwrap();
        let identity = ClientMutationIdentity::new("cm_host_guard", "hostPlan", &input);
        let error = match before_commit.execute_mutation_plan_with_lifecycle(
            &plan,
            &input,
            true,
            Some(&identity),
            &|| Ok(()),
            || -> SnapbackResult<()> { Err(cancelled()) },
        ) {
            Ok(_) => panic!("precommit cancellation must roll back the transaction"),
            Err(error) => error,
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_empty(&before_commit);
        assert_eq!(
            before_commit.authorization_version().unwrap(),
            authorization_before
        );
        assert_eq!(
            before_commit
                .client_mutation_result(&identity)
                .expect("idempotency lookup"),
            None,
            "a rejected precommit cannot retain an idempotency result"
        );
    }

    #[test]
    fn guarded_buffered_cancellation_rolls_back_rows_version_and_idempotency() {
        let input = HandlerInput::default();

        let mut during_iteration = database();
        let checks = Cell::new(0_usize);
        let error = during_iteration
            .commit_buffered_writes_idempotent_guarded(
                &input,
                buffered_payload(),
                None,
                || {
                    checks.set(checks.get() + 1);
                    if checks.get() == 3 {
                        Err(cancelled())
                    } else {
                        Ok(())
                    }
                },
                || Ok(()),
            )
            .expect_err("second-write lifecycle check must cancel the transaction");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_empty(&during_iteration);

        let mut before_commit = permission_database(None);
        let authorization_before = before_commit.authorization_version().unwrap();
        let identity = ClientMutationIdentity::new("cm_buffer_guard", "ibex", &input);
        let error = before_commit
            .commit_buffered_writes_idempotent_guarded(
                &input,
                buffered_payload(),
                Some(&identity),
                || Ok(()),
                || -> SnapbackResult<()> { Err(cancelled()) },
            )
            .expect_err("buffered precommit cancellation must roll back");
        assert_eq!(error.diagnostic.code, "SNAPBACK_ACTION_TIMEOUT");
        assert_empty(&before_commit);
        assert_eq!(
            before_commit.authorization_version().unwrap(),
            authorization_before
        );
        assert_eq!(
            before_commit
                .client_mutation_result(&identity)
                .expect("idempotency lookup"),
            None,
            "a rejected buffered precommit cannot retain an idempotency result"
        );
    }

    #[test]
    fn guarded_host_plan_guard_starts_after_iteration_and_spans_commit() {
        let (_dir, path, mut db) = file_database();
        let reader = Connection::open(path).expect("visibility reader");
        let active = Arc::new(AtomicBool::new(false));
        let dropped = Arc::new(AtomicBool::new(false));
        let saw_guarded_final_check = Arc::new(AtomicBool::new(false));
        let checks_before_guard = Arc::new(AtomicUsize::new(0));

        db.execute_mutation_guarded(
            &insert_plan(),
            &HandlerInput::default(),
            {
                let active = active.clone();
                let saw_guarded_final_check = saw_guarded_final_check.clone();
                let checks_before_guard = checks_before_guard.clone();
                move || {
                    if active.load(Ordering::SeqCst) {
                        saw_guarded_final_check.store(true, Ordering::SeqCst);
                    } else {
                        checks_before_guard.fetch_add(1, Ordering::SeqCst);
                    }
                    Ok(())
                }
            },
            {
                let active = active.clone();
                let dropped = dropped.clone();
                let checks_before_guard = checks_before_guard.clone();
                move || {
                    assert!(
                        checks_before_guard.load(Ordering::SeqCst) >= 3,
                        "plan iteration must finish before gate acquisition"
                    );
                    active.store(true, Ordering::SeqCst);
                    Ok(CommitVisibilityGuard {
                        reader,
                        active,
                        dropped,
                        expected_rows: 2,
                    })
                }
            },
        )
        .expect("guarded host plan commit");

        assert!(saw_guarded_final_check.load(Ordering::SeqCst));
        assert!(dropped.load(Ordering::SeqCst));
        assert!(!active.load(Ordering::SeqCst));
        assert_eq!(db.current_version().unwrap(), 1);
    }

    #[test]
    fn guarded_buffered_guard_starts_after_iteration_and_spans_commit() {
        let (_dir, path, mut db) = file_database();
        let reader = Connection::open(path).expect("visibility reader");
        let active = Arc::new(AtomicBool::new(false));
        let dropped = Arc::new(AtomicBool::new(false));
        let saw_guarded_final_check = Arc::new(AtomicBool::new(false));
        let checks_before_guard = Arc::new(AtomicUsize::new(0));

        db.commit_buffered_writes_idempotent_guarded(
            &HandlerInput::default(),
            buffered_payload(),
            None,
            {
                let active = active.clone();
                let saw_guarded_final_check = saw_guarded_final_check.clone();
                let checks_before_guard = checks_before_guard.clone();
                move || {
                    if active.load(Ordering::SeqCst) {
                        saw_guarded_final_check.store(true, Ordering::SeqCst);
                    } else {
                        checks_before_guard.fetch_add(1, Ordering::SeqCst);
                    }
                    Ok(())
                }
            },
            {
                let active = active.clone();
                let dropped = dropped.clone();
                let checks_before_guard = checks_before_guard.clone();
                move || {
                    assert!(
                        checks_before_guard.load(Ordering::SeqCst) >= 3,
                        "buffered iteration must finish before gate acquisition"
                    );
                    active.store(true, Ordering::SeqCst);
                    Ok(CommitVisibilityGuard {
                        reader,
                        active,
                        dropped,
                        expected_rows: 2,
                    })
                }
            },
        )
        .expect("guarded buffered commit");

        assert!(saw_guarded_final_check.load(Ordering::SeqCst));
        assert!(dropped.load(Ordering::SeqCst));
        assert!(!active.load(Ordering::SeqCst));
        assert_eq!(db.current_version().unwrap(), 1);
    }

    #[test]
    fn buffered_commit_uses_the_invocation_ledger_clock_everywhere() {
        let mut db = database();
        let input = HandlerInput::default();
        let mut ledger = ledger();
        ledger.now = 123_456_789;
        let commit = db
            .commit_buffered_writes_idempotent_guarded(
                &input,
                BufferedCommitPayload {
                    writes: buffered_writes(),
                    membership_plans: Vec::new(),
                    read_dependencies: Vec::new(),
                    result: json!({ "now": ledger.now }),
                    ctx_ledger: ledger.clone(),
                },
                None,
                || Ok(()),
                || Ok(()),
            )
            .expect("buffered commit");

        assert_eq!(commit.output.ctx_ledger, Some(ledger.clone()));
        assert_eq!(commit.output.result["now"], json!(ledger.now));
        for change in &commit.changes {
            let row = change.row.as_ref().expect("insert row");
            assert_eq!(row["_createdAt"], json!(ledger.now));
            assert_eq!(row["_updatedAt"], json!(ledger.now));
        }
        let (minimum, maximum): (i64, i64) = db
            .conn
            .query_row(
                "SELECT MIN(changed_at_ms), MAX(changed_at_ms) FROM _snapback_changes",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("journal timestamps");
        assert_eq!((minimum, maximum), (ledger.now as i64, ledger.now as i64));
    }

    #[test]
    fn ordered_queries_are_null_last_and_id_stable_in_both_directions() {
        let mut db = database();
        let rows = [
            json!({ "_id": "n", "title": "null", "rank": null }),
            json!({ "_id": "b", "title": "tie-b", "rank": 1 }),
            json!({ "_id": "a", "title": "tie-a", "rank": 1 }),
            json!({ "_id": "z", "title": "high", "rank": 2 }),
        ]
        .into_iter()
        .map(|row| row.as_object().cloned().expect("seed row"))
        .collect();
        db.seed(SeedData {
            tables: BTreeMap::from([("items".to_owned(), rows)]),
        })
        .expect("seed ordering fixture");

        let ids = |direction, limit| {
            db.query(
                &QueryPlan {
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    order: vec![crate::manifest::OrderExpr {
                        field: "rank".to_owned(),
                        direction,
                    }],
                    limit,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                },
                &HandlerInput::default(),
            )
            .expect("ordered query")
            .rows
            .into_iter()
            .map(|row| row["_id"].as_str().expect("row id").to_owned())
            .collect::<Vec<_>>()
        };

        assert_eq!(
            ids(OrderDirection::Asc, None),
            ["a", "b", "z", "n"],
            "ASC must put NULL last and break ties by _id"
        );
        assert_eq!(
            ids(OrderDirection::Desc, None),
            ["z", "a", "b", "n"],
            "DESC must still put NULL last and break ties by _id"
        );
        assert_eq!(ids(OrderDirection::Asc, Some(2)), ["a", "b"]);
    }

    #[test]
    fn json_order_fields_fail_closed_before_sql_or_overlay_execution() {
        let db = database();
        let error = db
            .query(
                &QueryPlan {
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    order: vec![crate::manifest::OrderExpr {
                        field: "metadata".to_owned(),
                        direction: OrderDirection::Asc,
                    }],
                    limit: Some(1),
                    membership_filters: Vec::new(),
                    indexed_by: None,
                },
                &HandlerInput::default(),
            )
            .expect_err("Json field ordering has no portable scalar comparator");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE"
        );
        assert_eq!(error.diagnostic.details["field"], "metadata");
        assert_eq!(error.diagnostic.details["fieldType"], "Json");
    }
}

// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the M2
//   write-path acceptance suite: the writer-class seam, the closed transition
//   matrix and its negatives, field-binding, the eligible-holder invariant (the
//   two-step schedule and the concurrent-finals race), witnesses, and the sweep.
#[cfg(test)]
mod membership_write_tests {
    use super::*;

    fn membership_schema() -> SchemaManifest {
        let string = |name: &str, optional: bool| FieldManifest {
            name: name.to_owned(),
            field_type: FieldType::String,
            optional,
        };
        let transition = |op: MembershipOp,
                          by: &[&str],
                          target: MembershipTarget,
                          from: Option<&[&str]>,
                          to: Option<&[&str]>,
                          fields: Option<&[&str]>| {
            crate::manifest::MembershipTransition {
                op,
                by: by.iter().map(|s| s.to_string()).collect(),
                target,
                from: from.map(|f| f.iter().map(|s| s.to_string()).collect()),
                to: to.map(|t| t.iter().map(|s| s.to_string()).collect()),
                fields: fields.map(|f| f.iter().map(|s| s.to_string()).collect()),
            }
        };
        use MembershipOp::*;
        use MembershipTarget::{Other, Own};
        SchemaManifest {
            tables: vec![
                TableManifest {
                    name: "events".to_owned(),
                    fields: vec![string("title", true)],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: None,
                },
                TableManifest {
                    name: "event_members".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "userId".to_owned(),
                            field_type: FieldType::Principal,
                            optional: false,
                        },
                        string("eventId", false),
                        string("role", false),
                        FieldManifest {
                            name: "expiresAt".to_owned(),
                            field_type: FieldType::Integer,
                            optional: true,
                        },
                        string("notifyPrefs", true),
                    ],
                    indexes: Vec::new(),
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    membership: Some(MembershipManifest {
                        id: None,
                        principal: "userId".to_owned(),
                        resource: Some("eventId".to_owned()),
                        role: "role".to_owned(),
                        roles: ["host", "cohost", "guest"]
                            .iter()
                            .map(|s| s.to_string())
                            .collect(),
                        pending_roles: Some(vec!["invited".to_owned()]),
                        bootstrap_role: Some("host".to_owned()),
                        last_holder: Some(crate::manifest::MembershipLastHolder {
                            protect: "host".to_owned(),
                        }),
                        expiry: Some(crate::manifest::MembershipExpiry {
                            field: "expiresAt".to_owned(),
                            on_expiry: "remove".to_owned(),
                        }),
                        incidental: Some(vec!["notifyPrefs".to_owned()]),
                        provenance: Some(MembershipProvenance::Full),
                        transitions: vec![
                            transition(Insert, &["host", "cohost"], Other, None, Some(&["invited"]), None),
                            transition(Insert, &["none"], Own, None, Some(&["guest"]), None),
                            transition(SetRole, &["self"], Own, Some(&["invited"]), Some(&["guest"]), None),
                            transition(SetRole, &["host"], Other, Some(&["guest"]), Some(&["cohost"]), None),
                            transition(SetRole, &["host"], Other, Some(&["cohost"]), Some(&["guest"]), None),
                            transition(SetRole, &["host"], Other, Some(&["cohost"]), Some(&["host"]), None),
                            transition(Remove, &["self"], Own, Some(&["invited", "guest", "cohost", "host"]), None, None),
                            transition(Remove, &["host"], Other, Some(&["guest", "cohost"]), None, None),
                            transition(Patch, &["host"], Other, None, None, Some(&["expiresAt"])),
                            transition(Patch, &["self"], Own, None, None, Some(&["notifyPrefs"])),
                        ],
                        scope: MembershipScope::Resource,
                        resource_table: Some("events".to_owned()),
                    }),
                },
            ],
            ..SchemaManifest::default()
        }
    }

    fn ready_db() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_current_auth_catalog().expect("auth catalog");
        db.apply_schema(membership_schema()).expect("apply schema");
        db
    }

    #[test]
    fn autonomous_service_principal_writer_preserves_its_grant() {
        let authority = crate::auth::invocation::ResolvedAppAuthority::ServicePrincipal {
            actor_user_id: "agent-a".to_owned(),
            credential_id: "credential-a".to_owned(),
            credential_generation: 7,
            grant_id: "grant-autonomous".to_owned(),
            token_id: "token-a".to_owned(),
            effective_user_id: None,
            scopes: Vec::new(),
            token_expires_at_ms: 10_000,
        };
        let writer = MembershipWriter::from_resolved(&authority);
        assert_eq!(writer.effective_principal(), Some("agent-a"));
        let provenance = writer.provenance().expect("service provenance");
        assert_eq!(provenance.actor, "agent-a");
        assert_eq!(provenance.effective, "agent-a");
        assert_eq!(provenance.grant.as_deref(), Some("grant-autonomous"));
        assert_eq!(provenance.writer_class, "autonomous");

        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        let plan = db
            .plan_membership_insert(
                &writer,
                "event_members",
                Map::from_iter([
                    ("userId".to_owned(), json!("agent-a")),
                    ("eventId".to_owned(), json!(event_id)),
                    ("role".to_owned(), json!("guest")),
                ]),
            )
            .expect("autonomous open-join plan");
        let commit = db
            .commit_membership_plan(&writer, plan)
            .expect("autonomous open-join commit");
        let membership_id = commit_id_for_table(&commit, "event_members");
        assert_eq!(
            db.membership_creation_provenance("event_members", &membership_id)
                .expect("creation provenance"),
            Some(MembershipCreationProvenance {
                actor: "agent-a".to_owned(),
                effective: "agent-a".to_owned(),
                grant: Some("grant-autonomous".to_owned()),
            })
        );
    }

    #[test]
    fn mixed_resource_delete_cannot_spend_a_stale_membership_insert_plan() {
        let mut schema = membership_schema();
        let membership = schema
            .tables
            .iter_mut()
            .find(|table| table.name == "event_members")
            .and_then(|table| table.membership.as_mut())
            .expect("event membership declaration");
        membership.last_holder = None;
        membership.bootstrap_role = None;

        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_current_auth_catalog().expect("auth catalog");
        db.apply_schema(schema).expect("apply unprotected schema");
        let event_id = "event-empty";
        db.commit_buffered_writes(
            &HandlerInput::default(),
            vec![BufferedWrite::Insert {
                table: "events".to_owned(),
                id: event_id.to_owned(),
                values: Map::from_iter([("title".to_owned(), json!("empty event"))]),
            }],
            Vec::new(),
            Value::Null,
        )
        .expect("create empty resource");

        let writer = user("alice");
        let plan = db
            .plan_membership_insert(
                &writer,
                "event_members",
                Map::from_iter([
                    ("userId".to_owned(), json!("alice")),
                    ("eventId".to_owned(), json!(event_id)),
                    ("role".to_owned(), json!("guest")),
                ]),
            )
            .expect("plan open join while resource exists");
        let error = db
            .commit_buffered_writes_idempotent_guarded(
                &HandlerInput::default(),
                BufferedCommitPayload {
                    writes: vec![BufferedWrite::Delete {
                        table: "events".to_owned(),
                        id: event_id.to_owned(),
                    }],
                    membership_plans: vec![AuthorizedMembershipPlan::user_transition(
                        writer, plan,
                    )],
                    read_dependencies: Vec::new(),
                    result: Value::Null,
                    ctx_ledger: CtxAnswerLedger {
                        version: CTX_ANSWER_LEDGER_VERSION,
                        ids: Vec::new(),
                        now: 1,
                        auth_fingerprint: None,
                    },
                },
                None,
                || Ok(()),
                || Ok(()),
            )
            .expect_err("mixed delete must not orphan the sanctioned membership insert");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING"
        );
        assert!(
            db.get("events", event_id)
                .expect("resource read")
                .is_some()
        );
        assert_eq!(
            db.scan_table("event_members", 10, 0)
                .expect("membership scan")
                .total,
            0
        );
    }

    fn user(principal: &str) -> MembershipWriter {
        MembershipWriter::User {
            effective_principal: principal.to_owned(),
        }
    }

    fn seed_agent(db: &mut LocalDatabase, id: &str) {
        db.create_agent_principal(
            id,
            0,
            &crate::storage::auth_agents::AgentRegistration {
                display_name: None,
                operator_contact: None,
                registration_provenance: json!({ "invitedBy": "open" }).to_string(),
                owner_user_id: None,
            },
        )
        .expect("create agent");
    }

    fn commit_id_for_table(commit: &MutationCommit, table: &str) -> String {
        commit
            .changes
            .iter()
            .find(|change| change.table == table)
            .map(|change| change.id.clone())
            .unwrap_or_else(|| panic!("no change for table {table}"))
    }

    /// Bootstrap an event with `host` seated. Returns (event_id, host_member_id).
    fn create_event(db: &mut LocalDatabase, host: &str) -> (String, String) {
        let writer = user(host);
        let mut values = Map::new();
        values.insert("title".to_owned(), json!("party"));
        let plan = db
            .plan_membership_bootstrap(&writer, "events", values, "event_members")
            .expect("bootstrap plan");
        let commit = db.commit_membership_plan(&writer, plan).expect("bootstrap commit");
        let event_id = commit_id_for_table(&commit, "events");
        let host_id = commit_id_for_table(&commit, "event_members");
        (event_id, host_id)
    }

    fn member_id(db: &LocalDatabase, event_id: &str, principal: &str) -> String {
        db.conn
            .query_row(
                "SELECT _id FROM event_members WHERE eventId = ?1 AND userId = ?2",
                params![event_id, principal],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_else(|_| panic!("no member row for {principal} on {event_id}"))
    }

    fn role_of(db: &LocalDatabase, member_id: &str) -> Option<String> {
        db.conn
            .query_row(
                "SELECT role FROM event_members WHERE _id = ?1",
                params![member_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .expect("query role")
    }

    fn invite(db: &mut LocalDatabase, host: &str, event_id: &str, invitee: &str) {
        let writer = user(host);
        let mut values = Map::new();
        values.insert("userId".to_owned(), json!(invitee));
        values.insert("eventId".to_owned(), json!(event_id));
        values.insert("role".to_owned(), json!("invited"));
        let plan = db
            .plan_membership_insert(&writer, "event_members", values)
            .expect("invite plan");
        db.commit_membership_plan(&writer, plan).expect("invite commit");
    }

    fn set_role(db: &mut LocalDatabase, actor: &str, member_id: &str, to: &str) -> SnapbackResult<()> {
        let writer = user(actor);
        let plan = db.plan_membership_set_role(&writer, "event_members", member_id, to)?;
        db.commit_membership_plan(&writer, plan).map(|_| ())
    }

    /// Seat a second, real `host` by promoting an invited principal all the way up.
    fn promote_to_host(db: &mut LocalDatabase, host: &str, event_id: &str, target: &str) {
        invite(db, host, event_id, target);
        let mid = member_id(db, event_id, target);
        set_role(db, target, &mid, "guest").expect("accept");
        set_role(db, host, &mid, "cohost").expect("promote cohost");
        set_role(db, host, &mid, "host").expect("promote host");
    }

    #[test]
    fn membership_commits_drive_event_one_except_attested_incidental_updates() {
        let mut db = ready_db();
        let baseline = db.authorization_version().expect("activation version");

        let (event_id, _) = create_event(&mut db, "alice");
        let after_bootstrap = db.authorization_version().expect("bootstrap version");
        assert_eq!(after_bootstrap.epoch, baseline.epoch + 1);

        invite(&mut db, "alice", &event_id, "bob");
        let bob = member_id(&db, &event_id, "bob");
        let after_insert = db.authorization_version().expect("insert version");
        assert_eq!(after_insert.epoch, after_bootstrap.epoch + 1);

        let role_plan = db
            .plan_membership_set_role(&user("bob"), "event_members", &bob, "guest")
            .expect("accept invite");
        let role_commit = db
            .commit_membership_plan(&user("bob"), role_plan)
            .expect("role commit");
        assert!(role_commit.authorization.as_ref().is_some_and(|w| w.event));
        assert_eq!(
            role_commit
                .authorization
                .as_ref()
                .unwrap()
                .membership_declarations,
            vec!["event_members".to_owned()]
        );
        let after_role = db.authorization_version().expect("role version");
        assert_eq!(after_role.epoch, after_insert.epoch + 1);

        let incidental_plan = db
            .plan_membership_patch(
                &user("bob"),
                "event_members",
                &bob,
                Map::from_iter([("notifyPrefs".to_owned(), json!("mentions"))]),
            )
            .expect("self preferences patch");
        let incidental_commit = db
            .commit_membership_plan(&user("bob"), incidental_plan)
            .expect("incidental commit");
        assert!(
            incidental_commit
                .authorization
                .as_ref()
                .is_some_and(|witness| !witness.event)
        );
        assert!(
            incidental_commit
                .authorization
                .as_ref()
                .unwrap()
                .membership_declarations
                .is_empty()
        );
        assert_eq!(db.authorization_version().unwrap(), after_role);

        let expiry_plan = db
            .plan_membership_patch(
                &user("alice"),
                "event_members",
                &bob,
                Map::from_iter([("expiresAt".to_owned(), json!(1_000))]),
            )
            .expect("host expiry patch");
        let expiry_commit = db
            .commit_membership_plan(&user("alice"), expiry_plan)
            .expect("expiry commit");
        assert!(expiry_commit.authorization.as_ref().is_some_and(|w| w.event));
        assert_eq!(
            db.authorization_version().unwrap().epoch,
            after_role.epoch + 1
        );

        let remove_plan = db
            .plan_membership_remove(&user("alice"), "event_members", &bob)
            .expect("host removes guest");
        let remove_commit = db
            .commit_membership_plan(&user("alice"), remove_plan)
            .expect("remove commit");
        assert!(remove_commit.authorization.as_ref().is_some_and(|w| w.event));
    }

    #[test]
    fn full_provenance_keeps_delegated_downgrade_and_delete_attributable() {
        let mut db = ready_db();
        let (event_id, host_id) = create_event(&mut db, "alice");
        assert_eq!(
            db.membership_creation_provenance("event_members", &host_id)
                .unwrap(),
            Some(MembershipCreationProvenance {
                actor: "alice".to_owned(),
                effective: "alice".to_owned(),
                grant: None,
            })
        );

        let delegated = MembershipWriter::Delegated {
            actor_principal: "agent-a".to_owned(),
            effective_principal: "alice".to_owned(),
            grant_id: "grant-historical".to_owned(),
            authority_creating_consent: true,
        };
        let values = Map::from_iter([
            ("userId".to_owned(), json!("bob")),
            ("eventId".to_owned(), json!(event_id)),
            ("role".to_owned(), json!("invited")),
        ]);
        let plan = db
            .plan_membership_insert(&delegated, "event_members", values)
            .expect("delegated invite plan");
        let invite = db
            .commit_membership_plan(&delegated, plan)
            .expect("delegated invite commit");
        let bob = commit_id_for_table(&invite, "event_members");
        assert_eq!(
            db.membership_creation_provenance("event_members", &bob)
                .unwrap(),
            Some(MembershipCreationProvenance {
                actor: "agent-a".to_owned(),
                effective: "alice".to_owned(),
                grant: Some("grant-historical".to_owned()),
            })
        );

        set_role(&mut db, "bob", &bob, "guest").expect("accept invite");
        set_role(&mut db, "alice", &bob, "cohost").expect("promote cohost");
        let downgrade = db
            .plan_membership_set_role(&delegated, "event_members", &bob, "guest")
            .expect("delegated downgrade plan");
        db.commit_membership_plan(&delegated, downgrade)
            .expect("delegated downgrade commit");
        let remove = db
            .plan_membership_remove(&delegated, "event_members", &bob)
            .expect("delegated kick plan");
        db.commit_membership_plan(&delegated, remove)
            .expect("delegated kick commit");
        assert_eq!(role_of(&db, &bob), None, "the kicked row is gone");

        let log = db.membership_transition_log("event_members").unwrap();
        let bob_log = log
            .iter()
            .filter(|record| record.principal == "bob")
            .collect::<Vec<_>>();
        let downgrade = bob_log
            .iter()
            .find(|record| record.op == "setRole" && record.from_role.as_deref() == Some("cohost"))
            .expect("durable downgrade record");
        let deletion = bob_log
            .iter()
            .find(|record| record.op == "remove")
            .expect("durable deletion record");
        for record in [downgrade, deletion] {
            assert_eq!(record.actor, "agent-a");
            assert_eq!(record.effective, "alice");
            assert_eq!(record.grant.as_deref(), Some("grant-historical"));
            assert_eq!(record.writer_class, "delegated");
        }
    }

    #[test]
    fn delegated_self_seating_persists_after_grant_revocation_and_authorizes_by_row() {
        let mut schema = membership_schema();
        schema.tables[1]
            .membership
            .as_mut()
            .expect("event membership")
            .transitions
            .push(crate::manifest::MembershipTransition {
                op: MembershipOp::Insert,
                by: vec!["host".to_owned()],
                target: MembershipTarget::Other,
                from: None,
                to: Some(vec!["host".to_owned()]),
                fields: None,
            });
        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_current_auth_catalog().expect("auth catalog");
        db.apply_schema(schema).expect("self-seating schema");
        db.conn
            .execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES('alice', 0, 'human', 'Alice', NULL, NULL, NULL, NULL)",
                [],
            )
            .expect("human principal");
        seed_agent(&mut db, "agent-a");
        db.conn
            .execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES(
                   'grant-self-seat', 'agent-a', 'alice', '[]', 10,
                   1000, NULL, 'test', NULL, NULL, 10
                 )",
                [],
            )
            .expect("delegated grant");

        let (event_id, _) = create_event(&mut db, "alice");
        let delegated = MembershipWriter::Delegated {
            actor_principal: "agent-a".to_owned(),
            effective_principal: "alice".to_owned(),
            grant_id: "grant-self-seat".to_owned(),
            authority_creating_consent: true,
        };
        let plan = db
            .plan_membership_insert(
                &delegated,
                "event_members",
                Map::from_iter([
                    ("userId".to_owned(), json!("agent-a")),
                    ("eventId".to_owned(), json!(event_id)),
                    ("role".to_owned(), json!("host")),
                ]),
            )
            .expect("consented delegate seats its actor");
        let commit = db
            .commit_membership_plan(&delegated, plan)
            .expect("self-seating commit");
        let membership_id = commit_id_for_table(&commit, "event_members");

        db.revoke_grant_for_user("alice", "grant-self-seat", 20)
            .expect("grant revocation");
        let revoked_at: Option<i64> = db
            .conn
            .query_row(
                "SELECT revoked_at_ms FROM _auth_grants WHERE id = 'grant-self-seat'",
                [],
                |row| row.get(0),
            )
            .expect("revoked grant row");
        assert_eq!(revoked_at, Some(20));
        assert_eq!(role_of(&db, &membership_id).as_deref(), Some("host"));
        assert_eq!(
            db.membership_creation_provenance("event_members", &membership_id)
                .expect("creation provenance"),
            Some(MembershipCreationProvenance {
                actor: "agent-a".to_owned(),
                effective: "alice".to_owned(),
                grant: Some("grant-self-seat".to_owned()),
            })
        );

        let membership = db.schema().tables[1]
            .membership
            .clone()
            .expect("event membership");
        let access = crate::membership_rules::require_role(
            &DbRead::Live(&db),
            &membership,
            "event_members",
            "agent-a",
            crate::membership_rules::ResourceBinding::Fixed(json!(event_id)),
            &["host".to_owned()],
        )
        .expect("autonomous role check");
        assert!(
            access.denial.is_none(),
            "post-revocation authority is explained by the durable row"
        );
    }

    #[test]
    fn full_membership_provenance_survives_database_reopen() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("membership-provenance.sqlite3");
        let (host_id, bob_id) = {
            let mut db = LocalDatabase::open(&path).expect("file database");
            db.activate_current_auth_catalog().expect("auth catalog");
            db.apply_schema(membership_schema()).expect("membership schema");
            let (event_id, host_id) = create_event(&mut db, "alice");
            invite(&mut db, "alice", &event_id, "bob");
            let bob_id = member_id(&db, &event_id, "bob");
            set_role(&mut db, "bob", &bob_id, "guest").expect("accept invite");
            (host_id, bob_id)
        };

        let reopened = LocalDatabase::open(&path).expect("reopen database");
        assert_eq!(
            reopened
                .membership_creation_provenance("event_members", &host_id)
                .unwrap(),
            Some(MembershipCreationProvenance {
                actor: "alice".to_owned(),
                effective: "alice".to_owned(),
                grant: None,
            })
        );
        let bob_log = reopened
            .membership_transition_log("event_members")
            .unwrap()
            .into_iter()
            .filter(|record| record.principal == "bob")
            .collect::<Vec<_>>();
        assert!(
            bob_log
                .iter()
                .any(|record| record.op == "insert" && record.to_role.as_deref() == Some("invited"))
        );
        assert!(
            bob_log.iter().any(|record| {
                record.op == "setRole"
                    && record.from_role.as_deref() == Some("invited")
                    && record.to_role.as_deref() == Some("guest")
            })
        );
        assert_eq!(role_of(&reopened, &bob_id).as_deref(), Some("guest"));
    }

    fn global_role_schema(provenance: Option<MembershipProvenance>) -> SchemaManifest {
        SchemaManifest {
            tables: vec![TableManifest {
                name: "app_roles".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "userId".to_owned(),
                        field_type: FieldType::Principal,
                        optional: false,
                    },
                    FieldManifest {
                        name: "role".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: Some(MembershipManifest {
                    id: Some("appRoles".to_owned()),
                    principal: "userId".to_owned(),
                    resource: None,
                    role: "role".to_owned(),
                    roles: vec!["admin".to_owned(), "moderator".to_owned()],
                    pending_roles: None,
                    bootstrap_role: None,
                    last_holder: None,
                    expiry: None,
                    incidental: None,
                    provenance,
                    transitions: Vec::new(),
                    scope: MembershipScope::App,
                    resource_table: None,
                }),
            }],
            ..SchemaManifest::default()
        }
    }

    #[test]
    fn global_roles_seed_real_rows_and_import_preserves_creation_provenance() {
        let mut db = LocalDatabase::memory().expect("memory db");
        db.apply_schema(global_role_schema(Some(MembershipProvenance::Creation)))
            .expect("global role schema");

        let seed = MembershipWriter::Seed;
        let seed_plan = db
            .plan_privileged_membership_insert(
                &seed,
                "app_roles",
                Map::from_iter([
                    ("userId".to_owned(), json!("alice")),
                    ("role".to_owned(), json!("admin")),
                ]),
            )
            .expect("first global admin is seeded");
        let seed_commit = db.commit_membership_plan(&seed, seed_plan).unwrap();
        let alice = commit_id_for_table(&seed_commit, "app_roles");
        assert_eq!(
            db.membership_creation_provenance("app_roles", &alice)
                .unwrap()
                .unwrap()
                .actor,
            "seed"
        );

        let (_, declaration) = resolve_membership_decl(db.schema(), "app_roles").unwrap();
        let real_row = crate::membership_rules::membership_read(
            &DbRead::Live(&db),
            declaration,
            "app_roles",
            "alice",
            crate::membership_rules::ResourceBinding::AppSingleton,
            &["admin".to_owned()],
        )
        .expect("real seeded global-role lookup");
        assert!(real_row.present, "the app gate reads durable membership data");

        let admin = MembershipWriter::Admin;
        let admin_plan = db
            .plan_privileged_membership_insert(
                &admin,
                "app_roles",
                Map::from_iter([
                    ("userId".to_owned(), json!("bob")),
                    ("role".to_owned(), json!("moderator")),
                ]),
            )
            .expect("admin data-edit plan");
        let admin_commit = db
            .commit_membership_plan(&admin, admin_plan)
            .expect("admin data-edit commit");
        let bob = commit_id_for_table(&admin_commit, "app_roles");
        assert_eq!(
            db.membership_creation_provenance("app_roles", &bob)
                .unwrap()
                .unwrap()
                .actor,
            "hostOps:dataEdit"
        );

        let imported = MembershipWriter::Import {
            granted_by_actor: "original-agent".to_owned(),
            granted_by_effective: "original-user".to_owned(),
            granted_by_grant: Some("historical-grant".to_owned()),
        };
        let import_plan = db
            .plan_privileged_membership_insert(
                &imported,
                "app_roles",
                Map::from_iter([
                    ("userId".to_owned(), json!("carol")),
                    ("role".to_owned(), json!("moderator")),
                ]),
            )
            .expect("import plan");
        let import_commit = db
            .commit_membership_plan(&imported, import_plan)
            .expect("import commit");
        let carol = commit_id_for_table(&import_commit, "app_roles");
        assert_eq!(
            db.membership_creation_provenance("app_roles", &carol)
                .unwrap(),
            Some(MembershipCreationProvenance {
                actor: "original-agent".to_owned(),
                effective: "original-user".to_owned(),
                grant: Some("historical-grant".to_owned()),
            })
        );
        assert!(
            db.membership_transition_log("appRoles").unwrap().is_empty(),
            "creation provenance does not manufacture the full transition ledger"
        );

        let duplicate = db
            .plan_privileged_membership_insert(
                &MembershipWriter::Admin,
                "app_roles",
                Map::from_iter([
                    ("userId".to_owned(), json!("alice")),
                    ("role".to_owned(), json!("moderator")),
                ]),
            )
            .expect("admin plan");
        let error = db
            .commit_membership_plan(&MembershipWriter::Admin, duplicate)
            .expect_err("one global role per declaration");
        assert_eq!(error.diagnostic.code, "SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION");
    }

    #[test]
    fn enabling_provenance_backfills_preexisting_memberships() {
        let mut db = LocalDatabase::memory().expect("memory db");
        let mut plain = global_role_schema(None);
        plain.tables[0].membership = None;
        db.apply_schema(plain).expect("pre-membership shape");
        db.execute_mutation(
            &MutationPlan {
                steps: vec![MutationStep::Insert {
                    table: "app_roles".to_owned(),
                    values: BTreeMap::from([
                        (
                            "userId".to_owned(),
                            ValueExpr::Literal(json!("legacy-user")),
                        ),
                        ("role".to_owned(), ValueExpr::Literal(json!("admin"))),
                    ]),
                    bind_id_as: None,
                }],
                return_value: None,
            },
            &HandlerInput::default(),
        )
        .expect("seed preexisting row");
        let legacy_id = db
            .query(
                &QueryPlan {
                    table: "app_roles".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                },
                &HandlerInput::default(),
            )
            .unwrap()
            .rows[0]["_id"]
            .as_str()
            .unwrap()
            .to_owned();
        db.apply_schema(global_role_schema(Some(MembershipProvenance::Full)))
            .expect("brownfield provenance adoption");
        assert_eq!(
            db.membership_creation_provenance("app_roles", &legacy_id)
                .unwrap(),
            Some(MembershipCreationProvenance {
                actor: "preexisting".to_owned(),
                effective: "preexisting".to_owned(),
                grant: None,
            })
        );
    }

    // --- Writer-class seam --------------------------------------------------

    #[test]
    fn raw_ctx_db_membership_write_is_refused() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        let mut values = Map::new();
        values.insert("userId".to_owned(), json!("mallory"));
        values.insert("eventId".to_owned(), json!(event_id));
        values.insert("role".to_owned(), json!("host"));
        let error = db
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "event_members".to_owned(),
                    id: "forged".to_owned(),
                    values,
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("raw membership write must be refused");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED");
    }

    #[test]
    fn hostplan_generic_membership_write_is_refused_including_dry_run() {
        let mut db = ready_db();
        let mut values = BTreeMap::new();
        values.insert("userId".to_owned(), ValueExpr::Literal(json!("mallory")));
        values.insert("eventId".to_owned(), ValueExpr::Literal(json!("e1")));
        values.insert("role".to_owned(), ValueExpr::Literal(json!("host")));
        let plan = MutationPlan {
            steps: vec![MutationStep::Insert {
                table: "event_members".to_owned(),
                values,
                bind_id_as: None,
            }],
            return_value: None,
        };
        let error = db
            .execute_mutation(&plan, &HandlerInput::default())
            .expect_err("hostplan membership insert refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_HOSTPLAN_WRITE_DENIED"
        );
        // Dry-run shares the path and must refuse identically.
        match db.dry_run_mutation(&plan, &HandlerInput::default()) {
            Err(error) => assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_MEMBERSHIP_HOSTPLAN_WRITE_DENIED"
            ),
            Ok(_) => panic!("hostplan dry-run membership insert must be refused"),
        }
    }

    #[test]
    fn userless_authority_matches_no_transition_class() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        // An open-join `by: ["none"]` transition exists, but a userless authority
        // matches no class at all — not even "none".
        for writer in [
            MembershipWriter::System,
            MembershipWriter::AdminBypass,
            MembershipWriter::Anonymous,
        ] {
            let mut values = Map::new();
            values.insert("userId".to_owned(), json!("nobody"));
            values.insert("eventId".to_owned(), json!(event_id));
            values.insert("role".to_owned(), json!("guest"));
            let error = db
                .plan_membership_insert(&writer, "event_members", values)
                .expect_err("userless open-join must be refused");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_MEMBERSHIP_NO_EFFECTIVE_PRINCIPAL",
                "writer {writer:?} must match no class"
            );
        }
    }

    // --- The declared transition matrix and its negatives -------------------

    #[test]
    fn invite_accept_and_leave() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        invite(&mut db, "alice", &event_id, "bob");
        let bob = member_id(&db, &event_id, "bob");
        assert_eq!(role_of(&db, &bob).as_deref(), Some("invited"));
        // Accept: self, invited -> guest.
        set_role(&mut db, "bob", &bob, "guest").expect("accept");
        assert_eq!(role_of(&db, &bob).as_deref(), Some("guest"));
        // Leave: self remove.
        let writer = user("bob");
        let plan = db
            .plan_membership_remove(&writer, "event_members", &bob)
            .expect("leave plan");
        db.commit_membership_plan(&writer, plan).expect("leave");
        assert_eq!(role_of(&db, &bob), None);
    }

    #[test]
    fn open_join_seats_self_but_not_a_far_future_expiry() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        // Open join: non-member seats self as guest.
        let writer = user("carol");
        let mut values = Map::new();
        values.insert("userId".to_owned(), json!("carol"));
        values.insert("eventId".to_owned(), json!(event_id));
        values.insert("role".to_owned(), json!("guest"));
        let plan = db
            .plan_membership_insert(&writer, "event_members", values.clone())
            .expect("open join plan");
        db.commit_membership_plan(&writer, plan).expect("open join");
        assert_eq!(role_of(&db, &member_id(&db, &event_id, "carol")).as_deref(), Some("guest"));

        // The open-join transition names no `fields`, so seating a far-future
        // expiresAt is refused (the field-bound insert hole).
        let mut with_expiry = Map::new();
        with_expiry.insert("userId".to_owned(), json!("dave"));
        with_expiry.insert("eventId".to_owned(), json!(event_id));
        with_expiry.insert("role".to_owned(), json!("guest"));
        with_expiry.insert("expiresAt".to_owned(), json!(9_999_999_999_999i64));
        let error = db
            .plan_membership_insert(&user("dave"), "event_members", with_expiry)
            .expect_err("open join cannot seat expiresAt");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_INSERT_FIELD_DENIED"
        );
    }

    #[test]
    fn guest_cannot_self_promote() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        invite(&mut db, "alice", &event_id, "bob");
        let bob = member_id(&db, &event_id, "bob");
        set_role(&mut db, "bob", &bob, "guest").expect("accept");
        // No transition lets a guest promote themselves.
        let error = set_role(&mut db, "bob", &bob, "host")
            .expect_err("guest self-promote refused");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED");
    }

    #[test]
    fn invitee_cannot_act_on_another_invitees_row() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        invite(&mut db, "alice", &event_id, "bob");
        invite(&mut db, "alice", &event_id, "carol");
        let carol = member_id(&db, &event_id, "carol");
        // Bob (invited) tries to accept Carol's invite (target other) -> refused.
        let error = set_role(&mut db, "bob", &carol, "guest")
            .expect_err("acting on another's row is refused");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED");
        // And bob cannot kick carol (remove other requires host).
        let plan = db.plan_membership_remove(&user("bob"), "event_members", &carol);
        assert_eq!(
            plan.expect_err("non-host kick refused").diagnostic.code,
            "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED"
        );
    }

    #[test]
    fn patch_is_field_bound_self_cannot_extend_own_expiry_host_can() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        invite(&mut db, "alice", &event_id, "bob");
        let bob = member_id(&db, &event_id, "bob");
        set_role(&mut db, "bob", &bob, "guest").expect("accept");

        // Self may patch own notifyPrefs.
        let mut prefs = Map::new();
        prefs.insert("notifyPrefs".to_owned(), json!("muted"));
        let plan = db
            .plan_membership_patch(&user("bob"), "event_members", &bob, prefs)
            .expect("prefs plan");
        db.commit_membership_plan(&user("bob"), plan).expect("prefs");

        // Self may NOT extend own expiresAt (the self-renewal hole).
        let mut extend = Map::new();
        extend.insert("expiresAt".to_owned(), json!(9_999_999_999_999i64));
        let error = db
            .plan_membership_patch(&user("bob"), "event_members", &bob, extend.clone())
            .expect_err("self expiry extend refused");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED");

        // But a host may extend a guest's expiresAt.
        let plan = db
            .plan_membership_patch(&user("alice"), "event_members", &bob, extend)
            .expect("host extend plan");
        db.commit_membership_plan(&user("alice"), plan).expect("host extend");
    }

    // --- lastHolder: establishment, preservation, the eligible-holder rule --

    #[test]
    fn creating_a_protected_resource_requires_seating_the_bootstrap_holder() {
        let mut db = ready_db();
        // A raw resource insert of a protected declaration's resource is refused;
        // it must go through the bootstrap path.
        let error = db
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "events".to_owned(),
                    id: "orphan-event".to_owned(),
                    values: Map::new(),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("bare protected resource insert refused");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_BOOTSTRAP_REQUIRED");
        // The bootstrap path succeeds and seats the host.
        let (event_id, host_id) = create_event(&mut db, "alice");
        assert_eq!(role_of(&db, &host_id).as_deref(), Some("host"));

        // Bootstrap is creation-bound: an EXISTING resource can never obtain the
        // witness. The only bootstrap API mints a fresh resource id, so seating a
        // second `host` on the already-created event must go through the ordinary
        // transition matrix — which declares no insert transition seating `host` —
        // and is refused. (Equivalently: a zero-member / just-emptied / imported
        // resource has no fresh creation for the witness to bind to.)
        let mut usurp = Map::new();
        usurp.insert("userId".to_owned(), json!("mallory"));
        usurp.insert("eventId".to_owned(), json!(event_id));
        usurp.insert("role".to_owned(), json!("host"));
        let error = db
            .plan_membership_insert(&user("mallory"), "event_members", usurp)
            .expect_err("no bootstrap witness on an existing resource");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_TRANSITION_DENIED");
    }

    #[test]
    fn a_lone_host_cannot_leave_but_two_hosts_allow_one_to_leave() {
        let mut db = ready_db();
        let (event_id, host_id) = create_event(&mut db, "alice");
        // Lone host leaving would strand the resource.
        let error = db
            .plan_membership_remove(&user("alice"), "event_members", &host_id)
            .expect_err("lone host leave refused");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND");

        // Seat a second host; now alice may leave.
        promote_to_host(&mut db, "alice", &event_id, "bob");
        let plan = db
            .plan_membership_remove(&user("alice"), "event_members", &host_id)
            .expect("second host present");
        db.commit_membership_plan(&user("alice"), plan).expect("alice leaves");
        // And now bob is the lone host again.
        let bob_id = member_id(&db, &event_id, "bob");
        let error = db
            .plan_membership_remove(&user("bob"), "event_members", &bob_id)
            .expect_err("bob is now the lone host");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND");
    }

    #[test]
    fn eligible_holder_two_step_schedule_is_refused() {
        // The review-caught trap: deactivate A (not sole) -> B leaves -> resource
        // held only by dead A. Eligibility, not row-count, closes it.
        let mut db = ready_db();
        seed_agent(&mut db, "agent-a");
        seed_agent(&mut db, "agent-b");
        let (event_id, agent_a_host) = create_event(&mut db, "agent-a");
        promote_to_host(&mut db, "agent-a", &event_id, "agent-b");
        let agent_b_host = member_id(&db, &event_id, "agent-b");

        // Deactivate A — allowed, B is still an eligible holder.
        db.deactivate_agent("agent-a", 100, &membership_schema())
            .expect("A is not the last eligible holder");

        // B leaving is now refused — A is ineligible, so B is the last eligible
        // holder and the resource would strand permanently.
        let error = db
            .plan_membership_remove(&user("agent-b"), "event_members", &agent_b_host)
            .expect_err("second-step leave must be refused");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND");
        let _ = agent_a_host;
    }

    #[test]
    fn a_deactivated_principal_cannot_be_promoted_into_the_protected_role() {
        let mut db = ready_db();
        seed_agent(&mut db, "agent-a");
        seed_agent(&mut db, "agent-dead");
        let (event_id, _) = create_event(&mut db, "agent-a");
        // Seat agent-dead as cohost, then deactivate it.
        invite(&mut db, "agent-a", &event_id, "agent-dead");
        let dead = member_id(&db, &event_id, "agent-dead");
        set_role(&mut db, "agent-dead", &dead, "guest").expect("accept");
        set_role(&mut db, "agent-a", &dead, "cohost").expect("cohost");
        db.deactivate_agent("agent-dead", 200, &membership_schema())
            .expect("cohost deactivation strands nothing");
        // Promoting the deactivated cohost to host is refused: the set cannot be
        // kept full with corpses.
        let error = set_role(&mut db, "agent-a", &dead, "host")
            .expect_err("promoting a corpse into the protected role is refused");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_INELIGIBLE_HOLDER");
    }

    #[test]
    fn concurrent_final_two_host_removals_yield_one_commit_one_conflict() {
        let mut db = ready_db();
        let (event_id, alice_host) = create_event(&mut db, "alice");
        promote_to_host(&mut db, "alice", &event_id, "bob");
        let bob_host = member_id(&db, &event_id, "bob");

        // Both leaves are PLANNED against the same snapshot (two eligible hosts).
        let alice_plan = db
            .plan_membership_remove(&user("alice"), "event_members", &alice_host)
            .expect("alice plan");
        let bob_plan = db
            .plan_membership_remove(&user("bob"), "event_members", &bob_host)
            .expect("bob plan");

        // The first commits; the second relied on the first's row surviving, so it
        // fails commit-time read-set validation.
        db.commit_membership_plan(&user("alice"), alice_plan)
            .expect("alice commits");
        let error = db
            .commit_membership_plan(&user("bob"), bob_plan)
            .expect_err("bob's concurrent final removal must fail at commit");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
        // Exactly one host remains — the resource is never stranded.
        assert_eq!(role_of(&db, &bob_host).as_deref(), Some("host"));
        assert_eq!(role_of(&db, &alice_host), None);
    }

    // --- Referential integrity + teardown witness ---------------------------

    #[test]
    fn insert_naming_a_missing_resource_is_refused() {
        let db = ready_db();
        let mut values = Map::new();
        values.insert("userId".to_owned(), json!("carol"));
        values.insert("eventId".to_owned(), json!("ghost-event"));
        values.insert("role".to_owned(), json!("guest"));
        let error = db
            .plan_membership_insert(&user("carol"), "event_members", values)
            .expect_err("insert on a missing resource is refused");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_RESOURCE_MISSING");
    }

    #[test]
    fn deleting_a_resource_with_members_is_refused_teardown_clears_and_deletes() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        // A plain resource delete while the host remains is refused.
        let error = db
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Delete {
                    table: "events".to_owned(),
                    id: event_id.clone(),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect_err("resource delete with members refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_RESOURCE_DELETE_BLOCKED"
        );
        // Teardown clears the whole roster (including the protected host) and
        // deletes the resource.
        let plan = db
            .plan_membership_teardown(&user("alice"), "events", &event_id)
            .expect("teardown plan");
        db.commit_membership_plan(&user("alice"), plan).expect("teardown");
        let remaining: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM event_members WHERE eventId = ?1",
                params![event_id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(remaining, 0);
        assert!(read_resource_version(&db.conn, "events", &event_id).unwrap().is_none());
    }

    #[test]
    fn concurrent_open_join_racing_teardown_yields_one_winner() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        let mut join_values = Map::new();
        join_values.insert("userId".to_owned(), json!("carol"));
        join_values.insert("eventId".to_owned(), json!(event_id));
        join_values.insert("role".to_owned(), json!("guest"));

        // Both planned against the same snapshot.
        let join_plan = db
            .plan_membership_insert(&user("carol"), "event_members", join_values)
            .expect("join plan");
        let teardown_plan = db
            .plan_membership_teardown(&user("alice"), "events", &event_id)
            .expect("teardown plan");

        // Teardown commits first; the racing insert then fails because the
        // resource row it captured is gone — no orphan on a deleted resource.
        db.commit_membership_plan(&user("alice"), teardown_plan)
            .expect("teardown commits");
        let error = db
            .commit_membership_plan(&user("carol"), join_plan)
            .expect_err("open join must lose to the completed teardown");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
    }

    #[test]
    fn open_join_committing_before_teardown_blocks_the_teardown() {
        let mut db = ready_db();
        let (event_id, _) = create_event(&mut db, "alice");
        let mut join_values = Map::new();
        join_values.insert("userId".to_owned(), json!("carol"));
        join_values.insert("eventId".to_owned(), json!(event_id));
        join_values.insert("role".to_owned(), json!("guest"));
        let join_plan = db
            .plan_membership_insert(&user("carol"), "event_members", join_values)
            .expect("join plan");
        let teardown_plan = db
            .plan_membership_teardown(&user("alice"), "events", &event_id)
            .expect("teardown plan");
        // The insert commits first; the teardown's captured roster emptiness is
        // now stale, so it fails rather than orphaning the new member.
        db.commit_membership_plan(&user("carol"), join_plan)
            .expect("join commits");
        let error = db
            .commit_membership_plan(&user("alice"), teardown_plan)
            .expect_err("teardown must lose to the completed open join");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MUTATION_CONFLICT");
    }

    // --- The expiry sweep ---------------------------------------------------

    #[test]
    fn sweep_is_system_only_remove_only_and_last_holder_wins() {
        let mut db = ready_db();
        let (event_id, host_id) = create_event(&mut db, "alice");
        // Give the host an expiry in the past and seat a guest with a past expiry.
        db.conn
            .execute(
                "UPDATE event_members SET expiresAt = 10 WHERE _id = ?1",
                params![host_id],
            )
            .expect("expire host");
        // Open-join carol, then expire her too.
        let mut carol = Map::new();
        carol.insert("userId".to_owned(), json!("carol"));
        carol.insert("eventId".to_owned(), json!(event_id));
        carol.insert("role".to_owned(), json!("guest"));
        let plan = db
            .plan_membership_insert(&user("carol"), "event_members", carol)
            .expect("carol join");
        db.commit_membership_plan(&user("carol"), plan).expect("carol commit");
        let carol_id = member_id(&db, &event_id, "carol");
        db.conn
            .execute(
                "UPDATE event_members SET expiresAt = 10 WHERE _id = ?1",
                params![carol_id],
            )
            .expect("expire carol");

        // A user authority cannot sweep.
        let error = db
            .plan_membership_sweep_expired(&user("alice"), "event_members", 1000)
            .expect_err("user cannot sweep");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MEMBERSHIP_SWEEP_AUTHORITY");

        // System sweeps: carol (guest, expired) is removed; the host is skipped
        // because lastHolder wins over expiry.
        let plan = db
            .plan_membership_sweep_expired(&MembershipWriter::System, "event_members", 1000)
            .expect("sweep plan");
        assert_eq!(plan.skipped_protected(), std::slice::from_ref(&host_id));
        let before_sweep = db.authorization_version().expect("pre-sweep version");
        let sweep = db
            .commit_membership_plan(&MembershipWriter::System, plan)
            .expect("sweep commit");
        let authorization = sweep.authorization.expect("sweep witness");
        assert!(authorization.event, "expiry removal is event 1");
        assert_eq!(
            authorization.membership_declarations,
            vec!["event_members".to_owned()]
        );
        assert_eq!(authorization.version.epoch, before_sweep.epoch + 1);
        let sweep_record = db
            .membership_transition_log("event_members")
            .unwrap()
            .into_iter()
            .find(|record| record.principal == "carol" && record.op == "remove")
            .expect("expiry removal is durably attributed");
        assert_eq!(sweep_record.actor, "system");
        assert_eq!(sweep_record.writer_class, "system");
        assert_eq!(role_of(&db, &carol_id), None, "expired guest swept");
        assert_eq!(role_of(&db, &host_id).as_deref(), Some("host"), "protected host survives expiry");
    }
}
