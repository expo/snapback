//! Agent-safe proof domains, bounded row history, and named checkpoints.
//!
//! The types in this module are Rust-owned wire artifacts. Presence of these
//! schemas is deliberately not a capability claim: LLP 0162's corpus and
//! performance rows still gate advertisement.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::SchemaManifest;
use crate::rqs_contract::jcs;
use rusqlite::backup::StepResult;
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use uuid::Uuid;

pub const PROMOTION_DIGEST_DOMAIN_V1: &str = "snapback:promotion-boundary:v1";
pub const CHECKPOINT_DIGEST_DOMAIN_V1: &str = "snapback:checkpoint-boundary:v1";
const BOUNDARY_DIGEST_TRAILER_V1: &str = "snapback:boundary-digest:v1:trailer";
const CHECKPOINT_REGISTRY_TABLE: &str = "_snapback_checkpoint_registry_v1";
const PROTECTED_CHECKPOINT_ERASURE_TABLE: &str = "_snapback_protected_checkpoint_erasure_v1";
const PROTECTED_RECORD_ERASURE_TABLE: &str = "_snapback_protected_record_erasure_v1";
const PROTECTED_ERASURE_GENERATION_TABLE: &str = "_snapback_protected_erasure_generation_v1";
const HISTORY_POLICY_TABLE: &str = "_snapback_history_policies_v1";
const HISTORY_POLICY_TABLE_V2: &str = "_snapback_history_policies_v2";
const RECORD_HISTORY_TABLE: &str = "_snapback_record_history_v1";
const CHECKPOINT_SENTINEL: &str = ".snapback-checkpoint-staging.v1";
const CHECKPOINT_RECEIPT_FILE: &str = "checkpoint-receipt.v1.json";
const CHECKPOINT_INTENT_FILE: &str = "checkpoint-intent.v1.json";
pub const CHECKPOINT_MAX_COPY_BYTES: u64 = 64 * 1024 * 1024 * 1024;
pub const CHECKPOINT_MAX_RETAINED_WAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;
pub const CHECKPOINT_MAX_LEASE_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const HISTORY_MAX_RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const HISTORY_MAX_VERSIONS_PER_RECORD: u64 = 1_000;
pub const HISTORY_MAX_ROWS_PER_TABLE: u64 = 100_000;
pub const HISTORY_PAGE_MAX: u32 = 1_000;

#[cfg(any(test, feature = "test-support"))]
type CheckpointSyncHook = Box<dyn FnOnce(&Path) -> SnapbackResult<()>>;

#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static CHECKPOINT_AFTER_PIN_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(None) };
    static CHECKPOINT_AFTER_INTENT_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(None) };
    static CHECKPOINT_SYNC_HOOK: std::cell::RefCell<Option<CheckpointSyncHook>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(any(test, feature = "test-support"))]
fn install_checkpoint_after_intent_hook(hook: impl FnOnce() + 'static) {
    CHECKPOINT_AFTER_INTENT_HOOK.with(|slot| {
        assert!(
            slot.borrow().is_none(),
            "checkpoint intent hook is one-shot"
        );
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

fn run_checkpoint_after_intent_hook() {
    #[cfg(any(test, feature = "test-support"))]
    CHECKPOINT_AFTER_INTENT_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

#[cfg(any(test, feature = "test-support"))]
fn install_checkpoint_after_pin_hook(hook: impl FnOnce() + 'static) {
    CHECKPOINT_AFTER_PIN_HOOK.with(|slot| {
        assert!(slot.borrow().is_none(), "checkpoint pin hook is one-shot");
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

fn run_checkpoint_after_pin_hook() {
    #[cfg(any(test, feature = "test-support"))]
    CHECKPOINT_AFTER_PIN_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

#[cfg(any(test, feature = "test-support"))]
fn install_checkpoint_sync_hook(hook: impl FnOnce(&Path) -> SnapbackResult<()> + 'static) {
    CHECKPOINT_SYNC_HOOK.with(|slot| {
        assert!(slot.borrow().is_none(), "checkpoint sync hook is one-shot");
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

fn run_checkpoint_sync_hook(path: &Path) -> SnapbackResult<()> {
    #[cfg(not(any(test, feature = "test-support")))]
    let _ = path;
    #[cfg(any(test, feature = "test-support"))]
    CHECKPOINT_SYNC_HOOK.with(|slot| -> SnapbackResult<()> {
        if let Some(hook) = slot.borrow_mut().take() {
            hook(path)?;
        }
        Ok(())
    })?;
    Ok(())
}

fn proof_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "proofCheckpoint", message)
}

fn canonical(value: &Value) -> SnapbackResult<String> {
    jcs(value).map_err(|_| {
        proof_error(
            "SNAPBACK_PROOF_CANONICAL_VALUE_REFUSED",
            "a proof preimage contains a non-canonical numeric value",
        )
    })
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

fn frame(hash: &mut Sha256, bytes: &[u8]) {
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ProofClassV1 {
    Inventory,
    VerifiedCopyFidelity,
    IndependentBoundaryProof,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum BoundaryDomainV1 {
    Promotion,
    Checkpoint,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotionDigestHeaderV1 {
    pub algorithm_version: u32,
    pub promotion_identity: String,
    pub parent_stream_id: String,
    pub child_stream_id: String,
    pub base_version: u64,
    pub reviewed_head_version: u64,
    pub schema_hash: String,
    pub coverage_manifest_digest: String,
    pub operation_log_digest: String,
    pub approved_facts_digest: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckpointDigestHeaderV1 {
    pub algorithm_version: u32,
    pub checkpoint_id: String,
    pub source_stream_id: String,
    pub source_version: u64,
    pub schema_hash: String,
    pub coverage_manifest_digest: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoundaryRowV1 {
    pub qualified_table: String,
    pub row_id: String,
    pub value: Value,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PromotionWriteKindV1 {
    Insert,
    Update,
    Delete,
}

/// One normalized final write fact approved for promotion. Multiple writes to
/// one row are folded before this boundary; absence/presence preconditions are
/// then checked while deriving the expected state from the immutable base.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotionApprovedWriteV1 {
    pub qualified_table: String,
    pub row_id: String,
    pub kind: PromotionWriteKindV1,
    pub post_image: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoundaryDigestV1 {
    pub domain: BoundaryDomainV1,
    pub header_digest: String,
    pub content_digest: String,
    pub rows: u64,
    pub canonical_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoundaryProofV1 {
    pub proof_class: ProofClassV1,
    pub expected: BoundaryDigestV1,
    pub actual: BoundaryDigestV1,
    pub matches: bool,
    pub derivation: String,
}

impl BoundaryProofV1 {
    /// Construct a proof only when the expected side has an independent
    /// derivation. Inventory and copy fidelity have their own carriers and
    /// cannot be projected upward by relabeling a pair of equal digests.
    ///
    /// @ref LLP 0165#contract-summary-normative-details-per-llp-0162-4-6 —
    /// digest equality without predecessor-derived expectation is inventory.
    pub fn independent(
        expected: BoundaryDigestV1,
        actual: BoundaryDigestV1,
        derivation: impl Into<String>,
    ) -> SnapbackResult<Self> {
        if expected.domain != actual.domain {
            return Err(proof_error(
                "SNAPBACK_PROOF_DOMAIN_MISMATCH",
                "expected and actual digests belong to different boundary domains",
            ));
        }
        let derivation = derivation.into();
        if derivation.trim().is_empty() {
            return Err(proof_error(
                "SNAPBACK_PROOF_EXPECTED_DERIVATION_MISSING",
                "independent proof requires a named expected-value derivation",
            ));
        }
        let matches = expected == actual;
        Ok(Self {
            proof_class: ProofClassV1::IndependentBoundaryProof,
            expected,
            actual,
            matches,
            derivation,
        })
    }
}

fn boundary_digest(
    domain: BoundaryDomainV1,
    domain_tag: &str,
    header: &Value,
    rows: &[BoundaryRowV1],
) -> SnapbackResult<BoundaryDigestV1> {
    let header_bytes = canonical(header)?;
    let header_digest = format!("sha256:{}", hex(&Sha256::digest(header_bytes.as_bytes())));
    let mut hash = Sha256::new();
    frame(&mut hash, domain_tag.as_bytes());
    frame(&mut hash, header_bytes.as_bytes());
    let mut prior: Option<(&str, &str)> = None;
    let mut canonical_bytes = 0_u64;
    for row in rows {
        let key = (row.qualified_table.as_str(), row.row_id.as_str());
        if prior.is_some_and(|previous| previous >= key) {
            return Err(proof_error(
                "SNAPBACK_PROOF_ROWS_NOT_CANONICAL",
                "boundary rows must be unique and sorted by table then row id",
            ));
        }
        prior = Some(key);
        let row_bytes = canonical(&json!({
            "qualifiedTable": row.qualified_table,
            "rowId": row.row_id,
            "value": row.value,
        }))?;
        canonical_bytes = canonical_bytes
            .checked_add(row_bytes.len() as u64)
            .ok_or_else(|| {
                proof_error(
                    "SNAPBACK_PROOF_BUDGET_EXCEEDED",
                    "proof byte count overflowed",
                )
            })?;
        frame(&mut hash, row_bytes.as_bytes());
    }
    frame(&mut hash, BOUNDARY_DIGEST_TRAILER_V1.as_bytes());
    frame(&mut hash, &(rows.len() as u64).to_be_bytes());
    Ok(BoundaryDigestV1 {
        domain,
        header_digest,
        content_digest: format!("cdv1:{}", hex(&hash.finalize())),
        rows: rows.len() as u64,
        canonical_bytes,
    })
}

pub fn promotion_boundary_digest(
    header: &PromotionDigestHeaderV1,
    rows: &[BoundaryRowV1],
) -> SnapbackResult<BoundaryDigestV1> {
    boundary_digest(
        BoundaryDomainV1::Promotion,
        PROMOTION_DIGEST_DOMAIN_V1,
        &serde_json::to_value(header).expect("promotion header serializes"),
        rows,
    )
}

/// Independently derive the promotion boundary's expected state by applying
/// the normalized approved write facts to the immutable base. Re-execution's
/// staged scan is the actual side and must not call this function.
pub fn derive_promotion_expected_digest(
    header: &PromotionDigestHeaderV1,
    base_rows: &[BoundaryRowV1],
    approved_writes: &[PromotionApprovedWriteV1],
) -> SnapbackResult<BoundaryDigestV1> {
    // Validate the base through the domain function before constructing a map;
    // otherwise duplicate input keys could be silently overwritten.
    let _ = promotion_boundary_digest(header, base_rows)?;
    let mut expected = base_rows
        .iter()
        .cloned()
        .map(|row| ((row.qualified_table.clone(), row.row_id.clone()), row))
        .collect::<BTreeMap<_, _>>();
    let mut prior: Option<(&str, &str)> = None;
    for write in approved_writes {
        let key = (write.qualified_table.as_str(), write.row_id.as_str());
        if prior.is_some_and(|previous| previous >= key) {
            return Err(proof_error(
                "SNAPBACK_PROMOTION_WRITES_NOT_CANONICAL",
                "approved writes must be unique and sorted by table then row id",
            ));
        }
        prior = Some(key);
        let owned_key = (write.qualified_table.clone(), write.row_id.clone());
        match write.kind {
            PromotionWriteKindV1::Insert => {
                let post_image = write.post_image.clone().ok_or_else(|| {
                    proof_error(
                        "SNAPBACK_PROMOTION_APPROVED_FACTS_INVALID",
                        "an approved insert requires a post-image",
                    )
                })?;
                if expected.contains_key(&owned_key) {
                    return Err(proof_error(
                        "SNAPBACK_PROMOTION_BASE_PRECONDITION_FAILED",
                        "an approved insert targets a row already present in the base",
                    ));
                }
                expected.insert(
                    owned_key,
                    BoundaryRowV1 {
                        qualified_table: write.qualified_table.clone(),
                        row_id: write.row_id.clone(),
                        value: post_image,
                    },
                );
            }
            PromotionWriteKindV1::Update => {
                let post_image = write.post_image.clone().ok_or_else(|| {
                    proof_error(
                        "SNAPBACK_PROMOTION_APPROVED_FACTS_INVALID",
                        "an approved update requires a post-image",
                    )
                })?;
                if !expected.contains_key(&owned_key) {
                    return Err(proof_error(
                        "SNAPBACK_PROMOTION_BASE_PRECONDITION_FAILED",
                        "an approved update targets a row absent from the base",
                    ));
                }
                expected.insert(
                    owned_key,
                    BoundaryRowV1 {
                        qualified_table: write.qualified_table.clone(),
                        row_id: write.row_id.clone(),
                        value: post_image,
                    },
                );
            }
            PromotionWriteKindV1::Delete => {
                if write.post_image.is_some() {
                    return Err(proof_error(
                        "SNAPBACK_PROMOTION_APPROVED_FACTS_INVALID",
                        "an approved delete must not carry a post-image",
                    ));
                }
                if expected.remove(&owned_key).is_none() {
                    return Err(proof_error(
                        "SNAPBACK_PROMOTION_BASE_PRECONDITION_FAILED",
                        "an approved delete targets a row absent from the base",
                    ));
                }
            }
        }
    }
    promotion_boundary_digest(header, &expected.into_values().collect::<Vec<_>>())
}

pub fn checkpoint_boundary_digest(
    header: &CheckpointDigestHeaderV1,
    rows: &[BoundaryRowV1],
) -> SnapbackResult<BoundaryDigestV1> {
    boundary_digest(
        BoundaryDomainV1::Checkpoint,
        CHECKPOINT_DIGEST_DOMAIN_V1,
        &serde_json::to_value(header).expect("checkpoint header serializes"),
        rows,
    )
}

/// Generated alongside schemas and drift-tested before any promotion caller
/// is wired. The concrete digests are implementation outputs over fully
/// committed preimages, not prose examples.
pub fn boundary_digest_golden_artifact() -> Value {
    let rows = vec![
        BoundaryRowV1 {
            qualified_table: "app.todos".to_owned(),
            row_id: "a".to_owned(),
            value: json!({"_id":"a","done":false,"title":"alpha"}),
        },
        BoundaryRowV1 {
            qualified_table: "app.todos".to_owned(),
            row_id: "b".to_owned(),
            value: json!({"_id":"b","done":true,"title":"beta"}),
        },
    ];
    let promotion_base_rows = vec![BoundaryRowV1 {
        qualified_table: "app.todos".to_owned(),
        row_id: "a".to_owned(),
        value: json!({"_id":"a","done":true,"title":"alpha"}),
    }];
    let promotion_approved_writes = vec![
        PromotionApprovedWriteV1 {
            qualified_table: "app.todos".to_owned(),
            row_id: "a".to_owned(),
            kind: PromotionWriteKindV1::Update,
            post_image: Some(rows[0].value.clone()),
        },
        PromotionApprovedWriteV1 {
            qualified_table: "app.todos".to_owned(),
            row_id: "b".to_owned(),
            kind: PromotionWriteKindV1::Insert,
            post_image: Some(rows[1].value.clone()),
        },
    ];
    let promotion = PromotionDigestHeaderV1 {
        algorithm_version: 1,
        promotion_identity: "operation-v1:promotion-fixture".to_owned(),
        parent_stream_id: "stream:parent".to_owned(),
        child_stream_id: "stream:child".to_owned(),
        base_version: 40,
        reviewed_head_version: 43,
        schema_hash: "sha256:schema".to_owned(),
        coverage_manifest_digest: "sha256:coverage".to_owned(),
        operation_log_digest: "sha256:operation-log".to_owned(),
        approved_facts_digest: "sha256:approved-facts".to_owned(),
    };
    let checkpoint = CheckpointDigestHeaderV1 {
        algorithm_version: 1,
        checkpoint_id: "checkpoint-v1:fixture".to_owned(),
        source_stream_id: "stream:parent".to_owned(),
        source_version: 43,
        schema_hash: "sha256:schema".to_owned(),
        coverage_manifest_digest: "sha256:coverage".to_owned(),
    };
    let promotion_expected_digest = derive_promotion_expected_digest(
        &promotion,
        &promotion_base_rows,
        &promotion_approved_writes,
    )
    .expect("golden promotion expected digest");
    let promotion_actual_digest =
        promotion_boundary_digest(&promotion, &rows).expect("golden promotion actual digest");
    assert_eq!(promotion_expected_digest, promotion_actual_digest);
    let checkpoint_digest =
        checkpoint_boundary_digest(&checkpoint, &rows).expect("golden checkpoint digest");
    json!({
        "version": "boundary-digest-golden-v1",
        "authority": "llp/0165-proof-domains-and-checkpoints.spec.md#contract-summary-normative-details-per-llp-0162-4-6",
        "ordering": "unique rows sorted by (qualifiedTable,rowId); RFC 8785 row and header values",
        "frameRule": "every frame is u64-be(length) || bytes; trailer binds row count",
        "vectors": [
            {
                "name": "promotion-two-row",
                "domain": PROMOTION_DIGEST_DOMAIN_V1,
                "header": promotion,
                "baseRows": promotion_base_rows,
                "approvedWrites": promotion_approved_writes,
                "actualRows": rows,
                "expectedDigest": promotion_expected_digest,
                "actualDigest": promotion_actual_digest,
            },
            {
                "name": "checkpoint-two-row",
                "domain": CHECKPOINT_DIGEST_DOMAIN_V1,
                "header": checkpoint,
                "rows": rows,
                "sourceDigest": checkpoint_digest,
                "copiedDigest": checkpoint_digest,
            }
        ]
    })
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CheckpointSubstrateV1 {
    Materialized,
    ReceiptOnly,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CheckpointRegistryStateV1 {
    Intent,
    Published,
    Invalid,
    Erased,
    Aborted,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CheckpointCopyDispositionV1 {
    Reachable,
    Destroyed,
    InvalidUnreachable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NamedCheckpointRequestV1 {
    pub label: String,
    pub operation_id: String,
    pub owner: String,
    pub location_class: String,
    pub substrate: CheckpointSubstrateV1,
    pub coverage_manifest_digest: String,
    pub now_ms: u64,
    pub lease_expires_at_ms: u64,
    pub max_copy_bytes: u64,
    pub max_retained_wal_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CheckpointRecoveryIntentV1 {
    format_version: u32,
    checkpoint_id: String,
    label: String,
    operation_id: String,
    owner: String,
    location_class: String,
    substrate: CheckpointSubstrateV1,
    source_stream_id: String,
    source_version: u64,
    schema_hash: String,
    coverage_manifest_digest: String,
    created_at_ms: u64,
    lease_expires_at_ms: u64,
    max_copy_bytes: u64,
    max_retained_wal_bytes: u64,
    protected_erasure_generation: u64,
    destination: Option<String>,
    database_file_name: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NamedCheckpointReceiptV1 {
    pub format_version: u32,
    pub checkpoint_id: String,
    pub label: String,
    pub operation_id: String,
    pub owner: String,
    pub location_class: String,
    pub substrate: CheckpointSubstrateV1,
    pub source_stream_id: String,
    pub source_version: u64,
    pub schema_hash: String,
    pub coverage_manifest_digest: String,
    pub proof_class: ProofClassV1,
    pub source_digest: BoundaryDigestV1,
    pub copied_digest: Option<BoundaryDigestV1>,
    pub copy_disposition: Option<CheckpointCopyDispositionV1>,
    pub created_at_ms: u64,
    pub lease_expires_at_ms: u64,
    pub copied_bytes: u64,
    pub peak_retained_wal_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckpointRegistryRecordV1 {
    pub state: CheckpointRegistryStateV1,
    pub receipt: NamedCheckpointReceiptV1,
    pub destination: Option<String>,
    pub staging: Option<String>,
    pub updated_at_ms: u64,
    pub open_erasure_obligation: bool,
    /// True from durable intent admission until publication, ordinary abort,
    /// or a stale-generation producer's durable cleanup acknowledgement.
    #[serde(default)]
    pub producer_active: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ProtectedCheckpointErasureStateV1 {
    OpenObligations,
    Complete,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtectedCheckpointCopyErasureV1 {
    pub checkpoint_id: String,
    pub owner: String,
    pub location_class: String,
    pub disposition: CheckpointCopyDispositionV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtectedRecordCheckpointErasureReceiptV1 {
    pub format_version: u32,
    pub erasure_id: String,
    pub operation_id: String,
    pub qualified_table: String,
    pub row_id: String,
    pub state: ProtectedCheckpointErasureStateV1,
    pub copies: Vec<ProtectedCheckpointCopyErasureV1>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

/// Authenticated authority prepared by a product dispatcher. Its fields are
/// intentionally private: callers outside the crate cannot mint an erasure
/// authority by filling a public request structure.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtectedRecordErasureAuthorityV1 {
    database_identity: std::sync::Arc<()>,
    principal_id: String,
    authority_instance_id: String,
    authority_fingerprint: String,
}

impl ProtectedRecordErasureAuthorityV1 {
    /// Construct the storage carrier from facts admitted by the higher-layer
    /// protected-erasure policy. No wire DTO can deserialize this type.
    #[allow(clippy::too_many_arguments)]
    fn from_admitted_facts(
        database_identity: std::sync::Arc<()>,
        mode: &str,
        principal_id: &str,
        audit_class: &str,
        profile: &str,
        transition_generation: u64,
        credential_class: &str,
        credential_digest_sha256: &str,
        authorization_stream_incarnation: &str,
    ) -> SnapbackResult<Self> {
        let authority_instance_id = format!(
            "protected-erasure-admin-v1:{mode}:{profile}:{}:{}:{}:{}",
            transition_generation,
            credential_class,
            credential_digest_sha256,
            authorization_stream_incarnation,
        );
        let fingerprint_preimage = json!({
            "domain": "snapback:protected-erasure-authority:v1",
            "principalId": principal_id,
            "authorityInstanceId": authority_instance_id,
            "mode": mode,
            "profile": profile,
            "transitionGeneration": transition_generation,
            "auditClass": audit_class,
            "credentialClass": credential_class,
            "credentialDigestSha256": credential_digest_sha256,
            "authorizationStreamIncarnation": authorization_stream_incarnation,
        });
        let authority_fingerprint = format!(
            "sha256:{}",
            hex(&Sha256::digest(
                canonical(&fingerprint_preimage)?.as_bytes()
            ))
        );
        Ok(Self {
            database_identity,
            principal_id: principal_id.to_owned(),
            authority_instance_id,
            authority_fingerprint,
        })
    }

    pub fn principal_id(&self) -> &str {
        &self.principal_id
    }

    pub fn authority_instance_id(&self) -> &str {
        &self.authority_instance_id
    }

    pub fn authority_fingerprint(&self) -> &str {
        &self.authority_fingerprint
    }

    fn facts(&self) -> ProtectedRecordErasureAuthorityFactsV1 {
        ProtectedRecordErasureAuthorityFactsV1 {
            principal_id: self.principal_id.clone(),
            authority_instance_id: self.authority_instance_id.clone(),
            authority_fingerprint: self.authority_fingerprint.clone(),
        }
    }

    pub(crate) fn is_for(&self, identity: &std::sync::Arc<()>) -> bool {
        std::sync::Arc::ptr_eq(&self.database_identity, identity)
    }
}

/// Public request shape for the registered protected-record erasure route.
/// Authority and time are deliberately absent and are supplied by the server.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtectedRecordErasureWireRequestV1 {
    pub operation_id: String,
    pub qualified_table: String,
    pub row_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtectedRecordErasureAuthorityFactsV1 {
    pub principal_id: String,
    pub authority_instance_id: String,
    pub authority_fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtectedRecordErasureRequestV1 {
    pub(crate) operation_id: String,
    pub(crate) authority: ProtectedRecordErasureAuthorityV1,
    pub(crate) qualified_table: String,
    pub(crate) row_id: String,
    pub(crate) now_ms: u64,
}

impl crate::storage::KernelCommitAuthority {
    #[allow(clippy::too_many_arguments)]
    pub fn admit_protected_record_erasure(
        &self,
        operation_id: String,
        qualified_table: String,
        row_id: String,
        mode: &str,
        principal_id: &str,
        audit_class: &str,
        profile: &str,
        transition_generation: u64,
        credential_class: &str,
        credential_digest_sha256: &str,
        authorization_stream_incarnation: &str,
        now_ms: u64,
    ) -> SnapbackResult<ProtectedRecordErasureRequestV1> {
        Ok(ProtectedRecordErasureRequestV1 {
            operation_id,
            authority: ProtectedRecordErasureAuthorityV1::from_admitted_facts(
                self.identity().clone(),
                mode,
                principal_id,
                audit_class,
                profile,
                transition_generation,
                credential_class,
                credential_digest_sha256,
                authorization_stream_incarnation,
            )?,
            qualified_table,
            row_id,
            now_ms,
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ProtectedRecordErasureStateV1 {
    OpenObligations,
    Complete,
}

/// Product-level receipt for the atomic protected-record command. Unlike the
/// older checkpoint-only sweep, this binds authority and canonical deletion.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtectedRecordErasureReceiptV1 {
    pub format_version: u32,
    pub erasure_id: String,
    pub operation_id: String,
    pub authority: ProtectedRecordErasureAuthorityFactsV1,
    pub qualified_table: String,
    pub row_id: String,
    pub canonical_delete_version: u64,
    pub state: ProtectedRecordErasureStateV1,
    pub copies: Vec<ProtectedCheckpointCopyErasureV1>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtectedRecordErasureCutV1 {
    BeforeAtomicCommit,
    AfterAtomicCommit,
    AfterFirstPhysicalDestroy,
    AfterAllPhysicalDestroy,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CheckpointPublicationCut {
    AfterRegistryIntent,
    AfterSentinelSync,
    AfterCopy,
    AfterEvidenceSync,
    AfterRename,
    AfterParentSync,
    AfterRegistryFinalize,
    AfterSentinelRemoval,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryRetentionPolicyV1 {
    pub table: String,
    #[schemars(range(min = 1_u64, max = 2_592_000_000_u64))]
    pub retain_ms: u64,
    /// Legacy v1 table-wide row bound. Schema-declared per-record retention is
    /// projected into the distinct durable v2 policy table and never changes
    /// this committed `maxRows` meaning.
    #[schemars(range(min = 1, max = 100000))]
    pub max_rows: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordHistoryEntryV1 {
    pub version: u64,
    pub operation_id: Option<String>,
    pub disposition: String,
    pub post_image: Option<Value>,
    pub changed_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordHistoryHorizonV1 {
    pub earliest_retained_version: Option<u64>,
    pub predecessor_anchor_complete: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordHistoryPageV1 {
    pub entries: Vec<RecordHistoryEntryV1>,
    pub next_visible_offset: Option<u64>,
    pub horizon: RecordHistoryHorizonV1,
}

const CHECKPOINT_ERASURE_TABLES: [&str; 4] = [
    CHECKPOINT_REGISTRY_TABLE,
    PROTECTED_CHECKPOINT_ERASURE_TABLE,
    PROTECTED_RECORD_ERASURE_TABLE,
    PROTECTED_ERASURE_GENERATION_TABLE,
];

/// History is part of the ordinary mutation seam, so its tables remain eager.
/// Checkpoint and erasure authority is deliberately initialized separately at
/// the first owning operation.
///
/// @ref LLP 0162#measurement-gate — ordinary covered
/// storage does not retain unused checkpoint/erasure schema state.
pub(crate) fn create_history_infra(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS {HISTORY_POLICY_TABLE} (
           table_name TEXT PRIMARY KEY,
           retain_ms INTEGER NOT NULL CHECK(retain_ms > 0),
           max_rows INTEGER NOT NULL CHECK(max_rows > 0)
         );
         CREATE TABLE IF NOT EXISTS {HISTORY_POLICY_TABLE_V2} (
           table_name TEXT PRIMARY KEY,
           retain_ms INTEGER NOT NULL CHECK(retain_ms > 0),
           max_versions_per_record INTEGER NOT NULL CHECK(max_versions_per_record > 0)
         );
         CREATE TABLE IF NOT EXISTS {RECORD_HISTORY_TABLE} (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           version INTEGER NOT NULL,
           table_name TEXT NOT NULL,
           row_id TEXT NOT NULL,
           op TEXT NOT NULL,
           row_json TEXT,
           changed_at_ms INTEGER NOT NULL,
           operation_id TEXT
         );
         CREATE INDEX IF NOT EXISTS _snapback_record_history_v1_by_record
           ON {RECORD_HISTORY_TABLE}(table_name,row_id,version,id);
         CREATE INDEX IF NOT EXISTS _snapback_record_history_v1_by_age
           ON {RECORD_HISTORY_TABLE}(table_name,changed_at_ms,version,id);"
    ))?;
    Ok(())
}

fn checkpoint_registry_exists(conn: &Connection) -> SnapbackResult<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1",
            [CHECKPOINT_REGISTRY_TABLE],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn checkpoint_erasure_infra_complete(conn: &Connection) -> SnapbackResult<bool> {
    for table in CHECKPOINT_ERASURE_TABLES {
        if !conn
            .query_row(
                "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1",
                [table],
                |_| Ok(()),
            )
            .optional()?
            .is_some()
        {
            return Ok(false);
        }
    }
    let has_intent: bool = conn.query_row(
        &format!(
            "SELECT EXISTS(
               SELECT 1 FROM pragma_table_info('{CHECKPOINT_REGISTRY_TABLE}')
               WHERE name='intent_json'
             )"
        ),
        [],
        |row| row.get(0),
    )?;
    let has_generation: bool = conn.query_row(
        &format!(
            "SELECT EXISTS(
               SELECT 1 FROM {PROTECTED_ERASURE_GENERATION_TABLE} WHERE id=1
             )"
        ),
        [],
        |row| row.get(0),
    )?;
    Ok(has_intent && has_generation)
}

fn any_checkpoint_erasure_infra_exists(conn: &Connection) -> SnapbackResult<bool> {
    for table in CHECKPOINT_ERASURE_TABLES {
        if conn
            .query_row(
                "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1",
                [table],
                |_| Ok(()),
            )
            .optional()?
            .is_some()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Create the complete checkpoint/erasure authority family in one serialized
/// transaction. First-use races converge, and an existing partial or legacy
/// family is completed without discarding its authority records.
///
/// @ref LLP 0162#6-bounded-history-and-named-checkpoints — checkpoint and
/// erasure authority is a single fail-closed durable family.
pub(crate) fn ensure_checkpoint_erasure_infra(conn: &Connection) -> SnapbackResult<()> {
    if checkpoint_erasure_infra_complete(conn)? {
        return Ok(());
    }
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    tx.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS {CHECKPOINT_REGISTRY_TABLE} (
           checkpoint_id TEXT PRIMARY KEY,
           operation_id TEXT NOT NULL UNIQUE,
           state TEXT NOT NULL,
           record_json TEXT NOT NULL,
           intent_json TEXT,
           updated_at_ms INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS {PROTECTED_CHECKPOINT_ERASURE_TABLE} (
           erasure_id TEXT PRIMARY KEY,
           operation_id TEXT NOT NULL UNIQUE,
           qualified_table TEXT NOT NULL,
           row_id TEXT NOT NULL,
           state TEXT NOT NULL,
           receipt_json TEXT NOT NULL,
           updated_at_ms INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS {PROTECTED_RECORD_ERASURE_TABLE} (
           erasure_id TEXT PRIMARY KEY,
           operation_id TEXT NOT NULL UNIQUE,
           qualified_table TEXT NOT NULL,
           row_id TEXT NOT NULL,
           state TEXT NOT NULL,
           receipt_json TEXT NOT NULL,
           updated_at_ms INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS {PROTECTED_ERASURE_GENERATION_TABLE} (
           id INTEGER PRIMARY KEY CHECK(id = 1),
           generation INTEGER NOT NULL CHECK(generation >= 0)
         );
         INSERT INTO {PROTECTED_ERASURE_GENERATION_TABLE}(id,generation)
         VALUES(1,0) ON CONFLICT(id) DO NOTHING;"
    ))?;
    let has_intent: bool = tx.query_row(
        &format!(
            "SELECT EXISTS(
               SELECT 1 FROM pragma_table_info('{CHECKPOINT_REGISTRY_TABLE}')
               WHERE name='intent_json'
             )"
        ),
        [],
        |row| row.get(0),
    )?;
    if !has_intent {
        tx.execute(
            &format!("ALTER TABLE {CHECKPOINT_REGISTRY_TABLE} ADD COLUMN intent_json TEXT"),
            [],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Fresh ordinary stores stay free of optional checkpoint/erasure state. A
/// pre-existing family, including a partial older migration, is completed at
/// open so no retained authority can be mistaken for an empty inventory.
pub(crate) fn upgrade_checkpoint_erasure_infra_if_present(conn: &Connection) -> SnapbackResult<()> {
    if any_checkpoint_erasure_infra_exists(conn)? {
        ensure_checkpoint_erasure_infra(conn)?;
    }
    Ok(())
}

/// Mirror a covered application-row journal fact into the independently
/// retained history clock. This function is called only by storage's central
/// `record_change` seam; there is no second application writer.
///
/// @ref LLP 0162#6-bounded-history-and-named-checkpoints — history retention
/// never pins or derives from the sync-resume floor.
#[allow(clippy::too_many_arguments)]
pub(crate) fn record_history_change(
    tx: &Transaction<'_>,
    version: u64,
    table: &str,
    row_id: &str,
    op: &str,
    row_json: Option<&str>,
    changed_at_ms: u64,
    operation_id: Option<&str>,
) -> SnapbackResult<()> {
    tx.execute(
        &format!(
            "INSERT INTO {RECORD_HISTORY_TABLE}(
               version,table_name,row_id,op,row_json,changed_at_ms,operation_id
             )
             SELECT ?1,?2,?3,?4,?5,?6,?7
             WHERE EXISTS(SELECT 1 FROM {HISTORY_POLICY_TABLE} WHERE table_name=?2)
                OR EXISTS(SELECT 1 FROM {HISTORY_POLICY_TABLE_V2} WHERE table_name=?2)"
        ),
        params![
            version,
            table,
            row_id,
            op,
            row_json,
            changed_at_ms,
            operation_id
        ],
    )?;
    Ok(())
}

fn validate_history_policy(policy: &HistoryRetentionPolicyV1) -> SnapbackResult<()> {
    if policy.table.is_empty()
        || policy.retain_ms == 0
        || policy.retain_ms > HISTORY_MAX_RETENTION_MS
        || policy.max_rows == 0
        || policy.max_rows > HISTORY_MAX_ROWS_PER_TABLE
    {
        return Err(proof_error(
            "SNAPBACK_HISTORY_POLICY_INVALID",
            "history policy exceeds the finite v1 retention bounds",
        ));
    }
    Ok(())
}

pub(crate) fn configure_history_policy(
    conn: &Connection,
    schema: &SchemaManifest,
    policy: &HistoryRetentionPolicyV1,
) -> SnapbackResult<()> {
    validate_history_policy(policy)?;
    if !schema.tables.iter().any(|table| table.name == policy.table) {
        return Err(proof_error(
            "SNAPBACK_HISTORY_TABLE_UNKNOWN",
            "history can be enabled only for a declared application table",
        ));
    }
    let schema_policy_exists = conn
        .query_row(
            &format!("SELECT 1 FROM {HISTORY_POLICY_TABLE_V2} WHERE table_name=?1"),
            [&policy.table],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if schema_policy_exists {
        return Err(proof_error(
            "SNAPBACK_HISTORY_POLICY_VERSION_CONFLICT",
            "legacy maxRows policy cannot replace active schema-declared per-record history",
        ));
    }
    conn.execute(
        &format!(
            "INSERT INTO {HISTORY_POLICY_TABLE}(table_name,retain_ms,max_rows)
             VALUES(?1,?2,?3)
             ON CONFLICT(table_name) DO UPDATE SET
               retain_ms=excluded.retain_ms,max_rows=excluded.max_rows"
        ),
        params![policy.table, policy.retain_ms, policy.max_rows],
    )?;
    Ok(())
}

/// Project schema authority into the distinct durable v2 policy table inside
/// the schema publication transaction. Declaring v2 is an explicit atomic
/// upgrade from any legacy v1 table-wide policy. Removed declarations disable
/// reads/writes and erase their retained detail in that same commit.
pub(crate) fn activate_history_policies_in_tx(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
) -> SnapbackResult<()> {
    let declared = schema
        .tables
        .iter()
        .filter_map(|table| table.history.as_ref().map(|history| (table, history)))
        .collect::<Vec<_>>();
    for (table, history) in &declared {
        if table.name.is_empty()
            || history.retain_ms == 0
            || history.retain_ms > HISTORY_MAX_RETENTION_MS
            || history.max_versions_per_record == 0
            || history.max_versions_per_record > HISTORY_MAX_VERSIONS_PER_RECORD
        {
            return Err(proof_error(
                "SNAPBACK_HISTORY_POLICY_INVALID",
                "schema-declared history exceeds the finite v2 per-record bounds",
            ));
        }
        tx.execute(
            &format!("DELETE FROM {HISTORY_POLICY_TABLE} WHERE table_name=?1"),
            [&table.name],
        )?;
        tx.execute(
            &format!(
                "INSERT INTO {HISTORY_POLICY_TABLE_V2}(
                   table_name,retain_ms,max_versions_per_record
                 )
                 VALUES(?1,?2,?3)
                 ON CONFLICT(table_name) DO UPDATE SET
                   retain_ms=excluded.retain_ms,
                   max_versions_per_record=excluded.max_versions_per_record"
            ),
            params![
                table.name,
                history.retain_ms,
                history.max_versions_per_record
            ],
        )?;
    }
    let declared_names = declared
        .iter()
        .map(|(table, _)| table.name.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let mut statement = tx.prepare(&format!(
        "SELECT table_name FROM {HISTORY_POLICY_TABLE_V2} ORDER BY table_name"
    ))?;
    let existing = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    for table in existing {
        if !declared_names.contains(table.as_str()) {
            tx.execute(
                &format!("DELETE FROM {RECORD_HISTORY_TABLE} WHERE table_name=?1"),
                [&table],
            )?;
            tx.execute(
                &format!("DELETE FROM {HISTORY_POLICY_TABLE_V2} WHERE table_name=?1"),
                [&table],
            )?;
        }
    }
    Ok(())
}

pub(crate) fn prune_record_history(conn: &Connection, now_ms: u64) -> SnapbackResult<u64> {
    crate::manifest::validate_portable_timestamp_millis(now_ms)?;
    let tx = conn.unchecked_transaction()?;

    // Schema-declared v2 policy: finite age plus per-record version count.
    let mut policies = tx.prepare(&format!(
        "SELECT table_name,retain_ms,max_versions_per_record
         FROM {HISTORY_POLICY_TABLE_V2} ORDER BY table_name"
    ))?;
    let rows = policies.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, u64>(1)?,
            row.get::<_, u64>(2)?,
        ))
    })?;
    let mut total = 0_u64;
    for row in rows {
        let (table, retain_ms, max_versions_per_record) = row?;
        let age_floor = now_ms.saturating_sub(retain_ms);
        total += tx.execute(
            &format!(
                "DELETE FROM {RECORD_HISTORY_TABLE}
                 WHERE table_name=?1 AND changed_at_ms < ?2"
            ),
            params![table, age_floor],
        )? as u64;
        total += tx.execute(
            &format!(
                "DELETE FROM {RECORD_HISTORY_TABLE} AS candidate
                 WHERE candidate.table_name=?1 AND (
                   SELECT COUNT(*) FROM {RECORD_HISTORY_TABLE} AS newer
                   WHERE newer.table_name=candidate.table_name
                     AND newer.row_id=candidate.row_id
                     AND (newer.version > candidate.version OR
                          (newer.version = candidate.version AND newer.id >= candidate.id))
                 ) > ?2"
            ),
            params![table, max_versions_per_record],
        )? as u64;
    }
    drop(policies);

    // Legacy v1 policy: preserve the committed table-wide `maxRows` meaning.
    // An explicit schema v2 declaration atomically removes its v1 predecessor,
    // and this exclusion is defense in depth for stores produced by older code.
    let mut policies = tx.prepare(&format!(
        "SELECT table_name,retain_ms,max_rows FROM {HISTORY_POLICY_TABLE}
         WHERE table_name NOT IN (SELECT table_name FROM {HISTORY_POLICY_TABLE_V2})
         ORDER BY table_name"
    ))?;
    let rows = policies.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, u64>(1)?,
            row.get::<_, u64>(2)?,
        ))
    })?;
    for row in rows {
        let (table, retain_ms, max_rows) = row?;
        let age_floor = now_ms.saturating_sub(retain_ms);
        total += tx.execute(
            &format!(
                "DELETE FROM {RECORD_HISTORY_TABLE}
                 WHERE table_name=?1 AND changed_at_ms < ?2"
            ),
            params![table, age_floor],
        )? as u64;
        total += tx.execute(
            &format!(
                "DELETE FROM {RECORD_HISTORY_TABLE}
                 WHERE table_name=?1 AND id NOT IN (
                   SELECT id FROM {RECORD_HISTORY_TABLE}
                   WHERE table_name=?1 ORDER BY version DESC,id DESC LIMIT ?2
                 )"
            ),
            params![table, max_rows],
        )? as u64;
    }
    drop(policies);
    tx.commit()?;
    Ok(total)
}

/// Read history with the two-part fail-closed rule. Pagination is applied
/// after per-version authorization; `next_visible_offset` counts only visible
/// entries and therefore cannot disclose how many versions were elided.
#[allow(clippy::too_many_arguments)]
pub(crate) fn read_record_history(
    conn: &Connection,
    table: &str,
    row_id: &str,
    visible_offset: u64,
    limit: u32,
    current_value: Option<&Value>,
    authorize_current: impl FnOnce(Option<&Value>) -> bool,
    mut authorize_historical: impl FnMut(Option<&Value>) -> bool,
) -> SnapbackResult<RecordHistoryPageV1> {
    if limit == 0 || limit > HISTORY_PAGE_MAX {
        return Err(proof_error(
            "SNAPBACK_HISTORY_PAGE_INVALID",
            "history page size is outside the finite v1 bound",
        ));
    }
    let policy_exists = conn
        .query_row(
            &format!(
                "SELECT 1 WHERE
                   EXISTS(SELECT 1 FROM {HISTORY_POLICY_TABLE} WHERE table_name=?1)
                   OR EXISTS(SELECT 1 FROM {HISTORY_POLICY_TABLE_V2} WHERE table_name=?1)"
            ),
            [table],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !policy_exists {
        return Err(proof_error(
            "SNAPBACK_HISTORY_NOT_ENABLED",
            "bounded history is not enabled for this table",
        ));
    }
    if !authorize_current(current_value) {
        return Err(proof_error(
            "SNAPBACK_HISTORY_AUTHORIZATION_DENIED",
            "current record authorization denied history",
        ));
    }

    let mut statement = conn.prepare(&format!(
        "SELECT version,op,row_json,changed_at_ms,operation_id
         FROM {RECORD_HISTORY_TABLE}
         WHERE table_name=?1 AND row_id=?2 ORDER BY version,id"
    ))?;
    let rows = statement.query_map(params![table, row_id], |row| {
        Ok((
            row.get::<_, u64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, u64>(3)?,
            row.get::<_, Option<String>>(4)?,
        ))
    })?;
    let mut visible = Vec::new();
    let mut elided_before_first_visible = false;
    for row in rows {
        let (version, disposition, row_json, changed_at_ms, operation_id) = row?;
        let post_image = row_json
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(|_| {
                proof_error("SNAPBACK_HISTORY_CORRUPT", "retained post-image is invalid")
            })?;
        if authorize_historical(post_image.as_ref()) {
            visible.push(RecordHistoryEntryV1 {
                version,
                operation_id,
                disposition,
                post_image,
                changed_at_ms,
            });
        } else if visible.is_empty() {
            elided_before_first_visible = true;
        }
    }
    let start = usize::try_from(visible_offset)
        .unwrap_or(usize::MAX)
        .min(visible.len());
    let end = start.saturating_add(limit as usize).min(visible.len());
    let entries = visible[start..end].to_vec();
    let next_visible_offset = (end < visible.len()).then_some(end as u64);
    let predecessor_anchor_complete = !elided_before_first_visible
        && visible
            .first()
            .is_some_and(|entry| entry.disposition == "insert");
    let earliest_retained_version = visible.first().map(|entry| entry.version);
    Ok(RecordHistoryPageV1 {
        entries,
        next_visible_offset,
        horizon: RecordHistoryHorizonV1 {
            earliest_retained_version,
            predecessor_anchor_complete,
        },
    })
}

fn scan_rows_observed(
    conn: &Connection,
    schema: &SchemaManifest,
    mut observe: impl FnMut() -> SnapbackResult<()>,
) -> SnapbackResult<Vec<BoundaryRowV1>> {
    let mut tables = schema.tables.iter().collect::<Vec<_>>();
    tables.sort_by(|a, b| a.name.cmp(&b.name));
    let mut output = Vec::new();
    for table in tables {
        observe()?;
        let quoted = format!("\"{}\"", table.name.replace('"', "\"\""));
        let mut statement = conn.prepare(&format!("SELECT * FROM {quoted} ORDER BY _id"))?;
        let columns = statement
            .column_names()
            .iter()
            .map(|name| (*name).to_owned())
            .collect::<Vec<_>>();
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            if output.len() % 64 == 0 {
                observe()?;
            }
            let value = crate::storage::row_to_document(row, table, &columns)?;
            let row_id = value
                .get("_id")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    proof_error("SNAPBACK_CHECKPOINT_SCAN_CORRUPT", "managed row lacks _id")
                })?
                .to_owned();
            output.push(BoundaryRowV1 {
                qualified_table: format!("app.{}", table.name),
                row_id,
                value,
            });
        }
    }
    observe()?;
    Ok(output)
}

fn scan_rows(conn: &Connection, schema: &SchemaManifest) -> SnapbackResult<Vec<BoundaryRowV1>> {
    scan_rows_observed(conn, schema, || Ok(()))
}

fn checkpoint_header(
    checkpoint_id: &str,
    source_stream_id: &str,
    source_version: u64,
    schema_hash: &str,
    coverage_manifest_digest: &str,
) -> CheckpointDigestHeaderV1 {
    CheckpointDigestHeaderV1 {
        algorithm_version: 1,
        checkpoint_id: checkpoint_id.to_owned(),
        source_stream_id: source_stream_id.to_owned(),
        source_version,
        schema_hash: schema_hash.to_owned(),
        coverage_manifest_digest: coverage_manifest_digest.to_owned(),
    }
}

fn required_checkpoint_schema_hash(schema: &SchemaManifest) -> SnapbackResult<&str> {
    schema
        .schema_hash
        .as_deref()
        .filter(|hash| !hash.trim().is_empty())
        .ok_or_else(|| {
            proof_error(
                "SNAPBACK_CHECKPOINT_SCHEMA_IDENTITY_MISSING",
                "checkpoint creation requires a non-empty schema identity",
            )
        })
}

pub fn validate_checkpoint_request(request: &NamedCheckpointRequestV1) -> SnapbackResult<()> {
    crate::manifest::validate_portable_timestamp_millis(request.now_ms)?;
    crate::manifest::validate_portable_timestamp_millis(request.lease_expires_at_ms)?;
    let lease = request
        .lease_expires_at_ms
        .checked_sub(request.now_ms)
        .filter(|lease| *lease > 0 && *lease <= CHECKPOINT_MAX_LEASE_MS);
    if request.label.trim().is_empty()
        || request.operation_id.trim().is_empty()
        || request.owner.trim().is_empty()
        || request.location_class.trim().is_empty()
        || request.coverage_manifest_digest.trim().is_empty()
        || lease.is_none()
        || request.max_copy_bytes == 0
        || request.max_copy_bytes > CHECKPOINT_MAX_COPY_BYTES
        || request.max_retained_wal_bytes == 0
        || request.max_retained_wal_bytes > CHECKPOINT_MAX_RETAINED_WAL_BYTES
    {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_REQUEST_INVALID",
            "checkpoint request is missing identity or exceeds a finite v1 budget",
        ));
    }
    Ok(())
}

fn io_error(context: &'static str, error: std::io::Error) -> SnapbackError {
    proof_error(
        "SNAPBACK_CHECKPOINT_IO_FAILED",
        format!("{context}: {error}"),
    )
}

fn sync_directory(path: &Path) -> SnapbackResult<()> {
    run_checkpoint_sync_hook(path)?;
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error("sync checkpoint directory", error))
}

fn write_json_sync(path: &Path, value: &impl Serialize) -> SnapbackResult<()> {
    let bytes = serde_json::to_vec(value).map_err(|error| {
        proof_error(
            "SNAPBACK_CHECKPOINT_RECEIPT_INVALID",
            format!("checkpoint evidence could not be encoded: {error}"),
        )
    })?;
    let mut file =
        File::create(path).map_err(|error| io_error("create checkpoint evidence", error))?;
    file.write_all(&bytes)
        .map_err(|error| io_error("write checkpoint evidence", error))?;
    file.sync_all()
        .map_err(|error| io_error("sync checkpoint evidence", error))
}

fn wal_bytes(database_path: &Path) -> SnapbackResult<u64> {
    let wal = PathBuf::from(format!("{}-wal", database_path.display()));
    match fs::metadata(wal) {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(0),
        Err(error) => Err(io_error("inspect retained WAL budget", error)),
    }
}

fn maybe_cut(
    cut_at: Option<CheckpointPublicationCut>,
    point: CheckpointPublicationCut,
) -> SnapbackResult<()> {
    if cut_at == Some(point) {
        Err(proof_error(
            "SNAPBACK_CHECKPOINT_TEST_CRASH_CUT",
            format!("injected checkpoint crash after {point:?}"),
        ))
    } else {
        Ok(())
    }
}

fn registry_record(
    conn: &Connection,
    checkpoint_id: &str,
) -> SnapbackResult<Option<CheckpointRegistryRecordV1>> {
    let encoded = conn
        .query_row(
            &format!("SELECT record_json FROM {CHECKPOINT_REGISTRY_TABLE} WHERE checkpoint_id=?1"),
            [checkpoint_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    encoded
        .map(|encoded| {
            serde_json::from_str(&encoded).map_err(|_| {
                proof_error(
                    "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT",
                    "checkpoint registry record is malformed",
                )
            })
        })
        .transpose()
}

fn registry_record_by_operation(
    conn: &Connection,
    operation_id: &str,
) -> SnapbackResult<Option<CheckpointRegistryRecordV1>> {
    let encoded = conn
        .query_row(
            &format!("SELECT record_json FROM {CHECKPOINT_REGISTRY_TABLE} WHERE operation_id=?1"),
            [operation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    encoded
        .map(|encoded| {
            serde_json::from_str(&encoded).map_err(|_| {
                proof_error(
                    "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT",
                    "checkpoint registry record is malformed",
                )
            })
        })
        .transpose()
}

fn registry_intent(
    conn: &Connection,
    checkpoint_id: &str,
) -> SnapbackResult<Option<CheckpointRecoveryIntentV1>> {
    let encoded = conn
        .query_row(
            &format!("SELECT intent_json FROM {CHECKPOINT_REGISTRY_TABLE} WHERE checkpoint_id=?1"),
            [checkpoint_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    encoded
        .map(|encoded| {
            serde_json::from_str(&encoded).map_err(|_| {
                proof_error(
                    "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT",
                    "checkpoint registry intent is malformed",
                )
            })
        })
        .transpose()
}

fn save_registry_intent(
    conn: &Connection,
    intent: &CheckpointRecoveryIntentV1,
) -> SnapbackResult<()> {
    let encoded = serde_json::to_string(intent).map_err(|_| {
        proof_error(
            "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT",
            "checkpoint registry intent could not be encoded",
        )
    })?;
    let changed = conn.execute(
        &format!("UPDATE {CHECKPOINT_REGISTRY_TABLE} SET intent_json=?1 WHERE checkpoint_id=?2"),
        params![encoded, intent.checkpoint_id],
    )?;
    if changed != 1 {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT",
            "checkpoint registry intent has no owning record",
        ));
    }
    Ok(())
}

fn save_registry_record(
    conn: &Connection,
    record: &CheckpointRegistryRecordV1,
) -> SnapbackResult<()> {
    let encoded = serde_json::to_string(record).map_err(|_| {
        proof_error(
            "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT",
            "checkpoint registry record could not be encoded",
        )
    })?;
    conn.execute(
        &format!(
            "INSERT INTO {CHECKPOINT_REGISTRY_TABLE}(
               checkpoint_id,operation_id,state,record_json,updated_at_ms
             ) VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(checkpoint_id) DO UPDATE SET
               state=excluded.state,record_json=excluded.record_json,updated_at_ms=excluded.updated_at_ms"
        ),
        params![
            record.receipt.checkpoint_id,
            record.receipt.operation_id,
            serde_json::to_value(record.state).expect("state serializes").as_str().unwrap_or_default(),
            encoded,
            record.updated_at_ms
        ],
    )?;
    Ok(())
}

fn registry_records(conn: &Connection) -> SnapbackResult<Vec<CheckpointRegistryRecordV1>> {
    let mut statement = conn.prepare(&format!(
        "SELECT record_json FROM {CHECKPOINT_REGISTRY_TABLE} ORDER BY checkpoint_id"
    ))?;
    let encoded = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    encoded
        .into_iter()
        .map(|encoded| {
            serde_json::from_str(&encoded).map_err(|_| {
                proof_error(
                    "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT",
                    "checkpoint registry record is malformed",
                )
            })
        })
        .collect()
}

fn protected_erasure_by_operation(
    conn: &Connection,
    operation_id: &str,
) -> SnapbackResult<Option<ProtectedRecordCheckpointErasureReceiptV1>> {
    let encoded = conn
        .query_row(
            &format!(
                "SELECT receipt_json FROM {PROTECTED_CHECKPOINT_ERASURE_TABLE} \
                 WHERE operation_id=?1"
            ),
            [operation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    encoded
        .map(|encoded| {
            serde_json::from_str(&encoded).map_err(|_| {
                proof_error(
                    "SNAPBACK_CHECKPOINT_ERASURE_REGISTRY_CORRUPT",
                    "protected-record checkpoint erasure receipt is malformed",
                )
            })
        })
        .transpose()
}

fn save_protected_erasure(
    conn: &Connection,
    receipt: &ProtectedRecordCheckpointErasureReceiptV1,
) -> SnapbackResult<()> {
    let encoded = serde_json::to_string(receipt).map_err(|_| {
        proof_error(
            "SNAPBACK_CHECKPOINT_ERASURE_REGISTRY_CORRUPT",
            "protected-record checkpoint erasure receipt could not be encoded",
        )
    })?;
    conn.execute(
        &format!(
            "INSERT INTO {PROTECTED_CHECKPOINT_ERASURE_TABLE}(
               erasure_id,operation_id,qualified_table,row_id,state,receipt_json,updated_at_ms
             ) VALUES(?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(erasure_id) DO UPDATE SET
               state=excluded.state,receipt_json=excluded.receipt_json,
               updated_at_ms=excluded.updated_at_ms"
        ),
        params![
            receipt.erasure_id,
            receipt.operation_id,
            receipt.qualified_table,
            receipt.row_id,
            serde_json::to_value(receipt.state)
                .expect("erasure state serializes")
                .as_str()
                .unwrap_or_default(),
            encoded,
            receipt.updated_at_ms,
        ],
    )?;
    Ok(())
}

fn protected_record_erasure_by_operation(
    conn: &Connection,
    operation_id: &str,
) -> SnapbackResult<Option<ProtectedRecordErasureReceiptV1>> {
    let encoded = conn
        .query_row(
            &format!(
                "SELECT receipt_json FROM {PROTECTED_RECORD_ERASURE_TABLE} \
                 WHERE operation_id=?1"
            ),
            [operation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    encoded
        .map(|encoded| {
            serde_json::from_str(&encoded).map_err(|_| {
                proof_error(
                    "SNAPBACK_PROTECTED_ERASURE_REGISTRY_CORRUPT",
                    "protected-record erasure receipt is malformed",
                )
            })
        })
        .transpose()
}

fn save_protected_record_erasure(
    conn: &Connection,
    receipt: &ProtectedRecordErasureReceiptV1,
) -> SnapbackResult<()> {
    let encoded = serde_json::to_string(receipt).map_err(|_| {
        proof_error(
            "SNAPBACK_PROTECTED_ERASURE_REGISTRY_CORRUPT",
            "protected-record erasure receipt could not be encoded",
        )
    })?;
    conn.execute(
        &format!(
            "INSERT INTO {PROTECTED_RECORD_ERASURE_TABLE}(
               erasure_id,operation_id,qualified_table,row_id,state,receipt_json,updated_at_ms
             ) VALUES(?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(erasure_id) DO UPDATE SET
               state=excluded.state,receipt_json=excluded.receipt_json,
               updated_at_ms=excluded.updated_at_ms"
        ),
        params![
            receipt.erasure_id,
            receipt.operation_id,
            receipt.qualified_table,
            receipt.row_id,
            serde_json::to_value(receipt.state)
                .expect("erasure state serializes")
                .as_str()
                .unwrap_or_default(),
            encoded,
            receipt.updated_at_ms,
        ],
    )?;
    Ok(())
}

pub fn validate_protected_record_erasure_request(
    schema: &SchemaManifest,
    request: &ProtectedRecordErasureRequestV1,
) -> SnapbackResult<()> {
    crate::manifest::validate_portable_timestamp_millis(request.now_ms)?;
    if request.operation_id.trim().is_empty()
        || request.qualified_table.trim().is_empty()
        || request.row_id.trim().is_empty()
        || request.authority.principal_id.trim().is_empty()
        || request.authority.authority_instance_id.trim().is_empty()
        || request.authority.authority_fingerprint.trim().is_empty()
        || schema.table(&request.qualified_table).is_none()
    {
        return Err(proof_error(
            "SNAPBACK_PROTECTED_ERASURE_REQUEST_INVALID",
            "protected-record erasure requires an authenticated exact application-row target",
        ));
    }
    Ok(())
}

fn request_matches_protected_record_erasure(
    request: &ProtectedRecordErasureRequestV1,
    receipt: &ProtectedRecordErasureReceiptV1,
) -> bool {
    receipt.operation_id == request.operation_id
        && receipt.authority == request.authority.facts()
        && receipt.qualified_table == request.qualified_table
        && receipt.row_id == request.row_id
}

fn checkpoint_erasure_fence_open(conn: &Connection) -> SnapbackResult<bool> {
    Ok(conn.query_row(
        &format!(
            "SELECT EXISTS(
               SELECT 1 FROM {PROTECTED_RECORD_ERASURE_TABLE}
               WHERE state='openObligations'
             )"
        ),
        [],
        |row| row.get(0),
    )?)
}

fn refuse_checkpoint_if_erasure_fenced(conn: &Connection) -> SnapbackResult<()> {
    if checkpoint_erasure_fence_open(conn)? {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_PROTECTED_ERASURE_FENCED",
            "checkpoint admission and publication refuse while protected erasure is open",
        ));
    }
    Ok(())
}

fn open_protected_record_erasure(
    conn: &Connection,
) -> SnapbackResult<Option<ProtectedRecordErasureReceiptV1>> {
    let encoded = conn
        .query_row(
            &format!(
                "SELECT receipt_json FROM {PROTECTED_RECORD_ERASURE_TABLE}
                 WHERE state='openObligations' LIMIT 1"
            ),
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    encoded
        .map(|encoded| {
            serde_json::from_str(&encoded).map_err(|_| {
                proof_error(
                    "SNAPBACK_PROTECTED_ERASURE_REGISTRY_CORRUPT",
                    "open protected-record erasure receipt is malformed",
                )
            })
        })
        .transpose()
}

/// The admitted producer, or its explicit recovery successor after a crash,
/// owns the cancellation acknowledgement. It first destroys both exact paths
/// named by its durable intent, then atomically marks itself quiescent and
/// discharges the matching product-erasure obligation.
fn acknowledge_cancelled_checkpoint_producer(
    conn: &Connection,
    checkpoint_id: &str,
    now_ms: u64,
) -> SnapbackResult<CheckpointRegistryRecordV1> {
    let record = registry_record(conn, checkpoint_id)?.ok_or_else(|| {
        proof_error(
            "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT",
            "cancelled checkpoint producer lost its registry record",
        )
    })?;
    if record.state != CheckpointRegistryStateV1::Invalid || !record.producer_active {
        return Ok(record);
    }
    let mut paths = Vec::new();
    for path in [&record.destination, &record.staging].into_iter().flatten() {
        let path = PathBuf::from(path);
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    for path in paths {
        match fs::remove_dir_all(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(io_error(
                    "destroy stale-generation checkpoint producer bytes",
                    error,
                ));
            }
        }
    }

    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let mut record = registry_record(&tx, checkpoint_id)?.ok_or_else(|| {
        proof_error(
            "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT",
            "cancelled checkpoint producer lost its registry record",
        )
    })?;
    if record.state != CheckpointRegistryStateV1::Invalid || !record.producer_active {
        tx.commit()?;
        return Ok(record);
    }
    record.producer_active = false;
    record.state = CheckpointRegistryStateV1::Erased;
    record.open_erasure_obligation = false;
    record.receipt.copy_disposition = Some(CheckpointCopyDispositionV1::Destroyed);
    record.staging = None;
    record.updated_at_ms = now_ms;
    save_registry_record(&tx, &record)?;

    if let Some(mut receipt) = open_protected_record_erasure(&tx)? {
        let copy = receipt
            .copies
            .iter_mut()
            .find(|copy| copy.checkpoint_id == checkpoint_id)
            .ok_or_else(|| {
                proof_error(
                    "SNAPBACK_PROTECTED_ERASURE_REGISTRY_CORRUPT",
                    "producer cancellation is absent from the protected-erasure inventory",
                )
            })?;
        copy.disposition = CheckpointCopyDispositionV1::Destroyed;
        receipt.updated_at_ms = now_ms;
        if receipt
            .copies
            .iter()
            .all(|copy| copy.disposition == CheckpointCopyDispositionV1::Destroyed)
        {
            receipt.state = ProtectedRecordErasureStateV1::Complete;
        }
        save_protected_record_erasure(&tx, &receipt)?;
    }
    tx.commit()?;
    Ok(record)
}

fn ensure_checkpoint_producer_current(
    conn: &Connection,
    checkpoint_id: &str,
    expected_erasure_generation: u64,
    now_ms: u64,
) -> SnapbackResult<()> {
    let record = registry_record(conn, checkpoint_id)?.ok_or_else(|| {
        proof_error(
            "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT",
            "checkpoint producer lost its registry intent",
        )
    })?;
    if record.state == CheckpointRegistryStateV1::Intent
        && record.producer_active
        && !checkpoint_erasure_fence_open(conn)?
        && protected_erasure_generation(conn)? == expected_erasure_generation
    {
        return Ok(());
    }
    if record.state == CheckpointRegistryStateV1::Invalid && record.producer_active {
        acknowledge_cancelled_checkpoint_producer(conn, checkpoint_id, now_ms)?;
    }
    Err(proof_error(
        "SNAPBACK_CHECKPOINT_PROTECTED_ERASURE_FENCED",
        "checkpoint producer crossed a protected-erasure generation and cancelled its bytes",
    ))
}

fn protected_erasure_generation(conn: &Connection) -> SnapbackResult<u64> {
    conn.query_row(
        &format!("SELECT generation FROM {PROTECTED_ERASURE_GENERATION_TABLE} WHERE id=1"),
        [],
        |row| row.get(0),
    )
    .map_err(Into::into)
}

fn advance_protected_erasure_generation(conn: &Connection) -> SnapbackResult<()> {
    let changed = conn.execute(
        &format!(
            "UPDATE {PROTECTED_ERASURE_GENERATION_TABLE}
             SET generation=generation+1 WHERE id=1"
        ),
        [],
    )?;
    if changed != 1 {
        return Err(proof_error(
            "SNAPBACK_PROTECTED_ERASURE_REGISTRY_CORRUPT",
            "protected erasure generation authority is missing",
        ));
    }
    Ok(())
}

fn database_copy_size(conn: &Connection) -> SnapbackResult<u64> {
    let pages: u64 = conn.query_row("PRAGMA page_count", [], |row| row.get(0))?;
    let page_size: u64 = conn.query_row("PRAGMA page_size", [], |row| row.get(0))?;
    pages.checked_mul(page_size).ok_or_else(|| {
        proof_error(
            "SNAPBACK_CHECKPOINT_COPY_BUDGET_EXCEEDED",
            "database size overflowed",
        )
    })
}

fn current_source_facts(conn: &Connection) -> SnapbackResult<(String, u64)> {
    let version: u64 = conn.query_row(
        "SELECT version FROM _snapback_version WHERE id=1",
        [],
        |row| row.get(0),
    )?;
    let stream =
        crate::seed_identity::strict_current_data_version_stream(conn)?.ok_or_else(|| {
            proof_error(
                "SNAPBACK_CHECKPOINT_STREAM_MISSING",
                "source data stream is uninitialized",
            )
        })?;
    Ok((stream, version))
}

fn placeholder_receipt(
    checkpoint_id: &str,
    request: &NamedCheckpointRequestV1,
    source_stream_id: &str,
    source_version: u64,
    schema_hash: &str,
) -> NamedCheckpointReceiptV1 {
    let empty = BoundaryDigestV1 {
        domain: BoundaryDomainV1::Checkpoint,
        header_digest: String::new(),
        content_digest: String::new(),
        rows: 0,
        canonical_bytes: 0,
    };
    NamedCheckpointReceiptV1 {
        format_version: 1,
        checkpoint_id: checkpoint_id.to_owned(),
        label: request.label.clone(),
        operation_id: request.operation_id.clone(),
        owner: request.owner.clone(),
        location_class: request.location_class.clone(),
        substrate: request.substrate,
        source_stream_id: source_stream_id.to_owned(),
        source_version,
        schema_hash: schema_hash.to_owned(),
        coverage_manifest_digest: request.coverage_manifest_digest.clone(),
        proof_class: ProofClassV1::Inventory,
        source_digest: empty,
        copied_digest: None,
        copy_disposition: None,
        created_at_ms: request.now_ms,
        lease_expires_at_ms: request.lease_expires_at_ms,
        copied_bytes: 0,
        peak_retained_wal_bytes: 0,
    }
}

#[allow(
    clippy::too_many_arguments,
    reason = "the recovery receipt records independent checkpoint facts that must remain explicit"
)]
fn checkpoint_recovery_intent(
    checkpoint_id: &str,
    request: &NamedCheckpointRequestV1,
    source_stream_id: &str,
    source_version: u64,
    schema_hash: &str,
    protected_erasure_generation: u64,
    destination: Option<&Path>,
    source_database: &Path,
) -> CheckpointRecoveryIntentV1 {
    CheckpointRecoveryIntentV1 {
        format_version: 1,
        checkpoint_id: checkpoint_id.to_owned(),
        label: request.label.clone(),
        operation_id: request.operation_id.clone(),
        owner: request.owner.clone(),
        location_class: request.location_class.clone(),
        substrate: request.substrate,
        source_stream_id: source_stream_id.to_owned(),
        source_version,
        schema_hash: schema_hash.to_owned(),
        coverage_manifest_digest: request.coverage_manifest_digest.clone(),
        created_at_ms: request.now_ms,
        lease_expires_at_ms: request.lease_expires_at_ms,
        max_copy_bytes: request.max_copy_bytes,
        max_retained_wal_bytes: request.max_retained_wal_bytes,
        protected_erasure_generation,
        destination: destination.map(|path| path.to_string_lossy().into_owned()),
        database_file_name: source_database
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_owned(),
    }
}

fn checkpoint_erasure_generation_still_current(
    conn: &Connection,
    expected: u64,
) -> SnapbackResult<()> {
    if protected_erasure_generation(conn)? != expected {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_PROTECTED_ERASURE_FENCED",
            "checkpoint publication crossed a protected-erasure generation",
        ));
    }
    Ok(())
}

fn admit_checkpoint_intent(
    conn: &Connection,
    record: &CheckpointRegistryRecordV1,
    intent: &CheckpointRecoveryIntentV1,
) -> SnapbackResult<()> {
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    refuse_checkpoint_if_erasure_fenced(&tx)?;
    checkpoint_erasure_generation_still_current(&tx, intent.protected_erasure_generation)?;
    save_registry_record(&tx, record)?;
    save_registry_intent(&tx, intent)?;
    tx.commit()?;
    Ok(())
}

fn finalize_checkpoint_publication(
    conn: &Connection,
    record: &CheckpointRegistryRecordV1,
) -> SnapbackResult<()> {
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    refuse_checkpoint_if_erasure_fenced(&tx)?;
    let intent = registry_intent(&tx, &record.receipt.checkpoint_id)?.ok_or_else(|| {
        proof_error(
            "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT",
            "checkpoint publication lost its durable recovery intent",
        )
    })?;
    checkpoint_erasure_generation_still_current(&tx, intent.protected_erasure_generation)?;
    let retained = registry_record(&tx, &record.receipt.checkpoint_id)?.ok_or_else(|| {
        proof_error(
            "SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT",
            "checkpoint publication lost its durable admission intent",
        )
    })?;
    if retained.state != CheckpointRegistryStateV1::Intent
        || !retained.producer_active
        || retained.receipt.operation_id != record.receipt.operation_id
    {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_PROTECTED_ERASURE_FENCED",
            "checkpoint publication was invalidated after admission",
        ));
    }
    save_registry_record(&tx, record)?;
    tx.commit()?;
    Ok(())
}

fn publish_receipt_only_checkpoint(
    conn: &Connection,
    record: &CheckpointRegistryRecordV1,
    intent: &CheckpointRecoveryIntentV1,
) -> SnapbackResult<()> {
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    refuse_checkpoint_if_erasure_fenced(&tx)?;
    checkpoint_erasure_generation_still_current(&tx, intent.protected_erasure_generation)?;
    save_registry_record(&tx, record)?;
    save_registry_intent(&tx, intent)?;
    tx.commit()?;
    Ok(())
}

/// Create a named checkpoint under the OQ13 budget-or-refusal contract.
/// Materialized copies use one held source transaction for the independent
/// source scan and SQLite backup. The copied image is then scanned separately;
/// equality earns only `verifiedCopyFidelity`.
///
/// @ref LLP 0165#dated-oq13-spike-record--2026-08-03 — no unbudgeted pin and
/// no drifted-snapshot fallback are permitted.
fn create_named_checkpoint_inner(
    conn: &Connection,
    source_database: &Path,
    schema: &SchemaManifest,
    destination: Option<&Path>,
    request: &NamedCheckpointRequestV1,
    cut_at: Option<CheckpointPublicationCut>,
) -> SnapbackResult<NamedCheckpointReceiptV1> {
    validate_checkpoint_request(request)?;
    ensure_checkpoint_erasure_infra(conn)?;
    refuse_checkpoint_if_erasure_fenced(conn)?;
    let erasure_generation = protected_erasure_generation(conn)?;
    let schema_hash = required_checkpoint_schema_hash(schema)?;
    let (source_stream_id, source_version) = current_source_facts(conn)?;
    let checkpoint_id = format!("checkpoint-v1:{}", Uuid::now_v7());
    let header = checkpoint_header(
        &checkpoint_id,
        &source_stream_id,
        source_version,
        schema_hash,
        &request.coverage_manifest_digest,
    );

    if request.substrate == CheckpointSubstrateV1::ReceiptOnly {
        if destination.is_some() {
            return Err(proof_error(
                "SNAPBACK_CHECKPOINT_DESTINATION_INVALID",
                "receipt-only checkpoints do not retain a destination",
            ));
        }
        let source = Connection::open_with_flags(
            source_database,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        let tx = source.unchecked_transaction()?;
        let (observed_stream, observed_version) = current_source_facts(&tx)?;
        if observed_stream != source_stream_id || observed_version != source_version {
            return Err(proof_error(
                "SNAPBACK_CHECKPOINT_SOURCE_ADVANCED",
                "source advanced before the receipt-only snapshot was pinned",
            ));
        }
        if database_copy_size(&tx)? > request.max_copy_bytes {
            return Err(proof_error(
                "SNAPBACK_CHECKPOINT_DIGEST_BUDGET_EXCEEDED",
                "receipt-only checkpoint scan exceeds its declared byte budget",
            ));
        }
        let mut peak_wal = wal_bytes(source_database)?;
        if peak_wal > request.max_retained_wal_bytes {
            return Err(proof_error(
                "SNAPBACK_CHECKPOINT_WAL_BUDGET_EXCEEDED",
                "retained WAL already exceeds the checkpoint admission budget",
            ));
        }
        let rows = scan_rows_observed(&tx, schema, || {
            let observed = wal_bytes(source_database)?;
            peak_wal = peak_wal.max(observed);
            if observed > request.max_retained_wal_bytes {
                return Err(proof_error(
                    "SNAPBACK_CHECKPOINT_WAL_BUDGET_EXCEEDED",
                    "checkpoint scan reached its declared retained-WAL budget",
                ));
            }
            Ok(())
        })?;
        let digest = checkpoint_boundary_digest(&header, &rows)?;
        tx.commit()?;
        let receipt = NamedCheckpointReceiptV1 {
            source_digest: digest,
            peak_retained_wal_bytes: peak_wal,
            ..placeholder_receipt(
                &checkpoint_id,
                request,
                &source_stream_id,
                source_version,
                schema_hash,
            )
        };
        let record = CheckpointRegistryRecordV1 {
            state: CheckpointRegistryStateV1::Published,
            receipt: receipt.clone(),
            destination: None,
            staging: None,
            updated_at_ms: request.now_ms,
            open_erasure_obligation: false,
            producer_active: false,
        };
        let intent = checkpoint_recovery_intent(
            &checkpoint_id,
            request,
            &source_stream_id,
            source_version,
            schema_hash,
            erasure_generation,
            None,
            source_database,
        );
        publish_receipt_only_checkpoint(conn, &record, &intent)?;
        return Ok(receipt);
    }

    let destination = destination.ok_or_else(|| {
        proof_error(
            "SNAPBACK_CHECKPOINT_DESTINATION_INVALID",
            "materialized checkpoints require a destination",
        )
    })?;
    if destination.exists() {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_DESTINATION_EXISTS",
            "checkpoint destination already exists",
        ));
    }
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|error| io_error("create checkpoint parent", error))?;
    let destination_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            proof_error(
                "SNAPBACK_CHECKPOINT_DESTINATION_INVALID",
                "checkpoint destination needs a UTF-8 name",
            )
        })?;
    let staging = parent.join(format!(".{destination_name}.staging-{}", Uuid::now_v7()));
    let database_name = source_database
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            proof_error(
                "SNAPBACK_CHECKPOINT_SOURCE_INVALID",
                "source database needs a UTF-8 name",
            )
        })?;
    let staging_database = staging.join(database_name);
    let intent_receipt = placeholder_receipt(
        &checkpoint_id,
        request,
        &source_stream_id,
        source_version,
        schema_hash,
    );
    let intent_record = CheckpointRegistryRecordV1 {
        state: CheckpointRegistryStateV1::Intent,
        receipt: intent_receipt,
        destination: Some(destination.to_string_lossy().into_owned()),
        staging: Some(staging.to_string_lossy().into_owned()),
        updated_at_ms: request.now_ms,
        open_erasure_obligation: false,
        producer_active: true,
    };
    let recovery_intent = checkpoint_recovery_intent(
        &checkpoint_id,
        request,
        &source_stream_id,
        source_version,
        schema_hash,
        erasure_generation,
        Some(destination),
        source_database,
    );
    admit_checkpoint_intent(conn, &intent_record, &recovery_intent)?;
    maybe_cut(cut_at, CheckpointPublicationCut::AfterRegistryIntent)?;
    run_checkpoint_after_intent_hook();
    ensure_checkpoint_producer_current(conn, &checkpoint_id, erasure_generation, request.now_ms)?;
    fs::create_dir(&staging).map_err(|error| io_error("create checkpoint staging", error))?;
    File::create(staging.join(CHECKPOINT_SENTINEL))
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error("write checkpoint staging sentinel", error))?;
    sync_directory(&staging)?;
    maybe_cut(cut_at, CheckpointPublicationCut::AfterSentinelSync)?;
    ensure_checkpoint_producer_current(conn, &checkpoint_id, erasure_generation, request.now_ms)?;

    let source =
        Connection::open_with_flags(source_database, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let tx = source.unchecked_transaction()?;
    let (observed_stream, observed_version) = current_source_facts(&tx)?;
    if observed_stream != source_stream_id || observed_version != source_version {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_SOURCE_ADVANCED",
            "source advanced before the checkpoint snapshot was pinned",
        ));
    }
    run_checkpoint_after_pin_hook();
    let copy_bytes = database_copy_size(&tx)?;
    if copy_bytes > request.max_copy_bytes {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_COPY_BUDGET_EXCEEDED",
            "checkpoint copy exceeds its declared byte budget",
        ));
    }
    let initial_wal = wal_bytes(source_database)?;
    if initial_wal > request.max_retained_wal_bytes {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_WAL_BUDGET_EXCEEDED",
            "retained WAL already exceeds the checkpoint admission budget",
        ));
    }
    let mut peak_wal = initial_wal;
    let source_rows = scan_rows_observed(&tx, schema, || {
        let observed = wal_bytes(source_database)?;
        peak_wal = peak_wal.max(observed);
        if observed > request.max_retained_wal_bytes {
            return Err(proof_error(
                "SNAPBACK_CHECKPOINT_WAL_BUDGET_EXCEEDED",
                "checkpoint scan reached its declared retained-WAL budget",
            ));
        }
        Ok(())
    })?;
    let source_digest = checkpoint_boundary_digest(&header, &source_rows)?;
    let mut target = Connection::open(&staging_database)?;
    {
        let backup = rusqlite::backup::Backup::new(&tx, &mut target)?;
        loop {
            let observed = wal_bytes(source_database)?;
            peak_wal = peak_wal.max(observed);
            if observed > request.max_retained_wal_bytes {
                return Err(proof_error(
                    "SNAPBACK_CHECKPOINT_WAL_BUDGET_EXCEEDED",
                    "checkpoint pin reached its declared retained-WAL budget",
                ));
            }
            match backup.step(64)? {
                StepResult::Done => break,
                StepResult::More => {}
                StepResult::Busy | StepResult::Locked => {
                    std::thread::sleep(Duration::from_millis(1))
                }
                _ => {
                    return Err(proof_error(
                        "SNAPBACK_CHECKPOINT_COPY_FAILED",
                        "SQLite returned an unknown backup step disposition",
                    ));
                }
            }
        }
    }
    let observed = wal_bytes(source_database)?;
    peak_wal = peak_wal.max(observed);
    if observed > request.max_retained_wal_bytes {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_WAL_BUDGET_EXCEEDED",
            "checkpoint pin reached its declared retained-WAL budget",
        ));
    }
    drop(target);
    tx.commit()?;
    maybe_cut(cut_at, CheckpointPublicationCut::AfterCopy)?;
    ensure_checkpoint_producer_current(conn, &checkpoint_id, erasure_generation, request.now_ms)?;

    let copied = Connection::open_with_flags(
        &staging_database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let copied_rows = scan_rows(&copied, schema)?;
    let copied_digest = checkpoint_boundary_digest(&header, &copied_rows)?;
    if copied_digest != source_digest {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_COPY_FIDELITY_FAILED",
            "copied database does not equal the independently scanned pinned snapshot",
        ));
    }
    let receipt = NamedCheckpointReceiptV1 {
        proof_class: ProofClassV1::VerifiedCopyFidelity,
        source_digest,
        copied_digest: Some(copied_digest),
        copy_disposition: Some(CheckpointCopyDispositionV1::Reachable),
        copied_bytes: copy_bytes,
        peak_retained_wal_bytes: peak_wal,
        ..placeholder_receipt(
            &checkpoint_id,
            request,
            &source_stream_id,
            source_version,
            schema_hash,
        )
    };
    write_json_sync(&staging.join(CHECKPOINT_INTENT_FILE), &recovery_intent)?;
    write_json_sync(&staging.join(CHECKPOINT_RECEIPT_FILE), &receipt)?;
    File::open(&staging_database)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error("sync checkpoint database", error))?;
    sync_directory(&staging)?;
    maybe_cut(cut_at, CheckpointPublicationCut::AfterEvidenceSync)?;
    ensure_checkpoint_producer_current(conn, &checkpoint_id, erasure_generation, request.now_ms)?;
    fs::rename(&staging, destination)
        .map_err(|error| io_error("publish checkpoint rename", error))?;
    maybe_cut(cut_at, CheckpointPublicationCut::AfterRename)?;
    ensure_checkpoint_producer_current(conn, &checkpoint_id, erasure_generation, request.now_ms)?;
    sync_directory(parent)?;
    maybe_cut(cut_at, CheckpointPublicationCut::AfterParentSync)?;
    ensure_checkpoint_producer_current(conn, &checkpoint_id, erasure_generation, request.now_ms)?;
    let record = CheckpointRegistryRecordV1 {
        state: CheckpointRegistryStateV1::Published,
        receipt: receipt.clone(),
        destination: Some(destination.to_string_lossy().into_owned()),
        staging: None,
        updated_at_ms: request.now_ms,
        open_erasure_obligation: false,
        producer_active: false,
    };
    finalize_checkpoint_publication(conn, &record)?;
    maybe_cut(cut_at, CheckpointPublicationCut::AfterRegistryFinalize)?;
    fs::remove_file(destination.join(CHECKPOINT_SENTINEL))
        .map_err(|error| io_error("remove checkpoint staging sentinel", error))?;
    maybe_cut(cut_at, CheckpointPublicationCut::AfterSentinelRemoval)?;
    sync_directory(destination)?;
    Ok(receipt)
}

pub(crate) fn create_named_checkpoint(
    conn: &Connection,
    source_database: &Path,
    schema: &SchemaManifest,
    destination: Option<&Path>,
    request: &NamedCheckpointRequestV1,
    cut_at: Option<CheckpointPublicationCut>,
) -> SnapbackResult<NamedCheckpointReceiptV1> {
    let outcome =
        create_named_checkpoint_inner(conn, source_database, schema, destination, request, cut_at);
    let error = match outcome {
        Ok(receipt) => return Ok(receipt),
        Err(error) => error,
    };
    // Simulated crashes deliberately retain their exact intra-state evidence
    // for the recovery matrix. Ordinary stable refusals reconcile immediately
    // so callers never inherit an unexplained staging intent.
    if error.diagnostic.code == "SNAPBACK_CHECKPOINT_TEST_CRASH_CUT" {
        return Err(error);
    }
    if !checkpoint_registry_exists(conn)? {
        return Err(error);
    }
    let Some(record) = registry_record_by_operation(conn, &request.operation_id)? else {
        return Err(error);
    };
    if record.state == CheckpointRegistryStateV1::Invalid && record.producer_active {
        acknowledge_cancelled_checkpoint_producer(
            conn,
            &record.receipt.checkpoint_id,
            request.now_ms,
        )?;
        return Err(error);
    }
    match recover_checkpoint(conn, &record.receipt.checkpoint_id, request.now_ms) {
        Ok(recovered) if recovered.state == CheckpointRegistryStateV1::Published => {
            Ok(recovered.receipt)
        }
        _ => Err(error),
    }
}

pub(crate) fn inspect_checkpoint(
    conn: &Connection,
    checkpoint_id: &str,
    now_ms: u64,
) -> SnapbackResult<NamedCheckpointReceiptV1> {
    crate::manifest::validate_portable_timestamp_millis(now_ms)?;
    if !checkpoint_registry_exists(conn)? {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_NOT_FOUND",
            "checkpoint is not registered",
        ));
    }
    let record = registry_record(conn, checkpoint_id)?.ok_or_else(|| {
        proof_error(
            "SNAPBACK_CHECKPOINT_NOT_FOUND",
            "checkpoint is not registered",
        )
    })?;
    if record.state != CheckpointRegistryStateV1::Published
        || record.open_erasure_obligation
        || record.receipt.lease_expires_at_ms < now_ms
    {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_INVALID",
            "registry authority refuses this checkpoint",
        ));
    }
    let receipt_shape_valid = record.receipt.format_version == 1
        && record.receipt.checkpoint_id == checkpoint_id
        && record.receipt.source_digest.domain == BoundaryDomainV1::Checkpoint
        && !record.receipt.source_digest.header_digest.is_empty()
        && !record.receipt.source_digest.content_digest.is_empty()
        && match record.receipt.substrate {
            CheckpointSubstrateV1::ReceiptOnly => {
                record.destination.is_none()
                    && record.staging.is_none()
                    && record.receipt.proof_class == ProofClassV1::Inventory
                    && record.receipt.copied_digest.is_none()
                    && record.receipt.copy_disposition.is_none()
                    && record.receipt.copied_bytes == 0
            }
            CheckpointSubstrateV1::Materialized => {
                record.destination.is_some()
                    && record.receipt.proof_class == ProofClassV1::VerifiedCopyFidelity
                    && record.receipt.copied_digest.as_ref() == Some(&record.receipt.source_digest)
                    && record.receipt.copy_disposition
                        == Some(CheckpointCopyDispositionV1::Reachable)
            }
        };
    if !receipt_shape_valid {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_EVIDENCE_MISMATCH",
            "published checkpoint evidence is inconsistent with its substrate",
        ));
    }
    if let Some(destination) = &record.destination {
        let destination = Path::new(destination);
        if !is_directory_without_symlink(destination)
            || destination.join(CHECKPOINT_SENTINEL).exists()
            || !is_regular_file_without_symlink(&destination.join(CHECKPOINT_RECEIPT_FILE))
            || !is_regular_file_without_symlink(&destination.join(CHECKPOINT_INTENT_FILE))
        {
            return Err(proof_error(
                "SNAPBACK_CHECKPOINT_INCOMPLETE",
                "materialized checkpoint evidence is incomplete",
            ));
        }
    }
    Ok(record.receipt)
}

/// Registry-authoritative erasure. Invalidity is committed before physical
/// deletion; an inaccessible copy remains an explicit open obligation.
pub(crate) fn erase_checkpoint(
    conn: &Connection,
    checkpoint_id: &str,
    now_ms: u64,
) -> SnapbackResult<CheckpointRegistryRecordV1> {
    erase_checkpoint_with(conn, checkpoint_id, now_ms, |path| fs::remove_dir_all(path))
}

fn erase_checkpoint_with(
    conn: &Connection,
    checkpoint_id: &str,
    now_ms: u64,
    destroy: impl FnOnce(&Path) -> std::io::Result<()>,
) -> SnapbackResult<CheckpointRegistryRecordV1> {
    crate::manifest::validate_portable_timestamp_millis(now_ms)?;
    if !checkpoint_registry_exists(conn)? {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_NOT_FOUND",
            "checkpoint is not registered",
        ));
    }
    let mut record = registry_record(conn, checkpoint_id)?.ok_or_else(|| {
        proof_error(
            "SNAPBACK_CHECKPOINT_NOT_FOUND",
            "checkpoint is not registered",
        )
    })?;
    record.state = CheckpointRegistryStateV1::Invalid;
    record.updated_at_ms = now_ms;
    record.open_erasure_obligation = record.destination.is_some();
    if record.destination.is_some() {
        record.receipt.copy_disposition = Some(CheckpointCopyDispositionV1::InvalidUnreachable);
    }
    save_registry_record(conn, &record)?;
    if let Some(destination) = &record.destination {
        match destroy(Path::new(destination)) {
            Ok(()) => {
                if !record.producer_active {
                    record.state = CheckpointRegistryStateV1::Erased;
                    record.open_erasure_obligation = false;
                    record.receipt.copy_disposition = Some(CheckpointCopyDispositionV1::Destroyed);
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                if !record.producer_active {
                    record.state = CheckpointRegistryStateV1::Erased;
                    record.open_erasure_obligation = false;
                    record.receipt.copy_disposition = Some(CheckpointCopyDispositionV1::Destroyed);
                }
            }
            Err(_) => {
                // The registry's invalid state already outvotes local evidence.
                // Preserve the destination and the honest open obligation.
            }
        }
    } else {
        record.state = CheckpointRegistryStateV1::Erased;
        record.producer_active = false;
    }
    record.updated_at_ms = now_ms;
    save_registry_record(conn, &record)?;
    Ok(record)
}

/// Registry-authoritative protected-record erasure across the complete
/// registered materialized-checkpoint inventory. All affected copies become
/// invalid in one transaction before any filesystem deletion. An interrupted
/// or inaccessible path remains an explicit durable obligation; retrying the
/// same operation reconciles missing bytes and closes reachable obligations.
///
/// @ref LLP 0162#6-bounded-history-and-named-checkpoints — an unreachable
///   registered copy is recorded as an open erasure obligation, never success.
pub(crate) fn erase_protected_record_checkpoint_copies(
    conn: &Connection,
    qualified_table: &str,
    row_id: &str,
    operation_id: &str,
    now_ms: u64,
) -> SnapbackResult<ProtectedRecordCheckpointErasureReceiptV1> {
    erase_protected_record_checkpoint_copies_with(
        conn,
        qualified_table,
        row_id,
        operation_id,
        now_ms,
        |path| fs::remove_dir_all(path),
        false,
    )
}

/// Execute the product-level protected-record erasure command. The caller can
/// only supply an authority carrier minted by an authenticated in-crate
/// dispatcher. The first IMMEDIATE transaction binds operation identity,
/// authority and exact target; deletes the canonical row plus retained
/// journal/history detail; invalidates the complete checkpoint inventory; and
/// installs the durable fence/receipt. Physical copy destruction resumes only
/// after that commit.
///
/// @ref LLP 0165#protected-deletion-authority-audit--2026-08-04 — generic
/// `BufferedWrite::Delete` has no protected-erasure authority; this deliberate
/// command owns canonical deletion, registry fencing, and copy obligations.
pub(crate) fn erase_protected_record(
    conn: &Connection,
    schema: &SchemaManifest,
    request: &ProtectedRecordErasureRequestV1,
) -> SnapbackResult<ProtectedRecordErasureReceiptV1> {
    erase_protected_record_with(conn, schema, request, |path| fs::remove_dir_all(path), None)
}

fn begin_protected_record_erasure(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    request: &ProtectedRecordErasureRequestV1,
    cut: Option<ProtectedRecordErasureCutV1>,
) -> SnapbackResult<ProtectedRecordErasureReceiptV1> {
    validate_protected_record_erasure_request(schema, request)?;
    if let Some(existing) = protected_record_erasure_by_operation(tx, &request.operation_id)? {
        if !request_matches_protected_record_erasure(request, &existing) {
            return Err(proof_error(
                "SNAPBACK_PROTECTED_ERASURE_IDENTITY_REUSED",
                "protected-record erasure identity was reused with divergent authority or target facts",
            ));
        }
        return Ok(existing);
    }
    if protected_erasure_by_operation(tx, &request.operation_id)?.is_some() {
        return Err(proof_error(
            "SNAPBACK_PROTECTED_ERASURE_IDENTITY_REUSED",
            "protected-record erasure identity collides with a checkpoint-only operation",
        ));
    }
    if checkpoint_erasure_fence_open(tx)? {
        return Err(proof_error(
            "SNAPBACK_PROTECTED_ERASURE_BUSY",
            "a different protected-record erasure still has open copy obligations",
        ));
    }

    let table = schema.table(&request.qualified_table).ok_or_else(|| {
        proof_error(
            "SNAPBACK_PROTECTED_ERASURE_REQUEST_INVALID",
            "protected-record erasure target is not a declared application table",
        )
    })?;
    let deleted = tx.execute(
        &format!(
            "DELETE FROM {} WHERE _id=?1",
            crate::storage::quote_ident(&table.name)?
        ),
        params![request.row_id],
    )?;
    if deleted != 1 {
        return Err(proof_error(
            "SNAPBACK_PROTECTED_ERASURE_TARGET_NOT_FOUND",
            "protected-record erasure requires one present canonical target row",
        ));
    }
    tx.execute(
        "UPDATE _snapback_relation_incarnations_v1
            SET active=0
          WHERE table_name=?1 AND row_id=?2 AND active=1",
        params![request.qualified_table, request.row_id],
    )?;
    tx.execute(
        "DELETE FROM _snapback_changes WHERE table_name=?1 AND row_id=?2",
        params![request.qualified_table, request.row_id],
    )?;
    tx.execute(
        &format!("DELETE FROM {RECORD_HISTORY_TABLE} WHERE table_name=?1 AND row_id=?2"),
        params![request.qualified_table, request.row_id],
    )?;

    let current_version = crate::storage::current_version_on(tx)?;
    let canonical_delete_version = current_version
        .checked_add(1)
        .filter(|version| *version <= crate::manifest::PORTABLE_STORAGE_VERSION_MAX)
        .ok_or_else(|| {
            proof_error(
                "SNAPBACK_STORAGE_VERSION_EXHAUSTED",
                "protected-record erasure cannot advance the canonical version",
            )
        })?;
    crate::storage::set_promotion_version(tx, canonical_delete_version)?;
    let journal_version = i64::try_from(canonical_delete_version).map_err(|_| {
        proof_error(
            "SNAPBACK_STORAGE_VERSION_EXHAUSTED",
            "protected-record erasure version does not fit SQLite's integer carrier",
        )
    })?;
    let changed_at_ms = i64::try_from(request.now_ms).map_err(|_| {
        proof_error(
            "SNAPBACK_PROTECTED_ERASURE_REQUEST_INVALID",
            "protected-record erasure timestamp does not fit SQLite's integer carrier",
        )
    })?;
    tx.execute(
        "INSERT INTO _snapback_changes(
           version,table_name,row_id,op,row_json,changed_at_ms
         ) VALUES(?1,?2,?3,'delete',NULL,?4)",
        params![
            journal_version,
            request.qualified_table,
            request.row_id,
            changed_at_ms,
        ],
    )?;

    let mut copies = Vec::new();
    for mut record in registry_records(tx)? {
        let materialized = record.receipt.substrate == CheckpointSubstrateV1::Materialized;
        let terminal = matches!(
            record.state,
            CheckpointRegistryStateV1::Erased | CheckpointRegistryStateV1::Aborted
        );
        if materialized {
            copies.push(ProtectedCheckpointCopyErasureV1 {
                checkpoint_id: record.receipt.checkpoint_id.clone(),
                owner: record.receipt.owner.clone(),
                location_class: record.receipt.location_class.clone(),
                disposition: if terminal {
                    CheckpointCopyDispositionV1::Destroyed
                } else {
                    CheckpointCopyDispositionV1::InvalidUnreachable
                },
            });
        }
        if !terminal {
            record.state = CheckpointRegistryStateV1::Invalid;
            record.open_erasure_obligation =
                materialized && (record.destination.is_some() || record.staging.is_some());
            if materialized {
                record.receipt.copy_disposition =
                    Some(CheckpointCopyDispositionV1::InvalidUnreachable);
            }
            record.updated_at_ms = request.now_ms;
            save_registry_record(tx, &record)?;
        }
    }
    advance_protected_erasure_generation(tx)?;

    let receipt = ProtectedRecordErasureReceiptV1 {
        format_version: 1,
        erasure_id: format!("protected-record-erasure-v1:{}", Uuid::now_v7()),
        operation_id: request.operation_id.clone(),
        authority: request.authority.facts(),
        qualified_table: request.qualified_table.clone(),
        row_id: request.row_id.clone(),
        canonical_delete_version,
        state: ProtectedRecordErasureStateV1::OpenObligations,
        copies,
        created_at_ms: request.now_ms,
        updated_at_ms: request.now_ms,
    };
    save_protected_record_erasure(tx, &receipt)?;
    if cut == Some(ProtectedRecordErasureCutV1::BeforeAtomicCommit) {
        return Err(proof_error(
            "SNAPBACK_PROTECTED_ERASURE_TEST_CRASH_CUT",
            "injected crash before the protected-erasure transaction commit",
        ));
    }
    Ok(receipt)
}

fn erase_protected_record_with(
    conn: &Connection,
    schema: &SchemaManifest,
    request: &ProtectedRecordErasureRequestV1,
    mut destroy: impl FnMut(&Path) -> std::io::Result<()>,
    cut: Option<ProtectedRecordErasureCutV1>,
) -> SnapbackResult<ProtectedRecordErasureReceiptV1> {
    validate_protected_record_erasure_request(schema, request)?;
    ensure_checkpoint_erasure_infra(conn)?;
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let mut receipt = begin_protected_record_erasure(&tx, schema, request, cut)?;
    tx.commit()?;
    if cut == Some(ProtectedRecordErasureCutV1::AfterAtomicCommit) {
        return Err(proof_error(
            "SNAPBACK_PROTECTED_ERASURE_TEST_CRASH_CUT",
            "injected crash after the protected-erasure fence committed",
        ));
    }
    if receipt.state == ProtectedRecordErasureStateV1::Complete {
        return Ok(receipt);
    }

    let mut destroyed_any = false;
    for copy_index in 0..receipt.copies.len() {
        if receipt.copies[copy_index].disposition == CheckpointCopyDispositionV1::Destroyed {
            continue;
        }
        let checkpoint_id = receipt.copies[copy_index].checkpoint_id.clone();
        let mut record = registry_record(conn, &checkpoint_id)?.ok_or_else(|| {
            proof_error(
                "SNAPBACK_PROTECTED_ERASURE_REGISTRY_CORRUPT",
                "protected erasure obligation names a missing checkpoint record",
            )
        })?;
        if record.state == CheckpointRegistryStateV1::Erased {
            receipt.copies[copy_index].disposition = CheckpointCopyDispositionV1::Destroyed;
            continue;
        }
        if record.state != CheckpointRegistryStateV1::Invalid {
            return Err(proof_error(
                "SNAPBACK_PROTECTED_ERASURE_REGISTRY_CORRUPT",
                "protected erasure obligation lost registry invalidity",
            ));
        }
        let mut paths = Vec::new();
        for path in [&record.destination, &record.staging].into_iter().flatten() {
            let path = PathBuf::from(path);
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
        let mut all_destroyed = true;
        let mut physically_destroyed = false;
        for path in paths {
            match destroy(&path) {
                Ok(()) => {
                    physically_destroyed = true;
                    destroyed_any = true;
                }
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(_) => all_destroyed = false,
            }
        }
        if cut == Some(ProtectedRecordErasureCutV1::AfterFirstPhysicalDestroy)
            && physically_destroyed
        {
            return Err(proof_error(
                "SNAPBACK_PROTECTED_ERASURE_TEST_CRASH_CUT",
                "injected crash after physical destruction and before obligation closure",
            ));
        }
        if record.producer_active {
            // Only the admitted producer (or explicit recovery successor)
            // can attest that it has stopped creating paths. Physical absence
            // alone is not closure authority for this obligation.
            continue;
        }
        if !all_destroyed {
            continue;
        }

        let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
        record.state = CheckpointRegistryStateV1::Erased;
        record.producer_active = false;
        record.open_erasure_obligation = false;
        record.receipt.copy_disposition = Some(CheckpointCopyDispositionV1::Destroyed);
        record.staging = None;
        record.updated_at_ms = request.now_ms;
        save_registry_record(&tx, &record)?;
        receipt.copies[copy_index].disposition = CheckpointCopyDispositionV1::Destroyed;
        receipt.updated_at_ms = request.now_ms;
        save_protected_record_erasure(&tx, &receipt)?;
        tx.commit()?;
    }

    let complete = receipt
        .copies
        .iter()
        .all(|copy| copy.disposition == CheckpointCopyDispositionV1::Destroyed);
    if complete && cut == Some(ProtectedRecordErasureCutV1::AfterAllPhysicalDestroy) {
        let _ = destroyed_any;
        return Err(proof_error(
            "SNAPBACK_PROTECTED_ERASURE_TEST_CRASH_CUT",
            "injected crash after physical destruction and before fence closure",
        ));
    }
    if complete {
        let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
        receipt.state = ProtectedRecordErasureStateV1::Complete;
        receipt.updated_at_ms = request.now_ms;
        save_protected_record_erasure(&tx, &receipt)?;
        tx.commit()?;
    }
    Ok(receipt)
}

pub fn validate_checkpoint_copy_erasure_request(
    qualified_table: &str,
    row_id: &str,
    operation_id: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    crate::manifest::validate_portable_timestamp_millis(now_ms)?;
    if qualified_table.is_empty() || row_id.is_empty() || operation_id.is_empty() {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_ERASURE_REQUEST_INVALID",
            "protected-record checkpoint erasure requires table, row, and operation identity",
        ));
    }
    Ok(())
}

fn erase_protected_record_checkpoint_copies_with(
    conn: &Connection,
    qualified_table: &str,
    row_id: &str,
    operation_id: &str,
    now_ms: u64,
    mut destroy: impl FnMut(&Path) -> std::io::Result<()>,
    cut_after_first_physical_destroy: bool,
) -> SnapbackResult<ProtectedRecordCheckpointErasureReceiptV1> {
    validate_checkpoint_copy_erasure_request(qualified_table, row_id, operation_id, now_ms)?;
    ensure_checkpoint_erasure_infra(conn)?;

    let mut receipt = if let Some(existing) = protected_erasure_by_operation(conn, operation_id)? {
        if existing.qualified_table != qualified_table || existing.row_id != row_id {
            return Err(proof_error(
                "SNAPBACK_CHECKPOINT_ERASURE_IDENTITY_REUSED",
                "protected-record erasure operation identity was reused with divergent facts",
            ));
        }
        existing
    } else {
        let tx = conn.unchecked_transaction()?;
        let mut copies = Vec::new();
        for mut record in registry_records(&tx)? {
            if record.receipt.substrate != CheckpointSubstrateV1::Materialized {
                continue;
            }
            let disposition = if matches!(
                record.state,
                CheckpointRegistryStateV1::Erased | CheckpointRegistryStateV1::Aborted
            ) {
                CheckpointCopyDispositionV1::Destroyed
            } else {
                record.state = CheckpointRegistryStateV1::Invalid;
                record.open_erasure_obligation =
                    record.destination.is_some() || record.staging.is_some();
                record.receipt.copy_disposition =
                    Some(CheckpointCopyDispositionV1::InvalidUnreachable);
                record.updated_at_ms = now_ms;
                save_registry_record(&tx, &record)?;
                CheckpointCopyDispositionV1::InvalidUnreachable
            };
            copies.push(ProtectedCheckpointCopyErasureV1 {
                checkpoint_id: record.receipt.checkpoint_id,
                owner: record.receipt.owner,
                location_class: record.receipt.location_class,
                disposition,
            });
        }
        // Retained protected post-images are in the same erasure transaction
        // as registry invalidation; the canonical record writer remains the
        // caller's separate protected-lane authority.
        tx.execute(
            &format!("DELETE FROM {RECORD_HISTORY_TABLE} WHERE table_name=?1 AND row_id=?2"),
            params![qualified_table, row_id],
        )?;
        let state = if copies
            .iter()
            .all(|copy| copy.disposition == CheckpointCopyDispositionV1::Destroyed)
        {
            ProtectedCheckpointErasureStateV1::Complete
        } else {
            ProtectedCheckpointErasureStateV1::OpenObligations
        };
        let receipt = ProtectedRecordCheckpointErasureReceiptV1 {
            format_version: 1,
            erasure_id: format!("checkpoint-erasure-v1:{}", Uuid::now_v7()),
            operation_id: operation_id.to_owned(),
            qualified_table: qualified_table.to_owned(),
            row_id: row_id.to_owned(),
            state,
            copies,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
        };
        save_protected_erasure(&tx, &receipt)?;
        tx.commit()?;
        receipt
    };

    if receipt.state == ProtectedCheckpointErasureStateV1::Complete {
        return Ok(receipt);
    }

    for copy_index in 0..receipt.copies.len() {
        if receipt.copies[copy_index].disposition == CheckpointCopyDispositionV1::Destroyed {
            continue;
        }
        let checkpoint_id = receipt.copies[copy_index].checkpoint_id.clone();
        let mut record = registry_record(conn, &checkpoint_id)?.ok_or_else(|| {
            proof_error(
                "SNAPBACK_CHECKPOINT_ERASURE_REGISTRY_CORRUPT",
                "an erasure obligation names a missing checkpoint registry record",
            )
        })?;
        if record.state != CheckpointRegistryStateV1::Invalid || !record.open_erasure_obligation {
            return Err(proof_error(
                "SNAPBACK_CHECKPOINT_ERASURE_REGISTRY_CORRUPT",
                "an open erasure obligation is not backed by registry invalidity",
            ));
        }
        let mut paths = Vec::new();
        for path in [&record.destination, &record.staging].into_iter().flatten() {
            let path = PathBuf::from(path);
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
        let mut all_destroyed = true;
        let mut physical_destroyed = false;
        for path in paths {
            match destroy(&path) {
                Ok(()) => physical_destroyed = true,
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(_) => all_destroyed = false,
            }
        }
        if cut_after_first_physical_destroy && physical_destroyed {
            return Err(proof_error(
                "SNAPBACK_CHECKPOINT_ERASURE_TEST_CRASH_CUT",
                "injected crash after physical checkpoint destruction and before registry closure",
            ));
        }
        if all_destroyed {
            record.state = CheckpointRegistryStateV1::Erased;
            record.open_erasure_obligation = false;
            record.receipt.copy_disposition = Some(CheckpointCopyDispositionV1::Destroyed);
            record.staging = None;
            record.updated_at_ms = now_ms;
            save_registry_record(conn, &record)?;
            receipt.copies[copy_index].disposition = CheckpointCopyDispositionV1::Destroyed;
        }
        receipt.updated_at_ms = now_ms;
        receipt.state = if receipt
            .copies
            .iter()
            .all(|candidate| candidate.disposition == CheckpointCopyDispositionV1::Destroyed)
        {
            ProtectedCheckpointErasureStateV1::Complete
        } else {
            ProtectedCheckpointErasureStateV1::OpenObligations
        };
        save_protected_erasure(conn, &receipt)?;
    }
    Ok(receipt)
}

fn is_regular_file_without_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_file())
}

fn is_directory_without_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_dir())
}

fn recovery_evidence_matches_intent(
    record: &CheckpointRegistryRecordV1,
    intent: &CheckpointRecoveryIntentV1,
    destination: &Path,
    receipt: &NamedCheckpointReceiptV1,
) -> bool {
    let registered = &record.receipt;
    let destination = destination.to_string_lossy();
    let database_name = Path::new(&intent.database_file_name);
    let database_path = destination.as_ref();
    let database_path = Path::new(database_path).join(database_name);
    intent.format_version == 1
        && intent.checkpoint_id == registered.checkpoint_id
        && intent.label == registered.label
        && intent.operation_id == registered.operation_id
        && intent.owner == registered.owner
        && intent.location_class == registered.location_class
        && intent.substrate == CheckpointSubstrateV1::Materialized
        && intent.substrate == registered.substrate
        && intent.source_stream_id == registered.source_stream_id
        && intent.source_version == registered.source_version
        && intent.schema_hash == registered.schema_hash
        && intent.coverage_manifest_digest == registered.coverage_manifest_digest
        && intent.created_at_ms == registered.created_at_ms
        && intent.lease_expires_at_ms == registered.lease_expires_at_ms
        && intent.max_copy_bytes > 0
        && intent.max_copy_bytes <= CHECKPOINT_MAX_COPY_BYTES
        && intent.max_retained_wal_bytes > 0
        && intent.max_retained_wal_bytes <= CHECKPOINT_MAX_RETAINED_WAL_BYTES
        && intent.destination.as_deref() == Some(destination.as_ref())
        && record.destination.as_deref() == Some(destination.as_ref())
        && !intent.database_file_name.is_empty()
        && database_name.file_name() == Some(database_name.as_os_str())
        && is_regular_file_without_symlink(&database_path)
        && receipt.format_version == 1
        && receipt.checkpoint_id == intent.checkpoint_id
        && receipt.label == intent.label
        && receipt.operation_id == intent.operation_id
        && receipt.owner == intent.owner
        && receipt.location_class == intent.location_class
        && receipt.substrate == intent.substrate
        && receipt.source_stream_id == intent.source_stream_id
        && receipt.source_version == intent.source_version
        && receipt.schema_hash == intent.schema_hash
        && !receipt.schema_hash.trim().is_empty()
        && receipt.coverage_manifest_digest == intent.coverage_manifest_digest
        && receipt.created_at_ms == intent.created_at_ms
        && receipt.lease_expires_at_ms == intent.lease_expires_at_ms
        && receipt.copied_bytes <= intent.max_copy_bytes
        && receipt.peak_retained_wal_bytes <= intent.max_retained_wal_bytes
        && receipt.proof_class == ProofClassV1::VerifiedCopyFidelity
        && receipt.copy_disposition == Some(CheckpointCopyDispositionV1::Reachable)
        && receipt.source_digest.domain == BoundaryDomainV1::Checkpoint
        && receipt.copied_digest.as_ref() == Some(&receipt.source_digest)
}

fn recovered_copy_matches_receipt(
    destination: &Path,
    intent: &CheckpointRecoveryIntentV1,
    receipt: &NamedCheckpointReceiptV1,
) -> bool {
    let database_name = Path::new(&intent.database_file_name);
    if database_name.file_name() != Some(database_name.as_os_str()) {
        return false;
    }
    let database_path = destination.join(database_name);
    let Ok(metadata) = fs::symlink_metadata(&database_path) else {
        return false;
    };
    if !metadata.file_type().is_file() || metadata.len() != receipt.copied_bytes {
        return false;
    }
    let Ok(copied) =
        Connection::open_with_flags(&database_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return false;
    };
    let stored_schema: Option<String> = copied
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key='schema_manifest'",
            [],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    let Some(stored_schema) = stored_schema else {
        return false;
    };
    let Ok(schema) = serde_json::from_str::<SchemaManifest>(&stored_schema) else {
        return false;
    };
    if required_checkpoint_schema_hash(&schema).ok() != Some(intent.schema_hash.as_str()) {
        return false;
    }
    let Ok((stream, version)) = current_source_facts(&copied) else {
        return false;
    };
    if stream != intent.source_stream_id || version != intent.source_version {
        return false;
    }
    let Ok(rows) = scan_rows(&copied, &schema) else {
        return false;
    };
    let header = checkpoint_header(
        &intent.checkpoint_id,
        &intent.source_stream_id,
        intent.source_version,
        &intent.schema_hash,
        &intent.coverage_manifest_digest,
    );
    checkpoint_boundary_digest(&header, &rows).is_ok_and(|actual| {
        actual == receipt.source_digest && receipt.copied_digest.as_ref() == Some(&actual)
    })
}

/// Recover one intent from registry plus local rename evidence. A destination
/// with complete evidence is finalized; otherwise only the exact staging path
/// named by the intent is reaped and the operation becomes `aborted`.
pub(crate) fn recover_checkpoint(
    conn: &Connection,
    checkpoint_id: &str,
    now_ms: u64,
) -> SnapbackResult<CheckpointRegistryRecordV1> {
    crate::manifest::validate_portable_timestamp_millis(now_ms)?;
    if !checkpoint_registry_exists(conn)? {
        return Err(proof_error(
            "SNAPBACK_CHECKPOINT_NOT_FOUND",
            "checkpoint is not registered",
        ));
    }
    let mut record = registry_record(conn, checkpoint_id)?.ok_or_else(|| {
        proof_error(
            "SNAPBACK_CHECKPOINT_NOT_FOUND",
            "checkpoint is not registered",
        )
    })?;
    if record.state == CheckpointRegistryStateV1::Published {
        if let Some(destination) = &record.destination {
            let sentinel = Path::new(destination).join(CHECKPOINT_SENTINEL);
            if sentinel.exists() {
                fs::remove_file(&sentinel)
                    .map_err(|error| io_error("finish recovered checkpoint publication", error))?;
                sync_directory(Path::new(destination))?;
            }
        }
        return Ok(record);
    }
    if record.state == CheckpointRegistryStateV1::Invalid && record.producer_active {
        return acknowledge_cancelled_checkpoint_producer(conn, checkpoint_id, now_ms);
    }
    if record.state != CheckpointRegistryStateV1::Intent {
        return Ok(record);
    }
    let published = record.destination.as_deref().map(Path::new).filter(|path| {
        is_directory_without_symlink(path)
            && is_regular_file_without_symlink(&path.join(CHECKPOINT_SENTINEL))
            && is_regular_file_without_symlink(&path.join(CHECKPOINT_RECEIPT_FILE))
            && is_regular_file_without_symlink(&path.join(CHECKPOINT_INTENT_FILE))
    });
    if let Some(destination) = published {
        let evidence_intent: CheckpointRecoveryIntentV1 = serde_json::from_slice(
            &fs::read(destination.join(CHECKPOINT_INTENT_FILE))
                .map_err(|error| io_error("read recovered checkpoint intent", error))?,
        )
        .map_err(|_| {
            proof_error(
                "SNAPBACK_CHECKPOINT_EVIDENCE_MISMATCH",
                "checkpoint recovery intent is malformed",
            )
        })?;
        let receipt: NamedCheckpointReceiptV1 = serde_json::from_slice(
            &fs::read(destination.join(CHECKPOINT_RECEIPT_FILE))
                .map_err(|error| io_error("read recovered checkpoint receipt", error))?,
        )
        .map_err(|_| {
            proof_error(
                "SNAPBACK_CHECKPOINT_RECEIPT_INVALID",
                "checkpoint receipt is malformed",
            )
        })?;
        let intent = registry_intent(conn, checkpoint_id)?.ok_or_else(|| {
            proof_error(
                "SNAPBACK_CHECKPOINT_EVIDENCE_MISMATCH",
                "recovered checkpoint has no durable creation intent",
            )
        })?;
        if evidence_intent != intent
            || !recovery_evidence_matches_intent(&record, &intent, destination, &receipt)
            || !recovered_copy_matches_receipt(destination, &intent, &receipt)
        {
            return Err(proof_error(
                "SNAPBACK_CHECKPOINT_EVIDENCE_MISMATCH",
                "recovered checkpoint evidence diverges from its durable creation intent",
            ));
        }
        let parent = destination.parent().unwrap_or_else(|| Path::new("."));
        // The crash may have happened after rename but before the normal
        // parent-directory sync. Make the directory entry durable before the
        // registry can publish it.
        sync_directory(parent)?;
        record.receipt = receipt;
        record.state = CheckpointRegistryStateV1::Published;
        record.producer_active = false;
        record.staging = None;
        record.updated_at_ms = now_ms;
        finalize_checkpoint_publication(conn, &record)?;
        fs::remove_file(destination.join(CHECKPOINT_SENTINEL))
            .map_err(|error| io_error("remove recovered checkpoint sentinel", error))?;
        sync_directory(destination)?;
        return Ok(record);
    }
    if let Some(staging) = &record.staging {
        match fs::remove_dir_all(staging) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("reap abandoned checkpoint staging", error)),
        }
    }
    record.state = CheckpointRegistryStateV1::Aborted;
    record.producer_active = false;
    record.staging = None;
    record.updated_at_ms = now_ms;
    save_registry_record(conn, &record)?;
    Ok(record)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        FieldManifest, FieldType, HandlerInput, SchemaManifest, SeedData, TableManifest,
    };
    use crate::storage::{BufferedWrite, LocalDatabase};
    use serde_json::{Map, json};
    use std::collections::BTreeMap;

    fn schema() -> SchemaManifest {
        // @ref LLP 0264#d2-v1-default-write-posture-by-policy-kind — checkpoint
        // tests use an ordinary public fixture, not an undeclared write seam.
        SchemaManifest {
            schema_hash: Some("sha256:proof-checkpoint-test-schema".to_owned()),
            tables: vec![TableManifest {
                name: "items".to_owned(),
                fields: vec![FieldManifest {
                    name: "visibility".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                }],
                indexes: Vec::new(),
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: Some(crate::manifest::TableVisibilityV1::PublicRead),
                history: Some(crate::manifest::HistoryRetentionManifestV1 {
                    retain_ms: 10_000,
                    max_versions_per_record: 10,
                }),
            }],
            ..SchemaManifest::default()
        }
    }

    fn seeded_file_database(path: &Path) -> LocalDatabase {
        let mut database = LocalDatabase::open(path).expect("open database");
        database
            .schema_seed()
            .apply_schema(schema())
            .expect("apply schema");
        database
            .schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!("item-a")),
                        ("visibility".to_owned(), json!("public")),
                    ])],
                )]),
            })
            .expect("seed row");
        database
    }

    fn checkpoint_erasure_table_count(conn: &Connection) -> u64 {
        CHECKPOINT_ERASURE_TABLES
            .iter()
            .map(|table| {
                conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1)",
                    [*table],
                    |row| row.get::<_, u64>(0),
                )
                .expect("inspect optional checkpoint/erasure table")
            })
            .sum()
    }

    #[test]
    fn ordinary_storage_keeps_checkpoint_erasure_authority_pay_for_play() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("ordinary.sqlite");
        let mut database = seeded_file_database(&database_path);
        database
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "item-a".to_owned(),
                    values: Map::from_iter([("visibility".to_owned(), json!("updated"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("ordinary mutation still uses the eager history seam");

        let reader = Connection::open(&database_path).expect("inspect ordinary schema");
        assert_eq!(checkpoint_erasure_table_count(&reader), 0);
        for table in [
            HISTORY_POLICY_TABLE,
            HISTORY_POLICY_TABLE_V2,
            RECORD_HISTORY_TABLE,
        ] {
            assert!(
                reader
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1)",
                        [table],
                        |row| row.get::<_, bool>(0),
                    )
                    .expect("inspect eager history table"),
                "ordinary mutation requires {table}"
            );
        }

        let mut invalid_checkpoint = checkpoint_request(9);
        invalid_checkpoint.label.clear();
        assert_eq!(
            database
                .checkpoints()
                .create_named_checkpoint(None, &invalid_checkpoint)
                .expect_err("invalid checkpoint refuses before first-use DDL")
                .diagnostic
                .code,
            "SNAPBACK_CHECKPOINT_REQUEST_INVALID"
        );
        let authority = database
            .claim_kernel_commit_authority()
            .expect("kernel authority");
        let mut invalid_erasure = admitted_protected_erasure_request(
            &authority,
            "invalid-erasure",
            "operator-a",
            "item-a",
            9,
        );
        invalid_erasure.row_id.clear();
        assert_eq!(
            database
                .checkpoints_read()
                .erase_protected_record(&invalid_erasure)
                .expect_err("invalid erasure refuses before first-use DDL")
                .diagnostic
                .code,
            "SNAPBACK_PROTECTED_ERASURE_REQUEST_INVALID"
        );
        assert_eq!(
            database
                .checkpoints_read()
                .erase_protected_record_checkpoint_copies("items", "item-a", "", 9)
                .expect_err("invalid copy erasure refuses before first-use DDL")
                .diagnostic
                .code,
            "SNAPBACK_CHECKPOINT_ERASURE_REQUEST_INVALID"
        );
        assert_eq!(checkpoint_erasure_table_count(&reader), 0);

        for outcome in [
            database
                .checkpoints_read()
                .inspect_named_checkpoint("checkpoint-v1:absent", 10),
            database
                .checkpoints_read()
                .erase_named_checkpoint("checkpoint-v1:absent", 10)
                .map(|record| record.receipt),
            database
                .checkpoints_read()
                .recover_named_checkpoint("checkpoint-v1:absent", 10)
                .map(|record| record.receipt),
        ] {
            assert_eq!(
                outcome
                    .expect_err("absent registry refuses stably")
                    .diagnostic
                    .code,
                "SNAPBACK_CHECKPOINT_NOT_FOUND"
            );
            assert_eq!(checkpoint_erasure_table_count(&reader), 0);
        }
    }

    #[test]
    fn first_checkpoint_or_erasure_creates_one_complete_authority_family() {
        let checkpoint_temp = tempfile::tempdir().expect("checkpoint tempdir");
        let checkpoint_path = checkpoint_temp.path().join("checkpoint.sqlite");
        let mut checkpoint_database = seeded_file_database(&checkpoint_path);
        checkpoint_database
            .activate_ordinary_mutation_coverage_for_evidence(99)
            .expect("arm the active coverage authorizer before first checkpoint use");
        assert_eq!(
            checkpoint_erasure_table_count(
                &Connection::open(&checkpoint_path).expect("inspect pre-checkpoint schema")
            ),
            0
        );
        let mut request = checkpoint_request(100);
        request.substrate = CheckpointSubstrateV1::ReceiptOnly;
        checkpoint_database
            .checkpoints()
            .create_named_checkpoint(None, &request)
            .expect("first checkpoint initializes authority");
        let checkpoint_reader =
            Connection::open(&checkpoint_path).expect("inspect checkpoint authority");
        assert_eq!(checkpoint_erasure_table_count(&checkpoint_reader), 4);
        assert_eq!(protected_erasure_generation(&checkpoint_reader).unwrap(), 0);

        let erasure_temp = tempfile::tempdir().expect("erasure tempdir");
        let erasure_path = erasure_temp.path().join("erasure.sqlite");
        let mut erasure_database = seeded_file_database(&erasure_path);
        let authority = erasure_database
            .claim_kernel_commit_authority()
            .expect("kernel authority");
        let erasure_request = admitted_protected_erasure_request(
            &authority,
            "erase-first-use",
            "operator-a",
            "item-a",
            200,
        );
        let receipt = erasure_database
            .checkpoints_read()
            .erase_protected_record(&erasure_request)
            .expect("first erasure initializes authority");
        assert_eq!(receipt.state, ProtectedRecordErasureStateV1::Complete);
        assert!(receipt.copies.is_empty());
        let erasure_reader = Connection::open(&erasure_path).expect("inspect erasure authority");
        assert_eq!(checkpoint_erasure_table_count(&erasure_reader), 4);
        assert_eq!(protected_erasure_generation(&erasure_reader).unwrap(), 1);
        assert_eq!(
            erasure_database
                .checkpoints_read()
                .erase_protected_record(&erasure_request)
                .expect("exact first-use retry is idempotent")
                .erasure_id,
            receipt.erasure_id
        );
        assert_eq!(protected_erasure_generation(&erasure_reader).unwrap(), 1);
    }

    #[test]
    fn open_completes_partial_legacy_checkpoint_authority_without_data_loss() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("legacy.sqlite");
        drop(LocalDatabase::open(&database_path).expect("create ordinary database"));
        let legacy = Connection::open(&database_path).expect("open legacy schema");
        legacy
            .execute_batch(&format!(
                "CREATE TABLE {CHECKPOINT_REGISTRY_TABLE} (
                   checkpoint_id TEXT PRIMARY KEY,
                   operation_id TEXT NOT NULL UNIQUE,
                   state TEXT NOT NULL,
                   record_json TEXT NOT NULL,
                   updated_at_ms INTEGER NOT NULL
                 );
                 INSERT INTO {CHECKPOINT_REGISTRY_TABLE}(
                   checkpoint_id,operation_id,state,record_json,updated_at_ms
                 ) VALUES('legacy-checkpoint','legacy-operation','invalid','{{}}',1);"
            ))
            .expect("install partial legacy authority");
        drop(legacy);

        drop(LocalDatabase::open(&database_path).expect("upgrade retained authority"));
        let reader = Connection::open(&database_path).expect("inspect upgraded authority");
        assert_eq!(checkpoint_erasure_table_count(&reader), 4);
        assert!(
            reader
                .query_row(
                    &format!(
                        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('{CHECKPOINT_REGISTRY_TABLE}') WHERE name='intent_json')"
                    ),
                    [],
                    |row| row.get::<_, bool>(0),
                )
                .expect("inspect legacy intent migration")
        );
        assert_eq!(
            reader
                .query_row(
                    &format!("SELECT COUNT(*) FROM {CHECKPOINT_REGISTRY_TABLE}"),
                    [],
                    |row| row.get::<_, u64>(0),
                )
                .expect("count preserved registry rows"),
            1
        );
        assert_eq!(protected_erasure_generation(&reader).unwrap(), 0);
    }

    #[test]
    fn domains_are_separate_and_inventory_cannot_be_labeled_proof() {
        let rows = vec![BoundaryRowV1 {
            qualified_table: "app.todos".to_owned(),
            row_id: "a".to_owned(),
            value: json!({"_id":"a"}),
        }];
        let promotion = promotion_boundary_digest(
            &PromotionDigestHeaderV1 {
                algorithm_version: 1,
                promotion_identity: "p".to_owned(),
                parent_stream_id: "parent".to_owned(),
                child_stream_id: "child".to_owned(),
                base_version: 1,
                reviewed_head_version: 2,
                schema_hash: "schema".to_owned(),
                coverage_manifest_digest: "coverage".to_owned(),
                operation_log_digest: "log".to_owned(),
                approved_facts_digest: "facts".to_owned(),
            },
            &rows,
        )
        .expect("promotion digest");
        let checkpoint = checkpoint_boundary_digest(
            &CheckpointDigestHeaderV1 {
                algorithm_version: 1,
                checkpoint_id: "c".to_owned(),
                source_stream_id: "parent".to_owned(),
                source_version: 2,
                schema_hash: "schema".to_owned(),
                coverage_manifest_digest: "coverage".to_owned(),
            },
            &rows,
        )
        .expect("checkpoint digest");
        assert_ne!(promotion.content_digest, checkpoint.content_digest);
        let error = BoundaryProofV1::independent(promotion.clone(), promotion, "")
            .expect_err("unnamed derivation is not proof");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_PROOF_EXPECTED_DERIVATION_MISSING"
        );
    }

    #[test]
    fn golden_vectors_are_stable_and_preimages_are_closed() {
        let artifact = boundary_digest_golden_artifact();
        assert_eq!(artifact["vectors"].as_array().map(Vec::len), Some(2));
        let promotion = artifact
            .pointer("/vectors/0/expectedDigest/contentDigest")
            .and_then(Value::as_str);
        let checkpoint = artifact
            .pointer("/vectors/1/sourceDigest/contentDigest")
            .and_then(Value::as_str);
        assert!(promotion.is_some_and(|digest| digest.starts_with("cdv1:")));
        assert!(checkpoint.is_some_and(|digest| digest.starts_with("cdv1:")));
        assert_ne!(promotion, checkpoint);
    }

    #[test]
    fn row_order_and_duplicates_fail_closed() {
        let header = CheckpointDigestHeaderV1 {
            algorithm_version: 1,
            checkpoint_id: "c".to_owned(),
            source_stream_id: "s".to_owned(),
            source_version: 1,
            schema_hash: "h".to_owned(),
            coverage_manifest_digest: "m".to_owned(),
        };
        let duplicate = vec![
            BoundaryRowV1 {
                qualified_table: "app.t".to_owned(),
                row_id: "a".to_owned(),
                value: json!({}),
            },
            BoundaryRowV1 {
                qualified_table: "app.t".to_owned(),
                row_id: "a".to_owned(),
                value: json!({}),
            },
        ];
        assert_eq!(
            checkpoint_boundary_digest(&header, &duplicate)
                .expect_err("duplicate")
                .diagnostic
                .code,
            "SNAPBACK_PROOF_ROWS_NOT_CANONICAL"
        );
    }

    #[test]
    fn promotion_expected_state_is_derived_from_base_and_approved_facts() {
        let header = PromotionDigestHeaderV1 {
            algorithm_version: 1,
            promotion_identity: "promotion-a".to_owned(),
            parent_stream_id: "parent".to_owned(),
            child_stream_id: "child".to_owned(),
            base_version: 1,
            reviewed_head_version: 2,
            schema_hash: "schema".to_owned(),
            coverage_manifest_digest: "coverage".to_owned(),
            operation_log_digest: "log".to_owned(),
            approved_facts_digest: "facts".to_owned(),
        };
        let base = vec![BoundaryRowV1 {
            qualified_table: "app.items".to_owned(),
            row_id: "a".to_owned(),
            value: json!({"_id":"a","value":1}),
        }];
        let writes = vec![PromotionApprovedWriteV1 {
            qualified_table: "app.items".to_owned(),
            row_id: "a".to_owned(),
            kind: PromotionWriteKindV1::Update,
            post_image: Some(json!({"_id":"a","value":2})),
        }];
        let expected = derive_promotion_expected_digest(&header, &base, &writes)
            .expect("derive expected state");
        let actual = promotion_boundary_digest(
            &header,
            &[BoundaryRowV1 {
                qualified_table: "app.items".to_owned(),
                row_id: "a".to_owned(),
                value: json!({"_id":"a","value":2}),
            }],
        )
        .expect("scan staged actual");
        let proof = BoundaryProofV1::independent(
            expected,
            actual,
            "immutable base plus PromotionRequestV1 approved write facts",
        )
        .expect("proof carrier");
        assert!(proof.matches);

        let invalid = derive_promotion_expected_digest(
            &header,
            &[],
            &[PromotionApprovedWriteV1 {
                qualified_table: "app.items".to_owned(),
                row_id: "a".to_owned(),
                kind: PromotionWriteKindV1::Update,
                post_image: Some(json!({"_id":"a","value":2})),
            }],
        )
        .expect_err("base precondition is part of the derivation");
        assert_eq!(
            invalid.diagnostic.code,
            "SNAPBACK_PROMOTION_BASE_PRECONDITION_FAILED"
        );
    }

    #[test]
    fn history_survives_reopen_elides_per_version_and_never_moves_sync_floor() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("history.sqlite");
        let mut database = LocalDatabase::open(&database_path).expect("open database");
        database
            .schema_seed()
            .apply_schema(schema())
            .expect("apply schema");
        let projected: (u64, u64) = Connection::open(&database_path)
            .expect("open projected policy reader")
            .query_row(
                &format!(
                    "SELECT retain_ms,max_versions_per_record
                     FROM {HISTORY_POLICY_TABLE_V2} WHERE table_name='items'"
                ),
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("schema publication projects its finite policy");
        assert_eq!(projected, (10_000, 10));
        database
            .schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), json!("item-a")),
                        ("visibility".to_owned(), json!("public")),
                    ])],
                )]),
            })
            .expect("seed row");
        for visibility in ["secret", "public-two", "secret-two", "public-three"] {
            database
                .mutation_writes()
                .commit_buffered_writes(
                    &HandlerInput::default(),
                    vec![BufferedWrite::Patch {
                        table: "items".to_owned(),
                        id: "item-a".to_owned(),
                        values: Map::from_iter([("visibility".to_owned(), json!(visibility))]),
                    }],
                    Vec::new(),
                    Value::Null,
                )
                .expect("patch row");
        }
        drop(database);

        let database = LocalDatabase::open(&database_path).expect("reopen database");
        let page_one = database
            .versions_read()
            .record_history(
                "items",
                "item-a",
                0,
                1,
                |current| {
                    current
                        .and_then(|row| row.get("visibility"))
                        .and_then(Value::as_str)
                        == Some("public-three")
                },
                |post_image| {
                    post_image
                        .and_then(|row| row.get("visibility"))
                        .and_then(Value::as_str)
                        .is_some_and(|visibility| visibility.starts_with("public"))
                },
            )
            .expect("first authorized history page");
        assert_eq!(page_one.entries.len(), 1);
        assert_eq!(page_one.entries[0].disposition, "insert");
        assert_eq!(page_one.next_visible_offset, Some(1));
        assert!(page_one.horizon.predecessor_anchor_complete);

        let page_two = database
            .versions_read()
            .record_history(
                "items",
                "item-a",
                1,
                1,
                |_| true,
                |post_image| {
                    post_image
                        .and_then(|row| row.get("visibility"))
                        .and_then(Value::as_str)
                        .is_some_and(|visibility| visibility.starts_with("public"))
                },
            )
            .expect("second authorized history page");
        assert_eq!(page_two.entries.len(), 1);
        assert_eq!(page_two.next_visible_offset, Some(2));
        assert_eq!(page_two.horizon, page_one.horizon);

        let page_three = database
            .versions_read()
            .record_history(
                "items",
                "item-a",
                2,
                1,
                |_| true,
                |post_image| {
                    post_image
                        .and_then(|row| row.get("visibility"))
                        .and_then(Value::as_str)
                        .is_some_and(|visibility| visibility.starts_with("public"))
                },
            )
            .expect("third authorized history page");
        assert_eq!(page_three.entries.len(), 1);
        assert_eq!(page_three.next_visible_offset, None);
        assert_eq!(page_three.horizon, page_one.horizon);

        let denied = database
            .versions_read()
            .record_history("items", "item-a", 0, 10, |_| false, |_| true)
            .expect_err("current authorization gates all history");
        assert_eq!(
            denied.diagnostic.code,
            "SNAPBACK_HISTORY_AUTHORIZATION_DENIED"
        );
        let replay_floor = database
            .versions_read()
            .journal_floor_version()
            .expect("replay floor");
        assert_eq!(
            database
                .versions_read()
                .prune_record_history(9_000_000_000_000_000)
                .expect("prune history"),
            5
        );
        assert_eq!(
            database
                .versions_read()
                .journal_floor_version()
                .expect("replay floor"),
            replay_floor,
            "history has an independent retention clock"
        );
    }

    #[test]
    fn history_prunes_per_record_and_schema_removal_erases_retained_detail() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("history-policy.sqlite");
        let mut finite = schema();
        finite.schema_hash = Some("sha256:proof-checkpoint-history-two".to_owned());
        finite.tables[0]
            .history
            .as_mut()
            .expect("history declaration")
            .max_versions_per_record = 2;
        let mut database = LocalDatabase::open(&database_path).expect("open database");
        database
            .schema_seed()
            .apply_schema(finite.clone())
            .expect("apply schema");
        database
            .schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![
                        Map::from_iter([
                            ("_id".to_owned(), json!("item-a")),
                            ("visibility".to_owned(), json!("a-0")),
                        ]),
                        Map::from_iter([
                            ("_id".to_owned(), json!("item-b")),
                            ("visibility".to_owned(), json!("b-0")),
                        ]),
                    ],
                )]),
            })
            .expect("seed rows");
        for ordinal in 1..=3 {
            for id in ["item-a", "item-b"] {
                database
                    .mutation_writes()
                    .commit_buffered_writes(
                        &HandlerInput::default(),
                        vec![BufferedWrite::Patch {
                            table: "items".to_owned(),
                            id: id.to_owned(),
                            values: Map::from_iter([(
                                "visibility".to_owned(),
                                json!(format!("{id}-{ordinal}")),
                            )]),
                        }],
                        Vec::new(),
                        Value::Null,
                    )
                    .expect("patch row");
            }
        }
        let reader = Connection::open(&database_path).expect("open history reader");
        let newest_change_ms: u64 = reader
            .query_row(
                &format!("SELECT MAX(changed_at_ms) FROM {RECORD_HISTORY_TABLE}"),
                [],
                |row| row.get(0),
            )
            .expect("newest retained change");
        assert_eq!(
            database
                .versions_read()
                .prune_record_history(newest_change_ms)
                .expect("prune"),
            4
        );
        let retained = reader
            .prepare(&format!(
                "SELECT row_id,COUNT(*) FROM {RECORD_HISTORY_TABLE} \
                 WHERE table_name='items' GROUP BY row_id ORDER BY row_id"
            ))
            .expect("prepare retained counts")
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
            })
            .expect("query retained counts")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect retained counts");
        assert_eq!(
            retained,
            vec![("item-a".to_owned(), 2), ("item-b".to_owned(), 2)]
        );

        let mut removed = finite;
        removed.schema_hash = Some("sha256:proof-checkpoint-history-removed".to_owned());
        removed.tables[0].history = None;
        database
            .schema_seed()
            .apply_schema(removed)
            .expect("publish schema without history");
        let retained_after_removal: u64 = Connection::open(&database_path)
            .expect("open removed-policy reader")
            .query_row(
                &format!("SELECT COUNT(*) FROM {RECORD_HISTORY_TABLE}"),
                [],
                |row| row.get(0),
            )
            .expect("history count");
        assert_eq!(retained_after_removal, 0);
        assert_eq!(
            database
                .versions_read()
                .record_history("items", "item-a", 0, 10, |_| true, |_| true)
                .expect_err("removed declaration disables history")
                .diagnostic
                .code,
            "SNAPBACK_HISTORY_NOT_ENABLED"
        );
    }

    #[test]
    fn legacy_v1_max_rows_remains_table_wide_and_wire_compatible() {
        let decoded: HistoryRetentionPolicyV1 = serde_json::from_value(json!({
            "table": "items",
            "retainMs": 10_000,
            "maxRows": 2
        }))
        .expect("legacy v1 policy decodes");
        assert_eq!(decoded.max_rows, 2);
        assert_eq!(
            serde_json::to_value(&decoded).expect("legacy v1 policy encodes")["maxRows"],
            json!(2)
        );

        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("history-v1.sqlite");
        let mut legacy_schema = schema();
        legacy_schema.schema_hash = Some("sha256:proof-checkpoint-history-v1".to_owned());
        legacy_schema.tables[0].history = None;
        let mut database = LocalDatabase::open(&database_path).expect("open database");
        database
            .schema_seed()
            .apply_schema(legacy_schema)
            .expect("apply legacy schema");
        database
            .versions_read()
            .configure_history_policy(&decoded)
            .expect("configure legacy policy");
        database
            .schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "items".to_owned(),
                    vec![
                        Map::from_iter([
                            ("_id".to_owned(), json!("item-a")),
                            ("visibility".to_owned(), json!("a-0")),
                        ]),
                        Map::from_iter([
                            ("_id".to_owned(), json!("item-b")),
                            ("visibility".to_owned(), json!("b-0")),
                        ]),
                    ],
                )]),
            })
            .expect("seed rows");
        for ordinal in 1..=2 {
            for id in ["item-a", "item-b"] {
                database
                    .mutation_writes()
                    .commit_buffered_writes(
                        &HandlerInput::default(),
                        vec![BufferedWrite::Patch {
                            table: "items".to_owned(),
                            id: id.to_owned(),
                            values: Map::from_iter([(
                                "visibility".to_owned(),
                                json!(format!("{id}-{ordinal}")),
                            )]),
                        }],
                        Vec::new(),
                        Value::Null,
                    )
                    .expect("patch row");
            }
        }
        let reader = Connection::open(&database_path).expect("open legacy history reader");
        let newest_change_ms: u64 = reader
            .query_row(
                &format!("SELECT MAX(changed_at_ms) FROM {RECORD_HISTORY_TABLE}"),
                [],
                |row| row.get(0),
            )
            .expect("newest retained change");
        assert_eq!(
            database
                .versions_read()
                .prune_record_history(newest_change_ms)
                .expect("prune legacy history"),
            4
        );
        let retained: u64 = reader
            .query_row(
                &format!("SELECT COUNT(*) FROM {RECORD_HISTORY_TABLE}"),
                [],
                |row| row.get(0),
            )
            .expect("legacy retained count");
        assert_eq!(retained, 2, "v1 maxRows remains table-wide");
    }

    fn checkpoint_request(now_ms: u64) -> NamedCheckpointRequestV1 {
        NamedCheckpointRequestV1 {
            label: "before-agent-edit".to_owned(),
            operation_id: format!("operation-v1:{}", Uuid::now_v7()),
            owner: "agent:test".to_owned(),
            location_class: "local-test".to_owned(),
            substrate: CheckpointSubstrateV1::Materialized,
            coverage_manifest_digest: "sha256:coverage".to_owned(),
            now_ms,
            lease_expires_at_ms: now_ms + 60_000,
            max_copy_bytes: 64 * 1024 * 1024,
            max_retained_wal_bytes: 64 * 1024 * 1024,
        }
    }

    fn protected_erasure_request(
        operation_id: &str,
        authority_label: &str,
        row_id: &str,
        now_ms: u64,
    ) -> ProtectedRecordErasureRequestV1 {
        let transition_generation = match authority_label {
            "operator-a" => 7,
            "operator-b" => 8,
            _ => 9,
        };
        let credential_digest_sha256 = format!(
            "sha256:{}",
            hex(&Sha256::digest(authority_label.as_bytes()))
        );
        ProtectedRecordErasureRequestV1 {
            operation_id: operation_id.to_owned(),
            authority: ProtectedRecordErasureAuthorityV1::from_admitted_facts(
                std::sync::Arc::new(()),
                "sessions",
                "operator:admin-bypass",
                "admin-bypass",
                "test",
                transition_generation,
                "master-admin",
                &credential_digest_sha256,
                "test-stream",
            )
            .expect("derive protected-erasure authority"),
            qualified_table: "items".to_owned(),
            row_id: row_id.to_owned(),
            now_ms,
        }
    }

    fn admitted_protected_erasure_request(
        authority: &crate::storage::KernelCommitAuthority,
        operation_id: &str,
        authority_label: &str,
        row_id: &str,
        now_ms: u64,
    ) -> ProtectedRecordErasureRequestV1 {
        let transition_generation = match authority_label {
            "operator-a" => 7,
            "operator-b" => 8,
            _ => 9,
        };
        let credential_digest_sha256 = format!(
            "sha256:{}",
            hex(&Sha256::digest(authority_label.as_bytes()))
        );
        authority
            .admit_protected_record_erasure(
                operation_id.to_owned(),
                "items".to_owned(),
                row_id.to_owned(),
                "sessions",
                "operator:admin-bypass",
                "admin-bypass",
                "test",
                transition_generation,
                "master-admin",
                &credential_digest_sha256,
                "test-stream",
                now_ms,
            )
            .expect("mint database-bound protected-erasure request")
    }

    #[test]
    fn receipt_only_checkpoint_stays_inventory_and_cannot_be_upcast() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("receipt-only.sqlite");
        let mut database = seeded_file_database(&database_path);
        let mut request = checkpoint_request(900);
        request.substrate = CheckpointSubstrateV1::ReceiptOnly;
        let receipt = database
            .checkpoints()
            .create_named_checkpoint(None, &request)
            .expect("create receipt-only checkpoint");
        assert_eq!(receipt.proof_class, ProofClassV1::Inventory);
        assert!(receipt.copied_digest.is_none());
        assert!(receipt.copy_disposition.is_none());
        assert_eq!(receipt.copied_bytes, 0);

        let registry = Connection::open(&database_path).expect("open checkpoint registry");
        let mut forged = registry_record(&registry, &receipt.checkpoint_id)
            .expect("registry lookup")
            .expect("registry record");
        forged.receipt.proof_class = ProofClassV1::IndependentBoundaryProof;
        save_registry_record(&registry, &forged).expect("forge privileged registry bytes");
        assert_eq!(
            database
                .checkpoints_read()
                .inspect_named_checkpoint(&receipt.checkpoint_id, 901)
                .expect_err("receipt-only inventory cannot be upcast")
                .diagnostic
                .code,
            "SNAPBACK_CHECKPOINT_EVIDENCE_MISMATCH"
        );
    }

    #[test]
    fn checkpoint_creation_refuses_missing_schema_identity_before_intent() {
        for missing_hash in [None, Some("   ".to_owned())] {
            let temp = tempfile::tempdir().expect("tempdir");
            let database_path = temp.path().join("source.sqlite");
            let destination = temp.path().join("checkpoint");
            let database = seeded_file_database(&database_path);
            drop(database);
            let conn = Connection::open(&database_path).expect("checkpoint connection");
            let mut missing = schema();
            missing.schema_hash = missing_hash;
            let error = create_named_checkpoint(
                &conn,
                &database_path,
                &missing,
                Some(&destination),
                &checkpoint_request(500),
                None,
            )
            .expect_err("schema identity is proof input");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_CHECKPOINT_SCHEMA_IDENTITY_MISSING"
            );
            let intents: u64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {CHECKPOINT_REGISTRY_TABLE}"),
                    [],
                    |row| row.get(0),
                )
                .expect("registry count");
            assert_eq!(intents, 0);
            assert!(!destination.exists());
        }
    }

    #[test]
    fn materialized_checkpoint_is_dual_path_verified_registry_authoritative_and_erasable() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("source.sqlite");
        let destination = temp.path().join("named-checkpoint");
        let mut database = seeded_file_database(&database_path);
        let receipt = database
            .checkpoints()
            .create_named_checkpoint(Some(&destination), &checkpoint_request(1_000))
            .expect("create checkpoint");
        assert_eq!(receipt.proof_class, ProofClassV1::VerifiedCopyFidelity);
        assert_eq!(receipt.copied_digest.as_ref(), Some(&receipt.source_digest));
        assert!(destination.join(CHECKPOINT_RECEIPT_FILE).is_file());
        assert!(!destination.join(CHECKPOINT_SENTINEL).exists());
        drop(database);

        let mut database = LocalDatabase::open(&database_path).expect("reopen source");
        assert_eq!(
            database
                .checkpoints_read()
                .inspect_named_checkpoint(&receipt.checkpoint_id, 2_000)
                .expect("registry survives reopen"),
            receipt
        );
        let erased = database
            .checkpoints_read()
            .erase_named_checkpoint(&receipt.checkpoint_id, 3_000)
            .expect("erase checkpoint");
        assert_eq!(erased.state, CheckpointRegistryStateV1::Erased);
        assert_eq!(
            erased.receipt.copy_disposition,
            Some(CheckpointCopyDispositionV1::Destroyed)
        );
        assert!(!destination.exists());
        assert_eq!(
            database
                .checkpoints_read()
                .inspect_named_checkpoint(&receipt.checkpoint_id, 3_001)
                .expect_err("registry invalidity outvotes old receipt")
                .diagnostic
                .code,
            "SNAPBACK_CHECKPOINT_INVALID"
        );

        let unreachable_destination = temp.path().join("unreachable-checkpoint");
        let unreachable = database
            .checkpoints()
            .create_named_checkpoint(Some(&unreachable_destination), &checkpoint_request(4_000))
            .expect("create checkpoint for unreachable erasure");
        let registry = Connection::open(&database_path).expect("registry connection");
        let invalid = erase_checkpoint_with(&registry, &unreachable.checkpoint_id, 5_000, |_| {
            Err(std::io::Error::from(ErrorKind::PermissionDenied))
        })
        .expect("registry invalidation survives inaccessible copy");
        assert_eq!(invalid.state, CheckpointRegistryStateV1::Invalid);
        assert!(invalid.open_erasure_obligation);
        assert_eq!(
            invalid.receipt.copy_disposition,
            Some(CheckpointCopyDispositionV1::InvalidUnreachable)
        );
        assert!(unreachable_destination.exists());
        assert_eq!(
            database
                .checkpoints_read()
                .inspect_named_checkpoint(&unreachable.checkpoint_id, 5_001)
                .expect_err("registry invalidity outvotes reachable bytes")
                .diagnostic
                .code,
            "SNAPBACK_CHECKPOINT_INVALID"
        );
        database
            .checkpoints_read()
            .erase_named_checkpoint(&unreachable.checkpoint_id, 6_000)
            .expect("later erasure closes the open obligation");
        assert!(!unreachable_destination.exists());
    }

    #[test]
    fn protected_record_erasure_enumerates_all_copies_and_closes_obligations() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("source.sqlite");
        let first_path = temp.path().join("checkpoint-first");
        let second_path = temp.path().join("checkpoint-second");
        let mut database = seeded_file_database(&database_path);
        let first = database
            .checkpoints()
            .create_named_checkpoint(Some(&first_path), &checkpoint_request(7_000))
            .expect("first checkpoint");
        let mut second_request = checkpoint_request(7_100);
        second_request.operation_id.push_str("-second");
        let second = database
            .checkpoints()
            .create_named_checkpoint(Some(&second_path), &second_request)
            .expect("second checkpoint");
        let mut receipt_only_request = checkpoint_request(7_200);
        receipt_only_request.operation_id.push_str("-receipt-only");
        receipt_only_request.substrate = CheckpointSubstrateV1::ReceiptOnly;
        let receipt_only = database
            .checkpoints()
            .create_named_checkpoint(None, &receipt_only_request)
            .expect("receipt-only checkpoint has no materialized copy");
        let registry = Connection::open(&database_path).expect("open registry");
        registry
            .execute(
                &format!(
                    "INSERT INTO {RECORD_HISTORY_TABLE}(
                       version,table_name,row_id,op,row_json,changed_at_ms,operation_id
                     ) VALUES(1,'items','item-a','update','{{}}',7000,'history-op')"
                ),
                [],
            )
            .expect("retained protected history fixture");

        let denied = second_path.clone();
        let receipt = erase_protected_record_checkpoint_copies_with(
            &registry,
            "items",
            "item-a",
            "protected-erasure-op",
            8_000,
            move |path| {
                if path == denied {
                    Err(std::io::Error::from(ErrorKind::PermissionDenied))
                } else {
                    fs::remove_dir_all(path)
                }
            },
            false,
        )
        .expect("registry invalidation survives an unreachable copy");
        assert_eq!(
            receipt.state,
            ProtectedCheckpointErasureStateV1::OpenObligations
        );
        assert_eq!(
            receipt.copies.len(),
            2,
            "only materialized copies enumerate"
        );
        assert_eq!(
            receipt
                .copies
                .iter()
                .filter(|copy| copy.disposition == CheckpointCopyDispositionV1::Destroyed)
                .count(),
            1
        );
        assert_eq!(
            receipt
                .copies
                .iter()
                .filter(|copy| {
                    copy.disposition == CheckpointCopyDispositionV1::InvalidUnreachable
                })
                .count(),
            1
        );
        assert!(!first_path.exists());
        assert!(second_path.exists());
        assert_eq!(
            registry
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM {RECORD_HISTORY_TABLE} \
                         WHERE table_name='items' AND row_id='item-a'"
                    ),
                    [],
                    |row| row.get::<_, u64>(0),
                )
                .expect("protected history count"),
            0,
            "history erasure commits with checkpoint invalidation"
        );
        database
            .checkpoints_read()
            .inspect_named_checkpoint(&receipt_only.checkpoint_id, 8_001)
            .expect("receipt-only inventory retains no protected copy");
        for checkpoint_id in [&first.checkpoint_id, &second.checkpoint_id] {
            assert_eq!(
                database
                    .checkpoints_read()
                    .inspect_named_checkpoint(checkpoint_id, 8_001)
                    .expect_err("registry invalidity outvotes every local copy")
                    .diagnostic
                    .code,
                "SNAPBACK_CHECKPOINT_INVALID"
            );
        }

        let closed = database
            .checkpoints_read()
            .erase_protected_record_checkpoint_copies(
                "items",
                "item-a",
                "protected-erasure-op",
                9_000,
            )
            .expect("retry closes the reachable obligation");
        assert_eq!(closed.state, ProtectedCheckpointErasureStateV1::Complete);
        assert!(
            closed
                .copies
                .iter()
                .all(|copy| { copy.disposition == CheckpointCopyDispositionV1::Destroyed })
        );
        assert!(!second_path.exists());
        assert_eq!(
            database
                .checkpoints_read()
                .erase_protected_record_checkpoint_copies(
                    "items",
                    "different-row",
                    "protected-erasure-op",
                    9_001,
                )
                .expect_err("operation identity cannot be rebound")
                .diagnostic
                .code,
            "SNAPBACK_CHECKPOINT_ERASURE_IDENTITY_REUSED"
        );
    }

    #[test]
    fn protected_record_erasure_crash_reopens_with_registry_obligation() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("source.sqlite");
        let destination = temp.path().join("checkpoint");
        let mut database = seeded_file_database(&database_path);
        let checkpoint = database
            .checkpoints()
            .create_named_checkpoint(Some(&destination), &checkpoint_request(9_500))
            .expect("checkpoint");
        let registry = Connection::open(&database_path).expect("open registry");
        let error = erase_protected_record_checkpoint_copies_with(
            &registry,
            "items",
            "item-a",
            "protected-erasure-crash-op",
            10_000,
            |path| fs::remove_dir_all(path),
            true,
        )
        .expect_err("inject crash after physical destruction");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CHECKPOINT_ERASURE_TEST_CRASH_CUT"
        );
        assert!(!destination.exists());
        let invalid = registry_record(&registry, &checkpoint.checkpoint_id)
            .expect("registry")
            .expect("record");
        assert_eq!(invalid.state, CheckpointRegistryStateV1::Invalid);
        assert!(invalid.open_erasure_obligation);
        drop(registry);
        drop(database);

        let reopened = LocalDatabase::open(&database_path).expect("reopen after crash");
        let closed = reopened
            .checkpoints_read()
            .erase_protected_record_checkpoint_copies(
                "items",
                "item-a",
                "protected-erasure-crash-op",
                10_001,
            )
            .expect("missing physical bytes close on reopen");
        assert_eq!(closed.state, ProtectedCheckpointErasureStateV1::Complete);
        let reopened_registry = Connection::open(&database_path).expect("reopen registry");
        let erased = registry_record(&reopened_registry, &checkpoint.checkpoint_id)
            .expect("registry")
            .expect("record");
        assert_eq!(erased.state, CheckpointRegistryStateV1::Erased);
        assert!(!erased.open_erasure_obligation);
    }

    #[test]
    fn authenticated_protected_erasure_is_atomic_retry_bound_and_inventory_complete() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("source.sqlite");
        let active_path = temp.path().join("checkpoint-active");
        let expired_path = temp.path().join("checkpoint-expired");
        let mut database = seeded_file_database(&database_path);
        let active = database
            .checkpoints()
            .create_named_checkpoint(Some(&active_path), &checkpoint_request(1_000))
            .expect("active checkpoint");
        let mut expired_request = checkpoint_request(1_100);
        expired_request.operation_id.push_str("-expired");
        expired_request.lease_expires_at_ms = 1_101;
        let expired = database
            .checkpoints()
            .create_named_checkpoint(Some(&expired_path), &expired_request)
            .expect("soon-expired checkpoint");
        let mut receipt_request = checkpoint_request(1_200);
        receipt_request.operation_id.push_str("-receipt");
        receipt_request.substrate = CheckpointSubstrateV1::ReceiptOnly;
        let receipt_only = database
            .checkpoints()
            .create_named_checkpoint(None, &receipt_request)
            .expect("receipt-only inventory");

        let request = protected_erasure_request("erase:item-a", "operator-a", "item-a", 70_000);
        let registry = Connection::open(&database_path).expect("erasure connection");
        let denied = expired_path.clone();
        let open = erase_protected_record_with(
            &registry,
            &schema(),
            &request,
            move |path| {
                if path == denied {
                    Err(std::io::Error::from(ErrorKind::PermissionDenied))
                } else {
                    fs::remove_dir_all(path)
                }
            },
            None,
        )
        .expect("atomic erasure retains unreachable obligation");
        assert_eq!(open.state, ProtectedRecordErasureStateV1::OpenObligations);
        assert_eq!(
            open.copies.len(),
            2,
            "all materialized registry entries bind"
        );
        assert!(!active_path.exists());
        assert!(
            expired_path.exists(),
            "unreachable expired copy stays an obligation"
        );
        let canonical_and_detail: (u64, u64, u64) = registry
            .query_row(
                &format!(
                    "SELECT
                       (SELECT COUNT(*) FROM items WHERE _id='item-a'),
                       (SELECT COUNT(*) FROM _snapback_changes
                         WHERE table_name='items' AND row_id='item-a'),
                       (SELECT COUNT(*) FROM {RECORD_HISTORY_TABLE}
                         WHERE table_name='items' AND row_id='item-a')"
                ),
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("atomic erasure facts");
        assert_eq!(
            canonical_and_detail,
            (0, 1, 0),
            "protected detail is purged while one payload-free delete tombstone remains"
        );
        let tombstone: (String, Option<String>, u64) = registry
            .query_row(
                "SELECT op,row_json,version FROM _snapback_changes
                 WHERE table_name='items' AND row_id='item-a'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("minimal canonical delete tombstone");
        assert_eq!(tombstone.0, "delete");
        assert!(tombstone.1.is_none());
        assert_eq!(tombstone.2, open.canonical_delete_version);
        for (checkpoint_id, expected_state) in [
            (
                active.checkpoint_id.as_str(),
                CheckpointRegistryStateV1::Erased,
            ),
            (
                expired.checkpoint_id.as_str(),
                CheckpointRegistryStateV1::Invalid,
            ),
            (
                receipt_only.checkpoint_id.as_str(),
                CheckpointRegistryStateV1::Invalid,
            ),
        ] {
            assert_eq!(
                registry_record(&registry, checkpoint_id)
                    .expect("registry")
                    .expect("checkpoint")
                    .state,
                expected_state,
                "complete registry inventory is invalidated or physically erased independent of lease/substrate"
            );
        }
        let blocked_destination = temp.path().join("blocked-checkpoint");
        assert_eq!(
            database
                .checkpoints()
                .create_named_checkpoint(Some(&blocked_destination), &checkpoint_request(70_001))
                .expect_err("open erasure fence blocks checkpoint admission")
                .diagnostic
                .code,
            "SNAPBACK_CHECKPOINT_PROTECTED_ERASURE_FENCED"
        );
        let database_authority = database
            .claim_kernel_commit_authority()
            .expect("kernel authority");
        let divergent_authority = admitted_protected_erasure_request(
            &database_authority,
            "erase:item-a",
            "operator-b",
            "item-a",
            70_002,
        );
        assert_eq!(
            database
                .checkpoints_read()
                .erase_protected_record(&divergent_authority)
                .expect_err("authority facts are operation-bound")
                .diagnostic
                .code,
            "SNAPBACK_PROTECTED_ERASURE_IDENTITY_REUSED"
        );

        drop(registry);
        drop(database_authority);
        drop(database);
        let mut reopened = LocalDatabase::open(&database_path).expect("reopen source");
        let reopened_authority = reopened
            .claim_kernel_commit_authority()
            .expect("reopened kernel authority");
        let retry = admitted_protected_erasure_request(
            &reopened_authority,
            "erase:item-a",
            "operator-a",
            "item-a",
            70_003,
        );
        let complete = reopened
            .checkpoints_read()
            .erase_protected_record(&retry)
            .expect("exact retry resumes unreachable copy");
        assert_eq!(complete.erasure_id, open.erasure_id);
        assert_eq!(complete.state, ProtectedRecordErasureStateV1::Complete);
        assert!(!expired_path.exists());
        let replay_reader = Connection::open(&database_path).expect("open stale-client replay");
        let (replay, cutoff) = crate::storage::versioned_changes_to_table_batch(
            &replay_reader,
            "items",
            0,
            complete.canonical_delete_version,
            1_000,
        )
        .expect("decode canonical replay after erasure");
        assert_eq!(cutoff, complete.canonical_delete_version);
        let target_replay = replay
            .iter()
            .filter(|change| change.change.id == "item-a")
            .collect::<Vec<_>>();
        assert_eq!(target_replay.len(), 1);
        assert_eq!(target_replay[0].change.op, crate::storage::ChangeOp::Delete);
        assert!(target_replay[0].change.row.is_none());
        drop(reopened_authority);
        drop(reopened);

        let mut reopened = LocalDatabase::open(&database_path).expect("reopen complete source");
        let after_path = temp.path().join("checkpoint-after-erasure");
        let after = reopened
            .checkpoints()
            .create_named_checkpoint(Some(&after_path), &checkpoint_request(70_004))
            .expect("new checkpoint is admitted after fence completion");
        let copied_database =
            after_path.join(database_path.file_name().expect("database filename"));
        let copied_rows: u64 = Connection::open(copied_database)
            .expect("open post-erasure copy")
            .query_row("SELECT COUNT(*) FROM items WHERE _id='item-a'", [], |row| {
                row.get(0)
            })
            .expect("copied target count");
        assert_eq!(copied_rows, 0, "new copies cannot resurrect erased bytes");
        reopened
            .checkpoints_read()
            .inspect_named_checkpoint(&after.checkpoint_id, 70_005)
            .expect("post-completion checkpoint is usable");
    }

    #[test]
    fn concurrent_protected_erasure_exact_and_divergent_retries_serialize() {
        let exact_temp = tempfile::tempdir().expect("exact-retry tempdir");
        let exact_database_path = exact_temp.path().join("source.sqlite");
        drop(seeded_file_database(&exact_database_path));
        let exact_request =
            protected_erasure_request("erase-concurrent-exact", "operator-a", "item-a", 75_000);
        let exact_barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let exact_receipts = std::thread::scope(|scope| {
            let mut handles = Vec::new();
            for now_ms in [75_000, 75_001] {
                let database_path = exact_database_path.clone();
                let barrier = exact_barrier.clone();
                let mut request = exact_request.clone();
                request.now_ms = now_ms;
                handles.push(scope.spawn(move || {
                    let database = Connection::open(database_path)
                        .expect("open concurrent exact-retry database");
                    barrier.wait();
                    erase_protected_record(&database, &schema(), &request)
                        .expect("concurrent exact retry converges")
                }));
            }
            handles
                .into_iter()
                .map(|handle| handle.join().expect("exact-retry worker"))
                .collect::<Vec<_>>()
        });
        assert_eq!(exact_receipts[0].erasure_id, exact_receipts[1].erasure_id);
        assert_eq!(
            exact_receipts[0].canonical_delete_version,
            exact_receipts[1].canonical_delete_version
        );
        assert!(
            exact_receipts
                .iter()
                .all(|receipt| receipt.state == ProtectedRecordErasureStateV1::Complete)
        );
        let exact_reader = Connection::open(&exact_database_path).expect("inspect exact retry");
        let exact_tombstones: u64 = exact_reader
            .query_row(
                "SELECT COUNT(*) FROM _snapback_changes
                 WHERE table_name='items' AND row_id='item-a'
                   AND op='delete' AND row_json IS NULL",
                [],
                |row| row.get(0),
            )
            .expect("exact retry tombstone count");
        assert_eq!(exact_tombstones, 1, "exact concurrency deletes once");

        let divergent_temp = tempfile::tempdir().expect("divergent-retry tempdir");
        let divergent_database_path = divergent_temp.path().join("source.sqlite");
        let mut divergent_database = seeded_file_database(&divergent_database_path);
        divergent_database
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Insert {
                    table: "items".to_owned(),
                    id: "item-b".to_owned(),
                    values: Map::from_iter([("visibility".to_owned(), json!("private"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("insert second divergent target");
        drop(divergent_database);
        let divergent_requests = [
            protected_erasure_request("erase-concurrent-divergent", "operator-a", "item-a", 76_000),
            protected_erasure_request("erase-concurrent-divergent", "operator-b", "item-b", 76_001),
        ];
        let divergent_barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let divergent_results = std::thread::scope(|scope| {
            let handles = divergent_requests
                .into_iter()
                .map(|request| {
                    let database_path = divergent_database_path.clone();
                    let barrier = divergent_barrier.clone();
                    scope.spawn(move || {
                        let database = Connection::open(database_path)
                            .expect("open concurrent divergent-retry database");
                        barrier.wait();
                        erase_protected_record(&database, &schema(), &request)
                    })
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .map(|handle| handle.join().expect("divergent-retry worker"))
                .collect::<Vec<_>>()
        });
        let winner = divergent_results
            .iter()
            .filter_map(|result| result.as_ref().ok())
            .collect::<Vec<_>>();
        let loser = divergent_results
            .iter()
            .filter_map(|result| result.as_ref().err())
            .collect::<Vec<_>>();
        assert_eq!(winner.len(), 1, "one divergent identity binding wins");
        assert_eq!(loser.len(), 1, "one divergent identity binding refuses");
        assert_eq!(
            loser[0].diagnostic.code,
            "SNAPBACK_PROTECTED_ERASURE_IDENTITY_REUSED"
        );
        let divergent_reader =
            Connection::open(&divergent_database_path).expect("inspect divergent retry");
        let remaining_rows: u64 = divergent_reader
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
            .expect("remaining divergent targets");
        assert_eq!(remaining_rows, 1, "the losing target is not mutated");
        assert_eq!(winner[0].state, ProtectedRecordErasureStateV1::Complete);
    }

    #[test]
    fn protected_erasure_crash_cuts_reopen_to_none_or_resumable_completion() {
        let cuts = [
            ProtectedRecordErasureCutV1::BeforeAtomicCommit,
            ProtectedRecordErasureCutV1::AfterAtomicCommit,
            ProtectedRecordErasureCutV1::AfterFirstPhysicalDestroy,
            ProtectedRecordErasureCutV1::AfterAllPhysicalDestroy,
        ];
        for (index, cut) in cuts.into_iter().enumerate() {
            let temp = tempfile::tempdir().expect("tempdir");
            let database_path = temp.path().join("source.sqlite");
            let destination = temp.path().join("checkpoint");
            let mut database = seeded_file_database(&database_path);
            database
                .checkpoints()
                .create_named_checkpoint(
                    Some(&destination),
                    &checkpoint_request(80_000 + index as u64),
                )
                .expect("checkpoint");
            drop(database);
            let conn = Connection::open(&database_path).expect("erasure connection");
            let request = protected_erasure_request(
                &format!("erase-cut-{index}"),
                "operator-a",
                "item-a",
                81_000 + index as u64,
            );
            let error = erase_protected_record_with(
                &conn,
                &schema(),
                &request,
                |path| fs::remove_dir_all(path),
                Some(cut),
            )
            .expect_err("inject protected erasure cut");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_PROTECTED_ERASURE_TEST_CRASH_CUT"
            );
            let row_present: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM items WHERE _id='item-a')",
                    [],
                    |row| row.get(0),
                )
                .expect("canonical target state");
            if cut == ProtectedRecordErasureCutV1::BeforeAtomicCommit {
                assert!(row_present, "precommit cut rolls every authority back");
                assert!(destination.exists());
                assert!(
                    protected_record_erasure_by_operation(&conn, &request.operation_id)
                        .expect("erasure lookup")
                        .is_none()
                );
            } else {
                assert!(!row_present, "postcommit cuts retain canonical deletion");
                assert_eq!(
                    protected_record_erasure_by_operation(&conn, &request.operation_id)
                        .expect("erasure lookup")
                        .expect("durable fence")
                        .state,
                    ProtectedRecordErasureStateV1::OpenObligations
                );
            }
            drop(conn);
            if cut == ProtectedRecordErasureCutV1::BeforeAtomicCommit {
                continue;
            }
            let mut reopened = LocalDatabase::open(&database_path).expect("reopen after cut");
            let authority = reopened
                .claim_kernel_commit_authority()
                .expect("reopened kernel authority");
            let retry = admitted_protected_erasure_request(
                &authority,
                &format!("erase-cut-{index}"),
                "operator-a",
                "item-a",
                81_100 + index as u64,
            );
            let complete = reopened
                .checkpoints_read()
                .erase_protected_record(&retry)
                .expect("exact retry completes after reopen");
            assert_eq!(complete.state, ProtectedRecordErasureStateV1::Complete);
            assert!(!destination.exists());
        }
    }

    #[test]
    fn checkpoint_pin_and_publication_cannot_cross_protected_erasure() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("source.sqlite");
        let destination = temp.path().join("racing-checkpoint");
        let mut database = seeded_file_database(&database_path);
        let erasure_request =
            protected_erasure_request("erase-racing-checkpoint", "operator-a", "item-a", 90_000);
        let hook_database = database_path.clone();
        let hook_request = erasure_request.clone();
        install_checkpoint_after_pin_hook(move || {
            let conn = Connection::open(&hook_database).expect("concurrent erasure connection");
            let receipt = erase_protected_record_with(
                &conn,
                &schema(),
                &hook_request,
                |_| Err(std::io::Error::from(ErrorKind::PermissionDenied)),
                None,
            )
            .expect("concurrent erasure installs an open fence");
            assert_eq!(
                receipt.state,
                ProtectedRecordErasureStateV1::OpenObligations
            );
        });
        let error = database
            .checkpoints()
            .create_named_checkpoint(Some(&destination), &checkpoint_request(89_000))
            .expect_err("a pre-erasure pin cannot publish across the fence");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CHECKPOINT_PROTECTED_ERASURE_FENCED"
        );
        let authority = database
            .claim_kernel_commit_authority()
            .expect("kernel authority");
        let retry = admitted_protected_erasure_request(
            &authority,
            "erase-racing-checkpoint",
            "operator-a",
            "item-a",
            90_001,
        );
        assert_eq!(
            database
                .checkpoints_read()
                .erase_protected_record(&retry)
                .expect("resume the racing checkpoint obligation")
                .state,
            ProtectedRecordErasureStateV1::Complete
        );
        assert!(!destination.exists());

        let publication_path = temp.path().join("rename-cut-checkpoint");
        let mut after_request = checkpoint_request(90_002);
        after_request.operation_id.push_str("-after");
        database
            .checkpoints()
            .create_named_checkpoint_at_cut_for_test(
                Some(&publication_path),
                &after_request,
                CheckpointPublicationCut::AfterRename,
            )
            .expect_err("pause at publication rename");
        let checkpoint_id: String = Connection::open(&database_path)
            .expect("registry reader")
            .query_row(
                &format!(
                    "SELECT checkpoint_id FROM {CHECKPOINT_REGISTRY_TABLE}
                     WHERE operation_id=?1"
                ),
                [&after_request.operation_id],
                |row| row.get(0),
            )
            .expect("publication intent");
        let second_erasure = admitted_protected_erasure_request(
            &authority,
            "erase-absent-successor",
            "operator-a",
            "missing-after-first-erasure",
            90_003,
        );
        assert_eq!(
            database
                .checkpoints_read()
                .erase_protected_record(&second_erasure)
                .expect_err("novel erasure still requires a present target")
                .diagnostic
                .code,
            "SNAPBACK_PROTECTED_ERASURE_TARGET_NOT_FOUND"
        );
        let recovered = database
            .checkpoints_read()
            .recover_named_checkpoint(&checkpoint_id, 90_004)
            .expect("ordinary rename-cut recovery remains valid after completed erasure");
        assert_eq!(recovered.state, CheckpointRegistryStateV1::Published);
    }

    #[test]
    fn erasure_after_checkpoint_intent_waits_for_creator_cancellation_ack() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("source.sqlite");
        let destination = temp.path().join("intent-race-checkpoint");
        let mut database = seeded_file_database(&database_path);
        let request = checkpoint_request(91_000);
        let erasure = protected_erasure_request(
            "erase-after-checkpoint-intent",
            "operator-a",
            "item-a",
            91_001,
        );
        let hook_database = database_path.clone();
        let hook_erasure = erasure.clone();
        install_checkpoint_after_intent_hook(move || {
            let conn = Connection::open(&hook_database).expect("concurrent erasure connection");
            let open = erase_protected_record_with(
                &conn,
                &schema(),
                &hook_erasure,
                |path| fs::remove_dir_all(path),
                None,
            )
            .expect("erasure commits while the admitted producer is paused");
            assert_eq!(open.state, ProtectedRecordErasureStateV1::OpenObligations);
        });

        let error = database
            .checkpoints()
            .create_named_checkpoint(Some(&destination), &request)
            .expect_err("stale-generation producer cancels");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CHECKPOINT_PROTECTED_ERASURE_FENCED"
        );
        assert!(!destination.exists());
        let conn = Connection::open(&database_path).expect("inspect reconciled race");
        let record = registry_record_by_operation(&conn, &request.operation_id)
            .expect("registry lookup")
            .expect("checkpoint record");
        assert_eq!(record.state, CheckpointRegistryStateV1::Erased);
        assert!(!record.producer_active);
        assert!(!record.open_erasure_obligation);
        assert!(
            std::fs::read_dir(temp.path())
                .expect("list checkpoint parent")
                .filter_map(Result::ok)
                .all(|entry| !entry
                    .file_name()
                    .to_string_lossy()
                    .contains("intent-race-checkpoint.staging")),
            "the stale creator leaves no staging generation"
        );
        let durable = protected_record_erasure_by_operation(&conn, &erasure.operation_id)
            .expect("receipt lookup")
            .expect("durable receipt");
        assert_eq!(durable.state, ProtectedRecordErasureStateV1::Complete);
        drop(conn);
        drop(database);

        let mut reopened = LocalDatabase::open(&database_path).expect("reopen race database");
        let authority = reopened
            .claim_kernel_commit_authority()
            .expect("reopened kernel authority");
        let retry = admitted_protected_erasure_request(
            &authority,
            "erase-after-checkpoint-intent",
            "operator-a",
            "item-a",
            91_011,
        );
        assert_eq!(
            reopened
                .checkpoints_read()
                .erase_protected_record(&retry)
                .expect("exact retry observes completed cancellation")
                .state,
            ProtectedRecordErasureStateV1::Complete
        );
        assert!(!destination.exists());
    }

    #[test]
    fn crashed_checkpoint_producers_require_recovery_ack_before_erasure_closes() {
        for (index, cut) in [
            CheckpointPublicationCut::AfterRegistryIntent,
            CheckpointPublicationCut::AfterCopy,
            CheckpointPublicationCut::AfterRename,
        ]
        .into_iter()
        .enumerate()
        {
            let temp = tempfile::tempdir().expect("tempdir");
            let database_path = temp.path().join("source.sqlite");
            let destination = temp.path().join(format!("crashed-producer-{index}"));
            let mut database = seeded_file_database(&database_path);
            let checkpoint_request = checkpoint_request(92_000 + index as u64);
            database
                .checkpoints()
                .create_named_checkpoint_at_cut_for_test(
                    Some(&destination),
                    &checkpoint_request,
                    cut,
                )
                .expect_err("leave exact producer crash evidence");
            let conn = Connection::open(&database_path).expect("inspect producer intent");
            let record = registry_record_by_operation(&conn, &checkpoint_request.operation_id)
                .expect("registry lookup")
                .expect("checkpoint record");
            assert_eq!(record.state, CheckpointRegistryStateV1::Intent);
            assert!(record.producer_active);
            let checkpoint_id = record.receipt.checkpoint_id.clone();
            let staging = record.staging.clone().map(PathBuf::from);

            let erasure = protected_erasure_request(
                &format!("erase-crashed-producer-{index}"),
                "operator-a",
                "item-a",
                93_000 + index as u64,
            );
            let open = erase_protected_record_with(
                &conn,
                &schema(),
                &erasure,
                |path| fs::remove_dir_all(path),
                None,
            )
            .expect("external sweeper invalidates and destroys visible paths");
            assert_eq!(open.state, ProtectedRecordErasureStateV1::OpenObligations);
            let mut early_retry = erasure.clone();
            early_retry.now_ms += 1;
            assert_eq!(
                erase_protected_record(&conn, &schema(), &early_retry)
                    .expect("exact external retry remains honest")
                    .state,
                ProtectedRecordErasureStateV1::OpenObligations,
                "path absence alone cannot close an in-flight producer"
            );
            drop(conn);
            drop(database);

            let mut reopened =
                LocalDatabase::open(&database_path).expect("reopen after producer crash");
            let recovered = reopened
                .checkpoints_read()
                .recover_named_checkpoint(&checkpoint_id, 94_000 + index as u64)
                .expect("recovery successor destroys stale generation and acknowledges");
            assert_eq!(recovered.state, CheckpointRegistryStateV1::Erased);
            assert!(!recovered.producer_active);
            let authority = reopened
                .claim_kernel_commit_authority()
                .expect("reopened kernel authority");
            let final_retry = admitted_protected_erasure_request(
                &authority,
                &format!("erase-crashed-producer-{index}"),
                "operator-a",
                "item-a",
                93_002 + index as u64,
            );
            assert_eq!(
                reopened
                    .checkpoints_read()
                    .erase_protected_record(&final_retry)
                    .expect("exact retry closes after recovery acknowledgement")
                    .state,
                ProtectedRecordErasureStateV1::Complete
            );
            assert!(!destination.exists());
            if let Some(staging) = staging {
                assert!(!staging.exists());
            }
        }
    }

    #[test]
    fn publication_crash_matrix_recovers_to_absent_or_complete() {
        let cuts = [
            CheckpointPublicationCut::AfterRegistryIntent,
            CheckpointPublicationCut::AfterSentinelSync,
            CheckpointPublicationCut::AfterCopy,
            CheckpointPublicationCut::AfterEvidenceSync,
            CheckpointPublicationCut::AfterRename,
            CheckpointPublicationCut::AfterParentSync,
            CheckpointPublicationCut::AfterRegistryFinalize,
            CheckpointPublicationCut::AfterSentinelRemoval,
        ];
        for (index, cut) in cuts.into_iter().enumerate() {
            let temp = tempfile::tempdir().expect("tempdir");
            let database_path = temp.path().join("source.sqlite");
            let destination = temp.path().join(format!("checkpoint-{index}"));
            let mut database = seeded_file_database(&database_path);
            let error = database
                .checkpoints()
                .create_named_checkpoint_at_cut_for_test(
                    Some(&destination),
                    &checkpoint_request(10_000 + index as u64),
                    cut,
                )
                .expect_err("inject crash cut");
            assert_eq!(error.diagnostic.code, "SNAPBACK_CHECKPOINT_TEST_CRASH_CUT");
            let checkpoint_id: String = Connection::open(&database_path)
                .expect("raw registry connection")
                .query_row(
                    &format!(
                        "SELECT checkpoint_id FROM {CHECKPOINT_REGISTRY_TABLE} ORDER BY rowid DESC LIMIT 1"
                    ),
                    [],
                    |row| row.get(0),
                )
                .expect("intent id");
            let recovered = database
                .checkpoints_read()
                .recover_named_checkpoint(&checkpoint_id, 20_000 + index as u64)
                .expect("recover cut");
            match cut {
                CheckpointPublicationCut::AfterRegistryIntent
                | CheckpointPublicationCut::AfterSentinelSync
                | CheckpointPublicationCut::AfterCopy
                | CheckpointPublicationCut::AfterEvidenceSync => {
                    assert_eq!(recovered.state, CheckpointRegistryStateV1::Aborted);
                    assert!(!destination.exists());
                }
                _ => {
                    assert_eq!(recovered.state, CheckpointRegistryStateV1::Published);
                    assert!(destination.join(CHECKPOINT_RECEIPT_FILE).is_file());
                    assert!(!destination.join(CHECKPOINT_SENTINEL).exists());
                    database
                        .checkpoints_read()
                        .inspect_named_checkpoint(&checkpoint_id, 20_001 + index as u64)
                        .expect("published recovery is usable");
                }
            }
        }
    }

    #[test]
    fn recovery_requires_every_intent_bound_fact_to_match() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("source.sqlite");
        let destination = temp.path().join("checkpoint");
        let mut database = seeded_file_database(&database_path);
        let error = database
            .checkpoints()
            .create_named_checkpoint_at_cut_for_test(
                Some(&destination),
                &checkpoint_request(25_000),
                CheckpointPublicationCut::AfterRename,
            )
            .expect_err("inject post-rename crash");
        assert_eq!(error.diagnostic.code, "SNAPBACK_CHECKPOINT_TEST_CRASH_CUT");
        let registry = Connection::open(&database_path).expect("registry connection");
        let checkpoint_id: String = registry
            .query_row(
                &format!(
                    "SELECT checkpoint_id FROM {CHECKPOINT_REGISTRY_TABLE} ORDER BY rowid DESC LIMIT 1"
                ),
                [],
                |row| row.get(0),
            )
            .expect("checkpoint id");
        let record = registry_record(&registry, &checkpoint_id)
            .expect("registry record")
            .expect("intent record");
        let intent = registry_intent(&registry, &checkpoint_id)
            .expect("registry intent")
            .expect("durable intent");
        let receipt: NamedCheckpointReceiptV1 = serde_json::from_slice(
            &fs::read(destination.join(CHECKPOINT_RECEIPT_FILE)).expect("receipt bytes"),
        )
        .expect("receipt");
        assert!(recovery_evidence_matches_intent(
            &record,
            &intent,
            &destination,
            &receipt
        ));

        for field in [
            "operation",
            "owner",
            "sourceStream",
            "sourceVersion",
            "schema",
            "coverage",
            "lease",
        ] {
            let mut changed = receipt.clone();
            match field {
                "operation" => changed.operation_id.push_str("-forged"),
                "owner" => changed.owner.push_str("-forged"),
                "sourceStream" => changed.source_stream_id.push_str("-forged"),
                "sourceVersion" => changed.source_version += 1,
                "schema" => changed.schema_hash.push_str("-forged"),
                "coverage" => changed.coverage_manifest_digest.push_str("-forged"),
                "lease" => changed.lease_expires_at_ms += 1,
                _ => unreachable!(),
            }
            assert!(
                !recovery_evidence_matches_intent(&record, &intent, &destination, &changed,),
                "{field} must be bound"
            );
        }

        for field in ["destination", "copyBudget", "walBudget"] {
            let mut changed = intent.clone();
            match field {
                "destination" => changed.destination = Some("/tmp/forged".to_owned()),
                "copyBudget" => changed.max_copy_bytes += 1,
                "walBudget" => changed.max_retained_wal_bytes += 1,
                _ => unreachable!(),
            }
            assert_ne!(changed, intent, "{field} must change exact intent bytes");
        }
    }

    #[test]
    fn recovery_rejects_coherently_rewritten_registry_when_disk_intent_is_original() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("source.sqlite");
        let destination = temp.path().join("checkpoint");
        let mut database = seeded_file_database(&database_path);
        database
            .checkpoints()
            .create_named_checkpoint_at_cut_for_test(
                Some(&destination),
                &checkpoint_request(26_000),
                CheckpointPublicationCut::AfterRename,
            )
            .expect_err("inject post-rename crash");
        let registry = Connection::open(&database_path).expect("registry connection");
        let checkpoint_id: String = registry
            .query_row(
                &format!(
                    "SELECT checkpoint_id FROM {CHECKPOINT_REGISTRY_TABLE} ORDER BY rowid DESC LIMIT 1"
                ),
                [],
                |row| row.get(0),
            )
            .expect("checkpoint id");
        let mut record = registry_record(&registry, &checkpoint_id)
            .expect("registry record")
            .expect("intent record");
        let mut intent = registry_intent(&registry, &checkpoint_id)
            .expect("registry intent")
            .expect("durable intent");
        record.receipt.owner = "attacker".to_owned();
        intent.owner = "attacker".to_owned();
        registry
            .execute(
                &format!(
                    "UPDATE {CHECKPOINT_REGISTRY_TABLE}
                     SET record_json=?1,intent_json=?2 WHERE checkpoint_id=?3"
                ),
                params![
                    serde_json::to_string(&record).expect("record JSON"),
                    serde_json::to_string(&intent).expect("intent JSON"),
                    checkpoint_id,
                ],
            )
            .expect("rewrite registry evidence");
        let error = database
            .checkpoints_read()
            .recover_named_checkpoint(&checkpoint_id, 27_000)
            .expect_err("disk intent outvotes coherent registry rewrite");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CHECKPOINT_EVIDENCE_MISMATCH"
        );
        assert_eq!(
            registry_record(&registry, &checkpoint_id)
                .expect("registry record")
                .expect("record")
                .state,
            CheckpointRegistryStateV1::Intent
        );
    }

    #[test]
    fn recovery_rejects_missing_or_forged_copied_database() {
        for attack in ["missing", "forged"] {
            let temp = tempfile::tempdir().expect("tempdir");
            let database_path = temp.path().join("source.sqlite");
            let destination = temp.path().join("checkpoint");
            let mut database = seeded_file_database(&database_path);
            database
                .checkpoints()
                .create_named_checkpoint_at_cut_for_test(
                    Some(&destination),
                    &checkpoint_request(27_500),
                    CheckpointPublicationCut::AfterRename,
                )
                .expect_err("inject post-rename crash");
            let registry = Connection::open(&database_path).expect("registry connection");
            let checkpoint_id: String = registry
                .query_row(
                    &format!(
                        "SELECT checkpoint_id FROM {CHECKPOINT_REGISTRY_TABLE} ORDER BY rowid DESC LIMIT 1"
                    ),
                    [],
                    |row| row.get(0),
                )
                .expect("checkpoint id");
            let intent = registry_intent(&registry, &checkpoint_id)
                .expect("registry intent")
                .expect("durable intent");
            let copied_database = destination.join(&intent.database_file_name);
            match attack {
                "missing" => fs::remove_file(&copied_database).expect("remove copied database"),
                "forged" => {
                    let copied = Connection::open(&copied_database).expect("open copied database");
                    copied
                        .execute(
                            "UPDATE items SET visibility='forged' WHERE _id='item-a'",
                            [],
                        )
                        .expect("forge copied row");
                }
                _ => unreachable!(),
            }
            let error = database
                .checkpoints_read()
                .recover_named_checkpoint(&checkpoint_id, 27_501)
                .expect_err("copy bytes must be independently reverified");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_CHECKPOINT_EVIDENCE_MISMATCH",
                "{attack}"
            );
            assert_eq!(
                registry_record(&registry, &checkpoint_id)
                    .expect("registry record")
                    .expect("record")
                    .state,
                CheckpointRegistryStateV1::Intent
            );
        }
    }

    #[test]
    fn recovery_syncs_parent_before_registry_publication() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("source.sqlite");
        let destination = temp.path().join("checkpoint");
        let parent = destination.parent().expect("destination parent").to_owned();
        let mut database = seeded_file_database(&database_path);
        database
            .checkpoints()
            .create_named_checkpoint_at_cut_for_test(
                Some(&destination),
                &checkpoint_request(28_000),
                CheckpointPublicationCut::AfterRename,
            )
            .expect_err("inject post-rename crash");
        let registry = Connection::open(&database_path).expect("registry connection");
        let checkpoint_id: String = registry
            .query_row(
                &format!(
                    "SELECT checkpoint_id FROM {CHECKPOINT_REGISTRY_TABLE} ORDER BY rowid DESC LIMIT 1"
                ),
                [],
                |row| row.get(0),
            )
            .expect("checkpoint id");
        install_checkpoint_sync_hook(move |path| {
            assert_eq!(path, parent);
            Err(proof_error(
                "SNAPBACK_CHECKPOINT_TEST_PARENT_SYNC_FAILED",
                "injected parent sync failure",
            ))
        });
        let error = database
            .checkpoints_read()
            .recover_named_checkpoint(&checkpoint_id, 29_000)
            .expect_err("publication waits for parent durability");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CHECKPOINT_TEST_PARENT_SYNC_FAILED"
        );
        assert_eq!(
            registry_record(&registry, &checkpoint_id)
                .expect("registry record")
                .expect("record")
                .state,
            CheckpointRegistryStateV1::Intent
        );
        let recovered = database
            .checkpoints_read()
            .recover_named_checkpoint(&checkpoint_id, 29_001)
            .expect("recovery succeeds after durable parent sync");
        assert_eq!(recovered.state, CheckpointRegistryStateV1::Published);
    }

    #[test]
    fn wal_budget_refusal_is_stable_and_reconciles_its_intent() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("source.sqlite");
        let destination = temp.path().join("checkpoint");
        let mut database = seeded_file_database(&database_path);
        database
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "item-a".to_owned(),
                    values: Map::from_iter([("visibility".to_owned(), json!("changed"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("grow WAL");
        let mut request = checkpoint_request(30_000);
        request.max_retained_wal_bytes = 1;
        let error = database
            .checkpoints()
            .create_named_checkpoint(Some(&destination), &request)
            .expect_err("finite WAL budget refuses");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_CHECKPOINT_WAL_BUDGET_EXCEEDED"
        );
        let registry = Connection::open(&database_path).expect("registry connection");
        let record = registry_record_by_operation(&registry, &request.operation_id)
            .expect("registry lookup")
            .expect("refused operation record");
        assert_eq!(record.state, CheckpointRegistryStateV1::Aborted);
        assert!(!destination.exists());
        assert!(
            record
                .staging
                .as_deref()
                .is_none_or(|path| !Path::new(path).exists())
        );
    }

    #[test]
    fn concurrent_writer_advances_while_checkpoint_stays_on_one_pinned_snapshot() {
        let temp = tempfile::tempdir().expect("tempdir");
        let database_path = temp.path().join("source.sqlite");
        let destination = temp.path().join("checkpoint");
        let mut database = seeded_file_database(&database_path);
        database
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "item-a".to_owned(),
                    values: Map::from_iter([("visibility".to_owned(), json!("before"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("writer before checkpoint");
        let pinned_version = database
            .versions_read()
            .current_version()
            .expect("pre-checkpoint head");

        let (go_tx, go_rx) = std::sync::mpsc::sync_channel(0);
        let (done_tx, done_rx) = std::sync::mpsc::sync_channel(0);
        let writer_path = database_path.clone();
        let writer = std::thread::spawn(move || {
            let mut database = LocalDatabase::open(writer_path).expect("open concurrent writer");
            go_rx.recv().expect("checkpoint pinned signal");
            let version = database
                .mutation_writes()
                .commit_buffered_writes(
                    &HandlerInput::default(),
                    vec![BufferedWrite::Patch {
                        table: "items".to_owned(),
                        id: "item-a".to_owned(),
                        values: Map::from_iter([("visibility".to_owned(), json!("during"))]),
                    }],
                    Vec::new(),
                    Value::Null,
                )
                .expect("writer progresses while snapshot is pinned")
                .output
                .version;
            done_tx.send(version).expect("publish concurrent version");
        });
        install_checkpoint_after_pin_hook(move || {
            go_tx.send(()).expect("release concurrent writer");
            assert!(
                done_rx.recv().expect("concurrent writer completion") > pinned_version,
                "writer commits after the pinned head"
            );
        });
        let receipt = database
            .checkpoints()
            .create_named_checkpoint(Some(&destination), &checkpoint_request(40_000))
            .expect("checkpoint succeeds across concurrent writer");
        writer.join().expect("writer thread");
        assert_eq!(receipt.source_version, pinned_version);
        assert_eq!(receipt.proof_class, ProofClassV1::VerifiedCopyFidelity);
        assert_eq!(receipt.copied_digest.as_ref(), Some(&receipt.source_digest));
        assert!(
            database
                .versions_read()
                .current_version()
                .expect("live head")
                > receipt.source_version
        );

        database
            .mutation_writes()
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "item-a".to_owned(),
                    values: Map::from_iter([("visibility".to_owned(), json!("after"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("writer after checkpoint");
        let copied_database = destination.join("source.sqlite");
        let copied_version: u64 = Connection::open(copied_database)
            .expect("open copied image")
            .query_row(
                "SELECT version FROM _snapback_version WHERE id=1",
                [],
                |row| row.get(0),
            )
            .expect("copied head");
        assert_eq!(copied_version, receipt.source_version);
    }
}
