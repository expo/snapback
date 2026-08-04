//! Agent-safe proof domains, bounded row history, and named checkpoints.
//!
//! The types in this module are Rust-owned wire artifacts. Presence of these
//! schemas is deliberately not a capability claim: LLP 0162's corpus and
//! performance rows still gate advertisement.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::SchemaManifest;
use crate::rqs::jcs;
use rusqlite::backup::StepResult;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
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
const HISTORY_POLICY_TABLE: &str = "_snapback_history_policies_v1";
const RECORD_HISTORY_TABLE: &str = "_snapback_record_history_v1";
const CHECKPOINT_SENTINEL: &str = ".snapback-checkpoint-staging.v1";
const CHECKPOINT_RECEIPT_FILE: &str = "checkpoint-receipt.v1.json";
const CHECKPOINT_INTENT_FILE: &str = "checkpoint-intent.v1.json";
pub const CHECKPOINT_MAX_COPY_BYTES: u64 = 64 * 1024 * 1024 * 1024;
pub const CHECKPOINT_MAX_RETAINED_WAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;
pub const CHECKPOINT_MAX_LEASE_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const HISTORY_MAX_RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const HISTORY_MAX_ROWS_PER_TABLE: u64 = 100_000;
pub const HISTORY_PAGE_MAX: u32 = 1_000;

#[cfg(test)]
thread_local! {
    static CHECKPOINT_AFTER_PIN_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(None) };
    static CHECKPOINT_SYNC_HOOK: std::cell::RefCell<
        Option<Box<dyn FnOnce(&Path) -> SnapbackResult<()>>>
    > = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn install_checkpoint_after_pin_hook(hook: impl FnOnce() + 'static) {
    CHECKPOINT_AFTER_PIN_HOOK.with(|slot| {
        assert!(slot.borrow().is_none(), "checkpoint pin hook is one-shot");
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

fn run_checkpoint_after_pin_hook() {
    #[cfg(test)]
    CHECKPOINT_AFTER_PIN_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

#[cfg(test)]
fn install_checkpoint_sync_hook(hook: impl FnOnce(&Path) -> SnapbackResult<()> + 'static) {
    CHECKPOINT_SYNC_HOOK.with(|slot| {
        assert!(slot.borrow().is_none(), "checkpoint sync hook is one-shot");
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

fn run_checkpoint_sync_hook(path: &Path) -> SnapbackResult<()> {
    #[cfg(not(test))]
    let _ = path;
    #[cfg(test)]
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
    pub retain_ms: u64,
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

pub(crate) fn create_infra(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS {CHECKPOINT_REGISTRY_TABLE} (
           checkpoint_id TEXT PRIMARY KEY,
           operation_id TEXT NOT NULL UNIQUE,
           state TEXT NOT NULL,
           record_json TEXT NOT NULL,
           intent_json TEXT,
           updated_at_ms INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS {HISTORY_POLICY_TABLE} (
           table_name TEXT PRIMARY KEY,
           retain_ms INTEGER NOT NULL CHECK(retain_ms > 0),
           max_rows INTEGER NOT NULL CHECK(max_rows > 0)
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
    if !has_intent {
        conn.execute(
            &format!("ALTER TABLE {CHECKPOINT_REGISTRY_TABLE} ADD COLUMN intent_json TEXT"),
            [],
        )?;
    }
    Ok(())
}

/// Mirror a covered application-row journal fact into the independently
/// retained history clock. This function is called only by storage's central
/// `record_change` seam; there is no second application writer.
///
/// @ref LLP 0162#6-bounded-history-and-named-checkpoints — history retention
/// never pins or derives from the sync-resume floor.
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
             WHERE EXISTS(SELECT 1 FROM {HISTORY_POLICY_TABLE} WHERE table_name=?2)"
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

pub(crate) fn prune_record_history(conn: &Connection, now_ms: u64) -> SnapbackResult<u64> {
    crate::manifest::validate_portable_timestamp_millis(now_ms)?;
    let tx = conn.unchecked_transaction()?;
    let mut policies = tx.prepare(&format!(
        "SELECT table_name,retain_ms,max_rows FROM {HISTORY_POLICY_TABLE} ORDER BY table_name"
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
            &format!("SELECT 1 FROM {HISTORY_POLICY_TABLE} WHERE table_name=?1"),
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

fn validate_checkpoint_request(request: &NamedCheckpointRequestV1) -> SnapbackResult<()> {
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

fn checkpoint_recovery_intent(
    checkpoint_id: &str,
    request: &NamedCheckpointRequestV1,
    source_stream_id: &str,
    source_version: u64,
    schema_hash: &str,
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
        destination: destination.map(|path| path.to_string_lossy().into_owned()),
        database_file_name: source_database
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_owned(),
    }
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
        save_registry_record(
            conn,
            &CheckpointRegistryRecordV1 {
                state: CheckpointRegistryStateV1::Published,
                receipt: receipt.clone(),
                destination: None,
                staging: None,
                updated_at_ms: request.now_ms,
                open_erasure_obligation: false,
            },
        )?;
        save_registry_intent(
            conn,
            &checkpoint_recovery_intent(
                &checkpoint_id,
                request,
                &source_stream_id,
                source_version,
                schema_hash,
                None,
                source_database,
            ),
        )?;
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
    save_registry_record(
        conn,
        &CheckpointRegistryRecordV1 {
            state: CheckpointRegistryStateV1::Intent,
            receipt: intent_receipt,
            destination: Some(destination.to_string_lossy().into_owned()),
            staging: Some(staging.to_string_lossy().into_owned()),
            updated_at_ms: request.now_ms,
            open_erasure_obligation: false,
        },
    )?;
    let recovery_intent = checkpoint_recovery_intent(
        &checkpoint_id,
        request,
        &source_stream_id,
        source_version,
        schema_hash,
        Some(destination),
        source_database,
    );
    save_registry_intent(conn, &recovery_intent)?;
    maybe_cut(cut_at, CheckpointPublicationCut::AfterRegistryIntent)?;
    fs::create_dir(&staging).map_err(|error| io_error("create checkpoint staging", error))?;
    File::create(staging.join(CHECKPOINT_SENTINEL))
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error("write checkpoint staging sentinel", error))?;
    sync_directory(&staging)?;
    maybe_cut(cut_at, CheckpointPublicationCut::AfterSentinelSync)?;

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
    fs::rename(&staging, destination)
        .map_err(|error| io_error("publish checkpoint rename", error))?;
    maybe_cut(cut_at, CheckpointPublicationCut::AfterRename)?;
    sync_directory(parent)?;
    maybe_cut(cut_at, CheckpointPublicationCut::AfterParentSync)?;
    let record = CheckpointRegistryRecordV1 {
        state: CheckpointRegistryStateV1::Published,
        receipt: receipt.clone(),
        destination: Some(destination.to_string_lossy().into_owned()),
        staging: None,
        updated_at_ms: request.now_ms,
        open_erasure_obligation: false,
    };
    save_registry_record(conn, &record)?;
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
    let Some(record) = registry_record_by_operation(conn, &request.operation_id)? else {
        return Err(error);
    };
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
                record.state = CheckpointRegistryStateV1::Erased;
                record.open_erasure_obligation = false;
                record.receipt.copy_disposition = Some(CheckpointCopyDispositionV1::Destroyed);
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                record.state = CheckpointRegistryStateV1::Erased;
                record.open_erasure_obligation = false;
                record.receipt.copy_disposition = Some(CheckpointCopyDispositionV1::Destroyed);
            }
            Err(_) => {
                // The registry's invalid state already outvotes local evidence.
                // Preserve the destination and the honest open obligation.
            }
        }
    } else {
        record.state = CheckpointRegistryStateV1::Erased;
    }
    record.updated_at_ms = now_ms;
    save_registry_record(conn, &record)?;
    Ok(record)
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
        record.staging = None;
        record.updated_at_ms = now_ms;
        save_registry_record(conn, &record)?;
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
                asset_sharing: None,
            }],
            ..SchemaManifest::default()
        }
    }

    fn seeded_file_database(path: &Path) -> LocalDatabase {
        let mut database = LocalDatabase::open(path).expect("open database");
        database.apply_schema(schema()).expect("apply schema");
        database
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
        database.apply_schema(schema()).expect("apply schema");
        database
            .configure_history_policy(&HistoryRetentionPolicyV1 {
                table: "items".to_owned(),
                retain_ms: 10_000,
                max_rows: 10,
            })
            .expect("enable history");
        database
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
            .commit_buffered_writes(
                &HandlerInput::default(),
                vec![BufferedWrite::Patch {
                    table: "items".to_owned(),
                    id: "item-a".to_owned(),
                    values: Map::from_iter([("visibility".to_owned(), json!("secret"))]),
                }],
                Vec::new(),
                Value::Null,
            )
            .expect("patch row");
        drop(database);

        let database = LocalDatabase::open(&database_path).expect("reopen database");
        let page = database
            .record_history(
                "items",
                "item-a",
                0,
                10,
                |_| true,
                |post_image| {
                    post_image
                        .and_then(|row| row.get("visibility"))
                        .and_then(Value::as_str)
                        == Some("public")
                },
            )
            .expect("authorized history");
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].disposition, "insert");
        assert_eq!(page.next_visible_offset, None);
        assert!(page.horizon.predecessor_anchor_complete);

        let denied = database
            .record_history("items", "item-a", 0, 10, |_| false, |_| true)
            .expect_err("current authorization gates all history");
        assert_eq!(
            denied.diagnostic.code,
            "SNAPBACK_HISTORY_AUTHORIZATION_DENIED"
        );
        let replay_floor = database.journal_floor_version().expect("replay floor");
        assert_eq!(
            database
                .prune_record_history(9_000_000_000_000_000)
                .expect("prune history"),
            2
        );
        assert_eq!(
            database.journal_floor_version().expect("replay floor"),
            replay_floor,
            "history has an independent retention clock"
        );
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
                .inspect_named_checkpoint(&receipt.checkpoint_id, 2_000)
                .expect("registry survives reopen"),
            receipt
        );
        let erased = database
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
                .inspect_named_checkpoint(&receipt.checkpoint_id, 3_001)
                .expect_err("registry invalidity outvotes old receipt")
                .diagnostic
                .code,
            "SNAPBACK_CHECKPOINT_INVALID"
        );

        let unreachable_destination = temp.path().join("unreachable-checkpoint");
        let unreachable = database
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
                .inspect_named_checkpoint(&unreachable.checkpoint_id, 5_001)
                .expect_err("registry invalidity outvotes reachable bytes")
                .diagnostic
                .code,
            "SNAPBACK_CHECKPOINT_INVALID"
        );
        database
            .erase_named_checkpoint(&unreachable.checkpoint_id, 6_000)
            .expect("later erasure closes the open obligation");
        assert!(!unreachable_destination.exists());
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
        let pinned_version = database.current_version().expect("pre-checkpoint head");

        let (go_tx, go_rx) = std::sync::mpsc::sync_channel(0);
        let (done_tx, done_rx) = std::sync::mpsc::sync_channel(0);
        let writer_path = database_path.clone();
        let writer = std::thread::spawn(move || {
            let mut database = LocalDatabase::open(writer_path).expect("open concurrent writer");
            go_rx.recv().expect("checkpoint pinned signal");
            let version = database
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
            .create_named_checkpoint(Some(&destination), &checkpoint_request(40_000))
            .expect("checkpoint succeeds across concurrent writer");
        writer.join().expect("writer thread");
        assert_eq!(receipt.source_version, pinned_version);
        assert_eq!(receipt.proof_class, ProofClassV1::VerifiedCopyFidelity);
        assert_eq!(receipt.copied_digest.as_ref(), Some(&receipt.source_digest));
        assert!(database.current_version().expect("live head") > receipt.source_version);

        database
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
