//! Agent-safe in-app forks, exact diffs, and strict promotion by re-execution.
//!
//! This module is the LLP 0164 replacement for the disabled post-image P3
//! spike in [`crate::branches`]. A promotable branch retains replay inputs and
//! independently observed facts. Promotion invokes application commands again
//! inside one hidden canonical transaction; no API accepts an `OverlayWrite`
//! or other branch post-image as a promotion input.
//!
//! `DenyAll` records bounded payload-free refusal markers. `CaptureOnly`
//! records ordered payload-free intents and promotes them into a canonical
//! pending-settlement ledger; neither policy initiates real egress in a fork.
//!
//! @ref LLP 0164#contract-summary-normative-details-per-llp-0162-3-5 — the
//!   in-app branch, diff, sealed request, strict-CAS replay, and contention
//!   contracts implemented here.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{
    Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior, params,
    params_from_iter,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::branches::{
    BranchId, BranchRecord, BranchState, ChildStreamId, MaterializedBase, allocate_child_version,
    child_current_version, create_branch, ensure_branch_registry, get_branch,
};
use crate::commit_envelope::{
    CommitEnvelopeV1, EffectEgressFamilyV1,
    EffectSettlementCapabilityV1 as EnvelopeEffectSettlementCapabilityV1, EnvelopeAuthorityFactsV1,
    EnvelopeCoverageV1, EnvelopeEffectFactsV1, EnvelopeFactSetV1, FactProvenanceV1, LaneFactV1,
    OperationIdentityV1, OperationOriginatorClassV1, OperationReceiptStateV1, OperationReceiptV1,
    RetainedEnvelopeDetailV1, SnapshotAssociationKindV1, StreamQualifiedVersionV1,
};
pub use crate::contract_types::ForkEgressPolicyV1;
use crate::diagnostic::{Diagnostic, SnapbackError, SnapbackResult};
use crate::proof_checkpoint::{
    BoundaryProofV1, BoundaryRowV1, PromotionApprovedWriteV1, PromotionDigestHeaderV1,
    PromotionWriteKindV1, derive_promotion_expected_digest, promotion_boundary_digest,
};

const SHA256_PATTERN: &str = "^sha256:[0-9a-f]{64}$";
const PROMOTION_WRITER_LANE_V1: &str = "ordinaryMutation";
const PROMOTION_COVERAGE_GAP_V1: &str = "promotionCoverageManifest";
/// A legacy branch receipt that predates explicit digest-work accounting is
/// admitted only under this finite ceiling. New issuers always serialize the
/// caller's explicit value, and no v1 request may exceed this hard cap.
pub const BRANCH_MAX_DIGEST_WORK_BYTES_V1: u64 = 64 * 1024 * 1024;

fn legacy_branch_max_digest_work_bytes_v1() -> u64 {
    BRANCH_MAX_DIGEST_WORK_BYTES_V1
}

#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static MANAGED_CREATE_AFTER_PROFILE_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(None) };
    static MANAGED_REAP_AFTER_TRANSITION_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(any(test, feature = "test-support"))]
fn install_managed_create_after_profile_hook(hook: impl FnOnce() + 'static) {
    MANAGED_CREATE_AFTER_PROFILE_HOOK.with(|slot| {
        assert!(slot.borrow().is_none(), "managed create hook is one-shot");
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

#[cfg(any(test, feature = "test-support"))]
fn install_managed_reap_after_transition_hook(hook: impl FnOnce() + 'static) {
    MANAGED_REAP_AFTER_TRANSITION_HOOK.with(|slot| {
        assert!(slot.borrow().is_none(), "managed reap hook is one-shot");
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

fn run_managed_create_after_profile_hook() {
    #[cfg(any(test, feature = "test-support"))]
    MANAGED_CREATE_AFTER_PROFILE_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

fn run_managed_reap_after_transition_hook() {
    #[cfg(any(test, feature = "test-support"))]
    MANAGED_REAP_AFTER_TRANSITION_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

fn error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::new(Diagnostic::error(code, "storage", message))
}

fn json_bytes<T: Serialize>(value: &T, what: &str) -> SnapbackResult<Vec<u8>> {
    let value = serde_json::to_value(value).map_err(|cause| {
        error(
            "SNAPBACK_BRANCH_ARTIFACT_INVALID",
            format!("serialize {what}: {cause}"),
        )
    })?;
    serde_json::to_vec(&canonicalize_json(value)).map_err(|cause| {
        error(
            "SNAPBACK_BRANCH_ARTIFACT_INVALID",
            format!("encode {what}: {cause}"),
        )
    })
}

struct DigestWorkCounter {
    limit: u64,
    written: u64,
    exceeded: bool,
}

impl Write for DigestWorkCounter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let next = self.written.checked_add(bytes.len() as u64);
        if next.is_none_or(|next| next > self.limit) {
            self.exceeded = true;
            return Err(io::Error::other("fork diff digest-work limit exceeded"));
        }
        self.written = next.expect("checked above");
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn bounded_digest_work_bytes<T: Serialize>(value: &T, limit: u64) -> SnapbackResult<u64> {
    let mut counter = DigestWorkCounter {
        limit,
        written: 0,
        exceeded: false,
    };
    match serde_json::to_writer(&mut counter, value) {
        Ok(()) => Ok(counter.written),
        Err(_) if counter.exceeded => Err(error(
            "SNAPBACK_BRANCH_DIGEST_WORK_LIMIT_EXCEEDED",
            "exact diff exceeds the branch's declared digest-work byte bound",
        )),
        Err(cause) => Err(error(
            "SNAPBACK_BRANCH_ARTIFACT_INVALID",
            format!("serialize exact fork diff work set: {cause}"),
        )),
    }
}

fn decode_json<T: for<'de> Deserialize<'de>>(bytes: &[u8], what: &str) -> SnapbackResult<T> {
    serde_json::from_slice(bytes).map_err(|cause| {
        error(
            "SNAPBACK_BRANCH_ARTIFACT_INVALID",
            format!("decode {what}: {cause}"),
        )
    })
}

fn canonicalize_json(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(canonicalize_json).collect()),
        Value::Object(values) => {
            let sorted: BTreeMap<_, _> = values
                .into_iter()
                .map(|(key, value)| (key, canonicalize_json(value)))
                .collect();
            Value::Object(sorted.into_iter().collect())
        }
        scalar => scalar,
    }
}

fn digest_bytes(domain: &[u8], bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"snapback:fork-promotion:v1\n");
    digest.update((domain.len() as u64).to_be_bytes());
    digest.update(domain);
    digest.update((bytes.len() as u64).to_be_bytes());
    digest.update(bytes);
    format!("sha256:{:x}", digest.finalize())
}

fn digest_json<T: Serialize>(domain: &[u8], value: &T) -> SnapbackResult<String> {
    Ok(digest_bytes(domain, &json_bytes(value, "digest input")?))
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> String {
    // RFC 2104 HMAC, kept local to avoid adding a second crypto dependency.
    const BLOCK: usize = 64;
    let mut normalized = [0_u8; BLOCK];
    if key.len() > BLOCK {
        normalized[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        normalized[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36_u8; BLOCK];
    let mut outer_pad = [0x5c_u8; BLOCK];
    for index in 0..BLOCK {
        inner_pad[index] ^= normalized[index];
        outer_pad[index] ^= normalized[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner);
    format!("sha256:{:x}", outer.finalize())
}

#[derive(Clone, Debug)]
pub struct PromotionSealKey(Vec<u8>);

impl PromotionSealKey {
    pub fn from_server_secret(secret: impl AsRef<[u8]>) -> SnapbackResult<Self> {
        let secret = secret.as_ref();
        if secret.len() < 32 {
            return Err(error(
                "SNAPBACK_PROMOTION_SEAL_KEY_INVALID",
                "promotion seal keys must contain at least 32 bytes",
            ));
        }
        Ok(Self(secret.to_vec()))
    }
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchGrantV1 {
    pub principal_id: String,
    pub grant_id: String,
    pub audience: String,
    #[schemars(pattern(SHA256_PATTERN))]
    pub authority_fingerprint: String,
    /// Closed allowlists inherited from the creator's current grant. Empty
    /// means no authority, never wildcard authority.
    pub allowed_functions: Vec<String>,
    pub allowed_lanes: Vec<String>,
    pub expires_at_ms: i64,
}

/// Derive the compared authority fact stored in a branch-scoped grant. The
/// caller supplies only server-resolved identities; no bearer or token bytes
/// enter the digest preimage or branch database.
pub fn derive_branch_authority_fingerprint(
    principal_id: &str,
    grant_id: &str,
    audience: &str,
) -> SnapbackResult<String> {
    digest_json(
        b"branch-scoped-authority",
        &(principal_id, grant_id, audience),
    )
}

pub fn derive_branch_principal_fingerprint(principal_id: &str) -> SnapbackResult<String> {
    digest_json(
        b"managed-branch-principal-v1",
        &json!({"principalId": principal_id}),
    )
}

pub fn derive_branch_input_fingerprint(
    function: &str,
    arguments: &Value,
) -> SnapbackResult<String> {
    digest_json(
        b"managed-branch-operation-input-v1",
        &json!({"function": function, "args": arguments}),
    )
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchLimitsV1 {
    pub max_live_branches_per_principal: u64,
    pub max_live_branches_per_app: u64,
    pub max_operations: u64,
    pub max_retained_bytes: u64,
    pub max_diff_rows: u64,
    /// Maximum canonical JSON bytes admitted to one exact-diff derivation.
    /// This bounds the base/head oracle, retained journal, attribution, and
    /// net-diff inputs before the receipt digest is computed.
    #[serde(default = "legacy_branch_max_digest_work_bytes_v1")]
    #[schemars(range(min = 1, max = 67108864))]
    pub max_digest_work_bytes: u64,
    pub ttl_ms: i64,
}

impl BranchLimitsV1 {
    fn validate(&self) -> SnapbackResult<()> {
        if self.max_live_branches_per_principal == 0
            || self.max_live_branches_per_app == 0
            || self.max_operations == 0
            || self.max_retained_bytes == 0
            || self.max_diff_rows == 0
            || self.max_digest_work_bytes == 0
            || self.max_digest_work_bytes > BRANCH_MAX_DIGEST_WORK_BYTES_V1
            || self.ttl_ms <= 0
        {
            return Err(error(
                "SNAPBACK_BRANCH_LIMIT_INVALID",
                "branch operation, retained-byte, diff-row, digest-work, and TTL limits must be positive and digest work must fit the v1 hard ceiling",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkCoverageV1 {
    pub covered_lanes: Vec<String>,
    pub uncovered_lanes: Vec<String>,
    pub schema_covered: bool,
    pub system_fields_covered: bool,
    pub assets_covered: bool,
    pub effects_covered: bool,
}

impl ForkCoverageV1 {
    fn normalized(mut self) -> Self {
        self.covered_lanes.sort();
        self.covered_lanes.dedup();
        self.uncovered_lanes.sort();
        self.uncovered_lanes.dedup();
        self
    }

    pub fn digest(&self) -> SnapbackResult<String> {
        digest_json(b"coverage-manifest", &self.clone().normalized())
    }
}

/// Exact parent artifacts frozen when a managed in-app branch is created.
/// The writable database copy already pins the schema bytes; this binding also
/// prevents a later parent function/schema reload from silently changing the
/// handler generation used by an existing branch.
#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchArtifactBindingV1 {
    #[schemars(pattern(SHA256_PATTERN))]
    pub schema_hash: String,
    #[schemars(pattern(SHA256_PATTERN))]
    pub function_bundle_hash: String,
}

impl BranchArtifactBindingV1 {
    fn validate(&self) -> SnapbackResult<()> {
        if !is_sha256_digest(&self.schema_hash) || !is_sha256_digest(&self.function_bundle_hash) {
            return Err(error(
                "SNAPBACK_BRANCH_ARTIFACT_IDENTITY_MISSING",
                "managed branch creation requires canonical sha256 schema and function bundle identities",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InAppBranchCreateV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub branch_id: BranchId,
    pub child_stream_id: ChildStreamId,
    pub base_stream: String,
    pub base_version: u64,
    pub artifact_binding: BranchArtifactBindingV1,
    pub grant: BranchGrantV1,
    pub limits: BranchLimitsV1,
    pub coverage: ForkCoverageV1,
    pub egress_policy: ForkEgressPolicyV1,
    pub created_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InAppBranchReceiptV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub branch: BranchRecord,
    pub artifact_binding: BranchArtifactBindingV1,
    pub grant: BranchGrantV1,
    pub limits: BranchLimitsV1,
    pub coverage: ForkCoverageV1,
    pub egress_policy: ForkEgressPolicyV1,
    pub promotable: bool,
    pub foreclosed_by_operation_id: Option<String>,
    pub retained_operation_count: u64,
    pub retained_operation_bytes: u64,
    pub deny_all_attempt_count: u64,
}

pub(crate) fn ensure_in_app_branch_tables(conn: &Connection) -> SnapbackResult<()> {
    ensure_branch_registry(conn)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _snapback_in_app_branch_profiles (
            branch_id                       TEXT PRIMARY KEY
                                              REFERENCES _snapback_branches(branch_id)
                                              ON DELETE CASCADE,
            owner_principal_id              TEXT NOT NULL,
            audience                        TEXT NOT NULL,
            profile_json                    BLOB NOT NULL,
            promotable                      INTEGER NOT NULL,
            foreclosed_by_operation_id      TEXT,
            retained_operation_count        INTEGER NOT NULL DEFAULT 0,
            retained_operation_bytes        INTEGER NOT NULL DEFAULT 0,
            deny_all_attempt_count           INTEGER NOT NULL DEFAULT 0
         );
         CREATE INDEX IF NOT EXISTS _snapback_in_app_branch_by_owner
           ON _snapback_in_app_branch_profiles(owner_principal_id);
         CREATE INDEX IF NOT EXISTS _snapback_in_app_branch_by_audience
           ON _snapback_in_app_branch_profiles(audience);
         CREATE TABLE IF NOT EXISTS _snapback_branch_operations (
            child_version  INTEGER PRIMARY KEY,
            branch_id      TEXT NOT NULL,
            operation_id   TEXT NOT NULL,
            record_json    BLOB NOT NULL,
            record_bytes   INTEGER NOT NULL,
            recorded_at_ms INTEGER NOT NULL,
            UNIQUE(branch_id, operation_id)
         );
         CREATE INDEX IF NOT EXISTS _snapback_branch_operations_by_branch_version
           ON _snapback_branch_operations(branch_id, child_version);
         CREATE TABLE IF NOT EXISTS _snapback_branch_operation_reservations (
            branch_id      TEXT NOT NULL,
            operation_id   TEXT NOT NULL,
            draft_json     BLOB NOT NULL,
            reserved_at_ms INTEGER NOT NULL,
            PRIMARY KEY(branch_id, operation_id)
         );
         CREATE TABLE IF NOT EXISTS _snapback_branch_egress_attempts (
            marker_id      TEXT PRIMARY KEY,
            branch_id      TEXT NOT NULL,
            operation_id   TEXT,
            egress_class   TEXT NOT NULL,
            attempted_at_ms INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS _snapback_branch_egress_by_branch
           ON _snapback_branch_egress_attempts(branch_id, attempted_at_ms);
         CREATE TABLE IF NOT EXISTS _snapback_branch_effect_intents_v1 (
            intent_id              TEXT PRIMARY KEY,
            branch_id              TEXT NOT NULL,
            operation_id           TEXT NOT NULL,
            effect_ordinal         INTEGER NOT NULL,
            child_version          INTEGER,
            egress_class           TEXT NOT NULL,
            settlement_capability  TEXT NOT NULL,
            idempotency_key        TEXT NOT NULL,
            principal_id           TEXT NOT NULL,
            grant_id               TEXT NOT NULL,
            authority_fingerprint  TEXT NOT NULL,
            state                  TEXT NOT NULL,
            captured_at_ms         INTEGER NOT NULL,
            UNIQUE(branch_id, operation_id, effect_ordinal)
         );
         CREATE INDEX IF NOT EXISTS _snapback_branch_effect_intents_by_branch
           ON _snapback_branch_effect_intents_v1(branch_id, child_version);",
    )?;
    Ok(())
}

/// Create a current-head, bounded, branch-scoped in-app fork. Both policies
/// remain publication-gated; accepting CaptureOnly here activates only its
/// durable internal carrier and does not advertise a capability.
pub(crate) fn create_in_app_branch(
    conn: &mut Connection,
    request: &InAppBranchCreateV1,
) -> SnapbackResult<InAppBranchReceiptV1> {
    if request.schema_version != 1 {
        return Err(error(
            "SNAPBACK_BRANCH_SCHEMA_VERSION_UNSUPPORTED",
            "in-app branch request schemaVersion must be 1",
        ));
    }
    request.artifact_binding.validate()?;
    request.limits.validate()?;
    if request.grant.expires_at_ms <= request.created_at_ms {
        return Err(error(
            "SNAPBACK_BRANCH_GRANT_STALE",
            "branch grant is expired at creation",
        ));
    }
    let current = crate::storage::current_version_on(conn)?;
    if request.base_version != current {
        return Err(error(
            "SNAPBACK_BRANCH_BASE_NOT_CURRENT",
            format!(
                "in-app branches must fork current head: requested {}, current {current}",
                request.base_version
            ),
        ));
    }
    ensure_in_app_branch_tables(conn)?;
    let live_for_principal: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _snapback_in_app_branch_profiles p
          JOIN _snapback_branches b ON b.branch_id = p.branch_id
         WHERE p.owner_principal_id = ?1 AND b.state = 'active'",
        params![request.grant.principal_id],
        |row| row.get(0),
    )?;
    let live_for_app: i64 = conn.query_row(
        "SELECT COUNT(*) FROM _snapback_in_app_branch_profiles p
          JOIN _snapback_branches b ON b.branch_id = p.branch_id
         WHERE p.audience = ?1 AND b.state = 'active'",
        params![request.grant.audience],
        |row| row.get(0),
    )?;
    if live_for_principal.max(0) as u64 >= request.limits.max_live_branches_per_principal
        || live_for_app.max(0) as u64 >= request.limits.max_live_branches_per_app
    {
        return Err(error(
            "SNAPBACK_BRANCH_LIVE_LIMIT_EXCEEDED",
            "per-principal or per-app live branch limit reached",
        ));
    }
    let tx = conn.transaction()?;
    let branch = create_branch(
        &tx,
        &request.branch_id,
        &request.child_stream_id,
        &request.base_stream,
        request.base_version,
        request.created_at_ms,
        Some(request.limits.ttl_ms),
    )?;
    let profile_json = json_bytes(request, "branch profile")?;
    tx.execute(
        "INSERT INTO _snapback_in_app_branch_profiles
           (branch_id, owner_principal_id, audience, profile_json, promotable)
         VALUES (?1, ?2, ?3, ?4, 1)",
        params![
            request.branch_id.0,
            request.grant.principal_id,
            request.grant.audience,
            profile_json,
        ],
    )?;
    tx.commit()?;
    Ok(InAppBranchReceiptV1 {
        schema_version: 1,
        branch,
        artifact_binding: request.artifact_binding.clone(),
        grant: request.grant.clone(),
        limits: request.limits.clone(),
        coverage: request.coverage.clone().normalized(),
        egress_policy: request.egress_policy,
        promotable: true,
        foreclosed_by_operation_id: None,
        retained_operation_count: 0,
        retained_operation_bytes: 0,
        deny_all_attempt_count: 0,
    })
}

fn branch_profile(
    conn: &Connection,
    branch_id: &BranchId,
) -> SnapbackResult<(InAppBranchCreateV1, InAppBranchReceiptV1)> {
    ensure_in_app_branch_tables(conn)?;
    type BranchProfileRow = (Vec<u8>, i64, Option<String>, i64, i64, i64);
    let row: Option<BranchProfileRow> = conn
        .query_row(
            "SELECT profile_json, promotable, foreclosed_by_operation_id,
                    retained_operation_count, retained_operation_bytes,
                    deny_all_attempt_count
               FROM _snapback_in_app_branch_profiles WHERE branch_id = ?1",
            params![branch_id.0],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()?;
    let (bytes, promotable, foreclosed, operations, retained_bytes, attempts) =
        row.ok_or_else(|| {
            error(
                "SNAPBACK_BRANCH_PROFILE_MISSING",
                format!("in-app branch profile {:?} is missing", branch_id.0),
            )
        })?;
    let profile: InAppBranchCreateV1 = decode_json(&bytes, "branch profile")?;
    let branch = get_branch(conn, branch_id)?.ok_or_else(|| {
        error(
            "SNAPBACK_BRANCH_NOT_FOUND",
            format!("branch {:?} is not registered", branch_id.0),
        )
    })?;
    Ok((
        profile.clone(),
        InAppBranchReceiptV1 {
            schema_version: 1,
            branch,
            artifact_binding: profile.artifact_binding.clone(),
            grant: profile.grant,
            limits: profile.limits,
            coverage: profile.coverage.normalized(),
            egress_policy: profile.egress_policy,
            promotable: promotable != 0,
            foreclosed_by_operation_id: foreclosed,
            retained_operation_count: operations.max(0) as u64,
            retained_operation_bytes: retained_bytes.max(0) as u64,
            deny_all_attempt_count: attempts.max(0) as u64,
        },
    ))
}

pub(crate) fn inspect_in_app_branch(
    conn: &Connection,
    branch_id: &BranchId,
) -> SnapbackResult<InAppBranchReceiptV1> {
    branch_profile(conn, branch_id).map(|(_, receipt)| receipt)
}

/// Canonical custody state for an on-disk in-app branch workspace. This is
/// deliberately separate from the branch-local state machine: canonical owns
/// enumeration and teardown, while the isolated head owns branch operations,
/// egress markers, and the child stream.
#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ManagedBranchStateV1 {
    Creating,
    Active,
    TearingDown,
    Dropped,
}

impl ManagedBranchStateV1 {
    fn parse(value: &str) -> SnapbackResult<Self> {
        match value {
            "creating" => Ok(Self::Creating),
            "active" => Ok(Self::Active),
            "tearing_down" => Ok(Self::TearingDown),
            "dropped" => Ok(Self::Dropped),
            _ => Err(error(
                "SNAPBACK_BRANCH_CUSTODY_INVALID",
                "managed branch custody contains an unknown state",
            )),
        }
    }
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedInAppBranchReceiptV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub branch: InAppBranchReceiptV1,
    pub custody_state: ManagedBranchStateV1,
}

fn ensure_managed_branch_custody(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _snapback_in_app_branch_custody_v1 (
           branch_id          TEXT PRIMARY KEY,
           owner_principal_id TEXT NOT NULL,
           audience           TEXT NOT NULL,
           workspace_name     TEXT NOT NULL UNIQUE,
           profile_json       BLOB NOT NULL,
           state              TEXT NOT NULL,
           created_at_ms      INTEGER NOT NULL,
           dropped_at_ms      INTEGER
         );
         CREATE INDEX IF NOT EXISTS _snapback_in_app_branch_custody_owner
           ON _snapback_in_app_branch_custody_v1(owner_principal_id, state);
         CREATE INDEX IF NOT EXISTS _snapback_in_app_branch_custody_audience
           ON _snapback_in_app_branch_custody_v1(audience, state);",
    )?;
    Ok(())
}

fn require_canonical_path_binding(
    canonical: &Connection,
    supplied_path: &Path,
) -> SnapbackResult<PathBuf> {
    if fs::symlink_metadata(supplied_path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(error(
            "SNAPBACK_BRANCH_CUSTODY_PATH_MISMATCH",
            "canonical database custody refuses a symlink path",
        ));
    }
    let sqlite_path: String = canonical.query_row(
        "SELECT file FROM pragma_database_list WHERE name = 'main'",
        [],
        |row| row.get(0),
    )?;
    if sqlite_path.is_empty() {
        return Err(error(
            "SNAPBACK_BRANCH_FILE_CUSTODY_REQUIRED",
            "managed in-app branches require a file-backed canonical database",
        ));
    }
    let supplied = supplied_path.canonicalize().map_err(|cause| {
        error(
            "SNAPBACK_BRANCH_CUSTODY_PATH_MISMATCH",
            format!("canonicalize supplied database path: {cause}"),
        )
    })?;
    let sqlite = Path::new(&sqlite_path).canonicalize().map_err(|cause| {
        error(
            "SNAPBACK_BRANCH_CUSTODY_PATH_MISMATCH",
            format!("canonicalize SQLite main database path: {cause}"),
        )
    })?;
    if supplied != sqlite {
        return Err(error(
            "SNAPBACK_BRANCH_CUSTODY_PATH_MISMATCH",
            "supplied custody path is not SQLite's open main database",
        ));
    }
    Ok(sqlite)
}

pub fn managed_branch_root(canonical_path: &Path) -> SnapbackResult<PathBuf> {
    let file_name = canonical_path.file_name().ok_or_else(|| {
        error(
            "SNAPBACK_BRANCH_CUSTODY_INVALID",
            "canonical database path has no file name",
        )
    })?;
    let parent = canonical_path.parent().ok_or_else(|| {
        error(
            "SNAPBACK_BRANCH_CUSTODY_INVALID",
            "canonical database path has no parent directory",
        )
    })?;
    let root = parent.join(format!(
        ".{}.in-app-branches-v1",
        file_name.to_string_lossy()
    ));
    match fs::symlink_metadata(&root) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(error(
                "SNAPBACK_BRANCH_CUSTODY_INVALID",
                "managed branch root must be a real directory, not a symlink or non-directory",
            ));
        }
        Ok(_) => {}
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&root).map_err(|cause| {
                error(
                    "SNAPBACK_BRANCH_CUSTODY_FAILED",
                    format!("create managed branch root: {cause}"),
                )
            })?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).map_err(|cause| {
                    error(
                        "SNAPBACK_BRANCH_CUSTODY_FAILED",
                        format!("protect managed branch root: {cause}"),
                    )
                })?;
            }
        }
        Err(cause) => {
            return Err(error(
                "SNAPBACK_BRANCH_CUSTODY_FAILED",
                format!("inspect managed branch root: {cause}"),
            ));
        }
    }
    Ok(root)
}

fn managed_workspace_name(branch_id: &BranchId) -> String {
    let digest = digest_bytes(b"managed-branch-workspace-name", branch_id.0.as_bytes());
    format!("branch-{}.sqlite", digest.trim_start_matches("sha256:"))
}

fn managed_workspace_path(canonical_path: &Path, branch_id: &BranchId) -> SnapbackResult<PathBuf> {
    Ok(managed_branch_root(canonical_path)?.join(managed_workspace_name(branch_id)))
}

/// Return the server-derived writable-head path only after the canonical
/// custody row, local profile, immutable base, state, and expiry have all
/// re-bound successfully.
pub(crate) fn managed_in_app_branch_path(
    canonical: &Connection,
    canonical_path: &Path,
    branch_id: &BranchId,
    now_ms: i64,
) -> SnapbackResult<PathBuf> {
    let workspace = open_managed_in_app_branch(canonical, canonical_path, branch_id, now_ms)?;
    drop(workspace);
    managed_workspace_path(canonical_path, branch_id)
}

fn managed_workspace_files(path: &Path) -> Vec<PathBuf> {
    let append = |suffix: &str| {
        let mut value = path.as_os_str().to_os_string();
        value.push(suffix);
        PathBuf::from(value)
    };
    vec![
        path.to_path_buf(),
        append("-wal"),
        append("-shm"),
        append(".immutable-base"),
        append(".immutable-base-wal"),
        append(".immutable-base-shm"),
        crate::operation_detail::keyring_path(path),
    ]
}

fn remove_managed_workspace_files(path: &Path) -> SnapbackResult<()> {
    for file in managed_workspace_files(path) {
        match fs::remove_file(&file) {
            Ok(()) => {}
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {}
            Err(cause) => {
                return Err(error(
                    "SNAPBACK_BRANCH_CUSTODY_FAILED",
                    format!("remove managed workspace file {file:?}: {cause}"),
                ));
            }
        }
    }
    Ok(())
}

fn reconcile_incomplete_managed_branches(
    canonical: &mut Connection,
    canonical_path: &Path,
) -> SnapbackResult<()> {
    ensure_managed_branch_custody(canonical)?;
    let mut statement = canonical.prepare(
        "SELECT branch_id, state FROM _snapback_in_app_branch_custody_v1
          WHERE state IN ('creating', 'tearing_down') ORDER BY branch_id",
    )?;
    let ids = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    for (id, state) in ids {
        let branch_id = BranchId(id);
        let path = managed_workspace_path(canonical_path, &branch_id)?;
        // A creating row was never published, and a tearing-down row already
        // stopped admitting work. Exact-file teardown is safe whether the
        // crash occurred before materialization, after profile commit, or
        // after the durable expiry transition but before file deletion.
        remove_managed_workspace_files(&path)?;
        canonical.execute(
            "UPDATE _snapback_in_app_branch_custody_v1 SET state = 'dropped'
              WHERE branch_id = ?1 AND state = ?2",
            params![branch_id.0, state],
        )?;
    }
    Ok(())
}

fn managed_branch_expiry(profile: &InAppBranchCreateV1) -> SnapbackResult<i64> {
    let ttl_expiry = profile
        .created_at_ms
        .checked_add(profile.limits.ttl_ms)
        .ok_or_else(|| error("SNAPBACK_BRANCH_LIMIT_INVALID", "branch TTL overflow"))?;
    Ok(ttl_expiry.min(profile.grant.expires_at_ms))
}

fn dropped_managed_receipt(profile: InAppBranchCreateV1) -> ManagedInAppBranchReceiptV1 {
    ManagedInAppBranchReceiptV1 {
        schema_version: 1,
        branch: InAppBranchReceiptV1 {
            schema_version: 1,
            branch: BranchRecord {
                branch_id: profile.branch_id,
                child_stream_id: profile.child_stream_id,
                base_version: profile.base_version,
                base_stream: profile.base_stream,
                state: BranchState::TearingDown,
                created_at_ms: profile.created_at_ms,
                ttl_ms: Some(profile.limits.ttl_ms),
            },
            artifact_binding: profile.artifact_binding,
            grant: profile.grant,
            limits: profile.limits,
            coverage: profile.coverage.normalized(),
            egress_policy: profile.egress_policy,
            promotable: false,
            foreclosed_by_operation_id: None,
            retained_operation_count: 0,
            retained_operation_bytes: 0,
            deny_all_attempt_count: 0,
        },
        custody_state: ManagedBranchStateV1::Dropped,
    }
}

fn reap_expired_managed_branches_bound(
    canonical: &mut Connection,
    canonical_path: &Path,
    now_ms: i64,
) -> SnapbackResult<Vec<ManagedInAppBranchReceiptV1>> {
    reconcile_incomplete_managed_branches(canonical, canonical_path)?;
    let mut statement = canonical.prepare(
        "SELECT branch_id, profile_json FROM _snapback_in_app_branch_custody_v1
          WHERE state = 'active' ORDER BY created_at_ms, branch_id",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);

    let mut reaped = Vec::new();
    for (id, bytes) in rows {
        let profile: InAppBranchCreateV1 = decode_json(&bytes, "managed branch custody profile")?;
        if profile.branch_id.0 != id || now_ms < managed_branch_expiry(&profile)? {
            continue;
        }
        let path = managed_workspace_path(canonical_path, &profile.branch_id)?;
        let branch = MaterializedBase::reopen(&path)
            .and_then(|workspace| inspect_in_app_branch(&workspace.conn, &profile.branch_id))
            .ok();
        let changed = canonical.execute(
            "UPDATE _snapback_in_app_branch_custody_v1 SET state = 'tearing_down'
              WHERE branch_id = ?1 AND state = 'active'",
            params![id],
        )?;
        if changed != 1 {
            return Err(error(
                "SNAPBACK_BRANCH_CUSTODY_INVALID",
                "expired managed branch lost its active custody transition",
            ));
        }
        run_managed_reap_after_transition_hook();
        remove_managed_workspace_files(&path)?;
        canonical.execute(
            "UPDATE _snapback_in_app_branch_custody_v1
                SET state = 'dropped', dropped_at_ms = ?2
              WHERE branch_id = ?1 AND state = 'tearing_down'",
            params![id, now_ms],
        )?;
        reaped.push(match branch {
            Some(branch) => ManagedInAppBranchReceiptV1 {
                schema_version: 1,
                branch: InAppBranchReceiptV1 {
                    branch: BranchRecord {
                        state: BranchState::TearingDown,
                        ..branch.branch
                    },
                    promotable: false,
                    ..branch
                },
                custody_state: ManagedBranchStateV1::Dropped,
            },
            None => dropped_managed_receipt(profile),
        });
    }
    Ok(reaped)
}

/// Reconcile interrupted custody, then deterministically reap every branch
/// whose TTL or branch-scoped grant expires at or before `now_ms`.
pub(crate) fn reap_expired_managed_in_app_branches(
    canonical: &mut Connection,
    canonical_path: &Path,
    now_ms: i64,
) -> SnapbackResult<Vec<ManagedInAppBranchReceiptV1>> {
    let canonical_path = require_canonical_path_binding(canonical, canonical_path)?;
    ensure_managed_branch_custody(canonical)?;
    reap_expired_managed_branches_bound(canonical, &canonical_path, now_ms)
}

fn managed_custody_profile(
    canonical: &Connection,
    branch_id: &BranchId,
) -> SnapbackResult<(InAppBranchCreateV1, ManagedBranchStateV1, String)> {
    ensure_managed_branch_custody(canonical)?;
    let row: Option<(Vec<u8>, String, String)> = canonical
        .query_row(
            "SELECT profile_json, state, workspace_name
               FROM _snapback_in_app_branch_custody_v1 WHERE branch_id = ?1",
            params![branch_id.0],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let (profile, state, workspace_name) = row.ok_or_else(|| {
        error(
            "SNAPBACK_BRANCH_NOT_FOUND",
            "managed in-app branch has no canonical custody record",
        )
    })?;
    Ok((
        decode_json(&profile, "managed branch custody profile")?,
        ManagedBranchStateV1::parse(&state)?,
        workspace_name,
    ))
}

/// Materialize and register one server-named on-disk branch. The canonical
/// custody row enters `creating` before either file is materialized, then
/// becomes `active` only after the branch-local profile is durable. A crash at
/// any intermediate cut therefore leaves an enumerable cleanup obligation,
/// never an unowned workspace or a false active receipt.
///
/// @ref LLP 0162#3-safe-current-head-forks — production custody preserves the
///   exact current-head snapshot and never accepts a caller-chosen path.
pub(crate) fn create_managed_in_app_branch(
    canonical: &mut Connection,
    canonical_path: &Path,
    request: &InAppBranchCreateV1,
) -> SnapbackResult<ManagedInAppBranchReceiptV1> {
    request.limits.validate()?;
    let canonical_path = require_canonical_path_binding(canonical, canonical_path)?;
    ensure_managed_branch_custody(canonical)?;
    reap_expired_managed_branches_bound(canonical, &canonical_path, request.created_at_ms)?;
    let principal_count: i64 = canonical.query_row(
        "SELECT COUNT(*) FROM _snapback_in_app_branch_custody_v1
          WHERE owner_principal_id = ?1 AND state = 'active'",
        params![request.grant.principal_id],
        |row| row.get(0),
    )?;
    let app_count: i64 = canonical.query_row(
        "SELECT COUNT(*) FROM _snapback_in_app_branch_custody_v1
          WHERE audience = ?1 AND state = 'active'",
        params![request.grant.audience],
        |row| row.get(0),
    )?;
    if principal_count.max(0) as u64 >= request.limits.max_live_branches_per_principal
        || app_count.max(0) as u64 >= request.limits.max_live_branches_per_app
    {
        return Err(error(
            "SNAPBACK_BRANCH_LIVE_LIMIT_EXCEEDED",
            "canonical custody reached the per-principal or per-app live branch limit",
        ));
    }
    let current = crate::storage::current_version_on(canonical)?;
    if request.base_version != current {
        return Err(error(
            "SNAPBACK_BRANCH_BASE_NOT_CURRENT",
            "managed branch creation requires the exact current canonical head",
        ));
    }
    let path = managed_workspace_path(&canonical_path, &request.branch_id)?;
    if managed_workspace_files(&path)
        .iter()
        .any(|candidate| candidate.exists())
    {
        return Err(error(
            "SNAPBACK_BRANCH_CUSTODY_COLLISION",
            "server-derived managed branch workspace already exists",
        ));
    }
    let profile_json = json_bytes(request, "managed branch custody profile")?;
    canonical.execute(
        "INSERT INTO _snapback_in_app_branch_custody_v1
           (branch_id, owner_principal_id, audience, workspace_name,
            profile_json, state, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, 'creating', ?6)",
        params![
            request.branch_id.0,
            request.grant.principal_id,
            request.grant.audience,
            managed_workspace_name(&request.branch_id),
            profile_json,
            request.created_at_ms,
        ],
    )?;
    let mut workspace = match MaterializedBase::materialize(canonical, Some(&path)) {
        Ok(workspace) => workspace,
        Err(cause) => {
            let _ = remove_managed_workspace_files(&path);
            let _ = canonical.execute(
                "UPDATE _snapback_in_app_branch_custody_v1 SET state = 'dropped'
                  WHERE branch_id = ?1 AND state = 'creating'",
                params![request.branch_id.0],
            );
            return Err(cause);
        }
    };
    if let Err(cause) =
        crate::instance_fork::scrub_copied_authority_for_in_app_branch(&mut workspace.conn)
    {
        let _ = workspace.teardown();
        let _ = canonical.execute(
            "UPDATE _snapback_in_app_branch_custody_v1 SET state = 'dropped'
              WHERE branch_id = ?1 AND state = 'creating'",
            params![request.branch_id.0],
        );
        return Err(cause);
    }
    if let Err(cause) = crate::operation_detail::mint_new_sidecar(&path)
        .and_then(|()| crate::operation_detail::install(&workspace.conn, Some(&path)))
    {
        let _ = workspace.teardown();
        let _ = canonical.execute(
            "UPDATE _snapback_in_app_branch_custody_v1 SET state = 'dropped'
              WHERE branch_id = ?1 AND state = 'creating'",
            params![request.branch_id.0],
        );
        return Err(cause);
    }
    let branch = match create_in_app_branch(&mut workspace.conn, request) {
        Ok(receipt) => receipt,
        Err(cause) => {
            let _ = workspace.teardown();
            let _ = canonical.execute(
                "UPDATE _snapback_in_app_branch_custody_v1 SET state = 'dropped'
                  WHERE branch_id = ?1 AND state = 'creating'",
                params![request.branch_id.0],
            );
            return Err(cause);
        }
    };
    run_managed_create_after_profile_hook();
    let activated = canonical.execute(
        "UPDATE _snapback_in_app_branch_custody_v1 SET state = 'active'
          WHERE branch_id = ?1 AND state = 'creating'",
        params![request.branch_id.0],
    )?;
    if activated != 1 {
        let _ = workspace.teardown();
        return Err(error(
            "SNAPBACK_BRANCH_CUSTODY_INVALID",
            "managed branch lost its creating custody row before activation",
        ));
    }
    drop(workspace);
    Ok(ManagedInAppBranchReceiptV1 {
        schema_version: 1,
        branch,
        custody_state: ManagedBranchStateV1::Active,
    })
}

/// Open a canonically enumerated branch and cross-check both its server-derived
/// path and branch-local profile before returning either SQLite handle.
pub(crate) fn open_managed_in_app_branch(
    canonical: &Connection,
    canonical_path: &Path,
    branch_id: &BranchId,
    now_ms: i64,
) -> SnapbackResult<MaterializedBase> {
    let canonical_path = require_canonical_path_binding(canonical, canonical_path)?;
    let (profile, state, workspace_name) = managed_custody_profile(canonical, branch_id)?;
    if state != ManagedBranchStateV1::Active {
        return Err(error(
            "SNAPBACK_BRANCH_NOT_ACTIVE",
            "managed branch custody is not active",
        ));
    }
    if now_ms >= managed_branch_expiry(&profile)? {
        return Err(error(
            "SNAPBACK_BRANCH_EXPIRED",
            "managed branch expired and requires canonical reaping",
        ));
    }
    let expected_name = managed_workspace_name(branch_id);
    if workspace_name != expected_name || profile.branch_id != *branch_id {
        return Err(error(
            "SNAPBACK_BRANCH_CUSTODY_INVALID",
            "managed branch custody does not match its server-derived identity",
        ));
    }
    let path = managed_workspace_path(&canonical_path, branch_id)?;
    let workspace = MaterializedBase::reopen(&path)?;
    let (stored, receipt) = branch_profile(&workspace.conn, branch_id)?;
    if stored != profile
        || receipt.branch.base_version != workspace.base_version
        || receipt.branch.child_stream_id != profile.child_stream_id
    {
        return Err(error(
            "SNAPBACK_BRANCH_CUSTODY_INVALID",
            "branch-local profile or immutable base diverges from canonical custody",
        ));
    }
    Ok(workspace)
}

pub(crate) fn inspect_managed_in_app_branch(
    canonical: &Connection,
    canonical_path: &Path,
    branch_id: &BranchId,
    now_ms: i64,
) -> SnapbackResult<ManagedInAppBranchReceiptV1> {
    let workspace = open_managed_in_app_branch(canonical, canonical_path, branch_id, now_ms)?;
    let branch = inspect_in_app_branch(&workspace.conn, branch_id)?;
    Ok(ManagedInAppBranchReceiptV1 {
        schema_version: 1,
        branch,
        custody_state: ManagedBranchStateV1::Active,
    })
}

pub(crate) fn list_managed_in_app_branches(
    canonical: &Connection,
    canonical_path: &Path,
    now_ms: i64,
) -> SnapbackResult<Vec<ManagedInAppBranchReceiptV1>> {
    let canonical_path = require_canonical_path_binding(canonical, canonical_path)?;
    ensure_managed_branch_custody(canonical)?;
    let incomplete: i64 = canonical.query_row(
        "SELECT COUNT(*) FROM _snapback_in_app_branch_custody_v1
          WHERE state IN ('creating', 'tearing_down')",
        [],
        |row| row.get(0),
    )?;
    if incomplete != 0 {
        return Err(error(
            "SNAPBACK_BRANCH_CUSTODY_RECOVERY_REQUIRED",
            "managed branch creation was interrupted; a mutable owner must reconcile custody",
        ));
    }
    let mut expiry_statement = canonical.prepare(
        "SELECT profile_json FROM _snapback_in_app_branch_custody_v1
          WHERE state = 'active' ORDER BY created_at_ms, branch_id",
    )?;
    let profiles = expiry_statement
        .query_map([], |row| row.get::<_, Vec<u8>>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(expiry_statement);
    for bytes in profiles {
        let profile: InAppBranchCreateV1 = decode_json(&bytes, "managed branch custody profile")?;
        if now_ms >= managed_branch_expiry(&profile)? {
            return Err(error(
                "SNAPBACK_BRANCH_EXPIRY_REAP_REQUIRED",
                "one or more managed branches expired; a mutable owner must reap custody",
            ));
        }
    }
    let mut statement = canonical.prepare(
        "SELECT branch_id FROM _snapback_in_app_branch_custody_v1
          WHERE state = 'active' ORDER BY created_at_ms, branch_id",
    )?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    ids.into_iter()
        .map(|id| inspect_managed_in_app_branch(canonical, &canonical_path, &BranchId(id), now_ms))
        .collect()
}

/// Tear down exactly the server-derived workspace named by canonical custody.
/// The intermediate state is durable so a crash can never make a partially
/// deleted branch look active again.
pub(crate) fn drop_managed_in_app_branch(
    canonical: &mut Connection,
    canonical_path: &Path,
    branch_id: &BranchId,
    now_ms: i64,
) -> SnapbackResult<ManagedInAppBranchReceiptV1> {
    let canonical_path = require_canonical_path_binding(canonical, canonical_path)?;
    let (_, state, _) = managed_custody_profile(canonical, branch_id)?;
    if state == ManagedBranchStateV1::Dropped {
        return Err(error(
            "SNAPBACK_BRANCH_NOT_ACTIVE",
            "managed branch was already dropped",
        ));
    }
    let receipt = if state == ManagedBranchStateV1::Active {
        let workspace = open_managed_in_app_branch(canonical, &canonical_path, branch_id, now_ms)?;
        let branch = inspect_in_app_branch(&workspace.conn, branch_id)?;
        canonical.execute(
            "UPDATE _snapback_in_app_branch_custody_v1 SET state = 'tearing_down'
              WHERE branch_id = ?1 AND state = 'active'",
            params![branch_id.0],
        )?;
        workspace.teardown()?;
        branch
    } else {
        let path = managed_workspace_path(&canonical_path, branch_id)?;
        remove_managed_workspace_files(&path)?;
        let (profile, _, _) = managed_custody_profile(canonical, branch_id)?;
        dropped_managed_receipt(profile).branch
    };
    canonical.execute(
        "UPDATE _snapback_in_app_branch_custody_v1
            SET state = 'dropped', dropped_at_ms = ?2 WHERE branch_id = ?1",
        params![branch_id.0, now_ms],
    )?;
    Ok(ManagedInAppBranchReceiptV1 {
        schema_version: 1,
        branch: InAppBranchReceiptV1 {
            branch: BranchRecord {
                state: BranchState::TearingDown,
                ..receipt.branch
            },
            promotable: false,
            ..receipt
        },
        custody_state: ManagedBranchStateV1::Dropped,
    })
}

/// Boot-time identity for a writable in-app branch head. It is inferred only
/// from the exact branch/profile tables inside that database; zero profiles is
/// canonical, while multiple active profiles is corruption and refuses boot.
#[derive(Clone, Debug)]
pub struct InAppBranchRuntime {
    database_path: PathBuf,
    branch_id: BranchId,
    egress_policy: ForkEgressPolicyV1,
}

pub fn inspect_in_app_branch_boot(
    database_path: &Path,
) -> SnapbackResult<Option<InAppBranchRuntime>> {
    if !database_path.exists() {
        return Ok(None);
    }
    let conn = Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let has_profiles: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_schema
          WHERE type = 'table' AND name = '_snapback_in_app_branch_profiles'",
        [],
        |row| row.get(0),
    )?;
    if has_profiles == 0 {
        return Ok(None);
    }
    let mut statement = conn.prepare(
        "SELECT p.branch_id, p.profile_json
           FROM _snapback_in_app_branch_profiles p
           JOIN _snapback_branches b ON b.branch_id = p.branch_id
          WHERE b.state = 'active' ORDER BY p.branch_id",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    match rows.as_slice() {
        [] => Ok(None),
        [(branch_id, bytes)] => {
            let profile: InAppBranchCreateV1 = decode_json(bytes, "branch boot profile")?;
            if profile.branch_id.0 != *branch_id {
                return Err(error(
                    "SNAPBACK_BRANCH_CUSTODY_INVALID",
                    "branch boot profile does not identify its active head",
                ));
            }
            Ok(Some(InAppBranchRuntime {
                database_path: database_path.to_path_buf(),
                branch_id: profile.branch_id,
                egress_policy: profile.egress_policy,
            }))
        }
        _ => Err(error(
            "SNAPBACK_BRANCH_CUSTODY_INVALID",
            "one database contains multiple active in-app branch profiles",
        )),
    }
}

impl InAppBranchRuntime {
    /// Route the exhaustive product egress inventory through the branch-local
    /// policy. Neither arm accepts a target, body, token, or credential:
    /// DenyAll records a marker and CaptureOnly records a replay intent, then
    /// both stop the real host operation before initiation.
    pub fn mediate(
        &self,
        family: crate::instance_fork::EgressFamily,
        now_ms: u64,
    ) -> SnapbackError {
        match self.egress_policy {
            ForkEgressPolicyV1::DenyAll => {
                let operation_id = next_active_branch_effect_context(&self.branch_id)
                    .map(|(context, _)| context.draft.identity.key.operation_id);
                let result = (|| -> SnapbackResult<()> {
                    let mut conn = Connection::open(&self.database_path)?;
                    deny_egress_attempt(
                        &mut conn,
                        &self.branch_id,
                        operation_id.as_deref(),
                        family.as_str(),
                        now_ms.min(i64::MAX as u64) as i64,
                    )
                })();
                match result {
                    Err(error) if error.diagnostic.code == "SNAPBACK_BRANCH_EGRESS_DENIED" => error,
                    _ => error(
                        "SNAPBACK_BRANCH_EGRESS_MARKER_FAILED",
                        "in-app branch egress was refused but its durable marker could not be recorded",
                    )
                    .with_details(json!({ "family": family.as_str() })),
                }
            }
            ForkEgressPolicyV1::CaptureOnly => {
                let Some((context, effect_ordinal)) =
                    next_active_branch_effect_context(&self.branch_id)
                else {
                    return error(
                        "SNAPBACK_BRANCH_EFFECT_CONTEXT_MISSING",
                        "CaptureOnly refused an unowned host egress initiation",
                    )
                    .with_details(json!({ "family": family.as_str() }));
                };
                let result = (|| -> SnapbackResult<CapturedEffectIntentV1> {
                    let mut conn = Connection::open(&self.database_path)?;
                    capture_effect_intent(&mut conn, &context, family.as_str(), effect_ordinal)
                })();
                match result {
                    Ok(intent) => error(
                        "SNAPBACK_BRANCH_EFFECT_CAPTURED",
                        "CaptureOnly retained a payload-free effect intent and did not initiate egress",
                    )
                    .with_details(json!({
                        "family": family.as_str(),
                        "intentId": intent.intent_id,
                        "effectOrdinal": intent.effect_ordinal,
                    })),
                    Err(cause) => error(
                        "SNAPBACK_BRANCH_EFFECT_CAPTURE_FAILED",
                        "CaptureOnly refused egress because its durable intent could not be recorded",
                    )
                    .with_details(json!({
                        "family": family.as_str(),
                        "causeCode": cause.diagnostic.code,
                    })),
                }
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReplayCustodyClassV1 {
    InlineRedacted,
    ProtectedReference,
    Unretainable,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetainedReplayInputV1 {
    pub name: String,
    pub custody: ReplayCustodyClassV1,
    pub value: Value,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogicalWriteFactV1 {
    pub table_name: String,
    pub row_id: String,
    pub after: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovedOperationFactsV1 {
    pub read_facts: Value,
    pub ctx_answers: Value,
    pub decision: Value,
    pub result: Value,
    pub writes: Vec<LogicalWriteFactV1>,
    pub effects: Vec<Value>,
    pub coverage: ForkCoverageV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchOperationDraftV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub identity: OperationIdentityV1,
    pub artifact_identity: String,
    pub function_or_command: String,
    pub canonical_arguments: Value,
    pub principal_id: String,
    pub grant_id: String,
    pub read_baseline: Value,
    pub replay_inputs: Vec<RetainedReplayInputV1>,
    pub causal_predecessors: Vec<u64>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchOperationV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub branch_id: BranchId,
    pub child_version: u64,
    pub identity: OperationIdentityV1,
    pub artifact_identity: String,
    pub function_or_command: String,
    pub canonical_arguments: Value,
    pub principal_id: String,
    pub grant_id: String,
    pub read_baseline: Value,
    pub replay_inputs: Vec<RetainedReplayInputV1>,
    pub causal_predecessors: Vec<u64>,
    pub approved_facts: ApprovedOperationFactsV1,
    #[schemars(pattern(SHA256_PATTERN))]
    pub approved_facts_digest: String,
    pub recorded_at_ms: i64,
}

/// Server-owned context carried from the closed branch host operation into
/// the ordinary application mutation transaction. The caller never supplies
/// the resulting facts: storage derives them from the exact commit it is
/// about to publish and records the branch operation before that transaction
/// commits.
#[derive(Clone, Debug)]
pub struct BranchMutationCommitV1 {
    pub branch_id: BranchId,
    pub draft: BranchOperationDraftV1,
    pub recorded_at_ms: i64,
}

fn validate_operation_draft(
    profile: &InAppBranchCreateV1,
    branch: &BranchRecord,
    draft: &BranchOperationDraftV1,
    now_ms: i64,
) -> SnapbackResult<()> {
    if draft.schema_version != 1 || draft.identity.validate().is_err() {
        return Err(error(
            "SNAPBACK_BRANCH_OPERATION_INVALID",
            "branch operation identity or schemaVersion is invalid",
        ));
    }
    if branch.state != BranchState::Active {
        return Err(error(
            "SNAPBACK_BRANCH_NOT_ACTIVE",
            "branch admits no work while tearing down",
        ));
    }
    let expiry = profile
        .created_at_ms
        .checked_add(profile.limits.ttl_ms)
        .ok_or_else(|| error("SNAPBACK_BRANCH_LIMIT_INVALID", "branch TTL overflow"))?;
    if now_ms >= expiry {
        return Err(error(
            "SNAPBACK_BRANCH_EXPIRED",
            "branch TTL expired before operation admission",
        ));
    }
    if now_ms >= profile.grant.expires_at_ms
        || draft.principal_id != profile.grant.principal_id
        || draft.grant_id != profile.grant.grant_id
        || draft.identity.bound_facts.audience != profile.grant.audience
        || !profile
            .grant
            .allowed_functions
            .iter()
            .any(|function| function == &draft.function_or_command)
    {
        return Err(error(
            "SNAPBACK_BRANCH_AUTHORITY_DENIED",
            "branch operation is outside the live branch-scoped grant",
        ));
    }
    if draft.identity.key.stream_id != branch.child_stream_id.0 {
        return Err(error(
            "SNAPBACK_BRANCH_STREAM_MISMATCH",
            "branch operation identity is not scoped to the child stream",
        ));
    }
    Ok(())
}

fn validate_public_carrier_draft(
    profile: &InAppBranchCreateV1,
    draft: &BranchOperationDraftV1,
) -> SnapbackResult<()> {
    let expected_authority_fingerprint = derive_branch_authority_fingerprint(
        &profile.grant.principal_id,
        &profile.grant.grant_id,
        &profile.grant.audience,
    )?;
    let expected_principal_fingerprint =
        derive_branch_principal_fingerprint(&profile.grant.principal_id)?;
    let expected_input_fingerprint =
        derive_branch_input_fingerprint(&draft.function_or_command, &draft.canonical_arguments)?;
    let issuance_matches_grant = matches!(
        &draft.identity.issuance,
        crate::commit_envelope::OperationIssuanceV1::HostIncarnation {
            epoch_id,
            authority_authenticator_digest,
            ..
        } if epoch_id == &profile.grant.grant_id
            && authority_authenticator_digest == &profile.grant.authority_fingerprint
    );
    if profile.grant.authority_fingerprint != expected_authority_fingerprint
        || draft.identity.bound_facts.principal_fingerprint != expected_principal_fingerprint
        || draft.identity.bound_facts.authority_instance_id != profile.grant.authority_fingerprint
        || draft.identity.bound_facts.function_or_command != draft.function_or_command
        || draft.identity.bound_facts.input_fingerprint != expected_input_fingerprint
        || !issuance_matches_grant
    {
        return Err(error(
            "SNAPBACK_BRANCH_AUTHORITY_DENIED",
            "public branch carrier facts are not bound to the live branch grant and input",
        ));
    }
    Ok(())
}

/// Execute a branch command and retain its replay inputs and observed facts in
/// the same child-stream transaction as its physical branch writes.
pub(crate) fn execute_branch_operation<F>(
    conn: &mut Connection,
    branch_id: &BranchId,
    draft: &BranchOperationDraftV1,
    now_ms: i64,
    execute: F,
) -> SnapbackResult<BranchOperationV1>
where
    F: FnOnce(
        &Transaction<'_>,
        &BranchOperationDraftV1,
    ) -> SnapbackResult<ApprovedOperationFactsV1>,
{
    let (profile, receipt) = branch_profile(conn, branch_id)?;
    validate_operation_draft(&profile, &receipt.branch, draft, now_ms)?;
    if receipt.retained_operation_count >= profile.limits.max_operations {
        return Err(error(
            "SNAPBACK_BRANCH_OPERATION_LIMIT_EXCEEDED",
            "branch operation limit reached",
        ));
    }
    let tx = conn.transaction()?;
    let approved_facts = execute(&tx, draft)?;
    let operation = record_branch_operation_in(
        &tx,
        branch_id,
        draft,
        now_ms,
        &profile,
        &receipt,
        approved_facts,
    )?;
    tx.commit()?;
    Ok(operation)
}

pub(crate) fn execute_receipt_only_branch_operation(
    conn: &mut Connection,
    branch_id: &BranchId,
    draft: &BranchOperationDraftV1,
    result: Value,
    now_ms: i64,
) -> SnapbackResult<BranchOperationV1> {
    let (profile, _) = branch_profile(conn, branch_id)?;
    execute_branch_operation(conn, branch_id, draft, now_ms, |_tx, draft| {
        Ok(ApprovedOperationFactsV1 {
            read_facts: draft.read_baseline.clone(),
            ctx_answers: Value::Null,
            decision: json!({
                "carrier": "managed-branch-host-op-v1",
                "receiptOnly": true,
            }),
            result,
            writes: Vec::new(),
            effects: Vec::new(),
            coverage: profile.coverage.clone(),
        })
    })
}

fn record_branch_operation_in(
    tx: &Transaction<'_>,
    branch_id: &BranchId,
    draft: &BranchOperationDraftV1,
    now_ms: i64,
    profile: &InAppBranchCreateV1,
    receipt: &InAppBranchReceiptV1,
    approved_facts: ApprovedOperationFactsV1,
) -> SnapbackResult<BranchOperationV1> {
    if receipt.retained_operation_count >= profile.limits.max_operations {
        return Err(error(
            "SNAPBACK_BRANCH_OPERATION_LIMIT_EXCEEDED",
            "branch operation limit reached",
        ));
    }
    if approved_facts.coverage.clone().normalized() != profile.coverage.clone().normalized() {
        return Err(error(
            "SNAPBACK_PROMOTION_WRITE_COVERAGE_INCOMPLETE",
            "operation coverage facts must exactly match the branch coverage manifest",
        ));
    }
    if approved_facts.coverage.covered_lanes.iter().any(|lane| {
        !profile
            .grant
            .allowed_lanes
            .iter()
            .any(|allowed| allowed == lane)
    }) {
        return Err(error(
            "SNAPBACK_BRANCH_AUTHORITY_DENIED",
            "operation produced facts outside the branch grant's lane allowlist",
        ));
    }
    let child_version = allocate_child_version(tx, branch_id)?;
    let approved_facts_digest = digest_json(b"approved-operation-facts", &approved_facts)?;
    let operation = BranchOperationV1 {
        schema_version: 1,
        branch_id: branch_id.clone(),
        child_version,
        identity: draft.identity.clone(),
        artifact_identity: draft.artifact_identity.clone(),
        function_or_command: draft.function_or_command.clone(),
        canonical_arguments: draft.canonical_arguments.clone(),
        principal_id: draft.principal_id.clone(),
        grant_id: draft.grant_id.clone(),
        read_baseline: draft.read_baseline.clone(),
        replay_inputs: draft.replay_inputs.clone(),
        causal_predecessors: draft.causal_predecessors.clone(),
        approved_facts,
        approved_facts_digest,
        recorded_at_ms: now_ms,
    };
    let bytes = json_bytes(&operation, "branch operation")?;
    let next_bytes = receipt
        .retained_operation_bytes
        .checked_add(bytes.len() as u64)
        .ok_or_else(|| {
            error(
                "SNAPBACK_BRANCH_BYTE_LIMIT_EXCEEDED",
                "retained byte count overflow",
            )
        })?;
    if next_bytes > profile.limits.max_retained_bytes {
        return Err(error(
            "SNAPBACK_BRANCH_BYTE_LIMIT_EXCEEDED",
            "branch retained-operation byte limit reached",
        ));
    }
    tx.execute(
        "INSERT INTO _snapback_branch_operations
           (child_version, branch_id, operation_id, record_json, record_bytes, recorded_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            child_version as i64,
            branch_id.0,
            operation.identity.key.operation_id,
            bytes,
            bytes.len() as i64,
            now_ms,
        ],
    )?;
    let unretainable = operation
        .replay_inputs
        .iter()
        .any(|input| input.custody == ReplayCustodyClassV1::Unretainable);
    let uncovered = !operation.approved_facts.coverage.uncovered_lanes.is_empty();
    tx.execute(
        "UPDATE _snapback_in_app_branch_profiles
            SET retained_operation_count = retained_operation_count + 1,
                retained_operation_bytes = retained_operation_bytes + ?2,
                promotable = CASE WHEN ?3 OR ?4 THEN 0 ELSE promotable END,
                foreclosed_by_operation_id = CASE
                  WHEN (?3 OR ?4) AND foreclosed_by_operation_id IS NULL THEN ?5
                  ELSE foreclosed_by_operation_id END
          WHERE branch_id = ?1",
        params![
            branch_id.0,
            bytes.len() as i64,
            unretainable,
            uncovered,
            operation.identity.key.operation_id,
        ],
    )?;
    Ok(operation)
}

/// Record the exact mutation facts in the same SQLite transaction as the app
/// rows, change journal, and storage-version update. Any error rolls all four
/// surfaces back together; after commit an exact retry can recover the full
/// operation without executing another handler byte.
///
/// @ref LLP 0162#acceptance — row 10 requires a branch-local operation to be
///   retained atomically with the commit that it makes promotable.
pub(crate) fn record_branch_mutation_in(
    tx: &Transaction<'_>,
    context: &BranchMutationCommitV1,
    committed_version: u64,
    changes: &[crate::storage::ChangedRow],
    output: &crate::manifest::MutationOutput,
) -> SnapbackResult<BranchOperationV1> {
    let (profile, receipt) = branch_profile(tx, &context.branch_id)?;
    validate_operation_draft(
        &profile,
        &receipt.branch,
        &context.draft,
        context.recorded_at_ms,
    )?;
    validate_public_carrier_draft(&profile, &context.draft)?;
    let writes = changes
        .iter()
        .map(|change| LogicalWriteFactV1 {
            table_name: change.table.clone(),
            row_id: change.id.clone(),
            after: if change.op == crate::storage::ChangeOp::Delete {
                None
            } else {
                change.row.clone()
            },
        })
        .collect();
    let ctx_answers = serde_json::to_value(&output.ctx_ledger).map_err(|cause| {
        error(
            "SNAPBACK_BRANCH_ARTIFACT_INVALID",
            format!("serialize committed branch ctx answers: {cause}"),
        )
    })?;
    let intents = captured_effect_intents_for_operation(
        tx,
        &context.branch_id,
        &context.draft.identity.key.operation_id,
    )?;
    let effects = intents.iter().map(captured_effect_fact).collect::<Vec<_>>();
    let operation = record_branch_operation_in(
        tx,
        &context.branch_id,
        &context.draft,
        context.recorded_at_ms,
        &profile,
        &receipt,
        ApprovedOperationFactsV1 {
            read_facts: context.draft.read_baseline.clone(),
            ctx_answers,
            decision: json!({
                "carrier": "managed-branch-host-op-v1",
                "canonicalCommitVersion": committed_version,
                "atomicWithAppCommit": true,
                "capturedEffectCount": effects.len(),
            }),
            result: output.result.clone(),
            writes,
            effects,
            coverage: profile.coverage.clone(),
        },
    )?;
    tx.execute(
        "UPDATE _snapback_branch_effect_intents_v1
            SET child_version=?3
          WHERE branch_id=?1 AND operation_id=?2 AND child_version IS NULL",
        params![
            context.branch_id.0,
            context.draft.identity.key.operation_id,
            operation.child_version as i64,
        ],
    )?;
    Ok(operation)
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EffectSettlementCapabilityV1 {
    ProviderIdempotent,
    ProviderQueryable,
    InherentlyAmbiguous,
}

impl EffectSettlementCapabilityV1 {
    fn as_str(self) -> &'static str {
        match self {
            Self::ProviderIdempotent => "providerIdempotent",
            Self::ProviderQueryable => "providerQueryable",
            Self::InherentlyAmbiguous => "inherentlyAmbiguous",
        }
    }

    fn parse(value: &str) -> SnapbackResult<Self> {
        match value {
            "providerIdempotent" => Ok(Self::ProviderIdempotent),
            "providerQueryable" => Ok(Self::ProviderQueryable),
            "inherentlyAmbiguous" => Ok(Self::InherentlyAmbiguous),
            _ => Err(error(
                "SNAPBACK_BRANCH_EFFECT_LEDGER_INVALID",
                "captured effect has an unknown settlement capability",
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CapturedEffectStateV1 {
    Captured,
    CanonicalPending,
    Initiated,
    Succeeded,
    Rejected,
    AmbiguousExternalEffect,
    AuthorityRefused,
}

impl CapturedEffectStateV1 {
    #[cfg(any(test, feature = "test-support"))]
    fn as_str(self) -> &'static str {
        match self {
            Self::Captured => "captured",
            Self::CanonicalPending => "canonicalPending",
            Self::Initiated => "initiated",
            Self::Succeeded => "succeeded",
            Self::Rejected => "rejected",
            Self::AmbiguousExternalEffect => "ambiguousExternalEffect",
            Self::AuthorityRefused => "authorityRefused",
        }
    }

    fn parse(value: &str) -> SnapbackResult<Self> {
        match value {
            "captured" => Ok(Self::Captured),
            "canonicalPending" => Ok(Self::CanonicalPending),
            "initiated" => Ok(Self::Initiated),
            "succeeded" => Ok(Self::Succeeded),
            "rejected" => Ok(Self::Rejected),
            "ambiguousExternalEffect" => Ok(Self::AmbiguousExternalEffect),
            "authorityRefused" => Ok(Self::AuthorityRefused),
            _ => Err(error(
                "SNAPBACK_BRANCH_EFFECT_LEDGER_INVALID",
                "captured effect has an unknown settlement state",
            )),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapturedEffectIntentV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub intent_id: String,
    pub branch_id: BranchId,
    pub operation_id: String,
    pub effect_ordinal: u64,
    pub child_version: Option<u64>,
    pub egress_class: String,
    pub settlement_capability: EffectSettlementCapabilityV1,
    #[schemars(pattern(SHA256_PATTERN))]
    pub idempotency_key: String,
    pub principal_id: String,
    pub grant_id: String,
    #[schemars(pattern(SHA256_PATTERN))]
    pub authority_fingerprint: String,
    pub state: CapturedEffectStateV1,
    pub captured_at_ms: i64,
}

#[derive(Clone)]
pub struct BranchEffectExecutionContextV1 {
    pub branch_id: BranchId,
    pub draft: BranchOperationDraftV1,
    pub now_ms: i64,
    next_effect_ordinal: std::rc::Rc<std::cell::Cell<u64>>,
}

impl BranchEffectExecutionContextV1 {
    pub fn new(branch_id: BranchId, draft: BranchOperationDraftV1, now_ms: i64) -> Self {
        Self {
            branch_id,
            draft,
            now_ms,
            next_effect_ordinal: std::rc::Rc::new(std::cell::Cell::new(0)),
        }
    }
}

thread_local! {
    static ACTIVE_BRANCH_EFFECT_CONTEXT:
        std::cell::RefCell<Vec<BranchEffectExecutionContextV1>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

pub fn with_branch_effect_execution_context<T>(
    context: BranchEffectExecutionContextV1,
    execute: impl FnOnce() -> T,
) -> T {
    ACTIVE_BRANCH_EFFECT_CONTEXT.with(|slot| slot.borrow_mut().push(context));
    struct PopContext;
    impl Drop for PopContext {
        fn drop(&mut self) {
            ACTIVE_BRANCH_EFFECT_CONTEXT.with(|slot| {
                slot.borrow_mut().pop();
            });
        }
    }
    let _pop = PopContext;
    execute()
}

fn next_active_branch_effect_context(
    branch_id: &BranchId,
) -> Option<(BranchEffectExecutionContextV1, u64)> {
    ACTIVE_BRANCH_EFFECT_CONTEXT.with(|slot| {
        let context = slot
            .borrow()
            .iter()
            .rev()
            .find(|context| context.branch_id == *branch_id)
            .cloned()?;
        let ordinal = context.next_effect_ordinal.get();
        context.next_effect_ordinal.set(ordinal.saturating_add(1));
        Some((context, ordinal))
    })
}

fn settlement_capability_for_egress(egress_class: &str) -> EffectSettlementCapabilityV1 {
    match egress_class {
        "push_send" | "push_receipt" | "jobs_enqueue" | "jobs_drain" => {
            EffectSettlementCapabilityV1::ProviderIdempotent
        }
        "fetch" | "stream_open" | "stream_read" | "stream_cancel" => {
            EffectSettlementCapabilityV1::ProviderQueryable
        }
        _ => EffectSettlementCapabilityV1::InherentlyAmbiguous,
    }
}

type CapturedEffectRowV1 = (
    String,
    String,
    i64,
    Option<i64>,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    i64,
);

fn decode_captured_effect_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CapturedEffectRowV1> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
        row.get(11)?,
    ))
}

fn captured_effect_from_raw(
    branch_id: &BranchId,
    raw: CapturedEffectRowV1,
) -> SnapbackResult<CapturedEffectIntentV1> {
    let (
        intent_id,
        operation_id,
        effect_ordinal,
        child_version,
        egress_class,
        capability,
        idempotency_key,
        principal_id,
        grant_id,
        authority_fingerprint,
        state,
        captured_at_ms,
    ) = raw;
    Ok(CapturedEffectIntentV1 {
        schema_version: 1,
        intent_id,
        branch_id: branch_id.clone(),
        operation_id,
        effect_ordinal: effect_ordinal.max(0) as u64,
        child_version: child_version.map(|value| value.max(0) as u64),
        egress_class,
        settlement_capability: EffectSettlementCapabilityV1::parse(&capability)?,
        idempotency_key,
        principal_id,
        grant_id,
        authority_fingerprint,
        state: CapturedEffectStateV1::parse(&state)?,
        captured_at_ms,
    })
}

pub(crate) fn captured_effect_intents(
    conn: &Connection,
    branch_id: &BranchId,
) -> SnapbackResult<Vec<CapturedEffectIntentV1>> {
    ensure_in_app_branch_tables(conn)?;
    let mut statement = conn.prepare(
        "SELECT intent_id,operation_id,effect_ordinal,child_version,egress_class,
                settlement_capability,idempotency_key,principal_id,grant_id,
                authority_fingerprint,state,captured_at_ms
           FROM _snapback_branch_effect_intents_v1
          WHERE branch_id=?1 ORDER BY operation_id,effect_ordinal,intent_id",
    )?;
    let rows = statement.query_map(params![branch_id.0], decode_captured_effect_row)?;
    rows.map(|row| captured_effect_from_raw(branch_id, row?))
        .collect()
}

fn capture_effect_intent(
    conn: &mut Connection,
    context: &BranchEffectExecutionContextV1,
    egress_class: &str,
    effect_ordinal: u64,
) -> SnapbackResult<CapturedEffectIntentV1> {
    let (profile, receipt) = branch_profile(conn, &context.branch_id)?;
    if profile.egress_policy != ForkEgressPolicyV1::CaptureOnly {
        return Err(error(
            "SNAPBACK_BRANCH_EFFECT_POLICY_INVALID",
            "effect capture requires a CaptureOnly branch",
        ));
    }
    validate_operation_draft(&profile, &receipt.branch, &context.draft, context.now_ms)?;
    validate_public_carrier_draft(&profile, &context.draft)?;
    if branch_operation_retry(conn, &context.branch_id, &context.draft)?.is_some() {
        return Err(error(
            "SNAPBACK_BRANCH_EFFECT_LEDGER_INVALID",
            "a terminal branch operation cannot append another effect intent",
        ));
    }
    let existing_intents = captured_effect_intents(conn, &context.branch_id)?;
    if let Some(existing) = existing_intents.iter().find(|intent| {
        intent.operation_id == context.draft.identity.key.operation_id
            && intent.effect_ordinal == effect_ordinal
    }) {
        if existing.egress_class == egress_class {
            return Ok(existing.clone());
        }
        return Err(error(
            "SNAPBACK_BRANCH_EFFECT_ORDINAL_REUSED",
            "one branch operation reused an effect ordinal for a different egress family",
        ));
    }
    let intent_count = existing_intents
        .iter()
        .filter(|intent| intent.operation_id == context.draft.identity.key.operation_id)
        .count() as u64;
    if receipt.retained_operation_count >= profile.limits.max_operations
        || intent_count >= profile.limits.max_operations
    {
        return Err(error(
            "SNAPBACK_BRANCH_OPERATION_LIMIT_EXCEEDED",
            "captured effect intent limit reached",
        ));
    }
    let operation_id = context.draft.identity.key.operation_id.clone();
    let intent_id = digest_json(
        b"captured-effect-intent-v1",
        &(
            &context.branch_id,
            &operation_id,
            effect_ordinal,
            egress_class,
        ),
    )?;
    let idempotency_key = digest_json(
        b"captured-effect-idempotency-v1",
        &(&profile.branch_id, &intent_id),
    )?;
    let capability = settlement_capability_for_egress(egress_class);
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute(
        "INSERT INTO _snapback_branch_effect_intents_v1(
           intent_id,branch_id,operation_id,effect_ordinal,child_version,egress_class,
           settlement_capability,idempotency_key,principal_id,grant_id,
           authority_fingerprint,state,captured_at_ms
         ) VALUES(?1,?2,?3,?4,NULL,?5,?6,?7,?8,?9,?10,'captured',?11)",
        params![
            intent_id,
            context.branch_id.0,
            operation_id,
            effect_ordinal as i64,
            egress_class,
            capability.as_str(),
            idempotency_key,
            profile.grant.principal_id,
            profile.grant.grant_id,
            profile.grant.authority_fingerprint,
            context.now_ms,
        ],
    )?;
    let foreclosed = tx.execute(
        "UPDATE _snapback_in_app_branch_profiles
            SET promotable=0,
                foreclosed_by_operation_id=COALESCE(foreclosed_by_operation_id,?2)
          WHERE branch_id=?1",
        params![context.branch_id.0, operation_id],
    )?;
    if foreclosed != 1 {
        return Err(error(
            "SNAPBACK_BRANCH_PROFILE_MISSING",
            "captured effect intent lost its branch promotion fence",
        ));
    }
    tx.commit()?;
    Ok(CapturedEffectIntentV1 {
        schema_version: 1,
        intent_id,
        branch_id: context.branch_id.clone(),
        operation_id,
        effect_ordinal,
        child_version: None,
        egress_class: egress_class.to_owned(),
        settlement_capability: capability,
        idempotency_key,
        principal_id: profile.grant.principal_id,
        grant_id: profile.grant.grant_id,
        authority_fingerprint: profile.grant.authority_fingerprint,
        state: CapturedEffectStateV1::Captured,
        captured_at_ms: context.now_ms,
    })
}

fn captured_effect_intents_for_operation(
    conn: &Connection,
    branch_id: &BranchId,
    operation_id: &str,
) -> SnapbackResult<Vec<CapturedEffectIntentV1>> {
    Ok(captured_effect_intents(conn, branch_id)?
        .into_iter()
        .filter(|intent| intent.operation_id == operation_id)
        .collect())
}

fn captured_effect_fact(intent: &CapturedEffectIntentV1) -> Value {
    json!({
        "schemaVersion": 1,
        "intentId": intent.intent_id,
        "effectOrdinal": intent.effect_ordinal,
        "egressClass": intent.egress_class,
        "settlementCapability": intent.settlement_capability,
        "idempotencyKey": intent.idempotency_key,
        "payloadRetained": false,
    })
}

pub(crate) fn finalize_captured_effect_operation(
    conn: &mut Connection,
    context: &BranchEffectExecutionContextV1,
    result: Value,
    diagnostic_code: Option<&str>,
) -> SnapbackResult<Option<BranchOperationV1>> {
    if let Some(retained) = branch_operation_retry(conn, &context.branch_id, &context.draft)? {
        return Ok(Some(retained));
    }
    let intents = captured_effect_intents_for_operation(
        conn,
        &context.branch_id,
        &context.draft.identity.key.operation_id,
    )?;
    if intents.is_empty() {
        return Ok(None);
    }
    let (profile, receipt) = branch_profile(conn, &context.branch_id)?;
    let effects = intents.iter().map(captured_effect_fact).collect();
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let operation = record_branch_operation_in(
        &tx,
        &context.branch_id,
        &context.draft,
        context.now_ms,
        &profile,
        &receipt,
        ApprovedOperationFactsV1 {
            read_facts: context.draft.read_baseline.clone(),
            ctx_answers: Value::Null,
            decision: json!({
                "carrier": "managed-branch-capture-only-v1",
                "effectDisposition": "capturedNotFired",
                "handlerDiagnosticCode": diagnostic_code,
            }),
            result,
            writes: Vec::new(),
            effects,
            coverage: profile.coverage.clone(),
        },
    )?;
    tx.execute(
        "UPDATE _snapback_branch_effect_intents_v1
            SET child_version=?3
          WHERE branch_id=?1 AND operation_id=?2 AND child_version IS NULL",
        params![
            context.branch_id.0,
            context.draft.identity.key.operation_id,
            operation.child_version as i64,
        ],
    )?;
    tx.commit()?;
    Ok(Some(operation))
}

pub(crate) fn branch_operation_log(
    conn: &Connection,
    branch_id: &BranchId,
) -> SnapbackResult<Vec<BranchOperationV1>> {
    ensure_in_app_branch_tables(conn)?;
    let mut statement = conn.prepare(
        "SELECT record_json FROM _snapback_branch_operations
          WHERE branch_id = ?1 ORDER BY child_version",
    )?;
    let rows = statement.query_map(params![branch_id.0], |row| row.get::<_, Vec<u8>>(0))?;
    let mut operations = Vec::new();
    for row in rows {
        operations.push(decode_json(&row?, "branch operation")?);
    }
    Ok(operations)
}

/// Resolve an exact public-carrier retry before any handler byte runs. A
/// physical-key collision with different branch facts is a refusal, never a
/// second execution under the reused host request identity.
pub(crate) fn branch_operation_retry(
    conn: &Connection,
    branch_id: &BranchId,
    draft: &BranchOperationDraftV1,
) -> SnapbackResult<Option<BranchOperationV1>> {
    ensure_in_app_branch_tables(conn)?;
    let body: Option<Vec<u8>> = conn
        .query_row(
            "SELECT record_json FROM _snapback_branch_operations
              WHERE branch_id=?1 AND operation_id=?2",
            params![branch_id.0, draft.identity.key.operation_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(body) = body else { return Ok(None) };
    let retained: BranchOperationV1 = decode_json(&body, "branch operation")?;
    if retained.identity != draft.identity
        || retained.artifact_identity != draft.artifact_identity
        || retained.function_or_command != draft.function_or_command
        || retained.canonical_arguments != draft.canonical_arguments
        || retained.principal_id != draft.principal_id
        || retained.grant_id != draft.grant_id
        || retained.read_baseline != draft.read_baseline
        || retained.replay_inputs != draft.replay_inputs
        || retained.causal_predecessors != draft.causal_predecessors
    {
        return Err(error(
            "SNAPBACK_BRANCH_OPERATION_ID_REUSED",
            "branch operation identity collides with divergent execution facts",
        ));
    }
    Ok(Some(retained))
}

/// Fail-safe reservation for the current non-atomic public execution carrier.
/// The exact draft and foreclosure are committed together before handler
/// execution. A process death after the app commit but before fact retention
/// therefore leaves a durable outcome-unknown refusal instead of permitting a
/// duplicate retry. Row 10 remains Partial until recording moves into the app
/// commit transaction.
pub(crate) fn foreclose_branch_operation_admission(
    conn: &mut Connection,
    branch_id: &BranchId,
    draft: &BranchOperationDraftV1,
    now_ms: i64,
) -> SnapbackResult<()> {
    let (profile, receipt) = branch_profile(conn, branch_id)?;
    validate_operation_draft(&profile, &receipt.branch, draft, now_ms)?;
    validate_public_carrier_draft(&profile, draft)?;
    if receipt.retained_operation_count >= profile.limits.max_operations {
        return Err(error(
            "SNAPBACK_BRANCH_OPERATION_LIMIT_EXCEEDED",
            "branch operation limit reached",
        ));
    }
    if let Some(foreclosed_by) = receipt.foreclosed_by_operation_id.as_deref() {
        if foreclosed_by != draft.identity.key.operation_id {
            return Err(error(
                "SNAPBACK_BRANCH_FORECLOSED",
                "the non-atomic v1 carrier admits no second operation after branch foreclosure",
            ));
        }
        let reserved: Option<Vec<u8>> = conn
            .query_row(
                "SELECT draft_json FROM _snapback_branch_operation_reservations
                  WHERE branch_id=?1 AND operation_id=?2",
                params![branch_id.0, draft.identity.key.operation_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(reserved) = reserved else {
            return Err(error(
                "SNAPBACK_BRANCH_CUSTODY_INVALID",
                "branch foreclosure is missing its durable operation reservation",
            ));
        };
        let reserved: BranchOperationDraftV1 =
            decode_json(&reserved, "branch operation reservation")?;
        if reserved != *draft {
            return Err(error(
                "SNAPBACK_BRANCH_OPERATION_ID_REUSED",
                "branch operation reservation collides with divergent execution facts",
            ));
        }
        return Err(error(
            "SNAPBACK_BRANCH_OPERATION_OUTCOME_UNKNOWN",
            "the reserved operation has no terminal record and cannot be executed again",
        ));
    }

    let draft_bytes = json_bytes(draft, "branch operation reservation")?;
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO _snapback_branch_operation_reservations
           (branch_id, operation_id, draft_json, reserved_at_ms)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            branch_id.0,
            draft.identity.key.operation_id,
            draft_bytes,
            now_ms
        ],
    )?;
    let changed = tx.execute(
        "UPDATE _snapback_in_app_branch_profiles
            SET promotable=0,
                foreclosed_by_operation_id=?2
          WHERE branch_id=?1 AND foreclosed_by_operation_id IS NULL",
        params![branch_id.0, draft.identity.key.operation_id],
    )?;
    if changed != 1 {
        return Err(error(
            "SNAPBACK_BRANCH_CUSTODY_INVALID",
            "branch foreclosure raced another operation admission",
        ));
    }
    tx.commit()?;
    Ok(())
}

/// Retain the observable facts of a mutation that ran through the real branch
/// handler path. The ordinary app journal is the source of write facts. This
/// is intentionally separate from the pre-execution foreclosure above: a
/// crash in between is safe but makes the branch non-promotable and its exact
/// diff fail closed, which is the honest current Partial posture.
pub(crate) fn retain_committed_branch_mutation(
    conn: &mut Connection,
    branch_id: &BranchId,
    draft: &BranchOperationDraftV1,
    committed_version: u64,
    result: Value,
    ctx_answers: Value,
    now_ms: i64,
) -> SnapbackResult<BranchOperationV1> {
    let (profile, _) = branch_profile(conn, branch_id)?;
    validate_public_carrier_draft(&profile, draft)?;
    let reserved: Option<Vec<u8>> = conn
        .query_row(
            "SELECT draft_json FROM _snapback_branch_operation_reservations
              WHERE branch_id=?1 AND operation_id=?2",
            params![branch_id.0, draft.identity.key.operation_id],
            |row| row.get(0),
        )
        .optional()?;
    let reserved = reserved.ok_or_else(|| {
        error(
            "SNAPBACK_BRANCH_OPERATION_RESERVATION_MISSING",
            "committed branch mutation has no durable pre-execution reservation",
        )
    })?;
    if decode_json::<BranchOperationDraftV1>(&reserved, "branch operation reservation")? != *draft {
        return Err(error(
            "SNAPBACK_BRANCH_OPERATION_ID_REUSED",
            "committed mutation facts diverge from their operation reservation",
        ));
    }
    let committed_version = i64::try_from(committed_version).map_err(|_| {
        error(
            "SNAPBACK_BRANCH_OPERATION_JOURNAL_INCOMPLETE",
            "committed branch version exceeds the portable storage range",
        )
    })?;
    let mut statement = conn.prepare(
        "SELECT table_name,row_id,op,row_json FROM _snapback_changes
          WHERE version=?1 ORDER BY id",
    )?;
    let rows = statement.query_map(params![committed_version], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    let mut writes = Vec::new();
    for row in rows {
        let (table_name, row_id, op, body) = row?;
        let after = if op == "delete" {
            None
        } else {
            Some(
                serde_json::from_str(body.as_deref().ok_or_else(|| {
                    error(
                        "SNAPBACK_BRANCH_OPERATION_JOURNAL_INCOMPLETE",
                        "committed branch change is missing its post-image",
                    )
                })?)
                .map_err(|_| {
                    error(
                        "SNAPBACK_BRANCH_OPERATION_JOURNAL_INCOMPLETE",
                        "committed branch change has malformed JSON",
                    )
                })?,
            )
        };
        writes.push(LogicalWriteFactV1 {
            table_name,
            row_id,
            after,
        });
    }
    drop(statement);
    execute_branch_operation(conn, branch_id, draft, now_ms, |_tx, _draft| {
        Ok(ApprovedOperationFactsV1 {
            read_facts: draft.read_baseline.clone(),
            ctx_answers,
            decision: json!({
                "carrier": "managed-branch-host-op-v1",
            "canonicalCommitVersion": committed_version,
                "atomicWithAppCommit": false,
            }),
            result,
            writes,
            effects: Vec::new(),
            coverage: profile.coverage.clone(),
        })
    })
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DenyAllAttemptMarkerV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub marker_id: String,
    pub branch_id: BranchId,
    pub operation_id: Option<String>,
    pub egress_class: String,
    pub attempted_at_ms: i64,
}

/// Durably record a payload-free marker and then fail loudly. The function does
/// not accept a target or payload, so sensitive egress material cannot enter the
/// marker table accidentally.
pub(crate) fn deny_egress_attempt(
    conn: &mut Connection,
    branch_id: &BranchId,
    operation_id: Option<&str>,
    egress_class: &str,
    now_ms: i64,
) -> SnapbackResult<()> {
    let (profile, receipt) = branch_profile(conn, branch_id)?;
    if profile.egress_policy != ForkEgressPolicyV1::DenyAll {
        return Err(error(
            "SNAPBACK_BRANCH_EFFECT_POLICY_INVALID",
            "DenyAll attempt recording requires a DenyAll branch",
        ));
    }
    let marker_id = digest_json(
        b"deny-all-attempt-marker",
        &(branch_id, operation_id, egress_class, now_ms),
    )?;
    let tx = conn.transaction()?;
    if receipt.deny_all_attempt_count < profile.limits.max_operations {
        tx.execute(
            "INSERT OR IGNORE INTO _snapback_branch_egress_attempts
               (marker_id, branch_id, operation_id, egress_class, attempted_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![marker_id, branch_id.0, operation_id, egress_class, now_ms],
        )?;
    }
    tx.execute(
        "UPDATE _snapback_in_app_branch_profiles
            SET deny_all_attempt_count = deny_all_attempt_count + 1,
                promotable = 0,
                foreclosed_by_operation_id = COALESCE(foreclosed_by_operation_id, ?2)
          WHERE branch_id = ?1",
        params![branch_id.0, operation_id],
    )?;
    tx.commit()?;
    Err(error(
        "SNAPBACK_BRANCH_EGRESS_DENIED",
        format!("DenyAll branch refused host egress class {egress_class:?}"),
    ))
}

pub(crate) fn deny_all_attempt_markers(
    conn: &Connection,
    branch_id: &BranchId,
) -> SnapbackResult<Vec<DenyAllAttemptMarkerV1>> {
    ensure_in_app_branch_tables(conn)?;
    let mut statement = conn.prepare(
        "SELECT marker_id, operation_id, egress_class, attempted_at_ms
           FROM _snapback_branch_egress_attempts
          WHERE branch_id = ?1 ORDER BY attempted_at_ms, marker_id",
    )?;
    let rows = statement.query_map(params![branch_id.0], |row| {
        Ok(DenyAllAttemptMarkerV1 {
            schema_version: 1,
            marker_id: row.get(0)?,
            branch_id: branch_id.clone(),
            operation_id: row.get(1)?,
            egress_class: row.get(2)?,
            attempted_at_ms: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotRowV1 {
    pub table_name: String,
    pub row_id: String,
    pub row: Value,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NetDiffDispositionV1 {
    Added,
    Updated,
    Deleted,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetDiffRowV1 {
    pub table_name: String,
    pub row_id: String,
    pub disposition: NetDiffDispositionV1,
    pub before: Option<Value>,
    pub after: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttributedChangeV1 {
    pub child_version: u64,
    pub operation_identity: OperationIdentityV1,
    pub principal_id: String,
    pub write_ordinal: u64,
    pub write: LogicalWriteFactV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NetDiffSubstrateV1 {
    /// Legacy pre-accounting receipt value. It remains decode/schema-visible
    /// for v1 compatibility but is never emitted by `exact_fork_diff` and is
    /// not admissible for strict promotion.
    ImmutableMaterializedBase,
    JournalDerivedWithIndependentOracle,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkDiffReceiptV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub branch_id: BranchId,
    pub base_stream: String,
    pub base_version: u64,
    pub child_stream_id: ChildStreamId,
    pub child_head: u64,
    pub substrate: NetDiffSubstrateV1,
    pub coverage: ForkCoverageV1,
    pub attributed_changes: Vec<AttributedChangeV1>,
    pub net_diff: Vec<NetDiffRowV1>,
    /// Zero is reserved for decoded legacy receipts whose work was not
    /// accounted. New exact diffs always emit a positive admitted byte count.
    #[serde(default)]
    #[schemars(range(min = 0, max = 67108864))]
    pub digest_work_bytes: u64,
    #[schemars(pattern(SHA256_PATTERN))]
    pub diff_digest: String,
}

fn keyed_rows(rows: Vec<SnapshotRowV1>) -> SnapbackResult<BTreeMap<(String, String), Value>> {
    let mut keyed = BTreeMap::new();
    for row in rows {
        let key = (row.table_name, row.row_id);
        if keyed
            .insert(key.clone(), canonicalize_json(row.row))
            .is_some()
        {
            return Err(error(
                "SNAPBACK_BRANCH_DIFF_DUPLICATE_ROW",
                format!("snapshot scanner emitted duplicate row {key:?}"),
            ));
        }
    }
    Ok(keyed)
}

/// Derive the net diff from the retained operation journal, then independently
/// compare that derivation with scans of the immutable base and writable head.
/// A missing or divergent journal fact refuses rather than publishing a
/// partial diff as complete.
// @ref LLP 0162#4-journal-diff-instead-of-maintained-merkle-state — the
// runtime result is journal-derived; the base/head scan is an independent
// completeness oracle and declared digest work is bounded before hashing.
pub(crate) fn exact_fork_diff<F>(
    workspace: &MaterializedBase,
    branch_id: &BranchId,
    scan: F,
) -> SnapbackResult<ForkDiffReceiptV1>
where
    F: Fn(&Connection) -> SnapbackResult<Vec<SnapshotRowV1>>,
{
    let (_, receipt) = branch_profile(&workspace.conn, branch_id)?;
    let base_scan = scan(workspace.immutable_base())?;
    let head_scan = scan(&workspace.conn)?;
    let base = keyed_rows(base_scan.clone())?;
    let head_oracle = keyed_rows(head_scan.clone())?;
    let operations = branch_operation_log(&workspace.conn, branch_id)?;
    let coverage = receipt.coverage.clone().normalized();
    let mut journal_head = base.clone();
    let mut attributed_changes = Vec::new();
    for operation in &operations {
        if operation.approved_facts.coverage.clone().normalized() != coverage {
            return Err(error(
                "SNAPBACK_BRANCH_DIFF_JOURNAL_INCOMPLETE",
                "operation journal coverage diverges from the branch coverage manifest",
            ));
        }
        for (ordinal, write) in operation.approved_facts.writes.iter().enumerate() {
            if write.table_name.trim().is_empty() || write.row_id.trim().is_empty() {
                return Err(error(
                    "SNAPBACK_BRANCH_DIFF_JOURNAL_INCOMPLETE",
                    "operation journal contains an unclassifiable write identity",
                ));
            }
            let key = (write.table_name.clone(), write.row_id.clone());
            match &write.after {
                Some(after) => {
                    journal_head.insert(key, canonicalize_json(after.clone()));
                }
                None => {
                    if journal_head.remove(&key).is_none() {
                        return Err(error(
                            "SNAPBACK_BRANCH_DIFF_JOURNAL_INCOMPLETE",
                            "operation journal records deletion of an absent row",
                        ));
                    }
                }
            }
            attributed_changes.push(AttributedChangeV1 {
                child_version: operation.child_version,
                operation_identity: operation.identity.clone(),
                principal_id: operation.principal_id.clone(),
                write_ordinal: ordinal as u64,
                write: write.clone(),
            });
        }
    }
    if journal_head != head_oracle {
        return Err(error(
            "SNAPBACK_BRANCH_DIFF_JOURNAL_INCOMPLETE",
            "journal-derived head diverges from the independent writable-head scan",
        ));
    }
    let keys: BTreeSet<_> = base.keys().chain(journal_head.keys()).cloned().collect();
    let mut net_diff = Vec::new();
    for (table_name, row_id) in keys {
        let before = base.get(&(table_name.clone(), row_id.clone()));
        let after = journal_head.get(&(table_name.clone(), row_id.clone()));
        let disposition = match (before, after) {
            (None, Some(_)) => Some(NetDiffDispositionV1::Added),
            (Some(_), None) => Some(NetDiffDispositionV1::Deleted),
            (Some(before), Some(after)) if before != after => Some(NetDiffDispositionV1::Updated),
            _ => None,
        };
        if let Some(disposition) = disposition {
            net_diff.push(NetDiffRowV1 {
                table_name,
                row_id,
                disposition,
                before: before.cloned(),
                after: after.cloned(),
            });
        }
    }
    if net_diff.len() as u64 > receipt.limits.max_diff_rows {
        return Err(error(
            "SNAPBACK_BRANCH_DIFF_LIMIT_EXCEEDED",
            "exact diff exceeds the branch's declared row bound",
        ));
    }
    let digest_work_bytes = bounded_digest_work_bytes(
        &(
            &base_scan,
            &head_scan,
            &operations,
            &attributed_changes,
            &net_diff,
        ),
        receipt.limits.max_digest_work_bytes,
    )?;
    let child_head = child_current_version(&workspace.conn, branch_id)?.ok_or_else(|| {
        error(
            "SNAPBACK_BRANCH_STREAM_MISSING",
            "branch child stream disappeared before diff",
        )
    })?;
    let digest_input = (
        &receipt.branch.base_stream,
        receipt.branch.base_version,
        &receipt.branch.child_stream_id,
        child_head,
        &coverage,
        &attributed_changes,
        &net_diff,
        digest_work_bytes,
    );
    let diff_digest = digest_json(b"exact-fork-diff", &digest_input)?;
    Ok(ForkDiffReceiptV1 {
        schema_version: 1,
        branch_id: branch_id.clone(),
        base_stream: receipt.branch.base_stream,
        base_version: receipt.branch.base_version,
        child_stream_id: receipt.branch.child_stream_id,
        child_head,
        substrate: NetDiffSubstrateV1::JournalDerivedWithIndependentOracle,
        coverage,
        attributed_changes,
        net_diff,
        digest_work_bytes,
        diff_digest,
    })
}

pub fn sibling_diffs_share_base(
    left: &ForkDiffReceiptV1,
    right: &ForkDiffReceiptV1,
) -> SnapbackResult<()> {
    if left.base_stream != right.base_stream || left.base_version != right.base_version {
        return Err(error(
            "SNAPBACK_BRANCH_NO_COMMON_BASE",
            "sibling comparison requires the same stream-qualified base",
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotionContentionPolicyV1 {
    #[schemars(range(min = 2, max = 2))]
    pub reservation_after_losses: u64,
    #[schemars(range(min = 1000, max = 1000))]
    pub reservation_interval_ms: u64,
    #[schemars(range(min = 1, max = 1))]
    pub reservation_quota: u64,
    #[schemars(range(min = 500, max = 500))]
    pub maximum_commit_duration_ms: u64,
}

/// Frozen conservative v1 contention terms. These values are part of the
/// admission wire contract rather than caller-tunable hints: every durable
/// ticket binds the same loss threshold, reservation window/quota, and maximum
/// commit duration.
///
/// @ref LLP 0162#5-promotion-stays-strict-and-merge-free — conditional progress is meaningful only
/// when its numeric fairness terms are stable and inspectable.
pub const PRODUCTION_PROMOTION_CONTENTION_POLICY_V1: PromotionContentionPolicyV1 =
    PromotionContentionPolicyV1 {
        reservation_after_losses: 2,
        reservation_interval_ms: 1_000,
        reservation_quota: 1,
        maximum_commit_duration_ms: 500,
    };

impl Default for PromotionContentionPolicyV1 {
    fn default() -> Self {
        PRODUCTION_PROMOTION_CONTENTION_POLICY_V1
    }
}

impl PromotionContentionPolicyV1 {
    fn validate(&self) -> SnapbackResult<()> {
        if self != &PRODUCTION_PROMOTION_CONTENTION_POLICY_V1 {
            return Err(error(
                "SNAPBACK_PROMOTION_CONTENTION_POLICY_INVALID",
                "contention terms must equal the frozen production v1 policy",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotionAdmissionTicketV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub ticket_identity: OperationIdentityV1,
    pub canonical_stream_id: String,
    pub branch_id: BranchId,
    pub fifo_sequence: u64,
    pub initial_queue_position: u64,
    pub observed_concurrent_forks: u64,
    pub rebase_budget: u64,
    pub losses: u64,
    pub expires_at_ms: i64,
    pub contention_policy: PromotionContentionPolicyV1,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotionApprovalV1 {
    pub approver_principal_id: String,
    pub approver_grant_id: String,
    #[schemars(pattern(SHA256_PATTERN))]
    pub authority_fingerprint: String,
    pub approved_at_ms: i64,
    pub expires_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RebaseEngineAttestationV1 {
    pub engine_identity: String,
    pub prior_branch_id: BranchId,
    pub prior_child_stream_id: ChildStreamId,
    #[schemars(pattern(SHA256_PATTERN))]
    pub preserved_approval_digest: String,
    pub attested_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotionRequestV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub branch_id: BranchId,
    pub child_stream_id: ChildStreamId,
    pub reviewed_child_head: u64,
    pub base_stream: String,
    pub base_version: u64,
    #[schemars(pattern(SHA256_PATTERN))]
    pub operation_log_digest: String,
    #[schemars(pattern(SHA256_PATTERN))]
    pub diff_digest: String,
    #[schemars(pattern(SHA256_PATTERN))]
    pub manifest_digest: String,
    #[schemars(pattern(SHA256_PATTERN))]
    pub approved_facts_digest: String,
    #[schemars(pattern(SHA256_PATTERN))]
    pub schema_hash: String,
    pub approval: PromotionApprovalV1,
    pub admission_ticket: PromotionAdmissionTicketV1,
    pub aggregate_identity: OperationIdentityV1,
    pub rebase_attestation: Option<RebaseEngineAttestationV1>,
    #[schemars(pattern(SHA256_PATTERN))]
    pub seal: String,
}

fn promotion_request_seal(
    request: &PromotionRequestV1,
    key: &PromotionSealKey,
) -> SnapbackResult<String> {
    let mut body = request.clone();
    body.seal.clear();
    Ok(hmac_sha256(
        &key.0,
        &json_bytes(&body, "promotion request")?,
    ))
}

fn promotion_request_digest(request: &PromotionRequestV1) -> SnapbackResult<String> {
    digest_json(b"committed-promotion-request", request)
}

fn is_sha256_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn operation_log_digest(operations: &[BranchOperationV1]) -> SnapbackResult<String> {
    digest_json(b"replay-sufficient-operation-log", &operations)
}

fn approved_facts_digest(operations: &[BranchOperationV1]) -> SnapbackResult<String> {
    let facts = operations
        .iter()
        .map(|operation| (&operation.artifact_identity, &operation.approved_facts))
        .collect::<Vec<_>>();
    digest_json(b"promotion-approved-facts", &facts)
}

pub(crate) fn ensure_promotion_tables(conn: &Connection) -> SnapbackResult<()> {
    // Promotion may be invoked on a pre-v2 store through the lower-level Rust
    // surface. Upgrade the proof/history infrastructure before replay writes
    // enter storage's central history seam.
    crate::proof_checkpoint::create_history_infra(conn)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _snapback_promotion_admission (
            canonical_stream_id TEXT NOT NULL,
            ticket_id          TEXT PRIMARY KEY,
            branch_id          TEXT NOT NULL,
            fifo_sequence      INTEGER NOT NULL,
            ticket_json        BLOB NOT NULL,
            state              TEXT NOT NULL,
            losses             INTEGER NOT NULL DEFAULT 0,
            reservation_loss_floor INTEGER NOT NULL DEFAULT 0,
            reserved_until_ms  INTEGER,
            completed_at_ms    INTEGER
         );
         CREATE UNIQUE INDEX IF NOT EXISTS _snapback_promotion_fifo
           ON _snapback_promotion_admission(canonical_stream_id, fifo_sequence);
         CREATE TABLE IF NOT EXISTS _snapback_promotion_receipts (
            ticket_id          TEXT PRIMARY KEY,
            aggregate_identity_json BLOB NOT NULL,
            approved_facts_digest TEXT NOT NULL,
            request_digest     TEXT NOT NULL,
            receipt_json       BLOB NOT NULL
         );
         CREATE TABLE IF NOT EXISTS _snapback_promotion_source_joins (
            ticket_id          TEXT NOT NULL,
            source_ordinal     INTEGER NOT NULL,
            write_ordinal      INTEGER NOT NULL,
            source_operation_json BLOB NOT NULL,
            PRIMARY KEY(ticket_id, source_ordinal, write_ordinal)
         );
         CREATE TABLE IF NOT EXISTS _snapback_promotion_envelopes (
            ticket_id          TEXT PRIMARY KEY,
            envelope_json      BLOB NOT NULL
         );
         CREATE TABLE IF NOT EXISTS _snapback_promotion_effect_intents_v1 (
            ticket_id              TEXT NOT NULL,
            intent_id              TEXT PRIMARY KEY,
            branch_id              TEXT NOT NULL,
            source_operation_id    TEXT NOT NULL,
            effect_ordinal         INTEGER NOT NULL,
            egress_class           TEXT NOT NULL,
            settlement_capability  TEXT NOT NULL,
            idempotency_key        TEXT NOT NULL,
            principal_id           TEXT NOT NULL,
            grant_id               TEXT NOT NULL,
            authority_fingerprint  TEXT NOT NULL,
            state                  TEXT NOT NULL,
            captured_at_ms         INTEGER NOT NULL,
            initiated_at_ms        INTEGER,
            settled_at_ms          INTEGER,
            terminal_fact_digest   TEXT
         );
         CREATE INDEX IF NOT EXISTS _snapback_promotion_effects_by_ticket
           ON _snapback_promotion_effect_intents_v1(ticket_id,intent_id);
         CREATE TABLE IF NOT EXISTS _snapback_promotion_provisional_dependencies_v1 (
            ticket_id              TEXT NOT NULL,
            source_operation_id    TEXT NOT NULL,
            predecessor_version    INTEGER NOT NULL,
            PRIMARY KEY(ticket_id,source_operation_id,predecessor_version)
         );",
    )?;
    let has_request_digest: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('_snapback_promotion_receipts')
          WHERE name = 'request_digest'",
        [],
        |row| row.get(0),
    )?;
    if has_request_digest == 0 {
        conn.execute(
            "ALTER TABLE _snapback_promotion_receipts ADD COLUMN request_digest TEXT",
            [],
        )?;
    }
    let has_reservation_loss_floor: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('_snapback_promotion_admission')
          WHERE name = 'reservation_loss_floor'",
        [],
        |row| row.get(0),
    )?;
    if has_reservation_loss_floor == 0 {
        conn.execute(
            "ALTER TABLE _snapback_promotion_admission
               ADD COLUMN reservation_loss_floor INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    Ok(())
}

#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectSettlementAuthorityV1 {
    pub principal_id: String,
    pub grant_id: String,
    #[schemars(pattern(SHA256_PATTERN))]
    pub authority_fingerprint: String,
    pub expires_at_ms: i64,
    pub revoked: bool,
}

#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EffectSettlementOutcomeV1 {
    Succeeded,
    Rejected,
    AmbiguousExternalEffect,
}

#[cfg(any(test, feature = "test-support"))]
impl EffectSettlementOutcomeV1 {
    fn state(self) -> CapturedEffectStateV1 {
        match self {
            Self::Succeeded => CapturedEffectStateV1::Succeeded,
            Self::Rejected => CapturedEffectStateV1::Rejected,
            Self::AmbiguousExternalEffect => CapturedEffectStateV1::AmbiguousExternalEffect,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotedEffectIntentV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub ticket_id: String,
    pub intent_id: String,
    pub branch_id: BranchId,
    pub source_operation_id: String,
    pub effect_ordinal: u64,
    pub egress_class: String,
    pub settlement_capability: EffectSettlementCapabilityV1,
    #[schemars(pattern(SHA256_PATTERN))]
    pub idempotency_key: String,
    pub principal_id: String,
    pub grant_id: String,
    #[schemars(pattern(SHA256_PATTERN))]
    pub authority_fingerprint: String,
    pub state: CapturedEffectStateV1,
    pub captured_at_ms: i64,
    pub initiated_at_ms: Option<i64>,
    pub settled_at_ms: Option<i64>,
    #[schemars(pattern(SHA256_PATTERN))]
    pub terminal_fact_digest: Option<String>,
}

#[cfg(any(test, feature = "test-support"))]
#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectInitiationV1 {
    pub intent: PromotedEffectIntentV1,
    pub already_initiated: bool,
}

type PromotedEffectRowV1 = (
    String,
    String,
    String,
    String,
    i64,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    i64,
    Option<i64>,
    Option<i64>,
    Option<String>,
);

fn promoted_effect_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PromotedEffectRowV1> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
        row.get(11)?,
        row.get(12)?,
        row.get(13)?,
        row.get(14)?,
        row.get(15)?,
    ))
}

fn decode_promoted_effect(raw: PromotedEffectRowV1) -> SnapbackResult<PromotedEffectIntentV1> {
    let (
        ticket_id,
        intent_id,
        branch_id,
        operation_id,
        effect_ordinal,
        egress_class,
        capability,
        idempotency_key,
        principal_id,
        grant_id,
        authority_fingerprint,
        state,
        captured_at_ms,
        initiated_at_ms,
        settled_at_ms,
        terminal_fact_digest,
    ) = raw;
    Ok(PromotedEffectIntentV1 {
        schema_version: 1,
        ticket_id,
        intent_id,
        branch_id: BranchId(branch_id),
        source_operation_id: operation_id,
        effect_ordinal: effect_ordinal.max(0) as u64,
        egress_class,
        settlement_capability: EffectSettlementCapabilityV1::parse(&capability)?,
        idempotency_key,
        principal_id,
        grant_id,
        authority_fingerprint,
        state: CapturedEffectStateV1::parse(&state)?,
        captured_at_ms,
        initiated_at_ms,
        settled_at_ms,
        terminal_fact_digest,
    })
}

pub(crate) fn promoted_effect_intents(
    conn: &Connection,
    ticket_id: &str,
) -> SnapbackResult<Vec<PromotedEffectIntentV1>> {
    ensure_promotion_tables(conn)?;
    let mut statement = conn.prepare(
        "SELECT ticket_id,intent_id,branch_id,source_operation_id,effect_ordinal,egress_class,
                settlement_capability,idempotency_key,principal_id,grant_id,
                authority_fingerprint,state,captured_at_ms,initiated_at_ms,
                settled_at_ms,terminal_fact_digest
           FROM _snapback_promotion_effect_intents_v1
          WHERE ticket_id=?1 ORDER BY source_operation_id,effect_ordinal,intent_id",
    )?;
    let rows = statement.query_map(params![ticket_id], promoted_effect_from_row)?;
    rows.map(|row| decode_promoted_effect(row?)).collect()
}

#[cfg(any(test, feature = "test-support"))]
fn load_promoted_effect(
    conn: &Connection,
    ticket_id: &str,
    intent_id: &str,
) -> SnapbackResult<PromotedEffectIntentV1> {
    let raw = conn
        .query_row(
            "SELECT ticket_id,intent_id,branch_id,source_operation_id,effect_ordinal,egress_class,
                    settlement_capability,idempotency_key,principal_id,grant_id,
                    authority_fingerprint,state,captured_at_ms,initiated_at_ms,
                    settled_at_ms,terminal_fact_digest
               FROM _snapback_promotion_effect_intents_v1
              WHERE ticket_id=?1 AND intent_id=?2",
            params![ticket_id, intent_id],
            promoted_effect_from_row,
        )
        .optional()?
        .ok_or_else(|| {
            error(
                "SNAPBACK_PROMOTION_EFFECT_INTENT_MISSING",
                "promotion has no captured effect intent with that identity",
            )
        })?;
    decode_promoted_effect(raw)
}

#[cfg(any(test, feature = "test-support"))]
fn effect_authority_matches(
    intent: &PromotedEffectIntentV1,
    authority: &EffectSettlementAuthorityV1,
    now_ms: i64,
) -> bool {
    !authority.revoked
        && now_ms < authority.expires_at_ms
        && authority.principal_id == intent.principal_id
        && authority.grant_id == intent.grant_id
        && authority.authority_fingerprint == intent.authority_fingerprint
}

/// Persist the external-initiation boundary before a provider call is made.
/// A crash after this returns leaves an Initiated row with the same stable
/// idempotency key; retry can recover it but cannot report the promotion as a
/// no-op or launch under different authority.
#[cfg(any(test, feature = "test-support"))]
pub(crate) fn begin_promoted_effect_settlement(
    canonical: &mut Connection,
    ticket_id: &str,
    intent_id: &str,
    authority: &EffectSettlementAuthorityV1,
    now_ms: i64,
) -> SnapbackResult<EffectInitiationV1> {
    ensure_promotion_tables(canonical)?;
    let tx = canonical.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut intent = load_promoted_effect(&tx, ticket_id, intent_id)?;
    if !effect_authority_matches(&intent, authority, now_ms) {
        if intent.state == CapturedEffectStateV1::CanonicalPending {
            let refusal_digest =
                digest_json(b"effect-settlement-terminal-fact-v1", &"authority-refused")?;
            tx.execute(
                "UPDATE _snapback_promotion_effect_intents_v1
                    SET state='authorityRefused',settled_at_ms=?3,
                        terminal_fact_digest=?4
                  WHERE ticket_id=?1 AND intent_id=?2 AND state='canonicalPending'",
                params![ticket_id, intent_id, now_ms, refusal_digest],
            )?;
            tx.commit()?;
        }
        return Err(error(
            "SNAPBACK_PROMOTION_EFFECT_AUTHORITY_DENIED",
            "current effect-settlement authority is stale, revoked, or divergent",
        ));
    }
    if intent.state == CapturedEffectStateV1::Initiated {
        tx.commit()?;
        return Ok(EffectInitiationV1 {
            intent,
            already_initiated: true,
        });
    }
    if intent.state != CapturedEffectStateV1::CanonicalPending {
        return Err(error(
            "SNAPBACK_PROMOTION_EFFECT_NOT_PENDING",
            "only a canonical pending effect may begin external settlement",
        ));
    }
    let changed = tx.execute(
        "UPDATE _snapback_promotion_effect_intents_v1
            SET state='initiated',initiated_at_ms=?3
          WHERE ticket_id=?1 AND intent_id=?2 AND state='canonicalPending'",
        params![ticket_id, intent_id, now_ms],
    )?;
    if changed != 1 {
        return Err(error(
            "SNAPBACK_PROMOTION_EFFECT_FENCE_LOST",
            "effect settlement lost its canonical initiation fence",
        ));
    }
    tx.commit()?;
    intent.state = CapturedEffectStateV1::Initiated;
    intent.initiated_at_ms = Some(now_ms);
    Ok(EffectInitiationV1 {
        intent,
        already_initiated: false,
    })
}

#[cfg(any(test, feature = "test-support"))]
pub(crate) fn finish_promoted_effect_settlement(
    canonical: &mut Connection,
    ticket_id: &str,
    intent_id: &str,
    outcome: EffectSettlementOutcomeV1,
    terminal_fact_digest: &str,
    now_ms: i64,
) -> SnapbackResult<PromotedEffectIntentV1> {
    if !is_sha256_digest(terminal_fact_digest) {
        return Err(error(
            "SNAPBACK_PROMOTION_EFFECT_RESULT_INVALID",
            "effect settlement accepts only a canonical terminal fact digest",
        ));
    }
    ensure_promotion_tables(canonical)?;
    let tx = canonical.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut intent = load_promoted_effect(&tx, ticket_id, intent_id)?;
    let terminal = outcome.state();
    if matches!(
        intent.state,
        CapturedEffectStateV1::Succeeded
            | CapturedEffectStateV1::Rejected
            | CapturedEffectStateV1::AmbiguousExternalEffect
    ) {
        if intent.state == terminal
            && intent.terminal_fact_digest.as_deref() == Some(terminal_fact_digest)
        {
            tx.commit()?;
            return Ok(intent);
        }
        return Err(error(
            "SNAPBACK_PROMOTION_EFFECT_RESULT_DIVERGED",
            "effect settlement retry diverged from its terminal provider fact",
        ));
    }
    if intent.state != CapturedEffectStateV1::Initiated {
        return Err(error(
            "SNAPBACK_PROMOTION_EFFECT_NOT_INITIATED",
            "an external effect cannot settle before its durable initiation boundary",
        ));
    }
    if intent.settlement_capability == EffectSettlementCapabilityV1::InherentlyAmbiguous
        && outcome != EffectSettlementOutcomeV1::AmbiguousExternalEffect
    {
        return Err(error(
            "SNAPBACK_PROMOTION_EFFECT_AMBIGUOUS",
            "an inherently ambiguous effect cannot manufacture terminal success or rejection",
        ));
    }
    tx.execute(
        "UPDATE _snapback_promotion_effect_intents_v1
            SET state=?3,settled_at_ms=?4,terminal_fact_digest=?5
          WHERE ticket_id=?1 AND intent_id=?2 AND state='initiated'",
        params![
            ticket_id,
            intent_id,
            terminal.as_str(),
            now_ms,
            terminal_fact_digest
        ],
    )?;
    tx.commit()?;
    intent.state = terminal;
    intent.settled_at_ms = Some(now_ms);
    intent.terminal_fact_digest = Some(terminal_fact_digest.to_owned());
    Ok(intent)
}

/// Mint one FIFO ticket. The budget formula is explicit and inspectable:
/// `max(observedConcurrentForks, queuePosition + R)`. The caller-supplied
/// policy must equal the frozen production v1 constants before admission.
#[allow(clippy::too_many_arguments)]
pub(crate) fn issue_promotion_ticket(
    canonical: &mut Connection,
    ticket_identity: OperationIdentityV1,
    branch_id: &BranchId,
    canonical_stream_id: &str,
    observed_concurrent_forks: u64,
    expires_at_ms: i64,
    now_ms: i64,
    contention_policy: PromotionContentionPolicyV1,
) -> SnapbackResult<PromotionAdmissionTicketV1> {
    ensure_promotion_tables(canonical)?;
    issue_promotion_ticket_with_prepared_infra(
        canonical,
        ticket_identity,
        branch_id,
        canonical_stream_id,
        observed_concurrent_forks,
        expires_at_ms,
        now_ms,
        contention_policy,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn issue_promotion_ticket_with_prepared_infra(
    canonical: &mut Connection,
    ticket_identity: OperationIdentityV1,
    branch_id: &BranchId,
    canonical_stream_id: &str,
    observed_concurrent_forks: u64,
    expires_at_ms: i64,
    now_ms: i64,
    contention_policy: PromotionContentionPolicyV1,
) -> SnapbackResult<PromotionAdmissionTicketV1> {
    contention_policy.validate()?;
    if ticket_identity.validate().is_err()
        || ticket_identity.key.originator_class != OperationOriginatorClassV1::Host
        || ticket_identity.key.stream_id != canonical_stream_id
    {
        return Err(error(
            "SNAPBACK_PROMOTION_TICKET_IDENTITY_INVALID",
            "promotion tickets require a server-authenticated host identity on the canonical stream",
        ));
    }
    // Ticket identity, idempotent replay, FIFO allocation, and host-lease
    // custody are one serialized admission decision. A deferred transaction
    // could let two issuers observe the same MAX(fifo_sequence) and turn fair
    // admission into a UNIQUE-constraint race.
    //
    // @ref LLP 0162#5-promotion-stays-strict-and-merge-free — admission order
    // is durable FIFO authority, so concurrent issuance itself must serialize.
    let tx = canonical.transaction_with_behavior(TransactionBehavior::Immediate)?;
    crate::operation_ledger::authenticate_host_identity(&tx, &ticket_identity)?;
    if let Some(bytes) = tx
        .query_row(
            "SELECT ticket_json FROM _snapback_promotion_admission WHERE ticket_id = ?1",
            params![ticket_identity.key.operation_id],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()?
    {
        let stored: PromotionAdmissionTicketV1 = decode_json(&bytes, "promotion ticket")?;
        if stored.ticket_identity != ticket_identity
            || stored.branch_id != *branch_id
            || stored.canonical_stream_id != canonical_stream_id
            || stored.observed_concurrent_forks != observed_concurrent_forks
            || stored.expires_at_ms != expires_at_ms
            || stored.contention_policy != contention_policy
        {
            return Err(error(
                "SNAPBACK_PROMOTION_TICKET_IDENTITY_REUSED",
                "promotion ticket identity collides with divergent durable admission facts",
            ));
        }
        let lease_expiry = u64::try_from(stored.expires_at_ms).map_err(|_| {
            error(
                "SNAPBACK_PROMOTION_TICKET_TTL_INSUFFICIENT",
                "promotion ticket expiry must be a non-negative durable timestamp",
            )
        })?;
        crate::operation_ledger::register_host_identity_lease_in(
            &tx,
            &stored.ticket_identity,
            lease_expiry,
        )?;
        tx.commit()?;
        return Ok(stored);
    }
    let fifo_sequence: i64 = tx.query_row(
        "SELECT COALESCE(MAX(fifo_sequence), 0) + 1
           FROM _snapback_promotion_admission WHERE canonical_stream_id = ?1",
        params![canonical_stream_id],
        |row| row.get(0),
    )?;
    let live_queue_depth = {
        let mut statement = tx.prepare(
            "SELECT ticket_json FROM _snapback_promotion_admission
              WHERE canonical_stream_id = ?1 AND state = 'queued'
              ORDER BY fifo_sequence",
        )?;
        let queued = statement
            .query_map(params![canonical_stream_id], |row| row.get::<_, Vec<u8>>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        queued.into_iter().try_fold(0_u64, |count, bytes| {
            let queued: PromotionAdmissionTicketV1 = decode_json(&bytes, "promotion ticket")?;
            Ok::<_, SnapbackError>(count + u64::from(queued.expires_at_ms > now_ms))
        })?
    };
    let queue = live_queue_depth.saturating_add(1);
    let rebase_budget = observed_concurrent_forks
        .max(queue.saturating_add(contention_policy.reservation_after_losses));
    let minimum_lifetime = contention_policy
        .maximum_commit_duration_ms
        .saturating_mul(queue) as i64;
    if expires_at_ms <= now_ms.saturating_add(minimum_lifetime) {
        return Err(error(
            "SNAPBACK_PROMOTION_TICKET_TTL_INSUFFICIENT",
            "ticket lifetime cannot cover its queue-position service bound",
        ));
    }
    let ticket = PromotionAdmissionTicketV1 {
        schema_version: 1,
        ticket_identity,
        canonical_stream_id: canonical_stream_id.to_owned(),
        branch_id: branch_id.clone(),
        fifo_sequence: fifo_sequence.max(1) as u64,
        initial_queue_position: queue,
        observed_concurrent_forks,
        rebase_budget,
        losses: 0,
        expires_at_ms,
        contention_policy,
    };
    let lease_expiry = u64::try_from(ticket.expires_at_ms).map_err(|_| {
        error(
            "SNAPBACK_PROMOTION_TICKET_TTL_INSUFFICIENT",
            "promotion ticket expiry must be a non-negative durable timestamp",
        )
    })?;
    crate::operation_ledger::register_host_identity_lease_in(
        &tx,
        &ticket.ticket_identity,
        lease_expiry,
    )?;
    let bytes = json_bytes(&ticket, "promotion ticket")?;
    tx.execute(
        "INSERT INTO _snapback_promotion_admission
           (canonical_stream_id, ticket_id, branch_id, fifo_sequence, ticket_json, state)
         VALUES (?1, ?2, ?3, ?4, ?5, 'queued')",
        params![
            canonical_stream_id,
            ticket.ticket_identity.key.operation_id,
            branch_id.0,
            ticket.fifo_sequence as i64,
            bytes,
        ],
    )?;
    tx.commit()?;
    Ok(ticket)
}

fn require_exact_durable_ticket(
    canonical: &Connection,
    supplied: &PromotionAdmissionTicketV1,
) -> SnapbackResult<()> {
    let stored: Option<Vec<u8>> = canonical
        .query_row(
            "SELECT ticket_json FROM _snapback_promotion_admission WHERE ticket_id = ?1",
            params![supplied.ticket_identity.key.operation_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(stored) = stored else {
        return Err(error(
            "SNAPBACK_PROMOTION_TICKET_MISMATCH",
            "promotion ticket has no durable admission authority",
        ));
    };
    let stored: PromotionAdmissionTicketV1 = decode_json(&stored, "promotion ticket")?;
    if stored != *supplied {
        return Err(error(
            "SNAPBACK_PROMOTION_TICKET_MISMATCH",
            "caller-supplied promotion ticket diverges from durable admission authority",
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn seal_promotion_request(
    workspace: &MaterializedBase,
    diff: &ForkDiffReceiptV1,
    approval: PromotionApprovalV1,
    admission_ticket: PromotionAdmissionTicketV1,
    aggregate_identity: OperationIdentityV1,
    schema_hash: &str,
    key: &PromotionSealKey,
    now_ms: i64,
) -> SnapbackResult<PromotionRequestV1> {
    if diff.substrate != NetDiffSubstrateV1::JournalDerivedWithIndependentOracle
        || diff.digest_work_bytes == 0
    {
        return Err(error(
            "SNAPBACK_BRANCH_DIGEST_WORK_UNACCOUNTED",
            "strict promotion requires a journal-derived diff with explicit bounded digest-work accounting",
        ));
    }
    if !is_sha256_digest(schema_hash) {
        return Err(error(
            "SNAPBACK_PROMOTION_SCHEMA_IDENTITY_MISSING",
            "promotion requests require a canonical sha256 schema identity",
        ));
    }
    let (_, receipt) = branch_profile(&workspace.conn, &diff.branch_id)?;
    let operations = branch_operation_log(&workspace.conn, &diff.branch_id)?;
    let captured_intents = captured_effect_intents(&workspace.conn, &diff.branch_id)?;
    refuse_captured_effect_promotion(&operations, &captured_intents)?;
    if !receipt.promotable
        || (receipt.egress_policy == ForkEgressPolicyV1::DenyAll
            && receipt.deny_all_attempt_count != 0)
    {
        return Err(error(
            "SNAPBACK_BRANCH_NOT_PROMOTABLE",
            "only a promotable branch with policy-consistent effect custody can be sealed",
        ));
    }
    if now_ms >= approval.expires_at_ms
        || approval.approver_principal_id != receipt.grant.principal_id
        || approval.approver_grant_id != receipt.grant.grant_id
        || approval.authority_fingerprint != receipt.grant.authority_fingerprint
    {
        return Err(error(
            "SNAPBACK_PROMOTION_APPROVAL_INVALID",
            "promotion approval does not match the current branch-scoped grant",
        ));
    }
    if admission_ticket.branch_id != diff.branch_id
        || admission_ticket.ticket_identity != aggregate_identity
        || aggregate_identity.key.stream_id != diff.base_stream
    {
        return Err(error(
            "SNAPBACK_PROMOTION_TICKET_MISMATCH",
            "admission ticket, aggregate identity, branch, or stream diverged",
        ));
    }
    let head = child_current_version(&workspace.conn, &diff.branch_id)?.ok_or_else(|| {
        error(
            "SNAPBACK_BRANCH_STREAM_MISSING",
            "child stream missing at seal",
        )
    })?;
    if head != diff.child_head {
        return Err(error(
            "SNAPBACK_PROMOTION_DIFF_STALE",
            "branch head advanced after the reviewed diff",
        ));
    }
    let mut request = PromotionRequestV1 {
        schema_version: 1,
        branch_id: diff.branch_id.clone(),
        child_stream_id: diff.child_stream_id.clone(),
        reviewed_child_head: head,
        base_stream: diff.base_stream.clone(),
        base_version: diff.base_version,
        operation_log_digest: operation_log_digest(&operations)?,
        diff_digest: diff.diff_digest.clone(),
        manifest_digest: diff.coverage.digest()?,
        approved_facts_digest: approved_facts_digest(&operations)?,
        schema_hash: schema_hash.to_owned(),
        approval,
        admission_ticket,
        aggregate_identity,
        rebase_attestation: None,
        seal: String::new(),
    };
    request.seal = promotion_request_seal(&request, key)?;
    Ok(request)
}

pub fn reseal_after_rebase(
    prior: &PromotionRequestV1,
    rebased_workspace: &MaterializedBase,
    rebased_diff: &ForkDiffReceiptV1,
    engine_identity: impl Into<String>,
    schema_hash: &str,
    key: &PromotionSealKey,
    now_ms: i64,
) -> SnapbackResult<PromotionRequestV1> {
    if promotion_request_seal(prior, key)? != prior.seal {
        return Err(error(
            "SNAPBACK_PROMOTION_REQUEST_SEAL_INVALID",
            "prior promotion request seal is invalid",
        ));
    }
    if !is_sha256_digest(schema_hash) || schema_hash != prior.schema_hash {
        return Err(error(
            "SNAPBACK_PROMOTION_REBASE_DIVERGED",
            "automatic re-seal cannot preserve approval across a schema identity change",
        ));
    }
    let operations =
        branch_operation_log(rebased_workspace.writable_head(), &rebased_diff.branch_id)?;
    let rebased_facts = approved_facts_digest(&operations)?;
    if rebased_facts != prior.approved_facts_digest {
        return Err(error(
            "SNAPBACK_PROMOTION_REBASE_DIVERGED",
            "rebased reads, decisions, results, writes, effects, artifact, or coverage diverged; fresh approval required",
        ));
    }
    if prior.admission_ticket.ticket_identity != prior.aggregate_identity {
        return Err(error(
            "SNAPBACK_PROMOTION_TICKET_MISMATCH",
            "aggregate identity is not the inherited admission ticket identity",
        ));
    }
    let approval_digest = digest_json(b"preserved-promotion-approval", &prior.approval)?;
    let mut request = PromotionRequestV1 {
        schema_version: 1,
        branch_id: rebased_diff.branch_id.clone(),
        child_stream_id: rebased_diff.child_stream_id.clone(),
        reviewed_child_head: rebased_diff.child_head,
        base_stream: rebased_diff.base_stream.clone(),
        base_version: rebased_diff.base_version,
        operation_log_digest: operation_log_digest(&operations)?,
        diff_digest: rebased_diff.diff_digest.clone(),
        manifest_digest: rebased_diff.coverage.digest()?,
        approved_facts_digest: rebased_facts,
        schema_hash: schema_hash.to_owned(),
        approval: prior.approval.clone(),
        admission_ticket: prior.admission_ticket.clone(),
        aggregate_identity: prior.aggregate_identity.clone(),
        rebase_attestation: Some(RebaseEngineAttestationV1 {
            engine_identity: engine_identity.into(),
            prior_branch_id: prior.branch_id.clone(),
            prior_child_stream_id: prior.child_stream_id.clone(),
            preserved_approval_digest: approval_digest,
            attested_at_ms: now_ms,
        }),
        seal: String::new(),
    };
    request.seal = promotion_request_seal(&request, key)?;
    Ok(request)
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum PromotionAuthorityDecisionV1 {
    Revalidated {
        grant_id: String,
        #[schemars(pattern(SHA256_PATTERN))]
        authority_fingerprint: String,
    },
    Denied,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotionReceiptV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub aggregate_identity: OperationIdentityV1,
    pub branch_id: BranchId,
    pub canonical_stream_id: String,
    pub canonical_version: u64,
    #[schemars(pattern(SHA256_PATTERN))]
    pub approved_facts_digest: String,
    pub source_operation_count: u64,
    pub source_write_fact_count: u64,
    pub boundary_proof: BoundaryProofV1,
    pub state: String,
    pub committed_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotionResultV1 {
    pub receipt: PromotionReceiptV1,
    pub aggregate_envelope: CommitEnvelopeV1,
}

fn active_fifo_ticket(
    canonical: &Connection,
    stream: &str,
    now_ms: i64,
) -> SnapbackResult<Option<String>> {
    let mut statement = canonical.prepare(
        "SELECT ticket_id,ticket_json FROM _snapback_promotion_admission
          WHERE canonical_stream_id = ?1 AND state = 'queued'
          ORDER BY fifo_sequence",
    )?;
    let rows = statement
        .query_map(params![stream], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (ticket_id, bytes) in rows {
        let ticket: PromotionAdmissionTicketV1 = decode_json(&bytes, "promotion ticket")?;
        if ticket.expires_at_ms > now_ms {
            return Ok(Some(ticket_id));
        }
    }
    Ok(None)
}

fn note_ticket_loss(
    canonical: &Connection,
    ticket: &PromotionAdmissionTicketV1,
) -> SnapbackResult<()> {
    let changed = canonical.execute(
        "UPDATE _snapback_promotion_admission SET losses = losses + 1
          WHERE ticket_id = ?1 AND state = 'queued'",
        params![ticket.ticket_identity.key.operation_id],
    )?;
    if changed != 1 {
        return Err(error(
            "SNAPBACK_PROMOTION_CONTENTION_EXHAUSTED",
            "only the exact queued durable ticket can record a promotion loss",
        ));
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PromotionAdmissionStateV1 {
    losses: u64,
    reservation_loss_floor: u64,
    reserved_until_ms: Option<i64>,
}

fn promotion_admission_state(
    conn: &Connection,
    ticket: &PromotionAdmissionTicketV1,
) -> SnapbackResult<PromotionAdmissionStateV1> {
    conn.query_row(
        "SELECT losses,reservation_loss_floor,reserved_until_ms
           FROM _snapback_promotion_admission
          WHERE ticket_id = ?1 AND state = 'queued'",
        params![ticket.ticket_identity.key.operation_id],
        |row| {
            let losses = row.get::<_, i64>(0)?.max(0) as u64;
            let reservation_loss_floor = row.get::<_, i64>(1)?.max(0) as u64;
            Ok(PromotionAdmissionStateV1 {
                losses,
                reservation_loss_floor,
                reserved_until_ms: row.get(2)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| {
        error(
            "SNAPBACK_PROMOTION_CONTENTION_EXHAUSTED",
            "promotion ticket is no longer queued for admission",
        )
    })
}

fn live_reservation_deadline(
    state: PromotionAdmissionStateV1,
    ticket: &PromotionAdmissionTicketV1,
    now_ms: i64,
) -> Option<i64> {
    state
        .reserved_until_ms
        .map(|until| until.min(ticket.expires_at_ms))
        .filter(|until| *until > now_ms)
}

fn stored_promotion_result(
    canonical: &Connection,
    request: &PromotionRequestV1,
) -> SnapbackResult<Option<PromotionResultV1>> {
    type StoredPromotionResultRow = (Vec<u8>, String, Option<String>, Vec<u8>);
    let row: Option<StoredPromotionResultRow> = canonical
        .query_row(
            "SELECT aggregate_identity_json, approved_facts_digest, request_digest, receipt_json
               FROM _snapback_promotion_receipts WHERE ticket_id = ?1",
            params![request.aggregate_identity.key.operation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((identity_bytes, stored_facts, stored_request_digest, receipt_bytes)) = row else {
        return Ok(None);
    };
    let identity: OperationIdentityV1 = decode_json(&identity_bytes, "stored aggregate identity")?;
    let request_digest = promotion_request_digest(request)?;
    if identity != request.aggregate_identity
        || stored_facts != request.approved_facts_digest
        || stored_request_digest.as_deref() != Some(request_digest.as_str())
    {
        return Err(error(
            "SNAPBACK_PROMOTION_IDENTITY_REUSED",
            "aggregate identity was reused with divergent durable promotion request facts",
        ));
    }
    let receipt: PromotionReceiptV1 = decode_json(&receipt_bytes, "promotion receipt")?;
    let envelope_bytes: Vec<u8> = canonical.query_row(
        "SELECT envelope_json FROM _snapback_promotion_envelopes WHERE ticket_id = ?1",
        params![request.aggregate_identity.key.operation_id],
        |row| row.get(0),
    )?;
    let aggregate_envelope = decode_json(&envelope_bytes, "promotion envelope")?;
    Ok(Some(PromotionResultV1 {
        receipt,
        aggregate_envelope,
    }))
}

fn aggregate_fact_set(domain: &[u8], values: Vec<Value>) -> SnapbackResult<EnvelopeFactSetV1> {
    Ok(EnvelopeFactSetV1 {
        digest: digest_json(domain, &values)?,
        count: values.len() as u64,
        provenance: FactProvenanceV1::ServerCaptured,
        detail: RetainedEnvelopeDetailV1::InlineRedacted {
            detail: json!({ "count": values.len() }),
        },
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PromotionColumnV1 {
    name: String,
    declared_type: String,
    primary_key_ordinal: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PromotionTableV1 {
    name: String,
    columns: Vec<PromotionColumnV1>,
    primary_key_index: usize,
}

#[derive(Clone, Debug, PartialEq)]
struct PromotionJournalFactV1 {
    table_name: String,
    row_id: String,
    operation: &'static str,
    row: Option<Value>,
}

#[derive(Clone, Debug, PartialEq)]
struct PromotionDiffConsistencyV1 {
    table_name: String,
    row_id: String,
    disposition: NetDiffDispositionV1,
    post_image: Option<Value>,
}

/// Read-only canonical state exposed to command replay. The underlying SQLite
/// connection stays private: callers can observe declared application rows,
/// but cannot execute raw SQL or bypass the promotion journal.
pub struct PromotionReplayContextV1<'a> {
    canonical: &'a Connection,
}

impl PromotionReplayContextV1<'_> {
    pub fn read_row(&self, table_name: &str, row_id: &str) -> SnapbackResult<Option<Value>> {
        let table = promotion_table(self.canonical, table_name)?;
        scan_promotion_row(self.canonical, &table, row_id)
    }
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn promotion_write_refused(message: impl Into<String>) -> SnapbackError {
    error("SNAPBACK_PROMOTION_WRITE_PATH_UNCOVERED", message)
}

fn ensure_no_inbound_write_side_effects(
    conn: &Connection,
    target_table: &str,
) -> SnapbackResult<()> {
    let foreign_keys_enabled: i64 = conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    if foreign_keys_enabled == 0 {
        return Ok(());
    }
    let mut tables = conn.prepare(
        "SELECT name FROM sqlite_schema
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let names = tables
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for source_table in names {
        let mut foreign_keys = conn.prepare(&format!(
            "PRAGMA foreign_key_list({})",
            quote_identifier(&source_table)
        ))?;
        let mut query = foreign_keys.query([])?;
        while let Some(row) = query.next()? {
            let referenced_table: String = row.get(2)?;
            let on_delete: String = row.get(6)?;
            if referenced_table == target_table
                && !matches!(on_delete.as_str(), "NO ACTION" | "RESTRICT")
            {
                return Err(promotion_write_refused(format!(
                    "promotion target table {target_table:?} has an inbound {on_delete} foreign-key action from {source_table:?}"
                )));
            }
        }
    }
    Ok(())
}

fn ensure_internal_promotion_path_has_no_triggers(conn: &Connection) -> SnapbackResult<()> {
    let trigger_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_schema
          WHERE type = 'trigger' AND substr(tbl_name,1,10) = '_snapback_'",
        [],
        |row| row.get(0),
    )?;
    if trigger_count != 0 {
        return Err(promotion_write_refused(
            "canonical Snapback tables have trigger side paths outside the promotion journal proof",
        ));
    }
    Ok(())
}

fn promotion_table(conn: &Connection, table_name: &str) -> SnapbackResult<PromotionTableV1> {
    if table_name.trim().is_empty()
        || table_name.starts_with("_snapback_")
        || table_name.starts_with("sqlite_")
        || table_name.contains('\0')
    {
        return Err(promotion_write_refused(
            "promotion writes may target only named application tables",
        ));
    }
    let table_sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?1",
            params![table_name],
            |row| row.get(0),
        )
        .optional()?;
    let table_sql = table_sql.ok_or_else(|| {
        promotion_write_refused(format!(
            "promotion target table {table_name:?} is missing or is not an ordinary table"
        ))
    })?;
    if table_sql.to_ascii_uppercase().contains("VIRTUAL TABLE") {
        return Err(promotion_write_refused(format!(
            "promotion target table {table_name:?} is virtual"
        )));
    }
    let trigger_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ?1",
        params![table_name],
        |row| row.get(0),
    )?;
    if trigger_count != 0 {
        return Err(promotion_write_refused(format!(
            "promotion target table {table_name:?} has a trigger whose writes cannot be journal-proven"
        )));
    }
    ensure_no_inbound_write_side_effects(conn, table_name)?;

    let mut statement = conn.prepare(&format!(
        "PRAGMA table_xinfo({})",
        quote_identifier(table_name)
    ))?;
    let mut query = statement.query([])?;
    let mut columns = Vec::new();
    while let Some(row) = query.next()? {
        let hidden: i64 = row.get(6)?;
        if hidden != 0 {
            return Err(promotion_write_refused(format!(
                "promotion target table {table_name:?} has generated or hidden columns"
            )));
        }
        columns.push(PromotionColumnV1 {
            name: row.get(1)?,
            declared_type: row.get(2)?,
            primary_key_ordinal: row.get(5)?,
        });
    }
    let primary_keys = columns
        .iter()
        .enumerate()
        .filter(|(_, column)| column.primary_key_ordinal > 0)
        .collect::<Vec<_>>();
    if columns.is_empty() || primary_keys.len() != 1 || primary_keys[0].1.primary_key_ordinal != 1 {
        return Err(promotion_write_refused(format!(
            "promotion target table {table_name:?} must have exactly one declared primary key"
        )));
    }
    let primary_key_index = primary_keys[0].0;
    drop(primary_keys);
    Ok(PromotionTableV1 {
        name: table_name.to_owned(),
        columns,
        primary_key_index,
    })
}

fn json_from_sql_value(value: ValueRef<'_>) -> SnapbackResult<Value> {
    match value {
        ValueRef::Null => Ok(Value::Null),
        ValueRef::Integer(value) => Ok(json!(value)),
        ValueRef::Real(value) => serde_json::Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| {
                promotion_write_refused("promotion boundary contains a non-finite numeric value")
            }),
        ValueRef::Text(value) => Ok(Value::String(
            std::str::from_utf8(value)
                .map_err(|_| promotion_write_refused("promotion boundary contains non-UTF-8 text"))?
                .to_owned(),
        )),
        ValueRef::Blob(_) => Err(promotion_write_refused(
            "promotion boundary does not yet cover blob-valued application columns",
        )),
    }
}

fn row_id_from_json(value: &Value) -> SnapbackResult<String> {
    match value {
        Value::String(value) => Ok(value.clone()),
        Value::Number(value) if value.as_i64().is_some() => Ok(value.to_string()),
        Value::Number(value) if value.as_u64().is_some() => Ok(value.to_string()),
        _ => Err(promotion_write_refused(
            "promotion row identity must be a string or integral JSON number",
        )),
    }
}

fn sql_from_json_value(value: &Value) -> SnapbackResult<SqlValue> {
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::Bool(value) => Ok(SqlValue::Integer(i64::from(*value))),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                Ok(SqlValue::Integer(value))
            } else if let Some(value) = value.as_u64() {
                i64::try_from(value).map(SqlValue::Integer).map_err(|_| {
                    promotion_write_refused("promotion integer exceeds SQLite's signed range")
                })
            } else if let Some(value) = value.as_f64() {
                Ok(SqlValue::Real(value))
            } else {
                Err(promotion_write_refused(
                    "promotion write contains a non-canonical numeric value",
                ))
            }
        }
        Value::String(value) => Ok(SqlValue::Text(value.clone())),
        Value::Array(_) | Value::Object(_) => Err(promotion_write_refused(
            "promotion writes do not infer physical encodings for structured application columns",
        )),
    }
}

fn row_value(row: &rusqlite::Row<'_>, table: &PromotionTableV1) -> SnapbackResult<Value> {
    let mut object = serde_json::Map::new();
    for (index, column) in table.columns.iter().enumerate() {
        object.insert(
            column.name.clone(),
            json_from_sql_value(row.get_ref(index)?)?,
        );
    }
    Ok(Value::Object(object))
}

fn scan_promotion_row(
    conn: &Connection,
    table: &PromotionTableV1,
    row_id: &str,
) -> SnapbackResult<Option<Value>> {
    let columns = table
        .columns
        .iter()
        .map(|column| quote_identifier(&column.name))
        .collect::<Vec<_>>()
        .join(", ");
    let primary_key = &table.columns[table.primary_key_index].name;
    let mut statement = conn.prepare(&format!(
        "SELECT {columns} FROM {} WHERE {} = ?1",
        quote_identifier(&table.name),
        quote_identifier(primary_key),
    ))?;
    let mut rows = statement.query(params![row_id])?;
    let value = rows.next()?.map(|row| row_value(row, table)).transpose()?;
    if let Some(value) = &value {
        let actual_id = row_id_from_json(&value[primary_key])?;
        if actual_id != row_id {
            return Err(promotion_write_refused(format!(
                "promotion row identity {row_id:?} is not canonical; storage returned {actual_id:?}"
            )));
        }
    }
    Ok(value)
}

fn scan_promotion_table(
    conn: &Connection,
    table: &PromotionTableV1,
) -> SnapbackResult<Vec<BoundaryRowV1>> {
    let columns = table
        .columns
        .iter()
        .map(|column| quote_identifier(&column.name))
        .collect::<Vec<_>>()
        .join(", ");
    let primary_key = &table.columns[table.primary_key_index].name;
    let mut statement = conn.prepare(&format!(
        "SELECT {columns} FROM {} ORDER BY {}",
        quote_identifier(&table.name),
        quote_identifier(primary_key),
    ))?;
    let mut query = statement.query([])?;
    let mut rows = Vec::new();
    while let Some(row) = query.next()? {
        let value = row_value(row, table)?;
        rows.push(BoundaryRowV1 {
            qualified_table: table.name.clone(),
            row_id: row_id_from_json(&value[primary_key])?,
            value,
        });
    }
    rows.sort_by(|left, right| {
        (&left.qualified_table, &left.row_id).cmp(&(&right.qualified_table, &right.row_id))
    });
    Ok(rows)
}

fn scan_promotion_scope(
    conn: &Connection,
    scope: &BTreeSet<String>,
) -> SnapbackResult<(Vec<PromotionTableV1>, Vec<BoundaryRowV1>)> {
    let mut tables = Vec::new();
    let mut rows = Vec::new();
    for table_name in scope {
        let table = promotion_table(conn, table_name)?;
        rows.extend(scan_promotion_table(conn, &table)?);
        tables.push(table);
    }
    Ok((tables, rows))
}

fn validate_captured_effect_custody(
    policy: ForkEgressPolicyV1,
    operations: &[BranchOperationV1],
    intents: &[CapturedEffectIntentV1],
) -> SnapbackResult<()> {
    if policy == ForkEgressPolicyV1::DenyAll {
        if !intents.is_empty()
            || operations
                .iter()
                .any(|operation| !operation.approved_facts.effects.is_empty())
        {
            return Err(error(
                "SNAPBACK_BRANCH_NOT_PROMOTABLE",
                "DenyAll promotion cannot retain approved effect facts",
            ));
        }
        return Ok(());
    }
    let by_operation = operations
        .iter()
        .map(|operation| {
            (
                operation.identity.key.operation_id.as_str(),
                operation.child_version,
            )
        })
        .collect::<BTreeMap<_, _>>();
    for intent in intents {
        let child_version = by_operation
            .get(intent.operation_id.as_str())
            .ok_or_else(|| {
                error(
                    "SNAPBACK_BRANCH_EFFECT_LEDGER_INVALID",
                    "captured effect intent has no terminal source operation",
                )
            })?;
        if intent.child_version != Some(*child_version)
            || intent.state != CapturedEffectStateV1::Captured
        {
            return Err(error(
                "SNAPBACK_BRANCH_EFFECT_LEDGER_INVALID",
                "captured effect intent is orphaned, nonterminal, or version-divergent",
            ));
        }
    }
    for operation in operations {
        let expected = intents
            .iter()
            .filter(|intent| intent.operation_id == operation.identity.key.operation_id)
            .map(captured_effect_fact)
            .collect::<Vec<_>>();
        if operation.approved_facts.effects != expected {
            return Err(error(
                "SNAPBACK_BRANCH_EFFECT_LEDGER_INVALID",
                "approved effect facts do not exactly match the ordered captured-intent ledger",
            ));
        }
    }
    Ok(())
}

fn refuse_captured_effect_promotion(
    operations: &[BranchOperationV1],
    intents: &[CapturedEffectIntentV1],
) -> SnapbackResult<()> {
    if !intents.is_empty()
        || operations
            .iter()
            .any(|operation| !operation.approved_facts.effects.is_empty())
    {
        return Err(error(
            "SNAPBACK_PROMOTION_CAPTURE_ONLY_UNSUPPORTED",
            "strict promotion refuses captured effects until product-owned provider custody and ordered settlement exist",
        ));
    }
    Ok(())
}

pub fn provisional_effect_dependencies(
    operations: &[BranchOperationV1],
) -> SnapbackResult<Vec<(String, u64)>> {
    let known_versions = operations
        .iter()
        .map(|operation| operation.child_version)
        .collect::<BTreeSet<_>>();
    let mut inherited_roots = BTreeMap::<u64, BTreeSet<u64>>::new();
    let mut dependencies = Vec::new();
    for operation in operations {
        let mut roots = BTreeSet::new();
        for predecessor in &operation.causal_predecessors {
            if *predecessor >= operation.child_version || !known_versions.contains(predecessor) {
                return Err(error(
                    "SNAPBACK_BRANCH_CAUSAL_ORDER_INVALID",
                    "operation causal predecessors must name retained earlier child versions",
                ));
            }
            roots.extend(
                inherited_roots
                    .get(predecessor)
                    .cloned()
                    .unwrap_or_default(),
            );
        }
        let inherited_effect = !roots.is_empty();
        if !operation.approved_facts.effects.is_empty() {
            roots.insert(operation.child_version);
        }
        if inherited_effect
            && (!operation.approved_facts.writes.is_empty()
                || !operation.approved_facts.effects.is_empty())
            && operation
                .approved_facts
                .decision
                .get("provisionalRepresentation")
                != Some(&Value::Bool(true))
        {
            return Err(error(
                "SNAPBACK_PROMOTION_PROVISIONAL_REPRESENTATION_REQUIRED",
                "a transitive effect-dependent write or effect lacks an explicit provisional representation",
            ));
        }
        for root in &roots {
            if *root != operation.child_version {
                dependencies.push((operation.identity.key.operation_id.clone(), *root));
            }
        }
        inherited_roots.insert(operation.child_version, roots);
    }
    Ok(dependencies)
}

fn promotion_scope(
    operations: &[BranchOperationV1],
    egress_policy: ForkEgressPolicyV1,
) -> SnapbackResult<BTreeSet<String>> {
    let mut scope = BTreeSet::new();
    for operation in operations {
        let coverage = operation.approved_facts.coverage.clone().normalized();
        if coverage.covered_lanes != [PROMOTION_WRITER_LANE_V1]
            || !coverage.uncovered_lanes.is_empty()
            || coverage.schema_covered
            || coverage.system_fields_covered
            || coverage.assets_covered
            || coverage.effects_covered != (egress_policy == ForkEgressPolicyV1::CaptureOnly)
        {
            return Err(error(
                "SNAPBACK_PROMOTION_WRITE_COVERAGE_INCOMPLETE",
                "v1 promotion covers only the enumerated ordinary-mutation application-row lane",
            ));
        }
        if !operation.approved_facts.writes.is_empty()
            && operation.approved_facts.coverage.covered_lanes.is_empty()
        {
            return Err(error(
                "SNAPBACK_PROMOTION_WRITE_COVERAGE_INCOMPLETE",
                "an operation with approved writes has no covered journal lane",
            ));
        }
        if !operation.approved_facts.coverage.uncovered_lanes.is_empty() {
            return Err(error(
                "SNAPBACK_PROMOTION_WRITE_COVERAGE_INCOMPLETE",
                "an operation retains uncovered lanes and cannot produce a complete envelope",
            ));
        }
        for write in &operation.approved_facts.writes {
            if write.table_name.trim().is_empty() || write.row_id.trim().is_empty() {
                return Err(error(
                    "SNAPBACK_PROMOTION_APPROVED_FACTS_INVALID",
                    "approved write table and row identity must be non-empty",
                ));
            }
            scope.insert(write.table_name.clone());
        }
    }
    Ok(scope)
}

fn folded_approved_writes(
    base_rows: &[BoundaryRowV1],
    operations: &[BranchOperationV1],
) -> SnapbackResult<Vec<PromotionApprovedWriteV1>> {
    let base = base_rows
        .iter()
        .map(|row| {
            (
                (row.qualified_table.clone(), row.row_id.clone()),
                canonicalize_json(row.value.clone()),
            )
        })
        .collect::<BTreeMap<_, _>>();
    if base.len() != base_rows.len() {
        return Err(error(
            "SNAPBACK_PROMOTION_BASE_DUPLICATE_ROW",
            "trusted base scan produced a duplicate row identity",
        ));
    }
    let mut final_rows = base.clone();
    for operation in operations {
        for write in &operation.approved_facts.writes {
            let key = (write.table_name.clone(), write.row_id.clone());
            match &write.after {
                Some(post_image) => {
                    final_rows.insert(key, canonicalize_json(post_image.clone()));
                }
                None => {
                    if final_rows.remove(&key).is_none() {
                        return Err(error(
                            "SNAPBACK_PROMOTION_APPROVED_FACTS_CONFLICT",
                            format!(
                                "approved delete targets absent row {:?}/{:?}",
                                write.table_name, write.row_id
                            ),
                        ));
                    }
                }
            }
        }
    }
    let keys = base
        .keys()
        .chain(final_rows.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut writes = Vec::new();
    for (table_name, row_id) in keys {
        let before = base.get(&(table_name.clone(), row_id.clone()));
        let after = final_rows.get(&(table_name.clone(), row_id.clone()));
        let kind = match (before, after) {
            (None, Some(_)) => Some(PromotionWriteKindV1::Insert),
            (Some(_), None) => Some(PromotionWriteKindV1::Delete),
            (Some(before), Some(after)) if before != after => Some(PromotionWriteKindV1::Update),
            _ => None,
        };
        if let Some(kind) = kind {
            writes.push(PromotionApprovedWriteV1 {
                qualified_table: table_name,
                row_id,
                kind,
                post_image: after.cloned(),
            });
        }
    }
    Ok(writes)
}

fn validate_diff_against_approved_facts(
    diff: &ForkDiffReceiptV1,
    base_rows: &[BoundaryRowV1],
    operations: &[BranchOperationV1],
    approved_writes: &[PromotionApprovedWriteV1],
) -> SnapbackResult<()> {
    let expected_attribution = operations
        .iter()
        .flat_map(|operation| {
            operation
                .approved_facts
                .writes
                .iter()
                .enumerate()
                .map(move |(ordinal, write)| AttributedChangeV1 {
                    child_version: operation.child_version,
                    operation_identity: operation.identity.clone(),
                    principal_id: operation.principal_id.clone(),
                    write_ordinal: ordinal as u64,
                    write: write.clone(),
                })
        })
        .collect::<Vec<_>>();
    if diff.attributed_changes != expected_attribution {
        return Err(error(
            "SNAPBACK_PROMOTION_DIFF_FACTS_MISMATCH",
            "sealed diff attribution does not match the sealed operation write facts",
        ));
    }
    let base = base_rows
        .iter()
        .map(|row| {
            (
                (row.qualified_table.clone(), row.row_id.clone()),
                canonicalize_json(row.value.clone()),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let approved_consistency = approved_writes
        .iter()
        .map(|write| PromotionDiffConsistencyV1 {
            table_name: write.qualified_table.clone(),
            row_id: write.row_id.clone(),
            disposition: match write.kind {
                PromotionWriteKindV1::Insert => NetDiffDispositionV1::Added,
                PromotionWriteKindV1::Update => NetDiffDispositionV1::Updated,
                PromotionWriteKindV1::Delete => NetDiffDispositionV1::Deleted,
            },
            post_image: write.post_image.clone(),
        })
        .collect::<Vec<_>>();
    let mut diff_consistency = Vec::new();
    let mut prior: Option<(&str, &str)> = None;
    for row in &diff.net_diff {
        let key = (row.table_name.as_str(), row.row_id.as_str());
        if prior.is_some_and(|previous| previous >= key) {
            return Err(error(
                "SNAPBACK_PROMOTION_DIFF_FACTS_MISMATCH",
                "sealed net diff is not unique and canonically ordered",
            ));
        }
        prior = Some(key);
        if row
            .before
            .as_ref()
            .map(|value| canonicalize_json(value.clone()))
            != base
                .get(&(row.table_name.clone(), row.row_id.clone()))
                .cloned()
        {
            return Err(error(
                "SNAPBACK_PROMOTION_DIFF_FACTS_MISMATCH",
                "sealed net diff pre-image does not match the immutable base",
            ));
        }
        diff_consistency.push(PromotionDiffConsistencyV1 {
            table_name: row.table_name.clone(),
            row_id: row.row_id.clone(),
            disposition: row.disposition,
            post_image: row.after.clone().map(canonicalize_json),
        });
    }
    if diff_consistency != approved_consistency {
        return Err(error(
            "SNAPBACK_PROMOTION_DIFF_FACTS_MISMATCH",
            "sealed net diff is inconsistent with the independently folded approved write facts",
        ));
    }
    Ok(())
}

fn apply_approved_write(
    tx: &Transaction<'_>,
    table: &PromotionTableV1,
    write: &LogicalWriteFactV1,
    version: u64,
    now_ms: u64,
    aggregate_operation_id: &str,
) -> SnapbackResult<PromotionJournalFactV1> {
    let before = scan_promotion_row(tx, table, &write.row_id)?;
    let primary_key = &table.columns[table.primary_key_index].name;
    let (operation, actual_row) = if let Some(after) = &write.after {
        let after = canonicalize_json(after.clone());
        let object = after.as_object().ok_or_else(|| {
            promotion_write_refused("approved row post-image must be a complete JSON object")
        })?;
        if object.len() != table.columns.len()
            || table
                .columns
                .iter()
                .any(|column| !object.contains_key(&column.name))
        {
            return Err(promotion_write_refused(format!(
                "approved post-image for {:?}/{:?} is not a complete physical row",
                table.name, write.row_id
            )));
        }
        if row_id_from_json(&object[primary_key])? != write.row_id {
            return Err(promotion_write_refused(format!(
                "approved post-image identity does not match {:?}/{:?}",
                table.name, write.row_id
            )));
        }
        let values = table
            .columns
            .iter()
            .map(|column| sql_from_json_value(&object[&column.name]))
            .collect::<SnapbackResult<Vec<_>>>()?;
        let operation = if before.is_some() { "update" } else { "insert" };
        if before.is_some() {
            let assignments = table
                .columns
                .iter()
                .enumerate()
                .filter(|(index, _)| *index != table.primary_key_index)
                .map(|(index, column)| {
                    format!("{} = ?{}", quote_identifier(&column.name), index + 1)
                })
                .collect::<Vec<_>>();
            if assignments.is_empty() {
                return Err(promotion_write_refused(
                    "promotion cannot journal an update to a primary-key-only table",
                ));
            }
            let mut update_values = values.clone();
            update_values.push(values[table.primary_key_index].clone());
            let changed = tx.execute(
                &format!(
                    "UPDATE {} SET {} WHERE {} = ?{}",
                    quote_identifier(&table.name),
                    assignments.join(", "),
                    quote_identifier(primary_key),
                    update_values.len(),
                ),
                params_from_iter(update_values.iter()),
            )?;
            if changed != 1 {
                return Err(promotion_write_refused(
                    "constrained promotion update did not affect exactly one row",
                ));
            }
        } else {
            let columns = table
                .columns
                .iter()
                .map(|column| quote_identifier(&column.name))
                .collect::<Vec<_>>()
                .join(", ");
            let placeholders = (1..=values.len())
                .map(|index| format!("?{index}"))
                .collect::<Vec<_>>()
                .join(", ");
            let changed = tx.execute(
                &format!(
                    "INSERT INTO {} ({columns}) VALUES ({placeholders})",
                    quote_identifier(&table.name),
                ),
                params_from_iter(values.iter()),
            )?;
            if changed != 1 {
                return Err(promotion_write_refused(
                    "constrained promotion insert did not affect exactly one row",
                ));
            }
        }
        let actual = scan_promotion_row(tx, table, &write.row_id)?.ok_or_else(|| {
            promotion_write_refused("promoted row disappeared before journal capture")
        })?;
        if actual != after {
            return Err(promotion_write_refused(
                "physical row encoding diverged from the approved logical post-image",
            ));
        }
        (operation, Some(actual))
    } else {
        let before = before.ok_or_else(|| {
            error(
                "SNAPBACK_PROMOTION_APPROVED_FACTS_CONFLICT",
                "approved delete targets a row absent from staged canonical state",
            )
        })?;
        let primary_key_value = sql_from_json_value(&before[primary_key])?;
        let changed = tx.execute(
            &format!(
                "DELETE FROM {} WHERE {} = ?1",
                quote_identifier(&table.name),
                quote_identifier(primary_key),
            ),
            params_from_iter([primary_key_value].iter()),
        )?;
        if changed != 1 || scan_promotion_row(tx, table, &write.row_id)?.is_some() {
            return Err(promotion_write_refused(
                "constrained promotion delete did not remove exactly one row",
            ));
        }
        ("delete", None)
    };
    let op = match operation {
        "insert" => crate::storage::ChangeOp::Insert,
        "update" => crate::storage::ChangeOp::Update,
        "delete" => crate::storage::ChangeOp::Delete,
        _ => unreachable!("closed promotion journal operation"),
    };
    crate::storage::record_promotion_change(
        tx,
        version,
        &table.name,
        &write.row_id,
        op,
        actual_row.as_ref(),
        now_ms,
        aggregate_operation_id,
    )?;
    Ok(PromotionJournalFactV1 {
        table_name: table.name.clone(),
        row_id: write.row_id.clone(),
        operation,
        row: actual_row,
    })
}

struct JournalCompletenessProofV1;

fn verify_promotion_journal(
    tx: &Transaction<'_>,
    version: u64,
    expected: &[PromotionJournalFactV1],
) -> SnapbackResult<JournalCompletenessProofV1> {
    let mut statement = tx.prepare(
        "SELECT table_name,row_id,op,row_json FROM _snapback_changes
          WHERE version = ?1 ORDER BY id",
    )?;
    let mut query = statement.query(params![version as i64])?;
    let mut actual = Vec::new();
    while let Some(row) = query.next()? {
        let raw: Option<String> = row.get(3)?;
        actual.push(PromotionJournalFactV1 {
            table_name: row.get(0)?,
            row_id: row.get(1)?,
            operation: match row.get::<_, String>(2)?.as_str() {
                "insert" => "insert",
                "update" => "update",
                "delete" => "delete",
                _ => {
                    return Err(promotion_write_refused(
                        "promotion journal contains an unknown operation",
                    ));
                }
            },
            row: raw
                .map(|raw| decode_json::<Value>(raw.as_bytes(), "promotion journal row"))
                .transpose()?
                .map(canonicalize_json),
        });
    }
    if actual != expected {
        return Err(promotion_write_refused(
            "canonical promotion writes are not completely represented in the change journal",
        ));
    }
    Ok(JournalCompletenessProofV1)
}

fn build_aggregate_envelope(
    request: &PromotionRequestV1,
    operations: &[BranchOperationV1],
    canonical_version: u64,
    receipt_digest: String,
    now_ms: i64,
    _journal_completeness: &JournalCompletenessProofV1,
) -> SnapbackResult<CommitEnvelopeV1> {
    let reads = operations
        .iter()
        .map(|operation| operation.approved_facts.read_facts.clone())
        .collect();
    let writes = operations
        .iter()
        .flat_map(|operation| operation.approved_facts.writes.iter())
        .map(|write| serde_json::to_value(write).unwrap_or(Value::Null))
        .collect();
    let ctx = operations
        .iter()
        .map(|operation| operation.approved_facts.ctx_answers.clone())
        .collect();
    let arguments = operations
        .iter()
        .map(|operation| operation.canonical_arguments.clone())
        .collect::<Vec<_>>();
    let effect_facts = operations
        .iter()
        .flat_map(|operation| operation.approved_facts.effects.iter().cloned())
        .collect::<Vec<_>>();
    let mut egress_families = Vec::new();
    let mut settlement_capabilities = Vec::new();
    for effect in &effect_facts {
        let family = match effect.get("egressClass").and_then(Value::as_str) {
            Some("fetch" | "stream_open" | "stream_read" | "stream_cancel") => {
                EffectEgressFamilyV1::Fetch
            }
            Some("push_send" | "push_receipt") => EffectEgressFamilyV1::Notification,
            Some("jobs_enqueue" | "jobs_drain") => EffectEgressFamilyV1::Outbox,
            _ => EffectEgressFamilyV1::Uses,
        };
        if !egress_families.contains(&family) {
            egress_families.push(family);
        }
        let capability = match effect.get("settlementCapability").and_then(Value::as_str) {
            Some("providerIdempotent") => EnvelopeEffectSettlementCapabilityV1::ProviderIdempotent,
            Some("providerQueryable") => EnvelopeEffectSettlementCapabilityV1::ProviderQueryable,
            _ => EnvelopeEffectSettlementCapabilityV1::InherentlyAmbiguous,
        };
        if !settlement_capabilities.contains(&capability) {
            settlement_capabilities.push(capability);
        }
    }
    let envelope = CommitEnvelopeV1 {
        schema_version: 1,
        identity: request.aggregate_identity.clone(),
        snapshot: StreamQualifiedVersionV1 {
            stream_id: request.base_stream.clone(),
            version: canonical_version,
            association: SnapshotAssociationKindV1::ProducedCommit,
        },
        principal_session_or_invocation_id: request.approval.approver_principal_id.clone(),
        authority: EnvelopeAuthorityFactsV1 {
            audience: request.aggregate_identity.bound_facts.audience.clone(),
            grant_or_policy_identity: LaneFactV1::Defined(
                request.approval.approver_grant_id.clone(),
            ),
            fencing_token_or_epoch: LaneFactV1::Defined(
                request
                    .admission_ticket
                    .ticket_identity
                    .key
                    .operation_id
                    .clone(),
            ),
        },
        executable_artifact_digest: LaneFactV1::Defined(digest_json(
            b"promotion-artifacts",
            &operations
                .iter()
                .map(|operation| &operation.artifact_identity)
                .collect::<Vec<_>>(),
        )?),
        argument_digest: digest_json(b"promotion-arguments", &arguments)?,
        plan_digest: LaneFactV1::NotDefinedForLane,
        base_version: LaneFactV1::Defined(StreamQualifiedVersionV1 {
            stream_id: request.base_stream.clone(),
            version: request.base_version,
            association: SnapshotAssociationKindV1::ObservedSnapshot,
        }),
        read_set: aggregate_fact_set(b"promotion-read-facts", reads)?,
        write_set: aggregate_fact_set(b"promotion-write-facts", writes)?,
        ctx_answers: aggregate_fact_set(b"promotion-ctx-facts", ctx)?,
        effects: EnvelopeEffectFactsV1 {
            facts: aggregate_fact_set(b"promotion-effect-facts", effect_facts)?,
            egress_families,
            settlement_capabilities,
        },
        receipt: OperationReceiptV1 {
            state: OperationReceiptStateV1::Committed,
            receipt_digest,
            payload: RetainedEnvelopeDetailV1::InlineRedacted {
                detail: json!({
                    "canonicalVersion": canonical_version,
                    "capturedEffectCount": operations.iter()
                        .map(|operation| operation.approved_facts.effects.len() as u64)
                        .sum::<u64>(),
                }),
            },
        },
        coverage: EnvelopeCoverageV1 {
            covered_lanes: operations
                .iter()
                .flat_map(|operation| operation.approved_facts.coverage.covered_lanes.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            uncovered_lanes: vec![PROMOTION_COVERAGE_GAP_V1.to_owned()],
            coverage_digest: request.manifest_digest.clone(),
        },
        recorded_at_ms: now_ms.max(0) as u64,
    };
    envelope.validate().map_err(|cause| {
        error(
            "SNAPBACK_PROMOTION_ENVELOPE_INVALID",
            format!("aggregate envelope validation failed: {cause:?}"),
        )
    })?;
    Ok(envelope)
}

/// The sole promotion entry point. `reexecute` receives retained invocation
/// inputs and a read-only canonical context. It cannot execute SQL. After each
/// replay reproduces its sealed facts, the product-owned transaction seam
/// applies only those approved logical writes and records every one through
/// the canonical change/history journal before publication.
#[allow(clippy::too_many_arguments)]
pub(crate) fn promote_by_reexecution<F>(
    canonical: &mut Connection,
    workspace: &MaterializedBase,
    diff: &ForkDiffReceiptV1,
    request: &PromotionRequestV1,
    key: &PromotionSealKey,
    authority: &PromotionAuthorityDecisionV1,
    now_ms: i64,
    schema_hash: &str,
    mut reexecute: F,
) -> SnapbackResult<PromotionResultV1>
where
    F: FnMut(
        &PromotionReplayContextV1<'_>,
        &BranchOperationV1,
    ) -> SnapbackResult<ApprovedOperationFactsV1>,
{
    // CaptureOnly is intentionally a truthful capture-and-refuse lane. Read
    // only the branch workspace first so an unsupported effect-bearing
    // request cannot create or mutate canonical promotion state.
    let operations = branch_operation_log(&workspace.conn, &request.branch_id)?;
    let captured_intents = captured_effect_intents(&workspace.conn, &request.branch_id)?;
    refuse_captured_effect_promotion(&operations, &captured_intents)?;
    ensure_promotion_tables(canonical)?;
    if let Some(stored) = stored_promotion_result(canonical, request)? {
        return Ok(stored);
    }
    if request.schema_version != 1 || promotion_request_seal(request, key)? != request.seal {
        return Err(error(
            "SNAPBACK_PROMOTION_REQUEST_SEAL_INVALID",
            "promotion request seal or schemaVersion is invalid",
        ));
    }
    require_exact_durable_ticket(canonical, &request.admission_ticket)?;
    let revalidated = matches!(
        authority,
        PromotionAuthorityDecisionV1::Revalidated {
            grant_id,
            authority_fingerprint,
        } if grant_id == &request.approval.approver_grant_id
            && authority_fingerprint == &request.approval.authority_fingerprint
    );
    if !revalidated || now_ms >= request.approval.expires_at_ms {
        return Err(error(
            "SNAPBACK_PROMOTION_AUTHORITY_DENIED",
            "current promotion authority was not revalidated",
        ));
    }
    if now_ms >= request.admission_ticket.expires_at_ms {
        return Err(error(
            "SNAPBACK_PROMOTION_TICKET_EXPIRED",
            "promotion ticket expired before admission",
        ));
    }
    let (_, branch) = branch_profile(&workspace.conn, &request.branch_id)?;
    if !branch.promotable
        || (branch.egress_policy == ForkEgressPolicyV1::DenyAll
            && branch.deny_all_attempt_count != 0)
    {
        return Err(error(
            "SNAPBACK_BRANCH_NOT_PROMOTABLE",
            "branch is foreclosed or its egress policy has a disqualifying attempt",
        ));
    }
    let current_child_head = child_current_version(&workspace.conn, &request.branch_id)?
        .ok_or_else(|| error("SNAPBACK_BRANCH_STREAM_MISSING", "child stream missing"))?;
    if current_child_head != request.reviewed_child_head
        || diff.child_head != request.reviewed_child_head
    {
        return Err(error(
            "SNAPBACK_PROMOTION_HEAD_CHANGED",
            "branch changed after approval; request is invalid",
        ));
    }
    validate_captured_effect_custody(branch.egress_policy, &operations, &captured_intents)?;
    let provisional_dependencies = provisional_effect_dependencies(&operations)?;
    if operation_log_digest(&operations)? != request.operation_log_digest
        || approved_facts_digest(&operations)? != request.approved_facts_digest
        || diff.diff_digest != request.diff_digest
        || diff.coverage.digest()? != request.manifest_digest
    {
        return Err(error(
            "SNAPBACK_PROMOTION_REQUEST_FACTS_DIVERGED",
            "sealed log, diff, manifest, or approved facts no longer match",
        ));
    }
    let active = active_fifo_ticket(canonical, &request.base_stream, now_ms)?;
    if active.as_deref() != Some(&request.admission_ticket.ticket_identity.key.operation_id) {
        return Err(error(
            "SNAPBACK_PROMOTION_NOT_FIFO_HEAD",
            "promotion admission is serialized in inherited FIFO order",
        ));
    }
    let mut admission_state = promotion_admission_state(canonical, &request.admission_ticket)?;
    if admission_state.losses >= request.admission_ticket.rebase_budget {
        return Err(error(
            "SNAPBACK_PROMOTION_CONTENTION_EXHAUSTED",
            "promotion exhausted its declared rebase budget",
        ));
    }
    let head = crate::storage::current_version_on(canonical)?;
    if head != request.base_version {
        note_ticket_loss(canonical, &request.admission_ticket)?;
        return Err(error(
            "SNAPBACK_PROMOTION_BASE_ADVANCED",
            format!(
                "strict CAS refused: canonical head {head} != base {}",
                request.base_version
            ),
        ));
    }
    let losses_since_reservation = admission_state
        .losses
        .saturating_sub(admission_state.reservation_loss_floor);
    let mut reservation_deadline =
        live_reservation_deadline(admission_state, &request.admission_ticket, now_ms);
    if reservation_deadline.is_none()
        && losses_since_reservation
            >= request
                .admission_ticket
                .contention_policy
                .reservation_after_losses
    {
        // Escalation is an engine action, not caller etiquette. Once the FIFO
        // head has accumulated the declared new-loss threshold, its next
        // attempt durably reserves the stream before replay begins.
        reservation_deadline = Some(request_head_reservation(
            canonical,
            &request.admission_ticket,
            now_ms,
        )?);
        admission_state = promotion_admission_state(canonical, &request.admission_ticket)?;
    }

    let started = Instant::now();
    if !is_sha256_digest(schema_hash) || schema_hash != request.schema_hash {
        return Err(error(
            "SNAPBACK_PROMOTION_SCHEMA_IDENTITY_MISSING",
            "promotion boundary proof requires the sealed canonical schema identity",
        ));
    }
    ensure_internal_promotion_path_has_no_triggers(canonical)?;
    let boundary_header = PromotionDigestHeaderV1 {
        algorithm_version: 1,
        promotion_identity: request.aggregate_identity.key.operation_id.clone(),
        parent_stream_id: request.base_stream.clone(),
        child_stream_id: request.child_stream_id.0.clone(),
        base_version: request.base_version,
        reviewed_head_version: request.reviewed_child_head,
        schema_hash: request.schema_hash.clone(),
        coverage_manifest_digest: request.manifest_digest.clone(),
        operation_log_digest: request.operation_log_digest.clone(),
        approved_facts_digest: request.approved_facts_digest.clone(),
    };
    // @ref LLP 0165#concrete-v1-digest-preimages-and-derivations--2026-08-03 —
    // expected state is predecessor-derived from the immutable base plus the
    // sealed operation write facts. The reviewed diff is only a separately
    // sealed consistency witness and never supplies proof post-images.
    let scope = promotion_scope(&operations, branch.egress_policy)?;
    let (base_tables, base_rows) = scan_promotion_scope(workspace.immutable_base(), &scope)?;
    let approved_writes = folded_approved_writes(&base_rows, &operations)?;
    validate_diff_against_approved_facts(diff, &base_rows, &operations, &approved_writes)?;
    let expected_boundary =
        derive_promotion_expected_digest(&boundary_header, &base_rows, &approved_writes)?;
    let new_version = crate::storage::next_storage_version(head)?;
    let tx = canonical.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let transactional_now_ms =
        now_ms.saturating_add(i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX));
    if transactional_now_ms >= request.admission_ticket.expires_at_ms {
        return Err(error(
            "SNAPBACK_PROMOTION_TICKET_EXPIRED",
            "promotion ticket expired before transactional admission",
        ));
    }
    if active_fifo_ticket(&tx, &request.base_stream, transactional_now_ms)?.as_deref()
        != Some(
            request
                .admission_ticket
                .ticket_identity
                .key
                .operation_id
                .as_str(),
        )
    {
        return Err(error(
            "SNAPBACK_PROMOTION_NOT_FIFO_HEAD",
            "promotion lost FIFO authority before transactional admission",
        ));
    }
    let transactional_head: i64 = tx.query_row(
        "SELECT version FROM _snapback_version WHERE id = 1",
        [],
        |row| row.get(0),
    )?;
    if transactional_head.max(0) as u64 != request.base_version {
        // The ordinary writer won immediately before our BEGIN IMMEDIATE.
        // Count that loss durably before returning so the reservation
        // threshold and rebase budget cannot be bypassed by admission races.
        note_ticket_loss(&tx, &request.admission_ticket)?;
        tx.commit()?;
        return Err(error(
            "SNAPBACK_PROMOTION_BASE_ADVANCED",
            "canonical head advanced at transaction admission",
        ));
    }
    let (canonical_tables, _) = scan_promotion_scope(&tx, &scope)?;
    if canonical_tables != base_tables {
        return Err(error(
            "SNAPBACK_PROMOTION_SCHEMA_DIVERGED",
            "canonical and immutable-base promotion table shapes differ",
        ));
    }
    let journal_rows_at_version: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM _snapback_changes WHERE version = ?1",
            params![new_version as i64],
            |row| row.get(0),
        )
        .map_err(|cause| {
            promotion_write_refused(format!(
                "canonical change journal is unavailable before promotion: {cause}"
            ))
        })?;
    if journal_rows_at_version != 0 {
        return Err(promotion_write_refused(
            "canonical change journal already contains rows for the proposed promotion version",
        ));
    }
    let tables = canonical_tables
        .into_iter()
        .map(|table| (table.name.clone(), table))
        .collect::<BTreeMap<_, _>>();
    let mut expected_journal = Vec::new();
    for operation in &operations {
        let replayed = reexecute(&PromotionReplayContextV1 { canonical: &tx }, operation)?;
        if replayed != operation.approved_facts {
            return Err(error(
                "SNAPBACK_PROMOTION_REPLAY_DIVERGED",
                format!(
                    "re-execution facts diverged for operation {:?}",
                    operation.identity.key.operation_id
                ),
            ));
        }
        for write in &replayed.writes {
            let table = tables.get(&write.table_name).ok_or_else(|| {
                promotion_write_refused("replayed write escaped the sealed promotion scope")
            })?;
            expected_journal.push(apply_approved_write(
                &tx,
                table,
                write,
                new_version,
                now_ms.max(0) as u64,
                &request.aggregate_identity.key.operation_id,
            )?);
        }
    }
    let (_, actual_rows) = scan_promotion_scope(&tx, &scope)?;
    let actual_boundary = promotion_boundary_digest(&boundary_header, &actual_rows)?;
    let boundary_proof = BoundaryProofV1::independent(
        expected_boundary,
        actual_boundary,
        "immutable materialized base plus deterministically folded sealed operation write facts",
    )?;
    if !boundary_proof.matches {
        return Err(error(
            "SNAPBACK_PROMOTION_BOUNDARY_MISMATCH",
            "staged canonical state does not match the independently derived approved boundary",
        ));
    }
    if started.elapsed().as_millis()
        > request
            .admission_ticket
            .contention_policy
            .maximum_commit_duration_ms as u128
    {
        return Err(error(
            "SNAPBACK_PROMOTION_COMMIT_TIMEOUT",
            "staged promotion exceeded its declared maximum commit duration",
        ));
    }
    let elapsed_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
    let finished_at_ms = now_ms.saturating_add(elapsed_ms);
    if finished_at_ms >= request.admission_ticket.expires_at_ms {
        return Err(error(
            "SNAPBACK_PROMOTION_TICKET_EXPIRED",
            "promotion ticket expired before its canonical commit",
        ));
    }
    if reservation_deadline.is_some_and(|until| finished_at_ms >= until) {
        return Err(error(
            "SNAPBACK_PROMOTION_RESERVATION_EXPIRED",
            "bounded head reservation expired before canonical commit; ticket remains queued",
        ));
    }
    debug_assert!(
        admission_state.reservation_loss_floor <= admission_state.losses,
        "durable reservation loss floor cannot lead recorded losses"
    );
    let journal_completeness = verify_promotion_journal(&tx, new_version, &expected_journal)?;
    crate::storage::set_promotion_version(&tx, new_version)?;
    for intent in &captured_intents {
        tx.execute(
            "INSERT INTO _snapback_promotion_effect_intents_v1(
               ticket_id,intent_id,branch_id,source_operation_id,effect_ordinal,
               egress_class,settlement_capability,idempotency_key,principal_id,
               grant_id,authority_fingerprint,state,captured_at_ms
             ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'canonicalPending',?12)",
            params![
                request.aggregate_identity.key.operation_id,
                intent.intent_id,
                intent.branch_id.0,
                intent.operation_id,
                intent.effect_ordinal as i64,
                intent.egress_class,
                intent.settlement_capability.as_str(),
                intent.idempotency_key,
                intent.principal_id,
                intent.grant_id,
                intent.authority_fingerprint,
                intent.captured_at_ms,
            ],
        )?;
    }
    for (source_operation_id, predecessor_version) in &provisional_dependencies {
        tx.execute(
            "INSERT INTO _snapback_promotion_provisional_dependencies_v1(
               ticket_id,source_operation_id,predecessor_version
             ) VALUES(?1,?2,?3)",
            params![
                request.aggregate_identity.key.operation_id,
                source_operation_id,
                *predecessor_version as i64,
            ],
        )?;
    }
    let source_write_fact_count = operations
        .iter()
        .map(|operation| operation.approved_facts.writes.len() as u64)
        .sum();
    let receipt = PromotionReceiptV1 {
        schema_version: 1,
        aggregate_identity: request.aggregate_identity.clone(),
        branch_id: request.branch_id.clone(),
        canonical_stream_id: request.base_stream.clone(),
        canonical_version: new_version,
        approved_facts_digest: request.approved_facts_digest.clone(),
        source_operation_count: operations.len() as u64,
        source_write_fact_count,
        boundary_proof,
        state: if captured_intents.is_empty() {
            "committedNoEffects".to_owned()
        } else {
            "committedEffectsPending".to_owned()
        },
        committed_at_ms: now_ms,
    };
    let receipt_digest = digest_json(b"promotion-receipt", &receipt)?;
    let envelope = build_aggregate_envelope(
        request,
        &operations,
        new_version,
        receipt_digest,
        now_ms,
        &journal_completeness,
    )?;
    for (source_ordinal, operation) in operations.iter().enumerate() {
        let operation_json = json_bytes(operation, "source operation join")?;
        if operation.approved_facts.writes.is_empty() {
            tx.execute(
                "INSERT INTO _snapback_promotion_source_joins
                   (ticket_id, source_ordinal, write_ordinal, source_operation_json)
                 VALUES (?1, ?2, -1, ?3)",
                params![
                    request.aggregate_identity.key.operation_id,
                    source_ordinal as i64,
                    operation_json,
                ],
            )?;
        } else {
            for write_ordinal in 0..operation.approved_facts.writes.len() {
                tx.execute(
                    "INSERT INTO _snapback_promotion_source_joins
                       (ticket_id, source_ordinal, write_ordinal, source_operation_json)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        request.aggregate_identity.key.operation_id,
                        source_ordinal as i64,
                        write_ordinal as i64,
                        operation_json,
                    ],
                )?;
            }
        }
    }
    tx.execute(
        "INSERT INTO _snapback_promotion_receipts
           (ticket_id, aggregate_identity_json, approved_facts_digest, request_digest, receipt_json)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            request.aggregate_identity.key.operation_id,
            json_bytes(&request.aggregate_identity, "aggregate identity")?,
            request.approved_facts_digest,
            promotion_request_digest(request)?,
            json_bytes(&receipt, "promotion receipt")?,
        ],
    )?;
    tx.execute(
        "INSERT INTO _snapback_promotion_envelopes (ticket_id, envelope_json)
         VALUES (?1, ?2)",
        params![
            request.aggregate_identity.key.operation_id,
            json_bytes(&envelope, "aggregate promotion envelope")?,
        ],
    )?;
    tx.execute(
        "UPDATE _snapback_promotion_admission
            SET state = 'completed', completed_at_ms = ?2
          WHERE ticket_id = ?1",
        params![request.aggregate_identity.key.operation_id, now_ms],
    )?;
    crate::operation_ledger::complete_host_identity_lease_in(
        &tx,
        &request.aggregate_identity,
        now_ms.max(0) as u64,
    )?;
    tx.commit()?;
    Ok(PromotionResultV1 {
        receipt,
        aggregate_envelope: envelope,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CanonicalAdmissionV1 {
    Admit,
    DeferredByPromotionReservation { until_ms: i64 },
}

/// Ordinary canonical writers consult this gate when a losing FIFO ticket has
/// escalated to its bounded reservation. The v1 numeric terms are frozen by
/// `PRODUCTION_PROMOTION_CONTENTION_POLICY_V1` and the admission validator.
pub(crate) fn canonical_mutation_admission(
    conn: &Connection,
    canonical_stream_id: &str,
    now_ms: i64,
) -> SnapbackResult<CanonicalAdmissionV1> {
    ensure_promotion_tables(conn)?;
    canonical_mutation_admission_if_present(conn, canonical_stream_id, now_ms)
}

fn canonical_mutation_admission_if_present(
    conn: &Connection,
    canonical_stream_id: &str,
    now_ms: i64,
) -> SnapbackResult<CanonicalAdmissionV1> {
    let admission_table: bool = conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM sqlite_schema
            WHERE type='table' AND name='_snapback_promotion_admission'
         )",
        [],
        |row| row.get(0),
    )?;
    if !admission_table {
        return Ok(CanonicalAdmissionV1::Admit);
    }
    let mut statement = conn.prepare(
        "SELECT reserved_until_ms,ticket_json FROM _snapback_promotion_admission
          WHERE canonical_stream_id = ?1 AND state = 'queued'
            AND reserved_until_ms > ?2",
    )?;
    let reservations = statement
        .query_map(params![canonical_stream_id, now_ms], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut until = None;
    for (reserved_until_ms, ticket_json) in reservations {
        let ticket: PromotionAdmissionTicketV1 = decode_json(&ticket_json, "promotion ticket")?;
        let effective_until = reserved_until_ms.min(ticket.expires_at_ms);
        if effective_until > now_ms {
            until = Some(until.map_or(effective_until, |prior: i64| prior.max(effective_until)));
        }
    }
    Ok(match until {
        Some(until_ms) => CanonicalAdmissionV1::DeferredByPromotionReservation { until_ms },
        None => CanonicalAdmissionV1::Admit,
    })
}

/// Enforce the promotion reservation from inside the ordinary writer's
/// `BEGIN IMMEDIATE` transaction. The shared SQLite writer lock makes the
/// admission observation and the eventual app commit indivisible with
/// reservation acquisition; a preflight outside this transaction would leave
/// a race in which a writer could cross a newly committed reservation.
///
/// @ref LLP 0162#5-promotion-stays-strict-and-merge-free — after the declared
/// loss threshold, the FIFO head receives one bounded interval in which
/// ordinary canonical mutations are deferred.
pub(crate) fn enforce_canonical_mutation_admission_in(
    conn: &Connection,
    canonical_stream_id: &str,
    now_ms: i64,
) -> SnapbackResult<()> {
    match canonical_mutation_admission_if_present(conn, canonical_stream_id, now_ms)? {
        CanonicalAdmissionV1::Admit => Ok(()),
        CanonicalAdmissionV1::DeferredByPromotionReservation { until_ms } => Err(error(
            "SNAPBACK_PROMOTION_HEAD_RESERVED",
            format!(
                "ordinary canonical mutation is deferred by the FIFO promotion head until {until_ms}"
            ),
        )
        .with_details(json!({ "untilMs": until_ms }))),
    }
}

pub(crate) fn request_head_reservation(
    conn: &Connection,
    ticket: &PromotionAdmissionTicketV1,
    now_ms: i64,
) -> SnapbackResult<i64> {
    ensure_promotion_tables(conn)?;
    request_head_reservation_with_prepared_infra(conn, ticket, now_ms)
}

pub(crate) fn request_head_reservation_with_prepared_infra(
    conn: &Connection,
    ticket: &PromotionAdmissionTicketV1,
    now_ms: i64,
) -> SnapbackResult<i64> {
    let tx = Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
    require_exact_durable_ticket(&tx, ticket)?;
    if now_ms >= ticket.expires_at_ms {
        return Err(error(
            "SNAPBACK_PROMOTION_TICKET_EXPIRED",
            "expired promotion tickets cannot reserve the canonical head",
        ));
    }
    if active_fifo_ticket(&tx, &ticket.canonical_stream_id, now_ms)?.as_deref()
        != Some(ticket.ticket_identity.key.operation_id.as_str())
    {
        return Err(error(
            "SNAPBACK_PROMOTION_NOT_FIFO_HEAD",
            "only the live FIFO head may reserve ordinary canonical writers",
        ));
    }
    let (losses, reservation_loss_floor, existing_reservation): (i64, i64, Option<i64>) = tx
        .query_row(
            "SELECT losses,reservation_loss_floor,reserved_until_ms
           FROM _snapback_promotion_admission WHERE ticket_id = ?1",
            params![ticket.ticket_identity.key.operation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
    if let Some(until) = existing_reservation
        .map(|until| until.min(ticket.expires_at_ms))
        .filter(|until| *until > now_ms)
    {
        tx.execute(
            "UPDATE _snapback_promotion_admission SET reserved_until_ms=?2 WHERE ticket_id=?1",
            params![ticket.ticket_identity.key.operation_id, until],
        )?;
        tx.commit()?;
        return Ok(until);
    }
    let new_losses = (losses.max(0) as u64).saturating_sub(reservation_loss_floor.max(0) as u64);
    if new_losses < ticket.contention_policy.reservation_after_losses {
        return Err(error(
            "SNAPBACK_PROMOTION_RESERVATION_NOT_ELIGIBLE",
            "ticket has not reached the declared new-loss threshold since its prior reservation",
        ));
    }
    let active_reservations: i64 = tx.query_row(
        "SELECT COUNT(*) FROM _snapback_promotion_admission
          WHERE canonical_stream_id = ?1 AND state = 'queued'
            AND reserved_until_ms > ?2",
        params![ticket.canonical_stream_id, now_ms],
        |row| row.get(0),
    )?;
    if active_reservations.max(0) as u64 >= ticket.contention_policy.reservation_quota {
        return Err(error(
            "SNAPBACK_PROMOTION_CONTENTION_EXHAUSTED",
            "bounded head-reservation quota is exhausted",
        ));
    }
    let until = now_ms
        .saturating_add(ticket.contention_policy.reservation_interval_ms as i64)
        .min(ticket.expires_at_ms);
    let changed = tx.execute(
        "UPDATE _snapback_promotion_admission
            SET reserved_until_ms = ?2, reservation_loss_floor = losses
          WHERE ticket_id = ?1 AND state = 'queued'",
        params![ticket.ticket_identity.key.operation_id, until],
    )?;
    if changed != 1 {
        return Err(error(
            "SNAPBACK_PROMOTION_RESERVATION_NOT_ELIGIBLE",
            "only the exact queued durable ticket can reserve the canonical head",
        ));
    }
    tx.commit()?;
    Ok(until)
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RebaseReplayReceiptV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub prior_branch_id: BranchId,
    pub rebased_branch_id: BranchId,
    pub prior_base_version: u64,
    pub rebased_base_version: u64,
    #[schemars(pattern(SHA256_PATTERN))]
    pub prior_approved_facts_digest: String,
    #[schemars(pattern(SHA256_PATTERN))]
    pub rebased_approved_facts_digest: String,
    pub meaning_preserved: bool,
    pub divergent_operation_ids: Vec<String>,
}

/// Re-execute the retained log into a fresh current-head branch. The inherited
/// admission ticket is intentionally not rewritten here; `reseal_after_rebase`
/// carries it forward only when the complete approved-facts digest is equal.
pub(crate) fn rebase_by_replay<F>(
    canonical: &mut Connection,
    prior_workspace: &MaterializedBase,
    prior_branch_id: &BranchId,
    create: &InAppBranchCreateV1,
    now_ms: i64,
    mut reexecute: F,
) -> SnapbackResult<(MaterializedBase, RebaseReplayReceiptV1)>
where
    F: FnMut(&Transaction<'_>, &BranchOperationV1) -> SnapbackResult<ApprovedOperationFactsV1>,
{
    let prior_operations = branch_operation_log(&prior_workspace.conn, prior_branch_id)?;
    let recorded_prior_branch_id = prior_operations
        .first()
        .map(|operation| operation.branch_id.clone())
        .ok_or_else(|| {
            error(
                "SNAPBACK_PROMOTION_REBASE_LOG_EMPTY",
                "rebase requires at least one replay-sufficient operation",
            )
        })?;
    let prior_base_version = prior_workspace.base_version;
    create_in_app_branch(canonical, create)?;
    let mut rebased = MaterializedBase::materialize(canonical, None)?;
    let mut divergent_operation_ids = Vec::new();
    for prior in &prior_operations {
        let mut identity = prior.identity.clone();
        identity.key.stream_id = create.child_stream_id.0.clone();
        let draft = BranchOperationDraftV1 {
            schema_version: 1,
            identity,
            artifact_identity: prior.artifact_identity.clone(),
            function_or_command: prior.function_or_command.clone(),
            canonical_arguments: prior.canonical_arguments.clone(),
            principal_id: create.grant.principal_id.clone(),
            grant_id: create.grant.grant_id.clone(),
            read_baseline: prior.read_baseline.clone(),
            replay_inputs: prior.replay_inputs.clone(),
            causal_predecessors: prior.causal_predecessors.clone(),
        };
        let replayed = execute_branch_operation(
            rebased.writable_head_mut(),
            &create.branch_id,
            &draft,
            now_ms,
            |tx, _| reexecute(tx, prior),
        )?;
        if replayed.approved_facts != prior.approved_facts {
            divergent_operation_ids.push(prior.identity.key.operation_id.clone());
        }
    }
    let rebased_operations = branch_operation_log(rebased.writable_head(), &create.branch_id)?;
    let prior_digest = approved_facts_digest(&prior_operations)?;
    let rebased_digest = approved_facts_digest(&rebased_operations)?;
    let receipt = RebaseReplayReceiptV1 {
        schema_version: 1,
        prior_branch_id: recorded_prior_branch_id,
        rebased_branch_id: create.branch_id.clone(),
        prior_base_version,
        rebased_base_version: rebased.base_version,
        prior_approved_facts_digest: prior_digest.clone(),
        rebased_approved_facts_digest: rebased_digest.clone(),
        meaning_preserved: prior_digest == rebased_digest && divergent_operation_ids.is_empty(),
        divergent_operation_ids,
    };
    Ok((rebased, receipt))
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchReapReceiptV1 {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub branch_id: BranchId,
    pub reason: String,
    pub reaped_at_ms: i64,
}

/// Reap expired registry/profile rows. It does not read or write the canonical
/// journal or replay-floor state; workspace files are separately destroyed by
/// `MaterializedBase::teardown`.
pub(crate) fn reap_expired_in_app_branches(
    conn: &mut Connection,
    now_ms: i64,
) -> SnapbackResult<Vec<BranchReapReceiptV1>> {
    ensure_in_app_branch_tables(conn)?;
    let mut statement = conn.prepare(
        "SELECT p.branch_id, p.profile_json
           FROM _snapback_in_app_branch_profiles p
           JOIN _snapback_branches b ON b.branch_id = p.branch_id",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    let expired = rows
        .into_iter()
        .filter_map(|(branch_id, bytes)| {
            let profile: InAppBranchCreateV1 = decode_json(&bytes, "branch profile").ok()?;
            let expiry = profile.created_at_ms.checked_add(profile.limits.ttl_ms)?;
            (now_ms >= expiry).then_some(BranchId(branch_id))
        })
        .collect::<Vec<_>>();
    let tx = conn.transaction()?;
    let mut receipts = Vec::new();
    for branch_id in expired {
        tx.execute(
            "DELETE FROM _snapback_branches WHERE branch_id = ?1",
            params![branch_id.0],
        )?;
        receipts.push(BranchReapReceiptV1 {
            schema_version: 1,
            branch_id,
            reason: "ttlExpired".to_owned(),
            reaped_at_ms: now_ms,
        });
    }
    tx.commit()?;
    Ok(receipts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commit_envelope::{
        IdentityEpochStateV1, IdentityEpochV1, OperationBoundFactsV1, OperationIssuanceV1,
        OperationKeyV1, derive_host_operation_id,
    };

    fn sha(character: char) -> String {
        format!("sha256:{}", character.to_string().repeat(64))
    }

    fn source(head: u64) -> Connection {
        let mut conn = Connection::open_in_memory().expect("source");
        conn.execute_batch(
            "CREATE TABLE _snapback_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
             CREATE TABLE _snapback_changes (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               version INTEGER NOT NULL,
               table_name TEXT NOT NULL,
               row_id TEXT NOT NULL,
               op TEXT NOT NULL,
               row_json TEXT,
               changed_at_ms INTEGER NOT NULL
             );
             CREATE TABLE _snapback_history_policies_v1 (
               table_name TEXT PRIMARY KEY,
               retain_ms INTEGER NOT NULL,
               max_rows INTEGER NOT NULL
             );
             CREATE TABLE _snapback_record_history_v1 (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               version INTEGER NOT NULL,
               table_name TEXT NOT NULL,
               row_id TEXT NOT NULL,
               op TEXT NOT NULL,
               row_json TEXT,
               changed_at_ms INTEGER NOT NULL,
               operation_id TEXT
             );
             CREATE TABLE _snapback_meta (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );
             CREATE TABLE _snapback_auth_retry_episodes (id TEXT PRIMARY KEY);
             CREATE TABLE _snapback_auth_retry_counters (id TEXT PRIMARY KEY);
             CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
             INSERT INTO widgets VALUES (1, 'alpha'), (2, 'beta');",
        )
        .expect("schema");
        conn.execute(
            "INSERT INTO _snapback_version VALUES (1, ?1)",
            params![head as i64],
        )
        .expect("head");
        let tx = conn.transaction().expect("host authority tx");
        crate::operation_ledger::create_infra(&tx).expect("operation infra");
        crate::operation_ledger::register_epoch_in(
            &tx,
            &IdentityEpochV1 {
                schema_version: 1,
                originator_class: OperationOriginatorClassV1::Host,
                audience: "app-1".to_owned(),
                authority_instance_id: "authority-1".to_owned(),
                epoch_id: "host-epoch-1".to_owned(),
                epoch_sequence: 1,
                state: IdentityEpochStateV1::Open,
                issued_at_ms: 1,
                terminated_at_ms: None,
                authority_authenticator_digest: sha('a'),
            },
        )
        .expect("host epoch");
        tx.commit().expect("commit host authority");
        conn
    }

    fn file_source(path: &Path, head: u64) -> Connection {
        let source = source(head);
        source
            .execute_batch(
                "CREATE TABLE _auth_sessions(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL);
                 INSERT INTO _auth_sessions VALUES('parent-session', 'parent-token-hash');",
            )
            .expect("parent credential fixture");
        let mut destination = Connection::open(path).expect("file source");
        {
            let backup = rusqlite::backup::Backup::new(&source, &mut destination).expect("backup");
            backup
                .run_to_completion(128, std::time::Duration::from_millis(1), None)
                .expect("copy source");
        }
        destination
    }

    #[test]
    fn promotion_scanner_orders_serialized_integer_row_ids_canonically() {
        let conn = source(5);
        conn.execute("INSERT INTO widgets(id, name) VALUES (10, 'ten')", [])
            .expect("multi-digit row");
        let table = promotion_table(&conn, "widgets").expect("promotion table");
        let rows = scan_promotion_table(&conn, &table).expect("promotion rows");
        let row_ids = rows
            .iter()
            .map(|row| row.row_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(row_ids, ["1", "10", "2"]);
    }

    fn host_identity(stream: &str, id: &str, audience: &str) -> OperationIdentityV1 {
        let upstream_identity = format!("upstream:{id}");
        OperationIdentityV1 {
            schema_version: 1,
            key: OperationKeyV1 {
                stream_id: stream.to_owned(),
                originator_class: OperationOriginatorClassV1::Host,
                operation_id: derive_host_operation_id(&upstream_identity, 0),
            },
            issuance: OperationIssuanceV1::HostIncarnation {
                epoch_id: "host-epoch-1".to_owned(),
                upstream_identity,
                commit_ordinal: 0,
                authority_authenticator_digest: sha('a'),
            },
            bound_facts: OperationBoundFactsV1 {
                audience: audience.to_owned(),
                principal_fingerprint: sha('b'),
                authority_instance_id: "authority-1".to_owned(),
                operation_kind: "promotion".to_owned(),
                function_or_command: "widgets.rename".to_owned(),
                input_fingerprint: sha('c'),
            },
        }
    }

    fn create_request(branch: &str, stream: &str, head: u64, now: i64) -> InAppBranchCreateV1 {
        InAppBranchCreateV1 {
            schema_version: 1,
            branch_id: BranchId(branch.to_owned()),
            child_stream_id: ChildStreamId(stream.to_owned()),
            base_stream: "canonical".to_owned(),
            base_version: head,
            artifact_binding: BranchArtifactBindingV1 {
                schema_hash: sha('1'),
                function_bundle_hash: sha('2'),
            },
            grant: BranchGrantV1 {
                principal_id: "agent-1".to_owned(),
                grant_id: "grant-1".to_owned(),
                audience: "app-1".to_owned(),
                authority_fingerprint: sha('d'),
                allowed_functions: vec!["widgets.rename".to_owned()],
                allowed_lanes: vec!["ordinaryMutation".to_owned()],
                expires_at_ms: now + 60_000,
            },
            limits: BranchLimitsV1 {
                max_live_branches_per_principal: 8,
                max_live_branches_per_app: 32,
                max_operations: 16,
                max_retained_bytes: 128 * 1024,
                max_diff_rows: 32,
                max_digest_work_bytes: 512 * 1024,
                ttl_ms: 30_000,
            },
            coverage: ForkCoverageV1 {
                covered_lanes: vec!["ordinaryMutation".to_owned()],
                uncovered_lanes: Vec::new(),
                schema_covered: false,
                system_fields_covered: false,
                assets_covered: false,
                effects_covered: false,
            },
            egress_policy: ForkEgressPolicyV1::DenyAll,
            created_at_ms: now,
        }
    }

    #[test]
    fn branch_creation_requires_canonical_schema_and_bundle_digests() {
        for field in ["schema", "bundle"] {
            let mut canonical = source(1);
            let mut request = create_request(
                &format!("invalid-{field}"),
                &format!("invalid-{field}-stream"),
                1,
                100,
            );
            if field == "schema" {
                request.artifact_binding.schema_hash = "not-a-digest".to_owned();
            } else {
                request.artifact_binding.function_bundle_hash = "sha256:ABC".to_owned();
            }
            assert_eq!(
                create_in_app_branch(&mut canonical, &request)
                    .expect_err("managed branch artifact pins are canonical sha256 digests")
                    .diagnostic
                    .code,
                "SNAPBACK_BRANCH_ARTIFACT_IDENTITY_MISSING"
            );
        }
    }

    #[test]
    fn managed_runtime_proves_isolation_scrubbed_authority_and_exhaustive_egress() {
        let directory = tempfile::tempdir().expect("tempdir");
        let canonical_path = directory.path().join("app.sqlite3");
        let mut canonical = file_source(&canonical_path, 7);
        crate::operation_detail::install(&canonical, Some(&canonical_path))
            .expect("parent protected-detail custody");
        {
            let tx = canonical.transaction().expect("parent detail transaction");
            crate::operation_detail::seal_in(
                &tx,
                "operation-detail:parent:reads",
                &sha('9'),
                &json!({ "private": "parent-only" }),
            )
            .expect("parent protected detail");
            tx.commit().expect("commit parent protected detail");
        }
        let parent_detail_key = fs::read(crate::operation_detail::keyring_path(&canonical_path))
            .expect("parent protected-detail sidecar");
        let left_request = create_request("left", "left-stream", 7, 100);
        let right_request = create_request("right", "right-stream", 7, 101);
        create_managed_in_app_branch(&mut canonical, &canonical_path, &left_request)
            .expect("left branch");
        create_managed_in_app_branch(&mut canonical, &canonical_path, &right_request)
            .expect("right branch");

        let left_path = managed_workspace_path(&canonical_path, &left_request.branch_id).unwrap();
        let right_path = managed_workspace_path(&canonical_path, &right_request.branch_id).unwrap();
        for path in [&left_path, &right_path] {
            let branch_key = fs::read(crate::operation_detail::keyring_path(path))
                .expect("branch-private protected-detail sidecar exists before publication");
            assert_ne!(
                branch_key, parent_detail_key,
                "managed branches never inherit the parent protected-detail key"
            );
        }

        let left =
            open_managed_in_app_branch(&canonical, &canonical_path, &left_request.branch_id, 200)
                .expect("open left");
        let right =
            open_managed_in_app_branch(&canonical, &canonical_path, &right_request.branch_id, 200)
                .expect("open right");
        left.conn
            .execute("UPDATE widgets SET name='left-only' WHERE id=1", [])
            .expect("left write");
        canonical
            .execute("UPDATE widgets SET name='parent-after-fork' WHERE id=2", [])
            .expect("parent post-fork write");
        assert_eq!(
            canonical
                .query_row("SELECT name FROM widgets WHERE id=1", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "alpha"
        );
        assert_eq!(
            right
                .conn
                .query_row("SELECT name FROM widgets WHERE id=1", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "alpha"
        );
        for workspace in [&left, &right] {
            assert_eq!(
                workspace
                    .conn
                    .query_row(
                        "SELECT COUNT(*) FROM _snapback_operation_protected_detail_v1",
                        [],
                        |row| row.get::<_, u64>(0),
                    )
                    .unwrap(),
                0,
                "parent protected ciphertext is scrubbed from the executable head"
            );
            assert_eq!(
                workspace
                    .conn
                    .query_row("SELECT name FROM widgets WHERE id=2", [], |row| {
                        row.get::<_, String>(0)
                    })
                    .unwrap(),
                "beta",
                "parent writes after the fork are invisible"
            );
            assert_eq!(
                workspace
                    .conn
                    .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| {
                        row.get::<_, u64>(0)
                    })
                    .unwrap(),
                0,
                "the executable head contains no copied canonical bearer"
            );
            assert_eq!(
                workspace
                    .immutable_base()
                    .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| {
                        row.get::<_, u64>(0)
                    })
                    .unwrap(),
                1,
                "the proof base remains the byte-exact fork snapshot"
            );
        }
        drop(left);
        drop(right);

        for family in crate::instance_fork::EgressFamily::ALL {
            let runtime = inspect_in_app_branch_boot(&left_path)
                .expect("boot inspection")
                .expect("branch runtime");
            assert_eq!(
                runtime.mediate(family, 200).diagnostic.code,
                "SNAPBACK_BRANCH_EGRESS_DENIED"
            );
        }
        let mut reopened =
            open_managed_in_app_branch(&canonical, &canonical_path, &left_request.branch_id, 200)
                .expect("reopen after deny markers");
        crate::operation_detail::install(&reopened.conn, Some(&left_path))
            .expect("branch-private custody reopens");
        let tx = reopened
            .conn
            .transaction()
            .expect("branch protected detail transaction");
        crate::operation_detail::seal_in(
            &tx,
            "operation-detail:branch:reads",
            &sha('8'),
            &json!({ "private": "branch-only" }),
        )
        .expect("branch custody seals after reopen");
        tx.commit().expect("commit branch protected detail");
        assert_eq!(
            deny_all_attempt_markers(&reopened.conn, &left_request.branch_id)
                .unwrap()
                .len(),
            crate::instance_fork::EgressFamily::ALL.len()
        );
        assert_eq!(
            inspect_in_app_branch(&reopened.conn, &left_request.branch_id)
                .unwrap()
                .deny_all_attempt_count,
            crate::instance_fork::EgressFamily::ALL.len() as u64
        );
        assert_eq!(
            crate::instance_fork::EgressFamily::for_derived_host_op("future.networkDial"),
            Some(crate::instance_fork::EgressFamily::UnclassifiedHostOperation)
        );
        drop(reopened);

        drop_managed_in_app_branch(
            &mut canonical,
            &canonical_path,
            &left_request.branch_id,
            300,
        )
        .expect("drop left");
        drop_managed_in_app_branch(
            &mut canonical,
            &canonical_path,
            &right_request.branch_id,
            300,
        )
        .expect("drop right");
        for path in [&left_path, &right_path] {
            assert!(
                managed_workspace_files(path)
                    .into_iter()
                    .all(|candidate| !candidate.exists()),
                "exact drop removes SQLite files and protected-detail sidecar"
            );
        }
    }

    #[test]
    fn managed_custody_binds_sqlite_path_and_reconciles_profile_commit_crash() {
        let directory = tempfile::tempdir().expect("tempdir");
        let canonical_path = directory.path().join("app.sqlite3");
        let other_path = directory.path().join("other.sqlite3");
        let mut canonical = file_source(&canonical_path, 7);
        let _other = file_source(&other_path, 7);
        let mismatch = create_managed_in_app_branch(
            &mut canonical,
            &other_path,
            &create_request("mismatch", "mismatch-stream", 7, 100),
        )
        .expect_err("connection/path substitution");
        assert_eq!(
            mismatch.diagnostic.code,
            "SNAPBACK_BRANCH_CUSTODY_PATH_MISMATCH"
        );

        let interrupted = create_request("interrupted", "interrupted-stream", 7, 101);
        install_managed_create_after_profile_hook(|| panic!("simulated process crash"));
        let crashed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = create_managed_in_app_branch(&mut canonical, &canonical_path, &interrupted);
        }));
        assert!(crashed.is_err());
        let interrupted_path =
            managed_workspace_path(&canonical_path, &interrupted.branch_id).unwrap();
        assert!(interrupted_path.exists());
        let list_error = list_managed_in_app_branches(&canonical, &canonical_path, 200)
            .expect_err("read-only list refuses interrupted custody");
        assert_eq!(
            list_error.diagnostic.code,
            "SNAPBACK_BRANCH_CUSTODY_RECOVERY_REQUIRED"
        );

        let survivor = create_request("survivor", "survivor-stream", 7, 102);
        create_managed_in_app_branch(&mut canonical, &canonical_path, &survivor)
            .expect("next mutable create reconciles interrupted custody");
        assert!(!interrupted_path.exists());
        let state: String = canonical
            .query_row(
                "SELECT state FROM _snapback_in_app_branch_custody_v1 WHERE branch_id=?1",
                params![interrupted.branch_id.0],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, "dropped");

        let survivor_path = managed_workspace_path(&canonical_path, &survivor.branch_id).unwrap();
        let exact_expiry = survivor.created_at_ms + survivor.limits.ttl_ms;
        assert_eq!(
            list_managed_in_app_branches(&canonical, &canonical_path, exact_expiry)
                .expect_err("expired active branch requires mutable reaping")
                .diagnostic
                .code,
            "SNAPBACK_BRANCH_EXPIRY_REAP_REQUIRED"
        );
        install_managed_reap_after_transition_hook(|| {
            panic!("simulated crash after durable tearing_down transition")
        });
        let reap_crash = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ =
                reap_expired_managed_in_app_branches(&mut canonical, &canonical_path, exact_expiry);
        }));
        assert!(reap_crash.is_err());
        assert!(survivor_path.exists());
        assert_eq!(
            list_managed_in_app_branches(&canonical, &canonical_path, exact_expiry)
                .expect_err("tearing-down crash stays enumerated")
                .diagnostic
                .code,
            "SNAPBACK_BRANCH_CUSTODY_RECOVERY_REQUIRED"
        );
        assert!(
            reap_expired_managed_in_app_branches(&mut canonical, &canonical_path, exact_expiry,)
                .expect("reopen reconciles exact-expiry crash")
                .is_empty(),
            "the interrupted tearing-down row is reconciled, not re-reaped"
        );
        assert!(
            managed_workspace_files(&survivor_path)
                .into_iter()
                .all(|path| !path.exists())
        );
        let survivor_state: String = canonical
            .query_row(
                "SELECT state FROM _snapback_in_app_branch_custody_v1 WHERE branch_id=?1",
                params![survivor.branch_id.0],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(survivor_state, "dropped");
    }

    #[test]
    fn damaged_expired_branch_does_not_wedge_managed_reap_sweep() {
        let directory = tempfile::tempdir().expect("tempdir");
        let canonical_path = directory.path().join("app.sqlite3");
        let mut canonical = file_source(&canonical_path, 7);
        let damaged = create_request("damaged", "damaged-stream", 7, 100);
        let healthy = create_request("healthy", "healthy-stream", 7, 101);
        create_managed_in_app_branch(&mut canonical, &canonical_path, &damaged)
            .expect("damaged branch fixture");
        create_managed_in_app_branch(&mut canonical, &canonical_path, &healthy)
            .expect("healthy branch fixture");

        let damaged_path = managed_workspace_path(&canonical_path, &damaged.branch_id).unwrap();
        let healthy_path = managed_workspace_path(&canonical_path, &healthy.branch_id).unwrap();
        fs::remove_file(&damaged_path).expect("remove damaged writable head");

        let receipts = reap_expired_managed_in_app_branches(
            &mut canonical,
            &canonical_path,
            healthy.created_at_ms + healthy.limits.ttl_ms,
        )
        .expect("one damaged branch cannot abort the sweep");
        assert_eq!(receipts.len(), 2);
        assert_eq!(receipts[0], dropped_managed_receipt(damaged.clone()));
        assert!(
            managed_workspace_files(&damaged_path)
                .into_iter()
                .chain(managed_workspace_files(&healthy_path))
                .all(|path| !path.exists())
        );
        for branch_id in [&damaged.branch_id.0, &healthy.branch_id.0] {
            assert_eq!(
                canonical
                    .query_row(
                        "SELECT state FROM _snapback_in_app_branch_custody_v1 WHERE branch_id=?1",
                        params![branch_id],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap(),
                "dropped"
            );
        }
    }

    #[test]
    fn managed_branch_ttl_replay_floor_and_compact_envelope_clocks_are_independent() {
        let directory = tempfile::tempdir().expect("tempdir");
        let canonical_path = directory.path().join("app.sqlite3");
        let mut canonical = file_source(&canonical_path, 7);
        canonical
            .execute(
                "INSERT INTO _snapback_meta(key,value) VALUES('retention_floor','3')",
                [],
            )
            .expect("pin replay floor fixture");
        let identity = host_identity("canonical", "independent-clock", "app-1");
        let empty_facts = || {
            aggregate_fact_set(b"independent-clock-empty", Vec::new())
                .expect("empty retained facts")
        };
        let envelope = CommitEnvelopeV1 {
            schema_version: 1,
            identity: identity.clone(),
            snapshot: StreamQualifiedVersionV1 {
                stream_id: identity.key.stream_id.clone(),
                version: 7,
                association: SnapshotAssociationKindV1::ProducedCommit,
            },
            principal_session_or_invocation_id: "clock-fixture".to_owned(),
            authority: EnvelopeAuthorityFactsV1 {
                audience: identity.bound_facts.audience.clone(),
                grant_or_policy_identity: LaneFactV1::Defined("grant-1".to_owned()),
                fencing_token_or_epoch: LaneFactV1::Defined("host-epoch-1".to_owned()),
            },
            executable_artifact_digest: LaneFactV1::Defined(sha('1')),
            argument_digest: sha('2'),
            plan_digest: LaneFactV1::NotDefinedForLane,
            base_version: LaneFactV1::NotDefinedForLane,
            read_set: empty_facts(),
            write_set: empty_facts(),
            ctx_answers: empty_facts(),
            effects: EnvelopeEffectFactsV1 {
                facts: empty_facts(),
                egress_families: Vec::new(),
                settlement_capabilities: Vec::new(),
            },
            receipt: OperationReceiptV1 {
                state: OperationReceiptStateV1::Committed,
                receipt_digest: sha('3'),
                payload: RetainedEnvelopeDetailV1::InlineRedacted {
                    detail: json!({"fixture": "independent-clock"}),
                },
            },
            coverage: EnvelopeCoverageV1 {
                covered_lanes: vec![PROMOTION_WRITER_LANE_V1.to_owned()],
                uncovered_lanes: vec![PROMOTION_COVERAGE_GAP_V1.to_owned()],
                coverage_digest: sha('4'),
            },
            recorded_at_ms: 100,
        };
        envelope.validate().expect("valid compact-envelope fixture");
        let envelope_json = serde_json::to_string(&envelope).expect("encode envelope fixture");
        let insert_envelope = |conn: &Connection| {
            conn.execute(
                "INSERT INTO _snapback_commit_envelopes_v1(
                   stream_id,originator_class,operation_id,audience,epoch_id,
                   epoch_sequence,principal_fingerprint,principal_session_id,
                   recorded_at_ms,envelope_json
                 ) VALUES(?1,'host',?2,'app-1','host-epoch-1',1,?3,'',100,?4)",
                params![
                    identity.key.stream_id,
                    identity.key.operation_id,
                    identity.bound_facts.principal_fingerprint,
                    envelope_json,
                ],
            )
            .expect("insert compact-envelope sentinel");
        };
        insert_envelope(&canonical);
        let request = create_request("independent-clock", "independent-stream", 7, 100);
        create_managed_in_app_branch(&mut canonical, &canonical_path, &request)
            .expect("create managed branch");

        let tx = canonical.transaction().expect("envelope prune tx");
        assert!(
            crate::operation_ledger::prune_compact_envelope_in(&tx, &identity)
                .expect("prune only compact envelope")
        );
        tx.commit().expect("commit compact-envelope prune");
        assert_eq!(
            list_managed_in_app_branches(&canonical, &canonical_path, 101)
                .expect("envelope pruning cannot reap branch")
                .len(),
            1
        );
        assert_eq!(
            canonical
                .query_row(
                    "SELECT value FROM _snapback_meta WHERE key='retention_floor'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "3"
        );

        insert_envelope(&canonical);
        let exact_expiry = request.created_at_ms + request.limits.ttl_ms;
        assert_eq!(
            reap_expired_managed_in_app_branches(&mut canonical, &canonical_path, exact_expiry,)
                .expect("reap exact-expiry branch")
                .len(),
            1
        );
        assert_eq!(
            canonical
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_commit_envelopes_v1
                      WHERE stream_id=?1 AND operation_id=?2",
                    params![identity.key.stream_id, identity.key.operation_id],
                    |row| row.get::<_, u64>(0),
                )
                .unwrap(),
            1,
            "branch TTL never prunes the independent compact-envelope clock"
        );
        assert_eq!(
            canonical
                .query_row(
                    "SELECT value FROM _snapback_meta WHERE key='retention_floor'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "3",
            "branch TTL never advances the replay-floor clock"
        );
    }

    fn draft(stream: &str, id: &str) -> BranchOperationDraftV1 {
        let canonical_arguments = json!({ "id": 1, "name": "ALPHA" });
        let mut identity = host_identity(stream, id, "app-1");
        identity.issuance = OperationIssuanceV1::HostIncarnation {
            epoch_id: "grant-1".to_owned(),
            upstream_identity: format!("upstream:{id}"),
            commit_ordinal: 0,
            authority_authenticator_digest: derive_branch_authority_fingerprint(
                "agent-1", "grant-1", "app-1",
            )
            .expect("branch authority fingerprint"),
        };
        identity.bound_facts.principal_fingerprint =
            derive_branch_principal_fingerprint("agent-1").expect("principal fingerprint");
        identity.bound_facts.authority_instance_id =
            derive_branch_authority_fingerprint("agent-1", "grant-1", "app-1")
                .expect("branch authority fingerprint");
        identity.bound_facts.input_fingerprint =
            derive_branch_input_fingerprint("widgets.rename", &canonical_arguments)
                .expect("branch input fingerprint");
        BranchOperationDraftV1 {
            schema_version: 1,
            identity,
            artifact_identity: sha('e'),
            function_or_command: "widgets.rename".to_owned(),
            canonical_arguments,
            principal_id: "agent-1".to_owned(),
            grant_id: "grant-1".to_owned(),
            read_baseline: json!({ "widgets/1": "alpha" }),
            replay_inputs: vec![RetainedReplayInputV1 {
                name: "ctx.locale".to_owned(),
                custody: ReplayCustodyClassV1::InlineRedacted,
                value: json!("en-US"),
            }],
            causal_predecessors: Vec::new(),
        }
    }

    fn public_draft_for_create(create: &InAppBranchCreateV1, id: &str) -> BranchOperationDraftV1 {
        let mut operation = draft(&create.child_stream_id.0, id);
        operation.identity.issuance = OperationIssuanceV1::HostIncarnation {
            epoch_id: create.grant.grant_id.clone(),
            upstream_identity: format!("upstream:{id}"),
            commit_ordinal: 0,
            authority_authenticator_digest: create.grant.authority_fingerprint.clone(),
        };
        operation.identity.bound_facts.authority_instance_id =
            create.grant.authority_fingerprint.clone();
        operation
    }

    #[test]
    fn public_carrier_reservation_crash_cut_refuses_duplicate_and_second_operation() {
        let mut branch = source(5);
        let mut request = create_request("reservation-crash", "reservation-stream", 5, 1_000);
        request.grant.authority_fingerprint = derive_branch_authority_fingerprint(
            &request.grant.principal_id,
            &request.grant.grant_id,
            &request.grant.audience,
        )
        .expect("production-shaped branch authority fingerprint");
        create_in_app_branch(&mut branch, &request).expect("create branch");
        let exact = draft("reservation-stream", "reserved-request");

        foreclose_branch_operation_admission(&mut branch, &request.branch_id, &exact, 1_001)
            .expect("durably reserve before handler execution");
        assert!(
            branch_operation_retry(&branch, &request.branch_id, &exact)
                .expect("no terminal operation after simulated crash")
                .is_none()
        );
        assert_eq!(
            foreclose_branch_operation_admission(&mut branch, &request.branch_id, &exact, 1_002)
                .expect_err("exact retry cannot rerun an outcome-unknown operation")
                .diagnostic
                .code,
            "SNAPBACK_BRANCH_OPERATION_OUTCOME_UNKNOWN"
        );

        let mut divergent = exact.clone();
        divergent.canonical_arguments = json!({"id": 1, "name": "DIVERGED"});
        divergent.identity.bound_facts.input_fingerprint = derive_branch_input_fingerprint(
            &divergent.function_or_command,
            &divergent.canonical_arguments,
        )
        .expect("divergent input fingerprint");
        assert_eq!(
            foreclose_branch_operation_admission(
                &mut branch,
                &request.branch_id,
                &divergent,
                1_003,
            )
            .expect_err("reserved identity cannot be rebound")
            .diagnostic
            .code,
            "SNAPBACK_BRANCH_OPERATION_ID_REUSED"
        );

        let second = draft("reservation-stream", "second-request");
        assert_eq!(
            foreclose_branch_operation_admission(&mut branch, &request.branch_id, &second, 1_004)
                .expect_err("the Partial carrier admits no second operation after foreclosure")
                .diagnostic
                .code,
            "SNAPBACK_BRANCH_FORECLOSED"
        );
    }

    fn facts(name: &str) -> ApprovedOperationFactsV1 {
        ApprovedOperationFactsV1 {
            read_facts: json!({ "widgets/1": "alpha" }),
            ctx_answers: json!({ "locale": "en-US" }),
            decision: json!({ "rename": true }),
            result: json!({ "ok": true }),
            writes: vec![LogicalWriteFactV1 {
                table_name: "widgets".to_owned(),
                row_id: "1".to_owned(),
                after: Some(json!({ "id": 1, "name": name })),
            }],
            effects: Vec::new(),
            coverage: create_request("unused", "unused", 1, 0).coverage,
        }
    }

    fn scan_widgets(conn: &Connection) -> SnapbackResult<Vec<SnapshotRowV1>> {
        let mut statement = conn.prepare("SELECT id, name FROM widgets ORDER BY id")?;
        let rows = statement.query_map([], |row| {
            let id = row.get::<_, i64>(0)?;
            let name = row.get::<_, String>(1)?;
            Ok(SnapshotRowV1 {
                table_name: "widgets".to_owned(),
                row_id: id.to_string(),
                row: json!({ "id": id, "name": name }),
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    fn branch_with_rename() -> (Connection, MaterializedBase, ForkDiffReceiptV1) {
        let mut canonical = source(5);
        let request = create_request("branch-a", "child-a", 5, 1_000);
        create_in_app_branch(&mut canonical, &request).expect("branch");
        let mut workspace = MaterializedBase::materialize(&canonical, None).expect("workspace");
        let operation = draft("child-a", "branch-op-1");
        execute_branch_operation(
            &mut workspace.conn,
            &request.branch_id,
            &operation,
            1_001,
            |tx, _| {
                tx.execute("UPDATE widgets SET name='ALPHA' WHERE id=1", [])?;
                Ok(facts("ALPHA"))
            },
        )
        .expect("execute");
        let diff = exact_fork_diff(&workspace, &request.branch_id, scan_widgets).expect("diff");
        (canonical, workspace, diff)
    }

    struct FairPromotionCandidate {
        workspace: MaterializedBase,
        diff: ForkDiffReceiptV1,
        request: PromotionRequestV1,
    }

    fn fair_facts(name: &str) -> ApprovedOperationFactsV1 {
        let mut result = facts(name);
        result.read_facts = json!({});
        result
    }

    fn make_fair_candidate(
        canonical: &mut Connection,
        key: &PromotionSealKey,
        index: usize,
        observed_forks: u64,
        now_ms: i64,
    ) -> FairPromotionCandidate {
        let base_version = crate::storage::current_version_on(canonical).expect("candidate base");
        let branch_id = format!("fair-branch-{index}");
        let child_stream = format!("fair-child-{index}");
        let name = format!("FAIR-{index}");
        let mut create = create_request(&branch_id, &child_stream, base_version, now_ms);
        create.limits.max_live_branches_per_principal = 64;
        create.limits.max_live_branches_per_app = 64;
        create_in_app_branch(canonical, &create).expect("fair branch");
        let mut workspace = MaterializedBase::materialize(canonical, None).expect("fair workspace");
        let mut operation = draft(&child_stream, &format!("fair-operation-{index}"));
        operation.canonical_arguments["name"] = json!(name);
        operation.read_baseline = json!({});
        operation.identity.bound_facts.input_fingerprint =
            derive_branch_input_fingerprint("widgets.rename", &operation.canonical_arguments)
                .expect("fair input fingerprint");
        execute_branch_operation(
            &mut workspace.conn,
            &create.branch_id,
            &operation,
            now_ms + 1,
            |tx, draft| {
                let name = draft.canonical_arguments["name"]
                    .as_str()
                    .expect("fair name");
                tx.execute("UPDATE widgets SET name=?1 WHERE id=1", params![name])?;
                Ok(fair_facts(name))
            },
        )
        .expect("fair operation");
        let diff = exact_fork_diff(&workspace, &create.branch_id, scan_widgets).expect("fair diff");
        let ticket_identity = host_identity("canonical", &format!("fair-ticket-{index}"), "app-1");
        let ticket = issue_promotion_ticket(
            canonical,
            ticket_identity.clone(),
            &diff.branch_id,
            "canonical",
            observed_forks,
            100_000,
            now_ms + 2,
            PromotionContentionPolicyV1::default(),
        )
        .expect("fair ticket");
        let request = seal_promotion_request(
            &workspace,
            &diff,
            PromotionApprovalV1 {
                approver_principal_id: "agent-1".to_owned(),
                approver_grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
                approved_at_ms: now_ms + 3,
                expires_at_ms: 90_000,
            },
            ticket,
            ticket_identity,
            &sha('f'),
            key,
            now_ms + 3,
        )
        .expect("fair approval and seal");
        FairPromotionCandidate {
            workspace,
            diff,
            request,
        }
    }

    fn rebase_fair_candidate(
        canonical: &mut Connection,
        key: &PromotionSealKey,
        candidate: FairPromotionCandidate,
        rebase_ordinal: usize,
        now_ms: i64,
    ) -> FairPromotionCandidate {
        let base_version = crate::storage::current_version_on(canonical).expect("rebase head");
        let mut create = create_request(
            &format!("{}-rebase-{rebase_ordinal}", candidate.request.branch_id.0),
            &format!(
                "{}-rebase-{rebase_ordinal}",
                candidate.request.child_stream_id.0
            ),
            base_version,
            now_ms,
        );
        create.limits.max_live_branches_per_principal = 64;
        create.limits.max_live_branches_per_app = 64;
        let (workspace, replay) = rebase_by_replay(
            canonical,
            &candidate.workspace,
            &candidate.request.branch_id,
            &create,
            now_ms + 1,
            |tx, operation| {
                let name = operation.canonical_arguments["name"]
                    .as_str()
                    .expect("rebase name");
                tx.execute("UPDATE widgets SET name=?1 WHERE id=1", params![name])?;
                Ok(operation.approved_facts.clone())
            },
        )
        .expect("fair rebase");
        assert!(replay.meaning_preserved);
        let diff = exact_fork_diff(&workspace, &create.branch_id, scan_widgets)
            .expect("rebased fair diff");
        let request = reseal_after_rebase(
            &candidate.request,
            &workspace,
            &diff,
            "fairness-engine-v1",
            &sha('f'),
            key,
            now_ms + 2,
        )
        .expect("inherited ticket and approval reseal");
        FairPromotionCandidate {
            workspace,
            diff,
            request,
        }
    }

    fn ordinary_canonical_write(
        canonical_path: &Path,
        row_id: i64,
        now_ms: i64,
    ) -> SnapbackResult<()> {
        let mut conn = Connection::open(canonical_path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        enforce_canonical_mutation_admission_in(&tx, "canonical", now_ms)?;
        let head = crate::storage::current_version_on(&tx)?;
        let version = crate::storage::next_storage_version(head)?;
        let name = format!("ordinary-{row_id}");
        let row_json =
            serde_json::to_string(&json!({ "id": row_id, "name": name })).map_err(|cause| {
                error(
                    "SNAPBACK_BRANCH_ARTIFACT_INVALID",
                    format!("encode ordinary-writer journal row: {cause}"),
                )
            })?;
        tx.execute(
            "INSERT INTO widgets(id,name) VALUES(?1,?2)",
            params![row_id, name],
        )?;
        tx.execute(
            "INSERT INTO _snapback_changes(version,table_name,row_id,op,row_json,changed_at_ms)
             VALUES(?1,'widgets',?2,'insert',?3,?4)",
            params![version as i64, row_id.to_string(), row_json, now_ms,],
        )?;
        crate::storage::set_promotion_version(&tx, version)?;
        tx.commit()?;
        Ok(())
    }

    fn concurrent_fairness_cycle(
        canonical_path: &Path,
        key: &PromotionSealKey,
        candidates: Vec<FairPromotionCandidate>,
        cycle: usize,
        now_ms: i64,
    ) -> (
        Vec<FairPromotionCandidate>,
        Vec<PromotionResultV1>,
        Vec<String>,
    ) {
        let candidate_count = candidates.len();
        let start = std::sync::Arc::new(std::sync::Barrier::new(candidate_count + 1));
        let (writer_a_start, writer_a_ready) = std::sync::mpsc::channel();
        let (writer_b_start, writer_b_ready) = std::sync::mpsc::channel();
        let writer_path_a = canonical_path.to_path_buf();
        let writer_path_b = canonical_path.to_path_buf();
        let writer_a = std::thread::spawn(move || {
            writer_a_ready
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("promotion reached transactional replay for writer A");
            ordinary_canonical_write(&writer_path_a, 10_000 + (cycle as i64 * 2), now_ms + 1)
        });
        let writer_b = std::thread::spawn(move || {
            writer_b_ready
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("promotion reached transactional replay for writer B");
            ordinary_canonical_write(&writer_path_b, 10_001 + (cycle as i64 * 2), now_ms + 1)
        });
        let threads = candidates
            .into_iter()
            .map(|candidate| {
                let start = start.clone();
                let path = canonical_path.to_path_buf();
                let key = key.clone();
                let writer_a_start = writer_a_start.clone();
                let writer_b_start = writer_b_start.clone();
                std::thread::spawn(move || {
                    let mut conn = Connection::open(path).expect("promotion connection");
                    conn.busy_timeout(std::time::Duration::from_secs(5))
                        .expect("promotion busy timeout");
                    start.wait();
                    let result = promote_by_reexecution(
                        &mut conn,
                        &candidate.workspace,
                        &candidate.diff,
                        &candidate.request,
                        &key,
                        &PromotionAuthorityDecisionV1::Revalidated {
                            grant_id: "grant-1".to_owned(),
                            authority_fingerprint: sha('d'),
                        },
                        now_ms,
                        &sha('f'),
                        |_, operation| {
                            writer_a_start.send(()).expect("start ordinary writer A");
                            writer_b_start.send(()).expect("start ordinary writer B");
                            std::thread::sleep(std::time::Duration::from_millis(20));
                            Ok(operation.approved_facts.clone())
                        },
                    );
                    (candidate, result)
                })
            })
            .collect::<Vec<_>>();
        start.wait();
        let mut pending = Vec::new();
        let mut committed = Vec::new();
        let mut refusals = Vec::new();
        for thread in threads {
            let (candidate, result) = thread.join().expect("promotion contender");
            match result {
                Ok(result) => committed.push(result),
                Err(error) => {
                    refusals.push(error.diagnostic.code.to_owned());
                    pending.push(candidate);
                }
            }
        }
        writer_a
            .join()
            .expect("ordinary writer A")
            .expect("ordinary writer A commits through production gate");
        writer_b
            .join()
            .expect("ordinary writer B")
            .expect("ordinary writer B commits through production gate");
        pending.sort_by_key(|candidate| candidate.request.admission_ticket.fifo_sequence);
        (pending, committed, refusals)
    }

    #[test]
    fn legacy_v1_branch_receipts_decode_but_cannot_bypass_new_diff_accounting() {
        let limits: BranchLimitsV1 = serde_json::from_value(json!({
            "maxLiveBranchesPerPrincipal": 1,
            "maxLiveBranchesPerApp": 1,
            "maxOperations": 1,
            "maxRetainedBytes": 1024,
            "maxDiffRows": 1,
            "ttlMs": 1000
        }))
        .expect("pre-accounting v1 limits remain decodable");
        assert_eq!(
            limits.max_digest_work_bytes,
            BRANCH_MAX_DIGEST_WORK_BYTES_V1
        );
        limits
            .validate()
            .expect("legacy default is finite and valid");

        let (mut canonical, workspace, diff) = branch_with_rename();
        let mut legacy_json = serde_json::to_value(&diff).expect("diff JSON");
        legacy_json
            .as_object_mut()
            .expect("diff object")
            .remove("digestWorkBytes");
        legacy_json["substrate"] = json!("immutableMaterializedBase");
        let legacy: ForkDiffReceiptV1 =
            serde_json::from_value(legacy_json).expect("legacy v1 diff remains decodable");
        assert_eq!(legacy.digest_work_bytes, 0);
        assert_eq!(
            legacy.substrate,
            NetDiffSubstrateV1::ImmutableMaterializedBase
        );

        let key = PromotionSealKey::from_server_secret([9_u8; 32]).expect("key");
        let ticket_identity = host_identity("canonical", "legacy-diff-ticket", "app-1");
        let ticket = issue_promotion_ticket(
            &mut canonical,
            ticket_identity.clone(),
            &legacy.branch_id,
            "canonical",
            1,
            60_000,
            2_000,
            PromotionContentionPolicyV1 {
                reservation_after_losses: 2,
                reservation_interval_ms: 1_000,
                reservation_quota: 1,
                maximum_commit_duration_ms: 500,
            },
        )
        .expect("ticket");
        assert_eq!(
            seal_promotion_request(
                &workspace,
                &legacy,
                PromotionApprovalV1 {
                    approver_principal_id: "agent-1".to_owned(),
                    approver_grant_id: "grant-1".to_owned(),
                    authority_fingerprint: sha('d'),
                    approved_at_ms: 2_001,
                    expires_at_ms: 50_000,
                },
                ticket,
                ticket_identity,
                &sha('f'),
                &key,
                2_001,
            )
            .expect_err("legacy unaccounted diff cannot enter strict promotion")
            .diagnostic
            .code,
            "SNAPBACK_BRANCH_DIGEST_WORK_UNACCOUNTED"
        );
    }

    #[test]
    fn promotion_ticket_admission_requires_durable_host_authority() {
        let mut canonical = source(1);
        let branch_id = BranchId("ticket-auth-branch".to_owned());
        let policy = PromotionContentionPolicyV1 {
            reservation_after_losses: 2,
            reservation_interval_ms: 1_000,
            reservation_quota: 1,
            maximum_commit_duration_ms: 500,
        };
        let valid = host_identity("canonical", "ticket-auth", "app-1");

        let mut client_squat = valid.clone();
        client_squat.key.originator_class = OperationOriginatorClassV1::Client;
        assert_eq!(
            issue_promotion_ticket(
                &mut canonical,
                client_squat,
                &branch_id,
                "canonical",
                1,
                60_000,
                2_000,
                policy.clone(),
            )
            .expect_err("client cannot enter the host namespace")
            .diagnostic
            .code,
            "SNAPBACK_PROMOTION_TICKET_IDENTITY_INVALID"
        );

        let mut forged = valid.clone();
        forged.issuance = OperationIssuanceV1::HostIncarnation {
            epoch_id: "host-epoch-1".to_owned(),
            upstream_identity: "upstream:ticket-auth".to_owned(),
            commit_ordinal: 0,
            authority_authenticator_digest: sha('f'),
        };
        assert_eq!(
            issue_promotion_ticket(
                &mut canonical,
                forged,
                &branch_id,
                "canonical",
                1,
                60_000,
                2_000,
                policy.clone(),
            )
            .expect_err("forged authenticator")
            .diagnostic
            .code,
            "SNAPBACK_OPERATION_ISSUANCE_AUTH_INVALID"
        );

        let mut forged_derivation = valid.clone();
        forged_derivation.key.operation_id = derive_host_operation_id("upstream:other", 0);
        assert_eq!(
            issue_promotion_ticket(
                &mut canonical,
                forged_derivation,
                &branch_id,
                "canonical",
                1,
                60_000,
                2_000,
                policy.clone(),
            )
            .expect_err("forged host derivation")
            .diagnostic
            .code,
            "SNAPBACK_HOST_OPERATION_IDENTITY_INVALID"
        );

        issue_promotion_ticket(
            &mut canonical,
            valid.clone(),
            &branch_id,
            "canonical",
            1,
            60_000,
            2_000,
            policy.clone(),
        )
        .expect("durably authenticated ticket");
        let mut divergent_retry = valid;
        divergent_retry.bound_facts.input_fingerprint = sha('d');
        assert_eq!(
            issue_promotion_ticket(
                &mut canonical,
                divergent_retry,
                &branch_id,
                "canonical",
                1,
                60_000,
                2_000,
                policy,
            )
            .expect_err("durable ticket key cannot be rebound")
            .diagnostic
            .code,
            "SNAPBACK_PROMOTION_TICKET_IDENTITY_REUSED"
        );
    }

    #[test]
    fn immutable_base_and_siblings_isolate_and_exact_diff_folds_reverts() {
        let mut canonical = source(5);
        let left_request = create_request("left", "child-left", 5, 100);
        let right_request = create_request("right", "child-right", 5, 100);
        create_in_app_branch(&mut canonical, &left_request).expect("left");
        create_in_app_branch(&mut canonical, &right_request).expect("right");
        let mut left = MaterializedBase::materialize(&canonical, None).expect("left workspace");
        let right = MaterializedBase::materialize(&canonical, None).expect("right workspace");
        canonical
            .execute("UPDATE widgets SET name='CANONICAL' WHERE id=2", [])
            .expect("canonical drift");
        let d1 = draft("child-left", "left-1");
        execute_branch_operation(
            &mut left.conn,
            &left_request.branch_id,
            &d1,
            101,
            |tx, _| {
                tx.execute("UPDATE widgets SET name='ALPHA' WHERE id=1", [])?;
                Ok(facts("ALPHA"))
            },
        )
        .expect("rename");
        let mut d2 = draft("child-left", "left-2");
        d2.canonical_arguments = json!({ "id": 1, "name": "alpha" });
        execute_branch_operation(
            &mut left.conn,
            &left_request.branch_id,
            &d2,
            102,
            |tx, _| {
                tx.execute("UPDATE widgets SET name='alpha' WHERE id=1", [])?;
                Ok(facts("alpha"))
            },
        )
        .expect("revert");
        assert!(
            exact_fork_diff(&left, &left_request.branch_id, scan_widgets)
                .expect("left diff")
                .net_diff
                .is_empty()
        );
        assert_eq!(
            scan_widgets(&right.conn).expect("right")[1].row["name"],
            "beta",
            "canonical drift and sibling writes are invisible"
        );
        assert!(
            left.immutable_base()
                .execute("UPDATE widgets SET name='forbidden'", [])
                .is_err(),
            "retained base is SQLite-enforced query-only"
        );
    }

    #[test]
    fn deny_all_marker_is_payload_free_durable_and_forecloses_promotion() {
        let mut canonical = source(1);
        let request = create_request("deny", "child-deny", 1, 100);
        create_in_app_branch(&mut canonical, &request).expect("branch");
        let mut workspace = MaterializedBase::materialize(&canonical, None).expect("workspace");
        let error = deny_egress_attempt(
            &mut workspace.conn,
            &request.branch_id,
            Some("op-1"),
            "payment",
            101,
        )
        .expect_err("deny loudly");
        assert_eq!(error.diagnostic.code, "SNAPBACK_BRANCH_EGRESS_DENIED");
        let markers =
            deny_all_attempt_markers(&workspace.conn, &request.branch_id).expect("markers");
        assert_eq!(markers.len(), 1);
        let encoded = serde_json::to_string(&markers[0]).expect("marker json");
        assert!(!encoded.contains("target"));
        assert!(!encoded.contains("payload"));
        assert!(
            !inspect_in_app_branch(&workspace.conn, &request.branch_id)
                .expect("inspect")
                .promotable
        );
    }

    #[test]
    fn deny_all_marker_survives_workspace_reopen() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("deny-branch.sqlite3");
        let mut canonical = source(1);
        let request = create_request("deny-reopen", "child-deny-reopen", 1, 100);
        create_in_app_branch(&mut canonical, &request).expect("branch");
        let mut workspace =
            MaterializedBase::materialize(&canonical, Some(&path)).expect("workspace");
        let error = deny_egress_attempt(
            &mut workspace.conn,
            &request.branch_id,
            Some("op-reopen"),
            "network",
            101,
        )
        .expect_err("deny loudly");
        assert_eq!(error.diagnostic.code, "SNAPBACK_BRANCH_EGRESS_DENIED");
        drop(workspace);

        let reopened = Connection::open(&path).expect("reopen branch");
        let markers = deny_all_attempt_markers(&reopened, &request.branch_id).expect("markers");
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].operation_id.as_deref(), Some("op-reopen"));
        assert!(
            !inspect_in_app_branch(&reopened, &request.branch_id)
                .expect("inspect")
                .promotable
        );
    }

    #[test]
    fn capture_only_effects_foreclose_strict_promotion_before_canonical_mutation() {
        let directory = tempfile::tempdir().expect("tempdir");
        let canonical_path = directory.path().join("canonical.sqlite3");
        let mut canonical = file_source(&canonical_path, 5);
        let mut create = create_request("capture-promote", "capture-child", 5, 1_000);
        create.egress_policy = ForkEgressPolicyV1::CaptureOnly;
        create.coverage.effects_covered = true;
        create.grant.authority_fingerprint = derive_branch_authority_fingerprint(
            &create.grant.principal_id,
            &create.grant.grant_id,
            &create.grant.audience,
        )
        .expect("public branch authority fingerprint");
        create_in_app_branch(&mut canonical, &create).expect("CaptureOnly branch");
        let mut workspace = MaterializedBase::materialize(&canonical, None).expect("workspace");
        let operation_draft = public_draft_for_create(&create, "capture-effect-operation");
        let context =
            BranchEffectExecutionContextV1::new(create.branch_id.clone(), operation_draft, 1_001);
        for ordinal in 0..3 {
            capture_effect_intent(&mut workspace.conn, &context, "fetch", ordinal)
                .expect("payload-free captured intent");
        }
        let operation = finalize_captured_effect_operation(
            &mut workspace.conn,
            &context,
            json!({"caught": 3}),
            Some("SNAPBACK_BRANCH_EFFECT_CAPTURED"),
        )
        .expect("finalize effect operation")
        .expect("captured operation");
        assert_eq!(operation.approved_facts.effects.len(), 3);
        let mut mixed_effect_and_write = operation.clone();
        mixed_effect_and_write
            .approved_facts
            .writes
            .push(LogicalWriteFactV1 {
                table_name: "widgets".to_owned(),
                row_id: "1".to_owned(),
                after: Some(json!({"id": 1, "name": "must-not-promote"})),
            });
        assert_eq!(
            refuse_captured_effect_promotion(&[mixed_effect_and_write], &[])
                .expect_err("same-operation effect plus write remains non-promotable")
                .diagnostic
                .code,
            "SNAPBACK_PROMOTION_CAPTURE_ONLY_UNSUPPORTED"
        );
        let diff = exact_fork_diff(&workspace, &create.branch_id, scan_widgets)
            .expect("effect-only exact diff");

        let seal_key = PromotionSealKey::from_server_secret([23_u8; 32]).expect("seal key");
        let ticket_identity = host_identity("canonical", "capture-promotion-ticket", "app-1");
        let ticket = issue_promotion_ticket(
            &mut canonical,
            ticket_identity.clone(),
            &create.branch_id,
            "canonical",
            1,
            60_000,
            2_000,
            PromotionContentionPolicyV1::default(),
        )
        .expect("ticket");
        let canonical_version_before = crate::storage::current_version_on(&canonical)
            .expect("canonical version before refusal");
        let refusal = seal_promotion_request(
            &workspace,
            &diff,
            PromotionApprovalV1 {
                approver_principal_id: "agent-1".to_owned(),
                approver_grant_id: "grant-1".to_owned(),
                authority_fingerprint: create.grant.authority_fingerprint.clone(),
                approved_at_ms: 2_001,
                expires_at_ms: 50_000,
            },
            ticket,
            ticket_identity,
            &sha('f'),
            &seal_key,
            2_001,
        )
        .expect_err("CaptureOnly effects remain capture-only and not promotable");
        assert_eq!(
            refusal.diagnostic.code,
            "SNAPBACK_PROMOTION_CAPTURE_ONLY_UNSUPPORTED"
        );
        assert_eq!(
            crate::storage::current_version_on(&canonical)
                .expect("canonical version after refusal"),
            canonical_version_before
        );
        assert!(
            !inspect_in_app_branch(&workspace.conn, &create.branch_id)
                .expect("capture-only receipt")
                .promotable
        );
    }

    #[test]
    fn captured_intent_after_review_refuses_promotion_entry_before_reexecution() {
        let mut canonical = source(5);
        let mut create = create_request("capture-after-review", "capture-reviewed", 5, 1_000);
        create.egress_policy = ForkEgressPolicyV1::CaptureOnly;
        create.coverage.effects_covered = true;
        create.grant.authority_fingerprint = derive_branch_authority_fingerprint(
            &create.grant.principal_id,
            &create.grant.grant_id,
            &create.grant.audience,
        )
        .expect("public branch authority fingerprint");
        create_in_app_branch(&mut canonical, &create).expect("CaptureOnly branch");
        let mut workspace = MaterializedBase::materialize(&canonical, None).expect("workspace");
        let reviewed_draft = public_draft_for_create(&create, "reviewed-no-effect-operation");
        let coverage = create.coverage.clone();
        execute_branch_operation(
            &mut workspace.conn,
            &create.branch_id,
            &reviewed_draft,
            1_001,
            |tx, _draft| {
                tx.execute("UPDATE widgets SET name='REVIEWED' WHERE id=1", [])?;
                let mut approved = facts("REVIEWED");
                approved.coverage = coverage;
                Ok(approved)
            },
        )
        .expect("reviewable no-effect operation");
        let diff = exact_fork_diff(&workspace, &create.branch_id, scan_widgets).expect("diff");
        let seal_key = PromotionSealKey::from_server_secret([24_u8; 32]).expect("seal key");
        let ticket_identity = host_identity("canonical", "capture-reviewed-ticket", "app-1");
        let ticket = issue_promotion_ticket(
            &mut canonical,
            ticket_identity.clone(),
            &create.branch_id,
            "canonical",
            1,
            60_000,
            2_000,
            PromotionContentionPolicyV1::default(),
        )
        .expect("ticket");
        let request = seal_promotion_request(
            &workspace,
            &diff,
            PromotionApprovalV1 {
                approver_principal_id: "agent-1".to_owned(),
                approver_grant_id: "grant-1".to_owned(),
                authority_fingerprint: create.grant.authority_fingerprint.clone(),
                approved_at_ms: 2_001,
                expires_at_ms: 50_000,
            },
            ticket,
            ticket_identity,
            &sha('f'),
            &seal_key,
            2_001,
        )
        .expect("seal reviewed no-effect operation");

        let late_context = BranchEffectExecutionContextV1::new(
            create.branch_id.clone(),
            public_draft_for_create(&create, "late-captured-effect"),
            2_002,
        );
        capture_effect_intent(&mut workspace.conn, &late_context, "fetch", 0)
            .expect("durable late capture");
        let canonical_version_before = crate::storage::current_version_on(&canonical)
            .expect("canonical version before promotion refusal");
        let canonical_rows_before =
            scan_widgets(&canonical).expect("canonical rows before refusal");
        let reexecuted = std::cell::Cell::new(false);
        let refusal = promote_by_reexecution(
            &mut canonical,
            &workspace,
            &diff,
            &request,
            &seal_key,
            &PromotionAuthorityDecisionV1::Revalidated {
                grant_id: "grant-1".to_owned(),
                authority_fingerprint: create.grant.authority_fingerprint.clone(),
            },
            2_003,
            &sha('f'),
            |_context, retained| {
                reexecuted.set(true);
                Ok(retained.approved_facts.clone())
            },
        )
        .expect_err("captured intent after review refuses at the promotion entry");
        assert_eq!(
            refusal.diagnostic.code,
            "SNAPBACK_PROMOTION_CAPTURE_ONLY_UNSUPPORTED"
        );
        assert!(!reexecuted.get(), "no retained handler facts were replayed");
        assert_eq!(
            crate::storage::current_version_on(&canonical)
                .expect("canonical version after promotion refusal"),
            canonical_version_before
        );
        assert_eq!(
            scan_widgets(&canonical).expect("canonical rows after refusal"),
            canonical_rows_before
        );
    }

    #[test]
    fn branch_mutation_fact_retention_failure_rolls_back_the_application_write() {
        let mut canonical = source(5);
        let mut create = create_request("atomic-retention", "atomic-child", 5, 1_000);
        create.limits.max_retained_bytes = 1;
        create.grant.authority_fingerprint = derive_branch_authority_fingerprint(
            &create.grant.principal_id,
            &create.grant.grant_id,
            &create.grant.audience,
        )
        .expect("public branch authority fingerprint");
        create_in_app_branch(&mut canonical, &create).expect("branch");
        let mut workspace = MaterializedBase::materialize(&canonical, None).expect("workspace");
        let operation_draft = draft("atomic-child", "atomic-operation");
        {
            let tx = workspace
                .conn
                .transaction()
                .expect("application transaction");
            tx.execute("UPDATE widgets SET name='MUST-ROLL-BACK' WHERE id=1", [])
                .expect("stage app write");
            let changed = crate::storage::ChangedRow {
                table: "widgets".to_owned(),
                id: "1".to_owned(),
                op: crate::storage::ChangeOp::Update,
                row: Some(json!({"id": 1, "name": "MUST-ROLL-BACK"})),
                changed_fields: vec!["name".to_owned()],
            };
            let output = crate::manifest::MutationOutput {
                version: 6,
                changed_count: 1,
                result: json!({"ok": true}),
                authority_transitions: Vec::new(),
                ctx_ledger: None,
                settlement_mint_observations: Vec::new(),
                settlement_time_observation: None,
                settlement_sequence_allocations: Vec::new(),
            };
            let error = record_branch_mutation_in(
                &tx,
                &BranchMutationCommitV1 {
                    branch_id: create.branch_id.clone(),
                    draft: operation_draft,
                    recorded_at_ms: 1_001,
                },
                6,
                &[changed],
                &output,
            )
            .expect_err("fact-retention limit must abort the shared transaction");
            assert_eq!(error.diagnostic.code, "SNAPBACK_BRANCH_BYTE_LIMIT_EXCEEDED");
        }
        assert_eq!(
            workspace
                .conn
                .query_row("SELECT name FROM widgets WHERE id=1", [], |row| {
                    row.get::<_, String>(0)
                })
                .expect("row after rollback"),
            "alpha"
        );
        assert!(
            branch_operation_log(&workspace.conn, &create.branch_id)
                .expect("operation log after rollback")
                .is_empty()
        );
    }

    #[test]
    fn capture_only_intents_obey_operation_and_ttl_limits_before_egress() {
        let mut canonical = source(1);
        let mut create = create_request("capture-bounds", "capture-bounds-child", 1, 100);
        create.egress_policy = ForkEgressPolicyV1::CaptureOnly;
        create.coverage.effects_covered = true;
        create.limits.max_operations = 1;
        create.grant.authority_fingerprint = derive_branch_authority_fingerprint(
            &create.grant.principal_id,
            &create.grant.grant_id,
            &create.grant.audience,
        )
        .expect("public branch authority fingerprint");
        create_in_app_branch(&mut canonical, &create).expect("CaptureOnly branch");
        let mut workspace = MaterializedBase::materialize(&canonical, None).expect("workspace");
        let context = BranchEffectExecutionContextV1::new(
            create.branch_id.clone(),
            public_draft_for_create(&create, "capture-bounded-operation"),
            101,
        );
        capture_effect_intent(&mut workspace.conn, &context, "fetch", 0)
            .expect("first intent fits the operation bound");
        assert_eq!(
            capture_effect_intent(&mut workspace.conn, &context, "fetch", 1)
                .expect_err("second intent exceeds the declared bound")
                .diagnostic
                .code,
            "SNAPBACK_BRANCH_OPERATION_LIMIT_EXCEEDED"
        );

        let expired_context = BranchEffectExecutionContextV1::new(
            create.branch_id.clone(),
            public_draft_for_create(&create, "capture-after-expiry"),
            create.created_at_ms + create.limits.ttl_ms,
        );
        assert_eq!(
            capture_effect_intent(&mut workspace.conn, &expired_context, "fetch", 0)
                .expect_err("exact TTL boundary refuses before intent custody")
                .diagnostic
                .code,
            "SNAPBACK_BRANCH_EXPIRED"
        );
        assert_eq!(
            captured_effect_intents(&workspace.conn, &create.branch_id)
                .expect("bounded ledger")
                .len(),
            1
        );
    }

    #[test]
    fn exact_diff_model_corpus_covers_add_update_delete_and_folding() {
        for seed in 0_u64..32 {
            let mut canonical = source(1);
            let mut request = create_request(
                &format!("diff-model-{seed}"),
                &format!("child-diff-model-{seed}"),
                1,
                100,
            );
            request.limits.max_operations = 64;
            request.limits.max_retained_bytes = 512 * 1024;
            request.limits.max_digest_work_bytes = 2 * 1024 * 1024;
            create_in_app_branch(&mut canonical, &request).expect("branch");
            let mut workspace = MaterializedBase::materialize(&canonical, None).expect("workspace");
            let mut expected =
                BTreeMap::from([(1_i64, "alpha".to_owned()), (2_i64, "beta".to_owned())]);
            let mut expected_attribution = Vec::new();
            let mut state = seed.wrapping_add(1);
            for step in 0..48_u64 {
                state = state
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                let id = 1 + ((state >> 17) % 8) as i64;
                let mut operation_draft = draft(
                    &format!("child-diff-model-{seed}"),
                    &format!("diff-model-{seed}-{step}"),
                );
                operation_draft.canonical_arguments = match (state >> 5) % 3 {
                    0 => {
                        json!({ "kind": "delete", "id": id })
                    }
                    _ => {
                        let name = if step % 11 == 0 && id == 1 {
                            "alpha".to_owned()
                        } else if step % 13 == 0 && id == 2 {
                            "beta".to_owned()
                        } else {
                            format!("seed-{seed}-step-{step}")
                        };
                        json!({ "kind": "upsert", "id": id, "name": name })
                    }
                };
                let arguments = operation_draft.canonical_arguments.clone();
                let prior = expected.get(&id).cloned();
                let operation = execute_branch_operation(
                    &mut workspace.conn,
                    &request.branch_id,
                    &operation_draft,
                    101 + step as i64,
                    |tx, _| {
                        let mut observed = facts("journalized");
                        observed.result = json!({ "step": step });
                        match arguments["kind"].as_str().expect("kind") {
                            "delete" => {
                                tx.execute("DELETE FROM widgets WHERE id=?1", params![id])?;
                                observed.writes = prior
                                    .as_ref()
                                    .map(|_| LogicalWriteFactV1 {
                                        table_name: "widgets".to_owned(),
                                        row_id: id.to_string(),
                                        after: None,
                                    })
                                    .into_iter()
                                    .collect();
                            }
                            "upsert" => {
                                let name = arguments["name"].as_str().expect("name");
                                tx.execute(
                                    "INSERT INTO widgets(id, name) VALUES (?1, ?2)
                                     ON CONFLICT(id) DO UPDATE SET name=excluded.name",
                                    params![id, name],
                                )?;
                                observed.writes = vec![LogicalWriteFactV1 {
                                    table_name: "widgets".to_owned(),
                                    row_id: id.to_string(),
                                    after: Some(json!({ "id": id, "name": name })),
                                }];
                            }
                            _ => unreachable!(),
                        }
                        Ok(observed)
                    },
                )
                .expect("journalized mutation");
                match arguments["kind"].as_str().expect("kind") {
                    "delete" => {
                        expected.remove(&id);
                    }
                    "upsert" => {
                        expected.insert(id, arguments["name"].as_str().expect("name").to_owned());
                    }
                    _ => unreachable!(),
                }
                for (write_ordinal, write) in operation.approved_facts.writes.iter().enumerate() {
                    expected_attribution.push((
                        operation.child_version,
                        operation.identity.key.operation_id.clone(),
                        write_ordinal as u64,
                        write.clone(),
                    ));
                }
            }

            let receipt =
                exact_fork_diff(&workspace, &request.branch_id, scan_widgets).expect("exact diff");
            let actual = scan_widgets(&workspace.conn)
                .expect("head")
                .into_iter()
                .map(|row| {
                    (
                        row.row_id.parse::<i64>().expect("row id"),
                        row.row["name"].as_str().expect("name").to_owned(),
                    )
                })
                .collect::<BTreeMap<_, _>>();
            assert_eq!(actual, expected, "seed {seed}");

            let expected_changed = (1_i64..=8)
                .filter(|id| {
                    expected.get(id).map(String::as_str)
                        != match *id {
                            1 => Some("alpha"),
                            2 => Some("beta"),
                            _ => None,
                        }
                })
                .count();
            assert_eq!(receipt.net_diff.len(), expected_changed, "seed {seed}");
            assert_eq!(
                receipt
                    .attributed_changes
                    .iter()
                    .map(|change| (
                        change.child_version,
                        change.operation_identity.key.operation_id.clone(),
                        change.write_ordinal,
                        change.write.clone(),
                    ))
                    .collect::<Vec<_>>(),
                expected_attribution,
                "attributed sequence must independently match the emitted journal, seed {seed}"
            );
            for row in &receipt.net_diff {
                match row.disposition {
                    NetDiffDispositionV1::Added => {
                        assert!(row.before.is_none() && row.after.is_some())
                    }
                    NetDiffDispositionV1::Updated => {
                        assert!(row.before.is_some() && row.after.is_some())
                    }
                    NetDiffDispositionV1::Deleted => {
                        assert!(row.before.is_some() && row.after.is_none())
                    }
                }
            }
        }
    }

    #[test]
    fn exact_diff_refuses_unjournaled_writes_and_exhausted_digest_work() {
        let mut canonical = source(1);
        let direct = create_request("direct-bypass", "child-direct", 1, 100);
        create_in_app_branch(&mut canonical, &direct).expect("branch");
        let workspace = MaterializedBase::materialize(&canonical, None).expect("workspace");
        workspace
            .conn
            .execute("UPDATE widgets SET name='unjournaled' WHERE id=1", [])
            .expect("bypass write");
        assert_eq!(
            exact_fork_diff(&workspace, &direct.branch_id, scan_widgets)
                .expect_err("independent oracle catches missing journal fact")
                .diagnostic
                .code,
            "SNAPBACK_BRANCH_DIFF_JOURNAL_INCOMPLETE"
        );

        let mut canonical = source(1);
        let mut bounded = create_request("digest-bound", "child-digest-bound", 1, 100);
        bounded.limits.max_digest_work_bytes = 1;
        create_in_app_branch(&mut canonical, &bounded).expect("branch");
        let workspace = MaterializedBase::materialize(&canonical, None).expect("workspace");
        assert_eq!(
            exact_fork_diff(&workspace, &bounded.branch_id, scan_widgets)
                .expect_err("even an empty diff accounts for its oracle and journal inputs")
                .diagnostic
                .code,
            "SNAPBACK_BRANCH_DIGEST_WORK_LIMIT_EXCEEDED"
        );
        assert_eq!(
            crate::storage::current_version_on(&canonical).expect("canonical head"),
            1,
            "read-side work refusal cannot mutate canonical state"
        );
    }

    #[test]
    fn sealed_strict_promotion_reexecutes_once_and_retries_from_receipt() {
        let (mut canonical, workspace, diff) = branch_with_rename();
        canonical
            .execute(
                "INSERT INTO _snapback_history_policies_v1(table_name,retain_ms,max_rows)
                 VALUES('widgets',60000,100)",
                [],
            )
            .expect("history policy");
        let key = PromotionSealKey::from_server_secret([7_u8; 32]).expect("key");
        let ticket_identity = host_identity("canonical", "promotion-ticket-1", "app-1");
        let aggregate_operation_id = ticket_identity.key.operation_id.clone();
        let ticket = issue_promotion_ticket(
            &mut canonical,
            ticket_identity.clone(),
            &diff.branch_id,
            "canonical",
            1,
            60_000,
            2_000,
            PromotionContentionPolicyV1 {
                reservation_after_losses: 2,
                reservation_interval_ms: 1_000,
                reservation_quota: 1,
                maximum_commit_duration_ms: 500,
            },
        )
        .expect("ticket");
        let request = seal_promotion_request(
            &workspace,
            &diff,
            PromotionApprovalV1 {
                approver_principal_id: "agent-1".to_owned(),
                approver_grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
                approved_at_ms: 2_001,
                expires_at_ms: 50_000,
            },
            ticket,
            ticket_identity,
            &sha('f'),
            &key,
            2_001,
        )
        .expect("seal");
        let mut replay_count = 0;
        for (authority, now_ms) in [
            (PromotionAuthorityDecisionV1::Denied, 2_002),
            (
                PromotionAuthorityDecisionV1::Revalidated {
                    grant_id: "grant-1".to_owned(),
                    authority_fingerprint: sha('0'),
                },
                2_002,
            ),
            (
                PromotionAuthorityDecisionV1::Revalidated {
                    grant_id: "grant-1".to_owned(),
                    authority_fingerprint: sha('d'),
                },
                50_000,
            ),
        ] {
            let denied = promote_by_reexecution(
                &mut canonical,
                &workspace,
                &diff,
                &request,
                &key,
                &authority,
                now_ms,
                &sha('f'),
                |_, _| panic!("revoked, divergent, or stale authority must not reexecute"),
            )
            .expect_err("current branch authority required");
            assert_eq!(
                denied.diagnostic.code,
                "SNAPBACK_PROMOTION_AUTHORITY_DENIED"
            );
        }
        let mut forged_ticket_request = request.clone();
        forged_ticket_request.admission_ticket.rebase_budget += 1;
        forged_ticket_request.seal =
            promotion_request_seal(&forged_ticket_request, &key).expect("reseal forged ticket");
        let error = promote_by_reexecution(
            &mut canonical,
            &workspace,
            &diff,
            &forged_ticket_request,
            &key,
            &PromotionAuthorityDecisionV1::Revalidated {
                grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
            },
            2_002,
            &sha('f'),
            |_, _| panic!("forged durable ticket must not reexecute"),
        )
        .expect_err("sealed caller ticket cannot override durable admission facts");
        assert_eq!(error.diagnostic.code, "SNAPBACK_PROMOTION_TICKET_MISMATCH");
        let promoted = promote_by_reexecution(
            &mut canonical,
            &workspace,
            &diff,
            &request,
            &key,
            &PromotionAuthorityDecisionV1::Revalidated {
                grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
            },
            2_002,
            &sha('f'),
            |context, operation| {
                replay_count += 1;
                assert_eq!(
                    context.read_row("widgets", "1")?.expect("canonical widget")["name"],
                    "alpha"
                );
                let name = operation.canonical_arguments["name"]
                    .as_str()
                    .expect("name");
                Ok(facts(name))
            },
        )
        .expect("promote");
        assert_eq!(replay_count, 1);
        assert_eq!(promoted.receipt.canonical_version, 6);
        assert!(promoted.receipt.boundary_proof.matches);
        assert_eq!(
            promoted.receipt.boundary_proof.proof_class,
            crate::proof_checkpoint::ProofClassV1::IndependentBoundaryProof
        );
        assert_eq!(
            crate::storage::current_version_on(&canonical).expect("head"),
            6
        );
        assert_eq!(
            scan_widgets(&canonical).expect("rows")[0].row["name"],
            "ALPHA"
        );
        let journal: (String, String, String, Option<String>) = canonical
            .query_row(
                "SELECT table_name,row_id,op,row_json FROM _snapback_changes WHERE version=6",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("promotion journal");
        assert_eq!(journal.0, "widgets");
        assert_eq!(journal.1, "1");
        assert_eq!(journal.2, "update");
        assert_eq!(
            decode_json::<Value>(
                journal.3.as_deref().expect("journal post-image").as_bytes(),
                "journal assertion",
            )
            .expect("journal JSON"),
            json!({ "id": 1, "name": "ALPHA" })
        );
        let history_operation_id: String = canonical
            .query_row(
                "SELECT operation_id FROM _snapback_record_history_v1 WHERE version=6",
                [],
                |row| row.get(0),
            )
            .expect("history operation identity");
        assert_eq!(history_operation_id, aggregate_operation_id);
        assert_eq!(
            promoted.aggregate_envelope.coverage.uncovered_lanes,
            [PROMOTION_COVERAGE_GAP_V1]
        );
        let retry = promote_by_reexecution(
            &mut canonical,
            &workspace,
            &diff,
            &request,
            &key,
            &PromotionAuthorityDecisionV1::Denied,
            2_003,
            &sha('f'),
            |_, _| panic!("stored retry must not reexecute"),
        )
        .expect("stored receipt");
        assert_eq!(retry, promoted);
        let mut divergent_retry = request.clone();
        divergent_retry.schema_hash = sha('0');
        divergent_retry.seal = promotion_request_seal(&divergent_retry, &key).expect("reseal");
        let error = promote_by_reexecution(
            &mut canonical,
            &workspace,
            &diff,
            &divergent_retry,
            &key,
            &PromotionAuthorityDecisionV1::Denied,
            2_003,
            &sha('0'),
            |_, _| panic!("divergent retry must not reexecute"),
        )
        .expect_err("one promotion identity cannot retrieve a divergent request");
        assert_eq!(error.diagnostic.code, "SNAPBACK_PROMOTION_IDENTITY_REUSED");
        let joins: i64 = canonical
            .query_row(
                "SELECT COUNT(*) FROM _snapback_promotion_source_joins",
                [],
                |row| row.get(0),
            )
            .expect("joins");
        assert_eq!(
            joins, 1,
            "write-fact-granularity source join survives branch teardown"
        );
    }

    #[test]
    fn forged_diff_postimage_cannot_supply_the_expected_promotion_boundary() {
        let (mut canonical, workspace, mut diff) = branch_with_rename();
        diff.net_diff[0].after = Some(json!({ "id": 1, "name": "FORGED" }));
        diff.diff_digest = digest_json(
            b"exact-fork-diff",
            &(
                &diff.base_stream,
                diff.base_version,
                &diff.child_stream_id,
                diff.child_head,
                &diff.coverage,
                &diff.attributed_changes,
                &diff.net_diff,
            ),
        )
        .expect("forge internally consistent diff digest");
        let key = PromotionSealKey::from_server_secret([17_u8; 32]).expect("key");
        let aggregate = host_identity("canonical", "promotion-proof-negative", "app-1");
        let ticket = issue_promotion_ticket(
            &mut canonical,
            aggregate.clone(),
            &diff.branch_id,
            "canonical",
            1,
            60_000,
            2_000,
            PromotionContentionPolicyV1 {
                reservation_after_losses: 2,
                reservation_interval_ms: 1_000,
                reservation_quota: 1,
                maximum_commit_duration_ms: 500,
            },
        )
        .expect("ticket");
        let request = seal_promotion_request(
            &workspace,
            &diff,
            PromotionApprovalV1 {
                approver_principal_id: "agent-1".to_owned(),
                approver_grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
                approved_at_ms: 2_001,
                expires_at_ms: 50_000,
            },
            ticket,
            aggregate,
            &sha('f'),
            &key,
            2_001,
        )
        .expect("seal");
        let mut replay_count = 0;
        let error = promote_by_reexecution(
            &mut canonical,
            &workspace,
            &diff,
            &request,
            &key,
            &PromotionAuthorityDecisionV1::Revalidated {
                grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
            },
            2_002,
            &sha('f'),
            |_, operation| {
                replay_count += 1;
                let name = operation.canonical_arguments["name"]
                    .as_str()
                    .expect("name");
                Ok(facts(name))
            },
        )
        .expect_err("diff cannot override approved write facts");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_PROMOTION_DIFF_FACTS_MISMATCH"
        );
        assert_eq!(replay_count, 0, "diff consistency fails before staging");
        assert_eq!(
            crate::storage::current_version_on(&canonical).expect("head"),
            5
        );
        assert_eq!(
            scan_widgets(&canonical).expect("rows")[0].row["name"],
            "alpha"
        );
    }

    #[test]
    fn unjournaled_trigger_side_path_cannot_publish_a_proof_or_complete_envelope() {
        let (mut canonical, workspace, diff) = branch_with_rename();
        canonical
            .execute_batch(
                "CREATE TABLE shadow_writes (widget_id INTEGER NOT NULL);
                 CREATE TRIGGER widgets_shadow AFTER UPDATE ON widgets
                 BEGIN
                   INSERT INTO shadow_writes(widget_id) VALUES (NEW.id);
                 END;",
            )
            .expect("unjournaled trigger fixture");
        let key = PromotionSealKey::from_server_secret([18_u8; 32]).expect("key");
        let aggregate = host_identity("canonical", "promotion-trigger-negative", "app-1");
        let ticket = issue_promotion_ticket(
            &mut canonical,
            aggregate.clone(),
            &diff.branch_id,
            "canonical",
            1,
            60_000,
            2_000,
            PromotionContentionPolicyV1 {
                reservation_after_losses: 2,
                reservation_interval_ms: 1_000,
                reservation_quota: 1,
                maximum_commit_duration_ms: 500,
            },
        )
        .expect("ticket");
        let request = seal_promotion_request(
            &workspace,
            &diff,
            PromotionApprovalV1 {
                approver_principal_id: "agent-1".to_owned(),
                approver_grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
                approved_at_ms: 2_001,
                expires_at_ms: 50_000,
            },
            ticket,
            aggregate,
            &sha('f'),
            &key,
            2_001,
        )
        .expect("seal");
        let mut replay_count = 0;
        let error = promote_by_reexecution(
            &mut canonical,
            &workspace,
            &diff,
            &request,
            &key,
            &PromotionAuthorityDecisionV1::Revalidated {
                grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
            },
            2_002,
            &sha('f'),
            |_, operation| {
                replay_count += 1;
                Ok(facts(
                    operation.canonical_arguments["name"]
                        .as_str()
                        .expect("name"),
                ))
            },
        )
        .expect_err("trigger is outside the closed journal path");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_PROMOTION_WRITE_PATH_UNCOVERED"
        );
        assert_eq!(replay_count, 0, "preflight refuses before replay");
        assert_eq!(
            crate::storage::current_version_on(&canonical).expect("head"),
            5
        );
        assert_eq!(
            scan_widgets(&canonical).expect("rows")[0].row["name"],
            "alpha"
        );
        assert_eq!(
            canonical
                .query_row("SELECT COUNT(*) FROM shadow_writes", [], |row| row
                    .get::<_, i64>(0))
                .expect("shadow count"),
            0
        );
        assert_eq!(
            canonical
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_promotion_envelopes",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("envelope count"),
            0
        );
    }

    #[test]
    fn approved_write_folding_is_ordered_and_refuses_impossible_deletes() {
        let (_, workspace, diff) = branch_with_rename();
        let mut operations =
            branch_operation_log(&workspace.conn, &diff.branch_id).expect("operation log");
        let mut mislabeled = operations.clone();
        mislabeled[0].approved_facts.coverage.covered_lanes = vec!["unrelatedLane".to_owned()];
        assert_eq!(
            promotion_scope(&mislabeled, ForkEgressPolicyV1::DenyAll)
                .expect_err("unrelated coverage lane cannot label a complete promotion")
                .diagnostic
                .code,
            "SNAPBACK_PROMOTION_WRITE_COVERAGE_INCOMPLETE"
        );
        let mut effectful = operations.clone();
        effectful[0].approved_facts.effects = vec![json!({ "network": "simulated" })];
        assert_eq!(
            validate_captured_effect_custody(ForkEgressPolicyV1::DenyAll, &effectful, &[],)
                .expect_err("DenyAll promotion cannot silently drop approved effect facts")
                .diagnostic
                .code,
            "SNAPBACK_BRANCH_NOT_PROMOTABLE"
        );
        operations[0].approved_facts.writes = vec![
            LogicalWriteFactV1 {
                table_name: "widgets".to_owned(),
                row_id: "2".to_owned(),
                after: Some(json!({ "id": 2, "name": "BETA" })),
            },
            LogicalWriteFactV1 {
                table_name: "widgets".to_owned(),
                row_id: "1".to_owned(),
                after: None,
            },
            LogicalWriteFactV1 {
                table_name: "widgets".to_owned(),
                row_id: "1".to_owned(),
                after: Some(json!({ "id": 1, "name": "OMEGA" })),
            },
        ];
        let (_, base_rows) = scan_promotion_scope(
            workspace.immutable_base(),
            &BTreeSet::from(["widgets".to_owned()]),
        )
        .expect("trusted base scan");
        let folded = folded_approved_writes(&base_rows, &operations).expect("fold");
        assert_eq!(folded.len(), 2);
        assert_eq!(
            (
                folded[0].qualified_table.as_str(),
                folded[0].row_id.as_str()
            ),
            ("widgets", "1")
        );
        assert_eq!(folded[0].kind, PromotionWriteKindV1::Update);
        assert_eq!(
            folded[0].post_image,
            Some(json!({ "id": 1, "name": "OMEGA" }))
        );
        assert_eq!(
            (
                folded[1].qualified_table.as_str(),
                folded[1].row_id.as_str()
            ),
            ("widgets", "2")
        );

        operations[0].approved_facts.writes = vec![LogicalWriteFactV1 {
            table_name: "widgets".to_owned(),
            row_id: "missing".to_owned(),
            after: None,
        }];
        let error = folded_approved_writes(&base_rows, &operations)
            .expect_err("delete of an absent row is a sealed-fact conflict");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_PROMOTION_APPROVED_FACTS_CONFLICT"
        );
    }

    #[test]
    fn branch_write_after_review_and_advanced_canonical_both_refuse() {
        let (mut canonical, mut workspace, diff) = branch_with_rename();
        let key = PromotionSealKey::from_server_secret([8_u8; 32]).expect("key");
        let ticket_identity = host_identity("canonical", "promotion-ticket-2", "app-1");
        let ticket = issue_promotion_ticket(
            &mut canonical,
            ticket_identity.clone(),
            &diff.branch_id,
            "canonical",
            1,
            60_000,
            2_000,
            PromotionContentionPolicyV1 {
                reservation_after_losses: 2,
                reservation_interval_ms: 1_000,
                reservation_quota: 1,
                maximum_commit_duration_ms: 500,
            },
        )
        .expect("ticket");
        let request = seal_promotion_request(
            &workspace,
            &diff,
            PromotionApprovalV1 {
                approver_principal_id: "agent-1".to_owned(),
                approver_grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
                approved_at_ms: 2_001,
                expires_at_ms: 50_000,
            },
            ticket,
            ticket_identity,
            &sha('f'),
            &key,
            2_001,
        )
        .expect("seal");
        let late = draft("child-a", "branch-op-late");
        execute_branch_operation(
            &mut workspace.conn,
            &diff.branch_id,
            &late,
            2_002,
            |tx, _| {
                tx.execute("UPDATE widgets SET name='late' WHERE id=2", [])?;
                let mut facts = facts("late");
                facts.writes[0].row_id = "2".to_owned();
                Ok(facts)
            },
        )
        .expect("late write");
        let error = promote_by_reexecution(
            &mut canonical,
            &workspace,
            &diff,
            &request,
            &key,
            &PromotionAuthorityDecisionV1::Revalidated {
                grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
            },
            2_003,
            &sha('f'),
            |_, _| unreachable!(),
        )
        .expect_err("head changed");
        assert_eq!(error.diagnostic.code, "SNAPBACK_PROMOTION_HEAD_CHANGED");

        let (mut canonical, workspace, diff) = branch_with_rename();
        let ticket_identity = host_identity("canonical", "promotion-ticket-3", "app-1");
        let ticket = issue_promotion_ticket(
            &mut canonical,
            ticket_identity.clone(),
            &diff.branch_id,
            "canonical",
            1,
            60_000,
            2_000,
            PromotionContentionPolicyV1 {
                reservation_after_losses: 2,
                reservation_interval_ms: 1_000,
                reservation_quota: 1,
                maximum_commit_duration_ms: 500,
            },
        )
        .expect("ticket");
        let request = seal_promotion_request(
            &workspace,
            &diff,
            PromotionApprovalV1 {
                approver_principal_id: "agent-1".to_owned(),
                approver_grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
                approved_at_ms: 2_001,
                expires_at_ms: 50_000,
            },
            ticket,
            ticket_identity,
            &sha('f'),
            &key,
            2_001,
        )
        .expect("seal");
        canonical
            .execute("UPDATE _snapback_version SET version=6 WHERE id=1", [])
            .expect("advance");
        let error = promote_by_reexecution(
            &mut canonical,
            &workspace,
            &diff,
            &request,
            &key,
            &PromotionAuthorityDecisionV1::Revalidated {
                grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
            },
            2_003,
            &sha('f'),
            |_, _| unreachable!(),
        )
        .expect_err("strict CAS");
        assert_eq!(error.diagnostic.code, "SNAPBACK_PROMOTION_BASE_ADVANCED");
    }

    #[test]
    fn replay_divergence_rolls_back_and_fifo_is_deterministic() {
        let (mut canonical, workspace, diff) = branch_with_rename();
        let key = PromotionSealKey::from_server_secret([9_u8; 32]).expect("key");
        let first_identity = host_identity("canonical", "ticket-first", "app-1");
        let second_identity = host_identity("canonical", "ticket-second", "app-1");
        let policy = PromotionContentionPolicyV1 {
            reservation_after_losses: 2,
            reservation_interval_ms: 1_000,
            reservation_quota: 1,
            maximum_commit_duration_ms: 500,
        };
        let first = issue_promotion_ticket(
            &mut canonical,
            first_identity.clone(),
            &diff.branch_id,
            "canonical",
            2,
            60_000,
            2_000,
            policy.clone(),
        )
        .expect("first");
        let second = issue_promotion_ticket(
            &mut canonical,
            second_identity,
            &BranchId("other".to_owned()),
            "canonical",
            2,
            60_000,
            2_000,
            policy,
        )
        .expect("second");
        assert!(first.fifo_sequence < second.fifo_sequence);
        let request = seal_promotion_request(
            &workspace,
            &diff,
            PromotionApprovalV1 {
                approver_principal_id: "agent-1".to_owned(),
                approver_grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
                approved_at_ms: 2_001,
                expires_at_ms: 50_000,
            },
            first,
            first_identity,
            &sha('f'),
            &key,
            2_001,
        )
        .expect("seal");
        let error = promote_by_reexecution(
            &mut canonical,
            &workspace,
            &diff,
            &request,
            &key,
            &PromotionAuthorityDecisionV1::Revalidated {
                grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
            },
            2_002,
            &sha('f'),
            |_, _| Ok(facts("WRONG")),
        )
        .expect_err("facts diverge");
        assert_eq!(error.diagnostic.code, "SNAPBACK_PROMOTION_REPLAY_DIVERGED");
        assert_eq!(
            scan_widgets(&canonical).expect("canonical")[0].row["name"],
            "alpha"
        );
        assert_eq!(
            crate::storage::current_version_on(&canonical).expect("head"),
            5
        );
    }

    #[test]
    fn production_contention_terms_bound_reservation_quota_and_writer_admission() {
        assert_eq!(
            PromotionContentionPolicyV1::default(),
            PRODUCTION_PROMOTION_CONTENTION_POLICY_V1
        );
        let mut canonical = source(1);
        let mut drifted = PromotionContentionPolicyV1::default();
        drifted.reservation_interval_ms += 1;
        assert_eq!(
            issue_promotion_ticket(
                &mut canonical,
                host_identity("canonical", "ticket-drifted-policy", "app-1"),
                &BranchId("branch-drifted-policy".to_owned()),
                "canonical",
                2,
                60_000,
                2_000,
                drifted,
            )
            .expect_err("production admission refuses drifted contention terms")
            .diagnostic
            .code,
            "SNAPBACK_PROMOTION_CONTENTION_POLICY_INVALID"
        );

        let first = issue_promotion_ticket(
            &mut canonical,
            host_identity("canonical", "ticket-reservation-first", "app-1"),
            &BranchId("branch-reservation-first".to_owned()),
            "canonical",
            2,
            60_000,
            2_000,
            PromotionContentionPolicyV1::default(),
        )
        .expect("first ticket");
        let second = issue_promotion_ticket(
            &mut canonical,
            host_identity("canonical", "ticket-reservation-second", "app-1"),
            &BranchId("branch-reservation-second".to_owned()),
            "canonical",
            2,
            60_000,
            2_000,
            PromotionContentionPolicyV1::default(),
        )
        .expect("second ticket");
        assert!(first.fifo_sequence < second.fifo_sequence);
        assert_eq!(
            request_head_reservation(&canonical, &first, 2_500)
                .expect_err("loss threshold is mandatory")
                .diagnostic
                .code,
            "SNAPBACK_PROMOTION_RESERVATION_NOT_ELIGIBLE"
        );
        for _ in 0..PRODUCTION_PROMOTION_CONTENTION_POLICY_V1.reservation_after_losses {
            note_ticket_loss(&canonical, &first).expect("record first loss");
            note_ticket_loss(&canonical, &second).expect("record second loss");
        }
        let until = request_head_reservation(&canonical, &first, 3_000)
            .expect("eligible FIFO head reserves once");
        assert_eq!(until, 4_000);
        assert_eq!(
            canonical_mutation_admission(&canonical, "canonical", 3_001).expect("writer admission"),
            CanonicalAdmissionV1::DeferredByPromotionReservation { until_ms: 4_000 }
        );
        assert_eq!(
            request_head_reservation(&canonical, &second, 3_001)
                .expect_err("only the live FIFO head may reserve")
                .diagnostic
                .code,
            "SNAPBACK_PROMOTION_NOT_FIFO_HEAD"
        );
        assert_eq!(
            request_head_reservation(&canonical, &first, 3_001)
                .expect("the exact head retry observes its durable interval"),
            4_000
        );
        assert_eq!(
            canonical_mutation_admission(&canonical, "canonical", 4_000)
                .expect("expired reservation releases ordinary writer"),
            CanonicalAdmissionV1::Admit
        );
    }

    #[test]
    fn concurrent_reservation_is_fifo_singleton_and_survives_writer_process_death() {
        let directory = tempfile::tempdir().expect("tempdir");
        let canonical_path = directory.path().join("canonical.sqlite3");
        let mut canonical = file_source(&canonical_path, 1);
        let first = issue_promotion_ticket(
            &mut canonical,
            host_identity("canonical", "concurrent-reservation-first", "app-1"),
            &BranchId("concurrent-reservation-first".to_owned()),
            "canonical",
            2,
            60_000,
            2_000,
            PromotionContentionPolicyV1::default(),
        )
        .expect("first ticket");
        let second = issue_promotion_ticket(
            &mut canonical,
            host_identity("canonical", "concurrent-reservation-second", "app-1"),
            &BranchId("concurrent-reservation-second".to_owned()),
            "canonical",
            2,
            60_000,
            2_000,
            PromotionContentionPolicyV1::default(),
        )
        .expect("second ticket");
        for _ in 0..PRODUCTION_PROMOTION_CONTENTION_POLICY_V1.reservation_after_losses {
            note_ticket_loss(&canonical, &first).expect("record first loss");
            note_ticket_loss(&canonical, &second).expect("record second loss");
        }
        drop(canonical);

        let gate = std::sync::Arc::new(std::sync::Barrier::new(3));
        let first_thread = {
            let gate = gate.clone();
            let path = canonical_path.clone();
            let ticket = first.clone();
            std::thread::spawn(move || {
                let conn = Connection::open(path).expect("first connection");
                conn.busy_timeout(std::time::Duration::from_secs(2))
                    .expect("first busy timeout");
                gate.wait();
                request_head_reservation(&conn, &ticket, 3_000)
            })
        };
        let second_thread = {
            let gate = gate.clone();
            let path = canonical_path.clone();
            let ticket = second.clone();
            std::thread::spawn(move || {
                let conn = Connection::open(path).expect("second connection");
                conn.busy_timeout(std::time::Duration::from_secs(2))
                    .expect("second busy timeout");
                gate.wait();
                request_head_reservation(&conn, &ticket, 3_000)
            })
        };
        gate.wait();
        let first_result = first_thread.join().expect("first thread");
        let second_result = second_thread.join().expect("second thread");
        assert_eq!(first_result.expect("FIFO head reserves"), 4_000);
        assert_eq!(
            second_result
                .expect_err("concurrent non-head never consumes the singleton quota")
                .diagnostic
                .code,
            "SNAPBACK_PROMOTION_NOT_FIFO_HEAD"
        );

        // Both reservation callers are gone here. Reopening a third connection
        // models host-process death without weakening the durable writer gate.
        let reopened = Connection::open(&canonical_path).expect("reopen after process death");
        assert_eq!(
            canonical_mutation_admission(&reopened, "canonical", 3_001)
                .expect("durable admission after reopen"),
            CanonicalAdmissionV1::DeferredByPromotionReservation { until_ms: 4_000 }
        );
        assert_eq!(
            reopened
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_promotion_admission
                      WHERE canonical_stream_id='canonical' AND reserved_until_ms > 3001",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("singleton reservation count"),
            1
        );
        assert_eq!(
            canonical_mutation_admission(&reopened, "canonical", 4_000)
                .expect("bounded interval expires after reopen"),
            CanonicalAdmissionV1::Admit
        );
    }

    #[test]
    fn concurrent_ticket_issuance_serializes_into_one_durable_fifo() {
        const FORKS: usize = 4;
        let directory = tempfile::tempdir().expect("tempdir");
        let canonical_path = directory.path().join("canonical.sqlite3");
        let canonical = file_source(&canonical_path, 1);
        ensure_promotion_tables(&canonical).expect("promotion tables before concurrent issue");
        drop(canonical);

        let gate = std::sync::Arc::new(std::sync::Barrier::new(FORKS + 1));
        let threads = (0..FORKS)
            .map(|index| {
                let gate = gate.clone();
                let path = canonical_path.clone();
                std::thread::spawn(move || {
                    let mut conn = Connection::open(path).expect("ticket issuer connection");
                    conn.busy_timeout(std::time::Duration::from_secs(5))
                        .expect("ticket issuer busy timeout");
                    let identity =
                        host_identity("canonical", &format!("concurrent-ticket-{index}"), "app-1");
                    let branch_id = BranchId(format!("concurrent-branch-{index}"));
                    gate.wait();
                    issue_promotion_ticket(
                        &mut conn,
                        identity,
                        &branch_id,
                        "canonical",
                        FORKS as u64,
                        60_000,
                        2_000,
                        PromotionContentionPolicyV1::default(),
                    )
                })
            })
            .collect::<Vec<_>>();
        gate.wait();
        let mut tickets = threads
            .into_iter()
            .map(|thread| {
                thread
                    .join()
                    .expect("ticket issuer")
                    .expect("durable ticket")
            })
            .collect::<Vec<_>>();
        tickets.sort_by_key(|ticket| ticket.fifo_sequence);
        assert_eq!(
            tickets
                .iter()
                .map(|ticket| ticket.fifo_sequence)
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4]
        );
        assert!(tickets.iter().all(|ticket| {
            ticket.initial_queue_position == ticket.fifo_sequence
                && ticket.observed_concurrent_forks == FORKS as u64
                && ticket.rebase_budget >= FORKS as u64
        }));

        let reopened = Connection::open(&canonical_path).expect("reopen issued FIFO");
        assert_eq!(
            reopened
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_promotion_admission
                      WHERE canonical_stream_id='canonical' AND state='queued'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("durable queue count"),
            FORKS as i64
        );
        assert_eq!(
            active_fifo_ticket(&reopened, "canonical", 2_001).expect("FIFO head"),
            Some(tickets[0].ticket_identity.key.operation_id.clone())
        );
    }

    #[test]
    fn expired_reservation_needs_fresh_losses_before_the_ticket_can_defer_again() {
        let mut canonical = source(1);
        let ticket = issue_promotion_ticket(
            &mut canonical,
            host_identity("canonical", "reservation-loss-floor", "app-1"),
            &BranchId("reservation-loss-floor".to_owned()),
            "canonical",
            1,
            60_000,
            2_000,
            PromotionContentionPolicyV1::default(),
        )
        .expect("ticket");
        for _ in 0..PRODUCTION_PROMOTION_CONTENTION_POLICY_V1.reservation_after_losses {
            note_ticket_loss(&canonical, &ticket).expect("first loss group");
        }
        assert_eq!(
            request_head_reservation(&canonical, &ticket, 3_000).expect("first reservation"),
            4_000
        );
        assert_eq!(
            request_head_reservation(&canonical, &ticket, 4_000)
                .expect_err("expiry alone cannot mint another deferral")
                .diagnostic
                .code,
            "SNAPBACK_PROMOTION_RESERVATION_NOT_ELIGIBLE"
        );
        for _ in 0..PRODUCTION_PROMOTION_CONTENTION_POLICY_V1.reservation_after_losses {
            note_ticket_loss(&canonical, &ticket).expect("fresh loss group");
        }
        assert_eq!(
            request_head_reservation(&canonical, &ticket, 4_000)
                .expect("fresh losses restore bounded eligibility"),
            5_000
        );
    }

    #[test]
    fn promotion_crash_reopen_matrix_retains_admission_then_replays_committed_release() {
        let directory = tempfile::tempdir().expect("tempdir");
        let canonical_path = directory.path().join("canonical.sqlite3");
        let mut canonical = file_source(&canonical_path, 5);
        let create = create_request("crash-matrix", "crash-matrix-child", 5, 1_000);
        create_in_app_branch(&mut canonical, &create).expect("branch");
        let mut workspace = MaterializedBase::materialize(&canonical, None).expect("workspace");
        execute_branch_operation(
            &mut workspace.conn,
            &create.branch_id,
            &draft("crash-matrix-child", "crash-matrix-operation"),
            1_001,
            |tx, _| {
                tx.execute(
                    "UPDATE widgets SET name='CRASHED-THEN-COMMITTED' WHERE id=1",
                    [],
                )?;
                Ok(facts("CRASHED-THEN-COMMITTED"))
            },
        )
        .expect("branch operation");
        let diff = exact_fork_diff(&workspace, &create.branch_id, scan_widgets).expect("diff");
        let key = PromotionSealKey::from_server_secret([19_u8; 32]).expect("key");
        let ticket_identity = host_identity("canonical", "crash-matrix-ticket", "app-1");
        let ticket = issue_promotion_ticket(
            &mut canonical,
            ticket_identity.clone(),
            &diff.branch_id,
            "canonical",
            1,
            60_000,
            2_000,
            PromotionContentionPolicyV1::default(),
        )
        .expect("ticket");
        let request = seal_promotion_request(
            &workspace,
            &diff,
            PromotionApprovalV1 {
                approver_principal_id: "agent-1".to_owned(),
                approver_grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
                approved_at_ms: 2_001,
                expires_at_ms: 50_000,
            },
            ticket.clone(),
            ticket_identity,
            &sha('f'),
            &key,
            2_001,
        )
        .expect("seal");
        for _ in 0..PRODUCTION_PROMOTION_CONTENTION_POLICY_V1.reservation_after_losses {
            note_ticket_loss(&canonical, &ticket).expect("eligible loss");
        }
        assert_eq!(
            request_head_reservation(&canonical, &ticket, 3_000).expect("reservation cut"),
            4_000
        );
        drop(canonical);

        let mut admitted = Connection::open(&canonical_path).expect("reopen reservation cut");
        admitted
            .busy_timeout(std::time::Duration::from_secs(5))
            .expect("busy timeout");
        assert_eq!(
            canonical_mutation_admission(&admitted, "canonical", 3_001)
                .expect("durable reservation"),
            CanonicalAdmissionV1::DeferredByPromotionReservation { until_ms: 4_000 }
        );
        let crashed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = promote_by_reexecution(
                &mut admitted,
                &workspace,
                &diff,
                &request,
                &key,
                &PromotionAuthorityDecisionV1::Revalidated {
                    grant_id: "grant-1".to_owned(),
                    authority_fingerprint: sha('d'),
                },
                3_001,
                &sha('f'),
                |_, _| panic!("simulated process death after promotion admission"),
            );
        }));
        assert!(crashed.is_err());
        drop(admitted);

        let mut reopened = Connection::open(&canonical_path).expect("reopen admission cut");
        assert_eq!(
            crate::storage::current_version_on(&reopened).expect("head after admission crash"),
            5
        );
        assert_eq!(
            reopened
                .query_row(
                    "SELECT state FROM _snapback_promotion_admission WHERE ticket_id=?1",
                    params![request.aggregate_identity.key.operation_id],
                    |row| row.get::<_, String>(0),
                )
                .expect("queued ticket after admission crash"),
            "queued"
        );
        let committed = promote_by_reexecution(
            &mut reopened,
            &workspace,
            &diff,
            &request,
            &key,
            &PromotionAuthorityDecisionV1::Revalidated {
                grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
            },
            3_002,
            &sha('f'),
            |_, operation| Ok(operation.approved_facts.clone()),
        )
        .expect("retry after admission crash commits once");
        assert_eq!(committed.receipt.canonical_version, 6);
        drop(reopened);

        // Model process death after SQLite commit but before the response was
        // observed. The exact request reopens from its atomic receipt and the
        // completed queue row releases ordinary writers in the same commit.
        let mut released = Connection::open(&canonical_path).expect("reopen commit cut");
        let retry = promote_by_reexecution(
            &mut released,
            &workspace,
            &diff,
            &request,
            &key,
            &PromotionAuthorityDecisionV1::Denied,
            3_003,
            &sha('f'),
            |_, _| panic!("committed retry must not reexecute"),
        )
        .expect("committed receipt retry");
        assert_eq!(retry, committed);
        assert_eq!(
            canonical_mutation_admission(&released, "canonical", 3_003)
                .expect("completed promotion releases writer admission"),
            CanonicalAdmissionV1::Admit
        );
        assert_eq!(
            released
                .query_row(
                    "SELECT state FROM _snapback_promotion_admission WHERE ticket_id=?1",
                    params![request.aggregate_identity.key.operation_id],
                    |row| row.get::<_, String>(0),
                )
                .expect("completed queue state"),
            "completed"
        );
    }

    #[test]
    fn reservation_expiry_mid_attempt_rolls_back_and_retains_the_fifo_ticket() {
        let (mut canonical, workspace, diff) = branch_with_rename();
        let key = PromotionSealKey::from_server_secret([20_u8; 32]).expect("key");
        let ticket_identity = host_identity("canonical", "reservation-expiry", "app-1");
        let ticket = issue_promotion_ticket(
            &mut canonical,
            ticket_identity.clone(),
            &diff.branch_id,
            "canonical",
            1,
            60_000,
            2_000,
            PromotionContentionPolicyV1::default(),
        )
        .expect("ticket");
        let request = seal_promotion_request(
            &workspace,
            &diff,
            PromotionApprovalV1 {
                approver_principal_id: "agent-1".to_owned(),
                approver_grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
                approved_at_ms: 2_001,
                expires_at_ms: 50_000,
            },
            ticket.clone(),
            ticket_identity,
            &sha('f'),
            &key,
            2_001,
        )
        .expect("seal");
        for _ in 0..PRODUCTION_PROMOTION_CONTENTION_POLICY_V1.reservation_after_losses {
            note_ticket_loss(&canonical, &ticket).expect("eligible loss");
        }
        assert_eq!(
            request_head_reservation(&canonical, &ticket, 3_000).expect("reservation"),
            4_000
        );
        let before = scan_widgets(&canonical).expect("before");
        assert_eq!(
            promote_by_reexecution(
                &mut canonical,
                &workspace,
                &diff,
                &request,
                &key,
                &PromotionAuthorityDecisionV1::Revalidated {
                    grant_id: "grant-1".to_owned(),
                    authority_fingerprint: sha('d'),
                },
                3_999,
                &sha('f'),
                |_, operation| {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    Ok(operation.approved_facts.clone())
                },
            )
            .expect_err("reservation expires before commit")
            .diagnostic
            .code,
            "SNAPBACK_PROMOTION_RESERVATION_EXPIRED"
        );
        assert_eq!(scan_widgets(&canonical).expect("after rollback"), before);
        assert_eq!(
            crate::storage::current_version_on(&canonical).expect("head after rollback"),
            5
        );
        assert_eq!(
            promotion_admission_state(&canonical, &ticket)
                .expect("retained queued ticket")
                .losses,
            2
        );
    }

    fn assert_concurrent_reviewed_forks_make_bounded_fifo_progress(forks: usize) {
        let directory = tempfile::tempdir().expect("tempdir");
        let canonical_path = directory.path().join("canonical.sqlite3");
        let mut canonical = file_source(&canonical_path, 5);
        let key = PromotionSealKey::from_server_secret([21_u8; 32]).expect("key");
        let mut pending = (0..forks)
            .map(|index| make_fair_candidate(&mut canonical, &key, index, forks as u64, 1_000))
            .collect::<Vec<_>>();
        assert!(pending.windows(2).all(|pair| {
            pair[0].request.admission_ticket.fifo_sequence
                < pair[1].request.admission_ticket.fifo_sequence
        }));
        assert!(pending.iter().all(|candidate| {
            candidate.request.approval.approved_at_ms > 0
                && candidate.request.admission_ticket.rebase_budget >= forks as u64
        }));
        drop(canonical);

        let mut completed_fifo = Vec::new();
        let mut rebase_ordinal = 0;
        let mut cycle = 0;
        while !pending.is_empty() {
            let expected_head_fifo = pending[0].request.admission_ticket.fifo_sequence;
            if cycle > 0 {
                let mut conn = Connection::open(&canonical_path).expect("loss-loop connection");
                let ticket = pending[0].request.admission_ticket.clone();
                loop {
                    let state = promotion_admission_state(&conn, &ticket).expect("loss state");
                    if state.losses >= ticket.contention_policy.reservation_after_losses {
                        break;
                    }
                    let candidate = pending.remove(0);
                    rebase_ordinal += 1;
                    let candidate = rebase_fair_candidate(
                        &mut conn,
                        &key,
                        candidate,
                        rebase_ordinal,
                        4_000 + rebase_ordinal as i64 * 10,
                    );
                    ordinary_canonical_write(
                        &canonical_path,
                        20_000 + rebase_ordinal as i64,
                        4_005 + rebase_ordinal as i64 * 10,
                    )
                    .expect("ordinary writer wins one declared loss cycle");
                    let refusal = promote_by_reexecution(
                        &mut conn,
                        &candidate.workspace,
                        &candidate.diff,
                        &candidate.request,
                        &key,
                        &PromotionAuthorityDecisionV1::Revalidated {
                            grant_id: "grant-1".to_owned(),
                            authority_fingerprint: sha('d'),
                        },
                        4_006 + rebase_ordinal as i64 * 10,
                        &sha('f'),
                        |_, _| panic!("advanced-head loss refuses before replay"),
                    )
                    .expect_err("ordinary head advance is one deterministic loss");
                    assert_eq!(refusal.diagnostic.code, "SNAPBACK_PROMOTION_BASE_ADVANCED");
                    pending.insert(0, candidate);
                }
                let candidate = pending.remove(0);
                rebase_ordinal += 1;
                let candidate = rebase_fair_candidate(
                    &mut conn,
                    &key,
                    candidate,
                    rebase_ordinal,
                    5_000 + rebase_ordinal as i64 * 10,
                );
                pending.insert(0, candidate);
            }

            let (next_pending, committed, refusals) = concurrent_fairness_cycle(
                &canonical_path,
                &key,
                pending,
                cycle,
                6_000 + cycle as i64 * 100,
            );
            assert_eq!(
                committed.len(),
                1,
                "one and only one reviewed fork commits in each admission cycle"
            );
            assert_eq!(
                committed[0].receipt.aggregate_identity.key.operation_id,
                committed[0].aggregate_envelope.identity.key.operation_id
            );
            assert!(refusals.iter().all(|code| {
                code == "SNAPBACK_PROMOTION_NOT_FIFO_HEAD"
                    || code == "SNAPBACK_PROMOTION_BASE_ADVANCED"
            }));
            completed_fifo.push(expected_head_fifo);

            let reopened = Connection::open(&canonical_path).expect("cycle reopen");
            let (state, reservation_loss_floor): (String, i64) = reopened
                .query_row(
                    "SELECT state,reservation_loss_floor
                       FROM _snapback_promotion_admission WHERE fifo_sequence=?1",
                    params![expected_head_fifo as i64],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .expect("completed cycle admission row");
            assert_eq!(state, "completed");
            if cycle > 0 {
                assert!(
                    reservation_loss_floor >= 2,
                    "the FIFO head automatically consumed its bounded reservation after R losses"
                );
            }
            pending = next_pending;
            cycle += 1;
            assert!(
                cycle <= forks,
                "all-k progress is bounded by k success cycles"
            );
        }
        assert_eq!(completed_fifo, (1..=forks as u64).collect::<Vec<_>>());
        let reopened = Connection::open(&canonical_path).expect("final reopen");
        assert_eq!(
            reopened
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_promotion_admission WHERE state='completed'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("completed queue"),
            forks as i64
        );
        assert_eq!(
            canonical_mutation_admission(&reopened, "canonical", 99_999)
                .expect("all completed tickets release ordinary writers"),
            CanonicalAdmissionV1::Admit
        );
    }

    #[test]
    fn concurrent_reviewed_forks_make_bounded_fifo_progress_with_ordinary_writers() {
        for forks in 2..=4 {
            assert_concurrent_reviewed_forks_make_bounded_fifo_progress(forks);
        }
    }

    #[test]
    fn expired_tickets_do_not_block_fifo_service_or_inflate_new_queue_position() {
        let mut canonical = source(1);
        let first = issue_promotion_ticket(
            &mut canonical,
            host_identity("canonical", "expired-fifo-first", "app-1"),
            &BranchId("expired-fifo-first".to_owned()),
            "canonical",
            2,
            3_000,
            2_000,
            PromotionContentionPolicyV1::default(),
        )
        .expect("short-lived head");
        let second = issue_promotion_ticket(
            &mut canonical,
            host_identity("canonical", "live-fifo-second", "app-1"),
            &BranchId("live-fifo-second".to_owned()),
            "canonical",
            2,
            20_000,
            2_000,
            PromotionContentionPolicyV1::default(),
        )
        .expect("live second ticket");
        for _ in 0..PRODUCTION_PROMOTION_CONTENTION_POLICY_V1.reservation_after_losses {
            note_ticket_loss(&canonical, &first).expect("record first loss");
            note_ticket_loss(&canonical, &second).expect("record second loss");
        }
        assert_eq!(
            request_head_reservation(&canonical, &first, 2_750)
                .expect("near-expiry head receives only its remaining lifetime"),
            3_000
        );
        assert_eq!(
            canonical_mutation_admission(&canonical, "canonical", 2_999)
                .expect("reservation remains live before ticket expiry"),
            CanonicalAdmissionV1::DeferredByPromotionReservation { until_ms: 3_000 }
        );
        assert_eq!(
            canonical_mutation_admission(&canonical, "canonical", 3_000)
                .expect("reservation authority ends exactly with the ticket"),
            CanonicalAdmissionV1::Admit
        );
        assert_eq!(
            request_head_reservation(&canonical, &first, 3_000)
                .expect_err("expired ticket has no reservation authority")
                .diagnostic
                .code,
            "SNAPBACK_PROMOTION_TICKET_EXPIRED"
        );
        assert_eq!(
            request_head_reservation(&canonical, &second, 3_000)
                .expect("next live ticket becomes FIFO head"),
            4_000
        );

        let third = issue_promotion_ticket(
            &mut canonical,
            host_identity("canonical", "live-fifo-third", "app-1"),
            &BranchId("live-fifo-third".to_owned()),
            "canonical",
            2,
            20_000,
            3_001,
            PromotionContentionPolicyV1::default(),
        )
        .expect("new ticket ignores expired queue entries");
        assert_eq!(third.initial_queue_position, 2);
    }

    #[test]
    fn rebase_reexecutes_into_fresh_branch_and_reseals_only_equal_facts() {
        let (mut canonical, workspace, diff) = branch_with_rename();
        let key = PromotionSealKey::from_server_secret([10_u8; 32]).expect("key");
        let ticket_identity = host_identity("canonical", "ticket-rebase", "app-1");
        let ticket = issue_promotion_ticket(
            &mut canonical,
            ticket_identity.clone(),
            &diff.branch_id,
            "canonical",
            2,
            80_000,
            2_000,
            PromotionContentionPolicyV1 {
                reservation_after_losses: 2,
                reservation_interval_ms: 1_000,
                reservation_quota: 1,
                maximum_commit_duration_ms: 500,
            },
        )
        .expect("ticket");
        let prior = seal_promotion_request(
            &workspace,
            &diff,
            PromotionApprovalV1 {
                approver_principal_id: "agent-1".to_owned(),
                approver_grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
                approved_at_ms: 2_001,
                expires_at_ms: 70_000,
            },
            ticket,
            ticket_identity,
            &sha('f'),
            &key,
            2_001,
        )
        .expect("seal");
        canonical
            .execute("UPDATE _snapback_version SET version=6 WHERE id=1", [])
            .expect("advance unrelated head");

        for divergent_fact in ["read", "result"] {
            let branch_id = format!("branch-rebased-{divergent_fact}-divergent");
            let child_stream = format!("child-rebased-{divergent_fact}-divergent");
            let divergent_create = create_request(&branch_id, &child_stream, 6, 2_500);
            let (divergent_workspace, divergent_replay) = rebase_by_replay(
                &mut canonical,
                &workspace,
                &diff.branch_id,
                &divergent_create,
                2_501,
                |tx, operation| {
                    let id = operation.canonical_arguments["id"].as_i64().expect("id");
                    let name = operation.canonical_arguments["name"]
                        .as_str()
                        .expect("name");
                    tx.execute("UPDATE widgets SET name=?2 WHERE id=?1", params![id, name])?;
                    let mut replayed = facts(name);
                    match divergent_fact {
                        "read" => replayed.read_facts = json!({ "widgets/1": "changed-read" }),
                        "result" => replayed.result = json!({ "ok": true, "changed": true }),
                        _ => unreachable!(),
                    }
                    Ok(replayed)
                },
            )
            .expect("divergent rebase executes identical write");
            assert!(!divergent_replay.meaning_preserved);
            assert_eq!(divergent_replay.divergent_operation_ids.len(), 1);
            let divergent_diff = exact_fork_diff(
                &divergent_workspace,
                &divergent_create.branch_id,
                scan_widgets,
            )
            .expect("divergent diff");
            assert_eq!(
                reseal_after_rebase(
                    &prior,
                    &divergent_workspace,
                    &divergent_diff,
                    "promotion-engine-1",
                    &sha('f'),
                    &key,
                    2_502,
                )
                .expect_err("identical writes cannot mask divergent approved facts")
                .diagnostic
                .code,
                "SNAPBACK_PROMOTION_REBASE_DIVERGED",
                "{divergent_fact} divergence"
            );
        }

        let rebased_create = create_request("branch-rebased", "child-rebased", 6, 3_000);
        let (rebased, replay) = rebase_by_replay(
            &mut canonical,
            &workspace,
            &diff.branch_id,
            &rebased_create,
            3_001,
            |tx, operation| {
                let id = operation.canonical_arguments["id"].as_i64().expect("id");
                let name = operation.canonical_arguments["name"]
                    .as_str()
                    .expect("name");
                tx.execute("UPDATE widgets SET name=?2 WHERE id=?1", params![id, name])?;
                Ok(facts(name))
            },
        )
        .expect("rebase");
        assert!(replay.meaning_preserved);
        let rebased_diff = exact_fork_diff(&rebased, &rebased_create.branch_id, scan_widgets)
            .expect("rebased diff");
        assert_eq!(
            reseal_after_rebase(
                &prior,
                &rebased,
                &rebased_diff,
                "promotion-engine-1",
                &sha('0'),
                &key,
                3_002,
            )
            .expect_err("schema identity change requires fresh approval")
            .diagnostic
            .code,
            "SNAPBACK_PROMOTION_REBASE_DIVERGED"
        );
        let resealed = reseal_after_rebase(
            &prior,
            &rebased,
            &rebased_diff,
            "promotion-engine-1",
            &sha('f'),
            &key,
            3_002,
        )
        .expect("engine reseal");
        assert_eq!(resealed.aggregate_identity, prior.aggregate_identity);
        assert_eq!(resealed.approval, prior.approval);
        assert!(resealed.rebase_attestation.is_some());
    }

    #[test]
    fn exhausted_rebase_budget_refuses_before_canonical_mutation() {
        let (mut canonical, workspace, diff) = branch_with_rename();
        let key = PromotionSealKey::from_server_secret([11_u8; 32]).expect("key");
        let ticket_identity = host_identity("canonical", "ticket-exhausted", "app-1");
        let ticket = issue_promotion_ticket(
            &mut canonical,
            ticket_identity.clone(),
            &diff.branch_id,
            "canonical",
            1,
            80_000,
            2_000,
            PromotionContentionPolicyV1::default(),
        )
        .expect("ticket");
        let request = seal_promotion_request(
            &workspace,
            &diff,
            PromotionApprovalV1 {
                approver_principal_id: "agent-1".to_owned(),
                approver_grant_id: "grant-1".to_owned(),
                authority_fingerprint: sha('d'),
                approved_at_ms: 2_001,
                expires_at_ms: 70_000,
            },
            ticket.clone(),
            ticket_identity,
            &sha('f'),
            &key,
            2_001,
        )
        .expect("seal");
        for _ in 0..ticket.rebase_budget {
            note_ticket_loss(&canonical, &ticket).expect("record bounded loss");
        }
        let before = scan_widgets(&canonical).expect("canonical before refusal");
        let before_version = crate::storage::current_version_on(&canonical).expect("version");
        assert_eq!(
            promote_by_reexecution(
                &mut canonical,
                &workspace,
                &diff,
                &request,
                &key,
                &PromotionAuthorityDecisionV1::Revalidated {
                    grant_id: "grant-1".to_owned(),
                    authority_fingerprint: sha('d'),
                },
                2_002,
                &sha('f'),
                |_, _| unreachable!(),
            )
            .expect_err("exhausted budget refuses")
            .diagnostic
            .code,
            "SNAPBACK_PROMOTION_CONTENTION_EXHAUSTED"
        );
        assert_eq!(
            scan_widgets(&canonical).expect("canonical after refusal"),
            before
        );
        assert_eq!(
            crate::storage::current_version_on(&canonical).expect("version"),
            before_version
        );
    }

    #[test]
    fn live_count_and_operation_bounds_refuse_before_mutation() {
        let mut canonical = source(1);
        let mut first = create_request("bounded-a", "bounded-child-a", 1, 100);
        first.limits.max_live_branches_per_principal = 1;
        create_in_app_branch(&mut canonical, &first).expect("first");
        let mut second = create_request("bounded-b", "bounded-child-b", 1, 100);
        second.limits.max_live_branches_per_principal = 1;
        let error = create_in_app_branch(&mut canonical, &second).expect_err("principal limit");
        assert_eq!(error.diagnostic.code, "SNAPBACK_BRANCH_LIVE_LIMIT_EXCEEDED");

        let mut workspace = MaterializedBase::materialize(&canonical, None).expect("workspace");
        let mut limited: InAppBranchCreateV1 = first.clone();
        limited.limits.max_operations = 1;
        let bytes = json_bytes(&limited, "limited profile").expect("profile");
        workspace
            .conn
            .execute(
                "UPDATE _snapback_in_app_branch_profiles SET profile_json=?2 WHERE branch_id=?1",
                params![first.branch_id.0, bytes],
            )
            .expect("tighten test bound");
        execute_branch_operation(
            &mut workspace.conn,
            &first.branch_id,
            &draft("bounded-child-a", "bounded-op-1"),
            101,
            |tx, _| {
                tx.execute("UPDATE widgets SET name='one' WHERE id=1", [])?;
                Ok(facts("one"))
            },
        )
        .expect("first op");
        let error = execute_branch_operation(
            &mut workspace.conn,
            &first.branch_id,
            &draft("bounded-child-a", "bounded-op-2"),
            102,
            |tx, _| {
                tx.execute("UPDATE widgets SET name='two' WHERE id=1", [])?;
                Ok(facts("two"))
            },
        )
        .expect_err("operation bound");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_BRANCH_OPERATION_LIMIT_EXCEEDED"
        );
        assert_eq!(
            scan_widgets(&workspace.conn).expect("rows")[0].row["name"],
            "one"
        );

        let mut byte_canonical = source(1);
        let mut byte_limited = create_request("byte-bounded", "byte-bounded-child", 1, 100);
        byte_limited.limits.max_retained_bytes = 1;
        create_in_app_branch(&mut byte_canonical, &byte_limited).expect("byte-limited branch");
        let mut byte_workspace =
            MaterializedBase::materialize(&byte_canonical, None).expect("byte workspace");
        let error = execute_branch_operation(
            &mut byte_workspace.conn,
            &byte_limited.branch_id,
            &draft("byte-bounded-child", "byte-bounded-operation"),
            101,
            |tx, _| {
                tx.execute("UPDATE widgets SET name='must-rollback' WHERE id=1", [])?;
                Ok(facts("must-rollback"))
            },
        )
        .expect_err("retained-byte limit refuses the operation and its writes");
        assert_eq!(error.diagnostic.code, "SNAPBACK_BRANCH_BYTE_LIMIT_EXCEEDED");
        assert_eq!(
            scan_widgets(&byte_workspace.conn).expect("rolled-back rows")[0].row["name"],
            "alpha"
        );
        assert!(
            branch_operation_log(&byte_workspace.conn, &byte_limited.branch_id)
                .expect("no retained operation")
                .is_empty()
        );
    }

    #[test]
    fn ttl_reap_leaves_canonical_head_and_data_untouched() {
        let mut canonical = source(7);
        let request = create_request("expired", "child-expired", 7, 100);
        create_in_app_branch(&mut canonical, &request).expect("branch");
        let before = scan_widgets(&canonical).expect("before");
        let receipts = reap_expired_in_app_branches(&mut canonical, 100 + 30_000).expect("reap");
        assert_eq!(receipts.len(), 1);
        assert_eq!(
            crate::storage::current_version_on(&canonical).expect("head"),
            7
        );
        assert_eq!(scan_widgets(&canonical).expect("after"), before);
        assert!(
            get_branch(&canonical, &request.branch_id)
                .expect("get")
                .is_none()
        );
    }

    #[test]
    fn committed_artifact_schemas_accept_representative_values() {
        let branch = create_request("schema", "child-schema", 1, 1);
        let values = [
            serde_json::to_value(branch).expect("branch value"),
            serde_json::to_value(draft("child-schema", "schema-op")).expect("op value"),
        ];
        let schemas = [
            serde_json::to_value(schemars::schema_for!(InAppBranchCreateV1)).expect("schema"),
            serde_json::to_value(schemars::schema_for!(BranchOperationDraftV1)).expect("schema"),
        ];
        for (value, schema) in values.into_iter().zip(schemas) {
            let validator = jsonschema::validator_for(&schema).expect("compile schema");
            assert!(validator.is_valid(&value));
        }
    }

    #[test]
    fn post_image_promotion_is_compile_disabled_and_reexecution_is_the_only_surface() {
        let legacy = include_str!("branches.rs");
        assert!(legacy.contains("#[cfg(any())]\npub(crate) fn promote<F>("));
        let replacement = include_str!("fork_promotion.rs");
        assert!(replacement.contains("pub(crate) fn promote_by_reexecution"));
        let product_source = replacement
            .split("\n#[cfg(test)]\nmod tests {")
            .next()
            .expect("product source");
        assert!(!product_source.contains("apply_write"));
        let implementation_start = product_source
            .find("pub(crate) fn promote_by_reexecution")
            .expect("promotion implementation");
        let implementation_end = product_source[implementation_start..]
            .find("pub enum CanonicalAdmissionV1")
            .map(|offset| implementation_start + offset)
            .expect("promotion implementation boundary");
        let promotion_surface = &product_source[implementation_start..implementation_end];
        assert!(promotion_surface.contains("PromotionReplayContextV1"));
        assert!(!promotion_surface.contains("scan_boundary"));
        assert!(!promotion_surface.contains("FnMut(&Transaction"));
        assert!(promotion_surface.contains("verify_promotion_journal"));
        assert!(product_source.contains("folded_approved_writes(&base_rows, &operations)"));
    }
}
