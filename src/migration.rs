//! LLP 0081 canonical migration artifacts: the typed plan body, its
//! domain-separated digest and identity, the deterministic planner order and
//! step IDs, the deterministic synthesized-row UUIDv7 namespace, and the
//! preview-observation / approval / admission record types.
//!
//! This module is the Wave 1 foundation of the Phase C (full 0081) lane:
//! **types, canonicalization, digests, and validation only**. Barrier
//! enforcement, the durable executor, and the `snapback migrate` CLI consume
//! these types in later waves and live elsewhere.
//!
//! @ref LLP 0081#2-canonical-plan-and-approval — the serialized authority is
//!   `MigrationPlanArtifactV1 { body, planDigest, planId }`; the body
//!   serializes under the corpus RFC 8785 rule; the digest preimage is the
//!   domain prefix, one `\n`, and the JCS body bytes — nothing else; the
//!   outer fields never appear inside `body`.
//! @ref LLP 0081#3-typed-migration-steps — the closed v1 step set, the
//!   closed backfill expression vocabulary over the source row plus explicit
//!   plan constants, and the deterministic UUIDv7 ID namespace.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{FieldType, SchemaManifest, ValueExpr};

/// ASCII digest-preimage prefix for the canonical plan body (LLP 0081 §2).
pub const MIGRATION_PLAN_DIGEST_PREFIX: &str = "snapback:migration-plan:v1";
/// Preview observations are separately digested under the same encoding
/// (LLP 0081 §2); the distinct prefix is the domain separation.
pub const MIGRATION_OBSERVATION_DIGEST_PREFIX: &str = "snapback:migration-observation:v1";
/// Approval and admission records carry their own digest domains so a
/// receipt can bind them without any cross-record ambiguity.
pub const MIGRATION_APPROVAL_DIGEST_PREFIX: &str = "snapback:migration-approval:v1";
pub const MIGRATION_ADMISSION_DIGEST_PREFIX: &str = "snapback:migration-admission:v1";
/// Domain tag for the synthesized-row-ID hash (LLP 0081 §3).
const MIGRATION_ID_TAG: &[u8] = b"snapback-migration-id-v1\0";

/// The 48-bit UUIDv7 millisecond ceiling (LLP 0081 §3: plan validation
/// refuses a `publicationTimestamp` outside this range even though LLP 0007's
/// timestamp domain is wider).
pub const MIGRATION_TIMESTAMP_MAX_EXCLUSIVE: u64 = 1 << 48;

fn plan_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MIGRATION_PLAN_INVALID",
        "migration",
        message.into(),
    )
}

// ---------------------------------------------------------------------------
// Closed typed steps (LLP 0081 §3)
// ---------------------------------------------------------------------------

/// The closed v1 migration step set. Raw SQL, callbacks, shell commands, and
/// target-specific blocks are portability opt-outs and have no variant here.
/// A rename or type change is represented as add/copy/validate/publish/retire,
/// never an in-place cast.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum MigrationStep {
    CreateTable {
        table: String,
    },
    CreateIndex {
        table: String,
        index: String,
        fields: Vec<String>,
    },
    /// Add a field with a portable literal or closed backfill expression as
    /// its value for existing rows (absent expression = optional field
    /// starts absent).
    AddField {
        table: String,
        field: String,
        #[serde(rename = "fieldType")]
        field_type: FieldType,
        optional: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        backfill: Option<ValueExpr>,
    },
    /// Backfill into a new destination from the closed expression vocabulary
    /// over the source row plus plan constants. The local v1 proof/rollback
    /// profile refuses predecessor columns, including nullable ones.
    BackfillField {
        table: String,
        field: String,
        expr: ValueExpr,
    },
    ValidateRequired {
        table: String,
        field: String,
    },
    MakeRequired {
        table: String,
        field: String,
    },
    ValidateUnique {
        table: String,
        fields: Vec<String>,
    },
    CreateUniqueIndex {
        table: String,
        index: String,
        fields: Vec<String>,
    },
    /// Copy a field into successor storage; the destination is the qualified
    /// target for planner ordering.
    CopyField {
        #[serde(rename = "sourceTable")]
        source_table: String,
        #[serde(rename = "sourceField")]
        source_field: String,
        table: String,
        field: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expr: Option<ValueExpr>,
    },
    /// Copy a table into a staged successor generation. Entries in `fields`
    /// are closed transforms over the source row plus constants; successor
    /// fields omitted from the map carry their same-name predecessor value.
    CopyTable {
        #[serde(rename = "sourceTable")]
        source_table: String,
        table: String,
        generation: u64,
        fields: BTreeMap<String, ValueExpr>,
    },
    StageTableGeneration {
        table: String,
        generation: u64,
    },
    /// LLP 0080 §5 shadow rebuild; row identity follows that RFC's
    /// stored-identity rule, never this module's synthesized namespace.
    RebuildMaintainedProjection {
        #[serde(rename = "projectionId")]
        projection_id: String,
    },
    /// Logical retirement; physical cleanup is separately fenced after the
    /// rollback window.
    RetireField {
        table: String,
        field: String,
    },
    RetireTable {
        table: String,
    },
    RetireGeneration {
        table: String,
        generation: u64,
    },
}

impl MigrationStep {
    /// The canonical step-type token used in step IDs — exactly the variant
    /// name.
    pub fn step_type(&self) -> &'static str {
        match self {
            Self::CreateTable { .. } => "CreateTable",
            Self::CreateIndex { .. } => "CreateIndex",
            Self::AddField { .. } => "AddField",
            Self::BackfillField { .. } => "BackfillField",
            Self::ValidateRequired { .. } => "ValidateRequired",
            Self::MakeRequired { .. } => "MakeRequired",
            Self::ValidateUnique { .. } => "ValidateUnique",
            Self::CreateUniqueIndex { .. } => "CreateUniqueIndex",
            Self::CopyField { .. } => "CopyField",
            Self::CopyTable { .. } => "CopyTable",
            Self::StageTableGeneration { .. } => "StageTableGeneration",
            Self::RebuildMaintainedProjection { .. } => "RebuildMaintainedProjection",
            Self::RetireField { .. } => "RetireField",
            Self::RetireTable { .. } => "RetireTable",
            Self::RetireGeneration { .. } => "RetireGeneration",
        }
    }

    /// The qualified target used in step IDs and planner ordering. Pinned
    /// forms: `table`, `table.field`, `table#index`, `table@g<generation>`,
    /// and `projection:<planId>`. For cross-storage copies the target is the
    /// **destination** — the thing the step brings into existence.
    pub fn qualified_target(&self) -> String {
        match self {
            Self::CreateTable { table } | Self::RetireTable { table } => table.clone(),
            Self::CreateIndex { table, index, .. }
            | Self::CreateUniqueIndex { table, index, .. } => format!("{table}#{index}"),
            Self::AddField { table, field, .. }
            | Self::BackfillField { table, field, .. }
            | Self::ValidateRequired { table, field }
            | Self::MakeRequired { table, field }
            | Self::CopyField { table, field, .. }
            | Self::RetireField { table, field } => format!("{table}.{field}"),
            Self::ValidateUnique { table, fields } => {
                format!("{table}#unique({})", fields.join(","))
            }
            Self::CopyTable {
                table, generation, ..
            }
            | Self::StageTableGeneration { table, generation }
            | Self::RetireGeneration { table, generation } => {
                format!("{table}@g{generation}")
            }
            Self::RebuildMaintainedProjection { projection_id } => {
                format!("projection:{projection_id}")
            }
        }
    }

    /// The table this step anchors to for planner ordering (the qualified
    /// target's table).
    pub fn anchor_table(&self) -> &str {
        match self {
            Self::CreateTable { table }
            | Self::CreateIndex { table, .. }
            | Self::AddField { table, .. }
            | Self::BackfillField { table, .. }
            | Self::ValidateRequired { table, .. }
            | Self::MakeRequired { table, .. }
            | Self::ValidateUnique { table, .. }
            | Self::CreateUniqueIndex { table, .. }
            | Self::CopyField { table, .. }
            | Self::CopyTable { table, .. }
            | Self::StageTableGeneration { table, .. }
            | Self::RetireField { table, .. }
            | Self::RetireTable { table }
            | Self::RetireGeneration { table, .. } => table,
            Self::RebuildMaintainedProjection { projection_id } => projection_id,
        }
    }

    /// Tables this step writes (used by the authority-bearing refusal).
    fn written_tables(&self) -> Vec<&str> {
        match self {
            Self::CreateTable { table }
            | Self::CreateIndex { table, .. }
            | Self::AddField { table, .. }
            | Self::BackfillField { table, .. }
            | Self::MakeRequired { table, .. }
            | Self::CreateUniqueIndex { table, .. }
            | Self::CopyField { table, .. }
            | Self::CopyTable { table, .. }
            | Self::StageTableGeneration { table, .. }
            | Self::RetireField { table, .. }
            | Self::RetireTable { table }
            | Self::RetireGeneration { table, .. } => vec![table],
            Self::ValidateRequired { .. }
            | Self::ValidateUnique { .. }
            | Self::RebuildMaintainedProjection { .. } => Vec::new(),
        }
    }

    fn backfill_exprs(&self) -> Vec<&ValueExpr> {
        match self {
            Self::AddField { backfill, .. } => backfill.iter().collect(),
            Self::BackfillField { expr, .. } => vec![expr],
            Self::CopyField { expr, .. } => expr.iter().collect(),
            Self::CopyTable { fields, .. } => fields.values().collect(),
            _ => Vec::new(),
        }
    }
}

/// The canonical step ID (LLP 0081 §2): `s<ordinal>:<stepType>:<target>`,
/// 1-based ordinal over the plan's pinned normative order.
pub fn canonical_step_id(ordinal: usize, step: &MigrationStep) -> String {
    format!(
        "s{ordinal}:{}:{}",
        step.step_type(),
        step.qualified_target()
    )
}

// ---------------------------------------------------------------------------
// Plan body, ceilings, proof, postures (LLP 0081 §2, §5, §6)
// ---------------------------------------------------------------------------

/// The v1-admitted per-step precondition vocabulary of this slice. Closed
/// and deliberately small; later waves widen it by version, never by
/// loosening.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum MigrationPrecondition {
    /// The step's affected-row estimate must not exceed `max` at barrier
    /// time (re-proven under the barrier; drift refuses).
    MaxAffectedRows { table: String, max: u64 },
    /// Every source value must be convertible by the declared expression —
    /// the bounded preflight for narrowing conversions (LLP 0081 §3).
    TotalConversion { table: String, field: String },
    /// The destination table holds no rows.
    TableEmpty { table: String },
}

/// The v1-admitted per-step verification vocabulary of this slice.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum MigrationVerification {
    /// Destination row count equals the source table's count.
    RowCountMatchesSource {
        #[serde(rename = "sourceTable")]
        source_table: String,
        table: String,
    },
    /// The step's table participates in the final `ContentDigestV1` proof.
    ContentDigest { table: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationStepBounds {
    #[serde(rename = "maxRows")]
    pub max_rows: u64,
    #[serde(rename = "maxBytes")]
    pub max_bytes: u64,
}

/// One planned step with its LLP 0081 §2 per-step facts.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationStepRecord {
    pub id: String,
    pub step: MigrationStep,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preconditions: Vec<MigrationPrecondition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reads: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub writes: Vec<String>,
    pub bounds: MigrationStepBounds,
    pub reversible: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub verification: Vec<MigrationVerification>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum MigrationExecutionStrategy {
    #[serde(rename = "single-transaction")]
    SingleTransaction,
    #[serde(rename = "shadow-generation")]
    ShadowGeneration,
}

/// Strategy is a property of the sealed step graph, never a CLI default.
/// Any staged-generation operation must remain off the in-place executor.
pub fn execution_strategy_for_steps(steps: &[MigrationStepRecord]) -> MigrationExecutionStrategy {
    if steps.iter().any(|record| {
        matches!(
            &record.step,
            MigrationStep::StageTableGeneration { .. }
                | MigrationStep::CopyTable { .. }
                | MigrationStep::RetireGeneration { .. }
        )
    }) {
        MigrationExecutionStrategy::ShadowGeneration
    } else {
        MigrationExecutionStrategy::SingleTransaction
    }
}

/// Proof method (LLP 0081 §5): `full` is the only method admissible for a
/// successful v1 production migration; `sampled-audit` is a separately named
/// lower-assurance class for rehearsal/audit runs and says so on its face.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum MigrationProofMethod {
    #[serde(rename = "full")]
    Full,
    #[serde(rename = "sampled-audit")]
    SampledAudit,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationProof {
    pub method: MigrationProofMethod,
    /// Sample bound for `sampled-audit`; absent for `full`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bound: Option<u64>,
}

/// Approval-relevant resource ceilings — canonical body fields and
/// barrier-time admission preconditions (LLP 0081 §2).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationCeilings {
    #[serde(rename = "maxAffectedRows")]
    pub max_affected_rows: u64,
    #[serde(rename = "maxBytes")]
    pub max_bytes: u64,
    #[serde(rename = "maxWrites")]
    pub max_writes: u64,
    #[serde(rename = "maxBarrierDowntimeMs")]
    pub max_barrier_downtime_ms: u64,
}

/// Compatibility posture (LLP 0081 §6). The default is `successor-only`.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CompatibilityPosture {
    #[serde(rename = "successor-only")]
    SuccessorOnly,
    #[serde(rename = "dual-compatible")]
    DualCompatible,
    #[serde(rename = "predeploy-compatible")]
    PredeployCompatible,
}

/// Retained-work posture (LLP 0081 §6). `transformed` is representable so
/// its refusal is typed, but v1 validation refuses it as unsupported.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum RetainedWorkPosture {
    #[serde(rename = "empty")]
    Empty,
    #[serde(rename = "dual-compatible")]
    DualCompatible,
    #[serde(rename = "transformed")]
    Transformed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationBackupRequirement {
    pub required: bool,
    #[serde(
        default,
        rename = "checkpointLabel",
        skip_serializing_if = "Option::is_none"
    )]
    pub checkpoint_label: Option<String>,
    /// LLP 0081 §7: the target profile names when a restore-derived
    /// rehearsal must precede production apply. Stamped by preview from
    /// profile policy into the canonical body, so the approver reviewed
    /// the requirement. Skip-if-false keeps pre-rehearsal plan digests
    /// byte-identical.
    #[serde(
        default,
        rename = "rehearsalRequired",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub rehearsal_required: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationExpectedOutput {
    /// Expected successor schema hash.
    #[serde(rename = "schemaHash")]
    pub schema_hash: String,
    /// Expected maintained-projection generation hashes by plan id.
    #[serde(
        default,
        rename = "projectionGenerations",
        skip_serializing_if = "BTreeMap::is_empty"
    )]
    pub projection_generations: BTreeMap<String, String>,
}

/// The complete explicit constants object (LLP 0081 §2): migration constants
/// are inputs, not ambient values; apply creates none.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationConstants {
    /// The approved publication timestamp; carries the 48 UUIDv7 time bits
    /// of every synthesized ID. Validation refuses values at or above
    /// `2^48` ms with `SNAPBACK_MIGRATION_PLAN_INVALID`.
    #[serde(rename = "publicationTimestampMs")]
    pub publication_timestamp_ms: u64,
    /// The explicit rollback timestamp (LLP 0081 §6): required to execute
    /// the fast rollback; admission requires it to be at least
    /// `publicationTimestampMs` (and the restamp maximum), the same
    /// monotonicity rule as forward publication. Absent bytes keep older
    /// plan digests stable.
    #[serde(
        default,
        rename = "rollbackTimestampMs",
        skip_serializing_if = "Option::is_none"
    )]
    pub rollback_timestamp_ms: Option<u64>,
    /// Named literal constants backfill expressions may read via `Arg`.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub values: BTreeMap<String, Value>,
}

/// Cleanup and rollback boundaries as step-ID references (LLP 0081 §2).
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationBoundaries {
    /// Last step still inside the rollback window; absent = the whole plan.
    #[serde(
        default,
        rename = "rollbackBoundaryStep",
        skip_serializing_if = "Option::is_none"
    )]
    pub rollback_boundary_step: Option<String>,
    /// First step of the separately fenced physical-cleanup tail.
    #[serde(
        default,
        rename = "cleanupFromStep",
        skip_serializing_if = "Option::is_none"
    )]
    pub cleanup_from_step: Option<String>,
}

/// The canonical plan body. Everything approval-relevant lives here, inside
/// the digest; target observations that do not authorize execution live in
/// the separately digested [`MigrationPreviewObservationV1`].
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationPlanBody {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    pub app: String,
    pub instance: String,
    #[serde(rename = "targetProfileId")]
    pub target_profile_id: String,
    #[serde(rename = "predecessorSchemaHash")]
    pub predecessor_schema_hash: String,
    #[serde(rename = "successorSchemaHash")]
    pub successor_schema_hash: String,
    #[serde(rename = "predecessorGeneration")]
    pub predecessor_generation: u64,
    pub steps: Vec<MigrationStepRecord>,
    #[serde(rename = "executionStrategy")]
    pub execution_strategy: MigrationExecutionStrategy,
    pub proof: MigrationProof,
    pub ceilings: MigrationCeilings,
    #[serde(rename = "compatibilityPosture")]
    pub compatibility_posture: CompatibilityPosture,
    #[serde(rename = "retainedWorkPosture")]
    pub retained_work_posture: RetainedWorkPosture,
    pub backup: MigrationBackupRequirement,
    #[serde(rename = "expectedOutput")]
    pub expected_output: MigrationExpectedOutput,
    pub constants: MigrationConstants,
    #[serde(default)]
    pub boundaries: MigrationBoundaries,
}

pub const MIGRATION_PLAN_SCHEMA_VERSION: &str = "migration-plan-v1";

/// The serialized plan authority (LLP 0081 §2). The outer fields are
/// recomputed from `body` at validation; they never appear inside it.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationPlanArtifactV1 {
    pub body: MigrationPlanBody,
    #[serde(rename = "planDigest")]
    pub plan_digest: String,
    #[serde(rename = "planId")]
    pub plan_id: String,
}

fn prefixed_digest(prefix: &str, body: &Value) -> SnapbackResult<String> {
    let jcs = crate::rqs_contract::jcs(body)
        .map_err(|_| plan_invalid("canonical body bytes are not canonicalizable"))?;
    let mut hash = Sha256::new();
    hash.update(prefix.as_bytes());
    hash.update(b"\n");
    hash.update(jcs.as_bytes());
    let digest = hash.finalize();
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// `planDigest`: SHA-256 over exactly the ASCII prefix, one `\n`, and the
/// JCS body bytes, rendered as 64 lowercase hex characters. Pinned
/// representation decision: the digest field carries **bare hex** (no
/// `sha256:` prefix) so `planId = migration-v1:<planDigest>` reads as one
/// identity token; the golden vectors freeze this.
pub fn plan_digest(body: &MigrationPlanBody) -> SnapbackResult<String> {
    let value =
        serde_json::to_value(body).map_err(|_| plan_invalid("plan body does not serialize"))?;
    prefixed_digest(MIGRATION_PLAN_DIGEST_PREFIX, &value)
}

pub fn plan_id(plan_digest: &str) -> String {
    format!("migration-v1:{plan_digest}")
}

impl MigrationPlanArtifactV1 {
    /// Seal a body into the serialized authority.
    pub fn seal(body: MigrationPlanBody) -> SnapbackResult<Self> {
        let digest = plan_digest(&body)?;
        let id = plan_id(&digest);
        Ok(Self {
            body,
            plan_digest: digest,
            plan_id: id,
        })
    }
}

// ---------------------------------------------------------------------------
// Deterministic planner (LLP 0081 §2)
// ---------------------------------------------------------------------------

/// The closed intent vocabulary this slice's deterministic planner admits.
/// Each intent expands to its pinned dependency chain in required sequence
/// (validate before tighten, copy before retire). The full intent language —
/// diffing two schema manifests into intents — is a later-wave consumer of
/// this planner, not a loosening of it.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum MigrationIntent {
    CreateTable {
        table: String,
    },
    CreateIndex {
        table: String,
        index: String,
        fields: Vec<String>,
        unique: bool,
    },
    AddOptionalField {
        table: String,
        field: String,
        #[serde(rename = "fieldType")]
        field_type: FieldType,
    },
    /// Add + backfill + validate + tighten, in that required sequence.
    AddRequiredField {
        table: String,
        field: String,
        #[serde(rename = "fieldType")]
        field_type: FieldType,
        backfill: ValueExpr,
    },
    /// Validate before tighten.
    TightenRequired {
        table: String,
        field: String,
    },
    /// Add destination, copy, validate, tighten, then retire the source —
    /// LLP 0081 §3's rename representation.
    RenameField {
        table: String,
        from: String,
        to: String,
        #[serde(rename = "fieldType")]
        field_type: FieldType,
    },
    /// Rename with a conversion expression (type change).
    ConvertField {
        table: String,
        from: String,
        to: String,
        #[serde(rename = "fieldType")]
        field_type: FieldType,
        expr: ValueExpr,
    },
    /// Revalidate and canonically rewrite one same-name Json field while a
    /// complete successor table generation is staged. The planner derives
    /// only the named field transform; unaffected successor fields use
    /// `CopyTable`'s same-name carry semantics.
    ConvertJsonToStructured {
        table: String,
        field: String,
        generation: u64,
    },
    /// Stage a successor generation and copy the table into it.
    CopyTableToGeneration {
        table: String,
        generation: u64,
        fields: BTreeMap<String, ValueExpr>,
        #[serde(rename = "sourceTable")]
        source_table: String,
    },
    RebuildProjection {
        #[serde(rename = "projectionId")]
        projection_id: String,
    },
    RetireField {
        table: String,
        field: String,
    },
    RetireTable {
        table: String,
    },
    RetireGeneration {
        table: String,
        generation: u64,
    },
}

impl MigrationIntent {
    fn anchor_table(&self) -> &str {
        match self {
            Self::CreateTable { table }
            | Self::CreateIndex { table, .. }
            | Self::AddOptionalField { table, .. }
            | Self::AddRequiredField { table, .. }
            | Self::TightenRequired { table, .. }
            | Self::RenameField { table, .. }
            | Self::ConvertField { table, .. }
            | Self::ConvertJsonToStructured { table, .. }
            | Self::CopyTableToGeneration { table, .. }
            | Self::RetireField { table, .. }
            | Self::RetireTable { table }
            | Self::RetireGeneration { table, .. } => table,
            Self::RebuildProjection { projection_id } => projection_id,
        }
    }

    /// The intent's dependency chain, in its required sequence.
    fn chain(&self) -> Vec<MigrationStep> {
        match self {
            Self::CreateTable { table } => vec![MigrationStep::CreateTable {
                table: table.clone(),
            }],
            Self::CreateIndex {
                table,
                index,
                fields,
                unique,
            } => {
                if *unique {
                    vec![
                        MigrationStep::ValidateUnique {
                            table: table.clone(),
                            fields: fields.clone(),
                        },
                        MigrationStep::CreateUniqueIndex {
                            table: table.clone(),
                            index: index.clone(),
                            fields: fields.clone(),
                        },
                    ]
                } else {
                    vec![MigrationStep::CreateIndex {
                        table: table.clone(),
                        index: index.clone(),
                        fields: fields.clone(),
                    }]
                }
            }
            Self::AddOptionalField {
                table,
                field,
                field_type,
            } => vec![MigrationStep::AddField {
                table: table.clone(),
                field: field.clone(),
                field_type: field_type.clone(),
                optional: true,
                backfill: None,
            }],
            Self::AddRequiredField {
                table,
                field,
                field_type,
                backfill,
            } => vec![
                MigrationStep::AddField {
                    table: table.clone(),
                    field: field.clone(),
                    field_type: field_type.clone(),
                    optional: true,
                    backfill: None,
                },
                MigrationStep::BackfillField {
                    table: table.clone(),
                    field: field.clone(),
                    expr: backfill.clone(),
                },
                MigrationStep::ValidateRequired {
                    table: table.clone(),
                    field: field.clone(),
                },
                MigrationStep::MakeRequired {
                    table: table.clone(),
                    field: field.clone(),
                },
            ],
            Self::TightenRequired { table, field } => vec![
                MigrationStep::ValidateRequired {
                    table: table.clone(),
                    field: field.clone(),
                },
                MigrationStep::MakeRequired {
                    table: table.clone(),
                    field: field.clone(),
                },
            ],
            Self::RenameField {
                table,
                from,
                to,
                field_type,
            } => vec![
                MigrationStep::AddField {
                    table: table.clone(),
                    field: to.clone(),
                    field_type: field_type.clone(),
                    optional: true,
                    backfill: None,
                },
                MigrationStep::CopyField {
                    source_table: table.clone(),
                    source_field: from.clone(),
                    table: table.clone(),
                    field: to.clone(),
                    expr: None,
                },
                MigrationStep::ValidateRequired {
                    table: table.clone(),
                    field: to.clone(),
                },
                MigrationStep::MakeRequired {
                    table: table.clone(),
                    field: to.clone(),
                },
                MigrationStep::RetireField {
                    table: table.clone(),
                    field: from.clone(),
                },
            ],
            Self::ConvertField {
                table,
                from,
                to,
                field_type,
                expr,
            } => vec![
                MigrationStep::AddField {
                    table: table.clone(),
                    field: to.clone(),
                    field_type: field_type.clone(),
                    optional: true,
                    backfill: None,
                },
                MigrationStep::CopyField {
                    source_table: table.clone(),
                    source_field: from.clone(),
                    table: table.clone(),
                    field: to.clone(),
                    expr: Some(expr.clone()),
                },
                MigrationStep::ValidateRequired {
                    table: table.clone(),
                    field: to.clone(),
                },
                MigrationStep::MakeRequired {
                    table: table.clone(),
                    field: to.clone(),
                },
                MigrationStep::RetireField {
                    table: table.clone(),
                    field: from.clone(),
                },
            ],
            Self::ConvertJsonToStructured {
                table, generation, ..
            } => vec![
                MigrationStep::StageTableGeneration {
                    table: table.clone(),
                    generation: *generation,
                },
                // `derive_plan_steps` replaces this empty map with the one
                // exact named-field transform after validating both sides of
                // the Json-to-Structured transition.
                MigrationStep::CopyTable {
                    source_table: table.clone(),
                    table: table.clone(),
                    generation: *generation,
                    fields: BTreeMap::new(),
                },
            ],
            Self::CopyTableToGeneration {
                table,
                generation,
                fields,
                source_table,
            } => vec![
                MigrationStep::StageTableGeneration {
                    table: table.clone(),
                    generation: *generation,
                },
                MigrationStep::CopyTable {
                    source_table: source_table.clone(),
                    table: table.clone(),
                    generation: *generation,
                    fields: fields.clone(),
                },
            ],
            Self::RebuildProjection { projection_id } => {
                vec![MigrationStep::RebuildMaintainedProjection {
                    projection_id: projection_id.clone(),
                }]
            }
            Self::RetireField { table, field } => vec![MigrationStep::RetireField {
                table: table.clone(),
                field: field.clone(),
            }],
            Self::RetireTable { table } => vec![MigrationStep::RetireTable {
                table: table.clone(),
            }],
            Self::RetireGeneration { table, generation } => {
                vec![MigrationStep::RetireGeneration {
                    table: table.clone(),
                    generation: *generation,
                }]
            }
        }
    }
}

fn default_step_record(ordinal: usize, step: MigrationStep) -> MigrationStepRecord {
    let reversible = matches!(
        step,
        MigrationStep::CreateTable { .. }
            | MigrationStep::CreateIndex { .. }
            | MigrationStep::AddField { .. }
            | MigrationStep::ValidateRequired { .. }
            | MigrationStep::ValidateUnique { .. }
            | MigrationStep::CreateUniqueIndex { .. }
            | MigrationStep::StageTableGeneration { .. }
    );
    let reads: Vec<String> = match &step {
        MigrationStep::CopyField { source_table, .. }
        | MigrationStep::CopyTable { source_table, .. } => vec![source_table.clone()],
        MigrationStep::BackfillField { table, .. }
        | MigrationStep::ValidateRequired { table, .. }
        | MigrationStep::ValidateUnique { table, .. } => vec![table.clone()],
        MigrationStep::RebuildMaintainedProjection { .. } => Vec::new(),
        _ => Vec::new(),
    };
    let writes: Vec<String> = step
        .written_tables()
        .into_iter()
        .map(str::to_owned)
        .collect();
    let id = canonical_step_id(ordinal, &step);
    MigrationStepRecord {
        id,
        step,
        preconditions: Vec::new(),
        reads,
        writes,
        bounds: MigrationStepBounds {
            max_rows: 0,
            max_bytes: 0,
        },
        reversible,
        verification: Vec::new(),
    }
}

/// The deterministic planner (LLP 0081 §2): walk successor-schema tables in
/// Derive the closed `MigrationIntent` set from a predecessor/successor
/// `SchemaManifest` pair (LLP 0081 §2 preview). The derivation is total
/// over unambiguous, semantics-free diffs and **refuses** everything else
/// with `SNAPBACK_MIGRATION_PLAN_INVALID`, naming the explicit intent the
/// operator must declare — a diff cannot invent a backfill expression,
/// distinguish a rename from an unrelated retire-plus-add, or pick a
/// conversion, so those stay declared intents by construction:
///
/// - new table → `CreateTable` (publication applies the whole successor
///   declaration, indexes included);
/// - new index on an existing table → `CreateIndex`;
/// - new optional field → `AddOptionalField`;
/// - existing optional field required in the successor →
///   `TightenRequired` (validate before tighten rides the intent chain);
/// - removed field → `RetireField`; removed table → `RetireTable`;
/// - refused: a new **required** field (declare `AddRequiredField` with
///   its backfill), a field type change (declare `ConvertField`), a
///   required→optional loosening (outside the closed vocabulary), a
///   removed or altered index (outside the closed vocabulary), and any
///   table whose diff both removes and adds fields (a rename signal —
///   declare `RenameField`, or explicit retire/add intents).
///
/// Deterministic emission order: successor declaration order for
/// creates/adds/tightens (fields before indexes within one table), then
/// predecessor declaration order for retires (fields, then tables), so two
/// clean runs derive identical intents and therefore identical plan bytes.
pub fn derive_intents(
    predecessor: &SchemaManifest,
    successor: &SchemaManifest,
) -> SnapbackResult<Vec<MigrationIntent>> {
    let refuse = |message: String| {
        SnapbackError::error("SNAPBACK_MIGRATION_PLAN_INVALID", "storage", message)
    };
    let mut intents = Vec::new();
    for table in &successor.tables {
        let Some(previous) = predecessor.table(&table.name) else {
            intents.push(MigrationIntent::CreateTable {
                table: table.name.clone(),
            });
            continue;
        };
        let added: Vec<_> = table
            .fields
            .iter()
            .filter(|field| previous.field(&field.name).is_none())
            .collect();
        let removed_any = previous
            .fields
            .iter()
            .any(|field| table.field(&field.name).is_none());
        if !added.is_empty() && removed_any {
            return Err(refuse(format!(
                "table {} both adds and removes fields; a schema diff cannot distinguish a \
                 rename from an unrelated retire-plus-add — declare RenameField (or explicit \
                 RetireField/AddOptionalField intents)",
                table.name
            )));
        }
        for field in &table.fields {
            match previous.field(&field.name) {
                None => {
                    if !field.optional {
                        return Err(refuse(format!(
                            "new field {}.{} is required; a schema diff cannot derive its \
                             backfill — declare AddRequiredField",
                            table.name, field.name
                        )));
                    }
                    intents.push(MigrationIntent::AddOptionalField {
                        table: table.name.clone(),
                        field: field.name.clone(),
                        field_type: field.field_type.clone(),
                    });
                }
                Some(existing) => {
                    if existing.field_type != field.field_type {
                        if matches!(
                            (&existing.field_type, &field.field_type),
                            (FieldType::Json, FieldType::Structured { .. })
                        ) {
                            return Err(refuse(format!(
                                "field {}.{} changes from Json to Structured; declare \
                                 ConvertJsonToStructured with the reviewed successor generation",
                                table.name, field.name
                            )));
                        }
                        return Err(refuse(format!(
                            "field {}.{} changes type; declare ConvertField with a total \
                             conversion expression",
                            table.name, field.name
                        )));
                    }
                    match (existing.optional, field.optional) {
                        (true, false) => intents.push(MigrationIntent::TightenRequired {
                            table: table.name.clone(),
                            field: field.name.clone(),
                        }),
                        (false, true) => {
                            return Err(refuse(format!(
                                "field {}.{} loosens required to optional; that transition is \
                                 outside the closed v1 intent vocabulary",
                                table.name, field.name
                            )));
                        }
                        _ => {}
                    }
                }
            }
        }
        for index in &table.indexes {
            match previous
                .indexes
                .iter()
                .find(|candidate| candidate.name == index.name)
            {
                None => intents.push(MigrationIntent::CreateIndex {
                    table: table.name.clone(),
                    index: index.name.clone(),
                    fields: index.fields.clone(),
                    unique: index.unique,
                }),
                Some(existing) => {
                    if existing.fields != index.fields || existing.unique != index.unique {
                        return Err(refuse(format!(
                            "index {}.{} changes shape; index alteration is outside the \
                             closed v1 intent vocabulary (retire under a new name via \
                             explicit intents)",
                            table.name, index.name
                        )));
                    }
                }
            }
        }
        for index in &previous.indexes {
            if !table
                .indexes
                .iter()
                .any(|candidate| candidate.name == index.name)
            {
                return Err(refuse(format!(
                    "index {}.{} is removed; index retirement is outside the closed v1 \
                     intent vocabulary",
                    table.name, index.name
                )));
            }
        }
    }
    for table in &predecessor.tables {
        match successor.table(&table.name) {
            None => intents.push(MigrationIntent::RetireTable {
                table: table.name.clone(),
            }),
            Some(next) => {
                for field in &table.fields {
                    if next.field(&field.name).is_none() {
                        intents.push(MigrationIntent::RetireField {
                            table: table.name.clone(),
                            field: field.name.clone(),
                        });
                    }
                }
            }
        }
    }
    Ok(intents)
}

/// **declaration order**; within one table, expand intents in **declared
/// order**, each intent's dependency chain kept in its required sequence;
/// intents anchored to no schema table (projections) follow, in declared
/// order. Ties beyond that cannot arise from this deterministic walk — the
/// lexicographic tie-break (qualified target, then step type) is applied to
/// same-position collisions as pinned, keeping the rule total. Step IDs are
/// canonical over the resulting ordinals. Two clean checkouts derive
/// identical sequences and IDs from identical inputs.
pub fn derive_plan_steps(
    predecessor_schema: &SchemaManifest,
    successor_schema: &SchemaManifest,
    intents: &[MigrationIntent],
) -> SnapbackResult<Vec<MigrationStepRecord>> {
    if intents.is_empty() {
        return Err(plan_invalid(
            "a migration plan requires at least one intent",
        ));
    }
    let table_position: BTreeMap<&str, usize> = successor_schema
        .tables
        .iter()
        .enumerate()
        .map(|(position, table)| (table.name.as_str(), position))
        .collect();
    // (table position or MAX for non-table anchors, declared intent index)
    let mut ordered: Vec<(usize, usize, &MigrationIntent)> = intents
        .iter()
        .enumerate()
        .map(|(declared, intent)| {
            let position = table_position
                .get(intent.anchor_table())
                .copied()
                .unwrap_or(usize::MAX);
            (position, declared, intent)
        })
        .collect();
    ordered.sort_by(|a, b| {
        (a.0, a.1).cmp(&(b.0, b.1)).then_with(|| {
            // Total-order backstop, pinned: qualified target then step
            // type of each intent's first chain step.
            let left = a.2.chain();
            let right = b.2.chain();
            let left_key = left
                .first()
                .map(|step| (step.qualified_target(), step.step_type()));
            let right_key = right
                .first()
                .map(|step| (step.qualified_target(), step.step_type()));
            left_key.cmp(&right_key)
        })
    });
    let mut records = Vec::new();
    let mut ordinal = 0_usize;
    for (_, _, intent) in ordered {
        let mut chain = intent.chain();
        if let MigrationIntent::ConvertJsonToStructured {
            table,
            field,
            generation,
        } = intent
        {
            if *generation == 0 {
                return Err(plan_invalid(
                    "ConvertJsonToStructured generation must be positive",
                ));
            }
            let predecessor_field = predecessor_schema
                .table(table)
                .and_then(|manifest| manifest.field(field))
                .ok_or_else(|| {
                    plan_invalid(format!(
                        "ConvertJsonToStructured source {table}.{field} is absent from the predecessor schema"
                    ))
                })?;
            if !matches!(&predecessor_field.field_type, FieldType::Json) {
                return Err(plan_invalid(format!(
                    "ConvertJsonToStructured source {table}.{field} must be Json"
                )));
            }
            let successor_table = successor_schema.table(table).ok_or_else(|| {
                plan_invalid(format!(
                    "ConvertJsonToStructured table {table} is absent from the successor schema"
                ))
            })?;
            let successor_field = successor_table.field(field).ok_or_else(|| {
                plan_invalid(format!(
                    "ConvertJsonToStructured field {table}.{field} is absent from the successor schema"
                ))
            })?;
            if !matches!(&successor_field.field_type, FieldType::Structured { .. }) {
                return Err(plan_invalid(format!(
                    "ConvertJsonToStructured destination {table}.{field} must be Structured"
                )));
            }
            // @ref LLP 0081#3-typed-migration-steps — this named intent owns
            // exactly one Json-to-Structured transform; every other successor
            // field is carried by CopyTable without entering the transform map.
            let named_field = BTreeMap::from([(
                field.clone(),
                ValueExpr::Field {
                    base: Box::new(ValueExpr::Binding("row".to_owned())),
                    key: field.clone(),
                },
            )]);
            let Some(MigrationStep::CopyTable { fields, .. }) = chain.get_mut(1) else {
                return Err(plan_invalid(
                    "ConvertJsonToStructured did not expand to its pinned stage/copy chain",
                ));
            };
            *fields = named_field;
        }
        for step in chain {
            ordinal += 1;
            let mut record = default_step_record(ordinal, step);
            if let MigrationIntent::ConvertJsonToStructured { table, .. } = intent
                && matches!(record.step, MigrationStep::CopyTable { .. })
            {
                record.verification = vec![
                    MigrationVerification::RowCountMatchesSource {
                        source_table: table.clone(),
                        table: table.clone(),
                    },
                    MigrationVerification::ContentDigest {
                        table: table.clone(),
                    },
                ];
            }
            records.push(record);
        }
    }
    Ok(records)
}

// ---------------------------------------------------------------------------
// Deterministic synthesized-row IDs (LLP 0081 §3)
// ---------------------------------------------------------------------------

/// A synthesized row ID: UUIDv7-compatible; the 48 time bits carry the
/// plan's approved `publicationTimestamp`; version/variant hold their fixed
/// values; exactly the 74 `rand_a`/`rand_b` bits derive from a
/// domain-separated SHA-256 over plan digest, step ID, source table and row
/// key, destination table and generation, and output ordinal —
/// collision-scoped per destination. Maintained-projection output rows are
/// exempt (LLP 0080 §5's stored-identity rule).
#[allow(clippy::too_many_arguments)]
pub fn synthesized_row_id(
    publication_timestamp_ms: u64,
    plan_digest: &str,
    step_id: &str,
    source_table: &str,
    source_row_key: &str,
    destination_table: &str,
    destination_generation: u64,
    output_ordinal: u64,
) -> SnapbackResult<String> {
    if publication_timestamp_ms >= MIGRATION_TIMESTAMP_MAX_EXCLUSIVE {
        return Err(plan_invalid(format!(
            "publicationTimestamp {publication_timestamp_ms} is outside the 48-bit \
             UUIDv7 millisecond range"
        )));
    }
    let mut hash = Sha256::new();
    hash.update(MIGRATION_ID_TAG);
    for part in [
        plan_digest,
        step_id,
        source_table,
        source_row_key,
        destination_table,
    ] {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    hash.update(destination_generation.to_be_bytes());
    hash.update(output_ordinal.to_be_bytes());
    let digest = hash.finalize();

    let mut bytes = [0_u8; 16];
    bytes[..6].copy_from_slice(&publication_timestamp_ms.to_be_bytes()[2..8]);
    // rand_a: the first 12 digest bits, behind the version nibble.
    bytes[6] = 0x70 | (digest[0] >> 4);
    bytes[7] = ((digest[0] & 0x0f) << 4) | (digest[1] >> 4);
    // rand_b: 62 bits — the variant byte keeps its top two bits fixed and
    // takes the next 6 digest bits; seven full bytes follow. Total consumed:
    // 12 + 6 + 56 = 74 bits, exactly the UUIDv7 random field.
    bytes[8] = 0x80 | ((digest[1] & 0x0f) << 2) | (digest[2] >> 6);
    bytes[9] = ((digest[2] & 0x3f) << 2) | (digest[3] >> 6);
    bytes[10] = ((digest[3] & 0x3f) << 2) | (digest[4] >> 6);
    bytes[11] = ((digest[4] & 0x3f) << 2) | (digest[5] >> 6);
    bytes[12] = ((digest[5] & 0x3f) << 2) | (digest[6] >> 6);
    bytes[13] = ((digest[6] & 0x3f) << 2) | (digest[7] >> 6);
    bytes[14] = ((digest[7] & 0x3f) << 2) | (digest[8] >> 6);
    bytes[15] = ((digest[8] & 0x3f) << 2) | (digest[9] >> 6);
    Ok(uuid::Uuid::from_bytes(bytes).to_string())
}

// ---------------------------------------------------------------------------
// Observation, approval, admission (LLP 0081 §2)
// ---------------------------------------------------------------------------

pub const MIGRATION_OBSERVATION_SCHEMA_VERSION: &str = "migration-observation-v1";

/// Target observations that do **not** authorize execution: preview-observed
/// head, time, bounded precondition summaries, and capability health.
/// Separately digested; approval and the receipt retain the digest for
/// review context, but apply never mistakes a changing observation for plan
/// authority.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationPreviewObservationV1 {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "planDigest")]
    pub plan_digest: String,
    #[serde(rename = "targetHeadVersion")]
    pub target_head_version: u64,
    #[serde(rename = "observedAtMs")]
    pub observed_at_ms: u64,
    /// Bounded precondition summaries keyed by step ID (row counts observed
    /// at preview).
    #[serde(
        default,
        rename = "preconditionRows",
        skip_serializing_if = "BTreeMap::is_empty"
    )]
    pub precondition_rows: BTreeMap<String, u64>,
    /// Dynamic capability-health facts, distinct from the static capability
    /// digest the plan binds.
    #[serde(
        default,
        rename = "capabilityHealth",
        skip_serializing_if = "BTreeMap::is_empty"
    )]
    pub capability_health: BTreeMap<String, String>,
}

pub fn observation_digest(observation: &MigrationPreviewObservationV1) -> SnapbackResult<String> {
    let value = serde_json::to_value(observation)
        .map_err(|_| plan_invalid("observation does not serialize"))?;
    prefixed_digest(MIGRATION_OBSERVATION_DIGEST_PREFIX, &value)
}

/// The complete LLP 0072 target audience. Deployment-class-defined fields
/// are optional at the type level; profile validation decides which are
/// required. The local profile binds the resolved local target identity —
/// database, stream incarnation, activation generation, and profile.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationAudienceV1 {
    #[serde(default, rename = "projectId", skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, rename = "targetId", skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(
        default,
        rename = "environmentId",
        skip_serializing_if = "Option::is_none"
    )]
    pub environment_id: Option<String>,
    #[serde(
        default,
        rename = "deploymentId",
        skip_serializing_if = "Option::is_none"
    )]
    pub deployment_id: Option<String>,
    #[serde(default, rename = "releaseId", skip_serializing_if = "Option::is_none")]
    pub release_id: Option<String>,
    #[serde(rename = "databaseId")]
    pub database_id: String,
    #[serde(rename = "streamIncarnation")]
    pub stream_incarnation: String,
    #[serde(rename = "activationGeneration")]
    pub activation_generation: u64,
    #[serde(rename = "targetProfileId")]
    pub target_profile_id: String,
}

pub const MIGRATION_APPROVAL_SCHEMA_VERSION: &str = "migration-approval-v1";
pub const MIGRATION_OPERATION_ID_PREFIX: &str = "operation-v1:";

/// Mint a fresh operation id. One plan may execute as different operations
/// only through separate approvals; the id is never derived from the plan
/// digest.
/// The control-plane-authorized rehearsal binding (LLP 0081 §7): the
/// source backup identity, the isolated restore-derived target, the
/// restore epoch, and the matching target profile. On the local profile
/// the binding is an operator record; hosted custody belongs to LLP 0072.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationRehearsalBindingV1 {
    pub source_backup_identity: String,
    /// The restore-derived database identity the rehearsal may execute
    /// against — and the only one.
    pub isolated_database_id: String,
    pub restore_epoch_ms: u64,
    pub target_profile_id: String,
}

/// `MigrationRehearsalPlanV1` (LLP 0081 §7): not the production plan with
/// its target silently changed — the digest binds the UNCHANGED production
/// plan digest plus the rehearsal binding, the rehearsal executes only
/// against the restore-derived target, its journal and receipt are marked
/// rehearsal, and it can never satisfy or replay as production apply.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationRehearsalPlanV1 {
    pub schema_version: String,
    pub production_plan_digest: String,
    pub binding: MigrationRehearsalBindingV1,
    /// SHA-256 (bare hex) over `snapback:migration-rehearsal:v1`, one
    /// newline, and the JCS bytes of {schemaVersion, productionPlanDigest,
    /// binding} — the same domain-separated preimage rule as the plan.
    pub rehearsal_digest: String,
}

pub const MIGRATION_REHEARSAL_SCHEMA_VERSION: &str = "migration-rehearsal-v1";
const MIGRATION_REHEARSAL_DIGEST_DOMAIN: &str = "snapback:migration-rehearsal:v1";

impl MigrationRehearsalPlanV1 {
    fn digest_of(
        schema_version: &str,
        production_plan_digest: &str,
        binding: &MigrationRehearsalBindingV1,
    ) -> SnapbackResult<String> {
        let body = serde_json::json!({
            "schemaVersion": schema_version,
            "productionPlanDigest": production_plan_digest,
            "binding": serde_json::to_value(binding).map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_MIGRATION_PLAN_INVALID",
                    "migration",
                    "rehearsal binding does not serialize",
                )
            })?,
        });
        let jcs = crate::rqs_contract::jcs(&body).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_MIGRATION_PLAN_INVALID",
                "migration",
                "rehearsal body is not canonicalizable",
            )
        })?;
        use sha2::{Digest, Sha256};
        let mut hash = Sha256::new();
        hash.update(MIGRATION_REHEARSAL_DIGEST_DOMAIN.as_bytes());
        hash.update(b"\n");
        hash.update(jcs.as_bytes());
        Ok(hash
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect())
    }

    pub fn seal(
        production_plan_digest: String,
        binding: MigrationRehearsalBindingV1,
    ) -> SnapbackResult<Self> {
        let rehearsal_digest = Self::digest_of(
            MIGRATION_REHEARSAL_SCHEMA_VERSION,
            &production_plan_digest,
            &binding,
        )?;
        Ok(Self {
            schema_version: MIGRATION_REHEARSAL_SCHEMA_VERSION.to_owned(),
            production_plan_digest,
            binding,
            rehearsal_digest,
        })
    }

    /// Recompute-and-compare validation; every failure is the uniform
    /// rehearsal refusal shape the executor maps to
    /// `SNAPBACK_MIGRATION_REHEARSAL_INVALID`.
    pub fn validate(&self) -> SnapbackResult<()> {
        if self.schema_version != MIGRATION_REHEARSAL_SCHEMA_VERSION {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_REHEARSAL_INVALID",
                "migration",
                format!("unknown rehearsal schema version {:?}", self.schema_version),
            ));
        }
        let expected = Self::digest_of(
            &self.schema_version,
            &self.production_plan_digest,
            &self.binding,
        )?;
        if expected != self.rehearsal_digest {
            return Err(SnapbackError::error(
                "SNAPBACK_MIGRATION_REHEARSAL_INVALID",
                "migration",
                "rehearsal digest does not match its body",
            ));
        }
        Ok(())
    }
}

pub fn new_operation_id() -> String {
    format!(
        "{MIGRATION_OPERATION_ID_PREFIX}{}",
        uuid::Uuid::now_v7().simple()
    )
}

/// Typed, authenticated approval (LLP 0081 §2). Local development approval
/// is a local authenticated operator record; hosted approval is an LLP 0072
/// control-plane operation. `generatorIsApprover` records whether generator
/// and approver are distinct for the receipt.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationApprovalV1 {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "planDigest")]
    pub plan_digest: String,
    #[serde(rename = "observationDigest")]
    pub observation_digest: String,
    #[serde(rename = "policyDigest")]
    pub policy_digest: String,
    pub audience: MigrationAudienceV1,
    pub approver: String,
    #[serde(rename = "generatorIsApprover")]
    pub generator_is_approver: bool,
    #[serde(rename = "issuedAtMs")]
    pub issued_at_ms: u64,
    #[serde(rename = "expiresAtMs")]
    pub expires_at_ms: u64,
    #[serde(rename = "operationId")]
    pub operation_id: String,
}

pub fn approval_digest(approval: &MigrationApprovalV1) -> SnapbackResult<String> {
    let value =
        serde_json::to_value(approval).map_err(|_| plan_invalid("approval does not serialize"))?;
    prefixed_digest(MIGRATION_APPROVAL_DIGEST_PREFIX, &value)
}

/// Structural approval validation. Semantic admission (audience equality
/// against the resolved target, expiry against barrier time, policy digest
/// against the active policy) is Wave 2's barrier-time enforcement.
pub fn validate_approval_shape(approval: &MigrationApprovalV1) -> SnapbackResult<()> {
    if approval.schema_version != MIGRATION_APPROVAL_SCHEMA_VERSION {
        return Err(plan_invalid(format!(
            "unknown approval schema version {:?}",
            approval.schema_version
        )));
    }
    if approval
        .operation_id
        .strip_prefix(MIGRATION_OPERATION_ID_PREFIX)
        .is_none_or(str::is_empty)
    {
        return Err(plan_invalid(
            "approval operationId is not operation-v1 shaped",
        ));
    }
    if approval.operation_id.contains(&approval.plan_digest) {
        return Err(plan_invalid(
            "operationId must be fresh, never derived from the plan digest",
        ));
    }
    if approval.expires_at_ms <= approval.issued_at_ms {
        return Err(plan_invalid("approval expiry must be after issue"));
    }
    if approval.approver.is_empty() {
        return Err(plan_invalid("approval requires an approver principal"));
    }
    if approval.audience.database_id.is_empty()
        || approval.audience.stream_incarnation.is_empty()
        || approval.audience.target_profile_id.is_empty()
    {
        return Err(plan_invalid(
            "approval audience requires the resolved target identity (database, \
             stream incarnation, target profile)",
        ));
    }
    Ok(())
}

pub const MIGRATION_ADMISSION_SCHEMA_VERSION: &str = "migration-admission-v1";

/// Barrier-time admission (LLP 0081 §2): binds the actual predecessor head,
/// the enforced resource bounds, and the approval it consumes. The receipt
/// carries both records.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MigrationAdmissionV1 {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "operationId")]
    pub operation_id: String,
    #[serde(rename = "planDigest")]
    pub plan_digest: String,
    #[serde(rename = "approvalDigest")]
    pub approval_digest: String,
    #[serde(rename = "predecessorHeadVersion")]
    pub predecessor_head_version: u64,
    pub enforced: MigrationCeilings,
    #[serde(rename = "admittedAtMs")]
    pub admitted_at_ms: u64,
}

pub fn admission_digest(admission: &MigrationAdmissionV1) -> SnapbackResult<String> {
    let value = serde_json::to_value(admission)
        .map_err(|_| plan_invalid("admission does not serialize"))?;
    prefixed_digest(MIGRATION_ADMISSION_DIGEST_PREFIX, &value)
}

// ---------------------------------------------------------------------------
// Plan validation (LLP 0081 §2/§3)
// ---------------------------------------------------------------------------

/// The closed backfill expression walk (LLP 0081 §3): expressions read the
/// source row (`Binding`/`Field`) and the plan's explicit constants (`Arg`
/// into `constants.values`); they cannot read ambient time or randomness,
/// authorization, the whole args object, or membership facts.
fn validate_backfill_expr(
    expr: &ValueExpr,
    constants: &MigrationConstants,
    where_: &str,
) -> SnapbackResult<()> {
    match expr {
        ValueExpr::RuntimeNow | ValueExpr::RuntimeId | ValueExpr::ClientMutationDigest => {
            Err(plan_invalid(format!(
                "{where_}: backfill expressions cannot read ambient time or randomness; \
             use an explicit plan constant"
            )))
        }
        ValueExpr::AuthUserId
        | ValueExpr::AuthKind
        | ValueExpr::AuthActorKind
        | ValueExpr::AuthActivityActorKind
        | ValueExpr::AuthActorUserId
        | ValueExpr::AuthGrantId
        | ValueExpr::AuthIsDelegated => Err(plan_invalid(format!(
            "{where_}: backfill expressions have no caller and cannot read authorization"
        ))),
        ValueExpr::Args => Err(plan_invalid(format!(
            "{where_}: backfill expressions cannot read the whole args object"
        ))),
        ValueExpr::MembershipExists(_) => Err(plan_invalid(format!(
            "{where_}: backfill expressions cannot consult membership facts"
        ))),
        ValueExpr::Arg(path) => {
            let head = path.split('.').next().unwrap_or_default();
            if constants.values.contains_key(head) {
                Ok(())
            } else {
                Err(plan_invalid(format!(
                    "{where_}: Arg({path:?}) names no declared plan constant — migration \
                     constants are explicit inputs, apply creates none"
                )))
            }
        }
        ValueExpr::Literal(_) | ValueExpr::Binding(_) => Ok(()),
        ValueExpr::Field { base, .. } => validate_backfill_expr(base, constants, where_),
        ValueExpr::Binary { left, right, .. } => {
            validate_backfill_expr(left, constants, where_)?;
            validate_backfill_expr(right, constants, where_)
        }
        ValueExpr::Unary { expr, .. } => validate_backfill_expr(expr, constants, where_),
        ValueExpr::If { cond, then, r#else } => {
            validate_backfill_expr(cond, constants, where_)?;
            validate_backfill_expr(then, constants, where_)?;
            validate_backfill_expr(r#else, constants, where_)
        }
        ValueExpr::Concat(parts) => parts
            .iter()
            .try_for_each(|part| validate_backfill_expr(part, constants, where_)),
        ValueExpr::Call { args, .. } => args
            .iter()
            .try_for_each(|arg| validate_backfill_expr(arg, constants, where_)),
        ValueExpr::Record { fields } => fields
            .values()
            .try_for_each(|field| validate_backfill_expr(field, constants, where_)),
    }
}

fn authority_bearing(schema: &SchemaManifest, table: &str) -> bool {
    schema
        .table(table)
        .is_some_and(|table| table.membership.is_some() || table.permission_backing)
}

/// Validate a sealed plan artifact: digest/id recomputation with no
/// self-reference, the 48-bit timestamp refusal, canonical step IDs over the
/// pinned order's ordinals, the closed backfill vocabulary against the
/// explicit constants, boundary references, posture admission, and the
/// authority-bearing-table refusal against both schema generations.
pub fn validate_plan_artifact_seal(artifact: &MigrationPlanArtifactV1) -> SnapbackResult<()> {
    let body = &artifact.body;
    if body.schema_version != MIGRATION_PLAN_SCHEMA_VERSION {
        return Err(plan_invalid(format!(
            "unknown plan schema version {:?}",
            body.schema_version
        )));
    }
    let recomputed = plan_digest(body)?;
    if artifact.plan_digest != recomputed {
        return Err(plan_invalid(
            "planDigest does not match the canonical body bytes",
        ));
    }
    if artifact.plan_id != plan_id(&recomputed) {
        return Err(plan_invalid("planId does not match the plan digest"));
    }
    Ok(())
}

pub fn validate_plan_artifact(
    artifact: &MigrationPlanArtifactV1,
    predecessor_schema: &SchemaManifest,
    successor_schema: &SchemaManifest,
) -> SnapbackResult<()> {
    let body = &artifact.body;
    validate_plan_artifact_seal(artifact)?;
    if body.constants.publication_timestamp_ms >= MIGRATION_TIMESTAMP_MAX_EXCLUSIVE {
        return Err(plan_invalid(
            "publicationTimestamp is outside the 48-bit UUIDv7 millisecond range",
        ));
    }
    if body.steps.is_empty() {
        return Err(plan_invalid("a migration plan requires at least one step"));
    }
    if body.ceilings.max_affected_rows == 0
        || body.ceilings.max_bytes == 0
        || body.ceilings.max_writes == 0
    {
        return Err(plan_invalid(
            "resource ceilings are approval-relevant and must be positive",
        ));
    }
    if matches!(body.retained_work_posture, RetainedWorkPosture::Transformed) {
        // Deferred until each owning subsystem defines its versioned adapter
        // (LLP 0081 §6): declared-but-unproven `transformed` is unsupported.
        return Err(SnapbackError::error(
            "SNAPBACK_MIGRATION_PROFILE_UNSUPPORTED",
            "migration",
            "retainedWorkPosture 'transformed' is deferred; v1 admits 'empty' \
             (proven under the barrier) or 'dual-compatible'",
        ));
    }
    if matches!(body.proof.method, MigrationProofMethod::SampledAudit) && body.proof.bound.is_none()
    {
        return Err(plan_invalid(
            "sampled-audit proof requires a declared bound",
        ));
    }
    let step_ids: BTreeSet<&str> = body.steps.iter().map(|step| step.id.as_str()).collect();
    if step_ids.len() != body.steps.len() {
        return Err(plan_invalid("step IDs must be unique"));
    }
    // In-place backfill/copy is deliberately limited to columns introduced
    // earlier by this exact plan. Without this admission proof the executor's
    // closed-barrier NULL exception could hide corruption in an existing
    // required field. Requiredness is an ordered state machine: validation
    // closes the destination to later writes, and MakeRequired must consume
    // that exact validation before publication. The sets are
    // approval-relevant because step order is already canonical and
    // digest-sealed.
    //
    // @ref LLP 0081#3-typed-migration-steps — AddField establishes the only
    //   nullable staging destination that a later backfill/copy may consume.
    let mut staged_fields: BTreeSet<(String, String)> = BTreeSet::new();
    let mut validated_required_fields: BTreeSet<(String, String)> = BTreeSet::new();
    let mut made_required_fields: BTreeSet<(String, String)> = BTreeSet::new();
    for (index, record) in body.steps.iter().enumerate() {
        let expected = canonical_step_id(index + 1, &record.step);
        if record.id != expected {
            return Err(plan_invalid(format!(
                "step {} carries id {:?}; the canonical id for its position is {expected:?}",
                index + 1,
                record.id
            )));
        }
        match &record.step {
            MigrationStep::AddField {
                table,
                field,
                field_type,
                ..
            } => {
                if predecessor_schema
                    .table(table)
                    .and_then(|manifest| manifest.field(field))
                    .is_some()
                {
                    return Err(plan_invalid(format!(
                        "step {} cannot stage existing predecessor field {table}.{field}",
                        record.id
                    )));
                }
                let successor_field = successor_schema
                    .table(table)
                    .and_then(|manifest| manifest.field(field))
                    .ok_or_else(|| {
                        plan_invalid(format!(
                            "step {} stages field {table}.{field} absent from the successor",
                            record.id
                        ))
                    })?;
                if successor_field.field_type != *field_type {
                    return Err(plan_invalid(format!(
                        "step {} type for staged field {table}.{field} disagrees with the successor",
                        record.id
                    )));
                }
                if !staged_fields.insert((table.clone(), field.clone())) {
                    return Err(plan_invalid(format!(
                        "step {} stages field {table}.{field} more than once",
                        record.id
                    )));
                }
            }
            MigrationStep::BackfillField { table, field, .. }
            | MigrationStep::CopyField { table, field, .. } => {
                let target = (table.clone(), field.clone());
                if !staged_fields.contains(&target) {
                    return Err(plan_invalid(format!(
                        "step {} may write only a field staged earlier by AddField; {table}.{field} is not staged",
                        record.id
                    )));
                }
                if validated_required_fields.contains(&target)
                    || made_required_fields.contains(&target)
                {
                    return Err(plan_invalid(format!(
                        "step {} writes {table}.{field} after its requiredness validation closed; backfill/copy must precede ValidateRequired",
                        record.id
                    )));
                }
            }
            MigrationStep::ValidateRequired { table, field } => {
                let target = (table.clone(), field.clone());
                let successor_field = successor_schema
                    .table(table)
                    .and_then(|manifest| manifest.field(field))
                    .ok_or_else(|| {
                        plan_invalid(format!(
                            "step {} validates requiredness for absent successor field {table}.{field}",
                            record.id
                        ))
                    })?;
                if successor_field.optional {
                    return Err(plan_invalid(format!(
                        "step {} validates requiredness for optional successor field {table}.{field}",
                        record.id
                    )));
                }
                let tightens_predecessor = predecessor_schema
                    .table(table)
                    .and_then(|manifest| manifest.field(field))
                    .is_some_and(|field| field.optional);
                if !staged_fields.contains(&target) && !tightens_predecessor {
                    return Err(plan_invalid(format!(
                        "step {} may validate only a field staged earlier by AddField or an optional predecessor field becoming required; {table}.{field} has neither lifecycle",
                        record.id
                    )));
                }
                if made_required_fields.contains(&target)
                    || !validated_required_fields.insert(target)
                {
                    return Err(plan_invalid(format!(
                        "step {} repeats or follows completed requiredness validation for {table}.{field}",
                        record.id
                    )));
                }
            }
            MigrationStep::MakeRequired { table, field } => {
                let target = (table.clone(), field.clone());
                if !validated_required_fields.remove(&target) {
                    return Err(plan_invalid(format!(
                        "step {} makes {table}.{field} required without an unmatched prior ValidateRequired",
                        record.id
                    )));
                }
                if !made_required_fields.insert(target) {
                    return Err(plan_invalid(format!(
                        "step {} makes {table}.{field} required more than once",
                        record.id
                    )));
                }
            }
            _ => {}
        }
        for expr in record.step.backfill_exprs() {
            validate_backfill_expr(expr, &body.constants, &record.id)?;
        }
        for table in record.step.written_tables() {
            if authority_bearing(predecessor_schema, table)
                || authority_bearing(successor_schema, table)
            {
                return Err(plan_invalid(format!(
                    "step {} writes authority-bearing table {table}; membership and \
                     permission-backing declarations are owned by their subsystem \
                     writers, never a generic migration step",
                    record.id
                )));
            }
        }
    }
    if let Some((table, field)) = validated_required_fields.iter().next() {
        return Err(plan_invalid(format!(
            "requiredness validation for {table}.{field} is not followed by MakeRequired"
        )));
    }
    for (table, field) in &staged_fields {
        let successor_required = successor_schema
            .table(table)
            .and_then(|manifest| manifest.field(field))
            .is_some_and(|field| !field.optional);
        if successor_required && !made_required_fields.contains(&(table.clone(), field.clone())) {
            return Err(plan_invalid(format!(
                "required staged field {table}.{field} lacks ValidateRequired followed by MakeRequired"
            )));
        }
    }
    for predecessor_table in &predecessor_schema.tables {
        let Some(successor_table) = successor_schema.table(&predecessor_table.name) else {
            continue;
        };
        for predecessor_field in &predecessor_table.fields {
            let tightens_requiredness = predecessor_field.optional
                && successor_table
                    .field(&predecessor_field.name)
                    .is_some_and(|field| !field.optional);
            if tightens_requiredness
                && !made_required_fields.contains(&(
                    predecessor_table.name.clone(),
                    predecessor_field.name.clone(),
                ))
            {
                return Err(plan_invalid(format!(
                    "optional predecessor field {}.{} becomes required without ValidateRequired followed by MakeRequired",
                    predecessor_table.name, predecessor_field.name
                )));
            }
        }
    }
    for boundary in [
        body.boundaries.rollback_boundary_step.as_deref(),
        body.boundaries.cleanup_from_step.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if !step_ids.contains(boundary) {
            return Err(plan_invalid(format!(
                "boundary step {boundary:?} names no step in this plan"
            )));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Golden vectors (committed via schema_export::artifact_instances)
// ---------------------------------------------------------------------------

/// The fixed vector fixture: a deterministic plan over a two-table schema,
/// sealed, observed, approved, and admitted with pinned literal inputs. The
/// committed artifact is generated through this implementation, so the file,
/// the drift gate, and the runtime cannot diverge; the unit tests pin the
/// exact digest strings so the implementation cannot drift either.
pub fn migration_vector_fixture() -> SnapbackResult<(
    MigrationPlanArtifactV1,
    MigrationPreviewObservationV1,
    MigrationApprovalV1,
    MigrationAdmissionV1,
)> {
    use crate::manifest::{FieldManifest, IndexManifest, TableManifest};
    let table =
        |name: &str, fields: Vec<FieldManifest>, indexes: Vec<IndexManifest>| TableManifest {
            name: name.to_owned(),
            fields,
            indexes,
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        };
    let string_field = |name: &str, optional: bool| FieldManifest {
        name: name.to_owned(),
        field_type: FieldType::String,
        optional,
    };
    let successor = SchemaManifest {
        tables: vec![
            table(
                "accounts",
                vec![string_field("name", false), string_field("region", false)],
                vec![IndexManifest {
                    name: "by_region".to_owned(),
                    fields: vec!["region".to_owned()],
                    unique: false,
                    where_applicable: false,
                }],
            ),
            table(
                "users",
                vec![
                    string_field("email", false),
                    string_field("displayName", false),
                ],
                vec![IndexManifest {
                    name: "by_email".to_owned(),
                    fields: vec!["email".to_owned()],
                    unique: true,
                    where_applicable: false,
                }],
            ),
        ],
        ..SchemaManifest::default()
    };
    // Intents deliberately declared users-first: the pinned order walks the
    // successor schema's declaration order (accounts before users), which
    // the vectors freeze.
    let intents = vec![
        MigrationIntent::AddRequiredField {
            table: "users".to_owned(),
            field: "displayName".to_owned(),
            field_type: FieldType::String,
            backfill: ValueExpr::Arg("defaultDisplayName".to_owned()),
        },
        MigrationIntent::AddRequiredField {
            table: "accounts".to_owned(),
            field: "region".to_owned(),
            field_type: FieldType::String,
            backfill: ValueExpr::Arg("defaultRegion".to_owned()),
        },
        MigrationIntent::CreateIndex {
            table: "users".to_owned(),
            index: "by_email".to_owned(),
            fields: vec!["email".to_owned()],
            unique: true,
        },
    ];
    let predecessor = SchemaManifest {
        tables: vec![
            table("accounts", vec![string_field("name", false)], Vec::new()),
            table("users", vec![string_field("email", false)], Vec::new()),
        ],
        ..SchemaManifest::default()
    };
    let steps = derive_plan_steps(&predecessor, &successor, &intents)?;
    let body = MigrationPlanBody {
        schema_version: MIGRATION_PLAN_SCHEMA_VERSION.to_owned(),
        app: "vector-app".to_owned(),
        instance: "vector-instance".to_owned(),
        target_profile_id: "local-dev-sqlite-ibex".to_owned(),
        predecessor_schema_hash: "sha256:0000000000000000".to_owned(),
        successor_schema_hash: "sha256:1111111111111111".to_owned(),
        predecessor_generation: 1,
        steps,
        execution_strategy: MigrationExecutionStrategy::SingleTransaction,
        proof: MigrationProof {
            method: MigrationProofMethod::Full,
            bound: None,
        },
        ceilings: MigrationCeilings {
            max_affected_rows: 10_000,
            max_bytes: 1_048_576,
            max_writes: 20_000,
            max_barrier_downtime_ms: 5_000,
        },
        compatibility_posture: CompatibilityPosture::SuccessorOnly,
        retained_work_posture: RetainedWorkPosture::Empty,
        backup: MigrationBackupRequirement {
            required: true,
            checkpoint_label: Some("pre-vector".to_owned()),
            rehearsal_required: false,
        },
        expected_output: MigrationExpectedOutput {
            schema_hash: "sha256:1111111111111111".to_owned(),
            projection_generations: BTreeMap::new(),
        },
        constants: MigrationConstants {
            publication_timestamp_ms: 1_784_000_000_000,
            rollback_timestamp_ms: None,
            values: BTreeMap::from([
                ("defaultDisplayName".to_owned(), json!("Unnamed")),
                ("defaultRegion".to_owned(), json!("us-east-1")),
            ]),
        },
        boundaries: MigrationBoundaries::default(),
    };
    let artifact = MigrationPlanArtifactV1::seal(body)?;
    let observation = MigrationPreviewObservationV1 {
        schema_version: MIGRATION_OBSERVATION_SCHEMA_VERSION.to_owned(),
        plan_digest: artifact.plan_digest.clone(),
        target_head_version: 42,
        observed_at_ms: 1_783_999_990_000,
        precondition_rows: BTreeMap::from([(artifact.body.steps[0].id.clone(), 7)]),
        capability_health: BTreeMap::from([(
            "migration_keyset_scan_v1".to_owned(),
            "available".to_owned(),
        )]),
    };
    let approval = MigrationApprovalV1 {
        schema_version: MIGRATION_APPROVAL_SCHEMA_VERSION.to_owned(),
        plan_digest: artifact.plan_digest.clone(),
        observation_digest: observation_digest(&observation)?,
        policy_digest: "sha256:2222222222222222".to_owned(),
        audience: MigrationAudienceV1 {
            project_id: None,
            target_id: None,
            environment_id: None,
            deployment_id: None,
            release_id: None,
            database_id: "db-vector".to_owned(),
            stream_incarnation: "stream-vector-1".to_owned(),
            activation_generation: 3,
            target_profile_id: "local-dev-sqlite-ibex".to_owned(),
        },
        approver: "operator:vector".to_owned(),
        generator_is_approver: false,
        issued_at_ms: 1_783_999_995_000,
        expires_at_ms: 1_784_000_600_000,
        operation_id: format!("{MIGRATION_OPERATION_ID_PREFIX}vector0000000000000000000000000001"),
    };
    validate_approval_shape(&approval)?;
    let admission = MigrationAdmissionV1 {
        schema_version: MIGRATION_ADMISSION_SCHEMA_VERSION.to_owned(),
        operation_id: approval.operation_id.clone(),
        plan_digest: artifact.plan_digest.clone(),
        approval_digest: approval_digest(&approval)?,
        predecessor_head_version: 42,
        enforced: artifact.body.ceilings.clone(),
        admitted_at_ms: 1_784_000_000_000,
    };
    Ok((artifact, observation, approval, admission))
}

/// The committed `schemas/migration.vectors-v1.json` artifact.
pub fn migration_vectors_artifact() -> Value {
    let (artifact, observation, approval, admission) =
        migration_vector_fixture().expect("vector fixture is valid by construction");
    let synthesized = |row_key: &str, ordinal: u64| {
        let id = synthesized_row_id(
            artifact.body.constants.publication_timestamp_ms,
            &artifact.plan_digest,
            &artifact.body.steps[0].id,
            "users",
            row_key,
            "users",
            2,
            ordinal,
        )
        .expect("vector timestamp is in range");
        json!({
            "planDigest": artifact.plan_digest,
            "stepId": artifact.body.steps[0].id,
            "sourceTable": "users",
            "sourceRowKey": row_key,
            "destinationTable": "users",
            "destinationGeneration": 2,
            "outputOrdinal": ordinal,
            "publicationTimestampMs": artifact.body.constants.publication_timestamp_ms,
            "id": id,
        })
    };
    json!({
        "version": "migration-vectors-v1",
        "authority": "llp/0081-reviewed-storage-evolution-and-migrations.rfc.md#2-canonical-plan-and-approval",
        "decisions": {
            "planDigestRepresentation": "64 lowercase hex characters, no algorithm prefix",
            "planDigestPreimage": format!("{MIGRATION_PLAN_DIGEST_PREFIX}\\n<JCS body bytes>"),
            "planIdForm": "migration-v1:<planDigest>",
            "operationIdForm": "operation-v1:<fresh uuid, never plan-derived>",
            "observationDigestPreimage": format!("{MIGRATION_OBSERVATION_DIGEST_PREFIX}\\n<JCS bytes>"),
            "approvalDigestPreimage": format!("{MIGRATION_APPROVAL_DIGEST_PREFIX}\\n<JCS bytes>"),
            "admissionDigestPreimage": format!("{MIGRATION_ADMISSION_DIGEST_PREFIX}\\n<JCS bytes>"),
        },
        "plan": artifact,
        "stepIds": artifact.body.steps.iter().map(|step| step.id.clone()).collect::<Vec<_>>(),
        "observation": observation,
        "observationDigest": observation_digest(&observation).expect("observation digests"),
        "approval": approval,
        "approvalDigest": approval_digest(&approval).expect("approval digests"),
        "admission": admission,
        "admissionDigest": admission_digest(&admission).expect("admission digests"),
        "synthesizedIds": [
            synthesized("row-1", 0),
            synthesized("row-1", 1),
            synthesized("row-2", 0),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // @ref LLP 0081#2-canonical-plan-and-approval — preview's schema-diff
    //   derivation covers exactly the unambiguous, semantics-free changes,
    //   deterministically; everything needing a declared backfill, rename,
    //   or conversion refuses with the intent it demands.
    #[test]
    fn schema_diff_derivation_is_deterministic_and_closed() {
        let field = |name: &str, optional: bool| crate::manifest::FieldManifest {
            name: name.to_owned(),
            field_type: crate::manifest::FieldType::String,
            optional,
        };
        let table = |name: &str,
                     fields: Vec<crate::manifest::FieldManifest>,
                     indexes: Vec<crate::manifest::IndexManifest>| {
            crate::manifest::TableManifest {
                name: name.to_owned(),
                fields,
                indexes,
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            }
        };
        let predecessor = crate::manifest::SchemaManifest {
            tables: vec![
                table(
                    "notes",
                    vec![field("body", false), field("draft", true)],
                    Vec::new(),
                ),
                table("legacy", vec![field("value", false)], Vec::new()),
            ],
            ..Default::default()
        };
        let successor = crate::manifest::SchemaManifest {
            tables: vec![
                table(
                    "notes",
                    vec![
                        field("body", false),
                        field("draft", false),
                        field("tag", true),
                    ],
                    vec![crate::manifest::IndexManifest {
                        name: "by_tag".to_owned(),
                        fields: vec!["tag".to_owned()],
                        unique: false,
                        where_applicable: false,
                    }],
                ),
                table("attachments", vec![field("noteId", false)], Vec::new()),
            ],
            ..Default::default()
        };
        let intents = derive_intents(&predecessor, &successor).expect("derive");
        assert_eq!(
            intents,
            vec![
                MigrationIntent::TightenRequired {
                    table: "notes".to_owned(),
                    field: "draft".to_owned(),
                },
                MigrationIntent::AddOptionalField {
                    table: "notes".to_owned(),
                    field: "tag".to_owned(),
                    field_type: crate::manifest::FieldType::String,
                },
                MigrationIntent::CreateIndex {
                    table: "notes".to_owned(),
                    index: "by_tag".to_owned(),
                    fields: vec!["tag".to_owned()],
                    unique: false,
                },
                MigrationIntent::CreateTable {
                    table: "attachments".to_owned(),
                },
                MigrationIntent::RetireTable {
                    table: "legacy".to_owned(),
                },
            ],
        );
        // Determinism through to plan bytes: two clean derivations produce
        // identical steps and therefore identical canonical plan bytes.
        let steps_a = derive_plan_steps(&predecessor, &successor, &intents).expect("steps a");
        let steps_b = derive_plan_steps(
            &predecessor,
            &successor,
            &derive_intents(&predecessor, &successor).expect("derive again"),
        )
        .expect("steps b");
        assert_eq!(
            serde_json::to_value(&steps_a).unwrap(),
            serde_json::to_value(&steps_b).unwrap(),
        );

        // Refusal classes name the explicit intent they demand.
        let refusal = |predecessor: &crate::manifest::SchemaManifest,
                       successor: &crate::manifest::SchemaManifest,
                       needle: &str| {
            let error =
                derive_intents(predecessor, successor).expect_err("ambiguous diff must refuse");
            assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_INVALID");
            assert!(
                error.diagnostic.message.contains(needle),
                "{needle} missing from: {}",
                error.diagnostic.message
            );
        };
        let base = crate::manifest::SchemaManifest {
            tables: vec![table("notes", vec![field("body", false)], Vec::new())],
            ..Default::default()
        };
        // Required add needs a declared backfill.
        refusal(
            &base,
            &crate::manifest::SchemaManifest {
                tables: vec![table(
                    "notes",
                    vec![field("body", false), field("region", false)],
                    Vec::new(),
                )],
                ..Default::default()
            },
            "AddRequiredField",
        );
        // Removed + added in one table is a rename signal.
        refusal(
            &base,
            &crate::manifest::SchemaManifest {
                tables: vec![table("notes", vec![field("content", true)], Vec::new())],
                ..Default::default()
            },
            "RenameField",
        );
        // Type change demands ConvertField.
        refusal(
            &base,
            &crate::manifest::SchemaManifest {
                tables: vec![table(
                    "notes",
                    vec![crate::manifest::FieldManifest {
                        name: "body".to_owned(),
                        field_type: crate::manifest::FieldType::Integer,
                        optional: false,
                    }],
                    Vec::new(),
                )],
                ..Default::default()
            },
            "ConvertField",
        );
        let predecessor_json = crate::manifest::SchemaManifest {
            tables: vec![table(
                "notes",
                vec![
                    crate::manifest::FieldManifest {
                        name: "body".to_owned(),
                        field_type: crate::manifest::FieldType::Json,
                        optional: false,
                    },
                    field("title", false),
                ],
                Vec::new(),
            )],
            ..Default::default()
        };
        let descriptor = crate::manifest::ResultValueContract::Object {
            fields: vec![crate::manifest::ResultObjectFieldContract {
                name: "text".to_owned(),
                required: true,
                value: crate::manifest::ResultValueContract::String { max_bytes: 64 },
            }],
            allow_extra: false,
        };
        let contract = crate::manifest::StoredStructuredContractV1 {
            version: crate::manifest::STORED_STRUCTURED_CONTRACT_VERSION_V1,
            descriptor,
            encoding: crate::manifest::STORED_STRUCTURED_ENCODING_V1.to_owned(),
        };
        let contract_hash = crate::manifest::stored_structured_contract_hash(&contract).unwrap();
        let successor_structured = crate::manifest::SchemaManifest {
            tables: vec![table(
                "notes",
                vec![
                    crate::manifest::FieldManifest {
                        name: "body".to_owned(),
                        field_type: crate::manifest::FieldType::Structured {
                            contract,
                            contract_hash,
                        },
                        optional: false,
                    },
                    field("title", false),
                ],
                Vec::new(),
            )],
            ..Default::default()
        };
        refusal(
            &predecessor_json,
            &successor_structured,
            "ConvertJsonToStructured",
        );

        let steps = derive_plan_steps(
            &predecessor_json,
            &successor_structured,
            &[MigrationIntent::ConvertJsonToStructured {
                table: "notes".to_owned(),
                field: "body".to_owned(),
                generation: 2,
            }],
        )
        .expect("JSON-to-structured conversion expands to a successor generation");
        assert!(matches!(
            steps[0].step,
            MigrationStep::StageTableGeneration { generation: 2, .. }
        ));
        let MigrationStep::CopyTable { ref fields, .. } = steps[1].step else {
            panic!("second conversion step must copy the successor table")
        };
        assert_eq!(
            fields.keys().map(String::as_str).collect::<Vec<_>>(),
            vec!["body"]
        );
        for predecessor_type in [
            successor_structured.tables[0].fields[0].field_type.clone(),
            crate::manifest::FieldType::String,
        ] {
            let wrong_predecessor = crate::manifest::SchemaManifest {
                tables: vec![table(
                    "notes",
                    vec![
                        crate::manifest::FieldManifest {
                            name: "body".to_owned(),
                            field_type: predecessor_type,
                            optional: false,
                        },
                        field("title", false),
                    ],
                    Vec::new(),
                )],
                ..Default::default()
            };
            let error = derive_plan_steps(
                &wrong_predecessor,
                &successor_structured,
                &[MigrationIntent::ConvertJsonToStructured {
                    table: "notes".to_owned(),
                    field: "body".to_owned(),
                    generation: 2,
                }],
            )
            .expect_err("the named conversion requires a Json predecessor");
            assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_INVALID");
            assert!(error.diagnostic.message.contains("must be Json"));
        }
        assert_eq!(steps[1].verification.len(), 2);
        assert_eq!(
            execution_strategy_for_steps(&steps),
            MigrationExecutionStrategy::ShadowGeneration,
        );
        // Loosening required→optional is outside the vocabulary.
        refusal(
            &base,
            &crate::manifest::SchemaManifest {
                tables: vec![table("notes", vec![field("body", true)], Vec::new())],
                ..Default::default()
            },
            "outside the closed v1 intent vocabulary",
        );
    }

    fn fixture() -> (
        MigrationPlanArtifactV1,
        MigrationPreviewObservationV1,
        MigrationApprovalV1,
        MigrationAdmissionV1,
    ) {
        migration_vector_fixture().expect("fixture")
    }

    fn schemas() -> (SchemaManifest, SchemaManifest) {
        let successor = fixture_successor();
        let mut predecessor = successor.clone();
        predecessor.tables[0]
            .fields
            .retain(|field| field.name == "name");
        predecessor.tables[1]
            .fields
            .retain(|field| field.name == "email");
        (predecessor, successor)
    }

    fn fixture_successor() -> SchemaManifest {
        // Mirror of migration_vector_fixture's successor schema.
        use crate::manifest::{FieldManifest, IndexManifest, TableManifest};
        SchemaManifest {
            tables: vec![
                TableManifest {
                    name: "accounts".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "name".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                        FieldManifest {
                            name: "region".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                    ],
                    indexes: vec![IndexManifest {
                        name: "by_region".to_owned(),
                        fields: vec!["region".to_owned()],
                        unique: false,
                        where_applicable: false,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
                TableManifest {
                    name: "users".to_owned(),
                    fields: vec![
                        FieldManifest {
                            name: "email".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                        FieldManifest {
                            name: "displayName".to_owned(),
                            field_type: FieldType::String,
                            optional: false,
                        },
                    ],
                    indexes: vec![IndexManifest {
                        name: "by_email".to_owned(),
                        fields: vec!["email".to_owned()],
                        unique: true,
                        where_applicable: false,
                    }],
                    syncable: true,
                    permission_backing: false,
                    permission_fields: None,
                    search_indexes: Vec::new(),
                    vector_indexes: Vec::new(),
                    search_live_limits: None,
                    membership: None,
                    authority_profile: None,
                    asset_sharing: None,
                    visibility: None,
                    history: None,
                },
            ],
            ..SchemaManifest::default()
        }
    }

    // @ref LLP 0081#2-canonical-plan-and-approval — plan bytes with
    //   identical explicit constants are byte-identical; the digest
    //   preimage is the domain prefix, one newline, and the JCS body bytes,
    //   and validation recomputes it with no self-reference.
    #[test]
    fn plan_digest_is_deterministic_and_tamper_evident() {
        let (artifact, ..) = fixture();
        let (again, ..) = fixture();
        assert_eq!(artifact, again, "identical inputs seal identical artifacts");
        assert_eq!(artifact.plan_digest.len(), 64);
        assert_eq!(
            artifact.plan_id,
            format!("migration-v1:{}", artifact.plan_digest)
        );

        let (predecessor, successor) = schemas();
        validate_plan_artifact(&artifact, &predecessor, &successor).expect("valid plan");

        let mut tampered = artifact.clone();
        tampered.body.ceilings.max_affected_rows += 1;
        let error = validate_plan_artifact(&tampered, &predecessor, &successor)
            .expect_err("ceiling tamper must refuse");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_INVALID");

        let mut forged = artifact.clone();
        forged.plan_id = "migration-v1:forged".to_owned();
        assert!(validate_plan_artifact(&forged, &predecessor, &successor).is_err());
    }

    // @ref LLP 0081#2-canonical-plan-and-approval — the pinned normative
    //   order: successor-schema declaration order first (accounts before
    //   users even though the users intent was declared first), each
    //   intent's chain in required sequence (validate before tighten), and
    //   canonical `s<ordinal>:<stepType>:<target>` IDs.
    #[test]
    fn planner_order_and_step_ids_are_pinned() {
        let (artifact, ..) = fixture();
        let ids: Vec<&str> = artifact
            .body
            .steps
            .iter()
            .map(|step| step.id.as_str())
            .collect();
        assert_eq!(
            ids,
            vec![
                "s1:AddField:accounts.region",
                "s2:BackfillField:accounts.region",
                "s3:ValidateRequired:accounts.region",
                "s4:MakeRequired:accounts.region",
                "s5:AddField:users.displayName",
                "s6:BackfillField:users.displayName",
                "s7:ValidateRequired:users.displayName",
                "s8:MakeRequired:users.displayName",
                "s9:ValidateUnique:users#unique(email)",
                "s10:CreateUniqueIndex:users#by_email",
            ],
        );
    }

    // @ref LLP 0081#3-typed-migration-steps — the deterministic UUIDv7
    //   namespace: 48 publication-timestamp time bits, fixed version and
    //   variant, 74 digest-derived random bits, collision-scoped per
    //   destination; and the 48-bit range refusal.
    #[test]
    fn synthesized_ids_are_deterministic_uuidv7() {
        let (artifact, ..) = fixture();
        let id = |row: &str, ordinal: u64| {
            synthesized_row_id(
                artifact.body.constants.publication_timestamp_ms,
                &artifact.plan_digest,
                &artifact.body.steps[0].id,
                "users",
                row,
                "users",
                2,
                ordinal,
            )
            .expect("in-range timestamp")
        };
        let first = id("row-1", 0);
        assert_eq!(first, id("row-1", 0), "same inputs, same id");
        assert_ne!(first, id("row-1", 1));
        assert_ne!(first, id("row-2", 0));
        let parsed = uuid::Uuid::parse_str(&first).expect("uuid shape");
        assert_eq!(parsed.get_version_num(), 7);
        let bytes = parsed.as_bytes();
        let mut ts = [0_u8; 8];
        ts[2..8].copy_from_slice(&bytes[..6]);
        assert_eq!(
            u64::from_be_bytes(ts),
            artifact.body.constants.publication_timestamp_ms,
            "time bits carry the approved publicationTimestamp",
        );
        assert_eq!(bytes[8] & 0xc0, 0x80, "RFC 4122 variant");

        let error = synthesized_row_id(
            MIGRATION_TIMESTAMP_MAX_EXCLUSIVE,
            &artifact.plan_digest,
            "s1:x:y",
            "a",
            "k",
            "b",
            1,
            0,
        )
        .expect_err("48-bit range refusal");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_INVALID");
    }

    // @ref LLP 0081#3-typed-migration-steps — backfill expressions read the
    //   source row plus explicit constants only, and a step writing an
    //   authority-bearing table is refused at plan validation.
    #[test]
    fn plan_validation_refuses_ambient_inputs_and_authority_tables() {
        let (artifact, ..) = fixture();
        let (predecessor, successor) = schemas();

        let reseal = |mutate: &dyn Fn(&mut MigrationPlanBody)| {
            let mut body = artifact.body.clone();
            mutate(&mut body);
            MigrationPlanArtifactV1::seal(body).expect("reseal")
        };

        for (expr, needle) in [
            (ValueExpr::RuntimeNow, "ambient time"),
            (ValueExpr::AuthUserId, "authorization"),
            (
                ValueExpr::Arg("undeclared".to_owned()),
                "no declared plan constant",
            ),
        ] {
            let tampered = reseal(&|body: &mut MigrationPlanBody| {
                if let MigrationStep::BackfillField { expr: slot, .. } = &mut body.steps[1].step {
                    *slot = expr.clone();
                }
            });
            let error = validate_plan_artifact(&tampered, &predecessor, &successor)
                .expect_err("closed vocabulary must refuse");
            assert!(
                error.diagnostic.message.contains(needle),
                "{needle}: {}",
                error.diagnostic.message
            );
        }

        // Authority-bearing refusal: make `users` permission-backing.
        let mut authority_schema = successor.clone();
        authority_schema.tables[1].permission_backing = true;
        let error = validate_plan_artifact(&artifact, &predecessor, &authority_schema)
            .expect_err("authority-bearing write must refuse");
        assert!(error.diagnostic.message.contains("authority-bearing"));

        // A resealed artifact cannot turn the migration decoder's staged-NULL
        // allowance into a waiver for an existing required field.
        let existing_required = reseal(&|body: &mut MigrationPlanBody| {
            let record = &mut body.steps[1];
            if let MigrationStep::BackfillField { field, .. } = &mut record.step {
                *field = "name".to_owned();
            }
            record.id = canonical_step_id(2, &record.step);
        });
        let error = validate_plan_artifact(&existing_required, &predecessor, &successor)
            .expect_err("an existing required destination is not a staged field");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_INVALID");
        assert!(error.diagnostic.message.contains("is not staged"));

        let validates_existing_required = reseal(&|body: &mut MigrationPlanBody| {
            let record = &mut body.steps[2];
            if let MigrationStep::ValidateRequired { field, .. } = &mut record.step {
                *field = "name".to_owned();
            }
            record.id = canonical_step_id(3, &record.step);
        });
        let error = validate_plan_artifact(&validates_existing_required, &predecessor, &successor)
            .expect_err("an existing required field has no staged requiredness lifecycle");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_INVALID");
        assert!(error.diagnostic.message.contains("has neither lifecycle"));

        let writes_after_validation = reseal(&|body: &mut MigrationPlanBody| {
            body.steps[1..4].rotate_left(1);
            for (index, record) in body.steps.iter_mut().enumerate() {
                record.id = canonical_step_id(index + 1, &record.step);
            }
        });
        let error = validate_plan_artifact(&writes_after_validation, &predecessor, &successor)
            .expect_err("a backfill cannot invalidate a consumed requiredness proof");
        assert_eq!(error.diagnostic.code, "SNAPBACK_MIGRATION_PLAN_INVALID");
        assert!(
            error
                .diagnostic
                .message
                .contains("after its requiredness validation closed")
        );

        // Transformed retained work is typed but unsupported.
        let transformed = reseal(&|body: &mut MigrationPlanBody| {
            body.retained_work_posture = RetainedWorkPosture::Transformed;
        });
        let error = validate_plan_artifact(&transformed, &predecessor, &successor)
            .expect_err("transformed posture is deferred");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MIGRATION_PROFILE_UNSUPPORTED"
        );

        // Out-of-range publication timestamp.
        let out_of_range = reseal(&|body: &mut MigrationPlanBody| {
            body.constants.publication_timestamp_ms = MIGRATION_TIMESTAMP_MAX_EXCLUSIVE;
        });
        assert!(validate_plan_artifact(&out_of_range, &predecessor, &successor).is_err());
    }

    // @ref LLP 0081#acceptance — plan bytes with identical explicit
    //   constants are byte-identical against the committed golden vectors,
    //   and synthesized IDs match the deterministic UUIDv7 conformance
    //   vectors. These are the exact frozen values; the committed
    //   `schemas/migration.vectors-v1.json` is generated through the same
    //   implementation and drift-gated, so file, runtime, and this pin
    //   cannot diverge silently.
    #[test]
    fn golden_vectors_are_byte_pinned() {
        let vectors = migration_vectors_artifact();
        assert_eq!(
            vectors["plan"]["planDigest"],
            json!("7265b14a64990e75b2ef112638fe1147b6d70a6d7667f149ad86c05a5e8cc30d"),
        );
        assert_eq!(
            vectors["plan"]["planId"],
            json!("migration-v1:7265b14a64990e75b2ef112638fe1147b6d70a6d7667f149ad86c05a5e8cc30d"),
        );
        assert_eq!(
            vectors["observationDigest"],
            json!("ac5d93cef453f09c306a6d2c4eb7284c46819b32b98575d4af0882fb56f50600"),
        );
        assert_eq!(
            vectors["approvalDigest"],
            json!("60f8a54603a91d9eaa58abdc1ad6588b40dee97005d3943449abc80120774e8e"),
        );
        assert_eq!(
            vectors["admissionDigest"],
            json!("273768966a0c199042b7bd7410b09c7962f0c2789ac3dcd796ddff9df9f53fc4"),
        );
        let ids: Vec<&str> = vectors["synthesizedIds"]
            .as_array()
            .expect("id vectors")
            .iter()
            .map(|vector| vector["id"].as_str().expect("id"))
            .collect();
        assert_eq!(
            ids,
            vec![
                "019f5eaf-b000-7d11-a5a0-cc0daeef61c3",
                "019f5eaf-b000-7d38-b681-c0208c676065",
                "019f5eaf-b000-7cd8-b65f-8b7b2412e108",
            ],
        );
    }

    // Approval and admission records digest deterministically and their
    // structural gates hold (fresh operationId, expiry after issue, resolved
    // local target identity).
    #[test]
    fn approval_and_admission_records_hold_their_shape() {
        let (_, observation, approval, admission) = fixture();
        assert_eq!(
            observation_digest(&observation).unwrap(),
            observation_digest(&observation).unwrap()
        );
        validate_approval_shape(&approval).expect("valid approval");

        let mut derived = approval.clone();
        derived.operation_id = format!("{MIGRATION_OPERATION_ID_PREFIX}{}", approval.plan_digest);
        assert!(
            validate_approval_shape(&derived).is_err(),
            "plan-derived id"
        );

        let mut expired = approval.clone();
        expired.expires_at_ms = expired.issued_at_ms;
        assert!(validate_approval_shape(&expired).is_err());

        let mut anonymous = approval.clone();
        anonymous.approver = String::new();
        assert!(validate_approval_shape(&anonymous).is_err());

        let digest = admission_digest(&admission).unwrap();
        assert_eq!(digest.len(), 64);
        assert_ne!(digest, approval_digest(&approval).unwrap());
    }
}
